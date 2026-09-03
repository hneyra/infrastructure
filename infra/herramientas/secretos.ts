import { emitir, leerAmbiente } from "./emitir-secretos";

/**
 * La entrada de `yarn secretos`. Igual de corta que `emitir.ts`, y por el mismo motivo:
 * la logica vive en `emitir-secretos.ts`, que no escribe nada al importarse, para que
 * `verificaciones/secretos.test.ts` pueda llamarla sin que aparezca un JSON por la
 * salida estandar.
 */
process.stdout.write(emitir(leerAmbiente(process.argv.slice(2))) + "\n");
