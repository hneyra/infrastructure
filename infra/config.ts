import * as pulumi from "@pulumi/pulumi";

/**
 * Lectura y validación tipada de la configuración del stack.
 *
 * **Toda** la configuración se lee aquí. No hay `new pulumi.Config()` ni `process.env`
 * en ningún otro archivo, y una regla de ESLint lo impide con su muestra que la viola
 * (`verificaciones/`). El motivo es concreto: un valor que falta tiene que reventar al
 * principio, con el nombre del valor y con lo que ese valor sirve, y no a mitad del
 * despliegue con un error del proveedor de Kubernetes sobre un recurso a medias.
 *
 * Las invariantes de `checkInvariants` son la parte que importa. Cada una corresponde a
 * una restricción escrita en `ADR-0011`, `INF-01`, `INF-03` o los RNF de operación que,
 * incumplida, deja el ambiente en una configuración que **no cumple sus propios
 * requisitos**. Son funciones puras y cada una tiene en `config.test.ts` el caso que la
 * viola: una verificación que no puede fallar no protege nada.
 *
 * ## Un solo nodo, y lo que eso obliga a vigilar
 *
 * El SGTM corre sobre un VPS (`INF-01` §1.1). No hay quórum que sobreviva ni réplica que
 * promover, así que las tres cosas que sostienen la recuperación —el respaldo fuera del
 * VPS, el plazo de archivado del WAL y el ensayo de la restauración en `stg`— no son
 * ajustes de rendimiento: son el RPO y el RTO escritos en configuración. Por eso las
 * tres tienen invariante.
 */

