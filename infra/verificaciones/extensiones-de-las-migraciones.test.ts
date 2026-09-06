import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { raizDelRepositorio } from "../componentes/fuentes";
import { SISTEMAS } from "./deriva-de-migraciones";
import {
  DECLARADAS_DE_MAS,
  REGLAS,
  clasesDeOperadoresSinRegla,
  declaradasSinUsar,
  descripcionDelSobrante,
  descripcionDelUso,
  type Esquema,
  esquemas,
  exclusionesConIgualdad,
  extensionesDeclaradas,
  migraciones,
  rolesDe,
  sinComentarios,
  usosDelEsquema,
  usosEnLasMigraciones,
  usosSinDeclarar,
} from "./extensiones-de-las-migraciones";

/**
 * La extension que una migracion necesita tiene que estar declarada, **en los cinco
 * esquemas** (#742, extendido en C-2).
 *
 * Este acoplamiento ya rompio cuatro veces, y las cuatro con un mensaje que no se parece
 * a su causa: `V61` del monolito con `geography` el 2026-08-30 —el incidente que hizo
 * nacer `despliegue/crear-extensiones.sh`—, `V72` con `btree_gist` (#675), el baseline de
 * `rentas` con `geography` durante el corte y el de `caja` con `unaccent`. Los dos
 * ultimos se descubrieron **por casualidad**, aplicando el baseline a mano, porque la
 * guarda de #742 tenia la ruta del monolito escrita a mano.
 *
 * Corre en `yarn verificar`, sin cluster y sin motor, que es el unico sitio donde esto
 * se puede atrapar barato: **CI nunca lo ve**, porque su volumen siempre nace vacio y
 * ahi `crear-roles.sql` corre entero.
 */
describe("#742/C-2 — la extension que una migracion usa esta declarada, en los cinco", () => {
  it("EL CONTRASTE: hoy no falta ninguna en ninguno, y no hay ningun falso positivo", () => {
    // Va primero a proposito. Una comprobacion que grita por una migracion que no
    // depende de nada deja de leerse — la leccion que #437 midio al descartar
    // ensanchar el patron de la regla 5 por sus ocho falsos positivos.
    expect(usosSinDeclarar().map(descripcionDelUso)).toEqual([]);
  });

  it("las dependencias de hoy se detectan, con su repositorio y su migracion", () => {
    // El censo entero, medido. Cuando esto se ponga rojo lo que hay que hacer NO es
    // actualizar la lista: es leer que esquema empezo —o dejo— de depender de que.
    expect(usosEnLasMigraciones().map((u) => `${u.sistema}|${u.migracion}|${u.extension}`)).toEqual([
      "infrastructure (copia del esquema del monolito)|V11__busqueda_por_aproximacion.sql|unaccent",
      "infrastructure (copia del esquema del monolito)|V11__busqueda_por_aproximacion.sql|pg_trgm",
      "infrastructure (copia del esquema del monolito)|V61__geometria_del_predio.sql|postgis",
      "infrastructure (copia del esquema del monolito)|V72__vigencias_que_no_se_pisan.sql|btree_gist",
      "sgtm|V11__busqueda_por_aproximacion.sql|unaccent",
      "sgtm|V11__busqueda_por_aproximacion.sql|pg_trgm",
      "sgtm|V61__geometria_del_predio.sql|postgis",
      "sgtm|V72__vigencias_que_no_se_pisan.sql|btree_gist",
      "rentas|V1__baseline.sql|unaccent",
      "rentas|V1__baseline.sql|pg_trgm",
      // C-4: V11 vuelve a escribir `nombre_normalizado`, con `unaccent` cualificado.
      // Sigue necesitando la extension, y `rentas` la declara.
      "rentas|V11__nombre_normalizado_sin_search_path.sql|unaccent",
      "catastro|V1__baseline.sql|unaccent",
      "catastro|V1__baseline.sql|postgis",
      "catastro|V1__baseline.sql|btree_gist",
      // C-4: lo mismo en `catastro`, con su V4.
      "catastro|V4__nombre_normalizado_sin_search_path.sql|unaccent",
      // `V6` (T-0/ADR-0034): `frente_predio.geometria` es `geography(LineString,4326)` y sus
      // cuatro columnas de marco se derivan con `st_xmin`/`st_ymin`/`st_xmax`/`st_ymax`.
      // `catastro` ya declara `postgis` en su `crear-roles.sql`, asi que la dependencia esta
      // cubierta: lo que faltaba era el censo.
      "catastro|V6__identidad_sncp_y_frente.sql|postgis",
      // `normativa` no depende de ninguna, y `caja` tampoco: las dos ausencias son el
      // dato, no un archivo que no se pudo leer. Lo garantizan las dos pruebas de abajo.
    ]);
  });

  it("y el rojo nombra el repositorio, la extension y por que hace falta", () => {
    const uso = usosEnLasMigraciones().find(
      (u) => u.sistema === "catastro" && u.extension === "btree_gist",
    );

    expect(uso).toBeDefined();
    const dicho = descripcionDelUso(uso!);
    // Sin el repositorio, el mensaje no dice en cual de los cinco `crear-roles.sql` hay
    // que tocar — que es el defecto entero que C-2 cierra. Y sin el «porque», diria
    // «falta btree_gist» a alguien que no tiene por que saber que `EXCLUDE USING gist`
    // con `=` la necesita: el conocimiento que faltaba las cuatro veces que esto rompio.
    expect(dicho).toContain("«catastro»");
    expect(dicho).toContain("«btree_gist»");
    expect(dicho).toMatch(/EXCLUDE USING gist/i);
  });
});

