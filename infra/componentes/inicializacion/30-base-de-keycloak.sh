#!/bin/bash
# Crea la base y el rol de Keycloak (issue #151).
#
# Keycloak necesita DDL sobre su propia base: cada actualizacion menor migra su
# esquema al arrancar. Dandole base y rol propios, esa DDL no toca la base del
# padron y la unica frontera que hay que vigilar sigue siendo la del motor.
#
# Este guion NO existe en el compose, y no es un olvido: alli Keycloak corre
# `start-dev` y guarda su base dentro del contenedor. En el cluster no puede, y
# por eso la base aparece aqui.
#
# Corre una sola vez, cuando el volumen de datos esta vacio, con la conexion de
# superusuario que solo existe dentro de este contenedor. Es idempotente de todos
# modos: si la base ya existe, no hace nada.
set -euo pipefail

: "${KAMAYUK_CLAVE_IDENTIDAD:?falta KAMAYUK_CLAVE_IDENTIDAD}"

# `psql -v` y `:'clave'`, igual que en 20-asignar-claves.sh: una clave con comilla
# simple se asigna bien en vez de romper la sentencia o, peor, cambiarla.
psql -v ON_ERROR_STOP=1 \
     --username "$POSTGRES_USER" \
     --dbname postgres \
     -v claveIdentidad="$KAMAYUK_CLAVE_IDENTIDAD" <<'SQL'
SELECT format('CREATE ROLE keycloak LOGIN')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'keycloak') \gexec

ALTER ROLE keycloak NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION
      LOGIN PASSWORD :'claveIdentidad';

SELECT format('CREATE DATABASE keycloak OWNER keycloak')
 WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'keycloak') \gexec
SQL

# La base del padron no es suya. Sin esto, `keycloak` heredaria de PUBLIC el
# CONNECT sobre `sgtm`: no podria ver ninguna fila —RLS esta forzada y no es
# propietaria de nada—, pero seria una credencial mas apuntando al padron.
#
# Revocar de PUBLIC obliga a conceder explicitamente a los cuatro roles del SGTM,
# que hasta ahora se conectaban por esa misma herencia. Los dos pasos van juntos y
# en este orden: al reves, la aplicacion se queda sin poder conectarse.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
REVOKE CONNECT ON DATABASE "$POSTGRES_DB" FROM PUBLIC;
GRANT  CONNECT ON DATABASE "$POSTGRES_DB"
    TO kamayuk_owner, kamayuk_app, kamayuk_readonly, rol_carga_parametros;
REVOKE CONNECT ON DATABASE keycloak FROM PUBLIC;
GRANT  CONNECT ON DATABASE keycloak TO keycloak;
SQL

echo "Base y rol de Keycloak listos."
