import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SISTEMAS, clonDe, type Sistema } from "./deriva-de-migraciones";

/**
 * El censo de lo que los CINCO sistemas declaran compartir, y de lo que ya divergio (#22).
 *
 * ## El hueco que cierra
 *
 * De los seis repositorios, lo unico extraido como artefacto es `comun-verificaciones`. Todo
 * lo demas se copio: los 33 archivos de `dominio-compartido`, los 62 de `plataforma`, las cinco
 * convenciones de Gradle y el `checkstyle.xml`. Una copia no tiene quien la vigile, asi que
 * **una de las cinco puede arreglar un defecto y las otras cuatro quedarse con el, en verde**.
 *
 * **Y desde ADR-0039 son CINCO copias y no cuatro.** `identidad` nacio copiando `plataforma` y
 * `dominio-compartido` de un hermano, asi que entra al censo heredando en cada divergencia de
 * codigo el lado que NO tiene el arreglo, mas seis de prosa propias —todas deliberadas y con su
 * motivo escrito dentro del propio archivo—. Las cifras suben de **412 a 515** comparaciones y de
 * **20 a 24** entradas declaradas.
 *
 * No es hipotetico y no hace falta buscarlo: hoy, medido, `rentas` contesta **422 nombrando el
 * campo** cuando falta la observacion y los otros CUATRO contestan **500 con un identificador de
 * incidencia** (su #30/#55), su 422 de orden no admitido dice **por que campos SI se puede
 * ordenar** y el de los otros CUATRO no (su #35), y `catastro` cerro con un tipo que **no compila**
 * el JSON compuesto a mano en una columna `jsonb` mientras los otros CUATRO siguen componiendolo
 * (su #20). Cada uno de esos defectos se descubrio, se midio y se arreglo **una vez**, y las
 * otras tres copias no se enteraron.
 *
 * ## Que compara, y que NO
 *
 * Compara **contenido normalizado**, no bytes, porque dos normalizaciones son legitimas y una
 * guarda que grita en lo correcto se acaba apagando (#437):
 *
 *  1. **El nombre del sistema.** `kamayuk.rentas` -> `kamayuk.SYS`. Sin esto no hay comparacion
 *     posible: es lo que el propio AC-1 llama «mas alla del renombrado del sistema».
 *  2. **El reflujo de javadoc.** Spotless envuelve a 100 columnas y `kamayuk.rentas` no mide lo
 *     mismo que `kamayuk.caja`, asi que la palabra que cae al final de linea cambia sin que nadie
 *     escriba nada. Medido: con la primera normalizacion sola, `dominio-compartido` da **tres**
 *     desajustes —`MarcoGeografico` y los dos `package-info`— y los tres son eso; con las dos,
 *     **cero**. Lo hace `elReflujoDeJavadoc`, mas abajo.
 *
 * Y **no** compara lo que {@link LO_QUE_NO_SE_COMPARTE} declara: eso no es una exencion, es la
 * otra mitad de la decision (AC-5).
 *
 * ## Por que vive aqui
 *
 * ADR-0038 §1: «si describe el cluster, es de `infrastructure`». Una guarda que lee los cinco
 * clones a la vez no puede vivir en ninguno de ellos —desde `rentas` no se ve `caja`—, y elegir
 * uno dejaria que los otros cuatro divergieran sin que nada lo dijera. Es el mismo argumento que
 * `componentes.test.ts` escribio para la tabla de formas de documento.
 */

/** Una pieza que los cinco repositorios declaran compartir. */
export interface PiezaCompartida {
  /** Como se nombra en el hallazgo. */
  readonly nombre: string;
  /** Donde vive dentro del clon de ese sistema. */
  rutaEn(sistema: string): string;
  /** Que archivos se comparan dentro. */
  readonly extensiones: readonly string[];
  /** Directorios que no se recorren, relativos a la raiz de la pieza. */
  readonly sinRecorrer: readonly string[];
}

/**
 * Las cuatro piezas, con sus cifras medidas sobre `origin/main` de los cinco clones.
 *
 * **No se escribe la lista de archivos**: se recorre el disco y se compara la INTERSECCION de
 * los cinco. Un archivo que solo esta en uno sale como hallazgo con su propia clase, que es lo
 * que hace cierto «el censo no puede crecer en silencio»: un archivo copiado a cuatro de cinco
 * sale rojo el dia que aterriza, no el dia que alguien lo mire.
 */
