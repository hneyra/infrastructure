import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { raizDelRepositorio } from "../componentes/fuentes";
import { SISTEMAS, clonDe, type Sistema } from "./deriva-de-migraciones";

/**
 * Lo que una migracion NECESITA de una extension, contra lo que `crear-roles.sql`
 * DECLARA — **en los cinco esquemas del producto** (issue #742, y su reencuadre en C-2).
 *
 * ## El hueco que cierra, medido y no supuesto
 *
 * `btree_gist` aparecia en exactamente dos sitios del monolito: `V72`, que la usa, y
 * `crear-roles.sql`, que la declara. Entre los dos no habia nada, y el acoplamiento lo
 * sostenia que el autor de cada migracion se diera cuenta al escribirla.
 *
 * **Ya rompio CUATRO despliegues o aplicaciones de esquema por el mismo mecanismo**, y
 * los cuatro con un mensaje que no nombra ni la extension ni el remedio:
 *
 *   - `V61` del monolito, el 2026-08-30: `ERROR: type "geography" does not exist`. Es el
 *     incidente que hizo nacer `despliegue/crear-extensiones.sh`, y dejo a produccion
 *     cuatro dias sin desplegar porque `aplicar-prod` tiene `needs: aplicar-stg`.
 *   - `V72` del monolito (#675): `data type bigint has no default operator class for
 *     access method "gist"`.
 *   - `rentas`, `V1__baseline.sql:1610` durante el corte: `type "geography" does not
 *     exist` (lo arreglo P5E quitando nueve lineas).
 *   - `caja`, `V1__baseline.sql:204` durante el corte: `text search dictionary "unaccent"
 *     does not exist` (lo arreglo P5D).
 *
 * Los cuatro estan arreglados. Lo que no estaba, hasta C-2, es la guarda que impide que
 * vuelva: **la de #742 tenia la ruta del monolito escrita a mano** y no miraba ninguno de
 * los cuatro repositorios nuevos. Los dos ultimos se descubrieron por casualidad, al
 * aplicar el baseline a mano.
 *
 * ## Por que aqui y no en la migracion
 *
 * Porque **una migracion aplicada es inmutable**: editar `V72` para que compruebe la
 * extension y falle con un mensaje decente cambiaria su suma de comprobacion de Flyway
 * y romperia todo ambiente que ya la corrio. La guarda tiene que vivir ANTES de que la
 * migracion llegue a un motor, o no puede vivir.
 *
 * Y tiene que ser estatica, porque **CI nunca lo ve**: el volumen siempre nace vacio y
 * ahi `crear-roles.sql` corre entero, con las extensiones dentro. El fallo solo aparece
 * en un cluster que ya existia, en un Job de Kubernetes, una hora despues.
 *
 * ## Por que aqui y no en cada repositorio
 *
 * Porque el defecto es de familia y la comprobacion es una: escribir la misma en cuatro
 * repositorios seria tener cuatro sitios donde se puede olvidar de una extension nueva,
 * que es exactamente el defecto que esto cierra un escalon mas arriba. `infrastructure`
 * es donde viven las barreras que verifican a los cuatro sistemas (ADR-0031).
 *
 * ## Ni la lista de esquemas ni la de extensiones se escriben aqui
 *
 * Los esquemas salen de {@link SISTEMAS}, la tabla que `deriva-de-migraciones.ts` ya
 * mantiene por otro motivo: una lista propia seria un segundo sitio donde olvidarse de un
 * sistema, y `esquemas()` no puede quedarse rancia porque no existe.
 *
 * Las extensiones declaradas salen de cada `crear-roles.sql`, leidas con el MISMO patron
 * que `despliegue/crear-extensiones.sh`. Escribirlas aqui seria el mismo defecto una vez
 * mas.
 */

