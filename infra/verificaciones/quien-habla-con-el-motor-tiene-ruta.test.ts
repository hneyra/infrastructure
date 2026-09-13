/**
 * Un pod que habla con el motor y **no tiene politica de red** (#81, el defecto que su propio
 * arreglo introdujo).
 *
 * ## Lo que paso, medido el 2026-09-13
 *
 * El `Job` que #81 anade para crear las bases que faltan se desplego con su `PGHOST` puesto y
 * **sin ninguna regla que le dejara llegar al motor**. `denegar-todo` cierra ingreso y egreso por
 * omision, y cada flujo se declara aparte — eso esta escrito en la cabecera de `Red.ts` y aun asi
 * se paso por alto.
 *
 * **El sintoma no se parece a la causa**, que es lo que lo hace peligroso:
 *
 * ```
 * kamayuk-stg-postgres-crear-bases-… creating (416s)
 * warning: container "crear-bases" completed with exit code 137
 * error: 9 errors occurred
 * ```
 *
 * **137 se lee como «se quedo sin memoria»** —es 128+9, SIGKILL— y era **falta de ruta**: la
 * espera de 120 s se agotaba porque `pg_isready` no llegaba a ningun sitio, y con `backoffLimit:
 * 3` eso son los 416 s. Rompio el despliegue de `stg` y con el, toda la cadena.
 *
 * ## Que vigila esto
 *
 * Que **todo pod del namespace de la plataforma que declare `PGHOST` este nombrado en las dos
 * direcciones**: una politica de egreso que lo seleccione y le abra el 5432, y la de ingreso del
 * motor que lo admita. Las dos hacen falta y ninguna basta sola.
 *
 * **Solo el namespace de la plataforma**, a proposito: los cuatro sistemas viven en el suyo desde
 * ADR-0031 y entran por `namespaceSelector` —`DE_LOS_SISTEMAS`—, que es una regla para todos
 * ellos y no una por pod. Alli la pregunta es otra y la contesta otra guarda.
 */
import { describe, expect, it } from "vitest";
import { namespaceName, type Environment } from "../config";
import { construirManifiestos } from "../componentes";
import { invariantesDe } from "./stacks";
import type { Manifiesto } from "../componentes/tipos";

const AMBIENTE: Environment = "prod";
const NAMESPACE = namespaceName(AMBIENTE);

function manifiestos(): Manifiesto[] {
  return construirManifiestos(invariantesDe(AMBIENTE));
}

interface Politica {
  metadata: { name: string; namespace: string };
  spec: {
    podSelector: { matchLabels?: Record<string, string> };
    policyTypes?: string[];
    ingress?: { from?: { podSelector?: { matchLabels?: Record<string, string> } }[] }[];
    egress?: { to?: { podSelector?: { matchLabels?: Record<string, string> } }[] }[];
  };
}

/** Los pods de la plataforma que declaran `PGHOST`, con su etiqueta `app`. */
function losQueHablanConElMotor(): { nombre: string; app: string }[] {
  const cargas = manifiestos().filter(
    (m) => (m.kind === "Deployment" || m.kind === "Job") && m.metadata?.namespace === NAMESPACE,
  ) as unknown as {
    metadata: { name: string };
    spec: {
      template: {
        metadata: { labels: Record<string, string> };
        spec: { containers: { env?: { name: string }[] }[] };
      };
    };
  }[];
  return cargas
    .filter((c) =>
      c.spec.template.spec.containers.some((k) => (k.env ?? []).some((e) => e.name === "PGHOST")),
    )
    .map((c) => ({ nombre: c.metadata.name, app: c.spec.template.metadata.labels["app"] ?? "" }));
}

function politicas(): Politica[] {
  return manifiestos().filter(
    (m) => m.kind === "NetworkPolicy" && m.metadata?.namespace === NAMESPACE,
  ) as unknown as Politica[];
}

/** Una politica de egreso que seleccione ese `app`. */
function tieneSalida(app: string): boolean {
  return politicas().some(
    (p) =>
      (p.spec.policyTypes ?? []).includes("Egress") &&
      p.spec.podSelector.matchLabels?.["app"] === app &&
      (p.spec.egress ?? []).length > 0,
  );
}

/** Que la politica de ingreso del motor lo admita por su etiqueta. */
function elMotorLoAdmite(app: string): boolean {
  return politicas()
    .filter((p) => p.metadata.name.includes("ingreso-postgres"))
    .some((p) =>
      (p.spec.ingress ?? []).some((r) =>
        (r.from ?? []).some((f) => f.podSelector?.matchLabels?.["app"] === app),
      ),
    );
}

describe("#81 - quien habla con el motor tiene ruta declarada, en las dos direcciones", () => {
  it("EL CENTINELA: hay pods que declaran PGHOST", () => {
    // Si `PGHOST` deja de usarse —o el manifiesto cambia de forma— esto recorreria la lista
    // vacia y pasaria en verde sin mirar nada, que es el modo de fallo de toda guarda que barre.
    expect(
      losQueHablanConElMotor().length,
      "ningun pod de la plataforma declara PGHOST: esta guarda se quedo sin sujeto",
    ).toBeGreaterThan(0);
  });

  for (const { nombre, app } of losQueHablanConElMotor()) {
    it(`«${nombre}» tiene politica de SALIDA hacia el motor`, () => {
      expect(
        tieneSalida(app),
        `«${nombre}» declara PGHOST y ninguna politica de egreso selecciona \`app: ${app}\`. ` +
          "`denegar-todo` cierra el egreso por omision, asi que este pod no sale a ningun sitio. " +
          "Y el sintoma no lo dice: la espera se agota, el contenedor muere y `pulumi up` " +
          "informa «completed with exit code 137», que se lee como falta de memoria.",
      ).toBe(true);
    });

    it(`y el motor admite a «${nombre}» en su politica de ENTRADA`, () => {
      expect(
        elMotorLoAdmite(app),
        `la politica de ingreso del motor no nombra \`app: ${app}\`. Abrir solo la salida no ` +
          "basta: las dos direcciones se declaran por separado y Kubernetes exige las dos.",
      ).toBe(true);
    });
  }
});
