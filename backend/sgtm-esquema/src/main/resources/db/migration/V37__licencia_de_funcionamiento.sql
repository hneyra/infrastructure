-- ============================================================================
--  V37 — La licencia de funcionamiento, sus giros CIIU, sus duplicados y su
--        cancelacion (#44, RF-110, RF-111, RF-112)
--
--  V4 dejo las cuatro tablas -`ciiu`, `licencia_funcionamiento`,
--  `licencia_giro`, `licencia_duplicado`- con la forma que el manual describe y
--  sin una sola linea de codigo que las escribiera. Esta migracion las pone en
--  condiciones de recibir la primera, y hace con ellas lo mismo que V30 hizo
--  con el recibo, V31 con el convenio, V32 con el turno, V33 con el expediente
--  y V34 con el acto coactivo: RETIRA LO QUE MENTIRIA y agrega lo que falta.
--
--  1. EL ESTADO DE LA LICENCIA SE DERIVA; NO ES UNA COLUMNA. Se van
--     `estado varchar(15) DEFAULT 'VIGENTE'`, `fecha_cancelacion`,
--     `motivo_cancelacion` y `licencia_cancelacion_ck`.
--
--     Es la sexta vez seguida por el mismo camino, y por el mismo motivo: una
--     columna `estado` con valor por omision dice VIGENTE desde el INSERT y
--     para siempre, porque nada la mueve; y moverla exigiria un UPDATE sobre
--     una licencia que es un acto administrativo notificado al titular, que se
--     lo lleva impreso y lo cuelga en la pared del establecimiento. Corregirla
--     en el sitio deja al papel y a la base diciendo cosas distintas, y quien
--     tiene el papel gana la discusion.
--
--     El estado sale de `licencia_movimiento`, que SOLO SE AGREGA. Es lo que el
--     AC de #44 pide con todas sus letras: «una licencia cancelada no se borra:
--     cambia de estado con su resolucion» (regla 4, RNF-051).
--
--  2. SE VA `resolucion varchar(40)`, EN LA LICENCIA Y EN EL DUPLICADO. Era
--     texto libre que nadie escribia nunca. La resolucion de una licencia es
--     una fila de `documento_emitido` (V15) con los datos que la dibujaron y el
--     SHA-256 de lo que salio, que es lo unico que convierte «reimprimir
--     devuelve el original» en algo que se comprueba (RF-132). Dejar las dos
--     cosas seria tener dos sitios donde vive el papel de la licencia, y el que
--     el titular tiene en la mano solo puede salir de uno. Mismo argumento,
--     palabra por palabra, que V34 §2 hizo con `acto_coactivo.documento`.
--
--     `numero` SE QUEDA y NO es el del documento: es el numero de la licencia
--     municipal, el que va en el papel de la pared y con el que el
--     establecimiento se identifica durante anios. Aqui SI son dos numeraciones
--     distintas -al reves que en `acto_coactivo`, donde el numero del acto ES
--     el del documento-, porque la licencia sobrevive a sus papeles: una
--     licencia con tres duplicados sigue siendo la misma licencia.
--
--  3. SIN RECIBO NO HAY LICENCIA, Y LA BASE LO DICE. `recibo_id` pasa a NOT
--     NULL, en la licencia y en el duplicado. Es la mitad expresable del primer
--     AC de #44 -«emitir sin recibo de caja valido falla»-; la otra mitad -que
--     el recibo sea de este titular, no este anulado y cubra el concepto del
--     TUPA que corresponde- exige leer tesoreria por su API publica y vive en
--     `EmitirLicenciaDeFuncionamiento`. La division es la de siempre: en la
--     base va lo expresable, y va TODO lo expresable.
--
--  4. NI LA LICENCIA NI SUS DUPLICADOS SE EDITAN. `REVOKE UPDATE` sobre las
--     dos. Y aqui el REVOKE SI se puede, al reves que con `cierre_caja` (V32
--     §1.bis): NINGUNA fila de estas dos tablas necesita `SELECT ... FOR
--     UPDATE`. Se eligio a proposito que no lo necesitara —el numero del
--     siguiente duplicado lo serializa `licencia_duplicado_uq`, no un candado
--     sobre la licencia—, precisamente para que el privilegio se pudiera
--     retirar. Cambiar eso manana devolveria la inmutabilidad al escaner de
--     fuentes como unica defensa, que es la situacion incomoda en la que
--     `cierre_caja` esta.
--
--     Los seis «procesos» que la pantalla `licencia_funcionamiento` enumera
--     -renovacion, ampliacion de giro, cambio de titular, duplicado, cese- son
--     TRAMITES, no ediciones de un formulario: cada uno produce un acto nuevo.
--     Por eso retirar el UPDATE no le quita nada al sistema.
--
--  5. EL CATALOGO CIIU ES DATO REGISTRADO POR MUNICIPALIDAD, NO SIEMBRA.
--     `ciiu` nace en V4 con `municipalidad_id NOT NULL`, RLS propia y una
--     columna `extendido` para las extensiones del usuario (RF-112). Aqui gana
--     las cuatro columnas que su pantalla muestra y las dos de la traza. Lo que
--     NO se hace es sembrar la CIIU rev. 4 del INEI: es una transcripcion
--     normativa sin fuente verificada en este repositorio, y el precedente de
--     los valores normativos es no inventarla (marco-normativo.md). La
--     municipalidad la registra o la carga; el sistema no se la inventa.
--
--  Dos tablas nuevas: `licencia_movimiento` y `licencia_correlativo`. V6 solo
--  alcanza a las tablas que existian cuando corrio, asi que las dos declaran su
--  RLS y sus privilegios aqui, explicitos (CLAUDE.md, «Al agregar una tabla»).
--
--  Las columnas NOT NULL se agregan SIN valor por omision a proposito, igual
--  que en V28, V29, V30, V31, V33 y V34: ninguna linea de codigo ha escrito
--  nunca en estas cuatro tablas -no tenian repositorio-, asi que estan vacias y
--  el ALTER pasa. Si en algun ambiente NO lo estuvieran, PostgreSQL para la
--  migracion nombrando la columna, que es mejor que inventar un dato.
-- ============================================================================

-- ---------- 1. El catalogo CIIU ----------
ALTER TABLE ciiu
    -- La letra de seccion de la CIIU (A..U). Es lo que la pantalla `ciiu`
    -- filtra y lo que agrupa el catalogo.
    ADD COLUMN seccion                 char(1)
        CHECK (seccion IS NULL OR seccion BETWEEN 'A' AND 'U'),
    -- El nivel de riesgo de la ITSE que el giro determina. Va NULO mientras la
    -- municipalidad no lo declare: un giro sin riesgo declarado es un giro que
    -- todavia no se puede usar para decidir si la inspeccion es previa o
    -- posterior, y ponerle BAJO por omision seria decidirlo por descuido.
    ADD COLUMN riesgo_itse             varchar(10)
        CHECK (riesgo_itse IN ('BAJO','MEDIO','ALTO','MUY_ALTO')),
    -- Las zonas del indice de usos donde el giro es compatible, como texto: es
    -- ordenanza local (D-02b) y cada municipalidad la escribe distinto.
    ADD COLUMN zonificacion_compatible varchar(120),
    ADD COLUMN requiere_sectorial      boolean      NOT NULL DEFAULT false,
    ADD COLUMN usuario_registro        varchar(60)  NOT NULL,
    ADD COLUMN observacion             varchar(500) NOT NULL,
    ADD COLUMN fecha_registro          timestamptz  NOT NULL;

COMMENT ON COLUMN ciiu.extendido IS
    'El giro lo agrego la municipalidad, no venia en la clasificacion publicada (RF-112). Se '
    'guarda para poder distinguir el catalogo normativo de su extension local el dia que la '
    'clasificacion oficial se cargue.';

COMMENT ON COLUMN ciiu.riesgo_itse IS
    'Nivel de riesgo de la inspeccion tecnica de seguridad que el giro determina. Nulo mientras '
    'la municipalidad no lo declare: un valor por omision decidiria por descuido si la ITSE es '
    'previa o posterior.';

-- ---------- 2. La licencia de funcionamiento ----------
--
--  Lo que sobraba. El CHECK se va con las columnas que compara, pero se retira
--  antes y por su nombre: depender de que PostgreSQL lo arrastre seria depender
--  de un detalle que no esta escrito en ninguna parte.
ALTER TABLE licencia_funcionamiento DROP CONSTRAINT licencia_cancelacion_ck;

ALTER TABLE licencia_funcionamiento
    DROP COLUMN estado,
    DROP COLUMN fecha_cancelacion,
    DROP COLUMN motivo_cancelacion,
    DROP COLUMN resolucion;

ALTER TABLE licencia_funcionamiento
    -- La fila de `documento_emitido` con los datos que dibujaron la licencia y
    -- el SHA-256 de lo que salio. Es lo que permite entregar un duplicado
    -- IDENTICO al original anios despues (V15, RF-132), y lo que impide que la
    -- licencia y su papel se separen.
    ADD COLUMN documento_id     bigint,
    -- La version de la FICHA ECONOMICA del predio que regia al emitir (#19).
    -- Se guarda el identificador y nada mas: `licencias` no conoce fichas
    -- catastrales, las pide por el puerto publico de `catastro`. Es opcional
    -- porque una licencia puede recaer sobre un establecimiento cuyo predio
    -- todavia no tiene ficha economica levantada, y negar la licencia por eso
    -- seria inventar un requisito.
    ADD COLUMN ficha_id         bigint,
    ADD COLUMN expediente       varchar(20),
    ADD COLUMN fecha_expediente date,
    ADD COLUMN fecha_registro   timestamptz  NOT NULL;

-- El tipo de licencia era texto libre. El vocabulario es el del desplegable
-- «Tipo de licencia» de la pantalla `licencia_funcionamiento`.
ALTER TABLE licencia_funcionamiento ADD CONSTRAINT licencia_tipo_ck
    CHECK (tipo_licencia IN ('DEFINITIVA','TEMPORAL','CESIONARIA'));

-- SIN RECIBO NO HAY LICENCIA (AC 1 de #44, RF-110).
ALTER TABLE licencia_funcionamiento ALTER COLUMN recibo_id SET NOT NULL;

-- Y sin documento tampoco: una licencia que no se puede imprimir no se puede
-- entregar. Va en dos pasos -columna primero, NOT NULL despues- por claridad
-- del diff; la tabla esta vacia, asi que el resultado es el mismo.
ALTER TABLE licencia_funcionamiento ALTER COLUMN documento_id SET NOT NULL;

-- Una licencia, un documento; un documento, una licencia. Sin esto, dos
-- licencias podrian apuntar al mismo papel y el duplicado de cualquiera de las
-- dos entregaria el de la otra.
ALTER TABLE licencia_funcionamiento ADD CONSTRAINT licencia_documento_uq
    UNIQUE (municipalidad_id, documento_id);

-- Las dos claves foraneas nuevas van NOT VALID a proposito (DAT-01 §0, hallazgo
-- 4): validarlas es una consulta, y el migrador corre sin contexto de tenant,
-- de modo que no veria ninguna fila bajo RLS. NOT VALID sigue comprobando cada
-- INSERT, que es lo que importa de aqui en adelante.
ALTER TABLE licencia_funcionamiento ADD CONSTRAINT licencia_documento_fk
    FOREIGN KEY (municipalidad_id, documento_id)
    REFERENCES documento_emitido (municipalidad_id, id) NOT VALID;

ALTER TABLE licencia_funcionamiento ADD CONSTRAINT licencia_ficha_fk
    FOREIGN KEY (municipalidad_id, ficha_id)
    REFERENCES ficha_catastral (municipalidad_id, id) NOT VALID;

-- La vigencia no termina antes de empezar. Una licencia temporal mal fechada
-- nace vencida y nadie lo nota hasta que el titular reclama.
ALTER TABLE licencia_funcionamiento ADD CONSTRAINT licencia_vigencia_ck
    CHECK (vigencia_hasta IS NULL OR vigencia_hasta >= fecha_emision);

COMMENT ON TABLE licencia_funcionamiento IS
    'La licencia municipal de funcionamiento (#44, RF-110). Solo se agrega: su estado se deriva '
    'de licencia_movimiento y sus tramites -renovacion, cambio de titular, cese- producen actos '
    'nuevos, nunca la edicion del formulario.';

COMMENT ON COLUMN licencia_funcionamiento.numero IS
    'El numero de la licencia municipal, el del papel que cuelga en el establecimiento. NO es el '
    'numero del documento emitido: la licencia sobrevive a sus papeles, y una con tres '
    'duplicados sigue siendo la misma licencia.';

COMMENT ON COLUMN licencia_funcionamiento.recibo_id IS
    'El recibo de caja de tasas con que se pago el derecho de tramite. NOT NULL desde V37: sin el '
    'pago del derecho no se emite (RF-110). Que ademas sea del titular, no este anulado y cubra '
    'el concepto del TUPA lo comprueba EmitirLicenciaDeFuncionamiento contra la API publica de '
    'tesoreria, porque exige un JOIN que un CHECK no puede hacer.';

COMMENT ON COLUMN licencia_funcionamiento.ficha_id IS
    'La version de la ficha economica del predio vigente al emitir (#19). Se guarda el '
    'identificador y no los datos: licencias no conoce fichas catastrales, se la pide a catastro '
    'por su puerto publico.';

-- ---------- 3. Los giros CIIU de la licencia ----------
--
--  Un giro principal y solo uno. Indice unico PARCIAL, no UNIQUE(municipalidad,
--  licencia, principal): los giros secundarios se repiten -para eso hay varios-
--  y el que no puede repetirse es el principal. La actividad principal es la
--  que decide el nivel de riesgo de la ITSE y la compatibilidad con la
--  zonificacion; con dos, ninguna consulta podria decir cual manda.
CREATE UNIQUE INDEX licencia_giro_principal_uq
    ON licencia_giro (municipalidad_id, licencia_id)
    WHERE principal;

-- La consulta que la ficha de la licencia hace: sus giros, en orden.
CREATE INDEX licencia_giro_licencia_ix
    ON licencia_giro (municipalidad_id, licencia_id, activo);

-- ---------- 4. Los duplicados ----------
ALTER TABLE licencia_duplicado DROP COLUMN resolucion;

ALTER TABLE licencia_duplicado
    -- La resolucion que autoriza el duplicado, como fila de documento_emitido.
    ADD COLUMN documento_id     bigint       NOT NULL,
    -- Cuantas reimpresiones llevaba la licencia cuando se autorizo este. Se
    -- COPIA de documento_emitido.reimpresiones en el mismo acto, por lo mismo
    -- que valor_movimiento copia su exigibilidad (V28 §2): dos anios despues,
    -- la fila tiene que explicarse sola sin releer un contador que ya avanzo.
    ADD COLUMN reimpresion      integer      NOT NULL CHECK (reimpresion >= 1),
    ADD COLUMN usuario_registro varchar(60)  NOT NULL,
    ADD COLUMN fecha_registro   timestamptz  NOT NULL,
    ADD COLUMN observacion      varchar(500) NOT NULL;

ALTER TABLE licencia_duplicado ALTER COLUMN recibo_id SET NOT NULL;

ALTER TABLE licencia_duplicado ADD CONSTRAINT licencia_duplicado_numero_ck
    CHECK (numero >= 1);

ALTER TABLE licencia_duplicado ADD CONSTRAINT licencia_duplicado_documento_uq
    UNIQUE (municipalidad_id, documento_id);

ALTER TABLE licencia_duplicado ADD CONSTRAINT licencia_duplicado_documento_fk
    FOREIGN KEY (municipalidad_id, documento_id)
    REFERENCES documento_emitido (municipalidad_id, id) NOT VALID;

COMMENT ON TABLE licencia_duplicado IS
    'Cada duplicado autorizado de una licencia, con su resolucion y su recibo (#44, RF-111). '
    'El duplicado NO es una licencia nueva: conserva el numero de la original y sale marcado '
    'como duplicado, que es lo que EmitirDocumento.reimprimir garantiza comprobando el SHA-256.';

COMMENT ON CONSTRAINT licencia_duplicado_uq ON licencia_duplicado IS
    'Dos duplicados de la misma licencia no llevan el mismo ordinal. Es un indice unico y no un '
    'if: diez peticiones simultaneas pasan las diez por cualquier comprobacion escrita en Java, '
    'y el titular acabaria con dos papeles que dicen DUPLICADO N.o 1.';

-- ---------- 5. Los movimientos de la licencia ----------
--
--  De aqui sale su estado. La tabla solo se agrega: V37 le concede SELECT e
--  INSERT y nada mas, igual que V30 hizo con `recibo_movimiento` y V33 con
--  `expediente_movimiento`.
CREATE TABLE licencia_movimiento (
    municipalidad_id  bigint       NOT NULL REFERENCES municipalidad(id),
    id                bigint       GENERATED ALWAYS AS IDENTITY,
    licencia_id       bigint       NOT NULL,
    tipo              varchar(20)  NOT NULL
        CHECK (tipo IN ('EMISION','CANCELACION')),
    fecha             date         NOT NULL,
    motivo            varchar(500),
    -- La resolucion que sustenta el movimiento, cuando la lleva: la propia
    -- licencia en la EMISION, la resolucion de cancelacion en la CANCELACION.
    -- Van el identificador y el numero impreso los dos, escritos en el mismo
    -- INSERT desde la misma emision: el primero para la integridad, el segundo
    -- para que el historial se lea sin cruzar tablas.
    documento_id      bigint       NOT NULL,
    documento_numero  varchar(40)  NOT NULL,
    usuario_registro  varchar(60)  NOT NULL,
    fecha_registro    timestamptz  NOT NULL,
    observacion       varchar(500) NOT NULL,
    CONSTRAINT licencia_movimiento_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT licencia_movimiento_licencia_fk FOREIGN KEY (municipalidad_id, licencia_id)
        REFERENCES licencia_funcionamiento (municipalidad_id, id),
    CONSTRAINT licencia_movimiento_documento_fk FOREIGN KEY (municipalidad_id, documento_id)
        REFERENCES documento_emitido (municipalidad_id, id),
    -- Una cancelacion se motiva. La emision no la necesita: su motivo es la
    -- solicitud del administrado, que ya esta en el expediente.
    CONSTRAINT licencia_movimiento_motivo_ck
        CHECK ((tipo = 'CANCELACION') = (motivo IS NOT NULL))
);

COMMENT ON TABLE licencia_movimiento IS
    'Lo que le pasa a una licencia: su emision y su cancelacion, cada una con la resolucion que '
    'la sustenta (#44, RF-111). SOLO SE AGREGA. De aqui se deriva el estado de la licencia, que '
    'por eso no es una columna que alguien tenga que acordarse de mover.';

-- Una emision y una cancelacion por licencia, como maximo. Indices unicos
-- PARCIALES, mismo patron que `acto_rec1_uq` (V34) y `expediente_movimiento_
-- apertura_uq` (V33), y por el mismo motivo: dos peticiones simultaneas pasan
-- las dos por cualquier comprobacion escrita en Java, y el titular acabaria con
-- dos resoluciones de cancelacion de la misma licencia.
CREATE UNIQUE INDEX licencia_movimiento_emision_uq
    ON licencia_movimiento (municipalidad_id, licencia_id)
    WHERE tipo = 'EMISION';

CREATE UNIQUE INDEX licencia_movimiento_cancelacion_uq
    ON licencia_movimiento (municipalidad_id, licencia_id)
    WHERE tipo = 'CANCELACION';

CREATE INDEX licencia_movimiento_licencia_ix
    ON licencia_movimiento (municipalidad_id, licencia_id, fecha);

ALTER TABLE licencia_movimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE licencia_movimiento FORCE  ROW LEVEL SECURITY;

CREATE POLICY licencia_movimiento_tenant ON licencia_movimiento
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

GRANT SELECT, INSERT ON licencia_movimiento TO sgtm_app;
GRANT SELECT         ON licencia_movimiento TO sgtm_readonly;

-- ---------- 6. El correlativo de la licencia ----------
--
--  Mismo mecanismo que `valor_correlativo` (V26), `convenio_correlativo` (V31)
--  y `expediente_correlativo` (V33): se lee y se incrementa en una sola
--  sentencia UPSERT, que bloquea la fila del contador mientras la actualiza.
--  Nunca con SELECT + UPDATE: entre los dos cabe otra emision, y las dos
--  leerian el mismo numero.
--
--  El FORMATO del numero no vive aqui -es D-09, abierta-: la tabla guarda el
--  correlativo desnudo y la composicion la hace `PlantillaDeNumeroDeLicencia`.
CREATE TABLE licencia_correlativo (
    municipalidad_id bigint    NOT NULL REFERENCES municipalidad(id),
    ejercicio        ejercicio NOT NULL,
    ultimo           bigint    NOT NULL DEFAULT 0 CHECK (ultimo >= 0),
    CONSTRAINT licencia_correlativo_pk PRIMARY KEY (municipalidad_id, ejercicio)
);

COMMENT ON TABLE licencia_correlativo IS
    'El ultimo correlativo de licencia de funcionamiento emitido por municipalidad y ejercicio '
    '(#44). Se lee y se incrementa en una sola sentencia UPSERT; nunca con SELECT + UPDATE.';

ALTER TABLE licencia_correlativo ENABLE ROW LEVEL SECURITY;
ALTER TABLE licencia_correlativo FORCE  ROW LEVEL SECURITY;

CREATE POLICY licencia_correlativo_tenant ON licencia_correlativo
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- Este contador SI se actualiza en el sitio: es infraestructura interna de
-- numeracion, no un documento notificable.
GRANT SELECT, INSERT, UPDATE ON licencia_correlativo TO sgtm_app;
GRANT SELECT                 ON licencia_correlativo TO sgtm_readonly;

-- ---------- 7. Ni la licencia ni sus duplicados se editan ----------
--
--  V7 les concedio UPDATE junto con el resto de las tablas de negocio. Se
--  retira, por lo mismo que V29 se lo retiro al recibo y V34 al acto coactivo:
--  son actos administrativos que el titular se lleva impresos.
--
--  `ciiu` y `licencia_giro` CONSERVAN el UPDATE, y es deliberado: el catalogo
--  de giros se corrige -una descripcion mal escrita, un riesgo que la
--  municipalidad reclasifica- y quitar un giro de una licencia es ponerle
--  `activo = false`, que es justo el motivo por el que V7 le puso la columna.
REVOKE UPDATE ON licencia_funcionamiento FROM sgtm_app;
REVOKE UPDATE ON licencia_duplicado      FROM sgtm_app;

-- ---------- 8. Indices de la consulta ----------
--
--  `licencia_contribuyente_ix` de V4 llevaba `estado` en la tercera posicion, y
--  esa columna ya no existe. NO HACE FALTA UN `DROP INDEX`: PostgreSQL se lleva
--  por delante todo indice que mencione una columna eliminada, asi que el
--  `DROP COLUMN estado` de mas arriba ya lo borro. Escribir el DROP explicito
--  -que es lo que parecia prudente- falla con «index does not exist», y lo
--  descubrio ejecutar la migracion, no revisarla.
--
--  Se rehace sin `estado`: el estado se deriva, asi que filtrarlo es un EXISTS
--  sobre `licencia_movimiento`, no una columna que indexar.
CREATE INDEX licencia_contribuyente_ix
    ON licencia_funcionamiento (municipalidad_id, contribuyente_id, fecha_emision);

-- La pantalla busca por denominacion comercial y por direccion, y las dos son
-- busquedas por PREFIJO. Bajo RLS un `LIKE 'prefijo%'` no llega nunca al indice
-- -`textlike` no es leakproof y PostgreSQL no lo evalua antes de la politica
-- (DAT-01 §0, hallazgo 3)-, asi que la consulta se escribe como rango con
-- `~>=~` / `~<~` y estos indices son los que ese rango recorre.
CREATE INDEX licencia_nombre_comercial_ix
    ON licencia_funcionamiento (municipalidad_id, nombre_comercial text_pattern_ops);

CREATE INDEX licencia_direccion_ix
    ON licencia_funcionamiento (municipalidad_id, direccion text_pattern_ops);

CREATE INDEX licencia_predio_ix
    ON licencia_funcionamiento (municipalidad_id, predio_id)
    WHERE predio_id IS NOT NULL;

-- El catalogo se busca por codigo y por descripcion, tambien por prefijo.
CREATE INDEX ciiu_descripcion_ix
    ON ciiu (municipalidad_id, descripcion text_pattern_ops);
