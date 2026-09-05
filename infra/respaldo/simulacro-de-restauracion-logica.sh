#!/usr/bin/env bash
# El simulacro de restauracion LOGICA, ejecutado de verdad (C-11, y el hueco 3 de C-4).
#
# ## Que NO es: no sustituye al simulacro de INF-08
#
# `respaldo/simulacro-de-restauracion.sh` es **fisico**: wal-g, respaldo base y PITR. Copia
# bloques y no reconstruye nada, asi que ningun defecto de este archivo lo puede tocar —y
# por eso el defecto que C-4 encontro llevaba meses sin que nada lo dijera—.
#
# Este es el otro camino, el **logico**: `pg_dump` y `pg_restore`. Es el que se usa para
# migrar de ambiente, para copiar `prod` a `stg`, para separar un sistema de otro, y para
# recuperar cuando lo que se tiene es un `.dump` y no un directorio de datos. Los dos hacen
# falta y ninguno cubre al otro.
#
# ## El defecto que existe para cazar, medido y no supuesto
#
# `pg_dump` empieza todo volcado vaciando el `search_path`:
#
#     SELECT pg_catalog.set_config('search_path', '', false);
#
# Cualifica con su esquema todo lo que emite, y lo unico que no puede cualificar es **el
# interior del cuerpo de una funcion**, que para el es una cadena opaca. Si ese cuerpo
# nombra algo que se resuelve por `search_path` —`unaccent(...)`, `'unaccent'::regdictionary`—
# la funcion falla al insertarse en linea, y con ella se cae todo lo que la usa: un indice,
# o —peor— una COLUMNA GENERADA, que se inserta al CREAR LA TABLA.
#
# Medido contra PostgreSQL 16.15, antes de que C-4 lo arreglara: en `catastro`, **la tabla
# `via` no se creaba** y detras se caian `predio`, `arancel`, sus foraneas, sus comentarios
# y sus indices. 85 errores.
#
# ## Y por que no basta con mirar el codigo de salida
#
# Porque **las dos herramientas no contestan lo mismo ante el mismo volcado**. Medido en
# esta misma maquina, con el defecto dentro (C-11 §2):
#
#     pg_restore  sobre  -Fc      16 errores, codigo de salida 1
#     psql -f     sobre  PLANO    18 errores, codigo de salida 0     <-- en verde
#
# El camino plano es el que una persona teclea (`pg_dump ... | psql ...`), y termina en
# verde con la mitad del esquema perdida. Por eso este guion **cuenta los errores de la
# salida** y no le cree al codigo de salida, y por eso restaura de las dos formas.
#
# ## Que hace, exactamente, por sistema
#
#   1. Crea la base ORIGEN, la provisiona como el ambiente real —`crear-roles.sql` como
#      superusuario, que es quien crea las extensiones que ESE sistema declara (C-10)— y
#      le aplica sus migraciones en orden de version, como `sgtm_owner`.
#   2. Siembra los datos de ensayo (`--sin-datos` los quita). Sin filas, la comparacion de
#      datos seria «0 = 0» en todas las tablas y no diria nada.
#   3. Vuelca en los dos formatos: `-Fc` y plano.
#   4. Restaura cada volcado sobre una base RECIEN CREADA Y VACIA. Vacia a proposito: es lo
#      que hace un destino de verdad, y las extensiones tienen que venir del propio volcado.
#   5. Cuenta los errores de la salida de cada restauracion, y **no** se fia del codigo.
#   6. Compara ORIGEN contra RESTAURADA:
#        - el CENSO del catalogo: tablas, indices, restricciones, politicas de RLS,
#          disparadores, funciones, secuencias, dominios y extensiones, por nombre;
#        - el RETRATO exhaustivo por tabla, que es `Retrato.java` —el comparador que ya
#          existe— pasado por `canonizar.py`;
#        - las FILAS de cada tabla.
#   7. Descuenta las perdidas DECLARADAS de ese esquema (`rl_perdidas_conocidas`), en las
#      dos direcciones: una perdida no declarada es roja, y una declarada que deja de
#      ocurrir tambien.
#
#   uso: infra/respaldo/simulacro-de-restauracion-logica.sh \
#            [--host 127.0.0.1] [--puerto 5432] [--usuario postgres] \
#            [--binarios /opt/homebrew/opt/postgresql@16/bin] \
#            [--sistema rentas]... [--sin-datos] [--sin-retrato] [--conservar]
#
# La clave del superusuario sale de `PGPASSWORD`, como en el resto de `infra/`.
#
# NO levanta ningun motor: apunta al que se le diga. El motor de verificacion se levanta
# con `verificaciones/motor/lib-motor-local.sh`, y aqui no se hace porque este guion tiene
# que poder correr contra el motor que ya haya —que es como se midio C-4 y C-10—.
set -euo pipefail

