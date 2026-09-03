-- ============================================================================
--  V49 — La transferencia a rentas y su resolucion de determinacion
--        (#52, RF-054, RF-057)
--
--  ESTA ES LA FRONTERA DELICADA DEL SISTEMA (ARQ-01 §3.5). Hasta aqui, todo lo
--  que `fiscalizacion` registro vivio sobre COPIAS: el acta (V4/V24, #45) guarda
--  el area medida en campo y la VERSION de ficha que regia el dia de la visita,
--  y la liquidacion (V39, #49) guarda el contraste hallado/declarado. Nada de
--  eso es el dato oficial del padron.
--
--  La transferencia es el unico acto que convierte lo hallado en dato oficial, y
--  esta tabla es ese acto.
--
--  1. UNA SOLA TABLA PARA EL ACTO Y SU PAPEL, Y NO DOS. La transferencia y la
--     resolucion de determinacion son la MISMA cosa vista desde dos sitios: la
--     resolucion es el acto administrativo que determina de oficio, y transferir
--     es su efecto sobre el padron. Separarlas en `transferencia` y
--     `resolucion_determinacion` habria producido dos filas 1:1 que nadie puede
--     desincronizar sin que la otra mienta, y una pregunta sin respuesta: cual de
--     las dos se notifica.
--
--     Es el patron de `resolucion_gerencia` (V41, #50) y de `acto_coactivo`
--     (V34, #41): el acto, su documento y su efecto, en una transaccion.
--
--  2. NO ES UN `valor`, Y SE COMPROBO ANTES DE CREAR LA TABLA. La tentacion es
--     colgarla de `valor` con tipo 'RD' —el catalogo la llama «Resolucion de
--     determinacion» y `valor` ya tiene ese tipo desde V3—. No sirve, por dos
--     motivos que se leen en el propio codigo de #37:
--
--       «Un valor no crea deuda: la formaliza». `RegistrarValor` cruza cada
--       obligacion contra `ConsultaDeDeudaPublica`, congela el desglose que el
--       LIBRO devuelve y mueve la fase de ORDINARIA a VALOR. O sea: exige que la
--       deuda YA ESTE asentada. La resolucion de fiscalizacion es lo contrario:
--       es el acto que la asienta. Emitirla como `valor` obligaria a que la
--       deuda existiera antes del acto que la determina.
--
--       Y `RegistrarValor` rechaza con `ObligacionSinDeuda` un contribuyente sin
--       saldo. Mientras D-02a siga abierta la liquidacion sale SIN importes
--       (#198), asi que ningun valor se podria emitir — y con el se caeria
--       tambien la parte de la transferencia que NO depende de D-02: inscribir en
--       catastro la estructura hallada.
--
--     Las dos cosas conviven sin duplicarse: una vez que la transferencia asento
--     el cargo, `valores` puede formalizarlo como RD por el camino ordinario de
--     #37, igual que formaliza un predial de rentas. La resolucion de
--     fiscalizacion DETERMINA; el valor FORMALIZA.
--
--  3. UNA TRANSFERENCIA POR LIQUIDACION, Y LA GARANTIZA LA BASE.
--     `resolucion_determinacion_liquidacion_uq` es el AC 6 de #52: transferir dos
--     veces el mismo resultado no duplica ni versiones de ficha ni cargos. No se
--     escribe como comprobacion en Java —dos peticiones simultaneas pasan las dos
--     por cualquier `if`—, igual que `expediente_valor_unico_uq` (V33) y
--     `licencia_duplicado_uq` (V37).
--
--  4. LA FILA DICE QUE VERSION CERRO Y CUAL ABRIO. `ficha_anterior_id` y
--     `ficha_nueva_id` no son adorno: son lo que permite responder «como estaba
--     el padron antes de esta transferencia» sin recorrer fechas, y lo que ata la
--     version nueva al acto que la justifica. La ficha, por su lado, ya guarda
--     desde V1 su `origen` —que admite 'FISCALIZACION'—, su `documento_origen`,
--     su `usuario_registro` y su `observacion`: el AC 2 de #52 no necesita ni una
--     columna nueva ahi, y se comprobo mirando V1 antes de escribir un ALTER.
--
--  5. NI UN IMPORTE. Como la liquidacion de la que sale (V39 §4) y por lo mismo:
--     los importes que se asientan salen de `liquidacion_detalle`, que los tiene
--     en NULL mientras D-02a no entregue la UIT, el cuadro de valores unitarios y
--     la tabla de depreciacion, y D-02c la multa del art. 176 (#198). Guardar
--     aqui un total seria guardar una cifra que no se puede desglosar y que
--     ademas duplicaria la del libro — y la que se cobra en ventanilla es la del
--     libro (la leccion de `costa_procesal`, V35 §1, #42).
--
--     El cargo se asienta con `cuentacorriente.GeneradorDeCargos`, como todo
--     cargo de otro contexto (ARQ-01 §4 regla 2), con el numero de esta
--     resolucion como `documento_origen`. Por eso no hay clave foranea desde el
--     libro hacia aqui: `cuentacorriente` no conoce a nadie.
--
--  6. SOLO SE AGREGA. Sin `UPDATE` para `sgtm_app`, como la liquidacion (V39 §7),
--     el acto coactivo (V34) y la resolucion de gerencia (V41). Motivo literal:
--     la resolucion se NOTIFICA al contribuyente, que se lleva el papel, y ademas
--     su cargo YA ESTA en el libro. Corregirla en el sitio dejaria al papel, al
--     libro y a la base diciendo tres cosas distintas. Una resolucion equivocada
--     se deja sin efecto con otro acto, y las dos quedan.
--
--  La tabla es NUEVA y lleva `municipalidad_id NOT NULL`, asi que su RLS y sus
--  privilegios se declaran aqui, explicitos: V6 solo alcanzo a las que existian
--  cuando corrio (CLAUDE.md, «Al agregar una tabla»).
-- ============================================================================

CREATE TABLE resolucion_determinacion (
    municipalidad_id  bigint        NOT NULL REFERENCES municipalidad(id),
    id                bigint        GENERATED ALWAYS AS IDENTITY,
    -- El numero del documento emitido, como en `acto_coactivo` (V34) y
    -- `resolucion_gerencia` (V41). No es un correlativo propio: dos numeraciones
    -- para el mismo papel divergen.
    numero            varchar(40)   NOT NULL,
    documento_id      bigint        NOT NULL,
    -- La liquidacion que se transfiere. Es la que aporta el contraste y, cuando
    -- D-02a cierre, los importes de la diferencia.
    liquidacion_id    bigint        NOT NULL,
    contribuyente_id  bigint        NOT NULL,
    -- La unidad, heredada de la liquidacion: una de las dos, como en V39.
    predio_id         bigint,
    vehiculo_id       bigint,
    -- Las dos versiones de la ficha: la que este acto cerro y la que abrio (§4).
    -- Nulas en una transferencia vehicular, que no versiona ficha alguna.
    ficha_anterior_id bigint,
    ficha_nueva_id    bigint,
    fecha             date          NOT NULL,
    -- EL SUSTENTO DOCUMENTAL (AC 3). No es texto libre decorativo: es el papel
    -- que respalda el acto —el acta de la inspeccion, el expediente—, y sin el
    -- la transferencia no se registra. La columna es NOT NULL y quien la escribe
    -- la exige antes de tocar nada.
    documento_sustento varchar(80)  NOT NULL,
    sustento          varchar(1000) NOT NULL,
    base_legal        varchar(200)  NOT NULL,
    usuario_registro  varchar(60)   NOT NULL,
    fecha_registro    timestamptz   NOT NULL,
    observacion       varchar(500)  NOT NULL,
    CONSTRAINT resolucion_determinacion_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT resolucion_determinacion_numero_uq UNIQUE (municipalidad_id, numero),
    -- Una resolucion, un documento; un documento, una resolucion. Sin esto dos
    -- resoluciones podrian apuntar al mismo papel y la reimpresion de cualquiera
    -- de las dos entregaria el de la otra (V41 §7).
    CONSTRAINT resolucion_determinacion_documento_uq UNIQUE (municipalidad_id, documento_id),
    -- EL AC 6 DE #52. Transferir dos veces el mismo resultado no duplica ni
    -- versiones ni cargos, y quien lo impide es esta linea.
    CONSTRAINT resolucion_determinacion_liquidacion_uq UNIQUE (municipalidad_id, liquidacion_id),
    -- Una transferencia es de un predio o de un vehiculo, nunca de los dos ni de
    -- ninguno: hereda la disyuntiva del acta (V24) y de la liquidacion (V39).
    CONSTRAINT resolucion_determinacion_unidad_ck
        CHECK ((predio_id IS NOT NULL) <> (vehiculo_id IS NOT NULL)),
    -- Una transferencia predial SIEMPRE versiona la ficha, y una vehicular no
    -- versiona ninguna. Sin este CHECK, una transferencia predial podria quedar
    -- registrada sin haber tocado el padron —que es exactamente lo que la
    -- transferencia existe para hacer— y nada lo delataria.
    CONSTRAINT resolucion_determinacion_version_ck
        CHECK ((predio_id IS NOT NULL) = (ficha_nueva_id IS NOT NULL)
               AND (ficha_anterior_id IS NULL) = (ficha_nueva_id IS NULL)),
    -- La version que abre no puede ser la que cierra.
    CONSTRAINT resolucion_determinacion_versiones_distintas_ck
        CHECK (ficha_anterior_id IS NULL OR ficha_anterior_id <> ficha_nueva_id)
);

-- Las foraneas van NOT VALID a proposito (DAT-01 §0, cuarto hallazgo): validarlas
-- es una consulta, y el migrador corre sin contexto de tenant, de modo que bajo
-- RLS no veria ninguna fila. NOT VALID sigue comprobando cada INSERT, que es lo
-- que importa de aqui en adelante.
ALTER TABLE resolucion_determinacion ADD CONSTRAINT resolucion_determinacion_liquidacion_fk
    FOREIGN KEY (municipalidad_id, liquidacion_id)
    REFERENCES liquidacion_fiscalizacion (municipalidad_id, id) NOT VALID;

ALTER TABLE resolucion_determinacion ADD CONSTRAINT resolucion_determinacion_documento_fk
    FOREIGN KEY (municipalidad_id, documento_id)
    REFERENCES documento_emitido (municipalidad_id, id) NOT VALID;

ALTER TABLE resolucion_determinacion ADD CONSTRAINT resolucion_determinacion_contribuyente_fk
    FOREIGN KEY (municipalidad_id, contribuyente_id)
    REFERENCES contribuyente (municipalidad_id, id) NOT VALID;

ALTER TABLE resolucion_determinacion ADD CONSTRAINT resolucion_determinacion_predio_fk
    FOREIGN KEY (municipalidad_id, predio_id)
    REFERENCES predio (municipalidad_id, id) NOT VALID;

ALTER TABLE resolucion_determinacion ADD CONSTRAINT resolucion_determinacion_vehiculo_fk
    FOREIGN KEY (municipalidad_id, vehiculo_id)
    REFERENCES vehiculo (municipalidad_id, id) NOT VALID;

ALTER TABLE resolucion_determinacion ADD CONSTRAINT resolucion_determinacion_ficha_anterior_fk
    FOREIGN KEY (municipalidad_id, ficha_anterior_id)
    REFERENCES ficha_catastral (municipalidad_id, id) NOT VALID;

ALTER TABLE resolucion_determinacion ADD CONSTRAINT resolucion_determinacion_ficha_nueva_fk
    FOREIGN KEY (municipalidad_id, ficha_nueva_id)
    REFERENCES ficha_catastral (municipalidad_id, id) NOT VALID;

COMMENT ON TABLE resolucion_determinacion IS
    'La transferencia a rentas de un resultado de fiscalizacion y la resolucion de determinacion '
    'que la materializa (#52, RF-054, RF-057). Es el unico acto que convierte lo hallado en dato '
    'oficial del padron: deja la ficha anterior intacta, abre una version nueva con origen '
    'FISCALIZACION, asienta los cargos de la diferencia en el libro y emite el papel notificable. '
    'Solo se agrega: una resolucion equivocada se deja sin efecto con otro acto.';

COMMENT ON COLUMN resolucion_determinacion.documento_sustento IS
    'El papel que sustenta el acto -el acta de la inspeccion, el expediente-. Sin sustento no se '
    'transfiere (AC 3 de #52): la columna es NOT NULL y quien escribe lo exige antes de tocar el '
    'padron.';

COMMENT ON COLUMN resolucion_determinacion.ficha_nueva_id IS
    'La version de ficha que este acto abrio. Con ficha_anterior_id es lo que permite responder '
    '«como estaba el padron antes de esta transferencia» sin recorrer fechas, y lo que ata la '
    'version nueva al acto que la justifica (AC 2 y AC 5 de #52).';

COMMENT ON CONSTRAINT resolucion_determinacion_liquidacion_uq ON resolucion_determinacion IS
    'Una transferencia por liquidacion. Es el AC 6 de #52, y va en la base y no en un if porque '
    'dos peticiones simultaneas pasan las dos por cualquier comprobacion de Java.';

CREATE INDEX resolucion_determinacion_contribuyente_ix
    ON resolucion_determinacion (municipalidad_id, contribuyente_id, fecha);
CREATE INDEX resolucion_determinacion_predio_ix
    ON resolucion_determinacion (municipalidad_id, predio_id);

ALTER TABLE resolucion_determinacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE resolucion_determinacion FORCE  ROW LEVEL SECURITY;

CREATE POLICY resolucion_determinacion_tenant ON resolucion_determinacion
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- Sin UPDATE ni DELETE: nace sin ellos (§6), como `resolucion_gerencia` en V41.
-- No hace falta REVOKE porque no se conceden. Se deja escrito porque es una
-- decision, no un olvido, y porque el escaner de fuentes la incluye en
-- TABLAS_INMUTABLES por el mismo motivo.
GRANT SELECT, INSERT ON resolucion_determinacion TO sgtm_app;
GRANT SELECT          ON resolucion_determinacion TO sgtm_readonly;

-- ---------- 7. Sin correlativo propio, y hay que saber lo que cuesta ----------
--
--  El numero sale de `documento_emitido` (tipo 'RDF'), como en `acto_coactivo`
--  (V34) y `resolucion_gerencia` (V41): dos numeraciones para el mismo papel
--  divergen, y la que se lee en el documento es la que vale.
--
--  LO QUE ESO CUESTA, ANOTADO PARA QUIEN ESCRIBA LA PRUEBA DE CONCURRENCIA:
--  `DocumentoRepository.siguienteCorrelativo` es un `count(*) + 1`, de modo que
--  diez emisiones simultaneas calculan el MISMO numero y `documento_numero_uq`
--  rechaza a nueve. Eso serializa —el resultado es correcto—, pero por un motivo
--  que no es el que se quiere medir: con esa serializacion de por medio, una
--  prueba de «transferir dos veces no duplica» pasaria en verde aunque
--  `resolucion_determinacion_liquidacion_uq` no existiera. Es exactamente el
--  hueco que #44 destapo con `licencia_duplicado_uq`.
--
--  Por eso el AC 6 se comprueba en DOS pruebas: la de extremo a extremo, que
--  mide el resultado -una resolucion, una version de ficha, un juego de cargos-,
--  y una del repositorio que inserta diez filas que solo comparten
--  `liquidacion_id` y cuenta cuantas entran. La segunda es la unica que mide el
--  indice, y es la que se pone roja al degradarlo.
