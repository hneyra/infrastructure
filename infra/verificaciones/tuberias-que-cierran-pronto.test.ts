/**
 * #91 — bajo `set -o pipefail`, una tuberia que acaba en un consumidor que SALE PRONTO convierte a
 * su productor en un fallo — y el codigo de salida que se lee no es el de la busqueda.
 *
 * ## El defecto, medido tres veces en el mismo dia
 *
 * `grep -q` termina en cuanto encuentra; `head -n` en cuanto ha leido sus lineas. El de la
 * izquierda se queda sin lector, recibe SIGPIPE y muere. Con `pipefail` ese codigo es el de la
 * tuberia entera, asi que:
 *
 * ```bash
 * # Medido contra la plataforma de compose, 2026-09-11:
 * kc() { docker compose exec -T identidad "$@"; }
 * kc sh -c 'for i in $(seq 1 200000); do echo linea-$i; done' | grep -q linea-5
 * #  -> exit 255, HABIENDO ENCONTRADO la coincidencia
 * ```
 *
 * Y segun donde este la tuberia, el sintoma es distinto y ninguno se parece a la causa:
 *
 * | Forma | Lo que pasa |
 * |---|---|
 * | `if ! productor \| grep -q X` | dice que **X no esta** teniendolo delante |
 * | `productor \| grep -q X \|\| muere` | muere con el mensaje de la rama contraria |
 * | `v=$(productor \| head -1)` | con `set -e`, **aborta el guion** sin decir por que |
 *
 * Esto costo dos corridas rojas de `arranque-en-limpio` en #89 y #90 con **el mismo mensaje
 * falso**: «el realm «kamayuk» no tiene el ambito «kamayuk-servicio»» mientras el volcado de
 * diagnostico, dos segundos despues, listaba los catorce ambitos con `kamayuk-servicio` dentro.
 * Lo que lo delato no fue leer el codigo: fue que la linea acusada es **byte a byte identica en
 * `main`, que salia verde**, asi que el rojo no podia venir de ningun diff. Con catorce ambitos
 * el resultado depende de en cuantos trozos llegue la salida — o sea que es una carrera, y una
 * carrera en una comprobacion es una comprobacion que a veces miente.
 *
 * ## Y es la SEGUNDA vez, que es el motivo de que esto sea una guarda y no un comentario
 *
 * El hallazgo ya estaba escrito en `despliegue/identidad/crear-usuario.sh`, con todas las letras:
 *
 * > «`| head -1` cerraria la tuberia antes de que kcadm termine de escribir, y con `pipefail` ese
 * > SIGPIPE mata el guion entero por un motivo que no tiene nada que ver con Keycloak. Se lee
 * > todo y se recorta despues.»
 *
 * Su hermano `reconciliar-identidades.sh` volvio a hacerlo **ocho veces** —cinco `| head -1` y
 * tres `| grep -q`—. Un comentario dentro de un guion no protege al guion de al lado.
 *
 * ## La forma correcta no lleva tuberia
 *
 * ```bash
 * TODO=$(productor 2>&1) || TODO=""      # se lee entero, y el fallo del productor se ve
 * [[ "$TODO" == *X* ]]                   # busqueda sin proceso al que dejar sin lector
 * primera=${TODO%%$'\n'*}                # «la primera linea», sin `head`
 * ```
 *
 * ## Como esta escrita esta guarda, y por que con una lista declarada
 *
 * Barre los `*.sh` **versionados** que ponen `pipefail` —los que no, no tienen este defecto—.
 * `despliegue/` tiene que estar en **cero**: es el camino que `arranque-en-limpio` ejerce en cada
 * PR, y es donde esto se midio. Los nueve de `infra/respaldo/`, `infra/vps/` e
 * `infra/verificaciones/` van **declarados con su issue**: ejercerlos exige un cluster, un VPS o
 * un respaldo, y cambiar a ciegas un guion que restaura copias es peor que la carrera que arregla.
 *
 * La lista declarada solo puede encogerse, y se comprueba en las dos direcciones (#27): un sitio
 * nuevo sale rojo, y un sitio declarado que ya no existe TAMBIEN sale rojo — si no, la lista se
 * queda diciendo que hay deuda donde ya no la hay, y la siguiente que se cuele se esconde detras.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { raizDelRepositorio } from "../componentes/fuentes";

/** Consumidores que abandonan la tuberia antes de haberla leido entera. */
const CIERRAN_PRONTO = /\|\s*(grep\s+-[a-zA-Z]*q|grep\s+-m\b|head(\s|$))/;

/**
 * Los sitios que YA estaban cuando se escribio esta guarda, con lo que le pasa a cada uno (#91).
 * Ninguno esta en `despliegue/`. Se retiran de aqui arreglandolos, no editando la lista.
 */
