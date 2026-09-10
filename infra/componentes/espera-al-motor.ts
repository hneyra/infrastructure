import { PUERTO_DEL_MOTOR, seguridadSinRoot } from "./convenciones";
import type { Contenedor, EspecificacionDePod, Manifiesto } from "./tipos";

/**
 * La espera al motor, inyectada por la plataforma en todo proceso de un sistema que le hable
 * (#44).
 *
 * ## El defecto, medido contra `stg`
 *
 * Al aplicar #43 el `Deployment` del motor se actualizo. Su estrategia es `Recreate` —hay un
 * `PersistentVolumeClaim` de por medio—, asi que el motor **baja a cero y vuelve a subir**. En
 * esa ventana los `Job` de migracion corrieron contra una base que no estaba, gastaron sus tres
 * intentos en segundos y murieron con `Connection refused`, **sin ejecutar una sola sentencia**.
 * No es un fallo de esquema: es una carrera.
 *
 * Y no se arregla solo: un `Job` que agoto su `backoffLimit` **no reintenta nunca**, y su nombre
 * lleva el `sha`, asi que `pulumi up` no puede recrearlo — lo ve existir, intenta actualizarlo y
 * falla. El ambiente se queda atascado hasta que alguien borra esos `Job` a mano.
 *
 * ## Por que no basta subir el `backoffLimit`
 *
 * Porque **un reintento con espera es una espera, y tres reintentos inmediatos son tres fallos**.
 * Los tres intentos se gastaron *en segundos*: el pod arranca, la JVM levanta, el pool no conecta
 * y el proceso muere. Un motor con `Recreate` y un PVC tarda decenas de segundos en volver, asi
 * que subir el limite a diez daria diez fallos en el mismo minuto y el mismo `Job` en `Failed`.
 * Lo que hace falta no es repetir mas veces, es **no empezar hasta que haya con quien hablar**.
 *
 * ## Por que lo inyecta la plataforma y no lo escribe cada descriptor
 *
 * Porque **la espera no es una decision del sistema**. El motor es de la plataforma —quien decide
 * su estrategia de despliegue, su volumen y su tiempo de arranque es este repositorio— y ADR-0031
 * dice que aqui se decide «donde corre, con que limites y con que rol». Escribirla en los cuatro
 * descriptores serian cuatro copias de una espera que depende de algo que ninguno de los cuatro
 * controla, y la cuarta copia se separaria de las otras tres el primer trimestre.
 *
 * Ademas hay un motivo material: la imagen de un sistema es **su jar de Java** y no trae
 * `pg_isready`. La espera tiene que correr en otra imagen, y cual es —y que no haya que bajarse
 * una segunda— lo sabe quien despliega el motor: es **la misma imagen del motor**, que ya esta en
 * el nodo porque el motor corre con ella.
 *
 * ## El anfitrion se DERIVA de la URL que el propio proceso declara
 *
 * No se compone aparte. Si se compusiera, un `Job` que apuntara a otro sitio esperaria al motor
 * equivocado y arrancaria igual — y el sintoma seria el mismo `Connection refused`, con una
 * espera en verde delante diciendo que todo esta bien.
 *
 * ## Y por que el UID va ESCRITO, medido contra `stg`
 *
 * Esta espera corre con la imagen del motor, y **esa imagen arranca como root a proposito**: su
 * `entrypoint` toma posesion de PGDATA con `chown` antes de bajar privilegios el mismo con
 * `gosu`, que es lo que `BaseDeDatos.ts` explica al omitirle `runAsNonRoot` al contenedor del
 * motor. Asi que no declara ningun `USER`, y un `runAsNonRoot: true` **sin `runAsUser`** deja al
 * kubelet sin forma de comprobar que no es root: se niega a crear el contenedor.
 *
 * Nacio asi en #44 y **el ambiente entero llevaba desde entonces sin poder desplegarse**. Medido
 * en `stg` el 2026-09-10, en el diagnostico que el tope de `aplicar-stg` dejo volcar por primera
 * vez: `Warning Failed (x395 over 89m) kubelet spec.initContainers{espera-al-motor}: Error:
 * container has runAsNonRoot and image will run as root`, en **todos** los `Job` de migracion e
 * implantacion y en los `CronJob` de `identidad`, `normativa`, `rentas` y `catastro`. Ninguno
 * llego a crear su contenedor, asi que la migracion de `identidad` nunca corrio y su base se
 * quedo sin esquema. La espera puesta para que un `Job` no muriera por una carrera es la que no
 * dejaba arrancar a ninguno.
 *
 * Es la leccion de #157 y de #268 por tercera vez —`curlimages/curl` con su `USER` por nombre, y
 * `mailpit` sin ninguno—, y las dos veces anteriores se cerraron con el mismo remedio: un
 * `runAsUser` numerico en el manifiesto. `runAsNonRoot` a secas delega en la imagen la respuesta
 * a si el pod arranca; con el UID puesto, la decide este archivo.
 *
 * Y con el UID puesto, `pg_isready` **tiene que decir con que usuario pregunta**: sin `-U`, libpq
 * resuelve el usuario por omision del UID que corre, y un UID que la imagen no tenga en su
 * `/etc/passwd` deja la consulta en `PQPING_NO_ATTEMPT` —codigo 3— que este bucle no distingue de
 * «el motor no contesta»: cinco minutos de espera y despues un mensaje que acusa al motor de algo
 * que no ha hecho. Con `-U` no hay lookup que pueda fallar. No autentica nada: `pg_isready`
 * devuelve «acepta conexiones» en cuanto el servidor contesta al paquete de arranque, aunque
 * fuera a rechazar esa cuenta.
 */

