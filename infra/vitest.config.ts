import { defineConfig } from "vitest/config";

// Las pruebas de esta carpeta no levantan Pulumi ni tocan un clúster: cubren las
// invariantes puras de `config.ts` y comprueban que las reglas de ESLint muerden.
// Son las que impiden que una configuración que contradice la documentación llegue
// a `pulumi up`.
export default defineConfig({
  test: {
    include: ["config.test.ts", "verificaciones/**/*.test.ts"],
    environment: "node",

    // ## El tope por prueba, y por que no es el de vitest
    //
    // Muchas de estas pruebas son de ENTRADA/SALIDA y no de logica: recorren los seis arboles
    // leyendo cada archivo de codigo de produccion, ejecutan guiones de shell de verdad,
    // invocan ESLint sobre muestras, y esperan bucles de reintento. Lo que tardan depende de la
    // maquina y de lo que este haciendo a la vez, no de lo que afirman.
    //
    // Medido en esta maquina, con la maquina ociosa:
    //
    //   api-que-no-contesta            4 533 ms   (ejecuta el guion con un `kubectl` de mentira)
    //   sin-el-nombre-del-monolito     2 079 ms   (lee los seis arboles)
    //   reglas-de-eslint               2 168 ms   (invoca ESLint por prohibicion)
    //   puerto-del-motor               3 845 ms   (espera a que un puerto se suelte de verdad)
    //
    // Contra los **5 000 ms** por omision de vitest, las cuatro viven al borde. Con algo pesado
    // al lado —la plataforma local levantada, un `build` de Gradle, consultas a un cluster—
    // cruzan el tope y salen rojas **por tiempo agotado y no por su asercion**, y cada corrida
    // senala unas distintas: es lo que lo delato. El registro de #70 ya lo habia medido —«cinco
    // pruebas que se caen por CARGA de CPU y no por defecto»— y no se habia arreglado.
    //
    // Un rojo que aparece y desaparece segun lo que corra al lado no senala nada: produce un
    // «Test timed out in 5000ms» sobre la linea del `it`, indistinguible de un defecto real, y
    // manda a leer una asercion que nunca llego a evaluarse. Entrena a mirar los rojos como
    // ruido, que es lo caro.
    //
    // Va AQUI y no como `}, 30_000)` en cada `describe`, y eso tambien se aprendio
    // equivocandose: puesto prueba a prueba hay que acertar cual se cae —el primer intento lo
    // puso en el `it` de al lado y el sintoma no cambio, con el tope escrito catorce lineas mas
    // abajo y pareciendo puesto— y el conjunto inestable resulto ser mayor que el que se veia.
    //
    // Con 30 s, si una de estas sale roja es porque encontro algo. La suite entera tarda ~45 s,
    // asi que una prueba que de verdad se cuelgue sigue reportando pronto.
    testTimeout: 30_000,
  },
});
