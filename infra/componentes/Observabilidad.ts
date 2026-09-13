import { commonLabels, resourceName, type Environment } from "../config";
import {
  CLAVES,
  huellaDelContenido,
  type TablaDeRecursos,
  nombreDePrioridad,
  secretos,
  seguridadSinRoot,
  servicioDeAlertmanager,
  servicioDeBaseDeDatos,
  servicioDeGrafana,
  servicioDeKubeStateMetrics,
  servicioDeNodeExporter,
  servicioDePrometheus,
  sondaHttp,
} from "./convenciones";
import { alertasYml, tableroResumenOperativoJson } from "./fuentes";
import type {
  ClusterRole,
  ClusterRoleBinding,
  ConfigMap,
  Deployment,
  Manifiesto,
  PersistentVolumeClaim,
  Service,
  ServiceAccount,
} from "./tipos";

/**
 * Observabilidad: metricas, tableros y una alerta que le llegue a alguien (issue #156).
 *
 * ## Autoalojado, y no Grafana Cloud
 *
 * El issue deja la decision abierta —«Grafana Cloud, como hace `../iaac`, o una pila
 * propia»— con su costo escrito: «una pila propia consume del mismo VPS que atiende a
 * la municipalidad». Se elige autoalojado, por el mismo motivo que ya decidio
 * PostgreSQL y Keycloak dentro del cluster (`ADR-0011`):
 *
 * | | Grafana Cloud (`../iaac`) | Autoalojado (lo elegido) |
 * |---|---|---|
 * | Se verifica en CI sin una cuenta de pago | No | Si, contra un `kind` real |
 * | Las metricas y los registros salen del VPS | Si | No |
 * | Las alertas dependen de un servicio externo | Si | No |
 * | Costo | Plan de Grafana Cloud | CPU y memoria del mismo VPS |
 *
 * La contrapartida esta anotada, como en `BaseDeDatos.ts`: los tableros y las alertas
 * de aqui son mas simples que los de `../iaac`, porque cada pieza esta escrita a mano
 * y probada, no importada de una plantilla de grafana.com.
 *
 * ## Objetivos estaticos, sin RBAC para Prometheus
 *
 * El conjunto de cosas que scrapear es CONOCIDO y pequeño —un VPS, un puñado de
 * servicios—, asi que `prometheus.yml` usa `static_configs`, no descubrimiento por el
 * API de Kubernetes. Eso evita darle a Prometheus una cuenta de servicio con permiso
 * de lectura sobre el cluster entero, que es exactamente lo que un `kubernetes_sd_config`
 * pediria. El unico componente que SI necesita hablar con el API es
 * `kube-state-metrics` —es su trabajo: convertir el estado de los objetos en
 * metricas—, y su `ClusterRole` esta acotado a los recursos que las alertas y el
 * tablero realmente usan, no un `list/watch` de todo.
 *
 * ## kamayuk_monitor, no en este archivo
 *
 * El sidecar `postgres-exporter` vive en `BaseDeDatos.ts`, en el MISMO pod que el
 * motor: comparte su red, se conecta a `localhost`, y usa `kamayuk_monitor`
 * —`pg_monitor`, nada de DDL, creado por `inicializacion/50-rol-de-monitoreo.sh`—.
 * No es un componente aparte porque no necesita serlo, y porque un `Deployment`
 * distinto tendria que volver a resolver "como llega a la base sin ser kamayuk_owner".
 */

const IMAGEN_DE_PROMETHEUS = "prom/prometheus:v2.55.1";
const IMAGEN_DE_ALERTMANAGER = "prom/alertmanager:v0.27.0";
const IMAGEN_DE_NODE_EXPORTER = "prom/node-exporter:v1.8.2";
const IMAGEN_DE_GRAFANA = "grafana/grafana:11.3.0";

/**
 * `registry.k8s.io` es el registro oficial del proyecto. No se pudo verificar el pull
 * desde este entorno de desarrollo —el proxy de la maquina de trabajo bloquea ese
 * registro especifico, algo ya documentado para otros dominios en este repositorio—,
 * pero los runners de GitHub Actions tienen salida sin restringir (demostrado en
 * `.github/workflows/infra.yml` para wal-g y gitleaks). Si el `kind` de CI no
 * consigue el pull, es lo primero a revisar.
 */
