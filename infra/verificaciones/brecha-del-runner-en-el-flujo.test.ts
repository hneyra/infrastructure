import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { auditarCapacidad } from "../capacidad";
import { raizDelRepositorio } from "../componentes/fuentes";
import { manifiestosDelAmbiente } from "../herramientas/emitir-manifiestos";
import { invariantesDe } from "./stacks";

/**
 * #203 — el trabajo `capacidad` no comprueba el caso A con la brecha del runner declarada,
 * **y lo dice**.
 *
 * `verificar-contra-el-planificador.sh` necesita un nodo de `kind` con CPU para el stack
 * ENTERO de `prod`, y **el tamano de ese nodo no esta garantizado**. Medido, corrida a
 * corrida: `34817399680` (2026-09-14 07:23Z) 4 CPU y los tres trabajos verdes;
 * `34823544429` (08:36Z) 2 CPU y los tres rojos, con un unico commit entre medias que
 * cambia una linea de `Pulumi.stg.yaml`; `35039858531` (09-16 00:28Z) 2 CPU;
 * `35101337027` (09-16 13:23Z) **4 otra vez**. No cambia el repositorio: cambia el runner,
 * y cambia en las dos direcciones.
 *
 * Y este guion no se puede encoger para que quepa — lo que mide es el stack entero contra un
 * planificador de verdad, asi que aplicar menos es pasar en verde habiendo dejado de medir—.
 * Asi que se declara la brecha y se dice que NO SE HACE, como #25 con `nodeCapacityGapIssue`.
 *
 * <h2>Se ejecuta el guion, no se lee</h2>
 *
 * Con un `kubectl` y un `yarn` de mentira delante en el `PATH`, que es lo unico que hace
 * falta para que este guion decida como decide en CI. Un `grep` sobre el fuente afirmaria lo
 * que el guion dice; esto comprueba lo que hace, **en las cuatro esquinas**.
 *
 * <h2>Y la reciprocidad NO mira el nodo de esta corrida</h2>
 *
 * La primera version del guion salia ROJA cuando el nodo daba y la brecha estaba puesta,
 * pidiendo que se retirara. **Se midio en la primera corrida del PR y estaba mal**: le toco
 * un runner de 4 CPU, el veredicto fue «cabe» y el trabajo salio rojo — o sea, rojo justo en
 * la corrida que SI podia medir. Con un runner que flota, esa reciprocidad convierte la
 * brecha en un interruptor que se dispara al azar.
 *
 * La correcta mira el nodo **MINIMO** que el runner puede dar: mientras `prod` no quepa en
 * 2 CPU, la brecha es real. El dia que quepa —porque baje la demanda o porque el runner
 * minimo crezca— esto se pone rojo, en un PR y sin clúster.
 */

const GUION = join(
  import.meta.dirname,
  "capacidad",
  "verificar-contra-el-planificador.sh",
);
const FLUJO = join(raizDelRepositorio(), ".github/workflows/infra.yml");

/** El formato que el guion exige: `<issue>@<AAAA-MM-DD>`. */
const FORMATO = /^[0-9]+@[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/**
 * El nodo MAS PEQUENO que el runner ha dado, medido: `2 CPU / 8128880Ki` asignables, de
 * los que el plano de control de `kind` ya pide **950m** (corrida `35018105559`). El
 * guion le pasa a `capacidad.ts` lo que queda LIBRE en CPU y lo asignable entero en
 * memoria, asi que aqui se hace igual para que las dos cuentas sean la misma.
 */
const NODO_MINIMO_DEL_RUNNER = { cpuAsignable: "1050m", memoriaAsignable: "8128880Ki" };

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

  /**
   * **La brecha no silencia lo que SI se puede medir**, y esta es la esquina que se
   * aprendio midiendo: la primera version salia roja aqui, y le toco un runner de 4 CPU
   * en la primera corrida del PR.
   */
  it("CON sitio y con la brecha declarada: la comprueba igual, como si no hubiera brecha", () => {
    const { codigo, salida } = correr({
      cpu: "8",
      veredicto: "cabe",
      brecha: "203@2026-09-16",
    });

    expect(
      salida,
      "con nodo de sobra, la brecha declarada se salto la comprobacion: un interruptor",
    ).toContain("Aplicando el stack");
    expect(salida, "la brecha no puede hacer que un nodo con sitio salga rojo").not.toContain(
      "::error::",
    );
    expect(codigo, `el guion salio con ${String(codigo)}:\n${salida}`).not.toBe(0);
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

  /**
   * **Y que la brecha siga siendo real**, que es lo que impide que se quede puesta
   * tapando lo siguiente. Es la reciprocidad de #25, medida contra el nodo **minimo**
   * que el runner puede dar y no contra el que le toque a una corrida: `prod` tiene que
   * SEGUIR sin caber en 2 CPU. El dia que quepa —menos demanda, o un runner minimo
   * mayor—, esto sale rojo aqui, en un PR y sin clúster.
   */
  it("mientras la brecha este declarada, «prod» sigue sin caber en el runner minimo", () => {
    const declarada = pasoDelPlanificador().env?.["BRECHA_DEL_RUNNER"];
    if (declarada === undefined) return;

    const problemas = auditarCapacidad(
      manifiestosDelAmbiente(invariantesDe("prod")),
      NODO_MINIMO_DEL_RUNNER,
    );
    expect(
      problemas,
      "«prod» ya cabe en el nodo minimo que el runner da (2 CPU): la brecha sobra. Retira " +
        `«BRECHA_DEL_RUNNER: ${declarada}» del trabajo «capacidad» de .github/workflows/` +
        `infra.yml y cierra el issue #${declarada.split("@")[0] ?? ""}.`,
    ).not.toEqual([]);
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
