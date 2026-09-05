#!/usr/bin/env bash
# Lo que el stack DICE del nodo, contrastado con lo que el nodo dice de si mismo.
#
# `capacidad.ts` compara la demanda del stack contra `nodeAllocatableCpu`/
# `nodeAllocatableMemory` de `Pulumi.<ambiente>.yaml`. Esa comprobacion es tan buena
# como el dato: una cifra optimista —un nodo que se declara mas grande de lo que es—
# la deja pasar todo, y el sintoma vuelve a ser el que este guion existe para que no
# vuelva (issue #252: `pulumi up` colgado hasta que la plataforma mata el runner).
#
# Aqui se cierra ese hueco, contra el nodo real y antes de `pulumi up`:
#
#   - Declarar MENOS de lo que hay es admisible. Es la cota inferior con que `stg`
#     entro al repositorio mientras nadie median su nodo, y solo aprieta la
#     comprobacion: si el stack cabe en un nodo mas pequeño que el real, cabe.
#   - Declarar MAS de lo que hay es lo que se rechaza. Es la unica direccion en que
#     el error hace daño, porque es la que deja pasar un despliegue que no cabe.
#
# Necesita un kubeconfig que llegue al nodo: en CI, el del tunel SSH que
# `infra.yml` ya abre; a mano, el mismo.
#
#   uso:  ./comprobar-lo-asignable.sh --ambiente prod
set -euo pipefail

AMBIENTE=""
while [ $# -gt 0 ]; do
    case "$1" in
        --ambiente) AMBIENTE="${2:-}"; shift 2 ;;
        *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
    esac
done

if [ "$AMBIENTE" != "stg" ] && [ "$AMBIENTE" != "prod" ]; then
    echo "uso: $0 --ambiente <stg|prod>" >&2
    exit 2
fi

command -v kubectl >/dev/null 2>&1 || { echo "Falta kubectl." >&2; exit 1; }

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STACK="${AQUI}/../Pulumi.${AMBIENTE}.yaml"

# El mismo analizador minimo que `verificaciones/stacks.ts`: `config:` y debajo una
# linea `kamayuk:clave: valor`. Se le quitan comillas y comentarios.
valor_declarado() {
    sed -n "s/^[[:space:]]*kamayuk:$1:[[:space:]]*\([^#]*\).*$/\1/p" "$STACK" \
        | head -1 | tr -d '"'"'"' ' | tr -d '\r'
}

# Milicores, desde "2" o "2000m".
a_mili() {
    case "$1" in
        *m) echo "${1%m}" ;;
        *) awk -v v="$1" 'BEGIN { printf "%d", v * 1000 }' ;;
    esac
}

# Mebibytes, desde lo que devuelve el API server ("6029348Ki") o el stack ("7Gi").
a_mi() {
    local numero unidad
    numero="${1//[!0-9.]/}"
    unidad="${1//[0-9.]/}"
    case "$unidad" in
        Ki) awk -v n="$numero" 'BEGIN { printf "%d", n / 1024 }' ;;
        Mi) awk -v n="$numero" 'BEGIN { printf "%d", n }' ;;
        Gi) awk -v n="$numero" 'BEGIN { printf "%d", n * 1024 }' ;;
        "") awk -v n="$numero" 'BEGIN { printf "%d", n / 1048576 }' ;;
        *) echo "Unidad de memoria desconocida: «$unidad» en «$1»." >&2; exit 1 ;;
    esac
}

# Un solo nodo, por diseño (INF-01 §1). Si algun dia hay mas, esto tiene que
# cambiar a proposito y no en silencio: por eso se cuenta y se falla.
NODOS="$(kubectl get nodes --no-headers 2>/dev/null | wc -l | tr -d ' ')"
if [ "$NODOS" != "1" ]; then
    echo "::error::El clúster de «${AMBIENTE}» tiene ${NODOS} nodos, y capacidad.ts asume uno" \
         "(INF-01 §1). Revisar la comprobacion antes de seguir."
    exit 1
fi

REAL_CPU="$(kubectl get nodes -o jsonpath='{.items[0].status.allocatable.cpu}')"
REAL_MEM="$(kubectl get nodes -o jsonpath='{.items[0].status.allocatable.memory}')"
DICHO_CPU="$(valor_declarado nodeAllocatableCpu)"
DICHO_MEM="$(valor_declarado nodeAllocatableMemory)"

if [ -z "$DICHO_CPU" ] || [ -z "$DICHO_MEM" ]; then
    echo "::error::Pulumi.${AMBIENTE}.yaml no declara nodeAllocatableCpu/nodeAllocatableMemory." \
         "Son obligatorios desde el issue #252."
    exit 1
fi

echo "Nodo real de «${AMBIENTE}»: ${REAL_CPU} CPU / ${REAL_MEM} asignables."
echo "El stack declara:            ${DICHO_CPU} CPU / ${DICHO_MEM}."

FALLO=0
if [ "$(a_mili "$DICHO_CPU")" -gt "$(a_mili "$REAL_CPU")" ]; then
    echo "::error::«${AMBIENTE}» declara MAS CPU asignable de la que el nodo tiene:" \
         "$(a_mili "$DICHO_CPU")m declarados contra $(a_mili "$REAL_CPU")m reales." \
         "capacidad.ts esta autorizando un despliegue que no cabe. Corregir" \
         "nodeAllocatableCpu en Pulumi.${AMBIENTE}.yaml con el valor de arriba."
    FALLO=1
fi
if [ "$(a_mi "$DICHO_MEM")" -gt "$(a_mi "$REAL_MEM")" ]; then
    echo "::error::«${AMBIENTE}» declara MAS memoria asignable de la que el nodo tiene:" \
         "$(a_mi "$DICHO_MEM")Mi declarados contra $(a_mi "$REAL_MEM")Mi reales." \
         "Corregir nodeAllocatableMemory en Pulumi.${AMBIENTE}.yaml."
    FALLO=1
fi
[ "$FALLO" = "0" ] || exit 1

# Declarar por debajo es admisible, pero conviene saberlo: es una comprobacion mas
# estricta de lo necesario, y el dia que aprieta de mas, este aviso explica por que.
if [ "$(a_mili "$DICHO_CPU")" -lt "$(a_mili "$REAL_CPU")" ] \
   || [ "$(a_mi "$DICHO_MEM")" -lt "$(a_mi "$REAL_MEM")" ]; then
    echo "::notice::«${AMBIENTE}» se declara mas pequeño de lo que es. Es admisible —solo" \
         "aprieta la comprobacion— pero actualizarlo con los valores reales de arriba da" \
         "el margen que el nodo de verdad tiene."
fi

echo "Correcto: lo declarado no supera lo que el nodo reparte."
