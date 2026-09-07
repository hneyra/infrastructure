import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { raizDelRepositorio } from "../componentes/fuentes";

/**
 * La ruta que una sonda pide, contra lo que la cadena de seguridad permite (C-17, punto 2).
 *
 * ## El defecto, que no es hipotetico y no lo veia nadie
 *
 * Los cuatro descriptores declaran desde que existen:
 *
 *     livenessProbe:  /actuator/health/liveness
 *     readinessProbe: /actuator/health/readiness
 *
 * y `SeguridadWeb` de los cuatro permitia **exactamente** `/actuator/health` y
 * `/actuator/prometheus`, «nombrados uno por uno» a proposito. Medido dentro del clúster:
 *
 *     GET /actuator/health          -> 200
 *     GET /actuator/health/liveness -> 401
 *
 * Consecuencia: los cuatro pods arrancaban, conectaban a la base —Hikari abria el pool— y el
 * kubelet los mataba a los ~45 s. `CrashLoopBackOff` **para siempre**, con la aplicacion sana y
 * sin un solo error en su registro. El sintoma no se parece a su causa: lo que se ve es un pod
 * que se reinicia, y lo que pasa es que una politica de autorizacion no conoce una ruta.
 *
 * Las dos mitades estaban bien escritas cada una por su lado y **nada las comparaba**. Eso es lo
 * que hace esta comprobacion, y por eso vive aqui: este repositorio tiene los seis clones —los
 * necesita `extensiones-de-las-migraciones` desde C-2—, mientras que cada sistema por su cuenta
 * solo ve la mitad que le toca. Es el mismo reparto que `checkout-en-el-espacio-de-trabajo`.
 *
 * ## Se LEE el Java, no se copia una lista
 *
 * La alternativa —escribir aqui `["/actuator/health", "/actuator/prometheus", ...]`— seria un
 * tercer sitio con la misma verdad, y el que envejece sin que nada se ponga rojo. Lo que se lee
 * es el archivo de produccion: las constantes `public static final String` de la clase y los
 * argumentos del `requestMatchers(...)` que termina en `.permitAll()`.
 *
 * ## Lo que hace cuando NO entiende algo: fallar, nunca callar
 *
 * Un argumento que no se pueda resolver a un literal —una constante de otra clase, una llamada,
 * un comodin— lanza. La direccion importa: una comprobacion que se saltara lo que no entiende
 * daria verde justo el dia que alguien escribiera la cadena de otra forma, que es el dia en que
 * mas falta hace mirarla.
 *
 * El comodin se rechaza **a proposito**: `requestMatchers("/actuator/health/**")` haria pasar
 * cualquier sonda sin decir nada, y con el la comprobacion no podria fallar nunca.
 */

/** Una constante de la clase, ya resuelta a su literal. */
type Constantes = Map<string, string>;

const DECLARACION = /public\s+static\s+final\s+String\s+(\w+)\s*=\s*([^;]+);/g;

/**
 * Las constantes `public static final String` de la clase, resueltas.
 *
 * El inicializador puede ser una concatenacion de literales y de constantes **ya declaradas**
 * —asi esta escrito `SONDA_DE_VIDA = SONDA_DE_SALUD + "/liveness"`, que es la forma que dice
 * que los dos grupos son subrecursos del mismo endpoint—. Lo que no se resuelva se omite: no es
 * un error tenerlo, lo es USARLO en el `permitAll()`, y eso lo decide `rutasPublicas`.
 */
export function constantesDe(fuente: string): Constantes {
  const constantes: Constantes = new Map();
  for (const encaje of fuente.matchAll(DECLARACION)) {
    const nombre = encaje[1];
    const inicializador = encaje[2];
    if (nombre === undefined || inicializador === undefined) continue;
    const valor = resolver(inicializador, constantes);
    if (valor !== undefined) constantes.set(nombre, valor);
  }
  return constantes;
}

/** Un inicializador: literales y constantes ya conocidas, unidos por `+`. `undefined` si no. */
function resolver(inicializador: string, constantes: Constantes): string | undefined {
  const partes = inicializador.split("+").map((p) => p.trim());
  let resultado = "";
  for (const parte of partes) {
    const literal = /^"([^"]*)"$/.exec(parte);
    if (literal !== null) {
      resultado += literal[1] ?? "";
      continue;
    }
    const conocida = constantes.get(parte);
    if (conocida === undefined) return undefined;
    resultado += conocida;
  }
  return resultado;
}

/**
 * Las rutas que la cadena atiende **sin identidad**: los argumentos del `requestMatchers(...)`
 * que va seguido de `.permitAll()`.
 *
 * @throws si no hay ninguno, o si algun argumento no se resuelve a un literal sin comodin
 */
