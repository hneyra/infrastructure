-- ============================================================================
--  V51 — Certificados de numeracion y zonificacion, y lo que los padrones de
--        licencias necesitan del motor (#54, RF-115, RF-132)
--
--  #54 cierra `licencias` con lo que el area emite hacia afuera: el padron de
--  licencias de funcionamiento, el resumen anual y los CERTIFICADOS. Los dos
--  primeros no necesitan tabla —leen lo que V37 y V43 ya dejaron—; el tercero
--  si, porque un certificado es un ACTO ADMINISTRATIVO NUEVO: tiene numeracion
--  propia, vigencia propia y un derecho de tramite que se cobra aparte.
--
--  1. EL CERTIFICADO NO SE EDITA, Y NACE ASI. `certificado` se crea SIN
--     conceder UPDATE ni DELETE a `sgtm_app`, igual que V39 hizo con la
--     liquidacion de fiscalizacion. No hay nada que retirar despues: V7 solo
--     alcanza a las tablas que existian cuando corrio.
--
--     El motivo es el de siempre y aqui es literal: el certificado se ENTREGA
--     al administrado, que se lo lleva y lo presenta ante un notario, un banco
--     o el Ministerio de Vivienda. Corregirlo en la base deja al papel y al
--     sistema diciendo cosas distintas, y quien tiene el papel gana la
--     discusion. Un certificado equivocado se emite de nuevo —otro numero, otro
--     derecho de tramite—, y los dos quedan.
--
--     Aqui el REVOKE ni siquiera hace falta, al reves que con `cierre_caja`
--     (V32 §1.bis): ninguna fila de esta tabla necesita `SELECT ... FOR
--     UPDATE`. Lo que se serializa es el correlativo, con un UPSERT atomico
--     sobre su propia tabla, igual que en V26, V31, V33, V37, V43 y V45.
--
--  2. LA VIGENCIA SE COPIA, NO SE RECALCULA. `vigencia_hasta` es una columna y
--     no una cuenta que se rehaga al leer. Cuantos meses vale un certificado lo
--     fija el TUPA de cada municipalidad —es D-02b— y vive en el conjunto
--     sellado bajo `VIGENCIA_CERTIFICADO:<TIPO>`; lo que la fila guarda es
--     HASTA CUANDO valia el que se entrego, calculado con el parametro que
--     regia ese dia. Mismo criterio que `anuncio_movimiento.tasa` (V45 §5) y
--     que `valor_movimiento` con su exigibilidad (V28 §2): dentro de dos anios
--     la ordenanza puede ser otra, y esta fila tiene que decir lo que dijo el
--     papel, no lo que diria hoy (regla 9, RNF-075).
--
--     NO HAY NINGUNA CIFRA EN ESTA MIGRACION. Ni meses de vigencia, ni importe
--     de derecho: los dos son normativos y sembrarlos aqui seria la regla 5 con
--     otro nombre.
--
--  3. EL DERECHO SE COPIA CON SU FECHA. `derecho` y `derecho_a` van juntos, y
--     la segunda no es decorativa (regla 9, RNF-075): es el dia al que
--     corresponde el importe cobrado, tal como `tesoreria` lo acredita por su
--     API publica. Sin ella, la columna «Derecho S/» de la grilla seria una
--     cifra sin dia, y la del resumen anual no se podria defender el dia que el
--     TUPA suba la tarifa.
--
--     El importe NO se recalcula leyendo `tasa`: se copia de lo que el recibo
--     cobro. Releer el catalogo daria la tarifa de hoy para un certificado de
--     hace dos anios, que es el mismo defecto que `RecibosDeTramiteTesoreria`
--     evita al no recomponer el desglose.
--
--  4. SIN RECIBO NO HAY CERTIFICADO, Y LA BASE LO DICE. `recibo_id NOT NULL`,
--     igual que V37 con la licencia y V43 con la de edificacion. La otra mitad
--     -que el recibo sea de caja de tasas, del solicitante, no este anulado y
--     cubra el concepto del TUPA que corresponde- exige un JOIN contra otro
--     contexto y vive en `EmitirCertificado`, contra la API publica de
--     `tesoreria`.
--
--  5. LA IDEMPOTENCIA, EN LA BASE. `certificado_idempotencia_uq` sobre la
--     cabecera `idempotency-key` que el frontend ya manda en toda escritura.
--     Mismo mecanismo que `anuncio_idempotencia_uq` (V45 §3) y `recibo_
--     idempotencia_uq` (V29 §5): el numero lo pone el sistema desde su
--     correlativo, asi que un reintento produciria OTRO numero y nadie lo
--     reconoceria como repetido. Indice unico PARCIAL porque la clave es
--     opcional: NULL no choca con NULL.
--
--  Dos tablas nuevas: `certificado` y `certificado_correlativo`. V6 solo
--  alcanza a las tablas que existian cuando corrio, asi que las dos declaran su
--  RLS y sus privilegios aqui, explicitos (CLAUDE.md, «Al agregar una tabla»).
--
--  Sus claves foraneas van EN LA PROPIA CREATE TABLE y por eso NO llevan NOT
--  VALID: el hallazgo 4 de DAT-01 es sobre una FK AGREGADA a una tabla con RLS
--  que ya tiene filas —validarla es una consulta y el migrador no tiene
--  contexto de tenant—. Una tabla que nace en la misma sentencia nace vacia y
--  no hay nada que validar. Es lo mismo que hizo V45 con `anuncio_movimiento`.
-- ============================================================================

-- ---------- 1. El certificado ----------
CREATE TABLE certificado (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    -- El numero impreso del certificado. Es SUYO y no el del documento que lo
    -- materializa: el certificado se cita por este numero en la escritura
    -- publica o en el expediente de habilitacion, y sobrevive a sus papeles.
    -- Mismo reparto que `licencia_funcionamiento.numero` (V37 §2).
    numero           varchar(20)  NOT NULL,
    -- Las cuatro clases que la pantalla `certificados` ofrece. Es vocabulario
    -- cerrado porque de el sale la llave de los DOS parametros sellados: que
    -- concepto del TUPA cobra el derecho y cuantos meses vale el certificado.
    tipo             varchar(30)  NOT NULL
        CHECK (tipo IN ('NUMERACION','ZONIFICACION_VIAS','PARAMETROS_URBANISTICOS',
                        'JURISDICCION')),
    -- El predio sobre el que se certifica, y su titular. Los dos NOT NULL: un
    -- certificado de numeracion sin predio no certifica nada, y sin solicitante
    -- no hay a quien entregarselo ni de quien exigir el derecho de tramite.
    predio_id        bigint       NOT NULL,
    contribuyente_id bigint       NOT NULL,
    -- El codigo de referencia catastral y la direccion del predio, COPIADOS el
    -- dia de la emision. No son un duplicado ocioso de `predio`: el papel dice
    -- lo que se certifico, y el saneamiento catastral puede cambiarlo despues.
    --
    -- Que esten aqui es ademas lo que permite que la grilla busque por codigo
    -- predial SIN cruzar el limite del contexto: `predio` es de `catastro`, y un
    -- JOIN desde `licencias` seria exactamente lo que ConsultaDeAnuncios explica
    -- que no se puede hacer con `contribuyente`.
    codigo_predial   cod_catastral NOT NULL,
    direccion        varchar(300) NOT NULL,
    expediente       varchar(20),
    fecha_emision    date         NOT NULL,
    -- Hasta cuando vale. Ver §2 del encabezado.
    vigencia_hasta   date         NOT NULL,
    -- El recibo del derecho de tramite. Ver §4.
    recibo_id        bigint       NOT NULL,
    -- Lo que ese recibo cobro por el concepto del certificado, y el dia al que
    -- corresponde. Ver §3.
    derecho          dinero       NOT NULL CHECK (derecho >= 0),
    derecho_a        date         NOT NULL,
    -- El papel, como fila de `documento_emitido` (V15): sus datos y el SHA-256
    -- de lo que salio. Es lo que permite reimprimirlo IDENTICO anios despues
    -- (RF-132), y lo que impide que el certificado y su papel se separen. Se
    -- guardan el identificador y el numero impreso los dos, escritos en el
    -- mismo INSERT: el primero para la integridad, el segundo para reimprimir
    -- sin cruzar tablas -mismo reparto que `licencia_movimiento` (V37 §5)-.
    documento_id     bigint       NOT NULL,
    documento_numero varchar(40)  NOT NULL,
    -- Los parametros urbanisticos que se certificaron, COPIADOS. Son texto y no
    -- numeros a proposito: los fija el Plan de Desarrollo Urbano de cada
    -- municipalidad, que los escribe como quiere -«3 pisos», «1.5 (a+r)»,
    -- «30 %»-, y convertirlos a cifra aqui obligaria a interpretar una norma
    -- local que este repositorio no tiene. Van nulos en los certificados que no
    -- los llevan: uno de numeracion certifica un numero municipal, no una
    -- altura maxima.
    zonificacion            varchar(60),
    altura_maxima           varchar(40),
    area_libre_minima       varchar(40),
    retiro_municipal        varchar(40),
    coeficiente_edificacion varchar(40),
    -- La cabecera `idempotency-key` del cliente. Ver §5.
    clave_idempotencia varchar(64),
    usuario_registro varchar(60)  NOT NULL,
    fecha_registro   timestamptz  NOT NULL,
    observacion      varchar(500) NOT NULL,
    CONSTRAINT certificado_pk PRIMARY KEY (municipalidad_id, id),
    -- Dos certificados con el mismo numero no se pueden distinguir en el
    -- expediente que los cita.
    CONSTRAINT certificado_numero_uq UNIQUE (municipalidad_id, numero),
    -- Un certificado, un papel; un papel, un certificado. Sin esto, dos
    -- certificados podrian apuntar al mismo documento y la reimpresion de
    -- cualquiera de los dos entregaria el del otro.
    CONSTRAINT certificado_documento_uq UNIQUE (municipalidad_id, documento_id),
    -- Un certificado no caduca antes de emitirse. Uno mal fechado nace vencido
    -- y nadie lo nota hasta que se lo rechazan al administrado.
    CONSTRAINT certificado_vigencia_ck CHECK (vigencia_hasta >= fecha_emision),
    CONSTRAINT certificado_predio_fk FOREIGN KEY (municipalidad_id, predio_id)
        REFERENCES predio (municipalidad_id, id),
    CONSTRAINT certificado_contribuyente_fk FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id),
    CONSTRAINT certificado_recibo_fk FOREIGN KEY (municipalidad_id, recibo_id)
        REFERENCES recibo (municipalidad_id, id),
    CONSTRAINT certificado_documento_fk FOREIGN KEY (municipalidad_id, documento_id)
        REFERENCES documento_emitido (municipalidad_id, id)
);

