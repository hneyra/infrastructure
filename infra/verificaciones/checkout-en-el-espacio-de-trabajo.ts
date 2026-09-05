import { existsSync, readdirSync, readFileSync } from "node:fs";
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

/**
 * Donde puede haber un `actions/checkout` en un clon: sus flujos y sus acciones locales.
 *
 * Las rutas vuelven **relativas a la raiz del clon**, que es como se nombran en el
 * hallazgo.
 *
 * `.github/actions/‹nombre›/action.yml` entra desde C-20, y no es un adorno: los cinco
 * checkouts de los hermanos se mudaron ahi para tener una sola definicion, y con esta
 * funcion mirando solo `workflows/` habrian quedado **fuera del alcance de la guarda** —
 * un `path: ../sgtm` escrito dentro de la accion no lo habria visto nadie, que es
 * exactamente el estado del que C-9a salio.
 *
 * Si no hay ni flujos ni acciones, **lanza diciendo cual y por que**, en vez de devolver
 * la lista vacia. Un clon sin nada que mirar pasaria esta comprobacion en verde sin haber
 * mirado nada, que es el modo de fallo de #188 con `verificar-cuadros.mjs`; y hoy es un
 * estado alcanzable de verdad: los cuatro repositorios del corte existen en GitHub **con
 * un `README.md` y nada mas**, asi que un checkout suyo trae `.git` y ninguna otra cosa.
 */
export function flujosDe(raiz: string): string[] {
  const carpeta = join(raiz, ".github", "workflows");
  const flujos = existsSync(carpeta)
    ? readdirSync(carpeta)
        .filter((nombre) => nombre.endsWith(".yml") || nombre.endsWith(".yaml"))
        .map((nombre) => `.github/workflows/${nombre}`)
    : [];

  const acciones = join(raiz, ".github", "actions");
  const compuestas = existsSync(acciones)
    ? readdirSync(acciones, { withFileTypes: true })
        .filter((entrada) => entrada.isDirectory())
        .map((entrada) => `.github/actions/${entrada.name}/action.yml`)
        .filter((ruta) => existsSync(join(raiz, ruta)))
    : [];

  const todos = [...flujos, ...compuestas].sort();
  if (todos.length === 0) {
    throw new Error(
      `No hay ningun flujo ni accion en «${join(raiz, ".github")}», asi que no se puede ` +
        "saber si ese clon saca algun `actions/checkout` fuera del espacio de trabajo.\n" +
        "  Un clon sin flujos no es «nada que comprobar»: es una comprobacion que no se " +
        "hizo, y en verde no se distingue de una que paso.\n" +
        "  Suele ser un clon vacio o a medias — los cuatro repositorios del corte estan " +
        "hoy publicados con un README.md y nada mas.",
    );
  }
  return todos;
}

/** Los `actions/checkout` que escapan, en todo lo que un clon declara. */
export function checkoutsQueEscapanEn(raiz: string): CheckoutQueEscapa[] {
  return flujosDe(raiz).flatMap((ruta) =>
    checkoutsQueEscapan(readFileSync(join(raiz, ruta), "utf8"), ruta),
  );
}
