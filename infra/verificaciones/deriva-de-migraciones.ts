import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { construirManifiestos } from "../componentes";
import { raizDelRepositorio } from "../componentes/fuentes";
import type { Environment } from "../config";
import { invariantesDe } from "./stacks";

/**
 * La deriva entre lo que el ambiente DECLARA desplegar y lo que el repositorio del
 * sistema desplegado declara hoy (issue #675, y su reencuadre de P6).
 *
 * ## El hueco que cierra, medido y no supuesto
 *
 * `verificaciones/ambiente/verificar-el-ambiente.sh` (#434) compara dos numeros: las
 * migraciones que la base tiene aplicadas y las que trae el `sha` que
 * `applicationBootstrapVersion` declara. Ese guion corrio contra `stg` el 2026-09-01 y
 * dijo, con toda la razon:
 *
 *     migraciones aplicadas: 48 - las que trae la version declarada: 48
 *     OK   el esquema esta al dia con la version declarada
 *
 * Y sin embargo `stg` corria **48 de las 61** que `main` declaraba ese mismo dia. Las
 * dos afirmaciones son ciertas a la vez porque son de dos cosas distintas: el ambiente
 * estaba al dia **con su version declarada**, y la version declarada llevaba desde el
 * 2026-08-29 sin moverse. El tercer numero no lo comparaba nadie.
 *
 * Y la deriva no se ve por ningun otro sitio, porque **el Job de migracion lleva la
 * version en el nombre** (`sufijoDeVersion()`, `componentes/Migracion.ts`). Una version
 * NUEVA no modifica el Job que hay: **crea otro**. Y con la misma version declarada no
 * hay ninguno que crear, asi que `pulumi up` sale en verde sin tocar nada —«76 unchanged»
 * en el ultimo `up` de prod—.
 *
 * ## Lo que P6 tuvo que reencuadrar: DE QUE REPOSITORIO es el `sha`
 *
 * Hasta el corte, las tres cosas que esta comprobacion cruza —el `Pulumi.<ambiente>.yaml`,
 * el `sha` declarado y el directorio de migraciones— vivian en **el mismo `git log`**, asi
 * que resolver el `sha` «en el repositorio en que vivo» era correcto sin decirlo.
 *
 * Con `infrastructure` separado dejo de serlo, y el sintoma fue exacto: seis pruebas en
 * rojo con «`c755de21…` no esta en este clon». La guarda tenia razon —se nego a inventar
 * un numero— y lo que estaba mal era la premisa. Medido:
 *
 *   - `c755de21…` **es un commit de `sgtm`**: `git -C ../sgtm cat-file -t` lo encuentra,
 *     esta en su `origin/main` y trae 68 migraciones, que son exactamente las 68 que
 *     `sgtm origin/main` declara. O sea que **no hay deriva**, y el rojo no era de deriva.
 *   - la historia de `infrastructure` empieza en su propio commit inicial, y su
 *     `backend/sgtm-esquema/` es **una copia historica que nadie aplica** (CLAUDE.md lo
 *     dice). Comparar `origin/main` de aqui contra un `sha` de alli es cruzar dos cosas
 *     que no se pueden comparar.
 *
 * Asi que la version que un ambiente declara es una revision **del repositorio que
 * construye la imagen del migrador que ese ambiente corre**, y ese repositorio no tiene
 * por que ser este. {@link SISTEMAS} lo dice por sistema, y {@link sistemasDesplegados}
 * lo **deriva de los manifiestos** en vez de creerselo: hoy el despliegue construye un
 * solo `*-migrador`, y el dia que construya cuatro esta comprobacion se pone roja
 * nombrando al que no tenga version declarada.
 *
 * ## Por que la referencia es `origin/main` y no el arbol de trabajo
 *
 * Porque `applicationBootstrapVersion` tiene que ser un `sha` **con imagenes
 * publicadas**, y `publicar-imagenes.yml` las publica al integrar en `main`: un PR no
 * puede conocer su propio `sha` de integracion. Comparar contra el arbol de trabajo
 * dejaria en rojo, por construccion, a todo PR que anada una migracion —su autor no
 * tendria ninguna version a la que subir—, y una comprobacion que no se puede satisfacer
 * se acaba desactivando.
 *
 * Contra `origin/main` el reparto es el correcto:
 *
 *   - el PR que anade la migracion esta en **verde**: `origin/main` todavia no la tiene;
 *   - en cuanto ese PR se integra, `origin/main` la tiene y esto se pone **rojo**, que es
 *     el aviso que faltaba;
 *   - el PR que sube la version lo devuelve a verde en una linea.
 *
 * La deriva sigue pudiendo existir —hace falta un PR mas para cerrarla—, pero deja de
 * poder crecer **en silencio**, que es lo que el issue #675 pide.
 *
 * ## Lo que esto cuesta, y quien lo paga desde #720
 *
 * Entre el merge de la migracion y el momento en que la version sube, **todo PR que toque
 * las rutas de `infra.yml` sale rojo aqui**, y su autor no es quien lo causo. Es
 * deliberado y es la parte cara del diseño: la alternativa —avisar sin bloquear— es la
 * que ya existia de hecho, porque nadie miraba, y trece migraciones despues el ambiente
 * corria otro sistema.
 *
 * Desde #720 la linea la escribe el merge (`.github/workflows/declarar-version.yml`), al
 * terminar `publicar-imagenes.yml` en verde, que es el unico momento en que se saben las
 * dos cosas que hacen falta —el `sha` y que sus imagenes existen—.
 *
 * ## El pedazo de #675 que el corte SE LLEVA, y hay que decirlo
 *
 * La otra mitad de #675 era que el flujo **corriera** cuando llega una migracion: el
 * filtro `paths` de `infra.yml` no nombraba el directorio de migraciones, asi que
 * integrar una no disparaba nada. Ese filtro **solo puede nombrar rutas de este
 * repositorio**, y las migraciones que se despliegan ya no estan aqui. Con el corte, una
 * migracion de `rentas` no puede disparar el flujo de `infrastructure`: eso hay que
 * cerrarlo con un disparo entre repositorios (`repository_dispatch`) y **no esta hecho**.
 * `deriva-de-migraciones.test.ts` lo fija en una prueba para que no se olvide.
 */

