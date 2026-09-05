import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { SISTEMAS_DEL_PRODUCTO } from "../componentes/convenciones";
import { raizDelRepositorio } from "../componentes/fuentes";
import { SISTEMAS } from "../descriptor/sistemas";
import { entornoDelAmbiente } from "../herramientas/emitir-manifiestos";
import { invariantesDe } from "./stacks";
import { fuenteDeLaCadena, rutasPublicas } from "./sondas-contra-la-cadena";
import {
  aliasRepetidos,
  anfitrionesQueNadieSirve,
  composeDeSistema,
  desajustes,
  loQueElDescriptorDice,
  motorDeLaPlataforma,
  servicioDe,
  type ComposeDeSistema,
  type LoQueElDescriptorDice,
} from "./compose-de-los-sistemas";

/**
 * C-18 — que el compose de cada sistema y su descriptor digan lo mismo.
 *
 * Hasta aqui **ninguno de los cuatro tenia compose**, y el `README.md` de
 * `infrastructure/despliegue/` afirmaba que si, con un ejemplo del archivo y todo. Lo que
 * comprueba este archivo es lo que ese README prometia y no medía nadie.
 *
 * Todo se hace **sin Docker y sin levantar nada**, leyendo los dos lados: los manifiestos que
 * `yarn manifiestos` compondria y el YAML del compose. Levantarlo de verdad es el criterio de
 * aceptacion del entregable `C-18` y su evidencia esta alli; esto es lo que puede correr en cada
 * PR, y es lo que impide que las dos formas de levantar el sistema se separen sin que se note.
 */

const ENTORNO = entornoDelAmbiente(invariantesDe("stg"));
const MOTOR = motorDeLaPlataforma();

const COMPOSES = SISTEMAS_DEL_PRODUCTO.map((sistema) => ({
  sistema,
  compose: composeDeSistema(sistema),
}));

function descriptorDe(sistema: string) {
  const fijado = SISTEMAS.find(({ descriptor }) => descriptor.sistema === sistema);
  if (fijado === undefined) throw new Error(`No hay descriptor de «${sistema}» en SISTEMAS.`);
  return fijado.descriptor;
}

function esperadoDe(sistema: string): LoQueElDescriptorDice {
  return loQueElDescriptorDice(descriptorDe(sistema), ENTORNO(sistema));
}

function composeDe(sistema: string): ComposeDeSistema {
  const encontrado = COMPOSES.find((c) => c.sistema === sistema);
  if (encontrado === undefined) throw new Error(`No se leyo el compose de «${sistema}».`);
  return encontrado.compose;
}

function hallazgosDe(sistema: string, compose = composeDe(sistema)): string[] {
  return desajustes(
    compose,
    esperadoDe(sistema),
    MOTOR,
    rutasPublicas(fuenteDeLaCadena(sistema), `${sistema}/SeguridadWeb.java`),
  ).map((d) => `[${d.donde}] ${d.mensaje}`);
}

/** Copia honda, para que una mutacion no contamine la siguiente. */
function clonar(c: ComposeDeSistema): ComposeDeSistema {
  return JSON.parse(JSON.stringify(c)) as ComposeDeSistema;
}

// ─────────────────────────────────────────────────────────────────────────────
// Los cuatro, contra su descriptor
// ─────────────────────────────────────────────────────────────────────────────

