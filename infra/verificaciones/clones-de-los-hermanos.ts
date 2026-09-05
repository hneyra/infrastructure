import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { load } from "js-yaml";

/**
 * Todo trabajo que necesite los descriptores hermanos clona a sus hermanos (C-20).
 *
 * ## El defecto, medido y no supuesto
 *
 * `descriptor/sistemas.ts` importa los cuatro descriptores del corte de
 * `../../../<sistema>/infrastructure/src/descriptor`, o sea de repositorios HERMANOS.
 * C-9a resolvio como tenerlos en CI —el anfitrion se clona en `path: infrastructure` y
 * el espacio de trabajo pasa a hacer de padre— y lo aplico **en un solo trabajo de
 * quince**. Los otros catorce se quedaron con su `checkout` en la raiz y sin hermanos.
 *
 * Lo medido en la corrida `33969248652` de `infra.yml`, el 2026-09-05:
 *
 *   - **nueve trabajos rojos**, los nueve con el mismo error y nada mas:
 *
 *         Error: Cannot find module '../../../caja/infrastructure/src/descriptor'
 *           imported from '/home/runner/work/infrastructure/infrastructure/infra/
 *                          descriptor/sistemas.ts'
 *
 *     `motor`, `raiz-sellada`, `simulacro`, `manifiestos`, `capacidad`, `secretos`,
 *     `observabilidad-alertas`, `observabilidad-tableros` y `red`;
 *   - y **cinco mas rotos sin salir rojos**: `previsualizar-stg` y `previsualizar-prod`
 *     solo corren en un `pull_request`; `deteccion-de-deriva`, solo de madrugada; y
 *     `aplicar-stg`/`aplicar-prod` tienen todos sus pasos afectados detras de un `if` de
 *     credenciales que hoy no se cumple — `aplicar-stg` salio **en verde en 32 s** sin
 *     haber ejecutado ninguno. Un trabajo roto que sale verde es peor que uno rojo.
 *
 * ## Que se comprueba, y por que derivado
 *
 * La pregunta es «¿este trabajo necesita los hermanos?», y se contesta **midiendo**, no
 * con una lista escrita a mano —una lista es exactamente el segundo sitio donde
 * olvidarse, que es el defecto que esto cierra—:
 *
 *   1. {@link herramientasQueLosNecesitan} recorre el grafo de importaciones desde cada
 *      guion de `package.json` y desde `index.ts` (el programa de Pulumi), y se queda con
 *      los que alcanzan `descriptor/sistemas.ts`;
 *   2. {@link guionesQueLosNecesitan} recorre los `*.sh` del repositorio y se queda con
 *      los que invocan una de esas herramientas, **o hacen `source` de otro que si**
 *      —asi entra `lib-motor-local.sh`, que es por donde `motor` y `simulacro` caian—;
 *   3. {@link trabajosSinSusHermanos} lee cada trabajo del flujo YA ANALIZADO —sin
 *      comentarios, que nombran herramientas sin invocarlas— y exige las dos mitades: la
 *      accion compuesta, y el `path: infrastructure` del anfitrion sin el cual la accion
 *      no puede ni referenciarse.
 *
 * ## El limite, declarado en vez de descubierto
 *
 * Dos, y las dos en la direccion segura —pedir clones de mas nunca deja pasar un trabajo
 * roto—:
 *
 *   - un trabajo que necesitara los descriptores por un camino que no pasa ni por una
 *     herramienta de `package.json` ni por un guion del repositorio —una linea de
 *     `node -e` que importara `descriptor/sistemas.ts` a pelo, digamos— no se detectaria.
 *     Hoy no hay ninguno, y el dia que lo haya el sintoma es el error de arriba;
 *   - {@link loQueEjecuta} quita comentarios y `echo`/`printf`, y no interpreta las
 *     comillas del shell: `reservar-recursos-del-nodo.sh` sigue contandose por un
 *     «pulumi up» que vive dentro de un *here-document* de aviso. Marcarlo no cuesta
 *     nada —ese guion no lo llama ningun flujo— y desenredar el entrecomillado del shell
 *     es mas maquinaria que lo que el hallazgo vale.
 */

