#!/bin/bash
# Devuelve al realm los ambitos que Keycloak crea de fabrica y que el import borro.
#
# ── EL DEFECTO QUE ESTO REPARA ──
#
# `realm-kamayuk.json` declara `clientScopes`, y en un import COMPLETO de Keycloak esa
# clave **sustituye** el juego de fabrica en vez de anadirse a el. Medido contra
# Keycloak 26 con la plataforma local: un realm importado de ese archivo se queda con
# `offline_access` y `kamayuk-servicio` y **nada mas**, en vez de los TRECE que Keycloak
# crea solo (`profile`, `basic`, `email`, `roles`, `web-origins`, `acr`, …).
#
# Lo que eso rompe, y no se parece a su causa:
#
#   * sin `profile` no hay `preferred_username`, y sin `basic` no hay `sub` — que son
#     los dos claims con los que `OrigenContextFilter` identifica la cuenta. El
#     backend contesta 403 «La cuenta «» no esta dada de alta en este sistema» a
#     TODO funcionario, con un token perfectamente valido;
#   * sin `web-origins` el navegador pierde los origenes permitidos del token.
#
# No se vio antes porque `--import-realm` solo importa la PRIMERA vez: el realm que
# llevaba corriendo desde antes de que #21 anadiera `clientScopes` conservaba los de
# fabrica. Aparece la primera vez que alguien recrea el contenedor.
#
# Es el rodeo de #72. El dia que ese issue se cierre, este archivo se borra.
#
# ── POR QUE LOS PIDE Y NO LOS ESCRIBE ──
#
# Los trece ambitos son treinta mapeadores y cambian con la version de Keycloak.
# Escribirlos a mano en el realm versionado los congelaria contra la version de hoy y
# habria que remedirlos en cada actualizacion. Asi que este guion **crea un realm de
# laboratorio vacio, deja que Keycloak lo pueble, copia lo que aparezca y lo borra**:
# lo que restaura es, por construccion, lo que esta version de Keycloak considera de
# fabrica.
#
# ES IDEMPOTENTE: un ambito que ya existe no se toca, y una asignacion que ya esta
# puesta no se vuelve a pedir.
#
#   ./restaurar-ambitos-de-fabrica.sh            # sobre $KC_REALM y su realm de ciudadano
#
# Entorno: KAMAYUK_CLAVE_KEYCLOAK (obligatoria), KAMAYUK_KEYCLOAK_ADMIN, KC_REALM,
# KC_REALM_CIUDADANO, KAMAYUK_PUERTO_IDENTIDAD (o KC_URL).
#
# ── POR QUE HABLA REST Y NO `kcadm`, que es lo que hacen sus dos hermanos ──
#
# Porque `kcadm.sh` arranca una JVM en cada invocacion, y este guion hace del orden de
# **cuatrocientas** llamadas: trece ambitos por cada cliente de cada uno de los dos realms.
# Medido en esta maquina, con la plataforma local levantada:
#
#   un `docker compose exec` + un `kcadm`   2,16 s     (5 seguidos: 12,9 s)
#   un `exec` con 5 `kcadm` dentro         10,55 s     -> ~2,1 s los pone la JVM, ~0,5 el exec
#   una llamada REST con `curl`             0,028 s    (20 PUT en 0,568 s)
#
# O sea: el guion entero tardaba **12 m 31 s** y el 99 % era arrancar JVM. Por REST son
# segundos. Agrupar los `exec` no servia —la JVM es lo caro—, y fijar las listas de una vez
# con `kcadm update clients/<id> -s 'defaultClientScopes=[…]'` TAMPOCO: medido contra
# Keycloak 26, ese campo se **ignora en silencio** en un `update` —el cliente queda con cero
# ambitos y `kcadm` no protesta—, que es precisamente el estado que el centinela de abajo
# existe para cazar.
#
# Se puede hablar REST porque este guion es SOLO local: usa el Keycloak que el compose
# publica en el anfitrion, y el anfitrion tiene `curl`. La imagen de Keycloak no lo trae
# (`infra/componentes/Identidad.ts:170`), y por eso el Job del cluster y sus dos hermanos
# —`reconciliar-identidades.sh`, `crear-usuario.sh`— siguen con `kcadm`: ellos tienen que
# poder correr DENTRO de la imagen, y este no.
#
# ── LA TRAMPA QUE ESTE GUION YA NO TIENE, y sus hermanos SI ──
#
# Cuando esto hablaba por `docker compose exec -T`, cada llamada **consumia stdin**: dentro
# de un `while read … done <<< "$lista"` se tragaba el resto de la lista y el bucle moria en
# la primera vuelta **sin error**, dejando a los clientes con cero ambitos y el guion en
# verde. Se arreglo leyendo las listas a un ARRAY con `mapfile`. Aqui ya no puede pasar
# —`curl` no lee stdin—, pero la nota se queda porque `reconciliar-identidades.sh` y
# `preparar-identidades.sh` siguen usando `exec` y la trampa sigue viva para ellos.
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