/**
 * Una copia del esquema que alguien provisiona: sus migraciones y su `crear-roles.sql`.
 *
 * La unidad NO es el repositorio sino la **copia del esquema**, y la diferencia importa
 * en un solo caso: el monolito tiene dos —la de su clon, de la que
 * `publicar-imagenes.yml` construye `sgtm-migrador`, y la de este repositorio, que es la
 * que el `ConfigMap` y el compose montan como `10-crear-roles.sql`—. Son byte a byte la
 * misma hoy (medido con `diff -rq`), y nada lo garantiza: se miden las dos.
 */
export interface Esquema {
  /** Como sale en el rojo. Nombra el repositorio. */
  nombre: string;
  /** Raiz absoluta del clon donde vive esta copia. */
  raiz: string;
  /** Migraciones de Flyway, relativo a {@link raiz}. */
  migraciones: string;
  /** El archivo que declara las extensiones, relativo a {@link raiz}. */
  roles: string;
}

/** El sufijo con que {@link SISTEMAS} nombra el directorio de migraciones. */
const SUFIJO_MIGRACIONES = "migration/";

/** El archivo de roles, hermano del directorio de migraciones bajo `db/`. */
const ARCHIVO_DE_ROLES = "roles/crear-roles.sql";

/**
 * El `crear-roles.sql` que le toca a un directorio de migraciones.
 *
 * Se DERIVA en vez de declararse porque los dos son hermanos bajo `db/` en los cinco
 * esquemas, y una segunda columna en {@link SISTEMAS} seria una segunda cosa que
 * mantener de acuerdo. Que la convencion se cumpla no se supone: `esquemas()` no admite
 * una ruta que no acabe en `migration/`, y una prueba exige que los dos archivos existan
 * en los seis.
 */
export function rolesDe(migraciones: string): string {
  if (!migraciones.endsWith(SUFIJO_MIGRACIONES)) {
    throw new Error(
      `«${migraciones}» no acaba en «${SUFIJO_MIGRACIONES}», asi que no se puede derivar ` +
        `donde esta su «${ARCHIVO_DE_ROLES}».\n` +
        "  Los dos son hermanos bajo `db/` en los cinco esquemas. Si uno deja de serlo, " +
        "hay que decirlo aqui: replegarse a «no se puede saber, paso en verde» es " +
        "exactamente el estado que #742 encontro.",
    );
  }
  return migraciones.slice(0, -SUFIJO_MIGRACIONES.length) + ARCHIVO_DE_ROLES;
}

/**
 * La copia del esquema del monolito que vive en ESTE repositorio.
 *
 * `CLAUDE.md` la llama «referencia historica» y nadie aplica sus migraciones desde aqui
 * — pero su `crear-roles.sql` **si** se aplica: `componentes/fuentes.ts` lo mete en el
 * `ConfigMap` del cluster y `despliegue/plataforma.compose.yaml` lo monta como
 * `10-crear-roles.sql`. Es la mitad que de verdad se ejecuta del par que despliega el
 * monolito, asi que se mide aunque el clon de `sgtm` no este.
 */
function copiaLocalDelMonolito(sgtm: Sistema): Esquema {
  return {
    nombre: "infrastructure (copia del esquema del monolito)",
    raiz: raizDelRepositorio(),
    migraciones: sgtm.migraciones,
    roles: rolesDe(sgtm.migraciones),
  };
}

/**
 * Las copias del esquema que esta guarda mide.
 *
 * Los cinco sistemas de {@link SISTEMAS} —cada uno en su clon hermano— mas la copia local
 * del monolito. {@link clonDe} es quien exige que el clon este: un sistema cuyo esquema no
 * se puede leer **no pasa en verde**, por lo mismo que #675 escribio primero.
 */
