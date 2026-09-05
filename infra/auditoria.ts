import {
  contenedoresDe,
  podsDe,
  sondasDe,
  type Contenedor,
  type EspecificacionDePod,
  type Manifiesto,
} from "./componentes/tipos";

/**
 * Las convenciones de `INF-01` §4 y las no-negociables de la epica, verificadas sobre
 * los manifiestos.
 *
 * Es el equivalente en `infra/` de lo que el escaner de fuentes y ArchUnit son en el
 * backend: **una prohibicion que solo vive en un documento se incumple en seis meses.**
 * Cada regla de aqui viene de una frase escrita —`INF-01` §4, `ADR-0011` §3 y §5, o «lo
 * que no se negocia» de los issues #149 a #153— y cada una tiene en
 * `verificaciones/auditoria.test.ts` el manifiesto que la viola.
 *
 * Corre en dos sitios, a proposito:
 *
 * - En `yarn verificar`, sobre los manifiestos de los dos ambientes. Un PR que
 *   olvide un `timeoutSeconds` se pone rojo sin necesitar clúster.
 * - En `index.ts`, **antes** de crear ningun recurso. Si alguien llega a `pulumi up`
 *   con manifiestos que incumplen, el despliegue se detiene ahi: es preferible un
 *   `up` que falla al principio a uno que deja el ingreso a medias.
 *
 * Devuelve la lista de incumplimientos; vacia significa admisible. Pura, como
 * `checkInvariants`.
 */

/** Etiquetas que no fijan una version. La misma lista que vigila ESLint. */
const ETIQUETAS_MOVILES = ["latest", "main", "stable"];

/** Lo que el kubelet da por omision es 1 s, y ese es justo el valor que mata pods sanos. */
const ESPERA_MINIMA = 3;
const ESPERA_MAXIMA = 5;

/**
 * Los pods que pueden leer la clave de `kamayuk_owner` sin ser un Job.
 *
 * `postgres` es el motor de datos, y la excepcion es estrecha a proposito:
 * `kamayuk_owner` **se crea ahi**. El guion de inicializacion —el mismo que usa el
 * compose— es quien le asigna la clave, y para asignarla tiene que conocerla. Ese
 * contenedor ya guarda ademas la del superusuario, que puede mas que todas las demas
 * juntas: darle tambien esta no amplia nada.
 *
 * `respaldo` es el `CronJob` de `Respaldo.ts` (issue #155): `V8__respaldo.sql`
 * declara que quien escribe el estado del respaldo en la tabla `respaldo` (RF-126) es
 * `kamayuk_owner`, «como el proceso de despliegue» — y este `CronJob` es ese proceso. La
 * excepcion sigue siendo nombrada y estrecha: el `CronJob` de `lote` en
 * `Aplicacion.ts`, que corre la MISMA imagen de la aplicacion, sigue prohibido.
 *
 * Lo que la regla persigue es otra cosa: que la clave de `kamayuk_owner` no acabe en un
 * proceso **expuesto en HTTP**. La aplicacion, la interfaz y las tareas de lote no la
 * tienen ni con excusa (ARQ-03 §4, issue #150). Ninguno de los dos de aqui abre un
 * puerto.
 */
const MOTOR = "postgres";
const COMPONENTES_CON_ACCESO_A_OWNER = [MOTOR, "respaldo"];

/**
 * Objetos que no viven en un namespace.
 *
 * `ClusterRole`/`ClusterRoleBinding` son de alcance de clúster por definicion de
 * Kubernetes —no es una excepcion de este repositorio, es el tipo del objeto—: los
 * usa `kube-state-metrics` (issue #156), el unico componente de `infra/` con RBAC
 * propio, y su nombre lleva el ambiente (`resourceName`) para no chocar con el del
 * otro stack en el mismo clúster.
 */
const SIN_NAMESPACE = ["Namespace", "PriorityClass", "ClusterRole", "ClusterRoleBinding"];

export interface ContextoDeAuditoria {
  /** El `Secret` con la clave de `kamayuk_owner`. No puede aparecer fuera de los Jobs. */
  secretoDeOwner: string;
  /** El namespace del ambiente. Todo lo demas tiene que estar dentro. */
  namespace: string;
}

