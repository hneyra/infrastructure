import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SISTEMAS_DEL_PRODUCTO } from "../componentes/convenciones";

/**
 * El contrato se resuelve por DOS caminos, y tienen que llevar al mismo sitio.
 *
 * Cada sistema declara `@kamayuk/infra-contrato` —el nombre se lee del propio paquete— como `link:` en su `package.json`, y quien
 * materializa ese enlace es `yarn install` DENTRO de ese sistema. El CI de este repositorio
 * clona los cuatro para comprobarlos y solo instala en `infrastructure/infra`, asi que alli el
 * enlace NO EXISTE: `DescriptorDeSistema` deja de resolver, el parametro `e` de cada metodo cae
 * a `any` y salen 30 `TS7006`.
 *
 * Eso paso, y es la clase de defecto que mas cuesta ver: **verde en la maquina de quien lo
 * escribe y rojo en CI**, porque en una maquina de desarrollo los cinco clones tienen sus
 * dependencias instaladas y el enlace esta. Nada lo medi­a.
 *
 * El arreglo es el `paths` de `tsconfig.json`, que apunta al contrato de este repositorio —que
 * es exactamente a donde el enlace apunta cuando existe—. Esta guarda ata las dos declaraciones:
 * si un sistema cambia su `link:` y el `paths` se queda como estaba, los dos caminos dejarian de
 * llevar al mismo archivo y **el defecto volveria en la direccion contraria**: verde en CI, y
 * en una maquina de desarrollo cada sistema compilando contra otro contrato.
 */

const RAIZ = resolve(__dirname, "..");

/**
 * El nombre del paquete NO se escribe aqui: se lee del `package.json` del contrato.
 *
 * Escribirlo seria un tercer sitio con la misma verdad, y el que envejece. Lo enseno R-A/B: el
 * paquete paso de `@sgtm/infra-contrato` a `@kamayuk/infra-contrato`, y con el literal puesto
 * esta guarda habria seguido comprobando que las dos declaraciones coinciden **en el nombre
 * viejo** — que es exactamente la forma con que C-17 §1 y C-18 §5 encontraron guardas
 * fosilizando el valor roto.
 */
function llaveDelContrato(): string {
  const nombre = leerJson(resolve(RAIZ, "contrato", "package.json"))["name"];
  expect(
    typeof nombre === "string" && nombre.length > 0,
    "«infra/contrato/package.json» no declara un «name». Es de donde sale la llave con que los " +
      "cuatro sistemas lo enlazan, y sin ella esta comprobacion no tiene que comparar.",
  ).toBe(true);
  return nombre as string;
}

function leerJson(ruta: string): Record<string, unknown> {
  // Los `tsconfig` llevan comentarios: se retiran antes de analizar. Solo los de linea, que es
  // lo unico que estos archivos usan.
  const texto = readFileSync(ruta, "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  return JSON.parse(texto) as Record<string, unknown>;
}

/** A donde apunta el `paths` del `tsconfig` de este repositorio, en absoluto. */
function destinoDelPaths(): string {
  const tsconfig = leerJson(resolve(RAIZ, "tsconfig.json"));
  const opciones = (tsconfig["compilerOptions"] ?? {}) as Record<string, unknown>;
  const paths = (opciones["paths"] ?? {}) as Record<string, string[]>;
  const llave = llaveDelContrato();
  const entrada = paths[llave];
  expect(
    entrada,
    `«${llave}» no esta en el «paths» de infra/tsconfig.json. Sin el, el CI de este ` +
      "repositorio no puede comprobar los descriptores de los cuatro sistemas: los clona sin " +
      "instalar sus dependencias, el enlace del contrato no existe y salen 30 «TS7006».",
  ).toBeDefined();
  expect(entrada).toHaveLength(1);
  return resolve(RAIZ, entrada![0]!);
}

/** A donde apunta el `link:` que declara un sistema, en absoluto. */
function destinoDelEnlace(sistema: string): string {
  const paquete = resolve(RAIZ, "..", "..", sistema, "infrastructure", "package.json");
  const json = leerJson(paquete);
  const deps = (json["dependencies"] ?? {}) as Record<string, string>;
  const llave = llaveDelContrato();
  const declarado = deps[llave];
  expect(declarado, `«${sistema}» no declara «${llave}» en sus dependencias.`).toBeDefined();
  expect(declarado).toMatch(/^link:/);
  return resolve(dirname(paquete), declarado!.slice("link:".length));
}

describe("el contrato se resuelve al mismo archivo por los dos caminos", () => {
  it("el «paths» apunta a un archivo que existe", () => {
    const destino = destinoDelPaths();
    expect(() => readFileSync(destino, "utf8")).not.toThrow();
  });

  it.each(SISTEMAS_DEL_PRODUCTO)("«%s» declara el enlace al mismo contrato", (sistema) => {
    // El `paths` nombra el archivo de entrada y el `link:` nombra el directorio del paquete:
    // se comparan por el directorio, que es lo que los dos tienen en comun.
    expect(dirname(destinoDelPaths())).toBe(destinoDelEnlace(sistema));
  });
});
