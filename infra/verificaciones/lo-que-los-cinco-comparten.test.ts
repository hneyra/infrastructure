import { describe, expect, it } from "vitest";
import { SISTEMAS } from "./deriva-de-migraciones";
import {
  archivosDe,
  comparacionesHechas,
  cubreSuPropioDescriptor,
  divergencias,
  DIVERGENCIAS_DECLARADAS,
  LO_QUE_NO_SE_COMPARTE,
  PIEZAS_COMPARTIDAS,
  type Desajuste,
  type DivergenciaDeclarada,
} from "./lo-que-los-cinco-comparten";

/**
 * El censo de lo que los cuatro sistemas comparten no puede crecer en silencio (#22, AC-1).
 *
 * ## El rojo con el que nacio, y por que esta en la fila del registro y no aqui
 *
 * El AC-1 dice que esta guarda «tiene que salir roja nombrando `CodigoDeError` y
 * `RUTAS_DE_CODIGO`; ese rojo es el criterio». Se produjo antes de escribir
 * {@link DIVERGENCIAS_DECLARADAS}, corriendo el censo con la lista **vacia**, y el rojo literal
 * —diecisiete desajustes, con sus grupos y su clase— esta en la fila del registro de
 * `CLAUDE.md`. Una guarda que nace verde sobre el defecto que existe para cazar no ha demostrado
 * nada, y esa leccion la tiene este repositorio escrita dos veces (C-19 §M6, `E` §2).
 *
 * Lo que queda aqui es la lista declarada, **con las dos direcciones cerradas**: quitarle una
 * entrada pone rojo nombrando el archivo, y una entrada que ya no diverge tambien. Es trabajo
 * pendiente y no una puerta abierta, como `busquedasDeTextoLibreConMotivo()` en T-0; y la segunda
 * direccion existe porque `catastro`#20 midio que dos de las cinco entradas de
 * `componenElAreaAManoConMotivo()` llevaban desde su #6 sin eximir nada.
 *
 * ## Lo que NO se hace aqui
 *
 * No se arregla ni una de las diecisiete. Tres son defectos vivos en tres de los cuatro clones
 * —la observacion ausente que contesta 500, el 422 que no dice por que campos se puede ordenar, y
 * el JSON compuesto a mano en una columna `jsonb`— y este repositorio no puede tocar el `src/main`
 * de ninguno de ellos. Lo que hace la guarda es que dejen de ser invisibles.
 */
