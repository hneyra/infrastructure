# C-8 — El ingestor de eventos: de `catastro` a la proyección de `rentas`

> **Estado:** el camino de la valuación y de la proyección del padrón está **construido y medido de
> extremo a extremo** contra PostgreSQL 16.15 real. Las dos cifras del tablero que P6 dejó «sin
> emisor» pasan a tener uno. Lo que queda sin cerrar está en §9, y lo más caro de esa lista es que
> **el `CronJob` que invoca las dos mitades no está desplegado**, igual que el de la anti-entropía.

---

## 1. El defecto, y por qué era más grande que su enunciado

P5C dejó **la mitad receptora entera** —`catastro_evento_aplicado`, `predio_ref`, `ficha_ref`,
`valuacion_corrida`, `valuacion_predio`, el rol `rol_ingestor_catastro` que las escribe, la
procedencia por fila de `V9` y el candado de ADR-0027 §2— y **nada al otro lado**. Medido antes de
escribir una línea: en `catastro/backend` la palabra «evento» aparecía en **un** archivo y era un
javadoc; `ValuacionDePredioPublicada` no aparecía en ninguno de los seis repositorios.

Lo que eso costaba no era un hueco de forma:

- **El candado no se podía abrir nunca.** `CandadoDeEmision` comprueba tres cosas antes de que
  `DeterminarPredialMasivo` recorra un contribuyente, y las tres salen del cierre de corrida que
  `catastro` emite. Sin emisor, la primera —«no hay cierre»— era permanente.
- **Dos de las seis cifras del tablero del corte** se dibujaban con su motivo en vez de con un
  número (P6 §5.2).
- **La anti-entropía comparaba contra filas que nadie escribía**, así que su respuesta correcta era
  «todos los sectores faltan», que es cierto y no es lo que esa comprobación quiere decir.

---

## 2. El transporte: **outbox transaccional + feed HTTP que el consumidor viene a buscar, con acuse**

### 2.1 Lo que se midió antes de elegir

| Qué se midió | Resultado | Qué descarta |
|---|---|---|
| Broker en el stack | **Ninguno.** El nodo lleva PostgreSQL, Keycloak, Traefik y cuatro aplicaciones (ADR-0031) | Kafka, RabbitMQ, NATS: una pieza más que nadie opera, con D-25 abierta |
| `@EnableScheduling` en los cuatro backends | **Cero.** El único `@Scheduled` del sistema —el publicador del buzón de `caja`— **no se registra** (P6 §4.4) | Un temporizador dentro del proceso web |
| El perfil `batch` | Termina el proceso (`System.exit`), `web-application-type: none` | Un temporizador dentro del proceso batch |
| `GRANT` de `sgtm_app` sobre las cuatro proyecciones (`V4`, `V5`) | **Sólo `SELECT`** | Un endpoint de este lado que reciba empujones |
| `GRANT` de `sgtm_app` sobre `pago_recibido` (`V8`) | `INSERT, SELECT, UPDATE` | — (por eso `caja` **sí** puede empujar) |

### 2.2 La decisión, y por qué no es la misma que la de `caja`

`caja` → `rentas` **empuja**. `catastro` → `rentas` **se viene a buscar**. La diferencia no es de
gusto: **la decide un privilegio**, y es la última fila de la tabla de arriba.

El receptor de un pago escribe `pago_recibido`, y `sgtm_app` tiene `INSERT` sobre ella: el proceso
que atiende HTTP **puede** recibir. El receptor de estos hechos escribe `predio_ref`, `ficha_ref`,
`valuacion_predio` y `valuacion_corrida`, y `sgtm_app` **sólo tiene `SELECT`**. Quien las escribe es
`rol_ingestor_catastro`, que no atiende peticiones. Un endpoint que recibiera empujones tendría que
llevar esa credencial dentro del proceso web — y entonces «la proyección es de sólo lectura para la
aplicación» dejaría de ser un privilegio y volvería a ser **disciplina**, que es exactamente lo que
la cabecera de `V4` dice que no quiere ser.

