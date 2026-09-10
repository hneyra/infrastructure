import { execFileSync } from "node:child_process";
import { podsDe, contenedoresDe, type Contenedor, type Manifiesto } from "../componentes/tipos";
import type { Environment } from "../config";
import { manifiestosDelAmbiente } from "../herramientas/emitir-manifiestos";
import { clonDe, REVISION_DE_REFERENCIA, SISTEMAS } from "./deriva-de-migraciones";
import { invariantesDe } from "./stacks";

/**
 * Quien corre cada contenedor, y por que el UID tiene que estar ESCRITO.
 *
 * ## La regla del kubelet, que es lo que decide si el pod arranca
 *
 * Con `runAsNonRoot: true` y **sin** `runAsUser`, quien contesta «¿esto es root?» es la imagen.
 * Si su configuracion declara un `USER` numerico, el kubelet lo lee y decide; si lo declara por
 * NOMBRE —`nginx`, `curl_user`— o no lo declara en absoluto, no puede comprobarlo sin ejecutarla
 * y **se niega**: `CreateContainerConfigError`, «container has runAsNonRoot and image will run as
 * root». No es un aviso: el contenedor no se crea.
 *
 * ## Por que esta guarda se mudo aqui, y es la tercera vez que este defecto se paga
 *
 * La comprobacion existia desde #268 —la escribio `mailpit`, cuya imagen no declara `USER` y dejo
 * un `pulumi up` esperando 600 s por un `Deployment` que no podia quedar `Ready`— y vivia en
 * `componentes.test.ts`, leyendo `construirManifiestos`, o sea **la plataforma**. Desde ADR-0031
 * los cinco sistemas viven en su propio espacio de nombres y sus manifiestos no pasan por ahi:
 * medido, la plataforma son **12** contenedores de los **56** del ambiente. La guarda no fallo,
 * **dejo de mirar** — es C-16, `E` y #10 otra vez, algo escrito cuando habia un solo espacio de
 * nombres que no siguio al corte.
 *
 * Y lo que se le escapo fue caro: `espera-al-motor` (#44) nacio con `runAsNonRoot` sin UID sobre
 * la imagen del motor —que arranca como root a proposito— y **el ambiente entero llevaba desde
 * entonces sin poder desplegarse**, con 395 intentos en 89 minutos y todos los `Job` de migracion
 * e implantacion de los cinco sistemas parados. Hay una segunda razon por la que nadie lo vio, y
 * conviene decirla: esa espera la inyecta la plataforma **despues** de componer y auditar, asi
 * que `auditarManifiestos` tampoco la ve. El unico contenedor que no audita nadie es el que
 * rompio el ambiente.
 *
 * ## Y la exencion se lleva por IMAGEN y no por nombre de contenedor
 *
 * La lista anterior eximia por el nombre del contenedor —«aplicacion», «migrador», «grafana»—, y
 * un nombre no es una imagen: dos contenedores que se llamen igual pueden salir de dos imagenes
 * distintas, y el que nazca manana reusando el nombre hereda una exencion que nadie le concedio.
 * Lo que exime es que **esa imagen** fije su usuario por numero, asi que la clave es la imagen sin
 * su etiqueta.
 *
 * **Cada exencion es un `USER` numerico LEIDO, no una suposicion** — y las de este producto se
 * vuelven a leer del `Dockerfile` de su clon en cada corrida, para que no puedan quedarse viejas.
 */

/** Un contenedor del ambiente, con lo que decide si el kubelet lo crea. */
export interface ContenedorDelAmbiente {
  ambiente: Environment;
  /** `Job/kamayuk-rentas-migracion-66ebe547a3ee`. */
  donde: string;
  nombre: string;
  imagen: string;
  nonRoot: boolean | undefined;
  uid: number | undefined;
}

/** `ghcr.io/hneyra/kamayuk-rentas:66ebe547…` -> `ghcr.io/hneyra/kamayuk-rentas`. */
export function sinEtiqueta(imagen: string): string {
  const corte = imagen.lastIndexOf(":");
  // Un puerto en el anfitrion lleva `:` y no es una etiqueta: `registro:5000/x`. La etiqueta va
  // siempre despues de la ultima `/`.
  return corte > imagen.lastIndexOf("/") ? imagen.slice(0, corte) : imagen;
}

