-- El monolito tiene `contribuyente` y `via` a la vez —los doce contextos dentro—, asi que
-- se siembran las dos: la del padron, cuyo indice de trigramas la restauracion pierde, y
-- la del catastro, que aqui SI sobrevive porque el uso del monolito es un indice y no una
-- columna generada.
INSERT INTO contribuyente (municipalidad_id, codigo_contribuyente, tipo_documento,
                           numero_documento, tipo_persona, nombre_razon_social,
                           usuario_registro)
VALUES (900001, 'C-900001', 'DNI', '70123456', 'NATURAL', 'PEÑA GARCIA, JOSE', 'ensayo-c11'),
       (900002, 'C-900001', 'DNI', '29614026', 'NATURAL', 'RAMOS CHUNGA, MARIA', 'ensayo-c11');

INSERT INTO via (municipalidad_id, codigo, tipo_via, nombre, ubigeo)
VALUES (900001, 'V-0001', 'AVENIDA', 'AVENIDA JOSE DE LAMA', '200101'),
       (900002, 'V-0001', 'JIRON', 'JIRON GRAU', '200104');
