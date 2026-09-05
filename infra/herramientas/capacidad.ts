import { auditarCapacidad, demandaDelStack, describirCapacidad } from "../capacidad";
import { ENVIRONMENTS, type Environment } from "../config";
import { manifiestosDelAmbiente } from "./emitir-manifiestos";
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
 *
 * **Mide los cinco espacios de nombres**, no la plataforma sola. Hasta C-16 llamaba a
 * `construirManifiestos` a secas, asi que contestaba «cabe» habiendo mirado uno de los cinco:
 * los cuatro sistemas de ADR-0031 tienen namespace propio y **el nodo sigue siendo uno**. El
 * desglose por espacio de nombres se imprime siempre, para que la cifra se pueda contrastar sin
 * volver a componer nada.
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
const manifiestos = manifiestosDelAmbiente(invariantes);
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

// Y el desglose por espacio de nombres. Es lo que habria delatado a simple vista el defecto de
// C-16: la cifra de un ambiente con cuatro sistemas desplegados salia con una sola linea aqui.
const porEspacio = new Map<string, { cpu: number; memoria: number }>();
for (const pod of demanda.pods) {
  const acumulado = porEspacio.get(pod.espacio) ?? { cpu: 0, memoria: 0 };
  acumulado.cpu += pod.cpuEnMili;
  acumulado.memoria += pod.memoriaEnMi;
  porEspacio.set(pod.espacio, acumulado);
}
console.error(`  en ${String(porEspacio.size)} espacio(s) de nombres, en el pico:`);
for (const [espacio, suma] of [...porEspacio].sort((a, b) => b[1].cpu - a[1].cpu)) {
  console.error(
    `    ${espacio.padEnd(24)} ${String(suma.cpu)}m / ${String(Math.round(suma.memoria))}Mi`,
  );
}

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
