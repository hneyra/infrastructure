/**
 * `#79`, punto 2 — la autocomprobacion del ambiente no miraba la tabla donde el respaldo se
 * registra.
 *
 * ## El defecto, medido
 *
 * El `CronJob` `kamayuk-<ambiente>-respaldo` escribe en la tabla `respaldo` de `BASE_DEL_PADRON`
 * **antes de copiar nada** —`INSERT … RETURNING id`, y `exit 1` si no puede— y la tabla la trae el
 * baseline de `rentas`. En `stg`, el 2026-09-10:
 *
 * ```
 * [pod/kamayuk-stg-respaldo-29811240-727ld/respaldo-base] ERROR: relation "respaldo" does not exist
 * ```
 *
 * Y `verificar-el-ambiente.sh`, que es lo que corre despues de cada `pulumi up`, contaba
 * `municipalidad grupo usuario miembro permiso` en cada base y **nada del respaldo**. El fallo
 * aparecia a las 06:00, en un pod que nadie mira, con un sintoma que no nombra su causa.
 *
 * ## Lo que esta guarda fija
 *
 * 1. Las columnas que la seccion 2b exige son **las que el guion del `CronJob` escribe**, leidas
 *    del guion tal y como se EMITE, no de una lista de la prueba.
 * 2. El guion del ambiente, **ejecutado** con un `kubectl` de mentira, pregunta a la base del
 *    padron y distingue cinco casos: la tabla esta bien, no existe, no se pudo preguntar, le
 *    falta una columna, `kamayuk_owner` no puede escribirla. Solo el primero sale `OK`.
 *
 * Lo que NO ve: el ambiente real. Con esto se sabe que la comprobacion pregunta bien y que dice
 * que no; que la tabla este en `stg` lo dice su corrida, despues del siguiente `pulumi up`.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { BASE_DEL_PADRON } from "../componentes/convenciones";
import { raizDeInfra } from "../componentes/fuentes";
import { manifiestosDelAmbiente } from "../herramientas/emitir-manifiestos";
import { invariantesDe } from "./stacks";

const GUION = join(raizDeInfra(), "verificaciones/ambiente/verificar-el-ambiente.sh");

const TEMPORALES: string[] = [];
afterAll(() => {
  for (const dir of TEMPORALES) rmSync(dir, { recursive: true, force: true });
});

/** El guion del `CronJob` de respaldo, tal y como se EMITE. */
function guionDelRespaldo(): string {
  type Carga = {
    kind?: string;
    metadata?: { name?: string };
    spec?: {
      jobTemplate?: { spec?: { template?: { spec?: { containers?: { args?: string[] }[] } } } };
    };
  };
  const cron = (manifiestosDelAmbiente(invariantesDe("stg")) as Carga[]).find(
    (m) => m.kind === "CronJob" && (m.metadata?.name ?? "").includes("respaldo"),
  );
  const guion = cron?.spec?.jobTemplate?.spec?.template?.spec?.containers?.[0]?.args?.[0];
  if (guion === undefined) {
    throw new Error("«stg» no emite ningun CronJob de respaldo con un guion: esta guarda no mide nada");
  }
  return guion;
}

/** Las columnas de `respaldo` que ese guion nombra en su SQL. */
function columnasQueEscribe(guion: string): string[] {
  const columnas = new Set<string>();
  for (const m of guion.matchAll(/INSERT INTO respaldo \(([^)]*)\)[^;]*?(?:RETURNING ([\w, ]+))?;/g)) {
    for (const c of `${m[1] ?? ""},${m[2] ?? ""}`.split(",")) if (c.trim()) columnas.add(c.trim());
  }
  for (const m of guion.matchAll(/UPDATE respaldo SET ([^;]*);/g)) {
    for (const asignacion of (m[1] ?? "").matchAll(/(\w+)\s*=/g)) {
      if (asignacion[1]) columnas.add(asignacion[1]);
    }
  }
  return [...columnas].sort();
}

describe("#79 · la seccion 2b exige lo que el CronJob del respaldo escribe", () => {
  it("EL CENTINELA: el guion del respaldo escribe en la tabla `respaldo`", () => {
    const columnas = columnasQueEscribe(guionDelRespaldo());
    expect(
      columnas.length,
      "no se encontro ningun INSERT ni UPDATE sobre `respaldo` en el guion emitido: la " +
        "comparacion de abajo se haria contra el conjunto vacio",
    ).toBeGreaterThan(3);
  });

  it("las columnas de COLUMNAS_DEL_RESPALDO son las que el guion escribe, ni mas ni menos", () => {
    const declaradas = /^COLUMNAS_DEL_RESPALDO="([^"]+)"$/m.exec(readFileSync(GUION, "utf8"))?.[1];
    expect(declaradas, "verificar-el-ambiente.sh ya no declara COLUMNAS_DEL_RESPALDO").toBeDefined();
    expect(
      (declaradas ?? "").split(/\s+/).sort(),
      "la seccion 2b no exige las columnas que el CronJob del respaldo escribe: una columna que " +
        "falte en la base dejaria el respaldo muriendo en su primera linea con la comprobacion en OK",
    ).toEqual(columnasQueEscribe(guionDelRespaldo()));
  });
});

type Escenario = {
  /** Lo que contesta `to_regclass`; `fallo` hace que la consulta falle. */
  existe: "t" | "f" | "fallo";
  /** Las columnas que faltan, o `-` si ninguna. */
  faltan?: string;
  /** Lo que contesta `has_table_privilege` para `kamayuk_owner`. */
  escribe?: "t" | "f";
};

