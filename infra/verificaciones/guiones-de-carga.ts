import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { raizDelRepositorio } from "../componentes/fuentes";
import type { Environment } from "../config";
import type { Deployment } from "../componentes/tipos";
import { namespaceDelSistema } from "../descriptor/entorno";
import { manifiestosDelAmbiente } from "../herramientas/emitir-manifiestos";
import { SISTEMAS, clonDe, sistemaLlamado } from "./deriva-de-migraciones";
import { invariantesDe } from "./stacks";

/**
 * De DONDE saca su imagen un guion de carga, y en QUE espacio de nombres crea su Job (#10, #11).
 *
 * ## El defecto, medido y no supuesto
 *
 * Los guiones de `infra/carga-de-datos/` de los cinco repositorios llevaban las mismas dos
 * lineas, copiadas:
 *
 *     NAMESPACE=${NAMESPACE:-kamayuk-$AMBIENTE}
 *     IMAGEN=$(kubectl -n "$NAMESPACE" get deployment "kamayuk-${AMBIENTE}-aplicacion" ...)
 *
 * y las dos nombran la topologia ANTERIOR al corte. Medido sobre `yarn manifiestos` el
 * 2026-09-07, en los dos ambientes: **ningun manifiesto emite un `kamayuk-<ambiente>-aplicacion`**
 * —era el Deployment del monolito, que C-19 retiro de `stg` y `E` de `prod`—, y lo que hay es un
 * `kamayuk-<sistema>-web` por sistema, en `kamayuk-<sistema>-<ambiente>` (ADR-0031).
 *
 * Lo caro no es que falle: es que el guion pide una imagen y compone un `Job` con ella. Si
 * resolviera la de otro sistema, el contenedor **arranca, no atiende la propiedad de carga, no
 * escribe ni una fila y sale con codigo 0** — es el hallazgo de C-6 con `cargar-transferencias-
 * demo.sh`, cuyo sintoma fue la ausencia de sintoma.
 *
 * ## Que compara, y por que las DOS fuentes son reales
 *
 * Ni la lista de guiones ni la de Deployments se escriben aqui:
 *
 *   - los guiones se recorren del disco, en este clon y en los de los cuatro hermanos
 *     ({@link clonDe}, el mismo mecanismo de C-9a y C-20). Un guion nuevo entra solo;
 *   - los Deployments salen de {@link manifiestosDelAmbiente}, que es lo que el ambiente
 *     despliega de verdad.
 *
 * Escribir aqui el nombre bueno seria el tercer sitio con la misma verdad, y ademas el fosil que
 * C-17 §1, C-18 §5 y R-A/B se cobraron tres veces: una guarda escrita sobre el nombre de hoy
 * exige el nombre de hoy, y el dia que cambie exigira el equivocado.
 *
 * ## Lo que un guion puede pedir, y lo que no
 *
 * Dos formas, las dos comprobables contra el manifiesto:
 *
 *   1. **por nombre** —`get deployment "kamayuk-normativa-web"`—: ese Deployment tiene que
 *      existir en el espacio de nombres que el guion nombra;
 *   2. **por etiquetas** —`get deployment -l "sistema=normativa,perfil=web"`—: esas etiquetas
 *      tienen que seleccionar **exactamente uno**. Con cero la variable queda vacia; con dos, el
 *      guion elige en silencio.
 *
 * Y lo que quede sin resolver **no pasa**: {@link expandir} solo conoce las sustituciones que
 * este archivo declara, y un `$` que sobreviva sale como desajuste. Un guion que compusiera su
 * destino de una forma que esta guarda no entiende se estaria midiendo solo.
 */

/** Lo que un guion de carga le pide al cluster, tal como esta escrito (sin expandir). */
export interface PeticionDeUnGuion {
  /** `<clon>/infra/carga-de-datos/<guion>.sh`, para que el rojo diga donde mirar. */
  readonly archivo: string;
  /** Su ruta absoluta en el disco: el clon puede ser este o uno hermano. */
  readonly ruta: string;
  /** El sistema de cuyo repositorio es. */
  readonly sistema: string;
  /** La linea del `NAMESPACE=${NAMESPACE:-...}`. */
  readonly lineaDelNamespace: number;
  /** La expresion del espacio de nombres por omision, sin expandir. */
  readonly namespace: string;
  /** La linea del `get deployment`. */
  readonly lineaDelDeployment: number;
  /** El nombre pedido, sin expandir. Excluyente con {@link selector}. */
  readonly deployment?: string;
  /** El selector de etiquetas pedido, sin expandir. Excluyente con {@link deployment}. */
  readonly selector?: string;
}

