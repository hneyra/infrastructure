/**
 * Un cambio de configuracion que llega al `ConfigMap` y **no al proceso** (#146).
 *
 * ## Lo medido en `stg` el 2026-09-12, al desplegar #141
 *
 * | Donde | Estado |
 * |---|---|
 * | el `ConfigMap` | actualizado, con **15** reglas |
 * | el archivo dentro del pod | el nuevo, con **15** reglas |
 * | Prometheus, el PROCESO | **10** reglas, y raspando el objetivo VIEJO de Traefik |
 *
 * Kubernetes si actualiza el archivo montado; **el proceso no se entera**. Prometheus relee al
 * arrancar o con `POST /-/reload`, y en el despliegue no lo llama nadie. Las cinco reglas que no
 * se evaluaban eran justo las que #113 anadio **para que un vigilante ciego no pasara
 * inadvertido**, y ellas mismas lo estaban: el arreglo llevaba horas desplegado y sin efecto.
 *
 * ## Por que una anotacion y no un `reload`
 *
 * Porque hay un caso que `reload` **no puede** arreglar: **Grafana monta sus tres archivos con
 * `subPath`, y un `ConfigMap` montado asi no recibe actualizaciones NUNCA** (documentacion de
 * Kubernetes). Ahi lo unico que sirve es recrear el pod. Una sola forma para los tres vale mas
 * que dos formas y tener que recordar cual va donde.
 *
 * Lo que esta guarda NO comprueba: que el proceso lea de verdad el archivo nuevo. Eso exige un
 * cluster. Lo que fija es que un cambio de configuracion **cambie la plantilla del pod**, que es
 * lo que obliga a Kubernetes a recrearlo.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { namespaceName, type Environment } from "../config";
import { recursosDe } from "../componentes/convenciones";
import { manifiestosDeObservabilidad } from "../componentes/Observabilidad";
import { invariantesDe } from "./stacks";
import type { Manifiesto } from "../componentes/tipos";

const AMBIENTE: Environment = "prod";
const ANOTACION = "kamayuk.gob.pe/suma-de-la-configuracion";

function manifiestos(): Manifiesto[] {
  return manifiestosDeObservabilidad({
    environment: AMBIENTE,
    namespace: namespaceName(AMBIENTE),
    recursos: recursosDe(invariantesDe(AMBIENTE).recursos.perfil),
    alertWebhookUrl: undefined,
  });
}

/** La misma huella que compone el descriptor, escrita aparte a proposito (#27). */
function suma(data: Record<string, string>): string {
  const h = createHash("sha256");
  for (const clave of Object.keys(data).sort()) {
    h.update(clave).update("\u0000").update(data[clave] ?? "").update("\u0000");
  }
  return h.digest("hex").slice(0, 16);
}

interface Desplegado {
  nombre: string;
  anotaciones: Record<string, string>;
  configMaps: string[];
}

/** Los Deployment que montan al menos un `ConfigMap`, con lo que anotan. */
function losQueMontanConfiguracion(): Desplegado[] {
  const despliegues = manifiestos().filter((m) => m.kind === "Deployment") as unknown as {
    metadata: { name: string };
    spec: {
      template: {
        metadata: { annotations?: Record<string, string> };
        spec: { volumes?: { configMap?: { name: string } }[] };
      };
    };
  }[];
  return despliegues
    .map((d) => ({
      nombre: d.metadata.name,
      anotaciones: d.spec.template.metadata.annotations ?? {},
      configMaps: [
        ...new Set(
          (d.spec.template.spec.volumes ?? [])
            .map((v) => v.configMap?.name)
            .filter((n): n is string => n !== undefined),
        ),
      ],
    }))
    .filter((d) => d.configMaps.length > 0);
}

function datosDe(nombre: string): Record<string, string> {
  const cm = manifiestos().find((m) => m.kind === "ConfigMap" && m.metadata?.name === nombre) as
    | { data: Record<string, string> }
    | undefined;
  if (!cm) throw new Error(`no hay ConfigMap «${nombre}» en los manifiestos`);
  return cm.data;
}

describe("#146 - un cambio de configuracion recrea el pod que la consume", () => {
  it("EL CENTINELA: hay pods que montan configuracion", () => {
    // Sin esto, un cambio en como se componen los manifiestos dejaria las comprobaciones de
    // abajo recorriendo la lista vacia, en verde y sin haber mirado nada.
    const nombres = losQueMontanConfiguracion().map((d) => d.nombre);
    expect(
      nombres.length,
      "ningun Deployment monta un ConfigMap: esto no esta midiendo nada",
    ).toBeGreaterThanOrEqual(3);
  });

  for (const d of losQueMontanConfiguracion()) {
    it(`«${d.nombre}» anota la huella de su configuracion`, () => {
      expect(
        d.anotaciones[ANOTACION],
        `«${d.nombre}» monta ${d.configMaps.join(", ")} y no anota su huella. Sin ella, cambiar ` +
          "esa configuracion NO cambia la plantilla del pod: Kubernetes actualiza el archivo " +
          "dentro del contenedor y el proceso sigue con el viejo. Medido en `stg`: el ConfigMap " +
          "con 15 reglas y Prometheus evaluando 10, horas despues de desplegar.",
      ).toBeDefined();
    });

    it(`la huella de «${d.nombre}» sale de su CONTENIDO, no de un literal`, () => {
      const esperada = suma(Object.assign({}, ...d.configMaps.map(datosDe)));
      expect(
        d.anotaciones[ANOTACION],
        `la huella anotada en «${d.nombre}» no cuadra con el contenido de ` +
          `${d.configMaps.join(", ")}. Una huella que no se deriva del contenido es peor que ` +
          "ninguna: el pod no se recrea y ademas parece que alguien se ocupo de que si.",
      ).toBe(esperada);
    });
  }
});
