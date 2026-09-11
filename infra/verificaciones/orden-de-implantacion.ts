import { SISTEMAS_DEL_PRODUCTO } from "../componentes/convenciones";
import type { Environment } from "../config";
import { manifiestosDelAmbiente } from "../herramientas/emitir-manifiestos";
import { invariantesDe } from "./stacks";

/**
 * El orden de implantacion, y por que desde la etapa 5 de ADR-0039 hay uno.
 *
 * Hasta la etapa 4, implantar un satelite era un acto que no necesitaba a nadie: su
 * `SembradorDeLaCopiaLocal` escribia el primer administrador en su propia base y la pasada del
 * consumidor era un extra. Con la etapa 5 el sembrador **deja de escribir la autorizacion** —el
 * dueño es `identidad`, ADR-0039— y lo unico que siembra es el catalogo del sistema. De modo que
 * una implantacion cuyo consumidor no traiga nada deja la base **sin una sola cuenta**: la
 * municipalidad queda implantada y nadie puede entrar.
 *
 * Los cuatro satelites ya fallan diciendolo, en vez de terminar en verde con la copia vacia. Lo
 * que falta aqui es que el orden **se vea**: que `identidad` va primero, que exactamente los
 * cuatro dependen de el, y que su implantacion no depende de nadie.
 *
 * ## Lo que este archivo puede comprobar, y lo que no
 *
 * El orden **no lo declara ningun manifiesto**: los once `Job` del ambiente los crea un solo
 * `ConfigGroup` sin dependencias entre ellos, asi que Kubernetes los arranca a la vez. Lo que si
 * esta en el manifiesto es la DEPENDENCIA —quien nombra el espacio de nombres de quien—, y de ahi
 * sale el orden. Comprobarlo es lo que impide que un quinto dependiente aparezca sin que nadie lo
 * decida, o que la implantacion del dueño empiece a llamar a un hermano y el orden se vuelva un
 * ciclo.
 *
 * Lo que NO se comprueba aqui, y esta medido y escrito en
 * `docs/00-gobierno/identidad-5-el-orden-de-implantacion.md`: que en un ambiente **de cero** los
 * cuatro `Job` dependientes tienen `backoffLimit: 3` —unos 70 s de reintentos con el retroceso de
 * Kubernetes— y que `identidad` tarda mas que eso en migrar e implantar. Un `Job` que agota su
 * limite **no reintenta nunca** y su nombre lleva el `sha`, asi que `pulumi up` tampoco lo recrea.
 * Subir ese limite es una linea en el descriptor de cada satelite, o sea cuatro PR en cuatro
 * repositorios, y se declara en vez de decidirse aqui.
 */

/** Un `Job` de implantacion del ambiente, con de quien depende. */
export interface Implantacion {
  /** `rentas`, `identidad`… */
  sistema: string;
  /** `kamayuk-rentas-implantacion-66ebe547a3ee`. */
  nombre: string;
  espacio: string;
  backoffLimit: number;
  /** Los sistemas HERMANOS cuyo espacio de nombres nombra alguna de sus variables. */
  dependeDe: string[];
  /** Por que variable, para que el rojo diga donde mirar. */
  porQueVariable: string[];
}

interface Contenedor {
  env?: { name?: string; value?: unknown }[];
}

interface Manifiesto {
  kind?: string;
  metadata?: { name?: string; namespace?: string };
  spec?: { backoffLimit?: number; template?: { spec?: Contenedor & { initContainers?: Contenedor[]; containers?: Contenedor[] } } };
}

/**
 * Cuanto sobrevive un `Job` que falla, con el retroceso exponencial de Kubernetes.
 *
 * Empieza en 10 s y dobla, con tope de 6 min por intento. Es una cota **optimista**: no cuenta lo
 * que tarda el pod en arrancar, asi que el tiempo real es mayor; para lo que aqui interesa —«¿le
 * da tiempo a que el otro sistema termine?»— una cota optimista es la que hay que mirar.
 */
export function ventanaDeReintentos(backoffLimit: number): number {
  let total = 0;
  let espera = 10;
  for (let i = 0; i < backoffLimit; i += 1) {
    total += Math.min(espera, 360);
    espera *= 2;
  }
  return total;
}

/** El `Job` de implantacion de cada sistema del ambiente, con su dependencia derivada. */
export function implantacionesDelAmbiente(ambiente: Environment): Implantacion[] {
  const ms = manifiestosDelAmbiente(invariantesDe(ambiente)) as unknown as Manifiesto[];
  const implantaciones: Implantacion[] = [];
  for (const m of ms) {
    if (m.kind !== "Job") continue;
    const nombre = m.metadata?.name ?? "";
    if (!nombre.includes("-implantacion-")) continue;
    const espacio = m.metadata?.namespace ?? "";
    const pod = m.spec?.template?.spec;
    const variables = [...(pod?.initContainers ?? []), ...(pod?.containers ?? [])].flatMap(
      (c) => c.env ?? [],
    );

    const dependeDe = new Set<string>();
    const porQueVariable = new Set<string>();
    for (const variable of variables) {
      if (typeof variable.value !== "string") continue;
      for (const sistema of SISTEMAS_DEL_PRODUCTO) {
        const suEspacio = `kamayuk-${sistema}-${ambiente}`;
        // El suyo no cuenta: nombrarse a si mismo no es depender de nadie.
        if (suEspacio === espacio) continue;
        if (variable.value.includes(suEspacio)) {
          dependeDe.add(sistema);
          porQueVariable.add(`${sistema}:${variable.name ?? "(sin nombre)"}`);
        }
      }
    }

    implantaciones.push({
      sistema: SISTEMAS_DEL_PRODUCTO.find((s) => espacio === `kamayuk-${s}-${ambiente}`) ?? "?",
      nombre,
      espacio,
      backoffLimit: m.spec?.backoffLimit ?? 6,
      dependeDe: [...dependeDe].sort(),
      porQueVariable: [...porQueVariable].sort(),
    });
  }
  return implantaciones;
}

/** El dueno de la autorizacion, que es quien va primero (ADR-0039). */
export const DUENO_DE_LA_AUTORIZACION = "identidad";

/**
 * Los `Job` cuyo margen de reintentos NO alcanza para esperar a quien depende, con su issue.
 *
 * **Es una lista de trabajo pendiente y no una puerta abierta**: se comprueba en las dos
 * direcciones, asi que una entrada que ya se arreglo sale roja igual que una que falta. Subir el
 * `backoffLimit` es una linea en el descriptor de CADA satelite —cuatro PR en cuatro
 * repositorios—, asi que la decision no es de este archivo.
 */
export const MARGEN_CORTO_PENDIENTE: Record<string, string> = {
  // VACIA desde el 2026-09-11, y eso es el cierre de #65: los cuatro satelites subieron su
  // `backoffLimit` de implantacion de 3 a 6 —`rentas@…:873`, `catastro@…:477`,
  // `normativa@…:427`, `caja@…:813`—, o sea de 70 s a 630 s contra el minimo de 600 s.
  //
  // NO se borra la constante: es la que sostiene las dos direcciones de la prueba. Vacia sigue
  // diciendo algo —«ninguna implantacion tiene margen corto sin declarar»— y el dia que nazca
  // un sexto sistema con `backoffLimit: 3` la direccion `sinDeclarar` se pone roja sola, que es
  // justo para lo que existe.
};

/** Lo que se considera margen suficiente, y por que. */
export const MARGEN_MINIMO_SEGUNDOS = 600;
