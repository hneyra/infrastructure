import { describe, expect, it } from "vitest";
import {
  checkInvariants,
  ENVIRONMENTS,
  MissingConfigError,
  readInvariants,
  type ConfigReader,
} from "../config";
import { leerStack, textoDelStack } from "./stacks";

/**
 * Los `Pulumi.<ambiente>.yaml` versionados en este repositorio cumplen sus propias
 * invariantes.
 *
 * `config.test.ts` demuestra que las reglas muerden contra configuraciones construidas
 * a mano. Esta prueba las aplica a **los archivos reales**, que es donde el
 * incumplimiento ocurriria de verdad: alguien sube el plazo de archivado del WAL,
 * publica un puerto «un momento» o le pone etiqueta a la imagen, y nada se pone rojo
 * hasta que alguien mira.
 *
 * Y hace algo que `pulumi preview` no puede hacer aqui: **corre sin Pulumi**. El
 * `preview` de CI necesita el token de Pulumi Cloud y los dos stacks creados; esta
 * prueba solo necesita el archivo, asi que la demostracion del issue —quitar un valor
 * obligatorio de `Pulumi.prod.yaml` y ver que se pone rojo diciendo cual falta— se
 * puede correr en cualquier maquina, tambien en un PR de alguien de fuera.
 */

describe("los stacks versionados cumplen sus invariantes", () => {
  it.each(ENVIRONMENTS)("Pulumi.%s.yaml", (ambiente) => {
    const invariantes = readInvariants(ambiente, leerStack(ambiente));
    expect(checkInvariants(invariantes)).toEqual([]);
  });

  it("prod no lleva ninguno de los atajos de stg", () => {
    const prod = readInvariants("prod", leerStack("prod"));
    expect(prod.ingress.acmeStaging).toBe(false);
    expect(prod.identity.seedTestUsers).toBe(false);
    expect(prod.backup.restoreSourceBucket).toBeUndefined();
  });

  it("stg va marcada como instalacion de demostracion", () => {
    const stg = readInvariants("stg", leerStack("stg"));
    expect(stg.application.isDemonstration).toBe(true);
  });

  it("los dos ambientes respaldan en contenedores distintos", () => {
    const stg = readInvariants("stg", leerStack("stg"));
    const prod = readInvariants("prod", leerStack("prod"));
    expect(stg.backup.bucket).not.toBe(prod.backup.bucket);
  });

  /**
   * El origen del ensayo de `stg` es el contenedor de `prod`, y nada lo ataba (#112).
   *
   * `config.ts` valida POR STACK: exige que `restoreSourceBucket` solo este en `stg` y que no
   * sea el suyo propio, pero ninguna de las dos puede saber como se llama el contenedor de
   * `prod`. Y la unica prueba cruzada que habia solo exige que los dos sean DISTINTOS. O sea
   * que al mudar `prod` de contenedor —que es lo que #112 obligo a hacer— olvidarse de esta
   * linea pasaba en verde, y dejaba el ensayo de INF-03 §2 apuntando a un contenedor retirado.
   * Es la forma de C-17: dos mitades de una frontera y nada que las compare.
   *
   * <p>⚠ Lo que esta guarda NO prueba, y hay que decirlo para que nadie lo suponga: que ese
   * valor lo use alguien. Medido el 2026-09-12, <b>no lo consume nadie</b> —
   * `infra/respaldo/contra-cluster.sh` toma el prefijo del `Deployment` de `stg` en marcha, asi
   * que lo que se ensaya es restaurar `stg` desde `stg`—. Esto ata dos declaraciones para que
   * no puedan discrepar en silencio; cablearlo o retirarlo es otro trabajo, y tiene issue.
   */
  it("el origen del ensayo de stg es el contenedor de respaldo real de prod", () => {
    const stg = readInvariants("stg", leerStack("stg"));
    const prod = readInvariants("prod", leerStack("prod"));
    expect(
      stg.backup.restoreSourceBucket,
      "«restoreSourceBucket» de stg tiene que ser el contenedor en el que prod respalda HOY: " +
        "si no, el ensayo de INF-03 §2 lee un contenedor que ya no recibe nada, y eso no da " +
        "error el dia que se cambia — da error el dia que hay que restaurar",
    ).toBe(prod.backup.bucket);
  });

  it("ningun stack versiona un secreto en claro", () => {
    for (const ambiente of ENVIRONMENTS) {
      const texto = textoDelStack(ambiente);
      const lineas = texto.split("\n").filter((l) => !l.trimStart().startsWith("#"));
      for (const clave of [
        "kubeconfig",
        "backupAccessKeyId",
        "backupSecretAccessKey",
      ]) {
        expect(
          lineas.some((l) => l.includes(`kamayuk:${clave}:`)),
          `«${clave}» no puede estar en Pulumi.${ambiente}.yaml sin cifrar`,
        ).toBe(false);
      }
    }
  });
});

describe("la demostracion del issue: quitar un valor obligatorio pone rojo el stack", () => {
  it("sin `domain`, la lectura de prod falla diciendo cual falta", () => {
    const completo = leerStack("prod");
    const sinDominio: ConfigReader = {
      ...completo,
      text: (clave) => (clave === "domain" ? undefined : completo.text(clave)),
    };

    let error: unknown;
    try {
      readInvariants("prod", sinDominio);
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(MissingConfigError);
    expect((error as MissingConfigError).key).toBe("domain");
    expect((error as Error).message).toContain("kamayuk:domain");
  });
});
