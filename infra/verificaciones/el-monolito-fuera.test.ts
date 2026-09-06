import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { inventarioDeSecretos } from "../componentes/secretos";
import {
  BASE_DEL_REGISTRO_DE_RESPALDO,
  BASE_DE_MANTENIMIENTO,
  SISTEMAS_DEL_PRODUCTO,
} from "../componentes/convenciones";
import { raizDeInfra, raizDelRepositorio } from "../componentes/fuentes";
import { ENVIRONMENTS, type Environment } from "../config";
import { manifiestosDelAmbiente } from "../herramientas/emitir-manifiestos";
import { clonDe, sistemaLlamado, SISTEMAS } from "./deriva-de-migraciones";
import { invariantesDe } from "./stacks";

/**
 * `E` — el monolito sale del sistema, y lo que quedaba apuntando a el.
 *
 * Este archivo mide **lo que la retirada tiene que dejar cierto**, no lo que quito: los
 * objetos que ya no se componen los mide `perfil-del-ambiente.test.ts`, y las cifras del
 * nodo, `capacidad.test.ts`. Aqui esta lo que nadie miraba y quedaba colgando de la base
 * `sgtm` — que existe en los dos ambientes y **no tiene ni una tabla del producto**.
 *
 * Medido contra `stg` el 2026-09-06: `to_regclass('public.respaldo')` da vacio en `sgtm` y
 * la tabla en las cuatro bases de los sistemas; y `pg_tables` de `sgtm` devuelve UNA fila,
 * `spatial_ref_sys`, que la trae PostGIS.
 */
describe("E · ninguna clave del monolito sigue declarada", () => {
  const stackDe = (ambiente: Environment) =>
    readFileSync(join(raizDeInfra(), `Pulumi.${ambiente}.yaml`), "utf8");

  /**
   * Las tres claves que gobernaban el monolito, y que se van con el.
   *
   * Se leen las **lineas declaradas** y no el archivo entero: los comentarios de los dos
   * stacks explican por que se fueron, y esa explicacion es lo que hace legible el cambio.
   * Lo que no puede quedar es una clave viva que nadie lee — que es exactamente lo que
   * `desplegarElMonolito` seria hoy si se hubiera dejado en `false`: una capacidad con un
   * solo valor posible, una rama que nadie ejercita y un `false` que se lee como una
   * decision cuando ya no hay nada que decidir.
   */
  it.each(ENVIRONMENTS)("«%s» no declara ninguna", (ambiente) => {
    const declaradas = stackDe(ambiente)
      .split("\n")
      .map((linea) => linea.trim())
      .filter((linea) => linea.startsWith("kamayuk:"))
      .map((linea) => linea.slice("kamayuk:".length).split(":")[0]);

    expect(declaradas.length, "el stack no declara ninguna clave").toBeGreaterThan(10);
    for (const muerta of ["desplegarElMonolito", "applicationBootstrapVersion", "webReplicas"]) {
      expect(
        declaradas.filter((clave) => clave === muerta),
        `«${ambiente}» sigue declarando \`${muerta}\`, que desde \`E\` no la lee nadie`,
      ).toEqual([]);
    }
  });

  /**
   * Y **los dos declaran la version de los cuatro sistemas**, que es lo que la sustituye.
   *
   * Es la otra direccion, y sin ella la de arriba se satisface borrando las cuatro tambien:
   * un ambiente sin ninguna version declarada no despliega nada y pasaria en verde.
   */
  it.each(ENVIRONMENTS)("«%s» declara la version de los cuatro sistemas", (ambiente) => {
    const versiones = invariantesDe(ambiente).sistemas.versiones;
    expect(Object.keys(versiones).sort()).toEqual([...SISTEMAS_DEL_PRODUCTO].sort());
    for (const [sistema, sha] of Object.entries(versiones)) {
      expect(sha, `«${ambiente}» declara para «${sistema}» algo que no es un sha`).toMatch(
        /^[0-9a-f]{40}$/,
      );
    }
  });

  /**
   * Y ninguna imagen del monolito llega al nodo.
   *
   * `sgtm-aplicacion`, `sgtm-interfaz` y `sgtm-migrador` son privadas en `ghcr.io/hneyra` y
   * las publicaba el flujo del repositorio historico, que este no tiene. Una referencia
   * superviviente no fallaria al componer: fallaria en el nodo, con `ImagePullBackOff`.
   */
  it.each(ENVIRONMENTS)("«%s» no pide ninguna imagen del monolito", (ambiente) => {
    const imagenes = new Set<string>();
    const recorrer = (valor: unknown): void => {
      if (Array.isArray(valor)) return valor.forEach(recorrer);
      if (valor === null || typeof valor !== "object") return;
      for (const [clave, dentro] of Object.entries(valor as Record<string, unknown>)) {
        if (clave === "image" && typeof dentro === "string") imagenes.add(dentro);
        recorrer(dentro);
      }
    };
    recorrer(manifiestosDelAmbiente(invariantesDe(ambiente)) as unknown[]);

    expect(imagenes.size, "ningun contenedor declara imagen: la prueba no mide nada").toBeGreaterThan(
      5,
    );
    expect(
      [...imagenes].filter((i) => /\/sgtm(-[a-z]+)?:/.test(i)),
      "una imagen del monolito: nadie la publica desde este repositorio, asi que el nodo se " +
        "quedaria en ImagePullBackOff",
    ).toEqual([]);
  });
});

