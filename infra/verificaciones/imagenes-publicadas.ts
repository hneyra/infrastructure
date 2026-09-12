import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { load } from "js-yaml";
import { raizDelRepositorio } from "../componentes/fuentes";
import { namespacesDelAmbiente } from "../descriptor/entorno";
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
  /** La etiqueta: un `sha` del repositorio que construyo esa imagen. */
  etiqueta: string;
}

/** Donde se publica: el registro del producto. Lo demas —`postgis`, `grafana`— no es nuestro. */
export const REGISTRO_PROPIO = "ghcr.io/hneyra/";

/**
 * Los clones hermanos que pueden publicar algo.
 *
 * Eran cinco con `sgtm`, que publicaba las tres imagenes del monolito. Se fue con
 * el en `E`, y con el la unica razon por la que este repositorio clonaba el archivo historico
 * en CI — `clonar-los-hermanos` ya no lo trae—. Dejarlo aqui pondria rojo el inventario
 * nombrando un clon que nadie pide: `publicadores()` **no se repliega** cuando falta uno, y
 * ese rojo seria por un motivo que no es el que se mide.
 *
 * Y vuelven a ser cinco con `identidad` (ADR-0039), que publica sus dos con el mismo
 * `publicar-imagenes.yml` que los otros cuatro: **sin esta entrada, las dos imagenes que sus dos
 * `Job` y su `Deployment` piden no las publicaria nadie a los ojos de esta guarda**, y el rojo
 * diria la verdad sobre un repositorio que si las publica.
 */
export const CLONES = ["rentas", "catastro", "normativa", "caja", "identidad"] as const;

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
 * Si ese `push:` publica: `true`, o una EXPRESION de GitHub que lo decide al correr.
 *
 * Era `=== true` a secas, y eso dejo de describir la realidad el 2026-09-12: `rentas`#75 cambio
 * el suyo a `push: ${{ github.event_name == 'push' }}` —se construye siempre, se publica solo al
 * integrar, para que el flujo sea ademas una verificacion del PR—. Con la comparacion estricta
 * `rentas` desaparecia ENTERO del inventario de publicadores, y el rojo que salia no decia «el
 * flujo cambio de forma»: decia «el ambiente pide imagenes que nadie publica», acusando a tres
 * que se publican perfectamente.
 *
 * **Lo que esta funcion NO hace, y hay que decirlo: no evalua la expresion.** No puede —ni tiene
 * el evento, ni el contexto— ni falta: la pregunta que esta guarda contesta es «¿hay quien
 * publique esta imagen?», y un paso que la sube al integrar la publica. Lo que sigue sin contar,
 * y es el contraste que impide que esto exima de mas, es un `push: false` literal o un paso sin
 * `push:` — «construir una imagen y no subirla no la publica», que es la frase con la que nacio.
 */
function empuja(valor: unknown): boolean {
  if (valor === true) return true;
  return typeof valor === "string" && /\$\{\{[\s\S]*\}\}/.test(valor);
}

/**
 * Las imagenes que un flujo publica, expandiendo su matriz.
 *
 * Se analiza el YAML en vez de buscar el nombre con `grep`, y no por elegancia: los cuatro flujos
 * del corte nombran sus dos imagenes **en la matriz** y las usan como `${{ matrix.imagen }}`, asi
 * que un `grep` del nombre daria positivo tambien si ese valor estuviera en un comentario o en un
 * paso que no empuja nada — que es como una guarda deja de mirar sin decirlo.
 *
 * Solo cuentan los pasos que empujan de verdad: construir una imagen y no subirla no la
 * publica. Que cuenta como empujar lo decide `empuja`, aqui arriba.
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
      if (!empuja(p.with?.["push"])) continue;
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
 * Deja en blanco los comentarios de un fuente TypeScript y, si se le pide, tambien el contenido
 * de los literales — **sin mover ni un caracter de sitio**.
 *
 * Blanquear y no borrar es deliberado, y aqui se cobra dos veces: las posiciones no cambian, asi
 * que el emparejado de llaves de mas abajo sigue valiendo, un diagnostico que hable de una linea
 * habla de la linea que es, y las **dos** lecturas del mismo archivo —una con literales y otra
 * sin ellos— se pueden recortar por los mismos indices.
 *
 * Hace falta blanquear los comentarios porque el javadoc de `index.ts` **escribe** las cadenas
 * que esta guarda busca —`imagePullSecrets`, `namespacesDelAmbiente`— para explicar el mecanismo:
 * una comprobacion que se satisface con la prosa que la justifica es la que alguien acaba
 * apagando borrando el comentario (#16 con `proxy_pass`, #10 con los rotulos del panel).
 */