/** Un guion que le pide al cluster algo que el manifiesto no emite. */
export interface DesajusteDeUnGuion {
  readonly archivo: string;
  readonly linea: number;
  readonly problema: string;
}

/**
 * Los guiones pendientes, con el issue que los cierra. **Es la lista de trabajo, no una puerta.**
 *
 * `#10` los encontro en los cinco repositorios a la vez y sus PR son uno por repositorio (su
 * AC-9): mientras los otros cuatro no aterricen, esta guarda tiene que poder correr en verde sin
 * dejar de decir cuales faltan. Lo que impide que se convierta en una excepcion permanente es que
 * se comprueba **en las dos direcciones**: una entrada que ya no tenga desajuste sale roja
 * nombrandola, igual que `busquedasDeTextoLibreConMotivo()` de `rentas` y `EJEMPLOS_QUE_NO_SIEMBRAN`
 * de la siembra.
 *
 * El censo que #10 daba —nueve guiones, todos de `catastro`— resulto corto al medirlo: son
 * **catorce en tres repositorios**, y `normativa` no tiene `infra/carga-de-datos/` en absoluto.
 */
export const GUIONES_PENDIENTES: Readonly<Record<string, string>> = {
  "catastro/infra/carga-de-datos/cargar-arancel-vial.sh": "hneyra/infrastructure#10",
  "catastro/infra/carga-de-datos/cargar-catalogo-vial.sh": "hneyra/infrastructure#10",
  "catastro/infra/carga-de-datos/cargar-detalle-fichas-demo.sh": "hneyra/infrastructure#10",
  "catastro/infra/carga-de-datos/cargar-fichas-demo.sh": "hneyra/infrastructure#10",
  "catastro/infra/carga-de-datos/cargar-manzanas.sh": "hneyra/infrastructure#10",
  "catastro/infra/carga-de-datos/cargar-predios.sh": "hneyra/infrastructure#10",
  "catastro/infra/carga-de-datos/cargar-riesgo.sh": "hneyra/infrastructure#10",
  "catastro/infra/carga-de-datos/cargar-sectores.sh": "hneyra/infrastructure#10",
  "catastro/infra/carga-de-datos/cargar-zonificacion.sh": "hneyra/infrastructure#10",
  "rentas/infra/carga-de-datos/cargar-contribuyentes-demo.sh": "hneyra/infrastructure#10",
  "rentas/infra/carga-de-datos/cargar-deuda-demo.sh": "hneyra/infrastructure#10",
  "rentas/infra/carga-de-datos/cargar-transferencias-demo.sh": "hneyra/infrastructure#10",
  "rentas/infra/carga-de-datos/cargar-vehiculos-demo.sh": "hneyra/infrastructure#10",
  "caja/infra/carga-de-datos/cargar-cajas.sh": "hneyra/infrastructure#10",
};

/** Donde vive el directorio de guiones de carga, en cualquiera de los cinco clones. */
const DIRECTORIO = join("infra", "carga-de-datos");

/**
 * Los guiones de carga de un clon: los `*.sh` de `infra/carga-de-datos/` que componen un `Job`.
 *
 * Lo de «que componen un `Job`» no es cosmetico: `lib-destino-del-job.sh` es una biblioteca y no
 * pide nada al cluster por su cuenta, asi que exigirle un destino seria gritar en lo correcto.
 */
export function guionesDeCarga(raiz: string, sistema: string, clon: string): PeticionDeUnGuion[] {
  const carpeta = join(raiz, DIRECTORIO);
  if (!existsSync(carpeta)) return [];
  const guiones: PeticionDeUnGuion[] = [];
  for (const entrada of readdirSync(carpeta, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!entrada.isFile() || !entrada.name.endsWith(".sh")) continue;
    const fuente = readFileSync(join(carpeta, entrada.name), "utf8");
    if (!/kind:\s*Job\b/.test(fuente)) continue;
    guiones.push(
      peticionDe(
        `${clon}/${DIRECTORIO}/${entrada.name}`,
        join(carpeta, entrada.name),
        sistema,
        fuente,
        carpeta,
      ),
    );
  }
  return guiones;
}

/** Todos los de los cinco clones: el propio y los cuatro hermanos. */
export function todosLosGuionesDeCarga(): PeticionDeUnGuion[] {
  const propios = guionesDeCarga(raizDelRepositorio(), SISTEMA_DE_ESTE_CLON, "infrastructure");
  const ajenos = SISTEMAS.flatMap((sistema) =>
    guionesDeCarga(clonDe(sistemaLlamado(sistema.nombre)), sistema.nombre, sistema.clon),
  );
  return [...propios, ...ajenos];
}