const DECLARADOS: ReadonlyMap<string, string> = new Map([
  // El `&& break` no se ejecuta, asi que el bucle sigue esperando a un pod que YA esta listo
  // y acaba en un plazo agotado que acusa al pod.
  ["infra/respaldo/contra-cluster.sh:229", "espera a un pod: el SIGPIPE alarga la espera"],
  // `grep … | head -3` en el camino que IMPRIME los errores: con mas de tres, `set -e` mata el
  // simulacro mientras cuenta por que fallo.
  [
    "infra/respaldo/simulacro-de-restauracion-logica.sh:252",
    "imprime los errores de pg_restore; con mas de 3 aborta al imprimirlos",
  ],
  // `if ! consultar … | grep -q 1`: diria que la tabla restaurada no esta teniendola.
  [
    "infra/respaldo/simulacro-de-restauracion.sh:420",
    "comprueba la tabla restaurada: puede negar una restauracion correcta",
  ],
  ["infra/verificaciones/ambiente/verificar-el-ambiente.sh:216", "`ls … | head -1`"],
  ["infra/verificaciones/ambiente/verificar-el-ambiente.sh:390", "`… | head -1 | sed`"],
  // `if docker logs … | grep -qiE`: daria por roto un motor que arranco bien.
  [
    "infra/verificaciones/motor/lib-motor-local.sh:279",
    "busca errores en el registro del motor: puede inventarlos",
  ],
  ["infra/verificaciones/raiz-sellada/verificar-raiz-sellada.sh:150", "`wal-g --version | head -1`"],
  ["infra/vps/comprobar-lo-asignable.sh:46", "`… | head -1 | tr`"],
  // `if ! kubectl get pods … | grep -q .`: `grep -q .` casa con la PRIMERA linea, asi que es el
  // que mas probabilidad tiene de todos; diria que no hay pods pendientes habiendolos.
  [
    "infra/vps/reservar-recursos-del-nodo.sh:227",
    "cuenta pods pendientes: puede decir que no hay habiendolos",
  ],
]);

/** Un sitio encontrado: `ruta:linea` y la linea de codigo, para el mensaje del rojo. */
interface Sitio {
  readonly donde: string;
  readonly texto: string;
}

function guionesConPipefail(): readonly string[] {
  const raiz = raizDelRepositorio();
  const listado = execFileSync("git", ["-C", raiz, "ls-files", "*.sh"], { encoding: "utf8" })
    .split("\n")
    .filter((l) => l.trim() !== "")
    .sort();
  if (listado.length === 0) {
    throw new Error(
      "`git ls-files *.sh` no devolvio ni un guion: este barrido NO MIDIO NADA. Una guarda que " +
        "se queda sin sujeto no pasa en verde.",
    );
  }
  return listado.filter((ruta) =>
    readFileSync(join(raiz, ruta), "utf8").includes("pipefail"),
  );
}

function sitios(): readonly Sitio[] {
  const raiz = raizDelRepositorio();
  const encontrados: Sitio[] = [];
  for (const ruta of guionesConPipefail()) {
    const lineas = readFileSync(join(raiz, ruta), "utf8").split("\n");
    lineas.forEach((linea, i) => {
      const codigo = linea.trim();
      // Los comentarios se omiten a proposito: esta guarda existe porque el defecto se explica
      // en varios docblocks, y un docblock que lo nombre no puede ponerla roja.
      if (codigo.startsWith("#") || !CIERRAN_PRONTO.test(linea)) return;
      encontrados.push({ donde: `${ruta}:${i + 1}`, texto: codigo });
    });
  }
  return encontrados;
}

const SITIOS = sitios();
const REMEDIO =
  "Remedio: capturar la salida entera —`TODO=$(productor 2>&1) || TODO=\"\"`— y buscar sin " +
  'tuberia: `[[ "$TODO" == *X* ]]`, o `${TODO%%$\'\\n\'*}` en vez de `| head -1`.';

describe("bajo pipefail, ninguna tuberia acaba en un consumidor que sale pronto", () => {
  it("el barrido tiene sujeto: hay guiones con pipefail que mirar", () => {
    // Sin esto, cualquier error en el listado dejaria las tres comprobaciones de abajo en verde
    // sobre el conjunto vacio, que es el modo de fallo de toda guarda que barre.
    expect(guionesConPipefail().length).toBeGreaterThan(20);
  });

  it("`despliegue/` esta en CERO: es el camino que `arranque-en-limpio` ejerce en cada PR", () => {
    const enDespliegue = SITIOS.filter((s) => s.donde.startsWith("despliegue/"));
    expect(
      enDespliegue.map((s) => `${s.donde}\n      ${s.texto}`),
      `[una tuberia que acaba en «grep -q» o «head» bajo pipefail hace fallar al productor: ` +
        `el mensaje que sale es el de la rama contraria, y con «$(…)» y «set -e» aborta el guion. ` +
        `Aqui se midio 255 con la coincidencia ENCONTRADA. ${REMEDIO}]`,
    ).toEqual([]);
  });

  it("no aparece ninguna nueva fuera de `despliegue/`", () => {
    const nuevas = SITIOS.filter((s) => !DECLARADOS.has(s.donde)).map(
      (s) => `${s.donde}\n      ${s.texto}`,
    );
    expect(
      nuevas,
      `[esta forma ya costo dos corridas rojas con un mensaje FALSO, y el hallazgo estaba escrito ` +
        `en crear-usuario.sh antes de que se volviera a hacer ocho veces. ${REMEDIO} Si de verdad ` +
        `no se puede arreglar hoy, entra en DECLARADOS con lo que le pasa a ESE sitio.]`,
    ).toEqual([]);
  });

  it("ningun sitio declarado ha dejado de existir (#27)", () => {
    // La direccion que impide que la lista se quede rancia: un sitio arreglado —o una linea que
    // se movio— tiene que salir de aqui. Si no, la lista afirma una deuda que ya no hay y la
    // siguiente que se cuele se esconde detras de una entrada muerta.
    const encontrados = new Set(SITIOS.map((s) => s.donde));
    const fantasmas = [...DECLARADOS.keys()].filter((d) => !encontrados.has(d));
    expect(
      fantasmas,
      "[estas entradas de DECLARADOS ya no nombran ninguna tuberia: o se arreglaron —y hay que " +
        "retirarlas— o la linea se movio y hay que corregir el numero. Una lista de deuda que " +
        "nombra lo que no existe deja pasar lo que si.]",
    ).toEqual([]);
  });
});
