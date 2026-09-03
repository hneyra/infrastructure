-- ============================================================================
--  V12 — Responsables solidarios (RF-012)
--
--  Quien responde por la deuda ademas del contribuyente: el conyuge, los
--  condominos y el poseedor. Es lo que despues permite notificar y cobrar a
--  quien corresponde, y sin ello una cobranza coactiva se dirige al titular
--  registral aunque la ley admita dirigirla a otro.
--
--  Con vigencia, no con un booleano: un condominio termina cuando se vende la
--  parte, y una notificacion de 2027 tiene que poder decir a quien se podia
--  dirigir EN 2027, no a quien responde hoy.
-- ============================================================================

CREATE TABLE responsable_solidario (
    municipalidad_id bigint      NOT NULL,
    id               bigint      GENERATED ALWAYS AS IDENTITY,
    -- El obligado principal.
    contribuyente_id bigint      NOT NULL,
    -- Quien responde con el. Es otro contribuyente del mismo padron: para
    -- notificarle hace falta su domicilio, y el domicilio cuelga del padron.
    responsable_id   bigint      NOT NULL,
    vinculo          varchar(20) NOT NULL
        CHECK (vinculo IN ('CONYUGE','CONDOMINO','POSEEDOR','REPRESENTANTE')),
    -- Cuanto le toca, cuando el vinculo lo reparte. Nulo cuando la
    -- responsabilidad es solidaria por el total, que es el caso del conyuge.
    porcentaje       porcentaje,
    vigencia_desde   date        NOT NULL,
    vigencia_hasta   date,
    documento_origen varchar(80) NOT NULL,
    CONSTRAINT responsable_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT responsable_contribuyente_fk FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id),
    CONSTRAINT responsable_responsable_fk FOREIGN KEY (municipalidad_id, responsable_id)
        REFERENCES contribuyente (municipalidad_id, id),
    CONSTRAINT responsable_vigencia_ck
        CHECK (vigencia_hasta IS NULL OR vigencia_hasta >= vigencia_desde),
    -- Nadie responde solidariamente por si mismo: seria una fila que no dice
    -- nada y que la cobranza tendria que aprender a ignorar.
    CONSTRAINT responsable_distinto_ck CHECK (responsable_id <> contribuyente_id)
);

COMMENT ON TABLE responsable_solidario IS
    'Quien responde por la deuda ademas del contribuyente (RF-012), con vigencia.';

-- Un mismo vinculo no se repite mientras esta vigente. Dos filas iguales
-- abiertas harian que la notificacion saliera por duplicado.
CREATE UNIQUE INDEX responsable_vigente_uq
    ON responsable_solidario (municipalidad_id, contribuyente_id, responsable_id, vinculo)
    WHERE vigencia_hasta IS NULL;

-- Se consulta en los dos sentidos: «quien responde por este» al notificar, y
-- «de quien responde este» cuando alguien pregunta por que le llego un valor.
CREATE INDEX responsable_por_contribuyente_ix
    ON responsable_solidario (municipalidad_id, contribuyente_id);
CREATE INDEX responsable_por_responsable_ix
    ON responsable_solidario (municipalidad_id, responsable_id);

-- ---------- RLS ----------
-- La tabla lleva municipalidad_id NOT NULL, asi que la prueba de aislamiento
-- le exige politica propia. Se repite el bloque de V6 tal cual.
ALTER TABLE responsable_solidario ENABLE ROW LEVEL SECURITY;
ALTER TABLE responsable_solidario FORCE ROW LEVEL SECURITY;

CREATE POLICY responsable_por_tenant ON responsable_solidario
    USING (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- Sin DELETE: un vinculo se cierra con vigencia_hasta (regla 4, RNF-051).
GRANT SELECT, INSERT, UPDATE ON responsable_solidario TO sgtm_app;
GRANT SELECT                  ON responsable_solidario TO sgtm_readonly;
