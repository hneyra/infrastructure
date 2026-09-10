import type { Contenedor, Manifiesto } from "../componentes/tipos";
import { contenedoresDe } from "../componentes/tipos";
import { SISTEMAS_DEL_PRODUCTO } from "../componentes/convenciones";
import { namespaceDelSistema } from "../descriptor/entorno";
import { manifiestosDelAmbiente } from "../herramientas/emitir-manifiestos";
import type { Environment } from "../config";
import { invariantesDe } from "./stacks";
import {
  IDENTIDAD,
  credencialesDeServicio,
  serviciosDeclarados,
  ubigeosDeclarados,
  type CredencialDeServicio,
  type ServicioDeclarado,
} from "./identidad-de-servicio";

/**
 * AC-3 de `identidad`#4 (etapa 4 de #52, ADR-0039) — **el consumidor de la autorizacion CORRE**,
 * y son tres mitades porque cualquiera sola lo apaga en silencio.
 *
 * ## El defecto que existe para impedir
 *
 * Desde la etapa 4 la autorizacion vive en `identidad` y cada uno de los otros cuatro la LEE de
 * su copia local, que un `CronJob` suyo rellena cada cinco minutos desde el buzon
 * (`GET /identidad/api/v1/eventos/pendientes` + acuse). El guardia no cambia y sigue mirando su
 * base, asi que **un consumidor que no corre no da ningun error**: el sistema arranca, contesta, y
 * autoriza con la copia de ayer. Un permiso concedido en `identidad` no llega, una revocacion
 * tampoco, y el sintoma es «a esta cuenta le quitaron el permiso y lo conserva en tres de los
 * cinco» — exactamente lo que ADR-0039 §«Lo que cuesta» punto 2 llama la ventana de
 * inconsistencia, sin ventana: para siempre.
 *
 * Y hay TRES formas de que no corra, medidas ya en este repositorio sobre el ingestor de
 * `catastro` (#21):
 *
 *   1. **no existe**: el descriptor no declara el `CronJob` (C-8 hueco 1, «el `CronJob` del
 *      emisor y del ingestor no estaba desplegado»);
 *   2. **nace `suspend: true`**: existe y no corre, y un `suspend` no dice nada —se lee igual que
 *      «esto todavia no toca»— (C-8 lo puso, y dos guardas lo DEMANDABAN hasta #21 AC-4);
 *   3. **su credencial no tiene cuenta**: el pod arranca, pide un token con una clave que ningun
 *      emisor conoce y recibe 401 en la primera llamada — «cero eventos pendientes» y «no me deja
 *      preguntar» se ven igual desde fuera (#21, `identidad-de-servicio`).
 *
 * ## Que es un consumidor, y por que NO es un nombre
 *
 * Se reconoce por **lo que lo hace consumidor**: un `CronJob` de un sistema que no es `identidad`
 * cuyo pod declara una variable con una direccion **al namespace del sistema `identidad`**. La
 * direccion se compone con `namespaceDe("identidad")` en los cuatro descriptores (AC-2 del issue),
 * y aqui se lee con la MISMA convencion (`namespaceDelSistema`): un nombre de `CronJob` escrito
 * a mano —`kamayuk-<s>-consumidor`— seria un segundo sitio con la misma verdad, y el que se
 * quedaria viejo. Y su credencial se reconoce por el `secretKeyRef` a `e.secretoDe("identidad")`,
 * que es `kamayuk-<sistema>-<ambiente>-identidad` por la misma convencion de `entorno.ts`.
 *
 * Cuidado con el nombre: `KAMAYUK_<S>_IDENTIDAD_TOKEN` es el punto de emision de **Keycloak**, que
 * en la plataforma se llama tambien `identidad`. Lo que separa al consumidor del ingestor de
 * `rentas` o del publicador de `caja` —que tambien piden token— no es esa variable sino la
 * direccion al namespace `kamayuk-identidad-<amb>`, que solo ocupa el SISTEMA.
 *
 * ## Por que la lista de consumidores se DERIVA
 *
 * Son `SISTEMAS_DEL_PRODUCTO` menos el dueno. Escrita a mano, el sexto sistema que entre al
 * producto nacera sin consumidor y sin que nada lo diga; derivada, nace en rojo aqui hasta que su
 * descriptor declare el suyo. Y si la derivacion diera cero, esto no mide nada y lo dice.
 */

