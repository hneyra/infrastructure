import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { construirManifiestos } from "../componentes";
import { SISTEMAS_DEL_PRODUCTO } from "../componentes/convenciones";
import { raizDelRepositorio } from "../componentes/fuentes";
import { contenedoresDe, podsDe, type Contenedor, type Manifiesto, type Sonda } from "../componentes/tipos";
import { correElBackend } from "./procesos-de-un-sistema";
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

/**
 * Las sondas HTTP de todo contenedor de un sistema, con el pod donde viven **y si ese
 * contenedor corre el jar**.
 *
 * Ese ultimo dato es lo que #16 obliga a tener: la interfaz de `caja` es nginx, y su sonda no
 * la atiende `SeguridadWeb` sino su propio `location`. Ver `procesos-de-un-sistema.ts`.
 */
function sondasDe(
  sistema: string,
): { donde: string; cual: string; ruta: string; backend: boolean; c: Contenedor }[] {
  const plataforma = construirManifiestos(invariantesDe(AMBIENTE));
  const suyos: Manifiesto[] = manifiestosDeLosSistemas(invariantesDe(AMBIENTE), plataforma).filter(
    (m) => m.metadata.namespace === `kamayuk-${sistema}-${AMBIENTE}`,
  );

  const encontradas: {
    donde: string;
    cual: string;
    ruta: string;
    backend: boolean;
    c: Contenedor;
  }[] = [];
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
            encontradas.push({
              donde: `${contexto}, contenedor «${c.name}»`,
              cual,
              ruta,
              backend: correElBackend(sistema, c),
              c,
            });
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
    // Solo los que corren el jar: `SeguridadWeb` es SU cadena, y medir con ella un
    // contenedor de nginx acusa al repositorio equivocado (#16).
    const sondas = sondasDe(sistema).filter((s) => s.backend);

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
    // Tambien solo los del jar, y aqui importa mas que arriba: `new Map` se queda con la
    // ULTIMA, asi que con la interfaz dentro «readinessProbe» valdria «/» y esta prueba
    // mediria la sonda de nginx creyendo que mide la del backend.
    const porSonda = new Map(
      sondasDe(sistema)
        .filter((s) => s.backend)
        .map((s) => [s.cual, s.ruta]),
    );
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

/**
 * Y **la otra mitad**: la sonda de un contenedor que NO corre el jar, contra lo que de verdad la
 * atiende.
 *
 * Sin esto, el arreglo de #16 seria el defecto de C-15/C-16 con otro nombre: separar los
 * contenedores por su imagen deja a la interfaz fuera de la cadena de Spring —correcto— y
 * **fuera de toda comprobacion** —que no lo es—. Una sonda que pide una ruta que nginx no sirve
 * mata el pod igual que una que `SeguridadWeb` no abre; lo unico que cambia es quien contesta.
 *
 * Lo que la atiende viaja en el mismo manifiesto: el `ConfigMap` de nginx que ese pod monta. Se
 * lee de ahi y no del clon, porque lo que se despliega es el `ConfigMap`.
 */
describe("#16 · la sonda de un contenedor que no es el backend, contra su nginx", () => {
  /** Los `location` que declara cualquier `ConfigMap` de nginx del sistema. */
  function locationsDe(sistema: string): string[] {
    const plataforma = construirManifiestos(invariantesDe(AMBIENTE));
    return manifiestosDeLosSistemas(invariantesDe(AMBIENTE), plataforma)
      .filter(
        (m) =>
          m.kind === "ConfigMap" && m.metadata.namespace === `kamayuk-${sistema}-${AMBIENTE}`,
      )
      .flatMap((m) => Object.values((m as { data?: Record<string, string> }).data ?? {}))
      .flatMap((texto) => texto.split("\n"))
      .map((linea) => linea.trim())
      .filter((linea) => linea.startsWith("location "))
      .map((linea) => linea.slice("location ".length).replace(/[{\s].*$/, ""));
  }

  it.each(SISTEMAS_DEL_PRODUCTO)("«%s»", (sistema) => {
    const otras = sondasDe(sistema).filter((s) => !s.backend);
    if (otras.length === 0) return;

    const locations = locationsDe(sistema);
    expect(
      locations,
      `«${sistema}» corre un contenedor que no es su backend y ningun ConfigMap suyo declara un ` +
        "`location`: entonces nadie sabe quien atiende su sonda",
    ).not.toEqual([]);

    for (const s of otras) {
      // `location /` es el prefijo que cubre cualquier ruta; los demas tienen que casar exacto.
      const cubierta = locations.includes("/") || locations.includes(s.ruta);
      expect(
        cubierta,
        `  · ${s.donde}: ${s.cual} pide «${s.ruta}», y el nginx de «${sistema}» solo declara ` +
          `${locations.map((l) => `«${l}»`).join(", ")}.\n` +
          "    Es el mismo fallo que una ruta cerrada en `SeguridadWeb`, con otro servidor\n" +
          "    contestando: el kubelet mata el pod y la aplicacion esta sana.",
      ).toBe(true);
    }
  });

  /**
   * Y el censo, para que esto no pase en verde por lista vacia.
   *
   * Hoy hay **exactamente un** contenedor asi en los cuatro sistemas: la interfaz de ventanilla
   * de `caja` (#16). El dia que `rentas` estrene la suya, esta cifra sube y hay que mirarla; el
   * dia que la de `caja` desaparezca sin querer, se pone roja aqui en vez de dejar el `if` de
   * arriba saliendo por la puerta de atras en los cuatro.
   */
  it("hoy hay exactamente uno, y es la interfaz de «caja»", () => {
    const censo = SISTEMAS_DEL_PRODUCTO.flatMap((sistema) =>
      sondasDe(sistema)
        .filter((s) => !s.backend)
        .map((s) => `${sistema}: ${s.c.image.split(":")[0]?.split("/").pop() ?? ""}`),
    );
    expect([...new Set(censo)]).toEqual(["caja: kamayuk-caja-interfaz"]);
  });
});
