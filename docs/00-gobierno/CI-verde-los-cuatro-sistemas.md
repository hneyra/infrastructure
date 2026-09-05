# CI verde: los defectos del flujo `Backend` de los cuatro sistemas

**Fecha:** 2026-09-05 · **Alcance:** `rentas`, `catastro`, `normativa`, `caja` ·
**Identificadores:** C-21 (la base de prueba) y C-22 (los clones hermanos)

El flujo `Backend` de los cuatro llevaba **rojo todo el día**, en todas las corridas desde las
07:14 UTC. Nadie lo veía porque nadie miraba esos flujos, y el renombrado a Kamayuk —que ocupó el
día— no tiene nada que ver: las corridas anteriores al renombrado ya estaban rojas.

Son **tres defectos**, no dos: el tercero estaba **debajo** del primero y no se podía ver hasta
arreglarlo, porque el paso de aislamiento moría antes y el `Build completo` no llegaba a correr
nunca. Y ninguno de los tres era lo que parecía.

---

## Defecto 1 — La base de prueba no era la misma en local y en CI (C-21)

### Qué pasaba

`AislamientoMultiTenantTest` caía en `rentas`, `normativa` y `caja` con:

```
ARQ-03 — Aislamiento multi-tenant > toda tabla no exenta tiene RLS activa y forzada FAILED
  [spatial_ref_sys tiene ENABLE ROW LEVEL SECURITY] Expecting value to be true but was false
  [spatial_ref_sys tiene FORCE ROW LEVEL SECURITY …]  Expecting value to be true but was false
ARQ-03 … > toda tabla esta clasificada como de tenant, de catalogo o exenta FAILED
```

Y en `caja`, un tercer rojo que el diagnóstico inicial no mencionaba y que **nombra la causa
entera**:

```
P5D/C-10 — El esquema de la caja aplica sin ninguna extension
        > la base no tiene ninguna extension instalada, ni siquiera de rebote FAILED
  Expecting empty but was: ["fuzzystrmatch", "postgis", "postgis_tiger_geocoder", "postgis_topology"]
```

`caja` declara **cero** extensiones en su `crear-roles.sql`. Las cuatro estaban ahí de rebote.

### La causa, medida

`MotorPostgres` tenía dos caminos que parecían equivalentes y no lo eran:

| Camino | Cómo nace la base | Qué trae dentro |
|---|---|---|
| Motor externo (`kamayuk.pruebas.postgres.url`) — **el de local** | `crearBase(...)` → `sentenciaDeCreacion` → `CREATE DATABASE … TEMPLATE template0 …` | nada: `template0` está vacía |
| Testcontainers — **el de CI** | la base **por omisión del contenedor**, que `initdb` crea desde `template1` | lo que su plantilla tuviera |

Y la imagen es `postgis/postgis:16-3.4-alpine`, que instala PostGIS **en `template1`**. De ahí las
cuatro extensiones, y con ellas la tabla `spatial_ref_sys`, que no es de ningún esquema nuestro.

**Consecuencia:** `verificarAislamiento` —la prueba bloqueante más importante del producto, la que
demuestra que una municipalidad no ve las filas de otra— **no llegaba a ejecutarse en el único
sitio donde corre siempre**. En local nunca fallaba, porque en local se usa el otro camino.

Es la cuarta divergencia local/CI del día y la más cara. Y tenía además un agravante silencioso:
el javadoc de `BaseSinExtensionesTest` de `caja` **afirmaba** la premisa falsa —«`MotorPostgres.
sentenciaDeCreacion` crea la base con `TEMPLATE template0` … así que la base de cada corrida ya es
el motor más simple»— que sólo era cierta en el camino externo.

### La decisión: NO eximir la tabla

Eximir `spatial_ref_sys` en los tres sistemas cierra el rojo en un minuto y **deja el defecto
entero en pie**: local seguiría probando una base sin extensiones y CI una con ellas. Una prueba
que mide cosas distintas según dónde corra no dice lo que parece decir, y la que se estaría
midiendo mal es justo la bloqueante.

Hay además dos razones que no son de gusto:

1. **`rentas` ya había SACADO esa exención**, en P5E, con su motivo escrito en el javadoc: «la
   instalaba la extensión PostGIS, y `rentas` ya no la crea […] Una exención que ya no exime nada
   se queda dentro para siempre y la lista deja de decir lo que exime». Volver a ponerla habría
   deshecho por comodidad una decisión tomada por escrito.