describe("E · la base del monolito no gobierna nada", () => {
  /**
   * La base de mantenimiento del motor **existe siempre**.
   *
   * `BASE_DEL_PADRON` valia `sgtm`, y la sonda de vivacidad del motor la usaba en cada
   * latido. Apuntarla a una base que no exista en un cluster YA creado deja al motor
   * declarandose enfermo y reiniciandose para siempre: el `entrypoint` no crea bases sobre
   * un volumen que no esta vacio. `postgres` es la unica que PostgreSQL garantiza.
   */
  it("es `postgres`, la unica que el motor tiene siempre", () => {
    expect(BASE_DE_MANTENIMIENTO).toBe("postgres");
    expect(
      SISTEMAS_DEL_PRODUCTO as readonly string[],
      "la base de mantenimiento no puede ser la de un sistema: ataria la sonda del motor a " +
        "que ese sistema exista",
    ).not.toContain(BASE_DE_MANTENIMIENTO);
  });

  /**
   * **El registro del respaldo escribe donde `respaldo` existe.**
   *
   * Es la guarda que `BASE_DEL_REGISTRO_DE_RESPALDO` promete en su javadoc, y no es teorica:
   * hasta `E` el `CronJob` apuntaba a la base del monolito, donde esa tabla **no existe**, y
   * su primer paso es registrar el inicio con `exit 1` si no puede — o sea que el respaldo
   * diario de `stg` habria fallado entero en su primera corrida, con un mensaje —«no se pudo
   * registrar el inicio»— que no se parece a su causa.
   *
   * Se lee el baseline del clon, que es el esquema que de verdad se aplica en esa base. El
   * dia que ese esquema deje de declarar la tabla, esto se pone rojo aqui y no a las 06:00.
   */
  it("el registro del respaldo va a una base cuyo esquema declara `respaldo`", () => {
    expect(SISTEMAS_DEL_PRODUCTO as readonly string[]).toContain(BASE_DEL_REGISTRO_DE_RESPALDO);

    const sistema = sistemaLlamado(BASE_DEL_REGISTRO_DE_RESPALDO);
    const baseline = readFileSync(
      join(
        clonDe(sistema),
        "backend",
        `kamayuk-${BASE_DEL_REGISTRO_DE_RESPALDO}-esquema`,
        "src/main/resources/db/migration/V1__baseline.sql",
      ),
      "utf8",
    );
    expect(
      baseline,
      `el esquema de «${BASE_DEL_REGISTRO_DE_RESPALDO}» ya no declara la tabla \`respaldo\`, y ` +
        "el CronJob escribe ahi: su primer paso es registrar el inicio, y sin tabla sale con " +
        "exit 1 — el respaldo no se toma",
    ).toContain("CREATE TABLE respaldo");
  });

  /**
   * Y **todo rol de PostgreSQL del inventario declara contra que base se conecta.**
   *
   * `asignar-claves.sh` se replegaba a `sgtm` cuando faltaba, y esa base existe: la
   * comprobacion «¿sirve esta credencial?» pasaba en verde sin medir nada. Peor en
   * `rol_carga_parametros`, cuya unica base es `normativa` (C-7 §6): decia lo contrario de
   * la verdad.
   */
  it("todo rol del inventario declara su base, y ninguna es la del monolito", () => {
    const conRol = inventarioDeSecretos("stg").filter((e) => e.rolDePostgres !== undefined);
    expect(conRol.length, "el inventario no trae ningun rol de PostgreSQL").toBeGreaterThan(3);
    for (const entrada of conRol) {
      expect(
        entrada.baseDeDatos,
        `«${entrada.rol}» declara el rol «${entrada.rolDePostgres}» y no dice contra que base ` +
          "se conecta: sin ese dato, comprobar la credencial no dice nada",
      ).toBeDefined();
      expect(entrada.baseDeDatos, `«${entrada.rol}» apunta a la base del monolito`).not.toBe(
        "sgtm",
      );
    }
  });

  /** Y el guion no tiene ningun repliegue escrito. */
  it("`asignar-claves.sh` no se repliega a ninguna base", () => {
    // Sin comentarios: el guion explica el defecto escribiendo la forma mala —`e.baseDeDatos
    // || "sgtm"`—, y esa explicacion es lo que impide reintroducirla. Lo que se mide es el
    // codigo, que es lo que se ejecuta.
    const guion = readFileSync(join(raizDeInfra(), "secretos/asignar-claves.sh"), "utf8")
      .split("\n")
      .filter((linea) => !/^\s*(#|\/\/)/.test(linea))
      .join("\n");
    expect(
      guion,
      "vuelve a haber un repliegue `e.baseDeDatos || …`: una entrada sin base pasaria en " +
        "verde habiendo abierto una sesion que no dice nada",
    ).not.toMatch(/e\.baseDeDatos\s*\|\|/);
  });
});

describe("E · `verificar-el-ambiente.sh` mide los cuatro sistemas", () => {
  const guion = readFileSync(
    join(raizDeInfra(), "verificaciones/ambiente/verificar-el-ambiente.sh"),
    "utf8",
  );

  /**
   * La lista que recorre, EJECUTADA.
   *
   * Es la mitad que C-19 aprendio con su M10: una prueba que solo mirara que el guion nombra
   * a los cuatro pasaria con la lista rota. Aqui se ejecuta la asignacion tal como esta
   * escrita y se compara con {@link SISTEMAS}, que es de donde salen las cuatro bases.
   */
  it("recorre exactamente los cuatro de SISTEMAS", () => {
    const asignacion = /^SISTEMAS="([^"]+)"$/m.exec(guion);
    expect(asignacion, "el guion ya no declara `SISTEMAS=` de forma reconocible").not.toBeNull();

    const leidos = execFileSync("sh", ["-c", `SISTEMAS="${asignacion?.[1] ?? ""}"; echo $SISTEMAS`], {
      encoding: "utf8",
    })
      .trim()
      .split(/\s+/)
      .sort();

    expect(leidos).toEqual(SISTEMAS.map((s) => s.nombre).sort());
  });

  /**
   * Y lee la version de cada uno del stack, con la clave que el stack de verdad declara.
   *
   * Se ejecuta la misma tuberia `grep`/`sed`/`tr` del guion contra el archivo real y se
   * compara con lo que `config.ts` lee. Una prueba que solo mirara que el guion nombra la
   * clave pasaria con la tuberia rota — el defecto que C-19 midio con su M10.
   */
  it.each(ENVIRONMENTS)("«%s»: lee la misma version que config.ts, por sistema", (ambiente) => {
    const declaradas = invariantesDe(ambiente).sistemas.versiones;
    for (const sistema of SISTEMAS_DEL_PRODUCTO) {
      const clave = `kamayuk:versionDe${sistema[0]?.toUpperCase()}${sistema.slice(1)}`;
      const leido = execFileSync(
        "sh",
        [
          "-c",
          `grep -E "^\\\\s+${clave}:" "$0" | sed -E 's/.*:\\s*//' | tr -d '"'"'"' '`,
          join(raizDeInfra(), `Pulumi.${ambiente}.yaml`),
        ],
        { encoding: "utf8" },
      ).trim();

      expect(leido, `el guion lee «${leido}» de Pulumi.${ambiente}.yaml para «${sistema}»`).toBe(
        declaradas[sistema],
      );
    }
  });

  /** Y no queda ninguna consulta contra la base del monolito. */
  it("no consulta la base del monolito", () => {
    const sentencias = guion
      .split("\n")
      .filter((linea) => !linea.trim().startsWith("#"))
      .join("\n");
    expect(
      sentencias,
      "vuelve a haber un `-d sgtm` o un `--dbname=sgtm`: esa base existe y no tiene ni una " +
        "tabla del producto, asi que la comprobacion pasaria sin medir nada",
    ).not.toMatch(/(-d|--dbname=)\s*sgtm\b/);
  });
});

