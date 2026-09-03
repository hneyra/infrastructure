import { emitir, leerOpciones } from "./emitir-manifiestos";

/**
 * La entrada de `yarn manifiestos`. Tres lineas, y a proposito.
 *
 * La logica vive en `emitir-manifiestos.ts`, que no escribe nada al importarse: asi las
 * pruebas pueden llamarla sin que aparezca un JSON por la salida estandar. Un guardia
 * del tipo `require.main === module` no serviria aqui —el mismo archivo lo carga
 * ts-node como CommonJS y vitest como modulo ES, y cada uno tiene solo la mitad de esa
 * expresion—, y un archivo de entrada separado no tiene ese problema.
 */
process.stdout.write(emitir(leerOpciones(process.argv.slice(2))) + "\n");
