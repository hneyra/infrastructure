-- ============================================================================
--  V35 — Las costas del procedimiento coactivo (#42, RF-104)
--
--  #40 dejo la carpeta, #41 el procedimiento. Lo que falta es lo que el
--  procedimiento CUESTA: las costas y gastos que el art. 20 de la Ley 26979
--  manda liquidar y cobrar al obligado, acto por acto, segun el arancel
--  aprobado.
--
--  El fraccionamiento coactivo (RF-105) y las dos consultas (RF-107) NO tocan
--  el esquema: el convenio coactivo es el MISMO mecanismo de #35 -mismo
--  `convenio`, mismo `convenio_deuda` con su `fase_origen`, mismo
--  `convenio_movimiento`- y las consultas leen lo que ya hay. Que esta
--  migracion sea solo de costas es la constancia de esa reutilizacion.
--
--  1. `costa_procesal` (V3) SIRVE COMO LINEA, NO COMO TODO. V3 la nacio con
--     `expediente_id`, `concepto`, `monto`, `fecha` y `arancel_fuente`: eso es
--     una fila del bloque «Costas procesales» de la pantalla
--     `costas_procesales`, y esta bien. Lo que V3 no tiene es
--
--       - LA CABECERA. La pantalla numera «Nro. Liquidacion», la fecha, el
--         contribuyente y su observacion, y la grilla lista liquidaciones, no
--         lineas sueltas. Sin cabecera, «anular la liquidacion 000123» no
--         tiene sujeto.
--       - QUE ACTO se liquida. La costa se devenga POR ACTO -una REC-1, un
--         embargo, una tasacion-, y sin la columna nada impide liquidar dos
--         veces el mismo acto, que es cobrar dos veces lo mismo.
--       - DE QUE CONJUNTO SELLADO salio el arancel (ARQ-09 §3). Sin el,
--         revisar dentro de dos anios por que una costa vale lo que vale
--         resolveria «el vigente» y podria dar otra cifra, sin avisar.
--       - EL TRIBUTO al que se imputa en el libro. La costa no es un apunte
--         interno del expediente: es un CARGO de la cuenta corriente, y hay
--         que saber contra que obligacion.
--
--     Y le sobra el privilegio de UPDATE, que se retira abajo.
--
--  2. LA COSTA NO ES UNA COLUMNA DEL EXPEDIENTE. Esto es lo central de #42 y
--     conviene dejarlo escrito donde no se pueda ignorar: `expediente_coactivo`
--     no gana ninguna columna `costas`. Si la ganara, habria dos verdades sobre
--     cuanto se debe -el libro y esa columna- y la que se cobrase en ventanilla
--     seria la del libro. Lo que la liquidacion hace es ASENTAR un cargo de
--     concepto GASTO en fase COACTIVA, por el puerto publico de
--     `cuentacorriente`, y `DeudaDelExpediente.costas` se RELEE de ahi a la
--     fecha que se pida (regla 9). Estas tablas guardan el ACTO administrativo
--     -que se liquido, por que acto, con que arancel- y no el saldo.
--
--  3. `costa_obligacion`: DE QUE EXPEDIENTE SON LAS COSTAS DE ESA OBLIGACION.
--     Es la tabla menos evidente de esta migracion y la que evita un defecto
--     silencioso.
--
--     El libro identifica una obligacion por (contribuyente, tributo,
--     ejercicio, periodo, unidad) -`saldo_uq`, V2-. El numero de expediente NO
--     esta ahi, y no puede estarlo: `referencia_externa` no participa de la
--     clave y los abonos ni siquiera la copian (V29). Consecuencia: si dos
--     expedientes del MISMO contribuyente liquidaran costas del mismo tributo
--     en el mismo ejercicio, el libro las contaria como UNA obligacion, y la
--     columna «Costas S/» de la grilla mostraria la misma cifra en las dos
--     filas -la suma de las dos- sin que nada fallara.
--
--     Se cierra con una tabla de UNA fila por obligacion de costas, cuya clave
--     primaria es exactamente la del libro y cuyo valor es el expediente dueno.
--     Un segundo expediente que intente liquidar sobre esa misma obligacion
--     choca contra la clave y la aplicacion lo explica nombrando al dueno. Es
--     preferible fallar en voz alta a repartir una cifra que nadie puede
--     auditar; y si algun dia hace falta admitirlo, la decision se toma
--     mirando esta tabla y no descubriendo el sintoma en una grilla.
--
--  4. LA LIQUIDACION NO SE EDITA. Mismo trato que el recibo (V30), el convenio
--     (V31), el turno (V32), el expediente (V33) y el acto coactivo (V34): la
--     liquidacion de costas se notifica al obligado y su cargo ya esta en el
--     libro. Corregirla en la base dejaria el papel y el sistema diciendo
--     cosas distintas. `REVOKE UPDATE` sobre las tres, y las tres entran en
--     `TABLAS_INMUTABLES` del escaner de fuentes.
--
--     Por eso tampoco hay columna `estado`: diria ACTIVA para siempre, que es
--     lo que V30..V34 retiraron cinco veces. Que una liquidacion este cancelada
--     se DERIVA del libro -su obligacion ya no debe nada a la fecha-, que es
--     donde el hecho ocurre.
--
--  5. NINGUNA CIFRA AQUI. El arancel de costas por acto es un valor normativo
--     de ordenanza local (D-02c, #193) y no vive ni en el codigo (regla 5) ni
--     en esta migracion: entra como parametro `ARANCEL_COSTA:<TIPO_DE_ACTO>`
--     del conjunto sellado. Sin el parametro, liquidar FALLA nombrando la
--     llave. Lo que estas tablas guardan es de que conjunto salio y con que
--     documento fuente.
--
--  V6 le da RLS a toda tabla con municipalidad_id NOT NULL que existiera AL
--  MOMENTO de correr V6. `costa_procesal` ya la tiene de ahi; las tres tablas
--  nuevas no existian, asi que su RLS y sus privilegios se declaran aqui,
--  explicitos (CLAUDE.md, "Al agregar una tabla").
--
--  Las columnas NOT NULL se agregan SIN valor por omision a proposito, igual
--  que en V29, V31 y V34: ninguna linea de codigo ha escrito nunca en
--  `costa_procesal` -no tenia repositorio-, asi que esta vacia y el ALTER pasa.
--  Si en algun ambiente NO lo estuviera, PostgreSQL para la migracion nombrando
--  la columna, que es mejor que inventar un dato.
-- ============================================================================

-- ---------- 1. La cabecera de la liquidacion ----------
CREATE TABLE liquidacion_costas (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    -- El numero impreso: `LC-2026-000123`. Es el que la pantalla llama «Nro.
    -- Liquidacion» y el que el obligado ve en el papel.
    numero           varchar(20)  NOT NULL,
    ejercicio        ejercicio    NOT NULL,
    correlativo      bigint       NOT NULL CHECK (correlativo > 0),
    expediente_id    bigint       NOT NULL,
    -- Denormalizado desde el expediente a proposito: es la mitad de la clave
    -- de la obligacion que el cargo crea en el libro, y tenerlo aqui permite
    -- releer lo liquidado sin cruzar con `expediente_coactivo`.
    contribuyente_id bigint       NOT NULL,
    -- A que obligacion del libro se imputa: la otra mitad de la clave.
    tributo          varchar(20)  NOT NULL,
    fecha            date         NOT NULL,
    -- El conjunto sellado que dio los aranceles (ARQ-09 §3). No «los de 2026»:
    -- ESE conjunto.
    conjunto_id      bigint       NOT NULL,
    -- La suma de sus lineas, congelada. La base lo comprueba en la aplicacion,
    -- no aqui: un CHECK no puede sumar filas de otra tabla.
    total            dinero       NOT NULL CHECK (total > 0),
    usuario_registro varchar(60)  NOT NULL,
    fecha_registro   timestamptz  NOT NULL,
    observacion      varchar(500) NOT NULL,
    CONSTRAINT liquidacion_costas_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT liquidacion_costas_numero_uq UNIQUE (municipalidad_id, numero),
    CONSTRAINT liquidacion_costas_correlativo_uq
        UNIQUE (municipalidad_id, ejercicio, correlativo),
    CONSTRAINT liquidacion_costas_expediente_fk
        FOREIGN KEY (municipalidad_id, expediente_id)
        REFERENCES expediente_coactivo (municipalidad_id, id) NOT VALID,
    CONSTRAINT liquidacion_costas_contribuyente_fk
        FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id) NOT VALID
);

COMMENT ON TABLE liquidacion_costas IS
    'La liquidacion de costas y gastos de un expediente coactivo (#42, RF-104): que actos se '
    'liquidaron, con que arancel sellado y por cuanto. NO guarda saldo: su importe se asienta '
    'como CARGO de concepto GASTO en fase COACTIVA, y cuanto queda pendiente lo dice el libro '
    'a la fecha que se pida (regla 9). Solo se agrega: no tiene columna de estado porque diria '
    'ACTIVA para siempre, igual que las que V30..V34 retiraron.';

COMMENT ON COLUMN liquidacion_costas.conjunto_id IS
    'El conjunto sellado del que salieron los aranceles por acto (ARQ-09 §3). Recalcular esta '
    'liquidacion en 2037 recupera ESTE conjunto, no «los parametros de 2027»: resolver por '
    'ejercicio daria otro arancel sin que nada falle.';

CREATE INDEX liquidacion_costas_expediente_ix
    ON liquidacion_costas (municipalidad_id, expediente_id, fecha);
CREATE INDEX liquidacion_costas_contribuyente_ix
    ON liquidacion_costas (municipalidad_id, contribuyente_id);

ALTER TABLE liquidacion_costas ENABLE ROW LEVEL SECURITY;
ALTER TABLE liquidacion_costas FORCE  ROW LEVEL SECURITY;

CREATE POLICY liquidacion_costas_tenant ON liquidacion_costas
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

GRANT SELECT, INSERT ON liquidacion_costas TO sgtm_app;
GRANT SELECT          ON liquidacion_costas TO sgtm_readonly;

-- ---------- 2. La linea: una costa, un acto ----------
ALTER TABLE costa_procesal
    -- De que liquidacion es. V3 colgaba la costa del expediente y nada mas, y
    -- asi «la liquidacion 000123» no tenia sujeto.
    ADD COLUMN liquidacion_id      bigint      NOT NULL,
    -- QUE acto se liquida. Es lo que hace que liquidar dos veces el mismo acto
    -- sea imposible, y no un `if`.
    ADD COLUMN acto_id             bigint      NOT NULL,
    -- El tipo del acto, copiado: la fila tiene que explicarse sola dos anios
    -- despues sin cruzar con `acto_coactivo`, igual que `valor_movimiento`
    -- copia su exigibilidad (V28).
    ADD COLUMN acto_tipo           varchar(20) NOT NULL,
    -- A que obligacion del libro se imputo esta linea. La misma de la
    -- cabecera; se repite porque es lo que hace legible el detalle.
    ADD COLUMN tributo             varchar(20) NOT NULL,
    -- El conjunto sellado del que salio ESTE arancel.
    ADD COLUMN arancel_conjunto_id bigint      NOT NULL;

-- V3 admitia monto = 0. Una costa de cero no es una costa: o el acto devenga
-- arancel o no se liquida.
ALTER TABLE costa_procesal ADD CONSTRAINT costa_monto_ck CHECK (monto > 0);

ALTER TABLE costa_procesal ADD CONSTRAINT costa_liquidacion_fk
    FOREIGN KEY (municipalidad_id, liquidacion_id)
    REFERENCES liquidacion_costas (municipalidad_id, id) NOT VALID;

ALTER TABLE costa_procesal ADD CONSTRAINT costa_acto_fk
    FOREIGN KEY (municipalidad_id, acto_id)
    REFERENCES acto_coactivo (municipalidad_id, id) NOT VALID;

-- UN ACTO SE LIQUIDA UNA VEZ. Lo decide la base y no una consulta previa: dos
-- peticiones simultaneas pasan las dos por cualquier comprobacion escrita en
-- Java, y el obligado acabaria pagando dos veces la costa de la misma REC.
CREATE UNIQUE INDEX costa_acto_uq ON costa_procesal (municipalidad_id, acto_id);

CREATE INDEX costa_liquidacion_ix ON costa_procesal (municipalidad_id, liquidacion_id);

COMMENT ON TABLE costa_procesal IS
    'Una linea de la liquidacion de costas: el acto que la devenga, el arancel que se le '
    'aplico y de que conjunto sellado salio (#42, RF-104). Solo se agrega: V35 le retira el '
    'UPDATE. Una costa mal liquidada no se corrige en el sitio -su cargo ya esta en el libro-: '
    'se reversa el asiento y se liquida de nuevo.';

COMMENT ON COLUMN costa_procesal.arancel_fuente IS
    'De donde salio la cifra: la llave del parametro sellado y el documento fuente que la '
    'sustenta (ADR-0007). Nunca un numero escrito en el codigo (regla 5, D-02c, #193).';

-- ---------- 3. De que expediente son las costas de esa obligacion ----------
CREATE TABLE costa_obligacion (
    municipalidad_id bigint      NOT NULL REFERENCES municipalidad(id),
    contribuyente_id bigint      NOT NULL,
    tributo          varchar(20) NOT NULL,
    ejercicio        ejercicio   NOT NULL,
    expediente_id    bigint      NOT NULL,
    -- La clave es EXACTAMENTE la de una obligacion del libro sin unidad ni
    -- periodo (`saldo_uq`, V2). Que sea la clave primaria es lo que impide que
    -- dos expedientes compartan obligacion de costas sin que nadie lo note.
    CONSTRAINT costa_obligacion_pk
        PRIMARY KEY (municipalidad_id, contribuyente_id, tributo, ejercicio),
    CONSTRAINT costa_obligacion_expediente_fk
        FOREIGN KEY (municipalidad_id, expediente_id)
        REFERENCES expediente_coactivo (municipalidad_id, id) NOT VALID,
    CONSTRAINT costa_obligacion_contribuyente_fk
        FOREIGN KEY (municipalidad_id, contribuyente_id)
        REFERENCES contribuyente (municipalidad_id, id) NOT VALID
);

COMMENT ON TABLE costa_obligacion IS
    'Que expediente coactivo es dueno de la obligacion de costas de un contribuyente, tributo '
    'y ejercicio (#42). Existe porque el libro NO distingue expedientes: su clave de obligacion '
    'no incluye el numero de expediente y los abonos no copian la referencia externa. Sin esta '
    'tabla, dos expedientes del mismo obligado que liquidaran costas del mismo tributo y '
    'ejercicio compartirian obligacion, y la columna «Costas S/» diria lo mismo en las dos '
    'filas. Con ella, el segundo choca contra la clave y la aplicacion lo explica nombrando al '
    'primero.';

CREATE INDEX costa_obligacion_expediente_ix
    ON costa_obligacion (municipalidad_id, expediente_id);

ALTER TABLE costa_obligacion ENABLE ROW LEVEL SECURITY;
ALTER TABLE costa_obligacion FORCE  ROW LEVEL SECURITY;

CREATE POLICY costa_obligacion_tenant ON costa_obligacion
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

GRANT SELECT, INSERT ON costa_obligacion TO sgtm_app;
GRANT SELECT          ON costa_obligacion TO sgtm_readonly;

-- ---------- 4. Ni la liquidacion ni su detalle se actualizan ----------
--
--  V7 le concedio UPDATE a `costa_procesal` junto con el resto de las tablas de
--  negocio. Se retira, por lo mismo que V34 se lo retiro al acto coactivo: la
--  liquidacion se notifica y su cargo ya esta asentado en el libro.
--
--  Aqui el REVOKE si se puede, al reves que con `cierre_caja` (V32 §1.bis):
--  ninguna fila de estas tablas necesita `SELECT ... FOR UPDATE` -lo que se
--  serializa es el correlativo, y eso lo hace su propia tabla con un UPDATE
--  atomico-.
REVOKE UPDATE ON costa_procesal FROM sgtm_app;

-- ---------- 5. La numeracion ----------
CREATE TABLE liquidacion_costas_correlativo (
    municipalidad_id bigint    NOT NULL REFERENCES municipalidad(id),
    ejercicio        ejercicio NOT NULL,
    ultimo           bigint    NOT NULL DEFAULT 0 CHECK (ultimo >= 0),
    CONSTRAINT liquidacion_costas_correlativo_pk PRIMARY KEY (municipalidad_id, ejercicio)
);

COMMENT ON TABLE liquidacion_costas_correlativo IS
    'El ultimo correlativo de liquidacion de costas por municipalidad y ejercicio (#42). Se lee '
    'y se incrementa en una sola sentencia UPSERT; nunca con SELECT + UPDATE. Mismo patron que '
    'valor_correlativo (V26), recibo_correlativo (V29), convenio_correlativo (V31) y '
    'expediente_correlativo (V33).';

ALTER TABLE liquidacion_costas_correlativo ENABLE ROW LEVEL SECURITY;
ALTER TABLE liquidacion_costas_correlativo FORCE  ROW LEVEL SECURITY;

CREATE POLICY liquidacion_costas_correlativo_tenant ON liquidacion_costas_correlativo
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- El contador SI se actualiza en el sitio: es infraestructura de numeracion, no
-- un acto administrativo (mismo criterio que V26, V29, V31 y V33).
GRANT SELECT, INSERT, UPDATE ON liquidacion_costas_correlativo TO sgtm_app;
GRANT SELECT                 ON liquidacion_costas_correlativo TO sgtm_readonly;
