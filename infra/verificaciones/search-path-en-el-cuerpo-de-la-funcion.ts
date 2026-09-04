import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type Esquema,
  esquemas,
  migraciones,
  sinComentarios,
} from "./extensiones-de-las-migraciones";

/**
 * Ningun cuerpo de funcion SQL depende del `search_path` de la sesion (C-4).
 *
 * ## El defecto, medido y no supuesto
 *
 * Los cuatro sistemas heredaron del monolito esta funcion:
 *
 * ```sql
 * CREATE OR REPLACE FUNCTION public.nombre_normalizado(texto text)
 *  RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
 * AS $function$
 *     SELECT regexp_replace(
 *                lower(unaccent('unaccent'::regdictionary, coalesce(texto, ''))),
 *                '\s+', ' ', 'g');
 * $function$;
 * ```
 *
 * Dentro de ese cuerpo hay **dos** nombres que se resuelven por `search_path`: la funcion
 * `unaccent(regdictionary, text)` —vive en `public`, que es donde la instala la extension—
 * y el literal `'unaccent'::regdictionary`, cuya conversion de entrada busca el diccionario
 * exactamente igual que se busca una tabla.
 *
 * Con el `search_path` de una sesion normal eso funciona, y por eso llevaba ahi desde el
 * monolito. Lo que rompe es cualquier camino que lo restrinja, y **`pg_dump` lo vacia**:
 * todo volcado empieza por `SELECT pg_catalog.set_config('search_path', '', false)`.
 *
 * ## Por que UN CUERPO DE FUNCION y no el DDL entero
 *
 * Porque `pg_dump` **cualifica con su esquema todos los identificadores que emite** —los
 * tipos, los operadores, las clases de operadores— y por eso el resto del volcado se
 * restaura sin problema aunque el `search_path` este vacio. Lo unico que no puede
 * cualificar es el interior de un cuerpo de funcion, que para el es una cadena opaca y
 * vuelve a salir tal cual se escribio.
 *
 * Y de los cuerpos, solo los de `LANGUAGE sql` importan: son los unicos que PostgreSQL
 * **inserta en linea**, y esa insercion en linea ocurre al construir un indice o una
 * columna generada, o sea en plena restauracion. Un cuerpo `plpgsql` no se inserta nunca,
 * y ademas los disparadores se crean DESPUES de cargar los datos («post-data»), asi que
 * durante una restauracion no llega a ejecutarse ninguno.
 *
 * ## Lo que costaba, medido contra PostgreSQL 16.15 —la version que se despliega—
 *
 * | Esquema | `pg_restore` | Consecuencia |
 * |---|---|---|
 * | `rentas` | 1 error, salida 0 | la base restaurada se queda **sin** `contribuyente_nombre_trgm_ix` |
 * | `catastro` | **85 errores**, salida 0 | **`via` no se crea**, y con ella se cae todo lo que la referencia: 86 indices -> 82 |
 * | `sgtm` | 2 errores, salida 0 | el mismo indice del padron, y su `COMMENT` |
 *
 * `pg_restore` lo dice como **aviso** —«errors ignored on restore»— y termina con codigo de
 * salida 0. No hay ningun rojo, y el sintoma aparece meses despues y en otro sitio.
 *
 * ## Por que aqui, y por que no basta con la migracion que lo arregla
 *
 * Por lo mismo que C-2 y C-3: el defecto es de familia —lo trae el mismo generador a los
 * cuatro— y la lista de esquemas no se escribe aqui, sale de `esquemas()`.
 *
 * Y hace falta ademas por la leccion de C-3: **los baselines son generados**, y su origen
 * es una base construida desde el `V11` del monolito, que es archivo historico y no se
 * puede arreglar. Una regeneracion vuelve a emitir el cuerpo fragil, y —por lo mismo que
 * este defecto es invisible— nadie se enteraria. Esta guarda es lo unico que puede
 * ponerse rojo ese dia.
 *
 * ## Lo que NO mira, y por que
 *
 * La prosa: `sinComentarios` quita los `--` antes de buscar. La cabecera de la migracion
 * que arregla esto **cita el cuerpo malo** para explicarlo, y buscar en el archivo entero
 * pondria en rojo justamente al que ya esta arreglado — el hueco de #426 y #558.
 */

