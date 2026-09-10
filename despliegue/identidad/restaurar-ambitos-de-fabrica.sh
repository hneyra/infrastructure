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
# ── POR QUE LOS PIDE Y NO LOS ESCRIBE ──
#
# Los trece ambitos son treinta mapeadores y cambian con la version de Keycloak.
# Escribirlos a mano en el realm versionado los congelaria contra la version de hoy y
# habria que remedirlos en cada actualizacion. Asi que este guion **crea un realm de
# laboratorio vacio, deja que Keycloak lo pueble, copia lo que aparezca y lo borra**:
# lo que restaura es, por construccion, lo que esta version de Keycloak considera de
# fabrica.
#
# ES IDEMPOTENTE: un ambito que ya existe no se toca.
#
#   ./restaurar-ambitos-de-fabrica.sh            # sobre $KC_REALM y su realm de ciudadano
#
# Entorno: KAMAYUK_CLAVE_KEYCLOAK (obligatoria), KAMAYUK_KEYCLOAK_ADMIN, KC_REALM,
# KC_REALM_CIUDADANO, KAMAYUK_KEYCLOAK_SERVICIO, COMPOSE_FILE.
set -euo pipefail

: "${KAMAYUK_CLAVE_KEYCLOAK:?falta KAMAYUK_CLAVE_KEYCLOAK}"
: "${KAMAYUK_KEYCLOAK_ADMIN:=admin}"
: "${KAMAYUK_KEYCLOAK_SERVICIO:=identidad}"
: "${KC_REALM:=kamayuk}"
: "${KC_REALM_CIUDADANO:=${KC_REALM}-ciudadano}"
LABORATORIO="zz-ambitos-de-fabrica-$$"

kc() { docker compose exec -T "$KAMAYUK_KEYCLOAK_SERVICIO" /opt/keycloak/bin/kcadm.sh "$@"; }

kc config credentials --server http://localhost:8080 --realm master \
  --user "$KAMAYUK_KEYCLOAK_ADMIN" --password "$KAMAYUK_CLAVE_KEYCLOAK" >/dev/null

limpiar() { kc delete "realms/$LABORATORIO" >/dev/null 2>&1 || true; }
trap limpiar EXIT

echo "Preguntandole a Keycloak cuales son sus ambitos de fabrica (realm «$LABORATORIO»)"
kc create realms -s "realm=$LABORATORIO" -s enabled=true >/dev/null
DE_FABRICA=$(kc get client-scopes -r "$LABORATORIO")
POR_OMISION=$(kc get "realms/$LABORATORIO/default-default-client-scopes")
OPCIONALES=$(kc get "realms/$LABORATORIO/default-optional-client-scopes")

# ── UNA TRAMPA QUE COSTO DOS MEDIDAS, Y QUE CONVIENE NO REDESCUBRIR ──
#
# `kc()` es `docker compose exec -T`, y eso **consume stdin**. Dentro de un
# `while read ... done <<< "$lista"` se traga el resto de la lista, asi que el bucle
# muere en la primera vuelta **sin error**: la primera asignacion se hace y las demas
# no. La primera version de este guion lo tenia asi y dejaba a los clientes del realm
# de funcionarios con cero ambitos — token sin `preferred_username`, 403 «La cuenta «»
# no esta dada de alta».
#
# Por eso todas las listas se leen a un ARRAY con `mapfile` y se recorren con `for`:
# asi ningun `kc` compite por la entrada estandar.

nombresDe() { printf '%s' "$1" | python3 -c 'import json,sys; print("\n".join(a["name"] for a in json.load(sys.stdin)))'; }

