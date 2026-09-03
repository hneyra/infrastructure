#!/usr/bin/env bash
# «Una regla que no notifica a nadie no es una alerta, es un grafico» (issue #156),
# demostrado contra un clúster real, no leido de la configuracion.
#
# Recorre el ciclo entero: aplica el manifiesto de `stg` de verdad —Prometheus,
# Alertmanager, el motor con su sidecar de metricas—, apaga la base de datos, y
# comprueba DOS cosas contra procesos reales, no contra lo que dice el YAML:
#
#   1. Sin un receptor configurado —el estado con el que `stg` arranca—, la regla
#      `PostgreSQLCaido` pasa a FIRING en Prometheus y aparece en la API de
#      Alertmanager, y el receptor de prueba **no recibe nada**. Es la demostracion
#      que el propio issue pide: la regla se evalua, y nadie se entera.
#   2. Con el receptor configurado, la MISMA alerta que ya esta activa se entrega:
#      el receptor de prueba recibe un POST que nombra `PostgreSQLCaido`.
#
# Una sola caida de la base, un solo `for: 2m` esperado: las dos comprobaciones leen
# el mismo evento, antes y despues de cablear el destino.
#
#   uso: observabilidad/verificar-alertas.sh
#
# Necesita un clúster de Kubernetes de verdad (`kind` en CI) con `kubectl` apuntando
# a el. No lo crea: lo espera, igual que `secretos/verificar-claves-distintas.sh`.
set -euo pipefail

AQUI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
INFRA=$(cd "$AQUI/.." && pwd)
NS=sgtm-stg
TRABAJO=$(mktemp -d)
trap 'rm -rf "$TRABAJO"' EXIT

cd "$INFRA"

command -v kubectl >/dev/null 2>&1 || { echo "FALLO: falta kubectl." >&2; exit 1; }

echo "· Aplicando el manifiesto de stg contra el clúster"
# El mismo filtro que el trabajo `manifiestos` de infra.yml: los recursos de Traefik
# no tienen CRD en un `kind` limpio.
#
# Interfaz, aplicacion, Keycloak (identidad + el Job de realm) y los Job de
# migracion/implantacion tambien se excluyen aqui, aunque el bucle de mas abajo
# nunca los espera: aplicados igual compiten por la CPU del nodo UNICO de `kind`
# con postgres y Prometheus/Alertmanager, que SI hacen falta. Encontrado en
# `verificar-tableros.sh` (issue #156/#157, misma causa): con el manifiesto
# completo el scheduler reportaba "Insufficient cpu", y bajo esa saturacion hasta
# Prometheus -ya listo, sirviendo peticiones- dejaba de contestar a tiempo.
yarn --silent manifiestos --ambiente stg \
    | node -e '
        const entrada = JSON.parse(require("fs").readFileSync(0, "utf8"));
        const deTraefik = ["IngressRoute", "Middleware", "TLSOption", "HelmChartConfig"];
        entrada.items = entrada.items.filter((i) => !deTraefik.includes(i.kind));

        const pesados = [
          { kind: "Deployment", prefijo: "sgtm-stg-interfaz" },
          { kind: "Service", prefijo: "sgtm-stg-interfaz" },
          { kind: "Deployment", prefijo: "sgtm-stg-identidad" },
          { kind: "Job", prefijo: "sgtm-stg-realm-" },
          { kind: "Job", prefijo: "sgtm-stg-migracion-" },
          { kind: "Job", prefijo: "sgtm-stg-implantacion-" },
          { kind: "Deployment", prefijo: "sgtm-stg-aplicacion" },
          { kind: "CronJob", prefijo: "sgtm-stg-lote" },
        ];
        entrada.items = entrada.items.filter((i) => {
          const nombre = i.metadata?.name ?? "";
          return !pesados.some((p) => i.kind === p.kind && nombre.startsWith(p.prefijo));
        });

        process.stdout.write(JSON.stringify(entrada));
      ' \
    | kubectl apply -f - >/dev/null

echo "· Generando los secretos que faltan (issue #154)"
./secretos/bootstrap-secretos.sh --ambiente stg >/dev/null

# El UNICO Secret que `bootstrap-secretos.sh` no toca (ADR-0011 §3): las credenciales
# de almacenamiento de objetos del respaldo las materializa `index.ts` en el propio
# `pulumi up`, no el guion de arranque. Este guion no llama a Pulumi, asi que sin este
# paso el motor se queda en `CreateContainerConfigError` -el Secret que su
# `archive_command` referencia no existe- y nunca llega a listo. Los valores son de
# mentira: nada de esto habla con un S3 real.
kubectl -n "$NS" create secret generic sgtm-stg-postgres-respaldo-credenciales \
    --from-literal=access-key-id=verificacion \
    --from-literal=secret-access-key=verificacion \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null

