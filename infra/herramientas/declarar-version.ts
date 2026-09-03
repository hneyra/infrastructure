import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { raizDeInfra } from "../componentes/fuentes";
import { ENVIRONMENTS, type Environment } from "../config";
import { leerStack } from "../verificaciones/stacks";
import type { DerivaDeMigraciones } from "../verificaciones/deriva-de-migraciones";

/**
 * Quien escribe `sgtm:applicationBootstrapVersion`, y por que ya no es una persona
 * (issue #720).
 *
 * <h2>El tramite que esto sustituye, medido</h2>
 *
 * La guarda de #675 hace lo que promete —la deriva de migraciones dejo de crecer en
 * silencio— y el 2026-09-02 se midio tambien lo que cuesta: **cuatro** PR de dos lineas
 * en hora y media (#705, #715, #717, #719), y el tercero **se quedo obsoleto durante su
 * propio CI**, porque otra migracion entro a `main` mientras corria.
 *
 * El tramite no lo puede hacer el PR que trae la migracion, y no por descuido: la
 * version que hay que declarar es el `sha` de su **propio merge**, y sus imagenes no
 * existen hasta que `publicar-imagenes.yml` termina con ese `sha` ya en `main`. Declarar
 * uno anterior no vale —no trae la migracion— y el futuro tampoco —no hay imagenes—. Por
 * eso el trabajo era siempre posterior y siempre de otro.
 *
 * Pero **el merge si sabe las dos cosas**: su `sha`, y —porque este modulo lo llama el
 * flujo que se dispara al terminar `publicar-imagenes.yml` en verde— si sus imagenes
 * estan publicadas. De ahi la decision de #720: lo escribe el merge.
 *
 * <h2>Lo que decide, y por que cada negativa</h2>
 *
 * Esta funcion es **pura**: recibe la situacion ya medida y devuelve que hacer. Es lo
 * unico de este mecanismo que se puede ejercitar desde un PR —un flujo con
 * `workflow_run` solo corre en la rama por omision—, asi que aqui es donde viven las
 * reglas y sus mutaciones.
 *
 * <h2>El bucle, cerrado por construccion</h2>
 *
 * El commit que esto produce toca `infra/Pulumi.*.yaml`, que esta en las rutas de
 * `publicar-imagenes.yml`: si volviera a disparar, volveria a declarar, y asi para
 * siempre. No lo hace, y por dos motivos independientes —que es como se cierra algo que
 * no se puede probar—:
 *
 * <ol>
 *   <li>Un `push` hecho con el `GITHUB_TOKEN` no dispara flujos, por diseño de la
 *       plataforma. Este es el cierre que no depende de nosotros.
 *   <li>Y si lo disparara, la regla 4 de abajo lo pararia igual: el commit del bump **no
 *       anade ninguna migracion**, asi que ningun ambiente tiene deriva y no hay nada que
 *       declarar. Este es el cierre que si esta probado, y es el que sigue valiendo el
 *       dia que la plataforma cambie de opinion.
 * </ol>
 */

/** Lo que hay que saber para decidir, ya medido contra git y los stacks. */
export interface Situacion {
  /** El `sha` del commit de `main` cuyas imagenes se acaban de publicar. */
  readonly candidato: string;
  /** Si ese `sha` esta en la historia de `origin/main`. */
  readonly candidatoEnLaHistoria: boolean;
  /** Migraciones que `origin/main` declara y el candidato no trae. */
  readonly faltanEnElCandidato: readonly string[];
  /** La deriva de cada ambiente, tal como la mide la guarda de #675. */
  readonly derivas: readonly DerivaDeMigraciones[];
}

/** Que hacer con esa situacion. */
export interface Decision {
  /** Si hay que reescribir algun `Pulumi.<ambiente>.yaml`. */
  readonly declarar: boolean;
  /** El `sha` que se declararia. */
  readonly version: string;
  /** Los ambientes que hay que reescribir. Vacio cuando `declarar` es falso. */
  readonly ambientes: readonly Environment[];
  /** Por que, en una linea que se lee en el resumen del trabajo. */
  readonly motivo: string;
}

const ES_UN_SHA = /^[0-9a-f]{40}$/;