export const PIEZAS_COMPARTIDAS: readonly PiezaCompartida[] = [
  {
    nombre: "dominio-compartido",
    rutaEn: (s) => `backend/kamayuk-${s}-dominio-compartido/src/main/java/kamayuk/${s}`,
    extensiones: [".java"],
    sinRecorrer: [],
  },
  {
    nombre: "plataforma",
    rutaEn: (s) => `backend/kamayuk-${s}-plataforma/src/main/java/kamayuk/${s}`,
    extensiones: [".java"],
    sinRecorrer: [],
  },
  {
    nombre: "buildSrc",
    rutaEn: () => "backend/buildSrc",
    extensiones: [".kts"],
    // `build/` y `.gradle/` son salida de Gradle, no fuente: unos clones las tienen en el disco
    // y otros no, segun quien haya compilado ultimo.
    sinRecorrer: ["build", ".gradle"],
  },
  {
    nombre: "checkstyle",
    rutaEn: () => "backend/config/checkstyle",
    extensiones: [".xml"],
    sinRecorrer: [],
  },
];

/**
 * Lo que **no** se comparte, y por que (AC-5).
 *
 * Una lista de lo que se queda vale tanto como la de lo que se va. Cada entrada con su medida:
 * lo que no lleva cifra es una opinion, y una opinion no sostiene una exclusion.
 */
export const LO_QUE_NO_SE_COMPARTE: readonly { readonly que: string; readonly motivo: string }[] = [
  {
    que: "Api.RAIZ",
    motivo:
      "Es el prefijo bajo el que publica cada sistema —«/rentas/api/v1», «/caja/api/v1»— y los " +
      "cinco se sirven del mismo origen: es lo que permite que el ingreso enrute sin mirar el " +
      "cuerpo. Es una constante que se inyecta, no una divergencia, asi que se normaliza antes " +
      "de comparar. El resto del archivo SI se compara: hoy su javadoc diverge y sale nombrado.",
  },
  {
    que: "crear-roles.sql",
    motivo:
      "Difiere a proposito y esta medido: `rentas` declara 2 extensiones, `catastro` 4, y " +
      "`normativa` y `caja` NINGUNA. La de `caja` es una decision escrita —«una ventanilla cuya " +
      "base necesita PostGIS no se levanta en cualquier sitio»— y retirar una declaracion cambia " +
      "como se provisiona esa base en todos los ambientes (C-2).",
  },
  {
    que: "Los cinco V1__baseline.sql",
    motivo: "ADR-0032: el esquema de cada sistema nace en su baseline, y son cinco esquemas.",
  },
  {
    que: "Los contextos acotados",
    motivo:
      "`nucleo`, `urbano`, `grd`, `fiscalizacion`, `coactiva`, `parametros`: son de su sistema " +
      "(ADR-0029) y el propio #22 dice que no propone extraerlos.",
  },
  {
    que: "La lista RUTAS_DE_CODIGO de la guarda del registro",
    motivo:
      "El MECANISMO es el mismo y la LISTA no puede serlo: `infrastructure` no tiene `backend/` " +
      "ni `frontend/` —declara `infra/`, `librerias-backend/…/src/main/` y `despliegue/`—, y el " +
      "`despliegue/` de `caja` lo anadio su #39 con su motivo escrito. Lo que si es una propiedad " +
      "de los cinco es que cada lista cubra su propio descriptor: {@link cubreSuPropioDescriptor}.",
  },
  {
    que: "seguridad",
    motivo:
      "Era D-19 —«como llega el catalogo de accesos a los sistemas»— y **esta contestada** " +
      "(2026-09-09, ADR-0039): la autorizacion es un SISTEMA propio, `identidad`, y se replica por " +
      "el buzon. No es una extraccion a una libreria y por eso sigue aqui: hoy la administracion " +
      "de usuarios y grupos vive todavia en `rentas`, y su mudanza es la etapa 2 de ese ADR.",
  },
];

/** De que clase es un desajuste. */
export type ClaseDeDesajuste = "codigo" | "prosa" | "solo-en-uno";

