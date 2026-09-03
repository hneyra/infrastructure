#!/usr/bin/env bash
# Siembra ENTERA de la municipalidad de demostracion: los diez pasos, en el unico orden en
# que se pueden dar.
#
# No hace nada que los nueve guiones no hagan por separado; lo que aporta es el ORDEN, que no
# es documentacion sino dependencia real: cada archivo nombra por codigo algo que otro tuvo
# que escribir antes, y la fila que nombre algo inexistente se rechaza. Ejecutados sueltos y
# en desorden, el resultado no es un error ruidoso: es una carga que dice "0 nuevas, N
# rechazadas" y que alguien puede leer por encima.
#
#   1. catalogo vial       vias.csv            (estructura; ninguna cifra)
#   2. sectores            sectores.csv        (estructura)
#   3. manzanas            manzanas.csv        -> referencia el sector
#   4. cajas y areas       cajas.csv           (estructura; sin ellas no se puede cobrar)
#   5. contribuyentes      contribuyentes.csv  (ficticios; exige es_demostracion)
#   6. fichas y predios    fichas.csv            -> referencia sector, manzana, via y contribuyente
#   7. detalle de fichas   detalle-de-fichas.csv -> VERSIONA la ficha de cada predio
#   8. padron vehicular    vehiculos.csv         -> referencia el contribuyente
#   9. transferencias      transferencias.csv    -> referencia el predio y el vehiculo
#  10. saldo del libro     deuda.csv             -> referencia contribuyente, predio y vehiculo
#
# LOS PASOS 5 A 10 EXIGEN municipalidad.es_demostracion = true. No es una comprobacion del
# guion sino de cada proceso, contra la base: un --municipalidad-id equivocado en un digito
# no siembra nada en el padron de una municipalidad que ya opera, y aqui no se borra nada
# (RNF-051). Los pasos 1 a 4 no la exigen porque un catalogo vial, un sector y una ventanilla
# son estructura real, y ese mismo mecanismo es por el que un dia entrara el catalogo de
# verdad.
#
# EL PASO 4 ES EL QUE #430 ANADIO, y no es un adorno: hasta entonces nada creaba una `caja`
# ni un `area` fuera de las fixtures de prueba, asi que una municipalidad recien sembrada
# tenia padron, predios y deuda y NO PODIA COBRAR -la primera cobranza del dia fallaba con
# CajaInexistente-. Va antes que los contribuyentes porque no depende de nadie; el orden
# entre 1-4 da igual, y el que va detras si importa.
#
# LO QUE ESTA SIEMBRA NO PONE, y no por descuido: ninguna cifra normativa. Ni aranceles, ni
# valores unitarios de edificacion, ni tablas de depreciacion, ni valores referenciales de
# vehiculos, ni tramos del predial. Esos se publican con publicar-parametros.sh y
# publicar-cuadros.sh desde el corpus verificado, y las pantallas que los necesitan tienen
# que seguir diciendo "sin conjunto sellado" mientras D-02a este abierta. Ver README.md.
#
#   uso: sembrar-demostracion.sh --ambiente stg|prod --municipalidad-id N \
#        [--directorio ejemplos] [--namespace sgtm-stg] [--desde N]
#
#   --desde N  empieza en el paso N (1 a 10), para retomar una siembra interrumpida sin
#              volver a correr los pasos que ya entraron. Repetir un paso no duplica: las
#              filas ya cargadas se rechazan una a una por violar su unicidad.
#
# Requiere: kubectl con el tunel al API del ambiente ya abierto (ver infra/README.md).
set -euo pipefail

AQUI=$(cd "$(dirname "$0")" && pwd)

AMBIENTE=""
MUNICIPALIDAD_ID=""
DIRECTORIO="$AQUI/ejemplos"
NAMESPACE=""
DESDE=1
while [ $# -gt 0 ]; do
    case "$1" in
        --ambiente) AMBIENTE=${2:?falta el valor de --ambiente}; shift 2 ;;
        --municipalidad-id) MUNICIPALIDAD_ID=${2:?falta el valor de --municipalidad-id}; shift 2 ;;
        --directorio) DIRECTORIO=${2:?falta el valor de --directorio}; shift 2 ;;
        --namespace) NAMESPACE=${2:?falta el valor de --namespace}; shift 2 ;;
        --desde) DESDE=${2:?falta el valor de --desde}; shift 2 ;;
        *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
    esac
done
[ -n "$AMBIENTE" ] || { echo "Falta --ambiente (stg o prod)." >&2; exit 2; }
[ -n "$MUNICIPALIDAD_ID" ] || { echo "Falta --municipalidad-id." >&2; exit 2; }
[ -d "$DIRECTORIO" ] || { echo "No existe el directorio: $DIRECTORIO" >&2; exit 2; }
case "$DESDE" in ''|*[!0-9]*) echo "--desde va de 1 a 10." >&2; exit 2 ;; esac
[ "$DESDE" -ge 1 ] && [ "$DESDE" -le 10 ] || { echo "--desde va de 1 a 10." >&2; exit 2; }

# Un solo sitio donde esta escrito el orden, y es el que se ejecuta.
PASOS=(
    "cargar-catalogo-vial.sh:vias.csv:catalogo vial"
    "cargar-sectores.sh:sectores.csv:sectores"
    "cargar-manzanas.sh:manzanas.csv:manzanas"
    "cargar-cajas.sh:cajas.csv:cajas y areas"
    "cargar-contribuyentes-demo.sh:contribuyentes.csv:contribuyentes"
    "cargar-fichas-demo.sh:fichas.csv:predios y fichas"
    "cargar-detalle-fichas-demo.sh:detalle-de-fichas.csv:detalle de las fichas"
    "cargar-vehiculos-demo.sh:vehiculos.csv:padron vehicular"
    "cargar-transferencias-demo.sh:transferencias.csv:transferencias"
    "cargar-deuda-demo.sh:deuda.csv:saldo inicial del libro"
)

# Antes de escribir nada: que esten los diez archivos. Descubrir en el paso 9 que falta el
# archivo del 10 deja la siembra a medias, y a medias es justo el estado que peor se lee.
for paso in "${PASOS[@]}"; do
    archivo=${paso#*:}; archivo=${archivo%%:*}
    [ -f "$DIRECTORIO/$archivo" ] || {
        echo "Falta $DIRECTORIO/$archivo" >&2
        exit 2
    }
done

numero=0
for paso in "${PASOS[@]}"; do
    numero=$((numero + 1))
    guion=${paso%%:*}
    resto=${paso#*:}
    archivo=${resto%%:*}
    que=${resto#*:}
    [ "$numero" -ge "$DESDE" ] || { echo "== $numero/10 $que: omitido (--desde $DESDE)"; continue; }

    echo
    echo "== $numero/10 $que  ($guion)"
    argumentos=(--ambiente "$AMBIENTE" --municipalidad-id "$MUNICIPALIDAD_ID" \
                --archivo "$DIRECTORIO/$archivo")
    [ -n "$NAMESPACE" ] && argumentos+=(--namespace "$NAMESPACE")
    "$AQUI/$guion" "${argumentos[@]}"
done

echo
echo "Siembra completa. Ninguna cifra normativa entro por aqui: para eso estan"
echo "publicar-parametros.sh y publicar-cuadros.sh (ver README.md)."
