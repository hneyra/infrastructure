import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { raizDelRepositorio } from "../componentes/fuentes";

/**
 * Lo que una migracion NECESITA de una extension, contra lo que `crear-roles.sql`
 * DECLARA (issue #742).
 *
 * ## El hueco que cierra, medido y no supuesto
 *
 * `btree_gist` aparece en exactamente dos sitios del repositorio: `V72`, que la usa, y
 * `crear-roles.sql`, que la declara. Entre los dos no habia nada, y el acoplamiento lo
 * sostenia que el autor de cada migracion se diera cuenta al escribirla.
 *
 * **Ya rompio dos despliegues por el mismo mecanismo.** `V61`, el 2026-08-30, con
 * `ERROR: type "geography" does not exist` —el incidente que hizo nacer
 * `despliegue/crear-extensiones.sh`, y que dejo a produccion sin desplegar cuatro dias
 * porque `aplicar-prod` tiene `needs: aplicar-stg`—; y `V72` ahora (#675), reproducido
 * contra un PostgreSQL 16.15 con la condicion de `stg`:
 *
 *     aplicadas sin error: 61 de 68
 *     FALLA EN: V72__vigencias_que_no_se_pisan.sql
 *     ERROR:  data type bigint has no default operator class for access method "gist"
 *
 * Con un `CREATE EXTENSION btree_gist` sobre la misma base entran las siete restantes.
 *
 * ## Por que aqui y no en la migracion
 *
 * Porque **una migracion aplicada es inmutable**: editar `V72` para que compruebe la
 * extension y falle con un mensaje decente cambiaria su suma de comprobacion de Flyway
 * y rompería todo ambiente que ya la corrio. La guarda tiene que vivir ANTES de que la
 * migracion llegue a un motor, o no puede vivir.
 *
 * Y tiene que ser estatica, porque **CI nunca lo ve**: el volumen siempre nace vacio y
 * ahi `crear-roles.sql` corre entero, con las extensiones dentro. El fallo solo aparece
 * en un cluster que ya existia, en un Job de Kubernetes, una hora despues, y con un
 * mensaje que no nombra ni la extension ni el remedio.
 *
 * ## La lista sale del archivo, no de aqui
 *
 * `extensionesDeclaradas()` lee `crear-roles.sql` con el MISMO patron que
 * `despliegue/crear-extensiones.sh`. Escribirla aqui seria un segundo sitio donde
 * olvidarse de una, que es justo el defecto que ese guion evito al leer el archivo.
 */

/** Donde viven las migraciones de Flyway, relativo a la raiz del repositorio. */
const MIGRACIONES = "backend/sgtm-esquema/src/main/resources/db/migration";

/** El archivo que declara las extensiones, montado por los manifiestos (issue #149). */
const ROLES = "backend/sgtm-esquema/src/main/resources/db/roles/crear-roles.sql";

/**
 * Un uso que solo una extension puede satisfacer.
 *
 * Cubre **funciones y tipos**. Las clases de operadores no van aqui sino en
 * `DE_EXTENSION`, que es la unica lista que las nombra: tenerlas en los dos sitios seria
 * el segundo lugar donde olvidarse de una, que es justo el defecto que este modulo
 * existe para cerrar.
 *
 * `porque` no es decoracion: sale en el mensaje del rojo, porque quien lo lea puede no
 * saber que `gin_trgm_ops` es de `pg_trgm` — que es exactamente el problema que este
 * modulo existe para no repetir.
 */
export interface Regla {
  extension: string;
  patron: RegExp;
  porque: string;
}

