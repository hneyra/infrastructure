#!/bin/bash
# Reconcilia contra Keycloak lo que el repositorio declara de las PERSONAS (ADR-0012,
# ADR-0020). Dos poblaciones, dos realms, un solo guion:
#
#   ./reconciliar-identidades.sh              los USUARIOS y GRUPOS de cada municipalidad,
#                                             en el realm de funcionarios
#   ./reconciliar-identidades.sh ciudadanos   los CIUDADANOS ENROLADOS en ventanilla,
#                                             en el realm del portal (`<realm>-ciudadano`)
#
# Es el equivalente de `reconciliar-realm.sh` para las personas: el realm fija la
# ESTRUCTURA, y este guion aplica lo que declaran `municipalidades/<ubigeo>.json` y
# `ciudadanos/<ubigeo>.json` —fuentes versionadas, SIN una sola clave—. Y es el mismo
# guion para los dos por el mismo motivo por el que `reconciliar-realm.sh` lo es para los
# dos realms: lo que cambia son el archivo, el realm y que se comprueba al terminar; el
# procedimiento —crear lo que falta, actualizar lo declarado, NO tocar la clave de quien
# ya existia, y COMPROBAR— es identico, y una copia del ultimo paso es una que un dia
# deja de comprobar lo suyo.
#
# ── Modo `funcionarios` (por omision) ──────────────────────────────────────────
#
#   1. Por cada municipalidad: crea el grupo de Keycloak si falta y le fija el
#      atributo `municipalidad_id` (documental; el claim sale del atributo por
#      usuario, no del grupo).
#   2. Por cada usuario: lo crea si falta —`enabled`, con nombre, apellido, correo
#      y `attributes.municipalidad_id`, y con UPDATE_PASSWORD pendiente— o, si ya
#      existe, le actualiza atributo, correo y nombre. NUNCA borra, y NUNCA toca la
#      clave ni las acciones pendientes de un usuario que ya existia.
#   3. Lo afilia a su grupo (PUT idempotente).
#   4. Solo a los usuarios RECIEN creados: les envia el correo de Keycloak con el
#      enlace de un solo uso para fijar la clave (`execute-actions-email` con
#      UPDATE_PASSWORD). No se genera ninguna clave en ningun sitio.
#   5. Comprobacion final: cada usuario declarado existe, esta `enabled`, tiene el
#      atributo con el valor del archivo y esta en su grupo. Si no -> exit 1, y el
#      despliegue queda rojo. Es lo que convierte este Job en una verificacion.
#
# ── Modo `ciudadanos` (D-15 camino B, ADR-0020 §5) ─────────────────────────────
#
#   1. Por cada ciudadano declarado: **la cuenta se deriva del documento**
#      —`dni-70123456`—, nunca se declara. Es lo que hace que la fila `ACCESO` que el
#      portal deja en la bitacora de cada municipalidad identifique al ciudadano por
#      su documento, y lo que impide que una cuenta diga una cosa y su atributo otra.
#      Lleva el TIPO delante porque `CE 12345678` y `DNI 12345678` son dos personas.
#   2. Se crea con `tipo_documento` y `numero_documento` —los dos claims de ADR-0020—
#      y con UPDATE_PASSWORD pendiente; si ya existia, se actualizan nombre, apellido
#      y correo y NO se toca ni la clave ni las acciones pendientes.
#   3. **Ningun grupo y ningun `municipalidad_id`**: el ciudadano no pertenece a
#      ninguna municipalidad, y lo que ve sale de recorrer el registro (ADR-0020 §2).
#   4. El enlace de clave, solo a los recien creados QUE DECLARAN CORREO. El resto
#      queda con UPDATE_PASSWORD pendiente y la clave se entrega fuera de banda: un
#      padron real tiene mucha gente sin correo, y exigirlo dejaria fuera del portal
#      justo a quien va a ventanilla.
#   5. Comprobacion final: existe, esta `enabled` y sus DOS atributos valen lo que
#      dice el archivo. Sin `numero_documento` el token sale sin el claim y
#      `/portal/situacion` responde 403 SIN_DOCUMENTO.
#
# ── Dos modos de EJECUCION, un guion ──────────────────────────────────────────
#
#   directo  Corre DENTRO de la imagen de Keycloak (el Job del cluster). `kcadm.sh`
#            es local y los datos llegan pre-derivados en `identidades.tsv` /
#            `ciudadanos.tsv`, que escribe `infra/componentes/Identidad.ts` (la imagen
#            de Keycloak no trae python ni jq).
#   compose  Corre en la maquina o en el runner. `kcadm` se invoca por
#            `docker compose exec` y los `*.json` se leen con el python3 del anfitrion.
#
# El modo se detecta solo; se puede forzar con KC_MODO=compose|directo.
#
# ── Variables ─────────────────────────────────────────────────────────────────
#   KC_REALM                  realm de funcionarios; por omision `sgtm`
#   KC_REALM_CIUDADANO        realm del portal; por omision `<KC_REALM>-ciudadano`
#   KC_DIRECTORIO             (directo) carpeta con los TSV; por omision /realm
#   MUNICIPALIDADES_DIR       (compose) carpeta con `*.json`; por omision ./municipalidades
#   CIUDADANOS_DIR            (compose) carpeta con `*.json`; por omision ./ciudadanos
#   UBIGEO                    (compose) si se fija, solo reconcilia ese `<ubigeo>.json`
#   KC_SERVIDOR               (directo) URL de Keycloak, p.ej. http://svc:8080/keycloak
#   KC_ADMIN / KC_CLAVE       (directo) usuario y clave de administracion
#   KAMAYUK_KEYCLOAK_ADMIN       (compose) usuario admin; por omision `admin`
#   KAMAYUK_CLAVE_KEYCLOAK       (compose) clave admin
#   KAMAYUK_KEYCLOAK_SERVICIO    (compose) servicio del compose; por omision `identidad`
#   KC_SMTP_USUARIO/KC_SMTP_CLAVE  si el relay pide auth: se ponen en el realm con
#                             `kcadm`, nunca quedan en el `realm.json` versionado
#   SIN_CORREO=1              omite el envio del enlace (usuario sin clave; solo local)
set -euo pipefail

