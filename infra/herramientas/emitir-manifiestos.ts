import { auditarManifiestos, describirAuditoria } from "../auditoria";
import { construirManifiestos } from "../componentes";
import { componerOFallar } from "../descriptor";
import { entornoPara } from "../descriptor/entorno";
import { SISTEMAS } from "../descriptor/sistemas";
import { secretos } from "../componentes/convenciones";
import {
  claveDeVersion,
  namespaceName,
  ENVIRONMENTS,
  type Environment,
  type Invariants,
} from "../config";
import type { Manifiesto } from "../componentes/tipos";
import { invariantesDe } from "../verificaciones/stacks";

/**
 * Escribe los manifiestos de un ambiente por la salida estandar, en JSON.
 *
 * ```
 *   yarn manifiestos --ambiente stg                  # todo
 *   yarn manifiestos --ambiente stg --componente postgres
 * ```
 *
 * Existe para dos cosas concretas, y ninguna es «ver el YAML»:
 *
 * 1. **Verificar el motor de verdad**, sin clúster: `verificaciones/motor/` saca de aqui
 *    los tres guiones de inicializacion —los mismos, byte a byte, que se montarian en
 *    k3s— y levanta con ellos un PostgreSQL en Docker para ejecutar contra el la prueba
 *    de aislamiento. Es la mitad de la verificacion que no necesita Kubernetes.
 * 2. **Validar los manifiestos contra el API de Kubernetes** con `kubectl apply
 *    --dry-run=server`, que es lo unico que comprueba de verdad que el esquema encaja.
 *
 * Sale JSON y no YAML, y no por comodidad: `kubectl apply -f` acepta JSON, y asi no hace
 * falta traer un serializador de YAML solo para esto. Un `List` de Kubernetes es
 * exactamente lo que `kubectl` espera de un archivo con varios objetos.
 *
 * **No lee el estado de Pulumi ni habla con el clúster**: solo con los
 * `Pulumi.<ambiente>.yaml` versionados, igual que las pruebas.
 */

interface Opciones {
  ambiente: Environment;
  componente?: string;
}

export function leerOpciones(argv: string[]): Opciones {
  const valor = (nombre: string): string | undefined => {
    const i = argv.indexOf(`--${nombre}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const ambiente = valor("ambiente");
  if (ambiente === undefined || !ENVIRONMENTS.includes(ambiente as Environment)) {
    throw new Error(
      `Falta \`--ambiente\` o no es uno de los dos: ${ENVIRONMENTS.join(", ")}. ` +
        "Local no es un stack: es `despliegue/compose.yaml` (ADR-0011 §4).",
    );
  }

  const componente = valor("componente");
  return componente === undefined
    ? { ambiente: ambiente as Environment }
    : { ambiente: ambiente as Environment, componente };
}

/**
 * La version que le toca a cada sistema, o el fallo que dice cual falta.
 *
 * No se replieg a `applicationBootstrapVersion` cuando no hay ninguna declarada, y ese es el
 * punto: esa version es la del MONOLITO —un `sha` de `sgtm`— y usarla para etiquetar
 * `kamayuk-catastro` produce una referencia que no resuelve contra ningun `git log` de
 * `catastro`. El repliegue seria ademas invisible: el manifiesto sale, es valido, el planificador
 * ubica el pod, y el fallo aparece como `ImagePullBackOff` cuando ya se desplego.
 */
function versionDelSistema(invariantes: Invariants): (sistema: string) => string {
  return (sistema) => {
    const version = invariantes.sistemas.versiones[sistema];
    if (version === undefined) {
      throw new Error(
        `El ambiente «${invariantes.environment}» compone el sistema «${sistema}» y su stack no ` +
          `declara \`kamayuk:${claveDeVersion(sistema)}\`, asi que no hay con que etiquetar sus ` +
          "imagenes.\n" +
          "  No se hereda ninguna otra: `applicationBootstrapVersion` es la version del " +
          "monolito, un `sha` de `sgtm`, y con ella la etiqueta no resolveria contra el `git " +
          `log\` de hneyra/${sistema} — y probablemente no existiria en el registro.\n` +
          `  Remedio: declarar \`kamayuk:${claveDeVersion(sistema)}\` con un \`sha\` de main de ` +
          `hneyra/${sistema} cuyas imagenes haya publicado \`publicar-imagenes.yml\`.`,
      );
    }
    return version;
  };
}

/**
 * El entorno que reciben los cuatro descriptores de este ambiente.
 *
 * Exportado porque lo usan tanto `emitir` como `capacidad.ts`: los dos tienen que mirar los
 * MISMOS manifiestos, y una segunda composicion del entorno seria un segundo sitio donde olvidar
 * un campo.
 */
