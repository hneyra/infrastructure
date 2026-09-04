# P6 — Contratos y observabilidad del corte

| Campo | Valor |
|---|---|
| Fecha | 2026-09-04 |
| Repositorios tocados | `infrastructure`, `rentas`, `catastro`, `normativa`, `caja` |
| Motor de la verificación | PostgreSQL **16.15** real en `127.0.0.1:55444`, **no** por Testcontainers (§7, hueco 1) |
| Implementa | ADR-0030 §4 (prueba de contrato del proveedor), ADR-0026 §3, ADR-0027 §3 |
| Consume | `rentas/docs/00-gobierno/P5E-cierre.md` §5, §6.3 y §10 |

---

## 0. Los tres criterios, y qué se midió de cada uno

| # | Criterio | Estado | Dónde |
|---|---|---|---|
| **1** | Romper la respuesta de `catastro` pone rojo el CI de **catastro**, no el de `rentas` | **Cumplido y medido.** Quitando `direccion` de `FichaEncontradaResource`: catastro **rojo** nombrando el campo, rentas **verde** | §2.4 |
| **2** | Desincronizar una fila de la proyección, y que la anti-entropía la encuentre y **nombre el sector** | **Cumplido y medido** contra PostgreSQL real como `sgtm_app` | §4.3 |
| **3** | Las seis cifras del tablero, pintadas con datos reales | **Cumplido a medias, y la mitad que falta está declarada.** Las consultas corren contra los esquemas reales y **no siempre dan cero**; el tablero no se puede *pintar* porque no hay quien emita las series | §5.4 |

Y el encargo aparte: `deriva-de-migraciones` deja de ser un rojo sin dueño (§6). `yarn verificar`
de `infrastructure` pasa de **337 de 344** a **366 de 366**, verde entero por primera vez desde la
mudanza.

### Lo verificado al cerrar, con el motor real

| Repositorio | Antes de P6 | Después | Fallos |
|---|---:|---:|---:|
| `normativa` | 598 | **602** | 0 |
| `catastro` | 945 | **951** | 0 |
| `caja` | 667 | **669** | 0 |
| `rentas` | 3 080 | **3 094** | 0 |
| **Los cuatro** | 5 290 | **5 316** | **0** |
| `infrastructure` (`yarn verificar`) | 337 de 344 | **366 de 366** | 0 |

---

## 1. Punto 1 — los contratos de los tres sistemas sin generador. **Decisión: no se construyen**

Es la decisión que el enunciado pedía tomar antes de empezar, y se toma **en contra** de construir
los tres `<sistema>-v1.yaml`. El motivo no es el coste: es que un contrato derivado de los
controladores **no puede cazar lo que este punto existe para cazar**, y construirlo dejaría cuatro
artefactos que parecen equivalentes y no lo son.

### 1.1 Qué hace de verdad el `--comprobar` de `rentas`, medido

`rentas` tiene tres piezas y hay que separarlas, porque solo dos aportan una garantía:

| Pieza | Qué compara | ¿Puede fallar por lo que importa? |
|---|---|---|
| `generar-openapi.mjs --comprobar` | el YAML comprometido contra lo que el generador produce **del prototipo del manual** | Sí: caza una edición a mano del contrato |
| `ContratoDeApiTest` | las rutas que **Spring publica** (reflexión sobre los controladores) contra el YAML | **Sí, y es la que vale**: son dos fuentes independientes —el prototipo y el código— |
| `FormasDeLaApiTest` | la forma del `Resource` contra un archivo comprometido | Sí: caza un campo nuevo sin regenerar |

