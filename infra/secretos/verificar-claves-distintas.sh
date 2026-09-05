#!/usr/bin/env bash
# Que las claves del inventario cumplen su invariante, contra un cluster real (issue #154).
#
# El inventario tiene DOS clases de entrada y la comprobacion no es la misma para las dos.
# Confundirlas fue lo que rompio este guion al pasar del monolito a los cinco repositorios:
#
#   · Las que se GENERAN. Cada una tiene su propio valor y **todas son distintas** entre si
#     y entre ambientes. Es la que pide el issue #154:
#
#       "volviendo a poner la misma clave para kamayuk_owner y kamayuk_app: la comprobacion
#       de que la aplicacion no puede crear una tabla sigue en verde —porque el rol es
#       otro— pero cualquiera con la clave de la aplicacion tiene DDL. Esa es la que hay
#       que escribir: claves distintas, comprobado."
#
#   · Los ESPEJOS (`espejoDe`). Su valor **tiene que COINCIDIR** con el de su origen, y no
#     por gusto: los cuatro sistemas se conectan con `kamayuk_app` y migran con
#     `kamayuk_owner`, que son roles del CLUSTER, y PostgreSQL le da a un rol UNA
#     contrasena. Nueve de las veintiuna entradas de un ambiente son eso: el mismo valor
#     publicado en el namespace de quien lo consume (C-17 punto 4, javadoc de `espejoDe`).
#     Exigirles «distintas» seria exigir justamente lo contrario de lo que hace falta —y
#     saltarselas seria dejar de comprobar la unica mitad que a ellos les toca—.
#
# Por eso aqui se comprueban las dos direcciones: las generadas, todas distintas; los
# espejos, iguales a su origen. Un espejo que se hubiera regenerado por su cuenta pasaria
# la primera comprobacion —su valor seria nuevo y unico— y dejaria a su sistema sin poder
# abrir una sesion, con un «password authentication failed» que se lee como clave mal
# generada y es un modelo mal entendido.
#
# `completar-secreto.ts` ya hace lo primero estructuralmente imposible al GENERAR (lanza si
# el generador repite un valor, con su prueba unitaria) y `bootstrap-secretos.sh` hace lo
# segundo al COPIAR. Este guion es la otra mitad: comprueba el resultado real en un cluster,
# no solo la logica que lo produjo.
#
# ## El namespace sale del inventario, no de la linea de ordenes
#
# Hasta el corte esto recibia UN `--namespace` por ambiente. Los secretos viven hoy en
# CINCO espacios de nombres —el de la plataforma y uno por sistema— y cual es cual lo dice
# cada entrada. Un valor tecleado solo podria acertar con uno de los cinco, que es
# exactamente el motivo por el que C-17 se lo quito a `bootstrap-secretos.sh`.
#
#   uso: secretos/verificar-claves-distintas.sh --ambiente stg [--ambiente prod ...]
set -euo pipefail

AMBIENTES=()
while [ $# -gt 0 ]; do
    case "$1" in
        --ambiente) AMBIENTES+=("${2:?falta el valor de --ambiente}"); shift 2 ;;
        *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
    esac
done
[ "${#AMBIENTES[@]}" -gt 0 ] || { echo "Falta al menos un --ambiente." >&2; exit 2; }

AQUI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
INFRA=$(cd "$AQUI/.." && pwd)
cd "$INFRA"

TRABAJO=$(mktemp -d)
trap 'rm -rf "$TRABAJO"' EXIT
GENERADAS="$TRABAJO/generadas.tsv"   # namespace, secreto, clave, valor
ESPEJOS="$TRABAJO/espejos.tsv"       # namespace, secreto, clave, valor, secretoOrigen, claveOrigen
: > "$GENERADAS"
: > "$ESPEJOS"

# Trae el valor de una entrada del cluster. Nunca se imprime: solo se compara, y lo que
# sale por pantalla son huellas o nombres.
valorDe() {
    kubectl -n "$1" get secret "$2" -o jsonpath="{.data.$3}" | base64 --decode
}

