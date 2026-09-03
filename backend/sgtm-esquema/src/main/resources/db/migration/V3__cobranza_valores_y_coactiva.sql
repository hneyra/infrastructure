-- ============================================================================
--  V3 — Cobranza, valores y coactiva
--
--  Tesoreria (caja, recibos, tasas, convenios, cierre), valores (OP, RD, RM) y
--  el procedimiento de cobranza coactiva.
--
--  Un recibo no se borra: se anula, y la anulacion deja el recibo y agrega los
--  asientos de reversion en la cuenta corriente (manual, cap. 3 §Anulacion de
--  Recibo; RNF-051).
-- ============================================================================

-- ---------- Areas y tasas ----------
CREATE TABLE area (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    codigo           varchar(20)  NOT NULL,
    nombre           varchar(160) NOT NULL,
    activa           boolean      NOT NULL DEFAULT true,
    CONSTRAINT area_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT area_codigo_uq UNIQUE (municipalidad_id, codigo)
);

-- Derechos y tasas del TUPA, que se cobran en "Caja Tasas".
CREATE TABLE tasa (
    municipalidad_id     bigint       NOT NULL REFERENCES municipalidad(id),
    id                   bigint       GENERATED ALWAYS AS IDENTITY,
    codigo               varchar(20)  NOT NULL,
    descripcion          varchar(240) NOT NULL,
    area_id              bigint       NOT NULL,
    partida_presupuestal varchar(30)  NOT NULL,
    importe              dinero       NOT NULL CHECK (importe >= 0),
    vigencia_desde       date         NOT NULL,
    vigencia_hasta       date,
    documento_fuente     varchar(200) NOT NULL,
    CONSTRAINT tasa_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT tasa_codigo_uq UNIQUE (municipalidad_id, codigo, vigencia_desde),
    CONSTRAINT tasa_area_fk FOREIGN KEY (municipalidad_id, area_id)
        REFERENCES area (municipalidad_id, id)
);

-- ---------- Caja ----------
CREATE TABLE caja (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    codigo           varchar(10)  NOT NULL,
    nombre           varchar(80)  NOT NULL,
    area_id          bigint,
    activa           boolean      NOT NULL DEFAULT true,
    CONSTRAINT caja_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT caja_codigo_uq UNIQUE (municipalidad_id, codigo),
    CONSTRAINT caja_area_fk FOREIGN KEY (municipalidad_id, area_id)
        REFERENCES area (municipalidad_id, id)
);

CREATE TABLE recibo (
    municipalidad_id   bigint       NOT NULL REFERENCES municipalidad(id),
    id                 bigint       GENERATED ALWAYS AS IDENTITY,
    serie              varchar(5)   NOT NULL,
    numero             integer      NOT NULL,
    caja_id            bigint       NOT NULL,
    cajero             varchar(60)  NOT NULL,
    contribuyente_id   bigint       NOT NULL,
    fecha              timestamptz  NOT NULL DEFAULT now(),
    forma_pago         varchar(20)  NOT NULL
        CHECK (forma_pago IN ('EFECTIVO','CHEQUE','DEPOSITO','TARJETA','TRANSFERENCIA')),
    tipo_pago          varchar(20)  NOT NULL DEFAULT 'NORMAL'
        CHECK (tipo_pago IN ('NORMAL','A_CUENTA','PRECONVENIO','CUOTA_CONVENIO','TASA')),
    campania_beneficio varchar(80),
    total              dinero       NOT NULL CHECK (total >= 0),
    estado             varchar(10)  NOT NULL DEFAULT 'EMITIDO'
        CHECK (estado IN ('EMITIDO','ANULADO')),
    fecha_anulacion    timestamptz,
    usuario_anulacion  varchar(60),
    motivo_anulacion   varchar(500),
    CONSTRAINT recibo_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT recibo_numero_uq UNIQUE (municipalidad_id, serie, numero),
    CONSTRAINT recibo_caja_fk FOREIGN KEY (municipalidad_id, caja_id)
        REFERENCES caja (municipalidad_id, id),
    CONSTRAINT recibo_contribuyente_fk FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id),
    -- Anular exige constancia de quien, cuando y por que (RNF-052).
    CONSTRAINT recibo_anulacion_ck CHECK (
        estado = 'EMITIDO' OR
        (fecha_anulacion IS NOT NULL AND usuario_anulacion IS NOT NULL
         AND motivo_anulacion IS NOT NULL))
);