/** Un sistema desplegable: donde vive su esquema y cual es su revision de referencia. */
export interface Sistema {
  /** Como se llama en el nombre de su imagen: `<repositorio>/<nombre>-migrador:<sha>`. */
  nombre: string;
  /** El directorio del clon, relativo al padre de este repositorio. */
  clon: string;
  /** Donde viven sus migraciones de Flyway, relativo a la raiz de ese clon. */
  migraciones: string;
}

/**
 * Los sistemas cuyo esquema alguien podria desplegar, con donde vive cada uno.
 *
 * **Ninguna entrada se despliega por estar aqui.** Quien decide eso es
 * {@link sistemasDesplegados}, que lo lee de los manifiestos. Esta tabla solo contesta
 * «si se desplegara, ¿de que `git log` sale su `sha`?», y por eso incluye a los cuatro
 * sistemas del corte aunque hoy no se despliegue ninguno: el dia que el primero entre,
 * la comprobacion sabe donde mirar sin que nadie tenga que acordarse.
 *
 * `sgtm` sigue aqui porque **es el que se despliega hoy**. No es historia: `Migracion.ts`
 * construye `sgtm-migrador` y `Aplicacion.ts` construye `sgtm-aplicacion`.
 */
export const SISTEMAS: readonly Sistema[] = [
  { nombre: "sgtm", clon: "sgtm", migraciones: "backend/sgtm-esquema/src/main/resources/db/migration/" },
  {
    nombre: "rentas",
    clon: "rentas",
    migraciones: "backend/kamayuk-rentas-esquema/src/main/resources/db/migration/",
  },
  {
    nombre: "catastro",
    clon: "catastro",
    migraciones: "backend/kamayuk-catastro-esquema/src/main/resources/db/migration/",
  },
  {
    nombre: "normativa",
    clon: "normativa",
    migraciones: "backend/kamayuk-normativa-esquema/src/main/resources/db/migration/",
  },
  {
    nombre: "caja",
    clon: "caja",
    migraciones: "backend/kamayuk-caja-esquema/src/main/resources/db/migration/",
  },
] as const;

/**
 * La revision de referencia: lo que el repositorio del sistema declara hoy.
 *
 * `origin/main` y no `HEAD`, por lo que dice el comentario de arriba. Es una constante
 * con nombre para que salga en el mensaje y para que cambiarla sea deliberado.
 */
export const REVISION_DE_REFERENCIA = "origin/main";

