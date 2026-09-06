import { namespaceName, resourceName, type Environment, type SmtpSettings } from "../config";
import {
  ETIQUETA_DE_NAMESPACE_DE_SISTEMA,
  servicioDeAlertmanager,
  servicioDeBaseDeDatos,
  servicioDeGrafana,
  servicioDeIdentidad,
  servicioDeKubeStateMetrics,
  servicioDeNodeExporter,
  servicioDePrometheus,
} from "./convenciones";
import type { Manifiesto, NetworkPolicy } from "./tipos";

/**
 * Denegacion por omision, y se abre lo necesario (issue #157).
 *
 * Un espacio de nombres entero, cubierto por una sola politica que selecciona TODOS
 * los pods (`denegar-todo`) y ninguna regla —ni entrada ni salida—, seguida de una
 * politica por cada flujo real, aditiva: Kubernetes une las reglas de todas las
 * politicas que seleccionan un pod, asi que `denegar-todo` no compite con las que
 * abren un puerto — la ausencia de regla en una no cierra lo que otra abrio.
 *
 * ## Como se leen las reglas de aqui
 *
 * Cada politica de mas abajo dice, en su propio comentario, POR QUE existe ese
 * flujo y no otro. Lo que no se hace en ningun sitio es «abrir por si acaso»: un
 * pod que hoy no necesita hablar con otro no tiene regla, y si la necesita manana
 * esta es la funcion donde se declara —nunca aflojando `denegar-todo`, que existe
 * precisamente para que ninguna excepcion sea implicita.
 *
 * ## Lo que NO cubre, y por que
 *
 * - El motor de PostgreSQL y el `CronJob` de respaldo tienen salida a **todo**
 *   `:443` (ver `permitirSalidaAlAlmacenamiento`): el proveedor de almacenamiento
 *   de objetos no esta decidido (`INF-01` §7, `D-04`), asi que no hay un `ipBlock`
 *   que fijar todavia. Acotar esto a la CIDR real del proveedor, el dia que se
 *   elija, es trabajo de ese issue, no de este.
 * - **Alertmanager** tiene la misma salida amplia a `:443`, por el mismo motivo:
 *   `alertWebhookUrl` es una URL arbitraria que la municipalidad configura, no un
 *   destino que este repositorio pueda fijar de antemano.
 * - **Keycloak (identidad)** sale al puerto del relay SMTP **solo si el ambiente
 *   declara uno** (ADR-0012). Con `keycloakSmtpHost` puesto y `stg` —buzon Mailpit
 *   del propio namespace—, la regla apunta a su `podSelector`, sin salida amplia; con
 *   un relay externo, es un `ipBlock 0.0.0.0/0` acotado a ese puerto. Sin relay
 *   (Opción B, la marcha blanca de `prod`), Keycloak no tiene ninguna regla de salida
 *   SMTP: el alta crea al usuario sin clave y no manda correo.
 * - **kube-state-metrics** tambien sale a `:443` ancho, pero por un motivo
 *   distinto: su destino SI es fijo —el API de Kubernetes—, solo que en k3s ese
 *   API no es un pod al que `podSelector`/`namespaceSelector` puedan apuntar —es
 *   el propio proceso del nodo, detras de un `Service` sin `Endpoints` de pod—, y
 *   un `ipBlock` con su IP de servicio se rompe el dia que esa IP cambie.
 *
 *   La version anterior de este archivo no le daba salida ninguna, asumiendo que
 *   sin una politica de Egress propia `denegar-todo` lo dejaba pasar. Es al reves:
 *   `denegar-todo` selecciona TODOS los pods para Egress, y sin una politica que
 *   abra algo, no queda nada abierto. Se vio contra el clúster real de `prod`: el
 *   contenedor quedaba en `CrashLoopBackOff` con `dial tcp 10.43.0.1:443: connect:
 *   connection refused` (2026-08-26).
 *
 * Las excepciones de salida amplia son deliberadas y estrechas —un puerto, TCP,
 * `:443`—, no «salida libre»: siguen sin poder alcanzar el resto del rango
 * privado del clúster ni un puerto administrativo de un tercero.
 */

interface ArgsDeRed {
  environment: Environment;
  namespace: string;
  /** El relay SMTP (ADR-0012); `undefined` = el ambiente no tiene, y Keycloak no sale a ninguno. */
  smtp?: SmtpSettings;
  /** El relay es un buzon Mailpit del propio namespace (`stg`), no uno externo. */
  correoDePrueba: boolean;
}