Lo que hace útil a la segunda es que el YAML **no sale del código**: sale de las 134 pantallas del
prototipo (#312). Contrato y servidor son dos afirmaciones de dos sitios distintos, y por eso
pueden discrepar.

### 1.2 Por qué un generador derivado de los controladores sería tautológico

En `catastro`, `normativa` y `caja` no hay prototipo. Un generador que leyera sus controladores
produciría `contrato = f(código)`, y entonces `ContratoDeApiTest` compararía `f(código)` contra
`código`: **no hay dos fuentes, hay una leída dos veces**. Lo único que quedaría vivo es
`--comprobar`, que caza ediciones a mano de un archivo que nadie edita porque nadie lo lee.

Y hay un coste peor que el de no tenerlo: cuatro repositorios con `docs/50-api/openapi/*.yaml` y
`--comprobar` en CI **parecen tener la misma red**. Tres de ellos no la tendrían, y no habría cómo
distinguirlo desde fuera.

### 1.3 Lo que sí sustituye al compilador, y es el punto 2

Lo que P6 necesita no es una descripción de la API: es **una afirmación independiente de lo que la
API tiene que seguir dando**. Y esa afirmación existe, y no sale del proveedor: sale del
**consumidor**, de lo que su adaptador pide y parsea. Eso es lo que se construyó (§2), y la
evidencia de que era el camino correcto es que **encontró nueve desajustes vivos el primer día**
(§2.3) — desajustes que tres YAML derivados de los controladores habrían descrito como correctos,
porque describirían exactamente el estado roto.

### 1.4 Lo que esta decisión deja abierto, dicho

- **`catastro`, `normativa` y `caja` siguen sin una descripción publicada de su API.** Es un hueco
  de documentación, no de seguridad: nadie externo consume esas APIs hoy, y sus dos consumidores
  —`rentas` y, para normativa, también `catastro`— están cubiertos por §2.
- **Producirla es barato el día que haga falta**, y lo es porque `EndpointsPublicados` está ahora en
  la librería compartida: cualquiera de los cuatro sabe enumerar lo que publica. Lo que esta
  decisión fija es que ese YAML sería **descriptivo y no una guarda**, y que hay que decirlo en su
  cabecera para que nadie lo confunda con el de `rentas`.
- **`rentas` conserva el suyo con todo su valor**, y su `--comprobar` sigue en CI: 228 operaciones
  en 205 rutas.

---

## 2. Punto 2 — las pruebas de contrato, en las dos direcciones

### 2.1 El mecanismo, y por qué la prueba vive en el proveedor

`comun-verificaciones/contrato/`, en la librería que los cinco repositorios consumen por *composite
build*:

- **`ContratoDelConsumidor`** — el modelo y el archivo comprometido. El consumidor publica en
  `docs/50-api/contratos-que-consume/<proveedor>.json` lo que pide y lee; el proveedor lo lee del
  clon hermano y lo comprueba **en su propio CI**.
- **`ContratoQueSePublicaTestBase`** — la mitad del consumidor: el archivo tiene que ser el que
  produce su declaración, con el mismo trato que el contrato de la API (#312) — no se edita a mano.
- **`ContratoConElConsumidorTestBase`** — la mitad del proveedor.
- **`EndpointsPublicados`** y **`FormaDeLaRespuesta`**, movidos de `rentas`: desde el corte los
  cuatro necesitan contestar «qué publico yo» y «qué forma tiene».

**La prueba vive del lado del proveedor y ahí está toda la gracia.** Puesta en el consumidor
mediría dos archivos del mismo repositorio —lo que P5E §6.3 se negó a escribir, «se prefiere no
tener guarda a tener una que no puede fallar»— y, sobre todo, el rojo le llegaría a quien no rompió
nada mientras quien rompió algo integra en verde.

### 2.2 Qué se compara, y en qué dirección

Tres cosas, y la dirección de cada una importa:

1. **La respuesta CONTIENE cada campo que el consumidor lee.** Contención y no igualdad: añadir un
   campo no rompe a nadie; quitarlo sí.
2. **Todo parámetro de consulta que el consumidor manda, el proveedor lo LEE.** Es lo que caza el
   desajuste que ninguna otra comprobación ve: la respuesta llega con 200, la tabla se dibuja, y lo
   que se descartó en silencio es el criterio.
3. **Todo campo que el consumidor manda en el cuerpo, el proveedor lo ACEPTA.** Los cuatro backends
   tienen `FAIL_ON_UNKNOWN_PROPERTIES` apagado, así que un campo que el `record` no declara se
   pierde **con 201 de vuelta**: las dos partes creen que llegó.

Y la declaración del consumidor no se cree a sí misma: `LecturaDeCatastroTest` fabrica una respuesta
con **exactamente** los campos que el contrato declara —lo afirma— y la pasa por
`ClienteHttpDeCatastro.ficha`, que es código de producción. Cambiar el adaptador para leer un nombre
que el contrato no declara deja ese campo fuera de la respuesta fabricada y sale un cero.

### 2.3 Los cuatro pares, y los nueve desajustes que ya estaban

| Par | Operaciones | Desajustes vivos |
|---|---:|---:|
| `rentas` → `catastro` | 3 | **7** |
| `rentas` → `normativa` | 2 | **0** |
| `catastro` → `normativa` | 2 | **0** |
| `caja` → `rentas` | 1 | **2** |

**Estas pruebas nacieron rojas, y no por un cambio: las fronteras ya estaban rotas y no había nada
que pudiera verlo.** Los nueve están registrados uno a uno con su texto exacto en
`desajustesVivos()`, y la lista tiene las **dos direcciones cerradas**: uno nuevo pone el build
rojo, y una entrada que ya no ocurre también —una lista de pendientes con entradas rancias deja de
describir nada—. Es el mecanismo que `CrucesConsentidos` usó para el SQL que cruzaba la frontera.

Los siete de `catastro`, con lo que cuesta cada uno:

1. **`FichaEncontradaResource` publica `id` y el adaptador lee `fichaId`.** El síntoma es **mudo**:
   `asLong()` sobre un nodo que falta devuelve 0, así que toda ficha llega a `rentas` con
   `fichaId = 0` y ninguna cifra parece mal.
2. `vigenciaDesde` es `String` aquí y el adaptador lo lee con `LocalDate.parse`. Coinciden por
   casualidad; se registra en vez de arreglarse a ciegas, porque cambiarlo cambia lo que Jackson
   emite para todos sus consumidores.
3. **`?aLaFecha=` contra `@RequestParam fecha`**, que además el controlador **no usa** —resuelve con
   `LocalDate.now(reloj)`—: preguntar por marzo devuelve la ficha de hoy, que es el defecto de #24 y
   #366 servido por HTTP. Este **no** es de nombre: es de comportamiento.
4-5. `soloPredio`/`exceptoPredio` no llegan: la acotación por predio de #631 se pide y vuelve la
   grilla del padrón entero.
6. El cuadro de valores unitarios devuelve un **array plano** y el adaptador itera `contenido`:
   lista vacía con un 200 delante, que se lee como «este ejercicio no tiene cuadro publicado».
7. **`?ejercicio=` contra `@RequestParam int anio`**, obligatorio: sale 400 y el cliente lo traduce a
   `CatastroInalcanzable` — «catastro no responde» donde lo que pasa es que el parámetro se llama de
   otra manera.

Los dos de `rentas` son el mismo hecho: `ComponedorDeEventosJson.pagoAnulado` escribe `motivo` y
`fecha`, y `PeticionDePago` no los declara. **El evento se marca ENTREGADO, el buzón se vacía y el
dato no llegó**, y no hay reintento porque para la caja la entrega salió bien. El motivo de una
anulación es con lo que se explica por qué una deuda volvió a estar viva.

**Ninguno se arregla aquí, y por qué está escrito**: cuál de los dos lados paga la traducción es una
decisión de las dos partes, y el (3) y los dos de pagos no se cierran cambiando un nombre.

Y el que **no** tenía desajustes también dice algo: `normativa` cuadra campo a campo con sus dos
consumidores porque los dos `ClienteHttpDeNormativa` son **el mismo archivo con otro paquete** —22
líneas de diferencia, todas de `import`—.

### 2.4 AC 1, medido

```
### AC 1 — se quita el campo «direccion» de la respuesta de catastro/api/v1/catastro/fichas

--- CI de CATASTRO (proveedor):
2 tests completed, 1 failed
  «catastro» dejo de cumplir lo que «rentas» espera de el. El consumidor no puede verlo:
  su peticion sigue saliendo y su respuesta sigue llegando con 200.
  Expecting empty but was:
    ["GET /catastro/fichas: falta el campo «contenido[].direccion», que el consumidor lee. …",
     "GET /catastro/fichas: falta el campo «contenido[].fichaId», que el consumidor lee. …"]

--- CI de RENTAS (consumidor), con catastro roto:
BUILD SUCCESSFUL

--- restaurando:
RESTAURADO byte a byte
```

**La prueba está del lado correcto.** Y las otras dos mutaciones, sobre el mecanismo:

| Mutación | Resultado |
|---|---|
| Una entrada de `desajustesVivos()` que ya no ocurre | Rojo: «una lista con entradas rancias deja de describir nada: hay que quitar la línea» |
| Declarar «serializado a mano» una operación que devuelve su `Resource` | Rojo: «eso la sustituiría por otra, y entonces esta prueba afirmaría algo que el backend no publica» |

La segunda guarda un gancho que hacía falta: `SnapshotController.snapshot` devuelve
`ResponseEntity<String>` para calcular su `ETag`, así que su tipo de retorno es «texto» y no
describe nada. El proveedor declara qué tipo escribe de verdad — y sin ese contraste sería una
puerta para afirmar cualquier forma.

### 2.5 Lo que esta comprobación NO puede ver, dicho

El consumidor de `normativa` verifica una **huella**: el cuerpo tiene que ser **byte a byte** el que
se selló. Reordenar las claves de `SnapshotResource` rompe la descarga sin cambiar un solo campo, y
ninguna comparación de formas lo ve. Está escrito en el javadoc de `ContratoConRentasTest` de
`normativa`.

---

## 3. El coste que el corte impone a CI, y lo que se hizo

Cada proveedor tiene que leer el archivo del consumidor, y los clones son hermanos. Se añadió a los
tres `backend.yml` un `actions/checkout` del consumidor con **`sparse-checkout` de un solo
directorio**: lo único que hace falta es el archivo, y traer el repositorio entero por dos kilobytes
sería pagar el clon de otro sistema en cada corrida.

`ContratoDelConsumidor.leer` **se niega a saltarse**: si el archivo no está, lanza diciendo dónde
tendría que estar y por qué. Una prueba de contrato que no encuentra su contrato y pasa en verde es
peor que ninguna.

---

## 4. Punto 4 — la anti-entropía

### 4.1 La escalera, y por qué es una escalera

`catastro` publica `GET /catastro/predios/huellas`: **sin** `detalle`, una cifra por sector; **con**
`detalle=true` y un `sector`, los lotes de ese sector. En Catacaos son 14 422 predios: comparar lote
a lote sería leer el catastro entero cada día por los dos lados, y comparar solo el resumen no diría
nunca cuál lote difiere. Con la escalera, el caso normal cuesta decenas de cifras y el caso malo
cuesta un sector.

**No publica ni un dato del predio** —ni dirección, ni código, ni titular—: solo identificadores y
huellas. Una anti-entropía no necesita ver el dato para saber que dos lados no cuadran, y publicarlo
convertiría esa ruta en una segunda forma de leer el padrón entero, con otro permiso y sin paginar.

### 4.2 El algoritmo de la huella es, él mismo, un contrato entre dos repositorios

Los dos lados calculan por su cuenta sobre dos bases. Si los dos cálculos no son idénticos hasta el
byte, la comparación **no falla ruidosamente**: o todos los sectores salen discrepantes —y entonces
la anti-entropía deja de leerse en una semana— o ninguno, y entonces no protege nada y nadie lo
sabe. Ninguna de las dos se parece a su causa: las dos se leen como un problema de datos y son un
problema de código.

Por eso el algoritmo está fijado con **vectores de oro comprometidos**
(`rentas/docs/50-api/anti-entropia/huella-del-lote.json`) que las dos implementaciones reproducen,
cada una en su CI. Los publica `rentas` y solo `rentas`: si los dos pudieran regenerarlos, quien
cambiara el algoritmo regeneraría el archivo y el rojo se convertiría en un diff que alguien acepta.

Los casos fijan cada decisión: un lote **sin sector** (el nulo es la cadena vacía), **dos lotes cuyos
campos concatenados sin separador dan lo mismo** —con una aserción aparte que exige que sus huellas
difieran, para que quitar el separador no pueda regenerar un archivo distinto pero coherente—, un
sector con **tres** lotes **y su inverso** (el orden), y una dirección con tildes y «ñ» (UTF-8).

Y la huella se calcula **en Java y no en SQL** en los dos lados, aunque PostgreSQL sepa hacerlo y
saldría una consulta en vez de un recorrido: dos implementaciones —una en SQL, otra en Java— son dos
sitios donde el separador, el orden o la codificación pueden divergir.

### 4.3 AC 2, medido

`AntiEntropiaJdbcTest`, **5 pruebas contra PostgreSQL 16.15 real conectado como `sgtm_app`**, con la
proyección sembrada por `rol_ingestor_catastro` —`V4` solo le da `SELECT` a `sgtm_app`, y una prueba
que sembrara con la conexión de la aplicación estaría midiendo un sistema que no es el que se
despliega—.

El escenario tiene **tres sectores y uno sin sectorizar**, y no uno solo a propósito: con un sector,
«encuentra la discrepancia» y «dice que todo discrepa» dan el mismo resultado y son lo contrario.
Nombrar el sector solo significa algo si los demás callan.

Se cambia la dirección de **un** predio del sector `SB` en el origen y la proyección se queda con la
vieja:

```
sector «SB»: las huellas no cuadran (2 lotes en catastro, 2 en la proyeccion)
```

y los otros tres callan. Los recuentos coinciden, que es la distinción entre «se perdió un evento» y
«se aplicó uno con otro contenido» — se arreglan distinto.

| Mutación | Resultado |
|---|---|
| Comparar el `sector` en vez de la `huella` | **2 en rojo**: la fila desincronizada pasa inadvertida |

Y el verde de partida tiene dos mitades que no sobran: el **centinela** de #545 —con `FORCE ROW
LEVEL SECURITY` el dueño también queda sujeto a la política, así que una prueba escrita con
`sgtm_owner` pasaría en verde con el aislamiento roto— y que se hayan comparado **4** sectores,
porque «0 de 0» y «0 de 4» se leen igual en un booleano y la primera es que nadie comparó nada.

### 4.4 El trabajo programado, y lo que no está

`CorrerLaAntiEntropia` es un `ApplicationRunner` del perfil `batch`, **y no un `@Scheduled`**, y eso
se midió antes de elegir: en los cuatro backends no hay **ni un** `@EnableScheduling` —Spring Boot no
lo activa por autoconfiguración, así que el único `@Scheduled` que existe, el publicador del buzón de
`caja`, tampoco se registra— y el perfil `batch` **termina el proceso** (`System.exit`) con
`web-application-type: none`. Un proceso que sale no puede sostener un temporizador.

Así que se hace como todo lo demás que corre por lotes aquí, y un `CronJob` lo invoca: «diaria, y
siempre antes de una emisión» son dos invocaciones del mismo proceso. **Ese `CronJob` no está
desplegado** (§7, hueco 3).

Y **no corrige nada**, deliberadamente: una anti-entropía que reparara sola escribiría la proyección
desde una comparación, y la fila dejaría de poder decir qué evento la escribió — que es lo único que
`V9` existe para garantizar (P5E §8).

---

## 5. Punto 3 — el tablero de las seis cifras

### 5.1 El defecto que este punto existe para no tener

Un tablero de seis cifras en cero se lee de una sola manera: todo va bien. Y hay **dos** maneras de
estar en cero que se dibujan igual y significan lo contrario — «no pasa nada» y «nadie alimenta esa
serie». La segunda es no tener defensa y creer que se tiene.

La regla que se aplica es la misma que el frontend usa con el guion largo: **una cifra sin emisor no
se dibuja como cero**. `noValue` de Grafana pinta su motivo en el sitio del valor.

### 5.2 El censo: cuál es real y cuál no

Medido sobre el código de producción de los cuatro repositorios **antes** de escribir el catálogo:

| # | Cifra | Sistema | Fuente | Estado |
|---|---|---|---|---|
| 1 | Retraso máximo del outbox | `caja` | `pago_evento`, escrita por `BuzonDeSalidaJdbc` en la **misma transacción del cobro** | **REAL** |
| 2 | Predios con valuación del ejercicio faltante | `rentas` | `predio_ref` / `valuacion_predio` | **SIN EMISOR** |
| 3 | Lotes (sectores) con huella discrepante | `rentas` | la anti-entropía de §4 | **SIN EMISOR** |
| 4 | Eventos en la cola de mensajes muertos | `caja` | `pago_evento` en estado `MUERTO` | **REAL** |
| 5 | Turnos de caja cerrados con diferencia | `caja` | `cierre_turno.diferencia` | **REAL** |
| 6 | Determinaciones cuyo conjunto no es el de la corrida | `rentas` | `determinacion.conjunto_id` vs `corrida_predial.conjunto` | **REAL** |

**Cuatro tienen emisor y dos no.** Las dos que no:

- `INSERT INTO predio_ref` / `valuacion_predio` aparece **solo** en `src/test` y `src/testFixtures`;
  `catastro` no emite ningún evento —no tiene outbox, ni `@Scheduled`, ni cliente que publique— y
  `rol_ingestor_catastro`, el único rol que puede escribirlas, no tiene todavía ningún proceso que lo
  use (P5C hueco 3).
- La anti-entropía **existe desde hoy** y compara contra esa misma proyección: hoy diría «todos los
  sectores faltan en la proyección», que es cierto y no es lo que esa cifra quiere decir.

La sexta merece una nota: `V2__baja_de_parametros` **retiró la clave foránea** entre
`determinacion.conjunto_id` y el conjunto sellado al irse `conjunto_parametros` a `normativa`. Esa
cifra es lo único que queda mirando esa unión.

### 5.3 Por qué ninguna sale hoy por Prometheus, y no es una línea que falte

- **No hay un solo uso de `MeterRegistry`** en `src/main` de los cuatro backends: solo las métricas
  de JVM y HTTP que la autoconfiguración publica. Y el proceso donde vive el publicador del buzón
  corre con perfil `batch`, que tiene `web-application-type: none` y **no sirve `/actuator` en
  absoluto**.
- **Y no se resuelve por el otro lado**, dándole consultas propias al `postgres_exporter`: ese
  sidecar se conecta como `sgtm_monitor`, que tiene `pg_monitor` y **ningún `SELECT`** sobre una
  tabla de negocio; dárselo sería darle una credencial capaz de leer el padrón entero. Y aunque se
  le diera, las tablas llevan RLS con `FORCE`: una consulta sin contexto de tenant **no devuelve
  vacío, revienta**, y un agregado entre municipalidades es exactamente lo que la política existe
  para impedir.

Quien puede publicar estas cifras es **cada aplicación**, recorriendo el registro de municipalidades
con un `SET LOCAL` por rama — que es como ya lo hace el portal del ciudadano. Eso no se construyó
(§7, hueco 4).

### 5.4 AC 3, medido hasta donde se puede

Se aplicaron los esquemas de `caja` (25 tablas) y `rentas` (112 tablas) desde sus migraciones a
PostgreSQL 16.15 real y se ejecutaron las consultas del catálogo. **Las cinco corren contra el
esquema real** —lo que convierte «esta cifra no tiene emisor» en una afirmación comprobable y no en
una intención— y **no siempre dan cero**:

```
1. retraso maximo del outbox (caja, segundos): 0    → 2700  (con un PENDIENTE de hace 45 minutos)
4. eventos en la cola de muertos (caja):       0    → 1     (con uno MUERTO sembrado)
5. turnos cerrados con diferencia (caja):      0    → 1     (con un cierre con faltante de 20,00)
2. predios sin valuacion 2026 (rentas):        0          (la tabla no la llena nadie)
6. determinaciones de otro conjunto (rentas):  0
3. sectores con huella discrepante:            no es una consulta de una base (cruza dos sistemas)
```

Los 2 700 segundos están **por encima del umbral de 600**, así que esa alerta se dispararía.

**Lo que no se pudo medir**: el tablero *pintado*. Hacen falta Grafana y Prometheus levantados y,
sobre todo, un emisor de las series. Lo que se sujeta en su lugar es que el tablero sea el que el
catálogo produce, que tenga un panel por cifra y ninguno de más, y que **una cifra sin emisor dibuje
su motivo y no un cero**.

### 5.5 «Cada alerta va a una persona con nombre»

Es lo que el enunciado pide y lo que `alertas.yml` **no tenía**: sus doce reglas llevan `runbook`
—que dice **qué** hacer— y ninguna dice **a quién**. Las seis nuevas llevan `responsable`, y una
guarda exige que ninguna se quede sin él.

Y cada cifra lleva **dos** reglas: la del umbral y una de **`absent()`**. La segunda es la lección de
#156 con `pg_up`, que costó descubrirla ejecutando: cuando el emisor cae, la serie **no pasa a cero,
deja de existir**, y una regla que solo mirara el valor nunca llegaría a `firing`. Con las seis
series hoy inexistentes, la de ausencia es además la única que puede disparar.

| Mutación | Resultado |
|---|---|
| Declarar «viva» una cifra que nadie emite | **3 en rojo**: el censo, el tablero y las reglas — los tres se derivan del catálogo |

---

## 6. `deriva-de-migraciones`: el rojo que no era de deriva

Las seis pruebas rojas **no eran una versión desactualizada**: era una premisa que el corte volvió
falsa. La guarda de #675 resolvía `applicationBootstrapVersion` «en el repositorio en que vivo», que
en `sgtm` era correcto porque el stack, el `sha` y las migraciones compartían `git log`.

Medido:

- **`c755de21…` es un commit de `sgtm`**, está en su `origin/main` y trae **las mismas 68**
  migraciones que `sgtm origin/main` declara. O sea que **no había deriva**.
- La historia de `infrastructure` empieza en su propio commit inicial, y su `backend/sgtm-esquema/`
  es una **copia histórica que nadie aplica** (su `CLAUDE.md` lo dice). Comparar `origin/main` de
  aquí contra un `sha` de allí cruza dos cosas que no se pueden comparar.

**La resolución**: la versión que un ambiente declara es una revisión **del repositorio que construye
la imagen del migrador que ese ambiente corre**, y ese repositorio no tiene por qué ser este.
`SISTEMAS` dice de cada uno dónde vive su esquema, y `sistemasDesplegados` lo **deriva de los
manifiestos** —de la imagen de cada contenedor— en vez de creérselo.

Hoy el despliegue construye **un solo** `*-migrador`, y una sola línea de configuración solo puede
fechar un `git log`. El día que construya el segundo, `unicoSistemaDesplegado` lanza nombrando el
problema, **antes** de que nadie mida una deriva contra el repositorio equivocado.

| Mutación | Resultado |
|---|---|
| Devolver el clon de `sgtm` a `.` (volver a medir contra este repositorio) | **9 en rojo** |
| Un segundo migrador en los manifiestos (el reparto de P7, sin declarar su versión) | **12 en rojo**, dos nombrando el censo |

De paso, el otro rojo heredado: `reservar-recursos-del-nodo.sh` deja de usar `sed -i -e`, que es
sintaxis **GNU** —el `sed` de macOS lee el `-e` como la extensión del respaldo—. El guion corre
contra un nodo Linux, así que el defecto no llegaba a producción; lo que dejaba en rojo era la prueba
que lo **ejecuta** en la máquina de quien desarrolla, y una prueba que solo pasa en un sistema
operativo deja de mirarse.

**Y una mitad de #675 la se lleva el corte, declarada**: un filtro `paths` solo puede nombrar rutas
de su repositorio, así que una migración de `sgtm` —o mañana de `rentas`— **no puede disparar el
flujo de `infrastructure`**. Las entradas que siguen en `infra.yml` vigilan la copia histórica, que
nadie modifica, así que hoy no pueden dispararse. Cerrarlo pide un disparo entre repositorios
(`repository_dispatch`) y no está hecho.

---

## 7. Huecos declarados

1. **Testcontainers no se usó, y es el camino que corre en CI.** Todo corrió contra un PostgreSQL
   **16.15 real** en `127.0.0.1:55444`, con RLS, `FORCE ROW LEVEL SECURITY` y los roles de verdad,
   pero no por Testcontainers: el demonio de Docker es un túnel a un VPS, el contenedor arranca allí
   y su puerto se publica allí. Mismo hueco que P3, P4, P5A, P5B, P5C, P5D y P5E.

2. **Ningún CI remoto se ejercitó: aquí no se empuja nada.** El AC 1 se reprodujo **en local**,
   corriendo en cada repositorio la tarea que su CI correría (`:kamayuk-<sistema>-aplicacion:test`),
   y por eso se puede afirmar de qué lado cae el rojo. Lo que **no** se ha ejecutado es el
   `actions/checkout` del consumidor que se añadió a los tres `backend.yml`: está escrito y no
   probado.

3. **El `CronJob` de la anti-entropía no está desplegado**, y no puede estarlo: `infra/` despliega
   hoy **un solo sistema** —el monolito— y ninguno de los cuatro del corte tiene manifiesto. Lo que
   queda construido es el proceso y su forma de invocarse; su horario es de P7.

4. **Ninguna de las seis cifras tiene emisor de métricas**, y las dos de la proyección no tienen
   siquiera datos. §5.3 mide por qué no es una línea que falte: hace falta que cada aplicación las
   publique recorriendo el registro de municipalidades, y que el proceso que las publique sirva
   `/actuator`.

5. **Los tres contratos OpenAPI de `catastro`, `normativa` y `caja` no se construyeron**, y §1 es la
   decisión con su motivo. Lo que queda abierto es que esas tres APIs no tienen descripción
   publicada.

6. **Los nueve desajustes de frontera siguen vivos.** *(Cerrado por **C-1**, 2026-09-04:
   `desajustesVivos()` queda vacío en los dos archivos. La decisión de cada uno, con quién pagó la
   traducción y su mutación, en [`C-1-desajustes-de-frontera.md`](C-1-desajustes-de-frontera.md) —que
   además corrige dos afirmaciones de este documento: `ConsultaController` **sí** usa su parámetro
   de fecha, y el motivo de la anulación **no** sobrevivía en el `cuerpo` jsonb.)* Están
   registrados con nombre y no pueden
   crecer en silencio, pero **no se arreglaron**: cuál de los dos lados paga la traducción es una
   decisión de las dos partes, y tres de los nueve no se cierran cambiando un nombre.

7. **La comprobación de contrato no ve el orden de las claves**, y para `normativa` eso importa: su
   consumidor verifica una huella sobre el cuerpo, así que reordenar `SnapshotResource` rompe la
   descarga sin cambiar un campo.

8. **`infra.yml` gana un `actions/checkout` de `sgtm`** para que la deriva pueda medirse en CI. No se
   ha ejecutado, por el hueco 2.

9. **Las cinco consultas de las cifras se midieron a mano contra los esquemas reales, no desde una
   prueba.** El SQL vive en TypeScript (`infra/observabilidad/`) y el esquema en Java; atarlos pide
   que el emisor exista, que es el hueco 4. Lo que hoy sujeta el catálogo es que su clasificación no
   pueda quedarse rancia, no que su SQL corra en CI.