: "${KAMAYUK_CLAVE_KEYCLOAK:?falta KAMAYUK_CLAVE_KEYCLOAK}"
: "${KAMAYUK_KEYCLOAK_ADMIN:=admin}"
: "${KC_REALM:=kamayuk}"
: "${KC_REALM_CIUDADANO:=${KC_REALM}-ciudadano}"

# El puerto sale del `.env` del compose, que es quien lo publica. Escribirlo aqui seria el
# defecto de #74 otra vez: `.env.ejemplo` dice 8180 y esta maquina 8181.
if [ -z "${KAMAYUK_PUERTO_IDENTIDAD:-}" ] && [ -f "$AQUI/../.env" ]; then
    KAMAYUK_PUERTO_IDENTIDAD=$(sed -nE 's/^KAMAYUK_PUERTO_IDENTIDAD=([0-9]+).*/\1/p' "$AQUI/../.env" | tail -1)
fi
KC_URL="${KC_URL:-http://localhost:${KAMAYUK_PUERTO_IDENTIDAD:-8180}}"

command -v curl >/dev/null || { echo "FALLO: no hay «curl» en el anfitrion." >&2; exit 1; }
command -v python3 >/dev/null || { echo "FALLO: no hay «python3» en el anfitrion." >&2; exit 1; }

# ── La sesion ────────────────────────────────────────────────────────────────
TOKEN=""
renovar() {
    TOKEN=$(curl -sS -X POST "$KC_URL/realms/master/protocol/openid-connect/token" \
        -d 'client_id=admin-cli' -d 'grant_type=password' \
        --data-urlencode "username=$KAMAYUK_KEYCLOAK_ADMIN" \
        --data-urlencode "password=$KAMAYUK_CLAVE_KEYCLOAK" 2>/dev/null \
        | python3 -c 'import json,sys; print(json.load(sys.stdin).get("access_token",""))' 2>/dev/null)
    [ -n "$TOKEN" ]
}
intento=0
until renovar; do
    intento=$((intento + 1))
    if [ "$intento" -ge 60 ]; then
        echo "FALLO: Keycloak no dio un token de administracion en $KC_URL (180 s)." >&2
        echo "Comprueba que la plataforma esta levantada y que KAMAYUK_CLAVE_KEYCLOAK es la" >&2
        echo "del contenedor: si el volumen es viejo, la clave es la de cuando se creo." >&2
        exit 1
    fi
    sleep 3
done

# `llamar <metodo> <ruta> [cuerpo]` deja el cuerpo en $RESPUESTA y el codigo en $ESTADO, y no
# juzga: quien llama decide que codigos son buenos. Sin `trap … RETURN` para borrar el temporal,
# que fue el primer intento y se cae solo: la trampa corre CUANDO LA FUNCION VUELVE, y entonces
# el `local salida` ya no existe — con `set -u` eso es «salida: unbound variable» sobre una linea
# que no tiene nada que ver con el defecto.
RESPUESTA=""; ESTADO=""
llamar() {
    local metodo="$1" ruta="$2" cuerpo="${3:-}" archivo
    archivo=$(mktemp)
    local args=(-sS -o "$archivo" -w '%{http_code}' -X "$metodo"
                -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')
    [ -n "$cuerpo" ] && args+=(--data-binary "$cuerpo")
    ESTADO=$(curl "${args[@]}" "$KC_URL/admin$ruta" || echo 000)
    if [ "$ESTADO" = 401 ]; then
        # El token de `admin-cli` en master dura un minuto por omision. Este guion tarda
        # segundos, pero en una maquina cargada podria pasarse, y el sintoma seria «se
        # restauraron ocho de trece» sin un solo error.
        renovar && ESTADO=$(curl "${args[@]}" "$KC_URL/admin$ruta" || echo 000)
    fi
    RESPUESTA=$(cat "$archivo"); rm -f "$archivo"
}

# api <metodo> <ruta> [cuerpo json]  -> escribe el cuerpo; falla si no es 2xx
api() {
    llamar "$@"
    case "$ESTADO" in
        2*) printf '%s' "$RESPUESTA"; return 0 ;;
        *)  echo "FALLO: $1 $2 -> HTTP $ESTADO" >&2
            printf '%s\n' "$RESPUESTA" | sed -n '1,3p' >&2
            return 1 ;;
    esac
}