export function esquemas(): Esquema[] {
  const sgtm = SISTEMAS.find((sistema) => sistema.nombre === "sgtm");
  if (sgtm === undefined) {
    throw new Error(
      "SISTEMAS ya no declara «sgtm», y este repositorio sigue llevando una copia de su " +
        "esquema en `backend/sgtm-esquema`. Hay que decidir que se mide, no dejar de mirar.",
    );
  }
  return [
    copiaLocalDelMonolito(sgtm),
    ...SISTEMAS.map((sistema) => ({
      nombre: sistema.nombre,
      raiz: clonDe(sistema),
      migraciones: sistema.migraciones,
      roles: rolesDe(sistema.migraciones),
    })),
  ];
}

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
 * Extensiones declaradas en el `crear-roles.sql` de ese esquema.
 *
 * El patron es el de `crear-extensiones.sh`, a proposito: si los dos se separan, uno de
 * los dos deja de ver una extension y el sintoma vuelve a ser el de siempre.
 *
 * **Cero es una respuesta legitima**, y no un archivo que no se pudo leer: `caja` no
 * declara ninguna a proposito (P5D), «porque la caja tiene que poder correr en el motor
 * mas simple que exista». Lo que no es legitimo es que el archivo falte, y eso lo dice
 * `leerRoles`.
 */
export function extensionesDeclaradas(esquema: Esquema): string[] {
  const encontradas = sinComentarios(leerRoles(esquema)).matchAll(
    /CREATE\s+EXTENSION(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-z_0-9]+)/gi,
  );
  const nombres = [...encontradas].map((m) => (m[1] ?? "").toLowerCase()).filter(Boolean);
  return [...new Set(nombres)].sort();
}

function leerRoles(esquema: Esquema): string {
  const ruta = join(esquema.raiz, esquema.roles);
  if (!existsSync(ruta)) {
    throw new Error(
      `Falta «${ruta}», que es donde «${esquema.nombre}» declara sus extensiones.\n` +
        "  Sin ese archivo esta comprobacion no puede decir nada, y no se salta: un " +
        "esquema cuya declaracion no se puede leer es el estado que #742 existe para " +
        "impedir.",
    );
  }
  return readFileSync(ruta, "utf8");
}

/** Las migraciones de ese esquema, en orden de version. */
export function migraciones(esquema: Esquema): string[] {
  const directorio = join(esquema.raiz, esquema.migraciones);
  if (!existsSync(directorio)) {
    throw new Error(
      `Falta «${directorio}», que es donde viven las migraciones de «${esquema.nombre}».\n` +
        "  Si el directorio se movio hay que actualizar SISTEMAS, no dejar de mirar: con " +
        "cero migraciones esta comprobacion volveria vacia y pasaria en verde sin haber " +
        "abierto un archivo.",
    );
  }
  return readdirSync(directorio)
    .filter((n) => n.endsWith(".sql"))
    .sort((a, b) => numeroDe(a) - numeroDe(b));
}

function numeroDe(nombre: string): number {
  return Number(/^V(\d+)__/.exec(nombre)?.[1] ?? 0);
}

/**
 * Quita los comentarios `--` de una linea, dejando el SQL.
 *
 * **No es un detalle.** La cabecera de `V72` explica su `EXCLUDE USING gist` en prosa, la
 * de `V11` menciona `unaccent()` y `gin_trgm_ops`, y el `crear-roles.sql` de `caja`
 * nombra las cuatro extensiones para explicar por que NO declara ninguna: buscar el
 * patron en el archivo entero encontraria el comentario y daria por cubierta —o por
 * declarada— una extension que no esta. Es el hueco exacto que #426 destapo en
 * `leerPatron` y que #558 volvio a encontrar buscando una cadena que vivia tambien en el
 * comentario que la explicaba.
 */
export function sinComentarios(sql: string): string {
  return sql
    .split("\n")
    .map((linea) => linea.replace(/--.*$/, ""))
    .join("\n");
}

export interface Uso {
  /** El esquema —y con el, el repositorio— que la necesita. */
  sistema: string;
  migracion: string;
  extension: string;
  porque: string;
}

/** El rojo, en una linea: repositorio, migracion, extension y por que hace falta. */
export function descripcionDelUso(uso: Uso): string {
  return (
    `«${uso.sistema}»: ${uso.migracion} necesita la extension «${uso.extension}» y su ` +
    `crear-roles.sql no la declara — ${uso.porque}`
  );
}

