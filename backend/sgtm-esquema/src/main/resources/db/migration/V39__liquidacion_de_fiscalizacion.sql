-- ============================================================================
--  V39 — La liquidacion de fiscalizacion, su reliquidacion y su historial
--        (#49, RF-053, RF-055, RF-056)
--
--  #45 dejo el trabajo de campo: el programa y el acta, sobre una COPIA. Lo que
--  faltaba es el resultado del proceso: cuanto se dejo de declarar, predio por
--  predio y ejercicio por ejercicio, y el documento que lo consolida.
--
--  NINGUNA TABLA DE V3 SIRVE PARA ESTO, Y SE COMPROBO ANTES DE CREAR. `valor`
--  formaliza una deuda ya determinada y `determinacion` es la determinacion
--  ORDINARIA de rentas, con su conjunto sellado y su detalle por predio; una
--  liquidacion de fiscalizacion no es ninguna de las dos: es el contraste
--  HALLADO/DECLARADO que las precede, y su fila tiene dos lados donde las de
--  ellas tienen uno. Colgarla de `determinacion` habria obligado a que cada
--  consulta de determinacion supiera distinguir las de oficio de las demas.
--
--  1. CADA LINEA FIJA SU CONJUNTO SELLADO, Y ESO ES EL AC 1 DE #49.
--     `liquidacion_detalle.conjunto_id` apunta al conjunto de parametros
--     SELLADO del ejercicio DE ESA LINEA, copiado en el momento de emitir. No
--     se vuelve a resolver al leer: resolver «el vigente del ejercicio» es el
--     defecto que ARQ-09 §3 nombra, y aqui su consecuencia es que cambiar los
--     parametros de hoy alteraria una liquidacion ya emitida —que es
--     exactamente lo que el AC prohibe—. Mismo mecanismo, y por el mismo
--     motivo, que `determinacion.conjunto_id` (V2) y
--     `valor_movimiento.exigible_desde` (V28): la fila COPIA lo que la explica.
--
--     VA EN LA LINEA Y NO EN LA CABECERA, y esto importa. Una fiscalizacion
--     abarca un PERIODO -«desde 2022 hasta 2026» en la pantalla-, y los
--     parametros de 2022 no son los de 2026: la UIT cambia todos los anios y el
--     cuadro de valores unitarios tambien. Un unico conjunto en la cabecera
--     liquidaria 2022 con las cifras de 2026, que es un error de varios cientos
--     por ciento y no lo delataria nada.
--
--  2. UNA RELIQUIDACION NO PISA A LA ANTERIOR. `version` + `liquidacion_
--     anterior_id`, y `liquidacion_version_uq` sobre (acta, version). Es el
--     patron de `ficha_catastral` (V1) y de `acta_fiscalizacion` (V4): la
--     correccion es OTRA fila que referencia la anterior, y las dos quedan.
--     `liquidacion_reliquidacion_ck` lo hace inevitable: la version 1 no
--     referencia nada, y cualquier otra tiene que decir a cual sustituye.
--
--  3. EL ESTADO SE DERIVA DE `liquidacion_movimiento`. Sexta vez seguida por el
--     mismo camino que V30 (recibo), V31 (convenio), V32 (turno), V33
--     (expediente) y V34 (acto coactivo), y aqui se aplica desde el principio
--     en vez de retirarlo despues: la tabla NACE sin columna `estado`, porque
--     como la aplicacion no puede actualizarla, esa columna diria ABIERTA para
--     siempre y cualquier consulta ad hoc la leeria como la verdad.
--
--     El vocabulario es el del desplegable «Estado» de la pantalla
--     `fisc_historico`: ABIERTA, EN_PROCESO, LIQUIDADA, NOTIFICADA, ANULADA.
--     El prototipo manda.
--
--  4. LAS COLUMNAS DE IMPORTE EXISTEN, TIENEN NOMBRE Y NO TIENEN CIFRA. `base_
--     declarada`, `base_hallada`, `insoluto_omitido` y `multa_tributaria` son
--     NULL mientras D-02a no entregue la UIT, el cuadro de valores unitarios,
--     la tabla de depreciacion y la multa del art. 176 (#198). No se inventa
--     ninguna: una liquidacion con un importe supuesto es una deuda notificada
--     que despues hay que anular, y el error escala a todo el programa.
--
--     `liquidacion_detalle_cifras_ck` impide la peor forma del defecto: media
--     comparacion. Los dos lados del contraste van juntos o no van; una
--     `base_hallada` con la declarada en NULL se leeria como «declaro cero».
--
--     Lo que SI se guarda es la comparacion ESTRUCTURAL, que no depende de
--     ninguna norma: area declarada contra area hallada, uso declarado contra
--     uso hallado, y la condicion que sale de compararlos.
--
--  5. NADA DE ESTO ESCRIBE EN CATASTRO NI EN RENTAS (AC 4 de #49). Las tres
--     tablas son de fiscalizacion y solo referencian `acta_fiscalizacion`,
--     `predio` y `vehiculo` para poder senalar la unidad. La comparacion se
--     hace sobre las COPIAS que el acta ya guarda (ARQ-01 §3.5).
--
--  6. NUMERACION PROPIA POR EJERCICIO. `liquidacion_correlativo` sigue el
--     patron de `valor_correlativo` (V26), `recibo_correlativo` (V29),
--     `convenio_correlativo` (V31) y `expediente_correlativo` (V33): UPSERT en
--     una sola sentencia, nunca SELECT + UPDATE. Sin el, dos liquidaciones
--     simultaneas del mismo programa saldrian con el mismo «Nº Liquidacion».
--
--  7. LA LIQUIDACION SOLO SE AGREGA. `REVOKE UPDATE` sobre las tres: una
--     liquidacion se NOTIFICA al contribuyente, que se lleva el papel.
--     Corregirla en el sitio deja al papel y al sistema diciendo cosas
--     distintas, y quien tenga el papel gana la discusion. Una liquidacion
--     equivocada se reliquida —otra version— o se anula con un movimiento.
--     Aqui el REVOKE si se puede, al reves que con `cierre_caja` (V32 §1.bis):
--     ninguna fila necesita `SELECT ... FOR UPDATE`, porque lo que se serializa
--     es el correlativo y eso lo hace su propia tabla.
--
--  Las tres tablas son NUEVAS y llevan `municipalidad_id NOT NULL`, asi que su
--  RLS y sus privilegios se declaran aqui, explicitos: V6 solo alcanzo a las
--  que existian cuando corrio (CLAUDE.md, «Al agregar una tabla»).
-- ============================================================================

-- ---------- 1. La cabecera ----------
CREATE TABLE liquidacion_fiscalizacion (
    municipalidad_id        bigint        NOT NULL REFERENCES municipalidad(id),
    id                      bigint        GENERATED ALWAYS AS IDENTITY,
    -- El «Nº Liquidacion» de la pantalla `fisc_historico`. Sale del correlativo
    -- de abajo con la plantilla del dominio; D-09 decide el formato definitivo.
    numero                  varchar(40)   NOT NULL,
    ejercicio               ejercicio     NOT NULL,
    correlativo             bigint        NOT NULL CHECK (correlativo > 0),
    acta_id                 bigint        NOT NULL,
    version                 integer       NOT NULL CHECK (version > 0),
    -- La liquidacion que esta reliquida. NULL solo en la version 1.
    liquidacion_anterior_id bigint,
    -- El periodo fiscalizado, «desde» y «hasta» de la pantalla.
    ejercicio_desde         ejercicio     NOT NULL,
    ejercicio_hasta         ejercicio     NOT NULL,
    tipo_fiscalizacion      varchar(15)   NOT NULL
        CHECK (tipo_fiscalizacion IN ('CIERTA','PRESUNTA','DE_OFICIO','GABINETE')),
    motivo_determinante     varchar(1000) NOT NULL,
    fecha                   date          NOT NULL,
    -- El «Nº Notificacion» de la pantalla, cuando la liquidacion ya se
    -- notifico. La diligencia en si es una fila de `notificacion` (V3/V28) con
    -- objeto = 'RESOLUCION'; esto es la copia legible, como `acto_coactivo.
    -- numero` respecto de `documento_emitido` (V34 §2).
    numero_notificacion     varchar(40),
    usuario_registro        varchar(60)   NOT NULL,
    fecha_registro          timestamptz   NOT NULL,
    observacion             varchar(500)  NOT NULL,
    CONSTRAINT liquidacion_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT liquidacion_numero_uq UNIQUE (municipalidad_id, numero),
    -- Una version por acta, y no dos. Es lo que impide que dos reliquidaciones
    -- simultaneas del mismo acta salgan las dos como version 2.
    CONSTRAINT liquidacion_version_uq UNIQUE (municipalidad_id, acta_id, version),
    CONSTRAINT liquidacion_correlativo_uq UNIQUE (municipalidad_id, ejercicio, correlativo),
    CONSTRAINT liquidacion_acta_fk FOREIGN KEY (municipalidad_id, acta_id)
        REFERENCES acta_fiscalizacion (municipalidad_id, id),
    -- Las dos foraneas van NOT VALID a proposito (DAT-01 §0, cuarto hallazgo):
    -- validarlas es una consulta, y el migrador corre sin contexto de tenant,
    -- de modo que bajo RLS no veria ninguna fila. NOT VALID sigue comprobando
    -- cada INSERT, que es lo que importa de aqui en adelante.
    CONSTRAINT liquidacion_anterior_fk FOREIGN KEY (municipalidad_id, liquidacion_anterior_id)
        REFERENCES liquidacion_fiscalizacion (municipalidad_id, id) NOT VALID,
    CONSTRAINT liquidacion_periodo_ck CHECK (ejercicio_hasta >= ejercicio_desde),
    -- La version 1 no sustituye a nadie; cualquier otra tiene que decir a cual
    -- sustituye. Sin esto, una reliquidacion podria nacer huerfana y el
    -- historico no sabria encadenar el proceso (AC 5).
    CONSTRAINT liquidacion_reliquidacion_ck
        CHECK ((version = 1) = (liquidacion_anterior_id IS NULL)),
    -- Y no se sustituye a si misma.
    CONSTRAINT liquidacion_no_se_sustituye_ck
        CHECK (liquidacion_anterior_id IS NULL OR liquidacion_anterior_id <> id)
);

COMMENT ON TABLE liquidacion_fiscalizacion IS
    'La liquidacion de un proceso de fiscalizacion (#49, RF-053): el consolidado de lo hallado '
    'frente a lo declarado para un acta y un periodo. Solo se agrega: una liquidacion '
    'equivocada se reliquida -otra version que referencia esta- o se anula con un movimiento, '
    'nunca editandola.';

COMMENT ON COLUMN liquidacion_fiscalizacion.liquidacion_anterior_id IS
    'La liquidacion que esta reliquida. Las dos quedan y las dos se pueden leer: la anterior '
    'explica por que se notifico lo que se notifico, y la nueva por que ya no vale (AC 2).';

CREATE INDEX liquidacion_acta_ix
    ON liquidacion_fiscalizacion (municipalidad_id, acta_id, version);
CREATE INDEX liquidacion_anterior_ix
    ON liquidacion_fiscalizacion (municipalidad_id, liquidacion_anterior_id);

ALTER TABLE liquidacion_fiscalizacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE liquidacion_fiscalizacion FORCE  ROW LEVEL SECURITY;

CREATE POLICY liquidacion_tenant ON liquidacion_fiscalizacion
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

GRANT SELECT, INSERT ON liquidacion_fiscalizacion TO sgtm_app;
GRANT SELECT          ON liquidacion_fiscalizacion TO sgtm_readonly;

-- ---------- 2. El contraste, predio por predio y ejercicio por ejercicio ----------
CREATE TABLE liquidacion_detalle (
    municipalidad_id  bigint       NOT NULL,
    id                bigint       GENERATED ALWAYS AS IDENTITY,
    liquidacion_id    bigint       NOT NULL,
    ejercicio         ejercicio    NOT NULL,
    -- El conjunto SELLADO de ESE ejercicio, copiado al emitir (§1). Va aqui y
    -- no en la cabecera porque una fiscalizacion abarca un periodo y los
    -- parametros de cada anio son otros.
    conjunto_id       bigint       NOT NULL,
    -- La unidad fiscalizada. Un acta es de un predio o de un vehiculo (V24), y
    -- su liquidacion hereda esa disyuntiva.
    predio_id         bigint,
    vehiculo_id       bigint,
    condicion         varchar(15)  NOT NULL
        CHECK (condicion IN ('CONFORME','OMISO','SUBVALUADOR','USO_DISTINTO','NO_UBICADO')),
    -- La comparacion ESTRUCTURAL. No depende de ninguna norma y por eso si se
    -- guarda: es lo que el fiscalizador midio frente a lo que la ficha decia.
    area_declarada    area_m2,
    area_hallada      area_m2,
    uso_declarado     varchar(60),
    uso_hallado       varchar(60),
    -- Y la monetaria, que espera a D-02a (#198). Nombre sin cifra: ver §4.
    base_declarada    dinero,
    base_hallada      dinero,
    insoluto_omitido  dinero,
    multa_tributaria  dinero,
    CONSTRAINT liquidacion_detalle_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT liquidacion_detalle_liq_fk FOREIGN KEY (municipalidad_id, liquidacion_id)
        REFERENCES liquidacion_fiscalizacion (municipalidad_id, id),
    CONSTRAINT liquidacion_detalle_conjunto_fk FOREIGN KEY (municipalidad_id, conjunto_id)
        REFERENCES conjunto_parametros (municipalidad_id, id) NOT VALID,
    CONSTRAINT liquidacion_detalle_predio_fk FOREIGN KEY (municipalidad_id, predio_id)
        REFERENCES predio (municipalidad_id, id) NOT VALID,
    CONSTRAINT liquidacion_detalle_vehiculo_fk FOREIGN KEY (municipalidad_id, vehiculo_id)
        REFERENCES vehiculo (municipalidad_id, id) NOT VALID,
    -- Una linea es de una unidad o de otra, nunca de las dos ni de ninguna.
    CONSTRAINT liquidacion_detalle_unidad_ck
        CHECK ((predio_id IS NOT NULL) <> (vehiculo_id IS NOT NULL)),
    -- Una linea por unidad y ejercicio: repetirla duplicaria la diferencia.
    --
    -- NULLS NOT DISTINCT no es decorativo. Una linea predial deja `vehiculo_id`
    -- en NULL, y con el comportamiento por omision -NULLS DISTINCT- dos filas
    -- del mismo predio y ejercicio NO chocarian: PostgreSQL considera distintos
    -- dos NULL, asi que la unicidad no protegeria nada justo en el caso que
    -- ocurre siempre.
    CONSTRAINT liquidacion_detalle_uq
        UNIQUE NULLS NOT DISTINCT
        (municipalidad_id, liquidacion_id, ejercicio, predio_id, vehiculo_id),
    -- Los dos lados del contraste van juntos o no van (§4). Media comparacion
    -- se leeria como «declaro cero», que es una acusacion, no un dato ausente.
    CONSTRAINT liquidacion_detalle_cifras_ck
        CHECK ((base_declarada IS NULL) = (base_hallada IS NULL))
);

COMMENT ON TABLE liquidacion_detalle IS
    'El contraste hallado/declarado de una liquidacion, una fila por unidad y ejercicio (#49, '
    'RF-053). La comparacion estructural -area y uso- se guarda; la monetaria espera a D-02a '
    '(#198) y sus columnas van con nombre y sin cifra.';

COMMENT ON COLUMN liquidacion_detalle.conjunto_id IS
    'El conjunto de parametros SELLADO del ejercicio de esta linea, copiado al emitir. Todo '
    'recalculo lo lee por este identificador y nunca por ejercicio: resolver «el vigente del '
    'ejercicio» devolveria otra version el dia que se selle una nueva, y la liquidacion ya '
    'emitida cambiaria de cifra sin que nada fallara (ARQ-09 §3, AC 1 de #49).';

COMMENT ON CONSTRAINT liquidacion_detalle_cifras_ck ON liquidacion_detalle IS
    'Los dos lados del contraste van juntos. Una base hallada con la declarada en NULL se '
    'leeria como «declaro cero», y eso no es un dato ausente sino una acusacion.';

CREATE INDEX liquidacion_detalle_liq_ix
    ON liquidacion_detalle (municipalidad_id, liquidacion_id, ejercicio);

ALTER TABLE liquidacion_detalle ENABLE ROW LEVEL SECURITY;
ALTER TABLE liquidacion_detalle FORCE  ROW LEVEL SECURITY;

CREATE POLICY liquidacion_detalle_tenant ON liquidacion_detalle
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

GRANT SELECT, INSERT ON liquidacion_detalle TO sgtm_app;
GRANT SELECT          ON liquidacion_detalle TO sgtm_readonly;

-- ---------- 3. El historial del que se deriva el estado ----------
CREATE TABLE liquidacion_movimiento (
    municipalidad_id bigint       NOT NULL,
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    liquidacion_id   bigint       NOT NULL,
    tipo             varchar(15)  NOT NULL CHECK (tipo IN ('APERTURA','ESTADO')),
    estado           varchar(15)  NOT NULL
        CHECK (estado IN ('ABIERTA','EN_PROCESO','LIQUIDADA','NOTIFICADA','ANULADA')),
    fecha            date         NOT NULL,
    motivo           varchar(300) NOT NULL,
    usuario_registro varchar(60)  NOT NULL,
    fecha_registro   timestamptz  NOT NULL,
    observacion      varchar(500) NOT NULL,
    CONSTRAINT liquidacion_movimiento_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT liquidacion_movimiento_liq_fk FOREIGN KEY (municipalidad_id, liquidacion_id)
        REFERENCES liquidacion_fiscalizacion (municipalidad_id, id),
    -- La apertura solo abre en ABIERTA: es el estado con el que nace una
    -- liquidacion, antes de que nadie la trabaje.
    CONSTRAINT liquidacion_movimiento_apertura_ck
        CHECK (tipo <> 'APERTURA' OR estado = 'ABIERTA')
);

-- Una sola apertura por liquidacion. Indice unico PARCIAL y no UNIQUE(liq,
-- tipo) a proposito: los cambios de estado se repiten -para eso existe el
-- historial- y el que no puede repetirse es el que la abre. Mismo patron que
-- `expediente_movimiento_apertura_uq` (V33) y `acto_rec1_uq` (V34).
CREATE UNIQUE INDEX liquidacion_movimiento_apertura_uq
    ON liquidacion_movimiento (municipalidad_id, liquidacion_id)
    WHERE tipo = 'APERTURA';

CREATE INDEX liquidacion_movimiento_liq_ix
    ON liquidacion_movimiento (municipalidad_id, liquidacion_id, id);

COMMENT ON TABLE liquidacion_movimiento IS
    'El historial de una liquidacion de fiscalizacion (#49, RF-056): su apertura y cada cambio '
    'de estado, con fecha, usuario, motivo y observacion. De aqui se DERIVA el estado; la '
    'cabecera no tiene columna de estado porque, sin UPDATE, diria ABIERTA para siempre.';

ALTER TABLE liquidacion_movimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE liquidacion_movimiento FORCE  ROW LEVEL SECURITY;

CREATE POLICY liquidacion_movimiento_tenant ON liquidacion_movimiento
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

GRANT SELECT, INSERT ON liquidacion_movimiento TO sgtm_app;
GRANT SELECT          ON liquidacion_movimiento TO sgtm_readonly;

-- ---------- 4. La numeracion ----------
CREATE TABLE liquidacion_correlativo (
    municipalidad_id bigint    NOT NULL REFERENCES municipalidad(id),
    ejercicio        ejercicio NOT NULL,
    ultimo           bigint    NOT NULL DEFAULT 0 CHECK (ultimo >= 0),
    CONSTRAINT liquidacion_correlativo_pk PRIMARY KEY (municipalidad_id, ejercicio)
);

COMMENT ON TABLE liquidacion_correlativo IS
    'El ultimo correlativo de liquidacion de fiscalizacion por municipalidad y ejercicio (#49). '
    'Se lee y se incrementa en una sola sentencia UPSERT; nunca con SELECT + UPDATE. D-09 '
    'decide con que formato se imprime; esta tabla solo garantiza que no se repita ni salte.';

ALTER TABLE liquidacion_correlativo ENABLE ROW LEVEL SECURITY;
ALTER TABLE liquidacion_correlativo FORCE  ROW LEVEL SECURITY;

CREATE POLICY liquidacion_correlativo_tenant ON liquidacion_correlativo
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- A diferencia de la liquidacion, este contador SI se actualiza en el sitio: es
-- infraestructura interna de numeracion, no un acto del procedimiento.
GRANT SELECT, INSERT, UPDATE ON liquidacion_correlativo TO sgtm_app;
GRANT SELECT                 ON liquidacion_correlativo TO sgtm_readonly;

-- ---------- 5. Nada de esto se edita ----------
--
--  Los GRANT de arriba no conceden UPDATE a las tres tablas de la liquidacion,
--  asi que no hay nada que revocar: nacen sin el. Se deja escrito porque es una
--  decision, no un olvido, y porque el escaner de fuentes las incluye en
--  TABLAS_INMUTABLES por el mismo motivo.

-- ---------- 6. El indice que la deteccion de omisos recorre ----------
--
--  «Que contribuyentes con predio no declararon en el ejercicio» se responde
--  cruzando el padron de predios con las declaraciones juradas de ese
--  ejercicio. La segunda mitad de ese cruce es una busqueda por (ejercicio,
--  predio) que hoy no tiene indice: `dj_contribuyente_ix` indexa la otra
--  pregunta -que declaro esta persona-, y sin este la deteccion recorre la
--  tabla entera de declaraciones por cada pagina de omisos.
CREATE INDEX dj_ejercicio_predio_ix
    ON declaracion_jurada (municipalidad_id, ejercicio, predio_id)
    WHERE predio_id IS NOT NULL;

COMMENT ON INDEX dj_ejercicio_predio_ix IS
    'El cruce de RF-055: dado un ejercicio y un predio, si hay declaracion. Sin el, cada '
    'pagina de omisos recorre la tabla de declaraciones entera.';
