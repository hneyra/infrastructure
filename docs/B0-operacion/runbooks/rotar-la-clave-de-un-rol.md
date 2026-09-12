# Runbook — Rotar la clave de un rol de base de datos

| Campo | Valor |
|---|---|
| Cuándo | Mantenimiento programado según la periodicidad que declara cada entrada del inventario (trimestral, semestral o anual), o de inmediato tras un incidente donde una clave pudo quedar expuesta |
| Qué cubre | Los **ocho** roles del inventario que tienen `rolDePostgres` — los seis de siempre más `postgres-ingestor-catastro` y, por un hueco que se mide en «Pasos» §1, el superusuario. Lo que **no** es un rol del motor —el administrador de Keycloak, el del realm, el de Grafana, la clave de cifrado del respaldo y las ocho de las cuentas de servicio— tiene procedimiento aparte, en «Si no sale bien» |
| Estado del ensayo | **La mecánica de PostgreSQL está ensayada contra un motor real y desde `E` corre en CI**, para dos roles. **La rotación en sí NO se ensayó en `prod`**: es destructiva y este trabajo era de sólo lectura. Lo que sí se midió entero contra `prod` (`vmd206041`, 2026-09-12) es el **alcance**: quién se conecta con cada rol, qué `Secret` guarda qué, y qué se rompe si un paso se salta — ver «Estado del ensayo» |

