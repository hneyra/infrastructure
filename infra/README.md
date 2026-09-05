# `infra/` — la infraestructura del SGTM, como código

Pulumi en TypeScript con yarn, dos stacks —`stg` y `prod`— del mismo `index.ts`, sobre
un k3s de un solo nodo en un VPS propio. La decisión, con sus alternativas y sus costos,
está en [`ADR-0011`](../docs/30-arquitectura/adr/ADR-0011-infraestructura-como-codigo.md);
la topología, en [`INF-01`](../docs/80-infraestructura/arquitectura-de-infraestructura.md);
los ambientes, en [`INF-03`](../docs/80-infraestructura/ambientes.md).

**Hoy describe el sistema entero de la fase B**: PostgreSQL con sus cuatro roles, los
Jobs de migración e implantación, Keycloak con su base y su realm, la aplicación y la
interfaz, y Traefik con TLS ([qué hace cada componente](componentes/README.md)).

```bash
cd infra
yarn install
yarn verificar        # lint, tipos y pruebas. Lo que hay que pasar antes de un PR
yarn manifiestos --ambiente stg          # los manifiestos de un ambiente, en JSON
verificaciones/motor/verificar-el-motor.sh --ambiente stg --con-aislamiento
respaldo/simulacro-de-restauracion.sh --ambiente stg   # el respaldo FISICO, restaurado de verdad
respaldo/simulacro-de-restauracion-logica.sh           # pg_dump/pg_restore de los CINCO esquemas
observabilidad/verificar-alertas.sh                    # apaga la base, comprueba que la alerta llega
observabilidad/verificar-tableros.sh                   # cada panel del tablero, contra Prometheus
```

`yarn verificar` **no necesita Pulumi, ni token, ni clúster.** Es deliberado: la parte
que puede equivocarse a diario —un valor que falta, un plazo que degrada el RPO, una
etiqueta que se cuela en el estado— se detecta en la máquina de quien lo escribe.

## Las piezas

