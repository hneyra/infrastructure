/**
 * Las seis cifras del corte, con su fuente y —cuando no la hay— con el motivo (P6, punto 3).
 *
 * ## El defecto que este archivo existe para no tener
 *
 * Un tablero de seis cifras en cero se lee de una sola manera: todo va bien. Y hay dos maneras de
 * estar en cero, que se dibujan igual y significan lo contrario:
 *
 *   - **cero porque no pasa nada**, que es la que se busca;
 *   - **cero porque nadie alimenta esa serie**, que es no tener defensa y creer que se tiene.
 *
 * Es la misma clase de defecto que el frontend cierra con el guion largo y su motivo: una cifra que
 * el backend no publica sale con «—» y con por que, nunca con la del prototipo. Aqui la regla es la
 * misma — una cifra sin emisor **no se dibuja como cero**: se dibuja diciendo que le falta, y su
 * motivo esta escrito al lado.
 *
 * ## Por que las dos que faltan faltan, medido y no supuesto
 *
 * Se censo el codigo de produccion de los cuatro repositorios antes de escribir esto:
 *
 *   - `caja.pago_evento` **tiene escritor**: `BuzonDeSalidaJdbc` inserta el evento en la MISMA
 *     transaccion del cobro, y `EntregarEventos` lo marca entregado o muerto. Las tres cifras que
 *     salen de esa tabla son reales.
 *   - `caja.cierre_turno.diferencia` **tiene escritor**: el cierre de turno la escribe, y su
 *     `CHECK` la ata a `total_declarado - neto`.
 *   - `rentas.predio_ref` y `rentas.valuacion_predio` **no tienen ninguno**. `INSERT INTO` sobre
 *     ellas aparece solo en `src/test` y `src/testFixtures`; `catastro` no emite ningun evento —no
 *     tiene outbox, ni `@Scheduled`, ni cliente que publique— y el rol `rol_ingestor_catastro`, que
 *     es el unico que puede escribirlas, no tiene todavia ningun proceso que lo use (P5C hueco 3).
 *
 * ## Y el transporte tampoco esta, que es otra cosa
 *
 * Ninguna de las seis puede salir hoy por `/actuator/prometheus`: en los cuatro backends no hay
 * **ni un** uso de `MeterRegistry` —solo las metricas de JVM y HTTP que la autoconfiguracion
 * publica—, y el proceso donde vive el publicador del buzon corre con perfil `batch`, que tiene
 * `web-application-type: none` y por tanto no sirve `/actuator` en absoluto.
 *
 * Y **no se puede resolver por el otro lado**, poniendole consultas propias al `postgres_exporter`:
 * ese sidecar se conecta como `sgtm_monitor`, que tiene `pg_monitor` y ningun `SELECT` sobre una
 * tabla de negocio; darselo seria darle una credencial capaz de leer el padron entero. Y aunque se
 * le diera, las tablas llevan RLS con `FORCE`: una consulta sin contexto de tenant **no devuelve
 * vacio, revienta**, y un agregado entre municipalidades es exactamente lo que la politica existe
 * para impedir. Quien puede publicar estas cifras es cada aplicacion, recorriendo el registro de
 * municipalidades con un `SET LOCAL` por rama — que es como ya lo hace el portal del ciudadano.
 *
 * Asi que este archivo declara **el catalogo y su tablero**, no el emisor. Lo que se puede sujetar
 * hoy es que las seis esten, que cada una diga de donde sale, que ninguna sin fuente se dibuje como
 * cero, y que cada alerta tenga un nombre propio detras.
 */

/** De donde sale una cifra, o por que no sale de ningun sitio. */
export type Fuente =
  | { readonly clase: "viva"; readonly escritor: string }
  | { readonly clase: "sin-emisor"; readonly motivo: string; readonly loCierra: string };

