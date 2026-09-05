import { commonLabels, resourceName, type Environment } from "../config";
import {
  BASE_DEL_PADRON,
  CLAVES,
  type TablaDeRecursos,
  nombreDePrioridad,
  secretos,
  seguridadSinRoot,
  servicioDeBaseDeDatos,
  urlDelPadron,
} from "./convenciones";
import type { Contenedor, Job, Manifiesto, VariableDeEntorno } from "./tipos";

/**
 * Migracion e implantacion como Jobs (issue #150).
 *
 * Traslada al clúster el orden que hoy sostiene el compose:
 *
 * ```
 *   base ──(sana)──► migracion ──(termina)──► implantacion ──(termina)──► aplicacion
 * ```
 *
 * ## Como se traduce `service_completed_successfully`
 *
 * En el compose ese orden lo garantiza Docker. En Kubernetes **no hay equivalente**: un
 * `Deployment` no sabe esperar a un `Job`. Las dos formas de conseguirlo son un
 * contenedor de inicializacion que consulte el API de Kubernetes —lo que exige una
 * cuenta de servicio con permiso para leer Jobs— o uno que **consulte la base**.
 *
 * Se elige consultar la base, y no por ahorrarse el RBAC:
 *
 * > Un `Job` marcado como completado no es lo mismo que un esquema aplicado. Preguntarle
 * > al API de Kubernetes si el Job termino comprueba el manifiesto; preguntarle a la
 * > base si el esquema esta ahi comprueba **lo que corre**. Es la misma distincion que
 * > hacen las nueve comprobaciones de `despliegue.yml`, que leen las credenciales del
 * > proceso en marcha y no del archivo del compose.
 *
 * Ademas no necesita credenciales nuevas: la espera se hace con las de `sgtm_app`, que
 * el pod que espera ya tiene.
 *
 * ## `sgtm_owner` no entra en el Deployment
 *
 * El `Secret` con la clave de `sgtm_owner` se monta **solo** en estos dos Jobs. La
 * auditoria de `auditoria.ts` lo exige leyendo los manifiestos, y la comprobacion 7 del
 * despliegue lo comprueba contra el proceso en marcha: con las credenciales que el
 * contenedor tiene de verdad, `CREATE TABLE` tiene que fallar. Su traslado esta en
 * `verificaciones/motor/verificar-el-motor.sh`, que lo ejecuta contra el motor que
 * levantan estos mismos manifiestos.
 *
 * ## Idempotencia, y por que el nombre lleva la version
 *
 * Un `Job` de Kubernetes es inmutable: su plantilla de pod no se puede modificar. Si el
 * nombre no cambiara, `pulumi up` con una version nueva fallaria al intentar
 * actualizarlo. Por eso el nombre lleva la version que corre, y una version nueva crea
 * un Job nuevo. Volver a aplicar la **misma** version no crea nada: el Job ya existe, ya
 * termino, y ni el migrador ni la implantacion aplican nada si no falta nada —los dos
 * son idempotentes y tienen su prueba que lo demuestra—.
 */

export interface MigracionArgs {
  environment: Environment;
  namespace: string;
  /** La tabla del perfil de recursos de este ambiente (`C-19`). */
  recursos: TablaDeRecursos;
  /** Repositorio de las imagenes, sin etiqueta (`ADR-0011` §5). */
  imageRepository: string;
  /** La version con que se crean los Jobs. Ver `Aplicacion.ts` sobre de donde sale. */
  version: string;
  /** Imagen de PostgreSQL: la usan los contenedores de espera, por su `psql`. */
  postgresImage: string;
  implantacion: DatosDeImplantacion;
}

/** Lo que el perfil `batch` necesita para dar de alta la municipalidad. */
export interface DatosDeImplantacion {
  ubigeo: string;
  nombre: string;
  tipo: "DISTRITAL" | "PROVINCIAL";
  administrador: string;
  nombreDelAdministrador: string;
  /** `INF-03` §3.2. Solo se aplica al alta: no le quita la marca a una ya implantada. */
  esDemostracion: boolean;
}

/** Un sufijo corto y estable para el nombre del Job, valido como nombre de recurso. */
export function sufijoDeVersion(version: string): string {
  const limpio = version.toLowerCase().replace(/[^a-z0-9]/g, "");
  return limpio.slice(0, 12) || "sinversion";
}

/**
 * El contenedor que espera a que el esquema este aplicado.
 *
 * `flyway_schema_history` con al menos una fila y ninguna fallida. La consulta se hace
 * como `sgtm_app`, que **no puede crear la tabla**: si la ve, la creo el migrador.
 */
export function esperaDeMigracion(args: {
  environment: Environment;
  postgresImage: string;
  recursos: TablaDeRecursos;
}): Contenedor {
  return contenedorDeEspera({
    nombre: "espera-migracion",
    environment: args.environment,
    postgresImage: args.postgresImage,
    recursos: args.recursos,
    consulta:
      "SELECT 1 FROM flyway_schema_history WHERE success ORDER BY installed_rank DESC LIMIT 1",
    queEspera: "el esquema aplicado por el Job de migracion",
  });
}

