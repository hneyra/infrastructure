import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SISTEMAS_DEL_PRODUCTO } from "../componentes/convenciones";
import { clonDe, sistemaLlamado } from "./deriva-de-migraciones";

/**
 * El catalogo unido de `identidad` contra el catalogo REAL de cada uno de los cinco
 * (AC-4 de [identidad#2](https://github.com/hneyra/identidad/issues/2)).
 *
 * ## Que se compara, y por que no lo puede comprobar ningun repositorio solo
 *
 * Desde ADR-0039 la autorizacion es un sistema propio, y lo que `identidad` guarda no es
 * su menu sino **a quien se le concede cada opcion de los cinco catalogos**. Por eso su
 * esquema le anade a `modulo_sistema` y a `acceso` la columna `sistema` y llavea por
 * ella, y por eso su repositorio lleva cinco archivos —`docs/10-negocio/catalogo-de-accesos/
 * <sistema>.json`— con las opciones de los cinco.
 *
 * **Cuatro de esos cinco archivos son COPIAS de una verdad que vive en otro repositorio.**
 * El original de `rentas` es su `docs/10-negocio/catalogo-de-opciones.md` —las 134 filas
 * del manual, que `CatalogoDeOpciones` lee para sembrar—; el de `catastro`, `normativa`,
 * `caja` e `identidad` es la lista escrita de su `CatalogoDelSistema.java`. Desde
 * `catastro` no se puede ver si la copia esta al dia, porque la copia esta en `identidad`;
 * desde `identidad` tampoco, porque el original esta en `catastro`. Esta guarda es el
 * unico sitio donde las dos puntas se ven a la vez, que es exactamente el papel que
 * ADR-0031 le da a este repositorio.
 *
 * ## Lo que cuesta que se separen, y no es un error
 *
 * Las dos direcciones duelen y duelen de forma distinta, asi que las dos son rojo:
 *
 * - **Una opcion que el clon tiene y el archivo no**: `identidad` no siembra su fila de
 *   `acceso`, asi que **nadie puede dar permiso sobre esa pantalla** y el guardia del
 *   sistema que la sirve niega a todo el mundo, administrador incluido. Es RF-122 por su
 *   cara mas cara, y ya paso: `catastro#43` midio ocho endpoints en 403 para todo el
 *   mundo durante el corte entero, porque su catalogo se habia quedado corto y la guarda
 *   que existia para verlo miraba el fuente con una expresion regular que no veia
 *   constantes.
 * - **Una opcion que el archivo tiene y el clon no**: `identidad` siembra una fila de
 *   `acceso` que ninguna pantalla exige, y sobre ella se pueden otorgar permisos. Ruido en
 *   la pantalla de permisos y una promesa falsa —un privilegio que no habilita nada—.
 *
 * ## Los cinco no se escriben aqui
 *
 * Salen de {@link SISTEMAS_DEL_PRODUCTO}, que es la misma lista con la que el descriptor
 * compone los espacios de nombres. Una lista propia seria un sexto sitio donde olvidarse
 * de un sistema, y el olvido no daria rojo: daria **un sistema sin comparar**, en verde.
 *
 * Y la ruta del `CatalogoDelSistema.java` de cada clon **se busca, no se escribe**. Es la
 * leccion que `prefijo-de-la-implantacion.ts` acaba de pagar en este mismo repositorio:
 * tenia el modulo `-seguridad` dentro de la ruta y la etapa 2 de `identidad` movio el
 * archivo a `nucleo`, con lo que la guarda dejo de poder correr. Aqui se recorre el
 * `backend/` del clon buscando el archivo por su nombre, y si hay dos o ninguno se dice.
 *
 * ## Y si no se puede comparar, NO se pasa en verde
 *
 * C-15/C-16: «no se pudo comprobar» no se lee igual que «esta bien». Si falta el
 * directorio de catalogos, si falta uno de los cinco archivos, si no se encuentra el
 * catalogo de un clon o si el analisis devuelve cero opciones, esto **lanza** nombrando lo
 * que falta y el `git clone` que lo trae. Todo lo que este modulo afirma es cierto sobre el
 * conjunto vacio, asi que sin esos centinelas una guarda que dejara de encontrar los
 * archivos informaria de que los cinco catalogos cuadran.
 */

