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

# AQUI NO SE TOCA `$POSTGRES_DB`, Y ES LO CONTRARIO DE LO QUE HACIA (`E`).
#
# Estas cuatro lineas revocaban el CONNECT de PUBLIC sobre `$POSTGRES_DB` y se lo
# devolvian a los cuatro roles, para que `keycloak` no heredara acceso al padron.
# El razonamiento valia mientras `$POSTGRES_DB` fuera `sgtm`, la base del monolito.
#
# Desde `E` vale `postgres`, la base de MANTENIMIENTO, y con ella dentro la misma
# sentencia hace un dano que nadie pidio: `40-rol-de-respaldo.sh` y
# `50-rol-de-monitoreo.sh` se conectan ahi Y LO DICEN POR ESCRITO —«conectarse a
# `postgres` evita tocar el REVOKE CONNECT que 30-base-de-keycloak.sh le hace a
# PUBLIC»—, asi que revocarlo deja al exportador sin metricas y al respaldo sin
# poder abrir sesion. Medido en CI: tres paneles de `pg_*` en «No data», y el
# respaldo habria fallado a las 06:00 con un mensaje que no se parece a su causa.
#
# Y lo que aquellas lineas protegian **ya lo hace otro**: el `crear-roles.sql` de
# cada sistema revoca el CONNECT de PUBLIC sobre SU base (C-7 §6), que es donde
# vive el padron desde el corte. `keycloak` no alcanza ninguna de las cuatro, y no
# por herencia sino porque cada una lo dice.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
REVOKE CONNECT ON DATABASE keycloak FROM PUBLIC;
GRANT  CONNECT ON DATABASE keycloak TO keycloak;
SQL

echo "Base y rol de Keycloak listos."
