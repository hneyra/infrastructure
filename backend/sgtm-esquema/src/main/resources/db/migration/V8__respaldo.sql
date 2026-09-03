-- ============================================================================
--  V8 — Estado de las copias de seguridad (RF-126)
--
--  El requisito es CONSULTAR el estado, no ejecutar el respaldo, y la diferencia
--  gobierna esta tabla entera.
--
--  La aplicacion no hace copias y no debe poder hacerlas: se conecta como
--  sgtm_app, que no tiene DDL, no es propietaria de nada y no es superusuario
--  (ARQ-03 §4). Un boton «respaldar ahora» detras de un endpoint exigiria darle
--  privilegios que se le quitaron a proposito, y seria el camino mas corto para
--  convertir una pantalla de consulta en una escalada de privilegios.
--
--  Quien hace la copia es el proceso de despliegue —pg_basebackup, el servicio
--  gestionado, lo que sea el ambiente— y quien escribe aqui es sgtm_owner, con
--  el resultado. La aplicacion solo lee.
--
--  No es tabla de tenant: una copia es del cluster entero, no de una
--  municipalidad. Va como catalogo global, con RLS y politica propia, y se
--  clasifica como tal en la prueba de aislamiento.
-- ============================================================================

CREATE TABLE respaldo (
    id           bigint       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inicio       timestamptz  NOT NULL,
    fin          timestamptz,
    resultado    varchar(12)  NOT NULL
        CHECK (resultado IN ('EN_CURSO','EXITOSO','FALLIDO')),
    -- Donde quedo la copia. No es una ruta que la aplicacion vaya a abrir: es
    -- para que quien la busque sepa donde mirar.
    destino      varchar(200) NOT NULL,
    tamano_bytes bigint       CHECK (tamano_bytes IS NULL OR tamano_bytes >= 0),
    -- El mensaje del proceso cuando fallo. Es lo unico que hace util la pantalla
    -- el dia que hace falta.
    detalle      varchar(500),
    CONSTRAINT respaldo_fechas_ck CHECK (fin IS NULL OR fin >= inicio),
    CONSTRAINT respaldo_terminado_ck
        CHECK (resultado = 'EN_CURSO' OR fin IS NOT NULL)
);

COMMENT ON TABLE respaldo IS
    'Estado de las copias de seguridad (RF-126). La aplicacion solo lee: quien hace'
    ' la copia y escribe aqui es el proceso de despliegue, como sgtm_owner.';

CREATE INDEX respaldo_inicio_ix ON respaldo (inicio DESC);

-- ---------- RLS ----------
-- La regla «toda tabla lleva RLS» es absoluta (RNF-031). Lo que cambia en un
-- catalogo global es la politica, no su existencia: aqui se lee sin contexto de
-- municipalidad porque el dato no es de ninguna.
ALTER TABLE respaldo ENABLE ROW LEVEL SECURITY;
ALTER TABLE respaldo FORCE  ROW LEVEL SECURITY;

CREATE POLICY respaldo_lectura ON respaldo
    FOR SELECT USING (true);

CREATE POLICY respaldo_escritura ON respaldo
    FOR ALL TO sgtm_owner
    USING (true) WITH CHECK (true);

-- ---------- Privilegios ----------
-- Solo lectura para la aplicacion: la pantalla consulta, no ejecuta.
GRANT SELECT ON respaldo TO sgtm_app, sgtm_readonly;
