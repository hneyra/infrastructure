-- ============================================================================
--  V14 — Indices de la consulta transversal de fichas (RF-006)
--
--  Los tres que la grilla necesita y V1 no tenia. No son «por si acaso»: cada
--  uno responde a una condicion concreta de la consulta, y la prueba de volumen
--  de #20 comprueba con EXPLAIN que el planificador los usa en vez de recorrer
--  la tabla. Un indice que nadie verifica es un indice que quiza no se usa.
-- ============================================================================

-- Busqueda por PREFIJO del codigo de referencia catastral.
--
-- El codigo se compone de sector, manzana, lote, edificacion, entrada, piso y
-- unidad, asi que «dame todo el sector 2501» es la pregunta natural y se
-- escribe LIKE 'prefijo%'.
--
-- El indice de predio_codigo_uq NO sirve para eso: se creo con la intercalacion
-- de la base, y con cualquiera que no sea C el planificador no puede usar un
-- btree para LIKE. text_pattern_ops es exactamente la clase de operadores que
-- ordena por byte y hace que el prefijo sea un rango.
CREATE INDEX predio_codigo_prefijo_ix
    ON predio (municipalidad_id, codigo_ref_catastral text_pattern_ops);

-- El lateral que trae UN titular por predio ordena por porcentaje. Sin este
-- indice, cada fila de la grilla recorre las titularidades del predio; con
-- veinte filas por pagina eso son veinte recorridos.
CREATE INDEX titularidad_predio_vigente_ix
    ON titularidad (municipalidad_id, predio_id, porcentaje DESC)
    WHERE vigencia_hasta IS NULL;

-- La grilla filtra la ficha por vigencia, no por predio: al reves que
-- ficha_predio_ix, que empieza por predio_id y no sirve cuando no hay predio
-- que buscar. Aqui la fila se elige por «las que rigen a esta fecha» y despues
-- se une con el predio.
CREATE INDEX ficha_vigencia_ix
    ON ficha_catastral (municipalidad_id, vigencia_desde, tipo)
    WHERE vigencia_hasta IS NULL;