/** Los dos ambientes de `INF-03` §1. El nombre del stack **es** el ambiente. */
export const ENVIRONMENTS = ["stg", "prod"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/**
 * Local no está en la lista, y no es un olvido: local es
 * `despliegue/compose.yaml`, no un stack de Pulumi (`ADR-0011` §4).
 */
export const LOCAL_IS_NOT_A_STACK =
  "Local no es un stack: es `despliegue/compose.yaml` (ADR-0011 §4).";

export interface IngressSettings {
  /** Nombre público por el que llega el navegador. De él cuelga el certificado. */
  domain: string;
  /** Dirección de contacto de ACME. Let's Encrypt avisa ahí si el certificado no renueva. */
  acmeEmail: string;
  /**
   * Emitir contra el entorno de pruebas de Let's Encrypt.
   *
   * Sirve para no gastar el límite de tasa mientras se ajusta el ingreso. El
   * certificado que emite **no lo acepta ningún navegador**, así que en `prod`
   * incumpliría RNF-074.
   */
  acmeStaging: boolean;
  /**
   * Puertos del nodo publicados a internet además de 80 y 443.
   *
   * Tiene que estar vacío. Es el valor que retira la última parte de la frase del
   * README del compose —«con los puertos publicados en claro»— y el que más fácil es
   * abrir «un momento, para depurar».
   */
  publishedNodePorts: number[];
}

export interface DatabaseSettings {
  /** Imagen de PostgreSQL, con versión fijada. Nunca una etiqueta móvil. */
  image: string;
  /** Tamaño del volumen. Es disco local del nodo: no crece solo (`INF-01` §5). */
  storageSize: string;
  /**
   * Generar aquí las claves de los roles del motor.
   *
   * Prohibido en los dos ambientes. `ADR-0011` §3: el estado de Pulumi guarda lo que
   * hace falta para **crear** el mecanismo de secretos, no los secretos del sistema.
   * De dónde salen de verdad lo decide el issue #154.
   */
  generateRolePasswords: boolean;
}

export interface BackupSettings {
  /**
   * Destino del archivado continuo y de los respaldos base.
   *
   * Tiene que estar **fuera del VPS** (`INF-01` §1.3): el camino de recuperación no
   * puede depender de lo que se está recuperando. Un destino que resuelve dentro del
   * clúster o al propio nodo no es un respaldo, es una segunda copia del mismo punto
   * único de falla.
   */
  endpoint: string;
  /**
   * La región AWS del almacenamiento de objetos (issue #158). El SDK de AWS firma
   * cada petición con la región incluida; sin ella, `wal-g` falla al primer intento
   * contra un S3 real —a diferencia de un S3-compatible generico, donde a veces no
   * importa—. `us-east-1` no es un valor por omisión razonable para otra región: se
   * declara siempre, aunque el bucket viva ahí.
   */
  region: string;
  /** Contenedor de destino. Distinto por ambiente (`INF-03` §4). */
  bucket: string;
  /**
   * Plazo máximo de archivado del WAL, en segundos.
   *
   * **Es el RPO escrito en configuración** (RNF-076: 5 minutos). Subirlo a una hora no
   * rompe nada visible y degrada el RPO en silencio, que es exactamente el fallo que
   * esta invariante existe para impedir.
   */
  walArchiveTimeoutSeconds: number;
  /**
   * Contenedor **de origen** desde el que `stg` restaura para ensayar (`INF-03` §2).
   *
   * Solo `stg`. La credencial con que `stg` lo lee es de solo lectura: `stg` restaura
   * leyendo de donde `prod` escribe, y sus propios respaldos van a otro sitio.
   */
  restoreSourceBucket?: string;
  /**
   * Punto HTTP al que el CronJob de respaldo avisa si `wal-g backup-push` falla
   * (issue #155). Opcional: sin el, el fallo sigue quedando en la tabla `respaldo`
   * (RF-126) y en el estado del propio `CronJob`, pero nadie recibe un empujon
   * activo. Cablear esto a un canal de verdad —Alertmanager, un webhook de chat— es
   * issue #156; aqui solo se declara el punto de entrada.
   */
  alertWebhookUrl?: string;
}

export interface IdentitySettings {
  /** Imagen de Keycloak, con versión fijada. */
  image: string;
  /** Realm que emite los tokens del SGTM. De él sale el claim `municipalidad_id`. */
  realm: string;
  /**
   * Arrancar Keycloak en modo de desarrollo (`start-dev`).
   *
   * Prohibido en los dos ambientes. Es lo correcto en el compose —HTTP en claro detrás
   * del proxy, sin agrupamiento— y lo incorrecto aquí: `start-dev` guarda su base
   * **dentro del contenedor**, así que perder el pod es perder los usuarios.
   */
  developmentMode: boolean;
  /** Usuarios de prueba con clave conocida. Prohibido en `prod` (`INF-03` §4). */
  seedTestUsers: boolean;
  /**
   * El relay SMTP con el que Keycloak envía el enlace de un solo uso para fijar la
   * clave en el alta declarativa de usuarios (ADR-0012, `execute-actions-email` con
   * `UPDATE_PASSWORD`).
   *
   * **Opcional.** Un ambiente que no declara `keycloakSmtpHost` se queda sin relay: el
   * realm no lleva `smtpServer`, el Job de reconciliación pasa `SIN_CORREO=1` y el
   * usuario nuevo se crea **sin clave** y con `UPDATE_PASSWORD` pendiente — un operador
   * se la fija con el runbook «Recuperar el acceso de un usuario». Es el estado de la
   * marcha blanca de `prod` mientras no haya un relay decidido (D-05).
   *
   * Cuando sí se declara: el servidor y el remitente no son secretos —van en claro en
   * `Pulumi.<stack>.yaml`, como `domain`—; el usuario y la clave del relay, si `auth`
   * es true, viven en el `Secret` `sgtm-<amb>-smtp` y **no** los genera
   * `bootstrap-secretos.sh` (INF-06 §1.2). En `stg` el relay es un buzón Mailpit del
   * propio clúster, sin `auth`.
   */
  smtp?: SmtpSettings;
}

export interface SmtpSettings {
  /** Anfitrión del relay. En `prod` no puede ser un buzón de pruebas (`INF-03` §4). */
  host: string;
  /** Puerto del relay: 25, 465, 587 o el 1025 de un Mailpit. */
  port: number;
  /** Dirección desde la que sale el correo. Tiene que tener forma de correo. */
  from: string;
  /** STARTTLS al conectar. */
  startTls: boolean;
  /** El relay exige usuario y clave. Si es true, se leen del `Secret` `sgtm-<amb>-smtp`. */
  auth: boolean;
}

export interface ApplicationSettings {
  /**
   * Repositorio de las imágenes, **sin etiqueta**.
   *
   * `ADR-0011` §5: la etiqueta de la imagen vive fuera del estado de Pulumi. Si entra
   * aquí, cada liberación pasa a ser un `pulumi up` y cada reversión también, lo que
   * acopla el ritmo de la aplicación al de la infraestructura. La etiqueta la pone el
   * flujo de liberación (issue #148).
   */
  imageRepository: string;
  /**
   * La versión con la que Pulumi **crea** los despliegues y los Jobs.
   *
   * `ADR-0011` §5 saca la etiqueta de la imagen del estado de Pulumi, y aquí hay que
   * decir con precisión qué significa eso, porque «la versión no está en el estado» a
   * secas es falso: un `Deployment` tiene que nacer con **alguna** imagen.
   *
   * Lo que se garantiza es la consecuencia que ADR-0011 §5 buscaba: **liberar y
   * revertir no ejecutan `pulumi up`**. Este valor se usa al crear el recurso, y de ahí
   * en adelante el campo `image` queda ignorado por Pulumi (`ignoreChanges`, ver
   * `index.ts`): el flujo de liberación mueve la etiqueta con `kubectl set image` y el
   * `preview` diario no lo ve como deriva ni intenta deshacerlo.
   *
   * Cambiar este valor, por tanto, **no despliega nada** sobre un clúster que ya corre.
   * Es la versión con la que un VPS reconstruido desde cero arranca antes de que el
   * flujo de liberación lo ponga al día, y por eso conviene que no envejezca demasiado.
   */
  bootstrapVersion: string;
  /** Réplicas del perfil `web`. El perfil `batch` son Jobs, no réplicas. */
  webReplicas: number;
  /**
   * La municipalidad se da de alta como instalación de demostración.
   *
   * Obligatorio en `stg` (`INF-03` §3.2): mientras D-02a esté abierta, toda cifra sale
   * de parámetros que nadie firmó, y un documento de `stg` sin marca no se distingue
   * de uno de `prod`.
   */
  isDemonstration: boolean;
  /**
   * Si `esDemostracion` se declaró en el stack, en vez de caer en el valor por omisión.
   *
   * `prod` tiene que **decidirlo a mano** (issue #150): mientras D-02a esté abierta,
   * toda cifra sale de parámetros que nadie firmó, y una instalación así tiene que
   * decir que es de demostración. Caer en el valor por omisión no es decidir.
   */
  isDemonstrationDeclared: boolean;
}

/**
 * El alta de la municipalidad, que ejecuta el Job de implantación (issue #150).
 *
 * No lleva ninguna contraseña, y es deliberado: la credencial del administrador vive en
 * Keycloak. `administrador` tiene que ser **la misma cuenta que exista allí**; si no
 * coincide, el sistema queda con un administrador que no puede entrar.
 */
export interface ImplantacionSettings {
  /** Ubigeo de la municipalidad: seis dígitos. */
  ubigeo: string;
  nombre: string;
  tipo: "DISTRITAL" | "PROVINCIAL";
  /** Cuenta del primer administrador. La misma que existe en Keycloak. */
  administrador: string;
  nombreDelAdministrador: string;
  /**
   * El `id` de la fila que crea el Job de implantación, y que los procesos por lotes de los
   * cuatro sistemas fijan como contexto de tenant (C-14, punto 3).
   *
   * **Se declara y no se deriva.** `municipalidad.id` es una columna `IDENTITY`, así que en una
   * base recién creada vale 1 por construcción; lo que este repositorio no puede hacer es
   * comprobarlo contra la fila, porque componer manifiestos no habla con ninguna base. Un valor
   * que no corresponda al `ubigeo` deja al ingestor de `rentas` y al publicador de `catastro`
   * proyectando bajo otro contexto, y RLS no lo delata: la base hace exactamente lo que se le
   * pide. Cerrarlo exige que esos dos procesos resuelvan el ubigeo ellos mismos (C-14 §6).
   */
  municipalidadId: number;
}

/**
 * Observabilidad y alertas (issue #156).
 *
 * `../iaac`, §Alerts, tiene el incidente anotado: reglas evaluándose durante meses sin
 * destino, y una caída que nadie vio. «Una regla que no notifica a nadie no es una
 * alerta, es un gráfico» es la frase que esta interfaz existe para que no se repita.
 */
/**
 * Quien recibe un aviso de operacion de este ambiente, con nombre y canal.
 *
 * Es del AMBIENTE y no de ningun sistema, y por eso vive aqui: lo que hace falta contestar es
 * «a quien se le avisa en stg» y «a quien en prod», no «a quien avisa la caja». El primero que
 * lo necesita es `caja` —ADR-0026 §4 pide una alerta **a una persona con nombre** cuando hay
 * dinero cobrado sin registrar—, y su aplicacion NO ARRANCA sin las dos (C-7, punto 4).
 *
 * **Las dos son obligatorias y no tienen valor por omision**, en los dos ambientes. Un
 * «responsable: pendiente» haria arrancar la instalacion con la guarda satisfecha y sin nadie
 * detras, que es exactamente lo que la guarda existe para impedir; y `stg` tampoco se exime,
 * porque `stg` es donde se ensaya el procedimiento entero.
 */
export interface OperacionSettings {
  /** Nombre de la persona o el puesto. No un alias de correo: tiene que decir a quien. */
  responsable: string;
  /** Donde se le avisa: un correo, un canal de mensajeria, un telefono. */
  canal: string;
}

export interface ObservabilitySettings {
  /**
   * El `webhook_configs` de Alertmanager. Sin él, las reglas se evalúan igual —se ven
   * en la API de Alertmanager— pero nadie recibe nada: es el estado que `checkInvariants`
   * prohíbe en `prod` y permite en `stg`, porque es exactamente el que hace falta para
   * poder demostrar la diferencia entre «la regla está roja» y «alguien se enteró».
   */
  alertWebhookUrl?: string;
}

/** Todo lo que no es secreto, y por tanto se puede validar sin resolver un `Output`. */
/**
 * Lo que el nodo del ambiente puede repartir entre pods, **medido**, no estimado.
 *
 * Es lo **asignable** (`allocatable`), no la capacidad: el kubelet reserva una parte
 * para el sistema y para sí mismo (`infra/vps/reservar-recursos-del-nodo.sh`, issue
 * #157), y esa parte no está disponible para ningún pod. Confundir las dos es
 * exactamente lo que dejó a `prod` sin poder ubicar su propio stack: `vmd120205` tiene
 * 4 CPU de capacidad y **2 asignables** desde que la reserva se aplicó el 2026-08-23.
 *
 * Se mide contra el nodo, con el túnel abierto:
 *
 * ```
 * kubectl get node -o jsonpath='{.items[0].status.allocatable.cpu}{"/"}{.items[0].status.allocatable.memory}'
 * ```
 *
 * Es obligatorio en los dos stacks y no tiene valor por omisión, a propósito: un valor
 * por omisión aquí es una cifra inventada sobre la que `capacidad.ts` dictaminaría que
 * todo cabe, que es peor que no comprobar nada.
 */
export interface NodeSettings {
  /** CPU asignable del nodo. `"2"` o `"2000m"`. */
  allocatableCpu: string;
  /** Memoria asignable del nodo. Se admite `Ki`, que es lo que devuelve `kubectl`. */
  allocatableMemory: string;
  /**
   * El issue que sigue una brecha **conocida y aceptada** entre el nodo y el stack.
   *
   * Existe por una razón concreta y estrecha: `verificar` es `needs:` de todos los demás
   * trabajos de `infra.yml`, incluido `aplicar-stg`. Sin esta declaración, un nodo de
   * `prod` que se queda corto pone rojo `yarn verificar` y **deja de desplegarse `stg`**,
   * que no tiene culpa de nada. Un ambiente no puede secuestrar al otro.
   *
   * Lo que **no** es: un interruptor para silenciar la comprobación. El despliegue de
   * ese ambiente sigue sin poder ocurrir — lo detiene el paso «El stack cabe en su
   * nodo» de `aplicar-stg`/`aplicar-prod`, **antes** de invocar a Pulumi, en segundos y
   * diciendo cuánto falta. Lo único que la marca cambia es que `index.ts` avise en vez
   * de lanzar, y eso es para no romper `pulumi preview`, que corre en cada PR.
   *
   * Y no se queda puesta cuando deja de ser cierta: `capacidad.test.ts` exige que un
   * ambiente que la declara **siga sin caber**, así que el día que el nodo crezca la
   * prueba se pone roja y obliga a retirarla. Tampoco puede tapar una brecha nueva: un
   * ambiente sin marca que no quepa pone rojo `yarn verificar` y hace lanzar a
   * `index.ts`.
   */
  capacityGapIssue?: string;
}

export interface Invariants {
  environment: Environment;
  node: NodeSettings;
  ingress: IngressSettings;
  database: DatabaseSettings;
  backup: BackupSettings;
  identity: IdentitySettings;
  application: ApplicationSettings;
  implantacion: ImplantacionSettings;
  observability: ObservabilitySettings;
  operacion: OperacionSettings;
}

/**
 * Los dos secretos de arranque que SÍ viven aquí, cifrados en la configuración del
 * stack (`ADR-0011` §3): lo que Pulumi necesita para *crear* el mecanismo. Ninguno de
 * los dos abre el padrón de una municipalidad por sí solo.
 *
 * **La clave del administrador de Keycloak no está aquí, y antes lo estuvo.** `INF-06`
 * (issue #154) la clasifica como secreto de la *aplicación* —la misma familia que
 * `sgtm_owner` y `sgtm_app`—, así que sale de Pulumi igual que ellos: la genera
 * `infra/secretos/bootstrap-secretos.sh` y vive solo en el `Secret` de Kubernetes que
 * `Identidad.ts` ya referencia. El campo se retiró de esta interfaz junto con esa
 * decisión; queda la nota para que nadie lo reintroduzca "por comodidad".
 */
export interface Settings extends Invariants {
  /**
   * Kubeconfig del nodo. Su `server` tiene que apuntar al bucle local: CI llega al
   * API de k3s por un túnel SSH y el puerto 6443 no responde desde internet
   * (`INF-01` §1.4).
   */
  kubeconfig: pulumi.Output<string>;
  /** Credenciales del almacenamiento de objetos donde viven los respaldos. */
  backupCredentials: {
    accessKeyId: pulumi.Output<string>;
    secretAccessKey: pulumi.Output<string>;
  };
  /**
   * Credenciales de solo lectura contra el registro de imágenes (`INF-06`, issue #257).
   *
   * Misma clasificación que `backupCredentials`: `ADR-0011` §3 las trata como secreto
   * de *arranque de la infraestructura* —lo que el nodo necesita para poder traer las
   * imágenes de `sgtm:applicationImageRepository`—, no de la aplicación. Sin esto, un
   * clúster nuevo (o reconstruido desde cero) no puede completar el primer `pulumi up`:
   * los tres paquetes de `ghcr.io/hneyra` que no son PostgreSQL ni Keycloak son
   * privados, y sin credencial la respuesta es `401` al pedir el token anónimo, antes
   * de que importe si la etiqueta existe.
   */
  registryCredentials: {
    username: string;
    token: pulumi.Output<string>;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lectura
// ─────────────────────────────────────────────────────────────────────────────

/**
 * De dónde salen los valores. Existe para que `config.test.ts` pueda construir un
 * stack al que le falta un valor y comprobar que el fallo **dice cuál**, sin
 * necesitar un stack de Pulumi de verdad.
 */
export interface ConfigReader {
  text(key: string): string | undefined;
  number(key: string): number | undefined;
  boolean(key: string): boolean | undefined;
  object<T>(key: string): T | undefined;
}

/** Falta un valor obligatorio del stack. El mensaje nombra el valor y para qué sirve. */
export class MissingConfigError extends Error {
  constructor(
    readonly key: string,
    readonly purpose: string,
  ) {
    super(
      `Falta el valor obligatorio «sgtm:${key}» en la configuración del stack. ` +
        `Sirve para: ${purpose}. Ponlo con \`pulumi config set ${key} <valor>\`.`,
    );
    this.name = "MissingConfigError";
  }
}

function requireText(reader: ConfigReader, key: string, purpose: string): string {
  const value = reader.text(key);
  if (value === undefined || value.trim() === "") {
    throw new MissingConfigError(key, purpose);
  }
  return value;
}

/**
 * Lo mismo para un número, y con la misma exigencia: sin valor por omisión.
 *
 * `Number.isFinite` y no `!isNaN`: `Number("")` es 0 e `Infinity` es un número. Un cero o un
 * infinito colados aquí serían un `id` de municipalidad que no existe, y el síntoma llegaría como
 * «el ingestor no proyecta nada» en vez de como «esta clave está mal».
 */
function requireNumber(reader: ConfigReader, key: string, purpose: string): number {
  const value = reader.number(key);
  if (value === undefined || !Number.isFinite(value)) {
    throw new MissingConfigError(key, purpose);
  }
  return value;
}

/**
 * El relay SMTP, o `undefined` si el ambiente no lo declara.
 *
 * `keycloakSmtpHost` es el interruptor: sin él no hay relay (ADR-0012, Opción B).
 * Con él, `keycloakSmtpFrom` es obligatorio —medio relay configurado es un defecto,
 * no un ambiente sin correo—.
 */
function readSmtp(reader: ConfigReader): SmtpSettings | undefined {
  const host = reader.text("keycloakSmtpHost");
  if (host === undefined || host.trim() === "") {
    return undefined;
  }
  return {
    host,
    port: reader.number("keycloakSmtpPort") ?? 587,
    from: requireText(reader, "keycloakSmtpFrom", "la dirección remitente del correo de Keycloak"),
    startTls: reader.boolean("keycloakSmtpStartTls") ?? true,
    auth: reader.boolean("keycloakSmtpAuth") ?? true,
  };
}

/**
 * Arma las invariantes desde un lector cualquiera.
 *
 * No valida: valida `checkInvariants`. Aquí solo se decide qué es obligatorio y qué
 * tiene valor por omisión, que es una decisión distinta y conviene poder leerla junta.
 */
export function readInvariants(environment: Environment, reader: ConfigReader): Invariants {
  return {
    environment,
    node: {
      allocatableCpu: requireText(
        reader,
        "nodeAllocatableCpu",
        "la CPU ASIGNABLE del nodo, medida con kubectl; no su capacidad (INF-01 §2)",
      ),
      allocatableMemory: requireText(
        reader,
        "nodeAllocatableMemory",
        "la memoria ASIGNABLE del nodo, medida con kubectl; no su capacidad (INF-01 §2)",
      ),
      ...(reader.text("nodeCapacityGapIssue") === undefined
        ? {}
        : { capacityGapIssue: reader.text("nodeCapacityGapIssue") }),
    },
    ingress: {
      domain: requireText(reader, "domain", "el nombre público por el que llega el navegador"),
      acmeEmail: requireText(
        reader,
        "acmeEmail",
        "la dirección a la que Let's Encrypt avisa si el certificado no renueva",
      ),
      acmeStaging: reader.boolean("acmeStaging") ?? false,
      publishedNodePorts: reader.object<number[]>("publishedNodePorts") ?? [],
    },
    database: {
      image: requireText(reader, "postgresImage", "la imagen de PostgreSQL, con su versión fijada"),
      storageSize: requireText(
        reader,
        "postgresStorageSize",
        "el tamaño del volumen de la base en el disco del nodo",
      ),
      generateRolePasswords: reader.boolean("generateRolePasswords") ?? false,
    },
    backup: {
      endpoint: requireText(
        reader,
        "backupEndpoint",
        "el almacenamiento de objetos, FUERA del VPS, donde viven el WAL y los respaldos",
      ),
      region: requireText(reader, "backupRegion", "la región AWS del almacenamiento de objetos"),
      bucket: requireText(reader, "backupBucket", "el contenedor de destino de los respaldos"),
      walArchiveTimeoutSeconds: reader.number("walArchiveTimeoutSeconds") ?? 300,
      ...(reader.text("restoreSourceBucket") === undefined
        ? {}
        : { restoreSourceBucket: reader.text("restoreSourceBucket") }),
      ...(reader.text("backupAlertWebhookUrl") === undefined
        ? {}
        : { alertWebhookUrl: reader.text("backupAlertWebhookUrl") }),
    },
    identity: {
      image: requireText(reader, "keycloakImage", "la imagen de Keycloak, con su versión fijada"),
      realm: reader.text("keycloakRealm") ?? "sgtm",
      developmentMode: reader.boolean("keycloakDevelopmentMode") ?? false,
      seedTestUsers: reader.boolean("keycloakSeedTestUsers") ?? false,
      // Opcional: sin `keycloakSmtpHost` no hay relay, y el alta declarativa crea el
      // usuario sin clave (ver el docstring de `IdentitySettings.smtp`). Con host
      // puesto, `keycloakSmtpFrom` pasa a ser obligatorio: medio relay es un defecto.
      smtp: readSmtp(reader),
    },
    application: {
      imageRepository: requireText(
        reader,
        "applicationImageRepository",
        "el repositorio de las tres imágenes, SIN etiqueta (ADR-0011 §5)",
      ),
      bootstrapVersion: requireText(
        reader,
        "applicationBootstrapVersion",
        "la versión con que se CREAN los despliegues; liberar y revertir no la usan (ADR-0011 §5)",
      ),
      webReplicas: reader.number("webReplicas") ?? 2,
      isDemonstration: reader.boolean("esDemostracion") ?? false,
      isDemonstrationDeclared: reader.boolean("esDemostracion") !== undefined,
    },
    implantacion: {
      ubigeo: requireText(reader, "ubigeo", "el ubigeo de la municipalidad que se implanta"),
      nombre: requireText(reader, "municipalidad", "el nombre de la municipalidad que se implanta"),
      tipo: (reader.text("tipoDeMunicipalidad") ?? "DISTRITAL") as ImplantacionSettings["tipo"],
      administrador: requireText(
        reader,
        "administrador",
        "la cuenta del primer administrador, que tiene que existir ya en Keycloak",
      ),
      nombreDelAdministrador:
        reader.text("nombreDelAdministrador") ?? "Administrador del sistema",
      // Sin valor por omisión: un `?? 1` haría que olvidarlo se leyera igual que declararlo, y
      // lo que se declara aquí decide bajo qué municipalidad escriben los procesos por lotes.
      municipalidadId: requireNumber(
        reader,
        "municipalidadId",
        "el `id` de la fila de `municipalidad` que crea el Job de implantación; es lo que los" +
          " procesos por lotes de los cuatro sistemas fijan como contexto de tenant (C-14)",
      ),
    },
    observability: {
      ...(reader.text("alertWebhookUrl") === undefined
        ? {}
        : { alertWebhookUrl: reader.text("alertWebhookUrl") }),
    },
    operacion: {
      responsable: requireText(
        reader,
        "responsableDeOperacion",
        "a QUIEN se le avisa cuando hay dinero cobrado sin registrar (ADR-0026 §4). Sin esto la"
          + " aplicacion de `caja` no arranca, y es deliberado",
      ),
      canal: requireText(
        reader,
        "canalDeOperacion",
        "DONDE se le avisa a esa persona: un correo, un canal de mensajeria, un telefono",
      ),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Validación
// ─────────────────────────────────────────────────────────────────────────────

const MOVING_TAGS = ["latest", "main", "stable"];

function isMovingTag(image: string): boolean {
  const tag = image.includes(":") ? image.slice(image.lastIndexOf(":") + 1) : "";
  return tag === "" || MOVING_TAGS.includes(tag);
}

/** Destinos que están dentro del propio nodo, y por tanto no sirven de respaldo. */
function isInsideTheNode(endpoint: string): boolean {
  const host = endpoint.replace(/^[a-z]+:\/\//i, "").split("/")[0]?.split(":")[0] ?? "";
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".svc.cluster.local") ||
    host.endsWith(".svc") ||
    host.endsWith(".cluster.local")
  );
}

/**
 * Devuelve la lista de incumplimientos. Vacía significa configuración admisible.
 *
 * Pura a propósito: recibe la configuración y no lee nada del entorno, de modo que
 * `config.test.ts` puede construir el caso que viola cada regla. Cada mensaje cita el
 * documento, porque quien lo lea estará bloqueado y necesita saber por qué.
 */
export function checkInvariants(s: Invariants): string[] {
  const problems: string[] = [];
  const isProd = s.environment === "prod";
  const isStg = s.environment === "stg";

  if (!ENVIRONMENTS.includes(s.environment)) {
    problems.push(
      `El stack «${s.environment}» no es uno de los dos ambientes de INF-03 §1: ` +
        `${ENVIRONMENTS.join(", ")}. ${LOCAL_IS_NOT_A_STACK}`,
    );
  }

  // ── RNF-074 — se entra cifrado, y no responde nada más ─────────────────────
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.ingress.acmeEmail)) {
    problems.push(
      `\`acmeEmail\` vale «${s.ingress.acmeEmail}» y no tiene forma de dirección de correo. ` +
        "Es donde Let's Encrypt avisa de que el certificado no renueva, y RNF-074 exige " +
        "certificado válido: enterarse el día del vencimiento no cuenta.",
    );
  }
  if (s.ingress.acmeStaging && isProd) {
    problems.push(
      "`acmeStaging` es true en «prod». El certificado del entorno de pruebas de Let's " +
        "Encrypt no lo acepta ningún navegador, así que el sistema quedaría inalcanzable " +
        "cumpliendo la letra de RNF-074 y ninguna de sus consecuencias.",
    );
  }
  if (s.ingress.publishedNodePorts.length > 0) {
    problems.push(
      `\`publishedNodePorts\` publica ${s.ingress.publishedNodePorts.join(", ")}. INF-01 §1.4: ` +
        "desde internet responden 80 —que solo redirige— y 443, y nada más. Publicar el " +
        "puerto de PostgreSQL o el de Keycloak «un momento, para depurar» es exactamente la " +
        "frase del README del compose que esta épica existe para retirar.",
    );
  }

  // ── INF-01 §1.3 y RNF-076 — el respaldo, fuera, y a tiempo ─────────────────
  if (isInsideTheNode(s.backup.endpoint)) {
    problems.push(
      `\`backupEndpoint\` vale «${s.backup.endpoint}», que resuelve dentro del propio nodo. ` +
        "INF-01 §1.3: el camino de recuperación no puede depender de lo que se está " +
        "recuperando. Un respaldo en el disco que se pierde es una segunda copia del mismo " +
        "punto único de falla, y con él se van el RPO de RNF-076 y el RTO de RNF-077.",
    );
  }
  if (!s.backup.bucket.includes(s.environment)) {
    problems.push(
      `\`backupBucket\` vale «${s.backup.bucket}» y no nombra el ambiente «${s.environment}». ` +
        "INF-03 §4: el almacenamiento de respaldo es distinto por ambiente, para que un " +
        "`pulumi up` de stg mal configurado no pueda escribir sobre los respaldos de prod.",
    );
  }
  if (s.backup.walArchiveTimeoutSeconds > 300) {
    problems.push(
      `\`walArchiveTimeoutSeconds\` vale ${s.backup.walArchiveTimeoutSeconds}. RNF-076 fija el ` +
        "RPO en 5 minutos (300 s): este valor **es** el RPO escrito en configuración. Subirlo " +
        "no rompe nada visible y degrada la pérdida máxima de datos en silencio.",
    );
  }
  if (s.backup.walArchiveTimeoutSeconds < 1) {
    problems.push("`walArchiveTimeoutSeconds` tiene que ser al menos 1 segundo.");
  }
  if (s.backup.restoreSourceBucket !== undefined && !isStg) {
    problems.push(
      `\`restoreSourceBucket\` está puesto en «${s.environment}». Solo stg restaura desde los ` +
        "respaldos de otro ambiente, porque es donde se ensaya la restauración (INF-03 §2). " +
        "En prod, restaurar desde otro contenedor es un incidente, no una configuración.",
    );
  }
  if (isStg && s.backup.restoreSourceBucket === s.backup.bucket) {
    problems.push(
      "`restoreSourceBucket` y `backupBucket` son el mismo contenedor. Entonces stg no ensaya " +
        "restaurar los respaldos de prod: se restaura a sí mismo, y el simulacro de INF-03 §2 " +
        "no demuestra nada.",
    );
  }

  // ── INF-03 §3.2 — una instalación de demostración lo dice en cada documento ─
  if (isStg && !s.application.isDemonstration) {
    problems.push(
      "`esDemostracion` es false en «stg». INF-03 §3.2: la municipalidad de stg se da de alta " +
        "marcada, y por eso todo documento que emita sale marcado en los tres formatos (#122). " +
        "Sin la marca, una constancia de stg no se distingue de una de prod.",
    );
  }

  // ── INF-03 §4 — nada de atajos de desarrollo en producción ─────────────────
  if (s.identity.seedTestUsers && isProd) {
    problems.push(
      "`keycloakSeedTestUsers` es true en «prod». Un usuario de prueba con clave conocida en " +
        "el realm que emite los tokens del padrón es una puerta abierta (INF-03 §4).",
    );
  }
  if (s.identity.developmentMode) {
    problems.push(
      `\`keycloakDevelopmentMode\` es true en «${s.environment}». \`start-dev\` guarda la base ` +
        "de Keycloak dentro del contenedor: perder el pod es perder los usuarios. Es lo " +
        "correcto en el compose de la marcha blanca y lo incorrecto en el clúster, donde " +
        "Keycloak va en modo `start` con su propia base (INF-01 §1).",
    );
  }

  // ── ADR-0012 — el relay SMTP del alta declarativa de usuarios ──────────────
  // Opcional: un ambiente sin `keycloakSmtpHost` no incumple nada —el alta crea al
  // usuario sin clave y un operador se la fija—. Lo que se comprueba es que un relay
  // DECLARADO esté bien declarado.
  const smtp = s.identity.smtp;
  if (smtp !== undefined) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(smtp.from)) {
      problems.push(
        `\`keycloakSmtpFrom\` vale «${smtp.from}» y no tiene forma de dirección de correo. Es el ` +
          "remitente del enlace de un solo uso con que un usuario nuevo fija su clave (ADR-0012); " +
          "un remitente inválido lo rechazan los relays.",
      );
    }
    if (smtp.port < 1 || smtp.port > 65535) {
      problems.push(`\`keycloakSmtpPort\` vale ${smtp.port} y no es un puerto.`);
    }
    if (isProd && /mailpit|mailhog|-correo(\b|$)|localhost|127\.0\.0\.1/i.test(smtp.host)) {
      problems.push(
        `\`keycloakSmtpHost\` vale «${smtp.host}» en «prod». Es un buzón de pruebas, y en prod el ` +
          "enlace para fijar la clave tiene que salir por un relay de verdad (INF-03 §4): un buzón " +
          "que nadie lee deja a cada usuario nuevo sin forma de entrar. Sin relay decidido, no " +
          "declares `keycloakSmtpHost` y el alta creará al usuario sin clave (ADR-0012, Opción B).",
      );
    }
    if (isProd && !smtp.auth) {
      problems.push(
        "`keycloakSmtpAuth` es false en «prod». Un relay abierto entrega correo de cualquiera; el " +
          "de prod se autentica, y su usuario y clave viven en el `Secret` `sgtm-prod-smtp` " +
          "(INF-06 §1.2).",
      );
    }
  }

  // ── ADR-0011 §3 — ningún secreto de la aplicación en el estado de Pulumi ───
  if (s.database.generateRolePasswords) {
    problems.push(
      `\`generateRolePasswords\` es true en «${s.environment}». ADR-0011 §3: el estado de ` +
        "Pulumi guarda lo que hace falta para crear el mecanismo de secretos, no los secretos " +
        "del sistema. Las claves de `sgtm_owner` y `sgtm_app` abren el padrón de todas las " +
        "municipalidades; de dónde salen lo decide el issue #154.",
    );
  }

  // ── ADR-0011 §5 — la versión de la imagen vive fuera del estado ────────────
  if (s.application.imageRepository.includes(":")) {
    problems.push(
      `\`applicationImageRepository\` vale «${s.application.imageRepository}» y lleva etiqueta. ` +
        "ADR-0011 §5: la etiqueta de la imagen la pone el flujo de liberación, no Pulumi. Con " +
        "la versión en el estado, cada liberación es un `pulumi up` y cada reversión también, " +
        "y se pierde la reversión que no toca la infraestructura.",
    );
  }
  if (s.application.webReplicas < 1) {
    problems.push("`webReplicas` tiene que ser al menos 1.");
  }
  if (isMovingTag(`imagen:${s.application.bootstrapVersion}`)) {
    problems.push(
      `\`applicationBootstrapVersion\` vale «${s.application.bootstrapVersion}» y no fija una ` +
        "versión. Es la etiqueta con la que un VPS reconstruido desde cero arranca: con una " +
        "etiqueta móvil, dos reconstrucciones del mismo stack darían dos sistemas distintos y " +
        "ninguna de las dos se podría nombrar.",
    );
  }
  if (s.application.bootstrapVersion.includes(":")) {
    problems.push(
      "`applicationBootstrapVersion` es una etiqueta, no una imagen: no lleva `:`. El " +
        "repositorio va en `applicationImageRepository`.",
    );
  }

  // ── issue #150 — la marca de demostración en prod se decide a mano ─────────
  if (isProd && !s.application.isDemonstrationDeclared) {
    problems.push(
      "`esDemostracion` no está declarado en «prod». Hay que decidirlo a mano (issue #150): " +
        "mientras D-02a esté abierta, toda cifra que el sistema calcule sale de tramos y " +
        "alícuotas que nadie ha firmado, y una instalación que emite documentos con esas " +
        "cifras tiene que decir lo que es. Caer en el valor por omisión no es decidir.",
    );
  }

  // ── issue #150 — la implantación, que corre una sola vez y deja huella ─────
  if (!/^\d{6}$/.test(s.implantacion.ubigeo)) {
    problems.push(
      `\`ubigeo\` vale «${s.implantacion.ubigeo}» y el ubigeo son seis dígitos. Lo mismo exige ` +
        "`DatosDeImplantacion` al arrancar el Job, pero allí el fallo llega con el despliegue " +
        "a medias y aquí llega antes de tocar el clúster.",
    );
  }
  // C-14 §3 — el `id` con que los procesos por lotes fijan el contexto de tenant.
  //
  // Entero y mayor que cero, que es lo que puede valer una columna `IDENTITY`. No se comprueba
  // contra ninguna base —componer manifiestos no habla con ninguna—, así que lo que esto impide
  // es lo único que se puede impedir sin clúster: un `0`, un decimal o un negativo, que no son
  // ninguna fila y dejarían al ingestor escribiendo bajo un contexto que no existe.
  if (!Number.isInteger(s.implantacion.municipalidadId) || s.implantacion.municipalidadId < 1) {
    problems.push(
      `\`municipalidadId\` vale «${String(s.implantacion.municipalidadId)}» y tiene que ser un ` +
        "entero mayor que cero: es el `id` de la fila de `municipalidad` que crea el Job de " +
        "implantación, y en una base recién creada vale 1. Con un valor que no sea una fila, el " +
        "ingestor de `rentas` y el publicador de `catastro` proyectan bajo un contexto que no " +
        "existe, y RLS no lo delata: la base hace exactamente lo que se le pide.",
    );
  }

  if (s.implantacion.tipo !== "DISTRITAL" && s.implantacion.tipo !== "PROVINCIAL") {
    problems.push(
      `\`tipoDeMunicipalidad\` vale «${s.implantacion.tipo}»: es DISTRITAL o PROVINCIAL.`,
    );
  }

  // ── issue #156 — una regla que no notifica a nadie no es una alerta ────────
  if (isProd && s.observability.alertWebhookUrl === undefined) {
    problems.push(
      "`alertWebhookUrl` no está declarado en «prod». `../iaac` tiene el incidente anotado: " +
        "reglas evaluándose durante meses sin destino, y una caída que nadie vio. Sin un " +
        "receptor, Alertmanager enruta a `null-receiver` — las alertas se ven en su API y no " +
        "le llegan a nadie, que es exactamente el estado que este mensaje existe para impedir " +
        "en producción.",
    );
  }

  // ── C-7 §4 — una alerta sin destinatario no es una alerta ─────────────────
  //
  // ADR-0026 §4 no pide «una alerta»: pide una alerta A UNA PERSONA CON NOMBRE, porque un pago
  // que no se pudo imputar es dinero que entro por ventanilla y que el sistema de origen no sabe
  // que entro. La aplicacion de `caja` ya se niega a arrancar sin las dos (`ResponsableDeLaConciliacion`);
  // lo que se rechaza aqui es el relleno, que satisface esa guarda y la vacia de sentido.
  for (const [clave, valor] of [
    ["responsableDeOperacion", s.operacion.responsable],
    ["canalDeOperacion", s.operacion.canal],
  ] as const) {
    if (/^(pendiente|por definir|tbd|todo|n\/?a|-+)$/i.test(valor.trim())) {
      problems.push(
        `\`${clave}\` vale «${valor}», que es un relleno. La guarda de \`caja\` solo comprueba que ` +
          "no este vacio, asi que un relleno la satisface y deja la instalacion cobrando con la " +
          "alerta apuntando a nadie — que es el estado que ADR-0026 §4 existe para impedir.",
      );
    }
  }
  if (!/[@:/.]|\+\d/.test(s.operacion.canal)) {
    problems.push(
      `\`canalDeOperacion\` vale «${s.operacion.canal}» y no se parece a ningun canal: hace falta ` +
        "un correo, una direccion de mensajeria o un telefono. Es DONDE se avisa, no una " +
        "descripcion de a quien.",
    );
  }

  // ── Versiones fijadas, nunca móviles ───────────────────────────────────────
  for (const [key, value] of [
    ["postgresImage", s.database.image],
    ["keycloakImage", s.identity.image],
  ] as const) {
    if (isMovingTag(value)) {
      problems.push(
        `\`${key}\` vale «${value}» y no fija una versión. Una etiqueta móvil convierte ` +
          "cualquier reinicio de pod en una actualización no planificada, y en un solo nodo " +
          "eso ocurre cada vez que se reinicia el VPS (INF-01 §5).",
      );
    }
  }

  return problems;
}

/**
 * El `server` del kubeconfig tiene que ser el bucle local.
 *
 * Es una cicatriz de `../iaac`, y cuesta una tarde si se descubre por las malas: CI
 * abre un túnel SSH al VPS antes de `pulumi up`, así que el proveedor de Kubernetes
 * tiene que salir por `localhost`. Con la IP del VPS en el kubeconfig, el proveedor
 * intenta ir por fuera del túnel contra un puerto 6443 que no responde desde internet
 * (`INF-01` §1.4), y el error no dice nada de túneles.
 *
 * Pura, para que tenga prueba. `loadSettings` la aplica sobre el secreto.
 */
export function checkKubeconfigServer(kubeconfig: string): string[] {
  const servers = [...kubeconfig.matchAll(/^\s*server:\s*(\S+)\s*$/gm)].map((m) => m[1] ?? "");
  if (servers.length === 0) {
    return ["El kubeconfig no declara ningún `server`: no hay a dónde conectarse."];
  }
  return servers
    .filter((server) => {
      const host = server.replace(/^[a-z]+:\/\//i, "").split("/")[0]?.split(":")[0] ?? "";
      return host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]";
    })
    .map(
      (server) =>
        `El kubeconfig apunta a «${server}». Tiene que apuntar a localhost: CI llega al API ` +
        "de k3s por un túnel SSH y el 6443 no responde desde internet (INF-01 §1.4). Con la " +
        "dirección del VPS, el proveedor sale por fuera del túnel y el error no menciona el " +
        "túnel por ninguna parte.",
    );
}

/** Compone el mensaje de un stack que contradice la documentación. */
export function describeProblems(environment: string, problems: string[]): string {
  return (
    `La configuración del stack «${environment}» contradice la documentación:\n` +
    problems.map((p) => `  · ${p}`).join("\n")
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Entrada real
// ─────────────────────────────────────────────────────────────────────────────

/** Lee y valida la configuración del stack. Lanza si algo contradice la documentación. */
export function loadSettings(): Settings {
  const config = new pulumi.Config();
  const environment = pulumi.getStack() as Environment;

  const reader: ConfigReader = {
    text: (key) => config.get(key),
    number: (key) => config.getNumber(key),
    boolean: (key) => config.getBoolean(key),
    object: <T>(key: string) => config.getObject<T>(key),
  };

  const invariants = readInvariants(environment, reader);

  const problems = checkInvariants(invariants);
  if (problems.length > 0) {
    throw new Error(describeProblems(environment, problems));
  }

  const kubeconfig = config.requireSecret("kubeconfig").apply((raw) => {
    const kubeProblems = checkKubeconfigServer(raw);
    if (kubeProblems.length > 0) {
      throw new Error(describeProblems(environment, kubeProblems));
    }
    return raw;
  });

  return {
    ...invariants,
    kubeconfig,
    backupCredentials: {
      accessKeyId: config.requireSecret("backupAccessKeyId"),
      secretAccessKey: config.requireSecret("backupSecretAccessKey"),
    },
    registryCredentials: {
      username: config.require("registryUsername"),
      token: config.requireSecret("registryPullToken"),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenciones de nombres y etiquetas
// ─────────────────────────────────────────────────────────────────────────────

/** El namespace del SGTM en el nodo. Uno por ambiente. */
export function namespaceName(environment: Environment): string {
  return `sgtm-${environment}`;
}

/** Convención de nombres: `sgtm-<ambiente>-<componente>`. */
export function resourceName(environment: Environment, component: string): string {
  return `sgtm-${environment}-${component}`;
}

/** Etiquetas obligatorias. Van en todo objeto que se crea aquí. */
export function commonLabels(
  environment: Environment,
  component: string,
): Record<string, string> {
  return {
    proyecto: "sgtm",
    ambiente: environment,
    componente: component,
    "gestionado-por": "pulumi",
  };
}