export function auditarManifiestos(
  manifiestos: Manifiesto[],
  contexto: ContextoDeAuditoria,
): string[] {
  const problemas: string[] = [];

  for (const m of manifiestos) {
    problemas.push(...auditarUbicacion(m, contexto));
    problemas.push(...auditarServicio(m));
    problemas.push(...auditarIngreso(m));

    for (const { contexto: donde, clase, pod, etiquetas } of podsDe(m)) {
      if (!pod.priorityClassName) {
        problemas.push(
          `${donde} no declara \`priorityClassName\`. INF-01 §4: bajo presion de memoria el ` +
            "kubelet desaloja por orden de prioridad, y sin prioridades declaradas puede " +
            "desalojar PostgreSQL para dejar sitio a la interfaz. Con un solo nodo no hay a " +
            "donde mover lo desalojado.",
        );
      }

      problemas.push(...auditarGuionesEjecutables(donde, pod));

      for (const c of contenedoresDe(pod)) {
        problemas.push(...auditarImagen(donde, c.name, c.image));
        problemas.push(...auditarRecursos(donde, c.name, c.resources));
        problemas.push(...auditarSondas(donde, c.name, c));
        problemas.push(...auditarKeycloak(donde, c.name, c.args ?? []));
        problemas.push(...auditarLaAplicacion(donde, c, clase));
        problemas.push(...auditarRespaldo(donde, c));
        problemas.push(...auditarSeguridad(donde, c));
        if (
          (clase === "Deployment" || clase === "CronJob") &&
          !COMPONENTES_CON_ACCESO_A_OWNER.includes(etiquetas["componente"] ?? "")
        ) {
          problemas.push(...auditarSecretoDeOwner(donde, c, contexto));
        }
      }
    }

    problemas.push(...auditarEstrategia(m));
  }

  problemas.push(...auditarPrioridades(manifiestos));

  return problemas;
}

/**
 * Que el motor de datos sea **lo ultimo que se desaloja**, leido del manifiesto.
 *
 * El bucle de arriba ya exige que todo pod declare `priorityClassName`, y eso es lo
 * que hacia falta mientras la pregunta era «¿se acordo alguien de ponerlo?». No basta:
 * **presencia no es orden**. Intercambiando `PRIORIDADES.datos` y `PRIORIDADES.lote`
 * en `convenciones.ts` —PostgreSQL con la prioridad mas BAJA del clúster y las
 * emisiones masivas con la mas alta— las 170 pruebas de `yarn verificar` siguen en
 * verde y la auditoria no dice nada: cada pod sigue declarando su clase, solo que
 * ahora el kubelet desaloja la base **primero**. Comprobado ejecutandolo, no razonado.
 *
 * Es justo la inversion de lo que el issue #157 pone como no-negociable —«clases de
 * prioridad: la base de datos se desaloja la ultima»— y no tendria ningun sintoma
 * hasta el dia que el nodo se quede sin memoria, que es el dia que menos conviene
 * descubrirlo: con un solo nodo no hay a donde mover lo desalojado.
 *
 * Dos reglas, las dos legibles del manifiesto:
 *
 * 1. Toda clase que un pod nombre tiene que estar **definida en el mismo manifiesto**.
 *    Kubernetes rechaza un pod cuya `PriorityClass` no existe, asi que un nombre mal
 *    escrito aqui no es un despliegue degradado: es un pod que no arranca.
 * 2. Ningun pod puede valer **tanto o mas** que el del motor, salvo que use su MISMA
 *    clase. Lo segundo deja sitio a un futuro pod del tramo de datos —una replica—
 *    sin abrir la puerta a que la interfaz empate con la base.
 */
