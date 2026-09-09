import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { raizDelRepositorio } from "../componentes/fuentes";

/**
 * El prefijo con que cada sistema lee sus datos de implantacion, leido de SU Java (C-18).
 *
 * ## El defecto, medido y no supuesto
 *
 * Los cuatro descriptores ponen las variables de la implantacion con el prefijo
 * `KAMAYUK_IMPLANTACION_`, y desde R-A/B los cuatro Java lo leen. **Hasta entonces `rentas` no**:
 * era el monolito y conservaba `@ConfigurationProperties("sgtm.implantacion")`, con sus dos
 * `@Value` pidiendo `${sgtm.implantacion.url}` y `${sgtm.implantacion.owner-clave}`, mientras sus
 * tres hermanos estrenaban `kamayuk.implantacion`; y el descriptor de `rentas` copio el de ellos.
 *
 * Que hoy los cuatro digan lo mismo **no deja a esta comprobacion sin trabajo**, y esa es la
 * razon de que no se haya borrado con el renombrado: sigue siendo lo unico que ata el descriptor
 * de un sistema al Java que lo lee, y el dia que uno de los dos se mueva —por un renombrado, por
 * una copia entre hermanos o por una etapa C que toque los nombres— el otro se pone rojo aqui en
 * vez de salir con codigo 0.
 *
 * El sintoma no se parece a su causa, y por eso llevaba desde C-14 sin que nadie lo viera:
 * `ImplantarMunicipalidad` esta condicionado a `@ConditionalOnProperty("kamayuk.implantacion.ubigeo")`,
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

/** El prefijo de propiedad de un sistema: `kamayuk.implantacion` o `kamayuk.implantacion`. */
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
  const prefijo = /@ConfigurationProperties\(\s*"([^"]+)"\s*\)/.exec(
    fuente,
  )?.[1];
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

/**
 * Donde vive el `DatosDeImplantacion` de un sistema, en su clon hermano.
 *
 * Se BUSCA en el clon y no se compone: hasta la etapa 2 de #52 esta funcion escribia
 * `kamayuk-<sistema>-seguridad/…/seguridad/aplicacion/`, que es donde lo tienen los cuatro del
 * corte, e `identidad` —que ES la seguridad y no tiene un modulo llamado asi— lo puso en su
 * `nucleo`. Con la ruta escrita a mano, seis pruebas salian rojas diciendo «git clone
 * https://github.com/hneyra/identidad» sobre un clon que estaba: un rojo que no habla de lo que
 * la guarda vigila. Lo que se afirma es que en `src/main` de ese clon hay EXACTAMENTE un
 * archivo con ese nombre; cero o dos se dicen, porque leer el equivocado —o ninguno— es
 * justo el verde silencioso que esta guarda existe para impedir.
 */
export function rutaDeDatosDeImplantacion(sistema: string): string {
  const backend = join(resolve(raizDelRepositorio(), "..", sistema), "backend");
  const candidatos = existsSync(backend)
    ? datosDeImplantacionBajo(backend)
    : [];
  if (candidatos.length === 1) {
    return candidatos[0]!;
  }
  if (candidatos.length === 0) {
    // La ruta de los cuatro del corte, para que el rojo nombre un sitio concreto.
    return join(
      backend,
      `kamayuk-${sistema}-seguridad`,
      "src/main/java/kamayuk",
      sistema,
      "seguridad/aplicacion/DatosDeImplantacion.java",
    );
  }
  throw new Error(
    `«${sistema}» tiene ${candidatos.length} \`DatosDeImplantacion.java\` en su src/main y esta ` +
      "guarda no sabe cual lee el Job de implantacion: " +
      candidatos.map((c) => c.replace(`${backend}/`, "")).join(", "),
  );
}

/** Los `DatosDeImplantacion.java` de produccion bajo un `backend/`, sin entrar en `build/`. */
function datosDeImplantacionBajo(backend: string): string[] {
  const encontrados: string[] = [];
  const recorrer = (dir: string): void => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      if (entrada.isDirectory()) {
        if (
          entrada.name !== "build" &&
          entrada.name !== "node_modules" &&
          !entrada.name.startsWith(".")
        ) {
          recorrer(join(dir, entrada.name));
        }
      } else if (
        entrada.name === "DatosDeImplantacion.java" &&
        dir.includes(`${sep}src${sep}main${sep}`)
      ) {
        encontrados.push(join(dir, entrada.name));
      }
    }
  };
  recorrer(backend);
  return encontrados.sort();
}

/**
 * El prefijo de variable de entorno que Spring resuelve para esa propiedad.
 *
 * `kamayuk.implantacion` -> `KAMAYUK_IMPLANTACION_`. El punto se vuelve guion bajo y todo va en
 * mayusculas; es la «relaxed binding» de Spring Boot, y es lo unico que hace que un
 * `KAMAYUK_IMPLANTACION_UBIGEO` **no** llegue a `kamayuk.implantacion.ubigeo`.
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
