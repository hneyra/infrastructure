#!/bin/bash
# Deja el Keycloak de una instalacion LOCAL en condiciones de emitir tokens que SIRVAN.
#
# Un solo comando en lugar de los cuatro pasos a mano que describian 78 lineas de
# `identidad/despliegue/pruebas-e2e/README.md`. Es idempotente: la segunda corrida no
# cambia nada.
#
#   ./preparar-identidades.sh                        # con el `.env` de al lado
#   CLAVE_DEL_ADMINISTRADOR=… ./preparar-identidades.sh
#
# ── VA DESPUES DE LEVANTAR EL SISTEMA, y no es un detalle de orden ────────────
#
# Los pasos 2 y 4 necesitan el `id` que la SECUENCIA le dio a la municipalidad, y esa fila la
# escribe la IMPLANTACION del sistema. Asi que el orden es: plataforma -> sistema -> esto, y es
# lo que `levantar-todo.sh` encadena. Corrido antes, el paso 2 falla diciendo exactamente eso
# en vez de dejar un realm a medias.
#
# ── TRES DE LOS CUATRO PASOS SON RODEOS DE DEFECTOS ABIERTOS ──────────────────
#
# Y van etiquetados con su issue, para que este guion se caiga a trozos el dia que se cierren:
#
#   paso 1  rodeo de #72  un `clientScopes` NO VACIO en el realm versionado borra los trece
#                         ambitos de fabrica de Keycloak. Sin `profile` el token no lleva
#                         `preferred_username` y sin `basic` no lleva `sub`, asi que TODO
#                         funcionario recibe 403 con un token perfectamente valido.
#   paso 3  parte de #74  `CLAVES_DE_SERVICIO` no tiene ninguna fuente en compose: en el
#                         cluster es un `Secret` montado, y aqui no hay quien lo escriba.
#   paso 4  rodeo de #73  el claim `municipalidad_id` se escribe con TRES valores distintos
#                         segun quien lo escriba —el ubigeo (200105), el `municipalidadId`
#                         del JSON (9) y el id de la secuencia (1)— y nada los reconcilia.
#                         Solo el ultimo lo entiende el RLS de la base.
#
# Y `COMPOSE_FILE` lo pone este guion, que es el resto de #74: sus tres hermanos hacen
# `docker compose` sin `-f` y el compose de la plataforma no se llama con un nombre por
# omision, asi que hoy hay que exportarlo a mano antes de cada uno.
#
# ── UNA DESVIACION RESPECTO DEL JOB DEL CLUSTER, con su motivo ────────────────
#
# El Job encadena `reconciliar-realm.sh && reconciliar-identidades.sh && … servicios`
# (`infra/componentes/Identidad.ts:986-996`). Aqui el realm lo aplica el `--import-realm` del
# compose, y el alta del administrador NO se hace con `reconciliar-identidades.sh`: ese guion
# da de alta a `administrador` —que es quien `municipalidades/200105.json` declara— SIN CLAVE
# y con UPDATE_PASSWORD pendiente, y le manda un enlace por correo (ADR-0012, y es lo
# correcto: el sistema no guarda contrasenas). Un usuario asi no puede pedir un token por
# `grant_type=password`, que es lo unico que un arnes puede usar. Asi que en esa posicion va
# `crear-usuario.sh` SIN `--reset`, que fija una clave permanente y es para lo que existe.
# El orden —estructura, la persona, los servicios— es el mismo.
set -uo pipefail

AQUI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DESPLIEGUE=$(dirname "$AQUI")
# La base se DERIVA del directorio en que vive este guion —`despliegue/identidad/`— y no se
# escribe como literal. Lo exige `bases-de-los-guiones.test.ts` (#16), y su motivo es el que
# costo dos de las cuatro corridas de `E`: una omision fijada a una base que NO es el padron
# se la come el censo en verde —«postgres» existe— y quien llama sin decir la suya acaba
# LEYENDO LO QUE ACABA DE ESCRIBIR en otra base, con un «relation … does not exist» que manda
# a mirar el esquema y no la conexion. Una omision que se resuelve a una VARIABLE no es una
# eleccion escrita, y es la forma que esa guarda permite.
BASE_DEL_SISTEMA="${BASE_DEL_SISTEMA:-$(basename "$AQUI")}"