CREATE TABLE recibo_detalle (
    municipalidad_id bigint      NOT NULL,
    id               bigint      GENERATED ALWAYS AS IDENTITY,
    recibo_id        bigint      NOT NULL,
    tributo          varchar(20) NOT NULL,
    concepto         varchar(20) NOT NULL,
    ejercicio        ejercicio,
    periodo          smallint,
    tasa_id          bigint,
    predio_id        bigint,
    vehiculo_id      bigint,
    referencia_externa varchar(40),
    monto            dinero      NOT NULL CHECK (monto > 0),
    CONSTRAINT recibo_detalle_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT recibo_detalle_recibo_fk FOREIGN KEY (municipalidad_id, recibo_id)
        REFERENCES recibo (municipalidad_id, id),
    CONSTRAINT recibo_detalle_tasa_fk FOREIGN KEY (municipalidad_id, tasa_id)
        REFERENCES tasa (municipalidad_id, id)
);

CREATE TABLE cierre_caja (
    municipalidad_id bigint      NOT NULL REFERENCES municipalidad(id),
    id               bigint      GENERATED ALWAYS AS IDENTITY,
    caja_id          bigint      NOT NULL,
    cajero           varchar(60) NOT NULL,
    fecha            date        NOT NULL,
    total_efectivo   dinero      NOT NULL DEFAULT 0,
    total_otros      dinero      NOT NULL DEFAULT 0,
    cantidad_recibos integer     NOT NULL DEFAULT 0,
    estado           varchar(10) NOT NULL DEFAULT 'ABIERTO'
        CHECK (estado IN ('ABIERTO','CERRADO')),
    fecha_cierre     timestamptz,
    usuario_cierre   varchar(60),
    CONSTRAINT cierre_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT cierre_uq UNIQUE (municipalidad_id, caja_id, cajero, fecha),
    CONSTRAINT cierre_caja_fk FOREIGN KEY (municipalidad_id, caja_id)
        REFERENCES caja (municipalidad_id, id)
);

-- ---------- Convenios de fraccionamiento ----------
CREATE TABLE convenio (
    municipalidad_id   bigint       NOT NULL REFERENCES municipalidad(id),
    id                 bigint       GENERATED ALWAYS AS IDENTITY,
    numero             varchar(20)  NOT NULL,
    contribuyente_id   bigint       NOT NULL,
    tipo               varchar(12)  NOT NULL
        CHECK (tipo IN ('ORDINARIO','COACTIVO')),
    fecha              date         NOT NULL,
    monto_total        dinero       NOT NULL CHECK (monto_total > 0),
    cuota_inicial      dinero       NOT NULL CHECK (cuota_inicial >= 0),
    numero_cuotas      smallint     NOT NULL CHECK (numero_cuotas > 0),
    recibo_inicial_id  bigint,
    estado             varchar(15)  NOT NULL DEFAULT 'VIGENTE'
        CHECK (estado IN ('VIGENTE','CANCELADO','ANULADO','QUEBRADO','REFORMULADO')),
    fecha_estado       timestamptz,
    usuario_estado     varchar(60),
    motivo_estado      varchar(500),
    resolucion         varchar(40),
    CONSTRAINT convenio_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT convenio_numero_uq UNIQUE (municipalidad_id, numero),
    CONSTRAINT convenio_contribuyente_fk FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id),
    CONSTRAINT convenio_recibo_fk FOREIGN KEY (municipalidad_id, recibo_inicial_id)
        REFERENCES recibo (municipalidad_id, id),
    CONSTRAINT convenio_estado_ck CHECK (
        estado = 'VIGENTE' OR (fecha_estado IS NOT NULL AND motivo_estado IS NOT NULL))
);

