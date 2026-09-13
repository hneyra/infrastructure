import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { raizDelRepositorio } from "../componentes/fuentes";
import { claveDeVersion, ENVIRONMENTS, SISTEMAS_CON_IMAGEN } from "../config";
import {
  ADVERTENCIA,
  fuentesDeInfra,
  type Hallazgo,
  ignoreChangesSobreLaImagen,
  revisarRunbook,
  RUNBOOK,
  sinComentarios,
} from "./la-version-vive-en-el-stack";
import { leerStack } from "./stacks";

/**
 * La version que corre vive en el stack (#172, opcion A).
 *
 * ## El defecto
 *
 * `index.ts` declaraba `ignoreChanges: ["spec.template.spec.containers[*].image"]` sobre los
 * `Deployment` del `ConfigGroup`, y el runbook de liberacion enseñaba a liberar con `kubectl set
 * image` y a revertir con `kubectl rollout undo`. Medido el 2026-09-13: el puente clavo
 * `caja@9c8e026` en `stg` y el `up` cambio el binario (`updating [diff: ~spec]`, corrida
 * 34768644141); #177 hizo lo mismo con `rentas` en `prod`. El `ignoreChanges` no llegaba a ningun
 * hijo del grupo, y un `rollout undo` hecho segun el runbook lo deshacia el siguiente `pulumi up`.
 *
 * ## Lo que esta prueba ata
 *
 * (a) Que no vuelva un `ignoreChanges` sobre la imagen en el codigo de `infra/`, en ninguna de las
 * tres formas que puede tener. (b) Que el runbook revierta bajando la linea del stack, y que toda
 * mencion de `rollout undo`/`set image` lleve «el siguiente `pulumi up` lo deshace» y sus ordenes
 * vivan bajo un encabezado de emergencia.
 *
 * ## Por que las muestras van en parejas
 *
 * Una guarda que se satisface gritando ante cualquier `ignoreChanges` o cualquier `kubectl` pasa
 * las muestras rojas y se apaga en el primer PR legitimo. Cada roja lleva su verde: el mismo
 * texto en un comentario, sobre otra ruta, o con su advertencia.
 */

const describir = (hallazgos: readonly Hallazgo[]): string =>
  hallazgos.map((h) => `${h.archivo}:${h.linea} — ${h.motivo}\n    ${h.texto}`).join("\n");

const fuente = (archivo: string, texto: string) => ({ archivo, texto });