/** Donde `identidad` guarda las cinco copias, relativo a su clon. */
export const DIRECTORIO_DEL_CATALOGO_UNIDO = "docs/10-negocio/catalogo-de-accesos";

/** El catalogo del manual, del que `rentas` deriva sus 134. Relativo a su clon. */
export const CATALOGO_DEL_MANUAL = "docs/10-negocio/catalogo-de-opciones.md";

/** Como se llama, en cualquier clon, la clase que lleva la lista escrita. */
export const CLASE_DEL_CATALOGO = "CatalogoDelSistema.java";

/** Una opcion del menu, tal como la declaran las dos puntas. */
export interface Opcion {
  moduloCodigo: string;
  moduloNombre: string;
  codigo: string;
  nombre: string;
}

/** Un desajuste entre el archivo de `identidad` y el catalogo real de un sistema. */
export interface Desajuste {
  sistema: string;
  /** `clon` = la tiene el sistema y no el archivo; `archivo` = al reves. */
  lado: "clon" | "archivo";
  opcion: Opcion;
  /** Lo que cuesta, escrito para quien lea el rojo sin saber de que va. */
  porque: string;
}

/** La opcion como sale en el rojo y como se compara: modulo, codigo y nombre. */
export function comoSeLee(opcion: Opcion): string {
  return `${opcion.moduloCodigo} («${opcion.moduloNombre}») · ${opcion.codigo} («${opcion.nombre}»)`;
}

/**
 * Las cinco copias que `identidad` guarda, leidas de su clon.
 *
 * Lanza si el directorio no esta o si no estan los cinco: un catalogo unido al que le
 * falta un sistema no siembra sus accesos, y eso no se puede leer como «cuadran».
 */
export function opcionesDeclaradas(sistema: string): Opcion[] {
  const raiz = clonDe(sistemaLlamado("identidad"));
  const directorio = join(raiz, DIRECTORIO_DEL_CATALOGO_UNIDO);
  if (!existsSync(directorio)) {
    throw new Error(
      `No esta «${directorio}», donde «identidad» guarda el catalogo unido de los cinco ` +
        "sistemas (ADR-0039). Sin el no se puede comparar ninguna copia con su original, y " +
        "«no se pudo comprobar» no es «esta bien» (C-15/C-16).\n" +
        "  Remedio: git clone https://github.com/hneyra/identidad, o traerse la etapa 2 de " +
        "identidad#2, que es quien lo escribe.",
    );
  }

  const archivo = join(directorio, `${sistema}.json`);
  if (!existsSync(archivo)) {
    const hay = readdirSync(directorio).sort().join(", ");
    throw new Error(
      `No esta «${archivo}». «identidad» siembra ${sistema === "identidad" ? "sus" : "los"} ` +
        `accesos de «${sistema}» leyendo ese archivo, asi que sin el ninguna de sus opciones ` +
        "tiene fila en `acceso` y NADIE puede dar permiso sobre esas pantallas (RF-122).\n" +
        `  Los que hay: ${hay || "ninguno"}.`,
    );
  }

  const crudo: unknown = JSON.parse(readFileSync(archivo, "utf8"));
  const catalogo = crudo as {
    sistema?: string;
    modulos?: { codigo?: string; nombre?: string; opciones?: { codigo?: string; nombre?: string }[] }[];
  };

  if (catalogo.sistema !== sistema) {
    throw new Error(
      `«${archivo}» dice ser el catalogo de «${catalogo.sistema ?? "(nada)"}» y esta en el ` +
        `archivo de «${sistema}». El nombre decide con que \`sistema\` se siembran sus filas ` +
        "de `modulo_sistema` y `acceso`, y esa columna es la que separa dos opciones que se " +
        "llaman igual en dos sistemas distintos.",
    );
  }

  const opciones: Opcion[] = [];
  for (const modulo of catalogo.modulos ?? []) {
    for (const opcion of modulo.opciones ?? []) {
      opciones.push({
        moduloCodigo: exigir(modulo.codigo, archivo, "modulos[].codigo"),
        moduloNombre: exigir(modulo.nombre, archivo, "modulos[].nombre"),
        codigo: exigir(opcion.codigo, archivo, "opciones[].codigo"),
        nombre: exigir(opcion.nombre, archivo, "opciones[].nombre"),
      });
    }
  }

  if (opciones.length === 0) {
    throw new Error(
      `«${archivo}» no declara ni una opcion. O el archivo se vacio, o su forma cambio y este ` +
        "analisis dejo de reconocerla; en los dos casos la comparacion de abajo se cumpliria " +
        "sobre el conjunto vacio y diria que la copia y el original cuadran.",
    );
  }
  return opciones;
}

