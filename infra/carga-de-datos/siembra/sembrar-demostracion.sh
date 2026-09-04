#!/usr/bin/env bash
# Siembra ENTERA de la municipalidad de demostracion: los diez pasos, en el unico orden en
# que se pueden dar, REPARTIDOS ENTRE TRES REPOSITORIOS.
#
# ## Que cambio con el corte, y por que esto vive aqui
#
# Antes habia un guion con un array de diez lineas y diez `cargar-*.sh` al lado. Hoy los
# cargadores son de sus sistemas -`catastro` los cinco del territorio y las fichas, `rentas`
# el padron, los vehiculos, las transferencias y la deuda, `caja` las ventanillas- y cada uno
# vive en su repositorio con su CSV. Lo unico que no es de ningun sistema es EL ORDEN, y por
# eso es lo unico que se queda aqui, en `pasos.tsv`. Es el mismo reparto que ADR-0031 hace
# con todo lo demas, y el mismo argumento con que C-2 puso la guarda de extensiones en este
# repositorio: una regla entre sistemas escrita dentro de uno es una regla que su dueno no
# puede comprobar.
#
# ## Lo que este guion aporta sobre correr los diez a mano
#
# Dos cosas, y la segunda es la que existe desde C-6:
#
#   1. EL ORDEN. No es documentacion: cada archivo nombra por codigo algo que otro tuvo que
#      escribir antes, y ahora ademas ese «antes» puede estar en otra base.
#   2. QUE EL SILENCIO SE ACABE. Despues de cada paso corre `comprobar-siembra.sh` para ese
#      paso y SE PARA EN ROJO si la tabla no tiene lo que el CSV dice. Sin eso, un paso
#      sembrado fuera de orden rechaza sus filas una a una, escribe un aviso por cada una y
#      sale con codigo 0 -«51 fila(s) leidas, 0 versionada(s), 22 rechazado(s)»-, y la
#      siembra sigue como si nada hasta el final.
#
# ## Lo que NO entra por aqui
#
# Ninguna cifra normativa: ni aranceles, ni valores unitarios, ni tramos, ni valores
# referenciales de vehiculos. Esas se publican desde el corpus verificado a doble firma de
# `normativa` (`publicar-parametros.sh`, `publicar-cuadros.sh`), o no entran. El importe de
# `deuda.csv` no es una excepcion sino otra cosa: es un SALDO, y entra como dato igual que
# entraria el de la base anterior el dia que se cierre D-04.
#
#   uso: sembrar-demostracion.sh --ambiente stg|prod --municipalidad-id N
#          --url-catastro postgresql://... --url-rentas postgresql://... --url-caja postgresql://...
#          [--namespace sgtm-stg] [--desde N] [--solo-comprobar]
#
#        --desde N        empieza en el paso N. Repetir un paso no duplica ni pone nada en
#                         rojo: la comprobacion mira el TOTAL de la tabla, no lo que el paso
#                         escribio.
#        --solo-comprobar no siembra: solo dice que hay y que falta.
#
# Requiere: los cinco clones hermanos, `psql`, y -para sembrar- `kubectl` con el tunel al
# API del ambiente ya abierto. `--solo-comprobar` no necesita kubectl.
set -uo pipefail

AQUI=$(cd "$(dirname "$0")" && pwd)
MANIFIESTO="$AQUI/pasos.tsv"
CLONES=$(cd "$AQUI/../../../.." && pwd)

AMBIENTE=""
MUNICIPALIDAD_ID=""
NAMESPACE=""
DESDE=1
SOLO_COMPROBAR=0
URLS=()

while [ $# -gt 0 ]; do
    case "$1" in
        --ambiente) AMBIENTE=${2:?falta el valor de --ambiente}; shift 2 ;;
        --municipalidad-id) MUNICIPALIDAD_ID=${2:?falta el valor de --municipalidad-id}; shift 2 ;;
        --namespace) NAMESPACE=${2:?falta el valor de --namespace}; shift 2 ;;
        --desde) DESDE=${2:?falta el valor de --desde}; shift 2 ;;
        --solo-comprobar) SOLO_COMPROBAR=1; shift ;;
        --url-catastro|--url-rentas|--url-caja) URLS+=("$1" "${2:?falta el valor}"); shift 2 ;;
        *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
    esac
