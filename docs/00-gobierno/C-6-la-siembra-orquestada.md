# C-6 — La siembra de la demostración, que ya no orquestaba nadie

**Fecha:** 2026-09-05. **Repositorios tocados:** `infrastructure` (la orquestación y sus guardas),
`rentas`, `catastro` y `caja` (los guiones y los CSV, cada uno al suyo).
**`sgtm` no se tocó:** su `git status` queda limpio.

P5C dejó el hueco 8 —«la secuencia de siembra ya no la orquesta nadie; sembrar `catastro` sin haber
sembrado antes el padrón **no revienta: rechaza todas las fichas y termina en verde**»— y P5D el
hueco 11 —«`infra/carga-de-datos/` quedó a medio mover»—. Esta corrección los cierra, y **al
ejecutarla encontró que el problema era bastante más grande que su enunciado**.

---

## 1. Los cinco criterios, con su medida

| # | Criterio | Estado | Dónde |
|---|---|---|---|
| **1** | Sembrar de cero los cuatro sistemas y que el recuento cuadre, ejecutado de verdad | **Cumplido a medias, y dicho** | **Seis de los diez pasos** se sembraron de verdad contra PostgreSQL 16.15 y cuadran al último registro. Los otros cuatro **no pueden completarse hoy**, y no por la siembra: por tres defectos del corte que este trabajo destapó ejecutando. §4 y §6 |
| **2** | La mutación que demuestra que el silencio se acabó, con las dos salidas | **Cumplido** | §5. La misma corrida pasa de `exit 0` con «0 nuevas, 15 rechazadas» a `exit 1` con «FALTAN 15 (el paso 3 necesita antes el paso 2)». Y el contraste que la hace honesta: repetir un paso —que produce **la misma línea**— sigue en verde |
| **3** | El censo publicado | **Cumplido** | §2 |
| **4** | Las cifras no bajan | **Cumplido** | `rentas` 3 121 → **3 121** · `catastro` 974 → **974** · `caja` 673 → **673** · `normativa` 606 (no se tocó) · `infrastructure` 389 → **400**. §7 |
| **5** | Los tres verificadores bloqueantes en verde en los repositorios tocados | **Cumplido** | §7 |

---

## 2. El censo, medido

### 2.1 Dónde vivía cada cosa antes de C-6

| Paso | Qué siembra | El **proceso** (`@ConditionalOnProperty`) vivía en | El **guion** vivía en | El **CSV** vivía en |
|---|---|---|---|---|
| 1 | catálogo vial | `catastro` | `infrastructure` **y** `catastro` | `infrastructure`, `rentas` **y** `catastro` |
| 2 | sectores | `catastro` | `infrastructure` **y** `catastro` | `infrastructure`, `rentas` **y** `catastro` |
| 3 | manzanas | `catastro` | `infrastructure` **y** `catastro` | `infrastructure`, `rentas` **y** `catastro` |
| 4 | cajas y áreas | `caja` | **`infrastructure` sólo** | `infrastructure`, `rentas` **y** `caja` |
| 5 | contribuyentes | `rentas` | **`infrastructure` sólo** | `infrastructure` **y** `rentas` |
| 6 | predios y fichas | `catastro` | `infrastructure` **y** `catastro` | `infrastructure`, `rentas` **y** `catastro` |
| 7 | detalle de fichas | `catastro` | `infrastructure` **y** `catastro` | `infrastructure`, `rentas` **y** `catastro` |
| 8 | padrón vehicular | `rentas` | **`infrastructure` sólo** | `infrastructure` **y** `rentas` |
| 9 | transferencias | **`rentas`** | `infrastructure` **y `catastro`** ← | `infrastructure`, `rentas` **y** `catastro` |
| 10 | deuda | `rentas` | **`infrastructure` sólo** | `infrastructure` **y** `rentas` |

