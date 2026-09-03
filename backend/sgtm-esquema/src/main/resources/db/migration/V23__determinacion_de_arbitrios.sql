-- ============================================================================
--  V23 — Determinación de arbitrios por predio, servicio y cuota (#31)
--
--  A diferencia del predial —una cabecera por contribuyente, con el detalle por
--  predio en determinacion_predio_detalle (V20)—, el arbitrio se determina por
--  predio y no tiene una fase de calculo compartida entre servicios: limpieza
--  publica, parques y jardines, y serenazgo son montos independientes, cada uno
--  con su propia tasa por sector y uso (ADR-0007) y su propia exclusion por
--  beneficio (#27). La tabla generica `determinacion` no distingue servicio
--  dentro de un mismo tributo 'ARBITRIO'; en vez de forzarlo ahi, el arbitrio
--  tiene su propia cabecera, mismo patron que determinacion_predio_detalle.
--
--  Nada de esta migracion trae una tasa ni una cifra: es estructura (regla 5).
--  Las tasas por sector y uso viven en parametro_tributario (ADR-0007), sin
--  tabla propia — no hace falta una nueva: ParametrosSellados.numero(tipo,
--  clave) ya admite una clave compuesta.
-- ============================================================================

CREATE TABLE determinacion_arbitrio (
    municipalidad_id   bigint       NOT NULL,
    ejercicio          ejercicio    NOT NULL,
    id                 bigint       GENERATED ALWAYS AS IDENTITY,
    servicio           varchar(20)  NOT NULL
        CHECK (servicio IN ('LIMPIEZA_PUBLICA','PARQUES_JARDINES','SERENAZGO')),
    -- Mensual (1-12): "los arbitrios en doce mensuales" (pe.gob.sgtm.dominio.Periodo).
    periodo            smallint     NOT NULL CHECK (periodo BETWEEN 1 AND 12),
    contribuyente_id   bigint       NOT NULL,
    predio_id          bigint       NOT NULL,
    conjunto_id        bigint       NOT NULL,
    monto              dinero       NOT NULL CHECK (monto >= 0),
    -- La llave del parametro leido (tipo:clave de ParametrosSellados), para poder
    -- explicar de donde salio el monto sin recalcular (RNF-075).
    parametro_aplicado varchar(120) NOT NULL,
    -- date y no timestamptz: RNF-075 exige la fecha, no el instante, y el dominio
    -- Java la modela como LocalDate (regla 6: nunca lee el reloj, la recibe).
    fecha_calculo      date         NOT NULL,
    usuario_calculo    varchar(60)  NOT NULL,
    CONSTRAINT det_arbitrio_pk PRIMARY KEY (municipalidad_id, ejercicio, id),
    -- La garantia real del AC "reejecutar el proceso no duplica cargos": no
    -- depende de que el caso de uso recuerde consultar antes de insertar.
    CONSTRAINT det_arbitrio_uq
        UNIQUE (municipalidad_id, ejercicio, servicio, periodo, predio_id),
    CONSTRAINT det_arbitrio_conjunto_fk FOREIGN KEY (municipalidad_id, conjunto_id)
        REFERENCES conjunto_parametros (municipalidad_id, id),
    CONSTRAINT det_arbitrio_contribuyente_fk FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id),
    CONSTRAINT det_arbitrio_predio_fk FOREIGN KEY (municipalidad_id, predio_id)
        REFERENCES predio (municipalidad_id, id)
) PARTITION BY LIST (ejercicio);

CREATE TABLE determinacion_arbitrio_2026 PARTITION OF determinacion_arbitrio FOR VALUES IN (2026);
CREATE TABLE determinacion_arbitrio_2027 PARTITION OF determinacion_arbitrio FOR VALUES IN (2027);

COMMENT ON TABLE determinacion_arbitrio IS
    'Una cuota de arbitrio determinada para un predio (#31): limpieza publica, parques y '
    'jardines o serenazgo, mes a mes. Nunca se modifica: una redeterminacion es una fila '
    'nueva de otro conjunto sellado, o una reversa del asiento que genero (regla 4).';

-- ---------- RLS (ARQ-03, V6 no cubre tablas creadas despues) ----------
ALTER TABLE determinacion_arbitrio ENABLE ROW LEVEL SECURITY;
ALTER TABLE determinacion_arbitrio FORCE  ROW LEVEL SECURITY;

CREATE POLICY determinacion_arbitrio_tenant ON determinacion_arbitrio
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- Particiones: defensa en profundidad (DAT-01 §0, hallazgo 2). Toda particion
-- nueva debe repetir este bloque; la prueba de aislamiento falla el build si
-- aparece una sin RLS o con privilegios concedidos.
ALTER TABLE determinacion_arbitrio_2026 ENABLE ROW LEVEL SECURITY;
ALTER TABLE determinacion_arbitrio_2026 FORCE  ROW LEVEL SECURITY;
CREATE POLICY determinacion_arbitrio_2026_tenant ON determinacion_arbitrio_2026
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

ALTER TABLE determinacion_arbitrio_2027 ENABLE ROW LEVEL SECURITY;
ALTER TABLE determinacion_arbitrio_2027 FORCE  ROW LEVEL SECURITY;
CREATE POLICY determinacion_arbitrio_2027_tenant ON determinacion_arbitrio_2027
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- ---------- Privilegios (V7 §1: solo sobre la tabla padre, nunca particiones) ----------
-- Sin UPDATE ni DELETE: una determinacion no se corrige en el sitio, se reversa
-- el asiento que genero (regla 4). Solo SELECT e INSERT, igual que
-- determinacion_predio_detalle y el libro de asientos.
GRANT SELECT, INSERT ON determinacion_arbitrio TO sgtm_app;
GRANT SELECT           ON determinacion_arbitrio TO sgtm_readonly;
