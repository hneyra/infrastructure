import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { raizDelRepositorio } from "../componentes/fuentes";
import { ENVIRONMENTS } from "../config";
import {
  derivaDeMigraciones,
  loQueFalta,
  REVISION_DE_REFERENCIA,
  loQueNoEncaja,
  type DerivaDeMigraciones,
} from "./deriva-de-migraciones";

/**
 * La deriva de migraciones deja de poder crecer en silencio (issue #675).
 *
 * Lo que este archivo mide **no** es lo que mide `verificar-el-ambiente.sh`. Aquel
 * compara la base con la version que el ambiente declara, y por eso el 2026-09-01 dijo
 * «48 · 48 · OK» de un `stg` que corria 48 de las 61 migraciones de `main`: estaba al
 * dia con su version declarada, y la version declarada llevaba trece migraciones sin
 * moverse. Aqui se compara ese tercer numero, y **sin cluster**: solo hacen falta el
 * archivo del stack y el arbol de git, asi que la demostracion de que la regla muerde se
 * puede correr en cualquier maquina.
 *
 * Los dos ambientes van juntos a proposito. `aplicar-prod` tiene `needs: aplicar-stg`
 * (`infra.yml`), asi que `stg` es la puerta por la que pasa toda version que llegue a
 * produccion: dejar uno de los dos atras convierte el ensayo en un ensayo de otra cosa.
 */
describe("los ambientes declaran la version que trae las migraciones de main", () => {
  it.each(ENVIRONMENTS)("Pulumi.%s.yaml", (ambiente) => {
    const deriva = derivaDeMigraciones(ambiente);
    expect(loQueFalta(deriva), loQueFalta(deriva)).toBe("");
  });

  /**
   * El contraste, y no sobra: sin el, la comprobacion de arriba pasaria en verde
   * tambien si `migracionesDe` devolviera siempre lo mismo para las dos revisiones
   * —o cero para las dos—, que es el modo de fallo de toda comparacion entre dos
   * lecturas del mismo sitio.
   */
  it.each(ENVIRONMENTS)("y la cuenta de %s no es cero ni inventada", (ambiente) => {
    const deriva = derivaDeMigraciones(ambiente);
    expect(deriva.traeLaVersion).toBeGreaterThan(0);
    expect(deriva.declaraLaReferencia).toBeGreaterThan(0);
    expect(deriva.version).toMatch(/^[0-9a-f]{40}$/);
  });

  /**
   * Y el `sha` declarado tiene que ser de `main` (issue #720).
   *
   * La comprobacion de forma de arriba **no basta, y se midio por las malas**: al
   * preparar #719 se tecleo a mano un `sha` inventado de cuarenta caracteres
   * hexadecimales, y la forma lo admite. Lo que ahi lo habria cazado es `migracionesDe`,
   * porque esa revision no esta en el clon — pero solo por eso.
   *
   * El que **no** cazaba nadie es el de una rama: existe, se cuenta sin protestar, puede
   * traer exactamente las mismas migraciones que `main` y dejar `loQueFalta` en blanco.
   * Y no tiene imagenes: `publicar-imagenes.yml` las publica al integrar en `main`, nunca
   * desde una rama, asi que el Job de migracion pediria una etiqueta que nadie construyo
   * y el sintoma llegaria en el despliegue, no aqui.
   *
   * *Mutacion:* declarar en `Pulumi.stg.yaml` la cabeza de cualquier rama sin integrar.
   */
  it.each(ENVIRONMENTS)("y el sha de %s esta en la historia de main", (ambiente) => {
    const deriva = derivaDeMigraciones(ambiente);
    expect(loQueNoEncaja(deriva), loQueNoEncaja(deriva)).toBe("");
  });
});

/**
 * El mensaje, con cifras inventadas.
 *
 * Va aparte de la medicion real por un motivo concreto: el dia en que los dos ambientes
 * esten al dia —que es el dia que este issue busca—, las pruebas de arriba dejan de
 * ejercitar el texto del rojo, y un mensaje que nadie ejercita se degrada sin que nadie
 * lo note. Aqui se fija que **las dos cifras** salgan siempre, que es lo que el criterio
 * de aceptacion pide.
 */