/** El namespace de sistema donde vive Traefik, en k3s. Kubernetes etiqueta todo namespace con este nombre desde 1.21. */
const KUBE_SYSTEM = { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } };

/** Los namespaces de los cuatro sistemas, por la etiqueta que dice que lo son. */
const DE_LOS_SISTEMAS = { namespaceSelector: { matchLabels: ETIQUETA_DE_NAMESPACE_DE_SISTEMA } };

function deApp(app: string) {
  return { podSelector: { matchLabels: { app } } };
}

function puerto(port: number, protocol: "TCP" | "UDP" = "TCP") {
  return { protocol, port };
}

function politica(
  namespace: string,
  nombre: string,
  spec: NetworkPolicy["spec"],
): NetworkPolicy {
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: { name: nombre, namespace, labels: { proyecto: "kamayuk", componente: "red" } },
    spec,
  };
}

/** La base: nada entra, nada sale, para todo pod del namespace. */
function denegarTodo(namespace: string): NetworkPolicy {
  return politica(namespace, "denegar-todo", {
    podSelector: {},
    policyTypes: ["Ingress", "Egress"],
  });
}

/**
 * DNS, para todo pod. Sin esta regla, `denegar-todo` deja a CADA pod sin poder
 * resolver un solo nombre de `Service` —ni siquiera los que solo hablan dentro del
 * propio namespace—, porque la resolucion pasa por CoreDNS, en `kube-system`.
 */
function permitirDns(namespace: string): NetworkPolicy {
  return politica(namespace, "permitir-dns", {
    podSelector: {},
    policyTypes: ["Egress"],
    egress: [
      {
        to: [{ namespaceSelector: KUBE_SYSTEM }],
        ports: [puerto(53, "TCP"), puerto(53, "UDP")],
      },
    ],
  });
}

/**
 * Lo que Traefik alcanza, y nada mas: **la unica ruta que `Ingreso.ts` publica** desde `E`.
 *
 * Eran tres —la interfaz del monolito en `/`, su API en `/api/v1` y la identidad—, cada una
 * con su politica porque `podSelector` no admite un «o» entre valores de `app`. Las dos
 * primeras se fueron con el monolito, y con ellas las politicas que seleccionaban sus pods:
 * una politica cuyo `podSelector` no casa con nadie es inerte, pero tambien es una regla que
 * nadie puede leer contra un pod real — y quien la lea creera que ese pod existe.
 */
function permitirIngresoPublico(environment: Environment, namespace: string): NetworkPolicy[] {
  const desdeTraefik = [{ namespaceSelector: KUBE_SYSTEM }];
  return [
    politica(namespace, "permitir-ingreso-identidad", {
      podSelector: { matchLabels: { app: servicioDeIdentidad(environment) } },
      policyTypes: ["Ingress"],
      ingress: [
        {
          // Traefik por la consola/login (issue #153) y el Job de `reconciliar-realm`
          // por `kcadm.sh` (`Identidad.ts`). El monolito estaba aqui por el JWKS interno
          // y se fue con `E`; los cuatro sistemas entran por `DE_LOS_SISTEMAS`, abajo.
          from: [
            ...desdeTraefik,
            deApp("realm"),
            // Y los cuatro sistemas, por el JWKS interno (C-14, punto 3). Su `issuer-uri` es el
            // publico —es lo que se compara con el `iss` del token—, pero las claves se traen por
            // la red interna: salir al ingreso para volver a entrar convierte cada validacion en
            // un viaje por Traefik. Sin esta linea, el perfil `web` de los cuatro no puede
            // descargar el JWKS y **todo token seria invalido por un motivo que no se parece a su
            // causa** (la misma trampa que anota `application.yaml`).
            DE_LOS_SISTEMAS,
          ],
          ports: [puerto(8080)],
        },
      ],
    }),
  ];
}

/**
 * Lo que llega a PostgreSQL, y de nadie mas. `verificar-red.sh` demuestra que
 * esto -y el resto de las politicas del namespace- no son decorativas quitando
 * TODAS a la vez y comprobando que la interfaz pasa a conectar: `denegar-todo` y
 * `permitir-dns` usan `podSelector: {}` -seleccionan cada pod del namespace-, asi
 * que quitar un subconjunto parcial de politicas nunca desbloquea nada (postgres
 * y la interfaz siguen seleccionados por alguna).
 */
