import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { raizDeInfra, raizDelRepositorio } from "../componentes/fuentes";

/**
 * El barrido de **que base nombra cada guion de shell** (#15, #16).
 *
 * ## Por que un barrido y no un `grep`
 *
 * `E` retiro la base `sgtm` y dejo veintiseis referencias a ella en siete guiones de
 * operacion. **Ninguna la vio `yarn verificar`**, porque no ejecuta los guiones, y se
 * descubrieron en cuatro corridas de CI sucesivas que dijeron cuatro cosas distintas de la
 * misma causa. Y no eran cuatro defectos: era **el mismo buscado con el metodo equivocado**
 * —un `grep` de literales, sitio a sitio, en vez de un barrido—. Este archivo es el barrido.
 *
 * Lo que lo hace util no es encontrar la palabra `sgtm`: es **enumerar todas las formas en
 * que un guion nombra una base** y resolverlas a un nombre, para que la comparacion sea
 * contra el censo de bases del ambiente —derivado del descriptor— y no contra una lista.
 * Las formas estan medidas sobre el arbol, no supuestas:
 *
 *   - `--dbname=X` y `--dbname X`;
 *   - `-d X`, pero solo en una linea que invoque una herramienta de PostgreSQL: `ls -d` y
 *     `mktemp -d` no nombran ninguna base;
 *   - `PGDATABASE=X` y `POSTGRES_DB=X`;
 *   - `jdbc:postgresql://host:puerto/X`, que es la que **se le escapo a `E`**: sus tres
 *     Jobs de `carga-de-datos` seguian apuntando a `/sgtm` el 2026-09-07, y el `grep` de
 *     `--dbname=sgtm` no los veia;
 *   - y la asignacion `…BASE…=X`, que es donde vive la eleccion.
 *
 * ## Lo que NO es una base, y por que hay que decirlo
 *
 * `KC_REALM:-kamayuk` en `reconciliar-identidades.sh` nombra un **realm de Keycloak**, no
 * una base, y es correcto: se llama asi porque es el nombre del producto. Ninguna de las seis formas de
 * arriba lo alcanza, y hay una prueba que lo afirma sobre ese archivo — porque «no sale
 * rojo» tambien seria cierto si el barrido no hubiera leido el archivo.
 */

/** Un sitio de un guion que nombra una base de datos. */
export interface ReferenciaAUnaBase {
  /** Ruta relativa a la raiz del repositorio. */
  readonly archivo: string;
  /** Numero de linea, empezando en 1. */
  readonly linea: number;
  /** La linea, sin sangria. */
  readonly texto: string;
  /** Como se nombro. */
  readonly forma: "--dbname" | "-d" | "PGDATABASE" | "jdbc" | "asignacion";
  /** Lo escrito tal cual: `rentas`, `$BASE_DEL_PADRON`, `${2:-postgres}`. */
  readonly token: string;
  /** El nombre de base al que se resuelve, cuando se puede. */
  readonly base?: string;
  /** Si el token era `${N:-X}`, el `X`; y a que base se resuelve, si se puede. */
  readonly omision?: { readonly token: string; readonly base?: string };
  /** El nombre de la variable, cuando la forma es `asignacion`. */
  readonly variable?: string;
}

const HERRAMIENTAS = /\b(psql|pg_dump|pg_dumpall|pg_restore|pg_isready)\b/;

/**
 * **Todos los guiones de shell que el repositorio declara**, leidos de `git ls-files`.
 *
 * Del arbol de git y no del disco, por lo mismo que `el-monolito-fuera.test.ts`: un archivo
 * sin versionar no cuenta, y lo que importa es lo que el repositorio dice. Y de `git` y no
 * de una lista de directorios, que es la parte que hace que esto sea un barrido: el guion
 * que alguien anada manana en un directorio nuevo entra solo. `E` se descubrio buscando
 * literales sitio a sitio, que es justamente lo contrario.
 */