| Archivo | Qué es |
|---|---|
| `Pulumi.yaml` | El proyecto. Fija `packagemanager: yarn` |
| `Pulumi.prod.yaml` · `Pulumi.stg.yaml` | La configuración **en claro** de cada ambiente. Los secretos no están aquí |
| `config.ts` | **Toda** la configuración: se lee, se le ponen valores por omisión y se valida |
| `config.test.ts` | Un caso que viola cada invariante |
| `index.ts` | La composición. Una sola, para los dos ambientes |
| `componentes/` | Los ocho componentes —los cinco de la fase B más el respaldo, la observabilidad y la red de la fase C—, como **funciones puras** que devuelven manifiestos |
| `auditoria.ts` | Las convenciones de `INF-01` §4 sobre esos manifiestos. Corre en `yarn verificar` **y** en `pulumi up` |
| `herramientas/` | `yarn manifiestos` y `yarn secretos`: lo que se desplegaría y el inventario de claves, en JSON, sin Pulumi |
| `secretos/` | Generar lo que falte y rotar lo que ya existe (`INF-06`, issue #154) — nunca `pulumi up` |
| `respaldo/` | El simulacro de restauración: archivado, PITR y verificación contra un motor real (`INF-08`, issue #155) |
| `observabilidad/` | Las reglas de alerta, el tablero, y las dos comprobaciones que corren contra un clúster real (`INF-09`, issue #156) |
| `verificaciones/` | Las reglas de ESLint, los stacks versionados, los criterios de aceptación de la fase B y el motor levantado de verdad |

### Por qué los componentes devuelven datos en vez de crear recursos

Cada componente es una función que devuelve objetos planos de Kubernetes, y `index.ts`
los audita y los aplica. De ahí salen tres cosas que no se consiguen creando recursos
dentro del componente:

1. **La auditoría puede leerlos.** Un `pulumi.Input<number>` no se compara con 3; un
   `number` sí. Las convenciones de `INF-01` §4 dejan de ser un documento.
2. **Las pruebas corren sin Pulumi y sin clúster**, que es lo que permite que un PR de
   cualquiera ponga rojo un despliegue mal formado.
3. **El diff de un cambio de infraestructura es legible**: cambia un objeto, no una
   llamada con quince opciones.

El costo —perder el tipado del esquema de Kubernetes— se recupera en
`verificaciones/conformidad-con-kubernetes.test.ts`: cada manifiesto se asigna al tipo
de `@pulumi/kubernetes` que le corresponde, y un nombre de propiedad mal escrito **no
compila**.

## La regla que sostiene todo lo demás

**La configuración se lee en `config.ts` y se valida ahí.** No hay `new pulumi.Config()`
ni `process.env` en ningún otro archivo, y una regla de ESLint lo impide con su muestra
que la viola.

El motivo no es de estilo. Un `config.require("domain")` dentro de un componente
convierte «falta el dominio» en un fallo **a mitad del despliegue**, con el clúster ya a
medio cambiar, en vez de un fallo del arranque que dice qué valor falta y para qué sirve:

```
Falta el valor obligatorio «sgtm:domain» en la configuración del stack.
Sirve para: el nombre público por el que llega el navegador.
Ponlo con `pulumi config set domain <valor>`.
```

## Las invariantes, y de dónde sale cada una

`checkInvariants` no comprueba tipos —de eso se encarga TypeScript—: comprueba que la
configuración **no contradiga lo que el proyecto ya decidió por escrito**.

| Invariante | De dónde sale |
|---|---|
| El stack es `stg` o `prod`. Local no es un stack | `ADR-0011` §4 |
| `acmeEmail` tiene forma de correo; en `prod` no se admite el certificado de pruebas de Let's Encrypt | RNF-074 |
| No se publica ningún puerto del nodo además de 80 y 443 | RNF-074, `INF-01` §1.4 |
| El destino de respaldo **no** resuelve dentro del nodo | `INF-01` §1.3 |
| El contenedor de respaldo nombra su ambiente | `INF-03` §4 |
| `walArchiveTimeoutSeconds` ≤ 300 | RNF-076: **este valor es el RPO** |
| `restoreSourceBucket` solo en `stg`, y distinto de su propio contenedor | `INF-03` §2 |
| `stg` va marcada como instalación de demostración | `INF-03` §3.2, #122 |
| Keycloak nunca en `start-dev`; usuarios de prueba nunca en `prod` | `INF-01` §1, `INF-03` §4 |
| Las claves de los roles no se generan en el estado de Pulumi | `ADR-0011` §3 |
| `applicationImageRepository` **sin etiqueta** | `ADR-0011` §5 |
| Las imágenes fijan versión; nada de `latest` | `INF-01` §5 |
| El `server` del kubeconfig apunta al bucle local | `INF-01` §1.4 — la cicatriz de `../iaac` |
| `applicationBootstrapVersion` fija una versión, y es una etiqueta, no una imagen | `ADR-0011` §5 |
| En `prod`, `esDemostracion` **se declara**; heredarlo del valor por omisión no cuenta | #150, D-02a |
| El ubigeo son seis dígitos y el tipo de municipalidad es DISTRITAL o PROVINCIAL | #150 |
| `nodeAllocatableCpu`/`nodeAllocatableMemory` son obligatorios, y **medidos** | `INF-01` §2, #252 |

Y una que no es de `config.ts` sino de `capacidad.ts`, porque no mira un valor sino la
suma de todos:

| Invariante | De dónde sale |
|---|---|
| **El stack cabe en el nodo que declara**, contando los Jobs del arranque | `INF-01` §2, #252 |

Esta última es la que convierte un despliegue colgado en un fallo de veinte segundos.
Un pod que el planificador no puede ubicar se queda `Pending` sin error ni registro, y
el `ConfigGroup` de `index.ts` lo espera indefinidamente: `aplicar-prod` se quedó así
cuatro veces entre el 25 y el 26 de agosto de 2026, una de ellas casi seis horas.

Se comprueba en tres sitios, y cada uno hace algo distinto:

| Dónde | Qué hace |
|---|---|
| `yarn verificar` | Rojo si un ambiente **sin** `nodeCapacityGapIssue` no cabe |
| `index.ts` | Lanza si no cabe; **avisa** si la brecha está declarada — reventar aquí rompería `pulumi preview`, que corre en cada PR |
| `aplicar-stg`/`aplicar-prod` | **Detiene el despliegue** antes de invocar a Pulumi. Es el bloqueo duro |

```bash
yarn capacidad --ambiente prod                      # ¿cabe? y cuánto sobra o falta
yarn capacidad --ambiente prod --cpu 8 --memoria 16Gi   # ¿y si el nodo fuera otro?
```

**Los dos valores del nodo son lo *asignable*, no la capacidad.** La reserva del kubelet
(`vps/reservar-recursos-del-nodo.sh`, #157) se lleva 1 CPU y 2 Gi, y confundir las dos
cifras es exactamente lo que dejó a `prod` sin poder ubicar su propio stack. Se miden:

```bash
kubectl get node -o jsonpath='{.items[0].status.allocatable.cpu}{"/"}{.items[0].status.allocatable.memory}'
```

Y no se cree lo declarado sin contrastarlo: `aplicar-stg`/`aplicar-prod` corren
`vps/comprobar-lo-asignable.sh` contra el nodo real antes de `pulumi up`, y rechazan un
stack que se declare **más grande** de lo que su nodo es — la única dirección del error
que deja pasar un despliegue que no cabe.

Y sobre los manifiestos, en `auditoria.ts`:

| Convención | De dónde sale |
|---|---|
| Toda sonda declara `timeoutSeconds`, entre 3 y 5 s | `INF-01` §4 — el 1 s del kubelet mata pods sanos |
| Todo contenedor declara `requests` y `limits`; todo pod, su `priorityClassName` | `INF-01` §4 |
| Un `Deployment` con volumen persistente usa `Recreate` | `INF-01` §4 |
| Ningún `Service` fuera de `ClusterIP` | `INF-01` §1.4 |
| El `Secret` de `sgtm_owner` no entra en ningún proceso expuesto en HTTP | ARQ-03 §4, #150 |
| El perfil `web` declara `KAMAYUK_OIDC_EMISOR`; el `batch` no abre puertos | ADR-0005, #152 |
| Keycloak no arranca en `start-dev` | #151 |
| Toda ruta va por `websecure` con TLS, y `/keycloak/admin` no se publica | #153 |
| El motor declara `archive_mode=on`; ninguna clave de wal-g va como `value` | RNF-076, #155 |
| El `Secret` de `sgtm_owner` entra en el CronJob de respaldo (excepción nombrada), y en ningún otro CronJob | RF-126, #155 |
| El `ClusterRole` de kube-state-metrics no toca `secrets` ni `configmaps`, y solo `list`/`watch` | #156 |

> **Una nota sobre la última fila de `ADR-0011` §5.** El ADR anotaba como costo aceptado
> que la frontera de la versión de la imagen «no tiene verificación automática todavía;
> es una revisión de PR». Ahora sí la tiene: `applicationImageRepository` con etiqueta
> pone rojo el stack. El ADR no se edita —así es como se registran las decisiones—, pero
> conviene saber que en este punto el código llegó más lejos que el documento.

## Cómo se demuestra que las verificaciones pueden fallar

Todas se ejercen editando archivos reales y viendo el rojo:

| Rotura | Qué se pone rojo |
|---|---|
| Quitar `sgtm:domain` de `Pulumi.prod.yaml` | `yarn test`, nombrando el valor que falta |
| Subir `walArchiveTimeoutSeconds` a 3600 | `yarn test`, citando RNF-076 |
| Ponerle etiqueta a `applicationImageRepository` | `yarn test`, citando `ADR-0011` §5 |
| Copiar la lectura de configuración a un componente | `yarn lint` |
| Poner `RollingUpdate` en el `Deployment` de la base, o `timeoutSeconds: 1` en una sonda | `yarn test`, con el motivo entero |
| Darle al `Deployment` de la aplicación el `Secret` de `sgtm_owner`, o cambiarle el usuario de base | `yarn test` |
| Quitar `!PathPrefix(/keycloak/admin)` de la ruta de identidad | `yarn test` |
| Quitar el `GRANT CONNECT` de `30-base-de-keycloak.sh` | `verificar-el-motor.sh`: `sgtm_owner` deja de poder conectarse |
| Quitar `archive_mode=on`, o poner la clave de cifrado de wal-g como `value` | `yarn test`, citando RNF-076 |
| Apagar PostgreSQL sin cablear el receptor de alertas | `verificar-alertas.sh`: la regla se evalúa y el receptor de prueba recibe 0 peticiones |
| Quitar un panel del tablero de su fuente de datos real | `verificar-tableros.sh`: «No data», nombrando el panel |
| Quitar `recovery_target_time` del simulacro | `simulacro-de-restauracion.sh`: se restauran 4 filas donde había 3 |
| Devolver a `catastro` la función sin cualificar que C-4 arregló | `simulacro-de-restauracion-logica.sh`: **`TABLA via` con nombre**, sus 4 índices, su política de RLS, su secuencia, 5 restricciones y `< FILAS via 3` |
| Declarar una pérdida que ya no ocurre, o dejar de declarar una que sí | el mismo guion, en las dos direcciones: la lista de `rl_perdidas_conocidas` no puede quedarse rancia |
| Fiarse del código de salida de la restauración | `yarn test`: `(18 errores, código 0)` es lo que da `psql` sobre un volcado plano con el defecto dentro |
| Hacer `SUPERUSER` a `sgtm_respaldo`, o darle `CONNECT` al padrón | `verificar-el-motor.sh` y el simulacro |
| Apuntar `applicationBootstrapVersion` a un `sha` con migraciones de menos | `yarn test`, con **las dos cifras** y las migraciones que faltan |
| Apuntarlo a un `sha` que no está en el clon | `yarn test`: no concluye en vez de contar las del árbol de trabajo, y dice `fetch-depth: 0` |
| Quitar `db/migration/**` del filtro `paths` de `infra.yml` | `yarn test`: la guarda existiría y no correría al integrar una migración |
| Que la base tenga MÁS migraciones que la versión declarada | `verificar-el-ambiente.sh`: hasta #675 decía «al día» |

Las últimas cuatro son las que más valen, porque **no se pueden comprobar leyendo el
manifiesto**. `30-base-de-keycloak.sh` revoca el `CONNECT` que `PUBLIC` tiene por omisión
sobre la base del padrón, y si no vuelve a concedérselo a los cuatro roles, el sistema
entero se queda fuera. Y un respaldo solo se sabe que sirve restaurándolo: el simulacro
destruye el directorio de datos y comprueba que lo que vuelve cuadra al céntimo
([`INF-08`](../docs/80-infraestructura/respaldo-y-recuperacion.md)). Las dos se
descubrieron ejecutándolas.

## Los secretos que estos manifiestos leen y no crean

`ADR-0011` §3: las claves de la aplicación **no están en el estado de Pulumi**. Los
manifiestos las nombran; quien las genera es `secretos/bootstrap-secretos.sh`, **no**
`pulumi up`. El inventario completo, la rotación de cada uno y por qué está resuelto así
—no un gestor externo, no un operador— está en
[`INF-06`](../docs/80-infraestructura/gestion-de-secretos.md) (issue #154); aquí solo el
comando:

```bash
infra/secretos/bootstrap-secretos.sh --ambiente prod   # o stg
```

Idempotente: genera **solo** lo que falta —32 bytes al azar por clave, nunca dos claves
con el mismo valor— y no toca lo que ya existía. Corre **antes** de `pulumi up`, con el
mismo kubeconfig del túnel SSH; CI lo hace así en `aplicar-stg` y `aplicar-prod`. No
imprime ningún valor, solo huellas.

**Cinco espacios de nombres, no uno** (C-17): el de la plataforma y el de cada sistema. Cuál es
cuál lo dice el propio inventario, así que este guion **ya no admite `--namespace`** — un valor
ahí sólo podría acertar con uno de los cinco. Antes de C-17 declaraba nueve `Secret` y los cuatro
sistemas montaban diez, con **intersección cero**: el guion corría, decía «Listo» y creaba cero
de los diez, mientras sus pods esperaban en `Pending`.

**Ocho de esos diez son espejos, no valores nuevos.** Los cuatro sistemas se conectan con
`sgtm_app` y migran con `sgtm_owner`, que son roles del **clúster**, y PostgreSQL le da a un rol
**una** contraseña: no se pueden generar por separado sin dejar a tres de cada cuatro sin poder
conectarse. Se copian del `Secret` de la plataforma —en base64, sin decodificar y sin pasar por
`argv`— en **cada** corrida, de modo que tras `rotar-clave.sh` hay que volver a correr este guion
para que los espejos alcancen al origen.

**Las claves de los roles del motor se asignan una sola vez**, cuando el volumen está
vacío: el guion de inicialización las lee del `Secret` y hace el `ALTER ROLE`. Cambiar el
`Secret` después **no cambia la clave del rol** — eso es rotación:
`infra/secretos/rotar-clave.sh --ambiente prod --rol sgtm-app`, contra la base en
marcha, sin reiniciar nada (`INF-06` §3).

Sin estos `Secret`, `pulumi up` crea los objetos y los pods se quedan esperando, con el
`Secret` ausente en sus eventos. Es preferible a la alternativa: una clave generada por
Pulumi vive en el estado de Pulumi, y esa clave abre el padrón de todas las
municipalidades.

**Uno más, y este `bootstrap-secretos.sh` no lo genera: `sgtm-<amb>-smtp`** (`usuario`,
`clave`), que el Job de identidad usa para el relay con que Keycloak envía el enlace de
clave del alta declarativa de usuarios (ADR-0012). No se genera porque no es un valor que
se pueda fabricar aquí: lo emite el proveedor del relay, y se pone a mano con
`kubectl create secret generic sgtm-<amb>-smtp --from-literal=usuario=… --from-literal=clave=…`
(`INF-06` §1.2). En `stg` no hace falta: el relay es un buzón Mailpit del propio clúster
(`sgtm-stg-correo`), sin autenticación.

## Liberar una versión nueva

La etiqueta de la imagen **no la mueve Pulumi** (`ADR-0011` §5): el campo `image` lleva
`ignoreChanges`, así que el flujo de liberación lo cambia con `kubectl` y el `preview`
diario no lo ve como deriva.

```bash
kubectl -n sgtm-prod set image deployment/sgtm-prod-aplicacion aplicacion=ghcr.io/hneyra/sgtm-aplicacion:<sha>
kubectl -n sgtm-prod rollout status deployment/sgtm-prod-aplicacion
# Y revertir, sin pulumi up y en segundos:
kubectl -n sgtm-prod rollout undo deployment/sgtm-prod-aplicacion
```

**Si la versión nueva trae migraciones**, antes hay que correr el Job de migración con
esa versión. `yarn manifiestos` lo emite ya listo:

```bash
yarn manifiestos --ambiente prod --componente migracion | kubectl apply -f -
```

El nombre del Job lleva la versión, así que una versión nueva crea un Job nuevo y
volver a aplicar la misma no hace nada: el migrador es idempotente.

### Y por eso hay que subir `applicationBootstrapVersion` (issue #675)

Ese mismo nombre es lo que hace que **no subirla no se note**. Mientras
`sgtm:applicationBootstrapVersion` no se mueva, `pulumi up` encuentra el Job de
migración que ya existe, no crea ninguno, y sale en verde con «unchanged»; no hay ningún
`Deployment` que quede `NotReady` por ello.

Se midió el 2026-09-02: la línea llevaba desde el 2026-08-29 en `5fc02f3` —**48**
migraciones— mientras `main` declaraba **61**, así que a `stg` le faltaban trece
(`V58`…`V71`) y a `prod` las mismas. Y `verificar-el-ambiente.sh` decía, con toda la
razón, «48 · 48 · OK»: compara la base con **la versión declarada**, no con `main`.

Las tres cosas que lo miden hoy, y ninguna sustituye a las otras:

| Qué compara | Quién | Cuándo |
|---|---|---|
| La versión declarada vs. `origin/main` | `infra/verificaciones/deriva-de-migraciones.test.ts` | `yarn verificar`, en cada PR — **sin clúster** |
| La base vs. la versión declarada | `verificaciones/ambiente/verificar-el-ambiente.sh` | tras cada `pulumi up`, y a diario contra `prod` |
| El clúster vs. lo declarado en Pulumi | `pulumi preview --expect-no-changes` | a diario contra `prod` |

Subir la línea es un PR de una línea, y el `sha` tiene que tener sus **tres** imágenes
publicadas:

```bash
gh run list --workflow publicar-imagenes.yml --branch main --limit 5 \
  --json headSha,conclusion,createdAt
```

Sube en **stg y prod a la vez**: `aplicar-prod` tiene `needs: aplicar-stg`, así que `stg`
es la puerta por la que pasa toda versión que llegue a producción.

## Cómo llegar a un VPS real

`.github/workflows/infra.yml` tiene los trabajos de `ADR-0011` §6 y los que se le
sumaron después —`verificar`, `motor`, `raiz-sellada`, `simulacro`, `manifiestos`,
`capacidad`, `secretos`, `observabilidad-alertas`, `observabilidad-tableros`, `red`,
`previsualizar-stg`, `previsualizar-prod`, `aplicar-stg`, `aplicar-prod` y la detección
de deriva diaria—, con el túnel SSH de `INF-01` §1.4 en los que hablan con un clúster.
Los primeros corren siempre y no necesitan VPS. Los que hablan con un clúster se
**omiten con un aviso** en el resumen, no con un rojo, mientras falte cualquiera de sus
credenciales — así se llegó a los dos VPS que **hoy ya existen** con sus credenciales
puestas (`INF-03` §4), y así se repite el camino el día que haya que montar
otro. Esto es lo que hace falta, en orden:

**stg y prod son DOS VPS distintos**, con IP y credenciales propias (`INF-03` §4: un
secreto de stg comprometido no puede abrir prod) — no una simplificación de "por ahora
comparten nodo". Cada paso de abajo se hace **una vez por VPS**.

### 1. Los dos VPS y su k3s

Aprovisionar cada VPS y correr el instalador de k3s en él es trabajo fuera de este
repositorio —no hay nada que un PR pueda automatizar sin la cuenta del proveedor—. El
resultado que este flujo necesita de cada uno es **el kubeconfig del nodo**, con el
`server` cambiado a `https://localhost:6443` (`INF-01` §1.4):

```bash
# En cada VPS, una vez que k3s está instalado:
sudo cat /etc/rancher/k3s/k3s.yaml | sed 's#server: https://127.0.0.1:6443#server: https://localhost:6443#'
```

### 2. Los dos stacks de Pulumi

```bash
cd infra
pulumi stack init sgtm/stg
pulumi stack init sgtm/prod
```

Nada más por ahora: `kubeconfig`, `backupAccessKeyId` y `backupSecretAccessKey` **no se
fijan aquí**. `stacks.test.ts` ("ningun stack versiona un secreto en claro") exige que
`Pulumi.<ambiente>.yaml` nunca los tenga, ni siquiera cifrados — van en el paso 4, como
secretos de GitHub, e inyectados en caliente por CI (y a mano, localmente, antes de cada
`preview`/`up` propio; ver el comentario de cabecera de `Pulumi.stg.yaml`/
`Pulumi.prod.yaml`).

**Los dominios y los destinos de los stacks versionados ya son los reales**
—`vmd120205.contaboserver.net` en `prod`, el nodo de `cloud.elastika.pe` en `stg`, y
`https://s3.us-east-1.amazonaws.com` como destino del respaldo (AWS S3, decidido
2026-08-24; [`INF-01` §7](../docs/80-infraestructura/arquitectura-de-infraestructura.md)).
Lo único que sigue siendo de ejemplo es `acmeEmail` (`operaciones@example.pe`), que se
reemplaza cuando haya buzón de operaciones; las invariantes valen igual.

### 3. Una clave SSH de despliegue POR VPS, y solo de despliegue

**No la de una persona, y no la misma para los dos VPS.** Un par de claves nuevo por
VPS, cuya única función es abrir el túnel que este flujo necesita:

```bash
ssh-keygen -t ed25519 -f despliegue-sgtm-stg -C "github-actions@sgtm-stg" -N ""
ssh-keygen -t ed25519 -f despliegue-sgtm-prod -C "github-actions@sgtm-prod" -N ""
# Cada pública, en su propia línea de authorized_keys del VPS que le corresponde —para
# poder revocarla sola, sin tocar la del otro VPS ni la de nadie más—. Restringida a NO
# abrir una shell (verificar que la entrada final NO tenga `no-port-forwarding`, es la
# única capacidad que hace falta):
#   command="echo 'solo tunel'",no-pty,no-X11-forwarding,no-agent-forwarding <clave-publica>
```

### 4. Los secretos de GitHub Actions: dos de repositorio, seis por *environment*

`Settings → Secrets and variables → Actions`, en este repositorio. Solo los dos tokens
son de repositorio —los mismos para los dos ambientes—; todo lo demás va en un *environment*
por VPS, para que `secrets.VPS_HOST` (y compañía) resuelva al nodo correcto en cada job:

| Secreto | Alcance | Valor |
|---|---|---|
| `PULUMI_ACCESS_TOKEN` | Repositorio | Token de Pulumi Cloud |
| `REGISTRY_PULL_TOKEN` | Repositorio | PAT de GHCR con `read:packages` (issue #257) — de solo lectura, sin motivo para variar por ambiente |
| `SSH_PRIVATE_KEY` | *Environment* `stg` / `prod` | La **privada** de despliegue de ESE VPS, completa |
| `VPS_USER` | *Environment* `stg` / `prod` | El usuario con el que se conecta esa clave |
| `VPS_HOST` | *Environment* `stg` / `prod` | La IP o el nombre de ESE VPS |
| `KUBECONFIG` | *Environment* `stg` / `prod` | El kubeconfig del paso 1, completo |
| `BACKUP_ACCESS_KEY_ID` | *Environment* `stg` / `prod` | Credencial de escritura del contenedor de respaldo de ESE ambiente |
| `BACKUP_SECRET_ACCESS_KEY` | *Environment* `stg` / `prod` | Su secreto |

Además, un tercer *environment* **`prod-preview`**, sin protección, con una **copia** de
los seis valores por-VPS de `prod` (los dos de repositorio no se copian: ya los ve
cualquier *environment*): existe solo para que `previsualizar-prod` pueda correr en cada
PR sin quedar detrás de la aprobación que sí exige `aplicar-prod` — el `up` real nunca
lee de `prod-preview`.

Con `stg` y `prod-preview` puestos (más los dos de repositorio), `previsualizar-stg`,
`previsualizar-prod` y `aplicar-stg` corren solos. `aplicar-prod` necesita además que el
*environment* `prod` tenga sus seis valores y el paso 5.

### 5. El *environment* `prod`, con aprobación requerida

**Este es el paso que ningún YAML de este repositorio puede hacer por sí mismo.** El
criterio de este issue —«`prod` no se aplica hasta que alguien aprueba, y queda
registrado quién»— no lo cumple el archivo del flujo: lo cumple GitHub, y solo si el
*environment* existe con esa regla puesta.

`Settings → Environments → New environment` → nombre **`prod`** (tiene que ser exacto:
es el nombre que `environment: prod` del job `aplicar-prod` referencia) → **Required
reviewers** → añadir a quien tenga que aprobar. Sin este paso, GitHub trata `prod` como
un nombre libre sin protección y el trabajo corre sin que nadie lo mire — que es
exactamente el estado que esta separación existe para impedir. Quién aprueba es una
decisión de las personas del proyecto, no una que este repositorio pueda tomar.

> **Una espera larga entre «trabajo creado» y «trabajo arrancado» en `aplicar-prod` es
> esta aprobación pendiente, no una corrida colgada.** Se ha diagnosticado como avería
> más de una vez: en las corridas del 25 de agosto de 2026 el trabajo pasó 2 h 53 min y
> 1 h 38 min en ese estado, sin un solo registro, simplemente porque nadie había entrado
> a aprobarlo. Se ve en la pestaña Actions, con el botón *Review deployments*. Lo que sí
> es una corrida colgada es que **el paso `Run pulumi/actions@v6` lleve minutos** —un
> `pulumi up` sano de cualquiera de los dos ambientes termina en 15–25 s—, y para eso
> están el `timeout-minutes` de los dos trabajos y el volcado de diagnóstico que corre
> al fallar.

## Lo que no está aquí, y dónde está

| Cosa | Dónde |
|---|---|
| El entorno local | [`despliegue/compose.yaml`](../despliegue/README.md). **No se retira** |
| El destino real de las alertas de deriva (hoy: el trabajo se pone rojo, y nada más) | #156 |
| La huella SSH del VPS fijada de antemano, en vez de confiada la primera vez | #157 |
| Las tres imágenes, publicadas y etiquetadas por commit | [`.github/workflows/publicar-imagenes.yml`](../.github/workflows/publicar-imagenes.yml) |
| El mecanismo de liberación y reversión —probado contra un clúster efímero de CI, sin `pulumi up`— | El mismo flujo, job `demostrar-liberacion-y-reversion` |
| El cortafuegos del VPS, que no es un objeto de Kubernetes | #157, y `vps/cortafuegos.sh` |
| De dónde salen los secretos de la aplicación | #154 |
| Los runbooks de operación — escritos; el de reconstrucción, sin ensayar contra un VPS real | [`docs/B0-operacion/runbooks/`](../docs/B0-operacion/runbooks/), issue #158 |
