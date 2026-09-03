-- ============================================================================
--  V30 — Lo que le pasa a un recibo despues de emitirse (#34, RF-082, RF-083)
--
--  V29 decidio que `recibo` y `recibo_detalle` no se editan: le retiro a
--  `sgtm_app` el privilegio de UPDATE y los metio en TABLAS_INMUTABLES del
--  escaner de fuentes. Un recibo es un documento con numeracion correlativa
--  que el contribuyente se lleva impreso; corregirlo en la base deja al papel
--  y al sistema diciendo cosas distintas, y quien tenga el papel gana la
--  discusion.
--
--  Esta migracion es la consecuencia de aquella decision: lo que le pasa a un
--  recibo se AGREGA. `recibo_movimiento` es a `recibo` lo que
--  `valor_movimiento` (V28) es a `valor`.
--
--  1. LAS COLUMNAS DE ANULACION DE V3 SE RETIRAN. V29 las dejo anunciadas
--     -«#34 decide si las conserva o si las retira»- y la respuesta es que se
--     retiran. No es limpieza: es que hoy MIENTEN.
--
--     `recibo.estado` tiene DEFAULT 'EMITIDO', ninguna sentencia lo escribe y
--     ninguna puede escribirlo -no hay UPDATE-. O sea que la columna dice
--     'EMITIDO' para siempre, tambien para un recibo anulado. Cualquier
--     consulta ad hoc, cualquier reporte futuro y cualquier migracion la
--     leeria como la verdad, y seria la verdad al reves.
--
--     La alternativa que V29 mencionaba -alimentarlas con un disparador desde
--     la tabla de movimientos- se descarta a proposito: ese disparador tendria
--     que actualizar `recibo`, y para poder hacerlo desde `sgtm_app` habria que
--     declararlo SECURITY DEFINER. Eso es exactamente una puerta trasera al
--     REVOKE que V29 acaba de poner: la inmutabilidad dejaria de ser una
--     propiedad del privilegio y pasaria a depender de que nadie escriba una
--     segunda funcion con la misma marca.
--
--     El estado de un recibo pasa a DERIVARSE de sus movimientos: hay fila de
--     anulacion o no la hay. Es la misma forma en que `valor` responde «esta
--     en coactiva» desde V28.
--
--  2. UN MOVIMIENTO TAMPOCO SE CORRIGE. `recibo_movimiento` recibe SELECT e
--     INSERT y nada mas, y entra tambien en TABLAS_INMUTABLES con su muestra
--     que lo viola. Una anulacion registrada por error no se edita: lo que
--     corresponde es otro acto -una nueva cobranza-, no reescribir el acta.
--
--  3. LA DOBLE ANULACION LA IMPIDE LA BASE. Indice unico PARCIAL sobre
--     (municipalidad_id, recibo_id) WHERE tipo = 'ANULACION', mismo patron que
--     `valor_movimiento_pase_uq`: el tipo DUPLICADO si se repite -un recibo se
--     reimprime tantas veces como haga falta- y el de anulacion no. Parcial y
--     no UNIQUE(recibo_id, tipo) por eso mismo.
--
--     A diferencia del pase a coactiva, aqui NO se resuelve con ON CONFLICT DO
--     NOTHING: anular dos veces no es un reenvio inocente que deba devolver lo
--     de la primera vez, es una peticion que el estado ya no admite, y su
--     respuesta es 409. La deuda ya volvio a estar pendiente; una segunda
--     reversion la duplicaria.
--
--  4. EL TURNO VIAJA EN EL MOVIMIENTO, PARA #36. Una anulacion del mismo dia
--     saca dinero del cajon en el que entro, asi que el arqueo tiene que poder
--     restarla. Se copian `caja_id` y `turno_id` DEL RECIBO -no del cajero que
--     anula-: el dinero sale de donde entro. `recibo_movimiento_turno_ix` es el
--     acceso que el cierre de caja necesita.
--
--  5. EL IMPORTE SE CONGELA. `importe` guarda lo que deja de estar cobrado:
--     el total del recibo, copiado, no releido. Por lo mismo que el desglose
--     de `recibo_detalle`: dentro de dos anios el libro dira otra cosa -habra
--     mas asientos- y el acta de anulacion tiene que poder explicarse sola.
--     Es tambien lo que el arqueo (#36) resta del cajon.
--
--     En una cobranza tributaria coincide, centimo a centimo, con lo que la
--     reversion devolvio al libro, y la aplicacion lo COMPRUEBA en vez de
--     suponerlo. En un recibo de caja de tasas no hay nada que reversar -un
--     derecho de tramite no es deuda tributaria y nunca toco el libro- y el
--     importe sigue siendo el que sale del cajon.
--
--  6. EL RESUMEN DEL DUPLICADO. Un movimiento de tipo DUPLICADO guarda el
--     SHA-256 del recibo dibujado a partir de lo congelado. Es la misma
--     garantia que `documento_emitido.resumen` (V15) le da a un valor: que la
--     reimpresion salga identica no se afirma, se comprueba. Si alguien cambia
--     el renderizador, el segundo duplicado FALLA en vez de entregar un papel
--     distinto al original con el mismo numero.
--
--     Por que un recibo no pasa por `documento_emitido`: porque su duplicado
--     tiene que decir si el recibo esta anulado, y eso ocurre DESPUES de la
--     emision. `documento_emitido` archiva un modelo y no lo deja cambiar
--     -su disparador lo impide-, asi que un recibo archivado no podria
--     anunciar su propia anulacion. El recibo, ademas, ya tiene numeracion
--     correlativa propia (`recibo_correlativo`, V29): archivarlo daria un
--     segundo numero para el mismo papel.
--
--  V6 le da RLS a toda tabla con municipalidad_id NOT NULL que existiera AL
--  MOMENTO de correr V6. `recibo_movimiento` no existia, asi que su RLS y sus
--  privilegios se declaran aqui, explicitos, igual que exige agregar una tabla
--  nueva (CLAUDE.md, "Al agregar una tabla").
-- ============================================================================

-- ---------- 1. Las columnas que mentian ----------
--
--  Se retiran juntas con su CHECK. `recibo` esta vacio de anulaciones por
--  construccion: nunca hubo forma de escribirlas -V3 no tenia repositorio y
--  V29 revoco el UPDATE-, asi que no se pierde ni una constancia.
ALTER TABLE recibo DROP CONSTRAINT recibo_anulacion_ck;

ALTER TABLE recibo
    DROP COLUMN estado,
    DROP COLUMN fecha_anulacion,
    DROP COLUMN usuario_anulacion,
    DROP COLUMN motivo_anulacion;

-- ---------- 2. El movimiento del recibo ----------
CREATE TABLE recibo_movimiento (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    recibo_id        bigint       NOT NULL,
    -- ANULACION deja el recibo sin efecto y devuelve la deuda; DUPLICADO es
    -- una reimpresion. Los dos son actos sobre el mismo documento y por eso
    -- viven en la misma tabla, igual que PCO, ACO y RCO en `valor_movimiento`.
    tipo             varchar(9)   NOT NULL CHECK (tipo IN ('ANULACION', 'DUPLICADO')),
    fecha            date         NOT NULL,
    -- Copiados DEL RECIBO: el dinero sale del cajon en el que entro (#36).
    caja_id          bigint       NOT NULL,
    turno_id         bigint       NOT NULL,
    -- Solo la anulacion: por que, quien la autorizo y con que documento.
    motivo           varchar(80),
    autorizado_por   varchar(80),
    documento_autorizacion varchar(40),
    -- Lo que deja de estar cobrado, congelado (anulacion); o el SHA-256 de lo
    -- que se dibujo (duplicado).
    importe          dinero       CHECK (importe >= 0),
    resumen          char(64),
    usuario_registro varchar(60)  NOT NULL,
    fecha_registro   timestamptz  NOT NULL DEFAULT now(),
    observacion      varchar(500) NOT NULL,
    CONSTRAINT recibo_movimiento_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT recibo_movimiento_recibo_fk FOREIGN KEY (municipalidad_id, recibo_id)
        REFERENCES recibo (municipalidad_id, id) NOT VALID,
    CONSTRAINT recibo_movimiento_caja_fk FOREIGN KEY (municipalidad_id, caja_id)
        REFERENCES caja (municipalidad_id, id) NOT VALID,
    CONSTRAINT recibo_movimiento_turno_fk FOREIGN KEY (municipalidad_id, turno_id)
        REFERENCES cierre_caja (municipalidad_id, id) NOT VALID,
    -- Anular exige constancia de por que y de cuanto se devolvio (RNF-052).
    -- Un motivo en blanco no es un motivo: `btrim` lo dice, para que no baste
    -- con mandar espacios.
    CONSTRAINT recibo_movimiento_anulacion_ck CHECK (
        tipo <> 'ANULACION'
        OR (motivo IS NOT NULL AND btrim(motivo) <> '' AND importe IS NOT NULL)),
    -- Y un duplicado exige el resumen de lo que se dibujo: sin el, «la
    -- reimpresion sale identica» volveria a ser una afirmacion.
    CONSTRAINT recibo_movimiento_duplicado_ck CHECK (
        tipo <> 'DUPLICADO' OR resumen IS NOT NULL)
);

COMMENT ON TABLE recibo_movimiento IS
    'Lo que le pasa a un recibo despues de emitirse (#34, RF-082, RF-083): ANULACION o '
    'DUPLICADO. Solo se agrega. El estado de un recibo se DERIVA de aqui, porque el recibo '
    'no se edita (V29); las columnas de anulacion que V3 le habia puesto se retiraron en esta '
    'misma migracion por decir EMITIDO para siempre.';

COMMENT ON COLUMN recibo_movimiento.turno_id IS
    'El turno DEL RECIBO, no el de quien anula: una anulacion del mismo dia saca dinero del '
    'cajon en el que entro, y el arqueo de ese turno (#36) tiene que poder restarla.';

COMMENT ON COLUMN recibo_movimiento.importe IS
    'El importe del recibo que deja de estar cobrado, copiado y no releido. Dentro de dos anios '
    'el libro dira otra cosa -habra mas asientos- y el acta de anulacion tiene que explicarse '
    'sola. Es lo que el arqueo del turno (#36) resta del cajon; en una cobranza tributaria '
    'coincide con lo que la reversion devolvio al libro, y la aplicacion lo comprueba.';

COMMENT ON COLUMN recibo_movimiento.resumen IS
    'SHA-256 del recibo dibujado a partir de lo congelado. Misma garantia que '
    'documento_emitido.resumen (V15): la segunda reimpresion se compara con la primera y '
    'FALLA si no coincide, en vez de entregar un papel distinto con el mismo numero.';

-- La doble anulacion, impedida por la base. Parcial: DUPLICADO se repite.
CREATE UNIQUE INDEX recibo_movimiento_anulacion_uq
    ON recibo_movimiento (municipalidad_id, recibo_id)
    WHERE tipo = 'ANULACION';

-- El estado del recibo y su contador de duplicados: los movimientos de uno.
CREATE INDEX recibo_movimiento_recibo_ix
    ON recibo_movimiento (municipalidad_id, recibo_id, tipo);

-- El arqueo del turno (#36): las anulaciones de una apertura.
CREATE INDEX recibo_movimiento_turno_ix
    ON recibo_movimiento (municipalidad_id, turno_id, tipo);

ALTER TABLE recibo_movimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE recibo_movimiento FORCE  ROW LEVEL SECURITY;

CREATE POLICY recibo_movimiento_tenant ON recibo_movimiento
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- Sin UPDATE y sin DELETE: un movimiento equivocado no se corrige en el sitio.
GRANT SELECT, INSERT ON recibo_movimiento TO sgtm_app;
GRANT SELECT          ON recibo_movimiento TO sgtm_readonly;

-- ---------- 3. Los asientos que un recibo origino ----------
--
--  Anular exige encontrar los asientos que la cobranza escribio, y la unica
--  cosa que los identifica es `documento_origen` = 'RECIBO 001-0000123' (#33).
--  Sin indice eso es un recorrido completo de cada particion del libro.
--
--  El indice va sobre la tabla PADRE: PostgreSQL lo propaga a cada particion
--  y a las que se creen despues. No se le conceden privilegios a ninguna
--  particion, que es la regla de DAT-01 §5 y lo que la prueba de aislamiento
--  comprueba.
CREATE INDEX asiento_documento_origen_ix
    ON cuenta_corriente_asiento (municipalidad_id, documento_origen);

COMMENT ON INDEX asiento_documento_origen_ix IS
    'Los asientos que un documento origino (#34): es como la anulacion de un recibo encuentra '
    'los abonos que tiene que reversar.';