describe("C-2 — la lista de esquemas no se escribe aqui, y no puede quedarse rancia", () => {
  it("son los cinco sistemas de SISTEMAS, mas la copia local del monolito", () => {
    // Derivarla de SISTEMAS es lo que impide el defecto de #742: alli la ruta estaba
    // escrita a mano, y al aparecer cuatro repositorios nuevos la guarda siguio mirando
    // uno solo **sin ponerse roja**. Si manana entra un sexto sistema, entra aqui solo.
    expect(esquemas().map((e) => e.nombre)).toEqual([
      "infrastructure (copia del esquema del monolito)",
      ...SISTEMAS.map((s) => s.nombre),
    ]);
    expect(SISTEMAS.map((s) => s.nombre)).toEqual([
      "sgtm",
      "rentas",
      "catastro",
      "normativa",
      "caja",
    ]);
  });

  it("y los dos archivos de cada uno existen de verdad", () => {
    // La ruta de roles se DERIVA de la de migraciones. Que la convencion «hermanos bajo
    // db/» se cumpla no se supone: si un repositorio la rompe, esto lo dice nombrandolo,
    // en vez de leer un archivo vacio y declarar cero extensiones —que se leeria igual
    // que «este esquema no necesita ninguna»—.
    for (const esquema of esquemas()) {
      expect(existsSync(join(esquema.raiz, esquema.migraciones)), `migraciones de ${esquema.nombre}`)
        .toBe(true);
      expect(existsSync(join(esquema.raiz, esquema.roles)), `crear-roles.sql de ${esquema.nombre}`)
        .toBe(true);
    }
  });

  it("cada esquema tiene migraciones de verdad, y se leen", () => {
    // Si un directorio se moviera, `usosSinDeclarar()` volveria vacio para ese esquema y
    // todo lo demas pasaria en verde sin haber abierto un archivo.
    const cuantas = Object.fromEntries(esquemas().map((e) => [e.nombre, migraciones(e).length]));

    expect(cuantas).toEqual({
      "infrastructure (copia del esquema del monolito)": 68,
      sgtm: 68,
      // catastro 6 desde T-0: `V6` trae el CUC del SNCP y `frente_predio` (ADR-0034/ADR-0036).
      // rentas 13 desde C-12, que retiro `contribuyente_nombre_trgm_ix` —inalcanzable bajo RLS—.
      // Cuando esto se ponga rojo lo que hay que hacer NO es actualizar el numero: es mirar que
      // migracion entro y comprobar que declaro las extensiones que usa. Se comprobo para `V13`:
      // no usa ninguna, y `pg_trgm` sigue declarada en `rentas` porque `similarity()` se llama en
      // tiempo de consulta —lo que esta guarda NO lee, porque solo mira migraciones; hoy la
      // mantiene verde el `gin_trgm_ops` que `V1` sigue nombrando, o sea por un motivo que dejo
      // de ser cierto—.
      rentas: 13,
      catastro: 6,
      normativa: 1,
      caja: 2,
    });
  });

  it("la ruta de roles se deriva, y una que no acabe en migration/ falla en voz alta", () => {
    expect(rolesDe("backend/kamayuk-caja-esquema/src/main/resources/db/migration/")).toBe(
      "backend/kamayuk-caja-esquema/src/main/resources/db/roles/crear-roles.sql",
    );
    expect(() => rolesDe("backend/otro/sitio/")).toThrow(/no acaba en/);
  });

  it("la lista de declaradas sale de cada crear-roles.sql, no de aqui", () => {
    // Escribirlas en el codigo seria un segundo sitio donde olvidarse de una, que es
    // justo el defecto que `crear-extensiones.sh` evito al leer el archivo.
    const declaradas = Object.fromEntries(
      esquemas().map((e) => [e.nombre, extensionesDeclaradas(e)]),
    );

    expect(declaradas).toEqual({
      "infrastructure (copia del esquema del monolito)": [
        "btree_gist",
        "pg_trgm",
        "postgis",
        "unaccent",
      ],
      sgtm: ["btree_gist", "pg_trgm", "postgis", "unaccent"],
      rentas: ["pg_trgm", "unaccent"],
      // TRES desde C-13: `pg_trgm` se fue porque la busqueda por aproximacion de nombre
      // es del padron de contribuyentes, que es de `rentas`.
      catastro: ["btree_gist", "postgis", "unaccent"],
      // CERO desde C-13: su baseline no usa ninguna de las cuatro que declaraba, y
      // `postgis` arrastraba ademas la exencion de `spatial_ref_sys` de su prueba de
      // aislamiento. Es la misma poda que P5E le hizo a `rentas`.
      normativa: [],
      // CERO, y es el dato: P5D las retiro a proposito, «porque la caja tiene que poder
      // correr en el motor mas simple que exista». Que sea cero y no un archivo
      // ilegible lo garantiza la prueba de que los dos archivos existen.
      caja: [],
    });
  });
});

