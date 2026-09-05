-- `contribuyente` es la tabla del padron, y la que en el monolito pierde su indice de
-- trigramas al restaurar (C-4). Aqui el indice se salva desde `V11`, y las filas dicen que
-- ademas de crearse el indice se cargaron los datos que indexa.
INSERT INTO contribuyente (municipalidad_id, codigo_contribuyente, tipo_documento,
                           numero_documento, tipo_persona, nombre_razon_social,
                           usuario_registro)
VALUES (900001, 'C-900001', 'DNI', '70123456', 'NATURAL', 'PEÑA GARCIA, JOSE', 'ensayo-c11'),
       (900001, 'C-900002', 'RUC', '20100000001', 'JURIDICA', 'EMPRESA DE ENSAYO SAC', 'ensayo-c11'),
       (900002, 'C-900001', 'DNI', '29614026', 'NATURAL', 'RAMOS CHUNGA, MARIA', 'ensayo-c11');
