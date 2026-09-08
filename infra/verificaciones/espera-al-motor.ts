import type { Environment } from "../config";
import { manifiestosDelAmbiente } from "../herramientas/emitir-manifiestos";
import { invariantesDe } from "./stacks";

/**
 * `#44` — quien habla con el motor tiene que esperar a que el motor exista.
 *
 * El `Deployment` del motor usa `Recreate` —lleva un `PersistentVolumeClaim`—, asi que cualquier
 * `pulumi up` que lo toque lo baja a cero y lo vuelve a subir. En esa ventana, todo `Job` que
 * abra una conexion falla; y un `Job` tiene `backoffLimit: 3`, asi que gasta sus tres intentos en
 * segundos y **muere para siempre**: un `Job` que alcanza su limite no reintenta nunca, y su
 * nombre lleva el `sha`, de modo que `pulumi up` tampoco puede recrearlo. El ambiente se queda
 * atascado hasta que alguien los borra a mano.
 *
 * Medido contra `stg` el 2026-09-08, y costo cuatro corridas de `main`: tres `Job` en `Failed`
 * —`rentas-migracion`, `catastro-migracion` y `caja-implantacion`— y los tres con la MISMA linea
 * en sus registros, «Connection to kamayuk-stg-postgres.kamayuk-stg:5432 refused». Ninguno llego a
 * ejecutar una sentencia: no era el esquema, era una carrera.
 *
 * ## Por que no basta subir el `backoffLimit`
 *
 * Un reintento con espera es una espera; tres reintentos inmediatos contra una base que tarda
 * cuarenta segundos en volver son tres fallos y nada mas. Lo que hace falta es esperar ANTES de
 * empezar, que es para lo que existe un `initContainer`.
 *
 * ## Y por que la espera se reconoce por lo que HACE
 *
 * Los cuatro `Job` de implantacion ya declaran un `initContainer`, y **no es una espera**: se
 * llama `migrador` y es la migracion misma corriendo como paso previo. Habla con la base igual
 * que el contenedor principal — de hecho es el que fallo en `caja`. Asi que una guarda que
 * preguntara «¿tiene `initContainers`?» daria por buenos a cuatro de los diez sin que ninguno
 * espere. Se pregunta por `pg_isready` en bucle, que es lo que distingue esperar de trabajar.
 *
 * ## EL LIMITE DE ESTE DETECTOR, Y POR QUE SE DEJA ASI
 *
 * Solo ve la espera **si vive en el manifiesto**. Y medido —inyectandola en un clon desechable de
 * `normativa` y emitiendo—, esa forma **hoy no es implementable por ninguno de los cuatro**: la
 * auditoria la rechaza por tres cosas, y la tercera es de fondo —«la imagen «postgres:16-alpine»
 * no sale de `entorno.imagenDe()`»—, porque la imagen de un sistema es su jar de Java y no trae
 * `pg_isready`.
 *
 * De modo que el arreglo saldra por una de dos, y **la eleccion no es de este archivo**: que el
 * migrador REINTENTE en Java (cuatro repositorios, invisible desde aqui), o que la espera la
 * inyecte `infrastructure` (un sitio, pero cruzando una frontera que ADR-0031 dibujo). Esta en
 * #44.
 *
 * Lo que se entrega aqui es lo que vale **con cualquiera de las dos**: el CENSO. Quien abre
 * conexion al motor, cuantos son, y que ninguno nuevo pueda aparecer sin declararse. Si gana la
 * salida de Java, `espera` seguira siendo `false` para todos y la lista se mantiene a mano — y eso
 * queda dicho aqui en vez de que alguien lo descubra viendo una guarda que no se mueve.
 */

/** Un proceso del ambiente que abre conexion a la base. */
export interface ProcesoQueHablaConElMotor {
  /** `kamayuk-rentas-migracion-0fa7d0…`, tal como se llama en el cluster. */
  nombre: string;
  espacio: string;
  /** `Job` o `CronJob`. */
  clase: string;
  /** Si algun `initContainer` suyo espera al motor con `pg_isready`. */
  espera: boolean;
}

