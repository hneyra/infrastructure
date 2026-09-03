-- ============================================================================
--  V47 — Valores masivos de papeletas, constancias libres y los indices de los
--        padrones y resumenes de sanciones (#53, RF-066, RF-068, RF-073,
--        RF-074)
--
--  Cierra `sanciones`: la mitad de las 36 opciones de sus dos modulos son la
--  generacion masiva de valores y los reportes del area.
--
--  1. LA GENERACION MASIVA NO NUMERA NADA. Este es el punto entero del primer
--     criterio de aceptacion de #53: «la generacion masiva reutiliza la
--     numeracion de #37; no inventa un correlativo propio». Aqui NO hay ninguna
--     tabla `papeleta_valor_correlativo`, y no la hay a proposito: el numero de
--     una resolucion de multa sale de `valor_correlativo` (V26) por el mismo
--     UPSERT atomico que usa la emision individual, y `papeleta_masivo_item`
--     solo GUARDA el valor que se emitio. Dos numeraciones para el mismo papel
--     divergen —es la misma razon por la que `resolucion_gerencia.numero` es el
--     del documento emitido y no un correlativo propio (V41 §3)—.
--
--     Estas dos tablas son a las papeletas lo que `valor_masivo` y
--     `valor_masivo_item` (V27) son a los contribuyentes: la corrida y sus
--     candidatos. NO se reutilizan aquellas porque su candidato es un
--     CONTRIBUYENTE —`valor_masivo_item.contribuyente_id NOT NULL`, con su
--     unicidad por corrida— y el de una corrida de multas es una PAPELETA. Una
--     persona con tres papeletas produce tres resoluciones de multa, una por
--     acta, y en `valor_masivo_item` no cabria mas que una fila suya.
--
--  2. UN VALOR POR PAPELETA, PARA SIEMPRE. `papeleta_masivo_item_uq` impide
--     repetir la papeleta DENTRO de una corrida; `papeleta_valor_unico_uq` —un
--     indice unico PARCIAL sobre los GENERADO— impide que una SEGUNDA corrida
--     vuelva a emitir un valor por la misma papeleta. Es el patron exacto de
--     `expediente_valor_unico_uq` (V33) y `acto_rec1_uq` (V34), y el motivo es
--     el mismo: diez peticiones simultaneas pasan las diez por cualquier
--     comprobacion escrita en Java, y el resultado serian dos resoluciones de
--     multa cobrando la misma papeleta.
--
--  3. `papeleta_masivo_item` SI admite UPDATE, y `papeleta_masivo` no. Misma
--     division y mismo argumento que V27: el item es la marca de progreso de un
--     proceso interno (PENDIENTE -> GENERADO / SIN_DEUDA / NO_PROCEDE); el
--     criterio, una vez registrado, no se corrige.
--
--  4. LA CONSTANCIA LIBRE DE INFRACCIONES ES UN DOCUMENTO QUE SE ENTREGA, asi
--     que no se edita (regla 4): `constancia_libre` recibe SELECT e INSERT y
--     nada mas, igual que `resolucion_gerencia` (V41) y `acto_coactivo` (V34).
--     Guarda la FECHA A LA QUE SE VERIFICO que el vehiculo no debia nada
--     (regla 9, RNF-075): una constancia sin esa fecha no acredita nada, porque
--     «no tiene papeletas pendientes» es cierto o falso segun el dia.
--
--     Su `numero` es el del documento emitido, como en `resolucion_gerencia`.
--
--  5. LOS INDICES DE LOS PADRONES Y RESUMENES. `papeleta` solo tenia
--     `papeleta_obligado_ix` (V41). Los reportes de #53 la recorren por familia
--     y rango de fechas, por codigo de infraccion y por PREFIJO DE PLACA. El
--     ultimo lleva `text_pattern_ops` porque el prefijo se escribe como rango
--     con `~>=~` / `~<~` y no con LIKE: bajo RLS un LIKE 'AB%' no llega nunca
--     al indice (DAT-01 §0, tercer hallazgo), y estos son los operadores que el
--     rango recorre.
--
--  V6 le da RLS a toda tabla con `municipalidad_id NOT NULL` que exista AL
--  MOMENTO de correr V6 —ninguna de estas tres existia entonces—, asi que su
--  RLS y sus privilegios se declaran aqui, explicitos (CLAUDE.md, «Al agregar
--  una tabla»).
-- ============================================================================

