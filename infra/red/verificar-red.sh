#!/usr/bin/env bash
# Denegacion por omision, demostrado contra un CNI que de verdad la aplica (issue #157).
#
# Ningun otro `kind` de `infra/` sirve para esto: todos usan kindnet, el CNI por
# omision de `kind`, que NO aplica `NetworkPolicy` -aceptar el YAML y no hacer nada
# con el es indistinguible de aplicarlo correctamente, hasta que se prueba contra un
# CNI que si lo hace-. Este guion espera un clúster levantado SIN CNI
# (`kind-sin-cni.yaml`) y instala Calico, y comprueba los dos criterios de
# aceptacion del issue mas la demostracion que el propio issue pide:
#
#   1. Desde un pod con las etiquetas de la interfaz, no se puede abrir conexion a
#      PostgreSQL.
#   2. Desde un pod con las etiquetas de la aplicacion, no se puede alcanzar un
#      destino de internet que no este en la lista blanca.
#   3. Quitando TODAS las politicas de red del namespace, la MISMA conexion pasa a
#      CONECTAR -la prueba de que hacian algo, no que estaban mal etiquetadas y
#      sencillamente no seleccionaban ningun pod (issue #157, "como se demuestra
#      que puede fallar"). Ninguna combinacion parcial basta: `denegar-todo` y
#      `permitir-dns` usan `podSelector: {}` -seleccionan CADA pod del namespace,
#      para Ingress y Egress-, asi que la interfaz y postgres SIEMPRE quedan
#      seleccionados por al menos una politica, sin importar cuales otras se
#      quiten -confirmado en CI dos veces: ni quitar solo `denegar-todo`, ni
#      quitar solo las dos politicas especificas de este flujo, desbloqueaba
#      nada-. Quitar el namespace ENTERO de politicas es la unica demostracion
#      sin ambiguedad.
#
# La interfaz y la aplicacion no tienen imagen publicable desde este repositorio
# (issue #156 ya documento el mismo limite para sus tableros): las pruebas 1 y 2 no
# corren contra el Deployment real, sino contra un pod sintetico con la MISMA
# etiqueta `app` que `Red.ts` selecciona -lo que se prueba es la politica, no la
# aplicacion-. PostgreSQL si tiene imagen publica, y corre de verdad.
#
#   uso: red/verificar-red.sh
#
# Necesita un clúster de Kubernetes de verdad, SIN CNI, con `kubectl` apuntando a
# el (`kind create cluster --config red/kind-sin-cni.yaml` en CI). No lo crea.
set -euo pipefail

AQUI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
INFRA=$(cd "$AQUI/.." && pwd)
NS=kamayuk-stg
CALICO_VERSION=v3.28.2

cd "$INFRA"

command -v kubectl >/dev/null 2>&1 || { echo "FALLO: falta kubectl." >&2; exit 1; }

echo "· Instalando Calico -el clúster se creo sin CNI a proposito-"
kubectl apply -f "https://raw.githubusercontent.com/projectcalico/calico/${CALICO_VERSION}/manifests/calico.yaml" >/dev/null

echo "· Esperando a que Calico este listo -sin CNI, ni CoreDNS pasa de Pending-"
if ! kubectl -n kube-system rollout status daemonset/calico-node --timeout=180s; then
    echo "::group::Diagnostico: Calico"
    kubectl -n kube-system get pods -o wide
    kubectl -n kube-system describe daemonset/calico-node
    kubectl -n kube-system logs daemonset/calico-node --tail=200 || true
    kubectl get events -A --sort-by=.lastTimestamp
    echo "::endgroup::"
    exit 1
fi
kubectl -n kube-system rollout status deployment/calico-kube-controllers --timeout=120s
kubectl -n kube-system rollout status deployment/coredns --timeout=120s

echo "· Aplicando el manifiesto de stg -namespace, PriorityClass y las politicas de Red.ts-"
yarn --silent manifiestos --ambiente stg \
    | node -e '
        const entrada = JSON.parse(require("fs").readFileSync(0, "utf8"));
        const deTraefik = ["IngressRoute", "Middleware", "TLSOption", "HelmChartConfig"];
        entrada.items = entrada.items.filter((i) => !deTraefik.includes(i.kind));
        process.stdout.write(JSON.stringify(entrada));
      ' \
    | kubectl apply -f - >/dev/null

echo "· Generando los secretos que faltan (issue #154)"
./secretos/bootstrap-secretos.sh --ambiente stg >/dev/null

# La misma unica excepcion de ADR-0011 §3 que `observabilidad/verificar-alertas.sh`
# ya documenta: el Secret de respaldo lo materializa `pulumi up`, no
# `bootstrap-secretos.sh`, y este guion tampoco llama a Pulumi.
kubectl -n "$NS" create secret generic kamayuk-stg-postgres-respaldo-credenciales \
    --from-literal=access-key-id=verificacion \
    --from-literal=secret-access-key=verificacion \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null

echo "· Esperando a que PostgreSQL este listo"
if ! kubectl -n "$NS" rollout status deployment/kamayuk-stg-postgres --timeout=300s; then
    echo "::group::Diagnostico: kamayuk-stg-postgres"
    kubectl -n "$NS" get pods -o wide
    kubectl -n "$NS" describe deployment/kamayuk-stg-postgres
    kubectl -n "$NS" describe pods -l app=kamayuk-stg-postgres
    kubectl -n "$NS" logs deployment/kamayuk-stg-postgres --all-containers --prefix --tail=200 || true
    kubectl -n "$NS" get events --sort-by=.lastTimestamp
    echo "::endgroup::"
    exit 1
fi

