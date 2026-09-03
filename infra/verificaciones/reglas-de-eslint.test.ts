import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/**
 * Las reglas de `eslint.config.mjs` muerden.
 *
 * Cada prohibicion tiene su muestra que la viola y esta prueba exige que ESLint la
 * detecte. **Una regla que no puede fallar no protege nada** — el mismo argumento por
 * el que la prueba de aislamiento demuestra que el superusuario omite RLS en vez de
 * afirmarlo.
 *
 * Las muestras estan en `ignores` de la configuracion para que `yarn lint` no las
 * senale; aqui se lintan como texto, con una ruta sintetica dentro de `componentes/`,
 * que es donde la regla tiene que aplicar de verdad.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, "..");

/** Ruta sintetica: la muestra se juzga como si viviera en un componente. */
const rutaEnUnComponente = (nombre: string) => join(RAIZ, "componentes", nombre);

const eslint = new ESLint({ cwd: RAIZ });

async function mensajesDe(muestra: string, ruta: string): Promise<string[]> {
  const codigo = readFileSync(join(AQUI, "muestras", muestra), "utf8");
  const [resultado] = await eslint.lintText(codigo, { filePath: ruta });
  return (resultado?.messages ?? []).map((m) => `${m.ruleId ?? "?"}: ${m.message}`);
}

/** Cada prohibicion, su muestra y el texto que la delata. */
const PROHIBICIONES: { prohibicion: string; muestra: string; delata: RegExp }[] = [
  {
    prohibicion: "configuracion leida fuera de config.ts",
    muestra: "configuracion-en-un-componente.ts",
    delata: /La configuracion se lee en config.ts/,
  },
  {
    prohibicion: "process.env suelto",
    muestra: "variable-de-entorno-suelta.ts",
    delata: /Nada de process.env suelto/,
  },
  {
    prohibicion: "etiqueta de imagen movil",
    muestra: "etiqueta-movil.ts",
    delata: /Etiqueta de imagen movil/,
  },
  {
    prohibicion: "identificador con tilde",
    muestra: "identificador-con-tilde.ts",
    delata: /Sin tildes ni enie en identificadores/,
  },
  {
    prohibicion: "any explicito",
    muestra: "any-explicito.ts",
    delata: /no-explicit-any/,
  },
];

describe("cada prohibicion tiene una muestra que la viola, y ESLint la detecta", () => {
  it.each(PROHIBICIONES)("$prohibicion", async ({ muestra, delata }) => {
    const mensajes = await mensajesDe(muestra, rutaEnUnComponente(muestra));
    expect(
      mensajes.some((m) => delata.test(m)),
      `Se esperaba un mensaje que casara con ${delata}. Se obtuvo:\n${
        mensajes.length === 0 ? "  (ninguno)" : mensajes.map((m) => `  · ${m}`).join("\n")
      }`,
    ).toBe(true);
  });
});

describe("la excepcion de config.ts es exactamente una", () => {
  it("config.ts si puede leer configuracion", async () => {
    const mensajes = await mensajesDe(
      "configuracion-en-un-componente.ts",
      join(RAIZ, "config.ts"),
    );
    expect(mensajes.filter((m) => /La configuracion se lee en config.ts/.test(m))).toEqual([]);
  });

  it("pero ni siquiera config.ts puede fijar una etiqueta movil", async () => {
    const mensajes = await mensajesDe("etiqueta-movil.ts", join(RAIZ, "config.ts"));
    expect(mensajes.some((m) => /Etiqueta de imagen movil/.test(m))).toBe(true);
  });
});
