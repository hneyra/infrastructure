# C-12 — El índice trigrama: inalcanzable bajo RLS, y retirado

> **Estado: cerrado, con cuatro huecos declarados en §9.**
>
> El encargo pedía medir, decidir y hacer. **La medida cambió lo que había que decidir**: no es
> que el índice esté mal usado, es que **hacen falta dos cosas a la vez para que sirva —preguntar
> con `%` y no tener RLS delante— y esta aplicación no tiene ninguna de las dos**. La única salida
> que funciona exige marcar **cinco** funciones `LEAKPROOF` —cuatro de ellas en C, dos usadas por
> medio sistema— con un acto de superusuario que no cabe en una migración.
>
> **La decisión: se retira el índice** (`rentas`, `V13`), la consulta **no se toca** y lo que
> queda vigilando es una prueba de plan permanente que se pondrá **roja** el día que el índice
> vuelva a ser alcanzable. En `sgtm` **no se puede hacer** y se dice por qué (§8).
>
> Cifras: **rentas 3 133 → 3 142** (+9). **catastro 991 · caja 687 · normativa 617** sin cambio.
> **infrastructure 461/461.** Ninguna baja. Los cuatro verificadores bloqueantes en verde en
> `rentas` y en `catastro`.

---

## 1. Los dos planes que el criterio 1 pedía, y los otros dos que hacían falta

Medido contra **PostgreSQL 16.15** en `127.0.0.1:55444`, con **30 000 contribuyentes en cada una
de dos municipalidades** —el tamaño de los precedentes—, con `EXPLAIN (ANALYZE, BUFFERS)`,
`ANALYZE` corrido antes, y con el índice `contribuyente_nombre_trgm_ix` **puesto** en los cuatro
casos. La consulta es la de `ContribuyenteRepositoryJdbc`, con «PEÑA GARSIA, MARIA» —mal escrito a
propósito, que es lo que RF-014 existe para encontrar—.

**El criterio 1 pedía dos planes. Hacen falta cuatro**, porque hay dos variables y no una: *quién
pregunta* y *cómo pregunta*.

|  | `similarity(...) >= 0.30`<br>(lo que la aplicación pregunta) | el operador `%`<br>(lo único que el índice sabe responder) |
|---|---|---|
| **`sgtm_app`, RLS activa** | `Bitmap Index Scan on` **`contribuyente_pk`**<br>1 109 páginas · **95,9 ms**<br>29 243 filas al `Filter` | `Bitmap Index Scan on` **`contribuyente_pk`**<br>1 109 páginas · **94,9 ms**<br>29 243 filas al `Filter` |
| **superusuario** (omite RLS) | **`Seq Scan`**<br>992 páginas · 162,4 ms<br>58 486 filas al `Filter` | `Bitmap Index Scan on` **`contribuyente_nombre_trgm_ix`**<br>**781 páginas · 32,2 ms** |

Sólo la esquina de abajo a la derecha usa el índice. El plan de la aplicación, entero:

```
 Aggregate
   Buffers: shared hit=1109
   ->  Bitmap Heap Scan on contribuyente (actual rows=757)
         Recheck Cond: (municipalidad_id = (current_setting('app.municipalidad_id'::text))::bigint)
         Filter: (activo AND (similarity(nombre_normalizado((nombre_razon_social)::text),
                              'pena garsia, maria'::text) >= '0.3'::double precision))
         Rows Removed by Filter: 29243
         Heap Blocks: exact=992
         ->  Bitmap Index Scan on contribuyente_pk (actual rows=30000)
               Index Cond: (municipalidad_id = (current_setting('app.municipalidad_id'::text))::bigint)
 Execution Time: 95.860 ms
```

**El plan dice «Index» y lee el padrón entero del inquilino** para devolver unos cientos: es la
frase de #313 reproducida por sexta vez. Las dos mitades del defecto:

