# C-1 — Los nueve desajustes de frontera consumidor↔proveedor, cerrados

> **Estado: los nueve cerrados.** `desajustesVivos()` queda **vacío** en los dos archivos donde
> había entradas —`catastro/…/ContratoConRentasTest` y `rentas/…/ContratoConCajaTest`— y sigue
> declarado a propósito, con la lista a cero: lo que permite es una excepción temporal y con
> nombre, y a cero un desajuste nuevo no tiene dónde esconderse.
>
> Cifras: **rentas 3 094 → 3 102 · catastro 951 → 958 · caja 669 · normativa 602 · infrastructure
> 366/366.** Ninguna baja. Contra PostgreSQL 16.15 real, **no por Testcontainers** (ver §6).

---

## 0. Lo que la medición corrigió antes de tocar código

Tres afirmaciones del registro de P6 y del encargo resultaron falsas al comprobarlas contra el
árbol. Las tres cambian **qué** hay que arreglar, no sólo cómo:

1. **«`ConsultaController` declara el parámetro `fecha` y lo ignora — la ficha vigente la resuelve
   con `LocalDate.now(reloj)`».** No lo ignora. `ConsultaController:106` resuelve `cuando` del
   parámetro y lo pasa a `ConsultaDeFichas.buscar`, que lo pasa al repositorio, donde vive como
   `f.vigencia_desde <= :fecha` y en el `JOIN` con `titularidad`. El **efecto** que P6 describe
   —pedir marzo y recibir la ficha de hoy— sí era real, y su causa era **el nombre**: como
   `aLaFecha` no llegaba nunca, se tomaba el valor por omisión del reloj. **Sí se cerraba
   renombrando**, y se cerró.

2. **«El motivo de la anulación sobrevive sólo dentro de la columna `cuerpo` de `pago_recibido`,
   que es jsonb y que ninguna lectura tipada mira».** No sobrevivía en ninguna parte:
   `PagoController.congelar` **reserializa el `record`**, así que lo que llega a esa columna es
   exactamente lo que `PeticionDePago` declara. Un campo no declarado se pierde entero.

3. **«El (3) no se cierra renombrando: hay que implementar el filtro o quitarlo de las dos
   partes».** El filtro estaba implementado (ver 1). Los que de verdad no se cerraban renombrando
   eran **(4) y (5)** —había que leer dos parámetros que el controlador no leía— y **(8) y (9)**,
   que exigían decidir qué hace `rentas` con dos datos que estaba tirando.

---

## 1. Los nueve, uno a uno

### (1) `contenido[].fichaId` — **paga el PROVEEDOR** (`catastro`)

`FichaEncontradaResource` publicaba `id`; el adaptador lee `fichaId`.

**Decisión: el proveedor renombra `id` → `fichaId`.** La fila lleva **dos** identificadores, y
junto a `predioId` el nombre `id` no dice cuál: es el tecnicismo «la clave de esta fila» donde el
vecino nombra su sujeto (RNF-080). El dominio del propio proveedor ya lo llama
`FichaEncontrada.fichaId()`. Nada más en `catastro` leía ese campo —ni una prueba, ni otro
recurso—, así que el cambio no tiene radio.

Y era el peor de los siete porque **es mudo**: `asLong()` sobre un nodo ausente devuelve 0, de modo
que toda ficha llegaba a `rentas` con `fichaId = 0` y ninguna cifra parecía mal.

*Mutación*: devolver `long fichaId` a `long id`.
*Rojo*: 1 en `ContratoConRentasTest` — «falta el campo «contenido[].fichaId», que el consumidor
lee. Este endpoint declara [… id, …]».

### (2) `contenido[].vigenciaDesde`, «texto» contra «fecha» — **paga el CONSUMIDOR** (`rentas`)

**Decisión: el contrato pasa a declarar «texto», que es lo que viaja.** Es el desajuste más
sutil de los nueve y **no tiene consecuencia en el cable**: `FormaDeLaRespuesta` distingue `texto`
de `fecha` por el **tipo de Java**, y Jackson emite los dos como la misma cadena ISO. El contrato
describe el JSON, no el objeto que quien lee construye con él — y el adaptador lee un texto
(`asText()`) y lo parsea.

Medido antes de decidir: en `catastro` hay **cuatro** recursos que publican `vigenciaDesde` como
`String` (`FichaEncontradaResource`, `FichaResource` ×2, `PredioDelResumenResource`) y **dos** como
`LocalDate` (`TitularidadResource`, `InquilinoResource`), así que «el `String` es la anomalía» no
se sostiene. Y el contrato que **el propio `rentas`** publica para `normativa` ya declara ese mismo
campo como `"texto"`.

