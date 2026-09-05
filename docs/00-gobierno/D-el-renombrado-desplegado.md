# D — el renombrado desplegado: `sgtm` → `kamayuk` en los nombres que llegan al clúster

**Estado:** aplicado en código y en el **estado de Pulumi**. **No se ejecutó ningún `pulumi up`
contra ningún ambiente**, que es donde el plan pone el punto de no retorno y donde este trabajo
se detiene. §6 dice exactamente qué falta y en qué orden.

Cierra la etapa **D** de las cuatro del renombrado, siguiendo
[el plan](D-plan-del-renombrado-desplegado.md). Las etapas A/B ([R-A/B](R-AB-el-renombrado-del-codigo.md)),
R-N y C ([C](C-los-roles-de-postgresql.md)) ya estaban.

---

## 0 · Tres cosas que la ejecución corrige del plan

### 0.1 · El CLI de Pulumi estaba apuntando al laboratorio, no a la nube

Lo primero que se midió, y no estaba previsto:

```
$ pulumi whoami   → jorge
$ pulumi stack ls → (vacío)
```

`~/.pulumi/credentials.json` tenía como `current` el backend de fichero
`…/scratchpad/D-lab3/backend` — el laboratorio desechable con que el plan midió §0.1— y su único
stack era `organization/kamayuk/ensayo`. La credencial de la nube seguía guardada y validada
(`jneyra`, `lastValidatedAt` de hoy), así que se recuperó con `pulumi login https://api.pulumi.com`.

**Importa porque el modo de fallo es el peor posible:** `pulumi stack ls` **no da error**, da una
tabla vacía. Un `pulumi up` lanzado desde ahí no habría tocado `stg` — habría intentado crear el
stack en un backend de fichero. Quien retome esto: comprobar `pulumi whoami -v` antes de nada.

### 0.2 · `pulumi stack rename` contra Pulumi Cloud **funciona**, y el plan no lo sabía

El plan §5.4 lo dejó como suposición explícita: «No he probado `pulumi stack rename` contra Pulumi
Cloud […] Que Pulumi Cloud cree el proyecto `kamayuk` al vuelo es suposición». Medido:

```
$ pulumi stack rename jneyra/kamayuk/stg  --stack stg    → Renamed stg to jneyra/kamayuk/stg
$ pulumi stack rename jneyra/kamayuk/prod --stack prod   → Renamed prod to jneyra/kamayuk/prod

$ pulumi stack ls
NAME  LAST UPDATE  RESOURCE COUNT  URL
prod  …            77              https://app.pulumi.com/jneyra/kamayuk/prod
stg   …            82              https://app.pulumi.com/jneyra/kamayuk/stg
```

Los **82 + 77** recursos siguen ahí y **los 159 URN se reescribieron**: `::sgtm::` cuenta **0** en
los dos estados exportados, `::kamayuk::` cuenta 82 y 77. El proyecto `sgtm` desaparece de
`pulumi stack ls --all`: no queda ningún stack en él.

### 0.3 · `descriptor/entorno.ts` ya no tiene los cuatro literales que el plan le atribuía

El mínimo indivisible del plan (§3.2) lista `descriptor/entorno.ts:48,56,58,65` como cuatro
literales propios. **Medido hoy: `git grep sgtm descriptor/` da dos resultados y ninguno es un
nombre de recurso** —uno es el realm en una muestra, otro un comentario—. Las cuatro líneas
**derivan** de `namespaceName`, `nombreDePrioridad` y `commonLabels`, así que los 18 objetos de los
cuatro sistemas que nombran a la plataforma se movieron solos, como el plan esperaba pero por un
camino más limpio del que creía.

---

## 1 · R1 — el proyecto y las claves

Un acto reversible que no toca ningún clúster:

| Qué | Cifra |
|---|---:|
| `pulumi stack rename` × 2 | 159 URN reescritos, 0 recreaciones |
| `Pulumi.yaml`: `name:` y `description:` | 1 + 1 |
| `Pulumi.stg.yaml`: `  sgtm:` → `  kamayuk:` | **35** |
| `Pulumi.prod.yaml`: ídem | **29** |