1. **El operador no llega al índice bajo RLS.** `similarity_op` tiene `proleakproof = f`, leído de
   `pg_proc`, así que PostgreSQL no lo puede evaluar por encima de la política de seguridad y no lo
   admite como condición de ningún índice. Es el **quinto hallazgo de `DAT-01` §0** otra vez, tras
   `textlike` con el `LIKE` (#565), `geography_overlaps` con el marco (#536), `construccion.ficha_id`
   (#313), la titularidad a una fecha (#561) y la cartera (#639).
2. **Y la consulta ni siquiera pregunta con `%`.** Pregunta con `similarity(...) >= 0.30`, que
   `gin_trgm_ops` no sabe responder **ni sin RLS** — la esquina de arriba a la derecha lo enseña:
   como superusuario, ese predicado sale en `Seq Scan`.

Reescribir la consulta arregla la segunda mitad y no la primera. Quitar RLS no es una opción.

---

## 2. Las tres salidas conocidas de este proyecto, medidas y descartadas

No se razonaron: se ejecutaron las tres, con el mismo padrón y la misma consulta.

### 2.1 La de #565 / `V66` —una columna generada— no sirve aquí

Se añadió `nombre_busqueda text GENERATED ALWAYS AS (nombre_normalizado(nombre_razon_social)) STORED`
y un GIN `gin_trgm_ops` **sobre la columna**, que es exactamente lo que `V66` hizo con el catálogo
vial. Como `sgtm_app`:

```
 ->  Seq Scan on contribuyente (actual rows=757)
       Filter: (activo AND (municipalidad_id = ...) AND (nombre_busqueda % 'pena garsia, maria'))
       Rows Removed by Filter: 59243
 Execution Time: 48.786 ms
```

**Ni siquiera llega al índice: recorre la tabla.** Y el motivo es la diferencia exacta entre los dos
casos: en #565 lo que no era *leakproof* era **la función** —y la columna generada la saca de la
expresión—; aquí lo que no lo es es **el operador**, y ése se queda escrito en el `WHERE` con
columna generada o sin ella.

### 2.2 La de #536 —sustituir el operador por otros que sí lo sean— no existe

Censo de `pg_proc` en la base medida:

| función | ¿*leakproof*? |
|---|---|
| `similarity_op` (`%`), `word_similarity_op` (`<%`), `strict_word_similarity_op` (`<<%`), `similarity_dist` (`<->`) | **no**, las cuatro |
| `arrayoverlap` (`&&`), `arraycontains` (`@>`) | **no** |
| `textlike` | no *(el de #565)* |
| `numeric_le` | no *(el de #536)* |
| `texteq`, `text_pattern_ge`, `text_pattern_lt` | **sí** |
| `int8eq`, `int4ge`, `float8le`, `date_le` | **sí** |

**Ningún operador de `pg_trgm` es *leakproof*, y los de arreglos tampoco** — lo cual cierra de paso
la variante «guardar los trigramas en una columna `text[]` y cruzarlos con `&&`». Lo único
*leakproof* que hay sobre texto es la **igualdad** y las **comparaciones de patrón**, que son
justamente las de #565 y `V66`, y ninguna de las dos expresa «se parece». En #536 había un
sustituto —cuatro desigualdades sobre `double precision`—; aquí no hay ninguno.

### 2.3 Un índice compuesto con `btree_gin` es la lección de #313, literal

`CREATE INDEX ... USING gin (municipalidad_id, nombre_busqueda gin_trgm_ops)`, como `sgtm_app`:

```
 ->  Bitmap Heap Scan on contribuyente
       Recheck Cond: (municipalidad_id = ...)
       Filter: (activo AND (nombre_busqueda % 'pena garsia, maria'::text))
       Rows Removed by Filter: 29243
       ->  Bitmap Index Scan on ensayo_compuesto_ix
             Index Cond: (municipalidad_id = ...)
```

**El plan dice «Index»** —usa el índice compuesto— con un `Index Cond` de **sólo
`municipalidad_id`** y el trigrama en el `Filter`, descartando las mismas 29 243 filas. Es
literalmente lo que #313 dejó escrito: un plan que use el índice sólo por la columna de la política
vuelve a leer la tabla entera y sigue diciendo «Index».

---

## 3. La salida que **sí** funciona, y por qué no se toma

Marcar la cadena `LEAKPROOF`. Medido en dos pasos, y **el primero enseña algo que no se veía venir**.

**Paso 1 — marcar sólo el operador NO cambia nada.** Con `ALTER FUNCTION similarity_op(text,text)
LEAKPROOF` puesto, el plan como `sgtm_app` es idéntico: `contribuyente_pk`, 1 109 páginas, 90,9 ms,
29 243 filas al `Filter`. El motivo: el operando es `nombre_normalizado(...)`, que PostgreSQL
**inserta en línea**, de modo que dentro del predicado quedan además `lower`, `regexp_replace` y
`unaccent` — y **ninguna de las cinco es *leakproof***. Basta una para que la cláusula entera no se
pueda promover por encima de la política.

**Paso 2 — con las cinco marcadas, el índice se usa:**

```
 ->  Bitmap Heap Scan on contribuyente
       Recheck Cond: (nombre_normalizado((nombre_razon_social)::text) % 'pena garsia, maria')
       Filter: (activo AND (municipalidad_id = (current_setting('app.municipalidad_id'))::bigint))
       ->  Bitmap Index Scan on contribuyente_nombre_trgm_ix
 Buffers: shared hit=781        Execution Time: 32.471 ms
```

781 páginas y 32,5 ms frente a 1 109 y 94,9. **Y ahí está el precio, escrito en el propio plan: la
condición de la política BAJA al `Filter`.** El índice se consulta *antes* que el aislamiento.

No se hace, por cuatro motivos y en este orden:

1. **Es el acto que #536 ya descartó** para `geography_overlaps`, con la misma frase: es *afirmar*
   que ninguna función en C de un tercero puede revelar por un error la fila de otra municipalidad.
   Aquí son **cuatro** funciones en C —`similarity_op`, `lower`, `regexp_replace`, `unaccent`—.
2. **No es un acto, son cinco, y son de superusuario**: `ALTER FUNCTION ... LEAKPROOF` no lo puede
   ejecutar `sgtm_owner`, así que no cabe en una migración.
3. **No debilitaría esta consulta sino la base entera.** `lower()` y `regexp_replace()` las usa medio
   sistema; marcarlas cambia el reparto de seguridad de **toda** consulta con RLS de esa base, no de
   la del padrón.
4. Y lo que compra es **95,9 ms → 32,5 ms** sobre un padrón del doble del real.

---

## 4. La decisión, y lo que costaba mientras tanto

**Se retira el índice.** `rentas/V13__el_indice_trigrama_inalcanzable.sql`, un `DROP INDEX`. La
consulta **no se toca**, `pg_trgm` **no se retira** —`similarity()` se sigue llamando en tiempo de
consulta— y `nombre_normalizado` **se queda**.

Un índice que nadie puede usar no es neutro, y esto también se midió:

| | con el índice | sin él |
|---|---|---|
| tamaño sobre 30 000 filas | **2 496 kB** (31 % del montón de la tabla, 7 936 kB) | — |
| índices de `contribuyente`, en total | 17 MB | **14 MB** |
| 5 000 altas en el padrón (mediana de tres) | 66,2 / **75,0** / 78,9 ms | 39,2 / **38,9** / 37,1 ms |

**Casi dobla lo que cuesta escribir en el padrón**, en cada alta y en cada corrección de un
contribuyente. Y además **miente**: su nombre promete una búsqueda por trigramas que no ocurre, que
es lo que hizo falta medir dos veces para descubrir (C-4 §5 la primera).

### 4.1 El plan de después (criterio 2)

Mismas condiciones exactas —30 000 en cada una de dos municipalidades, `sgtm_app`, RLS activa—, con
`V13` aplicada:

```
 ->  Bitmap Heap Scan on contribuyente
       Recheck Cond: (municipalidad_id = (current_setting('app.municipalidad_id'))::bigint)
       Filter: (activo AND (similarity(...) >= '0.3'::double precision))
       Rows Removed by Filter: 29243
       ->  Bitmap Index Scan on contribuyente_pk
 Buffers: shared hit=1109       Execution Time: 86,9 ms
```

**El mismo plan, las mismas 1 109 páginas y las mismas 29 243 filas descartadas.** No podía ser de
otra manera: el índice no participaba. Lo que cambia es lo que ya no se paga por tenerlo.

Y sobre el **padrón real de Catacaos** —10 603 contribuyentes, en una instalación de tres
municipalidades—: **398 páginas y 19,2 ms**. Ése es el coste real de la búsqueda hoy, y el día que
no baste lo que hace falta no es este índice (§7).

---

## 5. Lo que se encuentra no cambia (criterio 4)

Medido fila a fila sobre el padrón real, con el índice puesto y retirado: **584 filas las dos
veces**, las mismas y en el mismo orden. Es lo que la prueba permanente
`retirarElIndiceNoCambiaLoQueSeEncuentra` fija: compara los códigos devueltos con el índice y sin
él, y exige que sean iguales **y no vacíos** —«PEÑA GARSIA, MARIA» está mal escrito y aun así da con
gente, que es RF-014—.

No hay cambio de comportamiento que declarar: la consulta es la misma, el umbral es el mismo
(`0.30`) y el índice nunca participó en la respuesta. Las pruebas de
`kamayuk-rentas-contribuyentes` —80 antes de este trabajo, 89 con las nueve nuevas, e incluyendo
`laAproximacionDistingueUnParecidoDeUnoQueNoLoEs`— siguen en verde.

---

## 6. La prueba de plan permanente, y sus siete mutaciones (criterio 3)

`rentas/backend/kamayuk-rentas-contribuyentes/src/test/java/kamayuk/rentas/contribuyentes/infraestructura/BusquedaDelPadronEnElPlanTest.java`
— **9 pruebas**, al estilo de #313, #536, #561 y #565.

Un índice retirado no se puede vigilar con un `Index Cond`, así que se vigila **al revés y en las
dos direcciones**: con el índice **puesto** —la prueba lo crea ella misma— la aplicación tiene que
**seguir sin usarlo**, y el mismo operador sobre los mismos datos **sí** tiene que usarlo cuando
quien pregunta omite RLS. El día que `similarity_op` deje de ser lo que es, la prueba se pone roja y
lo que hay que hacer es volver a crear el índice.

| # | Mutación | Rojo |
|---|---|---|
| 1 | el pool como **`sgtm_owner`** —la rotura que uno teclea por costumbre— | **1, y sólo el centinela.** Con `FORCE ROW LEVEL SECURITY` el dueño también queda sujeto a la política (#537, #545): las ocho sustantivas siguen verdes |
| 2 | medir con la conexión que **omite RLS** en vez de con `sgtm_app` | **3**: los dos negativos y la de `LEAKPROOF` |
| 3 | que `conElIndice` **no cree el índice** | **exactamente 1: el contraste.** Los dos negativos pasan solos — que es justo para lo que el contraste existe |
| 4 | deshacer `V13` (comentar el `DROP INDEX`) | **5**, y las cinco nombran la causa: «si ya está puesto es que alguien lo devolvió a las migraciones: lee antes la cabecera de V13» |
| 5 | sembrar **una sola** municipalidad | **1.** Con un solo inquilino dueño de la tabla el plan pasa a `Seq Scan` y ya no hay ningún `Index Cond` que enseñar — se pierde la frase de #313 que la prueba existe para fijar. En #561 esta misma mutación no mordía; aquí sí |
| 6 | recortar `LA_CADENA_ENTERA` al operador solo | **1**: con las cinco marcadas el índice se usa, con una sola no, y la lista es lo que lo dice |
| 7 | *(catastro)* devolver el `now()` de la base al buzón | **1**: los cinco `emitidoEn` dejan de ser el reloj fijo |

**Y una mutación encontró un defecto en la propia prueba**, que es la que más enseña. La primera
versión creaba el índice una vez en el `@BeforeAll`; con la mutación 3 puesta, **las nueve pasaban
en verde** — porque la prueba de «no cambia lo que se encuentra» lo recreaba en su `finally` y las
demás lo encontraban puesto. Una prueba que depende de que otra le deje el escenario no puede decir
si el escenario existe. Con el índice creado **por prueba** (`conElIndice`), la misma mutación deja
exactamente un rojo, y es el contraste.

El **centinela** `seConectaComoSgtmApp` está por lo que #537 y #545 midieron, y la mutación 1 lo
confirma aquí: sin él, una medida hecha con el dueño de las tablas pasaría en verde sin demostrar
nada.

---

## 7. Lo que haría falta el día que 19 ms no basten

**No es este índice.** Es un índice invertido propio: una tabla `contribuyente_trigrama
(municipalidad_id, trigrama, contribuyente_id)` con su RLS, cruzada con `trigrama = ANY (ARRAY[...])`
— porque `texteq` **sí** es *leakproof* y un `ScalarArrayOpExpr` sobre él también, de modo que la
condición **sí** entraría en el `Index Cond` de un btree `(municipalidad_id, trigrama)`.

Lo que costaría, dicho para que no parezca gratis: un disparador de mantenimiento en cada escritura
del padrón; del orden de **un millón de filas por municipalidad** (unos 32 trigramas por nombre)
frente a los 2 496 kB del GIN; y **reimplementar `similarity()` en SQL** de forma que devuelva
exactamente lo mismo — que es donde está el riesgo real, porque cambiar *qué* se encuentra en el
padrón no se ve en ninguna cifra. Es otro trabajo, con su medida y su decisión.

Queda escrito en la cabecera de `V13` para que quien llegue no empiece por volver a crear el índice.

---

## 8. En `sgtm` no se puede, y eso es todo lo que se puede hacer

El monolito tiene el mismo índice en
`backend/sgtm-esquema/src/main/resources/db/migration/V11__busqueda_por_aproximacion.sql`, que es
una migración **aplicada** del archivo histórico: editarla cambia su suma de Flyway y deja «la base
de al lado distinta sin que nada se ponga rojo», y ese repositorio **no admite migraciones nuevas**.
Allí el índice se queda, inalcanzable, pagando su escritura y su espacio. **Lo único que se puede
hacer es decirlo**, y queda dicho aquí y en la cabecera de `V13`.

`catastro`, `normativa` y `caja` **no tienen** ningún índice de trigramas — comprobado: ninguna de
sus migraciones nombra `gin_trgm_ops` ni `gist_trgm_ops`, y C-13 ya retiró la declaración de
`pg_trgm` de los tres.

### 8.1 Un efecto colateral de C-4 que conviene tener escrito

Retirar el índice deja a `rentas` **sin ningún objeto que inserte en línea el cuerpo de
`nombre_normalizado`** —`via`, con su columna generada, se había ido con `V6`—. Medido: con el
cuerpo frágil de `V1` devuelto a mano y el índice ya retirado, la ida y vuelta de `pg_dump` /
`pg_restore` de `rentas` da **0 errores y 347 índices a los dos lados**.

O sea que **la migración `V11` de C-4 deja de ser lo que sostiene la restauración de `rentas`**. Se
queda porque sigue siendo correcta y porque el mismo cuerpo lo emite el mismo generador a los cuatro
esquemas; quien sostiene hoy la guarda `search-path-en-el-cuerpo-de-la-funcion` es **`catastro`**
—cuya columna generada se inserta en línea al **crear la tabla**— y el monolito. Queda anotado en el
docblock de esa guarda para que su tabla de «lo que costaba» no se lea como si siguiera vigente.

---

## 9. Los huecos declarados

1. **`pg_trgm` sigue declarada en `rentas`, y la guarda que lo comprueba la deja verde por un motivo
   que ya no es cierto.** La declaración **es correcta** —`similarity()` se llama en tiempo de
   consulta desde `ContribuyenteRepositoryJdbc`—, pero `extensiones-de-las-migraciones.ts` sólo lee
   **migraciones**, y lo que hoy la mantiene verde es el `gin_trgm_ops` que `V1` sigue nombrando
   para un índice que `V13` retira. Enseñarle a leer el uso en Java es otro trabajo; queda anotado
   en el censo de migraciones de esa prueba.
2. **La prueba de plan no corre en CI de `rentas` con volumen distinto del medido.** Siembra 60 000
   filas en cada corrida (≈ 4 s). Si algún día eso pesa, lo que **no** se puede hacer es bajar la
   cifra sin volver a medir: con pocos miles el planificador elige el recorrido secuencial y hace
   bien, y la prueba dejaría de decir lo que dice.
3. **La mutación de `LEAKPROOF` toca el catálogo de la base de prueba.** Es seguro —cada corrida
   crea su propia base y `pg_proc` es por base, y se devuelve en un `finally` comprobado por la
   propia prueba—, pero es la única prueba del árbol que altera funciones del núcleo.
4. **No se midió en PostgreSQL 18.** Es coherente con C-4 §3.2: la 18 está declarada NO SOPORTADA y
   con guarda, y su planificador no es el de la 16. Si algún día se soporta, estas nueve pruebas son
   de las que hay que volver a correr.

---

## 10. La otra mitad del encargo: el lote de eventos deja de ensuciar `git status`

`catastro/docs/50-api/eventos/lote-de-eventos.json` se reescribía en **cada** corrida del banco de
pruebas, y su único diff eran los cinco `emitidoEn`. La causa: `BuzonDeSalidaJdbc` escribía
`creado_en` con **`now()` de la base**, mientras `PublicacionDelPadron` —quien publica— ya recibía su
`Clock`. Dos relojes para la misma corrida, y uno de ellos sale publicado.

Se arregla como el resto del proyecto y con el precedente que ya estaba al lado —`AuditoriaJdbc`,
cuyo propio javadoc dice «la fecha sale del reloj inyectado, no de `now()` de la base»—: el buzón
recibe su `Clock` y escribe `:creadoEn`. La prueba lo fija con `Clock.fixed`, y la mutación que lo
devuelve a `now()` deja **1 en rojo**.

Comprobado: dos corridas seguidas dejan el archivo **idéntico byte a byte**, el único diff contra
`HEAD` son los cinco instantes, y `rentas` sigue leyendo ese lote —las cinco pruebas de
`IngestionDeCatastroJdbcTest`, el candado de ADR-0027 §2 incluido, en verde—.

---

## 11. Los criterios de aceptación

| # | Criterio | Estado | Dónde |
|---|---|---|---|
| **1** | El plan de hoy, como `sgtm_app` y como superusuario | **Cumplido, y son cuatro y no dos** | §1 |
| **2** | La decisión tomada, con su plan de después | **Cumplido**: retirado, `V13`, plan idéntico | §2, §3, §4 |
| **3** | La prueba de plan permanente, con centinela y mutación | **Cumplido**: 9 pruebas, 7 mutaciones, y una encontró un defecto en la propia prueba | §6 |
| **4** | La búsqueda por aproximación encuentra lo mismo | **Cumplido**, medido fila a fila: 584 = 584 | §5 |
| **5** | El lote de eventos deja de ensuciar `git status` | **Cumplido**, y comprobado en dos corridas | §10 |
| **6** | Las cifras no bajan | **Cumplido**: rentas +9, las otras cuatro igual | §12 |
| **7** | Los cuatro verificadores bloqueantes en verde | **Cumplido** en `rentas` y en `catastro` | §12 |

---

## 12. Las cifras

| Repositorio | Antes | Después |
|---|---|---|
| `rentas` | 3 133 | **3 142** (+9, la prueba de plan) |
| `catastro` | 991 | **991** (la aserción nueva vive dentro de una prueba que ya existía) |
| `caja` | 687 | **687** (sin tocar) |
| `normativa` | 617 | **617** (sin tocar) |
| `infrastructure` | 461/461 | **461/461** |

Verificadores bloqueantes, forzados con `--rerun-tasks` y no leídos de la caché:

| | `rentas` | `catastro` |
|---|---|---|
| `build` (Spotless, Checkstyle, NullAway, pruebas) | verde | verde |
| `verificarAislamiento` | verde | verde |
| `verificarArquitectura` | verde | verde |
| `verificarArranque` | verde | verde |

`caja` y `normativa` no se tocaron; su `build` se corrió igualmente y quedó en verde.

**Y `sgtm` no se tocó**: se leyó su `V11` para comprobar que el índice está y que no se puede
arreglar, y nada más.
