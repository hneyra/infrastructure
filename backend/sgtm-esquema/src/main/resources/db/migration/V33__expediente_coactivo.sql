-- ============================================================================
--  V33 — El expediente coactivo, la carpeta que agrupa lo exigible (#40,
--        RF-100, RF-106)
--
--  `expediente_coactivo` y `expediente_valor` existen desde V3, igual que
--  `recibo` existia antes de #33 y `convenio` antes de #35. Lo que faltaba no
--  eran las tablas: era todo lo que convierte una carpeta en un procedimiento
--  que se puede explicar dos anios despues.
--
--  1. EL ESTADO SE DERIVA, Y LAS COLUMNAS QUE MENTIRIAN SE VAN. Cuarta vez
--     seguida y por el mismo camino que V30 (recibo), V31 (convenio) y V32
--     (turno de caja). V3 le habia puesto a `expediente_coactivo` las columnas
--     `estado` -con DEFAULT 'ABIERTO'- y `fecha_estado`. Como la aplicacion
--     deja de poder actualizar la tabla, esa columna diria 'ABIERTO' para
--     siempre, tambien de un expediente concluido, y cualquier consulta ad hoc
--     la leeria como la verdad.
--
--     Se retiran. El estado pasa a DERIVARSE de `expediente_movimiento`: sin
--     movimientos de estado el expediente esta INICIADO; con el ultimo esta en
--     lo que ese ultimo diga. Un expediente coactivo es un procedimiento
--     administrativo con numeracion propia cuyos actos se notifican al
--     obligado: corregir su estado en el sitio deja al papel notificado y al
--     sistema diciendo cosas distintas.
--
--     Y su vocabulario deja de ser el de V3 -ABIERTO/SUSPENDIDO/CONCLUIDO/
--     ARCHIVADO, que nadie escribio nunca- para ser el de la pantalla
--     `expediente_historial` del prototipo: 011 REC 01 emitida, 012 REC 01
--     notificada, 021 REC 02 emitida, 031 medida cautelar, 041 suspendido,
--     051 concluido. El prototipo manda.
--
--     La alternativa -alimentar las columnas con un disparador- se descarta por
--     lo que V30 §1 ya explico: ese disparador tendria que ser SECURITY DEFINER
--     y eso es una puerta trasera al propio REVOKE.
--
--  2. LA DIRECCION REFERENCIAL SE QUEDA, PERO ES LA DE APERTURA. No es el
--     domicilio fiscal: es donde el ejecutor coactivo notifica cuando el
--     domicilio fiscal no sirve. Cambiarla es un acto con motivo y observacion
--     (RF-106), asi que viaja en un movimiento igual que el estado, y la
--     vigente se deriva. La columna de la cabecera conserva la del dia en que
--     se abrio el expediente, que es la que sus primeras notificaciones usaron.
--
--  3. UN VALOR, UN EXPEDIENTE. `expediente_valor` tenia PRIMARY KEY
--     (municipalidad_id, expediente_id, valor_id), que impide repetir el valor
--     DENTRO de un expediente y no dice nada de otro. Reintentar la importacion
--     habria creado un segundo expediente con los mismos valores, y el
--     obligado tendria dos procedimientos por la misma deuda.
--
--     `expediente_valor_unico_uq` -UNIQUE (municipalidad_id, valor_id)- lo
--     impide en la BASE, no en un `if`: dos peticiones simultaneas pasan las
--     dos por cualquier comprobacion escrita en Java. Es la misma garantia y
--     por el mismo motivo que `valor_movimiento_pase_uq` en V28.
--
--     Es unicidad absoluta y no "por expediente vivo" a proposito. Un indice
--     parcial sobre "vivo" tendria que mirar el estado, que vive en OTRA tabla
--     y ademas se deriva; PostgreSQL no indexa eso. Y la version debil -dejar
--     reimportar cuando el expediente anterior esta concluido- es exactamente
--     la que produce dos procedimientos por la misma deuda el dia que alguien
--     concluya un expediente por error. Sacar un valor de un expediente sera un
--     acto explicito con su propio movimiento, no un hueco en un indice.
--
--  4. NADA DE `current_date` EN UN DEFAULT. `expediente_valor.fecha_importacion`
--     tenia DEFAULT current_date. Se retira, por lo mismo que la fecha de
--     auditoria salio del `DEFAULT now()`: la fecha la pone el reloj inyectado
--     de la aplicacion, no el del motor, o una importacion registrada con la
--     fecha en que la resolucion lo dispuso caeria en el dia en que se ejecuto.
--
--  5. NUMERACION PROPIA, POR MUNICIPALIDAD Y EJERCICIO. `expediente_correlativo`
--     sigue el patron de `valor_correlativo` (V26), `recibo_correlativo` (V29) y
--     `convenio_correlativo` (V31): UPSERT en una sola sentencia, nunca
--     SELECT + UPDATE.
--
--     D-09 SIGUE ABIERTA, asi que aqui NO se fija ninguna mascara. Lo que la
--     base garantiza es que el correlativo no se repita ni salte; con que ceros
--     y en que orden se imprime lo decide una plantilla PARAMETRIZADA en el
--     dominio -`PlantillaDeNumeroDeExpediente`, mismo precedente que
--     `ComposicionCatastral` para D-10-, y cerrar D-09 sera cambiar esa
--     plantilla, no migrar la columna.
--
--  V6 le da RLS a toda tabla con municipalidad_id NOT NULL que existiera AL
--  MOMENTO de correr V6. `expediente_movimiento` y `expediente_correlativo` no
--  existian, asi que su RLS y sus privilegios se declaran aqui, explicitos,
--  igual que exige agregar una tabla nueva (CLAUDE.md, "Al agregar una tabla").
--
--  Las columnas NOT NULL se agregan SIN valor por omision a proposito, igual
--  que en V28, V29, V30 y V31: ninguna linea de codigo ha escrito nunca en
--  `expediente_coactivo` ni en `expediente_valor` -no tenian repositorio-, asi
--  que estan vacias y el ALTER pasa. Si en algun ambiente NO lo estuvieran,
--  PostgreSQL para la migracion nombrando la columna, que es mejor que inventar
--  un dato.
-- ============================================================================

