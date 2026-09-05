# D — el plan del renombrado desplegado: `sgtm` → `kamayuk` en los dos ambientes

**Estado:** plan. **No se modificó ni una línea de código ni se aplicó nada a ningún clúster.**
Todo lo que sigue son lecturas, `EXPLAIN`-equivalentes de solo lectura sobre Pulumi, consultas
`SELECT` contra el motor de `stg`, y un laboratorio de Pulumi levantado en un backend de fichero
desechable. Las órdenes están escritas al lado de cada cifra.

Este documento cierra la etapa **D** de las cuatro en que se partió el renombrado. **A y B están
aplicadas** ([R-A/B](R-AB-el-renombrado-del-codigo.md)); **C —los roles de PostgreSQL— no**, y
§3.1 dice por qué eso decide el orden de todo lo demás.

---

## 0 · Tres cosas que la medición corrige del enunciado

Antes del inventario, porque cambian el plan entero.

### 0.1 · El estado de Pulumi **no** hay que tirarlo. `pulumi stack rename` lo migra.

El encargo dice: «el nombre del proyecto está dentro de cada URN, así que un proyecto `kamayuk`
nace con estado vacío y `pulumi up` intentaría crear lo que ya existe». **La primera mitad es
cierta y la segunda no**, y la diferencia son 159 recursos.

`pulumi stack rename` acepta un nombre **totalmente cualificado que incluye el proyecto**, y
reescribe los URN. Medido en un backend de fichero desechable con un estado importado a mano
(`/private/tmp/.../D-lab3`, `pulumi v3.256.0`):

```
$ pulumi stack export --stack ensayo | jq -r '.deployment.resources[].urn'
urn:pulumi:ensayo::sgtm::pulumi:pulumi:Stack::sgtm-ensayo
urn:pulumi:ensayo::sgtm::kubernetes:core/v1:Namespace::sgtm-ensayo-ns

$ pulumi stack rename organization/kamayuk/ensayo --stack ensayo
Renamed ensayo to organization/kamayuk/ensayo

$ pulumi stack export --stack ensayo | jq -r '.deployment.resources[].urn'
urn:pulumi:ensayo::kamayuk::pulumi:pulumi:Stack::kamayuk-ensayo
urn:pulumi:ensayo::kamayuk::kubernetes:core/v1:Namespace::sgtm-ensayo-ns
```

Tres cosas que leer ahí, y las tres importan:

1. **El segmento de proyecto de todos los URN se reescribe.** No hay estado vacío, no hay
   recursos huérfanos, no hay nada que Pulumi quiera volver a crear.
2. **El nombre lógico del recurso raíz `Stack` cambia solo** (`sgtm-ensayo` → `kamayuk-ensayo`),
   porque ese nombre es `<proyecto>-<stack>` por construcción. Coincide con lo que el programa
   generará después: no produce diferencia.
3. **Los nombres lógicos de los recursos hijos NO cambian** (`sgtm-ensayo-ns` sigue igual). Salen
   de `resourceName()` en `config.ts`, no del nombre del proyecto.

De ahí sale la separación que gobierna todo este plan: **renombrar el proyecto y renombrar los
recursos son dos actos independientes**, con coste y riesgo muy distintos. El primero es
gratis y reversible; el segundo reemplaza objetos de Kubernetes.

### 0.2 · Renombrar el proyecto sin renombrar las claves falla, y el mensaje apunta al sitio equivocado

`infra/config.ts:1031` instancia `new pulumi.Config()` **sin argumento**, así que el espacio de
configuración **es** el `name:` de `Pulumi.yaml`. Medido en el mismo laboratorio, con el proyecto
ya llamado `kamayuk` y el archivo del stack todavía con claves `sgtm:`:

```
$ pulumi config --stack ensayo
KEY          VALUE
sgtm:domain  valor-viejo          ← se SIGUE listando

$ pulumi config get domain --stack ensayo
error: configuration key 'domain' not found for stack 'ensayo'
```

O sea: **`pulumi config` sigue enseñando la clave y el programa no la ve.** Es la forma exacta del
fallo mudo de [C-18 §5](C-18-el-compose-de-los-cuatro.md). Aquí **no** llega a ser mudo, porque
`requireText` lanza `MissingConfigError` en la primera clave obligatoria — pero el mensaje
(`config.ts:454`) está escrito a mano:

```ts
`Falta el valor obligatorio «sgtm:${key}» en la configuración del stack. `
```

Con el proyecto renombrado, ese texto dice `«sgtm:domain»` cuando la clave que falta se llama
`kamayuk:domain`. Manda a buscar al sitio equivocado. Entra en el mínimo indivisible de §3.2.

### 0.3 · Los cuatro sistemas no están desplegados, y sus bases **no existen**

Esto no estaba en el enunciado y cambia lo que significa «desplegar de cero».

```
$ kubectl -n sgtm-stg exec sgtm-stg-postgres-66fdd958fb-z8pht -c postgres -- \
    psql -U postgres -tAc "SELECT datname FROM pg_database WHERE datistemplate=false ORDER BY 1;"
keycloak
postgres
sgtm
```

Ni `rentas`, ni `catastro`, ni `normativa`, ni `caja`. Y en ninguno de los dos clústeres existen
los espacios de nombres `kamayuk-<sistema>-<ambiente>`:

```
$ kubectl get ns                      # stg y prod, misma respuesta salvo el sufijo
default  kube-node-lease  kube-public  kube-system  sgtm-<ambiente>
```

Pero **los manifiestos sí los declaran** desde C-14/C-17:

```
$ yarn --silent manifiestos --ambiente stg   →  94 objetos
   namespaces: {null: 10, 'sgtm-stg': 57, 'kube-system': 1,
                'kamayuk-rentas-stg': 7, 'kamayuk-catastro-stg': 7,
                'kamayuk-normativa-stg': 6, 'kamayuk-caja-stg': 6}
$ yarn --silent manifiestos --ambiente prod  → 101 objetos (64 en `sgtm-prod`)
```

Quien crea las cuatro bases es `05-crear-bases.sh`, que Pulumi monta en
`/docker-entrypoint-initdb.d` (`BaseDeDatos.ts:149`) — y ese directorio **solo se ejecuta con el
directorio de datos vacío**. Es el hueco que `despliegue/crear-extensiones.sh` documenta para las
extensiones… **y para las bases no hay guion equivalente**. El propio encabezado de ese guion dice
cuál es el camino recomendado hoy:

> «Cuando el volumen se puede rehacer. Con el directorio de datos vacío, `crear-roles.sql` vuelve a
> correr entero […]: más simple, y mejor probado que esto. A día de hoy (2026-08-30) `stg` y `prod`
> solo tienen datos de prueba, así que ése es el camino recomendado.»

Eso es [ADR-0032 §3](../30-arquitectura/adr/ADR-0032-el-esquema-nace-en-baseline.md) —«mientras no
haya padrón real, cualquier base de cualquier ambiente se puede tirar y rehacer»— aplicado a este
plan. **La etapa D es la última ocasión barata de estrenar el nombre nuevo**, y de paso la primera
en que los cuatro sistemas llegan a un clúster.

