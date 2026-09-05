-- Las filas de cada tabla de `public`, una linea por tabla: «FILAS <tabla> <n>».
--
-- Es la mitad de DATOS del simulacro (C-11 §4). El esquema restaurado puede estar completo
-- y aun asi haber perdido filas: `pg_restore` carga los datos ANTES de crear indices y
-- restricciones, asi que un `COPY` que falla —o una tabla que no llego a crearse— deja el
-- recuento a cero sin que ninguna linea del censo de objetos lo diga.
--
-- Cuenta de verdad, con `count(*)`, y no `reltuples`: el estimador del planificador vale
-- -1 en una base recien restaurada sobre la que nadie ha corrido `ANALYZE`, de modo que
-- una comparacion sobre `reltuples` no hablaria de filas.
--
-- Solo `relkind = 'r'`: una particion tambien es 'r', asi que asi cada fila se cuenta
-- exactamente una vez. Contar ademas la tabla particionada ('p') sumaria dos veces lo
-- mismo y el numero dejaria de significar «filas».
--
-- Incluye las tablas que aporta una extension —`spatial_ref_sys` y sus 8 500 filas—, a
-- proposito: son las unicas filas que un esquema recien aplicado tiene sin que nadie las
-- siembre, y son datos que una restauracion tiene que traer.
SELECT 'FILAS ' || c.relname || ' '
       || (xpath(
              '/row/c/text()',
              query_to_xml(
                  format('SELECT count(*) AS c FROM public.%I', c.relname),
                  false, true, '')))[1]::text
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
 WHERE c.relkind = 'r'
 ORDER BY 1;
