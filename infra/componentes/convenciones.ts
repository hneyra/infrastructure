import {
  commonLabels,
  namespaceName,
  resourceName,
  type Environment,
  type PerfilDeRecursos,
} from "../config";
import type {
  Contenedor,
  MontajeDeVolumen,
  PriorityClass,
  Recursos,
  SecurityContext,
  Sonda,
  VariableDeEntorno,
  Volumen,
} from "./tipos";

/**
 * Lo que comparten los cinco componentes: nombres, prioridades, tamanos y sondas.
 *
 * Esta aqui por un motivo concreto y no por gusto de factorizar: **las convenciones de
 * `INF-01` §4 son las cuatro cosas que `../iaac` aprendio operando esta misma
 * combinacion**, y una convencion que cada componente escribe a su manera deja de ser
 * una convencion a la tercera vez que alguien la copia.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Secretos: se referencian por nombre, nunca por valor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los `Secret` que estos manifiestos **leen y no crean**.
 *
 * `ADR-0011` §3: las claves de `sgtm_owner`, de `sgtm_app` y del administrador de
 * Keycloak **no estan en el estado de Pulumi**. Estos manifiestos solo nombran el
 * `Secret` y la clave dentro de el; quien los pone es quien provisiona el ambiente, y
 * de donde salen de verdad lo decide el issue #154.
 *
 * La consecuencia hay que saberla: **`pulumi up` sobre un clúster donde estos secretos
 * no existan deja los pods esperando**, con el `Secret` ausente en el evento del pod.
 * Es preferible a la alternativa —generarlos aqui— porque una clave generada por
 * Pulumi vive en el estado de Pulumi, y esa clave abre el padron de todas las
 * municipalidades. Los pasos para crearlos estan en `infra/README.md`.
 */
export interface Secretos {
  /** Superusuario del motor. Solo lo usa el propio contenedor de PostgreSQL. */
  motor: string;
  /** `sgtm_owner`: DDL. Solo los dos Jobs y el CronJob de respaldo. Jamas el Deployment de la aplicacion. */
  owner: string;
  /** `sgtm_app`: la aplicacion. Sin DDL, sin `BYPASSRLS`, propietaria de nada. */
  aplicacion: string;
  /** Administrador de arranque de Keycloak, y la clave de su rol en el motor. */
  identidad: string;
  /**
   * `sgtm_respaldo` (issue #155) y la clave de cifrado de wal-g.
   *
   * Dos valores en el mismo `Secret`, igual que `identidad`. Ninguno de los dos es
   * DDL: `sgtm_respaldo` solo puede ejecutar `pg_backup_start`/`pg_backup_stop` —lo
   * minimo que wal-g necesita, comprobado contra un motor real, no `sgtm_owner` ni
   * el superusuario—, y la clave de cifrado nunca sale de este `Secret` y del propio
   * contenedor de PostgreSQL.
   */
  respaldo: string;
  /**
   * `sgtm_monitor` (issue #156): `pg_monitor`, el rol predefinido de PostgreSQL, y
   * nada de DDL. Lo usa el sidecar `postgres-exporter`, en el MISMO pod que el
   * motor —nunca un componente aparte—, asi que no necesita excepcion en
   * `auditoria.ts`.
   */
  monitoreo: string;
  /** Clave del administrador de Grafana (issue #156). Grafana nunca esta en una `IngressRoute`. */
  grafana: string;
  /**
   * `rol_carga_parametros` (issue #387): la unica credencial que puede escribir
   * `parametro_tributario` (V6/V7) y las tres tablas de valuacion nacionales (V55).
   * Solo la leen los Jobs de un solo uso de `infra/carga-de-datos/` —
   * `publicar-parametros.sh`, `publicar-cuadros.sh`—; nunca el `Deployment` de la
   * aplicacion, que solo tiene SELECT sobre esa tabla.
   */
  carga: string;
  /**
   * `rol_ingestor_catastro` (P5C, C-7 §6): la unica credencial que puede escribir la
   * proyeccion local de `catastro` dentro de la base de `rentas` —`predio_ref`, `ficha_ref`,
   * `catastro_evento_aplicado` (`V4`) y las dos de valuacion (`V5`)—.
   *
   * Que esa proyeccion sea de solo lectura para la aplicacion no puede ser disciplina del
   * repositorio: es un privilegio, la misma mecanica que `rol_carga_parametros` con los valores
   * normativos. Y hasta C-7 el rol se creaba `NOLOGIN` y **no estaba en este inventario**, asi
   * que nadie le generaba clave ni se la asignaba: existia, tenia los `GRANT` puestos, y no
   * podia abrir una sesion. Es el mismo hueco que #435 encontro con `rol_carga_parametros`,
   * un ambiente mas tarde.
   */
  ingestorDeCatastro: string;
}

