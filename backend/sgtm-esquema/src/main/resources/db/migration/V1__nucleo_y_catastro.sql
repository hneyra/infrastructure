-- ============================================================================
--  V1 — Nucleo y catastro
--
--  Dominios, registro de municipalidades, parametros tributarios, contribuyentes
--  y todo el catastro: predios, fichas versionadas, construcciones, titularidad
--  y tablas de valuacion.
--
--  Se ejecuta como sgtm_owner: todas estas tablas quedan de su propiedad.
--  La RLS y los privilegios van en V6 y V7, no aqui: primero existe el esquema,
--  despues se cierra. Ver docs/30-arquitectura/estrategia-multitenant.md
-- ============================================================================

-- ---------- Dominios ----------
-- Escala y modo de redondeo de los importes: D-03 sigue abierta. numeric(15,2)
-- es provisional y NO debe tomarse como decision cerrada; la primera regla de
-- calculo esta bloqueada hasta que D-03 y D-02 se resuelvan.
CREATE DOMAIN dinero      AS numeric(15,2);
CREATE DOMAIN monto_calc  AS numeric(18,6);
CREATE DOMAIN alicuota    AS numeric(7,4)  CHECK (VALUE >= 0 AND VALUE <= 100);
CREATE DOMAIN porcentaje  AS numeric(7,4)  CHECK (VALUE > 0 AND VALUE <= 100);
CREATE DOMAIN area_m2     AS numeric(12,2) CHECK (VALUE >= 0);
CREATE DOMAIN ejercicio   AS smallint      CHECK (VALUE BETWEEN 1990 AND 2100);
-- Codigo de referencia catastral del manual (cap. 2 §Registro de Predios):
-- DDPPddSSMMMLLLEEeeppUUU = departamento, provincia, distrito, sector, manzana,
-- lote, edificacion, entrada, piso y unidad catastral.
--
-- La longitud exacta NO esta cerrada (D-10): la plantilla de letras del manual da
-- 23 posiciones y los ejemplos del prototipo de interfaz traen 21. Hasta que se
-- verifique contra fichas reales, la restriccion exige lo unico que si consta
-- —solo digitos, y una longitud plausible— en lugar de fijar un numero inventado
-- que obligaria a migrar la columna despues.
CREATE DOMAIN cod_catastral AS varchar(25) CHECK (VALUE ~ '^[0-9]{18,25}$');