/**
 * El contenedor que espera a que la municipalidad este dada de alta.
 *
 * Es lo que impide el estado que este orden existe para evitar: la aplicacion sirviendo
 * peticiones sobre una base sin implantar. Sin el, el pod arranca, responde a la sonda y
 * se declara sano sin municipalidad ninguna.
 */
export function esperaDeImplantacion(args: {
  environment: Environment;
  postgresImage: string;
  recursos: TablaDeRecursos;
}): Contenedor {
  return contenedorDeEspera({
    nombre: "espera-implantacion",
    environment: args.environment,
    postgresImage: args.postgresImage,
    recursos: args.recursos,
    consulta: "SELECT 1 FROM municipalidad LIMIT 1",
    queEspera: "la municipalidad dada de alta por el Job de implantacion",
  });
}

/**
 * El contenedor que espera a que postgres acepte conexiones, sin credenciales.
 *
 * `pg_isready` no autentica: solo abre el socket. Existe porque el migrador se conecta
 * apenas arranca la JVM, sin reintento propio, y eso le hace perder la carrera contra la
 * propagacion de la NetworkPolicy de un pod recien creado -confirmado contra el clúster
 * real de stg (issue #158): la primera conexion de un pod nuevo con `app: migracion`
 * fallaba con "Connection refused" en los siete primeros intentos del Job, y la misma
 * conexion con tres segundos de espera funcionaba siempre. Como cada reintento del Job
 * crea un pod nuevo -IP nueva, politica que reprogramar de cero-, el migrador perdia la
 * carrera casi siempre y el Job agotaba su `backoffLimit` sin correr una sola migracion.
 */
function esperaDePostgres(args: {
  environment: Environment;
  postgresImage: string;
  recursos: TablaDeRecursos;
}): Contenedor {
  const servicio = servicioDeBaseDeDatos(args.environment);
  return {
    name: "espera-postgres",
    image: args.postgresImage,
    command: ["/bin/sh", "-c"],
    args: [
      [
        "set -eu",
        `echo "Esperando que ${servicio} acepte conexiones..."`,
        `until pg_isready --host=${servicio} --quiet; do`,
        "  sleep 3",
        "done",
      ].join("\n"),
    ],
    securityContext: seguridadSinRoot({ runAsUser: 70 }),
    resources: args.recursos.auxiliar,
  };
}

function contenedorDeEspera(args: {
  nombre: string;
  environment: Environment;
  postgresImage: string;
  consulta: string;
  queEspera: string;
  recursos: TablaDeRecursos;
}): Contenedor {
  const { environment } = args;
  const secreto = secretos(environment);
  const servicio = servicioDeBaseDeDatos(environment);

  return {
    name: args.nombre,
    image: args.postgresImage,
    command: ["/bin/sh", "-c"],
    args: [
      [
        "set -eu",
        `echo "Esperando ${args.queEspera}..."`,
        // Sin limite de intentos a proposito: el pod se queda en `Init`, que es
        // exactamente el estado que hay que ver. Un contenedor que se rinde y deja
        // arrancar al de al lado convertiria un despliegue incompleto en un servicio
        // que responde mal.
        `until psql --username=sgtm_app --dbname=${BASE_DEL_PADRON} --host=${servicio} ` +
          `--quiet --tuples-only --no-align --command "${args.consulta}" >/dev/null 2>&1; do`,
        "  sleep 3",
        "done",
        `echo "Listo: ${args.queEspera}."`,
      ].join("\n"),
    ],
    env: [
      {
        name: "PGPASSWORD",
        valueFrom: { secretKeyRef: { name: secreto.aplicacion, key: CLAVES.aplicacion } },
      },
    ],
    // Solo habla `psql` por la red -no lee PGDATA, ni nada que necesite coincidir
    // con un UID del volumen-: el caso simple de `seguridadSinRoot` (issue #157).
    //
    // `runAsUser: 70`: a diferencia del contenedor de postgres de verdad (que arranca
    // como root para el `chown`/`gosu` del volumen, ver BaseDeDatos.ts), este solo
    // ejecuta `psql` como cliente y no necesita nada de eso — pero `postgres:16-alpine`
    // arranca como root por omision, y `runAsNonRoot` sin UID explicito lo rechaza
    // (issue #158: encontrado reconstruyendo un cluster real desde cero. `70` es el UID
    // de `postgres` en esta imagen, confirmado corriendola: `id postgres`).
    securityContext: seguridadSinRoot({ runAsUser: 70 }),
    resources: args.recursos.auxiliar,
  };
}

