-- ============================================================================
--  V60 — La muestra de un programa de fiscalizacion: la pieza de la que salen
--        la grilla Y los tres identificadores del acta (#481, AC 2 de #431)
--
--  ---------------------------------------------------------------------------
--  0. POR QUE LAS DOS MITADES DEL AC 2 SON LA MISMA PIEZA
--  ---------------------------------------------------------------------------
--
--  `fisc_predial` -el acta de inspeccion- no declara ni filtros ni tabla en su
--  catalogo: solo tres secciones, y los tres campos que corresponden a los
--  identificadores que `ActaPredialController` exige -«Programa», «Código
--  predial», «Contribuyente»- son los tres de SOLO LECTURA. Dentro de esa
--  pantalla no hay donde buscar nada: el acta solo se puede abrir desde una
--  fila ya resuelta.
--
--  Esa fila es la muestra. Sin ella no hay de donde salgan los tres
--  identificadores, y con ella salen los tres de golpe.
--
--  ---------------------------------------------------------------------------
--  1. LA MUESTRA SE GUARDA, Y NO SE RECALCULA
--  ---------------------------------------------------------------------------
--
--  Se decidio guardarla, no derivarla en cada lectura, y el motivo es la
--  exclusion: una muestra nueva no puede volver a sortear un predio que otro
--  programa abierto ya se llevo, y para saber cuales se llevo hay que tenerlos
--  escritos. Derivarla haria imposible esa pregunta.
--
--  Guardarla tiene ademas una consecuencia que se busca: contesta «¿por que me
--  toco a mi?» con la fila del dia del sorteo -su condicion, sus dos areas y su
--  fecha-, sin necesidad de una semilla reproducible ni de recalcular contra un
--  padron que desde entonces cambio.
--
--  Y una que hay que decir: la muestra es una FOTO. Un predio que regulariza
--  despues del sorteo sigue diciendo SUBVALUADOR hasta que alguien lo visite.
--  Por eso lleva `fecha_sorteo` y la pantalla la muestra (regla 9).
--
--  ---------------------------------------------------------------------------
--  2. LO QUE NO SE GUARDA, Y POR QUE
--  ---------------------------------------------------------------------------
--
--  El «Estado» de la fila -si el predio ya se visito- NO tiene columna: se
--  DERIVA de si existe un acta de ese predio en ese programa. Es el reparto de
--  V41 §2 y §5 con el descargo y el internamiento, de V33 con el expediente y
--  de V32 con el turno, y el motivo es el de siempre: guardarlo dejaria dos
--  verdades sobre la misma fila, y la que se lee en pantalla seria la que nadie
--  recalculo.
--
--  El TAMANO de la muestra tampoco: es el numero de filas. Un tope -«los N de
--  mayor riesgo»- exigiria un orden por riesgo, y `CondicionFiscalizada` es una
--  etiqueta, no una escala; inventar ese orden es inventar a quien se fiscaliza.
-- ============================================================================

-- ---------- 1. Los parametros del programa ----------
--
--  La muestra se deriva de una pregunta -que ejercicio, que sector, que
--  condicion busca y quien la fiscaliza- y hasta hoy esa pregunta no se
--  guardaba en ninguna parte: `programa_fiscalizacion` (V4) tiene codigo,
--  descripcion, tipo, dos fechas y estado, y nada mas. Sin ella el programa no
--  determina su muestra, y «¿por que me toco a mi?» no tiene respuesta.
--
--  Las cuatro nacen NULABLES a proposito. No se puede afirmar que la tabla este
--  vacia en `stg` ni en `prod`, y un NOT NULL sin valor por omision rompe la
--  migracion sobre cualquier fila anterior. Un programa sin parametros no puede
--  generar muestra: `GenerarMuestra` falla NOMBRANDO el que falte, que es el
--  patron de #51, #72 y #399 y lo unico honesto que se puede hacer con un
--  programa registrado antes de esta migracion.

ALTER TABLE programa_fiscalizacion
    ADD COLUMN ejercicio     ejercicio,
    ADD COLUMN sector_codigo varchar(10),
    ADD COLUMN criterio      varchar(15)
        CHECK (criterio IN ('CONFORME','OMISO','SUBVALUADOR','USO_DISTINTO','NO_UBICADO')),
    ADD COLUMN fiscalizador  varchar(60);

COMMENT ON COLUMN programa_fiscalizacion.ejercicio IS
    'El ejercicio que el programa examina. NO se deduce del anio de fecha_inicio: un programa '
    'abierto en enero de 2027 puede estar fiscalizando 2025, y deducirlo diria otra cosa que el '
    'filtro de la pantalla (#457).';

COMMENT ON COLUMN programa_fiscalizacion.sector_codigo IS
    'El sector del padron sobre el que se sortea la muestra, o NULL para todo el distrito. Es el '
    'codigo de sector.codigo (V1), no su identificador: es lo que PadronDePredios.porSector recibe.';

COMMENT ON COLUMN programa_fiscalizacion.criterio IS
    'La CondicionFiscalizada que se busca. El CHECK reproduce el enumerado entero, que es lo que la '
    'columna guarda; la pantalla ofrece SOLO las tres que un cruce de gabinete puede producir '
    '-OMISO, SUBVALUADOR, CONFORME-: USO_DISTINTO exige el uso declarado, que DeteccionDeOmisos no '
    'resuelve, y NO_UBICADO no es un criterio de seleccion por definicion (no se puede programar la '
    'visita a los predios que no se van a encontrar).';

COMMENT ON COLUMN programa_fiscalizacion.fiscalizador IS
    'Quien tiene asignado el programa. Es de donde el acta toma SU fiscalizador: el catalogo lo '
    'dibuja de solo lectura, y un campo de solo lectura lo llena el sistema (RNF-080).';

-- ---------- 2. La muestra ----------

CREATE TABLE programa_muestra (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    programa_id      bigint       NOT NULL,
    predio_id        bigint       NOT NULL,
    -- El codigo del predio, COPIADO: es lo que la grilla dibuja en la columna
    -- «Predio», y forma parte de la foto igual que la condicion. Copiarlo evita
    -- ademas que la lectura tenga que volver al padron por una columna.
    cod_ref_catastral cod_catastral NOT NULL,
    contribuyente_id bigint       NOT NULL,
    -- La condicion del dia del sorteo, COPIADA. Es la respuesta a «¿por que me
    -- toco a mi?», y releerla hoy daria la de hoy.
    condicion        varchar(15)  NOT NULL CHECK (condicion IN
        ('CONFORME','OMISO','SUBVALUADOR','USO_DISTINTO','NO_UBICADO')),
    -- Las dos superficies que la condicion comparo, tambien copiadas. Las dos
    -- son AREA DE TERRENO: `LectorDeFichas.areaDeLaVersion` devuelve
    -- `ficha.areaTerreno()` y `DeteccionDeOmisos` compara contra
    -- `predio.areaTerreno()`. Guardar aqui un area construida las haria
    -- incomparables sin que ninguna cifra pareciera mal.
    area_catastral   area_m2,
    area_declarada   area_m2,
    sector_codigo    varchar(10),
    -- A que dia se sorteo. La muestra es una foto y toda cifra lleva su fecha
    -- (regla 9, RNF-075).
    fecha_sorteo     date         NOT NULL,
    observacion      varchar(500) NOT NULL,
    usuario_registro varchar(60)  NOT NULL,
    -- Sin DEFAULT now(), como `certificado` (V51): la escribe el caso de uso
    -- con el MISMO reloj que resuelve `fecha_sorteo`, de modo que las dos no
    -- pueden divergir. Con el DEFAULT, una corrida larga fecharia cada fila en
    -- un instante distinto del sorteo que dice describir.
    fecha_registro   timestamptz  NOT NULL,
    CONSTRAINT programa_muestra_pk PRIMARY KEY (municipalidad_id, id),
    -- Un predio una sola vez por programa. Sortearlo dos veces produciria dos
    -- filas identicas y dos visitas al mismo sitio.
    CONSTRAINT programa_muestra_uq UNIQUE (municipalidad_id, programa_id, predio_id),
    CONSTRAINT programa_muestra_programa_fk FOREIGN KEY (municipalidad_id, programa_id)
        REFERENCES programa_fiscalizacion (municipalidad_id, id),
    -- Las dos foraneas a tablas que ya tienen filas van NOT VALID, como las de
    -- V39 y por lo mismo (DAT-01 §0, cuarto hallazgo): validarlas es una
    -- consulta y el migrador corre sin contexto de tenant. NOT VALID sigue
    -- comprobando cada INSERT, que es lo que importa de aqui en adelante.
    CONSTRAINT programa_muestra_predio_fk FOREIGN KEY (municipalidad_id, predio_id)
        REFERENCES predio (municipalidad_id, id) NOT VALID,
    CONSTRAINT programa_muestra_contribuyente_fk FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id) NOT VALID
);

