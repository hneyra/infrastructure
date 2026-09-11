/**
 * Los guiones que corren DENTRO de la imagen de Keycloak solo pueden usar lo que esa imagen
 * trae, y trae muy poco.
 *
 * ## El defecto que esto cierra, medido en `stg`
 *
 * El `Job` del realm encadena `reconciliar-realm.sh` y `reconciliar-identidades.sh` dentro de
 * `quay.io/keycloak/keycloak`, que es una imagen minima. Entre el 2026-09-09 y el 2026-09-11
 * sus **CUATRO** corridas fallaron, y el motivo estaba en la primera linea de su registro:
 *
 * ```
 * El realm no existe: se crea.
 * Created new realm with id 'kamayuk'
 * /realm/reconciliar-realm.sh: line 147: awk: command not found
 * ```
 *
 * **El sintoma aguas abajo no se parece a eso en nada.** Sin ese guion no hay clientes de
 * servicio, asi que las implantaciones de tres satelites morian con «El emisor contesto 404 al
 * pedir el token de `kamayuk-rentas-servicio-200105`» —que manda a mirar el consumidor— y los
 * cuatro `CronJob` del buzon fallaban en cada vuelta. Dos dias, cuatro `Job` y tres sistemas
 * sin implantar, por una herramienta ausente que el propio guion nombraba.
 *
 * Y el mismo defecto estaba entrando por segunda vez por otro sitio: `reconciliar-identidades.sh`
 * uso `python3` para arreglar el `-q name=` que Keycloak ignora, **en su rama `servicios`, que
 * corre en los dos modos**. Funcionaba en compose —el anfitrion tiene python3— y habria muerto
 * en el cluster con «python3: command not found» en el paso que crea justamente esos clientes.
 *
 * ## Que hay dentro, y como se sabe
 *
 * Medido ejecutando `command -v` dentro del contenedor de `stg`:
 *
 * | Hay | No hay |
 * |---|---|
 * | `sed`, `grep`, `cut`, `tr`, `head`, `tail`, `sort`, `bash` | `awk`, `python3`, `jq`, `curl` |
 *
 * La lista de ausentes se escribe aqui a mano **a proposito**: derivarla exigiria un contenedor
 * levantado, y entonces esta comprobacion dejaria de correr en un PR — que es justo cuando hace
 * falta. Si la imagen cambia, lo que cambia es esta lista, y el commit que la cambie dice por que.
 *
 * ## Lo que esta guarda NO puede ver
 *
 * Que la herramienta exista no significa que se use bien. Y no mira los guiones que corren SOLO
 * en el anfitrion —`preparar-identidades.sh`, `crear-usuario.sh`, `restaurar-ambitos-de-fabrica.sh`,
 * `levantar-todo.sh`—, que pueden usar lo que quieran: es la razon por la que
 * `restaurar-ambitos-de-fabrica.sh` habla REST con `curl` y sus hermanos no.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { raizDelRepositorio } from "../componentes/fuentes";

/**
 * Los guiones que el `Job` del realm monta en `/realm/` y ejecuta dentro de la imagen.
 *
 * Salen del `command` del `Job` (`infra/componentes/Identidad.ts`), y la prueba de abajo
 * comprueba que esta lista sigue siendo la que ese `Job` ejecuta: una tercera pieza montada
 * ahi y no censada aqui volveria a poder usar `awk` sin que nadie lo note.
 */
const DENTRO_DE_LA_IMAGEN = [
  "infra/componentes/identidad/reconciliar-realm.sh",
  "despliegue/identidad/reconciliar-identidades.sh",
] as const;

/** Lo que la imagen de Keycloak NO trae. Medido dentro del contenedor de `stg`. */
const AUSENTES = ["awk", "python3", "jq", "curl"] as const;

/** Una linea de comentario de shell no invoca nada. */
const esComentario = (linea: string) => /^\s*#/.test(linea);

/**
 * Los sitios donde el guion COMPRUEBA si la herramienta esta, en vez de usarla, son legitimos:
 * es lo que hace `reconciliar-identidades.sh` con `python3` antes de derivar los TSV en modo
 * compose. Se reconocen por `command -v`.
 */
const esComprobacion = (linea: string) => /command -v/.test(linea);

/**
 * La region que el guion DECLARA como alcanzable solo en modo compose, con dos marcadores.
 *
 * No es una lista de numeros de linea —que se queda vieja al primer cambio— ni una excepcion
 * por archivo —que eximiria el archivo entero, y es justo donde estaba el defecto—. El bloque
 * de derivacion de los TSV de `reconciliar-identidades.sh` es **inalcanzable en `directo`**
 * porque `Identidad.ts` escribe los tres `.tsv` en el ConfigMap que monta en `/realm`, y el
 * guion lo dice ahi con su motivo. Lo que esta guarda exige es que lo diga: quitar los
 * marcadores la pone roja en vez de ensanchar la exencion en silencio.
 */
const ABRE = />>> SOLO-COMPOSE/;
const CIERRA = /<<< SOLO-COMPOSE/;

type Uso = { archivo: string; linea: number; herramienta: string; texto: string };

function usosDe(archivo: string): Uso[] {
  const texto = readFileSync(join(raizDelRepositorio(), archivo), "utf8");
  const usos: Uso[] = [];
  let dentroDeLaRegion = false;
  texto.split("\n").forEach((linea, i) => {
    if (ABRE.test(linea)) dentroDeLaRegion = true;
    else if (CIERRA.test(linea)) dentroDeLaRegion = false;
    if (dentroDeLaRegion || esComentario(linea) || esComprobacion(linea)) return;
    for (const herramienta of AUSENTES) {
      // Al principio de una orden: inicio de linea, tras una tuberia, un `;`, un `&&`, un
      // `$(` o un espacio. No basta con buscar el nombre: `python3` aparece en mensajes de
      // error y en rutas, y eso no invoca nada.
      const patron = new RegExp(`(^|[|;&(]|\\s)${herramienta}(\\s|$)`);
      if (patron.test(linea)) {
        usos.push({ archivo, linea: i + 1, herramienta, texto: linea.trim() });
      }
    }
  });
  return usos;
}