/** Un archivo compartido que no dice lo mismo en los cinco. */
export interface Desajuste {
  readonly pieza: string;
  /** Ruta dentro de la pieza. */
  readonly archivo: string;
  /**
   * Los grupos de clones que coinciden entre si, cada uno ordenado y separados por « | ».
   *
   * Se dice asi y no «difiere de `rentas`» a proposito: elegir un clon de referencia lo
   * convertiria en el correcto por construccion, y en tres de los casos medidos hoy el
   * que va solo **es** el que tiene el arreglo.
   */
  readonly grupos: string;
  readonly clase: ClaseDeDesajuste;
}

/** Un desajuste que ya se conoce, con su motivo y su dueno. */
export interface DivergenciaDeclarada {
  readonly pieza: string;
  readonly archivo: string;
  readonly grupos: string;
  readonly clase: ClaseDeDesajuste;
  /** Que hay detras, y quien lo cierra. Sin esto la lista es una puerta abierta. */
  readonly motivo: string;
}

/**
 * Los desajustes que hay hoy, cada uno con su motivo y su dueno (`origin/main` de los cinco).
 *
 * Se midieron el 2026-09-07 sobre los cuatro del corte —diecisiete— y se volvieron a medir el
 * 2026-09-09 con `identidad` dentro: **veinticuatro**, de las que seis son suyas y las trece
 * anteriores cambian de GRUPO y no de archivo, porque su copia hereda en cada una el lado que no
 * tiene el arreglo.
 *
 * **Es la lista de trabajo pendiente, no una puerta abierta**, y por eso se comprueba en las dos
 * direcciones: quitarle una entrada pone la prueba roja nombrando el archivo, y una entrada que
 * ya no diverge **tambien** —una exencion que no exime nada es invisible y sigue eximiendo a lo
 * que venga con ese nombre; medido en `catastro`#20, donde dos de las cinco entradas de
 * `componenElAreaAManoConMotivo()` llevaban desde su #6 sin eximir nada—.
 *
 * El rojo que el AC-1 pide se produjo **antes** de escribir esta lista, corriendola vacia; esta
 * en la fila del registro. Una guarda que nace verde sobre el defecto que existe para cazar no
 * ha demostrado nada (C-19 §M6, `E` §2).
 */