Y la comprobación de que el espacio de configuración y el programa vuelven a coincidir, que es lo
que el plan §0.2 midió como fallo:

```
$ pulumi config get domain --stack stg   → sv-RFoVCw2ifaqy3G9NZ1eT.cloud.elastika.pe
```

### Lo que `pulumi preview` sí y no pudo decir

`preview` **no se puede completar en esta máquina**, y el plan lo predijo (§5.3): mueren en
`requireSecret` los cuatro valores que CI inyecta y que no están puestos localmente
(`kubeconfig`, `backupAccessKeyId`, `backupSecretAccessKey`, `registryPullToken`). Lo que sí dejó
medido antes de morir, y no es poco:

```
    pulumi:pulumi:Stack kamayuk-stg running error: Missing required configuration variable 'kamayuk:kubeconfig'
Resources:
    1 unchanged
```

Dos cosas ahí: el recurso raíz ya se llama `kamayuk-stg` y sale **`1 unchanged`** —no propone
reemplazo, que es el punto 2 de §0.1 del plan confirmado contra la nube—, y el propio mensaje de
Pulumi nombra `kamayuk:kubeconfig`.

**Y el `preview` completo sí se acabó midiendo: lo corrió CI.** Los trabajos `pulumi preview de
stg` y `pulumi preview de prod` de `infra.yml` se disparan con `pull_request`, tienen los cuatro
secretos del *environment* y **pasan los dos** sobre esta rama. Es la comprobación que localmente
no cabía, hecha donde las credenciales existen — y sin desplegar nada: `pulumi up en stg` y
`pulumi up en prod` salen **`skipping`**, porque están condicionados a `push`/`workflow_dispatch`.

---

## 2 · R2 — lo que genera los nombres

Los tres generadores, en `infra/config.ts`:

| Función | Antes | Ahora |
|---|---|---|
| `namespaceName` | `` `sgtm-${environment}` `` | `` `kamayuk-${environment}` `` |
| `resourceName` | `` `sgtm-${environment}-${component}` `` | `` `kamayuk-${environment}-${component}` `` |
| `commonLabels` | `proyecto: "sgtm"` | `proyecto: "kamayuk"` |

Y con ellos: el mensaje de `MissingConfigError` (`«sgtm:${key}»`, que mandaba a buscar al espacio
viejo), la etiqueta duplicada a mano de `Red.ts:98`, el analizador de `verificaciones/stacks.ts`,
la etiqueta `cluster:` de Prometheus, el grupo de reglas de alerta, el proveedor y la carpeta de
Grafana, y el `uid`, `title`, `tags` y las **dos consultas** del tablero.

### 2.1 · Los nombres con plantilla, que hicieron falta tres pasadas

Los literales `sgtm-stg` / `sgtm-prod` son los fáciles. Los que cuestan son los que se componen
con una variable, porque una búsqueda por el nombre del ambiente no los ve:

```
sgtm-${AMBIENTE}-prioridad-lote      ← infra/carga-de-datos/*.sh y los de los cuatro repos
sgtm-$AMBIENTE                       ← NAMESPACE=${NAMESPACE:-sgtm-$AMBIENTE}
sgtm-$1                              ← .github/workflows/infra.yml:564
sgtm-<amb>-smtp                      ← comentarios que documentan un `Secret`
```

`priorityClassName` es el que el plan §3.2 marca como peligroso, y con razón: **Kubernetes rechaza
en admisión un pod cuya `PriorityClass` no existe**, así que los guiones de publicación de valores
normativos habrían dejado de correr sin decir por qué.

