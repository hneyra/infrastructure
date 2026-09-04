import {
  derivaDeMigraciones,
  estaEnLaHistoriaDe,
  loQueLeFaltaA,
  REVISION_DE_REFERENCIA,
  sistemaLlamado,
  unicoSistemaDesplegado,
} from "../verificaciones/deriva-de-migraciones";
import { AMBIENTES, aplicar, decidir } from "./declarar-version";

/**
 * La entrada de la automatizacion de #720: `vite-node herramientas/declarar.ts -- <sha>`.
 *
 * Tres cosas y ninguna mas, por lo mismo que `emitir.ts`: la logica vive en
 * `declarar-version.ts`, que no escribe nada al importarse, asi que sus reglas se pueden
 * ejercitar desde un PR aunque el flujo que la llama —`declarar-version.yml`, disparado
 * por `workflow_run`— solo pueda correr en la rama por omision.
 *
 * Escribe los archivos y no hace `commit`: quien decide si hay algo que integrar es el
 * flujo, mirando si el arbol de trabajo cambio. Asi esta herramienta se puede correr en
 * seco en cualquier maquina —cambia dos archivos, se leen, se descartan— sin tener que
 * inventarle una bandera de simulacion que despues nadie ejercita.
 */
const candidato = process.argv[2];

if (candidato === undefined || candidato === "") {
  process.stderr.write(
    "Uso: vite-node herramientas/declarar.ts -- <sha de main con imagenes publicadas>\n",
  );
  process.exit(2);
}

// De QUE repositorio es el `sha` candidato: el del sistema cuyo migrador construye el
// despliegue. Se resuelve y no se supone —hasta P6 se suponia «este», y por eso la
// guarda de #675 llevaba seis pruebas en rojo desde la mudanza—; y si algun dia hay mas
// de un migrador, `unicoSistemaDesplegado` lanza en vez de elegir uno.
const sistema = sistemaLlamado(unicoSistemaDesplegado(AMBIENTES[0]));

const decision = decidir({
  candidato,
  candidatoEnLaHistoria: estaEnLaHistoriaDe(candidato, REVISION_DE_REFERENCIA, sistema),
  faltanEnElCandidato: loQueLeFaltaA(candidato, REVISION_DE_REFERENCIA, sistema),
  derivas: AMBIENTES.map((ambiente) => derivaDeMigraciones(ambiente)),
});

aplicar(decision);

process.stdout.write(
  (decision.declarar
    ? `Se declara ${decision.version} en ${decision.ambientes.join(", ")}: ${decision.motivo}`
    : `No se declara nada: ${decision.motivo}`) + "\n",
);
