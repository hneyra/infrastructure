import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { raizDelRepositorio } from "../componentes/fuentes";
import { esquemas } from "./extensiones-de-las-migraciones";
import {
  type SufijoRepetido,
  descripcionDelSufijo,
  sufijosDelEsquema,
  sufijosRepetidos,
} from "./sufijo-not-valid-repetido";

/**
 * Ninguna migracion repite el sufijo ` NOT VALID` (C-3).
 *
 * El generador de ADR-0032 lo duplicaba SIEMPRE —`pg_get_constraintdef` ya lo trae y el
 * emisor le anadia otro—, y dejo 36 sentencias asi en el baseline de `rentas` y 1 en el
 * de `caja`. PostgreSQL lo acepta y el catalogo queda identico, de modo que ni las
 * guardas del catalogo ni las pruebas de persistencia pueden verlo: lo que se pierde es
 * que el archivo sea estable en ida y vuelta, y eso solo se ve leyendo el archivo.
 *
 * Corre en `yarn verificar`, sin cluster y sin motor.
 */
describe("C-3 — ninguna migracion repite el sufijo ` NOT VALID`", () => {
  it("EL CONTRASTE: hoy no lo repite ninguna, en ninguna de las cuatro copias", () => {
    // Va primero a proposito, como en C-2: es la mitad que dice que el arbol esta
    // limpio. Cuando esto se ponga rojo, lo que hay que arreglar es la EMISION
    // (`Emitir.java`), no el archivo: corregir solo la salida deja que el siguiente
    // baseline las traiga de vuelta, que es como `caja` acabo arreglada y `rentas` no.
    expect(sufijosRepetidos().map(descripcionDelSufijo)).toEqual([]);
  });

  it("mide las cuatro copias del esquema, y ninguna se queda sin mirar", () => {
    // Sin esto, un `esquemas()` que devolviera la lista vacia dejaria la comprobacion
    // de arriba en verde sin haber abierto un archivo — el modo de fallo que #675
    // escribio primero.
    expect(esquemas().length).toBe(4);
    expect(esquemas().map((e) => e.nombre)).toContain("rentas");
    expect(esquemas().map((e) => e.nombre)).toContain("caja");
  });

  it("LA MUESTRA QUE LA VIOLA: dos sentencias en rojo, y la que esta en regla no", () => {
    // Una regla que no puede fallar no protege nada. La muestra trae el texto exacto
    // que el generador emitia: un CHECK -el caso mayoritario de las 36 de `rentas`- y
    // una foranea -donde P5D lo encontro en `caja`-.
    const hallazgos = sufijosDelEsquema({
      nombre: "muestra",
      raiz: raizDelRepositorio(),
      migraciones: join("infra", "verificaciones", "muestras", "sufijo-not-valid") + "/",
      roles: "",
    });
    expect(hallazgos.map((h: SufijoRepetido) => h.sentencia)).toEqual([
      "ALTER TABLE muestra_c3 ADD CONSTRAINT muestra_c3_v_ck CHECK ((v > 0)) NOT VALID NOT VALID;",
      "REFERENCES muestra_c3(id) NOT VALID NOT VALID;",
    ]);
    // La tercera sentencia de la muestra lleva UN solo sufijo y NO sale. Sin este
    // contraste, una guarda que gritara ante cualquier `NOT VALID` pasaria la muestra
    // entera y no mediria nada: las 40 restricciones no validadas de `rentas` son
    // legitimas y tienen que seguir estandolo.
    expect(hallazgos).toHaveLength(2);
  });

  it("la PROSA puede nombrarlo: el comentario de la muestra no cuenta como hallazgo", () => {
    // La cabecera del baseline de `caja` nombra el defecto para dejar constancia de que
    // lo corrigio, y la de `rentas` hace lo mismo desde C-3. Si la guarda mirara el
    // archivo entero, los dos ARREGLADOS saldrian en rojo y el arreglo comodo seria
    // borrar la explicacion — el hueco de #426 y #558.
    const hallazgos = sufijosDelEsquema({
      nombre: "muestra",
      raiz: raizDelRepositorio(),
      migraciones: join("infra", "verificaciones", "muestras", "sufijo-not-valid") + "/",
      roles: "",
    });
    expect(hallazgos.every((h) => !h.sentencia.startsWith("--"))).toBe(true);
  });

  it("el rojo nombra el repositorio, la migracion y la linea", () => {
    // Un rojo que dijera solo «hay un sufijo repetido» obligaria a buscarlo a mano en
    // cuatro copias de esquema y 4 000 lineas.
    expect(
      descripcionDelSufijo({
        sistema: "rentas",
        migracion: "V1__baseline.sql",
        linea: 2233,
        sentencia: "ALTER TABLE x ADD CONSTRAINT y CHECK (true) NOT VALID NOT VALID;",
      }),
    ).toBe(
      "«rentas»: V1__baseline.sql:2233 repite el sufijo « NOT VALID» — " +
        "ALTER TABLE x ADD CONSTRAINT y CHECK (true) NOT VALID NOT VALID;",
    );
  });
});
