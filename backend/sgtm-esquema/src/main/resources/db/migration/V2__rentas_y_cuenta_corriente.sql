-- ============================================================================
--  V2 — Rentas y cuenta corriente
--
--  Vehiculos, declaraciones juradas, beneficios, transferencias, espectaculos,
--  determinacion y el libro de asientos de la cuenta corriente (ADR-0006).
--
--  Dos tablas se particionan por ejercicio (ADR-0004): determinacion y
--  cuenta_corriente_asiento. Toda particion nueva debe repetir el bloque de RLS
--  explicita de V6 y NO recibir ningun privilegio.
-- ============================================================================

-- ---------- Vehiculos ----------
CREATE TABLE vehiculo (
    municipalidad_id  bigint      NOT NULL REFERENCES municipalidad(id),
    id                bigint      GENERATED ALWAYS AS IDENTITY,
    placa             varchar(10) NOT NULL,
    contribuyente_id  bigint      NOT NULL,
    marca             varchar(60) NOT NULL,
    modelo            varchar(60) NOT NULL,
    categoria         varchar(20),
    anio_fabricacion  ejercicio   NOT NULL,
    anio_inscripcion  ejercicio   NOT NULL,
    fecha_adquisicion date,
    valor_adquisicion dinero,
    numero_motor      varchar(40),
    numero_serie      varchar(40),
    estado            varchar(20) NOT NULL DEFAULT 'ACTIVO'
        CHECK (estado IN ('ACTIVO','TRANSFERIDO','BAJA','ROBADO')),
    fecha_registro    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT vehiculo_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT vehiculo_placa_uq UNIQUE (municipalidad_id, placa),
    CONSTRAINT vehiculo_contribuyente_fk FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id)
);

-- Tabla de valores referenciales del MEF, adoptada por ejercicio (D-02).
CREATE TABLE valor_referencial_vehiculo (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    ejercicio        ejercicio    NOT NULL,
    marca            varchar(60)  NOT NULL,
    modelo           varchar(60)  NOT NULL,
    anio_fabricacion ejercicio    NOT NULL,
    valor            dinero       NOT NULL CHECK (valor >= 0),
    documento_fuente varchar(200) NOT NULL,
    CONSTRAINT valor_referencial_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT valor_referencial_uq
        UNIQUE (municipalidad_id, ejercicio, marca, modelo, anio_fabricacion)
);

-- ---------- Declaraciones juradas ----------
CREATE TABLE declaracion_jurada (
    municipalidad_id   bigint      NOT NULL REFERENCES municipalidad(id),
    id                 bigint      GENERATED ALWAYS AS IDENTITY,
    numero             varchar(20) NOT NULL,
    ejercicio          ejercicio   NOT NULL,
    contribuyente_id   bigint      NOT NULL,
    tipo               varchar(20) NOT NULL
        CHECK (tipo IN ('HR','PU','PR','VEHICULAR','RECTIFICATORIA')),
    predio_id          bigint,
    vehiculo_id        bigint,
    fecha_presentacion date        NOT NULL,
    fecha_limite       date        NOT NULL,
    -- Presentar fuera de plazo genera multa tributaria (manual, cap. 3).
    fuera_de_plazo     boolean     NOT NULL DEFAULT false,
    estado             varchar(20) NOT NULL DEFAULT 'PRESENTADA'
        CHECK (estado IN ('PRESENTADA','OBSERVADA','SUSTITUIDA','ANULADA')),
    usuario_registro   varchar(60) NOT NULL,
    observacion        varchar(500) NOT NULL,
    fecha_registro     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT dj_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT dj_numero_uq UNIQUE (municipalidad_id, ejercicio, numero),
    CONSTRAINT dj_contribuyente_fk FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id),
    CONSTRAINT dj_predio_fk FOREIGN KEY (municipalidad_id, predio_id)
        REFERENCES predio (municipalidad_id, id),
    CONSTRAINT dj_vehiculo_fk FOREIGN KEY (municipalidad_id, vehiculo_id)
        REFERENCES vehiculo (municipalidad_id, id)
);