function auditarPrioridades(manifiestos: Manifiesto[]): string[] {
  const problemas: string[] = [];

  const valorDe = new Map<string, number>();
  for (const m of manifiestos) {
    if (m.kind === "PriorityClass") valorDe.set(m.metadata.name, m.value);
  }

  const pods: { donde: string; clase: string; valor: number; esMotor: boolean }[] = [];
  for (const m of manifiestos) {
    for (const { contexto: donde, pod } of podsDe(m)) {
      const clase = pod.priorityClassName;
      const valor = valorDe.get(clase);
      if (valor === undefined) {
        problemas.push(
          `${donde} declara \`priorityClassName: ${clase}\`, que ningun PriorityClass de este ` +
            "manifiesto define. Kubernetes RECHAZA un pod cuya clase de prioridad no existe: " +
            "no es un despliegue con menos garantias, es un pod que no llega a arrancar.",
        );
        continue;
      }
      pods.push({
        donde,
        clase,
        valor,
        esMotor: contenedoresDe(pod).some((c) => c.name === MOTOR),
      });
    }
  }

  const motor = pods.find((p) => p.esMotor);
  if (motor === undefined) return problemas;

  for (const otro of pods) {
    if (otro.clase === motor.clase) continue;
    if (otro.valor < motor.valor) continue;
    problemas.push(
      `${otro.donde} tiene prioridad ${otro.valor} (\`${otro.clase}\`) y ${motor.donde} —el motor ` +
        `de datos— solo ${motor.valor} (\`${motor.clase}\`). INF-01 §4 y el issue #157: la base de ` +
        "datos es lo ULTIMO que se desaloja. Con un solo nodo no hay a donde mover lo desalojado, " +
        "asi que este numero es lo unico que decide quien sobrevive a una presion de memoria.",
    );
  }

  return problemas;
}

function auditarUbicacion(m: Manifiesto, contexto: ContextoDeAuditoria): string[] {
  if (SIN_NAMESPACE.includes(m.kind)) return [];
  // El `HelmChartConfig` es la excepcion declarada: k3s solo mira el que esta junto a
  // su `HelmChart`, en `kube-system`. Ponerlo en el namespace del SGTM no da error; da
  // silencio, que es peor.
  if (m.kind === "HelmChartConfig") {
    return m.metadata.namespace === "kube-system"
      ? []
      : [
          `${m.kind}/${m.metadata.name} no esta en «kube-system». k3s solo lee el ` +
            "HelmChartConfig que acompana a su HelmChart; en otro namespace se aplica sin " +
            "error y sin efecto, y el ingreso se queda con la configuracion por omision.",
        ];
  }
  return m.metadata.namespace === contexto.namespace
    ? []
    : [
        `${m.kind}/${m.metadata.name} esta en «${m.metadata.namespace ?? "(ninguno)"}» y no en ` +
          `«${contexto.namespace}». Un ambiente entero por namespace es lo que permite que el ` +
          "mismo `index.ts` sirva para los dos (ADR-0011 §4).",
      ];
}

function auditarImagen(donde: string, contenedor: string, image: string): string[] {
  const etiqueta = image.includes(":") ? image.slice(image.lastIndexOf(":") + 1) : "";
  if (etiqueta === "" || ETIQUETAS_MOVILES.includes(etiqueta)) {
    return [
      `${donde}, contenedor «${contenedor}»: la imagen «${image}» no fija una version. Una ` +
        "etiqueta movil convierte cualquier reinicio de pod en una actualizacion no " +
        "planificada, y en un solo nodo eso ocurre cada vez que se reinicia el VPS (INF-01 §5).",
    ];
  }
  return [];
}

function auditarRecursos(
  donde: string,
  contenedor: string,
  recursos: { requests?: { cpu?: string; memory?: string }; limits?: { cpu?: string; memory?: string } },
): string[] {
  const faltan: string[] = [];
  if (!recursos?.requests?.cpu || !recursos.requests.memory) faltan.push("requests");
  if (!recursos?.limits?.cpu || !recursos.limits.memory) faltan.push("limits");
  if (faltan.length === 0) return [];
  return [
    `${donde}, contenedor «${contenedor}»: sin ${faltan.join(" ni ")} de recursos. INF-01 §4: ` +
      "toda carga los declara. Sin ellos el planificador no puede reservar nada y el kubelet " +
      "desaloja a ciegas, que en un nodo unico es la diferencia entre perder un Job y perder " +
      "la base de datos.",
  ];
}

