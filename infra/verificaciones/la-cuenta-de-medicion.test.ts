/**
 * #196 — la cuenta con la que se mide una interfaz desplegada existe, sólo donde toca, y su clave
 * no está en este árbol.
 *
 * ## El defecto, medido y no supuesto
 *
 * El 2026-09-16, contra `stg`: `https://<dominio>/caja/` contesta 200, su `configuracion.js` monta
 * el emisor `…/keycloak/realms/kamayuk` con `kamayuk-backoffice`, el emisor contesta su
 * `.well-known` → 200, y `GET /caja/api/v1/seguridad/sesion` contesta **401** — que es lo correcto
 * sin token. Y ahí se acababa: **no había ninguna cuenta con clave disponible fuera del clúster**,
 * así que nadie podía comprobar que una interfaz de Kamayuk *entra*. Lo que se bloqueaba con eso no
 * es una curiosidad: ADR-0040 condiciona rutar la interfaz de `caja` en `prod` a haber medido en
 * `stg` el login PKCE, el catálogo filtrado y una hoja leyendo un dato real.
 *
 * ## Las cuatro mitades, y por qué ninguna vale sola
 *
 * Cada una falla **en silencio** sin las otras, y por eso las cuatro son rojo:
 *
 *  1. **La fila `MEDICION` del TSV** — sin ella el `Job` del realm no crea la cuenta, y lo único
 *     que se ve es un `invalid_grant` al pedir el token.
 *  2. **La clave en el inventario** — sin ella `bootstrap-secretos.sh` no genera nada, y el `Job`
 *     monta un `secretKeyRef` que no existe: el pod se queda en `ContainerCreating` con la causa
 *     sólo en sus eventos.
 *  3. **El cableado del `Job`** — una clave generada que nadie lee no cambia nada.
 *  4. **Y sólo donde se siembran usuarios de prueba** — una cuenta con clave permanente en `prod`
 *     es una puerta que nadie pidió, y no da ningún error: funciona.
 *
 * ## Y el nombre, contra el clon hermano
 *
 * La cuenta tiene **dos mitades con dos dueños** (ADR-0012 §5): ésta la crea en Keycloak, y su fila
 * de `usuario` la crea `ImplantarMunicipalidad` de `identidad`. Lo único que las une es el
 * `preferred_username` (ADR-0005). Si los dos nombres se separan, la cuenta autentica, llega hasta
 * el guardia, y recibe **403 «no está dada de alta en este sistema»** — un 403 que no se parece a su
 * causa, y exactamente el que la etapa 4 de ADR-0039 pagó con las cuatro cuentas de servicio.
 *
 * Desde ninguno de los dos repositorios se ve el otro. Éste es el único sitio donde las dos puntas
 * se ven a la vez, que es el papel que ADR-0031 le da a `infrastructure` — y por eso **esta guarda
 * sale roja entre la mezcla de `identidad`#50 y la de este PR**: se mezclan seguidos, y este
 * repositorio va el último. Es el mismo trato que el catálogo de accesos (AC-4).
 *
 * ## Lo que NO puede comprobar
 *
 * Que la cuenta exista **de verdad** en un Keycloak desplegado, y que su token abra
 * `/caja/api/v1/seguridad/sesion`. Eso exige el ambiente delante y el `KUBECONFIG` de su
 * *environment*; el procedimiento está en
 * `docs/B0-operacion/runbooks/medir-una-interfaz-con-login-real.md` y su resultado se anota ahí.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { construirManifiestos } from "../componentes";
import { CLAVES } from "../componentes/convenciones";
import { CUENTA_DE_MEDICION } from "../componentes/Identidad";
import { inventarioDelAmbiente } from "../componentes/secretos";
import { raizDelRepositorio, reconciliarIdentidadesSh } from "../componentes/fuentes";
import { ENVIRONMENTS, resourceName, type Environment } from "../config";
import { invariantesDe } from "./stacks";

interface Variable {
  readonly name: string;
  readonly value?: string;
  readonly valueFrom?: { valueFrom?: unknown; secretKeyRef?: { name: string; key: string } };
}

/** El `ConfigMap` del realm y el `env` del `Job` que lo aplica, de un ambiente ya compuesto. */
function realmDe(ambiente: Environment): { tsv: string; variables: Variable[] } {
  const manifiestos = construirManifiestos(invariantesDe(ambiente));
  const prefijo = resourceName(ambiente, "realm");
  const configuracion = manifiestos.find(
    (m) => m.kind === "ConfigMap" && m.metadata.name.startsWith(prefijo),
  ) as unknown as { data: Record<string, string> } | undefined;
  expect(configuracion, `«${ambiente}» no compone el ConfigMap del realm`).toBeDefined();
  const job = manifiestos.find(
    (m) => m.kind === "Job" && m.metadata.name.startsWith(prefijo),
  ) as unknown as
    | { spec: { template: { spec: { containers: { env?: Variable[] }[] } } } }
    | undefined;
  expect(job, `«${ambiente}» no compone el Job del realm`).toBeDefined();
  return {
    tsv: configuracion?.data["identidades.tsv"] ?? "",
    variables: (job?.spec.template.spec.containers ?? []).flatMap((c) => c.env ?? []),
  };
}

