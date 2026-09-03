-- El marco del lote: las cuatro coordenadas que SI llegan al indice bajo RLS
-- (issue #536, ADR-0022).
--
-- ------------------------------------------------------------------------
-- LO MEDIDO, QUE ES DE DONDE SALE ESTA MIGRACION
-- ------------------------------------------------------------------------
--
-- V61 creo `predio_geometria_gix`, un indice GiST sobre `predio.geometria`, y
-- ADR-0021 lo justifico asi: «sin el, "que predios caen en esta manzana"
-- recorre la tabla entera, que es la unica pregunta por la que la columna
-- existe». Se midio contra PostgreSQL 16 con PostGIS 3.5, con 60 000 lotes
-- repartidos en dos municipalidades y conectado como `sgtm_app`, y el indice NO
-- responde esa pregunta:
--
--   ... WHERE geometria && ST_MakeEnvelope(...)::geography
--     Bitmap Heap Scan on predio  (cost=329.74..3399.28 rows=404)
--       Filter: (geometria && '...'::geography)
--       -> Bitmap Index Scan on predio_sector_ix  (cost=0.00..329.64 rows=30046)
--            Index Cond: (municipalidad_id = current_setting(...)::bigint)
--
-- El plan dice «Index», y ese es justamente el punto: usa un indice por la
-- condicion de la POLITICA y por nada mas, de modo que lee los 30 046 predios
-- del inquilino para devolver unos cuatrocientos. Es la frase de #313 —«un plan
-- que use el indice solo por municipalidad_id vuelve a leer la tabla entera y
-- sigue diciendo Index»— reproducida con otro operador.
--
-- El motivo es el hallazgo 3 de DAT-01 §0 trasladado del texto al espacio:
-- PostgreSQL solo puede promover una condicion POR ENCIMA de la politica de
-- seguridad si la condicion es *leakproof*, y no lo es:
--
--   SELECT proname, proleakproof FROM pg_proc
--    WHERE proname IN ('geography_overlaps','st_intersects','float8le','int8eq');
--     geography_overlaps(geography,geography) | f
--     st_intersects(geography,geography)      | f
--     float8le(double precision,double)       | t
--     int8eq(bigint,bigint)                   | t
--
-- Por eso `LIKE` se escribe como rango (textlike es f) y por eso #313 SI pudo
-- empujar `ficha_id` al indice (int8eq es t). El operador espacial cae del lado
-- de `textlike`: bajo RLS no llega al indice y no hay forma de que llegue sin
-- declarar LEAKPROOF una funcion en C de un tercero —acto de superusuario, y
-- afirmar que ningun error suyo puede revelar la fila de otra municipalidad—.
--
-- ------------------------------------------------------------------------
-- LA SALIDA: decir el marco con operadores que SI son leakproof
-- ------------------------------------------------------------------------
--
-- Cuatro columnas con el marco del lote —su rectangulo envolvente en grados
-- WGS84— en `double precision`, comparadas con `<=` y `>=`. Con ellas, sobre la
-- misma siembra y como `sgtm_app`:
--
--   Bitmap Heap Scan on predio  (cost=940.01..5097.41 rows=2905)
--     -> Bitmap Index Scan on predio_marco_ix  (cost=0.00..939.28 rows=2905)
--          Index Cond: ((municipalidad_id = current_setting(...)::bigint)
--                       AND (marco_oeste <= ...) AND (marco_sur <= ...)
--                       AND (marco_este >= ...) AND (marco_norte >= ...))
--
-- Las cuatro condiciones del marco Y la de la politica salen juntas en el
-- `Index Cond`, que es exactamente lo que #313 exige comprobar.
--
-- `double precision` y no `numeric`, y no es una preferencia: `numeric_le` es
-- `proleakproof = f`. Con numeric estas columnas no servirian para nada.
--
-- GENERATED ALWAYS ... STORED y no un disparador ni codigo de aplicacion: asi
-- las cuatro no pueden separarse de la geometria de la que salen. Un UPDATE de
-- `predio.geometria` las recalcula, y `sgtm_app` no puede escribirlas aunque
-- tenga el privilegio sobre la tabla —PostgreSQL rechaza todo valor explicito
-- sobre una columna generada—.
--
-- LO QUE ESTO NO ARREGLA, medido tambien: con UNA sola municipalidad duena de
-- toda la tabla, la condicion de la politica selecciona el 100 % de las filas y
-- el planificador prefiere el recorrido secuencial aunque el indice sea
-- alcanzable —estima las cuatro desigualdades como independientes, y son un
-- rectangulo: le salen 2 815 filas donde hay unas 440—. El indice sigue siendo
-- alcanzable y la diferencia real es de unas 1 300 paginas a unas 40; a escala
-- municipal son milisegundos, y con mas de una municipalidad —que es la premisa
-- de este sistema— el indice gana solo.
--
-- ------------------------------------------------------------------------
-- LO QUE ESTAS COLUMNAS NO HACEN
-- ------------------------------------------------------------------------
--
-- No valorizan, igual que la geometria de la que salen (ADR-0021): el area del
-- rectangulo no es el area del lote y el area del lote no es la imponible, que
-- sigue siendo `ficha_catastral.area_terreno`, la que midio el tecnico.
--
-- Y no sustituyen a la geometria: son su marco. El poligono se sirve entero,
-- «ni reproyectado ni simplificado» (ADR-0022 §1); esto es solo por donde el
-- motor lo encuentra.
ALTER TABLE predio
    ADD COLUMN marco_oeste double precision
        GENERATED ALWAYS AS (ST_XMin(geometria::geometry)) STORED,
    ADD COLUMN marco_sur double precision
        GENERATED ALWAYS AS (ST_YMin(geometria::geometry)) STORED,
    ADD COLUMN marco_este double precision
        GENERATED ALWAYS AS (ST_XMax(geometria::geometry)) STORED,
    ADD COLUMN marco_norte double precision
        GENERATED ALWAYS AS (ST_YMax(geometria::geometry)) STORED;

COMMENT ON COLUMN predio.marco_oeste IS
    'Longitud minima del poligono del lote, en grados WGS84. Derivada de '
    'predio.geometria: existe para que el marco del plano llegue al indice bajo '
    'RLS, porque el operador espacial no es leakproof (issue #536).';
COMMENT ON COLUMN predio.marco_sur IS
    'Latitud minima del poligono del lote, en grados WGS84. Ver marco_oeste.';
COMMENT ON COLUMN predio.marco_este IS
    'Longitud maxima del poligono del lote, en grados WGS84. Ver marco_oeste.';
COMMENT ON COLUMN predio.marco_norte IS
    'Latitud maxima del poligono del lote, en grados WGS84. Ver marco_oeste.';

-- `municipalidad_id` va PRIMERO y no por costumbre: es la condicion de la
-- politica RLS, la unica que PostgreSQL puede evaluar antes que nada, y sin
-- ella delante el resto del indice no se alcanza.
--
-- El orden de las cuatro es el del plan medido: las dos que acotan por abajo
-- primero. Parcial sobre `geometria IS NOT NULL` porque el plano solo busca
-- lotes levantados, y hoy —medido— no hay ninguno: el indice nace vacio y
-- crece con la carga cartografica.
CREATE INDEX predio_marco_ix
    ON predio (municipalidad_id, marco_oeste, marco_sur, marco_este, marco_norte)
    WHERE geometria IS NOT NULL;

-- `predio_geometria_gix` (V61) se queda, y no porque sirva a esta lectura:
-- medido, no le sirve. Se queda porque retirarlo es corregir una decision de
-- ADR-0021 —que lo creo con su motivo escrito— y eso se hace en el ADR, no como
-- efecto secundario de publicar una lectura. Sigue siendo el indice de
-- cualquier trabajo espacial que corra FUERA de RLS (un control de topologia
-- como sgtm_owner durante una carga), que es donde si se usa.
