import { describe, expect, it } from "vitest";
import { ENVIRONMENTS } from "../config";
import {
  DUENO_DE_LA_AUTORIZACION,
  implantacionesDelAmbiente,
  MARGEN_CORTO_PENDIENTE,
  MARGEN_MINIMO_SEGUNDOS,
  ventanaDeReintentos,
} from "./orden-de-implantacion";

/**
 * Etapa 5 de ADR-0039 — `identidad` implanta primero, y eso se ve.
 *
 * El porque esta en el modulo; el runbook es
 * `docs/00-gobierno/identidad-5-el-orden-de-implantacion.md`.
 */
describe("el orden de implantacion: `identidad` va primero", () => {
  it.each(ENVIRONMENTS)("«%s»: hay implantaciones que mirar", (ambiente) => {
    // El centinela: todo lo de abajo es cierto sobre el conjunto vacio, y un ambiente que dejara
    // de componer sus `Job` de implantacion informaria en verde de que el orden se cumple.
    expect(
      implantacionesDelAmbiente(ambiente).map((i) => i.sistema).sort(),
      "el ambiente no compone un `Job` de implantacion por sistema",
    ).toEqual(["caja", "catastro", "identidad", "normativa", "rentas"]);
  });

  /**
   * El dueno de la autorizacion no depende de ningun hermano.
   *
   * Es lo que hace que el orden sea un orden y no un ciclo: si la implantacion de `identidad`
   * empezara a llamar a un satelite, los cinco se estarian esperando entre si y el sintoma seria
   * cinco `Job` agotando su `backoffLimit` a la vez.
   */
  it.each(ENVIRONMENTS)("«%s»: la implantacion del dueno no espera a nadie", (ambiente) => {
    const dueno = implantacionesDelAmbiente(ambiente).find(
      (i) => i.sistema === DUENO_DE_LA_AUTORIZACION,
    );
    expect(dueno, `el ambiente no compone la implantacion de «${DUENO_DE_LA_AUTORIZACION}»`).toBeDefined();
    expect(
      dueno?.dependeDe,
      "la implantacion de `identidad` nombra el espacio de nombres de un hermano: " +
        (dueno?.porQueVariable ?? []).join(", ") +
        "\n  `identidad` es el dueno de la autorizacion (ADR-0039) y va PRIMERO. Si esperara a " +
        "alguien, el orden dejaria de ser un orden: los cinco `Job` se esperarian entre si.",
    ).toEqual([]);
  });

  /**
   * Y los otros cuatro dependen de el, **y de nadie mas**.
   *
   * Las dos direcciones: uno que dejara de depender habria vuelto a sembrar su propia
   * autorizacion —el defecto que la etapa 5 retira—, y uno que dependiera ademas de otro
   * hermano seria un orden nuevo que nadie ha escrito.
   */
  it.each(ENVIRONMENTS)("«%s»: los cuatro satelites esperan a `identidad`, y solo a el", (ambiente) => {
    const satelites = implantacionesDelAmbiente(ambiente).filter(
      (i) => i.sistema !== DUENO_DE_LA_AUTORIZACION,
    );
    expect(satelites.length, "no hay satelites que mirar").toBe(4);
    for (const satelite of satelites) {
      expect(
        satelite.dependeDe,
        `la implantacion de «${satelite.sistema}» depende de [${satelite.dependeDe.join(", ")}] ` +
          `y tiene que depender solo de «${DUENO_DE_LA_AUTORIZACION}».\n  Desde la etapa 5 de ` +
          "ADR-0039 su sembrador ya no escribe la autorizacion: el administrador llega por el " +
          "buzon. Una implantacion que NO nombrara a `identidad` dejaria la copia local sin una " +
          "sola cuenta, y una que nombrara ademas a otro sistema seria un orden que nadie ha " +
          `escrito. Lo declara: ${satelite.porQueVariable.join(", ") || "(nada)"}`,
      ).toEqual([DUENO_DE_LA_AUTORIZACION]);
    }
  });

  /**
   * Y el margen de reintentos de cada dependiente esta DECLARADO, en las dos direcciones.
   *
   * El orden no lo declara ningun manifiesto —los once `Job` salen de un solo `ConfigGroup` y
   * Kubernetes los arranca a la vez—, asi que lo unico que separa «espera a que termine el otro»
   * de «muere antes» es cuanto aguanta reintentando. Hoy los cuatro aguantan unos 70 s y no
   * alcanza en un ambiente de cero; esta en `infrastructure`#65, y hasta que se decida se declara
   * aqui en vez de dejarlo escrito solo en un parrafo.
   */
  it.each(ENVIRONMENTS)("«%s»: el margen corto esta declarado, y solo el que lo es", (ambiente) => {
    const dependientes = implantacionesDelAmbiente(ambiente).filter(
      (i) => i.dependeDe.length > 0,
    );
    expect(dependientes.length, "ninguna implantacion depende de otra: nada que declarar").toBeGreaterThan(0);

    const cortos = dependientes.filter(
      (i) => ventanaDeReintentos(i.backoffLimit) < MARGEN_MINIMO_SEGUNDOS,
    );
    const sinDeclarar = cortos
      .filter((i) => MARGEN_CORTO_PENDIENTE[i.sistema] === undefined)
      .map((i) => `${i.sistema} (backoffLimit ${i.backoffLimit} = ${ventanaDeReintentos(i.backoffLimit)}s)`);
    expect(
      sinDeclarar,
      "estas implantaciones esperan a otro sistema y no aguantan reintentando el minimo " +
        `declarado (${MARGEN_MINIMO_SEGUNDOS}s):\n  ` +
        sinDeclarar.join("\n  ") +
        "\n  Un `Job` que agota su `backoffLimit` NO reintenta nunca, y su nombre lleva el " +
        "`sha`, asi que `pulumi up` tampoco lo recrea: el ambiente se queda atascado hasta que " +
        "alguien los borra a mano (#44).",
    ).toEqual([]);

    const nombresCortos = new Set(cortos.map((i) => i.sistema));
    const yaSuficientes = Object.keys(MARGEN_CORTO_PENDIENTE).filter((s) => !nombresCortos.has(s));
    expect(
      yaSuficientes,
      "estas implantaciones ya aguantan el minimo y siguen declaradas como pendientes:\n  " +
        yaSuficientes.join("\n  ") +
        "\n  Una lista de trabajo pendiente tiene que decir cuando el trabajo se hizo.",
    ).toEqual([]);
  });

  /** Y la cuenta del retroceso es la de Kubernetes, con su tope de 6 minutos por intento. */
  it("la ventana de reintentos se cuenta como la cuenta Kubernetes", () => {
    expect(ventanaDeReintentos(0)).toBe(0);
    expect(ventanaDeReintentos(1)).toBe(10);
    expect(ventanaDeReintentos(3)).toBe(70);
    expect(ventanaDeReintentos(6)).toBe(630);
    // El tope: a partir del sexto intento cada espera son 360 s y no sigue doblando.
    expect(ventanaDeReintentos(8)).toBe(630 + 360 + 360);
  });
});
