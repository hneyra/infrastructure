/* Comprueba que verificar-fila-del-registro.mjs muerde, y que no muerde de mas.

   Una guarda que no puede fallar no protege nada; y una que grita siempre acaba
   esquivada, que en una convencion de proceso es peor todavia — el peaje se aprende a
   rodear y la tabla se queda igual de vacia.

   Asi que se corre la comprobacion contra una lista de situaciones fabricadas, unas que
   tiene que rechazar y otras que tiene que dejar pasar, y se exige que el rechazo
   **nombre el issue y su motivo**: rechazar por el motivo equivocado seria pasar por
   casualidad. **El recuento no se escribe aqui**, lo imprime el final del guion: esta
   frase decia «seis, tres y tres» y la lista tenia siete desde la muestra de la cabecera
   (#114).

   Las cinco ultimas en llegar son de `infrastructure`#165, que porto a esta copia el arreglo
   de `rentas`#130, y miden la SEGUNDA regla del guion: la guarda reconoce `Cierra #N` —el
   idioma de la casa— y GitHub solo auto-cierra con las inglesas, de modo que el PR se mezcla
   en verde y el issue se queda abierto sin que nada lo diga. Van en trio —la que avisa, el
   contraste con `Closes #N` que no debe avisar, y la del cuerpo mixto, que exige que el aviso
   se haga issue a issue— y dos mas para `closed`, `fixed` y `resolved`, que esta copia no
   conocia: una en cada lista del guion. **Y obligaron a que `dice` sea una lista**: con dos
   reglas en el mismo guion, `dice: '#711'` lo satisface cualquiera de las dos y una muestra
   podia ponerse roja por la regla que no era.

   Lo que esta autoprueba NO puede ver es si esta copia del guion sigue siendo la misma que
   las otras cinco: eso lo comprueba `infrastructure`, en
   `infra/verificaciones/las-seis-copias-de-la-guarda-del-registro.test.ts`. Esta dice que la
   copia muerde; aquella, que es la misma copia. Seis copias identicas pueden estar las seis
   rotas, y seis que muerden pueden estar mordiendo cosas distintas.

   Uso: node docs/00-gobierno/verificar-las-muestras-del-registro.mjs
*/

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RUTAS_DE_CODIGO } from './verificar-fila-del-registro.mjs';

const COMPROBACION = fileURLToPath(
  new URL('./verificar-fila-del-registro.mjs', import.meta.url),
);

/** Una fila de la tabla, como la que este mismo PR anade. */
const FILA = '| Lo que se verifico (#711, 3 pruebas) | La rotura | El rojo |';