export function entornoDelAmbiente(invariantes: Invariants) {
  return entornoPara(
    invariantes.environment,
    invariantes.ingress.domain,
    versionDelSistema(invariantes),
    invariantes.operacion,
    { ...invariantes.implantacion, esDemostracion: invariantes.application.isDemonstration },
    invariantes.identity.realm,
  );
}

/**
 * Los manifiestos de los cuatro sistemas, ya auditados.
 *
 * Separado de `emitir` para que se puedan sumar sin pasar por el JSON. Quien pregunta «¿cabe?»
 * no llama a esto sino a `manifiestosDelAmbiente`, que es la lista entera: separarlos aqui es lo
 * que dejo a `herramientas/capacidad.ts` midiendo solo la plataforma durante C-14 y C-16.
 *
 * Recibe `Invariants` y no un `Environment` a proposito: `index.ts` corre dentro de Pulumi y ya
 * tiene su configuracion cargada (`loadSettings()`). Con un `Environment` habria que volver a
 * leer el `Pulumi.<ambiente>.yaml` desde dentro del programa, y entonces habria dos lecturas de
 * la misma configuracion que se pueden separar.
 */
export function manifiestosDeLosSistemas(
  invariantes: Invariants,
  plataforma: Manifiesto[],
): Manifiesto[] {
  const entornoDe = entornoDelAmbiente(invariantes);
  return componerOFallar(SISTEMAS, entornoDe, {
    secretoDeOwner: secretos(invariantes.environment).owner,
    basesDelClustre: SISTEMAS.map(
      (s) => s.descriptor.baseDeDatos(entornoDe(s.descriptor.sistema)).nombre,
    ),
    manifiestosDeLaPlataforma: plataforma,
  });
}

/**
 * **Todo lo que este ambiente pone sobre el nodo**: la plataforma y los cuatro sistemas.
 *
 * Una sola funcion, y no una lista que cada herramienta se compone por su cuenta. C-16 se
 * pago por eso: `manifiestosDeLosSistemas` se extrajo en C-14 «para que `capacidad.ts` pueda
 * sumarlos», y `herramientas/capacidad.ts` nunca se cambio — siguio llamando a
 * `construirManifiestos` a secas. El resultado es una guarda que contesta «cabe» habiendo
 * mirado **un** espacio de nombres de los cinco, y decir «cabe» cuando no se cabe es la
 * direccion peligrosa: devuelve exactamente el colgado del issue #252, en silencio, con la
 * comprobacion en verde.
 *
 * El nodo es **uno**. Los cuatro sistemas tienen namespace propio desde ADR-0031, pero un
 * namespace no es una maquina: sus pods compiten por la misma CPU y la misma memoria que los
 * de la plataforma. Cualquiera que pregunte «¿cabe?» tiene que sumar los cinco.
 */
export function manifiestosDelAmbiente(invariantes: Invariants): Manifiesto[] {
  const plataforma = construirManifiestos(invariantes);
  // Los cuatro sistemas (ADR-0031 §2). `componerOFallar` los audita con las MISMAS reglas que
  // la plataforma y lanza antes de emitir nada: un descriptor ajeno mal formado no puede entrar
  // por ser ajeno.
  return [...plataforma, ...manifiestosDeLosSistemas(invariantes, plataforma)];
}

export function emitir(opciones: Opciones): string {
  const ambiente = opciones.ambiente;
  const invariantes = invariantesDe(ambiente);
  const plataforma = construirManifiestos(invariantes);
  const todos = manifiestosDelAmbiente(invariantes);

  // Se audita SIEMPRE, aunque se emita un componente: un manifiesto que incumple no se copia a
  // un archivo para aplicarlo a mano. Lo que se audita aqui es la PLATAFORMA; los cuatro
  // sistemas ya pasaron por `componerOFallar` arriba, cada uno **contra su propio namespace**
  // —uno por sistema y por ambiente—, que es lo que permite escribir las politicas de red de
  // cada uno sin mirar a los demas. Auditarlos aqui otra vez los mediria contra el namespace de
  // la plataforma y los rechazaria a todos por estar donde tienen que estar.
  const problemas = auditarManifiestos(plataforma, {
    secretoDeOwner: secretos(ambiente).owner,
    namespace: namespaceName(ambiente),
  });
  if (problemas.length > 0) {
    throw new Error(describirAuditoria(ambiente, problemas));
  }

  const items =
    opciones.componente === undefined
      ? todos
      : todos.filter((m) => m.metadata.labels?.["componente"] === opciones.componente);

  if (items.length === 0) {
    throw new Error(
      `Ningun manifiesto lleva la etiqueta «componente: ${opciones.componente ?? ""}». ` +
        `Las que hay: ${[...new Set(todos.map((m) => m.metadata.labels?.["componente"]))].join(", ")}.`,
    );
  }

  return JSON.stringify({ apiVersion: "v1", kind: "List", items }, null, 2);
}