function permitirIngresoPostgres(environment: Environment, namespace: string): NetworkPolicy {
  return politica(namespace, "permitir-ingreso-postgres", {
    podSelector: { matchLabels: { app: servicioDeBaseDeDatos(environment) } },
    policyTypes: ["Ingress"],
    ingress: [
      {
        // Los procesos que de verdad se conectan como `kamayuk_app`, `kamayuk_owner`,
        // `keycloak` o `kamayuk_respaldo`. Hasta `E` estaban ademas los cinco pods del
        // monolito —su `Deployment`, sus dos `Job` de arranque y su `CronJob` de lote—; se
        // van con el, y dejarlos nombrados haria creer que existen.
        from: [
          deApp(servicioDeIdentidad(environment)),
          deApp(resourceName(environment, "respaldo")),
          // Y los cuatro sistemas, cada uno a SU base (C-14, punto 2). Van por
          // `namespaceSelector` porque desde ADR-0031 viven en otro namespace, y un
          // `podSelector` a secas selecciona pods del MISMO —de modo que sin esto los cuatro
          // quedan sin base y el sintoma no es un error: el pod arranca, la sonda de arranque
          // no pasa nunca y `pulumi up` espera—.
          //
          // Sin `podSelector` que lo acompane, a proposito: en el namespace de un sistema TODOS
          // los pods son de ese sistema, y los cuatro se conectan como `kamayuk_app` o —solo en un
          // Job— como `kamayuk_owner`. Quien decide que puede hacer cada credencial es el motor,
          // no esta politica.
          DE_LOS_SISTEMAS,
        ],
        ports: [puerto(5432)],
      },
      {
        // El sidecar de metricas vive en el MISMO pod (issue #156): esto no es
        // trafico entre pods de verdad, pero el CNI lo filtra igual cuando pasa
        // por el `Service` en vez del `localhost` — Prometheus si pasa por ahi.
        from: [deApp(servicioDePrometheus(environment))],
        ports: [puerto(9187)],
      },
    ],
  });
}

/**
 * Keycloak: solo a su propia base (issue #158, encontrado reconstruyendo un cluster
 * real desde cero — nunca se probo un arranque de Keycloak sin el namespace ya con
 * trafico existente, y sin esta politica queda en CrashLoopBackOff indefinido:
 * `permitir-ingreso-postgres` deja entrar, pero nada dejaba salir).
 */
function permitirSalidaIdentidad(
  environment: Environment,
  namespace: string,
  smtp: SmtpSettings | undefined,
  correoDePrueba: boolean,
): NetworkPolicy[] {
  const politicas: NetworkPolicy[] = [
    politica(namespace, "permitir-salida-identidad", {
      podSelector: { matchLabels: { app: servicioDeIdentidad(environment) } },
      policyTypes: ["Egress"],
      egress: [
        { to: [deApp(servicioDeBaseDeDatos(environment))], ports: [puerto(5432)] },
        // El relay SMTP del alta declarativa de usuarios (ADR-0012). En `stg` es el
        // buzon Mailpit del propio namespace; en `prod` con relay, uno externo —solo
        // su puerto, ver el docstring del modulo—. Sin relay (Opción B), Keycloak no
        // sale a ninguno: no hay regla.
        ...(smtp === undefined
          ? []
          : [
              correoDePrueba
                ? { to: [deApp(resourceName(environment, "correo"))], ports: [puerto(smtp.port)] }
                : { to: [{ ipBlock: { cidr: "0.0.0.0/0" } }], ports: [puerto(smtp.port)] },
            ]),
      ],
    }),
  ];
  if (correoDePrueba && smtp !== undefined) {
    // El buzon Mailpit: solo Keycloak le entrega correo, por su puerto SMTP.
    politicas.push(
      politica(namespace, "permitir-ingreso-correo", {
        podSelector: { matchLabels: { app: resourceName(environment, "correo") } },
        policyTypes: ["Ingress"],
        ingress: [
          { from: [deApp(servicioDeIdentidad(environment))], ports: [puerto(smtp.port)] },
        ],
      }),
    );
  }
  return politicas;
}

