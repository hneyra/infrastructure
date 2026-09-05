# C-10 + C-13 — Las extensiones: quién las crea y quién las declara

> **Estado: cerrado.** Las extensiones se nombran ahora en **un solo sitio por sistema** —su
> `crear-roles.sql`— y los otros dos sitios **derivan**. Las cinco declaraciones de más que C-2
> dejó como censo **se retiraron**, con el diff de esquema medido. Y «la caja corre en el motor
> más simple que exista» pasó de frase a comprobación: la base de `caja` nace con **cero
> extensiones**, ejecutado contra PostgreSQL 16.15 real.
>
> Cifras: **infrastructure 418 → 435** (+17). **caja 684 → 687** (+3). **catastro 991 · normativa
> 617**, ninguna baja. `rentas` no se toca: **3 133**.

---

## 0. Lo que la medición corrigió antes de tocar código

Dos cosas, y las dos cambian el trabajo:

1. **`05-crear-bases.sh` no se puede «atar a los cuatro archivos» leyéndolos desde el
   repositorio.** Corre **dentro del contenedor**, en `docker-entrypoint-initdb.d`, y ahí no hay
   ningún clon hermano: sólo está lo que el compose monte. Así que atarlo no es un cambio de
   guion sino un cambio de guion **y de compose**, y trae un modo de fallo nuevo que hay que
   cerrar en el mismo movimiento: **Docker crea un directorio vacío cuando el origen de un bind
   mount no existe**, de modo que un clon que falte no da error — da una base sin su extensión,
   que es exactamente el incidente de #742 con otro disfraz.

