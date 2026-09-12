import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { raizDelRepositorio } from "../componentes/fuentes";

/**
 * Un `kubectl exec` que manda algo por `stdin` y no lleva `-i` no ejecuta nada, y sale 0 (#129).
 *
 * <h2>El defecto, medido</h2>
 *
 * `kubectl exec` <b>no conecta `stdin` al contenedor si no se le pide con `-i`</b>. El proceso
 * de dentro —`psql`, sin `--command`— lee EOF inmediatamente, no hace nada y termina bien. El
 * guion que lo llamo no tiene como enterarse: recibe un 0.
 *
 * <p>Medido contra el cluster de `stg` el 2026-09-12, con una tabla de usar y tirar y el MISMO
 * `INSERT` por las dos vias:
 *
 * <pre>
 *   SIN -i  -> codigo de salida 0   y la tabla queda VACIA
 *   CON -i  -> codigo de salida 0   y la fila esta
 * </pre>
 *
 * <p>Lo encontro el simulacro de restauracion contra el cluster: sus dos filas de ensayo —la
 * que el PITR tiene que conservar y la que tiene que dejar fuera— se mandaban asi, de modo que
 * <b>nunca se escribian</b>. Y como despues comprueba que la fila buena sobrevivio, el ensayo
 * <b>no podia pasar jamas</b>: habria fallado acusando al PITR de perder una fila que nadie
 * escribio. Un rojo que manda a mirar el sitio equivocado.
 *
 * <h2>Por que una guarda y no solo el arreglo</h2>
 *
 * Porque el defecto es invisible por construccion: no hay codigo de salida que lo delate, no
 * hay mensaje, y el sitio donde se nota esta lejos del sitio donde esta. Es la misma familia
 * que #91 —una tuberia que cierra pronto y convierte un exito en 141— y se cierra igual: se
 * barre el arbol, no se confia en que nadie lo repita.
 *
 * <p>Censado el 2026-09-12: en todo el repositorio hay <b>cuatro</b> invocaciones que mandan
 * algo por `stdin`, las cuatro en `infra/respaldo/contra-cluster.sh`. El censo es lo que hace
 * que esta guarda tenga sujeto; si algun dia baja a cero, lo dice en vez de pasar en verde.
 */

/** Una invocacion de `kubectl exec`, con sus lineas de continuacion. */
interface Invocacion {
  readonly archivo: string;
  readonly linea: number;
  readonly texto: string;
}

