#!/bin/bash
# Devuelve al realm los ambitos que Keycloak crea de fabrica y que el import borro.
#
# ── EL DEFECTO QUE ESTO REPARA ──
#
# `realm-sgtm.json` declara `clientScopes`, y en un import COMPLETO de Keycloak esa
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

restaurar() { # restaurar <realm>
  local realm="$1"
  kc get "realms/$realm" >/dev/null 2>&1 || { echo "  el realm «$realm» no existe: se omite"; return 0; }
  echo "  · $realm"
  local presentes
  presentes=$(kc get client-scopes -r "$realm" | python3 -c 'import json,sys; print(" ".join(s["name"] for s in json.load(sys.stdin)))')

  # 1. crear los que falten, con sus mapeadores tal como Keycloak los hizo
  local nombres
  nombres=$(printf '%s' "$DE_FABRICA" | python3 -c 'import json,sys; print("\n".join(s["name"] for s in json.load(sys.stdin)))')
  while IFS= read -r nombre; do
    [ -n "$nombre" ] || continue
    case " $presentes " in *" $nombre "*) echo "      $nombre ya estaba"; continue;; esac
    printf '%s' "$DE_FABRICA" | python3 -c "
import json,sys
for s in json.load(sys.stdin):
    if s['name'] != '$nombre': continue
    s.pop('id', None)
    for m in s.get('protocolMappers', []): m.pop('id', None)
    print(json.dumps(s))
" | kc create client-scopes -r "$realm" -f - >/dev/null
    echo "      $nombre creado"
  done <<< "$nombres"

  # 2. dejarlos como los de omision del realm, para que un cliente NUEVO los herede
  local ids; ids=$(kc get client-scopes -r "$realm")
  # `default-default-client-scopes` son los que un cliente nuevo hereda; los
  # `default-optional-client-scopes`, los que puede pedir por `scope=`.
  for cual in default-default default-optional; do
    local lista; [ "$cual" = default-default ] && lista="$POR_OMISION" || lista="$OPCIONALES"
    printf '%s\n%s' "$lista" "$ids" | python3 -c "
import json,sys
crudo = sys.stdin.read()
# dos documentos JSON pegados: el primero es la lista, el segundo los ambitos del realm
dec = json.JSONDecoder()
lista, i = dec.raw_decode(crudo.lstrip())
resto = crudo.lstrip()[i:].lstrip()
ambitos, _ = dec.raw_decode(resto)
porNombre = {a['name']: a['id'] for a in ambitos}
print('\n'.join(porNombre[s['name']] for s in lista if s['name'] in porNombre))
" | while IFS= read -r id; do
      [ -n "$id" ] || continue
      kc update "realms/$realm/${cual}-client-scopes/$id" >/dev/null 2>&1 || true
    done
  done

  # 3. y asignarlos a los clientes QUE YA EXISTEN: el import los dejo sin ninguno, y
  #    los de omision del realm solo los heredan los clientes nuevos.
  local clientes
  clientes=$(kc get clients -r "$realm" --fields id,clientId | python3 -c 'import json,sys; print("\n".join("%s %s" % (c["id"], c["clientId"]) for c in json.load(sys.stdin)))')
  while IFS=' ' read -r cid nombre; do
    [ -n "$cid" ] || continue
    printf '%s\n%s' "$POR_OMISION" "$ids" | python3 -c "
import json,sys
dec = json.JSONDecoder()
crudo = sys.stdin.read().lstrip()
lista, i = dec.raw_decode(crudo)
ambitos, _ = dec.raw_decode(crudo[i:].lstrip())
porNombre = {a['name']: a['id'] for a in ambitos}
print('\n'.join(porNombre[s['name']] for s in lista if s['name'] in porNombre))
" | while IFS= read -r sid; do
      [ -n "$sid" ] || continue
      kc update "clients/$cid/default-client-scopes/$sid" -r "$realm" >/dev/null 2>&1 || true
    done
    echo "      cliente $nombre: ambitos de omision asignados"
  done <<< "$clientes"
}

restaurar "$KC_REALM"
restaurar "$KC_REALM_CIUDADANO"
echo "Hecho."
