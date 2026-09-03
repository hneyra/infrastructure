-- ============================================================================
--  V31 — El convenio de fraccionamiento, de punta a punta (#35, RF-084, RF-085,
--        RF-086)
--
--  `convenio` y `convenio_cuota` existen desde V3, igual que `recibo` existia
--  antes de #33. Lo que faltaba no eran las tablas: era todo lo que convierte
--  un acogimiento en un acto que se puede deshacer centimo a centimo dos anios
--  despues.
--
--  1. EL CONVENIO NO SE EDITA, Y SU ESTADO SE DERIVA. Es la misma decision que
--     V30 tomo para el recibo, por el mismo motivo y con la misma prueba
--     detras. V3 le habia puesto a `convenio` las columnas `estado`,
--     `fecha_estado`, `usuario_estado` y `motivo_estado`; hoy MIENTEN igual que
--     mentian las de `recibo`: `estado` tiene DEFAULT 'VIGENTE', y como la
--     aplicacion no va a poder actualizar la tabla, diria 'VIGENTE' para
--     siempre —tambien de un convenio quebrado—.
--
--     Se retiran. El estado de un convenio pasa a DERIVARSE de
--     `convenio_movimiento`: sin movimientos es un PRECONVENIO; con su
--     FORMALIZACION es VIGENTE; con ANULACION, QUIEBRE o REFORMULACION esta
--     cerrado. Un convenio es un acto administrativo con numeracion propia que
--     el contribuyente firma y se lleva: corregirlo en la base deja al papel y
--     al sistema diciendo cosas distintas.
--
--     La alternativa —alimentar las columnas con un disparador— se descarta por
--     lo que V30 §1 ya explico: ese disparador tendria que ser SECURITY DEFINER
--     y eso es una puerta trasera al propio REVOKE.
--
--  2. `recibo_inicial_id` SE VA CON ELLAS. El recibo de la cuota inicial no
--     existe cuando el preconvenio se registra —es su pago lo que formaliza—,
--     asi que esa columna solo se podria llenar con un UPDATE. Viaja en el
--     movimiento de FORMALIZACION, que es donde el hecho ocurre.
--
--  3. LA DEUDA ORIGINAL SE CONGELA, CON SU FASE. `convenio_deuda` guarda, fila
--     a fila, que obligacion se acogio, en que fase estaba antes y cuanto debia
--     a la fecha de corte, desglosado en sus cuatro partes.
--
--     La FASE es lo que hace posible el quiebre. Fraccionar mueve la deuda a
--     fase CONVENIO con asientos; quebrar tiene que devolverla A LA FASE EN QUE
--     ESTABA, y una deuda que venia de coactiva no puede volver a ordinaria
--     —el expediente sigue vivo—. Sin esta columna habria que adivinarlo, y
--     adivinar aqui significa dejar cobranzas coactivas sin sustento.
--
--     Y el DESGLOSE congelado es lo que permite explicar el convenio sin
--     volver a consultar el libro: dentro de dos anios el libro dira otra cosa
--     —habra mas asientos— y la resolucion de aprobacion tiene que poder
--     explicarse sola. Mismo motivo que `recibo_detalle` (V29) y
--     `valor_detalle` (V3).
--
--  4. REEJECUTAR NO DUPLICA, Y LO IMPIDE LA BASE. `convenio_cuota_uq` ya era
--     UNIQUE (municipalidad_id, convenio_id, numero) desde V3: generar dos
--     veces el cronograma del mismo convenio choca contra el indice, no contra
--     un `if`. Aqui se le agrega el gemelo para la deuda acogida,
--     `convenio_deuda_uq`, sobre COALESCE de las unidades —NULL no choca con
--     NULL, y un predio nulo es tan identificador como uno con valor—.
--
--  5. UN MOVIMIENTO POR ACTO, Y UNO SOLO. `convenio_movimiento` es a `convenio`
--     lo que `recibo_movimiento` es a `recibo` (V30) y `valor_movimiento` a
--     `valor` (V28). Dos indices unicos PARCIALES:
--       - `convenio_movimiento_formalizacion_uq`: una sola formalizacion. Dos
--         acogerian la deuda dos veces y la dejarian debiendo el doble en fase
--         CONVENIO.
--       - `convenio_movimiento_cierre_uq`: un solo cierre. Anular y quebrar el
--         mismo convenio devolveria la deuda dos veces a su fase de origen.
--     Parciales y no UNIQUE(convenio_id, tipo) a proposito: los tres tipos de
--     cierre son excluyentes ENTRE SI, no solo consigo mismos.
--
--  6. EL IMPORTE SE CONGELA EN EL MOVIMIENTO. Como en `recibo_movimiento`
--     (V30 §5): lo que el acogimiento movio, o lo que el quiebre devolvio,
--     copiado y no releido. Es lo que la consulta de convenios muestra sin
--     recorrer el libro, y lo que la aplicacion COMPRUEBA contra lo que
--     `cuentacorriente` dijo haber asentado, en vez de suponerlo.
--
--  7. EL CONJUNTO DE PARAMETROS QUEDA ESCRITO. `convenio.conjunto_id` guarda
--     que conjunto sellado dio el interes y el maximo de cuotas (ARQ-09 §3).
--     Sin el, revisar dentro de dos anios por que el cronograma es el que es
--     resolveria «el vigente» y podria dar otro interes, sin avisar. Ninguna de
--     las dos cifras vive en el codigo (regla 5): las dos entran como
--     parametro, y sus valores los firma D-02b (#191).
--
--  8. NUMERACION PROPIA. `convenio_correlativo`, por municipalidad y ejercicio,
--     mismo patron que `valor_correlativo` (V26) y `recibo_correlativo` (V29):
--     UPSERT en una sola sentencia, nunca SELECT + UPDATE.
--
--  V6 le da RLS a toda tabla con municipalidad_id NOT NULL que existiera AL
--  MOMENTO de correr V6. Las tres tablas nuevas no existian, asi que su RLS y
--  sus privilegios se declaran aqui, explicitos, igual que exige agregar una
--  tabla nueva (CLAUDE.md, "Al agregar una tabla").
--
--  Las columnas NOT NULL se agregan SIN valor por omision a proposito, igual
--  que en V29 y V30: ninguna linea de codigo ha escrito nunca en `convenio` ni
--  en `convenio_cuota` -no tenian repositorio-, asi que estan vacias y el ALTER
--  pasa. Si en algun ambiente NO lo estuvieran, PostgreSQL para la migracion
--  nombrando la columna, que es mejor que inventar un dato.
-- ============================================================================

-- ---------- 1. Las columnas que mentirian ----------
ALTER TABLE convenio DROP CONSTRAINT convenio_estado_ck;
ALTER TABLE convenio DROP CONSTRAINT convenio_recibo_fk;

ALTER TABLE convenio
    DROP COLUMN estado,
    DROP COLUMN fecha_estado,
    DROP COLUMN usuario_estado,
    DROP COLUMN motivo_estado,
    DROP COLUMN recibo_inicial_id;

-- ---------- 2. Lo que al convenio le faltaba ----------
ALTER TABLE convenio
    -- Regla 9: toda cifra dice de cuando es. `monto_total` es la deuda acogida
    -- a ESTA fecha, no la de hoy.
    ADD COLUMN fecha_corte        date         NOT NULL,
    -- ARQ-09 §3: el conjunto CONCRETO del que salieron el interes y el maximo
    -- de cuotas, no «los del ejercicio».
    ADD COLUMN conjunto_id        bigint       NOT NULL,
    -- Lo que ese conjunto dio, copiado: el cronograma tiene que poder
    -- explicarse sin volver a leer los parametros.
    ADD COLUMN interes_mensual    alicuota     NOT NULL,
    ADD COLUMN porcentaje_inicial alicuota     NOT NULL,
    -- El maximo que la ordenanza admitia ESE dia, no el que admite hoy: un
    -- convenio a 12 cuotas firmado cuando el maximo eran 12 sigue siendo
    -- legitimo aunque manana el maximo baje a 6.
    ADD COLUMN maximo_cuotas      smallint     NOT NULL CHECK (maximo_cuotas > 0),
    -- El ofrecimiento de garantia de la pantalla; opcional.
    ADD COLUMN tipo_garantia      varchar(15),
    ADD COLUMN detalle_garantia   varchar(500),
    -- La reformulacion: de que convenio sale este.
    ADD COLUMN convenio_origen_id bigint,
    ADD COLUMN usuario_registro   varchar(60)  NOT NULL,
    ADD COLUMN observacion        varchar(500) NOT NULL,
    ADD COLUMN fecha_registro     timestamptz  NOT NULL;

ALTER TABLE convenio ADD CONSTRAINT convenio_garantia_ck CHECK (
    tipo_garantia IS NULL
    OR tipo_garantia IN ('NO_REQUIERE','CARTA_FIANZA','HIPOTECA','AVAL','PRENDA'));

ALTER TABLE convenio ADD CONSTRAINT convenio_origen_fk
    FOREIGN KEY (municipalidad_id, convenio_origen_id)
    REFERENCES convenio (municipalidad_id, id) NOT VALID;

-- La cuota inicial no puede superar lo acogido: un convenio cuya entrada es
-- mayor que la deuda no es un convenio.
ALTER TABLE convenio ADD CONSTRAINT convenio_inicial_ck
    CHECK (cuota_inicial <= monto_total);

COMMENT ON TABLE convenio IS
    'Un convenio de fraccionamiento (#35, RF-084). NO SE EDITA: su estado se deriva de '
    'convenio_movimiento -sin movimientos es un preconvenio; con su FORMALIZACION es vigente; '
    'con ANULACION, QUIEBRE o REFORMULACION esta cerrado-. Las columnas de estado que V3 le '
    'habia puesto se retiraron en V31 por decir VIGENTE para siempre, igual que las de recibo '
    'decian EMITIDO (V30).';

COMMENT ON COLUMN convenio.fecha_corte IS
    'A que fecha esta la deuda acogida que monto_total resume (regla 9, RNF-075). No es la '
    'fecha del convenio: entre la simulacion y la firma la deuda devenga, y el papel tiene que '
    'decir con que corte se calculo.';

COMMENT ON COLUMN convenio.conjunto_id IS
    'El conjunto sellado de parametros que dio el interes y el maximo de cuotas (ARQ-09 §3). '
    'Recalcular este cronograma en 2037 recupera ESTE conjunto, no «los parametros de 2027»: '
    'si entre medias se sello otra version, resolver por ejercicio daria otro interes sin que '
    'nada falle.';

COMMENT ON COLUMN convenio.interes_mensual IS
    'El interes de fraccionamiento mensual que se aplico, copiado del conjunto sellado. Su '
    'VALOR no vive en el codigo (regla 5) y lo firma D-02b (#191): aqui solo queda constancia '
    'de cual se uso.';

-- ---------- 3. La cuota, congelada ----------
--
--  Igual que `recibo_detalle`: el desglose se guarda parte por parte y no como
--  un total. `monto` es la suma, y la base lo comprueba.
ALTER TABLE convenio_cuota
    ADD COLUMN capital dinero NOT NULL DEFAULT 0 CHECK (capital >= 0),
    ADD COLUMN interes dinero NOT NULL DEFAULT 0 CHECK (interes >= 0),
    ADD COLUMN gasto   dinero NOT NULL DEFAULT 0 CHECK (gasto   >= 0);

ALTER TABLE convenio_cuota ADD CONSTRAINT convenio_cuota_desglose_ck
    CHECK (monto = capital + interes + gasto);

-- La cuota 0 es la inicial. V3 no acotaba `numero`; se acota ahora, porque un
-- numero negativo no es ninguna cuota.
ALTER TABLE convenio_cuota ADD CONSTRAINT convenio_cuota_numero_ck
    CHECK (numero >= 0);

-- `estado` y `recibo_id` se retiran por el mismo motivo que las de `convenio`:
-- solo se podrian escribir con un UPDATE que la tabla ya no va a admitir. Que
-- una cuota este pagada se DERIVA de que exista su movimiento.
ALTER TABLE convenio_cuota DROP CONSTRAINT convenio_cuota_recibo_fk;

ALTER TABLE convenio_cuota
    DROP COLUMN estado,
    DROP COLUMN recibo_id;

-- V3 se olvido de la clave foranea a municipalidad en esta tabla: la columna
-- era NOT NULL pero no referenciaba nada, asi que una fila podia nombrar una
-- municipalidad inexistente. Va NOT VALID por DAT-01 §0 hallazgo 4.
ALTER TABLE convenio_cuota ADD CONSTRAINT convenio_cuota_municipalidad_fk
    FOREIGN KEY (municipalidad_id) REFERENCES municipalidad(id) NOT VALID;

COMMENT ON TABLE convenio_cuota IS
    'El cronograma del convenio, congelado (#35). La cuota 0 es la inicial. No se edita: que '
    'una cuota este pagada se deriva de convenio_movimiento, no de una columna que habria que '
    'actualizar.';

-- ---------- 4. La deuda acogida, con su fase de origen ----------
CREATE TABLE convenio_deuda (
    municipalidad_id bigint      NOT NULL REFERENCES municipalidad(id),
    id               bigint      GENERATED ALWAYS AS IDENTITY,
    convenio_id      bigint      NOT NULL,
    tributo          varchar(20) NOT NULL,
    ejercicio        ejercicio   NOT NULL,
    -- 0 es «anual», igual que en saldo_proyectado (V2).
    periodo          smallint    NOT NULL DEFAULT 0
        CHECK (periodo BETWEEN 0 AND 12),
    predio_id        bigint,
    vehiculo_id      bigint,
    -- En que fase estaba ANTES de acogerse. Es a donde vuelve si el convenio se
    -- quiebra: una deuda que venia de coactiva no puede volver a ordinaria.
    fase_origen      varchar(10) NOT NULL
        CHECK (fase_origen IN ('ORDINARIA','VALOR','COACTIVA')),
    -- El desglose a la fecha de corte, congelado.
    insoluto         dinero      NOT NULL DEFAULT 0 CHECK (insoluto >= 0),
    reajuste         dinero      NOT NULL DEFAULT 0 CHECK (reajuste >= 0),
    interes          dinero      NOT NULL DEFAULT 0 CHECK (interes  >= 0),
    gasto            dinero      NOT NULL DEFAULT 0 CHECK (gasto    >= 0),
    monto            dinero      NOT NULL CHECK (monto > 0),
    fecha_corte      date        NOT NULL,
    CONSTRAINT convenio_deuda_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT convenio_deuda_convenio_fk FOREIGN KEY (municipalidad_id, convenio_id)
        REFERENCES convenio (municipalidad_id, id) NOT VALID,
    CONSTRAINT convenio_deuda_desglose_ck
        CHECK (monto = insoluto + reajuste + interes + gasto),
    CONSTRAINT convenio_deuda_unidad_ck
        CHECK (predio_id IS NULL OR vehiculo_id IS NULL)
);

COMMENT ON TABLE convenio_deuda IS
    'Que deuda se acogio a un convenio, en que fase estaba y cuanto debia a la fecha de corte '
    '(#35). Es la «deuda original» de la consulta, y su fase_origen es lo que hace posible el '
    'quiebre: devolverla a ordinaria cuando venia de coactiva dejaria el expediente sin '
    'sustento.';

COMMENT ON COLUMN convenio_deuda.fase_origen IS
    'La fase en que la obligacion estaba antes del acogimiento. Tesoreria la guarda y la '
    'devuelve tal cual; no la interpreta -las fases son de cuentacorriente-.';

-- Reejecutar el acogimiento no duplica, y lo impide la base. COALESCE porque
-- NULL no choca con NULL, y un predio nulo identifica igual que uno con valor.
CREATE UNIQUE INDEX convenio_deuda_uq
    ON convenio_deuda (municipalidad_id, convenio_id, tributo, ejercicio, periodo,
                       COALESCE(predio_id, 0), COALESCE(vehiculo_id, 0));

CREATE INDEX convenio_deuda_convenio_ix
    ON convenio_deuda (municipalidad_id, convenio_id);

ALTER TABLE convenio_deuda ENABLE ROW LEVEL SECURITY;
ALTER TABLE convenio_deuda FORCE  ROW LEVEL SECURITY;

CREATE POLICY convenio_deuda_tenant ON convenio_deuda
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

GRANT SELECT, INSERT ON convenio_deuda TO sgtm_app;
GRANT SELECT          ON convenio_deuda TO sgtm_readonly;

-- ---------- 5. Lo que le pasa a un convenio ----------
CREATE TABLE convenio_movimiento (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    convenio_id      bigint       NOT NULL,
    -- FORMALIZACION lo pone en vigor cobrando su inicial; los otros tres lo
    -- cierran devolviendo la deuda a su fase de origen.
    tipo             varchar(14)  NOT NULL
        CHECK (tipo IN ('FORMALIZACION','ANULACION','QUIEBRE','REFORMULACION')),
    fecha            date         NOT NULL,
    -- Solo la formalizacion: con que recibo y por que cuota.
    recibo_id        bigint,
    cuota            smallint CHECK (cuota IS NULL OR cuota >= 0),
    -- Solo el cierre: por que, quien lo autorizo y con que documento.
    motivo           varchar(80),
    autorizado_por   varchar(80),
    documento_autorizacion varchar(40),
    -- Lo que se movio (formalizacion) o lo que se devolvio (cierre), congelado.
    importe          dinero       NOT NULL CHECK (importe >= 0),
    -- Cuantas filas se escribieron en el libro. Nunca cuantas se borraron,
    -- porque no se borra ninguna.
    asientos         integer      NOT NULL DEFAULT 0 CHECK (asientos >= 0),
    -- Solo la reformulacion: el convenio que sustituye a este.
    convenio_nuevo_id bigint,
    usuario_registro varchar(60)  NOT NULL,
    fecha_registro   timestamptz  NOT NULL,
    observacion      varchar(500) NOT NULL,
    CONSTRAINT convenio_movimiento_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT convenio_movimiento_convenio_fk FOREIGN KEY (municipalidad_id, convenio_id)
        REFERENCES convenio (municipalidad_id, id) NOT VALID,
    CONSTRAINT convenio_movimiento_recibo_fk FOREIGN KEY (municipalidad_id, recibo_id)
        REFERENCES recibo (municipalidad_id, id) NOT VALID,
    CONSTRAINT convenio_movimiento_nuevo_fk FOREIGN KEY (municipalidad_id, convenio_nuevo_id)
        REFERENCES convenio (municipalidad_id, id) NOT VALID,
    -- Formalizar exige el recibo que lo formaliza y la cuota que pago. Sin
    -- recibo no hay convenio: es el criterio de aceptacion de #35.
    CONSTRAINT convenio_movimiento_formalizacion_ck CHECK (
        tipo <> 'FORMALIZACION' OR (recibo_id IS NOT NULL AND cuota IS NOT NULL)),
    -- Y cerrar exige constancia de por que. Un motivo en blanco no es un
    -- motivo: `btrim` lo dice, para que no baste con mandar espacios (RNF-052).
    CONSTRAINT convenio_movimiento_cierre_ck CHECK (
        tipo = 'FORMALIZACION'
        OR (motivo IS NOT NULL AND btrim(motivo) <> '')),
    -- Solo la reformulacion nombra un convenio nuevo.
    CONSTRAINT convenio_movimiento_reformulacion_ck CHECK (
        (tipo = 'REFORMULACION') = (convenio_nuevo_id IS NOT NULL))
);

COMMENT ON TABLE convenio_movimiento IS
    'Lo que le pasa a un convenio despues de registrarse (#35, RF-085, RF-086): FORMALIZACION, '
    'ANULACION, QUIEBRE o REFORMULACION. Solo se agrega. El estado de un convenio se DERIVA de '
    'aqui, porque el convenio no se edita (V31); es a convenio lo que recibo_movimiento (V30) '
    'es a recibo y valor_movimiento (V28) a valor.';

COMMENT ON COLUMN convenio_movimiento.importe IS
    'Lo que el acogimiento movio a fase CONVENIO, o lo que el cierre devolvio a su fase de '
    'origen. Congelado y no releido: dentro de dos anios el libro dira otra cosa. La '
    'aplicacion lo COMPRUEBA contra lo que cuentacorriente dijo haber asentado, en vez de '
    'suponerlo.';

-- Una sola formalizacion: dos acogerian la deuda dos veces.
CREATE UNIQUE INDEX convenio_movimiento_formalizacion_uq
    ON convenio_movimiento (municipalidad_id, convenio_id)
    WHERE tipo = 'FORMALIZACION';

-- Y un solo cierre: anular y quebrar el mismo convenio devolveria la deuda dos
-- veces. Parcial sobre los TRES tipos a la vez, porque son excluyentes entre
-- si y no solo consigo mismos.
CREATE UNIQUE INDEX convenio_movimiento_cierre_uq
    ON convenio_movimiento (municipalidad_id, convenio_id)
    WHERE tipo IN ('ANULACION','QUIEBRE','REFORMULACION');

CREATE INDEX convenio_movimiento_convenio_ix
    ON convenio_movimiento (municipalidad_id, convenio_id, tipo);

ALTER TABLE convenio_movimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE convenio_movimiento FORCE  ROW LEVEL SECURITY;

CREATE POLICY convenio_movimiento_tenant ON convenio_movimiento
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

GRANT SELECT, INSERT ON convenio_movimiento TO sgtm_app;
GRANT SELECT          ON convenio_movimiento TO sgtm_readonly;

-- ---------- 6. Ni el convenio ni su cronograma se actualizan ----------
REVOKE UPDATE ON convenio       FROM sgtm_app;
REVOKE UPDATE ON convenio_cuota FROM sgtm_app;

-- ---------- 7. La numeracion ----------
CREATE TABLE convenio_correlativo (
    municipalidad_id bigint    NOT NULL REFERENCES municipalidad(id),
    ejercicio        ejercicio NOT NULL,
    ultimo           bigint    NOT NULL DEFAULT 0 CHECK (ultimo >= 0),
    CONSTRAINT convenio_correlativo_pk PRIMARY KEY (municipalidad_id, ejercicio)
);

COMMENT ON TABLE convenio_correlativo IS
    'El ultimo correlativo de convenio emitido por municipalidad y ejercicio (#35). Se lee y '
    'se incrementa en una sola sentencia UPSERT; nunca con SELECT + UPDATE.';

ALTER TABLE convenio_correlativo ENABLE ROW LEVEL SECURITY;
ALTER TABLE convenio_correlativo FORCE  ROW LEVEL SECURITY;

CREATE POLICY convenio_correlativo_tenant ON convenio_correlativo
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- A diferencia del convenio, este contador SI se actualiza en el sitio: es
-- infraestructura interna de numeracion, no un acto administrativo (mismo
-- criterio que valor_correlativo en V26 y recibo_correlativo en V29).
GRANT SELECT, INSERT, UPDATE ON convenio_correlativo TO sgtm_app;
GRANT SELECT                 ON convenio_correlativo TO sgtm_readonly;

-- ---------- 8. Los accesos de la consulta ----------
--
--  La pantalla filtra por numero -ya unico-, por contribuyente -ya indexado en
--  V3- y por rango de fechas, que es el que faltaba.
CREATE INDEX convenio_fecha_ix ON convenio (municipalidad_id, fecha);