export function secretos(environment: Environment): Secretos {
  return {
    motor: resourceName(environment, "postgres-superusuario"),
    owner: resourceName(environment, "postgres-owner"),
    aplicacion: resourceName(environment, "postgres-app"),
    identidad: resourceName(environment, "keycloak"),
    respaldo: resourceName(environment, "postgres-respaldo"),
    monitoreo: resourceName(environment, "postgres-monitoreo"),
    grafana: resourceName(environment, "grafana"),
    carga: resourceName(environment, "postgres-carga"),
    ingestorDeCatastro: resourceName(environment, "postgres-ingestor-catastro"),
  };
}

/** Las claves dentro de cada `Secret`. Se nombran una vez y se citan desde todas partes. */
export const CLAVES = {
  /** Clave del superusuario del motor. */
  superusuario: "clave-superusuario",
  /** Clave de `sgtm_owner`. */
  owner: "clave-owner",
  /** Clave de `sgtm_app`. */
  aplicacion: "clave-app",
  /** Clave del administrador de arranque de Keycloak. */
  administradorDeIdentidad: "clave-administrador",
  /** Clave del rol de Keycloak en PostgreSQL. */
  baseDeIdentidad: "clave-base",
  /** Clave de `sgtm_respaldo`. */
  respaldo: "clave-respaldo",
  /** Clave simetrica (libsodium, 32 bytes en base64) con que wal-g cifra el respaldo. */
  cifradoDeRespaldo: "clave-cifrado",
  /** Clave de `sgtm_monitor`. */
  monitoreo: "clave-monitoreo",
  /** Clave del administrador de Grafana. */
  grafana: "clave-admin",
  /** Clave de `rol_carga_parametros` (issue #387). */
  carga: "clave-carga",
  /** Clave de `rol_ingestor_catastro` (P5C, C-7 §6). */
  ingestorDeCatastro: "clave-ingestor",
} as const;

/**
 * El `Secret` con las credenciales del almacenamiento de objetos (issue #155).
 *
 * **La unica excepcion real a «Pulumi no crea secretos».** `backupAccessKeyId` y
 * `backupSecretAccessKey` SI viven cifrados en la configuracion del stack —
 * `ADR-0011` §3 los clasifica como secretos de *arranque de la infraestructura*, no
 * de la aplicacion: no abren el padron de ninguna municipalidad, solo dejan escribir
 * en el contenedor de respaldo—. Por eso, y solo para este `Secret`, es `index.ts`
 * quien lo crea con `k8s.core.v1.Secret`, en vez de `bootstrap-secretos.sh`. Los
 * componentes de aqui solo necesitan el nombre.
 */
export function secretoDeCredencialesDeRespaldo(environment: Environment): string {
  return resourceName(environment, "postgres-respaldo-credenciales");
}

