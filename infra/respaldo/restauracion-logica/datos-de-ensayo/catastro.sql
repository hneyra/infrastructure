-- `via` es la tabla que el defecto de C-4 se lleva por delante: su columna generada
-- `nombre_busqueda` llama a `nombre_normalizado`, la expresion se inserta en linea al
-- CREAR LA TABLA, y con el `search_path` vacio que `pg_dump` deja, la tabla no se crea.
--
-- Sembrarla es lo que convierte «faltan 12 objetos» en «y ademas se perdieron 3 filas».
INSERT INTO via (municipalidad_id, codigo, tipo_via, nombre, ubigeo)
VALUES (900001, 'V-0001', 'AVENIDA', 'AVENIDA JOSE DE LAMA', '200101'),
       (900001, 'V-0002', 'CALLE', 'CALLE CAYETANO HEREDIA', '200101'),
       (900002, 'V-0001', 'JIRON', 'JIRON GRAU', '200104');

-- La fila de tenant que `comun.sql` tenia hasta ADR-0039. Se movio aqui —y a los otros tres
-- archivos de sistema, con la misma sentencia— porque `modulo_sistema` dejo de tener la
-- misma forma en los cinco: la de `identidad` lleva ademas `sistema NOT NULL`. Ver la
-- cabecera de `comun.sql`.
INSERT INTO modulo_sistema (municipalidad_id, codigo, nombre)
OVERRIDING SYSTEM VALUE
VALUES (900001, 'C11', 'Modulo de ensayo'),
       (900002, 'C11', 'Modulo de ensayo');