/** Un trabajo que necesita los hermanos y no los clona. */
export interface TrabajoSinSusHermanos {
  /** Ruta del flujo, relativa a la raiz del clon. */
  archivo: string;
  /** La clave del trabajo en `jobs:`. */
  trabajo: string;
  /** Que se lo hace necesitar: la herramienta o el guion que invoca. */
  porque: string;
  /** Que le falta, en palabras de quien lo tiene que arreglar. */
  falta: string;
}

/** Donde vive la accion compuesta, relativa a la raiz del clon. */
export const ACCION = ".github/actions/clonar-los-hermanos";

/**
 * Los nombres de los clones hermanos que `descriptor/sistemas.ts` importa.
 *
 * Se leen de sus especificadores —`../../../caja/infrastructure/src/descriptor` da
 * `caja`— y no de una lista: el dia que entre un quinto sistema, la accion tiene que
 * clonarlo y esto lo dice sola.
 */
export function hermanosQueImportaElDescriptor(raizDeInfra: string): string[] {
  const fuente = readFileSync(join(raizDeInfra, "descriptor", "sistemas.ts"), "utf8");
  const nombres = new Set<string>();
  for (const m of fuente.matchAll(/["']\.\.\/\.\.\/\.\.\/([^/"']+)\//g)) nombres.add(m[1]!);
  return [...nombres].sort();
}

/** Resuelve un especificador relativo de TypeScript a un archivo, si es de este arbol. */
function archivoImportado(desde: string, especificador: string): string | undefined {
  if (!especificador.startsWith(".")) return undefined;
  const base = resolve(dirname(desde), especificador);
  for (const candidato of [base, `${base}.ts`, join(base, "index.ts")]) {
    if (existsSync(candidato) && statSync(candidato).isFile()) return candidato;
  }
  return undefined;
}

/** Si desde ese archivo se llega, siguiendo importaciones, hasta `objetivo`. */
function alcanza(entrada: string, objetivo: string): boolean {
  const vistos = new Set<string>();
  const pendientes = [entrada];
  while (pendientes.length > 0) {
    const archivo = pendientes.pop()!;
    if (vistos.has(archivo) || !existsSync(archivo)) continue;
    vistos.add(archivo);
    if (archivo === objetivo) return true;
    const fuente = readFileSync(archivo, "utf8");
    for (const m of fuente.matchAll(/from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      const destino = archivoImportado(archivo, m[1] ?? m[2]!);
      if (destino !== undefined) pendientes.push(destino);
    }
  }
  return false;
}

/**
 * Las invocaciones que cargan `descriptor/sistemas.ts`, tal como se escriben en un flujo.
 *
 * Son los guiones de `package.json` que lo alcanzan —hoy `manifiestos`, `secretos` y
 * `capacidad`— mas `pulumi`, porque `index.ts` tambien lo alcanza y quien corre el
 * programa es el CLI o `pulumi/actions`.
 *
 * `verificar` entra por su cuenta y no por el grafo: no ejecuta ningun `vite-node`, pero
 * su `typecheck` compila el proyecto entero —`descriptor/sistemas.ts` incluido— y sus
 * pruebas leen ademas los cuatro `crear-roles.sql` y los seis `.github/workflows`.
 */
export function herramientasQueLosNecesitan(raizDeInfra: string): string[] {
  const objetivo = resolve(raizDeInfra, "descriptor", "sistemas.ts");
  const paquete = JSON.parse(readFileSync(join(raizDeInfra, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };

  const herramientas = ["verificar", "pulumi"];
  for (const [nombre, orden] of Object.entries(paquete.scripts)) {
    const m = /vite-node\s+(\S+\.ts)/.exec(orden);
    if (m === null) continue;
    if (alcanza(resolve(raizDeInfra, m[1]!), objetivo)) herramientas.push(nombre);
  }
  if (alcanza(resolve(raizDeInfra, "index.ts"), objetivo) && !herramientas.includes("pulumi")) {
    herramientas.push("pulumi");
  }
  return herramientas.sort();
}

/** Los `*.sh` del repositorio, con su ruta relativa a la raiz del clon. */
function guionesDe(raiz: string): string[] {
  const encontrados: string[] = [];
  const recorrer = (carpeta: string): void => {
    for (const entrada of readdirSync(carpeta, { withFileTypes: true })) {
      if (entrada.name === "node_modules" || entrada.name.startsWith(".")) continue;
      const ruta = join(carpeta, entrada.name);
      if (entrada.isDirectory()) recorrer(ruta);
      else if (entrada.name.endsWith(".sh")) encontrados.push(relative(raiz, ruta));
    }
  };
  for (const carpeta of ["infra", "despliegue"]) {
    const ruta = join(raiz, carpeta);
    if (existsSync(ruta)) recorrer(ruta);
  }
  return encontrados.sort();
}

/**
 * Un guion sin lo que solo HABLA de las herramientas: comentarios y mensajes.
 *
 * Hizo falta medirlo: sin esto, la deteccion marcaba **seis** guiones de mas y los seis
 * por lo mismo. `comprobar-lo-asignable.sh` y `reservar-recursos-del-nodo.sh` explican en
 * su cabecera que existen para que `pulumi up` no se cuelgue; `verificar-el-ambiente.sh`
 * dice «eso es `yarn verificar`, y corre sin clúster»; `puerto.sh` dice que la biblioteca
 * entera «exige una corrida de `yarn manifiestos`». Ninguno invoca nada. Y `echo`/`printf`
 * hacen lo mismo en voz alta: `probar-localmente.sh` termina con «pulumi preview/up ... ya
 * puede correr».
 *
 * El error iba en la direccion segura —pedir clones de mas nunca deja pasar un trabajo
 * roto—, y aun asi se corrige: una guarda que senala seis cosas que no son deja de leerse,
 * que es lo que #437 midio al descartar ensanchar el patron de la regla 5.
 */
export function loQueEjecuta(fuente: string): string {
  return fuente
    .split("\n")
    .filter((linea) => {
      const limpia = linea.trimStart();
      return !limpia.startsWith("#") && !/^(echo|printf)\b/.test(limpia);
    })
    .join("\n");
}

/**
 * Los guiones del repositorio que acaban cargando `descriptor/sistemas.ts`.
 *
 * Directamente, o **por `source` de otro que si** — que es lo que hace falta para ver a
 * `verificar-el-motor.sh` y a `simulacro-de-restauracion.sh`: ninguno de los dos nombra
 * `yarn manifiestos`, y los dos cargan `lib-motor-local.sh`, que lo invoca en su linea 56.
 */
export function guionesQueLosNecesitan(raiz: string, herramientas: readonly string[]): string[] {
  const guiones = guionesDe(raiz);
  const fuentes = new Map(guiones.map((g) => [g, loQueEjecuta(readFileSync(join(raiz, g), "utf8"))]));
  const invoca = new RegExp(
    `yarn\\s+(?:--silent\\s+)?(?:${herramientas.filter((h) => h !== "pulumi").join("|")})\\b` +
      "|\\bpulumi\\s+(?:preview|up)\\b",
  );

  const necesitan = new Set(guiones.filter((g) => invoca.test(fuentes.get(g)!)));
  for (;;) {
    const antes = necesitan.size;
    for (const guion of guiones) {
      if (necesitan.has(guion)) continue;
      const fuente = fuentes.get(guion)!;
      const cargaOtro = [...necesitan].some((otro) => {
        const nombre = otro.slice(otro.lastIndexOf("/") + 1);
        return new RegExp(`source\\s+\\S*${nombre.replace(/\./g, "\\.")}`).test(fuente);
      });
      if (cargaOtro) necesitan.add(guion);
    }
    if (necesitan.size === antes) break;
  }
  return [...necesitan].sort();
}

/**
 * El texto de todo lo que un trabajo EJECUTA: sus `run`, sus `uses` y sus `with`.
 *
 * Pasa por {@link loQueEjecuta} por lo mismo que los guiones: un bloque `run: |` lleva
 * comentarios y `echo` dentro, y los resumenes de `previsualizar-*` imprimen literalmente
 * «`yarn verificar` — invariantes de `config.ts`». Nombrar una herramienta no es
 * invocarla.
 */
function textoDelTrabajo(trabajo: unknown): string {
  const partes: string[] = [];
  const recorrer = (valor: unknown): void => {
    if (typeof valor === "string") partes.push(valor);
    else if (Array.isArray(valor)) valor.forEach(recorrer);
    else if (valor !== null && typeof valor === "object") Object.values(valor).forEach(recorrer);
  };
  recorrer(trabajo);
  return loQueEjecuta(partes.join("\n"));
}

interface Paso {
  uses?: string;
  with?: Record<string, unknown>;
}

/** Si ese trabajo clona el anfitrion en `path: infrastructure`. */
function anfitrionEnSuSitio(pasos: readonly Paso[]): boolean {
  return pasos.some(
    (paso) =>
      (paso.uses ?? "").startsWith("actions/checkout") &&
      paso.with?.["repository"] === undefined &&
      paso.with?.["path"] === "infrastructure",
  );
}

/**
 * Los trabajos de un flujo que necesitan los hermanos y no los clonan.
 *
 * `fuente` se analiza como YAML a proposito: los comentarios nombran `yarn capacidad` y
 * `yarn manifiestos` en sitios donde no se invocan, y contarlos daria hallazgos falsos.
 */
export function trabajosSinSusHermanos(
  fuente: string,
  archivo: string,
  herramientas: readonly string[],
  guiones: readonly string[],
): TrabajoSinSusHermanos[] {
  const flujo = load(fuente) as { jobs?: Record<string, { steps?: Paso[] }> };
  const hallazgos: TrabajoSinSusHermanos[] = [];

  for (const [nombre, trabajo] of Object.entries(flujo.jobs ?? {})) {
    const pasos = trabajo.steps ?? [];
    const texto = textoDelTrabajo(trabajo);

    const porGuion = guiones.find((guion) => {
      const base = guion.slice(guion.lastIndexOf("/") + 1);
      return texto.includes(guion) || new RegExp(`(^|[\\s/"'])${base}\\b`).test(texto);
    });
    const porHerramienta = herramientas.find((h) =>
      h === "pulumi"
        ? /\bpulumi\b/.test(texto) || pasos.some((p) => (p.uses ?? "").startsWith("pulumi/actions"))
        : new RegExp(`yarn\\s+(?:--silent\\s+)?${h}\\b`).test(texto),
    );
    const porque = porGuion ?? porHerramienta;
    if (porque === undefined) continue;

    const usaLaAccion = pasos.some((paso) => (paso.uses ?? "").endsWith(ACCION));
    if (!usaLaAccion) {
      hallazgos.push({
        archivo,
        trabajo: nombre,
        porque,
        falta: `no usa \`./infrastructure/${ACCION}\``,
      });
    } else if (!anfitrionEnSuSitio(pasos)) {
      hallazgos.push({
        archivo,
        trabajo: nombre,
        porque,
        falta:
          "usa la accion pero no clona ESTE repositorio en `path: infrastructure`, " +
          "asi que ni la accion se puede referenciar ni los hermanos caben al lado",
      });
    }
  }
  return hallazgos;
}

/** Los trabajos sin sus hermanos, en todos los flujos de este clon. */
export function trabajosSinSusHermanosEn(raiz: string, raizDeInfra: string): TrabajoSinSusHermanos[] {
  const herramientas = herramientasQueLosNecesitan(raizDeInfra);
  const guiones = guionesQueLosNecesitan(raiz, herramientas);
  const carpeta = join(raiz, ".github", "workflows");
  return readdirSync(carpeta)
    .filter((nombre) => nombre.endsWith(".yml") || nombre.endsWith(".yaml"))
    .sort()
    .flatMap((nombre) =>
      trabajosSinSusHermanos(
        readFileSync(join(carpeta, nombre), "utf8"),
        `.github/workflows/${nombre}`,
        herramientas,
        guiones,
      ),
    );
}