**ADR-0031 dice que «los guiones ya están agrupados por sistema sin que nadie lo planeara». Medido,
no era cierto.** Lo que había era: los diez guiones en `infrastructure` (donde no está ninguno de los
diez procesos), siete de ellos **duplicados** en `catastro`, ninguno en `rentas` ni en `caja`, y
hasta **tres copias byte a byte** de cada CSV. Las copias eran idénticas el 2026-09-05 —comprobado
con `cmp`— y nada impedía que dejaran de serlo: la copia que alguien edita no tiene por qué ser la
que el cargador lee.

**Y la fila 9 es un defecto, no una asimetría.** `catastro/infra/carga-de-datos/cargar-transferencias-demo.sh`
lanzaba un Job con la **imagen de `catastro`** y la variable `SGTM_CARGATRANSFERENCIASDEMO_ARCHIVO`,
y ese cargador vive en `rentas`. Medido:

```
$ SGTM_CARGATRANSFERENCIASDEMO_ARCHIVO=…/transferencias.csv  <aplicacion de catastro, perfil batch>
… Started SgtmAplicacion in 1.021 seconds
$ echo $?
0
```

Cero líneas de carga. Ni un aviso, ni una fila rechazada, ni nada. **Un paso que no hace
absolutamente nada y dice que fue bien** — que es el mismo modo de fallo del hueco 8, un escalón más
silencioso todavía.

### 2.2 Dónde vive cada cosa después

| Repositorio | Guiones de siembra | CSV |
|---|---|---|
| `catastro` | `cargar-catalogo-vial.sh`, `cargar-sectores.sh`, `cargar-manzanas.sh`, `cargar-fichas-demo.sh`, `cargar-detalle-fichas-demo.sh` (+ `cargar-predios.sh` y `cargar-arancel-vial.sh`, que no siembran demostración) | `vias`, `sectores`, `manzanas`, `fichas`, `detalle-de-fichas` |
| `rentas` | `cargar-contribuyentes-demo.sh`, `cargar-vehiculos-demo.sh`, `cargar-transferencias-demo.sh`, `cargar-deuda-demo.sh` | `contribuyentes`, `vehiculos`, `transferencias`, `deuda` |
| `caja` | `cargar-cajas.sh` | `cajas` |
| `infrastructure` | **ninguno.** El orden (`siembra/pasos.tsv`), el guion que lo recorre y la comprobación que lo mide | ninguno |

Cada guion está en el repositorio de su proceso y cada CSV en un solo sitio. Lo comprueban dos
guardas nuevas, y las dos muerden (§5.3).

---

## 3. Dónde va la orquestación, y por qué

**En `infrastructure`, y sólo el orden.** No los cargadores, que se van a sus sistemas.

Tres razones, en este orden:

1. **El orden es un hecho *entre* sistemas.** El paso 6 (`catastro`) necesita el 5 (`rentas`); el 9
   y el 10 (`rentas`) necesitan el 6 (`catastro`). Escrito dentro de cualquiera de los tres, su
   dueño no puede ver a los otros dos — que es exactamente el defecto que [C-2](C-2-guarda-de-extensiones.md)
   cerró para las extensiones, donde la guarda de #742 tenía la ruta del monolito escrita a mano y
   no miraba ninguno de los cuatro repositorios nuevos.
2. **`infrastructure` es donde viven las barreras que verifican a los cuatro sistemas** (ADR-0031),
   y `yarn verificar` ya tiene el mecanismo para leer los cinco clones (`SISTEMAS`, `clonDe`).
3. **La alternativa medida —«que cada sistema sepa sembrar lo suyo y exista un orden declarado que
   alguien comprueba»— es lo que había, y es lo que falló.** El orden estaba declarado (en el README
   y en el array de bash de un guion) y no lo comprobaba nadie.

Lo que se queda en `infrastructure` son tres archivos, en `infra/carga-de-datos/siembra/`:

| Archivo | Qué es |
|---|---|
| `pasos.tsv` | **El orden, escrito una sola vez.** Diez filas: paso, sistema, guion, proceso, archivo, comprobación y `requiere` |
| `sembrar-demostracion.sh` | Recorre el manifiesto llamando al guion **de su repositorio**, y comprueba después de cada paso |
| `comprobar-siembra.sh` | Cuenta contra las tres bases y **sale en rojo nombrando lo que falta**. Se puede correr solo |