export function manifiestosDeMigracion(args: MigracionArgs): Manifiesto[] {
  const { environment, namespace, imageRepository, version, postgresImage, implantacion } = args;
  const { recursos } = args;
  const sufijo = sufijoDeVersion(version);
  const secreto = secretos(environment);

  const migracion: Job = {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: `${resourceName(environment, "migracion")}-${sufijo}`,
      namespace,
      labels: { ...commonLabels(environment, "migracion"), version: sufijo },
    },
    spec: {
      // Tres intentos: los fallos tipicos —la base todavia no acepta conexiones, un
      // reinicio del nodo a mitad— se resuelven reintentando. Un fallo real de
      // migracion falla las tres veces, y entonces el despliegue queda rojo.
      backoffLimit: 3,
      template: {
        metadata: { labels: { ...commonLabels(environment, "migracion"), app: "migracion" } },
        spec: {
          restartPolicy: "Never",
          priorityClassName: nombreDePrioridad(environment, "lote"),
          initContainers: [esperaDePostgres({ environment, postgresImage, recursos })],
          containers: [
            {
              name: "migrador",
              image: `${imageRepository}/sgtm-migrador:${version}`,
              env: [
                { name: "KAMAYUK_DB_URL", value: urlDelPadron(environment) },
                { name: "KAMAYUK_DB_OWNER_USUARIO", value: "sgtm_owner" },
                // El unico sitio, con el Job de al lado, donde entra esta clave.
                {
                  name: "KAMAYUK_DB_OWNER_CLAVE",
                  valueFrom: { secretKeyRef: { name: secreto.owner, key: CLAVES.owner } },
                },
              ],
              // `USER 10002` en el propio Dockerfile del migrador (issue #157): la
              // imagen ya no corre como root, esto solo lo declara.
              securityContext: seguridadSinRoot(),
              resources: recursos.arranque,
            },
          ],
        },
      },
    },
  };

  const variablesDeImplantacion: VariableDeEntorno[] = [
    { name: "SPRING_PROFILES_ACTIVE", value: "batch" },
    { name: "KAMAYUK_DB_URL", value: urlDelPadron(environment) },
    { name: "KAMAYUK_DB_USUARIO", value: "sgtm_app" },
    {
      name: "KAMAYUK_DB_CLAVE",
      valueFrom: { secretKeyRef: { name: secreto.aplicacion, key: CLAVES.aplicacion } },
    },
    { name: "KAMAYUK_IMPLANTACION_UBIGEO", value: implantacion.ubigeo },
    { name: "KAMAYUK_IMPLANTACION_NOMBRE", value: implantacion.nombre },
    { name: "KAMAYUK_IMPLANTACION_TIPO", value: implantacion.tipo },
    // No crea ninguna contrasena: la credencial vive en Keycloak, y esta cuenta tiene
    // que ser la misma que exista alli.
    { name: "KAMAYUK_IMPLANTACION_ADMINISTRADOR", value: implantacion.administrador },
    {
      name: "KAMAYUK_IMPLANTACION_NOMBREDELADMINISTRADOR",
      value: implantacion.nombreDelAdministrador,
    },
    { name: "KAMAYUK_IMPLANTACION_ESDEMOSTRACION", value: String(implantacion.esDemostracion) },
    { name: "KAMAYUK_IMPLANTACION_URL", value: urlDelPadron(environment) },
    // OWNERCLAVE sin guion bajo: en una variable de entorno el `_` se traduce a punto,
    // asi que KAMAYUK_IMPLANTACION_OWNER_CLAVE seria `kamayuk.implantacion.owner.clave` y no
    // `owner-clave`. Es la misma nota que lleva el compose, y por el mismo motivo.
    {
      name: "KAMAYUK_IMPLANTACION_OWNERCLAVE",
      valueFrom: { secretKeyRef: { name: secreto.owner, key: CLAVES.owner } },
    },
  ];

  const implantacionJob: Job = {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name: `${resourceName(environment, "implantacion")}-${sufijo}`,
      namespace,
      labels: { ...commonLabels(environment, "implantacion"), version: sufijo },
    },
    spec: {
      backoffLimit: 3,
      template: {
        metadata: { labels: { ...commonLabels(environment, "implantacion"), app: "implantacion" } },
        spec: {
          restartPolicy: "Never",
          priorityClassName: nombreDePrioridad(environment, "lote"),
          initContainers: [esperaDeMigracion({ environment, postgresImage, recursos })],
          containers: [
            {
              name: "implantacion",
              // La MISMA imagen que la aplicacion, con el perfil `batch` (`ADR-0003`:
              // un artefacto, dos perfiles). No abre puerto ninguno.
              image: `${imageRepository}/sgtm-aplicacion:${version}`,
              env: variablesDeImplantacion,
              // `USER 10001` en el Dockerfile, la misma imagen que `aplicacion` (issue #157).
              securityContext: seguridadSinRoot(),
              resources: recursos.arranque,
            },
          ],
        },
      },
    },
  };

  return [migracion, implantacionJob];
}
