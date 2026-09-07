import { describe, expect, it } from "vitest";
import { raizDelRepositorio } from "../componentes/fuentes";
import { ENVIRONMENTS } from "../config";
import { invariantesDe } from "./stacks";
import {
  AMBITO_DE_SERVICIO,
  clienteDeServicio,
  credencialesDeServicio,
  desajustes,
  realm,
  serviciosDeclarados,
  ubigeosDeclarados,
} from "./identidad-de-servicio";

/**
 * #21 — la identidad de servicio, y que no pueda volver a nacer un secreto que no sirve.
 *
 * Lo que estas pruebas sostienen esta en {@link ./identidad-de-servicio.ts}; aqui solo se
 * ejercen. La que importa es la ultima: **las dos fuentes tienen que decir lo mismo**, y hasta
 * #21 ninguna miraba a la otra.
 */

const RAIZ = raizDelRepositorio();

describe("el realm versionado declara la maquinaria de la identidad de servicio (AC-1)", () => {
  it(`declara el ambito «${AMBITO_DE_SERVICIO}»`, () => {
    const ambitos = (realm(RAIZ).clientScopes ?? []).map((a) => a.name);
    expect(ambitos).toContain(AMBITO_DE_SERVICIO);
  });

  it("y ese ambito lleva `municipalidad_id` AL TOKEN DE ACCESO, que es lo unico que lo acota", () => {
    const ambito = (realm(RAIZ).clientScopes ?? []).find((a) => a.name === AMBITO_DE_SERVICIO);
    const mapa = (ambito?.protocolMappers ?? []).find((m) => m.name === "municipalidad-id");
    expect(mapa, "sin el mapeador, el token de la cuenta de servicio no dice de que municipalidad es").toBeDefined();
    // El claim en el ID token no sirve de nada: quien autoriza lee el de acceso.
    expect(mapa?.config?.["access.token.claim"]).toBe("true");
    expect(mapa?.config?.["claim.name"]).toBe("municipalidad_id");
  });

  it("ningun cliente con cuenta de servicio es publico", () => {
    // Un cliente publico no tiene clave: su `client_credentials` lo puede pedir cualquiera que
    // sepa el `clientId`, y el token saldria con el `municipalidad_id` de esa cuenta dentro.
    const publicosConCuenta = (realm(RAIZ).clients ?? [])
      .filter((c) => c.serviceAccountsEnabled === true && c.publicClient !== false)
      .map((c) => c.clientId);
    expect(publicosConCuenta).toEqual([]);
  });
});

describe("las cuentas de servicio se declaran por municipalidad (ADR-0028 §2)", () => {
  it("hay al menos una municipalidad declarada, o esto no mide nada", () => {
    // El contraste: sin sujeto, todas las comprobaciones de abajo se cumplirian solas.
    expect(ubigeosDeclarados(RAIZ).length).toBeGreaterThan(0);
  });

  it("y al menos una cuenta de servicio, por lo mismo", () => {
    expect(serviciosDeclarados(RAIZ).length).toBeGreaterThan(0);
  });

  it("el identificador del cliente lleva el ubigeo, que es lo que impide un token para todas", () => {
    const ubigeos = ubigeosDeclarados(RAIZ);
    const ids = serviciosDeclarados(RAIZ).map((s) => clienteDeServicio(s.sistema, s.ubigeo));
    expect(new Set(ids).size, "dos municipalidades no pueden compartir cliente").toBe(ids.length);
    for (const u of ubigeos) {
      expect(ids.filter((i) => i.endsWith(`-${u}`)).length).toBeGreaterThan(0);
    }
  });
});

describe("el inventario y la identidad declarativa dicen lo mismo (AC-6)", () => {
  it.each(ENVIRONMENTS)(
    "%s: toda credencial de emisor tiene su cuenta, y toda cuenta tiene quien la pida",
    (ambiente) => {
      const hallazgos = desajustes(RAIZ, invariantesDe(ambiente));
      expect(hallazgos, hallazgos.join("\n\n")).toEqual([]);
    },
  );

  it.each(ENVIRONMENTS)("%s: hay al menos una credencial de emisor que comprobar", (ambiente) => {
    // El contraste de #21: con `emisor` sin declarar en ningun descriptor, la comprobacion de
    // arriba pasa en verde sobre el conjunto vacio — que es el estado exacto del que este issue
    // sale, con `KAMAYUK_CATASTRO_CREDENCIAL` declarada, generada y rechazada con 401.
    expect(credencialesDeServicio(invariantesDe(ambiente)).length).toBeGreaterThan(0);
  });
});
