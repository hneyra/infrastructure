import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { raizDeInfra, raizDelRepositorio } from "../componentes/fuentes";
import {
  ACCION,
  guionesQueLosNecesitan,
  herramientasQueLosNecesitan,
  hermanosQueImportaElDescriptor,
  loQueEjecuta,
  trabajosSinSusHermanos,
  trabajosSinSusHermanosEn,
} from "./clones-de-los-hermanos";

/**
 * C-20 — todo trabajo que necesite los descriptores hermanos los clona.
 *
 * El defecto, las cifras de la corrida en que se midio y los dos limites estan en el
 * javadoc de `clones-de-los-hermanos.ts`. Lo que esta prueba anade es el reparto:
 *
 *   - **el veredicto sobre los flujos de verdad**, que es lo que hoy delataba CI diez
 *     minutos despues y ahora delata `yarn verificar` en segundos;
 *   - **que la deteccion mide y no repite una lista**: las herramientas salen del grafo
 *     de importaciones y los guiones del `source`, y las dos cosas se comprueban contra
 *     casos concretos que existen en el arbol;
 *   - **las muestras, con su contraste**. Una guarda que exigiera la accion a TODO
 *     trabajo pasaria las dos primeras igual de verde — y obligaria a
 *     `librerias-backend.yml` y a `registro.yml` a clonar cuatro repositorios que no
 *     leen.
 */

const MUESTRAS = join(raizDelRepositorio(), "infra", "verificaciones", "muestras", "clones-de-los-hermanos");
const muestra = (nombre: string) => readFileSync(join(MUESTRAS, nombre), "utf8");

const HERRAMIENTAS = herramientasQueLosNecesitan(raizDeInfra());
const GUIONES = guionesQueLosNecesitan(raizDelRepositorio(), HERRAMIENTAS);
const enLaMuestra = (nombre: string) =>
  trabajosSinSusHermanos(muestra(nombre), nombre, HERRAMIENTAS, GUIONES);

describe("ningun trabajo se queda sin sus hermanos", () => {
  it("los flujos de este repositorio", () => {
    const sinHermanos = trabajosSinSusHermanosEn(raizDelRepositorio(), raizDeInfra());
    expect(
      sinHermanos,
      sinHermanos
        .map(
          (t) =>
            `  · ${t.archivo} · trabajo «${t.trabajo}»\n` +
            `    Necesita los descriptores porque ejecuta «${t.porque}», y ${t.falta}.\n` +
            "    En CI eso muere con «Cannot find module\n" +
            "    '../../../caja/infrastructure/src/descriptor'» — o, si el paso va detras\n" +
            "    de un `if` que hoy no se cumple, sale VERDE sin haberlo ejecutado.\n" +
            `    Remedio: \`path: infrastructure\` en su checkout, y detras\n` +
            `    \`uses: ./infrastructure/${ACCION}\`.`,
        )
        .join("\n\n"),
    ).toEqual([]);
  });

  /**
   * Y se ha mirado algo. Si la deteccion no encontrara ninguna herramienta ni ningun
   * guion, la comprobacion de arriba pasaria en verde sin haber exigido nada — el modo de
   * fallo de #188 con `verificar-cuadros.mjs`.
   */
  it("y se ha mirado algo: hay herramientas y guiones que los necesitan", () => {
    expect(HERRAMIENTAS.length).toBeGreaterThan(0);
    expect(GUIONES.length).toBeGreaterThan(0);
  });
});

