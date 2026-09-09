import { describe, expect, it } from "vitest";
import {
  SISTEMAS,
  dependenciasDeclaradas,
  grafoDeEgreso,
  sistemaDeCadaNamespace,
} from "../descriptor/sistemas";
import type { DescriptorDeSistema, EntornoDelDescriptor } from "../descriptor/tipos";
import type { NetworkPolicy } from "../componentes/tipos";
import { entornoDelAmbiente } from "../herramientas/emitir-manifiestos";
import { invariantesDe } from "./stacks";

/**
 * AC-7 de `identidad`#1 — **el grafo de egreso distingue la plataforma por el NAMESPACE de
 * destino, y no por el nombre de la etiqueta**.
 *
 * ## El defecto, y por que hoy no se ve
 *
 * `grafoDeEgreso` llevaba `const infraestructura = ["postgres", "identidad"]` y descartaba toda
 * arista cuyo `podSelector` llevara una de esas dos etiquetas. Funcionaba porque en la plataforma
 * `identidad` significa **Keycloak** —lo etiqueta asi `componentes/Identidad.ts`— y ningun
 * sistema se llamaba igual. `ADR-0039` trae uno que si.
 *
 * **Medido: con los descriptores de hoy, los dos criterios dan EXACTAMENTE el mismo grafo.**
 * Devolver el filtro viejo deja `yarn grafo --ambiente stg` imprimiendo las mismas seis aristas y
 * los mismos cinco nodos, porque en la etapa 1 nadie declara todavia una arista hacia
 * `identidad` y los pods de ese sistema llevan `componente: identidad-sistema`. O sea que **el
 * defecto es latente**: aparece el dia de la etapa 4, cuando los cuatro lean de alli, y entonces
 * el grafo dira que a `identidad` no lo llama nadie mientras los cuatro lo llaman. No es un error
 * que se vea: es un grafo que miente.
 *
 * Por eso lo que se mide aqui son DOS cosas que ninguna sola cubre:
 *
 *  1. **sobre los descriptores de verdad**, que el grafo no se movio y que el quinto sistema
 *     aparece como nodo —sin aristas hacia hermanos, que es una afirmacion de su descriptor—;
 *  2. **sobre un descriptor fabricado**, que es lo unico que separa los dos criterios: uno cuyos
 *     pods lleven `componente: identidad` y que declare una arista hacia el namespace de un
 *     hermano. El criterio por namespace la ve; el de por nombre la descarta.
 */

const AMBIENTE = "stg";
const entornoDe = entornoDelAmbiente(invariantesDe(AMBIENTE));
const DEL_NAMESPACE = sistemaDeCadaNamespace(entornoDe);

/**
 * El criterio ANTERIOR, escrito aqui para poder contrastarlo.
 *
 * Vive en la prueba y no en produccion a proposito: lo que se compara es el comportamiento de
 * los dos, y tener el viejo importable seria dejar puesto lo que este cambio retira.
 */
function dependenciasPorNombreDeEtiqueta(
  descriptor: DescriptorDeSistema,
  entorno: EntornoDelDescriptor,
): string[] {
  const infraestructura = ["postgres", "identidad"];
  return descriptor
    .egreso(entorno)
    .flatMap((p) => p.spec.egress ?? [])
    .flatMap((r) => r.to ?? [])
    .map((s) => s.podSelector?.matchLabels?.["componente"])
    .filter((c): c is string => c !== undefined && !infraestructura.includes(c))
    .sort();
}

/**
 * Un sistema fabricado con la colision dentro: sus pods llevan `componente: identidad` —que en la
 * plataforma es Keycloak— y declara UNA arista, hacia el namespace de `rentas`.
 *
 * Es el minimo que separa los dos criterios. No se toca ningun clon para producirlo: se compone
 * a partir del descriptor REAL de `identidad` cambiandole solo el egreso, igual que
 * `descriptor/muestras/` fabrica los cinco prohibidos. Partir de uno real y no de un objeto a
 * medias es lo que impide que esta muestra deje de compilar el dia que el contrato crezca — y
 * lo que hace que lo unico distinto sea justo lo que se mide.
 */
function sistemaQueColisiona(): DescriptorDeSistema {
  const egreso = (e: EntornoDelDescriptor): NetworkPolicy[] => [
    {
      apiVersion: "networking.k8s.io/v1",
      kind: "NetworkPolicy",
      metadata: { name: "muestra-egreso", namespace: e.namespace, labels: e.etiquetas },
      spec: {
        podSelector: { matchLabels: { componente: "identidad" } },
        policyTypes: ["Egress"],
        egress: [
          {
            to: [
              {
                namespaceSelector: {
                  matchLabels: { "kubernetes.io/metadata.name": e.namespaceDe("rentas") },
                },
                podSelector: { matchLabels: { componente: "identidad" } },
              },
            ],
            ports: [{ protocol: "TCP", port: 8080 }],
          },
        ],
      },
    },
  ];
  const real = SISTEMAS.find(({ descriptor }) => descriptor.sistema === "identidad")?.descriptor;
  if (real === undefined) {
    throw new Error(
      "No hay descriptor de «identidad» en SISTEMAS: esta muestra se queda sin sujeto y las dos " +
        "pruebas que separan los criterios pasarian sin medir nada.",
    );
  }
  const conLaColision: DescriptorDeSistema = { ...real, egreso };
  return conLaColision;
}

