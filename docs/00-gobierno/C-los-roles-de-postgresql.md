# C — los roles de PostgreSQL: `sgtm_*` → `kamayuk_*`

**Estado:** aplicado en los cinco repositorios vivos. El repositorio `sgtm` **no se tocó**.

La dirección decidió que el producto se llama **Kamayuk**. Este entregable hace la **etapa C** de
las cuatro en que el renombrado se parte: los **roles de PostgreSQL**. Las etapas A y B (variables
de entorno y prefijo de propiedades) y R-N (los tres módulos con el nombre repetido) ya están; la
etapa D —nombres de recurso de k3s, claves de Pulumi, `spring.application.name`— **no entra**, y
§6 dice qué le queda.

Lo que gobierna esta etapa es una propiedad del motor que no vale para las otras dos: **un rol es
del clúster**. Las tablas son de una base, las variables de entorno son de un proceso, pero
`pg_authid` es uno solo y los cinco esquemas —el monolito y los cuatro sistemas— comparten sus
filas. De ahí las dos consecuencias que decidieron todo lo demás:

1. **Se renombra en los cinco a la vez o en ninguno.** Un `crear-roles.sql` con el nombre nuevo
   junto a otro con el viejo no produce dos mundos: produce un clúster con ocho roles donde debía
   haber cuatro, y uno de los dos lados sin poder abrir sesión. Está medido en §4, mutación M4.
2. **El monolito entra**, y no por simpatía: si se quedara fuera, los cuatro sistemas tampoco
   podrían renombrarse. §2.

---

## 1 · Lo renombrado, con su cifra

Cinco roles, no cuatro. El encargo nombra `sgtm_app`, `sgtm_owner`, `sgtm_monitor` y
`sgtm_respaldo`; **`sgtm_readonly` es el quinto**, y no es una interpretación amplia del alcance:
es que los cuatro sistemas lo cuentan entre los suyos con todas las letras. `crear-roles.sql` de
`rentas` lo crea en el mismo `FOREACH`, el `CLAUDE.md` de los cuatro decía «los roles de base de
datos siguen llamándose `sgtm_owner`, `sgtm_app`, **`sgtm_readonly`** y `rol_carga_parametros`», y
`R-AB` §4 punto 1 lo lista explícitamente como parte de la etapa C. Dejarlo fuera habría cumplido
la letra del criterio 1 y dejado un rol del producto llamándose como el producto que ya no existe.

`rol_carga_parametros` y `rol_ingestor_catastro` **no llevan `sgtm` y no se tocaron**.

Menciones renombradas por este trabajo, contadas con `git grep -o` sobre archivos versionados:

| Rol | infrastructure | rentas | catastro | normativa | caja | **total** |
|---|---:|---:|---:|---:|---:|---:|
| `kamayuk_app` | 132 | 494 | 145 | 89 | 112 | **972** |
| `kamayuk_owner` | 156 | 121 | 70 | 64 | 66 | **477** |
| `kamayuk_readonly` | 22 | 145 | 41 | 27 | 34 | **269** |
| `kamayuk_respaldo` | 52 | 1 | — | 1 | — | **54** |
| `kamayuk_monitor` | 28 | 1 | — | — | — | **29** |
| **total** | **390** | **762** | **256** | **181** | **212** | **1 801** |

Y dos renombrados derivados, que no son el nombre del rol pero sí salen de él:

- **El identificador corto de los guiones de bash** —`rotar-clave.sh --rol sgtm-app`—: `sgtm-app`,
  `sgtm-owner`, `sgtm-monitor`, `sgtm-respaldo` pasan a `kamayuk-*`. **24 menciones en 5 archivos**
  de `infrastructure`. No es un nombre de recurso de k3s: los `Secret` se llaman
  `sgtm-<amb>-postgres-owner` y **ésos no se tocan** (etapa D). La sustitución se ancló para no
  pisar `sgtm-respaldos`, que es el *bucket* de `config.test.ts` y no un rol.
- **El centinela `seConectaComoSgtmApp`** → `seConectaComoKamayukApp`: **29 menciones** (rentas 24,
  catastro 2, caja 2, normativa 1). Es el método que compara `current_user` contra el pool que usan
  los controladores, el de #545. Compara contra `BaseDeDatosDePrueba.APP`, así que **deriva** y no
  hubo que tocar su aserción; lo que se renombró es su nombre, que sí llevaba el del rol.

**El encargo daba 1 865 menciones y esa no es la cifra de este árbol.** Medidas hoy con `git grep`
sobre archivos versionados de los cinco repositorios, las de los **cuatro** roles del encargo son
**1 989** (`app` 1 329 + `owner` 566 + `respaldo` 59 + `monitor` 35), y con `sgtm_readonly` dentro,
**2 510**. La diferencia con 1 865 es de criterio de conteo, no de desacuerdo sobre qué hay: de esas
2 510, **709 se quedan** y están dichas una a una en §3.

