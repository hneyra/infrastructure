#!/usr/bin/env bash
# Lleva al motor EN MARCHA las credenciales que el inventario declara (issue #435).
#
# ## El hueco que cierra, encontrado ejecutando
#
# `20-asignar-claves.sh` da `LOGIN` y clave a los roles que se conectan, y lo hace bien
# — pero corre **una sola vez**, desde `/docker-entrypoint-initdb.d`, con el volumen de
# datos vacio. En un cluster que ya existe, ese guion no vuelve a ejecutarse nunca.
#
# La consecuencia se midio contra `stg` el 2026-08-29: el issue #387 le dio `LOGIN` a
# `rol_carga_parametros` **en el guion de inicializacion**, `bootstrap-secretos.sh` creo
# su secreto, el manifiesto lo declara... y en la base el rol seguia `NOLOGIN` y sin
# clave, porque el motor se habia inicializado dias antes. `publicar-parametros.sh`
# corrio de punta a punta y devolvio `PUBLICADAS=0 RECHAZADAS=22`, con un aviso por fila
# que culpaba a las firmas. La causa real —«role "rol_carga_parametros" is not permitted
# to log in»— no aparecia en ninguna linea de la salida.
#
# O sea: **una credencial que se anade despues de crear el cluster no llega sola a la
# base.** Este guion es el paso que faltaba, y es idempotente: correrlo dos veces deja el
# motor igual.
#
# ## Que hace, exactamente
#
# Por cada entrada del inventario (`yarn secretos`) que tenga `rolDePostgres`, ejecuta
# contra el motor en marcha, con la conexion de superusuario:
#
#     ALTER ROLE :"rol" LOGIN PASSWORD :'clave';
#
# leyendo la clave **del `Secret` que ya existe**. No genera ninguna: generarlas es de
# `bootstrap-secretos.sh`, y rotarlas es de `rotar-clave.sh`. Aqui el `Secret` es la
# fuente de verdad y la base converge a el.
#
# `kamayuk_readonly` NO entra, por lo mismo que no entra en `20-asignar-claves.sh`: no se
# conecta nadie con el, y un rol que puede iniciar sesion sin que nadie lo use es una
# credencial mas que rotar y vigilar. Tampoco entran las entradas que no son roles del
# motor —el administrador de Keycloak, la clave de cifrado del respaldo—: el inventario
# las distingue solo, porque no llevan `rolDePostgres`.
#
#   uso: secretos/asignar-claves.sh --ambiente stg|prod [--namespace kamayuk-stg] [--comprobar]
#
# `--comprobar` no cambia nada: solo dice, rol por rol, si la credencial del `Secret`
# sirve para conectarse. Es lo que hay que correr antes de publicar.
#
# Requiere: kubectl con el tunel al API del ambiente ya abierto.
set -euo pipefail

AMBIENTE=""
NAMESPACE=""
SOLO_COMPROBAR=""
while [ $# -gt 0 ]; do
    case "$1" in
        --ambiente) AMBIENTE=${2:?falta el valor de --ambiente}; shift 2 ;;
        --namespace) NAMESPACE=${2:?falta el valor de --namespace}; shift 2 ;;
        --comprobar) SOLO_COMPROBAR=si; shift ;;
        *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
    esac
done
[ -n "$AMBIENTE" ] || { echo "Falta --ambiente (stg o prod)." >&2; exit 2; }
NAMESPACE=${NAMESPACE:-kamayuk-$AMBIENTE}

AQUI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
INFRA=$(cd "$AQUI/.." && pwd)
cd "$INFRA"

command -v kubectl >/dev/null 2>&1 || { echo "Falta kubectl." >&2; exit 1; }

MOTOR="deployment/kamayuk-${AMBIENTE}-postgres"
SECRETO_SUPER="kamayuk-${AMBIENTE}-postgres-superusuario"

CLAVE_SUPER=$(kubectl -n "$NAMESPACE" get secret "$SECRETO_SUPER" \
    -o jsonpath='{.data.clave-superusuario}' | base64 --decode)
[ -n "$CLAVE_SUPER" ] \
    || { echo "No se pudo leer la clave del superusuario desde «${SECRETO_SUPER}»." >&2; exit 1; }