export const REGLAS: readonly Regla[] = [
  {
    extension: "pg_trgm",
    patron: /\b(similarity\s*\(|word_similarity\s*\(|show_trgm\s*\()/i,
    porque: "las funciones de similitud por trigramas las aporta pg_trgm",
  },
  {
    extension: "unaccent",
    patron: /\bunaccent\s*\(/i,
    porque: "unaccent() no es una funcion del nucleo",
  },
  {
    extension: "postgis",
    patron: /\b(geography|geometry)\s*\(\s*[A-Za-z]/i,
    porque: "los tipos geography y geometry los aporta postgis (ADR-0021)",
  },
];

/**
 * Extensiones declaradas en `crear-roles.sql`.
 *
 * El patron es el de `crear-extensiones.sh`, a proposito: si los dos se separan, uno de
 * los dos deja de ver una extension y el sintoma vuelve a ser el de siempre.
 */
export function extensionesDeclaradas(raiz: string = raizDelRepositorio()): string[] {
  const fuente = readFileSync(join(raiz, ROLES), "utf8");
  const encontradas = sinComentarios(fuente).matchAll(
    /CREATE\s+EXTENSION(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-z_0-9]+)/gi,
  );
  const nombres = [...encontradas].map((m) => (m[1] ?? "").toLowerCase()).filter(Boolean);
  return [...new Set(nombres)].sort();
}

/** Las migraciones, en orden de version. */
export function migraciones(raiz: string = raizDelRepositorio()): string[] {
  return readdirSync(join(raiz, MIGRACIONES))
    .filter((n) => n.endsWith(".sql"))
    .sort((a, b) => numeroDe(a) - numeroDe(b));
}

function numeroDe(nombre: string): number {
  return Number(/^V(\d+)__/.exec(nombre)?.[1] ?? 0);
}

/**
 * Quita los comentarios `--` de una linea, dejando el SQL.
 *
 * **No es un detalle.** La cabecera de `V72` explica su `EXCLUDE USING gist` en prosa, y
 * la de `V11` menciona `unaccent()` y `gin_trgm_ops`: buscar el patron en el archivo
 * entero encontraria el comentario y daria por cubierta una migracion a la que se le
 * hubiera borrado el DDL. Es el hueco exacto que #426 destapo en `leerPatron` y que #558
 * volvio a encontrar buscando una cadena que vivia tambien en el comentario que la
 * explicaba.
 */
export function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .map((linea) => linea.replace(/--.*$/, ""))
    .join("\n");
}

export interface Uso {
  migracion: string;
  extension: string;
  porque: string;
}

/** Lo que cada migracion necesita, leido de su DDL y no de su prosa. */
export function usosEnLasMigraciones(raiz: string = raizDelRepositorio()): Uso[] {
  const usos: Uso[] = [];
  for (const migracion of migraciones(raiz)) {
    const ddl = sinComentarios(readFileSync(join(raiz, MIGRACIONES, migracion), "utf8"));
    for (const regla of REGLAS) {
      if (regla.patron.test(ddl)) {
        usos.push({ migracion, extension: regla.extension, porque: regla.porque });
      }
    }
    for (const [clase, extension] of DE_EXTENSION) {
      if (new RegExp(`\\b${clase}\\b`, "i").test(ddl)) {
        usos.push({
          migracion,
          extension,
          porque: `la clase de operadores ${clase} la aporta ${extension}`,
        });
      }
    }
    if (exclusionesConIgualdad(ddl) > 0) {
      usos.push({
        migracion,
        extension: "btree_gist",
        porque:
          "un EXCLUDE USING gist que compara con «=» necesita las clases de operadores " +
          "btree dentro de un indice GiST, y eso lo aporta btree_gist",
      });
    }
  }
  return unicosPorMigracionYExtension(usos);
}

/**
 * Una extension se pide UNA vez por migracion, aunque la delaten dos usos distintos.
 *
 * `V11` nombra `gin_trgm_ops` y ademas llama a `similarity()`: las dos cosas piden
 * `pg_trgm` y la migracion no la necesita dos veces.
 */
function unicosPorMigracionYExtension(usos: Uso[]): Uso[] {
  const vistos = new Map<string, Uso>();
  for (const uso of usos) {
    const llave = `${uso.migracion}|${uso.extension}`;
    if (!vistos.has(llave)) vistos.set(llave, uso);
  }
  return [...vistos.values()];
}

/**
 * Cuantos `EXCLUDE USING gist (...)` del DDL comparan algo con `=`.
 *
 * Se lee el cuerpo con parentesis balanceados y no con una expresion regular: el de
 * `V72` lleva dentro `daterange(vigencia_desde, COALESCE(vigencia_hasta, ...), '[]')`, y
 * un `\(([^)]*)\)` cortaria en el primer parentesis de cierre y perderia el `WITH =`
 * — daria por buena justamente la migracion que rompio el despliegue.
 */
export function exclusionesConIgualdad(ddl: string): number {
  let cuantas = 0;
  const inicio = /EXCLUDE\s+USING\s+gist\s*\(/gi;
  for (const encontrado of ddl.matchAll(inicio)) {
    const cuerpo = cuerpoBalanceado(ddl, encontrado.index + encontrado[0].length - 1);
    if (cuerpo !== null && /WITH\s*=/i.test(cuerpo)) cuantas += 1;
  }
  return cuantas;
}

function cuerpoBalanceado(texto: string, abre: number): string | null {
  let profundidad = 0;
  for (let i = abre; i < texto.length; i += 1) {
    if (texto[i] === "(") profundidad += 1;
    else if (texto[i] === ")") {
      profundidad -= 1;
      if (profundidad === 0) return texto.slice(abre + 1, i);
    }
  }
  return null;
}

/**
 * Clases de operadores del **nucleo**: nombrarlas no exige ninguna extension.
 *
 * La lista es explicita y corta a proposito. La primera version de este modulo no la
 * tenia, sobre la premisa de que «los `_ops` del nucleo rara vez se deletrean» — y
 * **medirlo la desmintio en el acto**: `text_pattern_ops` aparece DIECISEIS veces en
 * las migraciones, porque bajo RLS un `LIKE 'prefijo%'` no llega nunca al indice y toda
 * busqueda por prefijo de este repositorio se escribe con el (DAT-01 §0). Sin esta
 * lista, la mitad honesta de abajo daba dieciseis falsos positivos, que es exactamente
 * lo que hace que una comprobacion deje de leerse.
 */
const DEL_NUCLEO = new Set([
  "text_pattern_ops",
  "varchar_pattern_ops",
  "bpchar_pattern_ops",
  "range_ops",
  "jsonb_path_ops",
]);

/** Clases de operadores que aporta una extension, con cual. */
const DE_EXTENSION = new Map([
  ["gin_trgm_ops", "pg_trgm"],
  ["gist_trgm_ops", "pg_trgm"],
]);

/**
 * Clases de operadores nombradas en un indice que ninguna de las dos listas conoce.
 *
 * Es la mitad honesta de esto: una clase nueva —`btree_gin`, `hstore_ops`, lo que
 * venga— no puede pasar en silencio solo porque esta tabla no la conozca. Si aparece
 * una que no esta ni en `DEL_NUCLEO` ni en `DE_EXTENSION`, esto lo DICE, y quien la
 * anada tiene que decidir en cual de las dos va — que es la decision entera.
 */
export function clasesDeOperadoresSinRegla(raiz: string = raizDelRepositorio()): {
  migracion: string;
  clase: string;
}[] {
  const conocidas = new Set([...DEL_NUCLEO, ...DE_EXTENSION.keys()]);
  const sinRegla: { migracion: string; clase: string }[] = [];
  for (const migracion of migraciones(raiz)) {
    const ddl = sinComentarios(readFileSync(join(raiz, MIGRACIONES, migracion), "utf8"));
    for (const encontrado of ddl.matchAll(/\b([a-z_0-9]+_ops)\b/gi)) {
      const clase = (encontrado[1] ?? "").toLowerCase();
      if (!conocidas.has(clase)) sinRegla.push({ migracion, clase });
    }
  }
  return sinRegla;
}

/** Los usos cuya extension `crear-roles.sql` no declara. Vacio es lo correcto. */
export function usosSinDeclarar(raiz: string = raizDelRepositorio()): Uso[] {
  const declaradas = new Set(extensionesDeclaradas(raiz));
  return usosEnLasMigraciones(raiz).filter((u) => !declaradas.has(u.extension));
}