2. **La razón por la que C-2 no convirtió «declarada de más» en un rojo se acabó al retirarlas.**
   C-2 lo dejó como censo porque «un rojo nacería disparado en dos de los seis esquemas» (#437).
   Retiradas las cinco, el rojo **nace en verde**, así que C-13 no sólo poda: cierra la mitad que
   C-2 dejó abierta y `DECLARADAS_DE_MAS` pasa de censo a lista de excepciones **vacía**.

Y una tercera, que no cambia el trabajo pero sí lo que se puede prometer: **la imagen del motor
sigue siendo `postgis/postgis`, y tiene que seguir siéndolo.** El motor es **uno** para los cuatro
sistemas, así que basta con que `catastro` necesite PostGIS desde `V61` para que la imagen del
clúster tenga que traerlo. Lo que C-10 cambia no es la imagen sino **qué base recibe la
extensión**. Está en §6.

---

## 1. Dónde se nombran ahora las extensiones

**En un solo sitio por sistema**, y los otros dos derivan de él:

| Sitio | Antes de C-10 | Ahora |
|---|---|---|
| `<sistema>/…/db/roles/crear-roles.sql` | lo decide | **lo decide** (único) |
| `despliegue/inicializacion-del-motor/05-crear-bases.sh` | las cuatro escritas a mano, creadas en las cuatro bases | **deriva** de los `crear-roles.sql` que el compose le monta |
| `despliegue/crear-extensiones.sh` | derivaba, pero de **un** archivo con la ruta del monolito escrita a mano, contra **una** base (`sgtm`) | **deriva**, con `--sistema`, buscando el archivo y usando la base de ese sistema |
| `infra/verificaciones/extensiones-de-las-migraciones.ts` | ya derivaba | igual, y ahora **comprueba que el shell lee lo mismo** |

Lo que hizo falta para que los dos guiones derivaran de verdad:

### 1.1 Una sola implementación del «qué cuenta como declarada»

`despliegue/inicializacion-del-motor/lib-extensiones.sh`, con una función
`extensiones_declaradas <archivo>`, **sourced por los dos guiones**.

Dos copias del mismo `grep` habrían sido dos sitios donde una extensión se puede dejar de ver —el
defecto, un escalón más abajo—, y el javadoc de la guarda ya avisaba de eso: «el patrón es el de
`crear-extensiones.sh`, a propósito: si los dos se separan, uno de los dos deja de ver una
extensión».

La función **quita los comentarios antes de mirar**, como hace `sinComentarios` en la guarda. No
es cosmético: el `crear-roles.sql` de `caja` nombra las cuatro extensiones en cuarenta líneas de
cabecera **para explicar por qué no declara ninguna**. Hoy ninguno de los seis archivos escribe
`CREATE EXTENSION` dentro de un comentario, así que quitar ese `sed` no cambiaría nada medido
contra ellos — y **por eso la prueba que lo mide usa un archivo fabricado con la trampa dentro**,
no los reales.

Y lleva un `|| true` que **no es prudencia**: `grep` sale con código 1 cuando no encuentra nada, y
con `set -euo pipefail` eso mataría a `05-crear-bases.sh` justo en el único sistema cuya decisión
es no declarar ninguna. **Cero es una respuesta legítima**, en los dos guiones.

### 1.2 El compose monta lo que el guion tiene que leer

```yaml
- ./inicializacion-del-motor/lib-extensiones.sh:/etc/kamayuk/lib-extensiones.sh:ro
- ../../rentas/…/db/roles/crear-roles.sql:/etc/kamayuk/roles/rentas.sql:ro
- ../../catastro/…/db/roles/crear-roles.sql:/etc/kamayuk/roles/catastro.sql:ro
- ../../normativa/…/db/roles/crear-roles.sql:/etc/kamayuk/roles/normativa.sql:ro
- ../../caja/…/db/roles/crear-roles.sql:/etc/kamayuk/roles/caja.sql:ro
```

Tres decisiones, con su motivo:

- **Fuera de `docker-entrypoint-initdb.d`.** Todo `.sql` que caiga ahí lo **ejecuta** el
  entrypoint contra la base por omisión; estos hay que **leerlos**. Ejecutar los cuatro
  `crear-roles.sql` contra `postgres` crearía ahí las extensiones de todos y ninguna donde toca,
  que es justo al revés de lo que C-10 hace. Lo fija una prueba.
- **La lista de bases sale de los nombres de estos archivos**, no de una variable del guion. Así
  `BASES="rentas catastro normativa caja"` desaparece: añadir un sistema es añadir su montaje.
- **Un montaje que falta se para y lo nombra.** `[ -f ]` **antes** que `[ -s ]`, porque un
  directorio tiene tamaño mayor que cero y `-s` daría por bueno exactamente el caso que esto
  vigila. El mensaje dice el `git clone` que falta, como hace `clonDe()`.

### 1.3 `crear-extensiones.sh`, el tercer sitio: **sí se pudo atar**

C-2 lo dejó fuera diciendo que «extenderlo a cuatro bases exige decidir namespace y base por
sistema, que es despliegue y no verificación». Medido, no hay tal decisión que tomar:

- **la base es el nombre del sistema en los cinco.** `05-crear-bases.sh` crea `rentas`,
  `catastro`, `normativa` y `caja` con ese nombre, y la del monolito se llama `sgtm`. No hace
  falta tabla.
- **el namespace ya venía por `--namespace`**, con su omisión `sgtm-<ambiente>`. No cambia.
- **el archivo de roles se busca, no se escribe.** Para `sgtm`, la copia de este repositorio —que
  es la que de verdad se aplica: el `ConfigMap` y el compose montan ésa, no la del clon—. Para los
  otros cuatro, el clon hermano con un comodín sobre el nombre del módulo
  (`../<sistema>/backend/*/src/main/resources/db/roles/crear-roles.sql`); cero o más de uno **se
  dice** en vez de elegir.

`--sistema` por omisión es `sgtm`, así que **sin argumento el guion hace exactamente lo que hacía
antes de C-10**, que es lo único que hoy se despliega. Y `--listar` dice qué crearía **sin
kubectl**, que es lo que permite que una prueba lo **ejecute** en vez de leerlo (#731 con
`puerto.sh`).

Un cambio más, que era un defecto latente: cero extensiones **salía con código 1** («crear-roles.sql
no declara ninguna extensión») y ahora sale en verde. Con `caja` y `normativa` a cero, ese `exit 1`
convertía la decisión correcta en un despliegue rojo.

---

## 2. La mutación que lo demuestra

Ejecutada contra **PostgreSQL 16.15 real** (127.0.0.1:55444), con bases de usar y tirar. Cada
mutación se aplicó **sola** y se restauró **por copia comparada con `cmp`**.

### 2.1 El contraste primero: qué hacía el guion de antes

`git show HEAD:…/05-crear-bases.sh`, ejecutado, sobre las cuatro bases recién creadas:

```
  antes-de-C-10  rentas     btree_gist pg_trgm postgis unaccent
  antes-de-C-10  catastro   btree_gist pg_trgm postgis unaccent
  antes-de-C-10  normativa  btree_gist pg_trgm postgis unaccent
  antes-de-C-10  caja       btree_gist pg_trgm postgis unaccent
```

Las cuatro en las cuatro, `caja` incluida. **Ésa es la frase de P5D incumplida, medida.**

El mismo experimento con el guion de ahora:

```
  despues        rentas     pg_trgm unaccent
  despues        catastro   btree_gist postgis unaccent
  despues        normativa  (NINGUNA)
  despues        caja       (NINGUNA)
```

### 2.2 Cambia lo declarado, cambia lo que el guion crea

| # | Mutación | Resultado |
|---|---|---|
| 1 | `caja` **declara** `btree_gist` (lo contrario de su decisión de P5D) | `caja` pasa de `(NINGUNA)` a `btree_gist` — y **`catastro` no se mueve** |
| 2 | `catastro` deja de declarar `postgis` | `catastro` pasa de `btree_gist postgis unaccent` a `btree_gist unaccent` — y **`caja` sigue en `(NINGUNA)`** |
| — | restaurados los dos por copia, comprobado con `cmp` | las dos bases vuelven exactamente a lo de la primera corrida |

Que **el vecino no se mueva** es la mitad que importa: con el guion de antes, mutar el archivo de
un sistema no cambiaba nada en ninguna base, porque la lista no salía de ahí.

### 2.3 Y las mutaciones que viven en `yarn verificar`

Las de arriba se corren a mano contra un motor. Las permanentes, que corren en cada PR sin motor y
sin clúster, están en `extensiones-de-las-migraciones.test.ts` (17 pruebas nuevas) y **ejecutan los
guiones**:

- las dos lecturas —la de shell y la de TypeScript— se comparan sobre los **seis** esquemas
  reales;
- el shell tampoco cuenta la extensión que sólo se nombra en un comentario (archivo fabricado);
- `crear-extensiones.sh --listar` dice, en los cinco, exactamente lo que ese sistema declara, y la
  base que nombra es la suya;
- un sistema cuyo clon no está **no pasa en verde**: `git clone https://github.com/hneyra/…`;
- `05-crear-bases.sh` se ejecuta con un `psql` de mentira que anota en vez de conectarse, y se
  comprueba que crea una base por archivo montado y sólo las extensiones de ese archivo;
- **un montaje que falta pone la prueba roja** nombrando el clon: se reproduce el directorio vacío
  que Docker deja;
- y el contraste: `catastro` **sí** recibe PostGIS, porque la usa.

Y en el compose: que estén los cuatro montajes derivados de `SISTEMAS` —la **cuarta** lista
escrita a mano, que también se fue—, que cada uno apunte al clon de **su** sistema (un montaje
cruzado daría una base de la caja con PostGIS y ni un error), y que ninguno caiga en
`docker-entrypoint-initdb.d`.

---

## 3. C-13 — las declaradas de más: **retiradas**

| Repositorio | Retirada | Queda |
|---|---|---|
| `catastro` | `pg_trgm` | `unaccent`, `postgis`, `btree_gist` |
| `normativa` | `pg_trgm`, `unaccent`, `postgis`, `btree_gist` | **ninguna** |

### 3.1 Por qué el dueño del esquema puede decidirlo con lo que hay medido

C-2 no las retiró por dos motivos. El primero —«un rojo nacería disparado»— era un argumento
contra hacerlo **rojo**, no contra retirarlas. El segundo —«retirar cambia cómo se provisiona esa
base en todos los ambientes, y es decisión del dueño»— se contesta midiendo:

1. **El esquema resultante es el mismo.** Aplicados los dos `crear-roles.sql` —el de antes y el de
   después— y encima **todas** las migraciones, contra PostgreSQL 16.15, el `pg_dump
   --schema-only` difiere en **exactamente las líneas de las extensiones retiradas** y en nada
   más:

   ```
   --- DIFF de esquema «normativa» (antes de C-13  vs  después) ---
   12,19d11
   < CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;
   < COMMENT ON EXTENSION btree_gist IS 'support for indexing common datatypes in GiST';
   < CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
   < COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';
   < CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
   < COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';
   < CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
   < COMMENT ON EXTENSION unaccent IS 'text search dictionary that removes accents';

   --- DIFF de esquema «catastro» (antes de C-13  vs  después) ---
   14,15d13
   < CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
   < COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';
   ```

   Ni una tabla, ni un índice, ni una restricción, ni una política, ni un `GRANT`. Y **el baseline
   de `normativa` aplica entero sobre una base con cero extensiones.**

2. **Retirar no es destructivo.** No hay ningún `DROP EXTENSION` en ninguno de los cinco archivos,
   así que una base ya provisionada conserva lo que tenga. Lo que cambia es que una base **nueva**
   no lo recibe.

3. **La decisión es reversible y está vigilada en las dos direcciones.** El día que una migración
   de `catastro` llame a `similarity()` o indexe con `gin_trgm_ops`, la guarda se pone roja
   **nombrando la migración y la extensión**, antes de que llegue a ningún motor. Retirar una
   declaración no puede producir el fallo silencioso de #742: ése es precisamente el que la guarda
   caza.

4. **El precedente lo pusieron los propios dueños, dos veces.** P5D dejó `caja` sin ninguna y P5E
   dejó `rentas` con dos. C-13 aplica esa misma decisión a los dos esquemas donde la poda
   simplemente no se había hecho — no es una política nueva.

5. **Y C-10 cambia lo que cuesta no decidirlo.** Hasta C-10 el guion creaba las cuatro en las
   cuatro bases con la lista escrita a mano, así que sobrar era **inerte** en el entorno local.
   Desde C-10 **lo declarado es lo que actúa**: dejar `postgis` en `normativa` sería crearla de
   verdad en una base que no dibuja nada.

### 3.2 La exención de `spatial_ref_sys`, retirada

Con `postgis` fuera de `normativa`, sus bases de prueba dejan de tener `spatial_ref_sys`, así que
la exención de su `AislamientoMultiTenantTest` deja de eximir nada. Se retira, con la misma razón
escrita que en P5E: «una exención que ya no exime nada se queda dentro para siempre y la lista deja
de decir lo que exime». `TABLAS_EXENTAS` de `normativa` queda en **una** entrada,
`flyway_schema_history`.

Sus 617 pruebas siguen en verde, `verificarAislamiento` incluido — y eso ya es la mitad de la
medición, porque esa prueba **exige que toda tabla esté clasificada**: si `spatial_ref_sys`
siguiera ahí, quitarle la exención la pondría roja.

La otra mitad es la mutación, con la exención ya retirada y devolviéndole `postgis` al
`crear-roles.sql`:

```
ARQ-03 — Aislamiento multi-tenant > a) Cobertura estructural
    > toda tabla no exenta tiene RLS activa y forzada FAILED
    [spatial_ref_sys tiene ENABLE ROW LEVEL SECURITY]
    [spatial_ref_sys tiene FORCE ROW LEVEL SECURITY (sin esto, el propietario evade la politica)]
    > toda tabla esta clasificada como de tenant, de catalogo o exenta FAILED
      ["spatial_ref_sys"]
19 tests completed, 2 failed
```

Restaurado por copia y comprobado con `cmp`, verde otra vez. Las dos direcciones del acoplamiento
quedan medidas: **la declaración de más no se queda quieta, se propaga a la lista de excepciones de
la barrera número uno** — que era el argumento de C-2 §1.4, ahora con su rojo.

### 3.3 El censo pasa a rojo, y la lista se queda vacía

`DECLARADAS_DE_MAS` queda **vacía** y `declaradasSinUsar()` pasa a ser un rojo. La lista no se
borra: lo que permite es una excepción **temporal y nombrada**, y con la lista vacía la única forma
de callar una declaración de más es escribir ahí su motivo, y eso se ve en el diff — la misma
decisión que #429 tomó con su lista de pendientes al quedarse vacía.

Y el rojo se demuestra que muerde, sobre un esquema **fabricado** (para no escribir en ningún
clon): un `crear-roles.sql` con `postgis` y una migración que no la usa sale nombrado; la misma
migración con un `geography(MultiPolygon, 4326)` dentro, no.

---

## 4. Que la decisión de `caja` se pueda ejercitar

`caja/…/esquema/BaseSinExtensionesTest.java`, tres pruebas, contra PostgreSQL real:

1. tras `provisionar()` —`crear-roles.sql` **y** todas las migraciones—, `pg_extension` no tiene
   nada aparte de `plpgsql`;
2. **el contraste**: y el esquema está de verdad ahí —migraciones aplicadas y más de diez
   tablas—, porque «cero extensiones» es igual de cierto en una base vacía, y entonces la primera
   prueba no mediría nada;
3. y `crear-roles.sql` sigue sin declarar ninguna, quitando los comentarios antes de mirar — la
   otra dirección, para que un `CREATE EXTENSION` devuelto al archivo diga **dónde** está la
   causa en vez de poner rojas las dos de arriba.

**Por qué vive en `caja` y no aquí**: lo que hay que sujetar no es que un guion no las cree —eso lo
mide C-10 ejecutando el guion—, sino que **este esquema no las necesita**. Eso sólo lo puede decir
quien aplica este esquema, y sólo aplicándolo.

**Por qué basta con esto**: `MotorPostgres.sentenciaDeCreacion` crea la base con `TEMPLATE
template0` (#706), que por definición no trae ninguna extensión. Así que la base de cada corrida ya
era «el motor más simple»; lo único que faltaba era **afirmarlo**, porque nada distinguía «no
necesita ninguna» de «ya se las había creado alguien».

Y ejecutado a mano, con el guion de verdad:

```
creando la base «caja»
CREATE DATABASE
  «caja» no declara ninguna extension
…
caja       (NINGUNA)
```

---

## 5. Las cifras

| Repositorio | Antes | Después | Qué cambió |
|---|---:|---:|---|
| `infrastructure` | 418 | **435** | +17: la guarda de extensiones pasa de 22 a 37 y el compose de 14 a 16 |
| `caja` | 684 | **687** | +3: `BaseSinExtensionesTest` |
| `catastro` | 991 | **991** | sólo `crear-roles.sql` |
| `normativa` | 617 | **617** | `crear-roles.sql`, la exención y un comentario rancio |
| `rentas` | 3 133 | **3 133** | **sin tocar** |
| `sgtm` | — | — | **sin tocar** |

`yarn verificar` de `infrastructure` en verde. `build`, `verificarArquitectura`,
`verificarAislamiento` y `verificarArranque` en verde en `caja`, `catastro` y `normativa`, contra
**PostgreSQL 16.15 real** y no por Testcontainers —el demonio de Docker de esta máquina es un túnel
a un VPS y el puerto publicado del contenedor se queda allí—, con el repliegue
`-Dkamayuk.pruebas.postgres.url=jdbc:postgresql://127.0.0.1:55444/postgres`.

---

## 6. Huecos declarados

1. **La imagen del motor sigue siendo `postgis/postgis`, y no es un olvido.** El clúster es **uno**
   para los cuatro sistemas, así que basta con que `catastro` la necesite desde `V61` para que la
   imagen tenga que traerla. Lo que C-10 y C-13 cambian es **qué base recibe la extensión**, no qué
   imagen la puede dar. Bajar el `IMAGEN_POR_OMISION` de `MotorPostgres` en `normativa` o en `caja`
   —que ya no necesitan ninguna— **no se hizo**, por el mismo motivo que P5E declinó hacerlo en
   `rentas`: es el único camino que esta máquina no puede ejercitar (Testcontainers no funciona
   aquí, y con el repliegue la imagen no se usa nunca), y no se toca lo que no se puede medir.
   Además `VersionDelMotorTest` fija a propósito que los cinco sitios digan lo mismo, así que
   cambiarlo en un módulo suelto sería separarlo del clúster que de verdad se despliega.

2. **La guarda sigue disparándose sólo en los PR de `infrastructure`.** Sin cambio respecto a C-2
   §6 hueco 1: el filtro `paths` de `infra.yml` sólo nombra rutas de este repositorio, así que un
   PR de `catastro` que devuelva un `CREATE EXTENSION pg_trgm` no ejecuta esta guarda — lo hará el
   siguiente PR que toque `infra/`. Se cierra con `repository_dispatch` y **no está hecho**.

3. **`05-crear-bases.sh` ejecutado de verdad se midió FUERA del contenedor.** El demonio de Docker
   de esta máquina es un túnel a un VPS y no puede montar rutas locales, así que el compose entero
   no se pudo levantar: lo medido es el guion corriendo con `SGTM_DIR_KAMAYUK` apuntando a un
   directorio con los cuatro `crear-roles.sql` reales enlazados, contra PostgreSQL 16.15. Lo que
   **no** está ejercitado es que Docker monte esos cuatro archivos donde el compose dice; lo cubre
   una prueba que lee el compose, que es texto y no ejecución.

4. **En el compose de la plataforma, `10-crear-roles.sql` sigue siendo sólo el del monolito**, y
   corre contra la base `postgres`. O sea que las cuatro bases del producto reciben sus extensiones
   —desde C-10, las suyas— y **no** los `GRANT` sobre `public` que su propio `crear-roles.sql`
   declara. Es anterior a C-10 y no lo toca: ejecutar los cuatro archivos, cada uno contra su base,
   es otro trabajo, y cambia quién es dueño de qué en el entorno local.

5. **`caja` sigue sin prueba de contrato del lado del proveedor**, sin cambio respecto a C-2 §6
   hueco 5.

6. **La guarda mide texto, no un motor** (C-2 §6 hueco 4, intacto). Una extensión declarada y **no
   disponible en la imagen** sigue rompiendo el despliegue y esto no lo ve: quien lo caza es
   `crear-extensiones.sh --comprobar`, o el arranque.

---

## 7. Lo que se decidió **no** hacer

- **No se tocó `sgtm`.** Sigue declarando las cuatro, y las cuatro las usa: es el monolito con los
  doce contextos dentro.
- **No se tocó `rentas`.** P5E ya lo podó a dos, y las dos las usa.
- **No se cambió la imagen del motor de ningún módulo** (§6, hueco 1).
- **No se escribió una segunda lista de sistemas en ninguna parte.** Al contrario: se fue la que
  quedaba, la de `plataforma-compose.test.ts`, que ahora deriva de `SISTEMAS`.
- **No se borró `DECLARADAS_DE_MAS`.** Vacía dice más que ausente: es dónde tendría que escribirse
  una excepción, y que esté vacía es lo que hace que no haya dónde esconder una.
