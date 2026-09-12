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
  BACKENDS_CON_NOMBRE_PROPIO,
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

/**
 * Lo que un descriptor DECLARA y su compose todavia no levanta, con su motivo y su issue.
 *
 * ## Por que existe, medido
 *
 * `catastro`#104 anade `catastro-interfaz` a `descriptor.imagenes` —la despliega, la renombra y le
 * quita el `proxy_pass`— y **no toca `despliegue/compose.yaml`**, que sigue trayendo tres
 * servicios. Los otros cuatro sistemas si lo traen: `rentas-interfaz`, `caja-interfaz` y, desde
 * `normativa`#41, `normativa-interfaz`.
 *
 * Es un desajuste REAL y la guarda tiene razon: C-18 dice que las dos formas de levantar el
 * sistema tienen que decir lo mismo, y con el servicio ausente un `docker compose up` deja la
 * instalacion local **sin la pantalla que el clúster si despliega** — o sea que lo que se prueba
 * en local no es lo que se despliega, y justo en la pieza recien estrenada.
 *
 * ## Y por que se declaraba en vez de arreglarse
 *
 * El archivo que faltaba estaba en el clon de `catastro`, no aqui: este repositorio compone, no
 * escribe el compose de nadie. Un rojo permanente en `infrastructure` por el trabajo pendiente de
 * otro repositorio es lo que `C-2` y `F` decidieron no hacer —el mismo criterio que el censo de
 * imagenes huerfanas—, y callarlo no era una opcion: quedaba **nombrado**, con su issue, y **se
 * comprueba en las dos direcciones**.
 *
 * ## Y esta VACIA, que es como termina una deuda declarada
 *
 * `catastro`#105 anadio el servicio el 2026-09-12, y la comprobacion de las dos direcciones hizo
 * exactamente lo que se escribio para que hiciera: se puso **roja pidiendo que se retirara la
 * entrada**, en vez de dejarla envejecer eximiendo a algo que ya nadie necesita eximir. Es la
 * direccion de #27.
 *
 * Se queda el mecanismo, no la entrada: el dia que otro descriptor declare una imagen cuyo
 * compose no levanta, esto es donde tiene que venir a decirse. La clave es el nombre de la imagen
 * tal como el descriptor la declara —`catastro-interfaz` era la suya—, que es el mismo nombre que
 * el compose tiene que dar a su servicio.
 */
const IMAGEN_SIN_SERVICIO_EN_EL_COMPOSE: Record<string, string> = {};

// ─────────────────────────────────────────────────────────────────────────────
// Los cuatro, contra su descriptor
// ─────────────────────────────────────────────────────────────────────────────

