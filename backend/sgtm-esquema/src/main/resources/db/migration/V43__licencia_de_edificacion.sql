-- ============================================================================
--  V43 — La licencia de edificacion: el Formulario Unico de Edificaciones
--        completo (#48, RF-113)
--
--  V4 dejo `licencia_edificacion` como una fila plana de diecisiete columnas y
--  ninguna linea de codigo que la escribiera. El FUE no es una fila plana: es un
--  formulario de nueve secciones -licencia, solicitante, representante legal,
--  datos urbanos, documentos, caracteristicas del proyecto con su valorizacion
--  por pisos y estructuras, proyectistas, responsable de obra, y ampliacion o
--  revalidacion- que se completa POR PARTES y que solo se emite cuando estan las
--  obligatorias (AC 1 de #48).
--
--  Esta migracion hace con el lo mismo que V37 hizo con la licencia de
--  funcionamiento, V35 con las costas, V34 con el acto coactivo, V33 con el
--  expediente, V32 con el turno, V31 con el convenio y V30 con el recibo:
--  RETIRA LO QUE MENTIRIA y agrega lo que falta.
--
--  1. EL ESTADO SE DERIVA; NO ES UNA COLUMNA. Se va `estado varchar(15) DEFAULT
--     'VIGENTE'`. Octava vez seguida por el mismo camino y por el mismo motivo:
--     una columna con valor por omision dice VIGENTE desde el INSERT y para
--     siempre, porque nada la mueve, y moverla exigiria un UPDATE sobre un acto
--     administrativo que el administrado tiene en la mano. Aqui el defecto es
--     ademas mas visible que en ninguna otra: el FUE nace EN TRAMITE, y con la
--     columna de V4 un expediente recien presentado ya diria «VIGENTE».
--
--     El estado sale de `edificacion_movimiento` y de `edificacion_vigencia`,
--     leidos a una fecha.
--
--  2. SE VA `valor_obra dinero NOT NULL`, Y ES LA COLUMNA MAS IMPORTANTE DE
--     ESTA MIGRACION. El valor de obra del FUE no es un dato que alguien teclee:
--     es el RESULTADO de valorizar el proyecto piso por piso y estructura por
--     estructura contra el cuadro de valores unitarios de edificacion (#17,
--     `valor_unitario_edificacion`, V1 y V18). Guardarlo aqui seria tener la
--     misma cifra en dos sitios -la tabla normativa y esta columna- y el dia que
--     difieran nadie sabria cual mando; es exactamente lo que el AC 2 de #48
--     prohibe con todas sus letras: «usa las tablas de #17 y NO DUPLICA CIFRAS».
--
--     Ademas, `NOT NULL` obligaria a inventar una cifra: las celdas del cuadro
--     de valores unitarios estan bloqueadas por D-02a (#197, #200, #233) y hoy
--     no hay ninguna que copiar. Lo que se guarda es la ESTRUCTURA -que pisos,
--     que partidas, que categorias y cuantos metros- en `edificacion_estructura`;
--     el importe se calcula al leer, contra el conjunto sellado que rija, y
--     cuando no hay tabla sellada la respuesta dice QUE LLAVE FALTA en vez de un
--     numero.
--
--  3. SE VAN `representante`, `proyectista` y `responsable_obra`, tres
--     varchar(240) sueltos. Ninguno de los tres cabe en un texto: el
--     representante legal lleva documento, partida registral del poder y
--     vigencia; los proyectistas son VARIOS -arquitectura, estructuras,
--     instalaciones- y cada uno lleva su colegiatura, que es lo que permite
--     verificar la habilitacion en el colegio profesional. Un solo campo de
--     texto convierte todo eso en una cadena que nadie puede consultar.
--
--     El representante pasa a cuatro columnas de esta misma tabla (es 0..1, y la
--     pantalla lo rotula «Opcional»); los profesionales, a
--     `edificacion_profesional`, con su tipo.
--
--  4. SE VAN `vigencia_hasta` y `revalidacion_hasta`. Dos columnas solo pueden
--     guardar dos vigencias, y en la que importa -la revalidacion- dejan sin
--     decir QUE ACTO concedio cada una. El AC 4 de #48 pide que «la revalidacion
--     deje las dos vigencias trazables», y trazable significa que cada tramo
--     nombra la resolucion que lo otorgo. Eso es `edificacion_vigencia`, una
--     fila por tramo, cada una apuntando a su movimiento.
--
--  5. SE VA `numero varchar(20) NOT NULL`, Y SE VA `fecha_emision`. Un FUE
--     existe ANTES de que haya licencia: se presenta, se completa por partes y
--     recien entonces se emite. Un numero de licencia obligatorio desde el
--     INSERT obligaria a numerar expedientes que todavia pueden no llegar a ser
--     licencia -un anteproyecto en consulta nunca lo es-, y a quemar
--     correlativos por cada FUE presentado.
--
--     El numero de la licencia y la fecha de su emision son atributos DEL ACTO
--     DE EMISION, y viven en `edificacion_movimiento`, con su indice unico
--     parcial. Lo que identifica al FUE mientras tanto es su EXPEDIENTE, que es
--     ademas por lo que la pantalla busca.
--
--  6. SE VAN `area_terreno`, `area_construida` y `numero_pisos`, las tres NOT
--     NULL en V4. Son datos de las secciones «Datos Terreno» y «Datos Proyecto»,
--     que se completan DESPUES de presentar el FUE; exigirlas en el INSERT de la
--     cabecera hace imposible el AC 1 -completar por partes-, porque obliga a
--     tenerlo todo antes de empezar. Pasan a `edificacion_terreno` y
--     `edificacion_proyecto`.
--
--  7. SE VA `recibo_id`. El derecho de tramite se comprueba AL EMITIR (AC 5), no
--     al presentar, asi que el recibo es del acto de emision y no de la
--     cabecera. Va en `edificacion_movimiento`, igual que el documento.
--
--  8. LAS SECCIONES SE VERSIONAN; NO SE EDITAN. Cada una de las cuatro tablas de
--     seccion lleva `version`, y completar una seccion otra vez inserta la
--     siguiente. Es el patron de `ficha_catastral` (V1, «una ficha nunca se
--     sobrescribe; se versiona») y por el mismo motivo: mientras el expediente
--     se tramita, lo que el administrado declaro primero y lo que corrigio
--     despues son los dos datos, y el que se pierde con un UPDATE es justo el
--     que explica una observacion del evaluador.
--
--     Por eso ninguna de estas tablas necesita UPDATE, y por eso se les puede
--     retirar (§10). El REVOKE se puede hacer aqui, al reves que con
--     `cierre_caja` (V32 §1.bis): ninguna fila del FUE se serializa con
--     `SELECT ... FOR UPDATE` -lo unico que se serializa es el correlativo, y
--     eso lo hace su propia tabla con un UPSERT atomico-.
--
--  Ocho tablas nuevas. V6 solo alcanza a las que existian cuando corrio, asi que
--  las ocho declaran su RLS y sus privilegios aqui, explicitos (CLAUDE.md, «Al
--  agregar una tabla»).
--
--  Las columnas NOT NULL se agregan SIN valor por omision a proposito, igual que
--  en V28..V37: ninguna linea de codigo ha escrito nunca en `licencia_edificacion`
--  -no tenia repositorio-, asi que esta vacia y el ALTER pasa. Si en algun
--  ambiente NO lo estuviera, PostgreSQL para la migracion nombrando la columna,
--  que es mejor que inventar un dato.
-- ============================================================================

-- ---------- 1. La cabecera del FUE ----------
--
--  Los CHECK y las restricciones se retiran ANTES y por su nombre: depender de
--  que PostgreSQL los arrastre con la columna seria depender de un detalle que
--  no esta escrito en ninguna parte (lo aprendio V37 §8 al reves, con un
--  DROP INDEX que fallaba porque el DROP COLUMN ya se lo habia llevado).
ALTER TABLE licencia_edificacion DROP CONSTRAINT edificacion_numero_uq;
ALTER TABLE licencia_edificacion DROP CONSTRAINT edificacion_recibo_fk;

ALTER TABLE licencia_edificacion
    DROP COLUMN numero,
    DROP COLUMN estado,
    DROP COLUMN valor_obra,
    DROP COLUMN representante,
    DROP COLUMN proyectista,
    DROP COLUMN responsable_obra,
    DROP COLUMN vigencia_hasta,
    DROP COLUMN revalidacion_hasta,
    DROP COLUMN area_terreno,
    DROP COLUMN area_construida,
    DROP COLUMN numero_pisos,
    DROP COLUMN fecha_emision,
    DROP COLUMN recibo_id;

ALTER TABLE licencia_edificacion
    -- El numero de expediente con que el administrado presenta el FUE. Es lo que
    -- identifica el tramite mientras no hay licencia, y el primer filtro de la
    -- pantalla `fue_edificacion`.
    ADD COLUMN expediente          varchar(20)  NOT NULL,
    ADD COLUMN fecha_declaracion   date         NOT NULL,
    -- Los cinco tramites del desplegable «Tipo Tramite» de la pantalla. El
    -- vocabulario es el del prototipo, no uno inventado aqui.
    ADD COLUMN tipo_tramite        varchar(30)  NOT NULL
        CHECK (tipo_tramite IN ('ANTEPROYECTO_EN_CONSULTA','LICENCIA_DE_OBRA',
                                'AMPLIACION_DE_LICENCIA','REVALIDACION_DE_LICENCIA',
                                'REGULARIZACION_DE_LICENCIA')),
    -- Quien revisa el proyecto. Nulo mientras no se decida: en la modalidad A no
    -- hay revision, y ponerle una por omision decidiria por descuido si el
    -- expediente pasa por comision tecnica.
    ADD COLUMN revision            varchar(20)
        CHECK (revision IN ('REVISORES_URBANOS','COMISION_TECNICA')),
    ADD COLUMN expediente_anterior varchar(20),
    -- LA AMPLIACION Y LA REVALIDACION REFERENCIAN, NO SUSTITUYEN (AC 3 y AC 4).
    -- Un FUE de ampliacion es un expediente NUEVO que apunta al original; el
    -- original no se toca -no se podria, §10- y conserva su numero, su vigencia
    -- y su papel.
    ADD COLUMN licencia_origen_id  bigint,
    ADD COLUMN solicitante_propietario boolean  NOT NULL,
    -- El representante legal, seccion propia del FUE y opcional (0..1).
    ADD COLUMN representante_documento     varchar(20),
    ADD COLUMN representante_nombre        varchar(200),
    ADD COLUMN representante_partida       varchar(40),
    ADD COLUMN representante_vigencia_poder date,
    ADD COLUMN fecha_registro      timestamptz  NOT NULL;

-- El tipo de obra era texto libre. El vocabulario es el del desplegable «OBRA».
ALTER TABLE licencia_edificacion ADD CONSTRAINT edificacion_tipo_obra_ck
    CHECK (tipo_obra IN ('EDIFICACION_NUEVA','AMPLIACION','REMODELACION',
                         'DEMOLICION','CERCO','PUESTA_EN_VALOR'));

ALTER TABLE licencia_edificacion ADD CONSTRAINT edificacion_expediente_uq
    UNIQUE (municipalidad_id, expediente);

-- Un tramite que se apoya en una licencia anterior tiene que decir en cual. Sin
-- esto, una «ampliacion» sin original es un expediente que no amplia nada y que
-- nadie puede relacionar con la obra que ya estaba autorizada.
ALTER TABLE licencia_edificacion ADD CONSTRAINT edificacion_origen_ck
    CHECK (tipo_tramite NOT IN ('AMPLIACION_DE_LICENCIA','REVALIDACION_DE_LICENCIA')
           OR licencia_origen_id IS NOT NULL);

-- Y el representante, o entero o ninguno: un nombre sin partida registral del
-- poder no acredita representacion, y una partida sin nombre no dice de quien.
ALTER TABLE licencia_edificacion ADD CONSTRAINT edificacion_representante_ck
    CHECK ((representante_nombre IS NULL AND representante_documento IS NULL
            AND representante_partida IS NULL)
           OR (representante_nombre IS NOT NULL AND representante_documento IS NOT NULL
               AND representante_partida IS NOT NULL));

-- NOT VALID a proposito (DAT-01 §0, hallazgo 4): validar es una consulta, y el
-- migrador corre sin contexto de tenant, de modo que no veria ninguna fila bajo
-- RLS. NOT VALID sigue comprobando cada INSERT, que es lo que importa.
ALTER TABLE licencia_edificacion ADD CONSTRAINT edificacion_origen_fk
    FOREIGN KEY (municipalidad_id, licencia_origen_id)
    REFERENCES licencia_edificacion (municipalidad_id, id) NOT VALID;

COMMENT ON TABLE licencia_edificacion IS
    'La cabecera del Formulario Unico de Edificaciones (#48, RF-113). Es el EXPEDIENTE, no la '
    'licencia: nace al presentarse, se completa por partes en las tablas edificacion_* y se '
    'convierte en licencia cuando edificacion_movimiento registra su EMISION. Solo se agrega.';

COMMENT ON COLUMN licencia_edificacion.licencia_origen_id IS
    'El FUE de la licencia original cuando este tramite es una ampliacion o una revalidacion '
    '(AC 3 y AC 4 de #48). La referencia NO sustituye: el original conserva su numero, su '
    'vigencia y su papel, y esta tabla ni siquiera admite UPDATE.';

-- ---------- 2. Datos urbanos: el terreno ----------
CREATE TABLE edificacion_terreno (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    fue_id           bigint       NOT NULL,
    version          smallint     NOT NULL CHECK (version >= 1),
    cod_catastral    varchar(20),
    direccion        varchar(300) NOT NULL,
    manzana          varchar(10),
    lote             varchar(10),
    area_terreno     area_m2      NOT NULL CHECK (area_terreno > 0),
    zonificacion     varchar(60),
    partida_registral varchar(40),
    -- El frente y el fondo del lote van en METROS LINEALES, no en metros
    -- cuadrados: `area_m2` seria el dominio comodo y estaria mintiendo sobre la
    -- unidad, que es como se acaba multiplicando dos veces por el area. No hay
    -- dominio para una longitud en este esquema, asi que van con su tipo y su
    -- CHECK a la vista.
    frente           numeric(8,2) CHECK (frente > 0),
    fondo            numeric(8,2) CHECK (fondo > 0),
    usuario_registro varchar(60)  NOT NULL,
    fecha_registro   timestamptz  NOT NULL,
    observacion      varchar(500) NOT NULL,
    CONSTRAINT edificacion_terreno_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT edificacion_terreno_uq UNIQUE (municipalidad_id, fue_id, version),
    CONSTRAINT edificacion_terreno_fue_fk FOREIGN KEY (municipalidad_id, fue_id)
        REFERENCES licencia_edificacion (municipalidad_id, id)
);

COMMENT ON TABLE edificacion_terreno IS
    'Los datos urbanos del FUE: ubicacion, area del terreno, zonificacion y partida registral '
    '(#48, RF-113). Se VERSIONA, no se edita: lo que el administrado declaro primero y lo que '
    'corrigio despues son los dos datos.';

-- ---------- 3. Caracteristicas del proyecto ----------
--
--  SIN NINGUNA CIFRA DE DINERO, y es el punto del issue. El «Valor de obra (S/)»
--  que la pantalla muestra NO es una columna: se calcula con
--  `edificacion_estructura` y el cuadro de valores unitarios del conjunto
--  sellado (#17). Ver §2 de la cabecera.
CREATE TABLE edificacion_proyecto (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    fue_id           bigint       NOT NULL,
    version          smallint     NOT NULL CHECK (version >= 1),
    uso              varchar(40)  NOT NULL,
    numero_pisos     smallint     NOT NULL CHECK (numero_pisos > 0),
    area_techada     area_m2      NOT NULL CHECK (area_techada >= 0),
    area_libre       area_m2,
    estacionamientos smallint     CHECK (estacionamientos >= 0),
    plazo_meses      smallint     CHECK (plazo_meses > 0),
    usuario_registro varchar(60)  NOT NULL,
    fecha_registro   timestamptz  NOT NULL,
    observacion      varchar(500) NOT NULL,
    CONSTRAINT edificacion_proyecto_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT edificacion_proyecto_uq UNIQUE (municipalidad_id, fue_id, version),
    CONSTRAINT edificacion_proyecto_fue_fk FOREIGN KEY (municipalidad_id, fue_id)
        REFERENCES licencia_edificacion (municipalidad_id, id)
);

COMMENT ON TABLE edificacion_proyecto IS
    'Las caracteristicas del proyecto del FUE (#48, RF-113). NINGUNA CIFRA DE DINERO: el valor '
    'de obra se valoriza con edificacion_estructura contra el cuadro de valores unitarios del '
    'conjunto sellado (#17), y guardarlo aqui lo duplicaria (AC 2).';

-- ---------- 4. La valorizacion, piso a piso y estructura a estructura ----------
--
--  ES LA ESTRUCTURA DE LA VALORIZACION, NO SU IMPORTE. Cada fila dice: en el
--  piso N, la partida P esta en la categoria C y mide A metros cuadrados. Cuanto
--  vale esa letra lo dice `valor_unitario_edificacion` del conjunto sellado, y
--  solo ahi (AC 2, regla 5).
--
--  `partida` y `categoria` repiten EXACTAMENTE el vocabulario y el dominio de
--  `valor_unitario_edificacion` (V1): son las dos mitades de la misma matriz, y
--  si dejaran de coincidir la valorizacion no encontraria su celda.
CREATE TABLE edificacion_estructura (
    municipalidad_id bigint      NOT NULL REFERENCES municipalidad(id),
    id               bigint      GENERATED ALWAYS AS IDENTITY,
    fue_id           bigint      NOT NULL,
    version          smallint    NOT NULL CHECK (version >= 1),
    piso             smallint    NOT NULL CHECK (piso >= 1),
    partida          varchar(20) NOT NULL
        CHECK (partida IN ('MUROS','TECHOS','PISOS','PUERTAS','REVESTIMIENTOS',
                           'BANIOS','INSTALACIONES')),
    categoria        char(1)     NOT NULL CHECK (categoria ~ '^[A-I]$'),
    area             area_m2     NOT NULL CHECK (area > 0),
    CONSTRAINT edificacion_estructura_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT edificacion_estructura_uq
        UNIQUE (municipalidad_id, fue_id, version, piso, partida),
    CONSTRAINT edificacion_estructura_fue_fk FOREIGN KEY (municipalidad_id, fue_id)
        REFERENCES licencia_edificacion (municipalidad_id, id)
);

COMMENT ON TABLE edificacion_estructura IS
    'La valorizacion del proyecto por pisos y estructuras (#48 AC 2, RF-113): que partida, en '
    'que categoria y cuantos metros. NINGUN IMPORTE: el valor por metro cuadrado de cada letra '
    'vive en valor_unitario_edificacion (#17) y se lee del conjunto sellado que rija.';

COMMENT ON COLUMN edificacion_estructura.categoria IS
    'La letra de la tabla de valores unitarios, de A a I. Es el MISMO dominio que '
    'valor_unitario_edificacion.categoria: las dos son mitades de la misma matriz.';

-- ---------- 5. Proyectistas y responsable de obra ----------
CREATE TABLE edificacion_profesional (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    fue_id           bigint       NOT NULL,
    version          smallint     NOT NULL CHECK (version >= 1),
    tipo             varchar(30)  NOT NULL
        CHECK (tipo IN ('PROYECTISTA_ARQUITECTURA','PROYECTISTA_ESTRUCTURAS',
                        'PROYECTISTA_INSTALACIONES','RESPONSABLE_OBRA')),
    nombre           varchar(200) NOT NULL,
    -- El colegio profesional y el numero de colegiatura. Van juntos o ninguno:
    -- un numero sin colegio no se puede verificar, y el colegio sin numero
    -- tampoco.
    colegio          varchar(10)  CHECK (colegio IN ('CAP','CIP')),
    colegiatura      varchar(20),
    CONSTRAINT edificacion_profesional_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT edificacion_profesional_uq UNIQUE (municipalidad_id, fue_id, version, tipo),
    CONSTRAINT edificacion_profesional_fue_fk FOREIGN KEY (municipalidad_id, fue_id)
        REFERENCES licencia_edificacion (municipalidad_id, id),
    CONSTRAINT edificacion_colegiatura_ck
        CHECK ((colegio IS NULL) = (colegiatura IS NULL))
);

COMMENT ON TABLE edificacion_profesional IS
    'Los proyectistas por especialidad y el responsable de obra del FUE (#48, RF-113). Un solo '
    'varchar(240) -lo que V4 tenia- no cabe: son varios, y cada uno lleva la colegiatura con '
    'que se verifica su habilitacion.';

-- ---------- 6. Documentos adjuntos ----------
--
--  Que requisitos exige cada modalidad es TUPA -ordenanza local, D-02b- y no se
--  escribe aqui: la tabla registra los que el administrado presento, con su
--  nombre tal como el TUPA los llame.
CREATE TABLE edificacion_requisito (
    municipalidad_id bigint      NOT NULL REFERENCES municipalidad(id),
    id               bigint      GENERATED ALWAYS AS IDENTITY,
    fue_id           bigint      NOT NULL,
    version          smallint    NOT NULL CHECK (version >= 1),
    requisito        varchar(80) NOT NULL,
    presentado       boolean     NOT NULL,
    folios           smallint    CHECK (folios > 0),
    CONSTRAINT edificacion_requisito_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT edificacion_requisito_uq
        UNIQUE (municipalidad_id, fue_id, version, requisito),
    CONSTRAINT edificacion_requisito_fue_fk FOREIGN KEY (municipalidad_id, fue_id)
        REFERENCES licencia_edificacion (municipalidad_id, id)
);

COMMENT ON TABLE edificacion_requisito IS
    'Los documentos adjuntos que el FUE declara presentados (#48, RF-113). QUE requisitos exige '
    'cada modalidad es TUPA -ordenanza local, D-02b- y no esta compilado: la tabla registra el '
    'nombre con que el TUPA los llama.';

-- ---------- 7. Lo que le pasa al FUE ----------
--
--  De aqui sale su estado, y de aqui salen el numero y la fecha de la licencia.
--  La tabla SOLO SE AGREGA: V43 le concede SELECT e INSERT y nada mas, igual que
--  V37 hizo con `licencia_movimiento` y V33 con `expediente_movimiento`.
--
--  Tres tipos, y ninguno mas. La AMPLIACION no esta: ampliar no le pasa a esta
--  licencia, produce OTRA (AC 3), exactamente el mismo argumento con que V37
--  dejo fuera la renovacion y el cambio de titular de la de funcionamiento.
--  «AMPLIADA» no es un estado de la licencia ampliada: es la existencia de otro
--  expediente que la referencia.
CREATE TABLE edificacion_movimiento (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    fue_id           bigint       NOT NULL,
    tipo             varchar(20)  NOT NULL
        CHECK (tipo IN ('EMISION','REVALIDACION','ANULACION')),
    fecha            date         NOT NULL,
    -- El numero de la licencia municipal de edificacion. Lo lleva la EMISION y
    -- solo ella: la revalidacion no numera de nuevo -es la misma licencia con
    -- otro plazo- y la anulacion tampoco.
    numero_licencia  varchar(20),
    motivo           varchar(500),
    -- El recibo de caja de tasas del derecho de tramite. Lo llevan la EMISION y
    -- la REVALIDACION, que son los dos actos que el TUPA cobra (AC 5).
    recibo_id        bigint,
    documento_id     bigint       NOT NULL,
    documento_numero varchar(40)  NOT NULL,
    usuario_registro varchar(60)  NOT NULL,
    fecha_registro   timestamptz  NOT NULL,
    observacion      varchar(500) NOT NULL,
    CONSTRAINT edificacion_movimiento_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT edificacion_movimiento_fue_fk FOREIGN KEY (municipalidad_id, fue_id)
        REFERENCES licencia_edificacion (municipalidad_id, id),
    CONSTRAINT edificacion_movimiento_documento_fk FOREIGN KEY (municipalidad_id, documento_id)
        REFERENCES documento_emitido (municipalidad_id, id),
    CONSTRAINT edificacion_movimiento_recibo_fk FOREIGN KEY (municipalidad_id, recibo_id)
        REFERENCES recibo (municipalidad_id, id),
    -- La emision numera y la anulacion no. Sin esto, una anulacion podria traer
    -- un numero de licencia y quedarian dos filas diciendo cual es.
    CONSTRAINT edificacion_movimiento_numero_ck
        CHECK ((tipo = 'EMISION') = (numero_licencia IS NOT NULL)),
    -- SIN RECIBO NO SE EMITE NI SE REVALIDA (AC 5, RF-113). Es la mitad
    -- expresable; que ademas sea de caja de tasas, no este anulado, sea del
    -- titular y cubra el concepto del TUPA exige leer tesoreria por su API
    -- publica y vive en `EmitirLicenciaDeEdificacion`.
    CONSTRAINT edificacion_movimiento_recibo_ck
        CHECK ((tipo IN ('EMISION','REVALIDACION')) = (recibo_id IS NOT NULL)),
    -- Una anulacion se motiva; la emision no la necesita: su motivo es la
    -- solicitud del administrado, que ya esta en el expediente.
    CONSTRAINT edificacion_movimiento_motivo_ck
        CHECK ((tipo = 'ANULACION') = (motivo IS NOT NULL))
);

COMMENT ON TABLE edificacion_movimiento IS
    'Lo que le pasa a un FUE: su emision -con el numero de licencia y la fecha-, su '
    'revalidacion y su anulacion (#48, RF-113). SOLO SE AGREGA. De aqui se deriva el estado, '
    'que por eso no es una columna que alguien tenga que acordarse de mover.';

-- Una emision por expediente, y un numero de licencia por municipalidad. Indices
-- unicos, no `if`: dos peticiones simultaneas pasan las dos por cualquier
-- comprobacion escrita en Java, y el administrado acabaria con dos licencias del
-- mismo expediente o con dos papeles que dicen el mismo numero.
CREATE UNIQUE INDEX edificacion_movimiento_emision_uq
    ON edificacion_movimiento (municipalidad_id, fue_id)
    WHERE tipo = 'EMISION';

CREATE UNIQUE INDEX edificacion_numero_licencia_uq
    ON edificacion_movimiento (municipalidad_id, numero_licencia)
    WHERE numero_licencia IS NOT NULL;

CREATE UNIQUE INDEX edificacion_movimiento_anulacion_uq
    ON edificacion_movimiento (municipalidad_id, fue_id)
    WHERE tipo = 'ANULACION';

CREATE INDEX edificacion_movimiento_fue_ix
    ON edificacion_movimiento (municipalidad_id, fue_id, fecha);

ALTER TABLE edificacion_movimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE edificacion_movimiento FORCE  ROW LEVEL SECURITY;

CREATE POLICY edificacion_movimiento_tenant ON edificacion_movimiento
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- ---------- 8. Las vigencias, una por tramo ----------
--
--  AC 4: «la revalidacion deja las dos vigencias trazables». Trazable no es
--  «hay dos fechas»: es que cada tramo diga QUE ACTO lo concedio. Por eso cada
--  fila apunta a su movimiento, y por eso son filas y no columnas.
--
--  `licencia_id` es el FUE de la licencia ORIGINAL. El movimiento puede ser de
--  otro expediente -el de la revalidacion-, y es justo lo que hace visible que
--  la segunda vigencia vino de un tramite aparte.
CREATE TABLE edificacion_vigencia (
    municipalidad_id bigint   NOT NULL REFERENCES municipalidad(id),
    id               bigint   GENERATED ALWAYS AS IDENTITY,
    licencia_id      bigint   NOT NULL,
    movimiento_id    bigint   NOT NULL,
    orden            smallint NOT NULL CHECK (orden >= 1),
    desde            date     NOT NULL,
    hasta            date     NOT NULL,
    CONSTRAINT edificacion_vigencia_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT edificacion_vigencia_uq UNIQUE (municipalidad_id, licencia_id, orden),
    CONSTRAINT edificacion_vigencia_licencia_fk FOREIGN KEY (municipalidad_id, licencia_id)
        REFERENCES licencia_edificacion (municipalidad_id, id),
    CONSTRAINT edificacion_vigencia_movimiento_fk FOREIGN KEY (municipalidad_id, movimiento_id)
        REFERENCES edificacion_movimiento (municipalidad_id, id),
    CONSTRAINT edificacion_vigencia_ck CHECK (hasta >= desde)
);

COMMENT ON TABLE edificacion_vigencia IS
    'Cada tramo de vigencia de una licencia de edificacion, con el acto que lo concedio (#48 '
    'AC 4). La revalidacion agrega el segundo tramo; el primero queda intacto, y por eso las '
    'dos vigencias son trazables.';

CREATE INDEX edificacion_vigencia_licencia_ix
    ON edificacion_vigencia (municipalidad_id, licencia_id, orden);

ALTER TABLE edificacion_vigencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE edificacion_vigencia FORCE  ROW LEVEL SECURITY;

CREATE POLICY edificacion_vigencia_tenant ON edificacion_vigencia
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- ---------- 9. El correlativo de la licencia de edificacion ----------
--
--  Mismo mecanismo que `licencia_correlativo` (V37), `valor_correlativo` (V26) y
--  `expediente_correlativo` (V33): se lee y se incrementa en una sola sentencia
--  UPSERT, que bloquea la fila del contador mientras la actualiza. Nunca con
--  SELECT + UPDATE: entre los dos cabe otra emision, y las dos leerian el mismo
--  numero.
--
--  El FORMATO no vive aqui -es D-09, abierta-: la tabla guarda el correlativo
--  desnudo y la composicion la hace `PlantillaDeNumeroDeEdificacion`.
CREATE TABLE edificacion_correlativo (
    municipalidad_id bigint    NOT NULL REFERENCES municipalidad(id),
    ejercicio        ejercicio NOT NULL,
    ultimo           bigint    NOT NULL DEFAULT 0 CHECK (ultimo >= 0),
    CONSTRAINT edificacion_correlativo_pk PRIMARY KEY (municipalidad_id, ejercicio)
);

COMMENT ON TABLE edificacion_correlativo IS
    'El ultimo correlativo de licencia de edificacion emitido por municipalidad y ejercicio '
    '(#48). Se lee y se incrementa en una sola sentencia UPSERT; nunca con SELECT + UPDATE.';

ALTER TABLE edificacion_correlativo ENABLE ROW LEVEL SECURITY;
ALTER TABLE edificacion_correlativo FORCE  ROW LEVEL SECURITY;

CREATE POLICY edificacion_correlativo_tenant ON edificacion_correlativo
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- ---------- 10. RLS y privilegios de las tablas de seccion ----------
--
--  Las cuatro tablas de seccion se versionan (§8), asi que ninguna necesita
--  UPDATE. Se les concede SELECT e INSERT y nada mas.
DO $secciones$
DECLARE
    t text;
BEGIN
    FOR t IN
        SELECT unnest(ARRAY['edificacion_terreno','edificacion_proyecto',
                            'edificacion_estructura','edificacion_profesional',
                            'edificacion_requisito'])
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY %I ON %I'
            ' USING      (municipalidad_id = current_setting(''app.municipalidad_id'')::bigint)'
            ' WITH CHECK (municipalidad_id = current_setting(''app.municipalidad_id'')::bigint)',
            t || '_tenant', t);
        EXECUTE format('GRANT SELECT, INSERT ON %I TO sgtm_app', t);
        EXECUTE format('GRANT SELECT ON %I TO sgtm_readonly', t);
    END LOOP;
END
$secciones$;

GRANT SELECT, INSERT ON edificacion_movimiento TO sgtm_app;
GRANT SELECT         ON edificacion_movimiento TO sgtm_readonly;

GRANT SELECT, INSERT ON edificacion_vigencia TO sgtm_app;
GRANT SELECT         ON edificacion_vigencia TO sgtm_readonly;

-- Este contador SI se actualiza en el sitio: es infraestructura interna de
-- numeracion, no un documento notificable.
GRANT SELECT, INSERT, UPDATE ON edificacion_correlativo TO sgtm_app;
GRANT SELECT                 ON edificacion_correlativo TO sgtm_readonly;

-- ---------- 11. El FUE no se edita ----------
--
--  V7 le concedio UPDATE a `licencia_edificacion` junto con el resto de las
--  tablas de negocio. Se retira, por lo mismo que V37 se lo retiro a la licencia
--  de funcionamiento y V34 al acto coactivo: es un acto administrativo que el
--  administrado se lleva impreso y que la obra exhibe en el cartel.
--
--  Y aqui el REVOKE se puede, al reves que con `cierre_caja` (V32 §1.bis):
--  ninguna fila de este expediente necesita `SELECT ... FOR UPDATE`. Lo unico
--  que se serializa es el correlativo, y eso lo hace su propia tabla.
REVOKE UPDATE ON licencia_edificacion FROM sgtm_app;

-- ---------- 12. Indices de la consulta ----------
--
--  La pantalla `fue_edificacion` busca por expediente, por numero de licencia,
--  por nombre del contribuyente y por manzana y lote del terreno.
CREATE INDEX edificacion_contribuyente_ix
    ON licencia_edificacion (municipalidad_id, contribuyente_id, fecha_declaracion);

CREATE INDEX edificacion_origen_ix
    ON licencia_edificacion (municipalidad_id, licencia_origen_id)
    WHERE licencia_origen_id IS NOT NULL;

CREATE INDEX edificacion_predio_ix
    ON licencia_edificacion (municipalidad_id, predio_id)
    WHERE predio_id IS NOT NULL;

-- Manzana y lote se filtran por PREFIJO desde la pantalla. Bajo RLS un
-- `LIKE 'prefijo%'` no llega nunca al indice -`textlike` no es leakproof y
-- PostgreSQL no lo evalua antes de la politica (DAT-01 §0, hallazgo 3)-, asi que
-- la consulta se escribe como rango con `~>=~` / `~<~` y estos indices son los
-- que ese rango recorre.
CREATE INDEX edificacion_terreno_manzana_ix
    ON edificacion_terreno (municipalidad_id, manzana text_pattern_ops);

CREATE INDEX edificacion_terreno_lote_ix
    ON edificacion_terreno (municipalidad_id, lote text_pattern_ops);

CREATE INDEX edificacion_estructura_fue_ix
    ON edificacion_estructura (municipalidad_id, fue_id, version);

CREATE INDEX edificacion_profesional_fue_ix
    ON edificacion_profesional (municipalidad_id, fue_id, version);

CREATE INDEX edificacion_requisito_fue_ix
    ON edificacion_requisito (municipalidad_id, fue_id, version);