describe("#172 · (a) ningun `ignoreChanges` sobre la imagen de un contenedor", () => {
  it("el codigo de infra/ no declara ninguno", () => {
    const hallazgos = ignoreChangesSobreLaImagen(fuentesDeInfra(raizDelRepositorio()));
    expect(
      hallazgos,
      "Un `ignoreChanges` sobre la imagen vuelve a separar la version declarada de la que corre, " +
        "y la version vive en el stack (ADR-0011 §5, enmienda de #172): liberar es subir " +
        "`kamayuk:versionDe<Sistema>` y revertir es bajarla. El que habia era ademas inerte —la " +
        "opcion `transformations` del `ConfigGroup` no llega a sus hijos—.\n" +
        describir(hallazgos),
    ).toEqual([]);
  });

  it("centinela: el barrido lee el codigo de verdad, `index.ts` incluido y entero", () => {
    const fuentes = fuentesDeInfra(raizDelRepositorio());
    // 70 el 2026-09-14.
    expect(fuentes.length, "el barrido no encontro los .ts de infra/").toBeGreaterThan(50);
    // En TODOS: cada `import`/`export` de primera columna sobrevive al despojado. Un bloque falso
    // abierto por una cadena mal leida los dejaria en blanco hasta el siguiente `*/`.
    const comidas = fuentes.flatMap((f) => {
      const limpio = sinComentarios(f.texto).split("\n");
      return f.texto
        .split("\n")
        .map((linea, n) => ({ linea, n }))
        .filter(({ linea, n }) => /^(import|export) /.test(linea) && limpio[n] !== linea)
        .map(({ n }) => `${f.archivo}:${n + 1}`);
    });
    expect(comidas, "el despojado de comentarios se comio estas lineas de codigo").toEqual([]);
    const indice = fuentes.find((f) => f.archivo === join("infra", "index.ts"));
    expect(indice, "el barrido no leyo infra/index.ts, que es donde vivia el defecto").toBeDefined();
    const codigo = sinComentarios(indice?.texto ?? "");
    // Si apartar comentarios se comiera codigo, estas lineas —las que rodean el sitio donde
    // estaba el `ignoreChanges`— desaparecerian y la prueba de arriba saldria verde sin mirar.
    for (const marca of ["new k8s.yaml.v2.ConfigGroup(", "transformations: [", "conPatchForce(args.props", "new k8s.Provider("]) {
      expect(codigo, `sin comentarios, index.ts ya no contiene «${marca}»: el despojado come codigo`).toContain(marca);
    }
    expect(codigo.split("\n").length).toBe((indice?.texto ?? "").split("\n").length);
  });

  describe("muestras", () => {
    it("ROJA: la ruta escrita en el propio `ignoreChanges`", () => {
      const h = ignoreChangesSobreLaImagen([
        fuente("m.ts", 'new k8s.apps.v1.Deployment("d", {}, { ignoreChanges: ["spec.template.spec.containers[*].image"] });'),
      ]);
      expect(h).toHaveLength(1);
      expect(h[0]?.motivo).toContain("lo escribe ahi mismo");
    });

    it("ROJA: la forma que tenia `index.ts` — una constante del mismo archivo", () => {
      const h = ignoreChangesSobreLaImagen([
        fuente(
          "index.ts",
          [
            'const IGNORAR_LA_VERSION = ["spec.template.spec.containers[*].image"];',
            "const g = new k8s.yaml.v2.ConfigGroup(n, { objs }, {",
            "  transformations: [",
            "    (args) => ({ props: args.props, opts: { ...args.opts, ignoreChanges: IGNORAR_LA_VERSION } }),",
            "  ],",
            "});",
          ].join("\n"),
        ),
      ]);
      expect(h).toHaveLength(1);
      expect(h[0]?.linea).toBe(4);
      expect(h[0]?.motivo).toContain("IGNORAR_LA_VERSION");
    });

    it("ROJA: la constante exportada desde otro archivo, y en varias lineas", () => {
      const h = ignoreChangesSobreLaImagen([
        fuente("rutas.ts", 'export const LA_IMAGEN: string[] = [\n  "spec.jobTemplate.spec.template.spec.initContainers[0].image",\n];'),
        fuente("index.ts", 'import { LA_IMAGEN } from "./rutas";\nconst opts = {\n  ignoreChanges:\n    LA_IMAGEN,\n};'),
      ]);
      expect(h.map((x) => `${x.archivo}:${x.linea}`)).toEqual(["index.ts:3"]);
    });

    it("ROJA: una cadena con `/*` antes no esconde el `ignoreChanges` que viene despues (#76)", () => {
      const h = ignoreChangesSobreLaImagen([
        fuente(
          "m.ts",
          [
            'const patron = "infra/**/*.ts";',
            "const r = /\\/*[a-z]/g;",
            "const t = `plantilla ${patron + `/*`} fin`;",
            'const o = { ignoreChanges: ["spec.template.spec.containers[*].image"] };',
            "// */",
          ].join("\n"),
        ),
      ]);
      expect(h.map((x) => x.linea)).toEqual([4]);
    });

    it("VERDE: la misma declaracion, pero en comentarios de linea, de bloque y de documentacion", () => {
      const h = ignoreChangesSobreLaImagen([
        fuente(
          "index.ts",
          [
            "/**",
            ' * Aqui vivia `ignoreChanges: ["spec.template.spec.containers[*].image"]` (#172).',
            " */",
            '// const IGNORAR_LA_VERSION = ["spec.template.spec.containers[*].image"];',
            '/* opts: { ignoreChanges: IGNORAR_LA_VERSION } */ const x = 1;',
            'const url = "https://ejemplo//ignoreChanges";',
          ].join("\n"),
        ),
      ]);
      expect(h).toEqual([]);
    });

    it("VERDE: un `ignoreChanges` sobre otra ruta, junto a un jsonpath de `kubectl` a la imagen", () => {
      const h = ignoreChangesSobreLaImagen([
        fuente(
          "m.ts",
          [
            "const leer = \"-o jsonpath='{.spec.template.spec.containers[0].image}'\";",
            'const opts = { ignoreChanges: ["data", "metadata.annotations"] };',
          ].join("\n"),
        ),
      ]);
      expect(h).toEqual([]);
    });
  });
});

