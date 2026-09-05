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
   * Y desde R-A/B los cuatro prefijos son EL MISMO, leido del Java y no escrito aqui.
   *
   * Hasta C-18 eran dos: `rentas` conservaba `sgtm.implantacion` —era el monolito— y los otros
   * tres estrenaron `kamayuk.implantacion`, y esa asimetria es la que dejo el Job de implantacion
   * de `rentas` **saliendo con codigo 0 sin implantar nada** desde C-14. R-A/B la deshace por el
   * lado que faltaba: renombrando la propiedad en el Java de `rentas`.
   *
   * Esta prueba sigue **leyendo los cuatro archivos** y no comparando contra una lista escrita a
   * mano: lo que fija es que los cuatro digan lo mismo, y que decir otra cosa sea una decision con
   * su diff y no un descuido. El motivo por el que los tres hermanos estrenaron nombre —«tener
   * nombres distintos hace imposible que un descuido apunte el Job de `catastro` con las variables
   * del de `rentas`»— lo sigue cubriendo la prueba de arriba, que compara **cada** descriptor con
   * **su** Java: ahi el nombre compartido no confunde nada, porque cada sistema tiene su propio
   * Job y su propia base.
   */
  it("y los cuatro leen el mismo, leido del Java y no escrito aqui", () => {
    const prefijos = Object.fromEntries(
      SISTEMAS_DEL_PRODUCTO.map((s) => [s, prefijoDeLaImplantacion(s)]),
    );
    expect(prefijos).toEqual({
      rentas: "kamayuk.implantacion",
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
    expect(variableDe("kamayuk.implantacion")).toBe("KAMAYUK_IMPLANTACION_");
    // El prefijo del monolito, que ya no lee ningun Java de los cuatro. Se conserva aqui a
    // proposito: es el que hace de «ajeno» en la mutacion de abajo, y tenerlo escrito una vez es
    // lo que impide que esta guarda se vuelva a quedar comparando el nombre viejo consigo mismo.
    expect(variableDe("sgtm.implantacion")).toBe("SGTM_IMPLANTACION_");
  });

  it("el defecto que C-18 encontro sale nombrado, variable a variable", () => {
    // La mutacion es la de C-18 con los papeles cambiados por R-A/B: entonces el descriptor de
    // `rentas` ponia `KAMAYUK_IMPLANTACION_*` y su Java leia `sgtm.implantacion`; ahora los cuatro
    // leen `kamayuk.implantacion` y lo ajeno es el nombre del monolito. El defecto es el mismo y
    // es mudo por el mismo motivo: el runner no se registra y el Job sale con codigo 0.
    const conElPrefijoDelMonolito = [
      "SPRING_PROFILES_ACTIVE",
      "KAMAYUK_DB_URL",
      "SGTM_IMPLANTACION_UBIGEO",
      "SGTM_IMPLANTACION_NOMBRE",
      "SGTM_IMPLANTACION_OWNERCLAVE",
    ];
    expect(variablesConElPrefijoAjeno(conElPrefijoDelMonolito, "kamayuk.implantacion")).toEqual([
      "SGTM_IMPLANTACION_NOMBRE",
      "SGTM_IMPLANTACION_OWNERCLAVE",
      "SGTM_IMPLANTACION_UBIGEO",
    ]);
  });

  it("y no muerde de mas: lo que no habla de implantacion no se mira", () => {
    // El contraste. `KAMAYUK_DB_URL` y `KAMAYUK_CAJA_CANAL` no son datos de implantacion, y una
    // guarda que las marcara acabaria ignorandose.
    expect(
      variablesConElPrefijoAjeno(
        ["KAMAYUK_DB_URL", "KAMAYUK_CAJA_CANAL", "KAMAYUK_IMPLANTACION_UBIGEO"],
        "kamayuk.implantacion",
      ),
    ).toEqual([]);
  });
});
