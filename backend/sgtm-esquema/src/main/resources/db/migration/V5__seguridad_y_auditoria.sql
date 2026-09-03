-- ============================================================================
--  V5 — Seguridad y auditoria
--
--  El modelo de autorizacion del manual (cap. 4), conservado integro: modulos,
--  accesos (opcion de menu o politica), grupos, usuarios, miembros y permisos
--  con siete privilegios. Ver docs/20-requisitos/actores-y-permisos.md
--
--  Y la auditoria de ADR-0008: usuario, origen, fecha y OBSERVACION OBLIGATORIA.
--  Sin observacion no se guarda; es restriccion de la base, no validacion de la
--  interfaz.
--
--  Estas tablas son de tenant: cada municipalidad administra su propia
--  seguridad. La autenticacion vive fuera (OIDC, ADR-0005); aqui solo la
--  autorizacion.
-- ============================================================================

CREATE TABLE modulo_sistema (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    codigo           varchar(30)  NOT NULL,
    nombre           varchar(120) NOT NULL,
    orden            smallint     NOT NULL DEFAULT 0,
    activo           boolean      NOT NULL DEFAULT true,
    CONSTRAINT modulo_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT modulo_codigo_uq UNIQUE (municipalidad_id, codigo)
);

-- Un acceso es una opcion de menu o una politica. La politica no abre pantalla:
-- habilita una capacidad ("cambiar el ano de trabajo", "anular recibo ajeno").
--
-- El codigo de una opcion de menu es el id del catalogo de pantallas
-- (docs/10-negocio/catalogo-de-opciones.md), de modo que sembrar los accesos es
-- copiar ese catalogo. Asi se cumple lo que promete el manual: "al crearse una
-- nueva opcion de menu el sistema automaticamente la reconoce y brinda la
-- posibilidad de configurar los diferentes niveles de acceso".
CREATE TABLE acceso (
    municipalidad_id bigint       NOT NULL,
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    modulo_id        bigint       NOT NULL,
    tipo             varchar(12)  NOT NULL CHECK (tipo IN ('OPCION_MENU','POLITICA')),
    codigo           varchar(60)  NOT NULL,
    nombre           varchar(160) NOT NULL,
    activo           boolean      NOT NULL DEFAULT true,
    fecha_registro   timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT acceso_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT acceso_codigo_uq UNIQUE (municipalidad_id, codigo),
    CONSTRAINT acceso_modulo_fk FOREIGN KEY (municipalidad_id, modulo_id)
        REFERENCES modulo_sistema (municipalidad_id, id)
);

CREATE TABLE grupo (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    nombre           varchar(80)  NOT NULL,
    descripcion      varchar(300),
    habilitado       boolean      NOT NULL DEFAULT true,
    vigencia_desde   date,
    vigencia_hasta   date,
    CONSTRAINT grupo_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT grupo_nombre_uq UNIQUE (municipalidad_id, nombre),
    CONSTRAINT grupo_vigencia_ck
        CHECK (vigencia_hasta IS NULL OR vigencia_desde IS NULL
               OR vigencia_hasta >= vigencia_desde)
);

CREATE TABLE usuario (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    cuenta           varchar(60)  NOT NULL,
    -- Identificador estable del proveedor OIDC. Aqui NO se guardan claves:
    -- la autenticacion es de ADR-0005.
    sujeto_oidc      varchar(120),
    nombre           varchar(160) NOT NULL,
    correo           varchar(160),
    habilitado       boolean      NOT NULL DEFAULT true,
    vigencia_desde   date,
    vigencia_hasta   date,
    fecha_registro   timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT usuario_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT usuario_cuenta_uq UNIQUE (municipalidad_id, cuenta),
    CONSTRAINT usuario_sujeto_uq UNIQUE (municipalidad_id, sujeto_oidc),
    CONSTRAINT usuario_vigencia_ck
        CHECK (vigencia_hasta IS NULL OR vigencia_desde IS NULL
               OR vigencia_hasta >= vigencia_desde)
);

-- Sacar a un usuario de un grupo es darlo de baja, no borrar la fila: la
-- aplicacion no tiene DELETE en ninguna tabla (RNF-051, V7).
CREATE TABLE miembro (
    municipalidad_id bigint      NOT NULL,
    grupo_id         bigint      NOT NULL,
    usuario_id       bigint      NOT NULL,
    fecha_alta       timestamptz NOT NULL DEFAULT now(),
    usuario_alta     varchar(60) NOT NULL,
    activo           boolean     NOT NULL DEFAULT true,
    fecha_baja       timestamptz,
    usuario_baja     varchar(60),
    CONSTRAINT miembro_pk PRIMARY KEY (municipalidad_id, grupo_id, usuario_id),
    CONSTRAINT miembro_grupo_fk FOREIGN KEY (municipalidad_id, grupo_id)
        REFERENCES grupo (municipalidad_id, id),
    CONSTRAINT miembro_usuario_fk FOREIGN KEY (municipalidad_id, usuario_id)
        REFERENCES usuario (municipalidad_id, id)
);

