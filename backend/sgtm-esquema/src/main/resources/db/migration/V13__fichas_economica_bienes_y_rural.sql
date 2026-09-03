-- ============================================================================
--  V13 — Fichas economica, de bienes comunes y rural (RF-002, RF-003, RF-004)
--
--  Los otros tres tipos de ficha del manual. El mecanismo no cambia: siguen
--  siendo filas de ficha_catastral con su tipo, su version y su vigencia, y
--  ficha_vigente_uq ya admite una de cada tipo por predio. Lo que cambia es lo
--  que cuelga de cada una.
--
--  Cuelgan de la VERSION de la ficha, no del predio. Es la diferencia con el
--  esquema verificado del SRTM, donde grupo_tierra cuelga del predio y lleva su
--  propia vigencia_desde/vigencia_hasta. Aqui la vigencia vive en un solo sitio
--  —la version— porque con dos habria dos respuestas posibles a «como estaba
--  este predio el 1 de enero de 2027», y una determinacion que no se puede
--  reproducir no se puede defender ante una reclamacion.
--
--  El precio de esa decision es que versionar copia tambien estas filas, igual
--  que ya copia las construcciones. No copiarlas seria borrar lo declarado sin
--  que ningun DELETE apareciera en el diff.
-- ============================================================================

-- ---------- Columnas comunes que los tres tipos nuevos necesitan ----------

-- Como se llama la unidad: la edificacion en bienes comunes, el predio rustico
-- en la rural. La pantalla de bienes comunes filtra justamente por aqui.
ALTER TABLE ficha_catastral ADD COLUMN denominacion varchar(160);

-- «Informacion complementaria» de la ficha economica (manual, cap. 2).
ALTER TABLE ficha_catastral ADD COLUMN informacion_complementaria varchar(400);

-- Estas dos nacieron en V1 como el sitio donde iba a ir lo rural cuando fuera
-- un solo valor. Ahora son tablas: un predio rustico tiene VARIOS grupos de
-- tierra y CUATRO colindantes, y dejarlas ademas de las tablas daria dos
-- lugares donde vive el mismo hecho, que es como se llega a que no coincidan.
ALTER TABLE ficha_catastral DROP COLUMN tipo_tierra;
ALTER TABLE ficha_catastral DROP COLUMN colindantes;

-- ---------- Ficha economica (RF-002) ----------
-- La actividad que se desarrolla en la unidad catastral. Es el puente con
-- licencias: sirve para ver si lo que se hace ahi esta autorizado.
CREATE TABLE actividad_economica (
    municipalidad_id bigint       NOT NULL,
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    ficha_id         bigint       NOT NULL,
    -- Quien la conduce. Puede no ser el titular del predio: el arrendatario
    -- conduce el negocio y el propietario paga el predial.
    conductor        varchar(200) NOT NULL,
    nombre_comercial varchar(200),
    -- El giro, con el codigo CIIU. Se guarda el codigo y no una clave ajena a
    -- la tabla ciiu de licencias: ver mas abajo, es la misma razon.
    ciiu             varchar(10),
    area_ocupada     area_m2,
    -- El puente con licencias, por NUMERO y no por clave ajena.
    --
    -- catastro no depende de licencias (ARQ-01 §4), y una clave ajena lo haria
    -- depender de las dos maneras que importan: la de compilacion, porque el
    -- modulo tendria que conocer el otro, y la de datos, porque no se podria
    -- registrar en la ficha una licencia que el otro contexto todavia no
    -- cargo. El tecnico de catastro que ve el cartel en la puerta tiene que
    -- poder anotar el numero aunque licencias vaya con retraso en la carga.
    --
    -- licencia_funcionamiento.numero es varchar(20) y es unico por
    -- municipalidad, asi que el numero identifica sin ambiguedad. Que apunte a
    -- una licencia que no existe es un hallazgo de fiscalizacion, no un error
    -- de integridad: es exactamente lo que esta ficha sirve para detectar.
    licencia_numero  varchar(20),
    licencia_fecha   date,
    -- Autorizacion de anuncio publicitario, del mismo modo.
    anuncio_numero   varchar(20),
    anuncio_fecha    date,
    vigencia_desde   date,
    CONSTRAINT actividad_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT actividad_ficha_fk FOREIGN KEY (municipalidad_id, ficha_id)
        REFERENCES ficha_catastral (municipalidad_id, id)
);

COMMENT ON TABLE actividad_economica IS
    'Actividad economica declarada en la unidad catastral (RF-002). Referencia '
    'la licencia por numero, no por clave ajena: catastro no depende de licencias.';

CREATE INDEX actividad_ficha_ix  ON actividad_economica (municipalidad_id, ficha_id);
CREATE INDEX actividad_licencia_ix ON actividad_economica (municipalidad_id, licencia_numero);

