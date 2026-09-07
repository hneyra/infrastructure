import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { raizDelRepositorio } from "../componentes/fuentes";
import type { NetworkPolicy } from "../componentes/tipos";
import { namespaceDelSistema } from "../descriptor/entorno";
import { inventarioDelAmbiente } from "../componentes/secretos";
import { manifiestosDelAmbiente } from "../herramientas/emitir-manifiestos";
import {
  GUIONES_PENDIENTES,
  SISTEMA_DE_ESTE_CLON,
  ambientesDeclarados,
  desajustesDeLosGuiones,
  guionesDeCarga,
  todosLosGuionesDeCarga,
} from "./guiones-de-carga";
import { invariantesDe } from "./stacks";

/**
 * #10 y #11 — los guiones de carga piden la imagen a un Deployment que ya no esta.
 *
 * Lo que se compara son las DOS fuentes reales: los `*.sh` del disco de los cinco clones, y los
 * manifiestos que el ambiente emite. Ninguna de las dos se copia aqui.
 */

const GUIONES = todosLosGuionesDeCarga();
const AMBIENTES = ambientesDeclarados();
const LIB = join(raizDelRepositorio(), "infra", "carga-de-datos", "lib-destino-del-job.sh");

describe("#10 · de que Deployment saca su imagen un guion de carga", () => {
  it("el censo sale del disco, y no esta vacio", () => {
    // Sin este centinela, un `readdirSync` que dejara de encontrar los guiones —una carpeta
    // renombrada, un clon a medio traer— dejaria las comprobaciones de abajo ciertas sobre el
    // conjunto vacio. Es lo que #29 midio en `catastro` y lo que C-15/C-16 escribieron primero.
    expect(GUIONES.length).toBeGreaterThan(10);
    expect([...new Set(GUIONES.map((g) => g.archivo.split("/")[0]))].sort()).toEqual([
      "caja",
      "catastro",
      "infrastructure",
      "rentas",
    ]);
  });

  it.each(AMBIENTES)("en «%s», ningun guion pide lo que el ambiente no emite", (ambiente) => {
    const desajustes = desajustesDeLosGuiones(ambiente, GUIONES).filter(
      (d) => GUIONES_PENDIENTES[d.archivo] === undefined,
    );
    expect(
      desajustes.map((d) => `${d.archivo}:${d.linea} — ${d.problema}`),
      "un Job con la imagen de otro sistema arranca, no atiende la propiedad de carga, no " +
        "escribe ni una fila y sale con codigo 0 (C-6): su sintoma es la ausencia de sintoma",
    ).toEqual([]);
  });

  it("y la lista de pendientes es trabajo pendiente, no una puerta abierta", () => {
    // La otra direccion, y es la que impide que la lista envejezca: el dia que el PR de
    // `catastro` aterrice, su entrada deja de tener desajuste y esto sale rojo nombrandola.
    const conDesajuste = new Set(
      AMBIENTES.flatMap((a) => desajustesDeLosGuiones(a, GUIONES)).map((d) => d.archivo),
    );
    const rancias = Object.keys(GUIONES_PENDIENTES).filter((a) => !conDesajuste.has(a));
    expect(
      rancias,
      "estos guiones estan declarados como pendientes y ya no tienen ningun desajuste: quitarlos " +
        "de GUIONES_PENDIENTES es lo que cierra el issue por su lado",
    ).toEqual([]);
    const censados = new Set(GUIONES.map((g) => g.archivo));
    expect(
      Object.keys(GUIONES_PENDIENTES).filter((a) => !censados.has(a)),
      "y estos ni siquiera existen ya en el disco",
    ).toEqual([]);
  });

  it("no pasa en verde sobre el vacio: sin guiones, dice que no midio", () => {
    // El contraste. Una guarda que se queda sin sujeto tiene que decirlo, no aprobar.
    const vacio = mkdtempSync(join(tmpdir(), "sin-guiones-"));
    expect(guionesDeCarga(vacio, "normativa", "ninguno")).toEqual([]);
    expect(() => desajustesDeLosGuiones(AMBIENTES[0]!, [])).toThrow(/NO MIDIO\s+NADA/);
  });

  it("y lo que no sabe resolver lo dice, en vez de darlo por bueno", () => {
    // «No se pudo comprobar» no puede leerse igual que «esta bien» (C-15/C-16).
    const inventado = {
      archivo: "inventado/infra/carga-de-datos/x.sh",
      ruta: "/no/existe/x.sh",
      sistema: "normativa",
      lineaDelNamespace: 1,
      namespace: "kamayuk-${LO_QUE_SEA}",
      lineaDelDeployment: 2,
      deployment: "kamayuk-normativa-web",
    };
    const [desajuste] = desajustesDeLosGuiones(AMBIENTES[0]!, [inventado]);
    expect(desajuste?.problema).toMatch(/no se puede resolver/);
  });
});

