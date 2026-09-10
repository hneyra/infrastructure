import { ENVIRONMENTS, type Environment } from "../config";
import { espaciosConCredencialDeRegistro } from "../verificaciones/imagenes-publicadas";

/**
 * Los espacios de nombres de un ambiente cuyo `ServiceAccount` `default` lleva la credencial de
 * `ghcr.io`, uno por linea.
 *
 *   yarn espacios-con-credencial --ambiente stg
 *
 * ## Por que existe, y por que no es una lista en un guion de shell
 *
 * `comprobar-imagenes.sh` tiene que contestar «¿puede ese pod bajarse esa imagen?», y eso son dos
 * cosas: si la imagen es privada —lo dice el registro— y si el espacio de nombres donde vive el
 * pod tiene credencial —lo dice este repositorio—. La segunda la tenia **escrita a mano** con la
 * forma `espacio == "kamayuk-<ambiente>"`, que era cierta mientras la credencial llegaba a un solo
 * sitio; desde que llega a los seis, esa linea diria que cinco de cada seis pods no pueden bajar
 * nada y el guion saldria rojo sobre un despliegue correcto.
 *
 * Escribir la lista buena en el guion seria el mismo defecto un ano mas tarde: un segundo sitio
 * con la misma verdad, y el que se queda viejo el dia que entre un sexto sistema. Asi que el
 * guion **pregunta**, y quien contesta es la misma funcion que la prueba usa —la que lee de
 * `index.ts` de donde saca sus espacios y **ejecuta** esa derivacion—.
 *
 * Es la forma que #15/#16 dejaron escrita para `infra/bases.sh`: dos lenguajes, una sola fuente,
 * y ningun sitio donde puedan discrepar en silencio.
 */

function opcion(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const ambiente = (opcion("ambiente") ?? "") as Environment;
if (!ENVIRONMENTS.includes(ambiente)) {
  console.error(`uso: yarn espacios-con-credencial --ambiente <${ENVIRONMENTS.join("|")}>`);
  process.exit(2);
}

// Si `index.ts` dejara de crearla en la forma que la guarda sabe leer, esto LANZA y el guion que
// lo invoca sale con codigo distinto de cero. Imprimir una lista vacia seria contestar «ningun
// espacio tiene credencial» a una pregunta que no se ha podido mirar.
for (const espacio of espaciosConCredencialDeRegistro(ambiente)) {
  console.log(espacio);
}
