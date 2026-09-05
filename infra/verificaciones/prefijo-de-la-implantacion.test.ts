import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SISTEMAS_DEL_PRODUCTO } from "../componentes/convenciones";
import { podsDe } from "../componentes/tipos";
import { SISTEMAS } from "../descriptor/sistemas";
import { entornoDelAmbiente } from "../herramientas/emitir-manifiestos";
import { invariantesDe } from "./stacks";
import {
  prefijoDeLaImplantacion,
  rutaDeDatosDeImplantacion,
  variableDe,
  variablesConElPrefijoAjeno,
} from "./prefijo-de-la-implantacion";

/**
 * C-18 — el prefijo de la implantacion, contra el Java que lo lee.
 *
 * La guarda del compose compara **dos** mitades —el compose y el descriptor— y las dos podian
 * estar de acuerdo en algo que la tercera, el Java, no lee. Esto es esa tercera.
 */

const ENTORNO = entornoDelAmbiente(invariantesDe("stg"));

/** Las variables que el descriptor de un sistema le da a su Job de implantacion. */
function variablesDeLaImplantacion(sistema: string): string[] {
  const fijado = SISTEMAS.find(({ descriptor }) => descriptor.sistema === sistema);
  if (fijado === undefined) throw new Error(`No hay descriptor de «${sistema}».`);
  const e = ENTORNO(sistema);
  return fijado.descriptor
    .implantacion(e)
    .flatMap((m) => podsDe(m))
    .flatMap((p) => p.pod.containers)
    .flatMap((c) => (c.env ?? []).map((v) => v.name));
}

describe("cada sistema recibe la implantacion con el prefijo que su Java lee", () => {
  it.each(SISTEMAS_DEL_PRODUCTO)("«%s» no recibe ninguna con prefijo ajeno", (sistema) => {
    const prefijo = prefijoDeLaImplantacion(sistema);
    expect(variablesConElPrefijoAjeno(variablesDeLaImplantacion(sistema), prefijo)).toEqual([]);
  });

  /**
   * Y los prefijos son DOS, no uno: `rentas` conserva el del monolito y los otros tres estrenaron
   * el suyo a proposito. Esta prueba fija esa asimetria contra el codigo, para que «igualarlos»
   * sea una decision y no un descuido — igualarlos por el lado de `rentas` exige renombrar la
   * propiedad en su Java, y por el lado de los otros tres deshace la separacion que su javadoc
   * pide.
   */
  it("y son dos prefijos distintos, leidos del Java y no escritos aqui", () => {
    const prefijos = Object.fromEntries(
      SISTEMAS_DEL_PRODUCTO.map((s) => [s, prefijoDeLaImplantacion(s)]),
    );
    expect(prefijos).toEqual({
      rentas: "sgtm.implantacion",
      catastro: "kamayuk.implantacion",
      normativa: "kamayuk.implantacion",
      caja: "kamayuk.implantacion",
    });
  });

  /**
   * Y el runner esta condicionado a ESE prefijo, que es lo que hace que el defecto sea mudo.
   *
   * Sin esta comprobacion, el hallazgo se leeria como «una variable con otro nombre»; con ella
   * queda dicho por que el sintoma es un Job `Complete` que no hizo nada.
   */
  it.each(SISTEMAS_DEL_PRODUCTO)(
    "y «%s» condiciona su runner a ese mismo prefijo",
    (sistema) => {
      const prefijo = prefijoDeLaImplantacion(sistema);
      const runner = rutaDeDatosDeImplantacion(sistema).replace(
        "DatosDeImplantacion.java",
        "ImplantarMunicipalidad.java",
      );
      expect(readFileSync(runner, "utf8")).toContain(`@ConditionalOnProperty("${prefijo}.ubigeo")`);
    },
  );
});

describe("la traduccion de propiedad a variable, y que la guarda muerde", () => {
  it("el punto se vuelve guion bajo y todo va en mayusculas", () => {
    expect(variableDe("sgtm.implantacion")).toBe("SGTM_IMPLANTACION_");
    expect(variableDe("kamayuk.implantacion")).toBe("KAMAYUK_IMPLANTACION_");
  });

  it("el defecto que C-18 encontro sale nombrado, variable a variable", () => {
    // Lo que el descriptor de `rentas` ponia hasta C-18: el prefijo de sus tres hermanos.
    const comoEstaba = [
      "SPRING_PROFILES_ACTIVE",
      "SGTM_DB_URL",
      "KAMAYUK_IMPLANTACION_UBIGEO",
      "KAMAYUK_IMPLANTACION_NOMBRE",
      "KAMAYUK_IMPLANTACION_OWNERCLAVE",
    ];
    expect(variablesConElPrefijoAjeno(comoEstaba, "sgtm.implantacion")).toEqual([
      "KAMAYUK_IMPLANTACION_NOMBRE",
      "KAMAYUK_IMPLANTACION_OWNERCLAVE",
      "KAMAYUK_IMPLANTACION_UBIGEO",
    ]);
  });

  it("y no muerde de mas: lo que no habla de implantacion no se mira", () => {
    // El contraste. `SGTM_DB_URL` y `KAMAYUK_CAJA_CANAL` no son datos de implantacion, y una
    // guarda que las marcara acabaria ignorandose.
    expect(
      variablesConElPrefijoAjeno(
        ["SGTM_DB_URL", "KAMAYUK_CAJA_CANAL", "KAMAYUK_IMPLANTACION_UBIGEO"],
        "kamayuk.implantacion",
      ),
    ).toEqual([]);
  });
});
