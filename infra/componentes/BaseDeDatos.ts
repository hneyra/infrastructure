import { commonLabels, resourceName, type Environment } from "../config";
import {
  BASE_DE_MANTENIMIENTO,
  SISTEMAS_DEL_PRODUCTO,
  CLAVES,
  type TablaDeRecursos,
  contenedorDeDescargaDeWalg,
  montajeDeWalg,
  nombreDePrioridad,
  secretoDeCredencialesDeRespaldo,
  secretos,
  seguridadBase,
  seguridadSinRoot,
  servicioDeBaseDeDatos,
  sondaExec,
  sondaHttp,
  variablesWalg,
  volumenDeDatos,
  volumenDeWalg,
  volumenDeTmpDeWalg,
  WALG_BINARIO,
} from "./convenciones";
import {
  asignarClavesSh,
  baseDeKeycloakSh,
  crearBasesSh,
  crearRolesDeSistema,
  libExtensionesSh,
  rolDeMonitoreoSh,
  rolDeRespaldoSh,
  rolesDeLosSistemasSh,
} from "./fuentes";
import type { ConfigMap, Deployment, Manifiesto, PersistentVolumeClaim, Service } from "./tipos";

/** `postgres-exporter`, con version fijada (issue #156). */
const IMAGEN_DE_POSTGRES_EXPORTER = "prometheuscommunity/postgres-exporter:v0.15.0";

/**
 * PostgreSQL en el clúster, con los cuatro roles y el aislamiento intactos (issue #149).
 *
 * No es «una base de datos en Kubernetes»: es la base sobre la que `verificarAislamiento`
 * tiene que seguir pasando, y la unica prueba de que sigue pasando es ejecutarla contra
 * ella.
 *
 * ## Deployment, y no un operador
 *
 * El issue pedia decidir entre **CloudNativePG** y un `Deployment` simple, con la
 * consecuencia escrita. Se elige el `Deployment`, y el costo se paga entero en el issue
 * de respaldos (#155):
 *
 * | | CloudNativePG | Deployment (lo elegido) |
 * |---|---|---|
 * | Archivado continuo de WAL y PITR | De fabrica | **Hay que escribirlo** (#155) |
 * | Roles del motor | Los gestiona el operador, con su propio modelo de `Secret`s | `crear-roles.sql`, el **mismo archivo** que ya usa el compose |
 * | Piezas que operar en el nodo | El operador, sus CRD y su webhook | Ninguna de mas |
 * | Recuperacion | `Cluster` restaurado por el operador | El procedimiento de #158, escrito a mano |
 *
 * Lo que inclina la decision no es la lista: es que **el aislamiento se verifica creando
 * los cuatro roles exactamente como los crea el compose** (`ADR-0011`, alternativas). Un
 * operador que gestiona roles con su propio modelo mete una segunda forma de crear
 * `kamayuk_owner` y `kamayuk_app`, y entonces lo que verifica `verificarAislamiento` en el
 * portatil deja de ser lo que corre en la municipalidad. Con un solo nodo, ademas, el
 * operador no da lo unico que justificaria su costo —conmutacion a una replica—, porque
 * no hay segundo nodo al que conmutar (`INF-01` §1.1).
 *
 * **La consecuencia, pagada aqui.** El archivado de WAL y el PITR de #155 son trabajo
 * de este repositorio: `archive_mode`, `archive_command` y `archive_timeout` van como
 * argumentos del propio proceso `postgres` —no hay `postgresql.conf` propio, y estos
 * tres no se pueden pasar por variable de entorno—, y `archive_command` invoca el
 * binario de wal-g que un contenedor de inicializacion descarga y verifica antes de
 * que el motor arranque (`convenciones.contenedorDeDescargaDeWalg`, compartido con el
 * CronJob de respaldo base en `Respaldo.ts`).
 *
 * El rol que hace el respaldo **no es el superusuario ni `kamayuk_owner`**: es
 * `kamayuk_respaldo`, con exactamente los dos privilegios que wal-g necesita
 * —`pg_backup_start`/`pg_backup_stop`— y nada de DDL. Ese conjunto se determino
 * ejecutando `wal-g backup-push` contra un PostgreSQL real hasta encontrar el minimo
 * que no falla, no leyendo la documentacion: con solo `REPLICATION` falla el permiso
 * sobre `pg_backup_start`; sin `pg_read_all_settings` falla leyendo `data_directory`.
 * El guion que lo crea es `inicializacion/40-rol-de-respaldo.sh`.
 *
 * ## Lo que no se reinventa
 *
 * Los guiones de inicializacion son **los archivos del repositorio**, no copias:
 * `crear-roles.sql` del modulo del esquema, `20-asignar-claves.sh` del compose, y
 * `40-rol-de-respaldo.sh` de aqui mismo. Corren en orden alfabetico, una sola vez,
 * cuando el volumen esta vacio — igual que en el compose, porque una politica de
 * `V6__rls.sql` los nombra y **un rol no puede crearse a si mismo**.
 */

