# C-4 — PostgreSQL 18: el hallazgo era otro, y era de la 16

> **Estado: cerrado, con seis huecos declarados en §8.**
>
> El encargo pedía decidir entre soportar PostgreSQL 18 o declararlo no soportado. **Medirlo
> antes de tocar código cambió la pregunta**: el cuerpo de `nombre_normalizado` depende del
> `search_path` de la sesión, y eso no rompe sólo en PG 18 — rompe **la restauración lógica en
> PostgreSQL 16**, que es la versión que este producto despliega. `pg_dump` vacía el
> `search_path`, y al restaurar:
>
> | Esquema | `pg_restore` sobre PG 16.15 | Lo que se pierde |
> |---|---|---|
> | **`catastro`** | **85 errores**, código de salida **0** | **`via` no se crea**, y con ella todo lo que la referencia. 86 índices → **82** |
> | **`rentas`** | 1 error, código de salida **0** | `contribuyente_nombre_trgm_ix` |
> | **`sgtm`** | 2 errores, código de salida **0** | el mismo índice, y su `COMMENT` |
> | `normativa`, `caja` | 0 errores | — |
>
> **La decisión: se arregla la función —por la 16, no por la 18— y PostgreSQL 18 se declara NO
> SOPORTADO, con guarda.** Las dos cosas, con su argumento, en §3.
>
> Cifras: **infrastructure 379 → 389** (+10). **rentas 3 102 → 3 106 · catastro 958 → 962 ·
> caja 669 → 673 · normativa 602 → 606** (+4 cada uno, las cuatro de la guarda). Ninguna baja.
> `sgtm` **sin tocar**, HEAD `0d33ad7b`.

---

## 0. Lo que la medición corrigió del encargo

Tres cosas cambiaron al comprobarlas contra el árbol, y las tres cambian **qué** hay que hacer:

1. **No falla en los cuatro: falla en `rentas`, y el hallazgo de P3 se refería a `sgtm`.**
   `catastro` declara la misma función y **sí aplica en PG 18**, porque su único uso es una
   columna generada y no un índice. `normativa` y `caja` no tienen la función. El encargo
   pedía comprobarlo, y la respuesta es que dos de los cinco esquemas no lo tienen.

2. **El defecto no es de PostgreSQL 18.** Lo que PG 17 hizo fue **ensanchar** la superficie de
   un defecto que ya estaba: `pg_dump` vacía el `search_path` desde siempre, así que la
   restauración lógica ya estaba rota en 16. Y el modo de fallo es el peor de esta familia:
   `pg_restore` lo dice como **aviso** —«errors ignored on restore»— y **termina con código de
   salida 0**. Nadie se entera.

3. **El índice que este trabajo salva no lo usa nadie hoy.** Midiendo el plan que el criterio 3
   pedía salió un hallazgo que no estaba en el encargo: bajo RLS, `contribuyente_nombre_trgm_ix`
   **es inalcanzable**. Es el quinto hallazgo de `DAT-01` §0 por sexta vez, y con el plan
   diciendo «Index» igual. Está en §5, y **no se arregla aquí**.

Y una cuarta, que no cambia el trabajo pero sí lo que se puede prometer: `rentas` y `catastro`
**no declaran ningún ambiente** —no hay `infra/Pulumi.*.yaml` en ninguno de los dos—, así que
editar su `V1__baseline.sql` sería legítimo hoy. Aun así **no se editó**, por lo que dice §4.1.

---

## 1. El error reproducido, con su línea, en cada baseline

Contra un PostgreSQL **18.6** levantado con `initdb` del 18 en el puerto 55418 —apagado al
terminar, §8 hueco 6—. El procedimiento es el mismo que usa el despliegue: `crear-roles.sql`
como superusuario, y después las migraciones en orden de versión.

| Esquema | ¿Aplica en PG 18? | Dónde muere |
|---|---|---|
| **`rentas`** | **NO** | `V1__baseline.sql:2923` |
| **`sgtm`** | **NO** | `V11__busqueda_por_aproximacion.sql:44` |
| `catastro` | sí | — |
| `normativa` | sí | — |
| `caja` | sí | — |

El error, idéntico en los dos:

```
psql:.../V1__baseline.sql:2923: ERROR:  text search dictionary "unaccent" does not exist
LINE 3:                lower(unaccent('unaccent'::regdictionary, coa...
                                      ^
QUERY:
    SELECT regexp_replace(
               lower(unaccent('unaccent'::regdictionary, coalesce(texto, ''))),
               '\s+', ' ', 'g');
CONTEXT:  SQL function "nombre_normalizado" during inlining
```

La línea 2923 de `rentas` es
`CREATE INDEX contribuyente_nombre_trgm_ix ... USING gin (nombre_normalizado(...) gin_trgm_ops)`,
y la 44 de `sgtm` es ese mismo índice en el monolito.

Por Gradle, con la salida de emergencia apuntada a ese motor, sale envuelto en Flyway y en
cuarenta líneas de traza:

```
org.flywaydb.core.internal.exception.FlywayMigrateException: Failed to execute script V1__baseline.sql
SQL State  : 42704
Message    : ERROR: text search dictionary "unaccent" does not exist
  Wobei: SQL function "nombre_normalizado" during inlining
Line       : 2923
```

### 1.1 Por qué `catastro` aplica y `rentas` no

Porque lo que PostgreSQL 17 restringió es el `search_path` de `CREATE INDEX` (y `REINDEX`,
`CLUSTER`, `VACUUM FULL`, `REFRESH MATERIALIZED VIEW`) a `pg_catalog, pg_temp`. Medido caso a
caso en el laboratorio, sobre las dos versiones:

| Sitio donde se usa la función | PG 16.15 | PG 18.6 |
|---|---|---|
| Llamada directa (`SELECT nombre_normalizado(...)`) | pasa | **pasa** |
| Un `SELECT` que la inserta en línea | pasa | **pasa** |
| Columna generada (`GENERATED ALWAYS AS ... STORED`), al crear y al insertar | pasa | **pasa** |
| **Expresión de índice** (`CREATE INDEX ... (nombre_normalizado(x))`) | pasa | **FALLA** |

`catastro` sólo la usa en la columna generada de `via.nombre_busqueda`; `rentas` la usa además
en el índice de trigramas del padrón, que es de `rentas` (RF-014).

---

## 2. El mecanismo, y por qué el defecto es más viejo que PG 17

Dentro de ese cuerpo hay **dos** nombres que se resuelven por `search_path`, y hacen falta los
dos para entender el arreglo:

1. la **función** `unaccent(regdictionary, text)`, que vive en `public` porque ahí la instala la
   extensión;
2. el **literal** `'unaccent'::regdictionary`, cuya conversión de entrada busca el diccionario
   en el catálogo exactamente igual que se busca una tabla.

Medido: con `SET search_path = pg_catalog, pg_temp`, en **las dos versiones**,
`public.unaccent('unaccent'::regdictionary, 'PEÑA')` falla y
`public.unaccent('public.unaccent'::regdictionary, 'PEÑA')` funciona. **Cualificar sólo una de
las dos mitades no sirve**, y eso también se midió: con el diccionario cualificado y la función
no, PG 18 contesta `function unaccent(regdictionary, text) does not exist`.

### 2.1 `pg_dump` vacía el `search_path`, y ahí estaba el defecto de verdad

Todo volcado de `pg_dump` —en las dos versiones, desde hace años— empieza por:

```sql
SELECT pg_catalog.set_config('search_path', '', false);
```

`pg_dump` **cualifica con su esquema todos los identificadores que emite** —los tipos, los
operadores, las clases de operadores—, y por eso lo demás se restaura sin problema. Lo único que
no puede cualificar es el **interior de un cuerpo de función**, que para él es una cadena opaca
y vuelve a salir tal cual se escribió.

Medido contra **PostgreSQL 16.15**, la versión que este producto despliega:

```
$ pg_dump -Fc -d rentas ... && pg_restore -d restaurada ...
pg_restore: error: could not execute query: ERROR:  text search dictionary "unaccent" does not exist
  CONTEXT:  SQL function "nombre_normalizado" during inlining
  Command was: CREATE INDEX contribuyente_nombre_trgm_ix ON public.contribuyente
               USING gin (public.nombre_normalizado((nombre_razon_social)::text)
                          public.gin_trgm_ops);
pg_restore: warning: errors ignored on restore: 1
```

