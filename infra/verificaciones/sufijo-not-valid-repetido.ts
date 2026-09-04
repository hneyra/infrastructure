import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Esquema, esquemas, migraciones, sinComentarios } from "./extensiones-de-las-migraciones";

/**
 * Ninguna sentencia de ninguna migracion repite el sufijo ` NOT VALID` (C-3).
 *
 * ## El defecto, medido y no supuesto
 *
 * El generador de ADR-0032 emitia las restricciones no validadas asi:
 *
 * ```java
 * .append(' ').append(f[1])                                  // pg_get_constraintdef(...)
 * .append("true".equals(f[2]) ? "" : " NOT VALID")            // ...que YA lo traia
 * ```
 *
 * `pg_get_constraintdef` **ya emite** el sufijo de una restriccion no validada, asi que
 * el `append` lo duplicaba **siempre**: no era un caso borde, era el 100 % de ellas. Dejo
 * **36 sentencias** en el baseline de `rentas` y **1** en el de `caja` — que P5D arreglo
 * a mano sin arreglar la emision, de modo que el siguiente baseline las habria traido de
 * vuelta.
 *
 * ## Es un defecto de FORMA, y por eso hace falta esta guarda
 *
 * PostgreSQL 16.15 **lo acepta**: el atributo se acumula y el catalogo queda identico
 * —`convalidated = f`, y `pg_get_constraintdef` devuelve UN solo `NOT VALID`—. Medido
 * hasta con el sufijo **triplicado**, y comprobado aplicando el baseline entero de
 * `rentas`: 132 tablas, codigo de salida 0.
 *
 * Eso es justo lo que lo hace invisible para todo lo demas que ya mira este esquema:
 *
 *   - `Guardas.java` y `Retrato.java` consultan el **catalogo**, que normaliza. No pueden
 *     verlo ni aunque quieran, y el diff de esquema entre el baseline con el defecto y sin
 *     el es **vacio** (`pg_dump`, mismo sha256, 876 restricciones comparadas).
 *   - Las pruebas de persistencia aplican las migraciones y pasan igual.
 *
 * Lo que se pierde no es el esquema: es que **el archivo sea estable en ida y vuelta**.
 * Regenerar el baseline produce otro texto para el mismo esquema, y con checksum de
 * Flyway eso importa — el modo de fallo que la cabecera de los cuatro baselines describe
 * («que alguien edite una que ya corrio y la base de al lado quede distinta sin que nada
 * se ponga rojo»). Un defecto que solo se ve en el archivo solo se puede cazar leyendo el
 * archivo.
 *
 * ## Por que aqui, y no en cada repositorio
 *
 * Por lo mismo que C-2: el defecto es de familia —lo emitio un generador comun para los
 * cuatro— y la comprobacion es una. Escribirla en cuatro repositorios seria tener cuatro
 * sitios donde olvidarse, que es el defecto un escalon mas arriba. Y la lista de esquemas
 * **no se escribe aqui**: sale de `esquemas()`, que ya deriva de {@link SISTEMAS}.
 *
 * ## Lo que NO mira, y por que
 *
 * La prosa. `sinComentarios` quita los `--` antes de buscar, y no es un detalle: la
 * cabecera del baseline de `caja` **nombra el defecto** para dejar constancia de que lo
 * corrigio, y la de `rentas` hace lo mismo desde C-3. Buscar la cadena en el archivo
 * entero pondria en rojo justamente a los dos que ya estan arreglados, y el arreglo
 * comodo seria borrar la explicacion. Es el hueco exacto que #426 destapo en `leerPatron`
 * y que #558 volvio a encontrar buscando una cadena que vivia tambien en el comentario
 * que la explicaba.
 */

/** El sufijo, repetido dos o mas veces, con cualquier espaciado entre medias. */
const REPETIDO = /NOT\s+VALID(\s+NOT\s+VALID)+/i;

export interface SufijoRepetido {
  /** El esquema —y con el, el repositorio— cuya migracion lo trae. */
  sistema: string;
  migracion: string;
  /** Numero de linea dentro del archivo, para poder ir a ella. */
  linea: number;
  /** La sentencia, recortada: el rojo tiene que caber en una pantalla. */
  sentencia: string;
}

/** El rojo, en una linea: repositorio, migracion, linea y la sentencia. */
export function descripcionDelSufijo(s: SufijoRepetido): string {
  return (
    `«${s.sistema}»: ${s.migracion}:${s.linea} repite el sufijo ` +
    `« NOT VALID» — ${s.sentencia}`
  );
}

/** Lo que ese esquema repite, leido de su DDL y no de su prosa. */
export function sufijosDelEsquema(esquema: Esquema): SufijoRepetido[] {
  const hallazgos: SufijoRepetido[] = [];
  for (const migracion of migraciones(esquema)) {
    const ddl = sinComentarios(
      readFileSync(join(esquema.raiz, esquema.migraciones, migracion), "utf8"),
    );
    ddl.split("\n").forEach((linea, i) => {
      if (REPETIDO.test(linea)) {
        hallazgos.push({
          sistema: esquema.nombre,
          migracion,
          linea: i + 1,
          sentencia: linea.trim().slice(0, 120),
        });
      }
    });
  }
  return hallazgos;
}

/** El censo entero: las seis copias del esquema, en el orden de `esquemas()`. */
export function sufijosRepetidos(): SufijoRepetido[] {
  return esquemas().flatMap(sufijosDelEsquema);
}
