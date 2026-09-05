#!/usr/bin/env bash
# Comprueba que la siembra de la municipalidad de demostracion DEJO LO QUE DICE DEJAR, y
# sale en ROJO nombrando lo que falta cuando no.
#
# ## Que arregla, y por que hacia falta
#
# Cada cargador rechaza fila a fila y sigue: la fila que nombra algo inexistente no revienta
# la carga, se rechaza sola. Eso es correcto -una fila mala no puede llevarse por delante a
# las buenas (#328)- y tiene un precio: sembrado en el orden equivocado, un paso rechaza
# TODAS sus filas, escribe un aviso por cada una y TERMINA CON CODIGO 0.
#
# Medido el 2026-09-05 contra PostgreSQL 16.15, con las vias, los sectores y las manzanas
# ya sembrados y sin el paso 6:
#
#   $ cargar-detalle-fichas-demo.sh ...
#   ... 51 fila(s) leidas, 0 ficha(s) versionada(s), 22 predio(s) rechazado(s)
#   $ echo $?
#   0
#
# Cincuenta y una filas leidas, ninguna dentro, y el proceso dice que fue bien. Antes del
# corte eso era una molestia; hoy es peor, porque el paso 6 depende del paso 5 y el 5 esta
# EN OTRO REPOSITORIO Y EN OTRA BASE: nadie mira las dos a la vez.
#
# ## Como lo distingue de repetir un paso, que si es legitimo
#
# Repetir un paso ya sembrado tambien rechaza todas sus filas -por unicidad- y tambien sale
# con codigo 0, y eso TIENE que seguir estando en verde: es lo que hace que `--desde N`
# sirva para retomar una siembra interrumpida. Por eso esto no cuenta lo que un paso
# ESCRIBIO sino lo que su tabla TIENE:
#
#   - siembra en orden          -> el total cuadra -> verde
#   - repetir un paso           -> el total cuadra -> verde
#   - sembrar en desorden       -> el total NO cuadra -> ROJO, y dice cuantas faltan
#
# ## Ninguna cifra esta escrita aqui
#
# Lo esperado sale de `pasos.tsv`, que a su vez no lleva numeros sino una expresion sobre el
# propio CSV que el paso carga. Una cifra escrita a mano en cualquiera de los dos se queda
# rancia en cuanto alguien anade una fila, y una comprobacion rancia en verde es el defecto
# que esto cierra un escalon mas arriba.
#
#   uso: comprobar-siembra.sh --municipalidad-id N
#          --url-catastro postgresql://...  --url-rentas postgresql://...  --url-caja postgresql://...
#          [--hasta N] [--paso N]
#
#        Las tres URL tambien se pueden dar por entorno: KAMAYUK_SIEMBRA_URL_CATASTRO,
#        KAMAYUK_SIEMBRA_URL_RENTAS, KAMAYUK_SIEMBRA_URL_CAJA. Son URL de libpq (psql), no
#        JDBC. Contra un ambiente desplegado se abre antes un `kubectl port-forward` a la
#        base de cada sistema; aqui no se hace por dentro a proposito, para que este guion se
#        pueda EJECUTAR sin cluster -que es la unica forma de saber que muerde-.
#
# Requiere: psql en el PATH. La conexion se hace como el rol que se le pase; lo que cuenta
# tiene que ser el usuario de la APLICACION (`kamayuk_app`), porque el esquema declara FORCE ROW
# LEVEL SECURITY y contar con otro rol mediria otra cosa.
set -uo pipefail

AQUI=$(cd "$(dirname "$0")" && pwd)
MANIFIESTO="$AQUI/pasos.tsv"
CLONES=$(cd "$AQUI/../../../.." && pwd)

MUNICIPALIDAD_ID=""
HASTA=10
SOLO=""
URL_CATASTRO=${KAMAYUK_SIEMBRA_URL_CATASTRO:-}
URL_RENTAS=${KAMAYUK_SIEMBRA_URL_RENTAS:-}
URL_CAJA=${KAMAYUK_SIEMBRA_URL_CAJA:-}

while [ $# -gt 0 ]; do
    case "$1" in
        --municipalidad-id) MUNICIPALIDAD_ID=${2:?falta el valor de --municipalidad-id}; shift 2 ;;
        --url-catastro) URL_CATASTRO=${2:?falta el valor}; shift 2 ;;
        --url-rentas) URL_RENTAS=${2:?falta el valor}; shift 2 ;;
        --url-caja) URL_CAJA=${2:?falta el valor}; shift 2 ;;
        --hasta) HASTA=${2:?falta el valor de --hasta}; shift 2 ;;
        --paso) SOLO=${2:?falta el valor de --paso}; shift 2 ;;
        *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
    esac
done
[ -n "$MUNICIPALIDAD_ID" ] || { echo "Falta --municipalidad-id." >&2; exit 2; }
[ -f "$MANIFIESTO" ] || { echo "No existe el manifiesto: $MANIFIESTO" >&2; exit 2; }
command -v psql >/dev/null || { echo "Falta psql en el PATH." >&2; exit 2; }

urlDe() {
    case "$1" in
        catastro) echo "$URL_CATASTRO" ;;
        rentas) echo "$URL_RENTAS" ;;
        caja) echo "$URL_CAJA" ;;
        *) echo "" ;;
    esac
}

# --------------------------------------------------------------------------------
# Las dos formas de leer un CSV de siembra. El formato lo fijan los propios archivos:
# comentarios con `#` al principio de linea, luego la cabecera, luego los datos.
# --------------------------------------------------------------------------------

filasDe() {  # <ruta>
    awk 'BEGIN{n=0} /^#/ {next} /^[[:space:]]*$/ {next} {n++} END{print (n>0 ? n-1 : 0)}' "$1"
}

