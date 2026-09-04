import { writeFileSync } from "node:fs";
import { archivoDeLasReglas, reglasComoYaml } from "../observabilidad/reglas-del-corte";
import { archivoDelTablero, tableroComoJson } from "../observabilidad/tablero-del-corte";

/**
 * `yarn observabilidad-del-corte`: reescribe el tablero y las reglas de las seis cifras.
 *
 * Un punto de entrada aparte, por lo mismo que `herramientas/declarar.ts`: los generadores no
 * escriben nada al importarse, asi que sus reglas se pueden ejercitar desde una prueba sin que
 * cargar el modulo toque un archivo. Adivinar «soy el punto de entrada» mirando `process.argv`
 * no funciona bajo `vite-node` —argv[1] es su propio binario—, y un generador que se cree
 * ejecutado y no escriba nada es peor que uno que no existe.
 */
writeFileSync(archivoDelTablero(), tableroComoJson(), "utf8");
writeFileSync(archivoDeLasReglas(), reglasComoYaml(), "utf8");

process.stdout.write(
  `Escritos:\n  ${archivoDelTablero()}\n  ${archivoDeLasReglas()}\n`,
);