---

## 1 · El inventario: qué cambia de nombre, con su cifra medida

### 1.0 · Cifra global

```bash
cd /Users/jorge/IdeaProjects/infrastructure
for d in infra despliegue herramientas .github; do rg -o --glob '!node_modules' --glob '!yarn.lock' 'sgtm' $d | wc -l; done
```

| Directorio | `sgtm` | `kamayuk` | Archivos con `sgtm` |
|---|---:|---:|---:|
| `infra/` | 917 | 466 | 95 |
| `despliegue/` | 114 | 143 | 13 |
| `herramientas/` | 42 | 0 | 5 |
| `.github/` | 52 | 3 | 4 |
| **Total** | **1 125** | 612 | 117 |

De las 917 de `infra/`, **298 son los roles de PostgreSQL** (etapa C, no D) y **315 son etapa D**
(217 nombres de recurso + 78 claves de configuración + 20 imágenes).

### 1.1 · Lo que cambia

| # | Categoría | Cifra medida | Dónde se genera | Orden con que se midió |
|---|---|---:|---|---|
| D1 | **`name:` del proyecto de Pulumi** | **1** | `infra/Pulumi.yaml:1` | `cat infra/Pulumi.yaml` |
| D2 | **Claves de configuración `sgtm:`** | **35** en stg, **29** en prod, **+4** que inyecta CI | `Pulumi.{stg,prod}.yaml` | `grep -c '^  sgtm:' Pulumi.stg.yaml` |
| D3 | **Espacio de nombres** | **2** (`sgtm-stg`, `sgtm-prod`) | `config.ts:1075` `namespaceName()` | `kubectl get ns` |
| D4 | **Nombres de recurso `sgtm-<amb>-<c>`** | **38** objetos en stg, **46** en prod | `config.ts:1080` `resourceName()`, 60 llamadas | ver §1.2 |
| D5 | **Etiqueta `proyecto: "sgtm"`** | **118** apariciones en el manifiesto de stg | `config.ts:1090` `commonLabels()` + **1 duplicado a mano** en `Red.ts:98` + **6** en `carga-de-datos/*.sh` | `grep -c '"proyecto": "sgtm"'` sobre el manifiesto |
| D6 | **`PriorityClass`** | **3** por ambiente = **6** | `convenciones.ts:170-206` `nombreDePrioridad()` + **3** literales en `carga-de-datos/*.sh` | `kubectl get priorityclass` |
| D7 | **`BASE_DEL_PADRON = "sgtm"`** | **1** constante, **8** usos, **~20** `--dbname=sgtm` a mano en guiones | `convenciones.ts:438` | `rg -- '--dbname=sgtm\b'` |
| D8 | **Buckets de respaldo** | **2** (`sgtm-stg-respaldos`, `sgtm-prod-respaldos`) **+1** referencia cruzada (`restoreSourceBucket`) | `Pulumi.*.yaml`, prefijo derivado en `convenciones.ts:736` | `pulumi config --stack stg` |
| D9 | **Imágenes del monolito** | **3** (`sgtm-aplicacion`, `sgtm-migrador`, `sgtm-interfaz`), **5** sitios que las componen | `Migracion.ts:250,321`, `Aplicacion.ts:131,222,307` | ver §1.3 |
| D10 | **`spring.application.name: sgtm`** | **4** declaraciones + **4** propagaciones a métrica + **4** consultas del tablero = **12** | `application.yaml:3` de los cuatro sistemas | `rg 'application\.name'` |
| D11 | **Ids de plugin de Gradle** | **89** usos, **20** ficheros que los declaran | `<repo>/backend/buildSrc/src/main/kotlin/sgtm.*.gradle.kts` | `rg -F 'id("sgtm.' \| wc -l` |
| D12 | **Literales `sgtm-` escritos a mano** | **116** en 32 archivos de `infra/` | — | `rg "[\"'\`]sgtm-" infra \| wc -l` |

**D11 conviene separarlo.** Los ids de plugin no son ni variable, ni propiedad, ni rol, ni nombre
de recurso: R-A/B §4.4 los dejó fuera de A, B, C y D declarándolos como etapa propia. Se listan
aquí porque el encargo los pide, pero **no entran en el despliegue**: un id que no case rompe la
configuración de Gradle en voz alta, no toca ningún clúster, y son 4 copias divergidas de
`buildSrc` (`md5` distinto en los cuatro repos), así que cabe en un commit por repositorio y en
cualquier momento. Meterlo en la ventana de despliegue solo añade superficie.

### 1.2 · El desglose de D4, medido sobre el manifiesto y no sobre el código

```bash
yarn --silent manifiestos --ambiente stg   # 94 objetos
```

| Prefijo del `metadata.name` | stg | prod |
|---|---:|---:|
| `sgtm-` | **38** | **46** |
| `kamayuk-` | **30** | **30** |
| sin prefijo | **26** | **25** |

Los 26 sin prefijo son 25 `NetworkPolicy` de nombre funcional (`denegar-todo`, `permitir-dns`,
`permitir-ingreso-postgres`…) más el `HelmChartConfig traefik`. **Cinco de esas `NetworkPolicy`
sí llevan el nombre dentro** (`permitir-salida-sgtm-stg-postgres-a-internet`,
`permitir-salida-sgtm-stg-respaldo`, …), y viven en el espacio de nombres, así que se van con él.

> La cifra «94 nombres de recurso con prefijo `sgtm-`» que aparece en R-A/B §6 cuenta **objetos
> del manifiesto**, no prefijos. Medido objeto a objeto son 38 de 94 en stg. Lo anoto porque las
> dos cifras son 94 y se confunden con facilidad.

### 1.3 · Los recursos de **ámbito de clúster**, que son los que no se van con el espacio de nombres

Extraídos del estado exportado (`pulumi stack export`), que es la única fuente que dice a la vez
qué gobierna Pulumi y qué ámbito tiene:

| Tipo | stg | prod | ¿Sobrevive al borrado del namespace? |
|---|---|---|---|
| `Namespace` | `sgtm-stg` | `sgtm-prod` | — es él |
| `PriorityClass` ×3 | `sgtm-stg-prioridad-{datos,servicio,lote}` | `sgtm-prod-prioridad-{…}` | **sí** |
| `ClusterRole` | `sgtm-stg-observabilidad-kube-state-metrics` | `sgtm-prod-…` | **sí** |
| `ClusterRoleBinding` | idem | idem | **sí** |
| `HelmChartConfig` | `traefik` **en `kube-system`** | `traefik` **en `kube-system`** | **sí, y no lleva el nombre** |

**El `HelmChartConfig traefik` es el único objeto que Pulumi gobierna cuyo nombre no deriva del
prefijo y que vive fuera del espacio de nombres del producto.** No cambia de nombre —y no debe—,
pero es el único que dos stacks podrían disputarse si alguna vez convivieran en un clúster. Aquí
no ocurre: cada ambiente tiene su nodo.

Ninguno de los 82 + 77 recursos tiene `protect` ni `retainOnDelete`:

```python
$ python3 -c "...; print([r.get('protect'), r.get('retainOnDelete') for r in res])"   # todos False
```