-- ---------- Beneficios ----------
-- Inafectaciones, exoneraciones y descuentos del manual: jubilados, gobierno
-- central, monumento historico, predio rustico, predios sin servicio, etc.
CREATE TABLE beneficio (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    contribuyente_id bigint       NOT NULL,
    predio_id        bigint,
    vehiculo_id      bigint,
    tipo             varchar(40)  NOT NULL,
    tributo          varchar(20)  NOT NULL,
    clase            varchar(20)  NOT NULL
        CHECK (clase IN ('INAFECTACION','EXONERACION','DEDUCCION','DESCUENTO')),
    porcentaje       alicuota,
    monto            dinero,
    vigencia_desde   date         NOT NULL,
    vigencia_hasta   date,
    base_legal       varchar(200) NOT NULL,
    documento_origen varchar(80)  NOT NULL,
    observacion      varchar(500) NOT NULL,
    usuario_registro varchar(60)  NOT NULL,
    CONSTRAINT beneficio_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT beneficio_contribuyente_fk FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id),
    CONSTRAINT beneficio_predio_fk FOREIGN KEY (municipalidad_id, predio_id)
        REFERENCES predio (municipalidad_id, id),
    CONSTRAINT beneficio_valor_ck CHECK (porcentaje IS NOT NULL OR monto IS NOT NULL),
    CONSTRAINT beneficio_vigencia_ck
        CHECK (vigencia_hasta IS NULL OR vigencia_hasta >= vigencia_desde)
);

-- ---------- Transferencias ----------
CREATE TABLE transferencia (
    municipalidad_id    bigint       NOT NULL REFERENCES municipalidad(id),
    id                  bigint       GENERATED ALWAYS AS IDENTITY,
    objeto              varchar(10)  NOT NULL CHECK (objeto IN ('PREDIO','VEHICULO')),
    predio_id           bigint,
    vehiculo_id         bigint,
    transferente_id     bigint       NOT NULL,
    adquiriente_id      bigint       NOT NULL,
    -- El tipo decide la afectacion a alcabala: primera venta de constructora,
    -- gobiernos, cuerpo de bomberos, anticipo de legitima, etc.
    tipo_transferencia  varchar(40)  NOT NULL,
    fecha_transferencia date         NOT NULL,
    fecha_registro      timestamptz  NOT NULL DEFAULT now(),
    valor_transferencia dinero       NOT NULL CHECK (valor_transferencia >= 0),
    porcentaje_transferido porcentaje NOT NULL,
    afecta_alcabala     boolean      NOT NULL,
    documento_origen    varchar(80)  NOT NULL,
    observacion         varchar(500) NOT NULL,
    usuario_registro    varchar(60)  NOT NULL,
    CONSTRAINT transferencia_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT transferencia_predio_fk FOREIGN KEY (municipalidad_id, predio_id)
        REFERENCES predio (municipalidad_id, id),
    CONSTRAINT transferencia_vehiculo_fk FOREIGN KEY (municipalidad_id, vehiculo_id)
        REFERENCES vehiculo (municipalidad_id, id),
    CONSTRAINT transferencia_transferente_fk FOREIGN KEY (municipalidad_id, transferente_id)
        REFERENCES contribuyente (municipalidad_id, id),
    CONSTRAINT transferencia_adquiriente_fk FOREIGN KEY (municipalidad_id, adquiriente_id)
        REFERENCES contribuyente (municipalidad_id, id),
    CONSTRAINT transferencia_objeto_ck CHECK (
        (objeto = 'PREDIO'   AND predio_id   IS NOT NULL AND vehiculo_id IS NULL) OR
        (objeto = 'VEHICULO' AND vehiculo_id IS NOT NULL AND predio_id   IS NULL))
);

