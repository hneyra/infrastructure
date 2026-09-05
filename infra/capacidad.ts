import { podsDe, type Manifiesto } from "./componentes/tipos";

/**
 * ¿Cabe el stack en el nodo? Leido de los manifiestos y de lo que el nodo declara.
 *
 * **Existe porque un `pulumi up` que no cabe no falla: se cuelga.** El
 * `ConfigGroup` de `index.ts` no se da por creado hasta que todos sus `Deployment`
 * quedan `Ready`, y un pod que el planificador no puede ubicar se queda `Pending`
 * para siempre —«`Insufficient cpu`»—, sin error, sin registro y sin fin. En
 * `aplicar-prod` eso son seis horas de runner consumidas antes de que la plataforma
 * lo mate, con el grupo de concurrencia `infra-aplicar-prod` retenido todo ese rato.
 * Sin esta comprobacion, el sintoma que llega a quien mira Actions es «el trabajo
 * sigue corriendo», que no dice absolutamente nada.
 *
 * Es el mismo defecto que ya se pago dos veces en este repositorio:
 *
 * - 2026-08-24 (issue #158): el stack entero contra un nodo de 2 vCPU/4 GB. Los
 *   `requests` ocupaban el 99 % de la memoria antes de ubicar `interfaz` ni la
 *   observabilidad, y se quedaban `Pending`. Costo desplegar de verdad descubrirlo;
 *   quedo escrito en `INF-01` §2 —«4 GB de RAM no alcanza»— pero **nada lo
 *   comprobaba**.
 * - 2026-08-25: `aplicar-prod` colgado, cuatro corridas seguidas. La reserva del
 *   nodo del issue #157 —1 CPU y 1 Gi de `system-reserved` mas otro tanto de
 *   `kube-reserved`— se aplico solo a `prod` el 2026-08-23, y le dejo **2 CPU
 *   asignables de las 4 que tiene**. La demanda de `prod` es mayor que eso, asi que
 *   desde ese dia `prod` no puede ubicar su propio stack. `stg`, sin la reserva
 *   aplicada y pidiendo menos, siguio desplegando en veinte segundos — de ahi que el
 *   sintoma pareciera «prod esta roto y stg no» en vez de «prod ya no cabe».
 *
 * La leccion de las dos es la misma, y es la que este modulo escribe: **la capacidad
 * del nodo es un dato, y lo que el stack pide se puede sumar.** Comparar las dos
 * cifras cuesta milisegundos y no necesita clúster; descubrirlo desplegando cuesta
 * horas y deja el ambiente a medias.
 *
 * Corre en los dos sitios donde importa, igual que `auditarManifiestos`:
 *
 * - En `yarn verificar`, sobre los dos ambientes: subir `webReplicas` por encima de
 *   lo que el nodo aguanta se pone rojo **en el PR**, no en el despliegue.
 * - En `index.ts`, antes de crear ningun recurso.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Cantidades de Kubernetes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Milicores a partir de una cantidad de CPU de Kubernetes.
 *
 * `"500m"` son 500; `"2"` son 2000; `"0.5"` son 500. Las tres formas aparecen en
 * `RECURSOS` y en lo que devuelve el API server, asi que las tres se admiten.
 */
export function cpuEnMili(cantidad: string | undefined): number {
  if (!cantidad) return 0;
  const texto = cantidad.trim();
  if (texto.endsWith("m")) return Math.round(Number(texto.slice(0, -1)));
  return Math.round(Number(texto) * 1000);
}

/** Los sufijos de memoria de Kubernetes, en Mi. Binarios y decimales: el API usa `Ki`. */
const SUFIJOS_DE_MEMORIA: Record<string, number> = {
  "": 1 / (1024 * 1024),
  Ki: 1 / 1024,
  Mi: 1,
  Gi: 1024,
  Ti: 1024 * 1024,
  K: 1000 / (1024 * 1024),
  M: 1000000 / (1024 * 1024),
  G: 1000000000 / (1024 * 1024),
};

/**
 * Mebibytes a partir de una cantidad de memoria de Kubernetes.
 *
 * Se admite `Ki` porque es lo que devuelve `kubectl get node -o jsonpath` para lo
 * asignable, que es de donde salen los valores de `nodeAllocatableMemory`: pedirle a
 * quien mide el nodo que ademas convierta a mano es pedirle que se equivoque.
 */
