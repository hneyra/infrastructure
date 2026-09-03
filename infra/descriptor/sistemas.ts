/**
 * Los cuatro descriptores que este ambiente compone, **con su version fijada**.
 *
 * `infrastructure` los importa y fija la version del paquete —no la de ninguna imagen: son dos
 * cosas distintas y confundirlas es la prohibicion (b)—. Subir una version aqui es lo que hace
 * que un cambio de infraestructura de un sistema llegue a produccion, y es tambien el riesgo que
 * `ADR-0031` §Consecuencias nombra: **el descriptor que nadie compone**. El sintoma es «lo
 * desplegue y no cambio nada».
 *
 * ## Por que `link:` y no `file:`
 *
 * `file:` de yarn v1 **copia** la carpeta a `node_modules`, y ahi las rutas relativas del
 * contrato a `../componentes/tipos` dejan de resolver. Con `link:` se enlaza y se conservan. El
 * dia que estos paquetes se publiquen en un registro, la dependencia pasa a ser una version y
 * esta nota deja de hacer falta.
 */

import type { DescriptorFijado } from "./index";
import { caja } from "../../../caja/infrastructure/src/descriptor";
import { catastro } from "../../../catastro/infrastructure/src/descriptor";
import { normativa } from "../../../normativa/infrastructure/src/descriptor";
import { rentas } from "../../../rentas/infrastructure/src/descriptor";

export const SISTEMAS: readonly DescriptorFijado[] = [
  { version: "0.1.0", descriptor: rentas },
  { version: "0.1.0", descriptor: catastro },
  { version: "0.1.0", descriptor: normativa },
  { version: "0.1.0", descriptor: caja },
];

/** El grafo de egreso compuesto: quien puede llamar a quien. Es el de ARQ-01, en cuatro nodos. */
export function grafoDeEgreso(
  entornoDe: (sistema: string) => import("./tipos").EntornoDelDescriptor,
): Record<string, string[]> {
  const infraestructura = ["postgres", "identidad"];
  const grafo: Record<string, string[]> = {};
  for (const { descriptor } of SISTEMAS) {
    grafo[descriptor.sistema] = descriptor
      .egreso(entornoDe(descriptor.sistema))
      .flatMap((p) => p.spec.egress ?? [])
      .flatMap((r) => r.to ?? [])
      .map((s) => s.podSelector?.matchLabels?.["componente"])
      .filter((c): c is string => c !== undefined && !infraestructura.includes(c))
      .sort();
  }
  return grafo;
}