const CASOS = [
  {
    nombre: 'cierra un issue, toca backend y NO deja fila',
    cuerpo: 'Closes #711.\n\nLo de siempre.',
    archivos: ['librerias-backend/comun-verificaciones/src/main/java/kamayuk/comun/verificaciones/Algo.java'],
    anadido: '',
    esperado: 'rojo',
    dice: ['#711', 'falta la fila'],
  },
  {
    nombre: 'la fila que anade nombra a OTRO issue',
    cuerpo: 'Closes #711',
    archivos: ['infra/componentes/Aplicacion.ts'],
    anadido: '+| Otra cosa (#712) | … | … |',
    esperado: 'rojo',
    dice: ['#711', 'falta la fila'],
  },
  {
    nombre: 'un numero que solo CONTIENE al del issue no cuenta como su fila',
    cuerpo: 'Closes #71',
    archivos: ['despliegue/plataforma.compose.yaml'],
    anadido: '+| Una fila cualquiera (#711) | … | … |',
    esperado: 'rojo',
    dice: ['#71', 'falta la fila'],
  },
  {
    // La destaparon tres carriles a la vez al mudar el registro (#114): la cabecera del
    // archivo nuevo citaba el issue del propio trabajo, y la rotura de control -borrar el
    // registro entero- salia VERDE. Un archivo que explica de donde viene desactivaba la
    // comprobacion.
    nombre: 'una cabecera o un parrafo que citen el issue NO valen como fila',
    cuerpo: 'Closes #71',
    archivos: ['despliegue/plataforma.compose.yaml'],
    anadido: '+# Registro\n+\n+Se mudo aqui por #71, y esto no es una fila.',
    esperado: 'rojo',
    dice: ['#71', 'falta la fila'],
  },
  {
    nombre: 'cierra un issue, toca backend y SI deja su fila',
    cuerpo: 'Closes #711.',
    archivos: ['librerias-backend/comun-verificaciones/src/main/java/kamayuk/comun/verificaciones/Algo.java'],
    anadido: `+${FILA}`,
    esperado: 'verde',
  },
  {
    nombre: 'cierra un issue y NO toca codigo de produccion',
    cuerpo: 'Closes #711.',
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

  {
    /* `rentas`#130, portado a esta copia por `infrastructure`#165. Las tres de aqui abajo miden
       la SEGUNDA regla del guion: la guarda reconoce `Cierra #N` —el idioma de la casa— y GitHub
       solo auto-cierra con las inglesas, asi que el PR se mezcla en verde y el issue se queda
       abierto sin que nada lo diga. Paso de verdad en `rentas`#129 el 2026-09-12.

       **Esta muestra lleva su fila puesta a proposito**: si no, se pondria roja por la regla de
       la fila y no mediria nada de lo nuevo. Y mide dos cosas de una: que el aviso salga, y que
       `cierra` SIGA reconociendose —con la palabra fuera de `CIERRA`, este cuerpo saldria verde
       diciendo «El PR no declara que cierre ningun issue», que es el «Lo que NO entra» de #165:
       el idioma no se toca—. */
    nombre: 'declara el cierre solo en castellano: avisa de que GitHub no lo entiende',
    cuerpo: 'Cierra #711.\n\nLo de siempre.',
    archivos: ['librerias-backend/comun-verificaciones/src/main/java/kamayuk/comun/verificaciones/Algo.java'],
    anadido: `+${FILA}`,
    esperado: 'rojo',
    dice: ['#711', 'GitHub no entiende', 'Closes #711'],
  },
  {
    // El contraste de la de arriba, y es la otra mitad que el AC-5 de `infrastructure`#165 pide
    // medir: la palabra que GitHub SI entiende no dispara nada. Sin el, el arreglo se podria
    // satisfacer gritando siempre que un PR cierra un issue, y una guarda que grita en cada PR
    // se acaba apagando.
    nombre: 'declara el cierre con la palabra que GitHub entiende: no avisa de nada',
    cuerpo: 'Closes #711.\n\nLo de siempre.',
    archivos: ['librerias-backend/comun-verificaciones/src/main/java/kamayuk/comun/verificaciones/Algo.java'],
    anadido: `+${FILA}`,
    esperado: 'verde',
  },
  {
    // Y la precision que el aviso tiene que tener: se mira ISSUE A ISSUE y no «el cuerpo trae
    // alguna palabra buena». Este cuerpo cierra #712 al mezclar y deja #711 abierto, asi que el
    // aviso tiene que nombrar #711 y NO #712 — con la comprobacion hecha por cuerpo, esta muestra
    // sale verde y el issue se queda abierto igual que en `rentas`#129.
    nombre: 'dos issues, uno en cada idioma: solo avisa del que GitHub no entiende',
    cuerpo: 'Cierra #711.\n\nCloses #712.',
    archivos: ['librerias-backend/comun-verificaciones/src/main/java/kamayuk/comun/verificaciones/Algo.java'],
    anadido: `+${FILA}\n+| Y la del otro (#712) | La rotura | El rojo |`,
    esperado: 'rojo',
    dice: ['#711', 'GitHub no entiende'],
    noDice: '#712',
  },
  {
    /* `infrastructure`#165, AC-2. `closed`, `fixed` y `resolved` cierran el issue en GitHub igual
       que `closes`, y hasta #165 esta copia no las conocia: un cuerpo que dijera «Fixed #N» se
       leia como que el PR no cerraba nada y NO EXIGIA FILA — un cierre sin registro, que es justo
       lo que esta guarda existe para impedir. Con las tres fuera de `PALABRAS_DE_GITHUB`, esta
       muestra sale verde con «El PR no declara que cierre ningun issue». */
    nombre: 'cierra con closed, fixed y resolved, toca codigo y NO deja fila: se exige',
    cuerpo: 'Closed #711.\n\nFixed #712.\n\nResolved #713.',
    archivos: ['librerias-backend/comun-verificaciones/src/main/java/kamayuk/comun/verificaciones/Algo.java'],
    anadido: '',
    esperado: 'rojo',
    dice: ['#711', '#712', '#713', 'falta la fila'],
  },
  {
    // Y las mismas tres en la OTRA lista, la de lo que GitHub cierra: con sus filas puestas y el
    // castellano al lado, GitHub cierra los tres issues y no hay nada de que avisar. Sin
    // `closed`, `fixed` y `resolved` en `CIERRA_EN_GITHUB`, esto saldria rojo diciendo que los
    // tres se quedan abiertos, cuando se cierran.
    nombre: 'castellano y closed, fixed y resolved para los mismos issues: no avisa',
    cuerpo: 'Cierra #711, cierra #712 y cierra #713.\n\nClosed #711. Fixed #712. Resolved #713.',
    archivos: ['librerias-backend/comun-verificaciones/src/main/java/kamayuk/comun/verificaciones/Algo.java'],
    anadido: `+${FILA}\n+| La del segundo (#712) | … | … |\n+| La del tercero (#713) | … | … |`,
    esperado: 'verde',
  },
];

/* Y la direccion que faltaba, que es de `rentas`#45: TODO patron de `RUTAS_DE_CODIGO` tiene que
   tener al menos una muestra ROJA que lo ejerza.

   Sin ella, quitar una muestra no pone nada rojo: **deja de comprobarse, en verde**. Medido en
   `rentas` con la de `infrastructure/src/` fuera, la autoprueba decia «Las 7 muestras se
   comportan como deben» y salia con 0 — y peor, su contraste seguia ahi certificando que
   `infrastructure/` fuera de `src/` no cuenta, mientras nadie comprobaba que `src/` si. Es la
   leccion de «una regla sin muestra no protege nada» por el eje de las rutas.

   La lista se LEE del guion y no se copia aqui: una copia se queda vieja sola y entonces esto
   certificaria una lista que ya no es la que corre. Y si viniera vacia, lo de abajo se cumpliria
   sobre el conjunto vacio, asi que se dice y se falla. */
if (RUTAS_DE_CODIGO.length === 0) {
  console.error('MAL: `RUTAS_DE_CODIGO` se leyo vacia, asi que esto no mediria nada.');
  process.exit(2);
}

const sinMuestra = RUTAS_DE_CODIGO.filter(
  (patron) =>
    !CASOS.some(
      (caso) => caso.esperado === 'rojo' && caso.archivos.some((ruta) => patron.test(ruta)),
    ),
);
if (sinMuestra.length > 0) {
  console.error('');
  console.error('MAL: hay rutas de codigo de produccion sin muestra que las ejerza.');
  for (const patron of sinMuestra) {
    console.error(`  · ${patron} no lo toca ninguna muestra que espere rojo.`);
  }
  console.error('');
  console.error('  Una ruta sin muestra no falla: DEJA DE COMPROBARSE, en verde. Anade una');
  console.error('  muestra que toque esa ruta cerrando un issue y sin dejar fila.');
  console.error('');
  process.exit(1);
}

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
  /* `dice` es una LISTA desde `rentas`#130 —en esta copia, desde `infrastructure`#165—, y no por
     comodidad: con dos reglas distintas en el mismo guion —falta la fila, y el cierre que GitHub
     no entiende— un `dice: '#711'` lo satisface cualquiera de las dos, asi que una muestra podia
     ponerse roja por el motivo equivocado y pasar. Cada roja nombra ahora su numero **y su
     motivo**. */
  const dice = [caso.dice ?? []].flat();
  const faltan = dice.filter((texto) => !salida.includes(texto));
  if (esperabaRojo && faltan.length > 0) {
    console.error(`MAL: «${caso.nombre}» se puso rojo sin decir ${faltan.join(' ni ')}.`);
    console.error(salida.trim());
    fallos++;
    continue;
  }
  /* Y la direccion contraria, que hace falta para el aviso del cierre: se mira issue a issue, asi
     que la muestra del cuerpo mixto tiene que nombrar al que se queda abierto y NO al otro. */
  const sobran = [caso.noDice ?? []].flat().filter((texto) => salida.includes(texto));
  if (sobran.length > 0) {
    console.error(`MAL: «${caso.nombre}» nombro ${sobran.join(' y ')}, y no debia.`);
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
console.log(
  `\nLas ${CASOS.length} muestras se comportan como deben, y las ` +
    `${RUTAS_DE_CODIGO.length} rutas`,
);
console.log('declaradas como codigo de produccion tienen quien las ejerza.');