describe("C-13 — lo declarado y no usado es ROJO, y hoy no hay ninguna", () => {
  it("ninguno de los seis esquemas declara una extension que no use", () => {
    // C-2 dejo esto como CENSO porque un rojo «naceria disparado en dos de los seis», y
    // una comprobacion que grita el primer dia se acaba silenciando (#437). C-13 retiro
    // las cinco —`pg_trgm` de `catastro` y las cuatro de `normativa`—, asi que el rojo
    // nace en verde y ya puede ser un rojo.
    const sobrantes = declaradasSinUsar().filter(
      (s) => !DECLARADAS_DE_MAS.some((c) => c.sistema === s.sistema && c.extension === s.extension),
    );
    expect(sobrantes.map(descripcionDelSobrante)).toEqual([]);
  });

  it("y la lista de excepciones esta VACIA, que es lo que hace que no haya donde esconderse", () => {
    // Se queda declarada a proposito: lo que permite es una excepcion temporal y
    // NOMBRADA, y con la lista vacia la unica forma de callar una declaracion de mas es
    // escribir aqui su motivo, y eso se ve en el diff (#429 con su lista de pendientes).
    expect(DECLARADAS_DE_MAS).toEqual([]);
  });

  it("EL CONTRASTE: la guarda muerde — una declarada de mas sale nombrada", () => {
    // Sin esto, «no hay ninguna» seria compatible con «esto no puede fallar». Se mide
    // sobre un esquema fabricado, no sobre uno real, para no escribir en ningun clon.
    const fabricado = esquemaFabricado(
      "V1__baseline.sql",
      "CREATE TABLE t (id bigint);",
      "CREATE EXTENSION IF NOT EXISTS postgis;",
    );
    expect(declaradasSinUsar([fabricado]).map(descripcionDelSobrante)).toEqual([
      "«fabricado» declara «postgis» y ninguna migracion suya la usa",
    ]);
  });

  it("y NO muerde cuando la migracion si la usa: es la otra mitad del contraste", () => {
    const fabricado = esquemaFabricado(
      "V1__baseline.sql",
      "ALTER TABLE predio ADD COLUMN geo geography(MultiPolygon, 4326);",
      "CREATE EXTENSION IF NOT EXISTS postgis;",
    );
    expect(declaradasSinUsar([fabricado])).toEqual([]);
    expect(usosSinDeclarar([fabricado])).toEqual([]);
  });

  it("cada excepcion que hubiera tendria que decir por que, y de un esquema medido", () => {
    // Vacia hoy; la guarda se queda para que una entrada nueva no pueda ser un nombre a
    // secas ni referirse a un esquema que nadie mide.
    for (const entrada of DECLARADAS_DE_MAS) {
      expect(entrada.porque.length, `«${entrada.sistema}/${entrada.extension}» no dice por que`)
        .toBeGreaterThan(60);
      expect(
        esquemas().map((e) => e.nombre),
        `«${entrada.sistema}» no es ninguno de los esquemas medidos`,
      ).toContain(entrada.sistema);
    }
  });

  it("`normativa` y `caja` no declaran NINGUNA, que es su decision y ahora se cumple", () => {
    // `caja` desde P5D, `normativa` desde C-13. Lo que cambia con C-10 es que ahora
    // decide de verdad: `05-crear-bases.sh` deriva de este archivo, asi que sus dos bases
    // nacen sin ninguna extension en vez de recibir las cuatro.
    for (const nombre of ["normativa", "caja"]) {
      const esquema = esquemas().find((e) => e.nombre === nombre);
      expect(esquema, `no se esta midiendo «${nombre}»`).toBeDefined();
      expect(extensionesDeclaradas(esquema!), `«${nombre}» declara alguna extension`).toEqual([]);
    }
  });

  it("y `catastro` conserva las tres que SI usa", () => {
    const catastro = esquemas().find((e) => e.nombre === "catastro")!;
    expect(extensionesDeclaradas(catastro)).toEqual(["btree_gist", "postgis", "unaccent"]);
  });
});

