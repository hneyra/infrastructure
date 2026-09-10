import { describe, expect, it } from "vitest";
import { CLIENTE_DEL_BACKOFFICE, CLIENTE_DE_VERIFICACION, realmDelCiudadano } from "../componentes/Identidad";
import { realmCiudadanoJson, realmDeFuncionariosJson } from "../componentes/fuentes";
import { ENVIRONMENTS } from "../config";
import { invariantesDe } from "./stacks";

/**
 * `#70` — el nombre del realm estaba escrito DOS veces, y nada comprobaba que coincidieran.
 *
 * Los dos caminos que levantan este producto leen el nombre del realm de sitios distintos:
 *
 * | Camino | De donde sale |
 * |---|---|
 * | El compose (`--import-realm`) | el campo `realm` de `despliegue/identidad/realm-kamayuk.json` |
 * | El cluster (Pulumi) | `identity.realm`, o sea `kamayuk:keycloakRealm` de cada stack, y `Identidad.ts` **descarta** el campo del archivo y pone ese |
 *
 * Mientras nadie los comparara, renombrar uno dejaba el otro atras **en silencio**. Y el
 * sintoma no sale por donde se mira: `reconciliar-realm.sh` pregunta por `realms/$KC_REALM`,
 * no lo encuentra, y **crea** un realm con el nombre que el manifiesto le puso; el `update`
 * que va detras apunta al otro nombre y muere. Desde el navegador se ve un formulario de
 * acceso que no conoce a nadie.
 *
 * Medido al renombrar `sgtm` a `kamayuk` (#70): cambiar el archivo versionado y el valor por
 * omision de `config.ts` **no fue suficiente** —los dos stacks fijan `kamayuk:keycloakRealm`
 * explicitamente, asi que ese valor por omision no se alcanza en ningun ambiente real— y la
 * unica prueba que lo delato fue una que comparaba el emisor **compuesto**, por casualidad.
 * Esta lo compara a proposito.
 *
 * No exige que el realm se llame de ninguna manera concreta: exige que **los dos caminos digan
 * lo mismo**. Un producto que se renombre otra vez seguira teniendo esta red.
 */
describe("#70 · el nombre del realm es el mismo por los dos caminos", () => {
  const versionado = JSON.parse(realmDeFuncionariosJson()) as { realm?: string; clients?: { clientId?: string }[] };
  const versionadoDelCiudadano = JSON.parse(realmCiudadanoJson()) as { realm?: string };

  it("EL CENTINELA: el archivo versionado declara un realm y algun cliente", () => {
    // Sin esto, todo lo de abajo se cumpliria sobre `undefined`, que es la forma en que una
    // guarda se queda sin sujeto y sigue saliendo verde.
    expect(versionado.realm, "el realm de funcionarios no declara su nombre").toBeTruthy();
    expect(versionadoDelCiudadano.realm, "el realm del ciudadano no declara su nombre").toBeTruthy();
    expect(versionado.clients ?? [], "el realm versionado no declara ningun cliente").not.toHaveLength(0);
  });

  it.each(ENVIRONMENTS)("el realm que despliega «%s» es el del archivo versionado", (ambiente) => {
    expect(
      invariantesDe(ambiente).identity.realm,
      `«${ambiente}» despliega un realm distinto del que levanta el compose: el navegador entraria ` +
        "a un emisor y los backends validarian contra otro, y el 401 no dice por que",
    ).toBe(versionado.realm);
  });

  it("el realm del ciudadano se deriva del de funcionarios, y su archivo lo respeta", () => {
    expect(
      versionadoDelCiudadano.realm,
      "el segundo emisor no es `<realm>-ciudadano`, y `realmDelCiudadano()` lo compone asi para " +
        "el cluster: el portal validaria contra un realm que nadie importa",
    ).toBe(realmDelCiudadano(versionado.realm ?? ""));
  });

  it("los dos clientes que el cluster nombra por constante existen en el archivo versionado", () => {
    // `Identidad.ts` filtra y compone por estos dos nombres. Renombrar un `clientId` en el
    // archivo y no aqui no da ningun error: deja el filtro buscando algo que no esta, y el
    // cliente que no debia salir de `prod` sale.
    const declarados = (versionado.clients ?? []).map((c) => c.clientId);
    expect(declarados, "el cliente del backoffice no esta en el realm versionado").toContain(
      CLIENTE_DEL_BACKOFFICE,
    );
    expect(declarados, "el cliente de verificacion no esta en el realm versionado").toContain(
      CLIENTE_DE_VERIFICACION,
    );
  });
});
