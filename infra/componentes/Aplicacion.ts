import { commonLabels, resourceName, type Environment } from "../config";
import {
  CLAVES,
  type TablaDeRecursos,
  emisorPublico,
  jwksInterno,
  nombreDePrioridad,
  secretos,
  seguridadSinRoot,
  servicioDeAplicacion,
  servicioDeInterfaz,
  sondaHttp,
  urlDelPadron,
} from "./convenciones";
import { nginxConf } from "./fuentes";
import { realmDelCiudadano } from "./Identidad";
import { esperaDeImplantacion } from "./Migracion";
import type { ConfigMap, CronJob, Deployment, Manifiesto, Service } from "./tipos";

/**
 * La aplicacion y la interfaz en el clúster (issue #152).
 *
 * Es el issue que hace que el sistema **este servido** desde el VPS: el perfil `web`
 * detras de sus sondas, la interfaz sirviendo los estaticos y reenviando `/api/v1`, y el
 * perfil `batch` como CronJob con su ventana.
 *
 * ## Sin `SGTM_OIDC_EMISOR` no arranca, y no se «arregla»
 *
 * La variable no lleva valor por omision ni aqui ni en `application.yaml`, y eso **es**
 * la decision: un backend que atiende peticiones sin poder validar un token responde a
 * la sonda, se declara sano y no atiende a nadie. La comprobacion 8 de `despliegue.yml`
 * lo verifica arrancando la imagen sin la variable; aqui, lo que se puede comprobar sin
 * clúster es que el manifiesto la declara —lo hace `auditoria.ts`—, y contra el proceso
 * en marcha vuelve a comprobarse en el VPS.
 *
 * ## El navegador no habla con el backend
 *
 * La interfaz sirve los estaticos y reenvia `/api/v1` al servicio de la aplicacion, y de
 * ahi que no haya CORS que configurar ni un segundo origen que autorizar en Keycloak.
 * El `nginx.conf` es **el del repositorio**, con el nombre del servicio cambiado: la
 * imagen trae el suyo apuntando al `aplicacion` de la red del compose.
 *
 * ## La emision masiva y la ventanilla comparten CPU
 *
 * Aqui no hay nodo dedicado al perfil `batch` como en el SRTM: hay un VPS. Lo que hay
 * son limites de recursos, una clase de prioridad por debajo de todo lo demas y una
 * ventana horaria. La consecuencia —una emision grande degrada la atencion— esta escrita
 * en `INF-01` §2, que es donde tiene que estar para no descubrirse el dia de la emision.
 */

export interface AplicacionArgs {
  environment: Environment;
  namespace: string;
  /** La tabla del perfil de recursos de este ambiente (`C-19`). */
  recursos: TablaDeRecursos;
  imageRepository: string;
  /** La version de las imagenes. Ver «la frontera» mas abajo. */
  version: string;
  /** Imagen de PostgreSQL: la usa el contenedor de espera, por su `psql`. */
  postgresImage: string;
  webReplicas: number;
  domain: string;
  realm: string;
}

/**
 * La ventana del perfil `batch`: 02:00, hora de Peru (UTC-5), es decir 07:00 UTC.
 *
 * Fuera de la ventana de atencion, y a proposito: con un solo nodo, lo que corre de
 * madrugada no compite con la ventanilla.
 */
export const VENTANA_DE_LOTE = "0 7 * * *";