/**
 * La decision, en cuatro reglas y en este orden.
 *
 * Las tres primeras son negativas y ninguna sobra:
 *
 * <ol>
 *   <li><b>Forma.</b> Lo unico que la guarda de #675 comprobaba del `sha` era esto, y
 *       #720 midio que no basta: cuarenta caracteres hexadecimales inventados la pasan.
 *       Aqui es la primera criba, no la unica.
 *   <li><b>Historia.</b> Un `sha` que no es de `main` no tiene imagenes —se publican al
 *       integrar—, asi que declararlo deja al Job pidiendo una etiqueta que nadie
 *       construyo. Es la mitad que a la guarda le faltaba, y la que cierra de verdad el
 *       modo de fallo del `sha` tecleado.
 *   <li><b>Que cierre la deriva.</b> Si `main` ya trae una migracion que el candidato no
 *       —porque otro merge entro mientras se publicaban las imagenes—, declararlo
 *       **dejaria deriva igual**. Ese es exactamente el caso que se midio a las 15:55 del
 *       2026-09-02 con #717, y la respuesta correcta no es declarar a medias: es callar y
 *       dejar que lo declare la corrida de ESE commit, que si lo cierra.
 * </ol>
 *
 * Y la cuarta es la que hace el trabajo, y de paso cierra el bucle: solo se reescriben
 * los ambientes que **tienen** deriva. Un ambiente al dia no se toca, asi que declarar no
 * genera nunca una segunda declaracion.
 */
export function decidir(situacion: Situacion): Decision {
  const { candidato, candidatoEnLaHistoria, faltanEnElCandidato, derivas } = situacion;
  const nada = { declarar: false as const, version: candidato, ambientes: [] as Environment[] };

  if (!ES_UN_SHA.test(candidato)) {
    return {
      ...nada,
      motivo:
        `«${candidato}» no es un sha de cuarenta caracteres hexadecimales, asi que no se ` +
        "declara nada.",
    };
  }

  if (!candidatoEnLaHistoria) {
    return {
      ...nada,
      motivo:
        `${candidato.slice(0, 12)} no esta en la historia de main, y las tres imagenes se ` +
        "publican al integrar: declararlo dejaria al Job pidiendo una etiqueta que nadie " +
        "construyo.",
    };
  }

  if (faltanEnElCandidato.length > 0) {
    return {
      ...nada,
      motivo:
        `main ya trae ${faltanEnElCandidato.length} migracion(es) que ` +
        `${candidato.slice(0, 12)} no (${faltanEnElCandidato.join(", ")}): declararlo ` +
        "dejaria deriva igual. Lo declarara la corrida de ese commit, que si la cierra.",
    };
  }

  const conDeriva = derivas.filter((deriva) => deriva.faltan.length > 0).map((d) => d.ambiente);

  if (conDeriva.length === 0) {
    return {
      ...nada,
      motivo:
        "ningun ambiente tiene deriva: lo declarado ya trae las migraciones de main. Es " +
        "tambien lo que impide que declarar vuelva a declarar.",
    };
  }

  return {
    declarar: true,
    version: candidato,
    ambientes: conDeriva,
    motivo:
      `${conDeriva.join(" y ")} declara(n) una version a la que le faltan migraciones de ` +
      `main; ${candidato.slice(0, 12)} las trae todas y tiene imagenes publicadas.`,
  };
}

/** La linea exacta que Pulumi lee, y la unica que este mecanismo toca. */
const CLAVE = "sgtm:applicationBootstrapVersion:";

/** Donde vive el stack de un ambiente. */
function archivoDe(ambiente: Environment): string {
  return join(raizDeInfra(), `Pulumi.${ambiente}.yaml`);
}

/**
 * Reescribe la linea de la version en los ambientes que la decision nombra.
 *
 * Sustituye **una** linea y falla si no la encuentra o si aparece dos veces: un
 * reemplazo global sobre un archivo que no tiene la forma esperada es como se corrompe
 * en silencio lo que despliega, y aqui el destino del cambio es `main` directamente, sin
 * revision humana en medio.
 *
 * Y comprueba lo escrito **releyendolo con el mismo lector que usa Pulumi**
 * (`leerStack`), no con la cadena que se acaba de componer: es la diferencia entre
 * afirmar que se escribio y comprobar que se lee.
 */
export function aplicar(decision: Decision): void {
  if (!decision.declarar) return;

  for (const ambiente of decision.ambientes) {
    const archivo = archivoDe(ambiente);
    const lineas = readFileSync(archivo, "utf8").split("\n");
    const cuales = lineas
      .map((linea, indice) => (linea.trimStart().startsWith(CLAVE) ? indice : -1))
      .filter((indice) => indice >= 0);

    if (cuales.length !== 1) {
      throw new Error(
        `Se esperaba UNA linea «${CLAVE}» en ${archivo} y hay ${cuales.length}. No se ` +
          "toca nada: este cambio va a main sin revision, asi que un archivo con otra " +
          "forma se deja como esta.",
      );
    }

    const [indice] = cuales as [number];
    lineas[indice] = `  ${CLAVE} ${decision.version}`;
    writeFileSync(archivo, lineas.join("\n"));

    const releido = leerStack(ambiente).text("applicationBootstrapVersion");
    if (releido !== decision.version) {
      throw new Error(
        `Se escribio ${decision.version} en ${archivo} y al releerlo Pulumi ve ` +
          `«${releido}». El archivo queda como quedo: hay que mirarlo a mano.`,
      );
    }
  }
}

/** Los ambientes, para que la herramienta no los repita. */
export const AMBIENTES = ENVIRONMENTS;