/** Todo contenedor —`initContainers` incluidos— de todo pod del ambiente. */
export function contenedoresDelAmbiente(ambiente: Environment): ContenedorDelAmbiente[] {
  const ms: Manifiesto[] = manifiestosDelAmbiente(invariantesDe(ambiente));
  return ms.flatMap((m) =>
    podsDe(m).flatMap(({ contexto, pod }) =>
      contenedoresDe(pod).map((c: Contenedor) => ({
        ambiente,
        donde: contexto,
        nombre: c.name,
        imagen: c.image,
        nonRoot: c.securityContext?.runAsNonRoot,
        uid: c.securityContext?.runAsUser,
      })),
    ),
  );
}

/**
 * Los contenedores que arrancan como root **a proposito**, con su motivo.
 *
 * Aqui la clave si es el nombre del contenedor y no la imagen, y es deliberado: los dos usan la
 * imagen del motor, y lo que los exime no es la imagen sino lo que ese contenedor hace con ella.
 * De hecho `espera-al-motor` usa la MISMA imagen y no esta exento — corre con un UID escrito.
 */
export const ARRANCA_COMO_ROOT_A_PROPOSITO: Record<string, string> = {
  // El `entrypoint` de la imagen oficial de PostgreSQL arranca como root para tomar posesion de
  // PGDATA con `chown` y baja privilegios el mismo con `gosu` (ver `BaseDeDatos.ts`).
  postgres: "el entrypoint toma posesion de PGDATA y baja privilegios el mismo",
  // Lee PGDATA de solo lectura con el permiso que la propia imagen le dio al motor; forzar un UID
  // sin verificarlo contra un cluster real cambia un guion que funciona por uno que no
  // (ver `Respaldo.ts`).
  "respaldo-base": "lee PGDATA con el permiso que la imagen le dio al motor",
};

/** Una imagen cuyo `USER` numerico se ha leido, y donde se leyo. */
export interface UserLeido {
  uid: number;
  /** El `Dockerfile` del clon hermano donde se lee, relativo a su raiz. Se vuelve a leer. */
  dockerfile?: { clon: string; ruta: string };
  /** Para las imagenes de terceros, que no tienen clon: de donde sale la cifra. */
  fuente?: string;
}

/**
 * Las imagenes que fijan su usuario por NUMERO, y por eso no necesitan `runAsUser`.
 *
 * Las del producto se **releen** del `Dockerfile` de su clon (ver `elUserDeclaradoSeLeeDelClon`);
 * las de terceros llevan escrito de donde sale la cifra, porque su `Dockerfile` no esta aqui.
 */
export const IMAGEN_CON_USER_NUMERICO: Record<string, UserLeido> = {
  // Los cinco backends y sus migradores: `USER 10001` la aplicacion y `USER 10002` el migrador,
  // los dos en el mismo `backend/Dockerfile`.
  "ghcr.io/hneyra/kamayuk-rentas": { uid: 10001, dockerfile: { clon: "rentas", ruta: "backend/Dockerfile" } },
  "ghcr.io/hneyra/kamayuk-rentas-migrador": { uid: 10002, dockerfile: { clon: "rentas", ruta: "backend/Dockerfile" } },
  "ghcr.io/hneyra/kamayuk-catastro": { uid: 10001, dockerfile: { clon: "catastro", ruta: "backend/Dockerfile" } },
  "ghcr.io/hneyra/kamayuk-catastro-migrador": { uid: 10002, dockerfile: { clon: "catastro", ruta: "backend/Dockerfile" } },
  "ghcr.io/hneyra/kamayuk-normativa": { uid: 10001, dockerfile: { clon: "normativa", ruta: "backend/Dockerfile" } },
  "ghcr.io/hneyra/kamayuk-normativa-migrador": { uid: 10002, dockerfile: { clon: "normativa", ruta: "backend/Dockerfile" } },
  "ghcr.io/hneyra/kamayuk-caja": { uid: 10001, dockerfile: { clon: "caja", ruta: "backend/Dockerfile" } },
  "ghcr.io/hneyra/kamayuk-caja-migrador": { uid: 10002, dockerfile: { clon: "caja", ruta: "backend/Dockerfile" } },
  "ghcr.io/hneyra/kamayuk-identidad": { uid: 10001, dockerfile: { clon: "identidad", ruta: "backend/Dockerfile" } },
  "ghcr.io/hneyra/kamayuk-identidad-migrador": { uid: 10002, dockerfile: { clon: "identidad", ruta: "backend/Dockerfile" } },
  // Las dos interfaces: `USER 101`, el `nginx` de la imagen base, escrito por numero.
  "ghcr.io/hneyra/kamayuk-rentas-interfaz": { uid: 101, dockerfile: { clon: "rentas", ruta: "frontend/Dockerfile" } },
  "ghcr.io/hneyra/kamayuk-caja-interfaz": { uid: 101, dockerfile: { clon: "caja", ruta: "frontend/Dockerfile" } },
  // De terceros: su `Dockerfile` no esta en ningun clon, asi que la cifra va con su fuente.
  "quay.io/keycloak/keycloak": { uid: 1000, fuente: "`USER 1000` en quarkus/container/Dockerfile" },
  "grafana/grafana": { uid: 472, fuente: '`USER "$GF_UID"`, con `ARG GF_UID="472"`' },
};

