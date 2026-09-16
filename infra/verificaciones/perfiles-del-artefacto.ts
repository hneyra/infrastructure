import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { raizDelRepositorio } from "../componentes/fuentes";

/**
 * Que perfiles de Spring declara el artefacto de un sistema, y **cuales de ellos TERMINAN**.
 *
 * ## De donde viene, y por que no es una lista escrita aqui
 *
 * C-17 §5 existe porque `kamayuk-rentas-batch` era un `Deployment` del perfil `batch`. Medido en
 * el clúster: arranca, hace su trabajo, sale con **codigo 0** a los once segundos y Kubernetes lo
 * vuelve a crear, porque un `Deployment` solo admite `restartPolicy: Always` y no puede
 * distinguir «termino» de «se murio». `CrashLoopBackOff` con siete reinicios sobre un proceso que
 * hizo exactamente lo que tenia que hacer.
 *
 * Hasta `caja`#79 esa guarda lo expresaba como `SPRING_PROFILES_ACTIVE === "web"`, y eso decia
 * dos cosas a la vez: «el perfil no termina» —que es la regla— y «el perfil es `web`» —que era
 * cierto por accidente, porque no habia mas perfiles de larga vida—. `caja` estrena `publicador`:
 * no atiende HTTP (`web-application-type: none`), saca el buzon de pagos cada pocos segundos y
 * **no sale** (`spring.main.keep-alive: true`). Con la guarda escrita contra `web` eso sale rojo
 * acusando de un `CrashLoopBackOff` que no puede ocurrir.
 *
 * ## Quien lo decide de verdad, y por eso es lo que se lee
 *
 * Lo decide `KamayukAplicacion.main`, en el clon de cada sistema:
 *
 * ```java
 * if (terminaAlAcabar(contexto.getEnvironment())) {
 *     System.exit(SpringApplication.exit(contexto));
 * }
 * ```
 *
 * con `terminaAlAcabar` devolviendo `entorno.matchesProfiles(PERFIL_BATCH)`. Se lee ESE archivo y
 * se resuelve la constante: escribir aqui `["batch"]` seria un segundo sitio con la misma verdad,
 * y el que envejece — el dia que un sistema haga terminar otro perfil, la guarda tiene que verlo
 * sin que nadie se acuerde de venir aqui.
 *
 * Y se lee tambien el `application.yaml`, por la otra mitad: **un `Deployment` no puede correr un
 * perfil que su artefacto no declara**. Sin eso, cambiar «no termina» por «cualquier cosa que no
 * sea `batch`» dejaria pasar un `publicadorr` mal escrito, que arranca con la configuracion base
 * —sin `web-application-type: none` y sin `keep-alive`— y da el mismo `CrashLoopBackOff` por otro
 * camino.
 *
 * ## Lo que hace cuando no entiende: fallar, nunca callar
 *
 * Es la direccion de `sondas-contra-la-cadena`. Un `main` sin `matchesProfiles`, con dos, o con un
 * argumento que no se resuelva a un literal, **lanza**: no se sabe que perfil termina, y una
 * guarda que se saltara lo que no entiende daria verde justo el dia que alguien reescribiera esa
 * decision — que es el dia en que mas falta hace mirarla.
 */

/** El mismo Java con los comentarios en blanco y las cadenas intactas. */
export function sinComentarios(java: string): string {
  let salida = "";
  let i = 0;
  while (i < java.length) {
    const dos = java.slice(i, i + 2);
    if (dos === "//") {
      while (i < java.length && java[i] !== "\n") i += 1;
      continue;
    }
    if (dos === "/*") {
      // Se conservan los saltos de linea: un hallazgo tiene que poder decir su linea.
      while (i < java.length && java.slice(i, i + 2) !== "*/") {
        salida += java[i] === "\n" ? "\n" : "";
        i += 1;
      }
      i += 2;
      continue;
    }
    const c = java[i] as string;
    if (c === '"') {
      salida += c;
      i += 1;
      while (i < java.length && java[i] !== '"') {
        if (java[i] === "\\") {
          salida += java.slice(i, i + 2);
          i += 2;
          continue;
        }
        salida += java[i];
        i += 1;
      }
      salida += '"';
      i += 1;
      continue;
    }
    salida += c;
    i += 1;
  }
  return salida;
}

/** Donde vive el `main` de un sistema, en su clon hermano. */
export function fuenteDelArranque(sistema: string): string {
  const ruta = join(
    resolve(raizDelRepositorio(), "..", sistema),
    "backend",
    `kamayuk-${sistema}-aplicacion`,
    "src/main/java/kamayuk",
    sistema,
    "KamayukAplicacion.java",
  );
  if (!existsSync(ruta)) {
    throw new Error(
      `No esta «${ruta}». Es el archivo que decide que perfiles TERMINAN, y sin el no se puede ` +
        `saber si un \`Deployment\` corre uno.\n  Remedio: git clone https://github.com/hneyra/${sistema}\n` +
        "  Esta comprobacion NO se salta: «no se pudo comprobar» no es «esta bien».",
    );
  }
  return readFileSync(ruta, "utf8");
}