export function enBlanco(fuente: string, tambienLosLiterales: boolean): string {
  let salida = "";
  let i = 0;
  const blanco = (texto: string): string => texto.replace(/[^\n]/g, " ");
  while (i < fuente.length) {
    const dos = fuente.slice(i, i + 2);
    if (dos === "//") {
      const fin = fuente.indexOf("\n", i);
      const hasta = fin === -1 ? fuente.length : fin;
      salida += blanco(fuente.slice(i, hasta));
      i = hasta;
    } else if (dos === "/*") {
      const fin = fuente.indexOf("*/", i + 2);
      const hasta = fin === -1 ? fuente.length : fin + 2;
      salida += blanco(fuente.slice(i, hasta));
      i = hasta;
    } else if (fuente[i] === '"' || fuente[i] === "'" || fuente[i] === "`") {
      const comilla = fuente[i]!;
      let j = i + 1;
      while (j < fuente.length && fuente[j] !== comilla) {
        if (fuente[j] === "\\") j += 1;
        j += 1;
      }
      const dentro = fuente.slice(i + 1, j);
      // La comilla de apertura y la de cierre se conservan siempre: son sintaxis, y quitarlas
      // dejaria `resourceName(env, )` sin forma. Lo que se blanquea es el contenido.
      salida += comilla + (tambienLosLiterales ? blanco(dentro) : dentro) + (j < fuente.length ? comilla : "");
      i = j + 1;
    } else {
      salida += fuente[i];
      i += 1;
    }
  }
  return salida;
}

/** Donde empieza y acaba el bloque `{...}` que sigue a `desde`, con sus llaves emparejadas. */
function limitesDelBloque(fuente: string, desde: number): [number, number] | undefined {
  const abre = fuente.indexOf("{", desde);
  if (abre === -1) return undefined;
  let nivel = 0;
  for (let i = abre; i < fuente.length; i += 1) {
    if (fuente[i] === "{") nivel += 1;
    else if (fuente[i] === "}") {
      nivel -= 1;
      if (nivel === 0) return [abre + 1, i];
    }
  }
  return undefined;
}

/**
 * De donde saca `index.ts` los espacios de nombres que reciben la credencial de registro, leido
 * de su fuente. Devuelve el texto de la expresion, tal cual.
 *
 * **Sigue la indireccion hasta la LLAMADA y no se para en la declaracion**, que es la leccion de
 * #10 con `selectorDeLaBiblioteca`: alli la guarda leia el `local selector="..."` declarado y no
 * comprobaba que alguien lo usara, asi que la variable podia quedarse muerta y la comparacion se
 * hacia sola. Aqui se exige que el MISMO bucle cree las dos cosas —el `Secret` de
 * `dockerconfigjson` y el `ServiceAccountPatch` con `imagePullSecrets`— y que las dos pongan
 * `namespace:` a la variable que ese bucle recorre. Un `Secret` que se quedara fuera del bucle
 * deja `imagePullSecrets` apuntando a un `Secret` que en ese espacio de nombres no existe, y el
 * pod no arranca igual.
 *
 * Toma el fuente como argumento en vez de leerlo, para que las muestras de la prueba puedan
 * ejercitar la lectura misma: una guarda que solo se puede probar contra el archivo de verdad no
 * se puede probar contra un archivo defectuoso.
 */
export interface BucleDeLaCredencial {
  /** El texto de la expresion que el bucle recorre, tal cual. */
  expresion: string;
  /** Si en su cuerpo se crea el `Secret` de `kubernetes.io/dockerconfigjson`. */
  secreto: boolean;
  /** Si en su cuerpo se crea el `ServiceAccountPatch` con `imagePullSecrets`. */
  parche: boolean;
  /** A que le pone `namespace:` cada uno de los objetos que crea, en orden. */
  namespaces: string[];
  /** La variable que el bucle recorre. */
  variable: string;
}

