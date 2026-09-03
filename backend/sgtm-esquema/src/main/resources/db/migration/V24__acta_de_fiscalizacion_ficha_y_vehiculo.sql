-- ============================================================================
--  V24 — acta_fiscalizacion: de qué ficha partió, y la FK a vehiculo que faltaba (#45)
--
--  Dos columnas y una constraint que V4 no traía:
--
--  1. ficha_id: la versión de ficha_catastral vigente a la fecha de la visita.
--     Sin esto, comparar "hallado" contra "declarado" no es reproducible: la
--     ficha actual del predio puede no ser la que regía cuando se fiscalizó
--     (RNF-075), exactamente el motivo de V19 para declaracion_jurada.
--
--  2. acta_fisc_vehiculo_fk: V4 dejó vehiculo_id sin referencia — un acta
--     vehicular podía apuntar a cualquier entero. Se agrega ahora.
--
--  3. acta_fisc_predio_xor_vehiculo_ck: un acta es de un predio o de un
--     vehiculo, nunca de los dos ni de ninguno — la tabla es compartida entre
--     RF-051 (predial) y RF-052 (vehicular), y nada lo garantizaba todavía.
--
--  Las dos FK van NOT VALID (DAT-01 §0 "cuarto hallazgo"): validarlas es una
--  consulta, y el migrador no tiene contexto de tenant para que la política
--  RLS de la tabla referenciada la deje pasar.
-- ============================================================================

ALTER TABLE acta_fiscalizacion
    ADD COLUMN ficha_id bigint;

ALTER TABLE acta_fiscalizacion
    ADD CONSTRAINT acta_fisc_ficha_fk FOREIGN KEY (municipalidad_id, ficha_id)
        REFERENCES ficha_catastral (municipalidad_id, id) NOT VALID;

ALTER TABLE acta_fiscalizacion
    ADD CONSTRAINT acta_fisc_vehiculo_fk FOREIGN KEY (municipalidad_id, vehiculo_id)
        REFERENCES vehiculo (municipalidad_id, id) NOT VALID;

ALTER TABLE acta_fiscalizacion
    ADD CONSTRAINT acta_fisc_predio_xor_vehiculo_ck
        CHECK ((predio_id IS NOT NULL) <> (vehiculo_id IS NOT NULL));