### 3.1 Ninguna cifra está escrita a mano

`pasos.tsv` no lleva números. Lleva expresiones sobre el **propio CSV** que cada paso carga:

```
7  catastro  cargar-detalle-fichas-demo.sh  …  ficha_catastral=fichas.csv:filas+detalle-de-fichas.csv:distintos:codigoPredial
```

Eso resuelve a **45**, que es lo que el juego de datos anuncia («23 predios con sus 45 versiones de
ficha»): 23 que inscribe `fichas.csv` más 22 que versiona `detalle-de-fichas.csv`. Un `45` escrito a
mano en el manifiesto se quedaría rancio en cuanto alguien añadiera un predio, y **una comprobación
rancia que pasa en verde es exactamente el modo de fallo que esto viene a cerrar** (la lección de
#188 con `verificar-cuadros.mjs`, que existía y no corría nadie).

### 3.2 Por qué cuenta el total y no lo que el paso escribió

Porque hay que distinguir dos cosas que **producen la misma salida**. Medido:

```
# el paso 3 sembrado fuera de orden, sin el paso 2:
… 15 fila(s) leidas, 0 manzana(s) nueva(s), 15 rechazada(s)    exit 0

# el paso 3 repetido sobre una siembra correcta (lo que hace --desde N):
… 15 fila(s) leidas, 0 manzana(s) nueva(s), 15 rechazada(s)    exit 0
```

**Línea por línea la misma.** El cargador no puede distinguirlas y no debe: rechazar una fila que ya
existe por unicidad es lo que hace que repetir un paso no duplique. Lo único que las separa es lo que
la tabla **tiene**:

- siembra en orden → el total cuadra → **verde**
- repetir un paso → el total cuadra → **verde**
- sembrar en desorden → el total no cuadra → **rojo, diciendo cuántas faltan**

### 3.3 Lo que se movió, y lo que no

Movido: los cuatro guiones de `rentas`, el de `caja`, y las copias sobrantes de los siete de
`catastro` y de los diez CSV. Retirados de `catastro`: `cargar-transferencias-demo.sh` y su
`transferencias.csv`, que son de `rentas`. Retirados de `rentas`: las seis copias de CSV ajenos que
heredó de P5A.

**Una consecuencia hubo que resolverla:** `ArchivosDeEjemploDeRentasTest` leía `fichas.csv` de su
propia copia para componer el padrón contra el que se cruzan las transferencias. Ahora lo lee **del
clon hermano de `catastro`**, exactamente como `ArchivosDeEjemploTest` de `catastro` lee
`contribuyentes.csv` de `rentas` (hueco 5 de P5C). El costo es el mismo y está escrito en el javadoc:
`kamayuk-rentas-rentas` no compila sus pruebas sin `catastro` clonado al lado, y si no está la prueba
falla nombrando el `git clone`; no se salta.

**No movido, con su motivo:** `abrir-conjunto-parametros.sh`, `publicar-parametros.sh` y
`publicar-cuadros.sh` se quedan en `infrastructure`. Son de la familia de los **valores normativos**,
no de la siembra: corren como `rol_carga_parametros` y leen el corpus verificado a doble firma, que
se fue a `normativa` en P5B —así que sus rutas relativas ya no resuelven desde aquí—. Moverlos es
una decisión de ese repositorio, que hoy no tiene `infra/`. Queda como hueco 4.

---

## 4. La siembra, ejecutada de verdad

Contra **PostgreSQL 16.15** en `127.0.0.1:55444`, con las cuatro bases creadas de cero
(`c6_rentas`, `c6_catastro`, `c6_caja`, `c6_normativa`), cada una provisionada con **su propio**
`crear-roles.sql` dentro de su base y migrada con **su propio** `Migrador`:

| Sistema | Migraciones aplicadas | Tablas |
|---|---|---|
| `rentas` | 11 | 113 |
| `catastro` | 4 | 36 |
| `caja` | 2 | 26 |
| `normativa` | 1 | 23 |

`ImplantarMunicipalidad` dejó en `rentas`: «Municipalidad 200104 lista (DEMOSTRACION): id 1, 134
accesos nuevos, administrador 'admin.catacaos', 134 permisos al grupo 'Administracion del sistema',
11 al grupo 'Seguridad'».

### 4.1 Los recuentos

```
  ok 1/10 catastro  via                        15 de 15
  ok 2/10 catastro  sector                     4 de 4
  ok 3/10 catastro  manzana                    15 de 15
  ok 4/10 caja      caja                       5 de 5
  ok 4/10 caja      area                       3 de 3
  ok 5/10 rentas    contribuyente              16 de 16
  X  6/10 catastro  predio                     0 de 23: FALTAN 23 (el paso 6 necesita antes el/los paso(s) 1,2,3,5)
  X  7/10 catastro  ficha_catastral            0 de 45: FALTAN 45 (el paso 7 necesita antes el/los paso(s) 6)
  ok 8/10 rentas    vehiculo                   8 de 8
  X  9/10 rentas    transferencia              0 de 7: FALTAN 7 (el paso 9 necesita antes el/los paso(s) 6,8)
  X  10/10 rentas    cuenta_corriente_asiento   32 de 54: FALTAN 22 (el paso 10 necesita antes el/los paso(s) 5,6,8,9)

SIEMBRA INCOMPLETA: 4 comprobacion(es) en rojo.
```

**Seis pasos de diez cuadran al último registro.** Los cuatro que faltan no fallan por la
orquestación —§6 dice exactamente por qué, con el error de cada uno— y **el `32 de 54` del paso 10
es información nueva que sólo se ve contando**: la carga de deuda murió a mitad, con 32 asientos ya
escritos, porque cada fila es su propia transacción (#328) y no hay reversión. Un paso que falla no
deja la base como estaba, y hasta ahora nadie lo decía.

### 4.2 Lo que hubo que aportar desde fuera para poder ejecutar, y no se arregló

**Ninguna de las cuatro aplicaciones arranca hoy, en ningún perfil.** Es la primera cosa que este
trabajo encontró, y no ejecutando la siembra sino intentando ejecutarla. Se aportaron dos beans desde
un classpath de arnés —fuera de todo repositorio— para poder medir; **el defecto queda declarado, no
arreglado** (huecos 1 y 2). Detalle en §6.

---

## 5. La mutación: el silencio se acabó

### 5.1 El caso, y por qué éste

El paso 3 (manzanas) sin el paso 2 (sectores). **Los dos son de `catastro`**, así que la
demostración no depende de ninguna frontera ni de ningún doble: es la misma clase de defecto que el
hueco 8 describe, en su forma más limpia. Base recién migrada, `municipalidad` con
`es_demostracion = true`, nada más dentro.

### 5.2 Las dos salidas

**ANTES** — lo que hay hoy, sin C-6:

```
$ SGTM_CARGAMANZANAS_ARCHIVO=…/manzanas.csv  <aplicacion de catastro, perfil batch>
WARN  … Manzana de la fila 7 rechazada: No existe el sector con codigo '01'   (×15)
INFO  … Manzanas de la municipalidad 1 cargadas desde …/manzanas.csv:
        15 fila(s) leidas, 0 manzana(s) nueva(s), 15 rechazada(s)
$ echo $?
0
```

Quince filas leídas, ninguna dentro, **y el proceso dice que fue bien**. En la secuencia entera eso
se lleva por delante los pasos 6, 7, 9 y 10 sin un solo error.

**AHORA** — la misma corrida, con la comprobación de C-6:

```
$ comprobar-siembra.sh --municipalidad-id 1 --paso 3 --url-catastro postgresql://…
  X  3/10 catastro  manzana                    0 de 15: FALTAN 15 (el paso 3 necesita antes el/los paso(s) 2)

SIEMBRA INCOMPLETA: 1 comprobacion(es) en rojo.
Una carga que rechaza sus filas TERMINA EN VERDE; lo que no cuadra es lo que quedo en la base.
$ echo $?
1
```

### 5.3 Los contrastes, que son la mitad que importa

Una comprobación que se pusiera roja en un repetición legítima sería peor que el defecto. Medido,
sobre la misma base:

| Corrida | Qué imprime el cargador | La comprobación |
|---|---|---|
| paso 2, y luego paso 3 **en su orden** | `4 nuevos, 0 rechazadas` / `15 nuevas, 0 rechazadas` | **verde**, `4 de 4` y `15 de 15` |
| paso 3 **otra vez** (lo que hace `--desde N`) | `0 nuevas, 15 rechazadas` — **la misma línea que el caso malo** | **verde**, `15 de 15`, exit 0 |
| paso 1, que nunca se corrió | — | **rojo**, `0 de 15: FALTAN 15` |

Y un cuarto contraste que **no hubo que provocar**: correr los `verificarAislamiento` de los tres
backends contra el mismo clúster reasigna las claves de los roles (`BaseDeDatosDePrueba` hace
`ALTER ROLE … PASSWORD` con una clave derivada del `system_identifier`, y son roles **del clúster**
— el mecanismo que #698 documenta). La comprobación siguiente salió así:

```
X  1/10 catastro.via  no se pudo contar: psql:error:…FATAL: password authentication failed for user "sgtm_app"
…
SIEMBRA INCOMPLETA: 11 comprobacion(es) en rojo.
```

**Once en rojo, y ninguna diciendo que la siembra esté mal.** Un contador que no puede contar no
informa un cero: informa que no pudo. Es la misma regla que el código de salida 3 aplica a un
`--url-<sistema>` que falta —«no se ha comprobado» no es «está bien»—, porque un cero inventado en un
recuento de siembra es indistinguible de una tabla vacía.

### 5.4 Las guardas nuevas, y su rotura

`infra/verificaciones/siembra-de-la-demostracion.test.ts`, 11 pruebas en `yarn verificar` —sin motor,
sin clúster y sin arrancar ninguna aplicación—. Cinco roturas, cada una aplicada sola y restaurada
por copia comparada con `cmp`:

| Rotura | Rojo |
|---|---|
| Devolver `cargar-transferencias-demo.sh` a `catastro` | **2 en rojo**: «catastro/cargar-transferencias-demo.sh: manda `SGTM_CARGATRANSFERENCIASDEMO_ARCHIVO`, y ningún cargador de «catastro» la atiende» |
| Devolver la copia de `fichas.csv` a `rentas` | **2 en rojo**: «fichas.csv: rentas, catastro» y «rentas/fichas.csv» sin paso que lo cargue |
| Que el paso 3 declare `requiere: 7` (hacia adelante) | **2 en rojo**: «3 necesita el 7, que va despues» |
| Que el paso 6 declare `sgtm.carga-fichas`, que `catastro` no implementa | **2 en rojo**, nombrando el paso y el proceso |
| Que el paso 1 se compruebe contra una columna que `vias.csv` no tiene | **1 en rojo**, nombrando el archivo y las columnas que sí tiene |

La primera es la que importa: es el defecto de la fila 9 del censo, y **antes de C-6 nada podía
verlo** porque el síntoma es la ausencia de síntoma.

---

## 6. Lo que impide completar la siembra hoy: cinco defectos, tres de ellos nuevos

Ninguno es de la orquestación. Los tres primeros los encontró **ejecutar**, no razonar.

### Hueco 1 — Ninguna de las cuatro aplicaciones arranca: falta el `ObjectMapper`

Spring Boot 4 autoconfigura **Jackson 3** (`tools.jackson.databind.json.JsonMapper`) y no deja
ningún bean de Jackson 2. Los ocho clientes HTTP entre sistemas que escribió el corte inyectan
`com.fasterxml.jackson.databind.ObjectMapper`, que es Jackson 2 y que **nadie declara**. Medido, con
el jar de cada repositorio y perfil `batch`:

```
rentas    : Parameter 0 of constructor in …ClienteHttpDeCatastro required a bean of type
            'com.fasterxml.jackson.databind.ObjectMapper' that could not be found.
catastro  : …DirectorioHttpDeRentas required a bean of type 'com.fasterxml.jackson.databind.ObjectMapper'…
caja      : …ComponedorDeEventosJson required a bean of type 'com.fasterxml.jackson.databind.ObjectMapper'…
normativa : …web.SnapshotController required a bean of type 'com.fasterxml.jackson.databind.ObjectMapper'…
```

No es del perfil `batch`: el bean falta en los cuatro contextos. Las pruebas no lo ven porque
construyen los clientes con `new ObjectMapper()`. `ConfiguracionDeJson` dice de sí misma «API de
Jackson 3 (`tools.jackson`), que es la que trae Spring Boot 4», así que **los tres módulos que
declaran `implementation("com.fasterxml.jackson.core:jackson-databind")` están en la otra versión**.

**No se arregla aquí**, y es deliberado: el arreglo correcto —llevar los ocho clientes a Jackson 3—
cambia cómo hablan cuatro sistemas entre sí y necesita sus propias mutaciones; el atajo —declarar un
bean de Jackson 2— deja dos Jackson en un proceso y contradice `ConfiguracionDeJson`. Para poder
**medir** la siembra se aportó el bean desde un classpath de arnés fuera de todo repositorio, con su
javadoc diciendo que no es código de producción.

### Hueco 2 — `catastro` y `caja` no tienen quién implemente `ComprobadorDeAcceso`

Las dos declaran el puerto (`kamayuk.<sistema>.autorizacion.ComprobadorDeAcceso`) cuyo javadoc dice
«la implementación vive en `seguridad`» — y `seguridad` se quedó en `rentas`. **No hay ninguna
implementación en todo el repositorio**, ni de producción ni con `@Profile`. Sus controladores son
beans incondicionales, así que:

```
catastro : Parameter 3 of constructor in …web.SectorController required a bean of type
           'kamayuk.catastro.autorizacion.ComprobadorDeAcceso' that could not be found.
caja     : Parameter 1 of constructor in …web.CierreController required a bean of type
           'kamayuk.caja.autorizacion.ComprobadorDeAcceso' that could not be found.
```

Sumado al hueco 1: **`catastro` y `caja` nunca se han arrancado**. Sus 974 y 673 pruebas pasan y
ninguna levanta el contexto completo. Es la misma familia que #430 encontró con `area` y `caja` —una
pieza que existe, que se prueba y que en una instalación real no está— un escalón más arriba. Para
medir se aportó un doble que **niega todo**; en perfil `batch` no se atiende ni una petición, así que
nunca se le llama.

### Hueco 3 — Nada implanta la municipalidad fuera de `rentas`

`municipalidad` existe en los cuatro baselines, con `es_demostracion`, y `SoloEnDemostracion` la
consulta **en la base de su propio sistema**:

```sql
SELECT es_demostracion FROM municipalidad WHERE id = current_setting('app.municipalidad_id')::bigint
```

`ImplantarMunicipalidad` está **sólo en `rentas`**. En `catastro`, `caja` y `normativa` el único
`INSERT INTO municipalidad` del árbol está en fixtures de prueba. Sin esa fila, los pasos 6 y 7 se
niegan a correr —correctamente— y no hay nada en el sistema que la escriba. Para medir se insertó a
mano como `sgtm_owner`, con el mismo `id` que dejó la implantación de `rentas`.

Es exactamente el hueco que #430 cerró para `area` y `caja`, y hay que cerrarlo igual: por donde
entra la configuración de la municipalidad, no con una pantalla.

### Hueco 4 — El paso 6 necesita el padrón por HTTP, y en `batch` no hay token

Conocido (hueco 6 de P5C) y confirmado ejecutando. `fichas.csv` nombra a sus titulares por código, y
`InscribirFicha` los resuelve con `DirectorioDeContribuyentes` → `DirectorioHttpDeRentas`, que
**reenvía el `Authorization` de la petición en curso**. En una corrida sin usuario delante no hay
petición:

```
kamayuk.catastro.contribuyentes.infraestructura.DirectorioHttpDeRentas$PadronInalcanzable:
No se pudo resolver el contribuyente C-000001: kamayuk.rentas.url no esta configurada.
El padron de contribuyentes vive en `rentas`
                                                                            exit 1
```

Con la URL puesta y sin token, `rentas` rechaza y sale la misma excepción. **Y eso es lo bueno**: es
ruidoso. Lo que **no** es ruidoso, y es el hueco 8 de P5C literal, es el caso en que `rentas`
contesta y su padrón está vacío: `InscribirFicha.ReferenciaInexistente` **sí** se captura, así que
las 23 fichas se rechazan una a una y el proceso sale con 0. Eso es lo que la comprobación de C-6
convierte en «`0 de 23`: FALTAN 23».

### Hueco 5 — El paso 9 necesita una escritura que no tiene ruta, y no por descuido

`GestorDeTitularidad.transferir` lanza `EscrituraSinTransaccionCompartida` (C-5). Su javadoc explica
por qué y no cambia con esta corrección: `RegistrarTransferencia.transferirPredio` cierra la cuota
del transferente, inserta la fila de `transferencia` y escribe su auditoría **en una sola
transacción**; servida por HTTP, un fallo posterior dejaría el predio cambiado de dueño **sin el acto
que lo justifica** — lo que #52 midió con «12 fichas donde debe haber 11».

De las 7 filas de `transferencias.csv`, 5 son de predio y 2 de vehículo. Las 5 mueren; la excepción
**no** está entre las que el importador captura, así que la corrida sale con código distinto de cero
—ruidosa— y el paso 10, que resuelve la unidad de cada obligación a su fecha valor, se cae detrás por
la misma frontera.

### Hueco 6 — Los tres guiones de valores normativos siguen en `infrastructure`

Con su motivo, en §3.3. Es un hueco de sitio, no de función.

---

## 7. Cifras y verificadores

| Repositorio | Pruebas antes | Pruebas después | `build` | `verificarArquitectura` | `verificarAislamiento` |
|---|---|---|---|---|---|
| `rentas` | 3 121 | **3 121**, 0 fallos | verde | verde | verde |
| `catastro` | 974 | **974**, 0 fallos | verde | verde | verde |
| `caja` | 673 | **673**, 0 fallos | verde | verde | verde |
| `infrastructure` | 389 | **400**, 0 fallos | `yarn verificar` verde (lint, tipos y pruebas) | — | — |
| `normativa` | 606 | no se tocó | — | — | — |

Los tres backends se corrieron con `--rerun-tasks` y contra el motor real
(`-Dkamayuk.pruebas.postgres.url=jdbc:postgresql://127.0.0.1:55444/postgres`): una tarea
`UP-TO-DATE` no demuestra nada (la lección de #192 §2).

En `rentas` y `catastro` las cifras **no se mueven** aunque se tocara una prueba de cada uno: el
cambio de `ArchivosDeEjemploDeRentasTest` es de dónde lee un archivo, y el de `ArchivosDeEjemploTest`
quita `transferencias.csv` de dos listas **dentro** de sendos `for`, que no son pruebas distintas.

## 8. Reglas que este trabajo no toca, y conviene decirlo

- **Ninguna cifra normativa entra por la siembra.** Ni aranceles, ni valores unitarios, ni tramos, ni
  valores referenciales. El monto de `deuda.csv` es un **saldo**, no una determinación.
- **`cargar-cajas.sh` sigue sin exigir `es_demostracion`**, y los seis pasos que siembran datos
  inventados siguen exigiéndolo **contra la base**, comprobado por cada proceso y no por el guion.
  El manifiesto no cambia eso ni podría: no le pregunta nada a ningún proceso.
- **`SET LOCAL`, jamás `SET SESSION`** (regla 3). `comprobar-siembra.sh` cuenta dentro de una
  transacción con `SET LOCAL app.municipalidad_id`, y no por costumbre: el esquema declara `FORCE ROW
  LEVEL SECURITY`, así que sin contexto de tenant la consulta no devuelve vacío — revienta con
  «unrecognized configuration parameter». Cuenta como `sgtm_app`, que es lo que la aplicación ve;
  contar como `sgtm_owner` mediría lo mismo (el dueño también está sujeto a la política) y contar como
  superusuario mediría otra cosa.
- **Aquí no se borra nada** (RNF-051). La comprobación sólo lee.
