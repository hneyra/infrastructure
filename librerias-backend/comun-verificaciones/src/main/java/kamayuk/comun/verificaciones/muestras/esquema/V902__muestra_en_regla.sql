-- ============================================================================
--  Los CONTRASTES. Ninguna de estas cuatro tablas debe producir un hallazgo, y
--  cada una cierra una forma distinta de que la regla muerda de mas — que es la
--  otra manera de perder una verificacion: la que grita el primer dia se
--  silencia (#437).
--
--   1. `zonificacion_de_muestra` — la plantilla de ADR-0034 §4.1 completa. Si
--      esta saliera roja, la regla estaria prohibiendo la unica forma correcta.
--
--   2. `vigencia_de_muestra` — un `EXCLUDE USING gist` con `daterange &&`. El
--      operador `&&` esta SOBRECARGADO: aqui es solapamiento TEMPORAL, es como
--      `ficha_catastral` y `titularidad` impiden que dos vigencias se pisen, y
--      no tiene nada que ver con geometria. Ademas va en una restriccion que el
--      motor evalua al ESCRIBIR, no en un `WHERE` que el planificador resuelve
--      bajo la politica.
--
--   3. `manzana_de_muestra` — geometria, sin marco, y SIN RLS. No es tabla de
--      tenant: la regla es sobre las de tenant, porque el defecto es de la
--      politica y sin politica no hay defecto.
--
--   4. `padron_de_muestra` — tabla de tenant, con RLS, y sin una sola columna
--      de geometria. Es la inmensa mayoria del esquema, y si la regla la
--      alcanzara pediria cuatro columnas de marco a las 113 tablas de `rentas`.
-- ============================================================================

CREATE TABLE zonificacion_de_muestra (
    municipalidad_id bigint NOT NULL,
    id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    codigo character varying(20) NOT NULL,
    geometria geography(MultiPolygon,4326) NOT NULL,
    observacion character varying(500) NOT NULL,
    marco_oeste double precision GENERATED ALWAYS AS (st_xmin(((geometria)::geometry)::box3d)) STORED,
    marco_sur double precision GENERATED ALWAYS AS (st_ymin(((geometria)::geometry)::box3d)) STORED,
    marco_este double precision GENERATED ALWAYS AS (st_xmax(((geometria)::geometry)::box3d)) STORED,
    marco_norte double precision GENERATED ALWAYS AS (st_ymax(((geometria)::geometry)::box3d)) STORED,
    CONSTRAINT zonificacion_de_muestra_pk PRIMARY KEY (municipalidad_id, id)
);
CREATE INDEX zonificacion_de_muestra_marco_ix ON zonificacion_de_muestra
    USING btree (municipalidad_id, marco_oeste, marco_sur, marco_este, marco_norte);
CREATE INDEX zonificacion_de_muestra_gix ON zonificacion_de_muestra
    USING gist (geometria) WHERE (geometria IS NOT NULL);
ALTER TABLE zonificacion_de_muestra ENABLE ROW LEVEL SECURITY;
ALTER TABLE zonificacion_de_muestra FORCE ROW LEVEL SECURITY;

CREATE TABLE vigencia_de_muestra (
    municipalidad_id bigint NOT NULL,
    id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    predio_id bigint NOT NULL,
    vigencia_desde date NOT NULL,
    vigencia_hasta date,
    CONSTRAINT vigencia_de_muestra_sin_solape EXCLUDE USING gist (
        municipalidad_id WITH =,
        predio_id WITH =,
        daterange(vigencia_desde, vigencia_hasta) WITH &&
    ) DEFERRABLE
);
ALTER TABLE vigencia_de_muestra ENABLE ROW LEVEL SECURITY;

CREATE TABLE manzana_de_muestra (
    id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    codigo character varying(20) NOT NULL,
    geometria geography(MultiPolygon,4326)
);

CREATE TABLE padron_de_muestra (
    municipalidad_id bigint NOT NULL,
    id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    nombre character varying(160) NOT NULL,
    CONSTRAINT padron_de_muestra_pk PRIMARY KEY (municipalidad_id, id)
);
ALTER TABLE padron_de_muestra ENABLE ROW LEVEL SECURITY;
ALTER TABLE padron_de_muestra FORCE ROW LEVEL SECURITY;

-- Y una quinta que HOY esta en regla y dejara de estarlo en V903: nace sin
-- geometria, asi que no tiene por que llevar marco. Ver la cabecera de V903.
CREATE TABLE establecimiento_de_muestra (
    municipalidad_id bigint NOT NULL,
    id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    razon_social character varying(160) NOT NULL,
    CONSTRAINT establecimiento_de_muestra_pk PRIMARY KEY (municipalidad_id, id)
);
ALTER TABLE establecimiento_de_muestra ENABLE ROW LEVEL SECURITY;
ALTER TABLE establecimiento_de_muestra FORCE ROW LEVEL SECURITY;
