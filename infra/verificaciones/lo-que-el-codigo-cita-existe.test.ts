/**
 * Un documento que el codigo nombra por su archivo tiene que ESTAR en este repositorio.
 *
 * ## El defecto que la trajo, medido el 2026-09-12
 *
 * `componentes/Identidad.ts` manda al lector a un runbook, por su nombre:
 *
 * > Donde existe la consola de administracion: al otro lado de un tunel local, y en
 * > ningun otro sitio. El runbook `abrir-la-consola-de-keycloak.md` lo explica.
 *
 * **No estaba aqui.** Vivia solo en el repositorio archivo `sgtm`, y alli sus comandos
 * estaban **pre-renombrado**. Copiados al pie de la letra:
 *
 * ```
 * $ kubectl -n sgtm-prod port-forward svc/sgtm-prod-identidad 8180:8080
 * Error from server (NotFound): namespaces "sgtm-prod" not found
 * ```
 *
 * O sea que quien seguia el runbook **no abria ningun tunel**, y lo que veia despues era
 * un error de conexion contra un puerto vacio — un sintoma que no menciona el namespace
 * ni el renombrado, y que manda a buscar la averia en Keycloak. Costo una tarde.
 *
 * ## Por que una guarda y no «acordarse»
 *
 * La referencia se escribe una vez y se lee años despues, cuando quien la escribio ya no
 * esta. Y el sintoma de que falte **no aparece donde esta el defecto**: aparece en la
 * maquina de quien sigue el documento, con un error de otra cosa.
 *
 * Midiendo la clase entera salieron **cuatro** citas y **las cuatro** apuntaban a nada.
 * La peor es `vps/reservar-recursos-del-nodo.sh:238`, que nombra
 * `mantenimiento-del-nodo.md`: ese archivo **no existe ni en el repositorio archivo** —
 * nunca se escribio, y nadie podia notarlo.
 *
 * ## Lo que esta guarda NO hace
 *
 * No comprueba que el documento diga la verdad. Eso no lo puede leer una maquina: lo lee
 * la revision, y por eso cada runbook que se trae se remide entero antes de entrar.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { raizDelRepositorio } from "../componentes/fuentes";

/** Donde se busca una cita: el codigo y lo que viaja con el. */
const DONDE_SE_CITA = [
  "infra/componentes",
  "infra/descriptor",
  "infra/herramientas",
  "infra/vps",
  "infra/config.ts",
];

/** Donde puede estar el documento citado. */
const DONDE_SE_BUSCA = ["docs", "infra", "despliegue", "."];

/**
 * Lo que se cita y todavia no se ha traido, con su motivo. Traer un documento no es
 * copiarlo: hay que remedir cada comando —los del archivo `sgtm` estan pre-renombrado— y
 * eso es un trabajo por documento, no una pasada.
 *
 * **Una entrada que ya no haga falta pone esto rojo**, que es la direccion de #27: si el
 * documento aparece, o si nadie lo cita, la excepcion sobra y se retira.
 */
const SIN_TRAER_TODAVIA: Record<string, string> = {
  "arquitectura-de-infraestructura.md":
    "INF-01. Vive en `sgtm/docs/80-infraestructura/`, pre-renombrado.",
  "gestion-de-secretos.md": "INF-06. Vive en `sgtm/docs/80-infraestructura/`, pre-renombrado.",
  "mantenimiento-del-nodo.md":
    "NO existe en ninguna parte, tampoco en el archivo: hay que escribirlo o retirar la cita.",
};

const RAIZ = raizDelRepositorio();

/** Cada `<algo>.md` nombrado desde el codigo, con donde se nombra. */
function citas(): Map<string, string[]> {
  const salida = execFileSync(
    "grep",
    ["-rnoE", "\\b[a-z0-9][a-z0-9-]*\\.md\\b", ...DONDE_SE_CITA],
    { cwd: RAIZ, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  const encontradas = new Map<string, string[]>();
  for (const linea of salida.split("\n")) {
    if (linea.trim() === "") continue;
    const corte = linea.lastIndexOf(":");
    const archivo = linea.slice(corte + 1);
    const donde = linea.slice(0, corte);
    // Un README no se cita a si mismo por su nombre generico.
    if (archivo === "README.md") continue;
    encontradas.set(archivo, [...(encontradas.get(archivo) ?? []), donde]);
  }
  return encontradas;
}

/** Si ese nombre existe en alguna parte del repositorio. */
function existeAqui(archivo: string): boolean {
  for (const raiz of DONDE_SE_BUSCA) {
    const base = join(RAIZ, raiz);
    if (!existsSync(base)) continue;
    try {
      const hallado = execFileSync(
        "find",
        [base, "-name", archivo, "-not", "-path", "*/node_modules/*", "-print", "-quit"],
        { encoding: "utf8" },
      ).trim();
      if (hallado !== "") return true;
    } catch {
      // `find` sin resultados no es un fallo de la guarda.
    }
  }
  return false;
}

const CITAS = citas();

describe("lo que el codigo cita por su nombre existe aqui", () => {
  it("el codigo cita algun documento, o esta guarda no mide nada", () => {
    // El centinela. Si nadie cita un `.md`, esto se pone rojo y lo que hay que hacer es
    // retirar la guarda, no bajar la afirmacion.
    expect(
      [...CITAS.keys()],
      "ningun archivo bajo " +
        `${DONDE_SE_CITA.join(", ")} nombra un \`.md\`, asi que no hay ninguna referencia ` +
        "que comprobar y esta guarda se queda sin sujeto.",
    ).not.toHaveLength(0);
  });

  it("cada documento citado esta en el repositorio, o esta declarado con su motivo", () => {
    const rotas: string[] = [];
    for (const [archivo, donde] of CITAS) {
      if (existeAqui(archivo)) continue;
      if (archivo in SIN_TRAER_TODAVIA) continue;
      rotas.push(`«${archivo}», citado en ${donde.join(", ")}`);
    }
    expect(
      rotas,
      "el codigo manda al lector a un documento que no esta aqui:\n" +
        rotas.map((r) => `  - ${r}`).join("\n") +
        "\n  El sintoma de esto NO aparece donde esta el defecto: aparece en la maquina de " +
        "quien sigue el documento, y con el error de otra cosa. Traerlo exige REMEDIR cada " +
        "comando —los del archivo `sgtm` estan pre-renombrado—; mientras tanto, declararlo " +
        "en `SIN_TRAER_TODAVIA` con su motivo.",
    ).toEqual([]);
  });

  it("ninguna excepcion sobra: si el documento aparece o nadie lo cita, se retira (#27)", () => {
    for (const [archivo, motivo] of Object.entries(SIN_TRAER_TODAVIA)) {
      expect(
        CITAS.has(archivo),
        `\`SIN_TRAER_TODAVIA\` declara «${archivo}» —«${motivo}»— y **nadie lo cita**. Una ` +
          "excepcion que no exime a nadie hace decir de mas a esta lista, y el dia que " +
          "alguien escriba esa cita quedara exenta sin que nadie lo haya decidido.",
      ).toBe(true);
      expect(
        existeAqui(archivo),
        `\`SIN_TRAER_TODAVIA\` declara «${archivo}» como pendiente de traer, y **ya esta** ` +
          "en el repositorio. La excepcion sobra: retirarla, para que a partir de ahora se " +
          "exija como las demas.",
      ).toBe(false);
    }
  });
});
