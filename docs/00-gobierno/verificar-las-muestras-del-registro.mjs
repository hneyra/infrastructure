/* Comprueba que verificar-fila-del-registro.mjs muerde, y que no muerde de mas.

   Una guarda que no puede fallar no protege nada; y una que grita siempre acaba
   esquivada, que en una convencion de proceso es peor todavia — el peaje se aprende a
   rodear y la tabla se queda igual de vacia.

   Asi que se corre la comprobacion contra seis situaciones fabricadas, tres que tiene
   que rechazar y tres que tiene que dejar pasar, y se exige que el rechazo **nombre el
   issue**: rechazar por el motivo equivocado seria pasar por casualidad.

   Uso: node docs/00-gobierno/verificar-las-muestras-del-registro.mjs
*/

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMPROBACION = fileURLToPath(
  new URL('./verificar-fila-del-registro.mjs', import.meta.url),
);

/** Una fila de la tabla, como la que este mismo PR anade. */
const FILA = '| Lo que se verifico (#711, 3 pruebas) | La rotura | El rojo |';

const CASOS = [
  {
    nombre: 'cierra un issue, toca backend y NO deja fila',
    cuerpo: 'Cierra #711.\n\nLo de siempre.',
    archivos: ['librerias-backend/comun-verificaciones/src/main/java/kamayuk/comun/verificaciones/Algo.java'],
    anadido: '',
    esperado: 'rojo',
    dice: '#711',
  },
  {
    nombre: 'la fila que anade nombra a OTRO issue',
    cuerpo: 'Closes #711',
    archivos: ['infra/componentes/Aplicacion.ts'],
    anadido: '+| Otra cosa (#712) | … | … |',
    esperado: 'rojo',
    dice: '#711',
  },
  {
    nombre: 'un numero que solo CONTIENE al del issue no cuenta como su fila',
    cuerpo: 'Cierra #71',
    archivos: ['despliegue/plataforma.compose.yaml'],
    anadido: '+| Una fila cualquiera (#711) | … | … |',
    esperado: 'rojo',
    dice: '#71',
  },
  {
    nombre: 'cierra un issue, toca backend y SI deja su fila',
    cuerpo: 'Cierra #711.',
    archivos: ['librerias-backend/comun-verificaciones/src/main/java/kamayuk/comun/verificaciones/Algo.java'],
    anadido: `+${FILA}`,
    esperado: 'verde',
  },
  {
    nombre: 'cierra un issue y NO toca codigo de produccion',
    cuerpo: 'Cierra #711.',
    archivos: [
      'docs/00-gobierno/algo.md',
      'librerias-backend/comun-verificaciones/src/test/java/kamayuk/comun/AlgoTest.java',
    ],
    anadido: '',
    esperado: 'verde',
  },
  {
    nombre: 'toca backend y no declara que cierre nada',
    cuerpo: 'Un arreglo suelto, sin issue.',
    archivos: ['librerias-backend/comun-verificaciones/src/main/java/kamayuk/comun/verificaciones/Algo.java'],
    anadido: '',
    esperado: 'verde',
  },
];

const carpeta = mkdtempSync(join(tmpdir(), 'kamayuk-711-'));
let fallos = 0;

for (const caso of CASOS) {
  const cuerpo = join(carpeta, 'cuerpo.txt');
  const archivos = join(carpeta, 'archivos.txt');
  const anadido = join(carpeta, 'anadido.txt');
  writeFileSync(cuerpo, caso.cuerpo);
  writeFileSync(archivos, caso.archivos.join('\n'));
  writeFileSync(anadido, caso.anadido);

  let salida = '';
  let codigo = 0;
  try {
    salida = execFileSync(
      'node',
      [COMPROBACION, '--cuerpo', cuerpo, '--archivos', archivos, '--anadido', anadido],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (fallo) {
    codigo = fallo.status ?? -1;
    salida = `${fallo.stdout ?? ''}${fallo.stderr ?? ''}`;
  }

  const fueRojo = codigo !== 0;
  const esperabaRojo = caso.esperado === 'rojo';
  if (fueRojo !== esperabaRojo) {
    console.error(`MAL: «${caso.nombre}» esperaba ${caso.esperado} y salio lo contrario.`);
    console.error(salida.trim());
    fallos++;
    continue;
  }
  if (esperabaRojo && !salida.includes(caso.dice)) {
    console.error(`MAL: «${caso.nombre}» se puso rojo sin nombrar ${caso.dice}.`);
    console.error(salida.trim());
    fallos++;
    continue;
  }
  console.log(`OK (${caso.esperado}): ${caso.nombre}`);
}

if (fallos > 0) {
  console.error(`\nFALLO: ${fallos} de ${CASOS.length} muestras no se comportan como deben.`);
  process.exit(1);
}
console.log(`\nLas ${CASOS.length} muestras se comportan como deben.`);
