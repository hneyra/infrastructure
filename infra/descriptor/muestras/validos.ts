/**
 * DOS descriptores validos, que la auditoria acepta.
 *
 * **Son la mitad que importa de las muestras.** Una guarda que grita siempre acaba
 * esquivada, y entonces no protege nada: sin estos dos, `auditarDescriptor` podria estar
 * rechazandolo todo —un `return ["mal"]` al principio— y las cinco pruebas de las
 * prohibiciones seguirian en verde.
 *
 * Los dos son realistas a proposito, y distintos entre si en lo que la separacion cambia:
 * `catastro` tiene **un** perfil y una base pequeña; `rentas` tiene **dos** —`web` y
 * `batch`— y es quien conserva el portal. Si el contrato solo sirviera para el caso
 * simple, se veria aqui.
 */

import { seguridadBase } from "../../componentes/convenciones";
import type { Manifiesto, NetworkPolicy } from "../../componentes/tipos";
import type {
  BaseDeDatosDeclarada,
  ClaveDeclarada,
  DescriptorDeSistema,
  EntornoDelDescriptor,
  PanelDeclarado,
  ReglaDeAlerta,
} from "../tipos";

const RECURSOS = {
  requests: { cpu: "100m", memory: "256Mi" },
  limits: { cpu: "500m", memory: "512Mi" },
};

/** Sondas con `timeoutSeconds` entre 3 y 5: el valor por omision del kubelet, 1 s, mata pods sanos. */
function sondas() {
  return {
    startupProbe: { timeoutSeconds: 3, httpGet: { path: "/actuator/health", port: 8080 }, failureThreshold: 30 },
    readinessProbe: { timeoutSeconds: 3, httpGet: { path: "/actuator/health/readiness", port: 8080 } },
    livenessProbe: { timeoutSeconds: 5, httpGet: { path: "/actuator/health/liveness", port: 8080 } },
  };
}

/**
 * Un perfil. `atiendeHttp` decide si lleva puerto, sondas y `Service`.
 *
 * El perfil `batch` NO atiende HTTP —`web-application-type: none`— y por eso no declara
 * puerto: un puerto ahi es una superficie que nadie pidio. Lo exige la auditoria
 * heredada, no una regla del descriptor, y es lo que hace que este segundo perfil valga
 * como muestra: si `rentas` copiara su perfil `web` para el `batch`, saldria rojo.
 */
function despliegueDe(
  sistema: string,
  perfil: string,
  e: EntornoDelDescriptor,
  imagen: string,
  atiendeHttp = true,
): Manifiesto[] {
  const nombre = `kamayuk-${sistema}-${perfil}`;
  const etiquetas = { ...e.etiquetas, componente: sistema, perfil };
  return [
    {
      apiVersion: "apps/v1",
      kind: "Deployment",
      metadata: { name: nombre, namespace: e.namespace, labels: etiquetas },
      spec: {
        replicas: 1,
        strategy: { type: "RollingUpdate", rollingUpdate: { maxSurge: 0, maxUnavailable: 1 } },
        selector: { matchLabels: { app: nombre } },
        template: {
          metadata: { labels: { ...etiquetas, app: nombre } },
          spec: {
            priorityClassName: e.prioridadDe("servicio"),
            containers: [
              {
                name: sistema,
                image: e.imagenDe(imagen),
                env: [
                  { name: "SPRING_PROFILES_ACTIVE", value: perfil },
                  // Sin el emisor, la aplicacion se niega a arrancar y es deliberado: un
                  // backend que atiende sin poder validar un token responde a la sonda,
                  // se declara sano y no atiende a nadie (ADR-0005). Lo exige la auditoria
                  // heredada, no una regla del descriptor.
                  { name: "KAMAYUK_OIDC_EMISOR", value: `https://${e.dominio}/keycloak/realms/sgtm` },
                  { name: "KAMAYUK_DB_CLAVE", valueFrom: { secretKeyRef: { name: e.secretoDe("app"), key: "clave" } } },
                ],
                ...(atiendeHttp ? { ports: [{ name: "http", containerPort: 8080 }] } : {}),
                resources: RECURSOS,
                ...(atiendeHttp ? sondas() : {}),
                securityContext: seguridadBase({ runAsNonRoot: true }),
              },
            ],
          },
        },
      },
    },
    ...(atiendeHttp
      ? [
          {
            apiVersion: "v1" as const,
            kind: "Service" as const,
            metadata: { name: nombre, namespace: e.namespace, labels: etiquetas },
            spec: {
              type: "ClusterIP" as const,
              selector: { app: nombre },
              ports: [{ name: "http", port: 80, targetPort: 8080 }],
            },
          },
        ]
      : []),
  ];
}