**Y una regla escrita con cuidado se coló igualmente.** Para no tocar los buckets se usó
`s/sgtm-(\$\{[A-Za-z_]+\}|…)(?!-respaldos)/kamayuk-$1/`, y el motor de expresiones **retrocede**:
ante `sgtm-${environment}-respaldos` acorta la captura a `${environment`, la mirada negativa ve `}`
en vez de `-respaldos` y **sustituye igual**. Dejó `kamayuk-${environment}-respaldos` en
`config.test.ts:54` —el nombre del bucket, justo lo que la mirada existía para proteger—. Se cazó
comparando la lista de menciones de `respaldos` antes y después, y se revirtió. Queda escrito
porque la regla *parecía* correcta y las pruebas seguían en verde: renombrar un bucket no rompe
ninguna, sólo deja los respaldos ilegibles (INF-08 §4).

---

## 3 · El `diff` de manifiestos, y qué reemplazaría un `up`

```
yarn --silent manifiestos --ambiente {stg,prod}
```

| | stg | prod |
|---|---:|---:|
| Objetos | 94 → **94** | 101 → **101** |
| Con prefijo `sgtm-` | 38 → **0** | 46 → **0** |
| Con prefijo `kamayuk-` | 30 → **68** | 30 → **76** |
| Sin prefijo | 26 → **26** | 25 → **25** |

Las cifras 68 y 76 son exactamente las que el plan §4.1 predijo (30 + 38 y 30 + 46).

**Los objetos que cambian de identidad —los que un `up` reemplaza— son 63 en `stg` y 70 en
`prod`**, y se reparten en dos clases que conviene no confundir:

| | stg | prod |
|---|---:|---:|
| Cambian el **nombre** (`sgtm-` → `kamayuk-`) | 38 | 46 |
| Conservan el nombre y cambian de **namespace** | **25** | **24** |
| **Intactos** | 31 | 31 |

Los 25/24 del medio son **todas `NetworkPolicy`**: su nombre es funcional (`denegar-todo`,
`permitir-dns`…) y se mueven porque el espacio de nombres se mueve, que es lo que el plan §1.2
anticipó. Los 31 intactos son los 26 objetos de los cuatro sistemas —sus namespaces ya eran
`kamayuk-*`—, los cuatro `Namespace` de esos sistemas y el `HelmChartConfig traefik` de
`kube-system`.

### 3.1 · Los seis de ámbito de clúster, que no se van con el namespace

Por ambiente, y son los que el plan §2.2 marca como fuente de huérfanos si el `up` se interrumpe:

```
ClusterRole/sgtm-<amb>-observabilidad-kube-state-metrics
ClusterRoleBinding/sgtm-<amb>-observabilidad-kube-state-metrics
Namespace/sgtm-<amb>
PriorityClass/sgtm-<amb>-prioridad-{datos,servicio,lote}
```

---

## 4 · Las mutaciones

Cada una aplicada **sola**, medida, y restaurada **por copia comparada con `cmp`**.

### M1 · Los tres generadores vuelven a `sgtm`

`yarn verificar` pasa de **648 en verde a 12 en rojo**, y el manifiesto de `stg` vuelve
**exactamente** al estado «antes»: `{'sgtm-': 38, 'sin-prefijo': 26, 'kamayuk-': 30}`. Restaurado
con `cmp`, 648 en verde otra vez.

### M2 · La guarda fósil de `stacks.test.ts`, que es la que importa

`stacks.test.ts:62` comprueba que **ningún stack versiona un secreto en claro** con
`expect(lineas.some((l) => l.includes(\`sgtm:${clave}:\`))).toBe(false)`. Con las claves ya en
`kamayuk:`, el `includes` es **siempre falso** y el `toBe(false)` pasa.

No basta con verla en verde: se hizo la comprobación que el plan §4.3 pide, plantando el secreto:

```
# con  kamayuk:kubeconfig: apiVersion-v1-CLAVE-EN-CLARO  metido a mano en Pulumi.stg.yaml
guarda MUTADA  (sgtm:)     → Tests  7 passed (7)          ← el kubeconfig en claro PASA
guarda BUENA   (kamayuk:)  → «kubeconfig» no puede estar en Pulumi.stg.yaml sin cifrar
```