const IMAGEN_DE_KUBE_STATE_METRICS = "registry.k8s.io/kube-state-metrics/kube-state-metrics:v2.13.0";

export interface ObservabilidadArgs {
  environment: Environment;
  namespace: string;
  /** La tabla del perfil de recursos de este ambiente (`C-19`). */
  recursos: TablaDeRecursos;
  /** A donde Alertmanager envia (`backupAlertWebhookUrl`-style). Ver `config.ts`. */
  alertWebhookUrl?: string;
}

export function manifiestosDeObservabilidad(args: ObservabilidadArgs): Manifiesto[] {
  const { environment, namespace, alertWebhookUrl, recursos } = args;
  const etiquetas = commonLabels(environment, "observabilidad");
  const prioridad = nombreDePrioridad(environment, "lote");
  const secreto = secretos(environment);

  return [
    ...manifiestosDePrometheus({ environment, namespace, etiquetas, prioridad, recursos }),
    ...manifiestosDeAlertmanager({
      environment,
      namespace,
      etiquetas,
      prioridad,
      recursos,
      alertWebhookUrl,
    }),
    ...manifiestosDeNodeExporter({ environment, namespace, etiquetas, prioridad, recursos }),
    ...manifiestosDeKubeStateMetrics({ environment, namespace, etiquetas, prioridad, recursos }),
    ...manifiestosDeGrafana({ environment, namespace, etiquetas, prioridad, recursos, secreto }),
  ];
}

interface ArgsComunes {
  environment: Environment;
  namespace: string;
  etiquetas: Record<string, string>;
  prioridad: string;
  /** La tabla del perfil de recursos de este ambiente (`C-19`). */
  recursos: TablaDeRecursos;
}

// ─────────────────────────────────────────────────────────────────────────────
// Prometheus
// ─────────────────────────────────────────────────────────────────────────────

function configuracionDePrometheus(environment: Environment): string {
  return [
    "# Generado por infra/componentes/Observabilidad.ts. No editar en el nodo.",
    "global:",
    "  scrape_interval: 30s",
    "  evaluation_interval: 30s",
    "  external_labels:",
    `    cluster: kamayuk-${environment}`,
    "rule_files:",
    "  - /etc/prometheus/reglas/alertas.yml",
    "alerting:",
    "  alertmanagers:",
    "    - static_configs:",
    `        - targets: ["${servicioDeAlertmanager(environment)}:9093"]`,
    "scrape_configs:",
    "  - job_name: prometheus",
    "    static_configs:",
    '      - targets: ["localhost:9090"]',
    // **Ningun objetivo de aplicacion** (`E`). Hasta el 2026-09-06 aqui iba
    // `job_name: aplicacion` apuntando al monolito, detras de la bandera de C-19. El
    // monolito se fue y **los cuatro sistemas no entran en su sitio**: sus `Service` viven
    // en su propio namespace desde ADR-0031 y este Prometheus raspa por nombre corto, asi
    // que anadirlos pide `<servicio>.<namespace>` y decidir que expone cada uno. Queda
    // como hueco declarado en `E` en vez de dejar cuatro objetivos que no resuelven: un
    // objetivo permanentemente `down` no dispara ninguna alerta —`alertas.yml` no tiene
    // ninguna sobre `up`— y ensena a no mirar la lista de objetivos (C-17 §5, C-19 §2.1).
    "  - job_name: postgres",
    "    static_configs:",
    `      - targets: ["${servicioDeBaseDeDatos(environment)}:9187"]`,
    "  - job_name: node",
    "    static_configs:",
    `      - targets: ["${servicioDeNodeExporter(environment)}:9100"]`,
    "  - job_name: kube-state-metrics",
    "    static_configs:",
    `      - targets: ["${servicioDeKubeStateMetrics(environment)}:8080"]`,
    "  - job_name: traefik",
    "    static_configs:",
    "      # k3s, `kube-system`: el mismo Traefik que reconfigura Ingreso.ts.",
    "      # `traefik-metrics` y NO `traefik`: el segundo es el Service del",
    "      # LoadBalancer y publica solo 80 y 443 (medido en `prod`, #113). El del",
    "      # 9100 lo crea `metrics.prometheus.service.enabled` de Ingreso.ts.",
    '      - targets: ["traefik-metrics.kube-system.svc.cluster.local:9100"]',
    "",
  ].join("\n");
}



