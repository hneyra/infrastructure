import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { raizDelRepositorio } from "../componentes/fuentes";
import { SISTEMAS as SISTEMAS_DECLARADOS } from "./deriva-de-migraciones";
import { invariantesDe } from "./stacks";

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

/**
 * Las cuatro bases de ADR-0029, **derivadas** de la tabla que ya las declara.
 *
 * Hasta C-10 esta lista estaba escrita aqui a mano, que era un cuarto sitio donde
 * olvidarse de un sistema —el defecto de #742 otra vez—. Sale de {@link SISTEMAS}, que
 * desde `E` son exactamente los cuatro: la resta del monolito sobra porque el monolito ya
 * no esta en esa tabla.
 */
const BASES = SISTEMAS_DECLARADOS.map((s) => s.nombre);

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
    // `catastro` la necesita desde `V61`, y la imagen oficial no la trae. Se compara contra
    // la que declara el stack —que es la que se despliega— y ya no contra el compose del
    // monolito, que se fue con el (`E`).
    expect(PLATAFORMA.services["base"]?.image).toBe(invariantesDe("stg").database.image);
    expect(PLATAFORMA.services["base"]?.image).toContain("postgis");
  });

  it("y crea LAS CUATRO bases, una por sistema", () => {
    // Desde C-10 la lista de bases NO esta en el guion: sale de los archivos que se le
    // montan, uno por sistema. Asi que lo que hay que comprobar aqui es que estan los
    // cuatro montajes — un sistema en SISTEMAS sin su montaje es una base que no nace.
    const montajes = PLATAFORMA.services["base"]?.volumes ?? [];

    for (const base of BASES) {
      expect(
        montajes.join("\n"),
        `«${base}» no tiene montado su crear-roles.sql: su base no se crearia`,
      ).toContain(`:/etc/kamayuk/roles/${base}.sql:ro`);
    }
    // Y se monta el guion, que es lo que hace que corra: un guion en el repositorio y no
    // en `docker-entrypoint-initdb.d` es un guion que no se ejecuta.
    expect(montajes.join("\n")).toContain(
      "05-crear-bases.sh:/docker-entrypoint-initdb.d/05-crear-bases.sh",
    );
    // Y su libreria, que es de donde saca que extensiones declara cada uno.
    expect(montajes.join("\n")).toContain("lib-extensiones.sh:/etc/kamayuk/lib-extensiones.sh:ro");
  });

  it("cada montaje de roles apunta al clon hermano de SU sistema", () => {
    // Un montaje cruzado —el `crear-roles.sql` de `catastro` como `caja.sql`— daria una
    // base de la caja con PostGIS dentro y ni un error: el defecto que C-10 cierra,
    // reintroducido por una linea del compose.
    const montajes = PLATAFORMA.services["base"]?.volumes ?? [];

    for (const base of BASES) {
      const montaje = montajes.find((v) => v.endsWith(`:/etc/kamayuk/roles/${base}.sql:ro`));
      expect(montaje, `falta el montaje de «${base}»`).toBeDefined();
      expect(montaje, `el montaje de «${base}» no sale de su clon`).toContain(
        `../../${base}/backend/`,
      );
      expect(montaje).toContain("/src/main/resources/db/roles/crear-roles.sql:");
    }
  });

  it("los archivos de roles NO caen en docker-entrypoint-initdb.d", () => {
    // Todo `.sql` que caiga ahi lo EJECUTA el entrypoint contra la base por omision.
    // Estos hay que leerlos, no correrlos: ejecutar el `crear-roles.sql` de los cuatro
    // sistemas contra `postgres` crearia ahi las extensiones de todos y ninguna donde
    // toca — exactamente al reves de lo que C-10 hace.
    const montajes = PLATAFORMA.services["base"]?.volumes ?? [];
    const enInitdb = montajes.filter((v) => v.includes(":/docker-entrypoint-initdb.d/"));

    expect(enInitdb.filter((v) => v.includes("/etc/kamayuk/"))).toEqual([]);
    // 05-crear-bases, 06-roles-de-los-sistemas, 20-asignar-claves. Eran CUATRO hasta `E`:
    // el `10-crear-roles.sql` del monolito era el unico `.sql` que caia ahi, y el
    // entrypoint lo ejecutaba contra la base por omision.
    expect(enInitdb).toHaveLength(3);
    expect(
      enInitdb.filter((v) => v.endsWith(".sql:ro") || v.endsWith(".sql")),
      "un `.sql` en initdb.d lo ejecuta el entrypoint contra la base por omision",
    ).toEqual([]);
  });

  /**
   * C-14, punto 2. Hasta entonces las cuatro bases recibian sus extensiones —derivadas de su
   * `crear-roles.sql` (C-10)— y **no** los `GRANT` sobre `public` que ese mismo archivo declara.
   *
   * La consecuencia no se ve al crear la base: se ve a mitad de la migracion. Medido contra
   * PostgreSQL 16.15, con las cuatro bases creadas por `05-crear-bases.sh` y el migrador de
   * `catastro` de verdad: sin este guion, `42501 permission denied for schema public`; con el,
   * «Successfully applied 5 migrations».
   */
  it("y los roles de cada sistema se aplican EN SU BASE, detras de las bases", () => {
    const montajes = (PLATAFORMA.services["base"]?.volumes ?? []).filter((v) =>
      v.includes(":/docker-entrypoint-initdb.d/"),
    );
    const bases = montajes.findIndex((v) => v.includes("05-crear-bases"));
    const roles = montajes.findIndex((v) => v.includes("06-roles-de-los-sistemas"));
    expect(roles, "falta el montaje de `06-roles-de-los-sistemas.sh`").toBeGreaterThanOrEqual(0);
    expect(
      roles,
      "el `06` tiene que ir DETRAS del `05`: sin las bases creadas no hay donde aplicar nada, y " +
        "lo unico que ordena estos guiones es el numero de delante.",
    ).toBeGreaterThan(bases);
  });

  it("el guion de las bases corre ANTES que el de los roles de los sistemas", () => {
    // `crear-roles.sql` de cada sistema instala sus extensiones y concede sobre el `public`
    // de SU base: sin las bases creadas no tiene donde hacerlo. Lo unico que ordena estos
    // guiones es el numero. Se compara contra `06` y no contra el `10` del monolito, que se
    // fue con el (`E`).
    const montajes = (PLATAFORMA.services["base"]?.volumes ?? []).filter((v) =>
      v.includes(":/docker-entrypoint-initdb.d/"),
    );
    const bases = montajes.findIndex((v) => v.includes("crear-bases"));
    const roles = montajes.findIndex((v) => v.includes("roles-de-los-sistemas"));
    expect(bases).toBeGreaterThanOrEqual(0);
    expect(roles).toBeGreaterThan(bases);
    expect(montajes[bases]).toMatch(/\/docker-entrypoint-initdb\.d\/05-/);
    expect(montajes[roles]).toMatch(/\/docker-entrypoint-initdb\.d\/06-/);
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

  /**
   * **`despliegue/compose.yaml` ya no existe** (`E`), y con el las tres pruebas que lo
   * comparaban con este.
   *
   * Era el compose del monolito: levantaba `migraciones`, `aplicacion`, `implantacion` e
   * `interfaz` construyendo `backend/Dockerfile` y `../frontend`. **Ninguno de los dos
   * existia en este repositorio desde el corte** —medido: `backend/` traia solo los `.sql`
   * y un `.java`—, asi que ese compose no podia construirse desde aqui desde el primer dia.
   * `plataforma.compose.yaml` es el que queda, y cada sistema trae el suyo.
   */
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
