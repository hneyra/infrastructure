-- ============================================================================
--  Migracion de muestra que VIOLA A PROPOSITO las tres mitades restantes de la
--  regla 1 de ADR-0034, cada una en una tabla, porque son tres defectos y no
--  uno:
--
--   1. `faja_marginal_de_muestra` — las cuatro columnas estan y son `numeric`.
--      Es el error que mas cuesta ver, porque «un decimal es un decimal»:
--      `numeric_le` tampoco es leakproof, asi que las columnas dejan de servir
--      y NADA se pone rojo. El defecto vuelve entero con las cuatro columnas
--      puestas.
--
--   2. `seccion_via_de_muestra` — las cuatro estan, en `double precision`, y
--      escritas A MANO en vez de generadas. Se quedan viejas en cuanto alguien
--      corrija la geometria, y a partir de ahi el filtro esconde lotes sin
--      decirlo, que es peor que leer de mas.
--
--   3. `intervencion_de_muestra` — las cuatro estan, generadas y bien tipadas,
--      y NO hay indice. Cuatro columnas sin su indice no compran nada: el
--      filtro sigue siendo un Filter sobre el padron entero. Es la mitad que
--      se olvida al copiar la plantilla, porque la tabla ya «se ve bien».
-- ============================================================================

CREATE TABLE faja_marginal_de_muestra (
    municipalidad_id bigint NOT NULL,
    id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    geometria geography(MultiPolygon,4326) NOT NULL,
    marco_oeste numeric(12,8) GENERATED ALWAYS AS (st_xmin(((geometria)::geometry)::box3d)) STORED,
    marco_sur numeric(12,8) GENERATED ALWAYS AS (st_ymin(((geometria)::geometry)::box3d)) STORED,
    marco_este numeric(12,8) GENERATED ALWAYS AS (st_xmax(((geometria)::geometry)::box3d)) STORED,
    marco_norte numeric(12,8) GENERATED ALWAYS AS (st_ymax(((geometria)::geometry)::box3d)) STORED
);
CREATE INDEX faja_marginal_de_muestra_marco_ix ON faja_marginal_de_muestra
    USING btree (municipalidad_id, marco_oeste, marco_sur, marco_este, marco_norte);
ALTER TABLE faja_marginal_de_muestra ENABLE ROW LEVEL SECURITY;

CREATE TABLE seccion_via_de_muestra (
    municipalidad_id bigint NOT NULL,
    id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    geometria geography(LineString,4326) NOT NULL,
    marco_oeste double precision,
    marco_sur double precision,
    marco_este double precision,
    marco_norte double precision
);
CREATE INDEX seccion_via_de_muestra_marco_ix ON seccion_via_de_muestra
    USING btree (municipalidad_id, marco_oeste, marco_sur, marco_este, marco_norte);
ALTER TABLE seccion_via_de_muestra ENABLE ROW LEVEL SECURITY;

CREATE TABLE intervencion_de_muestra (
    municipalidad_id bigint NOT NULL,
    id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
    geometria geography(MultiPolygon,4326) NOT NULL,
    marco_oeste double precision GENERATED ALWAYS AS (st_xmin(((geometria)::geometry)::box3d)) STORED,
    marco_sur double precision GENERATED ALWAYS AS (st_ymin(((geometria)::geometry)::box3d)) STORED,
    marco_este double precision GENERATED ALWAYS AS (st_xmax(((geometria)::geometry)::box3d)) STORED,
    marco_norte double precision GENERATED ALWAYS AS (st_ymax(((geometria)::geometry)::box3d)) STORED
);
CREATE INDEX intervencion_de_muestra_gix ON intervencion_de_muestra USING gist (geometria);
ALTER TABLE intervencion_de_muestra ENABLE ROW LEVEL SECURITY;