### 1.4 · Lo que **NO** cambia, y por qué

| Qué | Motivo |
|---|---|
| **Los roles de PostgreSQL** `sgtm_app`, `sgtm_owner`, `sgtm_readonly`, `sgtm_monitor`, `sgtm_respaldo` | Es la **etapa C**, no D. 2 456 menciones, casi todas dentro de los cuatro `V1__baseline.sql` y sus políticas de RLS. §3.1 explica por qué C tiene que ir **antes**. |
| **`WALG_*`** | Ninguna variable lleva el nombre: `WALG_S3_PREFIX` se **deriva** del bucket (`convenciones.ts:736`). Se mueven solas con D8. |
| **`HelmChartConfig traefik`** | Es de k3s, no del producto. |
| **`keycloak`, `postgres`** (bases) | No son del producto. |
| **`backend/sgtm-esquema/**` y `pe.gob.sgtm.*`** | Archivo histórico, con las 68 migraciones del monolito. R-A/B §4 lo dejó dicho: una migración aplicada es inmutable, editarla cambia su suma de Flyway. |
| **Los dos `COMMENT ON COLUMN` del baseline de `rentas`** | Mismo motivo. Hueco declarado en R-A/B, sigue abierto. |
| **`sgtm.example.pe`, `sgtm.local`, `sgtm.invalido`** | Nombres DNS de prueba y de correo. |
| **Las actas `docs/00-gobierno/C-*.md`** | Registran lo que se midió el día que se midió. Reescribirles los nombres falsificaría la medida. |
| **El repositorio `sgtm`** | Ni una línea. |

### 1.5 · El realm de Keycloak: cambia, pero **no en la etapa D**

R-A/B §4.6 lo dejó fuera de A y B —«renombrar un realm es un cambio de estado desplegado»—, y este
plan **lo deja fuera también de D**, con una recomendación explícita en §3.6. El inventario, para
que la decisión se tome con las cifras delante:

| Sitio | Literal |
|---|---|
| `infra/Pulumi.{stg,prod}.yaml` | `sgtm:keycloakRealm: sgtm` |
| `infra/config.ts:593` | `realm: reader.text("keycloakRealm") ?? "sgtm"` ← **valor por omisión** |
| `despliegue/identidad/realm-sgtm.json:2` | `"realm": "sgtm"` |
| `despliegue/identidad/reconciliar-identidades.sh:90` | `REALM="${KC_REALM:-sgtm}"` ← **valor por omisión** |
| `despliegue/identidad/crear-usuario.sh` | **`-r sgtm` escrito a mano ×6** |

El del ciudadano se **deriva** (`Identidad.ts:283`: `${realm}-ciudadano`), y los `clientId`
(`sgtm-backoffice`, `sgtm-portal`, `sgtm-verificacion`) son **datos del realm**, no derivados.

**Por qué esto es lo más peligroso del inventario.** El `iss` del token se compara contra el
emisor público en los cuatro sistemas, y el emisor lleva el realm dentro. Medido sobre el
manifiesto real de `stg`:

```
kamayuk-rentas-web:
  KAMAYUK_OIDC_EMISOR = https://sv-….elastika.pe/keycloak/realms/sgtm
  KAMAYUK_OIDC_JWKS   = http://sgtm-stg-identidad.sgtm-stg:8080/keycloak/realms/sgtm/…/certs
```

Y `SeguridadWeb.java:262` de los cuatro hace `setJwtValidator(createDefaultWithIssuer(emisor))`
**incluso cuando las claves vienen del JWKS interno**. Si el realm se renombra y **una sola** de
las cinco declaraciones no se mueve —y dos de ellas son valores por omisión que no fallan—, el
resultado es **401 en los cuatro sistemas a la vez, sin una línea que diga por qué**. Se hace
aparte, y con su propia ventana.

---

## 2 · El estado de Pulumi, resuelto

### 2.1 · Lo que hay hoy, medido

```
$ pulumi whoami   → jneyra
$ pulumi stack ls
NAME  LAST UPDATE  RESOURCE COUNT  URL
prod  6 days ago   77              https://app.pulumi.com/jneyra/sgtm/prod
stg   2 days ago   82              https://app.pulumi.com/jneyra/sgtm/stg
```

Los 82 + 77 recursos, por tipo, salen de `pulumi stack export`. En stg: 25 `NetworkPolicy`,
10 `Service`, 10 `Deployment`, 6 `ConfigMap`, 5 `Job`, 3 `PriorityClass`, 3 `PersistentVolumeClaim`,
3 `IngressRoute`, 2 `Secret`, 2 `CronJob`, 2 `Middleware`, y uno de cada de once tipos más.

Todos los URN tienen la forma `urn:pulumi:<stack>::sgtm::<tipo>::<nombre>`.

### 2.2 · Qué pasa exactamente con los 82 + 77 recursos

Con la medida de §0.1 delante, hay que separar **dos** renombrados que el enunciado trata como uno:

| | Acto | Efecto sobre el estado | Efecto sobre el clúster |
|---|---|---|---|
| **R1** | `name:` de `Pulumi.yaml` + `pulumi stack rename jneyra/kamayuk/<stack>` | Los **159** URN se reescriben en el segmento de proyecto. Cero recreaciones. | **Ninguno.** No se toca el clúster. |
| **R2** | `resourceName()` / `namespaceName()` / `commonLabels()` en `config.ts` | Los nombres lógicos cambian → Pulumi ve **recursos distintos**: borra los viejos y crea los nuevos. | **Reemplazo real** de los 38/46 objetos con prefijo, del espacio de nombres y de lo que contiene. |

**R1 no produce huérfanos y R2 sí puede.** Los tres mecanismos por los que R2 los produce:

1. **Lo que Pulumi no gobierna.** Medido en el clúster: de los **10** `Secret` de `sgtm-prod`,
   solo **2** llevan `gestionado-por=pulumi`; los otros 8 los crea `bootstrap-secretos.sh`
   (ADR-0011 §3). Al borrar el espacio de nombres se van los 10, y `pulumi up` recrea **2**.
2. **Lo de ámbito de clúster.** Las 3 `PriorityClass`, el `ClusterRole` y el `ClusterRoleBinding`
   **no** se van con el espacio de nombres. Pulumi sí los borra —están en su estado—, pero si el
   `up` se interrumpe entre el borrado del espacio y la creación de los nuevos, quedan los viejos
   sin dueño.
3. **Lo que nunca estuvo en el estado.** Medido: en `sgtm-stg` hay un `Secret` llamado
   **`ghcr-pull`**, creado el 2026-08-24, **sin etiquetas, sin anotaciones y fuera de las dos
   convenciones de nombre**. No lo declara el inventario de secretos, no lo gobierna Pulumi y no
   lo recrea nada. Hoy es inofensivo —hay un `sgtm-stg-registro-credenciales` que sí lo está—,
   pero es la prueba de que el espacio de nombres contiene cosas que ningún stack conoce.

### 2.3 · La respuesta: **R1 primero, R2 después, y R2 sobre un volumen nuevo**

**El orden en que se retira lo viejo es: no se retira. Se adopta.**