-- ---------- Registro de tenants (catalogo global) ----------
CREATE TABLE municipalidad (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ubigeo         char(6)      NOT NULL UNIQUE,
    nombre         varchar(160) NOT NULL,
    tipo           varchar(20)  NOT NULL CHECK (tipo IN ('DISTRITAL','PROVINCIAL')),
    activa         boolean      NOT NULL DEFAULT true,
    fecha_registro timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE municipalidad IS
    'Registro de tenants. No es tabla de tenant: la aplicacion la lee entera porque'
    ' los procesos masivos iteran municipalidad por municipalidad. Solo sgtm_owner escribe.';

-- ---------- Parametros tributarios (ADR-0007) ----------
-- municipalidad_id NULL = ambito nacional (UIT, tablas del MEF). Es la unica
-- excepcion admitida al filtrado por municipalidad, y se implementa por politica
-- en V6, no desactivando RLS.
CREATE TABLE parametro_tributario (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    municipalidad_id bigint REFERENCES municipalidad(id),
    tipo             varchar(40)  NOT NULL,
    clave            varchar(120),
    valor_numerico   monto_calc,
    valor_texto      varchar(200),
    vigencia_desde   date         NOT NULL,
    vigencia_hasta   date,
    documento_fuente varchar(200) NOT NULL,
    sellado          boolean      NOT NULL DEFAULT false,
    usuario_carga    varchar(60)  NOT NULL,
    usuario_aprueba  varchar(60),
    fecha_carga      timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT parametro_vigencia_ck
        CHECK (vigencia_hasta IS NULL OR vigencia_hasta >= vigencia_desde),
    CONSTRAINT parametro_valor_ck
        CHECK (valor_numerico IS NOT NULL OR valor_texto IS NOT NULL),
    -- RNF-092: quien carga no puede aprobar. Restriccion, no convencion.
    CONSTRAINT parametro_doble_verificacion_ck
        CHECK (usuario_aprueba IS NULL OR usuario_aprueba <> usuario_carga)
);

CREATE TABLE conjunto_parametros (
    municipalidad_id bigint      NOT NULL REFERENCES municipalidad(id),
    id               bigint      GENERATED ALWAYS AS IDENTITY,
    ejercicio        ejercicio   NOT NULL,
    version          smallint    NOT NULL,
    estado           varchar(10) NOT NULL DEFAULT 'ABIERTO'
        CHECK (estado IN ('ABIERTO','SELLADO')),
    fecha_sellado    timestamptz,
    usuario_sellado  varchar(60),
    CONSTRAINT conjunto_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT conjunto_uq UNIQUE (municipalidad_id, ejercicio, version),
    CONSTRAINT conjunto_sellado_ck
        CHECK (estado = 'ABIERTO' OR (fecha_sellado IS NOT NULL AND usuario_sellado IS NOT NULL))
);

CREATE TABLE conjunto_parametro_detalle (
    municipalidad_id bigint NOT NULL,
    conjunto_id      bigint NOT NULL,
    parametro_id     bigint NOT NULL REFERENCES parametro_tributario(id),
    CONSTRAINT conjunto_detalle_pk PRIMARY KEY (municipalidad_id, conjunto_id, parametro_id),
    CONSTRAINT conjunto_detalle_fk FOREIGN KEY (municipalidad_id, conjunto_id)
        REFERENCES conjunto_parametros (municipalidad_id, id)
);

-- ---------- Contribuyentes ----------
CREATE TABLE contribuyente (
    municipalidad_id      bigint       NOT NULL REFERENCES municipalidad(id),
    id                    bigint       GENERATED ALWAYS AS IDENTITY,
    -- El "codigo unico" del manual (cap. 2 §Registro de Contribuyentes): con el
    -- se identifican todas sus obligaciones, sea cual sea el tributo.
    codigo_contribuyente  varchar(20)  NOT NULL,
    tipo_documento        varchar(10)  NOT NULL
        CHECK (tipo_documento IN ('DNI','RUC','CE','PASAPORTE','PARTIDA','OTRO')),
    numero_documento      varchar(20)  NOT NULL,
    tipo_persona          varchar(20)  NOT NULL
        CHECK (tipo_persona IN ('NATURAL','JURIDICA','SUCESION_INDIVISA','SOCIEDAD_CONYUGAL')),
    nombre_razon_social   varchar(240) NOT NULL,
    condicion_especial    varchar(30)
        CHECK (condicion_especial IN ('PENSIONISTA','ADULTO_MAYOR','DISCAPACIDAD')),
    fecha_nacimiento      date,
    estado_civil          varchar(20),
    conyuge_id            bigint,
    activo                boolean      NOT NULL DEFAULT true,
    fecha_registro        timestamptz  NOT NULL DEFAULT now(),
    usuario_registro      varchar(60)  NOT NULL,
    CONSTRAINT contribuyente_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT contribuyente_codigo_uq UNIQUE (municipalidad_id, codigo_contribuyente),
    CONSTRAINT contribuyente_documento_uq
        UNIQUE (municipalidad_id, tipo_documento, numero_documento),
    CONSTRAINT contribuyente_conyuge_fk FOREIGN KEY (municipalidad_id, conyuge_id)
        REFERENCES contribuyente (municipalidad_id, id)
);

CREATE TABLE domicilio (
    municipalidad_id bigint       NOT NULL,
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    contribuyente_id bigint       NOT NULL,
    tipo             varchar(10)  NOT NULL CHECK (tipo IN ('FISCAL','PROCESAL')),
    direccion        varchar(300) NOT NULL,
    referencia       varchar(200),
    ubigeo           char(6),
    vigencia_desde   date         NOT NULL,
    vigencia_hasta   date,
    documento_origen varchar(80)  NOT NULL,
    CONSTRAINT domicilio_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT domicilio_contribuyente_fk FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id),
    CONSTRAINT domicilio_vigencia_ck
        CHECK (vigencia_hasta IS NULL OR vigencia_hasta >= vigencia_desde)
);