/** Cuantas veces se pregunta antes de rendirse, y cada cuanto. */
const INTENTOS = 60;
const CADA_SEGUNDOS = 2;

/**
 * El UID con el que corre la espera, escrito y no delegado en la imagen.
 *
 * 65534 —`nobody`— es el que este repositorio ya usa para toda imagen que no declara un `USER`
 * numerico: `mailpit`, `curlimages/curl` y los cuatro exportadores de observabilidad. La espera
 * no necesita nada de la imagen: pregunta por TCP y duerme, con el sistema de archivos de solo
 * lectura.
 */
const UID_SIN_PRIVILEGIO = 65534;

/**
 * El usuario con el que se pregunta. No autentica: quita el `getpwuid` que libpq haria si no se
 * le dice ninguno (ver el epigrafe del UID, arriba).
 */
const USUARIO_DE_LA_PREGUNTA = "postgres";

/**
 * El nombre del contenedor. Se cita desde la guarda, asi que vive aqui y no en dos sitios.
 */
export const CONTENEDOR_DE_ESPERA = "espera-al-motor";

/** `jdbc:postgresql://kamayuk-stg-postgres.kamayuk-stg:5432/rentas` -> anfitrion y puerto. */
export function destinoDeLaUrl(url: string): { anfitrion: string; puerto: number } | undefined {
  const encontrado = /^jdbc:postgresql:\/\/([^/:]+)(?::(\d+))?\//.exec(url);
  const anfitrion = encontrado?.[1];
  if (anfitrion === undefined) return undefined;
  const puerto = encontrado?.[2];
  return { anfitrion, puerto: puerto === undefined ? PUERTO_DEL_MOTOR : Number(puerto) };
}

/**
 * El contenedor que espera.
 *
 * **Esperar no puede ser esperar para siempre** (AC-1 de #44): a los {@link INTENTOS} intentos
 * sale con codigo 1 y lo dice. Un `initContainer` colgado deja el pod en `Init:0/1` sin
 * diagnostico, que en un `Job` es peor que fallar — nadie recibe nada y el `backoffLimit` no
 * llega a contar.
 */
