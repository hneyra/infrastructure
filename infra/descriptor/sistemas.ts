/**
 * Los cinco descriptores que este ambiente compone, **con su version fijada**.
 *
 * `infrastructure` los importa y fija la version del paquete —no la de ninguna imagen: son dos
 * cosas distintas y confundirlas es la prohibicion (b)—. Subir una version aqui es lo que hace
 * que un cambio de infraestructura de un sistema llegue a produccion, y es tambien el riesgo que
 * `ADR-0031` §Consecuencias nombra: **el descriptor que nadie compone**. El sintoma es «lo
 * desplegue y no cambio nada».
 *
 * ## Por que `link:` y no `file:`
 *
 * `file:` de yarn v1 **copia** la carpeta a `node_modules`, y ahi las rutas relativas del
 * contrato a `../componentes/tipos` dejan de resolver. Con `link:` se enlaza y se conservan. El
 * dia que estos paquetes se publiquen en un registro, la dependencia pasa a ser una version y
 * esta nota deja de hacer falta.
 */

import type { DescriptorFijado } from "./index";
import type { EntornoDelDescriptor } from "./tipos";
import { caja } from "../../../caja/infrastructure/src/descriptor";
import { catastro } from "../../../catastro/infrastructure/src/descriptor";
import { identidad } from "../../../identidad/infrastructure/src/descriptor";
import { normativa } from "../../../normativa/infrastructure/src/descriptor";
import { rentas } from "../../../rentas/infrastructure/src/descriptor";

export const SISTEMAS: readonly DescriptorFijado[] = [
  { version: "0.1.0", descriptor: rentas },
  { version: "0.1.0", descriptor: catastro },
  { version: "0.1.0", descriptor: normativa },
  { version: "0.1.0", descriptor: caja },
  // El quinto, y nace de contestar D-19 (ADR-0039). En la etapa 1 no llama a ningun hermano:
  // sale de este grafo como nodo sin aristas, y eso es una afirmacion y no una casilla vacia.
  { version: "0.1.0", descriptor: identidad },
];

/**
 * El grafo de egreso compuesto: quien puede llamar a quien. Es el de ARQ-01, en cinco nodos.
 *
 * ## Se distingue la plataforma POR EL NAMESPACE DE DESTINO, y no por el nombre de la etiqueta
 *
 * Hasta el quinto sistema esta funcion llevaba `const infraestructura = ["postgres",
 * "identidad"]` y descartaba toda arista cuyo `podSelector` llevara una de esas dos etiquetas.
 * Funcionaba porque en la plataforma `identidad` significa **Keycloak** —lo etiqueta asi
 * `componentes/Identidad.ts`— y ningun sistema se llamaba igual.
 *
 * `ADR-0039` trae uno que si: el sistema `identidad`. Con el criterio por NOMBRE, el dia que la
 * etapa 4 haga que los cuatro declaren su arista hacia el, esas cuatro aristas se filtrarian
 * como si fueran infraestructura y **el grafo diria que a `identidad` no lo llama nadie mientras
 * los cuatro lo llaman**. No es un error que se vea: es un grafo que miente, que es peor. Su
 * descriptor lo esquiva hoy etiquetando sus pods `componente: identidad-sistema`, y esa mitad
 * es suya; esta es la de aqui.
 *
 * El criterio nuevo no lee la etiqueta en absoluto: **una arista es una dependencia entre
 * sistemas cuando su destino es el NAMESPACE de otro sistema**. Los tres destinos que hoy no lo
 * son —`kube-system` para el DNS y el de la plataforma para el motor y para Keycloak— se caen
 * solos, sin nombrar ninguna etiqueta. Y el nodo al que se apunta se resuelve del namespace, no
 * de la etiqueta, para que la arista llegue al nombre que este mapa usa de clave: con la
 * etiqueta, una arista hacia `identidad` apuntaria a «identidad-sistema», que no es ningun nodo.
 */
export function grafoDeEgreso(
  entornoDe: (sistema: string) => EntornoDelDescriptor,
): Record<string, string[]> {
  const grafo: Record<string, string[]> = {};
  const sistemaDelNamespace = sistemaDeCadaNamespace(entornoDe);
  for (const { descriptor } of SISTEMAS) {
    grafo[descriptor.sistema] = dependenciasDeclaradas(
      descriptor,
      entornoDe(descriptor.sistema),
      sistemaDelNamespace,
    );
  }
  return grafo;
}

/**
 * De namespace a sistema, compuesto con el MISMO `namespaceDe` que usan los descriptores al
 * declarar sus reglas.
 *
 * Una segunda forma de componerlo se separaria de la primera y este mapa dejaria de casar **en
 * silencio**: el grafo se quedaria sin aristas y nadie lo notaria, porque un grafo vacio no es
 * un error, es un grafo.
 */
export function sistemaDeCadaNamespace(
  entornoDe: (sistema: string) => EntornoDelDescriptor,
): ReadonlyMap<string, string> {
  return new Map<string, string>(
    SISTEMAS.map(({ descriptor }) => [
      entornoDe(descriptor.sistema).namespaceDe(descriptor.sistema),
      descriptor.sistema,
    ]),
  );
}

/**
 * Las dependencias que un descriptor declara: **los sistemas a cuyo NAMESPACE deja salir**.
 *
 * Esta separada de {@link grafoDeEgreso} para que se pueda medir con un descriptor fabricado, que
 * es lo unico que distingue este criterio del anterior: hoy los dos dan el MISMO grafo —medido—
 * porque en la etapa 1 de `ADR-0039` nadie declara todavia una arista hacia `identidad`. Un
 * criterio cuyo defecto no se puede producir con los descriptores que hay es un criterio que
 * nadie puede comprobar.
 *
 * No lee la etiqueta `componente` en absoluto, y ese es el punto: con el criterio por NOMBRE, un
 * sistema cuyos pods llevaran `componente: identidad` —que en la plataforma significa Keycloak—
 * desapareceria del grafo entero.
 */
export function dependenciasDeclaradas(
  descriptor: DescriptorFijado["descriptor"],
  entorno: EntornoDelDescriptor,
  sistemaDelNamespace: ReadonlyMap<string, string>,
): string[] {
  return descriptor
    .egreso(entorno)
    .flatMap((p) => p.spec.egress ?? [])
    .flatMap((r) => r.to ?? [])
    .map((s) => s.namespaceSelector?.matchLabels?.["kubernetes.io/metadata.name"])
    .map((ns) => (ns === undefined ? undefined : sistemaDelNamespace.get(ns)))
    .filter((s): s is string => s !== undefined && s !== descriptor.sistema)
    .sort();
}
