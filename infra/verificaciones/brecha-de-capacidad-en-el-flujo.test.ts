import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { raizDeInfra, raizDelRepositorio } from "../componentes/fuentes";
import { invariantesDe } from "./stacks";

/**
 * `#25` — `aplicar-prod` no aplica mientras la brecha de capacidad este declarada, **y lo dice**.
 *
 * `prod` no cabe en su nodo: le faltan 60m de CPU y 1 856Mi, y eso NO es una regresion — esta
 * declarado y seguido en `kamayuk:nodeCapacityGapIssue`. La guarda de `capacidad.ts` (C-16) para
 * el despliegue antes de `pulumi up` porque un `up` que empieza sin sitio **no falla**: deja los
 * pods `Pending` y espera indefinidamente, que es lo que colgo `aplicar-prod` cuatro veces (#252).
 *
 * Pero un trabajo que falla por una condicion conocida, declarada y sin fecha deja `main` en rojo
 * permanente, y un `main` siempre rojo deja de avisar de lo siguiente que se rompa. Asi que el
 * trabajo **no aplica y lo dice**, que es lo que C-19 §8.2 hizo con `verificar-el-ambiente.sh`:
 * **«no se hace» no es «esta bien»**.
 *
 * Lo que esta guarda sostiene es que ese mecanismo no se desarme en silencio.
 */
const FLUJO = join(raizDelRepositorio(), ".github/workflows/infra.yml");

interface Paso {
  name?: string;
  uses?: string;
  if?: string;
  run?: string;
}

function pasosDeAplicarProd(): Paso[] {
  const flujo = load(readFileSync(FLUJO, "utf8")) as {
    jobs: Record<string, { steps: Paso[] }>;
  };
  const trabajo = flujo.jobs["aplicar-prod"];
  expect(trabajo, "no esta el trabajo «aplicar-prod» en infra.yml").toBeDefined();
  return trabajo?.steps ?? [];
}

/** Un paso APLICA si toca el cluster o el stack; los de preparacion, no. */
const NO_APLICAN = [
  "actions/checkout",
  "actions/setup-node",
  "Instalar dependencias",
  "Abrir el túnel SSH",
  "Escribir el kubeconfig",
  "clonar-los-hermanos",
  "brecha de capacidad",
  // Este COMPARA lo declarado con el nodo real, y es lo que hace fiable la declaracion:
  // saltarlo mientras la brecha esta puesta seria dejar de mirar lo que la sostiene.
  "Lo declarado cabe en el nodo real",
  // Diagnostico: corre justo cuando algo fallo, con su propio `if: failure()`.
  "Qué quedó a medias",
];