/**
 * El endurecimiento de `INF-01` §4 que no admite excepcion (issue #157): sin
 * escalada de privilegios, y sin ninguna capacidad Linux de mas. `runAsNonRoot`
 * queda fuera a proposito —lo audita `verificaciones/componentes.test.ts`, no
 * aqui, porque su ausencia es una decision nombrada de un puñado de contenedores
 * (el motor de PostgreSQL, `respaldo-base`) y no un olvido: convertirla en un
 * incumplimiento bloqueante rompe exactamente los dos casos donde faltar es
 * correcto.
 */
/** El bit de ejecucion, en el `defaultMode` de un volumen proyectado. */
const BIT_DE_EJECUCION = 0o111;

/** Los interpretes que reciben el guion como ARGUMENTO: ahi se lee, no se ejecuta. */
const INTERPRETES = /(?:^|\/)(?:ba|da|a|k|z)?sh$/;

/**
 * Un guion montado desde un `ConfigMap` y **ejecutado** exige el bit de ejecucion.
 *
 * El modo por omision de un `ConfigMap` es 0644. Mientras el guion se pase como
 * argumento del interprete —`bash /realm/x.sh`— da igual: quien necesita permiso ahi es
 * bash, y le basta con leerlo. En cuanto se ejecuta directamente —`bash -c "/realm/x.sh
 * && ..."`, o como `argv[0]`— el kernel pide el bit de ejecucion, no lo encuentra, y el
 * contenedor muere con **exit 126** sin correr una linea.
 *
 * No es hipotetico: es lo que paso al pasar el Job del realm de la primera forma a la
 * segunda (#268). Sus cuatro intentos murieron en 126, `pulumi up` espero 10 minutos por
 * un Job que ya no podia terminar, y ninguna de las pruebas de manifiestos lo vio,
 * porque todas preguntaban por lo que el manifiesto DECLARA y ninguna por si sus dos
 * mitades —como se invoca el guion, y con que modo se monta— encajan. `BaseDeDatos.ts`
 * ya ponia el `defaultMode` correcto desde el principio; lo que faltaba es la regla que
 * obliga a los dos sitios a la vez.
 *
 * Se lee entero del manifiesto, sin clúster: que argv ejecuta el guion, de que volumen
 * cuelga su ruta, y que modo declara ese volumen.
 */
function auditarGuionesEjecutables(donde: string, pod: EspecificacionDePod): string[] {
  const problemas: string[] = [];
  const porNombre = new Map((pod.volumes ?? []).map((v) => [v.name, v]));

  for (const c of contenedoresDe(pod)) {
    for (const montaje of c.volumeMounts ?? []) {
      const proyectado = porNombre.get(montaje.name)?.configMap ?? porNombre.get(montaje.name)?.secret;
      if (!proyectado) continue;

      const ejecutadas = rutasEjecutadas(c, montaje.mountPath);
      if (ejecutadas.length === 0) continue;
      if (((proyectado.defaultMode ?? 0) & BIT_DE_EJECUCION) !== 0) continue;

      const modo =
        proyectado.defaultMode === undefined
          ? "por omision (0644)"
          : `0o${proyectado.defaultMode.toString(8)}`;
      problemas.push(
        `${donde}, contenedor «${c.name}»: ejecuta ${ejecutadas.join(", ")} del volumen ` +
          `«${montaje.name}», que se monta con modo ${modo}, sin permiso de ejecucion. El ` +
          "contenedor morira con «exit 126» antes de correr una sola linea. O se monta con " +
          "`defaultMode: 493` (0o755), o se invoca el guion como argumento del interprete " +
          "(`bash /ruta/guion.sh`), que solo necesita leerlo.",
      );
    }
  }

  return problemas;
}

/**
 * Las rutas bajo `mountPath` que el contenedor ejecuta —no las que solo nombra—.
 *
 * Dos formas, que son las dos que aparecen en este repositorio: la ruta como `argv[0]`,
 * y la ruta en posicion de mandato dentro del guion de un `sh -c`. Lo que NO cuenta:
 * `bash /ruta/x.sh` (argumento del interprete), `source`/`.` (se lee), y una ruta que es
 * el valor de una opcion —`--config.file=/etc/prometheus/prometheus.yml`—, que es como
 * monta su configuracion casi todo lo demas del stack.
 */