describe("#742 — lo que la prosa dice no cuenta como DDL", () => {
  it("un patron que solo aparece en un comentario no cubre la migracion", () => {
    // La cabecera de `V72` explica su `EXCLUDE USING gist` en prosa y la de `V11`
    // menciona `unaccent()` y `gin_trgm_ops`. Buscar en el archivo entero daria por
    // cubierta una migracion a la que le hubieran borrado el DDL: es el hueco que #426
    // destapo en `leerPatron` y que #558 volvio a encontrar.
    const soloProsa = "-- Aqui iria un EXCLUDE USING gist (a WITH =) y un unaccent(x)\nSELECT 1;";

    expect(sinComentarios(soloProsa)).not.toMatch(/EXCLUDE/i);
    expect(exclusionesConIgualdad(sinComentarios(soloProsa))).toBe(0);
    expect(REGLAS.filter((r) => r.patron.test(sinComentarios(soloProsa)))).toEqual([]);
  });

  it("y el DDL de verdad si cuenta, aunque lleve el mismo texto en su comentario", () => {
    const conDdl =
      "-- Aqui iria un EXCLUDE USING gist\n" +
      "ALTER TABLE t ADD CONSTRAINT c EXCLUDE USING gist (a WITH =, r WITH &&);";

    expect(exclusionesConIgualdad(sinComentarios(conDdl))).toBe(1);
  });

  it("y tampoco cuenta como DECLARADA la que solo se nombra en un comentario", () => {
    // No es hipotetico: el `crear-roles.sql` de `caja` nombra las cuatro extensiones
    // —para explicar por que NO declara ninguna— en cuarenta lineas de comentario. Sin
    // `sinComentarios`, ese archivo declararia cuatro y `caja` pasaria por cubierta.
    const caja = esquemas().find((e) => e.nombre === "caja");

    expect(caja).toBeDefined();
    expect(extensionesDeclaradas(caja!)).toEqual([]);
  });
});