Es decir: con el nombre viejo, la guarda que impide comitear un kubeconfig **deja de mirar y no lo
dice**. Restaurados el archivo del stack y la prueba, los dos con `cmp`.

### M3 · El discriminador que sólo funcionaba porque los dos prefijos eran distintos

`secretos.test.ts` seleccionaba los secretos de los cuatro sistemas con
`e.namespace.startsWith("kamayuk-")`. Eso funcionaba **sólo** porque el namespace de la plataforma
empezaba por `sgtm-`. Al renombrarlo, el mismo filtro coge las **21** entradas del ambiente en vez
de las **10** de los sistemas:

```
AssertionError: expected [ … ] to have a length of 10 but got 21
```

No se arregló subiendo el número: se cambió el criterio por el que de verdad se quería
—los namespaces de los cuatro sistemas, nombrados con `namespaceDelSistema`—, que no puede volver
a fosilizarse en un prefijo. Devolver el filtro viejo pone **2 en rojo**.

### M4 · El guion que lee la bandera del monolito

`verificaciones/ambiente/verificar-el-ambiente.sh` lee `sgtm:desplegarElMonolito` y
`sgtm:applicationBootstrapVersion` de `Pulumi.<amb>.yaml` con `grep`. Devolviéndole el prefijo
viejo: **17 de 18 pruebas en rojo**, diciendo «el guion lee «» de Pulumi.prod.yaml y config.ts lee
«true»».

### M5 · Un cuarto fósil silencioso que el plan no listaba

El plan §4.3 censó **tres** guardas que fosilizarían el nombre pasando en verde. Hay una cuarta, y
**no la cubre ninguna prueba**: `infra/vps/comprobar-lo-asignable.sh`, el guion que `infra.yml`
corre antes de cada `pulumi up` en el paso «Lo declarado cabe en el nodo real». Lee la
configuración con su propio `sed` sobre `sgtm:<clave>:`. Medido contra `Pulumi.prod.yaml`:

```
con el prefijo VIEJO  (sgtm)    -> «» / «»
con el prefijo NUEVO  (kamayuk) -> «2» / «6029348Ki»
```

Y con el valor vacío, `a_mili ""` da **0**, así que la comparación «lo declarado no puede superar
lo real» se vuelve `0m > 2000m` = falso: **acepta cualquier declaración, en silencio**. La guarda
que rechaza declarar un nodo más grande del que hay deja de rechazar nada. Ya está renombrado.

### Las dos guardas silenciosas restantes del plan, y por qué no hizo falta tocarlas

- `componentes.test.ts:487` (`KC_DB_URL` no acaba en `/sgtm`) sigue **viva**, porque
  `BASE_DEL_PADRON` no se renombra (§5).
- `componentes.test.ts:706` (`sgtm-verificacion` no llega a `prod`) sigue **viva**, porque los
  `clientId` son datos del realm y el realm no entra en D (§5).

---

## 5 · Lo que sigue llamándose `sgtm`, una a una y con su motivo

Tras el cambio, el manifiesto de los dos ambientes contiene **exactamente** esto y nada más:

| Qué | Dónde | Motivo |
|---|---|---|
| `sgtm`, `sgtm.json`, `sgtm-ciudadano`, `sgtm-ciudadano.json` | realm de Keycloak | El `iss` del token lleva el realm dentro y los cuatro backends lo comparan (`SeguridadWeb.java`). Renombrarlo es **401 en los cuatro a la vez**. Plan §1.5 y §3.6: etapa propia. |
| `sgtm-backoffice`, `sgtm-portal`, `sgtm-verificacion` | `clientId` | Son **datos del realm**, no derivados. Se van con él. |
| `sgtm-stg-respaldos`, `sgtm-prod-respaldos` | buckets S3 | INF-08 §4: renombrarlos deja **ilegibles** todos los respaldos escritos con el anterior. No hay `ALTER` que los vuelva a cifrar. |
| `sgtm-aplicacion`, `sgtm-migrador`, `sgtm-interfaz` | imágenes del monolito (sólo `prod`) | Plan §3.7: **ningún flujo de estos cinco repositorios publica imágenes** —`publicar-imagenes.yml` no está aquí—, así que renombrarlas exige tocar un repositorio que no se ha medido, y las nuevas tendrían que existir en GHCR antes del `up` o los pods quedan en `ImagePullBackOff`. |
| `sgtm` como nombre de la base del padrón | `BASE_DEL_PADRON` | Ver §5.1. |