function rutasEjecutadas(c: Contenedor, mountPath: string): string[] {
  const argv = [...(c.command ?? []), ...(c.args ?? [])];
  if (argv.length === 0) return [];
  const bajoElMontaje = `${mountPath.replace(/\/$/, "")}/`;
  const encontradas = new Set<string>();

  // 1. `argv[0]`: el kernel lo exec-uta, sea lo que sea.
  const primero = argv[0] ?? "";
  if (primero.startsWith(bajoElMontaje)) encontradas.add(primero);

  // 2. El guion de un `sh -c`. Solo se mira si `argv[0]` es de verdad un interprete: un
  //    `-c` de otro binario no es un guion de shell.
  if (INTERPRETES.test(primero)) {
    for (let i = 1; i < argv.length; i += 1) {
      if (!/^-[a-z]*c$/.test(argv[i] ?? "")) continue;
      const guion = argv[i + 1];
      if (guion !== undefined) {
        for (const ruta of enPosicionDeMandato(guion, bajoElMontaje)) encontradas.add(ruta);
      }
      break;
    }
  }

  return [...encontradas];
}

/** Las apariciones de `prefijo…` que ocupan la posicion de mandato del guion. */
function enPosicionDeMandato(guion: string, prefijo: string): string[] {
  const rutas: string[] = [];
  for (let desde = guion.indexOf(prefijo); desde !== -1; desde = guion.indexOf(prefijo, desde + 1)) {
    // Lo que precede a la ruta decide si es un mandato o un argumento. Un separador
    // —principio, `;`, `&&`, `||`, `|`, `(`— o `exec`, la ejecutan; un interprete,
    // `source` o `.` la leen; cualquier otra cosa la deja en argumento.
    const antes = guion.slice(0, desde).replace(/[ \t]+$/, "");
    if (!/(?:^|[\n;&|(]|\bexec)$/.test(antes)) continue;
    const hasta = guion.slice(desde).search(/[\s;&|)]/);
    rutas.push(hasta === -1 ? guion.slice(desde) : guion.slice(desde, desde + hasta));
  }
  return rutas;
}

function auditarSeguridad(donde: string, c: Contenedor): string[] {
  const sc = c.securityContext;
  if (sc?.allowPrivilegeEscalation === false && sc.capabilities?.drop?.includes("ALL")) return [];
  return [
    `${donde}, contenedor «${c.name}»: sin \`securityContext\` endurecido —` +
      '`allowPrivilegeEscalation: false` y `capabilities: { drop: ["ALL"] }`. ' +
      "INF-01 §4 (issue #157): ninguna de las dos tiene un motivo legitimo para faltar, ni " +
      "siquiera en el contenedor que arranca como root a proposito.",
  ];
}

function auditarSondas(
  donde: string,
  contenedor: string,
  c: Parameters<typeof sondasDe>[0],
): string[] {
  const problemas: string[] = [];
  for (const { nombre, sonda } of sondasDe(c)) {
    if (sonda.timeoutSeconds < ESPERA_MINIMA || sonda.timeoutSeconds > ESPERA_MAXIMA) {
      problemas.push(
        `${donde}, contenedor «${contenedor}»: la \`${nombre}\` tiene ` +
          `\`timeoutSeconds: ${sonda.timeoutSeconds}\`, fuera de ${ESPERA_MINIMA}–${ESPERA_MAXIMA}. ` +
          "El valor por omision del kubelet es 1 s: en un nodo ocupado un contenedor sano pero " +
          "atareado no contesta en 1 s, tres fallos de la sonda de vida lo matan, y el codigo " +
          "de salida es 143 —no OOM—, asi que la investigacion empieza en el sitio equivocado.",
      );
    }
  }
  return problemas;
}