describe("lo que los cuatro sistemas comparten (#22 AC-1)", () => {
  const clave = (d: Desajuste | DivergenciaDeclarada): string =>
    `${d.pieza}/${d.archivo} :: ${d.grupos} :: ${d.clase}`;

  /**
   * Lo primero: que se haya mirado algo.
   *
   * Va delante de todo lo demas porque **todas las afirmaciones de abajo son ciertas sobre el
   * conjunto vacio**: sin esto, apuntar una pieza a un directorio que no existe —o dejar de
   * recorrer una— dejaria la bateria entera en verde sin comparar un solo archivo. Es la misma
   * guarda que `catastro` puso en `mirar.mjs` y en `errores.mjs`, y por el mismo motivo.
   *
   * La cifra medida el 2026-09-07 sobre `origin/main` es **412** pares archivo x clon; el piso se
   * pone holgado a proposito, porque lo que se vigila es que el recorrido ocurra, no cuantos
   * archivos tengan hoy los cuatro clones.
   */
  it("compara los cuatro clones de verdad, y no el conjunto vacio", () => {
    divergencias();
    expect(comparacionesHechas()).toBeGreaterThan(300);
  });

  /**
   * Y que hayan aportado **las cuatro** piezas, que es lo que la cifra global no dice.
   *
   * Con solo el total, quitar `checkstyle` —tres comparaciones— no se nota, y quitar `buildSrc`
   * —veintiuna— tampoco: el numero seguiria por encima del piso. Aqui cada una responde por si
   * misma, y ademas se comprueba en los cuatro clones, que es donde `archivosDe` lanza si la ruta
   * dejo de resolver.
   */
  it.each(PIEZAS_COMPARTIDAS.map((p) => p.nombre))("la pieza «%s» tiene archivos en los cuatro", (nombre) => {
    const pieza = PIEZAS_COMPARTIDAS.find((p) => p.nombre === nombre);
    expect(pieza).toBeDefined();
    for (const sistema of SISTEMAS) {
      expect(archivosDe(pieza!, sistema).length).toBeGreaterThan(0);
    }
  });

  /**
   * **El AC-1.** Ninguna divergencia sin declarar.
   *
   * El dia que alguien copie un archivo a tres de los cuatro, o arregle un defecto en uno solo,
   * esto sale rojo nombrando el archivo y **los grupos de clones que coinciden entre si** —no
   * «difiere de `rentas`»: elegir un clon de referencia lo haria el correcto por construccion, y
   * en tres de los cuatro casos medidos hoy el que va solo es justamente el que tiene el arreglo—.
   */
  it("ninguna divergencia sin declarar", () => {
    const declaradas = new Set(DIVERGENCIAS_DECLARADAS.map(clave));
    const sinDeclarar = divergencias()
      .filter((d) => !declaradas.has(clave(d)))
      .map(clave);
    expect(sinDeclarar).toEqual([]);
  });

  /**
   * La otra direccion: ninguna entrada rancia.
   *
   * Una entrada que ya no diverge —porque alguien la unifico, o porque el archivo se fue— no es
   * inofensiva: sigue eximiendo a lo que venga manana con ese nombre, y nadie se entera. Es lo
   * que `catastro`#20 encontro midiendo: dos de las cinco entradas de esa lista llevaban desde su
   * #6 sin eximir nada.
   */
  it("ninguna entrada declarada esta rancia", () => {
    const hay = new Set(divergencias().map(clave));
    const sobran = DIVERGENCIAS_DECLARADAS.filter((d) => !hay.has(clave(d))).map(clave);
    expect(sobran).toEqual([]);
  });

  /**
   * Y cada entrada dice **que** hay detras.
   *
   * Sin motivo, la lista deja de ser trabajo pendiente y pasa a ser una lista de cosas que no hay
   * que mirar. El minimo se fija en algo que no se puede cumplir con «pendiente».
   */
  it("cada divergencia declarada lleva su motivo", () => {
    const sinMotivo = DIVERGENCIAS_DECLARADAS.filter((d) => d.motivo.trim().length < 40).map(clave);
    expect(sinMotivo).toEqual([]);
  });

  /**
   * AC-5: lo que **no** se extrae, escrito.
   *
   * «Una lista de lo que se queda vale tanto como la de lo que se va», dice el AC. Lo que se
   * comprueba aqui es que exista y que cada entrada lleve su motivo; que el motivo sea cierto lo
   * lee la revision, no una maquina.
   */
  it("lo que no se comparte esta escrito, y con su motivo", () => {
    expect(LO_QUE_NO_SE_COMPARTE.length).toBeGreaterThan(0);
    const sinMotivo = LO_QUE_NO_SE_COMPARTE.filter((x) => x.motivo.trim().length < 40).map((x) => x.que);
    expect(sinMotivo).toEqual([]);
  });

  /**
   * `Api.RAIZ` se normaliza y el resto de `Api.java` **no**.
   *
   * Es la mitad que hace que la excepcion sea la constante y no el archivo: hoy `Api.java` sale
   * en el censo por su javadoc, y esa es la prueba de que eximirlo entero perderia algo. Si
   * alguien ensancha la excepcion a todo el archivo, esta prueba se queda sin sujeto y la de
   * arriba —«ninguna entrada rancia»— se pone roja.
   */
  it("de Api.java se normaliza RAIZ y nada mas", () => {
    const api = divergencias().find((d) => d.archivo === "web/Api.java");
    expect(api).toBeDefined();
    expect(api?.clase).toBe("prosa");
  });

  /**
   * La guarda del registro de cada clon cubre su propio descriptor de IaC.
   *
   * **Se ejecuta el regex, no se lee la lista** (C-19 §M10): las cinco listas son distintas y dos
   * de las diferencias son legitimas —`infrastructure` no tiene `backend/` ni `frontend/`, y el
   * `despliegue/` de `caja` lo anadio su #39—, asi que compararlas como copias daria dos rojos
   * correctos. Lo que si es una propiedad de los cuatro es esta.
   *
   * Fue el segundo rojo que el AC-1 nombra y **se cerro solo mientras esto se escribia**:
   * `rentas`#55 (`39389e1`, 2026-09-07) le anadio `/^infrastructure\/src\//`. Hasta ese commit
   * `rentas` declaraba `/^infra\//` y su descriptor vive en `infrastructure/src/`, de modo que un
   * PR suyo que cerrara un issue tocando su IaC entera no tenia que escribir la fila del registro
   * y nadie se enteraba. Esto pasa de reportarlo a sostenerlo.
   */
  it.each(SISTEMAS.map((s) => s.nombre))(
    "la guarda del registro de «%s» cuenta su propio descriptor como codigo de produccion",
    (nombre) => {
      const sistema = SISTEMAS.find((s) => s.nombre === nombre);
      expect(sistema).toBeDefined();
      expect(cubreSuPropioDescriptor(sistema!)).toBe(true);
    },
  );

  /**
   * El censo se niega a medir una pieza que no esta.
   *
   * «No se pudo comprobar» no puede leerse igual que «esta bien»: es la doctrina que este
   * repositorio tiene escrita en `clonDe` y en `verificarAislamiento`, y aqui importa mas que de
   * costumbre porque **todo lo que este archivo afirma es cierto sobre el conjunto vacio**.
   */
  it("una pieza que no esta hace fallar el censo, no lo deja pasar en verde", () => {
    const inventada = {
      nombre: "inventada",
      rutaEn: () => "backend/no-existe-este-directorio",
      extensiones: [".java"],
      sinRecorrer: [],
    };
    expect(() => archivosDe(inventada, SISTEMAS[0]!)).toThrow(/No se pudo recorrer la pieza/);
  });

  /**
   * Y a medir una pieza que esta y no tiene ni un archivo de los que compara.
   *
   * Es el caso que la anterior no cubre y que se alcanza sin borrar nada: basta con que alguien
   * cambie la extension —de `.java` a `.kt`, de `.kts` a `.gradle`— y el recorrido devolveria la
   * lista vacia sin error, con el censo cumpliendose solo.
   */
  it("una pieza sin archivos de su extension tambien falla", () => {
    const vacia = {
      nombre: "vacia",
      rutaEn: () => "backend",
      extensiones: [".no-existe-esta-extension"],
      sinRecorrer: [] as string[],
    };
    expect(() => archivosDe(vacia, SISTEMAS[0]!)).toThrow(/no tiene ni un archivo/);
  });
});
