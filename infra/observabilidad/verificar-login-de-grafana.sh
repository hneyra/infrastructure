#!/bin/bash
# Verifica, contra un ambiente DESPLEGADO, que Grafana se publica en `https://<dominio>/grafana`
# solo detras del realm de operacion (ADR-0041, #149): que ninguna clave abre Grafana desde
# internet, y que el rol del realm decide quien entra.
#
#   uso: KUBECONFIG=<el del ambiente> observabilidad/verificar-login-de-grafana.sh --ambiente stg|prod
#
# ── Lo que comprueba ──────────────────────────────────────────────────────────
#
# En los DOS ambientes, sin cuentas de prueba:
#   1. `/grafana/api/health` contesta por la ruta publica (Traefik llega a Grafana).
#   2. `POST /grafana/login` con la clave de `admin` da 400 `auth.client.notConfigured`: el
#      formulario no existe. Encendido daba 200 (medido): la clave abria Grafana desde internet.
#   3. Esa misma clave por *basic auth* da 401.
#   4. `/grafana/api/user` sin sesion da 401.
#   5. `/keycloak/admin/master/console/` sigue en 404: publicar Grafana no publico la consola.
#   6. `/grafana/login` lleva al realm de OPERACION, con PKCE (`code_challenge`).
#
# Donde existan las cuentas de prueba (`stg`, con `seedTestUsers`), el login entero, con `curl`:
#   7. `operador-de-prueba-lector` termina con sesion y `role: Viewer`.
#   8. `operador-de-prueba-sin-rol` termina SIN sesion. Sin `ROLE_ATTRIBUTE_STRICT` entraba como
#      `Viewer` (medido), y solo una cuenta sin rol lo ve.
#
# En `prod` no hay cuentas de prueba, y la mitad positiva es un navegador con la cuenta derivada del
# administrador (#148). El guion lo dice en vez de darlo por hecho.
#
# ── Lo que NO hace ────────────────────────────────────────────────────────────
#
# No cambia nada: solo lee `Secret` y pide paginas. Y NUNCA imprime una clave ni la pasa por la
# linea de ordenes: van por archivos de un directorio temporal con permisos 700, que se borra al salir.
set -euo pipefail

AMBIENTE=""
while [ $# -gt 0 ]; do
    case "$1" in
        --ambiente) AMBIENTE="${2:-}"; shift 2 ;;
        *) echo "uso: $0 --ambiente stg|prod" >&2; exit 2 ;;
    esac
done
case "$AMBIENTE" in
    stg | prod) ;;
    *) echo "uso: $0 --ambiente stg|prod" >&2; exit 2 ;;
esac
for herramienta in curl kubectl sed base64; do
    command -v "$herramienta" >/dev/null 2>&1 || { echo "Falta $herramienta." >&2; exit 2; }
done

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK="${AQUI}/../Pulumi.${AMBIENTE}.yaml"

