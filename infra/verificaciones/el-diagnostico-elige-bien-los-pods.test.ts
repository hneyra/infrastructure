/**
 * El diagnostico de CI elegia los pods a volcar por su **fase**, y fallaba en las dos
 * direcciones (#67, #68).
 *
 * ```
 * -o jsonpath='{range .items[?(@.status.phase!="Running")]}...'
 * ```
 *
 * - **Se dejaba fuera lo que hay que leer**: un pod en `CrashLoopBackOff` tiene
 *   `status.phase: Running`. La fase dice si los contenedores fueron admitidos y
 *   programados, no si estan sanos. Por eso el registro de `kamayuk-identidad-web` no
 *   salio en el volcado del 2026-09-10: el guion recorrio el namespace y no lo conto.
 * - **Y metia lo que entierra**: un `Job` que termino BIEN tiene fase `Succeeded`, que
 *   tampoco es `Running`, asi que quedaba volcado con su `describe` entero y sus 200
 *   lineas de registro. En un ambiente con implantaciones y migraciones, eso son
 *   cientos de lineas de ruido **delante** del error que se fue a buscar.
 *
 * ## Por que esta prueba puede existir
 *
 * La version anterior no se podia comprobar sin levantar de verdad un pod en
 * `CrashLoopBackOff`, asi que vivio rota sin que nada lo dijera. La decision de que pod
 * volcar sale ahora a una funcion con su propio modo —`--clasificar`, que lee de la
 * entrada estandar— y **esto la ejerce con casos sinteticos, sin cluster**.
 *
 * Lo que NO comprueba: que `kubectl` produzca ese formato. Eso es de la version del
 * cliente y exige un cluster; lo que se fija aqui es la decision, que es lo que estaba mal.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { raizDelRepositorio } from "../componentes/fuentes";

const GUION = join(raizDelRepositorio(), ".github/diagnostico-del-namespace.sh");

/** `nombre  fase  listos  motivos`, el formato que el guion pide a `kubectl`. */
function linea(nombre: string, fase: string, listos: string, motivos = ""): string {
  return [nombre, fase, listos, motivos].join("\t");
}

/** Los nombres que el guion volcaria, dado ese estado. */
function elegidos(lineas: string[]): string[] {
  const salida = execFileSync("bash", [GUION, "--clasificar"], {
    input: lineas.join("\n") + "\n",
    encoding: "utf8",
  });
  return salida
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => l.split("\t")[0] ?? "");
}

describe("#67 y #68 · el diagnostico elige los pods por su salud, no por su fase", () => {
  it("EL CENTINELA: con un pod roto, elige a alguien", () => {
    // Si el formato o el modo `--clasificar` se rompen, todas las demas pruebas dirian
    // «no eligio a nadie» y pasarian las que esperan exclusion. Esta lo impide.
    expect(
      elegidos([linea("roto", "Pending", "")]),
      "el clasificador no devolvio nada ni con un pod Pending: no esta midiendo nada",
    ).toEqual(["roto"]);
  });

  it("#67 · un pod en CrashLoopBackOff se vuelca, aunque su fase sea Running", () => {
    expect(
      elegidos([linea("en-bucle", "Running", "false,", "CrashLoopBackOff,")]),
      "un pod en CrashLoopBackOff tiene `status.phase: Running`. Elegir por la fase lo " +
        "deja fuera SIEMPRE, y su registro —que es donde esta el motivo— no se vuelca " +
        "nunca. Es el defecto por el que `kamayuk-identidad-web` no salio en el volcado " +
        "del 2026-09-10.",
    ).toEqual(["en-bucle"]);
  });

  it("#68 · un Job que termino bien NO se vuelca", () => {
    expect(
      elegidos([linea("migracion-ok", "Succeeded", "false,")]),
      "un pod `Succeeded` no es `Running`, asi que elegir por la fase lo volcaba entero " +
        "—`describe` mas 200 lineas de registro— cada vez. Con cinco namespaces llenos de " +
        "Job terminados, eso entierra el error que el volcado existe para ensenar.",
    ).toEqual([]);
  });

  it("un pod sano no se vuelca, y uno con UN contenedor caido si", () => {
    expect(elegidos([linea("sano", "Running", "true,true,")])).toEqual([]);
    expect(
      elegidos([linea("un-sidecar-caido", "Running", "true,false,", ",ImagePullBackOff,")]),
      "con varios contenedores basta con que UNO no este listo: un sidecar caido deja el " +
        "pod sirviendo a medias, que es justo lo que hay que mirar.",
    ).toEqual(["un-sidecar-caido"]);
  });

  it("Pending, Failed y Unknown siguen entrando", () => {
    expect(
      elegidos([
        linea("pendiente", "Pending", ""),
        linea("fallido", "Failed", "false,", "Error,"),
        linea("desconocido", "Unknown", ""),
      ]),
      "estos tres ya entraban por la fase y tienen que seguir entrando: el `Pending` es el " +
        "que trae el «Insufficient cpu» del planificador, que es el caso que este guion " +
        "existe para resolver.",
    ).toEqual(["pendiente", "fallido", "desconocido"]);
  });

  it("de una tanda mezclada elige exactamente los tres que estan mal", () => {
    expect(
      elegidos([
        linea("web-sano", "Running", "true,"),
        linea("en-bucle", "Running", "false,", "CrashLoopBackOff,"),
        linea("migracion-ok", "Succeeded", "false,"),
        linea("implantacion-ok", "Succeeded", "false,"),
        linea("pendiente", "Pending", ""),
        linea("fallido", "Failed", "false,", "Error,"),
      ]),
    ).toEqual(["en-bucle", "pendiente", "fallido"]);
  });

  it("el motivo de la espera viaja con el pod, para que se lea sin abrir el describe", () => {
    const salida = execFileSync("bash", [GUION, "--clasificar"], {
      input: linea("en-bucle", "Running", "false,", "CrashLoopBackOff,") + "\n",
      encoding: "utf8",
    });
    expect(
      salida,
      "sin el motivo, hay que abrir el `describe` para saber si es una imagen que no baja " +
        "o un contenedor que revienta al arrancar.",
    ).toContain("CrashLoopBackOff");
  });
});