```bash
# R1 — gratis, reversible, sin tocar el clúster.
cd infrastructure/infra
pulumi stack rename jneyra/kamayuk/stg  --stack stg
pulumi stack rename jneyra/kamayuk/prod --stack prod
sed -i '' 's/^name: sgtm/name: kamayuk/' Pulumi.yaml
sed -i '' 's/^  sgtm:/  kamayuk:/'       Pulumi.stg.yaml Pulumi.prod.yaml   # 35 y 29 claves
```

Tras esto, `pulumi preview` tiene que decir **sin cambios**: los URN nuevos coinciden con los que
el programa genera, y los nombres de recurso no se han tocado. **Ése es el criterio de que R1
salió bien**, y es comprobable sin desplegar.

Después, R2 en un commit aparte, con el `up` correspondiente.

**Cómo se evita quedarse con huérfanos, punto por punto:**

| Riesgo | Qué se hace |
|---|---|
| Los 8 secretos que Pulumi no gobierna | **Se copian antes** (`kubectl get secret -o yaml`), se editan el `metadata.name` y `metadata.namespace`, y se aplican en el espacio nuevo. **No se regeneran** — §3.3 dice por qué. |
| Los recursos de ámbito de clúster | Se comprueban **a mano** después del `up`: `kubectl get priorityclass,clusterrole,clusterrolebinding \| grep sgtm-` tiene que salir vacío. |
| `ghcr-pull` y cualquier otro objeto no gobernado | Se inventaría **antes**: `kubectl -n sgtm-<amb> get all,secret,cm,pvc -o name` y se compara con `pulumi stack export`. Lo que esté en el clúster y no en el estado se decide una a una. |
| El proyecto `sgtm` vacío en Pulumi Cloud | Tras el rename **no queda ningún stack en él**. `pulumi stack ls --all` lo confirma. |

**Lo que no se puede evitar y hay que saber:** `pulumi stack rename` es una operación del backend,
no de un `up`. Si se hace R1 y alguien lanza el flujo de CI **antes** de que `Pulumi.yaml` esté
mezclado en `main`, el `pulumi config set --secret --stack stg` de `infra.yml:846` no encontrará
el stack (`error: no stack named 'stg' found`, medido en el laboratorio con la misma asimetría).
Es un fallo ruidoso, pero deja la corrida roja. **R1 y el cambio de `Pulumi.yaml` van en el mismo
commit y se aplican con CI parado.**

### 2.4 · Lo que CI **no** hay que tocar

Medido: `.github/workflows/infra.yml` **nunca nombra el proyecto**. Sus 11 usos del kubeconfig y
sus 16 `pulumi config set` usan solo `--stack stg` / `--stack prod`, y corren con
`working-directory: infrastructure/infra`, donde `Pulumi.yaml` aporta el proyecto.

```bash
$ grep -n -- "--stack\|jneyra/" .github/workflows/infra.yml | grep -c "jneyra/"
0
```

**CI no necesita ningún cambio por R1.** Sí lo necesita por R2 (los `--namespace sgtm-stg` de
`infra.yml:541-542`, y los literales de los guiones de `carga-de-datos/`).

---

## 3 · El orden de operaciones, y qué se rompe al revés

### 3.1 · **C va antes que D.** No es preferencia: es que D crea las bases.

El encargo lo plantea como pregunta y la medida la contesta. Del manifiesto real de `stg`:

```
kamayuk-rentas-web:  KAMAYUK_DB_USUARIO = sgtm_app
```

Los cuatro sistemas ya renombrados se conectan con el rol `sgtm_app`, que **es** la etapa C. Y ese
rol lo crean los `crear-roles.sql` de cada sistema, desde `/docker-entrypoint-initdb.d`, **con el
volumen vacío**.

Como el camino que este plan recomienda (§3.4) es **rehacer el volumen**, la secuencia es forzosa:

> Si D rehace el volumen y C no ha corrido, las cuatro bases nacen con los roles **viejos**, en
> políticas de RLS que quedan escritas para siempre en el `V1__baseline.sql` aplicado. Corregirlo
> después exige rehacer el volumen **otra vez**, o una migración que reescriba las políticas de
> las 60-y-pico tablas de cada sistema.

Y al revés no se rompe nada: C sobre el volumen actual no cambia lo desplegado, porque los
`V1__baseline.sql` ya aplicados no se vuelven a correr. **C primero, D después. Y si por lo que
sea D fuera primero, entonces D tiene que rehacer el volumen dos veces.**

Hay un matiz que conviene tener escrito: **C y D comparten el mismo acto físico** —vaciar el
volumen y dejar que la inicialización corra entera—. Hacerlas en el mismo despliegue es más barato
que hacerlas en dos, y no es más arriesgado, porque las dos fallan en el mismo sitio: el `Job` de
migración. Si se hacen juntas, el orden dentro del commit sigue siendo C antes que D por el motivo
de arriba.

### 3.2 · El mínimo indivisible de R2

Lo que tiene que ir en **un solo commit**, o el clúster queda en un estado que no se ve:

| Bloque | Sitios | Qué pasa si se olvida |
|---|---:|---|
| `config.ts:1076, 1080, 1090` | 3 | Es el cambio. Genera los 38/46 nombres. |
| `config.ts:454` (el mensaje `«sgtm:${key}»`) | 1 | El error apunta al espacio viejo (§0.2). |
| `Red.ts:98` (`proyecto: "sgtm"` duplicado a mano) | 1 | Una `NetworkPolicy` con la etiqueta vieja. |
| `carga-de-datos/{publicar-parametros,publicar-cuadros,abrir-conjunto-parametros}.sh` | 6 `proyecto:` + 3 `prioridad-lote` | **Kubernetes rechaza un pod cuya `PriorityClass` no existe.** Los tres guiones de publicación de valores normativos dejan de correr. |
| `convenciones.ts:438` `BASE_DEL_PADRON` + ~20 `--dbname=sgtm` | 21 | Renombrar una base es `ALTER DATABASE`, no un `sed`. Ver §3.4. |
| `descriptor/entorno.ts:48,56,58,65` | 4 | Los cuatro sistemas apuntan a `sgtm-<amb>-postgres.sgtm-<amb>` y a `sgtm-<amb>-prioridad-servicio`. **Las 18 objetos de los cuatro sistemas nombran el espacio de la plataforma**, medido en §3.5. |
| Las 5 imágenes `/sgtm-{aplicacion,migrador,interfaz}` | 5 | `ImagePullBackOff`. Ver §3.7. |
| `.github/workflows/infra.yml` (`--namespace sgtm-stg/prod`, nombres de secreto) | ~15 | Los pasos de verificación miran el espacio que ya no existe. |
| `despliegue/crear-extensiones.sh:157,161,162` | 3 | El guion de rescate apunta al espacio viejo. |
| Las guardas fósiles de §4.3 | 41 literales | **Tres pasan en verde sin comprobar nada.** |

### 3.3 · Los secretos: **se copian, no se regeneran**

Medido en los dos clústeres:

| | `sgtm-stg` | `sgtm-prod` |
|---|---:|---:|
| `Secret` presentes | **11** | **10** |
| …gobernados por Pulumi | 2 | 2 |
| …creados por `bootstrap-secretos.sh` | 8 | 8 |
| …fuera de toda convención | **1** (`ghcr-pull`) | 0 |

Y el inventario que `bootstrap-secretos.sh` compone (`yarn secretos --ambiente stg`) declara **21
entradas / 19 `Secret`**: **9 de la plataforma** (11 entradas: `…-keycloak` y `…-postgres-respaldo`
guardan dos claves cada uno) y **10 de los cuatro sistemas** (rentas 4, catastro 2, normativa 2,
caja 2). Las dos cifras del encargo son correctas y cuentan cosas distintas.

**Dos hallazgos que cambian el procedimiento:**

**(a) `sgtm-<amb>-postgres-ingestor-catastro` está declarado y NO existe en ningún clúster.** El
inventario lo lista (rol `rol_ingestor_catastro`, base `rentas`); `kubectl get secret` no lo
encuentra en stg ni en prod, y `SELECT rolname FROM pg_roles` en stg tampoco encuentra el rol.
Es un hueco declarado de C-7 §6 —«el proceso que consume esta credencial NO EXISTE todavía»—, no
un defecto del renombrado. Se anota porque `bootstrap-secretos.sh` **sí** lo creará en el
despliegue nuevo, y eso es un cambio respecto de hoy.

**(b) La clave de cifrado del respaldo no se puede regenerar.** `sgtm-<amb>-postgres-respaldo`
lleva `clave-cifrado`, que es `WALG_LIBSODIUM_KEY`. `INF-08 §4` y `CLAUDE.md` lo dicen: cambiarla
deja **ilegibles todos los respaldos escritos con la anterior**, y no hay `ALTER` que los vuelva a
cifrar. Su periodicidad en el inventario es literalmente `tras-incidente`.

En `prod` hay respaldos reales y recientes:

```
$ kubectl -n sgtm-prod logs job/sgtm-prod-respaldo-29809680
Respaldo #10 iniciado hacia s3://sgtm-prod-respaldos.
Respaldo #10 EXITOSO.
```

> **Verificado y descartado**: ese trabajo corrió el **2026-09-05 04:00 UTC** (el sufijo del
> `Job` son minutos desde la época) y el `Deployment` de PostgreSQL pasó a 0 réplicas a las
> **10:10 UTC** del mismo día. El respaldo se tomó con el motor **en marcha**. No hay aquí un
> «EXITOSO» sobre una base apagada, que es lo que parecía a primera vista.

**Procedimiento, entonces:** antes de borrar nada, para cada ambiente

```bash
kubectl -n sgtm-<amb> get secret -o yaml > secretos-<amb>-$(date +%F).yaml   # los 10/11
```

y tras crear el espacio nuevo, reinyectar los 8 de `bootstrap` con el nombre nuevo. Solo entonces
`bootstrap-secretos.sh` (que «genera lo que falte», nunca lo que ya está) completa lo que falte —
incluidos los **10 de los cuatro sistemas**, que hoy no existen.

**Lo que se pierde si se regeneran en vez de copiarse:** los 10 respaldos de `prod` y los de `stg`
quedan ilegibles. Es irreversible.

### 3.4 · Los `PersistentVolumeClaim`

Medido:

| Ambiente | PVC | Tamaño | Estado |
|---|---|---:|---|
| prod | `sgtm-prod-postgres-datos` | 100Gi | `Bound`, 9d |
| prod | `sgtm-prod-observabilidad-prometheus-datos` | 8Gi | `Bound` |
| prod | `sgtm-prod-observabilidad-grafana-datos` | 1Gi | `Bound` |
| stg | `sgtm-stg-postgres-datos` | 20Gi | `Bound`, 12d |
| stg | `sgtm-stg-observabilidad-{prometheus,grafana}-datos` | 8Gi / 1Gi | `Bound` |

Son **namespaced**: borrar el espacio de nombres los borra, y con ellos el `local-path` que los
respalda.

**Qué contienen, medido.** En `prod`, lo que dice el encargo: `municipalidad=1`, todo lo demás a
cero, `auditoria=741`. **No lo he vuelto a medir**: PostgreSQL está a 0 réplicas y levantarlo sería
un cambio, que este encargo no autoriza. Queda como dato del encargo, no como medida mía.

En `stg` sí lo medí:

```
municipalidad=3  contribuyente=2  predio=1  recibo=0  asientos=1  auditoria=1107  flyway=66
extensiones: btree_gist, pg_trgm, plpgsql, postgis, unaccent
```

**La decisión: se borran, y se rehace el volumen.** Tres motivos, en orden de peso:

1. **ADR-0032 §3.** No hay padrón real en ninguno de los dos. La ventana está abierta y este es
   exactamente el gasto para el que existe.
2. **Es el único camino que crea las cuatro bases** (§0.3). Sin volumen nuevo, `05-crear-bases.sh`
   no vuelve a correr y los cuatro sistemas no tienen dónde migrar. No hay guion de rescate para
   eso, como sí lo hay para las extensiones.
3. **Es el camino que CI ejercita en cada PR.** El propio `crear-extensiones.sh` lo dice: «más
   simple, y mejor probado que esto».

En `prod` hay además un motivo propio: **su motor no tiene PostGIS**.

```
prod:  ghcr.io/… + postgres:16.4-alpine        ← imagen EN MARCHA
       sgtm:postgresImage: postgis/postgis:16-3.4-alpine   ← lo declarado
stg:   postgis/postgis:16-3.4-alpine           ← en marcha, coincide
```

Es la deriva de #675: `prod` no se despliega desde el 2026-08-29. `catastro` necesita PostGIS
(ADR-0021), así que **`prod` necesita el volumen nuevo aunque no se renombrara nada**.

**Los de Prometheus y Grafana** se pierden también: son series históricas y un tablero. No hay
razón para conservarlos y no hay mecanismo barato para hacerlo.

### 3.5 · El acoplamiento cruzado: los cuatro sistemas nombran a la plataforma

Medido sobre el manifiesto de `stg`, objeto a objeto: **18 objetos** de los cuatro espacios
`kamayuk-*-stg` nombran recursos `sgtm-stg`.

```
Job         kamayuk-rentas-migracion-…     → sgtm-stg, sgtm-stg-postgres, sgtm-stg-prioridad-lote
Deployment  kamayuk-rentas-web             → sgtm-stg, sgtm-stg-identidad, sgtm-stg-postgres,
                                             sgtm-stg-prioridad-servicio
NetworkPolicy kamayuk-rentas-egreso        → sgtm-stg
…y lo mismo para catastro, normativa y caja
```

**Todos salen de `descriptor/entorno.ts`**, que llama a `namespaceName()` y `nombreDePrioridad()`
de `config.ts`. Así que R2 los mueve solos — **siempre que `entorno.ts` no tenga ningún literal
propio**. Lo tiene: cuatro líneas (`:48,56,58,65`) que están en el mínimo indivisible de §3.2.