-- ---------- 1. La corrida: el criterio congelado ----------
CREATE TABLE papeleta_masivo (
    municipalidad_id  bigint       NOT NULL REFERENCES municipalidad(id),
    id                bigint       GENERATED ALWAYS AS IDENTITY,
    -- Que mitad de `papeleta` se recorre. Nunca las dos: `transito_valores` y
    -- `adm_valores` son dos opciones del menu con dos permisos distintos, y una
    -- corrida que las cruzara emitiria valores de transito a quien solo puede
    -- emitir los administrativos.
    familia           varchar(15)  NOT NULL
        CHECK (familia IN ('TRANSITO', 'ADMINISTRATIVA')),
    -- El rango de fechas de infraccion que entra en la corrida.
    desde             date         NOT NULL,
    hasta             date         NOT NULL,
    -- La fecha a la que se evalua la deuda de cada candidato, CONGELADA al
    -- registrar la corrida (RNF-075). Reanudar la generacion tres dias despues
    -- tiene que emitir exactamente lo mismo que si hubiera terminado el primer
    -- dia; con `now()` no lo haria.
    fecha_criterio    date         NOT NULL,
    origen            varchar(12)  NOT NULL CHECK (origen IN ('SELECCION', 'RANGO')),
    total_candidatos  integer      NOT NULL CHECK (total_candidatos >= 0),
    usuario_registro  varchar(60)  NOT NULL,
    fecha_registro    timestamptz  NOT NULL,
    observacion       varchar(500) NOT NULL,
    CONSTRAINT papeleta_masivo_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT papeleta_masivo_rango_ck CHECK (desde <= hasta)
);

COMMENT ON TABLE papeleta_masivo IS
    'El criterio de una generacion masiva de valores por papeletas (#53, RF-066, RF-073), '
    'congelado al registrarlo: reanudar la generacion no vuelve a evaluar «hoy», evalua '
    'fecha_criterio. No numera nada; el correlativo sale de valor_correlativo (V26).';

COMMENT ON COLUMN papeleta_masivo.fecha_criterio IS
    'La fecha a la que se mira la deuda y la exigibilidad de cada papeleta candidata (regla 9). '
    'Congelada: dos ejecuciones de la misma corrida tienen que ver lo mismo.';

ALTER TABLE papeleta_masivo ENABLE ROW LEVEL SECURITY;
ALTER TABLE papeleta_masivo FORCE  ROW LEVEL SECURITY;

CREATE POLICY papeleta_masivo_tenant ON papeleta_masivo
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- Sin UPDATE ni DELETE: el criterio registrado no se corrige, igual que
-- `valor_masivo` (V27).
GRANT SELECT, INSERT ON papeleta_masivo TO sgtm_app;
GRANT SELECT          ON papeleta_masivo TO sgtm_readonly;

