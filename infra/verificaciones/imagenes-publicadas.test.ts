import { describe, expect, it } from "vitest";
import { ENVIRONMENTS, SISTEMAS_CON_IMAGEN, claveDeVersion } from "../config";
import { SISTEMAS } from "../descriptor/sistemas";
import {
  espaciosConCredencialDeRegistro,
  etiquetasQueNoIdentifican,
  podsSinCredencial,
  imagenesPedidas,
  imagenesQuePublica,
  loQueNadiePublica,
  publicadores,
  shaDeLaEtiqueta,
  type ImagenPedida,
} from "./imagenes-publicadas";

/**
 * D, bloqueo 1 — el manifiesto no puede pedir una etiqueta que nadie publica.
 *
 * Las cifras y el estado de partida estan en el docstring del modulo. Lo que estas pruebas
 * ejercitan es que la guarda **muerda**, y las mutaciones estan escritas como datos: la funcion
 * recibe la lista de imagenes y el inventario de publicadores, asi que una imagen inventada no
 * exige tocar un stack ni un clon hermano.
 */

const UN_SHA = "0123456789abcdef0123456789abcdef01234567";

function imagen(nombre: string, etiqueta = UN_SHA): ImagenPedida {
  return { referencia: `ghcr.io/hneyra/${nombre}:${etiqueta}`, nombre, etiqueta };
}

describe("las imagenes que el ambiente pide las publica alguien", () => {
  it.each(ENVIRONMENTS)("«%s» no pide ninguna imagen sin publicador", (ambiente) => {
    expect(loQueNadiePublica(ambiente).join("\n")).toBe("");
  });

  it.each(ENVIRONMENTS)("«%s» pide las OCHO del corte, y con etiqueta propia", (ambiente) => {
    const nombres = imagenesPedidas(ambiente).map((i) => i.nombre);
    for (const sistema of ["rentas", "catastro", "normativa", "caja"]) {
      expect(nombres, `falta la aplicacion de ${sistema}`).toContain(`kamayuk-${sistema}`);
      expect(nombres, `falta el migrador de ${sistema}`).toContain(`kamayuk-${sistema}-migrador`);
    }
  });

  /**
   * La rotura del criterio: el manifiesto pide algo que nadie construye. Es literalmente el
   * estado en que estaban las ocho antes de este trabajo.
   */
  it("una imagen que ningun flujo publica se nombra, con lo que si hay", () => {
    const problemas = loQueNadiePublica("stg", [imagen("kamayuk-fantasma")]);
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("NINGUN flujo de los clones hermanos publica «kamayuk-fantasma»");
    expect(problemas[0]).toContain("ImagePullBackOff");
    // Y dice quien SI publica algo, que es lo que convierte el rojo en un remedio.
    expect(problemas[0]).toContain("publicar-imagenes.yml");
  });

  it("un clon hermano que falta no se salta: se dice", () => {
    const problemas = loQueNadiePublica("stg", [], { hallados: [], sinClon: ["caja"] });
    expect(problemas[0]).toContain("No estan los clones de caja");
    expect(problemas[0]).toContain("NO se salta");
  });

  /**
   * El contraste. Sin el, una guarda que dijera «no publica nadie» siempre pasaria la prueba de
   * arriba y estaria diciendo que no a todo.
   */
  it("y con su publicador en el inventario, la misma imagen pasa", () => {
    const problemas = loQueNadiePublica("stg", [imagen("kamayuk-fantasma")], {
      hallados: [{ clon: "caja", flujo: "publicar-imagenes.yml", imagenes: ["kamayuk-fantasma"] }],
      sinClon: [],
    });
    expect(problemas).toEqual([]);
  });
});

describe("de un flujo se sacan las imagenes que empuja, no las que nombra", () => {
  const conMatriz = `
name: Publicar imágenes
jobs:
  publicar:
    strategy:
      matrix:
        include:
          - destino: aplicacion
            imagen: kamayuk-rentas
          - destino: migrador
            imagen: kamayuk-rentas-migrador
    steps:
      - uses: docker/build-push-action@v6
        with:
          push: true
          tags: ghcr.io/\${{ steps.registro.outputs.propietario }}/\${{ matrix.imagen }}:\${{ github.sha }}
`;

  it("la matriz se expande: dos entradas, dos imagenes", () => {
    expect(imagenesQuePublica(conMatriz)).toEqual(["kamayuk-rentas", "kamayuk-rentas-migrador"]);
  });

  /**
   * `push: false` es «construye y no subas». Contarlo como publicacion es la forma exacta en que
   * esta guarda dejaria de mirar sin decirlo: el flujo existe, el nombre esta escrito, y en el
   * registro no hay nada.
   */
  it("un paso que NO empuja no publica nada", () => {
    expect(imagenesQuePublica(conMatriz.replace("push: true", "push: false"))).toEqual([]);
  });

  it("un flujo sin ningun `build-push-action` no publica nada", () => {
    expect(imagenesQuePublica("name: Registro\njobs:\n  fila:\n    steps:\n      - uses: actions/checkout@v4\n")).toEqual([]);
  });

  /**
   * Los cuatro clones del corte publican de verdad sus dos imagenes. Esta prueba estaba ROJA
   * hasta el 2026-09-05: ninguno de los cinco repositorios tenia un flujo que publicara nada.
   */
  it.each(["rentas", "catastro", "normativa", "caja"])(
    "«%s» tiene un flujo que publica sus dos imagenes",
    (sistema) => {
      const suyos = publicadores().hallados.filter((p) => p.clon === sistema);
      expect(suyos.flatMap((p) => p.imagenes).sort()).toEqual([
        `kamayuk-${sistema}`,
        `kamayuk-${sistema}-migrador`,
      ]);
    },
  );
});

