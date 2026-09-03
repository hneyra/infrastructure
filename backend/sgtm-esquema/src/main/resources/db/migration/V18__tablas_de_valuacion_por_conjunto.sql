-- ============================================================================
--  V18 — arancel, valor_unitario_edificacion y depreciacion cuelgan de un
--  conjunto de parametros sellado (#17)
--
--  Las tres existian desde V1 sin sellado: cargar dos veces el mismo ejercicio
--  violaba su UNIQUE, y no habia forma de corregir una cifra ya usada en una
--  emision sin editar en sitio —justo lo que ADR-0007 prohibe.
--
--  #17 pide «se sellan por ejercicio con el mismo mecanismo (#10)», y el
--  mecanismo de #10 es conjunto_parametros, no uno paralelo. ARQ-09 §3 lo
--  confirma: el conjunto sellado de una determinacion lista explicitamente
--  «Aranceles», «Valores unitarios» y «Depreciacion» junto a la UIT y los
--  tramos, todos colgando del MISMO conjunto. Y V17 (#141, ya en main) sento
--  el precedente igual: valor_referencial_vehiculo se engancha a
--  conjunto_parametros con su propio conjunto_id, sin inventar una tabla de
--  cabecera nueva para el modulo de rentas. Aqui se hace lo mismo para
--  catastro: sin tabla nueva, sin mecanismo de sellado paralelo.
--
--  DOS DIMENSIONES, NO UNA, EN valor_unitario_edificacion
--
--  NEG-05 §RT-002 (../srtm) advierte que «el cuadro de valores unitarios es
--  una matriz de DOS dimensiones: categoria x ano de construccion» y que
--  asumir una sola dimension temporal fue un defecto real de ARQ-09 en srtm.
--  La letra valida de una construccion depende del ANO EN QUE SE CONSTRUYO, no
--  del ejercicio en que se publica la tabla. Sin anio_construccion, esta tabla
--  repetiria ese defecto: cargar el cuadro 2026 solo podria guardar una letra
--  por categoria, cuando la resolucion trae una por categoria Y por antiguedad
--  de la edificacion. Se agrega como rango (desde/hasta, hasta nulo = sin
--  tope) para no presuponer si la resolucion publica anos exactos o tramos:
--  el formato de carga sigue sin decidir (ARQ-09 §7), y ninguna cifra entra
--  aqui (D-02).
--
--  Las tres tablas siguen vacias: D-02 no esta resuelta. Por eso se puede
--  alterar su forma libremente, sin migrar filas. Y a diferencia de V17, aqui
--  se DROP la columna ejercicio en vez de dejarla redundante junto a
--  conjunto_id: nada impediria que divergiera del ejercicio de su propio
--  conjunto_parametros, y no hay ninguna fila que perder por quitarla.
-- ============================================================================

-- ---------- arancel ----------
ALTER TABLE arancel
    DROP COLUMN ejercicio,
    ADD COLUMN conjunto_id bigint NOT NULL;

-- NOT VALID, y no es un atajo: es la unica forma que hay (DAT-01 §0, cuarto
-- hallazgo). Validar una clave foranea recien creada es una consulta sobre
-- conjunto_parametros, que tiene RLS con FORCE; el migrador corre como
-- sgtm_owner sin contexto de tenant, y esa consulta se caeria con
-- «unrecognized configuration parameter "app.municipalidad_id"». NOT VALID
-- salta el escaneo retroactivo y no debilita nada hacia adelante: la
-- restriccion se comprueba en cada INSERT y cada UPDATE desde este momento, y
-- no hay ninguna fila anterior que dejar de validar.
ALTER TABLE arancel
    ADD CONSTRAINT arancel_conjunto_fk FOREIGN KEY (municipalidad_id, conjunto_id)
        REFERENCES conjunto_parametros (municipalidad_id, id)
        NOT VALID,
    ADD CONSTRAINT arancel_uq UNIQUE (municipalidad_id, conjunto_id, via_id, tramo);

-- ---------- valor_unitario_edificacion ----------
ALTER TABLE valor_unitario_edificacion
    DROP COLUMN ejercicio,
    ADD COLUMN conjunto_id             bigint NOT NULL,
    ADD COLUMN anio_construccion_desde ejercicio NOT NULL,
    ADD COLUMN anio_construccion_hasta ejercicio;

ALTER TABLE valor_unitario_edificacion
    ADD CONSTRAINT valor_unitario_conjunto_fk FOREIGN KEY (municipalidad_id, conjunto_id)
        REFERENCES conjunto_parametros (municipalidad_id, id)
        NOT VALID,
    ADD CONSTRAINT valor_unitario_uq
        UNIQUE (municipalidad_id, conjunto_id, partida, categoria, anio_construccion_desde),
    ADD CONSTRAINT valor_unitario_anio_ck
        CHECK (anio_construccion_hasta IS NULL
            OR anio_construccion_hasta >= anio_construccion_desde);

COMMENT ON COLUMN valor_unitario_edificacion.anio_construccion_desde IS
    'Extremo inferior del ano de construccion al que aplica esta letra (NEG-05 RT-002,'
    ' ../srtm): el cuadro de valores unitarios es una matriz categoria x ano de'
    ' construccion, no solo categoria.';
COMMENT ON COLUMN valor_unitario_edificacion.anio_construccion_hasta IS
    'Extremo superior del tramo; nulo cuando la tabla no le pone tope (la construccion'
    ' mas reciente).';

-- ---------- depreciacion ----------
ALTER TABLE depreciacion
    DROP COLUMN ejercicio,
    ADD COLUMN conjunto_id bigint NOT NULL;

ALTER TABLE depreciacion
    ADD CONSTRAINT depreciacion_conjunto_fk FOREIGN KEY (municipalidad_id, conjunto_id)
        REFERENCES conjunto_parametros (municipalidad_id, id)
        NOT VALID,
    ADD CONSTRAINT depreciacion_uq
        UNIQUE (municipalidad_id, conjunto_id, material, estado_conservacion, antiguedad_hasta);

-- ---------- Inmutabilidad: un conjunto sellado no se toca, ni sus filas ----------
-- V9 dejo detalle_de_conjunto_sellado_es_inmutable atada solo a
-- conjunto_parametro_detalle. Estas tres tablas cuelgan de conjunto_id igual
-- que esa, asi que necesitan la misma proteccion, generalizada por tabla en
-- vez de repetida tres veces con el nombre de columna cambiado.
CREATE OR REPLACE FUNCTION valuacion_de_conjunto_sellado_es_inmutable() RETURNS trigger AS $$
DECLARE
    estado_actual text;
    v_conjunto    bigint;
BEGIN
    v_conjunto := COALESCE(NEW.conjunto_id, OLD.conjunto_id);
    SELECT c.estado INTO estado_actual
      FROM conjunto_parametros c
     WHERE c.municipalidad_id = COALESCE(NEW.municipalidad_id, OLD.municipalidad_id)
       AND c.id = v_conjunto;
    IF estado_actual = 'SELLADO' THEN
        RAISE EXCEPTION
            'El conjunto de parametros % esta sellado: su contenido no cambia (ADR-0007)',
            v_conjunto
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER arancel_de_conjunto_sellado_inmutable
    BEFORE INSERT OR UPDATE ON arancel
    FOR EACH ROW EXECUTE FUNCTION valuacion_de_conjunto_sellado_es_inmutable();

CREATE TRIGGER valor_unitario_de_conjunto_sellado_inmutable
    BEFORE INSERT OR UPDATE ON valor_unitario_edificacion
    FOR EACH ROW EXECUTE FUNCTION valuacion_de_conjunto_sellado_es_inmutable();

CREATE TRIGGER depreciacion_de_conjunto_sellado_inmutable
    BEFORE INSERT OR UPDATE ON depreciacion
    FOR EACH ROW EXECUTE FUNCTION valuacion_de_conjunto_sellado_es_inmutable();
