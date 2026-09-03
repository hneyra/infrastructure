/* Comprueba que un PR que cierra un issue deja su fila en «Verificar antes de afirmar».

   `CLAUDE.md` §«Verificar antes de afirmar» es la memoria del proyecto: cada issue
   deja ahi que se implemento y **como se demostro que la verificacion puede fallar**.
   Es lo que impide volver a descubrir el mismo hallazgo de RLS por tercera vez.

   Y no la comprobaba nadie. Al integrar #585 y #618 la fila no se escribio y los dos
   PR pasaron todos sus checks en verde; el hueco se descubrio a mano, leyendo la
   tabla. El modo de fallo es silencioso: la fila que falta no se distingue de la que
   nadie tenia que escribir.

   ## Que exige, y que NO

   Exige que **exista** una fila que nombre el issue. No mira su contenido —que la
   mutacion descrita sea real, que las cifras cuadren— porque eso no lo puede leer una
   maquina, y es justo lo que la revision si puede.

   Y solo lo exige cuando las dos cosas son ciertas:

     1. el cuerpo del PR declara que cierra un issue (`Cierra #N`, `Closes #N`,
        `Fixes #N`, `Resuelve #N`), y
     2. el cambio toca el codigo de produccion del backend, del frontend o de infra.

   Un PR de solo documentacion, de solo pruebas o sin issue asociado pasa en verde. Sin
   ese contraste la guarda seria un peaje que todo el mundo aprende a esquivar — y una
   guarda esquivada no protege nada, que es de donde venimos.

   ## De donde viene, y que cambia aqui

   Copiada de `sgtm`, donde nacio con #711. Lo unico que cambia es QUE cuenta como
   codigo de produccion en ESTE repositorio —la lista `RUTAS_DE_CODIGO` de abajo— y el
   nombre de la variable de entorno, que aqui es `KAMAYUK_CUERPO_DEL_PR`. La tabla que
   protege es la de `CLAUDE.md`, que en este repositorio **nace vacia**: el registro
   anterior es historia de `sgtm` y no viaja.

   ## Uso

     node docs/00-gobierno/verificar-fila-del-registro.mjs [--base origin/main]

   El cuerpo del PR sale de `KAMAYUK_CUERPO_DEL_PR`; sin esa variable no hay nada que
   comprobar y la comprobacion pasa, porque fuera de un PR no existe el dato.

   Las tres entradas se pueden dar por archivo —`--cuerpo`, `--archivos`, `--anadido`—,
   y es lo que usa su autoprueba: sin poder alimentarlas, demostrar que muerde exigiria
   fabricar un repositorio, y una comprobacion que no se puede probar es la que este
   issue viene a impedir.
*/

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Lo que hace de un cambio «codigo» a efectos de esta guarda. */
const RUTAS_DE_CODIGO = [
  /^infra\/(?!README)/,
  /^librerias-backend\/[^/]+\/src\/main\//,
  /^despliegue\//,
];

/** Como se declara que un PR cierra un issue. GitHub admite estas y alguna mas. */
const CIERRA = /\b(?:cierra|closes?|close|fixes?|fix|resuelve|resolves?)\s+#(\d+)/gi;

const opciones = leerOpciones(process.argv.slice(2));

const cuerpo = opciones.cuerpo
  ? readFileSync(opciones.cuerpo, 'utf8')
  : (process.env.KAMAYUK_CUERPO_DEL_PR ?? '');

const issues = [...cuerpo.matchAll(CIERRA)].map((coincidencia) => coincidencia[1]);
if (issues.length === 0) {
  console.log('El PR no declara que cierre ningun issue: no hay fila que exigir.');
  process.exit(0);
}

const archivos = opciones.archivos
  ? lineas(readFileSync(opciones.archivos, 'utf8'))
  : lineas(git(['diff', '--name-only', `${opciones.base}...HEAD`]));

const deCodigo = archivos.filter((ruta) => RUTAS_DE_CODIGO.some((patron) => patron.test(ruta)));
if (deCodigo.length === 0) {
  console.log(
    `Cierra #${issues.join(', #')} y no toca codigo de produccion: la fila no se exige.`,
  );
  process.exit(0);
}

const anadido = opciones.anadido
  ? readFileSync(opciones.anadido, 'utf8')
  : git(['diff', `${opciones.base}...HEAD`, '--', 'CLAUDE.md'])
      .split('\n')
      .filter((linea) => linea.startsWith('+') && !linea.startsWith('+++'))
      .join('\n');

const sinFila = issues.filter((numero) => !nombra(anadido, numero));
if (sinFila.length > 0) {
  console.error('');
  console.error('FALLO: falta la fila de «Verificar antes de afirmar» en CLAUDE.md.');
  console.error('');
  for (const numero of sinFila) {
    console.error(`  · Este PR cierra #${numero} y CLAUDE.md no gana ninguna linea que lo nombre.`);
  }
  console.error('');
  console.error('  Esa tabla es la memoria del proyecto: cada issue deja ahi que se');
  console.error('  implemento y COMO SE DEMOSTRO QUE LA VERIFICACION PUEDE FALLAR. Una fila');
  console.error('  que no se escribe es una leccion que el siguiente vuelve a descubrir');
  console.error('  ejecutando.');
  console.error('');
  console.error('  Lo que se comprueba aqui es solo que la fila EXISTA. Que diga la verdad');
  console.error('  —que la mutacion sea real y las cifras cuadren— lo lee la revision.');
  console.error('');
  console.error(`  Archivos de codigo en este cambio: ${deCodigo.length}`);
  console.error(`    ${deCodigo.slice(0, 5).join('\n    ')}`);
  process.exit(1);
}

console.log(`Cada issue que este PR cierra tiene su fila: #${issues.join(', #')}.`);

// ---------------------------------------------------------------------------

/** Si ese texto nombra al issue como tal y no como parte de otro numero. */
function nombra(texto, numero) {
  return new RegExp(`#${numero}(?![0-9])`).test(texto);
}

function lineas(texto) {
  return texto
    .split('\n')
    .map((linea) => linea.trim())
    .filter((linea) => linea.length > 0);
}

function git(argumentos) {
  return execFileSync('git', argumentos, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function leerOpciones(argumentos) {
  const opciones = { base: 'origin/main' };
  for (let i = 0; i < argumentos.length; i += 2) {
    const nombre = argumentos[i];
    const valor = argumentos[i + 1];
    if (valor === undefined) {
      throw new Error(`Falta el valor de ${nombre}`);
    }
    if (!['--base', '--cuerpo', '--archivos', '--anadido'].includes(nombre)) {
      throw new Error(`Opcion desconocida: ${nombre}`);
    }
    opciones[nombre.slice(2)] = valor;
  }
  return opciones;
}
