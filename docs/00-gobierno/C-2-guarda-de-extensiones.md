# C-2 — La guarda de extensiones, extendida a los cinco esquemas

> **Estado: cerrado, con tres huecos declarados en §6 — los huecos 2 y 3 los cerro
> [C-10](C-10-las-extensiones.md), y con el la decision de §1.4 quedo superada: las cinco
> declaraciones de mas se retiraron y el censo paso a ser un rojo.** La guarda de #742 miraba **un**
> repositorio con la ruta escrita a mano; ahora mide **seis copias de esquema** —los cinco
> sistemas de `SISTEMAS` más la copia local del monolito— y su lista **no se escribe aquí**: se
> deriva de la tabla que `deriva-de-migraciones.ts` ya mantiene.
>
> Cifras: **infrastructure 366 → 374** (+8 pruebas). **rentas 3 102 · catastro 958 · caja 669 ·
> normativa 602**, ninguna baja. El punto 4 queda cerrado y demostrado en **dos** repositorios,
> no en uno.

---

## 0. Lo que la medición corrigió antes de tocar código

Tres cosas del encargo cambiaron al comprobarlas contra el árbol, y las tres cambian **qué** hay
que hacer:

1. **`normativa` declara cuatro extensiones y no usa ninguna.** El encargo lo planteaba como
   sospecha («puede que no use ninguna. Compruébalo»). Medido: su `V1__baseline.sql` no llama a
   `unaccent()`, no indexa con `gin_trgm_ops`, no tiene un solo tipo `geography`/`geometry` y no
   tiene **ni un** `EXCLUDE USING gist`. Las cuatro son el archivo que P3 copió del monolito y que
   P5D podó en `caja` y P5E en `rentas`, y que aquí nadie decidió.

2. **`catastro` declara una de más: `pg_trgm`.** No estaba en el encargo. Su baseline usa
   `unaccent` (por `nombre_normalizado(text)`), `postgis` y `btree_gist` — y ninguna función de
   similitud por trigramas, que es del **padrón** de contribuyentes (RF-014) y por tanto de
   `rentas`.

3. **El mismo hueco de entrada de Gradle del punto 4 está también en `rentas`**, no sólo en
   `normativa`. `ContratoConCajaTest` lee `../../caja/docs/50-api/contratos-que-consume/rentas.json`
   y ese archivo no era entrada declarada de `test`. Se cierra igual, y se demuestra igual (§4).

Y una cuarta, que no cambia el trabajo pero sí lo que se puede prometer: **el compose local no
lee ningún `crear-roles.sql` de los cuatro sistemas**. `despliegue/inicializacion-del-motor/05-crear-bases.sh`
crea las cuatro extensiones **en las cuatro bases**, con la lista escrita a mano, «para que el
baseline de cualquiera pueda correr sin sorpresas». Es un tercer sitio donde se nombran
extensiones; queda declarado en §6.

---

## 1. Cómo quedó la guarda

`infra/verificaciones/extensiones-de-las-migraciones.ts`.

### 1.1 La unidad es la **copia del esquema**, no el repositorio

```
infrastructure (copia del esquema del monolito)   68 migraciones
sgtm                                              68
rentas                                            10
catastro                                           3
normativa                                          1
caja                                               2
```

Son **seis entradas para cinco esquemas**, y la que sobra no sobra: el monolito tiene dos copias y
cada una se ejecuta por su lado. La de `sgtm` es de donde `publicar-imagenes.yml` construye
`sgtm-migrador`; la de este repositorio es la que `componentes/fuentes.ts` mete en el `ConfigMap`
y la que `plataforma.compose.yaml` monta como `10-crear-roles.sql`. Son byte a byte la misma hoy
—medido con `diff -rq`— y **nada lo garantiza**, así que se miden las dos. Medir sólo la de `sgtm`
dejaría sin vigilancia el archivo que de verdad se aplica; medir sólo la local dejaría sin
vigilancia las migraciones que de verdad corren.

### 1.2 La lista de esquemas no se escribe aquí

Sale de `SISTEMAS`, en `deriva-de-migraciones.ts`, que ya declaraba `clon` y `migraciones` de los
cinco por otro motivo. **Ése es el arreglo de fondo**: el defecto de #742 no fue que la ruta
estuviera mal, fue que estaba escrita **a mano en un segundo sitio**, así que cuando aparecieron
cuatro repositorios nuevos la guarda siguió mirando uno solo y no se puso roja. Una lista propia
aquí sería exactamente el mismo defecto otra vez.