for ambiente in "${AMBIENTES[@]}"; do
    # Cada entrada trae SU namespace y, si es espejo, de que entrada se copia.
    while IFS=$'\t' read -r namespace secreto clave origenSecreto origenClave; do
        [ -n "$secreto" ] || continue
        valor=$(valorDe "$namespace" "$secreto" "$clave")
        [ -n "$valor" ] || {
            echo "FALLO: «${secreto}/${clave}» en «${namespace}» esta vacio o no existe." >&2
            exit 1
        }
        if [ -n "$origenSecreto" ]; then
            printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
                "$namespace" "$secreto" "$clave" "$valor" "$origenSecreto" "$origenClave" \
                >> "$ESPEJOS"
        else
            printf '%s\t%s\t%s\t%s\n' "$namespace" "$secreto" "$clave" "$valor" >> "$GENERADAS"
        fi
    done < <(yarn --silent secretos --ambiente "$ambiente" | node -e '
      const datos = JSON.parse(require("fs").readFileSync(0, "utf8"));
      for (const e of datos) {
        process.stdout.write(
          [e.namespace, e.secreto, e.clave, e.espejoDe?.secreto ?? "", e.espejoDe?.clave ?? ""]
            .join("\t") + "\n",
        );
      }
    ')
done

# ── Que esto no se pueda quedar sin nada que comprobar ───────────────────────
#
# Las dos clases se DERIVAN del inventario, asi que un cambio que dejara una vacia —un
# `espejoDe` que dejara de emitirse, un filtro que dejara de casar— convertiria su mitad en
# una comprobacion que no puede fallar. Aqui se exige que las dos tengan filas, que es lo
# unico que distingue «cumplen» de «no habia ninguna».
generadas=$(wc -l < "$GENERADAS" | tr -d ' ')
espejos=$(wc -l < "$ESPEJOS" | tr -d ' ')
[ "$generadas" -gt 0 ] || {
    echo "FALLO: el inventario no trajo ni una entrada que se genere." >&2
    echo "Sin ellas la comprobacion de «todas distintas» no puede fallar." >&2
    exit 1
}
[ "$espejos" -gt 0 ] || {
    echo 'FALLO: el inventario no trajo ni un espejo (espejoDe).' >&2
    echo "Los cuatro sistemas se conectan con roles del cluster y sus claves son copia de" >&2
    echo "las de la plataforma: si no hay ninguna marcada, o el inventario dejo de decirlo" >&2
    echo "o esta comprobacion dejo de leerlo. En los dos casos aqui no se verifica nada." >&2
    exit 1
}

# ── 1. Las que se generan: todas distintas ───────────────────────────────────
#
# Los valores nunca se imprimen: se comparan por huella (sha256 corto), la misma que usa
# completar-secreto.ts para no revelar nada en un registro.
duplicados=$(awk -F'\t' '{print $4}' "$GENERADAS" | sort | uniq -d)
if [ -n "$duplicados" ]; then
    echo "FALLO: al menos dos entradas del inventario tienen EL MISMO valor." >&2
    echo "Es exactamente lo que este guion existe para impedir: dos roles con la" >&2
    echo "misma clave anulan la separacion de privilegios entera. Las que coinciden:" >&2
    awk -F'\t' 'NR==FNR{dup[$0]=1;next} ($4 in dup){print "  · "$1"/"$2"/"$3}' \
        <(echo "$duplicados") "$GENERADAS" >&2
    exit 1
fi

# ── 2. Los espejos: iguales a su origen ──────────────────────────────────────
#
# El origen es una entrada generada del MISMO ambiente, ya leida arriba: se busca por
# (secreto, clave) sin volver a preguntarle al cluster, de modo que lo que se compara es el
# valor que este guion vio, no dos lecturas que podrian caer a los dos lados de un
# `bootstrap`.
descuadrados=0
while IFS=$'\t' read -r namespace secreto clave valor origenSecreto origenClave; do
    [ -n "$secreto" ] || continue
    valorOrigen=$(awk -F'\t' -v s="$origenSecreto" -v c="$origenClave" \
        '$2==s && $3==c {print $4; exit}' "$GENERADAS")
    if [ -z "$valorOrigen" ]; then
        echo "FALLO: «${secreto}/${clave}» dice ser copia de «${origenSecreto}/${origenClave}»," >&2
        echo "y esa entrada no esta en el inventario de este ambiente." >&2
        descuadrados=$((descuadrados + 1))
        continue
    fi
    if [ "$valor" != "$valorOrigen" ]; then
        echo "FALLO: «${namespace}/${secreto}/${clave}» NO coincide con su origen" >&2
        echo "«${origenSecreto}/${origenClave}». Es la clave de un rol del cluster, y" >&2
        echo "PostgreSQL le da a un rol UNA contrasena: con dos valores distintos, uno de" >&2
        echo "los consumidores se queda sin poder abrir sesion. Vuelve a correr" >&2
        echo "bootstrap-secretos.sh, que es quien copia los espejos (C-17 punto 4)." >&2
        descuadrados=$((descuadrados + 1))
    fi
done < "$ESPEJOS"
[ "$descuadrados" -eq 0 ] || exit 1

echo "Comprobadas $generadas claves generadas (todas distintas) y $espejos espejos" \
     "(todos iguales a su origen) entre ${#AMBIENTES[@]} ambiente(s)."