> **Este documento vivía en el repositorio archivo `sgtm` y estaba pre-renombrado.** Sus
> 114 líneas nombraban `sgtm` **27 veces**: los roles (`sgtm_app`, `sgtm_owner`), los
> identificadores cortos del guion (`--rol sgtm-app`), los `Secret`
> (`sgtm-<amb>-keycloak`), el namespace (`sgtm-<amb>`), el `Deployment`
> (`sgtm-<amb>-aplicacion`) y la base (`-d sgtm`). Ninguno de esos nombres existe hoy, y
> el guion que el documento manda ejecutar **rechaza el rol** antes de tocar nada. Se
> trajo y se remidió entero ([#100](https://github.com/hneyra/infrastructure/issues/100),
> sub-issue [#104](https://github.com/hneyra/infrastructure/issues/104)).
>
> Y arrastraba algo más caro que un renombrado: **cuando se escribió había UN solo
> sistema**. Hoy hay cinco sobre el mismo clúster, `kamayuk_app` y `kamayuk_owner` son
> roles **del clúster**, y rotar uno toca las cinco bases y los cinco backends a la vez.
> Eso no estaba escrito en ninguna parte y es el §1 de «Pasos».

## Síntoma

No es una falla: es mantenimiento programado, o la respuesta a un incidente.

## Precondiciones

1. **Saber a quién afecta antes de empezar.** No es retórica: §1 lo mide. Rotar
   `kamayuk-app` en `prod` corta las conexiones **nuevas** de los cinco sistemas hasta
   que se completan los pasos 3 y 4, y saltarse el 3 los deja rotos hasta que alguien
   corra el bootstrap.
2. **Acceso `kubectl` al ambiente**, con permiso para `exec` sobre el pod del motor y
   `patch` sobre los `Secret` de **seis** espacios de nombres: `kamayuk-<amb>` y los
   cinco `kamayuk-<sistema>-<amb>`. Un `Secret` no cruza namespaces (ADR-0031), y el
   paso 3 escribe en los otros cinco.
3. **`yarn install` hecho en `infra/`.** `rotar-clave.sh` y `bootstrap-secretos.sh` leen
   el inventario con `yarn --silent secretos --ambiente <amb>`; sin dependencias no
   arrancan.
4. **`ALTER ROLE ... PASSWORD` no cierra sesiones abiertas.** Es el hecho que sostiene
   todo esto, y está ensayado contra un motor real. **Pero eso no significa «sin ventana»
   para los ocho roles**: dos de ellos reprograman un `Deployment` de una sola réplica con
   estrategia `Recreate`, y uno de esos dos es el motor. La tabla de §1 lo dice rol a rol.

## Pasos

### 1. Qué alcance tiene la rotación que vas a hacer

**Un rol es del clúster, no de una base.** `pg_authid` es uno solo y los cinco sistemas
comparten sus filas, así que PostgreSQL le da a `kamayuk_app` **una** contraseña para las
cinco bases. Medido contra `prod` el 2026-09-12, con las sesiones abiertas en ese momento:

```
 usename         | datname   | sesiones
-----------------+-----------+----------
 kamayuk_app     | caja      |       10
 kamayuk_app     | catastro  |       10
 kamayuk_app     | identidad |       10
 kamayuk_app     | normativa |       10
 kamayuk_app     | rentas    |       10
 kamayuk_monitor | postgres  |        1
 keycloak        | keycloak  |        1
```

Cincuenta sesiones de `kamayuk_app`, diez por sistema. **Ésa es la cifra que el documento
del archivo no podía tener**, y es la que decide que esto no sea una operación de un
sistema.

**Los nombres del documento del archivo ya no existen, y el guion lo dice él mismo.**
Medido, con el `kubeconfig` neutralizado para que no pudiera tocar nada:

```
$ infra/secretos/rotar-clave.sh --ambiente prod --rol sgtm-app
«sgtm-app» no esta en el inventario, o no admite rotacion por este guion.
Los roles del inventario que SI tienen rolDePostgres (y por tanto se rotan asi):
  - postgres-superusuario
  - kamayuk-owner
  - kamayuk-app
  - keycloak-base
  - kamayuk-respaldo
  - kamayuk-monitor
  - postgres-carga
  - postgres-ingestor-catastro
$ echo $?
2
```

Ésos son los ocho, y así es como se vuelven a listar el día que el inventario cambie —el
guion los deriva, no los trae escritos—. Lo que hace falta saber de cada uno:

| `--rol` | Rol de PostgreSQL | Base donde se comprueba | Periodicidad | A quién reprograma | Ventana |
|---|---|---|---|---|---|
| `kamayuk-app` | `kamayuk_app` | `rentas` | semestral | **nadie, y es un hueco declarado**: los consumidores son cinco `Deployment` en cinco namespaces, y el campo nombra uno — §4 los nombra a los cinco | no, si se hacen 3 y 4 seguidos |
| `kamayuk-owner` | `kamayuk_owner` | `rentas` | trimestral | nadie: sólo lo leen los dos `Job` de cada sistema, que nacen con el `Secret` del momento | no |
| `keycloak-base` | `keycloak` | `keycloak` | semestral | `kamayuk-<amb>-identidad` | **sí**: 1 réplica, `Recreate` — nadie inicia sesión mientras reinicia |
| `kamayuk-respaldo` | `kamayuk_respaldo` | `postgres` | semestral | nadie: el `CronJob` crea un pod nuevo en cada corrida | no |
| `kamayuk-monitor` | `kamayuk_monitor` | `postgres` | semestral | **`kamayuk-<amb>-postgres`** | **sí, y es la peor**: reprograma el MOTOR, 1 réplica y `Recreate` — los cinco sistemas se quedan sin base |
| `postgres-carga` | `rol_carga_parametros` | `normativa` | trimestral | nadie | no |
| `postgres-ingestor-catastro` | `rol_ingestor_catastro` | `rentas` | trimestral | nadie | no — pero ver el aviso de abajo |
| `postgres-superusuario` | `postgres` | `postgres` | **`nunca-desde-el-nodo`** | nadie | **no lo rotes con este guion** |

> **Dos cosas de esa tabla salieron de medir, no de leer.**
>
> **(a) El guion ACEPTA `postgres-superusuario`, aunque su propia cabecera diga que no.**
> Su cabecera lista cuatro roles que rechaza y el superusuario es el primero; el código
> rechaza **sólo** las entradas sin `rolDePostgres`, y ésta tiene `rolDePostgres:
> "postgres"`. O sea que `--rol postgres-superusuario` llegaría al `ALTER ROLE`. El
> inventario dice `nunca-desde-el-nodo` por un motivo que sigue en pie: el guion se
> autentica contra el motor **con el mismo superusuario que estaría cambiando**, y el
> guion de inicialización sólo lo asigna una vez, con el volumen vacío.
>
> **(b) `rol_ingestor_catastro` está `NOLOGIN` en `prod`.** Medido: `pg_roles` da
> `rolcanlogin = f`, y abrir una sesión con el valor que guarda su `Secret` contesta
> `FATAL: role "rol_ingestor_catastro" is not permitted to log in`. La causa es que
> `20-asignar-claves.sh` —el que corre al inicializar el volumen— sólo da `LOGIN` a
> `kamayuk_owner`, `kamayuk_app` y `rol_carga_parametros`, y el `Deployment` del motor no
> monta `clave-ingestor`. Rotarlo hoy ejecuta un `ALTER ROLE ... PASSWORD` que funciona y
> deja el rol **igual de incapaz de conectarse**, así que la comprobación 2 de abajo
> saldría roja sobre una rotación correcta. El remedio es
> [`asignar-claves.sh`](../../../infra/secretos/asignar-claves.sh), que hace
> `ALTER ROLE :"rol" LOGIN PASSWORD :'clave'`.

Lo que **no** admite este guion, porque no es una clave de un rol del motor:
`keycloak-admin`, `administrador-del-realm`, `respaldo-cifrado`, `grafana-admin` y las
ocho `servicio-<sistema>-<ubigeo>`. Van en «Si no sale bien».

### 2. Rotar

```bash
infra/secretos/rotar-clave.sh --ambiente <amb> --rol kamayuk-app
```

Contra la base **en marcha**, el guion: genera un valor nuevo (32 bytes al azar); ejecuta
`ALTER ROLE :"rol" PASSWORD :'nueva'` por `kubectl exec` contra
`deployment/kamayuk-<amb>-postgres`, con sustitución segura de variables de `psql` y
nunca interpolado en el texto del SQL; actualiza **sólo esa clave** del `Secret` con
`kubectl patch --type=merge`; y reprograma el `Deployment` de la columna «A quién
reprograma», si lo hay.

**No imprime ningún valor.** Tampoco lo hace este runbook: donde hay que comparar claves
se comparan huellas, nunca contenidos.

> **Que «sólo esa clave» no es un detalle.** Medido en `prod`, de los `Secret` que este
> guion puede tocar **dos guardan más de una clave**: `kamayuk-<amb>-keycloak` guarda
> **tres** —`clave-administrador`, `clave-base` y `clave-del-administrador`—, y
> `kamayuk-<amb>-postgres-respaldo` guarda dos
> —`clave-respaldo` y `clave-cifrado`—. El documento del archivo decía «dos» de la
> primera: `clave-del-administrador` es de #77 y no existía. Un `patch` que reemplazara
> el objeto en vez de fusionarlo se llevaría por delante la clave de cifrado de los
> respaldos, que es la única que **no se puede regenerar**.

### 3. Converger los espejos — el paso que no estaba, y sin el cual los cinco se rompen

`rotar-clave.sh` escribe en **un** `Secret`: el de la plataforma. Los cinco sistemas no
leen ése — leen una **copia** en su propio namespace, porque un `Secret` no cruza
espacios de nombres. Medido en `prod`, el inventario declara **37 entradas**: 20 en
`kamayuk-prod` y **17 espejos** repartidos en los cinco namespaces de sistema.

| Origen (plataforma) | Espejos |
|---|---|
| `kamayuk-<amb>-postgres-app` / `clave-app` | `kamayuk-<sistema>-<amb>-app` / `clave`, en los **cinco** |
| `kamayuk-<amb>-postgres-owner` / `clave-owner` | `kamayuk-<sistema>-<amb>-owner` / `clave`, en los **cinco** |
| `kamayuk-<amb>-postgres-ingestor-catastro` / `clave-ingestor` | `kamayuk-rentas-<amb>-ingestor` / `clave` |

Así que tras el paso 2 los espejos tienen el valor **viejo**, y con él ya no se abre
ninguna sesión. Se convergen volviendo a correr el bootstrap, que copia los espejos desde
su origen en **cada** corrida y no sólo cuando faltan:

```bash
infra/secretos/bootstrap-secretos.sh --ambiente <amb>
```

**Entre el paso 2 y éste hay una ventana real**, y tiene quien la note: los cuatro
`CronJob` `kamayuk-<sistema>-consumidor-de-identidad` corren `*/5 * * * *` y cada
ejecución crea un pod nuevo que lee el `Secret` del momento. Un pod que arranque en esa
ventana muere con `password authentication failed`. Los dos pasos van seguidos.

### 4. Reprogramar a los cinco

`kamayuk-app` no declara `requiereReinicioDe`, y es deliberado: ese campo nombra **un**
`Deployment` y desde ADR-0031 los consumidores son cinco. Ponerlo diría que la rotación
se cierra reprogramando ése, y dejaría a los otros cuatro con la clave anterior hasta su
siguiente reinicio. Se nombran aquí:

```bash
for s in identidad rentas catastro normativa caja; do
  kubectl -n "kamayuk-$s-<amb>" rollout restart "deployment/kamayuk-$s-web"
  kubectl -n "kamayuk-$s-<amb>" rollout status  "deployment/kamayuk-$s-web" --timeout=180s
done
```

Los cinco son `RollingUpdate`, así que ninguno corta servicio al reprogramarse. Las
`interfaz` (`kamayuk-rentas-interfaz`, `kamayuk-caja-interfaz`) **no** entran: medido, no
montan ninguna credencial del motor. Los `CronJob` tampoco: crean un pod nuevo en cada
corrida y leen el `Secret` ya convergido.

## Cómo se comprueba que terminó bien

**No** «`rollout restart` terminó sin error». Cuatro comprobaciones, y la primera es nueva.

**1 · Los espejos coinciden con su origen.** Se comparan **huellas**, nunca valores:

```bash
h() { kubectl -n "$1" get secret "$2" -o jsonpath="{.data.$3}" | base64 -d | sha256sum | cut -c1-12; }

h kamayuk-<amb> kamayuk-<amb>-postgres-app clave-app
for s in identidad rentas catastro normativa caja; do
  h "kamayuk-$s-<amb>" "kamayuk-$s-<amb>-app" clave
done
```

Las seis líneas tienen que imprimir **la misma huella**. Medido en `prod` el 2026-09-12,
antes de tocar nada: **los seis espejos de `app` coinciden, los seis de `owner` coinciden
y el par del ingestor también** — los tres grupos, uno a uno. Si una difiere, el paso 3
no se completó y ese sistema se quedará sin base en su próximo arranque.

> **Las huellas medidas no se escriben aquí, y es una decisión.** Una huella de una clave
> viva es un oráculo de verificación, y además caduca en la primera rotación: quedaría un
> número que ya no es de nadie invitando a compararse contra él. Lo que se anota es que
> los tres grupos coincidían; el número lo recalcula quien comprueba, con el comando de
> arriba.

**2 · El rol abre una sesión nueva, contra SU base.** Desde dentro del pod del motor, que
es donde el `loopback` no pasa por ninguna `NetworkPolicy`:

```bash
P=$(kubectl -n kamayuk-<amb> get secret kamayuk-<amb>-postgres-app -o jsonpath='{.data.clave-app}' | base64 -d)
kubectl -n kamayuk-<amb> exec deploy/kamayuk-<amb>-postgres -c postgres -- \
  env PGPASSWORD="$P" psql -h 127.0.0.1 -U kamayuk_app -d rentas -Atc 'SELECT 1'
unset P
```

**La base importa, y no es una preferencia.** Medido: `kamayuk_respaldo`,
`kamayuk_monitor` y `rol_carga_parametros` contra `rentas` contestan los tres
`FATAL: permission denied for database "rentas"` — no tienen `CONNECT` sobre el padrón a
propósito (C-7 §6), así que comprobarlos ahí daría rojo sobre una credencial buena. La
columna «Base donde se comprueba» de §1 es la que vale.

> **El pod efímero del documento del archivo NO funciona hoy, y el fallo es mudo.** Decía
> `kubectl -n sgtm-<amb> run verificar-rotacion --image=postgres:16 …`. Medido: el
> namespace de la plataforma tiene una `NetworkPolicy` **`denegar-todo`** con
> `podSelector: {}` y `policyTypes: [Ingress, Egress]`, así que un pod creado ahí no
> alcanza el 5432 de nadie — se queda en tiempo de espera, que se lee como «el motor no
> responde». Si hace falta un pod efímero, va en un **namespace de sistema**: los cinco
> llevan la etiqueta `kamayuk-sistema: si`, que es de quien
> `permitir-ingreso-postgres` acepta tráfico al 5432. Y la imagen es la que el nodo ya
> tiene —`postgis/postgis:16-3.4-alpine`, medida en el `Deployment` del motor—, no
> `postgres:16`, que obligaría a una descarga.

**3 · Nadie está fallando la autenticación.** El `Deployment` del archivo
(`sgtm-<amb>-aplicacion`) no existe; son cinco:

```bash
for s in identidad rentas catastro normativa caja; do
  echo -n "kamayuk-$s-web: "
  kubectl -n "kamayuk-$s-<amb>" logs "deploy/kamayuk-$s-web" --tail=2000 | grep -c "28P01"
done
```

Línea base medida en `prod` el 2026-09-12: **0 en los cinco**. Una línea nueva de `28P01`
tras la rotación significa que un pod arrancó con el espejo sin converger.

**4 · Las cuatro colas de identidad siguen vaciándose.** Es la comprobación de punta a
punta, y la que nota lo que las otras tres no: un consumidor que no puede abrir la base
falla **en su propio pod**, no en ninguno de los cinco `web`.

```bash
kubectl get job -A | grep consumidor-de-identidad | tail -8
```

Tienen que aparecer `Complete`. Si aparecen `Failed`, revisar el espejo de ese namespace.

## Si no sale bien

| Síntoma | Qué hacer |
|---|---|
| El rol pedido no es un rol del motor (`keycloak-admin`, `administrador-del-realm`, `respaldo-cifrado`, `grafana-admin`, `servicio-<sistema>-<ubigeo>`) | `rotar-clave.sh` los rechaza con «no es una clave de PostgreSQL — no hay ALTER ROLE que ejecutar», y tiene razón. El **administrador de Keycloak** es `kcadm.sh set-password` contra el propio Keycloak; el **del realm** se entrega temporal y sólo se repone si su dueño nunca llegó a entrar (`administrador-del-realm`, periodicidad `tras-incidente`); la **clave de cifrado del respaldo** deja ilegibles los respaldos ya escritos, así que su procedimiento exige conservar la vieja hasta que caduque el último; y las **ocho de las cuentas de servicio** se rotan volviendo a correr el `Job` de identidad, que es quien se las fija a su cliente confidencial |
| El rol pedido es `postgres-superusuario` | El guion **lo acepta** —§1 (a)— y no debe. Es `nunca-desde-el-nodo` |
| `ALTER ROLE` falla con `permission denied` | El `kubectl exec` no está llegando al contenedor `postgres`. El pod del motor tiene **tres** (`postgres`, `postgres-exporter` y el `init` de wal-g) y no declara contenedor por omisión: `kubectl` elige el primero e imprime `Defaulted container "postgres" out of: …` por `stderr`. Si el mensaje nombra otro, poner `-c postgres` |
| Un sistema arranca en `CrashLoopBackOff` con `password authentication failed` | Su espejo no convergió. Es el paso 3: `bootstrap-secretos.sh --ambiente <amb>`, y después el `rollout restart` de ese sistema |
| La comprobación 2 dice `role … is not permitted to log in` | El rol está `NOLOGIN`. Medido en `prod`: es el estado de `rol_ingestor_catastro`. `asignar-claves.sh --ambiente <amb>` le da `LOGIN` y le lleva la clave del inventario |
| La comprobación 2 dice `permission denied for database` | Se está comprobando contra la base equivocada. La correcta es la de §1, y sale del inventario (`baseDeDatos`), no de una suposición |
| Rotaste `kamayuk-monitor` y se cayó todo | Era previsible y está en §1: esa entrada declara `requiereReinicioDe` sobre el **motor**, que es de una réplica y `Recreate`. Esperar a que vuelva (`rollout status`) y comprobar los cinco sistemas |

## Estado del ensayo

**Ensayado, contra un motor real, y desde `E` en CI.** `infra/secretos/verificar-rotacion.sh`
abre una sesión, rota la clave y comprueba las tres cosas —la sesión abierta sigue, una
conexión nueva con la vieja falla, una conexión nueva con la nueva funciona—. Es lo que
demuestra que `ALTER ROLE` no cierra sesiones abiertas, el hecho que sostiene todo este
runbook.

> El documento del archivo decía «**corrido a mano (ningún workflow lo invoca todavía)**»,
> y hoy es falso: `.github/workflows/infra.yml` lo ejecuta en el trabajo del motor, para
> los **dos** roles del inventario que tenían `LOGIN` y clave cuando se escribió
> (`kamayuk_app` y `rol_carga_parametros`). Corregido, medido el 2026-09-12.

**NO ensayado, y el motivo es que la rotación es destructiva.** Este trabajo era de sólo
lectura sobre `prod`: no se rotó ninguna clave, no se corrió `bootstrap-secretos.sh`, no
se reprogramó ningún `Deployment` y no se creó ningún pod. Rotar `kamayuk-app` en el
`prod` que sirve hoy habría cortado las conexiones nuevas de los cinco sistemas para
ensayar un documento, que es exactamente el coste que un runbook existe para evitar.

**Lo que sí se midió contra `prod` (`vmd206041`, 2026-09-12), y de dónde sale cada
afirmación de arriba:** el inventario completo (37 entradas, 20 en la plataforma y 17
espejos); los nombres y las claves de los `Secret` de los seis namespaces, leídos con
`-o json | jq '.data | keys'` — **sólo nombres, ningún valor**; qué `Deployment`,
`CronJob` y `Job` monta cada clave; que los ocho roles con `rolDePostgres` son los que el
propio guion acepta; que seis de siete credenciales abren sesión contra su base y
`rol_ingestor_catastro` no; que tres roles reciben `permission denied` sobre el padrón;
que los seis espejos de `app`, los seis de `owner` y el par del ingestor coinciden con su
origen por huella `sha256`; las sesiones abiertas por rol y base; las estrategias y
réplicas de los `Deployment`; y las `NetworkPolicy` que impiden el pod efímero del
documento original.

**Lo que sigue sin ensayarse en ningún sitio:** el camino completo `kubectl exec` +
`kubectl patch` + `bootstrap-secretos.sh` + `rollout restart` **de los cinco**, contra un
clúster real con los cinco sistemas sirviendo peticiones. Eso es una rotación de verdad y
pide una ventana acordada con quien opera el ambiente (D-22).

## Documentos relacionados

[`infra/componentes/secretos.ts`](../../../infra/componentes/secretos.ts) — el inventario,
que es la **fuente única**: la periodicidad, el `Secret`, la clave, el rol de PostgreSQL,
la base y los espejos salen de ahí. (`INF-06`, que lo narraba en prosa, sigue en el
repositorio archivo: está declarado como pendiente de traer en
[`lo-que-el-codigo-cita-existe.test.ts`](../../../infra/verificaciones/lo-que-el-codigo-cita-existe.test.ts),
así que **no se enlaza a un archivo que no está aquí**.) ·
[`infra/secretos/rotar-clave.sh`](../../../infra/secretos/rotar-clave.sh) ·
[`infra/secretos/bootstrap-secretos.sh`](../../../infra/secretos/bootstrap-secretos.sh) ·
[`infra/secretos/asignar-claves.sh`](../../../infra/secretos/asignar-claves.sh) ·
[`infra/secretos/verificar-rotacion.sh`](../../../infra/secretos/verificar-rotacion.sh) ·
[`infra/bases.sh`](../../../infra/bases.sh) (qué base es cuál) ·
[C — los roles de PostgreSQL](../../00-gobierno/C-los-roles-de-postgresql.md) (por qué un
rol es del clúster y se renombra en los cinco a la vez) ·
[C-7 §6](../../00-gobierno/C-7-que-arranquen.md) y
[`quien-se-conecta-a-cada-base.test.ts`](../../../infra/verificaciones/quien-se-conecta-a-cada-base.test.ts)
(quién tiene `CONNECT` sobre qué) ·
[ADR-0011](../../30-arquitectura/adr/ADR-0011-infraestructura-como-codigo.md) §3 (Pulumi
no crea secretos) y §6 (la deriva manual) ·
[ADR-0031](../../30-arquitectura/adr/ADR-0031-infraestructura-comun-y-propia.md) (un
`Secret` no cruza namespaces) ·
[Abrir la consola de Keycloak](abrir-la-consola-de-keycloak.md) ·
[Mudar un ambiente de nodo](../../00-gobierno/mudar-un-ambiente-de-nodo.md)