function auditarSecretoDeOwner(
  donde: string,
  c: Contenedor,
  contexto: ContextoDeAuditoria,
): string[] {
  const usa =
    (c.env ?? []).some((e) => e.valueFrom?.secretKeyRef.name === contexto.secretoDeOwner) ||
    (c.envFrom ?? []).some((e) => e.secretRef.name === contexto.secretoDeOwner);
  if (!usa) return [];
  return [
    `${donde} monta «${contexto.secretoDeOwner}», el Secret de kamayuk_owner. Ese Secret entra ` +
      "SOLO en los dos Jobs, de migracion y de implantacion (issue #150). Ni «para migrar al " +
      "arrancar», ni «para una carga rapida»: darle DDL sobre el padron de todas las " +
      "municipalidades a un proceso expuesto en HTTP es lo que ARQ-03 §4 excluye.",
  ];
}

/**
 * Las tres cosas que el propio sistema exige de si mismo, leidas del manifiesto.
 *
 * Son las comprobaciones 7 y 8 de `despliegue.yml` dichas antes de desplegar. Contra el
 * clúster se comprueban de nuevo, y contra el proceso en marcha —que es donde valen de
 * verdad—, en `verificaciones/motor/` y, lo que exige un clúster, en el VPS.
 */
function auditarLaAplicacion(
  donde: string,
  c: Contenedor,
  clase: "Deployment" | "Job" | "CronJob",
): string[] {
  const problemas: string[] = [];
  const variables = new Map((c.env ?? []).map((e) => [e.name, e.value]));

  // `kamayuk_owner` es el unico rol con DDL, y migrar es lo unico que lo necesita. La regla ya lo
  // decia en su mensaje —«solo existen en los dos Jobs»— y no lo comprobaba: miraba el usuario
  // sin mirar la clase del pod, asi que un Job de migracion de un sistema salia rechazado y un
  // Deployment con owner y otro nombre habria salido igual de rechazado por el mismo sitio.
  // Al llegar los descriptores (ADR-0031) los Jobs dejan de ser dos y de llamarse como se
  // llamaban, asi que lo que distingue tiene que ser la CLASE, no el nombre.
  const usuario = variables.get("KAMAYUK_DB_USUARIO");
  const esMigracion = clase === "Job" && usuario === "kamayuk_owner";
  if (usuario !== undefined && usuario !== "kamayuk_app" && !esMigracion) {
    problemas.push(
      `${donde}, contenedor «${c.name}»: se conecta a la base como «${usuario}». La aplicacion ` +
        "se conecta SIEMPRE como `kamayuk_app`: sin DDL, sin BYPASSRLS, sin ser propietaria de " +
        "las tablas (ARQ-03 §4). Las credenciales de `kamayuk_owner` solo valen en un **Job**, " +
        "que es donde vive la migracion; en un Deployment son DDL al alcance de la peticion " +
        "de cualquiera.",
    );
  }

  // Y la MISMA regla para el otro nombre con que entra esa credencial.
  //
  // El migrador no lee `KAMAYUK_DB_USUARIO`: lee `KAMAYUK_DB_OWNER_USUARIO` y `KAMAYUK_DB_OWNER_CLAVE`
  // —lo dice su `main`, y por eso el Job del monolito las declara asi desde el issue #150—. Hasta
  // C-14 los cuatro sistemas ponian `KAMAYUK_DB_USUARIO=kamayuk_owner` en un Job que corria la imagen de
  // la APLICACION, asi que la comprobacion de arriba los veia; con el Job corriendo el migrador de
  // verdad, esa variable desaparece y la regla se quedaria mirando algo que ya no esta. Que la
  // credencial del unico rol con DDL solo pueda aparecer en un `Job` no puede depender de con que
  // nombre se escriba.
  for (const nombre of ["KAMAYUK_DB_OWNER_USUARIO", "KAMAYUK_DB_OWNER_CLAVE"]) {
    // `variables` lleva el nombre como clave aunque el valor venga de un `Secret`: lo que se
    // mira es que la variable ESTE, no de donde sale.
    if (variables.has(nombre) && clase !== "Job") {
      problemas.push(
        `${donde}, contenedor «${c.name}»: declara «${nombre}», que es la credencial de ` +
          "`kamayuk_owner` con otro nombre. Solo vale en un **Job**, que es donde vive la migracion; " +
          "en un Deployment o en un CronJob son DDL sobre el padron de todas las municipalidades " +
          "al alcance de un proceso de larga vida (ARQ-03 §4).",
      );
    }
  }

  const perfil = variables.get("SPRING_PROFILES_ACTIVE");
  if (perfil === "web" && !variables.has("KAMAYUK_OIDC_EMISOR")) {
    problemas.push(
      `${donde}, contenedor «${c.name}»: perfil \`web\` sin \`KAMAYUK_OIDC_EMISOR\`. Sin esa ` +
        "variable " +
        "la aplicacion se niega a arrancar, y es deliberado: un backend que atiende peticiones " +
        "sin poder validar un token responde a la sonda, se declara sano y no atiende a nadie " +
        "(ADR-0005). No se «arregla» con un valor por omision en el manifiesto.",
    );
  }

  if (perfil === "batch" && (c.ports ?? []).length > 0) {
    problemas.push(
      `${donde}, contenedor «${c.name}»: perfil \`batch\` con puertos declarados. El perfil ` +
        "batch " +
        "no atiende HTTP —`web-application-type: none`—: un puerto ahi es una superficie que " +
        "nadie pidio.",
    );
  }

  return problemas;
}

