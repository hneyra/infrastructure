/**
 * Un contenedor que el kernel mata y **nadie se entera** (#99).
 *
 * ## Lo medido en `prod` el 2026-09-13
 *
 * | | |
 * |---|---|
 * | Keycloak en regimen | **600Mi** — el **59 %** de su techo de 1Gi |
 * | reinicios del pod | **3** |
 * | el ultimo | `OOMKilled`, exit 137, 2026-09-12T17:22:36Z |
 * | alertas que se enteraron | **ninguna** |
 *
 * Y no es un descuido: su propio runbook lo habia escrito —«ninguna [alerta] mira `restartCount`
 * ni `OOMKilled`. Las dos que podrian haber cazado el episodio de #99 no lo hicieron»— y nadie
 * lo atendio.
 *
 * ## Por que las que ya habia no sirven
 *
 * - **`PodEnCrashLoopBackOff`**: un pod que muere y vuelve a arrancar **BIEN** no entra nunca en
 *   CrashLoopBackOff. El kernel puede estar matandolo una vez por dia en silencio.
 * - **`PodNoListo`**: para cuando alguien mira, ya esta listo otra vez.
 *
 * Las dos describen un pod que **sigue** roto. Esto describe uno que **estuvo** roto, que es lo
 * que hay que saber para que el numero del techo se decida con una medida y no con una
 * corazonada.
 */
import { describe, expect, it } from "vitest";
import { alertasYml } from "../componentes/fuentes";
import { recursosDe } from "../componentes/convenciones";
import { invariantesDe } from "./stacks";
import { type Environment } from "../config";

const AMBIENTE: Environment = "prod";
/** Lo que `kubectl top` midio en regimen el 2026-09-13. */
const REGIMEN_MEDIDO_EN_MI = 600;

function enMi(cantidad: string): number {
  const n = Number.parseInt(cantidad, 10);
  if (cantidad.endsWith("Gi")) return n * 1024;
  if (cantidad.endsWith("Mi")) return n;
  throw new Error(`no se sabe leer «${cantidad}»`);
}

describe("#99 - un OOM no es silencioso, y el techo sale de una medida", () => {
  it("hay una alerta que dispara cuando el kernel mata un contenedor", () => {
    expect(
      alertasYml(),
      "ninguna regla mira `OOMKilled`. Sin ella, el kernel puede matar un contenedor y nadie se " +
        "entera: `PodEnCrashLoopBackOff` no lo ve —un pod que muere y vuelve a arrancar BIEN no " +
        "entra nunca en CrashLoopBackOff— y `PodNoListo` tampoco, porque para cuando alguien " +
        "mira ya esta listo. Medido en `prod`: 3 reinicios, el ultimo OOMKilled, cero alertas.",
    ).toContain('reason="OOMKilled"');
  });

  it("y otra cuando un contenedor se reinicia varias veces en poco tiempo", () => {
    expect(
      alertasYml(),
      "ninguna regla mira `kube_pod_container_status_restarts_total`. Es la red de la anterior: " +
        "un reinicio cuya causa no fue OOM —o cuyo `lastState` ya se perdio, porque Kubernetes " +
        "solo conserva el ultimo— se quedaria sin nadie que lo diga.",
    ).toContain("kube_pod_container_status_restarts_total");
  });

  it("el techo de Keycloak deja sitio de sobra sobre lo que consume en regimen", () => {
    const identidad = recursosDe(invariantesDe(AMBIENTE).recursos.perfil).identidad;
    const techo = enMi(identidad.limits.memory);
    expect(
      techo,
      `el techo de Keycloak (${identidad.limits.memory}) no llega al doble de los ` +
        `${String(REGIMEN_MEDIDO_EN_MI)}Mi que consume en REGIMEN, medidos con \`kubectl top\` ` +
        "sobre `prod`. Lo que sobra tiene que cubrir el pico de ARRANQUE de una JVM que hace su " +
        "fase de *build*, y con 1Gi no aguanto: 3 reinicios, el ultimo OOMKilled. Subirlo no " +
        "compite por el presupuesto del nodo — `capacidad.ts` suma `requests`, no `limits`.",
    ).toBeGreaterThanOrEqual(REGIMEN_MEDIDO_EN_MI * 2);
  });

  it("y sus `requests` NO suben, que es lo que mantiene el presupuesto quieto", () => {
    const identidad = recursosDe(invariantesDe(AMBIENTE).recursos.perfil).identidad;
    expect(
      enMi(identidad.requests.memory),
      "los `requests` de Keycloak subieron. `capacidad.ts` los suma para decidir si el stack " +
        "cabe en el nodo, y el margen medido era de ~307Mi: subirlos es lo unico de este cambio " +
        "que podria dejar el ambiente sin poder desplegarse.",
    ).toBe(512);
  });
});
