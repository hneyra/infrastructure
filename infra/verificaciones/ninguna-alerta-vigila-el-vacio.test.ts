/**
 * Una regla que evalua sobre el conjunto vacio **no protege nada, y se ve igual que una
 * que protege**.
 *
 * ## El defecto que la trajo, medido en `prod` el 2026-09-12 (#113)
 *
 * Cinco de las once alertas —`CPUDelNodoAlta`, `MemoriaDelNodoAlta`, `DiscoDelNodoAlto`,
 * `PresionDeCPUDelNodo` y `CertificadoPorExpirar`— llevaban 22 h sin poder dispararse,
 * porque las series que consumen **no existian**: `count({__name__=~"node_.*"})` y
 * `count({__name__=~"traefik_.*"})` daban **0** sobre 6 709 series.
 *
 * Y Prometheus no lo decia por ningun sitio. Una expresion PromQL sin series devuelve
 * vector vacio, que no dispara: la regla se queda en `health: ok, state: inactive`, que
 * es **exactamente** el aspecto de una regla que vigila algo sano. `/api/v1/alerts`
 * devolvia `[]`. El disco podia llenarse entero sin que nada cambiara de aspecto.
 *
 * Las dos causas eran de configuracion, no de proceso:
 *
 * - **`traefik`**: el `Service traefik` de `kube-system` es el del LoadBalancer y publica
 *   solo `web:80` y `websecure:443`. El proceso SI servia —492 series leidas desde el pod
 *   de Prometheus contra `10.42.0.24:9100`—, pero el 9100 no existia como puerto de
 *   Service. Se arregla con `metrics.prometheus.service.enabled`, que crea
 *   **`traefik-metrics`**, y por eso el objetivo tiene que nombrar a ESE.
 * - **`node-exporter`**: con `hostNetwork: true` su `podIP` ES el `hostIP`, y desde un pod
 *   de este cluster la IP del nodo es inalcanzable en TODO puerto (siete probados, 6443 y
 *   10250 incluidos). No era la NetworkPolicy: Alertmanager, con egreso `0.0.0.0/0:443`
 *   explicito, alcanza `1.1.1.1:443` y no alcanza `164.68.125.44:443`.
 *
 * ## Que vigila este archivo, y que NO
 *
 * Las cuatro reglas nuevas de `alertas.yml` son la red **en tiempo de ejecucion**. Esto es
 * la red **estatica**: impide que alguien anada un objetivo o una alerta y deje el hueco
 * otra vez, sin esperar a que pasen 22 h en produccion para enterarse.
 *
 * NO comprueba que el raspado funcione —eso exige un cluster— ni que las series lleguen.
 * Comprueba que lo declarado es coherente consigo mismo.
 */
import { describe, expect, it } from "vitest";
import { namespaceName, type Environment } from "../config";
import { recursosDe } from "../componentes/convenciones";
import { manifiestosDeObservabilidad } from "../componentes/Observabilidad";
import { valoresDeTraefik } from "../componentes/Ingreso";
import { alertasYml } from "../componentes/fuentes";
import { invariantesDe } from "./stacks";

const AMBIENTE: Environment = "prod";

/** El `prometheus.yml` tal como sale del ConfigMap, no una copia. */
function prometheusYml(): string {
  const ms = manifiestosDeObservabilidad({
    environment: AMBIENTE,
    namespace: namespaceName(AMBIENTE),
    recursos: recursosDe(invariantesDe(AMBIENTE).recursos.perfil),
    alertWebhookUrl: undefined,
  });
  const cm = ms.find(
    (m) => m.kind === "ConfigMap" && String(m.metadata?.name).includes("observabilidad-prometheus"),
  ) as { data: Record<string, string> } | undefined;
  const yml = cm?.data["prometheus.yml"];
  if (!yml) throw new Error("no hay ConfigMap de prometheus, o no lleva `prometheus.yml`");
  return yml;
}

/** Los `job_name:` declarados, en orden. */
function jobsDeRaspado(): string[] {
  return [...prometheusYml().matchAll(/^\s*-\s*job_name:\s*(\S+)\s*$/gm)]
    .map((m) => m[1])
    .filter((n): n is string => n !== undefined);
}

/** El bloque `expr` de cada alerta, con su nombre. */
function alertas(): { nombre: string; expr: string }[] {
  const texto = alertasYml();
  const partes = texto.split(/^\s*-\s*alert:\s*/m).slice(1);
  return partes.map((p) => {
    const nombre = (p.split("\n")[0] ?? "").trim();
    const expr = p.slice(p.indexOf("expr:")).split(/^\s*(?:for|labels|annotations):/m)[0] ?? "";
    return { nombre, expr };
  });
}

/** Lo que va dentro de cada `absent(...)` del archivo entero. */
function loCubiertoPorAbsent(): string {
  return alertas()
    .map((a) => a.expr)
    .filter((e) => e.includes("absent("))
    .join("\n");
}

