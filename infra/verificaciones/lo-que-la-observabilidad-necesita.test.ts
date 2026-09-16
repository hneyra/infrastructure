import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { demandaDelStack } from "../capacidad";
import type { Manifiesto } from "../componentes/tipos";
import { emitir } from "../herramientas/emitir-manifiestos";

/**
 * #203 — las dos comprobaciones de observabilidad levantan lo que LEEN, y cabe en el runner.
 *
 * `verificar-alertas.sh` y `verificar-tableros.sh` aplican el manifiesto de `stg` **de
 * verdad** sobre el nodo unico de un `kind`. Los dos traian su propia copia de la lista de
 * lo que no hay que aplicar, y esa lista se escribio cuando el ambiente tenia UN espacio de
 * nombres: nombra prefijos `kamayuk-stg-*` y no ve ninguno de los cinco que ADR-0031 anadio.
 *
 * Medido sobre `main` el 2026-09-16, con los cinco clones hermanos en `origin/main`: lo que
 * los dos guiones aplicaban pedia **2 310m / 8 224Mi**, de los que **1 600m / 6 592Mi** eran
 * de los cinco sistemas, que ni una regla de `alertas.yml` ni un panel del tablero leen. El
 * nodo de `kind` sobre el runner de 2 CPU deja **1 050m / 7 778Mi**. Resultado: los dos
 * trabajos llevaban dias en rojo con «Insufficient cpu» sobre Prometheus y Grafana.
 *
 * <h2>Lo que esta guarda sostiene, y por que no es un `grep`</h2>
 *
 * El filtro **se ejecuta** sobre el manifiesto de verdad, y lo que se afirma es lo que
 * queda: que no sobrevive nada de otro sistema, que SI sobrevive todo lo que los dos
 * guiones esperan que quede listo, y que la suma **cabe** en el presupuesto medido. Esa
 * tercera es la que muerde el dia que alguien suba un `request` de la plataforma: sale rojo
 * en un PR, y no cuarenta minutos despues en un trabajo que necesita clúster.
 */

const RAIZ_DE_INFRA = join(import.meta.dirname, "..");
const FILTRO = join(RAIZ_DE_INFRA, "observabilidad", "lo-que-la-observabilidad-necesita.mjs");

/**
 * El presupuesto del nodo, medido en CI y no supuesto.
 *
 * `2 CPU / 8128880Ki` asignables, de los que el plano de control de `kind` ya pide 950m
 * (corrida `35018105559`, trabajo `capacidad`). De la memoria, `capacidad.ts` descuenta
 * ademas los 160Mi de los pods de serie. Deja 1 050m y 7 778Mi.
 */
const LIBRE_EN_EL_NODO = { cpuEnMili: 1050, memoriaEnMi: 7778 };

/** El espacio de nombres de la plataforma en `stg`: el unico que estas dos comprobaciones usan. */
const DE_LA_PLATAFORMA = "kamayuk-stg";

/** Lo que los dos guiones esperan a `rollout status` antes de medir nada. */
const LO_QUE_LOS_GUIONES_ESPERAN = [
  "kamayuk-stg-postgres",
  "kamayuk-stg-observabilidad-prometheus",
  "kamayuk-stg-observabilidad-alertmanager",
  "kamayuk-stg-observabilidad-node-exporter",
  "kamayuk-stg-observabilidad-kube-state-metrics",
];

interface Lista {
  items: Manifiesto[];
}

function loQueSobrevive(): Lista {
  const salida = execFileSync("node", [FILTRO, "stg"], {
    input: emitir({ ambiente: "stg" }),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(salida) as Lista;
}

describe("#203 · el filtro de las dos comprobaciones de observabilidad", () => {
  it("no aplica nada de otro sistema, y por eso cabe en el nodo del runner", () => {
    const { items } = loQueSobrevive();

    const ajenos = [
      ...new Set(
        items
          .map((i) => (i.kind === "Namespace" ? i.metadata.name : (i.metadata.namespace ?? "")))
          .filter((espacio) => espacio !== "" && espacio !== DE_LA_PLATAFORMA),
      ),
    ].sort();
    expect(
      ajenos,
      `el filtro deja pasar objetos de ${String(ajenos.length)} espacio(s) de nombres ajenos:\n` +
        `  ${ajenos.join("\n  ")}\n` +
        "  Ninguna regla de `alertas.yml` ni ningun panel del tablero los lee, y lo que piden\n" +
        "  no cabe en el nodo de `kind`: los pods que SI hacen falta se quedan `Pending`.",
    ).toEqual([]);
  });

  it("deja lo que los dos guiones esperan a que quede listo", () => {
    const { items } = loQueSobrevive();
    const desplegados = items
      .filter((i) => i.kind === "Deployment")
      .map((i) => i.metadata.name)
      .sort();

    const faltan = LO_QUE_LOS_GUIONES_ESPERAN.filter((n) => !desplegados.includes(n));
    expect(
      faltan,
      `el filtro se llevo por delante lo que los guiones esperan:\n  ${faltan.join("\n  ")}\n` +
        "  Sin esto, `rollout status` espera 300s a un Deployment que no existe y la\n" +
        "  comprobacion muere sin haber medido nada — que es el modo de fallo que este\n" +
        "  filtro NO puede tener: encoger hasta que no quede sujeto.",
    ).toEqual([]);
  });

  it("lo que queda cabe en los 1 050m / 7 778Mi que el nodo de kind deja libres", () => {
    const { items } = loQueSobrevive();
    const demanda = demandaDelStack(items);

    expect(
      demanda.picoDeArranque.cpuEnMili,
      `lo que las dos comprobaciones levantan pide ${String(demanda.picoDeArranque.cpuEnMili)}m ` +
        `y el nodo deja ${String(LIBRE_EN_EL_NODO.cpuEnMili)}m. El planificador dejara pods ` +
        "`Pending` por «Insufficient cpu», y los dos trabajos moriran esperando un `rollout` " +
        "que no puede ocurrir.",
    ).toBeLessThanOrEqual(LIBRE_EN_EL_NODO.cpuEnMili);

    expect(
      Math.round(demanda.picoDeArranque.memoriaEnMi),
      `lo que las dos comprobaciones levantan pide ` +
        `${String(Math.round(demanda.picoDeArranque.memoriaEnMi))}Mi y el nodo deja ` +
        `${String(LIBRE_EN_EL_NODO.memoriaEnMi)}Mi.`,
    ).toBeLessThanOrEqual(LIBRE_EN_EL_NODO.memoriaEnMi);
  });

  /**
   * Y que el filtro es UNO. Es la leccion de C-20: el defecto no era el patron, era que
   * estaba copiado — y una correccion en una copia deja la otra como estaba, que es
   * exactamente como estos dos guiones llegaron hasta aqui.
   */
  it("los dos guiones canalizan por el mismo archivo, y ninguno guarda su propia lista", () => {
    for (const guion of ["verificar-alertas.sh", "verificar-tableros.sh"]) {
      const fuente = readFileSync(join(RAIZ_DE_INFRA, "observabilidad", guion), "utf8");
      expect(
        fuente,
        `${guion} ya no canaliza por el filtro compartido: si vuelve a filtrar por su cuenta, ` +
          "las dos listas se separan otra vez.",
      ).toContain("node observabilidad/lo-que-la-observabilidad-necesita.mjs stg");
      expect(
        fuente.includes("kamayuk-stg-implantacion-") || fuente.includes("const pesados"),
        `${guion} vuelve a llevar dentro su propia lista de lo que no se aplica.`,
      ).toBe(false);
    }
  });
});