-- Un solo domicilio fiscal vigente por contribuyente.
CREATE UNIQUE INDEX domicilio_fiscal_vigente_uq
    ON domicilio (municipalidad_id, contribuyente_id)
    WHERE tipo = 'FISCAL' AND vigencia_hasta IS NULL;

-- Telefonos, correos, gestores y contactos del manual (cap. 2, fichas de
-- Contactos, Gestores y Telefonos-Email) en una sola tabla tipada.
CREATE TABLE contacto (
    municipalidad_id bigint       NOT NULL,
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    contribuyente_id bigint       NOT NULL,
    tipo             varchar(20)  NOT NULL
        CHECK (tipo IN ('TELEFONO','CELULAR','EMAIL','GESTOR','CONTACTO')),
    valor            varchar(200) NOT NULL,
    nombre           varchar(240),
    documento        varchar(20),
    observacion      varchar(300),
    vigente          boolean      NOT NULL DEFAULT true,
    CONSTRAINT contacto_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT contacto_contribuyente_fk FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id)
);

-- ---------- Catalogos catastrales ----------
CREATE TABLE via (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    codigo           varchar(20)  NOT NULL,
    tipo_via         varchar(20)  NOT NULL,
    nombre           varchar(160) NOT NULL,
    ubigeo           char(6),
    activa           boolean      NOT NULL DEFAULT true,
    CONSTRAINT via_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT via_codigo_uq UNIQUE (municipalidad_id, codigo)
);

CREATE TABLE sector (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    codigo           varchar(10)  NOT NULL,
    nombre           varchar(160) NOT NULL,
    zona             varchar(80),
    activo           boolean      NOT NULL DEFAULT true,
    CONSTRAINT sector_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT sector_codigo_uq UNIQUE (municipalidad_id, codigo)
);

CREATE TABLE manzana (
    municipalidad_id bigint      NOT NULL,
    id               bigint      GENERATED ALWAYS AS IDENTITY,
    sector_id        bigint      NOT NULL,
    codigo           varchar(10) NOT NULL,
    CONSTRAINT manzana_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT manzana_sector_fk FOREIGN KEY (municipalidad_id, sector_id)
        REFERENCES sector (municipalidad_id, id),
    CONSTRAINT manzana_codigo_uq UNIQUE (municipalidad_id, sector_id, codigo)
);

-- ---------- Predio ----------
CREATE TABLE predio (
    municipalidad_id       bigint        NOT NULL REFERENCES municipalidad(id),
    id                     bigint        GENERATED ALWAYS AS IDENTITY,
    codigo_ref_catastral   cod_catastral NOT NULL,
    tipo                   varchar(10)   NOT NULL CHECK (tipo IN ('URBANO','RUSTICO')),
    via_id                 bigint,
    numero_municipal       varchar(20),
    direccion              varchar(300)  NOT NULL,
    sector_id              bigint,
    manzana_id             bigint,
    lote                   varchar(10),
    ubigeo                 char(6),
    estado                 varchar(20)   NOT NULL DEFAULT 'ACTIVO'
        CHECK (estado IN ('ACTIVO','DADO_DE_BAJA')),
    fecha_registro         timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT predio_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT predio_codigo_uq UNIQUE (municipalidad_id, codigo_ref_catastral),
    CONSTRAINT predio_via_fk FOREIGN KEY (municipalidad_id, via_id)
        REFERENCES via (municipalidad_id, id),
    CONSTRAINT predio_sector_fk FOREIGN KEY (municipalidad_id, sector_id)
        REFERENCES sector (municipalidad_id, id),
    CONSTRAINT predio_manzana_fk FOREIGN KEY (municipalidad_id, manzana_id)
        REFERENCES manzana (municipalidad_id, id)
);

