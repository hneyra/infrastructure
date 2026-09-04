import { join } from "node:path";
import { raizDeInfra } from "../componentes/fuentes";
import { CIFRAS_DEL_CORTE, sinFuente, type CifraDelCorte } from "./cifras-del-corte";

/**
 * El tablero de las seis cifras del corte, DERIVADO del catalogo (P6, punto 3).
 *
 * ## Por que se genera y no se escribe
 *
 * `resumen-operativo.json` se escribio a mano en #156 y funciona, porque sus paneles describen el
 * nodo y la JVM: cosas que no cambian con el producto. Estas seis describen **fronteras entre
 * sistemas**, y lo que hay que poder afirmar de ellas no es que el JSON este bien formado sino que
 * **sean las mismas seis del catalogo** y que ninguna sin emisor se dibuje como cero. Un JSON
 * escrito a mano tendria que decir eso dos veces —en el archivo y en su prueba— y las dos copias
 * envejeceria una sin la otra, que es #312 otra vez.
 *
 * <p>Asi que el archivo se produce de {@link CIFRAS_DEL_CORTE} y `cifras-del-corte.test.ts` exige
 * que el comprometido sea el que este generador produce. Se regenera con:
 *
 * ```
 * yarn --silent observabilidad-del-corte
 * ```
 */

/** Un panel de estadistica, tal como Grafana lo espera. */
interface Panel {
  readonly id: number;
  readonly type: string;
  readonly title: string;
  readonly description: string;
  readonly gridPos: { h: number; w: number; x: number; y: number };
  readonly datasource: { type: string; uid: string };
  readonly fieldConfig: {
    defaults: Record<string, unknown>;
    overrides: readonly unknown[];
  };
  readonly targets: readonly { refId: string; expr: string }[];
}

/**
 * Un panel por cifra, en dos columnas de tres.
 *
 * «Las seis en una pantalla», que es lo que el enunciado pide: seis paneles de 8x6 caben en las 24
 * columnas de Grafana sin que nadie tenga que desplazarse, y desplazarse es la mitad de por que un
 * tablero deja de mirarse.
 */
function panelDe(cifra: CifraDelCorte, indice: number): Panel {
  const viva = cifra.fuente.clase === "viva";

  return {
    id: indice + 1,
    type: "stat",
    title: cifra.titulo,
    description: viva
      ? `${cifra.sistema} · alerta por encima de ${cifra.umbral} · avisa a: ${cifra.responsable}`
      : `${cifra.sistema} · ${sinFuente(cifra)}`,
    gridPos: { h: 6, w: 8, x: (indice % 3) * 8, y: Math.floor(indice / 3) * 6 + 1 },
    datasource: { type: "prometheus", uid: "prometheus" },
    fieldConfig: {
      defaults: {
        unit: cifra.unidad,
        // LA LINEA QUE HACE HONESTO EL TABLERO. Grafana dibuja `noValue` en lugar del valor
        // cuando la consulta no devuelve nada, asi que una cifra sin emisor NO puede
        // parecerse a un cero. Sin esto, las dos que hoy no tiene nadie se leerian igual
        // que las cuatro que estan en cero porque todo va bien.
        noValue: viva ? "sin datos — revisar el exportador" : sinFuente(cifra),
        thresholds: {
          mode: "absolute",
          steps: [
            { color: "green", value: null },
            { color: "red", value: cifra.umbral + 1 },
          ],
        },
      },
      overrides: [],
    },
    targets: [{ refId: "A", expr: cifra.metrica }],
  };
}

/**
 * El tablero entero.
 *
 * La fila de titulo se declara con la MISMA forma que los paneles —con sus campos vacios— y no
 * como un objeto propio: una union obliga a comprobar «¿es fila o es panel?» en cada uso, y esa
 * comprobacion se acaba escribiendo mal en el uso cuarenta.
 */
export function tableroDelCorte() {
  return {
    title: "Kamayuk — Las seis cifras del corte",
    uid: "kamayuk-cifras-del-corte",
    editable: true,
    timezone: "utc",
    time: { from: "now-24h", to: "now" },
    refresh: "1m",
    schemaVersion: 39,
    tags: ["kamayuk", "corte", "P6"],
    panels: [
      {
        id: 100,
        type: "row",
        title: "Las seis cifras del corte (P6). En verde y en cero: las dos sin emisor lo dicen",
        description: "",
        gridPos: { h: 1, w: 24, x: 0, y: 0 },
        datasource: { type: "prometheus", uid: "prometheus" },
        fieldConfig: { defaults: {}, overrides: [] },
        targets: [],
      } satisfies Panel,
      ...CIFRAS_DEL_CORTE.map(panelDe),
    ],
  };
}

/** El JSON tal como se compromete. */
export function tableroComoJson(): string {
  return `${JSON.stringify(tableroDelCorte(), null, 2)}\n`;
}

/** Donde vive el archivo comprometido. */
export function archivoDelTablero(): string {
  return join(raizDeInfra(), "observabilidad/dashboards/cifras-del-corte.json");
}