AQUI="$(cd "$(dirname "$0")" && pwd)"

# --- Que poblacion se reconcilia ----------------------------------------------
CUAL="${1:-funcionarios}"
case "$CUAL" in
    funcionarios)
        REALM="${KC_REALM:-sgtm}"
        ARCHIVO_TSV="identidades.tsv"
        ;;
    ciudadanos)
        REALM="${KC_REALM_CIUDADANO:-${KC_REALM:-sgtm}-ciudadano}"
        ARCHIVO_TSV="ciudadanos.tsv"
        ;;
    *)
        echo "FALLO: no se sabe reconciliar «$CUAL». Es «funcionarios» o «ciudadanos»." >&2
        exit 1
        ;;
esac

# --- Modo ---------------------------------------------------------------------
if [ "${KC_MODO:-auto}" = compose ]; then
    MODO=compose
elif [ "${KC_MODO:-auto}" = directo ] || [ -x /opt/keycloak/bin/kcadm.sh ]; then
    MODO=directo
else
    MODO=compose
fi

if [ "$MODO" = compose ]; then
    : "${KAMAYUK_KEYCLOAK_SERVICIO:=identidad}"
fi

# `kcadm`, en el modo que toque. `</dev/null` porque este guion invoca `kc` dentro
# de bucles `while read < archivo`: sin el, `docker compose exec` heredaria el
# archivo como stdin.
kc() {
    if [ "$MODO" = directo ]; then
        /opt/keycloak/bin/kcadm.sh "$@" </dev/null
    else
        docker compose exec -T "$KAMAYUK_KEYCLOAK_SERVICIO" \
            /opt/keycloak/bin/kcadm.sh "$@" </dev/null
    fi
}

# --- Sesion de administracion ----------------------------------------------------
if [ "$MODO" = directo ]; then
    : "${KC_SERVIDOR:?falta KC_SERVIDOR}"
    : "${KC_ADMIN:?falta KC_ADMIN}"
    : "${KC_CLAVE:?falta KC_CLAVE}"
    SERVIDOR="$KC_SERVIDOR"; ADMIN="$KC_ADMIN"; CLAVE="$KC_CLAVE"
else
    : "${KAMAYUK_CLAVE_KEYCLOAK:?falta KAMAYUK_CLAVE_KEYCLOAK}"
    SERVIDOR="${KC_SERVIDOR:-http://localhost:8080}"
    ADMIN="${KAMAYUK_KEYCLOAK_ADMIN:-admin}"; CLAVE="$KAMAYUK_CLAVE_KEYCLOAK"