**Y una restricción de orden que Kubernetes impone:** un pod cuya `PriorityClass` no existe es
**rechazado en admisión**. Las `PriorityClass` son de ámbito de clúster y no se van con el espacio
de nombres, así que si el `up` borra `sgtm-stg-prioridad-servicio` antes de crear
`kamayuk-stg-prioridad-servicio`, los pods de los cuatro sistemas no se pueden ubicar. Pulumi
ordena por dependencias y aquí las hay, pero **conviene que el `up` cree los recursos de clúster
antes de borrar los viejos**, y eso no se puede dar por hecho: se comprueba con `pulumi preview`
leyendo el orden de las operaciones.

Hay un segundo efecto de la misma familia, y este es duro:
**`Deployment.spec.selector` es inmutable en `apps/v1`.** El selector es
`{ app: <nombre de recurso> }` (`Aplicacion.ts:120`, `Observabilidad.ts` ×10), así que cambiar el
nombre cambia el selector y Kubernetes rechaza el `apply` con *«field is immutable»*. Los
`Deployment` hay que **borrarlos y recrearlos**, no actualizarlos. Como el espacio de nombres
entero se borra, esto queda cubierto — pero **solo** porque se borra: un renombrado «en caliente»
sin borrar el espacio se atascaría aquí.

### 3.6 · Keycloak: qué se lleva D y qué no

**D no renombra el realm.** Lo que sí hace, inevitablemente:

- **El `Job` de reconciliación cambia de nombre**, `sgtm-<amb>-realm-<huella>` →
  `kamayuk-<amb>-realm-<huella'>`, y **la huella cambia también**, porque 9 de sus 10 partes
  llevan el nombre dentro (`Identidad.ts:938-954`). Eso es lo correcto: un `Job` con el mismo
  nombre **no volvería a correr** (`spec.template` es inmutable) y el realm nuevo no llegaría.
- **El realm se recrea entero**, porque la base `keycloak` vive en el volumen que se rehace. Los
  **2 usuarios declarados** (`municipalidades/200101.json`, `200105.json`) y el **1 ciudadano
  enrolado** (`ciudadanos/200101.json`, `dni-70123456`) se vuelven a crear desde los archivos: son
  declarativos y **sin una sola clave** (ADR-0012, ADR-0020 §6).
- **Todo token vivo se invalida**, y las claves de firma del realm son nuevas. En `prod` no hay
  nadie conectado (todo a 0 réplicas); en `stg` hay que avisar.
- **Las contraseñas de los usuarios se pierden.** En `prod` no hay relay SMTP declarado a propósito
  (ADR-0012, opción B), así que el enlace de `UPDATE_PASSWORD` **no se envía**: hay que usar el
  runbook «Recuperar el acceso de un usuario». En `stg` sí hay Mailpit.

> **El emisor no cambia** mientras el realm siga llamándose `sgtm`: es
> `https://<dominio>/keycloak/realms/sgtm`, y el dominio no es parte de D. Así que los cuatro
> sistemas siguen validando el mismo `iss`. **Eso es lo que hace que D sea seguro y que el realm
> merezca su propia etapa.** Lo único que cambia es el JWKS interno
> (`sgtm-<amb>-identidad.sgtm-<amb>` → `kamayuk-…`), que es un nombre de servicio y se mueve con
> R2.

### 3.7 · El registro de imágenes

| Imagen | Quién la usa | Estado |
|---|---|---|
| `ghcr.io/hneyra/sgtm-aplicacion` | monolito (solo `prod`; `stg` lo apagó en C-19) | existe |
| `ghcr.io/hneyra/sgtm-migrador` | monolito | existe |
| `ghcr.io/hneyra/sgtm-interfaz` | monolito | existe |
| `ghcr.io/hneyra/kamayuk-{rentas,catastro,normativa,caja}` | los cuatro sistemas | ya con el nombre nuevo (`entorno.ts:26,45`) |

**Los cuatro sistemas ya publican con el nombre nuevo. El monolito no.** Y medido:

```bash
$ rg 'docker build|docker push|build-push-action|docker/login' <cada repo>/.github/workflows/
# 0 resultados en los cinco repos
```

**Ningún flujo de estos cinco repositorios publica imágenes.** `publicar-imagenes.yml` —que los
comentarios de `Pulumi.*.yaml` nombran— **no está en `infrastructure`**. Así que renombrar
`sgtm-aplicacion` → `kamayuk-aplicacion` exige un cambio en un repositorio que este plan no ha
medido, y las imágenes nuevas tienen que existir en GHCR **antes** del `up`, o los pods quedan en
`ImagePullBackOff`.

**Recomendación: las tres imágenes del monolito no se renombran en D.** Motivos: (a) el monolito
solo se despliega en `prod` y su retirada está en discusión (ADR-0029, D-22); (b) el renombrado
exige tocar un flujo que no está aquí; (c) el nombre de una imagen no gobierna nada más. Es la
misma clase de decisión que R-A/B tomó con los ids de Gradle: cabe en una etapa propia.

### 3.8 · La secuencia, paso a paso

Con CI parado (`infra.yml` es el único que despliega).

| # | Paso | Ambiente | Reversible |
|---:|---|---|---|
| 0 | Inventariar lo que el estado no gobierna: `kubectl -n sgtm-<amb> get all,secret,cm,pvc -o name` contra `pulumi stack export` | los dos | — |
| 1 | **Copiar los secretos** a disco (§3.3). Sin esto no hay vuelta atrás para los respaldos | los dos | — |
| 2 | **Etapa C**: renombrar los roles en los cuatro `V1__baseline.sql` y en `crear-roles.sql` | — | sí (es código) |
| 3 | **R1**: `pulumi stack rename` ×2 + `Pulumi.yaml` + las 64 claves. `pulumi preview` = sin cambios | los dos | **sí** (renombrar de vuelta) |
| 4 | **R2**: el mínimo indivisible de §3.2, en un commit | — | sí (es código) |
| 5 | `yarn verificar` + `yarn manifiestos` + `yarn capacidad --ambiente prod --estricto` | — | — |
| 6 | Aplicar en **`stg`**: `pulumi up`. Esto borra el espacio viejo y su volumen | stg | **no** (los datos) |
| 7 | Reinyectar los 8 secretos copiados con el nombre nuevo; `bootstrap-secretos.sh` completa los 10 de los sistemas | stg | — |
| 8 | Comprobar §4 entero en `stg` | stg | — |
| 9 | Repetir 6-8 en **`prod`** | prod | **no** |
| 10 | Limpiar: `kubectl get priorityclass,clusterrole,clusterrolebinding \| grep sgtm-` vacío en los dos | los dos | — |

**`stg` es la puerta, y no es una recomendación:** `aplicar-prod` tiene `needs: aplicar-stg`.

**Qué se rompe al revés.** Si D va antes que C: las cuatro bases nacen con roles viejos dentro de
políticas de RLS ya aplicadas (§3.1). Si R2 va antes que R1: `pulumi up` sobre el proyecto `sgtm`
borra y crea 84 objetos, y luego R1 hay que hacerlo igual. Si se despliega `prod` antes que `stg`:
se pierde el único ensayo, y la deriva de #675 dice que `prod` lleva 7 días sin desplegarse — el
`up` de `prod` va a traer **además** el cambio de imagen del motor a PostGIS, la retirada del
monolito si se decidiera, y los cuatro sistemas. Es el `up` más grande que este proyecto ha hecho.

