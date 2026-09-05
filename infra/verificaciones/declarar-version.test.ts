import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { raizDeInfra, raizDelRepositorio } from "../componentes/fuentes";
import { ENVIRONMENTS, type Environment } from "../config";
import { aplicar, decidir, type Situacion } from "../herramientas/declarar-version";
import type { DerivaDeMigraciones } from "./deriva-de-migraciones";
import { leerStack } from "./stacks";

/**
 * Quien declara la version desplegable, y por que ya no una persona (issue #720).
 *
 * <h2>Que se puede medir aqui y que no</h2>
 *
 * El flujo que llama a esto —`declarar-version.yml`— se dispara con `workflow_run`, y un
 * flujo asi **solo corre en la rama por omision**: no hay forma de ejercitarlo desde un
 * PR. Asi que el reparto es deliberado:
 *
 * <ul>
 *   <li>las **reglas** —que declarar, cuando y en que ambientes— viven en una funcion
 *       pura y se prueban aqui, con sus mutaciones;
 *   <li>la **escritura** se prueba contra los `Pulumi.*.yaml` de verdad, restaurandolos;
 *   <li>el **cableado** del flujo se afirma leyendo su YAML, que es lo mismo que
 *       `deriva-de-migraciones.test.ts` hace con `paths` y `fetch-depth` desde #675.
 * </ul>
 *
 * Lo que queda sin probar es que el `push` a `main` funcione, y eso no se puede saber
 * desde aqui. Por eso el mecanismo es **aditivo**: si no puede empujar, el flujo se pone
 * rojo en su propia corrida —no en el PR de nadie— y todo queda exactamente como estaba,
 * con la guarda de #675 bloqueando como hoy.
 */

/** Una deriva de mentira, para no depender de como esten los stacks hoy. */
function deriva(ambiente: Environment, faltan: string[]): DerivaDeMigraciones {
  return {
    ambiente,
    sistema: "sgtm",
    version: "5fc02f3a44931d69ac3012e55b17f02dc616eac8",
    traeLaVersion: 61 - faltan.length,
    declaraLaReferencia: 61,
    faltan,
    enLaHistoria: true,
  };
}

const SHA = "c755de2149344b8033736958ee8ae6f643c90281";

const SITUACION: Situacion = {
  candidato: SHA,
  candidatoEnLaHistoria: true,
  faltanEnElCandidato: [],
  derivas: [deriva("stg", ["V78__una.sql"]), deriva("prod", ["V78__una.sql"])],
};

describe("cuando declarar la version, y cuando callarse", () => {
  it("declara en los ambientes que tienen deriva", () => {
    const decision = decidir(SITUACION);
    expect(decision.declarar).toBe(true);
    expect(decision.version).toBe(SHA);
    expect(decision.ambientes).toEqual(["stg", "prod"]);
  });

  it("y solo en esos: un ambiente al dia no se toca", () => {
    const decision = decidir({
      ...SITUACION,
      derivas: [deriva("stg", ["V78__una.sql"]), deriva("prod", [])],
    });
    expect(decision.ambientes).toEqual(["stg"]);
  });

  /**
   * El cierre del bucle que si esta probado.
   *
   * El commit del bump toca `infra/Pulumi.*.yaml`, que esta en las rutas de
   * `publicar-imagenes.yml`. La plataforma ya impide que un `push` con el `GITHUB_TOKEN`
   * dispare flujos, pero eso no lo controlamos nosotros; esto si: el bump no anade
   * ninguna migracion, asi que la segunda vuelta no encuentra deriva y no declara.
   */
  it("no declara nada cuando ningun ambiente tiene deriva — el bucle no se cierra solo por educacion", () => {
    const decision = decidir({
      ...SITUACION,
      derivas: [deriva("stg", []), deriva("prod", [])],
    });
    expect(decision.declarar).toBe(false);
    expect(decision.motivo).toContain("ningun ambiente tiene deriva");
  });

  /**
   * El caso medido a las 15:55 del 2026-09-02, que es el que convirtio el tramite en una
   * cinta de correr: #717 declaraba un `sha` de 67 migraciones y `main` ya iba por 68.
   */
  it("no declara un candidato que dejaria deriva igual", () => {
    const decision = decidir({ ...SITUACION, faltanEnElCandidato: ["V79__otra.sql"] });
    expect(decision.declarar).toBe(false);
    expect(decision.motivo).toContain("V79__otra.sql");
    expect(decision.motivo).toContain("dejaria deriva igual");
  });

  it("no declara un sha que no esta en la historia de main: no tendria imagenes", () => {
    const decision = decidir({ ...SITUACION, candidatoEnLaHistoria: false });
    expect(decision.declarar).toBe(false);
    expect(decision.motivo).toContain("no esta en la historia de main");
  });

  /**
   * La comprobacion que la guarda de #675 ya tenia, aqui como primera criba. No basta
   * ella sola —#720 midio que cuarenta caracteres hexadecimales inventados la pasan— y
   * por eso esta la de la historia; pero quitarla dejaria entrar «main» o una rama.
   */
  it("no declara lo que no es un sha de cuarenta caracteres", () => {
    for (const candidato of ["main", "c755de21", "C755DE2149344B8033736958EE8AE6F643C90281"]) {
      expect(decidir({ ...SITUACION, candidato }).declarar, candidato).toBe(false);
    }
  });
});