export const DIVERGENCIAS_DECLARADAS: readonly DivergenciaDeclarada[] = [
  {
    pieza: "dominio-compartido",
    archivo: "dominio/OperacionTodaviaNoCompletable.java",
    grupos: "rentas",
    clase: "solo-en-uno",
    motivo:
      "De `rentas`#40, y llego DESPUES de que este censo se escribiera: es el tipo comun que " +
      "hace que las tres escrituras que ese backend publica y que hoy no pueden terminar dejen " +
      "de salir como `ERROR_INTERNO` con numero de incidencia. Vive en el dominio compartido " +
      "por lo mismo que `MotivoDeInalcanzable`: sus excepciones estan en `tesoreria` y en " +
      "`catastro`, y `ManejadorDeErrores` vive en `plataforma`, que no depende de ninguno. Los " +
      "otros cuatro no lo tienen, asi que una limitacion de diseno conocida les sigue saliendo " +
      "como fallo del servidor. Cierra: la libreria 1 de #22 (`comun-dominio`).",
  },
  {
    pieza: "dominio-compartido",
    archivo: "dominio/MotivoDeInalcanzable.java",
    grupos: "rentas",
    clase: "solo-en-uno",
    motivo:
      "De `rentas`#25: separa «falta la variable del vecino» de «el vecino no contesta» en las " +
      "tres familias de excepcion. Los otros cuatro no lo tienen, asi que su cliente HTTP no puede " +
      "distinguir las dos cosas. Cierra: la libreria 1 de #22 (`comun-dominio`).",
  },
  {
    pieza: "dominio-compartido",
    archivo: "dominio/Observacion.java",
    grupos: "caja, catastro, identidad, normativa | rentas",
    clase: "codigo",
    motivo:
      "**Defecto vivo en CUATRO de cinco.** `rentas`#30/#55 midio que una observacion ausente " +
      "salia como `Objects.requireNonNull` -> `NullPointerException` -> **500 con incidencia**, " +
      "o sea que el estado MIENTE sobre de quien es la culpa y un cliente que reintenta ante 5xx " +
      "reintentaria para siempre. Lo arreglo a `IllegalArgumentException`, que el manejador ya " +
      "traduce a 422 nombrando el campo. Los otros CUATRO siguen con el `requireNonNull`, e " +
      "`identidad` entra en ese lado: su copia es la del defecto.",
  },
  {
    pieza: "plataforma",
    archivo: "autorizacion/ComprobadorDeAcceso.java",
    grupos: "caja, catastro, identidad, normativa | rentas",
    clase: "codigo",
    motivo:
      "De #29 §8, y la divergencia es **inherente y no trabajo pendiente**: los sistemas que " +
      "no administran la seguridad ganan `conoceAlUsuario(String)` para poder separar «no tienes " +
      "el privilegio» de «no estas dado de alta AQUI», que llegaban al funcionario como el mismo " +
      "403. `rentas` no lo necesita ni lo puede necesitar: las nueve escrituras de administracion " +
      "de seguridad viven alli (ADR-0030 §3), asi que en `rentas` la segunda causa se arregla " +
      "dando de alta al usuario y no hay nada que distinguir. Unificarlo seria darle a `rentas` " +
      "un metodo cuyo `false` no puede ocurrir. **No cierra ninguna libreria de #22.**",
  },
  {
    pieza: "plataforma",
    archivo: "autorizacion/GuardiaDeAcceso.java",
    grupos: "caja, catastro, identidad, normativa | rentas",
    clase: "codigo",
    motivo:
      "La otra mitad de la anterior: el `if (!comprobador.conoceAlUsuario(usuario))` que lanza " +
      "nombrando la causa antes de decir «no tiene el privilegio». Mismo motivo, misma direccion, " +
      "y el mismo argumento para no unificarlo. **Los tres se dejaron identicos a proposito** " +
      "—`caja`#52 y `normativa`#27 movieron el comentario que #29 §8 dejo huerfano—: hasta " +
      "entonces esta guarda veia TRES grupos y el tercero era un comentario de sitio, que es " +
      "exactamente el ruido que hace que una lista de divergencias deje de leerse.",
  },
  {
    pieza: "plataforma",
    archivo: "auditoria/AuditoriaJdbc.java",
    grupos: "caja, identidad, normativa, rentas | catastro",
    clase: "codigo",
    motivo:
      "Racimo de `catastro`#20: la bitacora escribia texto que no es JSON en una columna `jsonb`. " +
      "`catastro` lo cerro con un tipo que **no compila** si se le pasa una cadena; los otros cuatro " +
      "siguen con `RegistroDeAuditoria.con(String, String)` y sus ayudantes `escapar(`, que " +
      "escapan la comilla y no los caracteres de control.",
  },
  {
    pieza: "plataforma",
    archivo: "auditoria/DatosDeAuditoria.java",
    grupos: "catastro",
    clase: "solo-en-uno",
    motivo:
      "Racimo de `catastro`#20: el tipo que hace que componer prosa **no compile**. Es la pieza " +
      "que convierte la regla en una propiedad del compilador en vez de en una revision, y los " +
      "otros cuatro no la tienen.",
  },
  {
    pieza: "plataforma",
    archivo: "auditoria/RegistroDeAuditoria.java",
    grupos: "caja, identidad, normativa, rentas | catastro",
    clase: "codigo",
    motivo:
      "Racimo de `catastro`#20: su `con(...)` ya no acepta `String`, asi que la bitacora no puede " +
      "recibir prosa. En los otros cuatro la firma sigue siendo `con(String, String)` y sus " +
      "ayudantes `escapar(` escapan la comilla y no los caracteres de control.",
  },
  {
    pieza: "plataforma",
    archivo: "autorizacion/package-info.java",
    grupos: "caja, catastro, rentas | identidad | normativa",
    clase: "prosa",
    motivo:
      "Los cinco documentan por que la anotacion vive fuera del contexto de seguridad, y **son " +
      "tres grupos**: el de `normativa` anade que ese sistema no tiene ese contexto, y el de " +
      "`identidad` (ADR-0039) anade que su reparto es TEMPORAL —hoy implementa donde los otros " +
      "cuatro, y la etapa 2 lo convierte en el dueno del modelo de autorizacion, sin que el " +
      "reparto de este paquete cambie—. Es prosa que describe algo que de verdad difiere por " +
      "sistema, y cada motivo esta escrito dentro de su propio archivo.",
  },
  {
    pieza: "plataforma",
    archivo: "documentos/EmitirDocumento.java",
    grupos: "caja, identidad, normativa, rentas | catastro",
    clase: "codigo",
    motivo:
      "Racimo de `catastro`#20: es quien escribe la columna, y por eso cambia con la firma. En los " +
      "otros cuatro sigue recibiendo la cadena que alguien concateno.",
  },
  {
    pieza: "plataforma",
    archivo: "json/ObjetosDeValorEnJson.java",
    grupos: "catastro",
    clase: "solo-en-uno",
    motivo:
      "Racimo de `catastro`#20: el paquete que serializa en vez de concatenar, y que vive fuera de " +
      "`web` para que los casos de uso no dependan de la capa de presentacion para escribir una " +
      "columna.",
  },
  {
    pieza: "plataforma",
    archivo: "json/SerializadorDeJson.java",
    grupos: "catastro",
    clase: "solo-en-uno",
    motivo:
      "Racimo de `catastro`#20: el serializador de verdad, con el que un salto de linea o una " +
      "comilla dentro del nombre de un inspector dejan de romper la fila.",
  },
  {
    pieza: "plataforma",
    archivo: "json/package-info.java",
    grupos: "catastro",
    clase: "solo-en-uno",
    motivo:
      "Racimo de `catastro`#20: documenta por que ese paquete depende solo del dominio, que es lo " +
      "que deja la regla 7 en pie.",
  },
  {
    pieza: "plataforma",
    archivo: "persistencia/OrdenSeguro.java",
    grupos: "caja, catastro, identidad, normativa | rentas",
    clase: "codigo",
    motivo:
      "**Defecto vivo en CUATRO de cinco.** `rentas`#35: el 422 de un campo de orden no admitido " +
      "decia «Campo pedido: deuda» y nada mas, mientras el 422 del PARAMETRO desconocido contesta " +
      "«Se admiten: …» con la lista entera —la misma clase de error con dos calidades de respuesta " +
      "en la misma operacion—. Quien integra tenia que adivinar probando nombres contra produccion. " +
      "Va en pareja con `web/ManejadorDeErrores.java`.",
  },
  {
    pieza: "plataforma",
    archivo: "plataforma/PoolDeUnRol.java",
    grupos: "rentas",
    clase: "solo-en-uno",
    motivo: "Solo `rentas` lo tiene. Es el archivo suelto que el propio #22 nombra.",
  },
  {
    pieza: "plataforma",
    archivo: "web/Api.java",
    grupos: "caja | catastro, rentas | identidad | normativa",
    clase: "prosa",
    motivo:
      "`Api.RAIZ` se normaliza antes de comparar (ver LO_QUE_NO_SE_COMPARTE) y **aun asi el " +
      "archivo diverge**: su javadoc dice CUATRO cosas distintas —`rentas` y `catastro` citan su " +
      "propio contrato, `caja` y `normativa` explican el prefijo, y el de `identidad` dice que en " +
      "la etapa 1 no la usa ningun controlador porque no hay ninguno, y por que aun asi no es una " +
      "constante muerta—. Que salga nombrado es lo que compra que la excepcion sea la constante y " +
      "no el archivo.",
  },
  {
    pieza: "dominio-compartido",
    archivo: "dominio/package-info.java",
    grupos: "caja, catastro, normativa, rentas | identidad",
    clase: "prosa",
    motivo:
      "Solo prosa, y es la que ADR-0039 mando escribir: el javadoc de `identidad` anade un " +
      "epigrafe —«Esto es la QUINTA COPIA, y no se esconde»— que dice de donde llego el paquete, " +
      "que ninguna guarda impide que las cinco copias divergan (esta las CENSA, no las impide) y " +
      "que lo que corresponde no es recortarlo alli sino sacarlo a `kamayuk-lib` (ADR-0038, hoy " +
      "vacio). No es trabajo pendiente de nadie: **es la cifra de #22 subiendo de cuatro a cinco**, " +
      "escrita donde se lee. Cierra: la libreria 1 de #22 (`comun-dominio`).",
  },
  {
    pieza: "plataforma",
    archivo: "plataforma/package-info.java",
    grupos: "caja, catastro, normativa, rentas | identidad",
    clase: "prosa",
    motivo:
      "El mismo epigrafe de la quinta copia, en la pieza `plataforma`. Ver la entrada de " +
      "`dominio/package-info.java`: misma decision, mismo motivo y mismo cierre —la libreria 2 de " +
      "#22 (`comun-plataforma`)—.",
  },
  {
    pieza: "plataforma",
    archivo: "web/ParametroQueFalta.java",
    grupos: "caja, catastro, normativa, rentas | identidad",
    clase: "prosa",
    motivo:
      "Solo prosa, y el cambio es una CORRECCION que la normalizacion no puede hacer: el javadoc " +
      "de los cuatro nombra `kamayuk-<sistema>-parametros` como el modulo del que `plataforma` no " +
      "depende, y ese modulo **es de `normativa` y vive en otro repositorio** — con el nombre " +
      "renombrado a `kamayuk-identidad-parametros` la frase nombraria un modulo que no existe en " +
      "ningun sitio. El de `identidad` dice ademas que ahi no lo usa nadie —no consume ningun " +
      "conjunto sellado y no tiene capa web todavia— y por que viaja igual. Cierra: la libreria 2 " +
      "de #22 (`comun-plataforma`).",
  },
  {
    pieza: "plataforma",
    archivo: "web/ProblemaDeNegocio.java",
    grupos: "caja, catastro, normativa, rentas | identidad",
    clase: "prosa",
    motivo:
      "La misma correccion que `web/ParametroQueFalta.java` y en la misma frase: el modulo de " +
      "parametros es de `normativa` y esta en otro repositorio, asi que el nombre renombrado " +
      "nombraria un modulo inexistente. Solo javadoc; el codigo es identico en los cinco.",
  },
  {
    pieza: "plataforma",
    archivo: "web/CodigoDeError.java",
    grupos: "caja, catastro, identidad, normativa | rentas",
    clase: "codigo",
    motivo:
      "**El desajuste que el AC-1 de #22 nombra.** Doce constantes en `rentas` y once en los " +
      "otros cuatro: `SERVICIO_NO_DISPONIBLE` existe solo alli. `catastro`#41 midio lo que cuesta " +
      "que un cliente no reconozca un codigo: `esCodigoConocido` lo rechaza, degrada al del estado " +
      "HTTP, y la pantalla sale con el titulo de OTRO codigo y con «Reintentar» puesto o quitado " +
      "por el motivo equivocado. Cierra: la libreria 2 de #22 (`comun-plataforma`).",
  },
  {
    pieza: "plataforma",
    archivo: "web/ConfiguracionDeJson.java",
    grupos: "caja, identidad, normativa, rentas | catastro",
    clase: "codigo",
    motivo:
      "Racimo de `catastro`#20: registra el modulo que serializa los objetos de valor. `catastro` " +
      "midio que el cuerpo de los eventos del buzon no cambia un byte al hacerlo; los otros cuatro " +
      "no lo han medido porque no lo han hecho.",
  },
  {
    pieza: "plataforma",
    archivo: "web/GuardiaDeParametros.java",
    grupos: "caja, catastro, identidad, normativa | rentas",
    clase: "prosa",
    motivo:
      "Solo el javadoc: el ejemplo del `dNI` de `GET /rentas/contribuyentes`. `rentas`#35 renombro " +
      "esos dos filtros y actualizo su copia; las otras cuatro siguen describiendo el estado " +
      "anterior. La prosa que habla del backend envejece igual que una cifra.",
  },
  {
    pieza: "plataforma",
    archivo: "web/ManejadorDeErrores.java",
    grupos: "caja, catastro, identidad, normativa | rentas",
    clase: "codigo",
    motivo:
      "**Defecto vivo en CUATRO de cinco.** La otra mitad de `persistencia/OrdenSeguro.java`: es " +
      "quien escribe el cuerpo del 422 con «Se admiten: …». Sin las dos, el arreglo no llega.",
  },
];

