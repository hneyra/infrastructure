/**
 * Toda variable de entorno que la aplicacion exige SIN valor por omision, puesta por el descriptor.
 *
 * ## El hueco que cierra (C-7, punto 4)
 *
 * `caja/.../application.yaml` declara `responsable: ${KAMAYUK_CAJA_RESPONSABLE}` **sin** valor por
 * omision, a proposito: ADR-0026 §4 exige que un pago que no se pudo imputar avise a una persona
 * con nombre, y una propiedad opcional se queda vacia exactamente en la instalacion donde importa.
 * La consecuencia es que sin esa variable **el pod no levanta**: Spring no puede resolver el
 * marcador y el contexto muere antes de atender nada.
 *
 * Y el descriptor de `caja` no la ponia. Estaba escrito —un comentario de treinta lineas lo
 * declaraba como hueco de P5D— y nada lo medía: `yarn manifiestos` componia el Deployment, la
 * auditoria lo aprobaba, y el defecto solo aparecia al desplegar.
 *
 * ## Por que se DERIVA del `application.yaml` y no se escribe una lista
 *
 * Porque una lista escrita a mano se desincroniza el primer mes, y su modo de fallo es el peor:
 * una variable nueva sin omision no aparece en la lista, la guarda pasa en verde y el pod deja de
 * levantar. Aqui la fuente es el propio archivo que se despliega dentro del jar.
 *
 * ## El perfil importa
 *
 * `application.yaml` tiene bloques por perfil: `KAMAYUK_OIDC_EMISOR` no tiene omision y solo se exige
 * en `web`. Un Deployment de perfil `batch` que no la declare esta **bien**, y exigirsela seria
 * pedir que la maquina que corre una determinacion de madrugada pueda ver Keycloak. Por eso cada
 * contenedor se mide contra el bloque comun mas el de SU perfil, leido de su propio
 * `SPRING_PROFILES_ACTIVE`.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SISTEMAS, clonDe, type Sistema } from "./deriva-de-migraciones";

/** `${VAR}` sin `:` detras del nombre. Con `:` hay valor por omision, aunque sea vacio. */
const SIN_OMISION = /\$\{([A-Z0-9_]+)\}/g;

/** El separador de documentos YAML que Spring Boot usa para los bloques por perfil. */
const SEPARADOR = /^---\s*$/m;

/** Los sistemas que despliegan una aplicacion Spring Boot; `sgtm` es el archivo historico. */
export const SISTEMAS_CON_APLICACION: readonly string[] = ["rentas", "catastro", "normativa", "caja"];

function sistemaDe(nombre: string): Sistema {
  const sistema = SISTEMAS.find((candidato) => candidato.nombre === nombre);
  if (sistema === undefined) {
    throw new Error(`No hay ningun sistema llamado «${nombre}» en SISTEMAS.`);
  }
  return sistema;
}

/** Donde vive el `application.yaml` que viaja en el jar de un sistema. */
export function rutaDelApplicationYaml(nombre: string): string {
  return join(
    clonDe(sistemaDe(nombre)),
    "backend",
    `kamayuk-${nombre}-aplicacion`,
    "src/main/resources/application.yaml",
  );
}

/**
 * Las variables sin omision de un sistema, por perfil.
 *
 * El bloque comun —el primer documento del YAML— se le suma a todos, porque Spring lo aplica
 * siempre. Un bloque cuyo `on-profile` no se reconoce se ignora: no se adivina.
 */
export function variablesSinOmision(nombre: string): {
  comunes: string[];
  porPerfil: Record<string, string[]>;
} {
  const ruta = rutaDelApplicationYaml(nombre);
  if (!existsSync(ruta)) {
    throw new Error(
      `No esta «${ruta}». Es el archivo que viaja en el jar de «${nombre}» y del que sale que ` +
        "variables exige la aplicacion; sin el, esta comprobacion no puede decir nada — y " +
        "«no se pudo comprobar» no es «esta bien».",
    );
  }
  const documentos = readFileSync(ruta, "utf8").split(SEPARADOR);
  const comunes = declaradas(documentos[0] ?? "");
  const porPerfil: Record<string, string[]> = {};
  for (const documento of documentos.slice(1)) {
    const perfil = /on-profile:\s*([a-z]+)/.exec(documento)?.[1];
    if (perfil !== undefined) {
      porPerfil[perfil] = [...(porPerfil[perfil] ?? []), ...declaradas(documento)];
    }
  }
  return { comunes, porPerfil };
}

function declaradas(documento: string): string[] {
  // Los comentarios se quitan antes: un `${VAR}` citado en una explicacion no es una exigencia,
  // y contarlo pondria la guarda roja por una frase.
  const sinComentarios = documento
    .split("\n")
    .map((linea) => linea.replace(/(^|\s)#.*$/, ""))
    .join("\n");
  return [...new Set([...sinComentarios.matchAll(SIN_OMISION)].map((m) => m[1] as string))].sort();
}

/** Lo que un contenedor de ese perfil tiene que declarar. */
export function exigidasPor(nombre: string, perfil: string): string[] {
  const { comunes, porPerfil } = variablesSinOmision(nombre);
  return [...new Set([...comunes, ...(porPerfil[perfil] ?? [])])].sort();
}
