-- ============================================================================
--  V4 — Sanciones y licencias
--
--  Papeletas de transito y administrativas comparten modelo: acta, catalogo de
--  infracciones, calculo de multa y escalado a resolucion y coactiva. Lo que
--  cambia es la familia y la base legal (ARQ-01 §3.6).
--
--  Licencias de funcionamiento y edificacion, y autorizaciones de anuncios.
--  Cada autorizacion genera deuda por su tasa, pero la deuda no se asienta aqui:
--  se le pide a la cuenta corriente (ARQ-01 §4 regla 2).
-- ============================================================================

-- ---------- Catalogo de infracciones ----------
CREATE TABLE codigo_infraccion (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    familia          varchar(15)  NOT NULL
        CHECK (familia IN ('TRANSITO','ADMINISTRATIVA')),
    codigo           varchar(20)  NOT NULL,
    descripcion      varchar(500) NOT NULL,
    -- Porcentaje de la UIT. El valor de la UIT vive en parametro_tributario.
    porcentaje_uit   alicuota     NOT NULL,
    medida           varchar(160),
    puntos           smallint,
    base_legal       varchar(200) NOT NULL,
    vigencia_desde   date         NOT NULL,
    vigencia_hasta   date,
    CONSTRAINT codigo_infraccion_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT codigo_infraccion_uq UNIQUE (municipalidad_id, familia, codigo, vigencia_desde)
);

-- ---------- Notificacion administrativa previa ----------
-- Manual, cap. 3: "dicha notificacion es un paso previo a la generacion de la
-- multa administrativa". Puede no existir: la papeleta la enlaza si la hubo.
CREATE TABLE notificacion_administrativa (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    numero           varchar(20)  NOT NULL,
    fecha            date         NOT NULL,
    contribuyente_id bigint,
    predio_id        bigint,
    direccion        varchar(300) NOT NULL,
    motivo           varchar(500) NOT NULL,
    plazo_dias       smallint,
    estado           varchar(15)  NOT NULL DEFAULT 'EMITIDA'
        CHECK (estado IN ('EMITIDA','SUBSANADA','VENCIDA','ANULADA')),
    usuario_registro varchar(60)  NOT NULL,
    CONSTRAINT notif_adm_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT notif_adm_numero_uq UNIQUE (municipalidad_id, numero),
    CONSTRAINT notif_adm_contribuyente_fk FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id),
    CONSTRAINT notif_adm_predio_fk FOREIGN KEY (municipalidad_id, predio_id)
        REFERENCES predio (municipalidad_id, id)
);

-- ---------- Papeleta ----------
-- El desglose de importes es el del manual (cap. 3 §Registro de Papeleta): base
-- imponible, % de la infraccion, importe, % realmente a cobrar, importe final y
-- monto con beneficio. Se guardan los seis: explicarle el cobro al contribuyente
-- es parte del requisito, y recalcularlos despues daria otra cifra.
CREATE TABLE papeleta (
    municipalidad_id     bigint       NOT NULL REFERENCES municipalidad(id),
    id                   bigint       GENERATED ALWAYS AS IDENTITY,
    familia              varchar(15)  NOT NULL
        CHECK (familia IN ('TRANSITO','ADMINISTRATIVA')),
    numero               varchar(20)  NOT NULL,
    codigo_infraccion_id bigint       NOT NULL,
    fecha_infraccion     date         NOT NULL,
    hora_infraccion      time,
    lugar                varchar(300) NOT NULL,
    -- Transito
    placa                varchar(10),
    vehiculo_id          bigint,
    licencia_conducir    varchar(20),
    infractor_id         bigint,
    propietario_id       bigint,
    -- Administrativa
    contribuyente_id     bigint,
    predio_id            bigint,
    notificacion_previa_id bigint,
    -- Importes
    base_imponible       dinero       NOT NULL,
    porcentaje_infraccion alicuota    NOT NULL,
    importe_infraccion   dinero       NOT NULL,
    porcentaje_a_cobrar  alicuota     NOT NULL,
    importe_a_pagar      dinero       NOT NULL,
    importe_con_beneficio dinero,
    estado               varchar(15)  NOT NULL DEFAULT 'IMPUESTA'
        CHECK (estado IN ('IMPUESTA','NOTIFICADA','RESUELTA','PAGADA','COACTIVA',
                          'ANULADA','PRESCRITA')),
    usuario_registro     varchar(60)  NOT NULL,
    observacion          varchar(500) NOT NULL,
    fecha_registro       timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT papeleta_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT papeleta_numero_uq UNIQUE (municipalidad_id, familia, numero),
    CONSTRAINT papeleta_codigo_fk FOREIGN KEY (municipalidad_id, codigo_infraccion_id)
        REFERENCES codigo_infraccion (municipalidad_id, id),
    CONSTRAINT papeleta_vehiculo_fk FOREIGN KEY (municipalidad_id, vehiculo_id)
        REFERENCES vehiculo (municipalidad_id, id),
    CONSTRAINT papeleta_infractor_fk FOREIGN KEY (municipalidad_id, infractor_id)
        REFERENCES contribuyente (municipalidad_id, id),
    CONSTRAINT papeleta_propietario_fk FOREIGN KEY (municipalidad_id, propietario_id)
        REFERENCES contribuyente (municipalidad_id, id),
    CONSTRAINT papeleta_contribuyente_fk FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id),
    CONSTRAINT papeleta_notificacion_fk FOREIGN KEY (municipalidad_id, notificacion_previa_id)
        REFERENCES notificacion_administrativa (municipalidad_id, id),
    -- La papeleta de transito identifica al vehiculo; la administrativa, al
    -- administrado o al predio. La notificacion previa es opcional a proposito:
    -- el manual dice que "puede o no tener un registro de notificacion previa".
    CONSTRAINT papeleta_familia_ck CHECK (
        (familia = 'TRANSITO' AND placa IS NOT NULL) OR
        (familia = 'ADMINISTRATIVA'
            AND (contribuyente_id IS NOT NULL OR predio_id IS NOT NULL)))
);