Queda un hueco declarado en §4.

*Mutación*: devolver `"fecha"` a la declaración del contrato y regenerar.
*Rojo*: 1 — «el campo «contenido[].vigenciaDesde» es «texto» y el consumidor lo lee como «fecha»».

### (3) `?aLaFecha=` contra `?fecha=` — **paga el CONSUMIDOR** (`rentas`)

**Decisión: el adaptador manda `fecha`.** `fecha` es como `catastro` nombra la fecha de corte en
**siete** endpoints de su capa web (`ConsultaController`, `FichaController` ×4,
`ResumenPredialController`, `ReporteController` ×2, `OcupacionDelPredioController`); renombrar uno
solo dejaría dos nombres para el mismo criterio dentro del proveedor, que es el defecto que #397 y
#481 midieron, y renombrar los siete es un cambio mucho mayor que el desajuste. El nombre del
**puerto** —`FichasDelPadron.buscar(criterio, aLaFecha, paginacion)`, que es la regla 9— no cambia:
traducir es lo que el adaptador existe para hacer.

Lo que se compra con el cambio es el comportamiento: como el parámetro ahora llega, la grilla deja
de resolverse con el reloj del servidor y una consulta por marzo devuelve la ficha de marzo.

*Mutaciones*: (a) sólo el adaptador vuelve a `aLaFecha`; (b) además el contrato.
*Rojo*: (a) **el CI del proveedor queda VERDE** —compara el archivo, y el archivo no cambió— y lo
caza sólo la guarda nueva de este lado: «expected […, "fecha", …] but was ["aLaFecha", …]».
(b) 1 en `ContratoConRentasTest`, nombrando el parámetro y listando los que el endpoint sí lee.

### (4) y (5) `?soloPredio=` / `?exceptoPredio=` — **paga el PROVEEDOR** (`catastro`)

**Decisión: el proveedor los lee.** No hay alternativa: dejarlos caer es #631 deshecho por la
separación en repositorios. `rentas` compone la conciliación pidiendo la grilla acotada a los
predios que declararon (o a su complemento) para poder **paginar y contar lo filtrado**; si la
acotación no llega, vuelve la página del padrón entero con el `totalElementos` del padrón entero.
Medido en su día sobre Catacaos: «722 páginas, 14 422 elementos» y **cero filas en todas**.

No hizo falta tocar el dominio ni el SQL: `FiltroDeFichas.acotacion` y `AcotacionPorPredio` ya
existían en `catastro`, y `FichaCatastralRepositoryJdbc` mete la condición en el **mismo** `WHERE`.
Lo único que faltaba era leer los dos parámetros y construirla.

Dos decisiones de forma, con su motivo:

- **Los dos a la vez son 422**, no una elección silenciosa: `AcotacionPorPredio` no puede expresar
  «sólo estos y además todos menos éstos», y quedarse con uno devuelve una grilla plausible que
  acota por otra cosa.
- **«Sólo estos, y ninguno» no se puede distinguir de «no acotes»** por la URL, porque un parámetro
  repetido cero veces es un parámetro ausente. Por eso el corto-circuito sigue en el cliente
  (`FichasDelPadronHttp`), y ahora eso está escrito en los dos lados: quitarlo de allí mandaría una
  petición para no traer nada y el servidor contestaría el padrón entero.

*Mutación*: quitarle al controlador los dos parámetros y la acotación.
*Rojo*: 2 en `ContratoConRentasTest` —«el consumidor manda «soloPredio» y este endpoint no lo lee
… Viaja en la URL y se descarta en silencio»— y **3 de 17** en `ConsultaControllerTest`, que es lo
que mide que además de declararse **acoten**.

### (6) El cuadro de valores unitarios es un ARRAY — **paga el CONSUMIDOR** (`rentas`)

`ValorUnitarioController` devuelve `List<ValorUnitarioResource>`; el adaptador iteraba `contenido`.

**Decisión: el adaptador recorre el array.** Un cuadro sellado se lee **entero**: no tiene página
que pedir ni un `totalElementos` que significara algo, y envolverlo inventaría un sobre vacío de
sentido. Además la forma es la que `catastro` usa en sus **tres** lecturas de cuadro —aranceles,
depreciación y valores unitarios—, así que cambiar una las separaría. Quien supuso un sobre que
nunca estuvo fue el adaptador.

