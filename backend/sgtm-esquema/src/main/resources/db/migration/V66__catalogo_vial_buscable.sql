-- ============================================================================
--  V66 — El catalogo vial se puede buscar (#565)
--
--  `GET /catastro/vias` no admitia ningun filtro: para elegir una via habia que
--  descargar el catalogo entero —1 110 en Catacaos, tres peticiones de 500— y
--  buscar en el cliente. Los cuatro filtros que el contrato declara desde #312
--  no los leia nadie, que es el hueco de #544.
--
--  Aqui va lo que la busqueda necesita de la base. Lo demas —que filtro se lee,
--  cual se rechaza y con que motivo— es del controlador.
--
--  ------------------------------------------------------------------------
--  EL CUARTO HALLAZGO DE RLS, MEDIDO OTRA VEZ Y CON UNA VUELTA MAS
--  ------------------------------------------------------------------------
--
--  DAT-01 §0 (tercer hallazgo) dice que bajo RLS un `LIKE 'prefijo%'` no llega
--  nunca al indice, porque `textlike` no es leakproof, y que la salida es
--  escribir el prefijo como rango con `~>=~` / `~<~`, que si lo son.
--
--  Eso es necesario y NO es suficiente. Medido contra PostgreSQL 16 sobre
--  60 000 vias (dos municipalidades de 30 000), como `sgtm_app` y con la
--  politica activa:
--
--    SELECT count(*) FROM via WHERE nombre_normalizado(nombre) ~>=~ 'santa'
--                               AND nombre_normalizado(nombre) ~<~ 'santb';
--      -> Bitmap Index Scan on via_pk   (solo por municipalidad_id)
--         Filter: nombre_normalizado(...) ~>=~ ...      216 ms
--
--    SELECT count(*) FROM via WHERE nombre_busqueda ~>=~ 'santa'
--                               AND nombre_busqueda ~<~ 'santa' || chr(1114111);
--      -> Bitmap Index Scan on via_nombre_busqueda_ix
--         Index Cond: municipalidad_id = ... AND nombre_busqueda ~>=~ ...   5 ms
--
--    (y con LIKE sobre la misma columna: Seq Scan, 27 ms, «Rows Removed by
--     Filter: 57000» — o sea recorriendo tambien la municipalidad ajena)
--
--  El rango con los operadores correctos sobre una columna ENVUELTA en una
--  funcion tampoco llega al indice: `lower`, `upper`, `unaccent` y
--  `regexp_replace` tienen `proleakproof = false`, asi que la condicion entera
--  se queda como Filter detras de la politica y el indice funcional no se usa.
--  Un indice de expresion sobre `nombre_normalizado(nombre)` seria un indice
--  que nadie usa, y nada en el plan lo diria: las filas salen bien.
--
--  Por eso la normalizacion se materializa en una COLUMNA, y la condicion se
--  escribe sobre la columna desnuda.
-- ============================================================================

-- ---------- El nombre, normalizado y materializado ----------
-- `nombre_normalizado` es la de V11 —minusculas, sin tildes, sin espacios
-- repetidos— y esta declarada IMMUTABLE ahi mismo, que es lo que permite
-- usarla en una columna generada. Generada y no un disparador: no puede
-- desincronizarse del nombre porque no hay dos sitios donde escribirla.
--
-- El termino que se busca se normaliza con LA MISMA funcion dentro del SQL de
-- la consulta —`nombre_busqueda ~>=~ nombre_normalizado(:texto)`—, de modo que
-- no existe una segunda implementacion en Java que pueda apartarse de esta.
ALTER TABLE via
    ADD COLUMN nombre_busqueda text GENERATED ALWAYS AS (nombre_normalizado(nombre)) STORED;

COMMENT ON COLUMN via.nombre_busqueda IS
    'El nombre en minusculas, sin tildes y sin espacios repetidos (V11). Existe para que la busqueda por prefijo compare una columna desnuda: envuelta en la funcion, la condicion no es leakproof y no llega al indice bajo RLS (#565).';

-- ---------- Los dos indices de prefijo ----------
-- text_pattern_ops por lo mismo que predio_codigo_prefijo_ix (V14): ordena por
-- byte, y con cualquier intercalacion que no sea C un btree normal no sirve
-- para un rango de prefijo.
CREATE INDEX via_nombre_busqueda_ix
    ON via (municipalidad_id, nombre_busqueda text_pattern_ops);

CREATE INDEX via_codigo_prefijo_ix
    ON via (municipalidad_id, codigo text_pattern_ops);

COMMENT ON INDEX via_nombre_busqueda_ix IS
    'Busqueda de via por prefijo de nombre (#565). Medido: con el, Index Cond; sin el, la condicion se queda de Filter sobre el catalogo entero de la municipalidad.';

COMMENT ON INDEX via_codigo_prefijo_ix IS
    'Busqueda de via por prefijo de codigo (#565). via_codigo_uq no sirve: se creo con la intercalacion de la base y no ordena por byte.';