-- El manual permite cambiar el numero de una papeleta; el cambio deja traza.
CREATE TABLE papeleta_cambio_numero (
    municipalidad_id bigint       NOT NULL,
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    papeleta_id      bigint       NOT NULL,
    numero_anterior  varchar(20)  NOT NULL,
    numero_nuevo     varchar(20)  NOT NULL,
    fecha            timestamptz  NOT NULL DEFAULT now(),
    usuario          varchar(60)  NOT NULL,
    motivo           varchar(500) NOT NULL,
    CONSTRAINT papeleta_cambio_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT papeleta_cambio_fk FOREIGN KEY (municipalidad_id, papeleta_id)
        REFERENCES papeleta (municipalidad_id, id)
);

CREATE TABLE descargo (
    municipalidad_id bigint       NOT NULL,
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    papeleta_id      bigint       NOT NULL,
    fecha            date         NOT NULL,
    sustento         varchar(1000) NOT NULL,
    resultado        varchar(15)
        CHECK (resultado IN ('FUNDADO','INFUNDADO','EN_TRAMITE')),
    resolucion       varchar(40),
    fecha_resolucion date,
    usuario_registro varchar(60)  NOT NULL,
    CONSTRAINT descargo_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT descargo_papeleta_fk FOREIGN KEY (municipalidad_id, papeleta_id)
        REFERENCES papeleta (municipalidad_id, id)
);

CREATE TABLE internamiento (
    municipalidad_id bigint       NOT NULL,
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    papeleta_id      bigint,
    vehiculo_id      bigint,
    placa            varchar(10)  NOT NULL,
    deposito         varchar(160) NOT NULL,
    fecha_ingreso    timestamptz  NOT NULL,
    fecha_salida     timestamptz,
    acta             varchar(40),
    observacion      varchar(500) NOT NULL,
    CONSTRAINT internamiento_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT internamiento_papeleta_fk FOREIGN KEY (municipalidad_id, papeleta_id)
        REFERENCES papeleta (municipalidad_id, id),
    CONSTRAINT internamiento_vehiculo_fk FOREIGN KEY (municipalidad_id, vehiculo_id)
        REFERENCES vehiculo (municipalidad_id, id),
    CONSTRAINT internamiento_fechas_ck
        CHECK (fecha_salida IS NULL OR fecha_salida >= fecha_ingreso)
);

-- ---------- Fiscalizacion ----------
CREATE TABLE programa_fiscalizacion (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    codigo           varchar(20)  NOT NULL,
    descripcion      varchar(300) NOT NULL,
    tipo             varchar(15)  NOT NULL CHECK (tipo IN ('PREDIAL','VEHICULAR')),
    fecha_inicio     date         NOT NULL,
    fecha_fin        date,
    estado           varchar(15)  NOT NULL DEFAULT 'ABIERTO'
        CHECK (estado IN ('ABIERTO','EN_PROCESO','CERRADO')),
    CONSTRAINT programa_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT programa_codigo_uq UNIQUE (municipalidad_id, codigo)
);