describe("#742 — el cuerpo del EXCLUDE se lee con parentesis balanceados", () => {
  it("un WITH = detras de una funcion anidada NO se pierde", () => {
    // El de `V72` lleva dentro `daterange(vigencia_desde, COALESCE(vigencia_hasta,
    // 'infinity'::date), '[]')`. Un `\(([^)]*)\)` cortaria en el primer parentesis de
    // cierre y daria por buena justamente la migracion que rompio el despliegue.
    const ddl =
      "ALTER TABLE t ADD CONSTRAINT c EXCLUDE USING gist (\n" +
      "  daterange(desde, COALESCE(hasta, 'infinity'::date), '[]') WITH &&,\n" +
      "  municipalidad_id WITH =\n" +
      ") DEFERRABLE INITIALLY DEFERRED;";

    expect(exclusionesConIgualdad(ddl)).toBe(1);
  });

  it("un EXCLUDE que NO compara con = no pide btree_gist", () => {
    // Solapar dos rangos es `range_ops`, del nucleo. Exigir la extension ahi seria un
    // falso positivo, y un falso positivo es lo que hace que esto deje de leerse.
    const ddl = "ALTER TABLE t ADD CONSTRAINT c EXCLUDE USING gist (r WITH &&);";

    expect(exclusionesConIgualdad(ddl)).toBe(0);
  });

  it("dos exclusiones en la misma migracion se cuentan las dos", () => {
    expect(exclusionesConIgualdad(fuenteDeDosExclusiones())).toBe(2);
  });
});

describe("#742 — una clase de operadores que no se sabe atribuir se DICE", () => {
  it("hoy no hay ninguna sin regla en ninguno de los cinco", () => {
    expect(clasesDeOperadoresSinRegla()).toEqual([]);
  });

  it("text_pattern_ops es del nucleo y NO pide ninguna extension", () => {
    // Esto lo encontro medir, no razonar: la primera version de este modulo no tenia
    // lista de clases del nucleo, sobre la premisa de que «rara vez se deletrean», y
    // dio DIECISEIS falsos positivos de golpe. `text_pattern_ops` esta en dieciseis
    // sitios porque bajo RLS un `LIKE 'prefijo%'` no llega nunca al indice y toda
    // busqueda por prefijo de este producto se escribe con el.
    const conPrefijo = "CREATE INDEX i ON via (nombre text_pattern_ops);";

    expect(REGLAS.filter((r) => r.patron.test(conPrefijo))).toEqual([]);
    expect(exclusionesConIgualdad(conPrefijo)).toBe(0);
  });

  it("las clases de operadores se nombran en UN solo sitio", () => {
    // `gin_trgm_ops` estuvo un rato en `REGLAS` y en la lista de clases a la vez. Dos
    // sitios para el mismo hecho es el defecto que este modulo existe para cerrar, asi
    // que las reglas cubren funciones y tipos, y las clases van aparte.
    for (const regla of REGLAS) {
      expect(regla.patron.source, `«${regla.extension}» nombra una clase de operadores`).not.toMatch(
        /_ops/,
      );
    }
  });

  it("una migracion que pide la misma extension por dos vias la pide UNA vez", () => {
    // `V11` del monolito nombra `gin_trgm_ops` y ademas llama a `similarity()`.
    const sgtm = esquemas().find((e) => e.nombre === "sgtm");
    const deV11 = usosDelEsquema(sgtm!).filter(
      (u) => u.migracion.startsWith("V11__") && u.extension === "pg_trgm",
    );

    expect(deV11).toHaveLength(1);
  });
});