/**
 * Los procesos de un solo uso de la PLATAFORMA. Hoy queda uno: el `Job` del realm.
 *
 * Eran cuatro. Los otros tres —`migracion`, `implantacion` y `lote`— eran los del monolito,
 * y se van con el (`E`). Los `Job` de migracion e implantacion de los cuatro sistemas viven
 * en el namespace de su sistema desde ADR-0031, asi que sus politicas de salida las declara
 * el descriptor de cada uno, no este componente.
 */
function permitirSalidaDeLote(environment: Environment, namespace: string): NetworkPolicy[] {
  return [
    politica(namespace, "permitir-salida-realm", {
      podSelector: { matchLabels: { app: "realm" } },
      policyTypes: ["Egress"],
      egress: [{ to: [deApp(servicioDeIdentidad(environment))], ports: [puerto(8080)] }],
    }),
  ];
}

/**
 * El almacenamiento de objetos del respaldo (issue #155), fuera del clúster. Ver
 * el docstring del modulo: sin proveedor decidido no hay `ipBlock` que fijar, asi
 * que la excepcion es un puerto —`:443`, TCP— y nada mas.
 */
function permitirSalidaAlAlmacenamiento(namespace: string, app: string): NetworkPolicy {
  return politica(namespace, `permitir-salida-${app}-a-internet`, {
    podSelector: { matchLabels: { app } },
    policyTypes: ["Egress"],
    egress: [{ to: [{ ipBlock: { cidr: "0.0.0.0/0" } }], ports: [puerto(443)] }],
  });
}

/** El motor: entra desde quien ya se admitio arriba, sale al almacenamiento de objetos. */
function permitirSalidaPostgres(environment: Environment, namespace: string): NetworkPolicy {
  return permitirSalidaAlAlmacenamiento(namespace, servicioDeBaseDeDatos(environment));
}

/** El `CronJob` de respaldo: sale al motor —para `pg_backup_start`/`stop`— y al almacenamiento. */
function permitirSalidaRespaldo(environment: Environment, namespace: string): NetworkPolicy[] {
  const app = resourceName(environment, "respaldo");
  return [
    politica(namespace, `permitir-salida-${app}`, {
      podSelector: { matchLabels: { app } },
      policyTypes: ["Egress"],
      egress: [{ to: [deApp(servicioDeBaseDeDatos(environment))], ports: [puerto(5432)] }],
    }),
    permitirSalidaAlAlmacenamiento(namespace, app),
  ];
}