function migracionDe(sistema: string, e: EntornoDelDescriptor, imagen: string): Manifiesto[] {
  const nombre = `kamayuk-${sistema}-migracion`;
  const etiquetas = { ...e.etiquetas, componente: sistema };
  return [
    {
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: { name: nombre, namespace: e.namespace, labels: etiquetas },
      spec: {
        backoffLimit: 3,
        ttlSecondsAfterFinished: 86400,
        template: {
          metadata: { labels: { ...etiquetas, app: nombre } },
          spec: {
            restartPolicy: "Never",
            priorityClassName: e.prioridadDe("lote"),
            containers: [
              {
                name: "migrador",
                image: e.imagenDe(imagen),
                env: [
                  { name: "KAMAYUK_DB_CLAVE", valueFrom: { secretKeyRef: { name: e.secretoDe("owner"), key: "clave" } } },
                ],
                resources: RECURSOS,
                securityContext: seguridadBase({ runAsNonRoot: true }),
              },
            ],
          },
        },
      },
    },
  ];
}

/**
 * El Job de implantacion (C-14, punto 4): la fila de `municipalidad` en SU base.
 *
 * Con el migrador de contenedor de inicializacion, que es el reparto que los cuatro descriptores
 * de verdad usan: un `Deployment` no sabe esperar a un `Job`, y la salida del monolito —un
 * contenedor con `psql`— no vale aqui, porque un descriptor solo puede nombrar SUS imagenes.
 */
function implantacionDe(sistema: string, e: EntornoDelDescriptor, imagen: string): Manifiesto[] {
  const nombre = e.nombreConVersion(`kamayuk-${sistema}-implantacion`);
  const etiquetas = { ...e.etiquetas, componente: sistema };
  return [
    {
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: { name: nombre, namespace: e.namespace, labels: etiquetas },
      spec: {
        backoffLimit: 3,
        template: {
          metadata: { labels: { ...etiquetas, app: nombre } },
          spec: {
            restartPolicy: "Never",
            priorityClassName: e.prioridadDe("lote"),
            containers: [
              {
                name: "implantacion",
                image: e.imagenDe(imagen),
                env: [
                  { name: "SPRING_PROFILES_ACTIVE", value: "batch" },
                  { name: "KAMAYUK_IMPLANTACION_UBIGEO", value: e.implantacion.ubigeo },
                  { name: "KAMAYUK_DB_CLAVE", valueFrom: { secretKeyRef: { name: e.secretoDe("app"), key: "clave" } } },
                ],
                resources: RECURSOS,
                securityContext: seguridadBase({ runAsNonRoot: true }),
              },
            ],
          },
        },
      },
    },
  ];
}

/** Un `CronJob` del perfil `batch`, con su ventana. La imagen es la de la APLICACION. */
function loteDe(sistema: string, e: EntornoDelDescriptor, imagen: string): Manifiesto[] {
  const nombre = `kamayuk-${sistema}-lote`;
  const etiquetas = { ...e.etiquetas, componente: sistema };
  return [
    {
      apiVersion: "batch/v1",
      kind: "CronJob",
      metadata: { name: nombre, namespace: e.namespace, labels: etiquetas },
      spec: {
        schedule: "0 7 * * *",
        concurrencyPolicy: "Forbid",
        jobTemplate: {
          spec: {
            backoffLimit: 1,
            template: {
              metadata: { labels: { ...etiquetas, app: nombre } },
              spec: {
                restartPolicy: "Never",
                priorityClassName: e.prioridadDe("lote"),
                containers: [
                  {
                    name: "lote",
                    image: e.imagenDe(imagen),
                    env: [
                      { name: "SPRING_PROFILES_ACTIVE", value: "batch" },
                      { name: "KAMAYUK_DB_CLAVE", valueFrom: { secretKeyRef: { name: e.secretoDe("app"), key: "clave" } } },
                    ],
                    resources: RECURSOS,
                    securityContext: seguridadBase({ runAsNonRoot: true }),
                  },
                ],
              },
            },
          },
        },
      },
    },
  ];
}

function ingresoDe(sistema: string, prefijo: string, e: EntornoDelDescriptor): Manifiesto[] {
  return [
    {
      apiVersion: "traefik.io/v1alpha1",
      kind: "IngressRoute",
      metadata: { name: `kamayuk-${sistema}`, namespace: e.namespace, labels: e.etiquetas },
      spec: {
        entryPoints: ["websecure"],
        routes: [
          {
            match: `Host(\`${e.dominio}\`) && PathPrefix(\`/${prefijo}\`)`,
            kind: "Rule",
            services: [{ name: `kamayuk-${sistema}-web`, port: 80 }],
          },
        ],
        tls: { certResolver: "letsencrypt" },
      },
    },
  ];
}

