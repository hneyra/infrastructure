/**
 * `#79` — un PR tiene que poder ver que `pulumi up en stg` esta rojo en `main`.
 *
 * ## El hueco, medido
 *
 * `aplicar-stg` corre con `push` a `main` y con `workflow_dispatch`, nunca en un `pull_request`,
 * asi que **ninguna comprobacion de un PR ejerce el despliegue**. El PR #75 salio verde en sus 12
 * comprobaciones con `aplicar-stg` quince horas rojo. Y el 2026-09-13 se integraron **ocho**
 * cambios seguidos —`d166b97` (07:09Z) a `c0db443` (10:33Z)— con `pulumi up en stg` en `failure`.
 *
 * `.github/el-despliegue-de-stg-en-main.sh` le pregunta al API por el ultimo `pulumi up en stg` de
 * `main` que llego a correr, y el trabajo `stg-en-main` lo corre en cada PR. Medido contra el API
 * real, viendo cada corrida como estaba en el instante de cada una de esas ocho integraciones:
 * **siete habrian salido rojas**; la primera, verde, porque fue la que lo rompio.
 *
 * ## Lo que esta guarda fija
 *
 * 1. **La tabla de decision**, con lineas sinteticas por `--decidir`: `success` verde;
 *    `failure`, `timed_out` y `cancelled` rojos; y «no se sabe» —no se pudo preguntar, nada
 *    terminado, verde sin aplicar, una conclusion desconocida— **distinto de verde**, que es la
 *    regla de siempre: cero no es «esta bien».
 * 2. **La consulta**, con un `gh` de mentira que aplica de verdad el `--jq` del guion sobre
 *    respuestas con la forma del API: que solo cuente `push` y `workflow_dispatch`, que lea el
 *    TRABAJO y no la corrida, y que se pare en la primera decisiva.
 * 3. **El flujo**: un solo trabajo lo invoca, corre en `pull_request`, tiene `actions: read` y un
 *    token, y nada le quita el rojo. Y lo que el guion busca —el archivo, el nombre del trabajo y
 *    el del paso del `up`— es lo que `infra.yml` declara: renombrarlos dejaria el guion diciendo
 *    «no se sabe» para siempre, que es un verde con otro nombre.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { load } from "js-yaml";
import { afterAll, describe, expect, it } from "vitest";
import { raizDelRepositorio } from "../componentes/fuentes";

const RAIZ = raizDelRepositorio();
const GUION = join(RAIZ, ".github/el-despliegue-de-stg-en-main.sh");
const FLUJO = join(RAIZ, ".github/workflows/infra.yml");

/**
 * El nombre del paso del `up`, **LEIDO DEL GUION** y no escrito aqui.
 *
 * Lo trajo #201, y el defecto es de la clase que este archivo vigila: el guion busca el paso
 * por `PASO_DEL_UP="Run pulumi/actions@v6"`, o sea que **subir esa accion de version le cambia
 * el nombre al paso**. La guarda de mas abajo ata esa constante a lo que `infra.yml` declara y
 * se pone roja si se olvida — pero las respuestas de mentira de este mismo archivo llevaban el
 * nombre escrito a mano, asi que al subirla se quedaban nombrando el paso VIEJO y las tres
 * pruebas de la consulta fallaban por una discrepancia entre dos copias del mismo dato, no por
 * un defecto del guion. Leyendolo, hay un solo sitio donde vive.
 */
const PASO_DEL_UP = /^PASO_DEL_UP="([^"]+)"$/m.exec(readFileSync(GUION, "utf8"))?.[1] ?? "";

const TEMPORALES: string[] = [];
function temporal(): string {
  const dir = mkdtempSync(join(tmpdir(), "stg-en-main-"));
  TEMPORALES.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of TEMPORALES) rmSync(dir, { recursive: true, force: true });
});

interface Resultado {
  codigo: number | null;
  veredicto: string;
  salida: string;
  resumen: string;
}

function correr(args: string[], opciones: { entrada?: string; env?: Record<string, string> } = {}): Resultado {
  const dir = temporal();
  const resumen = join(dir, "resumen.md");
  writeFileSync(resumen, "");
  const r = spawnSync("bash", [GUION, ...args], {
    input: opciones.entrada ?? "",
    encoding: "utf8",
    env: { ...process.env, GITHUB_STEP_SUMMARY: resumen, ...opciones.env },
    timeout: 20_000,
  });
  return {
    codigo: r.status,
    veredicto: (r.stdout ?? "").split("\n")[0] ?? "",
    salida: `${r.stdout ?? ""}${r.stderr ?? ""}`,
    resumen: readFileSync(resumen, "utf8"),
  };
}

