-- ============================================================================
--  V55 — Las tres tablas de valuacion son NACIONALES (D-13, cerrada por la
--        Direccion del proyecto el 2026-08-28; ADR-0017, #188)
--
--  `valor_unitario_edificacion`, `depreciacion` y `valor_referencial_vehiculo`
--  llevaban `municipalidad_id NOT NULL` y colgaban de `conjunto_parametros`,
--  que es municipal: cada municipalidad tenia su propia copia del mismo cuadro
--  del MEF y del Ministerio de Vivienda. ARQ-09 §2.1 las clasifica como
--  NACIONAL —`municipalidad_id` nulo, «una vez, para todas»— y GOB-03 anoto la
--  diferencia como el hallazgo H-5: cargar N veces un cuadro nacional admite
--  que dos municipalidades tengan copias divergentes de la misma norma, y la
--  divergencia no produce ningun error, produce dos autovaluos distintos para
--  el mismo predio segun quien lo calcule.
--
--  `arancel` NO se toca, y es deliberado: el arancel de una via lo fija el
--  Ministerio de Vivienda por localidad, pero se carga y se corrige por
--  municipalidad —es lo que `aranceles-2026.md` §5 explica— y ARQ-09 §2.1 no lo
--  agrupa con estas tres en la misma casilla. Sigue colgando del conjunto, con
--  su disparador de V18 intacto.
--
--  ---------------------------------------------------------------------------
--  1. NACIONALES PURAS, no «nulo por omision»
--  ---------------------------------------------------------------------------
--
--  `parametro_tributario` admite las dos cosas: nulo para lo nacional y con
--  municipalidad para lo local, porque ahi conviven la UIT (nacional) y la TIM
--  (de ordenanza). Estas tres no: ninguna municipalidad publica su propio
--  cuadro de valores unitarios, su propia tabla de depreciacion ni su propia
--  tabla de valores referenciales del MEF. Admitir la fila municipal «por si
--  acaso» seria dejar abierta exactamente la puerta por la que H-5 entro.
--
--  Por eso la columna se queda —para que la politica de lectura tenga que
--  comparar algo, y para que el dia que alguien quiera la excepcion tenga que
--  quitar una restriccion con nombre y justificarla en su diff— pero con
--  `CHECK (municipalidad_id IS NULL)`. **Eso es lo que resuelve H-5 por
--  construccion**: una sola copia no puede divergir de si misma.
--
--  La clave primaria deja de llevar `municipalidad_id` —una columna de la clave
--  no puede ser nula— y pasa a ser `id` sola, que es la forma que ya tiene
--  `parametro_tributario` desde V1.
--
--  ---------------------------------------------------------------------------
--  2. COMO SIGUE CONGELANDO EL SELLADO MUNICIPAL
--  ---------------------------------------------------------------------------
--
--  Es la pregunta que importa: si la tabla ya no cuelga del conjunto, ¿que
--  impide que recalcular en 2037 una determinacion de 2026 lea otra tabla?
--
--  Lo mismo que ya impide que lea otra UIT: **el conjunto la compone por
--  referencia**. `conjunto_parametro_detalle` (V1) nombra los
--  `parametro_tributario` que el conjunto sello, y V9 lo hace inmutable en
--  cuanto el conjunto se sella. Aqui no se inventa un mecanismo paralelo: cada
--  cuadro nacional se publica como **una fila de `parametro_tributario`** —su
--  cabecera: tipo, ejercicio, documento fuente y las dos firmas de ADR-0007— y
--  las filas del cuadro apuntan a esa cabecera con `publicacion_id`. Componer
--  el cuadro en un conjunto es entonces exactamente lo que ya se hace con la
--  UIT: una fila en `conjunto_parametro_detalle`.
--
--  Se descarto componer fila por fila. La tabla vehicular del ejercicio 2026
--  tiene 18 043 filas de anexo: una entrada de detalle por fila y por
--  municipalidad y por ejercicio es un padron de punteros que crece con el
--  producto de los tres, para congelar algo que la norma no publica por celdas
--  sino por resolucion entera. Lo que se sella es la EDICION, y esa es la
--  unidad que el conjunto nombra.
--
--  ---------------------------------------------------------------------------
--  3. UNA EDICION SE CARGA UNA VEZ Y QUEDA CERRADA
--  ---------------------------------------------------------------------------
--
--  Componer la edicion no bastaria por si solo: si despues de sellarla se le
--  pudieran agregar filas, el conjunto seguiria «sellado» y su contenido
--  cambiaria —el peor de los dos mundos, el mismo que V9 describe—.
--
--  Se cierra con la columna que `parametro_tributario` tiene desde V1 y que
--  hasta hoy nadie usaba: `sellado`. Es su significado de ARQ-09 §2.3, y aqui
--  se aplica a la edicion entera: el proceso de carga marca `sellado = true`
--  cuando termina de publicar el cuadro, y desde ese momento el disparador de
--  abajo rechaza cualquier fila mas. Corregir una edicion cerrada es publicar
--  OTRA edicion, con su documento fuente y sus dos firmas, y componerla en un
--  conjunto nuevo: es ADR-0007 al pie de la letra.
--
--  El disparador consulta `parametro_tributario` y nada mas, a proposito: es la
--  unica tabla que `rol_carga_parametros` alcanza (V7), y su politica de
--  lectura usa la forma de dos argumentos de `current_setting`, asi que
--  funciona sin contexto de tenant —que es como corre la carga de un catalogo
--  nacional—. Un disparador que tuviera que mirar `conjunto_parametros` no
--  podria correr con esa credencial.
--
--  De paso cierra un hueco: `valor_referencial_vehiculo` **nunca tuvo**
--  disparador de inmutabilidad. V18 le puso uno a `arancel`, a
--  `valor_unitario_edificacion` y a `depreciacion`; V17, que fue quien engancho
--  la vehicular al conjunto, no le puso ninguno. Ahora las tres lo tienen.
-- ============================================================================

-- ---------------------------------------------------------------------------
--  Fuera lo municipal: politica de tenant y disparador por conjunto
-- ---------------------------------------------------------------------------
DROP POLICY valor_unitario_edificacion_tenant ON valor_unitario_edificacion;
DROP POLICY depreciacion_tenant               ON depreciacion;
DROP POLICY valor_referencial_vehiculo_tenant ON valor_referencial_vehiculo;

DROP TRIGGER valor_unitario_de_conjunto_sellado_inmutable ON valor_unitario_edificacion;
DROP TRIGGER depreciacion_de_conjunto_sellado_inmutable   ON depreciacion;
-- valor_referencial_vehiculo no tiene ninguno que quitar: V17 no se lo puso.

-- ---------------------------------------------------------------------------
--  valor_unitario_edificacion
-- ---------------------------------------------------------------------------
-- Las tres tablas siguen VACIAS —D-02a acaba de cerrarse y nada se ha cargado
-- todavia (#188)—, asi que la forma se cambia sin migrar una sola fila. Si
-- alguna hubiera, estas sentencias fallarian en vez de inventarle una edicion,
-- que es lo correcto.
ALTER TABLE valor_unitario_edificacion
    DROP CONSTRAINT valor_unitario_pk,
    DROP CONSTRAINT valor_unitario_conjunto_fk,
    DROP CONSTRAINT valor_unitario_uq,
    DROP COLUMN conjunto_id,
    ALTER COLUMN municipalidad_id DROP NOT NULL,
    ADD COLUMN publicacion_id bigint NOT NULL;

ALTER TABLE valor_unitario_edificacion
    ADD CONSTRAINT valor_unitario_pk PRIMARY KEY (id),
    ADD CONSTRAINT valor_unitario_nacional_ck CHECK (municipalidad_id IS NULL),
    ADD CONSTRAINT valor_unitario_publicacion_fk
        FOREIGN KEY (publicacion_id) REFERENCES parametro_tributario (id),
    ADD CONSTRAINT valor_unitario_uq
        UNIQUE (publicacion_id, partida, categoria, anio_construccion_desde);

-- ---------------------------------------------------------------------------
--  depreciacion
-- ---------------------------------------------------------------------------
ALTER TABLE depreciacion
    DROP CONSTRAINT depreciacion_pk,
    DROP CONSTRAINT depreciacion_conjunto_fk,
    DROP CONSTRAINT depreciacion_uq,
    DROP COLUMN conjunto_id,
    ALTER COLUMN municipalidad_id DROP NOT NULL,
    ADD COLUMN publicacion_id bigint NOT NULL;

ALTER TABLE depreciacion
    ADD CONSTRAINT depreciacion_pk PRIMARY KEY (id),
    ADD CONSTRAINT depreciacion_nacional_ck CHECK (municipalidad_id IS NULL),
    ADD CONSTRAINT depreciacion_publicacion_fk
        FOREIGN KEY (publicacion_id) REFERENCES parametro_tributario (id),
    ADD CONSTRAINT depreciacion_uq
        UNIQUE (publicacion_id, material, estado_conservacion, antiguedad_hasta);

-- ---------------------------------------------------------------------------
--  valor_referencial_vehiculo
-- ---------------------------------------------------------------------------
-- Conserva su columna `ejercicio`: en una tabla nacional ya no es una clave de
-- resolucion —eso era el defecto que V17 corrigio— sino el dato que la propia
-- norma imprime en su titulo, «ejercicio 2026». La edicion la identifica
-- `publicacion_id`.
--
-- DOS CORRECCIONES QUE ENCONTRO CARGAR EL ANEXO DE VERDAD
--
-- Las dos salieron de publicar las 18 043 filas del anexo 2026 contra
-- PostgreSQL, no de revisar el DDL. De las 54 129 filas de cuadro que produce
-- (una por ano de fabricacion), 1 905 quedaban fuera:
--
-- 1. `modelo varchar(60)` es corto. Cinco modelos del anexo pasan de 60
--    caracteres —el mas largo tiene 67, «EXTAE3R ISOPRORTBACK ATTRACTION 1.2
--    TFSI STRONIC/ S LINE EXTERIOR»— y sus 15 filas se rechazaban. Pasa a 80.
--    La `marca` se queda en 60: la mas larga del anexo tiene 15.
--
-- 2. **Falta la categoria, y es parte de la identidad de la fila.** El anexo
--    publica «OTROS MODELOS» dentro de CADA categoria —A1, A2, A3, A4, BUSES Y
--    OMNIBUSES, CAMIONES, CAMIONETAS, REMOLCADORES— con un valor distinto en
--    cada una. Sin la columna, 472 pares (marca, modelo) chocaban entre si y se
--    perdian 1 890 filas: la unicidad se quedaba con la primera categoria y
--    descartaba las demas en silencio. Un camion valorizado con la cifra de una
--    camioneta no produce ningun error, produce otra base imponible.
--
--    `vehiculo.categoria` existe desde V2, asi que el padron ya sabe decir a que
--    categoria pertenece un vehiculo; lo que faltaba era el otro lado.
DROP INDEX valor_referencial_catalogo_ix;

ALTER TABLE valor_referencial_vehiculo
    ALTER COLUMN modelo TYPE varchar(80),
    ADD COLUMN categoria varchar(20) NOT NULL;

COMMENT ON COLUMN valor_referencial_vehiculo.categoria IS
    'La categoria con que el anexo del MEF publica la fila (A1..A4, BUSES Y OMNIBUSES,'
    ' CAMIONES, CAMIONETAS, REMOLCADORES). Es parte de la identidad: el anexo publica'
    ' «OTROS MODELOS» en cada categoria, con un valor distinto en cada una.';

ALTER TABLE valor_referencial_vehiculo
    DROP CONSTRAINT valor_referencial_pk,
    DROP CONSTRAINT valor_referencial_conjunto_fk,
    DROP CONSTRAINT valor_referencial_uq,
    DROP COLUMN conjunto_id,
    ALTER COLUMN municipalidad_id DROP NOT NULL,
    ADD COLUMN publicacion_id bigint NOT NULL;

ALTER TABLE valor_referencial_vehiculo
    ADD CONSTRAINT valor_referencial_pk PRIMARY KEY (id),
    ADD CONSTRAINT valor_referencial_nacional_ck CHECK (municipalidad_id IS NULL),
    ADD CONSTRAINT valor_referencial_publicacion_fk
        FOREIGN KEY (publicacion_id) REFERENCES parametro_tributario (id),
    ADD CONSTRAINT valor_referencial_uq
        UNIQUE (publicacion_id, categoria, marca, modelo, anio_fabricacion);

-- El catalogo de marcas y modelos se lee de aqui —no hay tabla propia: la lista
-- mantenible ES la tabla de valores—, y siempre acotado a una edicion.
CREATE INDEX valor_referencial_catalogo_ix
    ON valor_referencial_vehiculo (publicacion_id, marca, modelo);

-- ---------------------------------------------------------------------------
--  RLS: catalogo nacional, con la politica de `parametro_tributario`
-- ---------------------------------------------------------------------------
--  RLS sigue activa y forzada —lo que cambia es la politica, no su existencia
--  (ARQ-09 §2.1, RNF-031)—. Se copia literalmente la forma de V6 para
--  `parametro_tributario`, incluida la rama `municipalidad_id = ...` que hoy no
--  puede casar con nada por el CHECK de arriba: la politica no depende del
--  CHECK, de modo que quitar el CHECK manana no abre una fuga, solo admite una
--  fila municipal que seguiria aislada.
--
--  Aqui SI se usa la forma de dos argumentos de current_setting: un catalogo
--  nacional tiene que poder leerse sin contexto de municipalidad —eso es lo que
--  hace la carga—, y sin contexto la comparacion da NULL, de modo que lo unico
--  visible es lo que es nacional por definicion.
CREATE POLICY valor_unitario_lectura ON valor_unitario_edificacion
    FOR SELECT USING (
        municipalidad_id IS NULL
        OR municipalidad_id = nullif(current_setting('app.municipalidad_id', true), '')::bigint
    );

CREATE POLICY valor_unitario_escritura ON valor_unitario_edificacion
    FOR ALL TO rol_carga_parametros
    USING (true) WITH CHECK (true);

CREATE POLICY depreciacion_lectura ON depreciacion
    FOR SELECT USING (
        municipalidad_id IS NULL
        OR municipalidad_id = nullif(current_setting('app.municipalidad_id', true), '')::bigint
    );

CREATE POLICY depreciacion_escritura ON depreciacion
    FOR ALL TO rol_carga_parametros
    USING (true) WITH CHECK (true);

CREATE POLICY valor_referencial_lectura ON valor_referencial_vehiculo
    FOR SELECT USING (
        municipalidad_id IS NULL
        OR municipalidad_id = nullif(current_setting('app.municipalidad_id', true), '')::bigint
    );

CREATE POLICY valor_referencial_escritura ON valor_referencial_vehiculo
    FOR ALL TO rol_carga_parametros
    USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
--  Privilegios: la aplicacion solo lee; escribe el rol de carga
-- ---------------------------------------------------------------------------
--  V7 le habia dado a sgtm_app INSERT y UPDATE sobre las tres, porque eran
--  tablas de negocio de su municipalidad. Ya no lo son: una peticion HTTP no
--  puede tener el camino mas corto hasta el cuadro de valores unitarios de
--  todas las municipalidades del pais. Es la misma segregacion que
--  `parametro_tributario` tiene desde V7 (SoD-1 de REQ-03).
REVOKE INSERT, UPDATE ON
    valor_unitario_edificacion, depreciacion, valor_referencial_vehiculo
    FROM sgtm_app;

GRANT SELECT, INSERT, UPDATE ON
    valor_unitario_edificacion, depreciacion, valor_referencial_vehiculo
    TO rol_carga_parametros;

-- El rol de carga tiene que poder leer la cabecera de la edicion que publica:
-- ya la tiene (V7 le concede SELECT sobre parametro_tributario), y es la unica
-- tabla que el disparador de abajo consulta.

-- ---------------------------------------------------------------------------
--  Una edicion cerrada no admite una fila mas
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION valuacion_de_publicacion_sellada_es_inmutable() RETURNS trigger AS $$
DECLARE
    esta_sellada boolean;
    v_publicacion bigint;
BEGIN
    v_publicacion := COALESCE(NEW.publicacion_id, OLD.publicacion_id);
    SELECT p.sellado INTO esta_sellada
      FROM parametro_tributario p
     WHERE p.id = v_publicacion;

    -- La clave foranea ya lo impediria; esto lo dice con un mensaje que nombra
    -- la causa en vez de un codigo de restriccion.
    IF esta_sellada IS NULL THEN
        RAISE EXCEPTION
            'La publicacion % no existe o no es visible para este rol: una fila de'
            ' valuacion sin edicion no se puede reproducir', v_publicacion
            USING ERRCODE = 'foreign_key_violation';
    END IF;

    IF esta_sellada THEN
        RAISE EXCEPTION
            'La publicacion % esta sellada: su contenido no cambia. Corregir un cuadro'
            ' normativo es publicar otra edicion, no editar la que ya se uso (ADR-0007)',
            v_publicacion
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER valor_unitario_de_publicacion_sellada_inmutable
    BEFORE INSERT OR UPDATE ON valor_unitario_edificacion
    FOR EACH ROW EXECUTE FUNCTION valuacion_de_publicacion_sellada_es_inmutable();

CREATE TRIGGER depreciacion_de_publicacion_sellada_inmutable
    BEFORE INSERT OR UPDATE ON depreciacion
    FOR EACH ROW EXECUTE FUNCTION valuacion_de_publicacion_sellada_es_inmutable();

CREATE TRIGGER valor_referencial_de_publicacion_sellada_inmutable
    BEFORE INSERT OR UPDATE ON valor_referencial_vehiculo
    FOR EACH ROW EXECUTE FUNCTION valuacion_de_publicacion_sellada_es_inmutable();

-- ---------------------------------------------------------------------------
--  Constancia
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN valor_unitario_edificacion.municipalidad_id IS
    'Siempre nulo: el cuadro de valores unitarios es nacional (ARQ-09 §2.1, D-13). La columna'
    ' se conserva para que la politica de RLS compare algo y para que admitir una fila'
    ' municipal exija quitar valor_unitario_nacional_ck y justificarlo.';
COMMENT ON COLUMN valor_unitario_edificacion.publicacion_id IS
    'La edicion a la que pertenece esta fila: un parametro_tributario que es la cabecera del'
    ' cuadro. El conjunto sellado de una municipalidad la compone por conjunto_parametro_detalle.';
COMMENT ON COLUMN depreciacion.municipalidad_id IS
    'Siempre nulo: la tabla de depreciacion es nacional (ARQ-09 §2.1, D-13).';
COMMENT ON COLUMN depreciacion.publicacion_id IS
    'La edicion a la que pertenece esta fila (ver valor_unitario_edificacion.publicacion_id).';
COMMENT ON COLUMN valor_referencial_vehiculo.municipalidad_id IS
    'Siempre nulo: la tabla de valores referenciales la aprueba el MEF (ARQ-09 §2.1, D-13).';
COMMENT ON COLUMN valor_referencial_vehiculo.publicacion_id IS
    'La edicion a la que pertenece esta fila (ver valor_unitario_edificacion.publicacion_id).';