AQUI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
RAIZ=$(cd "$AQUI/../.." && pwd)

# shellcheck source=lib-restauracion-logica.sh
. "$AQUI/lib-restauracion-logica.sh"

HOST=127.0.0.1
PUERTO=5432
USUARIO=postgres
BINARIOS=""
SISTEMAS=()
CON_DATOS=si
CON_RETRATO=si
CONSERVAR=""

while [ $# -gt 0 ]; do
    case "$1" in
        --host) HOST=${2:?falta el valor de --host}; shift 2 ;;
        --puerto) PUERTO=${2:?falta el valor de --puerto}; shift 2 ;;
        --usuario) USUARIO=${2:?falta el valor de --usuario}; shift 2 ;;
        --binarios) BINARIOS=${2:?falta el valor de --binarios}; shift 2 ;;
        --sistema) SISTEMAS+=("${2:?falta el valor de --sistema}"); shift 2 ;;
        --sin-datos) CON_DATOS=""; shift ;;
        --sin-retrato) CON_RETRATO=""; shift ;;
        --conservar) CONSERVAR=si; shift ;;
        *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
    esac
done

# Sin `--sistema`, los cinco. La lista vive en la biblioteca —`rl_sistemas`— para que una
# prueba pueda EJECUTARLA sin motor y compararla con `SISTEMAS` de
# `verificaciones/deriva-de-migraciones.ts`.
if [ ${#SISTEMAS[@]} -eq 0 ]; then
    while IFS= read -r sistema; do SISTEMAS+=("$sistema"); done < <(rl_sistemas)
fi

PSQL="${BINARIOS:+$BINARIOS/}psql"
PG_DUMP="${BINARIOS:+$BINARIOS/}pg_dump"
PG_RESTORE="${BINARIOS:+$BINARIOS/}pg_restore"

TRABAJO=$(mktemp -d)
limpiar() {
    rm -rf "$TRABAJO"
    [ -n "$CONSERVAR" ] && return 0
    local base
    for base in "${BASES_CREADAS[@]:-}"; do
        [ -n "$base" ] || continue
        admin -q -c "DROP DATABASE IF EXISTS $base WITH (FORCE)" >/dev/null 2>&1 || true
    done
}
trap limpiar EXIT

BASES_CREADAS=()

admin() { "$PSQL" -h "$HOST" -p "$PUERTO" -U "$USUARIO" -d postgres "$@"; }
en() { local base=$1; shift; "$PSQL" -h "$HOST" -p "$PUERTO" -U "$USUARIO" -d "$base" "$@"; }

# ---------------------------------------------------------------------------
# 0. El motor y los binarios, antes de tocar nada
# ---------------------------------------------------------------------------
VERSION_SERVIDOR=$(admin -Atc 'SELECT version()')
MAJOR_SERVIDOR=$(rl_major_de "$VERSION_SERVIDOR")
rl_exigir_version_soportada "$MAJOR_SERVIDOR"
rl_exigir_binarios_del_motor "$MAJOR_SERVIDOR" \
    "psql=$(rl_major_de "$("$PSQL" --version)")" \
    "pg_dump=$(rl_major_de "$("$PG_DUMP" --version)")" \
    "pg_restore=$(rl_major_de "$("$PG_RESTORE" --version)")"
echo "Motor: PostgreSQL $MAJOR_SERVIDOR en $HOST:$PUERTO — binarios del $MAJOR_SERVIDOR."
echo

CENSO_SQL="$AQUI/restauracion-logica/censo-del-catalogo.sql"
FILAS_SQL="$AQUI/restauracion-logica/filas-por-tabla.sql"
ENSAYO="$AQUI/restauracion-logica/datos-de-ensayo"

# El comparador NO se escribe aqui: es `Retrato.java`, que ya existe y ya sabe sacar un
# retrato exhaustivo del catalogo de una tabla —columnas, restricciones, indices,
# politicas, privilegios incluidos los de columna, disparadores y comentarios—, con
# `canonizar.py` al lado. Vive en el clon de `rentas`; escribir una tercera copia seria el
# defecto que C-3 §7 hueco 2 dejo dicho.
VERIFICAR="$RAIZ/../rentas/docs/40-datos/baselines/verificar"

# El libro de Flyway, para los esquemas que lo NOMBRAN en una migracion (hoy solo el
# monolito, en su `V21`). Aqui las migraciones las aplica `psql` y no Flyway —Flyway
# exigiria darle a `sgtm_owner` una clave, y `ALTER ROLE` es del CLUSTER: pisaria la que
# derivan los cuatro bancos de prueba y romperia toda corrida de Gradle que apunte a este
# mismo motor (#698)—, asi que la tabla la crea este guion con la forma que Flyway 11 usa.
libro_de_flyway() {
    en "$1" -q -v ON_ERROR_STOP=1 <<'SQL'
SET ROLE sgtm_owner;
CREATE TABLE flyway_schema_history (
    installed_rank integer NOT NULL,
    version varchar(50),
    description varchar(200) NOT NULL,
    type varchar(20) NOT NULL,
    script varchar(1000) NOT NULL,
    checksum integer,
    installed_by varchar(100) NOT NULL,
    installed_on timestamp NOT NULL DEFAULT now(),
    execution_time integer NOT NULL,
    success boolean NOT NULL,
    CONSTRAINT flyway_schema_history_pk PRIMARY KEY (installed_rank)
);
CREATE INDEX flyway_schema_history_s_idx ON flyway_schema_history (success);
SQL
}

crear_base() {
    local base=$1
    admin -q -c "DROP DATABASE IF EXISTS $base WITH (FORCE)" >/dev/null 2>&1 || true
    # La misma sentencia que `MotorPostgres.sentenciaDeCreacion` (#706): la codificacion y
    # la intercalacion se DECLARAN, no se heredan del cluster anfitrion.
    admin -q -c "CREATE DATABASE $base TEMPLATE template0 ENCODING 'UTF8' \
                 LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8'"
    BASES_CREADAS+=("$base")
}

retrato() {
    local base=$1 salida=$2 tablas=$3
    ( cd "$VERIFICAR" && SGTM_BASELINE_URL="jdbc:postgresql://$HOST:$PUERTO/postgres" \
        SGTM_BASELINE_USUARIO="$USUARIO" SGTM_BASELINE_CLAVE="${PGPASSWORD:-}" \
        ./gradlew -q run -Dclase=Retrato --args="$base $salida $tablas" --console=plain \
        >/dev/null )
    python3 "$VERIFICAR/canonizar.py" "$salida" "$salida.c" >/dev/null
}

FALLOS=0
RESUMEN=()

for SISTEMA in "${SISTEMAS[@]}"; do
    echo "══════ $SISTEMA ══════"
    ROLES=$(rl_roles_de "$SISTEMA" "$RAIZ")
    MIGRACIONES=$(rl_migraciones_de "$SISTEMA" "$RAIZ")
    ORIGEN="c11_${SISTEMA}_origen"
    REST_C="c11_${SISTEMA}_restaurada_fc"
    REST_P="c11_${SISTEMA}_restaurada_plana"

    # -- 1. la base origen, provisionada como el ambiente real ------------------
    crear_base "$ORIGEN"
    en "$ORIGEN" -q -v ON_ERROR_STOP=1 -f "$ROLES" >/dev/null
    if rl_necesita_libro_de_flyway "$MIGRACIONES"; then libro_de_flyway "$ORIGEN"; fi
    ARGS=(-c "SET ROLE sgtm_owner")
    while IFS= read -r archivo; do ARGS+=(-f "$archivo"); done \
        < <(rl_migraciones_en_orden "$MIGRACIONES")
    en "$ORIGEN" -q -v ON_ERROR_STOP=1 "${ARGS[@]}" >/dev/null
    CUANTAS=$(( ${#ARGS[@]} / 2 - 1 ))
    echo "  esquema aplicado: $CUANTAS migraciones"

    # -- 2. los datos de ensayo -------------------------------------------------
    if [ -n "$CON_DATOS" ]; then
        en "$ORIGEN" -q -v ON_ERROR_STOP=1 -f "$ENSAYO/comun.sql" -f "$ENSAYO/$SISTEMA.sql" \
            >/dev/null
    fi

    # -- 3. los dos volcados ----------------------------------------------------
    "$PG_DUMP" -h "$HOST" -p "$PUERTO" -U "$USUARIO" -Fc -d "$ORIGEN" -f "$TRABAJO/$SISTEMA.dump"
    "$PG_DUMP" -h "$HOST" -p "$PUERTO" -U "$USUARIO" -d "$ORIGEN" -f "$TRABAJO/$SISTEMA.sql"

    # -- 4. y 5. las dos restauraciones, sobre bases vacias ---------------------
    crear_base "$REST_C"
    set +e
    "$PG_RESTORE" -h "$HOST" -p "$PUERTO" -U "$USUARIO" -d "$REST_C" \
        "$TRABAJO/$SISTEMA.dump" >/dev/null 2>"$TRABAJO/$SISTEMA.fc.err"
    CODIGO_C=$?
    set -e
    ERRORES_C=$(rl_errores_de_pg_restore "$TRABAJO/$SISTEMA.fc.err")

    crear_base "$REST_P"
    set +e
    en "$REST_P" -q -f "$TRABAJO/$SISTEMA.sql" >/dev/null 2>"$TRABAJO/$SISTEMA.plano.err"
    CODIGO_P=$?
    set -e
    ERRORES_P=$(rl_errores_de_psql "$TRABAJO/$SISTEMA.plano.err")

    echo "  pg_restore (-Fc): $ERRORES_C error(es), codigo de salida $CODIGO_C"
    echo "  psql (plano)    : $ERRORES_P error(es), codigo de salida $CODIGO_P"
    if [ "$ERRORES_C" -gt 0 ]; then
        grep '^pg_restore: error:' "$TRABAJO/$SISTEMA.fc.err" | head -3 | sed 's/^/      /'
    fi

    # -- 6. el censo del catalogo, ORIGEN contra RESTAURADA ---------------------
    en "$ORIGEN" -Atf "$CENSO_SQL" > "$TRABAJO/$SISTEMA.censo.origen"
    en "$REST_C" -Atf "$CENSO_SQL" > "$TRABAJO/$SISTEMA.censo.fc"
    en "$REST_P" -Atf "$CENSO_SQL" > "$TRABAJO/$SISTEMA.censo.plano"
    diff "$TRABAJO/$SISTEMA.censo.origen" "$TRABAJO/$SISTEMA.censo.fc" \
        > "$TRABAJO/$SISTEMA.censo.diff" || true
    { grep '^<' "$TRABAJO/$SISTEMA.censo.diff" || true; } | cut -c3- | sort \
        > "$TRABAJO/$SISTEMA.perdido"
    { grep '^>' "$TRABAJO/$SISTEMA.censo.diff" || true; } | cut -c3- | sort \
        > "$TRABAJO/$SISTEMA.de_mas"
    rl_perdidas_conocidas "$SISTEMA" | sort > "$TRABAJO/$SISTEMA.declarado"
    rl_tablas_afectadas "$SISTEMA" > "$TRABAJO/$SISTEMA.afectadas"

    echo "  censo del catalogo: $(wc -l < "$TRABAJO/$SISTEMA.censo.origen" | tr -d ' ') objetos" \
         "en el origen, $(wc -l < "$TRABAJO/$SISTEMA.censo.fc" | tr -d ' ') en la restaurada"
    awk '{print $1}' "$TRABAJO/$SISTEMA.censo.origen" | sort | uniq -c \
        | awk '{printf "      %-22s %s\n", $2, $1}'

    # -- 7. las filas ------------------------------------------------------------
    en "$ORIGEN" -Atf "$FILAS_SQL" > "$TRABAJO/$SISTEMA.filas.origen"
    en "$REST_C" -Atf "$FILAS_SQL" > "$TRABAJO/$SISTEMA.filas.fc"
    # Las filas de una tabla que la restauracion no llega a crear se pierden CON ella, y eso
    # ya lo dice el censo. Se descuentan las tablas afectadas por una perdida declarada —y
    # solo esas—, derivadas de la propia lista y no escritas aparte.
    diff "$TRABAJO/$SISTEMA.filas.origen" "$TRABAJO/$SISTEMA.filas.fc" \
        > "$TRABAJO/$SISTEMA.filas.diff.bruto" || true
    if [ -s "$TRABAJO/$SISTEMA.afectadas" ]; then
        { grep -vE "^[<>] FILAS ($(paste -sd'|' - < "$TRABAJO/$SISTEMA.afectadas")) " \
            "$TRABAJO/$SISTEMA.filas.diff.bruto" || true; } > "$TRABAJO/$SISTEMA.filas.diff"
    else
        cp "$TRABAJO/$SISTEMA.filas.diff.bruto" "$TRABAJO/$SISTEMA.filas.diff"
    fi
    SEMBRADAS=$(awk '{s += $3} END {print s + 0}' "$TRABAJO/$SISTEMA.filas.origen")
    RESTAURADAS=$(awk '{s += $3} END {print s + 0}' "$TRABAJO/$SISTEMA.filas.fc")
    echo "  filas: $SEMBRADAS en el origen, $RESTAURADAS en la restaurada"

    # -- 8. el retrato exhaustivo, tabla por tabla -------------------------------
    RETRATO_DIF=0
    if [ -n "$CON_RETRATO" ]; then
        # Las tablas afectadas por una perdida declarada se excluyen del retrato: su
        # diferencia esta explicada por el censo, y dejarlas haria que el retrato de `sgtm`
        # fuera rojo por construccion. Lo que se pierde —y hay que decirlo— es la
        # profundidad sobre esas tablas y solo sobre esas.
        TODAS=$(grep -E '^(TABLA|TABLA_PARTICIONADA) ' "$TRABAJO/$SISTEMA.censo.origen" \
                | awk '{print $2}' | sort -u)
        TABLAS=$(comm -23 <(printf '%s\n' "$TODAS") "$TRABAJO/$SISTEMA.afectadas" | paste -sd, -)
        EXCLUIDAS=$(wc -l < "$TRABAJO/$SISTEMA.afectadas" | tr -d ' ')
        retrato "$ORIGEN" "$TRABAJO/$SISTEMA.retrato.origen" "$TABLAS"
        retrato "$REST_C" "$TRABAJO/$SISTEMA.retrato.fc" "$TABLAS"
        diff "$TRABAJO/$SISTEMA.retrato.origen.c" "$TRABAJO/$SISTEMA.retrato.fc.c" \
            > "$TRABAJO/$SISTEMA.retrato.diff" || true
        RETRATO_DIF=$(grep -c '^[<>]' "$TRABAJO/$SISTEMA.retrato.diff" || true)
        echo "  retrato exhaustivo: $(wc -l < "$TRABAJO/$SISTEMA.retrato.origen.c" | tr -d ' ')" \
             "lineas, $RETRATO_DIF de diferencia (tablas excluidas por perdida declarada:" \
             "$EXCLUIDAS)"
    fi

    # -- 9. el veredicto ---------------------------------------------------------
    MALO=0
    DECLARADAS=$(wc -l < "$TRABAJO/$SISTEMA.declarado" | tr -d ' ')

    # El recuento de errores solo puede ser el criterio en un esquema que NO declara
    # perdidas. Donde las declara —hoy solo el monolito— los errores son precisamente esas
    # perdidas, y el veredicto lo dan el censo y las filas, que ademas dicen CUALES. Sin
    # esta distincion, `sgtm` seria rojo para siempre y bloquearia a los otros cuatro, que
    # es lo que C-11 tenia prohibido hacer.
    if [ "$DECLARADAS" -eq 0 ]; then
        rl_restauracion_limpia "$ERRORES_C" "$CODIGO_C" || {
            echo "  ROJO la restauracion desde el volcado -Fc no fue limpia" >&2
            MALO=1
        }
        rl_restauracion_limpia "$ERRORES_P" "$CODIGO_P" || {
            echo "  ROJO la restauracion desde el volcado PLANO no fue limpia" >&2
            MALO=1
        }
    fi

    NO_DECLARADO=$(comm -23 "$TRABAJO/$SISTEMA.perdido" "$TRABAJO/$SISTEMA.declarado")
    NO_OCURRIO=$(comm -13 "$TRABAJO/$SISTEMA.perdido" "$TRABAJO/$SISTEMA.declarado")
    DE_MAS=$(cat "$TRABAJO/$SISTEMA.de_mas")
    FILAS_DIF=$(grep -c '^[<>]' "$TRABAJO/$SISTEMA.filas.diff" || true)

    if [ -n "$NO_DECLARADO" ]; then
        echo "  ROJO se PERDIERON objetos que nadie declaro perdidos:" >&2
        printf '%s\n' "$NO_DECLARADO" | sed 's/^/        /' >&2
        MALO=1
    fi
    if [ -n "$NO_OCURRIO" ]; then
        echo "  ROJO «${SISTEMA}» declara perdidas que ya NO ocurren. Quita la entrada de" >&2
        echo "       rl_perdidas_conocidas, o la lista empieza a mentir:" >&2
        printf '%s\n' "$NO_OCURRIO" | sed 's/^/        /' >&2
        MALO=1
    fi
    if [ -n "$DE_MAS" ]; then
        echo "  ROJO la restaurada tiene objetos que el origen no tiene:" >&2
        printf '%s\n' "$DE_MAS" | sed 's/^/        /' >&2
        MALO=1
    fi
    if [ "$FILAS_DIF" -gt 0 ]; then
        echo "  ROJO se perdieron o aparecieron FILAS:" >&2
        { grep '^[<>]' "$TRABAJO/$SISTEMA.filas.diff" || true; } | sed 's/^/        /' >&2
        MALO=1
    fi
    if [ "$RETRATO_DIF" -gt 0 ]; then
        echo "  ROJO el retrato exhaustivo difiere en $RETRATO_DIF linea(s):" >&2
        head -20 "$TRABAJO/$SISTEMA.retrato.diff" | sed 's/^/        /' >&2
        MALO=1
    fi

    if [ "$MALO" -eq 0 ]; then
        if [ "$DECLARADAS" -gt 0 ]; then
            echo "  OK   restaura entero SALVO las $DECLARADAS perdida(s) DECLARADA(S):"
            sed 's/^/        /' "$TRABAJO/$SISTEMA.declarado"
            RESUMEN+=("$SISTEMA: OK con $DECLARADAS perdida(s) declarada(s)")
        else
            echo "  OK   no se pierde nada"
            RESUMEN+=("$SISTEMA: OK")
        fi
    else
        FALLOS=$((FALLOS + 1))
        RESUMEN+=("$SISTEMA: ROJO")
    fi
    echo
done

echo "══════ resumen ══════"
printf '  %s\n' "${RESUMEN[@]}"
[ -n "$CONSERVAR" ] && echo "  (las bases c11_* se conservan: --conservar)"
echo
if [ "$FALLOS" -eq 0 ]; then
    echo "LA RESTAURACION LOGICA NO PIERDE NADA QUE NO ESTE DECLARADO"
    exit 0
fi
echo "$FALLOS ESQUEMA(S) EN ROJO" >&2
exit 1