/** Egreso: solo el motor. Que pueda llamar a otro sistema seria una linea mas, en su PR. */
function egresoAlMotor(sistema: string, e: EntornoDelDescriptor): NetworkPolicy[] {
  return [
    {
      apiVersion: "networking.k8s.io/v1",
      kind: "NetworkPolicy",
      metadata: { name: `kamayuk-${sistema}-egreso`, namespace: e.namespace, labels: e.etiquetas },
      spec: {
        podSelector: { matchLabels: { componente: sistema } },
        policyTypes: ["Egress"],
        egress: [
          { to: [{ podSelector: { matchLabels: { componente: "postgres" } } }], ports: [{ protocol: "TCP", port: 5432 }] },
        ],
      },
    },
  ];
}

function alertaDeCaida(sistema: string): ReglaDeAlerta {
  return {
    alert: `${sistema}SinResponder`,
    expr: `up{job="kamayuk-${sistema}"} == 0`,
    for: "5m",
    labels: { severity: "critical", sistema },
    annotations: { summary: `${sistema} lleva 5 minutos sin responder` },
  };
}

/** `catastro`: un perfil, una base. El caso simple. */
export const catastro: DescriptorDeSistema = {
  sistema: "catastro",
  prefijo: "catastro",
  imagenes: ["catastro"],
  baseDeDatos(): BaseDeDatosDeclarada {
    return {
      nombre: "catastro",
      roles: [
        { nombre: "catastro_owner", sobre: ["catastro"], privilegios: ["ALL"], superusuario: false },
        { nombre: "catastro_app", sobre: ["catastro"], privilegios: ["SELECT", "INSERT", "UPDATE"], superusuario: false },
      ],
    };
  },
  despliegue: (e) => despliegueDe("catastro", "web", e, "catastro"),
  migracion: (e) => migracionDe("catastro", e, "catastro"),
  implantacion: (e) => implantacionDe("catastro", e, "catastro"),
  // Sin ningun proceso por lotes. Vacio es una respuesta legitima, y es la mitad que hace que
  // esta muestra valga: si el contrato solo aguantara al que tiene `CronJob`, se veria aqui.
  lotes: (): Manifiesto[] => [],
  ingreso: (e) => ingresoDe("catastro", "catastro", e),
  egreso: (e) => egresoAlMotor("catastro", e),
  alertas: () => [alertaDeCaida("catastro")],
  panel: (): PanelDeclarado => ({ nombre: "catastro", json: { title: "Catastro", panels: [] } }),
  claves: (): ClaveDeclarada[] => [
    { nombre: "catastro-app", clave: "clave", rol: "catastro_app", rotacion: "trimestral", proposito: "la conexion de la aplicacion" },
  ],
};

/** `rentas`: **dos** perfiles, `web` y `batch`. El caso que el contrato tiene que aguantar. */
export const rentas: DescriptorDeSistema = {
  sistema: "rentas",
  prefijo: "rentas",
  imagenes: ["rentas"],
  baseDeDatos(): BaseDeDatosDeclarada {
    return {
      nombre: "rentas",
      roles: [
        { nombre: "rentas_owner", sobre: ["rentas"], privilegios: ["ALL"], superusuario: false },
        { nombre: "rentas_app", sobre: ["rentas"], privilegios: ["SELECT", "INSERT", "UPDATE"], superusuario: false },
      ],
    };
  },
  despliegue: (e) => [...despliegueDe("rentas", "web", e, "rentas"), ...despliegueDe("rentas", "batch", e, "rentas", false)],
  migracion: (e) => migracionDe("rentas", e, "rentas"),
  implantacion: (e) => implantacionDe("rentas", e, "rentas"),
  lotes: (e) => loteDe("rentas", e, "rentas"),
  ingreso: (e) => ingresoDe("rentas", "rentas", e),
  egreso: (e) => egresoAlMotor("rentas", e),
  alertas: () => [alertaDeCaida("rentas")],
  panel: (): PanelDeclarado => ({ nombre: "rentas", json: { title: "Rentas", panels: [] } }),
  claves: (): ClaveDeclarada[] => [
    { nombre: "rentas-app", clave: "clave", rol: "rentas_app", rotacion: "trimestral", proposito: "la conexion de la aplicacion" },
  ],
};