COMMENT ON TABLE programa_muestra IS
    'Los predios que un programa de fiscalizacion sorteo para inspeccionar (#481, RF-050). SOLO SE '
    'AGREGA: es el acto de programar, no el estado de un proceso. Un predio sale de la muestra '
    'marcandolo -con su acta-, nunca borrandolo (RNF-051, regla 4). sgtm_app no recibe UPDATE ni '
    'DELETE sobre esta tabla.';

COMMENT ON COLUMN programa_muestra.condicion IS
    'La CondicionFiscalizada que DeteccionDeOmisos calculo el dia del sorteo, copiada. Es lo que la '
    'grilla dibuja en la columna «Riesgo» y lo que contesta por que este predio entro al programa.';

COMMENT ON COLUMN programa_muestra.fecha_sorteo IS
    'El dia al que se resolvieron el padron, la titularidad y la ficha vigentes. La muestra es una '
    'foto: un predio que regulariza despues sigue aqui con la condicion de ese dia hasta que '
    'alguien lo visite.';

-- La grilla lee la muestra de UN programa, y la exclusion pregunta por UN
-- predio en cualquier programa abierto. Dos indices, uno por cada pregunta.
CREATE INDEX programa_muestra_programa_ix
    ON programa_muestra (municipalidad_id, programa_id, predio_id);