fi

echo "Reconciliando $CUAL del realm «$REALM» contra $SERVIDOR (modo $MODO)"

intento=0
until kc config credentials --server "$SERVIDOR" --realm master \
        --user "$ADMIN" --password "$CLAVE" >/dev/null 2>&1; do
    intento=$((intento + 1))
    if [ "$intento" -ge 100 ]; then
        echo "FALLO: Keycloak no acepto la sesion de administracion en $SERVIDOR." >&2
        exit 1
    fi
    sleep 3
done

# --- Credenciales del relay SMTP, si el realm las necesita ---------------------
# El `realm.json` versionado no lleva la clave del relay; la pone aqui `kcadm`.
if [ -n "${KC_SMTP_USUARIO:-}" ]; then
    kc update "realms/$REALM" \
        -s "smtpServer.auth=true" \
        -s "smtpServer.user=$KC_SMTP_USUARIO" \
        -s "smtpServer.password=${KC_SMTP_CLAVE:-}" >/dev/null
    echo "Relay SMTP: credenciales puestas en el realm (no versionadas)."
fi

# --- Fuente de datos: el TSV derivado (directo) o los *.json (compose) ----------
# Formato del TSV, una linea por fila, campos separados por tabulador:
#   GRUPO     <nombre del grupo>   <municipalidadId>
#   USUARIO   <cuenta> <nombre> <apellido> <correo> <municipalidadId> <grupo>
#   CIUDADANO <cuenta> <nombre> <apellido> <tipoDocumento> <numeroDocumento> <correo>
DIRECTORIO="${KC_DIRECTORIO:-/realm}"
LIMPIAR_TSV=0
if [ -f "$DIRECTORIO/$ARCHIVO_TSV" ]; then
    TSV="$DIRECTORIO/$ARCHIVO_TSV"
    echo "Datos: $TSV (derivado por Identidad.ts)"
else
    if [ "$CUAL" = ciudadanos ]; then
        FUENTE_DIR="${CIUDADANOS_DIR:-$AQUI/ciudadanos}"
    else
        FUENTE_DIR="${MUNICIPALIDADES_DIR:-$AQUI/municipalidades}"
    fi
    if ! command -v python3 >/dev/null 2>&1; then
        echo "FALLO: no hay «$DIRECTORIO/$ARCHIVO_TSV» ni python3 para leer $FUENTE_DIR." >&2
        exit 1
    fi
    TSV="$(mktemp)"; LIMPIAR_TSV=1
    trap '[ "$LIMPIAR_TSV" = 1 ] && rm -f "$TSV"' EXIT
    if [ "$CUAL" = ciudadanos ]; then
        python3 - "$FUENTE_DIR" "${UBIGEO:-}" >"$TSV" <<'PY'
import glob, json, os, re, sys

# La forma que exige cada tipo, la MISMA que `TipoDocumento` del dominio: un numero
# que el dominio no puede leer produce un token que el backend rechaza con 403
# SIN_DOCUMENTO, y el 403 no dice por que. `componentes.test.ts` comprueba que esta
# tabla y la del enumerado siguen diciendo lo mismo.
TIPOS = {"DNI": (8, 8, True), "RUC": (11, 11, True), "CE": (6, 20, False), "PASAPORTE": (6, 20, False), "PARTIDA": (1, 20, False), "OTRO": (1, 20, False)}

carpeta = sys.argv[1]
solo = sys.argv[2] if len(sys.argv) > 2 else ""
if not os.path.isdir(carpeta):
    sys.exit(f"No existe la carpeta de ciudadanos enrolados {carpeta}")
archivos = sorted(glob.glob(os.path.join(carpeta, "*.json")))
if solo:
    archivos = [a for a in archivos if os.path.splitext(os.path.basename(a))[0] == solo]
    if not archivos:
        # Que una municipalidad no haya enrolado a nadie es legitimo, y es el estado
        # de partida de todas. No se inventa un error; se dice y se sigue.
        print(f"Sin ciudadanos declarados para el ubigeo {solo} en {carpeta}", file=sys.stderr)