function manifiestosDePrometheus(args: ArgsComunes): Manifiesto[] {
  const { environment, namespace, etiquetas, prioridad, recursos } = args;
  const nombre = servicioDePrometheus(environment);

  const configuracion: ConfigMap = {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: resourceName(environment, "observabilidad-prometheus"), namespace, labels: etiquetas },
    data: {
      "prometheus.yml": configuracionDePrometheus(environment),
      "alertas.yml": alertasYml(),
    },
  };

  const volumen: PersistentVolumeClaim = {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name: resourceName(environment, "observabilidad-prometheus-datos"),
      namespace,
      labels: etiquetas,
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      // Quince dias de retencion —fijado en el propio `Deployment`— caben de sobra
      // aqui. No es el padron: si se pierde, se reconstruye scrapeando de nuevo.
      resources: { requests: { storage: "8Gi" } },
    },
  };

  const motor: Deployment = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: nombre, namespace, labels: etiquetas },
    spec: {
      replicas: 1,
      strategy: { type: "Recreate" },
      selector: { matchLabels: { app: nombre } },
      template: {
        metadata: {
          labels: { ...etiquetas, app: nombre },
          // Recrea el pod cuando su configuracion cambia (#146): sin esto el archivo se
          // actualiza dentro del pod y el proceso sigue con el viejo.
          annotations: { "kamayuk.gob.pe/suma-de-la-configuracion": huellaDelContenido(configuracion.data) },
        },
        spec: {
          priorityClassName: prioridad,
          // La imagen ya corre como `nobody` (issue #157), pero el PVC que monta lo
          // crea el aprovisionador de disco -root, sin saber de ese usuario-: sin
          // `fsGroup` el proceso no root no podria escribir su propia base de series.
          securityContext: { fsGroup: 65534 },
          containers: [
            {
              name: "prometheus",
              image: IMAGEN_DE_PROMETHEUS,
              args: [
                "--config.file=/etc/prometheus/prometheus.yml",
                "--storage.tsdb.path=/prometheus",
                "--storage.tsdb.retention.time=15d",
                // Habilita `POST /-/reload`: releer la configuracion sin recrear el
                // Pod. `verificar-tableros.sh` (issue #157) lo necesita para repuntar
                // el scrape de la aplicacion sin pasar por `kubectl rollout restart`
                // -encontrado en CI, en CUATRO corridas seguidas: justo despues de
                // esa recreacion la primera consulta fallaba conectando, con
                // Prometheus ya sirviendo peticiones segun su propio log y el Pod en
                // Ready segun el API server. No habia nada mal en Prometheus: era la
                // recreacion misma, que cambia la direccion que el Service enruta.
                "--web.enable-lifecycle",
              ],
              ports: [{ name: "http", containerPort: 9090 }],
              // Sin `readOnlyRootFilesystem`: no esta comprobado contra un Prometheus
              // real que su unica escritura sea `/prometheus` -sin Docker local para
              // probarlo, ver CLAUDE.md-, y equivocarse aqui cambia una base de series
              // que arranca por una que no.
              //
              // `runAsUser: 65534` (issue #157): la imagen fija `USER nobody`, un
              // nombre, no un numero, y el kubelet rechaza el contenedor sin poder
              // VERIFICAR que ese usuario es no-root -"container has runAsNonRoot and
              // image has non-numeric user (nobody), cannot verify user is non-root",
              // encontrado en CI-. 65534 es el UID real de `nobody` en la imagen; el
              // `fsGroup` de mas abajo ya usaba el mismo numero, por la misma razon.
              securityContext: seguridadSinRoot({ runAsUser: 65534 }),
              resources: recursos.prometheus,
              volumeMounts: [
                { name: "configuracion", mountPath: "/etc/prometheus" },
                { name: "reglas", mountPath: "/etc/prometheus/reglas" },
                { name: "datos", mountPath: "/prometheus" },
              ],
              readinessProbe: sondaHttp("/-/ready", 9090, { periodSeconds: 10, failureThreshold: 3 }),
              livenessProbe: sondaHttp("/-/healthy", 9090, { periodSeconds: 20, failureThreshold: 5 }),
            },
          ],
          volumes: [
            // Dos volumenes del MISMO ConfigMap, montados en dos rutas: Prometheus
            // recarga `prometheus.yml` desde su propio directorio, y `rule_files`
            // apunta a un subdirectorio separado para no mezclar la configuracion
            // del servidor con las reglas de alerta.
            { name: "configuracion", configMap: { name: configuracion.metadata.name } },
            { name: "reglas", configMap: { name: configuracion.metadata.name } },
            { name: "datos", persistentVolumeClaim: { claimName: volumen.metadata.name } },
          ],
        },
      },
    },
  };

  const servicio: Service = {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: nombre, namespace, labels: etiquetas },
    spec: {
      type: "ClusterIP",
      selector: { app: nombre },
      ports: [{ name: "http", port: 9090, targetPort: 9090 }],
    },
  };

  return [configuracion, volumen, motor, servicio];
}