describe("#113 · ninguna alerta vigila el conjunto vacio", () => {
  it("EL CENTINELA: hay alertas y hay objetivos, o esto no mide nada", () => {
    // Si `alertas.yml` o el ConfigMap cambian de forma y los extractores dejan de
    // encontrar nada, las demas pruebas pasarian en verde sobre listas vacias. Esta
    // existe para que eso salga rojo.
    expect(alertas().length, "no se extrajo ninguna alerta de `alertas.yml`").toBeGreaterThan(10);
    expect(jobsDeRaspado().length, "no se extrajo ningun job de `prometheus.yml`").toBeGreaterThan(3);
  });

  it("cada objetivo de raspado esta nombrado en una regla `absent(up{job=...})`", () => {
    const cubierto = loCubiertoPorAbsent();
    for (const job of jobsDeRaspado()) {
      // `prometheus` se raspa a si mismo: si ese objetivo cae, no hay nadie que pueda
      // evaluar ninguna regla, asi que una alerta sobre el no llegaria a evaluarse.
      if (job === "prometheus") continue;
      expect(
        cubierto,
        `el objetivo «${job}» no lo nombra ninguna regla \`absent(up{job="..."})\`. ` +
          "Sin eso, borrarlo o renombrarlo no pone `up` a 0: la hace DESAPARECER, y " +
          "entonces `ObjetivoDeRaspadoCaido` tampoco puede disparar. Es el hueco de #113, " +
          "que duro 22 h sin que nada lo dijera.",
      ).toContain(`up{job="${job}"}`);
    }
  });

  it("cada serie `node_*` y `traefik_*` que una alerta consume esta cubierta por un `absent(`", () => {
    const cubierto = loCubiertoPorAbsent();
    for (const { nombre, expr } of alertas()) {
      if (expr.includes("absent(")) continue; // la propia red no se vigila a si misma
      const series = [...expr.matchAll(/\b((?:node|traefik)_[a-z_]+)\b/g)].map((m) => m[1]);
      for (const serie of new Set(series)) {
        expect(
          cubierto,
          `«${nombre}» consume \`${serie}\` y ninguna regla \`absent(\` la cubre. Si esa ` +
            "serie deja de llegar, esta alerta no se pone roja: se queda `inactive`, que es " +
            "como se ve una regla sana. Es exactamente el estado en que #113 encontro a cinco " +
            "de las once.",
        ).toContain(serie);
      }
    }
  });

  it("el objetivo de Traefik nombra el Service que los valores del chart crean de verdad", () => {
    const valores = valoresDeTraefik({ acmeEmail: "a@b.pe", acmeStaging: true });
    expect(
      valores,
      "los valores de Traefik no habilitan `metrics.prometheus.service`, asi que el chart " +
        "no renderiza ningun Service con el 9100 y el raspado no puede llegar: el `Service " +
        "traefik` de `kube-system` es el del LoadBalancer y solo publica 80 y 443.",
    ).toMatch(/service:\s*\n\s*"?\s*enabled:\s*true/);
    expect(
      prometheusYml(),
      "el objetivo de Traefik no apunta a `traefik-metrics`. El Service que publica el 9100 " +
        "es el que crea `metrics.prometheus.service.enabled`, y se llama `traefik-metrics`; " +
        "`traefik` a secas es el del LoadBalancer, donde ese puerto no existe — que es como " +
        "#113 se paso 22 h con «connection refused».",
    ).toContain("traefik-metrics.kube-system.svc.cluster.local:9100");
  });

  it("node-exporter no vive en la red del anfitrion, porque ahi no lo alcanza nadie", () => {
    const ms = manifiestosDeObservabilidad({
      environment: AMBIENTE,
      namespace: namespaceName(AMBIENTE),
      recursos: recursosDe(invariantesDe(AMBIENTE).recursos.perfil),
      alertWebhookUrl: undefined,
    });
    const d = ms.find(
      (m) => m.kind === "Deployment" && String(m.metadata?.name).includes("node-exporter"),
    ) as { spec: { template: { spec: Record<string, unknown> } } } | undefined;
    if (!d) throw new Error("no hay Deployment de node-exporter");
    expect(
      d.spec.template.spec.hostNetwork,
      "node-exporter declara `hostNetwork: true`. Con eso su `podIP` ES el `hostIP`, el " +
        "EndpointSlice publica la IP del nodo, y desde un pod de este cluster la IP del nodo " +
        "es INALCANZABLE en todo puerto (medido: 22, 80, 443, 6443, 9100, 10250 y 31818, los " +
        "siete rechazados). El Service, su EndpointSlice y `permitir-ingreso-node-exporter` " +
        "quedan los tres bien escritos y los tres INERTES. Lo que hace que mida el nodo son " +
        "`/host/proc` y `/host/sys`, no el espacio de nombres de red.",
    ).toBeUndefined();
  });
});
