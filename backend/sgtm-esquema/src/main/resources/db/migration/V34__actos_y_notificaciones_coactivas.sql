-- ============================================================================
--  V34 — Los actos del procedimiento coactivo y sus notificaciones (#41,
--        RF-101, RF-102, RF-103)
--
--  #40 dejo la carpeta: el expediente numerado, sus valores importados y su
--  historial de estados. Lo que le faltaba es el procedimiento: la REC-1 que lo
--  inicia, los siete dias que concede, la REC-2 que ordena la medida cautelar,
--  los demas actos, y el acuse de cada notificacion.
--
--  1. `notificacion` SIRVE TAL CUAL, Y ESO ES UN HALLAZGO, NO UN AHORRO. V3 la
--     nacio polimorfica -su columna `objeto` admite VALOR, RESOLUCION,
--     ACTO_COACTIVO y PAPELETA- y V28 le puso, para #39, TODO lo que una
--     notificacion coactiva necesita: el intento, el receptor con su documento
--     y su vinculo, el acuse, la fecha desde la que la deuda es exigible con el
--     conjunto sellado del que salio el plazo, `notificacion_intento_uq` -que
--     es lo que hace que reintentar una diligencia NO borre la anterior- y el
--     REVOKE UPDATE que impide corregirla en el sitio.
--
--     Nada de eso era especifico del valor. Esta migracion NO le toca ni una
--     columna: la REC-1 se notifica con filas de `objeto = 'ACTO_COACTIVO'` y
--     `objeto_id = acto_coactivo.id`. Anadir una `notificacion_coactiva` aparte
--     habria sido una segunda escritura de la misma regla de reintento, y con
--     ella la garantia de que un dia difieran.
--
--  2. `acto_coactivo` NO SIRVE TAL CUAL: le sobran dos columnas y le faltan
--     cinco. Como en V30 (recibo), V31 (convenio), V32 (turno) y V33
--     (expediente), lo que sobra se retira antes de que alguien lo lea como la
--     verdad.
--
--     SE VA `documento varchar(80)`. Era el nombre del archivo adjunto, texto
--     libre que nadie escribio nunca. El documento de un acto coactivo no es
--     una cadena: es una fila de `documento_emitido` (V15) con los datos que lo
--     dibujaron y el SHA-256 de lo que salio, que es lo unico que convierte
--     «reimprimir devuelve el original» en algo que se comprueba. Dejar las dos
--     cosas seria tener dos sitios donde vive el documento del acto, y el papel
--     que el obligado tiene en la mano solo puede salir de uno.
--
--     SE QUEDA `numero`, ensanchado a varchar(40), Y PASA A SER EL NUMERO DEL
--     DOCUMENTO EMITIDO. No es una copia que pueda divergir: las dos columnas
--     -`numero` y `documento_id`- se escriben en el mismo INSERT desde la misma
--     emision. Es el patron de `valor_movimiento` (V28), que guarda
--     `notificacion_id` para la integridad y `exigible_desde` copiado para que
--     la fila se explique sola dos anios despues.
--
--     LE FALTABAN: la observacion (regla 10, RNF-052 — un acto administrativo
--     sin el porque de quien lo registro es una fila), la fecha de registro, el
--     documento emitido, el tipo de medida cautelar de la REC-2, y el sustento
--     de la REC-2.
--
--  3. NO HAY REC-2 SIN REC-1 NOTIFICADA Y CON PLAZO VENCIDO, Y LA BASE LO DICE.
--     Es el mismo mecanismo, exacto, que `valor_movimiento_exigible_ck` (V28):
--     la fila del acto REC-2 COPIA la diligencia que notifico la REC-1
--     (`rec1_notificacion_id`) y la fecha desde la que la medida cautelar se
--     puede dictar (`rec1_exigible_desde`), y un CHECK exige que el acto sea
--     posterior. No se puede insertar una REC-2 sin senalar que notificacion la
--     sustenta, ni fecharla antes de que el plazo venza.
--
--     Lo que un CHECK no puede comprobar -que esa notificacion sea la de la
--     REC-1 DE ESTE expediente y que haya surtido efecto- lo comprueba
--     `RegistrarActoCoactivo`, porque exige un JOIN. La division es deliberada:
--     en la base va lo expresable, y va TODO lo expresable.
--
--     `rec1_exigible_desde` no sale de una constante: sale de
--     `notificacion.exigible_desde`, que #39 deriva del plazo PARAMETRIZADO del
--     conjunto sellado vigente a la fecha de la diligencia (regla 5). Los siete
--     dias habiles del art. 14.1 de la Ley 26979 son norma nacional, y por eso
--     mismo son dato: cambiarlos no puede exigir un despliegue, y un plazo
--     compilado recalcularia con el numero de hoy los expedientes de ayer.
--
--  4. UNA SOLA REC-1 POR EXPEDIENTE. Indice unico PARCIAL, no UNIQUE(exp,
--     tipo): los demas actos se repiten -para eso existe el procedimiento- y el
--     que no puede es el que lo inicia. Mismo patron que
--     `valor_movimiento_pase_uq` (V28) y `expediente_movimiento_apertura_uq`
--     (V33), y por el mismo motivo: dos peticiones simultaneas pasan las dos
--     por cualquier comprobacion escrita en Java, y el obligado acabaria con
--     dos resoluciones de inicio del mismo procedimiento.
--
--  5. EL ACTO SOLO SE AGREGA. `REVOKE UPDATE ON acto_coactivo`: un acto del
--     procedimiento coactivo se notifica al obligado, que se lleva el papel.
--     Corregirlo en el sitio deja al papel notificado y al sistema diciendo
--     cosas distintas, y quien tenga el papel gana la discusion. Un acto
--     equivocado se deja sin efecto con otro acto -LEVANTAMIENTO, SUSPENSION-,
--     y los dos quedan. V7 nunca le dio DELETE.
--
--  Ninguna tabla nueva: `acto_coactivo` existe desde V3 con `municipalidad_id
--  NOT NULL`, asi que V6 ya le dio su politica RLS y V7 sus privilegios. Lo que
--  aqui se declara explicito es lo que se RETIRA.
--
--  Las columnas NOT NULL se agregan SIN valor por omision a proposito, igual
--  que en V28, V29, V30, V31 y V33: ninguna linea de codigo ha escrito nunca en
--  `acto_coactivo` -no tenia repositorio-, asi que esta vacia y el ALTER pasa.
--  Si en algun ambiente NO lo estuviera, PostgreSQL para la migracion nombrando
--  la columna, que es mejor que inventar un dato.
-- ============================================================================