// ─────────────────────────────────────────────────────────────────────────────
// Alertmanager
// ─────────────────────────────────────────────────────────────────────────────

/**
 * La configuracion de Alertmanager.
 *
 * Sin `alertWebhookUrl`, el receptor es `null-receiver`: las reglas se EVALUAN y
 * Alertmanager las recibe —visibles en su API—, pero nadie recibe nada. Es
 * DELIBERADO, no un descuido: es la demostracion que el propio issue #156 pide —«una
 * regla que no notifica a nadie no es una alerta, es un grafico»— hecha explicita en
 * vez de silenciosa. `config.ts` exige el valor en `prod`.
 */
function configuracionDeAlertmanager(alertWebhookUrl: string | undefined): string {
  return [
    "# Generado por infra/componentes/Observabilidad.ts. No editar en el nodo.",
    "route:",
    "  group_by: [alertname]",
    "  group_wait: 30s",
    "  group_interval: 5m",
    "  repeat_interval: 4h",
    `  receiver: ${alertWebhookUrl ? "webhook" : "null-receiver"}`,
    "receivers:",
    "  - name: null-receiver",
    ...(alertWebhookUrl
      ? [
          "  - name: webhook",
          "    webhook_configs:",
          `      - url: ${alertWebhookUrl}`,
          "        send_resolved: true",
        ]
      : []),
    "",
  ].join("\n");
}

function manifiestosDeAlertmanager(
  args: ArgsComunes & { alertWebhookUrl?: string },
): Manifiesto[] {
  const { environment, namespace, etiquetas, prioridad, recursos, alertWebhookUrl } = args;
  const nombre = servicioDeAlertmanager(environment);

  const configuracion: ConfigMap = {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: resourceName(environment, "observabilidad-alertmanager"), namespace, labels: etiquetas },
    data: { "alertmanager.yml": configuracionDeAlertmanager(alertWebhookUrl) },
  };

  const motor: Deployment = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: nombre, namespace, labels: etiquetas },
    spec: {
      replicas: 1,
      strategy: { type: "Recreate" },
      selector: { matchLabels: { app: nombre } },
      template: {
        metadata: {
          labels: { ...etiquetas, app: nombre },
          // Recrea el pod cuando su configuracion cambia (#146): sin esto el archivo se
          // actualiza dentro del pod y el proceso sigue con el viejo.
          annotations: { "kamayuk.gob.pe/suma-de-la-configuracion": huellaDelContenido(configuracion.data) },
        },
        spec: {
          priorityClassName: prioridad,
          // Mismo motivo que en Prometheus: el `emptyDir` de deduplicacion lo crea
          // el kubelet, no la imagen, y sin `fsGroup` un proceso no-root podria
          // encontrarselo sin permiso de escritura.
          securityContext: { fsGroup: 65534 },
          containers: [
            {
              name: "alertmanager",
              image: IMAGEN_DE_ALERTMANAGER,
              args: ["--config.file=/etc/alertmanager/alertmanager.yml"],
              ports: [{ name: "http", containerPort: 9093 }],
              // `runAsUser: 65534` (issue #157): ver el comentario identico junto a
              // Prometheus -misma imagen base, mismo `USER nobody` sin numero-.
              securityContext: seguridadSinRoot({ runAsUser: 65534 }),
              resources: recursos.alertmanager,
              volumeMounts: [
                { name: "configuracion", mountPath: "/etc/alertmanager" },
                // El estado de deduplicacion, no algo que sobreviva a un
                // reinicio a proposito: perderlo en un `Recreate` reenvia como
                // mucho una alerta duplicada, nunca una que se pierda.
                { name: "datos", mountPath: "/alertmanager" },
              ],
              readinessProbe: sondaHttp("/-/ready", 9093, { periodSeconds: 10, failureThreshold: 3 }),
              livenessProbe: sondaHttp("/-/healthy", 9093, { periodSeconds: 20, failureThreshold: 5 }),
            },
          ],
          volumes: [
            { name: "configuracion", configMap: { name: configuracion.metadata.name } },
            { name: "datos", emptyDir: {} },
          ],
        },
      },
    },
  };

  const servicio: Service = {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: nombre, namespace, labels: etiquetas },
    spec: {
      type: "ClusterIP",
      selector: { app: nombre },
      ports: [{ name: "http", port: 9093, targetPort: 9093 }],
    },
  };

  return [configuracion, motor, servicio];
}

