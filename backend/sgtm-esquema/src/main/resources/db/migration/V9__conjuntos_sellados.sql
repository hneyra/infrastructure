-- ============================================================================
--  V9 — El sellado de un conjunto de parametros es irreversible (ADR-0007)
--
--  Un conjunto sellado es el que se uso para emitir. Si se pudiera corregir,
--  recalcular un ejercicio pasado daria otra cifra que la que se notifico, y la
--  municipalidad no podria explicar la diferencia. Corregir obliga a crear una
--  version nueva, y esa version queda registrada al lado de la anterior.
--
--  Se implementa en la base y no en la aplicacion por el mismo motivo que la
--  observacion obligatoria: una regla que solo vive en un caso de uso se rodea
--  con un UPDATE directo el dia que hay prisa.
-- ============================================================================

-- ---------- Un solo conjunto sellado por ejercicio ----------
-- Puede haber varias versiones abiertas mientras se preparan, pero solo una
-- puede quedar sellada: es la que rige. Con dos, ninguna consulta podria decir
-- cual se aplico, y la reproducibilidad se perderia sin ningun error visible.
CREATE UNIQUE INDEX conjunto_sellado_uq
    ON conjunto_parametros (municipalidad_id, ejercicio)
    WHERE estado = 'SELLADO';

-- ---------- Un conjunto sellado no se modifica ----------
CREATE OR REPLACE FUNCTION conjunto_sellado_es_inmutable() RETURNS trigger AS $$
BEGIN
    IF OLD.estado = 'SELLADO' THEN
        RAISE EXCEPTION
            'El conjunto de parametros % del ejercicio % esta sellado y no se modifica;'
            ' cree una version nueva (ADR-0007)', OLD.id, OLD.ejercicio
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER conjunto_sellado_inmutable
    BEFORE UPDATE ON conjunto_parametros
    FOR EACH ROW EXECUTE FUNCTION conjunto_sellado_es_inmutable();

-- ---------- Tampoco se le agregan ni se le quitan parametros ----------
-- Sin esto, el conjunto seguiria «sellado» y su contenido cambiaria: el peor de
-- los dos mundos, porque la pantalla diria que esta congelado.
CREATE OR REPLACE FUNCTION detalle_de_conjunto_sellado_es_inmutable() RETURNS trigger AS $$
DECLARE
    estado_actual text;
    conjunto      bigint;
BEGIN
    conjunto := COALESCE(NEW.conjunto_id, OLD.conjunto_id);
    SELECT c.estado INTO estado_actual
      FROM conjunto_parametros c
     WHERE c.municipalidad_id = COALESCE(NEW.municipalidad_id, OLD.municipalidad_id)
       AND c.id = conjunto;

    IF estado_actual = 'SELLADO' THEN
        RAISE EXCEPTION
            'El conjunto de parametros % esta sellado: su contenido no cambia (ADR-0007)',
            conjunto
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER detalle_de_conjunto_sellado_inmutable
    BEFORE INSERT OR UPDATE ON conjunto_parametro_detalle
    FOR EACH ROW EXECUTE FUNCTION detalle_de_conjunto_sellado_es_inmutable();

COMMENT ON INDEX conjunto_sellado_uq IS
    'Solo un conjunto sellado por ejercicio: con dos, ninguna consulta podria decir cual se aplico.';
