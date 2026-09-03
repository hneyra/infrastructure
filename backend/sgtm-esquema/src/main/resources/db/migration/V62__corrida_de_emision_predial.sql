-- La corrida de emision predial deja rastro (#523).
--
-- POR QUE HACE FALTA. `DeterminarPredialMasivo` compone su resumen en memoria
-- —las cinco etapas y la lista de observados— y lo devuelve en la respuesta del
-- `POST` que la ejecuta. Ahi muere. Lo que si queda escrito son las
-- determinaciones que asienta; lo que se pierde es el resumen y, sobre todo,
-- **los observados**: por definicion son los contribuyentes que NO tienen
-- determinacion, asi que no se pueden recomponer leyendo el padron.
--
-- Consecuencia: cerrar la pestana pierde el resultado de un proceso que toca
-- decenas de miles de cuentas, y no hay forma de volver a verlo salvo volver a
-- correrlo. El panel del modulo de Rentas (#503 F6) se quedo sin construir por
-- esto.
--
-- LA FORMA ES LA DE `valor_masivo` (V27) Y `papeleta_masivo` (V47): cabecera con
-- sus criterios y sus totales, y una fila por item. Es la tercera corrida masiva
-- del sistema y la primera que no se guardaba.

-- ---------- 1. La corrida ----------
CREATE TABLE corrida_predial (
    municipalidad_id  bigint       NOT NULL REFERENCES municipalidad(id),
    id                bigint       GENERATED ALWAYS AS IDENTITY,
    ejercicio         ejercicio    NOT NULL,
    alcance           varchar(10)  NOT NULL CHECK (alcance IN ('TODOS', 'SECTOR')),
    sector            varchar(10),
    modalidad         varchar(20)  NOT NULL,
    simulacion        boolean      NOT NULL,
    conjunto          varchar(60)  NOT NULL,
    leidos            integer      NOT NULL CHECK (leidos >= 0),
    determinados      integer      NOT NULL CHECK (determinados >= 0),
    monto_emitido     dinero       NOT NULL,
    fecha_calculo     date         NOT NULL,
    usuario_registro  varchar(60)  NOT NULL,
    fecha_registro    timestamptz  NOT NULL,
    observacion       varchar(500) NOT NULL,
    CONSTRAINT corrida_predial_pk PRIMARY KEY (municipalidad_id, id),
    -- El alcance por sector necesita decir cual: sin el, «solo el sector» y
    -- «todo el padron» serian la misma corrida (mismo motivo que la guarda de
    -- `DeterminarPredialMasivo.Peticion`).
    CONSTRAINT corrida_predial_sector_ck CHECK (alcance <> 'SECTOR' OR sector IS NOT NULL),
    -- Los determinados salen de los leidos: una corrida que dice haber
    -- determinado a mas de los que miro no describe nada.
    CONSTRAINT corrida_predial_cuenta_ck CHECK (determinados <= leidos)
);

COMMENT ON TABLE corrida_predial IS
    'Lo que hizo una corrida de emision anual del predial (#523). Un hecho, no un borrador: '
    'sin UPDATE ni DELETE, igual que valor_masivo (V27) y papeleta_masivo (V47).';

COMMENT ON COLUMN corrida_predial.conjunto IS
    'El conjunto sellado con el que se emitio (ARQ-09 §3). Sin el, la corrida no se puede '
    'repetir dentro de diez anios y dar lo mismo. Vacio si no se determino ninguna.';

COMMENT ON COLUMN corrida_predial.fecha_calculo IS
    'El dia al que corresponden sus cifras (regla 9). Sale del reloj inyectado, no de now(): '
    'la fila tiene que caer en el mismo dia con que se determino.';

COMMENT ON COLUMN corrida_predial.leidos IS
    'Cuantos contribuyentes miro en total. Determinados + observados, y se guarda en vez de '
    'derivarse porque los observados se pueden purgar y la etapa «padron leido» no.';

ALTER TABLE corrida_predial ENABLE ROW LEVEL SECURITY;
ALTER TABLE corrida_predial FORCE  ROW LEVEL SECURITY;

CREATE POLICY corrida_predial_tenant ON corrida_predial
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- Sin UPDATE ni DELETE: una corrida es un hecho. Corregir lo que emitio se hace
-- corriendo otra, que deja su propia fila.
GRANT SELECT, INSERT ON corrida_predial TO sgtm_app;
GRANT SELECT          ON corrida_predial TO sgtm_readonly;

-- La ultima de un ejercicio es la consulta de la pantalla, y la unica.
CREATE INDEX corrida_predial_ejercicio_ix
    ON corrida_predial (municipalidad_id, ejercicio, id DESC);

-- ---------- 2. Los observados ----------
CREATE TABLE corrida_predial_observado (
    municipalidad_id   bigint       NOT NULL,
    id                 bigint       GENERATED ALWAYS AS IDENTITY,
    corrida_id         bigint       NOT NULL,
    cod_contribuyente  varchar(20)  NOT NULL,
    nombre             varchar(200) NOT NULL,
    motivo             varchar(500) NOT NULL,
    CONSTRAINT corrida_predial_observado_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT corrida_predial_observado_corrida_fk
        FOREIGN KEY (municipalidad_id, corrida_id)
        REFERENCES corrida_predial (municipalidad_id, id)
);

COMMENT ON TABLE corrida_predial_observado IS
    'Un contribuyente que quedo fuera de la emision, con su motivo (#523). Es lo unico que '
    'convierte «emitio menos de lo esperado» en una lista de cosas que arreglar, y lo unico '
    'de la corrida que no se puede recomponer leyendo el padron: un observado es, por '
    'definicion, el que NO tiene determinacion.';

COMMENT ON COLUMN corrida_predial_observado.motivo IS
    'Por que quedo fuera, redactado por el caso de uso. Un observado sin motivo no se puede '
    'arreglar, que es para lo que existe esta tabla.';

ALTER TABLE corrida_predial_observado ENABLE ROW LEVEL SECURITY;
ALTER TABLE corrida_predial_observado FORCE  ROW LEVEL SECURITY;

CREATE POLICY corrida_predial_observado_tenant ON corrida_predial_observado
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

GRANT SELECT, INSERT ON corrida_predial_observado TO sgtm_app;
GRANT SELECT          ON corrida_predial_observado TO sgtm_readonly;

CREATE INDEX corrida_predial_observado_corrida_ix
    ON corrida_predial_observado (municipalidad_id, corrida_id, id);