export interface CifraDelCorte {
  /** El identificador del panel y de la regla. En minusculas con guiones. */
  readonly id: string;
  /** Como se llama en el tablero. */
  readonly titulo: string;
  /** El sistema que la publicaria. */
  readonly sistema: "caja" | "rentas" | "catastro" | "normativa";
  /** La serie de Prometheus que el tablero consulta. */
  readonly metrica: string;
  /** La unidad de Grafana. */
  readonly unidad: "s" | "none";
  /**
   * El SQL que la computa, sobre el esquema de su sistema.
   *
   * Va aqui aunque hoy no lo ejecute nadie: es lo que hace que «esta cifra no tiene emisor» sea
   * una afirmacion comprobable —el SQL corre contra el esquema real— y no una intencion.
   */
  readonly sql: string;
  /** De donde sale, o por que no sale. */
  readonly fuente: Fuente;
  /** Quien recibe la alerta. Con nombre: «un tablero que nadie mira no es una defensa». */
  readonly responsable: string;
  /** Que hacer cuando suena. */
  readonly runbook: string;
  /** Por encima de esto, la alerta suena. */
  readonly umbral: number;
}

/**
 * Las seis, en el orden del enunciado de P6.
 *
 * El orden no es decorativo: es el del tablero, y el de la lista que alguien lee de arriba abajo.
 */