function exigir(valor: string | undefined, archivo: string, campo: string): string {
  if (valor === undefined || valor === "") {
    throw new Error(
      `«${archivo}» tiene una entrada sin «${campo}». La comparacion es por (modulo, codigo, ` +
        "nombre), asi que un campo vacio compararia contra la cadena vacia y cuadraria con " +
        "cualquier cosa.",
    );
  }
  return valor;
}

/**
 * El catalogo REAL de un sistema, leido de su clon.
 *
 * `rentas` deriva las suyas del documento del manual —es lo que `CatalogoDeOpciones.leer()`
 * hace en produccion, y por eso aqui se repite su analisis y no se lee otra cosa—; los
 * otros cuatro las escriben en `CatalogoDelSistema.java`.
 */
export function opcionesDelClon(sistema: string): Opcion[] {
  const raiz = clonDe(sistemaLlamado(sistema));
  const opciones =
    sistema === "rentas"
      ? opcionesDelManual(raiz)
      : opcionesDeLaClase(raiz, rutaDelCatalogoDelSistema(raiz, sistema));

  for (const opcion of opciones) {
    // El `?? ""` con que este analisis satisface `noUncheckedIndexedAccess` no puede
    // convertirse en una tolerancia: una terna con un campo vacio compararia contra la
    // cadena vacia del otro lado y cuadraria con cualquier cosa. Si aparece, es que el
    // analisis dejo de reconocer la forma del archivo, y eso se dice.
    if (Object.values(opcion).some((campo) => campo === "")) {
      throw new Error(
        `El catalogo de «${sistema}» en «${raiz}» produce una opcion con algun campo vacio ` +
          `(${JSON.stringify(opcion)}). Este analisis dejo de reconocer la forma del archivo, ` +
          "y una terna con un hueco cuadraria con cualquier cosa del otro lado.",
      );
    }
  }

  if (opciones.length === 0) {
    throw new Error(
      `El catalogo de «${sistema}» en su clon «${raiz}» no declara ni una opcion. O se vacio, ` +
        "o su forma cambio y este analisis dejo de reconocerla. Se falla en vez de comparar " +
        "contra el conjunto vacio: asi la copia de `identidad` saldria «de mas» en todas sus " +
        "opciones, que es un rojo que no dice lo que pasa, o —peor— cuadraria con un archivo " +
        "tambien vacio.",
    );
  }
  return opciones;
}

