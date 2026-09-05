#!/usr/bin/env bash
# «Los tableros muestran datos de verdad, no "No data"» (issue #156), comprobado
# consultando Prometheus con la MISMA expresion que cada panel del tablero — no
# abriendo Grafana y mirando, que no se automatiza.
#
# Extrae `targets[].expr` de `observabilidad/dashboards/resumen-operativo.json` y
# ejecuta cada una contra un Prometheus real. Si alguna devuelve una lista vacia,
# falla nombrando el panel: es la regresion de "No data" que este guion existe para
# atrapar antes que un funcionario mirando el tablero.
#
# Postgres, el nodo y los pods los sirven exportadores reales, desplegados de
# verdad. La aplicacion no —no hay imagen publicable desde aqui—, asi que sus dos
# paneles (JVM, peticiones HTTP) se comprueban contra un exportador SINTETICO que
# sirve exactamente los mismos nombres de metrica que Micrometer publicaria en
# `/actuator/prometheus`. Se dice aqui para que nadie lo lea como "la aplicacion
# real ya se probo".
#
#   uso: observabilidad/verificar-tableros.sh
set -euo pipefail

AQUI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
INFRA=$(cd "$AQUI/.." && pwd)
NS=kamayuk-stg
cd "$INFRA"

command -v kubectl >/dev/null 2>&1 || { echo "FALLO: falta kubectl." >&2; exit 1; }

echo "· Aplicando el manifiesto de stg contra el clúster"
yarn --silent manifiestos --ambiente stg \
    | node -e '
        const entrada = JSON.parse(require("fs").readFileSync(0, "utf8"));
        const deTraefik = ["IngressRoute", "Middleware", "TLSOption", "HelmChartConfig"];
        entrada.items = entrada.items.filter((i) => !deTraefik.includes(i.kind));

        // Interfaz, aplicacion, Keycloak (identidad + el Job de realm) y los Job de
        // migracion/implantacion no le hacen falta a esta comprobacion -los dos
        // paneles de la aplicacion los sirve el exportador sintetico de mas abajo, y
        // ningun panel del tablero lee nada de Keycloak-, y el nodo UNICO de `kind`
        // no tiene CPU para desplegarlos a la vez que postgres y los cinco
        // componentes de observabilidad. Encontrado en CI dos veces seguidas: con el
        // manifiesto completo, el scheduler reportaba "Insufficient cpu" para varios
        // Pods, y bajo esa saturacion hasta Prometheus -que SI llegaba a Ready- dejaba
        // de contestar peticiones HTTP durante minutos. No es que Prometheus se haya
        // roto: es que compartir un runner de 2 vCPU con dos Keycloak reintentando su
        // arranque, dos replicas de interfaz reintentando una imagen que este
        // repositorio no publica, y el resto del padron completo no deja margen para
        // que nada responda a tiempo.
        const pesados = [
          { kind: "Deployment", prefijo: "kamayuk-stg-interfaz" },
          { kind: "Service", prefijo: "kamayuk-stg-interfaz" },
          { kind: "Deployment", prefijo: "kamayuk-stg-identidad" },
          { kind: "Job", prefijo: "kamayuk-stg-realm-" },
          { kind: "Job", prefijo: "kamayuk-stg-migracion-" },
          { kind: "Job", prefijo: "kamayuk-stg-implantacion-" },
          { kind: "Deployment", prefijo: "kamayuk-stg-aplicacion" },
          { kind: "CronJob", prefijo: "kamayuk-stg-lote" },
        ];
        entrada.items = entrada.items.filter((i) => {
          const nombre = i.metadata?.name ?? "";
          return !pesados.some((p) => i.kind === p.kind && nombre.startsWith(p.prefijo));
        });

        // Solo aqui, nunca en Observabilidad.ts: `node_exporter` excluye "overlay" de
        // sus metricas de filesystem por omision, y con motivo -en un VPS real la raiz
        // es ext4/xfs, y lo que aparece como "overlay" ahi es la capa escribible de
        // CADA contenedor, que no es "el disco del nodo"-. Un nodo de `kind` es EL AL
        // REVES: su propia raiz esta montada como overlay -es un contenedor de Docker
        // haciendo de nodo-, asi que con la exclusion de fabrica el panel de disco
        // nunca ve una sola serie aqui. Se desactiva la exclusion SOLO para esta
        // comprobacion.
        const nodeExporter = entrada.items.find(
          (i) => i.kind === "Deployment" && i.metadata.name.includes("node-exporter"),
        );
        const contenedor = nodeExporter?.spec.template.spec.containers.find(
          (c) => c.name === "node-exporter",
        );
        if (!contenedor) throw new Error("No hay Deployment de node-exporter en el manifiesto");
        contenedor.args.push("--collector.filesystem.fs-types-exclude=^$");

        process.stdout.write(JSON.stringify(entrada));
      ' \
    | kubectl apply -f - >/dev/null