/**
 * El reflujo de javadoc, normalizado.
 *
 * Dentro de un bloque `/** … *\/` el salto de linea no significa nada: lo pone Spotless al
 * envolver a 100 columnas, y el nombre del sistema cambia de longitud entre clones, asi que la
 * palabra que cae al final de linea cambia sin que nadie escriba nada.
 */
function elReflujoDeJavadoc(contenido: string): string {
  // El cierre `*\/` se conserva: colapsarlo tambien deja el bloque sin terminador, y entonces
  // `sinComentarios` no lo reconoce y toda divergencia de prosa se clasifica como de codigo.
  return contenido.replace(
    /\/\*\*([\s\S]*?)\*\//g,
    (_, cuerpo: string) =>
      `/** ${cuerpo
        .replace(/\s*\n\s*\*\s?/g, " ")
        .replace(/[ \t]+/g, " ")
        .trim()} */`,
  );
}

/** El contenido de un archivo compartido, comparable entre clones. */
export function normalizar(contenido: string, sistema: string): string {
  const sinElNombre = contenido
    .replaceAll(`kamayuk.${sistema}`, "kamayuk.SYS")
    .replaceAll(`kamayuk-${sistema}-`, "kamayuk-SYS-")
    .replaceAll(`"/${sistema}/api/v1"`, '"/SYS/api/v1"');
  return elReflujoDeJavadoc(sinElNombre);
}

