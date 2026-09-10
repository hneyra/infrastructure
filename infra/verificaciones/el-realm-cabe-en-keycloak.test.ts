import { describe, expect, it } from "vitest";
import { realmCiudadanoJson, realmDeFuncionariosJson } from "../componentes/fuentes";

/**
 * `#71` — Keycloak no arrancaba porque una cadena del realm versionado no cabia en su columna.
 *
 * Medido el 2026-09-10 levantando la plataforma local: el contenedor quedaba en `Exited (1)` y
 * **no servia un solo token**, con este registro:
 *
 * ```
 * Full importing from file /opt/keycloak/bin/../data/import/realm-kamayuk.json
 * Value too long for column "DESCRIPTION CHARACTER VARYING(255)":
 *   "U&'El ambito de una identidad de servicio (ADR-0028 \\00a72). Lleva `municipalida... (390)"
 * ERROR: Failed to start server in (development) mode
 * ```
 *
 * El `description` del ambito `kamayuk-servicio` medía **390** caracteres y
 * `CLIENT_SCOPE.DESCRIPTION` es `varchar(255)` —en H2 y en PostgreSQL—. Estaba asi desde que #21
 * anadio el ambito, y **no lo vio nadie** porque `--import-realm` solo importa la PRIMERA vez: el
 * fallo aparece cuando alguien recrea el contenedor o levanta la plataforma en una maquina nueva,
 * que es justo cuando menos se sospecha de un archivo versionado. El camino del cluster tiene el
 * mismo sujeto: `reconciliar-realm.sh` hace `create realms -f` con el mismo contenido.
 *
 * Esta guarda existe porque **el sintoma esta lejos de la causa**: «Keycloak no arranca» no se
 * parece a «una cadena de un JSON tiene 168 caracteres de mas», y el camino de diagnostico pasa
 * por leer un volcado de Hibernate.
 *
 * ## Lo que el `description` decia y ya no cabe
 *
 * El texto largo explicaba, ademas de lo que quedo: que el ambito **no declara ningun cliente**
 * —los clientes por municipalidad los crea `reconciliar-identidades.sh servicios` leyendo
 * `municipalidades/<ubigeo>.json`— y que es asi **porque una clave de cliente no puede vivir en
 * git** (ADR-0012). Queda escrito aqui y en el docblock de `identidad-de-servicio.ts`, que es
 * donde se razona sobre el ambito.
 */
const LARGO_DE_KEYCLOAK = 255;

/** Los campos que Keycloak guarda en columnas `varchar(255)` y que estos archivos escriben. */
function textosAcotados(realm: Record<string, unknown>): { donde: string; valor: string }[] {
  const recogidos: { donde: string; valor: string }[] = [];
  const anadir = (donde: string, valor: unknown) => {
    if (typeof valor === "string") recogidos.push({ donde, valor });
  };
  anadir("realm.displayName", realm["displayName"]);
  for (const ambito of (realm["clientScopes"] ?? []) as Record<string, unknown>[]) {
    anadir(`clientScope «${String(ambito["name"])}».name`, ambito["name"]);
    anadir(`clientScope «${String(ambito["name"])}».description`, ambito["description"]);
  }
  for (const cliente of (realm["clients"] ?? []) as Record<string, unknown>[]) {
    anadir(`client «${String(cliente["clientId"])}».name`, cliente["name"]);
    anadir(`client «${String(cliente["clientId"])}».description`, cliente["description"]);
  }
  return recogidos;
}

describe("#71 · lo que el realm versionado escribe cabe en las columnas de Keycloak", () => {
  const realms = {
    funcionarios: JSON.parse(realmDeFuncionariosJson()) as Record<string, unknown>,
    ciudadano: JSON.parse(realmCiudadanoJson()) as Record<string, unknown>,
  };

  it("EL CENTINELA: hay campos que medir en los dos archivos", () => {
    // Sin sujeto, lo de abajo pasaria sobre la lista vacia — que es como esta guarda se
    // quedaria sin nada que vigilar el dia que alguien reordene los archivos.
    for (const [cual, realm] of Object.entries(realms)) {
      expect(textosAcotados(realm), `el realm «${cual}» no expone ningun texto acotado`).not.toHaveLength(0);
    }
  });

  it.each(Object.keys(realms))("los textos del realm «%s» caben en 255", (cual) => {
    const pasados = textosAcotados(realms[cual as keyof typeof realms])
      .filter((t) => t.valor.length > LARGO_DE_KEYCLOAK)
      .map((t) => `${t.donde}: ${t.valor.length} caracteres`);
    expect(
      pasados,
      "Keycloak guarda estos campos en `varchar(255)`: una cadena mas larga no se recorta, hace " +
        "fallar el `--import-realm` y **el contenedor no arranca** —«Value too long for column»—, " +
        "asi que la plataforma no sirve ni un token y el sintoma no se parece a la causa (#71)",
    ).toEqual([]);
  });
});