echo "· Generando los secretos que faltan"
./secretos/bootstrap-secretos.sh --ambiente stg >/dev/null

# Ver el comentario equivalente en verificar-alertas.sh: el UNICO Secret que
# `bootstrap-secretos.sh` no genera (ADR-0011 §3) es el de las credenciales de
# almacenamiento de objetos, que normalmente materializa `pulumi up`. Sin el, el
# motor se queda en `CreateContainerConfigError` y esta espera nunca termina.
kubectl -n "$NS" create secret generic kamayuk-stg-postgres-respaldo-credenciales \
    --from-literal=access-key-id=verificacion \
    --from-literal=secret-access-key=verificacion \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null

echo "· Esperando a que el motor, node-exporter, kube-state-metrics y Prometheus esten listos"
# 300s, no 180s: ver el comentario equivalente en verificar-alertas.sh — un
# clúster `kind` recien creado descarga TODAS estas imagenes de red a la vez, y
# el propio `startupProbe` del motor ya da hasta cinco minutos.
for despliegue in postgres observabilidad-node-exporter observabilidad-kube-state-metrics observabilidad-prometheus; do
    if ! kubectl -n "$NS" rollout status "deployment/kamayuk-stg-$despliegue" --timeout=300s; then
        echo "::group::Diagnostico de kamayuk-stg-$despliegue"
        kubectl -n "$NS" get pods -o wide
        kubectl -n "$NS" describe "deployment/kamayuk-stg-$despliegue"
        kubectl -n "$NS" describe pods -l "app=kamayuk-stg-$despliegue"
        kubectl -n "$NS" logs "deployment/kamayuk-stg-$despliegue" --all-containers --prefix --tail=200 || true
        kubectl -n "$NS" get events --sort-by=.lastTimestamp
        echo "::endgroup::"
        exit 1
    fi
done

echo "· Desplegando el exportador sintetico de la aplicacion (ver el docstring de este guion)"
cat <<'YAML' | kubectl apply -n "$NS" -f - >/dev/null
apiVersion: apps/v1
kind: Deployment
metadata:
  name: aplicacion-sintetica
spec:
  replicas: 1
  selector: { matchLabels: { app: aplicacion-sintetica } }
  template:
    metadata: { labels: { app: aplicacion-sintetica } }
    spec:
      containers:
        - name: exportador
          image: python:3.12-alpine
          command:
            - python3
            - -c
            - |
              import http.server
              CUERPO = (
                  '# TYPE jvm_memory_used_bytes gauge\n'
                  'jvm_memory_used_bytes{application="kamayuk",area="heap"} 123456789\n'
                  '# TYPE http_server_requests_seconds_count counter\n'
                  'http_server_requests_seconds_count{application="kamayuk",uri="/api/v1/predios"} 42\n'
              )
              class H(http.server.BaseHTTPRequestHandler):
                  def do_GET(self):
                      self.send_response(200)
                      self.send_header('Content-Type', 'text/plain')
                      self.end_headers()
                      self.wfile.write(CUERPO.encode())
                  def log_message(self, *a): pass
              http.server.HTTPServer(('0.0.0.0', 8080), H).serve_forever()
          ports: [{ containerPort: 8080 }]