Así que el mecanismo es **el mismo** que ADR-0026 §3 ya bendijo —un outbox con estado por fila, una
transacción por hecho, entrega al menos una vez y deduplicación en el receptor— y lo único que
cambia es quién inicia. La forma se reutiliza; la dirección la impone el motor.

### 2.3 Por qué hay acuse y no un cursor

Un consumidor con cursor —«dame lo que tenga secuencia mayor que *N*»— **pierde eventos en
silencio**, y no es hipotético: `catastro_evento.id` se asigna al `INSERT` y no al `COMMIT`, así que
una transacción que tomó el 100 y confirma después de otra que tomó el 101 queda por detrás de un
cursor que ya pasó por 101. La fila está, el consumidor no la verá nunca, y nada lo dice.

Con un **estado** no hay posición que adelantar: lo pendiente sigue pendiente hasta que alguien lo
acuse, confirme cuando confirme. El acuse va **después** del `COMMIT` del receptor, así que un acuse
perdido reentrega — y quien deduplica es el receptor, por `evento_id`, igual que `caja` dice de su
`pagoId`.

```
catastro                                             rentas
────────                                             ──────
  acto del padrón ─┐
                   ├─ [COMMIT 1] predio/ficha + catastro_evento (outbox)
                   ┘
                        GET  /catastro/api/v1/catastro/eventos   ◄── CorrerElIngestor (batch)
                                                                     conectado como
                                                                     rol_ingestor_catastro
                                                     ├─ [COMMIT 2] catastro_evento_aplicado
                                                     │             + predio_ref / ficha_ref
                                                     │             / valuacion_predio / _corrida
                        POST …/eventos/acuse         ◄──┘  (después de confirmar)
```

---

## 3. El emisor: `catastro`

`V5__buzon_de_salida.sql` estrena **una tabla y una secuencia**, y nada más. Se consideró replicar
aquí `valuacion_corrida` y `valuacion_predio` —el espejo de `V5` de `rentas`— y **no se hace**: el
outbox ya es ese registro, con el cuerpo congelado y sin `DELETE` (regla 4). Duplicarlo dejaría
**dos verdades** sobre el mismo hecho, que es el reparto que #397 rechazó para el «Estado» de la
infracción administrativa y #481 para el uso hallado.

### 3.1 La identidad de un hecho se deriva, y **los tres tipos no la derivan igual**

| Tipo | Identidad derivada de | Por qué |
|---|---|---|
| `PREDIO_PROYECTADO` | tipo, municipalidad, predio, **huella del contenido** | Reproyectar el padrón entero cuesta, del lado del receptor, **exactamente los predios que cambiaron** |
| `CORRIDA_CERRADA` | tipo, municipalidad, ejercicio, **corridaId** | Dos corridas del mismo ejercicio **son** dos hechos aunque den el mismo resultado, y el receptor sustituye su cierre por el último |
| `VALUACION_PUBLICADA` | tipo, municipalidad, ejercicio, **predio** — y **no** el contenido | Es un hecho **sellado**: que la misma identidad vuelva con otro contenido no es un hecho nuevo, es el emisor reescribiendo uno sellado, y **tiene que verse** |

La tercera es la que decide algo. Con la identidad derivada del contenido, una valuación reescrita
llegaría como un evento más y lo que fallaría sería la clave primaria de `valuacion_predio` diciendo
«ya hay una» — cierto, y no la causa. Derivada de la identidad, el receptor compara la **huella** que
`V9` le hizo guardar y dice lo que de verdad pasó.

> **Y la del cierre se derivó del contenido en una primera versión, y no funciona.** El cuerpo del
> cierre lleva el `corridaId`, que cambia en cada corrida: dos corridas idénticas salían como «la
> misma identidad con otro contenido», o sea el aviso de hecho sellado reescrito disparado por dos
> corridas que no reescribieron nada.

### 3.2 Hoy **ningún predio se valoriza**, y eso no es una limitación del código