/** El sistema dueno de la autorizacion (ADR-0039). Los demas la consumen. */
export const DUENO_DE_LA_AUTORIZACION = "identidad";

/** Los sistemas que tienen que correr un consumidor: todos los del producto menos el dueno. */
export function consumidoresDeLaAutorizacion(): string[] {
  const consumidores = SISTEMAS_DEL_PRODUCTO.filter((s) => s !== DUENO_DE_LA_AUTORIZACION);
  if (consumidores.length === 0) {
    throw new Error(
      "SISTEMAS_DEL_PRODUCTO no tiene ningun sistema aparte de «identidad»: la lista de " +
        "consumidores esta vacia y todo lo que esta guarda afirma seria cierto sobre el conjunto " +
        "vacio. No se da por bueno: no midio nada.",
    );
  }
  return consumidores;
}

/** Lo que de un `CronJob` hace falta para decir si consume, y si corre. */
export interface ConsumidorEncontrado {
  /** El sistema al que pertenece, resuelto de su namespace y no de una etiqueta. */
  readonly sistema: string;
  readonly nombre: string;
  readonly espacio: string;
  /** `spec.suspend === true`: existe y no corre. */
  readonly suspendido: boolean;
  /** Los `Secret` que sus contenedores montan por `secretKeyRef`. */
  readonly secretos: readonly string[];
  /** La variable que lo delata: la direccion al namespace del dueno. */
  readonly direccion: string;
}

/** El namespace del sistema dueno en un ambiente, compuesto con la convencion de `entorno.ts`. */
export function namespaceDelDueno(ambiente: Environment): string {
  return namespaceDelSistema(ambiente, DUENO_DE_LA_AUTORIZACION);
}

/** El `Secret` con que un sistema pide su token para hablar con el dueno (`e.secretoDe("identidad")`). */
export function secretoDelConsumidor(sistema: string, ambiente: Environment): string {
  return `kamayuk-${sistema}-${ambiente}-${DUENO_DE_LA_AUTORIZACION}`;
}

const podDelCronJob = (m: Manifiesto) =>
  m.kind === "CronJob" ? m.spec.jobTemplate.spec.template.spec : undefined;

/** La primera variable de un contenedor cuyo VALOR nombra el namespace del dueno. */
function direccionAlDueno(c: Contenedor, namespace: string): string | undefined {
  // `.<namespace>` y no el namespace a secas: `kamayuk-identidad-stg` es tambien el prefijo de
  // nada, pero una direccion de servicio lo lleva detras de un punto (`<servicio>.<namespace>`),
  // y lo que se busca es una direccion, no una mencion.
  return (c.env ?? []).find((v) => (v.value ?? "").includes(`.${namespace}`))?.value;
}

/**
 * Los `CronJob` de un juego de manifiestos que consumen la autorizacion, por su forma.
 *
 * Un `Job` no cuenta: corre una vez y la copia local se queda como estaba cinco minutos despues.
 * Un `Deployment` tampoco: en los cuatro backends no hay un solo `@EnableScheduling`, asi que un
 * proceso web no consume nada aunque tenga la direccion (lo mide el issue).
 */