# `poner <ruta>` asigna un ambito. Devuelve 0 si la asignacion es NUEVA, 10 si YA ESTABA, y
# falla con cualquier otra cosa.
#
# EL 409 NO SE PUEDE TRAGAR SIN MIRARLO, y es la diferencia con la version por `kcadm`: alli
# cada PUT iba con `2>/dev/null || true`, asi que un 409 —«ya estaba», benigno— y un 403
# —«este token no puede»— se veian exactamente igual, y el guion habria seguido hasta el
# centinela sin decir cual de los dos era. Aqui el 409 se distingue por su codigo y cualquier
# otro fallo para el guion nombrando la ruta.
poner() {
    llamar PUT "$1"
    case "$ESTADO" in
        2*)  return 0 ;;
        409) return 10 ;;
        *)   echo "FALLO: PUT $1 -> HTTP $ESTADO" >&2
             printf '%s\n' "$RESPUESTA" | sed -n '1,2p' >&2
             return 1 ;;
    esac
}

nombresDe() { printf '%s' "$1" | python3 -c 'import json,sys; print("\n".join(a["name"] for a in json.load(sys.stdin)))'; }

# Y el nombre CON SU PROTOCOLO, que hace falta para no pedir lo imposible:
#
#   `role_list` y `saml_organization` son ambitos **SAML** y estan entre los de omision del
#   realm, pero Keycloak NO los adjunta a un cliente `openid-connect`: el PUT contesta **204** y
#   no cambia nada. Medido — un cliente con seis ambitos sigue con seis despues de pedirle los
#   ocho—. Sin filtrar, eran dos peticiones inutiles por cliente y por corrida, y ademas
#   contaban como «puestas»: la segunda corrida decia «+2» para siempre y la idempotencia no se
#   podia comprobar mirando la salida.
conProtocolo() { printf '%s' "$1" | python3 -c '
import json, sys
for a in json.load(sys.stdin):
    print(a["name"] + "|" + (a.get("protocol") or "openid-connect"))'; }

# ── El laboratorio: se le PREGUNTA a Keycloak cuales son los suyos ───────────
LABORATORIO="zz-ambitos-de-fabrica-$$"
limpiar() { api DELETE "/realms/$LABORATORIO" >/dev/null 2>&1 || true; }
trap limpiar EXIT

echo "Preguntandole a Keycloak cuales son sus ambitos de fabrica (realm «$LABORATORIO»)"
api POST /realms "{\"realm\":\"$LABORATORIO\",\"enabled\":true}" >/dev/null
DE_FABRICA=$(api GET "/realms/$LABORATORIO/client-scopes")
POR_OMISION=$(api GET "/realms/$LABORATORIO/default-default-client-scopes")
OPCIONALES=$(api GET "/realms/$LABORATORIO/default-optional-client-scopes")

restaurar() { # restaurar <realm>
    local realm="$1"
    api GET "/realms/$realm" >/dev/null 2>&1 || { echo "  el realm «$realm» no existe: se omite"; return 0; }
    echo "  · $realm"

    local -a deFabrica=() porOmision=() opcionales=()
    mapfile -t deFabrica  < <(nombresDe "$DE_FABRICA")
    mapfile -t porOmision < <(nombresDe "$POR_OMISION")
    mapfile -t opcionales < <(nombresDe "$OPCIONALES")

    # 1. crear los que falten, con sus mapeadores tal como Keycloak los hizo
    local presentes nombre
    presentes=$(nombresDe "$(api GET "/realms/$realm/client-scopes")")
    for nombre in "${deFabrica[@]}"; do
        [ -n "$nombre" ] || continue
        # Sin tuberia (#91) (ver `reconciliar-identidades.sh`): un SIGPIPE aqui haria intentar
        # crear un ambito que YA esta, y eso sale por otro lado —409— acusando a otra cosa.
        [[ $'\n'"$presentes"$'\n' == *$'\n'"$nombre"$'\n'* ]] && continue
        api POST "/realms/$realm/client-scopes" "$(printf '%s' "$DE_FABRICA" | python3 -c "
import json, sys
for a in json.load(sys.stdin):
    if a['name'] != '$nombre':
        continue
    a.pop('id', None)
    for m in a.get('protocolMappers', []):
        m.pop('id', None)
    print(json.dumps(a))
")" >/dev/null
        echo "      + $nombre"
    done

    # Se vuelven a leer DESPUES de crear: los ids de los nuevos no existian antes.
    local ambitos; ambitos=$(api GET "/realms/$realm/client-scopes?briefRepresentation=true")
    idDelAmbito() { printf '%s' "$ambitos" | python3 -c "
import json, sys
print(next((a['id'] for a in json.load(sys.stdin) if a['name'] == '$1'), ''))"; }

    # 2. dejarlos como los de omision del realm, para que un cliente NUEVO los herede
    local id nuevos=0
    for nombre in "${porOmision[@]}"; do
        [ -n "$nombre" ] || continue
        id=$(idDelAmbito "$nombre"); [ -n "$id" ] || continue
        if poner "/realms/$realm/default-default-client-scopes/$id"; then nuevos=$((nuevos + 1)); fi
    done
    for nombre in "${opcionales[@]}"; do
        [ -n "$nombre" ] || continue
        id=$(idDelAmbito "$nombre"); [ -n "$id" ] || continue
        if poner "/realms/$realm/default-optional-client-scopes/$id"; then nuevos=$((nuevos + 1)); fi
    done
    echo "      los de omision del realm: $nuevos nuevo(s), el resto ya estaba"

    # 3. y asignarlos a los clientes QUE YA EXISTEN. Hace falta: los de omision del realm
    #    solo los heredan los clientes NUEVOS, y los que entraron por `--import-realm` se
    #    quedaron sin ninguno.
    #
    #    Los clientes llegan con sus DOS listas dentro —`defaultClientScopes` y
    #    `optionalClientScopes` vienen en la representacion—, asi que se pide lo que falta y
    #    nada mas: una segunda corrida no manda ni un PUT.
    local -a porOmisionP=() opcionalesP=()
    mapfile -t porOmisionP < <(conProtocolo "$POR_OMISION")
    mapfile -t opcionalesP < <(conProtocolo "$OPCIONALES")

    local -a clientes=(); local fila cid cnom protocolo tieneOmision tieneOpcional
    local par nombre proto faltan cuantos
    mapfile -t clientes < <(api GET "/realms/$realm/clients" | python3 -c '
import json, sys
for c in json.load(sys.stdin):
    print("\t".join([
        c["id"], c["clientId"], c.get("protocol") or "openid-connect",
        ",".join(c.get("defaultClientScopes") or []),
        ",".join(c.get("optionalClientScopes") or []),
    ]))')
    for fila in "${clientes[@]}"; do
        [ -n "$fila" ] || continue
        IFS=$'\t' read -r cid cnom protocolo tieneOmision tieneOpcional <<<"$fila"
        faltan=0
        for par in "${porOmisionP[@]}"; do
            nombre=${par%%|*}; proto=${par##*|}
            [ -n "$nombre" ] || continue
            [ "$proto" = "$protocolo" ] || continue
            [[ ",$tieneOmision," == *",$nombre,"* ]] && continue
            id=$(idDelAmbito "$nombre"); [ -n "$id" ] || continue
            if poner "/realms/$realm/clients/$cid/default-client-scopes/$id"; then
                faltan=$((faltan + 1))
            fi
        done
        for par in "${opcionalesP[@]}"; do
            nombre=${par%%|*}; proto=${par##*|}
            [ -n "$nombre" ] || continue
            [ "$proto" = "$protocolo" ] || continue
            [[ ",$tieneOpcional," == *",$nombre,"* ]] && continue
            id=$(idDelAmbito "$nombre"); [ -n "$id" ] || continue
            if poner "/realms/$realm/clients/$cid/optional-client-scopes/$id"; then
                faltan=$((faltan + 1))
            fi
        done

        # EL CENTINELA. Existe porque una version anterior de este guion se tragaba el fallo
        # y dejaba a los clientes sin un solo ambito, en verde. Y se vuelve a leer del
        # servidor a proposito: comprobar contra la lista que se acaba de mandar seria
        # comprobar la peticion contra si misma, que es como el `-s defaultClientScopes=[…]`
        # de `kcadm` pasaba por bueno sin asignar nada.
        cuantos=$(api GET "/realms/$realm/clients/$cid/default-client-scopes" \
            | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')
        if [ "${cuantos:-0}" -eq 0 ]; then
            echo "FALLO: el cliente «$cnom» de «$realm» se quedo sin ningun ambito de omision." >&2
            echo "Su token saldria sin «preferred_username» ni «sub», y el backend contestaria 403" >&2
            echo "«La cuenta «» no esta dada de alta en este sistema»." >&2
            exit 1
        fi
        if [ "$faltan" -gt 0 ]; then
            echo "      $cnom: $cuantos ambitos (+$faltan puestos)"
        else
            echo "      $cnom: $cuantos ambitos (ya estaban)"
        fi
    done
}

restaurar "$KC_REALM"
restaurar "$KC_REALM_CIUDADANO"
echo "Hecho."
