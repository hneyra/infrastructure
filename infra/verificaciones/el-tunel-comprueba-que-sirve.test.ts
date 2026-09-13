/**
 * `#162` — el paso del tunel SSH salia VERDE aunque el tunel no sirviera, y ninguna guarda miraba
 * a donde llevaba.
 *
 * ## Las dos mitades del defecto, medidas el 2026-09-13
 *
 * **En la corrida.** Los cinco trabajos que hablan con un cluster abren
 * `ssh -f -N -L 6443:localhost:6443 "$VPS_USER@$VPS_HOST"`. `ssh -f -N` devuelve 0 en cuanto se
 * manda al fondo y el reenvio `-L` es perezoso: no toca el puerto del VPS hasta que alguien usa el
 * local. En la corrida 34751003283 ese paso salio verde y el siguiente murio con
 * «configured Kubernetes cluster is unreachable … context deadline exceeded» y **141 recursos
 * errored** por esa sola causa — un mensaje que manda a mirar el cluster, no el tunel.
 *
 * **En el manifiesto.** En el PR #163 se devolvieron los CINCO tuneles a un puerto remoto que ya no
 * escuchaba en ningun sitio, y **las 1 119 pruebas siguieron en verde**. No habia guarda: el puerto
 * vivia en el YAML y en prosa, que es lo que ni el compilador ni las pruebas leen. Y un copia-pega
 * que cambie UNO de los cinco daria `cluster unreachable` en un solo trabajo, que es el mismo
 * mensaje que no dice la causa.
 *
 * ## Lo que esta guarda fija
 *
 * 1. Todo paso que abre un `ssh … -L` pregunta despues, en el mismo paso, si el tunel sirve
 *    (`.github/comprobar-el-tunel.sh`), con los puertos de SU `-L` y sin nada que le quite el rojo.
 * 2. Los cinco llevan al mismo puerto remoto desde el mismo local, y esos dos puertos son los que
 *    el procedimiento que produce el secreto `KUBECONFIG` escribe (`infra/README.md` §1 y el
 *    runbook de reconstruccion): el `server` de `k3s.yaml` en el nodo, y el `localhost` al que se
 *    cambia.
 * 3. Un centinela: son exactamente cinco, en los cinco trabajos que se conocen. Una forma de
 *    escribir el `ssh` que el analisis no reconozca no deja la guarda en verde con cuatro.
 *
 * Y la sonda misma se ejerce: su tabla de decision con casos sinteticos, contra un puerto donde no
 * escucha nadie —tiene que salir 1, nombrando el tunel y la variable sin su valor— y contra un
 * servidor HTTPS de verdad que contesta 401, que es lo que el API de k3s contesta sin credenciales.
 *
 * ## Lo que NO puede ver
 *
 * El secreto `KUBECONFIG` en si. Lo que se contrasta es lo que el procedimiento documentado escribe
 * en el; si alguien pega a mano otro kubeconfig, eso lo dice la sonda en la corrida —que es la
 * mitad que no depende de haberlo previsto—.
 */
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { load } from "js-yaml";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { raizDelRepositorio } from "../componentes/fuentes";

const RAIZ = raizDelRepositorio();
const FLUJO = join(RAIZ, ".github/workflows/infra.yml");
const SONDA = join(RAIZ, ".github/comprobar-el-tunel.sh");

/** Los trabajos que hablan con un cluster, y por eso abren el tunel. */
const TRABAJOS_CON_TUNEL = [
  "previsualizar-stg",
  "previsualizar-prod",
  "aplicar-stg",
  "aplicar-prod",
  "deteccion-de-deriva",
];

/**
 * Donde vive el procedimiento que produce el secreto `KUBECONFIG`: el `sed` que cambia el
 * `server` de `k3s.yaml` al bucle local. Es lo unico de este repositorio que dice que puerto lleva
 * ese secreto.
 */
const PROCEDIMIENTOS_DEL_KUBECONFIG = [
  "infra/README.md",
  "docs/B0-operacion/runbooks/reconstruir-el-vps-desde-cero.md",
];

