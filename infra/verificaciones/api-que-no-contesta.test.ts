import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Un API server que no contesta se dice APARTE de un despliegue que falla (#708).
 *
 * `bootstrap-secretos.sh` es el primer guion del despliegue que habla con el cluster, asi
 * que cuando el API no responde el que sale rojo es el. El 2026-09-02 eso ocurrio dos
 * corridas seguidas y lo que quedaba en el log era «failed to download openapi: … TLS
 * handshake timeout», dentro de «Completando los secretos» y detras de una linea que
 * decia «generada». Leido asi parece un fallo de secretos, y no lo es.
 *
 * <h2>Se ejecuta el guion, no se lee</h2>
 *
 * Con un `kubectl` de mentira delante en el `PATH`, que es lo unico que hace falta para
 * que este guion se comporte como en CI: el de la primera prueba falla como falla
 * `kubectl` cuando vence su plazo, y el de la segunda contesta. Un `grep` sobre el
 * fuente afirmaria lo que el guion dice; esto comprueba lo que hace.
 *
 * <p>El `kubectl` de mentira ademas <b>anota sus argumentos</b>, y la primera prueba
 * exige que entre ellos venga `--request-timeout`. Sin el, un API que no contesta no
 * falla: se queda esperando, y el trabajo de CI se cuelga en vez de decir que pasa —que
 * es peor que el rojo que este guion viene a explicar.
 *
 * <h2>Y la segunda prueba es la que impide pasarse</h2>
 *
 * Una guarda que siempre fallara tambien pasaria la primera. La segunda exige que, con
 * el API contestando, el guion PASE de la comprobacion y siga hasta donde el `kubectl`
 * de mentira ya no sabe fingir — que es prueba de que no rechaza a todo el mundo.
 */

const GUION = join(import.meta.dirname, "..", "secretos", "bootstrap-secretos.sh");

/** Corre el guion con el `kubectl` de mentira que se le indique. */
function correr(kubectlFalso: string): {
  codigo: number;
  salida: string;
  argumentos: string;
} {
  const carpeta = mkdtempSync(join(tmpdir(), "kamayuk-708-"));
  const kubectl = join(carpeta, "kubectl");
  const anotados = join(carpeta, "argumentos");
  writeFileSync(kubectl, kubectlFalso.replace("__ANOTAR__", anotados));
  chmodSync(kubectl, 0o755);

  const leerArgumentos = () => {
    try {
      return readFileSync(anotados, "utf8");
    } catch {
      return "";
    }
  };

  try {
    const salida = execFileSync("bash", [GUION, "--ambiente", "stg"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: `${carpeta}:${process.env.PATH ?? ""}` },
      timeout: 120_000,
    });
    return { codigo: 0, salida, argumentos: leerArgumentos() };
  } catch (fallo) {
    const error = fallo as { status?: number; stdout?: string; stderr?: string };
    return {
      codigo: error.status ?? -1,
      salida: `${error.stdout ?? ""}${error.stderr ?? ""}`,
      argumentos: leerArgumentos(),
    };
  }
}

describe("#708 — el API que no contesta se distingue de un despliegue que falla", () => {
  it("cuando `kubectl version` no completa, el fallo lo dice y no habla de secretos", () => {
    // Falla como falla `kubectl` cuando su plazo vence, con el mensaje literal que dejo
    // en el log el 2026-09-02.
    const { codigo, salida, argumentos } = correr(
      '#!/bin/sh\necho "$@" >> __ANOTAR__\n' +
        'echo \'Unable to connect to the server: net/http: TLS handshake timeout\' >&2\n' +
        "exit 1\n",
    );

    expect(
      argumentos,
      "sin plazo, un API que no contesta cuelga el trabajo en vez de decir que pasa",
    ).toContain("--request-timeout");

    expect(codigo, salida).not.toBe(0);
    expect(salida).toContain("el API server no contesta");
    expect(
      salida,
      "el mensaje tiene que decir por donde empezar a mirar, no solo que fallo",
    ).toContain("/proc/pressure/cpu");
    expect(
      salida,
      "y tiene que negar explicitamente lo que el log anterior hacia creer",
    ).toContain("NO es un fallo de secretos");
  });

  it("con el API contestando, la comprobacion deja pasar", () => {
    // Contesta a `version` y a nada mas: el guion tiene que pasar de la comprobacion y
    // morir mas adelante, con OTRO mensaje. Si rechazara a todos, la prueba anterior
    // seguiria verde y no estaria midiendo nada.
    const { codigo, salida } = correr(
      '#!/bin/sh\ncase "$1" in version) exit 0 ;; *) echo "el kubectl de mentira no sabe $1" >&2; exit 1 ;; esac\n',
    );

    expect(codigo, salida).not.toBe(0);
    expect(salida).not.toContain("el API server no contesta");
    expect(
      salida,
      "muere despues, que es lo que demuestra que la guarda dejo pasar",
    ).toContain("el kubectl de mentira no sabe");
  });
});