/**
 * A que sistema pertenecen los guiones que viven en ESTE repositorio.
 *
 * `infrastructure` no es un sistema y no tiene namespace propio; sus tres guiones publican
 * valores normativos, que desde ADR-0025 son de `normativa`. Se declara aqui —una vez— porque un
 * guion de carga siempre corre contra el backend de UN sistema, y sin decir cual no hay nada que
 * comparar.
 */
export const SISTEMA_DE_ESTE_CLON = "normativa";

/**
 * El selector que la biblioteca de este directorio usa, leido de ella y no copiado.
 *
 * Un guion que delega en `imagen_del_backend` no escribe ningun `get deployment`: lo escribe
 * `lib-destino-del-job.sh` una sola vez, que es el punto de #10 AC-2. La guarda sigue la
 * indireccion hasta el archivo de verdad en vez de darla por buena, porque lo que hay que
 * comparar contra el manifiesto es lo que se le pide al cluster, no quien lo pide.
 */
function selectorDeLaBiblioteca(carpeta: string, archivo: string): string {
  const biblioteca = join(carpeta, "lib-destino-del-job.sh");
  if (!existsSync(biblioteca)) {
    throw new Error(
      `«${archivo}» delega en «imagen_del_backend» y no hay «lib-destino-del-job.sh» al lado, ` +
        "asi que no se puede saber que le pide al cluster.",
    );
  }
  const m = /^\s*local selector="([^"]+)"\s*$/m.exec(readFileSync(biblioteca, "utf8"));
  if (m === null) {
    throw new Error(
      `«${biblioteca}» no declara ningun \`local selector="..."\`, asi que esta guarda no ` +
        "sabe que Deployment piden los guiones que delegan en ella. NO se salta.",
    );
  }
  return m[1]!;
}

function peticionDe(
  archivo: string,
  ruta: string,
  sistema: string,
  fuente: string,
  carpeta: string,
): PeticionDeUnGuion {
  const lineas = fuente.split("\n");
  const buscar = (patron: RegExp): { linea: number; m: RegExpExecArray } => {
    for (let i = 0; i < lineas.length; i++) {
      const m = patron.exec(lineas[i]!);
      if (m !== null) return { linea: i + 1, m };
    }
    throw new Error(
      `«${archivo}» compone un Job y no se le pudo leer ${patron}. Esta guarda NO se salta: un ` +
        "guion cuyo destino no se puede leer no se estaria comparando con nada, y pasaria en " +
        "verde con el defecto exacto que existe para atrapar.",
    );
  };

  const ns = buscar(/^NAMESPACE=\$\{NAMESPACE:-(.+)\}\s*$/);
  if (/imagen_del_backend/.test(fuente)) {
    const dep = buscar(/imagen_del_backend/);
    return {
      archivo,
      ruta,
      sistema,
      lineaDelNamespace: ns.linea,
      namespace: ns.m[1]!,
      lineaDelDeployment: dep.linea,
      selector: selectorDeLaBiblioteca(carpeta, archivo),
    };
  }
  const dep = buscar(/get deployment (?:-l "([^"]+)"|"([^"]+)")/);
  return {
    archivo,
    ruta,
    sistema,
    lineaDelNamespace: ns.linea,
    namespace: ns.m[1]!,
    lineaDelDeployment: dep.linea,
    ...(dep.m[1] === undefined ? { deployment: dep.m[2]! } : { selector: dep.m[1] }),
  };
}

/**
 * Las sustituciones que esta guarda sabe hacer, y ninguna mas.
 *
 * Lo que quede con un `$` dentro se informa como desajuste en vez de darse por bueno: es la
 * diferencia entre «no lo entiendo» y «esta bien», que es lo que C-15/C-16 midieron.
 */
function expandir(expresion: string, ambiente: Environment, sistema: string): string {
  return expresion
    .replace(
      /\$\(namespace_del_sistema "\$SISTEMA" "\$AMBIENTE"\)/g,
      namespaceDelSistema(ambiente, sistema),
    )
    .replace(/\$\{?AMBIENTE\}?/g, ambiente)
    .replace(/\$\{?SISTEMA\}?/g, sistema)
    // La variable local con que `imagen_del_backend` recibe el sistema. Se declara aqui porque
    // el selector se lee de la biblioteca tal como esta escrito, sin ejecutarla.
    .replace(/\$\{?sistema\}?/g, sistema);
}

