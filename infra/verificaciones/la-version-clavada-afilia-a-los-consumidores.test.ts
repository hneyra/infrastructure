/**
 * La version clavada de `identidad` tiene que ser una que AFILIE a los consumidores del
 * buzon, porque el manifiesto declara esos consumidores y la imagen puede ser mas vieja.
 *
 * ## El hueco que cierra, y por que ninguna otra guarda lo veia
 *
 * Los cinco descriptores se importan del **clon hermano** —`descriptor/sistemas.ts:22` trae
 * `../../../identidad/infrastructure/src/descriptor`— y `clonar-los-hermanos` los clona **sin
 * `ref:`**, o sea de `main`. La imagen, en cambio, sale de `kamayuk:versionDe<Sistema>`.
 *
 * De ahi la asimetria: **el manifiesto es de `main` y el binario es del `sha` clavado.** Una
 * version atrasada corre codigo viejo contra un manifiesto nuevo, y eso no lo mide nadie:
 *
 *   - `deriva-de-migraciones` compara **migraciones**, y se callo con razon — `a0866be` y
 *     `main` traen las MISMAS tres (`V1`, `V2`, `V3`). El desfase era de comportamiento.
 *   - `imagenes-publicadas` pregunta si la etiqueta existe en el registro. Existia.
 *   - la suite entera salio **1007 en verde** el 2026-09-12 con `prod` en este estado.
 *
 * ## El defecto, medido en `prod` el 2026-09-11
 *
 * `prod` clavaba `a0866be` —la **etapa 3** de ADR-0039— y los cuatro satelites la **etapa 4**.
 * En la etapa 3 el grupo «Consumidores del buzon» **nace sin miembros**; en la etapa 4 los
 * cuatro satelites ya traen su consumidor. Asi que los consumidores existian y las cuentas
 * que los autorizan no, y los tres `Job` de implantacion murieron tras 7 intentos con:
 *
 *     `identidad` contesto 403 al leer el buzon: la cuenta de servicio de `rentas` existe y
 *     no tiene el acceso «eventos» — falta afiliarla al grupo «Consumidores del buzon»
 *
 * Confirmado en la base del nodo: **1** fila en `usuario` (tenian que ser 5), el grupo 2 con
 * **0** miembros y **166** eventos en el buzon, que es la aritmetica exacta de la etapa 3.
 * `stg` no lo tenia: clava `226ec6ff`, que si afilia — y esa asimetria es la que prueba que
 * esta guarda distingue algo real.
 *
 * ## Por que el marcador es `Consumidor.values()` y NO el nombre del grupo
 *
 * Es la trampa de esta medicion, y hay que dejarla escrita: `grupoDeConsumidoresDelBuzon`
 * aparece **dos veces en las tres versiones**, la etapa 3 incluida, porque el grupo ya se
 * creaba — vacio. Buscar el nombre del grupo daria verde sobre el defecto. Lo que separa a
 * las dos es el mecanismo que mete a los cuatro dentro, y ese es `Consumidor.values()`:
 * **1** en las versiones que afilian, **0** en `a0866be`.
 */
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { ENVIRONMENTS } from "../config";
import { manifiestosDelAmbiente } from "../herramientas/emitir-manifiestos";
import {
  clonDe,
  REVISION_DE_REFERENCIA,
  sistemaLlamado,
  sistemasDesplegados,
  versionDeclarada,
} from "./deriva-de-migraciones";
import { invariantesDe } from "./stacks";

const IDENTIDAD = sistemaLlamado("identidad");

/** Donde vive el mecanismo que da de alta y afilia a los cuatro consumidores. */
const IMPLANTACION =
  "backend/kamayuk-identidad-nucleo/src/main/java/kamayuk/identidad/nucleo/aplicacion/" +
  "ImplantarMunicipalidad.java";

/** El mecanismo. Ver el docblock: el nombre del grupo NO sirve como marcador. */
const AFILIACION = "Consumidor.values()";