CREATE INDEX programa_muestra_predio_ix
    ON programa_muestra (municipalidad_id, predio_id);

ALTER TABLE programa_muestra ENABLE ROW LEVEL SECURITY;
ALTER TABLE programa_muestra FORCE  ROW LEVEL SECURITY;

CREATE POLICY programa_muestra_tenant ON programa_muestra
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- SELECT e INSERT, y nada mas: ver el comentario de la tabla.
GRANT SELECT, INSERT ON programa_muestra TO sgtm_app;
GRANT SELECT         ON programa_muestra TO sgtm_readonly;

-- ---------- 3. La unicidad del acta, con los dos nulos ----------
--
--  `acta_fisc_version_uq` (V4) llavea el acta por CONTRIBUYENTE:
--
--      UNIQUE (municipalidad_id, programa_id, contribuyente_id, version)
--
--  Con la muestra por predio eso se rompe solo: un contribuyente con dos
--  predios sorteados no puede tener dos actas en version 1 -la segunda choca-,
--  y el sistema le negaria al fiscalizador registrar la segunda visita.
--
--  Y NULLS NOT DISTINCT no es decorativo, que es LITERALMENTE lo que V39 ya
--  escribio para `liquidacion_detalle`: un acta vehicular deja `predio_id` en
--  NULL, y con la semantica por omision -NULLS DISTINCT- dos actas vehiculares
--  del mismo programa, contribuyente y version NO chocarian, porque PostgreSQL
--  considera distintos dos NULL. La unicidad no protegeria nada justo en el
--  caso que ocurre siempre. V57 lo repitio para el tramo abierto de la
--  depreciacion; esta es la tercera vez.

ALTER TABLE acta_fiscalizacion DROP CONSTRAINT acta_fisc_version_uq;

ALTER TABLE acta_fiscalizacion ADD CONSTRAINT acta_fisc_version_uq
    UNIQUE NULLS NOT DISTINCT
    (municipalidad_id, programa_id, contribuyente_id, predio_id, vehiculo_id, version);

COMMENT ON CONSTRAINT acta_fisc_version_uq ON acta_fiscalizacion IS
    'Una version por acta y por UNIDAD, no por contribuyente (V60). Declara NULLS NOT DISTINCT: un '
    'acta vehicular deja predio_id en NULL, y con la semantica por omision la unicidad no '
    'protegeria nada en el caso que ocurre siempre.';