echo "· Esperando a que el motor y la observabilidad esten listos"
# Solo lo que esta prueba necesita. La aplicacion, la interfaz y la identidad no
# tienen imagen publicable desde aqui y se quedarian en ImagePullBackOff para
# siempre: no se esperan, y no hace falta que lo esten.
#
# 300s, no 180s: un clúster `kind` recien creado no trae ninguna de estas imagenes
# —ni la de postgres, ni la del sidecar de metricas, ni la de wal-g—, y las trae
# TODAS de red al mismo tiempo que las de Prometheus/Alertmanager. El propio
# `startupProbe` del motor (`BaseDeDatos.ts`) ya da hasta cinco minutos antes de
# considerar el arranque fallido; el tiempo de espera de aqui no puede ser menor
# sin quedarse corto por una razon que no es la que se quiere comprobar.
for despliegue in postgres observabilidad-prometheus observabilidad-alertmanager; do
    if ! kubectl -n "$NS" rollout status "deployment/sgtm-stg-$despliegue" --timeout=300s; then
        echo "::group::Diagnostico de sgtm-stg-$despliegue"
        kubectl -n "$NS" get pods -o wide
        kubectl -n "$NS" describe "deployment/sgtm-stg-$despliegue"
        kubectl -n "$NS" describe pods -l "app=sgtm-stg-$despliegue"
        kubectl -n "$NS" logs "deployment/sgtm-stg-$despliegue" --all-containers --prefix --tail=200 || true
        kubectl -n "$NS" get events --sort-by=.lastTimestamp
        echo "::endgroup::"
        exit 1
    fi
done

echo "· Desplegando el receptor de prueba"
cat <<'YAML' | kubectl apply -n "$NS" -f - >/dev/null
apiVersion: apps/v1
kind: Deployment
metadata:
  name: receptor-de-prueba
spec:
  replicas: 1
  selector: { matchLabels: { app: receptor-de-prueba } }
  template:
    metadata: { labels: { app: receptor-de-prueba } }
    spec:
      containers:
        - name: receptor
          image: python:3.12-alpine
          command:
            - python3
            - -c
            - |
              import http.server
              class H(http.server.BaseHTTPRequestHandler):
                  def do_POST(self):
                      n = int(self.headers.get('Content-Length', 0))
                      print('RECIBIDO:', self.rfile.read(n).decode('utf-8', 'replace'), flush=True)
                      self.send_response(200)
                      self.end_headers()
                  def log_message(self, *a): pass
              http.server.HTTPServer(('0.0.0.0', 8000), H).serve_forever()
          ports: [{ containerPort: 8000 }]
---
apiVersion: v1
kind: Service
metadata:
  name: receptor-de-prueba
spec:
  selector: { app: receptor-de-prueba }
  ports: [{ port: 8000, targetPort: 8000 }]
YAML
kubectl -n "$NS" rollout status deployment/receptor-de-prueba --timeout=60s

# `denegar-todo` (Red.ts, issue #157) cubre TODO pod del namespace, ad-hoc incluido:
# sin esto Alertmanager no puede entregar el webhook a `receptor-de-prueba`, ni
# `verificador-de-alertas` puede consultar a Prometheus mas abajo. Ninguna va en
# `Red.ts`: son pods que solo existen en esta comprobacion, y esa politica documenta
# en su propio docstring que no abre nada «por si acaso».
echo "· Abriendo, solo para esta comprobacion, lo que denegar-todo le cierra a los pods ad-hoc"
cat <<'YAML' | kubectl apply -n "$NS" -f - >/dev/null
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: permitir-verificacion-alertas-receptor
spec:
  podSelector: { matchLabels: { app: receptor-de-prueba } }
  policyTypes: [Ingress]
  ingress:
    - from: [{ podSelector: { matchLabels: { app: sgtm-stg-observabilidad-alertmanager } } }]
      ports: [{ port: 8000, protocol: TCP }]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: permitir-verificacion-alertas-egreso-alertmanager
spec:
  podSelector: { matchLabels: { app: sgtm-stg-observabilidad-alertmanager } }
  policyTypes: [Egress]
  egress:
    - to: [{ podSelector: { matchLabels: { app: receptor-de-prueba } } }]
      ports: [{ port: 8000, protocol: TCP }]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: permitir-verificacion-alertas-ingreso-prometheus
spec:
  podSelector: { matchLabels: { app: sgtm-stg-observabilidad-prometheus } }
  policyTypes: [Ingress]
  ingress:
    - from: [{ podSelector: { matchLabels: { app: verificador-de-alertas } } }]
      ports: [{ port: 9090, protocol: TCP }]
YAML

