import { describe, expect, it } from "vitest";
import { ENVIRONMENTS } from "../config";
import { manifiestosDelAmbiente } from "../herramientas/emitir-manifiestos";
import { invariantesDe } from "./stacks";

/**
 * `#42` — la sonda de un sidecar no puede sacar del `Service` al proceso que ese `Service` sirve.
 *
 * `readiness` es del **POD**, no del contenedor: un pod solo esta `Ready` cuando lo estan TODOS
 * sus contenedores, y un pod que no esta `Ready` sale del `Endpoints` de su `Service`.
 *
 * Medido en `stg` el 2026-09-08, y costo tres corridas de `main` creyendo que el problema era una
 * migracion: el motor estaba **`2/2 Running`, 0 reinicios, 32h**, con sus tres `pg_isready` en
 * verde, y aun asi habia pods rojos en los CINCO espacios de nombres con la misma frase
 * —«Connection to kamayuk-stg-postgres.kamayuk-stg:5432 refused»—. El unico evento era la sonda
 * de **`postgres-exporter`** en el puerto 9187 agotando su plazo. Un exportador de metricas
 * lento habia sacado la base de datos de servicio para todo el cluster.
 *
 * ## La regla, y por que NO es «el que sirve el puerto del Service»
 *
 * Esa fue la primera version de esta guarda, y **paso en verde sobre el defecto**: el `Service`
 * del motor expone LOS DOS puertos —`5432` y `9187`—, asi que el exportador «sirve un puerto del
 * Service» y quedaba eximido. Se midio devolviendole la `readinessProbe` y las cuatro pruebas
 * siguieron verdes.
 *
 * La regla que si muerde sale de lo que `readiness` ES: **una propiedad del POD**. Dos
 * contenedores que la declaren gobiernan los MISMOS `Endpoints`, y gana el mas estricto — un
 * acoplamiento que no se ve leyendo ninguno de los dos. Asi que **como mucho un contenedor por
 * pod puede declararla**, y cual es se fija con el contraste de abajo, que nombra al motor.
 *
 * Lo que esta guarda NO decide es cual de los dos deberia ser: eso es un juicio, y esta escrito
 * en `BaseDeDatos.ts` al lado de la sonda que se quito.
 */

interface Contenedor {
  name: string;
  ports?: { name?: string; containerPort: number }[];
  readinessProbe?: unknown;
  livenessProbe?: unknown;
}

interface Manifiesto {
  kind?: string;
  metadata?: { name?: string; namespace?: string; labels?: Record<string, string> };
  spec?: {
    selector?: Record<string, string> | { matchLabels?: Record<string, string> };
    ports?: { targetPort?: number | string; port?: number }[];
    template?: { metadata?: { labels?: Record<string, string> }; spec?: { containers?: Contenedor[] } };
  };
}

describe("#42 · ningun sidecar gobierna la disponibilidad del Service", () => {
  it.each(ENVIRONMENTS)("«%s»", (ambiente) => {
    const todos = manifiestosDelAmbiente(invariantesDe(ambiente)) as Manifiesto[];
    const servicios = todos.filter((m) => m.kind === "Service");
    const cargas = todos.filter((m) => m.kind === "Deployment" || m.kind === "StatefulSet");

    expect(servicios.length, "el ambiente no compone ningun Service").toBeGreaterThan(3);

    const culpables: string[] = [];
    let comparados = 0;

    for (const servicio of servicios) {
      const selector = (servicio.spec?.selector ?? {}) as Record<string, string>;
      if (Object.keys(selector).length === 0) continue;

      const detras = cargas.filter((carga) => {
        if (carga.metadata?.namespace !== servicio.metadata?.namespace) return false;
        const etiquetas = carga.spec?.template?.metadata?.labels ?? {};
        return Object.entries(selector).every(([k, v]) => etiquetas[k] === v);
      });

      for (const carga of detras) {
        const contenedores = carga.spec?.template?.spec?.containers ?? [];
        if (contenedores.length < 2) continue; // sin sidecar no hay nada que decidir
        comparados += 1;

        const conReadiness = contenedores.filter((c) => c.readinessProbe !== undefined);
        if (conReadiness.length > 1) {
          culpables.push(
            `${servicio.metadata?.namespace}/${servicio.metadata?.name} -> ` +
              `${carga.metadata?.name}: ${conReadiness.map((c) => `«${c.name}»`).join(" y ")}`,
          );
        }
      }
    }

    // Sin esto la prueba pasaria en verde el dia que ningun pod con Service tenga sidecar, o el
    // dia que el emparejamiento por selector dejara de casar: es la leccion de C-15/C-16.
    expect(
      comparados,
      "ningun pod con `Service` tiene mas de un contenedor: esta guarda no comparo nada",
    ).toBeGreaterThan(0);

    expect(
      [...new Set(culpables)],
      "en estos pods hay MAS DE UN contenedor con `readinessProbe`:\n  " +
        [...new Set(culpables)].join("\n  ") +
        "\n  `readiness` es del POD, no del contenedor: los dos gobiernan los mismos " +
        "`Endpoints` y gana el mas estricto, asi que un sidecar lento saca de servicio al " +
        "proceso que el `Service` existe para servir. Remedio: dejarsela solo a ese proceso, y " +
        "al sidecar la `livenessProbe`, que reinicia el contenedor sin tocar el `Endpoints`.",
    ).toEqual([]);
  });

  /**
   * Y el contraste, sin el cual lo de arriba se satisface quitando TODAS las sondas: el
   * contenedor que sirve el puerto conserva las suyas.
   */
  it.each(ENVIRONMENTS)("«%s»: el motor conserva sus tres sondas", (ambiente) => {
    const motor = (manifiestosDelAmbiente(invariantesDe(ambiente)) as Manifiesto[]).find(
      (m) => m.kind === "Deployment" && (m.metadata?.name ?? "").endsWith("-postgres"),
    );
    const contenedores = motor?.spec?.template?.spec?.containers ?? [];
    const postgres = contenedores.find((c) => c.name === "postgres");
    expect(postgres, "no esta el contenedor `postgres`").toBeDefined();
    expect(postgres?.readinessProbe, "el motor perdio su readiness").toBeDefined();
    expect(postgres?.livenessProbe).toBeDefined();

    // Y el sidecar conserva la SUYA de vida: no se le quitan las dos.
    const exportador = contenedores.find((c) => c.name === "postgres-exporter");
    expect(exportador, "no esta el sidecar `postgres-exporter`").toBeDefined();
    expect(
      exportador?.livenessProbe,
      "al exportador se le quitaron las dos sondas: sin `liveness` un proceso colgado no se " +
        "reinicia nunca, y esa sonda no toca el `Endpoints`",
    ).toBeDefined();
  });
});