---
apiVersion: v1
kind: Service
metadata:
  name: aplicacion-sintetica
spec:
  selector: { app: aplicacion-sintetica }
  ports: [{ port: 8080, targetPort: 8080 }]
YAML
kubectl -n "$NS" rollout status deployment/aplicacion-sintetica --timeout=60s

# `denegar-todo` (Red.ts, issue #157) cubre TODO pod del namespace, ad-hoc incluido:
# sin esto Prometheus no puede alcanzar a `aplicacion-sintetica` para scrapearla, ni
# `aplicacion-sintetica`/`verificador-de-tableros` pueden alcanzar a Prometheus para
# el `/-/reload` y las consultas de panel de mas abajo. Ninguna de las dos va en
# `Red.ts`: son pods que solo existen en esta comprobacion, y esa politica documenta
# en su propio docstring que no abre nada «por si acaso».
echo "· Abriendo, solo para esta comprobacion, lo que denegar-todo le cierra a los pods ad-hoc"
cat <<'YAML' | kubectl apply -n "$NS" -f - >/dev/null
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: permitir-verificacion-tableros-aplicacion-sintetica
spec:
  podSelector: { matchLabels: { app: aplicacion-sintetica } }
  policyTypes: [Ingress, Egress]
  ingress:
    - from: [{ podSelector: { matchLabels: { app: kamayuk-stg-observabilidad-prometheus } } }]
      ports: [{ port: 8080, protocol: TCP }]
  egress:
    - to: [{ podSelector: { matchLabels: { app: kamayuk-stg-observabilidad-prometheus } } }]
      ports: [{ port: 9090, protocol: TCP }]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: permitir-verificacion-tableros-prometheus
spec:
  podSelector: { matchLabels: { app: kamayuk-stg-observabilidad-prometheus } }
  policyTypes: [Ingress, Egress]
  ingress:
    - from:
        - podSelector: { matchLabels: { app: aplicacion-sintetica } }
        - podSelector: { matchLabels: { app: verificador-de-tableros } }
      ports: [{ port: 9090, protocol: TCP }]
  # `permitir-salida-prometheus` (Red.ts) solo abre salida hacia la aplicacion
  # REAL: el repunte de mas abajo cambia el objetivo del scrape al exportador
  # sintetico, y esa politica de produccion no sabe nada de el.
  egress:
    - to: [{ podSelector: { matchLabels: { app: aplicacion-sintetica } } }]
      ports: [{ port: 8080, protocol: TCP }]
YAML

