-- ============================================================================
--  V32 — El cierre del turno, y como se deja sin efecto (#36, RF-087)
--
--  V29 le puso a `cierre_caja` la mitad de arriba —quien abrio, cuando y por
--  que— y anuncio que #36 escribiria la de abajo. Esta migracion la escribe, y
--  la escribe AGREGANDO, que es la tercera vez seguida que este contexto llega
--  a la misma conclusion: `recibo` en V30, `convenio` en V31 y ahora el turno.
--
--  1. LAS COLUMNAS DE CIERRE DE V3 SE RETIRAN. Mismo caso, palabra por palabra,
--     que las de anulacion de `recibo`: `cierre_caja.estado` tiene DEFAULT
--     'ABIERTO', y si el cierre se escribiera actualizandola, el turno seria un
--     documento que se edita. Se retiran `estado`, `total_efectivo`,
--     `total_otros`, `cantidad_recibos`, `fecha_cierre` y `usuario_cierre`, y
--     el estado pasa a DERIVARSE de `cierre_turno`: hay cierre vigente o no lo
--     hay, igual que `recibo` responde «esta anulado» desde V30.
--
--     `total_efectivo` y `total_otros` merecen una linea aparte. No solo habria
--     que actualizarlas: reparten la recaudacion del dia en DOS cajones
--     —efectivo y «otros»—, y el arqueo que la pantalla dibuja tiene una casilla
--     por medio de pago. Un cierre que guarde «otros: 3 200,00» no puede
--     explicar dentro de dos anios cuanto de eso fue tarjeta y cuanto deposito,
--     que es exactamente la pregunta que hace quien concilia con el banco.
--     El desglose va a `cierre_turno_detalle`, una fila por forma de pago.
--
--  2. UN CIERRE NO SE MODIFICA NI SE BORRA: SE REVERSA CON OTRO (regla 4).
--     `cierre_turno` guarda los dos tipos. Un `CIERRE` congela el arqueo —lo
--     cobrado, lo anulado, el neto, lo declarado y la diferencia—; una
--     `REVERSION` apunta al cierre que deja sin efecto y NO lo toca. El turno
--     vuelve entonces a estar abierto, que es la unica forma de seguir cobrando
--     ese dia: `cierre_uq` (V3) hace unico el turno por (caja, cajero, fecha),
--     asi que «abrir otro turno» no existe —el mensaje que V29 dejo escrito en
--     `AbrirCaja.TurnoCerrado` prometia algo que la base no admite, y #36 lo
--     corrige—.
--
--     Reversar deja el arqueo anterior INTACTO y legible. Es la diferencia con
--     un UPDATE que lo recalculara: el cierre de las 13:00 dijo 3 200,00 y eso
--     no cambia; el cierre siguiente dira otra cifra, y las dos filas juntas
--     cuentan lo que paso.
--
--  3. LA SECUENCIA ES LO QUE IMPIDE DOS CIERRES A LA VEZ. Un turno alterna
--     CIERRE, REVERSION, CIERRE… y cada movimiento lleva su `secuencia`, unica
--     por turno. Dos peticiones simultaneas de cierre calculan la misma
--     secuencia y una recibe `23505`. El bloqueo del turno con `FOR UPDATE`
--     —que es como se serializa la ventanilla desde V29— las ordena antes de
--     llegar ahi; la restriccion unica es la que sigue valiendo si algun dia
--     alguien escribe un camino que no bloquea.
--
--     Un indice unico parcial «un solo CIERRE por turno» NO sirve: despues de
--     reversar tiene que poder haber otro. La secuencia expresa las dos cosas a
--     la vez.
--
--  4. LA ARITMETICA DEL ARQUEO LA COMPRUEBA LA BASE. `neto = cobrado -
--     anulado` y `diferencia = declarado - neto`, en un CHECK, igual que
--     `recibo_detalle_desglose_ck` comprueba que el total de una linea es la
--     suma de sus cuatro partes. Un arqueo cuya diferencia no sea la resta de
--     sus dos cifras es un arqueo que no se puede auditar, y el sitio donde eso
--     no puede pasar es la base.
--
--     Lo que la base NO puede comprobar es que las filas de
--     `cierre_turno_detalle` sumen el total del cierre: es una condicion entre
--     filas. La comprueba la aplicacion antes de escribir, y una prueba la pone
--     en rojo si se rompe.
--
--  5. LA DIFERENCIA SE GUARDA, NO SE RECHAZA. Un arqueo que no cuadra es
--     precisamente lo que hay que dejar por escrito: si el cierre exigiera
--     diferencia cero, el cajero al que le falten diez soles declararia lo que
--     el sistema diga y el descuadre desapareceria del papel. Por eso
--     `diferencia` admite negativo —es la unica columna de importe de este
--     esquema que lo hace, y esta es la razon—.
--
--  V6 le da RLS a toda tabla con municipalidad_id NOT NULL que existiera AL
--  MOMENTO de correr V6. Ninguna de estas dos existia, asi que su RLS y sus
--  privilegios se declaran aqui, explicitos, igual que exige agregar una tabla
--  nueva (CLAUDE.md, "Al agregar una tabla").
-- ============================================================================

-- ---------- 1. Las columnas que mentirian ----------
--
--  `cierre_caja` esta vacio de cierres por construccion: nunca hubo forma de
--  escribirlos —V3 no tenia repositorio y #33 solo escribe la apertura—, asi
--  que no se pierde ninguna constancia.
ALTER TABLE cierre_caja
    DROP COLUMN estado,
    DROP COLUMN total_efectivo,
    DROP COLUMN total_otros,
    DROP COLUMN cantidad_recibos,
    DROP COLUMN fecha_cierre,
    DROP COLUMN usuario_cierre;

-- ---------- 1.bis. EL REVOKE QUE NO SE PUEDE HACER ----------
--
--  Aqui iba `REVOKE UPDATE ON cierre_caja FROM sgtm_app`, por el mismo motivo
--  que V29 se lo hizo a `recibo` y V31 a `convenio`: el turno se abre una vez y
--  no se edita nunca.
--
--  NO SE PUEDE, y el motivo se descubrio EJECUTANDOLO, no leyendolo:
--
--      ERROR: permission denied for table cierre_caja
--      SELECT id, caja_id, cajero, fecha FROM cierre_caja
--       WHERE caja_id = ? AND cajero = ? AND fecha = ? FOR UPDATE
--
--  En PostgreSQL, `SELECT ... FOR UPDATE` exige el privilegio de UPDATE sobre
--  la tabla. Tambien `FOR NO KEY UPDATE` y `FOR SHARE`: no hay ninguna forma de
--  bloquear una fila con solo SELECT. Y esa fila es EL PUNTO DE SERIALIZACION
--  DE LA VENTANILLA desde V29 §2 —una caja es un cajero y una cola, y bloquear
--  su turno es lo que ordena dos cobranzas simultaneas sin escribir un solo
--  `if`—. Revocar el UPDATE no habria hecho el turno inmutable: habria dejado
--  la caja entera sin poder cobrar, y el sintoma —«bad SQL grammar» en la
--  primera cobranza, porque el SQLSTATE 42501 cae en la clase 42— no se parece
--  en nada a su causa.
--
--  Lo que si se hace, y es la barrera que queda:
--
--   - las columnas que mentirian se RETIRAN (arriba), asi que no hay nada que
--     actualizar aunque se pudiera: la fila que queda es la apertura, y una
--     apertura no cambia;
--   - `cierre_caja` entra en TABLAS_INMUTABLES del escaner de fuentes, con su
--     muestra que lo viola. Un `UPDATE cierre_caja SET` en `src/main` rompe el
--     build, que es antes y mas barato que romperlo en ejecucion.
--
--  Es la primera tabla del esquema cuya inmutabilidad NO puede apoyarse en el
--  privilegio, y por eso queda escrito aqui: quien vuelva a intentar el REVOKE
--  tiene que leer esto antes.
COMMENT ON TABLE cierre_caja IS
    'El turno de una caja: se abre por cajero y fecha (#33) y se cobra contra el. Su fila es '
    'donde se serializa la ventanilla —una cobranza la bloquea con FOR UPDATE antes de numerar y '
    'de asentar—, y por eso sgtm_app CONSERVA el UPDATE aunque el turno no se edite nunca: '
    'PostgreSQL exige ese privilegio para poder bloquear una fila. La inmutabilidad la sostiene el '
    'escaner de fuentes (#36, V32 §1.bis). El cierre, su reversion y el estado que de ellos se '
    'deriva viven en cierre_turno.';

-- ---------- 2. El cierre, y su reversion ----------
CREATE TABLE cierre_turno (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    turno_id         bigint       NOT NULL,
    -- CIERRE congela el arqueo; REVERSION lo deja sin efecto y reabre el turno.
    -- Los dos son actos sobre el mismo turno y por eso viven en la misma tabla,
    -- igual que ANULACION y DUPLICADO en `recibo_movimiento`.
    tipo             varchar(9)   NOT NULL CHECK (tipo IN ('CIERRE', 'REVERSION')),
    -- 1, 2, 3… dentro del turno. Es lo que impide dos cierres simultaneos sin
    -- prohibir el segundo cierre legitimo despues de una reversion.
    secuencia        smallint     NOT NULL CHECK (secuencia > 0),
    fecha            date         NOT NULL,
    fecha_registro   timestamptz  NOT NULL,
    -- Solo el CIERRE: el arqueo, congelado.
    total_cobrado    dinero       CHECK (total_cobrado >= 0),
    total_anulado    dinero       CHECK (total_anulado >= 0),
    neto             dinero,
    total_declarado  dinero       CHECK (total_declarado >= 0),
    -- La UNICA columna de importe del esquema que admite negativo, y a
    -- proposito: un cajero al que le falten diez soles tiene que poder cerrar
    -- diciendolo. Ver §5 de la cabecera.
    diferencia       dinero,
    recibos_emitidos integer      CHECK (recibos_emitidos >= 0),
    recibos_anulados integer      CHECK (recibos_anulados >= 0),
    -- Solo la REVERSION: a que cierre deja sin efecto, y por que.
    revierte_a_id    bigint,
    motivo           varchar(80),
    usuario_registro varchar(60)  NOT NULL,
    observacion      varchar(500) NOT NULL,
    CONSTRAINT cierre_turno_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT cierre_turno_secuencia_uq UNIQUE (municipalidad_id, turno_id, secuencia),
    CONSTRAINT cierre_turno_turno_fk FOREIGN KEY (municipalidad_id, turno_id)
        REFERENCES cierre_caja (municipalidad_id, id) NOT VALID,
    CONSTRAINT cierre_turno_revierte_fk FOREIGN KEY (municipalidad_id, revierte_a_id)
        REFERENCES cierre_turno (municipalidad_id, id) NOT VALID,
    -- Un cierre trae su arqueo entero y no revierte nada.
    CONSTRAINT cierre_turno_cierre_ck CHECK (
        tipo <> 'CIERRE'
        OR (total_cobrado IS NOT NULL AND total_anulado IS NOT NULL AND neto IS NOT NULL
            AND total_declarado IS NOT NULL AND diferencia IS NOT NULL
            AND recibos_emitidos IS NOT NULL AND recibos_anulados IS NOT NULL
            AND revierte_a_id IS NULL)),
    -- Una reversion nombra el cierre que deja sin efecto y dice por que. Un
    -- motivo en blanco no es un motivo: `btrim` lo dice, para que no baste con
    -- mandar espacios (mismo criterio que recibo_movimiento_anulacion_ck).
    CONSTRAINT cierre_turno_reversion_ck CHECK (
        tipo <> 'REVERSION'
        OR (revierte_a_id IS NOT NULL AND motivo IS NOT NULL AND btrim(motivo) <> ''
            AND total_cobrado IS NULL AND total_anulado IS NULL AND neto IS NULL
            AND total_declarado IS NULL AND diferencia IS NULL
            AND recibos_emitidos IS NULL AND recibos_anulados IS NULL)),
    -- La aritmetica del arqueo, comprobada donde no se puede eludir.
    CONSTRAINT cierre_turno_neto_ck CHECK (
        neto IS NULL OR neto = total_cobrado - total_anulado),
    CONSTRAINT cierre_turno_diferencia_ck CHECK (
        diferencia IS NULL OR diferencia = total_declarado - neto)
);

COMMENT ON TABLE cierre_turno IS
    'El cierre de un turno de caja y su reversion (#36, RF-087). Solo se agrega: un cierre no se '
    'modifica ni se borra —se reversa con otro registro que lo deja sin efecto y reabre el turno '
    '(regla 4, RNF-051)—. El estado del turno se DERIVA de aqui: hay cierre vigente o no lo hay.';

COMMENT ON COLUMN cierre_turno.secuencia IS
    'El orden del movimiento dentro del turno, unico por turno. Es lo que impide dos cierres '
    'simultaneos: los dos calculan la misma secuencia y uno recibe 23505. Un indice unico parcial '
    '«un solo CIERRE» no serviria, porque despues de una reversion tiene que caber otro.';

COMMENT ON COLUMN cierre_turno.diferencia IS
    'Lo declarado menos el neto del sistema. Admite negativo a proposito, y es la unica columna de '
    'importe del esquema que lo hace: un arqueo que exigiera diferencia cero haria que el cajero '
    'al que le faltan diez soles declarara lo que el sistema diga, y el descuadre desapareceria '
    'del papel en vez de quedar escrito.';

COMMENT ON COLUMN cierre_turno.total_anulado IS
    'Lo que las anulaciones del dia sacaron del cajon, tomado de recibo_movimiento.importe —el '
    'importe congelado, no releido— para los movimientos cuyo turno_id es este. Una anulacion '
    'lleva el turno DEL RECIBO (V30 §4): el dinero sale de donde entro.';

-- Una reversion deja sin efecto UN cierre, y una sola vez. Sin esto, dos
-- reversiones del mismo cierre dejarian el turno «reabierto dos veces» y el
-- historial contando una reapertura que no ocurrio.
CREATE UNIQUE INDEX cierre_turno_reversion_uq
    ON cierre_turno (municipalidad_id, revierte_a_id)
    WHERE tipo = 'REVERSION';

-- El estado del turno y su historial: los movimientos de uno, en orden.
CREATE INDEX cierre_turno_turno_ix
    ON cierre_turno (municipalidad_id, turno_id, id DESC);

ALTER TABLE cierre_turno ENABLE ROW LEVEL SECURITY;
ALTER TABLE cierre_turno FORCE  ROW LEVEL SECURITY;

CREATE POLICY cierre_turno_tenant ON cierre_turno
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- Sin UPDATE y sin DELETE: un cierre equivocado se reversa, no se corrige.
GRANT SELECT, INSERT ON cierre_turno TO sgtm_app;
GRANT SELECT          ON cierre_turno TO sgtm_readonly;

-- ---------- 3. El arqueo, medio de pago por medio de pago ----------
--
--  El desglose se guarda congelado por el mismo motivo que `recibo_detalle`:
--  dentro de dos anios los recibos del turno se podran volver a sumar, pero el
--  arqueo tiene que poder explicarse solo —y, sobre todo, tiene que conservar
--  lo DECLARADO, que no esta en ningun otro sitio: es lo que el cajero conto en
--  el cajon—.
CREATE TABLE cierre_turno_detalle (
    municipalidad_id bigint      NOT NULL REFERENCES municipalidad(id),
    id               bigint      GENERATED ALWAYS AS IDENTITY,
    cierre_id        bigint      NOT NULL,
    forma_pago       varchar(20) NOT NULL
        CHECK (forma_pago IN ('EFECTIVO','CHEQUE','DEPOSITO','TARJETA','TRANSFERENCIA')),
    cobrado          dinero      NOT NULL CHECK (cobrado  >= 0),
    anulado          dinero      NOT NULL CHECK (anulado  >= 0),
    neto             dinero      NOT NULL,
    declarado        dinero      NOT NULL CHECK (declarado >= 0),
    CONSTRAINT cierre_turno_detalle_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT cierre_turno_detalle_uq UNIQUE (municipalidad_id, cierre_id, forma_pago),
    CONSTRAINT cierre_turno_detalle_cierre_fk FOREIGN KEY (municipalidad_id, cierre_id)
        REFERENCES cierre_turno (municipalidad_id, id) NOT VALID,
    CONSTRAINT cierre_turno_detalle_neto_ck CHECK (neto = cobrado - anulado)
);

COMMENT ON TABLE cierre_turno_detalle IS
    'El arqueo del cierre, una fila por medio de pago (#36, RF-087): lo cobrado, lo anulado, el '
    'neto del sistema y lo DECLARADO por el cajero. Lo declarado no esta en ningun otro sitio —es '
    'lo que se conto en el cajon—, y por eso el desglose se congela aqui en vez de recomponerse '
    'sumando recibos.';

ALTER TABLE cierre_turno_detalle ENABLE ROW LEVEL SECURITY;
ALTER TABLE cierre_turno_detalle FORCE  ROW LEVEL SECURITY;

CREATE POLICY cierre_turno_detalle_tenant ON cierre_turno_detalle
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

GRANT SELECT, INSERT ON cierre_turno_detalle TO sgtm_app;
GRANT SELECT          ON cierre_turno_detalle TO sgtm_readonly;

-- ---------- 4. Los accesos que la recaudacion estrena ----------
--
--  V3 dejo `recibo_fecha_ix` sobre (municipalidad_id, fecha) y V29 dejo
--  `recibo_turno_ix`. El avance y la distribucion entran por el DETALLE de los
--  recibos de un rango de fechas, y eso cruza `recibo_detalle` con `recibo`:
--  sin indice, cada consulta del reporte mensual recorre el detalle entero.
CREATE INDEX recibo_detalle_tributo_ix
    ON recibo_detalle (municipalidad_id, tributo);

COMMENT ON INDEX recibo_detalle_tributo_ix IS
    'El avance de recaudacion por tributo (#36, RF-088): agrupa el detalle de los recibos de un '
    'rango por su tributo.';

-- La distribucion por area y partida presupuestal (RF-089) entra por la tasa
-- del detalle. `tasa_pk` ya resuelve la tasa; lo que falta es llegar a las
-- lineas de tasa sin recorrer las tributarias, que son la inmensa mayoria.
CREATE INDEX recibo_detalle_tasa_ix
    ON recibo_detalle (municipalidad_id, tasa_id)
    WHERE tasa_id IS NOT NULL;

-- El cuadre del cierre contra el libro (RF-087) pregunta, por cada recibo del
-- turno, cuanto sigue abonado: los abonos del documento que NADIE ha reversado.
-- «Nadie los ha reversado» se resuelve buscando quien apunte a ellos, y sin este
-- indice eso es un recorrido completo de cada particion por cada arqueo.
--
-- Parcial porque una reversion es rara: la inmensa mayoria de los asientos tiene
-- esta columna en nulo, y un indice sobre todos costaria lo que no vale.
--
-- Va sobre la tabla PADRE: PostgreSQL lo propaga a cada particion y a las que se
-- creen despues, y a ninguna particion se le concede privilegio (DAT-01 §5).
CREATE INDEX asiento_reversado_ix
    ON cuenta_corriente_asiento (municipalidad_id, asiento_reversado_id)
    WHERE asiento_reversado_id IS NOT NULL;

COMMENT ON INDEX asiento_reversado_ix IS
    'Que asientos reversan a cuales (#36). Es como el cierre de caja pregunta cuanto de lo que un '
    'recibo abono SIGUE abonado: un recibo anulado tiene sus abonos reversados y aporta cero al '
    'cuadre, sin que el arqueo tenga que saber que documento reversa a que otro.';

COMMENT ON INDEX recibo_detalle_tasa_ix IS
    'La distribucion por area y partida (#36, RF-089): solo las lineas de caja de tasas, que son '
    'las unicas que conocen su area y su partida presupuestal. Parcial porque una linea tributaria '
    'no tiene ninguna de las dos, y esa ausencia es un hueco de datos documentado, no un cero.';