-- ---------- 1. Lo que sobraba ----------
--
--  Sin DROP CONSTRAINT delante: `documento` no participa en ninguna, y si lo
--  hiciera se iria con la columna. Nombrar aqui una restriccion que PostgreSQL
--  bautizo solo seria depender de ese nombre.
ALTER TABLE acto_coactivo DROP COLUMN documento;

-- ---------- 2. Lo que le faltaba ----------
ALTER TABLE acto_coactivo
    -- El numero pasa a ser el del documento emitido: `REC1-2026-000001`,
    -- `MEDIDA_CAUTELAR-2026-000004`. Los 20 caracteres de V3 no llegan.
    ALTER COLUMN numero TYPE varchar(40);

ALTER TABLE acto_coactivo
    -- La fila de `documento_emitido` que lo dibujo, con sus datos y su SHA-256.
    -- Es lo que permite reimprimir la REC identica dentro de diez anios (V15,
    -- RF-132), y lo que impide que el acto y su papel se separen.
    ADD COLUMN documento_id         bigint       NOT NULL,
    -- La forma de la medida cautelar que la REC-2 ordena. El vocabulario es el
    -- del desplegable «Tipo de medida» de la pantalla `proceso_coactivo`: son
    -- las formas de embargo del art. 33 de la Ley 26979.
    ADD COLUMN medida               varchar(20)
        CHECK (medida IN ('RETENCION', 'INSCRIPCION', 'DEPOSITO', 'INTERVENCION')),
    -- El sustento de la REC-2: que diligencia notifico la REC-1 y desde cuando,
    -- vencidos los siete dias, se puede dictar la medida. Copiado, como el pase
    -- a coactiva copia los suyos (V28 §2).
    ADD COLUMN rec1_notificacion_id bigint,
    ADD COLUMN rec1_exigible_desde  date,
    ADD COLUMN fecha_registro       timestamptz  NOT NULL,
    ADD COLUMN observacion          varchar(500) NOT NULL;

-- Un acto, un documento; un documento, un acto. Sin esto, dos actos podrian
-- apuntar al mismo papel y la reimpresion de cualquiera de los dos entregaria
-- el del otro.
ALTER TABLE acto_coactivo ADD CONSTRAINT acto_documento_uq
    UNIQUE (municipalidad_id, documento_id);

-- La clave foranea del documento va NOT VALID a proposito (DAT-01 §0, hallazgo
-- 4): validarla es una consulta, y el migrador corre sin contexto de tenant, de
-- modo que no veria ninguna fila bajo RLS. NOT VALID sigue comprobando cada
-- INSERT, que es lo que importa de aqui en adelante.
ALTER TABLE acto_coactivo ADD CONSTRAINT acto_documento_fk
    FOREIGN KEY (municipalidad_id, documento_id)
    REFERENCES documento_emitido (municipalidad_id, id) NOT VALID;

ALTER TABLE acto_coactivo ADD CONSTRAINT acto_rec1_notificacion_fk
    FOREIGN KEY (municipalidad_id, rec1_notificacion_id)
    REFERENCES notificacion (municipalidad_id, id) NOT VALID;

