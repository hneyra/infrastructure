import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { raizDelRepositorio } from "../componentes/fuentes";
import { clonDe, SISTEMAS } from "./deriva-de-migraciones";

/**
 * El nombre del monolito no vuelve al CODIGO, y en la prosa se queda a proposito.
 *
 * El producto es Kamayuk. El sistema del que sale se llamaba `sgtm`, y ese nombre salio del
 * codigo de los seis repositorios: del realm de Keycloak, de los `type` de los cuerpos de error,
 * de los identificadores internos, de los fixtures y de dos nombres de clase.
 *
 * ## Por que esta guarda barre CODIGO y no prosa
 *
 * En los comentarios, en `docs/` y en el registro de «Verificar antes de afirmar» el nombre
 * **sigue**, y es deliberado: una fila que dice «copiado de `sgtm@33f329a2`» es la medicion que
 * se hizo —reescribirla la falsifica—, y un comentario que dice «hasta `E` la sonda apuntaba a
 * `sgtm`» es el motivo por el que el codigo de al lado es como es. Una guarda que prohibiera la
 * cadena en todas partes obligaria a borrar la memoria del proyecto, asi que **esta omite los
 * comentarios y no mira `docs/` ni `*.md`**.
 *
 * ## Por que en un solo sitio, y aqui
 *
 * Del lado Java no hay nada que vigilar hoy: medido, `backend/<modulo>/src/main` de los cinco solo
 * nombra el monolito en **comentarios** —las cabeceras de los `V1__baseline.sql`, que explican
 * que no se copio ninguna migracion— y en dos `COMMENT ON COLUMN`, que son documentacion. Anadir
 * una prohibicion a `comun-verificaciones` exigiria su clase de muestra y tocaria los seis
 * builds para vigilar el conjunto vacio. Este repositorio ya barre los cinco clones en varias
 * guardas (`bases-de-los-guiones`, `deriva-de-migraciones`, `compose-de-los-sistemas`), asi que
 * cubre los seis desde un sitio.
 */
const PROHIBIDA = /sgtm/i;

/** Lo que cada repositorio considera codigo de produccion, mas sus descriptores. */
const RUTAS_DEL_SISTEMA = ["backend", "despliegue", "infrastructure/src"];
const RUTAS_DE_AQUI = ["infra", "despliegue", "librerias-backend"];

/** Ni `docs/`, ni pruebas, ni muestras, ni nada generado. */
const APARTADAS = [
  "node_modules",
  ".git",
  "build",
  ".gradle",
  ".claude",
  "dist",
  "docs",
  "muestras",
  "src/test",
  "src/testFixtures",
];

/**
 * Las excepciones, cada una con su motivo. **Son el nombre de cosas que existen.**
 *
 * Renombrar un contenedor en el codigo sin renombrarlo en el proveedor manda los datos a un
 * sitio que no existe, y **eso no da error hasta el dia que hace falta lo que hay dentro**.
 * Entran cuando alguien renombre el contenedor de verdad — que es lo que paso con los dos de
 * respaldo en #112, y por eso aquella salio.
 *
 * Y las dos que hay son de la misma clase: **texto que un humano lee, no una cadena que el
 * programa usa para hablar con nada**. Una es un comentario de SQL que Flyway ya sello; la otra
 * es la orden que el guion te dice que teclees.
 */
const EXCEPCIONES: readonly {
  readonly patron: RegExp;
  /** Donde vale. Una excepcion sin ambito exime en cualquier archivo, y eso exime de mas. */
  readonly archivo: RegExp;
  readonly motivo: string;
}[] = [
  {
    patron: /^COMMENT ON COLUMN /,
    archivo: /src\/main\/resources\/db\/migration\/V1__baseline\.sql$/,
    motivo:
      "un `COMMENT ON COLUMN` dentro de un `V1__baseline.sql` YA APLICADO. Flyway valida la suma " +
      "de comprobacion de cada migracion, asi que editar una que ya corrio hace fallar el " +
      "arranque de toda base existente con «checksum mismatch». No es que no se quiera cambiar: " +
      "no se puede. Se corrige, si alguna vez importa, con una migracion NUEVA que reemplace el " +
      "comentario",
  },
  {
    patron: /^\d+\. scripts\/valores-normativos\/archivar_derivado\.sh --bucket sgtm-fuentes-normativas\b/,
    archivo: /^infra\/carga-de-datos\/publicar-cuadros\.sh$/,
    motivo:
      "el nombre REAL de un contenedor de S3 que existe asi, dentro del texto de ayuda que el " +
      "guion imprime por stderr cuando un cuadro no cabe en un ConfigMap. No es una orden que " +
      "este guion ejecute: es la que el operador tiene que teclear, y cambiarle el nombre lo " +
      "dejaria sin el dato por el que lee el mensaje. El contenedor no se renombra aqui — el dia " +
      "que se renombre de verdad, esta excepcion sale, igual que salieron los de respaldo en " +
      "#112. Aparecio al arreglar el despojado de bloques (#122): vivia en las 268 lineas que la " +
      "guarda no miraba, y NO es un comentario —esta dentro de un heredoc—, asi que el " +
      "despojador de `#` no la cubre",
  },
];

