/**
 * Lo que un descriptor NO puede hacer, verificado leyendo lo que devuelve.
 *
 * ## El punto entero del diseno
 *
 * **Las convenciones de `INF-01` §4 que `auditoria.ts` aplica a los componentes propios
 * se aplican IGUAL a los descriptores ajenos.** No es una comprobacion parecida escrita
 * dos veces: `auditarDescriptor` llama a `auditarManifiestos`, el mismo que audita
 * `BaseDeDatos.ts` o `Ingreso.ts`. Si manana alguien endurece una sonda alli, el
 * descriptor de `catastro` la cumple sin que nadie lo avise.
 *
 * Sobre eso, cinco prohibiciones que solo existen porque ahora hay una frontera:
 *
 *   (a) declarar una ruta fuera de su prefijo;
 *   (b) declarar la etiqueta de la imagen;
 *   (c) pedir privilegios sobre la base de otro sistema;
 *   (d) un Deployment sin limites de recursos o sin sondas;
 *   (e) un Secret en claro.
 *
 * La (d) es la que enseña como esta montado esto: **no se implementa aqui**. La hace
 * `auditarManifiestos`, y lo unico que este archivo aporta es llamarlo. Escribirla otra
 * vez seria dos definiciones de «limites de recursos» envejeciendo aparte, que es lo que
 * este repositorio evita en todas partes.
 *
 * Y la (b) es la que sostiene todo lo demas. Si la etiqueta de la imagen entra en el
 * descriptor, entra en el estado de Pulumi: cada liberacion vuelve a ser un `pulumi up`,
 * cada reversion tambien, y componer aqui pasa de ser barato a ser el cuello de botella
 * que ADR-0029 venia a quitar. Por eso su mensaje es el mas largo de los cinco.
 *
 * Devuelve la lista de incumplimientos; vacia significa admisible. Pura, como todo lo
 * demas de esta carpeta.
 */

import { auditarManifiestos } from "../auditoria";
import { contenedoresDe, podsDe, type Manifiesto } from "../componentes/tipos";
import {
  manifiestosDe,
  type DescriptorDeSistema,
  type EntornoDelDescriptor,
} from "./tipos";

/** Lo que `infrastructure` sabe y el descriptor no: quien mas hay, y donde esta el owner. */
export interface ContextoDeDescriptores {
  /** El `Secret` con la clave de `kamayuk_owner`, para la auditoria heredada. */
  readonly secretoDeOwner: string;
  /** Las bases de TODOS los sistemas. Sin esto, (c) no se puede comprobar. */
  readonly basesDelClustre: readonly string[];
  /**
   * Los manifiestos de la plataforma, y no son un adorno: **un descriptor no se puede
   * auditar solo**.
   *
   * Lo destapo escribir la primera muestra valida. `auditarPrioridades` comprueba que la
   * `priorityClassName` de cada pod corresponda a una `PriorityClass` **del manifiesto**,
   * y las `PriorityClass` son de alcance de clúster: las crea `infrastructure`, no el
   * sistema. Auditado por su cuenta, cualquier descriptor correcto sale rojo por dos
   * clases que no le toca definir.
   *
   * Asi que lo que se audita es la union, y lo que se le imputa al descriptor es el
   * **delta**: los problemas que aparecen al anadirlo y no estaban antes. Es tambien lo
   * que ocurre de verdad al desplegar —`index.ts` compone plataforma y sistemas y audita
   * el conjunto—, asi que la auditoria del PR y la del `up` miran lo mismo.
   */
  readonly manifiestosDeLaPlataforma: readonly Manifiesto[];
}

export function auditarDescriptor(
  d: DescriptorDeSistema,
  entorno: EntornoDelDescriptor,
  contexto: ContextoDeDescriptores,
): string[] {
  const manifiestos = manifiestosDe(d, entorno);
  const heredada = { secretoDeOwner: contexto.secretoDeOwner, namespace: entorno.namespace };
  const soloPlataforma = new Set(
    auditarManifiestos([...contexto.manifiestosDeLaPlataforma], heredada),
  );
  return [
    // (d), y las demas convenciones de INF-01 §4: NO se reescriben, se heredan. Lo que se
    // le imputa al descriptor es lo que aparece al anadirlo y no estaba antes.
    ...auditarManifiestos([...contexto.manifiestosDeLaPlataforma, ...manifiestos], heredada)
      .filter((p) => !soloPlataforma.has(p))
      .map((p) => `[${d.sistema}] ${p}`),
    ...auditarPrefijo(d, entorno, manifiestos),
    ...auditarEtiquetaDeImagen(d, entorno, manifiestos),
    ...auditarBaseAjena(d, entorno, contexto),
    ...auditarSecretoEnClaro(d, entorno, manifiestos),
  ];
}

