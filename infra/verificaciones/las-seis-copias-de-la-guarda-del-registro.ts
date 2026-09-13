import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { raizDelRepositorio } from "../componentes/fuentes";
import { SISTEMAS, clonDe } from "./deriva-de-migraciones";

/**
 * Las seis copias de la guarda del registro dicen lo mismo, salvo lo que cada dueno decide (#165).
 *
 * ## El hueco que cierra, medido y no supuesto
 *
 * `docs/00-gobierno/verificar-fila-del-registro.mjs` vive COPIADO en los seis repositorios, y
 * nada ataba las copias. `rentas`#130 lo pago: su guarda aceptaba «Cierra #N» —el idioma de la
 * casa— y GitHub solo auto-cierra con las palabras inglesas, asi que `rentas`#129 se mezclo con
 * todo en verde y su issue se quedo abierto. `rentas`#132 lo arreglo **en su copia**, y al leer
 * las otras cinco el 2026-09-13 ninguna avisaba y ninguna conocia `closed`, `fixed` ni
 * `resolved`. Y ya no eran seis copias de un archivo sino seis archivos, medido sobre la rama
 * principal de los seis ese dia: de 186 a 238 lineas las cinco y 362 la de `rentas`; dos con
 * `principal()` y cuatro que se ejecutaban al cargarse; **seis cabeceras distintas** y **cinco
 * redacciones distintas** de `nombra()` —solo `infrastructure` y `catastro` coincidian—. Un
 * arreglo que llega a una copia y no al resto no se ve en ningun sitio: cada una sigue verde con su
 * propia autoprueba.
 *
 * ## La decision de #165 (AC-4): seis copias atadas, y no una libreria
 *
 * Una libreria obligaria a publicar un guion de Node que los seis consuman, y hoy no hay donde:
 * `kamayuk-lib` no tiene sitio para eso, y `comun-verificaciones` es un artefacto de Gradle. Asi
 * que las copias se quedan, y esta guarda las ata.
 *
 * ## Que tiene que ser identico, exactamente
 *
 * **El archivo entero, byte a byte, salvo un bloque**: el de `RUTAS_DE_CODIGO`. El bloque es
 *
 *   1. la linea `export const RUTAS_DE_CODIGO = [`, que tiene que aparecer **una sola vez**;
 *   2. **hacia abajo**, hasta la primera linea que sea exactamente `];`;
 *   3. **hacia arriba**, el comentario de documentacion pegado a esa linea —si la linea de
 *      encima cierra un comentario, hasta la linea que lo abre con `/**`—.
 *
 * Todo lo demas se compara sin normalizar nada mas que los finales de linea (CRLF -> LF). A
 * diferencia de `lo-que-los-cinco-comparten.ts` aqui no hay nombre de sistema que renombrar ni
 * reflujo de Spotless que deshacer: son copias, no traducciones, y la prosa tambien se compara —
 * una cabecera que en un repositorio cuenta otra historia es como empezaron a separarse estas.
 *
 * **Y dentro de la lista solo caben patrones y comentarios.** Cada linea entre la declaracion y el
 * `];` tiene que estar vacia, ser un comentario `//` o ser un literal de expresion regular seguido
 * de coma. Sin esto, el bloque propio seria una puerta: cualquier codigo metido ahi dentro dejaria
 * de compararse, y un bloque que admite cualquier cosa no es un bloque, es una exencion.
 *
 * ### Por que ese bloque y no otro
 *
 * Porque la LISTA no puede ser la misma y eso ya esta medido: `infrastructure` no tiene `backend/`
 * ni `frontend/`, `identidad` cuenta sus catalogos de accesos, `caja` anadio `despliegue/` en su
 * #39 y `rentas` su `frontend/package.json` en su #74, cada una con su motivo escrito en el
 * comentario de encima. Ese comentario es la historia de por que la lista de ese repositorio es
 * como es, y por eso entra en el bloque. Lo que si es comun a los seis sobre la lista —que cubra
 * su propio descriptor— lo sostiene `cubreSuPropioDescriptor`, ejecutando los patrones.
 *
 * ## Lo que NO compara
 *
 * **La autoprueba** (`verificar-las-muestras-del-registro.mjs`). Sus muestras nombran las rutas de
 * cada repositorio —`kamayuk-caja` en uno, `librerias-backend` en otro— y tiene que ejercer SU
 * lista, asi que no puede ser una copia. Que cada copia del guion muerda lo demuestra la
 * autoprueba de cada repositorio; que las seis sean la misma copia, esto. Las dos mitades hacen
 * falta, y ninguna sustituye a la otra: seis copias identicas pueden estar las seis rotas.
 *
 * ## Lo que cuesta, y el orden en que se mezcla
 *
 * **Cambiar el guion fuera del bloque es un cambio en seis repositorios.** Esta guarda lee los
 * cinco clones hermanos del disco —en CI, la rama principal que `clonar-los-hermanos` trae—, asi
 * que **`infrastructure` se mezcla el ULTIMO**: si lo hace antes, esto sale rojo nombrando a los
 * que faltan hasta que lleguen. Es deliberado y es la parte cara: la alternativa —avisar sin
 * bloquear— es la que habia de hecho, y dejo cinco copias con un defecto que una sexta ya habia
 * arreglado.
 */

