/**
 * La composicion de los descriptores de sistema (ADR-0031 §2).
 *
 * `infrastructure` los importa, **fija su version**, los compone y **los audita con las
 * mismas reglas que audita los propios**. Ese ultimo punto es el diseno entero: un
 * sistema no puede desplegar un manifiesto que las convenciones rechazan, y la auditoria
 * deja de ser un documento tambien a traves de la frontera de un repositorio.
 *
 * ## Donde se fija la version, y donde NO
 *
 * La version que se fija aqui es la **del paquete del descriptor** —`@sgtm/infra-catastro`
 * en el `package.json`—, no la de la imagen. Son dos cosas distintas y confundirlas es la
 * prohibicion (b): el descriptor describe *como* se despliega un sistema y cambia cuando
 * cambian sus limites o sus sondas; la imagen dice *que version corre*, se mueve con
 * `kubectl set image` y no pasa por Pulumi (ADR-0011 §5).
 *
 * ## Hoy compone cero descriptores, y es correcto
 *
 * Ninguno de los cuatro sistemas publica el suyo todavia. `componerDescriptores([])`
 * devuelve `[]`, y por eso `yarn manifiestos` produce **el mismo JSON** que antes de que
 * esta carpeta existiera: lo que aun no hay no puede haber cambiado nada de lo desplegado.
 * `verificaciones/descriptor.test.ts` lo fija con una prueba, para que el dia que entre el
 * primero se vea en el diff de los manifiestos y no de sorpresa.
 */

import type { Manifiesto } from "../componentes/tipos";
import {
  auditarDescriptor,
  describirAuditoriaDeDescriptores,
  type ContextoDeDescriptores,
} from "./auditoria";
import { manifiestosDe, type DescriptorDeSistema, type EntornoDelDescriptor } from "./tipos";

export type { ContextoDeDescriptores } from "./auditoria";
export * from "./tipos";
export { auditarDescriptor, describirAuditoriaDeDescriptores } from "./auditoria";

/**
 * Los descriptores que este ambiente compone, con su version fijada.
 *
 * Vacia hasta que el primer sistema publique el suyo. Cuando lo haga, la entrada es
 * `{ version: "1.4.0", descriptor: catastro }` y la version es la del paquete npm, no la
 * de ninguna imagen.
 */
export interface DescriptorFijado {
  /** La version del paquete `@sgtm/infra-<sistema>`. Se fija aqui, no la elige el sistema. */
  readonly version: string;
  readonly descriptor: DescriptorDeSistema;
}

export interface ResultadoDeComposicion {
  readonly manifiestos: Manifiesto[];
  readonly problemas: string[];
}

/**
 * Audita y compone. **Audita primero**, y devuelve los problemas en vez de aplicar nada:
 * quien llama decide si lanza, igual que `index.ts` hace con `auditarManifiestos`.
 */
export function componerDescriptores(
  fijados: readonly DescriptorFijado[],
  entornoDe: (sistema: string) => EntornoDelDescriptor,
  contexto: ContextoDeDescriptores,
): ResultadoDeComposicion {
  const problemas: string[] = [];
  const manifiestos: Manifiesto[] = [];

  const vistos = new Set<string>();
  for (const { descriptor } of fijados) {
    if (vistos.has(descriptor.prefijo)) {
      problemas.push(
        `[${descriptor.sistema}] dos sistemas reclaman el prefijo «${descriptor.prefijo}». El ` +
          "enrutado por prefijo decide quien responde a que: con dos duenos, quien contesta lo " +
          "decide el orden de aplicacion.",
      );
    }
    vistos.add(descriptor.prefijo);
  }

  for (const { descriptor } of fijados) {
    const entorno = entornoDe(descriptor.sistema);
    problemas.push(...auditarDescriptor(descriptor, entorno, contexto));
    // El `Namespace` lo crea `infrastructure`, no el descriptor: es de alcance de clúster y la
    // dueña del nodo es esta. Un sistema que pudiera crear el suyo podria crear el de otro.
    manifiestos.push({
      apiVersion: "v1",
      kind: "Namespace",
      metadata: { name: entorno.namespace, labels: { ...entorno.etiquetas } },
    });
    manifiestos.push(...manifiestosDe(descriptor, entorno));
  }

  return { manifiestos, problemas };
}

/** Compone o lanza. Es lo que `../index.ts` llama antes de crear ningun recurso. */
export function componerOFallar(
  fijados: readonly DescriptorFijado[],
  entornoDe: (sistema: string) => EntornoDelDescriptor,
  contexto: ContextoDeDescriptores,
): Manifiesto[] {
  const { manifiestos, problemas } = componerDescriptores(fijados, entornoDe, contexto);
  if (problemas.length > 0) throw new Error(describirAuditoriaDeDescriptores(problemas));
  return manifiestos;
}