describe("toda etiqueta identifica una revision", () => {
  it.each(ENVIRONMENTS)("«%s»", (ambiente) => {
    expect(etiquetasQueNoIdentifican(imagenesPedidas(ambiente)).join("\n")).toBe("");
  });

  it("la interfaz del monolito lleva el ambiente delante del sha, y aun asi identifica", () => {
    expect(shaDeLaEtiqueta(`prod-${UN_SHA}`)).toBe(UN_SHA);
    expect(etiquetasQueNoIdentifican([imagen("sgtm-interfaz", `prod-${UN_SHA}`)])).toEqual([]);
  });

  it("una etiqueta movil se nombra", () => {
    const problemas = etiquetasQueNoIdentifican([imagen("kamayuk-rentas", "latest")]);
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("no identifica nada");
  });
});

describe("la lista de sistemas con version declarada es la de los descriptores", () => {
  /**
   * `config.ts` no puede importar `descriptor/sistemas.ts` —ese modulo importa los cuatro
   * descriptores hermanos, y `config.ts` lo lee todo el mundo—, asi que la lista esta escrita dos
   * veces. Lo que impide que se separen es esta prueba: un quinto sistema que se componga sin su
   * `versionDe<Sistema>` la pone roja **nombrandolo**, en vez de heredar en silencio la etiqueta
   * de otro o —peor— la del monolito.
   */
  it("los mismos cuatro, y en el mismo conjunto", () => {
    expect([...SISTEMAS_CON_IMAGEN].sort()).toEqual(
      SISTEMAS.map(({ descriptor }) => descriptor.sistema).sort(),
    );
  });

  it("la clave de cada uno se compone igual que en el stack", () => {
    expect(SISTEMAS_CON_IMAGEN.map(claveDeVersion)).toEqual([
      "versionDeRentas",
      "versionDeCatastro",
      "versionDeNormativa",
      "versionDeCaja",
    ]);
  });
});

describe("quien puede traerse una imagen privada", () => {
  /**
   * La credencial de `ghcr.io` no vive en ningun `spec`: `index.ts` parchea el `ServiceAccount`
   * `default` del espacio de nombres de LA PLATAFORMA (#257). Esta prueba ata esa exencion al
   * codigo — la usa `comprobar-imagenes.sh` para no acusar al monolito de no poder traerse sus
   * tres imagenes privadas, que si puede.
   */
  it("el parche llega a UN espacio de nombres, y es el de la plataforma", () => {
    expect(espaciosConCredencialDeRegistro()).toEqual(["namespace"]);
  });

  /**
   * Y la otra mitad, que es el hueco: los cuatro sistemas viven en el suyo desde ADR-0031, y ni
   * el `Secret` ni el parche llegan alli. Hoy funciona porque sus paquetes son publicos; hacerlos
   * privados —que es lo que deberian ser— deja sus catorce cargas en `ImagePullBackOff`.
   *
   * Esta prueba NO fosiliza el estado: exige que, mientras ningun pod de un sistema declare
   * credencial propia, el manifiesto no contenga ninguna — de modo que quien la anada tenga que
   * venir aqui y decidir si el hueco queda cerrado.
   */
  it.each(ENVIRONMENTS)("y a ninguno de los cuatro sistemas, en «%s»", (ambiente) => {
    const sin = podsSinCredencial(ambiente);
    // Las CATORCE cargas de los cuatro sistemas: cuatro Deployment, ocho Job y dos CronJob.
    expect(sin).toHaveLength(14);
    expect([...new Set(sin.map((p) => p.espacio))].sort()).toEqual([
      `kamayuk-caja-${ambiente}`,
      `kamayuk-catastro-${ambiente}`,
      `kamayuk-normativa-${ambiente}`,
      `kamayuk-rentas-${ambiente}`,
    ]);
    // Y ninguna es de la plataforma: los tres del monolito heredan la credencial del
    // `ServiceAccount` `default`, que es lo que la prueba de arriba ata a `index.ts`.
    expect(sin.filter((p) => p.espacio === `kamayuk-${ambiente}`)).toEqual([]);
  });
});