CREATE TABLE convenio_cuota (
    municipalidad_id bigint      NOT NULL,
    id               bigint      GENERATED ALWAYS AS IDENTITY,
    convenio_id      bigint      NOT NULL,
    numero           smallint    NOT NULL,
    vencimiento      date        NOT NULL,
    monto            dinero      NOT NULL CHECK (monto > 0),
    estado           varchar(12) NOT NULL DEFAULT 'PENDIENTE'
        CHECK (estado IN ('PENDIENTE','PAGADA','VENCIDA','ANULADA')),
    recibo_id        bigint,
    CONSTRAINT convenio_cuota_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT convenio_cuota_uq UNIQUE (municipalidad_id, convenio_id, numero),
    CONSTRAINT convenio_cuota_convenio_fk FOREIGN KEY (municipalidad_id, convenio_id)
        REFERENCES convenio (municipalidad_id, id),
    CONSTRAINT convenio_cuota_recibo_fk FOREIGN KEY (municipalidad_id, recibo_id)
        REFERENCES recibo (municipalidad_id, id)
);

-- ---------- Valores ----------
CREATE TABLE valor (
    municipalidad_id  bigint       NOT NULL REFERENCES municipalidad(id),
    id                bigint       GENERATED ALWAYS AS IDENTITY,
    tipo              varchar(4)   NOT NULL CHECK (tipo IN ('OP','RD','RM')),
    numero            varchar(20)  NOT NULL,
    ejercicio         ejercicio    NOT NULL,
    contribuyente_id  bigint       NOT NULL,
    fecha_emision     date         NOT NULL,
    base_legal        varchar(200) NOT NULL,
    monto_insoluto    dinero       NOT NULL DEFAULT 0,
    monto_reajuste    dinero       NOT NULL DEFAULT 0,
    monto_interes     dinero       NOT NULL DEFAULT 0,
    monto_gasto       dinero       NOT NULL DEFAULT 0,
    monto_total       dinero       NOT NULL CHECK (monto_total >= 0),
    -- Fecha a la que estan proyectados los importes (RNF-075).
    proyectado_a      date         NOT NULL,
    estado            varchar(15)  NOT NULL DEFAULT 'EMITIDO'
        CHECK (estado IN ('EMITIDO','NOTIFICADO','COACTIVA','PAGADO','ANULADO','PRESCRITO')),
    usuario_registro  varchar(60)  NOT NULL,
    observacion       varchar(500) NOT NULL,
    fecha_registro    timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT valor_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT valor_numero_uq UNIQUE (municipalidad_id, tipo, numero),
    CONSTRAINT valor_contribuyente_fk FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id)
);

CREATE TABLE valor_detalle (
    municipalidad_id bigint      NOT NULL,
    id               bigint      GENERATED ALWAYS AS IDENTITY,
    valor_id         bigint      NOT NULL,
    tributo          varchar(20) NOT NULL,
    ejercicio        ejercicio   NOT NULL,
    periodo          smallint,
    predio_id        bigint,
    vehiculo_id      bigint,
    referencia_externa varchar(40),
    insoluto         dinero      NOT NULL DEFAULT 0,
    reajuste         dinero      NOT NULL DEFAULT 0,
    interes          dinero      NOT NULL DEFAULT 0,
    gasto            dinero      NOT NULL DEFAULT 0,
    CONSTRAINT valor_detalle_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT valor_detalle_valor_fk FOREIGN KEY (municipalidad_id, valor_id)
        REFERENCES valor (municipalidad_id, id)
);

CREATE TABLE notificacion (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    objeto           varchar(20)  NOT NULL
        CHECK (objeto IN ('VALOR','RESOLUCION','ACTO_COACTIVO','PAPELETA')),
    objeto_id        bigint       NOT NULL,
    numero           varchar(20)  NOT NULL,
    fecha_notificacion date,
    modalidad        varchar(30)  NOT NULL
        CHECK (modalidad IN ('PERSONAL','CEDULON','PUBLICACION','CORREO','NEGATIVA')),
    resultado        varchar(20)
        CHECK (resultado IN ('NOTIFICADO','NO_UBICADO','RECHAZADO','PENDIENTE')),
    notificador      varchar(60),
    direccion        varchar(300),
    acuse            varchar(80),
    observacion      varchar(500),
    CONSTRAINT notificacion_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT notificacion_numero_uq UNIQUE (municipalidad_id, objeto, numero)
);

