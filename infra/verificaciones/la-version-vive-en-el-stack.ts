import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * La version que corre vive en el stack, y nada vuelve a fingir lo contrario (#172).
 *
 * Hasta el 2026-09-14 `index.ts` declaraba un `ignoreChanges` sobre la imagen de los contenedores
 * y el runbook de liberacion enseñaba a revertir con `kubectl rollout undo`. El `ignoreChanges`
 * no llegaba a ningun `Deployment` —lo ponia la opcion `transformations` de un `ConfigGroup`
 * remoto, que no alcanza a sus hijos—, asi que subir `kamayuk:versionDe<Sistema>` cambiaba el
 * binario y el siguiente `pulumi up` deshacia la reversion del runbook. Se eligio la opcion A:
 * la version vive en el stack. Este modulo vigila las dos mitades de esa decision:
 *
 * - **(a) el codigo**: ninguna linea de codigo de `infra/**\/*.ts` declara `ignoreChanges` sobre
 *   la ruta de la imagen de un contenedor. Un `ignoreChanges` asi, que funcionara, volveria a
 *   separar lo declarado de lo que corre; y uno inerte, como el que habia, afirma algo falso.
 * - **(b) el runbook**: su reversion principal es la linea del stack, y toda mencion de
 *   `rollout undo` o `set image` va acompañada de «el siguiente `pulumi up` lo deshace».
 *
 * ## Lo que se aparta, y por que no esconde codigo (#76)
 *
 * Los comentarios se apartan: la memoria de por que se retiro el `ignoreChanges` vive en ellos y
 * tiene que poder nombrarlo. Pero apartar comentarios con una expresion regular esconde codigo —
 * un `"infra/**\/*.ts"` dentro de una cadena abre un bloque falso hasta el siguiente cierre, y la
 * guarda de `sin-el-nombre-del-monolito` perdio asi 268 lineas de un archivo—. Por eso aqui se
 * recorre el texto caracter a caracter distinguiendo cadenas, plantillas y expresiones regulares,
 * y hay muestras de las tres. Las pruebas (`*.test.ts`) no se barren: narran el defecto.
 */

/** Una ruta de propiedad de Pulumi que apunta a la imagen de un contenedor o de un init. */
const RUTA_DE_IMAGEN = /(?:initContainers|containers)(?:\[[^\]\n]*\]|\.\*)\.image$/;

/** Donde vive el runbook, desde la raiz del repositorio. */
export const RUNBOOK = "docs/B0-operacion/runbooks/liberar-una-version-y-revertirla.md";

/** La advertencia que acompaña a toda mencion de la medida de emergencia, ya normalizada. */
export const ADVERTENCIA = "el siguiente pulumi up lo deshace";

export interface Hallazgo {
  readonly archivo: string;
  readonly linea: number;
  readonly texto: string;
  readonly motivo: string;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// (a) El codigo
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Lo que precede a una `/` que abre una expresion regular, y no una division. */
const ANTES_DE_REGEX = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);
const PALABRAS_ANTES_DE_REGEX = /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|void|yield|await)$/;

/**
 * El mismo texto con los comentarios de TypeScript en blanco, y las cadenas intactas.
 *
 * Conserva cada salto de linea, asi que el numero de linea de un hallazgo es el del archivo. Lo
 * que lee como cadena —comillas, plantillas y el texto de una expresion regular— lo copia tal
 * cual: es codigo, y un `ignoreChanges` escrito ahi dentro tambien lo es.
 */
