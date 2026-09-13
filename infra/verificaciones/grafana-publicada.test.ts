/**
 * #149 — Grafana publicado en `https://<dominio>/grafana`, con login del realm de operacion
 * (ADR-0041), y sin ninguna clave por internet.
 *
 * ## Lo que se midio antes de escribir una linea
 *
 * Grafana 11.3.0 y Keycloak 26.0.8 —las versiones de los dos ambientes—, arrancados en local el
 * 2026-09-13 con exactamente esta configuracion, y el login recorrido con `curl`:
 *
 * | Cuenta del realm de operacion | Resultado |
 * |---|---|
 * | con `lector` | sesion, `Viewer` |
 * | con `administrador` | sesion, `Admin` |
 * | sin rol | sin sesion: `oauth.role_attribute_strict_violation` |
 *
 * Y cada linea que protege algo, rota a proposito:
 *
 * - sin `ROLE_ATTRIBUTE_STRICT` → la cuenta sin rol entra como `Viewer`;
 * - formulario encendido → `POST /grafana/login` con la clave de `admin` da **200**;
 * - intercambio del codigo inalcanzable → `auth.oauth.token.exchange`, sin sesion.
 *
 * Esas medidas son el motivo de `auditarGrafanaPublicada`, y esta prueba la rompe linea a linea.
 */
import { describe, expect, it } from "vitest";
import { auditarManifiestos } from "../auditoria";
import { construirManifiestos } from "../componentes";
import { CLIENTE_DE_GRAFANA, realmDeOperacion } from "../componentes/Identidad";
import { inventarioDelAmbiente } from "../componentes/secretos";
import {
  CLAVES,
  secretos,
  servicioDeGrafana,
  servicioDeIdentidad,
} from "../componentes/convenciones";
import type { Contenedor, Manifiesto } from "../componentes/tipos";
import { ENVIRONMENTS, namespaceName, resourceName, type Environment } from "../config";
import { namespacesDelAmbiente } from "../descriptor/entorno";
import { invariantesDe } from "./stacks";

function manifiestos(ambiente: Environment): Manifiesto[] {
  return construirManifiestos(invariantesDe(ambiente));
}

function contenedorDeGrafana(ms: Manifiesto[], ambiente: Environment): Contenedor {
  const despliegue = ms.find(
    (m) => m.kind === "Deployment" && m.metadata.name === servicioDeGrafana(ambiente),
  ) as unknown as { spec: { template: { spec: { containers: Contenedor[] } } } } | undefined;
  const contenedor = despliegue?.spec.template.spec.containers.find((c) => c.name === "grafana");
  if (contenedor === undefined) throw new Error("no hay contenedor de Grafana: ¿cambio de forma?");
  return contenedor;
}

function variables(c: Contenedor): Map<string, string | undefined> {
  return new Map((c.env ?? []).map((v) => [v.name, v.value]));
}

function problemasDeGrafana(ms: Manifiesto[], ambiente: Environment): string[] {
  return auditarManifiestos(ms, {
    secretoDeOwner: secretos(ambiente).owner,
    namespace: namespaceName(ambiente),
    namespacesDelAmbiente: namespacesDelAmbiente(ambiente),
  }).filter((p) => p.includes("publica Grafana"));
}

