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
 * ## Todo pod que corra la imagen de la APLICACION, y hay que decir por que
 *
 * Hasta C-14 esto miraba **solo** los `Deployment`, y no por comodidad: los `Job` de migracion de
 * los cuatro sistemas corrian la MISMA imagen que el `Deployment` con `SGTM_DB_USUARIO=sgtm_owner`
 * y sin `SPRING_PROFILES_ACTIVE`, o sea que arrancaban la aplicacion sin migrar nada. Incluirlos
 * habria puesto esta guarda roja por un defecto que no era el que mide.
 *
 * Con C-14 cada sistema publica **dos** imagenes —`aplicacion` y `migrador`, los dos objetivos de
 * su `Dockerfile`— y el Job de migracion corre la suya, que no es una aplicacion de Spring. Asi
 * que el criterio deja de ser la clase del objeto y pasa a ser **la imagen**: se mide todo
 * contenedor cuya imagen sea la de la aplicacion de ese sistema —`Deployment`, el `Job` de
 * implantacion y los `CronJob` del perfil `batch`— y se deja fuera el migrador, que no lee ningun
 * `application.yaml`.
 *
 * Derivar el criterio de la imagen y no de una lista es lo que hace que un `CronJob` nuevo entre
 * solo: su pod arranca la misma aplicacion y falla igual si le falta una variable.
 */

interface Contenedor {
  name: string;
  image: string;
  env?: { name: string; value?: string; valueFrom?: unknown }[];
}

interface PlantillaDePodJson {
  spec?: { containers?: Contenedor[] };
}

interface ManifiestoJson {
  kind: string;
  metadata: { name: string; namespace?: string };
  spec?: {
    template?: PlantillaDePodJson;
    jobTemplate?: { spec?: { template?: PlantillaDePodJson } };
  };
}

/**
 * Todo contenedor de ese sistema que corra la imagen de su APLICACION.
 *
 * El migrador queda fuera **por su imagen**, no por su clase: no es una aplicacion de Spring, no
 * lleva `application.yaml` dentro y sus variables son otras tres. Y los `initContainers` no se
 * miran, que es lo mismo dicho por el otro lado: el unico que hay es el migrador.
 */
function contenedoresDe(ambiente: (typeof ENVIRONMENTS)[number], sistema: string) {
  const lista = JSON.parse(emitir({ ambiente })) as { items: ManifiestoJson[] };
  const imagenDeLaAplicacion = new RegExp(`/kamayuk-${sistema}:`);
  return lista.items
    .filter((m) => m.metadata.namespace?.startsWith(`kamayuk-${sistema}-`) === true)
    .flatMap((m) => {
      const plantilla = m.spec?.template ?? m.spec?.jobTemplate?.spec?.template;
      return (plantilla?.spec?.containers ?? []).map((c) => ({ pod: m.metadata.name, contenedor: c }));
    })
    .filter(({ contenedor }) => imagenDeLaAplicacion.test(contenedor.image));
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
   * C-14 — y se miden mas cosas que los `Deployment`: el Job de implantacion y los `CronJob`
   * corren la MISMA aplicacion y fallan igual si les falta una variable.
   *
   * Sin esto, extender el criterio de la clase a la imagen podria no haber anadido ni un
   * contenedor y las ocho pruebas de arriba seguirian midiendo lo mismo que antes.
   */
  it("y no son solo los Deployment: entran la implantacion y los CronJob", () => {
    const pods = contenedoresDe("stg", "rentas").map((c) => c.pod);
    expect(pods.some((p) => p.includes("implantacion"))).toBe(true);
    expect(pods.some((p) => p.includes("ingestor"))).toBe(true);
    // Y el migrador NO, porque no es una aplicacion de Spring: su imagen es otra.
    expect(pods.some((p) => p.includes("migracion"))).toBe(false);
  });

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
