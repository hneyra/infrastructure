-- ============================================================================
--  V26 — Correlativo de valores, por municipalidad, tipo y ejercicio (#37)
--
--  `valor` y `valor_detalle` ya existen desde V3: lo unico que faltaba era el
--  mecanismo de numeracion. El formato exacto del numero (con que ceros, si se
--  reinicia) lo decide D-09; esta tabla solo garantiza que no se repita y que
--  no deje huecos bajo concurrencia real: el UPSERT de mas abajo bloquea la
--  fila del contador durante el UPDATE, asi que dos emisiones concurrentes
--  para el mismo tipo/ejercicio se serializan en el motor, no en la
--  aplicacion (AC de #37: "diez emisiones concurrentes producen diez numeros
--  consecutivos, sin huecos ni repetidos").
--
--  V6 le da RLS a toda tabla con municipalidad_id NOT NULL que exista AL
--  MOMENTO de correr V6 — esta tabla no existia entonces, asi que su RLS y
--  sus privilegios se declaran aqui, explicitos, igual que exige agregar una
--  tabla nueva (CLAUDE.md, "Al agregar una tabla").
-- ============================================================================

CREATE TABLE valor_correlativo (
    municipalidad_id bigint      NOT NULL REFERENCES municipalidad(id),
    tipo             varchar(4)  NOT NULL CHECK (tipo IN ('OP', 'RD', 'RM')),
    ejercicio        ejercicio   NOT NULL,
    ultimo           bigint      NOT NULL DEFAULT 0 CHECK (ultimo >= 0),
    CONSTRAINT valor_correlativo_pk PRIMARY KEY (municipalidad_id, tipo, ejercicio)
);

COMMENT ON TABLE valor_correlativo IS
    'El ultimo correlativo emitido por municipalidad, tipo y ejercicio de valor (#37). '
    'Se lee y se incrementa en una sola sentencia UPSERT; nunca con SELECT + UPDATE.';

ALTER TABLE valor_correlativo ENABLE ROW LEVEL SECURITY;
ALTER TABLE valor_correlativo FORCE  ROW LEVEL SECURITY;

CREATE POLICY valor_correlativo_tenant ON valor_correlativo
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- A diferencia de valor y valor_detalle, este contador SI se actualiza en el
-- sitio: es infraestructura interna de numeracion, no un documento notificable.
GRANT SELECT, INSERT, UPDATE ON valor_correlativo TO sgtm_app;
GRANT SELECT                 ON valor_correlativo TO sgtm_readonly;