# Prometheus escuchaba a `kamayuk-stg-aplicacion` -que no existe en este clúster de
# prueba, nunca contesta y su ausencia no se puede distinguir de un fallo real-. Se
# apunta el job `aplicacion` al exportador sintetico, solo para esta comprobacion.
#
# ## Por que esto ANADE el job cuando no esta, y no solo lo sustituye
#
# Hasta C-19 el job existia siempre y bastaba con un `replace()`. Desde C-19, `stg` no
# despliega el monolito (`kamayuk:desplegarElMonolito: false`) y su `prometheus.yml`
# **no declara ningun `job_name: aplicacion`**: son cinco jobs y ninguno es ese. Contra
# ese manifiesto la sustitucion era un no-op silencioso, y el guion moria 90 s despues
# diciendo «el archivo montado en el Pod nunca reflejo el ConfigMap actualizado» — un
# sintoma que acusa al kubelet de no sincronizar cuando lo que pasa es que no se
# escribio nada. C-19 lo dejo declarado como su hueco 4.
#
# El tablero **no se templa por ambiente**: es un JSON compartido por los dos y
# partirlo seria un segundo sitio donde olvidarse (C-19, hueco 4). Asi que sus dos
# paneles de la aplicacion —JVM y peticiones HTTP— hay que poder comprobarlos aqui, y
# el exportador sintetico ya era el que los servia: este guion filtra el `Deployment`
# de la aplicacion del manifiesto desde siempre (ver arriba), o sea que **nunca** raspo
# la aplicacion real. Anadir el job cuando el ambiente no lo declara no verifica una
# cosa distinta: verifica exactamente la que ya se verificaba, y ademas donde el
# ambiente no lo trae.
#
# Lo que se conserva es el otro sentido: si el ambiente SI declara el job -`prod`, que
# despliega el monolito-, se repunta el suyo en vez de anadir un segundo. Un ambiente
# con dos `job_name: aplicacion` no es configuracion valida de Prometheus.
echo "· Apuntando el scrape de «aplicacion» al exportador sintetico"
kubectl -n "$NS" get configmap kamayuk-stg-observabilidad-prometheus -o json \
    | node -e '
        const cm = JSON.parse(require("fs").readFileSync(0, "utf8"));
        const antes = cm.data["prometheus.yml"];
        const OBJETIVO = "aplicacion-sintetica:8080";

        const jobs = (antes.match(/^  - job_name: aplicacion$/gm) ?? []).length;
        if (jobs > 1) {
          throw new Error(
            "El manifiesto declara " + jobs + " veces `job_name: aplicacion`. Eso no es " +
              "configuracion valida de Prometheus, y aqui no se sabe cual repuntar.",
          );
        }

        let despues;
        if (jobs === 1) {
          // El ambiente lo declara (`prod`): se le cambia el objetivo, sin tocar nada mas.
          despues = antes.replace(
            /(^  - job_name: aplicacion$[\s\S]*?^      - targets: )\[".*?"\]$/m,
            `$1["${OBJETIVO}"]`,
          );
        } else {
          // El ambiente no lo declara (`stg` desde C-19): se anade, con el mismo
          // `metrics_path` que `Observabilidad.ts` le pone al de verdad.
          despues =
            antes.trimEnd() +
            "\n" +
            [
              "  - job_name: aplicacion",
              "    metrics_path: /actuator/prometheus",
              "    static_configs:",
              `      - targets: ["${OBJETIVO}"]`,
              "",
            ].join("\n");
        }

        // Que el repunte no pueda ser un no-op. Es la mitad que faltaba: sin esto, una
        // expresion que deja de casar no falla aqui — falla 90 s mas tarde acusando al
        // kubelet, y el mensaje manda a buscar al sitio equivocado.
        if (despues === antes || !despues.includes(OBJETIVO)) {
          throw new Error(
            "El repunte del scrape no cambio nada: `prometheus.yml` sigue sin apuntar a " +
              OBJETIVO + ". Sin el, los dos paneles de la aplicacion no tienen quien los " +
              "sirva y este guion no puede comprobarlos.",
          );
        }
        cm.data["prometheus.yml"] = despues;
        process.stdout.write(JSON.stringify(cm));
      ' \
    | kubectl apply -f - >/dev/null

# El objeto ConfigMap en el API cambia al instante; el archivo que kubelet monta
# DENTRO del Pod no -kubelet lo sincroniza en su propio ciclo periodico, hasta
# ~60-90s despues, independiente de cuando se aplico el cambio-. Pedir `/-/reload`
# antes de que eso pase relee un archivo que TODAVIA dice `kamayuk-stg-aplicacion`:
# Prometheus contesta 200 igual -recargo algo, solo que lo viejo-, y el resultado
# es identico a que el repunte nunca hubiera pasado. Encontrado en CI: `/api/v1/targets`
# mostraba `scrapeUrl: http://kamayuk-stg-aplicacion:8080/...` pese a que el ConfigMap
# ya tenia `aplicacion-sintetica:8080` -connection refused, no un problema de red-.
echo "· Esperando a que el volumen del ConfigMap se sincronice dentro del Pod"
SINCRONIZADO=no
for intento in $(seq 1 45); do
    if kubectl -n "$NS" exec deployment/kamayuk-stg-observabilidad-prometheus -- \
        grep -q 'aplicacion-sintetica:8080' /etc/prometheus/prometheus.yml 2>/dev/null; then
        SINCRONIZADO=si
        break
    fi
    sleep 2
