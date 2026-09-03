import * as k8s from "@pulumi/kubernetes";
import { describe, expect, it } from "vitest";
import { construirManifiestos } from "../componentes";
import type { Manifiesto } from "../componentes/tipos";
import { invariantesDe } from "./stacks";

/**
 * Los manifiestos encajan en el esquema de Kubernetes, comprobado por el compilador.
 *
 * `tipos.ts` describe los manifiestos como objetos planos —sin `pulumi.Input`— para que
 * la auditoria pueda leerlos y las pruebas corran sin clúster. El costo es perder el
 * tipado del esquema de Kubernetes, que era medio motivo de elegir TypeScript
 * (`ADR-0011` §1). Esta prueba lo devuelve entero.
 *
 * El truco es que `pulumi.Input<T>` **incluye** `T`: un objeto plano es asignable al
 * tipo de entrada correspondiente, y esa asignacion solo compila si los nombres de las
 * propiedades y sus formas son los que Kubernetes espera. Asi, `strategty` o
 * `timeoutSecond` no llegan a un `pulumi up`: **no compilan**, que es exactamente lo que
 * `ADR-0011` §1 prometia y lo que un YAML suelto no da.
 *
 * Por eso las aserciones de aqui son pocas y casi triviales: **lo que verifica esta
 * prueba es que compila**, y eso lo comprueba `yarn typecheck`. Las aserciones existen
 * para que el archivo no sea solo declaraciones muertas y para que quede claro que los
 * manifiestos que se comprueban son los de los stacks reales, no ejemplos.
 */

const manifiestos = construirManifiestos(invariantesDe("prod"));

function de<T extends Manifiesto["kind"]>(kind: T): Extract<Manifiesto, { kind: T }>[] {
  return manifiestos.filter((m) => m.kind === kind) as Extract<Manifiesto, { kind: T }>[];
}

describe("cada manifiesto es asignable a su tipo de @pulumi/kubernetes", () => {
  it("Namespace, PriorityClass y ConfigMap", () => {
    const namespaces: k8s.types.input.core.v1.Namespace[] = de("Namespace");
    const prioridades: k8s.types.input.scheduling.v1.PriorityClass[] = de("PriorityClass");
    const configuraciones: k8s.types.input.core.v1.ConfigMap[] = de("ConfigMap");

    expect(namespaces).toHaveLength(1);
    expect(prioridades).toHaveLength(3);
    expect(configuraciones.length).toBeGreaterThan(0);
  });

  it("PersistentVolumeClaim y Service", () => {
    const volumenes: k8s.types.input.core.v1.PersistentVolumeClaim[] = de(
      "PersistentVolumeClaim",
    );
    const servicios: k8s.types.input.core.v1.Service[] = de("Service");

    // Tres: los datos del motor, los de Prometheus y los de Grafana (#155, #156).
    expect(volumenes).toHaveLength(3);
    expect(servicios.length).toBeGreaterThan(0);
  });

  it("Deployment, Job y CronJob", () => {
    const despliegues: k8s.types.input.apps.v1.Deployment[] = de("Deployment");
    const trabajos: k8s.types.input.batch.v1.Job[] = de("Job");
    const programados: k8s.types.input.batch.v1.CronJob[] = de("CronJob");

    // Nueve despliegues: motor, identidad, aplicacion, interfaz, y los cinco de
    // observabilidad —Prometheus, Alertmanager, node-exporter, kube-state-metrics,
    // Grafana— (#156).
    expect(despliegues).toHaveLength(9);
    // Tres Jobs: migracion, implantacion y reconciliacion del realm.
    expect(trabajos).toHaveLength(3);
    // Dos CronJob: el lote de la aplicacion (suspendido) y el respaldo base (#155).
    expect(programados).toHaveLength(2);
  });

  it("ServiceAccount, ClusterRole y ClusterRoleBinding: solo kube-state-metrics", () => {
    const cuentas: k8s.types.input.core.v1.ServiceAccount[] = de("ServiceAccount");
    const roles: k8s.types.input.rbac.v1.ClusterRole[] = de("ClusterRole");
    const enlaces: k8s.types.input.rbac.v1.ClusterRoleBinding[] = de("ClusterRoleBinding");

    // El unico componente de infra/ con RBAC propio (issue #156): ver el docstring
    // de Observabilidad.ts. Uno de cada, nunca mas sin que alguien lo decida aqui.
    expect(cuentas).toHaveLength(1);
    expect(roles).toHaveLength(1);
    expect(enlaces).toHaveLength(1);
  });

  it("NetworkPolicy: denegar-todo mas las excepciones nombradas (issue #157)", () => {
    const politicas: k8s.types.input.networking.v1.NetworkPolicy[] = de("NetworkPolicy");

    expect(politicas).toHaveLength(24);
  });

  it("los recursos de Traefik llevan el grupo de la v3", () => {
    // Estos no tienen tipo en `@pulumi/kubernetes` —son CRD—, asi que aqui se comprueba
    // lo unico que se puede comprobar sin el esquema: el grupo. Con el grupo viejo el
    // manifiesto se aplica sin error y sin efecto, que es la trampa de `../iaac`.
    for (const m of manifiestos) {
      if (["IngressRoute", "Middleware", "TLSOption"].includes(m.kind)) {
        expect(m.apiVersion).toBe("traefik.io/v1alpha1");
      }
    }
  });
});
