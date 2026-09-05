import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { load } from "js-yaml";
import { raizDelRepositorio } from "../componentes/fuentes";
import { podsDe, type Contenedor, type Manifiesto } from "../componentes/tipos";
import type { DescriptorDeSistema, EntornoDelDescriptor } from "../descriptor/tipos";

/**
 * El compose de cada sistema contra su descriptor (C-18).
 *
 * ## El riesgo, que ADR-0011 ya tenia escrito
 *
 * > «dos formas de levantar el sistema: que se separen, que una variable nueva entre en el
 * > cluster y no en el compose».
 *
 * Con cuatro sistemas se multiplica por cuatro, y hasta C-18 **ninguno tenia compose**: el
 * `README.md` de `infrastructure/despliegue/` afirmaba que si —con un ejemplo y todo— y no
 * existia ni un archivo. Lo que se comprueba aqui es lo que ese README prometia y nadie medía.
 *
 * ## Se DERIVAN las dos mitades y se comparan; no se copia una lista
 *
 * La alternativa —escribir aqui «`catastro` declara estas seis variables»— seria un tercer sitio
 * con la misma verdad, y el que envejece sin que nada se ponga rojo. Una mitad sale de
 * `<sistema>/infrastructure/src/descriptor.ts`, componiendo sus manifiestos como los compone
 * `yarn manifiestos`; la otra, del YAML del compose. Lo que esta funcion produce es la
 * **diferencia**, y cada hallazgo dice de que lado falta la pieza.
 *
 * Lo que NO se compara son los VALORES que por definicion difieren: el anfitrion del motor
 * —`base` en compose, `sgtm-<amb>-postgres.sgtm-<amb>` en el cluster (C-17, punto 1)—, la
 * etiqueta de la imagen y la forma de entregar una clave (`secretKeyRef` frente a `${...}` del
 * `.env`). Lo que si tiene que coincidir es lo que **decide a que base se conecta cada proceso y
 * con que rol**: el nombre de la base, el usuario, y el conjunto de nombres de variables.
 *
 * ## Vive aqui, y no en cada sistema
 *
 * Por lo mismo que `checkout-en-el-espacio-de-trabajo` y `sondas-contra-la-cadena`: este
 * repositorio tiene los cinco clones, el defecto solo existe al comparar las dos mitades, y una
 * guarda repetida cuatro veces se corrige tres.
 */

// ─────────────────────────────────────────────────────────────────────────────
// La forma de un compose, reducida a lo que se compara
// ─────────────────────────────────────────────────────────────────────────────

export interface ServicioDeCompose {
  image?: string;
  build?: { context?: string; dockerfile?: string; target?: string };
  environment?: Record<string, string | null>;
  labels?: string[];
  healthcheck?: { test?: string[] };
  depends_on?: Record<string, { condition?: string }>;
}

export interface ComposeDeSistema {
  name?: string;
  services: Record<string, ServicioDeCompose>;
  networks?: Record<string, { name?: string; external?: boolean }>;
}