/**
 * Un literal convertido a un tipo `reg*` cuyo nombre no lleva esquema.
 *
 * Los tipos `reg*` son punteros al catalogo con nombre de texto: su conversion de entrada
 * resuelve por `search_path` igual que un nombre de tabla. `'unaccent'::regdictionary` es
 * fragil; `'public.unaccent'::regdictionary` no.
 *
 * `regtype` NO esta en la lista a proposito: los tipos del nucleo (`'int4'::regtype`) viven
 * en `pg_catalog`, que esta en el `search_path` incluso vacio, asi que marcarlo daria
 * falsos positivos sin cazar nada nuevo.
 */
const REG_SIN_ESQUEMA =
  /'([^'.]+)'\s*::\s*(regdictionary|regconfig|regclass|regproc|regprocedure|regoper|regoperator|regnamespace|regrole|regcollation)\b/gi;

/** El cuerpo entrecomillado con `$etiqueta$`, con la cabecera que lo precede. */
const CUERPO = /\$([A-Za-z_][A-Za-z0-9_]*|)\$([\s\S]*?)\$\1\$/g;

/** `LANGUAGE sql`, que es lo unico que PostgreSQL inserta en linea. `plpgsql` no cuenta. */
const LENGUAJE_SQL = /\bLANGUAGE\s+sql\b/i;

