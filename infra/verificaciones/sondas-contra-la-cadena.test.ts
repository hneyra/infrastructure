import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { construirManifiestos } from "../componentes";
import { SISTEMAS_DEL_PRODUCTO } from "../componentes/convenciones";
import { raizDelRepositorio } from "../componentes/fuentes";
import { contenedoresDe, podsDe, type Manifiesto, type Sonda } from "../componentes/tipos";
import { manifiestosDeLosSistemas } from "../herramientas/emitir-manifiestos";
import { fuenteDeLaCadena, rutasPublicas } from "./sondas-contra-la-cadena";
import { invariantesDe } from "./stacks";

/**
 * C-17 §2 — la ruta que la sonda pide es una que la cadena atiende sin token.
 *
 * El defecto medido, el motivo de que se lea el Java en vez de copiar una lista y por que fallar
 * es preferible a omitir estan en el javadoc de `sondas-contra-la-cadena.ts`. Lo que esta prueba
 * anade es el reparto y el contraste:
 *
 *   - los **cuatro** sistemas se miran desde aqui y no cada uno desde el suyo. Las dos mitades
 *     —la sonda del descriptor y la regla de la cadena— viven en el mismo clon, si, pero el
 *     defecto solo existe al COMPONER, y componer es de este repositorio; ademas las cuatro
 *     cadenas son la misma y una guarda repetida cuatro veces se corrige tres;
 *   - las muestras miden que la comprobacion MUERDE y que **no muerde de mas**. Sin el contraste
 *     en regla, una que rechazara toda cadena pasaria igual de verde.
 */

const AMBIENTE = "stg" as const;
const MUESTRAS = join(
  raizDelRepositorio(),
  "infra",
  "verificaciones",
  "muestras",
  "sondas-contra-la-cadena",
);

const muestra = (nombre: string) => readFileSync(join(MUESTRAS, nombre), "utf8");

/** Las sondas HTTP de todo contenedor de un sistema, con el pod donde viven. */
function sondasDe(sistema: string): { donde: string; cual: string; ruta: string }[] {
  const plataforma = construirManifiestos(invariantesDe(AMBIENTE));
  const suyos: Manifiesto[] = manifiestosDeLosSistemas(invariantesDe(AMBIENTE), plataforma).filter(
    (m) => m.metadata.namespace === `kamayuk-${sistema}-${AMBIENTE}`,
  );

  const encontradas: { donde: string; cual: string; ruta: string }[] = [];
  for (const m of suyos) {
    for (const { contexto, pod } of podsDe(m)) {
      for (const c of contenedoresDe(pod)) {
        const sondas: [string, Sonda | undefined][] = [
          ["startupProbe", c.startupProbe],
          ["readinessProbe", c.readinessProbe],
          ["livenessProbe", c.livenessProbe],
        ];
        for (const [cual, sonda] of sondas) {
          const ruta = sonda?.httpGet?.path;
          if (ruta !== undefined) {
            encontradas.push({ donde: `${contexto}, contenedor «${c.name}»`, cual, ruta });
          }
        }
      }
    }
  }
  return encontradas;
}

describe("C-17 §2 · toda sonda pide una ruta que la cadena de seguridad atiende sin token", () => {
  it.each(SISTEMAS_DEL_PRODUCTO)("«%s»", (sistema) => {
    const publicas = rutasPublicas(fuenteDeLaCadena(sistema), `${sistema}/SeguridadWeb.java`);
    const sondas = sondasDe(sistema);

    expect(
      sondas.length,
      `«${sistema}» no declara ninguna sonda HTTP. Un contenedor sin sondas pasa esta ` +
        "comprobacion sin haber comprobado nada, que es el modo de fallo de #188 con " +
        "`verificar-cuadros.mjs`.",
    ).toBeGreaterThan(0);

    const negadas = sondas.filter((s) => !publicas.includes(s.ruta));
    expect(
      negadas,
      negadas
        .map(
          (s) =>
            `  · ${s.donde}: ${s.cual} pide «${s.ruta}», y SeguridadWeb de «${sistema}» solo ` +
            `atiende sin token ${publicas.map((p) => `«${p}»`).join(", ")}.\n` +
            "    El pod arranca, conecta a la base y el kubelet lo mata: CrashLoopBackOff con la\n" +
            "    aplicacion sana. Remedio: o la sonda pide una ruta ya abierta, o la cadena la\n" +
            "    abre nombrandola —nunca con un comodin—.",
        )
        .join("\n"),
    ).toEqual([]);
  });

  /**
   * Y las dos rutas que se abrieron en C-17 se usan de verdad.
   *
   * Sin esto, alguien podria «arreglar» un rojo futuro devolviendo las tres sondas a
   * `/actuator/health` —que es lo que hace el monolito— y la comprobacion seguiria verde con la
   * distincion vida/preparacion perdida. Lo que se pierde con esa vuelta atras esta escrito en
   * `SeguridadWeb.SONDA_DE_VIDA`: una sonda de VIDA que incluya la base le pide al orquestador
   * que mate el proceso cuando la base no conteste, y matarlo no devuelve la base.
   */
  it.each(SISTEMAS_DEL_PRODUCTO)("«%s» distingue vida de preparacion", (sistema) => {
    const porSonda = new Map(sondasDe(sistema).map((s) => [s.cual, s.ruta]));
    expect(porSonda.get("livenessProbe")).toBe("/actuator/health/liveness");
    expect(porSonda.get("readinessProbe")).toBe("/actuator/health/readiness");
    // El ARRANQUE si mira la base entera, y es lo que hace que un pod no se declare arrancado
    // hasta que llega a ella. Ver `SeguridadWeb.SONDA_DE_PREPARACION`.
    expect(porSonda.get("startupProbe")).toBe("/actuator/health");
  });
});

describe("la lectura de la cadena muerde, y no muerde de mas", () => {
  it("una cadena en regla publica las cuatro rutas que nombra", () => {
    expect(rutasPublicas(muestra("CadenaEnRegla.java.muestra"), "muestra")).toEqual([
      "/actuator/health",
      "/actuator/health/liveness",
      "/actuator/health/readiness",
      "/actuator/prometheus",
    ]);
  });

  it("la cadena anterior a C-17 no publica los dos grupos: es el defecto medido", () => {
    const publicas = rutasPublicas(muestra("CadenaQueNiegaLasSondas.java.muestra"), "muestra");
    expect(publicas).toEqual(["/actuator/health", "/actuator/prometheus"]);
    expect(publicas).not.toContain("/actuator/health/liveness");
  });

  it("un comodin se rechaza: con el, esta comprobacion no podria fallar nunca", () => {
    expect(() => rutasPublicas(muestra("CadenaConComodin.java.muestra"), "muestra")).toThrow(
      /comodin/,
    );
  });

  it("lo que no se resuelve a un literal falla, en vez de omitirse", () => {
    expect(() => rutasPublicas(muestra("CadenaQueNoSeEntiende.java.muestra"), "muestra")).toThrow(
      /no se puede resolver/,
    );
  });

  it("y una cadena sin ningun `permitAll()` tampoco pasa por buena", () => {
    expect(() => rutasPublicas("class Vacia {}", "muestra")).toThrow(/requestMatchers/);
  });
});