/** Los guiones que le piden al cluster algo que ese ambiente no emite. */
export function desajustesDeLosGuiones(
  ambiente: Environment,
  guiones: readonly PeticionDeUnGuion[],
): DesajusteDeUnGuion[] {
  const manifiestos = manifiestosDelAmbiente(invariantesDe(ambiente));
  const deployments = manifiestos.filter((m): m is Deployment => m.kind === "Deployment");
  if (deployments.length === 0) {
    throw new Error(
      `«${ambiente}» no emite ni un Deployment, asi que no hay contra que comparar. Esta guarda ` +
        "NO pasa en verde sobre el vacio.",
    );
  }
  if (guiones.length === 0) {
    throw new Error(
      "No se encontro ni un guion de carga en los cinco clones, asi que esta guarda NO MIDIO " +
        "NADA. Un censo vacio no es un censo en el que todo estuviera bien.",
    );
  }

  const desajustes: DesajusteDeUnGuion[] = [];
  for (const guion of guiones) {
    const namespace = expandir(guion.namespace, ambiente, guion.sistema);
    if (namespace.includes("$")) {
      desajustes.push({
        archivo: guion.archivo,
        linea: guion.lineaDelNamespace,
        problema:
          `el espacio de nombres «${guion.namespace}» no se puede resolver con lo que esta ` +
          "guarda sabe sustituir, asi que no se compara con nada",
      });
      continue;
    }

    const enElNamespace = deployments.filter((d) => d.metadata?.namespace === namespace);
    if (enElNamespace.length === 0) {
      desajustes.push({
        archivo: guion.archivo,
        linea: guion.lineaDelNamespace,
        problema:
          `crea su Job en «${namespace}», y «${ambiente}» no despliega ahi ni un Deployment. ` +
          `Los espacios de nombres con backend son: ` +
          `${[...new Set(deployments.map((d) => d.metadata?.namespace))].sort().join(", ")}`,
      });
      continue;
    }

    if (guion.deployment !== undefined) {
      const pedido = expandir(guion.deployment, ambiente, guion.sistema);
      if (pedido.includes("$")) {
        desajustes.push({
          archivo: guion.archivo,
          linea: guion.lineaDelDeployment,
          problema: `pide el Deployment «${guion.deployment}», que no se puede resolver`,
        });
      } else if (!enElNamespace.some((d) => d.metadata?.name === pedido)) {
        desajustes.push({
          archivo: guion.archivo,
          linea: guion.lineaDelDeployment,
          problema:
            `saca la imagen de su Job del Deployment «${pedido}», y «${ambiente}» no emite ` +
            `ninguno con ese nombre en «${namespace}». Ahi emite: ` +
            `${enElNamespace.map((d) => d.metadata?.name).sort().join(", ")}`,
        });
      }
      continue;
    }

    const selector = expandir(guion.selector!, ambiente, guion.sistema);
    if (selector.includes("$")) {
      desajustes.push({
        archivo: guion.archivo,
        linea: guion.lineaDelDeployment,
        problema: `pide las etiquetas «${guion.selector!}», que no se pueden resolver`,
      });
      continue;
    }
    const etiquetas = selector.split(",").map((p) => {
      const [clave, valor] = p.split("=");
      return [clave!.trim(), (valor ?? "").trim()] as const;
    });
    const casan = enElNamespace.filter((d) =>
      etiquetas.every(([clave, valor]) => d.metadata?.labels?.[clave] === valor),
    );
    if (casan.length !== 1) {
      desajustes.push({
        archivo: guion.archivo,
        linea: guion.lineaDelDeployment,
        problema:
          `saca la imagen de su Job de las etiquetas «${selector}», y en «${namespace}» casan ` +
          `${casan.length} Deployments y no uno. Con cero la imagen queda vacia; con dos, el ` +
          `guion elige en silencio. Los que hay: ` +
          `${enElNamespace.map((d) => d.metadata?.name).sort().join(", ")}`,
      });
    }
  }
  return desajustes;
}

/** Los ambientes que este repositorio declara, leidos de sus `Pulumi.<ambiente>.yaml`. */
export function ambientesDeclarados(): Environment[] {
  const raiz = join(raizDelRepositorio(), "infra");
  const ambientes = readdirSync(raiz)
    .map((n) => /^Pulumi\.([a-z]+)\.yaml$/.exec(n)?.[1])
    .filter((a): a is string => a !== undefined)
    .sort() as Environment[];
  if (ambientes.length === 0) {
    throw new Error(
      "No se encontro ningun «Pulumi.<ambiente>.yaml»: sin ambientes esta guarda no mide nada.",
    );
  }
  return ambientes;
}
