-- Un objeto por linea: «CLASE nombre». Es el censo que se compara entre la base ORIGEN y
-- la RESTAURADA (C-11).
--
-- POR QUE UN CENSO ADEMAS DEL RETRATO
-- -----------------------------------
-- `Retrato.java` es exhaustivo pero mira SOLO las tablas que se le nombran: columnas,
-- restricciones, indices, politicas, privilegios —incluidos los de columna—, disparadores
-- y comentarios de cada una. Lo que no puede ver, por construccion, es **una tabla que no
-- esta**: se le pasa la lista del origen y del lado restaurado devuelve silencio. Este
-- censo es lo que convierte ese silencio en una linea con nombre.
--
-- Y cubre lo que el retrato no alcanza: extensiones, secuencias, vistas y las funciones
-- que NO son de disparador —`nombre_normalizado` es una de ellas, y es la del defecto que
-- C-4 arreglo—.
--
-- LO QUE SE EXCLUYE, Y POR QUE
-- ----------------------------
-- Los objetos que pertenecen a una extension (`pg_depend.deptype = 'e'`): PostGIS aporta
-- cientos de funciones y una tabla, y salen iguales a los dos lados por construccion —los
-- crea el mismo `CREATE EXTENSION`—. Lo que si se cuenta es la extension misma: si no se
-- crea, su linea desaparece y con ella todo lo suyo.
--
-- `plpgsql` no se cuenta porque viene en `template1` y en `template0` no; contarla haria
-- que el censo hablara de la plantilla y no del esquema.
WITH de_extension AS (
    SELECT objid FROM pg_depend WHERE deptype = 'e'
)
SELECT 'EXTENSION ' || e.extname FROM pg_extension e WHERE e.extname <> 'plpgsql'
UNION ALL
SELECT 'DOMINIO ' || t.typname
  FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace AND n.nspname = 'public'
 WHERE t.typtype = 'd'
UNION ALL
SELECT CASE c.relkind WHEN 'r' THEN 'TABLA ' WHEN 'p' THEN 'TABLA_PARTICIONADA '
                      WHEN 'v' THEN 'VISTA ' WHEN 'm' THEN 'VISTA_MATERIALIZADA '
                      WHEN 'S' THEN 'SECUENCIA ' END || c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
 WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S')
   AND c.oid NOT IN (SELECT objid FROM de_extension)
UNION ALL
SELECT 'INDICE ' || i.relname || ' EN ' || t.relname
  FROM pg_index x
  JOIN pg_class i ON i.oid = x.indexrelid
  JOIN pg_class t ON t.oid = x.indrelid
  JOIN pg_namespace n ON n.oid = i.relnamespace AND n.nspname = 'public'
 WHERE i.oid NOT IN (SELECT objid FROM de_extension)
UNION ALL
SELECT 'RESTRICCION ' || t.relname || '.' || k.conname
  FROM pg_constraint k
  JOIN pg_class t ON t.oid = k.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = 'public'
UNION ALL
SELECT 'POLITICA_RLS ' || t.relname || '.' || p.polname
  FROM pg_policy p
  JOIN pg_class t ON t.oid = p.polrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = 'public'
UNION ALL
SELECT 'DISPARADOR ' || t.relname || '.' || g.tgname
  FROM pg_trigger g
  JOIN pg_class t ON t.oid = g.tgrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = 'public'
 WHERE NOT g.tgisinternal
UNION ALL
SELECT 'FUNCION ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
 WHERE p.oid NOT IN (SELECT objid FROM de_extension)
ORDER BY 1;
