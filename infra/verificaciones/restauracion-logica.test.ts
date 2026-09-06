import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { raizDelRepositorio } from "../componentes/fuentes";
import { SISTEMAS, clonDe } from "./deriva-de-migraciones";

/**
 * El simulacro de restauracion LOGICA, y las decisiones que lo gobiernan (C-11).
 *
 * ## Que cierra
 *
 * El hueco 3 de C-4, escrito alli con todas las letras: «la restauracion logica no la
 * comprueba nadie de forma continua […] un `pg_restore` que fallara por otro motivo
 * seguiria saliendo con codigo 0 y sin que nada lo dijera». C-4 arreglo la funcion; lo que
 * no existia es lo que lo habria encontrado.
 *
 * ## Por que estas pruebas no levantan un motor
 *
 * El simulacro entero necesita PostgreSQL, y una comprobacion que solo corre donde hay
 * motor no corre en ningun PR. Es el reparto de #731 con `puerto.sh`: lo que decide vive
 * en `lib-restauracion-logica.sh` y aqui se **ejecuta** en un bash de verdad. Lo que no se
 * puede ejercitar sin motor —volcar y restaurar— se corre a mano y queda medido en
 * `docs/00-gobierno/C-11-restauracion-logica.md`, con sus recuentos.
 *
 * Lo que si se afirma aqui, y es la mitad que se queda rancia sola, es que las listas no
 * se dupliquen: los sistemas salen de {@link SISTEMAS}, los caminos los resuelve el propio
 * shell, y las dos lecturas se comparan.
 */

const RAIZ = raizDelRepositorio();
const LIB = join(RAIZ, "infra/respaldo/lib-restauracion-logica.sh");
const GUION = join(RAIZ, "infra/respaldo/simulacro-de-restauracion-logica.sh");
const RECURSOS = join(RAIZ, "infra/respaldo/restauracion-logica");

const TEMPORALES: string[] = [];
afterAll(() => {
  for (const ruta of TEMPORALES) rmSync(ruta, { recursive: true, force: true });
});

function directorioTemporal(prefijo: string): string {
  const ruta = mkdtempSync(join(tmpdir(), prefijo));
  TEMPORALES.push(ruta);
  return ruta;
}

