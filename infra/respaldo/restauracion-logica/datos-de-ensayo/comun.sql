-- Las dos municipalidades de ensayo. Se aplican a los CINCO esquemas antes que su archivo
-- propio, porque `municipalidad` existe con la misma forma en los cinco y porque casi todo
-- lo demas cuelga de ella por clave foranea.
--
-- Dos, y no una, por lo mismo que el resto de este producto siembra dos: una sola no puede
-- distinguir «se restauro» de «se restauro lo del inquilino equivocado».
--
-- Se inserta como SUPERUSUARIO, que es quien provisiona. Las tablas llevan RLS forzada y
-- `sgtm_owner` tambien queda sujeto a la politica (#537, #545): sembrar como el dueño
-- exigiria fijar `app.municipalidad_id` en cada sentencia, que es de la aplicacion y no
-- del aprovisionamiento.
INSERT INTO municipalidad (id, ubigeo, nombre, tipo)
OVERRIDING SYSTEM VALUE
VALUES (900001, '200101', 'Municipalidad Provincial de Ensayo', 'PROVINCIAL'),
       (900002, '200104', 'Municipalidad Distrital de Ensayo', 'DISTRITAL');

-- Una fila de tenant en una tabla que los cinco esquemas tienen, para que el recuento por
-- tabla hable tambien de la municipalidad y no solo del registro de municipalidades.
INSERT INTO modulo_sistema (municipalidad_id, codigo, nombre)
OVERRIDING SYSTEM VALUE
VALUES (900001, 'C11', 'Modulo de ensayo'),
       (900002, 'C11', 'Modulo de ensayo');
