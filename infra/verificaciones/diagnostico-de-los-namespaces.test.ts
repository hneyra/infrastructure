import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { raizDelRepositorio } from "../componentes/fuentes";
import { ENVIRONMENTS } from "../config";
import { manifiestosDelAmbiente } from "../herramientas/emitir-manifiestos";
import { invariantesDe } from "./stacks";

/**
 * `#40` — el diagnostico de CI miraba un espacio de nombres de cinco.
 *
 * `diagnostico-del-namespace.sh` nacio cuando habia UNO. Desde ADR-0031 los cuatro sistemas viven
 * en el suyo, y `aplicar-stg` seguia invocandolo con `kamayuk-stg` a secas: cuando fallo el `Job`
 * de migracion de `rentas` volco los pods de la PLATAFORMA y **ni una linea** de
 * `kamayuk-rentas-stg` — que es el namespace que habia que mirar. Medido en la corrida
 * `34227961707`, la que dejo sin diagnosticar por que la migracion salia con codigo 1.
 *
 * Es la misma forma que C-16 (`yarn capacidad` medía un namespace de cinco), que `E` (el censo de
 * deriva leia solo la plataforma) y que #10 (el `Job` de carga nacia donde no hay egreso): algo
 * escrito cuando habia un solo espacio de nombres, que no siguio al corte.
 *
 * Estas guardas no necesitan cluster: leen el flujo, el guion y los manifiestos.
 */
const GUION = join(raizDelRepositorio(), ".github/diagnostico-del-namespace.sh");
const FLUJO = join(raizDelRepositorio(), ".github/workflows/infra.yml");

interface Paso {
  name?: string;
  uses?: string;
  run?: string;
}

/** Las invocaciones del guion en el flujo, con el trabajo donde viven. */
function invocaciones(): { trabajo: string; linea: string }[] {
  const flujo = load(readFileSync(FLUJO, "utf8")) as {
    jobs: Record<string, { steps?: Paso[] }>;
  };
  const encontradas: { trabajo: string; linea: string }[] = [];
  for (const [trabajo, cuerpo] of Object.entries(flujo.jobs)) {
    for (const paso of cuerpo.steps ?? []) {
      for (const linea of (paso.run ?? "").split("\n")) {
        if (linea.includes("diagnostico-del-namespace.sh")) {
          encontradas.push({ trabajo, linea: linea.trim() });
        }
      }
    }
  }
  return encontradas;
}

describe("#40 · el diagnostico cubre los CINCO espacios de nombres", () => {
  it("toda invocacion del flujo pide un AMBIENTE, no un namespace suelto", () => {
    const usos = invocaciones();
    expect(usos.length, "el flujo ya no invoca `diagnostico-del-namespace.sh`").toBeGreaterThan(0);

    const sueltas = usos.filter((u) => !u.linea.includes("--ambiente"));
    expect(
      sueltas,
      "estas invocaciones diagnostican UN espacio de nombres:\n  " +
        sueltas.map((u) => `${u.trabajo}: ${u.linea}`).join("\n  ") +
        "\n  Desde ADR-0031 el ambiente son cinco, y el Job que falla suele estar en el de su " +
        "sistema. Remedio: `--ambiente <stg|prod>`.",
    ).toEqual([]);
  });

  /**
   * Y el selector con que el guion los descubre **casa con las etiquetas que los manifiestos
   * ponen de verdad**.
   *
   * Es la mitad que sostiene todo lo demas: el guion pregunta al cluster por
   * `proyecto=kamayuk,ambiente=<amb>`, y si alguien cambia `commonLabels` ese selector deja de
   * encontrar nada y el diagnostico se vuelve mudo **sin que nada se ponga rojo**. Se comparan
   * las dos fuentes reales, no una lista escrita en la prueba.
   */
  it.each(ENVIRONMENTS)("«%s»: el selector del guion casa con las etiquetas emitidas", (ambiente) => {
    const guion = readFileSync(GUION, "utf8");
    const declarado = /^SELECTOR_DEL_AMBIENTE="([^"]+)"$/m.exec(guion);
    expect(declarado, "el guion ya no declara `SELECTOR_DEL_AMBIENTE`").not.toBeNull();

    // `proyecto=kamayuk,ambiente=` + el ambiente.
    const pares = `${declarado?.[1] ?? ""}${ambiente}`
      .split(",")
      .map((p) => p.split("="))
      .map(([clave, valor]) => [clave ?? "", valor ?? ""] as const);

    const espacios = manifiestosDelAmbiente(invariantesDe(ambiente)).filter(
      (m: { kind?: string }) => m.kind === "Namespace",
    ) as { metadata: { name: string; labels?: Record<string, string> } }[];

    expect(espacios.length, "el ambiente no compone ningun Namespace").toBeGreaterThan(1);

    const casan = espacios.filter((n) =>
      pares.every(([clave, valor]) => (n.metadata.labels ?? {})[clave] === valor),
    );
    expect(
      casan.map((n) => n.metadata.name).sort(),
      `el selector «${pares.map(([c, v]) => `${c}=${v}`).join(",")}» no casa con todos los ` +
        "Namespace que el ambiente emite: el diagnostico se quedaria mudo justo donde hay que " +
        "mirar, y en verde",
    ).toEqual(espacios.map((n) => n.metadata.name).sort());
  });

  /**
   * Y el guion **vuelca los registros** del pod que no arranco.
   *
   * `describe` dice «Error»; el registro dice CUAL. Sin esto, el caso que dio origen a #40 —una
   * migracion que sale con codigo 1— se diagnostica igual de mal aunque se mire el namespace
   * correcto.
   */
  it("el guion pide `kubectl logs` de los pods que no estan Running", () => {
    const guion = readFileSync(GUION, "utf8");
    const lineas = guion.split("\n").filter((l) => !l.trim().startsWith("#"));
    expect(
      lineas.join("\n"),
      "el guion no vuelca registros: `describe` dice «Error» y el registro dice cual",
    ).toMatch(/kubectl logs .*--all-containers/);
  });

  /**
   * Y cero espacios de nombres **no puede leerse como «todo bien»**.
   *
   * Es la leccion de C-15/C-16: una comprobacion que no encuentra sujeto tiene que decirlo. Si el
   * selector dejara de casar, sin esto el paso saldria en verde habiendo diagnosticado nada.
   */
  it("cero espacios de nombres se dice, no se calla", () => {
    const guion = readFileSync(GUION, "utf8");
    expect(guion).toMatch(/NINGUN espacio de nombres lleva/);
    expect(guion, "no distingue «no se pudo mirar» de «esta bien»").toMatch(/NO es «todo bien»/);
  });
});