/** Un desajuste entre las dos mitades, con el sitio y el remedio dentro del mensaje. */
export interface Desajuste {
  sistema: string;
  /** `web`, `migrador`, `implantacion`, `red`, `prefijo`, `imagen`, `sonda`. */
  donde: string;
  mensaje: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lo que el descriptor dice, derivado de sus manifiestos
// ─────────────────────────────────────────────────────────────────────────────

/** Un proceso del sistema, tal como lo declara el descriptor y como se llama en el compose. */
export interface ProcesoDeclarado {
  /** El servicio del compose que le corresponde. */
  servicio: string;
  /** El objetivo del `Dockerfile` que tiene que construir. */
  objetivo: "aplicacion" | "migrador";
  /** Los NOMBRES de sus variables de entorno, ordenados. */
  variables: string[];
  /** El rol de PostgreSQL con que se conecta, si lo declara. */
  usuario?: string;
  /** El nombre de la base al final de cada URL JDBC que declara. */
  bases: string[];
}

export interface LoQueElDescriptorDice {
  sistema: string;
  prefijo: string;
  /** Su base, y solo la suya. */
  base: string;
  /** Sus imagenes logicas: `<sistema>` y `<sistema>-migrador`. */
  imagenes: readonly string[];
  procesos: Record<string, ProcesoDeclarado>;
}

/**
 * Como se llama en el compose el servicio de cada proceso.
 *
 * **El del backend se llama como el sistema, y no `aplicacion`.** No es estilo: los cuatro
 * composes comparten la red `kamayuk-plataforma` y Compose le da a cada servicio un alias de red
 * con su nombre, asi que cuatro servicios llamados `aplicacion` dejarian ese alias resolviendo a
 * uno cualquiera de los cuatro. Ademas es el nombre que la propia aplicacion da por hecho: el
 * valor por omision de `kamayuk.caja.origenes` es `http://rentas:8080/rentas/api/v1`.
 */
export function servicioDe(sistema: string, proceso: string): string {
  if (proceso === "web") return sistema;
  if (proceso === "migrador") return `${sistema}-migraciones`;
  return `${sistema}-implantacion`;
}

/** El nombre de la base al final de una URL JDBC, o `undefined` si no lo es. */
export function baseDeLaUrl(valor: string): string | undefined {
  const casa = /^jdbc:postgresql:\/\/[^/]+\/([A-Za-z0-9_]+)$/.exec(valor.trim());
  return casa?.[1];
}

/** El anfitrion de una URL JDBC —`base:5432`—, o `undefined`. */
export function anfitrionDeLaUrl(valor: string): string | undefined {
  const casa = /^jdbc:postgresql:\/\/([^/]+)\//.exec(valor.trim());
  return casa?.[1];
}

function procesoDelContenedor(
  sistema: string,
  proceso: string,
  objetivo: "aplicacion" | "migrador",
  c: Contenedor,
): ProcesoDeclarado {
  const env = c.env ?? [];
  const usuario = env.find((v) => v.name === "KAMAYUK_DB_USUARIO" || v.name === "KAMAYUK_DB_OWNER_USUARIO");
  return {
    servicio: servicioDe(sistema, proceso),
    objetivo,
    variables: env.map((v) => v.name).sort(),
    ...(usuario?.value === undefined ? {} : { usuario: usuario.value }),
    bases: env
      .map((v) => (v.value === undefined ? undefined : baseDeLaUrl(v.value)))
      .filter((b): b is string => b !== undefined),
  };
}

/** El unico contenedor principal de un manifiesto de un solo pod. */
function principalDe(ms: Manifiesto[], que: string): Contenedor {
  const pods = ms.flatMap((m) => podsDe(m));
  const contenedores = pods.flatMap((p) => p.pod.containers);
  if (contenedores.length !== 1) {
    throw new Error(
      `«${que}» no tiene exactamente un contenedor principal (tiene ${contenedores.length}). ` +
        "Esta comprobacion empareja UN proceso del descriptor con UN servicio del compose; si " +
        "un sistema pasa a tener dos, hay que decidir con que servicio se compara cada uno en " +
        "vez de dejar que la comparacion elija.",
    );
  }
  return contenedores[0] as Contenedor;
}

/** Lo que el descriptor de un sistema declara, listo para comparar contra su compose. */
export function loQueElDescriptorDice(
  descriptor: DescriptorDeSistema,
  e: EntornoDelDescriptor,
): LoQueElDescriptorDice {
  const sistema = descriptor.sistema;
  return {
    sistema,
    prefijo: descriptor.prefijo,
    base: descriptor.baseDeDatos(e).nombre,
    imagenes: descriptor.imagenes,
    procesos: {
      web: procesoDelContenedor(
        sistema,
        "web",
        "aplicacion",
        principalDe(descriptor.despliegue(e), `${sistema}: despliegue`),
      ),
      migrador: procesoDelContenedor(
        sistema,
        "migrador",
        "migrador",
        principalDe(descriptor.migracion(e), `${sistema}: migracion`),
      ),
      implantacion: procesoDelContenedor(
        sistema,
        "implantacion",
        "aplicacion",
        principalDe(descriptor.implantacion(e), `${sistema}: implantacion`),
      ),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// La comparacion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Los desajustes entre un compose y lo que su descriptor declara.
 *
 * `motor` es el nombre del servicio de PostgreSQL del compose de la PLATAFORMA, y se pasa
 * derivado de ese archivo en vez de escrito aqui: si alguien renombra ese servicio, los cuatro
 * composes tienen que seguirle y esto es lo que lo dice.
 *
 * `rutasPublicas` son las que la cadena de seguridad de ese sistema atiende sin token, leidas de
 * su Java por `sondas-contra-la-cadena`. Es C-17 §2 aplicado al compose: una sonda que pida una
 * ruta que la cadena niega deja el contenedor `unhealthy` **para siempre**, con la aplicacion
 * sana — y aqui ademas cuelga el `depends_on: service_healthy` de quien la espere.
 */
export function desajustes(
  compose: ComposeDeSistema,
  esperado: LoQueElDescriptorDice,
  motor: string,
  rutasPublicas: readonly string[],
): Desajuste[] {
  const hallazgos: Desajuste[] = [];
  const anotar = (donde: string, mensaje: string): void => {
    hallazgos.push({ sistema: esperado.sistema, donde, mensaje });
  };

  if (compose.name !== `kamayuk-${esperado.sistema}`) {
    anotar(
      "proyecto",
      `el compose se llama «${compose.name ?? "(sin name)"}» y tenia que llamarse ` +
        `«kamayuk-${esperado.sistema}»: el nombre del proyecto es lo que separa los contenedores ` +
        "de un sistema de los de otro cuando los cuatro comparten red.",
    );
  }

  for (const [proceso, declarado] of Object.entries(esperado.procesos)) {
    const servicio = compose.services[declarado.servicio];
    if (servicio === undefined) {
      anotar(
        proceso,
        `el compose no tiene ningun servicio «${declarado.servicio}», y el descriptor declara ` +
          `ese proceso. Sin el, «${esperado.sistema}» se levanta a medias: ` +
          (proceso === "migrador"
            ? "sin migrar, y la aplicacion arranca con `spring.flyway.enabled: false` sobre una base vacia."
            : proceso === "implantacion"
              ? "sin fila de `municipalidad`, y entonces no hay municipalidad_id que poner en ningun token."
              : "sin backend."),
      );
      continue;
    }

    const enElCompose = Object.keys(servicio.environment ?? {}).sort();
    for (const variable of declarado.variables) {
      if (!enElCompose.includes(variable)) {
        anotar(
          proceso,
          `«${declarado.servicio}» no declara «${variable}», y el descriptor se la da al mismo ` +
            "proceso en el cluster. Es exactamente la deriva que ADR-0011 anoto: una variable " +
            "nueva que entra en el cluster y no en el compose.",
        );
      }
    }
    for (const variable of enElCompose) {
      if (!declarado.variables.includes(variable)) {
        anotar(
          proceso,
          `«${declarado.servicio}» declara «${variable}» y el descriptor no se la da en el ` +
            "cluster. La deriva en la otra direccion es peor de leer: el sistema funciona en " +
            "local y falla desplegado, con una configuracion que nadie echa de menos.",
        );
      }
    }

    // El objetivo del Dockerfile: la imagen del migrador no es la de la aplicacion (C-14 §1).
    const objetivo = servicio.build?.target;
    if (objetivo !== declarado.objetivo) {
      anotar(
        proceso,
        `«${declarado.servicio}» construye el objetivo «${objetivo ?? "(ninguno)"}» y tenia que ` +
          `construir «${declarado.objetivo}». Las credenciales de \`sgtm_owner\` existen durante ` +
          "la migracion y desaparecen con ella: cruzarlos le da DDL sobre el padron a un proceso " +
          "de larga vida expuesto en HTTP.",
      );
    }

    // El rol con que se conecta.
    const usuarioEnCompose =
      servicio.environment?.["KAMAYUK_DB_USUARIO"] ?? servicio.environment?.["KAMAYUK_DB_OWNER_USUARIO"];
    if (declarado.usuario !== undefined && usuarioEnCompose !== declarado.usuario) {
      anotar(
        proceso,
        `«${declarado.servicio}» se conecta como «${usuarioEnCompose ?? "(nadie)"}» y el ` +
          `descriptor lo conecta como «${declarado.usuario}».`,
      );
    }

    // Su base, y solo la suya; y el anfitrion, que en compose es el servicio de la plataforma.
    for (const [nombre, valor] of Object.entries(servicio.environment ?? {})) {
      if (valor === null || valor === undefined) continue;
      const base = baseDeLaUrl(valor);
      if (base === undefined) continue;
      if (base !== esperado.base) {
        anotar(
          proceso,
          `«${declarado.servicio}» apunta «${nombre}» a la base «${base}», y la de ` +
            `«${esperado.sistema}» es «${esperado.base}». Pedir la de otro sistema es una base ` +
            "compartida disfrazada (prohibicion (c)).",
        );
      }
      const anfitrion = anfitrionDeLaUrl(valor);
      if (anfitrion !== `${motor}:5432`) {
        anotar(
          proceso,
          `«${declarado.servicio}» busca el motor en «${anfitrion ?? "?"}» y en este compose el ` +
            `motor es el servicio «${motor}» de la plataforma. Un nombre que no existe en la red ` +
            "da `UnknownHostException`, que es el punto 1 de C-17 en la otra direccion.",
        );
      }
    }
  }

  // El prefijo de Traefik: el suyo, y solo el suyo (prohibicion (a)).
  const etiquetas = compose.services[esperado.procesos["web"]?.servicio ?? ""]?.labels ?? [];
  const reglas = etiquetas.filter((l) => l.includes("PathPrefix"));
  if (reglas.length === 0) {
    anotar(
      "prefijo",
      `«${esperado.sistema}» no publica ninguna regla \`PathPrefix\` de Traefik, asi que no se ` +
        "llega a el por el ingreso — y esa es la unica puerta, porque estos composes no publican " +
        "ningun puerto (ADR-0030 §2).",
    );
  }
  for (const regla of reglas) {
    const pedido = /PathPrefix\(`\/([A-Za-z0-9_-]+)`\)/.exec(regla)?.[1];
    if (pedido !== esperado.prefijo) {
      anotar(
        "prefijo",
        `«${esperado.sistema}» reclama el prefijo «/${pedido ?? "?"}» y el suyo es ` +
          `«/${esperado.prefijo}». Reclamar el de otro NO falla: se lo queda, y las peticiones ` +
          "dejan de llegar a su dueno.",
      );
    }
  }

  // La sonda, contra lo que la cadena atiende sin token (C-17 §2).
  const sonda = compose.services[esperado.procesos["web"]?.servicio ?? ""]?.healthcheck?.test ?? [];
  const rutaDeLaSonda = /https?:\/\/[^/\s]+(\/[^\s"']*)/.exec(sonda.join(" "))?.[1];
  if (rutaDeLaSonda === undefined) {
    anotar(
      "sonda",
      `«${esperado.sistema}» no declara ninguna sonda HTTP en su compose. Sin ella, ` +
        "`depends_on: service_healthy` no puede significar nada y `up --wait` da por bueno un " +
        "contenedor que arranco y no llega a su base.",
    );
  } else if (!rutasPublicas.includes(rutaDeLaSonda)) {
    anotar(
      "sonda",
      `la sonda de «${esperado.sistema}» pide «${rutaDeLaSonda}» y su cadena de seguridad solo ` +
        `atiende sin token ${rutasPublicas.map((r) => `«${r}»`).join(", ")}. Contestaria 401 y el ` +
        "contenedor se quedaria `unhealthy` PARA SIEMPRE, con la aplicacion sana (C-17, punto 2).",
    );
  }

  // La red: la de la plataforma, y externa.
  const red = compose.networks?.["default"];
  if (red?.name !== "kamayuk-plataforma" || red.external !== true) {
    anotar(
      "red",
      `«${esperado.sistema}» no se engancha a la red externa «kamayuk-plataforma» (declara ` +
        `«${red?.name ?? "(ninguna)"}», external=${String(red?.external)}). Sin ` +
        "`external: true` Compose crea una SEGUNDA red con el mismo nombre y los servicios no se " +
        "ven: el sintoma es «Connection refused» a la base, que se lee como que el motor no esta.",
    );
  }

  return hallazgos;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lectura de archivos
// ─────────────────────────────────────────────────────────────────────────────

/** Donde vive el compose de un sistema, en su clon hermano. */
export function rutaDelCompose(sistema: string): string {
  return join(resolve(raizDelRepositorio(), "..", sistema), "despliegue", "compose.yaml");
}

/**
 * El compose de un sistema.
 *
 * Si no esta, **lanza diciendo cual y por que**, en vez de devolver nada que comparar. Un clon
 * sin compose pasaria esta comprobacion en verde sin haber mirado nada, que es el modo de fallo
 * de #188 con `verificar-cuadros.mjs` — y es el estado exacto en que estaban los cuatro hasta
 * C-18, con el README afirmando lo contrario.
 */
export function composeDeSistema(sistema: string): ComposeDeSistema {
  const ruta = rutaDelCompose(sistema);
  if (!existsSync(ruta)) {
    throw new Error(
      `No esta «${ruta}». Cada sistema levanta LO SUYO contra el compose de la plataforma ` +
        "(ADR-0031 §4), y sin ese archivo no hay con que comparar su descriptor.\n" +
        `  Remedio: git clone https://github.com/hneyra/${sistema}\n` +
        "  Esta comprobacion NO se salta: «no se pudo comprobar» no es «esta bien».",
    );
  }
  return load(readFileSync(ruta, "utf8")) as ComposeDeSistema;
}

/**
 * El nombre del servicio de PostgreSQL en el compose de la plataforma.
 *
 * Se DERIVA de ese archivo —el unico servicio cuya imagen es un PostgreSQL— y no se escribe
 * `base` aqui: si alguien lo renombra, los cuatro composes tienen que seguirle, y esta funcion
 * es lo que lo convierte en cuatro rojos en vez de en cuatro «Connection refused».
 */
export function motorDeLaPlataforma(): string {
  const ruta = join(raizDelRepositorio(), "despliegue/plataforma.compose.yaml");
  const plataforma = load(readFileSync(ruta, "utf8")) as ComposeDeSistema;
  const candidatos = Object.entries(plataforma.services).filter(([, s]) =>
    /postgis|postgres/.test(s.image ?? ""),
  );
  if (candidatos.length !== 1) {
    throw new Error(
      `«${ruta}» tiene ${candidatos.length} servicios que parecen PostgreSQL y hace falta ` +
        "exactamente uno: es el anfitrion al que apuntan los cuatro sistemas.",
    );
  }
  return candidatos[0]?.[0] as string;
}

/**
 * Los servicios que cada compose pondria en la red compartida, por su alias.
 *
 * Compose le da a cada servicio un alias de red con su nombre. Los cuatro sistemas y la
 * plataforma comparten UNA red, asi que dos servicios homonimos en dos proyectos distintos dejan
 * ese alias resolviendo a uno cualquiera de los dos — y el sintoma no es un error, es una
 * peticion que a veces llega a quien no era.
 */
export function aliasRepetidos(
  composes: readonly { proyecto: string; compose: ComposeDeSistema }[],
): string[] {
  const vistos = new Map<string, string[]>();
  for (const { proyecto, compose } of composes) {
    for (const servicio of Object.keys(compose.services)) {
      vistos.set(servicio, [...(vistos.get(servicio) ?? []), proyecto]);
    }
  }
  return [...vistos.entries()]
    .filter(([, proyectos]) => proyectos.length > 1)
    .map(([servicio, proyectos]) => `«${servicio}» lo declaran ${proyectos.join(" y ")}`)
    .sort();
}

/**
 * Los anfitriones HTTP que un compose nombra en sus variables y que nadie sirve.
 *
 * `KAMAYUK_CAJA_ORIGENES` apunta a `http://rentas:8080/...`, y ese `rentas` es el nombre de un
 * servicio de OTRO compose. Si ese servicio se renombra, la caja sigue arrancando y el evento de
 * cada pago se queda sin entregar, que es un fallo silencioso por definicion.
 */
export function anfitrionesQueNadieSirve(
  compose: ComposeDeSistema,
  conocidos: readonly string[],
): string[] {
  const faltan = new Set<string>();
  for (const servicio of Object.values(compose.services)) {
    for (const valor of Object.values(servicio.environment ?? {})) {
      if (typeof valor !== "string") continue;
      for (const casa of valor.matchAll(/https?:\/\/([A-Za-z0-9_-]+)(?::\d+)?/g)) {
        const anfitrion = casa[1];
        if (anfitrion === undefined || anfitrion === "localhost") continue;
        if (!conocidos.includes(anfitrion)) faltan.add(anfitrion);
      }
    }
  }
  return [...faltan].sort();
}
