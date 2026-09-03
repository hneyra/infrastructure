#!/usr/bin/env bash
# El veredicto de `capacidad.ts`, contrastado con el planificador de Kubernetes.
#
# `capacidad.ts` afirma algo sobre Kubernetes: que si la suma de las peticiones cabe en
# lo asignable, el planificador ubica los pods; y que si no cabe, los deja `Pending`.
# Una aritmetica que se equivoque **hacia arriba** —decir «cabe» cuando no— devuelve
# exactamente el fallo que ese modulo existe para impedir (issue #252: `pulumi up`
# esperando pods que nunca se ubicaran), y lo devuelve en silencio, porque la guarda
# estaria en verde. Por eso esto no se razona: se ejecuta.
#
# Dos casos, sobre un clúster desechable de `kind`:
#
#   A. Con lo asignable REAL del nodo, `capacidad.ts` dice «cabe» → el planificador
#      tiene que ubicar TODOS los pods del stack. Es la direccion peligrosa, la que
#      reintroduciria el colgado, y por eso es la que se comprueba con el stack entero.
#   B. Un pod que pide mas CPU de la que el nodo tiene se queda `Pending` con
#      «Insufficient cpu». Es el mecanismo que el caso A da por supuesto: sin
#      comprobarlo, el caso A podria estar pasando por cualquier otro motivo.
#
# Los pods no llegan a arrancar —no hay Secrets, ni imagenes que descargar— y da igual:
# lo que se comprueba es que el planificador les ASIGNA nodo, que es lo unico que
# `capacidad.ts` predice. Que despues arranquen es otra afirmacion, y vive en `motor`.
#
#   uso:  ./verificar-contra-el-planificador.sh
set -euo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA="${AQUI}/../.."
AMBIENTE="${AMBIENTE:-prod}"
NAMESPACE="sgtm-${AMBIENTE}"

command -v kubectl >/dev/null 2>&1 || { echo "Falta kubectl." >&2; exit 1; }

echo "── Lo que el nodo de kind reparte"
CPU="$(kubectl get nodes -o jsonpath='{.items[0].status.allocatable.cpu}')"
MEM="$(kubectl get nodes -o jsonpath='{.items[0].status.allocatable.memory}')"
echo "   ${CPU} CPU / ${MEM} asignables"

# Y lo que YA esta pedido en el, que es lo que hay que descontar antes de preguntar.
#
# El nodo de kind no llega vacio: trae su propio plano de control —etcd, apiserver,
# controller-manager, scheduler, los dos coredns, kindnet— y esos pods PIDEN CPU.
# Preguntarle a `capacidad.ts` por lo asignable a secas es preguntarle por un nodo
# que no existe, y cuando el stack no cabia el guion acusaba al modulo de ser
# optimista siendo el propio guion quien media mal. La aritmetica de `capacidad.ts`
# es la misma que usa el planificador; lo que faltaba era darle el nodo de verdad.
PEDIDO_M="$(kubectl get pods --all-namespaces \
    --field-selector "spec.nodeName=$(kubectl get nodes -o jsonpath='{.items[0].metadata.name}'),status.phase!=Succeeded,status.phase!=Failed" \
    -o json | node -e '
        const pods = JSON.parse(require("fs").readFileSync(0, "utf8")).items ?? [];
        const enMili = (v) => (v ? (String(v).endsWith("m") ? parseInt(v) : Math.round(parseFloat(v) * 1000)) : 0);
        let total = 0;
        for (const p of pods) {
            for (const c of [...(p.spec.initContainers ?? []), ...(p.spec.containers ?? [])]) {
                total += enMili(c.resources?.requests?.cpu);
            }
        }
        process.stdout.write(String(total));
      ')"
LIBRE_M="$(node -e '
    const [cpu, pedido] = process.argv.slice(1);
    const enMili = (v) => (String(v).endsWith("m") ? parseInt(v) : Math.round(parseFloat(v) * 1000));
    process.stdout.write(String(Math.max(enMili(cpu) - Number(pedido), 0)));
  ' "$CPU" "$PEDIDO_M")"
echo "   ya pedido por el plano de control: ${PEDIDO_M}m · libre para el stack: ${LIBRE_M}m"

echo
echo "── Caso A: el veredicto de capacidad.ts contra lo que queda LIBRE en ese nodo"
VEREDICTO="$(cd "$INFRA" && yarn --silent capacidad --ambiente "$AMBIENTE" --cpu "${LIBRE_M}m" --memoria "$MEM")"
echo "   veredicto: ${VEREDICTO}"

if [ "$VEREDICTO" != "cabe" ]; then
    echo "::error::El nodo de kind reparte ${CPU} CPU y su plano de control ya pide ${PEDIDO_M}m," \
         "asi que a «${AMBIENTE}» le quedan ${LIBRE_M}m y no le bastan. El caso A —la direccion" \
         "peligrosa, decir «cabe» cuando no— NO se ha comprobado. Hace falta un runner con mas" \
         "CPU. No se da por bueno en silencio."
    exit 1
fi