filas = []
declarado = {}
for ruta in archivos:
    with open(ruta, encoding="utf-8") as fh:
        crudo = fh.read()
    # Ni una clave, nunca (ADR-0012 §2). Se mira el TEXTO del archivo y no el objeto
    # ya parseado: lo que no puede estar es la palabra, este donde este.
    prohibida = re.search(r'"(credentials|password|secret|clave)"\s*:', crudo, re.I)
    if prohibida:
        sys.exit(f"{ruta}: declara «{prohibida.group(1)}». Aqui no entra ninguna clave (ADR-0012 §2)")
    if re.search(r'"(cuenta|username)"\s*:', crudo, re.I):
        sys.exit(f"{ruta}: declara la cuenta. La cuenta se DERIVA del documento (ADR-0020 §5)")
    c = json.loads(crudo)
    base = os.path.splitext(os.path.basename(ruta))[0]
    ubigeo = str(c.get("ubigeo", ""))
    if not ubigeo.isdigit() or len(ubigeo) != 6:
        sys.exit(f"{ruta}: «ubigeo» son seis digitos, y es {ubigeo!r}")
    if ubigeo != base:
        sys.exit(f"{ruta}: el nombre del archivo ({base}) no es el ubigeo ({ubigeo})")
    ciudadanos = c.get("ciudadanos")
    if not isinstance(ciudadanos, list):
        sys.exit(f"{ruta}: «ciudadanos» es una lista, aunque este vacia")
    for u in ciudadanos:
        for campo in ("nombre", "apellido", "tipoDocumento", "numeroDocumento"):
            valor = u.get(campo)
            if not valor or not isinstance(valor, str) or "\t" in valor:
                sys.exit(f"{ruta}: un ciudadano sin «{campo}» valido")
        tipo = u["tipoDocumento"].strip().upper()
        if tipo not in TIPOS:
            sys.exit(f"{ruta}: «{tipo}» no es un tipo de documento conocido: {', '.join(TIPOS)}")
        numero = u["numeroDocumento"].strip().upper()
        minimo, maximo, digitos = TIPOS[tipo]
        if not re.fullmatch(r"[0-9A-Z]+", numero):
            sys.exit(f"{ruta}: el documento «{numero}» lleva algo que no es digito ni letra")
        if not minimo <= len(numero) <= maximo:
            sys.exit(f"{ruta}: un {tipo} tiene de {minimo} a {maximo} caracteres, y «{numero}» tiene {len(numero)}")
        if digitos and not numero.isdigit():
            sys.exit(f"{ruta}: un {tipo} es solo digitos, y «{numero}» no lo es")
        correo = (u.get("correo") or "").strip()
        if "\t" in correo:
            sys.exit(f"{ruta}: el correo de «{numero}» lleva un tabulador")
        # La cuenta se deriva, nunca se declara. Con el tipo delante porque
        # `CE 12345678` y `DNI 12345678` son dos personas distintas.
        cuenta = f"{tipo.lower()}-{numero.lower()}"
        firma = (u["nombre"].strip(), u["apellido"].strip(), tipo, numero, correo)
        if cuenta in declarado:
            anterior, ruta_anterior = declarado[cuenta]
            if anterior != firma:
                sys.exit(
                    f"{ruta} y {ruta_anterior} declaran el mismo documento ({tipo} {numero}) "
                    "con datos distintos. Dos municipalidades no pueden afirmar cosas distintas "
                    "de la misma persona"
                )
            continue
        declarado[cuenta] = (firma, ruta)
        filas.append(("CIUDADANO", cuenta, firma[0], firma[1], tipo, numero, correo))

for fila in filas:
    print("\t".join(fila))
PY
    else
        python3 - "$FUENTE_DIR" "${UBIGEO:-}" >"$TSV" <<'PY'
import glob, json, os, sys

carpeta = sys.argv[1]
solo = sys.argv[2] if len(sys.argv) > 2 else ""
archivos = sorted(glob.glob(os.path.join(carpeta, "*.json")))
if solo:
    archivos = [a for a in archivos if os.path.splitext(os.path.basename(a))[0] == solo]
if not archivos:
    sys.exit(f"No hay ningun municipalidades/*.json en {carpeta}" + (f" para el ubigeo {solo}" if solo else ""))