interface Paso {
  name?: string;
  run?: string;
  "continue-on-error"?: boolean | string;
}

interface Tunel {
  trabajo: string;
  paso: string;
  local: string;
  remoto: string;
  /** La invocacion de la sonda que va DESPUES del `ssh`, en el mismo paso, si la hay. */
  sonda?: { local: string; remoto: string; linea: string };
  /** Lo que le quitaria el rojo a la sonda aunque este escrita. */
  neutralizada: string[];
}

/**
 * Las lineas de CODIGO de un `run:`: sin comentarios —la leccion de #76: la prosa que explica no
 * puede disparar ni satisfacer la guarda— y con las continuaciones `\` unidas, porque el `ssh` del
 * flujo ocupa dos lineas.
 */
function lineasDeCodigo(run: string): string[] {
  const sinComentarios = run
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");
  return sinComentarios
    .replace(/\\\n/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

/** `-L [direccion:]local:host:remoto` → local y remoto. */
function reenvio(linea: string): { local: string; remoto: string } | undefined {
  const m = /\s-L\s*(\S+)/.exec(` ${linea}`);
  const partes = (m?.[1] ?? "").replace(/^["']|["']$/g, "").split(":");
  if (partes.length < 3) return undefined;
  const [local, , remoto] = partes.slice(-3);
  return { local: local ?? "", remoto: remoto ?? "" };
}

/** Los tuneles de un flujo, con la sonda que los sigue. Recibe el TEXTO para poder ejercerla. */
function tunelesDelFlujo(texto: string): Tunel[] {
  const flujo = load(texto) as { jobs: Record<string, { steps?: Paso[] }> };
  const tuneles: Tunel[] = [];
  for (const [trabajo, cuerpo] of Object.entries(flujo.jobs)) {
    for (const paso of cuerpo.steps ?? []) {
      const lineas = lineasDeCodigo(paso.run ?? "");
      lineas.forEach((linea, i) => {
        if (!/^ssh\s/.test(linea) || !/\s-L/.test(linea)) return;
        const fwd = reenvio(linea);
        const despues = lineas.slice(i + 1);
        const j = despues.findIndex((l) => l.includes("comprobar-el-tunel.sh"));
        const lineaDeSonda = j >= 0 ? despues[j] : undefined;
        const neutralizada: string[] = [];
        if (paso["continue-on-error"] !== undefined && String(paso["continue-on-error"]) !== "false") {
          neutralizada.push("el paso lleva `continue-on-error`");
        }
        if (lineaDeSonda !== undefined) {
          if (/\|\||&\s*$|;\s*true\b/.test(lineaDeSonda)) {
            neutralizada.push(`la sonda va con un escape: «${lineaDeSonda}»`);
          }
          if (lineas.slice(0, i + 1 + j).some((l) => /^set\s+[^#]*\+e/.test(l))) {
            neutralizada.push("un `set +e` antes de la sonda deja que su rojo no pare el paso");
          }
        }
        tuneles.push({
          trabajo,
          paso: paso.name ?? "(sin nombre)",
          local: fwd?.local ?? "?",
          remoto: fwd?.remoto ?? "?",
          sonda:
            lineaDeSonda === undefined
              ? undefined
              : {
                  local: /--local\s+(\d+)/.exec(lineaDeSonda)?.[1] ?? "?",
                  remoto: /--remoto\s+(\d+)/.exec(lineaDeSonda)?.[1] ?? "?",
                  linea: lineaDeSonda,
                },
          neutralizada,
        });
      });
    }
  }
  return tuneles;
}

/** Los `sed 's#server: https://127.0.0.1:<nodo>#server: https://localhost:<local>#'` documentados. */
function puertosDelProcedimiento(): { archivo: string; nodo: string; local: string }[] {
  return PROCEDIMIENTOS_DEL_KUBECONFIG.flatMap((archivo) =>
    [
      ...readFileSync(join(RAIZ, archivo), "utf8").matchAll(
        /sed\s+'s#server: https:\/\/127\.0\.0\.1:(\d+)#server: https:\/\/localhost:(\d+)#'/g,
      ),
    ].map((m) => ({ archivo, nodo: m[1] ?? "", local: m[2] ?? "" })),
  );
}

const TUNELES = tunelesDelFlujo(readFileSync(FLUJO, "utf8"));
const nombrar = (t: Tunel) => `${t.trabajo} («${t.paso}»)`;

describe("#162 · el paso del tunel puede salir rojo", () => {
  it("EL CENTINELA: cinco tuneles, en los cinco trabajos que hablan con un cluster", () => {
    expect(
      TUNELES.map((t) => t.trabajo).sort(),
      "el analisis no encontro los cinco `ssh … -L` del flujo. O se escribieron de una forma que " +
        "no reconoce —y entonces las comprobaciones de abajo miden cuatro, o ninguno, y salen " +
        "verdes—, o cambio el conjunto de trabajos que hablan con un cluster y hay que actualizar " +
        "`TRABAJOS_CON_TUNEL` en el mismo commit.",
    ).toEqual([...TRABAJOS_CON_TUNEL].sort());
  });

  it("todo `ssh -L` pregunta despues, en el mismo paso, si el tunel sirve", () => {
    const sinSonda = TUNELES.filter((t) => t.sonda === undefined).map(nombrar);
    expect(
      sinSonda,
      "estos tuneles se abren y NADIE pregunta si sirven:\n  " +
        sinSonda.join("\n  ") +
        "\n  `ssh -f -N` sale con 0 en cuanto se manda al fondo y el reenvio `-L` es perezoso: el " +
        "paso sale VERDE con nada escuchando al otro lado, y el rojo aparece despues como " +
        "«cluster unreachable», que manda a mirar el cluster (#162). Remedio, en la linea " +
        "siguiente al `ssh`: `infrastructure/.github/comprobar-el-tunel.sh --local <L> --remoto <R>`.",
    ).toEqual([]);

    const neutralizadas = TUNELES.filter((t) => t.neutralizada.length > 0).map(
      (t) => `${nombrar(t)}: ${t.neutralizada.join("; ")}`,
    );
    expect(
      neutralizadas,
      "la sonda esta escrita pero su rojo no para el paso:\n  " + neutralizadas.join("\n  "),
    ).toEqual([]);
  });

  it("la sonda pregunta por el puerto de SU tunel, no por otro", () => {
    const desparejadas = TUNELES.filter(
      (t) => t.sonda !== undefined && (t.sonda.local !== t.local || t.sonda.remoto !== t.remoto),
    ).map(
      (t) =>
        `${nombrar(t)}: el tunel es -L ${t.local}:localhost:${t.remoto} y la sonda dice ` +
        `--local ${t.sonda?.local ?? "?"} --remoto ${t.sonda?.remoto ?? "?"}`,
    );
    expect(
      desparejadas,
      "una sonda que pregunta por otro puerto local contesta sobre otro tunel, y una que nombra " +
        "otro remoto manda a mirar el puerto equivocado del VPS:\n  " +
        desparejadas.join("\n  "),
    ).toEqual([]);
  });

  it("los cinco llevan al MISMO puerto remoto desde el mismo local", () => {
    const porRemoto = TUNELES.map((t) => `${t.trabajo} → ${t.local}:localhost:${t.remoto}`);
    expect(
      new Set(TUNELES.map((t) => t.remoto)).size,
      "los tuneles no llevan todos al mismo puerto del VPS:\n  " +
        porRemoto.join("\n  ") +
        "\n  Los dos ambientes corren k3s nativo con el API en el mismo puerto; uno distinto es un " +
        "copia-pega a medias, y su sintoma seria `cluster unreachable` en UN trabajo.",
    ).toBe(1);
    expect(
      new Set(TUNELES.map((t) => t.local)).size,
      "los tuneles no escuchan todos en el mismo puerto local:\n  " + porRemoto.join("\n  "),
    ).toBe(1);
  });

  it("y esos puertos son los que el procedimiento escribe en el secreto KUBECONFIG", () => {
    const documentados = puertosDelProcedimiento();
    for (const archivo of PROCEDIMIENTOS_DEL_KUBECONFIG) {
      expect(
        documentados.some((d) => d.archivo === archivo),
        `${archivo} ya no trae el \`sed\` que cambia el \`server\` de k3s.yaml al bucle local: ` +
          "esta comparacion se quedaria sin uno de sus lados y saldria verde sola",
      ).toBe(true);
    }
    const [tunel] = TUNELES;
    expect(tunel, "no hay tuneles que comparar").toBeDefined();
    for (const d of documentados) {
      expect(
        d.local,
        `${d.archivo} escribe \`server: https://localhost:${d.local}\` en el kubeconfig, y los ` +
          `tuneles escuchan en el ${tunel?.local ?? "?"}: el proveedor de Pulumi y \`kubectl\` ` +
          "llamarian a un puerto donde no hay tunel.",
      ).toBe(tunel?.local);
      expect(
        d.nodo,
        `${d.archivo} parte de un k3s.yaml con el API en el ${d.nodo} del nodo, y los tuneles ` +
          `llevan al ${tunel?.remoto ?? "?"} del VPS.`,
      ).toBe(tunel?.remoto);
    }
  });
});

describe("#162 · la guarda muerde sobre flujos sinteticos", () => {
  const flujo = (run: string, extra = "") =>
    [
      "jobs:",
      "  uno:",
      "    steps:",
      "      - name: Abrir el tunel",
      extra,
      "        run: |",
      ...run.split("\n").map((l) => `          ${l}`),
    ]
      .filter((l) => l !== "")
      .join("\n");
  const SSH = 'ssh -i k -f -N \\\n    -L 6443:localhost:6443 "$VPS_USER@$VPS_HOST"';
  const SONDA_BIEN = "infrastructure/.github/comprobar-el-tunel.sh --local 6443 --remoto 6443";

  it("sin sonda, o con la sonda solo en un comentario, no hay sonda", () => {
    expect(tunelesDelFlujo(flujo(SSH))[0]?.sonda).toBeUndefined();
    expect(tunelesDelFlujo(flujo(`${SSH}\n# ${SONDA_BIEN}`))[0]?.sonda).toBeUndefined();
  });

  it("la sonda ANTES del `ssh` no cuenta: pregunta antes de que haya tunel", () => {
    expect(tunelesDelFlujo(flujo(`${SONDA_BIEN}\n${SSH}`))[0]?.sonda).toBeUndefined();
  });

  it("un `ssh -L` en un comentario no es un tunel", () => {
    expect(tunelesDelFlujo(flujo(`# ${SSH.replace("\n", "\n# ")}\necho hola`))).toEqual([]);
  });

  it("lee los puertos del `-L` partido en dos lineas y los de la sonda", () => {
    const [t] = tunelesDelFlujo(flujo(`${SSH.replace(":6443 ", ":6445 ")}\n${SONDA_BIEN}`));
    expect(t).toMatchObject({ local: "6443", remoto: "6445" });
    expect(t?.sonda).toMatchObject({ local: "6443", remoto: "6443" });
  });

  it("un escape o `continue-on-error` neutralizan la sonda, y se dice", () => {
    expect(tunelesDelFlujo(flujo(`${SSH}\n${SONDA_BIEN} || true`))[0]?.neutralizada).not.toEqual([]);
    expect(tunelesDelFlujo(flujo(`set +e\n${SSH}\n${SONDA_BIEN}`))[0]?.neutralizada).not.toEqual([]);
    expect(
      tunelesDelFlujo(flujo(`${SSH}\n${SONDA_BIEN}`, "        continue-on-error: true"))[0]
        ?.neutralizada,
    ).not.toEqual([]);
    expect(tunelesDelFlujo(flujo(`${SSH}\n${SONDA_BIEN}`))[0]?.neutralizada).toEqual([]);
  });
});

describe("#162 · la sonda dice que no cuando nadie contesta", () => {
  const clasificar = (salida: string, codigo: string) =>
    execFileSync("bash", [SONDA, "--clasificar", salida, codigo], { encoding: "utf8" }).trim();

  it.each([
    ["0", "401", "api", "el API de k3s sin credenciales — medido contra vmd205066"],
    ["0", "200", "api", "un API con acceso anonimo a /livez"],
    ["0", "403", "api", "un API con RBAC que niega a anonimo"],
    ["0", "404", "otro", "HTTP, pero no lo que el API da en /livez"],
    ["0", "500", "otro", "un API enfermo: el tunel sirve, el rojo es de quien lo usa"],
    ["7", "000", "nada", "conexion rechazada: nada escucha en el puerto local"],
    ["28", "000", "nada", "tiempo agotado"],
    ["35", "000", "nada", "`ssh` acepta y cierra: el puerto remoto no escucha"],
    ["52", "000", "nada", "respuesta vacia"],
    ["0", "000", "nada", "un 000 con salida 0 no es una respuesta"],
    ["0", "", "nada", "sin codigo"],
  ])("curl sale %s con «%s» → %s (%s)", (salida, codigo, esperado) => {
    expect(clasificar(salida, codigo)).toBe(esperado);
  });

  it("contra un puerto donde no escucha nadie sale 1, nombra el tunel y no imprime el secreto", () => {
    const r = spawnSync("bash", [SONDA, "--local", "1", "--remoto", "6443", "--plazo", "1"], {
      encoding: "utf8",
      env: { ...process.env, VPS_HOST: "vps-secreto.example", GITHUB_JOB: "aplicar-stg" },
    });
    const salida = `${r.stdout}${r.stderr}`;
    expect(r.status, `la sonda no salio con 1 ante un puerto muerto:\n${salida}`).toBe(1);
    expect(salida).toMatch(/^::error /m);
    expect(salida, "no nombra el tunel").toContain("-L 1:localhost:6443");
    expect(salida, "no nombra el trabajo").toContain("aplicar-stg");
    expect(salida, "no manda a mirar la variable del host").toContain("VPS_HOST");
    expect(salida, "no nombra el puerto remoto").toContain("puerto 6443");
    expect(salida, "IMPRIME EL VALOR DE `VPS_HOST`, que es un secreto").not.toContain(
      "vps-secreto.example",
    );
  });

  describe("contra un servidor HTTPS de verdad", () => {
    let dir = "";
    let puerto = 0;
    let cerrar: () => Promise<void> = async () => {};

    beforeAll(async () => {
      dir = mkdtempSync(join(tmpdir(), "sonda-del-tunel-"));
      execFileSync(
        "openssl",
        ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=127.0.0.1"]
          .concat(["-keyout", join(dir, "clave.pem"), "-out", join(dir, "cert.pem")]),
        { stdio: "ignore" },
      );
      const servidor = createServer(
        { key: readFileSync(join(dir, "clave.pem")), cert: readFileSync(join(dir, "cert.pem")) },
        (_peticion, respuesta) => {
          // Lo que el API de k3s contesta en `/livez` sin credenciales.
          respuesta.writeHead(401).end('{"kind":"Status","code":401}');
        },
      );
      await new Promise<void>((listo) => servidor.listen(0, "127.0.0.1", listo));
      puerto = (servidor.address() as AddressInfo).port;
      cerrar = () => new Promise<void>((hecho) => servidor.close(() => hecho()));
    });

    afterAll(async () => {
      await cerrar();
      rmSync(dir, { recursive: true, force: true });
    });

    it("un 401 por TLS es un API que contesta: sale 0", async () => {
      // Asincrono a proposito: con `execFileSync` el bucle de eventos queda bloqueado y el
      // servidor de esta misma prueba no podria contestar — la sonda saldria 1 por eso.
      const { stdout } = await promisify(execFile)(
        "bash",
        [SONDA, "--local", String(puerto), "--remoto", "6443", "--plazo", "5"],
        { encoding: "utf8" },
      );
      expect(stdout).toContain("contesto HTTP 401");
    });
  });
});
