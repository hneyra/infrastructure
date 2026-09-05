import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { raizDelRepositorio } from "../componentes/fuentes";
import {
  checkoutsQueEscapan,
  checkoutsQueEscapanEn,
  flujosDe,
  pathsDeCheckout,
  saleDelEspacioDeTrabajo,
} from "./checkout-en-el-espacio-de-trabajo";
import { SISTEMAS, clonDe } from "./deriva-de-migraciones";

/**
 * C-9a — ningun `actions/checkout` apunta fuera del espacio de trabajo.
 *
 * El motivo, el error literal y el limite de la comprobacion estan en el javadoc de
 * `checkout-en-el-espacio-de-trabajo.ts`. Lo que esta prueba anade es el reparto:
 *
 *   - los **seis** clones se miran desde aqui, no cada uno desde el suyo. Este
 *     repositorio ya los tiene todos en CI —los necesita `extensiones-de-las-
 *     migraciones` desde C-2—, y un defecto que solo aparece al empujar no se puede
 *     dejar a que lo cace el CI de cada repositorio: seria el mismo hueco otra vez;
 *   - las muestras miden que la guarda MUERDE y que **no muerde de mas**. Sin el
 *     contraste, una guarda que marcara todo `path:` pasaria igual de verde.
 */

const AQUI = join(raizDelRepositorio(), "infra", "verificaciones");
const MUESTRAS = join(AQUI, "muestras", "checkout-fuera-del-espacio");

const muestra = (nombre: string) => readFileSync(join(MUESTRAS, nombre), "utf8");

/** Los seis clones: este repositorio y los cinco de `SISTEMAS`. */
const CLONES: { nombre: string; raiz: () => string }[] = [
  { nombre: "infrastructure", raiz: raizDelRepositorio },
  ...SISTEMAS.map((sistema) => ({ nombre: sistema.nombre, raiz: () => clonDe(sistema) })),
];

describe("ningun actions/checkout escribe fuera del espacio de trabajo", () => {
  it.each(CLONES)("$nombre", ({ raiz }) => {
    const escapan = checkoutsQueEscapanEn(raiz());
    expect(
      escapan,
      escapan
        .map(
          (e) =>
            `  · ${e.archivo}:${e.linea} — «path: ${e.ruta}»\n` +
            "    `actions/checkout` se niega a escribir fuera de GITHUB_WORKSPACE.\n" +
            "    Remedio: clona ESTE repositorio en `path: <su nombre>` y el hermano en\n" +
            "    `path: <nombre del hermano>`; el espacio de trabajo pasa a ser el padre.",
        )
        .join("\n"),
    ).toEqual([]);
  });

  /**
   * Y se ha mirado algo. Un clon sin flujos pasaria en verde sin haber comprobado nada,
   * que es el modo de fallo de #188 con `verificar-cuadros.mjs`.
   */
  it.each(CLONES)("$nombre tiene flujos que mirar", ({ raiz }) => {
    expect(flujosDe(raiz()).length).toBeGreaterThan(0);
  });
});

describe("la guarda muerde", () => {
  it("marca el `path: ../sgtm` con su archivo y su linea", () => {
    const hallazgos = checkoutsQueEscapan(
      muestra("flujo-que-lo-viola.yml"),
      "muestras/flujo-que-lo-viola.yml",
    );
    expect(hallazgos).toEqual([
      { archivo: "muestras/flujo-que-lo-viola.yml", linea: 24, ruta: "../sgtm" },
    ]);
  });

  it("y marca una ruta absoluta, que tampoco esta bajo el espacio de trabajo", () => {
    const hallazgos = checkoutsQueEscapan(
      muestra("flujo-con-ruta-absoluta.yml"),
      "muestras/flujo-con-ruta-absoluta.yml",
    );
    expect(hallazgos.map((h) => h.ruta)).toEqual(["/tmp/rentas"]);
  });
});

describe("y no muerde de mas", () => {
  it("la muestra en regla —hermanos dentro del espacio— no tiene ni un hallazgo", () => {
    expect(checkoutsQueEscapan(muestra("flujo-en-regla.yml"), "en-regla")).toEqual([]);
  });

  /**
   * El contraste que sostiene el criterio: en las dos muestras hay un `path:` que sale
   * del espacio de trabajo y **no es de un checkout** —el de `actions/cache`—, mas un
   * `cache-dependency-path:` de `setup-node`. Los tres pueden apuntar donde quieran.
   * Sin esta prueba, la guarda podria estar marcando cualquier `path:` y las dos de
   * arriba seguirian en verde.
   */
  it.each(["flujo-que-lo-viola.yml", "flujo-en-regla.yml"])(
    "el `path:` de actions/cache y el `cache-dependency-path:` no son de checkout (%s)",
    (nombre) => {
      const fuente = muestra(nombre);
      expect(fuente, "la muestra tiene que traer los dos contrastes").toContain(
        "path: ../fuera/del/espacio",
      );
      expect(pathsDeCheckout(fuente).map((p) => p.ruta)).not.toContain("../fuera/del/espacio");
      expect(pathsDeCheckout(fuente).map((p) => p.ruta)).not.toContain("../otro/yarn.lock");
    },
  );

  it("un `path` relativo hacia dentro no escapa, y uno hacia fuera si", () => {
    expect(saleDelEspacioDeTrabajo("infrastructure")).toBe(false);
    expect(saleDelEspacioDeTrabajo("clones/sgtm")).toBe(false);
    expect(saleDelEspacioDeTrabajo("./sgtm")).toBe(false);
    expect(saleDelEspacioDeTrabajo("a/../b")).toBe(false);
    expect(saleDelEspacioDeTrabajo("../sgtm")).toBe(true);
    expect(saleDelEspacioDeTrabajo("a/../../sgtm")).toBe(true);
    expect(saleDelEspacioDeTrabajo("/tmp/sgtm")).toBe(true);
  });
});

/**
 * El limite declarado, sostenido en vez de escrito.
 *
 * `saleDelEspacioDeTrabajo` no decide sobre un `path: ${{ ... }}`: no se puede resolver
 * leyendo el archivo. Ese hueco solo es inofensivo mientras no haya ninguno, asi que se
 * mide — y el dia que alguien escriba el primero, esto se pone rojo y hay que decidir.
 */
describe("el limite de la comprobacion sigue sin aplicar", () => {
  it.each(CLONES)("$nombre no usa una expresion como `path` de un checkout", ({ raiz }) => {
    const conExpresion = flujosDe(raiz()).flatMap((nombre) =>
      pathsDeCheckout(readFileSync(join(raiz(), ".github", "workflows", nombre), "utf8"))
        .filter((p) => p.ruta.includes("${{"))
        .map((p) => `${nombre}:${p.linea} — ${p.ruta}`),
    );
    expect(conExpresion).toEqual([]);
  });
});
