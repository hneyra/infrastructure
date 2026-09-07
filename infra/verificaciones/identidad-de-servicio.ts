import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SISTEMAS } from "../descriptor/sistemas";
import { entornoDelAmbiente } from "../herramientas/emitir-manifiestos";
import type { Invariants } from "../config";

/**
 * La identidad de servicio: que un backend pueda llamar a otro **con credencial** (#21).
 *
 * ## El defecto, medido antes de tocar nada
 *
 * `despliegue/identidad/realm-sgtm.json` declaraba dos clientes —`sgtm-backoffice`, publico y con
 * PKCE, y `sgtm-verificacion`— y **ninguno servia para que un backend llamara a otro**. Lo que los
 * dos publicadores mandaban en su lugar es una credencial de servicio **configurada**, y lo que el
 * descriptor pone en esa variable es lo que `bootstrap-secretos.sh` genera: una cadena aleatoria,
 * no un token que Keycloak haya emitido.
 *
 * Con eso, los dos caminos asincronos del producto estaban muertos en un cluster desplegado:
 *
 *   - **el dinero**: `POST /rentas/api/v1/pagos` contesta 401 sin token, y
 *     `ClienteHttpDelSistemaDeOrigen` clasifica todo 4xx como `Rechazado`, que `EntregarEventos`
 *     marca MUERTO **sin gastar ninguno de los ocho reintentos**. Cobrado, impreso, y el libro sin
 *     enterarse;
 *   - **el territorio**: el `CronJob` del ingestor nace `suspend: true` por lo mismo, asi que
 *     `valuacion_predio` queda vacia y `CandadoDeEmision` no abre nunca.
 *
 * ## Que se comprueba, y por que en dos direcciones
 *
 * Lo que hace falta no es una lista: son **dos fuentes que tienen que decir lo mismo**, y hoy
 * ninguna mira a la otra.
 *
 *   1. el **inventario** de cada descriptor —`claves(entorno)`— dice que credenciales pide ese
 *      sistema, y desde #21 dice ademas **quien tiene que haberlas emitido** (`emisor`);
 *   2. la **identidad declarativa** —`despliegue/identidad/municipalidades/<ubigeo>.json`— dice
 *      que cuentas de servicio existen, por municipalidad.
 *
 * Una credencial declarada sin su cuenta es un **401 en el primer pago**. Una cuenta declarada sin
 * credencial que la pida es una credencial de mas viva en el emisor, que nadie retira porque nadie
 * sabe que sobra. Las dos direcciones se comprueban, y por eso {@link desajustes} devuelve las dos.
 *
 * ## Por que el cliente NO vive en el realm versionado
 *
 * Porque un cliente confidencial tiene una clave, y **una clave no vive en git** (ADR-0012). El
 * realm versionado aporta lo que es independiente de la municipalidad —el ambito
 * `kamayuk-servicio`, con el mapeador que lleva `municipalidad_id` al token— y los clientes los
 * crea `reconciliar-identidades.sh` desde los archivos de municipalidad, que es el mismo mecanismo
 * con el que ya nacen los usuarios y los ciudadanos.
 *
 * ## Por que uno por municipalidad y no uno por sistema
 *
 * Lo pide ADR-0028 §2 con estas palabras: una corrida sin usuario «recibe al abrirse un token
 * **acotado a esa municipalidad** y a esa operacion», y «**no hay un proceso con permiso sobre
 * todas**». Con `client_credentials` el claim sale del atributo de la cuenta de servicio, y una
 * cuenta de servicio es de su cliente: un cliente por sistema daria **un** token para todas las
 * municipalidades, que es exactamente lo que esa frase prohibe.
 */

/** Una credencial que el inventario de un sistema pide y que tiene que emitir Keycloak. */
export interface CredencialDeServicio {
  /** El sistema que la pide: quien llama. */
  readonly sistema: string;
  /** El sistema al que llama, derivado del nombre del secreto y no escrito aparte. */
  readonly llamaA: string;
  /** El nombre del secreto de Kubernetes. */
  readonly secreto: string;
}

/** Una cuenta de servicio declarada en el archivo de una municipalidad. */
export interface ServicioDeclarado {
  readonly ubigeo: string;
  readonly sistema: string;
  readonly llamaA: string;
}

/** Donde vive la identidad declarativa, relativa a la raiz del clon. */
export const IDENTIDAD = "despliegue/identidad";

/** El nombre del ambito que el realm versionado tiene que declarar. */
export const AMBITO_DE_SERVICIO = "kamayuk-servicio";

/** El identificador del cliente confidencial de un par (sistema, municipalidad). */
export function clienteDeServicio(sistema: string, ubigeo: string): string {
  return `kamayuk-${sistema}-servicio-${ubigeo}`;
}

/**
 * Las credenciales de emisor que los cuatro descriptores piden, para un ambiente.
 *
 * `llamaA` **se deriva** del nombre del secreto —`kamayuk-<sistema>-<ambiente>-<clave>`, y la
 * clave es el sistema destino— en vez de declararse aparte: dos sitios con la misma verdad se
 * separan, y aqui el que se quedara viejo seria justo el que dice a quien se llama.
 */