interface Contenedor {
  name?: string;
  command?: string[];
  args?: string[];
  env?: { name?: string }[];
}

interface EspecificacionDePod {
  containers?: Contenedor[];
  initContainers?: Contenedor[];
}

interface Manifiesto {
  kind?: string;
  metadata?: { name?: string; namespace?: string };
  spec?: {
    template?: { spec?: EspecificacionDePod };
    jobTemplate?: { spec?: { template?: { spec?: EspecificacionDePod } } };
  };
}

/** El texto ejecutable de un contenedor: su `command` y sus `args`, juntos. */
const loQueEjecuta = (c: Contenedor): string =>
  [...(c.command ?? []), ...(c.args ?? [])].join(" ");

/**
 * `pg_isready` **en bucle**, que es lo que distingue una espera de una comprobacion.
 *
 * Un `pg_isready` suelto pregunta una vez y se rinde: contra un motor que esta arrancando eso es
 * exactamente el fallo que #44 describe, con un paso mas. La espera tiene que reintentar.
 */
const esperaAlMotor = (c: Contenedor): boolean => {
  const texto = loQueEjecuta(c);
  if (!texto.includes("pg_isready")) return false;
  return /\b(while|until|for)\b/.test(texto);
};

/** Todo `Job`/`CronJob` del ambiente que declara una URL de la base. */
export function procesosQueHablanConElMotor(
  ambiente: Environment,
): ProcesoQueHablaConElMotor[] {
  const encontrados: ProcesoQueHablaConElMotor[] = [];

  for (const m of manifiestosDelAmbiente(invariantesDe(ambiente)) as Manifiesto[]) {
    if (m.kind !== "Job" && m.kind !== "CronJob") continue;
    const pod =
      m.kind === "Job"
        ? m.spec?.template?.spec
        : m.spec?.jobTemplate?.spec?.template?.spec;
    if (pod === undefined) continue;

    const principales = pod.containers ?? [];
    const iniciales = pod.initContainers ?? [];

    // Se mira el `initContainer` tambien: en la implantacion es el migrador quien abre la
    // conexion, y es justo el que fallo en `caja`.
    const habla = [...principales, ...iniciales].some((c) =>
      (c.env ?? []).some((e) => (e.name ?? "").endsWith("DB_URL")),
    );
    if (!habla) continue;

    encontrados.push({
      nombre: m.metadata?.name ?? "(sin nombre)",
      espacio: m.metadata?.namespace ?? "(sin espacio)",
      clase: m.kind,
      espera: iniciales.some(esperaAlMotor),
    });
  }

  return encontrados.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/**
 * Los que **todavia no esperan**, con el issue que lo cierra en el repositorio de su sistema.
 *
 * Es la lista de trabajo pendiente, no una puerta: se comprueba en las dos direcciones. Quitarle
 * una entrada que sigue sin espera pone rojo, y dejar una que ya la tiene, tambien — asi encoge
 * sola a medida que los cuatro clones aterrizan su mitad, y no puede encoger en silencio.
 *
 * Nace con **los diez dentro**, y eso es correcto: no hay ni un ejemplo de espera en el
 * repositorio, asi que hay que escribirla en los cuatro descriptores. La clave es el nombre SIN
 * el `sha`, porque el `sha` cambia con cada version y la deuda no.
 */
export const SIN_ESPERA_PENDIENTES: readonly string[] = [
  "kamayuk-caja-implantacion",
  "kamayuk-caja-migracion",
  "kamayuk-catastro-implantacion",
  "kamayuk-catastro-migracion",
  "kamayuk-catastro-publicador",
  "kamayuk-normativa-implantacion",
  "kamayuk-normativa-migracion",
  "kamayuk-rentas-implantacion",
  "kamayuk-rentas-ingestor",
  "kamayuk-rentas-migracion",
];

/** `kamayuk-rentas-migracion-0fa7d0…` -> `kamayuk-rentas-migracion`. */
export function sinLaVersion(nombre: string): string {
  return nombre.replace(/-[0-9a-f]{12,}$/, "");
}