const EXTENSIONES = new Set([
  ".ts",
  ".java",
  ".kts",
  ".kt",
  ".sh",
  ".sql",
  ".yml",
  ".yaml",
  ".mjs",
  ".js",
  ".json",
  ".svelte",
  ".css",
  ".html",
]);

/**
 * De esas, las que su lenguaje admite comentarios de BLOQUE —los que abren con `/*`—.
 *
 * **Es una lista por lo que cada lenguaje admite de verdad, no por descarte** (#122). Bash no
 * los tiene —`/*)` es una rama de `case` perfectamente normal—, YAML tampoco, y JSON no tiene
 * comentarios de ninguna clase. SQL SI los tiene, y PostgreSQL ademas los anida, asi que se
 * queda: medido, CERO `.sql` de los seis arboles contiene siquiera un `/*`, de modo que la
 * decision la toma el lenguaje y no la conveniencia.
 *
 * De que defecto viene, para que nadie lo «simplifique» de vuelta: el despojado se aplicaba a
 * TODA extension, asi que el `case "$relativa" in ../*)` de `publicar-cuadros.sh:240` abria un
 * bloque falso que no cerraba hasta el cierre que un `sed` lleva dentro, 268 lineas mas abajo
 * —el 44 % del archivo—, y ahi dentro estaban las dos etiquetas `proyecto: sgtm` de su `Job`.
 * Es el mismo defecto que #76 cerro para los otros dos `Job` de carga, y este sobrevivio
 * porque la guarda que #76 introdujo no podia verlo. Medido sobre los seis arboles, CUATRO
 * archivos perdian tramos: 268, 260, 157 y 102 lineas.
 *
 * Las reglas de comentario de LINEA de abajo no se tocaron con esto, y tambien esta medido por
 * que: `.css`, `.html` y `.svelte` no tienen ni un archivo bajo las rutas que se barren, y de
 * los cuatro `.json` que contienen `/*` —los dos `tsconfig` y los dos realms— ninguno se traga
 * nada, porque ningun realm llega a cerrar el bloque y los `tsconfig` lo cierran dentro de su
 * propio glob.
 */
const CON_BLOQUES = new Set([
  ".ts",
  ".java",
  ".kts",
  ".kt",
  ".sql",
  ".mjs",
  ".js",
  ".svelte",
  ".css",
  ".html",
]);

function archivosDe(raiz: string, rutas: readonly string[]): string[] {
  const salida: string[] = [];
  const recorrer = (dir: string): void => {
    let entradas: string[];
    try {
      entradas = readdirSync(dir);
    } catch {
      return;
    }
    for (const entrada of entradas) {
      const completa = join(dir, entrada);
      if (APARTADAS.some((a) => completa.includes(`/${a}/`) || completa.endsWith(`/${a}`))) continue;
      // Las pruebas no son codigo de produccion, y sus mensajes narran de donde viene cada
      // defecto: es prosa, y por eso se apartan igual que `src/test` en los cinco.
      if (entrada.endsWith(".test.ts") || entrada.endsWith(".spec.ts")) continue;
      let esDirectorio = false;
      try {
        esDirectorio = statSync(completa).isDirectory();
      } catch {
        continue;
      }
      if (esDirectorio) recorrer(completa);
      else if (EXTENSIONES.has(extname(entrada)) || entrada === "Dockerfile") salida.push(completa);
    }
  };
  for (const ruta of rutas) recorrer(join(raiz, ruta));
  return salida;
}