filas = []
for ruta in archivos:
    with open(ruta, encoding="utf-8") as fh:
        m = json.load(fh)
    base = os.path.splitext(os.path.basename(ruta))[0]
    ubigeo = str(m.get("ubigeo", ""))
    if not ubigeo.isdigit() or len(ubigeo) != 6:
        sys.exit(f"{ruta}: «ubigeo» son seis digitos, y es {ubigeo!r}")
    if ubigeo != base:
        sys.exit(f"{ruta}: el nombre del archivo ({base}) no es el ubigeo ({ubigeo})")
    mid = m.get("municipalidadId")
    if not isinstance(mid, int) or isinstance(mid, bool) or mid <= 0:
        sys.exit(f"{ruta}: «municipalidadId» es un entero positivo, y es {mid!r}")
    grupo = m.get("grupo", "")
    if not grupo or "\t" in grupo:
        sys.exit(f"{ruta}: «grupo» es obligatorio y sin tabuladores")
    usuarios = m.get("usuarios", [])
    if not usuarios:
        sys.exit(f"{ruta}: no declara ningun usuario")
    admins = [u for u in usuarios if u.get("administrador") is True]
    if len(admins) != 1:
        sys.exit(f"{ruta}: tiene que haber exactamente un usuario con «administrador: true», hay {len(admins)}")
    filas.append(("GRUPO", grupo, str(mid)))
    for u in usuarios:
        for campo in ("cuenta", "nombre", "apellido", "correo"):
            if not u.get(campo) or "\t" in str(u[campo]):
                sys.exit(f"{ruta}: usuario {u.get('cuenta')!r} sin «{campo}» valido")
        filas.append(("USUARIO", u["cuenta"], u["nombre"], u["apellido"], u["correo"], str(mid), grupo))

for fila in filas:
    print("\t".join(fila))
PY
    fi
    echo "Datos: $FUENTE_DIR/*.json (leidos con python3)"
fi

# --- 1 y 2: grupos, usuarios y ciudadanos -------------------------------------
buscar_grupo() {
    local salida
    salida=$(kc get groups -r "$REALM" -q "search=$1" -q "exact=true" \
        --fields id --format csv --noquotes 2>/dev/null || true)
    printf '%s' "$salida" | tr -d '\r' | sed -n '1p'
}
buscar_usuario() {
    local salida
    salida=$(kc get users -r "$REALM" -q "username=$1" -q "exact=true" \
        --fields id --format csv --noquotes 2>/dev/null || true)
    printf '%s' "$salida" | tr -d '\r' | sed -n '1p'
}