-- ---------- 1. Las columnas que mentirian ----------
--
--  Sin DROP CONSTRAINT delante: la restriccion de V3 es una CHECK de columna, y
--  se va con la columna. Nombrarla aqui seria depender del nombre que PostgreSQL
--  le puso solo.
--
--  Se lleva por delante `expediente_contribuyente_ix`, que V3 declaro sobre
--  (municipalidad_id, contribuyente_id, estado). Se rehace abajo sin la columna
--  que ya no existe: es el indice con el que la pantalla busca por
--  contribuyente.
ALTER TABLE expediente_coactivo
    DROP COLUMN estado,
    DROP COLUMN fecha_estado;

CREATE INDEX expediente_contribuyente_ix
    ON expediente_coactivo (municipalidad_id, contribuyente_id);

-- ---------- 2. Lo que al expediente le faltaba ----------
ALTER TABLE expediente_coactivo
    -- El ejercicio del expediente. La pantalla pide «Número» y «Año» por
    -- separado (`importacion_valores`, `expediente_historial`), y el correlativo
    -- se reinicia con el ejercicio, como el de un valor (V26).
    ADD COLUMN ejercicio        ejercicio    NOT NULL,
    -- El correlativo desnudo dentro del ejercicio. Se guarda ademas del numero
    -- impreso porque `numero` depende de la plantilla de D-09: el dia que la
    -- plantilla cambie, el correlativo sigue siendo el mismo entero y las
    -- consultas por «Número» del ano no dependen de como se imprimia entonces.
    ADD COLUMN correlativo      bigint       NOT NULL CHECK (correlativo > 0),
    -- «Asunto» de la pantalla de importacion.
    ADD COLUMN asunto           varchar(300),
    ADD COLUMN usuario_registro varchar(60)  NOT NULL,
    ADD COLUMN fecha_registro   timestamptz  NOT NULL;

ALTER TABLE expediente_coactivo ADD CONSTRAINT expediente_correlativo_uq
    UNIQUE (municipalidad_id, ejercicio, correlativo);