---

## 4 · Cómo se comprueba que salió bien, y cómo se vuelve atrás

### 4.1 · Las cifras concretas que hay que ver

**Tras R1, sin desplegar:**

```bash
pulumi stack ls                     # → https://app.pulumi.com/jneyra/kamayuk/{stg,prod}
pulumi preview --stack stg          # → "no changes"   ← el criterio
pulumi stack export --stack stg | grep -c '::kamayuk::'   # → 82
pulumi stack export --stack prod | grep -c '::kamayuk::'  # → 77
```

**Tras R2, sin desplegar:**

```bash
yarn manifiestos --ambiente stg | …  # 94 objetos: 0 con prefijo sgtm-, 68 con kamayuk-, 26 sin prefijo
yarn manifiestos --ambiente prod | … # 101 objetos: 0 con sgtm-, 76 con kamayuk-, 25 sin prefijo
yarn verificar                       # las 635+ de R-A/B, más lo que D añada
yarn capacidad --ambiente prod --estricto
```

> Las cifras 68 y 76 son **30 + 38** y **30 + 46**: los que ya eran `kamayuk-` más los que pasan a
> serlo. Si sale otra, hay un literal escrito a mano que se quedó.

**Tras el `up` de cada ambiente:**

| Qué | Orden | Valor esperado |
|---|---|---|
| Espacios de nombres | `kubectl get ns` | `kamayuk-<amb>` + los 4 `kamayuk-<sistema>-<amb>`; **ningún `sgtm-`** |
| Nada de clúster se quedó | `kubectl get priorityclass,clusterrole,clusterrolebinding \| grep sgtm-` | **vacío** |
| Las cuatro bases existen | `psql -tAc "SELECT datname FROM pg_database WHERE NOT datistemplate"` | `caja, catastro, keycloak, kamayuk, normativa, postgres, rentas` |
| Los roles son los nuevos | `psql -tAc "SELECT rolname FROM pg_roles WHERE rolname LIKE 'sgtm%'"` | **vacío** (etapa C) |
| Extensiones de catastro | `psql -d catastro -tAc "SELECT extname FROM pg_extension"` | incluye `postgis`, `btree_gist` |
| Los secretos | `kubectl -n kamayuk-<amb> get secret` | **9** de plataforma + los 2 de Pulumi |
| Los de los sistemas | `kubectl -n kamayuk-<sistema>-<amb> get secret` | rentas 4, resto 2 |
| **La fila que C-18 tuvo que ir a buscar** | `psql -d rentas -tAc "SELECT count(*) FROM municipalidad"` | **1**, y lo mismo en las otras tres |
| Los cuatro contestan | `curl -s -o /dev/null -w '%{http_code}' https://<dominio>/<sistema>/api/v1/nada` | **401** los cuatro; **404** para un prefijo inventado |
| Los tableros | `verificar-tableros.sh` | ningún panel «No data» |

**El criterio de aceptación no es «el `up` terminó en verde»**, por lo mismo que R-A/B: es la fila
de `municipalidad` en las cuatro bases. Un `Job` que sale con código 0 sin escribir nada es
exactamente el fallo de C-18.

### 4.2 · Cómo se vuelve atrás, y dónde no se puede

| Paso | Vuelta atrás |
|---|---|
| **R1** (rename + `Pulumi.yaml` + claves) | **Completa.** `pulumi stack rename jneyra/sgtm/<stack>` y revertir el commit. No se ha tocado ningún clúster. |
| **R2, antes del `up`** | **Completa.** Es código. |
| **Etapa C, antes del `up`** | **Completa.** Es código. |
| **El `up` de `stg`** | **NO.** El volumen se borró. Se recupera *rehaciéndolo*, no restaurándolo: `pulumi up` con el código anterior deja un ambiente equivalente, no el mismo. Se pierden `municipalidad=3, contribuyente=2, predio=1, auditoria=1107` y las series de Prometheus. Es demostración; ADR-0032 §3 dice que ese es el precio y que hoy vale cero. |
| **El `up` de `prod`** | **NO, y con un matiz.** Los datos son casi nada (`municipalidad=1`, `auditoria=741`), pero **el histórico de wal-g del bucket `sgtm-prod-respaldos` queda huérfano**: el motor nuevo arranca una cadena nueva. Los 10 respaldos siguen ahí y siguen siendo legibles **solo si se conservó `clave-cifrado`** (§3.3). Si se regeneró, no hay vuelta atrás de ninguna clase. |
| **El realm de Keycloak** | **NO.** Los tokens vivos mueren y las contraseñas se pierden. En `prod` sin relay SMTP, hay que fijarlas con el runbook. |
| **Los buckets S3** | **No se renombran en D** (§5). Si se renombraran: copiar objetos entre buckets es una operación de S3, no de Pulumi, y durante la ventana el RPO de 5 min de RNF-076 queda sin cubrir. |

**Lo que no tiene vuelta atrás y conviene decirlo solo:** el paso 6 es el punto de no retorno.
Todo lo anterior es código y texto.

### 4.3 · Las guardas que fosilizarían el nombre viejo

Es el patrón que en este proyecto ya mordió tres veces (R-A/B §2: `enlace-del-contrato.test.ts`,
`siembra-de-la-demostracion.ts`, `prefijo-de-la-implantacion.test.ts`) y una cuarta en #426
(`leerPatron`). **41 literales `sgtm-stg`/`sgtm-prod` en 6 ficheros de verificación.** Lo que
importa no es la cifra sino cuáles fallan **en voz alta** y cuáles **pasan en verde sin comprobar
nada**.

**Las tres silenciosas — y las tres guardan una propiedad real:**

| Archivo:línea | Guarda | Por qué pasa en verde |
|---|---|---|
| `infra/verificaciones/stacks.test.ts:62` | **«ningún stack versiona un secreto en claro»** | `expect(lineas.some(l => l.includes(\`sgtm:${clave}:\`))).toBe(false)`. Con el espacio en `kamayuk:`, el `includes` es **siempre falso** y el `toBe(false)` **pasa**. La guarda que impide que un kubeconfig se comitee en claro deja de mirar. |
| `infra/verificaciones/componentes.test.ts:487` | **Keycloak no toca la base del padrón** | `expect(vars.get("KC_DB_URL")?.endsWith("/sgtm")).toBe(false)`. Con `BASE_DEL_PADRON = "kamayuk"`, siempre falso → pasa. Su comentario dice qué protege: «eso sobre la base que sostiene RLS sería abrirle DDL al padrón». |
| `infra/verificaciones/componentes.test.ts:706` | **el cliente de acceso directo no llega a `prod`** | `expect(enProd).not.toContain("sgtm-verificacion")`. Si los `clientId` se renombran, siempre cierto → pasa. **Media guarda se salva**: la línea siguiente, `expect(enStg).toContain("sgtm-verificacion")`, sí se pone roja. La pareja es asimétrica, y la mitad que se calla es la de producción. |

