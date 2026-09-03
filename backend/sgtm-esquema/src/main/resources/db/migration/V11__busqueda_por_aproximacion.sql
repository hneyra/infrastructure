-- ============================================================================
--  V11 — Busqueda de contribuyentes por aproximacion de nombre (RF-014)
--
--  El manual usa la busqueda por nombre constantemente, y en ventanilla el
--  nombre llega mal escrito: sin tildes, con la enie cambiada, con el orden de
--  los apellidos invertido o con una letra de menos. Una busqueda que solo
--  hace LIKE devuelve cero filas y el cajero acaba dando de alta al mismo
--  contribuyente por segunda vez —que es como se duplican los padrones—.
--
--  Se resuelve en la base y no en Java: traer 80 000 nombres a memoria para
--  compararlos es lo que hace que la caja tarde.
-- ============================================================================

-- pg_trgm y unaccent NO se instalan aqui: las instala crear-roles.sql, con la
-- conexion de superusuario que provisiona el ambiente. sgtm_owner migra pero no
-- puede crear extensiones, y esta bien que no pueda.

-- ---------- Normalizacion del nombre ----------
-- unaccent() es STABLE y no IMMUTABLE, porque depende del diccionario que se le
-- pase; PostgreSQL no la admite en un indice de expresion. Fijar el diccionario
-- con ::regdictionary la vuelve determinista, y entonces se puede declarar
-- IMMUTABLE y construir el indice.
--
-- Lo que hace: minusculas, sin tildes y sin espacios repetidos. "PEÑA GARCIA",
-- "Peña  Garcia" y "pena garcia" quedan iguales.
CREATE FUNCTION nombre_normalizado(texto text) RETURNS text AS $$
    SELECT regexp_replace(
               lower(unaccent('unaccent'::regdictionary, coalesce(texto, ''))),
               '\s+', ' ', 'g');
$$ LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE;

COMMENT ON FUNCTION nombre_normalizado(text) IS
    'Minusculas, sin tildes y sin espacios repetidos. IMMUTABLE para poder indexarla.';

-- ---------- El indice que hace util la aproximacion ----------
-- GIN con gin_trgm_ops: descompone el nombre en trigramas y permite responder
-- similarity() sin recorrer la tabla. Sin el, la busqueda funciona igual pero
-- lee el padron entero en cada tecla.
--
-- El indice NO lleva municipalidad_id: la politica RLS ya filtra, y anadirlo
-- aqui invitaria a escribir el filtro a mano en la consulta (regla 2).
CREATE INDEX contribuyente_nombre_trgm_ix
    ON contribuyente
    USING gin (nombre_normalizado(nombre_razon_social) gin_trgm_ops);

COMMENT ON INDEX contribuyente_nombre_trgm_ix IS
    'Busqueda por aproximacion de nombre (RF-014). Sin el, cada busqueda lee el padron entero.';

-- Por documento tambien se busca sin conocer el tipo —el cajero teclea el
-- numero que trae el DNI—, asi que el numero solo tambien se indexa.
CREATE INDEX contribuyente_numero_documento_ix
    ON contribuyente (numero_documento);
