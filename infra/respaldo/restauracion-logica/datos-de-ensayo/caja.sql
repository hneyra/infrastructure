-- `area` y `caja` son las dos tablas sin las que una instalacion no puede cobrar (#430), y
-- son las mas simples de sembrar sin inventar ninguna cifra: un area y una ventanilla no
-- llevan importe.
INSERT INTO area (municipalidad_id, codigo, nombre)
VALUES (900001, 'REN', 'RENTAS'),
       (900002, 'REN', 'RENTAS');

INSERT INTO caja (municipalidad_id, area_id, codigo, nombre, serie)
SELECT a.municipalidad_id, a.id, 'C-01', 'VENTANILLA 1', '001' FROM area a WHERE a.codigo = 'REN';
