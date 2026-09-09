import { describe, expect, it } from "vitest";
import { SISTEMAS_DEL_PRODUCTO } from "../componentes/convenciones";
import {
  censoDeOpciones,
  comoSeLeeElDesajuste,
  desajustes,
  desajustesDe,
  opcionesDeclaradas,
  opcionesDelClon,
} from "./catalogo-de-accesos";

/**
 * AC-4 de [identidad#2](https://github.com/hneyra/identidad/issues/2): el catalogo unido de
 * `identidad` dice lo mismo que el catalogo real de cada uno de los cinco.
 *
 * El porque de cada decision esta en `catalogo-de-accesos.ts`. Lo que esta aqui son las
 * dos direcciones, los centinelas de C-15/C-16 y el censo que fija las cifras de hoy.
 */
describe("AC-4 — el catalogo unido de «identidad» y el catalogo real de cada sistema", () => {
  it("no hay ni un desajuste, en ninguna de las dos direcciones", () => {
    expect(desajustes().map(comoSeLeeElDesajuste)).toEqual([]);
  });

  it.each(SISTEMAS_DEL_PRODUCTO)("«%s» no tiene desajustes", (sistema) => {
    // Uno por sistema ademas del conjunto, para que el rojo diga a que repositorio hay que
    // ir sin leerse la lista entera. Es lo mismo que hace la deriva de migraciones.
    expect(desajustesDe(sistema).map(comoSeLeeElDesajuste)).toEqual([]);
  });

  /**
   * El censo, que es lo que impide que esto se cumpla sobre el conjunto vacio.
   *
   * Todo lo de arriba es cierto si las dos puntas devuelven cero opciones. Los centinelas
   * de `catalogo-de-accesos.ts` lanzan antes de llegar a eso, pero un centinela que
   * comprueba «mas de cero» no ve una lista que se quedo a la mitad: 134 opciones de
   * `rentas` que pasan a ser 12 porque el analisis del markdown dejo de reconocer una fila
   * seguirian siendo «mas de cero» y seguirian cuadrando con un archivo igual de corto.
   *
   * **Estas cifras se suben a mano y diciendo por que** (la doctrina de #30 con los tres
   * censos que I-44 movio): el dia que un sistema estrene una pantalla, esto sale rojo y lo
   * que hay que hacer NO es actualizar el numero — es comprobar que la opcion nueva esta en
   * las dos puntas, que es justo lo que este archivo existe para exigir.
   */
  it("y los cinco catalogos suman 160 opciones, repartidas 134·16·1·3·6", () => {
    expect(censoDeOpciones()).toEqual({
      rentas: 134,
      catastro: 16,
      normativa: 1,
      caja: 3,
      identidad: 6,
    });
    expect(
      Object.values(censoDeOpciones()).reduce((total, cuantas) => total + cuantas, 0),
    ).toBe(160);
  });

  it("y el catalogo unido declara lo mismo, sistema a sistema", () => {
    // La otra punta del censo. Sin esto, «los cinco clones suman 160» seria cierto tambien
    // con el catalogo unido vacio, porque quien compara las dos listas es la prueba de
    // arriba y esta cifra sale de un solo lado.
    expect(
      Object.fromEntries(
        SISTEMAS_DEL_PRODUCTO.map((sistema) => [sistema, opcionesDeclaradas(sistema).length]),
      ),
    ).toEqual({ rentas: 134, catastro: 16, normativa: 1, caja: 3, identidad: 6 });
  });

  it("los cinco sistemas se derivan de SISTEMAS_DEL_PRODUCTO y no se escriben aqui", () => {
    // Una lista propia seria un sexto sitio donde olvidarse de un sistema, y el olvido no
    // daria rojo: daria un sistema SIN COMPARAR, en verde. Es la forma exacta de C-16 —una
    // guarda que miraba un espacio de nombres de cinco— y la de #40.
    expect([...SISTEMAS_DEL_PRODUCTO]).toEqual([
      "rentas",
      "catastro",
      "normativa",
      "caja",
      "identidad",
    ]);
    expect(Object.keys(censoDeOpciones())).toEqual([...SISTEMAS_DEL_PRODUCTO]);
  });

  it("y la comparacion es por la TERNA, no solo por el codigo", () => {
    // El codigo es la clave del permiso, pero el modulo decide bajo que rama sale la
    // pantalla y el nombre es lo que se lee en la de permisos. Se comprueba sobre los datos
    // de verdad: que las tres partes de cada terna estan pobladas en las dos puntas.
    for (const sistema of SISTEMAS_DEL_PRODUCTO) {
      for (const opcion of [...opcionesDelClon(sistema), ...opcionesDeclaradas(sistema)]) {
        expect(opcion.moduloCodigo).not.toBe("");
        expect(opcion.moduloNombre).not.toBe("");
        expect(opcion.codigo).not.toBe("");
        expect(opcion.nombre).not.toBe("");
      }
    }
  });

  it("y ningun sistema declara dos veces la misma opcion", () => {
    // Un codigo repetido en el catalogo unido es una segunda fila de `acceso` con la misma
    // clave: la siembra la rechaza o la duplica, y en los dos casos el sintoma aparece en la
    // implantacion y no aqui.
    for (const sistema of SISTEMAS_DEL_PRODUCTO) {
      const codigos = opcionesDeclaradas(sistema).map((opcion) => opcion.codigo);
      expect(new Set(codigos).size, `«${sistema}» repite un codigo: ${codigos.join(", ")}`).toBe(
        codigos.length,
      );
    }
  });
});