/** Toda ruta de un `IngressRoute` que un `PathPrefix` nombra. */
function prefijosDe(m: Manifiesto): string[] {
  if (m.kind !== "IngressRoute") return [];
  const rutas: string[] = [];
  for (const r of m.spec.routes) {
    for (const encaje of r.match.matchAll(/PathPrefix\(`([^`]*)`\)/g)) {
      const ruta = encaje[1];
      if (ruta !== undefined) rutas.push(ruta);
    }
  }
  return rutas;
}

/**
 * (a) Una ruta fuera de su prefijo.
 *
 * `catastro` solo puede reclamar `catastro/...`. No es una convencion de nombres: el
 * enrutado por prefijo es lo que decide **quien responde a que** (ADR-0030 §2), y un
 * sistema que reclama el prefijo de otro no da un error — se lo queda, y las peticiones
 * dejan de llegar a su dueno sin que nada se ponga rojo.
 */
function auditarPrefijo(
  d: DescriptorDeSistema,
  entorno: EntornoDelDescriptor,
  manifiestos: Manifiesto[],
): string[] {
  const suyo = `/${d.prefijo}`;
  const problemas: string[] = [];
  for (const m of manifiestos) {
    for (const ruta of prefijosDe(m)) {
      if (ruta !== suyo && !ruta.startsWith(`${suyo}/`)) {
        problemas.push(
          `[${d.sistema}] IngressRoute/${m.metadata.name} reclama «${ruta}», que esta fuera de ` +
            `su prefijo «${suyo}». El enrutado por prefijo decide quien responde a que ` +
            "(ADR-0030 §2): un sistema que reclama el de otro no falla, se lo queda, y las " +
            "peticiones dejan de llegar a su dueno sin que nada se ponga rojo.",
        );
      }
    }
  }
  void entorno;
  return problemas;
}

/**
 * (b) Declarar la etiqueta de la imagen.
 *
 * Se comprueba por igualdad contra lo que `entorno.imagenDe()` produce para los nombres
 * que el propio descriptor declara. No se busca un patron de version: eso dejaria pasar
 * `:v2` y se pelearia con cada formato nuevo. Lo que se exige es que la referencia sea
 * **exactamente** una de las que `infrastructure` compuso.
 */
function auditarEtiquetaDeImagen(
  d: DescriptorDeSistema,
  entorno: EntornoDelDescriptor,
  manifiestos: Manifiesto[],
): string[] {
  const admisibles = new Set(d.imagenes.map((n) => entorno.imagenDe(n)));
  const problemas: string[] = [];
  for (const m of manifiestos) {
    for (const { contexto: donde, pod } of podsDe(m)) {
      for (const c of contenedoresDe(pod)) {
        if (!admisibles.has(c.image)) {
          problemas.push(
            `[${d.sistema}] ${donde}, contenedor «${c.name}»: la imagen «${c.image}» no sale de ` +
              "`entorno.imagenDe()`. **La etiqueta la pone `infrastructure`, nunca el " +
              "descriptor** (ADR-0011 §5). Es la prohibicion que sostiene a las otras cuatro: " +
              "si la etiqueta entra en el descriptor entra en el estado de Pulumi, y entonces " +
              "cada liberacion vuelve a ser un `pulumi up`, cada reversion tambien, y componer " +
              "aqui pasa de ser barato a ser el cuello de botella que la separacion venia a " +
              `quitar. Admisibles: ${[...admisibles].join(", ") || "(ninguna: declara `imagenes`)"}.`,
          );
        }
      }
    }
  }
  return problemas;
}

/**
 * (c) Pedir privilegios sobre la base de otro sistema.
 *
 * Un sistema declara **su** base y los roles que la usan. Que `catastro` pida `SELECT`
 * sobre la base de `rentas` es una base compartida disfrazada —lo que ADR-0029 descarta
 * como «lo peor de los dos mundos»— y ademas convierte el aislamiento entre
 * municipalidades en una promesa: la politica de RLS de `rentas` no sabe nada de una
 * conexion abierta por otro sistema.
 */
function auditarBaseAjena(
  d: DescriptorDeSistema,
  entorno: EntornoDelDescriptor,
  contexto: ContextoDeDescriptores,
): string[] {
  const base = d.baseDeDatos(entorno);
  const problemas: string[] = [];
  for (const rol of base.roles) {
    for (const sobre of rol.sobre) {
      if (sobre === base.nombre) continue;
      const ajena = contexto.basesDelClustre.includes(sobre) ? "de otro sistema" : "que no es la suya";
      problemas.push(
        `[${d.sistema}] el rol «${rol.nombre}» pide privilegios sobre la base «${sobre}», ` +
          `${ajena}. Un descriptor declara SU base y nada mas: leer la de otro sistema es una ` +
          "base compartida disfrazada (ADR-0029), y deja el aislamiento entre municipalidades " +
          "en una promesa, porque la politica de RLS del dueno no sabe nada de una conexion " +
          `abierta desde fuera. La suya es «${base.nombre}».`,
      );
    }
    if (rol.superusuario !== false) {
      problemas.push(
        `[${d.sistema}] el rol «${rol.nombre}» se declara superusuario. Un superusuario OMITE ` +
          "RLS incluso con FORCE ROW LEVEL SECURITY (DAT-01 §0, hallazgo 1): con el, el " +
          "aislamiento entre municipalidades deja de existir y ninguna prueba lo nota.",
      );
    }
  }
  return problemas;
}

/**
 * (e) Un `Secret` en claro.
 *
 * Dos formas, y las dos se leen del descriptor: emitir un manifiesto `Secret` con datos
 * dentro, y traer el valor en el inventario de claves, que es de metadatos.
 *
 * Se mira a traves de una vista ensanchada y no del tipo estrecho, por lo mismo que
 * `auditarIngreso` en `auditoria.ts`: `Manifiesto` no incluye `Secret`, asi que
 * TypeScript sabe que la comparacion es imposible y la rechazaria. Lo que la auditoria
 * tiene que cazar es justamente al que llega por un `as`.
 */
function auditarSecretoEnClaro(
  d: DescriptorDeSistema,
  entorno: EntornoDelDescriptor,
  manifiestos: Manifiesto[],
): string[] {
  const problemas: string[] = [];
  for (const m of manifiestos as unknown as { kind: string; metadata: { name: string } }[]) {
    if (m.kind === "Secret") {
      problemas.push(
        `[${d.sistema}] Secret/${m.metadata.name}: un descriptor no emite Secrets. Ninguna clave ` +
          "de la aplicacion vive en el estado de Pulumi (ADR-0011 §3, INF-06): se declaran en " +
          "`claves()` como metadatos y las pone `bootstrap-secretos.sh` hablando con el API de " +
          "Kubernetes. Un `Secret` aqui acaba en el estado, y el estado se lee.",
      );
    }
  }
  for (const c of d.claves(entorno) as unknown as Record<string, unknown>[]) {
    for (const campo of ["valor", "value", "data", "stringData", "password", "clave_secreta"]) {
      if (c[campo] !== undefined) {
        problemas.push(
          `[${d.sistema}] la clave «${String(c["nombre"])}» del inventario trae «${campo}». El ` +
            "inventario es de METADATOS —nombre, clave, rol, periodicidad—, nunca un valor " +
            "(INF-06). Un valor aqui viaja al repositorio, al registro del build y al estado.",
        );
      }
    }
  }
  return problemas;
}

/** El mensaje que `index.ts` lanza. Nombra el sistema, para saber a quien reclamar. */
export function describirAuditoriaDeDescriptores(problemas: string[]): string {
  return (
    `La auditoria rechazo ${problemas.length} cosa(s) de los descriptores de sistema.\n\n` +
    problemas.map((p) => `  - ${p}`).join("\n\n") +
    "\n\nNo se aplica nada. Un `up` que falla al principio es mejor que uno que deja el " +
    "ingreso a medias, y un descriptor ajeno mal formado no puede entrar por ser ajeno: las " +
    "convenciones de INF-01 §4 valen igual para los cuatro sistemas que para esta carpeta."
  );
}
