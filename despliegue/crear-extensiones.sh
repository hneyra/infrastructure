#!/usr/bin/env bash
# Lleva al motor EN MARCHA las extensiones que `crear-roles.sql` declara (ADR-0021).
#
# ## El hueco que cierra, medido y no supuesto
#
# `crear-roles.sql` crea `pg_trgm`, `unaccent` y —desde ADR-0021— `postgis`, y lo hace
# bien: pero corre **una sola vez**, desde `/docker-entrypoint-initdb.d`, con el volumen
# de datos vacio. En un cluster que ya existe ese guion no vuelve a ejecutarse nunca.
#
# Es el mismo hueco exacto que #435 encontro con el `LOGIN` de `rol_carga_parametros`, y
# aqui duele mas, porque **la migracion se cae**:
#
#     ALTER TABLE predio ADD COLUMN geometria geography(MultiPolygon, 4326);
#     ERROR:  type "geography" does not exist
#
# Y no lo puede arreglar el migrador: `postgis` NO es una extension *trusted*
# —`SELECT trusted FROM pg_available_extension_versions WHERE name='postgis'` da `f`—,
# asi que crearla exige un superusuario, y `sgtm_owner` a proposito no lo es.
#
# CI nunca lo ve porque CI siempre parte de un volumen vacio.
#
# ## Cuando NO hace falta este guion
#
# Cuando el volumen se puede rehacer. Con el directorio de datos vacio, `crear-roles.sql`
# vuelve a correr entero y crea la extension por el mismo camino que CI ejercita en cada
# PR: mas simple, y mejor probado que esto. A dia de hoy (2026-08-30) `stg` y `prod` solo
# tienen datos de prueba, asi que ese es el camino recomendado para el primer despliegue
# de `V61`.
#
# Este guion es para el dia en que haya un padron que conservar — que llegara, y entonces
# «borra el volumen» deja de ser una respuesta. `verificar-el-ambiente.sh` dice en cual de
# las dos situaciones esta el ambiente.
#
# ## Que hace, exactamente
#
# Lee del propio `crear-roles.sql` las lineas `CREATE EXTENSION IF NOT EXISTS <nombre>;`
# —no una lista escrita aqui, que seria un segundo sitio donde olvidarse de una— y las
# ejecuta contra el motor en marcha con la conexion de superusuario. Es idempotente: el
# `IF NOT EXISTS` es del propio SQL, y correrlo dos veces deja el motor igual.
#
# `--comprobar` no cambia nada: solo dice, extension por extension, si esta creada. Es lo
# que hay que correr antes de desplegar una migracion que dependa de alguna.
#
#   uso: despliegue/crear-extensiones.sh --ambiente stg|prod [--namespace sgtm-stg] [--comprobar]
#
# Requiere: kubectl con el tunel al API del ambiente ya abierto (ver infra/README.md).
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
NAMESPACE=${NAMESPACE:-sgtm-$AMBIENTE}

AQUI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
RAIZ=$(cd "$AQUI/.." && pwd)
ROLES="$RAIZ/backend/sgtm-esquema/src/main/resources/db/roles/crear-roles.sql"
[ -f "$ROLES" ] || { echo "No se encontro $ROLES" >&2; exit 1; }

command -v kubectl >/dev/null 2>&1 || { echo "Falta kubectl." >&2; exit 1; }

MOTOR="deployment/sgtm-${AMBIENTE}-postgres"
SECRETO_SUPER="sgtm-${AMBIENTE}-postgres-superusuario"

CLAVE_SUPER=$(kubectl -n "$NAMESPACE" get secret "$SECRETO_SUPER" \
    -o jsonpath='{.data.clave-superusuario}' | base64 --decode)
[ -n "$CLAVE_SUPER" ] \
    || { echo "No se pudo leer la clave del superusuario desde «${SECRETO_SUPER}»." >&2; exit 1; }

# Las extensiones salen del archivo, no de una lista de aqui: anadir una a
# `crear-roles.sql` y olvidarse de este guion es justo el defecto que esto evita.
extensiones=$(grep -oiE 'CREATE EXTENSION( IF NOT EXISTS)? +[a-z_0-9]+' "$ROLES" \
    | awk '{print $NF}' | sort -u)
[ -n "$extensiones" ] || { echo "crear-roles.sql no declara ninguna extension." >&2; exit 1; }

FALLOS=0
for extension in $extensiones; do
    if [ -z "$SOLO_COMPROBAR" ]; then
        kubectl -n "$NAMESPACE" exec -i "$MOTOR" -c postgres -- env PGPASSWORD="$CLAVE_SUPER" \
            psql --username=postgres --dbname=sgtm --quiet \
            -v extension="$extension" <<'SQL' >/dev/null
CREATE EXTENSION IF NOT EXISTS :"extension";
SQL
    fi

    # Lo unico que demuestra algo: que la sentencia no diera error no dice que este.
    if kubectl -n "$NAMESPACE" exec "$MOTOR" -c postgres -- env PGPASSWORD="$CLAVE_SUPER" \
            psql --username=postgres --dbname=sgtm --quiet --tuples-only \
            --command "SELECT 1 FROM pg_extension WHERE extname = '$extension'" 2>/dev/null \
            | grep -q 1; then
        echo "  OK     ${extension} esta creada en «sgtm» de ${NAMESPACE}"
    else
        echo "  FALTA  ${extension} NO esta creada en «sgtm» de ${NAMESPACE}" >&2
        FALLOS=$((FALLOS + 1))
    fi
done

echo
if [ "$FALLOS" -gt 0 ]; then
    if [ -n "$SOLO_COMPROBAR" ]; then
        echo "FALLO: faltan $FALLOS extension(es) en ${NAMESPACE}." >&2
        echo "Corre este mismo guion SIN --comprobar para crearlas." >&2
    else
        echo "FALLO: $FALLOS extension(es) siguen sin estar despues del CREATE EXTENSION." >&2
        echo "Comprueba que la imagen del motor las traiga: postgis solo viene en" >&2
        echo "postgis/postgis, no en postgres:16-alpine (ADR-0021)." >&2
    fi
    exit 1
fi
echo "Las extensiones que crear-roles.sql declara estan en ${NAMESPACE}."
