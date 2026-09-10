-- `contribuyente` es la tabla del padron, y la que en el monolito pierde su indice de
-- trigramas al restaurar (C-4). Aqui el indice se salva desde `V11`, y las filas dicen que
-- ademas de crearse el indice se cargaron los datos que indexa.
INSERT INTO contribuyente (municipalidad_id, codigo_contribuyente, tipo_documento,
                           numero_documento, tipo_persona, nombre_razon_social,
                           usuario_registro)
VALUES (900001, 'C-900001', 'DNI', '70123456', 'NATURAL', 'PEÑA GARCIA, JOSE', 'ensayo-c11'),
       (900001, 'C-900002', 'RUC', '20100000001', 'JURIDICA', 'EMPRESA DE ENSAYO SAC', 'ensayo-c11'),
       (900002, 'C-900001', 'DNI', '29614026', 'NATURAL', 'RAMOS CHUNGA, MARIA', 'ensayo-c11');

-- La fila de tenant que `comun.sql` tenia hasta ADR-0039. Se movio aqui —y a los otros tres
-- archivos de sistema, con la misma sentencia— porque `modulo_sistema` dejo de tener la
-- misma forma en los cinco: la de `identidad` lleva ademas `sistema NOT NULL`. Ver la
-- cabecera de `comun.sql`.
INSERT INTO modulo_sistema (municipalidad_id, codigo, nombre)
OVERRIDING SYSTEM VALUE
VALUES (900001, 'C11', 'Modulo de ensayo'),
       (900002, 'C11', 'Modulo de ensayo');
