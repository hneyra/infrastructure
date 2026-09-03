import { inventarioDeSecretos } from "../componentes/secretos";
import { ENVIRONMENTS, type Environment } from "../config";

/**
 * Escribe el inventario de secretos de un ambiente por la salida estandar, en JSON.
 *
 * ```
 *   yarn secretos --ambiente stg
 * ```
 *
 * Es la contraparte de `emitir-manifiestos.ts`, y con el mismo motivo: los guiones de
 * bash (`secretos/bootstrap-secretos.sh`, `secretos/rotar-clave.sh`) necesitan los
 * nombres de los `Secret` y sus claves, y **no los escriben a mano** — los leen de aqui,
 * que a su vez los lee de `componentes/convenciones.ts`. Si un nombre cambiara en un
 * solo sitio, los guiones de bash seguirian el cambio sin que nadie los tocara.
 *
 * No emite ningun valor: el inventario es metadatos —nombre del `Secret`, clave,
 * consumidor, periodicidad—, nunca un secreto.
 */

export function leerAmbiente(argv: string[]): Environment {
  const i = argv.indexOf("--ambiente");
  const valor = i >= 0 ? argv[i + 1] : undefined;
  if (valor === undefined || !ENVIRONMENTS.includes(valor as Environment)) {
    throw new Error(`Falta \`--ambiente\` o no es uno de los dos: ${ENVIRONMENTS.join(", ")}.`);
  }
  return valor as Environment;
}

export function emitir(environment: Environment): string {
  return JSON.stringify(inventarioDeSecretos(environment), null, 2);
}
