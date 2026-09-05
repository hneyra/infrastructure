#!/bin/bash
# Crea el rol de monitoreo, con el predefinido de PostgreSQL para esto (issue #156).
#
# `pg_monitor` es un rol predefinido desde PostgreSQL 10: da SELECT sobre las vistas
# de estadisticas (`pg_stat_activity`, `pg_stat_replication`, etc.) y EXECUTE sobre
# las funciones de diagnostico, sin DDL y sin ver una sola fila de datos del padron.
# Comprobado contra un motor real: con el, `postgres_exporter` lee todo lo que
# necesita; sin el, todo lo que puede consultar sgtm_monitor es su propia sesion.
#
# Este guion NO existe en el compose, y no es un olvido: alli nadie recolecta
# metricas. En el cluster si, y por eso el rol aparece aqui.
#
# Corre una sola vez, cuando el volumen de datos esta vacio, con la conexion de
# superusuario que solo existe dentro de este contenedor. Es idempotente de todos
# modos: si el rol ya existe, no lo vuelve a crear.
set -euo pipefail

: "${KAMAYUK_CLAVE_MONITOREO:?falta KAMAYUK_CLAVE_MONITOREO}"

psql -v ON_ERROR_STOP=1 \
     --username "$POSTGRES_USER" \
     --dbname postgres \
     -v claveMonitoreo="$KAMAYUK_CLAVE_MONITOREO" <<'SQL'
SELECT format('CREATE ROLE sgtm_monitor LOGIN')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sgtm_monitor') \gexec

ALTER ROLE sgtm_monitor NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION
      LOGIN PASSWORD :'claveMonitoreo';

-- El unico privilegio que postgres_exporter necesita: lectura de las vistas de
-- estadisticas, nada de las tablas del padron.
GRANT pg_monitor TO sgtm_monitor;
SQL

# Se conecta a la base `postgres`, igual que sgtm_respaldo (40-rol-de-respaldo.sh):
# las vistas de `pg_monitor` son del cluster, no de una base, y conectarse a
# `postgres` evita tocar el REVOKE CONNECT que 30-base-de-keycloak.sh le hace a
# PUBLIC sobre la base del padron.

echo "Rol sgtm_monitor listo: pg_monitor, nada de DDL."