# id de un ambito POR NOMBRE. No se usa `-q name=...`: ese endpoint de Keycloak
# ignora el parametro y devuelve todos, asi que filtrar en cliente es lo unico fiable.
idDelAmbito() { printf '%s' "$2" | python3 -c "
import json,sys
print(next((a['id'] for a in json.load(sys.stdin) if a['name'] == '$1'), ''))"; }

restaurar() { # restaurar <realm>
  local realm="$1"
  kc get "realms/$realm" >/dev/null 2>&1 || { echo "  el realm «$realm» no existe: se omite"; return 0; }
  echo "  · $realm"

  local presentes nombre
  presentes=$(nombresDe "$(kc get client-scopes -r "$realm")")
  local -a deFabrica=(); mapfile -t deFabrica < <(nombresDe "$DE_FABRICA")

  # 1. crear los que falten, con sus mapeadores tal como Keycloak los hizo
  for nombre in "${deFabrica[@]}"; do
    [ -n "$nombre" ] || continue
    if printf '%s\n' "$presentes" | grep -qxF "$nombre"; then continue; fi
    printf '%s' "$DE_FABRICA" | python3 -c "
import json,sys
for a in json.load(sys.stdin):
    if a['name'] != '$nombre': continue
    a.pop('id', None)
    for m in a.get('protocolMappers', []): m.pop('id', None)
    print(json.dumps(a))
" | kc create client-scopes -r "$realm" -f - >/dev/null
    echo "      + $nombre"
  done

  # Se vuelven a leer DESPUES de crear: los ids de los nuevos no existian antes.
  local ambitos; ambitos=$(kc get client-scopes -r "$realm" --fields id,name)

  local -a porOmision=() opcionales=()
  mapfile -t porOmision < <(nombresDe "$POR_OMISION")
  mapfile -t opcionales < <(nombresDe "$OPCIONALES")

  # 2. dejarlos como los de omision del realm, para que un cliente NUEVO los herede
  local id
  for nombre in "${porOmision[@]}"; do
    [ -n "$nombre" ] || continue
    id=$(idDelAmbito "$nombre" "$ambitos"); [ -n "$id" ] || continue
    kc update "realms/$realm/default-default-client-scopes/$id" >/dev/null 2>&1 || true
  done
  for nombre in "${opcionales[@]}"; do
    [ -n "$nombre" ] || continue
    id=$(idDelAmbito "$nombre" "$ambitos"); [ -n "$id" ] || continue
    kc update "realms/$realm/default-optional-client-scopes/$id" >/dev/null 2>&1 || true
  done

  # 3. y asignarlos a los clientes QUE YA EXISTEN. Hace falta: los de omision del realm
  #    solo los heredan los clientes NUEVOS, y los que entraron por `--import-realm` se
  #    quedaron sin ninguno.
  local -a clientes=(); local cid cnom sid cuantos fila
  mapfile -t clientes < <(kc get clients -r "$realm" --fields id,clientId | python3 -c '
import json,sys
for c in json.load(sys.stdin): print(c["id"], c["clientId"])')
  for fila in "${clientes[@]}"; do
    [ -n "$fila" ] || continue
    cid=${fila%% *}; cnom=${fila#* }
    for nombre in "${porOmision[@]}"; do
      [ -n "$nombre" ] || continue
      sid=$(idDelAmbito "$nombre" "$ambitos"); [ -n "$sid" ] || continue
      kc update "clients/$cid/default-client-scopes/$sid" -r "$realm" >/dev/null 2>&1 || true
    done

    # EL CENTINELA. Existe porque la version anterior de este guion se tragaba el fallo
    # y dejaba a los clientes sin un solo ambito, en verde.
    cuantos=$(kc get "clients/$cid/default-client-scopes" -r "$realm" 2>/dev/null \
      | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')
    if [ "${cuantos:-0}" -eq 0 ]; then
      echo "FALLO: el cliente «$cnom» de «$realm» se quedo sin ningun ambito de omision." >&2
      echo "Su token saldria sin «preferred_username» ni «sub», y el backend contestaria 403" >&2
      echo "«La cuenta «» no esta dada de alta en este sistema»." >&2
      exit 1
    fi
    echo "      $cnom: $cuantos ambitos"
  done
}

restaurar "$KC_REALM"
restaurar "$KC_REALM_CIUDADANO"
echo "Hecho."