/** El principio de la declaracion, para saber a que funcion pertenece un cuerpo. */
const DECLARACION = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([A-Za-z0-9_."]+)/gi;

export interface Fragilidad {
  /** El esquema —y con el, el repositorio— cuya migracion la trae. */
  sistema: string;
  migracion: string;
  /** La funcion en cuyo cuerpo esta, tal como la nombra su `CREATE FUNCTION`. */
  funcion: string;
  /** Numero de linea dentro del archivo, para poder ir a ella. */
  linea: number;
  /** Que nombre es el que se resuelve por `search_path`. */
  nombre: string;
  /** Por que ese nombre no puede quedarse sin esquema. */
  porque: string;
}

/** El rojo, en una linea: repositorio, migracion, linea, funcion y el nombre suelto. */
export function descripcionDeLaFragilidad(f: Fragilidad): string {
  return (
    `«${f.sistema}»: ${f.migracion}:${f.linea}, en el cuerpo de ${f.funcion}, ` +
    `«${f.nombre}» se resuelve por search_path — ${f.porque}`
  );
}

/**
 * Las FUNCIONES que aporta una extension, que dentro de un cuerpo SQL hay que cualificar.
 *
 * **No se derivan del `source` de los patrones de {@link REGLAS}.** Se probo, y es la clase
 * de atajo que este proyecto lleva doscientos issues evitando: leer una expresion regular
 * como si fuera texto funciona hasta que alguien la escribe de otra forma, y entonces la
 * lista se queda corta **en silencio** — el defecto de #742 exacto, una lista que deja de
 * cubrir sin que nada se ponga rojo.
 *
 * Se declaran aqui, y `LasDosListasSiguenDeAcuerdo` en la prueba exige en las **dos**
 * direcciones que sigan cuadrando con {@link REGLAS}: cada nombre de aqui lo tiene que
 * reconocer el patron de su extension, y cada extension de {@link REGLAS} tiene que
 * aparecer aqui o estar declarada en {@link SOLO_APORTAN_TIPOS}.
 */
export const FUNCIONES_DE_EXTENSION: readonly { nombre: string; extension: string }[] = [
  { nombre: "unaccent", extension: "unaccent" },
  { nombre: "similarity", extension: "pg_trgm" },
  { nombre: "word_similarity", extension: "pg_trgm" },
  { nombre: "show_trgm", extension: "pg_trgm" },
];

/**
 * Las extensiones de {@link REGLAS} que aportan TIPOS y no funciones, con los tipos que son.
 *
 * `postgis` aporta `geography` y `geometry`, y un tipo lo cualifica `pg_dump` solo: en el
 * volcado sale `public.geography(MultiPolygon,4326)`. Lo que `pg_dump` no puede cualificar
 * es el interior de un cuerpo de funcion, y ahi no hay ningun tipo de PostGIS.
 *
 * **Los nombres estan aqui porque sin ellos esta lista seria una puerta de escape muda, y
 * eso se midio.** La primera version decia solo `["postgis"]`, y la mutacion que mueve
 * `pg_trgm` aqui —dejando `FUNCIONES_DE_EXTENSION` sin sus tres nombres— pasaba en VERDE:
 * la comprobacion de cobertura se daba por satisfecha y las tres funciones dejaban de
 * vigilarse sin que nada lo dijera. Es el defecto de #742 reproducido dentro de la propia
 * guarda que existe para no repetirlo.
 *
 * Con los nombres, la prueba puede exigir lo que de verdad separa un tipo de una funcion:
 * el patron tiene que reconocer `geography(Point,4326)` —un modificador de tipo lleva algo
 * dentro— y **no** reconocer `geography()`, que solo puede ser una llamada. Aparcar aqui
 * `similarity` deja de pasar, porque `similarity()` si casa.
 */
export const SOLO_APORTAN_TIPOS: readonly { extension: string; tipos: readonly string[] }[] = [
  { extension: "postgis", tipos: ["geography", "geometry"] },
];

/** Un cuerpo `LANGUAGE sql`, localizado: es lo unico que PostgreSQL inserta en linea. */
interface CuerpoSql {
  funcion: string;
  migracion: string;
  /** Linea del archivo donde empieza el cuerpo, para poder sumarle la de dentro. */
  lineaDelCuerpo: number;
  texto: string;
}

/** Los cuerpos `LANGUAGE sql` de esa migracion, en el orden en que aparecen. */
function cuerposSqlDe(ddl: string, migracion: string): CuerpoSql[] {
  const cuerpos: CuerpoSql[] = [];
  for (const cuerpo of ddl.matchAll(CUERPO)) {
    const desde = cuerpo.index ?? 0;
    const hasta = desde + cuerpo[0].length;
    // `LANGUAGE sql` puede ir ANTES del cuerpo (los baselines, que emite pg_get_functiondef)
    // o DESPUES (el V11 del monolito, escrito a mano). Por eso se mira la declaracion
    // entera, de su CREATE FUNCTION al `;` que la cierra: con solo una de las dos mitades,
    // la mitad de los casos —y precisamente el caso real— se escaparia.
    const inicio = ddl.slice(0, desde).toUpperCase().lastIndexOf("CREATE ");
    const finDeLaSentencia = ddl.indexOf(";", hasta);
    const cola = finDeLaSentencia < 0 ? "" : ddl.slice(hasta, finDeLaSentencia + 1);
    const declaracion = ddl.slice(inicio < 0 ? desde : inicio, desde) + cola;
    if (!LENGUAJE_SQL.test(declaracion)) {
      continue;
    }
    const nombres = [...declaracion.matchAll(DECLARACION)];
    cuerpos.push({
      funcion: nombres[0]?.[1] ?? "(funcion sin nombre)",
      migracion,
      lineaDelCuerpo: ddl.slice(0, desde).split("\n").length,
      texto: cuerpo[2] ?? "",
    });
  }
  return cuerpos;
}

/**
 * Lo que ese esquema resuelve por `search_path`, leido de su DDL y no de su prosa.
 *
 * ## Mira el ESTADO FINAL, no cada migracion suelta
 *
 * De cada funcion se queda con **la ultima** definicion, recorriendo las migraciones en
 * orden de version. No es un detalle de implementacion: es lo que la guarda dice que mide.
 * `pg_dump` vuelca el esquema **final**, asi que lo que se restaura es el ultimo cuerpo, y
 * una funcion que nacio fragil en `V1` y quedo cualificada en una migracion posterior se
 * restaura bien. Mirar cada migracion por separado pondria en rojo a `rentas` y `catastro`
 * justo despues de arreglarlos, y el arreglo comodo seria editar el baseline —que ya
 * corrio, y cuya suma de Flyway no se toca—.
 *
 * ## Lo que por eso NO ve, dicho aqui
 *
 * Que una migracion INTERMEDIA no se pueda aplicar. El `V1` de `rentas` sigue teniendo el
 * cuerpo fragil y sigue sin poder aplicarse desde cero en PostgreSQL 17 o 18, donde
 * `CREATE INDEX` corre con el `search_path` restringido. Es deliberado: la version
 * soportada es la 16 —lo comprueba `MotorPostgres.exigirVersionSoportada` en los cuatro
 * sistemas— y en 16 `V1` aplica sin problema. El dia que se decida soportar 17 o 18, esto
 * es lo primero que hay que volver a mirar.
 */
export function fragilidadesDelEsquema(esquema: Esquema): Fragilidad[] {
  const ultimoCuerpo = new Map<string, CuerpoSql>();
  for (const migracion of migraciones(esquema)) {
    const ddl = sinComentarios(
      readFileSync(join(esquema.raiz, esquema.migraciones, migracion), "utf8"),
    );
    for (const cuerpo of cuerposSqlDe(ddl, migracion)) {
      ultimoCuerpo.set(cuerpo.funcion, cuerpo);
    }
  }

  const hallazgos: Fragilidad[] = [];
  for (const cuerpo of ultimoCuerpo.values()) {
    cuerpo.texto.split("\n").forEach((linea, i) => {
      for (const suelto of linea.matchAll(REG_SIN_ESQUEMA)) {
        hallazgos.push({
          sistema: esquema.nombre,
          migracion: cuerpo.migracion,
          funcion: cuerpo.funcion,
          linea: cuerpo.lineaDelCuerpo + i,
          nombre: `'${suelto[1]}'::${suelto[2]}`,
          porque:
            `la conversion de entrada de ${suelto[2]} resuelve el nombre por search_path, ` +
            "y pg_dump lo vacia antes de restaurar",
        });
      }
      for (const { nombre, extension } of FUNCIONES_DE_EXTENSION) {
        if (new RegExp(`(^|[^.\\w])${nombre}\\s*\\(`, "i").test(linea)) {
          hallazgos.push({
            sistema: esquema.nombre,
            migracion: cuerpo.migracion,
            funcion: cuerpo.funcion,
            linea: cuerpo.lineaDelCuerpo + i,
            nombre: `${nombre}(...)`,
            porque:
              `${nombre}() la aporta la extension ${extension} y vive en public, que no ` +
              "esta en el search_path vacio con que pg_dump restaura",
          });
        }
      }
    });
  }
  return hallazgos;
}

/** El censo entero: las seis copias del esquema, en el orden de `esquemas()`. */
export function fragilidades(): Fragilidad[] {
  return esquemas().flatMap(fragilidadesDelEsquema);
}

/**
 * Lo que sigue siendo fragil y no se puede arreglar, con su motivo.
 *
 * **Es censo y no excepcion muda**, como `DECLARADAS_DE_MAS` en C-2: la prueba la compara
 * con lo medido **en las dos direcciones**, asi que una entrada nueva se pone roja y una
 * que deje de ser cierta —porque alguien la arreglo— tambien. No hay donde esconder una ni
 * donde dejar rancia la otra.
 *
 * `sgtm` es el archivo historico y su `V11` es una migracion **aplicada**: editarla cambia
 * su suma de Flyway y deja «la base de al lado distinta sin que nada se ponga rojo». Y una
 * migracion nueva tampoco sirve alli, porque el monolito no se toca. De modo que el
 * monolito **no se puede restaurar de un `pg_dump` sin perder `contribuyente_nombre_trgm_ix`**,
 * y eso es un hecho que conviene tener escrito donde se lea y no en un documento.
 */
export const FRAGILIDADES_QUE_NO_SE_ARREGLAN: readonly {
  sistema: string;
  migracion: string;
  nombre: string;
  porque: string;
}[] = [
  {
    sistema: "infrastructure (copia del esquema del monolito)",
    migracion: "V11__busqueda_por_aproximacion.sql",
    nombre: "'unaccent'::regdictionary",
    porque:
      "es la copia local del esquema del monolito: se arregla cuando se arregle el " +
      "monolito, o nunca, porque el monolito es archivo historico",
  },
  {
    sistema: "infrastructure (copia del esquema del monolito)",
    migracion: "V11__busqueda_por_aproximacion.sql",
    nombre: "unaccent(...)",
    porque: "el mismo cuerpo, la otra mitad: la funcion tambien se resuelve por search_path",
  },
  {
    sistema: "sgtm",
    migracion: "V11__busqueda_por_aproximacion.sql",
    nombre: "'unaccent'::regdictionary",
    porque:
      "V11 es una migracion APLICADA del archivo historico: editarla cambia su suma de " +
      "Flyway, y sgtm no admite migraciones nuevas. Consecuencia medida y asumida: un " +
      "pg_dump del monolito se restaura con 2 errores y sin el indice del padron",
  },
  {
    sistema: "sgtm",
    migracion: "V11__busqueda_por_aproximacion.sql",
    nombre: "unaccent(...)",
    porque: "el mismo cuerpo, la otra mitad",
  },
];