/** Los contenedores que el kubelet no podria verificar: `runAsNonRoot` sin UID que lo respalde. */
export function sinUidQueElKubeletPuedaVerificar(ambiente: Environment): ContenedorDelAmbiente[] {
  return contenedoresDelAmbiente(ambiente).filter(
    (c) =>
      c.nonRoot === true &&
      c.uid === undefined &&
      IMAGEN_CON_USER_NUMERICO[sinEtiqueta(c.imagen)] === undefined,
  );
}

/** Una linea `USER …` de un `Dockerfile`, con donde esta. */
export interface UserDelDockerfile {
  clon: string;
  ruta: string;
  linea: number;
  valor: string;
}

/**
 * Todo `USER` declarado en los `Dockerfile` de los cinco clones, **en una revision**.
 *
 * De una revision de git y no del arbol de trabajo, que es la misma cautela que
 * `migracionesDe` escribio primero: en un puesto con cinco clones y varios carriles en vuelo,
 * el disco puede tener otra version, y una cifra plausible medida sobre otro arbol es peor que
 * ninguna. Por omision `origin/main`, que es lo que ese clon DECLARA hoy y lo que CI trae.
 */
export function usersDeLosClones(revision: string = REVISION_DE_REFERENCIA): UserDelDockerfile[] {
  const encontrados: UserDelDockerfile[] = [];
  for (const sistema of SISTEMAS) {
    const raiz = clonDe(sistema);
    for (const ruta of ["backend/Dockerfile", "frontend/Dockerfile"]) {
      let contenido: string;
      try {
        contenido = execFileSync("git", ["-C", raiz, "show", `${revision}:${ruta}`], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
      } catch {
        // No todos tienen interfaz: `normativa` e `identidad` no tienen `frontend/`, y eso es una
        // afirmacion suya y no un fallo. Lo que si seria un fallo es no encontrar NINGUNO, y eso
        // lo caza el centinela de la prueba.
        continue;
      }
      contenido.split("\n").forEach((l, i) => {
        const encontrado = /^\s*USER\s+(\S+)/.exec(l);
        if (encontrado?.[1] !== undefined) {
          encontrados.push({ clon: sistema.clon, ruta, linea: i + 1, valor: encontrado[1] });
        }
      });
    }
  }
  return encontrados;
}

/**
 * Los `USER` por NOMBRE que hoy hay en los clones, cada uno con el issue que lo cierra.
 *
 * **Es una lista de trabajo pendiente y no una puerta abierta**: se comprueba en las dos
 * direcciones, asi que una entrada que ya se arreglo sale roja igual que una que falta. Ninguna
 * de estas imagenes se despliega hoy; el dia que su descriptor la despliegue con `runAsNonRoot`,
 * el kubelet se negara a crear el contenedor exactamente como hizo con `espera-al-motor`.
 */
export const USER_POR_NOMBRE_PENDIENTE: Record<string, string> = {
  // La interfaz de `catastro` todavia no la despliega su descriptor (`infrastructure`#12), asi
  // que hoy no rompe nada. `rentas` y `caja` escriben `USER 101` en el mismo sitio.
  "catastro frontend/Dockerfile nginx": "hneyra/catastro: su interfaz aun no se despliega (#12)",
};
