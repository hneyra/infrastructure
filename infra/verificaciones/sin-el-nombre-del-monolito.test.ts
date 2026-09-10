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
 * Renombrar un bucket en el codigo sin renombrarlo en el proveedor manda los respaldos a un
 * sitio que no existe, y **eso no da error hasta el dia que hay que restaurar**. Entran cuando
 * alguien renombre el bucket de verdad.
 */
const EXCEPCIONES: readonly {
  readonly patron: RegExp;
  /** Donde vale. Una excepcion sin ambito exime en cualquier archivo, y eso exime de mas. */
  readonly archivo: RegExp;
  readonly motivo: string;
}[] = [
  {
    patron: /sgtm-(stg|prod)-respaldos/,
    archivo: /^infra\/(Pulumi\.(stg|prod)\.yaml|config\.ts)$/,
    motivo: "el bucket de respaldos de cada ambiente, que existe con ese nombre en el proveedor",
  },
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
  const sinBloques = texto.replace(/\/\*[\s\S]*?\*\//g, " ");
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

  it("toda excepcion declarada nombra algo que existe", () => {
    // La direccion de #27: una excepcion que no exime a nadie hace decir de mas a la guarda, y
    // el dia que aparezca algo con ese nombre pasara sin que nadie lo haya decidido.
    const lineas = todosLosArboles().flatMap(({ raiz, rutas }) =>
      archivosDe(raiz, rutas).flatMap((f) =>
        readFileSync(f, "utf8")
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