function fuenteDeDosExclusiones(): string {
  return (
    "ALTER TABLE a ADD CONSTRAINT c1 EXCLUDE USING gist (x WITH =, r WITH &&);\n" +
    "ALTER TABLE b ADD CONSTRAINT c2 EXCLUDE USING gist (y WITH =, s WITH &&);"
  );
}

/**
 * Un esquema de mentira en un directorio temporal: una migracion y un `crear-roles.sql`.
 *
 * Existe para que las mutaciones de esta guarda no tengan que escribir en ningun clon —el
 * archivo historico `sgtm` no se escribe ni para mutar y restaurar (C-2 §2.1)—, y para
 * poder fabricar la trampa que ningun archivo real tiene hoy: un `CREATE EXTENSION`
 * dentro de un comentario.
 */
function esquemaFabricado(migracion: string, ddl: string, roles: string): Esquema {
  const raiz = mkdtempSync(join(tmpdir(), "c10-esquema-"));
  TEMPORALES.push(raiz);
  mkdirSync(join(raiz, "db/migration"), { recursive: true });
  mkdirSync(join(raiz, "db/roles"), { recursive: true });
  writeFileSync(join(raiz, "db/migration", migracion), ddl);
  writeFileSync(join(raiz, "db/roles/crear-roles.sql"), roles);
  return {
    nombre: "fabricado",
    raiz,
    migraciones: "db/migration/",
    roles: "db/roles/crear-roles.sql",
  };
}

const TEMPORALES: string[] = [];
afterAll(() => {
  for (const ruta of TEMPORALES) rmSync(ruta, { recursive: true, force: true });
});

/** La misma funcion de shell que usan los dos guiones, EJECUTADA. */
function extensionesSegunElShell(archivo: string): string[] {
  const lib = join(
    raizDelRepositorio(),
    "despliegue/inicializacion-del-motor/lib-extensiones.sh",
  );
  const salida = execFileSync(
    "bash",
    ["-c", `. "$1"; extensiones_declaradas "$2"`, "--", lib, archivo],
    { encoding: "utf8" },
  );
  return salida.split("\n").filter((linea) => linea.trim().length > 0);
}

/**
 * C-10 — las extensiones se nombran en UN sitio por sistema, y los otros dos derivan.
 *
 * Hasta C-10 se nombraban en TRES (C-2 §6, huecos 2 y 3): el `crear-roles.sql` de cada
 * sistema, `05-crear-bases.sh` con las cuatro escritas a mano, y `crear-extensiones.sh`
 * con la ruta del monolito escrita a mano. El segundo tenia una consecuencia medida —**la
 * decision de `caja` no se cumplia**, su base recibia PostGIS igual—, y el tercero dejaba
 * fuera a los cuatro sistemas del corte.
 *
 * Estas pruebas EJECUTAN los guiones en vez de leerlos. Leerlos diria que el texto
 * contiene lo que se espera; ejecutarlos dice que hacen lo que dicen — que es la
 * diferencia que #731 dejo escrita al probar `puerto.sh`.
 */