-- ---------- Ficha de bienes comunes (RF-003) ----------
-- Las areas comunes de una edificacion en regimen de propiedad exclusiva y
-- comun. Su valor no es de nadie en particular: se reparte entre las unidades.
CREATE TABLE bien_comun (
    municipalidad_id bigint       NOT NULL,
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    ficha_id         bigint       NOT NULL,
    descripcion      varchar(160) NOT NULL,
    area             area_m2      NOT NULL,
    -- Los bienes comunes se valorizan como una construccion mas: llevan sus
    -- categorias y su estado. Las letras y su significado son D-02a.
    material_estructural varchar(20)
        CHECK (material_estructural IN ('CONCRETO','LADRILLO','ADOBE','MADERA','QUINCHA','OTRO')),
    estado_conservacion  varchar(20)
        CHECK (estado_conservacion IN ('MUY_BUENO','BUENO','REGULAR','MALO','RUINOSO')),
    anio_construccion    ejercicio,
    CONSTRAINT bien_comun_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT bien_comun_ficha_fk FOREIGN KEY (municipalidad_id, ficha_id)
        REFERENCES ficha_catastral (municipalidad_id, id)
);

COMMENT ON TABLE bien_comun IS
    'Areas comunes de una edificacion (RF-003), cuyo valor se distribuye entre las unidades.';

CREATE INDEX bien_comun_ficha_ix ON bien_comun (municipalidad_id, ficha_id);

-- Cuanto le toca a cada unidad de lo comun. Sin esto, la lista de areas
-- comunes es una lista: no reparte nada.
CREATE TABLE participacion_comun (
    municipalidad_id bigint     NOT NULL,
    id               bigint     GENERATED ALWAYS AS IDENTITY,
    ficha_id         bigint     NOT NULL,
    -- La unidad que participa. Es un predio del mismo padron catastral.
    predio_id        bigint     NOT NULL,
    porcentaje       porcentaje NOT NULL,
    CONSTRAINT participacion_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT participacion_ficha_fk FOREIGN KEY (municipalidad_id, ficha_id)
        REFERENCES ficha_catastral (municipalidad_id, id),
    CONSTRAINT participacion_predio_fk FOREIGN KEY (municipalidad_id, predio_id)
        REFERENCES predio (municipalidad_id, id),
    CONSTRAINT participacion_unidad_uq UNIQUE (municipalidad_id, ficha_id, predio_id)
);

COMMENT ON TABLE participacion_comun IS
    'Porcentaje de participacion de cada unidad en los bienes comunes de la edificacion.';

CREATE INDEX participacion_ficha_ix  ON participacion_comun (municipalidad_id, ficha_id);
CREATE INDEX participacion_predio_ix ON participacion_comun (municipalidad_id, predio_id);

-- Las participaciones de una ficha no pueden pasar de 100. Mismo motivo que
-- titularidad: si suman 120, el valor de lo comun se reparte por mas de lo que
-- hay y todas las unidades del edificio pagan de mas.
--
-- Diferido, y por el mismo motivo que alli: corregir el reparto es mover
-- porcentaje de una unidad a otra, y en una transaccion que sube una antes de
-- bajar la otra el estado intermedio pasa de 100 sin que el final lo haga.
CREATE OR REPLACE FUNCTION verificar_participacion_no_excede() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
    v_muni  bigint := COALESCE(NEW.municipalidad_id, OLD.municipalidad_id);
    v_ficha bigint := COALESCE(NEW.ficha_id, OLD.ficha_id);
    v_total numeric(7,4);
BEGIN
    SELECT COALESCE(sum(porcentaje), 0) INTO v_total
      FROM participacion_comun
     WHERE municipalidad_id = v_muni
       AND ficha_id = v_ficha;
    IF v_total > 100 THEN
        RAISE EXCEPTION
          'Las participaciones de la ficha % suman %, no pueden exceder 100',
          v_ficha, v_total;
    END IF;
    RETURN NULL;
END
$fn$;

CREATE CONSTRAINT TRIGGER participacion_no_excede_trg
    AFTER INSERT OR UPDATE OR DELETE ON participacion_comun
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION verificar_participacion_no_excede();

