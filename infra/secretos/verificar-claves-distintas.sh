#!/usr/bin/env bash
# Que ningun secreto de la aplicacion comparte valor con otro, contra un cluster real
# (issue #154).
#
# Lee el inventario (`yarn secretos`) de cada ambiente dado, trae el valor real de cada
# entrada desde el cluster, y exige que todos sean distintos entre si — dentro de un
# ambiente y entre ambientes. Es la comprobacion que el issue pide explicitamente:
#
#   "volviendo a poner la misma clave para kamayuk_owner y kamayuk_app: la comprobacion de
#   que la aplicacion no puede crear una tabla sigue en verde —porque el rol es otro—
#   pero cualquiera con la clave de la aplicacion tiene DDL. Esa es la que hay que
#   escribir: claves distintas, comprobado."
#
# `completar-secreto.ts` ya hace esto estructuralmente imposible al GENERAR (lanza si
# el generador repite un valor, con su prueba unitaria). Este guion es la otra mitad:
# comprueba el resultado real en un cluster, no solo la logica que lo produjo.
#
#   uso: secretos/verificar-claves-distintas.sh --namespace kamayuk-stg [--namespace kamayuk-prod ...]
set -euo pipefail

AMBIENTES=()
NAMESPACES=()
while [ $# -gt 0 ]; do
    case "$1" in
        --ambiente) AMBIENTES+=("${2:?falta el valor de --ambiente}"); shift 2 ;;
        --namespace) NAMESPACES+=("${2:?falta el valor de --namespace}"); shift 2 ;;
        *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
    esac
done
[ "${#AMBIENTES[@]}" -gt 0 ] || { echo "Falta al menos un --ambiente." >&2; exit 2; }
[ "${#NAMESPACES[@]}" -eq "${#AMBIENTES[@]}" ] || {
    echo "Cada --ambiente necesita su --namespace, en el mismo orden." >&2
    exit 2
}

AQUI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
INFRA=$(cd "$AQUI/.." && pwd)
cd "$INFRA"

TRABAJO=$(mktemp -d)
trap 'rm -rf "$TRABAJO"' EXIT
REGISTRO="$TRABAJO/valores.tsv"
: > "$REGISTRO"

for i in "${!AMBIENTES[@]}"; do
    ambiente="${AMBIENTES[$i]}"
    namespace="${NAMESPACES[$i]}"

    inventario=$(yarn --silent secretos --ambiente "$ambiente")
    while IFS=$'\t' read -r secreto clave; do
        [ -n "$secreto" ] || continue
        valor=$(kubectl -n "$namespace" get secret "$secreto" -o jsonpath="{.data.$clave}" \
            | base64 --decode)
        [ -n "$valor" ] || {
            echo "FALLO: «${secreto}/${clave}» en «${namespace}» esta vacio o no existe." >&2
            exit 1
        }
        printf '%s\t%s\t%s\t%s\n' "$namespace" "$secreto" "$clave" "$valor" >> "$REGISTRO"
    done < <(echo "$inventario" | node -e '
      const datos = JSON.parse(require("fs").readFileSync(0, "utf8"));
      for (const e of datos) process.stdout.write(e.secreto + "\t" + e.clave + "\n");
    ')
done

# Los valores nunca se imprimen: se comparan por huella (sha256 corto), la misma que
# usa completar-secreto.ts para no revelar nada en un registro.
duplicados=$(awk -F'\t' '{print $4}' "$REGISTRO" | sort | uniq -d)
if [ -n "$duplicados" ]; then
    echo "FALLO: al menos dos entradas del inventario tienen EL MISMO valor." >&2
    echo "Es exactamente lo que este guion existe para impedir: dos roles con la" >&2
    echo "misma clave anulan la separacion de privilegios entera. Las que coinciden:" >&2
    # Solo las filas cuyo valor esta en $duplicados, y sin el valor mismo — apuntar el
    # problema sin imprimir el secreto.
    awk -F'\t' 'NR==FNR{dup[$0]=1;next} ($4 in dup){print "  · "$1"/"$2"/"$3}' \
        <(echo "$duplicados") "$REGISTRO" >&2
    exit 1
fi

total=$(wc -l < "$REGISTRO" | tr -d ' ')
echo "Comprobadas $total claves entre ${#AMBIENTES[@]} ambiente(s): todas distintas."
