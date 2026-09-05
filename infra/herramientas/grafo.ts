/**
 * El grafo de egreso compuesto: quien puede llamar a quien.
 *
 * **El egreso declarado ES el grafo de dependencias** (ADR-0029), y no es una figura: es lo que
 * las `NetworkPolicy` aplican en el clúster. Si esta salida y ARQ-01 reducido a cuatro nodos no
 * coinciden, la que esta mal es la arquitectura, no el descriptor — y la unica forma de verlo es
 * imprimirlo.
 *
 *   yarn grafo --ambiente stg
 */
import { entornoDelAmbiente } from "./emitir-manifiestos";
import { grafoDeEgreso, SISTEMAS } from "../descriptor/sistemas";
import type { Environment } from "../config";

const i = process.argv.indexOf("--ambiente");
const ambiente = (i >= 0 ? process.argv[i + 1] : "stg") as Environment;
// El MISMO entorno con que se componen los manifiestos. Componerlo aqui a mano seria un segundo
// sitio donde olvidar un campo, y el grafo hablaria de un ambiente que no es el que se despliega.
const grafo = grafoDeEgreso(entornoDelAmbiente(ambiente));

console.log(`Grafo de egreso de «${ambiente}» — ${SISTEMAS.length} sistemas\n`);
for (const sistema of Object.keys(grafo).sort()) {
  const destinos = grafo[sistema] ?? [];
  console.log(
    destinos.length === 0
      ? `  ${sistema.padEnd(10)} ──▶  (ninguno)`
      : `  ${sistema.padEnd(10)} ──▶  ${destinos.join(", ")}`,
  );
}
const aristas = Object.values(grafo).reduce((n, d) => n + d.length, 0);
console.log(`\n  ${aristas} aristas entre sistemas. El motor y la identidad no cuentan: los`);
console.log("  cuatro los necesitan y no son un sistema.");