describe("#149 · Grafana entra por Keycloak y por nada mas", () => {
  it.each(ENVIRONMENTS)("«%s»: el acceso es el que se midio", (ambiente) => {
    const dominio = invariantesDe(ambiente).ingress.domain;
    const operacion = realmDeOperacion(invariantesDe(ambiente).identity.realm);
    const v = variables(contenedorDeGrafana(manifiestos(ambiente), ambiente));

    expect(v.get("GF_SERVER_ROOT_URL")).toBe(`https://${dominio}/grafana/`);
    expect(v.get("GF_SERVER_SERVE_FROM_SUB_PATH")).toBe("true");

    // Ninguna clave por internet.
    expect(v.get("GF_AUTH_DISABLE_LOGIN_FORM")).toBe("true");
    expect(v.get("GF_AUTH_BASIC_ENABLED")).toBe("false");
    expect(v.get("GF_AUTH_ANONYMOUS_ENABLED")).toBe("false");

    // OIDC contra el realm de operacion, con PKCE y rol estricto.
    expect(v.get("GF_AUTH_GENERIC_OAUTH_ENABLED")).toBe("true");
    expect(v.get("GF_AUTH_GENERIC_OAUTH_CLIENT_ID")).toBe(CLIENTE_DE_GRAFANA);
    expect(v.get("GF_AUTH_GENERIC_OAUTH_USE_PKCE")).toBe("true");
    expect(v.get("GF_AUTH_GENERIC_OAUTH_ROLE_ATTRIBUTE_STRICT")).toBe("true");
    expect(v.get("GF_AUTH_GENERIC_OAUTH_ALLOW_ASSIGN_GRAFANA_ADMIN")).toBe("false");
    expect(v.get("GF_AUTH_GENERIC_OAUTH_ROLE_ATTRIBUTE_PATH")).toBe(
      "contains(roles[*], 'administrador') && 'Admin' || contains(roles[*], 'lector') && 'Viewer'",
    );

    // La autorizacion la visita el navegador; el codigo y `userinfo`, el pod.
    expect(v.get("GF_AUTH_GENERIC_OAUTH_AUTH_URL")).toBe(
      `https://${dominio}/keycloak/realms/${operacion}/protocol/openid-connect/auth`,
    );
    const interno = `http://${servicioDeIdentidad(ambiente)}:8080/keycloak/realms/${operacion}/protocol/openid-connect`;
    expect(v.get("GF_AUTH_GENERIC_OAUTH_TOKEN_URL")).toBe(`${interno}/token`);
    expect(v.get("GF_AUTH_GENERIC_OAUTH_API_URL")).toBe(`${interno}/userinfo`);

    // Sesion acotada y cookie segura.
    expect(v.get("GF_AUTH_LOGIN_MAXIMUM_INACTIVE_LIFETIME_DURATION")).toBe("1h");
    expect(v.get("GF_AUTH_LOGIN_MAXIMUM_LIFETIME_DURATION")).toBe("12h");
    expect(v.get("GF_SECURITY_COOKIE_SECURE")).toBe("true");
  });

  it("la clave del cliente sale del Secret de Grafana, y rotarla pide reiniciar Grafana", () => {
    const ambiente: Environment = "prod";
    const c = contenedorDeGrafana(manifiestos(ambiente), ambiente);
    const secreto = (c.env ?? []).find((e) => e.name === "GF_AUTH_GENERIC_OAUTH_CLIENT_SECRET");
    expect(secreto?.value, "la clave del cliente, escrita en claro en el manifiesto").toBeUndefined();
    expect(secreto?.valueFrom?.secretKeyRef).toEqual({
      name: resourceName(ambiente, "grafana"),
      key: CLAVES.clienteOidcDeGrafana,
    });
    const entrada = inventarioDelAmbiente(invariantesDe(ambiente)).find(
      (e) => e.rol === "grafana-cliente-oidc",
    );
    expect(entrada?.requiereReinicioDe).toBe(servicioDeGrafana(ambiente));
  });

  it("las sondas se quedan en /api/health: con la subruta, Grafana la sigue sirviendo en la raiz", () => {
    // Medido con Grafana 11.3.0 y `serve_from_sub_path`: `/api/health` y `/grafana/api/health`
    // contestan 200 los dos. Moverlas era el plan; medir dijo que no hacia falta.
    const c = contenedorDeGrafana(manifiestos("prod"), "prod");
    expect(c.readinessProbe?.httpGet?.path).toBe("/api/health");
    expect(c.livenessProbe?.httpGet?.path).toBe("/api/health");
  });
});