COMMENT ON TABLE certificado IS
    'Los certificados de numeracion, zonificacion y vias, parametros urbanisticos y jurisdiccion '
    '(#54, RF-115). SOLO SE AGREGA: se entrega al administrado, que se lo lleva, y uno equivocado '
    'se sustituye emitiendo otro -con su numero y su derecho de tramite-, nunca corrigiendo la '
    'fila. sgtm_app no recibe UPDATE ni DELETE sobre esta tabla.';

COMMENT ON COLUMN certificado.numero IS
    'El numero del certificado, el que se cita en la escritura publica o en el expediente. NO es '
    'el numero del documento emitido: el certificado sobrevive a sus reimpresiones.';

COMMENT ON COLUMN certificado.vigencia_hasta IS
    'Hasta cuando vale el certificado que se entrego, calculado con el parametro sellado que '
    'regia el dia de la emision (VIGENCIA_CERTIFICADO:<TIPO>, D-02b). Se copia y no se recalcula: '
    'dentro de dos anios el TUPA puede decir otra cosa y este papel ya esta en manos de alguien.';

COMMENT ON COLUMN certificado.derecho IS
    'Lo que el recibo cobro por el concepto del TUPA de este certificado, copiado del acto. NO se '
    'recalcula leyendo `tasa`: releer el catalogo daria la tarifa de hoy para un certificado de '
    'hace dos anios. Va siempre con `derecho_a`, que es el dia al que corresponde (regla 9).';