### Dónde estaban

- **Las políticas RLS y los privilegios** de los cuatro `V1__baseline.sql` —`CREATE POLICY … TO`,
  `GRANT`, `REVOKE`, `ALTER TABLE … FORCE ROW LEVEL SECURITY`— y de las migraciones posteriores de
  cada sistema. Es el grueso: 255 líneas sólo en el de `rentas`.
- **Los cinco `crear-roles.sql`** (`.../db/roles/`), donde los roles nacen `NOLOGIN` y sin clave, y
  donde vive el `REVOKE CONNECT … FROM PUBLIC` de C-7 §6.
- **La inicialización del motor**: `despliegue/inicializacion-del-motor/` e
  `infra/componentes/inicializacion/` —`06-roles-de-los-sistemas.sh`, `10-crear-roles.sql`,
  `20-asignar-claves.sh`, `30-base-de-keycloak.sh`, `40-rol-de-respaldo.sh`,
  `50-rol-de-monitoreo.sh`—.
- **El inventario de secretos** (`infra/componentes/secretos.ts`, campo `rolDePostgres`), y
  `bootstrap-secretos.sh`, `asignar-claves.sh`, `rotar-clave.sh`, `verificar-rotacion.sh`,
  `verificar-claves-distintas.sh`.
- **Los cuatro descriptores** (`<sistema>/infrastructure/src/descriptor.ts`): el valor de
  `KAMAYUK_DB_USUARIO` / `KAMAYUK_DB_OWNER_USUARIO` y la declaración de roles y privilegios.
- **La auditoría de descriptores** (`infra/auditoria.ts`), los compose, los `Dockerfile`, los
  `application.yaml`, los guiones de carga de datos, el simulacro de restauración y el javadoc.

---

## 2 · La decisión: el monolito entra, y lo que eso cuesta

**El monolito no podía quedarse fuera**, y conviene decir por qué antes de decir a qué precio. Los
roles son del clúster. Si `crear-roles.sql` del monolito siguiera creando `sgtm_app` y el de los
cuatro sistemas creara `kamayuk_app`, el clúster tendría los dos y `20-asignar-claves.sh` le pondría
clave a uno solo: el otro existiría con sus `GRANT` puestos y sin poder abrir sesión, que es
exactamente el defecto que #435 midió con `rol_carga_parametros`. No hay una versión de la etapa C
en la que el monolito se quede como está y los cuatro sistemas se renombren.

Así que entra: su `crear-roles.sql` —que **no es una migración de Flyway** y lo dice en su propia
cabecera— pasa a `kamayuk_*`, y con él el `KAMAYUK_DB_USUARIO` de su `Deployment`, sus dos `Job` y
su `CronJob` de lote, que es lo que se ve en el diff de manifiestos de §5.

### Lo que hace posible migrar `stg` y `prod` sin tocar sus datos, medido

Un `ALTER ROLE … RENAME TO` **conserva los privilegios y las políticas**, porque PostgreSQL guarda
el OID del rol y no su nombre. No se razonó: se ejecutó contra PostgreSQL 16 antes de decidir nada.

```sql
CREATE ROLE medida_app NOLOGIN;
CREATE TABLE t (municipalidad_id bigint not null, x int);
ALTER TABLE t ENABLE ROW LEVEL SECURITY;  ALTER TABLE t FORCE ROW LEVEL SECURITY;
CREATE POLICY p ON t FOR ALL TO medida_app USING (municipalidad_id = current_setting('app.municipalidad_id')::bigint);
GRANT SELECT, INSERT ON t TO medida_app;
-- ANTES:    polroles → medida_app        relacl → {postgres=arwdDxt/postgres,medida_app=ar/postgres}
ALTER ROLE medida_app RENAME TO medida_kamayuk;
-- DESPUES:  polroles → medida_kamayuk    relacl → {postgres=arwdDxt/postgres,medida_kamayuk=ar/postgres}
--           has_table_privilege('medida_kamayuk','t','SELECT') → t
```

De modo que en un clúster que **ya existe** —`stg` y `prod`— la etapa C se aplica con **una
sentencia por rol**, y todo lo que las 78 migraciones aplicadas del monolito concedieron a
`sgtm_app` sigue concedido a `kamayuk_app` sin que ninguna de esas migraciones se toque. Ésa es la
razón por la que el monolito puede entrar aunque su historia sea inmutable.

### La consecuencia, con todas las letras

**Desde este commit, el monolito no se puede instalar desde cero nunca más.**