/** Deja solo lo que NO es comentario. Sin esto la guarda obligaria a borrar la memoria. */
export function sinComentarios(texto: string, extension: string): string {
  // Solo donde el lenguaje los tiene: ver `CON_BLOQUES`. Aplicarlo a todas las extensiones es
  // lo que dejaba 787 lineas de codigo de produccion sin mirar en cuatro guiones (#122).
  const sinBloques = CON_BLOQUES.has(extension)
    ? texto.replace(/\/\*[\s\S]*?\*\//g, " ")
    : texto;
  // El `//` de un comentario NO va precedido de dos puntos; el de una URL SI. Sin ese
  // limite, `https://…` se comia el resto de la linea y **un nombre dentro de cualquier URL
  // quedaba invisible**: medido devolviendo `https://sgtm.gob.pe/errores/` al Java de
  // produccion de `identidad`, que esta guarda dejo pasar en VERDE. Cubre tambien
  // `jdbc:postgresql://`, `ws://` y cualquier otro esquema.
  const deLinea =
    extension === ".sh" || extension === ".yml" || extension === ".yaml"
      ? /#.*$/
      : extension === ".sql"
        ? /--.*$/
        : /(?<!:)\/\/.*$/;
  return sinBloques
    .split("\n")
    .map((linea) => {
      const limpia = linea.replace(deLinea, "");
      // Una linea que EMPIEZA por `*` o por `//` es comentario en cualquiera de estos
      // lenguajes —incluidos los `.sh` que llevan TypeScript en un heredoc—. Solo al
      // principio: mitad de linea se dejaria un `http://host/algo` sin mirar.
      return /^\s*(\*|\/\/)/.test(limpia) ? "" : limpia;
    })
    .join("\n");
}

interface Hallazgo {
  readonly repositorio: string;
  readonly archivo: string;
  readonly linea: number;
  readonly texto: string;
}

function hallazgosDe(repositorio: string, raiz: string, rutas: readonly string[]): Hallazgo[] {
  const salida: Hallazgo[] = [];
  for (const completa of archivosDe(raiz, rutas)) {
    const extension = extname(completa) || (completa.endsWith("Dockerfile") ? ".sh" : "");
    const limpio = sinComentarios(readFileSync(completa, "utf8"), extension);
    limpio.split("\n").forEach((linea, i) => {
      if (!PROHIBIDA.test(linea)) return;
      const relativa = relative(raiz, completa);
      if (EXCEPCIONES.some((e) => e.archivo.test(relativa) && e.patron.test(linea.trim()))) return;
      salida.push({
        repositorio,
        archivo: relativa,
        linea: i + 1,
        texto: linea.trim().slice(0, 120),
      });
    });
  }
  return salida;
}

function todosLosArboles(): { repositorio: string; raiz: string; rutas: readonly string[] }[] {
  return [
    { repositorio: "infrastructure", raiz: raizDelRepositorio(), rutas: RUTAS_DE_AQUI },
    ...SISTEMAS.map((sistema) => ({
      repositorio: sistema.clon,
      raiz: clonDe(sistema),
      rutas: RUTAS_DEL_SISTEMA,
    })),
  ];
}

/**
 * Estas pruebas son de ENTRADA/SALIDA: recorren los seis arboles leyendo cada archivo de codigo
 * de produccion, y tardan **~2,1 s** con la maquina ociosa. El tope por prueba **no** es el de
 * vitest por omision: lo sube `vitest.config.ts`, y alli esta escrito por que —estas cruzaban
 * los 5 s por omision con algo pesado al lado y salian rojas por tiempo agotado, no por su
 * asercion—.
 */
describe("el nombre del monolito no vuelve al codigo de los seis", () => {
  it("EL CENTINELA: se leen archivos de los seis arboles", () => {
    // Sin esto lo de abajo pasaria sobre la lista vacia, que es como una guarda se queda sin
    // sujeto y sigue en verde. Es el mismo centinela que #27 pide en las otras.
    for (const { repositorio, raiz, rutas } of todosLosArboles()) {
      expect(
        archivosDe(raiz, rutas).length,
        `no se leyo ni un archivo de «${repositorio}»: la guarda no mide nada`,
      ).toBeGreaterThan(20);
    }
  });

  it("los comentarios se omiten, y se demuestra", () => {
    // Si esto dejara de funcionar, la guarda empezaria a exigir que se borre la memoria del
    // proyecto: las cabeceras de los `V1__baseline.sql` explican que no se copio ninguna
    // migracion del monolito, y esa explicacion tiene que poder nombrarlo.
    expect(sinComentarios("// viene de sgtm\nconst a = 1;", ".ts")).not.toMatch(PROHIBIDA);
    expect(sinComentarios(" * copiado de sgtm@abc\n", ".java")).not.toMatch(PROHIBIDA);
    expect(sinComentarios("-- la historia se queda en sgtm\nSELECT 1;", ".sql")).not.toMatch(
      PROHIBIDA,
    );
    expect(sinComentarios("# apuntaba a sgtm\nBASE=rentas\n", ".sh")).not.toMatch(PROHIBIDA);
    // Y NO se traga el codigo: una linea de verdad se sigue viendo.
    expect(sinComentarios('const base = "sgtm";', ".ts")).toMatch(PROHIBIDA);
    // NI una URL, que es el agujero con el que esta guarda nacio: `https://` lleva `//` y el
    // filtro se comia el resto de la linea, asi que un nombre dentro de cualquier URL pasaba
    // en verde. Medido con el `type` de los cuerpos de error, que es exactamente ese caso.
    expect(sinComentarios('setType("https://sgtm.gob.pe/errores/x");', ".java")).toMatch(
      PROHIBIDA,
    );
  });

  it("un `/*` en un lenguaje que no tiene bloques no esconde nada detras", () => {
    // #122. `/*)` es una rama de `case` de bash, no el principio de un comentario, y el
    // despojado se aplicaba a TODAS las extensiones: abria un bloque falso que se comia el
    // archivo hasta el siguiente `*/` —que en `publicar-cuadros.sh` estaba 268 lineas mas
    // abajo, dentro de un `sed`—. La forma de abajo es la de ese archivo, reducida.
    const bash = 'case "$x" in\n  ../*) destino=1 ;;\nesac\nBASE=sgtm\nRESUMEN=$(sed -n "s/.*\\(X\\)./\\1/p")\n';
    expect(sinComentarios(bash, ".sh")).toMatch(PROHIBIDA);
    // Y no es solo que la cadena aparezca: NO se pierde ni una linea por el camino.
    expect(sinComentarios(bash, ".sh").split("\n")).toHaveLength(bash.split("\n").length);
    // Lo mismo para las otras dos extensiones que tampoco los tienen.
    expect(sinComentarios("rutas:\n  - /*\nbase: sgtm\nfin: '*/'\n", ".yaml")).toMatch(PROHIBIDA);
    expect(sinComentarios('{"a": "/*", "b": "sgtm", "c": "*/"}', ".json")).toMatch(PROHIBIDA);
  });

  it("y en los lenguajes que SI los tienen se sigue despojando", () => {
    // El contraste de #122, para no pasarse: el arreglo tenia que hacer ver MAS, no dejar de
    // omitir comentarios de verdad. Si esto se cayera, volveria a exigirse borrar la memoria.
    expect(sinComentarios("/* viene de sgtm */\nconst a = 1;", ".ts")).not.toMatch(PROHIBIDA);
    expect(sinComentarios("/*\n * copiado de sgtm@abc\n */\nclass A {}", ".java")).not.toMatch(
      PROHIBIDA,
    );
    // SQL los tiene —PostgreSQL incluso los anida—, y por eso `.sql` NO entro en la lista de
    // exclusion que pedia el issue: la decision la toma el lenguaje, no el descarte.
    expect(sinComentarios("/* la historia se queda en sgtm */\nSELECT 1;", ".sql")).not.toMatch(
      PROHIBIDA,
    );
  });

  it("toda excepcion declarada nombra algo que existe", () => {
    // La direccion de #27: una excepcion que no exime a nadie hace decir de mas a la guarda, y
    // el dia que aparezca algo con ese nombre pasara sin que nadie lo haya decidido.
    //
    // Las lineas se leen CON los comentarios en blanco, igual que el barrido de arriba, y eso
    // es de #112. Antes se leian en crudo, y esta prueba media otra cosa de la que dice: una
    // excepcion se quedaba «viva» porque su nombre seguia apareciendo en un COMENTARIO, que es
    // justo lo que el barrido no mira. Medido al retirar la de los buckets de respaldo: con la
    // excepcion ya obsoleta —ninguna linea de codigo la ejercia— estas nueve pruebas pasaban en
    // VERDE, sostenidas por tres comentarios que explican como se llamaba el bucket anterior.
    // Una guarda que se cumple con la prosa que la justifica es la que nadie repone el dia que
    // alguien borra el comentario.
    const lineas = todosLosArboles().flatMap(({ raiz, rutas }) =>
      archivosDe(raiz, rutas).flatMap((f) =>
        sinComentarios(readFileSync(f, "utf8"), extname(f))
          .split("\n")
          .map((linea) => ({ archivo: relative(raiz, f), linea: linea.trim() })),
      ),
    );
    for (const excepcion of EXCEPCIONES) {
      expect(
        lineas.some((l) => excepcion.archivo.test(l.archivo) && excepcion.patron.test(l.linea)),
        `la excepcion «${excepcion.patron}» en «${excepcion.archivo}» no aparece en ningun arbol: ` +
          "sobra, y mientras este aqui exime a algo que nadie ha decidido eximir",
      ).toBe(true);
    }
  });

  it.each(todosLosArboles().map((a) => a.repositorio))("«%s» no lo nombra en su codigo", (cual) => {
    const arbol = todosLosArboles().find((a) => a.repositorio === cual)!;
    const hallazgos = hallazgosDe(arbol.repositorio, arbol.raiz, arbol.rutas);
    expect(
      hallazgos.map((h) => `${h.archivo}:${h.linea}: ${h.texto}`),
      `«${cual}» vuelve a nombrar el monolito en codigo de produccion. En la prosa se queda a ` +
        "proposito —es la memoria del proyecto—, pero en el codigo no: cada aparicion es un " +
        "nombre que alguien tendra que volver a cambiar. Las excepciones declaradas son: " +
        EXCEPCIONES.map((e) => `${e.patron} (${e.motivo})`).join("; "),
    ).toEqual([]);
  });
});