COMMENT ON TABLE expediente_coactivo IS
    'La carpeta que agrupa los valores exigibles de un contribuyente y lleva su propio ciclo '
    '(#40, RF-100). Su estado NO esta aqui: se deriva de expediente_movimiento, por lo mismo '
    'que el del convenio (V31) y el del recibo (V30). Solo se agrega.';

COMMENT ON COLUMN expediente_coactivo.direccion_referencial IS
    'La direccion referencial CON QUE SE ABRIO el expediente, no la vigente: distinta del '
    'domicilio fiscal, es donde el ejecutor notifica cuando aquel no sirve (RF-106). Cambiarla '
    'es un acto con motivo y observacion, y la vigente se deriva de expediente_movimiento.';

COMMENT ON COLUMN expediente_coactivo.correlativo IS
    'El correlativo dentro del ejercicio, sin formato. `numero` es su forma impresa segun la '
    'plantilla que D-09 cerrara; este entero no depende de ella.';

-- ---------- 3. Un valor, un expediente ----------
ALTER TABLE expediente_valor ALTER COLUMN fecha_importacion DROP DEFAULT;

CREATE UNIQUE INDEX expediente_valor_unico_uq
    ON expediente_valor (municipalidad_id, valor_id);

COMMENT ON INDEX expediente_valor_unico_uq IS
    'Un valor vive en UN expediente coactivo (#40). Reintentar la importacion no duplica, y la '
    'garantia esta en la base y no en un `if`: dos peticiones simultaneas pasan las dos por '
    'cualquier comprobacion escrita en Java, y el obligado acabaria con dos procedimientos por '
    'la misma deuda.';

COMMENT ON COLUMN expediente_valor.fecha_importacion IS
    'Cuando se importo. Sale del reloj inyectado de la aplicacion, nunca de un DEFAULT del '
    'motor: una importacion se puede registrar con la fecha en que la resolucion lo dispuso.';

-- ---------- 4. El historial de estados y de direccion ----------
--
--  Es a `expediente_coactivo` lo que `convenio_movimiento` (V31) es a
--  `convenio`, `recibo_movimiento` (V30) al recibo y `valor_movimiento` (V28)
--  al valor. Solo se agrega: SELECT e INSERT y nada mas.
CREATE TABLE expediente_movimiento (
    municipalidad_id      bigint       NOT NULL REFERENCES municipalidad(id),
    id                    bigint       GENERATED ALWAYS AS IDENTITY,
    expediente_id         bigint       NOT NULL,
    tipo                  varchar(12)  NOT NULL
        CHECK (tipo IN ('APERTURA', 'ESTADO', 'DIRECCION')),
    -- El vocabulario de la pantalla `expediente_historial` del prototipo, con
    -- su codigo del manual delante para que el nombre no dependa del idioma de
    -- la etiqueta.
    estado                varchar(20)
        CHECK (estado IN ('INICIADO', 'REC1_EMITIDA', 'REC1_NOTIFICADA', 'REC2_EMITIDA',
                          'MEDIDA_CAUTELAR', 'SUSPENDIDO', 'CONCLUIDO')),
    direccion_referencial varchar(300),
    fecha                 date         NOT NULL,
    -- «Motivo» de la pantalla. Obligatorio siempre: un cambio de estado sin
    -- motivo es una fila, no un acto.
    motivo                varchar(200) NOT NULL,
    -- «Documento de respaldo — fecha» y «— número» de la pantalla. Opcionales:
    -- no todo cambio de estado nace de un documento.
    documento_fecha       date,
    documento_numero      varchar(40),
    usuario_registro      varchar(60)  NOT NULL,
    fecha_registro        timestamptz  NOT NULL,
    observacion           varchar(500) NOT NULL,
    CONSTRAINT expediente_movimiento_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT expediente_movimiento_exp_fk FOREIGN KEY (municipalidad_id, expediente_id)
        REFERENCES expediente_coactivo (municipalidad_id, id),
    -- Un movimiento de estado lleva estado y no direccion; uno de direccion, al
    -- reves. Sin esto, un cambio de direccion podria colarse con un estado
    -- pegado y mover el expediente sin que la pantalla de estados lo pidiera.
    CONSTRAINT expediente_movimiento_carga_ck CHECK (
        (tipo IN ('APERTURA', 'ESTADO')
         AND estado IS NOT NULL AND direccion_referencial IS NULL)
        OR (tipo = 'DIRECCION'
            AND estado IS NULL AND direccion_referencial IS NOT NULL)),
    -- La apertura solo puede abrir en INICIADO: es el estado con el que nace un
    -- expediente, antes de cualquier REC.
    CONSTRAINT expediente_movimiento_apertura_ck CHECK (
        tipo <> 'APERTURA' OR estado = 'INICIADO'),
    CONSTRAINT expediente_movimiento_documento_ck CHECK (
        (documento_fecha IS NULL) = (documento_numero IS NULL))
);