-- El acta trabaja sobre una COPIA: hasta la transferencia, nada de lo que
-- registra es el dato oficial del padron (ARQ-01 §3.5).
CREATE TABLE acta_fiscalizacion (
    municipalidad_id  bigint       NOT NULL,
    id                bigint       GENERATED ALWAYS AS IDENTITY,
    programa_id       bigint       NOT NULL,
    version           integer      NOT NULL,
    contribuyente_id  bigint       NOT NULL,
    predio_id         bigint,
    vehiculo_id       bigint,
    fecha_visita      date         NOT NULL,
    fiscalizador      varchar(60)  NOT NULL,
    hallazgo          varchar(20)
        CHECK (hallazgo IN ('CONFORME','OMISO','SUBVALUADOR','NO_UBICADO')),
    area_hallada      area_m2,
    detalle           varchar(1000),
    estado            varchar(15)  NOT NULL DEFAULT 'ABIERTA'
        CHECK (estado IN ('ABIERTA','LIQUIDADA','RELIQUIDADA','TRANSFERIDA','ANULADA')),
    fecha_transferencia timestamptz,
    usuario_transferencia varchar(60),
    observacion       varchar(500) NOT NULL,
    usuario_registro  varchar(60)  NOT NULL,
    fecha_registro    timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT acta_fisc_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT acta_fisc_version_uq
        UNIQUE (municipalidad_id, programa_id, contribuyente_id, version),
    CONSTRAINT acta_fisc_programa_fk FOREIGN KEY (municipalidad_id, programa_id)
        REFERENCES programa_fiscalizacion (municipalidad_id, id),
    CONSTRAINT acta_fisc_contribuyente_fk FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id),
    CONSTRAINT acta_fisc_predio_fk FOREIGN KEY (municipalidad_id, predio_id)
        REFERENCES predio (municipalidad_id, id),
    CONSTRAINT acta_fisc_transferencia_ck CHECK (
        estado <> 'TRANSFERIDA' OR
        (fecha_transferencia IS NOT NULL AND usuario_transferencia IS NOT NULL))
);

-- ---------- Licencias ----------
CREATE TABLE ciiu (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    codigo           varchar(10)  NOT NULL,
    descripcion      varchar(300) NOT NULL,
    -- El manual permite al usuario extender los codigos publicados.
    extendido        boolean      NOT NULL DEFAULT false,
    activo           boolean      NOT NULL DEFAULT true,
    CONSTRAINT ciiu_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT ciiu_codigo_uq UNIQUE (municipalidad_id, codigo)
);

CREATE TABLE licencia_funcionamiento (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    numero           varchar(20)  NOT NULL,
    contribuyente_id bigint       NOT NULL,
    predio_id        bigint,
    nombre_comercial varchar(200) NOT NULL,
    direccion        varchar(300) NOT NULL,
    area_solicitada  area_m2      NOT NULL,
    tipo_licencia    varchar(30)  NOT NULL,
    zonificacion     varchar(60),
    aforo            integer,
    fecha_emision    date         NOT NULL,
    vigencia_hasta   date,
    -- El manual valida que el contribuyente pago el tramite antes de emitir.
    recibo_id        bigint,
    resolucion       varchar(40),
    estado           varchar(15)  NOT NULL DEFAULT 'VIGENTE'
        CHECK (estado IN ('VIGENTE','CANCELADA','SUSPENDIDA','VENCIDA')),
    fecha_cancelacion date,
    motivo_cancelacion varchar(500),
    usuario_registro varchar(60)  NOT NULL,
    observacion      varchar(500) NOT NULL,
    CONSTRAINT licencia_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT licencia_numero_uq UNIQUE (municipalidad_id, numero),
    CONSTRAINT licencia_contribuyente_fk FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id),
    CONSTRAINT licencia_predio_fk FOREIGN KEY (municipalidad_id, predio_id)
        REFERENCES predio (municipalidad_id, id),
    CONSTRAINT licencia_recibo_fk FOREIGN KEY (municipalidad_id, recibo_id)
        REFERENCES recibo (municipalidad_id, id),
    CONSTRAINT licencia_cancelacion_ck CHECK (
        estado <> 'CANCELADA' OR
        (fecha_cancelacion IS NOT NULL AND motivo_cancelacion IS NOT NULL))
);

-- Quitar un giro de una licencia es darlo de baja: la aplicacion no tiene
-- DELETE en ninguna tabla (RNF-051, V7).
CREATE TABLE licencia_giro (
    municipalidad_id bigint  NOT NULL,
    licencia_id      bigint  NOT NULL,
    ciiu_id          bigint  NOT NULL,
    principal        boolean NOT NULL DEFAULT false,
    activo           boolean NOT NULL DEFAULT true,
    CONSTRAINT licencia_giro_pk PRIMARY KEY (municipalidad_id, licencia_id, ciiu_id),
    CONSTRAINT licencia_giro_licencia_fk FOREIGN KEY (municipalidad_id, licencia_id)
        REFERENCES licencia_funcionamiento (municipalidad_id, id),
    CONSTRAINT licencia_giro_ciiu_fk FOREIGN KEY (municipalidad_id, ciiu_id)
        REFERENCES ciiu (municipalidad_id, id)
);