describe("E · el repositorio ya no lleva el esquema del monolito", () => {
  /**
   * `backend/` se retira entero, y con el `frontend/nginx.conf` y `despliegue/compose.yaml`.
   *
   * Traia las 68 migraciones del monolito, su `crear-roles.sql` —que era el unico `.sql` que
   * caia en `docker-entrypoint-initdb.d`— y un solo `.java`. Lo que ese `crear-roles.sql`
   * hacia falta lo hace `06-roles-de-los-sistemas.sh`, que aplica el de CADA sistema contra
   * su base y crea los mismos roles del cluster con `IF NOT EXISTS`.
   *
   * Se comprueba **leyendo el arbol de git** y no el disco: un archivo sin versionar no
   * cuenta, y lo que importa es lo que el repositorio declara.
   */
  it("ni `backend/`, ni `frontend/`, ni el compose del monolito", () => {
    const versionados = execFileSync("git", ["-C", raizDelRepositorio(), "ls-files"], {
      encoding: "utf8",
    }).split("\n");

    expect(versionados.length, "el listado de git vino vacio").toBeGreaterThan(50);
    for (const muerta of ["backend/", "frontend/", "despliegue/compose.yaml"]) {
      expect(
        versionados.filter((archivo) => archivo.startsWith(muerta)),
        `«${muerta}» sigue versionado: era del monolito, y su copia entera vive en el clon ` +
          "de `sgtm`, que es su sitio",
      ).toEqual([]);
    }
  });
});
