/**
 * Que un merge en un hermano llegue solo a `stg` — y que NO llegue solo a `prod`.
 *
 * ## El hueco que esto cierra
 *
 * `infra.yml` sólo puede filtrar por rutas **de este repositorio**, así que una migración de
 * `rentas` no disparaba nada. Está declarado desde P6 en `infra.yml:92-94`: «se cierra con un
 * disparo entre repositorios (`repository_dispatch`), que no está hecho».
 *
 * Medido el 2026-09-13, antes de que existiera: `prod` iba **61 commits** por detrás de los
 * cinco `main` sumados —`rentas` 33, `caja` 16, `identidad` 7, `catastro` 3, `normativa` 2— y
 * `stg` estaba **más atrás que `prod`** en `rentas` (45 contra 33). No es que `stg` fuera por
 * delante: es que cada línea se clavó a mano en un momento distinto.
 *
 * ## La mitad que esta guarda existe para proteger
 *
 * **ADR-0011 §6 dice que `prod` es «`pulumi up` con aprobación manual explícita. Nunca
 * automático».** El puente escribe en `Pulumi.stg.yaml` y en ningún otro sitio, y eso no es una
 * simplificación: es la decisión. Si alguien le añade `prod`, esta guarda se pone roja — porque
 * el día que pase, lo que se pierde no se nota hasta que ya pasó.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { raizDelRepositorio } from "../componentes/fuentes";
import { SISTEMAS, clonDe } from "./deriva-de-migraciones";

const EVENTO = "version-publicada";

interface Flujo {
  jobs?: Record<string, { needs?: string | string[]; if?: string; steps?: { run?: string }[] }>;
}

function flujoDelHermano(nombre: string, clon: string): Flujo {
  return load(
    readFileSync(join(clon, ".github/workflows/publicar-imagenes.yml"), "utf8"),
  ) as Flujo;
}

function declararVersion(): { texto: string; doc: Record<string, unknown> } {
  const texto = readFileSync(
    join(raizDelRepositorio(), ".github/workflows/declarar-version.yml"),
    "utf8",
  );
  return { texto, doc: load(texto) as Record<string, unknown> };
}

describe("el puente entre repositorios: un merge en un hermano llega a stg", () => {
  it("EL CENTINELA: se leyeron los cinco hermanos", () => {
    // Sin esto, un clon que falte dejaría el barrido recorriendo una lista más corta y en
    // verde habiendo mirado menos, que es el modo de fallo de toda guarda que barre.
    expect(
      SISTEMAS.map((s) => s.nombre).sort(),
      "no se leyeron los cinco sistemas: este barrido mide menos de lo que dice",
    ).toEqual(["caja", "catastro", "identidad", "normativa", "rentas"]);
  });

  for (const sistema of SISTEMAS) {
    const flujo = flujoDelHermano(sistema.nombre, clonDe(sistema));
    const avisar = flujo.jobs?.["avisar"];

    it(`«${sistema.nombre}» avisa a infrastructure cuando publica`, () => {
      expect(
        avisar,
        `«${sistema.nombre}» publica su imagen y no avisa a nadie. Su versión se quedaría sin ` +
          "desplegar hasta que alguien subiera la línea a mano en `Pulumi.stg.yaml`, que es de " +
          "donde salen los 61 commits de retraso que este puente existe para cerrar.",
      ).toBeDefined();
    });

    it(`«${sistema.nombre}» avisa DESPUES de comprobar que la imagen se puede pedir`, () => {
      const necesita = [avisar?.needs ?? []].flat();
      expect(
        necesita,
        "el aviso cuelga de `publicar` y no de `comprobar`. Un `push` sin error no es lo mismo " +
          "que una etiqueta que se pueda PEDIR al registro: avisar de una versión cuya imagen " +
          "no baja deja el pod en `ImagePullBackOff` con el `up` en verde.",
      ).toContain("comprobar");
    });

    it(`«${sistema.nombre}» solo avisa al integrar en main`, () => {
      expect(
        avisar?.if ?? "",
        "el aviso no exige `push` a `main`. En un PR la imagen ni siquiera se publica, así que " +
          "avisar desde ahí pediría desplegar una versión que no existe.",
      ).toContain("refs/heads/main");
    });

    it(`«${sistema.nombre}» se nombra a SI MISMO en el aviso`, () => {
      // La trampa de copiar el trabajo de un hermano a otro: el `sistema` del payload se queda
      // con el nombre del anterior, y `infrastructure` clava la versión del sistema equivocado
      // —un sha que además existe, porque es el de otro repositorio—.
      const guion = (avisar?.steps ?? []).map((s) => s.run ?? "").join("\n");
      expect(
        guion,
        `el aviso de «${sistema.nombre}» no dice que el sistema es «${sistema.nombre}». Copiado ` +
          "de otro hermano sin cambiar esa línea, clavaría la versión del sistema equivocado con " +
          "un sha que existe — y eso no falla: despliega otra cosa.",
      ).toContain(`client_payload[sistema]=${sistema.nombre}`);
    });
  }

  it("`declarar-version.yml` escucha el evento que los hermanos mandan", () => {
    const { doc } = declararVersion();
    const disparadores = (doc[String(true)] ?? doc["on"]) as {
      repository_dispatch?: { types?: string[] };
    };
    expect(
      disparadores.repository_dispatch?.types ?? [],
      "el flujo no escucha `repository_dispatch`, así que los cinco avisos no los recoge nadie.",
    ).toContain(EVENTO);
  });

  it("valida lo que llega de otro repositorio, y no se lo cree", () => {
    const { texto } = declararVersion();
    expect(
      texto,
      "no comprueba que el `sha` sean 40 hexadecimales. Un sha inventado de cuarenta caracteres " +
        "ya se coló una vez escribiéndolo a mano, y aquí ni siquiera lo escribe una persona.",
    ).toMatch(/\$\{#SHA\}.*40|40.*hexadecimales/s);
    for (const sistema of SISTEMAS) {
      expect(
        texto,
        `no valida «${sistema.nombre}» contra la lista de sistemas con imagen`,
      ).toContain(sistema.nombre);
    }
  });

  it("pregunta al registro ANTES de clavar la etiqueta", () => {
    const { texto } = declararVersion();
    expect(
      texto,
      "no comprueba que la imagen exista antes de clavarla. Clavar una etiqueta inexistente NO " +
        "falla: deja los pods en `ImagePullBackOff` con el manifiesto válido y el `up` en verde.",
    ).toContain("ghcr.io/v2/");
  });

  it("NO escribe en `prod`, que es la decisión y no una simplificación", () => {
    const { texto } = declararVersion();
    // Sin comentarios, y es la lección de #76: el docblock de este flujo EXPLICA por qué no
    // toca `prod`, así que un barrido sobre el texto entero se pondría rojo por la prosa que
    // dice lo correcto — y el remedio sería borrar la explicación, que es lo contrario.
    const codigo = texto
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("#"))
      .join("\n");
    expect(
      codigo,
      "este flujo nombra `Pulumi.prod.yaml`. **ADR-0011 §6 dice que `prod` es «`pulumi up` con " +
        "aprobación manual explícita. Nunca automático»**, y subir su línea sola retira la única " +
        "pausa humana que existe antes de que un migrador escriba el esquema de producción — sin " +
        "rollback de esquema y con el procedimiento de reversión marcado «NO ensayado».",
    ).not.toContain("Pulumi.prod.yaml");
    expect(codigo, "y tiene que escribir en el de `stg`").toContain("Pulumi.stg.yaml");
  });
});