El `crear-roles.sql` de cada esquema **se deriva** del directorio de migraciones (`db/migration/`
y `db/roles/crear-roles.sql` son hermanos bajo `db/` en los seis), en vez de ser una segunda
columna que mantener de acuerdo. Que la convención se cumpla **no se supone**: `rolesDe()` rechaza
una ruta que no acabe en `migration/`, y una prueba exige que los dos archivos existan en los seis.

Y el clon hermano **tiene que estar**: se reutiliza `clonDe()`, que falla nombrando el clon y el
`git clone` que lo trae. Replegarse a «no se puede medir, paso en verde» es el estado exacto que
#675 encontró y que estuvo ocho meses así.

### 1.3 Lo del núcleo se sigue distinguiendo de lo de una extensión

Intacto, y con su motivo intacto: `DEL_NUCLEO` existe porque **medirlo desmintió** la premisa con
que nació la guarda. `text_pattern_ops` aparece dieciséis veces en las migraciones del monolito
—porque bajo RLS un `LIKE 'prefijo%'` no llega nunca al índice y toda búsqueda por prefijo de este
producto se escribe con él—, así que sin esa lista la guarda daba dieciséis falsos positivos de
golpe. `DE_EXTENSION` sigue siendo el **único** sitio donde se nombran las clases de operadores, y
una prueba impide que `REGLAS` vuelva a nombrar ninguna.

Y `clasesDeOperadoresSinRegla()` sigue siendo la mitad honesta: una clase que ninguna de las dos
listas conozca **se dice**, ahora nombrando además el repositorio.

### 1.4 Lo declarado y no usado: **se marca, y como censo**

Es la mitad que #742 no miraba, y el encargo pedía decidirla por escrito.

**Se marca**, porque una declaración de más no es ruido inocuo:

- `postgis` **no es trusted** —medido: `SELECT trusted FROM pg_available_extension_versions WHERE
  name='postgis'` da `f`—, así que declararla obliga a un superusuario en cada ambiente donde se
  provisione esa base y a la imagen `postgis/postgis`, que la oficial no trae. Una base que no la
  necesita hereda las dos condiciones.
- Y **ya se ve en otra guarda**: `postgis` crea `spatial_ref_sys`, de modo que el
  `AislamientoMultiTenantTest` de `normativa` lleva una exención para una tabla que su esquema no
  necesitaría. `rentas` retiró la extensión **y la exención** en P5E; `normativa` conserva las dos.
  O sea que la declaración de más no se queda quieta: se propaga a la lista de excepciones de la
  barrera número uno.

**Como censo y no como rojo**, por dos motivos:

- con lo medido hoy, un rojo **nacería disparado** en dos de los seis esquemas, y una comprobación
  que grita el primer día se acaba silenciando — es lo que #437 midió al descartar ensanchar el
  patrón de la regla 5 por sus ocho falsos positivos;
- y retirar una declaración **cambia cómo se provisiona esa base en todos los ambientes**. Es una
  decisión del dueño de ese esquema, como lo fue la de `caja` en P5D y la de `rentas` en P5E, no un
  efecto colateral de una guarda de `infrastructure`.

`DECLARADAS_DE_MAS` lleva las cinco entradas de hoy **con el motivo de cada una**, y la prueba la
compara con lo medido **en las dos direcciones**. Eso es lo que hace que valga lo mismo que un
rojo: una declaración de más nueva se pone roja nombrando repositorio y extensión, y una entrada
que deja de ser cierta —porque alguien la retiró, o porque una migración nueva empezó a usarla—
**también**. No hay dónde esconder una ni dónde dejar rancia la otra.

