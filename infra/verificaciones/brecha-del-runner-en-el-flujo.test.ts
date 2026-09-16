import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { raizDelRepositorio } from "../componentes/fuentes";

/**
 * #203 — el trabajo `capacidad` no comprueba el caso A con la brecha del runner declarada,
 * **y lo dice**.
 *
 * `verificar-contra-el-planificador.sh` necesita un nodo de `kind` con CPU para el stack
 * ENTERO de `prod`, y lo tuvo hasta el 2026-09-14: la corrida `34817399680` midio
 * **4 CPU / 16373452Ki**; la `34823544429`, hora y cuarto despues, **2 CPU / 8128880Ki**. El
 * unico commit entre las dos es un «stg despliega normativa@0f258a2c0668». **No cambio el
 * repositorio: cambio el runner.**
 *
 * Y este guion no se puede encoger para que quepa — lo que mide es el stack entero contra un
 * planificador de verdad, asi que aplicar menos es pasar en verde habiendo dejado de medir—.
 * Asi que se declara la brecha y se dice que NO SE HACE, como #25 con `nodeCapacityGapIssue`.
 *
 * <h2>Se ejecuta el guion, no se lee</h2>
 *
 * Con un `kubectl` y un `yarn` de mentira delante en el `PATH`, que es lo unico que hace
 * falta para que este guion decida como decide en CI. Un `grep` sobre el fuente afirmaria lo
 * que el guion dice; esto comprueba lo que hace, **en las cuatro esquinas**: con brecha y sin
 * sitio, sin brecha y sin sitio, con brecha y CON sitio —la direccion que impide que la marca
 * se quede puesta—, y sin brecha y con sitio, que es la que impide que esto rechace a todo el
 * mundo.
 */

const GUION = join(
  import.meta.dirname,
  "capacidad",
  "verificar-contra-el-planificador.sh",
);
const FLUJO = join(raizDelRepositorio(), ".github/workflows/infra.yml");

/** El formato que el guion exige: `<issue>@<AAAA-MM-DD>`. */
const FORMATO = /^[0-9]+@[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

interface Corrida {
  codigo: number;
  salida: string;
}

/**
 * Corre el guion con un nodo de `cpu` CPU y la brecha que se le indique.
 *
 * El `kubectl` de mentira contesta las cuatro preguntas que el guion le hace —lo asignable,
 * el nombre del nodo y los pods ya ubicados, con los 950m que el plano de control de `kind`
 * pide de verdad— y **falla ruidosamente ante cualquier otra**: si el guion pasara de donde
 * esta prueba lo espera, se veria.
 *
 * El `yarn` de mentira devuelve el veredicto pedido, y ante `manifiestos` sale con 96: es
 * como se mide que el guion LLEGO hasta ahi en el caso que tiene que seguir.
 */
function correr(opciones: { cpu: string; veredicto: string; brecha?: string }): Corrida {
  const carpeta = mkdtempSync(join(tmpdir(), "kamayuk-203-"));

  writeFileSync(
    join(carpeta, "kubectl"),
    [
      "#!/usr/bin/env bash",
      'case "$*" in',
      `  *allocatable.cpu*) printf %s '${opciones.cpu}' ;;`,
      "  *allocatable.memory*) printf %s '8128880Ki' ;;",
      "  *metadata.name*) printf %s 'nodo-de-mentira' ;;",
      "  *'get pods'*)",
      `    printf %s '{"items":[{"spec":{"containers":[{"resources":{"requests":{"cpu":"950m"}}}]}}]}' ;;`,
      '  *) echo "kubectl de mentira: no se fingir «$*»" >&2; exit 97 ;;',
      "esac",
      "",
    ].join("\n"),
  );
  chmodSync(join(carpeta, "kubectl"), 0o755);

  writeFileSync(
    join(carpeta, "yarn"),
    [
      "#!/usr/bin/env bash",
      'case "$*" in',
      '  *manifiestos*) echo "yarn de mentira: hasta aqui llego el guion" >&2; exit 96 ;;',
      `  *capacidad*) printf '%s\\n' '${opciones.veredicto}' ;;`,
      '  *) echo "yarn de mentira: no se fingir «$*»" >&2; exit 95 ;;',
      "esac",
      "",
    ].join("\n"),
  );
  chmodSync(join(carpeta, "yarn"), 0o755);

  try {
    const salida = execFileSync("bash", [GUION], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PATH: `${carpeta}${delimiter}${process.env.PATH ?? ""}`,
        BRECHA_DEL_RUNNER: opciones.brecha ?? "",
      },
    });
    return { codigo: 0, salida };
  } catch (error) {
    const fallo = error as { status?: number; stdout?: string; stderr?: string };
    return { codigo: fallo.status ?? -1, salida: `${fallo.stdout ?? ""}${fallo.stderr ?? ""}` };
  }
}