-- ---------- Ficha catastral versionada ----------
-- Manual, cap. 2 §Actualizacion del Catastro: "cuando se va a registrar una
-- modificacion el sistema internamente saca una copia de la ficha original y
-- genera un nuevo registro con los datos modificados". Aqui eso no es una
-- costumbre: es el modelo. La ficha no se sobrescribe nunca.
CREATE TABLE ficha_catastral (
    municipalidad_id  bigint       NOT NULL,
    id                bigint       GENERATED ALWAYS AS IDENTITY,
    predio_id         bigint       NOT NULL,
    tipo              varchar(20)  NOT NULL
        CHECK (tipo IN ('UNICA','ECONOMICA','BIENES_COMUNES','RURAL')),
    version           integer      NOT NULL,
    area_terreno      area_m2      NOT NULL,
    uso               varchar(60)  NOT NULL,
    frontis           numeric(8,2),
    condicion_propiedad varchar(40),
    tipo_edificacion  varchar(40),
    -- Predio rustico: el manual pide tipos de tierra y colindantes.
    tipo_tierra       varchar(40),
    colindantes       varchar(400),
    vigencia_desde    date         NOT NULL,
    vigencia_hasta    date,
    origen            varchar(20)  NOT NULL
        CHECK (origen IN ('DECLARACION_JURADA','FISCALIZACION','RESOLUCION','MIGRACION')),
    documento_origen  varchar(80)  NOT NULL,
    -- RNF-052 / ADR-0008: sin observacion no se guarda una modificacion.
    observacion       varchar(500) NOT NULL,
    usuario_registro  varchar(60)  NOT NULL,
    fecha_registro    timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT ficha_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT ficha_predio_fk FOREIGN KEY (municipalidad_id, predio_id)
        REFERENCES predio (municipalidad_id, id),
    CONSTRAINT ficha_version_uq UNIQUE (municipalidad_id, predio_id, tipo, version),
    CONSTRAINT ficha_vigencia_ck
        CHECK (vigencia_hasta IS NULL OR vigencia_hasta >= vigencia_desde)
);

-- Una sola ficha vigente por predio y tipo.
CREATE UNIQUE INDEX ficha_vigente_uq
    ON ficha_catastral (municipalidad_id, predio_id, tipo)
    WHERE vigencia_hasta IS NULL;

-- Caracteristicas de la construccion, por piso (manual, cap. 2 §Caract. Construccion).
-- Las categorias son las letras A-G de la tabla oficial de valores unitarios;
-- el valor de cada letra vive en valor_unitario_edificacion, no aqui.
CREATE TABLE construccion (
    municipalidad_id     bigint      NOT NULL,
    id                   bigint      GENERATED ALWAYS AS IDENTITY,
    ficha_id             bigint      NOT NULL,
    piso                 varchar(10) NOT NULL,
    area_construida      area_m2     NOT NULL,
    anio_construccion    ejercicio,
    material_estructural varchar(20)
        CHECK (material_estructural IN ('CONCRETO','LADRILLO','ADOBE','MADERA','QUINCHA','OTRO')),
    estado_conservacion  varchar(20)
        CHECK (estado_conservacion IN ('MUY_BUENO','BUENO','REGULAR','MALO','RUINOSO')),
    categoria_muros      char(1) CHECK (categoria_muros      ~ '^[A-I]$'),
    categoria_techos     char(1) CHECK (categoria_techos     ~ '^[A-I]$'),
    categoria_pisos      char(1) CHECK (categoria_pisos      ~ '^[A-I]$'),
    categoria_puertas    char(1) CHECK (categoria_puertas    ~ '^[A-I]$'),
    categoria_revestim   char(1) CHECK (categoria_revestim   ~ '^[A-I]$'),
    categoria_banios     char(1) CHECK (categoria_banios     ~ '^[A-I]$'),
    categoria_instalac   char(1) CHECK (categoria_instalac   ~ '^[A-I]$'),
    porcentaje_construido porcentaje,
    CONSTRAINT construccion_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT construccion_ficha_fk FOREIGN KEY (municipalidad_id, ficha_id)
        REFERENCES ficha_catastral (municipalidad_id, id)
);

