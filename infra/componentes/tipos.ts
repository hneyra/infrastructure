/**
 * Los manifiestos que `infra/` produce, como datos planos.
 *
 * **Nada de `pulumi.Input` aqui**, y es la decision que sostiene todo lo demas de esta
 * carpeta: cada componente es una funcion pura que devuelve objetos corrientes, y la
 * capa de Pulumi los toma y los aplica. De ahi salen tres cosas que no se consiguen si
 * los componentes crean recursos directamente:
 *
 * 1. **La auditoria de `auditoria.ts` puede leerlos.** Un `Input<number>` no se compara
 *    con 3; un `number` si. Las convenciones de `INF-01` §4 —toda sonda con
 *    `timeoutSeconds`, todo contenedor con limites, `Recreate` sobre volumen— se
 *    verifican leyendo el manifiesto, no confiando en que quien lo escribio se acordo.
 * 2. **Las pruebas corren sin Pulumi y sin clúster.** `yarn verificar` no necesita
 *    token, ni túnel, ni VPS: es lo que permite que un PR de cualquiera ponga rojo un
 *    despliegue mal formado.
 * 3. **El diff de un cambio de infraestructura es legible.** Lo que cambia es un objeto,
 *    no una llamada a un constructor con quince opciones.
 *
 * El costo es perder el tipado del esquema de Kubernetes, que era medio motivo de
 * elegir TypeScript (`ADR-0011` §1). Se recupera entero en
 * `verificaciones/conformidad-con-kubernetes.test.ts`: alli cada manifiesto se asigna
 * al tipo de `@pulumi/kubernetes` que le corresponde, y un nombre de propiedad mal
 * escrito **no compila**.
 */