**Las ruidosas** (se ponen rojas o lanzan, que es lo correcto): `config.test.ts:459, 520, 521, 526`,
`stacks.test.ts:87`, `completar-secreto.test.ts:103,104,110`, `descriptor.test.ts:49,51,53`,
`componentes.test.ts:356-359, 537, 667, 936, 1471, 1832-1834, 1980-1999, 2020-2054`,
`deriva-de-migraciones.test.ts:249`, `plataforma-compose.test.ts:229`.

**Y una que parecía peligrosa y no lo es**, medida:
`infra/herramientas/declarar-version.ts:158` lleva `const CLAVE = "sgtm:applicationBootstrapVersion:"`
—la automatización de #720 que escribe la línea de la versión—. Con el archivo en `kamayuk:`
encuentra **cero** líneas y **lanza**:

```
Se esperaba UNA linea «sgtm:applicationBootstrapVersion:» en … y hay 0. No se toca nada
```

Falla en voz alta, en `main`, y el mecanismo es aditivo: no escribe nada. Entra igual en el mínimo
indivisible, pero no es de la clase silenciosa.

> **La comprobación de que se ha mirado**, y es la que este proyecto pide: las tres silenciosas hay
> que **romperlas a propósito** después de renombrarlas, para ver que muerden. Si `stacks.test.ts`
> sigue en verde con un `kamayuk:kubeconfig: <valor>` metido a mano en `Pulumi.stg.yaml`, el
> renombrado de esa guarda no se hizo.

---

## 5 · Lo que este plan NO puede contestar

Sin adornos.

1. **No he medido el contenido de la base de `prod`.** El encargo da `municipalidad=1`,
   `contribuyente=0`, `predio=0`, `recibo=0`, `asientos=0`, `auditoria=741`. PostgreSQL está a 0
   réplicas y levantarlo es un cambio, que este encargo no autoriza. **Lo de `stg` sí lo medí.**

2. **No sé quién publica las imágenes.** `publicar-imagenes.yml` no está en ninguno de los cinco
   repositorios (`rg 'docker build|docker push|build-push-action'` da 0 en los cinco). Así que no
   puedo decir qué hay que tocar para publicar `kamayuk-aplicacion`, ni si las imágenes de los
   cuatro sistemas —que ya se llaman `kamayuk-*`— **existen en GHCR**. Sin eso, el `up` puede
   terminar en `ImagePullBackOff` y este plan no lo predice.

3. **No he ejecutado `pulumi preview` contra los stacks reales.** Los cuatro secretos que CI
   inyecta (`kubeconfig`, `backupAccessKeyId`, `backupSecretAccessKey`, `registryPullToken`) **no
   están puestos localmente** — `pulumi config --stack stg` no los lista—, así que un `preview`
   moriría en `requireSecret`. Lo que afirmo de `preview` en §4.1 es **predicción**, no medida. La
   parte que sí está medida es el comportamiento de `pulumi stack rename` sobre los URN, en el
   laboratorio de §0.1.

4. **No he probado `pulumi stack rename` contra Pulumi Cloud.** El laboratorio usa un backend de
   fichero. La forma del nombre cualificado es distinta (`jneyra/kamayuk/stg` frente a
   `organization/kamayuk/ensayo`) y `--help` la documenta, pero **no la he ejecutado**. Que Pulumi
   Cloud cree el proyecto `kamayuk` al vuelo es suposición.

5. **No sé si `pulumi stack rename` conserva los valores cifrados.** El `encryptionsalt` vive en
   `Pulumi.<stack>.yaml` y el rename no lo toca, así que *debería*. Como CI reinyecta los cuatro en
   cada corrida, probablemente da igual — pero no lo he comprobado.

6. **No he medido el orden de las operaciones que Pulumi elegiría en el `up` de R2**, que es de lo
   que depende que ningún pod se quede sin su `PriorityClass` (§3.5). Eso solo lo dice un `preview`
   real, y ver el punto 3.

7. **No sé cuántas migraciones tiene aplicadas `prod`.** `verificar-el-ambiente.sh --ambiente prod`
   **no se ha ejecutado nunca** (su paso se añadió el 2026-08-30 y el último `aplicar-prod` en
   verde es del 2026-08-29). Sé que `stg` tiene **66** en la base del monolito y que su `Job` de
   la versión declarada está **`Failed` con `BackoffLimitExceeded`** — o sea que `stg` tampoco está
   donde su configuración dice.

8. **No he decidido si el monolito sobrevive.** Todo este plan asume que sí en `prod` y que no en
   `stg` (C-19). Si D-22/ADR-0029 lo retiran, desaparecen `BASE_DEL_PADRON`, las tres imágenes
   `sgtm-*` y buena parte de D4 — y este plan sería más pequeño. **Hacer D antes de esa decisión
   significa renombrar cosas que quizá se borren.** Es una pregunta para la dirección, no una
   medida.

9. **No he mirado el coste en tiempo.** Cuánto tarda el `up` de `prod` con volumen nuevo, cuatro
   migraciones de sistema y la reconciliación del realm (que en `stg` tardó **15 minutos** ella
   sola, `job/sgtm-stg-realm-ff8106e2b6`) no lo sé. La ventana de mantenimiento hay que
   dimensionarla con una medida de `stg`, no con esta frase.

10. **El realm queda fuera y no digo cuándo entra.** §3.6 explica por qué es seguro dejarlo, pero
    el día que se renombre habrá que repetir media ventana. Puede que convenga hacerlo **dentro**
    de la misma —el volumen se rehace igual, y Keycloak pierde su base de todos modos—. No lo
    decido aquí porque exige comprobar los cinco sitios de §1.5 y los dos valores por omisión, y
    eso es trabajo de la etapa que lo haga.

---

## Anexo · las órdenes con que se midió

```bash
# Pulumi
pulumi whoami; pulumi stack ls; pulumi version
pulumi config --stack stg
pulumi stack export --stack {stg,prod} > estado.json
pulumi stack rename --help; pulumi state --help

# Laboratorio del rename (backend de fichero, desechable)
pulumi login file://$T/backend
pulumi stack import --force --file dep.json --stack ensayo
pulumi stack rename organization/kamayuk/ensayo --stack ensayo
pulumi stack export --stack ensayo | jq -r '.deployment.resources[].urn'

# Clusteres (los dos, con --request-timeout=40s)
kubectl get nodes,ns,pvc -A; kubectl get priorityclass
kubectl -n sgtm-<amb> get deploy,cronjob,job,pod,secret
kubectl -n sgtm-<amb> get secret -o json      # gestionado-por, claves
kubectl -n sgtm-<amb> logs job/sgtm-<amb>-respaldo-…
kubectl -n sgtm-stg exec <pod> -c postgres -- psql -U postgres -tAc "…"

# Manifiestos e inventario
yarn --silent manifiestos --ambiente {stg,prod}
yarn --silent secretos --ambiente stg

# Codigo
rg -o --glob '!node_modules' --glob '!yarn.lock' 'sgtm' <dir> | wc -l
grep -c '^  sgtm:' Pulumi.{stg,prod}.yaml
rg -F 'id("sgtm.' <repo> | wc -l
```