Fuera del manifiesto, en el árbol:

| Qué | Motivo |
|---|---|
| `backend/sgtm-esquema/**`, `pe.gob.sgtm.*`, los roles `sgtm_app`… **dentro de las migraciones aplicadas** | Una migración aplicada es inmutable: editarla cambia su suma de Flyway. R-A/B §4 y C §3. |
| El repositorio `sgtm` (≈121 menciones: `herramientas/*.py`, `clonar-los-hermanos`, `deriva-de-migraciones`) | Es el nombre real del repositorio de GitHub, que no se renombra. |
| `sgtm.example.pe`, `sgtm.local`, `sgtm.invalido` | Nombres DNS de prueba (plan §1.4). |
| `sgtm-fuentes-normativas` | Bucket del corpus normativo. Mismo argumento que los de respaldo. |
| `Pulumi.stg.yaml:65,116` y `Pulumi.prod.yaml:137,138` | **Narraciones fechadas de mediciones**: «2026-09-05: `sgtm-stg-aplicacion` 1→0», «el único Job del namespace era `sgtm-stg-migracion-5fc02f3a4493`». Reescribirlas falsificaría la medida. |
| Las actas `docs/00-gobierno/*.md` y la tabla de `CLAUDE.md` | Lo mismo: registran lo que se midió el día que se midió. |
| `sgtm.implantacion.*`, `sgtm.migraciones`, `sgtm.jar` | Propiedades y artefacto **del monolito**, que vive en el archivo. |
| `P5A-copia-del-backend.md:106` | Acta que registra que los ids de Gradle quedaban aplazados. Este trabajo los cierra; la fila que lo dice es ésta, no una reescritura de aquélla. |

### 5.1 · `BASE_DEL_PADRON` **no** se renombra, y es la única desviación del plan

El plan §3.2 lo mete en el mínimo indivisible. Aquí se decide lo contrario, con tres motivos:

1. **Hay una guarda con su motivo escrito que dice que no.** `plataforma-compose.test.ts:229`:
   «Mientras `rentas` sea el monolito con los doce contextos dentro (ADR-0032), su base sigue
   llamándose `sgtm`. Cambiarlo aquí rompe CI sin arreglar nada.» Pisar una decisión razonada sin
   argumentar contra ella es exactamente lo que este proyecto no hace.
2. **No está en el alcance del criterio**, que pide nombres de recurso, claves de configuración,
   etiquetas, `spring.application.name` e ids de plugin. Una base de datos no es ninguna de las cinco.
3. **El radio de daño es el peor del repositorio.** Son ~20 `--dbname=sgtm` repartidos por
   `contra-cluster.sh`, `simulacro-de-restauracion.sh` y el `CronJob` de respaldo: la ruta de
   restauración, donde un fallo no se ve hasta que hace falta restaurar.

Y hay un cuarto argumento que la ejecución destapó: **el monolito ya no se puede instalar desde
cero** (C §5: sus `V1..V78` conceden a `sgtm_app` y ningún `crear-roles.sql` crea ya ese rol), así
que renombrar su base es cosmético mientras esa decisión no se cierre. El plan mismo lo dice en
§5.8: «hacer D antes de esa decisión significa renombrar cosas que quizá se borren».

**Lo que cuesta, dicho:** si algún día se cierra, sobre un volumen que se conserve es
`ALTER DATABASE sgtm RENAME TO kamayuk;` con nadie conectado, y sobre un volumen que se rehaga es
gratis. Mientras tanto, `componentes.test.ts:487` sigue siendo una guarda viva.

---