describe("cada sistema trae su compose, y dice lo mismo que su descriptor", () => {
  it.each(SISTEMAS_DEL_PRODUCTO)("«%s» no tiene ningun desajuste", (sistema) => {
    expect(hallazgosDe(sistema)).toEqual([]);
  });

  it.each(SISTEMAS_DEL_PRODUCTO)("«%s» trae los tres procesos y ninguno mas", (sistema) => {
    // Ni uno menos —un compose sin migrador levanta la aplicacion sobre una base vacia— ni uno
    // de mas: un servicio que el descriptor no despliega es configuracion que solo existe en
    // local, y entonces «funciona en mi maquina» deja de ser una broma.
    expect(Object.keys(composeDe(sistema)).length).toBeGreaterThan(0);
    expect(Object.keys(composeDe(sistema).services).sort()).toEqual(
      ["web", "migrador", "implantacion"].map((p) => servicioDe(sistema, p)).sort(),
    );
  });

  /**
   * El backend se llama COMO SU SISTEMA, y esto es lo que lo obliga.
   *
   * Los cuatro composes y el de la plataforma comparten UNA red, y Compose le da a cada servicio
   * un alias con su nombre. Cuatro servicios llamados `aplicacion` dejarian ese alias resolviendo
   * a uno cualquiera de los cuatro — y el sintoma no seria un error, seria una peticion que a
   * veces llega a quien no era.
   */
  it("ningun alias de red esta declarado por dos proyectos", () => {
    const plataforma = load(
      readFileSync(join(raizDelRepositorio(), "despliegue/plataforma.compose.yaml"), "utf8"),
    ) as ComposeDeSistema;
    expect(
      aliasRepetidos([
        { proyecto: "kamayuk-plataforma", compose: plataforma },
        ...COMPOSES.map(({ sistema, compose }) => ({ proyecto: `kamayuk-${sistema}`, compose })),
      ]),
    ).toEqual([]);
  });

  /**
   * Y todo anfitrion HTTP que un compose nombra lo sirve alguien de la red.
   *
   * `caja` apunta el evento de cada pago a `http://rentas:8080/...`, que es el nombre de un
   * servicio de OTRO compose. Si ese servicio se renombra, la caja sigue arrancando y el evento
   * se queda sin entregar: un fallo silencioso por definicion.
   */
  it("los anfitriones que se nombran entre sistemas los sirve alguien", () => {
    const plataforma = load(
      readFileSync(join(raizDelRepositorio(), "despliegue/plataforma.compose.yaml"), "utf8"),
    ) as ComposeDeSistema;
    const conocidos = [
      ...Object.keys(plataforma.services),
      ...COMPOSES.flatMap(({ compose }) => Object.keys(compose.services)),
    ];
    for (const { sistema, compose } of COMPOSES) {
      expect(anfitrionesQueNadieSirve(compose, conocidos), `en «${sistema}»`).toEqual([]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Que muerde, y que no muerde de mas
// ─────────────────────────────────────────────────────────────────────────────

/** Lo que declararia el descriptor de un sistema inventado, para medir contra las muestras. */
const MERCADOS: LoQueElDescriptorDice = {
  sistema: "mercados",
  prefijo: "mercados",
  base: "mercados",
  imagenes: ["mercados", "mercados-migrador"],
  procesos: {
    web: {
      servicio: "mercados",
      objetivo: "aplicacion",
      variables: ["SGTM_DB_CLAVE", "SGTM_DB_URL", "SGTM_DB_USUARIO", "SPRING_PROFILES_ACTIVE"],
      usuario: "sgtm_app",
      bases: ["mercados"],
    },
    migrador: {
      servicio: "mercados-migraciones",
      objetivo: "migrador",
      variables: ["SGTM_DB_OWNER_CLAVE", "SGTM_DB_OWNER_USUARIO", "SGTM_DB_URL"],
      usuario: "sgtm_owner",
      bases: ["mercados"],
    },
    implantacion: {
      servicio: "mercados-implantacion",
      objetivo: "aplicacion",
      variables: ["SGTM_DB_CLAVE", "SGTM_DB_URL", "SGTM_DB_USUARIO", "SPRING_PROFILES_ACTIVE"],
      usuario: "sgtm_app",
      bases: ["mercados"],
    },
  },
};

/** Las rutas que la cadena de los cuatro atiende sin token, para las muestras. */
const PUBLICAS = ["/actuator/health", "/actuator/prometheus"];

function muestra(nombre: string): ComposeDeSistema {
  const ruta = join(
    raizDelRepositorio(),
    "infra/verificaciones/muestras/compose-de-los-sistemas",
    nombre,
  );
  return load(readFileSync(ruta, "utf8")) as ComposeDeSistema;
}

function hallazgosDeLaMuestra(nombre: string): string[] {
  return desajustes(muestra(nombre), MERCADOS, "base", PUBLICAS).map((d) => `[${d.donde}] ${d.mensaje}`);
}

describe("las muestras: que muerde, y que no muerde de mas", () => {
  it("un compose en regla no produce ni un hallazgo", () => {
    // Sin este contraste, «hoy no hay hallazgos» en los cuatro reales no distinguiria una guarda
    // que funciona de una apagada.
    expect(hallazgosDeLaMuestra("en-regla.compose.yaml")).toEqual([]);
  });

  it("el migrador que corre la imagen de la aplicacion sale nombrado", () => {
    const hallazgos = hallazgosDeLaMuestra("el-migrador-corre-la-imagen-de-la-aplicacion.compose.yaml");
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]).toContain("mercados-migraciones");
    expect(hallazgos[0]).toContain("construir «migrador»");
  });

  it("apuntar a la base de otro sistema sale nombrado, en los tres procesos", () => {
    const hallazgos = hallazgosDeLaMuestra("apunta-a-la-base-de-otro.compose.yaml");
    expect(hallazgos).toHaveLength(3);
    expect(hallazgos.join("\n")).toContain("la base «rentas»");
    expect(hallazgos.join("\n")).toContain("base compartida disfrazada");
  });

  it("reclamar el prefijo de otro sale nombrado", () => {
    const hallazgos = hallazgosDeLaMuestra("reclama-el-prefijo-de-otro.compose.yaml");
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]).toContain("reclama el prefijo «/rentas»");
  });

  it("una sonda que pide lo que la cadena niega sale nombrada", () => {
    const hallazgos = hallazgosDeLaMuestra("la-sonda-pide-lo-que-la-cadena-niega.compose.yaml");
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]).toContain("/actuator/health/liveness");
    expect(hallazgos[0]).toContain("unhealthy");
  });

  it("una red que no es externa sale nombrada", () => {
    const hallazgos = hallazgosDeLaMuestra("la-red-no-es-externa.compose.yaml");
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]).toContain("external=undefined");
  });
});