`ValorizacionDelPredio` es una **función pura** (regla 6) y devuelve siempre «no se pudo», nombrando
el primer insumo que falta, en este orden: sin ficha vigente a la fecha de corte → sin cuadro de
valores unitarios (GOB-03 H-14) → sin depreciación (H-15) → sin arancel de la vía (D-02b) → **el
`% actualización`, que sigue sin fuente identificada (D-11)**.

La última rama es la que se alcanza cuando todo lo demás está cargado, y es deliberada: ese factor
incrementa el autovalúo de **todo el padrón** —su valor neutro es **cero**, no uno, que es lo que
#437 midió contra la captura del manual— y las reglas que lo llevan no se implementan **ni
estructuralmente**. Lo que esta clase hace es lo único honesto: decir **qué llave publicar**, para
que quien opera no reciba un cero.

`valuacion_predio_cifra_o_motivo_ck` de `V5` de `rentas` ya estaba escrita para esto: **o las cuatro
cifras, o el motivo**. Un cero es indistinguible de un predio que de verdad no vale nada (#48).

---

## 4. El ingestor: `rentas`

- **Se conecta con `rol_ingestor_catastro`**, en su propio pool (`PoolDeUnRol`, nuevo en
  `plataforma`), con el mismo `TenantTransactionManager` —el `SET LOCAL`— y el mismo
  `TenantConnectionGuard` que el de la aplicación.
- **Una transacción por hecho** (`AplicarUnHecho`, `REQUIRES_NEW`, clase aparte del bucle). Envolver
  el bucle es el defecto que #328, #54, #430 y #247 §2 midieron cuatro veces; ponerlo en la misma
  clase que el bucle es el de auto-invocación que #430 midió con `ImportarCajas`.
- **`V12` estrena `catastro_evento_muerto`**, la cola de mensajes muertos. No es un estado de
  `catastro_evento_aplicado` porque esa tabla significa «este hecho **está** aplicado» y `V9` le
  colgó cuatro claves foráneas: cada fila proyectada nombra el evento que la escribió.

### 4.1 Los dos fallos no se tratan igual

| Qué pasó | Qué se hace | Por qué |
|---|---|---|
| `catastro` no contesta | se corta la vuelta, **sin acusar nada** | Se arregla levantando un despliegue y va a arreglarse solo |
| El hecho no se puede aplicar | se aparta, **se acusa** y se avisa a una persona con nombre | Reintentarlo no lo arregla y **bloquea la cola detrás de él**: la proyección se quedaría congelada sin un solo error visible |

Es la separación `NoContesta`/`Rechazado` de `caja`, leída desde el receptor.

### 4.2 La alerta **se entrega**, y esa es la diferencia con P5D

P5D dejó su alerta declarada como «construida y **no medida**»: `AlertaEnElRegistro` es exactamente
un log, y su canal es texto libre. Aquí `ResponsableDeLaProyeccion` **exige una dirección `http(s)`**
y `AlertaAlCanalDelResponsable` hace un `POST` a ella **además** de registrar en ERROR. Lo que esa
exigencia cuesta hay que decirlo: un municipio con sólo un correo tiene que poner delante algo que
reciba un `POST`. A cambio, «avisa a una persona con nombre» deja de ser una frase del javadoc — y
se mide ejecutándolo, contra un servidor de verdad (§6, AC 6).

---

## 5. El camino entero, medido

### 5.1 Qué es real aquí y qué no

**Real:** los hechos son los que `catastro` emitió de verdad —los publica su propia prueba, con su
serialización, desde su propia base—; el transporte es **HTTP de verdad**, con el cliente de
producción contra un servidor local sobre `ServerSocket`; la escritura va contra **PostgreSQL 16.15
real**, conectada como `rol_ingestor_catastro` y con RLS activa; y la huella agregada que el candado
compara **la calculó el otro repositorio en Java** y la calcula éste **en SQL**.

**No real:** la autenticación. El servidor local no valida el token, así que lo que no se mide es el
`@RequiereAcceso` del emisor ni el intercambio de token de ADR-0028 §2. Mismo hueco que P5B, P5C y
P5D declararon (§9).

### 5.2 El archivo de hechos lo publica **el emisor, y sólo el emisor**

`catastro/docs/50-api/eventos/lote-de-eventos.json`, escrito por `PublicacionDelPadronJdbcTest`.
`rentas` lo **lee** y no lo regenera: si pudiera, quien cambiara la forma del evento regeneraría el
archivo y el rojo se convertiría en un diff que alguien acepta. Es el reparto de los vectores de oro
de la huella (P6 §4.2) con los papeles cambiados, porque aquí el que emite es el otro.

### 5.3 Los recuentos

De la municipalidad del lote —dos predios, cinco versiones de ficha, un conjunto sellado, arancel,
cuadro de valores unitarios y depreciación sembrados—:

```
catastro (emisor)                     rentas (receptor, tras las tres vueltas)
─────────────────                     ───────────────────────────────────────
catastro_evento         5             catastro_evento_aplicado   5
  PREDIO_PROYECTADO     2             predio_ref                 2
  VALUACION_PUBLICADA   2             ficha_ref                  5
  CORRIDA_CERRADA       1             valuacion_predio           2
corridaId: de catastro_corrida_seq    valuacion_corrida          1   (conteo 2)
huella agregada: sha256 de las 2      catastro_evento_muerto     0
```

Y el candado, en las tres situaciones que ADR-0027 §2 distingue:

| Estado | Lo que dice |
|---|---|
| Predios y valuaciones aplicados, **sin cierre** | `ValuacionSinCerrar`: «`catastro` no ha cerrado su corrida de valuación» |
| Cierre aplicado y **falta una valuación** | `ValuacionIncompleta`: «cerró su corrida con **2** valuaciones y aquí han llegado **1**. **Faltan 1**» |
| Las dos puestas | **Abre**, con `conteo = 2` |

**Que el tercero no lance es, por sí solo, la prueba de que la huella agregada que `catastro`
calculó en Java es la que `rentas` calcula en SQL.** Si las dos no coincidieran hasta el byte,
saldría `ValuacionQueNoCuadra` y la emisión quedaría bloqueada **para siempre** por un defecto de
código que se lee como uno de datos.

---

## 6. Las mutaciones, una a una

Cada una se aplicó **sola** sobre `src/main`, se ejecutó contra PostgreSQL 16.15 real, y se restauró
**por copia comparada byte a byte** con `cmp` (#425).

| # | Mutación | Resultado |
|---|---|---|
| M8 | **El separador de la huella agregada, de `,` a `;`** en `catastro` | **Las seis pruebas de `catastro` siguen VERDES**, y en `rentas` el candado se cierra: `ValuacionQueNoCuadra`, con las dos huellas dentro. Es el modo de fallo que P6 §4.2 describe: la divergencia no falla ruidosamente en ningún lado por separado |
| M1 | La deduplicación, de **índice único** a **comprobar-y-escribir** | Rojo el AC 2 con **nueve hilos reventando**: sin el `ON CONFLICT`, los nueve que pierden la carrera salen con `23505` en vez de decir «ya estaba» — y en el ingestor de verdad eso son **nueve muertos y nueve alertas** por un hecho que se aplicó bien |
| M2 | Quitar `WHERE predio_ref.secuencia < EXCLUDED.secuencia` | Rojo el AC 3: el hecho viejo **pisa** al nuevo y el resultado deja de poder decirlo |
| M3 | Quitar la comparación de huella del buzón (`V9`) | Rojo: el emisor reescribiendo un hecho sellado **se descarta en silencio** por deduplicación |
| M4 | El muerto **no se acusa** | Rojo el AC 6: apartado pero no acusado, el hecho imposible se vuelve a servir para siempre y bloquea la cola detrás de él |
| M5 | El canal del responsable deja de exigir una dirección entregable | **0 en rojo la primera vez** — la batería de ingestión configura una dirección `http` de verdad, así que la guarda no llega a dispararse. Se cierra con `ResponsableDeLaProyeccionTest`, y entonces muerde |
| M7 | Declarar «sin emisor» una de las dos cifras que ya lo tienen | **3 en rojo** en `infrastructure`: el censo, el tablero y las reglas — los tres se derivan del catálogo |

### 6.1 Y **una prueba no podía fallar, y se descubrió ejecutándola**

La primera versión del lote publicado tenía **un solo predio**. Con uno, la huella agregada es
`String.join(separador, [x])`, que vale `x` **se ponga el separador que se ponga**: la mutación M8
—la del contrato entre los dos repositorios— dejó **las cinco pruebas de ingestión en VERDE**,
candado incluido. Es la misma clase de hallazgo que P6 §4.3 con «0 de 0 y 0 de 4 se leen igual» y
que #536 con una sola municipalidad en la prueba de plan. El lote publicado tiene **dos** predios
desde entonces, y las dos pruebas lo exigen con su motivo escrito al lado.

### 6.2 Lo que encontró **ejecutar**, sin ninguna mutación

1. **La cola de muertos no podía guardar un muerto.** `catastro_evento_muerto.cuerpo` nació `jsonb`,
   y una de las tres causas de muerte es precisamente **que el cuerpo no sea JSON**: el `INSERT`
   fallaba con «invalid input syntax for type json». La única tabla que existe para guardar lo que no
   se pudo leer no podía guardar exactamente lo que no se pudo leer. Es `text`, con el motivo escrito
   en la migración.
2. **La fecha de corte decide qué ficha rige, y el corte «obvio» no sirve.** Con `2025-12-31` —el que
   uno teclea— la valuación sale «el predio no tiene ficha catastral vigente», que es **correcto**:
   la ficha del escenario empieza el 2026-01-01.
3. **Reprocesar la cola no repara una fila borrada fuera del sistema.** Se intentó reponer una
   valuación borrada por SQL directo reentregando su hecho, y el buzón dice que ese evento **ya se
   aplicó**: no se vuelve a escribir. La reparación es publicar otra corrida, no reprocesar.
4. **El lote publicado no era entrada declarada de `test`.** Cambiar el algoritmo de la huella en
   `catastro` y republicar el archivo dejaba `:kamayuk-rentas-nucleo:test` en **UP-TO-DATE**: BUILD
   SUCCESSFUL sin ejecutar una prueba. Es la lección de #192 punto 2, tercera vez en este proyecto;
   ahora está declarado en `build.gradle.kts` con su motivo.
5. **`catastro_evento_predio_ck` mordió antes que ninguna prueba.** La siembra de aislamiento se
   escribió como `PREDIO_PROYECTADO` con `predio_id` nulo y la rechazó el motor, en las cuatro clases
   que la usan — la primera vez que ese `CHECK` vio una fila.
6. **La fila de la siembra de aislamiento nace `ENTREGADO`**, y también lo dijo ejecutar: pendiente,
   toda prueba que lea el buzón se encuentra dentro un hecho de mentira que no produjo.
7. **`com.sun.net.httpserver` está prohibido por Checkstyle**, con razón. `EmisorDeMentira` ya había
   resuelto esto antes con un `ServerSocket` pelado; `ServidorDeMentira` copia su forma en vez de
   abrir una excepción a la regla.

---

## 7. Las cifras del tablero

Las dos que P6 §5.2 declaró **sin emisor** pasan a `viva`:

| # | Cifra | Antes | Ahora |
|---|---|---|---|
| 2 | Predios sin valuación del ejercicio | sin emisor | **viva** — el ingestor de C-8 escribe `predio_ref` y `valuacion_predio` |
| 3 | Sectores con huella discrepante (24 h) | sin emisor | **viva** — `CorrerLaAntiEntropia` compara contra una proyección que ahora alimenta alguien |

`cifrasSinEmisor()` queda **vacía**, y el censo lo fija una prueba: cuando eso se ponga rojo, lo que
hay que hacer no es actualizar el número sino leer qué cifra cambió de lado.

**Lo que esto NO cierra**: ninguna de las seis sale todavía por `/actuator/prometheus` — no hay un
solo uso de `MeterRegistry` en `src/main` de los cuatro backends (P6 §5.3, hueco 4 de P6). Lo que
cambia con C-8 es que las dos series **tienen de dónde salir**; publicarlas sigue pendiente.

---

## 8. Cifras y barreras

| Repositorio | Pruebas antes de C-8 | Después | `build` | `verificarArquitectura` | `verificarAislamiento` | `verificarArranque` |
|---|---|---|---|---|---|---|
| `catastro` | 985 | **991** | VERDE | VERDE | VERDE | VERDE |
| `rentas` | 3 125 | **3 133** | VERDE | VERDE | VERDE | VERDE |
| `infrastructure` | 418/418 | **418/418** | — | — | — | — |
| `caja` | 684 | 684 (sin tocar) | — | — | — | — |
| `normativa` | 617 | 617 (sin tocar) | — | — | — | — |

Contra PostgreSQL **16.15 real** en `127.0.0.1:55444`, con RLS, `FORCE ROW LEVEL SECURITY` y los
cinco roles de verdad — **pero no por el camino de Testcontainers**, que es el que corre en CI. Mismo
hueco de P3, P4, P5A, P5B, P5C y P5D.

Guardas que **cambiaron de número y por qué** (ninguna se calló):

- `ProhibicionesEnElCodigoFuenteTest` de `catastro`: las clases que componen el área a mano pasan de
  **2 a 3**. `ComponedorDeHechos` entra porque compone el área **sólo para la huella**, que es un
  resumen criptográfico y no pasa por ningún serializador; el JSON del evento lo escribe
  `ConfiguracionDeJson` con el `AreaM2` tipado. El parámetro se llama `area` **a propósito**, para
  que el escáner lo cace y la exención tenga que verse en el diff.
- `escriturasSinUsuarioQueObserve`: **dos entradas nuevas por repositorio**, con su motivo. Publicar
  un hecho copia al buzón lo que el padrón ya dice —quien lo modificó dio su observación en el acto
  que lo modificó— y lo dispara un proceso por lotes sin usuario delante; marcar entregado es un
  acuse de recibo de otro sistema. Es el mismo argumento con que `DescargaDeNormativa` ya está en la
  lista.
- `ProcedenciaDeLasProyeccionesTest` de `rentas`: el censo pasa de **5 a 6**. `catastro_evento_muerto`
  entra porque el criterio es el **privilegio** —y ese criterio es lo que hace que una tabla nueva
  entre sola—, y lleva las tres columnas de procedencia. Lo que **no** puede llevar es la clave
  foránea al buzón: sus filas son exactamente los eventos que nunca entraron en él.
- `extensiones-de-las-migraciones.test.ts` (C-2, #742): `rentas` 11→12 y `catastro` 4→5.

---

## 9. Huecos declarados

1. **El `CronJob` no está desplegado.** Ni el del emisor (`PublicarElPadron`) ni el del ingestor
   (`CorrerElIngestor`). `infra/` despliega hoy un solo sistema y ninguno de los cuatro del corte
   tiene manifiesto — el mismo hueco que P6 dejó para la anti-entropía, y ahora son tres procesos
   por lotes esperando el mismo manifiesto.
2. **El descriptor no tiene campo para lo que el ingestor necesita.** `kamayuk.rentas.ingestor.{usuario,
   clave,municipalidad,responsable,canal}` y `kamayuk.catastro.{url,credencial}`. `Ambiente` de
   `infrastructure` ganó `operacion: {responsable, canal}` con C-7 para `caja`; esto necesita lo
   equivalente. **Consecuencia mientras no esté: el ingestor no se puede desplegar**, y con el
   descriptor tal cual **no arranca** si se le pide sin canal — que es el estado correcto.
3. **No hay intercambio de token (RFC 8693).** El ingestor corre sin usuario delante y manda una
   credencial de servicio configurada; si no la hay, la llamada sale sin credencial y `catastro` la
   rechaza, que es deliberado. Y **quien pueda acusar puede marcar entregado lo que no consumió**:
   lo que falta para cerrarlo no es otro permiso sino una identidad de servicio (ADR-0028 §2).
4. **Una segunda corrida del mismo ejercicio no puede aterrizar sus valuaciones.**
   `valuacion_predio` tiene la clave `(municipalidad, ejercicio, predio)` y `V5` no le da `UPDATE` al
   ingestor: un hecho sellado no se sustituye (ADR-0027 §1). El ingestor **lo dice en voz alta** —lo
   aparta nombrando el predio y el ejercicio— en vez de fallar con un choque de clave. Lo que falta
   es **decidir cómo se corrige una valuación ya publicada**; hasta entonces, recalcular un ejercicio
   ya proyectado se para aquí, ruidosamente.
5. **La marcha blanca con los dos procesos levantados no se hizo.** Lo que se midió es el camino
   entero con los hechos reales del emisor, el transporte real y las dos bases reales; lo que no se
   ejerció es Spring Security en medio —un emisor OIDC y un token con el acceso `consulta_fichas`—.
   Es la parte de §5.1 que dice «no real».
6. **La cifra «hechos apartados sin explicar» no está en el tablero.** Las seis del corte son las
   seis de P6 y no se amplían aquí; `catastro_evento_muerto` tiene su alerta —que se comprueba que
   llega— y no su panel. Añadir una séptima es una decisión de P7.
7. **Nada explica un muerto todavía.** `catastro_evento_muerto.explicacion` existe, `sgtm_app` lee la
   tabla y el ingestor puede escribirla; **ninguna ruta ni ninguna pantalla lo hace**. Es el mismo
   estado en que `ExplicarPagoSinEntregar` de `caja` empezó.
8. **El retraso del outbox de `catastro` no se publica.** `pendientesQueQuedan` sale en la respuesta
   del feed y en el registro del publicador; no hay ninguna consulta del catálogo de cifras que lo
   mire, porque la cifra 1 del tablero es la de `caja`.
9. **La proyección no cubre construcciones, instalaciones, geometría ni titularidad.** Es la decisión
   de `V4` y no cambia: lo que se necesita puntualmente se pregunta por HTTP. Los **titulares con su
   cuota sí viajan dentro de la valuación** —son parte del hecho sellado, porque el `%` pondera la
   base imponible (NEG-05 §1)— y `rentas` **no los proyecta**: hoy se pierden al aplicar. Recuperar
   con qué cuotas se valorizó un predio en 2026 exige leer el cuerpo del evento en
   `catastro_evento_aplicado`… que no lo guarda. **Si esa reproducibilidad hace falta, falta una
   columna.**
10. **`ValorizacionDelPredio` no calcula nada, y no debe hasta que D-11 cierre.** Está dicho en §3.2 y
    se repite aquí porque es lo que un lector apurado leería al revés: el ingestor funciona, y lo que
    transporta hoy son 14 422 motivos.

---

## 10. Lo que este trabajo no toca, y conviene decirlo

- **`caja` y `normativa` no se han tocado.** Su publicador sigue siendo un `@Scheduled` que no se
  registra (P6 §4.4); C-8 no lo arregla, y el emisor nuevo **no repite ese error**: es un
  `ApplicationRunner` del perfil `batch`, que es la forma que sí corre.
- **`ADR-0026` y `ADR-0027` no se han editado.** C-8 los implementa; donde una premisa suya resultó
  distinta de lo medido —el transporte, que ADR-0026 §3 describe empujando— la diferencia está
  argumentada aquí (§2.2) y no reescrita allí.
- **El contrato de `catastro` sigue sin generador** (hueco 7 de P5C). Las dos operaciones nuevas del
  feed no están en ningún YAML porque no hay YAML; lo que las sujeta es el archivo de hechos que el
  emisor publica y el consumidor reproduce.
