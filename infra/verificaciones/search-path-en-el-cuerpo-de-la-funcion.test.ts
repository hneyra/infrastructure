import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { raizDelRepositorio } from "../componentes/fuentes";
import { REGLAS, esquemas } from "./extensiones-de-las-migraciones";
import {
  FRAGILIDADES_QUE_NO_SE_ARREGLAN,
  FUNCIONES_DE_EXTENSION,
  type Fragilidad,
  SOLO_APORTAN_TIPOS,
  descripcionDeLaFragilidad,
  fragilidades,
  fragilidadesDelEsquema,
} from "./search-path-en-el-cuerpo-de-la-funcion";

/** La muestra vive fuera de los seis esquemas, para poder medir la guarda sin tocarlos. */
const MUESTRA = {
  nombre: "muestra",
  raiz: raizDelRepositorio(),
  migraciones: join("infra", "verificaciones", "muestras", "search-path-en-el-cuerpo") + "/",
  roles: "",
};

/**
 * Ningun cuerpo de funcion SQL depende del `search_path` de la sesion (C-4).
 *
 * `pg_dump` vacia el `search_path` antes de restaurar, y lo unico que no puede cualificar
 * con su esquema es el interior de un cuerpo de funcion. Medido contra PostgreSQL 16.15:
 * con el cuerpo fragil, restaurar `catastro` da **85 errores** y no crea ni `via`;
 * `rentas` pierde `contribuyente_nombre_trgm_ix`; y `pg_restore` termina con codigo de
 * salida **0** en los dos casos.
 *
 * Corre en `yarn verificar`, sin cluster y sin motor.
 */