-- La medida cautelar es de la REC-2 y solo de ella: la REC-2 ES la resolucion
-- que la ordena (pantalla `proceso_coactivo`, seccion «Medida cautelar — REC
-- 2»). Un acto de otro tipo con medida pegada seria una medida dictada sin
-- resolucion que la disponga.
ALTER TABLE acto_coactivo ADD CONSTRAINT acto_medida_ck
    CHECK ((tipo = 'REC2') = (medida IS NOT NULL));

-- El sustento va entero o no va, y solo lo lleva la REC-2.
ALTER TABLE acto_coactivo ADD CONSTRAINT acto_rec2_sustento_ck
    CHECK ((tipo = 'REC2')
           = (rec1_notificacion_id IS NOT NULL AND rec1_exigible_desde IS NOT NULL));

-- LA GUARDA. Identica en forma y en motivo a `valor_movimiento_exigible_ck`
-- (V28): un acto no puede ser anterior a la fecha desde la que la ley lo
-- permite. Sin esto, una REC-2 dictada al dia siguiente de notificar la REC-1
-- -con los siete dias corriendo todavia- entraria sin que nada fallara, y la
-- medida cautelar seria nula.
ALTER TABLE acto_coactivo ADD CONSTRAINT acto_rec2_plazo_ck
    CHECK (rec1_exigible_desde IS NULL OR fecha >= rec1_exigible_desde);

-- Una sola REC-1 por expediente: la resolucion que inicia el procedimiento se
-- dicta una vez.
CREATE UNIQUE INDEX acto_rec1_uq
    ON acto_coactivo (municipalidad_id, expediente_id)
    WHERE tipo = 'REC1';

COMMENT ON TABLE acto_coactivo IS
    'Los actos del procedimiento de ejecucion coactiva (#41, RF-101, RF-102): la REC-1 que lo '
    'inicia, la REC-2 que ordena la medida cautelar, y los demas. Cada uno con su fecha, su '
    'usuario, su observacion y el documento emitido que lo materializa. Solo se agrega: un acto '
    'se deja sin efecto con otro acto, nunca editandolo.';

COMMENT ON COLUMN acto_coactivo.numero IS
    'El numero del documento emitido que materializa el acto (documento_emitido.numero, V15). '
    'No es un correlativo propio: dos numeraciones para el mismo papel divergen.';

COMMENT ON COLUMN acto_coactivo.documento_id IS
    'La fila de documento_emitido con los datos que dibujaron el acto y el SHA-256 de lo que '
    'salio. Es lo que permite reimprimir la REC identica anos despues (RF-132).';

COMMENT ON COLUMN acto_coactivo.rec1_exigible_desde IS
    'Desde cuando, vencidos los siete dias habiles del art. 14.1 de la Ley 26979 contados desde '
    'la notificacion de la REC-1, se puede dictar la medida cautelar. Se COPIA de '
    'notificacion.exigible_desde, que sale del plazo PARAMETRIZADO del conjunto sellado (regla '
    '5): recalcularla al leer daria otra fecha el dia que el plazo cambie.';

COMMENT ON CONSTRAINT acto_rec2_plazo_ck ON acto_coactivo IS
    'No hay REC-2 antes de que venza el plazo de la REC-1. Misma forma y mismo motivo que '
    'valor_movimiento_exigible_ck (V28): un acto anterior a la fecha desde la que la ley lo '
    'permite deja el procedimiento sin sustento, y nada mas lo detectaria.';

-- ---------- 3. El acto no se edita ----------
--
--  V7 le concedio UPDATE junto con el resto de las tablas de negocio. Se
--  retira, por lo mismo que V28 se lo retiro a `notificacion` y V33 al
--  expediente: es un acto administrativo notificado, no el estado de un proceso
--  interno.
--
--  Aqui el REVOKE si se puede, al reves que con `cierre_caja` (V32 §1.bis):
--  ninguna fila de `acto_coactivo` necesita `SELECT ... FOR UPDATE`.
REVOKE UPDATE ON acto_coactivo FROM sgtm_app;

-- ---------- 4. Indices de la consulta ----------
--
--  `acto_expediente_ix (municipalidad_id, expediente_id, fecha)` ya existe desde
--  V3 y es el que la pantalla `proceso_coactivo` usa para pintar las
--  actuaciones. Falta el camino inverso, que es el que `RegistrarActoCoactivo`
--  recorre en cada REC-2: buscar la REC-1 del expediente.
CREATE INDEX acto_tipo_ix ON acto_coactivo (municipalidad_id, expediente_id, tipo);

-- La notificacion de un acto coactivo se busca por (objeto, objeto_id), que es
-- lo que `notificacion_objeto_ix` (V3) ya indexa. No hace falta ninguno mas.