describe("cuando hay deriva, el rojo nombra las dos cifras", () => {
  const inventada: DerivaDeMigraciones = {
    ambiente: "stg",
    version: "5fc02f3a44931d69ac3012e55b17f02dc616eac8",
    traeLaVersion: 48,
    declaraLaReferencia: 61,
    faltan: ["V58__una.sql", "V59__otra.sql"],
    enLaHistoria: true,
  };

  it("dice cuantas trae la version y cuantas declara la referencia", () => {
    const mensaje = loQueFalta(inventada);
    expect(mensaje).toContain("48 migraciones");
    expect(mensaje).toContain(`${REVISION_DE_REFERENCIA} declara 61`);
    expect(mensaje).toContain("le faltan 2");
  });

  it("nombra las migraciones que faltan y el Job que nunca se creo", () => {
    const mensaje = loQueFalta(inventada);
    expect(mensaje).toContain("V58__una.sql");
    expect(mensaje).toContain("V59__otra.sql");
    // El nombre exacto del Job que `yarn manifiestos --ambiente stg | grep migracion`
    // imprime: es la evidencia de que el Job NO se creo, no de que se creara y fallara.
    expect(mensaje).toContain("sgtm-stg-migracion-5fc02f3a4493");
  });

  it("y calla cuando no falta ninguna", () => {
    expect(loQueFalta({ ...inventada, faltan: [] })).toBe("");
  });

  /**
   * El otro rojo, que tiene otro remedio: aqui no falta una migracion, falta que el
   * `sha` sea de `main`. Van separados por eso — «sube la version» y «esa version no es
   * de main» se arreglan de dos maneras distintas.
   */
  it("y el de la historia dice que las imagenes se publican al integrar", () => {
    const mensaje = loQueNoEncaja({ ...inventada, enLaHistoria: false });
    expect(mensaje).toContain("no esta en la historia");
    expect(mensaje).toContain("publicar-imagenes.yml");
    expect(mensaje).toContain("git rev-parse");
  });

  it("y calla cuando el sha si esta en la historia", () => {
    expect(loQueNoEncaja(inventada)).toBe("");
  });
});

/**
 * Y la guarda tiene que **correr** cuando llega una migracion.
 *
 * Esto es la mitad del defecto de #675 que no esta en ningun archivo de `infra/`: hasta
 * el 2026-09-02, el filtro `paths` de `infra.yml` no nombraba el directorio de las
 * migraciones, asi que **integrar una migracion no disparaba este flujo** —ni la guarda
 * de arriba, ni `aplicar-stg`, que es quien despliega—. Trece migraciones entraron sin
 * que ninguna corrida se pusiera roja.
 *
 * Es la misma leccion que #192 §2 y que el propio `infra.yml` ya tiene escrita para los
 * archivos de identidad: un archivo que las pruebas LEEN y el filtro no nombra cambia sin
 * que corra quien lo mira — verde rancio, no verde.
 */
describe("el flujo corre cuando llega una migracion", () => {
  const flujo = readFileSync(join(raizDelRepositorio(), ".github/workflows/infra.yml"), "utf8");

  it.each([
    ["las migraciones", "backend/sgtm-esquema/src/main/resources/db/migration/**"],
    ["los roles y sus extensiones", "backend/sgtm-esquema/src/main/resources/db/roles/**"],
    ["el guion de extensiones", "despliegue/crear-extensiones.sh"],
  ])("`paths` de infra.yml nombra %s", (_que, ruta) => {
    expect(flujo).toContain(`- '${ruta}'`);
  });

  /**
   * Y con `fetch-depth: 0`, o la guarda de arriba no puede contar nada: las dos
   * revisiones se cuentan en el arbol de git de su commit, y con el checkout superficial
   * ninguno esta en el clon.
   */
  it("y `verificar` hace checkout con el historial completo", () => {
    const jobs = flujo.split(/^ {2}[a-z-]+:$/m);
    const verificar = jobs.find((bloque) => bloque.includes("name: Lint, tipos y pruebas"));
    expect(verificar, "no se encontro el trabajo «Lint, tipos y pruebas»").toBeDefined();
    expect(verificar).toContain("fetch-depth: 0");
  });
});