export function contenedorDeEspera(
  imagen: string,
  anfitrion: string,
  puerto: number,
): Contenedor {
  const guion =
    `i=0; until pg_isready -h ${anfitrion} -p ${puerto} -U ${USUARIO_DE_LA_PREGUNTA} -q; do ` +
    `i=$((i+1)); ` +
    `if [ "$i" -ge ${INTENTOS} ]; then ` +
    `echo "El motor ${anfitrion}:${puerto} no acepta conexiones tras ` +
    `${INTENTOS * CADA_SEGUNDOS}s. No se arranca contra una base que no esta: seria un fallo ` +
    `de conexion que se lee como un fallo de esquema (#44)." >&2; exit 1; fi; ` +
    `sleep ${CADA_SEGUNDOS}; done`;
  return {
    name: CONTENEDOR_DE_ESPERA,
    // La imagen del MOTOR, que es donde vive `pg_isready` y que el nodo ya tiene bajada porque
    // el motor corre con ella. Una imagen de cliente aparte serian bytes nuevos en el nodo y una
    // version de cliente que puede separarse de la del servidor.
    image: imagen,
    command: ["/bin/sh", "-c", guion],
    // Minimo: pregunta y duerme. Va en `initContainers`, asi que Kubernetes reserva el MAXIMO
    // entre estos y los contenedores normales — con estas cifras no mueve el pico de ningun pod,
    // que es lo que `perfil-del-ambiente` fija.
    resources: {
      requests: { cpu: "10m", memory: "32Mi" },
      limits: { cpu: "100m", memory: "64Mi" },
    },
    securityContext: seguridadSinRoot({ readOnlyRootFilesystem: true, runAsUser: UID_SIN_PRIVILEGIO }),
  };
}

/** La URL de la base que declara un pod, mirando tambien sus `initContainers`. */
function urlDelMotor(pod: EspecificacionDePod): string | undefined {
  for (const c of [...(pod.initContainers ?? []), ...(pod.containers ?? [])]) {
    for (const e of c.env ?? []) {
      if ((e.name ?? "").endsWith("DB_URL") && typeof e.value === "string") {
        return e.value;
      }
    }
  }
  return undefined;
}

function podDe(m: Manifiesto): EspecificacionDePod | undefined {
  if (m.kind === "Job") return m.spec?.template?.spec;
  if (m.kind === "CronJob") return m.spec?.jobTemplate?.spec?.template?.spec;
  return undefined;
}

/**
 * Le pone la espera a todo `Job`/`CronJob` que declare una URL de la base y no la tenga ya.
 *
 * **Va DELANTE de los `initContainers` que el descriptor traiga**, y eso importa: los `Job` de
 * implantacion de los cuatro llevan un `migrador` que abre la conexion, asi que una espera puesta
 * detras no protegeria a quien fallo primero — en `caja` fue justo ese.
 *
 * Es idempotente: si el pod ya trae un contenedor con este nombre, no se toca. Un descriptor que
 * quisiera esperar a su manera puede hacerlo, y esto no se lo duplica.
 */
export function conEsperaAlMotor(manifiestos: Manifiesto[], imagen: string): Manifiesto[] {
  for (const m of manifiestos) {
    const pod = podDe(m);
    if (pod === undefined) continue;
    const url = urlDelMotor(pod);
    if (url === undefined) continue;
    const destino = destinoDeLaUrl(url);
    if (destino === undefined) {
      throw new Error(
        `«${m.metadata?.name ?? "(sin nombre)"}» declara una URL de base que no se puede leer: ` +
          `«${url}». De ahi sale a quien esperar (#44), y no poder leerla no es «no hace falta ` +
          "esperar»: es que nadie sabe a quien. Se para aqui en vez de emitir un proceso que " +
          "arrancaria contra una base que puede no estar.",
      );
    }
    const yaEstan = pod.initContainers ?? [];
    if (yaEstan.some((c) => c.name === CONTENEDOR_DE_ESPERA)) continue;
    pod.initContainers = [
      contenedorDeEspera(imagen, destino.anfitrion, destino.puerto),
      ...yaEstan,
    ];
  }
  return manifiestos;
}
