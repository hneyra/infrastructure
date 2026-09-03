-- ============================================================================
--  V28 — Lo que le pasa a un valor despues de emitido (#39)
--
--  Se notifica, puede prescribir, y si no se paga pasa a coactiva. Las tres
--  cosas comparten una propiedad: son actos administrativos, no estados de un
--  proceso interno. Por eso ninguna de las tablas de aqui recibe UPDATE ni
--  DELETE (regla 4, RNF-051) -a diferencia de valor_correlativo (V26) y de
--  valor_masivo_item (V27), que si lo reciben porque son infraestructura-.
--
--  1. `notificacion` ya existia desde V3, pero le faltaba todo lo que hace
--     util un acuse: quien recibio, en que intento, y -sobre todo- desde
--     cuando la deuda es exigible. Esa fecha es la que hace posible el
--     expediente coactivo: sin ella es nulo.
--
--  2. `valor_movimiento` es el pase a coactiva (PCO), lo que #40 importara.
--     Su indice unico parcial es la idempotencia del AC: un valor tiene UN
--     pase, y pedirlo dos veces no crea dos expedientes. La garantia esta en
--     la base y no en un `if` de la aplicacion, porque dos peticiones
--     simultaneas pasan el `if` las dos.
--
--  3. `prescripcion` + `prescripcion_ejercicio` + `prescripcion_hecho` son la
--     declaracion y su computo. La declaracion NO borra deuda: marca. Por eso
--     el libro de asientos no se toca aqui -no hay una sola sentencia contra
--     cuenta_corriente_asiento en esta migracion-, y lo unico que cambia en
--     `valor` es su columna `estado`.
--
--     `prescripcion_hecho` es ademas la respuesta a lo que el archivo
--     `docs/10-negocio/valores-normativos/prescripcion-y-plazos.md` §3 dejaba
--     anotado como «lo que no cabe hoy»: no habia donde guardar, fila a fila,
--     que causal de interrupcion o de suspension se activo para una deuda
--     concreta. Ahora la hay.
--
--  V6 le da RLS a toda tabla con municipalidad_id NOT NULL que existiera AL
--  MOMENTO de correr V6. Las cuatro tablas nuevas de aqui no existian, asi que
--  su RLS y sus privilegios se declaran explicitos, igual que exige agregar una
--  tabla nueva (CLAUDE.md, "Al agregar una tabla").
-- ============================================================================

-- ---------- 1. La notificacion, con su acuse ----------
--
--  Las columnas NOT NULL se agregan SIN valor por omision a proposito. Hasta
--  #39 ninguna linea de codigo escribia en `notificacion` -la tabla existe
--  desde V3 y no tenia repositorio-, asi que esta vacia y el ALTER pasa. Si en
--  algun ambiente NO lo estuviera, PostgreSQL rechaza la migracion nombrando la
--  columna, que es exactamente lo que queremos: mejor una migracion que se
--  para que un `usuario_registro = ''` inventado en 200 000 acuses.
ALTER TABLE notificacion
    ADD COLUMN intento            smallint     NOT NULL DEFAULT 1 CHECK (intento > 0),
    ADD COLUMN receptor           varchar(120),
    ADD COLUMN documento_receptor varchar(20),
    ADD COLUMN vinculo            varchar(40),
    ADD COLUMN exigible_desde     date,
    ADD COLUMN conjunto_id        bigint,
    ADD COLUMN usuario_registro   varchar(60)  NOT NULL,
    ADD COLUMN fecha_registro     timestamptz  NOT NULL DEFAULT now();

-- Una diligencia sin fecha, sin resultado o sin el porque de quien la registro
-- no es un acuse: es una fila. La fecha de notificacion es la que hace exigible
-- la deuda (#39), y la observacion la exige la regla 10.
ALTER TABLE notificacion ALTER COLUMN fecha_notificacion SET NOT NULL;
ALTER TABLE notificacion ALTER COLUMN resultado          SET NOT NULL;
ALTER TABLE notificacion ALTER COLUMN observacion        SET NOT NULL;

-- `PENDIENTE` sale del dominio de resultados: una fila de `notificacion` se
-- escribe DESPUES de la diligencia, con lo que paso. Un acuse pendiente es una
-- notificacion que todavia no ocurrio, y de eso no hay fila. Los tres que
-- quedan son los del issue: notificado, no hallado y rechazado.
ALTER TABLE notificacion DROP CONSTRAINT notificacion_resultado_check;
ALTER TABLE notificacion ADD CONSTRAINT notificacion_resultado_ck
    CHECK (resultado IN ('NOTIFICADO', 'NO_UBICADO', 'RECHAZADO'));

-- El reintento: cada diligencia es una fila, y la anterior se queda donde
-- estaba (AC de #39). La unicidad por intento es lo que impide que reintentar
-- dos veces "el intento 2" sobreescriba la traza sin que se note.
ALTER TABLE notificacion ADD CONSTRAINT notificacion_intento_uq
    UNIQUE (municipalidad_id, objeto, objeto_id, intento);

-- Exigibilidad: solo la diligencia que surte efecto la fija, y cuando la fija
-- deja constancia de CON QUE conjunto sellado se calculo el plazo (ARQ-09 §3:
-- resolver por ejercicio en un recalculo devuelve otra cifra sin avisar).
--
--  Que RECHAZADO tambien la fije no es un descuido: el art. 104 a) del TUO del
--  Codigo Tributario admite "la certificacion de la negativa a la recepcion"
--  como forma de notificacion valida. Lo que no surte efecto es NO_UBICADO, y
--  por eso ese es el unico que se reintenta.
ALTER TABLE notificacion ADD CONSTRAINT notificacion_exigibilidad_ck
    CHECK (
        (resultado IN ('NOTIFICADO', 'RECHAZADO'))
        = (exigible_desde IS NOT NULL AND conjunto_id IS NOT NULL));

-- La clave foranea del conjunto va NOT VALID a proposito (DAT-01 §0, hallazgo
-- 4): validarla es una consulta, y el migrador corre sin contexto de tenant, de
-- modo que la validacion no veria ninguna fila bajo RLS. NOT VALID sigue
-- comprobando cada INSERT, que es lo que importa de aqui en adelante.
ALTER TABLE notificacion ADD CONSTRAINT notificacion_conjunto_fk
    FOREIGN KEY (municipalidad_id, conjunto_id)
    REFERENCES conjunto_parametros (municipalidad_id, id) NOT VALID;

COMMENT ON COLUMN notificacion.exigible_desde IS
    'Desde cuando la deuda del valor notificado es exigible: se deriva de la fecha de la '
    'diligencia y del plazo PARAMETRIZADO, nunca de una constante (#39, regla 5). Sin ella '
    'el expediente coactivo es nulo.';

COMMENT ON COLUMN notificacion.intento IS
    'Que diligencia es. Una no hallada no se corrige: se registra otra con el intento '
    'siguiente, y la anterior se queda (AC de #39).';

-- V7 concedia UPDATE sobre `notificacion` junto con el resto de las tablas de
-- negocio. Se retira: una diligencia es un acto administrativo, no el estado de
-- un proceso interno. Corregir una notificacion "porque el notificador se
-- equivoco de fecha" es reescribir la constancia de la que depende que un
-- expediente coactivo sea valido. Lo que hay es reintentar, con otra fila.
REVOKE UPDATE ON notificacion FROM sgtm_app;

-- ---------- 2. El pase a coactiva ----------
CREATE TABLE valor_movimiento (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    valor_id         bigint       NOT NULL,
    tipo             varchar(3)   NOT NULL CHECK (tipo IN ('PCO', 'ACO', 'RCO')),
    fecha            date         NOT NULL,
    -- Que diligencia lo hizo exigible, y desde cuando. Se copian aqui y no se
    -- releen: el pase tiene que poder explicarse dentro de dos anios con lo que
    -- guarda su propia fila, igual que el desglose congelado de `valor`.
    notificacion_id  bigint       NOT NULL,
    exigible_desde   date         NOT NULL,
    usuario_registro varchar(60)  NOT NULL,
    fecha_registro   timestamptz  NOT NULL DEFAULT now(),
    observacion      varchar(500) NOT NULL,
    CONSTRAINT valor_movimiento_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT valor_movimiento_valor_fk FOREIGN KEY (municipalidad_id, valor_id)
        REFERENCES valor (municipalidad_id, id),
    CONSTRAINT valor_movimiento_notificacion_fk FOREIGN KEY (municipalidad_id, notificacion_id)
        REFERENCES notificacion (municipalidad_id, id),
    -- Un pase solo puede ser posterior a la fecha desde la que la deuda es
    -- exigible; si no, el expediente nace sin sustento.
    CONSTRAINT valor_movimiento_exigible_ck CHECK (fecha >= exigible_desde)
);

-- La idempotencia del AC, en la base: un valor tiene UN pase a coactiva. Como
-- indice unico parcial y no como UNIQUE(valor_id, tipo), porque ACO y RCO son
-- la respuesta de coactiva (#40) y pueden repetirse; el que no puede es PCO.
CREATE UNIQUE INDEX valor_movimiento_pase_uq
    ON valor_movimiento (municipalidad_id, valor_id)
    WHERE tipo = 'PCO';

COMMENT ON TABLE valor_movimiento IS
    'El movimiento de un valor hacia coactiva (#39, RF-095): PCO pase, ACO aceptado, '
    'RCO rechazado. Es lo que `coactiva` importa (#40). Solo se agrega: un movimiento '
    'equivocado se corrige con otro movimiento, no editando el anterior.';

ALTER TABLE valor_movimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE valor_movimiento FORCE  ROW LEVEL SECURITY;

CREATE POLICY valor_movimiento_tenant ON valor_movimiento
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

GRANT SELECT, INSERT ON valor_movimiento TO sgtm_app;
GRANT SELECT          ON valor_movimiento TO sgtm_readonly;

-- ---------- 3. La prescripcion ----------
--
--  La solicitud es por contribuyente, tributo y RANGO de ejercicios -asi la
--  pide la pantalla del manual-, y por eso el resultado puede ser "procede en
--  parte": el computo se resuelve ejercicio por ejercicio, en
--  `prescripcion_ejercicio`, y el resultado de la cabecera lo resume.
CREATE TABLE prescripcion (
    municipalidad_id   bigint       NOT NULL REFERENCES municipalidad(id),
    id                 bigint       GENERATED ALWAYS AS IDENTITY,
    contribuyente_id   bigint       NOT NULL,
    tributo            varchar(20)  NOT NULL,
    ejercicio_desde    ejercicio    NOT NULL,
    ejercicio_hasta    ejercicio    NOT NULL,
    fecha_presentacion date         NOT NULL,
    -- Cual de los tres plazos del art. 43 del TUO del Codigo Tributario aplica.
    -- La causal la declara quien resuelve; el numero de anios NO esta aqui:
    -- sale del parametro sellado (regla 5).
    causal             varchar(24)  NOT NULL
        CHECK (causal IN ('DECLARACION_PRESENTADA', 'SIN_DECLARACION', 'AGENTE_RETENCION')),
    plazo_anios        smallint     NOT NULL CHECK (plazo_anios > 0),
    conjunto_id        bigint       NOT NULL,
    resultado          varchar(16)  NOT NULL
        CHECK (resultado IN ('PROCEDE', 'PROCEDE_EN_PARTE', 'NO_PROCEDE')),
    resolucion         varchar(40),
    usuario_registro   varchar(60)  NOT NULL,
    fecha_registro     timestamptz  NOT NULL DEFAULT now(),
    observacion        varchar(500) NOT NULL,
    CONSTRAINT prescripcion_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT prescripcion_ejercicios_ck CHECK (ejercicio_desde <= ejercicio_hasta),
    CONSTRAINT prescripcion_contribuyente_fk FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id),
    CONSTRAINT prescripcion_conjunto_fk FOREIGN KEY (municipalidad_id, conjunto_id)
        REFERENCES conjunto_parametros (municipalidad_id, id)
);

COMMENT ON TABLE prescripcion IS
    'La declaracion de prescripcion de la accion de cobro (#39, RF-094). No borra deuda: '
    'la marca. El libro de asientos no se toca, y los valores alcanzados pasan a estado '
    'PRESCRITO (regla 4).';

COMMENT ON COLUMN prescripcion.conjunto_id IS
    'De que conjunto sellado salio plazo_anios. Sin esto, revisar la resolucion dentro de '
    'dos anios resolveria "el vigente del ejercicio" y podria dar otro plazo (ARQ-09 §3).';

CREATE TABLE prescripcion_ejercicio (
    municipalidad_id   bigint    NOT NULL,
    id                 bigint    GENERATED ALWAYS AS IDENTITY,
    prescripcion_id    bigint    NOT NULL,
    ejercicio          ejercicio NOT NULL,
    -- El dia 1 del computo (art. 44) y el dia 1 que quedo tras las
    -- interrupciones. Se guardan los dos porque la resolucion tiene que poder
    -- explicar por que la fecha de prescripcion no es inicio + plazo.
    inicio_computo     date      NOT NULL,
    inicio_vigente     date      NOT NULL,
    fecha_prescripcion date      NOT NULL,
    prescrita          boolean   NOT NULL,
    CONSTRAINT prescripcion_ejercicio_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT prescripcion_ejercicio_uq
        UNIQUE (municipalidad_id, prescripcion_id, ejercicio),
    CONSTRAINT prescripcion_ejercicio_fk FOREIGN KEY (municipalidad_id, prescripcion_id)
        REFERENCES prescripcion (municipalidad_id, id),
    CONSTRAINT prescripcion_ejercicio_orden_ck CHECK (inicio_vigente >= inicio_computo)
);

CREATE TABLE prescripcion_hecho (
    municipalidad_id bigint       NOT NULL,
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    prescripcion_id  bigint       NOT NULL,
    clase            varchar(12)  NOT NULL CHECK (clase IN ('INTERRUPCION', 'SUSPENSION')),
    -- La causal tal como la nombra el art. 45 o el 46. Es texto y no un
    -- catalogo cerrado porque las causales cambian con la norma, y una lista
    -- compilada obligaria a desplegar para admitir una nueva.
    causal           varchar(120) NOT NULL,
    fecha_desde      date         NOT NULL,
    fecha_hasta      date,
    CONSTRAINT prescripcion_hecho_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT prescripcion_hecho_fk FOREIGN KEY (municipalidad_id, prescripcion_id)
        REFERENCES prescripcion (municipalidad_id, id),
    -- Una interrupcion es un instante; una suspension es un intervalo.
    CONSTRAINT prescripcion_hecho_fechas_ck CHECK (
        (clase = 'INTERRUPCION' AND fecha_hasta IS NULL)
        OR (clase = 'SUSPENSION' AND fecha_hasta IS NOT NULL AND fecha_hasta >= fecha_desde))
);

COMMENT ON TABLE prescripcion_hecho IS
    'Que causal de interrupcion (art. 45) o de suspension (art. 46) entro en el computo, '
    'fila a fila. Es lo que NEG-02 anotaba como "lo que no cabe hoy" en '
    'docs/10-negocio/valores-normativos/prescripcion-y-plazos.md §3.';

ALTER TABLE prescripcion            ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescripcion            FORCE  ROW LEVEL SECURITY;
ALTER TABLE prescripcion_ejercicio  ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescripcion_ejercicio  FORCE  ROW LEVEL SECURITY;
ALTER TABLE prescripcion_hecho      ENABLE ROW LEVEL SECURITY;
ALTER TABLE prescripcion_hecho      FORCE  ROW LEVEL SECURITY;

CREATE POLICY prescripcion_tenant ON prescripcion
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

CREATE POLICY prescripcion_ejercicio_tenant ON prescripcion_ejercicio
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

CREATE POLICY prescripcion_hecho_tenant ON prescripcion_hecho
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

GRANT SELECT, INSERT ON prescripcion, prescripcion_ejercicio, prescripcion_hecho TO sgtm_app;
GRANT SELECT          ON prescripcion, prescripcion_ejercicio, prescripcion_hecho TO sgtm_readonly;

-- ---------- Indices ----------
CREATE INDEX valor_movimiento_valor_ix   ON valor_movimiento (municipalidad_id, valor_id, fecha);
CREATE INDEX prescripcion_contribuyente_ix
    ON prescripcion (municipalidad_id, contribuyente_id, tributo);
CREATE INDEX prescripcion_ejercicio_ix
    ON prescripcion_ejercicio (municipalidad_id, prescripcion_id);
CREATE INDEX prescripcion_hecho_ix
    ON prescripcion_hecho (municipalidad_id, prescripcion_id);