// ─────────────────────────────────────────────────────────────────────────────
// node-exporter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Un `Deployment`, no un `DaemonSet` —que este repositorio no modela (`tipos.ts`)—.
 * Con un solo nodo (`INF-01` §1.1), un `DaemonSet` y un `Deployment(replicas: 1)`
 * hacen exactamente lo mismo: un pod, en el unico nodo que hay. Modelar `DaemonSet`
 * para una flota de uno es complejidad que nadie pidio.
 *
 * Este parrafo citaba `hostNetwork`/`hostPID` como lo que igualaba las dos formas.
 * `hostNetwork` se retiro al cerrar #113 —hacia el pod inalcanzable, ver el comentario
 * de dentro— y la equivalencia no dependia de el.
 */
function manifiestosDeNodeExporter(args: ArgsComunes): Manifiesto[] {
  const { environment, namespace, etiquetas, prioridad, recursos } = args;
  const nombre = servicioDeNodeExporter(environment);

  const motor: Deployment = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: nombre, namespace, labels: etiquetas },
    spec: {
      replicas: 1,
      strategy: { type: "Recreate" },
      selector: { matchLabels: { app: nombre } },
      template: {
        metadata: { labels: { ...etiquetas, app: nombre } },
        spec: {
          priorityClassName: prioridad,
          // `hostPID` se queda; `hostNetwork` NO, y es lo que cerro #113.
          //
          // Lo que hace que esto mida el NODO y no el contenedor son `/host/proc` y
          // `/host/sys` con `--path.procfs`/`--path.sysfs`, no el espacio de nombres
          // de red. Con `hostNetwork: true` el `podIP` ES el `hostIP`, asi que el
          // EndpointSlice publicaba `164.68.125.44` — y medido el 2026-09-12 desde un
          // pod de este cluster, la IP del nodo es INALCANZABLE en todo puerto: se
          // probaron 22, 80, 443, 6443, 9100, 10250 y 31818, y los siete rechazados.
          // No es la NetworkPolicy: Alertmanager, con egreso `0.0.0.0/0:443`
          // explicito, alcanza `1.1.1.1:443` y no alcanza `164.68.125.44:443`. Es el
          // camino pod->nodo del anfitrion, que este repositorio no gobierna.
          //
          // El resultado era un vigilante ciego que parecia sano: el Service, su
          // EndpointSlice y `permitir-ingreso-node-exporter` estaban los tres bien
          // escritos y los tres inertes —una politica de ingreso no puede aplicarse
          // a un pod `hostNetwork`, cuyo trafico no pasa por la cadena de pod—, y
          // `up{job="node"}` llevaba 2 692 muestras con CERO en 1.
          hostPID: true,
          containers: [
            {
              name: "node-exporter",
              image: IMAGEN_DE_NODE_EXPORTER,
              args: [
                "--path.procfs=/host/proc",
                "--path.sysfs=/host/sys",
                // El `/` del anfitrion, que es lo que #147 destapo: `--path.procfs` y
                // `--path.sysfs` bastan para CPU, memoria y presion, pero **el sistema de
                // archivos no sale de `/proc`**. Sin `--path.rootfs`, node-exporter publica
                // los montajes de SU PROPIO contenedor —`/etc/hostname`, `/dev/shm`,
                // `/var/run`— y `node_filesystem_avail_bytes{mountpoint="/"}` sale VACIA.
                // Medido en `stg` el 2026-09-12: `DiscoDelNodoAlto` no podia sonar, el panel
                // «Disco en uso, raiz» salia vacio, y `SinMetricasDelNodo` —la guarda que
                // #141 anadio— paso a `firing` diciendo exactamente esto.
                "--path.rootfs=/host",
                // Los de fabrica de node-exporter, que con `rootfs` vuelven a tener sentido:
                // el viejo `^/(host/proc|host/sys)` describia el layout ANTERIOR y con este ya
                // no excluia nada. `/` NO se excluye, que es la que hace falta.
                "--collector.filesystem.mount-points-exclude=^/(dev|proc|sys|run/credentials/.+|var/lib/docker/.+|var/lib/kubelet/.+)($|/)",
              ],
              ports: [{ name: "metrics", containerPort: 9100 }],
              // Lee `/proc` y `/sys` de solo lectura y no escribe nada propio: el
              // candidato mas simple para sistema de archivos raiz de solo lectura
              // (issue #157). `runAsNonRoot` no choca con `hostPID`: los colectores
              // que usa este componente leen archivos del sistema completo
              // (`/proc/stat`, `/proc/meminfo`), no datos por proceso ajeno que
              // exigirian coincidir con su UID.
              //
              // `runAsUser: 65534`: la misma imagen base que Prometheus y
              // Alertmanager, con el mismo `USER nobody` sin numero.
              securityContext: seguridadSinRoot({ runAsUser: 65534, readOnlyRootFilesystem: true }),
              resources: recursos.exportador,
              volumeMounts: [
                // Un solo montaje: el `/` del anfitrion en `/host`, de SOLO LECTURA. De ahi
                // cuelgan `/host/proc` y `/host/sys`, asi que los dos `--path.*` de arriba
                // siguen apuntando a donde apuntaban.
                {
                  name: "raiz-del-anfitrion",
                  mountPath: "/host",
                  readOnly: true,
                  mountPropagation: "HostToContainer",
                },
              ],
              readinessProbe: sondaHttp("/metrics", 9100, { periodSeconds: 10, failureThreshold: 3 }),
              livenessProbe: sondaHttp("/metrics", 9100, { periodSeconds: 20, failureThreshold: 5 }),
            },
          ],
          volumes: [
            // El `/` entero, y hay que justificarlo porque es superficie (#147): node-exporter
            // existe para medir el NODO, y el arbol de montajes del nodo no se puede leer desde
            // dentro del contenedor de ninguna otra forma. Va `readOnly` en el montaje, el
            // contenedor corre como 65534 sin root y con la raiz sellada, y los unicos colectores
            // encendidos leen `/proc`, `/sys` y `statfs`. Lo que se gana a cambio es que la
            // alerta del disco pueda sonar: hasta #147 no podia, y el runbook
            // `el-disco-del-nodo-se-lleno.md` empieza justamente por ella.
            { name: "raiz-del-anfitrion", hostPath: { path: "/" } },
          ],
        },
      },
    },
  };

  const servicio: Service = {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: nombre, namespace, labels: etiquetas },
    spec: {
      type: "ClusterIP",
      selector: { app: nombre },
      ports: [{ name: "metrics", port: 9100, targetPort: 9100 }],
    },
  };

  return [motor, servicio];
}

