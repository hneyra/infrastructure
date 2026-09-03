import { completarSecreto, huella, manifiestoDeSecreto } from "./completar-secreto";

/**
 * La entrada de `bootstrap-secretos.sh`. Tres cosas, y a proposito:
 *
 *   uso: <secreto existente, o vacio> | vite-node completar-secreto-cli.ts <nombre> <namespace> <clave...>
 *
 * Lee el `Secret` existente (o nada) de la entrada estandar, completa lo que falte y
 * escribe el manifiesto resultante por la salida estandar — listo para
 * `kubectl apply -f -`. Nunca imprime un valor: lo que va a stderr son huellas.
 *
 * Sin guardia de "solo si me ejecutan directamente": es un archivo de entrada, como
 * `emitir.ts` y `secretos.ts`. La logica que se puede probar vive en
 * `completar-secreto.ts`, que no ejecuta nada al importarse.
 */

function leerEntradaEstandar(): Promise<string> {
  return new Promise((resolve, reject) => {
    let datos = "";
    process.stdin.on("data", (trozo) => (datos += trozo));
    process.stdin.on("end", () => resolve(datos));
    process.stdin.on("error", reject);
  });
}

async function principal(): Promise<void> {
  const [nombre, namespace, ...requeridas] = process.argv.slice(2);
  if (!nombre || !namespace || requeridas.length === 0) {
    throw new Error(
      "uso: completar-secreto-cli.ts <nombre> <namespace> <clave...>, con el Secret " +
        "existente (o vacio) en la entrada estandar",
    );
  }

  const entrada = (await leerEntradaEstandar()).trim();
  const existente = entrada ? (JSON.parse(entrada) as { data?: Record<string, string> }) : undefined;

  const resultado = completarSecreto(existente, requeridas);
  const manifiesto = manifiestoDeSecreto({ nombre, namespace, data: resultado.data });

  process.stdout.write(JSON.stringify(manifiesto) + "\n");
  for (const clave of resultado.generadas) {
    process.stderr.write(`  · ${nombre}/${clave}: generada (huella ${huella(resultado.data[clave]!)})\n`);
  }
}

principal().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
