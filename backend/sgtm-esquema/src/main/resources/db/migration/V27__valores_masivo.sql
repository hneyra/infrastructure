-- ============================================================================
--  V27 — Generacion masiva de valores, en tres etapas (#38)
--
--  El manual la describe en tres etapas -criterio, generacion e impresion-,
--  no un boton. Estas dos tablas son la primera etapa hecha persistente:
--
--    valor_masivo       — el criterio congelado: tipo, tributo, rango de
--                          ejercicios y la fecha a la que se evalua la deuda
--                          (RNF-075). Se fija UNA vez, al registrar la
--                          corrida, para que reanudar la generacion dias
--                          despues seleccione exactamente los mismos
--                          contribuyentes que el dia en que se registro.
--    valor_masivo_item  — un contribuyente candidato por fila, con su
--                          estado. La generacion (etapa 2) recorre los
--                          PENDIENTE; un corte a mitad dice solo -que- falta
--                          por procesar, sin tabla de progreso aparte -mismo
--                          principio que EmitirDocumento.emitirEnLote-.
--
--  Ninguna de las dos es "el valor" (regla 4): son la orquestacion de la
--  corrida, igual que valor_correlativo (V26) es infraestructura de
--  numeracion y no el documento. Por eso valor_masivo_item SI admite UPDATE
--  -mover un item de PENDIENTE a GENERADO o SIN_DEUDA-, con el mismo
--  argumento que V26 ya dejo escrito: es el estado de un proceso interno,
--  no un acto administrativo que la regla 4 proteja.
--
--  V6 le da RLS a toda tabla con municipalidad_id NOT NULL que exista AL
--  MOMENTO de correr V6 -estas dos no existian entonces-, asi que su RLS y
--  sus privilegios se declaran aqui, explicitos, igual que exige agregar una
--  tabla nueva (CLAUDE.md, "Al agregar una tabla").
-- ============================================================================

CREATE TABLE valor_masivo (
    municipalidad_id  bigint       NOT NULL REFERENCES municipalidad(id),
    id                bigint       GENERATED ALWAYS AS IDENTITY,
    tipo              varchar(4)   NOT NULL CHECK (tipo IN ('OP', 'RD', 'RM')),
    tributo           varchar(20),
    ejercicio_desde   ejercicio    NOT NULL,
    ejercicio_hasta   ejercicio    NOT NULL,
    fecha_criterio    date         NOT NULL,
    origen            varchar(12)  NOT NULL CHECK (origen IN ('SELECCION', 'IMPORTACION')),
    total_candidatos  integer      NOT NULL CHECK (total_candidatos >= 0),
    usuario_registro  varchar(60)  NOT NULL,
    fecha_registro    timestamptz  NOT NULL DEFAULT now(),
    observacion       varchar(500) NOT NULL,
    CONSTRAINT valor_masivo_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT valor_masivo_ejercicios_ck CHECK (ejercicio_desde <= ejercicio_hasta)
);

COMMENT ON TABLE valor_masivo IS
    'La etapa "criterio" de una generacion masiva (#38), congelada al registrarla: '
    'reanudar la generacion no vuelve a evaluar "hoy", evalua fecha_criterio.';

ALTER TABLE valor_masivo ENABLE ROW LEVEL SECURITY;
ALTER TABLE valor_masivo FORCE  ROW LEVEL SECURITY;

CREATE POLICY valor_masivo_tenant ON valor_masivo
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- Sin UPDATE ni DELETE: el criterio, una vez registrado, no se corrige (RF-133
-- lo exige completo o rechazado antes de guardarse; despues de guardado, es el
-- mismo principio de la regla 4 -lo que ya se registro no se edita-).
GRANT SELECT, INSERT ON valor_masivo TO sgtm_app;
GRANT SELECT          ON valor_masivo TO sgtm_readonly;

CREATE TABLE valor_masivo_item (
    municipalidad_id  bigint      NOT NULL,
    id                bigint      GENERATED ALWAYS AS IDENTITY,
    corrida_id        bigint      NOT NULL,
    contribuyente_id  bigint      NOT NULL,
    estado            varchar(10) NOT NULL DEFAULT 'PENDIENTE'
        CHECK (estado IN ('PENDIENTE', 'GENERADO', 'SIN_DEUDA')),
    valor_id          bigint,
    fecha_procesado   timestamptz,
    CONSTRAINT valor_masivo_item_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT valor_masivo_item_corrida_fk FOREIGN KEY (municipalidad_id, corrida_id)
        REFERENCES valor_masivo (municipalidad_id, id),
    CONSTRAINT valor_masivo_item_contribuyente_fk FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id),
    CONSTRAINT valor_masivo_item_valor_fk FOREIGN KEY (municipalidad_id, valor_id)
        REFERENCES valor (municipalidad_id, id),
    -- Un contribuyente entra una sola vez por corrida: sin esto, reanudar una
    -- importacion que se leyo dos veces la misma fila duplicaria el candidato,
    -- y con el, potencialmente, su valor.
    CONSTRAINT valor_masivo_item_uq UNIQUE (municipalidad_id, corrida_id, contribuyente_id),
    -- Solo un item GENERADO lleva valor_id; uno PENDIENTE o SIN_DEUDA, nunca.
    CONSTRAINT valor_masivo_item_valor_ck CHECK (
        (estado = 'GENERADO' AND valor_id IS NOT NULL)
        OR (estado <> 'GENERADO' AND valor_id IS NULL))
);

COMMENT ON TABLE valor_masivo_item IS
    'Un contribuyente candidato de una corrida masiva (#38), con su estado. '
    'La generacion recorre los PENDIENTE; no hay una tabla de progreso aparte.';

ALTER TABLE valor_masivo_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE valor_masivo_item FORCE  ROW LEVEL SECURITY;

CREATE POLICY valor_masivo_item_tenant ON valor_masivo_item
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- A diferencia de valor_masivo, este SI se actualiza en el sitio: es la marca
-- de progreso de un proceso interno (PENDIENTE -> GENERADO/SIN_DEUDA), no un
-- documento notificable. Mismo argumento que V26 ya dejo escrito para
-- valor_correlativo.
GRANT SELECT, INSERT, UPDATE ON valor_masivo_item TO sgtm_app;
GRANT SELECT                 ON valor_masivo_item TO sgtm_readonly;
