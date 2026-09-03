import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { raizDelRepositorio } from "../componentes/fuentes";

/**
 * El compose de la PLATAFORMA (ADR-0031 §4), leido del archivo.
 *
 * No levanta nada: comprueba lo que el archivo declara. Levantarlo de verdad es el AC del
 * entregable y necesita Docker; esto es lo que puede correr en cualquier maquina y en cada
 * PR, y es lo que impide que el compose y el cluster se separen sin que nadie lo note —la
 * trampa que ADR-0011 ya anoto para dos formas de levantar el sistema, y que con cuatro
 * sistemas se multiplica—.
 */

interface Servicio {
  image?: string;
  command?: string[];
  volumes?: string[];
  environment?: Record<string, string>;
  ports?: string[];
  healthcheck?: { test?: string[] };
}

interface Compose {
  name?: string;
  services: Record<string, Servicio>;
  volumes?: Record<string, unknown>;
  networks?: Record<string, { name?: string }>;
}

/**
 * Una sonda que pide `/ping` exige que la configuracion estatica lo sirva.
 *
 * Sin `--ping`, `traefik healthcheck --ping` se estrella contra un endpoint que nadie
 * levanta y el contenedor se queda `unhealthy` **para siempre**. El sintoma no es un
 * error: es un `depends_on: service_healthy` que no vuelve nunca y un `up --wait` que
 * caduca sin decir cual de los cuatro servicios falta. Medido levantandolo.
 */
export function sondasSinSuEndpoint(compose: Compose): string[] {
  return Object.entries(compose.services)
    .filter(([, s]) => (s.healthcheck?.test ?? []).some((t) => t.includes("--ping")))
    .filter(([, s]) => !(s.command ?? []).some((c) => c.startsWith("--ping")))
    .map(([nombre]) => nombre);
}

/**
 * Hasta v3.5, Traefik pide la API de Docker en la version 1.24 —fijada en su codigo, no
 * configurable por entorno— y **Docker 29 elevo el minimo a 1.44**. Con una imagen
 * anterior el proveedor falla en bucle, no descubre ni un servicio y Traefik contesta 404
 * a todo: indistinguible de «todavia no hay ningun sistema levantado», y sano segun su
 * propia sonda. Medido contra Docker 29.1.3: v3.1 y v3.5 en bucle, v3.6 limpio.
 */
export const TRAEFIK_MINIMO = [3, 6];

export function traefikDemasiadoViejo(compose: Compose): string[] {
  return Object.entries(compose.services)
    .filter(([, s]) => (s.image ?? "").startsWith("traefik:"))
    .filter(([, s]) => {
      const m = /^traefik:v(\d+)\.(\d+)/.exec(s.image ?? "");
      if (!m) return true; // `latest` o una etiqueta sin version: no se puede afirmar
      const [mayor, menor] = [Number(m[1]), Number(m[2])];
      return mayor < TRAEFIK_MINIMO[0]! || (mayor === TRAEFIK_MINIMO[0]! && menor < TRAEFIK_MINIMO[1]!);
    })
    .map(([nombre]) => nombre);
}

const RAIZ = raizDelRepositorio();
const PLATAFORMA = load(
  readFileSync(join(RAIZ, "despliegue/plataforma.compose.yaml"), "utf8"),
) as Compose;
const ENTERO = load(readFileSync(join(RAIZ, "despliegue/compose.yaml"), "utf8")) as Compose;

/** Las cuatro de ADR-0029. Si alguien anade un sistema, esta lista lo dice. */
const SISTEMAS = ["rentas", "catastro", "normativa", "caja"];