-- ---------- Ficha rural (RF-004) ----------
-- Grupos de tierra del predio rustico. Un predio tiene varios, y cada uno se
-- valoriza con su propio arancel por hectarea.
--
-- cantidad_hectareas es numeric(12,4), el mismo tipo que grupo_tierra en
-- ../srtm/docs/40-datos/ddl/esquema-verificado.sql: una columna que existe en
-- los dos esquemas tiene el mismo tipo en los dos. No es area_m2 porque el
-- arancel rural se publica por hectarea, y convertir para guardar obligaria a
-- volver a convertir para calcular, con un redondeo por medio que D-03c todavia
-- no ha inventariado.
CREATE TABLE tierra_rural (
    municipalidad_id  bigint        NOT NULL,
    id                bigint        GENERATED ALWAYS AS IDENTITY,
    ficha_id          bigint        NOT NULL,
    clasificacion     varchar(60)   NOT NULL,
    calidad_agrologica varchar(40),
    -- Con riego o de secano: cambia el arancel, no la superficie.
    riego             varchar(20)   NOT NULL DEFAULT 'SECANO'
        CHECK (riego IN ('BAJO_RIEGO','SECANO')),
    cantidad_hectareas numeric(12,4) NOT NULL CHECK (cantidad_hectareas > 0),
    cantidad_hectareas_comun numeric(12,4) CHECK (cantidad_hectareas_comun >= 0),
    CONSTRAINT tierra_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT tierra_ficha_fk FOREIGN KEY (municipalidad_id, ficha_id)
        REFERENCES ficha_catastral (municipalidad_id, id)
);

COMMENT ON TABLE tierra_rural IS
    'Grupos de tierra de un predio rustico (RF-004), en hectareas, con su clasificacion y riego.';

CREATE INDEX tierra_ficha_ix ON tierra_rural (municipalidad_id, ficha_id);

-- Los colindantes del predio rustico. Cuatro orientaciones, una fila cada una;
-- no son un texto libre porque una rectificacion de linderos se discute
-- orientacion por orientacion.
CREATE TABLE colindante_rural (
    municipalidad_id bigint       NOT NULL,
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    ficha_id         bigint       NOT NULL,
    orientacion      varchar(10)  NOT NULL
        CHECK (orientacion IN ('NORTE','SUR','ESTE','OESTE')),
    descripcion      varchar(200) NOT NULL,
    CONSTRAINT colindante_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT colindante_ficha_fk FOREIGN KEY (municipalidad_id, ficha_id)
        REFERENCES ficha_catastral (municipalidad_id, id),
    CONSTRAINT colindante_orientacion_uq UNIQUE (municipalidad_id, ficha_id, orientacion)
);

COMMENT ON TABLE colindante_rural IS
    'Predios colindantes de un predio rustico (RF-004), por orientacion.';

CREATE INDEX colindante_ficha_ix ON colindante_rural (municipalidad_id, ficha_id);

-- ---------- RLS ----------
-- Las cinco llevan municipalidad_id NOT NULL, asi que la prueba de aislamiento
-- les exige politica propia. Se repite el bloque de V6 tal cual.
ALTER TABLE actividad_economica  ENABLE ROW LEVEL SECURITY;
ALTER TABLE actividad_economica  FORCE  ROW LEVEL SECURITY;
ALTER TABLE bien_comun           ENABLE ROW LEVEL SECURITY;
ALTER TABLE bien_comun           FORCE  ROW LEVEL SECURITY;
ALTER TABLE participacion_comun  ENABLE ROW LEVEL SECURITY;
ALTER TABLE participacion_comun  FORCE  ROW LEVEL SECURITY;
ALTER TABLE tierra_rural         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tierra_rural         FORCE  ROW LEVEL SECURITY;
ALTER TABLE colindante_rural     ENABLE ROW LEVEL SECURITY;
ALTER TABLE colindante_rural     FORCE  ROW LEVEL SECURITY;

CREATE POLICY actividad_por_tenant ON actividad_economica
    USING (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

CREATE POLICY bien_comun_por_tenant ON bien_comun
    USING (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

CREATE POLICY participacion_por_tenant ON participacion_comun
    USING (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

CREATE POLICY tierra_por_tenant ON tierra_rural
    USING (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

CREATE POLICY colindante_por_tenant ON colindante_rural
    USING (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- Sin DELETE y tampoco UPDATE. Es MAS estricto que construccion y
-- otra_instalacion, que en V7 si tienen UPDATE, y es deliberado: el
-- repositorio no actualiza ninguna de las dos —modificar una ficha es crear
-- la version siguiente—, asi que ese UPDATE es un privilegio que nadie usa y
-- que un dia alguien usaria. Aqui la invariante la sostiene la base y no la
-- costumbre (regla 4, RNF-051; manual cap. 2 §Actualizacion del Catastro).
GRANT SELECT, INSERT ON actividad_economica  TO sgtm_app;
GRANT SELECT, INSERT ON bien_comun           TO sgtm_app;
GRANT SELECT, INSERT ON participacion_comun  TO sgtm_app;
GRANT SELECT, INSERT ON tierra_rural         TO sgtm_app;
GRANT SELECT, INSERT ON colindante_rural     TO sgtm_app;

GRANT SELECT ON actividad_economica  TO sgtm_readonly;
GRANT SELECT ON bien_comun           TO sgtm_readonly;
GRANT SELECT ON participacion_comun  TO sgtm_readonly;
GRANT SELECT ON tierra_rural         TO sgtm_readonly;
GRANT SELECT ON colindante_rural     TO sgtm_readonly;