/** Las 134 de `rentas`, con el MISMO analisis que `CatalogoDeOpciones` hace en produccion. */
function opcionesDelManual(raiz: string): Opcion[] {
  const archivo = join(raiz, CATALOGO_DEL_MANUAL);
  if (!existsSync(archivo)) {
    throw new Error(
      `No esta «${archivo}», que es de donde «rentas» saca sus opciones: su build lo copia a ` +
        "los recursos y `CatalogoDeOpciones.leer()` lo analiza al sembrar. Sin el no hay con " +
        "que comparar la copia de `identidad`.\n" +
        "  Remedio: git clone https://github.com/hneyra/rentas",
    );
  }

  const markdown = readFileSync(archivo, "utf8");
  const encabezados = [...markdown.matchAll(/^## (.+)$/gm)];
  const opciones: Opcion[] = [];

  for (const [indice, encabezado] of encabezados.entries()) {
    const desde = encabezado.index + (encabezado[0] ?? "").length;
    const hasta = encabezados[indice + 1]?.index ?? markdown.length;
    const nombreDelModulo = (encabezado[1] ?? "").trim();
    for (const fila of markdown.slice(desde, hasta).matchAll(/^\| `([a-z0-9_]+)` \| ([^|]+?) \|/gm)) {
      opciones.push({
        moduloCodigo: codigoDelModulo(nombreDelModulo),
        moduloNombre: nombreDelModulo,
        codigo: fila[1] ?? "",
        nombre: (fila[2] ?? "").trim(),
      });
    }
  }
  return opciones;
}

/**
 * El codigo de un modulo a partir de su nombre, igual que `CatalogoDeOpciones.codigoDe`.
 *
 * «Rentas · Registro» queda en `RENTAS_REGISTRO`. Se genera y no se elige a mano por lo
 * mismo que alli: agregar un modulo al catalogo no debe exigir tocar tambien una tabla de
 * correspondencias.
 */
function codigoDelModulo(nombre: string): string {
  const sinTildes = nombre.normalize("NFD").replace(/\p{M}/gu, "");
  const codigo = sinTildes
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return codigo.length > 30 ? codigo.slice(0, 30) : codigo;
}

/**
 * Donde vive el `CatalogoDelSistema.java` de un clon. **Se busca, no se escribe.**
 *
 * La ruta lleva dentro el nombre del modulo Gradle, y un modulo se renombra: la etapa 2 de
 * `identidad` movio medio repositorio de `-seguridad` a `-nucleo` y dejo roto el
 * `prefijo-de-la-implantacion.ts` de aqui, que tenia la suya escrita. Se recorre el
 * `backend/` y se exige encontrar exactamente uno.
 */
function rutaDelCatalogoDelSistema(raiz: string, sistema: string): string {
  const encontrados = buscar(join(raiz, "backend"), CLASE_DEL_CATALOGO);
  if (encontrados.length !== 1) {
    throw new Error(
      `En el clon de «${sistema}» (${raiz}) hay ${encontrados.length} archivos ` +
        `«${CLASE_DEL_CATALOGO}» y tiene que haber exactamente uno: es la lista de opciones ` +
        "que ese sistema sirve, y de ella sale lo que `identidad` copia en su catalogo unido." +
        (encontrados.length === 0
          ? "\n  Remedio: git clone https://github.com/hneyra/" + sistema
          : `\n  Los que hay: ${encontrados.map((r) => r.slice(raiz.length + 1)).join(", ")}`),
    );
  }
  // `encontrados.length !== 1` ya paro arriba, asi que aqui hay exactamente uno; el `??`
  // es para `noUncheckedIndexedAccess` y no una tolerancia: si llegara vacio, la cadena
  // vacia haria fallar la lectura del archivo con su propio mensaje.
  return encontrados[0] ?? "";
}

/** Recorrido del arbol buscando un nombre de archivo, saltandose `build/`. */
function buscar(directorio: string, nombre: string): string[] {
  if (!existsSync(directorio)) {
    return [];
  }
  const encontrados: string[] = [];
  for (const entrada of readdirSync(directorio, { withFileTypes: true })) {
    if (entrada.isDirectory()) {
      if (entrada.name === "build" || entrada.name === ".git" || entrada.name === "node_modules") {
        continue;
      }
      encontrados.push(...buscar(join(directorio, entrada.name), nombre));
    } else if (entrada.name === nombre) {
      encontrados.push(join(directorio, entrada.name));
    }
  }
  return encontrados;
}

/**
 * Las opciones escritas en un `CatalogoDelSistema.java`, en sus DOS formas.
 *
 * `catastro`, `normativa` y `caja` las escriben enteras —`new Opcion("CATASTRO", "Catastro",
 * "ficha_urbana", "…")`— e `identidad` con un ayudante de dos argumentos que pone el modulo
 * desde dos constantes de la clase, porque las suyas son todas del mismo. Se admiten las dos
 * y **nada mas**: un tercer molde lanza nombrando el archivo, en vez de devolver menos
 * opciones de las que hay, que es lo que dejaria pasar una copia incompleta.
 */
function opcionesDeLaClase(raiz: string, archivo: string): Opcion[] {
  // Sin comentarios, y no es una precaucion: el comentario con que `catastro#43` explica
  // por que `calles` y `sectores` faltaban lleva un punto y coma dentro, asi que el
  // inicializador se cortaba ahi y este analisis devolvia SIETE de sus dieciseis opciones
  // —o sea que la guarda habria dicho que a `identidad` le sobran nueve, que es un rojo que
  // manda a mirar el repositorio equivocado—. Medido antes de escribir esta linea.
  const fuente = sinComentarios(readFileSync(archivo, "utf8"));
  const constantes = new Map<string, string>();
  for (const constante of fuente.matchAll(
    /\bstatic\s+final\s+String\s+([A-Z_][A-Z0-9_]*)\s*=\s*"([^"]*)"/g,
  )) {
    constantes.set(constante[1] ?? "", constante[2] ?? "");
  }

  const cuerpo = inicializadorDeOpciones(fuente, archivo, raiz);
  const opciones: Opcion[] = [];

  for (const llamada of cuerpo.matchAll(/(?:\bnew\s+Opcion|(?<![.\w])opcion)\s*\(/g)) {
    const argumentos = argumentosDe(
      cuerpo,
      llamada.index + (llamada[0] ?? "").length - 1,
    ).map((crudo) => resolver(crudo, constantes, archivo));
    if (argumentos.length === 4) {
      opciones.push({
        moduloCodigo: argumentos[0] ?? "",
        moduloNombre: argumentos[1] ?? "",
        codigo: argumentos[2] ?? "",
        nombre: argumentos[3] ?? "",
      });
    } else if (argumentos.length === 2) {
      opciones.push({
        moduloCodigo: resolver("MODULO_CODIGO", constantes, archivo),
        moduloNombre: resolver("MODULO_NOMBRE", constantes, archivo),
        codigo: argumentos[0] ?? "",
        nombre: argumentos[1] ?? "",
      });
    } else {
      throw new Error(
        `«${archivo}» construye una opcion con ${argumentos.length} argumentos, y este ` +
          "analisis solo entiende dos moldes: los cuatro campos escritos enteros, o el " +
          "ayudante de dos que toma el modulo de MODULO_CODIGO y MODULO_NOMBRE.\n" +
          "  Se falla en vez de saltarse la llamada: saltarsela devolveria MENOS opciones de " +
          "las que ese sistema sirve, y entonces esta guarda diria que a la copia de " +
          "`identidad` le SOBRAN opciones — un rojo que manda a mirar donde no es.",
      );
    }
  }
  return opciones;
}

/**
 * El fuente sin comentarios, recorrido caracter a caracter y no con una expresion regular.
 *
 * Un `//` dentro de una cadena no abre un comentario, y borrarlo se llevaria por delante el
 * literal que viene detras en la misma linea — que aqui es justamente el nombre de una
 * opcion. Los literales se conservan tal cual: es lo que se compara.
 */
function sinComentarios(fuente: string): string {
  let salida = "";
  let i = 0;
  while (i < fuente.length) {
    if (fuente.startsWith("//", i)) {
      const fin = fuente.indexOf("\n", i);
      i = fin < 0 ? fuente.length : fin;
    } else if (fuente.startsWith("/*", i)) {
      const fin = fuente.indexOf("*/", i + 2);
      i = fin < 0 ? fuente.length : fin + 2;
    } else if (fuente[i] === '"') {
      let fin = i + 1;
      while (fin < fuente.length && fuente[fin] !== '"') {
        fin += fuente[fin] === "\\" ? 2 : 1;
      }
      fin = Math.min(fin + 1, fuente.length);
      salida += fuente.slice(i, fin);
      i = fin;
    } else {
      salida += fuente[i];
      i += 1;
    }
  }
  return salida;
}

/** El texto del inicializador de `OPCIONES`, hasta el `;` que lo cierra. */
function inicializadorDeOpciones(fuente: string, archivo: string, raiz: string): string {
  const inicio = /\bOPCIONES\s*=/.exec(fuente);
  if (inicio === null) {
    throw new Error(
      `«${archivo}» (clon ${raiz}) no declara ningun \`OPCIONES =\`, que es donde los cuatro ` +
        "sistemas escriben la lista que sirven. O se renombro, o la clase dejo de tener la " +
        "forma que este analisis reconoce. Se falla en vez de devolver una lista vacia.",
    );
  }
  const fin = fuente.indexOf(";", inicio.index);
  return fuente.slice(inicio.index, fin < 0 ? fuente.length : fin);
}

/** Los argumentos de una llamada, partidos por las comas del NIVEL de esos parentesis. */
function argumentosDe(texto: string, aperturaDelParentesis: number): string[] {
  const argumentos: string[] = [];
  let actual = "";
  let nivel = 0;
  let dentroDeCadena = false;

  for (let i = aperturaDelParentesis; i < texto.length; i++) {
    const caracter = texto[i];
    if (dentroDeCadena) {
      actual += caracter;
      if (caracter === "\\") {
        actual += texto[++i] ?? "";
      } else if (caracter === '"') {
        dentroDeCadena = false;
      }
      continue;
    }
    if (caracter === '"') {
      dentroDeCadena = true;
      actual += caracter;
    } else if (caracter === "(") {
      nivel += 1;
      if (nivel > 1) actual += caracter;
    } else if (caracter === ")") {
      nivel -= 1;
      if (nivel === 0) {
        if (actual.trim() !== "") argumentos.push(actual.trim());
        return argumentos;
      }
      actual += caracter;
    } else if (caracter === "," && nivel === 1) {
      argumentos.push(actual.trim());
      actual = "";
    } else {
      actual += caracter;
    }
  }
  return argumentos;
}

/** Un argumento: o un literal de cadena —quiza partido por el formateador— o una constante. */
function resolver(crudo: string, constantes: Map<string, string>, archivo: string): string {
  const literales = [...crudo.matchAll(/"((?:[^"\\]|\\.)*)"/g)];
  if (literales.length > 0) {
    return literales.map((literal) => (literal[1] ?? "").replace(/\\"/g, '"')).join("");
  }
  const constante = constantes.get(crudo.trim());
  if (constante !== undefined) {
    return constante;
  }
  throw new Error(
    `«${archivo}» construye una opcion con «${crudo}», que no es un literal de cadena ni una ` +
      "constante `static final String` de esa misma clase. Este analisis no evalua Java, asi " +
      "que se para y lo dice: devolver la expresion como si fuera el valor haria que esta " +
      "guarda comparara texto que nunca llega a la base.",
  );
}

/**
 * Los desajustes de un sistema, **en las dos direcciones**.
 *
 * La comparacion es por la terna entera —modulo, codigo y nombre— y no solo por el codigo:
 * el codigo es la clave del permiso, pero el modulo decide bajo que rama del arbol sale la
 * pantalla y el nombre es lo que se lee en la de permisos. Dos catalogos que coincidieran en
 * los codigos y discreparan en el nombre dejarian al administrador otorgando «Ficha
 * catastral rural» sobre lo que la otra base llama otra cosa.
 */
export function desajustesDe(sistema: string): Desajuste[] {
  const enElClon = new Map(opcionesDelClon(sistema).map((o) => [comoSeLee(o), o]));
  const enElArchivo = new Map(opcionesDeclaradas(sistema).map((o) => [comoSeLee(o), o]));
  const desajustes: Desajuste[] = [];

  for (const [clave, opcion] of enElClon) {
    if (!enElArchivo.has(clave)) {
      desajustes.push({
        sistema,
        lado: "clon",
        opcion,
        porque:
          `«${sistema}» sirve esta opcion y el catalogo unido de «identidad» no la trae, asi ` +
          "que no se siembra su fila de `acceso`: NADIE puede dar permiso sobre esa pantalla " +
          "y el guardia la niega a todo el mundo, administrador incluido (RF-122). " +
          `Remedio: anadirla a identidad/${DIRECTORIO_DEL_CATALOGO_UNIDO}/${sistema}.json`,
      });
    }
  }

  for (const [clave, opcion] of enElArchivo) {
    if (!enElClon.has(clave)) {
      desajustes.push({
        sistema,
        lado: "archivo",
        opcion,
        porque:
          `el catalogo unido de «identidad» trae esta opcion y «${sistema}» no la sirve: se ` +
          "siembra una fila de `acceso` sobre la que se pueden otorgar permisos que no " +
          "habilitan nada. Remedio: quitarla de " +
          `identidad/${DIRECTORIO_DEL_CATALOGO_UNIDO}/${sistema}.json, o traer la pantalla`,
      });
    }
  }

  return desajustes;
}

/** Los desajustes de los cinco, con la lista derivada y no escrita. */
export function desajustes(): Desajuste[] {
  return SISTEMAS_DEL_PRODUCTO.flatMap((sistema) => desajustesDe(sistema));
}

/** Cuantas opciones sirve cada sistema, para el censo que fija las cifras de hoy. */
export function censoDeOpciones(): Record<string, number> {
  return Object.fromEntries(
    SISTEMAS_DEL_PRODUCTO.map((sistema) => [sistema, opcionesDelClon(sistema).length]),
  );
}

/** Como sale un desajuste en el rojo: sistema, lado, opcion y lo que cuesta. */
export function comoSeLeeElDesajuste(desajuste: Desajuste): string {
  return (
    `[${desajuste.sistema}] ${comoSeLee(desajuste.opcion)} — ` +
    `solo en ${desajuste.lado === "clon" ? "el clon de " + desajuste.sistema : "identidad"}. ` +
    desajuste.porque
  );
}
