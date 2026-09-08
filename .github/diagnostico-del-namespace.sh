#!/usr/bin/env bash
# Lo que hacia falta saber y no estaba, las cuatro veces que `aplicar-prod` se colgo
# (issue #252): QUE pod no arranco, y POR QUE.
#
# Cuando `pulumi up` falla o agota su tiempo, lo unico que queda en el registro es la
# traza del CLI, que dice que un `ConfigGroup` no llego a estar listo pero no cual de
# sus objetos falta ni que le pasa. Y para cuando alguien abre un tunel a mano, el
# estado ya cambio. Esto lo captura en el momento, en el mismo trabajo que fallo.
#
# Los `events` son la pieza que de verdad resuelve el caso: un pod `Pending` por falta
# de CPU lo dice ahi con esas palabras —«0/1 nodes are available: Insufficient cpu»—, y
# esa frase es la que habria ahorrado las seis horas de la primera corrida.
#
#   uso:  ./diagnostico-del-namespace.sh kamayuk-prod          un espacio de nombres
#         ./diagnostico-del-namespace.sh --ambiente prod       LOS CINCO del ambiente
#
# ## Por que `--ambiente`, y por que la lista no se escribe (#40)
#
# Este guion nacio cuando habia UN espacio de nombres. Desde ADR-0031 los cuatro sistemas
# viven en el suyo, y `aplicar-stg` seguia invocandolo con `kamayuk-stg` a secas: cuando
# fallaba el `Job` de migracion de `rentas` volcaba los pods de la PLATAFORMA y ni una
# linea de `kamayuk-rentas-stg`. Medido en la corrida 34227961707, que es la que dejo sin
# diagnosticar por que la migracion salia con codigo 1.
#
# Los cinco NO se escriben aqui ni en el YAML: se le PREGUNTAN AL CLUSTER por las etiquetas
# que `commonLabels` les pone —`proyecto=kamayuk,ambiente=<amb>`—. Una lista escrita
# envejece el dia que entre un sistema; un selector de etiquetas no, y ademas describe lo
# que HAY y no lo que deberia haber, que es lo que un diagnostico necesita.
set -euo pipefail

# El selector con que se descubren los espacios de nombres de un ambiente. Son las
# etiquetas que `componentes/convenciones.ts` (`commonLabels`) le pone a cada `Namespace`, y
# una guarda de `yarn verificar` compara ESTA linea con las que los manifiestos emiten de
# verdad: si alguien cambia las etiquetas, este selector dejaria de encontrar nada y el
# diagnostico se volveria mudo sin que nada se pusiera rojo.
SELECTOR_DEL_AMBIENTE="proyecto=kamayuk,ambiente="

diagnosticar_uno() {
    local NAMESPACE="$1"

    if ! kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
        echo "El namespace «${NAMESPACE}» no existe: el fallo es anterior a crear nada."
        return 0
    fi

    echo "::group::Pods de ${NAMESPACE}"
    kubectl get pods -n "$NAMESPACE" -o wide || true
    echo "::endgroup::"

    echo "::group::Deployments, Jobs y volumenes de ${NAMESPACE}"
    kubectl get deploy,job,cronjob,pvc -n "$NAMESPACE" || true
    echo "::endgroup::"

    # Lo ultimo primero seria mas comodo de leer, pero `--sort-by` no admite orden
    # inverso: se ordena ascendente y se toman las ultimas, que es lo mismo.
    echo "::group::Ultimos 60 eventos de ${NAMESPACE} (aqui esta el «Insufficient cpu», si lo hay)"
    kubectl get events -n "$NAMESPACE" --sort-by=.lastTimestamp 2>/dev/null | tail -60 || true
    echo "::endgroup::"

    # Y el detalle de lo que NO esta listo, que es lo unico que hay que leer entero.
    # `describe` de un pod `Pending` trae al final el motivo exacto del planificador.
    local NO_LISTOS
    NO_LISTOS="$(kubectl get pods -n "$NAMESPACE" \
        -o jsonpath='{range .items[?(@.status.phase!="Running")]}{.metadata.name}{"\n"}{end}' \
        2>/dev/null || true)"

    if [ -z "$NO_LISTOS" ]; then
        echo "Todos los pods de ${NAMESPACE} estan en Running."
        return 0
    fi

    for pod in $NO_LISTOS; do
        echo "::group::describe pod/${pod} (${NAMESPACE})"
        kubectl describe pod "$pod" -n "$NAMESPACE" || true
        echo "::endgroup::"

        # Y SUS REGISTROS, que es lo que `describe` no dice (#40). Un pod cuyo contenedor
        # sale con codigo 1 —una migracion que falla, por ejemplo— tiene el motivo AHI y en
        # ningun otro sitio: `describe` dice «Error», el registro dice cual.
        echo "::group::logs pod/${pod} (${NAMESPACE})"
        kubectl logs "$pod" -n "$NAMESPACE" --all-containers --tail=200 --prefix 2>&1 \
            || echo "(sin registros: el contenedor pudo no llegar a arrancar)"
        echo "::endgroup::"
    done

    echo "Pods no Running en ${NAMESPACE}: $(echo "$NO_LISTOS" | tr '\n' ' ')"
}

if [ "${1:-}" = "--ambiente" ]; then
    AMBIENTE="${2:?uso: $0 --ambiente <stg|prod>}"

    # Se le pregunta al cluster, no a una lista. Ver la cabecera.
    ESPACIOS="$(kubectl get namespaces -l "${SELECTOR_DEL_AMBIENTE}${AMBIENTE}" \
        -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true)"

    # Cero no es «esta bien»: es «no se pudo mirar». Sin esto, un selector que dejara de
    # casar —porque alguien renombro una etiqueta— haria que este guion saliera en verde
    # habiendo diagnosticado exactamente nada, que es el fallo que #40 existe para cerrar.
    if [ -z "$ESPACIOS" ]; then
        echo "NINGUN espacio de nombres lleva «${SELECTOR_DEL_AMBIENTE}${AMBIENTE}»."
        echo 'O el ambiente no se ha creado nunca, o las etiquetas de `commonLabels`'
        echo "cambiaron y este diagnostico dejo de encontrarlas. NO es «todo bien»."
        exit 0
    fi

    echo "Espacios de nombres de «${AMBIENTE}»: $(echo "$ESPACIOS" | tr '\n' ' ')"
    for ns in $ESPACIOS; do
        echo "================ ${ns} ================"
        diagnosticar_uno "$ns"
    done
    exit 0
fi

diagnosticar_uno "${1:?uso: $0 <namespace> | --ambiente <stg|prod>}"