paso() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m·\033[0m %s\n' "$*"; }

# Cada rotura tiene que fallar nombrando SU paso, no con un 403 lejano.
# `ejecutar <paso> <remedio> -- <orden…>` corre la orden en silencio si va bien, y si falla
# imprime SU SALIDA antes del remedio.
#
# La primera version redirigia a /dev/null y solo imprimia el remedio, y medido eso es peor que
# no decir nada: al apartar una clave de servicio, el guion acuso a la ESTRUCTURA del realm
# —«si dice que falta el ambito kamayuk-servicio…»— cuando la causa era otra. Una conjetura
# impresa como diagnostico manda a mirar donde no esta el defecto.
ejecutar() {
    local paso="$1" remedio="$2"; shift 3   # el tercero es el «--»
    local registro; registro=$(mktemp)
    if "$@" >"$registro" 2>&1; then rm -f "$registro"; return 0; fi
    printf '\n\033[31mFALLO en «%s».\033[0m\n' "$paso" >&2
    printf -- '── lo que dijo «%s» ──\n' "$(basename "$1")" >&2
    tail -20 "$registro" >&2
    printf -- '──\n%s\n' "$remedio" >&2
    rm -f "$registro"
    exit 1
}

muere() { # muere <paso> <que hacer>
    printf '\n\033[31mFALLO en «%s».\033[0m\n' "$1" >&2
    printf '%s\n' "$2" >&2
    exit 1
}

# ── El entorno, leido de donde vive ───────────────────────────────────────────
[ -f "$DESPLIEGUE/.env" ] || muere "el entorno" \
"No esta «$DESPLIEGUE/.env». Se genera de «.env.ejemplo» con una clave DISTINTA por marcador
  —el `sed` de su cabecera pone la MISMA seis veces; el procedimiento bueno esta en
  docs/D0-desarrollo/entorno-local.md—, o lo hace «levantar-todo.sh» por su cuenta."
# El `.env` se lee con el analizador de bash —que es el unico que entiende sus comillas igual
# que `docker compose`—, pero NO PISA lo que ya viene del entorno. `set -a; . .env` si lo pisa,
# y eso vuelve imposible forzar una variable desde la linea de ordenes: sin esto no se puede
# romper un paso a proposito y ver si falla nombrandose, que es lo que hay que poder hacer.
YA_VENIAN=$(declare -p $(compgen -v | grep -E '^(KAMAYUK_|KC_|CLAVE|CLAVES_DE_SERVICIO|BASE_DEL_SISTEMA)') 2>/dev/null || true)
set -a; . "$DESPLIEGUE/.env"; set +a
[ -n "$YA_VENIAN" ] && eval "$YA_VENIAN"
export COMPOSE_FILE="${COMPOSE_FILE:-plataforma.compose.yaml}"
: "${KAMAYUK_CLAVE_KEYCLOAK:?falta KAMAYUK_CLAVE_KEYCLOAK en el .env}"
: "${KAMAYUK_KEYCLOAK_ADMIN:=admin}"
: "${KAMAYUK_KEYCLOAK_SERVICIO:=identidad}"
: "${KAMAYUK_UBIGEO:?falta KAMAYUK_UBIGEO en el .env}"
: "${KAMAYUK_ADMINISTRADOR:?falta KAMAYUK_ADMINISTRADOR en el .env}"
: "${CLAVES_DE_SERVICIO:=$DESPLIEGUE/.claves-de-servicio}"
export CLAVES_DE_SERVICIO UBIGEO="$KAMAYUK_UBIGEO"

# El realm se DERIVA del archivo versionado y no se escribe aqui: escribirlo seria un cuarto
# sitio con el mismo nombre, y #70 existe porque ya habia tres que se separaron.
DECLARADO="$AQUI/realm-kamayuk.json"
KC_REALM="${KC_REALM:-$(python3 -c "import json;print(json.load(open('$DECLARADO'))['realm'])" 2>/dev/null)}"
[ -n "$KC_REALM" ] || muere "el entorno" "No se pudo leer «realm» de «$DECLARADO»."
export KC_REALM

MUNICIPALIDAD_JSON="$AQUI/municipalidades/$KAMAYUK_UBIGEO.json"
[ -f "$MUNICIPALIDAD_JSON" ] || muere "el entorno" \
"No esta «$MUNICIPALIDAD_JSON». El `.env` dice KAMAYUK_UBIGEO=$KAMAYUK_UBIGEO y ninguna
  municipalidad con ese ubigeo esta declarada: $(cd "$AQUI/municipalidades" && ls *.json | tr '\n' ' ')"

cd "$DESPLIEGUE" || exit 1
kc()    { docker compose exec -T "$KAMAYUK_KEYCLOAK_SERVICIO" /opt/keycloak/bin/kcadm.sh "$@" </dev/null; }
en_la_base() { docker compose exec -T base psql -U postgres -d "$BASE_DEL_SISTEMA" -tAc "$1" </dev/null; }

printf '\033[1mPreparando las identidades del realm «%s» para el ubigeo %s\033[0m\n' \
    "$KC_REALM" "$KAMAYUK_UBIGEO"

docker compose ps --services --filter status=running 2>/dev/null | grep -qx base \
    || muere "la plataforma" \
"El servicio «base» no esta en marcha. Levanta la plataforma primero:
  docker compose -f $DESPLIEGUE/plataforma.compose.yaml --env-file $DESPLIEGUE/.env up -d --wait"

# El `--wait` del compose vuelve antes de que Keycloak sirva sus realms. Es el mismo bucle
# que `reconciliar-identidades.sh:149-158`, y no una sonda nueva: la imagen de Keycloak no
# trae `curl` ni `jq`, asi que lo unico que se le puede preguntar es `kcadm`.
for _ in $(seq 1 60); do
    kc config credentials --server http://localhost:8080 --realm master \
        --user "$KAMAYUK_KEYCLOAK_ADMIN" --password "$KAMAYUK_CLAVE_KEYCLOAK" >/dev/null 2>&1 && break
    sleep 3
done
kc config credentials --server http://localhost:8080 --realm master \
    --user "$KAMAYUK_KEYCLOAK_ADMIN" --password "$KAMAYUK_CLAVE_KEYCLOAK" >/dev/null 2>&1 \
    || muere "la sesion de administracion" \
"Keycloak no acepto la sesion en 180 s. Mira «docker compose logs $KAMAYUK_KEYCLOAK_SERVICIO»:
  si dice «Value too long for column», es #71 y el realm no se importo."
ok "sesion de administracion abierta"

# ── PASO 1 · los ambitos de fabrica (rodeo de #72) ────────────────────────────
paso "1/4 · los trece ambitos que el import del realm borro (rodeo de #72)"
ejecutar "1/4 · los ambitos de fabrica" \
"Sin este paso TODO funcionario recibe 403 con un token valido: sin el ambito «profile» el
  token no lleva «preferred_username», que es con lo que el guardia busca su ficha." \
  -- "$AQUI/restaurar-ambitos-de-fabrica.sh"
ok "los trece ambitos, y asignados a los clientes que ya existian"

# ── PASO 2 · el administrador, con una clave que sirva ────────────────────────
paso "2/4 · «$KAMAYUK_ADMINISTRADOR» con una clave permanente"
# Se genera si no viene dada, y se imprime al final: sin ella el arnes no puede pedir token.
CLAVE_DEL_ADMINISTRADOR="${CLAVE_DEL_ADMINISTRADOR:-$(openssl rand -hex 16)}"

# El id de la municipalidad, leido de la BASE y no del JSON. Es la mitad buena de #73: el
# `municipalidadId` del archivo dice 9, el ubigeo dice 200105, y el RLS solo entiende el que
# la secuencia asigno.
ID_EN_LA_BASE=$(en_la_base \
    "SELECT id FROM municipalidad WHERE ubigeo = '$KAMAYUK_UBIGEO'" 2>/dev/null | tr -d '[:space:]')
[ -n "$ID_EN_LA_BASE" ] || muere "2/4 · el administrador" \
"La base «$BASE_DEL_SISTEMA» no tiene ninguna municipalidad con ubigeo «$KAMAYUK_UBIGEO».
  Esa fila la escribe la IMPLANTACION del sistema, asi que esto va DESPUES de levantarlo:
      docker compose -f ../../$BASE_DEL_SISTEMA/despliegue/compose.yaml \\
          --env-file $DESPLIEGUE/.env up --build --wait
  Y si el sistema esta arriba, mira su Job de implantacion: una municipalidad sin implantar
  no tiene ni una cuenta, asi que no hay nadie a quien darle clave."

# SIN `--reset` a proposito, y el tercer argumento es el id de la base: asi la cuenta nace
# ya alineada y el paso 4 solo tiene que arreglar lo que escribe el guion de servicios.
ejecutar "2/4 · el administrador" \
"Sin una clave permanente el «grant_type=password» no sirve, y el sintoma es «Invalid user
  credentials», que se lee como una clave mal escrita." \
  -- "$AQUI/crear-usuario.sh" "$KAMAYUK_ADMINISTRADOR" "$CLAVE_DEL_ADMINISTRADOR" "$ID_EN_LA_BASE"
ok "clave permanente fijada, y municipalidad_id=$ID_EN_LA_BASE (el de la base)"

# ── PASO 3 · los clientes de servicio (parte de #74) ──────────────────────────
# Los sistemas se DERIVAN del mismo archivo del que los deriva `reconciliar-identidades.sh`.
# Una segunda lista escrita aqui se separaria de aquella, y la que se quedaria vieja seria
# justo la que genera las claves: el sintoma es un cliente sin clave y un 401 en la primera
# llamada del consumidor, que no se parece a «falta un archivo».
mapfile -t SISTEMAS_DE_SERVICIO < <(python3 -c "
import json
d = json.load(open('$MUNICIPALIDAD_JSON'))
for s in sorted({x['sistema'] for x in d.get('servicios', [])}):
    print(s)")
paso "3/4 · los ${#SISTEMAS_DE_SERVICIO[@]} clientes de servicio que $KAMAYUK_UBIGEO declara"
[ "${#SISTEMAS_DE_SERVICIO[@]}" -gt 0 ] || muere "3/4 · los clientes de servicio" \
"«$MUNICIPALIDAD_JSON» no declara ninguna cuenta de servicio en su bloque «servicios».
  Cero declaradas no es «todo bien»: es que no hay nada que comprobar."

mkdir -p "$CLAVES_DE_SERVICIO" && chmod 700 "$CLAVES_DE_SERVICIO"
# Solo lo que falta, y NUNCA se reescribe: es la regla de `completar-secreto.ts:66-92`, y
# aqui importa por lo mismo — reescribir la clave de un cliente que ya la tenia deja al
# consumidor que la lleva con un 401 que no se parece a su causa.
for sistema in "${SISTEMAS_DE_SERVICIO[@]}"; do
    archivo="$CLAVES_DE_SERVICIO/${sistema}-${KAMAYUK_UBIGEO}"
    if [ -s "$archivo" ]; then ok "clave de «$sistema»: ya estaba, no se toca"; continue; fi
    openssl rand -hex 24 > "$archivo" && chmod 600 "$archivo" \
        || muere "3/4 · los clientes de servicio" "No se pudo escribir «$archivo»."
    ok "clave de «$sistema»: generada"
done
ejecutar "3/4 · los clientes de servicio" \
"Si arriba dice «el realm no tiene el ambito kamayuk-servicio», lo que falta es la ESTRUCTURA
  del realm y no un cliente: el import no se aplico." \
  -- "$AQUI/reconciliar-identidades.sh" servicios
ok "los ${#SISTEMAS_DE_SERVICIO[@]} clientes confidenciales, con su clave puesta y comprobada"

# ── PASO 4 · el inquilino (rodeo de #73) ──────────────────────────────────────
paso "4/4 · alinear «municipalidad_id» con el id de la base (rodeo de #73)"
# `reconciliar-identidades.sh servicios` fija el atributo al UBIGEO —su linea
# `attributes.municipalidad_id=$ubigeo`—, y el RLS de la base solo entiende el id de la
# secuencia. Sin este paso el sintoma es 403 «La cuenta … no esta dada de alta en este
# sistema» CON LA FILA DELANTE en la tabla `usuario`, que manda a mirar el alta: lo unico
# que esta bien.
alinear() { # alinear <uid> <a quien>
    kc update "users/$1" -r "$KC_REALM" -s "attributes.municipalidad_id=$ID_EN_LA_BASE" \
            >/dev/null 2>&1 \
        || muere "4/4 · el inquilino" "No se pudo fijar «municipalidad_id» de «$2»."
}

# El administrador ya salio alineado del paso 2; se vuelve a poner porque una corrida
# posterior de `reconciliar-identidades.sh` (funcionarios) lo devolveria al 9 del JSON.
UID_ADMIN=$(kc get users -r "$KC_REALM" -q "username=$KAMAYUK_ADMINISTRADOR" --fields id 2>/dev/null \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0]["id"] if d else "")' 2>/dev/null)
[ -n "$UID_ADMIN" ] || muere "4/4 · el inquilino" \
"«$KAMAYUK_ADMINISTRADOR» no existe en el realm «$KC_REALM», asi que el paso 2 no hizo lo suyo."
alinear "$UID_ADMIN" "$KAMAYUK_ADMINISTRADOR"
ok "$KAMAYUK_ADMINISTRADOR -> municipalidad_id=$ID_EN_LA_BASE"

# Las cuentas de servicio NO salen de `get users`: Keycloak las esconde del listado y hay que
# llegar a ellas por su cliente. Se leen a un ARRAY y no con `while read`, porque `kc` es
# `docker compose exec -T` y eso CONSUME stdin: dentro de un `while read` se traga el resto
# de la lista y el bucle muere en la primera vuelta SIN ERROR.
declare -a CUENTAS=()
mapfile -t CUENTAS < <(kc get clients -r "$KC_REALM" --fields id,clientId 2>/dev/null | python3 -c '
import json, sys
for c in json.load(sys.stdin):
    if c["clientId"].startswith("kamayuk-") and "-servicio-" in c["clientId"]:
        print(c["id"], c["clientId"])' 2>/dev/null)
[ "${#CUENTAS[@]}" -eq "${#SISTEMAS_DE_SERVICIO[@]}" ] || muere "4/4 · el inquilino" \
"Se esperaban ${#SISTEMAS_DE_SERVICIO[@]} clientes de servicio en el realm y hay ${#CUENTAS[@]}:
  el paso 3 no dejo lo que dice haber dejado."
for fila in "${CUENTAS[@]}"; do
    cid=${fila%% *}; cliente=${fila#* }
    cuenta=$(kc get "clients/$cid/service-account-user" -r "$KC_REALM" 2>/dev/null \
        | python3 -c 'import json,sys; print(json.load(sys.stdin).get("id",""))' 2>/dev/null)
    [ -n "$cuenta" ] || muere "4/4 · el inquilino" "«$cliente» no tiene cuenta de servicio."
    alinear "$cuenta" "$cliente"
    ok "$cliente -> municipalidad_id=$ID_EN_LA_BASE"
done

# ── Lo que el arnes necesita, para que encadenarlos no exija leer nada ────────
printf '\n\033[1mListo. Lo que «identidad/despliegue/pruebas-e2e/ejercer.sh» necesita:\033[0m\n'
printf '  export CLAVE_DEL_ADMINISTRADOR=%s\n' "$CLAVE_DEL_ADMINISTRADOR"
if [ -s "$CLAVES_DE_SERVICIO/rentas-${KAMAYUK_UBIGEO}" ]; then
    printf '  export CLAVE_DE_SERVICIO_RENTAS=%s\n' "$(cat "$CLAVES_DE_SERVICIO/rentas-${KAMAYUK_UBIGEO}")"
fi
printf '\n  Las %d claves de servicio estan en %s (modo 700).\n' \
    "${#SISTEMAS_DE_SERVICIO[@]}" "$CLAVES_DE_SERVICIO"