NUEVOS=""
while IFS=$'\t' read -r tipo c1 c2 c3 c4 c5 c6; do
    [ -n "${tipo:-}" ] || continue
    case "$tipo" in
        GRUPO)
            grupo="$c1"; mid="$c2"
            gid=$(buscar_grupo "$grupo")
            if [ -z "$gid" ]; then
                kc create groups -r "$REALM" -s "name=$grupo" >/dev/null
                gid=$(buscar_grupo "$grupo")
                echo "Grupo «$grupo» creado."
            fi
            [ -n "$gid" ] || { echo "FALLO: no se pudo resolver el id del grupo «$grupo»." >&2; exit 1; }
            kc update "groups/$gid" -r "$REALM" \
                -s "attributes.municipalidad_id=[\"$mid\"]" >/dev/null
            ;;
        USUARIO)
            cuenta="$c1"; nombre="$c2"; apellido="$c3"; correo="$c4"; mid="$c5"; grupo="$c6"
            gid=$(buscar_grupo "$grupo")
            [ -n "$gid" ] || { echo "FALLO: el grupo «$grupo» no existe al afiliar a «$cuenta»." >&2; exit 1; }
            uid=$(buscar_usuario "$cuenta")
            if [ -z "$uid" ]; then
                kc create users -r "$REALM" \
                    -s "username=$cuenta" -s enabled=true -s emailVerified=true \
                    -s "email=$correo" -s "firstName=$nombre" -s "lastName=$apellido" \
                    -s "attributes.municipalidad_id=$mid" \
                    -s 'requiredActions=["UPDATE_PASSWORD"]' >/dev/null
                uid=$(buscar_usuario "$cuenta")
                [ -n "$uid" ] || { echo "FALLO: «$cuenta» no aparece despues de crearlo." >&2; exit 1; }
                NUEVOS="$NUEVOS $cuenta:$uid"
                echo "Usuario «$cuenta» creado (municipalidad $mid), con UPDATE_PASSWORD pendiente."
            else
                # Se actualiza lo DECLARADO. No se tocan credentials, requiredActions
                # ni enabled: una clave ya fijada y un primer acceso ya hecho se
                # respetan.
                kc update "users/$uid" -r "$REALM" \
                    -s "email=$correo" -s "firstName=$nombre" -s "lastName=$apellido" \
                    -s "attributes.municipalidad_id=$mid" >/dev/null
                echo "Usuario «$cuenta» ya existia; atributo, correo y nombre al dia. Clave intacta."
            fi
            kc update "users/$uid/groups/$gid" -r "$REALM" -n >/dev/null
            ;;
        CIUDADANO)
            cuenta="$c1"; nombre="$c2"; apellido="$c3"; tipoDoc="$c4"; numeroDoc="$c5"
            correo="${c6:-}"
            uid=$(buscar_usuario "$cuenta")
            if [ -z "$uid" ]; then
                # Sin grupo y sin `municipalidad_id`: el ciudadano no pertenece a
                # ninguna municipalidad (ADR-0020 §2). `emailVerified` solo si hay
                # correo: marcarlo verificado sin direccion es afirmar algo de una
                # direccion que no existe.
                if [ -n "$correo" ]; then
                    kc create users -r "$REALM" \
                        -s "username=$cuenta" -s enabled=true -s emailVerified=true \
                        -s "email=$correo" -s "firstName=$nombre" -s "lastName=$apellido" \
                        -s "attributes.tipo_documento=$tipoDoc" \
                        -s "attributes.numero_documento=$numeroDoc" \
                        -s 'requiredActions=["UPDATE_PASSWORD"]' >/dev/null
                else
                    kc create users -r "$REALM" \
                        -s "username=$cuenta" -s enabled=true \
                        -s "firstName=$nombre" -s "lastName=$apellido" \
                        -s "attributes.tipo_documento=$tipoDoc" \
                        -s "attributes.numero_documento=$numeroDoc" \
                        -s 'requiredActions=["UPDATE_PASSWORD"]' >/dev/null
                fi
                uid=$(buscar_usuario "$cuenta")
                [ -n "$uid" ] || { echo "FALLO: «$cuenta» no aparece despues de crearlo." >&2; exit 1; }
                if [ -n "$correo" ]; then
                    NUEVOS="$NUEVOS $cuenta:$uid"
                else
                    echo "«$cuenta» se creo SIN correo: queda con UPDATE_PASSWORD pendiente y la clave se entrega fuera de banda (ver README)."
                fi
                echo "Ciudadano «$cuenta» enrolado ($tipoDoc $numeroDoc), con UPDATE_PASSWORD pendiente."
            else
                # El documento NO se reescribe aqui por capricho: es el mismo valor del
                # que se derivo la cuenta, asi que actualizarlo es reafirmarlo. Lo que
                # no se toca, igual que arriba, es la clave y lo pendiente.
                if [ -n "$correo" ]; then
                    kc update "users/$uid" -r "$REALM" \
                        -s "email=$correo" -s emailVerified=true \
                        -s "firstName=$nombre" -s "lastName=$apellido" \
                        -s "attributes.tipo_documento=$tipoDoc" \
                        -s "attributes.numero_documento=$numeroDoc" >/dev/null
                else
                    kc update "users/$uid" -r "$REALM" \
                        -s "firstName=$nombre" -s "lastName=$apellido" \
                        -s "attributes.tipo_documento=$tipoDoc" \
                        -s "attributes.numero_documento=$numeroDoc" >/dev/null
                fi
                echo "Ciudadano «$cuenta» ya estaba enrolado; nombre y correo al dia. Clave intacta."
            fi
            ;;
        *)
            echo "FALLO: linea de tipo desconocido «$tipo» en el TSV." >&2; exit 1
            ;;
    esac
done < "$TSV"

