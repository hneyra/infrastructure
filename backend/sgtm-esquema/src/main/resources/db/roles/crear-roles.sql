-- ============================================================================
--  SGTM — Roles de base de datos (ARQ-03 §4)
--
--  NO es una migracion de Flyway. Se ejecuta ANTES de la primera migracion, con
--  una conexion de superusuario, porque:
--    - las politicas RLS de V6 nombran roles y estos deben existir;
--    - sgtm_owner necesita CREATE sobre el esquema para poder migrar;
--    - un rol no puede crearse a si mismo.
--
--  Idempotente: se puede volver a ejecutar sobre una base ya provisionada.
--
--  Las CLAVES NO ESTAN AQUI. Los roles se crean sin LOGIN; quien provisiona el
--  ambiente asigna la clave con `ALTER ROLE ... LOGIN PASSWORD ...` desde su
--  gestor de secretos. La prueba de aislamiento hace lo mismo con claves
--  generadas al vuelo.
--
--  NOSUPERUSER y NOBYPASSRLS son explicitos y no decorativos: un superusuario
--  omite RLS incluso con FORCE ROW LEVEL SECURITY (DAT-01 §0, hallazgo 1).
-- ============================================================================

DO $roles$
DECLARE
    r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['sgtm_owner', 'sgtm_app', 'sgtm_readonly', 'rol_carga_parametros']
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('CREATE ROLE %I NOLOGIN', r);
        END IF;
        EXECUTE format(
            'ALTER ROLE %I NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION', r);
    END LOOP;
END
$roles$;

-- Solo sgtm_owner hace DDL. La aplicacion nunca.
GRANT USAGE, CREATE ON SCHEMA public TO sgtm_owner;
GRANT USAGE           ON SCHEMA public TO sgtm_app, sgtm_readonly, rol_carga_parametros;

-- Sin GRANT de pertenencia entre roles: sgtm_owner concede privilegios sobre sus
-- propias tablas sin necesitarla, y ser miembro de sgtm_app le permitiria un
-- SET ROLE que borra la separacion.

-- ---------- Extensiones ----------
-- Van aqui por el mismo motivo que los roles: sgtm_owner no puede instalarlas
-- —no tiene CREATE sobre la base y no queremos darselo—, y la migracion que las
-- usa necesita que ya existan. Instalar una extension es provisionar el ambiente,
-- no versionar el esquema.
--
--   pg_trgm   busqueda de contribuyentes por aproximacion de nombre (RF-014).
--             Sin ella, un nombre mal escrito en ventanilla no encuentra a nadie
--             y se da de alta al mismo contribuyente por segunda vez.
--   unaccent  para que «PEÑA» y «PENA» sean el mismo nombre.
--
-- Las dos son trusted desde PostgreSQL 13, asi que en un ambiente donde
-- sgtm_owner sea dueño de la base tampoco harian falta privilegios especiales.
--   postgis   la geometria del predio (ADR-0021, V61). A diferencia de las dos
--             anteriores NO es trusted, asi que hace falta un superusuario: no
--             hay forma de que la instale la migracion, que corre como
--             sgtm_owner. Trae consigo la tabla `spatial_ref_sys`, un catalogo
--             de sistemas de coordenadas sin dato municipal, que por eso figura
--             entre las TABLAS_EXENTAS de la prueba de aislamiento.
--   btree_gist  compara bigint y varchar con `=` DENTRO de un indice GiST, que es
--             lo que `EXCLUDE USING gist` necesita para decir «dos vigencias del
--             mismo predio no se pisan» (#669, V72). Es *trusted* —medido:
--             `SELECT trusted FROM pg_available_extension_versions WHERE
--             name='btree_gist'` da `t`— y aun asi va AQUI y no en la migracion,
--             porque una extension trusted la crea quien tiene CREATE sobre la
--             BASE, y `sgtm_owner` no es su dueño: intentarlo desde la migracion
--             da «permission denied to create extension "btree_gist"». Medido
--             ejecutando, no supuesto.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;
