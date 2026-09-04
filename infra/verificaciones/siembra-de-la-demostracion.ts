import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { raizDelRepositorio } from "../componentes/fuentes";
import { SISTEMAS, clonDe, type Sistema } from "./deriva-de-migraciones";

/**
 * La siembra de la municipalidad de demostracion, **repartida entre tres repositorios**, y
 * las guardas que impiden que su orden y su censo se queden rancios (C-6).
 *
 * ## El defecto que esto cierra, medido y no supuesto
 *
 * Antes del corte, `sembrar-demostracion.sh` nombraba diez pasos en un solo orden y los diez
 * cargadores vivian a su lado. Hoy el paso 5 es de `rentas`, el 6 de `catastro` y el 4 de
 * `caja`, y **nadie los orquesta**. El sintoma es el peor posible: un paso sembrado fuera de
 * orden rechaza sus filas una a una y **termina con codigo 0**. Medido el 2026-09-05 contra
 * PostgreSQL 16.15:
 *
 *   - paso 3 sin el paso 2: «15 fila(s) leidas, 0 manzana(s) nueva(s), 15 rechazada(s)», exit 0
 *   - paso 7 sin el paso 6: «51 fila(s) leidas, 0 ficha(s) versionada(s), 22 rechazado(s)», exit 0
 *
 * Y hay un tercero que solo existe desde el corte, y es todavia mas silencioso: un guion de
 * carga que vive en el repositorio equivocado. `catastro/infra/carga-de-datos/
 * cargar-transferencias-demo.sh` lanzaba un Job con la imagen de `catastro` y la propiedad
 * `sgtm.carga-transferencias-demo.archivo`, y ese cargador vive en `rentas`: la aplicacion
 * arranca, **no ejecuta ni una linea de carga** y sale con codigo 0. Ni un aviso.
 *
 * ## Por que estas guardas viven aqui
 *
 * Porque el orden es un hecho ENTRE sistemas. Escribirlo dentro de uno lo pondria donde su
 * dueno no puede ver a los otros dos, que es exactamente el defecto que C-2 cerro para las
 * extensiones. `infrastructure` es donde viven las barreras que verifican a los cuatro
 * sistemas (ADR-0031).
 *
 * ## Ninguna cifra se escribe aqui, ni en el manifiesto
 *
 * `pasos.tsv` no lleva numeros: lleva expresiones sobre el propio CSV que cada paso carga
 * (`vias.csv:filas`, `detalle-de-fichas.csv:distintos:codigoPredial`). Un numero a mano se
 * queda rancio en cuanto alguien anade una fila, y una comprobacion rancia en verde es el
 * modo de fallo que esto viene a cerrar.
 */

/** Los sistemas que siembran algo de la demostracion. `normativa` no siembra: publica. */
export const SISTEMAS_QUE_SIEMBRAN: readonly string[] = ["rentas", "catastro", "caja"];

/**
 * Guiones de carga que se quedan en `infrastructure` **a proposito**, con su motivo.
 *
 * Los tres son de la familia de los **valores normativos**, no de la siembra: corren como
 * `rol_carga_parametros` y leen el corpus verificado a doble firma. Su sitio natural es
 * `normativa`, que hoy no tiene `infra/` — moverlos es una decision de ese repositorio y de
 * las rutas del corpus, y esta declarada como hueco en C-6. Lo que NO pueden hacer es
 * sembrar: por aqui no entra ni un dato de demostracion.
 */
export const GUIONES_QUE_NO_SIEMBRAN: readonly string[] = [
  "abrir-conjunto-parametros.sh",
  "publicar-parametros.sh",
  "publicar-cuadros.sh",
];

/** Un paso del manifiesto, tal como esta escrito en `pasos.tsv`. */
export interface Paso {
  numero: number;
  sistema: string;
  guion: string;
  /** La propiedad que enciende el cargador: `sgtm.carga-vial`. */
  proceso: string;
  archivo: string;
  /** `<tabla>=<expresion>` por cada tabla que el paso tiene que dejar poblada. */
  comprobacion: string;
  /** Numeros de paso que tienen que estar completos antes. Vacio si ninguno. */
  requiere: readonly number[];
}

function sistemaLlamado(nombre: string): Sistema {
  const sistema = SISTEMAS.find((candidato) => candidato.nombre === nombre);
  if (sistema === undefined) {
    throw new Error(`No hay ningun sistema llamado «${nombre}» en SISTEMAS.`);
  }
  return sistema;
}

/** El directorio de carga de un sistema, en su clon. */
export function cargaDeDatosDe(nombre: string): string {
  return join(clonDe(sistemaLlamado(nombre)), "infra/carga-de-datos");
}