/** Los bucles que crean AL MENOS una de las dos mitades de la credencial, con lo que les falta. */
export function buclesDeLaCredencialEn(fuente: string): BucleDeLaCredencial[] {
  // DOS lecturas del mismo archivo, blanqueadas en el sitio, asi que comparten indices. La
  // estructura —el bucle, los dos `new`, el `namespace:`— se busca sin literales, para que una
  // cadena que llevara el bucle entero dentro no cuente. El unico dato que SI vive en un literal
  // es el tipo del `Secret` (`kubernetes.io/dockerconfigjson`), y ese se busca en la otra.
  const limpio = enBlanco(fuente, true);
  const conLiterales = enBlanco(fuente, false);
  const bucles = [...limpio.matchAll(/for\s*\(\s*const\s+(?<variable>[A-Za-z_$][\w$]*)\s+of\s+/g)];

  const hallados: BucleDeLaCredencial[] = [];
  for (const bucle of bucles) {
    const variable = bucle.groups?.["variable"];
    if (variable === undefined) continue;
    // Hasta el `)` que cierra el `for (`, contando parentesis: `namespacesDelAmbiente(env)` lleva
    // uno dentro, y cortar en el primero devolvia media expresion —medido: «namespacesDelAmbiente(env»—.
    const desde = (bucle.index ?? 0) + bucle[0].length;
    let nivel = 1;
    let cierra = desde;
    while (cierra < limpio.length && nivel > 0) {
      if (limpio[cierra] === "(") nivel += 1;
      else if (limpio[cierra] === ")") nivel -= 1;
      if (nivel > 0) cierra += 1;
    }
    if (nivel !== 0) continue;
    const expresion = limpio.slice(desde, cierra).trim();
    const limites = limitesDelBloque(limpio, cierra + 1);
    if (limites === undefined) continue;
    const cuerpo = limpio.slice(limites[0], limites[1]);

    const secreto =
      cuerpo.includes("new k8s.core.v1.Secret(") &&
      conLiterales.slice(limites[0], limites[1]).includes("kubernetes.io/dockerconfigjson");
    const parche =
      cuerpo.includes("new k8s.core.v1.ServiceAccountPatch(") &&
      cuerpo.includes("imagePullSecrets");
    if (!secreto && !parche) continue;

    // Y a que le ponen `namespace:` los objetos que ese bucle crea. Tiene que ser la variable que
    // recorre: mover el `namespace` de uno de ellos a una constante —la de la plataforma, por
    // ejemplo— dejaria el bucle dando vueltas y escribiendo seis veces en el mismo sitio.
    const puestas = [...cuerpo.matchAll(/namespace:\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1] ?? "");

    hallados.push({ expresion, secreto, parche, namespaces: puestas, variable });
  }
  return hallados;
}

/**
 * Y solo las expresiones de los bucles que cumplen las CUATRO condiciones: crean el `Secret`,
 * crean el parche, y los dos le ponen `namespace:` a la variable del bucle.
 */
export function espaciosDeclaradosEn(fuente: string): string[] {
  return buclesDeLaCredencialEn(fuente)
    .filter(
      (b) =>
        b.secreto &&
        b.parche &&
        b.namespaces.length === 2 &&
        b.namespaces.every((n) => n === b.variable),
    )
    .map((b) => b.expresion);
}

/**
 * Y la misma lectura sobre el `index.ts` de verdad, exigiendo que haya exactamente una.
 *
 * Lanza si no la encuentra: «no se pudo leer» no puede leerse como «no hay credencial»
 * (C-15/C-16), y devolver la lista vacia dejaria en verde todo lo que este archivo afirma.
 */
export function fuenteDeLosEspaciosConCredencial(): string {
  const ruta = join(raizDelRepositorio(), "infra", "index.ts");
  const fuente = readFileSync(ruta, "utf8");
  const hallados = espaciosDeclaradosEn(fuente);
  if (hallados.length !== 1) {
    // Y QUE le falta a cada bucle a medias, porque las dos mitades se rompen en direcciones
    // opuestas y se arreglan distinto: sin el `Secret`, `imagePullSecrets` apunta en esos
    // espacios a un objeto que no existe y el kubelet no puede autenticarse; sin el parche, el
    // `Secret` esta puesto y no lo reclama nadie. Un diagnostico que solo dijera «no cuadra»
    // mandaria a leer el archivo entero.
    const aMedias = buclesDeLaCredencialEn(fuente)
      .map((b) => {
        const falta = [
          b.secreto ? "" : "el `Secret` de `kubernetes.io/dockerconfigjson`",
          b.parche ? "" : "el `ServiceAccountPatch` con `imagePullSecrets`",
          b.namespaces.length === 2 && b.namespaces.every((n) => n === b.variable)
            ? ""
            : `que los dos pongan \`namespace: ${b.variable}\` (ponen: ${b.namespaces.join(", ") || "ninguno"})`,
        ].filter((x) => x !== "");
        return falta.length === 0 ? "" : `    · bucle sobre \`${b.expresion}\`: le falta ${falta.join(" y ")}`;
      })
      .filter((x) => x !== "");
    throw new Error(
      "«infra/index.ts» no crea la credencial de registro en la forma que esta guarda sabe leer: " +
        "se esperaba UN bucle que recorra los espacios de nombres creando en cada uno el `Secret` " +
        "de `dockerconfigjson` Y el `ServiceAccountPatch` con `imagePullSecrets`, los dos con " +
        "`namespace:` puesto a la variable del bucle, y se encontraron " +
        String(hallados.length) +
        (hallados.length > 1 ? ` (${hallados.join(" · ")})` : "") +
        ".\n" +
        "  Esta comprobacion NO se salta y NO devuelve la lista vacia: «no se pudo leer» se " +
        "leeria como «ningun espacio tiene credencial», y con eso todo lo que este archivo " +
        "afirma sobre quien puede bajarse una imagen privada pasaria en verde sobre el conjunto " +
        "vacio.\n" +
        (aMedias.length > 0 ? `  Lo que hay:\n${aMedias.join("\n")}\n` : "") +
        `  Fuente leida: ${ruta}`,
    );
  }
  return hallados[0]!;
}

/**
 * Los espacios de nombres cuyos pods tienen credencial para `ghcr.io`, y de donde sale el dato.
 *
 * **No es «los que declaran `imagePullSecrets` en el pod»**, y creerlo daba un falso positivo
 * sobre el monolito: la credencial no vive en ningun `spec`. `index.ts` crea el `Secret`
 * `<amb>-registro-credenciales` y **parchea el `ServiceAccount` `default`**, de donde la heredan
 * todos los pods de ese espacio de nombres —ninguno declara `serviceAccountName`— (issue #257).
 *
 * Y llegaba a **uno**, el de la plataforma. Desde ADR-0031 cada sistema vive en el suyo, y ahi no
 * habia ni `Secret` ni parche: funcionaba porque los ocho paquetes de los cuatro sistemas del
 * corte son publicos. `identidad` (ADR-0039) es el primer paquete privado del producto y con el
 * el hueco dejo de ser hipotetico, asi que la credencial pasa a los SEIS espacios del ambiente.
 *
 * **La lista NO se escribe aqui, y tampoco se lee de `index.ts` como texto: se EJECUTA.** El
 * fuente de `index.ts` solo dice de DONDE sale —`namespacesDelAmbiente(env)`—, y esta funcion
 * llama a esa misma funcion para saber cuales son. Leer los nombres del texto seria un segundo
 * sitio con la misma verdad, y el que se queda viejo el dia que entre un sexto sistema; escribir
 * la lista aqui seria peor todavia, porque una guarda que no cambia cuando el mundo cambia es
 * peor que no tenerla (M10 de C-19: la lista se ejecuta, no se lee).
 *
 * Si `index.ts` cambiara de fuente, esta funcion devuelve **el texto de la expresion tal cual**
 * en vez de una lista de espacios: la prueba la nombra y sale roja, que es lo contrario de darla
 * por buena.
 */
const FUENTE_ESPERADA = "namespacesDelAmbiente(env)";

export function espaciosConCredencialDeRegistro(ambiente: Environment): string[] {
  const expresion = fuenteDeLosEspaciosConCredencial();
  // La UNICA expresion que esta guarda sabe ejecutar. No es una lista de espacios de nombres —eso
  // es lo que se queria evitar—: es el nombre de la funcion que los deriva, y quien la ejecuta
  // con el ambiente de verdad es la linea de abajo.
  if (expresion !== FUENTE_ESPERADA) {
    throw new Error(
      `«infra/index.ts» crea la credencial de registro recorriendo \`${expresion}\`, y esta ` +
        `guarda solo sabe ejecutar \`${FUENTE_ESPERADA}\`.\n` +
        "  No se devuelve la expresion como si fuera un espacio de nombres: con eso, todo pod " +
        "contaria como «sin credencial» y el rojo hablaria de los pods en vez de hablar de esta " +
        "linea. Y no se devuelve la lista vacia, por lo mismo que arriba.\n" +
        "  Remedio: recorrer `namespacesDelAmbiente(env)` —que es de donde salen los espacios de " +
        "un ambiente, derivados de SISTEMAS_DEL_PRODUCTO— o enseñarle a esta guarda a ejecutar " +
        "la fuente nueva. Lo que no vale es que las dos se separen en silencio.",
    );
  }
  return namespacesDelAmbiente(ambiente);
}

/** Una carga que trae una imagen del producto, donde vive y si su espacio tiene credencial. */
export interface CargaConImagenDelProducto {
  espacio: string;
  donde: string;
  imagenes: string[];
  /** `true` si esa carga puede bajarse una imagen PRIVADA: por su `spec` o por su espacio. */
  credencial: boolean;
}

/** Compatibilidad de nombre con lo que `#257` dejo escrito: una carga que NO puede bajarla. */
export type PodSinCredencial = CargaConImagenDelProducto;

/**
 * TODAS las cargas del ambiente que traen una imagen de `ghcr.io/hneyra`, con si tienen o no
 * credencial para bajarla.
 *
 * Existe aparte de `podsSinCredencial` por el contraste: **todo lo que este archivo afirma sobre
 * la credencial es cierto sobre el conjunto vacio**. Con la credencial ya puesta en los seis
 * espacios, «ninguna carga se queda sin credencial» pasa igual de verde si el recorrido dejara
 * de encontrar cargas — que es exactamente C-15/C-16—. Este censo es el sujeto: la prueba exige
 * primero que haya cargas que contar.
 */
export function cargasConImagenDelProducto(ambiente: Environment): CargaConImagenDelProducto[] {
  // Los espacios cuyo `ServiceAccount` `default` lleva la credencial. NO es una lista escrita
  // aqui: sale de leer `index.ts` y ejecutar la funcion de la que el saca los suyos.
  const conCredencial = new Set(espaciosConCredencialDeRegistro(ambiente));
  const salida: CargaConImagenDelProducto[] = [];

  for (const m of manifiestosDelAmbiente(invariantesDe(ambiente))) {
    const manifiesto = m as unknown as Record<string, unknown>;
    const meta = manifiesto["metadata"] as { namespace?: string; name?: string } | undefined;
    const espacio = meta?.namespace ?? "";

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

    const imagenes = [...(pod.containers ?? []), ...(pod.initContainers ?? [])]
      .map((c) => c.image ?? "")
      .filter((i) => i.startsWith(REGISTRO_PROPIO));
    if (imagenes.length === 0) continue;

    salida.push({
      espacio,
      donde: `${String(manifiesto["kind"])}/${meta?.name ?? ""}`,
      imagenes,
      credencial: (pod.imagePullSecrets ?? []).length > 0 || conCredencial.has(espacio),
    });
  }

  return salida.sort((a, b) => a.donde.localeCompare(b.donde));
}

/**
 * Las cargas que traen una imagen del producto y **no podrian bajarla si el paquete fuera
 * privado**: ni su `spec` declara `imagePullSecrets` ni su espacio de nombres tiene la credencial.
 *
 * Eran DIECINUEVE —las de los cinco sistemas, porque el parche llegaba solo a la plataforma— y
 * hoy son cero, porque la credencial llega a los seis espacios del ambiente. Lo que sigue
 * midiendo es lo mismo que medía: una carga que aparezca fuera de esos seis espacios, o un
 * espacio que se quede sin credencial, vuelve a salir aqui.
 */
export function podsSinCredencial(ambiente: Environment): CargaConImagenDelProducto[] {
  return cargasConImagenDelProducto(ambiente).filter((c) => !c.credencial);
}