## 6 · Lo que falta para desplegar, en orden

**Ninguno de estos pasos se ejecutó.** Los tres primeros son bloqueantes y no dependen de este
trabajo.

| # | Paso | Por qué está aquí |
|---:|---|---|
| 1 | **Poner los ocho secretos** que el despliegue necesita (el usuario tiene que correr el guion). Hoy `aplicar-stg` **se salta entero y sale verde en 22 s**. | Sin esto no hay despliegue, y su ausencia no se ve: sale verde. |
| 2 | **Averiguar quién publica las imágenes.** `publicar-imagenes.yml` no está en ninguno de los cinco repositorios (`rg 'docker build|docker push|build-push-action'` da 0 en los cinco). No se sabe si las imágenes `kamayuk-{rentas,catastro,normativa,caja}` **existen en GHCR**. | Si no existen, el `up` termina en `ImagePullBackOff` y nada lo predice. |
| 3 | **El `ALTER ROLE … RENAME TO` de la etapa C** contra los dos clústeres, **antes** del `up` (C §6, H-2). Cinco sentencias, y correr `asignar-claves.sh` después. | `asignar-claves.sh` y `bootstrap-secretos.sh` ya piden `kamayuk_*`: contra un motor sin renombrar fallan con «role "kamayuk_app" does not exist». |
| 4 | **Copiar los secretos a disco** de los dos ambientes antes de borrar nada (plan §3.3). | La `clave-cifrado` de `…-postgres-respaldo` **no se puede regenerar**: los respaldos escritos con la anterior quedan ilegibles. |
| 5 | Inventariar lo que Pulumi no gobierna: `kubectl -n sgtm-<amb> get all,secret,cm,pvc -o name` contra `pulumi stack export`. Se sabe que hay al menos un `ghcr-pull` en `sgtm-stg` que ningún stack conoce. | |
| 6 | `pulumi preview` **de verdad**, con los secretos puestos, leyendo el **orden de las operaciones**. | Es lo único que dice si las `PriorityClass` nuevas se crean antes de borrar las viejas. Un pod cuya `PriorityClass` no existe es rechazado en admisión. |
| 7 | `pulumi up` en **`stg`**. **Punto de no retorno.** | `aplicar-prod` tiene `needs: aplicar-stg`. |
| 8 | Reinyectar los 8 secretos con el nombre nuevo; `bootstrap-secretos.sh` completa los 10 de los sistemas. | |
| 9 | Comprobar §4.1 del plan entero en `stg`, y sólo entonces repetir en `prod`. | El criterio no es «el `up` salió verde», es la fila de `municipalidad` en las cuatro bases. |
| 10 | `kubectl get priorityclass,clusterrole,clusterrolebinding \| grep sgtm-` **vacío** en los dos. | Son los 6 por ambiente de §3.1: no se van con el namespace. |

### 5.2 · «kamayuk» es tres caracteres más largo que «sgtm», y eso rompe el formato

Pasó **dos veces**, y las dos en un **comentario**: renombrar dentro de un javadoc empuja la línea
por encima del límite de columnas y `spotlessJavaCheck` rechaza la compilación
(`kamayuk-rentas-tesoreria`, y `comun-verificaciones` de `librerias-backend`). Se arregla con
`./gradlew spotlessApply`.

La segunda **la cazó CI y no yo**, porque di por inerte una edición de dos comentarios y no corrí
el build de `librerias-backend`. Queda escrito: en este repositorio, **cambiar un comentario puede
poner la compilación en rojo**, así que un renombrado que toque javadoc se verifica con su build,
no por inspección.

### 6.0 · Por qué esto va como PR y no como push a `main`

`infra.yml` se dispara con `push: branches: [main]` sobre —entre otras— `infra/**` y
`.github/workflows/infra.yml`, que es exactamente lo que este cambio toca. Y su trabajo
`aplicar-stg` corre `pulumi up`. **Un push a `main` habría desplegado**, que es lo único que este
trabajo tiene prohibido.

