import { createHash, randomBytes } from "node:crypto";

/**
 * La logica de `bootstrap-secretos.sh`, como funcion pura (issue #154).
 *
 * Decide que claves le faltan a un `Secret` y genera solo esas — nunca toca una que ya
 * esta, y nunca junta dos claves con el mismo valor. Vive aparte del guion de bash a
 * proposito: es la parte que puede tener un defecto sutil —una condicion de carrera al
 * decidir "esto ya existe", una clave que se sobreescribe por error— y en TypeScript
 * tiene prueba unitaria sin tocar un cluster. El CLI vive aparte, en
 * `completar-secreto-cli.ts` — el mismo motivo que separa `emitir-manifiestos.ts` de
 * `emitir.ts`: un guardia del tipo `require.main === module` no distingue ts-node de
 * vite-node, y un archivo de entrada sin guardia no tiene ese problema. Es el unico que
 * habla con `kubectl`.
 */

/** Un `Secret` de Kubernetes, en la forma minima que este modulo necesita. */
export interface SecretoExistente {
  /** Los valores YA presentes, codificados en base64 —tal como los devuelve el API—. */
  data?: Record<string, string>;
}

export interface ResultadoDeCompletar {
  /** El `data` completo: lo que ya habia, mas lo generado. Todo en base64. */
  data: Record<string, string>;
  /** Las claves que este llamado genero. Vacio si no hizo falta nada. */
  generadas: string[];
}

/**
 * Genera una clave, ya codificada para `Secret.data`.
 *
 * **No** son los 32 bytes de `crypto.randomBytes` codificados una vez: eso es lo que
 * este archivo hacia hasta que un clúster real —no un `KAMAYUK_MOTOR_MODO=local`, que
 * nunca pasa por el API de Kubernetes— lo puso en rojo (issue #157, descubierto
 * verificando `verificar-alertas.sh`/`verificar-tableros.sh` contra un `kind` real).
 * `Secret.data` documenta sus valores como base64 y Kubernetes los DECODIFICA una vez
 * al inyectarlos como variable de entorno; el kubelet le pasa ese valor al runtime de
 * contenedores por gRPC, cuyos campos `string` exigen UTF-8 valido. 32 bytes crudos de
 * `crypto.randomBytes` casi nunca lo son —comprobado: en un muestreo de 20, las 20
 * fallan—, asi que la creacion del contenedor fallaba con
 * `grpc: error while marshaling: string field contains invalid UTF-8` en cuanto un
 * pod de verdad intentaba montar esa clave, y eso no lo veia ninguna prueba que solo
 * comprobara que el `Secret` existe o que su huella no cambia.
 *
 * La clave de verdad —lo que `20-asignar-claves.sh` y compania terminan usando— es la
 * CADENA en base64 de esos 32 bytes: texto ASCII, siempre UTF-8 valido, con la misma
 * entropia. Lo que va en `Secret.data` es esa cadena codificada una vez mas, que es
 * exactamente lo que Kubernetes decodifica de vuelta.
 */
export function generadorPorOmision(): string {
  const clave = randomBytes(32).toString("base64");
  return Buffer.from(clave, "utf8").toString("base64");
}

/**
 * Completa un `Secret`: las claves de `requeridas` que no esten en `existente.data` se
 * generan con `generador`; las que ya esten, se preservan **sin decodificar** — el valor
 * base64 pasa tal cual, para no arriesgar una re-codificacion que lo cambie.
 *
 * Lanza si el `generador` produce el mismo valor dos veces en el mismo llamado: es la
 * comprobacion que pide el issue —"esa es la que hay que escribir: claves distintas,
 * comprobado"— hecha estructuralmente imposible de incumplir en silencio. Con
 * `crypto.randomBytes(32)` la probabilidad de colision es indistinguible de cero; la
 * prueba lo fuerza con un generador roto a proposito.
 */
export function completarSecreto(
  existente: SecretoExistente | undefined,
  requeridas: readonly string[],
  generador: () => string = generadorPorOmision,
): ResultadoDeCompletar {
  const data: Record<string, string> = { ...(existente?.data ?? {}) };
  const generadas: string[] = [];
  const vistos = new Set(Object.values(data));

  for (const clave of requeridas) {
    if (clave in data) continue;

    const valor = generador();
    if (vistos.has(valor)) {
      throw new Error(
        `El generador produjo un valor repetido para «${clave}». Dos claves con el ` +
          "mismo secreto anulan la separacion de privilegios entera (issue #154): si " +
          "esto ocurre con crypto.randomBytes, algo esta seriamente mal con la fuente " +
          "de aleatoriedad y no debe seguir.",
      );
    }
    vistos.add(valor);
    data[clave] = valor;
    generadas.push(clave);
  }

  return { data, generadas };
}

/** Un manifiesto de `Secret` listo para `kubectl apply -f -`. */
export function manifiestoDeSecreto(args: {
  nombre: string;
  namespace: string;
  data: Record<string, string>;
}): unknown {
  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: args.nombre, namespace: args.namespace },
    type: "Opaque",
    data: args.data,
  };
}

/**
 * Una huella de un valor, para que un guion pueda registrar "la clave X cambio" **sin
 * imprimir la clave**. `sha256` corto: alcanza para distinguir un valor de otro en un
 * registro, y no alcanza para reconstruirlo.
 */
export function huella(valorBase64: string): string {
  return createHash("sha256").update(valorBase64, "base64").digest("hex").slice(0, 12);
}
