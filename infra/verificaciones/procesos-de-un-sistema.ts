import type { Contenedor, EspecificacionDePod, Manifiesto } from "../componentes/tipos";
import { contenedoresDe, podsDe } from "../componentes/tipos";

/**
 * **No todo contenedor del espacio de nombres de un sistema corre su backend.**
 *
 * Hasta que `caja` estreno su interfaz de ventanilla (#16, #17) esto era cierto por accidente:
 * cada sistema publicaba DOS imagenes del mismo arbol de fuentes —`aplicacion` y `migrador`—, y
 * las dos son el mismo jar de Spring. Cuatro guardas se apoyaron en esa coincidencia sin
 * decirlo, y con la interfaz dentro **las cuatro se rompen a la vez y por la misma causa**:
 * miden un contenedor de nginx con la vara de Spring.
 *
 * Y no se rompen dando un rojo raro, que seria lo de menos. Dan un rojo que **acusa al
 * repositorio equivocado**:
 *
 *   - `sondas-contra-la-cadena` dice que la sonda `/` de nginx no la atiende `SeguridadWeb`.
 *     Claro que no: `SeguridadWeb` es la cadena del backend, y nginx no la tiene;
 *   - `C-17 §5` lee `SPRING_PROFILES_ACTIVE` del contenedor de nginx, no lo encuentra, y trata
 *     ese `undefined` como «un perfil que termina» —o sea, denuncia un `CrashLoopBackOff`
 *     garantizado sobre un proceso que no es de Spring—;
 *   - y `compose-de-los-sistemas` se planta al encontrar dos contenedores donde emparejaba uno.
 *
 * La distincion se **deriva de la imagen**, no de una lista. Un sistema publica su jar bajo dos
 * nombres —`kamayuk-<sistema>` y `kamayuk-<sistema>-migrador`, separados porque las credenciales
 * son distintas (C-14 §1)— y todo lo demas que declare su descriptor es otro proceso, con sus
 * propias reglas.
 *
 * **Y la comprobacion es positiva a proposito**: se pregunta «¿corre el jar?» y no «¿es la
 * interfaz?». Un sidecar nuevo —una cache, un exportador— entraria como «otro proceso» y
 * quedaria fuera de las reglas de Spring, que es lo correcto; con la pregunta al reves entraria
 * como backend y se medaria con una vara que no es la suya, en silencio.
 */
export function correElBackend(sistema: string, c: Contenedor): boolean {
  const repositorio = c.image.split(":")[0] ?? "";
  return (
    repositorio.endsWith(`/kamayuk-${sistema}`) ||
    repositorio.endsWith(`/kamayuk-${sistema}-migrador`)
  );
}

/** Los contenedores de un pod que corren el jar del sistema. */
export function contenedoresDelBackend(sistema: string, pod: EspecificacionDePod): Contenedor[] {
  return contenedoresDe(pod).filter((c) => correElBackend(sistema, c));
}

/**
 * Y los que NO, que es la mitad que no se puede dejar sin mirar.
 *
 * Separar sin mas seria el defecto de C-15/C-16 —una guarda que deja de mirar y sigue verde—,
 * asi que quien llama a esto tiene que medir estos con SU regla, no saltarselos.
 */
export function contenedoresQueNoSonElBackend(
  sistema: string,
  pod: EspecificacionDePod,
): Contenedor[] {
  return contenedoresDe(pod).filter((c) => !correElBackend(sistema, c));
}

/** Todo contenedor de un sistema, con el manifiesto y el pod donde vive. */
export function contenedoresDelSistema(
  manifiestos: Manifiesto[],
): { m: Manifiesto; contexto: string; pod: EspecificacionDePod; c: Contenedor }[] {
  const todos: { m: Manifiesto; contexto: string; pod: EspecificacionDePod; c: Contenedor }[] = [];
  for (const m of manifiestos) {
    for (const { contexto, pod } of podsDe(m)) {
      for (const c of contenedoresDe(pod)) todos.push({ m, contexto, pod, c });
    }
  }
  return todos;
}
