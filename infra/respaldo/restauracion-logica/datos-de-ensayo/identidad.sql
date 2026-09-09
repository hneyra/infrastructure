-- `identidad` (ADR-0039) guarda quien puede hacer que, y sus once tablas propias son un
-- grafo: `usuario` y `grupo` cuelgan de la municipalidad, `miembro` de los dos, `acceso` de
-- `modulo_sistema`, y `permiso` de `acceso` mas uno de los dos anteriores. Lo que se siembra
-- aqui es una rama entera de ese grafo, que es lo unico que hace que la restauracion diga
-- algo: una tabla suelta se restaura bien aunque las claves foraneas se hayan perdido.
--
-- No hay ninguna cifra que inventar —aqui no vive ni un importe ni un valor normativo—, asi
-- que a diferencia de `normativa` este archivo si puede sembrar lo suyo.

-- La fila de tenant que `comun.sql` tenia hasta ADR-0039, con SU forma: `modulo_sistema` de
-- este sistema lleva ademas `sistema NOT NULL`, porque es el catalogo de los CINCO y tiene
-- que decir de cual es cada modulo. Es exactamente el motivo por el que esa sentencia dejo
-- de ser comun; ver la cabecera de `comun.sql`.
INSERT INTO modulo_sistema (municipalidad_id, sistema, codigo, nombre)
OVERRIDING SYSTEM VALUE
VALUES (900001, 'rentas', 'C11', 'Modulo de ensayo'),
       (900002, 'rentas', 'C11', 'Modulo de ensayo');

-- El usuario y el grupo de cada municipalidad. `usuario.cuenta` es lo unico que une esta
-- fila con la identidad del token (ADR-0005), asi que se siembra con un nombre que no puede
-- confundirse con ninguna cuenta real.
INSERT INTO usuario (municipalidad_id, cuenta, nombre, habilitado)
OVERRIDING SYSTEM VALUE
VALUES (900001, 'ensayo.c11', 'Usuario de ensayo C-11', true),
       (900002, 'ensayo.c11', 'Usuario de ensayo C-11', true);

INSERT INTO grupo (municipalidad_id, nombre, descripcion, habilitado)
OVERRIDING SYSTEM VALUE
VALUES (900001, 'ENSAYO C-11', 'Grupo de ensayo del simulacro', true),
       (900002, 'ENSAYO C-11', 'Grupo de ensayo del simulacro', true);

-- Y la pertenencia, que es la fila con DOS claves foraneas dentro del mismo inquilino: es
-- la que deja de cuadrar si la restauracion mezcla las dos municipalidades, que es
-- justamente lo que este simulacro existe para poder distinguir.
INSERT INTO miembro (municipalidad_id, grupo_id, usuario_id, usuario_alta)
SELECT g.municipalidad_id, g.id, u.id, 'ensayo'
FROM grupo g
JOIN usuario u ON u.municipalidad_id = g.municipalidad_id AND u.cuenta = 'ensayo.c11'
WHERE g.nombre = 'ENSAYO C-11';

-- El acceso y su permiso: la rama que va de `modulo_sistema` a `permiso` pasando por
-- `acceso`. Sin ella, la tabla que de verdad decide la autorizacion —`permiso`— se
-- restauraria vacia y el recuento por tabla no lo diria.
--
-- `sistema` y `tipo` van explicitos y con un valor del `CHECK` de su columna
-- (`acceso_sistema_check` admite los cinco del producto; `acceso_tipo_check`, «OPCION_MENU»
-- o «POLITICA»): un valor inventado no falla al escribirlo mal, falla al aplicarlo, y este
-- guion siembra ANTES del volcado — un dato que no entra deja el simulacro midiendo una
-- base mas vacia de lo que dice.
INSERT INTO acceso (municipalidad_id, modulo_id, sistema, tipo, codigo, nombre)
SELECT m.municipalidad_id, m.id, m.sistema, 'OPCION_MENU', 'C11-001', 'Opcion de ensayo'
FROM modulo_sistema m
WHERE m.codigo = 'C11';

INSERT INTO permiso (municipalidad_id, acceso_id, grupo_id, lectura, usuario_registro)
SELECT a.municipalidad_id, a.id, g.id, true, 'ensayo'
FROM acceso a
JOIN grupo g ON g.municipalidad_id = a.municipalidad_id AND g.nombre = 'ENSAYO C-11'
WHERE a.codigo = 'C11-001';
