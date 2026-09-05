-- ============================================================================
--  Migracion de muestra que VIOLA A PROPOSITO la regla 1 de ADR-0034: una tabla
--  de tenant con geometria y sin sus cuatro columnas de marco.
--
--  Y es la muestra mas facil de escribir sin darse cuenta de nada, porque esta
--  BIEN por todo lo demas: tiene su PK compuesta tenant-first, su foranea
--  compuesta, su RLS con FORCE, su politica, su indice GiST espacial y su
--  observacion obligatoria. Pasa todas las demas barreras.
--
--  Lo unico que le falta es lo unico que no tiene sintoma: sin el marco, el
--  filtro espacial de la aplicacion lee el padron entero del inquilino y el plan
--  dice «Index». La consulta contesta bien. Solo cuesta.
--
--  Vive como recurso de esta libreria y no en el arbol de migraciones de ningun
--  repositorio: el numero es V900 justamente para que nadie la confunda con una.
-- ============================================================================

CREATE TABLE zona_riesgo_de_muestra (
    municipalidad_id bigint NOT NULL,
    id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    nivel character varying(20) NOT NULL,
    geometria geography(MultiPolygon,4326) NOT NULL,
    observacion character varying(500) NOT NULL,
    usuario_registro character varying(60) NOT NULL,
    fecha_registro timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE zona_riesgo_de_muestra ADD CONSTRAINT zona_riesgo_de_muestra_pk
    PRIMARY KEY (municipalidad_id, id);

CREATE INDEX zona_riesgo_de_muestra_gix ON zona_riesgo_de_muestra USING gist (geometria);

ALTER TABLE zona_riesgo_de_muestra ENABLE ROW LEVEL SECURITY;
ALTER TABLE zona_riesgo_de_muestra FORCE ROW LEVEL SECURITY;
CREATE POLICY zona_riesgo_de_muestra_tenant ON zona_riesgo_de_muestra FOR ALL TO PUBLIC
    USING ((municipalidad_id = (current_setting('app.municipalidad_id'::text))::bigint))
    WITH CHECK ((municipalidad_id = (current_setting('app.municipalidad_id'::text))::bigint));