done
if [ "$SINCRONIZADO" != "si" ]; then
    echo "FALLO: el archivo montado en el Pod nunca reflejo el ConfigMap actualizado" >&2
    echo "en 90s. Sin esto, /-/reload releeria el objetivo de scrape viejo." >&2
    exit 1
fi

# `POST /-/reload`, no `kubectl rollout restart`: releer la configuracion sin
# recrear el Pod. Encontrado en CI, en CUATRO corridas seguidas: justo despues
# de un `rollout restart`, la primera consulta a Prometheus fallaba conectando
# -con Prometheus ya sirviendo peticiones segun su propio log, y el Pod en
# Ready segun el API server-. No era Prometheus: era la recreacion misma, que
# cambia la direccion que el Service enruta. `/-/reload` es el MISMO proceso,
# el MISMO Pod, la MISMA entrada del Service -solo relee su archivo-.
echo "· Recargando la configuracion de Prometheus (POST /-/reload, sin recrear el Pod)"
# Reintenta la CONEXION, no el resultado -el mismo patron que las consultas de panel de
# mas abajo-. Dos ajustes de esta ventana ya se probaron en CI y ninguno basto: 3
# intentos (~36s) y luego 8 (~101s), y en LOS DOS casos cada intento agoto el
# `timeout=10` completo -nunca fallo rapido-, lo que descarta una ventana de
# sincronizacion puntual (la hipotesis de `kube-proxy` que motivo el segundo ajuste):
# una condicion que sigue fallando igual de 36s a 101s no es una carrera que una
# ventana mas ancha vaya a ganar. La correccion ahora no es un tercer numero a
# ciegas: es dejar de silenciar CON `2>/dev/null` el error real de cada intento -asi
# no se sabia si era DNS, TCP o la aplicacion-, y volcar el mismo diagnostico rico que
# ya usa el bucle de paneles mas abajo si los 5 intentos (~32s, generoso si la causa
# resulta ser mas simple que las dos anteriores) siguen sin lograrlo.
LOGRADO=no
for intento in 1 2 3 4 5; do
    if SALIDA=$(kubectl -n "$NS" exec deployment/aplicacion-sintetica -- python3 -c "
import urllib.request
urllib.request.urlopen(
    urllib.request.Request('http://kamayuk-stg-observabilidad-prometheus:9090/-/reload', method='POST'),
    timeout=10,
)
" 2>&1); then
        LOGRADO=si
        break
    fi
    [ "$intento" -lt 5 ] && sleep 3
done
if [ "$LOGRADO" != "si" ]; then
    echo "FALLO: /-/reload no respondio en 5 intentos. Ultimo error:" >&2
    echo "$SALIDA" >&2
    echo >&2
    echo "::group::Diagnostico: aplicacion-sintetica -> kamayuk-stg-observabilidad-prometheus" >&2
    kubectl -n "$NS" get pods -o wide >&2
    kubectl -n "$NS" get endpoints kamayuk-stg-observabilidad-prometheus -o wide >&2
    echo "--- resolucion DNS y conexion TCP desde dentro de aplicacion-sintetica ---" >&2
    kubectl -n "$NS" exec deployment/aplicacion-sintetica -- python3 -c "
import socket
try:
    print('DNS:', socket.gethostbyname('kamayuk-stg-observabilidad-prometheus'))
except Exception as e:
    print('DNS FALLO:', repr(e))
try:
    s = socket.create_connection(('kamayuk-stg-observabilidad-prometheus', 9090), timeout=5)
    print('TCP: conecta')
    s.close()
except Exception as e:
    print('TCP FALLO:', repr(e))
" >&2 || true
    kubectl -n "$NS" describe pods -l app=kamayuk-stg-observabilidad-prometheus >&2
    kubectl -n "$NS" logs deployment/kamayuk-stg-observabilidad-prometheus --all-containers --prefix --tail=200 >&2 || true
    kubectl -n "$NS" get events --sort-by=.lastTimestamp >&2
    echo "::endgroup::" >&2
    exit 1
fi

echo "· Desplegando el cliente de comprobacion"
cat <<'YAML' | kubectl apply -n "$NS" -f - >/dev/null
apiVersion: v1
kind: Pod
metadata:
  name: verificador-de-tableros
  # La etiqueta, no solo el nombre: `NetworkPolicy` selecciona por `podSelector`,
  # y sin ella las dos excepciones de mas arriba y de mas abajo no tienen a quien
  # apuntar.
  labels: { app: verificador-de-tableros }
spec:
  restartPolicy: Never
  containers:
    - name: verificador
      image: python:3.12-alpine
      command: ["sleep", "600"]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: permitir-verificacion-tableros-verificador
spec:
  podSelector: { matchLabels: { app: verificador-de-tableros } }
  policyTypes: [Egress]
  egress:
    - to: [{ podSelector: { matchLabels: { app: kamayuk-stg-observabilidad-prometheus } } }]
      ports: [{ port: 9090, protocol: TCP }]
YAML
kubectl -n "$NS" wait --for=condition=Ready pod/verificador-de-tableros --timeout=60s

echo "· Esperando el primer scrape de todos los objetivos (dos ciclos de 30s)"
sleep 65

echo
echo "· Cada panel del tablero, consultado contra Prometheus"

# `targets[].expr` de cada panel que no es una fila (`type: row`).
consultas=$(node -e '
  const t = JSON.parse(require("fs").readFileSync("observabilidad/dashboards/resumen-operativo.json", "utf8"));
  for (const p of t.panels) {
    if (p.type === "row") continue;
    for (const objetivo of p.targets ?? []) {
      process.stdout.write(JSON.stringify({ panel: p.title, expr: objetivo.expr }) + "\n");
    }
  }
')

# timeout=10 y hasta 3 intentos, no una sola llamada sin limite (issue #215): a
# diferencia de verificar-alertas.sh -donde cada consulta ya vive dentro del
# sondeo de 36 intentos de `alerta_esta`-, esta consulta no tenia NINGUN
# reintento propio, y sin `timeout=` en urlopen podia colgarse minutos contra un
# nodo de `kind` recien creado. Un solo bache de red transitorio en UN panel
# tumbaba el guion entero -con `set -euo pipefail`- aunque los demas ya
# estuvieran en verde. Es el "urlopen error timed out" documentado en el issue.
consultar_panel() {
    local expr="$1" intento
    for intento in 1 2 3; do
        if kubectl -n "$NS" exec verificador-de-tableros -- python3 -c "
import json, urllib.parse, urllib.request
q = urllib.parse.quote('''$expr''')
r = urllib.request.urlopen(f'http://kamayuk-stg-observabilidad-prometheus:9090/api/v1/query?query={q}', timeout=10)
d = json.load(r)
print(len(d['data']['result']))
"; then
            return 0
        fi
        [ "$intento" -lt 3 ] && sleep 5
    done
    return 1
}

FALLARON=0
while IFS= read -r linea; do
    [ -n "$linea" ] || continue
    panel=$(echo "$linea" | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).panel)')
    expr=$(echo "$linea" | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).expr)')

    if ! resultado=$(consultar_panel "$expr"); then
        echo "  ✗ «${panel}»: la consulta a Prometheus fallo tras 3 intentos — $expr"
        FALLARON=$((FALLARON + 1))
        continue
    fi

    if [ "$resultado" = "0" ]; then
        echo "  ✗ «${panel}»: SIN DATOS — $expr"
        FALLARON=$((FALLARON + 1))
    else
        echo "  ✓ «${panel}»: $resultado serie(s)"
    fi
done <<< "$consultas"

if [ "$FALLARON" -gt 0 ]; then
    echo
    echo "FALLO: $FALLARON panel(es) sin datos. Es la regresion de \"No data\" que esta" >&2
    echo "comprobacion existe para atrapar." >&2
    exit 1
fi

echo
echo "Los paneles del tablero muestran datos de verdad."