describe("C-4 — ningun cuerpo de funcion SQL depende del search_path", () => {
  it("EL CONTRASTE: hoy solo lo hace el monolito, que no se puede arreglar", () => {
    // Va primero, como en C-2 y C-3: es la mitad que dice que el arbol esta limpio.
    // `rentas` y `catastro` lo arreglaron con una migracion nueva —V11 y V4— y no
    // editando su baseline, porque el baseline ya corrio.
    const censo = fragilidades().map((f) => ({
      sistema: f.sistema,
      migracion: f.migracion,
      nombre: f.nombre,
    }));
    expect(censo).toEqual(
      FRAGILIDADES_QUE_NO_SE_ARREGLAN.map((f) => ({
        sistema: f.sistema,
        migracion: f.migracion,
        nombre: f.nombre,
      })),
    );
  });

  it("el censo vale en las DOS direcciones: no sobra ninguna entrada", () => {
    // La comprobacion de arriba compara listas enteras, asi que una entrada que dejara
    // de ser cierta —porque alguien la arreglo— tambien se pone roja. Esto lo dice con
    // todas las letras para que no se lea como una lista de excepciones mudas: es la
    // misma decision que `DECLARADAS_DE_MAS` en C-2.
    expect(FRAGILIDADES_QUE_NO_SE_ARREGLAN.length).toBeGreaterThan(0);
    for (const declarada of FRAGILIDADES_QUE_NO_SE_ARREGLAN) {
      expect(declarada.porque.length).toBeGreaterThan(20);
      expect(
        fragilidades().some(
          (f) =>
            f.sistema === declarada.sistema &&
            f.migracion === declarada.migracion &&
            f.nombre === declarada.nombre,
        ),
      ).toBe(true);
    }
  });

  it("mide las seis copias del esquema, y ninguna se queda sin mirar", () => {
    // Sin esto, un `esquemas()` que devolviera la lista vacia dejaria las dos
    // comprobaciones de arriba en verde sin haber abierto un archivo — el modo de fallo
    // que #675 escribio primero.
    expect(esquemas().length).toBe(6);
    expect(esquemas().map((e) => e.nombre)).toContain("rentas");
    expect(esquemas().map((e) => e.nombre)).toContain("catastro");
  });

  it("LA MUESTRA QUE LA VIOLA: dos funciones en rojo, y las tres en regla no", () => {
    const hallazgos = fragilidadesDelEsquema(MUESTRA);
    expect(hallazgos.map((h: Fragilidad) => `${h.funcion} · ${h.nombre}`)).toEqual([
      "public.muestra_c4_diccionario_suelto · 'unaccent'::regdictionary",
      "public.muestra_c4_funcion_suelta · unaccent(...)",
    ]);
  });

  it("EL CONTRASTE DE LA MUESTRA: plpgsql y el DDL suelto NO son hallazgos", () => {
    // Los dos contrastes que impiden pasarse de listo. Un cuerpo plpgsql no se inserta
    // en linea nunca, y el DDL de fuera lo cualifica `pg_dump` solo: marcarlos daria dos
    // falsos positivos por archivo, y una guarda que grita el primer dia se silencia
    // —lo que #437 midio al descartar ensanchar el patron de la regla 5—.
    const hallazgos = fragilidadesDelEsquema(MUESTRA);
    expect(hallazgos.map((h) => h.funcion)).not.toContain("public.muestra_c4_plpgsql");
    expect(hallazgos.map((h) => h.funcion)).not.toContain("public.muestra_c4_en_regla");
    expect(hallazgos).toHaveLength(2);
  });

  it("el `LANGUAGE sql` puede ir DESPUES del cuerpo, que es como lo escribe el monolito", () => {
    // `muestra_c4_funcion_suelta` lo declara detras del `$$`, igual que el V11 del
    // monolito. Mirando solo la cabecera, el caso REAL de este defecto se escaparia.
    expect(fragilidadesDelEsquema(MUESTRA).map((h) => h.funcion)).toContain(
      "public.muestra_c4_funcion_suelta",
    );
  });

  it("la PROSA puede nombrarlo: el comentario de la muestra no cuenta como hallazgo", () => {
    // La cabecera de la muestra —y las de V11 de `rentas` y V4 de `catastro`— citan el
    // cuerpo malo para explicarlo. Mirando el archivo entero saldrian en rojo justo los
    // que ya estan arreglados, y el arreglo comodo seria borrar la explicacion.
    expect(fragilidadesDelEsquema(MUESTRA)).toHaveLength(2);
  });

  it("LAS DOS LISTAS SIGUEN DE ACUERDO con REGLAS, en las dos direcciones", () => {
    // Derivar estos nombres leyendo el `source` de los patrones de REGLAS se probo y se
    // descarto: funciona hasta que alguien escribe el patron de otra forma, y entonces
    // la lista se queda corta EN SILENCIO —el defecto de #742—. Se declaran a mano, y
    // esto exige que no puedan separarse.
    for (const { nombre, extension } of FUNCIONES_DE_EXTENSION) {
      const regla = REGLAS.find((r) => r.extension === extension);
      expect(regla, `«${extension}» ya no esta en REGLAS`).toBeDefined();
      expect(
        new RegExp(regla?.patron.source ?? "", "i").test(`${nombre}(x)`),
        `el patron de «${extension}» ya no reconoce ${nombre}()`,
      ).toBe(true);
    }
    for (const regla of REGLAS) {
      const cubierta =
        FUNCIONES_DE_EXTENSION.some((f) => f.extension === regla.extension) ||
        SOLO_APORTAN_TIPOS.some((t) => t.extension === regla.extension);
      expect(
        cubierta,
        `«${regla.extension}» esta en REGLAS y aqui no se dice si aporta funciones o solo tipos`,
      ).toBe(true);
    }
  });

  it("«solo aporta tipos» no es una puerta de escape muda: hay que demostrarlo", () => {
    // ESTA PRUEBA NACIO DE UNA MUTACION QUE PASO EN VERDE. Con `SOLO_APORTAN_TIPOS` como
    // una lista de nombres a secas, mover `pg_trgm` ahi —y vaciar sus tres funciones de
    // FUNCIONES_DE_EXTENSION— dejaba las nueve pruebas pasando: la cobertura se daba por
    // satisfecha y `similarity()`, `word_similarity()` y `show_trgm()` dejaban de
    // vigilarse sin que nada lo dijera. El defecto de #742 dentro de la guarda escrita
    // para no repetirlo.
    //
    // Lo que separa un TIPO de una FUNCION es medible: un modificador de tipo lleva algo
    // dentro del parentesis —`geography(Point,4326)`— y una llamada sin argumentos
    // —`similarity()`— solo puede ser una funcion.
    for (const { extension, tipos } of SOLO_APORTAN_TIPOS) {
      const regla = REGLAS.find((r) => r.extension === extension);
      expect(regla, `«${extension}» ya no esta en REGLAS`).toBeDefined();
      expect(tipos.length, `«${extension}» no dice que tipos aporta`).toBeGreaterThan(0);
      for (const tipo of tipos) {
        expect(
          new RegExp(regla?.patron.source ?? "", "i").test(`${tipo}(Point,4326)`),
          `el patron de «${extension}» ya no reconoce el tipo ${tipo}`,
        ).toBe(true);
        expect(
          new RegExp(regla?.patron.source ?? "", "i").test(`${tipo}()`),
          `«${tipo}» esta declarado como TIPO y su patron casa con ${tipo}(), que solo ` +
            "puede ser una llamada: entonces es una funcion y va en FUNCIONES_DE_EXTENSION",
        ).toBe(false);
      }
    }
  });

  it("el rojo nombra el repositorio, la migracion, la linea y la funcion", () => {
    // Un rojo que dijera solo «hay un nombre sin esquema» obligaria a buscarlo a mano en
    // seis copias de esquema y 4 000 lineas.
    expect(
      descripcionDeLaFragilidad({
        sistema: "rentas",
        migracion: "V1__baseline.sql",
        funcion: "public.nombre_normalizado",
        linea: 227,
        nombre: "'unaccent'::regdictionary",
        porque: "la conversion de entrada resuelve por search_path",
      }),
    ).toBe(
      "«rentas»: V1__baseline.sql:227, en el cuerpo de public.nombre_normalizado, " +
        "«'unaccent'::regdictionary» se resuelve por search_path — " +
        "la conversion de entrada resuelve por search_path",
    );
  });
});