-- ---------- Espectaculos publicos no deportivos ----------
CREATE TABLE espectaculo (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    contribuyente_id bigint       NOT NULL,
    denominacion     varchar(200) NOT NULL,
    tipo             varchar(60)  NOT NULL,
    lugar            varchar(200) NOT NULL,
    fecha_evento     date         NOT NULL,
    aforo            integer,
    valor_entrada    dinero,
    base_imponible   dinero,
    estado           varchar(20)  NOT NULL DEFAULT 'REGISTRADO'
        CHECK (estado IN ('REGISTRADO','LIQUIDADO','ANULADO')),
    usuario_registro varchar(60)  NOT NULL,
    CONSTRAINT espectaculo_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT espectaculo_contribuyente_fk FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id)
);

-- ---------- Determinacion ----------
-- Guarda con que conjunto de parametros se calculo y que reglas se aplicaron:
-- sin eso el recalculo de un ejercicio pasado no es reproducible (ADR-0007).
CREATE TABLE determinacion (
    municipalidad_id  bigint      NOT NULL,
    ejercicio         ejercicio   NOT NULL,
    id                bigint      GENERATED ALWAYS AS IDENTITY,
    tributo           varchar(20) NOT NULL
        CHECK (tributo IN ('PREDIAL','ARBITRIO','VEHICULAR','ALCABALA','ESPECTACULOS',
                           'ANUNCIOS','JUEGOS')),
    periodo           smallint,
    contribuyente_id  bigint      NOT NULL,
    predio_id         bigint,
    vehiculo_id       bigint,
    conjunto_id       bigint      NOT NULL,
    base_imponible    dinero      NOT NULL,
    monto_determinado dinero      NOT NULL CHECK (monto_determinado >= 0),
    reglas_aplicadas  varchar(200)[] NOT NULL,
    origen            varchar(20) NOT NULL DEFAULT 'ORDINARIA'
        CHECK (origen IN ('ORDINARIA','FISCALIZACION','RECTIFICATORIA')),
    estado            varchar(15) NOT NULL DEFAULT 'BORRADOR'
        CHECK (estado IN ('BORRADOR','EMITIDA','ANULADA')),
    fecha_calculo     timestamptz NOT NULL DEFAULT now(),
    usuario_calculo   varchar(60) NOT NULL,
    CONSTRAINT determinacion_pk PRIMARY KEY (municipalidad_id, ejercicio, id),
    CONSTRAINT determinacion_conjunto_fk FOREIGN KEY (municipalidad_id, conjunto_id)
        REFERENCES conjunto_parametros (municipalidad_id, id),
    CONSTRAINT determinacion_contribuyente_fk FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id),
    CONSTRAINT determinacion_predio_fk FOREIGN KEY (municipalidad_id, predio_id)
        REFERENCES predio (municipalidad_id, id),
    CONSTRAINT determinacion_vehiculo_fk FOREIGN KEY (municipalidad_id, vehiculo_id)
        REFERENCES vehiculo (municipalidad_id, id)
) PARTITION BY LIST (ejercicio);

CREATE TABLE determinacion_2026 PARTITION OF determinacion FOR VALUES IN (2026);
CREATE TABLE determinacion_2027 PARTITION OF determinacion FOR VALUES IN (2027);

