-- ============================================================================
--  V20 — Determinacion: detalle por predio, y el predial nunca por un solo predio (#30)
--
--  NEG-05 §1: el impuesto predial se calcula por CONTRIBUYENTE, no por predio. La
--  base imponible es el conjunto de sus predios, y sobre ese total se aplican los
--  tramos progresivos. Calcular predio por predio produce un error sistematico a
--  la baja en todo el padron.
--
--  Antes de esta migracion, `determinacion.predio_id` (nullable) no impedia una
--  fila PREDIAL atada a un solo predio: era posible por descuido, no por diseno.
--  El CHECK de abajo lo hace imposible. Los demas tributos (ARBITRIO, por
--  ejemplo) si son por predio, y siguen usando la columna.
--
--  Nada de esta migracion trae un solo valor normativo: es estructura (regla 5).
--  D-02, D-03, D-11, D-12 y D-01 siguen bloqueando el calculo real (ver #30).
-- ============================================================================

ALTER TABLE determinacion
    ADD CONSTRAINT determinacion_predial_sin_predio_ck
        CHECK (tributo <> 'PREDIAL' OR predio_id IS NULL);

COMMENT ON CONSTRAINT determinacion_predial_sin_predio_ck ON determinacion IS
    'El predial se determina por contribuyente (NEG-05 §1), nunca por un solo predio: '
    'el detalle vive en determinacion_predio_detalle. Imposible por diseno, no por convencion.';

-- ---------- Detalle por predio (M02: grilla "detalle de los predios") ----------
CREATE TABLE determinacion_predio_detalle (
    municipalidad_id      bigint      NOT NULL,
    ejercicio             ejercicio   NOT NULL,
    id                    bigint      GENERATED ALWAYS AS IDENTITY,
    determinacion_id      bigint      NOT NULL,
    predio_id             bigint      NOT NULL,
    -- terreno + construccion + obras complementarias (RT-010). Estructura, no
    -- el detalle de como se llego: eso queda en reglas_aplicadas de la cabecera.
    autovaluo             dinero      NOT NULL CHECK (autovaluo >= 0),
    -- Pondera el aporte de este predio a la base (RT-011). El % actualizacion
    -- NO esta modelado aqui: es uno de los cuatro factores sin fuente
    -- identificada de NEG-05 §0.1 (D-11), y no se implementa ni estructuralmente
    -- hasta verificar su origen.
    porcentaje_propiedad  porcentaje  NOT NULL,
    base_imponible_predio dinero      NOT NULL CHECK (base_imponible_predio >= 0),
    CONSTRAINT det_predio_detalle_pk PRIMARY KEY (municipalidad_id, ejercicio, id),
    CONSTRAINT det_predio_detalle_determinacion_fk
        FOREIGN KEY (municipalidad_id, ejercicio, determinacion_id)
        REFERENCES determinacion (municipalidad_id, ejercicio, id),
    CONSTRAINT det_predio_detalle_predio_fk FOREIGN KEY (municipalidad_id, predio_id)
        REFERENCES predio (municipalidad_id, id),
    -- Un predio aporta una sola vez a una misma determinacion.
    CONSTRAINT det_predio_detalle_uq UNIQUE (municipalidad_id, ejercicio, determinacion_id, predio_id)
) PARTITION BY LIST (ejercicio);

CREATE TABLE determinacion_predio_detalle_2026
    PARTITION OF determinacion_predio_detalle FOR VALUES IN (2026);
CREATE TABLE determinacion_predio_detalle_2027
    PARTITION OF determinacion_predio_detalle FOR VALUES IN (2027);

COMMENT ON TABLE determinacion_predio_detalle IS
    'El aporte de cada predio a la base del contribuyente (NEG-05 §1, M02 "detalle de los '
    'predios"). Sin esto, un contribuyente con tres predios no se puede explicar de donde '
    'sale su base.';

-- ---------- RLS (ARQ-03, V6 no cubre tablas creadas despues) ----------
ALTER TABLE determinacion_predio_detalle ENABLE ROW LEVEL SECURITY;
ALTER TABLE determinacion_predio_detalle FORCE  ROW LEVEL SECURITY;

CREATE POLICY determinacion_predio_detalle_tenant ON determinacion_predio_detalle
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- Particiones: defensa en profundidad (DAT-01 §0, hallazgo 2). Toda particion
-- nueva debe repetir este bloque; la prueba de aislamiento falla el build si
-- aparece una sin RLS o con privilegios concedidos.
ALTER TABLE determinacion_predio_detalle_2026 ENABLE ROW LEVEL SECURITY;
ALTER TABLE determinacion_predio_detalle_2026 FORCE  ROW LEVEL SECURITY;
CREATE POLICY determinacion_predio_detalle_2026_tenant ON determinacion_predio_detalle_2026
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

ALTER TABLE determinacion_predio_detalle_2027 ENABLE ROW LEVEL SECURITY;
ALTER TABLE determinacion_predio_detalle_2027 FORCE  ROW LEVEL SECURITY;
CREATE POLICY determinacion_predio_detalle_2027_tenant ON determinacion_predio_detalle_2027
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- ---------- Privilegios (V7 §1: solo sobre la tabla padre, nunca particiones) ----------
-- Sin UPDATE ni DELETE: una determinacion recalculada con otro conjunto crea
-- otra fila, nunca modifica esta (ARQ-09 §5, AC de #30). Solo SELECT e INSERT,
-- igual que el libro de asientos y la auditoria.
GRANT SELECT, INSERT ON determinacion_predio_detalle TO sgtm_app;
GRANT SELECT           ON determinacion_predio_detalle TO sgtm_readonly;