export function credencialesDeServicio(invariantes: Invariants): CredencialDeServicio[] {
  const entornoDe = entornoDelAmbiente(invariantes);
  const nombres = new Set(SISTEMAS.map(({ descriptor }) => descriptor.sistema));

  return SISTEMAS.flatMap(({ descriptor }) => {
    const entorno = entornoDe(descriptor.sistema);
    return descriptor
      .claves(entorno)
      .filter((c) => c.emisor === "keycloak")
      .map((c): CredencialDeServicio => {
        const prefijo = `kamayuk-${descriptor.sistema}-${invariantes.environment}-`;
        const llamaA = c.nombre.startsWith(prefijo) ? c.nombre.slice(prefijo.length) : "";
        if (!nombres.has(llamaA)) {
          throw new Error(
            `[${descriptor.sistema}] la clave «${c.nombre}» declara \`emisor: "keycloak"\` y de su ` +
              "nombre no sale ningun sistema al que llamar. Una credencial de servicio nombra a su " +
              "destino, porque el cliente confidencial se pide POR PAR (origen, destino): " +
              `se compone con \`e.secretoDe("<sistema>")\`, y los sistemas son ${[...nombres].sort().join(", ")}.`,
          );
        }
        return { sistema: descriptor.sistema, llamaA, secreto: c.nombre };
      });
  });
}

/** Las cuentas de servicio declaradas, leidas de los archivos de municipalidad. */
export function serviciosDeclarados(raiz: string): ServicioDeclarado[] {
  const carpeta = join(raiz, IDENTIDAD, "municipalidades");
  return readdirSync(carpeta)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .flatMap((n) => {
      const d = JSON.parse(readFileSync(join(carpeta, n), "utf8")) as {
        ubigeo: string;
        servicios?: { sistema: string; llamaA: string }[];
      };
      return (d.servicios ?? []).map(
        (s): ServicioDeclarado => ({ ubigeo: d.ubigeo, sistema: s.sistema, llamaA: s.llamaA }),
      );
    });
}

/** Los ubigeos que la identidad declarativa conoce. */
export function ubigeosDeclarados(raiz: string): string[] {
  const carpeta = join(raiz, IDENTIDAD, "municipalidades");
  return readdirSync(carpeta)
    .filter((n) => n.endsWith(".json"))
    .map((n) => (JSON.parse(readFileSync(join(carpeta, n), "utf8")) as { ubigeo: string }).ubigeo)
    .sort();
}

/**
 * Lo que las dos fuentes no dicen igual, en las dos direcciones.
 *
 * Devuelve frases listas para leer: un hallazgo que no dice el remedio obliga a quien lo recibe a
 * volver a hacer el analisis que la guarda acaba de hacer.
 */
export function desajustes(raiz: string, invariantes: Invariants): string[] {
  const credenciales = credencialesDeServicio(invariantes);
  const servicios = serviciosDeclarados(raiz);
  const ubigeos = ubigeosDeclarados(raiz);
  const hallazgos: string[] = [];

  for (const c of credenciales) {
    const faltan = ubigeos.filter(
      (u) => !servicios.some((s) => s.ubigeo === u && s.sistema === c.sistema && s.llamaA === c.llamaA),
    );
    if (faltan.length > 0) {
      hallazgos.push(
        `«${c.secreto}» declara \`emisor: "keycloak"\`, o sea que su valor es la clave con la que ` +
          `«${c.sistema}» pide un token para llamar a «${c.llamaA}» — y ${faltan.length} ` +
          `municipalidad(es) no declaran esa cuenta de servicio: ${faltan.join(", ")}. ` +
          "El secreto existiria, el pod arrancaria, y el destino contestaria 401 en la primera " +
          `llamada. Remedio: anadir {"sistema":"${c.sistema}","llamaA":"${c.llamaA}"} al bloque ` +
          `\`servicios\` de ${IDENTIDAD}/municipalidades/<ubigeo>.json.`,
      );
    }
  }

  for (const s of servicios) {
    const laPide = credenciales.some((c) => c.sistema === s.sistema && c.llamaA === s.llamaA);
    if (!laPide) {
      hallazgos.push(
        `${s.ubigeo} declara la cuenta de servicio «${clienteDeServicio(s.sistema, s.ubigeo)}» ` +
          `para llamar a «${s.llamaA}», y ningun descriptor pide una credencial con ` +
          `\`emisor: "keycloak"\` para ese par. Un cliente confidencial que nadie usa es una ` +
          "credencial viva en el emisor que nadie va a retirar, porque nadie sabe que sobra.",
      );
    }
  }
  return hallazgos;
}

/** El realm versionado, tal como se despliega. */
export function realm(raiz: string): {
  clients?: { clientId: string; publicClient?: boolean; serviceAccountsEnabled?: boolean }[];
  clientScopes?: {
    name: string;
    protocolMappers?: { name: string; config?: Record<string, string> }[];
  }[];
} {
  const ruta = join(raiz, IDENTIDAD, "realm-sgtm.json");
  if (!existsSync(ruta)) {
    throw new Error(
      `No esta «${ruta}». Sin el realm versionado esta comprobacion no mide nada, y un verde ` +
        "sin sujeto es peor que un rojo.",
    );
  }
  return JSON.parse(readFileSync(ruta, "utf8")) as ReturnType<typeof realm>;
}