/** Donde vive el guion, relativo a la raiz de cada repositorio. */
export const GUION = "docs/00-gobierno/verificar-fila-del-registro.mjs";

/** La linea que ancla el bloque propio de cada repositorio. */
export const DECLARACION = "export const RUTAS_DE_CODIGO = [";

/** Lo que sustituye al bloque propio antes de comparar. */
const EN_LUGAR_DEL_BLOQUE = "«el bloque RUTAS_DE_CODIGO, que es de cada repositorio»";

/**
 * Si esa linea de la lista es UN literal de expresion regular seguido de coma, y nada mas.
 *
 * Se recorre y no se casa con `^\/.+\/,$`, porque eso lo cumple `/a/ || otraCosa() || /b/,`:
 * empieza y acaba como un patron y lleva codigo en medio. Aqui el literal se cierra en la primera
 * barra que no esta escapada ni dentro de una clase `[…]`, y detras solo pueden venir banderas.
 */
function esUnPatron(linea: string): boolean {
  if (!linea.startsWith("/") || !linea.endsWith(",")) return false;
  const literal = linea.slice(0, -1);
  let enClase = false;
  for (let i = 1; i < literal.length; i++) {
    const letra = literal[i];
    if (letra === "\\") {
      i++;
    } else if (enClase) {
      enClase = letra !== "]";
    } else if (letra === "[") {
      enClase = true;
    } else if (letra === "/") {
      return i > 1 && /^[dgimsuvy]*$/.test(literal.slice(i + 1));
    }
  }
  return false;
}

/** Una copia del guion, leida de un repositorio. */
export interface Copia {
  /** El repositorio: `infrastructure` o el nombre de un sistema. */
  readonly repo: string;
  /** Donde se busco. */
  readonly ruta: string;
  /** Su contenido, o `undefined` si no estaba. */
  readonly texto: string | undefined;
}

/**
 * Las seis copias: la de este repositorio y la de cada clon hermano de {@link SISTEMAS}.
 *
 * Una copia que no esta NO lanza aqui: vuelve con `texto` indefinido y {@link desajustes} la
 * nombra. Lanzar en la lectura haria que la primera ausencia tapara a las demas. Lo que si lanza
 * es `clonDe`, cuando falta el CLON entero: eso ya no es una copia que falta, es no poder mirar.
 */
export function lasSeisCopias(): Copia[] {
  const raices = [
    { repo: "infrastructure", raiz: raizDelRepositorio() },
    ...SISTEMAS.map((sistema) => ({ repo: sistema.nombre, raiz: clonDe(sistema) })),
  ];
  return raices.map(({ repo, raiz }) => {
    const ruta = join(raiz, GUION);
    return { repo, ruta, texto: existsSync(ruta) ? readFileSync(ruta, "utf8") : undefined };
  });
}

/** Lo que una copia tiene que compartir con las otras cinco, y donde estaba su bloque propio. */
export interface LoComun {
  /** Las lineas del archivo con el bloque propio sustituido por una sola marca. */
  readonly lineas: readonly string[];
  /** Indice (desde 0) de la marca dentro de `lineas`, que es donde empezaba el bloque. */
  readonly inicio: number;
  /** Cuantas lineas del archivo ocupaba el bloque. */
  readonly largo: number;
}

/**
 * Separa el bloque propio del resto. Lanza, diciendo que falta, si el bloque no se puede delimitar
 * o si dentro de la lista hay algo que no es un patron ni un comentario.
 */