export function rutasPublicas(fuente: string, donde: string): string[] {
  const constantes = constantesDe(fuente);
  const inicio = fuente.indexOf("requestMatchers(");
  const bloques: string[] = [];
  for (let i = inicio; i >= 0; i = fuente.indexOf("requestMatchers(", i + 1)) {
    const abre = i + "requestMatchers(".length;
    const cierra = cierreDe(fuente, abre);
    if (cierra < 0) continue;
    const despues = fuente.slice(cierra + 1).trimStart();
    if (!despues.startsWith(".permitAll()")) continue;
    bloques.push(fuente.slice(abre, cierra));
  }

  if (bloques.length === 0) {
    throw new Error(
      `«${donde}» no tiene ningun \`requestMatchers(...).permitAll()\`. O la cadena dejo de ` +
        "abrir las sondas —y entonces los pods entran en CrashLoopBackOff con la aplicacion " +
        "sana—, o se escribio de otra forma y esta comprobacion dejo de mirar lo que dice mirar.",
    );
  }

  return bloques.flatMap((bloque) =>
    argumentos(bloque).map((argumento) => {
      const valor = resolver(argumento, constantes);
      if (valor === undefined) {
        throw new Error(
          `«${donde}»: no se puede resolver «${argumento}» a una ruta literal. Esta comprobacion ` +
            "compara la ruta de cada sonda contra lo que esta cadena permite, y para eso tiene " +
            "que saber que rutas son. Se falla en vez de omitirlo: saltarse lo que no se entiende " +
            "daria verde justo el dia que la cadena se escriba de otra forma.",
        );
      }
      if (valor.includes("*")) {
        throw new Error(
          `«${donde}»: «${valor}» lleva comodin. Un comodin haria pasar cualquier sonda sin ` +
            "decir nada —esta comprobacion no podria fallar nunca— y abriria de golpe todo grupo " +
            "del actuator que alguien anada despues. Las rutas se nombran una por una.",
        );
      }
      return valor;
    }),
  );
}

/** El indice del parentesis que cierra el abierto justo antes de `desde`. */
function cierreDe(fuente: string, desde: number): number {
  let profundidad = 1;
  for (let i = desde; i < fuente.length; i++) {
    const c = fuente[i];
    if (c === "(") profundidad++;
    else if (c === ")") {
      profundidad--;
      if (profundidad === 0) return i;
    }
  }
  return -1;
}

