-- `normativa` no tiene mas tabla propia que se pueda llenar sin publicar una cifra
-- normativa, y publicar una cifra inventada esta prohibido (regla 5): un conjunto de
-- parametros de ensayo con importes de mentira seria exactamente lo que el corpus
-- verificado existe para impedir. Lo que se siembra aqui es lo comun.
--
-- No es un hueco disimulado: el recuento por tabla se compara igual para las 19 tablas, y
-- las dos filas de `municipalidad` y las dos de `modulo_sistema` viajan de verdad.

-- La fila de tenant que `comun.sql` tenia hasta ADR-0039. Se movio aqui —y a los otros tres
-- archivos de sistema, con la misma sentencia— porque `modulo_sistema` dejo de tener la
-- misma forma en los cinco: la de `identidad` lleva ademas `sistema NOT NULL`. Ver la
-- cabecera de `comun.sql`.
INSERT INTO modulo_sistema (municipalidad_id, codigo, nombre)
OVERRIDING SYSTEM VALUE
VALUES (900001, 'C11', 'Modulo de ensayo'),
       (900002, 'C11', 'Modulo de ensayo');
