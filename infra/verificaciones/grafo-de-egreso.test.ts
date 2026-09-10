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
    // Vacio, y es una AFIRMACION que la etapa 4 CONFIRMA: este sistema SIRVE el buzon y no lo
    // empuja (ADR-0028 §3), asi que las cuatro aristas de la etapa 4 estan en los descriptores
    // de los CUATRO consumidores y ninguna en el suyo. Empujar obligaria a conocer cuatro
    // direcciones, pedir cuatro credenciales y reintentar cuatro veces — o sea, a que el dueno
    // de la autorizacion dependa de que los cuatro esten arriba.
    expect(grafo["identidad"]).toEqual([]);
  });

  /**
   * Y el de los otros cuatro es el de ARQ-01 **mas la arista hacia `identidad` que la etapa 4
   * de ADR-0039 trae a cada uno** (`identidad`#4 AC-2): el consumidor de la autorizacion corre
   * en el namespace de cada sistema y lee el buzon en el de `identidad`, asi que los cuatro
   * declaran esa salida. Es la arista que este archivo existia para poder ver: con el criterio
   * por nombre estas cuatro se filtrarian como Keycloak y el grafo diria que a `identidad` no
   * lo llama nadie.
   *
   * Hasta la etapa 4: `rentas → caja, catastro, normativa`; `catastro → normativa, rentas`;
   * `caja → rentas`; `normativa → (ninguno)`. Seis aristas; ahora diez.
   */
  it("el grafo de los otros cuatro es el de ARQ-01 mas la arista hacia `identidad` de la etapa 4", () => {
    const grafo = grafoDeEgreso(entornoDe);
    expect(grafo["rentas"]).toEqual(["caja", "catastro", "identidad", "normativa"]);
    expect(grafo["catastro"]).toEqual(["identidad", "normativa", "rentas"]);
    expect(grafo["caja"]).toEqual(["identidad", "rentas"]);
    expect(grafo["normativa"]).toEqual(["identidad"]);
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
    // declare una arista hacia SU namespace — que desde la etapa 4 hacen los cuatro. Lo que
    // sigue sin poder aparecer es la ETIQUETA de Keycloak leida como nodo: la prueba de arriba
    // ya afirma que las cuatro aristas llegan al nombre del sistema, y esta que ninguna llega a
    // un nombre que no sea un nodo.
    const nodos = new Set(Object.keys(grafo));
    for (const destino of Object.values(grafo).flat()) {
      expect(nodos.has(destino), `«${destino}» no es ningun nodo del grafo`).toBe(true);
    }
  });

  /**
   * **La colision de AC-7 dejo de ser latente en la etapa 4, y esta es la medida.**
   *
   * Hasta `identidad`#4 esta prueba afirmaba lo contrario: que sobre los cinco descriptores de
   * verdad los dos criterios daban el MISMO grafo, y por eso hacia falta el fabricado. Con los
   * cuatro consumidores declarando su salida hacia el namespace de `identidad`, el criterio por
   * NOMBRE ya no coincide con el de por namespace sobre codigo real —en ninguno de los cuatro—,
   * y lo que hace es exactamente lo que AC-7 anticipo: **ninguna de esas cuatro aristas llega
   * al nodo `identidad`**. O se filtra como Keycloak, o llega con la etiqueta del pod
   * (`identidad-sistema`), que no es ningun nodo. El grafo que se imprimiria con el filtro viejo
   * diria que a `identidad` no lo llama nadie mientras los cuatro lo llaman.
   *
   * Se afirma por los dos lados: que el criterio bueno ve la arista, y que el viejo no. Sin lo
   * segundo, «se ve la arista» no dice nada sobre la colision que este archivo existe para
   * medir.
   */
  it("desde la etapa 4 los dos criterios difieren sobre los descriptores reales, y el viejo pierde `identidad`", () => {
    const consumidores = SISTEMAS.map(({ descriptor }) => descriptor.sistema).filter(
      (s) => s !== "identidad",
    );
    expect(consumidores.length, "sin consumidores esto no mide nada").toBeGreaterThan(0);
    for (const { descriptor } of SISTEMAS) {
      if (descriptor.sistema === "identidad") continue;
      const entorno = entornoDe(descriptor.sistema);
      expect(
        dependenciasDeclaradas(descriptor, entorno, DEL_NAMESPACE),
        `«${descriptor.sistema}» no declara su salida hacia el namespace de «identidad»: su ` +
          "consumidor de la autorizacion no podria leer el buzon (identidad#4 AC-2)",
      ).toContain("identidad");
      expect(
        dependenciasPorNombreDeEtiqueta(descriptor, entorno),
        `«${descriptor.sistema}»: el criterio por nombre de etiqueta ve la arista hacia el ` +
          "SISTEMA `identidad`. Eso solo puede pasar si sus pods dejaron de llevar " +
          "`componente: identidad-sistema`, y entonces el grafo no distingue el sistema de Keycloak",
      ).not.toContain("identidad");
    }
  });
});
