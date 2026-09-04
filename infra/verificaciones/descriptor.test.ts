import { describe, expect, it } from "vitest";
import { auditarManifiestos } from "../auditoria";
import { clasesDePrioridad, nombreDePrioridad } from "../componentes/convenciones";
import {
  auditarDescriptor,
  componerDescriptores,
  manifiestosDe,
  type ContextoDeDescriptores,
  type EntornoDelDescriptor,
} from "../descriptor";
import {
  despliegueSinLimitesNiSondas,
  etiquetaDeImagenPropia,
  privilegiosSobreBaseAjena,
  rutaFueraDeSuPrefijo,
  secretoEnClaro,
} from "../descriptor/muestras/prohibidos";
import { catastro, rentas } from "../descriptor/muestras/validos";

/**
 * El contrato del descriptor (ADR-0031 §2), verificado sobre lo que devuelve.
 *
 * Diez pruebas y dos mitades. Las cinco de las prohibiciones exigen que la auditoria
 * rechace; las de los dos descriptores validos exigen que **acepte**, y son la mitad que
 * impide que una guarda que grita siempre se acabe esquivando.
 */

const ENTORNO: EntornoDelDescriptor = {
  ambiente: "stg",
  namespace: "kamayuk-catastro-stg",
  dominio: "stg.sgtm.example",
  etiquetas: { "app.kubernetes.io/part-of": "kamayuk", ambiente: "stg" },
  imagenDe: (c) => `ghcr.io/hneyra/kamayuk-${c}:0eee58e43e04b1c2d3f4a5b6c7d8e9f0a1b2c3d4`,
  secretoDe: (c) => `kamayuk-stg-${c}`,
  prioridadDe: (clase) => nombreDePrioridad("stg", clase),
  operacion: { responsable: "Jefa de Tesoreria", canal: "tesoreria@example.pe" },
};

/**
 * La plataforma que `infrastructure` aporta. Aqui solo hacen falta las `PriorityClass`,
 * que son de alcance de clúster: sin ellas, **cualquier descriptor correcto sale rojo**
 * por dos clases que no le toca definir. Ver el javadoc de `ContextoDeDescriptores`.
 */
const CONTEXTO: ContextoDeDescriptores = {
  secretoDeOwner: "kamayuk-stg-owner",
  basesDelClustre: ["rentas", "catastro", "normativa", "caja"],
  manifiestosDeLaPlataforma: clasesDePrioridad("stg"),
};

/** El entorno de un sistema cualquiera: el namespace lleva su nombre. */
function entornoDe(sistema: string): EntornoDelDescriptor {
  return { ...ENTORNO, namespace: `kamayuk-${sistema}-stg` };
}

describe("los dos descriptores validos pasan", () => {
  // Sin esto, `auditarDescriptor` podria estar rechazandolo todo y las cinco pruebas de
  // las prohibiciones seguirian en verde. Es la mitad que no se puede quitar.
  it("`catastro`, con un perfil, no tiene ni un problema", () => {
    expect(auditarDescriptor(catastro, entornoDe("catastro"), CONTEXTO)).toEqual([]);
  });

  it("`rentas`, con DOS perfiles, tampoco", () => {
    expect(auditarDescriptor(rentas, entornoDe("rentas"), CONTEXTO)).toEqual([]);
  });

  it("y el de dos perfiles produce de verdad dos Deployments, no uno", () => {
    const clases = manifiestosDe(rentas, entornoDe("rentas"))
      .filter((m) => m.kind === "Deployment")
      .map((m) => m.metadata.name);
    expect(clases).toEqual(["kamayuk-rentas-web", "kamayuk-rentas-batch"]);
  });
});

