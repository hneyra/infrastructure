# T-0 — Revisión de `infrastructure#6` y `catastro#2`

> **Qué es esto.** Revisión independiente de la fase 0 de «Kamayuk Territorio», pedida sobre
> [`infrastructure#6`](https://github.com/hneyra/infrastructure/pull/6) y
> [`catastro#2`](https://github.com/hneyra/catastro/pull/2). Se escribe **después** del merge: los
> dos PR —y sus tres hermanos— se fusionaron el 2026-09-05 a las 22:55 UTC, así que esto no es una
> revisión que pueda bloquear nada, sino la lista de trabajo que queda.
>
> **Todo lo que aquí se llama CONFIRMADO se ejecutó.** Lo que no se pudo ejecutar se dice.

---

## 0. Veredicto

**El camino es el correcto, y el trabajo está por encima de la media del repositorio.** Tres cosas
lo sostienen, y conviene decirlas antes que los defectos porque son las que hay que conservar:

1. **ADR-0034 es la mejor pieza del lote.** No razona: mide. Ocho variantes con 90 000 predios,
   bloques y milisegundos, y dos resultados que cierran puertas que alguien iba a volver a abrir
   (`geometry` no arregla nada; el GiST multicolumna con `btree_gist` tampoco). Generaliza C-12 de
   «este índice sobra» a «esta clase de índice va a volver a sobrar nueve veces», que es
   exactamente el salto que este proyecto necesitaba dar.
2. **La coordinación de los cinco repositorios salió bien.** `frente_predio` entra en el reparto de
   tablas de los cuatro backends a la vez —con el motivo de R-N escrito en el comentario— y la
   exención de `rentas` viaja en su propio PR. Cinco PR fusionados en el mismo minuto, sin ninguna
   mitad colgando.
3. **La disciplina de «no se pudo comprobar ≠ está bien» está aplicada donde importa.** La prueba
   del revisor de esquema exige que encuentre migraciones **y que las entienda** antes de afirmar
   que están limpias (`ProhibicionesEnElCodigoFuenteTestBase.java:1154-1159`). Es el precedente de
   C-9a/C-18 atendido sin que nadie lo pidiera.
4. **«Lo que NO entra» se respetó de verdad, y eso no es poco.** Comprobado: `seguridad` y los seis
   contextos del territorio (`urbano`, `grd`, `fiscalizacion`, `comercio`, `obras`, `patrimonio`)
   **no aparecen** en `infra/descriptor/sistemas.ts`, ni en `FronteraDeSistema.java`, ni en
   `despliegue/plataforma.compose.yaml`. No hay ninguna media frontera, que es el modo de fallo de
   C-17 y C-18. Y el RLS de `frente_predio` está impecable: `ENABLE` + `FORCE` + política con
   `USING` y `WITH CHECK`, con el patrón de `V1` byte a byte, y `GRANT` sin `DELETE`.

Y dicho eso: **hay un defecto bloqueante, medido, en `V6`**, y **cuatro barreras nuevas que hoy no
pueden atrapar el defecto que existen para atrapar**. Ninguno rompe lo que ya estaba en `main`
—salvo un censo, §2.1—; el riesgo es el otro, el que este proyecto lleva doscientos issues
evitando: **una verificación en verde que dejó de mirar**.

| | Cuenta |
|---|---|
| Bloqueantes | 1 |
| Altos | 6 |
| Medios | 9 |
| Estructurales de CI | 3 |

---

## 1. Lo que se ejecutó para escribir esto

| Qué | Resultado |
|---|---|
| `yarn verificar` en `infrastructure@09fc7a5`, con los **seis** clones en disco | **2 rojas** — §2.1 |
| El mismo, con `catastro` devuelto a `da06fdc` (anterior a `V6`) | **37/37 verdes** → la causa es `V6` |
| El mismo, con el arreglo de §2.1 | **680/680 verdes**, `EXIT=0` |
| `RevisorDeEsquema` compilado y ejecutado contra las 6 migraciones de `catastro` | **0 hallazgos** (aprueba `V6`) |
| `RevisorDeCodigoFuente` compilado y ejecutado contra `src/main` de `catastro` y `rentas@main` | **0 hallazgos** los dos |
| `V6` reproducido contra **PostgreSQL 16.13** real, 60 000 filas, rol `NOSUPERUSER NOBYPASSRLS` | **el índice del CUC no se usa** — §2.2 |
| `./gradlew build` en `librerias-backend` | compila; **0 pruebas** (§4.2) |
| `./gradlew verificarArquitectura` en los **cuatro** backends, con JDK 25 y la librería de `main` | **BUILD SUCCESSFUL los cuatro** |

Es decir: **las guardas nuevas corren de verdad en los cuatro sistemas y ninguna está roja hoy.**
Lo que este informe dice es que varias de ellas están en verde por motivos que no son los que su
autor cree. (Dos rojos intermedios de `rentas` —`ClassFormatError` y una excepción del caché de
configuración de Gradle— eran artefactos de este entorno y desaparecen con `clean` y
`--no-configuration-cache`; no son del código.)

**No se pudo ejecutar:** los cuatro `./gradlew build` completos (sin Docker, así que sin
`verificarAislamiento`), de modo que **las cifras del PR —1 011 · 3 161 · 634 · 704— no se
corroboraron**; y nada que necesite PostGIS —no está en este entorno—, así que **las cuatro
columnas de marco de `V6` no se midieron**: lo que se dice de ellas es análisis.

---

## 2. Bloqueante y crítico

### 2.1. `V6` puso en rojo el censo C-2 de `infrastructure`, y nadie lo vio

**CONFIRMADO, ejecutado.** `yarn verificar` en `main` da dos rojas:

```
FAIL verificaciones/extensiones-de-las-migraciones.test.ts
  > las dependencias de hoy se detectan…   expected [ …(16) ] to deeply equal [ …(15) ]
    +   "catastro|V6__identidad_sncp_y_frente.sql|postgis",
  > cada esquema tiene migraciones de verdad…   - "catastro": 5   + "catastro": 6
```

La guarda hizo **exactamente su trabajo** —`V6` estrena una dependencia de PostGIS y el censo lo
dice—, y la dependencia es **legítima**: `catastro` ya declara `postgis` en su `crear-roles.sql:83`.
Lo que faltó fue actualizar el censo, que es lo que el propio comentario del archivo prescribe.

**Por qué nadie lo vio, que es lo que importa.** El PR afirma «`yarn verificar` **no se mueve**: 38
rojas antes y 38 después». Esas 38 son del entorno del autor, sin los clones hermanos —cada una
dice «Remedio: `git clone` …»—. **Las 2 rojas reales estaban dentro de ese ruido.** Con los seis
clones presentes la línea base no es «38 rojas»: es **680/680 en verde**, y entonces las dos se ven
solas. Es la lección de C-15/C-16 por su otra cara: un entorno que no puede comprobar no produce
una línea base contra la que comparar.

**Arreglo validado** (`680/680`, `EXIT=0`), listo en la rama de esta revisión:

```diff
+      // `V6` (T-0/ADR-0034): `frente_predio.geometria` es `geography(LineString,4326)` y sus
+      // cuatro columnas de marco se derivan con `st_xmin`/`st_ymin`/`st_xmax`/`st_ymax`.
+      // `catastro` ya declara `postgis` en su `crear-roles.sql`, asi que la dependencia esta
+      // cubierta: lo que faltaba era el censo.
+      "catastro|V6__identidad_sncp_y_frente.sql|postgis",
-      catastro: 5,
+      catastro: 6,
```

### 2.2. BLOQUEANTE — `predio_cuc_prefijo_ix` es inalcanzable bajo RLS: el tercer hallazgo, por sexta vez

**CONFIRMADO, medido contra PostgreSQL 16.13.** `V6:108-110`:

```sql
CREATE INDEX predio_cuc_prefijo_ix ON predio
    USING btree (municipalidad_id, ((cuc)::text) text_pattern_ops)
    WHERE (cuc IS NOT NULL);
```

El comentario de `V6:93-98` afirma que esto respeta el tercer hallazgo de RLS porque escribe el
prefijo como rango. **Escribir el rango es necesario y no suficiente:** el `Var` va envuelto en el
cast `bpchar → text`, que es un cast **por función**, y `text(character)` tiene
`proleakproof = f`. Medido con 60 000 filas en dos municipalidades, como `kamayuk_app`:

| Variante | Bloques | ¿El prefijo en el `Index Cond`? |
|---|---|---|
| El rango de `V6`, bajo RLS | **578** | **no** — 29 990 filas descartadas en el `Filter` |
| El mismo prefijo con `LIKE`, bajo RLS | 578 | no — *el rango no compra nada* |
| El rango de `V6`, como **superusuario** | 7 | sí |
| `text_pattern_ops` **sobre la columna** (dominio en `varchar`) | **4** | **sí** |
| `bpchar_pattern_ops` sobre la columna | 4 | sí |

**578 bloques con quien usa la base, 7 con quien la provisiona.** Es la frase del quinto hallazgo
literal, y el plan dice «Index».

Lo que agrava: **este repositorio ya pagó esta lección y tiene la prueba escrita.**
`BusquedaDelCatalogoVialTest.java:243-260` dice «el rango sobre la funcion NO llega al indice: por
eso `V66` materializa la columna». `V66` sacó la función del predicado; `V6` mete un cast dentro
del índice. Misma forma, otra función.

Y la alternativa que `V6` descarta **por escrito** (`V6:103-107`, «dejaría dos convenciones») es la
que funciona, y cuesta 574 bloques por consulta. La premisa del PR es cierta —`text_pattern_ops` no
acepta un dominio sobre `character(12)`— pero la conclusión no se sigue: lo que rompe la convención
es haber elegido `character` en vez de `character varying`. `varchar → text` es *binary-coercible*,
sin función, y por eso `V1:730` puede indexar el dominio `cod_catastral` directamente.

**Arreglo mínimo** (`V6` no se ha desplegado en ningún ambiente, así que se corrige en sitio):

```sql
CREATE DOMAIN cuc_sncp AS character varying(12)
    CONSTRAINT cuc_sncp_check CHECK (((VALUE)::text ~ '^[0-9A-Z]{12}$'::text));

CREATE INDEX predio_cuc_prefijo_ix ON predio
    USING btree (municipalidad_id, cuc text_pattern_ops)
    WHERE (cuc IS NOT NULL);
```

**Y las dos pruebas de plan que faltan**, con la forma que `PlanoEnElIndiceTest` ya tiene: que
`cuc` y `municipalidad_id` salgan los dos en el `Index Cond`, y el contraste que dice por qué el
dominio es `varchar`. Hoy **ninguna prueba toca el CUC** —la fixture no siembra una sola fila con
`cuc`—, así que el defecto es latente: el próximo que escriba esa búsqueda seguirá el comentario de
la migración, que le dice que el rango basta.

---

## 3. Las cuatro barreras que hoy no atrapan el defecto que existen para atrapar

Este es el bloque que más pesa, porque son verificaciones **nuevas y en verde**, que es el estado
más caro de descubrir tarde.

### 3.1. ALTO — `TODA_GEOMETRIA_ENTRA_POR_BATCH` no ve el camelCase, que es el idioma de la casa

**CONFIRMADO, medido** (función compilada y ejecutada). `ReglasDeArquitectura.java:1272-1276`:

```java
String limpio = nombre.toLowerCase(Locale.ROOT).replaceAll("[^a-z]", " ");
return Arrays.stream(limpio.split(" +")).anyMatch(NOMBRES_DE_GEOMETRIA::contains);
```

El `toLowerCase` va **antes** del split, así que destruye la única frontera de palabra que tiene un
identificador Java: la mayúscula. Sólo pasan los nombres que son *exactamente* una palabra del
conjunto.

| Parámetro | ¿Lo atrapa? |
|---|---|
| `String wkt` (la rotura #3 del PR) | sí |
| `String wktDelLote` / `geometriaDelLote` / `nuevoPoligono` | **no** |
| `record CorreccionDelLote(…, String geometriaWkt, …)` | **no** |

O sea: **la rotura que el PR midió pasa sólo porque se escogió el nombre más corto posible.** El
estilo que `CLAUDE.md` §Idioma exige —«campos de la API JSON en español camelCase»— la esquiva sin
proponérselo, y el código real ya lo usa (`codigoDeSector`, `marcoOeste`, `codRefCatastral`).

**Arreglo (una línea, y conserva el contraste):**

```java
String limpio = nombre.replaceAll("([a-z0-9])([A-Z])", "$1 $2")
        .toLowerCase(Locale.ROOT).replaceAll("[^a-z]", " ");
```

Medido con el arreglo: `geometriaDelLote`, `wktDelLote`, `nuevoPoligono`, `MultiPolygonWkt` pasan a
`true`; `bbox`, `marcoOeste` y `MarcoGeografico` siguen en `false`.

### 3.2. ALTO — la mitad de esa regla que el PR llama «el trabajo entero» no está demostrada

**CONFIRMADO.** El PR dice que sin leer el nombre del parámetro por `reflect()` la regla pasaba en
verde sobre el defecto exacto. Pero **ninguna muestra ejercita esa vía**: `motivoDe` evalúa
tipo → anotación → nombre → componentes de record, y los tres métodos de
`MuestraDeControladorQueRecibeGeometria` disparan una vía **anterior** al nombre.

Consecuencia medible: **si `nombreDelParametro` devolviera `null` siempre,
`ReglasDeArquitecturaMuerdenTest` sigue en verde en los cinco backends.**

Y hay una segunda mitad, peor: `nombreDelParametro` (`ReglasDeArquitectura.java:1253-1271`)
**se traga el fallo** por dos salidas, y las dos significan «esta regla acaba de dejar de mirar»:

- `!isNamePresent()` → es **exactamente** el síntoma de que falta `-parameters`. Devuelve `null`.
- `catch (RuntimeException | LinkageError)` → devuelve `null`.

Contradice C-15/C-16 («no se pudo comprobar ≠ está bien») y C-9a («`flujosDe` **lanza**»).

> **La afirmación de `-parameters` sí se verificó, y se sostiene:** está en
> `kamayuk.java-base.gradle.kts:23` de los **cuatro** backends, y la cadena
> `modulo → java-base` / `pruebas → calidad → java-base` la lleva a todos los módulos, incluidos
> los `dominio-compartido` que sólo aplican `kamayuk.pruebas`. El defecto no es que falte: es que
> **nada lo sujeta** y perderlo no pondría nada rojo.

**Arreglo:** que `nombreDelParametro` **lance** con el remedio escrito, y una prueba que evalúe la
regla sobre una clase con `@RequestParam(required = false) String wkt` y exija que el mensaje
nombre `«wkt»`.

### 3.3. ALTO — `revisarEspacial` se silencia con **mencionar** el marco, no con filtrar por él

**CONFIRMADO, ejecutado.** `RevisorDeCodigoFuente.java:508` salta la sentencia entera si
`\bmarco_(oeste|sur|este|norte)\b` aparece en **cualquier** literal suyo. ADR-0034 §2 dice «sólo
como refinado exacto **después** del marco»; el escáner no comprueba ni que sea un filtro, ni que
sean las cuatro, ni que vaya delante.

```java
// Medido: 0 hallazgos. Es el defecto que V65 arreglo (4 530 bloques contra 347).
"SELECT p.id, p.marco_oeste, p.marco_sur, p.marco_este, p.marco_norte,"
    + " ST_AsGeoJSON(p.geometria) AS forma FROM predio p"
    + " WHERE ST_Intersects(p.geometria::geometry, ST_MakeEnvelope(:o,:s,:e,:n,4326))"
```

Devolver el marco al cliente del mapa es normal; **filtrar** por él es lo obligatorio. La forma más
natural de escribirlo mal es también la que apaga la guarda. La rotura 2 del propio T-0 §6 pasa en
verde si además ordena por el marco.

Y empuja hacia el hueco: el idioma real de estos repositorios compone el SQL por constantes
(`MARCO + REFINADO`) o por `condiciones.add(...)`, y en los dos casos la guarda da **falso
positivo** (medido). La única forma de callarla es pegar `marco_…` dentro del mismo literal — o
sea, escribir a mano la exención, sin lista, sin dueño y sin nada que lo note en el diff.

**Arreglo:** exigir el marco **comparado** (`marco_\w+\s*(<=|>=|<|>|BETWEEN)`) y al menos dos de
las cuatro; y dos pruebas de contraste con las entradas de arriba, que hoy salen verdes.

### 3.4. ALTO — `RevisorDeEsquema`: un literal multilínea con `--` borra el resto del archivo, en verde

**CONFIRMADO, ejecutado.** `sinComentarios` (`RevisorDeEsquema.java:509-516`) procesa **línea a
línea** y `quitarComentarioDeLinea` (`:519`) declara `boolean enCadena = false` **en cada línea**.
Un literal SQL de dos líneas cuya continuación lleve `--` pierde ahí su comilla de cierre, y
`sentenciasDe` se traga todo hasta la siguiente comilla.

Demostrado en dos pasos sobre la migración real:

```
1) V6 sin las cuatro columnas de marco               -> HALLAZGOS = 4   (rojo, correcto)
2) La misma violacion + un COMMENT ON de dos lineas
   cuya segunda linea contiene "--"                  -> HALLAZGOS = 0
                                                        tablas: 31 en vez de 32
                                                        frente_predio ha DESAPARECIDO
```

Y **el guardián no puede verlo**: `assertThat(migraciones).isNotEmpty()` y
`assertThat(tablasDe(...)).isNotEmpty()` miden el caso «cero». 31 tablas ≠ vacío. El modo de fallo
real no es que no haya migraciones: es que **una de trece deje de leerse**.

Peor caso medido: una comilla sin cerrar al principio deja `V1__baseline.sql` de `rentas` (324 KB,
132 tablas) en `tablas: []`, en 0,15 s, sin un error ni un aviso.

**Arreglo:** un solo recorrido léxico que conozca a la vez `'`, `$tag$`, `--` y `/* */`; y que la
composición **cuente las sentencias que ningún patrón reconoció**, con la prueba exigiéndolo **por
migración** y no globalmente.

---

## 4. Huecos estructurales de CI

Estos no son de ningún PR: son la razón por la que §2.1 y §3.x llegaron a `main` sin que nada
protestara.

### 4.1. `yarn verificar` no corrió en el PR que lo rompió

`infra.yml` se dispara con `paths:` bajo `infra/**`. El PR #6 tocó `CLAUDE.md`, `docs/**` y
`librerias-backend/**` — **ninguna de esas rutas**. Corrieron 2 checks (`comun-verificaciones` y la
guarda del registro) y ninguno ejecuta `yarn verificar`.

Y no hay quien lo cubra desde el otro lado: una migración nueva en `catastro` **no puede** tocar una
ruta de `infrastructure`, y `catastro/.github/workflows/infraestructura.yml` corre el descriptor
*de catastro*, no el `yarn verificar` de este repositorio. Resultado: **el censo C-2 se rompe desde
otro repositorio y nadie lo mide hasta el siguiente PR que toque `infra/`** — que se lo encontrará
rojo por algo que no hizo. Es el modo de fallo de #675, con otro disfraz.

**Arreglo:** añadir `librerias-backend/**` a las `paths` de `infra.yml`, y un trabajo programado
(diario) que corra `yarn verificar` con los seis clones, que es lo único que puede ver un cambio
llegado de un repositorio hermano.

### 4.2. El check verde `comun-verificaciones` no ejecuta ninguna guarda

`librerias-backend` tiene **0 archivos en `src/test`**: las 62 muestras y los `*TestBase` viven en
`src/main` y sólo corren cuando un backend los subclasea. Medido: `./gradlew build` allí compila y
produce **0 resultados de prueba**.

O sea: **PR #6 añadió cinco guardas y el CI de este repositorio no ejecutó ninguna.** El check que
se puso verde es `spotlessCheck` + compilar.

### 4.3. Los cuatro backends clonan `infrastructure` sin `ref`

`backend.yml` de los cuatro hace `repository: hneyra/infrastructure` **sin `ref:`**, o sea la rama
por omisión. Un cambio en `comun-verificaciones` no se ejerce contra ningún backend **antes** del
merge, y en cuanto entra en `main` lo heredan los cuatro a la vez. Un falso positivo nuevo pone los
cuatro en rojo, y la causa está en otro repositorio.

**Arreglo:** un trabajo en `librerias-backend.yml` que clone los cuatro hermanos y corra su
`verificarArquitectura` contra la librería **del PR**. Es lo que convierte «cinco backends la
consumen» en una afirmación comprobada.

---

## 5. Resto de hallazgos

### Altos

| # | Hallazgo |
|---|---|
| A1 | **`frente_predio` no tiene vigencia, ni versión, ni baja** (`V6:114-131`), y su `longitud_m` es la cifra de la que cuelga un cobro de arbitrios. Sólo se puede corregir con `UPDATE`, que la sobrescribe sin rastro. `ficha_catastral`, `titularidad` y `predio` sí conservan historia. Choca con la regla 9 y con «recalcular 2027 en 2037 da el mismo céntimo». Si la decisión es que no se versiona, **que quede escrita en `V6`**: hoy la ausencia se lee como olvido |
| A2 | **`frente_geometria_gix` se justifica con «el trabajo que corre FUERA de RLS» (`V6:58-60`), y ADR-0037 —del mismo PR— dice que ese trabajo no existe**: su §«Lo que NO hace» prohíbe el rol que evade RLS. Bajo RLS `geography_overlaps` no es *leakproof*, así que el índice **no tiene hoy consumidor que pueda usarlo**. Es C-12 otra vez. No hay que retirarlo a ciegas; hay que decidir cuál de los dos ADR se corrige |
| A3 | **`NINGUN_HALLAZGO_CORRIGE_LA_FICHA` es *default-allow* por nombre de clase simple** (`getSimpleName().contains("hallazgo"|"candidato")`). La regla hermana que su propio javadoc cita —`SOLO_LA_TRANSFERENCIA_…`— resolvió el mismo problema al revés: nombres completos anclados y **lo no clasificado es violación**. Medido, el predicado alcanza hoy **exactamente una** clase: un `enum` de cinco valores sin dependencias. Una clase llamada `AplicarLaCampania` o `ConciliarElPadron` —el vocabulario que el propio javadoc usa— no la mira. Es el modo de fallo de R-N, que ya se pagó dos veces |

### Medios

| # | Hallazgo |
|---|---|
| M1 | `RevisorDeEsquema` exime por «no tiene RLS» y no por «no es de tenant» (`:160`): tabla de tenant + geometría + **sin RLS** → 0 hallazgos. El defecto combinado, que es el peor, exime del marco. Arreglo: `tabla.conRls \|\| columnas.containsKey("municipalidad_id")`, más una quinta muestra |
| M2 | `revisarPrefijo` **lee los literales dentro de comentarios `//`** (`literalesDeCadena` sólo quita bloques). Un comentario que mencione `"~>=~"` apaga la regla **para todo el archivo**; y alcanza a la propia muestra: reescrita con `//` en vez de `/** */` pasa de 5 hallazgos a 1 |
| M3 | La lista `busquedasDeTextoLibreConMotivo()` es `Set<String>` **sin issue y sin guarda de entrada muerta**. El proyecto tiene el patrón resuelto dos archivos más allá: `CruceConsentido` rechaza un issue en blanco, y `ningunCruceConsentidoSobra()` pone roja la entrada que ya no exime nada. Además **una entrada exime el archivo entero**, incluidos los prefijos legítimos |
| M4 | El método del índice se captura y **se tira** (`RevisorDeEsquema` `group(3)` nunca se lee): el marco indexado con `USING gist` o `USING brin` pasa en verde — y el GiST multicolumna es justo la variante que ADR-0034 midió y descartó |
| M5 | La comprobación de «generada» es una subcadena y no mira la expresión: **`marco_norte AS (st_ymin(…))` y `marco_sur AS (st_ymax(…))` —norte y sur cruzados— pasa en verde.** Es el error de copiar-pegar más probable de los cuatro, y su efecto es «el filtro empieza a esconder lotes sin decirlo», que es la frase de la propia regla |
| M6 | La prueba nueva del marco usa un rectángulo que **abarca el planeta**, así que el predicado es una tautología: quedaría verde con las cuatro columnas cruzadas, y la separación por grado de longitud que la fixture introduce a propósito no la ejerce ninguna aserción |
| M7 | Falsos positivos de `RevisorDeEsquema` sobre índices **estrictamente mejores**: `… INCLUDE (geometria)` y `…, id)` salen rojos (compara por igualdad, no por prefijo). Es #437: la comprobación que grita el primer día se silencia |
| M8 | `V1_1__` y `R__` de Flyway **se ignoran en silencio**, y `V20260905120000__` revienta con `NumberFormatException` sin nombrar el archivo |
| M9 | **ADR-0036 §1 no está implementado** (el patrón por municipalidad; el dominio global `cod_catastral` sigue igual) y sin embargo `catastro/CLAUDE.md` ya tacha **D-10** con un ADR en estado `Propuesto`. Una decisión abierta no se cierra con un ADR propuesto y con la mitad estructural sin migrar |

### Bajos

- El escáner espacial **no cubre** `~`, `@`, `<->`, `ST_Disjoint`, `ST_Equals`; y `&&` exige una
  palabra de geometría en la sentencia, así que una columna llamada `trazo` o `ubicacion` lo apaga.
- `revisarPrefijo` no cubre `LIKE CONCAT(:x,'%')`, `~~`, `SIMILAR TO`, `starts_with(...)`.
- Un comodín **al final** en Java (`codigo + "%"`, una búsqueda por prefijo de libro) se diagnostica
  como «comodín por delante» y se le ofrece la lista de exenciones en vez de `~>=~`.
- `ADD COLUMN "geometria"` (identificador entrecomillado) apaga la regla entera; `CREATE TABLE …)
  TABLESPACE x` desaparece del esquema; dos tablas con el mismo nombre corto en esquemas distintos
  se pisan.
- La muestra `MuestraDeControladorQueRecibeGeometria:62` usa `double marcoOeste`. **No pone nada
  rojo** —el paquete de muestras sólo lo ve `ReglasDeArquitecturaMuerdenTest`, donde una violación
  es lo que se espera— y ése es el problema: es un **segundo violador no declarado** de la regla 1,
  así que borrar `MuestraQueViolaLasReglas` seguiría dando verde. Y de paso enseña como correcta
  una forma que `MarcoGeografico:22-25` rechazó por escrito («`double` está prohibido en todo
  `kamayuk.catastro`, **sin excepción por tipo de magnitud**»), mientras el controlador real recibe
  el marco como `String`. Arreglo: `String marcoOeste`.
- Tres sitios citan «la plantilla de **ADR-0034 §4.1**», incluido el **mensaje de una aserción**.
  ADR-0034 no tiene §4.
- `ADR-0035` mete `acta` en `TABLAS_INMUTABLES` sin definirla en ninguna parte.
- La guarda de particiones de `RevisorDeEsquema` (`:261-265`) es **código muerto**: retirarla no
  cambia ningún resultado.
- `ConfiguracionDelSgtm.java` en `rentas` conserva el nombre del producto que R-A/B retiró.
- «44 clases de muestra» en `CLAUDE.md` no reproduce con ningún conteo obvio (58→62 archivos, o
  43→46 con prefijo `Muestra`).

---

## 5 bis. Las filas del registro, que hay que corregir

La disciplina de este proyecto es que la fila diga la verdad, porque «lo que la fila **diga** no lo
puede leer una máquina: eso lo lee la revisión». Tres afirmaciones de las filas de T-0 no se
sostienen:

1. **«`yarn verificar` no se mueve: 38 rojas antes y 38 después, las mismas una a una»**
   (`infrastructure/CLAUDE.md` y `catastro/CLAUDE.md:207`). **Sí se movió**: con los seis clones la
   línea base es 680/680 en verde, y `V6` deja **2 rojas** (§2.1). Las 38 eran del entorno.
2. **«Cada una viaja con su clase de muestra, como exige `ReglasDeArquitecturaMuerdenTest`»**
   (T-0 §3). Es falso para `RevisorDeEsquema`, `revisarEspacial` y `revisarPrefijo`: ese
   `@TestFactory` itera sobre `ReglasDeArquitectura.todas()`, que son `ArchRule`; **un escáner de
   texto no puede estar ahí**. Los sujetan `@Test` escritos a mano, y nada obliga a que un escáner
   nuevo traiga muestra. La frase promete una garantía por construcción que no existe.
3. **«Quitarle a `frente_predio` sus cuatro columnas de marco y su índice → **1** en rojo»**.
   Ejecutado, `RevisorDeEsquema.revisar` devuelve **5 hallazgos**. La cifra no es incorrecta —cuenta
   la prueba JUnit que los agrupa— pero el resto de la fila cuenta hallazgos, así que mezcla dos
   unidades en la misma línea.

Y **D-10 está tachada en `catastro/CLAUDE.md:94` con un ADR en estado `Propuesto` cuya mitad
estructural no está implementada**: `cod_catastral` sigue siendo `varchar(25)` con
`CHECK (~ '^[0-9]{18,25}$')` en `V1:138-139`, que es un largo global escrito en el esquema — o sea,
literalmente lo que D-10 preguntaba. O vuelve a abrirse con la nota de que ADR-0036 contesta la
mitad del SNCP, o se implementa §1 en esta fase.

---

## 6. Lo que se recomienda hacer, por orden

1. **`V6`: el dominio a `varchar` y el índice sobre la columna**, con las dos pruebas de plan
   gemelas de `BusquedaDelCatalogoVialTest`. Sin ellas el arreglo no se puede demostrar. (§2.2)
2. **El censo C-2** (§2.1) — dos líneas, ya validado en 680/680.
3. **Las tres barreras que no muerden**: camelCase (§3.1), `nombreDelParametro` que lance (§3.2),
   marco *comparado* y no *mencionado* (§3.3). Las tres son de una a diez líneas, y las tres
   necesitan su muestra nueva o el arreglo se puede deshacer en verde.
4. **El recorrido léxico de `RevisorDeEsquema`** y el censo de sentencias no reconocidas (§3.4).
5. **Los tres huecos de CI** (§4). El más barato y el que más compra: añadir `librerias-backend/**`
   a las `paths` de `infra.yml`.
6. **Decidir** las dos contradicciones —el GiST y su ADR (A2), y D-10 con ADR-0036 §1 (M9)—: no se
   arreglan editando, se arreglan eligiendo.
7. **Escribir en `V6`** si `frente_predio` se versiona o no (A1).
8. Lo demás, por severidad.

Y una recomendación de método, porque es la que habría evitado §2.1 y la mitad de §3:

> **Una fase que entrega barreras necesita su propia mutación cruzada.** Las siete roturas de T-0 §6
> son buenas y están bien medidas, pero **todas prueban que la guarda muerde sobre el defecto
> escrito de la forma en que el autor lo escribió**. Las cuatro de §3 aparecen al escribir el mismo
> defecto de la forma en que lo escribiría el código de la casa: `geometriaDelLote` en vez de `wkt`,
> el marco en el `SELECT` en vez de en el `WHERE`, el SQL compuesto por constantes. La pregunta que
> falta en el guion no es «¿muerde?», es **«¿cómo lo escribiría alguien que no está intentando que
> muerda?»**.
