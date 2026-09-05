import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { raizDelRepositorio } from "../componentes/fuentes";

/**
 * El prefijo con que cada sistema lee sus datos de implantacion, leido de SU Java (C-18).
 *
 * ## El defecto, medido y no supuesto
 *
 * Los cuatro descriptores ponen las variables de la implantacion con el prefijo
 * `KAMAYUK_IMPLANTACION_`. **`rentas` no las lee asi**: es el monolito y conserva
 * `@ConfigurationProperties("sgtm.implantacion")`, y sus dos `@Value` piden
 * `${sgtm.implantacion.url}` y `${sgtm.implantacion.owner-clave}`. Los otros tres estrenaron
 * `kamayuk.implantacion` **a proposito** —lo dice su propio javadoc: «tener nombres distintos hace
 * imposible que un descuido apunte el Job de implantacion de `catastro` con las variables del de
 * `rentas`»—, y el descriptor de `rentas` copio el de sus hermanos.
 *
 * El sintoma no se parece a su causa, y por eso llevaba desde C-14 sin que nadie lo viera:
 * `ImplantarMunicipalidad` esta condicionado a `@ConditionalOnProperty("sgtm.implantacion.ubigeo")`,
 * asi que con el prefijo ajeno **el runner ni siquiera se registra**. El proceso arranca, no hace
 * nada y **sale con codigo 0** — el `Job` de Kubernetes queda `Complete` y la evidencia de C-17 lo
 * recoge asi: «kamayuk-rentas-implantacion-… Complete 1/1 25s». Una tarea que contesta que si
 * porque no estaba mirando, que es la misma forma que `yarn capacidad` tenia antes de C-16 y
 * `bootstrap-secretos.sh` antes de C-17 §4.
 *
 * Medido levantando el compose de C-18: `rentas` con **13 migraciones aplicadas** y la tabla
 * `municipalidad` **vacia**. Sin esa fila no hay `municipalidad_id` que poner en ningun token, ni
 * accesos sembrados, ni administrador: a `rentas` no puede entrar nadie, y ninguna sonda lo dice.
 *
 * ## Se LEE el Java, y no se escribe la lista aqui
 *
 * Escribir «rentas: sgtm, los otros tres: kamayuk» seria un tercer sitio con la misma verdad, y el
 * que envejece. Lo que se lee es el archivo de produccion: el argumento del
 * `@ConfigurationProperties` de `DatosDeImplantacion`.
 *
 * ## Cuando NO entiende algo, falla
 *
 * Si el archivo no esta, o el prefijo no es un literal, lanza nombrando la ruta. Una comprobacion
 * que se saltara lo que no entiende daria verde justo el dia que alguien lo escriba de otra forma.
 */

/** El prefijo de propiedad de un sistema: `sgtm.implantacion` o `kamayuk.implantacion`. */
export function prefijoDeLaImplantacion(sistema: string): string {
  const ruta = rutaDeDatosDeImplantacion(sistema);
  if (!existsSync(ruta)) {
    throw new Error(
      `Falta «${ruta}». Es donde «${sistema}» declara con que prefijo lee sus datos de ` +
        "implantacion, y sin el no se puede comparar con lo que su descriptor pone. Un prefijo " +
        "que no coincide no falla: el runner no se registra y el Job sale con codigo 0.\n" +
        `  Remedio: git clone https://github.com/hneyra/${sistema}`,
    );
  }
  const fuente = readFileSync(ruta, "utf8");
  const prefijo = /@ConfigurationProperties\(\s*"([^"]+)"\s*\)/.exec(fuente)?.[1];
  if (prefijo === undefined) {
    throw new Error(
      `«${ruta}» no declara ningun \`@ConfigurationProperties("...")\` literal. Esta ` +
        "comprobacion compara ese prefijo con el de las variables del descriptor, y para eso " +
        "tiene que poder leerlo. Se falla en vez de omitirlo: saltarse lo que no se entiende " +
        "daria verde justo el dia que se escriba de otra forma.",
    );
  }
  return prefijo;
}

/** Donde vive el `DatosDeImplantacion` de un sistema, en su clon hermano. */
export function rutaDeDatosDeImplantacion(sistema: string): string {
  return join(
    resolve(raizDelRepositorio(), "..", sistema),
    "backend",
    `kamayuk-${sistema}-seguridad`,
    "src/main/java/kamayuk",
    sistema,
    "seguridad/aplicacion/DatosDeImplantacion.java",
  );
}

/**
 * El prefijo de variable de entorno que Spring resuelve para esa propiedad.
 *
 * `sgtm.implantacion` -> `SGTM_IMPLANTACION_`. El punto se vuelve guion bajo y todo va en
 * mayusculas; es la «relaxed binding» de Spring Boot, y es lo unico que hace que un
 * `KAMAYUK_IMPLANTACION_UBIGEO` **no** llegue a `sgtm.implantacion.ubigeo`.
 */
export function variableDe(prefijo: string): string {
  return `${prefijo.replace(/\./g, "_").toUpperCase()}_`;
}

/** Las variables de un proceso que hablan de implantacion y NO llevan el prefijo que toca. */
export function variablesConElPrefijoAjeno(
  variables: readonly string[],
  prefijoEsperado: string,
): string[] {
  const esperado = variableDe(prefijoEsperado);
  return variables
    .filter((v) => /_IMPLANTACION_/.test(v))
    .filter((v) => !v.startsWith(esperado))
    .sort();
}