/**
 * El respaldo, leido del manifiesto (issue #155).
 *
 * Dos cosas, y las dos con consecuencia si fallan en silencio: un motor que arranca
 * sin `archive_mode=on` no archiva WAL —el RPO de RNF-076 deja de existir y nadie lo
 * nota hasta que hace falta restaurar—, y una clave de wal-g puesta como `value` en
 * vez de `valueFrom.secretKeyRef` queda en el manifiesto en texto plano, visible con
 * `kubectl get -o yaml` por cualquiera con acceso de lectura al namespace.
 */
const CLAVES_DE_RESPALDO_QUE_NUNCA_VAN_EN_TEXTO_PLANO = ["WALG_LIBSODIUM_KEY", "AWS_SECRET_ACCESS_KEY"];

function auditarRespaldo(donde: string, c: Contenedor): string[] {
  const problemas: string[] = [];

  if (c.name === "postgres" && !(c.args ?? []).some((a) => a === "archive_mode=on")) {
    problemas.push(
      `${donde}, contenedor «${c.name}»: no declara \`archive_mode=on\`. Sin el, el motor no ` +
        "archiva WAL —el RPO de RNF-076 deja de existir— y nada en el arranque lo dice: el " +
        "sintoma aparece el dia que hace falta restaurar y no hay a donde ir mas alla del " +
        "ultimo respaldo base.",
    );
  }

  for (const clave of CLAVES_DE_RESPALDO_QUE_NUNCA_VAN_EN_TEXTO_PLANO) {
    const variable = (c.env ?? []).find((e) => e.name === clave);
    if (variable && variable.value !== undefined) {
      problemas.push(
        `${donde}, contenedor «${c.name}»: \`${clave}\` va como \`value\` en vez de ` +
          "`valueFrom.secretKeyRef`. Un manifiesto no es un lugar para un secreto en texto " +
          "plano: `kubectl get -o yaml` lo enseñaria a cualquiera con acceso de lectura al " +
          "namespace, y esta clave cifra —o descifra— el padron entero respaldado.",
      );
    }
  }

  return problemas;
}

function auditarKeycloak(donde: string, contenedor: string, args: string[]): string[] {
  if (!args.includes("start-dev")) return [];
  return [
    `${donde}, contenedor «${contenedor}»: arranca con \`start-dev\`. Ese modo guarda la base ` +
      "de Keycloak DENTRO del contenedor: el dia que el pod se reprograme se van con el los " +
      "usuarios de la municipalidad (issue #151). Es lo correcto en el compose y lo incorrecto " +
      "aqui.",
  ];
}

