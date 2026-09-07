import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BASE_DE_IDENTIDAD,
  BASE_DE_MANTENIMIENTO,
  BASE_DEL_REGISTRO_DE_RESPALDO,
  SISTEMAS_DEL_PRODUCTO,
} from "../componentes/convenciones";
import { raizDeInfra, raizDelRepositorio } from "../componentes/fuentes";

/**
 * `#15` y `#16` — que base usa cada guion, y que no haya dos verdades.
 *
 * `E` retiro el monolito y con el la base `sgtm`. Las dos mitades del agujero que dejo:
 *
 *   - **#15**: su sustituta quedo escrita CINCO veces —cuatro guiones y `convenciones.ts`— y
 *     nada las comparaba. Olvidar una al cambiarla no ponia nada rojo;
 *   - **#16**: nada impedia que un guion hablara con una base que ya no existe. Hicieron falta
 *     **cuatro corridas de CI** para agotar las 26 referencias a `sgtm` que quedaban, y las
 *     cuatro dijeron cosas distintas de la misma causa.
 *
 * Ninguna de las dos la puede ver `yarn verificar` mirando TypeScript: viven en los guiones,
 * que solo se ejecutan con Docker y un cluster. Estas guardas los LEEN, sin ninguna de las dos
 * cosas.
 */
const CENSO = join(raizDeInfra(), "bases.sh");

interface CensoDelShell {
  padron: string;
  mantenimiento: string;
  identidad: string;
  sistemas: string;
}

/** Lo que `infra/bases.sh` declara, EJECUTADO. */
function censoDelShell(): CensoDelShell {
  const salida = execFileSync(
    "sh",
    [
      "-c",
      `. "${CENSO}"; ` +
        'echo "$BASE_DEL_PADRON"; echo "$BASE_DE_MANTENIMIENTO"; ' +
        'echo "$BASE_DE_IDENTIDAD"; echo "$BASES_DE_LOS_SISTEMAS"',
    ],
    { encoding: "utf8" },
  ).split("\n");
  return {
    padron: salida[0] ?? "",
    mantenimiento: salida[1] ?? "",
    identidad: salida[2] ?? "",
    sistemas: salida[3] ?? "",
  };
}

/** Todo `*.sh` de `infra/` y `despliegue/`, con su ruta relativa. */
function guiones(): { ruta: string; texto: string }[] {
  const encontrados: { ruta: string; texto: string }[] = [];
  const recorrer = (dir: string): void => {
    for (const entrada of readdirSync(dir)) {
      if (entrada === "node_modules" || entrada === ".git") continue;
      const completa = join(dir, entrada);
      if (statSync(completa).isDirectory()) recorrer(completa);
      else if (entrada.endsWith(".sh")) {
        encontrados.push({
          ruta: relative(raizDelRepositorio(), completa),
          texto: readFileSync(completa, "utf8"),
        });
      }
    }
  };
  recorrer(raizDeInfra());
  recorrer(join(raizDelRepositorio(), "despliegue"));
  return encontrados;
}

/** Las lineas de codigo: los comentarios explican defectos viejos escribiendolos. */
const sinComentarios = (texto: string): string[] =>
  texto.split("\n").filter((l) => !l.trim().startsWith("#"));

describe("#15 · el censo de bases vive en UN sitio, y dice lo mismo que TypeScript", () => {
  it("`infra/bases.sh` y `convenciones.ts` coinciden, ejecutando el primero", () => {
    const shell = censoDelShell();
    expect(shell.padron, "`BASE_DEL_PADRON` no cuadra con `BASE_DEL_REGISTRO_DE_RESPALDO`").toBe(
      BASE_DEL_REGISTRO_DE_RESPALDO,
    );
    expect(shell.mantenimiento).toBe(BASE_DE_MANTENIMIENTO);
    expect(shell.identidad).toBe(BASE_DE_IDENTIDAD);
    expect(shell.sistemas.split(/\s+/).sort()).toEqual([...SISTEMAS_DEL_PRODUCTO].sort());
  });

  /**
   * Y **ningun otro guion las declara**, que es la mitad que cierra #15: sin esto, la prueba de
   * arriba pasaria en verde con cuatro copias divergentes al lado, porque solo mira una.
   */
  it("ningun otro `*.sh` declara una base del censo", () => {
    const nombres = [
      "BASE_DEL_PADRON",
      "BASE_DE_MANTENIMIENTO",
      "BASE_DE_IDENTIDAD",
      "BASES_DE_LOS_SISTEMAS",
    ];
    const culpables: string[] = [];
    for (const { ruta, texto } of guiones()) {
      if (ruta.endsWith("infra/bases.sh")) continue;
      for (const linea of sinComentarios(texto)) {
        for (const nombre of nombres) {
          if (new RegExp(`^\\s*${nombre}=`).test(linea)) culpables.push(`${ruta}: ${linea.trim()}`);
        }
      }
    }
    expect(
      culpables,
      `estas lineas declaran una base que ya vive en \`infra/bases.sh\`:\n  ${culpables.join(
        "\n  ",
      )}\n  Dos verdades y nada que las compare: cambiar la eleccion obliga a acordarse de ` +
        "todas, y olvidar una no pone nada rojo.",
    ).toEqual([]);
  });
});