const decidir = (lineas: string[]) => correr(["--decidir"], { entrada: lineas.join("\n") + "\n" });

const URL = "https://github.com/o/r/actions/runs/2/job/20";
function trabajo(
  conclusion: string,
  { estado = "completed", corredor = "GitHub Actions 7", up = "success", url = URL } = {},
): string {
  return ["trabajo", estado, conclusion, corredor, up, url, "c0db443a1b2c", "2026-09-13T10:38:06Z"].join("|");
}

describe("#79 · la tabla de decision", () => {
  it("EL CENTINELA: `success` y `failure` no dan lo mismo", () => {
    // Si `--decidir` dejara de leer la entrada, todo daria «no se sabe» y las pruebas de ese
    // veredicto pasarian solas. Esta lo impide.
    expect(decidir([trabajo("success")]).veredicto).toBe("verde");
    expect(decidir([trabajo("failure")]).veredicto).toBe("rojo");
  });

  it("`success` es verde, sale 0 y nombra la corrida", () => {
    const r = decidir([trabajo("success")]);
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain(URL);
    expect(r.salida).not.toMatch(/::(error|warning)/);
  });

  it.each(["failure", "timed_out", "cancelled"])(
    "`%s` es ROJO: sale 1, con `::error::` y la URL de la corrida",
    (conclusion) => {
      const r = decidir([trabajo(conclusion)]);
      expect(r.veredicto, r.salida).toBe("rojo");
      expect(
        r.codigo,
        `«${conclusion}» no pone rojo el PR: es lo que dejo integrar ocho cambios sobre un stg roto`,
      ).toBe(1);
      expect(r.salida).toMatch(/^::error /m);
      expect(r.salida, "el rojo no dice que corrida mirar").toContain(URL);
      expect(r.salida, "no dice que hacer si este PR es el arreglo").toContain("ARREGLA");
      expect(r.resumen).toContain("ROJO");
    },
  );

  describe("«no se sabe» NO es verde", () => {
    const casos: [string, string[], string][] = [
      ["el API no contesto", ["no-se-pudo|la lista de corridas: HTTP 503"], "No se pudo preguntar"],
      ["el API contesto y no hay nada", [], "ninguna de las"],
      ["solo trabajos en curso", [trabajo("", { estado: "in_progress" })], "EN CURSO"],
      ["`success` sin haber aplicado", [trabajo("success", { up: "skipped" })], "SIN APLICAR"],
      ["una conclusion que no se sabe leer", [trabajo("action_required")], "no sabe leer"],
    ];
    it.each(casos)("%s → aviso, sale 0, y dice que no es «esta bien»", (_caso, lineas, motivo) => {
      const r = decidir(lineas);
      expect(r.veredicto, `lo tomo por «${r.veredicto}»:\n${r.salida}`).toBe("no-se-sabe");
      expect(r.codigo, r.salida).toBe(0);
      expect(r.salida).toMatch(/^::warning /m);
      expect(r.salida, "no dice por que no se sabe").toContain(motivo);
      expect(
        r.salida,
        "no distingue «no se pudo saber» de «esta bien»: un aviso que no lo dice se lee como verde",
      ).toContain("NO es «esta bien»");
      expect(r.resumen).toContain("NO es «esta bien»");
    });
  });

  it("lo que no llego a correr se pasa de largo, y se informa de la anterior", () => {
    const anterior = "https://github.com/o/r/actions/runs/1/job/10";
    const enCurso = "https://github.com/o/r/actions/runs/3/job/30";
    // Uno en curso, uno saltado (una corrida `schedule`) y uno que el grupo de concurrencia
    // retiro de la cola sin corredor: ninguno dice nada del ambiente.
    const r = decidir([
      trabajo("", { estado: "in_progress", url: enCurso }),
      trabajo("skipped", { corredor: "" }),
      trabajo("cancelled", { corredor: "" }),
      trabajo("failure", { url: anterior }),
      trabajo("success"),
    ]);
    expect(r.veredicto, r.salida).toBe("rojo");
    expect(r.salida).toContain(anterior);
    expect(r.salida, "no avisa de que hay uno mas nuevo en curso").toContain(enCurso);
  });
});