/** Donde vive la configuracion del artefacto de un sistema. */
export function configuracionDelArtefacto(sistema: string): string {
  const ruta = join(
    resolve(raizDelRepositorio(), "..", sistema),
    "backend",
    `kamayuk-${sistema}-aplicacion`,
    "src/main/resources/application.yaml",
  );
  if (!existsSync(ruta)) {
    throw new Error(
      `No esta «${ruta}». Es donde se declara cada perfil del artefacto, y un \`Deployment\` que ` +
        "corriera uno que no esta ahi arrancaria con la configuracion base.\n" +
        `  Remedio: git clone https://github.com/hneyra/${sistema}`,
    );
  }
  return readFileSync(ruta, "utf8");
}

/** Las `static final String` de una clase, resueltas a su literal. */
function constantesDeTexto(java: string): Map<string, string> {
  const constantes = new Map<string, string>();
  for (const casa of java.matchAll(/static\s+final\s+String\s+(\w+)\s*=\s*"([^"]*)"\s*;/g)) {
    constantes.set(casa[1] as string, casa[2] as string);
  }
  return constantes;
}

/**
 * Los perfiles con los que el proceso SALE en cuanto acaban sus `ApplicationRunner`.
 *
 * Se exige **exactamente un** `matchesProfiles(...)` y que el archivo llame a `System.exit`: dos
 * llamadas significan que la decision ya no se lee de un sitio, y ninguna que no la hay.
 */
export function perfilesQueTerminan(sistema: string, fuente = fuenteDelArranque(sistema)): string[] {
  const java = sinComentarios(fuente);
  const llamadas = [...java.matchAll(/matchesProfiles\(([^)]*)\)/g)];
  if (llamadas.length !== 1) {
    throw new Error(
      `«${sistema}/KamayukAplicacion.java» tiene ${String(llamadas.length)} llamadas a ` +
        "`matchesProfiles(...)` y esta lectura espera UNA: es la que decide que perfiles " +
        "terminan el proceso (C-17 §5). Con ninguna no se sabe cual termina, y con dos la " +
        "decision dejo de estar en un sitio. Hay que releer ese `main` y actualizar esta " +
        "funcion, no dar por bueno lo que no se entiende.",
    );
  }
  if (!/System\.exit\s*\(/.test(java)) {
    throw new Error(
      `«${sistema}/KamayukAplicacion.java» usa \`matchesProfiles(...)\` y no llama a ` +
        "`System.exit(...)`: lo que esta lectura deriva es QUE PERFIL HACE SALIR AL PROCESO, y " +
        "si ese `matchesProfiles` ya decide otra cosa, la derivacion estaria mintiendo.",
    );
  }

  const constantes = constantesDeTexto(java);
  return (llamadas[0]?.[1] ?? "")
    .split(",")
    .map((argumento) => argumento.trim())
    .filter((argumento) => argumento.length > 0)
    .map((argumento) => {
      const literal = /^"([^"]*)"$/.exec(argumento);
      if (literal !== null) return literal[1] as string;
      const constante = constantes.get(argumento);
      if (constante !== undefined) return constante;
      throw new Error(
        `«${sistema}/KamayukAplicacion.java» decide que perfil termina con «${argumento}», que ` +
          "no es un literal ni una `static final String` de la misma clase. No se resuelve, y " +
          "adivinarlo daria verde a un `Deployment` en un perfil que termina.",
      );
    });
}

/** Los perfiles que el `application.yaml` del artefacto declara con `on-profile:`. */
export function perfilesDeclarados(sistema: string, yaml = configuracionDelArtefacto(sistema)): string[] {
  const declarados = [...yaml.matchAll(/^\s*on-profile:\s*(\S+)\s*$/gm)].map(
    (casa) => casa[1] as string,
  );
  if (declarados.length === 0) {
    throw new Error(
      `«${sistema}/application.yaml» no declara ni un \`on-profile:\`. Con la lista vacia, la ` +
        "comprobacion de «el perfil que corre esta declarado» acusaria a todos los " +
        "`Deployment` del sistema, que es un rojo que no dice nada.",
    );
  }
  return [...new Set(declarados)].sort();
}

/** Un contenedor de un `Deployment` que corre el jar, con el perfil que le toca. */
export interface ProcesoDesplegado {
  /** `kamayuk-caja-publicador/caja`, para que el rojo diga a que pod ir. */
  donde: string;
  perfil: string | undefined;
}

/**
 * Los `Deployment` de un sistema que corren un perfil **que termina**.
 *
 * Se separa de la prueba para que la mutacion —poner `batch` en un `Deployment` de verdad— pueda
 * ejercerla sin tocar el clon de nadie. Una guarda que no se puede poner roja no protege nada.
 */
export function enUnPerfilQueTermina(
  procesos: readonly ProcesoDesplegado[],
  terminan: readonly string[],
): string[] {
  return procesos
    .filter((p) => p.perfil !== undefined && terminan.includes(p.perfil))
    .map((p) => `${p.donde} → ${p.perfil ?? "(ninguno)"}`)
    .sort();
}

/** Y los que corren un perfil que su propio artefacto no declara. */
export function enUnPerfilSinDeclarar(
  procesos: readonly ProcesoDesplegado[],
  declarados: readonly string[],
): string[] {
  return procesos
    .filter((p) => p.perfil === undefined || !declarados.includes(p.perfil))
    .map((p) => `${p.donde} → ${p.perfil ?? "(ninguno)"}`)
    .sort();
}