CREATE TABLE otra_instalacion (
    municipalidad_id  bigint       NOT NULL,
    id                bigint       GENERATED ALWAYS AS IDENTITY,
    ficha_id          bigint       NOT NULL,
    descripcion       varchar(160) NOT NULL,
    unidad_medida     varchar(20)  NOT NULL,
    cantidad          numeric(12,2) NOT NULL CHECK (cantidad > 0),
    anio_construccion ejercicio,
    estado_conservacion varchar(20),
    CONSTRAINT otra_instalacion_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT otra_instalacion_ficha_fk FOREIGN KEY (municipalidad_id, ficha_id)
        REFERENCES ficha_catastral (municipalidad_id, id)
);

-- ---------- Titularidad ----------
CREATE TABLE titularidad (
    municipalidad_id bigint      NOT NULL,
    id               bigint      GENERATED ALWAYS AS IDENTITY,
    predio_id        bigint      NOT NULL,
    contribuyente_id bigint      NOT NULL,
    condicion        varchar(30) NOT NULL
        CHECK (condicion IN ('PROPIETARIO_UNICO','COPROPIETARIO','CONYUGE','POSEEDOR',
                             'SUCESION','USUFRUCTUARIO')),
    porcentaje       porcentaje  NOT NULL,
    vigencia_desde   date        NOT NULL,
    vigencia_hasta   date,
    documento_origen varchar(80) NOT NULL,
    CONSTRAINT titularidad_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT titularidad_predio_fk FOREIGN KEY (municipalidad_id, predio_id)
        REFERENCES predio (municipalidad_id, id),
    CONSTRAINT titularidad_contribuyente_fk FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id),
    -- el titular unico lo es por el total: su porcentaje no se declara, es 100
    CONSTRAINT titularidad_unico_ck
        CHECK (condicion <> 'PROPIETARIO_UNICO' OR porcentaje = 100)
);

-- Invariante: los porcentajes vigentes de un predio NO EXCEDEN 100.
-- El SRTM del MEF valida "no exceder", no "sumar exactamente" (../srtm DAT-02 §4.2,
-- D-36): un padron real tiene predios con titularidad parcialmente identificada, y
-- exigir que sume 100 obligaria al operador a inventar un titular para cuadrar.
-- Diferido, porque una transferencia cierra una titularidad y abre otra dentro
-- de la misma transaccion y en el intermedio la suma no cuadra.
CREATE OR REPLACE FUNCTION verificar_titularidad_no_excede() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
    v_muni   bigint := COALESCE(NEW.municipalidad_id, OLD.municipalidad_id);
    v_predio bigint := COALESCE(NEW.predio_id, OLD.predio_id);
    v_total  numeric(7,4);
BEGIN
    SELECT COALESCE(sum(porcentaje), 0) INTO v_total
      FROM titularidad
     WHERE municipalidad_id = v_muni
       AND predio_id = v_predio
       AND vigencia_hasta IS NULL;
    IF v_total > 100 THEN
        RAISE EXCEPTION
          'Los porcentajes de titularidad vigentes del predio % suman %, no pueden exceder 100',
          v_predio, v_total;
    END IF;
    RETURN NULL;
END
$fn$;