describe("#79 · la consulta, con un `gh` de mentira que aplica el `--jq` de verdad", () => {
  /** Respuestas con la forma del API, medida contra `hneyra/infrastructure` el 2026-09-13. */
  function api(trabajos: Record<string, object[]>) {
    const corridas = {
      total_count: 4,
      workflow_runs: [
        // De la rama `main` de una bifurcacion: `head_branch` es `main` y no despliega.
        { id: 40, event: "pull_request" },
        { id: 30, event: "schedule" },
        { id: 20, event: "push" },
        { id: 10, event: "workflow_dispatch" },
      ],
    };
    const job = (id: number, conclusion: string, up: string, nombre = "pulumi up en stg") => ({
      name: nombre,
      status: "completed",
      conclusion,
      runner_name: "GitHub Actions 1",
      html_url: `https://github.com/o/r/actions/runs/${id}/job/${id}0`,
      head_sha: "0123456789abcdef",
      completed_at: "2026-09-13T10:38:06Z",
      steps: [
        { name: "Abrir el túnel SSH al API de k3s", conclusion: "success" },
        { name: PASO_DEL_UP, conclusion: up },
      ],
    });
    return { corridas, trabajos, job };
  }

  function consultar(
    trabajosPorCorrida: (job: ReturnType<typeof api>["job"]) => Record<string, object[]>,
    { fallar = false } = {},
  ) {
    const dir = temporal();
    const { corridas, job } = api({});
    writeFileSync(join(dir, "corridas.json"), JSON.stringify(corridas));
    for (const [id, jobs] of Object.entries(trabajosPorCorrida(job))) {
      writeFileSync(join(dir, `trabajos-${id}.json`), JSON.stringify({ total_count: jobs.length, jobs }));
    }
    const gh = join(dir, "gh");
    writeFileSync(
      gh,
      [
        "#!/bin/sh",
        `echo "$2" >> "${join(dir, "preguntas")}"`,
        ...(fallar ? ['echo "HTTP 503: Service Unavailable" >&2', "exit 1"] : []),
        'case "$2" in',
        `  *"/actions/workflows/infra.yml/runs?"*) f="${dir}/corridas.json" ;;`,
        `  *"/jobs?"*) f="${dir}/trabajos-$(echo "$2" | sed -E 's#.*/runs/([0-9]+)/jobs.*#\\1#').json" ;;`,
        '  *) echo "gh de mentira: no sabe $2" >&2; exit 1 ;;',
        "esac",
        '[ "$3" = "--jq" ] || { echo "gh de mentira: sin --jq" >&2; exit 1; }',
        'exec jq -r "$4" "$f"',
      ].join("\n"),
    );
    chmodSync(gh, 0o755);
    const r = correr([], {
      env: { PATH: `${dir}:${process.env.PATH ?? ""}`, REPOSITORIO: "o/r", GH_TOKEN: "de-mentira" },
    });
    let preguntas = "";
    try {
      preguntas = readFileSync(join(dir, "preguntas"), "utf8");
    } catch {
      preguntas = "";
    }
    return { ...r, preguntas };
  }

  it("lee el TRABAJO de la primera corrida que despliega, y ni la de un PR ni la programada", () => {
    const r = consultar((job) => ({
      "20": [job(20, "failure", "failure"), job(20, "success", "success", "pulumi up en prod (con aprobación)")],
      "10": [job(10, "success", "success")],
    }));
    expect(r.veredicto, r.salida).toBe("rojo");
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain("https://github.com/o/r/actions/runs/20/job/200");
    expect(r.preguntas, "pregunto por la corrida de un pull_request").not.toContain("/runs/40/");
    expect(r.preguntas, "pregunto por la corrida programada").not.toContain("/runs/30/");
    expect(r.preguntas, "no se paro en la primera decisiva").not.toContain("/runs/10/");
  });

  it("`success` con el paso del `up` saltado no es verde", () => {
    const r = consultar((job) => ({ "20": [job(20, "success", "skipped")] }));
    expect(r.veredicto, r.salida).toBe("no-se-sabe");
    expect(r.salida).toContain("SIN APLICAR");
  });

  it("con el API caido dice que no se pudo preguntar, en aviso y no en verde", () => {
    const r = consultar(() => ({}), { fallar: true });
    expect(r.veredicto, r.salida).toBe("no-se-sabe");
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain("No se pudo preguntar al API de GitHub");
    expect(r.salida).toContain("HTTP 503");
  });

  it("y con la corrida anterior verde, verde", () => {
    const r = consultar((job) => ({ "20": [job(20, "success", "success")] }));
    expect(r.veredicto, r.salida).toBe("verde");
    expect(r.codigo).toBe(0);
  });
});