describe("#10 AC-7 · la biblioteca le pide al cluster lo que su `selector` declara", () => {
  /**
   * **Medido, y paso en VERDE antes de existir esta comprobacion.**
   *
   * Con `local selector="sistema=$sistema,perfil=web"` intacto y las DOS llamadas devueltas a
   * `get deployment "kamayuk-${ambiente}-aplicacion"` —el Deployment del monolito, que es la
   * mutacion que #10 AC-7 pide como minimo— la suite entera daba **770 de 770**: la guarda leia
   * la declaracion, la comparaba contra el manifiesto y la daba por buena, mientras los tres
   * guiones le pedian al cluster un Deployment que ningun ambiente emite. Seguir la indireccion
   * hasta el archivo no basta si se para en la declaracion: hay que llegar a la llamada.
   */
  const conBiblioteca = (biblioteca: string): string => {
    const raiz = mkdtempSync(join(tmpdir(), "biblioteca-"));
    const carpeta = join(raiz, "infra", "carga-de-datos");
    mkdirSync(carpeta, { recursive: true });
    writeFileSync(
      join(carpeta, "un-guion.sh"),
      ["NAMESPACE=${NAMESPACE:-kamayuk-normativa-$AMBIENTE}", "imagen_del_backend", "kind: Job"].join(
        "\n",
      ),
    );
    writeFileSync(join(carpeta, "lib-destino-del-job.sh"), biblioteca);
    return raiz;
  };

  const SANA = [
    'local selector="sistema=$sistema,perfil=web"',
    'nombres=$(kubectl -n "$namespace" get deployment -l "$selector" -o name)',
  ].join("\n");

  it("una llamada que no usa el selector declarado sale roja, con archivo y linea", () => {
    const raiz = conBiblioteca(
      [
        'local selector="sistema=$sistema,perfil=web"',
        'nombres=$(kubectl -n "$namespace" get deployment "kamayuk-${ambiente}-aplicacion" -o name)',
      ].join("\n"),
    );
    expect(() => guionesDeCarga(raiz, "normativa", "inventado")).toThrow(
      /le pide al cluster otra cosa[\s\S]*lib-destino-del-job\.sh:2/,
    );
  });

  it("y un selector declarado que no usa ninguna llamada, tambien", () => {
    const raiz = conBiblioteca(
      ['local selector="sistema=$sistema,perfil=web"', 'echo "no le pide nada a nadie"'].join("\n"),
    );
    expect(() => guionesDeCarga(raiz, "normativa", "inventado")).toThrow(/variable muerta/);
  });

  it("el contraste: una biblioteca que si lo usa pasa", () => {
    expect(guionesDeCarga(conBiblioteca(SANA), "normativa", "inventado")).toHaveLength(1);
  });

  it("y el comentario que CITA la linea vieja no la dispara", () => {
    // La cabecera de la biblioteca de verdad cita `get deployment "kamayuk-${AMBIENTE}-aplicacion"`
    // para explicar por que se fue. Una guarda que se dispara con la prosa que la justifica es la
    // que alguien acaba apagando borrando el comentario (#16 con `proxy_pass`, #10 con los rotulos).
    const raiz = conBiblioteca(
      ['#     IMAGEN=$(kubectl get deployment "kamayuk-${AMBIENTE}-aplicacion" ...)', SANA].join(
        "\n",
      ),
    );
    expect(guionesDeCarga(raiz, "normativa", "inventado")).toHaveLength(1);
  });
});

describe("#10 · el Job corre donde tiene egreso, y con la etiqueta que lo da", () => {
  it.each(AMBIENTES)(
    "en «%s», la etiqueta que la biblioteca pone es la que selecciona la politica de egreso",
    (ambiente) => {
      // Las dos mitades derivadas: lo que `etiquetas_del_job` EMITE se obtiene ejecutando la
      // funcion con bash, y lo que la politica EXIGE, del manifiesto. El comentario que estos
      // guiones llevaban decia que la etiqueta buena era `app: lote`; medido, no la nombra
      // ninguna politica de ninguno de los dos ambientes.
      const salida = execFileSync(
        "bash",
        ["-c", `. "${LIB}"; etiquetas_del_job ${SISTEMA_DE_ESTE_CLON} un-proceso`],
        { encoding: "utf8" },
      );
      const puestas = Object.fromEntries(
        salida
          .split("\n")
          .map((l) => l.trim().split(": "))
          .filter((p) => p.length === 2)
          .map(([c, v]) => [c!, v!]),
      );
      expect(Object.keys(puestas).length).toBeGreaterThan(0);

      const namespace = namespaceDelSistema(ambiente, SISTEMA_DE_ESTE_CLON);
      const politicas = manifiestosDelAmbiente(invariantesDe(ambiente)).filter(
        (m): m is NetworkPolicy =>
          m.kind === "NetworkPolicy" &&
          m.metadata?.namespace === namespace &&
          (m.spec.policyTypes ?? []).includes("Egress"),
      );
      expect(politicas.length, `«${namespace}» no tiene ninguna politica de egreso`).toBeGreaterThan(
        0,
      );

      const alcanzadas = politicas.filter((p) =>
        Object.entries(p.spec.podSelector?.matchLabels ?? {}).every(
          ([clave, valor]) => puestas[clave] === valor,
        ),
      );
      expect(
        alcanzadas.map((p) => p.metadata?.name),
        `las etiquetas ${JSON.stringify(puestas)} no las selecciona ninguna politica de egreso ` +
          `de «${namespace}»: el pod arranca y la conexion al 5432 cae`,
      ).not.toEqual([]);
    },
  );

  it("y `app: lote`, que es lo que los guiones ponian, no la nombra ninguna politica", () => {
    // La medida que corrige el comentario de los guiones, no una opinion sobre el.
    for (const ambiente of AMBIENTES) {
      const politicas = manifiestosDelAmbiente(invariantesDe(ambiente)).filter(
        (m): m is NetworkPolicy => m.kind === "NetworkPolicy",
      );
      expect(JSON.stringify(politicas).includes('"lote"'), `en «${ambiente}»`).toBe(false);
    }
  });
});