echo
echo "── Aplicando el stack de «${AMBIENTE}» (sin los recursos de Traefik: sus CRD no estan en kind)"
(cd "$INFRA" && yarn --silent manifiestos --ambiente "$AMBIENTE") \
    | node -e '
        const entrada = JSON.parse(require("fs").readFileSync(0, "utf8"));
        const deTraefik = ["IngressRoute", "Middleware", "TLSOption", "HelmChartConfig"];
        entrada.items = entrada.items.filter((i) => !deTraefik.includes(i.kind));
        process.stdout.write(JSON.stringify(entrada));
      ' \
    | kubectl apply --filename - >/dev/null

# Los pods que el planificador RECHAZA POR RECURSOS, que es lo unico que `capacidad.ts`
# predice.
#
# La senal es la condicion `PodScheduled=False` con «Insufficient» en su mensaje, no
# `Pending` a secas ni la ausencia de `spec.nodeName`. La diferencia no es sutil y esta
# medida: en la primera corrida de este guion, `postgres`, `prometheus` y `grafana`
# aparecian sin ubicar seis segundos despues del `apply` —los tres tienen volumen con
# `WaitForFirstConsumer`, asi que esperaban a que se aprovisionara, no a que hubiera
# CPU—. Contarlos como "no caben" daba un rojo por un motivo que no es el que se mide.
sin_recursos() {
    kubectl get pods -n "$NAMESPACE" -o jsonpath='{range .items[*]}{.metadata.name}{" -> "}{range .status.conditions[?(@.type=="PodScheduled")]}{.message}{end}{"\n"}{end}' \
        2>/dev/null | grep -i "insufficient" || true
}

# Y los que todavia no tienen nodo asignado, para saber cuando dejar de esperar.
sin_ubicar() {
    local total ubicados
    total="$(kubectl get pods -n "$NAMESPACE" --no-headers 2>/dev/null | grep -c . || true)"
    ubicados="$(kubectl get pods -n "$NAMESPACE" \
        -o jsonpath='{range .items[*]}{.spec.nodeName}{"\n"}{end}' 2>/dev/null | grep -c . || true)"
    echo "$(( total - ubicados ))"
}

echo "   esperando al planificador (hasta 2 min)..."
FALTAN=""
for _ in $(seq 1 24); do
    FALTAN="$(sin_recursos)"
    # Un rechazo por recursos es definitivo: no hay que seguir esperando.
    [ -n "$FALTAN" ] && break
    [ "$(sin_ubicar)" = "0" ] && break
    sleep 5
done

echo
echo "── ¿Ubico el planificador todos los pods?"
kubectl get pods -n "$NAMESPACE" -o wide 2>/dev/null || true
echo "   sin ubicar todavia: $(sin_ubicar) (volumen o imagen; no es lo que se mide)"

if [ -n "$FALTAN" ]; then
    echo
    echo "::error::capacidad.ts dijo «cabe» y el planificador rechazo pods POR RECURSOS." \
         "La aritmetica del modulo es OPTIMISTA, que es justo la direccion en que el error" \
         "reintroduce el colgado del issue #252."
    echo "$FALTAN"
    exit 1
fi
echo "   Correcto: ninguno rechazado por recursos, como capacidad.ts predijo."

echo
echo "── Caso B: y un pod que NO cabe se queda Pending (el mecanismo que A da por supuesto)"
# Todo en milicores, que es la unica unidad en que la suma es trivial. Un core entero
# por encima de lo asignable: sobra para que no quepa ni con el nodo entero vacio.
case "$CPU" in
    *m) CPU_MILI="${CPU%m}" ;;
    *)  CPU_MILI=$(( CPU * 1000 )) ;;
esac
PIDE="$(( CPU_MILI + 1000 ))m"

kubectl apply --filename - >/dev/null <<POD
apiVersion: v1
kind: Pod
metadata:
  name: no-cabe-a-proposito
  namespace: ${NAMESPACE}
spec:
  containers:
    - name: imposible
      image: registry.k8s.io/pause:3.9
      resources:
        requests: { cpu: "${PIDE}", memory: "64Mi" }
        limits: { cpu: "${PIDE}", memory: "128Mi" }
POD

# El MISMO detector del caso A. Es lo que hace que el caso A valga: si `sin_recursos`
# no supiera ver un rechazo por CPU, aqui saldria vacio y este caso se pondria rojo.
MOTIVO=""
for _ in $(seq 1 12); do
    MOTIVO="$(sin_recursos | grep "no-cabe-a-proposito" || true)"
    [ -n "$MOTIVO" ] && break
    sleep 5
done

echo "   ${MOTIVO:-<el detector no vio nada>}"

if [ -z "$MOTIVO" ]; then
    echo "::error::Un pod que pide ${PIDE} sobre un nodo de ${CPU} tenia que quedar sin" \
         "programar por «Insufficient cpu», y el detector no lo vio. Sin eso, el caso A no" \
         "demuestra nada: estaria pasando porque el detector no encuentra nunca nada."
    kubectl describe pod no-cabe-a-proposito -n "$NAMESPACE" 2>/dev/null | tail -20 || true
    exit 1
fi

kubectl delete pod no-cabe-a-proposito -n "$NAMESPACE" --wait=false >/dev/null 2>&1 || true
echo "   Correcto: Pending por «Insufficient cpu». El mecanismo es el que se modela."

echo
echo "Los dos casos pasan: capacidad.ts predice lo que el planificador hace."
