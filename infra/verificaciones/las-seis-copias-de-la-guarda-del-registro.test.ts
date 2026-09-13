import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { raizDelRepositorio } from "../componentes/fuentes";
import {
  type Copia,
  DECLARACION,
  GUION,
  desajustes,
  lasSeisCopias,
  loComun,
} from "./las-seis-copias-de-la-guarda-del-registro";

/**
 * Las seis copias de `verificar-fila-del-registro.mjs` no pueden separarse en silencio (#165).
 *
 * `rentas`#132 arreglo su copia —«Cierra #N» no cierra nada en GitHub, y `closed`, `fixed` y
 * `resolved` si— y las otras cinco se quedaron con el defecto, en verde, porque nada las ataba.
 * La decision de #165 (AC-4) es mantener las copias y atarlas: identicas byte a byte salvo el
 * bloque de `RUTAS_DE_CODIGO`, que decide cada dueno. Que es exactamente ese bloque, y por que,
 * esta escrito en `las-seis-copias-de-la-guarda-del-registro.ts`.
 *
 * ## Lo que esta prueba lee, y lo que eso obliga a mezclar en orden
 *
 * Lee los cinco clones hermanos del disco —en CI, la rama principal de cada uno—, asi que un
 * cambio al guion fuera del bloque llega en seis PR y **el de `infrastructure` se mezcla el
 * ultimo**. Antes de eso esto sale rojo nombrando a los que faltan, que es lo que tiene que decir.
 *
 * ## Las muestras van aqui, y sobre la copia de verdad
 *
 * Cada muestra se fabrica a partir de la copia de ESTE repositorio, no de un texto inventado: si
 * el guion cambia, las muestras siguen midiendo el archivo que corre. Y van en pareja con su
 * contraste —un bloque propio distinto NO es un desajuste—, porque una guarda que se satisface
 * gritando ante cualquier diferencia tambien pasaria las muestras rojas, y se apagaria en el
 * primer PR que anade una ruta.
 */

const LOS_SEIS = ["caja", "catastro", "identidad", "infrastructure", "normativa", "rentas"];

/** La copia de este repositorio, que es de la que se fabrican las muestras. */
function laDeAqui(): string {
  return readFileSync(join(raizDelRepositorio(), GUION), "utf8");
}

/** El mismo texto con otro bloque propio en lugar del suyo. */
function conOtroBloque(texto: string, bloque: string): string {
  const lineas = texto.split("\n");
  const { inicio } = loComun(texto);
  const cierre = lineas.findIndex((linea, i) => i > inicio && linea === "];");
  return [...lineas.slice(0, inicio), bloque, ...lineas.slice(cierre + 1)].join("\n");
}

/** Seis copias de ese texto, cada una con su propio nombre y su propio bloque. */
function seisCopias(
  texto: string,
  cambios: Partial<Record<string, string | undefined>> = {},
): Copia[] {
  return LOS_SEIS.map((repo, i) => {
    const propio = conOtroBloque(
      texto,
      `/** La lista de «${repo}».\n\n    Con ${i + 1} lineas de motivo. */\n` +
        `${DECLARACION}\n  // un comentario propio\n  /^${repo}\\//,\n  /^otra-${i}\\/src\\//u,\n];`,
    );
    const texto_ = repo in cambios ? cambios[repo] : propio;
    return { repo, ruta: `/muestra/${repo}/${GUION}`, texto: texto_ };
  });
}