Y se le añade la guarda que faltaba: si la respuesta **no** es un array, falla en voz alta en vez
de devolver el cuadro vacío — un cuadro vacío se lee como «este ejercicio no tiene cuadro
publicado» y la obra sale valorizada en 0,00 (#48).

*Mutaciones*: (a) sólo el adaptador vuelve a `contenido`; (b) además el contrato.
*Rojo*: (a) el CI del proveedor **VERDE**, y rojo el de este lado: «Expected size: 1 but was: 0».
(b) 1 en `ContratoConRentasTest`: «el consumidor espera un objeto y este endpoint publica
«[{id=entero, partida=texto, …}]»».

### (7) `?ejercicio=` contra `@RequestParam int anio` — **paga el PROVEEDOR** (`catastro`)

Era el único de los siete que **no llegaba a 200**: el parámetro es obligatorio, la petición salía
400 y el cliente la traducía a `CatastroInalcanzable` — «catastro no responde» donde lo que pasa es
que el parámetro se llama de otra manera.

**Decisión: el proveedor lee `ejercicio`, y se renombra en las tres lecturas de cuadro a la vez.**
Lo que acota es el **ejercicio** del conjunto sellado, que es un tipo del dominio (`Ejercicio`,
1990..2100) y no un año cualquiera; y **en esta misma respuesta viaja `anioConstruccionDesde`, que
sí es un año**: llamar «anio» a los dos conflaba exactamente los dos números que #723 tuvo que
separar en `ValorUnitarioSinParametrizar`. Se renombra también en `aranceles` y `depreciacion`
porque son la misma ruta con otro nombre y sus javadoc se citan entre sí; dejar dos vocabularios
entre tres hermanas es el defecto que #397 y #481 midieron.

El coste está acotado y medido: `catastro` **no publica OpenAPI** (P6 §1 lo decidió así), no hay
frontend en estos repositorios, y el único cliente —`ValoresUnitariosHttp`— ya mandaba `ejercicio`.
Lo demás son tres javadoc y un `.param(...)` de `CuadrosSinSellarControllerTest`.

*Mutación*: devolver `@RequestParam int ejercicio` a `anio` en `ValorUnitarioController`.
*Rojo*: 1 — «el consumidor manda «ejercicio» y este endpoint no lo lee (lee [anio])».

### (8) y (9) `motivo` y `fecha` de la anulación — **paga el PROVEEDOR** (`rentas`), y hubo que decidir qué hace con ellos

`ComponedorDeEventosJson.pagoAnulado` los escribe desde siempre y `PeticionDePago` no los
declaraba. Con `FAIL_ON_UNKNOWN_PROPERTIES` apagado, Jackson los descartaba y la caja recibía
**201**: el evento se marcaba ENTREGADO, el buzón se vaciaba y el dato no llegaba. No hay reintento,
porque para la caja la entrega salió bien.

Quién paga no admitía discusión —son datos que existen, que la caja **exige** al anular (RNF-052) y
que se estaban tirando—. Lo que había que decidir es qué hace `rentas` con ellos, y son **dos
decisiones distintas**:

- **`motivo` no va a la columna `motivo` que ya había.** Esa significa *por qué **este** sistema no
  pudo imputar el pago*, y `pago_recibido_motivo_ck` la exige sólo cuando el estado es RECHAZADO.
  Meter ahí el motivo de la caja dejaría dos verdades en la misma celda y la que se lea en pantalla
  sería la que nadie recuerde cuál es. Va a **`motivo_anulacion`** (`V10`) y de ahí a la
  `Observacion` con la que se asientan los asientos de reversión, o sea al `motivo` de cada fila del
  libro — que es donde se lee **por qué una deuda volvió a estar viva**. Y no es inventar una
  observación (la mutación que #538 midió y rechazó): aquí **sí** hay un usuario y sus palabras, y
  lo que se hacía era tirarlas.
- **`fecha` pasa a ser la fecha valor de la reversión.** Hasta C-1 se reversaba con `fechaDePago`,
  que en una anulación es la del **recibo original**: anular en julio uno de marzo escribía la
  reversión en marzo, de modo que un estado de cuenta al 30 de abril recalculado después cambiaba
  de respuesta —y el recibo estuvo vigente hasta julio—. Es la regla 9 y ADR-0006, y además decide
  en qué partición caen los asientos.

**Migración `V10`**, con dos columnas y un `CHECK` biciondicional `NOT VALID`. El `NOT VALID` es
**por los datos y no por RLS**: no se puede saber qué hay hoy en `pago_recibido` de una instalación
en marcha, un `ALTER TABLE` validado que encontrara una anulación anterior fallaría con «is
violated by some row» y esas filas tampoco se pueden reparar desde el migrador, que corre sin
contexto de tenant (DAT-01 §0). `NOT VALID` sigue comprobando cada `INSERT`, que es lo que hace
falta: NULL significa «esta fila es anterior a V10», no «se desconoce».

**El invariante va en las dos direcciones donde se puede y en una donde no**, que es el reparto que
`V77` de `sgtm` dejó medido: el borde (`PagoController`) y `PagoRecibido.enTransito` **exigen** las
dos mitades en una anulación, porque son la entrada; el constructor compacto de `PagoRecibido` sólo
sostiene que un **cobro** no pueda traerlas, porque ese `record` también reconstruye filas leídas de
la base y las anteriores a `V10` no las tienen.

`varchar(300)` y no 400: el texto se compone dentro de una `Observacion`, que el esquema limita a
500, junto con el identificador del pago y el número del recibo (~114). `caja` lo declara hoy
`varchar(80)`.

*Mutaciones*: (a) `PeticionDePago` deja de declarar los dos; (b) la reversión vuelve a asentarse con
la fecha del recibo; (c) la observación vuelve a componerse sin el motivo.
*Rojo*: (a) **2** en `ContratoConCajaTest`, nombrando los dos campos y listando los que el endpoint
sí declara. (b) 1 con las dos fechas dentro: «Expecting ArrayList: [2026-03-16] to contain only:
[2026-07-16]». (c) 1: «Expecting actual: "Reversion del pago … por la anulacion del recibo 001-C1-G"
to contain: "ERROR EN EL IMPORTE COBRADO"».

---

## 2. Lo que hubo que construir además, y por qué

### 2.1 La mitad de la ida y vuelta que faltaba: lo que el adaptador **pide**

`LecturaDeCatastroTest` ataba los campos que `rentas` **lee** de la respuesta a los que el contrato
declara. Nada ataba los que **manda**: el contrato enumera sus parámetros a mano y el adaptador
construye la URL a mano, así que podían discrepar sin que nada se pusiera rojo — y entonces el CI
del proveedor comprobaría un contrato que su único cliente no cumple.

**No es hipotético: es exactamente el estado de tres de los nueve.** Medido con la mutación (3a):
revertir sólo el adaptador deja el CI del proveedor en **VERDE**.

`PeticionesACatastroTest` (nueva) construye las URL con los adaptadores de producción —un doble que
se queda con la ruta— y exige que el conjunto de nombres de parámetro sea **exactamente** el que el
contrato declara. Lleva su propio contraste: una prueba que no capture ninguna URL compararía el
conjunto vacío contra el vacío y pasaría en verde sin haber mirado nada.

Y `LecturaDeCatastroTest` gana la ida y vuelta del **cuadro**, que sólo tenía la de la ficha: sin
ella, la mutación (6b) —el adaptador vuelve a iterar `contenido`— no la cazaba nadie.

### 2.2 El contrato del consumidor, declarado como entrada de Gradle

Las tres roturas del lado del consumidor **pasaron en VERDE la primera vez que se midieron**:
`:kamayuk-catastro-aplicacion:test` quedaba `UP-TO-DATE` porque el archivo que lee
—`../../rentas/docs/50-api/contratos-que-consume/catastro.json`— vive en **otro clon** y no era
entrada declarada de la tarea. En CI corre fresco y muerde, que es la peor forma de enterarse.

Es la lección de #192 punto 2 aplicada a la frontera entre repositorios, y el propio
`build.gradle.kts` de ese módulo ya la tenía escrita para otras tres entradas. Declarado, la misma
rotura vuelve a morder **sin** `cleanTest`.

---

## 3. Las cifras

| Repositorio | Antes | Después | Diferencia |
|---|---:|---:|---|
| `rentas` | 3 094 | **3 102** | +8: 3 de `PeticionesACatastroTest`, 2 de `LecturaDeCatastroTest` (el cuadro), 3 de `PagoInyectadoDosVecesTest` (C-1 8 y 9, y las columnas de `V10`) |
| `catastro` | 951 | **958** | +7, todas en `ConsultaControllerTest`: `fichaId`, las dos acotaciones y su contraste, el 422 de las dos a la vez, y las dos de la fecha de corte |
| `caja` | 669 | **669** | sin tocar |
| `normativa` | 602 | **602** | sin tocar (`desajustesVivos()` ya estaba vacío) |
| `infrastructure` | 366/366 | **366/366** | sólo entra este documento |

Los tres verificadores bloqueantes en verde en los dos repositorios tocados: `build` (con Spotless,
Checkstyle y NullAway), `verificarArquitectura` y `verificarAislamiento`.

---

## 4. Huecos declarados

1. **`normativa` tiene el mismo hueco de entrada de Gradle que se cerró en `catastro`, y no se
   tocó.** Sus dos pruebas de contrato leen `rentas/docs/…/normativa.json` y
   `catastro/docs/…/normativa.json`, que viven en otros clones y no son entradas declaradas: un
   cambio de lo que sus consumidores esperan deja su `test` en `UP-TO-DATE` y pasa en verde rancio
   en local. El arreglo es la misma media docena de líneas que §2.2 describe, en
   `kamayuk-normativa-aplicacion/build.gradle.kts`. No se aplicó porque el encargo dice «no lo
   toques»; queda aquí para que sea una decisión y no un olvido.

2. **El vocabulario de tipos del contrato distingue `texto` de `fecha` y de `instante` por el tipo
   de Java, no por el JSON.** Los tres viajan como la misma cadena, así que un proveedor que
   endureciera `String` → `LocalDate` sin cambiar un byte del cable pondría rojo el contrato. Es lo
   que produjo el desajuste (2). Colapsarlos perdería la capacidad de ver un cambio real de forma
   —un `LocalDate` emitido como array, por ejemplo—, así que no se toca aquí: se declara.

3. **`caja` y `normativa` no se re-ejecutaron desde cero.** Sus builds salieron `UP-TO-DATE` de la
   corrida anterior y no se tocó una línea en ninguno de los dos; las cifras 669 y 602 son las de
   sus resultados en disco, no las de una corrida nueva.

4. **Los otros siete puertos de `catastro` siguen sin ruta** (P5C hueco 2): este trabajo cierra los
   desajustes de las **tres** operaciones que hoy se piden de verdad, no el inventario de ADR-0030.

5. **La `Observacion` de la reversión puede llegar a 500 caracteres justos** si alguien ensancha
   `recibo_movimiento.motivo` de `caja` más allá de 300. El límite está sostenido por el constructor
   de `PagoRecibido`, que rechaza en voz alta; lo que no hay es una prueba que ate los dos anchos
   entre repositorios.

6. **`pago_recibido_anulacion_ck` va `NOT VALID`**, así que una anulación escrita antes de `V10` no
   se puede leer con su motivo ni con su fecha, y no se puede reparar (el libro no admite `UPDATE` y
   el migrador corre sin contexto de tenant). Escrito en la cabecera de la migración y en el
   `COMMENT` de las dos columnas.

---

## 5. Lo que se decidió **no** hacer

- **No se renombró `fecha` a `aLaFecha` en los siete endpoints de `catastro`.** Habría sido el
  nombre mejor —la regla 9 lo pide— y el cambio es mucho mayor que el desajuste; lo que se pierde
  es expresividad en una URL, no una cifra.
- **No se envolvió el cuadro sellado en un sobre paginado.** Un `totalElementos` que nunca
  significa nada es peor que un array.
- **No se escribió el motivo de la caja en `pago_recibido.motivo`.** Dos verdades en una celda.
- **No se tocó `ConfiguracionDeJson` ni `FAIL_ON_UNKNOWN_PROPERTIES`.** Endurecerlo cambiaría el
  borde de todas las operaciones con cuerpo a la vez (#538, #539) y no es lo que estos dos
  desajustes piden.

---

## 6. Cómo se verificó

Contra **PostgreSQL 16.15 real, y no por Testcontainers**: el demonio de Docker de esta máquina es
un túnel a un VPS y el puerto publicado del contenedor se queda allí, así que se usó el repliegue
documentado —`-Dkamayuk.pruebas.postgres.url=jdbc:postgresql://127.0.0.1:55444/postgres` con
usuario y clave de superusuario—.

Cada mutación se aplicó **sola** sobre `src/main` (o sobre la declaración del contrato), se ejecutó,
y se restauró **por copia comparada con `cmp`** antes de la siguiente. Las mutaciones sobre la
declaración del contrato exigen regenerarlo (`-Dkamayuk.contratos.regenerar=true`) y correr con
`cleanTest --no-build-cache`: la caché local de Gradle reutiliza resultados y una corrida sin eso
puede pasar en verde sin haber ejecutado nada, que es la misma trampa que §2.2 describe.