-- Los siete privilegios del manual. El permiso se otorga a un grupo o a un
-- usuario, nunca a los dos a la vez.
CREATE TABLE permiso (
    municipalidad_id bigint      NOT NULL,
    id               bigint      GENERATED ALWAYS AS IDENTITY,
    acceso_id        bigint      NOT NULL,
    grupo_id         bigint,
    usuario_id       bigint,
    ejecucion        boolean     NOT NULL DEFAULT false,
    lectura          boolean     NOT NULL DEFAULT false,
    registro         boolean     NOT NULL DEFAULT false,
    modificacion     boolean     NOT NULL DEFAULT false,
    eliminacion      boolean     NOT NULL DEFAULT false,
    impresion        boolean     NOT NULL DEFAULT false,
    especial         boolean     NOT NULL DEFAULT false,
    fecha_registro   timestamptz NOT NULL DEFAULT now(),
    usuario_registro varchar(60) NOT NULL,
    CONSTRAINT permiso_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT permiso_acceso_fk FOREIGN KEY (municipalidad_id, acceso_id)
        REFERENCES acceso (municipalidad_id, id),
    CONSTRAINT permiso_grupo_fk FOREIGN KEY (municipalidad_id, grupo_id)
        REFERENCES grupo (municipalidad_id, id),
    CONSTRAINT permiso_usuario_fk FOREIGN KEY (municipalidad_id, usuario_id)
        REFERENCES usuario (municipalidad_id, id),
    CONSTRAINT permiso_sujeto_ck CHECK (
        (grupo_id IS NOT NULL AND usuario_id IS NULL) OR
        (grupo_id IS NULL AND usuario_id IS NOT NULL))
);

CREATE UNIQUE INDEX permiso_grupo_uq
    ON permiso (municipalidad_id, acceso_id, grupo_id) WHERE grupo_id IS NOT NULL;
CREATE UNIQUE INDEX permiso_usuario_uq
    ON permiso (municipalidad_id, acceso_id, usuario_id) WHERE usuario_id IS NOT NULL;

-- "El sistema cuenta con un registro de entradas que permite determinar
-- mediante sistema quienes estan conectados" (manual, cap. 1).
CREATE TABLE sesion (
    municipalidad_id bigint       NOT NULL,
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    usuario_id       bigint       NOT NULL,
    inicio           timestamptz  NOT NULL DEFAULT now(),
    fin              timestamptz,
    origen_equipo    varchar(80),
    origen_ip        inet,
    agente           varchar(200),
    ejercicio_trabajo ejercicio,
    CONSTRAINT sesion_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT sesion_usuario_fk FOREIGN KEY (municipalidad_id, usuario_id)
        REFERENCES usuario (municipalidad_id, id),
    CONSTRAINT sesion_fechas_ck CHECK (fin IS NULL OR fin >= inicio)
);

-- ---------- Auditoria (ADR-0008) ----------
-- Lo que el manual exige, columna por columna: quien, desde que maquina, desde
-- que IP, cuando, sobre que, y POR QUE. La observacion es NOT NULL: sin ella la
-- insercion falla y la operacion completa se deshace.
--
-- Particionada por ejercicio, como el libro de asientos. La aplicacion tiene
-- SELECT e INSERT; nunca UPDATE ni DELETE (V7).
CREATE TABLE auditoria (
    municipalidad_id bigint       NOT NULL,
    ejercicio        ejercicio    NOT NULL,
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    tabla            varchar(60)  NOT NULL,
    clave            varchar(120) NOT NULL,
    operacion        varchar(15)  NOT NULL
        CHECK (operacion IN ('ALTA','MODIFICACION','BAJA','ANULACION','REVERSION',
                             'PERMISO','ACCESO')),
    usuario_id       varchar(60)  NOT NULL,
    origen_equipo    varchar(80),
    origen_ip        inet,
    fecha            timestamptz  NOT NULL DEFAULT now(),
    observacion      varchar(1000) NOT NULL,
    datos_anteriores jsonb,
    datos_nuevos     jsonb,
    CONSTRAINT auditoria_pk PRIMARY KEY (municipalidad_id, ejercicio, id),
    -- No basta con NOT NULL: una cadena de espacios tampoco explica nada.
    CONSTRAINT auditoria_observacion_ck CHECK (length(btrim(observacion)) >= 5)
) PARTITION BY LIST (ejercicio);

CREATE TABLE auditoria_2026 PARTITION OF auditoria FOR VALUES IN (2026);
CREATE TABLE auditoria_2027 PARTITION OF auditoria FOR VALUES IN (2027);

-- ---------- Indices ----------
CREATE INDEX acceso_modulo_ix   ON acceso (municipalidad_id, modulo_id, tipo);
CREATE INDEX miembro_usuario_ix ON miembro (municipalidad_id, usuario_id);
CREATE INDEX permiso_acceso_ix  ON permiso (municipalidad_id, acceso_id);
CREATE INDEX sesion_abierta_ix  ON sesion (municipalidad_id, usuario_id) WHERE fin IS NULL;
CREATE INDEX auditoria_tabla_ix ON auditoria (municipalidad_id, tabla, clave);
CREATE INDEX auditoria_usuario_ix ON auditoria (municipalidad_id, usuario_id, fecha);