distintosDe() {  # <ruta> <columna>
    awk -F',' -v col="$2" '
        /^#/ {next} /^[[:space:]]*$/ {next}
        cabecera == 0 {
            for (i = 1; i <= NF; i++) { gsub(/\r/, "", $i); if ($i == col) indice = i }
            cabecera = 1
            next
        }
        indice > 0 {
            v = $indice; gsub(/\r/, "", v); gsub(/^[ \t]+|[ \t]+$/, "", v)
            if (v != "") vistos[v] = 1
        }
        END {
            if (indice == 0) { print "SIN_COLUMNA"; exit }
            n = 0; for (v in vistos) n++
            print n
        }' "$1"
}

# Resuelve una expresion como `fichas.csv:filas+detalle-de-fichas.csv:distintos:codigoPredial`.
resolver() {  # <sistema> <expresion>
    local sistema=$1 expresion=$2 total=0 termino
    local ejemplos="$CLONES/$sistema/infra/carga-de-datos/ejemplos"
    local IFS='+'
    for termino in $expresion; do
        local archivo=${termino%%:*}
        local resto=${termino#*:}
        local ruta="$ejemplos/$archivo"
        if [ ! -f "$ruta" ]; then echo "SIN_ARCHIVO:$ruta"; return; fi
        local valor
        case "$resto" in
            filas) valor=$(filasDe "$ruta") ;;
            distintos:*) valor=$(distintosDe "$ruta" "${resto#distintos:}") ;;
            *) echo "EXPRESION_DESCONOCIDA:$resto"; return ;;
        esac
        case "$valor" in
            SIN_COLUMNA) echo "SIN_COLUMNA:$archivo:${resto#distintos:}"; return ;;
        esac
        total=$((total + valor))
    done
    echo "$total"
}

# --------------------------------------------------------------------------------
# El recuento. Siempre dentro de una transaccion con SET LOCAL: el esquema declara
# FORCE ROW LEVEL SECURITY, asi que sin contexto de tenant la consulta no devuelve
# vacio -revienta con «unrecognized configuration parameter»-. SET LOCAL y jamas SET
# SESSION (regla 3): esta conexion es de usar y tirar, pero el ejemplo tambien se lee.
# --------------------------------------------------------------------------------
contar() {  # <url> <tabla>
    psql -X -q -t -A -v ON_ERROR_STOP=1 "$1" <<SQL 2>&1
BEGIN;
SET LOCAL app.municipalidad_id = '$MUNICIPALIDAD_ID';
SELECT count(*) FROM $2;
COMMIT;
SQL
}

# --------------------------------------------------------------------------------

rojos=0
nocomprobados=0
declare -a FALTA_PASO

while IFS=$'\t' read -r paso sistema guion proceso archivo comprobacion requiere; do
    case "$paso" in ''|'#'*|paso) continue ;; esac
    [ -n "$SOLO" ] && [ "$paso" != "$SOLO" ] && continue
    [ -z "$SOLO" ] && [ "$paso" -gt "$HASTA" ] && continue

    url=$(urlDe "$sistema")
    if [ -z "$url" ]; then
        echo "  ?  $paso/10 $sistema  no se comprueba: falta --url-$sistema"
        nocomprobados=$((nocomprobados + 1))
        continue
    fi

    IFS=';' read -r -a pares <<< "$comprobacion"
    for par in "${pares[@]}"; do
        tabla=${par%%=*}
        expresion=${par#*=}
        esperado=$(resolver "$sistema" "$expresion")
        case "$esperado" in
            SIN_ARCHIVO:*|SIN_COLUMNA:*|EXPRESION_DESCONOCIDA:*)
                echo "  X  $paso/10 $sistema.$tabla  el manifiesto no se puede resolver: $esperado"
                rojos=$((rojos + 1))
                continue ;;
        esac
        obtenido=$(contar "$url" "$tabla" | tr -d ' ')
        case "$obtenido" in
            ''|*[!0-9]*)
                echo "  X  $paso/10 $sistema.$tabla  no se pudo contar: $obtenido"
                rojos=$((rojos + 1))
                continue ;;
        esac
        if [ "$obtenido" -eq "$esperado" ]; then
            printf '  ok %s/10 %-9s %-26s %s de %s\n' "$paso" "$sistema" "$tabla" "$obtenido" "$esperado"
        else
            faltan=$((esperado - obtenido))
            printf '  X  %s/10 %-9s %-26s %s de %s' "$paso" "$sistema" "$tabla" "$obtenido" "$esperado"
            if [ "$faltan" -gt 0 ]; then printf ': FALTAN %s' "$faltan"; else printf ': SOBRAN %s' "$((-faltan))"; fi
            if [ "$requiere" != "-" ]; then printf ' (el paso %s necesita antes el/los paso(s) %s)' "$paso" "$requiere"; fi
            printf '\n'
            rojos=$((rojos + 1))
            FALTA_PASO+=("$paso")
        fi
    done
done < "$MANIFIESTO"

echo
if [ "$rojos" -gt 0 ]; then
    echo "SIEMBRA INCOMPLETA: $rojos comprobacion(es) en rojo."
    echo "Una carga que rechaza sus filas TERMINA EN VERDE; lo que no cuadra es lo que quedo en la base."
    exit 1
fi
if [ "$nocomprobados" -gt 0 ]; then
    echo "NO CONCLUYE: $nocomprobados paso(s) sin comprobar por falta de --url-<sistema>."
    echo "«No se ha comprobado» no es «esta bien»: sin la URL de ese sistema no se puede afirmar nada."
    exit 3
fi
echo "Siembra completa y cuadrada."