describe("AC-7 · el grafo se lee por namespace de destino, no por nombre de etiqueta", () => {
  /**
   * Lo primero: que el quinto sistema SEA un nodo.
   *
   * Con el criterio por nombre esto sigue siendo cierto —los nodos salen de `SISTEMAS`, no de las
   * aristas—, asi que no basta; va delante porque sin ella todo lo de abajo seria cierto sobre un
   * grafo sin ese sistema.
   */
  it("`identidad` es un nodo del grafo, y hoy sin aristas hacia hermanos", () => {
    const grafo = grafoDeEgreso(entornoDe);
    expect(Object.keys(grafo).sort()).toEqual(
      SISTEMAS.map(({ descriptor }) => descriptor.sistema).sort(),
    );
    expect(grafo).toHaveProperty("identidad");
    // Vacio, y es una AFIRMACION: en la etapa 1 este sistema no llama a ningun hermano, y las
    // aristas que traera la etapa 4 apareceran en los descriptores de los CUATRO, no en el suyo.
    expect(grafo["identidad"]).toEqual([]);
  });

  /** Y el de los otros cuatro no se movio: el criterio nuevo no reescribe el grafo, lo sostiene. */
  it("el grafo de los otros cuatro es el mismo de ARQ-01", () => {
    const grafo = grafoDeEgreso(entornoDe);
    expect(grafo["rentas"]).toEqual(["caja", "catastro", "normativa"]);
    expect(grafo["catastro"]).toEqual(["normativa", "rentas"]);
    expect(grafo["caja"]).toEqual(["rentas"]);
    expect(grafo["normativa"]).toEqual([]);
  });

  /**
   * **La medida que decide, y hay que leer las dos mitades.**
   *
   * Sobre los descriptores de VERDAD los dos criterios coinciden —eso se comprueba abajo—, asi
   * que el unico sujeto que los separa es un descriptor fabricado con la colision dentro.
   */
  it("una arista hacia el namespace de un hermano se ve aunque la etiqueta sea «identidad»", () => {
    const fabricado = sistemaQueColisiona();
    const entorno = entornoDe("identidad");
    expect(dependenciasDeclaradas(fabricado, entorno, DEL_NAMESPACE)).toEqual(["rentas"]);
  });

  it("y el criterio por NOMBRE la descarta: ese es el defecto que AC-7 cierra", () => {
    const fabricado = sistemaQueColisiona();
    const entorno = entornoDe("identidad");
    expect(
      dependenciasPorNombreDeEtiqueta(fabricado, entorno),
      "con el filtro por nombre, un sistema cuyos pods lleven `componente: identidad` " +
        "desaparece del grafo: la arista existe, la NetworkPolicy la aplica, y el grafo dice " +
        "que no llama a nadie",
    ).toEqual([]);
  });

  /**
   * Y el contraste que impide leerlo al reves: lo que NO es un sistema sigue fuera.
   *
   * Sin esto, «se ve la arista» se podria cumplir con un criterio que no filtrara nada, y el
   * grafo tendria nodos `postgres`, `identidad` (Keycloak) y `kube-system`, que no son sistemas.
   */
  it("el motor, Keycloak y el DNS siguen sin ser aristas del grafo", () => {
    const grafo = grafoDeEgreso(entornoDe);
    for (const [sistema, destinos] of Object.entries(grafo)) {
      expect(destinos, `«${sistema}» declara una dependencia que no es un sistema`).not.toContain(
        "postgres",
      );
      expect(destinos).not.toContain("kube-system");
      // Y ninguno se declara dependiente de si mismo, que es como se leeria su propia politica
      // si el namespace de origen entrara en la cuenta.
      expect(destinos).not.toContain(sistema);
    }
    // `identidad` de la PLATAFORMA es Keycloak, y los cinco salen hacia el. Como nodo del grafo
    // solo puede estar el SISTEMA, y su unica forma de aparecer como destino es que alguien
    // declare una arista hacia SU namespace — cosa que hoy no hace nadie.
    expect(Object.values(grafo).flat()).not.toContain("identidad");
  });

  /**
   * Y la medida que explica por que las dos pruebas de arriba usan un descriptor fabricado:
   * **sobre los cinco descriptores de verdad los dos criterios dan lo mismo, hoy**.
   *
   * Se afirma en vez de suponerse, porque es lo que convierte «devolver el filtro viejo» en una
   * mutacion que NO se ve en el grafo. El dia que deje de ser cierto —la etapa 4— esta prueba se
   * pone roja y hay que venir aqui a leer por que.
   */
  it("hoy los dos criterios dan el mismo grafo, y por eso hace falta el fabricado", () => {
    for (const { descriptor } of SISTEMAS) {
      const entorno = entornoDe(descriptor.sistema);
      expect(
        dependenciasPorNombreDeEtiqueta(descriptor, entorno),
        `«${descriptor.sistema}»: los dos criterios ya no coinciden sobre los descriptores ` +
          "reales. Eso NO es un fallo de esta guarda: es que la colision de AC-7 dejo de ser " +
          "latente, y las dos pruebas del descriptor fabricado pasan a tener sujeto real.",
      ).toEqual(dependenciasDeclaradas(descriptor, entorno, DEL_NAMESPACE));
    }
  });
});
