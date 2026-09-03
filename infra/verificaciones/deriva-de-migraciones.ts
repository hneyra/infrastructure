import { execFileSync } from "node:child_process";
import { raizDelRepositorio } from "../componentes/fuentes";
import type { Environment } from "../config";
import { invariantesDe } from "./stacks";

/**
 * La deriva entre lo que el ambiente DECLARA desplegar y lo que el repositorio declara
 * hoy (issue #675).
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
 * en el ultimo `up` de prod—. Comprobado sin desplegar:
 *
 *     yarn --silent manifiestos --ambiente stg | grep migracion
 *     # "name": "sgtm-stg-migracion-5fc02f3a4493"   <- el que ya existe, Complete
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
 * Lo que hacia tolerable el bloqueo era que el remedio fuese una linea y el mensaje la
 * dictara. **El 2026-09-02 dejo de serlo, medido**: cuatro PR de dos lineas en hora y
 * media (#705, #715, #717, #719), y el tercero obsoleto durante su propio CI porque otra
 * migracion entro mientras corria. Se reviso la decision, que es lo que este parrafo
 * pedia, y la respuesta de #720 no fue quitar la guarda sino **quitar a la persona**: la
 * linea la escribe ahora el merge (`.github/workflows/declarar-version.yml`), al terminar
 * `publicar-imagenes.yml` en verde, que es el unico momento en que se saben las dos cosas
 * que hacen falta —el `sha` y que sus imagenes existen—.
 *
 * Queda una ventana: mientras se publican las imagenes, un PR que toque estas rutas sigue
 * saliendo rojo aqui. Dura lo que dura `publicar-imagenes.yml` y se cierra sola, sin que
 * nadie abra un PR. Y si la automatizacion no puede empujar, se pone roja **ella** —en
 * `main`, no en el PR de nadie— y todo vuelve a ser exactamente lo de antes: esto sigue
 * bloqueando y el remedio vuelve a ser la linea a mano.
 *
 * Y esto **no** puede quedarse solo en el trabajo diario: `deteccion-de-deriva` corre con
 * `if: github.event_name == 'schedule'`, asi que un rojo suyo no bloquea nada y no llega
 * a ningun PR. Ahi vive la otra medida —la base contra su version declarada—, que
 * necesita el cluster; esta no lo necesita y por eso puede correr donde se lee.
 */

/** Donde viven las migraciones de Flyway, relativo a la raiz del repositorio. */
const MIGRACIONES = "backend/sgtm-esquema/src/main/resources/db/migration/";

/**
 * La revision de referencia: lo que el repositorio declara hoy.
 *
 * `origin/main` y no `HEAD`, por lo que dice el comentario de arriba. Es una constante
 * con nombre para que salga en el mensaje y para que cambiarla sea deliberado.
 */
export const REVISION_DE_REFERENCIA = "origin/main";

export interface DerivaDeMigraciones {
  ambiente: Environment;
  /** El `sha` que `applicationBootstrapVersion` declara. */
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

/**
 * Las migraciones que un `commit` trae, contadas en el arbol de git de ESE `commit`.
 *
 * Nunca sobre el arbol de trabajo: es la misma cautela que `verificar-el-ambiente.sh`
 * escribio primero. Contar los archivos que hay en el disco seria contar OTRA version, y
 * un numero plausible y equivocado es peor que ninguno.
 */
function migracionesDe(revision: string): string[] {
  const raiz = raizDelRepositorio();
  try {
    execFileSync("git", ["-C", raiz, "rev-parse", "--verify", "--quiet", `${revision}^{commit}`], {
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    throw new Error(
      `«${revision}» no esta en este clon, asi que no se puede saber cuantas migraciones ` +
        "trae. Esta comprobacion NO se salta: un numero inventado seria peor que ninguno.\n" +
        "  En CI, `actions/checkout` necesita `fetch-depth: 0`.\n" +
        "  En local, hay que traerse la revision (fetch de origin) antes de correr esto.",
    );
  }

  const salida = execFileSync("git", ["-C", raiz, "ls-tree", "--name-only", revision, MIGRACIONES], {
    encoding: "utf8",
  });

  return salida
    .split("\n")
    .filter((linea) => linea.endsWith(".sql"))
    .map((linea) => linea.slice(MIGRACIONES.length))
    .sort();
}

/**
 * Si `version` es antepasado de `referencia`.
 *
 * `git merge-base --is-ancestor` sale con 0 cuando lo es y con 1 cuando no; las dos
 * revisiones se comprueban antes con `migracionesDe`, asi que aqui no queda ningun otro
 * codigo de salida que interpretar.
 */
export function estaEnLaHistoriaDe(version: string, referencia: string): boolean {
  try {
    execFileSync(
      "git",
      ["-C", raizDelRepositorio(), "merge-base", "--is-ancestor", version, referencia],
      { stdio: ["ignore", "ignore", "ignore"] },
    );
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
export function loQueLeFaltaA(version: string, referencia: string = REVISION_DE_REFERENCIA) {
  const trae = new Set(migracionesDe(version));
  return migracionesDe(referencia).filter((archivo) => !trae.has(archivo));
}

/** La deriva de un ambiente, medida contra la revision de referencia. */
export function derivaDeMigraciones(
  ambiente: Environment,
  referencia: string = REVISION_DE_REFERENCIA,
): DerivaDeMigraciones {
  const version = invariantesDe(ambiente).application.bootstrapVersion;
  const deLaVersion = migracionesDe(version);
  const deLaReferencia = migracionesDe(referencia);
  const trae = new Set(deLaVersion);

  return {
    ambiente,
    version,
    traeLaVersion: deLaVersion.length,
    declaraLaReferencia: deLaReferencia.length,
    faltan: deLaReferencia.filter((archivo) => !trae.has(archivo)),
    enLaHistoria: estaEnLaHistoriaDe(version, referencia),
  };
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
    `en la historia de ${REVISION_DE_REFERENCIA}.\n` +
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
    `El ambiente «${deriva.ambiente}» declara la version ${corta}, que trae ` +
    `${deriva.traeLaVersion} migraciones, y ${REVISION_DE_REFERENCIA} declara ` +
    `${deriva.declaraLaReferencia}: le faltan ${deriva.faltan.length} ` +
    `(${deriva.faltan.join(", ")}).\n` +
    "  Nada lo delata solo: el Job lleva la version EN EL NOMBRE, asi que mientras esa " +
    `linea no se mueva «sgtm-${deriva.ambiente}-migracion-${corta}» ya existe, ` +
    "`pulumi up` no crea ninguno y sale en verde.\n" +
    "  Remedio: subir `sgtm:applicationBootstrapVersion` en " +
    `infra/Pulumi.${deriva.ambiente}.yaml al ultimo sha de main con las tres imagenes ` +
    "publicadas (publicar-imagenes.yml en verde para ese sha)."
  );
}