/** La fila `MEDICION` del TSV, si la hay. */
function filaDeMedicion(tsv: string): string[] | undefined {
  const fila = tsv.split("\n").find((l) => l.startsWith("MEDICION\t"));
  return fila === undefined ? undefined : fila.split("\t");
}

describe("#196 · la cuenta con la que se mide una interfaz desplegada", () => {
  it("hay un ambiente que siembra usuarios de prueba y otro que no, o esto no mide nada", () => {
    // El centinela, como en #77 y #149: si los dos ambientes cayeran del mismo lado, las dos
    // afirmaciones de abajo pasarian sin distinguir nada.
    expect(ENVIRONMENTS.some((a) => invariantesDe(a).identity.seedTestUsers)).toBe(true);
    expect(ENVIRONMENTS.some((a) => !invariantesDe(a).identity.seedTestUsers)).toBe(true);
  });

  it.each(ENVIRONMENTS)("«%s»: la cuenta se declara donde hay usuarios de prueba", (ambiente) => {
    const siembra = invariantesDe(ambiente).identity.seedTestUsers;
    const { tsv } = realmDe(ambiente);
    const fila = filaDeMedicion(tsv);

    if (!siembra) {
      expect(
        fila,
        `«${ambiente}» no siembra usuarios de prueba y aun asi declara la cuenta de medicion. ` +
          "Una cuenta con clave PERMANENTE en un ambiente sin usuarios de prueba es una puerta " +
          "que nadie pidio, y no da ningun error: funciona (INF-03 §4).",
      ).toBeUndefined();
      return;
    }

    expect(
      fila,
      `«${ambiente}» siembra usuarios de prueba y NO declara la fila MEDICION del TSV. Sin ella ` +
        "el `Job` del realm no crea la cuenta, y lo unico que se ve es un `invalid_grant` al " +
        "pedir el token — que se lee como una clave mal escrita (#196).",
    ).toBeDefined();
    // cuenta, nombre, apellido, correo, municipalidadId, grupo, clave.
    expect(fila).toHaveLength(8);
    expect(fila?.[1]).toBe(CUENTA_DE_MEDICION);
    expect(
      fila?.[7],
      "la fila MEDICION tiene que llevar el NOMBRE de la clave del inventario, no su valor.",
    ).toBe(CLAVES.cuentaDeMedicion);
    expect(
      fila?.[6],
      "la cuenta de medicion tiene que ir al grupo de la municipalidad, como cualquier " +
        "funcionario: de ahi sale el `municipalidad_id` documental del grupo.",
    ).not.toBe("");
  });

  it.each(ENVIRONMENTS)("«%s»: su clave sale del Secret del emisor, y sólo ahí", (ambiente) => {
    const siembra = invariantesDe(ambiente).identity.seedTestUsers;
    const variable = realmDe(ambiente).variables.find((v) => v.name === "KC_CLAVE_DE_MEDICION");

    if (!siembra) {
      expect(
        variable,
        `«${ambiente}» no siembra la cuenta y el Job monta su clave igualmente. Una credencial ` +
          "de mas en un pod es una credencial de mas.",
      ).toBeUndefined();
      return;
    }

    expect(
      variable,
      "el `Job` del realm no declara `KC_CLAVE_DE_MEDICION`: `bootstrap-secretos.sh` genera la " +
        "clave y no la lee nadie, asi que la cuenta nace sin clave util.",
    ).toBeDefined();
    expect(
      variable?.value,
      "`KC_CLAVE_DE_MEDICION` trae un valor LITERAL en el manifiesto. Un secreto en un " +
        "manifiesto es un secreto en el repositorio (ADR-0011 §3).",
    ).toBeUndefined();
    expect(variable?.valueFrom?.secretKeyRef?.key).toBe(CLAVES.cuentaDeMedicion);
    expect(
      variable?.valueFrom?.secretKeyRef?.name,
      "tiene que salir del `Secret` del emisor del ambiente, que es el que el `Job` ya monta.",
    ).toBe(resourceName(ambiente, "keycloak"));
  });

  it.each(ENVIRONMENTS)("«%s»: la clave está en el inventario, y sólo donde toca", (ambiente) => {
    const siembra = invariantesDe(ambiente).identity.seedTestUsers;
    const entrada = inventarioDelAmbiente(invariantesDe(ambiente)).find(
      (e) => e.clave === CLAVES.cuentaDeMedicion,
    );

    if (!siembra) {
      expect(
        entrada,
        `el inventario de «${ambiente}» declara una clave que ninguna cuenta de ese ambiente usa.`,
      ).toBeUndefined();
      return;
    }
    expect(
      entrada,
      "la clave no esta en el inventario, asi que `bootstrap-secretos.sh` no la genera: el " +
        "`secretKeyRef` del `Job` apunta a una clave que no existe y el pod se queda en " +
        "`ContainerCreating` con la causa solo en sus eventos (C-17).",
    ).toBeDefined();
    expect(entrada?.secreto).toBe(resourceName(ambiente, "keycloak"));
    expect(
      entrada?.periodicidad,
      "una credencial sin rotacion declarada es una que nadie rota (INF-06).",
    ).toBe("semestral");
  });

  it("el guion la consume, y la fija PERMANENTE", () => {
    // La otra mitad: un `Secret` cableado que nadie lee falla igual de callado que no cablearlo.
    const guion = reconciliarIdentidadesSh();
    expect(
      guion,
      "`reconciliar-identidades.sh` no menciona `KC_CLAVE_DE_MEDICION`: la clave viaja al pod y " +
        "no la usa nadie.",
    ).toContain("KC_CLAVE_DE_MEDICION");
    expect(
      guion,
      "el guion no sabe leer la fila `MEDICION` del TSV, asi que el `Job` moriria con «linea de " +
        "tipo desconocido».",
    ).toContain("MEDICION)");
    // Y sin `UPDATE_PASSWORD`: es la diferencia con un funcionario, y la que decide si la cuenta
    // sirve. Se mide sobre el bloque de la fila `MEDICION` y se busca `requiredActions`, que es el
    // MECANISMO —`-s 'requiredActions=["UPDATE_PASSWORD"]'`— y no la palabra: el propio comentario
    // del bloque nombra `UPDATE_PASSWORD` para explicar por que no esta, y buscar la palabra
    // ponia esta guarda roja con el codigo correcto delante (medido al escribirla).
    const bloque = guion.slice(
      guion.indexOf("        MEDICION)"),
      guion.indexOf("        CIUDADANO)"),
    );
    expect(bloque, "no se encontro el bloque de la fila MEDICION").not.toBe("");
    expect(
      bloque,
      "la cuenta de medicion se crearia con `requiredActions`, como un funcionario. Con " +
        "`UPDATE_PASSWORD` pendiente su clave permanente no sirve: Keycloak contesta " +
        "`invalid_grant` al `grant_type=password` (#196).",
    ).not.toContain("requiredActions");
    expect(
      bloque,
      "la clave no se fija con `set-password`, que es lo unico que la entrega.",
    ).toContain("set-password");
  });

  it("su clave no está en este árbol, en ninguna forma", () => {
    // Lo que no puede estar es un VALOR: la clave nombrada y algo detras. Se busca sobre los
    // archivos versionados —`git ls-files`, que deja fuera `node_modules` y lo construido— y se
    // exime esta misma guarda, que la nombra para poder afirmarlo.
    const raiz = raizDelRepositorio();
    const versionados = execFileSync("git", ["-C", raiz, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\0")
      .filter((r) => r !== "");
    expect(versionados.length, "`git ls-files` no devolvio nada").toBeGreaterThan(100);

    // `clave-de-medicion: "algo"`, `KC_CLAVE_DE_MEDICION=algo`, `clave-de-medicion: YWJj` de un
    // `Secret`... Lo que se busca es la ASIGNACION, no la mencion: el nombre de la clave aparece
    // a proposito en el inventario, en el guion y en el runbook.
    const ASIGNA = /(?:clave-de-medicion|KC_CLAVE_DE_MEDICION)\s*[:=]\s*["']?[A-Za-z0-9+/=_.-]{8,}/;
    const YO = "infra/verificaciones/la-cuenta-de-medicion.test.ts";
    const culpables: string[] = [];
    for (const ruta of versionados) {
      if (ruta === YO) continue;
      const absoluta = join(raiz, ruta);
      if (!existsSync(absoluta)) continue;
      let texto: string;
      try {
        texto = readFileSync(absoluta, "utf8");
      } catch {
        continue;
      }
      if (ASIGNA.test(texto)) culpables.push(ruta);
    }
    expect(
      culpables,
      "alguien escribio un VALOR para la clave de la cuenta de medicion en el repositorio. Un " +
        "archivo versionado con contrasenas es la forma mas comoda de que una contrasena acabe " +
        "en produccion (ADR-0012 §2): esa clave la genera `bootstrap-secretos.sh` y vive en el " +
        "`Secret` `kamayuk-<amb>-keycloak`, y en ningun otro sitio.",
    ).toEqual([]);
  });

  it("y se llama igual que la cuenta que da de alta la implantación de `identidad`", () => {
    // Las dos mitades de una persona (ADR-0012 §5), cada una en su repositorio. Lo unico que las
    // une es el `preferred_username` (ADR-0005), y este es el unico sitio donde se ven las dos.
    const clon = resolve(raizDelRepositorio(), "..", "identidad");
    if (!existsSync(join(clon, ".git"))) {
      throw new Error(
        `No esta el clon de «identidad» en «${clon}», asi que no se puede comparar el nombre de ` +
          "la cuenta de medicion con el que da de alta su implantacion.\n" +
          `  Remedio: git clone https://github.com/hneyra/identidad ${clon}\n` +
          "  Esta comprobacion NO se salta: dos nombres distintos dan una cuenta que autentica y " +
          "recibe 403 «no esta dada de alta en este sistema», que no se parece a su causa.",
      );
    }
    const fuente = join(
      clon,
      "backend/kamayuk-identidad-nucleo/src/main/java/kamayuk/identidad/nucleo/aplicacion",
      "ImplantarMunicipalidad.java",
    );
    expect(existsSync(fuente), `no esta «${fuente}» en el clon de identidad`).toBe(true);
    const declarada = /CUENTA_DE_MEDICION\s*=\s*"([^"]+)"/.exec(readFileSync(fuente, "utf8"));
    expect(
      declarada,
      "`ImplantarMunicipalidad` del clon de `identidad` no declara `CUENTA_DE_MEDICION`. Hasta " +
        "que se mezcle hneyra/identidad#50 esto sale ROJO a proposito: la cuenta existiria en el " +
        "emisor y no tendria fila en ninguna copia de la autorizacion, o sea 403 para todo. Se " +
        "mezclan seguidos, y `infrastructure` va el ultimo.",
    ).not.toBeNull();
    expect(
      declarada?.[1],
      "el nombre de la cuenta no coincide con el que da de alta la implantacion de `identidad`.",
    ).toBe(CUENTA_DE_MEDICION);
  });
});