# El inventario, una linea por rol de PostgreSQL: «rol secreto clave rolDePostgres base».
#
# La base sale del inventario y **no se supone `sgtm`**: `kamayuk_respaldo` no tiene
# `CONNECT` sobre el padron a proposito (#155) y `keycloak` tiene la suya, asi que
# sondearlos contra `sgtm` daria un rojo falso justo en los dos roles cuyo aislamiento
# es deliberado — paso al escribir este guion, y el rojo era indistinguible del de un
# rol sin `LOGIN`.
# shellcheck disable=SC2016  # `${}` aqui son plantillas de JavaScript, no del shell
inventario=$(yarn --silent secretos --ambiente "$AMBIENTE" | node -e '
  const datos = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const filas = datos
    // Los ESPEJOS no entran, y no es un olvido (C-17, punto 4): un espejo es el MISMO valor de
    // un rol del cluster publicado en el namespace de quien lo consume, no una credencial mas.
    // Con ellos dentro, este guion haria cinco `ALTER ROLE kamayuk_app` seguidos —uno por copia—
    // con valores que tienen que ser el mismo, y el ultimo decidiria. Quien manda es el `Secret`
    // de la plataforma, que es de donde `bootstrap-secretos.sh` los copia.
    .filter((e) => e.rolDePostgres && e.espejoDe === undefined)
    .map((e) =>
      [e.rol, e.namespace, e.secreto, e.clave, e.rolDePostgres, e.baseDeDatos || "sgtm"].join(" "),
    );
  process.stdout.write(filas.join("\n"));
')
[ -n "$inventario" ] || { echo "El inventario no trae ningun rol de PostgreSQL." >&2; exit 1; }

FALLOS=0

while read -r rol ns secreto clave rolDePostgres base; do
    [ -n "$rol" ] || continue

    valor=$(kubectl -n "$ns" get secret "$secreto" -o jsonpath="{.data.$clave}" \
        2>/dev/null | base64 --decode || true)
    if [ -z "$valor" ]; then
        echo "  FALTA  ${rolDePostgres}: no existe ${secreto}/${clave} en ${ns}." >&2
        echo "         Correr antes: secretos/bootstrap-secretos.sh --ambiente ${AMBIENTE}" >&2
        FALLOS=$((FALLOS + 1))
        continue
    fi

    if [ -z "$SOLO_COMPROBAR" ]; then
        # Por la entrada estandar, con `-v`: `--command` NO interpola variables de psql.
        # `:'clave'` entrecomilla como literal —una clave con comilla simple se asigna
        # bien en vez de romper la sentencia— y `:"rol"` como identificador citado.
        kubectl -n "$NAMESPACE" exec -i "$MOTOR" -c postgres -- env PGPASSWORD="$CLAVE_SUPER" \
            psql --username=postgres --dbname=sgtm --quiet \
            -v rol="$rolDePostgres" -v clave="$valor" <<'SQL' >/dev/null
ALTER ROLE :"rol" LOGIN PASSWORD :'clave';
SQL
    fi

    # La comprobacion es la misma en los dos modos, y es lo unico que demuestra algo:
    # que el `ALTER ROLE` se ejecutara sin error no dice que la credencial sirva.
    if kubectl -n "$NAMESPACE" exec "$MOTOR" -c postgres -- env PGPASSWORD="$valor" \
            psql --host=127.0.0.1 --username="$rolDePostgres" --dbname="$base" --quiet \
            --command 'SELECT 1' >/dev/null 2>&1; then
        echo "  OK     ${rolDePostgres} se conecta a «${base}» con la clave de ${secreto}/${clave}"
    else
        echo "  MAL    ${rolDePostgres} NO se conecta a «${base}» con la clave de ${secreto}/${clave}" >&2
        FALLOS=$((FALLOS + 1))
    fi
done <<< "$inventario"

echo
if [ "$FALLOS" -gt 0 ]; then
    if [ -n "$SOLO_COMPROBAR" ]; then
        echo "FALLO: $FALLOS credenciales del inventario no sirven contra ${NAMESPACE}." >&2
        echo "Corre este mismo guion SIN --comprobar para llevarlas al motor." >&2
    else
        echo "FALLO: $FALLOS credenciales siguen sin servir despues del ALTER ROLE." >&2
    fi
    exit 1
fi
echo "Las credenciales del inventario sirven contra ${NAMESPACE}. Ningun valor se imprimio."