describe("#165 · las seis copias de la guarda del registro dicen lo mismo", () => {
  it("EL CENTINELA: se encontraron las seis copias, y ninguna falta", () => {
    // Va primero porque la de abajo es cierta sobre el conjunto vacio: con un clon que no se
    // lee, o con el guion movido de sitio, compararia menos copias de las que dice.
    const copias = lasSeisCopias();
    expect(
      copias.map((c) => c.repo).sort(),
      "no se buscaron las seis copias: esta guarda estaria midiendo menos de lo que dice.",
    ).toEqual(LOS_SEIS);
    expect(
      copias.filter((c) => c.texto === undefined).map((c) => c.ruta),
      "hay repositorios sin su copia del guion en el sitio de siempre.",
    ).toEqual([]);
  });

  it("las seis son identicas fuera de su bloque RUTAS_DE_CODIGO (AC-4)", () => {
    expect(
      desajustes(lasSeisCopias()),
      "las copias de la guarda del registro se han separado. Un cambio al guion fuera del " +
        "bloque RUTAS_DE_CODIGO es un cambio en los SEIS repositorios, y `infrastructure` se " +
        "mezcla el ultimo: si este rojo sale en un PR de aqui, faltan por mezclar los de los " +
        "repositorios que nombra.",
    ).toEqual([]);
  });

  describe("las muestras, fabricadas sobre la copia de aqui", () => {
    it("EL CONTRASTE: seis bloques propios distintos no son un desajuste", () => {
      // Listas de distinta longitud, con comentarios distintos y cabeceras de distinto largo:
      // exactamente lo que cada dueno puede decidir. Sin este verde, la guarda se podria
      // satisfacer exigiendo que las seis listas fueran iguales, y la primera ruta nueva de un
      // repositorio la pondria roja por lo correcto.
      expect(desajustes(seisCopias(laDeAqui()))).toEqual([]);
    });

    it("una copia que se aparta FUERA del bloque sale roja, con su repositorio y su linea", () => {
      // La rotura de #165 en miniatura: una copia que no conoce `closed`.
      const base = seisCopias(laDeAqui());
      const normativa = base.find((c) => c.repo === "normativa")!.texto!;
      expect(normativa).toContain("  'closed',\n");
      const sinClosed = normativa.replace("  'closed',\n", "");
      const hallazgos = desajustes(seisCopias(laDeAqui(), { normativa: sinClosed }));
      expect(hallazgos).toHaveLength(1);
      expect(hallazgos[0]).toContain(
        "«normativa» no dice lo mismo que «caja, catastro, identidad, infrastructure, rentas»",
      );
      expect(hallazgos[0]).toMatch(/Se aparta en la linea \d+ de su archivo/);
      expect(hallazgos[0]).toContain("«  'close',» frente a «  'closed',»");
    });

    it("la PROSA fuera del bloque tambien se compara: otra cabecera es otra copia", () => {
      // Asi empezaron a separarse: seis cabeceras distintas antes de que divergiera el codigo.
      const otra = laDeAqui().replace(
        "Comprueba que un PR que cierra un issue",
        "Comprueba, en este repositorio, que un PR que cierra un issue",
      );
      const caja = conOtroBloque(otra, `${DECLARACION}\n  /^x\\//,\n];`);
      const hallazgos = desajustes(seisCopias(laDeAqui(), { caja }));
      expect(hallazgos).toHaveLength(1);
      expect(hallazgos[0]).toContain("«caja» no dice lo mismo");
      expect(hallazgos[0]).toContain("Se aparta en la linea 1 de su archivo");
    });

    it("codigo metido DENTRO de la lista sale rojo: el bloque propio no es una exencion", () => {
      const conCodigo = conOtroBloque(
        laDeAqui(),
        `${DECLARACION}\n  /^backend\\//,\n  ...(process.env.SIN_FILA ? [] : [/^x\\//]),\n` +
          // Y la que empieza y acaba como un patron y lleva codigo en medio: una expresion
          // regular que casara `^\/.+\/,$` la daria por buena.
          "  /^a\\// || console.log('sin fila') || /^b\\//,\n" +
          // El contraste, dentro de la misma lista: una barra escapada y otra dentro de una
          // clase no cierran el literal, y un patron asi SI es un patron.
          "  /^docs\\/10-negocio\\/[/]catalogo\\//iu,\n];",
      );
      const hallazgos = desajustes(seisCopias(laDeAqui(), { rentas: conCodigo }));
      expect(hallazgos).toHaveLength(1);
      expect(hallazgos[0]).toContain("«rentas»");
      expect(hallazgos[0]).toContain("no son un patron ni un comentario");
      expect(hallazgos[0]).toContain("...(process.env.SIN_FILA");
      expect(hallazgos[0]).toContain("console.log('sin fila')");
      expect(hallazgos[0]).not.toContain("catalogo");
    });

    it("EL CENTINELA, en muestra: una copia que falta sale roja, no se comparan cinco", () => {
      const hallazgos = desajustes(seisCopias(laDeAqui(), { identidad: undefined }));
      expect(hallazgos).toHaveLength(1);
      expect(hallazgos[0]).toContain("«identidad» no tiene su copia del guion");
    });

    it("sin la declaracion exportada, o con dos, no se sabe que comparar y sale rojo", () => {
      const sinExport = laDeAqui().replace(DECLARACION, "const RUTAS_DE_CODIGO = [");
      const conDos = laDeAqui().replace(
        "const DONDE_VIVE_LA_FILA",
        `${DECLARACION}\n  /^x\\//,\n];\n\nconst DONDE_VIVE_LA_FILA`,
      );
      const hallazgos = desajustes(seisCopias(laDeAqui(), { caja: sinExport, catastro: conDos }));
      expect(hallazgos).toHaveLength(2);
      expect(hallazgos[0]).toContain("«caja»");
      expect(hallazgos[0]).toContain("tiene 0 lineas");
      expect(hallazgos[1]).toContain("«catastro»");
      expect(hallazgos[1]).toContain("tiene 2 lineas");
    });
  });
});