export function guionesVersionados(): string[] {
  const listado = execFileSync("git", ["-C", raizDelRepositorio(), "ls-files", "*.sh"], {
    encoding: "utf8",
  })
    .split("\n")
    .filter((linea) => linea.trim() !== "")
    .sort();
  if (listado.length === 0) {
    throw new Error(
      "`git ls-files *.sh` no devolvio ni un guion: este barrido NO MIDIO NADA. Una guarda " +
        "que se queda sin sujeto no pasa en verde.",
    );
  }
  return listado;
}

/** Todos los `*.sh` bajo las raices dadas, en orden estable y relativos al repositorio. */
export function guionesDe(raices: readonly string[]): string[] {
  const encontrados: string[] = [];
  const recorrer = (directorio: string): void => {
    for (const entrada of readdirSync(directorio, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const ruta = join(directorio, entrada.name);
      if (entrada.isDirectory()) {
        if (entrada.name === "node_modules" || entrada.name === ".git") continue;
        recorrer(ruta);
      } else if (entrada.name.endsWith(".sh")) {
        encontrados.push(relative(raizDelRepositorio(), ruta));
      }
    }
  };
  for (const raiz of raices) {
    if (!statSync(raiz, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(
        `No existe el directorio «${raiz}»: el barrido de bases no puede leer ningun guion, ` +
          "asi que no medira nada. Falla en vez de informar de cero referencias.",
      );
    }
    recorrer(raiz);
  }
  if (encontrados.length === 0) {
    throw new Error(
      `No hay ni un archivo .sh bajo ${raices.join(", ")}: este barrido NO MIDIO NADA. Una ` +
        "guarda " +
        "que se queda sin sujeto no pasa en verde — es la doctrina de `verificarAislamiento`.",
    );
  }
  return encontrados;
}

/**
 * Lo que `infra/bases.sh` deja fijado, **ejecutandolo**.
 *
 * Es la mitad que pone de acuerdo al shell con TypeScript, y se hace igual que
 * `verificar-el-ambiente.sh` y `crear-extensiones.sh` con sus listas de sistemas: se corre
 * el archivo de verdad y se lee lo que queda. Una prueba que solo mirara que el archivo
 * *nombra* `rentas` pasaria con la asignacion rota.
 */
export function basesDelShell(): Record<string, string> {
  const archivo = join(raizDeInfra(), "bases.sh");
  // Lo que se toma es la DIFERENCIA entre antes y despues de cargarlo, no el volcado
  // entero. No es cosmetica: `set` incluye lo heredado, asi que cualquier variable de la
  // maquina cuyo nombre empiece por `BASE` entraria como si la hubiera declarado el archivo
  // —medido: `ANTHROPIC_BASE_URL` de este puesto salia en la primera version—, y la guarda
  // hablaria de algo que el repositorio no dice. Vaciar el entorno con `env -i` tambien
  // servia y se descarto: obliga a reponerle un `PATH`, y leer `process.env` aqui esta
  // prohibido con su muestra (`config.ts` es quien lee la configuracion).
  const salida = execFileSync(
    "bash",
    [
      "-c",
      // A dos ARCHIVOS y no a dos variables: el valor de una variable que guarda el
      // volcado entero es multilinea, y al volcarlo la segunda vez `set` lo reimprime
      // linea a linea — medido, el «despues» salia con el doble de lineas y la diferencia
      // era todo el entorno.
      'a=$(mktemp); b=$(mktemp); (set -o posix; set) > "$a"; . "$1"; ' +
        '(set -o posix; set) > "$b"; comm -13 <(sort "$a") <(sort "$b"); rm -f "$a" "$b"',
      "bash",
      archivo,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const bases: Record<string, string> = {};
  for (const linea of salida.split("\n")) {
    const par = /^(BASE(?:_[A-Z0-9_]+)?)=(.*)$/.exec(linea);
    if (par) bases[par[1] as string] = (par[2] as string).replace(/^'(.*)'$/, "$1");
  }
  if (Object.keys(bases).length === 0) {
    throw new Error(
      `Ejecutar «${archivo}» no dejo fijada ni una variable de base: el unico sitio del lado ` +
        "shell esta vacio o dejo de asignar, y todo lo de abajo se cumpliria solo.",
    );
  }
  return bases;
}

/** Quita el comentario final de una linea de shell, respetando lo que va entre comillas. */
function sinComentario(linea: string): string {
  let dentro: string | null = null;
  for (let i = 0; i < linea.length; i += 1) {
    const c = linea[i] as string;
    if (dentro) {
      if (c === dentro) dentro = null;
    } else if (c === "'" || c === '"') {
      dentro = c;
    } else if (c === "#" && (i === 0 || /\s/.test(linea[i - 1] as string))) {
      return linea.slice(0, i);
    }
  }
  return linea;
}

/** Quita comillas y llaves de `"${VAR}"`, `'X'`, `"X"`. */
function desnudo(token: string): string {
  return token.replace(/^["']|["']$/g, "").trim();
}

/**
 * Resuelve un token a un nombre de base, si se puede.
 *
 * Un literal se resuelve a si mismo. Un `$VAR` se resuelve por el mapa de variables — el de
 * `bases.sh` mas las asignaciones literales que el propio guion hace antes—. Lo que no se
 * puede resolver —`$sistema` de un bucle, `$1`— se devuelve sin base, y **no es un fallo**:
 * una base que se decide en tiempo de ejecucion no es una eleccion escrita.
 */
function resolver(token: string, variables: Record<string, string>): string | undefined {
  const limpio = desnudo(token);
  const variable = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(limpio);
  if (variable) return variables[variable[1] as string];
  if (/^[a-z][a-z0-9_]*$/.test(limpio)) return limpio;
  return undefined;
}

/** Parte `${N:-X}` en su token de omision; `undefined` si no tiene esa forma. */
function omisionDe(token: string): string | undefined {
  const con = /^\$\{[^:}]+:-(.*)\}$/.exec(desnudo(token));
  return con ? (con[1] as string) : undefined;
}

/**
 * Todas las referencias a una base de los guiones dados.
 *
 * Lanza si no encuentra ninguna: un barrido vacio no es un arbol limpio, es un barrido que
 * dejo de mirar donde tenia que mirar (la leccion de `mirar.mjs` y de #29).
 */
export function referenciasABases(
  guiones: readonly string[],
  variablesCompartidas: Record<string, string> = {},
): ReferenciaAUnaBase[] {
  const referencias: ReferenciaAUnaBase[] = [];

  for (const archivo of guiones) {
    const lineas = readFileSync(join(raizDelRepositorio(), archivo), "utf8").split("\n");
    const variables: Record<string, string> = { ...variablesCompartidas };

    lineas.forEach((cruda, indice) => {
      const linea = sinComentario(cruda);
      if (linea.trim() === "") return;
      const sitio = { archivo, linea: indice + 1, texto: cruda.trim() };

      const anotar = (
        forma: ReferenciaAUnaBase["forma"],
        token: string,
        variable?: string,
      ): void => {
        const omisionToken = omisionDe(token);
        referencias.push({
          ...sitio,
          forma,
          token: desnudo(token),
          base: resolver(token, variables),
          ...(omisionToken === undefined
            ? {}
            : { omision: { token: omisionToken, base: resolver(omisionToken, variables) } }),
          ...(variable === undefined ? {} : { variable }),
        });
      };

      // 1. Asignaciones de una variable de base. Tambien alimentan la resolucion.
      const asignacion = /^\s*(export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(\S*)/.exec(linea);
      if (asignacion) {
        const nombre = asignacion[2] as string;
        const valor = asignacion[3] as string;
        const resuelto = resolver(valor, variables);
        if (resuelto !== undefined) variables[nombre] = resuelto;
        // Solo las que EMPIEZAN por `BASE`: `BASES` es una lista y `KAMAYUK_BASELINE_URL`
        // no nombra ninguna base — medido, las dos existen en el arbol.
        if (/^BASE(_[A-Z0-9_]+)?$/.test(nombre)) anotar("asignacion", valor, nombre);
      }

      // 2. Las cinco formas en que una linea nombra la base con la que habla.
      for (const [expresion, forma] of [
        [/--dbname[= ]("[^"]*"|'[^']*'|\S+)/g, "--dbname"],
        [/\bjdbc:postgresql:\/\/[^/\s"']+\/([^\s"'?]+)/g, "jdbc"],
        [/\b(?:PGDATABASE|POSTGRES_DB)=("[^"]*"|'[^']*'|\S+)/g, "PGDATABASE"],
      ] as const) {
        for (const hallazgo of linea.matchAll(expresion)) anotar(forma, hallazgo[1] as string);
      }
      if (HERRAMIENTAS.test(linea)) {
        for (const hallazgo of linea.matchAll(/\s-d\s+("[^"]*"|'[^']*'|\S+)/g)) {
          anotar("-d", hallazgo[1] as string);
        }
      }
    });
  }

  if (referencias.length === 0) {
    throw new Error(
      `Los ${guiones.length} guion(es) barridos no nombran ni una base: el barrido dejo de ` +
        "reconocer las formas que buscaba, y todo lo que cuelga de el se cumpliria solo.",
    );
  }
  return referencias;
}

/**
 * Los `case "$X" in` cuyas ramas eligen una base, con la linea en que `X` recibe un valor
 * que no es el vacio.
 *
 * Existe por un defecto **vivo**, encontrado al escribir esto: `rotar-clave.sh` decidia
 * `BASE_DEL_ROL` en la linea 45 a partir de `$ROL`, y `--rol` se lee en la 53. Con `$ROL`
 * vacio el `case` caia siempre por `*)`, asi que `--rol postgres-carga` comprobaba la
 * credencial contra el PADRON —donde `rol_carga_parametros` no tiene CONNECT a proposito—:
 * rojo sobre una credencial buena, y nada lo decia. Es el segundo defecto de #15
 * —`verificar-el-motor.sh` declarando DESPUES de cargar la biblioteca— por el otro eje.
 */
export function elecionesDeBasePorCase(
  guiones: readonly string[],
): { archivo: string; linea: number; sujeto: string; asignadoEn?: number }[] {
  const casos: { archivo: string; linea: number; sujeto: string; asignadoEn?: number }[] = [];
  for (const archivo of guiones) {
    const lineas = readFileSync(join(raizDelRepositorio(), archivo), "utf8").split("\n");
    lineas.forEach((cruda, indice) => {
      const apertura = /^\s*case\s+"?\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?"?\s+in\s*$/.exec(
        sinComentario(cruda),
      );
      if (!apertura) return;
      const sujeto = apertura[1] as string;
      let eligeBase = false;
      for (let i = indice + 1; i < lineas.length; i += 1) {
        const cuerpo = sinComentario(lineas[i] as string);
        if (/^\s*esac\b/.test(cuerpo)) break;
        if (/\b[A-Za-z_]*BASE[A-Z0-9_]*=/.test(cuerpo)) eligeBase = true;
      }
      if (!eligeBase) return;

      let asignadoEn: number | undefined;
      for (let i = 0; i < indice; i += 1) {
        const previa = sinComentario(lineas[i] as string);
        const asignacion = new RegExp(`\\b${sujeto}=(\\S*)`).exec(previa);
        if (asignacion && desnudo(asignacion[1] as string) !== "") asignadoEn = i + 1;
      }
      casos.push({ archivo, linea: indice + 1, sujeto, ...(asignadoEn ? { asignadoEn } : {}) });
    });
  }
  return casos;
}