# Pods sinteticos con la MISMA etiqueta `app` que `Red.ts` selecciona -ver el
# docstring de arriba-. `nc`, el de BusyBox que la imagen `alpine` ya trae -sin
# instalar nada-: instalar un paquete exigiria salida a internet, y es
# exactamente lo que `permitir-salida-aplicacion`/la ausencia de una politica de
# salida para la interfaz NO conceden -confirmado por error: la primera version
# de este guion intentaba `apk add netcat-openbsd` y se quedaba colgada contra
# el repositorio de Alpine, bloqueada por la misma politica que este guion
# existe para probar-.
echo "· Desplegando los pods sinteticos -interfaz, aplicacion, y un testigo sin politica-"
cat <<YAML | kubectl apply -n "$NS" -f - >/dev/null
apiVersion: v1
kind: Pod
metadata:
  name: sintetico-interfaz
  labels: { app: kamayuk-stg-interfaz }
spec:
  restartPolicy: Never
  containers:
    - { name: sintetico, image: alpine:3.20, command: ["sleep", "infinity"] }
---
apiVersion: v1
kind: Pod
metadata:
  name: sintetico-aplicacion
  labels: { app: kamayuk-stg-aplicacion }
spec:
  restartPolicy: Never
  containers:
    - { name: sintetico, image: alpine:3.20, command: ["sleep", "infinity"] }
YAML
# El testigo va en "default": SIN NetworkPolicy ninguna -"denegar-todo" solo
# selecciona el namespace kamayuk-stg-, para demostrar que un fallo de conexion en
# los dos pods de arriba es la politica actuando, y no que este runner de CI no
# tiene salida a internet o Calico no arranco bien.
kubectl apply -n default -f - >/dev/null <<YAML
apiVersion: v1
kind: Pod
metadata:
  name: testigo-sin-politica
spec:
  restartPolicy: Never
  containers:
    - { name: testigo, image: alpine:3.20, command: ["sleep", "infinity"] }
YAML

for pod in sintetico-interfaz sintetico-aplicacion; do
    kubectl -n "$NS" wait --for=condition=Ready "pod/$pod" --timeout=60s
done
kubectl -n default wait --for=condition=Ready pod/testigo-sin-politica --timeout=60s

# $1: namespace  $2: pod  $3: host  $4: puerto
puede_conectar() {
    kubectl -n "$1" exec "$2" -- nc -z -w 3 "$3" "$4" >/dev/null 2>&1
}

echo
echo "· Control: sin ninguna politica, la conexion de verdad funciona"
if ! puede_conectar default testigo-sin-politica 1.1.1.1 443; then
    echo "FALLO: el testigo SIN NetworkPolicy no pudo conectar a 1.1.1.1:443. Esto no es" >&2
    echo "Red.ts fallando -el testigo no tiene ninguna politica aplicada-: es que este runner" >&2
    echo "de CI no tiene salida a internet, o Calico no dejo pasar nada. Sin este control," >&2
    echo "un FALLO mas abajo probaria lo mismo por la razon equivocada." >&2
    exit 1
fi
echo "  El testigo SIN politica conecta: el entorno de la prueba funciona."

echo
echo "· 1/2 — Desde la interfaz, PostgreSQL"
if puede_conectar "$NS" sintetico-interfaz "kamayuk-stg-postgres" 5432; then
    echo "FALLO: la interfaz CONECTO a PostgreSQL. permitir-ingreso-postgres deberia" >&2
    echo "seleccionar solo aplicacion/identidad/lote/respaldo, nunca la interfaz." >&2
    exit 1
fi
echo "  Bloqueado: correcto -la interfaz no tiene ninguna razon para hablar con el motor-."

echo
echo "· 2/2 — Desde la aplicacion, un destino de internet fuera de la lista"
if puede_conectar "$NS" sintetico-aplicacion 1.1.1.1 443; then
    echo "FALLO: la aplicacion CONECTO a un destino de internet. permitir-salida-aplicacion" >&2
    echo "deberia limitarse a postgres e identidad -ver el docstring de Red.ts-." >&2
    exit 1
fi
echo "  Bloqueado: correcto -la aplicacion no tiene ninguna dependencia externa hoy-."

echo
echo "· La demostracion que el issue pide: sin las politicas, la MISMA conexion CONECTA"
# TODAS, no una ni dos: `denegar-todo` y `permitir-dns` tienen `podSelector: {}`
# -seleccionan CADA pod del namespace, para Ingress y Egress- asi que quitar
# cualquier subconjunto de politicas deja SIEMPRE a la interfaz y a postgres
# seleccionados por al menos una de esas dos, y por tanto restringidos igual.
# Confirmado en CI dos veces: quitar `denegar-todo` sola no bastaba -las politicas
# especificas de interfaz/postgres seguian restringiendolos-, y quitar esas dos
# tampoco -`denegar-todo` y `permitir-dns` seguian restringiendolos-. La unica
# demostracion sin ambiguedad es la que el propio issue describe: sin NINGUNA
# politica de red en el namespace, la conexion conecta.
kubectl -n "$NS" delete networkpolicy --all >/dev/null
if ! puede_conectar "$NS" sintetico-interfaz "kamayuk-stg-postgres" 5432; then
    echo "FALLO: sin NINGUNA NetworkPolicy en el namespace, la interfaz SIGUE sin" >&2
    echo "poder conectar. Eso ya no es una politica mal etiquetada: es Calico, kind, o" >&2
    echo "el propio guion de comprobacion los que estan fallando, no Red.ts." >&2
    exit 1
fi
echo "  Conecta: las politicas de arriba SI estaban haciendo algo, no eran decorativas."

echo
echo "Denegacion por omision, verificada contra Calico: lo que Red.ts declara es lo que"
echo "el CNI aplica, en los dos sentidos -bloquea cuando la politica no lo permite, dejar"
echo "pasar cuando si-."