/**
 * Corre el guion ENTERO contra un `kubectl` y un `curl` de mentira. El `kubectl` contesta a las
 * consultas de la seccion 2b segun el escenario y anota con que base se hicieron; al resto les da
 * respuestas plausibles para que el guion llegue al final sin colgarse.
 */
function correr(escenario: Escenario): { salida: string; seccion: string; preguntas: string } {
  const dir = mkdtempSync(join(tmpdir(), "respaldo-2b-"));
  TEMPORALES.push(dir);
  const preguntas = join(dir, "preguntas");
  writeFileSync(
    join(dir, "kubectl"),
    `#!/bin/bash
todo="$*"
base=""; prev=""
for a in "$@"; do [ "$prev" = "-d" ] && base="$a"; prev="$a"; done
case "$todo" in
  *"to_regclass('public.respaldo')"*)
    echo "existe -d $base" >> "${preguntas}"
    [ "${escenario.existe}" = fallo ] && { echo "psql: error: connection refused" >&2; exit 2; }
    echo "${escenario.existe}"; exit 0 ;;
  *"information_schema.columns"*"respaldo"*)
    echo "columnas -d $base" >> "${preguntas}"; echo "${escenario.faltan ?? "-"}"; exit 0 ;;
  *"has_table_privilege('kamayuk_owner'"*)
    echo "privilegio -d $base" >> "${preguntas}"; echo "${escenario.escribe ?? "t"}"; exit 0 ;;
  *"get secret"*) echo "Y2xhdmU="; exit 0 ;;
  *"get deployment"*) echo "ghcr.io/hneyra/kamayuk-x:0"; exit 0 ;;
  *"port-forward"*) exit 0 ;;
  *exec*) echo 1; exit 0 ;;
esac
exit 0
`,
  );
  writeFileSync(
    join(dir, "curl"),
    `#!/bin/bash
salida=""; prev=""
for a in "$@"; do [ "$prev" = "-o" ] && salida="$a"; prev="$a"; done
[ -n "$salida" ] && [ "$salida" != /dev/null ] && echo '{"codigo":"NO_AUTENTICADO"}' > "$salida"
case "$*" in *-w*) printf 401 ;; esac
exit 0
`,
  );
  chmodSync(join(dir, "kubectl"), 0o755);
  chmodSync(join(dir, "curl"), 0o755);

  const r = spawnSync("bash", [GUION, "--ambiente", "stg"], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
    timeout: 60_000,
  });
  const salida = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  let anotadas = "";
  try {
    anotadas = readFileSync(preguntas, "utf8");
  } catch {
    anotadas = "";
  }
  // Las lineas que habla la seccion 2b, vengan por stdout (`OK`) o por stderr (`MAL`).
  const seccion = salida
    .split("\n")
    .filter((l) => /respaldo/.test(l) && /^\s+(OK|MAL)\s/.test(l))
    .join("\n");
  return { salida, seccion, preguntas: anotadas };
}

describe("#79 · la seccion 2b, ejecutada: dice que no cuando no esta", () => {
  it("EL CENTINELA: la seccion existe y pregunta a la base del padron", () => {
    const r = correr({ existe: "t" });
    expect(r.salida, "el guion no llega a la seccion 2b").toContain("== 2b.");
    expect(
      r.preguntas,
      `la seccion no pregunta a «${BASE_DEL_PADRON}», que es donde el CronJob escribe`,
    ).toContain(`existe -d ${BASE_DEL_PADRON}`);
    expect(r.preguntas).toContain(`columnas -d ${BASE_DEL_PADRON}`);
    expect(r.preguntas).toContain(`privilegio -d ${BASE_DEL_PADRON}`);
  });

  it("tabla, columnas y permiso en su sitio: OK, y solo OK", () => {
    const { seccion, salida } = correr({ existe: "t", faltan: "-", escribe: "t" });
    expect(seccion, salida).toMatch(/OK\s+«rentas»\.respaldo existe/);
    expect(seccion).not.toMatch(/MAL/);
  });

  it("la tabla no existe: MAL, nombrando el sintoma que dara el CronJob", () => {
    const { seccion, salida } = correr({ existe: "f" });
    expect(seccion, `la tabla ausente no sale en MAL:\n${salida}`).toMatch(/MAL\s+«rentas» NO tiene la tabla respaldo/);
    expect(seccion).not.toMatch(/OK/);
  });

  it("no se pudo preguntar: MAL, y dice que NO es que exista", () => {
    const { seccion, salida } = correr({ existe: "fallo" });
    expect(
      seccion,
      `una consulta fallida se leyo como otra cosa que «no se sabe»:\n${salida}`,
    ).toMatch(/MAL\s+no se pudo preguntar a «rentas» si tiene la tabla respaldo/);
    expect(seccion).toContain("NO es que exista");
    expect(seccion).not.toMatch(/OK/);
  });

  it("le falta una columna que el CronJob escribe: MAL, nombrandola", () => {
    const { seccion, salida } = correr({ existe: "t", faltan: "detalle", escribe: "t" });
    expect(seccion, salida).toMatch(/MAL\s+.*le falta lo que el CronJob escribe: «detalle»/);
    expect(seccion).not.toMatch(/OK/);
  });

  it("kamayuk_owner no puede escribirla: MAL", () => {
    const { seccion, salida } = correr({ existe: "t", faltan: "-", escribe: "f" });
    expect(seccion, salida).toMatch(/MAL\s+kamayuk_owner no puede INSERT y UPDATE/);
    expect(seccion).not.toMatch(/OK/);
  });
});