describe("lo que necesita los descriptores se DERIVA", () => {
  /**
   * Los cuatro nombres salen de los especificadores de `descriptor/sistemas.ts`, no de
   * una lista: el dia que entre un quinto sistema, la accion tiene que clonarlo.
   */
  it("la accion compuesta clona exactamente los hermanos que el descriptor importa", () => {
    const accion = readFileSync(join(raizDelRepositorio(), ACCION, "action.yml"), "utf8");
    const clonados = [...accion.matchAll(/^\s+path:\s*(\S+)\s*$/gm)].map((m) => m[1]!);
    expect(clonados.filter((c) => c !== "sgtm").sort()).toEqual(
      hermanosQueImportaElDescriptor(raizDeInfra()),
    );
  });

  /**
   * Y el manifiesto de la accion no lleva ninguna expresion fuera de `runs`.
   *
   * GitHub evalua `${{ … }}` **tambien dentro de una `description`**, y ahi el contexto
   * `secrets` no existe: la primera version de esta accion transcribia el repliegue
   * `secrets.GH_CLONE_KEY || github.token` en la descripcion de su entrada, y la corrida
   * `33973367477` murio en 8 s con «Unrecognized named-value: 'secrets'» **sin ejecutar
   * un solo paso** — o sea que el defecto no se parece en nada a lo que se estaba
   * documentando. Se lee el YAML ya analizado, para que un comentario pueda seguir
   * enseñando como se llama a la accion.
   */
  it("el manifiesto de la accion no evalua ninguna expresion fuera de `runs`", () => {
    const manifiesto = load(
      readFileSync(join(raizDelRepositorio(), ACCION, "action.yml"), "utf8"),
    ) as Record<string, unknown>;
    const fuera = Object.entries(manifiesto)
      .filter(([clave]) => clave !== "runs")
      .map(([clave, valor]) => [clave, JSON.stringify(valor)] as const)
      .filter(([, texto]) => texto.includes("${{"));
    expect(fuera.map(([clave]) => clave)).toEqual([]);
  });

  it("las tres herramientas que cargan el descriptor, mas pulumi y verificar", () => {
    expect(HERRAMIENTAS).toEqual(["capacidad", "grafo", "manifiestos", "pulumi", "secretos", "verificar"]);
  });

  /**
   * El caso por el que hacia falta seguir el `source`: ni `verificar-el-motor.sh` ni
   * `simulacro-de-restauracion.sh` nombran ninguna herramienta, y los dos cargan
   * `lib-motor-local.sh`, que invoca `yarn --silent manifiestos`. Los dos trabajos que
   * los corren salieron rojos el 2026-09-05.
   */
  it("y los guiones que solo lo necesitan por `source` de otro", () => {
    expect(GUIONES).toContain("infra/verificaciones/motor/lib-motor-local.sh");
    expect(GUIONES).toContain("infra/verificaciones/motor/verificar-el-motor.sh");
    expect(GUIONES).toContain("infra/respaldo/simulacro-de-restauracion.sh");
  });

  it("nombrar una herramienta en un comentario o en un `echo` no es invocarla", () => {
    expect(loQueEjecuta("# yarn manifiestos\necho 'yarn capacidad'\nyarn secretos")).toBe(
      "yarn secretos",
    );
    expect(GUIONES).not.toContain("infra/vps/comprobar-lo-asignable.sh");
    expect(GUIONES).not.toContain("infra/verificaciones/ambiente/verificar-el-ambiente.sh");
    expect(GUIONES).not.toContain("infra/verificaciones/motor/puerto.sh");
  });
});

describe("la guarda muerde", () => {
  it("un trabajo que invoca `yarn manifiestos` y no clona a nadie", () => {
    expect(enLaMuestra("flujo-que-lo-viola.yml")).toEqual([
      {
        archivo: "flujo-que-lo-viola.yml",
        trabajo: "emite-manifiestos",
        porque: "manifiestos",
        falta: `no usa \`./infrastructure/${ACCION}\``,
      },
    ]);
  });

  /**
   * Y la mitad que no se ve: con el anfitrion en la raiz del espacio de trabajo, los
   * hermanos caen al lado del ESPACIO y no al lado del repositorio, asi que
   * `../../../caja/...` sigue sin resolver — y `./infrastructure/.github/actions/...` ni
   * siquiera existe. Es exactamente el estado del que salio C-9a.
   */
  it("y uno que usa la accion pero deja el anfitrion en la raiz", () => {
    const hallazgos = enLaMuestra("flujo-con-el-anfitrion-en-la-raiz.yml");
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]!.falta).toMatch(/path: infrastructure/);
  });
});

describe("y no muerde de mas", () => {
  it("la muestra en regla no tiene ni un hallazgo", () => {
    expect(enLaMuestra("flujo-en-regla.yml")).toEqual([]);
  });

  /**
   * EL CONTRASTE. Sin esto, una guarda que exigiera la accion a todo trabajo pasaria las
   * tres pruebas de arriba y obligaria a los dos flujos que no leen ningun descriptor a
   * clonar cuatro repositorios.
   */
  it("un trabajo que no carga el descriptor no tiene que clonar nada", () => {
    expect(enLaMuestra("flujo-que-no-los-necesita.yml")).toEqual([]);
  });

  it("y los dos flujos de este repositorio que no lo cargan siguen sin la accion", () => {
    for (const flujo of ["librerias-backend.yml", "registro.yml"]) {
      const fuente = readFileSync(join(raizDelRepositorio(), ".github", "workflows", flujo), "utf8");
      expect(fuente, `${flujo} no deberia clonar hermanos que no lee`).not.toContain(ACCION);
      expect(trabajosSinSusHermanos(fuente, flujo, HERRAMIENTAS, GUIONES)).toEqual([]);
    }
  });
});
