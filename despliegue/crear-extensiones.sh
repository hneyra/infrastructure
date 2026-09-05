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
# ## CINCO sistemas, no uno (C-10)
#
# Hasta C-10 este guion tenia **la ruta del monolito escrita a mano** y hablaba con **una**
# base, `sgtm`. Con el corte en cinco repositorios eso dejo fuera a los cuatro sistemas
# nuevos: el hueco 3 de C-2 §6.
#
# Ahora `--sistema` elige, y nada se escribe aqui:
#
#   - el archivo de roles se BUSCA. Para `sgtm`, la copia de ESTE repositorio, que es la
#     que de verdad se aplica —`componentes/fuentes.ts` la mete en el `ConfigMap` y el
#     compose la monta como `10-crear-roles.sql`—. Para los otros cuatro, el clon hermano,
#     con un comodin sobre el nombre del modulo: `../<sistema>/backend/*/src/main/...`. Si
#     hay cero o mas de uno, se dice; adivinar es lo que hace que una guarda mienta.
#   - la base **es el nombre del sistema** en los cinco. No hay tabla que mantener:
#     `05-crear-bases.sh` crea `rentas`, `catastro`, `normativa` y `caja` con ese nombre, y
#     la del monolito se llama `sgtm`.
#   - las extensiones salen de `extensiones_declaradas`, la misma funcion que usa
#     `05-crear-bases.sh`. Dos copias del patron son dos sitios donde dejar de ver una.
#
# `--sistema` por omision es `sgtm`, que es el unico que se despliega hoy: sin argumento,
# este guion hace exactamente lo que hacia antes de C-10.
#
# `--listar` dice que crearia, sin tocar nada y **sin kubectl**. Es lo que permite que una
# prueba EJECUTE este guion en vez de leerlo.
#
#   uso: despliegue/crear-extensiones.sh --ambiente stg|prod [--sistema sgtm]
#                                        [--namespace sgtm-stg] [--comprobar]
#        despliegue/crear-extensiones.sh --listar [--sistema catastro]
#
# Requiere: kubectl con el tunel al API del ambiente ya abierto (ver infra/README.md).
# `--listar` no requiere nada.
set -euo pipefail

AMBIENTE=""
NAMESPACE=""
SOLO_COMPROBAR=""
SOLO_LISTAR=""
SISTEMA="sgtm"
while [ $# -gt 0 ]; do
    case "$1" in
        --ambiente) AMBIENTE=${2:?falta el valor de --ambiente}; shift 2 ;;
        --namespace) NAMESPACE=${2:?falta el valor de --namespace}; shift 2 ;;
        --sistema) SISTEMA=${2:?falta el valor de --sistema}; shift 2 ;;
        --comprobar) SOLO_COMPROBAR=si; shift ;;
        --listar) SOLO_LISTAR=si; shift ;;
        *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
    esac
done

AQUI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
RAIZ=$(cd "$AQUI/.." && pwd)

# shellcheck source=inicializacion-del-motor/lib-extensiones.sh
. "$AQUI/inicializacion-del-motor/lib-extensiones.sh"

# La base es el nombre del sistema en los cinco: `05-crear-bases.sh` crea las cuatro con
# ese nombre y la del monolito se llama `sgtm`. Una tabla aqui seria un sitio mas que
# mantener de acuerdo.
BASE="$SISTEMA"

# El archivo de roles se busca; no se escribe.
if [ "$SISTEMA" = "sgtm" ]; then
    # La copia de ESTE repositorio, que es la que se aplica de verdad: el `ConfigMap` del
    # cluster y el compose montan esta, no la del clon.
    ROLES="$RAIZ/backend/sgtm-esquema/src/main/resources/db/roles/crear-roles.sql"
    CANDIDATOS=("$ROLES")