export interface DerivaDeMigraciones {
  ambiente: Environment;
  /** El sistema cuyo esquema despliega ese ambiente. */
  sistema: string;
  /** El `sha` que la configuracion del stack declara para el. */
  version: string;
  /** Migraciones que trae ese `sha`. */
  traeLaVersion: number;
  /** Migraciones que declara la revision de referencia. */
  declaraLaReferencia: number;
  /** Las que la referencia tiene y la version declarada no. Ordenadas. */
  faltan: string[];
  /**
   * Si ese `sha` esta en la historia de la revision de referencia.
   *
   * No es lo mismo que «existe en el clon», que es lo unico que `migracionesDe`
   * comprueba. Un `sha` de una rama que nunca se integro existe, se puede contar y
   * podria hasta traer las mismas migraciones —y **no tiene imagenes**, porque
   * `publicar-imagenes.yml` solo publica al integrar en `main`—: el Job de migracion
   * pediria una etiqueta que nadie construyo.
   */
  enLaHistoria: boolean;
}

/** El sistema de {@link SISTEMAS} con ese nombre. Lanza nombrando los que hay. */
export function sistemaLlamado(nombre: string): Sistema {
  const sistema = SISTEMAS.find((candidato) => candidato.nombre === nombre);
  if (sistema === undefined) {
    throw new Error(
      `«${nombre}» no esta en SISTEMAS, asi que no se sabe de que repositorio es su ` +
        `\`sha\` ni donde viven sus migraciones. Los declarados son: ` +
        `${SISTEMAS.map((s) => s.nombre).join(", ")}.\n` +
        "  Un sistema que se despliega y no esta aqui es una deriva que nadie puede medir.",
    );
  }
  return sistema;
}

/**
 * La raiz del clon de ese sistema, que **no tiene por que ser este repositorio**.
 *
 * Los cinco clones son hermanos, igual que asume `settings.gradle.kts` de los cuatro
 * backends para `librerias-backend`. Si falta, el error lo dice con el comando: replegarse
 * a «no se puede medir, paso en verde» es exactamente lo que #675 existe para impedir.
 */
export function clonDe(sistema: Sistema): string {
  const raiz = resolve(raizDelRepositorio(), "..", sistema.clon);
  if (!existsSync(join(raiz, ".git"))) {
    throw new Error(
      `No esta el clon de «${sistema.nombre}» en «${raiz}», asi que no se puede saber ` +
        "que migraciones declara ni si la version desplegada las trae.\n" +
        `  Remedio: git clone https://github.com/hneyra/${sistema.clon} ${raiz}\n` +
        "  Esta comprobacion NO se salta: un ambiente cuya deriva no se puede medir es " +
        "exactamente el estado que #675 encontro, y paso ocho meses en verde.",
    );
  }
  return raiz;
}

/**
 * Las migraciones que un `commit` trae, contadas en el arbol de git de ESE `commit`.
 *
 * Nunca sobre el arbol de trabajo: es la misma cautela que `verificar-el-ambiente.sh`
 * escribio primero. Contar los archivos que hay en el disco seria contar OTRA version, y
 * un numero plausible y equivocado es peor que ninguno.
 */
