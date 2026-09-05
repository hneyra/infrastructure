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