/** Correr una funcion de la biblioteca de verdad, en un bash con `set -u`. */
function enBash(guion: string): { salida: string; error: string; codigo: number } {
  try {
    const salida = execFileSync("bash", ["-c", `set -u; . ${JSON.stringify(LIB)}\n${guion}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { salida: salida.trim(), error: "", codigo: 0 };
  } catch (fallo) {
    const detalle = fallo as { status?: number; stdout?: string; stderr?: string };
    return {
      salida: (detalle.stdout ?? "").trim(),
      error: (detalle.stderr ?? "").trim(),
      codigo: detalle.status ?? -1,
    };
  }
}

function lineas(texto: string): string[] {
  return texto.split("\n").filter((linea) => linea.trim().length > 0);
}

describe("C-11 — la version del motor y la de los binarios", () => {
  it("lee el major de las cuatro formas en que PostgreSQL lo escribe", () => {
    expect(enBash('rl_major_de "pg_dump (PostgreSQL) 16.15 (Homebrew)"').salida).toBe("16");
    expect(enBash('rl_major_de "psql (PostgreSQL) 18.6 (Homebrew)"').salida).toBe("18");
    expect(
      enBash('rl_major_de "PostgreSQL 16.15 (Homebrew) on aarch64-apple-darwin25.6.0"').salida,
    ).toBe("16");
    expect(enBash('rl_major_de "16.15"').salida).toBe("16");
  });

  it("y se NIEGA a adivinar cuando no hay ningun numero que leer", () => {
    // Un major mal leido convierte la guarda de abajo en una que dice que si a todo, que
    // es peor que no tenerla.
    const resultado = enBash('rl_major_de "no soy una version"');

    expect(resultado.codigo).not.toBe(0);
    expect(resultado.error).toContain("No se puede leer la version mayor");
  });

  it("admite PostgreSQL 16 y rechaza 17 y 18, nombrando a C-4", () => {
    expect(enBash("rl_exigir_version_soportada 16").codigo).toBe(0);

    for (const major of ["17", "18"]) {
      const resultado = enBash(`rl_exigir_version_soportada ${major}`);
      expect(resultado.codigo, `PostgreSQL ${major} deberia rechazarse`).not.toBe(0);
      expect(resultado.error).toContain("C-4");
    }
  });

  it("y la version que admite es la misma que declaran los cuatro backends", () => {
    // No se escribe dos veces: `MotorPostgres.MAJOR_SOPORTADA` ya la declara en los cuatro
    // sistemas, y el simulacro no puede admitir una version que ellos rechazan.
    const delShell = enBash("echo $RL_MAJOR_SOPORTADA").salida;

    for (const sistema of SISTEMAS) {
      const motor = join(
        clonDe(sistema),
        `backend/kamayuk-${sistema.nombre}-esquema/src/testFixtures/java/kamayuk/` +
          `${sistema.nombre}/esquema/MotorPostgres.java`,
      );
      const declarado = /MAJOR_SOPORTADA\s*=\s*(\d+)/.exec(readFileSync(motor, "utf8"))?.[1];

      expect(declarado, `«${sistema.nombre}» no declara MAJOR_SOPORTADA`).toBeDefined();
      expect(delShell, `«${sistema.nombre}» y el simulacro admiten versiones distintas`).toBe(
        declarado,
      );
    }
  });

  it("nombra CADA binario que no es del major del motor, no «alguno»", () => {
    // En esta maquina el `pg_dump` del PATH es el 18 y el motor el 16. Volcar con uno y
    // restaurar con otro mide otra cosa, y «alguno no cuadra» no dice cual.
    const resultado = enBash(
      "rl_exigir_binarios_del_motor 16 psql=16 pg_dump=18 pg_restore=18",
    );

    expect(resultado.codigo).not.toBe(0);
    expect(resultado.error).toContain("«pg_dump» es de PostgreSQL 18");
    expect(resultado.error).toContain("«pg_restore» es de PostgreSQL 18");
    expect(resultado.error).not.toContain("«psql»");
  });

  it("y pasa cuando los tres son del motor: no dice que no a todo", () => {
    expect(
      enBash("rl_exigir_binarios_del_motor 16 psql=16 pg_dump=16 pg_restore=16").codigo,
    ).toBe(0);
  });
});

describe("C-11 — las migraciones van en orden de VERSION, no de texto", () => {
  it("pone V2 antes que V10, que es lo que `ls` no hace", () => {
    // Se descubrio ejecutandolo: con el orden de texto, `rentas` muere en
    // «relation "pago_recibido" does not exist» —V10 altera lo que V8 crea— y el sintoma
    // no se parece a su causa.
    const directorio = directorioTemporal("c11-orden-");
    for (const nombre of ["V10__diez.sql", "V2__dos.sql", "V1__uno.sql", "V9__nueve.sql"]) {
      writeFileSync(join(directorio, nombre), "SELECT 1;\n");
    }

    const orden = lineas(enBash(`rl_migraciones_en_orden ${JSON.stringify(directorio)}`).salida);

    expect(orden.map((ruta) => ruta.split("/").pop())).toEqual([
      "V1__uno.sql",
      "V2__dos.sql",
      "V9__nueve.sql",
      "V10__diez.sql",
    ]);
  });

  it("y lo hace igual sobre los cinco esquemas de verdad", () => {
    for (const sistema of SISTEMAS) {
      const directorio = enBash(
        `rl_migraciones_de ${JSON.stringify(sistema.nombre)} ${JSON.stringify(RAIZ)}`,
      ).salida;
      const versiones = lineas(
        enBash(`rl_migraciones_en_orden ${JSON.stringify(directorio)}`).salida,
      ).map((ruta) => Number(/\/V(\d+)__/.exec(ruta)?.[1]));

      expect(versiones.length, `«${sistema.nombre}» sin migraciones`).toBeGreaterThan(0);
      expect(versiones, `«${sistema.nombre}» fuera de orden`).toEqual([...versiones].sort((a, b) => a - b));
    }
  });

  it("un directorio sin migraciones NO pasa en verde", () => {
    // Al reves que con las extensiones, cero no es una respuesta legitima: significa que
    // la ruta esta mal, y devolver nada dejaria al simulacro volcando una base vacia.
    const vacio = directorioTemporal("c11-vacio-");
    const resultado = enBash(`rl_migraciones_en_orden ${JSON.stringify(vacio)}`);

    expect(resultado.codigo).not.toBe(0);
    expect(resultado.error).toContain("no tiene ninguna migracion");
  });
});

describe("C-11 — el libro de Flyway se DERIVA de las migraciones", () => {
  /**
   * Ninguno de los cuatro lo necesita hoy, y el contraste va fabricado.
   *
   * Se medía contra el monolito, cuyo `V21` hace `GRANT SELECT ON flyway_schema_history` —de
   * modo que su esquema no se puede aplicar con psql a secas—. Se fue con `E`, y de los cuatro
   * ninguno la toca: sus baselines la nombran solo en un comentario para explicar por que NO
   * la usan. Asi que el «si» se fabrica, que es lo unico que impide que esta funcion pase a
   * decir que no a todo sin que nadie lo note.
   */
  it("ninguno de los cuatro lo necesita, y el caso que si lo pide se detecta", () => {
    const dirDe = (sistema: string) =>
      enBash(`rl_migraciones_de ${JSON.stringify(sistema)} ${JSON.stringify(RAIZ)}`).salida;

    for (const sistema of SISTEMAS) {
      expect(
        enBash(`rl_necesita_libro_de_flyway ${JSON.stringify(dirDe(sistema.nombre))}`).codigo,
        `«${sistema.nombre}» toca flyway_schema_history en una migracion`,
      ).not.toBe(0);
    }

    const directorio = directorioTemporal("c11-libro-si-");
    writeFileSync(
      join(directorio, "V1__baseline.sql"),
      "GRANT SELECT ON flyway_schema_history TO kamayuk_app;\n",
    );
    expect(enBash(`rl_necesita_libro_de_flyway ${JSON.stringify(directorio)}`).codigo).toBe(0);
  });

  it("y no cuenta el que solo aparece en un comentario", () => {
    // Los cuatro baselines nombran `flyway_schema_history` en su cabecera para explicar
    // por que NO la usan. Es el hueco de #426 y #558, y por eso se fabrica el caso.
    const directorio = directorioTemporal("c11-libro-");
    writeFileSync(
      join(directorio, "V1__baseline.sql"),
      "-- No tocamos flyway_schema_history: en Kubernetes no hay equivalente.\nSELECT 1;\n",
    );

    expect(
      enBash(`rl_necesita_libro_de_flyway ${JSON.stringify(directorio)}`).codigo,
    ).not.toBe(0);
  });
});

describe("C-11 — donde vive el esquema de cada sistema no se escribe dos veces", () => {
  it("lo que el shell resuelve es lo que declara SISTEMAS", () => {
    // El shell busca `backend/*/src/main/resources/db` en el clon hermano, con el mismo
    // criterio que `crear-extensiones.sh`. Que coincida con la tabla que ya mantiene
    // `deriva-de-migraciones.ts` no se supone: se ejecuta y se compara.
    for (const sistema of SISTEMAS) {
      const delShell = enBash(
        `rl_migraciones_de ${JSON.stringify(sistema.nombre)} ${JSON.stringify(RAIZ)}`,
      ).salida;

      expect(resolve(delShell), `«${sistema.nombre}»`).toBe(
        resolve(clonDe(sistema), sistema.migraciones),
      );
    }
  });

  /**
   * **Ya no hay ninguna excepcion** (`E`). Aqui habia una prueba de que `sgtm` se resolvia a
   * la copia local de este repositorio —«que es la que se aplica»—: esa copia se retiro con
   * el monolito, y los cuatro que quedan se resuelven todos igual, en su clon hermano. Lo
   * que lo fija es la prueba de arriba, que los recorre a los cuatro sin excepciones.
   */

  it("y el `crear-roles.sql` que resuelve existe en los cuatro", () => {
    for (const sistema of SISTEMAS) {
      const roles = enBash(
        `rl_roles_de ${JSON.stringify(sistema.nombre)} ${JSON.stringify(RAIZ)}`,
      ).salida;

      expect(existsSync(roles), `«${sistema.nombre}»: falta ${roles}`).toBe(true);
    }
  });

  it("un sistema cuyo clon no esta NO pasa en verde", () => {
    // Replegarse a «no se puede medir, paso en verde» es exactamente lo que #675 y C-4
    // existen para impedir. La raiz fabricada no tiene ningun hermano.
    const raizFalsa = directorioTemporal("c11-sin-clones-");
    const resultado = enBash(`rl_db_de rentas ${JSON.stringify(raizFalsa)}`);

    expect(resultado.codigo).not.toBe(0);
    expect(resultado.error).toContain("git clone https://github.com/hneyra/rentas");
  });
});

describe("C-11 — el veredicto NO es el codigo de salida", () => {
  it("18 errores con codigo de salida 0 NO es una restauracion limpia", () => {
    // Es el caso medido: `psql -f` sobre un volcado PLANO, con el defecto de C-4 dentro,
    // deja 18 errores y sale con 0. Es el camino que una persona teclea.
    expect(enBash("rl_restauracion_limpia 18 0").codigo).not.toBe(0);
  });

  it("16 errores con codigo de salida 1 tampoco", () => {
    // El mismo volcado por `pg_restore -Fc`. Las dos herramientas no contestan lo mismo.
    expect(enBash("rl_restauracion_limpia 16 1").codigo).not.toBe(0);
  });

  it("y un codigo distinto de cero SIN errores contados tampoco pasa", () => {
    // El error al reves: fiarse solo del recuento dejaria pasar una restauracion que se
    // cayo antes de escribir una sola linea de error.
    expect(enBash("rl_restauracion_limpia 0 1").codigo).not.toBe(0);
  });

  it("EL CONTRASTE: cero errores y codigo cero si lo es", () => {
    // Sin esto, una funcion que dijera que no a todo pasaria las tres de arriba.
    expect(enBash("rl_restauracion_limpia 0 0").codigo).toBe(0);
  });
});

describe("C-11 — las perdidas declaradas, y las tablas que derivan de ellas", () => {
  it("ninguno de los cuatro declara perdidas", () => {
    // Las declaraba el monolito, y eran trece: C-4 midio dos —el indice de trigramas y su
    // COMMENT— y C-11 encontro once mas, porque `V66` (#565) le dio a `via` una columna
    // generada y la tabla entera deja de crearse. Se fue con `E`; los cuatro del corte lo
    // arreglaron cada uno con una migracion nueva, que es la salida que el monolito no tenia.
    for (const sistema of SISTEMAS) {
      expect(
        lineas(enBash(`rl_perdidas_conocidas ${JSON.stringify(sistema.nombre)}`).salida),
        `«${sistema.nombre}» declara perdidas: o las arreglo, o hay que decir por que no`,
      ).toEqual([]);
    }
  });

  it("las tablas afectadas se DERIVAN de la lista, no se escriben aparte", () => {
    // Con la lista vacia, lo derivado tambien lo es. Lo que hace util esta prueba es el par
    // de abajo: se le da una lista fabricada y se comprueba que lo derivado cambia con ella.
    expect(lineas(enBash("rl_tablas_afectadas caja").salida)).toEqual([]);
  });

  it("y darle una lista cambia lo derivado, que es lo que prueba que deriva", () => {
    const conDos = enBash(
      'rl_perdidas_conocidas() { echo "TABLA via"; echo "INDICE i EN arancel"; }\n' +
        "rl_tablas_afectadas rentas",
    );

    expect(lineas(conDos.salida)).toEqual(["arancel", "via"]);
  });
});

describe("C-11 — el simulacro no tiene una segunda lista de sistemas", () => {
  it("los cuatro que recorre por omision son los de SISTEMAS", () => {
    // Se EJECUTA `rl_sistemas` en vez de leer el texto del guion: lo que importa es lo que
    // el simulacro recorre, no lo que parece que recorre.
    expect(lineas(enBash("rl_sistemas").salida).sort()).toEqual(
      SISTEMAS.map((sistema) => sistema.nombre).sort(),
    );
  });

  it("y cada uno tiene su archivo de datos de ensayo", () => {
    // Un sistema sin archivo dejaria al simulacro fallando al sembrar, o —peor— sembrando
    // el del vecino. La lista no se escribe: se comprueba contra SISTEMAS.
    for (const sistema of SISTEMAS) {
      expect(
        existsSync(join(RECURSOS, `datos-de-ensayo/${sistema.nombre}.sql`)),
        `falta el archivo de datos de ensayo de «${sistema.nombre}»`,
      ).toBe(true);
    }
    expect(existsSync(join(RECURSOS, "datos-de-ensayo/comun.sql"))).toBe(true);
  });

  it("el censo cubre las clases de objeto que el criterio nombra", () => {
    // Tablas, indices, restricciones, funciones y politicas de RLS son las cinco que C-11
    // pide contar. Se leen del propio SQL: quitar una del censo la dejaria sin comparar y
    // el simulacro seguiria diciendo «no se pierde nada».
    const censo = readFileSync(join(RECURSOS, "censo-del-catalogo.sql"), "utf8");

    for (const clase of [
      "'TABLA '",
      "'INDICE '",
      "'RESTRICCION '",
      "'FUNCION '",
      "'POLITICA_RLS '",
      "'SECUENCIA '",
      "'DISPARADOR '",
      "'DOMINIO '",
      "'EXTENSION '",
    ]) {
      expect(censo, `el censo no cuenta ${clase}`).toContain(clase);
    }
  });

  it("y NO usa el comparador por su cuenta: reutiliza Retrato.java y canonizar.py", () => {
    // C-3 §7 hueco 2 dejo dicho que una tercera copia del arnes de baselines es
    // exactamente el problema. El simulacro llama al que ya existe en el clon de `rentas`.
    const guion = readFileSync(GUION, "utf8");

    expect(guion).toContain("docs/40-datos/baselines/verificar");
    expect(guion).toContain("Retrato");
    expect(guion).toContain("canonizar.py");
  });
});
