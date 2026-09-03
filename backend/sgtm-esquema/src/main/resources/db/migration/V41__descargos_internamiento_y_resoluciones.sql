-- ============================================================================
--  V41 — Descargos, internamiento vehicular y resoluciones de gerencia (#50,
--        RF-064, RF-065, RF-074)
--
--  El escalado del manual: el infractor descarga, el vehiculo puede quedar
--  internado, y la gerencia resuelve —ordinaria primero, sancionadora despues—
--  antes de que la deuda pase a coactiva.
--
--  Nada de esto es una tabla nueva por gusto. `descargo` e `internamiento`
--  existen desde V4 con `municipalidad_id NOT NULL`, asi que V6 ya les dio su
--  politica RLS y V7 sus privilegios. Lo que aqui se hace con ellas es lo mismo
--  que V30 hizo con el recibo, V31 con el convenio, V32 con el turno, V33 con el
--  expediente y V34 con el acto coactivo: RETIRAR LAS COLUMNAS QUE MENTIRIAN y
--  agregar lo que falta.
--
--  1. LA PAPELETA NO SABE A QUIEN SE LE COBRA, Y ESO SE ARREGLA AQUI.
--
--     `RegistrarPapeleta` (#46, #47) recibe `contribuyenteObligadoId` como
--     argumento, asienta el cargo contra el, y NO LO GUARDA. La consecuencia no
--     se ve hasta este issue: cuando un descargo se declara fundado hay que dar
--     de baja la deuda que la papeleta genero, y no hay forma de saber contra
--     que obligacion se asento. `infractor_id`, `propietario_id` y
--     `contribuyente_id` son tres candidatos y ninguno es la respuesta —el
--     manual permite que el cargo vaya al propietario aunque conduzca otro—.
--
--     Se agrega `obligado_id NOT NULL`. Es ademas lo que la resolucion de
--     gerencia imprime como «Obligado» (pantallas `transito_rg_ordinaria` y
--     `adm_resolucion_gerencia`).
--
--     A DIFERENCIA de V28, V30, V31, V33 y V34, aqui la tabla SI tiene codigo
--     que escribe en ella desde #46. La columna se agrega igualmente NOT NULL y
--     sin valor por omision: si algun ambiente tuviera filas, PostgreSQL para la
--     migracion nombrando la columna, que es preferible a inventar un obligado
--     —y no se puede rellenar por SQL, porque el migrador corre sin contexto de
--     tenant y RLS no le deja ver una sola fila (DAT-01 §0, hallazgo 4)—. La
--     migracion desde la base existente es D-04 y todavia esta abierta.
--
--  2. AL DESCARGO LE SOBRAN TRES COLUMNAS: `resultado`, `resolucion` y
--     `fecha_resolucion`. Son el resultado del descargo escrito EN EL PROPIO
--     DESCARGO, es decir un `UPDATE` sobre el escrito que el administrado
--     presento. Quien resuelve es la gerencia, con una resolucion que se emite,
--     se numera, se notifica y se lleva el administrado; guardar su sentido
--     dentro de la solicitud dejaria dos sitios donde vive lo resuelto, y el
--     papel que el administrado tiene en la mano solo puede salir de uno.
--
--     El resultado pasa a `resolucion_gerencia.sentido`, y el estado del
--     descargo se DERIVA de si existe una resolucion que lo resuelva. Mismo
--     patron y mismo motivo que `expediente_coactivo` (V33) y `cierre_caja`
--     (V32).
--
--     LE FALTABAN: el numero de expediente con que entra por mesa de partes, el
--     tipo de recurso, el dia hasta el que era admisible con el conjunto sellado
--     del que salio ese plazo, la observacion (regla 10) y la fecha de registro.
--
--  3. EL PLAZO DEL DESCARGO NO ES UNA CONSTANTE. La pantalla
--     `transito_descargos` dice «Dentro del plazo (5 dias habiles)». Cinco es
--     una cifra normativa igual que los siete dias del art. 14.1 de la Ley 26979
--     que #41 ya parametrizo: va en `parametro_tributario` con tipo `PLAZO`
--     (regla 5), y la fila COPIA el dia resultante en `presentado_hasta` junto
--     con `conjunto_id`. Releerlo dentro de dos anios daria otra fecha el dia
--     que el plazo cambie (ARQ-09 §3).
--
--     `descargo_plazo_ck` compara las dos columnas: `en_plazo` no puede decir
--     una cosa mientras las fechas dicen otra. Un descargo presentado fuera de
--     plazo SI se registra —se declara improcedente, que es una resolucion— y
--     por eso la comprobacion no lo rechaza: lo obliga a decir la verdad.
--
--  4. NO HAY SANCIONADORA SIN ORDINARIA NOTIFICADA Y SIN PLAZO VENCIDO, Y LA
--     BASE LO DICE. Es el mismo mecanismo, exacto, que `acto_rec2_plazo_ck`
--     (V34) y `valor_movimiento_exigible_ck` (V28): la fila de la sancionadora
--     COPIA la diligencia que notifico la ordinaria
--     (`ordinaria_notificacion_id`) y el dia desde el que la sancion se puede
--     dictar (`ordinaria_exigible_desde`), y un CHECK exige que la resolucion
--     sea posterior.
--
--     Lo que un CHECK no puede comprobar —que esa notificacion sea la de LA
--     ORDINARIA DE ESTA PAPELETA y que haya surtido efecto— lo comprueba
--     `ResolverConResolucionDeGerencia`, porque exige un JOIN. La division es la
--     de siempre: en la base va lo expresable, y va TODO lo expresable.
--
--  5. AL INTERNAMIENTO LE SOBRA `fecha_salida`. Liberar un vehiculo no es
--     rellenar una fecha en la fila del ingreso: es un acto con su propia fecha,
--     su acta, quien retira, con que documento y —lo que este issue exige— el
--     recibo con el que se pago la custodia. Escribirlo encima del ingreso
--     borraria el unico registro de cuando entro el vehiculo si alguien se
--     equivoca de fila, y no dejaria donde poner nada de lo demas.
--
--     El levantamiento pasa a `internamiento_movimiento`, que solo se agrega, y
--     el estado del internamiento se DERIVA de sus movimientos.
--
--  6. LA LIBERACION EXIGE EL PAGO DE LA CUSTODIA, Y TAMBIEN LO DICE LA BASE.
--     `internamiento_liberacion_ck` exige que una fila de tipo LIBERACION traiga
--     el recibo de la custodia, quien retira y su documento. Que ese recibo
--     exista, este vigente y cobre de verdad la tasa de custodia lo comprueba
--     `LiberarVehiculoInternado` contra `tesoreria` por su API publica (AC de
--     #50): eso es un JOIN entre modulos y un CHECK no puede hacerlo. Las dos
--     mitades, como siempre.
--
--     La TARIFA de la custodia no esta en ninguna columna de aqui: vive en
--     `tasa` (V3), vigente a la fecha, y el internamiento solo guarda el CODIGO
--     del concepto del TUPA. Una tarifa copiada aqui seria una cifra normativa
--     en dos sitios (regla 5, ADR-0007).
--
--  7. TODO LO QUE SE EMITE, SE EMITE COMO DOCUMENTO. La resolucion de gerencia y
--     el acta de internamiento apuntan a `documento_emitido` (V15) y su `numero`
--     ES el del documento, igual que `acto_coactivo` desde V34: los datos con
--     que se dibujo y el SHA-256 de lo que salio son lo unico que convierte
--     «reimprimir devuelve el original» en algo que se comprueba (RF-132).
--
--  8. LA NOTIFICACION DE LA RESOLUCION NO NECESITA TABLA. `notificacion` nacio
--     polimorfica en V3 —`objeto` admite VALOR, RESOLUCION, ACTO_COACTIVO y
--     PAPELETA— y V28 le puso, para #39, el intento, el receptor, el acuse, la
--     exigibilidad con su conjunto sellado, `notificacion_intento_uq` y el
--     REVOKE UPDATE. La resolucion de gerencia se notifica con `objeto =
--     'RESOLUCION'` y esta migracion no le toca una columna. Es la tercera vez
--     que esa tabla sirve tal cual, y es el motivo por el que se dejo
--     polimorfica.
-- ============================================================================

-- ---------- 1. La papeleta dice a quien se le cobra ----------
ALTER TABLE papeleta
    ADD COLUMN obligado_id bigint NOT NULL;

ALTER TABLE papeleta ADD CONSTRAINT papeleta_obligado_fk
    FOREIGN KEY (municipalidad_id, obligado_id)
    REFERENCES contribuyente (municipalidad_id, id) NOT VALID;

COMMENT ON COLUMN papeleta.obligado_id IS
    'El contribuyente contra el que se asento el cargo de la multa (#46, #47). Sin el no se puede '
    'encontrar la obligacion que un descargo fundado tiene que dar de baja (#50), ni imprimir el '
    '«Obligado» de la resolucion de gerencia. No se deduce de infractor/propietario/contribuyente: '
    'el manual permite cobrarle al propietario aunque condujera otro.';

CREATE INDEX papeleta_obligado_ix ON papeleta (municipalidad_id, obligado_id, estado);

-- ---------- 2. El descargo ----------
--
--  Lo que sobra se va antes de que alguien lo lea como la verdad. Las tres
--  columnas caen juntas: son la misma idea escrita en tres campos.
--
--  Sin DROP CONSTRAINT delante, como en V34: la restriccion de `resultado` se va
--  con la columna, y nombrar aqui una que PostgreSQL bautizo solo seria depender
--  de ese nombre.
ALTER TABLE descargo DROP COLUMN resultado;
ALTER TABLE descargo DROP COLUMN resolucion;
ALTER TABLE descargo DROP COLUMN fecha_resolucion;

ALTER TABLE descargo
    -- El numero con que entra por mesa de partes: «2026-1188» en la pantalla.
    ADD COLUMN numero_expediente varchar(20)  NOT NULL,
    -- Que recurso es. El vocabulario es el del desplegable «Tipo de recurso».
    ADD COLUMN tipo_recurso      varchar(20)  NOT NULL
        CHECK (tipo_recurso IN ('DESCARGO', 'RECONSIDERACION', 'APELACION', 'NULIDAD')),
    -- El ultimo dia en que era admisible, derivado del plazo PARAMETRIZADO, y
    -- el conjunto sellado del que ese plazo salio.
    ADD COLUMN presentado_hasta  date         NOT NULL,
    ADD COLUMN conjunto_id       bigint       NOT NULL,
    ADD COLUMN en_plazo          boolean      NOT NULL,
    ADD COLUMN observacion       varchar(500) NOT NULL,
    ADD COLUMN fecha_registro    timestamptz  NOT NULL;

ALTER TABLE descargo ADD CONSTRAINT descargo_numero_uq
    UNIQUE (municipalidad_id, numero_expediente);

-- La clave foranea del conjunto va NOT VALID a proposito (DAT-01 §0, hallazgo
-- 4): validarla es una consulta, y el migrador corre sin contexto de tenant, de
-- modo que no veria ninguna fila bajo RLS. NOT VALID sigue comprobando cada
-- INSERT, que es lo que importa de aqui en adelante.
ALTER TABLE descargo ADD CONSTRAINT descargo_conjunto_fk
    FOREIGN KEY (municipalidad_id, conjunto_id)
    REFERENCES conjunto_parametros (municipalidad_id, id) NOT VALID;

-- LA GUARDA DEL PLAZO. No rechaza el descargo tardio —ese se declara
-- improcedente, y para eso hay que poder registrarlo—: impide que la fila diga
-- que llego en plazo mientras sus propias fechas dicen lo contrario.
ALTER TABLE descargo ADD CONSTRAINT descargo_plazo_ck
    CHECK (en_plazo = (fecha <= presentado_hasta));

COMMENT ON TABLE descargo IS
    'El escrito que el administrado presenta contra una papeleta (#50, RF-064). Solo se agrega: '
    'quien lo resuelve es la gerencia, con una resolucion propia; el sentido del fallo vive en '
    'resolucion_gerencia y el estado del descargo se deriva de si existe una que lo resuelva.';

COMMENT ON COLUMN descargo.presentado_hasta IS
    'El ultimo dia en que el recurso era admisible. Sale del plazo PARAMETRIZADO del conjunto '
    'sellado vigente a la fecha de la papeleta (regla 5), nunca de un 5 compilado, y se COPIA aqui '
    'porque releerlo daria otra fecha el dia que el plazo cambie (ARQ-09 §3).';

-- V7 le concedio UPDATE junto con el resto de las tablas de negocio. Se retira,
-- por lo mismo que V28 se lo retiro a `notificacion` y V34 al acto coactivo: es
-- el escrito de un administrado, no el estado de un proceso interno. Corregirlo
-- es reescribir lo que alguien firmo y presento.
REVOKE UPDATE ON descargo FROM sgtm_app;

-- ---------- 3. La resolucion de gerencia ----------
CREATE TABLE resolucion_gerencia (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    papeleta_id      bigint       NOT NULL,
    -- ORDINARIA y SANCIONADORA son las dos de transito (RF-074, pantallas
    -- `transito_rg_ordinaria` y `transito_rg_sancionadora`); ADMINISTRATIVA es
    -- la del procedimiento sancionador municipal (`adm_resolucion_gerencia`).
    -- Una sola tabla para las tres por lo mismo que `papeleta` es una sola para
    -- las dos familias: mismo esqueleto, distinta base legal (ARQ-01 §3.6).
    tipo             varchar(20)  NOT NULL
        CHECK (tipo IN ('ORDINARIA', 'SANCIONADORA', 'ADMINISTRATIVA')),
    -- El numero del documento emitido, como en acto_coactivo (V34). No es un
    -- correlativo propio: dos numeraciones para el mismo papel divergen.
    numero           varchar(40)  NOT NULL,
    documento_id     bigint       NOT NULL,
    fecha            date         NOT NULL,
    -- El descargo que resuelve, si resuelve alguno. Una ordinaria puede dictarse
    -- sin que nadie haya descargado —es la cobranza de la multa firme—, y por
    -- eso es opcional.
    descargo_id      bigint,
    sentido          varchar(20)
        CHECK (sentido IN ('FUNDADO', 'FUNDADO_EN_PARTE', 'INFUNDADO', 'IMPROCEDENTE')),
    efecto           varchar(20)
        CHECK (efecto IN ('SE_MANTIENE', 'SE_DEJA_SIN_EFECTO', 'SE_REDUCE')),
    -- El sustento de la sancionadora: que diligencia notifico la ordinaria y
    -- desde cuando, vencido el plazo, se puede sancionar. Copiado, igual que la
    -- REC-2 copia el suyo (V34 §3) y el pase a coactiva los suyos (V28 §2).
    ordinaria_notificacion_id bigint,
    ordinaria_exigible_desde  date,
    -- La sancion no pecuniaria que la sancionadora deriva a la Direccion
    -- Regional de Transportes: texto, porque el catalogo lo fija la norma
    -- sectorial y una lista cerrada aqui obligaria a desplegar para admitir una
    -- nueva.
    sancion_accesoria varchar(200),
    sustento         varchar(1000) NOT NULL,
    usuario_registro varchar(60)  NOT NULL,
    fecha_registro   timestamptz  NOT NULL,
    observacion      varchar(500) NOT NULL,
    CONSTRAINT resolucion_gerencia_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT resolucion_gerencia_numero_uq UNIQUE (municipalidad_id, numero),
    -- Una resolucion, un documento; un documento, una resolucion. Sin esto dos
    -- resoluciones podrian apuntar al mismo papel y la reimpresion de cualquiera
    -- de las dos entregaria el de la otra.
    CONSTRAINT resolucion_gerencia_documento_uq UNIQUE (municipalidad_id, documento_id),
    CONSTRAINT resolucion_gerencia_papeleta_fk FOREIGN KEY (municipalidad_id, papeleta_id)
        REFERENCES papeleta (municipalidad_id, id),
    CONSTRAINT resolucion_gerencia_descargo_fk FOREIGN KEY (municipalidad_id, descargo_id)
        REFERENCES descargo (municipalidad_id, id),
    -- El sentido y el efecto van con el descargo o no van: una resolucion que no
    -- resuelve ningun recurso no declara nada fundado ni infundado.
    CONSTRAINT resolucion_gerencia_fallo_ck CHECK (
        (descargo_id IS NOT NULL) = (sentido IS NOT NULL AND efecto IS NOT NULL)),
    -- El sustento de la sancionadora va entero o no va, y solo lo lleva ella.
    CONSTRAINT resolucion_gerencia_sustento_ck CHECK (
        (tipo = 'SANCIONADORA')
        = (ordinaria_notificacion_id IS NOT NULL AND ordinaria_exigible_desde IS NOT NULL)),
    -- LA GUARDA. Identica en forma y en motivo a acto_rec2_plazo_ck (V34): una
    -- sancionadora dictada antes de que venza el plazo que la ordinaria concedio
    -- es nula, y nada mas lo detectaria.
    CONSTRAINT resolucion_gerencia_plazo_ck CHECK (
        ordinaria_exigible_desde IS NULL OR fecha >= ordinaria_exigible_desde)
);

-- La clave foranea del documento y la de la diligencia van NOT VALID por lo
-- mismo que las anteriores.
ALTER TABLE resolucion_gerencia ADD CONSTRAINT resolucion_gerencia_documento_fk
    FOREIGN KEY (municipalidad_id, documento_id)
    REFERENCES documento_emitido (municipalidad_id, id) NOT VALID;

ALTER TABLE resolucion_gerencia ADD CONSTRAINT resolucion_gerencia_notificacion_fk
    FOREIGN KEY (municipalidad_id, ordinaria_notificacion_id)
    REFERENCES notificacion (municipalidad_id, id) NOT VALID;

-- Una sola ordinaria por papeleta, y una sola sancionadora. Indices unicos
-- PARCIALES y no UNIQUE(papeleta, tipo): el patron es el de
-- `valor_movimiento_pase_uq` (V28), `expediente_movimiento_apertura_uq` (V33) y
-- `acto_rec1_uq` (V34), y el motivo el mismo: dos peticiones simultaneas pasan
-- las dos por cualquier comprobacion escrita en Java, y el obligado acabaria con
-- dos resoluciones de gerencia por la misma multa.
CREATE UNIQUE INDEX resolucion_gerencia_ordinaria_uq
    ON resolucion_gerencia (municipalidad_id, papeleta_id)
    WHERE tipo = 'ORDINARIA';

CREATE UNIQUE INDEX resolucion_gerencia_sancionadora_uq
    ON resolucion_gerencia (municipalidad_id, papeleta_id)
    WHERE tipo = 'SANCIONADORA';

-- Un descargo se resuelve una vez. Sin esto, dos resoluciones podrian declarar
-- fundado e infundado el mismo escrito, y las dos darian de baja la deuda.
CREATE UNIQUE INDEX resolucion_gerencia_descargo_uq
    ON resolucion_gerencia (municipalidad_id, descargo_id)
    WHERE descargo_id IS NOT NULL;

CREATE INDEX resolucion_gerencia_papeleta_ix
    ON resolucion_gerencia (municipalidad_id, papeleta_id, fecha);

COMMENT ON TABLE resolucion_gerencia IS
    'Las resoluciones que la gerencia dicta sobre una papeleta (#50, RF-065, RF-074): la ordinaria '
    'que ordena la cobranza, la sancionadora que la sigue y deriva la sancion accesoria, y la del '
    'procedimiento administrativo sancionador. Solo se agrega: una resolucion se deja sin efecto '
    'con otra, nunca editandola.';

COMMENT ON COLUMN resolucion_gerencia.ordinaria_exigible_desde IS
    'Desde cuando, vencido el plazo que la ordinaria concedio y contado desde su notificacion, se '
    'puede dictar la sancionadora. Se COPIA de notificacion.exigible_desde, que sale del plazo '
    'PARAMETRIZADO del conjunto sellado (regla 5): recalcularla al leer daria otra fecha el dia '
    'que el plazo cambie.';

COMMENT ON CONSTRAINT resolucion_gerencia_plazo_ck ON resolucion_gerencia IS
    'No hay sancionadora antes de que venza el plazo de la ordinaria. Misma forma y mismo motivo '
    'que acto_rec2_plazo_ck (V34).';

ALTER TABLE resolucion_gerencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE resolucion_gerencia FORCE  ROW LEVEL SECURITY;

CREATE POLICY resolucion_gerencia_tenant ON resolucion_gerencia
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- Sin UPDATE ni DELETE, y por el mismo motivo que `acto_coactivo`: la
-- resolucion se notifica al administrado, que se lleva el papel.
GRANT SELECT, INSERT ON resolucion_gerencia TO sgtm_app;
GRANT SELECT          ON resolucion_gerencia TO sgtm_readonly;

-- ---------- 4. El internamiento ----------
--
--  `fecha_salida` se va: la salida es un acto, no una fecha en la fila de
--  entrada. `internamiento_fechas_ck` se va con ella, sin nombrarla.
ALTER TABLE internamiento DROP COLUMN fecha_salida;

ALTER TABLE internamiento
    -- El acta pasa a ser el numero del documento emitido, ensanchada a 40 como
    -- `acto_coactivo.numero` en V34, y deja de ser opcional: un vehiculo
    -- internado sin acta es un vehiculo retenido sin papel.
    ALTER COLUMN acta TYPE varchar(40);

ALTER TABLE internamiento
    ALTER COLUMN acta SET NOT NULL;

ALTER TABLE internamiento
    ADD COLUMN documento_id     bigint      NOT NULL,
    -- El codigo del concepto del TUPA con que se cobra la custodia. El CODIGO,
    -- no la tarifa: la tarifa vive en `tasa` con su vigencia (regla 5,
    -- ADR-0007), y copiarla aqui la pondria en dos sitios.
    ADD COLUMN tasa_custodia    varchar(20)  NOT NULL,
    ADD COLUMN usuario_registro varchar(60)  NOT NULL,
    ADD COLUMN fecha_registro   timestamptz  NOT NULL;

ALTER TABLE internamiento ADD CONSTRAINT internamiento_acta_uq
    UNIQUE (municipalidad_id, acta);

ALTER TABLE internamiento ADD CONSTRAINT internamiento_documento_uq
    UNIQUE (municipalidad_id, documento_id);

ALTER TABLE internamiento ADD CONSTRAINT internamiento_documento_fk
    FOREIGN KEY (municipalidad_id, documento_id)
    REFERENCES documento_emitido (municipalidad_id, id) NOT VALID;

COMMENT ON TABLE internamiento IS
    'El ingreso de un vehiculo al deposito municipal (#50, RF-064). Su salida NO se escribe aqui: '
    'es una fila de internamiento_movimiento. El estado —INTERNADO, LIBERADO, EN_ABANDONO— se '
    'deriva de los movimientos, nunca de una columna que habria que actualizar.';

COMMENT ON COLUMN internamiento.tasa_custodia IS
    'El codigo del concepto del TUPA con que se cobra la custodia diaria. La TARIFA no esta aqui: '
    'vive en `tasa` vigente a la fecha (regla 5). Copiarla seria una cifra normativa en dos sitios.';

REVOKE UPDATE ON internamiento FROM sgtm_app;

CREATE TABLE internamiento_movimiento (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    internamiento_id bigint       NOT NULL,
    tipo             varchar(12)  NOT NULL CHECK (tipo IN ('LIBERACION', 'ABANDONO')),
    fecha            date         NOT NULL,
    -- El acta del acto, con su documento emitido. Mismo par que en el ingreso.
    acta             varchar(40)  NOT NULL,
    documento_id     bigint       NOT NULL,
    -- El recibo con que se pago la custodia, tal como esta impreso en el papel
    -- (`001-0000123`). Se copia el numero y no el identificador: el recibo vive
    -- en `tesoreria`, y una clave foranea a su tabla cruzaria la frontera del
    -- modulo (ARQ-01 §4 regla 2). Que exista, este vigente y cobre la tasa de
    -- custodia lo comprueba LiberarVehiculoInternado por la API publica.
    recibo_custodia  varchar(20),
    dias_custodia    integer      CHECK (dias_custodia IS NULL OR dias_custodia >= 0),
    persona_retira   varchar(120),
    documento_retira varchar(20),
    soat_acreditado  boolean      NOT NULL DEFAULT false,
    usuario_registro varchar(60)  NOT NULL,
    fecha_registro   timestamptz  NOT NULL,
    observacion      varchar(500) NOT NULL,
    CONSTRAINT internamiento_movimiento_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT internamiento_movimiento_acta_uq UNIQUE (municipalidad_id, acta),
    CONSTRAINT internamiento_movimiento_documento_uq UNIQUE (municipalidad_id, documento_id),
    CONSTRAINT internamiento_movimiento_fk FOREIGN KEY (municipalidad_id, internamiento_id)
        REFERENCES internamiento (municipalidad_id, id),
    -- LA GUARDA DE LA LIBERACION. Un vehiculo no sale del deposito sin el recibo
    -- de la custodia, sin quien lo retira y sin su documento. Es la mitad que un
    -- CHECK puede expresar del AC de #50; la otra —que ese recibo exista de
    -- verdad y cobre esa tasa— exige preguntarle a tesoreria.
    CONSTRAINT internamiento_liberacion_ck CHECK (
        tipo <> 'LIBERACION'
        OR (recibo_custodia IS NOT NULL
            AND persona_retira IS NOT NULL
            AND documento_retira IS NOT NULL
            AND dias_custodia IS NOT NULL))
);

ALTER TABLE internamiento_movimiento ADD CONSTRAINT internamiento_movimiento_documento_fk
    FOREIGN KEY (municipalidad_id, documento_id)
    REFERENCES documento_emitido (municipalidad_id, id) NOT VALID;

-- Un vehiculo se libera una vez. Indice unico parcial, no UNIQUE(internamiento,
-- tipo): la declaracion de abandono podria repetirse por prorroga, la liberacion
-- no. Dos liberaciones serian dos actas de entrega del mismo vehiculo.
CREATE UNIQUE INDEX internamiento_liberacion_uq
    ON internamiento_movimiento (municipalidad_id, internamiento_id)
    WHERE tipo = 'LIBERACION';

CREATE INDEX internamiento_movimiento_ix
    ON internamiento_movimiento (municipalidad_id, internamiento_id, fecha);

COMMENT ON TABLE internamiento_movimiento IS
    'Lo que le pasa a un vehiculo internado (#50, RF-064): su liberacion, con el recibo de la '
    'custodia y quien lo retira, o su declaracion de abandono. Solo se agrega: el estado del '
    'internamiento se deriva de aqui.';

ALTER TABLE internamiento_movimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE internamiento_movimiento FORCE  ROW LEVEL SECURITY;

CREATE POLICY internamiento_movimiento_tenant ON internamiento_movimiento
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

GRANT SELECT, INSERT ON internamiento_movimiento TO sgtm_app;
GRANT SELECT          ON internamiento_movimiento TO sgtm_readonly;

-- ---------- 5. Indices de las consultas ----------
--
--  `internamiento` no tenia ningun indice: la pantalla lo busca por placa y por
--  deposito, y con 118 filas en el prototipo eso ya es un recorrido completo.
CREATE INDEX internamiento_placa_ix ON internamiento (municipalidad_id, placa);
CREATE INDEX internamiento_deposito_ix
    ON internamiento (municipalidad_id, deposito, fecha_ingreso);
CREATE INDEX descargo_papeleta_ix ON descargo (municipalidad_id, papeleta_id, fecha);

-- La notificacion de una resolucion se busca por (objeto, objeto_id), que
-- `notificacion_objeto_ix` (V3) ya indexa. No hace falta ninguno mas.
