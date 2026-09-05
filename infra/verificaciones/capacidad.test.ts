import { describe, expect, it } from "vitest";
import {
  auditarCapacidad,
  cpuEnMili,
  demandaDelStack,
  memoriaEnMi,
  type CapacidadDelNodo,
} from "../capacidad";
import { construirManifiestos } from "../componentes";
import { ENVIRONMENTS, type Environment } from "../config";
import { manifiestosDelAmbiente } from "../herramientas/emitir-manifiestos";
import { namespaceName } from "../config";
import { entornoDelAmbiente } from "../herramientas/emitir-manifiestos";
import { SISTEMAS } from "../descriptor/sistemas";
import { invariantesDe } from "./stacks";

/**
 * Que el stack de cada ambiente quepa en el nodo que ese ambiente declara.
 *
 * **La regresion que esta prueba existe para atrapar ya ocurrio, dos veces.** La
 * segunda —2026-08-25— dejo `aplicar-prod` colgado en cuatro corridas seguidas sin un
 * solo mensaje de error: `pulumi up` esperaba a `Deployment` que nunca quedarian
 * `Ready` porque sus pods no cabian. La cabecera de `capacidad.ts` cuenta las dos.
 *
 * Corre sin Pulumi, sin tunel y sin VPS, como el resto de `verificaciones/`: la cifra
 * del nodo es un dato del stack y lo que el stack pide se lee de los manifiestos.
 */

const nodoDe = (ambiente: Environment): CapacidadDelNodo => {
  const invariantes = invariantesDe(ambiente);
  return {
    cpuAsignable: invariantes.node.allocatableCpu,
    memoriaAsignable: invariantes.node.allocatableMemory,
  };
};

/**
 * **Todo lo que el ambiente pone sobre el nodo**, no la plataforma sola.
 *
 * Hasta C-16 esto era `construirManifiestos(...)` a secas, y con ello la aritmetica se media
 * contra UNO de los cinco espacios de nombres. El nodo es uno: los cuatro sistemas de
 * ADR-0031 tienen namespace propio y sus pods compiten por la misma CPU y la misma memoria.
 */
const manifiestosDe = (ambiente: Environment) => manifiestosDelAmbiente(invariantesDe(ambiente));

/**
 * **Solo el monolito**, sin los cuatro sistemas.
 *
 * Los tres casos historicos de abajo —el nodo justo de 1 900m, los 2 CPU que `prod` reparte
 * hoy y los 3 que dejaria la reserva repartida— afirman cosas del MONOLITO, medidas cuando era
 * lo unico que habia sobre el nodo, y siguen siendo ciertas de el. Se nombra aparte en vez de
 * actualizar sus cifras: la afirmacion «prod cabe en 2 CPU» no se ha vuelto falsa, ha dejado de
 * ser la respuesta a «¿cabe el ambiente?» — y esa segunda pregunta la contesta `manifiestosDe`,
 * con la brecha declarada de #1.
 */
const soloElMonolitoDe = (ambiente: Environment) => construirManifiestos(invariantesDe(ambiente));

describe("las cantidades de Kubernetes se leen como las lee Kubernetes", () => {
  it("CPU: milicores, enteros y decimales", () => {
    expect(cpuEnMili("500m")).toBe(500);
    expect(cpuEnMili("2")).toBe(2000);
    expect(cpuEnMili("0.5")).toBe(500);
    expect(cpuEnMili(undefined)).toBe(0);
  });

  it("memoria: los sufijos binarios, y el `Ki` que devuelve el API server", () => {
    expect(memoriaEnMi("64Mi")).toBe(64);
    expect(memoriaEnMi("1Gi")).toBe(1024);
    // El valor real de `vmd120205`, el que hay que poder pegar sin convertir a mano.
    expect(Math.round(memoriaEnMi("6029348Ki"))).toBe(5888);
  });

  it("un sufijo que no existe no se interpreta como bytes: lanza", () => {
    // Tragarse una unidad desconocida como bytes convertiria «6029348Kb» en 5 Mi y el
    // nodo pareceria diminuto; peor todavia al reves, con una cifra que sobrevalore.
    expect(() => memoriaEnMi("10Xi")).toThrow(/Sufijo de memoria desconocido/);
  });
});