describe("cada sistema trae su compose, y dice lo mismo que su descriptor", () => {
  it.each(SISTEMAS_DEL_PRODUCTO)("«%s» no tiene ningun desajuste", (sistema) => {
    expect(hallazgosDe(sistema)).toEqual([]);
  });

  it.each(SISTEMAS_DEL_PRODUCTO)("«%s» trae sus procesos y ninguno mas", (sistema) => {
    // Ni uno menos —un compose sin migrador levanta la aplicacion sobre una base vacia— ni uno
    // de mas: un servicio que el descriptor no despliega es configuracion que solo existe en
    // local, y entonces «funciona en mi maquina» deja de ser una broma.
    //
    // Los tres del jar son siempre; lo demas **se deriva del descriptor** y no se escribe aqui.
    // Eran tres fijos hasta que `caja` estreno su interfaz de ventanilla (#16), que trae su
    // cuarto servicio; con la lista escrita a mano el rojo decia «un servicio de mas» de un
    // compose que estaba bien.
    const delJar = ["web", "migrador", "implantacion"].map((p) => servicioDe(sistema, p));
    const extras = (
      SISTEMAS.find((s) => s.descriptor.sistema === sistema)?.descriptor.imagenes ?? []
    )
      .filter((i) => i !== sistema && i !== `${sistema}-migrador`)
      .filter((i) => IMAGEN_SIN_SERVICIO_EN_EL_COMPOSE[i] === undefined);

    expect(Object.keys(composeDe(sistema)).length).toBeGreaterThan(0);
    expect(Object.keys(composeDe(sistema).services).sort()).toEqual(
      [...delJar, ...extras].sort(),
    );
  });

  /**
   * Y la otra direccion de esa lista: una deuda que ya se pago sale roja.
   *
   * Es #27 aplicado aqui, y hace falta por lo mismo que en las demas listas «con motivo» de este
   * repositorio: una entrada que ya no describe ningun hueco **exime a un servicio futuro** que
   * nadie decidio eximir, y ademas deja escrito que algo esta roto cuando ya se arreglo. Se
   * comprueba nombrando el archivo, para que el rojo diga a que clon hay que ir.
   */
  it("ninguna imagen declarada como «sin servicio» tiene ya su servicio", () => {
    const yaEstan = Object.keys(IMAGEN_SIN_SERVICIO_EN_EL_COMPOSE).filter((imagen) => {
      const sistema = SISTEMAS_DEL_PRODUCTO.find((s) => imagen.startsWith(`${s}-`));
      if (sistema === undefined) return true;
      return Object.keys(composeDe(sistema).services).includes(imagen);
    });
    expect(
      yaEstan,
      "estas imagenes estan declaradas como «su compose todavia no la levanta» y su compose ya " +
        "trae el servicio:\n  " +
        yaEstan.join("\n  ") +
        "\n  La deuda se pago: hay que retirar la entrada de `IMAGEN_SIN_SERVICIO_EN_EL_COMPOSE` " +
        "y cerrar su issue. Mientras siga escrita, el servicio que nazca manana con ese nombre " +
        "queda exento sin que nadie lo haya decidido.",
    ).toEqual([]);
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
   * La UNICA excepcion a «el backend se llama como su sistema», en las dos direcciones.
   *
   * `identidad` (ADR-0039) la tiene porque el compose de la plataforma **ya** publica un
   * servicio llamado `identidad`, y es Keycloak: con los dos en la red `kamayuk-plataforma` ese
   * alias lo registran dos contenedores y el DNS de Docker reparte entre ellos, de modo que los
   * cinco backends —el suyo incluido— pedirian su JWKS a un backend de Spring la mitad de las
   * veces. Todo token invalido, de forma intermitente.
   *
   * Se fija **por los dos lados a proposito**. La direccion util —que `identidad` la tenga— sola
   * no basta: sin la contraria, la excepcion se convertiria en un mapa donde cabe cualquiera y
   * el siguiente sistema que quisiera llamarse distinto entraria sin escribir su motivo. Y la
   * contraria sola tampoco: pasaria con el mapa vacio, o sea con el defecto puesto.
   *
   * La colision NO se afirma aqui de memoria: se lee del compose de la plataforma, para que el
   * dia que Keycloak deje de llamarse asi esta excepcion se pueda retirar en vez de quedarse.
   */
  describe("el servicio del backend, y su unica excepcion", () => {
    it("«identidad» se llama `identidad-sistema`, porque Keycloak ya ocupa ese alias", () => {
      const plataforma = load(
        readFileSync(join(raizDelRepositorio(), "despliegue/plataforma.compose.yaml"), "utf8"),
      ) as ComposeDeSistema;
      expect(
        Object.keys(plataforma.services),
        "la plataforma ya no publica un servicio «identidad»: si Keycloak se renombro, esta " +
          "excepcion sobra y hay que retirarla de `BACKEND_QUE_CHOCA_CON_LA_PLATAFORMA`",
      ).toContain("identidad");

      expect(servicioDe("identidad", "web")).toBe("identidad-sistema");
      // Y solo el backend: los otros dos procesos no chocan con nada.
      expect(servicioDe("identidad", "migrador")).toBe("identidad-migraciones");
      expect(servicioDe("identidad", "implantacion")).toBe("identidad-implantacion");
    });

    it("y NINGUN otro sistema tiene excepcion: la regla sigue siendo la regla", () => {
      expect(
        Object.keys(BACKENDS_CON_NOMBRE_PROPIO).sort(),
        "un sistema mas con nombre propio de backend. La regla es que el servicio del backend " +
          "se llama COMO SU SISTEMA, y la unica excepcion es la colision con un servicio de la " +
          "plataforma. Si hay otra, tiene que traer su motivo escrito aqui y en `servicioDe`.",
      ).toEqual(["identidad"]);
      for (const sistema of SISTEMAS_DEL_PRODUCTO) {
        if (sistema === "identidad") continue;
        expect(servicioDe(sistema, "web")).toBe(sistema);
      }
    });
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
      variables: ["KAMAYUK_DB_CLAVE", "KAMAYUK_DB_URL", "KAMAYUK_DB_USUARIO", "SPRING_PROFILES_ACTIVE"],
      usuario: "kamayuk_app",
      bases: ["mercados"],
    },
    migrador: {
      servicio: "mercados-migraciones",
      objetivo: "migrador",
      variables: ["KAMAYUK_DB_OWNER_CLAVE", "KAMAYUK_DB_OWNER_USUARIO", "KAMAYUK_DB_URL"],
      usuario: "kamayuk_owner",
      bases: ["mercados"],
    },
    implantacion: {
      servicio: "mercados-implantacion",
      objetivo: "aplicacion",
      variables: ["KAMAYUK_DB_CLAVE", "KAMAYUK_DB_URL", "KAMAYUK_DB_USUARIO", "SPRING_PROFILES_ACTIVE"],
      usuario: "kamayuk_app",
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
    expect(hallazgos[0]).toContain("reclama «/rentas»");
  });

  /**
   * El reparto del prefijo entre dos routers, que I-44 estreno y esta guarda no sabia leer.
   *
   * Las cuatro muestras van juntas a proposito: la primera es el CONTRASTE —sin ella, una
   * comprobacion que rechazara todo reparto pasaria igual de verde— y las otras tres son las
   * tres formas en que un reparto se rompe sin que nadie lo vea desde fuera.
   */
  it("repartir SU prefijo entre dos routers, con prioridad, no produce ni un hallazgo", () => {
    expect(hallazgosDeLaMuestra("reparte-su-prefijo-en-regla.compose.yaml")).toEqual([]);
  });

  it("repartirlo sin declarar prioridad sale nombrado", () => {
    const hallazgos = hallazgosDeLaMuestra("reparte-su-prefijo-sin-prioridad.compose.yaml");
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]).toContain("no declara `priority`");
    expect(hallazgos[0]).toContain("POR ACCIDENTE");
  });

  /**
   * Y el caso PEOR del reparto, que era el hueco: los dos routers con el MISMO prefijo.
   *
   * La comprobacion del reparto solo miraba cuando un prefijo es estrictamente mas especifico
   * que otro, asi que dos reglas identicas se le escapaban enteras — y son las que dejan a un
   * servicio inalcanzable sin que falle nada. Lo destapo `catastro`#105.
   */
  it("dos routers con el mismo prefijo salen nombrados, y `priority` no es el remedio", () => {
    const hallazgos = hallazgosDeLaMuestra("dos-routers-con-el-mismo-prefijo.compose.yaml");
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]).toContain("el MISMO prefijo «/mercados»");
    expect(hallazgos[0]).toContain("«mercados-interfaz»");
    expect(hallazgos[0]).toContain("no recibira nada nunca");
  });

  it("repartirlo al reves sale nombrado, con las dos prioridades dentro", () => {
    const hallazgos = hallazgosDeLaMuestra("reparte-su-prefijo-al-reves.compose.yaml");
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]).toContain("da prioridad 10 a «mercados»");
    expect(hallazgos[0]).toContain("20 a «mercados-interfaz»");
  });

  it("y el prefijo de otro reclamado DESDE LA INTERFAZ tambien sale, que es la mitad nueva", () => {
    const hallazgos = hallazgosDeLaMuestra("la-interfaz-reclama-el-prefijo-de-otro.compose.yaml");
    expect(hallazgos).toHaveLength(1);
    expect(hallazgos[0]).toContain("reclama «/rentas» en el router «mercados-interfaz»");
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
      delete backend?.environment?.["KAMAYUK_OIDC_JWKS"];

      const hallazgos = hallazgosDe(sistema, roto);
      expect(hallazgos).toHaveLength(1);
      expect(hallazgos[0]).toContain("KAMAYUK_OIDC_JWKS");
      expect(hallazgos[0]).toContain("ADR-0011");
    },
  );

  it.each(SISTEMAS_DEL_PRODUCTO)(
    "y anadirle una que el descriptor no da tambien, en la otra direccion",
    (sistema) => {
      const roto = clonar(composeDe(sistema));
      const backend = roto.services[servicioDe(sistema, "web")];
      if (backend !== undefined) {
        backend.environment = { ...backend.environment, KAMAYUK_ATAJO_LOCAL: "si" };
      }

      const hallazgos = hallazgosDe(sistema, roto);
      expect(hallazgos).toHaveLength(1);
      expect(hallazgos[0]).toContain("KAMAYUK_ATAJO_LOCAL");
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