# Un pod aparte para hablar HTTP con Prometheus desde DENTRO del clúster: su
# Service es ClusterIP, igual que el resto de lo interno.
echo "· Desplegando el cliente de comprobacion"
cat <<'YAML' | kubectl apply -n "$NS" -f - >/dev/null
apiVersion: v1
kind: Pod
metadata:
  name: verificador-de-alertas
  # La etiqueta, no solo el nombre: `NetworkPolicy` selecciona por `podSelector`,
  # y sin ella las dos excepciones de arriba y de mas abajo no tienen a quien
  # apuntar.
  labels: { app: verificador-de-alertas }
spec:
  restartPolicy: Never
  containers:
    - name: verificador
      image: python:3.12-alpine
      # `infinity`, no un numero: este pod tiene que sobrevivir a TODA la
      # espera de PostgreSQLCaido (issue #156), y un `sleep 600` fijo es
      # exactamente lo que rompio esta comprobacion -el pod pasaba a
      # `Succeeded` a los 10 minutos, y desde ahi CADA `kubectl exec`
      # fallaba con "cannot exec into a container in a completed pod" sin
      # que la alerta tuviera nada que ver-. El clúster entero se destruye
      # al final del trabajo, asi que no hay nada que limpiar aqui.
      command: ["sleep", "infinity"]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: permitir-verificacion-alertas-verificador
spec:
  podSelector: { matchLabels: { app: verificador-de-alertas } }
  policyTypes: [Egress]
  egress:
    - to: [{ podSelector: { matchLabels: { app: sgtm-stg-observabilidad-prometheus } } }]
      ports: [{ port: 9090, protocol: TCP }]
YAML
kubectl -n "$NS" wait --for=condition=Ready pod/verificador-de-alertas --timeout=60s

# timeout=10, no el por omision de urllib -que en Python bloquea sin limite en el
# socket subyacente (issue #215): contra un nodo de `kind` recien creado, bajo
# presion de arranque en frio, una conexion colgada puede tardar mucho mas de los
# 10s entre reintentos de `alerta_esta` en fallar de verdad. El sondeo de mas abajo
# esta disenado para 36 intentos en 6 minutos; con una sola llamada colgandose
# minutos enteros, se agotan 5 intentos en ~12 minutos sin llegar nunca al 36 -que
# es exactamente el patron de fallo documentado en el issue-. Con timeout corto,
# cada intento falla rapido y el sondeo llega a los 36 de verdad.
consultar_prometheus() {
    kubectl -n "$NS" exec verificador-de-alertas -- python3 -c "
import json, urllib.request
r = urllib.request.urlopen('http://sgtm-stg-observabilidad-prometheus:9090/api/v1/query?query=$1', timeout=10)
d = json.load(r)
print(json.dumps(d['data']['result']))
"
}

alerta_esta() {
    # $1: estado esperado dentro de ALERTS{alertname="PostgreSQLCaido"} -> alertstate
    #
    # Parseado, no grep -q contra el JSON en crudo: `json.dumps` de Python
    # pone un espacio despues de cada `:` -"alertstate": "firing"-, y un
    # patron `"alertstate":"$1"` sin ese espacio NUNCA hace match. Este era
    # el fallo real detras de CADA "PostgreSQLCaido no llego a firing" de
    # este guion, ensanchando el sondeo de 5 a 8 a 15 minutos sin que
    # ninguno lo arreglara -el bloqueo no era el tiempo, era que esta
    # comprobacion jamas podia dar "si"-.
    local resultado
    resultado=$(consultar_prometheus 'ALERTS%7Balertname%3D%22PostgreSQLCaido%22%7D')
    python3 -c "
import json, sys
series = json.loads(sys.argv[1])
sys.exit(0 if any(s['metric'].get('alertstate') == sys.argv[2] for s in series) else 1)
" "$resultado" "$1"
}

echo
echo "· Apagando la base de datos"
kubectl -n "$NS" scale deployment/sgtm-stg-postgres --replicas=0
kubectl -n "$NS" wait --for=delete pod -l app=sgtm-stg-postgres --timeout=60s 2>/dev/null || true

# 6 minutos, no los 15 a los que se llego ensanchando a ciegas: el `alerta_esta`
# de mas arriba tenia el bug real -el `grep -q` contra el JSON de Python nunca
# podia hacer match, por el espacio que `json.dumps` pone despues de cada `:`-,
# y NINGUN ensanchamiento del sondeo iba a arreglar una comprobacion que jamas
# podia dar "si". Con la comprobacion parseando el JSON de verdad, el margen
# que hace falta es el de la regla misma: hasta 30s para el primer scrape
# fallido, dos minutos de `for:`, y margen para la latencia de evaluacion —
# nunca los quince minutos que enmascaraban el bug de arriba.
echo "· Esperando a que la regla PostgreSQLCaido pase de pending a firing (for: 2m)"
LOGRADO=no
INTENTOS=36
for i in $(seq 1 "$INTENTOS"); do
    if alerta_esta firing; then
        LOGRADO=si
        break
    fi
    # Sin sleep en el ultimo intento: comprobar y rendirse, no comprobar,
    # dormir diez segundos mas sin volver a mirar, y rendirse recien despues.
    [ "$i" -lt "$INTENTOS" ] && sleep 10