/** El manifiesto, leido. Es el UNICO sitio donde el orden esta escrito. */
export function pasos(): readonly Paso[] {
  const ruta = manifiesto();
  const leidos: Paso[] = [];
  for (const linea of readFileSync(ruta, "utf8").split("\n")) {
    if (linea.startsWith("#") || linea.trim() === "") continue;
    const campos = linea.split("\t");
    if (campos[0] === "paso") continue;
    if (campos.length !== 7) {
      throw new Error(
        `pasos.tsv: la linea «${linea}» tiene ${campos.length} columnas y son 7 ` +
          "(paso, sistema, guion, proceso, archivo, comprobacion, requiere).",
      );
    }
    const [numero, sistema, guion, proceso, archivo, comprobacion, requiere] = campos as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    leidos.push({
      numero: Number(numero),
      sistema,
      guion,
      proceso,
      archivo,
      comprobacion,
      requiere: requiere === "-" ? [] : requiere.split(",").map(Number),
    });
  }
  return leidos;
}

export function manifiesto(): string {
  // El manifiesto vive en ESTE repositorio, no en un clon: es lo que ninguno de los cuatro
  // sistemas puede escribir por su cuenta.
  return join(raizDelRepositorio(), "infra/carga-de-datos/siembra/pasos.tsv");
}

// ---------------------------------------------------------------------------
// Las dos formas de leer un CSV de siembra. El formato lo fijan los propios archivos:
// comentarios con `#` al principio de linea, luego la cabecera, luego los datos.
// Es la MISMA lectura que hace `comprobar-siembra.sh`; escrita dos veces porque una es
// bash contra un motor y otra TypeScript sin motor, y las dos se miden contra los mismos
// archivos: si divergieran, la prueba del censo lo dice.
// ---------------------------------------------------------------------------

function lineasDeDatos(ruta: string): readonly string[] {
  return readFileSync(ruta, "utf8")
    .split("\n")
    .filter((linea) => !linea.startsWith("#") && linea.trim() !== "");
}

export function filasDe(ruta: string): number {
  return Math.max(0, lineasDeDatos(ruta).length - 1);
}

export function distintosDe(ruta: string, columna: string): number {
  const lineas = lineasDeDatos(ruta);
  const cabecera = (lineas[0] ?? "").split(",").map((c) => c.trim());
  const indice = cabecera.indexOf(columna);
  if (indice < 0) {
    throw new Error(
      `«${ruta}» no tiene ninguna columna llamada «${columna}». ` +
        `Las que tiene: ${cabecera.join(", ")}`,
    );
  }
  const vistos = new Set<string>();
  for (const linea of lineas.slice(1)) {
    const valor = (linea.split(",")[indice] ?? "").trim();
    if (valor !== "") vistos.add(valor);
  }
  return vistos.size;
}

/** Resuelve una expresion del manifiesto contra los CSV del sistema que la declara. */
export function resolver(sistema: string, expresion: string): number {
  const ejemplos = join(cargaDeDatosDe(sistema), "ejemplos");
  let total = 0;
  for (const termino of expresion.split("+")) {
    const [archivo, tipo, columna] = termino.split(":");
    const ruta = join(ejemplos, archivo ?? "");
    if (!existsSync(ruta)) {
      throw new Error(`El manifiesto nombra «${archivo}» y no esta en ${ejemplos}`);
    }
    if (tipo === "filas") total += filasDe(ruta);
    else if (tipo === "distintos") total += distintosDe(ruta, columna ?? "");
    else throw new Error(`Expresion desconocida en el manifiesto: «${termino}»`);
  }
  return total;
}

/** `<tabla> -> <esperado>` de un paso, ya resuelto. */
export function esperadoDe(paso: Paso): ReadonlyMap<string, number> {
  const porTabla = new Map<string, number>();
  for (const par of paso.comprobacion.split(";")) {
    const corte = par.indexOf("=");
    porTabla.set(par.slice(0, corte), resolver(paso.sistema, par.slice(corte + 1)));
  }
  return porTabla;
}

// ---------------------------------------------------------------------------
// El acoplamiento que el corte rompio: un guion de carga y el proceso que lo atiende
// tienen que estar en el MISMO repositorio.
// ---------------------------------------------------------------------------

/** Los `.sh` de carga de un sistema, sin los que a proposito no siembran. */
export function guionesDe(sistema: string): readonly string[] {
  const raiz = cargaDeDatosDe(sistema);
  if (!existsSync(raiz)) return [];
  return readdirSync(raiz)
    .filter((n) => n.endsWith(".sh"))
    .filter((n) => !GUIONES_QUE_NO_SIEMBRAN.includes(n))
    .sort();
}