2. **`caja` ya tenía una prueba que lo prohibía** (`BaseSinExtensionesTest`, C-10): «el esquema de
   la caja aplicó entero sobre esta base, así que cualquier extensión que aparezca aquí la creó
   alguien que no es este sistema». Eximir la tabla habría dejado esa prueba roja de todos modos.

**El arreglo es que los dos caminos entreguen la misma base:** el camino de Testcontainers crea
también la suya con `sentenciaDeCreacion`, desde `template0`, sobre el contenedor recién levantado.
Con eso, la base de cada corrida trae exactamente las extensiones que declara el `crear-roles.sql`
de su sistema —dos en `rentas`, tres en `catastro`, ninguna en `normativa` y en `caja`—, se llegue
por donde se llegue. `catastro` conserva su exención de `spatial_ref_sys` y ahí **sí** exime algo:
su `crear-roles.sql` crea PostGIS a propósito (ADR-0021, V61).

### Las dos guardas

- **`BaseRecienNacidaTest`** (los cuatro): la base sobre la que se prueba se llama con el prefijo
  que sólo pone `sentenciaDeCreacion`. Una base heredada —la del contenedor, o la que alguien
  nombró en la URL— no lo lleva. Con su contraste: y esa base es de verdad la que la URL del motor
  nombra.
- **`ningunaExencionSobra`** (los cuatro, dentro de `AislamientoMultiTenantTest`): toda entrada de
  `TABLAS_EXENTAS` tiene que existir como tabla en la base.

> **Y aquí una corrección al encargo:** se pedía comprobar que «la guarda ya rechaza entradas que
> sobran». **No existía ninguna.** `todaTablaEstaClasificada` mide una sola dirección —toda tabla
> está en alguna lista—, y nada medía la contraria. El javadoc de `rentas` cita
> `ningunCruceConsentidoSobra` «por la misma razón», pero esa guarda es de otra lista. La dirección
> que faltaba se añade aquí, y **encontró un hallazgo el primer día**.

### Hallazgo: una exención rancia en `caja`

`ningunaExencionSobra` puso en rojo a `caja` nada más existir, por `pg_stat_statements_info`. Su
justificación decía «sólo aparece si alguien instaló esa extensión en el cluster de pruebas; se
nombra para que una máquina que la tenga no ponga la prueba en rojo», y **no podía pasar por dos
motivos independientes**: la base va por `template0`, que no hereda extensiones del anfitrión, y
además `pg_stat_statements_info` es una **vista**, mientras que el censo de esa prueba mira
`relkind IN ('r','p')`. No eximía nada en ninguna máquina. Sale, con el porqué en su sitio.

---

## Defecto 2 — El clon hermano estaba; lo que faltaba era un directorio suyo (C-22)

### La premisa del encargo era falsa

El encargo lo daba por «el mismo defecto de reparto que el CI de `infrastructure` tenía esta mañana
—los clones hermanos van AL LADO, no dentro—». **No lo es.** `catastro/.github/workflows/backend.yml`
ya hace `checkout` con `path: catastro`, `path: infrastructure` y `path: rentas`: los clones ya son
hermanos y el espacio de trabajo ya es el padre. Lo dice el propio log del fallo, cuyas rutas son
`/home/runner/work/catastro/catastro/catastro/backend/…`.

Lo que fallaba es más fino:

```
Vectores de la huella de la anti-entropia > la huella que calcula este repositorio es la del
archivo de vectores FAILED
  [«/home/runner/work/catastro/catastro/rentas/docs/50-api/anti-entropia/huella-del-lote.json»
   no existe. Lo publica «rentas» …]
```

El `sparse-checkout` del clon de `rentas` nombraba **un solo directorio**,
`docs/50-api/contratos-que-consume`, escrito cuando era el único que hacía falta. `VectoresDeHuellaTest`
(P6, commit `1e46079`) añadió un segundo lector —`docs/50-api/anti-entropia`— y **nada ataba esa
lista a lo que las pruebas leen de verdad**. El rojo aparecía sólo en CI, sobre un archivo que en
local está.

### El arreglo, y lo que se decidió no hacer

Se nombran los **dos** directorios. **No** se trae el clon entero ni se ensancha a `docs/50-api`:
`rentas/docs/50-api` pesa **1,1 MB** —casi todo prototipo y OpenAPI— y traerlo por dos archivos
sería pagar el clon de otro sistema en cada corrida, que es exactamente lo que el comentario del
workflow ya razonaba.

---

## Defecto 3 — Y debajo del primero había dos roturas más de la misma familia (C-22)

Con el aislamiento arreglado, el `Build completo` corrió **por primera vez en el día** y aparecieron
dos roturas más, del mismo tipo que el defecto 2 y con otras dos formas:

```
rentas:   A problem was found with the configuration of task ':kamayuk-rentas-coactiva:test'
          Input file does not exist
            '/…/normativa/docs/10-negocio/valores-normativos/publicacion/parametros-2026.csv'
catastro: No esta /…/rentas/infra/carga-de-datos/ejemplos/contribuyentes.csv. `fichas.csv` cruza
          sus titulares contra el padron de demostracion, que desde P5C vive en `rentas`
```

### Las tres formas de pedirle algo a un hermano

| Forma | Cómo se declara | Cómo falla |
|---|---|---|
| **Entrada de Gradle** | `inputs.file(rootProject.file("../../X/…"))` | Se resuelve al **configurar** la tarea: «Input file does not exist», y no corre ni una prueba |
| **Prueba de contrato** | `ContratoConElConsumidorTestBase`, `VectoresDeHuellaTestBase` | La prueba cae diciendo «no existe», que se lee como si el otro sistema no lo hubiera publicado |
| **Ruta a mano** | un literal `"rentas/infra/carga-de-datos/…"` dentro de una prueba | Igual, y **ninguna de las otras dos guardas la vería** |

`rentas` pide cosas de **tres** hermanos y su workflow traía **uno**: faltaban `normativa`
(`docs/10-negocio/valores-normativos/publicacion`, declarado por `valores`, `coactiva` y `nucleo`) y
`catastro` (`docs/50-api/eventos` para `IngestionDeCatastroJdbcTest`, más
`infra/carga-de-datos/ejemplos` para `ArchivosDeEjemploDeRentasTest`). A `catastro` le faltaba
además `rentas/infra/carga-de-datos/ejemplos`.

La tercera forma se encontró **porque la guarda no la veía**: se escribió con las dos primeras, el
CI volvió a ponerse rojo, y el javadoc de la guarda ya declaraba ese hueco como su límite conocido.
Ahora está dentro.

### La guarda: `ClonesHermanosDelWorkflowTest` (en `rentas` y en `catastro`)

No lleva las rutas escritas. Las saca de tres sitios: los `rootProject.file("../../X/…")` de los
`build.gradle.kts`, los mismos métodos que las pruebas de contrato usarán al correr —`archivo()` y
`archivoDelConsumidor()`— y los literales de ruta del código de prueba. Luego lee los
`sparse-checkout` del workflow y exige que los cubran. Una lista a mano sería el segundo sitio donde
olvidarse de un directorio, que es el defecto que esto cierra. Lleva su contraste: y el
`sparse-checkout` que se lee es el del workflow, no una copia —sin él, «todo cubierto» sería
compatible con no haber encontrado ningún `checkout`—.

**Su límite, escrito en su javadoc:** una ruta compuesta en tiempo de ejecución a partir de trozos no
la vería. Eso es un **falso negativo**, nunca lo contrario: no puede dar por bueno un directorio que
falte de los que sí conoce.

`normativa` y `caja` no necesitan la guarda y se comprobó por qué: no piden nada de ningún hermano
por ninguna de las tres formas.

---

## Las mutaciones

Cada arreglo con la suya, aplicada sola, medida, y restaurada **por copia comparada con `cmp`**.

| # | Mutación | Dónde | Resultado |
|---|---|---|---|
| A | Añadir `spatial_ref_sys` a `TABLAS_EXENTAS` — **la salida cómoda que se rechazó** | `normativa` | **1 en rojo**, nombrando la tabla: `Expecting all elements of: ["flyway_schema_history", "spatial_ref_sys"] … "spatial_ref_sys"` |
| B | Conectar el pool como **superusuario del clúster** | `normativa` | **8 de 43 en rojo**, el centinela `La trampa de la conexion por omision` incluido. `verificarAislamiento` sigue mordiendo después del cambio |
| C | Devolver el `sparse-checkout` a un solo directorio | `catastro` | **1 en rojo**: «el checkout de «rentas» trae `[docs/50-api/contratos-que-consume]`, y esta prueba lee `docs/50-api/anti-entropia/huella-del-lote.json`, que no cae bajo ninguno». El contraste sigue **verde**, que es la prueba de que cada aserción mide lo suyo |
| D | Quitar el `checkout` de `normativa` — **la forma «entrada de Gradle»** | `rentas` | **1 en rojo**: «este repositorio pide «normativa/docs/…/parametros-2026.csv» y el workflow no hace checkout de «normativa»» |
| E | Quitar `infra/carga-de-datos/ejemplos` — **la forma «ruta a mano»** | `catastro` | **1 en rojo**: «el checkout de «rentas» trae `[…]`, y aquí se pide `infra/carga-de-datos/ejemplos/contribuyentes.csv`, que no cae bajo ninguno» |
| F | Quitar el arreglo del camino de Testcontainers | los cuatro | **No hubo que provocarla:** es el estado del que se partió, y sus cuatro corridas rojas están abajo con el mensaje exacto |