-- ---------- 2. El candidato ----------
CREATE TABLE papeleta_masivo_item (
    municipalidad_id  bigint      NOT NULL,
    id                bigint      GENERATED ALWAYS AS IDENTITY,
    corrida_id        bigint      NOT NULL,
    papeleta_id       bigint      NOT NULL,
    estado            varchar(12) NOT NULL DEFAULT 'PENDIENTE'
        CHECK (estado IN ('PENDIENTE', 'GENERADO', 'SIN_DEUDA', 'NO_PROCEDE')),
    -- El valor emitido. Su NUMERO se copia junto al identificador porque es lo
    -- que el padron imprime y lo que el operador teclea; releerlo por el puerto
    -- publico de `valores` para cada fila de un padron de miles seria una
    -- consulta por fila.
    valor_id          bigint,
    valor_numero      varchar(20),
    -- Por que no procedio, cuando no procedio: sin resolucion que ordene la
    -- cobranza, sin notificar, o con el plazo todavia corriendo. Un unico «no
    -- procede» dejaria a quien opera adivinando cual de las tres le falta.
    motivo            varchar(200),
    fecha_procesado   timestamptz,
    CONSTRAINT papeleta_masivo_item_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT papeleta_masivo_item_corrida_fk FOREIGN KEY (municipalidad_id, corrida_id)
        REFERENCES papeleta_masivo (municipalidad_id, id),
    CONSTRAINT papeleta_masivo_item_papeleta_fk FOREIGN KEY (municipalidad_id, papeleta_id)
        REFERENCES papeleta (municipalidad_id, id),
    -- Una papeleta entra una sola vez por corrida.
    CONSTRAINT papeleta_masivo_item_uq UNIQUE (municipalidad_id, corrida_id, papeleta_id),
    -- Solo un item GENERADO lleva valor; uno que no lo esta, nunca. Y el
    -- identificador y el numero van juntos o no van.
    CONSTRAINT papeleta_masivo_item_valor_ck CHECK (
        (estado = 'GENERADO' AND valor_id IS NOT NULL AND valor_numero IS NOT NULL)
        OR (estado <> 'GENERADO' AND valor_id IS NULL AND valor_numero IS NULL)),
    -- El motivo va con NO_PROCEDE y solo con el.
    CONSTRAINT papeleta_masivo_item_motivo_ck CHECK (
        (estado = 'NO_PROCEDE') = (motivo IS NOT NULL))
);

ALTER TABLE papeleta_masivo_item ADD CONSTRAINT papeleta_masivo_item_valor_fk
    FOREIGN KEY (municipalidad_id, valor_id)
    REFERENCES valor (municipalidad_id, id) NOT VALID;

-- LA GUARDA DE LA IDEMPOTENCIA. Un indice unico PARCIAL sobre los GENERADO: una
-- papeleta tiene como mucho UN valor emitido, en toda la vida y en todas las
-- corridas. Sin el, relanzar la generacion con una corrida nueva volveria a
-- emitir —la comprobacion en Java caza el reintento de UNA corrida, no la
-- segunda corrida, y menos aun diez hilos simultaneos—.
CREATE UNIQUE INDEX papeleta_valor_unico_uq
    ON papeleta_masivo_item (municipalidad_id, papeleta_id)
    WHERE estado = 'GENERADO';

-- El recorrido de la etapa «generacion»: los PENDIENTE de una corrida, por id.
CREATE INDEX papeleta_masivo_item_pendientes_ix
    ON papeleta_masivo_item (municipalidad_id, corrida_id, estado, id);

COMMENT ON TABLE papeleta_masivo_item IS
    'Una papeleta candidata de una corrida masiva (#53), con su estado. La generacion recorre los '
    'PENDIENTE; no hay tabla de progreso aparte. papeleta_valor_unico_uq garantiza un valor por '
    'papeleta aunque se relance la corrida o se lance otra.';

COMMENT ON INDEX papeleta_valor_unico_uq IS
    'Un valor por papeleta, para siempre (AC 6 de #53). Mismo patron y mismo motivo que '
    'expediente_valor_unico_uq (V33): la comprobacion en Java no sobrevive a diez hilos.';

ALTER TABLE papeleta_masivo_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE papeleta_masivo_item FORCE  ROW LEVEL SECURITY;

CREATE POLICY papeleta_masivo_item_tenant ON papeleta_masivo_item
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- Este SI se actualiza en el sitio: es el estado de un proceso interno, no un
-- acto administrativo. Mismo argumento que V27 dejo escrito para
-- valor_masivo_item.
GRANT SELECT, INSERT, UPDATE ON papeleta_masivo_item TO sgtm_app;
GRANT SELECT                 ON papeleta_masivo_item TO sgtm_readonly;