/**
 * La variable `SGTM_..._ARCHIVO` que un guion le pasa al contenedor.
 *
 * Es lo unico que ata el guion al codigo: sin ella el cargador no se enciende
 * (`@ConditionalOnProperty`), y con la de otro sistema la aplicacion arranca, no hace nada
 * y sale con codigo 0.
 */
export function variableDeArchivoDe(sistema: string, guion: string): string | undefined {
  const texto = readFileSync(join(cargaDeDatosDe(sistema), guion), "utf8");
  const encontradas = new Set<string>();
  for (const coincidencia of texto.matchAll(/\bSGTM_[A-Z0-9]+_ARCHIVO\b/g)) {
    encontradas.add(coincidencia[0]);
  }
  const lista = [...encontradas];
  if (lista.length !== 1) return undefined;
  return lista[0];
}

/** `sgtm.carga-vial` -> `SGTM_CARGAVIAL_ARCHIVO`, que es como Spring lo enlaza. */
export function variableDe(proceso: string): string {
  return `${proceso.replace(/-/g, "").replace(/\./g, "_").toUpperCase()}_ARCHIVO`;
}

/** Los procesos de carga que un repositorio implementa, por su `@ConditionalOnProperty`. */
export function procesosDe(sistema: string): readonly string[] {
  const raiz = join(clonDe(sistemaLlamado(sistema)), "backend");
  const encontrados = new Set<string>();
  for (const archivo of javaDe(raiz)) {
    const texto = readFileSync(archivo, "utf8");
    for (const coincidencia of texto.matchAll(/@ConditionalOnProperty\("([^"]+)\.archivo"\)/g)) {
      encontrados.add(coincidencia[1] as string);
    }
  }
  return [...encontrados].sort();
}

function javaDe(raiz: string): readonly string[] {
  const salida: string[] = [];
  const pendientes = [raiz];
  while (pendientes.length > 0) {
    const actual = pendientes.pop() as string;
    let entradas;
    try {
      entradas = readdirSync(actual, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entrada of entradas) {
      const ruta = join(actual, entrada.name);
      // `build/` trae copias compiladas y de recursos; `src/test` no es produccion.
      if (entrada.isDirectory()) {
        if (entrada.name === "build" || entrada.name === "test" || entrada.name === ".git") continue;
        pendientes.push(ruta);
      } else if (entrada.name.endsWith(".java")) {
        salida.push(ruta);
      }
    }
  }
  return salida;
}

/** Guiones cuyo proceso NO existe en su repositorio: arrancan, no cargan nada y salen en verde. */
export function guionesSinProceso(): readonly string[] {
  const sueltos: string[] = [];
  for (const sistema of SISTEMAS_QUE_SIEMBRAN) {
    const variables = new Set(procesosDe(sistema).map(variableDe));
    for (const guion of guionesDe(sistema)) {
      const variable = variableDeArchivoDe(sistema, guion);
      if (variable === undefined) {
        sueltos.push(`${sistema}/${guion}: no manda exactamente una variable ..._ARCHIVO`);
      } else if (!variables.has(variable)) {
        sueltos.push(
          `${sistema}/${guion}: manda ${variable}, y ningun cargador de «${sistema}» la atiende`,
        );
      }
    }
  }
  return sueltos;
}

/** CSV de siembra que existen en mas de un repositorio: nada impide que diverjan. */
export function ejemplosDuplicados(): readonly string[] {
  const donde = new Map<string, string[]>();
  for (const sistema of SISTEMAS_QUE_SIEMBRAN) {
    const ejemplos = join(cargaDeDatosDe(sistema), "ejemplos");
    if (!existsSync(ejemplos)) continue;
    for (const nombre of readdirSync(ejemplos).filter((n) => n.endsWith(".csv"))) {
      donde.set(nombre, [...(donde.get(nombre) ?? []), sistema]);
    }
  }
  return [...donde.entries()]
    .filter(([, sistemas]) => sistemas.length > 1)
    .map(([nombre, sistemas]) => `${nombre}: ${sistemas.join(", ")}`)
    .sort();
}

/** CSV que estan en un repositorio y no los nombra ningun paso: nadie los carga. */
export function ejemplosHuerfanos(): readonly string[] {
  const nombrados = new Set(pasos().map((p) => `${p.sistema}/${p.archivo}`));
  const huerfanos: string[] = [];
  for (const sistema of SISTEMAS_QUE_SIEMBRAN) {
    const ejemplos = join(cargaDeDatosDe(sistema), "ejemplos");
    if (!existsSync(ejemplos)) continue;
    for (const nombre of readdirSync(ejemplos).filter((n) => n.endsWith(".csv"))) {
      if (!nombrados.has(`${sistema}/${nombre}`)) huerfanos.push(`${sistema}/${nombre}`);
    }
  }
  return huerfanos.sort();
}
