import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { load } from "js-yaml";
import { raizDelRepositorio } from "../componentes/fuentes";
import type { Environment } from "../config";
import { manifiestosDelAmbiente } from "../herramientas/emitir-manifiestos";
import { invariantesDe } from "./stacks";

/**
 * Quien publica cada imagen que el manifiesto pide, y el hueco que esto cierra.
 *
 * ## El defecto, medido
 *
 * Hasta el 2026-09-05 **ninguno de los cinco repositorios publicaba una imagen de los cuatro
 * sistemas**: `publicar-imagenes.yml` se quedo en `sgtm`, el archivo historico, y lo que los cinco
 * tienen se llama `registro.yml` y es la guarda de #711. Y sin embargo `yarn manifiestos` pedia
 * ocho referencias `ghcr.io/hneyra/kamayuk-*`, todas etiquetadas con `applicationBootstrapVersion`
 * —un `sha` de `sgtm`—. Preguntado al registro con un token emitido por `https://ghcr.io/token`:
 *
 *     GET /v2/hneyra/kamayuk-rentas/manifests/c755de21…      -> 404 MANIFEST_UNKNOWN
 *     …y lo mismo las otras siete.
 *
 * Lo caro de ese estado no es que faltaran: es que **nada lo medía**. El manifiesto es valido, el
 * API de Kubernetes lo admite, `capacidad.ts` dice que cabe y el planificador ubica el pod. El
 * fallo aparece como `ImagePullBackOff` cuando el `pulumi up` ya se ejecuto.
 *
 * ## Las dos mitades, y por que hacen falta las dos
 *
 * «Esa etiqueta existe» solo lo puede contestar el registro, y preguntarselo necesita red y una
 * credencial con `read:packages` — un PAT de escritorio normal recibe `403 DENIED`, que no se
 * distingue de «no existe» si uno no lo mira. Esa mitad vive en
 * `verificaciones/imagenes/comprobar-imagenes.sh` y la corre CI.
 *
 * Esta mitad es la que **si** se puede ejecutar en cualquier maquina y en cada PR, y contesta la
 * otra pregunta, que es la que estaba abierta: **¿hay alguien que publique esa imagen?** Se
 * responde leyendo los flujos de los clones hermanos y componiendo el inventario de lo que de
 * verdad se publica — derivado, no declarado. Una lista escrita a mano de «imagenes que existen»
 * seria justamente el segundo sitio donde olvidarse, que es el defecto que esto cierra.
 *
 * ## Lo que NO comprueba, dicho en vez de descubierto
 *
 *   - Que la etiqueta concreta este subida. Un flujo puede existir y su ultima corrida haber
 *     fallado. Eso lo dice el registro, y por eso la otra mitad no sobra.
 *   - Que el flujo se haya llegado a disparar para ESE `sha`. Los cuatro flujos del corte no
 *     filtran por `paths` precisamente para que la respuesta sea siempre «si» —todo commit de
 *     `main` tiene sus dos imagenes—, pero el del monolito si filtra, y por eso aqui no se
 *     afirma nada de eso.
 */

/** Una referencia de imagen que un manifiesto pide, ya descompuesta. */
export interface ImagenPedida {
  /** La referencia entera, tal como aparece en el manifiesto. */
  referencia: string;
  /** El nombre publicado, sin registro ni etiqueta: `kamayuk-rentas`. */
  nombre: string;
  /** La etiqueta: un `sha`, o `prod-<sha>` en la interfaz del monolito. */
  etiqueta: string;
}

/** Donde se publica: el registro del producto. Lo demas —`postgis`, `grafana`— no es nuestro. */
export const REGISTRO_PROPIO = "ghcr.io/hneyra/";

/** Los clones hermanos que pueden publicar algo, incluido el archivo historico. */
export const CLONES = ["rentas", "catastro", "normativa", "caja", "sgtm"] as const;

/**
 * Las imagenes DEL PRODUCTO que un ambiente pide, sin repetir.
 *
 * Se leen de los manifiestos y no de una lista, por lo mismo que `sistemasDesplegados` de
 * `deriva-de-migraciones.ts`: lo que decide que imagen baja el nodo es el campo `image` de un
 * contenedor, y cualquier otra fuente es una copia que se puede separar.
 */