CREATE TABLE licencia_duplicado (
    municipalidad_id bigint       NOT NULL,
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    licencia_id      bigint       NOT NULL,
    numero           smallint     NOT NULL,
    fecha            date         NOT NULL,
    resolucion       varchar(40),
    motivo           varchar(500) NOT NULL,
    recibo_id        bigint,
    CONSTRAINT licencia_duplicado_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT licencia_duplicado_uq UNIQUE (municipalidad_id, licencia_id, numero),
    CONSTRAINT licencia_duplicado_fk FOREIGN KEY (municipalidad_id, licencia_id)
        REFERENCES licencia_funcionamiento (municipalidad_id, id),
    CONSTRAINT licencia_duplicado_recibo_fk FOREIGN KEY (municipalidad_id, recibo_id)
        REFERENCES recibo (municipalidad_id, id)
);

-- Formulario Unico de Edificaciones (FUE).
CREATE TABLE licencia_edificacion (
    municipalidad_id  bigint       NOT NULL REFERENCES municipalidad(id),
    id                bigint       GENERATED ALWAYS AS IDENTITY,
    numero            varchar(20)  NOT NULL,
    contribuyente_id  bigint       NOT NULL,
    predio_id         bigint,
    modalidad         varchar(10)  NOT NULL CHECK (modalidad IN ('A','B','C','D')),
    tipo_obra         varchar(40)  NOT NULL,
    area_terreno      area_m2      NOT NULL,
    area_construida   area_m2      NOT NULL,
    numero_pisos      smallint,
    valor_obra        dinero       NOT NULL CHECK (valor_obra >= 0),
    representante     varchar(240),
    proyectista       varchar(240),
    responsable_obra  varchar(240),
    fecha_emision     date         NOT NULL,
    vigencia_hasta    date,
    revalidacion_hasta date,
    estado            varchar(15)  NOT NULL DEFAULT 'VIGENTE'
        CHECK (estado IN ('VIGENTE','VENCIDA','AMPLIADA','ANULADA')),
    recibo_id         bigint,
    usuario_registro  varchar(60)  NOT NULL,
    observacion       varchar(500) NOT NULL,
    CONSTRAINT edificacion_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT edificacion_numero_uq UNIQUE (municipalidad_id, numero),
    CONSTRAINT edificacion_contribuyente_fk FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id),
    CONSTRAINT edificacion_predio_fk FOREIGN KEY (municipalidad_id, predio_id)
        REFERENCES predio (municipalidad_id, id),
    CONSTRAINT edificacion_recibo_fk FOREIGN KEY (municipalidad_id, recibo_id)
        REFERENCES recibo (municipalidad_id, id)
);

CREATE TABLE anuncio (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    numero           varchar(20)  NOT NULL,
    contribuyente_id bigint       NOT NULL,
    predio_id        bigint,
    tipo             varchar(40)  NOT NULL,
    ubicacion        varchar(300) NOT NULL,
    area             area_m2      NOT NULL,
    cantidad         smallint     NOT NULL DEFAULT 1 CHECK (cantidad > 0),
    fecha_autorizacion date        NOT NULL,
    vigencia_hasta   date,
    estado           varchar(15)  NOT NULL DEFAULT 'VIGENTE'
        CHECK (estado IN ('VIGENTE','VENCIDO','RETIRADO','ANULADO')),
    usuario_registro varchar(60)  NOT NULL,
    observacion      varchar(500) NOT NULL,
    CONSTRAINT anuncio_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT anuncio_numero_uq UNIQUE (municipalidad_id, numero),
    CONSTRAINT anuncio_contribuyente_fk FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id),
    CONSTRAINT anuncio_predio_fk FOREIGN KEY (municipalidad_id, predio_id)
        REFERENCES predio (municipalidad_id, id)
);

-- ---------- Indices ----------
CREATE INDEX papeleta_placa_ix ON papeleta (municipalidad_id, placa) WHERE placa IS NOT NULL;
CREATE INDEX papeleta_infractor_ix
    ON papeleta (municipalidad_id, infractor_id) WHERE infractor_id IS NOT NULL;
CREATE INDEX papeleta_fecha_ix ON papeleta (municipalidad_id, fecha_infraccion, estado);
CREATE INDEX acta_fisc_contribuyente_ix
    ON acta_fiscalizacion (municipalidad_id, contribuyente_id, estado);
CREATE INDEX licencia_contribuyente_ix
    ON licencia_funcionamiento (municipalidad_id, contribuyente_id, estado);
CREATE INDEX anuncio_contribuyente_ix ON anuncio (municipalidad_id, contribuyente_id, estado);