describe("#149 · la ruta y la red", () => {
  const ambiente: Environment = "prod";
  const ms = manifiestos(ambiente);

  it("una IngressRoute a /grafana, por HTTPS y con el limite de tasa general", () => {
    const ruta = ms.find(
      (m) => m.kind === "IngressRoute" && m.metadata.name === resourceName(ambiente, "grafana"),
    ) as unknown as {
      spec: {
        entryPoints: string[];
        tls?: { certResolver: string };
        routes: { match: string; middlewares?: { name: string }[]; services: { name: string; port: number }[] }[];
      };
    };
    expect(ruta).toBeDefined();
    expect(ruta.spec.entryPoints).toEqual(["websecure"]);
    expect(ruta.spec.tls?.certResolver).toBe("letsencrypt");
    expect(ruta.spec.routes).toHaveLength(1);
    expect(ruta.spec.routes[0]?.services).toEqual([{ name: servicioDeGrafana(ambiente), port: 3000 }]);
    // `limite-de-tasa`, no `limite-de-identidad`: aqui no hay formulario que probar, y una
    // pantalla de Grafana son decenas de peticiones.
    expect(ruta.spec.routes[0]?.middlewares).toEqual([{ name: resourceName(ambiente, "limite-de-tasa") }]);
  });

  type Politica = {
    metadata: { name: string };
    spec: {
      podSelector: { matchLabels: Record<string, string> };
      ingress?: { from: Record<string, unknown>[]; ports: { port: number }[] }[];
      egress?: { to: Record<string, unknown>[]; ports: { port: number }[] }[];
    };
  };
  const politica = (nombre: string) =>
    ms.find((m) => m.kind === "NetworkPolicy" && m.metadata.name === nombre) as unknown as Politica;
  const deApp = (app: string) => ({ podSelector: { matchLabels: { app } } });

  it("Traefik llega a Grafana, y solo al 3000", () => {
    const entrada = politica("permitir-ingreso-grafana");
    expect(entrada.spec.podSelector.matchLabels).toEqual({ app: servicioDeGrafana(ambiente) });
    expect(entrada.spec.ingress).toEqual([
      {
        from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } } }],
        ports: [{ port: 3000, protocol: "TCP" }],
      },
    ]);
  });

  it("Grafana llega a identidad, y identidad le deja entrar: las DOS puntas del login", () => {
    // Sin cualquiera de las dos, el login muere en `auth.oauth.token.exchange` (medido),
    // despues de que la persona ya puso su clave.
    const salida = politica("permitir-salida-grafana");
    expect(salida.spec.egress).toContainEqual({
      to: [deApp(servicioDeIdentidad(ambiente))],
      ports: [{ port: 8080, protocol: "TCP" }],
    });
    const entrada = politica("permitir-ingreso-identidad");
    expect(entrada.spec.ingress?.[0]?.from).toContainEqual(deApp(servicioDeGrafana(ambiente)));
  });
});

describe("#149 · la auditoria no deja publicar Grafana con una clave", () => {
  const ambiente: Environment = "prod";

  it("con la configuracion de hoy no hay nada que decir", () => {
    expect(problemasDeGrafana(manifiestos(ambiente), ambiente)).toEqual([]);
  });

  /** Cada linea que la auditoria exige, con el valor que la rompe. */
  const ROTURAS: [string, string | undefined][] = [
    ["GF_AUTH_DISABLE_LOGIN_FORM", "false"],
    ["GF_AUTH_BASIC_ENABLED", "true"],
    ["GF_AUTH_ANONYMOUS_ENABLED", "true"],
    ["GF_AUTH_GENERIC_OAUTH_ENABLED", "false"],
    ["GF_AUTH_GENERIC_OAUTH_ROLE_ATTRIBUTE_STRICT", "false"],
    ["GF_AUTH_GENERIC_OAUTH_ROLE_ATTRIBUTE_STRICT", undefined],
    ["GF_AUTH_GENERIC_OAUTH_TOKEN_URL", "https://vmd206041.contaboserver.net/keycloak/realms/x/protocol/openid-connect/token"],
  ];

  it.each(ROTURAS)("%s = %s, con la ruta puesta: la auditoria lo nombra", (variable, valor) => {
    const ms = manifiestos(ambiente);
    const c = contenedorDeGrafana(ms, ambiente);
    c.env = (c.env ?? []).filter((e) => e.name !== variable);
    if (valor !== undefined) c.env.push({ name: variable, value: valor });

    const problemas = problemasDeGrafana(ms, ambiente);
    expect(problemas, `quitar ${variable} no produjo ninguna queja: la guarda no lo mira`).toHaveLength(1);
    expect(problemas[0]).toContain(variable);
  });

  it("sin ruta a Grafana no exige nada: la regla es de lo PUBLICADO", () => {
    const ms = manifiestos(ambiente).filter(
      (m) => !(m.kind === "IngressRoute" && m.metadata.name === resourceName(ambiente, "grafana")),
    );
    const c = contenedorDeGrafana(ms, ambiente);
    c.env = (c.env ?? []).filter((e) => e.name !== "GF_AUTH_DISABLE_LOGIN_FORM");
    expect(problemasDeGrafana(ms, ambiente)).toEqual([]);
  });

  it("y sigue a Grafana por su imagen, no por el nombre del Deployment", () => {
    const ms = manifiestos(ambiente);
    const c = contenedorDeGrafana(ms, ambiente);
    c.env = (c.env ?? []).filter((e) => e.name !== "GF_AUTH_BASIC_ENABLED");
    const despliegue = ms.find(
      (m) => m.kind === "Deployment" && m.metadata.name === servicioDeGrafana(ambiente),
    );
    if (despliegue === undefined) throw new Error("sin Deployment de Grafana");
    despliegue.metadata.name = "otro-nombre";
    expect(problemasDeGrafana(ms, ambiente)).toHaveLength(1);
  });
});
