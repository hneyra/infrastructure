# C-11 — El simulacro de restauración **lógica**

> **Estado: cerrado, con seis huecos declarados en §8.**
>
> El hueco 3 de C-4 pedía «un simulacro de restauración lógica, hermano del físico de
> `INF-08`». Existe, **vuelca y restaura de verdad** contra PostgreSQL 16.15, recorre los
> cinco esquemas, compara el catálogo objeto por objeto y **cuenta las filas**, y no le cree
> al código de salida de nadie.
>
> Corrido entero: **los cuatro sistemas del corte no pierden nada** —0 errores en los dos
> formatos, censo idéntico, retrato exhaustivo con 0 líneas de diferencia y las filas
> cuadradas—. El monolito pierde, y ahora se sabe **cuánto**.
>
> **Y medirlo corrigió dos cosas que se daban por sabidas:**
>
> 1. **`sgtm` no pierde un índice: pierde trece objetos y una tabla entera.** C-4 midió «2
>    errores, el mismo índice y su `COMMENT`», y eso es exacto para
>    `contribuyente_nombre_trgm_ix`. Lo que su medida no cubrió es que **`V66` (#565) le dio
>    a `via` la misma columna generada que tiene `catastro`**: con las 68 migraciones
>    aplicadas son **21 errores**, `via` no se crea, y con ella se van su clave primaria,
>    sus tres índices, su política de RLS, su secuencia, tres restricciones, las dos foráneas
>    que la nombran desde `arancel` y `predio`, **y sus filas**.
> 2. **`pg_restore` NO sale con código 0.** Medido en 16.15: sale con **1**. El que sale con
>    **0** con dieciocho errores dentro es **`psql` sobre un volcado plano** — que es el
>    camino que una persona teclea (`pg_dump … | psql …`). O sea que la premisa era medio
>    cierta y el criterio es más necesario, no menos: el simulacro restaura de **las dos**
>    formas y decide sobre los errores contados.
>
> Cifras: **infrastructure 435 → 461** (+26). `rentas` **3 133** · `catastro` **991** ·
> `caja` **687** · `normativa` **617**, ninguna tocada. `sgtm` **sin tocar**.

---

## 0. Lo que la medición corrigió del encargo

Tres cosas cambiaron al comprobarlas contra el árbol y contra el motor, y las tres cambian
**qué** hay que construir:

1. **El código de salida de `pg_restore` no es el problema; el de `psql` sí.** Con el defecto
   de C-4 devuelto a `catastro`, el **mismo** volcado del **mismo** esquema da:

   | Camino | Errores | Código de salida |
   |---|---:|---:|
   | `pg_restore` sobre `-Fc` | **16** | **1** |
   | `psql -f` sobre volcado **plano** | **18** | **0** |

   Los dos con binarios de 16.15 contra el motor 16.15. Con los binarios del 18 sobre el
   mismo origen: 22 errores y código 1 — la misma clase, así que la versión de los binarios
   no explica la diferencia. Lo que la explica es la herramienta: `psql` sin
   `ON_ERROR_STOP` continúa y termina en verde. **Por eso el simulacro restaura de las dos
   formas**: una sola habría dejado fuera justo el camino silencioso.

2. **El monolito pierde trece objetos, no uno** (§3). Es lo que obliga a que la lista de
   pérdidas declaradas sea una lista y no un booleano, y a que valga en las dos direcciones.

3. **`Preparar.java` no se puede reutilizar para provisionar, aunque sea lo que hay.** Hace
   `ALTER ROLE sgtm_owner … LOGIN PASSWORD 'clave_sgtm_owner'`, y `ALTER ROLE` es **del
   clúster**: pisaría la clave que los cuatro bancos de prueba derivan del identificador del
   clúster (#698) y rompería toda corrida de Gradle apuntando al mismo motor. Además crea
   `pg_trgm`, `unaccent` y `btree_gist` a mano, que es lo que C-10 acaba de quitar. Lo que
   **sí** se reutiliza es el comparador —`Retrato.java` y `canonizar.py`—, que solo lee el
   catálogo (§2.3).

---

## 1. Qué es, y qué no sustituye

`infra/respaldo/simulacro-de-restauracion.sh` es **físico**: wal-g, respaldo base y PITR
(`INF-08`, RNF-079). Copia bloques y no reconstruye nada, así que **ningún defecto de esta
familia lo puede tocar** — y por eso el de C-4 llevaba meses sin que nada lo dijera.

`infra/respaldo/simulacro-de-restauracion-logica.sh` es el otro camino, y hace falta por sí
mismo: migrar de ambiente, copiar `prod` a `stg`, separar un sistema de otro y recuperar
cuando lo que se tiene es un `.dump` pasan **todos** por `pg_dump`/`pg_restore`. Los dos
simulacros son hermanos y **ninguno cubre al otro**.

El defecto que este existe para cazar es de una forma concreta: `pg_dump` empieza todo
volcado con `SELECT pg_catalog.set_config('search_path', '', false)`, cualifica con su
esquema todo lo que emite, y **lo único que no puede cualificar es el interior del cuerpo de
una función**, que para él es una cadena opaca. Si ese cuerpo nombra algo que se resuelve por
`search_path`, la función revienta al insertarse en línea — y con ella se cae un índice o,
peor, **una columna generada, que se inserta al CREAR LA TABLA**.

---

## 2. Cómo está hecho, y por qué así

### 2.1 Lo que hace, por esquema

1. Crea la base **origen** con la misma sentencia que `MotorPostgres.sentenciaDeCreacion`
   (#706): `TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8'`. La
   codificación se declara, no se hereda del clúster anfitrión.
2. La provisiona **como el ambiente real**: `crear-roles.sql` como superusuario —que es quien
   crea las extensiones que **ese** sistema declara, y sólo ésas (C-10)— y después las
   migraciones **en orden de versión**, conectado y con `SET ROLE sgtm_owner`.
3. Siembra los datos de ensayo (§4).
4. Vuelca en **los dos formatos**, `-Fc` y plano.
5. Restaura cada volcado sobre una base **recién creada y vacía**. Vacía a propósito: es lo
   que hace un destino de verdad, y obliga a que las extensiones vengan del propio volcado.
6. **Cuenta los errores de la salida** de cada restauración y **no** se fía del código.
7. Compara origen contra restaurada por tres caminos: censo del catálogo, filas por tabla y
   retrato exhaustivo.
8. Descuenta las pérdidas **declaradas** de ese esquema, en las dos direcciones.

### 2.2 El censo del catálogo, que es lo que nombra lo que falta

`restauracion-logica/censo-del-catalogo.sql` emite una línea por objeto: `TABLA`,
`TABLA_PARTICIONADA`, `VISTA`, `SECUENCIA`, `INDICE`, `RESTRICCION`, `POLITICA_RLS`,
`DISPARADOR`, `FUNCION`, `DOMINIO` y `EXTENSION`, todos por nombre. Se excluyen los objetos
que **pertenecen** a una extensión (`pg_depend.deptype = 'e'`) porque los crea el mismo
`CREATE EXTENSION` a los dos lados; lo que sí se cuenta es la extensión, de modo que si no se
crea desaparece su línea y con ella todo lo suyo.

Es lo que convierte «faltan 12 objetos» en doce líneas con nombre. El retrato solo no puede
hacerlo, por lo que dice §2.3.

### 2.3 El comparador **no se escribió**: es `Retrato.java` y `canonizar.py`

El simulacro llama al arnés de baselines que ya existe, en el clon de `rentas`
(`docs/40-datos/baselines/verificar`), por `gradlew` y con las tres variables
`SGTM_BASELINE_*`. Escribir una tercera copia es exactamente lo que C-3 §7 hueco 2 dejó dicho
que no se hiciera.

`Retrato` es exhaustivo —columnas con su tipo, su `DEFAULT`, su `IDENTITY` y su
`GENERATED_STORED`; restricciones con su `NOT VALID`; índices; políticas con su `using` y su
`check`; privilegios de tabla **y de columna**; disparadores; comentarios por su md5;
dominios; y las funciones de disparador— y por eso vale la pena. Lo que **no** puede ver, por
construcción, es una tabla que no está: se le pasa la lista del origen y del lado restaurado
devuelve silencio. Esa es la división del trabajo: **el censo dice qué falta, el retrato dice
si lo que está es igual.**

`canonizar.py` se aplica a los dos lados por igual, y no oculta nada: sólo quita los casts
redundantes sobre literales que `pg_get_constraintdef` no reimprime igual (DAT-02 §3).

### 2.4 Lo que se decidió no hacer, y por qué

- **No levanta ningún motor.** Apunta al que se le diga (`--host/--puerto/--usuario`, clave
  por `PGPASSWORD`). El motor de verificación lo levanta `lib-motor-local.sh`, y aquí no,
  porque este guion tiene que poder correr contra el motor que ya haya — que es como se
  midieron C-4 y C-10 en esta máquina, donde Docker es un túnel a un VPS.
- **No aplica las migraciones con Flyway**, por lo que dice §0.3. La consecuencia es que el
  libro de Flyway no existe, y el `V21` del monolito hace un `GRANT` sobre él; el guion lo
  crea antes, y **decide si hace falta leyendo las migraciones** (`rl_necesita_libro_de_flyway`),
  no escribiendo «si el sistema es `sgtm`». Los comentarios no cuentan: los cuatro baselines
  nombran esa tabla en su cabecera para explicar por qué **no** la usan (#426, #558).
- **No tiene una segunda lista de sistemas.** `rl_sistemas` la declara y una prueba la
  **ejecuta** y la compara con `SISTEMAS` de `deriva-de-migraciones.ts`. Los caminos —el
  `crear-roles.sql` y el directorio de migraciones— se **buscan** con el mismo criterio que
  `crear-extensiones.sh` (comodín sobre el nombre del módulo, cero o más de uno se dice en vez
  de elegir), y otra prueba compara lo que el shell resuelve con lo que `SISTEMAS` declara.
- **No hay puerta de escape para la versión del motor.** `rl_exigir_version_soportada` sólo
  admite 16, la misma constante que `MotorPostgres.MAJOR_SOPORTADA` declara en los cuatro
  backends — y una prueba lee las dos y las compara. Y los tres binarios tienen que ser de ese
  major: en esta máquina el `pg_dump` del PATH es el **18**, y volcar con uno y restaurar con
  otro mide otra cosa.

---

## 3. El simulacro ejecutado, con sus recuentos

Contra **PostgreSQL 16.15** en `127.0.0.1:55444`, con los binarios de
`/opt/homebrew/opt/postgresql@16/bin`. Los cinco esquemas, **14,3 s**, código de salida 0.

```
infra/respaldo/simulacro-de-restauracion-logica.sh \
    --puerto 55444 --binarios /opt/homebrew/opt/postgresql@16/bin
```

| Esquema | Migr. | Censo origen → restaurada | Filas origen → restaurada | Retrato | `pg_restore -Fc` | `psql` plano | Veredicto |
|---|---:|---:|---:|---:|---|---|---|
| **`sgtm`** | 68 | **1 707 → 1 694** | **8 508 → 8 506** | 9 268 líneas, 0 dif.¹ | 21 err., cód. 1 | 24 err., cód. **0** | OK con **13** pérdidas declaradas |
| `rentas` | 12 | 1 365 → 1 365 | 7 → 7 | 8 281 líneas, 0 dif. | 0 err., cód. 0 | 0 err., cód. 0 | **no se pierde nada** |
| `catastro` | 5 | 342 → 342 | 8 507 → 8 507 | 2 115 líneas, 0 dif. | 0 err., cód. 0 | 0 err., cód. 0 | **no se pierde nada** |
| `normativa` | 1 | 209 → 209 | 4 → 4 | 1 255 líneas, 0 dif. | 0 err., cód. 0 | 0 err., cód. 0 | **no se pierde nada** |
| `caja` | 2 | 295 → 295 | 8 → 8 | 1 749 líneas, 0 dif. | 0 err., cód. 0 | 0 err., cód. 0 | **no se pierde nada** |

¹ con **4 tablas excluidas** del retrato por estar afectadas por una pérdida declarada
(`via`, `arancel`, `predio`, `contribuyente`). Ver §5 y el hueco 3.

El censo por clase de objeto, que es el criterio «mismo número de tablas, de índices, de
restricciones, de funciones y de políticas RLS»:

| Clase | `sgtm` | `rentas` | `catastro` | `normativa` | `caja` |
|---|---:|---:|---:|---:|---:|
| TABLA | 128 | 108 | 32 | 18 | 24 |
| TABLA_PARTICIONADA | 5 | 5 | 1 | 1 | 1 |
| INDICE | 419 | 348 | 89 | 46 | 76 |
| RESTRICCION | 881 | 697 | 139 | 87 | 142 |
| POLITICA_RLS | 138 | 115 | 35 | 25 | 27 |
| SECUENCIA | 106 | 78 | 27 | 15 | 21 |
| DISPARADOR | 10 | 2 | 4 | 6 | 1 |
| FUNCION | 9 | 3 | 5 | 4 | 1 |
| DOMINIO | 7 | 7 | 7 | 7 | 2 |
| EXTENSION | 4 | 2 | 3 | 0 | 0 |
| **total** | **1 707** | **1 365** | **342** | **209** | **295** |

La fila de `EXTENSION` es, de paso, C-10 medido desde otro sitio: `normativa` y `caja` tienen
**cero**, `rentas` dos, `catastro` tres y el monolito cuatro.

---

## 4. Datos, no sólo esquema — y hasta dónde

**Sí cubre datos.** Una restauración que recupera el esquema y pierde filas es igual de mala,
y además el modo de fallo existe: `pg_restore` carga los datos **antes** de crear índices y
restricciones, así que un `COPY` que falla —o una tabla que no llegó a crearse— deja el
recuento a cero sin que el censo de objetos diga nada.

`restauracion-logica/filas-por-tabla.sql` cuenta con `count(*)` **todas** las tablas de
`public` en las dos bases y compara tabla por tabla. Cuenta de verdad y no por `reltuples`:
el estimador vale `-1` en una base recién restaurada sobre la que nadie corrió `ANALYZE`, de
modo que una comparación sobre él no hablaría de filas.

Lo que se siembra, y **es poco, y hay que decirlo**:

| Archivo | Qué siembra | Por qué ése |
|---|---|---|
| `comun.sql` | 2 `municipalidad` + 2 `modulo_sistema` | están en los cinco esquemas con la misma forma; **dos** municipalidades porque una sola no distingue «se restauró» de «se restauró la del inquilino equivocado» |
| `catastro.sql` | 3 `via` | **es la tabla que el defecto se lleva por delante** — sembrarla es lo que convierte «faltan 12 objetos» en «y además se perdieron 3 filas» |
| `rentas.sql` | 3 `contribuyente` | la tabla cuyo índice de trigramas se pierde en el monolito |
| `caja.sql` | 2 `area` + 2 `caja` | las dos sin las que una instalación no puede cobrar (#430), y las más simples de sembrar sin inventar ninguna cifra |
| `sgtm.sql` | 2 `contribuyente` + 2 `via` | el monolito tiene las dos |
| `normativa.sql` | **nada propio, y con su motivo escrito dentro** | su única tabla propia que se podría llenar exige publicar una cifra normativa, y una cifra inventada es exactamente lo que la **regla 5** y el corpus verificado existen para impedir |

Y una fuente de datos que no hay que sembrar: **`spatial_ref_sys`**, que PostGIS marca como
tabla de configuración y `pg_dump` sí vuelca. Son **8 500 filas** que viajan de verdad en
`catastro` y en `sgtm`, y son las únicas que un esquema recién aplicado tiene sin que nadie
las ponga.

**Lo que la parte de datos NO demuestra**, dicho aquí y no descubierto luego: el volumen es de
juguete —de 4 a 8 filas propias por esquema—, así que lo que se ejercita es **el camino**
(`COPY`, el orden de carga frente a la creación de índices y restricciones, y que las filas
llegan a la tabla que les toca), no el comportamiento con un padrón real. Un `COPY` que sólo
fallara con volumen, o una restricción que sólo se violara con datos de verdad, esto no lo ve.

---

## 5. Que puede fallar, demostrado

Cuatro mutaciones. Cada una se aplicó **sola**, se ejecutó y se restauró **por copia
comprobada con `cmp`**.

### A. El defecto de C-4, devuelto a `catastro` — la mutación que el criterio pide

Se aparta `V4__nombre_normalizado_sin_search_path.sql`, de modo que la función vuelve al
cuerpo sin cualificar que declara `V1`.

```
  pg_restore (-Fc): 16 error(es), codigo de salida 1
  psql (plano)    : 18 error(es), codigo de salida 0
  censo del catalogo: 342 objetos en el origen, 330 en la restaurada
  filas: 8507 en el origen, 8504 en la restaurada
  retrato exhaustivo: 2115 lineas, 63 de diferencia
  ROJO la restauracion desde el volcado -Fc no fue limpia
  ROJO la restauracion desde el volcado PLANO no fue limpia
  ROJO se PERDIERON objetos que nadie declaro perdidos:
        INDICE via_codigo_prefijo_ix EN via
        INDICE via_codigo_uq EN via
        INDICE via_nombre_busqueda_ix EN via
        INDICE via_pk EN via
        POLITICA_RLS via.via_tenant
        RESTRICCION arancel.arancel_via_fk
        RESTRICCION predio.predio_via_fk
        RESTRICCION via.via_codigo_uq
        RESTRICCION via.via_municipalidad_id_fkey
        RESTRICCION via.via_pk
        SECUENCIA via_id_seq
        TABLA via
  ROJO se perdieron o aparecieron FILAS:
        < FILAS via 3
```

**Nombra la tabla que se pierde, los cuatro índices, la política de RLS, la secuencia, las
cinco restricciones —dos de ellas de OTRAS tablas— y las tres filas.** Código de salida 1.
Y en la misma pantalla está la razón de existir del criterio 3: la línea del volcado plano,
con **18 errores y código de salida 0**.

### B. El mismo defecto, devuelto a `rentas`

Se aparta `V11__nombre_normalizado_sin_search_path.sql`. Allí la función alimenta un índice y
no una columna generada, así que la pérdida es de uno:

```
  pg_restore (-Fc): 1 error(es), codigo de salida 1
  psql (plano)    : 1 error(es), codigo de salida 0
  censo del catalogo: 1365 objetos en el origen, 1364 en la restaurada
  retrato exhaustivo: 8281 lineas, 1 de diferencia
  ROJO se PERDIERON objetos que nadie declaro perdidos:
        INDICE contribuyente_nombre_trgm_ix EN contribuyente
```

### C. Quitar una entrada de la lista de pérdidas declaradas

Se borra `TABLA via` de `rl_perdidas_conocidas` para `sgtm`:

```
  ROJO se PERDIERON objetos que nadie declaro perdidos:
        TABLA via
```

### D. Declarar una pérdida que **no** ocurre — y el defecto que destapó

Se le da a `caja` una entrada `TABLA recibo`, que no se pierde:

```
  ROJO «caja» declara perdidas que ya NO ocurren. Quita la entrada de
       rl_perdidas_conocidas, o la lista empieza a mentir:
        TABLA recibo
```

**Y la primera vez que se midió, esa rama no llegó a escribirse.** El guion moría antes con

```
simulacro-de-restauracion-logica.sh: line 342: SISTEMA»: unbound variable
```

porque el mensaje decía `«$SISTEMA»` sin llaves y bajo `set -u` bash lee los bytes de `»`
como parte del nombre de la variable. Es un defecto del propio simulacro, **en la única rama
que ninguna corrida normal recorre** —la que se dispara cuando una pérdida declarada deja de
ocurrir—, y sólo lo podía encontrar ejecutarla. Con `${SISTEMA}` la mutación muerde.

### Y las mutaciones que corren en cada PR, sin motor

`infra/verificaciones/restauracion-logica.test.ts`, **26 pruebas** que **ejecutan**
`lib-restauracion-logica.sh` en un bash de verdad (el reparto de #731 con `puerto.sh`). Las
que más dicen:

- **el veredicto no es el código de salida**: `(18 errores, código 0)` no es limpia,
  `(16, 1)` tampoco, `(0, 1)` tampoco — **y el contraste**, `(0, 0)` sí, porque una función
  que dijera que no a todo pasaría las tres primeras;
- **el orden de las migraciones es por versión y no por texto**: `V2` antes que `V10`, sobre
  un directorio fabricado, y también sobre los cinco esquemas de verdad. Con el orden de
  texto `rentas` muere en «relation "pago_recibido" does not exist» — se descubrió
  ejecutándolo, y el síntoma no se parece a su causa;
- **un directorio sin migraciones no pasa en verde**, al revés que con las extensiones: cero
  significa que la ruta está mal, y devolver nada dejaría al simulacro volcando una base
  vacía;
- **un sistema cuyo clon no está no pasa en verde**: el error nombra el `git clone`;
- **la versión admitida es la misma que declaran los cuatro `MotorPostgres`**, leída de sus
  archivos, no escrita aquí;
- **cada binario que no es del major del motor se nombra por separado**, no «alguno»;
- y las tablas afectadas por una pérdida **se derivan** de la lista: cambiar la lista cambia
  lo derivado, que es lo que prueba que deriva.

---

## 6. La verdad sobre `sgtm`, sin bloquear a los demás

**Sigue roto, y no se puede arreglar.** `V11` es una migración **aplicada** del archivo
histórico: editarla cambia su suma de Flyway, y el monolito no admite migraciones nuevas
(C-4 §8, hueco 1). Los cuatro sistemas del corte lo cerraron con una migración nueva cada
uno; el monolito no tiene esa salida.

Lo que C-11 añade es **cuánto**, medido con las 68 migraciones aplicadas: **21 errores**, y
trece objetos que no llegan a la base restaurada.

```
INDICE contribuyente_nombre_trgm_ix EN contribuyente
INDICE via_codigo_prefijo_ix EN via
INDICE via_codigo_uq EN via
INDICE via_nombre_busqueda_ix EN via
INDICE via_pk EN via
POLITICA_RLS via.via_tenant
RESTRICCION arancel.arancel_via_fk
RESTRICCION predio.predio_via_fk
RESTRICCION via.via_codigo_uq
RESTRICCION via.via_municipalidad_id_fkey
RESTRICCION via.via_pk
SECUENCIA via_id_seq
TABLA via
```

Los errores, agrupados: **14** «relation "public.via" does not exist», **2** «text search
dictionary "unaccent" does not exist» —la que mata la tabla `via` y la que mata el índice de
trigramas—, **2** de `via_id_seq`, **2** de índices de `via` que ya no tienen tabla y **1** del
`COMMENT` del índice de trigramas. Veintiuno.

**Y hay que decir lo que eso significa fuera de este documento**: una restauración lógica del
monolito hoy deja `via` fuera, y con ella el **catálogo vial** del que cuelgan `predio` y
`arancel` por clave foránea. No es un índice de más: es una tabla del padrón. El camino
físico de `INF-08` no está afectado —copia bloques—, así que la recuperación ante desastre
sigue en pie; lo que no se puede hacer con el monolito es una migración o una copia lógica sin
reconstruir esos trece objetos a mano.

### Cómo se dice sin bloquear

`rl_perdidas_conocidas` declara las trece, y el simulacro las descuenta. La lista vale en
**las dos direcciones**, como `DECLARADAS_DE_MAS` en C-10: se pone rojo si un esquema pierde
algo que no está declarado (§5.C) **y también** si algo declarado deja de perderse (§5.D).
Así no puede quedarse rancia.

Y el recuento de errores **sólo es criterio en un esquema que no declara pérdidas**. Donde las
declara, los errores **son** esas pérdidas, y el veredicto lo dan el censo y las filas, que
además dicen cuáles. Sin esa distinción `sgtm` sería rojo para siempre y bloquearía a los
otros cuatro, que es lo que el encargo prohibía.

---

## 7. Las cifras

| Repositorio | Antes | Después | Qué se añadió |
|---|---:|---:|---|
| `infrastructure` | 435 | **461** | +26: `restauracion-logica.test.ts` |
| `rentas` | 3 133 | **3 133** | **sin tocar** |
| `catastro` | 991 | **991** | **sin tocar** |
| `normativa` | 617 | **617** | **sin tocar** |
| `caja` | 687 | **687** | **sin tocar** |
| `sgtm` | — | — | **sin tocar** |

`yarn verificar` de `infrastructure` en verde: lint, `tsc --noEmit` en los dos `tsconfig` y
**461 pruebas en 23 archivos**. Los cuatro verificadores bloqueantes de los backends no se
corren porque **no se tocó ningún backend**: los archivos de `rentas` y `catastro` que las
mutaciones apartaron se restauraron por copia y se comprobaron con `cmp`, y `git status` de
los cinco clones queda como estaba.

Las bases de laboratorio `c11_*` se borraron al terminar —el guion las borra solo, salvo con
`--conservar`— y **no se tocó ninguna clave de rol del clúster**: `crear-roles.sql` es
idempotente y este guion, a diferencia de `Preparar.java`, no hace ningún `ALTER ROLE …
PASSWORD`.

---

## 8. Huecos declarados

1. **El simulacro no corre en CI, y ésa es la mitad que falta.** «Una verificación escrita que
   nunca se ejecuta no protege nada» es la lección de #188 con `verificar-cuadros.mjs` y de
   #435 con `verificar-rotacion.sh`, y aquí se repite a medias: las 26 pruebas de
   `lib-restauracion-logica.sh` **sí** corren en cada PR **de este repositorio** —con el mismo
   hueco que C-2 §6 y C-10 §6 dejaron abierto: un PR de `catastro` que devuelva el defecto de
   C-4 no dispara este flujo—, pero el simulacro entero se corre a mano. Meterlo exige tocar `.github/workflows/infra.yml`, que esta sesión no empuja (mismo
   límite que C-4 §8 hueco 4 y que #711). **El trabajo está casi escrito ya en ese archivo**:
   haría falta un job que copie los cinco `actions/checkout` del job `verificar` —los cuatro
   clones hermanos más `sgtm`—, el paso `PostGIS en el motor local del runner` del job
   `simulacro` (con su `apt-get update -qq` de #676), arrancar el PostgreSQL 16 nativo del
   runner, correr el simulacro, y a continuación **la mutación A** exigiendo que se ponga
   rojo, igual que el job `simulacro` hace con `recovery_target_time`. No se escribió porque
   no se puede ejecutar desde aquí, y escribir un job de CI sin correrlo es afirmar sin medir.

2. **El retrato exhaustivo no cubre las cuatro tablas afectadas por una pérdida declarada.**
   En `sgtm` son `via`, `arancel`, `predio` y `contribuyente`: su diferencia está explicada
   por el censo, y dejarlas dentro haría que el retrato fuera rojo por construcción. La
   consecuencia es concreta: un defecto **nuevo** en la profundidad de esas cuatro —una
   columna con otro `DEFAULT`, un privilegio de columna perdido, un comentario— lo vería el
   censo sólo si cambia de nombre, y si no, no lo vería nadie. Los otros cuatro esquemas no
   excluyen ninguna tabla.

3. **El volumen de datos es de juguete** (§4). Lo que se ejercita es el camino, no el
   comportamiento con un padrón real.

4. **El censo excluye los objetos que pertenecen a una extensión.** PostGIS aporta cientos de
   funciones y salen iguales a los dos lados por construcción, así que compararlas sería ruido;
   lo que se cuenta es la extensión. Si un día `CREATE EXTENSION` restaurara una versión
   distinta de la extensión, esto no lo vería — lo vería el retrato sólo para las tablas.

5. **No se comprueba que el volcado se pueda restaurar en OTRO clúster.** Origen y destino
   viven en el mismo motor, así que los roles ya existen. Un destino limpio de verdad
   necesitaría `crear-roles.sql` allí primero, y eso es una decisión de procedimiento —qué
   parte del volcado es del clúster y qué parte de la base— que este trabajo no toma. Lo que
   sí queda medido es que la base destino no necesita nada más: se crea con `template0`, sin
   extensiones y sin esquema.

6. **`catastro` tenía, al empezar esta sesión, `docs/50-api/eventos/lote-de-eventos.json`
   modificado en el árbol de trabajo** —dos marcas de tiempo `emitidoEn`, artefacto de una
   corrida de sus pruebas ajena a este trabajo—. No se tocó ni se revirtió: no es de C-11, y
   deshacer trabajo en curso de otro sería peor que dejarlo dicho.

---

## 9. Lo que se decidió no hacer

- **No se reutilizó `Preparar.java` para provisionar**, aunque sea lo que hay: haría
  `ALTER ROLE … PASSWORD` sobre el clúster y crearía extensiones a mano (§0.3). Lo que sí se
  reutiliza es el comparador, que sólo lee.
- **No se escribió un comparador nuevo.** `Retrato.java` y `canonizar.py` ya existen y ya
  saben hacer esto; una tercera copia es lo que C-3 §7 hueco 2 dejó dicho que no se hiciera.
- **No se tocó ningún baseline ni ninguna migración.** Las dos mutaciones que apartan `V4` y
  `V11` se revirtieron por copia comprobada con `cmp`.
- **No se corrigió la tabla de C-4** con las cifras nuevas de `sgtm`. C-4 está cerrado y su
  tabla es el registro de lo que midió; lo que C-11 mide queda aquí, en §0 y en §6, y en el
  javadoc de `rl_perdidas_conocidas`, que es donde alguien lo va a leer al tocar la lista.
- **No se dio puerta de escape a la guarda de versión.** Medir otra versión de PostgreSQL se
  hace apuntando el guion a otro motor y viendo cómo se niega, que es la misma decisión que
  C-4 §3.3 tomó para su guarda.