describe("lo que pide el stack", () => {
  it("un pod reserva el maximo entre sus contenedores y su initContainer, no la suma", () => {
    // La regla de Kubernetes de verdad: los `initContainer` corren antes y de uno en
    // uno. Sumarlos inflaria la demanda de `aplicacion` —que tiene un initContainer de
    // espera— y haria fallar ambientes que si caben.
    const demanda = demandaDelStack([
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name: "ejemplo", namespace: "n", labels: {} },
        spec: {
          replicas: 1,
          strategy: { type: "RollingUpdate" },
          selector: { matchLabels: {} },
          template: {
            metadata: { labels: {} },
            spec: {
              priorityClassName: "p",
              initContainers: [
                {
                  name: "espera",
                  image: "i",
                  resources: {
                    requests: { cpu: "10m", memory: "32Mi" },
                    limits: { cpu: "1", memory: "1Gi" },
                  },
                },
              ],
              containers: [
                {
                  name: "principal",
                  image: "i",
                  resources: {
                    requests: { cpu: "500m", memory: "1Gi" },
                    limits: { cpu: "1", memory: "2Gi" },
                  },
                },
              ],
            },
          },
        },
      },
    ]);
    expect(demanda.permanente.cpuEnMili).toBe(500);
    expect(demanda.permanente.memoriaEnMi).toBe(1024);
  });

  it("el pico del arranque cuenta los Jobs; lo permanente, no", () => {
    const demanda = demandaDelStack(manifiestosDe("prod"));
    // Los Jobs de migracion e implantacion piden 1 CPU cada uno y se crean a la vez
    // que los Deployment: son la diferencia entre las dos cifras, y son justo lo que
    // hace que el nodo no de abasto en el momento del despliegue.
    expect(demanda.picoDeArranque.cpuEnMili).toBeGreaterThan(demanda.permanente.cpuEnMili);
  });

  it("un CronJob suspendido no ocupa nada: el de `lote` espera a D-02a", () => {
    const conSuspendido = demandaDelStack(manifiestosDe("prod"));
    const lote = conSuspendido.pods.find((p) => p.contexto.includes("lote"));
    expect(lote).toBeUndefined();
  });
});

describe("cada ambiente cabe en el nodo que declara", () => {
  for (const ambiente of ENVIRONMENTS) {
    const brecha = invariantesDe(ambiente).node.capacityGapIssue;

    if (brecha === undefined) {
      it(`«${ambiente}» cabe`, () => {
        expect(auditarCapacidad(manifiestosDe(ambiente), nodoDe(ambiente))).toEqual([]);
      });
      continue;
    }

    /**
     * El otro lado de `nodeCapacityGapIssue`, y lo que impide que sea un interruptor
     * para silenciar la comprobacion: un ambiente que declara la brecha tiene que
     * **seguir sin caber**. El dia que el nodo crezca —o que la demanda baje— esto se
     * pone rojo y obliga a retirar la marca del stack, en vez de dejarla puesta
     * tapando lo siguiente que no quepa.
     */
    it(`«${ambiente}» declara la brecha del issue #${brecha}, y la brecha sigue ahi`, () => {
      const problemas = auditarCapacidad(manifiestosDe(ambiente), nodoDe(ambiente));
      expect(
        problemas,
        `«${ambiente}» ya cabe en su nodo: retira \`nodeCapacityGapIssue\` de ` +
          `Pulumi.${ambiente}.yaml y cierra el issue #${brecha}.`,
      ).not.toEqual([]);
      expect(brecha).toMatch(/^\d+$/);
    });
  }
});

