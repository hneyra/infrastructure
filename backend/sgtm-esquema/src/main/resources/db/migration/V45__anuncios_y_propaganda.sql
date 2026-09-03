-- ============================================================================
--  V45 — Anuncios y propaganda, con la deuda por la tasa generada al autorizar
--        (#51, RF-114)
--
--  V4 dejo `anuncio` con la forma que el manual describe y sin una sola linea
--  de codigo que la escribiera. Esta migracion la pone en condiciones de recibir
--  la primera, y hace con ella lo mismo que V30 hizo con el recibo, V31 con el
--  convenio, V32 con el turno, V33 con el expediente, V34 con el acto coactivo
--  y V37 con la licencia: RETIRA LO QUE MENTIRIA y agrega lo que falta.
--
--  1. EL ESTADO DEL ANUNCIO SE DERIVA; NO ES UNA COLUMNA. Se va
--     `estado varchar(15) DEFAULT 'VIGENTE'`.
--
--     Es la octava vez seguida por el mismo camino y por el mismo motivo: una
--     columna `estado` con valor por omision dice VIGENTE desde el INSERT y para
--     siempre, porque nada la mueve; y moverla exigiria un UPDATE sobre una
--     autorizacion que es un acto administrativo notificado al titular. Aqui
--     ademas tiene una consecuencia propia: EL ESTADO DECIDE SI SE SIGUE
--     GENERANDO DEUDA. Un anuncio cesado no se renueva, y por tanto no devenga
--     otra tasa; si el estado fuera una columna que alguien tiene que acordarse
--     de mover, el olvido no seria un dato mal pintado sino un cobro indebido.
--
--     El estado sale de `anuncio_movimiento`, que SOLO SE AGREGA.
--
--  2. EL CESE ES UN MOVIMIENTO, NO UN BORRADO NI UNA REVERSION (regla 4,
--     RNF-051). El AC de #51 lo dice con todas sus letras: «el cese detiene la
--     generacion de deuda futura y no borra la pasada». Las dos mitades caen en
--     sitios distintos:
--
--       - «no borra la pasada»: `anuncio` y `anuncio_movimiento` entran en las
--         tablas protegidas del escaner de fuentes, y el libro ya era inmutable
--         desde V2. La tasa de 2026 sigue asentada despues del cese.
--       - «detiene la futura»: la unica via por la que se devenga otra tasa es
--         un movimiento de RENOVACION, y renovar exige que el estado derivado a
--         la fecha no sea CESADO ni RETIRADO.
--
--  3. LA IDEMPOTENCIA DEL CARGO, EN LA BASE, Y POR DOS CAMINOS. Es el primer AC
--     de #51 —«registrar un anuncio genera exactamente un cargo; registrarlo dos
--     veces por reintento no genera dos»— y no se sostiene con un `if`: diez
--     peticiones simultaneas pasan las diez por cualquier comprobacion escrita
--     en Java.
--
--       - `anuncio_idempotencia_uq` sobre la cabecera `idempotency-key` que el
--         frontend ya manda en toda escritura (`nuevaClaveDeIdempotencia`).
--         Mismo mecanismo que `recibo_idempotencia_uq` (V29 §5): reenviar el
--         mismo registro devuelve el anuncio de la primera vez y no crea otro,
--         asi que tampoco pide otro cargo. Indice unico PARCIAL porque la clave
--         es opcional: un alta registrada por un proceso interno no tiene por
--         que traerla, y NULL no choca con NULL.
--       - `anuncio_movimiento_cargo_uq` sobre `referencia_cargo`, que es LA
--         MISMA cadena que viaja al libro como `referencia_externa`. Este es el
--         que importa de verdad, porque cubre el caso que la clave del cliente
--         no cubre: dos RENOVACIONES del mismo anuncio para el MISMO ejercicio
--         son dos peticiones legitimamente distintas —otra fecha, otra clave de
--         idempotencia— y solo una puede devengar tasa. Con el indice, la
--         segunda no llega a pedirle el cargo a `cuentacorriente`: el INSERT del
--         movimiento revienta antes, dentro de la misma transaccion.
--
--     NO se pone un indice unico sobre `cuenta_corriente_asiento
--     (referencia_externa)`, y no es un olvido: `referencia_externa` NO es
--     unica en el libro por diseño —#42 asienta varias costas del mismo
--     expediente con la misma referencia (ver ObligacionDeCostas)— y ademas el
--     libro no es de este contexto. La unicidad se declara donde el hecho
--     ocurre: en el acto que pide el cargo.
--
--  4. EL ANUNCIO NO SE EDITA. `REVOKE UPDATE`, como V37 con la licencia. Los
--     tramites que la pantalla `anuncios` enumera —renovacion, cese, retiro— son
--     ACTOS, no ediciones de un formulario: cada uno produce una fila nueva de
--     `anuncio_movimiento`. Y aqui el REVOKE se puede porque ninguna fila de
--     estas dos tablas necesita `SELECT ... FOR UPDATE`: lo que se serializa es
--     el correlativo, con un UPSERT atomico sobre su propia tabla, igual que en
--     V26, V31, V33 y V37. No es casualidad, es lo que permite retirar el
--     privilegio (comparar con `cierre_caja`, V32 §1.bis).
--
--  5. LA TASA NO ESTA AQUI, Y NO PUEDE ESTARLO. `anuncio_movimiento.tasa` guarda
--     el importe QUE SE ASENTO, copiado en el mismo acto —igual que
--     `valor_movimiento` copia su exigibilidad (V28 §2) o `licencia_duplicado`
--     su reimpresion (V37 §4)—, para que la fila se explique sola dentro de dos
--     anios sin releer un libro que ya tiene mas asientos. Lo que NO hay en
--     ninguna parte de esta migracion es una cifra: de cuanto es la tasa de un
--     anuncio lo fija una ORDENANZA municipal ratificada por la provincia, que
--     es D-02b, y vive en el conjunto sellado bajo `TASA_ANUNCIO:<CLASE>`
--     (#199). Sembrarla aqui seria compilar una cifra de norma en una migracion,
--     que es la regla 5 con otro nombre.
--
--  Dos tablas nuevas: `anuncio_movimiento` y `anuncio_correlativo`. V6 solo
--  alcanza a las tablas que existian cuando corrio, asi que las dos declaran su
--  RLS y sus privilegios aqui, explicitos (CLAUDE.md, «Al agregar una tabla»).
--
--  Las columnas NOT NULL se agregan SIN valor por omision a proposito, igual
--  que en V28..V37: ninguna linea de codigo ha escrito nunca en `anuncio` -no
--  tenia repositorio-, asi que esta vacia y el ALTER pasa. Si en algun ambiente
--  NO lo estuviera, PostgreSQL para la migracion nombrando la columna, que es
--  mejor que inventar un dato.
-- ============================================================================

-- ---------- 1. La autorizacion de anuncio ----------
--
--  Lo que sobraba. El indice de V4 lleva `estado` en la tercera posicion y
--  PostgreSQL se lo lleva por delante al eliminar la columna: NO se escribe un
--  DROP INDEX explicito, que es lo que parecia prudente y falla con «index does
--  not exist» (lo aprendio V37 §8 ejecutando, no revisando).
ALTER TABLE anuncio DROP COLUMN estado;

ALTER TABLE anuncio
    -- El establecimiento al que el anuncio pertenece: la licencia de
    -- funcionamiento de #44, en este mismo contexto acotado. Es opcional porque
    -- hay anuncios que no cuelgan de ningun local -una valla en un terreno
    -- privado, una banderola en via publica- y negar la autorizacion por eso
    -- seria inventar un requisito que ninguna norma pone.
    ADD COLUMN licencia_id        bigint,
    -- La CLASE del elemento publicitario. Es la que la ordenanza tarifa, y por
    -- eso es la unica de las cuatro caracteristicas de la pantalla que lleva
    -- CHECK y enumeracion en Java: de ella sale la llave del parametro sellado.
    ADD COLUMN clase              varchar(20)
        CHECK (clase IN ('LETRERO','PANEL','TOLDO','BANDEROLA','PANTALLA_DIGITAL',
                         'GLOBO_AEROSTATICO')),
    -- Donde se emplaza y que forma tiene. Descriptivas: la pantalla las ofrece
    -- como desplegable, pero ninguna decide la tasa ni habilita nada, asi que
    -- van como texto y no como vocabulario cerrado. Un CHECK aqui convertiria
    -- «esta municipalidad clasifica sus soportes de otra manera» en un error de
    -- integridad.
    ADD COLUMN emplazamiento      varchar(30),
    ADD COLUMN forma              varchar(30),
    ADD COLUMN denominacion       varchar(240),
    -- Las medidas: el AREA ya existe desde V4 y el numero de caras entra aqui.
    --
    -- NO se guardan la base y la altura, aunque la pantalla las pida. Son los
    -- INSUMOS con que el operador obtiene el area -que el prototipo pinta como
    -- campo de solo lectura-, y guardar tres cifras de las que dos determinan la
    -- tercera crea la unica situacion que no puede darse: que discrepen. Lo que
    -- el acto administrativo declara, y lo que la ordenanza mide, es el area.
    ADD COLUMN lados              smallint     NOT NULL DEFAULT 1 CHECK (lados >= 1),
    ADD COLUMN expediente         varchar(20),
    ADD COLUMN fecha_expediente   date,
    -- La cabecera `idempotency-key` del cliente. Ver §3.
    ADD COLUMN clave_idempotencia varchar(64),
    ADD COLUMN fecha_registro     timestamptz;

-- La clase es obligatoria desde ahora: sin ella no hay llave con la que pedirle
-- la tasa al conjunto sellado, y un anuncio que no se puede tarifar no se puede
-- autorizar. Va en dos pasos -columna primero, NOT NULL despues- por claridad
-- del diff; la tabla esta vacia, asi que el resultado es el mismo.
ALTER TABLE anuncio ALTER COLUMN clase          SET NOT NULL;
ALTER TABLE anuncio ALTER COLUMN fecha_registro SET NOT NULL;

-- El `tipo` de V4 era texto libre. El vocabulario es el del desplegable «Tipo
-- Anuncio» de la pantalla `anuncios`.
ALTER TABLE anuncio ADD CONSTRAINT anuncio_tipo_ck
    CHECK (tipo IN ('AVISO_SIMPLE','AVISO_LUMINOSO','AVISO_ILUMINADO','AVISO_ELECTRONICO'));

-- La vigencia no termina antes de empezar. Una autorizacion mal fechada nace
-- vencida y nadie lo nota hasta que el titular reclama.
ALTER TABLE anuncio ADD CONSTRAINT anuncio_vigencia_ck
    CHECK (vigencia_hasta IS NULL OR vigencia_hasta >= fecha_autorizacion);

-- La clave foranea nueva va NOT VALID a proposito (DAT-01 §0, hallazgo 4):
-- validarla es una consulta, y el migrador corre sin contexto de tenant, de modo
-- que no veria ninguna fila bajo RLS. NOT VALID sigue comprobando cada INSERT,
-- que es lo que importa de aqui en adelante.
ALTER TABLE anuncio ADD CONSTRAINT anuncio_licencia_fk
    FOREIGN KEY (municipalidad_id, licencia_id)
    REFERENCES licencia_funcionamiento (municipalidad_id, id) NOT VALID;

CREATE UNIQUE INDEX anuncio_idempotencia_uq
    ON anuncio (municipalidad_id, clave_idempotencia)
    WHERE clave_idempotencia IS NOT NULL;

COMMENT ON TABLE anuncio IS
    'La autorizacion municipal para instalar un elemento publicitario (#51, RF-114). Solo se '
    'agrega: su estado se deriva de anuncio_movimiento y sus tramites -renovacion, cese, '
    'retiro- producen actos nuevos, nunca la edicion del formulario. Registrarla GENERA LA DEUDA '
    'por la tasa, y esa deuda se le pide a cuentacorriente por su API publica: este contexto no '
    'escribe en el libro (ARQ-01 §4 regla 2).';

COMMENT ON COLUMN anuncio.clase IS
    'La clase del elemento publicitario. Es la que la ordenanza tarifa: de ella sale la llave '
    'TASA_ANUNCIO:<CLASE> del conjunto sellado (D-02b, #199). Sin clase no hay tasa que pedir.';

COMMENT ON COLUMN anuncio.licencia_id IS
    'El establecimiento asociado, como licencia de funcionamiento de #44. Opcional: hay anuncios '
    'que no cuelgan de ningun local.';

COMMENT ON COLUMN anuncio.clave_idempotencia IS
    'La clave que el cliente manda en la cabecera idempotency-key. Con su indice unico parcial, '
    'reenviar el mismo registro devuelve el anuncio de la primera vez y no pide un segundo cargo.';

COMMENT ON COLUMN anuncio.area IS
    'El area declarada del elemento. Es la medida que el acto administrativo consigna; la base y la '
    'altura con que el operador la obtiene NO se guardan, para que no puedan discrepar de ella. La '
    'tasa NO se calcula aqui a partir del area: eso es una regla, y sus cifras son D-02b (#199).';

-- ---------- 2. Los movimientos del anuncio ----------
--
--  De aqui salen dos cosas: el estado del anuncio y la constancia de cada cargo
--  que se le pidio al libro. La tabla SOLO SE AGREGA: V45 le concede SELECT e
--  INSERT y nada mas, igual que V30 con `recibo_movimiento`, V33 con
--  `expediente_movimiento` y V37 con `licencia_movimiento`.
CREATE TABLE anuncio_movimiento (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    anuncio_id       bigint       NOT NULL,
    tipo             varchar(20)  NOT NULL
        CHECK (tipo IN ('AUTORIZACION','RENOVACION','CESE','RETIRO')),
    fecha            date         NOT NULL,
    -- El ejercicio al que se imputo la tasa. Solo lo llevan los movimientos que
    -- devengan; es ademas el ejercicio de particion del asiento del libro.
    ejercicio        ejercicio,
    -- La MISMA cadena que viajo al libro como referencia_externa. Se guarda aqui
    -- -y no solo alla- porque es donde se puede declarar unica: ver el
    -- encabezado §3.
    referencia_cargo varchar(40),
    -- El importe que se asento, copiado del mismo acto. No se recalcula al
    -- leerlo: dentro de dos anios la ordenanza puede ser otra, y esta fila tiene
    -- que decir lo que se cobro, no lo que se cobraria hoy (regla 9, RNF-075).
    tasa             dinero       CHECK (tasa IS NULL OR tasa > 0),
    -- Hasta cuando queda vigente el anuncio despues de este acto. La lleva la
    -- autorizacion y la renovacion; el cese y el retiro no mueven la vigencia,
    -- la terminan.
    vigencia_hasta   date,
    motivo           varchar(500),
    usuario_registro varchar(60)  NOT NULL,
    fecha_registro   timestamptz  NOT NULL,
    observacion      varchar(500) NOT NULL,
    CONSTRAINT anuncio_movimiento_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT anuncio_movimiento_anuncio_fk FOREIGN KEY (municipalidad_id, anuncio_id)
        REFERENCES anuncio (municipalidad_id, id),
    -- Devengar o no devengar, las tres columnas a la vez. Un movimiento con
    -- referencia pero sin importe -o al reves- seria un cargo a medio explicar,
    -- y es exactamente la forma en que se cuela un asiento que nadie sabe de
    -- donde salio. Mismo criterio que PoliticasDeRedondeoSelladas con la media
    -- politica: la situacion no se puede representar.
    CONSTRAINT anuncio_movimiento_devengo_ck
        CHECK ((tipo IN ('AUTORIZACION','RENOVACION'))
               = (referencia_cargo IS NOT NULL AND tasa IS NOT NULL AND ejercicio IS NOT NULL)),
    -- Un cese y un retiro se motivan. La autorizacion y la renovacion no lo
    -- necesitan: su motivo es la solicitud del administrado, que ya esta en el
    -- expediente.
    CONSTRAINT anuncio_movimiento_motivo_ck
        CHECK ((tipo IN ('CESE','RETIRO')) = (motivo IS NOT NULL))
);

COMMENT ON TABLE anuncio_movimiento IS
    'Lo que le pasa a un anuncio: su autorizacion, sus renovaciones, su cese y su retiro (#51, '
    'RF-114). SOLO SE AGREGA. De aqui se deriva el estado -que es lo que decide si se sigue '
    'devengando tasa- y de aqui sale la garantia de que un cargo no se pide dos veces.';

COMMENT ON COLUMN anuncio_movimiento.referencia_cargo IS
    'La referencia_externa con la que el cargo entro en el libro, ANUNCIO-<numero>-<ejercicio>. '
    'Su indice unico es lo que impide que el mismo anuncio devengue dos veces la tasa del mismo '
    'ejercicio, y por eso vive aqui y no en cuenta_corriente_asiento: alli referencia_externa NO '
    'es unica por diseño (#42 asienta varias costas del mismo expediente).';

-- Una autorizacion, un cese y un retiro por anuncio, como maximo. Indices unicos
-- PARCIALES, mismo patron que `licencia_movimiento_emision_uq` (V37),
-- `acto_rec1_uq` (V34) y `expediente_movimiento_apertura_uq` (V33). La RENOVACION
-- no esta aqui: se repite todos los anios, y lo que la limita es el indice del
-- cargo, que es por ejercicio.
CREATE UNIQUE INDEX anuncio_movimiento_autorizacion_uq
    ON anuncio_movimiento (municipalidad_id, anuncio_id)
    WHERE tipo = 'AUTORIZACION';

CREATE UNIQUE INDEX anuncio_movimiento_cese_uq
    ON anuncio_movimiento (municipalidad_id, anuncio_id)
    WHERE tipo = 'CESE';

CREATE UNIQUE INDEX anuncio_movimiento_retiro_uq
    ON anuncio_movimiento (municipalidad_id, anuncio_id)
    WHERE tipo = 'RETIRO';

-- EL INDICE DE #51. Un cargo por referencia, y la referencia lleva el ejercicio.
CREATE UNIQUE INDEX anuncio_movimiento_cargo_uq
    ON anuncio_movimiento (municipalidad_id, referencia_cargo)
    WHERE referencia_cargo IS NOT NULL;

CREATE INDEX anuncio_movimiento_anuncio_ix
    ON anuncio_movimiento (municipalidad_id, anuncio_id, fecha);

ALTER TABLE anuncio_movimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE anuncio_movimiento FORCE  ROW LEVEL SECURITY;

CREATE POLICY anuncio_movimiento_tenant ON anuncio_movimiento
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

GRANT SELECT, INSERT ON anuncio_movimiento TO sgtm_app;
GRANT SELECT         ON anuncio_movimiento TO sgtm_readonly;

-- ---------- 3. El correlativo de la autorizacion ----------
--
--  Mismo mecanismo que `valor_correlativo` (V26), `convenio_correlativo` (V31),
--  `expediente_correlativo` (V33) y `licencia_correlativo` (V37): se lee y se
--  incrementa en una sola sentencia UPSERT, que bloquea la fila del contador
--  mientras la actualiza. Nunca con SELECT + UPDATE: entre los dos cabe otra
--  autorizacion, y las dos leerian el mismo numero.
--
--  El FORMATO del numero no vive aqui -es D-09, abierta-: la tabla guarda el
--  correlativo desnudo y la composicion la hace `PlantillaDeNumeroDeAnuncio`.
CREATE TABLE anuncio_correlativo (
    municipalidad_id bigint    NOT NULL REFERENCES municipalidad(id),
    ejercicio        ejercicio NOT NULL,
    ultimo           bigint    NOT NULL DEFAULT 0 CHECK (ultimo >= 0),
    CONSTRAINT anuncio_correlativo_pk PRIMARY KEY (municipalidad_id, ejercicio)
);

COMMENT ON TABLE anuncio_correlativo IS
    'El ultimo correlativo de autorizacion de anuncio emitido por municipalidad y ejercicio '
    '(#51). Se lee y se incrementa en una sola sentencia UPSERT; nunca con SELECT + UPDATE.';

ALTER TABLE anuncio_correlativo ENABLE ROW LEVEL SECURITY;
ALTER TABLE anuncio_correlativo FORCE  ROW LEVEL SECURITY;

CREATE POLICY anuncio_correlativo_tenant ON anuncio_correlativo
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- Este contador SI se actualiza en el sitio: es infraestructura interna de
-- numeracion, no un documento notificable.
GRANT SELECT, INSERT, UPDATE ON anuncio_correlativo TO sgtm_app;
GRANT SELECT                 ON anuncio_correlativo TO sgtm_readonly;

-- ---------- 4. El anuncio no se edita ----------
--
--  V7 le concedio UPDATE junto con el resto de las tablas de negocio. Se retira,
--  por lo mismo que V29 se lo retiro al recibo, V34 al acto coactivo y V37 a la
--  licencia. Ver §4 del encabezado.
REVOKE UPDATE ON anuncio FROM sgtm_app;

-- ---------- 5. Indices de la consulta ----------
--
--  La pantalla busca por numero de autorizacion, por expediente y por direccion,
--  y las dos ultimas son busquedas por PREFIJO. Bajo RLS un `LIKE 'prefijo%'` no
--  llega nunca al indice -`textlike` no es leakproof y PostgreSQL no lo evalua
--  antes de la politica (DAT-01 §0, hallazgo 3)-, asi que la consulta se escribe
--  como rango con `~>=~` / `~<~` y estos indices son los que ese rango recorre.
CREATE INDEX anuncio_contribuyente_ix
    ON anuncio (municipalidad_id, contribuyente_id, fecha_autorizacion);

CREATE INDEX anuncio_ubicacion_ix
    ON anuncio (municipalidad_id, ubicacion text_pattern_ops);

CREATE INDEX anuncio_expediente_ix
    ON anuncio (municipalidad_id, expediente text_pattern_ops)
    WHERE expediente IS NOT NULL;

CREATE INDEX anuncio_licencia_ix
    ON anuncio (municipalidad_id, licencia_id)
    WHERE licencia_id IS NOT NULL;
