-- La geometria del predio (ADR-0021, issue #400).
--
-- El alta de predios de una municipalidad real es una importacion cartografica:
-- el lote existe en el plano antes que en el padron. Hasta aqui el sistema sabia
-- leer un GeoPackage y tiraba la geometria —el guion del MEF lo dice de si mismo,
-- «no se carga en la base (la base no modela geometria)»—, de modo que el predio
-- que entraba del plano no conservaba de donde salio.
--
-- geography y no geometry, y 4326 y no una zona UTM: una instalacion atiende a
-- muchas municipalidades y el Peru abarca las zonas 17S, 18S y 19S. Un SRID fijo
-- deja a parte de los inquilinos en la proyeccion equivocada, y un SRID por
-- municipalidad no se puede expresar en una columna tipada. geography mide sobre
-- el elipsoide, en metros, sin elegir zona.
--
-- MultiPolygon porque un predio puede tener partes disjuntas, y asi se publican
-- de ordinario las capas catastrales; aceptar solo Polygon rechazaria filas
-- legitimas y obligaria a partirlas, que es inventar predios.
--
-- NULA, y sin plan de dejar de serlo: un predio declarado en ventanilla no trae
-- plano, y exigirla convertiria la inscripcion de una ficha en trabajo de
-- gabinete.
--
-- LO QUE ESTA COLUMNA NO HACE: valorizar. `ficha_catastral.area_terreno` sigue
-- siendo la que midio el tecnico y declaro el contribuyente. Derivar el area del
-- poligono cambiaria el autovaluo de TODO el padron sin que nadie lo decidiera, y
-- el error seria invisible: un area es indistinguible de otra al leerla. Que las
-- dos no coincidan es un hallazgo que se informa, no una correccion que se aplica.
ALTER TABLE predio
    ADD COLUMN geometria geography(MultiPolygon, 4326);

COMMENT ON COLUMN predio.geometria IS
    'Poligono del lote en WGS84 (ADR-0021). Informativo y de localizacion: NO es '
    'la fuente del area imponible, que es ficha_catastral.area_terreno.';

-- Sin el indice, «que predios caen en esta manzana» recorre la tabla entera, que
-- es la unica pregunta por la que la columna existe. GiST es el indice que
-- geography admite.
CREATE INDEX predio_geometria_gix
    ON predio USING GIST (geometria)
    WHERE geometria IS NOT NULL;

-- Sin GRANT nuevo: V7 concede sobre la TABLA `predio`, no por columna, asi que
-- sgtm_app la lee y la escribe con el resto de la fila. Lo que mantiene la
-- geometria fuera de HTTP no es un privilegio, es que ninguna operacion del
-- contrato la lleve: los cuerpos de alta y de correccion son listas blancas y no
-- declaran el campo, asi que un cliente no tiene por donde mandarla. Entra por la
-- carga cartografica, que corre en el perfil batch.
