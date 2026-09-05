#!/bin/bash
# Asigna LOGIN y clave a los roles que se conectan (ARQ-03 §4).
#
# `crear-roles.sql` los crea NOLOGIN y sin clave a proposito: dice, con todas sus
# letras, que «quien provisiona el ambiente asigna la clave desde su gestor de
# secretos». En esta instalacion quien provisiona es este guion, y el gestor de
# secretos es el archivo .env que no se versiona.
#
# Corre una sola vez, cuando el volumen de datos esta vacio, y con la conexion de
# superusuario que solo existe dentro del contenedor del motor.
#
# rol_carga_parametros SI recibe LOGIN: es la unica credencial que
# publicar-parametros.sh/publicar-cuadros.sh usan para escribir
# parametro_tributario (V6/V7) y las tablas de valuacion nacionales (V55), y sin
# LOGIN esos Jobs no pueden correr contra ningun ambiente real (issue #387).
#
# kamayuk_readonly se queda NOLOGIN: todavia no hay nada que se conecte con el, y un
# rol que puede iniciar sesion sin que nadie lo use es una credencial mas que
# rotar y vigilar.
set -euo pipefail

: "${KAMAYUK_CLAVE_OWNER:?falta KAMAYUK_CLAVE_OWNER}"
: "${KAMAYUK_CLAVE_APP:?falta KAMAYUK_CLAVE_APP}"
: "${KAMAYUK_CLAVE_CARGA:?falta KAMAYUK_CLAVE_CARGA}"

# Las claves entran como variables de psql y no interpoladas en el texto del SQL:
# `:'clave'` las entrecomilla segun las reglas de PostgreSQL, asi que una clave con
# comilla simple se asigna bien en vez de romper la sentencia —o de cambiarla—.
psql -v ON_ERROR_STOP=1 \
     --username "$POSTGRES_USER" \
     --dbname "$POSTGRES_DB" \
     -v claveOwner="$KAMAYUK_CLAVE_OWNER" \
     -v claveApp="$KAMAYUK_CLAVE_APP" \
     -v claveCarga="$KAMAYUK_CLAVE_CARGA" <<'SQL'
ALTER ROLE kamayuk_owner            LOGIN PASSWORD :'claveOwner';
ALTER ROLE kamayuk_app              LOGIN PASSWORD :'claveApp';
ALTER ROLE rol_carga_parametros  LOGIN PASSWORD :'claveCarga';
SQL

echo "Roles kamayuk_owner, kamayuk_app y rol_carga_parametros habilitados para conexion."
