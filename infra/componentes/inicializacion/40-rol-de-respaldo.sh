#!/bin/bash
# Crea el rol de respaldo, con lo minimo que wal-g necesita (issue #155).
#
# Ni el superusuario ni sgtm_owner: un rol propio, sin DDL, sin BYPASSRLS, que solo
# puede ejecutar `pg_backup_start`/`pg_backup_stop` y leer la configuracion del motor
# (`data_directory`, que wal-g necesita para encontrar `PGDATA`). Es el conjunto de
# privilegios que se determino EJECUTANDOLO contra un PostgreSQL real, no leyendo la
# documentacion de wal-g: con solo `REPLICATION`, `pg_backup_start` falla con
# «permission denied»; con `REPLICATION` pero sin `pg_read_all_settings`, falla al
# leer `data_directory`; con las dos concesiones de abajo y SIN `REPLICATION`,
# `wal-g backup-push` completa un respaldo entero. `REPLICATION` no hace falta: wal-g
# no usa el protocolo de replicacion para esto, lee los archivos del volumen
# directamente.
#
# Este guion NO existe en el compose, y no es un olvido: alli no hay archivado de WAL
# ni respaldo fuera del contenedor (INF-01 §1.3 no aplica a un portatil). En el
# cluster si, y por eso el rol aparece aqui.
#
# Corre una sola vez, cuando el volumen de datos esta vacio, con la conexion de
# superusuario que solo existe dentro de este contenedor. Es idempotente de todos
# modos: si el rol ya existe, no lo vuelve a crear.
set -euo pipefail

: "${SGTM_CLAVE_RESPALDO:?falta SGTM_CLAVE_RESPALDO}"

# `psql -v` y `:'clave'`, igual que en 20-asignar-claves.sh y 30-base-de-keycloak.sh:
# una clave con comilla simple se asigna bien en vez de romper la sentencia o, peor,
# cambiarla.
psql -v ON_ERROR_STOP=1 \
     --username "$POSTGRES_USER" \
     --dbname postgres \
     -v claveRespaldo="$SGTM_CLAVE_RESPALDO" <<'SQL'
SELECT format('CREATE ROLE sgtm_respaldo LOGIN')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sgtm_respaldo') \gexec

ALTER ROLE sgtm_respaldo NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION
      LOGIN PASSWORD :'claveRespaldo';

-- wal-g pregunta `data_directory` para encontrar PGDATA. Sin esto: «permission
-- denied to examine "data_directory"», y el respaldo no llega a empezar.
GRANT pg_read_all_settings TO sgtm_respaldo;

-- Lo unico que wal-g necesita para tomar un respaldo consistente sin ser
-- superusuario. Sin estos dos: «permission denied for function pg_backup_start».
GRANT EXECUTE ON FUNCTION pg_backup_start(text, boolean) TO sgtm_respaldo;
GRANT EXECUTE ON FUNCTION pg_backup_stop(boolean)        TO sgtm_respaldo;
SQL

# Se conecta a la base `postgres`, no a la del padron: `pg_backup_start`/`stop` son
# operaciones del cluster entero, no de una base, y conectarse a `postgres` evita
# tener que tocar el REVOKE CONNECT que 30-base-de-keycloak.sh le hace a PUBLIC sobre
# la base del padron —sgtm_respaldo no necesita, y por tanto no tiene, CONNECT ahi—.

echo "Rol sgtm_respaldo listo: solo pg_backup_start/stop, nada de DDL."