describe("#25 · `aplicar-prod` no aplica con la brecha declarada", () => {
  it("todo paso que aplica lleva la condicion, y ninguno se queda fuera", () => {
    const pasos = pasosDeAplicarProd();
    expect(pasos.length, "«aplicar-prod» no tiene pasos").toBeGreaterThan(5);

    const queAplican = pasos.filter(
      (p) => !NO_APLICAN.some((n) => `${p.name ?? ""}${p.uses ?? ""}`.includes(n)),
    );
    expect(
      queAplican.length,
      "ningun paso de «aplicar-prod» cuenta como aplicar: la lista de exenciones se comio el " +
        "trabajo entero y esta comprobacion no mide nada",
    ).toBeGreaterThan(3);

    const sinCondicion = queAplican
      .filter((p) => !String(p.if ?? "").includes("steps.brecha.outputs.declarada"))
      .map((p) => p.name ?? p.uses ?? "(sin nombre)");
    expect(
      sinCondicion,
      `estos pasos de «aplicar-prod» aplican sin mirar la brecha:\n  ${sinCondicion.join("\n  ")}\n` +
        "  Con `prod` sin caber, lo que hacen es empezar un despliegue que se queda esperando\n" +
        "  para siempre (#252). Remedio: `if: steps.brecha.outputs.declarada != 'si'`.",
    ).toEqual([]);
  });

  /**
   * Y la tuberia con que el flujo lee la bandera, **EJECUTADA**.
   *
   * Es la leccion de M10 de C-19, y la misma que `el-monolito-fuera.test.ts` aplica a
   * `verificar-el-ambiente.sh`: una prueba que solo mirara que el flujo nombra la clave pasaria
   * con la tuberia rota por una letra, y el sintoma seria un `aplicar-prod` que intenta aplicar
   * un stack que no cabe — o, peor, uno que deja de aplicar cuando ya cabria.
   */
  it("el flujo lee la MISMA brecha que `config.ts`", () => {
    const paso = pasosDeAplicarProd().find((p) => (p.name ?? "").includes("brecha de capacidad"));
    expect(paso?.run, "no esta el paso que lee la brecha").toBeDefined();

    // La asignacion ENTERA, uniendo las continuaciones con `\` igual que hace el shell.
    // La primera version filtraba las lineas que contenian `grep`/`sed`/`tr` y las pegaba, y
    // se rompio en cuanto la tuberia ocupo dos lineas: reconstruia algo que ningun shell
    // ejecuta. Se anota porque el modo de fallo era un rojo que acusaba al flujo estando mal
    // la prueba.
    const lineas = (paso?.run ?? "").split("\n");
    const desde = lineas.findIndex((l) => l.trim().startsWith("BRECHA="));
    expect(desde, "el paso ya no asigna `BRECHA=`").toBeGreaterThanOrEqual(0);
    let tuberia = "";
    for (let i = desde; i < lineas.length; i += 1) {
      const linea = lineas[i]?.trim() ?? "";
      tuberia += linea.endsWith("\\") ? `${linea.slice(0, -1)} ` : linea;
      if (!linea.endsWith("\\")) break;
    }
    tuberia += "\necho \"$BRECHA\"";

    const leido = execFileSync("sh", ["-c", tuberia], {
      cwd: join(raizDelRepositorio(), ".."),
      encoding: "utf8",
    }).trim();

    const declarada = invariantesDe("prod").node.capacityGapIssue;
    expect(
      leido,
      `el flujo lee «${leido}» de Pulumi.prod.yaml y config.ts lee «${declarada ?? "(ninguna)"}»`,
    ).toBe(declarada ?? "");
  });

  /**
   * Y el contraste que impide leerlo al reves: `aplicar-stg` **no** lleva esta condicion.
   *
   * `stg` cabe, y el dia que alguien copie el mecanismo alli sin que haga falta, esto lo dice.
   */
  it("`aplicar-stg` no la lleva, porque `stg` cabe", () => {
    const flujo = load(readFileSync(FLUJO, "utf8")) as {
      jobs: Record<string, { steps: Paso[] }>;
    };
    const conCondicion = (flujo.jobs["aplicar-stg"]?.steps ?? []).filter((p) =>
      String(p.if ?? "").includes("steps.brecha.outputs.declarada"),
    );
    expect(conCondicion, "«aplicar-stg» mira una brecha que su stack no declara").toEqual([]);
    expect(invariantesDe("stg").node.capacityGapIssue).toBeUndefined();
  });
});

/**
 * Y que la ruta que el flujo teclea es la del stack de verdad.
 *
 * **Lo que NO se comprueba aqui es que la clave este puesta**, y la primera version de esta
 * prueba lo hacia: se puso roja al medir la mutacion «retirar la brecha», que es exactamente lo
 * que hay que hacer el dia que `prod` quepa. Una guarda que obliga a que un ambiente declare para
 * siempre que no cabe convierte la marca en permanente, que es lo contrario de lo que existe para
 * hacer. Lo que se sostiene es la RUTA: si alguien mueve el stack, el `grep` del flujo devolveria
 * vacio en silencio y el trabajo aplicaria un `prod` que no cabe.
 */
describe("#25 · la ruta que el flujo teclea es la del stack", () => {
  it("`infrastructure/infra/Pulumi.prod.yaml` existe y es el stack de «prod»", () => {
    const stack = readFileSync(join(raizDeInfra(), "Pulumi.prod.yaml"), "utf8");
    expect(stack, "Pulumi.prod.yaml no parece el stack de «prod»").toMatch(
      /^\s*kamayuk:nodeAllocatableCpu:/m,
    );
  });
});