describe("#79 · el flujo lo corre en cada PR, y busca lo que `infra.yml` declara", () => {
  interface Paso {
    name?: string;
    uses?: string;
    run?: string;
    with?: Record<string, unknown>;
    env?: Record<string, string>;
    "continue-on-error"?: unknown;
  }
  interface Trabajo {
    name?: string;
    if?: string;
    permissions?: Record<string, string>;
    "continue-on-error"?: unknown;
    steps?: Paso[];
  }
  const flujo = load(readFileSync(FLUJO, "utf8")) as { jobs: Record<string, Trabajo> };
  const guion = readFileSync(GUION, "utf8");
  const constante = (nombre: string) => new RegExp(`^${nombre}="([^"]+)"$`, "m").exec(guion)?.[1];

  const invocan = Object.entries(flujo.jobs).flatMap(([id, t]) =>
    (t.steps ?? [])
      .filter((p) =>
        (p.run ?? "")
          .split("\n")
          .some((l) => !l.trimStart().startsWith("#") && l.includes("el-despliegue-de-stg-en-main.sh")),
      )
      .map((paso) => ({ id, trabajo: t, paso })),
  );

  it("EL CENTINELA: un solo paso lo invoca", () => {
    expect(
      invocan.map((i) => i.id),
      "ningun trabajo de infra.yml pregunta por el estado de stg en main, o lo hacen varios",
    ).toHaveLength(1);
  });

  it("corre en `pull_request`, con `actions: read` y un token, y nada le quita el rojo", () => {
    const [invocacion] = invocan;
    const t = invocacion?.trabajo;
    const p = invocacion?.paso;
    expect(String(t?.if ?? ""), "el trabajo no corre en los pull_request, que es donde hace falta").toContain(
      "pull_request",
    );
    expect(
      t?.permissions?.actions ?? "(sin alcance `actions`)",
      "sin `actions: read` el token no puede leer corridas: el guion diria «no se sabe» en CADA PR, " +
        "que es un verde con aviso y nadie lee avisos que salen siempre",
    ).toMatch(/^(read|write)$/);
    expect(p?.env?.GH_TOKEN ?? "", "el paso no le pasa un token a `gh`").toMatch(
      /github\.token|secrets\.GITHUB_TOKEN/,
    );
    expect(p?.env?.REPOSITORIO ?? "").toContain("github.repository");
    expect(t?.["continue-on-error"], "`continue-on-error` en el trabajo le quita el rojo").toBeUndefined();
    expect(p?.["continue-on-error"], "`continue-on-error` en el paso le quita el rojo").toBeUndefined();
    expect(p?.run ?? "", "un escape en la invocacion le quita el rojo").not.toMatch(/\|\||;\s*true\b/);
  });

  it("el archivo, el trabajo y el paso que el guion busca son los que infra.yml declara", () => {
    expect(constante("FLUJO"), "el guion pregunta por las corridas de otro flujo").toBe(basename(FLUJO));

    const aplicar = flujo.jobs["aplicar-stg"];
    expect(aplicar, "ya no hay trabajo «aplicar-stg» en infra.yml").toBeDefined();
    expect(
      constante("TRABAJO"),
      "el guion busca un trabajo con otro nombre: no lo encontraria nunca y diria «no se sabe» en " +
        "cada PR — un verde con aviso, para siempre",
    ).toBe(aplicar?.name);

    const ups = (aplicar?.steps ?? []).filter(
      (p) => (p.uses ?? "").startsWith("pulumi/actions@") && p.with?.command === "up",
    );
    expect(ups, "«aplicar-stg» no tiene un paso `pulumi/actions` con `command: up`").toHaveLength(1);
    const [up] = ups;
    expect(
      constante("PASO_DEL_UP"),
      "el paso del `up` se muestra con otro nombre: el guion no sabria si aplico, y un verde sin " +
        "aplicar volveria a pasar por verde",
    ).toBe(up?.name ?? `Run ${up?.uses ?? ""}`);
  });
});