done
[ -n "$MUNICIPALIDAD_ID" ] || { echo "Falta --municipalidad-id." >&2; exit 2; }
[ "$SOLO_COMPROBAR" -eq 1 ] || [ -n "$AMBIENTE" ] || { echo "Falta --ambiente (stg o prod)." >&2; exit 2; }
[ -f "$MANIFIESTO" ] || { echo "No existe el manifiesto: $MANIFIESTO" >&2; exit 2; }

if [ "$SOLO_COMPROBAR" -eq 1 ]; then
    exec "$AQUI/comprobar-siembra.sh" --municipalidad-id "$MUNICIPALIDAD_ID" "${URLS[@]}"
fi

# Antes de escribir nada: que esten los diez archivos y los diez guiones, cada uno en su
# repositorio. Descubrir en el paso 9 que falta el archivo del 10 deja la siembra a medias, y
# a medias es justo el estado que peor se lee.
faltan=0
while IFS=$'\t' read -r paso sistema guion proceso archivo comprobacion requiere; do
    case "$paso" in ''|'#'*|paso) continue ;; esac
    raiz="$CLONES/$sistema/infra/carga-de-datos"
    [ -x "$raiz/$guion" ] || { echo "Falta (o no es ejecutable) $raiz/$guion" >&2; faltan=1; }
    [ -f "$raiz/ejemplos/$archivo" ] || { echo "Falta $raiz/ejemplos/$archivo" >&2; faltan=1; }
done < "$MANIFIESTO"
[ "$faltan" -eq 0 ] || {
    echo "No se siembra nada: el manifiesto nombra archivos o guiones que no estan." >&2
    exit 2
}

while IFS=$'\t' read -r paso sistema guion proceso archivo comprobacion requiere; do
    case "$paso" in ''|'#'*|paso) continue ;; esac
    if [ "$paso" -lt "$DESDE" ]; then
        echo "== $paso/10 $sistema/$guion: omitido (--desde $DESDE)"
        continue
    fi

    echo
    echo "== $paso/10  $sistema  $guion  ($archivo)"
    raiz="$CLONES/$sistema/infra/carga-de-datos"
    argumentos=(--ambiente "$AMBIENTE" --municipalidad-id "$MUNICIPALIDAD_ID"
                --archivo "$raiz/ejemplos/$archivo")
    [ -n "$NAMESPACE" ] && argumentos+=(--namespace "$NAMESPACE")
    if ! "$raiz/$guion" "${argumentos[@]}"; then
        echo "El paso $paso fallo. La siembra se para aqui." >&2
        exit 1
    fi

    # Y aqui es donde el silencio se acaba: el paso puede haber salido con codigo 0
    # habiendo rechazado todas sus filas.
    if [ "${#URLS[@]}" -eq 0 ]; then
        echo "  ?  paso $paso sin comprobar: no se dio ninguna --url-<sistema>." >&2
        echo "     Un paso sin comprobar puede haber rechazado TODAS sus filas y salir en verde." >&2
        continue
    fi
    if ! "$AQUI/comprobar-siembra.sh" --municipalidad-id "$MUNICIPALIDAD_ID" --paso "$paso" "${URLS[@]}"; then
        echo "El paso $paso no dejo lo que su archivo dice. La siembra se para aqui." >&2
        exit 1
    fi
done < "$MANIFIESTO"

echo
echo "Comprobacion final de los diez pasos:"
"$AQUI/comprobar-siembra.sh" --municipalidad-id "$MUNICIPALIDAD_ID" "${URLS[@]}" || exit 1
echo
echo "Ninguna cifra normativa entro por aqui: para eso estan publicar-parametros.sh y"
echo "publicar-cuadros.sh, desde el corpus verificado a doble firma de \`normativa\`."