export function imagenesPedidas(ambiente: Environment): ImagenPedida[] {
  const encontradas = new Map<string, ImagenPedida>();

  const recorrer = (valor: unknown): void => {
    if (Array.isArray(valor)) {
      valor.forEach(recorrer);
      return;
    }
    if (valor === null || typeof valor !== "object") return;
    for (const [clave, dentro] of Object.entries(valor as Record<string, unknown>)) {
      if (clave === "image" && typeof dentro === "string" && dentro.startsWith(REGISTRO_PROPIO)) {
        const sinRegistro = dentro.slice(REGISTRO_PROPIO.length);
        const corte = sinRegistro.lastIndexOf(":");
        if (corte > 0) {
          encontradas.set(dentro, {
            referencia: dentro,
            nombre: sinRegistro.slice(0, corte),
            etiqueta: sinRegistro.slice(corte + 1),
          });
        }
      }
      recorrer(dentro);
    }
  };

  recorrer(manifiestosDelAmbiente(invariantesDe(ambiente)) as unknown);
  return [...encontradas.values()].sort((a, b) => a.referencia.localeCompare(b.referencia));
}

/** Un flujo que publica imagenes: de que repositorio es y cuales publica. */
export interface Publicador {
  clon: string;
  flujo: string;
  imagenes: string[];
}

/**
 * Las imagenes que un flujo publica, expandiendo su matriz.
 *
 * Se analiza el YAML en vez de buscar el nombre con `grep`, y no por elegancia: los cuatro flujos
 * del corte nombran sus dos imagenes **en la matriz** y las usan como `${{ matrix.imagen }}`, asi
 * que un `grep` del nombre daria positivo tambien si ese valor estuviera en un comentario o en un
 * paso que no empuja nada — que es como una guarda deja de mirar sin decirlo.
 *
 * Solo cuentan los pasos con `push: true`: construir una imagen y no subirla no la publica.
 */
export function imagenesQuePublica(textoDelFlujo: string): string[] {
  const flujo = load(textoDelFlujo) as
    | { jobs?: Record<string, { strategy?: { matrix?: { include?: Record<string, string>[] } }; steps?: unknown[] }> }
    | undefined;
  const nombres = new Set<string>();

  for (const trabajo of Object.values(flujo?.jobs ?? {})) {
    const combinaciones = trabajo.strategy?.matrix?.include ?? [{}];
    for (const paso of trabajo.steps ?? []) {
      const p = paso as { uses?: string; with?: Record<string, unknown> };
      if (typeof p.uses !== "string" || !p.uses.startsWith("docker/build-push-action")) continue;
      if (p.with?.["push"] !== true) continue;
      const etiquetas = p.with?.["tags"];
      if (typeof etiquetas !== "string") continue;

      for (const combinacion of combinaciones) {
        let texto = etiquetas;
        for (const [clave, valor] of Object.entries(combinacion)) {
          texto = texto.replaceAll(new RegExp(`\\$\\{\\{\\s*matrix\\.${clave}\\s*\\}\\}`, "g"), valor);
        }
        for (const linea of texto.split("\n")) {
          const casa = /\/([a-z0-9][a-z0-9._-]*):/.exec(linea.trim());
          if (casa?.[1] !== undefined) nombres.add(casa[1]);
        }
      }
    }
  }

  return [...nombres].sort();
}

/** La raiz de un clon hermano. Cadena vacia si no esta. */
function raizDelClon(clon: string): string {
  const raiz = resolve(raizDelRepositorio(), "..", clon);
  return existsSync(join(raiz, ".git")) ? raiz : "";
}

/**
 * El inventario de lo que los clones hermanos publican de verdad.
 *
 * Un clon que falte **no se salta**: se devuelve como un problema. Replegarse a «no se puede
 * mirar, pasa en verde» es exactamente lo que #675 encontro y lo que dejo ocho meses de deriva
 * sin que nadie la viera.
 */
