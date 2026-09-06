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
#   uso:  ./diagnostico-del-namespace.sh sgtm-prod
set -euo pipefail

NAMESPACE="${1:?uso: $0 <namespace>}"

if ! kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
    echo "El namespace «${NAMESPACE}» no existe: el fallo es anterior a crear nada."
    exit 0
fi

echo "::group::Pods de ${NAMESPACE}"
kubectl get pods -n "$NAMESPACE" -o wide || true
echo "::endgroup::"

echo "::group::Deployments, Jobs y volumenes"
kubectl get deploy,job,pvc -n "$NAMESPACE" || true
echo "::endgroup::"

# Lo ultimo primero seria mas comodo de leer, pero `--sort-by` no admite orden
# inverso: se ordena ascendente y se toman las ultimas, que es lo mismo.
echo "::group::Ultimos 60 eventos (aqui esta el «Insufficient cpu», si lo hay)"
kubectl get events -n "$NAMESPACE" --sort-by=.lastTimestamp 2>/dev/null | tail -60 || true
echo "::endgroup::"

# Y el detalle de lo que NO esta listo, que es lo unico que hay que leer entero.
# `describe` de un pod `Pending` trae al final el motivo exacto del planificador.
NO_LISTOS="$(kubectl get pods -n "$NAMESPACE" \
    -o jsonpath='{range .items[?(@.status.phase!="Running")]}{.metadata.name}{"\n"}{end}' \
    2>/dev/null || true)"

if [ -z "$NO_LISTOS" ]; then
    echo "Todos los pods estan en Running: el fallo no fue de programacion de pods."
    exit 0
fi

for pod in $NO_LISTOS; do
    echo "::group::describe pod/${pod}"
    kubectl describe pod "$pod" -n "$NAMESPACE" || true
    echo "::endgroup::"
done

# Un resumen de una linea al final: es lo que se lee primero cuando el registro es
# largo, y en el caso que este guion existe para diagnosticar lo dice todo.
echo "Pods no Running en ${NAMESPACE}: $(echo "$NO_LISTOS" | tr '\n' ' ')"
