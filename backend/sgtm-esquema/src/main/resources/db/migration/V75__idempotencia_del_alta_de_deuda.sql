-- ============================================================================
--  V75 — Dar de alta dos veces la misma deuda deja de ser posible (#588)
--
--  Sale de #538, que al anadir el rango de cuotas midio el camino entero y
--  encontro que **nada impedia dar de alta dos veces la misma obligacion**:
--  `documento_numero_uq` (V15) es UNIQUE (municipalidad_id, tipo, ejercicio,
--  numero) y no ve el `documento_origen`, y `RegistrarMovimientoDeDeuda` solo
--  comprueba que una BAJA no exceda la deuda —el alta no tiene ese limite, y no
--  lo tiene a proposito: incorporar deuda que no estaba es para lo que existe—.
--
--  El dano no se ve en ninguna cifra: la deuda existe, el importe es el
--  correcto, y solo se descubre cuando alguien paga y el saldo no queda en cero.
--
--  ---------------------------------------------------------------------------
--  1. LA GARANTIA ES EL INDICE, NO UN «IF» EN JAVA
--  ---------------------------------------------------------------------------
--
--  Es lo que el issue pide con esas palabras, y lo que ya resolvieron
--  `recibo_idempotencia_uq` (V29, #33), `expediente_valor_unico_uq` (V33, #40),
--  `licencia_duplicado_uq` (V37, #44), `resolucion_determinacion_liquidacion_uq`
--  (V49, #52) y `dj_rectifica_uq` (V54, #365). Entre leer y escribir cabe otra
--  peticion, asi que cualquier comprobacion previa la pasarian las dos.
--
--  Aqui, ademas, **no hay ninguna comprobacion previa**, y eso es deliberado:
--  el repositorio traduce el choque nombrando la fila que iba a escribir —la
--  obligacion, la cuota, el concepto y el documento de sustento—, de modo que un
--  `SELECT` previo no anadiria ni una palabra al mensaje ni evitaria gastar
--  nada: el documento se emite DESPUES de los asientos, asi que un alta
--  rechazada no consume correlativo. Es la leccion de #188 llevada un paso mas
--  alla: alli la guarda de Java quedo documentada como inutil, aqui no se
--  escribe.
--
--  ---------------------------------------------------------------------------
--  2. QUE COLUMNAS SON LA CLAVE, Y POR QUE NO LAS DEMAS
--  ---------------------------------------------------------------------------
--
--  La obligacion —`contribuyente_id, tributo, ejercicio, periodo, predio_id,
--  vehiculo_id`, que son exactamente las de `ClaveDeSaldo` y las de `saldo_uq`
--  (V2)—, mas el `documento_origen` que la sustenta y el `concepto` contra el
--  que se imputa.
--
--    - `concepto` ENTRA: un alta con desglose produce hasta cuatro asientos
--      —insoluto, reajuste, interes, gasto— y sin el se rechazaria a si misma.
--    - `periodo` ENTRA: «cuotas 1 a 4» son cuatro obligaciones distintas (#538)
--      y sin el se rechazaria a si misma en la segunda cuota.
--    - `documento_origen` ENTRA: es lo que separa dos actos legitimos sobre la
--      misma obligacion. Es texto que teclea quien atiende, asi que «RES-001» y
--      «RES 001» son dos altas distintas; NO se normaliza aqui, por lo mismo que
--      no se traduce un vocabulario (#427): normalizar decidiria en silencio que
--      dos sustentos distintos son el mismo, y equivocarse en esa direccion
--      RECHAZA un acto legitimo sin que quien atiende sepa por que.
--    - `fase`, `fecha_valor`, `monto` y `referencia_externa` NO entran, y ese es
--      el lado estricto a proposito: si entraran, repetir el alta cambiando la
--      fecha valor o un centimo del importe volveria a colar el duplicado, que
--      es exactamente lo que este indice existe para impedir.
--    - `municipalidad_id` va primero porque toda clave de este esquema es por
--      inquilino (ARQ-04 §7), y `ejercicio` porque es la clave de particion: un
--      indice unico sobre una tabla particionada tiene que incluirla o
--      PostgreSQL lo rechaza. Medido contra PostgreSQL 16.15.
--
--  `COALESCE(...)` en las tres columnas nulables, y no la semantica por omision:
--  medido, dos filas identicas con `predio_id` y `vehiculo_id` NULOS **entraron
--  las dos** —los nulos se consideran distintos—, y esa es la forma mas comun de
--  todas, la obligacion sin unidad. El 0 no colisiona con ningun identificador
--  real (`GENERATED ALWAYS AS IDENTITY` empieza en 1) y en `periodo` significa
--  «anual», que es la misma equivalencia que `ClaveDeSaldo#de` aplica al leer.
--  Es la forma de `saldo_uq` (V2); tambien valdria `NULLS NOT DISTINCT` (V57),
--  pero entonces el 0 y el nulo de `periodo` serian dos obligaciones distintas y
--  la proyeccion dice que son la misma.
--
--  ---------------------------------------------------------------------------
--  3. EL PREDICADO, Y LO QUE DEJA FUERA
--  ---------------------------------------------------------------------------
--
--    acto = 'ALTA_DEUDA'           la columna que V68 (#601) anadio
--    asiento_reversado_id IS NULL  la reversion NO es un alta
--
--  Lo segundo no es adorno: `Asiento#reversionDe` **copia el acto** —lo dice su
--  propio comentario—, asi que la reversion de un alta llega con
--  `acto = 'ALTA_DEUDA'` y la misma clave, y sin esta mitad del predicado el
--  indice la rechazaria. Un asiento que corrige otro no puede quedar bloqueado
--  por el indice que protege al original.
--
--  Lo que queda fuera del indice, dicho para que nadie lo descubra despues:
--
--    - Las BAJAS. Una baja repetida ya la para `verificarQueNoExcedeLaDeuda`:
--      la primera extingue la deuda y la segunda contesta «a esa fecha solo se
--      deben 0.00». No es una guarda completa —una baja PARCIAL repetida si
--      cabe—, pero es una guarda que el alta no tiene, y ese es el defecto que
--      este issue nombra. Meter la baja aqui rechazaria ademas el caso legitimo
--      de dos bajas parciales con el mismo sustento.
--    - Todo lo que asienta con `acto` NULO: la emision masiva, la cobranza, el
--      acogimiento a convenio, los cargos que generan licencias, anuncios,
--      tesoreria y coactiva por `GeneradorDeCargos` —que usa `Asiento.nuevo` y
--      no `nuevoDelActo`—. Ninguno de ellos entra en el predicado, asi que este
--      indice no puede rechazar un acto suyo.
--    - Y con ello, **toda fila anterior a V68**, que tiene `acto` nulo por
--      construccion.
--
--  ---------------------------------------------------------------------------
--  4. QUE PASA SI YA HUBIERA UN DUPLICADO, Y POR QUE ESTA MIGRACION NO PUEDE
--     DIAGNOSTICARLO
--  ---------------------------------------------------------------------------
--
--  Un `CREATE UNIQUE INDEX` no tiene `NOT VALID` —el `CHECK` de V64 si lo
--  tenia—, asi que o entra o la migracion se para. Tres cosas medidas contra
--  PostgreSQL 16.15, con el rol dueno, `FORCE ROW LEVEL SECURITY` y sin contexto
--  de tenant, que es exactamente como corre el migrador:
--
--    1. `SELECT` y `UPDATE` sobre la tabla mueren con «unrecognized
--       configuration parameter "app.municipalidad_id"» (DAT-01 §0 hallazgo 4,
--       ya medido en V64 y V68). Asi que esta migracion **no puede** contar los
--       duplicados antes de crear el indice ni repararlos despues.
--    2. `CREATE UNIQUE INDEX` **si funciona** en esa misma sesion: construir un
--       indice lee el monton directamente y no pasa por la politica. Es un
--       hallazgo nuevo de la misma familia y conviene tenerlo escrito, porque el
--       hecho 1 haria esperar lo contrario.
--    3. Si hay un duplicado, el error que llega es «could not create unique
--       index ... DETAIL: Duplicate keys exist.» **y no dice cuales**: como el
--       dueno esta sujeto a la politica, PostgreSQL oculta los valores de la
--       clave. El mismo fallo como superusuario si los imprime.
--
--  La ventana en la que puede existir un duplicado es estrecha y esta acotada:
--  solo entre V68 —que estreno la columna `acto`— y esta migracion, porque antes
--  no habia ninguna fila con `acto = 'ALTA_DEUDA'`. Si aun asi apareciera, el
--  remedio NO es un `DELETE`: aqui no se borra (regla 4, RNF-051), y el propio
--  migrador no podria hacerlo. Es una decision con los datos delante —un cargo
--  duplicado ya cobrado no es lo mismo que uno que no lo esta—, y hay que
--  tomarla desde la aplicacion, con contexto de tenant, reversando el asiento
--  que sobra antes de migrar: la reversion trae `asiento_reversado_id`, sale del
--  predicado, y **el original tambien tiene que salir**, cosa que hoy solo puede
--  hacer un acto del dominio y no esta escrito. Se dice aqui, y no se finge.
--
--  ---------------------------------------------------------------------------
--  5. LO QUE ESTA MIGRACION NO NECESITA
--  ---------------------------------------------------------------------------
--
--  Ningun `GRANT`: V7 concede `SELECT, INSERT` sobre la TABLA y un indice no se
--  concede. Ninguna tabla ni particion nueva, asi que `verificarAislamiento` no
--  tiene nada que clasificar. Y ninguna columna nueva: la que hacia falta la
--  puso V68.
-- ============================================================================

CREATE UNIQUE INDEX asiento_alta_unica_uq
    ON cuenta_corriente_asiento (
        municipalidad_id,
        ejercicio,
        contribuyente_id,
        tributo,
        COALESCE(periodo, 0),
        COALESCE(predio_id, 0),
        COALESCE(vehiculo_id, 0),
        documento_origen,
        concepto)
    WHERE acto = 'ALTA_DEUDA' AND asiento_reversado_id IS NULL;

COMMENT ON INDEX asiento_alta_unica_uq IS
    'Un alta de deuda por obligacion, sustento y concepto (#588). Dar de alta dos veces la misma '
    'obligacion con el mismo documento de sustento carga dos veces al mismo contribuyente y no hay '
    'ninguna cifra que parezca mal: la deuda existe y el importe es correcto. El predicado deja '
    'fuera la reversion —Asiento#reversionDe copia el acto— y todo lo que asienta con acto nulo: '
    'la emision, la cobranza, el convenio y los cargos de licencias, anuncios, tesoreria y '
    'coactiva. La baja se queda fuera a proposito: la para verificarQueNoExcedeLaDeuda (V75).';