// ─────────────────────────────────────────────────────────────────────────────
// kube-state-metrics: el unico componente con RBAC propio
// ─────────────────────────────────────────────────────────────────────────────

function manifiestosDeKubeStateMetrics(args: ArgsComunes): Manifiesto[] {
  const { environment, namespace, etiquetas, prioridad, recursos } = args;
  const nombre = servicioDeKubeStateMetrics(environment);

  const cuenta: ServiceAccount = {
    apiVersion: "v1",
    kind: "ServiceAccount",
    metadata: { name: nombre, namespace, labels: etiquetas },
  };

  const rol: ClusterRole = {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "ClusterRole",
    // `ClusterRole` no tiene namespace: el nombre lleva el ambiente para que stg y
    // prod, en el mismo cluster, no se pisen (`resourceName`, igual que todo lo demas).
    metadata: { name: nombre, labels: etiquetas },
    rules: [
      // Solo lo que las alertas de `alertas.yml` y el tablero usan. Nunca `list`
      // sobre Secret o ConfigMap: kube-state-metrics no necesita leer contenido,
      // solo metadatos de estado, y esta lista lo dice por extension.
      {
        apiGroups: [""],
        resources: ["pods", "nodes", "persistentvolumeclaims"],
        verbs: ["list", "watch"],
      },
      { apiGroups: ["apps"], resources: ["deployments"], verbs: ["list", "watch"] },
      { apiGroups: ["batch"], resources: ["jobs", "cronjobs"], verbs: ["list", "watch"] },
    ],
  };

  const enlace: ClusterRoleBinding = {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "ClusterRoleBinding",
    metadata: { name: nombre, labels: etiquetas },
    roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: rol.metadata.name },
    subjects: [{ kind: "ServiceAccount", name: cuenta.metadata.name, namespace }],
  };

  const motor: Deployment = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: nombre, namespace, labels: etiquetas },
    spec: {
      replicas: 1,
      strategy: { type: "Recreate" },
      selector: { matchLabels: { app: nombre } },
      template: {
        metadata: { labels: { ...etiquetas, app: nombre } },
        spec: {
          priorityClassName: prioridad,
          serviceAccountName: cuenta.metadata.name,
          containers: [
            {
              name: "kube-state-metrics",
              image: IMAGEN_DE_KUBE_STATE_METRICS,
              // Acota lo que colecta a los mismos recursos del ClusterRole: pedirle
              // permiso de lectura sobre algo y no usarlo para metricas es la mitad
              // de una superficie de mas.
              args: ["--resources=pods,nodes,persistentvolumeclaims,deployments,jobs,cronjobs"],
              ports: [{ name: "metrics", containerPort: 8080 }],
              // Sin volumen ninguno: solo lee el API de Kubernetes por la red y
              // traduce a metricas (issue #157).
              //
              // `runAsUser: 65534`: la imagen fija `USER nobody`, un nombre, no un
              // numero -el mismo motivo que Prometheus, Alertmanager y node-exporter-.
              securityContext: seguridadSinRoot({ runAsUser: 65534, readOnlyRootFilesystem: true }),
              resources: recursos.kubeStateMetrics,
              readinessProbe: sondaHttp("/healthz", 8080, { periodSeconds: 10, failureThreshold: 3 }),
              livenessProbe: sondaHttp("/healthz", 8080, { periodSeconds: 20, failureThreshold: 5 }),
            },
          ],
        },
      },
    },
  };

  const servicio: Service = {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: nombre, namespace, labels: etiquetas },
    spec: {
      type: "ClusterIP",
      selector: { app: nombre },
      ports: [{ name: "metrics", port: 8080, targetPort: 8080 }],
    },
  };

  return [cuenta, rol, enlace, motor, servicio];
}

