# T-0 — Las barreras del territorio (fase 0 de Kamayuk Territorio)

> **Estado: cerrado, con lo que NO entra declarado en §7.** Es la **fase 0** del plan de
> arquitectura V2 —«Kamayuk Territorio»—, y la fase 0 no entrega ninguna pantalla a propósito: es
> la que hace que las cinco siguientes no vuelvan a pagar un hallazgo ya pagado.
>
> **Cifras, con la línea base medida en el mismo entorno:** `catastro` **999 → 1 011**, `rentas`
> **3 150 → 3 161**, `normativa` **623 → 634** y `caja` **693 → 704**, **0 fallos** los cuatro contra
> PostgreSQL 16.13 + PostGIS 3.4.2 real. Los **+11** son los mismos en los cuatro y salen de la
> librería compartida; el **+12** de `catastro` es esa docena más el caso del marco en la prueba de
> aislamiento. `yarn verificar` **no se mueve**: 38 rojas antes y 38 después, las mismas una a una
> (`diff` vacío) — todas del clon de `sgtm` que este entorno no tiene y del registro sin credencial.
>
> Entrega **los cinco ADR** que el plan redactó (0033 en `infrastructure`, 0034–0037 en
> `catastro`), **las dos verificaciones nuevas de ADR-0034** en `comun-verificaciones` con sus
> muestras, la **`V6`** de `catastro` —que cierra **D-10**— y el caso del **marco** en la prueba de
> aislamiento.

---

## 0. Lo que la medición corrigió antes de tocar código, y durante

Cinco cosas cambiaron al ejecutar, y las cinco cambian **qué** hay que hacer:

1. **`text_pattern_ops` no acepta un dominio sobre `character(12)`.** `V6` declaraba
   `CREATE INDEX predio_cuc_prefijo_ix ON predio (municipalidad_id, cuc text_pattern_ops)` y
   PostgreSQL 16 lo rechaza: «operator class "text_pattern_ops" does not accept data type
   cuc_sncp». Va sobre la expresión `((cuc)::text)`. `bpchar_pattern_ops` también sirve y **no se
   toma**: dejaría dos convenciones de búsqueda por prefijo en la misma tabla —una con relleno de
   blancos y otra sin él— y la consulta del CUC no se podría escribir igual que la del código de
   referencia, que es lo único que impide que una de las dos acabe con `LIKE`.

2. **La unidad del escáner espacial no puede ser el literal, y tampoco el archivo.** Las dos se
   midieron y las dos fallan, cada una por un lado (§3.1). Es una **sentencia de Java**.

3. **ArchUnit no expone el nombre de un parámetro**, y sin él la regla de la geometría pasaba en
   VERDE sobre el defecto exacto que existe para atrapar (§3.2).

4. **`rentas` tiene dos consultas de texto libre vivas** que ninguna guarda veía, y el rojo llegó
   solo (§4). No se arreglan aquí y se dice por qué.

5. **La prueba de aislamiento se puso roja sola** al llegar `frente_predio`, con el mensaje que
   ella misma trae escrito: «si esto falla en una tabla nueva, lo que falta es sembrarla en
   `DatosDePrueba`». Sembrarla obligó a meter **la primera geometría de verdad** que estas fixtures
   han tenido nunca (§5).

---

## 1. Los cinco ADR

| # | Decide | Vive en |
|---|---|---|
| 0033 | Cinco sistemas: `catastro` absorbe el territorio y `seguridad` se separa | `infrastructure` |
| 0034 | Toda tabla de tenant con geometría lleva su marco; el operador espacial no entra en el SQL de aplicación | `catastro` |
| 0035 | El hallazgo catastral es una entidad con acto y evidencia, no un informe | `catastro` |
| 0036 | El CUC del SNCP es una identidad distinta del código de referencia municipal | `catastro` |
| 0037 | Dos carriles de mapa: lo publicado se tesela, lo vivo se sirve | `catastro` |

Los cinco entran en **Propuesto**, como los ADR 0024–0032: ninguno se acepta solo. **ADR-0036 es
el único que cierra algo hoy** —contesta **D-10**— y por eso es el único cuya decisión ya está
implementada, en `V6`.

---

## 2. `V6`: la identidad del SNCP y el frente de predio

