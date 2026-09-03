-- ============================================================================
--  V29 — El punto donde entra el dinero (#33, RF-080, RF-081, RF-133)
--
--  `area`, `tasa`, `caja`, `recibo`, `recibo_detalle` y `cierre_caja` existen
--  desde V3. Lo que faltaba no eran las tablas: era todo lo que convierte una
--  cobranza en un acto que se puede explicar dos anios despues.
--
--  1. LA SERIE ES DE LA CAJA. `recibo_numero_uq` ya impedia repetir
--     (serie, numero), pero nada decia de quien es una serie, asi que dos
--     ventanillas podian pelearse el mismo correlativo y una de las dos
--     recibiria un choque de clave unica en plena cola. Ahora cada caja tiene
--     la suya, unica en la municipalidad, y `recibo_correlativo` guarda el
--     ultimo numero POR SERIE: dos cajas distintas tocan filas distintas y no
--     se serializan entre si; dos cobranzas de la MISMA caja si, en el motor,
--     no en la aplicacion.
--
--  2. EL TURNO. `cierre_caja` ya modelaba el arqueo del dia; le faltaba la
--     mitad de arriba —quien abrio, cuando y por que—. Un recibo apunta a su
--     turno, y esa fila es ademas el punto de serializacion de la ventanilla:
--     una caja es un cajero y una cola, y bloquear su turno con FOR UPDATE es
--     lo que hace que dos peticiones simultaneas de la misma caja se ordenen
--     sin que nadie escriba un `if`.
--
--  3. NINGUNA CIFRA SIN SU FECHA (regla 9, RNF-075). `recibo.actualizado_a`
--     dice a que fecha estaban actualizados los importes que el recibo cobro.
--     En caja tributaria es la fecha de pago con la que se releyo
--     `deudaActualizadaA`; en caja de tasas, la fecha a la que la tarifa del
--     TUPA estaba vigente. Sin ella, un duplicado emitido en marzo no podria
--     explicar por que su interes no es el de hoy.
--
--  4. EL RECIBO NO SE EDITA. V7 le daba UPDATE a `recibo` y a
--     `recibo_detalle` junto con el resto de las tablas de negocio. Se retira:
--     un recibo es un documento con numeracion correlativa, no el estado de un
--     proceso interno, y su desglose esta congelado a proposito. La anulacion
--     (#34) se registrara como un movimiento que se AGREGA -mismo camino que
--     `valor_movimiento` en V28-, no reescribiendo el recibo que el
--     contribuyente se llevo impreso.
--
--     Consecuencia deliberada: las columnas `estado`, `fecha_anulacion`,
--     `usuario_anulacion` y `motivo_anulacion` que V3 puso en `recibo` quedan
--     fijadas en el INSERT. #34 decide si las conserva -alimentadas por un
--     disparador desde su tabla de movimientos- o si las retira.
--
--  5. LA IDEMPOTENCIA, EN LA BASE. El frontend ya manda `idempotency-key` en
--     toda escritura (`nuevaClaveDeIdempotencia`), y hasta hoy nadie la leia.
--     `recibo_idempotencia_uq` la convierte en garantia: reenviar la misma
--     cobranza -el doble clic, el reintento del navegador- no produce dos
--     recibos. Es indice unico PARCIAL porque la clave es opcional: una
--     cobranza registrada por un proceso interno no tiene por que traerla, y
--     `NULL` no choca con `NULL`.
--
--  BLOQUEO D-02. El EFECTO de una campana de beneficio sobre el importe queda
--  fuera de #33: `recibo.campania_beneficio` guarda cual se declaro, y el
--  importe cobrado es el integro. Mientras D-02b no cierre no hay porcentaje
--  de descuento que aplicar, y aplicar uno inventado produce condonaciones sin
--  sustento normativo en todo un padron.
--
--  V6 le da RLS a toda tabla con municipalidad_id NOT NULL que existiera AL
--  MOMENTO de correr V6. `recibo_correlativo` no existia, asi que su RLS y sus
--  privilegios se declaran aqui, explicitos, igual que exige agregar una tabla
--  nueva (CLAUDE.md, "Al agregar una tabla").
--
--  Las columnas NOT NULL se agregan SIN valor por omision a proposito, igual
--  que en V28: ninguna linea de codigo ha escrito nunca en estas tablas -no
--  tenian repositorio-, asi que estan vacias y el ALTER pasa. Si en algun
--  ambiente NO lo estuvieran, PostgreSQL para la migracion nombrando la
--  columna, que es mejor que un `usuario_registro = ''` inventado en miles de
--  recibos.
-- ============================================================================

-- ---------- 1. La serie es de la caja ----------
ALTER TABLE caja ADD COLUMN serie varchar(5) NOT NULL;

ALTER TABLE caja ADD CONSTRAINT caja_serie_uq UNIQUE (municipalidad_id, serie);

COMMENT ON COLUMN caja.serie IS
    'La serie de sus recibos, unica en la municipalidad (#33). Es lo que impide que dos '
    'ventanillas compitan por el mismo correlativo: cada una incrementa su propia fila de '
    'recibo_correlativo.';

CREATE TABLE recibo_correlativo (
    municipalidad_id bigint     NOT NULL REFERENCES municipalidad(id),
    serie            varchar(5) NOT NULL,
    ultimo           bigint     NOT NULL DEFAULT 0 CHECK (ultimo >= 0),
    CONSTRAINT recibo_correlativo_pk PRIMARY KEY (municipalidad_id, serie)
);

COMMENT ON TABLE recibo_correlativo IS
    'El ultimo numero emitido por municipalidad y serie de recibo (#33). Se lee y se '
    'incrementa en una sola sentencia UPSERT; nunca con SELECT + UPDATE. El UPDATE bloquea '
    'la fila, asi que dos cobranzas concurrentes de la misma caja se serializan en el motor '
    'y salen con numeros consecutivos, sin huecos ni repetidos.';

ALTER TABLE recibo_correlativo ENABLE ROW LEVEL SECURITY;
ALTER TABLE recibo_correlativo FORCE  ROW LEVEL SECURITY;

CREATE POLICY recibo_correlativo_tenant ON recibo_correlativo
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- A diferencia de recibo y recibo_detalle, este contador SI se actualiza en el
-- sitio: es infraestructura interna de numeracion, no un documento que alguien
-- se lleve impreso (mismo criterio que valor_correlativo en V26).
GRANT SELECT, INSERT, UPDATE ON recibo_correlativo TO sgtm_app;
GRANT SELECT                 ON recibo_correlativo TO sgtm_readonly;

-- ---------- 2. El turno de caja ----------
--
--  Abrir y cerrar son los dos extremos de la misma fila. `cierre_caja` ya
--  tenia el cierre y la unicidad por (caja, cajero, fecha); aqui entra la
--  apertura, con su observacion, que la regla 10 exige a toda escritura.
ALTER TABLE cierre_caja
    ADD COLUMN fecha_apertura   timestamptz  NOT NULL,
    ADD COLUMN usuario_apertura varchar(60)  NOT NULL,
    ADD COLUMN observacion      varchar(500) NOT NULL;

COMMENT ON TABLE cierre_caja IS
    'El turno de una caja: se abre por cajero y fecha, se cobra contra el, y se cierra con '
    'su arqueo (#33 abre; #35 cierra). Su fila es ademas donde se serializa la ventanilla: '
    'una cobranza la bloquea con FOR UPDATE antes de numerar y de asentar.';

COMMENT ON COLUMN cierre_caja.fecha_apertura IS
    'Cuando se abrio el turno. Sale del reloj INYECTADO de la aplicacion, no de un DEFAULT '
    'now() de la base: la fila se audita por ejercicio y el ejercicio tiene que ser el mismo '
    'que la aplicacion cree que es.';

-- ---------- 3. El recibo ----------
ALTER TABLE recibo
    ADD COLUMN turno_id           bigint,
    ADD COLUMN actualizado_a      date         NOT NULL,
    ADD COLUMN clave_idempotencia varchar(64),
    ADD COLUMN usuario_registro   varchar(60)  NOT NULL,
    ADD COLUMN observacion        varchar(500) NOT NULL;

-- La clave foranea del turno va NOT VALID a proposito (DAT-01 §0, hallazgo 4):
-- validarla es una consulta, y el migrador corre sin contexto de tenant, de modo
-- que no veria ninguna fila bajo RLS. NOT VALID sigue comprobando cada INSERT.
ALTER TABLE recibo ADD CONSTRAINT recibo_turno_fk
    FOREIGN KEY (municipalidad_id, turno_id)
    REFERENCES cierre_caja (municipalidad_id, id) NOT VALID;

COMMENT ON COLUMN recibo.actualizado_a IS
    'A que fecha estaban actualizados los importes que este recibo cobro (regla 9, RNF-075). '
    'En caja tributaria es la fecha de pago con la que se releyo deudaActualizadaA; en caja '
    'de tasas, la fecha a la que la tarifa del TUPA estaba vigente. Sin ella un duplicado no '
    'puede explicar por que su interes no es el de hoy.';

COMMENT ON COLUMN recibo.campania_beneficio IS
    'Que campana de beneficio se declaro en ventanilla. Hoy es SOLO constancia: el importe '
    'cobrado es el integro. Aplicarle un descuento esta bloqueado por D-02b, que es la que '
    'firma los valores de ordenanza local con su ratificacion provincial (#33).';

COMMENT ON COLUMN recibo.clave_idempotencia IS
    'La clave que el cliente manda en la cabecera idempotency-key. Con su indice unico '
    'parcial, reenviar la misma cobranza devuelve el recibo de la primera y no emite otro.';

CREATE UNIQUE INDEX recibo_idempotencia_uq
    ON recibo (municipalidad_id, clave_idempotencia)
    WHERE clave_idempotencia IS NOT NULL;

-- ---------- 4. El detalle, congelado ----------
--
--  El desglose se guarda parte por parte y no como un total, por el mismo
--  motivo que `valor_detalle`: el recibo tiene que poder explicar su cifra sin
--  volver a consultar el libro, y dentro de dos anios el libro dira otra cosa
--  -habra mas asientos-.
ALTER TABLE recibo_detalle
    ADD COLUMN insoluto        dinero  NOT NULL DEFAULT 0 CHECK (insoluto >= 0),
    ADD COLUMN reajuste        dinero  NOT NULL DEFAULT 0 CHECK (reajuste >= 0),
    ADD COLUMN interes         dinero  NOT NULL DEFAULT 0 CHECK (interes  >= 0),
    ADD COLUMN gasto           dinero  NOT NULL DEFAULT 0 CHECK (gasto    >= 0),
    ADD COLUMN cantidad        integer,
    ADD COLUMN precio_unitario dinero;

-- El total de la linea es la suma de sus cuatro partes, siempre. Una linea de
-- tasa pone su importe integro en `insoluto`: un derecho de tramite no tiene
-- reajuste, ni interes moratorio, ni gastos de cobranza.
ALTER TABLE recibo_detalle ADD CONSTRAINT recibo_detalle_desglose_ck
    CHECK (monto = insoluto + reajuste + interes + gasto);

-- Y si la linea es de tasa, la multiplicacion la comprueba la base. Un
-- `cantidad x precio` mal hecho en la aplicacion es un cobro mal hecho.
ALTER TABLE recibo_detalle ADD CONSTRAINT recibo_detalle_tasa_ck
    CHECK (
        (tasa_id IS NULL AND cantidad IS NULL AND precio_unitario IS NULL)
        OR (tasa_id IS NOT NULL AND cantidad > 0 AND precio_unitario IS NOT NULL
            AND monto = precio_unitario * cantidad));

-- ---------- 5. Ni el recibo ni su detalle se actualizan ----------
REVOKE UPDATE ON recibo          FROM sgtm_app;
REVOKE UPDATE ON recibo_detalle  FROM sgtm_app;

-- ---------- 6. Indices ----------
--
--  V3 ya dejo `recibo_fecha_ix`, `recibo_contribuyente_ix` y
--  `recibo_detalle_recibo_ix`. Aqui van solo los dos accesos que #33 estrena.

-- El arqueo del turno: todos los recibos de una apertura.
CREATE INDEX recibo_turno_ix ON recibo (municipalidad_id, turno_id);

-- La tarifa vigente a una fecha: (codigo, vigencia_desde) ya es unica, pero la
-- busqueda de caja entra por codigo y fecha, no por la clave completa, y el
-- orden descendente es el que deja que «la ultima que empezo antes de hoy» se
-- resuelva leyendo una fila.
CREATE INDEX tasa_vigencia_ix
    ON tasa (municipalidad_id, codigo, vigencia_desde DESC);