describe("y se demuestra que puede fallar", () => {
  /**
   * La configuracion EXACTA que colgo `aplicar-prod` cuatro veces el 25 y 26 de agosto
   * de 2026: `webReplicas: 2` contra los 2 CPU que la reserva duplicada dejo en el
   * nodo. Aqui tiene que ponerse roja.
   *
   * Se construye a proposito en vez de leer `Pulumi.prod.yaml`: el stack real ya no es
   * asi —y por eso hoy despliega—, pero el caso historico tiene que seguir detectandose
   * el dia que alguien devuelva las dos replicas sin mirar el nodo.
   */
  it("la configuracion que colgo prod en agosto de 2026 NO cabe", () => {
    const invariantes = invariantesDe("prod");
    const conDosReplicas = construirManifiestos({
      ...invariantes,
      application: { ...invariantes.application, webReplicas: 2 },
    });

    const problemas = auditarCapacidad(conDosReplicas, {
      cpuAsignable: "2",
      memoriaAsignable: "6029348Ki",
    });
    expect(problemas.length).toBeGreaterThan(0);
    expect(problemas.join("\n")).toMatch(/no cabe en el nodo por CPU/);
    // El mensaje tiene que decir CUANTO falta: «no cabe» sin la cifra no dice si el
    // arreglo es una replica menos o un nodo entero mas.
    expect(problemas.join("\n")).toMatch(/Faltan \d+m/);
  });

  /**
   * Por que se comprueba el PICO y no lo permanente, con el caso que lo demuestra.
   *
   * Se elige un nodo deliberadamente justo —1 900m asignables— porque es donde los dos
   * numeros se separan: lo permanente de `prod` (1 540m) entra, y el pico del arranque
   * (1 760m) no. Un `pulumi up` contra un nodo asi no daria ningun sintoma util: el
   * sistema en regimen cabe, y lo que no entra son los dos Jobs que solo existen
   * durante el despliegue. Se colgaria igual, y mirando `kubectl top` despues no se
   * veria nada raro.
   *
   * Si `auditarCapacidad` mirase lo permanente, este caso pasaria en verde y el
   * despliegue se colgaria de todos modos. Es justo la confusion que la cabecera de
   * `capacidad.ts` describe, escrita como prueba.
   */
  it("lo permanente del monolito cabe y su pico no: por eso se mide el pico", () => {
    const nodoJusto = { cpuAsignable: "1900m", memoriaAsignable: "6029348Ki" };
    const demanda = demandaDelStack(soloElMonolitoDe("prod"));
    // 1 700m: los 1 900m asignables menos lo que los pods de serie de k3s ya ocupan.
    const disponible = 1900 - 200;

    expect(demanda.permanente.cpuEnMili).toBeLessThanOrEqual(disponible);
    expect(demanda.picoDeArranque.cpuEnMili).toBeGreaterThan(disponible);
    expect(auditarCapacidad(soloElMonolitoDe("prod"), nodoJusto).join("\n")).toMatch(
      /no cabe en el nodo por CPU/,
    );
  });

  /**
   * Y el caso que de verdad importa hoy: `prod` cabe en el nodo TAL COMO ESTA, con su
   * reserva todavia duplicada. Es lo que separa «desplegable» de «desplegable cuando
   * alguien entre al VPS».
   */
  it("el monolito de prod cabe en los 2 CPU que el nodo reparte hoy", () => {
    expect(
      auditarCapacidad(soloElMonolitoDe("prod"), {
        cpuAsignable: "2",
        memoriaAsignable: "6029348Ki",
      }),
    ).toEqual([]);
  });

  /**
   * Y el otro lado: con la reserva ya repartida, `prod` cabe.
   *
   * Esto es lo que ata `Pulumi.prod.yaml` al guion del nodo. El dia que alguien
   * devuelva la duplicacion —o suba la demanda— una de las dos mitades se pone roja.
   */
  it("con los 3 CPU que deja la reserva repartida, el monolito de prod cabe", () => {
    expect(
      auditarCapacidad(soloElMonolitoDe("prod"), {
        cpuAsignable: "3",
        memoriaAsignable: "6029348Ki",
      }),
    ).toEqual([]);
  });

  /**
   * La memoria es lo que fija `webReplicas: 1` en `prod`, y conviene que se vea.
   *
   * Con dos replicas el pico pedia 6 368Mi contra los 5 728Mi disponibles: no es una
   * preferencia, es que no entra en los ~6 GB que el nodo reparte.
   */
  it("dos replicas no caben en los ~6 GB de prod, y por eso va con una", () => {
    const invariantes = invariantesDe("prod");
    const conDos = construirManifiestos({
      ...invariantes,
      application: { ...invariantes.application, webReplicas: 2 },
    });
    expect(
      auditarCapacidad(conDos, { cpuAsignable: "3", memoriaAsignable: "6029348Ki" }).join("\n"),
    ).toMatch(/no cabe en el nodo por memoria/);
  });

  it("con 4 GB —el nodo que el issue #158 ya probo insuficiente—, NO cabe por memoria", () => {
    const problemas = auditarCapacidad(soloElMonolitoDe("prod"), {
      cpuAsignable: "16",
      memoriaAsignable: "4Gi",
    });
    expect(problemas.join("\n")).toMatch(/no cabe en el nodo por memoria/);
  });

  it("subir `webReplicas` por encima de lo que el nodo aguanta se pone rojo", () => {
    // La comprobacion no vive solo para el nodo que hay hoy: tiene que morder tambien
    // cuando alguien sube la demanda contra un nodo que antes bastaba.
    const invariantes = invariantesDe("prod");
    const manifiestos = construirManifiestos({
      ...invariantes,
      application: { ...invariantes.application, webReplicas: 40 },
    });
    expect(auditarCapacidad(manifiestos, { cpuAsignable: "16", memoriaAsignable: "64Gi" })).not
      .toEqual([]);
  });

  it("un nodo holgado no inventa problemas", () => {
    // El otro lado de la demostracion: si esto tambien saliera rojo, la comprobacion
    // no estaria midiendo nada, solo diciendo que no a todo.
    expect(
      auditarCapacidad(manifiestosDe("prod"), { cpuAsignable: "8", memoriaAsignable: "16Gi" }),
    ).toEqual([]);
  });
});