// ─────────────────────────────────────────────────────────────────────────────
// Grafana: los tableros, nunca en una IngressRoute
// ─────────────────────────────────────────────────────────────────────────────

function proveedorDeOrigenDeDatos(environment: Environment): string {
  return [
    "apiVersion: 1",
    "datasources:",
    "  - name: Prometheus",
    "    uid: prometheus",
    "    type: prometheus",
    "    access: proxy",
    `    url: http://${servicioDePrometheus(environment)}:9090`,
    "    isDefault: true",
    "",
  ].join("\n");
}

const PROVEEDOR_DE_TABLEROS = [
  "apiVersion: 1",
  "providers:",
  "  - name: kamayuk",
  "    folder: Kamayuk",
  "    type: file",
  "    options:",
  "      path: /var/lib/grafana/dashboards",
  "",
].join("\n");

function manifiestosDeGrafana(
  args: ArgsComunes & { secreto: ReturnType<typeof secretos> },
): Manifiesto[] {
  const { environment, namespace, etiquetas, prioridad, recursos, secreto } = args;
  const nombre = servicioDeGrafana(environment);

  const configuracion: ConfigMap = {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: { name: resourceName(environment, "observabilidad-grafana"), namespace, labels: etiquetas },
    data: {
      "origenes-de-datos.yaml": proveedorDeOrigenDeDatos(environment),
      "proveedor-de-tableros.yaml": PROVEEDOR_DE_TABLEROS,
      "resumen-operativo.json": tableroResumenOperativoJson(),
    },
  };

  const volumen: PersistentVolumeClaim = {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: { name: resourceName(environment, "observabilidad-grafana-datos"), namespace, labels: etiquetas },
    spec: { accessModes: ["ReadWriteOnce"], resources: { requests: { storage: "1Gi" } } },
  };

  const motor: Deployment = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: nombre, namespace, labels: etiquetas },
    spec: {
      replicas: 1,
      strategy: { type: "Recreate" },
      selector: { matchLabels: { app: nombre } },
      template: {
        metadata: {
          labels: { ...etiquetas, app: nombre },
          // Recrea el pod cuando su configuracion cambia (#146): sin esto el archivo se
          // actualiza dentro del pod y el proceso sigue con el viejo.
          annotations: { "kamayuk.gob.pe/suma-de-la-configuracion": huellaDelContenido(configuracion.data) },
        },
        spec: {
          priorityClassName: prioridad,
          // Mismo motivo que Prometheus: el PVC de `/var/lib/grafana` lo crea el
          // aprovisionador de disco, no la imagen.
          securityContext: { fsGroup: 472 },
          containers: [
            {
              name: "grafana",
              image: IMAGEN_DE_GRAFANA,
              env: [
                { name: "GF_SECURITY_ADMIN_USER", value: "admin" },
                {
                  name: "GF_SECURITY_ADMIN_PASSWORD",
                  valueFrom: { secretKeyRef: { name: secreto.grafana, key: CLAVES.grafana } },
                },
                // Sin registro publico ni acceso anonimo: quien entra, entra con
                // la cuenta de administrador por el tunel SSH (ver el docstring
                // del `Service`, mas abajo), igual que la consola de Keycloak.
                { name: "GF_USERS_ALLOW_SIGN_UP", value: "false" },
                { name: "GF_AUTH_ANONYMOUS_ENABLED", value: "false" },
              ],
              ports: [{ name: "http", containerPort: 3000 }],
              // La imagen ya corre como `grafana` de fabrica (issue #157).
              securityContext: seguridadSinRoot(),
              resources: recursos.grafana,
              volumeMounts: [
                {
                  name: "configuracion",
                  mountPath: "/etc/grafana/provisioning/datasources/origenes-de-datos.yaml",
                  subPath: "origenes-de-datos.yaml",
                },
                {
                  name: "configuracion",
                  mountPath: "/etc/grafana/provisioning/dashboards/proveedor-de-tableros.yaml",
                  subPath: "proveedor-de-tableros.yaml",
                },
                {
                  name: "configuracion",
                  mountPath: "/var/lib/grafana/dashboards/resumen-operativo.json",
                  subPath: "resumen-operativo.json",
                },
                { name: "datos", mountPath: "/var/lib/grafana" },
              ],
              readinessProbe: sondaHttp("/api/health", 3000, { periodSeconds: 10, failureThreshold: 3 }),
              livenessProbe: sondaHttp("/api/health", 3000, { periodSeconds: 20, failureThreshold: 5 }),
            },
          ],
          volumes: [
            { name: "configuracion", configMap: { name: configuracion.metadata.name } },
            { name: "datos", persistentVolumeClaim: { claimName: volumen.metadata.name } },
          ],
        },
      },
    },
  };

  /**
   * `ClusterIP`, y sin `IngressRoute` a proposito —igual que la consola de
   * administracion de Keycloak (issue #153)—. Quien necesite mirar un tablero entra
   * por el tunel SSH que ya usa CI (`INF-01` §1.4): `kubectl port-forward` contra
   * este `Service`. Publicarlo agregaria una segunda superficie de acceso con clave,
   * y el tunel ya existe.
   */
  const servicio: Service = {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: nombre, namespace, labels: etiquetas },
    spec: {
      type: "ClusterIP",
      selector: { app: nombre },
      ports: [{ name: "http", port: 3000, targetPort: 3000 }],
    },
  };

  return [configuracion, volumen, motor, servicio];
}
