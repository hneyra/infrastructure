import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SISTEMAS } from "./deriva-de-migraciones";
import {
  DECLARADAS_DE_MAS,
  REGLAS,
  clasesDeOperadoresSinRegla,
  declaradasSinUsar,
  descripcionDelSobrante,
  descripcionDelUso,
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
      rentas: 11,
      catastro: 4,
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
      catastro: ["btree_gist", "pg_trgm", "postgis", "unaccent"],
      normativa: ["btree_gist", "pg_trgm", "postgis", "unaccent"],
      // CERO, y es el dato: P5D las retiro a proposito, «porque la caja tiene que poder
      // correr en el motor mas simple que exista». Que sea cero y no un archivo
      // ilegible lo garantiza la prueba de que los dos archivos existen.
      caja: [],
    });
  });
});

describe("C-2 — lo declarado y no usado se DICE, con su motivo", () => {
  it("el censo es exactamente el declarado, en las dos direcciones", () => {
    // Las dos direcciones es lo que hace que esta lista valga lo mismo que un rojo: una
    // declaracion de mas nueva no tiene donde esconderse, y una entrada que deja de ser
    // cierta —retirada, o usada por una migracion nueva— tampoco puede quedarse rancia.
    expect(declaradasSinUsar().map(descripcionDelSobrante)).toEqual(
      DECLARADAS_DE_MAS.map(descripcionDelSobrante),
    );
  });

  it("y son cinco: una de catastro y las cuatro de normativa", () => {
    expect(declaradasSinUsar().map((s) => `${s.sistema}|${s.extension}`)).toEqual([
      "catastro|pg_trgm",
      "normativa|btree_gist",
      "normativa|pg_trgm",
      "normativa|postgis",
      "normativa|unaccent",
    ]);
  });

  it("cada entrada dice por que sobra, y no es una lista de nombres", () => {
    for (const entrada of DECLARADAS_DE_MAS) {
      expect(entrada.porque.length, `«${entrada.sistema}/${entrada.extension}» no dice por que`)
        .toBeGreaterThan(60);
      expect(
        esquemas().map((e) => e.nombre),
        `«${entrada.sistema}» no es ninguno de los esquemas medidos`,
      ).toContain(entrada.sistema);
    }
  });

  it("EL CONTRASTE: el monolito, rentas y caja no declaran ninguna de mas", () => {
    // Sin esto, la lista podria crecer sin limite y seguir «cuadrando». Los tres que
    // estan a cero son los tres que alguien podo: `rentas` en P5E, `caja` en P5D, y el
    // monolito porque las cuatro las usa.
    const conSobrantes = new Set(declaradasSinUsar().map((s) => s.sistema));

    expect([...conSobrantes].sort()).toEqual(["catastro", "normativa"]);
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
