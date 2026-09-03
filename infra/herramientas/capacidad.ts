import { auditarCapacidad, demandaDelStack, describirCapacidad } from "../capacidad";
import { construirManifiestos } from "../componentes";
import { ENVIRONMENTS, type Environment } from "../config";
import { invariantesDe } from "../verificaciones/stacks";

/**
 * El veredicto de `capacidad.ts` desde la linea de ordenes.
 *
 * Existe para dos cosas: mirarlo a mano cuando alguien cambia `webReplicas` o los
 * `requests` —«¿esto todavia cabe?» sin desplegar—, y para que
 * `verificar-contra-el-planificador.sh` pueda contrastar ese veredicto con lo que hace
 * el planificador de Kubernetes de verdad.
 *
 *   yarn capacidad --ambiente prod
 *   yarn capacidad --ambiente prod --cpu 4 --memoria 8Gi   # contra otro nodo
 */

function opcion(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const ambiente = (opcion("ambiente") ?? "") as Environment;
if (!ENVIRONMENTS.includes(ambiente)) {
  console.error(`uso: yarn capacidad --ambiente <${ENVIRONMENTS.join("|")}> [--cpu N] [--memoria N]`);
  process.exit(2);
}

const invariantes = invariantesDe(ambiente);
const manifiestos = construirManifiestos(invariantes);
const nodo = {
  cpuAsignable: opcion("cpu") ?? invariantes.node.allocatableCpu,
  memoriaAsignable: opcion("memoria") ?? invariantes.node.allocatableMemory,
};

const demanda = demandaDelStack(manifiestos);
const problemas = auditarCapacidad(manifiestos, nodo);

console.error(`Ambiente «${ambiente}» contra un nodo de ${nodo.cpuAsignable} / ${nodo.memoriaAsignable}:`);
console.error(
  `  permanente     ${String(demanda.permanente.cpuEnMili)}m / ` +
    `${String(Math.round(demanda.permanente.memoriaEnMi))}Mi`,
);
console.error(
  `  pico arranque  ${String(demanda.picoDeArranque.cpuEnMili)}m / ` +
    `${String(Math.round(demanda.picoDeArranque.memoriaEnMi))}Mi`,
);

// A `stdout` va SOLO el veredicto, en una palabra: es lo que lee el guion de shell.
// Todo lo demas va a `stderr` para que se vea en el registro sin ensuciar la lectura.
if (problemas.length === 0) {
  console.log("cabe");
  process.exit(0);
}

console.error("");
console.error(describirCapacidad(ambiente, problemas));
console.log("no-cabe");

// `--estricto` es lo que usa el paso previo a `pulumi up` en `infra.yml`: ahi «no cabe»
// tiene que DETENER el despliegue, porque seguir es colgarse. Sin la bandera solo
// informa, que es lo que quiere quien lo corre a mano para probar tamanos de nodo.
if (process.argv.includes("--estricto")) {
  console.error(
    `\n«${ambiente}» no se despliega: los pods no cabrian en su nodo y \`pulumi up\` ` +
      "esperaria indefinidamente a que quedaran Ready (issue #252).",
  );
  process.exit(1);
}