Y en `catastro` es peor, porque la expresión de una **columna generada** también se inserta en
línea, y se inserta al **crear la tabla**:

```
pg_restore: error: could not execute query: ERROR:  text search dictionary "unaccent" does not exist
  CONTEXT:  SQL function "nombre_normalizado" during inlining
  Command was: CREATE TABLE public.via ( ... nombre_busqueda text
               GENERATED ALWAYS AS (public.nombre_normalizado((nombre)::text)) STORED );
pg_restore: error: could not execute query: ERROR:  relation "public.via" does not exist
...
pg_restore: warning: errors ignored on restore: 85
```

**`via` no se crea**, y detrás se caen `predio`, `arancel`, sus claves foráneas, sus comentarios
y sus índices: 86 índices en el original, **82** en la restaurada, 85 errores, y `pg_restore`
sale con **0**.

**Lo que esto NO afecta**, y conviene decirlo para no exagerar el alcance: el respaldo de
`INF-08` es **físico** (wal-g / PITR), copia bloques y no reconstruye nada, así que el simulacro
de restauración no estaba tocado. Lo que estaba roto es todo camino **lógico**: `pg_dump` /
`pg_restore`, una migración de ambiente, una copia de `prod` a `stg`, un `pg_upgrade --link`
seguido de `REINDEX`.

---

## 3. La decisión, y su argumento

Son **dos** decisiones, y el encargo las presentaba como una. Separarlas es lo que permite ser
honesto en las dos.

### 3.1 La función se arregla — y el motivo es PostgreSQL 16, no la 18

Se cualifican las dos mitades:

```sql
lower(public.unaccent('public.unaccent'::regdictionary, coalesce(texto, '')))
```

No es una concesión a PG 18 ni un arreglo cosmético. Es que **hoy, en la versión que se
despliega, una restauración lógica de `catastro` no reconstruye ni la tabla `via`**, y no lo dice
nadie. El arreglo cuesta una línea, no cambia ningún valor, no cambia el plan (§4.3) y cierra un
camino de recuperación que estaba roto en silencio.

### 3.2 PostgreSQL 18 se declara NO SOPORTADO, con guarda

Y **no** porque no funcione. Con el arreglo puesto y aplicado sobre el baseline, `rentas` y
`catastro` aplican los dos en PG 18 — se midió. Es porque **soportar una versión es una promesa
que algo tiene que sostener**, y aquí no hay nada que la sostenga:

| Lo que haría falta | Estado |
|---|---|
| Que CI corriera contra PG 18 | **No.** Los cinco `backend.yml` hacen `docker pull postgis/postgis:16-3.4-alpine`, y añadir un trabajo exige tocar `.github/workflows/`, que esta sesión no empuja (§8, hueco 4) |
| Que los ambientes lo desplegaran | **No.** `Pulumi.prod.yaml`, `Pulumi.stg.yaml`, los dos `compose` y `respaldo/contra-cluster.sh` dicen `postgis/postgis:16-3.4-alpine`. Cambiarlo es una decisión de quien opera los despliegues (D-22), no de una corrección |
| Que las pruebas de plan valieran | **Sin medir.** #313, #536, #561 y #565 afirman planes concretos, y el planificador de PG 18 no es el de PG 16 |
| Que el monolito lo aguantara | **No, y no puede.** `sgtm` es archivo histórico: su `V11` es una migración **aplicada**, editarla cambia su suma de Flyway, y no admite migraciones nuevas. El monolito se queda sin aplicar en PG 18 para siempre |