export function migracionesDe(revision: string, sistema: Sistema): string[] {
  const raiz = clonDe(sistema);
  try {
    execFileSync("git", ["-C", raiz, "rev-parse", "--verify", "--quiet", `${revision}^{commit}`], {
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    throw new Error(
      `«${revision}» no esta en el clon de «${sistema.nombre}» (${raiz}), asi que no se ` +
        "puede saber cuantas migraciones trae. Esta comprobacion NO se salta: un numero " +
        "inventado seria peor que ninguno.\n" +
        "  En CI, `actions/checkout` necesita `fetch-depth: 0`.\n" +
        "  En local, hay que traerse la revision (fetch de origin) antes de correr esto.",
    );
  }

  const salida = execFileSync(
    "git",
    ["-C", raiz, "ls-tree", "--name-only", revision, sistema.migraciones],
    { encoding: "utf8" },
  );

  return salida
    .split("\n")
    .filter((linea) => linea.endsWith(".sql"))
    .map((linea) => linea.slice(sistema.migraciones.length))
    .sort();
}

/**
 * Si `version` es antepasado de `referencia`, en el clon de ese sistema.
 *
 * `git merge-base --is-ancestor` sale con 0 cuando lo es y con 1 cuando no; las dos
 * revisiones se comprueban antes con `migracionesDe`, asi que aqui no queda ningun otro
 * codigo de salida que interpretar.
 */
export function estaEnLaHistoriaDe(
  version: string,
  referencia: string,
  sistema: Sistema,
): boolean {
  try {
    execFileSync("git", ["-C", clonDe(sistema), "merge-base", "--is-ancestor", version, referencia], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Las migraciones que `referencia` declara y `version` no trae.
 *
 * La misma cuenta que `derivaDeMigraciones` hace para un ambiente, expuesta para poder
 * hacerla sobre un `sha` que todavia no esta declarado en ningun stack: es lo que
 * `herramientas/declarar-version.ts` necesita para no declarar un candidato que dejaria
 * deriva igual.
 */
export function loQueLeFaltaA(version: string, referencia: string, sistema: Sistema) {
  const trae = new Set(migracionesDe(version, sistema));
  return migracionesDe(referencia, sistema).filter((archivo) => !trae.has(archivo));
}

/**
 * Los sistemas cuyo migrador construye este ambiente, **leidos de los manifiestos**.
 *
 * No de una lista: una lista escrita a mano es el segundo sitio donde olvidarse, y el
 * dia que alguien anada el `Job` de migracion de `rentas` sin declarar su version, esa
 * lista seria justamente la que diria que todo esta bien. Aqui el censo sale de la imagen
 * de cada contenedor, que es lo unico que decide de verdad que esquema se migra.
 */
export function sistemasDesplegados(ambiente: Environment): string[] {
  const nombres = new Set<string>();
  const manifiestos = construirManifiestos(invariantesDe(ambiente)) as unknown[];

  const recorrer = (valor: unknown): void => {
    if (Array.isArray(valor)) {
      valor.forEach(recorrer);
      return;
    }
    if (valor === null || typeof valor !== "object") return;
    for (const [clave, dentro] of Object.entries(valor as Record<string, unknown>)) {
      if (clave === "image" && typeof dentro === "string") {
        const migrador = /(?:^|\/)([a-z0-9-]+)-migrador:/.exec(dentro);
        const nombre = migrador?.[1];
        if (nombre !== undefined) nombres.add(nombre);
      }
      recorrer(dentro);
    }
  };

  recorrer(manifiestos);
  return [...nombres].sort();
}

/**
 * Un ambiente que no construye ningun migrador (`C-19`).
 *
 * Tiene tipo propio y no es un `Error` a secas porque quien lo recibe tiene que poder
 * distinguirlo del otro fallo de `unicoSistemaDesplegado` —«construye dos y la
 * configuracion declara una version»—, que es un defecto de verdad y no un estado.
 */
export class SinMigrador extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "SinMigrador";
  }
}

/**
 * Los ambientes cuya version declarada gobierna de verdad un `Job` de migracion.
 *
 * Se **deriva de los manifiestos**, como `sistemasDesplegados`, y no de una lista ni del
 * nombre del ambiente: el dia que `stg` vuelva a desplegar el monolito entra solo, y el
 * dia que `prod` deje de hacerlo sale solo.
 */
export function ambientesConMigrador(ambientes: readonly Environment[]): Environment[] {
  return ambientes.filter((ambiente) => sistemasDesplegados(ambiente).length > 0);
}

/** La deriva de un ambiente, medida contra la revision de referencia de SU sistema. */
export function derivaDeMigraciones(
  ambiente: Environment,
  referencia: string = REVISION_DE_REFERENCIA,
  sistema: Sistema = sistemaLlamado(unicoSistemaDesplegado(ambiente)),
): DerivaDeMigraciones {
  const version = invariantesDe(ambiente).application.bootstrapVersion;
  const deLaVersion = migracionesDe(version, sistema);
  const deLaReferencia = migracionesDe(referencia, sistema);
  const trae = new Set(deLaVersion);

  return {
    ambiente,
    sistema: sistema.nombre,
    version,
    traeLaVersion: deLaVersion.length,
    declaraLaReferencia: deLaReferencia.length,
    faltan: deLaReferencia.filter((archivo) => !trae.has(archivo)),
    enLaHistoria: estaEnLaHistoriaDe(version, referencia, sistema),
  };
}

/**
 * El unico sistema que este ambiente migra hoy, o el error que dice por que no lo hay.
 *
 * `applicationBootstrapVersion` es **una** linea, asi que solo puede fechar **un**
 * `git log`. Mientras el despliegue sea de un sistema eso cuadra; el dia que sean
 * cuatro, la configuracion tiene que declarar cuatro versiones y este error lo dice
 * antes de que nadie mida una deriva contra el repositorio equivocado.
 */
export function unicoSistemaDesplegado(ambiente: Environment): string {
  const desplegados = sistemasDesplegados(ambiente);
  const unico = desplegados[0];
  if (desplegados.length === 1 && unico !== undefined) return unico;

  // Cero no es lo mismo que dos, y desde C-19 puede pasar: un ambiente que no despliega
  // el monolito no compone ningun `Job` de migracion, asi que su
  // `applicationBootstrapVersion` no gobierna nada y **no hay deriva que medir**. El
  // mensaje lo dice en vez de acusar a la configuracion de un defecto que no tiene.
  if (desplegados.length === 0) {
    throw new SinMigrador(
      `El ambiente «${ambiente}» no construye ningun migrador: no despliega el monolito ` +
        "(C-19) y ningun sistema del corte tiene todavia su version declarada.\n" +
        "  Su `applicationBootstrapVersion` no gobierna ningun Job, asi que aqui no hay " +
        "deriva que medir. Quien pregunte tiene que preguntar antes por " +
        "`ambientesConMigrador()`.",
    );
  }

  throw new Error(
    `El ambiente «${ambiente}» construye ${desplegados.length} migradores ` +
      `(${desplegados.join(", ") || "ninguno"}) y la configuracion declara UNA sola ` +
      "`applicationBootstrapVersion».\n" +
      "  Una sola linea solo puede fechar un `git log`: con varios sistemas hay que " +
      "declarar una version POR SISTEMA, y hasta entonces la deriva de los demas no la " +
      "mide nadie —que es el estado exacto que #675 encontro—.\n" +
      "  Remedio: dar a `config.ts` una version por sistema y pasarla a `manifiestosDeMigracion`.",
  );
}

/**
 * El `sha` declarado esta fuera de la historia de la referencia. Cadena vacia si no.
 *
 * Va aparte de `loQueFalta` porque **es otro defecto y tiene otro remedio**: alli falta
 * una migracion y se sube la version; aqui la version no es de `main` y lo que hay es
 * un `sha` que nadie integro —el modo de fallo que #720 midio, con cuarenta caracteres
 * hexadecimales tecleados a mano—.
 *
 * Y hay un caso que `migracionesDe` NO caza y este si: un `sha` que **existe** en el
 * clon por venir de otra rama. Ese se cuenta sin protestar, puede traer exactamente las
 * mismas migraciones que `main` y dejar `loQueFalta` en blanco, y aun asi
 * `ghcr.io/…/sgtm-migrador:<sha>` no existe, porque las imagenes se publican al integrar
 * en `main` y nunca desde una rama.
 */
export function loQueNoEncaja(deriva: DerivaDeMigraciones): string {
  if (deriva.enLaHistoria) return "";

  return (
    `El ambiente «${deriva.ambiente}» declara la version ${deriva.version}, que no esta ` +
    `en la historia de ${REVISION_DE_REFERENCIA} de «${deriva.sistema}».\n` +
    "  Las tres imagenes se publican al integrar en main (`publicar-imagenes.yml`), asi " +
    "que una revision que no esta ahi no tiene ninguna: el Job pediria una etiqueta que " +
    "nadie construyo.\n" +
    "  Remedio: declarar un sha de main. Y tomarlo con `git rev-parse`, no tecleado: " +
    "cuarenta caracteres hexadecimales inventados pasan la comprobacion de forma."
  );
}

/**
 * El diagnostico, con **las dos cifras** y que hacer. Cadena vacia si no hay deriva.
 *
 * Se separa de la medicion para poder probar el texto con cifras inventadas: esa prueba
 * no depende de que los ambientes esten al dia, asi que sigue diciendo lo mismo el dia
 * en que lo esten.
 */
export function loQueFalta(deriva: DerivaDeMigraciones): string {
  if (deriva.faltan.length === 0) return "";

  const corta = deriva.version.slice(0, 12);
  return (
    `El ambiente «${deriva.ambiente}» declara la version ${corta} de «${deriva.sistema}», ` +
    `que trae ${deriva.traeLaVersion} migraciones, y ${REVISION_DE_REFERENCIA} declara ` +
    `${deriva.declaraLaReferencia}: le faltan ${deriva.faltan.length} ` +
    `(${deriva.faltan.join(", ")}).\n` +
    "  Nada lo delata solo: el Job lleva la version EN EL NOMBRE, asi que mientras esa " +
    `linea no se mueva «kamayuk-${deriva.ambiente}-migracion-${corta}» ya existe, ` +
    "`pulumi up` no crea ninguno y sale en verde.\n" +
    "  Remedio: subir `kamayuk:applicationBootstrapVersion` en " +
    `infra/Pulumi.${deriva.ambiente}.yaml al ultimo sha de main con las tres imagenes ` +
    "publicadas (publicar-imagenes.yml en verde para ese sha)."
  );
}
