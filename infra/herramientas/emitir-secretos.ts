import { inventarioDelAmbiente } from "../componentes/secretos";
import { ENVIRONMENTS, type Environment } from "../config";
import { invariantesDe } from "../verificaciones/stacks";

/**
 * Escribe el inventario de secretos de un ambiente por la salida estandar, en JSON: **la
 * plataforma y los cuatro sistemas**, cada entrada con el namespace donde vive.
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
  // El inventario COMPLETO: la plataforma y los cuatro sistemas (C-17, punto 4). Hasta aqui
  // emitia solo el del monolito, y por eso `bootstrap-secretos.sh` creaba cero de los diez
  // `Secret` que los cuatro sistemas montan — diciendo «Listo».
  return JSON.stringify(inventarioDelAmbiente(invariantesDe(environment)), null, 2);
}