describe("y muerde sobre los CUATRO de verdad, no solo sobre una muestra", () => {
  /**
   * La mutacion del criterio 2 del encargo, aplicada en memoria sobre el compose real.
   *
   * Una guarda que solo mordiera sobre un archivo inventado no diria nada de los cuatro que se
   * despliegan: lo que se mide aqui es que el sujeto es el compose de verdad.
   */
  it.each(SISTEMAS_DEL_PRODUCTO)(
    "quitarle una variable al backend de «%s» lo pone rojo, nombrandola",
    (sistema) => {
      const roto = clonar(composeDe(sistema));
      const backend = roto.services[servicioDe(sistema, "web")];
      expect(backend, "el compose real no tiene el servicio del backend").toBeDefined();
      delete backend?.environment?.["SGTM_OIDC_JWKS"];

      const hallazgos = hallazgosDe(sistema, roto);
      expect(hallazgos).toHaveLength(1);
      expect(hallazgos[0]).toContain("SGTM_OIDC_JWKS");
      expect(hallazgos[0]).toContain("ADR-0011");
    },
  );

  it.each(SISTEMAS_DEL_PRODUCTO)(
    "y anadirle una que el descriptor no da tambien, en la otra direccion",
    (sistema) => {
      const roto = clonar(composeDe(sistema));
      const backend = roto.services[servicioDe(sistema, "web")];
      if (backend !== undefined) {
        backend.environment = { ...backend.environment, SGTM_ATAJO_LOCAL: "si" };
      }

      const hallazgos = hallazgosDe(sistema, roto);
      expect(hallazgos).toHaveLength(1);
      expect(hallazgos[0]).toContain("SGTM_ATAJO_LOCAL");
      expect(hallazgos[0]).toContain("funciona en local y falla desplegado");
    },
  );

  it("y el anfitrion del motor sigue al servicio de la plataforma, no a un literal", () => {
    // Si alguien renombra el servicio `base` del compose de la plataforma, los cuatro sistemas
    // tienen que seguirle: esta comprobacion es lo que lo convierte en cuatro rojos en vez de en
    // cuatro «Connection refused».
    for (const sistema of SISTEMAS_DEL_PRODUCTO) {
      const hallazgos = desajustes(
        composeDe(sistema),
        esperadoDe(sistema),
        "motor-renombrado",
        rutasPublicas(fuenteDeLaCadena(sistema), `${sistema}/SeguridadWeb.java`),
      );
      expect(hallazgos.length, `en «${sistema}»`).toBeGreaterThan(0);
      expect(hallazgos.map((h) => h.mensaje).join("\n")).toContain("UnknownHostException");
    }
  });
});