export function publicadores(): { hallados: Publicador[]; sinClon: string[] } {
  const hallados: Publicador[] = [];
  const sinClon: string[] = [];

  for (const clon of CLONES) {
    const raiz = raizDelClon(clon);
    if (raiz === "") {
      sinClon.push(clon);
      continue;
    }
    const directorio = join(raiz, ".github", "workflows");
    if (!existsSync(directorio)) continue;
    for (const archivo of readdirSync(directorio).filter((n) => n.endsWith(".yml"))) {
      const imagenes = imagenesQuePublica(readFileSync(join(directorio, archivo), "utf8"));
      if (imagenes.length > 0) hallados.push({ clon, flujo: archivo, imagenes });
    }
  }

  return { hallados, sinClon };
}

/**
 * Las imagenes que el ambiente pide y **nadie publica**, con su diagnostico.
 *
 * Cadena vacia por imagen que si tiene publicador. La lista vacia es lo que hay que ver.
 */
export function loQueNadiePublica(
  ambiente: Environment,
  pedidas: readonly ImagenPedida[] = imagenesPedidas(ambiente),
  inventario: ReturnType<typeof publicadores> = publicadores(),
): string[] {
  const problemas: string[] = [];

  if (inventario.sinClon.length > 0) {
    problemas.push(
      `No estan los clones de ${inventario.sinClon.join(", ")}, asi que no se puede saber quien ` +
        "publica las imagenes que este ambiente pide.\n" +
        "  Remedio: clonarlos como hermanos de este repositorio " +
        `(git clone https://github.com/hneyra/${inventario.sinClon[0] ?? ""}).\n` +
        "  Esta comprobacion NO se salta: un manifiesto cuyo publicador no se puede mirar es " +
        "exactamente el estado en que estaban las ocho imagenes del corte, y paso inadvertido " +
        "hasta que alguien le pregunto al registro.",
    );
  }

  const quienPublica = new Map<string, Publicador>();
  for (const publicador of inventario.hallados) {
    for (const imagen of publicador.imagenes) quienPublica.set(imagen, publicador);
  }

  for (const imagen of pedidas) {
    if (quienPublica.has(imagen.nombre)) continue;
    problemas.push(
      `El ambiente «${ambiente}» pide «${imagen.referencia}» y NINGUN flujo de los clones ` +
        `hermanos publica «${imagen.nombre}».\n` +
        "  Un `pulumi up` que la pida deja el pod en `ImagePullBackOff`, y nada lo predice: el " +
        "manifiesto es valido, el API de Kubernetes lo admite y el planificador ubica el pod.\n" +
        "  Lo que hay: " +
        (inventario.hallados
          .map((p) => `${p.clon}/${p.flujo} publica ${p.imagenes.join(", ")}`)
          .join("; ") || "(ningun flujo publica ninguna imagen)"),
    );
  }

  return problemas;
}

/** El `sha` de una etiqueta, quitandole el prefijo de ambiente que lleva la interfaz del monolito. */
export function shaDeLaEtiqueta(etiqueta: string): string {
  const casa = /^(?:stg|prod)-([0-9a-f]{40})$/.exec(etiqueta);
  return casa?.[1] ?? etiqueta;
}

/**
 * Las etiquetas que no son un `sha` de cuarenta hexadecimales.
 *
 * Una etiqueta movil —`latest`, `main`— convierte cualquier reinicio del nodo en una
 * actualizacion no planificada, y en un nodo unico eso pasa en cada mantenimiento. Una que no
 * resuelva contra ningun `git log` no permite contestar que corre en la municipalidad.
 */
export function etiquetasQueNoIdentifican(pedidas: readonly ImagenPedida[]): string[] {
  return pedidas
    .filter((imagen) => !/^[0-9a-f]{40}$/.test(shaDeLaEtiqueta(imagen.etiqueta)))
    .map(
      (imagen) =>
        `«${imagen.referencia}» lleva la etiqueta «${imagen.etiqueta}», que no es un \`sha\` de ` +
        "cuarenta caracteres hexadecimales. Una etiqueta que no resuelve contra el `git log` del " +
        "repositorio que construyo la imagen no identifica nada, y si ademas es movil dos " +
        "reconstrucciones del mismo stack dan dos sistemas distintos.",
    );
}