export interface BaseDeDatosArgs {
  environment: Environment;
  namespace: string;
  /** La tabla del perfil de recursos de este ambiente (`C-19`). */
  recursos: TablaDeRecursos;
  /** Imagen de PostgreSQL con su version fijada. Sale de `config.ts`. */
  image: string;
  /** Tamano del volumen. Es disco local del nodo: no crece solo (`INF-01` §5). */
  storageSize: string;
  /** El respaldo continuo (issue #155): destino, y el RPO escrito en configuracion. */
  backup: {
    /** El `AWS_ENDPOINT` de wal-g: el almacenamiento de objetos, FUERA del VPS. */
    endpoint: string;
    /** El `AWS_REGION` de wal-g. Obligatorio contra un S3 real (issue #158). */
    region: string;
    /** El contenedor. `WALG_S3_PREFIX` sale de aqui: `s3://<bucket>`. */
    bucket: string;
    /** `archive_timeout`, en segundos. Es RNF-076 escrito en el proceso del motor. */
    walArchiveTimeoutSeconds: number;
  };
}

/**
 * Dentro del volumen, y no en su raiz: `lost+found` de un ext4 impide el `initdb`.
 *
 * Exportado: `Respaldo.ts` monta el MISMO volumen —de solo lectura— en la MISMA
 * ruta, y wal-g exige que el `PGDATA` que se le pasa coincida textualmente con el
 * `data_directory` que reporta el motor en marcha (comprobado contra un PostgreSQL
 * real: con una ruta distinta, `backup-push` falla antes de tocar un archivo).
 */
export const DIRECTORIO_DE_DATOS = "/var/lib/postgresql/data/pgdata";

