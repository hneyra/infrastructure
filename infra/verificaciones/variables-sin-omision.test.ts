import { describe, expect, it } from "vitest";
import { emitir } from "../herramientas/emitir-manifiestos";
import { ENVIRONMENTS } from "../config";
import { SISTEMAS_CON_APLICACION, exigidasPor, variablesSinOmision } from "./variables-sin-omision";

/**
 * C-7 §4 — el pod levanta con lo que el descriptor le pone.
 *
 * Lo que aqui se mide no es que el manifiesto sea valido: eso lo mide la auditoria. Es que la
 * aplicacion que va dentro **pueda resolver su configuracion**. Una variable sin valor por omision
 * que el descriptor no pone deja a Spring sin poder resolver el marcador, y el contexto muere
 * antes de atender nada — que es lo que le pasaba al pod de `caja` desde P5D, con el hueco escrito
 * en su propio descriptor y nadie midiendolo.
 *
 * ## Solo los `Deployment`, y hay que decir por que
 *
 * Los `Job` de migracion de los cuatro sistemas quedan FUERA, y no por comodidad: hoy **no
 * migran**. Medido sobre los manifiestos de `stg`, el de `catastro` es
 * `ghcr.io/hneyra/kamayuk-catastro:<tag>` —la MISMA imagen que el Deployment, porque el descriptor
 * declara `imagenes: [SISTEMA]`, una sola— con `SGTM_DB_USUARIO=sgtm_owner` y **sin**
 * `SPRING_PROFILES_ACTIVE`. O sea: arranca la aplicacion, no el migrador, y la aplicacion tiene
 * `spring.flyway.enabled: false` a proposito (ARQ-03 §4). Incluir esos Jobs aqui pondria esta
 * guarda roja por un defecto que no es el que mide, y arreglarlo exige decidir antes que imagen
 * publica cada repositorio —el `Dockerfile` tiene dos objetivos, `aplicacion` y `migrador`, y el
 * descriptor declara una— . Queda declarado en C-7 §huecos.
 */

interface Contenedor {
  name: string;
  env?: { name: string; value?: string; valueFrom?: unknown }[];
}

function contenedoresDe(ambiente: (typeof ENVIRONMENTS)[number], sistema: string) {
  const lista = JSON.parse(emitir({ ambiente })) as {
    items: {
      kind: string;
      metadata: { name: string; namespace?: string };
      spec?: { template?: { spec?: { containers?: Contenedor[] } } };
    }[];
  };
  return lista.items
    .filter((m) => m.kind === "Deployment" && m.metadata.namespace?.startsWith(`kamayuk-${sistema}-`))
    .flatMap((m) =>
      (m.spec?.template?.spec?.containers ?? []).map((c) => ({ pod: m.metadata.name, contenedor: c })),
    );
}

describe("toda variable sin valor por omision la pone el descriptor", () => {
  for (const ambiente of ENVIRONMENTS) {
    for (const sistema of SISTEMAS_CON_APLICACION) {
      it(`«${sistema}» en «${ambiente}»`, () => {
        const contenedores = contenedoresDe(ambiente, sistema);
        expect(
          contenedores.length,
          `«${sistema}» no compone ningun Deployment en «${ambiente}». Con cero contenedores esta ` +
            "comprobacion pasaria sin mirar nada.",
        ).toBeGreaterThan(0);

        for (const { pod, contenedor } of contenedores) {
          const puestas = new Set((contenedor.env ?? []).map((e) => e.name));
          const perfil = (contenedor.env ?? []).find((e) => e.name === "SPRING_PROFILES_ACTIVE")?.value;
          expect(
            perfil,
            `«${pod}» no declara SPRING_PROFILES_ACTIVE. Sin el no se sabe que bloque del ` +
              "application.yaml aplica, y esta comprobacion mediria el equivocado.",
          ).toBeDefined();

          const faltan = exigidasPor(sistema, perfil as string).filter((v) => !puestas.has(v));
          expect(
            faltan,
            `«${pod}» (perfil ${perfil}) no declara ${faltan.join(", ")}. El application.yaml de ` +
              "«" + sistema + "» las exige SIN valor por omision, asi que Spring no puede resolver " +
              "el marcador y el pod no levanta: no arranca degradado, no arranca.",
          ).toEqual([]);
        }
      });
    }
  }

  /**
   * El contraste. Sin el, un lector que no encontrara ninguna variable —un regex roto, un archivo
   * que se movio— dejaria las ocho pruebas de arriba en verde sin haber comprobado nada.
   */
  it("y el lector encuentra de verdad las que hay: `caja` exige las dos de ADR-0026 §4", () => {
    expect(exigidasPor("caja", "web")).toContain("KAMAYUK_CAJA_RESPONSABLE");
    expect(exigidasPor("caja", "web")).toContain("KAMAYUK_CAJA_CANAL");
    expect(exigidasPor("caja", "web")).toContain("SGTM_DB_URL");
  });

  /**
   * Y el perfil separa: `SGTM_OIDC_EMISOR` solo se exige en `web`. Exigirsela a un proceso de lote
   * seria pedir que la maquina que corre una determinacion de madrugada pueda ver Keycloak.
   */
  it("y el perfil separa: el emisor OIDC es del bloque `web`, no del comun", () => {
    const { comunes, porPerfil } = variablesSinOmision("rentas");
    expect(comunes).not.toContain("SGTM_OIDC_EMISOR");
    expect(porPerfil["web"]).toContain("SGTM_OIDC_EMISOR");
    expect(exigidasPor("rentas", "batch")).not.toContain("SGTM_OIDC_EMISOR");
  });
});