export const CIFRAS_DEL_CORTE: readonly CifraDelCorte[] = [
  {
    id: "retraso-del-outbox",
    titulo: "Retraso maximo del outbox",
    sistema: "caja",
    metrica: "kamayuk_outbox_retraso_segundos",
    unidad: "s",
    sql: `SELECT coalesce(extract(epoch FROM now() - min(creado_en)), 0)
            FROM pago_evento
           WHERE estado = 'PENDIENTE'`,
    fuente: {
      clase: "viva",
      escritor:
        "BuzonDeSalidaJdbc inserta el evento en la MISMA transaccion del cobro; " +
        "EntregarEventos lo marca ENTREGADO o MUERTO",
    },
    responsable: "Jefe de Rentas (operacion diaria de caja)",
    runbook: "docs/B0-operacion/runbooks/el-buzon-de-pagos-no-se-vacia.md",
    // Diez minutos: el publicador reintenta cada diez segundos, asi que un retraso de
    // minutos ya no es una entrega en curso — es una que no esta ocurriendo.
    umbral: 600,
  },
  {
    id: "valuacion-que-falta",
    titulo: "Predios sin valuacion del ejercicio",
    sistema: "rentas",
    metrica: "kamayuk_valuacion_faltante_predios",
    unidad: "none",
    sql: `SELECT count(*)
            FROM predio_ref p
           WHERE p.estado = 'ACTIVO'
             AND NOT EXISTS (SELECT 1
                               FROM valuacion_predio v
                              WHERE v.municipalidad_id = p.municipalidad_id
                                AND v.predio_id = p.predio_id
                                AND v.ejercicio = :ejercicio)`,
    fuente: {
      clase: "sin-emisor",
      motivo:
        "ni `predio_ref` ni `valuacion_predio` tienen escritor en produccion: `INSERT INTO` " +
        "sobre las dos aparece solo en pruebas y fixtures, y `catastro` no emite ningun evento",
      loCierra: "el ingestor de eventos (P5C hueco 3, P5E hueco 4)",
    },
    responsable: "Responsable de Catastro (padron y valuacion)",
    runbook: "docs/B0-operacion/runbooks/la-valuacion-del-ejercicio-no-llego.md",
    umbral: 0,
  },
  {
    id: "huellas-discrepantes",
    titulo: "Sectores con huella discrepante (24 h)",
    sistema: "rentas",
    metrica: "kamayuk_antientropia_sectores_discrepantes",
    unidad: "none",
    // No hay SQL de una sola base: la comparacion cruza dos sistemas. La cifra la produce
    // `CorrerLaAntiEntropia`, que es el trabajo por lotes de P6 punto 4.
    sql: "-- la produce `CorrerLaAntiEntropia` comparando dos sistemas; no es una consulta",
    fuente: {
      clase: "sin-emisor",
      motivo:
        "el mecanismo existe desde P6 y la proyeccion contra la que compara no la alimenta " +
        "nadie: hoy la comparacion diria «todos los sectores faltan en la proyeccion», que es " +
        "cierto y no es lo que esta cifra quiere decir",
      loCierra: "el ingestor de eventos, igual que la anterior",
    },
    responsable: "Responsable de Catastro (padron y valuacion)",
    runbook: "docs/B0-operacion/runbooks/la-proyeccion-de-catastro-no-cuadra.md",
    umbral: 0,
  },
  {
    id: "eventos-muertos",
    titulo: "Eventos en la cola de muertos",
    sistema: "caja",
    metrica: "kamayuk_outbox_muertos",
    unidad: "none",
    sql: `SELECT count(*) FROM pago_evento WHERE estado = 'MUERTO'`,
    fuente: {
      clase: "viva",
      escritor:
        "EntregarEventos marca MUERTO tras `kamayuk.caja.entrega.intentos` (8 por omision); " +
        "solo sale de ahi por `ExplicarPagoSinEntregar`, nunca borrandose",
    },
    responsable: "Jefe de Rentas (operacion diaria de caja)",
    runbook: "docs/B0-operacion/runbooks/el-buzon-de-pagos-no-se-vacia.md",
    // Cero: un evento muerto es un cobro que el sistema de origen no sabe que ocurrio, y
    // el cierre de turno es bloqueante mientras haya uno sin explicar.
    umbral: 0,
  },
  {
    id: "turnos-con-diferencia",
    titulo: "Turnos cerrados con diferencia",
    sistema: "caja",
    metrica: "kamayuk_cierres_con_diferencia",
    unidad: "none",
    sql: `SELECT count(*)
            FROM cierre_turno
           WHERE tipo = 'CIERRE'
             AND diferencia IS NOT NULL
             AND diferencia <> 0
             AND fecha >= current_date - 1`,
    fuente: {
      clase: "viva",
      escritor:
        "el cierre de turno la escribe, y `cierre_turno_diferencia_ck` la ata a " +
        "`total_declarado - neto`. Es la unica columna de importe del esquema que admite negativo",
    },
    responsable: "Tesorero (arqueo y cierre)",
    runbook: "docs/B0-operacion/runbooks/un-turno-cerro-con-diferencia.md",
    umbral: 0,
  },
  {
    id: "determinaciones-de-otro-conjunto",
    titulo: "Determinaciones con conjunto distinto al de su corrida",
    sistema: "rentas",
    metrica: "kamayuk_determinaciones_de_otro_conjunto",
    unidad: "none",
    // `corrida_predial.conjunto` es `varchar(60)` y admite vacio —«vacio si no se determino
    // ninguna»—, asi que la comparacion descarta las corridas sin conjunto en vez de contarlas
    // todas como discrepantes.
    sql: `SELECT count(*)
            FROM determinacion d
            JOIN corrida_predial c
              ON c.municipalidad_id = d.municipalidad_id
             AND c.ejercicio = d.ejercicio
           WHERE c.conjunto <> ''
             AND c.conjunto IS DISTINCT FROM d.conjunto_id::text`,
    fuente: {
      clase: "viva",
      escritor:
        "`CorridaDeEmisionRepositoryJdbc` escribe la corrida y `determinacion` la escribe el " +
        "calculo. NO hay clave foranea entre `determinacion.conjunto_id` y el conjunto sellado: " +
        "`V2__baja_de_parametros` la retiro al irse `conjunto_parametros` a `normativa`, y esta " +
        "cifra es lo unico que queda mirando esa union",
    },
    responsable: "Responsable de Normativa (parametros y conjuntos sellados)",
    runbook: "docs/B0-operacion/runbooks/una-emision-uso-otro-conjunto.md",
    umbral: 0,
  },
] as const;

/** Las que hoy tienen emisor. */
export function cifrasVivas(): readonly CifraDelCorte[] {
  return CIFRAS_DEL_CORTE.filter((cifra) => cifra.fuente.clase === "viva");
}

/** Las que hoy NO lo tienen, y por eso no se pueden dibujar como cero. */
export function cifrasSinEmisor(): readonly CifraDelCorte[] {
  return CIFRAS_DEL_CORTE.filter((cifra) => cifra.fuente.clase === "sin-emisor");
}

/**
 * Lo que un panel enseña cuando su serie no existe.
 *
 * Es la pieza que impide el defecto de la cabecera: Grafana dibuja `noValue` en lugar del valor
 * cuando la consulta no devuelve nada, asi que una cifra sin emisor no puede parecerse a un cero.
 */
export function sinFuente(cifra: CifraDelCorte): string {
  if (cifra.fuente.clase === "viva") {
    throw new Error(
      `«${cifra.id}» tiene emisor, asi que su panel no puede declarar un texto de «sin fuente»: ` +
        "eso diria que no se puede medir algo que si se mide.",
    );
  }
  return `sin fuente — ${cifra.fuente.motivo}. Lo cierra: ${cifra.fuente.loCierra}`;
}