function auditarEstrategia(m: Manifiesto): string[] {
  if (m.kind !== "Deployment") return [];
  const montaVolumen = (m.spec.template.spec.volumes ?? []).some(
    (v) => v.persistentVolumeClaim !== undefined,
  );
  if (!montaVolumen || m.spec.strategy.type === "Recreate") return [];
  return [
    `Deployment/${m.metadata.name} monta un volumen persistente y usa ` +
      `\`${m.spec.strategy.type}\`. INF-01 §4: con \`ReadWriteOnce\` el pod nuevo monta el mismo ` +
      "volumen que el viejo todavia tiene, no consigue el bloqueo del directorio de datos y el " +
      "despliegue se queda colgado con la base parada. Va `Recreate`.",
  ];
}

function auditarServicio(m: Manifiesto): string[] {
  if (m.kind !== "Service") return [];
  if (m.spec.type === "ClusterIP") return [];
  return [
    `Service/${m.metadata.name} es de tipo «${m.spec.type}». INF-01 §1.4: desde internet ` +
      "responden 80 —que solo redirige— y 443, y nada mas. El acceso administrativo es por " +
      "tunel SSH; publicar el puerto de PostgreSQL o el de Keycloak «un momento, para depurar» " +
      "es la frase del README del compose que esta epica existe para retirar.",
  ];
}

function auditarIngreso(m: Manifiesto): string[] {
  const problemas: string[] = [];

  if (m.kind === "IngressRoute") {
    if (!m.spec.entryPoints.includes("websecure") || m.spec.entryPoints.includes("web")) {
      problemas.push(
        `IngressRoute/${m.metadata.name} atiende en ${m.spec.entryPoints.join(", ")}. Toda ruta ` +
          "va por `websecure`: 80 redirige, no coexiste. Un formulario de acceso servido por " +
          "HTTP es una credencial regalada (issue #153).",
      );
    }
    if (m.spec.tls === undefined) {
      problemas.push(
        `IngressRoute/${m.metadata.name} no declara TLS. Sin resolvedor de certificado, la ruta ` +
          "se sirve con el certificado por omision de Traefik —uno propio— y el navegador lo " +
          "rechaza (RNF-074).",
      );
    }
    for (const ruta of m.spec.routes) {
      if (ruta.match.includes("/keycloak") && !ruta.match.includes("!PathPrefix(`/keycloak/admin`)")) {
        problemas.push(
          `IngressRoute/${m.metadata.name} publica «${ruta.match}», que incluye la consola de ` +
            "administracion de Keycloak. No se publica (issue #153): quien administre entra por " +
            "el tunel SSH. Expuesta, la unica defensa es la clave del administrador.",
        );
      }
    }
  }

  // Leido a traves de una vista ensanchada, y no del tipo estrecho: en `tipos.ts` el
  // `apiVersion` de los recursos de Traefik es un literal, asi que TypeScript sabe que
  // no puede ser otro y estrecha la comparacion a `never`. Eso es exactamente lo que se
  // quiere del tipo —el grupo correcto no se puede escribir mal— y, a la vez, deja la
  // regla sin nada que comprobar. Sigue aqui porque un manifiesto puede llegar de
  // fuera del constructor, y porque una regla que solo vive en el tipo no protege al
  // que arma un objeto con un `as`.
  const generico = m as { kind: string; apiVersion: string; metadata: { name: string } };
  if (
    ["IngressRoute", "Middleware", "TLSOption"].includes(generico.kind) &&
    generico.apiVersion !== "traefik.io/v1alpha1"
  ) {
    problemas.push(
      `${generico.kind}/${generico.metadata.name} usa «${generico.apiVersion}». Traefik v3 ` +
        "sirve `traefik.io/v1alpha1`; con el grupo viejo el manifiesto se aplica SIN ERROR " +
        "contra un clúster que ya no lo sirve, se queda ahi sin efecto, y la ruta simplemente " +
        "no existe.",
    );
  }

  return problemas;
}

/** Compone el mensaje de un despliegue que contradice sus propias convenciones. */
export function describirAuditoria(environment: string, problemas: string[]): string {
  return (
    `Los manifiestos de «${environment}» incumplen las convenciones de INF-01 §4:\n` +
    problemas.map((p) => `  · ${p}`).join("\n")
  );
}