-- ---------- 3. La constancia libre de infracciones ----------
CREATE TABLE constancia_libre (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    -- El numero del documento emitido, como en `resolucion_gerencia` (V41 §3) y
    -- `acto_coactivo` (V34). No es un correlativo propio.
    numero           varchar(40)  NOT NULL,
    documento_id     bigint       NOT NULL,
    placa            varchar(10)  NOT NULL,
    vehiculo_id      bigint,
    solicitante_id   bigint,
    -- LA FECHA A LA QUE SE VERIFICO (regla 9, RNF-075). No es la de emision y
    -- no puede faltar: «no registra papeletas pendientes» es cierto o falso
    -- segun el dia, y una constancia que no dice a que dia acredita no acredita
    -- nada.
    verificada_al    date         NOT NULL,
    fecha_emision    date         NOT NULL,
    usuario_registro varchar(60)  NOT NULL,
    fecha_registro   timestamptz  NOT NULL,
    observacion      varchar(500) NOT NULL,
    CONSTRAINT constancia_libre_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT constancia_libre_numero_uq UNIQUE (municipalidad_id, numero),
    -- Una constancia, un documento; un documento, una constancia.
    CONSTRAINT constancia_libre_documento_uq UNIQUE (municipalidad_id, documento_id),
    CONSTRAINT constancia_libre_vehiculo_fk FOREIGN KEY (municipalidad_id, vehiculo_id)
        REFERENCES vehiculo (municipalidad_id, id),
    CONSTRAINT constancia_libre_solicitante_fk FOREIGN KEY (municipalidad_id, solicitante_id)
        REFERENCES contribuyente (municipalidad_id, id)
);

ALTER TABLE constancia_libre ADD CONSTRAINT constancia_libre_documento_fk
    FOREIGN KEY (municipalidad_id, documento_id)
    REFERENCES documento_emitido (municipalidad_id, id) NOT VALID;

CREATE INDEX constancia_libre_placa_ix ON constancia_libre (municipalidad_id, placa);
CREATE INDEX constancia_libre_fecha_ix ON constancia_libre (municipalidad_id, fecha_emision);
CREATE INDEX constancia_libre_usuario_ix
    ON constancia_libre (municipalidad_id, usuario_registro, fecha_emision);

COMMENT ON TABLE constancia_libre IS
    'La constancia con que la municipalidad acredita que un vehiculo no registra papeletas de '
    'transito pendientes (#53, RF-068). Solo se agrega: se entrega al administrado, asi que una '
    'equivocada se deja sin efecto con otra, nunca editandola (regla 4).';

COMMENT ON COLUMN constancia_libre.verificada_al IS
    'El dia al que se comprobo que no habia papeleta pendiente (regla 9, RNF-075). Sin el, la '
    'constancia afirma algo que no se puede fechar.';

ALTER TABLE constancia_libre ENABLE ROW LEVEL SECURITY;
ALTER TABLE constancia_libre FORCE  ROW LEVEL SECURITY;

CREATE POLICY constancia_libre_tenant ON constancia_libre
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

GRANT SELECT, INSERT ON constancia_libre TO sgtm_app;
GRANT SELECT          ON constancia_libre TO sgtm_readonly;

-- ---------- 4. Los indices de los padrones y los resumenes ----------
--
--  El padron y los tres resumenes recorren `papeleta` por familia y rango de
--  fecha de infraccion; el resumen por codigo, por su codigo; el resumen por
--  iniciales, por prefijo de placa.
CREATE INDEX papeleta_familia_fecha_ix
    ON papeleta (municipalidad_id, familia, fecha_infraccion);

CREATE INDEX papeleta_codigo_ix
    ON papeleta (municipalidad_id, codigo_infraccion_id, fecha_infraccion);

-- text_pattern_ops, y no un btree normal: el prefijo de placa se escribe como
-- rango con `~>=~` / `~<~` (DAT-01 §0, tercer hallazgo), y esta es la clase de
-- operadores que ese rango recorre. Con el btree por omision el plan degradaria
-- a Seq Scan sobre el padron entero de papeletas.
CREATE INDEX papeleta_placa_prefijo_ix
    ON papeleta (municipalidad_id, placa text_pattern_ops);

COMMENT ON INDEX papeleta_placa_prefijo_ix IS
    'El resumen por iniciales de placa (RF-073) busca por prefijo, y bajo RLS un LIKE no llega al '
    'indice: se escribe como rango con ~>=~ / ~<~, que es lo que esta clase de operadores recorre.';