-- ---------- Cuenta corriente: el libro de asientos (ADR-0006) ----------
-- Solo se agrega. Sin UPDATE y sin DELETE para la aplicacion (V7). Un asiento
-- equivocado se corrige con otro asiento que lo reversa.
CREATE TABLE cuenta_corriente_asiento (
    municipalidad_id     bigint      NOT NULL,
    ejercicio            ejercicio   NOT NULL,
    id                   bigint      GENERATED ALWAYS AS IDENTITY,
    contribuyente_id     bigint      NOT NULL,
    tributo              varchar(20) NOT NULL,
    concepto             varchar(20) NOT NULL
        CHECK (concepto IN ('INSOLUTO','REAJUSTE','INTERES','GASTO','PAGO','COMPENSACION',
                            'ANULACION','CONDONACION','AJUSTE','FRACCIONAMIENTO')),
    tipo                 char(6)     NOT NULL CHECK (tipo IN ('CARGO','ABONO')),
    -- Fase de la deuda: ordinaria, formalizada en un valor, o en coactiva.
    fase                 varchar(12) NOT NULL DEFAULT 'ORDINARIA'
        CHECK (fase IN ('ORDINARIA','VALOR','COACTIVA','CONVENIO')),
    periodo              smallint,
    predio_id            bigint,
    vehiculo_id          bigint,
    -- Origen no tributario: papeleta o licencia. Sin FK a proposito: el libro no
    -- depende de los contextos que lo alimentan (ARQ-01 §4 regla 2).
    referencia_externa   varchar(40),
    monto                dinero      NOT NULL CHECK (monto > 0),
    fecha_valor          date        NOT NULL,
    fecha_registro       timestamptz NOT NULL DEFAULT now(),
    documento_origen     varchar(80) NOT NULL,
    asiento_reversado_id bigint,
    usuario_id           varchar(60) NOT NULL,
    motivo               varchar(500),
    CONSTRAINT asiento_pk PRIMARY KEY (municipalidad_id, ejercicio, id),
    CONSTRAINT asiento_contribuyente_fk FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id),
    -- RNF-052: los movimientos que alteran deuda sin cobro exigen motivo escrito.
    CONSTRAINT asiento_motivo_ck
        CHECK (concepto NOT IN ('ANULACION','CONDONACION','AJUSTE') OR motivo IS NOT NULL)
) PARTITION BY LIST (ejercicio);

CREATE TABLE cuenta_corriente_asiento_2026
    PARTITION OF cuenta_corriente_asiento FOR VALUES IN (2026);
CREATE TABLE cuenta_corriente_asiento_2027
    PARTITION OF cuenta_corriente_asiento FOR VALUES IN (2027);

-- Cache reconstruible del saldo. No es la verdad: la verdad es el libro.
CREATE TABLE saldo_proyectado (
    municipalidad_id  bigint      NOT NULL REFERENCES municipalidad(id),
    id                bigint      GENERATED ALWAYS AS IDENTITY,
    contribuyente_id  bigint      NOT NULL,
    tributo           varchar(20) NOT NULL,
    ejercicio         ejercicio   NOT NULL,
    periodo           smallint    NOT NULL DEFAULT 0,
    predio_id         bigint,
    vehiculo_id       bigint,
    insoluto_saldo    dinero      NOT NULL DEFAULT 0,
    fase              varchar(12) NOT NULL DEFAULT 'ORDINARIA',
    ultimo_asiento_id bigint,
    fecha_calculo     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT saldo_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT saldo_contribuyente_fk FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id)
);

CREATE UNIQUE INDEX saldo_uq ON saldo_proyectado (
    municipalidad_id, contribuyente_id, tributo, ejercicio, periodo,
    COALESCE(predio_id, 0), COALESCE(vehiculo_id, 0));

-- ---------- Indices ----------
CREATE INDEX asiento_deudor_ix
    ON cuenta_corriente_asiento (municipalidad_id, contribuyente_id, tributo, ejercicio);
CREATE INDEX asiento_predio_ix
    ON cuenta_corriente_asiento (municipalidad_id, predio_id) WHERE predio_id IS NOT NULL;
CREATE INDEX asiento_referencia_ix
    ON cuenta_corriente_asiento (municipalidad_id, referencia_externa)
    WHERE referencia_externa IS NOT NULL;
CREATE INDEX determinacion_predio_ix ON determinacion (municipalidad_id, predio_id, tributo);
CREATE INDEX determinacion_contribuyente_ix
    ON determinacion (municipalidad_id, contribuyente_id, tributo);
CREATE INDEX vehiculo_contribuyente_ix ON vehiculo (municipalidad_id, contribuyente_id);
CREATE INDEX dj_contribuyente_ix ON declaracion_jurada (municipalidad_id, contribuyente_id, ejercicio);
CREATE INDEX beneficio_vigente_ix
    ON beneficio (municipalidad_id, contribuyente_id, tributo) WHERE vigencia_hasta IS NULL;