describe("#11 · los tres guiones de este repositorio", () => {
  const propios = guionesDeCarga(raizDelRepositorio(), SISTEMA_DE_ESTE_CLON, "infrastructure");

  it("son tres, y ninguno nombra ya el Deployment del monolito", () => {
    expect(propios.map((g) => g.archivo.split("/").pop())).toEqual([
      "abrir-conjunto-parametros.sh",
      "publicar-cuadros.sh",
      "publicar-parametros.sh",
    ]);
    for (const guion of propios) {
      const fuente = readFileSync(guion.ruta, "utf8");
      expect(fuente, guion.archivo).not.toMatch(/kamayuk-\$\{AMBIENTE\}-aplicacion/);
    }
  });

  it("y los tres sacan su destino de la biblioteca, no de una copia", () => {
    for (const guion of propios) {
      const fuente = readFileSync(guion.ruta, "utf8");
      expect(fuente, guion.archivo).toContain("lib-destino-del-job.sh");
      expect(fuente, guion.archivo).toContain('namespace_del_sistema "$SISTEMA" "$AMBIENTE"');
      expect(fuente, guion.archivo).toContain('imagen_del_backend "$SISTEMA" "$AMBIENTE"');
    }
  });

  it("el `kubectl exec` contra el motor sigue yendo al espacio de nombres de la plataforma", () => {
    // Las dos mitades del corte: el Job baja al del sistema y el motor se queda donde esta.
    // Sin esta, mover el Job habria roto la comprobacion de credencial de #435 en silencio.
    for (const guion of propios) {
      const fuente = readFileSync(guion.ruta, "utf8");
      for (const linea of fuente.split("\n")) {
        if (!linea.includes("exec") || !linea.includes("postgres")) continue;
        expect(linea, guion.archivo).toContain("$NAMESPACE_PLATAFORMA");
      }
    }
  });
});

describe("#11 · la credencial que el Job monta, y donde vive", () => {
  it.each(AMBIENTES)(
    "en «%s», la de rol_carga_parametros sigue SOLO en la plataforma, y esta dicho",
    (ambiente) => {
      // El AC-2 de #11 pide decidir donde vive y por que. La decision esta tomada y escrita —baja
      // al espacio de nombres del sistema como ESPEJO, porque un `secretKeyRef` no cruza y porque
      // subir el Job a la plataforma no es una salida: alli `denegar-todo` le niega el egreso—, y
      // la MITAD que este repositorio no puede hacer es la entrada en el `claves()` del descriptor
      // de `normativa`, que vive en su clon.
      //
      // Esto lo mide en vez de suponerlo, y **se pone rojo el dia que aterrice**: entonces se
      // borra y con el la linea de `GUIONES_PENDIENTES` que le corresponda.
      const inventario = inventarioDelAmbiente(invariantesDe(ambiente));
      const enLaPlataforma = inventario.find(
        (e) => e.rolDePostgres === "rol_carga_parametros" && e.namespace === `kamayuk-${ambiente}`,
      );
      expect(enLaPlataforma?.secreto, "el origen del espejo tiene que existir").toBe(
        `kamayuk-${ambiente}-postgres-carga`,
      );

      const espejo = `kamayuk-${SISTEMA_DE_ESTE_CLON}-${ambiente}-carga`;
      expect(
        inventario.some((e) => e.secreto === espejo),
        `«${espejo}» ya esta en el inventario: los tres guiones de este repositorio ya pueden ` +
          "montarlo, asi que esta comprobacion sobra y hay que borrarla",
      ).toBe(false);
    },
  );
});
