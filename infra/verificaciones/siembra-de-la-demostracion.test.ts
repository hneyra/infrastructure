import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SISTEMAS_QUE_SIEMBRAN,
  cargaDeDatosDe,
  distintosDe,
  ejemplosDuplicados,
  ejemplosHuerfanos,
  esperadoDe,
  filasDe,
  guionesDe,
  guionesSinProceso,
  pasos,
  procesosDe,
  variableDe,
  variableDeArchivoDe,
  EJEMPLOS_QUE_NO_SIEMBRAN,
} from "./siembra-de-la-demostracion";

/**
 * La siembra de la demostracion, repartida en tres repositorios y **orquestada desde aqui**
 * (C-6, hueco 8 de P5C y hueco 11 de P5D).
 *
 * Corre en `yarn verificar`: sin motor, sin cluster y sin arrancar ninguna aplicacion. Lo
 * que se comprueba contra una base -que cada paso deje lo que su archivo dice- lo hace
 * `infra/carga-de-datos/siembra/comprobar-siembra.sh`, que se ejecuta de verdad; aqui se
 * comprueba lo que se puede saber leyendo los cinco clones, que es la mitad que se queda
 * rancia sola.
 */
describe("C-6 — la siembra de la demostracion tiene un orden, y ese orden esta escrito una vez", () => {
  it("EL CONTRASTE: hoy los diez pasos existen, cada uno en su repositorio", () => {
    // Va primero a proposito: si esto se pone rojo, lo demas mide otra cosa.
    const rotos: string[] = [];
    for (const paso of pasos()) {
      const raiz = cargaDeDatosDe(paso.sistema);
      if (!existsSync(join(raiz, paso.guion))) rotos.push(`${paso.sistema}/${paso.guion}`);
      if (!existsSync(join(raiz, "ejemplos", paso.archivo))) {
        rotos.push(`${paso.sistema}/ejemplos/${paso.archivo}`);
      }
    }
    expect(rotos).toEqual([]);
  });

  it("el censo: los diez pasos, con su dueno, su archivo y lo que tiene que dejar", () => {
    // El censo entero, medido contra los clones. Cuando esto se ponga rojo lo que hay que
    // hacer NO es actualizar la lista: es leer que paso cambio de dueno, de archivo o de
    // cifra, y por que. Las cifras salen de los CSV, no estan escritas ni aqui ni en el
    // manifiesto.
    expect(
      pasos().map(
        (p) =>
          `${p.numero}|${p.sistema}|${p.guion}|${p.archivo}|` +
          [...esperadoDe(p).entries()].map(([t, n]) => `${t}=${n}`).join(",") +
          `|requiere:${p.requiere.join(",") || "-"}`,
      ),
    ).toEqual([
      "1|catastro|cargar-catalogo-vial.sh|vias.csv|via=15|requiere:-",
      "2|catastro|cargar-sectores.sh|sectores.csv|sector=4|requiere:-",
      "3|catastro|cargar-manzanas.sh|manzanas.csv|manzana=15|requiere:2",
      "4|caja|cargar-cajas.sh|cajas.csv|caja=5,area=3|requiere:-",
      "5|rentas|cargar-contribuyentes-demo.sh|contribuyentes.csv|contribuyente=16|requiere:-",
      "6|catastro|cargar-fichas-demo.sh|fichas.csv|predio=23|requiere:1,2,3,5",
      "7|catastro|cargar-detalle-fichas-demo.sh|detalle-de-fichas.csv|ficha_catastral=45|requiere:6",
      "8|rentas|cargar-vehiculos-demo.sh|vehiculos.csv|vehiculo=8|requiere:5",
      "9|rentas|cargar-transferencias-demo.sh|transferencias.csv|transferencia=7|requiere:6,8",
      "10|rentas|cargar-deuda-demo.sh|deuda.csv|cuenta_corriente_asiento=54|requiere:5,6,8,9",
    ]);
  });

  it("las 45 versiones de ficha del paso 7 salen de los dos CSV, no de un numero escrito", () => {
    // El README del juego de datos dice «23 predios con sus 45 versiones de ficha». Las 45
    // son 23 que inscribe `fichas.csv` mas 22 que versiona `detalle-de-fichas.csv`, y la
    // unica forma de que esa cifra no envejezca es derivarla.
    const ejemplos = join(cargaDeDatosDe("catastro"), "ejemplos");
    expect(filasDe(join(ejemplos, "fichas.csv"))).toBe(23);
    expect(distintosDe(join(ejemplos, "detalle-de-fichas.csv"), "codigoPredial")).toBe(22);
  });

  it("`requiere` solo puede nombrar pasos anteriores, y que existan", () => {
    // Un `requiere` hacia adelante seria un orden imposible, y uno hacia un paso que no
    // existe dejaria una dependencia que nadie comprueba.
    const numeros = new Set(pasos().map((p) => p.numero));
    const rotos: string[] = [];
    for (const paso of pasos()) {
      for (const antes of paso.requiere) {
        if (!numeros.has(antes)) rotos.push(`${paso.numero} necesita el ${antes}, que no existe`);
        else if (antes >= paso.numero) rotos.push(`${paso.numero} necesita el ${antes}, que va despues`);
      }
    }
    expect(rotos).toEqual([]);
  });

  it("los pasos van del 1 al 10, sin huecos ni repetidos", () => {
    expect(pasos().map((p) => p.numero)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

describe("C-6 — un guion de carga y el proceso que lo atiende estan en el mismo repositorio", () => {
  /**
   * El silencio mas caro que dejo el corte, y el mas dificil de ver.
   *
   * `catastro/infra/carga-de-datos/cargar-transferencias-demo.sh` lanzaba un Job con la
   * imagen de `catastro` y `KAMAYUK_CARGATRANSFERENCIASDEMO_ARCHIVO`, y ese cargador vive en
   * `rentas`. Medido el 2026-09-05: la aplicacion arranca, **no imprime ni una linea de
   * carga** y sale con codigo 0. No hay aviso, no hay fila rechazada, no hay nada.
   */
  it("EL CONTRASTE: hoy ningun guion nombra un proceso que su repositorio no tenga", () => {
    expect(guionesSinProceso()).toEqual([]);
  });

  it("el censo: que guion vive en que repositorio, y con que variable enciende su carga", () => {
    const censo: string[] = [];
    for (const sistema of SISTEMAS_QUE_SIEMBRAN) {
      for (const guion of guionesDe(sistema)) {
        censo.push(`${sistema}/${guion} -> ${variableDeArchivoDe(sistema, guion)}`);
      }
    }
    expect(censo).toEqual([
      "rentas/cargar-contribuyentes-demo.sh -> KAMAYUK_CARGACONTRIBUYENTESDEMO_ARCHIVO",
      "rentas/cargar-deuda-demo.sh -> KAMAYUK_CARGADEUDADEMO_ARCHIVO",
      "rentas/cargar-transferencias-demo.sh -> KAMAYUK_CARGATRANSFERENCIASDEMO_ARCHIVO",
      "rentas/cargar-vehiculos-demo.sh -> KAMAYUK_CARGAVEHICULOSDEMO_ARCHIVO",
      "catastro/cargar-arancel-vial.sh -> KAMAYUK_CARGAARANCEL_ARCHIVO",
      "catastro/cargar-catalogo-vial.sh -> KAMAYUK_CARGAVIAL_ARCHIVO",
      "catastro/cargar-detalle-fichas-demo.sh -> KAMAYUK_CARGADETALLEFICHASDEMO_ARCHIVO",
      "catastro/cargar-fichas-demo.sh -> KAMAYUK_CARGAFICHASDEMO_ARCHIVO",
      "catastro/cargar-manzanas.sh -> KAMAYUK_CARGAMANZANAS_ARCHIVO",
      "catastro/cargar-predios.sh -> KAMAYUK_CARGAPREDIOS_ARCHIVO",
      "catastro/cargar-riesgo.sh -> KAMAYUK_CARGARIESGO_ARCHIVO",
      "catastro/cargar-sectores.sh -> KAMAYUK_CARGASECTORES_ARCHIVO",
      "caja/cargar-cajas.sh -> KAMAYUK_CARGACAJAS_ARCHIVO",
    ]);
  });

  it("el proceso que el manifiesto declara para cada paso existe en su repositorio", () => {
    // Es la otra direccion del mismo acoplamiento: el guion podria estar bien y el
    // manifiesto nombrar un proceso que no existe, y entonces el orden hablaria de un
    // cargador imaginario.
    const rotos: string[] = [];
    for (const paso of pasos()) {
      if (!procesosDe(paso.sistema).includes(paso.proceso)) {
        rotos.push(`${paso.numero}: «${paso.sistema}» no implementa «${paso.proceso}»`);
      }
    }
    expect(rotos).toEqual([]);
  });

  it("el guion que el manifiesto declara manda la variable de ese proceso", () => {
    const rotos: string[] = [];
    for (const paso of pasos()) {
      const variable = variableDeArchivoDe(paso.sistema, paso.guion);
      if (variable !== variableDe(paso.proceso)) {
        rotos.push(
          `${paso.numero}: ${paso.guion} manda ${variable} y el manifiesto declara ` +
            `${paso.proceso} (${variableDe(paso.proceso)})`,
        );
      }
    }
    expect(rotos).toEqual([]);
  });
});

describe("C-6 — cada CSV de siembra vive en un solo repositorio, y alguien lo carga", () => {
  it("ningun CSV de siembra esta en dos repositorios", () => {
    // Antes de C-6 habia hasta TRES copias byte a byte de cada archivo -`infrastructure`,
    // `rentas` y `catastro`- y nada impedia que divergieran: la copia que alguien edita no
    // tiene por que ser la que el cargador lee.
    expect(ejemplosDuplicados()).toEqual([]);
  });

  it("EL CONTRASTE: un CSV de ejemplos que no siembra y no esta declarado, sale", () => {
    // Sin esta prueba, `EJEMPLOS_QUE_NO_SIEMBRAN` podria crecer sin que nada lo notara — y una
    // lista de excepciones que no se puede poner roja deja de ser un censo para ser una puerta.
    expect(EJEMPLOS_QUE_NO_SIEMBRAN).toContain("catastro/riesgo.csv");
    expect(ejemplosHuerfanos()).not.toContain("catastro/riesgo.csv");
  });

  it("ningun CSV de siembra se queda sin paso que lo cargue", () => {
    // Un CSV que nadie carga es peor que no tenerlo: se lee como parte de la siembra y no
    // entra nunca.
    expect(ejemplosHuerfanos()).toEqual([]);
  });
});