/** Lo que cada migracion de ese esquema necesita, leido de su DDL y no de su prosa. */
export function usosDelEsquema(esquema: Esquema): Uso[] {
  const usos: Uso[] = [];
  for (const migracion of migraciones(esquema)) {
    const ddl = sinComentarios(
      readFileSync(join(esquema.raiz, esquema.migraciones, migracion), "utf8"),
    );
    for (const regla of REGLAS) {
      if (regla.patron.test(ddl)) {
        usos.push({
          sistema: esquema.nombre,
          migracion,
          extension: regla.extension,
          porque: regla.porque,
        });
      }
    }
    for (const [clase, extension] of DE_EXTENSION) {
      if (new RegExp(`\\b${clase}\\b`, "i").test(ddl)) {
        usos.push({
          sistema: esquema.nombre,
          migracion,
          extension,
          porque: `la clase de operadores ${clase} la aporta ${extension}`,
        });
      }
    }
    if (exclusionesConIgualdad(ddl) > 0) {
      usos.push({
        sistema: esquema.nombre,
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

/** Lo que necesitan **todos** los esquemas, en el orden de {@link esquemas}. */
export function usosEnLasMigraciones(): Uso[] {
  return esquemas().flatMap(usosDelEsquema);
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
    const llave = `${uso.sistema}|${uso.migracion}|${uso.extension}`;
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
 * las migraciones del monolito, porque bajo RLS un `LIKE 'prefijo%'` no llega nunca al
 * indice y toda busqueda por prefijo de este producto se escribe con el (hallazgos de
 * RLS §3). Sin esta lista, la mitad honesta de abajo daba dieciseis falsos positivos, que
 * es exactamente lo que hace que una comprobacion deje de leerse.
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

export interface ClaseSinRegla {
  sistema: string;
  migracion: string;
  clase: string;
}

/**
 * Clases de operadores nombradas en un indice que ninguna de las dos listas conoce.
 *
 * Es la mitad honesta de esto: una clase nueva —`btree_gin`, `hstore_ops`, lo que
 * venga— no puede pasar en silencio solo porque esta tabla no la conozca. Si aparece
 * una que no esta ni en `DEL_NUCLEO` ni en `DE_EXTENSION`, esto lo DICE, y quien la
 * anada tiene que decidir en cual de las dos va — que es la decision entera.
 */
export function clasesDeOperadoresSinRegla(): ClaseSinRegla[] {
  const conocidas = new Set([...DEL_NUCLEO, ...DE_EXTENSION.keys()]);
  const sinRegla: ClaseSinRegla[] = [];
  for (const esquema of esquemas()) {
    for (const migracion of migraciones(esquema)) {
      const ddl = sinComentarios(
        readFileSync(join(esquema.raiz, esquema.migraciones, migracion), "utf8"),
      );
      for (const encontrado of ddl.matchAll(/\b([a-z_0-9]+_ops)\b/gi)) {
        const clase = (encontrado[1] ?? "").toLowerCase();
        if (!conocidas.has(clase)) sinRegla.push({ sistema: esquema.nombre, migracion, clase });
      }
    }
  }
  return sinRegla;
}

/**
 * Los usos cuya extension su `crear-roles.sql` no declara. Vacio es lo correcto.
 *
 * `lista` existe por un solo motivo, y conviene decirlo para que nadie lo use por otro:
 * el archivo historico `sgtm` **no se escribe**, asi que demostrar que esta guarda muerde
 * sobre su esquema exige correrla contra una copia. Lo que sujeta que la corrida de
 * verdad mire los seis es la prueba que fija `esquemas()`, no este parametro.
 */
export function usosSinDeclarar(lista: Esquema[] = esquemas()): Uso[] {
  return lista.flatMap((esquema) => {
    const declaradas = new Set(extensionesDeclaradas(esquema));
    return usosDelEsquema(esquema).filter((uso) => !declaradas.has(uso.extension));
  });
}

export interface Sobrante {
  sistema: string;
  extension: string;
}

/** Igual que el uso, en una linea, y nombrando el repositorio. */
export function descripcionDelSobrante(sobrante: Sobrante): string {
  return `«${sobrante.sistema}» declara «${sobrante.extension}» y ninguna migracion suya la usa`;
}

/**
 * Extensiones declaradas que **ninguna migracion de ese esquema usa**.
 *
 * La otra direccion, y la mitad que #742 no miraba. No es simetrica de la primera y no
 * puede tratarse igual: una que falta **rompe el despliegue**, y una que sobra no rompe
 * nada hoy. Por que se dice igualmente, y por que como censo y no como rojo, esta en
 * {@link DECLARADAS_DE_MAS}.
 */
export function declaradasSinUsar(lista: Esquema[] = esquemas()): Sobrante[] {
  return lista.flatMap((esquema) => {
    const usadas = new Set(usosDelEsquema(esquema).map((uso) => uso.extension));
    return extensionesDeclaradas(esquema)
      .filter((extension) => !usadas.has(extension))
      .map((extension) => ({ sistema: esquema.nombre, extension }));
  });
}

/**
 * Las declaraciones de mas que se consienten. **Hoy: ninguna** (C-13).
 *
 * ## Por que esto paso de censo a rojo
 *
 * C-2 midio cinco declaraciones de mas —`pg_trgm` en `catastro` y las cuatro de
 * `normativa`— y las dejo como CENSO y no como rojo, por dos motivos que decia con todas
 * sus letras: que un rojo «naceria disparado en dos de los seis esquemas» (#437: una
 * comprobacion que grita el primer dia se acaba silenciando), y que retirar una
 * declaracion «cambia como se provisiona esa base en todos los ambientes», que es decision
 * del duenio del esquema y no efecto colateral de una guarda de `infrastructure`.
 *
 * C-13 retiro las cinco, asi que el primer motivo se acabo: el rojo nace **en verde**. Y el
 * segundo se contesto midiendo, no opinando:
 *
 *   - el esquema resultante es **el mismo**. Aplicados los dos `crear-roles.sql` —el de
 *     antes y el de despues— y encima todas las migraciones, contra PostgreSQL 16.15 real,
 *     el `pg_dump --schema-only` difiere en **exactamente las lineas de las extensiones
 *     retiradas** y en nada mas: ni una tabla, ni un indice, ni una restriccion, ni una
 *     politica.
 *   - retirar **no es destructivo**: no hay ningun `DROP EXTENSION` en ninguno de los
 *     cinco archivos, asi que una base ya provisionada conserva lo que tenga. Lo que
 *     cambia es que una base NUEVA no lo recibe.
 *   - y el precedente lo pusieron los propios duenios, dos veces: P5D dejo `caja` sin
 *     ninguna y P5E dejo `rentas` con dos. C-13 aplica esa misma decision a los dos
 *     esquemas donde la poda simplemente no se habia hecho.
 *
 * Y C-10 cambio lo que cuesta NO decidirlo: hasta C-10 `05-crear-bases.sh` creaba las
 * cuatro extensiones en las cuatro bases con la lista escrita a mano, asi que sobrar era
 * inerte en el entorno local. Desde C-10 **lo declarado es lo que actua**, de modo que
 * dejar `postgis` en `normativa` seria crearla de verdad en una base que no dibuja nada.
 *
 * ## Por que la lista se queda, vacia
 *
 * Porque lo que permite es una excepcion **temporal y nombrada**, y con la lista vacia una
 * declaracion de mas nueva no tiene donde esconderse: la unica forma de callarla es
 * escribir aqui su motivo, y eso se ve en el diff. Es la misma decision que #429 tomo con
 * su lista de pendientes al quedarse vacia.
 *
 * La prueba la compara en las DOS direcciones, como antes: una declaracion de mas que no
 * este aqui pone la guarda roja nombrando repositorio y extension, y una entrada de aqui
 * que deje de ser cierta —porque alguien la retiro, o porque una migracion empezo a
 * usarla— tambien.
 */
export const DECLARADAS_DE_MAS: readonly (Sobrante & { porque: string })[] = [] as const;