export function manifiestosDeAplicacion(args: AplicacionArgs): Manifiesto[] {
  const { environment, namespace, imageRepository, version, postgresImage } = args;
  const { webReplicas, domain, realm, recursos } = args;
  const secreto = secretos(environment);
  const nombreDeLaAplicacion = servicioDeAplicacion(environment);
  const nombreDeLaInterfaz = servicioDeInterfaz(environment);
  const etiquetasDeLaAplicacion = commonLabels(environment, "aplicacion");
  const etiquetasDeLaInterfaz = commonLabels(environment, "interfaz");

  const credencialesDeLaBase = [
    { name: "SGTM_DB_URL", value: urlDelPadron(environment) },
    // `sgtm_app` y solo `sgtm_app`. La clave de `sgtm_owner` no entra en este
    // Deployment: darle DDL sobre el padron de todas las municipalidades a un proceso
    // expuesto en HTTP es exactamente lo que ARQ-03 §4 excluye, y la auditoria de
    // `auditoria.ts` se pone roja si el `Secret` de owner aparece por aqui.
    { name: "SGTM_DB_USUARIO", value: "sgtm_app" },
    {
      name: "SGTM_DB_CLAVE",
      valueFrom: { secretKeyRef: { name: secreto.aplicacion, key: CLAVES.aplicacion } },
    },
  ];

  const aplicacion: Deployment = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: nombreDeLaAplicacion, namespace, labels: etiquetasDeLaAplicacion },
    spec: {
      replicas: webReplicas,
      // `RollingUpdate` —la aplicacion no monta volumen— pero con `maxSurge: 0`: el
      // rollout mata el pod viejo ANTES de crear el nuevo, no despues.
      //
      // El default de Kubernetes (`maxSurge: 25%`, que para una replica redondea a 1)
      // levanta un segundo pod de `aplicacion` mientras el viejo sigue en pie. En
      // `prod` —un solo nodo, una replica— ese segundo pod de la JVM no cabe: se
      // queda `Pending` con `Insufficient cpu` y a los diez minutos el Deployment se
      // da por vencido (`ProgressDeadlineExceeded`) y el `pulumi up` entero falla.
      // Paso de verdad el 2026-08-27, al subir `applicationBootstrapVersion`.
      //
      // Con `maxSurge: 0` no hace falta holgura para un pod de mas: hay unos segundos
      // sin backend por despliegue —aceptable para una marcha blanca de una replica—,
      // y si algun dia `webReplicas > 1`, `maxUnavailable: 1` lo sigue rodando de a
      // uno.
      strategy: {
        type: "RollingUpdate",
        rollingUpdate: { maxSurge: 0, maxUnavailable: 1 },
      },
      selector: { matchLabels: { app: nombreDeLaAplicacion } },
      template: {
        metadata: { labels: { ...etiquetasDeLaAplicacion, app: nombreDeLaAplicacion } },
        spec: {
          priorityClassName: nombreDePrioridad(environment, "servicio"),
          // Un esquema a medias con la aplicacion ya sirviendo peticiones es el estado
          // que este orden existe para impedir (issue #150).
          initContainers: [esperaDeImplantacion({ environment, postgresImage, recursos })],
          containers: [
            {
              name: "aplicacion",
              image: `${imageRepository}/sgtm-aplicacion:${version}`,
              ports: [{ name: "http", containerPort: 8080 }],
              env: [
                { name: "SPRING_PROFILES_ACTIVE", value: "web" },
                // El emisor: identidad publica, la misma que Keycloak pone en el `iss`.
                { name: "SGTM_OIDC_EMISOR", value: emisorPublico(domain, realm) },
                // Las claves: direccion de red interna. No sale al ingreso para volver
                // a entrar.
                { name: "SGTM_OIDC_JWKS", value: jwksInterno(environment, realm) },
                // Y los del realm del CIUDADANO (ADR-0020), con el mismo reparto:
                // el emisor es una identidad —es lo que se compara con el `iss` y
                // lo que hace que un token de funcionario no valga en el portal— y
                // el JWKS es una direccion de red interna.
                //
                // A diferencia del de arriba, este **si puede faltar**: una
                // instalacion sin portal del contribuyente es legitima, y entonces
                // la cadena de `/api/v1/portal/**` lo niega todo. Aqui se declara
                // porque el realm se reconcilia en el mismo Job que el otro.
                {
                  name: "SGTM_PORTAL_OIDC_EMISOR",
                  value: emisorPublico(domain, realmDelCiudadano(realm)),
                },
                {
                  name: "SGTM_PORTAL_OIDC_JWKS",
                  value: jwksInterno(environment, realmDelCiudadano(realm)),
                },
                ...credencialesDeLaBase,
              ],
              // `USER 10001` en el Dockerfile (issue #157): sin root desde antes de
              // este manifiesto, esto solo lo declara.
              securityContext: seguridadSinRoot(),
              resources: recursos.aplicacionWeb,
              // La JVM tarda en arrancar —el compose le da `start_period: 30s`—, y el
              // `startupProbe` es la forma de decirlo sin aflojar la sonda de vida:
              // hasta dos minutos para arrancar, y despues tres fallos seguidos matan.
              startupProbe: sondaHttp("/actuator/health", 8080, {
                periodSeconds: 5,
                failureThreshold: 24,
              }),
              readinessProbe: sondaHttp("/actuator/health", 8080, { failureThreshold: 3 }),
              livenessProbe: sondaHttp("/actuator/health", 8080, {
                periodSeconds: 20,
                failureThreshold: 5,
              }),
            },
          ],
        },
      },
    },
  };

  const servicioDeLaAplicacion: Service = {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: nombreDeLaAplicacion, namespace, labels: etiquetasDeLaAplicacion },
    spec: {
      type: "ClusterIP",
      selector: { app: nombreDeLaAplicacion },
      ports: [{ name: "http", port: 8080, targetPort: 8080 }],
    },
  };

  const configuracionDeNginx: ConfigMap = {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: resourceName(environment, "interfaz-nginx"),
      namespace,
      labels: etiquetasDeLaInterfaz,
    },
    data: { "default.conf": nginxDelCluster(environment) },
  };

  const interfaz: Deployment = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: nombreDeLaInterfaz, namespace, labels: etiquetasDeLaInterfaz },
    spec: {
      replicas: 2,
      strategy: { type: "RollingUpdate" },
      selector: { matchLabels: { app: nombreDeLaInterfaz } },
      template: {
        metadata: { labels: { ...etiquetasDeLaInterfaz, app: nombreDeLaInterfaz } },
        spec: {
          priorityClassName: nombreDePrioridad(environment, "servicio"),
          containers: [
            {
              name: "interfaz",
              // Una imagen por ambiente, y no es un descuido: Vite resuelve las
              // `VITE_SGTM_OIDC_*` AL COMPILAR, asi que el emisor queda incrustado en
              // el paquete estatico. La etiqueta la pone `publicar-imagenes.yml`.
              image: `${imageRepository}/sgtm-interfaz:${environment}-${version}`,
              ports: [{ name: "http", containerPort: 8080 }],
              // `USER nginx` en el Dockerfile (issue #157): la imagen base de nginx
              // arranca como root por omision -el pid y la cache de nginx los
              // necesita root para escribir-, y `frontend/Dockerfile` se lo cede al
              // usuario "nginx" que la propia imagen ya trae sin usar.
              //
              // `runAsUser: 101`: `nginx` es un NOMBRE, no un numero, y el kubelet
              // rechaza el contenedor sin poder verificar que es no-root -el mismo
              // fallo que ya se encontro en CI para Prometheus/Alertmanager/
              // node-exporter/kube-state-metrics (todas imagenes de terceros con
              // `USER nobody`), aqui contra la imagen propia-. 101 es el UID/GID con
              // que la imagen base `nginx:1.31-alpine` crea a "nginx".
              securityContext: seguridadSinRoot({ runAsUser: 101 }),
              resources: recursos.interfaz,
              volumeMounts: [
                {
                  name: "configuracion",
                  mountPath: "/etc/nginx/conf.d/default.conf",
                  subPath: "default.conf",
                  readOnly: true,
                },
              ],
              // La sonda va por HTTP contra la IP del pod, que es lo que hace el
              // kubelet, y no contra un nombre: la configuracion que se monta declara
              // `listen 8080` a secas —solo IPv4—, y en el compose eso ya costo un
              // contenedor «unhealthy» para siempre con nginx sirviendo al lado,
              // porque `localhost` resolvia ::1 primero.
              readinessProbe: sondaHttp("/", 8080, { failureThreshold: 3 }),
              livenessProbe: sondaHttp("/", 8080, { periodSeconds: 20, failureThreshold: 5 }),
            },
          ],
          volumes: [{ name: "configuracion", configMap: { name: configuracionDeNginx.metadata.name } }],
        },
      },
    },
  };

  const servicioDeLaInterfaz: Service = {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: nombreDeLaInterfaz, namespace, labels: etiquetasDeLaInterfaz },
    spec: {
      type: "ClusterIP",
      selector: { app: nombreDeLaInterfaz },
      ports: [{ name: "http", port: 8080, targetPort: 8080 }],
    },
  };

  const lote: CronJob = {
    apiVersion: "batch/v1",
    kind: "CronJob",
    metadata: {
      name: resourceName(environment, "lote"),
      namespace,
      labels: commonLabels(environment, "lote"),
    },
    spec: {
      schedule: VENTANA_DE_LOTE,
      // **Suspendido, y a proposito.** Hoy no hay ninguna tarea de lote que correr:
      // mientras D-02a siga abierta no hay regla de calculo, y por tanto no hay emision
      // masiva. Lo que este CronJob declara es la VENTANA y los limites con que correra
      // cuando la haya; quitarle el `suspend` sera una linea el dia que exista la
      // primera tarea. Declararla ahora es lo que impide que aparezca improvisada a las
      // diez de la manana de un dia de emision.
      suspend: true,
      // Nunca dos a la vez: dos emisiones concurrentes sobre el mismo padron es la
      // forma mas cara de descubrir que una tarea no era idempotente.
      concurrencyPolicy: "Forbid",
      successfulJobsHistoryLimit: 3,
      failedJobsHistoryLimit: 3,
      jobTemplate: {
        spec: {
          backoffLimit: 1,
          template: {
            metadata: { labels: { ...commonLabels(environment, "lote"), app: "lote" } },
            spec: {
              restartPolicy: "Never",
              priorityClassName: nombreDePrioridad(environment, "lote"),
              containers: [
                {
                  name: "lote",
                  // La MISMA imagen que el perfil `web` (`ADR-0003`: un artefacto, dos
                  // perfiles). Sin `ports`: el perfil `batch` no atiende HTTP, asi que
                  // no abre puerto ninguno y no necesita emisor de identidad.
                  image: `${imageRepository}/sgtm-aplicacion:${version}`,
                  env: [
                    { name: "SPRING_PROFILES_ACTIVE", value: "batch" },
                    ...credencialesDeLaBase,
                  ],
                  securityContext: seguridadSinRoot(),
                  resources: recursos.aplicacionLote,
                },
              ],
            },
          },
        },
      },
    },
  };

  return [
    aplicacion,
    servicioDeLaAplicacion,
    configuracionDeNginx,
    interfaz,
    servicioDeLaInterfaz,
    lote,
  ];
}

/** El nombre del servicio de la aplicacion en la red del compose. */
const APLICACION_EN_EL_COMPOSE = "http://aplicacion:8080";

/**
 * El `nginx.conf` del repositorio, con el destino del reenvio del clúster.
 *
 * Una sola linea cambia. Si el archivo del frontend dejara de tener ese destino —porque
 * alguien lo renombro—, esta funcion lanza en vez de montar una configuracion que
 * reenvia a un nombre que no existe: el sintoma seria un 502 en `/api/v1` con la
 * aplicacion sana.
 */
export function nginxDelCluster(environment: Environment): string {
  const original = nginxConf();
  if (!original.includes(APLICACION_EN_EL_COMPOSE)) {
    throw new Error(
      `«frontend/nginx.conf» ya no reenvia a ${APLICACION_EN_EL_COMPOSE}. El manifiesto de ` +
        "la interfaz cambia ese destino por el servicio del clúster; si el archivo cambio, " +
        "hay que actualizar esta funcion. Sin esto, `/api/v1` daria 502 con la aplicacion sana.",
    );
  }
  return original.replaceAll(
    APLICACION_EN_EL_COMPOSE,
    `http://${servicioDeAplicacion(environment)}:8080`,
  );
}