describe("la escritura toca una linea, y comprueba lo escrito releyendolo", () => {
  const archivos = ENVIRONMENTS.map((ambiente) => join(raizDeInfra(), `Pulumi.${ambiente}.yaml`));

  /** Con los archivos de verdad, restaurados pase lo que pase. */
  function conLosStacks(prueba: () => void): void {
    const antes = archivos.map((archivo) => readFileSync(archivo, "utf8"));
    try {
      prueba();
    } finally {
      archivos.forEach((archivo, i) => writeFileSync(archivo, antes[i] as string));
    }
  }

  it("deja los dos stacks declarando el sha, leido con el mismo lector que usa Pulumi", () => {
    conLosStacks(() => {
      aplicar({ declarar: true, version: SHA, ambientes: ENVIRONMENTS, motivo: "" });
      for (const ambiente of ENVIRONMENTS) {
        expect(leerStack(ambiente).text("applicationBootstrapVersion"), ambiente).toBe(SHA);
      }
    });
  });

  /**
   * Y **solo** esa linea: el destino de este cambio es `main` directamente, sin revision
   * humana en medio, asi que lo que se compara es el archivo entero menos esa linea.
   */
  it("y no toca ninguna otra linea del archivo", () => {
    const antes = readFileSync(archivos[0] as string, "utf8");
    conLosStacks(() => {
      aplicar({ declarar: true, version: SHA, ambientes: ["stg"], motivo: "" });
      const despues = readFileSync(archivos[0] as string, "utf8");
      const sinLaVersion = (texto: string) =>
        texto
          .split("\n")
          .filter((linea) => !linea.includes("kamayuk:applicationBootstrapVersion:"))
          .join("\n");
      expect(sinLaVersion(despues)).toBe(sinLaVersion(antes));
      expect(despues.split("\n").length).toBe(antes.split("\n").length);
    });
  });

  it("no escribe nada cuando la decision es no declarar", () => {
    const antes = readFileSync(archivos[0] as string, "utf8");
    aplicar({ declarar: false, version: SHA, ambientes: [], motivo: "" });
    expect(readFileSync(archivos[0] as string, "utf8")).toBe(antes);
  });
});

/**
 * El cableado del flujo. Es lo unico que se puede afirmar de el desde un PR, y es donde
 * viven las dos condiciones sin las cuales el mecanismo declara versiones que no
 * existen.
 */
describe("declarar-version.yml esta cableado a lo que promete", () => {
  const flujo = readFileSync(
    join(raizDelRepositorio(), ".github/workflows/declarar-version.yml"),
    "utf8",
  );

  /**
   * La mitad del valor del mecanismo (AC 3 de #720): **no** declarar una version sin
   * imagenes. Si `publicar-imagenes.yml` falla para ese `sha`, aqui no se hace nada.
   */
  it("solo actua si publicar-imagenes.yml termino en verde", () => {
    expect(flujo).toContain("workflows: ['Publicar imágenes']");
    expect(flujo).toContain("github.event.workflow_run.conclusion == 'success'");
  });

  it("y solo sobre main: una rama no tiene imagenes publicadas", () => {
    expect(flujo).toContain("github.event.workflow_run.head_branch == 'main'");
  });

  /**
   * El `sha` que se declara es el de la corrida que publico las imagenes, no `HEAD` de
   * `main`: entre una cosa y otra puede haber entrado otro merge, y declarar ese seria
   * declarar un `sha` cuyas imagenes todavia se estan construyendo.
   */
  it("declara el sha de la corrida que publico, no la cabeza de main", () => {
    expect(flujo).toContain("github.event.workflow_run.head_sha");
  });

  /** Sin historial no se puede contar ninguna de las dos revisiones (#675). */
  it("hace checkout con el historial completo", () => {
    expect(flujo).toContain("fetch-depth: 0");
  });

  it("necesita poder escribir en el repositorio", () => {
    expect(flujo).toContain("contents: write");
  });

  /**
   * Y la version declarada tiene que llegar a aplicarse.
   *
   * Un `push` hecho con el `GITHUB_TOKEN` no dispara flujos, asi que el commit del bump
   * **no** ejecuta `aplicar-stg` por si solo: sin esta puerta la version quedaria
   * declarada y sin aplicar hasta el siguiente push que tocara las rutas de `infra.yml`,
   * un retraso permanente de un merge — medio defecto de #675 reintroducido por la
   * puerta de atras.
   */
  it("y pide que infra.yml lo aplique, porque su propio push no dispara nada", () => {
    expect(flujo).toContain("gh workflow run infra.yml --ref main");

    const infra = readFileSync(join(raizDelRepositorio(), ".github/workflows/infra.yml"), "utf8");
    expect(infra, "infra.yml no acepta workflow_dispatch").toContain("workflow_dispatch:");
    expect(infra).toContain(
      "if: github.event_name == 'push' || github.event_name == 'workflow_dispatch'",
    );
  });
});