/** La observabilidad: cada pieza habla con sus objetivos reales, y nadie mas. */
function politicasDeObservabilidad(environment: Environment, namespace: string): NetworkPolicy[] {
  const prometheus = servicioDePrometheus(environment);
  const alertmanager = servicioDeAlertmanager(environment);
  const nodeExporter = servicioDeNodeExporter(environment);
  const kubeStateMetrics = servicioDeKubeStateMetrics(environment);
  const postgres = servicioDeBaseDeDatos(environment);

  return [
    politica(namespace, "permitir-salida-prometheus", {
      podSelector: { matchLabels: { app: prometheus } },
      policyTypes: ["Egress"],
      egress: [
        {
          // Sin la aplicacion desde `E`: su `job_name` se fue con el monolito
          // (`Observabilidad.ts`), y los cuatro sistemas no entran en su sitio —viven en
          // otro namespace y este Prometheus raspa por nombre corto—.
          to: [deApp(postgres), deApp(nodeExporter), deApp(kubeStateMetrics)],
          ports: [puerto(9187), puerto(9100), puerto(8080)],
        },
        // El propio Traefik de k3s expone `traefik_tls_certs_not_after` en
        // `kube-system` (issue #156, `Ingreso.ts`): es la unica metrica de fuera
        // del namespace que este componente scrapea.
        { to: [{ namespaceSelector: KUBE_SYSTEM }], ports: [puerto(9100)] },
        // Sin esta, Prometheus nunca puede EMPUJAR una alerta activa hacia
        // Alertmanager -`permitir-ingreso-alertmanager` ya esperaba este lado,
        // pero las dos puntas hacen falta-. La regla no notifica a nadie aunque
        // este en FIRING: la conexion misma se cae antes de llegar.
        { to: [deApp(alertmanager)], ports: [puerto(9093)] },
      ],
    }),
    // Sin esta, Prometheus tiene salida (arriba) pero CERO entrada: `denegar-todo`
    // cubre tambien su propio pod, y `permitir-salida-grafana` solo abre el lado
    // de Grafana -las dos puntas del flujo tienen que declararse, cada una en su
    // propio pod-. Sin esto, Grafana no puede consultarlo: cada panel del tablero
    // se queda en blanco contra un CNI que aplique NetworkPolicy de verdad.
    politica(namespace, "permitir-ingreso-prometheus", {
      podSelector: { matchLabels: { app: prometheus } },
      policyTypes: ["Ingress"],
      ingress: [{ from: [deApp(servicioDeGrafana(environment))], ports: [puerto(9090)] }],
    }),
    politica(namespace, "permitir-ingreso-alertmanager", {
      podSelector: { matchLabels: { app: alertmanager } },
      policyTypes: ["Ingress"],
      ingress: [{ from: [deApp(prometheus)], ports: [puerto(9093)] }],
    }),
    permitirSalidaAlAlmacenamiento(namespace, alertmanager),
    politica(namespace, "permitir-ingreso-node-exporter", {
      podSelector: { matchLabels: { app: nodeExporter } },
      policyTypes: ["Ingress"],
      ingress: [{ from: [deApp(prometheus)], ports: [puerto(9100)] }],
    }),
    politica(namespace, "permitir-ingreso-kube-state-metrics", {
      podSelector: { matchLabels: { app: kubeStateMetrics } },
      policyTypes: ["Ingress"],
      ingress: [{ from: [deApp(prometheus)], ports: [puerto(8080)] }],
    }),
    // Salida al API de Kubernetes. Ver el docstring del modulo: mismo acotamiento
    // que `permitirSalidaAlAlmacenamiento` —el puerto, no el destino—, porque el
    // API en k3s no tiene un `Service` con `Endpoints` de pod al que apuntar.
    //
    // El puerto es 6443, NO el 443 del `Service` `kubernetes`: k3s hace DNAT hacia
    // el `Endpoints` real —el proceso del nodo en :6443— antes de que el trafico
    // llegue a la cadena donde se evalua `NetworkPolicy`, asi que la regla ve el
    // puerto de despues de la traduccion. Se comprobo contra el cluster real de
    // `prod`: con :443 el contenedor seguia en `CrashLoopBackOff` con la misma
    // `connection refused`; con :6443 conecta (2026-08-26).
    politica(namespace, `permitir-salida-${kubeStateMetrics}-al-apiserver`, {
      podSelector: { matchLabels: { app: kubeStateMetrics } },
      policyTypes: ["Egress"],
      egress: [{ to: [{ ipBlock: { cidr: "0.0.0.0/0" } }], ports: [puerto(6443)] }],
    }),
    // Grafana no tiene politica de ingreso: nadie del clúster la consume —ni
    // Traefik, que no la publica (`Observabilidad.ts`)—, y el tunel SSH con que
    // se administra no pasa por la red del pod de la forma que un `NetworkPolicy`
    // filtra.
    politica(namespace, "permitir-salida-grafana", {
      podSelector: { matchLabels: { app: servicioDeGrafana(environment) } },
      policyTypes: ["Egress"],
      egress: [{ to: [deApp(prometheus)], ports: [puerto(9090)] }],
    }),
  ];
}

export function manifiestosDeRed(args: ArgsDeRed): Manifiesto[] {
  const { environment, namespace, smtp, correoDePrueba } = args;
  if (namespace !== namespaceName(environment)) {
    throw new Error(
      `manifiestosDeRed recibio namespace «${namespace}», y el de «${environment}» es ` +
        `«${namespaceName(environment)}». Las politicas de red son las unicas que no ` +
        "reciben el namespace ya resuelto de fuera: un desajuste aqui las dejaria " +
        "seleccionando un espacio de nombres que no es el que se esta desplegando.",
    );
  }

  return [
    denegarTodo(namespace),
    permitirDns(namespace),
    ...permitirIngresoPublico(environment, namespace),
    permitirIngresoPostgres(environment, namespace),
    ...permitirSalidaIdentidad(environment, namespace, smtp, correoDePrueba),
    ...permitirSalidaDeLote(environment, namespace),
    permitirSalidaPostgres(environment, namespace),
    ...permitirSalidaRespaldo(environment, namespace),
    ...politicasDeObservabilidad(environment, namespace),
  ];
}