/**
 * C-16: que la cuenta cubra **todos** los espacios de nombres del ambiente.
 *
 * Esta guarda no comprueba una aritmetica: comprueba que la aritmetica se aplique a todo. Es
 * la clase de defecto que C-16 se pago — `manifiestosDeLosSistemas` se extrajo en C-14 «para
 * que `capacidad.ts` pueda sumarlos» y el llamador nunca se cambio, asi que `yarn capacidad`
 * contestaba «cabe» habiendo mirado uno de los cinco espacios de nombres—. Ninguna de las
 * pruebas de arriba podia verlo: todas miden lo que se les da.
 *
 * Se compara contra los namespaces **derivados de la misma fuente que compone el despliegue**
 * —`namespaceName` para la plataforma y `entornoDe(...).namespace` para cada sistema—, no
 * contra una lista escrita a mano: un sistema nuevo entra solo en la cuenta esperada, que es
 * lo unico que hace que esta guarda siga valiendo cuando haya cinco.
 */
describe("C-16 · la cuenta cubre TODOS los espacios de nombres del ambiente", () => {
  it.each(ENVIRONMENTS)("«%s»: la plataforma y los cuatro sistemas, sin dejarse ninguno", (ambiente) => {
    const entornoDe = entornoDelAmbiente(invariantesDe(ambiente));
    const esperados = [
      namespaceName(ambiente),
      ...SISTEMAS.map(({ descriptor }) => entornoDe(descriptor.sistema).namespace),
    ].sort();

    const medidos = [
      ...new Set(demandaDelStack(manifiestosDe(ambiente)).pods.map((p) => p.espacio)),
    ].sort();

    expect(
      medidos,
      "la cuenta de capacidad se esta dejando fuera algun espacio de nombres del ambiente. " +
        "El nodo es UNO: un namespace no es una maquina, y sus pods compiten por la misma CPU " +
        "y la misma memoria. Decir «cabe» sin haberlos sumado todos devuelve el colgado del " +
        "issue #252 con la guarda en verde.",
    ).toEqual(esperados);
  });

  it("y son cinco, no uno: la comprobacion de arriba no puede pasar por lista vacia", () => {
    const medidos = new Set(demandaDelStack(manifiestosDe("prod")).pods.map((p) => p.espacio));
    expect(medidos.size).toBe(1 + SISTEMAS.length);
  });
});