-- ---------- Coactiva ----------
CREATE TABLE expediente_coactivo (
    municipalidad_id       bigint       NOT NULL REFERENCES municipalidad(id),
    id                     bigint       GENERATED ALWAYS AS IDENTITY,
    numero                 varchar(20)  NOT NULL,
    contribuyente_id       bigint       NOT NULL,
    ejecutor               varchar(60)  NOT NULL,
    auxiliar               varchar(60),
    fecha_apertura         date         NOT NULL,
    direccion_referencial  varchar(300),
    estado                 varchar(20)  NOT NULL DEFAULT 'ABIERTO'
        CHECK (estado IN ('ABIERTO','SUSPENDIDO','CONCLUIDO','ARCHIVADO')),
    fecha_estado           timestamptz,
    observacion            varchar(500) NOT NULL,
    CONSTRAINT expediente_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT expediente_numero_uq UNIQUE (municipalidad_id, numero),
    CONSTRAINT expediente_contribuyente_fk FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id)
);

CREATE TABLE expediente_valor (
    municipalidad_id bigint      NOT NULL,
    expediente_id    bigint      NOT NULL,
    valor_id         bigint      NOT NULL,
    fecha_importacion date       NOT NULL DEFAULT current_date,
    CONSTRAINT expediente_valor_pk PRIMARY KEY (municipalidad_id, expediente_id, valor_id),
    CONSTRAINT expediente_valor_exp_fk FOREIGN KEY (municipalidad_id, expediente_id)
        REFERENCES expediente_coactivo (municipalidad_id, id),
    CONSTRAINT expediente_valor_valor_fk FOREIGN KEY (municipalidad_id, valor_id)
        REFERENCES valor (municipalidad_id, id)
);

CREATE TABLE acto_coactivo (
    municipalidad_id bigint       NOT NULL,
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    expediente_id    bigint       NOT NULL,
    tipo             varchar(30)  NOT NULL
        CHECK (tipo IN ('REC1','REC2','MEDIDA_CAUTELAR','EMBARGO','TASACION','REMATE',
                        'SUSPENSION','LEVANTAMIENTO','CONCLUSION','OTRO')),
    numero           varchar(20)  NOT NULL,
    fecha            date         NOT NULL,
    descripcion      varchar(500) NOT NULL,
    documento        varchar(80),
    usuario_registro varchar(60)  NOT NULL,
    CONSTRAINT acto_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT acto_numero_uq UNIQUE (municipalidad_id, tipo, numero),
    CONSTRAINT acto_expediente_fk FOREIGN KEY (municipalidad_id, expediente_id)
        REFERENCES expediente_coactivo (municipalidad_id, id)
);

CREATE TABLE costa_procesal (
    municipalidad_id bigint       NOT NULL,
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    expediente_id    bigint       NOT NULL,
    concepto         varchar(160) NOT NULL,
    monto            dinero       NOT NULL CHECK (monto >= 0),
    fecha            date         NOT NULL,
    arancel_fuente   varchar(200) NOT NULL,
    CONSTRAINT costa_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT costa_expediente_fk FOREIGN KEY (municipalidad_id, expediente_id)
        REFERENCES expediente_coactivo (municipalidad_id, id)
);

-- ---------- Indices ----------
CREATE INDEX recibo_fecha_ix ON recibo (municipalidad_id, fecha);
CREATE INDEX recibo_contribuyente_ix ON recibo (municipalidad_id, contribuyente_id);
CREATE INDEX recibo_detalle_recibo_ix ON recibo_detalle (municipalidad_id, recibo_id);
CREATE INDEX convenio_contribuyente_ix ON convenio (municipalidad_id, contribuyente_id);
CREATE INDEX valor_contribuyente_ix ON valor (municipalidad_id, contribuyente_id, estado);
CREATE INDEX valor_detalle_valor_ix ON valor_detalle (municipalidad_id, valor_id);
CREATE INDEX notificacion_objeto_ix ON notificacion (municipalidad_id, objeto, objeto_id);
CREATE INDEX expediente_contribuyente_ix
    ON expediente_coactivo (municipalidad_id, contribuyente_id, estado);
CREATE INDEX acto_expediente_ix ON acto_coactivo (municipalidad_id, expediente_id, fecha);