/** Ese archivo, tal como lo trae una revision del clon de `identidad`. */
function implantacionEn(revision: string): string {
  try {
    return execFileSync("git", ["-C", clonDe(IDENTIDAD), "show", `${revision}:${IMPLANTACION}`], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    throw new Error(
      `«${revision}» no trae «${IMPLANTACION}» en el clon de \`identidad\`, asi que no se ` +
        "puede saber si esa imagen afilia a los consumidores del buzon.\n" +
        "  Si la clase se renombro, hay que remedir este marcador: una ruta que no existe " +
        "haria que esta guarda hablara de un archivo y no del despliegue.",
    );
  }
}

/** Los sistemas que el manifiesto declara como consumidores del buzon (`llamaA` = identidad). */
function consumidoresQueDeclara(ambiente: (typeof ENVIRONMENTS)[number]): string[] {
  const texto = JSON.stringify(manifiestosDelAmbiente(invariantesDe(ambiente)));
  // Las filas que `Identidad.ts` deriva a `servicios.tsv`: `SERVICIO <sistema> <llamaA> …`.
  const filas = texto.match(/SERVICIO\\t([a-z]+)\\tidentidad/g) ?? [];
  return [...new Set(filas.map((fila) => fila.split("\\t")[1] ?? ""))].sort();
}

const DESPLIEGAN_IDENTIDAD = ENVIRONMENTS.filter((ambiente) =>
  sistemasDesplegados(ambiente).includes(IDENTIDAD.nombre),
);

describe("la version clavada de identidad afilia a los consumidores del buzon", () => {
  it("algun ambiente despliega identidad, o esta guarda no mide nada", () => {
    // El centinela. Si `identidad` deja de desplegarse, esto se pone rojo y lo que hay que
    // hacer es retirar esta guarda con el, no bajar la afirmacion.
    expect(
      DESPLIEGAN_IDENTIDAD,
      "ningun ambiente despliega `identidad`, asi que no hay ninguna version clavada que " +
        "comprobar y esta guarda se queda sin sujeto.",
    ).not.toHaveLength(0);
  });

  it("el marcador existe en la referencia, o mediria una cadena muerta", () => {
    // La direccion de #27: un marcador que no nombra nada no exime ni acusa a nadie — pondria
    // TODA version en rojo, incluida la que si afilia, y el remedio seria el equivocado.
    expect(
      implantacionEn(REVISION_DE_REFERENCIA),
      `«${AFILIACION}» no esta en «${IMPLANTACION}» de ${REVISION_DE_REFERENCIA}. O el ` +
        "mecanismo se escribe de otra forma —y hay que remedir el marcador— o dejo de existir, " +
        "y entonces esta guarda acusaria a cualquier version de un defecto que ya no cabe.",
    ).toContain(AFILIACION);
  });

  it.each(DESPLIEGAN_IDENTIDAD)(
    "«%s» clava una identidad que da de alta y afilia a sus consumidores",
    (ambiente) => {
      const consumidores = consumidoresQueDeclara(ambiente);
      expect(
        consumidores,
        `el manifiesto de «${ambiente}» no declara ningun consumidor del buzon, asi que esta ` +
          "comprobacion se cumpliria sola. Las filas que se leen son las `SERVICIO <sistema> " +
          "identidad` que `Identidad.ts` deriva a `servicios.tsv`.",
      ).not.toHaveLength(0);

      const version = versionDeclarada(ambiente, IDENTIDAD);
      expect(
        implantacionEn(version),
        `«${ambiente}» declara ${consumidores.length} consumidor(es) del buzon ` +
          `—${consumidores.join(", ")}— y clava \`identidad\` en «${version.slice(0, 12)}», que ` +
          `NO afilia ninguno: su \`ImplantarMunicipalidad\` no usa \`${AFILIACION}\`.\n` +
          "  Es el estado que detuvo el estreno del nodo nuevo de `prod` el 2026-09-11: el grupo " +
          "«Consumidores del buzon» nace SIN MIEMBROS, cada consumidor recibe 403 «no tiene el " +
          "acceso eventos» en cada vuelta, y su copia local se queda como la dejo su " +
          "implantacion sin un solo error que lo diga.\n" +
          "  El manifiesto sale de `main` del clon hermano y la imagen de esta linea, asi que " +
          "una version atrasada corre codigo viejo contra un manifiesto nuevo.\n" +
          `  Remedio: subir \`kamayuk:versionDeIdentidad\` de \`Pulumi.${ambiente}.yaml\` a una ` +
          "revision que afilie, y con imagen publicada (`yarn imagenes --ambiente " +
          `${ambiente}\`).`,
      ).toContain(AFILIACION);
    },
  );
});