else
    CLON=$(cd "$RAIZ/.." && pwd)/"$SISTEMA"
    [ -d "$CLON" ] || {
        echo "No esta el clon de «${SISTEMA}» en «${CLON}», asi que no se puede saber que" >&2
        echo "extensiones declara. Traelo con:" >&2
        echo "    git clone https://github.com/hneyra/$SISTEMA $CLON" >&2
        exit 1
    }
    # Comodin sobre el nombre del modulo: hoy es `kamayuk-<sistema>-esquema`, y esa
    # convencion no es de este guion. Cero o mas de uno se dice en vez de elegir.
    shopt -s nullglob
    CANDIDATOS=("$CLON"/backend/*/src/main/resources/db/roles/crear-roles.sql)
    shopt -u nullglob
fi

if [ ${#CANDIDATOS[@]} -ne 1 ] || [ ! -f "${CANDIDATOS[0]}" ]; then
    echo "En «${SISTEMA}» hay ${#CANDIDATOS[@]} archivo(s) db/roles/crear-roles.sql y tiene" >&2
    echo "que haber exactamente uno. Encontrados: ${CANDIDATOS[*]:-(ninguno)}" >&2
    exit 1
fi
ROLES="${CANDIDATOS[0]}"

extensiones=$(extensiones_declaradas "$ROLES")

if [ -n "$SOLO_LISTAR" ]; then
    # Cero es una respuesta legitima —`caja` y, tras C-13, `normativa`—, asi que se dice
    # y se sale en verde. Callar aqui haria indistinguible «no declara ninguna» de «no se
    # pudo leer el archivo», que es lo que la comprobacion de arriba existe para separar.
    if [ -z "$extensiones" ]; then
        echo "$SISTEMA $BASE (ninguna)"
    else
        for extension in $extensiones; do echo "$SISTEMA $BASE $extension"; done
    fi
    exit 0
fi

# Cero extensiones NO es un error, y hasta C-13 aqui se trataba como tal.
#
# `caja` no declara ninguna a proposito (P5D) y `normativa` tampoco desde C-13: para esos
# dos no hay nada que crear ni nada que comprobar, y salir con codigo 1 diciendo «no
# declara ninguna extension» convertiria la decision correcta en un despliegue rojo.
if [ -z "$extensiones" ]; then
    echo "«${SISTEMA}» no declara ninguna extension: no hay nada que crear en «${BASE}»."
    exit 0
fi

[ -n "$AMBIENTE" ] || { echo "Falta --ambiente (stg o prod)." >&2; exit 2; }
NAMESPACE=${NAMESPACE:-sgtm-$AMBIENTE}

command -v kubectl >/dev/null 2>&1 || { echo "Falta kubectl." >&2; exit 1; }

MOTOR="deployment/sgtm-${AMBIENTE}-postgres"
SECRETO_SUPER="sgtm-${AMBIENTE}-postgres-superusuario"

CLAVE_SUPER=$(kubectl -n "$NAMESPACE" get secret "$SECRETO_SUPER" \
    -o jsonpath='{.data.clave-superusuario}' | base64 --decode)
[ -n "$CLAVE_SUPER" ] \
    || { echo "No se pudo leer la clave del superusuario desde «${SECRETO_SUPER}»." >&2; exit 1; }

FALLOS=0
for extension in $extensiones; do
    if [ -z "$SOLO_COMPROBAR" ]; then
        kubectl -n "$NAMESPACE" exec -i "$MOTOR" -c postgres -- env PGPASSWORD="$CLAVE_SUPER" \
            psql --username=postgres --dbname="$BASE" --quiet \
            -v extension="$extension" <<'SQL' >/dev/null
CREATE EXTENSION IF NOT EXISTS :"extension";
SQL
    fi

    # Lo unico que demuestra algo: que la sentencia no diera error no dice que este.
    if kubectl -n "$NAMESPACE" exec "$MOTOR" -c postgres -- env PGPASSWORD="$CLAVE_SUPER" \
            psql --username=postgres --dbname="$BASE" --quiet --tuples-only \
            --command "SELECT 1 FROM pg_extension WHERE extname = '$extension'" 2>/dev/null \
            | grep -q 1; then
        echo "  OK     ${extension} esta creada en «${BASE}» de ${NAMESPACE}"
    else
        echo "  FALTA  ${extension} NO esta creada en «${BASE}» de ${NAMESPACE}" >&2
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
echo "Las extensiones que «${SISTEMA}» declara estan en «${BASE}» de ${NAMESPACE}."