/** Las `kubectl exec` del arbol, cada una con su orden entera —las continuaciones incluidas—. */
function invocacionesDeKubectlExec(): Invocacion[] {
  const raiz = raizDelRepositorio();
  const guiones = execFileSync("git", ["-C", raiz, "ls-files", "*.sh"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  if (guiones.length === 0) {
    throw new Error(
      "`git ls-files '*.sh'` no devolvio ningun guion: esta guarda se quedaria sin sujeto y " +
        "todo lo que afirma seria cierto sobre el conjunto vacio. NO se salta.",
    );
  }

  const encontradas: Invocacion[] = [];
  for (const guion of guiones) {
    const lineas = readFileSync(join(raiz, guion), "utf8").split("\n");
    lineas.forEach((linea, i) => {
      if (!linea.includes("kubectl exec")) return;
      // La orden puede seguir en las lineas de abajo mientras acaben en `\`.
      const partes = [linea];
      let j = i;
      while (j < lineas.length - 1 && (lineas[j] ?? "").trimEnd().endsWith("\\")) {
        j += 1;
        partes.push(lineas[j] ?? "");
      }
      encontradas.push({ archivo: guion, linea: i + 1, texto: partes.join("\n") });
    });
  }
  return encontradas;
}

/** Si esa orden le manda algo al contenedor por `stdin`. */
export function mandaPorStdin(orden: string): boolean {
  // Un heredoc (`<<SQL`, `<<'SQL'`, `<<-EOF`) o una redireccion de fichero al final de la orden.
  return /<<-?\s*'?[A-Za-z_][A-Za-z0-9_]*'?/.test(orden) || /(?:^|[^<>&])<\s*"?\$?[\w./{}-]/.test(orden);
}

/** Si lleva `-i` (suelto o agrupado, como en `-it`), que es lo que conecta `stdin`. */
export function conectaStdin(orden: string): boolean {
  const primera = orden.split("\n")[0] ?? "";
  const hasta = primera.slice(primera.indexOf("kubectl exec"));
  // Solo cuentan las banderas ANTES del `--`: lo de despues es la orden del contenedor.
  const banderas = hasta.split(" -- ")[0] ?? "";
  return /\s-[A-Za-z]*i[A-Za-z]*(\s|$)/.test(banderas);
}

describe("#129 — un `kubectl exec` que manda SQL por stdin lleva `-i`", () => {
  const invocaciones = invocacionesDeKubectlExec();
  const conStdin = invocaciones.filter((v) => mandaPorStdin(v.texto));

  it("hay `kubectl exec` que mandan algo por stdin: esta guarda tiene sujeto", () => {
    // El contraste de «no midio». Sin esto, el dia que nadie use stdin la guarda pasaria en
    // verde sobre el conjunto vacio y nadie sabria que dejo de mirar.
    expect(
      conStdin.length,
      "ninguna invocacion de `kubectl exec` manda nada por stdin, asi que la comprobacion de " +
        "abajo es cierta sobre cero casos. Si se retiraron a proposito, esta guarda sale con ellas",
    ).toBeGreaterThan(0);
  });

  it("ninguna se queda sin `-i`", () => {
    const sinBandera = conStdin
      .filter((v) => !conectaStdin(v.texto))
      .map((v) => `${v.archivo}:${v.linea}`);
    expect(
      sinBandera,
      "estas invocaciones mandan algo por stdin y no llevan `-i`: kubectl NO lo conecta al " +
        "contenedor, asi que el proceso de dentro lee EOF, no ejecuta nada y termina BIEN. " +
        "Medido: el mismo INSERT sin `-i` deja la tabla vacia y sale 0",
    ).toEqual([]);
  });

  it("la deteccion muerde y no muerde de mas", () => {
    // Las dos direcciones sobre muestras, que es lo que impide que la guarda se cumpla sola.
    const sinI = `kubectl exec -n x pod -c postgres -- psql -U u -d d <<SQL\nINSERT INTO t VALUES (1);\nSQL`;
    const conI = `kubectl exec -i -n x pod -c postgres -- psql -U u -d d <<SQL\nINSERT INTO t VALUES (1);\nSQL`;
    const agrupada = `kubectl exec -it -n x pod -- sh <<EOF\necho hola\nEOF`;
    const sinStdin = `kubectl exec -n x pod -c postgres -- psql -U u -d d --command "SELECT 1"`;

    expect(mandaPorStdin(sinI)).toBe(true);
    expect(conectaStdin(sinI)).toBe(false);
    expect(conectaStdin(conI)).toBe(true);
    expect(conectaStdin(agrupada)).toBe(true);
    // Y el contraste que importa para no gritar en lo correcto: una orden con `--command` no
    // manda nada por stdin, asi que le da igual `-i`.
    expect(mandaPorStdin(sinStdin)).toBe(false);
  });

  it("un `-i` DESPUES del `--` no cuenta: esa bandera es de la orden de dentro", () => {
    // `kubectl exec … -- sh -i` le pasa `-i` a `sh`, no a kubectl. Sin este caso, la guarda
    // aceptaria como buena una orden que sigue sin conectar stdin.
    const enganosa = `kubectl exec -n x pod -- sh -i <<EOF\necho hola\nEOF`;
    expect(mandaPorStdin(enganosa)).toBe(true);
    expect(conectaStdin(enganosa)).toBe(false);
  });
});