describe("la plataforma levanta lo que todo el mundo necesita", () => {
  it("PostgreSQL, Keycloak, el buzon y el ingreso, y nada de ningun sistema", () => {
    expect(Object.keys(PLATAFORMA.services).sort()).toEqual([
      "base",
      "correo",
      "identidad",
      "ingreso",
    ]);
  });

  it("el motor es el mismo que el del cluster: PostgreSQL 16 con PostGIS", () => {
    // `catastro` la necesita desde `V61`, y la imagen oficial no la trae.
    expect(PLATAFORMA.services["base"]?.image).toBe(ENTERO.services["base"]?.image);
    expect(PLATAFORMA.services["base"]?.image).toContain("postgis");
  });

  it("y crea LAS CUATRO bases, una por sistema", () => {
    const guion = readFileSync(
      join(RAIZ, "despliegue/inicializacion-del-motor/05-crear-bases.sh"),
      "utf8",
    );
    const declaradas = /^BASES="([^"]+)"$/m.exec(guion)?.[1]?.split(" ") ?? [];
    expect(declaradas.sort()).toEqual([...SISTEMAS].sort());
    // Y se monta, que es lo que hace que corra: un guion en el repositorio y no en
    // `docker-entrypoint-initdb.d` es un guion que no se ejecuta.
    expect(PLATAFORMA.services["base"]?.volumes?.join("\n")).toContain(
      "05-crear-bases.sh:/docker-entrypoint-initdb.d/05-crear-bases.sh",
    );
  });

  it("el guion de las bases corre ANTES que el de los roles", () => {
    // `crear-roles.sql` instala extensiones y concede sobre `public`: sin las bases
    // creadas no tiene donde hacerlo. Lo unico que ordena estos guiones es el numero.
    const montajes = PLATAFORMA.services["base"]?.volumes ?? [];
    const bases = montajes.findIndex((v) => v.includes("crear-bases"));
    const roles = montajes.findIndex((v) => v.includes("crear-roles"));
    expect(bases).toBeGreaterThanOrEqual(0);
    expect(roles).toBeGreaterThan(bases);
    expect(montajes[bases]).toMatch(/\/docker-entrypoint-initdb\.d\/0\d-/);
    expect(montajes[roles]).toMatch(/\/docker-entrypoint-initdb\.d\/1\d-/);
  });

  it("Keycloak siembra LOS DOS realms: son dos emisores, no dos clientes de uno", () => {
    const montajes = PLATAFORMA.services["identidad"]?.volumes?.join("\n") ?? "";
    expect(montajes).toContain("realm-sgtm.json");
    expect(montajes).toContain("realm-sgtm-ciudadano.json");
  });

  it("hay ingreso, y enruta por prefijo", () => {
    expect(PLATAFORMA.services["ingreso"]?.image).toContain("traefik");
  });

  it("el socket de Docker se monta de SOLO LECTURA", () => {
    // Un socket de Docker escribible dentro de un contenedor es root en el anfitrion.
    const socket = PLATAFORMA.services["ingreso"]?.volumes?.find((v) =>
      v.includes("docker.sock"),
    );
    expect(socket).toBeDefined();
    expect(socket).toMatch(/:ro$/);
  });

  it("no comparte volumen con el compose entero", () => {
    // Los dos crean bases distintas en su primer arranque, y los guiones de `initdb`
    // solo corren con el volumen VACIO: compartirlo dejaria al segundo sin ejecutarlos,
    // y el sintoma seria una base que falta y ningun error.
    const suyos = Object.keys(PLATAFORMA.volumes ?? {});
    const ajenos = Object.keys(ENTERO.volumes ?? {});
    expect(suyos.some((v) => ajenos.includes(v))).toBe(false);
  });
});

describe("el compose entero NO se retira: es el perfil `todo`", () => {
  it("sigue existiendo y sigue levantando la aplicacion", () => {
    // ADR-0031 §4: «un perfil `todo` levanta los cuatro, para pruebas de integracion y
    // para CI». Hoy levanta el sistema de la fase B entero, que es el mismo papel.
    expect(Object.keys(ENTERO.services)).toContain("aplicacion");
    expect(Object.keys(ENTERO.services)).toContain("migraciones");
  });

  it("y su servicio `base` conserva la base `sgtm` del monolito", () => {
    // Mientras `rentas` sea el monolito con los doce contextos dentro (ADR-0032), su
    // base sigue llamandose `sgtm`. Cambiarlo aqui rompe CI sin arreglar nada.
    expect(ENTERO.services["base"]?.environment?.["POSTGRES_DB"]).toBe("sgtm");
  });
});

describe("lo que el archivo no decia y solo se vio levantandolo", () => {
  // Las dos guardas de abajo nacieron de ejecutar el compose, no de leerlo: las diez
  // pruebas de este archivo pasaban en VERDE con los dos defectos dentro.

  it("ninguna sonda pide un endpoint que su servicio no sirve", () => {
    expect(sondasSinSuEndpoint(PLATAFORMA)).toEqual([]);
  });

  it("y la guarda muerde: el ingreso SIN `--ping` sale nombrado", () => {
    const roto = estructuradoClonar(PLATAFORMA);
    roto.services["ingreso"]!.command = (roto.services["ingreso"]!.command ?? []).filter(
      (c) => !c.startsWith("--ping"),
    );
    expect(sondasSinSuEndpoint(roto)).toEqual(["ingreso"]);
  });

  it("el ingreso habla una API de Docker que el demonio de hoy admite", () => {
    expect(traefikDemasiadoViejo(PLATAFORMA)).toEqual([]);
  });

  it("y la guarda muerde: v3.1 y v3.5 salen nombradas, v3.6 no", () => {
    for (const vieja of ["traefik:v3.1", "traefik:v3.5", "traefik:v2.11"]) {
      const roto = estructuradoClonar(PLATAFORMA);
      roto.services["ingreso"]!.image = vieja;
      expect(traefikDemasiadoViejo(roto)).toEqual(["ingreso"]);
    }
    const buena = estructuradoClonar(PLATAFORMA);
    buena.services["ingreso"]!.image = "traefik:v3.6";
    expect(traefikDemasiadoViejo(buena)).toEqual([]);
  });
});

/** Copia honda, para que una muestra rota no contamine a la siguiente. */
function estructuradoClonar(c: Compose): Compose {
  return JSON.parse(JSON.stringify(c)) as Compose;
}
