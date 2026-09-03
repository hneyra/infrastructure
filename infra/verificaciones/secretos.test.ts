import { describe, expect, it } from "vitest";
import { inventarioDeSecretos, SECRETOS_DE_ARRANQUE } from "../componentes/secretos";
import { ENVIRONMENTS } from "../config";

/**
 * El inventario de INF-06 (issue #154), sin tocar ningun cluster ni generar ninguna
 * clave: aqui solo se prueban los METADATOS —que no haya una entrada duplicada, que
 * ningun secreto de la aplicacion se cuele en la lista de arranque de Pulumi—.
 */

describe("inventarioDeSecretos", () => {
  it.each(ENVIRONMENTS)("%s: ninguna entrada de (secreto, clave) se repite", (ambiente) => {
    const entradas = inventarioDeSecretos(ambiente);
    const pares = entradas.map((e) => `${e.secreto}/${e.clave}`);
    expect(new Set(pares).size).toBe(pares.length);
  });

  it.each(ENVIRONMENTS)("%s: cada rol tiene un identificador unico", (ambiente) => {
    const roles = inventarioDeSecretos(ambiente).map((e) => e.rol);
    expect(new Set(roles).size).toBe(roles.length);
  });

  it("los dos ambientes nombran Secret distintos (sin compartir namespace)", () => {
    const [stg, prod] = ENVIRONMENTS.map((a) => new Set(inventarioDeSecretos(a).map((e) => e.secreto)));
    for (const nombre of stg!) {
      expect(prod!.has(nombre), `«${nombre}» aparece en los dos ambientes`).toBe(false);
    }
  });

  it("ningun secreto de la aplicacion aparece tambien en la lista de arranque de Pulumi", () => {
    // La demostracion de ADR-0011 §3 hecha estructural: si alguien reintrodujera
    // `keycloakAdminPassword` en SECRETOS_DE_ARRANQUE —el error que este issue corrige—,
    // esta prueba lo detecta sin que nadie tenga que acordarse de mirar.
    const deArranque = new Set(SECRETOS_DE_ARRANQUE.map((s) => s.clave));
    const deLaAplicacion = new Set(inventarioDeSecretos("prod").map((e) => e.rol));
    for (const clave of deArranque) {
      expect(deLaAplicacion.has(clave), `«${clave}» esta en las dos listas`).toBe(false);
    }
  });
});
