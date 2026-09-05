import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { construirManifiestos } from "../componentes";
import { ENVIRONMENTS, type Environment } from "../config";
import { manifiestosDelAmbiente } from "../herramientas/emitir-manifiestos";
import { invariantesDe } from "./stacks";

/**
 * Lo que Pulumi despliega es TODO el ambiente, no solo la plataforma.
 *
 * El 2026-09-05, `index.ts` armaba sus manifiestos con `construirManifiestos()` a secas —solo la
 * plataforma— mientras `yarn manifiestos` emitia los cinco espacios de nombres y la guarda de
 * capacidad sumaba los cinco. Tres lecturas del mismo ambiente, dos que contaban bien y **la que
 * despliega contando otra cosa**.
 *
 * El sintoma no se parecio nunca a su causa: el `up` salia diciendo «70 sin cambio», los cuatro
 * namespaces quedaban creados y con sus secretos, y **sin un solo `Deployment`**. Se descubrio
 * preguntandole al estado (`pulumi stack export`: 71 recursos, **ninguno** de los cuatro), no
 * leyendo el codigo. Y es el mismo defecto que C-16 arreglo en `capacidad.ts`: la funcion se
 * extrajo en C-14 «para que `capacidad.ts` pueda sumarlos», se engancho ahi, y el llamador que
 * de verdad importa se quedo sin cambiar.
 *
 * Esta guarda ata las dos mitades. No compara textos: compara **conjuntos de objetos**, que es
 * lo que un `up` crea.
 */

const IDENTIDAD = (m: { kind: string; metadata: { name: string; namespace?: string } }): string =>
  `${m.kind} ${m.metadata.namespace ?? "(cluster)"}/${m.metadata.name}`;

describe("lo que Pulumi aplica es todo el ambiente", () => {
  it.each(ENVIRONMENTS)(
    "«%s»: el ambiente trae MAS objetos que la plataforma sola",
    (ambiente: Environment) => {
      const inv = invariantesDe(ambiente);
      const soloPlataforma = construirManifiestos(inv).map(IDENTIDAD);
      const todo = manifiestosDelAmbiente(inv).map(IDENTIDAD);
      // Si esto deja de ser cierto es que los cuatro sistemas dejaron de aportar objetos, y
      // entonces la comprobacion de abajo pasaria en verde sin proteger nada.
      expect(todo.length).toBeGreaterThan(soloPlataforma.length);
      expect(new Set(todo)).toEqual(new Set([...soloPlataforma, ...todo.filter((o) => !soloPlataforma.includes(o))]));
    },
  );

  it.each(ENVIRONMENTS)("«%s»: cada sistema aporta objetos propios", (ambiente: Environment) => {
    const todo = manifiestosDelAmbiente(invariantesDe(ambiente)).map(IDENTIDAD);
    for (const sistema of ["rentas", "catastro", "normativa", "caja"]) {
      const suyos = todo.filter((o) => o.includes(`kamayuk-${sistema}-${ambiente}`));
      expect(
        suyos.length,
        `«${sistema}» no aporta ni un objeto al ambiente «${ambiente}». Si `
          + "`index.ts` arma sus manifiestos con `construirManifiestos()` a secas, el `up` "
          + "crea sus namespaces y sus secretos y ni un `Deployment`, sin decir nada.",
      ).toBeGreaterThan(0);
    }
  });

  it("`index.ts` compone con `manifiestosDelAmbiente`, no con `construirManifiestos`", () => {
    // Se lee el fuente porque el defecto vivia EN ESA LINEA y ninguna prueba de comportamiento
    // lo alcanzaba: `index.ts` es el programa de Pulumi y no se puede importar sin desplegar.
    const fuente = readFileSync(join(__dirname, "..", "index.ts"), "utf8");
    const linea = fuente
      .split("\n")
      .find((l) => l.includes("const manifiestos =") && !l.trim().startsWith("//"));
    expect(linea, "no se encontro la linea que arma los manifiestos en index.ts").toBeDefined();
    expect(
      linea,
      "`index.ts` tiene que armar sus manifiestos con `manifiestosDelAmbiente()`: con "
        + "`construirManifiestos()` despliega SOLO la plataforma y los cuatro sistemas no llegan "
        + "nunca al cluster.",
    ).toContain("manifiestosDelAmbiente");
  });
});