export function manifiestosDeBaseDeDatos(args: BaseDeDatosArgs): Manifiesto[] {
  const { recursos } = args;
  const { environment, namespace, image, storageSize, backup } = args;
  const nombre = servicioDeBaseDeDatos(environment);
  const etiquetas = commonLabels(environment, "postgres");
  const secreto = secretos(environment);
  const credenciales = secretoDeCredencialesDeRespaldo(environment);

  const inicializacion: ConfigMap = {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: resourceName(environment, "postgres-inicializacion"),
      namespace,
      labels: etiquetas,
    },
    data: {
      // El orden alfabetico es el orden de ejecucion. Es el mismo que en el compose.
      //
      // Los dos primeros son de C-14, punto 2, y cierran el hueco 3 de C-7: hasta entonces
      // NADA creaba las cuatro bases del producto ni sus roles en el cluster —`baseDeDatos()`
      // de los cuatro descriptores existia y solo se usaba para auditar—, asi que los cuatro
      // `Deployment` apuntaban a `jdbc:postgresql://postgres:5432/<sistema>` y esa base no
      // existia.
      //
      // **Ya no hay `10-crear-roles.sql`** (`E`). Era el del monolito, y hacia tres cosas: crear
      // los cuatro roles del cluster, concederles `USAGE`/`CREATE` sobre el `public` de la base
      // por omision, e instalar cuatro extensiones ahi. Las dos ultimas eran de una base que
      // ya no usa nadie; la primera la hace `06`, porque el `crear-roles.sql` de CADA sistema
      // crea los mismos roles con `IF NOT EXISTS` y `06` corre antes que el `10` corria. Que
      // los roles siguen apareciendo no se razona: lo ejecuta `verificar-el-motor.sh
      // --con-aislamiento`, que levanta el motor con EXACTAMENTE estos guiones.
      "05-crear-bases.sh": crearBasesSh(),
      "06-roles-de-los-sistemas.sh": rolesDeLosSistemasSh(),
      "20-asignar-claves.sh": asignarClavesSh(),
      "30-base-de-keycloak.sh": baseDeKeycloakSh(),
      "40-rol-de-respaldo.sh": rolDeRespaldoSh(),
      "50-rol-de-monitoreo.sh": rolDeMonitoreoSh(),
    },
  };

  /**
   * Lo que los dos guiones nuevos LEEN, y que por eso NO puede caer en
   * `docker-entrypoint-initdb.d`.
   *
   * Todo `.sql` que caiga alli lo **ejecuta** el entrypoint contra la base por omision. Los
   * cuatro `crear-roles.sql` hay que leerlos —para derivar las extensiones— y aplicarlos **cada
   * uno contra su base**; ejecutados contra `postgres` crearian ahi las extensiones de todos y
   * ninguna donde toca, que es justo al reves de lo que C-10 decidio. Es el mismo reparto que el
   * compose ya hace con sus dos montajes.
   */
  const deLosSistemas: ConfigMap = {
    apiVersion: "v1",
    kind: "ConfigMap",
    metadata: {
      name: resourceName(environment, "postgres-roles-de-los-sistemas"),
      namespace,
      labels: etiquetas,
    },
    data: {
      "lib-extensiones.sh": libExtensionesSh(),
      // Un archivo por sistema, y el NOMBRE es el de la base: de estos nombres sale la lista de
      // bases que los dos guiones crean y provisionan. Anadir un sistema es anadir una linea
      // aqui, no editar ningun guion.
      // La clave es PLANA —`rentas.sql`— y el subdirectorio lo pone el `path` del volumen:
      // una clave de `ConfigMap` solo admite `[-._a-zA-Z0-9]+` y una barra no cabe. El nombre
      // sin extension es el de la base, que es de donde los dos guiones sacan la lista.
      ...Object.fromEntries(SISTEMAS_DEL_PRODUCTO.map((s) => [`${s}.sql`, crearRolesDeSistema(s)])),
    },
  };

  const volumen: PersistentVolumeClaim = {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: { name: volumenDeDatos(environment), namespace, labels: etiquetas },
    spec: {
      // `ReadWriteOnce`, que es lo unico que da el almacenamiento local de un nodo, y
      // lo que obliga a `Recreate` mas abajo.
      accessModes: ["ReadWriteOnce"],
      resources: { requests: { storage: storageSize } },
    },
  };

  // Las usan `archive_command` y `restore_command` —procesos hijos del propio
  // `postgres`, que las heredan—. `40-rol-de-respaldo.sh` no las necesita: crea el
  // rol, no invoca wal-g.
  const variablesDeWalg = variablesWalg({ backup, credenciales, secretoDeRespaldo: secreto.respaldo });

  const motor: Deployment = {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: nombre, namespace, labels: etiquetas },
    spec: {
      replicas: 1,
      // `Recreate`, nunca `RollingUpdate`: el segundo pod montaria el mismo volumen
      // `ReadWriteOnce`, no conseguiria el bloqueo del directorio de datos y el
      // despliegue se quedaria colgado con la base parada. Cicatriz de `../iaac`,
      // anotada en `INF-01` §4.
      strategy: { type: "Recreate" },
      selector: { matchLabels: { app: nombre } },
      template: {
        metadata: { labels: { ...etiquetas, app: nombre } },
        spec: {
          priorityClassName: nombreDePrioridad(environment, "datos"),
          // Descarga y verifica wal-g ANTES de que el motor arranque: `archive_mode`
          // esta encendido desde el primer segundo, asi que el binario tiene que
          // existir antes del primer `archive_command`.
          initContainers: [contenedorDeDescargaDeWalg(recursos)],
          containers: [
            {
              name: "postgres",
              image,
              // La imagen oficial resuelve `ENTRYPOINT docker-entrypoint.sh` y
              // `CMD postgres`; `args` sigue siendo solo el CMD —`archive_mode=on`
              // sigue siendo un elemento literal del arreglo, que es lo que
              // `auditoria.ts` y `componentes.test.ts` comprueban— pero `command` ya
              // no lo deja implicito: instala `gcompat` antes de que el entrypoint
              // real arranque, y le pasa el mismo CMD con `"$0" "$@"`.
              //
              // El binario oficial de wal-g esta enlazado contra glibc; esta imagen
              // es musl (Alpine) y sin gcompat `archive_command` muere con «not
              // found» (exit 127) desde el primer WAL -confirmado contra un cluster
              // real, issue #158-. Necesita la salida a :443 que
              // `permitirSalidaAlAlmacenamiento` ya abre para este pod.
              //
              // Van como argumentos y no en `postgresql.conf` porque aqui no hay
              // `postgresql.conf` propio que montar, y porque `archive_command` no se
              // puede pasar por variable de entorno.
              command: [
                "/bin/sh",
                "-c",
                "apk add --no-cache gcompat >/tmp/apk.log 2>&1 || " +
                  "{ cat /tmp/apk.log >&2; " +
                  'echo "FALLO: no se pudo instalar gcompat (glibc para wal-g)." >&2; exit 1; }; ' +
                  'exec docker-entrypoint.sh "$0" "$@"',
              ],
              args: [
                "postgres",
                "-c",
                "archive_mode=on",
                "-c",
                `archive_command=${WALG_BINARIO} wal-push %p`,
                "-c",
                `archive_timeout=${backup.walArchiveTimeoutSeconds}`,
              ],
              // Sin `runAsNonRoot` (issue #157): el `entrypoint` de la imagen oficial
              // arranca como root A PROPOSITO, para tomar posesion de PGDATA con
              // `chown` antes de bajar privilegios el mismo con `gosu postgres`. El
              // proceso que de verdad atiende conexiones ya corre sin root -lo hace la
              // propia imagen, no este manifiesto-; forzar `runAsNonRoot` aqui no lo
              // asegura mas, rompe el `chown` inicial contra un volumen nuevo.
              //
              // `capabilities.add` (issue #157): dropear TODAS las capacidades vuelve a
              // ese root sin ninguna de las que sus propias operaciones necesitan -en
              // Linux el privilegio de root viene de las capacidades, no del UID-.
              // Encontrado en CI: "chown: /var/lib/postgresql/data/pgdata: Operation not
              // permitted" y "chmod: /var/run/postgresql: Operation not permitted", el
              // contenedor en CrashLoopBackOff. Las cinco que re-concede son exactamente
              // las que el `entrypoint` ejercita, no una lista generica: CHOWN y FOWNER
              // para tomar posesion del volumen y del directorio del socket, DAC_OVERRIDE
              // porque una comprobacion de permiso de por medio tambien depende de ella
              // -no solo del dueño del archivo-, y SETUID/SETGID para el `gosu postgres`
              // final, que sin ellas fallaria un paso mas adelante aunque el chown de
              // arriba se corrigiera solo.
              securityContext: seguridadBase({
                capabilities: { drop: ["ALL"], add: ["CHOWN", "FOWNER", "DAC_OVERRIDE", "SETUID", "SETGID"] },
              }),
              ports: [{ name: "postgres", containerPort: 5432 }],
              env: [
                { name: "POSTGRES_DB", value: BASE_DE_MANTENIMIENTO },
                { name: "POSTGRES_USER", value: "postgres" },
                {
                  name: "POSTGRES_PASSWORD",
                  valueFrom: { secretKeyRef: { name: secreto.motor, key: CLAVES.superusuario } },
                },
                // Las lee `20-asignar-claves.sh`, que es el mismo guion del compose.
                {
                  name: "KAMAYUK_CLAVE_OWNER",
                  valueFrom: { secretKeyRef: { name: secreto.owner, key: CLAVES.owner } },
                },
                {
                  name: "KAMAYUK_CLAVE_APP",
                  valueFrom: { secretKeyRef: { name: secreto.aplicacion, key: CLAVES.aplicacion } },
                },
                // La lee 20-asignar-claves.sh, el mismo guion del compose: es el que le da
                // LOGIN a rol_carga_parametros (issue #387).
                {
                  name: "KAMAYUK_CLAVE_CARGA",
                  valueFrom: { secretKeyRef: { name: secreto.carga, key: CLAVES.carga } },
                },
                {
                  name: "KAMAYUK_CLAVE_IDENTIDAD",
                  valueFrom: {
                    secretKeyRef: { name: secreto.identidad, key: CLAVES.baseDeIdentidad },
                  },
                },
                // La lee `40-rol-de-respaldo.sh`.
                {
                  name: "KAMAYUK_CLAVE_RESPALDO",
                  valueFrom: { secretKeyRef: { name: secreto.respaldo, key: CLAVES.respaldo } },
                },
                // La lee `50-rol-de-monitoreo.sh`.
                {
                  name: "KAMAYUK_CLAVE_MONITOREO",
                  valueFrom: { secretKeyRef: { name: secreto.monitoreo, key: CLAVES.monitoreo } },
                },
                { name: "PGDATA", value: DIRECTORIO_DE_DATOS },
                ...variablesDeWalg,
              ],
              resources: recursos.motor,
              volumeMounts: [
                { name: "datos", mountPath: "/var/lib/postgresql/data" },
                { name: "inicializacion", mountPath: "/docker-entrypoint-initdb.d", readOnly: true },
                // Lo que los guiones LEEN. Fuera de `initdb.d` a proposito: ver el comentario
                // de `deLosSistemas`.
                { name: "roles-de-los-sistemas", mountPath: "/etc/kamayuk", readOnly: true },
                montajeDeWalg(),
              ],
              // El arranque de un motor con un padron grande no es instantaneo, y
              // recuperarse de un corte lo es menos. `startupProbe` con 60 intentos da
              // hasta cinco minutos ANTES de que la sonda de vida empiece a contar.
              // `--host=127.0.0.1` en las tres, y no es un detalle: sin el,
              // `pg_isready` pregunta por el socket unix, y durante la fase de
              // inicializacion del entrypoint el motor arranca con
              // `listen_addresses=''` -escucha por socket y NO por TCP-. El pod se
              // declara Ready mientras todavia corren los guiones de initdb, y el
              // Job de migracion, que entra por TCP, muere con «Connection
              // refused». Es una carrera que gana el socket cuando el arranque es
              // corto y pierde siempre cuando se alarga -PostGIS crea
              // `template_postgis` y le carga las extensiones (ADR-0021)-, y se
              // destapo en la marcha blanca del PR #487. Una sonda tiene que
              // comprobar lo que sus dependientes necesitan.
              startupProbe: sondaExec(
                ["pg_isready", "--host=127.0.0.1", "--username=postgres", `--dbname=${BASE_DE_MANTENIMIENTO}`],
                { periodSeconds: 5, failureThreshold: 60 },
              ),
              readinessProbe: sondaExec(
                ["pg_isready", "--host=127.0.0.1", "--username=postgres", `--dbname=${BASE_DE_MANTENIMIENTO}`],
                { periodSeconds: 10, failureThreshold: 3 },
              ),
              livenessProbe: sondaExec(
                ["pg_isready", "--host=127.0.0.1", "--username=postgres", `--dbname=${BASE_DE_MANTENIMIENTO}`],
                { periodSeconds: 20, failureThreshold: 5 },
              ),
            },
            // El sidecar de metricas (issue #156): en el MISMO pod, nunca un
            // Deployment aparte. Comparte la red del pod —se conecta por
            // `localhost`—, y usa `kamayuk_monitor`, no el superusuario: solo
            // `pg_monitor`, sin DDL. Ver `convenciones.secretos().monitoreo`.
            {
              name: "postgres-exporter",
              image: IMAGEN_DE_POSTGRES_EXPORTER,
              env: [
                {
                  name: "DATA_SOURCE_URI",
                  value: "localhost:5432/postgres?sslmode=disable",
                },
                { name: "DATA_SOURCE_USER", value: "kamayuk_monitor" },
                {
                  name: "DATA_SOURCE_PASS",
                  valueFrom: { secretKeyRef: { name: secreto.monitoreo, key: CLAVES.monitoreo } },
                },
              ],
              ports: [{ name: "metrics", containerPort: 9187 }],
              // No escribe nada fuera de lo que responde por HTTP (issue #157): todo
              // lo que hace es leer `pg_stat_*` por la red y traducirlo.
              //
              // `runAsUser: 65534`: la misma convencion `USER nobody` (sin numero)
              // que el resto de las imagenes del ecosistema Prometheus en este
              // repositorio -Prometheus, Alertmanager, node-exporter,
              // kube-state-metrics-, y el mismo fallo que esas cuatro dieron en CI.
              securityContext: seguridadSinRoot({ runAsUser: 65534, readOnlyRootFilesystem: true }),
              resources: recursos.exportador,
              // `httpGet`, no `exec`: la sonda la hace el kubelet desde fuera del
              // contenedor, asi que no depende de que la imagen traiga `wget` —la
              // de `postgres_exporter` no trae shell ni utilidades, es un solo
              // binario Go—.
              readinessProbe: sondaHttp("/metrics", 9187, { periodSeconds: 10, failureThreshold: 3 }),
              livenessProbe: sondaHttp("/metrics", 9187, { periodSeconds: 20, failureThreshold: 5 }),
            },
          ],
          volumes: [
            { name: "datos", persistentVolumeClaim: { claimName: volumen.metadata.name } },
            // 0o755 en decimal. Los guiones `.sh` de la inicializacion se ejecutan, y
            // el modo por omision de un `ConfigMap` (0644) los deja sin permiso de
            // ejecucion: el motor los ignoraria en silencio y la base arrancaria sin
            // claves asignadas.
            { name: "inicializacion", configMap: { name: inicializacion.metadata.name, defaultMode: 493 } },
            // 0o444: aqui no se ejecuta nada, se lee. `lib-extensiones.sh` se hace `source`, no
            // se invoca.
            //
            // Las claves con `/` dentro —`roles/<sistema>.sql`— las proyecta el kubelet como
            // subdirectorio, que es lo que hace que `$DIR/roles/*.sql` encuentre los cuatro sin
            // que ningun guion tenga que saber cuantos hay.
            {
              name: "roles-de-los-sistemas",
              configMap: {
                name: deLosSistemas.metadata.name,
                defaultMode: 292,
                // `items` y no la proyeccion por omision: los cuatro `.sql` tienen que caer en
                // `roles/`, que es donde `$DIR/roles/*.sql` los busca, y una clave de ConfigMap
                // no puede llevar la barra dentro.
                items: [
                  { key: "lib-extensiones.sh", path: "lib-extensiones.sh" },
                  ...SISTEMAS_DEL_PRODUCTO.map((s) => ({
                    key: `${s}.sql`,
                    path: `roles/${s}.sql`,
                  })),
                ],
              },
            },
            volumenDeWalg(),
            volumenDeTmpDeWalg(),
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
      // `ClusterIP`, y la auditoria lo exige: el puerto de PostgreSQL no se publica a
      // internet. Para administrar se usa el tunel SSH que ya usa CI (`INF-01` §1.4);
      // un `NodePort` «un momento, para depurar» es la frase que esta epica retira.
      type: "ClusterIP",
      selector: { app: nombre },
      ports: [
        { name: "postgres", port: 5432, targetPort: 5432 },
        // Solo lo scrapea Prometheus, desde dentro del cluster (issue #156). No
        // hay `IngressRoute` que lo alcance, igual que el puerto de PostgreSQL.
        { name: "metrics", port: 9187, targetPort: 9187 },
      ],
    },
  };

  return [inicializacion, deLosSistemas, volumen, motor, servicio];
}