/**
 * Los espacios de nombres cuyos pods tienen credencial para `ghcr.io`, y de donde sale el dato.
 *
 * **No es «los que declaran `imagePullSecrets` en el pod»**, y creerlo daba un falso positivo
 * sobre el monolito: la credencial no vive en ningun `spec`. `index.ts` crea el `Secret`
 * `<amb>-registro-credenciales` y **parchea el `ServiceAccount` `default`** del espacio de nombres
 * de la plataforma, de donde la heredan todos sus pods —ninguno declara `serviceAccountName`—
 * (issue #257).
 *
 * Y ese parche llega a **uno** solo. Desde ADR-0031 cada sistema vive en el suyo, y ahi no hay ni
 * `Secret` ni parche: hoy funciona porque sus paquetes son publicos.
 *
 * Se lee del propio `index.ts` en vez de escribirse aqui, porque esta es justo la clase de
 * exencion que se queda rancia: el dia que alguien replique la credencial en los cuatro espacios,
 * esta funcion tiene que enterarse.
 */
export function espaciosConCredencialDeRegistro(): string[] {
  const fuente = readFileSync(join(raizDelRepositorio(), "infra", "index.ts"), "utf8");
  const patch = /new k8s\.core\.v1\.ServiceAccountPatch\(([\s\S]*?)\n\);/g;
  const espacios: string[] = [];
  for (const [, cuerpo] of fuente.matchAll(patch)) {
    if (cuerpo === undefined) continue;
    if (!cuerpo.includes("imagePullSecrets")) continue;
    // `namespace,` a secas es el de la plataforma: `index.ts` lo tiene en una constante con ese
    // nombre. Cualquier otra forma se devuelve tal cual para que la prueba la nombre en vez de
    // darla por buena.
    const casa = /^\s*namespace(,|:\s*(?<valor>[^,\n]+),)/m.exec(cuerpo);
    espacios.push(casa?.groups?.["valor"]?.trim() ?? "namespace");
  }
  return espacios;
}

/** Un pod que trae una imagen del producto sin credencial propia, y donde vive. */
export interface PodSinCredencial {
  espacio: string;
  donde: string;
  imagenes: string[];
}

/**
 * Las cargas que traen una imagen del producto **fuera** del espacio de nombres de la plataforma
 * y sin `imagePullSecrets` propio: exactamente las que no podrian bajarla si el paquete fuera
 * privado.
 */
export function podsSinCredencial(ambiente: Environment): PodSinCredencial[] {
  const plataforma = `kamayuk-${ambiente}`;
  const salida: PodSinCredencial[] = [];

  for (const m of manifiestosDelAmbiente(invariantesDe(ambiente))) {
    const manifiesto = m as unknown as Record<string, unknown>;
    const meta = manifiesto["metadata"] as { namespace?: string; name?: string } | undefined;
    const espacio = meta?.namespace ?? "";
    if (espacio === plataforma) continue;

    const spec = manifiesto["spec"] as Record<string, unknown> | undefined;
    const plantilla =
      manifiesto["kind"] === "CronJob"
        ? (
            (
              (spec?.["jobTemplate"] as { spec?: { template?: { spec?: unknown } } } | undefined)
                ?.spec ?? {}
            ).template as { spec?: unknown } | undefined
          )?.spec
        : manifiesto["kind"] === "Deployment" ||
            manifiesto["kind"] === "Job" ||
            manifiesto["kind"] === "StatefulSet"
          ? (spec?.["template"] as { spec?: unknown } | undefined)?.spec
          : manifiesto["kind"] === "Pod"
            ? spec
            : undefined;

    const pod = plantilla as
      | {
          imagePullSecrets?: unknown[];
          containers?: { image?: string }[];
          initContainers?: { image?: string }[];
        }
      | undefined;
    if (pod === undefined) continue;
    if ((pod.imagePullSecrets ?? []).length > 0) continue;

    const imagenes = [...(pod.containers ?? []), ...(pod.initContainers ?? [])]
      .map((c) => c.image ?? "")
      .filter((i) => i.startsWith(REGISTRO_PROPIO));
    if (imagenes.length > 0) {
      salida.push({ espacio, donde: `${String(manifiesto["kind"])}/${meta?.name ?? ""}`, imagenes });
    }
  }

  return salida.sort((a, b) => a.donde.localeCompare(b.donde));
}