export function loComun(texto: string): LoComun {
  const lineas = texto.replace(/\r\n/g, "\n").split("\n");

  const declaraciones = lineas.flatMap((linea, i) => (linea === DECLARACION ? [i] : []));
  if (declaraciones.length !== 1) {
    throw new Error(
      `tiene ${declaraciones.length} lineas «${DECLARACION}» y tiene que tener exactamente una: ` +
        "es lo que delimita el bloque que cada repositorio decide, y sin ella no se sabe que " +
        "comparar.",
    );
  }
  const declaracion = declaraciones[0]!;

  const cierre = lineas.findIndex((linea, i) => i > declaracion && linea === "];");
  if (cierre < 0) {
    throw new Error(
      `abre «${DECLARACION}» en la linea ${declaracion + 1} y no la cierra con una linea «];».`,
    );
  }

  let inicio = declaracion;
  if (declaracion > 0 && lineas[declaracion - 1]!.trimEnd().endsWith("*/")) {
    let apertura = declaracion - 1;
    while (apertura >= 0 && !lineas[apertura]!.trimStart().startsWith("/**")) apertura--;
    if (apertura < 0) {
      throw new Error(
        "el comentario pegado a RUTAS_DE_CODIGO se cierra y no se abre con «/**»: no se puede " +
          "saber donde empieza el bloque propio.",
      );
    }
    inicio = apertura;
  }

  const intrusas = lineas
    .slice(declaracion + 1, cierre)
    .map((linea, i) => ({ numero: declaracion + 2 + i, limpia: linea.trim() }))
    .filter(({ limpia }) => limpia !== "" && !limpia.startsWith("//") && !esUnPatron(limpia));
  if (intrusas.length > 0) {
    throw new Error(
      "dentro de RUTAS_DE_CODIGO hay lineas que no son un patron ni un comentario, y ese bloque " +
        "no se compara con las otras copias: " +
        intrusas.map(({ numero, limpia }) => `linea ${numero} «${limpia}»`).join(", ") +
        ". Si es codigo, va fuera del bloque, y entonces en las seis copias.",
    );
  }

  return {
    lineas: [...lineas.slice(0, inicio), EN_LUGAR_DEL_BLOQUE, ...lineas.slice(cierre + 1)],
    inicio,
    largo: cierre + 1 - inicio,
  };
}

/** La linea del ARCHIVO que corresponde a esa linea de lo comun (ambas desde 0). */
function lineaDelArchivo(comun: LoComun, indice: number): number {
  return indice < comun.inicio ? indice : indice + comun.largo - 1;
}

/**
 * Lo que no cuadra entre las copias, en frases que nombran el repositorio. Vacio si las seis dicen
 * lo mismo fuera de su bloque.
 *
 * Cuando las copias se separan no se elige una de referencia: se agrupan las que coinciden y se
 * dice, para cada grupo que no es el mas numeroso, la primera linea en que se aparta de el. El mas
 * numeroso **no es el correcto por construccion** —`rentas`#132 fue exactamente la copia sola que
 * tenia el arreglo—; es solo contra el que la diferencia se lee mas corta.
 */
export function desajustes(copias: readonly Copia[]): string[] {
  const hallazgos: string[] = [];
  const legibles: { repo: string; comun: LoComun }[] = [];

  for (const copia of copias) {
    if (copia.texto === undefined) {
      hallazgos.push(
        `«${copia.repo}» no tiene su copia del guion en «${copia.ruta}»: una copia que falta no ` +
          "puede divergir, y dejarla fuera de la cuenta es comparar cinco y decir seis.",
      );
      continue;
    }
    try {
      legibles.push({ repo: copia.repo, comun: loComun(copia.texto) });
    } catch (causa) {
      hallazgos.push(`«${copia.repo}» (${copia.ruta}) ${(causa as Error).message}`);
    }
  }

  const grupos = new Map<string, { repo: string; comun: LoComun }[]>();
  for (const legible of legibles) {
    const clave = legible.comun.lineas.join("\n");
    grupos.set(clave, [...(grupos.get(clave) ?? []), legible]);
  }
  const ordenados = [...grupos.values()].sort(
    (a, b) => b.length - a.length || a[0]!.repo.localeCompare(b[0]!.repo),
  );
  const mayoria = ordenados[0];
  for (const grupo of ordenados.slice(1)) {
    const suyo = grupo[0]!.comun;
    const deLaMayoria = mayoria![0]!.comun;
    let i = 0;
    const hasta = Math.max(suyo.lineas.length, deLaMayoria.lineas.length);
    while (i < hasta && suyo.lineas[i] === deLaMayoria.lineas[i]) i++;
    const nombres = (g: { repo: string }[]): string => g.map((x) => x.repo).sort().join(", ");
    hallazgos.push(
      `«${nombres(grupo)}» no dice lo mismo que «${nombres(mayoria!)}» fuera de RUTAS_DE_CODIGO. ` +
        `Se aparta en la linea ${lineaDelArchivo(suyo, i) + 1} de su archivo ` +
        `(la ${lineaDelArchivo(deLaMayoria, i) + 1} del otro grupo): ` +
        `«${suyo.lineas[i] ?? "(fin del archivo)"}» frente a ` +
        `«${deLaMayoria.lineas[i] ?? "(fin del archivo)"}».`,
    );
  }

  return hallazgos;
}