export function sinComentarios(texto: string): string {
  let salida = "";
  let i = 0;
  // Cada `${` abierto dentro de una plantilla apila la profundidad de llaves a la que vuelve.
  const plantillas: number[] = [];
  let llaves = 0;

  /** Copia una cadena desde su comilla de apertura. En una plantilla, hasta su cierre o su `${`. */
  const leerCadena = (cierre: string, desdeDentro: boolean): void => {
    if (!desdeDentro) {
      salida += texto[i];
      i++;
    }
    while (i < texto.length) {
      const c = texto[i];
      if (c === "\\") {
        salida += texto.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (cierre === "`" && c === "$" && texto[i + 1] === "{") {
        salida += "${";
        i += 2;
        plantillas.push(llaves);
        llaves++;
        return;
      }
      salida += c;
      i++;
      if (c === cierre || (c === "\n" && cierre !== "`")) return;
    }
  };

  /** Copia una expresion regular desde su barra de apertura hasta la de cierre. */
  const leerRegex = (): void => {
    let enClase = false;
    salida += texto[i];
    i++;
    while (i < texto.length && texto[i] !== "\n") {
      const r = texto[i];
      if (r === "\\") {
        salida += texto.slice(i, i + 2);
        i += 2;
        continue;
      }
      salida += r;
      i++;
      if (r === "[") enClase = true;
      else if (r === "]") enClase = false;
      else if (r === "/" && !enClase) return;
    }
  };

  while (i < texto.length) {
    const c = texto[i];
    const siguiente = texto[i + 1];
    if (c === "/" && siguiente === "/") {
      while (i < texto.length && texto[i] !== "\n") {
        salida += " ";
        i++;
      }
      continue;
    }
    if (c === "/" && siguiente === "*") {
      const fin = texto.indexOf("*/", i + 2);
      const hasta = fin === -1 ? texto.length : fin + 2;
      salida += texto.slice(i, hasta).replace(/[^\n]/g, " ");
      i = hasta;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      leerCadena(c, false);
      continue;
    }
    if (c === "/") {
      // Lo anterior que no es blanco, mirando hacia atras sin copiar la salida entera: un
      // `replace` sobre todo lo leido en cada barra hace cuadratico un archivo de mil lineas.
      let k = salida.length - 1;
      while (k >= 0 && /\s/.test(salida[k] ?? "")) k--;
      const antes = salida.slice(Math.max(0, k - 11), k + 1);
      if (ANTES_DE_REGEX.has(antes.slice(-1)) || PALABRAS_ANTES_DE_REGEX.test(antes)) {
        leerRegex();
        continue;
      }
    }
    if (c === "{") llaves++;
    if (c === "}") {
      llaves--;
      if (plantillas.length > 0 && llaves === plantillas[plantillas.length - 1]) {
        // Cierra un `${…}`: lo que sigue vuelve a ser la plantilla.
        plantillas.pop();
        salida += c;
        i++;
        leerCadena("`", true);
        continue;
      }
    }
    salida += c;
    i++;
  }
  return salida;
}

/** Las cadenas de un codigo ya sin comentarios que son una ruta a la imagen de un contenedor. */
function rutasDeImagen(codigo: string): { valor: string; linea: number }[] {
  const salida: { valor: string; linea: number }[] = [];
  const cadena = /(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  for (const m of codigo.matchAll(cadena)) {
    const valor = m[2] ?? "";
    if (RUTA_DE_IMAGEN.test(valor)) {
      salida.push({ valor, linea: codigo.slice(0, m.index).split("\n").length });
    }
  }
  return salida;
}

/** Los nombres de constante cuyo valor contiene una ruta a la imagen: `const X = ["…image"]`. */
function constantesConRutaDeImagen(codigo: string): string[] {
  const nombres: string[] = [];
  const declaracion = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*([^;]*)/g;
  for (const m of codigo.matchAll(declaracion)) {
    if (m[1] !== undefined && rutasDeImagen(m[2] ?? "").length > 0) nombres.push(m[1]);
  }
  return nombres;
}

export interface Fuente {
  /** Ruta relativa a la raiz del repositorio, para el mensaje. */
  readonly archivo: string;
  readonly texto: string;
}

/**
 * Los `ignoreChanges` de codigo que apuntan a la imagen de un contenedor.
 *
 * Tres formas, las tres con muestra: la ruta escrita en el mismo `ignoreChanges`; una constante
 * del mismo archivo —la forma que tenia `IGNORAR_LA_VERSION`—; y una constante exportada desde
 * otro archivo, que una comprobacion por archivo no veria.
 */
export function ignoreChangesSobreLaImagen(fuentes: readonly Fuente[]): Hallazgo[] {
  const codigos = fuentes.map((f) => ({ ...f, codigo: sinComentarios(f.texto) }));
  const constantes = new Set(codigos.flatMap((f) => constantesConRutaDeImagen(f.codigo)));
  const hallazgos: Hallazgo[] = [];
  for (const f of codigos) {
    const lineas = f.codigo.split("\n");
    const rutasDelArchivo = rutasDeImagen(f.codigo);
    lineas.forEach((linea, n) => {
      if (!/\bignoreChanges\b/.test(linea)) return;
      // Lo que el `ignoreChanges` recibe: el resto de su linea y las cuatro siguientes, que es
      // donde cabe un arreglo escrito en varias lineas.
      const valor = [linea.slice(linea.search(/\bignoreChanges\b/)), ...lineas.slice(n + 1, n + 5)].join("\n");
      const nombre = [...constantes].find((c) => new RegExp(`(?<![\\w$])${c.replace(/\$/g, "\\$")}(?![\\w$])`).test(valor));
      const enLinea = rutasDeImagen(valor)[0];
      let motivo: string | undefined;
      if (enLinea !== undefined) motivo = `lo escribe ahi mismo: «${enLinea.valor}»`;
      else if (nombre !== undefined) motivo = `recibe «${nombre}», que es una ruta a la imagen`;
      else if (rutasDelArchivo.length > 0) {
        motivo = `y el mismo archivo declara «${rutasDelArchivo[0]?.valor}» en su linea ${rutasDelArchivo[0]?.linea}`;
      }
      if (motivo !== undefined) {
        hallazgos.push({ archivo: f.archivo, linea: n + 1, texto: (f.texto.split("\n")[n] ?? "").trim(), motivo });
      }
    });
  }
  return hallazgos;
}

/** Los `.ts` de codigo de `infra/`: sin `node_modules`, sin pruebas y sin este modulo. */
export function fuentesDeInfra(raizDelRepositorio: string): Fuente[] {
  const raiz = join(raizDelRepositorio, "infra");
  const salida: Fuente[] = [];
  const recorrer = (dir: string): void => {
    for (const entrada of readdirSync(dir)) {
      if (entrada === "node_modules" || entrada.startsWith(".")) continue;
      const completa = join(dir, entrada);
      if (statSync(completa).isDirectory()) {
        recorrer(completa);
        continue;
      }
      if (!entrada.endsWith(".ts") || entrada.endsWith(".test.ts") || entrada.endsWith(".d.ts")) continue;
      // Este modulo describe lo que busca, y lo describe en codigo: sus expresiones nombran
      // `ignoreChanges`. Sus muestras, en `la-version-vive-en-el-stack.test.ts`, son las que
      // demuestran que la busqueda muerde.
      if (entrada === "la-version-vive-en-el-stack.ts") continue;
      salida.push({ archivo: relative(raizDelRepositorio, completa), texto: readFileSync(completa, "utf8") });
    }
  };
  recorrer(raiz);
  return salida;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// (b) El runbook
// ─────────────────────────────────────────────────────────────────────────────────────────────

interface Linea {
  readonly numero: number;
  readonly texto: string;
  /** Dentro de un bloque de codigo cercado. */
  readonly enCodigo: boolean;
}

export interface Seccion {
  readonly titulo: string;
  readonly nivel: number;
  /** Los titulos de las secciones que la contienen, de fuera a dentro. */
  readonly ancestros: readonly string[];
  readonly lineas: readonly Linea[];
}

/** El documento partido por encabezados, sin confundir un `# comentario` de bash con uno. */
export function secciones(markdown: string): Seccion[] {
  const salida: { titulo: string; nivel: number; ancestros: string[]; lineas: Linea[] }[] = [];
  const pila: { titulo: string; nivel: number }[] = [];
  let actual = { titulo: "", nivel: 0, ancestros: [] as string[], lineas: [] as Linea[] };
  salida.push(actual);
  let enCodigo = false;
  markdown.split("\n").forEach((texto, i) => {
    if (/^\s*(```|~~~)/.test(texto)) {
      enCodigo = !enCodigo;
      actual.lineas.push({ numero: i + 1, texto, enCodigo: true });
      return;
    }
    const encabezado = enCodigo ? null : /^(#{1,6})\s+(.*)$/.exec(texto);
    if (encabezado?.[1] !== undefined && encabezado[2] !== undefined) {
      const nivel = encabezado[1].length;
      while (pila.length > 0 && (pila[pila.length - 1]?.nivel ?? 0) >= nivel) pila.pop();
      actual = { titulo: encabezado[2], nivel, ancestros: pila.map((p) => p.titulo), lineas: [] };
      pila.push({ titulo: encabezado[2], nivel });
      salida.push(actual);
    }
    actual.lineas.push({ numero: i + 1, texto, enCodigo });
  });
  return salida;
}

/** Sin marcas de Markdown ni saltos: lo que se lee. */
export function normalizar(texto: string): string {
  return texto
    .replace(/^\s*>\s?/gm, "")
    .replace(/[`*_«»]/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const MEDIDA_DE_EMERGENCIA = /rollout\s+undo|set\s+image/i;

/** Una linea de un bloque de codigo que es comentario de shell. */
const esComentarioDeShell = (l: Linea): boolean => l.enCodigo && /^\s*#/.test(l.texto);

/** Los bloques de codigo de una seccion y de sus subsecciones, en orden. */
function bloquesDe(todas: readonly Seccion[], indice: number): Linea[][] {
  const raiz = todas[indice];
  if (raiz === undefined) return [];
  const bloques: Linea[][] = [];
  let bloque: Linea[] | null = null;
  for (let j = indice; j < todas.length; j++) {
    const s = todas[j];
    if (s === undefined || (j > indice && s.nivel <= raiz.nivel)) break;
    for (const l of s.lineas) {
      if (/^\s*(```|~~~)/.test(l.texto)) {
        if (bloque === null) bloque = [];
        else {
          bloques.push(bloque);
          bloque = null;
        }
        continue;
      }
      if (bloque !== null) bloque.push(l);
    }
  }
  return bloques;
}

export interface LecturaDelRunbook {
  readonly hallazgos: Hallazgo[];
  /** Cuantas menciones de la medida de emergencia se leyeron. Cero es que no se miro nada. */
  readonly menciones: number;
  readonly seccionDeReversion: string | undefined;
  readonly seccionDeEmergencia: string | undefined;
}

/** Las reglas de (b), sobre el texto de un runbook. */
export function revisarRunbook(markdown: string, archivo = RUNBOOK): LecturaDelRunbook {
  const todas = secciones(markdown);
  const hallazgos: Hallazgo[] = [];
  const hallar = (linea: number, texto: string, motivo: string): void => {
    hallazgos.push({ archivo, linea, texto: texto.trim().slice(0, 140), motivo });
  };

  // 1. La reversion principal es la linea del stack.
  const indiceDeReversion = todas.findIndex((s) => s.nivel >= 2 && /\brevertir\b/i.test(s.titulo) && !/emergencia/i.test(s.titulo));
  const reversion = todas[indiceDeReversion];
  if (reversion !== undefined) {
    const primero = bloquesDe(todas, indiceDeReversion)[0];
    const codigo = (primero ?? []).filter((l) => !esComentarioDeShell(l));
    if (primero === undefined) {
      hallar(reversion.lineas[0]?.numero ?? 0, reversion.titulo, "la seccion de reversion no trae ningun bloque de ordenes");
    } else {
      for (const l of codigo) {
        if (MEDIDA_DE_EMERGENCIA.test(l.texto)) {
          hallar(l.numero, l.texto, "la reversion principal vuelve a ser `kubectl`: tiene que ser bajar `kamayuk:versionDe<Sistema>`");
        }
      }
      if (!codigo.some((l) => /kamayuk:versionDe|Pulumi\.[<\w]/.test(l.texto))) {
        hallar(primero[0]?.numero ?? 0, primero[0]?.texto ?? "", "el primer bloque de la reversion no toca `kamayuk:versionDe<Sistema>` ni `Pulumi.<amb>.yaml`");
      }
    }
  }

  // 2 y 3. Toda mencion va con la advertencia, y toda orden va bajo «emergencia».
  let menciones = 0;
  for (const s of todas) {
    const leidas = s.lineas.filter((l) => !esComentarioDeShell(l));
    const prosa = normalizar(leidas.filter((l) => !l.enCodigo).map((l) => l.texto).join("\n"));
    const mencionesDeProsa = prosa.match(new RegExp(MEDIDA_DE_EMERGENCIA.source, "gi"))?.length ?? 0;
    const ordenes = leidas.filter((l) => l.enCodigo && MEDIDA_DE_EMERGENCIA.test(l.texto));
    menciones += mencionesDeProsa + ordenes.length;
    if (mencionesDeProsa + ordenes.length === 0) continue;
    const conAdvertencia = normalizar(s.lineas.map((l) => l.texto).join("\n")).includes(ADVERTENCIA);
    if (!conAdvertencia) {
      const primera = leidas.find((l) => MEDIDA_DE_EMERGENCIA.test(normalizar(l.texto))) ?? leidas.find((l) => /rollout|set/i.test(l.texto));
      hallar(
        primera?.numero ?? s.lineas[0]?.numero ?? 0,
        primera?.texto ?? s.titulo,
        `la seccion «${s.titulo || "(cabecera)"}» nombra \`rollout undo\`/\`set image\` sin decir «el siguiente \`pulumi up\` lo deshace»`,
      );
    }
    const bajoEmergencia = [s.titulo, ...s.ancestros].some((t) => /emergencia/i.test(t));
    for (const l of ordenes) {
      if (!bajoEmergencia) {
        hallar(l.numero, l.texto, `una orden \`kubectl\` de la medida de emergencia fuera de una seccion «emergencia» (esta en «${s.titulo}»)`);
      }
    }
  }

  return {
    hallazgos,
    menciones,
    seccionDeReversion: reversion?.titulo,
    seccionDeEmergencia: todas.find((s) => s.nivel >= 2 && /emergencia/i.test(s.titulo))?.titulo,
  };
}