describe("#203 · la brecha del runner, ejecutada", () => {
  it("sin sitio y con la brecha declarada: NO se hace, se dice, y sale verde", () => {
    const { codigo, salida } = correr({
      cpu: "2",
      veredicto: "no-cabe",
      brecha: "203@2026-09-16",
    });

    expect(codigo, `el guion salio con ${String(codigo)}:\n${salida}`).toBe(0);
    expect(salida).toContain("NO SE HACE");
    expect(salida, "la brecha no nombra su issue").toContain("#203");
    expect(salida, "la brecha no lleva su fecha").toContain("2026-09-16");
    expect(salida, "un verde mudo es lo que esto existe para impedir").toContain("::warning::");
    expect(salida, "no dice cuanto falta").toContain("1050m");
  });

  it("sin sitio y SIN brecha: rojo, como hasta #203", () => {
    const { codigo, salida } = correr({ cpu: "2", veredicto: "no-cabe" });

    expect(codigo, "una CI sin sitio y sin brecha declarada tiene que salir roja").toBe(1);
    expect(salida).toContain("::error::");
    expect(salida).toContain("No se da por bueno en silencio");
  });

  /** La direccion que impide que la marca se quede puesta. Es la reciprocidad de #25. */
  it("CON sitio y con la brecha declarada: rojo pidiendo que se retire", () => {
    const { codigo, salida } = correr({
      cpu: "8",
      veredicto: "cabe",
      brecha: "203@2026-09-16",
    });

    expect(codigo, `el guion salio con ${String(codigo)}:\n${salida}`).toBe(1);
    expect(salida).toContain("::error::");
    expect(salida, "no dice que hay que retirar ni de donde").toContain("BRECHA_DEL_RUNNER");
    expect(salida).toContain(".github/workflows/infra.yml");
  });

  /** Y la que impide que esto rechace a todo el mundo: con sitio y sin brecha, sigue. */
  it("CON sitio y sin brecha: el guion SIGUE, y aplica el stack", () => {
    const { codigo, salida } = correr({ cpu: "8", veredicto: "cabe" });

    expect(salida, "el guion se detuvo antes de aplicar nada").toContain("Aplicando el stack");
    expect(
      salida,
      "el guion no llego a pedir los manifiestos: se paro en la brecha que no hay",
    ).toContain("yarn de mentira: hasta aqui llego el guion");
    // Muere ahi, en el `node` de la tuberia que no recibe JSON: lo que se mide es que
    // PASO de la comprobacion, no que acabe bien — para acabar bien hace falta un clúster.
    expect(codigo, `el guion salio con ${String(codigo)}:\n${salida}`).not.toBe(0);
  });

  it("una brecha mal escrita no pasa por brecha", () => {
    const { codigo, salida } = correr({ cpu: "2", veredicto: "no-cabe", brecha: "si" });

    expect(codigo, "«si» no es un issue ni una fecha, y aun asi saltaria la comprobacion").toBe(1);
    expect(salida).toContain("<issue>@<AAAA-MM-DD>");
  });
});

describe("#203 · lo que el flujo declara", () => {
  function pasoDelPlanificador(): { env?: Record<string, string>; run?: string } {
    const flujo = load(readFileSync(FLUJO, "utf8")) as {
      jobs: Record<string, { steps: { name?: string; env?: Record<string, string>; run?: string }[] }>;
    };
    const pasos = flujo.jobs["capacidad"]?.steps ?? [];
    const paso = pasos.find((p) => (p.run ?? "").includes("verificar-contra-el-planificador.sh"));
    expect(paso, "el trabajo «capacidad» ya no corre verificar-contra-el-planificador.sh").toBeDefined();
    return paso ?? {};
  }

  /**
   * **No se exige que la brecha ESTE puesta**, y es deliberado: una guarda que la exigiera
   * la volveria permanente, que es lo contrario de lo que existe para hacer. Es la misma
   * correccion que #25 tuvo que hacerle a su primera version. Lo que se sostiene es que si
   * esta, este bien escrita — y el guion ya se pone rojo con una que no lo este.
   */
  it("si el flujo declara una brecha, la declara con su issue y su fecha", () => {
    const declarada = pasoDelPlanificador().env?.["BRECHA_DEL_RUNNER"];
    if (declarada === undefined) return;

    expect(
      declarada,
      `«${declarada}» no es «<issue>@<AAAA-MM-DD>». Una brecha sin issue no se sigue y una ` +
        "sin fecha no envejece: las dos se quedan puestas para siempre.",
    ).toMatch(FORMATO);

    const fecha = declarada.split("@")[1] ?? "";
    expect(
      Number.isNaN(Date.parse(fecha)),
      `la fecha de la brecha, «${fecha}», no es una fecha`,
    ).toBe(false);
  });

  /** Y que el nombre que el flujo teclea es el que el guion lee. Una letra de mas y no hay brecha. */
  it("el flujo y el guion nombran la MISMA variable", () => {
    const declarada = pasoDelPlanificador().env ?? {};
    const guion = readFileSync(GUION, "utf8");

    expect(guion, "el guion ya no lee ninguna brecha").toContain('BRECHA="${BRECHA_DEL_RUNNER:-}"');
    const ajenas = Object.keys(declarada).filter((clave) => !guion.includes(clave));
    expect(
      ajenas,
      `el trabajo «capacidad» le pasa al guion variables que el guion no lee: ${ajenas.join(", ")}. ` +
        "Con la brecha mal tecleada, el trabajo vuelve a salir rojo por una condicion declarada.",
    ).toEqual([]);
  });
});
