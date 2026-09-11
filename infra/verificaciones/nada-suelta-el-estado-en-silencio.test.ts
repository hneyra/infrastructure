/**
 * `PULUMI_K8S_DELETE_UNREACHABLE` no puede quedarse fija: soltar estado tiene que costar un
 * acto deliberado.
 *
 * ## Que hace esa variable, y que NO hace
 *
 * Le dice al proveedor de Kubernetes que **suelte del estado de Pulumi los recursos que no
 * pudo LEER**. Su propio mensaje de error la ofrece como remedio para «si el cluster fue
 * borrado», y ahi esta la trampa: el proveedor no sabe si el cluster fue borrado o si no llego
 * a el. Lo unico que sabe es que la lectura fallo.
 *
 * ## El defecto que la trajo, medido el 2026-09-11
 *
 * `prod` cambio de nodo (#92, #1) y su primer `pulumi up` murio con **74 recursos errados** en
 * el refresco, todos `sgtm-prod-*`:
 *
 * ```
 * kubernetes:helm.cattle.io/v1:HelmChartConfig sgtm-prod-sistema:kube-system/traefik refreshing
 * error: failed to read resource state due to unreachable cluster
 * ```
 *
 * Su estado esta congelado en la forma **pre-renombrado** —no aplicaba nada desde el
 * 2026-08-23, o sea desde antes de que `sgtm` saliera del codigo— y el proveedor
 * `sgtm-prod-kubernetes` lleva dentro el kubeconfig del nodo VIEJO.
 *
 * **No era la red ni el kubeconfig**: en la misma corrida `comprobar-lo-asignable.sh` habia
 * leido el nodo NUEVO (5 CPU / 10145128Ki) y `capacidad --estricto` habia dicho `cabe`.
 *
 * ## Por que esto es una guarda y no un comentario
 *
 * Con la variable puesta, esa corrida avanza — a cambio de soltar 36 objetos que **siguen
 * corriendo** en el nodo viejo (medido: `vmd120205` seguia sirviendo en su 80 y 443). Quedan
 * huerfanos hasta que alguien apague la maquina. Es aceptable en una mudanza, y es un acto que
 * alguien tiene que decidir.
 *
 * Fija seria otra cosa: **cualquier fallo transitorio del tunel soltaria estado en silencio**, y
 * el sintoma no seria un error sino un `up` en verde que deja de gestionar lo que gestionaba.
 * Por eso cuelga de una entrada de `workflow_dispatch` que hay que marcar a mano, y por eso
 * esto se pone rojo si alguien la desengancha.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { raizDelRepositorio } from "../componentes/fuentes";

const VARIABLE = "PULUMI_K8S_DELETE_UNREACHABLE";
const ENTRADA = "soltar_recursos_inalcanzables";
const LINEAS = readFileSync(
  join(raizDelRepositorio(), ".github/workflows/infra.yml"),
  "utf8",
).split("\n");

/** Donde el flujo nombra la variable como CODIGO, no en un comentario. */
function dondeSeNombra(): { linea: number; bloque: string }[] {
  return LINEAS.map((texto, i) => ({ texto, i }))
    .filter(({ texto }) => texto.includes(VARIABLE) && !texto.trimStart().startsWith("#"))
    // El valor puede caer en las lineas siguientes: en YAML `>-` lo parte.
    .map(({ i }) => ({ linea: i + 1, bloque: LINEAS.slice(i, i + 4).join("\n") }));
}

describe("soltar estado de Pulumi cuesta un acto deliberado", () => {
  it("el flujo nombra la variable, o esta guarda no mide nada", () => {
    // El centinela. Si la variable desaparece —porque la mudanza termino y alguien la
    // retiro— esto se pone rojo, y entonces lo que hay que hacer es retirar esta guarda con
    // ella en el mismo commit, no bajar la afirmacion.
    expect(
      dondeSeNombra().length,
      `el flujo no nombra \`${VARIABLE}\` en ninguna linea de codigo. Si se retiro a proposito, ` +
        "esta guarda se queda sin sujeto y sale con ella.",
    ).toBeGreaterThan(0);
  });

  it("cada aparicion exige la entrada del dispatch Y que la corrida sea un dispatch", () => {
    for (const { linea, bloque } of dondeSeNombra()) {
      expect(
        bloque,
        `\`${VARIABLE}\` (linea ${String(linea)}) no exige la entrada \`${ENTRADA}\`. Fija, ` +
          "cualquier fallo transitorio del tunel soltaria estado EN SILENCIO: el sintoma no " +
          "seria un error, seria un `up` en verde que deja de gestionar lo que gestionaba.",
      ).toContain(ENTRADA);
      expect(
        bloque,
        `\`${VARIABLE}\` (linea ${String(linea)}) no exige que la corrida sea un ` +
          "`workflow_dispatch`. Sin eso, un `push` a `main` la activaria.",
      ).toContain("workflow_dispatch");
    }
  });

  it("la entrada nace en false y dice en el formulario lo que cuesta", () => {
    const texto = LINEAS.join("\n");
    const i = texto.indexOf(`${ENTRADA}:`);
    expect(i, `el flujo no declara la entrada \`${ENTRADA}\``).toBeGreaterThan(0);
    const declaracion = texto.slice(i, i + 420);
    expect(
      declaracion,
      "la entrada no nace en `false`: marcada por omision, deja de ser un acto deliberado.",
    ).toMatch(/default:\s*false/);
    expect(
      declaracion,
      "la descripcion no avisa de lo que cuesta. Quien la marca tiene que leerlo en el " +
        "formulario, no descubrirlo despues.",
    ).toMatch(/PELIGRO/);
  });
});