/** Metadatos comunes. `namespace` falta solo en los objetos de alcance de clúster. */
export interface Metadatos {
  name: string;
  namespace?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

/** Referencia a una clave de un `Secret`. Es la unica forma en que entra una clave. */
export interface ReferenciaASecreto {
  secretKeyRef: { name: string; key: string };
}

export interface VariableDeEntorno {
  name: string;
  value?: string;
  valueFrom?: ReferenciaASecreto;
}

/**
 * Sonda. `timeoutSeconds` es obligatorio en el tipo, no opcional.
 *
 * El valor por omision del kubelet es **1 s** y en un nodo ocupado un contenedor sano
 * pero atareado no contesta en 1 s: tres fallos de la sonda de vida y lo mata con
 * codigo 143, que se parece a un OOM sin serlo. La cicatriz esta en `../iaac` y en
 * `INF-01` §4; aqui el tipo la hace imposible de olvidar, y la auditoria comprueba
 * ademas que el valor este entre 3 y 5 segundos.
 */
export interface Sonda {
  timeoutSeconds: number;
  initialDelaySeconds?: number;
  periodSeconds?: number;
  failureThreshold?: number;
  successThreshold?: number;
  httpGet?: { path: string; port: number | string; scheme?: string };
  exec?: { command: string[] };
  tcpSocket?: { port: number | string };
}

export interface Recursos {
  requests: { cpu: string; memory: string };
  limits: { cpu: string; memory: string };
}

/**
 * El endurecimiento de un contenedor (issue #157).
 *
 * `runAsNonRoot` es opcional en el TIPO porque no todas las imagenes lo soportan sin
 * ayuda: el motor de PostgreSQL arranca su `entrypoint` como root a proposito —para
 * poder tomar posesion del volumen antes de bajar privilegios con `gosu`— y forzarlo
 * aqui rompe el arranque en vez de asegurarlo. Cada componente que lo omite lo dice en
 * su propio comentario, con el motivo. `allowPrivilegeEscalation` y `capabilities.drop`
 * no tienen esa excusa: van en **todo** contenedor, y por eso `convenciones.seguridadBase`
 * los fija sin que nadie tenga que acordarse.
 *
 * `capabilities.add` existe por el mismo motivo que la ausencia de `runAsNonRoot`
 * arriba: dejar caer TODAS las capacidades vuelve a "root" incapaz incluso de sus
 * propias operaciones -un contenedor con `capabilities: { drop: ["ALL"] }` no puede
 * `chown` un archivo aunque corra como UID 0, porque en Linux el privilegio de root
 * viene de las capacidades, no del UID- (encontrado en CI: el `entrypoint` de
 * PostgreSQL fallaba con "Operation not permitted" al tomar posesion de `PGDATA`).
 * La respuesta correcta no es dejar de dropear TODO, es re-conceder por nombre
 * exactamente lo que ese `entrypoint` necesita y nada mas.
 */
export interface SecurityContext {
  runAsNonRoot?: boolean;
  /** Solo cuando el `USER` de la imagen no basta y hace falta nombrarlo (ej. `999`). */
  runAsUser?: number;
  allowPrivilegeEscalation: false;
  capabilities: { drop: ["ALL"]; add?: string[] };
  /** Solo donde un contenedor no escribe nada fuera de sus volumenes montados. */
  readOnlyRootFilesystem?: boolean;
}

export interface MontajeDeVolumen {
  name: string;
  mountPath: string;
  subPath?: string;
  readOnly?: boolean;
}

export interface Contenedor {
  name: string;
  image: string;
  imagePullPolicy?: string;
  command?: string[];
  args?: string[];
  env?: VariableDeEntorno[];
  envFrom?: { secretRef: { name: string } }[];
  ports?: { name?: string; containerPort: number }[];
  resources: Recursos;
  volumeMounts?: MontajeDeVolumen[];
  startupProbe?: Sonda;
  readinessProbe?: Sonda;
  livenessProbe?: Sonda;
  /** Opcional en el tipo, como `priorityClassName` en `EspecificacionDePod`: la
   *  auditoria (`auditarSeguridad`, issue #157) es quien lo exige en la practica, y
   *  hacerlo obligatorio en el tipo esconderia el mensaje de esa auditoria detras de
   *  un error de TypeScript menos preciso. */
  securityContext?: SecurityContext;
}

export interface Volumen {
  name: string;
  configMap?: { name: string; defaultMode?: number };
  secret?: { secretName: string; defaultMode?: number };
  persistentVolumeClaim?: { claimName: string };
  emptyDir?: Record<string, never>;
  /** Solo `node-exporter` (issue #156): lee `/proc` y `/sys` del nodo, de solo lectura. */
  hostPath?: { path: string; type?: string };
}

export interface EspecificacionDePod {
  restartPolicy?: string;
  priorityClassName: string;
  /** Solo lo declara `kube-state-metrics` (issue #156): es el unico pod con RBAC propio. */
  serviceAccountName?: string;
  /** Solo `node-exporter`: sin el, ve la red y el PID 1 del contenedor, no los del nodo. */
  hostNetwork?: boolean;
  hostPID?: boolean;
  /**
   * `fsGroup` (issue #157): quien monta un volumen persistente o `emptyDir` y corre
   * como no-root necesita que el volumen sea escribible por su grupo, y ni el
   * aprovisionador local de `kind` ni el disco local del VPS le dan esa propiedad
   * solos. El kubelet aplica el `chown` recursivo al montar, una sola vez.
   */
  securityContext?: { fsGroup?: number };
  initContainers?: Contenedor[];
  containers: Contenedor[];
  volumes?: Volumen[];
}

export interface PlantillaDePod {
  metadata: { labels: Record<string, string> };
  spec: EspecificacionDePod;
}

export interface Namespace {
  apiVersion: "v1";
  kind: "Namespace";
  metadata: Metadatos;
}

export interface PriorityClass {
  apiVersion: "scheduling.k8s.io/v1";
  kind: "PriorityClass";
  metadata: Metadatos;
  value: number;
  globalDefault: false;
  description: string;
}

export interface ConfigMap {
  apiVersion: "v1";
  kind: "ConfigMap";
  metadata: Metadatos;
  data: Record<string, string>;
}

export interface PersistentVolumeClaim {
  apiVersion: "v1";
  kind: "PersistentVolumeClaim";
  metadata: Metadatos;
  spec: {
    accessModes: string[];
    resources: { requests: { storage: string } };
  };
}

export interface Service {
  apiVersion: "v1";
  kind: "Service";
  metadata: Metadatos;
  spec: {
    type: "ClusterIP";
    selector: Record<string, string>;
    ports: { name: string; port: number; targetPort: number | string }[];
  };
}

export interface Deployment {
  apiVersion: "apps/v1";
  kind: "Deployment";
  metadata: Metadatos;
  spec: {
    replicas: number;
    strategy: {
      type: "Recreate" | "RollingUpdate";
      // Solo con `RollingUpdate`. `maxSurge: 0` obliga a matar un pod viejo antes de
      // crear el nuevo: en un nodo sin holgura, un pod extra durante el despliegue no
      // agenda y el rollout se cuelga (`Insufficient cpu`).
      rollingUpdate?: { maxSurge?: number | string; maxUnavailable?: number | string };
    };
    selector: { matchLabels: Record<string, string> };
    template: PlantillaDePod;
  };
}

export interface Job {
  apiVersion: "batch/v1";
  kind: "Job";
  metadata: Metadatos;
  spec: {
    backoffLimit: number;
    ttlSecondsAfterFinished?: number;
    template: PlantillaDePod;
  };
}

export interface CronJob {
  apiVersion: "batch/v1";
  kind: "CronJob";
  metadata: Metadatos;
  spec: {
    schedule: string;
    suspend?: boolean;
    concurrencyPolicy: "Forbid";
    successfulJobsHistoryLimit?: number;
    failedJobsHistoryLimit?: number;
    jobTemplate: { spec: { backoffLimit: number; template: PlantillaDePod } };
  };
}

/**
 * Recursos de Traefik v3.
 *
 * `traefik.io/v1alpha1`, y no `traefik.containo.us/v1alpha1`: el grupo cambio en
 * Traefik v3 y el manifiesto con el grupo viejo se aplica sin error contra un clúster
 * que ya no lo sirve — se queda ahi, sin efecto, y la ruta no existe. Es una de las
 * trampas anotadas en `../iaac`.
 */
export interface IngressRoute {
  apiVersion: "traefik.io/v1alpha1";
  kind: "IngressRoute";
  metadata: Metadatos;
  spec: {
    entryPoints: string[];
    routes: {
      match: string;
      kind: "Rule";
      priority?: number;
      services: { name: string; port: number }[];
      middlewares?: { name: string }[];
    }[];
    tls?: {
      certResolver: string;
      /** Referencia a un `TLSOption`. Es donde vive la version minima de TLS. */
      options?: { name: string; namespace: string };
    };
  };
}

/** Version minima de TLS y cifrados. Traefik lo aplica por ruta. */
export interface TLSOption {
  apiVersion: "traefik.io/v1alpha1";
  kind: "TLSOption";
  metadata: Metadatos;
  spec: { minVersion: string; sniStrict?: boolean };
}

export interface Middleware {
  apiVersion: "traefik.io/v1alpha1";
  kind: "Middleware";
  metadata: Metadatos;
  spec: Record<string, unknown>;
}

/**
 * `HelmChartConfig` de k3s: reconfigura el Traefik que el nodo ya trae de fabrica.
 *
 * No se instala otro Traefik: se le pasan valores al que k3s despliega solo, que es lo
 * que hace `../iaac` y lo que evita dos ingresos peleandose por el puerto 443.
 */
export interface HelmChartConfig {
  apiVersion: "helm.cattle.io/v1";
  kind: "HelmChartConfig";
  metadata: Metadatos;
  spec: { valuesContent: string };
}

/**
 * Los tres objetos de RBAC, y solo para `kube-state-metrics` (issue #156).
 *
 * Es el UNICO componente de todo `infra/` que habla con el API de Kubernetes —lee
 * pods, nodos y `CronJob` para convertirlos en metricas—, y por eso es el unico que
 * necesita una cuenta de servicio con permisos. Todo lo demas de este repositorio
 * corre sin RBAC propio a proposito: menos superficie que auditar.
 */
export interface ServiceAccount {
  apiVersion: "v1";
  kind: "ServiceAccount";
  metadata: Metadatos;
}

/** De alcance de clúster: `kube-state-metrics` lee objetos de todos los namespaces. */
export interface ClusterRole {
  apiVersion: "rbac.authorization.k8s.io/v1";
  kind: "ClusterRole";
  metadata: Metadatos;
  rules: { apiGroups: string[]; resources: string[]; verbs: string[] }[];
}

export interface ClusterRoleBinding {
  apiVersion: "rbac.authorization.k8s.io/v1";
  kind: "ClusterRoleBinding";
  metadata: Metadatos;
  roleRef: { apiGroup: "rbac.authorization.k8s.io"; kind: "ClusterRole"; name: string };
  subjects: { kind: "ServiceAccount"; name: string; namespace: string }[];
}

/**
 * Denegacion por omision, y se abre lo necesario (issue #157).
 *
 * Un `podSelector` vacio (`{}`) selecciona TODOS los pods del namespace: es la forma
 * de escribir «nada entra, nada sale» antes de las excepciones. Cada regla de mas
 * abajo es una excepcion nombrada, nunca «todo menos la lista negra» — la diferencia
 * que separa una politica que protege de una que documenta buenas intenciones.
 *
 * `podSelector: { matchLabels: { app: ... } }` en vez de `componente`, a proposito:
 * los cinco sub-componentes de `Observabilidad.ts` comparten la etiqueta
 * `componente: observabilidad` (issue #156), y una politica que seleccionara por esa
 * etiqueta le daria a Grafana el trafico que solo Prometheus deberia recibir.
 */
export interface NetworkPolicy {
  apiVersion: "networking.k8s.io/v1";
  kind: "NetworkPolicy";
  metadata: Metadatos;
  spec: {
    podSelector: { matchLabels: Record<string, string> } | Record<string, never>;
    policyTypes: ("Ingress" | "Egress")[];
    ingress?: ReglaDeRed[];
    egress?: ReglaDeRed[];
  };
}

interface SelectorDeRed {
  podSelector?: { matchLabels: Record<string, string> };
  namespaceSelector?: { matchLabels: Record<string, string> };
  /** Solo para salida a internet: un bloque CIDR, con `except` para lo que no cubre. */
  ipBlock?: { cidr: string; except?: string[] };
}

interface ReglaDeRed {
  /** Ausente: el `NetworkPolicy` de Kubernetes lo entiende como «cualquier origen o destino». */
  from?: SelectorDeRed[];
  to?: SelectorDeRed[];
  ports?: { protocol: "TCP" | "UDP"; port: number }[];
}

export type Manifiesto =
  | Namespace
  | PriorityClass
  | ConfigMap
  | PersistentVolumeClaim
  | Service
  | Deployment
  | Job
  | CronJob
  | IngressRoute
  | Middleware
  | TLSOption
  | HelmChartConfig
  | ServiceAccount
  | ClusterRole
  | ClusterRoleBinding
  | NetworkPolicy;

/** Los manifiestos que llevan pods dentro. La auditoria los recorre todos. */
export interface PodAuditable {
  /** De donde salio, para que el mensaje de la auditoria diga que hay que arreglar. */
  contexto: string;
  clase: "Deployment" | "Job" | "CronJob";
  pod: EspecificacionDePod;
  /** Las etiquetas de la plantilla. De ahi sale `componente`, que la auditoria mira. */
  etiquetas: Record<string, string>;
}

/** Extrae los pods de un manifiesto. Devuelve vacio si el manifiesto no lleva ninguno. */
export function podsDe(m: Manifiesto): PodAuditable[] {
  const nombre = `${m.kind}/${m.metadata.name}`;
  switch (m.kind) {
    case "Deployment":
      return [
        {
          contexto: nombre,
          clase: "Deployment",
          pod: m.spec.template.spec,
          etiquetas: m.spec.template.metadata.labels,
        },
      ];
    case "Job":
      return [
        {
          contexto: nombre,
          clase: "Job",
          pod: m.spec.template.spec,
          etiquetas: m.spec.template.metadata.labels,
        },
      ];
    case "CronJob":
      return [
        {
          contexto: nombre,
          clase: "CronJob",
          pod: m.spec.jobTemplate.spec.template.spec,
          etiquetas: m.spec.jobTemplate.spec.template.metadata.labels,
        },
      ];
    default:
      return [];
  }
}

/** Todo contenedor de un pod, los de inicializacion incluidos. */
export function contenedoresDe(pod: EspecificacionDePod): Contenedor[] {
  return [...(pod.initContainers ?? []), ...pod.containers];
}

/** Las sondas de un contenedor, con el nombre con que la auditoria las nombra. */
export function sondasDe(c: Contenedor): { nombre: string; sonda: Sonda }[] {
  const sondas: { nombre: string; sonda: Sonda }[] = [];
  if (c.startupProbe) sondas.push({ nombre: "startupProbe", sonda: c.startupProbe });
  if (c.readinessProbe) sondas.push({ nombre: "readinessProbe", sonda: c.readinessProbe });
  if (c.livenessProbe) sondas.push({ nombre: "livenessProbe", sonda: c.livenessProbe });
  return sondas;
}