export function consumidoresEn(
  manifiestos: readonly Manifiesto[],
  ambiente: Environment,
): ConsumidorEncontrado[] {
  const dueno = namespaceDelDueno(ambiente);
  const sistemaDelNamespace = new Map(
    SISTEMAS_DEL_PRODUCTO.map((s) => [namespaceDelSistema(ambiente, s), s]),
  );
  const encontrados: ConsumidorEncontrado[] = [];
  for (const m of manifiestos) {
    const pod = podDelCronJob(m);
    if (pod === undefined || m.kind !== "CronJob") continue;
    // Un CronJob sin namespace no es de ningun sistema: los cinco los emiten en el suyo.
    const espacio = m.metadata.namespace ?? "";
    if (espacio === "" || espacio === dueno) continue;
    const contenedores = contenedoresDe(pod);
    const direccion = contenedores
      .map((c) => direccionAlDueno(c, dueno))
      .find((d): d is string => d !== undefined);
    if (direccion === undefined) continue;
    encontrados.push({
      sistema: sistemaDelNamespace.get(espacio) ?? `(ningun sistema tiene el namespace «${espacio}»)`,
      nombre: m.metadata.name,
      espacio,
      suspendido: m.spec.suspend === true,
      secretos: [
        ...new Set(
          contenedores
            .flatMap((c) => c.env ?? [])
            .map((v) => v.valueFrom?.secretKeyRef.name)
            .filter((n): n is string => n !== undefined),
        ),
      ],
      direccion,
    });
  }
  return encontrados.sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/** Lo que hace falta para decidir, separado de donde se lee para poder fabricarlo. */
export interface LoQueSeMira {
  readonly ambiente: Environment;
  readonly manifiestos: readonly Manifiesto[];
  /** Los sistemas que tienen que correr un consumidor. */
  readonly consumidores: readonly string[];
  /** Las credenciales de emisor que los descriptores piden (`claves(e)` con `emisor`). */
  readonly credenciales: readonly CredencialDeServicio[];
  /** Las cuentas de servicio declaradas en la identidad declarativa. */
  readonly servicios: readonly ServicioDeclarado[];
  /** Los ubigeos declarados. */
  readonly ubigeos: readonly string[];
}

/**
 * Las tres mitades, en frases listas para leer. Vacio es «los cuatro corren».
 *
 * Cada frase dice el sistema, lo que le falta y lo que cuesta, porque un hallazgo que no dice el
 * remedio obliga a quien lo recibe a repetir el analisis que esta guarda acaba de hacer.
 */
export function hallazgos(mira: LoQueSeMira): string[] {
  if (mira.consumidores.length === 0) {
    throw new Error(
      "La lista de consumidores esta vacia: esta guarda se cumpliria sola sobre el conjunto " +
        "vacio. No midio nada, que NO es lo mismo que «los cuatro corren».",
    );
  }
  if (mira.ubigeos.length === 0) {
    throw new Error(
      "No hay ningun ubigeo declarado en la identidad declarativa: la tercera mitad —que la " +
        "credencial tenga su cuenta en cada municipalidad— se cumpliria sobre el conjunto vacio.",
    );
  }
  const salida: string[] = [];
  const encontrados = consumidoresEn(mira.manifiestos, mira.ambiente);
  const dueno = namespaceDelDueno(mira.ambiente);

  for (const sistema of mira.consumidores) {
    const suyos = encontrados.filter((e) => e.sistema === sistema);

    // (1) existe
    if (suyos.length === 0) {
      salida.push(
        `«${sistema}» no declara en «${mira.ambiente}» ningun CronJob que hable con «${dueno}»: ` +
          "el consumidor de la autorizacion NO EXISTE. Su copia local de usuario/grupo/miembro/" +
          "permiso se queda como la dejo la implantacion, y el guardia autoriza con ella para " +
          "siempre: un permiso concedido en `identidad` no llega, y una revocacion tampoco, sin " +
          "un solo error. Remedio: `lotes(e)` de su descriptor declara el CronJob (`*/5 * * * *`, " +
          "`concurrencyPolicy: Forbid`) con `KAMAYUK_IDENTIDAD_URL` compuesta con " +
          `\`e.namespaceDe("${DUENO_DE_LA_AUTORIZACION}")\` (AC-2 de identidad#4).`,
      );
      continue;
    }
    if (suyos.length > 1) {
      salida.push(
        `«${sistema}» declara ${suyos.length} CronJob que hablan con «${dueno}» ` +
          `(${suyos.map((s) => s.nombre).join(", ")}): dos consumidores sobre la misma copia local ` +
          "se acusan el uno al otro los eventos, y `concurrencyPolicy: Forbid` solo vale dentro de " +
          "un CronJob. Uno por sistema.",
      );
    }

    for (const c of suyos) {
      // (2) no nace suspendido
      if (c.suspendido) {
        salida.push(
          `«${sistema}»: el CronJob «${c.nombre}» nace \`suspend: true\`. Existe, y no corre: es el ` +
            "estado en que C-8 dejo al ingestor de `catastro` y que #21 AC-4 tuvo que deshacer — " +
            "un `suspend` no dice nada, se lee igual que «esto todavia no toca». Sin el, lo que " +
            "sujeta al consumidor es una guarda que se pone roja (la tercera mitad), no un " +
            "interruptor.",
        );
      }

      // (3) su credencial tiene su cuenta declarada
      const secreto = secretoDelConsumidor(sistema, mira.ambiente);
      if (!c.secretos.includes(secreto)) {
        salida.push(
          `«${sistema}»: el CronJob «${c.nombre}» no monta la credencial «${secreto}» por ` +
            "`secretKeyRef` (monta: " +
            (c.secretos.length === 0 ? "ninguna" : c.secretos.join(", ")) +
            "). Sin la clave del cliente confidencial no puede pedir el token con que el buzon " +
            "de `identidad` lo reconoce (`azp`), y `GET /eventos/pendientes` contesta 401 en la " +
            `primera vuelta. Remedio: \`KAMAYUK_IDENTIDAD_CREDENCIAL\` desde \`e.secretoDe("` +
            `${DUENO_DE_LA_AUTORIZACION}")\`.`,
        );
        continue;
      }
      const credencial = mira.credenciales.find(
        (k) => k.sistema === sistema && k.llamaA === DUENO_DE_LA_AUTORIZACION,
      );
      if (credencial === undefined) {
        salida.push(
          `«${sistema}»: el CronJob «${c.nombre}» monta «${secreto}» y \`claves(e)\` de su ` +
            "descriptor no la declara con `emisor: \"keycloak\"`. Sin eso `bootstrap-secretos.sh` " +
            "le genera un valor aleatorio que ningun emisor firmo —el estado exacto del que #21 " +
            "salio—, el pod arranca y recibe 401. Remedio: la entrada de `claves(e)` con " +
            `\`nombre: e.secretoDe("${DUENO_DE_LA_AUTORIZACION}")\` y \`emisor: "keycloak"\`.`,
        );
        continue;
      }
      const sinCuenta = mira.ubigeos.filter(
        (u) =>
          !mira.servicios.some(
            (s) =>
              s.ubigeo === u && s.sistema === sistema && s.llamaA === DUENO_DE_LA_AUTORIZACION,
          ),
      );
      if (sinCuenta.length > 0) {
        salida.push(
          `«${sistema}»: su credencial «${secreto}» pide un token para llamar a ` +
            `«${DUENO_DE_LA_AUTORIZACION}», y ${sinCuenta.length} municipalidad(es) no declaran ` +
            `esa cuenta de servicio: ${sinCuenta.join(", ")}. El Secret existiria, el CronJob ` +
            "correria cada cinco minutos, y cada vuelta recibiria 401 — «cero eventos» y «no me " +
            "deja preguntar» se ven igual desde fuera. Remedio: anadir " +
            `{"sistema":"${sistema}","llamaA":"${DUENO_DE_LA_AUTORIZACION}"} al bloque ` +
            `\`servicios\` de ${IDENTIDAD}/municipalidades/<ubigeo>.json.`,
        );
      }
    }
  }
  return salida;
}

/** Las tres mitades sobre lo que el ambiente emite de verdad y sobre la identidad declarativa. */
export function hallazgosDelAmbiente(raiz: string, ambiente: Environment): string[] {
  const invariantes = invariantesDe(ambiente);
  return hallazgos({
    ambiente,
    manifiestos: manifiestosDelAmbiente(invariantes),
    consumidores: consumidoresDeLaAutorizacion(),
    credenciales: credencialesDeServicio(invariantes),
    servicios: serviciosDeclarados(raiz),
    ubigeos: ubigeosDeclarados(raiz),
  });
}