/** Las regiones declaradas, para poder afirmar que existen y estan cerradas. */
function regionesDe(archivo: string): { abren: number; cierran: number } {
  const lineas = readFileSync(join(raizDelRepositorio(), archivo), "utf8").split("\n");
  return {
    abren: lineas.filter((l) => ABRE.test(l)).length,
    cierran: lineas.filter((l) => CIERRA.test(l)).length,
  };
}

describe("los guiones que corren dentro de la imagen de Keycloak usan solo lo que hay", () => {
  it("ninguno invoca una herramienta que la imagen no trae", () => {
    const usos = DENTRO_DE_LA_IMAGEN.flatMap(usosDe);
    expect(
      usos.map((u) => `${u.archivo}:${u.linea}\n      → «${u.herramienta}»: ${u.texto}`),
      `la imagen de Keycloak no trae ${AUSENTES.join(", ")}. Un guion que los invoque no falla ` +
        "al componer ni al revisarlo: falla DENTRO del contenedor, con «command not found», y " +
        "el sintoma llega mucho despues y en otro sitio — en `stg` fueron tres sistemas sin " +
        "implantar y un «404 al pedir el token de kamayuk-rentas-servicio-200105» que manda a " +
        "mirar el consumidor. Lo que la imagen SI tiene: sed, grep, cut, tr, head, tail, sort",
    ).toEqual([]);
  });

  it("EL CENTINELA: la guarda encuentra un `awk` si alguien lo mete", () => {
    // Sin esto, la afirmacion de arriba se cumpliria igual con el escaner roto —que es como
    // este defecto llego a `main`: nadie estaba mirando.
    const conAwk = [
      'FOO=$(cmd | awk -F, \'{ print $1 }\')',
      "awk '{ print }' archivo",
      "cmd && awk -v n=1 '{}'",
    ];
    for (const linea of conAwk) {
      const patron = new RegExp(`(^|[|;&(]|\\s)awk(\\s|$)`);
      expect(patron.test(linea), `no detecta el awk en «${linea}»`).toBe(true);
    }
    // Y no se dispara con lo que NO es una invocacion.
    expect(esComentario("    # con awk seria mas corto")).toBe(true);
    expect(esComprobacion('command -v python3 >/dev/null')).toBe(true);
    expect(new RegExp(`(^|[|;&(]|\\s)python3(\\s|$)`).test('echo "falta python3-devel"')).toBe(
      false,
    );
  });

  it("la exencion de compose esta DECLARADA, cerrada, y con su fallo ruidoso dentro", () => {
    // Las tres mitades hacen falta. Sin los marcadores la guarda senalaria las cuatro lineas
    // legitimas del bloque de TSV y alguien la apagaria; sin el cierre, la exencion se
    // tragaria el resto del archivo —donde estaba el defecto—; y sin el `command -v` dentro,
    // el dia que `Identidad.ts` deje de escribir los `.tsv` el sintoma volveria a ser un
    // «command not found» en vez de un mensaje que nombra las dos cosas que faltan.
    const archivo = "despliegue/identidad/reconciliar-identidades.sh";
    const { abren, cierran } = regionesDe(archivo);
    expect(abren, `«${archivo}» no declara ninguna region «>>> SOLO-COMPOSE»`).toBe(1);
    expect(cierran, `la region de «${archivo}» no se cierra con «<<< SOLO-COMPOSE»`).toBe(1);

    const texto = readFileSync(join(raizDelRepositorio(), archivo), "utf8");
    const dentro = texto.slice(
      texto.search(ABRE),
      texto.search(CIERRA) === -1 ? undefined : texto.search(CIERRA),
    );
    expect(
      /command -v python3/.test(dentro),
      "la region eximida no comprueba que `python3` este antes de usarlo: si algun dia se " +
        "alcanza sin el, el sintoma es «command not found» y no «falta el tsv y la herramienta»",
    ).toBe(true);
  });

  it("y la lista de guiones es la que el `Job` del realm ejecuta de verdad", () => {
    // Una tercera pieza montada en `/realm/` y no censada arriba volveria a poder usar `awk`
    // sin que nadie lo note: es el hueco por el que este defecto entro.
    const componente = readFileSync(
      join(raizDelRepositorio(), "infra/componentes/Identidad.ts"),
      "utf8",
    );
    // `m[1]` es `string | undefined` para TypeScript aunque el grupo sea obligatorio en el
    // patron, asi que se filtra en vez de aseverarlo: un `!` aqui seria decirle al compilador
    // que confie en una lectura de texto.
    const ejecutados = [...componente.matchAll(/\/realm\/([a-z-]+\.sh)/g)]
      .map((m) => m[1])
      .filter((n): n is string => n !== undefined);
    expect(ejecutados.length, "el `Job` del realm no ejecuta ningun guion: ¿cambio de forma?")
      .toBeGreaterThan(0);

    const censados = DENTRO_DE_LA_IMAGEN.map((r) => r.slice(r.lastIndexOf("/") + 1));
    expect(
      [...new Set(ejecutados)].filter((n) => !censados.includes(n)),
      "el `Job` del realm ejecuta un guion que esta guarda no revisa, asi que ese puede usar " +
        "`awk` o `python3` sin que nadie lo note. Anadelo a DENTRO_DE_LA_IMAGEN",
    ).toEqual([]);
  });
});