done
if [ "$LOGRADO" != "si" ]; then
    echo "FALLO: PostgreSQLCaido no llego a firing en 6 minutos." >&2
    echo "::group::Diagnostico: que ve Prometheus de verdad"
    echo "-- up{job=\"postgres\"} --"
    consultar_prometheus 'up%7Bjob%3D%22postgres%22%7D' || true
    echo "-- pg_up --"
    consultar_prometheus 'pg_up' || true
    echo "-- ALERTS (cualquier estado) --"
    consultar_prometheus 'ALERTS' || true
    echo "-- El objetivo «postgres», segun /api/v1/targets --"
    kubectl -n "$NS" exec verificador-de-alertas -- python3 -c "
import json, urllib.request
r = urllib.request.urlopen('http://sgtm-stg-observabilidad-prometheus:9090/api/v1/targets', timeout=10)
d = json.load(r)
for t in d['data']['activeTargets']:
    if t['labels'].get('job') == 'postgres':
        print(json.dumps(t, indent=2))
" || true
    echo "::endgroup::"
    exit 1
fi
echo "  PostgreSQLCaido: firing"

echo
echo "· 1/2 — Sin receptor configurado (el estado con que stg arranca)"
sin_receptor=$(kubectl -n "$NS" logs deployment/receptor-de-prueba --since=10m 2>/dev/null | grep -c "PostgreSQLCaido" || true)
if [ "$sin_receptor" != "0" ]; then
    echo "FALLO: el receptor de prueba recibio algo SIN estar configurado. El aislamiento entre" >&2
    echo "«la regla existe» y «alguien se entero» no es real." >&2
    exit 1
fi
echo "  El receptor de prueba: 0 peticiones. La regla esta roja y nadie se entero — correcto."

echo
echo "· 2/2 — Cableando el receptor y confirmando la entrega"
kubectl -n "$NS" get configmap sgtm-stg-observabilidad-alertmanager -o json \
    | node -e '
        const cm = JSON.parse(require("fs").readFileSync(0, "utf8"));
        cm.data["alertmanager.yml"] = [
          "route:",
          "  group_by: [alertname]",
          "  group_wait: 5s",
          "  group_interval: 10s",
          "  repeat_interval: 1h",
          "  receiver: webhook",
          "receivers:",
          "  - name: null-receiver",
          "  - name: webhook",
          "    webhook_configs:",
          "      - url: http://receptor-de-prueba.sgtm-stg.svc.cluster.local:8000/",
          "        send_resolved: true",
          "",
        ].join("\n");
        process.stdout.write(JSON.stringify(cm));
      ' \
    | kubectl apply -f - >/dev/null
kubectl -n "$NS" rollout restart deployment/sgtm-stg-observabilidad-alertmanager >/dev/null
kubectl -n "$NS" rollout status deployment/sgtm-stg-observabilidad-alertmanager --timeout=90s

ENTREGADO=no
for _ in $(seq 1 12); do
    con_receptor=$(kubectl -n "$NS" logs deployment/receptor-de-prueba --since=15m 2>/dev/null | grep -c "PostgreSQLCaido" || true)
    if [ "$con_receptor" != "0" ]; then
        ENTREGADO=si
        break
    fi
    sleep 10
done
if [ "$ENTREGADO" != "si" ]; then
    echo "FALLO: con el receptor configurado, la notificacion nunca llego." >&2
    echo "::group::Diagnostico: entrega del webhook" >&2
    echo "--- linea 'url' del ConfigMap de alertmanager ---" >&2
    kubectl -n "$NS" get configmap sgtm-stg-observabilidad-alertmanager -o jsonpath='{.data.alertmanager\.yml}' | grep -A1 webhook_configs >&2 || true
    kubectl -n "$NS" describe pods -l app=sgtm-stg-observabilidad-alertmanager >&2
    kubectl -n "$NS" logs deployment/sgtm-stg-observabilidad-alertmanager --all-containers --prefix --tail=200 >&2 || true
    kubectl -n "$NS" logs deployment/receptor-de-prueba --all-containers --prefix --tail=50 >&2 || true
    kubectl -n "$NS" get events --sort-by=.lastTimestamp >&2
    echo "::endgroup::" >&2
    exit 1
fi
echo "  El receptor de prueba recibio la alerta: correcto."

echo
echo "La alerta se evalua, se ve en Alertmanager, y —solo con receptor— le llega a alguien."