`catastro/backend/kamayuk-catastro-esquema/src/main/resources/db/migration/V6__identidad_sncp_y_frente.sql`.

- `predio.cuc` con dominio `cuc_sncp char(12)`, `predio.nivel_sncp`, y su **único parcial**
  (`WHERE cuc IS NOT NULL`). El parcial no es comodidad: crear un índice único **sí** funciona sin
  contexto de tenant —lee el montón y no pasa por la política— pero **su fallo no dice cuáles son
  los duplicados**, y el predicado excluye por construcción toda fila anterior, así que la
  migración no se puede parar sobre datos que ya existen.
- `frente_predio`, con su geometría `LineString`, sus **cuatro columnas de marco** y sus dos
  índices —el del marco para el SQL bajo RLS, el GiST para el trabajo que corre fuera de ella—.
  Su `longitud_m` **la mide el técnico y no se deriva**, por lo mismo que el área del terreno
  (ADR-0021): de ella cuelga un cobro.

**Medido contra PostgreSQL 16.13 + PostGIS 3.4.2**, aplicando `crear-roles.sql` y `V1..V6` sobre
una base creada de cero: las seis migraciones aplican limpias y la base pasa de 34 tablas a **35**.

---

## 3. Las dos verificaciones de ADR-0034

Van en `comun-verificaciones`, junto al escáner de `SET SESSION`, y por tanto **corren en los
cinco repositorios**. Cada una viaja con su clase de muestra, como exige
`ReglasDeArquitecturaMuerdenTest`.

### 3.1 `RevisorDeEsquema` — toda tabla de tenant con geometría lleva su marco

Lee **el texto de las migraciones** y no el catálogo, para que muerda también donde hoy no hay
PostGIS: una comprobación que necesitara la base sólo miraría un repositorio de cinco, y las otras
cuatro se enterarían el día que alguien añadiera geometría —que es justo el día en que la regla
tiene que estar puesta—.

Compone el esquema **sentencia a sentencia y en orden de versión**, no archivo por archivo. No es
un lujo: una tabla puede nacer sin geometría y recibirla tres migraciones después, y ésa es la
forma en que este defecto va a llegar de verdad —nadie crea la tabla con el polígono el primer
día; lo añade cuando hay plano que cargar—. Un escáner por archivo daría por buenos los dos
archivos, y el defecto vive en la suma. Tiene su muestra: `V902` + `V903`.

### 3.2 Los dos escáneres de fuentes, y las dos unidades que se midieron

**`revisarEspacial`** rechaza `ST_Intersects`, `ST_Within`, `ST_Contains`… y el `&&` sobre
geometría. Tres decisiones, cada una con su medida:

- **`&&` se marca sólo cuando la sentencia menciona geometría.** Está sobrecargado:
  `daterange && daterange` es solapamiento **temporal** y es como `ficha_catastral` y `titularidad`
  impiden que dos vigencias se pisen. Marcarlo siempre pondría roja media base el primer día, y
  una comprobación que grita el primer día se silencia (#437).
- **No se aplica a las migraciones.** Un `EXCLUDE USING gist (… &&)` pone el operador donde tiene
  que ir: en una restricción que el motor evalúa al **escribir**, no en un `WHERE` que el
  planificador resuelve bajo la política. Lo que ADR-0034 prohíbe es el segundo caso.
- **La unidad es la sentencia de Java**, y las otras dos se midieron:
  - *Por literal*: falla. El SQL se compone concatenando cadenas, así que la condición de marco y
    el refinado casi nunca caen en el mismo — **el contraste de la propia regla salió rojo la
    primera vez por esto**.
  - *Por archivo*: falla, y peor. `CatastroRepositoryJdbc` nombra `marco_oeste` en otra consulta
    suya, así que con el archivo por unidad, **devolver la consulta de la tesela al `&&` —el
    defecto exacto que `V65` arregló— pasa en VERDE**. Medido: `BUILD SUCCESSFUL` con la rotura
    puesta.

**`revisarPrefijo`** rechaza la búsqueda por prefijo escrita con `LIKE`. Su unidad **sí** es el
archivo, y a propósito: el repliegue legítimo de `RangoDePrefijo` vive en la **otra rama de un
`if`**, o sea en otra sentencia, y exigir que estuviera en la misma pondría rojo el único código
correcto que hay —cuatro archivos en tres repositorios—.

### 3.3 Las dos reglas de ArchUnit

`NINGUN_HALLAZGO_CORRIGE_LA_FICHA` y `TODA_GEOMETRIA_ENTRA_POR_BATCH`.

**El criterio de la primera es el nombre, y hay que decir por qué.** No puede ser «ninguna clase de
`fiscalizacion` escribe la ficha»: la transferencia **sí** la escribe, es legítimo, y
`SOLO_LA_TRANSFERENCIA_ESCRIBE_FUERA_DE_FISCALIZACION` ya la nombra como el único camino. Medido:
con el criterio ampliado al paquete entero, `rentas` sale rojo acusando a `TransferirARentas`, que
es exactamente la clase que la otra regla protege.

**La segunda tuvo que aprender a leer el nombre del parámetro.** ArchUnit expone el tipo y las
anotaciones de un parámetro, no su nombre; y la forma en que la geometría entra de verdad es
`@RequestParam(required = false) String wkt` —sin nombre en la anotación, porque Spring lo toma del
bytecode—. Con la regla mirando sólo la anotación, la rotura sobre `PlanoCatastralController` pasó
en **VERDE**. Se lee con `JavaMethod.reflect()`, que funciona porque los cinco backends compilan
con `-parameters` — que es también lo que Spring necesita para resolverlo.

---

## 4. El rojo que llegó solo: dos consultas de texto libre en `rentas`

`revisarPrefijo` encontró, sin que hubiera que provocar nada, dos `ILIKE` vivos en `src/main`:

| Clase | Consulta |
|---|---|
| `NotificacionAdministrativaRepositoryJdbc` | «el motivo de la notificación contiene…» |
| `CodigoInfraccionRepositoryJdbc` | «la descripción de la infracción contiene…» |

Las dos escriben `ILIKE :param` **con el comodín antepuesto en Java**
(`put("texto", "%" + t + "%")`), de modo que el SQL se lee igual que una búsqueda por prefijo. Eso
obligó a un tercer patrón: sin él, el diagnóstico habría sido el equivocado —se les pediría un
rango que **no pueden tener**, porque un comodín por delante no llega a ningún índice b-tree, con
RLS o sin ella—.

**No se arreglan aquí.** Cerrarlas no es cambiar una consulta: es decidir qué hace esa pantalla, y
eso es del dueño de `sanciones`. Entran declaradas en `busquedasDeTextoLibreConMotivo()`, una lista
por clase —añadir una es una línea visible en el diff— y **que es la lista de trabajo pendiente**,
no una puerta abierta. Quitarle una entrada pone la prueba roja nombrando la clase.

---

## 5. El caso del marco en la prueba de aislamiento

`AislamientoMultiTenantTest` recorre las tablas de tenant con un `count(*)` sin filtro, que **no
pasa por `marco_*` ni por su índice**. El camino que ADR-0034 obliga a usar es nuevo, y el
aislamiento hay que ejercerlo por el camino que se usa.

Y no es cortesía: el filtro por marco son cuatro desigualdades sobre columnas generadas, o sea
exactamente la forma que el motor **puede evaluar antes que la política** —`float8le` es
*leakproof*—. Que se evalúe antes es lo que hace que el índice sirva, que es el arreglo entero;
que aun así la política se aplique es lo que hay que comprobar, porque **las dos cosas juntas son
la única razón por la que el arreglo es aceptable**.

Sembrar `frente_predio` metió **la primera geometría de verdad** en estas fixtures. Cada
municipalidad cae en un grado distinto de longitud a propósito: si el filtro tuviera una fuga, la
prueba vería filas de la otra y no un empate ambiguo.

---

## 6. Las roturas, y el rojo exacto de cada una

Cada una aplicada **sola** sobre `src/main` y restaurada **por copia comparada con `cmp`**.

| # | Rotura | Rojo |
|---|---|---|
| 1 | Quitarle a `frente_predio` sus cuatro columnas de marco y su índice | **1**, nombrando las cinco carencias una a una: «la tabla de tenant «frente_predio» tiene geometria y le falta la columna «marco_oeste»… y ningun indice (municipalidad_id, marco_oeste, …)» |
| 2 | Devolver la consulta de la tesela al operador `&&` (el estado anterior a `V65`) | **1**: «`&&` sobre geometria es geography_overlaps, que tampoco es leakproof. Medido: 4 530 bloques contra los 347 del marco» |
| 2b | La misma rotura, con la guarda devuelta a la unidad **archivo** | **VERDE.** Es la medida que decidió la unidad, y la razón por la que §3.2 existe |
| 3 | Un `@RequestParam(required = false) String wkt` en `PlanoCatastralController` | **1**: «recibe geometria por la peticion (el parametro «wkt»)» — y **VERDE** antes de enseñarle a la regla a leer el nombre del parámetro |
| 4 | Quitar la rama del rango en `FichaCatastralRepositoryJdbc`, dejando sólo el `LIKE` | **1**: «tercer hallazgo de RLS: bajo la politica, textlike no es leakproof…» |
| 5 | Ampliar `EsDelHallazgo` al paquete entero, sin el criterio del nombre | **1 en `rentas`**: «TransferirARentas depende de TransferenciaDeFiscalizacion» — la clase que la otra regla protege |
| 6 | Quitar una entrada de `busquedasDeTextoLibreConMotivo()` | **1**, y con el mensaje correcto: «un LIKE con el comodin por delante recorre el padron entero y **no tiene forma de rango**» |
| 7 | Quitarle a `frente_predio` su `ENABLE ROW LEVEL SECURITY` y su política | **5**, y entre ellas la nueva: «fuga por el camino nuevo: el marco es leakproof y se evalua ANTES que la politica… evaluarse antes no significa evaluarse EN VEZ DE» |

Y las dos reglas de ArchUnit se demuestran además **sin provocar nada**:
`ReglasDeArquitecturaMuerdenTest` es un `@TestFactory` sobre `todas()`, así que una regla que no
detectara su muestra saldría roja sola.

---

## 7. Lo que NO entra, declarado

El plan V2 son seis fases y esto es la **cero**. Queda fuera, y no por descuido:

- **Los seis módulos del territorio** (`urbano`, `grd`, `fiscalizacion`, `comercio`, `obras`,
  `patrimonio`) y sus migraciones `V7`…`V11`. ADR-0033 y ADR-0035 los deciden; ninguno se
  construye aquí. **Las barreras se construyen primero, a propósito**, y esa es toda la fase 0.
- **El sistema `seguridad`** y su registro en `sistemas.ts`. Es la fase 4, y ADR-0033 dice
  explícitamente qué entra antes: la mitigación pendiente de ADR-0031 —el trabajo programado que
  abre el PR del descriptor—.
- **El `CronJob` de teselas y el carril vivo** (ADR-0037). Es la fase 2, y arrastra la primera
  pantalla de `catastro-web`, que no existe.
- **La corrida de valuación** (fase 1). Sigue bloqueada por lo que `P5C-extraccion.md` declara, y
  el plan V2 no la desbloquea: la desbloquea **cargar** RM 277-2025-VIVIENDA, la tabla de
  depreciación del RNT y RM 514-2025-EF/15 en `normativa`. **D-11 sigue abierta** y ninguna norma
  publicada la cierra.
- **Las dos consultas de texto libre de `rentas`** (§4), declaradas y no arregladas.
- **La tercera regla que el plan lista** —`TODA_BUSQUEDA_POR_PREFIJO_ES_UN_RANGO`— entra; las
  cinco del plan quedan en **cuatro implementadas y una declarada**: no hay `..fiscalizacion..`
  catastral que vigilar todavía, así que `NINGUN_HALLAZGO_CORRIGE_LA_FICHA` vive hoy sólo de su
  muestra, y eso está dicho en su javadoc.

## 8. Lo que este revisor de esquema no ve

Escrito antes de que alguien lo descubra: una tabla creada fuera de las migraciones (no existe, y
ADR-0032 dice que no debe existir); una vista materializada con geometría (el día que aparezca, la
regla no la verá y hay que ampliarla); y **que el índice se use** —eso no lo afirma ningún escáner
de texto, lo afirma un `EXPLAIN`, y de eso se encarga la prueba de plan del repositorio que tenga
PostGIS—.