/** Los argumentos de una lista, separados por comas de primer nivel. */
function argumentos(bloque: string): string[] {
  const partes: string[] = [];
  let profundidad = 0;
  let actual = "";
  for (const c of bloque) {
    if (c === "(") profundidad++;
    if (c === ")") profundidad--;
    if (c === "," && profundidad === 0) {
      partes.push(actual);
      actual = "";
      continue;
    }
    actual += c;
  }
  partes.push(actual);
  return partes.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Donde vive la cadena de seguridad de un sistema, en su clon hermano. */
export function fuenteDeLaCadena(sistema: string): string {
  const ruta = join(
    resolve(raizDelRepositorio(), "..", sistema),
    "backend",
    `kamayuk-${sistema}-plataforma`,
    "src/main/java/kamayuk",
    sistema,
    "plataforma/SeguridadWeb.java",
  );
  if (!existsSync(ruta)) {
    throw new Error(
      `Falta «${ruta}». Sin la cadena de seguridad de «${sistema}» no se puede comparar la ruta ` +
        `de sus sondas con lo que atiende sin token. Remedio: git clone https://github.com/hneyra/${sistema}`,
    );
  }
  return readFileSync(ruta, "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// La otra mitad: quien atiende la sonda de un contenedor que NO corre el jar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * De donde sale la configuracion de nginx que **de verdad** sirve a ese contenedor.
 *
 * Hay dos formas legitimas y estan las dos en el arbol, medidas:
 *
 *   - `caja` monta un `ConfigMap` en `/etc/nginx/conf.d/default.conf` con `subPath` — nginx lee
 *     su servidor de ahi, asi que **el `ConfigMap` es la configuracion**;
 *   - `rentas` la lleva DENTRO de la imagen (`rentas`#44 lo decidio con todas las letras: «no
 *     hace falta el equivalente de `nginxDelCluster()` ni una copia literal del `nginx.conf`
 *     dentro del descriptor»), y su unico `ConfigMap` monta `configuracion.js` bajo
 *     `/usr/share/nginx/html/` — que es un archivo que **se sirve**, no el servidor.
 *
 * Lo que separa las dos no se declara: se **deriva del punto de montaje**. Un `ConfigMap` bajo
 * `/etc/nginx/` es el servidor; en cualquier otro sitio es contenido.
 *
 * **Y no se toma la union de las dos fuentes.** Seria la salida comoda y es la peor: un
 * `ConfigMap` de `caja` al que se le cayera un `location` que su clon todavia tiene pasaria en
 * verde, y lo que se despliega es el `ConfigMap`.
 */
export interface NginxDeUnConfigMap {
  clase: "configmap";
  nombre: string;
  texto: string;
}

export interface NginxDeLaImagen {
  clase: "imagen";
  ruta: string;
  texto: string;
}

export type FuenteDelNginx = NginxDeUnConfigMap | NginxDeLaImagen;

/** El prefijo bajo el que nginx lee su configuracion. Todo lo demas es contenido servido. */
export const CONFIGURACION_DE_NGINX = "/etc/nginx/";

/**
 * Los `ConfigMap` que ese contenedor monta **como configuracion de nginx**, con su contenido.
 *
 * `dato` es lo que hay que leer del `ConfigMap`: con `subPath` es esa clave y solo esa; sin el,
 * el directorio entero.
 */
export function nginxMontado(
  montajes: readonly { name: string; mountPath: string; subPath?: string }[],
  volumenes: readonly { name: string; configMap?: { name: string } }[],
  configMaps: ReadonlyMap<string, Record<string, string>>,
): NginxDeUnConfigMap[] {
  const fuentes: NginxDeUnConfigMap[] = [];
  for (const montaje of montajes) {
    if (!montaje.mountPath.startsWith(CONFIGURACION_DE_NGINX)) continue;
    const nombre = volumenes.find((v) => v.name === montaje.name)?.configMap?.name;
    if (nombre === undefined) continue;
    const datos = configMaps.get(nombre);
    if (datos === undefined) continue;
    const texto =
      montaje.subPath === undefined
        ? Object.values(datos).join("\n")
        : (datos[montaje.subPath] ?? "");
    fuentes.push({ clase: "configmap", nombre, texto });
  }
  return fuentes;
}

/** Donde vive el `nginx.conf` de la interfaz de un sistema, en su clon hermano. */
export function nginxDelClon(sistema: string): NginxDeLaImagen | undefined {
  const ruta = join(resolve(raizDelRepositorio(), "..", sistema), "frontend", "nginx.conf");
  if (!existsSync(ruta)) return undefined;
  return { clase: "imagen", ruta, texto: readFileSync(ruta, "utf8") };
}

/**
 * Los `location` que una configuracion de nginx declara, **con su modificador aparte**.
 *
 * `location = /index.html` es una coincidencia EXACTA y `location /assets/` un prefijo. Leerlos
 * con `linea.slice("location ".length).replace(/[{\s].*$/, "")` —como estaba— devuelve `«=»`
 * para el primero: un rojo que enumera `«/», «/assets/», «=»` manda a mirar un archivo que esta
 * bien escrito.
 */
export function locationsDe(configuracion: string): { modificador: string; ruta: string }[] {
  const encontrados: { modificador: string; ruta: string }[] = [];
  for (const linea of configuracion.split("\n")) {
    const casa = /^\s*location\s+(=|~\*|~|\^~)?\s*([^\s{]+)/.exec(linea);
    if (casa === null) continue;
    encontrados.push({ modificador: casa[1] ?? "", ruta: casa[2] ?? "" });
  }
  return encontrados;
}

/**
 * Si esa configuracion atiende esa ruta.
 *
 * `=` casa exacto; un prefijo casa lo que empieza por el; las expresiones regulares (`~`, `~*`)
 * **no se interpretan y lanzan**, por lo mismo que el comodin de `rutasPublicas`: darlas por
 * buenas haria que esta comprobacion no pudiera fallar, y darlas por malas pondria rojo un
 * archivo correcto.
 */
export function atiende(
  configuracion: string,
  ruta: string,
  donde: string,
): boolean {
  let cubierta = false;
  for (const { modificador, ruta: declarada } of locationsDe(configuracion)) {
    if (modificador === "~" || modificador === "~*") {
      throw new Error(
        `«${donde}» declara \`location ${modificador} ${declarada}\`, y esta comprobacion no ` +
          "interpreta expresiones regulares. Se falla en vez de suponer: darla por buena dejaria " +
          "de poder fallar nunca, y darla por mala pondria rojo un archivo bien escrito.",
      );
    }
    if (modificador === "=" ? declarada === ruta : ruta.startsWith(declarada)) cubierta = true;
  }
  return cubierta;
}