Una versión «soportada» que ninguna corrida ejercita es exactamente el **verde rancio** que este
proyecto lleva doscientos issues evitando (#192 §2, #399, #675). Así que se declara la 16, y
—esto es lo que faltaba— **se comprueba**.

### 3.3 Lo que se decidió NO hacer, y por qué

- **No se editó `V1__baseline.sql`.** Ver §4.1. La consecuencia asumida es que `rentas` **sigue
  sin aplicar desde cero en PG 18**: `V1` corre antes que `V11`. Es coherente con 3.2 — no se
  gasta el margen de un archivo aplicado en una versión que no se soporta.
- **No se dio puerta de escape a la guarda.** Una propiedad para saltarla es la que alguien pone
  para que el build deje de quejarse. Medir otra versión se hace fuera de Gradle, que es como se
  midió esto.
- **No se arregló el índice inalcanzable de §5.** Cambiar cómo busca el padrón es otro trabajo,
  con su medida y su decisión.
- **No se tocó `sgtm`.** Ni siquiera para mutar y restaurar: el esquema del monolito se aplicó y
  se volcó desde bases de usar y tirar, sin escribir en el repositorio.

---

## 4. El arreglo

### 4.1 Una migración nueva, no una edición del baseline

`rentas/…/V11__nombre_normalizado_sin_search_path.sql` y
`catastro/…/V4__nombre_normalizado_sin_search_path.sql`, las dos un `CREATE OR REPLACE FUNCTION`.

Editar `V1` cambia su suma de Flyway y deja «la base de al lado distinta sin que nada se ponga
rojo», que es el modo de fallo que la propia cabecera de los cuatro baselines describe. Y no
hace falta: **`pg_dump` vuelca el esquema FINAL**, así que lo que se restaura es este cuerpo y no
el de `V1`. Es el mismo reparto que `V58`, `V64` y `V77` en el monolito.

### 4.2 Lo que el reemplazo no cambia, medido

1. **El valor.** `nombre_normalizado('PEÑA  GARCÍA')` da `pena garcia` con las cuatro variantes
   probadas. Por eso no hay que reconstruir el índice ni reescribir `via.nombre_busqueda`: lo
   almacenado sigue siendo correcto.
2. **El índice.** `CREATE OR REPLACE` sobre una función usada por un índice se acepta, y el
   índice queda `indisvalid = t, indisready = t`.
3. **La ida y vuelta, que es lo que se venía a arreglar:**

| Esquema | Antes | Después |
|---|---|---|
| `rentas` | 1 error, índice perdido | **0 errores**, 346 → 346 índices |
| `catastro` | 85 errores, `via` ausente, 86 → 82 | **0 errores**, 86 → 86 índices, 33 tablas |

### 4.3 El plan, antes y después (criterio 3)

Medido con `EXPLAIN (ANALYZE, BUFFERS)` sobre **60 000 contribuyentes en dos municipalidades**,
conectado como **`sgtm_app`** y con RLS activa, con la consulta real de
`ContribuyenteRepositoryJdbc`.

```
=== PG 16.15, función ORIGINAL ===                === PG 16.15, función CUALIFICADA ===
Limit                                             Limit
  Buffers: shared hit=1133                          Buffers: shared hit=1133
  -> Sort (top-N heapsort  Memory: 27kB)            -> Sort (top-N heapsort  Memory: 27kB)
     -> Bitmap Heap Scan on contribuyente              -> Bitmap Heap Scan on contribuyente
        Recheck Cond: (municipalidad_id = ...)            Recheck Cond: (municipalidad_id = ...)
        Filter: (similarity(...) >= '0.3')                Filter: (similarity(...) >= '0.3')
        Rows Removed by Filter: 29750                     Rows Removed by Filter: 29750
        Heap Blocks: exact=1011                           Heap Blocks: exact=1011
        -> Bitmap Index Scan on contribuyente_pk          -> Bitmap Index Scan on contribuyente_pk
           Index Cond: (municipalidad_id = ...)              Index Cond: (municipalidad_id = ...)
Execution Time: 109.843 ms                        Execution Time: 105.150 ms
```

**Idéntico**: los mismos nodos, el mismo `Index Cond`, las mismas `shared hit=1133` y las mismas
29 750 filas descartadas. Y en PG 18.6 con la función cualificada, la misma forma exacta
(`shared hit=1133`, 94.108 ms). `pg_get_indexdef` tampoco se mueve.

---

## 5. Lo que salió de medir ese plan, y no se arregla aquí

**`contribuyente_nombre_trgm_ix` no lo usa nadie bajo RLS.** Se ve en el plan de arriba: el
`Bitmap Index Scan` es sobre `contribuyente_pk`, por la condición de la **propia política**, y el
`similarity(...)` se queda en el `Filter` descartando 29 750 filas de 30 000.

Son **dos** cosas, y conviene separarlas:

1. **El operador `%` no llega al índice bajo RLS.** `similarity_op` tiene `proleakproof = f`
   —medido en `pg_proc`—, así que PostgreSQL no puede evaluarlo antes de la política. Como
   **superusuario**, que omite RLS, el mismo `%` **sí** usa el índice GIN:

   ```
   como sgtm_app :  Bitmap Index Scan on contribuyente_pk           1127 buffers, 100.0 ms
   como superusuario: Bitmap Index Scan on contribuyente_nombre_trgm_ix  1090 buffers,  36.2 ms
   ```

   Es el **quinto hallazgo de `DAT-01` §0** otra vez —`textlike` con el `LIKE`,
   `geography_overlaps` con el marco espacial—, con el mismo síntoma engañoso: **el plan sigue
   diciendo «Index»**.

2. **Y la consulta de producción ni siquiera usa `%`**: usa `similarity(...) >= 0.30`, que
   `gin_trgm_ops` no sabe responder ni sin RLS. Ese índice no lo usaría nadie aunque la política
   no estuviera.

No hay salida barata como la del `LIKE` —que se reescribió como rango con operadores que **sí**
son *leakproof*— ni como la de `V66` —una columna generada—: lo que no es *leakproof* aquí es el
**operador**, no la función.

Queda escrito en la cabecera de `rentas/V11` y **no se arregla en C-4**: es otro trabajo. Lo que
C-4 sí hace es que el índice sobreviva a una restauración, para que esté el día que ese trabajo
lo haga útil.

---

## 6. Las dos guardas, y sus mutaciones

Son dos porque guardan cosas distintas: una que **no se pruebe contra un motor que no
soportamos**, y otra que **el arreglo no se deshaga solo**.

### 6.1 `MotorPostgres.exigirVersionSoportada()` — los cuatro sistemas

Junto a `exigirCodificacionUtf8()` (#706), con el mismo reparto: la decisión la sujeta una
función pura que `VersionDelMotorTest` ejercita con 15, 16, 17 y 18 sin necesitar cuatro
motores; el motor real lo comprueba `iniciar()` en cada arranque.

**El hueco que cierra es concreto**: el camino de Testcontainers fija la imagen, pero la salida
de emergencia `kamayuk.pruebas.postgres.url` —la que usa toda máquina sin Docker, y con la que se
midió P3 entero— apunta al motor que tenga quien construye. En la máquina donde se escribió esto,
`psql --version` devuelve **18.6** mientras el producto despliega 16.

**Demostrado que muerde, contra el PostgreSQL 18.6 de verdad:**

```
# con la guarda puesta (normativa, cuyo esquema SÍ aplicaría en 18):
ARQ-03 — Aislamiento multi-tenant > initializationError FAILED
    java.lang.IllegalStateException: El motor de prueba es PostgreSQL 18, y este producto se
    prueba y se despliega contra PostgreSQL 16 (postgis/postgis:16-3.4-alpine, en los dos
    Pulumi, en los dos compose y en la imagen por omision de este mismo motor). De 17 en
    adelante NO es solo que no este probado: [...] El motivo entero, con lo que se midio, esta
    en infrastructure/docs/00-gobierno/C-4-postgresql-18.md

# quitando la llamada a la guarda (rentas, contra el mismo motor) — el estado anterior a C-4:
org.flywaydb.core.internal.exception.FlywayMigrateException: Failed to execute script V1__baseline.sql
Message : ERROR: text search dictionary "unaccent" does not exist
  Wobei: SQL function "nombre_normalizado" during inlining
Line    : 2923
                                                    (+ ~40 lineas de traza de Flyway)
```

Las cuatro pruebas por repositorio incluyen **el contraste** —que la 16 se admita, porque una
guarda que dijera que no a todo pondría en rojo el camino bueno— y que **los dos lados digan
cosas distintas**: de 17 en adelante hay un defecto medido, por debajo de 16 lo único que hay es
que nadie lo ha probado. Darles el mismo texto afirmaría un defecto que nadie ha visto.

### 6.2 `search-path-en-el-cuerpo-de-la-funcion.ts` — en `infrastructure`

Porque **el arreglo de §4 se puede deshacer solo**, y es la lección de C-3: los baselines son
**generados**, y su origen es una base construida desde el `V11` del monolito, que no se puede
arreglar. Una regeneración vuelve a emitir el cuerpo frágil, y —por lo invisible que es este
defecto— nadie se enteraría. Esta guarda es lo único que puede ponerse rojo ese día.

Mide **las seis copias del esquema**, derivadas de `esquemas()` como C-2 y C-3, y mira el estado
**final** de cada función (la última definición gana), porque es lo que `pg_dump` vuelca.

Alcance, acotado a lo medido: sólo los cuerpos `LANGUAGE sql` —los únicos que PostgreSQL inserta
en línea—, y sólo los nombres que de verdad se resuelven por `search_path`: literales `reg*` sin
esquema y llamadas a funciones que aporta una extensión. **El censo de falsos positivos se midió
antes de elegir el alcance: cero**, en las seis copias, para las dos mitades del patrón.

| # | Mutación | Rojo |
|---|---|---|
| 1 | quitar `V11` de `rentas` | **1 de 10** — el censo nombra `rentas · V1__baseline.sql · 'unaccent'::regdictionary` y `· unaccent(...)` |
| 2 | quitar `V4` de `catastro` | **1 de 10** — lo mismo, nombrando `catastro` |
| 3 | quitar una entrada de `FRAGILIDADES_QUE_NO_SE_ARREGLAN` | **1 de 10** — el censo vale en las dos direcciones, como `DECLARADAS_DE_MAS` en C-2 |
| 4 | aparcar `pg_trgm` en «sólo aporta tipos» y vaciar sus tres funciones | **PASÓ EN VERDE.** Ver abajo |
| — | el contraste: las tres funciones en regla de la muestra —incluida una `plpgsql` y un `CREATE INDEX` suelto— **no** salen | verde, y es lo que impide que la guarda grite |

**La mutación 4 es la que más enseña, porque encontró un agujero en la propia guarda.** La
primera versión declaraba `SOLO_APORTAN_TIPOS = ["postgis"]`, una lista de nombres a secas. Con
eso, mover `pg_trgm` ahí —y vaciar `similarity`, `word_similarity` y `show_trgm` de
`FUNCIONES_DE_EXTENSION`— dejaba **las nueve pruebas en verde**: la comprobación de cobertura se
daba por satisfecha y las tres funciones dejaban de vigilarse sin que nada lo dijera. Es el
defecto de #742 —una lista que deja de cubrir en silencio— **dentro de la guarda escrita para no
repetirlo**.

Se cierra haciendo la afirmación falsable: la lista lleva ahora **los tipos que son**, y la
prueba exige lo que de verdad separa un tipo de una función — el patrón tiene que reconocer
`geography(Point,4326)`, porque un modificador de tipo lleva algo dentro, y **no** reconocer
`geography()`, que sólo puede ser una llamada. Con eso, la misma mutación dice:

```
AssertionError: «similarity» esta declarado como TIPO y su patron casa con similarity(),
que solo puede ser una llamada: entonces es una funcion y va en FUNCIONES_DE_EXTENSION
```

Y por lo mismo, los nombres de `FUNCIONES_DE_EXTENSION` **no se derivan** leyendo el `source` de
los patrones de `REGLAS`: se probó, funciona, y es la clase de atajo que se rompe en silencio en
cuanto alguien escribe el patrón de otra forma.

---

## 7. Las cifras

| Repositorio | Antes | Después | Qué se añadió |
|---|---:|---:|---|
| `infrastructure` | 379 | **389** | la guarda de §6.2: 10 pruebas |
| `rentas` | 3 102 | **3 106** | `VersionDelMotorTest`, 4 |
| `catastro` | 958 | **962** | ídem |
| `caja` | 669 | **673** | ídem |
| `normativa` | 602 | **606** | ídem |
| `sgtm` | — | — | **sin tocar**, HEAD `0d33ad7b`, `git status` vacío |

`yarn verificar` de `infrastructure` en verde: lint, `tsc --noEmit` en los dos `tsconfig` y 389
pruebas en 19 archivos. `build` de los cuatro backends en verde —con Spotless, Checkstyle y
NullAway— y `verificarAislamiento` + `verificarArquitectura` corridos aparte con `cleanTest
--no-build-cache`, porque una tarea que sale `FROM-CACHE` no demuestra nada.

Todo contra **PostgreSQL 16.15 real** en `127.0.0.1:55444` y no por Testcontainers: el demonio de
Docker de esta máquina es un túnel a un VPS y el puerto publicado del contenedor se queda allí.

---

## 8. Huecos declarados

1. **`sgtm` se queda roto en las dos direcciones, y no se puede arreglar.** Su `V11` no aplica en
   PG 17+, y un `pg_dump` del monolito se restaura con 2 errores y **sin**
   `contribuyente_nombre_trgm_ix`. `V11` es una migración aplicada del archivo histórico:
   editarla cambia su suma de Flyway, y el monolito no admite migraciones nuevas. Está declarado
   en `FRAGILIDADES_QUE_NO_SE_ARREGLAN`, en el código y no en un documento, y el censo lo compara
   en las dos direcciones para que no se pueda quedar rancio.

2. **`rentas` sigue sin aplicar desde cero en PG 18.** `V1` corre antes que `V11`. Es
   consecuencia deliberada de §4.1 y de §3.2, no un descuido — pero si algún día se decide
   soportar 17 o 18, esto es lo primero que hay que volver a mirar, y la guarda de §6.2 lo dice
   en su javadoc porque mide el estado final y no cada migración suelta.

3. **La restauración lógica no la comprueba nadie de forma continua.** Lo que C-4 arregla se
   midió a mano con `pg_dump` / `pg_restore`; la guarda de §6.2 mira **texto**, no un motor. Un
   `pg_restore` que fallara por otro motivo —otra función, otro camino— seguiría saliendo con
   código 0 y sin que nada lo dijera. Un simulacro de restauración **lógica**, hermano del físico
   de `INF-08`, no existe y sería el trabajo que cierra esto de verdad.

4. **La guarda de §6.2 sólo se dispara en los PR de `infrastructure`.** Es el mismo hueco que
   C-2 §6.1 y #675 dejaron abierto: el filtro `paths` de `infra.yml` sólo nombra rutas de este
   repositorio, así que un PR de `rentas` que regenere su baseline **no ejecuta esta guarda**; lo
   hará el siguiente PR que toque `infra/`. Se cierra con un `repository_dispatch`, que no está
   hecho. Y añadir un trabajo de CI contra PG 18 —que es lo que haría soportable la versión—
   exige tocar `.github/workflows/`, que esta sesión no empuja.

5. **La versión de PostgreSQL se nombra hoy en seis sitios y la guarda sólo ata uno.**
   `Pulumi.prod.yaml`, `Pulumi.stg.yaml`, `despliegue/compose.yaml`,
   `despliegue/plataforma.compose.yaml`, `respaldo/contra-cluster.sh` y el
   `IMAGEN_POR_OMISION` de cada `MotorPostgres`. `MotorPostgres.MAJOR_SOPORTADA` tiene una prueba
   que fija el 16 y los nombra en su mensaje, pero **no los lee**: subir ese número
   sin mover las imágenes deja la guarda admitiendo una versión que no se despliega en ninguna
   parte. Atarlos es el mismo trabajo que C-2 §6.2 dejó pendiente para las extensiones.

6. **El motor de PostgreSQL 18 se apagó al terminar**, y su directorio de datos vivía en el
   directorio temporal de la sesión. No se tocó el motor 16 de `127.0.0.1:55444` ni ningún
   contenedor. Las bases de usar y tirar creadas para medir siguen en ese motor 16 con nombres
   `c4_*`, `r_*`, `rentas_*`, `catastro_*`, `lab16`, `fixes16`: son de laboratorio y se pueden
   borrar, pero **no se borraron**, porque el motor lo comparten otras correcciones y borrar en
   él sin avisar es peor.

---

## 9. Lo que se decidió no hacer

- **No se convirtió el arreglo en «soportamos PostgreSQL 18».** Ver §3.2: la promesa no la
  sostendría nada.
- **No se editó ningún baseline.** Ver §4.1.
- **No se arregló la búsqueda del padrón**, aunque su índice sea inalcanzable bajo RLS (§5). Es
  otro trabajo, y hacerlo de paso aquí lo dejaría sin su propia medida.
- **No se escribió una segunda lista de repositorios** en la guarda de §6.2: sale de
  `esquemas()`, como en C-2 y C-3. Sería el defecto de #742 otra vez.