describe("C-10 — el shell y esta guarda leen lo mismo, y se comprueba ejecutandolo", () => {
  it("las dos lecturas coinciden en los seis esquemas", () => {
    // Dos implementaciones del mismo patron —una en TypeScript, una en shell— es
    // exactamente el defecto que este modulo existe para cerrar, un escalon mas abajo.
    // No se supone que coincidan: se ejecuta la de shell y se comparan.
    for (const esquema of esquemas()) {
      expect(
        extensionesSegunElShell(join(esquema.raiz, esquema.roles)),
        `«${esquema.nombre}»: el shell y la guarda no leen lo mismo`,
      ).toEqual(extensionesDeclaradas(esquema));
    }
  });

  it("y el shell tampoco cuenta la que solo se nombra en un comentario", () => {
    // Ninguno de los seis archivos reales tiene hoy esta trampa, asi que quitarle el
    // `sed` a la funcion no cambiaria nada medido contra ellos. Por eso se fabrica.
    const fabricado = esquemaFabricado(
      "V1__baseline.sql",
      "SELECT 1;",
      "-- No hacemos CREATE EXTENSION postgis aqui, es de catastro.\n" +
        "CREATE EXTENSION IF NOT EXISTS unaccent;\n",
    );

    expect(extensionesSegunElShell(join(fabricado.raiz, fabricado.roles))).toEqual(["unaccent"]);
    expect(extensionesDeclaradas(fabricado)).toEqual(["unaccent"]);
  });

  it("cero extensiones sale en verde y como lista vacia, no como fallo", () => {
    // `caja` no declara ninguna a proposito. `grep` sale con codigo 1 cuando no encuentra
    // nada, y con `set -euo pipefail` eso mataria a `05-crear-bases.sh` justo en el unico
    // sistema cuya decision es no declarar ninguna.
    const caja = esquemas().find((e) => e.nombre === "caja")!;

    expect(extensionesSegunElShell(join(caja.raiz, caja.roles))).toEqual([]);
  });
});

describe("C-10 — `crear-extensiones.sh` deriva, y ya no habla de un solo sistema", () => {
  const guion = join(raizDelRepositorio(), "despliegue/crear-extensiones.sh");

  function listar(sistema: string): string[] {
    return execFileSync("bash", [guion, "--listar", "--sistema", sistema], { encoding: "utf8" })
      .split("\n")
      .filter((l) => l.trim().length > 0);
  }

  it("lo que dice que crearia es lo que ese sistema declara, en los cinco", () => {
    for (const esquema of esquemas()) {
      if (esquema.nombre.startsWith("infrastructure")) continue; // es la copia local de sgtm
      const declaradas = extensionesDeclaradas(esquema);
      const esperado =
        declaradas.length === 0
          ? [`${esquema.nombre} ${esquema.nombre} (ninguna)`]
          : declaradas.map((e) => `${esquema.nombre} ${esquema.nombre} ${e}`);

      expect(listar(esquema.nombre), `«${esquema.nombre}»`).toEqual(esperado);
    }
  });

  it("la base es el nombre del sistema, no `sgtm` para todos", () => {
    // Antes de C-10 el guion tenia `--dbname=sgtm` escrito en las dos invocaciones de
    // psql: apuntarlo a `catastro` habria creado sus extensiones en la base del monolito.
    for (const sistema of ["rentas", "catastro", "normativa", "caja"]) {
      for (const linea of listar(sistema)) {
        expect(linea.split(" ")[1], `«${sistema}» apunta a otra base`).toBe(sistema);
      }
    }
  });

  it("un sistema cuyo clon no esta NO pasa en verde: dice cual falta y como traerlo", () => {
    // Replegarse a «no se puede saber, no hago nada» es el estado exacto que #675
    // encontro y que estuvo ocho meses asi.
    expect(() => listar("inventado")).toThrow(/No esta el clon de «inventado»/);
  });
});