Sus `V1..V78` son migraciones **aplicadas** y por tanto inmutables: editarlas cambia su suma de
Flyway y rompe todo ambiente que ya las corrió (#742, y la cabecera de `V64`). Dentro llevan 178
menciones de `sgtm_app`/`sgtm_owner`/`sgtm_readonly` en `GRANT`, `REVOKE` y `CREATE POLICY`. Como
ningún `crear-roles.sql` crea ya esos roles, sobre un clúster **nuevo** `V7__privilegios.sql` muere
en su primer `GRANT` con «role "sgtm_app" does not exist», y con él la migración entera.

Lo que eso deja de poder hacerse, y desde cuándo:

| Desde este commit | Qué deja de poder hacerse |
|---|---|
| `stg` | No puede recuperar el monolito. Ya no lo despliega desde C-19 (`sgtm:desplegarElMonolito: false`), así que el ensayo de su migración antes de `prod` —que C-19 dejó anotado como decisión pendiente— pasa de pendiente a **imposible sin deshacer esta etapa**. |
| `prod` | Sólo puede **migrarse en sitio**, con el `ALTER ROLE` de arriba. No puede reconstruirse desde un volumen vacío: el `10-crear-roles.sql` del ConfigMap crearía `kamayuk_*` y las 78 migraciones pedirían `sgtm_*`. |
| Un respaldo anterior a la etapa | Restaura un clúster cuyos roles se llaman `sgtm_*`. Después de restaurar hay que correr el mismo `ALTER ROLE`, o el `Deployment` —que ya pide `kamayuk_app`— no autentica. Esto vale también para `simulacro-de-restauracion.sh`. |
| Cualquier `V79` del monolito | No la hay ni la va a haber, pero si la hubiera no podría nombrar los roles como los nombran sus 78 hermanas. |

**Lo que NO cuesta, medido y dicho por el encargo:** `stg` tiene el monolito apagado desde C-19 y
su motor sólo tiene las bases `keycloak`, `postgres` y `sgtm` —las cuatro de los sistemas no
existen, y por eso los cuatro `V1__baseline.sql` **sí** se pudieron editar—; y `prod` está entero a
cero —nueve `Deployment` en 0, dos `CronJob` suspendidos— y **sin un solo dato de padrón**:
`contribuyente = 0`, `predio = 0`, `recibo = 0`, asientos `= 0`. No hay ninguna municipalidad
atendiéndose por el monolito a la que este cambio le quite nada.

> **Hueco declarado.** Esas cifras del clúster son las del encargo. **Este trabajo no las volvió a
> medir**: no hay kubeconfig alcanzable en esta máquina y el encargo prohíbe aplicar nada contra
> ningún clúster. Lo que sí se comprobó aquí es todo lo que se puede comprobar sin clúster: los
> manifiestos, los cinco `crear-roles.sql`, las cuatro baterías contra PostgreSQL real y el
> comportamiento de `ALTER ROLE … RENAME TO`.

---

## 3 · Lo que NO se renombró, y por qué — las 709 menciones que quedan

Nada de esto es un descuido: cada bloque se miró. El criterio es el que `R-AB` §4 dejó fijado.

| # | Dónde | Menciones | Por qué |
|---|---|---:|---|
| 1 | `infrastructure/backend/sgtm-esquema/src/main/resources/db/migration/V*.sql` (52 archivos) | **178** | Las 78 migraciones **aplicadas** del monolito, en `stg` y en `prod`. Editar una cambia su suma de Flyway y rompe el ambiente que ya la corrió. Es lo que §2 paga. |
| 2 | `rentas/docs/40-datos/baselines/**` — los cuatro `V1__baseline.sql` fechados, su `README.md` y los tres `.java` del arnés | **419** | Es el artefacto de **DAT-02**, generado el 2026-09-03, y su arnés `verificar-baselines.sh`, que compara los baselines **contra las `V1..V78` del monolito**. Renombrarlo haría falsa la afirmación central de su README —«el diff es vacío»— porque el lado del monolito no se puede renombrar. Además el arnés ya es **vestigial** desde C-3 §7 —resuelve `RAIZ` a la raíz de `rentas`, donde no hay `backend/sgtm-esquema`— y las cuatro copias ya divergían de los baselines vivos desde P5E. Lo que de ese directorio sí consume código vivo son `Retrato.java` y `canonizar.py` (el simulacro de restauración lógica), y **ninguno de los dos nombra un rol**. |
| 3 | `*/docs/00-gobierno/{C-*,P*,R-*,D-*}.md` e `inventario-del-corte.md`, más `rentas/docs/00-gobierno/plan-de-marcha-blanca.md` | **109** | Son **actas**: cada una registra lo que se midió el día que se midió, con su salida literal. Reescribirles los nombres falsificaría la medida. Es el mismo criterio de `R-AB` §4. Incluye `D-plan-del-renombrado-desplegado.md`, que además lo está escribiendo otro agente ahora mismo y **no se tocó ni una línea**. |
| 4 | `infrastructure/CLAUDE.md`, tres filas de la tabla «Verificar antes de afirmar» (C-7, C-12, C-17) | **3** | Misma razón: son filas históricas. La **prosa viva** del mismo archivo —la línea 156, «`ALTER ROLE` sobre `kamayuk_owner` y `kamayuk_app` vale para todas las bases del clúster»— **sí** se renombró. |

Reparto por repositorio: `infrastructure` 271 (178 + 90 + 3), `rentas` 430 (419 + 11), `catastro` 3,
`normativa` 2, `caja` 3. **Ninguna mención viva de los cinco roles queda fuera de esta tabla.**

Las 709 se contaron **sobre el árbol antes de escribir este documento**, que añade 37 más al hablar
del nombre viejo: es la quinta acta de la lista, y por el mismo motivo que las otras cuatro.

### Lo que lleva `sgtm` y **no** es un rol — se declara aquí

- **`sgtm_prueba_<hex>`**, el prefijo con que `MotorPostgres` nombra la base de cada corrida de
  pruebas. Es un **nombre de base de datos**, no un rol; cae en la misma categoría que
  `BASE_DEL_PADRON = "sgtm"`, que `R-AB` §4 punto 2 dejó para la etapa D.
- **`CANDADO_DE_PROVISIONAMIENTO = 0x5347544D524F4C`**, los bytes ASCII de `SGTMROL`. Es la clave
  de un candado de asesoramiento, y **cambiarla sería un defecto**: un checkout viejo y uno nuevo
  apuntando al mismo motor tomarían candados **distintos** y volvería el choque que #698 cerró. Se
  queda, y su docstring ya explica que el valor no significa más que «este candado y no otro».
- **`SgtmAplicacion`, `TablasDelSgtm`, `CrucesConsentidosDelSgtm`, `ConfiguracionDelSgtm`,
  `seConectaComo…`(ya renombrado)** — nombres de clase que hablan del producto, no del rol. No los
  cubre A, B, C ni D; se anotan como `R-AB` §4 anotó los identificadores de los plugins de Gradle.

---

## 4 · Las mutaciones

Cada una aplicada **sola**, ejecutada, y restaurada **por copia comparada con `cmp`**.

### M1 — la que el criterio 2 pide: conectar como **superusuario del clúster**

`BaseDeDatosDePrueba.conexion(String rol)` devuelve la conexión de administrador en vez de la del
rol pedido, en los cuatro sistemas.

```java
-        Connection conexion = abrir(motor.url(), rol, claves.get(rol));
+        Connection conexion = abrir(motor.url(), motor.usuarioAdmin(), motor.claveAdmin());
```

**8 en rojo de 19, en cada uno de los cuatro.** Y el mensaje es el que la prueba existe para dar:

```
el superusuario omite RLS: por eso esta prueba no usa esa conexion
  → [kamayuk_app ve solo la suya. Esta es la unica conexion que prueba algo]
    expected: 1L  but was: 2L
con contexto de A, ninguna lectura devuelve filas de B
  → Multiple Failures (101 failures) -- [acceso: fuga de filas de la municipalidad B] expected: 0L but was: 1L
un INSERT con municipalidad_id de B falla por WITH CHECK
  → [sin WITH CHECK, un INSERT puede plantar datos en otro tenant aunque no pueda leerlos]
```

### M2 — el contraste que hay que volver a medir cada vez: la misma rotura con **`kamayuk_owner`**

```java
+        Connection conexion = abrir(motor.url(), OWNER, claves.get(OWNER));
```

**1 en rojo de 19** en `rentas` y en `caja`, y **no es ninguna de las ocho de aislamiento**: es «el
acceso directo a una partición falla», que cae porque el dueño tiene privilegios que la aplicación
no. Las ocho que miden el aislamiento siguen **VERDES**, porque `FORCE ROW LEVEL SECURITY` sujeta
también al dueño. Es la trampa que #537, #545, #601 y #608 ya midieron, aquí por quinta vez: **la
rotura de aislamiento que uno teclea por costumbre no demuestra nada**, y lo único que la delata es
el centinela de `current_user`. Por eso `seConectaComoKamayukApp` compara contra
`BaseDeDatosDePrueba.APP` y no contra un literal.

### M3 — la guarda que fosilizaría el nombre viejo en el descriptor

`caja/infrastructure/src/descriptor.ts` vuelve a declarar `KAMAYUK_DB_USUARIO: "sgtm_app"`.

`yarn manifiestos --ambiente stg` **no emite nada** y para con:

```
Error: La auditoria rechazo 2 cosa(s) de los descriptores de sistema.
  - [caja] Job/kamayuk-caja-implantacion-…, contenedor «implantacion»: se conecta a la base como
    «sgtm_app». La aplicacion se conecta SIEMPRE como `kamayuk_app` …
  - [caja] Deployment/kamayuk-caja-web, contenedor «caja»: se conecta a la base como «sgtm_app». …
```

`infra/auditoria.ts` compara contra un **literal** (`usuario !== "kamayuk_app"`), así que era el
candidato número uno a quedarse fosilizado. Sigue mordiendo, y **no hubo que provocarlo la primera
vez**: al intentar producir el manifiesto «antes» guardando sólo `infrastructure` —con los cuatro
descriptores hermanos ya renombrados— la auditoría rechazó **10 cosas** de golpe. El manifiesto
«antes» de §5 hubo que producirlo guardando los **cinco** repositorios a la vez, que es la misma
lección de §0: esto es una frontera, y una frontera no se mide desde un lado.

### M4 — las dos mitades del renombrado, desincronizadas

`caja/…/crear-roles.sql` vuelve a `sgtm_app` mientras `BaseDeDatosDePrueba.APP` dice `kamayuk_app`.

**9 en rojo de 21**, y el mensaje nombra el mecanismo exacto:

```
org.postgresql.util.PSQLException: FATAL: permission denied for database "sgtm_prueba_d1ac3065"
  Detail: User does not have CONNECT privilege.
```

Es el `REVOKE CONNECT ON DATABASE … FROM PUBLIC` de C-7 §6 haciendo su trabajo: con el nombre viejo
en el SQL, el `GRANT CONNECT` se le concede a un rol y lo pide otro, y **la sesión ni siquiera se
abre**. Esto es lo que hace que el modo de fallo de la etapa C sea **ruidoso** y no el silencio de
C-18 §5, donde el descriptor pasaba `KAMAYUK_IMPLANTACION_*`, el Java leía `sgtm.implantacion` y el
proceso salía con código 0 sin haber hecho nada.

### M5 — quitarle un rol a `crear-roles.sql`: **pasó en VERDE**, y hay que decirlo

Quitar `'kamayuk_app'` del `FOREACH` de `caja` deja `:kamayuk-caja-esquema:test` **en verde**. El
motivo es que quien le pone la clave es `BaseDeDatosDePrueba.crearRoles()` desde su propio array
`ROLES`, y `CREATE ROLE` es idempotente contra un motor donde el rol ya existe de una corrida
anterior —los roles son del clúster, ésa es toda la lección de este entregable—. **No es una guarda
que falte**: es que esa lista concreta la cubre M4, que sí muerde y con un mensaje mejor. Se anota
para que nadie la escriba creyendo que mide algo.

---

## 5 · El criterio 6: `yarn manifiestos` no mueve ni un nombre de recurso

Los manifiestos de `stg` y de `prod` se emitieron con los cinco repositorios guardados (antes) y con
el árbol de este trabajo (después). **La estructura es idéntica** —2 436 hojas en `stg`, 2 710 en
`prod`, ni una clave añadida ni quitada— y se movieron **31 hojas en `stg` y 37 en `prod`**.

La prueba de que lo único que se movió es el nombre del rol es que, deshaciendo el renombrado sobre
el JSON de después, los archivos vuelven a ser **idénticos byte a byte**:

```
$ perl -pe 's/\bkamayuk_(app|owner|readonly|monitor|respaldo)\b/sgtm_$1/g; s/\bkamayuk-(app|owner|monitor|respaldo)(?![\w-])/sgtm-$1/g' m-stg-DESPUES.json > norm.json
$ cmp m-stg-ANTES.json norm.json    # sin salida — idéntico. Igual en prod.
```

Ningún `metadata.name` cambia. El sufijo de versión de los `Job`
(`…-c755de214934`) tampoco: sale de `sgtm:applicationBootstrapVersion`, que no se toca.

Lo que sí se mueve, línea por línea:

| Recurso | Qué campo | De → a |
|---|---|---|
| `ConfigMap/sgtm-<amb>-postgres-inicializacion` | `.data.06-roles-de-los-sistemas.sh` (1), `.data.10-crear-roles.sql` (14), `.data.20-asignar-claves.sh` (5), `.data.30-base-de-keycloak.sh` (3), `.data.40-rol-de-respaldo.sh` (9), `.data.50-rol-de-monitoreo.sh` (7) | los roles que el motor **crea** y a los que **asigna clave**, en su arranque |
| `ConfigMap/sgtm-<amb>-postgres-roles-de-los-sistemas` | `.data.{rentas,catastro,normativa,caja}.sql` (18/19/14/14) | los cuatro `crear-roles.sql`, montados tal cual desde el clon hermano |
| `Deployment/sgtm-<amb>-postgres` | `containers[1].env[1].value` | `sgtm_monitor` → `kamayuk_monitor` (el sidecar `postgres-exporter`) |
| `CronJob/sgtm-<amb>-respaldo` | `containers[0].args[0]` | el guion de wal-g: `PGUSER=kamayuk_respaldo` para el respaldo y `kamayuk_owner` para las tres escrituras en la tabla `respaldo` |
| `ConfigMap/sgtm-<amb>-observabilidad-prometheus` | `.data.alertas.yml` (1) | la alerta que nombra el rol |
| `Job/kamayuk-<sistema>-migracion` | `containers[0].env[1].value` | `sgtm_owner` → `kamayuk_owner`, en los cuatro |
| `Job/kamayuk-<sistema>-implantacion` | `initContainers[0].env[1]` y `containers[0].env[2]` | `kamayuk_owner` para esperar el esquema, `kamayuk_app` para implantar |
| `Deployment/kamayuk-<sistema>-web` | `containers[0].env[2].value` | `sgtm_app` → `kamayuk_app`, en los cuatro |
| `CronJob/kamayuk-rentas-ingestor`, `CronJob/kamayuk-catastro-publicador` | `containers[0].env[2].value` | ídem |
| **sólo `prod`** · `Job/sgtm-prod-migracion`, `Job/sgtm-prod-implantacion`, `Deployment/sgtm-prod-aplicacion`, `CronJob/sgtm-prod-lote` | `env` e `initContainers[0].args[0]` | **el monolito**: su `KAMAYUK_DB_USUARIO` y los dos `psql --username=` de sus init containers. Es la decisión de §2 hecha manifiesto |

`stg` no tiene esas seis últimas hojas porque desde C-19 no despliega el monolito.

---

## 6 · Los huecos declarados

### H-1 · Una línea de `.github/workflows/infra.yml` que este trabajo no puede tocar

`.github/workflows/infra.yml:262` invoca:

```yaml
infrastructure/infra/secretos/verificar-rotacion.sh --ambiente stg --rol sgtm_app
```

`--rol` recibe **el nombre del rol de PostgreSQL**, no el identificador corto, así que esa línea
tiene que pasar a `--rol kamayuk_app`. **El encargo prohíbe editar `.github/workflows/`** —hay otro
agente ahí— y no se editó.

Lo que pasa mientras tanto: el guion **rechaza** el nombre viejo y sale con código 2 diciendo

```
FALLO: --rol admite kamayuk_app o rol_carga_parametros; llego «sgtm_app».
```

Es un rojo con su remedio dentro, no un fallo mudo. La línea 263 —`--rol rol_carga_parametros`— no
se toca porque ese rol no lleva el nombre del producto. Ninguna otra invocación de
`.github/workflows/` pasa un nombre de rol: se comprobó con `git grep -- '--rol' .github/`.

Se descartó a propósito la salida cómoda —que `verificar-rotacion.sh` aceptara `sgtm_app` con un
aviso—: eso es exactamente la guarda que fosiliza el nombre viejo, y esta etapa existe para
quitarlas.

**Y la línea llegó a estar arreglada, y se deshizo a mano.** El renombrado en bloque no excluía
`.github/`, así que tocó cinco líneas de `infra.yml` —cuatro comentarios y esa invocación— y con
ellas H-1 quedaba cerrado. Se revirtió entera con `git checkout -- .github/` porque la instrucción
es explícita y hay otro agente en ese archivo: un arreglo correcto entregado por el camino
equivocado es un conflicto de merge para alguien, y un hueco declarado se arregla en una línea. Lo
que se comprobó al revertir: `git status --short .github/` vacío, `D-plan-del-renombrado-desplegado.md`
sin tocar, y el repositorio `sgtm` con **cero** cambios.

### H-2 · El acto sobre los clústeres que ya existen, que es de la etapa D

`stg` y `prod` tienen hoy los roles con el nombre viejo. Este trabajo **no aplicó nada contra
ningún clúster**, como el encargo pide. El acto que falta, para el plan de la etapa D, es:

```sql
-- Como superusuario, contra el motor, ANTES del primer `pulumi up` con estos manifiestos.
ALTER ROLE sgtm_owner    RENAME TO kamayuk_owner;
ALTER ROLE sgtm_app      RENAME TO kamayuk_app;
ALTER ROLE sgtm_readonly RENAME TO kamayuk_readonly;
ALTER ROLE sgtm_respaldo RENAME TO kamayuk_respaldo;   -- si existe en ese ambiente
ALTER ROLE sgtm_monitor  RENAME TO kamayuk_monitor;    -- idem
```

**El orden importa y no es negociable:** el `ALTER ROLE` va **antes**, porque
`asignar-claves.sh` y `bootstrap-secretos.sh` ya piden `kamayuk_*` y contra un motor sin renombrar
fallarían con «role "kamayuk_app" does not exist» —el mismo modo de fallo que #435 encontró—.

**Y la contraseña no siempre sobrevive al renombrado. Se midió, no se supuso:**

```
SHOW password_encryption;                     →  scram-sha-256
ALTER ROLE medida_scram RENAME TO medida_scram2;   -- rolpassword sigue siendo SCRAM-SHA-256…
ALTER ROLE medida_md5   RENAME TO medida_md52;
NOTICE:  MD5 password cleared because of role rename    -- …y la md5 queda NULA
```

Conectando después con la clave vieja: `medida_scram2` **sí**, `medida_md52` **no**. El hash `md5`
lleva dentro el nombre de usuario y por eso PostgreSQL lo tira. Con `scram-sha-256` —el método por
omisión desde PostgreSQL 14, y el que este motor declara— la contraseña sobrevive; aun así, correr
`asignar-claves.sh` justo después es idempotente y sale más barato que averiguar con qué método
guardó cada ambiente la suya. **Si algún rol de `prod` tuviera su clave en `md5`, saltárselo lo
deja sin poder autenticar y el síntoma es «password authentication failed», que no se parece en
nada a su causa.**

### H-3 · Lo que no se pudo volver a medir

Las cifras del clúster —`stg` con el monolito apagado y sin las cuatro bases, `prod` a cero y sin
padrón— son las del encargo y **no se remidieron aquí**: no hay kubeconfig alcanzable en esta
máquina, y el encargo prohíbe aplicar nada. Toda la decisión de §2 descansa en ellas. Si alguna
resultara falsa —si `prod` tuviera padrón, o si `stg` tuviera ya alguna de las cuatro bases con su
`V1` aplicado— lo que cambia **no** es la decisión sobre el monolito (sigue siendo la única
posible) sino la afirmación de que los cuatro `V1__baseline.sql` se podían editar, y habría que
volver sobre ella antes de desplegar.

### H-4 · `verificar-el-motor.sh` y `verificar-el-ambiente.sh` no se ejecutaron

Los dos nombran los roles y los dos están renombrados, pero **no se corrieron**: el primero
necesita Docker —que esta máquina no tiene (memoria de la sesión, y por eso las pruebas van contra
`127.0.0.1:55444`)— y el segundo necesita un clúster. Su sintaxis sí se comprobó con `bash -n`,
junto a la de los otros 20 guiones tocados. `infra/secretos/verificar-rotacion.sh` da error de
sintaxis con el `bash` 3.2 de macOS por su `coproc SESION_ABIERTA (…)`, y **eso es previo a este
trabajo**: comprobado guardando el árbol y volviendo a correr `bash -n`.

---

## 7 · Lo verificado, con sus cifras

| Qué | Cómo | Resultado |
|---|---|---|
| `infrastructure` · `yarn verificar` | lint + `tsc --noEmit` + vitest | **648 de 648**, 31 archivos |
| `rentas` · `./gradlew build` contra PostgreSQL 16 real | `-Dkamayuk.pruebas.postgres.url=…:55444` | `BUILD SUCCESSFUL` · **3 145** pruebas, 0 fallos |
| `catastro` · ídem | ídem | `BUILD SUCCESSFUL` · **994**, 0 fallos |
| `normativa` · ídem | ídem | `BUILD SUCCESSFUL` · **620**, 0 fallos |
| `caja` · ídem | ídem | `BUILD SUCCESSFUL` · **690**, 0 fallos |
| Los cuatro descriptores · `yarn test` | vitest en `<sistema>/infrastructure` | **15 · 13 · 13 · 14** |
| `verificarAislamiento` en los cuatro | contra PostgreSQL real, como `kamayuk_app` | **19 verdes** en cada uno; con M1, **8 en rojo** |
| `yarn manifiestos --ambiente {stg,prod}` | diff contra el árbol guardado | ni un nombre de recurso movido; §5 |

Las seis cifras del criterio 4 salen **exactas**. Dos avisos sobre cómo se midieron:

- **`spotlessApply` hizo falta, y no es cosmético.** `kamayuk_` es tres caracteres más largo que
  `sgtm_`, así que el javadoc que lo nombra deja de caber en 100 columnas y `spotlessJavaCheck`
  para el build. Se corrió en los cuatro y **no tocó ni un archivo que este trabajo no hubiera
  tocado ya** (41 · 54 · 75 · 218, los mismos de antes y después).
- **`api-que-no-contesta.test.ts` (#708) cayó una vez por contención**, corriendo a la vez que los
  cuatro builds de Gradle: «Test timed out in 5000ms». Aislada, verde, y el suite entero en 648.
  Es exactamente el fenómeno que ese propio issue documenta —presión de CPU sostenida contra un
  plazo de cliente—, y no tiene nada que ver con este cambio.

### Un hallazgo que no venía en el encargo: `librerias-backend` no la revisa el build de nadie

`infrastructure/librerias-backend` es un **build propio** con su `gradlew`, su Spotless y su
Checkstyle, y los cuatro backends la consumen como *composite build*. Los cuatro dieron
`BUILD SUCCESSFUL` con seis archivos suyos —`ReglasDeArquitectura.java` y cinco muestras— ya
reformateados por el renombrado y **fuera de norma**: un `include`d build compila lo que hace falta
y **no corre el `check` del incluido**. Corriendo `./gradlew build` allí a mano:

```
BUILD FAILED in 754ms
> The following files had format violations:
      …/MuestraDeRepositorioQueEditaUnCierre.java
Run './gradlew spotlessApply' to fix all violations.
```

O sea que **CI se habría puesto rojo en un trabajo distinto de los cinco que este trabajo ejecutó**,
y las cuatro baterías verdes no lo habrían dicho. Se arregló con `spotlessApply` en la librería y se
volvieron a construir los cuatro backends contra ella (verdes los cuatro). Queda anotado porque no
es de esta etapa: **una librería compartida cuyo `check` no corre en el build de ningún consumidor
es un hueco permanente**, y lo único que hoy la revisa es que alguien se acuerde de entrar a su
directorio.

---

## 8 · La fila para «Verificar antes de afirmar»

> | Los cinco roles del clúster dejan de llamarse como el producto que ya no existe (C: `sgtm_owner`, `sgtm_app`, `sgtm_readonly`, `sgtm_monitor`, `sgtm_respaldo` → `kamayuk_*`; **1 801 menciones** en los cinco repositorios, 709 declaradas fuera) | Cinco roturas, cada una sola y restaurada **por copia comparada con `cmp`**: conectar el pool de la prueba de aislamiento como **superusuario del clúster**; la misma escrita con **`kamayuk_owner`**; devolver `KAMAYUK_DB_USUARIO: "sgtm_app"` al descriptor de `caja`; dejar `crear-roles.sql` con el nombre **viejo** y el Java con el **nuevo**; y quitarle un rol al `FOREACH` de `crear-roles.sql` | **8 en rojo de 19** en cada uno de los cuatro, y el centinela lo dice: «kamayuk_app ve solo la suya… expected 1L but was 2L». **1 en rojo la segunda**, y **ninguna de las ocho de aislamiento**: con `FORCE ROW LEVEL SECURITY` el dueño también queda sujeto a la política, así que la rotura que uno teclea por costumbre pasa en VERDE —quinta vez tras #537, #545, #601 y #608—. `yarn manifiestos` **no emite nada** con la tercera y nombra los dos contenedores. **9 en rojo de 21** la cuarta, con el mensaje que enseña por qué esta etapa falla ruidosamente y no en silencio: «FATAL: permission denied for database … User does not have CONNECT privilege», que es el `REVOKE CONNECT` de C-7 §6 parando una sesión que ni se abre. **Y la quinta pasó en VERDE**: quien pone la clave es `BaseDeDatosDePrueba` desde su propio array y `CREATE ROLE` es idempotente contra un motor donde el rol ya existe —los roles son del CLÚSTER, que es toda la lección—; se anota para que nadie la escriba creyendo que mide algo. **La decisión que este trabajo tuvo que tomar es el monolito, y no había dos opciones**: un rol es del clúster, así que dejarlo fuera impedía renombrar también a los cuatro sistemas. Entra, y se puede porque `ALTER ROLE … RENAME TO` **conserva los privilegios y las políticas** —medido contra PostgreSQL 16 antes de decidir: la política pasa de `medida_app` a `medida_kamayuk` y el `relacl` con ella, porque los dos guardan el OID—, de modo que `stg` y `prod` se migran con una sentencia por rol y sus 78 migraciones aplicadas no se tocan. **Lo que cuesta, con todas las letras: desde este commit el monolito no se puede instalar desde cero nunca más** —sus `V1..V78` conceden a `sgtm_app` y ningún `crear-roles.sql` crea ya ese rol, así que sobre un clúster nuevo `V7__privilegios.sql` muere en su primer `GRANT`—; `stg` no puede recuperarlo (ya no lo despliega desde C-19) y `prod` sólo puede migrarse en sitio. No cuesta ningún dato: `prod` está a cero y sin padrón. **Y una guarda que fosilizaba el nombre no hubo que buscarla**: al emitir el manifiesto «antes» guardando sólo `infrastructure`, `infra/auditoria.ts` —que compara contra el literal `"kamayuk_app"`— rechazó **10 cosas** de los cuatro descriptores hermanos; el «antes» hay que producirlo guardando los cinco repositorios, porque esto es una frontera y una frontera no se mide desde un lado. `yarn manifiestos` de `stg` y `prod` sale **idéntico byte a byte** al deshacer el renombrado sobre el JSON: ni un `metadata.name` movido, 31 y 37 hojas de 2 436 y 2 710, todas `env` de rol o guiones de inicialización |