/** Las claves del `Secret` de `secretoDeCredencialesDeRespaldo`. */
export const CLAVES_DE_CREDENCIALES_DE_RESPALDO = {
  accessKeyId: "access-key-id",
  secretAccessKey: "secret-access-key",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Prioridades: quien se queda cuando el nodo se queda sin memoria
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tres clases de prioridad, y el orden importa.
 *
 * `INF-01` §4: bajo presion de memoria el kubelet desaloja por orden de prioridad, y
 * **sin prioridades declaradas puede desalojar PostgreSQL para dejar sitio a la
 * interfaz**. Con un solo nodo no hay a donde mover la carga desalojada: lo unico que
 * decide quien sobrevive es este numero.
 */
export const PRIORIDADES = {
  /** El motor de datos. Lo ultimo que se desaloja. */
  datos: 1000,
  /** Lo que atiende a personas: la aplicacion, la interfaz y Keycloak. */
  servicio: 500,
  /**
   * Los Jobs. Lo primero que se desaloja, y a proposito: una emision masiva que
   * compite por memoria con la ventanilla tiene que perder ella.
   */
  lote: 100,
} as const;

export type Prioridad = keyof typeof PRIORIDADES;

export function nombreDePrioridad(environment: Environment, prioridad: Prioridad): string {
  return resourceName(environment, `prioridad-${prioridad}`);
}

export function clasesDePrioridad(environment: Environment): PriorityClass[] {
  const descripciones: Record<Prioridad, string> = {
    datos: "El motor de datos. Lo ultimo que se desaloja en un nodo bajo presion.",
    servicio: "Lo que atiende peticiones de personas: aplicacion, interfaz e identidad.",
    lote: "Trabajos de un solo uso. Lo primero que se desaloja.",
  };

  return (Object.keys(PRIORIDADES) as Prioridad[]).map((prioridad) => ({
    apiVersion: "scheduling.k8s.io/v1",
    kind: "PriorityClass",
    metadata: {
      name: nombreDePrioridad(environment, prioridad),
      labels: commonLabels(environment, "prioridades"),
    },
    value: PRIORIDADES[prioridad],
    globalDefault: false,
    description: descripciones[prioridad],
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Tamanos: los de INF-01 §2, en un solo sitio
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⚠ Estimaciones, no mediciones (`INF-01` §2). Se recalibran con la volumetria de la
 * municipalidad piloto, que hoy no existe porque D-01 esta abierta.
 */
const RECURSOS = {
  motor: {
    requests: { cpu: "500m", memory: "2Gi" },
    limits: { cpu: "4", memory: "8Gi" },
  },
  aplicacionWeb: {
    requests: { cpu: "500m", memory: "1Gi" },
    limits: { cpu: "1", memory: "2Gi" },
  },
  aplicacionLote: {
    requests: { cpu: "1", memory: "1Gi" },
    limits: { cpu: "2", memory: "2Gi" },
  },
  /**
   * Los Jobs de un solo uso del despliegue: `migracion` e `implantacion`.
   *
   * Mismos `limits` que `aplicacionLote` —siguen pudiendo usar 2 CPU y 2 Gi cuando el
   * nodo los tiene libres— y `requests` mucho mas bajos. La diferencia no es cosmetica:
   * el `request` es lo que el planificador **reserva y bloquea**, y estos dos Jobs
   * corren a la vez que todos los `Deployment` durante un `pulumi up`.
   *
   * Con 1 CPU de `request` cada uno se llevaban 2 CPU del nodo en el peor momento, y en
   * un nodo justo eso no es lentitud: es que no entran. Y como llevan la clase de
   * prioridad `lote` —la mas baja del clúster a proposito— no pueden desalojar a nadie
   * para entrar, mientras `aplicacion` espera a `implantacion` en su `initContainer`.
   * Nadie cede y el despliegue se cuelga (`capacidad.ts`, issue #252).
   *
   * Bajar el `request` no les quita capacidad de computo: la JVM dimensiona su monton
   * con `MaxRAMPercentage` sobre el **limite**, no sobre la peticion, y los dos son
   * trabajos cortos y dominados por E/S contra PostgreSQL. Lo unico que se pierde es la
   * garantia de tener esa CPU reservada de antemano, que para un Job que puede esperar
   * treinta segundos mas es exactamente lo que sobra.
   *
   * El `CronJob` de `lote` NO usa este perfil y sigue con `aplicacionLote`: una emision
   * masiva a las 02:00 sí quiere su CPU reservada, y a esa hora el nodo la tiene.
   *
   * **250m → 100m el 2026-08-26**, por el mismo razonamiento y una medicion mas: sobre
   * `vmd120205` estos dos Jobs eran TODO el desajuste. Lo permanente de `prod` pide
   * 1 540m y el nodo reparte 1 800m; el pico llegaba a 2 060m porque `migracion` e
   * `implantacion` sumaban 500m que solo existen durante el `pulumi up`. Con 100m cada
   * uno el pico baja a 1 760m y `prod` cabe en el nodo **tal como esta hoy**, sin
   * esperar a la ventana de mantenimiento que corrige la reserva.
   *
   * Lo que NO cambia: el `limits` sigue en 2 CPU, asi que los dos Jobs siguen pudiendo
   * usar toda la CPU que el nodo tenga libre —y la tiene: 1 760m pedidos de 1 800m es
   * lo RESERVADO, no lo usado, y los `Deployment` en reposo no gastan lo suyo—. Un
   * `request` bajo solo significa poca garantia previa, y para un trabajo corto,
   * dominado por E/S contra PostgreSQL y que puede tardar treinta segundos mas, esa
   * garantia es justo lo que sobra.
   */
  arranque: {
    requests: { cpu: "100m", memory: "512Mi" },
    limits: { cpu: "2", memory: "2Gi" },
  },
  interfaz: {
    requests: { cpu: "50m", memory: "64Mi" },
    limits: { cpu: "200m", memory: "128Mi" },
  },
  identidad: {
    requests: { cpu: "250m", memory: "512Mi" },
    limits: { cpu: "1", memory: "1Gi" },
  },
  /** Los contenedores de espera y los guiones de `psql`: minusculos, pero declarados. */
  auxiliar: {
    requests: { cpu: "10m", memory: "32Mi" },
    limits: { cpu: "200m", memory: "128Mi" },
  },
  /** `postgres-exporter`, `node-exporter`: solo leen y traducen, casi no piden nada. */
  exportador: {
    requests: { cpu: "10m", memory: "32Mi" },
    limits: { cpu: "100m", memory: "64Mi" },
  },
  /** Prometheus: guarda series en memoria antes de volcarlas a disco (issue #156). */
  prometheus: {
    requests: { cpu: "100m", memory: "256Mi" },
    limits: { cpu: "500m", memory: "1Gi" },
  },
  alertmanager: {
    requests: { cpu: "10m", memory: "32Mi" },
    limits: { cpu: "200m", memory: "128Mi" },
  },
  kubeStateMetrics: {
    requests: { cpu: "10m", memory: "64Mi" },
    limits: { cpu: "200m", memory: "256Mi" },
  },
  grafana: {
    requests: { cpu: "50m", memory: "128Mi" },
    limits: { cpu: "500m", memory: "512Mi" },
  },
  // `satisfies` y no una anotacion de tipo: asi `recursos.motor` es un `Recursos` y no
  // un `Recursos | undefined`, y a la vez cada entrada se comprueba contra el tipo.
} satisfies Record<string, Recursos>;

/** La tabla que recibe cada componente. Se resuelve una vez, en `componentes/index.ts`. */
export type TablaDeRecursos = typeof RECURSOS;

/**
 * Lo que el perfil `minimo` baja, y **solo** lo que baja (`C-19`).
 *
 * Es un ambiente de ENSAYO: su base tiene la municipalidad de demostracion, no un padron
 * real. Lo que cambia son `requests` —lo que el planificador RESERVA y bloquea—; **ningun
 * `limits` se toca**, asi que el motor sigue pudiendo usar las 4 CPU y los 8 Gi que tenga
 * libres el nodo. Un `request` bajo no es menos computo: es menos garantia previa, que es
 * el mismo razonamiento con que `RECURSOS.arranque` bajo de 250m a 100m en el issue #252.
 *
 * **Es una sola entrada, y esta medido por que**: quitando el monolito de `stg` (C-19 §1)
 * su pico queda en 1 820m / 7 552Mi contra 3 800m / 7 008Mi disponibles — sobra CPU y
 * faltan 544Mi. El unico sitio donde 544Mi existen sin inventar holgura es el motor, que
 * es el mayor consumidor del ambiente por un factor de cuatro. Bajarlo a 1Gi deja el pico
 * en 6 528Mi, con 480Mi de margen.
 *
 * Lo que NO se toca, y a proposito:
 * - **la CPU del motor**, porque la CPU no es lo que falta en `stg` (1 820m de 3 800m) y
 *   bajar lo que no estorba es cambiar sin motivo;
 * - **la identidad**, porque Keycloak es lo unico de la plataforma que ya se vio
 *   reiniciarse en el clúster real (C-17), y bajar el `request` de un pod que de verdad
 *   usa esa memoria es justo lo que lo hace desalojable antes;
 * - **la observabilidad**, 180m / 512Mi entre los cinco: es barata y hay verificaciones
 *   que la ejercitan.
 *
 * ⚠ La cifra sigue siendo una ESTIMACION, como la de arriba (`INF-01` §2). Lo que C-19
 * mide es que el ambiente quepa; que 1Gi sea lo justo se sabra con volumetria.
 */
const AJUSTES_DEL_PERFIL_MINIMO = {
  motor: {
    requests: { cpu: "500m", memory: "1Gi" },
    limits: { cpu: "4", memory: "8Gi" },
  },
} satisfies Partial<Record<keyof TablaDeRecursos, Recursos>>;

/**
 * La tabla de recursos de un perfil.
 *
 * **La tabla base no se exporta, y eso es la guarda.** Hasta C-19 `RECURSOS` era una
 * constante exportada que los seis componentes leian directamente, de modo que un perfil
 * podia declarar una entrada y no aplicarse a nada. Sin export, un componente que la
 * quisiera **no compila** — la misma clase de barrera que C-14 midio con `M3`, donde el
 * defecto no se puede ni escribir—. Lo que si se puede escribir, y por eso tiene su
 * prueba, es una entrada del perfil que no la consuma nadie.
 */
export function recursosDe(perfil: PerfilDeRecursos): TablaDeRecursos {
  return perfil === "minimo" ? { ...RECURSOS, ...AJUSTES_DEL_PERFIL_MINIMO } : RECURSOS;
}

/** Las entradas que el perfil `minimo` cambia. La prueba de C-19 exige que todas se apliquen. */
export const ENTRADAS_DEL_PERFIL_MINIMO = Object.keys(
  AJUSTES_DEL_PERFIL_MINIMO,
) as (keyof TablaDeRecursos)[];

// ─────────────────────────────────────────────────────────────────────────────
// Sondas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El `timeoutSeconds` de toda sonda de este repositorio.
 *
 * Tres segundos, no uno. El uno es el valor por omision del kubelet y es el que mata
 * contenedores sanos en un nodo ocupado (`INF-01` §4). La auditoria exige que este
 * entre 3 y 5: por debajo vuelve el problema, y por encima la sonda tarda tanto en
 * declarar un fallo real que deja de servir.
 */
export const ESPERA_DE_SONDA = 3;

export function sondaHttp(path: string, port: number, extra: Partial<Sonda> = {}): Sonda {
  return {
    httpGet: { path, port },
    timeoutSeconds: ESPERA_DE_SONDA,
    periodSeconds: 10,
    ...extra,
  };
}

export function sondaExec(command: string[], extra: Partial<Sonda> = {}): Sonda {
  return {
    exec: { command },
    timeoutSeconds: ESPERA_DE_SONDA,
    periodSeconds: 10,
    ...extra,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Endurecimiento de contenedores (issue #157)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lo que va en TODO contenedor, sin excepcion: nada de escalada de privilegios, y
 * ninguna capacidad Linux de mas alla de las que el propio contenedor nombra por
 * `extra.capabilities.add` -casi nunca ninguna: la mayoria no necesita ni una-.
 *
 * `allowPrivilegeEscalation: false` si es universal sin excepcion. `capabilities.drop:
 * ["ALL"]` tambien lo es, pero dropear TODO vuelve a "root" literalmente incapaz de sus
 * propias operaciones -en Linux el privilegio de root viene de las capacidades, no del
 * UID-: el `entrypoint` de PostgreSQL, que arranca como root a proposito para tomar
 * posesion de `PGDATA` con `chown`, se rompio exactamente asi -"Operation not
 * permitted", encontrado en CI-. La correccion no es dejar de dropear TODO: es que ESE
 * contenedor re-conceda por nombre lo que su `entrypoint` necesita (ver
 * `BaseDeDatos.ts`), y ningun otro.
 */
export function seguridadBase(extra: Partial<SecurityContext> = {}): SecurityContext {
  return {
    allowPrivilegeEscalation: false,
    ...extra,
    capabilities: { drop: ["ALL"], ...extra.capabilities },
  };
}

/**
 * La misma base, mas `runAsNonRoot: true`: lo que usa casi todo contenedor de este
 * repositorio. Los que NO la usan lo dicen en su propio sitio, con el motivo —hoy,
 * solo el `entrypoint` del motor de PostgreSQL (`BaseDeDatos.ts`), que necesita
 * arrancar como root para tomar posesion del volumen antes de bajar privilegios.
 */
export function seguridadSinRoot(extra: Partial<SecurityContext> = {}): SecurityContext {
  return seguridadBase({ runAsNonRoot: true, ...extra });
}

// ─────────────────────────────────────────────────────────────────────────────
// Nombres de servicio y de base
// ─────────────────────────────────────────────────────────────────────────────

/** La base del padron. El nombre es el mismo que en el compose. */
export const BASE_DEL_PADRON = "sgtm";

/**
 * La base de Keycloak. **Separada**, no un esquema mas de la del padron.
 *
 * Keycloak hace DDL sobre su propia base en cada actualizacion menor; darle eso sobre
 * la base que sostiene RLS seria abrirle DDL al padron. Con base y rol propios, la
 * unica frontera que hay que vigilar es la del motor.
 */
export const BASE_DE_IDENTIDAD = "keycloak";

/** El rol con que Keycloak se conecta a su base. No es ninguno de los cuatro del SGTM. */
export const ROL_DE_IDENTIDAD = "keycloak";

export function servicioDeBaseDeDatos(environment: Environment): string {
  return resourceName(environment, "postgres");
}

/**
 * El volumen de datos del motor. Un solo sitio: lo monta `BaseDeDatos.ts` en
 * lectura-escritura y `Respaldo.ts` en **solo lectura** (issue #155) — wal-g lee
 * `PGDATA` directamente, y montarlo dos veces con el mismo nombre calculado por
 * separado es la clase de duplicacion que se desincroniza la primera vez que
 * alguien cambia uno de los dos sitios.
 */
export function volumenDeDatos(environment: Environment): string {
  return resourceName(environment, "postgres-datos");
}

export function servicioDeIdentidad(environment: Environment): string {
  return resourceName(environment, "identidad");
}

export function servicioDeAplicacion(environment: Environment): string {
  return resourceName(environment, "aplicacion");
}

export function servicioDeInterfaz(environment: Environment): string {
  return resourceName(environment, "interfaz");
}

/** El puerto en que escucha el motor. Un solo sitio, para que no se teclee cinco veces. */
export const PUERTO_DEL_MOTOR = 5432;

/** URL JDBC de la base del padron, dentro del clúster. */
export function urlDelPadron(environment: Environment): string {
  return `jdbc:postgresql://${servicioDeBaseDeDatos(environment)}:${PUERTO_DEL_MOTOR}/${BASE_DEL_PADRON}`;
}

/**
 * El anfitrion del motor visto **desde otro namespace**: `host:puerto`.
 *
 * `urlDelPadron` compone el suyo con el nombre corto del servicio, y puede: el monolito vive en
 * el MISMO namespace que el motor. Los cuatro sistemas no —desde ADR-0031 cada uno tiene el
 * suyo—, y un nombre corto no resuelve al cruzar: la busqueda de `postgres` a secas termina en
 * `NXDOMAIN`, no en el motor de al lado.
 *
 * Es la misma correccion que C-14 le hizo al JWKS y por el mismo motivo, un componente mas abajo.
 */
export function anfitrionDelMotor(environment: Environment): string {
  return `${servicioDeBaseDeDatos(environment)}.${namespaceName(environment)}:${PUERTO_DEL_MOTOR}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Observabilidad: nombres de servicio (issue #156)
// ─────────────────────────────────────────────────────────────────────────────

export function servicioDePrometheus(environment: Environment): string {
  return resourceName(environment, "observabilidad-prometheus");
}

export function servicioDeAlertmanager(environment: Environment): string {
  return resourceName(environment, "observabilidad-alertmanager");
}

export function servicioDeNodeExporter(environment: Environment): string {
  return resourceName(environment, "observabilidad-node-exporter");
}

export function servicioDeKubeStateMetrics(environment: Environment): string {
  return resourceName(environment, "observabilidad-kube-state-metrics");
}

export function servicioDeGrafana(environment: Environment): string {
  return resourceName(environment, "observabilidad-grafana");
}

// ─────────────────────────────────────────────────────────────────────────────
// Identidad: el emisor es publico, el JWKS es interno
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Keycloak cuelga de `/keycloak` del mismo dominio.
 *
 * No es una decision nueva: es la convencion que `publicar-imagenes.yml` ya usa para
 * compilar la interfaz de cada ambiente (`https://<dominio>/keycloak`), y la misma que
 * `../iaac`. Cambiarla aqui obligaria a reconstruir la imagen de la interfaz.
 */
export function emisorPublico(domain: string, realm: string): string {
  return `https://${domain}/keycloak/realms/${realm}`;
}

/**
 * De donde se traen las claves de firma. **Interno, y a proposito.**
 *
 * `issuer-uri` es una identidad: se compara con el `iss` del token y tiene que ser el
 * nombre publico. `jwk-set-uri` es una direccion de red: el backend va a buscar las
 * claves y le conviene no salir al ingreso para volver a entrar. Confundirlos cuesta
 * una tarde y produce un 401 mudo (issue #151).
 */
/**
 * La etiqueta con la que un `Namespace` dice que es **de un sistema** y no de la plataforma.
 *
 * Existe por una regla de Kubernetes: un `podSelector` sin `namespaceSelector` selecciona pods
 * **del mismo namespace**, y desde ADR-0031 cada sistema tiene el suyo. Sin esto, las politicas de
 * la plataforma que abren PostgreSQL y Keycloak solo abren para los pods de la plataforma, de modo
 * que los cuatro sistemas quedan sin base y sin poder validar un token — y no falla ruidosamente:
 * el pod arranca, la sonda de arranque no pasa nunca y el `pulumi up` espera.
 *
 * Se selecciona por etiqueta y no por nombre porque los nombres son cuatro y crecerian con cada
 * sistema; y no se reutiliza `proyecto`/`ambiente` porque esos los lleva **tambien** el namespace
 * de la plataforma, y entonces la regla abriria PostgreSQL a la interfaz, que es justo lo que
 * `permitirIngresoPostgres` existe para impedir.
 */
/**
 * Los cuatro sistemas del producto, en el orden de ADR-0029.
 *
 * Vive aqui —y no en `descriptor/sistemas.ts`— porque quien la necesita es la PLATAFORMA: es de
 * esta lista de donde salen las cuatro bases que el motor provisiona al arrancar. `componentes/`
 * no puede importar de `descriptor/`, que es quien compone los descriptores ajenos.
 *
 * Y no es una quinta lista escrita a mano: `descriptor.test.ts` comprueba que estos cuatro sean
 * exactamente los que `SISTEMAS` compone, de modo que un sistema nuevo no puede entrar por un
 * lado y quedarse sin base por el otro.
 */
export const SISTEMAS_DEL_PRODUCTO = ["rentas", "catastro", "normativa", "caja"] as const;

export const ETIQUETA_DE_NAMESPACE_DE_SISTEMA = { "kamayuk-sistema": "si" } as const;

export function jwksInterno(environment: Environment, realm: string): string {
  const servicio = servicioDeIdentidad(environment);
  return `http://${servicio}:8080/keycloak/realms/${realm}/protocol/openid-connect/certs`;
}

// ─────────────────────────────────────────────────────────────────────────────
// wal-g: version fijada, y el binario que la descarga (issue #155)
// ─────────────────────────────────────────────────────────────────────────────

/** La version de wal-g. Subirla es un cambio deliberado, nunca una etiqueta movil. */
export const WALG_VERSION = "3.0.5";

/**
 * El sha256 del binario de esa version, verificado a mano al fijarla —descargado y
 * comprobado contra el `.sha256` que publica el propio proyecto en el mismo release,
 * la misma vez que se elige `WALG_VERSION`—. Se compara contra este valor y no solo
 * contra el `.sha256` publicado: es la misma precaucion que
 * `.github/actions/instalar-gitleaks/action.yml`, porque un release comprometido
 * traeria los dos archivos comprometidos a la vez.
 */
export const WALG_SHA256 = "b412489168a4ab74aaeb91c06e297573e3950599e839116177f196005e915d0f";

/** Imagen minima con `curl`, `tar` y `sha256sum` para el contenedor que lo descarga. */
export const IMAGEN_DE_DESCARGA = "curlimages/curl:8.11.0";

/**
 * Buzon SMTP de pruebas (ADR-0012). Solo `stg`: la escalera comprueba que Keycloak
 * ENVIA el enlace de clave, no que llegue a un correo real. En `prod` el relay es
 * externo y de verdad (`INF-03` §4).
 */
export const IMAGEN_DE_MAILPIT = "axllent/mailpit:v1.20";

/** Donde queda el binario dentro del pod, en el volumen compartido `wal-g-bin`. */
export const WALG_DIRECTORIO = "/opt/wal-g";
export const WALG_BINARIO = `${WALG_DIRECTORIO}/wal-g`;

/**
 * El contenedor de inicializacion que descarga wal-g y verifica su checksum, antes de
 * que el contenedor principal —el motor, o el CronJob de respaldo— pueda usarlo.
 *
 * Un binario de unos 64 MB no cabe en un `ConfigMap` —el limite practico de `etcd`
 * son unos 1,5 MB por objeto—, asi que no se puede montar como los guiones de
 * `fuentes.ts`: hay que descargarlo al arrancar el pod, verificarlo, y dejarlo listo
 * en un volumen `emptyDir` que el contenedor principal monta de solo lectura.
 *
 * Comparten esto `BaseDeDatos.ts` y `Respaldo.ts`: el motor lo necesita para
 * `archive_command`/`restore_command`, y el CronJob de respaldo para `backup-push`.
 * Definirlo una vez es lo que evita que las dos copias de la logica de descarga se
 * separen la primera vez que alguien actualice `WALG_VERSION` en un solo sitio.
 */
export function contenedorDeDescargaDeWalg(recursos: TablaDeRecursos): Contenedor {
  const url =
    `https://github.com/wal-g/wal-g/releases/download/v${WALG_VERSION}/` +
    "wal-g-pg-ubuntu-20.04-amd64.tar.gz";
  return {
    name: "wal-g-instalar",
    image: IMAGEN_DE_DESCARGA,
    command: ["/bin/sh", "-c"],
    args: [
      [
        "set -eu",
        `curl -fsSL -o /tmp/wal-g.tar.gz "${url}"`,
        // Verifica contra el sha256 fijado arriba, no contra un archivo descargado
        // en el mismo momento: eso solo comprobaria que la descarga no se corrompio
        // en transito, no que el release sea el que se audito al fijar la version.
        `echo "${WALG_SHA256}  /tmp/wal-g.tar.gz" | sha256sum -c -`,
        "tar -xzf /tmp/wal-g.tar.gz -C /tmp",
        `mv /tmp/wal-g-pg-ubuntu-20.04-amd64 ${WALG_BINARIO}`,
        `chmod +x ${WALG_BINARIO}`,
        "rm -f /tmp/wal-g.tar.gz",
      ].join(" && "),
    ],
    // `curlimages/curl` ya trae su propio usuario sin privilegios -`curl_user`-,
    // pero `runAsUser` SI hace falta nombrarlo (issue #157): la imagen fija ese
    // usuario por NOMBRE, no por numero, y el kubelet rechaza el contenedor sin
    // poder verificar que es no-root -"container has runAsNonRoot and image has
    // non-numeric user (curl_user), cannot verify user is non-root", encontrado en
    // CI-. 65534 no es necesariamente el UID real de `curl_user`, y no hace falta
    // que lo sea: el volumen que monta es un `emptyDir` -escribible por cualquier
    // UID por convencion del kubelet- y el resto de la tarea (`curl`, `sha256sum`,
    // `tar`, `chmod`, `mv`) no depende de poseer ningun archivo de la imagen.
    // `readOnlyRootFilesystem` es lo que el issue #157 pide «donde se pueda», y aqui
    // se puede sin adivinar: la tarea entera escribe en exactamente dos sitios, los
    // dos leibles de sus propios `args` de arriba -`/tmp`, para el `.tar.gz` que
    // descarga y desempaqueta, y `WALG_DIRECTORIO`, que es el `emptyDir` compartido-.
    // Ninguno de los dos es el sistema de archivos raiz una vez que `/tmp` tambien
    // viene montado (`volumenDeTmpDeWalg`), asi que sellarlo no le quita nada y le
    // cierra al binario descargado la posibilidad de dejar algo fuera de su volumen.
    //
    // **Ejecutado, no razonado**, contra la imagen real -`curlimages/curl:8.11.0`, los
    // `args` exactos de abajo, `--read-only`, UID 65534, todas las capacidades caidas y
    // `no-new-privileges`, con los dos `emptyDir` emulados como directorios 1777-:
    //
    //   A) con `/tmp` montado, como lo declara este manifiesto -> exit 0. Deja
    //      `/opt/wal-g/wal-g` de 64 402 920 bytes en modo 0755, `/tmp` vacio tras el
    //      `rm` final, y el binario arranca: «wal-g version v3.0.5 94bf839». De paso
    //      confirma que `WALG_SHA256` es el del release de verdad.
    //   B) sellando la raiz SIN montar `/tmp` -> exit 23, «curl: (23) client returned
    //      ERROR on write of 16384 bytes». En Kubernetes eso es un init container que
    //      no termina, y detras un motor que nunca llega a Ready.
    //   C) sin sellar la raiz y sin `/tmp` -haciendo memoria: el estado anterior a este
    //      cambio- -> exit 0. Por eso el par no se notaba: solo importa una vez sellada.
    //
    // De ahi que el montaje de `/tmp` y este `readOnlyRootFilesystem` sean una sola
    // decision y no dos, y que `componentes.test.ts` los exija juntos.
    securityContext: seguridadSinRoot({ runAsUser: 65534, readOnlyRootFilesystem: true }),
    resources: recursos.auxiliar,
    volumeMounts: [
      { name: "wal-g-bin", mountPath: WALG_DIRECTORIO },
      { name: "wal-g-tmp", mountPath: "/tmp" },
    ],
  };
}

/** El volumen `emptyDir` que comparte el binario entre el contenedor de descarga y el que lo usa. */
export function volumenDeWalg(): Volumen {
  return { name: "wal-g-bin", emptyDir: {} };
}

/**
 * El `/tmp` del contenedor de descarga, para que su raiz pueda ir de solo lectura.
 *
 * Va aparte de `wal-g-bin` a proposito: ese lo monta tambien el contenedor principal
 * —de solo lectura, con `montajeDeWalg()`—, y el `.tar.gz` intermedio no tiene por que
 * asomar ahi. Un `emptyDir` es escribible por cualquier UID por convencion del
 * kubelet, que es lo que deja que el `runAsUser: 65534` de arriba escriba en el sin
 * tener que coincidir con el usuario de la imagen.
 */
export function volumenDeTmpDeWalg(): Volumen {
  return { name: "wal-g-tmp", emptyDir: {} };
}

/** Donde monta el binario el contenedor que YA no lo descarga: siempre de solo lectura. */
export function montajeDeWalg(): MontajeDeVolumen {
  return { name: "wal-g-bin", mountPath: WALG_DIRECTORIO, readOnly: true };
}

/**
 * Las variables de entorno de wal-g, en un solo sitio.
 *
 * Las usan tres procesos distintos: `archive_command`/`restore_command` del motor
 * (`BaseDeDatos.ts`) y `backup-push`/`delete` del CronJob de respaldo
 * (`Respaldo.ts`). Definirlas una vez es lo que impide que un cambio de proveedor de
 * almacenamiento se aplique en un sitio y se olvide en el otro.
 *
 * `WALG_S3_FORCE_PATH_STYLE=true` se dejó puesto al decidir el proveedor —AWS S3
 * (issue #158)— porque sigue funcionando ahí, y quitarlo no aporta nada: no hay
 * necesidad de arriesgar el cambio a virtual-hosted-style sin un motivo concreto.
 *
 * `AWS_REGION` es obligatorio contra un S3 real: el SDK firma cada petición con la
 * región incluida, y un valor equivocado —o ausente— no da un error de permisos, da
 * uno de firma que no dice cuál es la región correcta (confirmado contra un bucket
 * real, issue #158).
 */
export function variablesWalg(args: {
  backup: { endpoint: string; region: string; bucket: string };
  credenciales: string;
  secretoDeRespaldo: string;
}): VariableDeEntorno[] {
  return [
    { name: "WALG_S3_PREFIX", value: `s3://${args.backup.bucket}` },
    { name: "AWS_ENDPOINT", value: args.backup.endpoint },
    { name: "AWS_REGION", value: args.backup.region },
    { name: "WALG_S3_FORCE_PATH_STYLE", value: "true" },
    { name: "WALG_COMPRESSION_METHOD", value: "lz4" },
    {
      name: "AWS_ACCESS_KEY_ID",
      valueFrom: {
        secretKeyRef: { name: args.credenciales, key: CLAVES_DE_CREDENCIALES_DE_RESPALDO.accessKeyId },
      },
    },
    {
      name: "AWS_SECRET_ACCESS_KEY",
      valueFrom: {
        secretKeyRef: {
          name: args.credenciales,
          key: CLAVES_DE_CREDENCIALES_DE_RESPALDO.secretAccessKey,
        },
      },
    },
    // Cifra cada backup base y cada segmento de WAL. Nunca un valor literal: sale
    // del mismo `Secret` que genera `bootstrap-secretos.sh`, jamas de Pulumi.
    {
      name: "WALG_LIBSODIUM_KEY",
      valueFrom: { secretKeyRef: { name: args.secretoDeRespaldo, key: CLAVES.cifradoDeRespaldo } },
    },
  ];
}
