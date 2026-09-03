-- ============================================================================
--  V19 — declaracion_jurada: enlace con la ficha vigente y rectificatoria (#28)
--
--  Dos columnas que la tabla original (V2) no traia:
--
--  1. ficha_catastral_id: la version de ficha_catastral vigente a la fecha de
--     presentacion. Sin esto, reimprimir una DJ de 2024 en 2030 leeria la
--     ficha ACTUAL del predio, no la que existia cuando se declaro (RNF-075).
--
--  2. dj_rectifica_id: autorreferencia. Una rectificatoria no modifica la DJ
--     anterior (regla 4): la sustituye dejando las dos filas, y esta columna
--     es lo que enlaza la nueva con la que sustituye.
--
--  Las dos van NOT VALID (DAT-01 §0 "cuarto hallazgo"): validar una FK es una
--  consulta, y el migrador no tiene contexto de tenant para que la politica RLS
--  de la tabla referenciada la deje pasar.
-- ============================================================================

ALTER TABLE declaracion_jurada
    ADD COLUMN ficha_catastral_id bigint,
    ADD COLUMN dj_rectifica_id    bigint;

ALTER TABLE declaracion_jurada
    ADD CONSTRAINT dj_ficha_catastral_fk FOREIGN KEY (municipalidad_id, ficha_catastral_id)
        REFERENCES ficha_catastral (municipalidad_id, id) NOT VALID;

ALTER TABLE declaracion_jurada
    ADD CONSTRAINT dj_rectifica_fk FOREIGN KEY (municipalidad_id, dj_rectifica_id)
        REFERENCES declaracion_jurada (municipalidad_id, id) NOT VALID;

CREATE INDEX dj_rectifica_ix ON declaracion_jurada (municipalidad_id, dj_rectifica_id)
    WHERE dj_rectifica_id IS NOT NULL;