describe("lo que un descriptor NO puede hacer", () => {
  const rechaza = (d: Parameters<typeof auditarDescriptor>[0], sistema = "catastro") =>
    auditarDescriptor(d, entornoDe(sistema), CONTEXTO);

  it("(a) declarar una ruta fuera de su prefijo", () => {
    const problemas = rechaza(rutaFueraDeSuPrefijo);
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("reclama «/rentas/contribuyentes»");
    expect(problemas[0]).toContain("fuera de su prefijo «/catastro»");
  });

  it("(b) declarar la etiqueta de la imagen", () => {
    const problemas = rechaza(etiquetaDeImagenPropia);
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("ghcr.io/hneyra/kamayuk-catastro:v2.4.1");
    expect(problemas[0]).toContain("no sale de `entorno.imagenDe()`");
    // El motivo, no solo el hecho: es la prohibicion que sostiene a las otras cuatro.
    expect(problemas[0]).toContain("cuello de botella");
  });

  it("(c) pedir privilegios sobre la base de otro sistema", () => {
    const problemas = rechaza(privilegiosSobreBaseAjena);
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("«catastro_app» pide privilegios sobre la base «rentas»");
    expect(problemas[0]).toContain("de otro sistema");
  });

  it("(d) un Deployment sin limites de recursos ni sondas", () => {
    const problemas = rechaza(despliegueSinLimitesNiSondas);
    expect(problemas.join("\n")).toContain("sin requests ni limits de recursos");
    expect(problemas.join("\n")).toContain("INF-01 §4");
  });

  it("(e) un Secret en claro, por sus dos caminos", () => {
    const problemas = rechaza(secretoEnClaro);
    expect(problemas.join("\n")).toContain("un descriptor no emite Secrets");
    expect(problemas.join("\n")).toContain("trae «valor»");
  });
});

describe("las convenciones de INF-01 §4 valen IGUAL para un descriptor ajeno", () => {
  /**
   * Es el punto entero del diseno, y la forma de medirlo es que la prohibicion (d) **no
   * este implementada en `descriptor/auditoria.ts`**: la hereda de `auditarManifiestos`,
   * el mismo que audita `BaseDeDatos.ts`. Se comprueba comparando las dos listas.
   */
  it("la (d) la produce `auditarManifiestos`, no una copia", () => {
    const entorno = entornoDe("catastro");
    const heredada = { secretoDeOwner: CONTEXTO.secretoDeOwner, namespace: entorno.namespace };
    const soloPlataforma = new Set(
      auditarManifiestos([...CONTEXTO.manifiestosDeLaPlataforma], heredada),
    );
    const propios = auditarManifiestos(
      [...CONTEXTO.manifiestosDeLaPlataforma, ...manifiestosDe(despliegueSinLimitesNiSondas, entorno)],
      heredada,
    ).filter((p) => !soloPlataforma.has(p));
    const ajenos = auditarDescriptor(despliegueSinLimitesNiSondas, entorno, CONTEXTO);
    expect(propios.length).toBeGreaterThan(0);
    // Los del descriptor son los mismos, con el sistema delante para saber a quien reclamar.
    for (const p of propios) expect(ajenos).toContain(`[catastro] ${p}`);
  });

  it("y un rol superusuario se rechaza: omite RLS aunque haya FORCE", () => {
    const conSuperusuario = {
      ...catastro,
      baseDeDatos: () => ({
        nombre: "catastro",
        roles: [
          {
            nombre: "catastro_app",
            sobre: ["catastro"],
            privilegios: ["ALL"],
            superusuario: true as unknown as false,
          },
        ],
      }),
    };
    const problemas = auditarDescriptor(conSuperusuario, entornoDe("catastro"), CONTEXTO);
    expect(problemas.join("\n")).toContain("se declara superusuario");
    expect(problemas.join("\n")).toContain("DAT-01 §0, hallazgo 1");
  });
});

describe("la composicion", () => {
  it("hoy compone CERO descriptores, y por eso los manifiestos no cambian", () => {
    // Ninguno de los cuatro sistemas publica el suyo todavia. El dia que entre el
    // primero, esta prueba se pone roja y el cambio se ve en el diff de los manifiestos.
    const { manifiestos, problemas } = componerDescriptores([], entornoDe, CONTEXTO);
    expect(manifiestos).toEqual([]);
    expect(problemas).toEqual([]);
  });

  it("dos sistemas no pueden reclamar el mismo prefijo", () => {
    const gemelo = { ...rentas, sistema: "otro" };
    const { problemas } = componerDescriptores(
      [
        { version: "1.0.0", descriptor: rentas },
        { version: "1.0.0", descriptor: gemelo },
      ],
      entornoDe,
      CONTEXTO,
    );
    expect(problemas.join("\n")).toContain("dos sistemas reclaman el prefijo «rentas»");
  });

  it("compone los dos validos juntos sin un solo problema", () => {
    const { manifiestos, problemas } = componerDescriptores(
      [
        { version: "1.0.0", descriptor: catastro },
        { version: "2.3.1", descriptor: rentas },
      ],
      entornoDe,
      CONTEXTO,
    );
    expect(problemas).toEqual([]);
    expect(manifiestos.length).toBeGreaterThan(0);
  });
});
