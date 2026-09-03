#!/bin/bash
# Crea un usuario en el realm sgtm, con su municipalidad.
#
# Vive aqui y no dentro del realm versionado por una razon que conviene no
# discutir cada vez: un realm que trae usuarios con contrasena es la forma mas
# comoda de que esa contrasena acabe en produccion. El realm fija la estructura
# —clientes, PKCE, el mapeador del claim— y las personas las crea quien
# provisiona, con las claves de su gestor de secretos.
#
#   ./crear-usuario.sh [--reset] <usuario> <clave> [municipalidad_id]
#
# Con `--reset` la clave se asigna como TEMPORAL, se marca UPDATE_PASSWORD y se
# envia el enlace de correo de Keycloak: el usuario fija su clave en el primer
# acceso (ADR-0012). Sin `--reset` la clave es permanente —que es lo que necesitan
# los usuarios `sgtm-verificacion` de CI para el direct grant—. Para el alta
# declarativa de una municipalidad entera, ver `reconciliar-identidades.sh`.
#
# El correo, el nombre y el apellido salen de SGTM_CORREO, SGTM_NOMBRE y
# SGTM_APELLIDO; sin ellas se ponen marcadores. No son adorno: Keycloak exige los
# tres para dar por completo el perfil, y sin perfil completo el usuario no puede
# iniciar sesion aunque exista y tenga clave.
#
# El tercer argumento es el atributo del que sale el claim `municipalidad_id`
# (ADR-0005). Omitirlo crea un usuario SIN municipalidad, que es util para una
# sola cosa: comprobar que un token sin el claim recibe 403 y no llega a ningun
# controlador. No sirve para trabajar.
#
# Idempotente: si el usuario existe, le actualiza clave y atributo.
set -euo pipefail

reset=0
if [ "${1:-}" = "--reset" ]; then
  reset=1
  shift
fi

usuario="${1:?uso: crear-usuario.sh [--reset] <usuario> <clave> [municipalidad_id]}"
clave="${2:?falta la clave}"
municipalidad="${3:-}"

: "${SGTM_KEYCLOAK_ADMIN:=admin}"
: "${SGTM_CLAVE_KEYCLOAK:?falta SGTM_CLAVE_KEYCLOAK}"
: "${SGTM_KEYCLOAK_URL:=http://localhost:8180}"
: "${SGTM_KEYCLOAK_SERVICIO:=identidad}"

# kcadm corre DENTRO del contenedor de Keycloak: es donde esta la herramienta, y
# asi la clave de administracion no sale a la linea de comandos del anfitrion.
kc() {
  docker compose exec -T "$SGTM_KEYCLOAK_SERVICIO" /opt/keycloak/bin/kcadm.sh "$@"
}

kc config credentials \
  --server http://localhost:8080 \
  --realm master \
  --user "$SGTM_KEYCLOAK_ADMIN" \
  --password "$SGTM_CLAVE_KEYCLOAK" >/dev/null

# `| head -1` cerraria la tuberia antes de que kcadm termine de escribir, y con
# `pipefail` ese SIGPIPE mata el guion entero por un motivo que no tiene nada que
# ver con Keycloak. Se lee todo y se recorta despues.
buscarId() {
  local salida
  salida=$(kc get users -r sgtm -q "username=$1" --fields id --format csv --noquotes || true)
  printf '%s' "$salida" | tr -d '\r' | sed -n '1p'
}

existente=$(buscarId "$usuario")

# Keycloak valida el perfil del usuario al iniciar sesion, y por omision exige
# correo, nombre y apellido. Un usuario sin ellos se crea sin problema y luego NO
# PUEDE ENTRAR: el registro dice «Account is not fully set up» con un
# `resolve_required_actions`, que no se parece a «le falta el apellido». Se
# rellenan aqui, y una instalacion de verdad pasa los datos reales por estas tres
# variables en vez de quedarse con los marcadores.
#
# El marcador del apellido va SIN parentesis, y no es capricho: Keycloak valida
# nombre y apellido contra una lista de caracteres prohibidos —parentesis entre
# ellos— y responde `error-person-name-invalid-character`. Letras y espacios.
correo="${SGTM_CORREO:-$usuario@sgtm.invalido}"
nombre="${SGTM_NOMBRE:-$usuario}"
apellido="${SGTM_APELLIDO:-Por completar}"

if [ -z "$existente" ]; then
  if [ -n "$municipalidad" ]; then
    kc create users -r sgtm \
      -s "username=$usuario" -s enabled=true -s emailVerified=true \
      -s "email=$correo" -s "firstName=$nombre" -s "lastName=$apellido" \
      -s "attributes.municipalidad_id=$municipalidad"
  else
    kc create users -r sgtm \
      -s "username=$usuario" -s enabled=true -s emailVerified=true \
      -s "email=$correo" -s "firstName=$nombre" -s "lastName=$apellido"
  fi
  existente=$(buscarId "$usuario")
  echo "Usuario $usuario creado."
else
  if [ -n "$municipalidad" ]; then
    kc update "users/$existente" -r sgtm \
      -s "attributes.municipalidad_id=$municipalidad" \
      -s emailVerified=true -s "email=$correo" \
      -s "firstName=$nombre" -s "lastName=$apellido"
  fi
  echo "Usuario $usuario ya existia; actualizado."
fi

if [ "$reset" = 1 ]; then
  kc set-password -r sgtm --username "$usuario" --new-password "$clave" --temporary >/dev/null
  kc update "users/$existente" -r sgtm -s 'requiredActions=["UPDATE_PASSWORD"]' >/dev/null
  if kc update "users/$existente/execute-actions-email" -r sgtm -b '["UPDATE_PASSWORD"]' >/dev/null 2>&1; then
    echo "Clave TEMPORAL asignada y enlace de UPDATE_PASSWORD enviado a «$usuario»."
  else
    echo "Clave TEMPORAL asignada; el correo de UPDATE_PASSWORD no salio (¿SMTP sin configurar?)." >&2
  fi
  echo "Municipalidad: ${municipalidad:-«ninguna, solo para verificar el 403»}"
else
  kc set-password -r sgtm --username "$usuario" --new-password "$clave" >/dev/null
  echo "Clave asignada. Municipalidad: ${municipalidad:-«ninguna, solo para verificar el 403»}"
fi