# El mismo analizador minimo que `vps/comprobar-lo-asignable.sh`, y SIN TUBERIA (#91).
valor_declarado() {
    local lineas
    lineas=$(sed -n "s/^[[:space:]]*kamayuk:$1:[[:space:]]*\([^#]*\).*$/\1/p" "$STACK")
    lineas=${lineas%%$'\n'*}
    lineas=${lineas//[\"\' ]/}
    printf '%s' "${lineas//$'\r'/}"
}

DOMINIO=$(valor_declarado domain)
REALM=$(valor_declarado keycloakRealm)
[ -n "$DOMINIO" ] && [ -n "$REALM" ] || { echo "FALLO: ${STACK} no declara domain o keycloakRealm." >&2; exit 2; }
OPERACION="${REALM}-operacion"
NAMESPACE="kamayuk-${AMBIENTE}"
SECRETO="kamayuk-${AMBIENTE}-grafana"
BASE="https://${DOMINIO}"

PRIVADO=$(mktemp -d)
chmod 700 "$PRIVADO"
trap 'rm -rf "$PRIVADO"' EXIT

FALLOS=0
COMPROBADAS=0
ok() { COMPROBADAS=$((COMPROBADAS + 1)); echo "  OK     $*"; }
fallo() { COMPROBADAS=$((COMPROBADAS + 1)); FALLOS=$((FALLOS + 1)); echo "  FALLO  $*" >&2; }

# Escribe en `$PRIVADO/<clave>` el valor de esa clave del `Secret` de Grafana, sin salto final.
# Devuelve 1 si el `Secret` no la tiene: es como se sabe si hay cuentas de prueba.
clave_a_archivo() {
    local codificada valor
    codificada=$(kubectl -n "$NAMESPACE" get secret "$SECRETO" -o "jsonpath={.data.$1}" 2>/dev/null) || codificada=""
    [ -n "$codificada" ] || return 1
    # `$( … )` le quita los saltos de linea finales, y es A PROPOSITO: el Job del realm fija la
    # clave con `$(<archivo)`, que los quita igual. `curl --data-urlencode password@archivo`
    # manda el archivo ENTERO, asi que sin esto un valor con salto final seria una clave en
    # Keycloak y otra en el formulario (medido: Keycloak vuelve a pintar el formulario).
    valor=$(base64 -d <<<"$codificada")
    printf '%s' "$valor" >"$PRIVADO/$1"
}

echo "Grafana en ${BASE}/grafana (${AMBIENTE}), realm de operacion «${OPERACION}»"
echo
echo "· Ninguna clave abre Grafana desde internet"

codigo=$(curl -s -m 20 -o /dev/null -w '%{http_code}' "${BASE}/grafana/api/health") || codigo="000"
[ "$codigo" = 200 ] && ok "/grafana/api/health por la ruta publica: 200" \
    || fallo "/grafana/api/health por la ruta publica dio ${codigo}: Traefik no llega a Grafana"

if clave_a_archivo clave-admin; then
    # El cuerpo JSON se arma en un archivo: la clave no pasa por la linea de ordenes.
    printf '{"user":"admin","password":"%s"}' "$(<"$PRIVADO/clave-admin")" >"$PRIVADO/formulario.json"
    codigo=$(curl -s -m 20 -o "$PRIVADO/respuesta" -w '%{http_code}' -H 'Content-Type: application/json' \
        --data-binary "@$PRIVADO/formulario.json" "${BASE}/grafana/login") || codigo="000"
    respuesta=$(<"$PRIVADO/respuesta")
    if [ "$codigo" = 400 ] && [[ "$respuesta" == *auth.client.notConfigured* ]]; then
        ok "POST /grafana/login con la clave de admin: 400 auth.client.notConfigured (no hay formulario)"
    else
        fallo "POST /grafana/login con la clave de admin dio ${codigo}. Con 200 la clave del administrador ABRE Grafana desde internet"
    fi
    printf 'user = "admin:%s"\n' "$(<"$PRIVADO/clave-admin")" >"$PRIVADO/curl-basico"
    codigo=$(curl -s -m 20 -o /dev/null -w '%{http_code}' -K "$PRIVADO/curl-basico" "${BASE}/grafana/api/user") || codigo="000"
    [ "$codigo" = 401 ] && ok "la clave de admin por basic auth: 401" \
        || fallo "la clave de admin por basic auth dio ${codigo}: el basic auth sigue encendido"
else
    fallo "no se pudo leer ${NAMESPACE}/${SECRETO}: ¿KUBECONFIG apunta a ${AMBIENTE}?"
fi

codigo=$(curl -s -m 20 -o /dev/null -w '%{http_code}' "${BASE}/grafana/api/user") || codigo="000"
[ "$codigo" = 401 ] && ok "/grafana/api/user sin sesion: 401" \
    || fallo "/grafana/api/user sin sesion dio ${codigo}: ¿acceso anonimo?"

codigo=$(curl -s -m 20 -o /dev/null -w '%{http_code}' "${BASE}/keycloak/admin/master/console/") || codigo="000"
[ "$codigo" = 404 ] && ok "/keycloak/admin/master/console/: 404" \
    || fallo "/keycloak/admin/master/console/ dio ${codigo}: la consola de Keycloak esta publicada"

entrada=$(curl -s -m 20 -o /dev/null -w '%{redirect_url}' "${BASE}/grafana/login") || entrada=""
autorizacion=""
[ -n "$entrada" ] && { autorizacion=$(curl -s -m 20 -o /dev/null -w '%{redirect_url}' "$entrada") || autorizacion=""; }
if [[ "$autorizacion" == "${BASE}/keycloak/realms/${OPERACION}/protocol/openid-connect/auth?"*code_challenge=* ]]; then
    ok "/grafana/login lleva al realm «${OPERACION}», con PKCE"
else
    fallo "/grafana/login no lleva al realm de operacion con PKCE: «${entrada}» → «${autorizacion:0:120}»"
fi

# ── El login entero, con las cuentas de prueba ────────────────────────────────
# Devuelve en `$PRIVADO/<cuenta>.tarro` las cookies, y en DONDE_TERMINO la ultima redireccion.
iniciar_sesion() {
    local cuenta=$1 archivo_de_clave=$2 tarro="$PRIVADO/$1.tarro" autorizar pagina accion vuelta
    : >"$tarro"
    autorizar=$(curl -s -m 20 -c "$tarro" -b "$tarro" -o /dev/null -w '%{redirect_url}' "${BASE}/grafana/login/generic_oauth") || autorizar=""
    pagina=$(curl -s -m 20 -c "$tarro" -b "$tarro" "$autorizar") || pagina=""
    accion=""
    if [[ "$pagina" =~ action=\"([^\"]+)\" ]]; then
        accion=${BASH_REMATCH[1]//&amp;/&}
    fi
    if [ -z "$accion" ]; then
        DONDE_TERMINO="(Keycloak no mostro el formulario de acceso)"
        return 0
    fi
    vuelta=$(curl -s -m 20 -c "$tarro" -b "$tarro" -o /dev/null -w '%{redirect_url}' \
        --data-urlencode "username=${cuenta}" --data-urlencode "password@${archivo_de_clave}" \
        --data 'credentialId=' "$accion") || vuelta=""
    if [[ "$vuelta" != "${BASE}/grafana/login/generic_oauth?"* ]]; then
        DONDE_TERMINO="(Keycloak no devolvio a Grafana: «${vuelta:0:80}»; ¿clave o cuenta?)"
        return 0
    fi
    DONDE_TERMINO=$(curl -s -m 20 -c "$tarro" -b "$tarro" -o /dev/null -w '%{redirect_url}' "$vuelta") || DONDE_TERMINO=""
}

echo
if clave_a_archivo clave-operador-de-prueba-lector && clave_a_archivo clave-operador-de-prueba-sin-rol; then
    echo "· El rol del realm decide quien entra (cuentas de prueba)"

    iniciar_sesion operador-de-prueba-lector "$PRIVADO/clave-operador-de-prueba-lector"
    organizaciones=$(curl -s -m 20 -b "$PRIVADO/operador-de-prueba-lector.tarro" "${BASE}/grafana/api/user/orgs") || organizaciones=""
    if [[ "${organizaciones//[[:space:]]/}" == *'"role":"Viewer"'* ]]; then
        ok "operador-de-prueba-lector: sesion, role Viewer"
    else
        fallo "operador-de-prueba-lector no termino como Viewer: ${DONDE_TERMINO} · ${organizaciones:0:120}"
    fi

    iniciar_sesion operador-de-prueba-sin-rol "$PRIVADO/clave-operador-de-prueba-sin-rol"
    codigo=$(curl -s -m 20 -o /dev/null -w '%{http_code}' -b "$PRIVADO/operador-de-prueba-sin-rol.tarro" "${BASE}/grafana/api/user") || codigo="000"
    # POR QUE no entro, y no solo que no entro. Medido en local: una cuenta recreada en Keycloak
    # llega con otro `sub`, Grafana tiene la vieja y la rechaza con `user already exists` — sin
    # sesion, igual que el rol estricto. Sin mirar el motivo, un Grafana SIN rol estricto y con ese
    # conflicto saldria aqui en VERDE. Se lee entero y se compara sin tuberia (#91).
    registro=$(kubectl -n "$NAMESPACE" logs "deploy/kamayuk-${AMBIENTE}-observabilidad-grafana" --since=120s 2>/dev/null) || registro=""
    if [[ "$DONDE_TERMINO" == "("* ]]; then
        # No llego a Grafana: eso no demuestra NADA sobre el rol, ni en un sentido ni en el otro.
        fallo "operador-de-prueba-sin-rol: no se pudo recorrer el login ${DONDE_TERMINO}, asi que no se sabe si el rol estricto funciona"
    elif [[ "$registro" == *"user already exists"* ]]; then
        fallo "operador-de-prueba-sin-rol no entro, pero por «user already exists» y no por el rol: la cuenta se recreo en Keycloak y Grafana conserva la vieja. No se puede afirmar nada del rol estricto (abrir-grafana.md, «user already exists»)"
    elif [ "$codigo" = 401 ] && [[ "$DONDE_TERMINO" == "${BASE}/grafana/login" ]] \
        && [[ "$registro" == *role_attribute_strict_violation* ]]; then
        ok "operador-de-prueba-sin-rol: sin sesion, por role_attribute_strict_violation"
    elif [ "$codigo" = 401 ] && [[ "$DONDE_TERMINO" == "${BASE}/grafana/login" ]]; then
        fallo "operador-de-prueba-sin-rol no entro, pero el registro de Grafana no dice role_attribute_strict_violation: no se sabe por que"
    else
        fallo "operador-de-prueba-sin-rol obtuvo sesion (${codigo}, termino en «${DONDE_TERMINO}»): una cuenta SIN rol entra a Grafana"
    fi
else
    echo "· Sin cuentas de prueba en ${AMBIENTE}: la mitad del login NO se ensaya aqui."
    echo "  Se ensaya en un navegador, con la cuenta derivada del administrador (#148)."
fi

echo
if [ "$FALLOS" -gt 0 ]; then
    echo "FALLO: ${FALLOS} de ${COMPROBADAS} comprobaciones." >&2
    exit 1
fi
echo "Grafana solo entra por el realm de operacion: ${COMPROBADAS} comprobaciones en verde."