-- Una sola apertura por expediente. Indice unico PARCIAL y no UNIQUE(exp, tipo)
-- a proposito: los otros dos tipos se repiten -para eso existe el historial- y
-- el que no puede repetirse es este. Mismo patron que V28 §2 y V31 §5.
CREATE UNIQUE INDEX expediente_movimiento_apertura_uq
    ON expediente_movimiento (municipalidad_id, expediente_id)
    WHERE tipo = 'APERTURA';

CREATE INDEX expediente_movimiento_exp_ix
    ON expediente_movimiento (municipalidad_id, expediente_id, id);

COMMENT ON TABLE expediente_movimiento IS
    'El historial del expediente coactivo (#40, RF-100, RF-106): su apertura, cada cambio de '
    'estado y cada cambio de direccion referencial, con fecha, usuario, motivo y observacion. '
    'De aqui se DERIVA el estado, y la direccion vigente. Solo se agrega: un cambio '
    'equivocado se corrige con otro movimiento, nunca editando el anterior.';

ALTER TABLE expediente_movimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE expediente_movimiento FORCE  ROW LEVEL SECURITY;

CREATE POLICY expediente_movimiento_tenant ON expediente_movimiento
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

GRANT SELECT, INSERT ON expediente_movimiento TO sgtm_app;
GRANT SELECT          ON expediente_movimiento TO sgtm_readonly;

-- ---------- 5. Ni el expediente ni sus valores se editan ----------
--
--  El expediente no necesita FOR UPDATE en ningun sitio -lo que se serializa es
--  el correlativo, y eso lo hace su propia tabla con un UPDATE atomico-, asi
--  que a diferencia de `cierre_caja` (V32 §1.bis) aqui el REVOKE si se puede.
REVOKE UPDATE ON expediente_coactivo FROM sgtm_app;
REVOKE UPDATE ON expediente_valor    FROM sgtm_app;

-- ---------- 6. La numeracion ----------
CREATE TABLE expediente_correlativo (
    municipalidad_id bigint    NOT NULL REFERENCES municipalidad(id),
    ejercicio        ejercicio NOT NULL,
    ultimo           bigint    NOT NULL DEFAULT 0 CHECK (ultimo >= 0),
    CONSTRAINT expediente_correlativo_pk PRIMARY KEY (municipalidad_id, ejercicio)
);

COMMENT ON TABLE expediente_correlativo IS
    'El ultimo correlativo de expediente coactivo por municipalidad y ejercicio (#40). Se lee '
    'y se incrementa en una sola sentencia UPSERT; nunca con SELECT + UPDATE. D-09 decide con '
    'que formato se imprime; esta tabla solo garantiza que no se repita ni salte.';

ALTER TABLE expediente_correlativo ENABLE ROW LEVEL SECURITY;
ALTER TABLE expediente_correlativo FORCE  ROW LEVEL SECURITY;

CREATE POLICY expediente_correlativo_tenant ON expediente_correlativo
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- A diferencia del expediente, este contador SI se actualiza en el sitio: es
-- infraestructura interna de numeracion, no un acto del procedimiento.
GRANT SELECT, INSERT, UPDATE ON expediente_correlativo TO sgtm_app;
GRANT SELECT                 ON expediente_correlativo TO sgtm_readonly;

-- ---------- 7. Indices de la consulta ----------
CREATE INDEX expediente_ejercicio_ix
    ON expediente_coactivo (municipalidad_id, ejercicio, correlativo);
CREATE INDEX expediente_valor_valor_ix
    ON expediente_valor (municipalidad_id, valor_id);