COMMENT ON COLUMN certificado.clave_idempotencia IS
    'La clave que el cliente manda en la cabecera idempotency-key. Con su indice unico parcial, '
    'reenviar la misma emision devuelve el certificado de la primera vez y no consume otro '
    'correlativo ni entrega un segundo papel por el mismo derecho pagado.';

CREATE UNIQUE INDEX certificado_idempotencia_uq
    ON certificado (municipalidad_id, clave_idempotencia)
    WHERE clave_idempotencia IS NOT NULL;

-- La grilla busca por predio, por tipo y por solicitante, y el padron por rango
-- de fechas.
CREATE INDEX certificado_predio_ix
    ON certificado (municipalidad_id, predio_id, fecha_emision);

-- Y por codigo predial, que es una busqueda por PREFIJO. Bajo RLS un
-- `LIKE 'prefijo%'` no llega nunca al indice -`textlike` no es leakproof y
-- PostgreSQL no lo evalua antes de la politica (DAT-01 §0, hallazgo 3)-, asi
-- que la consulta se escribe como rango con `~>=~` / `~<~` y este indice es el
-- que ese rango recorre.
CREATE INDEX certificado_codigo_predial_ix
    ON certificado (municipalidad_id, codigo_predial text_pattern_ops);

CREATE INDEX certificado_contribuyente_ix
    ON certificado (municipalidad_id, contribuyente_id, fecha_emision);

