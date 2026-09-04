-- ============================================================================
--  MUESTRA de C-4 — cuerpos de funcion que dependen del `search_path`
--
--  Una regla que no puede fallar no protege nada. Este archivo NO se aplica a
--  ninguna base: lo lee `search-path-en-el-cuerpo-de-la-funcion.test.ts`.
--
--  Trae CINCO funciones a proposito: dos que violan la regla por sus dos mitades,
--  y TRES contrastes que no la violan y que son los que impiden que la guarda
--  grite ante cualquier cosa.
--
--  Y la prosa nombra `unaccent('unaccent'::regdictionary, ...)` aqui mismo, en un
--  comentario, para comprobar que `sinComentarios` la deja fuera: sin eso, la
--  guarda pondria en rojo a quien explica el defecto (el hueco de #426 y #558).
-- ============================================================================

-- MALA (1): la mitad del literal. El diccionario se resuelve por search_path.
CREATE OR REPLACE FUNCTION public.muestra_c4_diccionario_suelto(texto text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$
    SELECT public.unaccent('unaccent'::regdictionary, coalesce(texto, ''));
$function$
;

-- MALA (2): la mitad de la funcion, y con el `LANGUAGE sql` DESPUES del cuerpo,
-- que es como lo escribe el `V11` del monolito. Si la guarda solo mirase la
-- cabecera, este caso —el real— se le escaparia entero.
CREATE OR REPLACE FUNCTION public.muestra_c4_funcion_suelta(texto text)
RETURNS text AS $$
    SELECT unaccent('public.unaccent'::regdictionary, coalesce(texto, ''));
$$ LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE;

-- BUENA (contraste 1): las dos mitades cualificadas. No sale.
CREATE OR REPLACE FUNCTION public.muestra_c4_en_regla(texto text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
AS $function$
    SELECT regexp_replace(
               lower(public.unaccent('public.unaccent'::regdictionary, coalesce(texto, ''))),
               '\s+', ' ', 'g');
$function$
;

-- BUENA (contraste 2): un cuerpo `plpgsql` con el nombre suelto dentro. NO sale, y
-- es deliberado: plpgsql no se inserta en linea nunca, y los disparadores se crean
-- despues de cargar los datos, asi que durante una restauracion no se ejecuta.
-- Marcar esto seria un falso positivo, y una guarda que grita se acaba silenciando.
CREATE OR REPLACE FUNCTION public.muestra_c4_plpgsql()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.nombre := unaccent('unaccent'::regdictionary, NEW.nombre);
    RETURN NEW;
END;
$function$
;

-- BUENA (contraste 3): DDL suelto, fuera de todo cuerpo de funcion. NO sale, porque
-- `pg_dump` cualifica solo lo que emite el: en el volcado esta linea sale como
-- `public.nombre_normalizado(...)` y su clase de operadores como `public.gin_trgm_ops`.
CREATE INDEX muestra_c4_ix ON public.muestra_c4 USING gin (nombre_normalizado(nombre) gin_trgm_ops);
