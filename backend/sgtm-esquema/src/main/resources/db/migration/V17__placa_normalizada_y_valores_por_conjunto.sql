-- Dos correcciones al padron vehicular de V2, y las dos salen de comparar el
-- esquema con lo que el dominio ya decidia (#26).
--
-- ---------------------------------------------------------------------------
-- 1. La unicidad de la placa no coincidia con la del dominio
-- ---------------------------------------------------------------------------
--
-- `Placa` normaliza al construirse y compara SIN el guion: para el dominio,
-- 'ABC-123' y 'ABC123' son el mismo vehiculo, y con razon —es un dato que se
-- teclea en la via publica y llega escrito de las dos formas—.
--
-- La restriccion de V2 comparaba el texto tal cual, asi que la base admitia las
-- dos filas. El efecto no es un duplicado incomodo: son dos vehiculos con dos
-- historiales de papeletas, y el que se libra de una cobranza es el que el
-- operador no escribio igual.
--
-- Se conserva el texto como se escribio —el guion es separador de lectura y la
-- papeleta impresa lo reproduce— y se exige unicidad sobre la forma normalizada.
-- Tiene que ser un indice unico y no una CONSTRAINT UNIQUE porque una
-- restriccion no admite expresiones.
ALTER TABLE vehiculo DROP CONSTRAINT vehiculo_placa_uq;

CREATE UNIQUE INDEX vehiculo_placa_uq
    ON vehiculo (municipalidad_id, replace(placa, '-', ''));

COMMENT ON INDEX vehiculo_placa_uq IS
    'Unicidad sobre la placa sin guion: para el dominio ABC-123 y ABC123 son la misma';

-- ---------------------------------------------------------------------------
-- 2. Los valores referenciales se resolvian por ejercicio, no por conjunto
-- ---------------------------------------------------------------------------
--
-- Es el defecto que la lectura sellada (#14) ya demostro en su momento sobre los
-- parametros: resolver por ejercicio devuelve la version vigente HOY, no la que
-- se uso al determinar. Un ejercicio puede tener varias versiones selladas
-- —V10__varias_versiones_selladas.sql existe justamente por eso—, y con la clave
-- puesta en el ejercicio, recalcular una determinacion de 2026 en 2028 da otra
-- cifra sin que nada avise.
--
-- El valor referencial es un parametro tributario mas: cuelga del conjunto.
ALTER TABLE valor_referencial_vehiculo
    ADD COLUMN conjunto_id bigint;

-- No hay filas todavia —ninguna municipalidad esta dada de alta (#120)—, asi que
-- el NOT NULL entra sin relleno. Si alguna vez las hubiera, esta migracion
-- fallaria en vez de inventarles un conjunto, que es lo correcto.
ALTER TABLE valor_referencial_vehiculo
    ALTER COLUMN conjunto_id SET NOT NULL;

-- NOT VALID, y no es un atajo: es la unica forma que hay.
--
-- Validar una clave foranea recien creada es una CONSULTA sobre la tabla, y esta
-- tabla tiene Row Level Security con FORCE. La consulta que PostgreSQL lanza para
-- validar queda sujeta a la politica, la politica lee `app.municipalidad_id`, y el
-- migrador corre como sgtm_owner sin contexto de tenant —correctamente: migrar no
-- es atender la peticion de ninguna municipalidad—. El resultado es
--
--   ERROR: unrecognized configuration parameter "app.municipalidad_id"
--
-- y la migracion entera se cae. No sale en la revision: sale al ejecutarla.
--
-- NOT VALID salta ese escaneo y **no** debilita nada hacia adelante: la
-- restriccion se comprueba en cada INSERT y en cada UPDATE desde este momento. Lo
-- unico que no se verifica son las filas anteriores, y no hay ninguna.
--
-- Las tablas de V1 no tienen este problema porque sus claves foraneas nacieron
-- antes que las politicas de V6. Toda clave foranea que se agregue de aqui en
-- adelante sobre una tabla de tenant va a chocar con esto.
ALTER TABLE valor_referencial_vehiculo
    ADD CONSTRAINT valor_referencial_conjunto_fk
        FOREIGN KEY (municipalidad_id, conjunto_id)
        REFERENCES conjunto_parametros (municipalidad_id, id)
        NOT VALID;

-- La unicidad pasa a ser por conjunto. Dentro de un conjunto sigue habiendo un
-- solo valor por marca, modelo y anio; entre conjuntos puede cambiar, que es
-- justo lo que antes no se podia expresar.
ALTER TABLE valor_referencial_vehiculo DROP CONSTRAINT valor_referencial_uq;

ALTER TABLE valor_referencial_vehiculo
    ADD CONSTRAINT valor_referencial_uq
        UNIQUE (municipalidad_id, conjunto_id, marca, modelo, anio_fabricacion);

-- El catalogo de marcas y modelos se lee de aqui —no hay tabla propia: la lista
-- mantenible ES la tabla de valores—, y siempre acotado a un conjunto.
CREATE INDEX valor_referencial_catalogo_ix
    ON valor_referencial_vehiculo (municipalidad_id, conjunto_id, marca, modelo);
