-- ============================================================================
--  V22 — Una sola versión vigente por código de infracción (#43)
--
--  codigo_infraccion ya vive desde V4, con vigencia_desde/vigencia_hasta. Falta
--  la garantia que V1 ya usa en ficha_catastral (ficha_vigente_uq): que no
--  puedan quedar dos versiones vigentes del mismo codigo a la vez. Modificar un
--  codigo cierra la version vigente (vigencia_hasta) antes de insertar la
--  version nueva (regla 4); este indice hace imposible saltarse ese orden.
-- ============================================================================

CREATE UNIQUE INDEX codigo_infraccion_vigente_uq
    ON codigo_infraccion (municipalidad_id, familia, codigo)
    WHERE vigencia_hasta IS NULL;
