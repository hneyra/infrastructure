import { auditarManifiestos, describirAuditoria } from "../auditoria";
import { construirManifiestos } from "../componentes";
import { componerOFallar } from "../descriptor";
import { entornoPara } from "../descriptor/entorno";
import { SISTEMAS } from "../descriptor/sistemas";
import { secretos } from "../componentes/convenciones";
import { namespaceName, ENVIRONMENTS, type Environment } from "../config";
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

export function emitir(opciones: Opciones): string {
  const ambiente = opciones.ambiente;
  const invariantes = invariantesDe(ambiente);
  const plataforma = construirManifiestos(invariantes);

  // Y los cuatro sistemas (ADR-0031 §2). `componerOFallar` los audita con las MISMAS reglas
  // que la plataforma y lanza antes de emitir nada: un descriptor ajeno mal formado no puede
  // entrar por ser ajeno.
  const deLosSistemas = componerOFallar(SISTEMAS, entornoPara(ambiente, invariantes.ingress.domain, invariantes.application.bootstrapVersion, invariantes.operacion), {
    secretoDeOwner: secretos(ambiente).owner,
    basesDelClustre: SISTEMAS.map((s) => s.descriptor.baseDeDatos(
      entornoPara(ambiente, invariantes.ingress.domain, invariantes.application.bootstrapVersion, invariantes.operacion)(s.descriptor.sistema)).nombre),
    manifiestosDeLaPlataforma: plataforma,
  });

  const todos = [...plataforma, ...deLosSistemas];

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
