import { readdirSync, readFileSync } from "node:fs";
import { join, normalize } from "node:path";

/**
 * Ningun `actions/checkout` apunta fuera del espacio de trabajo (C-9a).
 *
 * ## El defecto, que no es hipotetico
 *
 * Todo este proyecto esta escrito suponiendo que los clones son HERMANOS —`../sgtm`,
 * `../rentas`…—, que es como estan en la maquina de quien lo escribe. Lo asume
 * `clonDe` en `deriva-de-migraciones.ts`, lo asume `settings.gradle.kts` de los cuatro
 * backends para `librerias-backend`, y lo asume el `link:` de los cuatro descriptores.
 *
 * En CI esa disposicion **no se puede reproducir clonando hacia arriba**:
 * `actions/checkout` se niega a escribir fuera de `GITHUB_WORKSPACE`. La primera
 * publicacion de `infrastructure` —tras quince etapas y doce correcciones sin un solo
 * `push`— fallo en **9 segundos**, con este error y nada mas:
 *
 *     Repository path '/home/runner/work/infrastructure/sgtm' is not under
 *                     '/home/runner/work/infrastructure/infrastructure'
 *
 * Y eran **diez sitios en cinco repositorios**: cinco `path: ../` en `infra.yml` de
 * aqui y uno en cada `infraestructura.yml` de los cuatro sistemas. Ninguna guarda podia
 * verlo, porque el unico sintoma esta del otro lado del `push`.
 *
 * ## Que se comprueba, y por que asi
 *
 * Se lee el TEXTO de cada flujo y no su YAML analizado, por dos motivos que se pagan
 * juntos: el numero de linea —un hallazgo que no dice donde no se arregla— y que un
 * `path:` dentro de un paso de `actions/checkout` es exactamente lo que hay que mirar,
 * mientras que `cache-dependency-path:` de `setup-node` o el `path:` de `actions/cache`
 * **si** pueden apuntar donde quieran. La prueba lo fija con los dos contrastes.
 *
 * ## El limite, declarado en vez de descubierto
 *
 * Solo se decide sobre valores LITERALES. Un `path: ${{ ... }}` no se puede resolver
 * leyendo el archivo, asi que no se marca — y para que ese hueco no se abra en silencio,
 * `checkout-en-el-espacio-de-trabajo.test.ts` exige que hoy no haya ninguno.
 */

/** Un `actions/checkout` cuyo `path` sale del espacio de trabajo. */
export interface CheckoutQueEscapa {
  /** Ruta del flujo, relativa a la raiz del clon. */
  archivo: string;
  /** Linea del `path:`, empezando en 1. */
  linea: number;
  /** El valor literal, tal cual esta escrito. */
  ruta: string;
}

/** Un `path:` de un `actions/checkout`, con su linea y su valor ya limpio. */
interface PathDeCheckout {
  linea: number;
  ruta: string;
}

/** El valor de una clave YAML de una linea, sin comentario al final ni comillas. */
function valorLimpio(crudo: string): string {
  let valor = crudo.trim();
  const comentario = valor.indexOf(" #");
  if (comentario !== -1) valor = valor.slice(0, comentario).trim();
  if (valor.length >= 2) {
    const primera = valor[0];
    if ((primera === '"' || primera === "'") && valor.endsWith(primera)) {
      valor = valor.slice(1, -1);
    }
  }
  return valor;
}

/** La sangria de una linea: cuantos espacios antes del primer caracter. */
function sangria(linea: string): number {
  return linea.length - linea.trimStart().length;
}

/**
 * Los `path:` que declara cada paso de `actions/checkout` de este flujo.
 *
 * Exportada para que la prueba pueda medir los dos contrastes —el `path:` de
 * `actions/cache` y el `cache-dependency-path:` de `setup-node`— sin depender de que
 * el veredicto sea el que se espera.
 */
export function pathsDeCheckout(fuente: string): PathDeCheckout[] {
  const lineas = fuente.split("\n");
  const encontrados: PathDeCheckout[] = [];

  let sangriaDelPaso: number | undefined;
  let esCheckout = false;
  let pathDelPaso: PathDeCheckout | undefined;

  const cerrarPaso = (): void => {
    if (esCheckout && pathDelPaso !== undefined) encontrados.push(pathDelPaso);
    esCheckout = false;
    pathDelPaso = undefined;
  };

  for (const [indice, linea] of lineas.entries()) {
    const sinEspacios = linea.trim();
    // Un comentario no declara nada. Y hace falta decirlo: el propio `infra.yml`
    // explica en un comentario por que ya no hay ningun `path: ../`.
    if (sinEspacios === "" || sinEspacios.startsWith("#")) continue;

    const abrePaso = /^-\s/.test(sinEspacios) || sinEspacios === "-";
    // Una linea a la altura del paso, o a su izquierda, y que no es del paso: lo cierra.
    if (sangriaDelPaso !== undefined && sangria(linea) <= sangriaDelPaso && !abrePaso) {
      cerrarPaso();
      sangriaDelPaso = undefined;
    }
    if (abrePaso) {
      cerrarPaso();
      sangriaDelPaso = sangria(linea);
    }
    if (sangriaDelPaso === undefined) continue;

    const usa = /^-?\s*uses:\s*(.+)$/.exec(sinEspacios);
    if (usa?.[1] !== undefined && valorLimpio(usa[1]).startsWith("actions/checkout")) {
      esCheckout = true;
    }

    const ruta = /^-?\s*path:\s*(.+)$/.exec(sinEspacios);
    if (ruta?.[1] !== undefined) {
      pathDelPaso = { linea: indice + 1, ruta: valorLimpio(ruta[1]) };
    }
  }
  cerrarPaso();

  return encontrados;
}

/** Si ese valor literal cae fuera del espacio de trabajo. */
export function saleDelEspacioDeTrabajo(ruta: string): boolean {
  // No se puede decidir leyendo el archivo. El limite esta declarado arriba y lo
  // sostiene una prueba: hoy no hay ninguno.
  if (ruta.includes("${{")) return false;
  if (ruta.startsWith("/")) return true;
  const normalizada = normalize(ruta);
  return normalizada === ".." || normalizada.startsWith(`..${"/"}`);
}

/** Los `actions/checkout` de este flujo que escapan del espacio de trabajo. */
export function checkoutsQueEscapan(fuente: string, archivo: string): CheckoutQueEscapa[] {
  return pathsDeCheckout(fuente)
    .filter(({ ruta }) => saleDelEspacioDeTrabajo(ruta))
    .map(({ linea, ruta }) => ({ archivo, linea, ruta }));
}

/** Los flujos de un clon: `.github/workflows/*.yml`, ordenados. */
export function flujosDe(raiz: string): string[] {
  const carpeta = join(raiz, ".github", "workflows");
  return readdirSync(carpeta)
    .filter((nombre) => nombre.endsWith(".yml") || nombre.endsWith(".yaml"))
    .sort();
}

/** Los `actions/checkout` que escapan, en todos los flujos de un clon. */
export function checkoutsQueEscapanEn(raiz: string): CheckoutQueEscapa[] {
  return flujosDe(raiz).flatMap((nombre) =>
    checkoutsQueEscapan(
      readFileSync(join(raiz, ".github", "workflows", nombre), "utf8"),
      `.github/workflows/${nombre}`,
    ),
  );
}