export function memoriaEnMi(cantidad: string | undefined): number {
  if (!cantidad) return 0;
  const partes = /^(\d+(?:\.\d+)?)([A-Za-z]*)$/.exec(cantidad.trim());
  const numero = partes?.[1];
  const sufijo = partes?.[2];
  if (numero === undefined || sufijo === undefined) {
    throw new Error(`No es una cantidad de memoria de Kubernetes: «${cantidad}».`);
  }
  const factor = SUFIJOS_DE_MEMORIA[sufijo];
  if (factor === undefined) {
    throw new Error(`Sufijo de memoria desconocido en «${cantidad}»: «${sufijo}».`);
  }
  return Number(numero) * factor;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lo que el stack pide
// ─────────────────────────────────────────────────────────────────────────────

export interface Demanda {
  cpuEnMili: number;
  memoriaEnMi: number;
}

export interface DemandaDeUnPod extends Demanda {
  /** `Deployment/kamayuk-prod-aplicacion`, como lo nombra la auditoria. */
  contexto: string;
  clase: string;
  /**
   * El espacio de nombres en el que corre.
   *
   * No es decorativo y no esta aqui para el informe: es lo unico que permite comprobar **que
   * se midio todo**. Desde ADR-0031 cada sistema tiene el suyo, y un namespace no es una
   * maquina —sus pods compiten por la misma CPU y la misma memoria que los de la plataforma—,
   * asi que una suma que se deje uno fuera contesta «cabe» sin haberlo mirado. Es C-16, y con
   * este campo `capacidad.test.ts` puede exigir que los cinco esten dentro.
   */
  espacio: string;
  /** Ya multiplicado por las replicas en `cpuEnMili`/`memoriaEnMi`. */
  replicas: number;
}

export interface DemandaDelStack {
  /** Lo que corre siempre: `Deployment`. Es el piso, y no baja nunca. */
  permanente: Demanda;
  /**
   * Lo permanente **mas los Jobs**, que es lo que hay sobre el nodo durante un
   * `pulumi up`.
   *
   * No es pesimismo: `migracion` e `implantacion` piden 1 CPU cada uno y se crean a
   * la vez que los `Deployment`. Un pod reserva su peticion desde que se ubica, no
   * desde que su contenedor principal arranca, asi que `implantacion` retiene su CPU
   * durante todo el rato que su `initContainer` pasa esperando a `migracion`. Y
   * `aplicacion` no queda `Ready` hasta que `implantacion` termina.
   *
   * Ahi esta el bloqueo mutuo que hace que esto se cuelgue en vez de fallar: los
   * `Deployment` ocupan la CPU, los Jobs no caben, y como los Jobs llevan la clase de
   * prioridad `lote` —la mas baja del clúster a proposito, `INF-01` §2— no pueden
   * desalojar a nadie para entrar. Nadie cede, y `pulumi up` espera.
   */
  picoDeArranque: Demanda;
  pods: DemandaDeUnPod[];
}

/**
 * Lo que un pod reserva, con la regla que aplica Kubernetes de verdad.
 *
 * No es la suma de todos sus contenedores: es el **maximo** entre la suma de los
 * contenedores normales y el mayor de los `initContainer`. Los `initContainer` corren
 * de uno en uno y antes que los demas, asi que el planificador reserva lo que haga
 * falta para la fase mas cara, no para las dos a la vez.
 */
function demandaDelPod(pod: {
  containers: { resources: { requests: { cpu: string; memory: string } } }[];
  initContainers?: { resources: { requests: { cpu: string; memory: string } } }[];
}): Demanda {
  const normales = pod.containers.reduce<Demanda>(
    (acumulado, c) => ({
      cpuEnMili: acumulado.cpuEnMili + cpuEnMili(c.resources.requests.cpu),
      memoriaEnMi: acumulado.memoriaEnMi + memoriaEnMi(c.resources.requests.memory),
    }),
    { cpuEnMili: 0, memoriaEnMi: 0 },
  );
  const iniciales = (pod.initContainers ?? []).reduce<Demanda>(
    (acumulado, c) => ({
      cpuEnMili: Math.max(acumulado.cpuEnMili, cpuEnMili(c.resources.requests.cpu)),
      memoriaEnMi: Math.max(acumulado.memoriaEnMi, memoriaEnMi(c.resources.requests.memory)),
    }),
    { cpuEnMili: 0, memoriaEnMi: 0 },
  );
  return {
    cpuEnMili: Math.max(normales.cpuEnMili, iniciales.cpuEnMili),
    memoriaEnMi: Math.max(normales.memoriaEnMi, iniciales.memoriaEnMi),
  };
}

/** Las replicas con que cuenta cada clase de objeto sobre un nodo unico. */
function replicasDe(m: Manifiesto): number {
  if (m.kind === "Deployment") return m.spec.replicas;
  // Un `CronJob` suspendido no ubica nada: hoy es el de `lote`, que espera a D-02a.
  if (m.kind === "CronJob" && m.spec.suspend === true) return 0;
  return 1;
}

/** Lo que pide el stack entero, separando lo permanente del pico del arranque. */
export function demandaDelStack(manifiestos: Manifiesto[]): DemandaDelStack {
  const pods: DemandaDeUnPod[] = [];

  for (const m of manifiestos) {
    const replicas = replicasDe(m);
    if (replicas === 0) continue;
    for (const { contexto, clase, pod } of podsDe(m)) {
      const unidad = demandaDelPod(pod);
      pods.push({
        contexto,
        clase,
        // `(sin espacio de nombres)` no deberia salir nunca: todo objeto con pods lo declara.
        // Si sale, es una senal y no un adorno — un pod sin namespace no se puede ubicar.
        espacio: m.metadata.namespace ?? "(sin espacio de nombres)",
        replicas,
        cpuEnMili: unidad.cpuEnMili * replicas,
        memoriaEnMi: unidad.memoriaEnMi * replicas,
      });
    }
  }

  const sumar = (elegidos: DemandaDeUnPod[]): Demanda =>
    elegidos.reduce<Demanda>(
      (acumulado, p) => ({
        cpuEnMili: acumulado.cpuEnMili + p.cpuEnMili,
        memoriaEnMi: acumulado.memoriaEnMi + p.memoriaEnMi,
      }),
      { cpuEnMili: 0, memoriaEnMi: 0 },
    );

  return {
    permanente: sumar(pods.filter((p) => p.clase === "Deployment")),
    picoDeArranque: sumar(pods),
    pods: pods.sort((a, b) => b.cpuEnMili - a.cpuEnMili),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ¿Cabe?
// ─────────────────────────────────────────────────────────────────────────────

export interface CapacidadDelNodo {
  /** Lo **asignable**, no la capacidad. Ver `nodeAllocatableCpu` en `config.ts`. */
  cpuAsignable: string;
  memoriaAsignable: string;
}

/**
 * Lo que consumen los pods que k3s trae de fabrica, y que este repositorio no declara.
 *
 * `coredns` y `metrics-server` piden 100m/70Mi cada uno; `traefik`,
 * `local-path-provisioner` y `svclb-traefik` no declaran peticiones en la instalacion
 * de serie de k3s. Redondeado hacia arriba a 200m/160Mi: el margen sobra para lo
 * segundo y no fabrica una holgura que no existe.
 *
 * Se descuenta de lo asignable porque **lo asignable no lo tiene el stack entero para
 * si**: `kubectl get node` informa lo que queda tras la reserva del kubelet, no lo que
 * queda tras los pods del propio Kubernetes.
 */
const FUERA_DEL_STACK: Demanda = { cpuEnMili: 200, memoriaEnMi: 160 };

function comoCpu(mili: number): string {
  return `${String(mili)}m (${(mili / 1000).toFixed(2)} CPU)`;
}

function comoMemoria(mi: number): string {
  return `${String(Math.round(mi))}Mi (${(mi / 1024).toFixed(2)} Gi)`;
}

/**
 * Devuelve los incumplimientos; vacia significa que cabe. Pura, como
 * `auditarManifiestos`.
 *
 * Se comprueba el **pico del arranque**, no lo permanente: lo permanente puede caber
 * de sobra y el despliegue colgarse igual, porque el momento critico es el `pulumi up`
 * —cuando los Jobs de migracion e implantacion estan sobre el nodo a la vez que los
 * `Deployment`—, y ese es justo el momento que este modulo existe para proteger.
 */
export function auditarCapacidad(
  manifiestos: Manifiesto[],
  nodo: CapacidadDelNodo,
): string[] {
  const demanda = demandaDelStack(manifiestos);
  const asignable: Demanda = {
    cpuEnMili: cpuEnMili(nodo.cpuAsignable),
    memoriaEnMi: memoriaEnMi(nodo.memoriaAsignable),
  };
  const disponible: Demanda = {
    cpuEnMili: asignable.cpuEnMili - FUERA_DEL_STACK.cpuEnMili,
    memoriaEnMi: asignable.memoriaEnMi - FUERA_DEL_STACK.memoriaEnMi,
  };

  const problemas: string[] = [];
  const mayores = demanda.pods
    .slice(0, 4)
    .map((p) => `${p.contexto} x${String(p.replicas)} = ${comoCpu(p.cpuEnMili)}`)
    .join("; ");

  if (demanda.picoDeArranque.cpuEnMili > disponible.cpuEnMili) {
    problemas.push(
      `El stack no cabe en el nodo por CPU: pide ${comoCpu(demanda.picoDeArranque.cpuEnMili)} ` +
        `en el pico del arranque y solo hay ${comoCpu(disponible.cpuEnMili)} disponibles ` +
        `(asignable ${comoCpu(asignable.cpuEnMili)} menos ${comoCpu(FUERA_DEL_STACK.cpuEnMili)} ` +
        `de los pods de serie de k3s). Faltan ` +
        `${comoCpu(demanda.picoDeArranque.cpuEnMili - disponible.cpuEnMili)}. ` +
        `Lo permanente por si solo son ${comoCpu(demanda.permanente.cpuEnMili)}; los mayores: ` +
        `${mayores}. Sin esto, \`pulumi up\` NO falla: los pods se quedan \`Pending\` y el ` +
        "despliegue espera indefinidamente (ver la cabecera de este modulo).",
    );
  }

  if (demanda.picoDeArranque.memoriaEnMi > disponible.memoriaEnMi) {
    problemas.push(
      `El stack no cabe en el nodo por memoria: pide ` +
        `${comoMemoria(demanda.picoDeArranque.memoriaEnMi)} en el pico del arranque y solo hay ` +
        `${comoMemoria(disponible.memoriaEnMi)} disponibles (asignable ` +
        `${comoMemoria(asignable.memoriaEnMi)} menos ${comoMemoria(FUERA_DEL_STACK.memoriaEnMi)} ` +
        `de los pods de serie de k3s). Faltan ` +
        `${comoMemoria(demanda.picoDeArranque.memoriaEnMi - disponible.memoriaEnMi)}. ` +
        `Lo permanente por si solo son ${comoMemoria(demanda.permanente.memoriaEnMi)}. ` +
        "INF-01 §2 ya lo dice desde el issue #158: por debajo del piso, el clúster ni " +
        "siquiera termina de programar sus propios pods.",
    );
  }

  return problemas;
}

/** El mismo formato de `describirAuditoria`, para que los dos mensajes se lean igual. */
export function describirCapacidad(environment: string, problemas: string[]): string {
  return [
    `El stack «${environment}» no cabe en el nodo que declara (${String(problemas.length)}):`,
    "",
    ...problemas.map((p) => `  - ${p}`),
    "",
    "Las salidas son tres, y la primera es la que INF-01 §2 ya prescribe:",
    "  1. Un nodo del tamano dimensionado (8 CPU / 16 GB). Es lo que la tabla de INF-01 §2",
    "     dice desde el principio y lo que el issue #158 confirmo desplegando.",
    "  2. Menos demanda: `webReplicas`, o los `requests` de RECURSOS en convenciones.ts.",
    "  3. Menos reserva del nodo: `infra/vps/reservar-recursos-del-nodo.sh` reserva 1 CPU y",
    "     1 Gi por partida doble (system-reserved y kube-reserved). Bajarla devuelve CPU",
    "     asignable, a costa de lo que esa reserva protege (INF-01 §2: sin ella, una rafaga",
    "     de la aplicacion deja sin CPU al kubelet y mueren contenedores sanos).",
    "",
    "Y despues de cambiar el nodo, medirlo otra vez y actualizar `nodeAllocatableCpu`/",
    "`nodeAllocatableMemory` del stack:",
    "",
    "  kubectl get node -o jsonpath='{.items[0].status.allocatable.cpu}{\"/\"}" +
      "{.items[0].status.allocatable.memory}'",
  ].join("\n");
}