Medido, el trabajo está condicionado a `github.event_name == 'push' || 'workflow_dispatch'`, así
que un `pull_request` corre `verificar` y **no** puede aplicar nada. De ahí la forma de entrega:
cinco ramas `d-renombrado-desplegado` y cinco PR.

**Y hay un motivo propio de esta etapa**, del plan §2.3: R1 ya está aplicado en el backend de
Pulumi, pero `Pulumi.yaml` no está en `main`. Mientras esas dos cosas no se integren juntas,
cualquier corrida de CI desde `main` haría `pulumi config set --stack stg` con el proyecto viejo,
y el stack `sgtm/stg` ya no existe. Es un fallo ruidoso —`no stack named 'stg' found`—, pero deja
la corrida roja: **este PR conviene integrarlo sin dejar pasar mucho, y con el despliegue parado.**

### 6.1 · Dos cosas rotas que este trabajo encontró y **no** arregló

Ninguna la introduce el renombrado; las dos afectan al despliegue y estaban tapadas.

**(a) `verificar-el-motor.sh --con-aislamiento` no puede funcionar.** CI lo corre
(`infra.yml:248`), y su paso 10 hace `cd "$INFRA/../backend" && ./gradlew verificarAislamiento`.
Medido: `infrastructure/backend/` contiene **sólo** `sgtm-esquema/src` y `sgtm-dominio-compartido/src`
—no hay `gradlew`, ni `settings.gradle.kts`, ni `buildSrc`— desde el reparto de repositorios. Las
propiedades que pasa (`-Dsgtm.pruebas.postgres.*`) son además las anteriores a la etapa B. **No se
tocó** porque arreglarlo exige decidir *el aislamiento de qué sistema* se ejercita ahí, y eso es
una decisión de diseño, no un renombrado.

**Y no es una predicción: CI lo confirma, y desde antes de esta rama.** El trabajo «El motor,
levantado y con el aislamiento verificado» está en rojo **sobre `main`** con el error exacto:

```
verificar-el-motor.sh: line 307: ./gradlew: No such file or directory
FALLO: la prueba de aislamiento no paso contra la instancia del manifiesto
```

Lo que hace caro este rojo no es el rojo: es que ese trabajo es **el único** que ejerce el motor
del manifiesto con el aislamiento de verdad, así que lleva sin ejercerse desde el reparto.

**(b) El `CronJob` de respaldo escribe en una tabla que un volumen nuevo no tendrá.** Registra cada
copia con `psql --dbname=sgtm` sobre la tabla `respaldo`, que nace en la `V8` **del monolito**. Como
el monolito ya no puede migrar desde cero (C §5) y el plan §3.4 decide rehacer el volumen, tras el
`up` esa tabla no existirá y el registro fallará. Las cuatro bases de los sistemas tienen **su
propia** tabla `respaldo` en su `V1__baseline.sql`, así que la salida existe —apuntar el `CronJob`
a una de ellas— pero es una decisión, no un `sed`.

### 6.1.1 · El rojo de los cuatro repositorios es anterior a este trabajo

Los cuatro PR hermanos salen con **«Verificaciones bloqueantes» en rojo**, y **no lo causa este
cambio**. Medido: las cuatro últimas corridas de `backend.yml` **sobre `main`** de los cuatro
repositorios están en `failure` desde antes de abrir la rama, y el fallo es **el mismo, byte a
byte** —«49 tests completed, 2 failed», en `ARQ-03 · Cobertura estructural`: «toda tabla no exenta
tiene RLS activa y forzada» y «toda tabla está clasificada como de tenant, de catálogo o exenta»—.

Lo que la aserción enumera son tablas `*_de_prueba` (`arancel_de_prueba`, `construccion_de_prueba`,
`conjunto_parametros_de_prueba`…): fixtures que quedan en la base de la corrida y que el censo
estructural cuenta como tablas sin clasificar. Es un defecto de aislamiento **entre pruebas**, de
la familia de #698, y tiene issue propio: no se toca aquí.