**Sobre B, que es la que se pide y la que más se equivoca:** se escribió con el **superusuario del
clúster** (`postgres`, `rolsuper = t`) y **no** con `kamayuk_owner`. Con `FORCE ROW LEVEL SECURITY`
el dueño de las tablas también queda sujeto a la política, así que la mutación escrita con él pasa
en **verde** y no demuestra nada. Es un modo de fallo que en el histórico del producto ha aparecido
cinco veces.

**Hueco declarado en las mutaciones.** La mutación F —devolverle a `resolver()` el
`contenedor.getJdbcUrl()` pelado— **sólo se puede medir donde corre el camino de Testcontainers, y
eso es CI**: esta máquina no tiene runtime de contenedores local (el contexto activo de Docker
apunta a un VPS remoto, y usarlo habría sido correr contenedores en máquina ajena). Contra el motor
externo, `BaseRecienNacidaTest` pasa igual con el defecto dentro. Está dicho en el javadoc de la
propia prueba, para que nadie concluya de un verde local que la ha comprobado.

---

## Estado real de las corridas

### Antes (las cuatro rojas, con su id)

| Sistema | Corrida | Qué cayó |
|---|---|---|
| `rentas` | `33979433015` | `AislamientoMultiTenantTest`: `spatial_ref_sys` sin RLS y sin clasificar |
| `catastro` | `33979435426` | `VectoresDeHuellaTest`: el archivo de vectores del clon de `rentas` no existe |
| `normativa` | `33979437768` | igual que `rentas` |
| `caja` | `33979440703` | igual que `rentas`, **más** `BaseSinExtensionesTest`: cuatro extensiones de rebote |

### Después

**Los cuatro `Backend` en verde**, comprobado en la corrida real y no en local:

| Sistema | Corrida `Backend` | Commit | Resultado |
|---|---|---|---|
| `rentas` | `33981784823` | `9121709` | **success** |
| `catastro` | `33981786384` | `b64c25f` | **success** |
| `normativa` | `33981029800` | `3c5ad5c` | **success** |
| `caja` | `33981163899` | `fe1d73d` | **success** |

Y los cuatro `Infraestructura` siguen verdes, sin haberlos tocado: `33979433031`, `33979435510`,
`33979437757`, `33979440659`. No se volvieron a disparar porque su filtro `paths` es
`["infrastructure/**", ".github/workflows/infraestructura.yml"]` y ninguno de los archivos de este
trabajo cae ahí — lo cual es la respuesta correcta, no un descuido.

**Ningún rojo sobrevive.** Los tres defectos se arreglaron en dos vueltas: la primera dejó
`normativa` y `caja` en verde y destapó en `rentas` y `catastro` el defecto 3, que estaba debajo;
la segunda cerró los cuatro.

---

## Las cifras

Se cuentan sumando las **dos** tareas (`test` + `pruebaDeArranque`), como pide el encargo; con una
sola salen cuatro por debajo y parecen una regresión. Medido con `cleanTest build --no-build-cache`.

| Sistema | Antes | Después | Diferencia |
|---|---|---|---|
| `rentas` | 3 145 | **3 150** | +5 |
| `catastro` | 994 | **999** | +5 |
| `normativa` | 620 | **623** | +3 |
| `caja` | 690 | **693** | +3 |

+3 en cada uno son `BaseRecienNacidaTest` (2) y `ningunaExencionSobra` (1); los dos de más de
`rentas` y `catastro` son su `ClonesHermanosDelWorkflowTest`.

---

## Lo que este trabajo NO tocó

- **`infrastructure`**: otro agente estaba arreglando sus trabajos `motor`, `secretos` y
  `observabilidad-tableros`. Se leyó su código —para comparar el patrón de los clones hermanos— y
  **no se editó nada suyo**; este documento es el único archivo escrito ahí. **Y no hace falta
  ningún cambio en `infrastructure` para estos dos defectos:** los dos se arreglan en los
  repositorios de los sistemas.
- El repositorio `sgtm`.
- Ningún clúster, ningún `pulumi`, ningún despliegue.
- Los flujos `Infraestructura` de los cuatro, que estaban verdes y siguen estándolo: ninguno de los
  archivos tocados entra en sus rutas.