CREATE INDEX certificado_tipo_ix
    ON certificado (municipalidad_id, tipo, fecha_emision);

ALTER TABLE certificado ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificado FORCE  ROW LEVEL SECURITY;

CREATE POLICY certificado_tenant ON certificado
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- SELECT e INSERT, y nada mas. Ver §1 del encabezado.
GRANT SELECT, INSERT ON certificado TO sgtm_app;
GRANT SELECT         ON certificado TO sgtm_readonly;

-- ---------- 2. El correlativo del certificado ----------
--
--  Mismo mecanismo que `valor_correlativo` (V26), `convenio_correlativo` (V31),
--  `expediente_correlativo` (V33), `licencia_correlativo` (V37),
--  `edificacion_correlativo` (V43) y `anuncio_correlativo` (V45): se lee y se
--  incrementa en una sola sentencia UPSERT, que bloquea la fila del contador
--  mientras la actualiza. Nunca con SELECT + UPDATE: entre los dos cabe otra
--  emision, y las dos leerian el mismo numero.
--
--  El correlativo es POR TIPO, y esa es la unica diferencia con los seis
--  anteriores: el manual numera los certificados de numeracion aparte de los de
--  zonificacion, porque son tramites distintos del TUPA con su propia serie.
--  El FORMATO del numero no vive aqui -es D-09, abierta-: la tabla guarda el
--  correlativo desnudo y la composicion la hace `PlantillaDeNumeroDeCertificado`.
CREATE TABLE certificado_correlativo (
    municipalidad_id bigint      NOT NULL REFERENCES municipalidad(id),
    tipo             varchar(30) NOT NULL,
    ejercicio        ejercicio   NOT NULL,
    ultimo           bigint      NOT NULL DEFAULT 0 CHECK (ultimo >= 0),
    CONSTRAINT certificado_correlativo_pk PRIMARY KEY (municipalidad_id, tipo, ejercicio)
);

COMMENT ON TABLE certificado_correlativo IS
    'El ultimo correlativo de certificado emitido por municipalidad, TIPO y ejercicio (#54). Se '
    'lee y se incrementa en una sola sentencia UPSERT; nunca con SELECT + UPDATE. Es por tipo '
    'porque cada clase de certificado es un tramite del TUPA con su propia serie.';

ALTER TABLE certificado_correlativo ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificado_correlativo FORCE  ROW LEVEL SECURITY;

CREATE POLICY certificado_correlativo_tenant ON certificado_correlativo
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- Este contador SI se actualiza en el sitio: es infraestructura interna de
-- numeracion, no un documento entregable.
GRANT SELECT, INSERT, UPDATE ON certificado_correlativo TO sgtm_app;
GRANT SELECT                 ON certificado_correlativo TO sgtm_readonly;

-- ---------- 3. Lo que el padron de licencias necesita del motor ----------
--
--  El padron de `licencia_padron` y el resumen de `licencia_resumen_anual`
--  recorren `licencia_funcionamiento` POR FECHA DE EMISION -«Fec. Lic. desde /
--  hasta», y el resumen agrupa por año-, y hasta hoy el unico indice que
--  llevaba esa columna era `licencia_contribuyente_ix`, que la tiene en tercera
--  posicion detras del contribuyente: no sirve para un rango sin titular.
--
--  El estado NO se indexa, y no es un olvido: se deriva de
--  `licencia_movimiento` a la fecha de corte (V37 §1), asi que filtrarlo es un
--  EXISTS sobre esa tabla y lo que lo resuelve es `licencia_movimiento_
--  licencia_ix`, que V37 ya creo.
CREATE INDEX licencia_emision_ix
    ON licencia_funcionamiento (municipalidad_id, fecha_emision);

-- Y el resumen anual cuenta los duplicados por año, que es el otro recorrido
-- por fecha que ninguna consulta hacia antes.
CREATE INDEX licencia_duplicado_fecha_ix
    ON licencia_duplicado (municipalidad_id, fecha);