/** Lo mismo, sin comentarios: lo que separa un desajuste de codigo de uno de prosa. */
function sinComentarios(contenido: string): string {
  return contenido
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function recorrer(raiz: string, pieza: PiezaCompartida, prefijo = ""): string[] {
  const encontrados: string[] = [];
  for (const entrada of readdirSync(join(raiz, prefijo)).sort()) {
    const relativo = prefijo === "" ? entrada : `${prefijo}/${entrada}`;
    if (statSync(join(raiz, relativo)).isDirectory()) {
      if (!pieza.sinRecorrer.includes(entrada)) {
        encontrados.push(...recorrer(raiz, pieza, relativo));
      }
    } else if (pieza.extensiones.some((e) => entrada.endsWith(e))) {
      encontrados.push(relativo);
    }
  }
  return encontrados;
}

/**
 * Los archivos de esa pieza en el clon de ese sistema.
 *
 * Lanza si la pieza no esta: «no se pudo comprobar» no puede leerse igual que «esta bien», y una
 * ruta que deja de resolver dejaria el censo midiendo el conjunto vacio, en verde.
 */
export function archivosDe(pieza: PiezaCompartida, sistema: Sistema): string[] {
  const raiz = join(clonDe(sistema), pieza.rutaEn(sistema.nombre));
  let archivos: string[];
  try {
    archivos = recorrer(raiz, pieza);
  } catch (causa) {
    throw new Error(
      `No se pudo recorrer la pieza «${pieza.nombre}» de «${sistema.nombre}» en «${raiz}».\n` +
        "  Esta comprobacion NO se salta: un censo que no encuentra su sujeto pasaria en verde " +
        "sobre el conjunto vacio, que es exactamente el estado que #22 existe para impedir.\n" +
        `  Causa: ${String(causa)}`,
    );
  }
  if (archivos.length === 0) {
    throw new Error(
      `La pieza «${pieza.nombre}» de «${sistema.nombre}» no tiene ni un archivo ${pieza.extensiones.join(
        " o ",
      )} en «${raiz}»: el censo se estaria cumpliendo solo.`,
    );
  }
  return archivos;
}

/** Cuantas comparaciones ha hecho la ultima corrida de {@link divergencias}. */
let comparaciones = 0;

/**
 * Cuantos pares de archivo x clon se compararon de verdad.
 *
 * Existe por el contraste: sin esta cifra, quitarle una pieza al censo se lleva por delante
 * ciento y pico comparaciones verdes **sin que nada lo diga**, y «no hay desajustes nuevos» pasa
 * a ser cierto por no haber mirado.
 */
export function comparacionesHechas(): number {
  return comparaciones;
}

function agrupar(porClon: Map<string, string>): string {
  const grupos = new Map<string, string[]>();
  for (const [clon, contenido] of porClon) {
    const iguales = grupos.get(contenido) ?? [];
    iguales.push(clon);
    grupos.set(contenido, iguales);
  }
  return [...grupos.values()]
    .map((clones) => clones.sort().join(", "))
    .sort()
    .join(" | ");
}

/**
 * Los archivos compartidos que no dicen lo mismo en los cinco, derivados del disco.
 *
 * No hay ninguna lista de archivos escrita a mano: se recorre cada pieza en los cinco clones y
 * se comparan **la interseccion** (por contenido) y **la diferencia** (un archivo que solo esta
 * en uno o en algunos). Las dos mitades hacen falta: sin la segunda, `PoolDeUnRol` y el racimo de
 * `catastro`#20 —cinco archivos— no serian ni un hallazgo.
 */
export function divergencias(): Desajuste[] {
  comparaciones = 0;
  const hallazgos: Desajuste[] = [];

  for (const pieza of PIEZAS_COMPARTIDAS) {
    const porSistema = new Map<string, string[]>();
    for (const sistema of SISTEMAS) {
      porSistema.set(sistema.nombre, archivosDe(pieza, sistema));
    }
    const todos = [...new Set([...porSistema.values()].flat())].sort();

    for (const archivo of todos) {
      const loTienen = SISTEMAS.filter((s) => porSistema.get(s.nombre)?.includes(archivo));
      if (loTienen.length !== SISTEMAS.length) {
        hallazgos.push({
          pieza: pieza.nombre,
          archivo,
          grupos: loTienen
            .map((s) => s.nombre)
            .sort()
            .join(", "),
          clase: "solo-en-uno",
        });
        continue;
      }

      const contenidos = new Map<string, string>();
      const sinDocs = new Map<string, string>();
      for (const sistema of loTienen) {
        const crudo = readFileSync(
          join(clonDe(sistema), pieza.rutaEn(sistema.nombre), archivo),
          "utf8",
        );
        contenidos.set(sistema.nombre, normalizar(crudo, sistema.nombre));
        sinDocs.set(sistema.nombre, sinComentarios(normalizar(crudo, sistema.nombre)));
        comparaciones += 1;
      }
      if (new Set(contenidos.values()).size === 1) continue;

      hallazgos.push({
        pieza: pieza.nombre,
        archivo,
        grupos: agrupar(contenidos),
        clase: new Set(sinDocs.values()).size === 1 ? "prosa" : "codigo",
      });
    }
  }

  return hallazgos;
}

/**
 * Si la lista `RUTAS_DE_CODIGO` de la guarda del registro de ese clon cubre su propio descriptor.
 *
 * **Se ejecuta el regex, no se lee la lista** —la leccion de C-19 §M10—: las cinco listas son
 * distintas y dos de las diferencias son legitimas, asi que compararlas como copias daria dos
 * rojos correctos. Lo que si es una propiedad de los cinco es esta.
 *
 * Fue el segundo rojo que el AC-1 de #22 nombra, y **se cerro solo mientras esto se escribia**:
 * `rentas`#55 (`39389e1`) le anadio `/^infrastructure\/src\//` el 2026-09-07. Hasta entonces
 * `rentas` declaraba `/^infra\//` y su descriptor vive en `infrastructure/src/`, de modo que un
 * PR suyo que cerrara un issue tocando su IaC entera **no tenia que escribir la fila del
 * registro y nadie se enteraba**. Esta comprobacion pasa de reportarlo a sostenerlo.
 */
export function cubreSuPropioDescriptor(sistema: Sistema): boolean {
  const guarda = join(clonDe(sistema), "docs/00-gobierno/verificar-fila-del-registro.mjs");
  const fuente = readFileSync(guarda, "utf8");
  // Hasta el `];` al principio de linea: un `]` sin ancla corta dentro del primer `[^/]`.
  const bloque = /RUTAS_DE_CODIGO\s*=\s*\[([\s\S]*?)\n\];/.exec(fuente);
  if (bloque === null) {
    throw new Error(
      `«${guarda}» no declara RUTAS_DE_CODIGO, asi que no se puede saber que cuenta ahi como ` +
        "codigo de produccion. Esta comprobacion no se salta: pasaria en verde sin medir nada.",
    );
  }
  const patrones = [...(bloque[1] ?? "").matchAll(/\/\^[^,\n]*\//g)].map((m) => {
    const literal = m[0];
    return new RegExp(literal.slice(1, literal.lastIndexOf("/")));
  });
  if (patrones.length === 0) {
    throw new Error(`«${guarda}» declara RUTAS_DE_CODIGO y no se le pudo leer ni un patron.`);
  }
  return patrones.some((patron) => patron.test(DESCRIPTOR_DEL_SISTEMA));
}

/**
 * Donde vive el descriptor de despliegue de cada sistema, desde `E`.
 *
 * Es el mismo en los cinco y lo importa `infra/descriptor/sistemas.ts` por esa ruta.
 */
export const DESCRIPTOR_DEL_SISTEMA = "infrastructure/src/descriptor.ts";
