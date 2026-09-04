import { join } from "node:path";
import { raizDeInfra } from "../componentes/fuentes";
import { CIFRAS_DEL_CORTE, type CifraDelCorte } from "./cifras-del-corte";

/**
 * Las reglas de alerta de las seis cifras del corte, DERIVADAS del catalogo (P6, punto 3).
 *
 * ## «Y CADA ALERTA VA A UNA PERSONA CON NOMBRE»
 *
 * Es lo que el enunciado pide y lo que `alertas.yml` no tenia: sus doce reglas llevan `runbook`
 * —que dice QUE hacer— y ninguna dice A QUIEN. Alertmanager las entrega todas al mismo receptor,
 * que en `prod` es un webhook marcado como provisional, asi que hoy una alerta de arqueo de caja y
 * una de disco lleno llegan al mismo sitio y a nadie en particular.
 *
 * <p>Estas seis llevan `responsable`, y no es una anotacion decorativa: es el campo por el que
 * Alertmanager puede enrutar, y sobre todo es lo que hace que la pregunta «¿quien mira esto?» tenga
 * respuesta antes de que suene. Una guarda exige que **ninguna de las seis** se quede sin el.
 *
 * ## Lo que estas reglas NO pueden hacer todavia, y esta dicho
 *
 * Ninguna de las seis series existe: no hay emisor (ver `cifras-del-corte.ts`). Una regla sobre una
 * serie ausente **no se dispara** —Prometheus no la evalua a nada— y eso es exactamente lo que hay
 * que no confundir con «todo va bien». Por eso cada una lleva ademas su **regla gemela de
 * ausencia**, con `absent()`: si la serie no llega, suena que no llega. Es la mitad que `#156`
 * aprendio con `pg_up` — «con solo `pg_up`, la alerta nunca llegaba a firing», porque cuando el pod
 * entero cae la serie deja de existir en vez de valer cero.
 */

/** Una regla de Prometheus, en el formato de `alertas.yml`. */
interface Regla {
  readonly alert: string;
  readonly expr: string;
  readonly for: string;
  readonly labels: { severidad: string; responsable: string };
  readonly annotations: { resumen: string; descripcion: string; runbook: string };
}

/** El nombre de la alerta: la cifra en PascalCase. */
function nombreDe(cifra: CifraDelCorte, sufijo = ""): string {
  const camello = cifra.id
    .split("-")
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
    .join("");
  return camello + sufijo;
}

/** Las dos reglas de una cifra: la del umbral y la de la ausencia. */
export function reglasDe(cifra: CifraDelCorte): readonly Regla[] {
  return [
    {
      alert: nombreDe(cifra),
      expr: `${cifra.metrica} > ${cifra.umbral}`,
      // Cinco minutos: lo bastante para que un pico de una corrida no despierte a nadie, y lo
      // bastante poco para que una discrepancia se vea el mismo dia.
      for: "5m",
      labels: {
        severidad: cifra.umbral === 0 ? "critica" : "advertencia",
        responsable: cifra.responsable,
      },
      annotations: {
        resumen: `${cifra.titulo} por encima de ${cifra.umbral}`,
        descripcion: descripcionDe(cifra),
        runbook: cifra.runbook,
      },
    },
    {
      alert: nombreDe(cifra, "SinSerie"),
      // `absent()` vale 1 cuando la serie NO existe. Es la leccion de #156 con `pg_up`: cuando
      // el emisor cae, la serie no pasa a cero — deja de existir, y una regla que solo mirara
      // el valor nunca llegaria a `firing`.
      expr: `absent(${cifra.metrica})`,
      // Una hora: la serie tarda en aparecer tras un despliegue, y avisar de eso cada vez
      // convertiria esta regla en ruido — que es como se pierden las alertas de verdad.
      for: "1h",
      labels: { severidad: "advertencia", responsable: cifra.responsable },
      annotations: {
        resumen: `«${cifra.titulo}» lleva una hora sin publicarse`,
        descripcion:
          "La serie no existe, que NO es lo mismo que valer cero: el tablero dibujaria «sin " +
          "datos» y una regla que solo mirara el valor no se disparara nunca. O el emisor no " +
          "esta, o dejo de estarlo.",
        runbook: cifra.runbook,
      },
    },
  ];
}

function descripcionDe(cifra: CifraDelCorte): string {
  if (cifra.fuente.clase === "viva") {
    return `Lo escribe: ${cifra.fuente.escritor}.`;
  }
  return (
    `SIN EMISOR HOY: ${cifra.fuente.motivo}. Lo cierra: ${cifra.fuente.loCierra}. ` +
    "Mientras tanto esta regla no puede dispararse, y su gemela de ausencia si."
  );
}

/** El grupo entero, listo para pegarse a `alertas.yml`. */
export function grupoDelCorte() {
  return {
    name: "kamayuk-corte",
    rules: CIFRAS_DEL_CORTE.flatMap(reglasDe),
  };
}

/** Donde vive el archivo comprometido. */
export function archivoDeLasReglas(): string {
  return join(raizDeInfra(), "observabilidad/alertas-del-corte.yml");
}

/**
 * El YAML, escrito a mano y no con una libreria.
 *
 * `infra/` no tiene ninguna dependencia de YAML —`alertas.yml` se escribio a mano y
 * `componentes.test.ts` lo lee con expresiones regulares—, y traer una para seis reglas seria
 * traer una dependencia al despliegue por comodidad de un generador.
 */
export function reglasComoYaml(): string {
  const lineas: string[] = [
    "# ARCHIVO GENERADO — no editar a mano. Lo produce `observabilidad/reglas-del-corte.ts`",
    "# del catalogo de `cifras-del-corte.ts`, y `cifras-del-corte.test.ts` exige que el",
    "# comprometido sea el que ese generador produce. Se regenera con `yarn observabilidad-del-corte`.",
    "#",
    "# Dos reglas por cifra, y la segunda no sobra: `absent()` avisa de que la serie NO EXISTE,",
    "# que no es lo mismo que valer cero. Es la leccion de #156 con `pg_up` — cuando el emisor",
    "# cae, la serie deja de existir en vez de pasar a cero, y una regla que solo mirara el",
    "# valor nunca llegaria a `firing`.",
    "groups:",
    "  - name: kamayuk-corte",
    "    rules:",
  ];

  for (const regla of grupoDelCorte().rules) {
    lineas.push(
      `      - alert: ${regla.alert}`,
      `        expr: ${regla.expr}`,
      `        for: ${regla.for}`,
      "        labels:",
      `          severidad: ${regla.labels.severidad}`,
      `          responsable: ${entrecomillado(regla.labels.responsable)}`,
      "        annotations:",
      `          resumen: ${entrecomillado(regla.annotations.resumen)}`,
      `          descripcion: ${entrecomillado(regla.annotations.descripcion)}`,
      `          runbook: ${entrecomillado(regla.annotations.runbook)}`,
      "",
    );
  }
  return `${lineas.join("\n").trimEnd()}\n`;
}

/** Entre comillas dobles, con las de dentro escapadas. Es todo lo que este YAML necesita. */
function entrecomillado(texto: string): string {
  return `"${texto.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