describe("#16 · ningun guion habla con una base que no existe", () => {
  /**
   * El censo de lo que un guion puede nombrar como base: las cuatro del producto, la de
   * mantenimiento y la de Keycloak. **Se deriva**, no se escribe: el dia que entre un sistema
   * nuevo, entra aqui solo.
   */
  const permitidas = new Set<string>([
    ...SISTEMAS_DEL_PRODUCTO,
    BASE_DE_MANTENIMIENTO,
    BASE_DE_IDENTIDAD,
  ]);

  it("toda base LITERAL que un guion nombra esta en el censo", () => {
    // `--dbname=X`, `--dbname X`, `-d X` y `PGDATABASE=X`, solo cuando X es un literal: una
    // variable —`"$BASE_DEL_PADRON"`— la cubre la prueba de #15, que compara su valor.
    const patrones = [
      /--dbname[= ]"?([A-Za-z_][A-Za-z0-9_]*)"?/g,
      /\bPGDATABASE=([A-Za-z_][A-Za-z0-9_]*)/g,
      /\s-d\s+([A-Za-z_][A-Za-z0-9_]*)/g,
    ];
    const fuera: string[] = [];
    for (const { ruta, texto } of guiones()) {
      for (const linea of sinComentarios(texto)) {
        for (const patron of patrones) {
          for (const casa of linea.matchAll(patron)) {
            const base = casa[1] ?? "";
            if (!permitidas.has(base)) fuera.push(`${ruta}: ${linea.trim()}`);
          }
        }
      }
    }
    expect(
      [...new Set(fuera)],
      "estos guiones nombran una base que no esta en el censo. Si ya no existe, la sesion no " +
        "se abre y el guion muere donde nadie lo espera; si existe y no es la que toca, la " +
        `comprobacion pasa en verde sin medir nada. Censo: ${[...permitidas].join(", ")}.`,
    ).toEqual([]);
  });

  /**
   * Y **la omision del superusuario es el PADRON**, no un literal.
   *
   * Es la mutacion que el issue #16 exige y que un censo de literales NO cazaria: poner
   * `postgres` ahi deja una base que SI existe y esta permitida, y aun asi rompe las dos
   * pruebas que leen lo que acaban de escribir —`si_sobrevive` y `simulacro_deuda`—, porque
   * escriben en el padron. Costo dos de las cuatro corridas de CI.
   */
  it("`motor_como_superusuario` cae en `$BASE_DEL_PADRON`, y no en un literal", () => {
    const lib = readFileSync(
      join(raizDeInfra(), "verificaciones/motor/lib-motor-local.sh"),
      "utf8",
    );
    const omision = /--dbname="\$\{2:-([^}]*)\}"/.exec(lib);
    expect(omision, "`motor_como_superusuario` ya no declara una base por omision").not.toBeNull();
    expect(
      omision?.[1],
      "la base por omision tiene que ser `$BASE_DEL_PADRON`: 35 de sus 36 llamadas no pasan " +
        "base, y las que leen lo que acaban de escribir lo hacen en el padron. Un literal aqui " +
        "—aunque sea una base que existe— las manda a leer donde no escribieron.",
    ).toBe("$BASE_DEL_PADRON");
  });

  /** Y el contraste: el realm de Keycloak NO es una base, y no puede salir rojo. */
  it("`KC_REALM:-sgtm` no cuenta como base", () => {
    const identidades = guiones().find((g) =>
      g.ruta.endsWith("despliegue/identidad/reconciliar-identidades.sh"),
    );
    expect(identidades, "no esta `reconciliar-identidades.sh`").toBeDefined();
    expect(identidades?.texto, "ese guion ya no nombra el realm").toContain("KC_REALM");
  });
});