| Repositorio | Declarada de más | Por qué |
|---|---|---|
| `catastro` | `pg_trgm` | la búsqueda por aproximación es del padrón de `rentas` (RF-014) |
| `normativa` | `btree_gist` | no tiene un solo `EXCLUDE USING gist`; la de vigencias es de `catastro` (#669) |
| `normativa` | `pg_trgm` | ídem `catastro` |
| `normativa` | `postgis` | la más cara: no es trusted, y arrastra la exención de `spatial_ref_sys` |
| `normativa` | `unaccent` | lo que la obligaría es `nombre_normalizado(text)`, que P5B retiró por ser de `catastro` |

**No se retira ninguna en este trabajo, y es deliberado.** Lo que C-2 entrega es que dejen de poder
pasar inadvertidas.

> **Superado por [C-10/C-13](C-10-las-extensiones.md).** Las cinco se retiraron, con el diff de
> esquema medido —`pg_dump --schema-only` difiere en exactamente las lineas de las extensiones
> retiradas y en nada mas—, y con ello el primero de los dos motivos de arriba se acabo: el rojo
> nace en verde. `DECLARADAS_DE_MAS` queda como lista de excepciones **vacia** y
> `declaradasSinUsar()` como rojo.

---

## 2. Las mutaciones, una por repositorio

Cada una aplicada **sola**, ejecutada, y restaurada **por copia comparada con `cmp`** antes de la
siguiente. Los seis clones quedan con `git status` vacío.

| # | Repositorio | Mutación | Rojo |
|---|---|---|---|
| 1 | `infrastructure` (copia del monolito) | quitar `CREATE EXTENSION … postgis;` | **2 de 22** — «*«infrastructure (copia del esquema del monolito)»: V61__geometria_del_predio.sql necesita la extensión «postgis» y su crear-roles.sql no la declara — los tipos geography y geometry los aporta postgis (ADR-0021)*» |
| 2 | `sgtm` | quitar `CREATE EXTENSION … btree_gist;` **sobre una copia** (§2.1) | «*«sgtm»: V72__vigencias_que_no_se_pisan.sql necesita la extensión «btree_gist» y su crear-roles.sql no la declara — un EXCLUDE USING gist que compara con «=» necesita las clases de operadores btree dentro de un índice GiST, y eso lo aporta btree_gist*». **El contraste**: la misma copia sin mutar, «VERDE (no muerde)» |
| 3 | `rentas` | quitar `CREATE EXTENSION … unaccent;` | **2 de 22** — «*«rentas»: V1__baseline.sql necesita la extensión «unaccent» y su crear-roles.sql no la declara — unaccent() no es una función del núcleo*» |
| 4 | `catastro` | quitar `CREATE EXTENSION … postgis;` | **2 de 22** — «*«catastro»: V1__baseline.sql necesita la extensión «postgis»…*» |
| 5a | `normativa` | quitar `CREATE EXTENSION … postgis;`, que **no usa** | **3 de 22** — el censo, en la dirección de la entrada rancia: «*- "«normativa» declara «postgis» y ninguna migración suya la usa"*» |
| 5b | `normativa` | 5a **más** una columna `geography(MultiPolygon, 4326)` en su `V1` | **5 de 22** — «*«normativa»: V1__baseline.sql necesita la extensión «postgis» y su crear-roles.sql no la declara…*» |
| 6 | `caja` | **el caso contrario**: `caja` no declara ninguna a propósito, así que se le añade a `V1` un índice sobre `lower(unaccent(cajero))` | **2 de 22** — «*«caja»: V1__baseline.sql necesita la extensión «unaccent» y su crear-roles.sql no la declara — unaccent() no es una función del núcleo*» |
| 7 | (la guarda) | quitar `caja` de `SISTEMAS` | **4 de 22**. Es la mutación que mide el defecto de #742: sin ella, un repositorio entero deja de mirarse y nada se pone rojo |
| 8 | (la guarda) | apartar el clon de `normativa` | **No concluye**, con el remedio: «*No está el clon de «normativa» en «…», así que no se puede saber qué migraciones declara… git clone https://github.com/hneyra/normativa*». No pasa en verde |

### 2.1 Por qué la de `sgtm` se mide sobre una copia

Porque **el archivo histórico no se escribe**. La guarda lo lee —y esa lectura está sujeta por las
pruebas que fijan `esquemas()`, las 68 migraciones y las cuatro extensiones declaradas—, pero
mutarlo, aunque fuera para restaurarlo, es escribir en él.

Así que la mutación se aplica a una copia del `db/` de `sgtm` en un directorio temporal y se corre
**el código de producción sobre ella**: `usosSinDeclarar([esquemaDeLaCopia])`, con el mismo
`rolesDe`, el mismo `REGLAS` y el mismo `descripcionDelUso`. Lo único que cambia es la raíz. Ese
parámetro opcional existe **sólo** para esto y su javadoc lo dice; lo que sujeta que la corrida de
verdad mire los seis es la prueba que fija `esquemas()`, no el parámetro.

`sgtm` queda intacto: `git status` vacío, HEAD `0d33ad7b`.

---

## 3. CI

`.github/workflows/infra.yml`, trabajo `verificar`: cuatro `actions/checkout` más
—`hneyra/rentas`, `hneyra/catastro`, `hneyra/normativa`, `hneyra/caja`, en `../<nombre>`—, junto al
de `hneyra/sgtm` que ya estaba. `fetch-depth` por omisión y no `0`, al revés que los dos de arriba:
aquí no se cuenta nada en el árbol de git de otro commit, se leen los archivos del árbol de
trabajo.

Sin ellos la prueba **no concluye** —dice qué clon falta y cómo traerlo— en vez de mirar uno solo y
pasar en verde, que es exactamente el estado en que #742 dejó la guarda.

---

## 4. El punto 4: la entrada de Gradle, cerrada en **dos** repositorios

### `normativa` — lo que el encargo pedía

`ContratoConRentasTest` lee `../../rentas/docs/50-api/contratos-que-consume/normativa.json` y
`ContratoConCatastroTest` el homónimo de `catastro`. Ninguno era entrada declarada de `test`.

**Reproducido antes de arreglarlo**: se le añadió al contrato de `rentas` un campo
`campoQueNadiePublica` —algo que `normativa` no publica— y

```
> Task :kamayuk-normativa-aplicacion:test UP-TO-DATE
BUILD SUCCESSFUL in 322ms
```

La prueba **no corrió**. Declarados los dos archivos como entrada (`inputs.files(...).optional()`,
la misma media docena de líneas que C-1 le puso a `catastro`), la misma mutación:

```
> Task :kamayuk-normativa-aplicacion:test
Contrato con rentas (normativa es el proveedor) > este backend cumple lo que su consumidor espera de el FAILED
    Expecting empty but was: ["GET /conjuntos: falta el campo «campoQueNadiePublica», que el
    consumidor lee. Este endpoint declara [conjuntoId, ejercicio, version]."]
BUILD FAILED in 4s
```

Restaurado el contrato, `BUILD SUCCESSFUL`.

### `rentas` — el mismo hueco que nadie había contado

`ContratoConCajaTest` lee `../../caja/docs/50-api/contratos-que-consume/rentas.json`, tampoco
declarado. Mismo procedimiento, con un parámetro que `rentas` no lee:

```
sin la entrada declarada:   > Task :kamayuk-rentas-aplicacion:test UP-TO-DATE
                            BUILD SUCCESSFUL in 275ms

con la entrada declarada:   Contrato con caja (rentas es el proveedor) > … FAILED
    Expecting empty but was: ["POST /pagos: el consumidor manda «parametroQueNadieLee» y este
    endpoint no lo lee (lee [actualizadoA, fecha, motivo, ordenes, pagador, pagoId,
    pagoOriginalId, recibo, sistemaOrigen, tipo, total]). Viaja en la URL y se descarta en
    silencio."]
                            BUILD FAILED in 19s
```

Con esto, **los tres proveedores** que comprueban un contrato que vive en otro clon lo declaran:
`catastro` (C-1), `normativa` y `rentas` (C-2). `caja` no tiene ninguno: no es proveedor de nadie.

---

## 5. Las cifras

| Repositorio | Antes | Después | Diferencia |
|---|---:|---:|---|
| `infrastructure` | 366 | **374** | +8: la guarda pasa de 14 pruebas a 22 |
| `rentas` | 3 102 | **3 102** | sólo `build.gradle.kts` |
| `catastro` | 958 | **958** | sin tocar |
| `normativa` | 602 | **602** | sólo `build.gradle.kts` |
| `caja` | 669 | **669** | sin tocar |
| `sgtm` | — | — | **sin tocar**, HEAD `0d33ad7b` |

`yarn verificar` de `infrastructure` en verde: lint, `tsc --noEmit` en los dos `tsconfig`, y 374
pruebas en 17 archivos. `build` de `rentas` y de `normativa` en verde —con Spotless, Checkstyle y
NullAway— contra **PostgreSQL 16.15 real** y no por Testcontainers (el demonio de Docker de esta
máquina es un túnel a un VPS y el puerto publicado del contenedor se queda allí), con el repliegue
`-Dkamayuk.pruebas.postgres.url=jdbc:postgresql://127.0.0.1:55444/postgres`. Los dos módulos de
aplicación se corrieron además con `cleanTest --no-build-cache`, porque una tarea que sale
`FROM-CACHE` no demuestra nada — que es literalmente el defecto del punto 4.

---

## 6. Huecos declarados

1. **La guarda cubre cinco repositorios y sólo se dispara en los PR de `infrastructure`.** El
   filtro `paths` de `infra.yml` sólo puede nombrar rutas de **este** repositorio, así que un PR de
   `rentas` que añada una migración con una extensión sin declarar **no ejecuta esta guarda**: lo
   hará el siguiente PR que toque `infra/`. Es el mismo hueco que #675 dejó abierto con todas sus
   letras —«eso hay que cerrarlo con un disparo entre repositorios (`repository_dispatch`) y **no
   está hecho**»— y se cierra por el mismo sitio. Tampoco corre en el `schedule` diario, porque
   `verificar` lleva `if: github.event_name != 'schedule'`; darle un latido diario es una decisión
   de CI aparte, porque arrastraría también a `deriva-de-migraciones.test.ts`.

2. **[CERRADO por C-10.] Las extensiones se nombran hoy en TRES sitios, y esta guarda sólo ata dos.**
   `despliegue/inicializacion-del-motor/05-crear-bases.sh` crea `pg_trgm`, `unaccent`,
   `btree_gist` y `postgis` **en las cuatro bases**, con la lista escrita a mano y sin leer ningún
   `crear-roles.sql`. Su propio comentario lo justifica —«para que el baseline de cualquiera pueda
   correr sin sorpresas»— y el efecto colateral está medido: en el entorno local **la decisión de
   `caja` no se cumple**, su base recibe PostGIS igual, así que «la caja corre en el motor más
   simple que exista» no se ejercita en ninguna parte. Atar ese guion a los cuatro archivos es otro
   trabajo, y es el que haría falta para que esa decisión de P5D fuera comprobable.
   *(C-10 lo hizo: el guion deriva de los `crear-roles.sql` que el compose le monta, y `caja` tiene
   ya su prueba —`BaseSinExtensionesTest`— de que su esquema aplica con cero extensiones.)*

3. **[CERRADO por C-10.] `despliegue/crear-extensiones.sh` sigue con la ruta del monolito escrita a mano.** Lee
   `backend/sgtm-esquema/.../crear-roles.sql` y sólo sabe hablar con la base `sgtm` de un
   namespace. Extenderlo a cuatro bases exige decidir namespace y base por sistema, que es
   despliegue y no verificación; queda fuera a propósito y anotado aquí para que no sea un olvido.
   *(C-10 lo midió y no había tal decisión: la base es el nombre del sistema en los cinco y el
   namespace ya venía por `--namespace`. Se ató con `--sistema`.)*

4. **La guarda mide texto, no un motor.** Una extensión declarada y **no disponible en la imagen**
   —`postgis` sobre `postgres:16-alpine`— sigue rompiendo el despliegue y esto no lo ve: sale
   «extension "postgis" is not available» y quien lo caza es `crear-extensiones.sh --comprobar`, o
   el arranque. Lo que C-2 cierra es la otra mitad: usar sin declarar.

5. **`caja` no tiene prueba de contrato del lado del proveedor**, porque no es proveedor de nadie
   hoy. El día que lo sea, su `build.gradle.kts` necesita la misma línea de §4 y no hay nada que lo
   recuerde.

---

## 7. Lo que se decidió **no** hacer

- **No se retiró ninguna extensión declarada de más.** Cambia cómo se provisiona esa base en todos
  los ambientes, y en el caso de `normativa` arrastra además la exención de `spatial_ref_sys` de su
  prueba de aislamiento. Es una decisión del dueño de ese esquema —como la de P5D y la de P5E—, y
  lo que C-2 entrega es que no pueda pasar inadvertida.
- **No se convirtió «declarada de más» en un rojo.** Nacería disparado en dos de seis, y una
  comprobación que grita el primer día se silencia.
- **No se escribió una segunda lista de repositorios.** Sería el defecto de #742 otra vez.
- **No se tocó `sgtm`.** Ni siquiera para mutar y restaurar.