**Localmente pasa**, contra el motor de esta máquina, y por eso conviene no leer ese verde como
garantía: `./gradlew build` **no corre `verificarAislamiento`** —es otra tarea—, así que el verde
local de §7 no dice nada de estas dos pruebas.

### 6.1.2 · Y tres trabajos de `infrastructure` también estaban en rojo antes

Medido sobre la última corrida de `infra.yml` en **`main`** anterior a esta rama
(`33976429949`), los trabajos en `failure` eran exactamente tres:

```
El motor, levantado y con el aislamiento verificado     ← §6.1 (a)
Los secretos se generan solos, y ninguno se repite
Los tableros muestran datos de verdad
```

Los mismos salen en rojo sobre esta rama. **Ninguno lo introduce este trabajo**, y conviene
tenerlo escrito por lo de siempre: un rojo que ya estaba se lee como un rojo que acabas de causar,
y al revés —que es peor— un rojo nuevo se esconde detrás de uno viejo. Lo que sí pasa en verde y
es de este cambio: `Lint, tipos y pruebas`, `comun-verificaciones`, `Los manifiestos, validados
por un API server de verdad`, `capacidad.ts predice lo que el planificador hace`, `La raiz sellada
arranca` y **los dos `pulumi preview`**.

### 6.2 · Lo que sigue sin poder afirmarse

1. **No se ejecutó `pulumi preview` completo.** Faltan los cuatro secretos de CI. Lo de §1 es lo
   que se pudo medir.
2. **No se midió el contenido de la base de `prod`.** PostgreSQL sigue a 0 réplicas y levantarlo es
   un cambio que este encargo no autoriza.
3. **No se sabe si `pulumi stack rename` conservó los valores cifrados.** El `encryptionsalt` vive
   en `Pulumi.<stack>.yaml` y el rename no lo toca, así que *debería*; como CI reinyecta los cuatro
   secretos en cada corrida, probablemente da igual. No se comprobó.
4. **El realm de Keycloak sigue fuera**, y sigue sin decidirse cuándo entra (plan §5.10). Puede
   convenir hacerlo **dentro** de la misma ventana, porque el volumen se rehace igual y Keycloak
   pierde su base de todos modos.

---

## 7 · Lo verificado

| Verificación | Cómo | Resultado |
|---|---|---|
| Los stacks conservan sus recursos | `pulumi stack ls`, `stack export` | `jneyra/kamayuk/{stg,prod}` con **82** y **77**; `::sgtm::` = **0** |
| El manifiesto no cambia de tamaño | `yarn manifiestos` | 94 y 101 objetos, **0** con prefijo `sgtm-` |
| `infrastructure` | `yarn verificar` | **648 / 648** |
| Los cuatro backends | `./gradlew cleanTest build --no-build-cache` contra PostgreSQL 16.15 real | `BUILD SUCCESSFUL`; **3 145 · 994 · 620 · 690**, 0 fallos |
| Los cuatro descriptores | `yarn verificar` en `<sistema>/infrastructure` | **15 · 13 · 13 · 14** |
| Ids de plugin de Gradle | `id("kamayuk.…")` | **89** (36 + 19 + 18 + 16), 0 del nombre viejo fuera del acta P5A |

> **Los conteos del backend hay que sumarlos de dos tareas.** `./gradlew build` corre `test` **y**
> `pruebaDeArranque`, y `cleanTest` sólo limpia la primera: los XML dan 3 141 · 990 · 616 · 686 en
> `test` y **4 en cada repo** en `pruebaDeArranque`. Sin sumarlas, las cuatro cifras salen
> exactamente 4 por debajo del criterio y parecen una regresión que no existe.
>
> **Y la primera corrida no demostró nada:** las tres primeras salieron `BUILD SUCCESSFUL` en 15-18 s
> con las tareas de prueba **`UP-TO-DATE`**. Se repitió con `cleanTest` y `--no-build-cache`, y se
> comprobó que los 609 · 157 · 102 · 121 archivos de resultados se hubieran reescrito.