# --- 4: el enlace de clave, solo a los recien creados -------------------------
for par in $NUEVOS; do
    cuenta="${par%%:*}"; uid="${par#*:}"
    if [ "${SIN_CORREO:-0}" = 1 ]; then
        echo "SIN_CORREO=1: «$cuenta» queda SIN clave y SIN enlace. Fijarla a mano (ver README)."
        continue
    fi
    if kc update "users/$uid/execute-actions-email" -r "$REALM" \
            -b '["UPDATE_PASSWORD"]' >/dev/null 2>&1; then
        echo "Enlace para fijar la clave enviado a «$cuenta»."
    else
        {
            echo "FALLO: no se pudo enviar el enlace de UPDATE_PASSWORD a «$cuenta»."
            echo "Casi siempre es SMTP sin configurar en el realm. Salidas:"
            echo "  - configurar smtpServer (despliegue/identidad/README.md), o"
            echo "  - fijar una clave temporal a mano:"
            echo "      kcadm set-password -r $REALM --username $cuenta --new-password <clave> --temporary"
            echo "  - o re-lanzar con SIN_CORREO=1 (el usuario queda sin clave)."
        } >&2
        exit 1
    fi
done

# --- 5: comprobacion final ---------------------------------------------------
echo "--- Comprobacion final ---"
errores=0
usuarios=0
grupos=0
ciudadanos=0
while IFS=$'\t' read -r tipo c1 c2 c3 c4 c5 c6; do
    case "${tipo:-}" in
        GRUPO) grupos=$((grupos + 1)); continue ;;
        USUARIO) : ;;
        CIUDADANO)
            ciudadanos=$((ciudadanos + 1))
            cuenta="$c1"; tipoDoc="$c4"; numeroDoc="$c5"
            uid=$(buscar_usuario "$cuenta")
            if [ -z "$uid" ]; then
                echo "FALLO: «$cuenta» no existe despues de enrolar." >&2; errores=1; continue
            fi
            detalle=$(kc get "users/$uid" -r "$REALM" 2>/dev/null || true)
            case "$detalle" in
                *'"numero_documento" : [ "'"$numeroDoc"'" ]'*|*"\"numero_documento\":[\"$numeroDoc\"]"*) ;;
                *)
                    echo "FALLO: «$cuenta» sin atributo numero_documento=$numeroDoc." >&2
                    echo "  Sin ese atributo el token sale sin el claim y /portal/situacion" >&2
                    echo "  responde 403 SIN_DOCUMENTO, no una situacion vacia (ADR-0020)." >&2
                    errores=1
                    ;;
            esac
            case "$detalle" in
                *'"tipo_documento" : [ "'"$tipoDoc"'" ]'*|*"\"tipo_documento\":[\"$tipoDoc\"]"*) ;;
                *) echo "FALLO: «$cuenta» sin atributo tipo_documento=$tipoDoc." >&2; errores=1 ;;
            esac
            case "$detalle" in
                *'"enabled" : true'*|*'"enabled":true'*) ;;
                *) echo "FALLO: «$cuenta» no esta enabled." >&2; errores=1 ;;
            esac
            continue
            ;;
        *) continue ;;
    esac
    usuarios=$((usuarios + 1))
    cuenta="$c1"; mid="$c5"; grupo="$c6"
    uid=$(buscar_usuario "$cuenta")
    if [ -z "$uid" ]; then
        echo "FALLO: «$cuenta» no existe despues de reconciliar." >&2; errores=1; continue
    fi
    detalle=$(kc get "users/$uid" -r "$REALM" 2>/dev/null || true)
    case "$detalle" in
        *'"municipalidad_id" : [ "'"$mid"'" ]'*|*"\"municipalidad_id\":[\"$mid\"]"*) ;;
        *) echo "FALLO: «$cuenta» sin atributo municipalidad_id=$mid." >&2; errores=1 ;;
    esac
    case "$detalle" in
        *'"enabled" : true'*|*'"enabled":true'*) ;;
        *) echo "FALLO: «$cuenta» no esta enabled." >&2; errores=1 ;;
    esac
    membresia=$(kc get "users/$uid/groups" -r "$REALM" \
        --fields name --format csv --noquotes 2>/dev/null | tr -d '\r' || true)
    case "$membresia" in
        *"$grupo"*) ;;
        *) echo "FALLO: «$cuenta» no esta en el grupo «$grupo»." >&2; errores=1 ;;
    esac
done < "$TSV"

if [ "$errores" -ne 0 ]; then
    echo "Reconciliacion de $CUAL: CON FALLOS." >&2
    exit 1
fi
if [ "$CUAL" = ciudadanos ]; then
    echo "Ciudadanos enrolados: $ciudadanos cuenta(s) en el realm «$REALM»."
else
    echo "Identidades reconciliadas: $usuarios usuario(s) en $grupos grupo(s)."
fi
