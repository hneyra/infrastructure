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

interface Compose {
  name?: string;
  services: Record<string, { image?: string; volumes?: string[]; environment?: Record<string, string>; ports?: string[] }>;
  volumes?: Record<string, unknown>;
  networks?: Record<string, { name?: string }>;
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