describe("#172 · (b) el runbook revierte con la linea del stack", () => {
  const texto = readFileSync(join(raizDelRepositorio(), RUNBOOK), "utf8");

  it("la reversion principal es bajar `kamayuk:versionDe<Sistema>`, y la medida de emergencia lleva su advertencia", () => {
    const { hallazgos } = revisarRunbook(texto);
    expect(
      hallazgos,
      `${RUNBOOK}: revertir es un commit que devuelve la linea del stack (ADR-0011 §5, enmienda de ` +
        "#172). `kubectl rollout undo` y `set image` son medida de emergencia, y cada vez que se " +
        `nombran va «${ADVERTENCIA}», porque es lo que pasa.\n` +
        describir(hallazgos),
    ).toEqual([]);
  });

  it("centinela: el runbook tiene su reversion, su emergencia, y lo que se revisa se leyo", () => {
    const lectura = revisarRunbook(texto);
    expect(lectura.seccionDeReversion, "no se encontro un encabezado «Revertir»").toBeDefined();
    expect(lectura.seccionDeEmergencia, "no se encontro un encabezado de «emergencia»").toBeDefined();
    // Cero menciones es que la busqueda no leyo nada: la seccion de emergencia las tiene.
    expect(lectura.menciones).toBeGreaterThan(3);
  });

  describe("muestras", () => {
    const REVERTIR = [
      "### 4. Revertir: bajar la linea",
      "",
      "```bash",
      "git revert --no-edit <commit que subio kamayuk:versionDe<Sistema>>",
      "```",
      "",
    ];
    const EMERGENCIA = [
      "### 5. Medida de emergencia",
      "",
      "El siguiente `pulumi up` lo deshace.",
      "",
      "```bash",
      "kubectl -n x rollout undo deployment/x",
      "```",
    ];

    it("VERDE: la forma buena, reducida", () => {
      expect(revisarRunbook([...REVERTIR, ...EMERGENCIA].join("\n")).hallazgos).toEqual([]);
    });

    it("ROJA: la reversion vuelve a ser `rollout undo`, sin advertencia (R2)", () => {
      const runbook = [
        "### 4. Revertir",
        "",
        "```bash",
        "kubectl -n kamayuk-<sistema>-<amb> rollout undo deployment/kamayuk-<sistema>-web",
        "```",
        "",
        ...EMERGENCIA,
      ].join("\n");
      const motivos = revisarRunbook(runbook).hallazgos.map((h) => h.motivo);
      expect(motivos.some((m) => m.includes("la reversion principal vuelve a ser `kubectl`"))).toBe(true);
      expect(motivos.some((m) => m.includes("no toca `kamayuk:versionDe<Sistema>`"))).toBe(true);
      expect(motivos.some((m) => m.includes("sin decir «el siguiente"))).toBe(true);
      expect(motivos.some((m) => m.includes("fuera de una seccion «emergencia»"))).toBe(true);
    });

    it("ROJA: la prosa nombra `rollout undo` —partido en dos lineas de una cita— sin la advertencia", () => {
      const runbook = [...REVERTIR, "## Si no sale bien", "", "> Se vuelve con `kubectl rollout", "> undo`.", "", ...EMERGENCIA].join("\n");
      const h = revisarRunbook(runbook).hallazgos;
      expect(h).toHaveLength(1);
      expect(h[0]?.motivo).toContain("«Si no sale bien»");
    });

    it("VERDE: la misma prosa con la advertencia en su seccion, en otras palabras de formato", () => {
      const runbook = [...REVERTIR, "## Si no sale bien", "", "Con `kubectl rollout undo`: **el siguiente `pulumi up` lo deshace**.", "", ...EMERGENCIA].join("\n");
      expect(revisarRunbook(runbook).hallazgos).toEqual([]);
    });

    it("ROJA: una orden `set image` fuera de la seccion de emergencia, aunque lleve la advertencia", () => {
      const runbook = [
        ...REVERTIR,
        "### 3. Liberar",
        "",
        "El siguiente pulumi up lo deshace.",
        "",
        "```bash",
        "kubectl set image deployment/x x=imagen:sha",
        "```",
        ...EMERGENCIA,
      ].join("\n");
      const h = revisarRunbook(runbook).hallazgos;
      expect(h).toHaveLength(1);
      expect(h[0]?.motivo).toContain("fuera de una seccion «emergencia»");
    });

    it("VERDE: un comentario de shell que nombra `rollout undo` no es una orden, y un `# titulo` dentro del bloque no parte la seccion", () => {
      const runbook = [
        "### 4. Revertir",
        "",
        "```bash",
        "# no se usa rollout undo: el siguiente paso es la linea",
        "# 5. Medida de emergencia",
        "sed -i 's/^  kamayuk:versionDeRentas: .*/  kamayuk:versionDeRentas: <sha>/' infra/Pulumi.prod.yaml",
        "```",
        ...EMERGENCIA,
      ].join("\n");
      const lectura = revisarRunbook(runbook);
      expect(lectura.hallazgos).toEqual([]);
      expect(lectura.seccionDeReversion).toBe("4. Revertir");
    });
  });
});

describe("#172 · centinela de los stacks: la version de los cinco vive en los dos", () => {
  it.each(ENVIRONMENTS)("«%s» declara `kamayuk:versionDe<Sistema>` de los cinco, en cuarenta hexadecimales", (ambiente) => {
    const stack = leerStack(ambiente);
    const faltan = SISTEMAS_CON_IMAGEN.filter((s) => !/^[0-9a-f]{40}$/.test(stack.text(claveDeVersion(s)) ?? ""));
    expect(
      faltan,
      `Pulumi.${ambiente}.yaml no declara la version de: ${faltan.join(", ")}. Desde #172 esa linea ES la ` +
        "version que corre: sin ella no hay nada que subir para liberar ni que bajar para revertir.",
    ).toEqual([]);
    expect(SISTEMAS_CON_IMAGEN.length).toBe(5);
  });
});