CREATE CONSTRAINT TRIGGER titularidad_no_excede_trg
    AFTER INSERT OR UPDATE OR DELETE ON titularidad
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION verificar_titularidad_no_excede();

-- Inquilinos: el manual los registra para la cobranza de arbitrios.
CREATE TABLE inquilino (
    municipalidad_id bigint      NOT NULL,
    id               bigint      GENERATED ALWAYS AS IDENTITY,
    predio_id        bigint      NOT NULL,
    contribuyente_id bigint      NOT NULL,
    uso              varchar(60),
    vigencia_desde   date        NOT NULL,
    vigencia_hasta   date,
    documento_origen varchar(80) NOT NULL,
    CONSTRAINT inquilino_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT inquilino_predio_fk FOREIGN KEY (municipalidad_id, predio_id)
        REFERENCES predio (municipalidad_id, id),
    CONSTRAINT inquilino_contribuyente_fk FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id)
);

-- ---------- Tablas de valuacion (D-02: sin valores cargados todavia) ----------
CREATE TABLE arancel (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    ejercicio        ejercicio    NOT NULL,
    via_id           bigint       NOT NULL,
    tramo            varchar(80),
    valor_m2         monto_calc   NOT NULL CHECK (valor_m2 >= 0),
    documento_fuente varchar(200) NOT NULL,
    CONSTRAINT arancel_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT arancel_via_fk FOREIGN KEY (municipalidad_id, via_id)
        REFERENCES via (municipalidad_id, id),
    CONSTRAINT arancel_uq UNIQUE (municipalidad_id, ejercicio, via_id, tramo)
);

CREATE TABLE valor_unitario_edificacion (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    ejercicio        ejercicio    NOT NULL,
    partida          varchar(20)  NOT NULL
        CHECK (partida IN ('MUROS','TECHOS','PISOS','PUERTAS','REVESTIMIENTOS',
                           'BANIOS','INSTALACIONES')),
    categoria        char(1)      NOT NULL CHECK (categoria ~ '^[A-I]$'),
    valor_m2         monto_calc   NOT NULL CHECK (valor_m2 >= 0),
    documento_fuente varchar(200) NOT NULL,
    CONSTRAINT valor_unitario_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT valor_unitario_uq UNIQUE (municipalidad_id, ejercicio, partida, categoria)
);

CREATE TABLE depreciacion (
    municipalidad_id    bigint       NOT NULL REFERENCES municipalidad(id),
    id                  bigint       GENERATED ALWAYS AS IDENTITY,
    ejercicio           ejercicio    NOT NULL,
    material            varchar(20)  NOT NULL,
    estado_conservacion varchar(20)  NOT NULL,
    antiguedad_hasta    smallint     NOT NULL CHECK (antiguedad_hasta > 0),
    porcentaje          alicuota     NOT NULL,
    documento_fuente    varchar(200) NOT NULL,
    CONSTRAINT depreciacion_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT depreciacion_uq
        UNIQUE (municipalidad_id, ejercicio, material, estado_conservacion, antiguedad_hasta)
);

-- ---------- Indices ----------
-- municipalidad_id va primero en todo indice selectivo: la politica RLS agrega
-- esa condicion a cada consulta (ARQ-03 §7).
CREATE INDEX contribuyente_nombre_ix   ON contribuyente (municipalidad_id, nombre_razon_social);
CREATE INDEX contribuyente_documento_ix ON contribuyente (municipalidad_id, numero_documento);
CREATE INDEX predio_direccion_ix       ON predio (municipalidad_id, direccion);
CREATE INDEX predio_sector_ix          ON predio (municipalidad_id, sector_id, manzana_id);
CREATE INDEX ficha_predio_ix           ON ficha_catastral (municipalidad_id, predio_id, tipo);
CREATE INDEX titularidad_contribuyente_ix
    ON titularidad (municipalidad_id, contribuyente_id) WHERE vigencia_hasta IS NULL;