describe("C-10 — `05-crear-bases.sh` deriva las bases y sus extensiones", () => {
  const guion = join(
    raizDelRepositorio(),
    "despliegue/inicializacion-del-motor/05-crear-bases.sh",
  );

  /** El `/etc/kamayuk` que el compose monta, reproducido en un temporal. */
  function banco(sistemas: string[]): string {
    const raiz = mkdtempSync(join(tmpdir(), "c10-banco-"));
    TEMPORALES.push(raiz);
    mkdirSync(join(raiz, "roles"), { recursive: true });
    symlinkSync(
      join(raizDelRepositorio(), "despliegue/inicializacion-del-motor/lib-extensiones.sh"),
      join(raiz, "lib-extensiones.sh"),
    );
    for (const nombre of sistemas) {
      const esquema = esquemas().find((e) => e.nombre === nombre)!;
      symlinkSync(join(esquema.raiz, esquema.roles), join(raiz, "roles", `${nombre}.sql`));
    }
    return raiz;
  }

  /** Lo ejecuta con un `psql` de mentira, que anota en vez de conectarse. */
  function ejecutar(dirBanco: string): { salida: string; sql: string } {
    const falso = mkdtempSync(join(tmpdir(), "c10-psql-"));
    TEMPORALES.push(falso);
    const registro = join(falso, "registro.txt");
    writeFileSync(
      join(falso, "psql"),
      "#!/bin/bash\n" +
        `printf '%s\\n' "ARGS $*" >> ${registro}\n` +
        `cat >> ${registro}\n`,
      { mode: 0o755 },
    );
    const salida = execFileSync("bash", [guion], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${falso}:${process.env["PATH"] ?? ""}`,
        POSTGRES_USER: "postgres",
        KAMAYUK_DIR_KAMAYUK: dirBanco,
      },
    });
    return { salida, sql: execFileSync("cat", [registro], { encoding: "utf8" }) };
  }

  it("crea una base por archivo montado, y solo las extensiones que ese archivo declara", () => {
    const { salida, sql } = ejecutar(banco(["rentas", "catastro", "normativa", "caja"]));

    for (const base of ["rentas", "catastro", "normativa", "caja"]) {
      expect(salida, `no crea «${base}»`).toContain(`creando la base «${base}»`);
      expect(sql, `no manda el CREATE DATABASE de «${base}»`).toContain(`CREATE DATABASE ${base}`);
    }
    // La forma de la mutacion: lo que el guion crea es exactamente lo declarado.
    for (const nombre of ["rentas", "catastro", "normativa", "caja"]) {
      const esquema = esquemas().find((e) => e.nombre === nombre)!;
      for (const extension of extensionesDeclaradas(esquema)) {
        expect(salida, `«${nombre}» deberia declarar «${extension}»`).toContain(
          `«${nombre}» declara «${extension}»`,
        );
      }
    }
  });

  it("la base de `caja` nace SIN NINGUNA extension, que es la decision de P5D", () => {
    // Hasta C-10 este guion le creaba las cuatro con la lista escrita a mano, asi que
    // «la caja corre en el motor mas simple que exista» no lo ejercitaba nadie.
    const { salida } = ejecutar(banco(["caja"]));

    expect(salida).toContain("«caja» no declara ninguna extension");
    expect(salida).not.toMatch(/«caja» declara/);
  });

  it("y la de `normativa` tampoco, desde C-13", () => {
    const { salida } = ejecutar(banco(["normativa"]));

    expect(salida).toContain("«normativa» no declara ninguna extension");
  });

  it("EL CONTRASTE: `catastro` SI recibe PostGIS, porque la usa", () => {
    // Sin esto, la guarda de arriba estaria contenta con un guion que no crea nada.
    const { salida } = ejecutar(banco(["catastro"]));

    expect(salida).toContain("«catastro» declara «postgis»");
    expect(salida).not.toMatch(/«catastro» declara «pg_trgm»/); // retirada en C-13
  });

  it("un montaje que falta NO deja la base sin su extension: se para y lo nombra", () => {
    // Docker crea un DIRECTORIO vacio cuando el origen de un bind mount no existe. Una
    // base sin su PostGIS no falla al crearse: falla una hora despues, a mitad de la
    // migracion, con «type "geography" does not exist» (#742).
    const dir = banco(["catastro"]);
    mkdirSync(join(dir, "roles", "rentas.sql"));

    expect(() => ejecutar(dir)).toThrow(/git clone https:\/\/github\.com\/hneyra\/rentas/);
  });

  it("y sin ningun archivo montado tampoco crea nada en silencio", () => {
    expect(() => ejecutar(banco([]))).toThrow();
  });
});
