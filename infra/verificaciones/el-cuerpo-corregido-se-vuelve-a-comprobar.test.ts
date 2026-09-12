/**
 * La guarda del registro puede ponerse roja por el CUERPO del PR, y su remedio correcto
 * —corregir ese cuerpo— no se podia comprobar (#57).
 *
 * `verificar-fila-del-registro.mjs` decide si exige la fila con un patron que casa
 * tambien con prosa:
 *
 * ```js
 * const CIERRA = /\b(?:cierra|closes?|close|fixes?|fix|resuelve|resolves?)\s+#(\d+)/gi;
 * ```
 *
 * Asi que una frase como «esta roja **la cierra #54** midiendolo» —hablando de un PR y
 * no de un issue— le hace exigir una fila que nadie tenia que escribir. **Paso de
 * verdad** en #55 el 2026-09-10.
 *
 * Y el remedio es editar el cuerpo, que sin `edited` entre los tipos **no dispara nada**.
 * Relanzar el trabajo tampoco vale, y eso hubo que medirlo: un re-run repite el **mismo
 * evento** con el payload congelado, asi que `github.event.pull_request.body` sigue
 * siendo el cuerpo viejo —se comprobo en el registro del trabajo relanzado, que imprimia
 * un epigrafe que la edicion habia retirado minutos antes—. Las unicas salidas eran
 * empujar un commit —cambiar codigo para arreglar una frase— o cerrar y reabrir el PR,
 * que este proyecto prohibe. En el caso real se resolvio **de rebote**: al mezclarse su
 * base hubo un `synchronize` que trajo el cuerpo corregido.
 *
 * ## Por que barre los SEIS y no solo este
 *
 * El mismo `registro.yml` vive en los seis repositorios y los seis leian el cuerpo del
 * PR sin `edited`. Arreglar solo este dejaria cinco trampas identicas en pie, y la que
 * las descubriria seria la siguiente persona a la que le pase.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { raizDelRepositorio } from "../componentes/fuentes";
import { SISTEMAS, clonDe } from "./deriva-de-migraciones";

const POR_OMISION = ["opened", "synchronize", "reopened"] as const;

/** Los seis `registro.yml`: el de aqui y el de cada clon hermano. */
function losSeisFlujos(): { repo: string; texto: string }[] {
  const raices = [
    { repo: "infrastructure", raiz: raizDelRepositorio() },
    ...SISTEMAS.map((s) => ({ repo: s.nombre, raiz: clonDe(s) })),
  ];
  return raices.map(({ repo, raiz }) => ({
    repo,
    texto: readFileSync(join(raiz, ".github/workflows/registro.yml"), "utf8"),
  }));
}

/** Los tipos que ese flujo declara para `pull_request`. */
function tiposDe(texto: string): string[] {
  const doc = load(texto) as Record<string, unknown>;
  // En YAML, `on:` sin comillas se analiza como el booleano `true`.
  const disparadores = (doc[String(true)] ?? doc["on"]) as {
    pull_request?: { types?: string[] };
  };
  return disparadores.pull_request?.types ?? [];
}

describe("#57 · un cuerpo de PR corregido se vuelve a comprobar", () => {
  it("EL CENTINELA: se leyeron los seis flujos", () => {
    // Si un clon falta o el archivo se renombra, las demas pruebas recorrerian una lista
    // mas corta y pasarian en verde habiendo mirado menos. Esto lo impide.
    const flujos = losSeisFlujos();
    expect(
      flujos.map((f) => f.repo).sort(),
      "no se leyeron los seis `registro.yml`: este barrido estaria midiendo menos de lo " +
        "que dice.",
    ).toEqual(["caja", "catastro", "identidad", "infrastructure", "normativa", "rentas"]);
  });

  for (const { repo, texto } of losSeisFlujos()) {
    it(`«${repo}» escucha \`edited\`, o su propio remedio no se puede comprobar`, () => {
      expect(
        tiposDe(texto),
        `«${repo}» no declara \`edited\` entre los tipos de \`pull_request\`. Esta guarda ` +
          "puede ponerse roja por una frase del cuerpo, y corregir esa frase NO dispararia " +
          "nada: un re-run repite el mismo evento con el payload congelado, asi que el " +
          "cuerpo viejo vuelve tal cual. Quedarian dos salidas, y las dos malas: empujar un " +
          "commit para arreglar una frase, o cerrar y reabrir el PR.",
      ).toContain("edited");
    });

    it(`«${repo}» conserva los tres tipos por omision, que declarar \`types:\` borra`, () => {
      for (const tipo of POR_OMISION) {
        expect(
          tiposDe(texto),
          `«${repo}» declara \`types:\` y ha perdido \`${tipo}\`. Declarar \`types:\` ` +
            "REEMPLAZA la lista entera, no la amplia: `types: [edited]` a secas dejaria de " +
            "correr al ABRIR el PR, que es cuando esta guarda mas falta hace, y el hueco " +
            "seria invisible — un check que no corre no sale rojo, no sale.",
        ).toContain(tipo);
      }
    });

    it(`«${repo}» dice POR QUE estan esos tipos, para que nadie los quite por limpieza`, () => {
      const cabecera = texto.slice(0, texto.indexOf("types:"));
      expect(
        cabecera,
        `«${repo}» declara los tipos sin explicar que un re-run repite el payload ` +
          "congelado. Sin ese motivo escrito al lado, la lista parece redundante —son los " +
          "tres por omision mas uno— y el siguiente que la vea la va a quitar.",
      ).toMatch(/re-run|relanzar/i);
    });
  }
});
