-- Las dos municipalidades de ensayo. Se aplican a los CINCO esquemas antes que su archivo
-- propio, porque `municipalidad` existe con la misma forma en los cinco y porque casi todo
-- lo demas cuelga de ella por clave foranea.
--
-- Dos, y no una, por lo mismo que el resto de este producto siembra dos: una sola no puede
-- distinguir «se restauro» de «se restauro lo del inquilino equivocado».
--
-- Se inserta como SUPERUSUARIO, que es quien provisiona. Las tablas llevan RLS forzada y
-- `kamayuk_owner` tambien queda sujeto a la politica (#537, #545): sembrar como el dueño
-- exigiria fijar `app.municipalidad_id` en cada sentencia, que es de la aplicacion y no
-- del aprovisionamiento.
INSERT INTO municipalidad (id, ubigeo, nombre, tipo)
OVERRIDING SYSTEM VALUE
VALUES (900001, '200101', 'Municipalidad Provincial de Ensayo', 'PROVINCIAL'),
       (900002, '200104', 'Municipalidad Distrital de Ensayo', 'DISTRITAL');

-- La fila de TENANT —la que hace que el recuento por tabla hable tambien de la
-- municipalidad y no solo del registro de municipalidades— ya no va aqui: la pone cada
-- archivo de sistema, con la MISMA sentencia en cuatro de los cinco.
--
-- Estaba aqui hasta ADR-0039, y era correcto mientras `modulo_sistema` tuviera la misma
-- forma en todos. Ya no: la de `identidad` lleva ademas `sistema character varying(20) NOT
-- NULL`, porque ese sistema es el DUENO del catalogo de accesos de los cinco y tiene que
-- decir de cual es cada modulo. Con el `INSERT` aqui, sembrar su base moriria con «null
-- value in column "sistema" violates not-null constraint» —y no en la restauracion, que es
-- lo que este simulacro mide, sino antes de llegar a ella—.
--
-- Lo que queda en este archivo es lo que de verdad es identico en los cinco esquemas, byte
-- a byte: `municipalidad`. Duplicar la sentencia de `modulo_sistema` en cuatro archivos es
-- el precio de que este no mienta, y es menor que el de una condicional sobre
-- `information_schema` que haria que «se sembro» y «no se pudo sembrar» pasaran las dos.
