import { describe, expect, it } from "vitest";
import {
  REGLAS,
  clasesDeOperadoresSinRegla,
  exclusionesConIgualdad,
  extensionesDeclaradas,
  migraciones,
  sinComentarios,
  usosEnLasMigraciones,
  usosSinDeclarar,
} from "./extensiones-de-las-migraciones";

/**
 * La extension que una migracion necesita tiene que estar declarada (#742).
 *
 * Este acoplamiento ya rompio DOS despliegues: `V61` con `geography` el 2026-08-30 —el
 * incidente que hizo nacer `despliegue/crear-extensiones.sh`— y `V72` con `btree_gist`
 * ahora (#675). Las dos veces el sintoma fue el mismo y no se parece a su causa: un Job
 * de Kubernetes que falla una hora despues con un mensaje que no nombra la extension.
 *
 * Corre en `yarn verificar`, sin cluster y sin motor, que es el unico sitio donde esto
 * se puede atrapar barato: **CI nunca lo ve**, porque su volumen siempre nace vacio y
 * ahi `crear-roles.sql` corre entero.
 */
describe("#742 — la extension que una migracion usa esta declarada", () => {
  it("EL CONTRASTE: hoy no falta ninguna, y no hay ningun falso positivo", () => {
    // Va primero a proposito. Una comprobacion que grita por una migracion que no
    // depende de nada deja de leerse — la leccion que #437 midio al descartar
    // ensanchar el patron de la regla 5 por sus ocho falsos positivos.
    expect(usosSinDeclarar()).toEqual([]);
  });

  it("las tres dependencias de hoy se detectan, y con su migracion", () => {
    const porMigracion = new Map(
      usosEnLasMigraciones().map((u) => [`${u.migracion}|${u.extension}`, u]),
    );

    expect([...porMigracion.keys()].sort()).toEqual([
      "V11__busqueda_por_aproximacion.sql|pg_trgm",
      "V11__busqueda_por_aproximacion.sql|unaccent",
      "V61__geometria_del_predio.sql|postgis",
      "V72__vigencias_que_no_se_pisan.sql|btree_gist",
    ]);
  });

  it("la lista de declaradas sale de crear-roles.sql, no de aqui", () => {
    // Escribirla en el codigo seria un segundo sitio donde olvidarse de una, que es
    // justo el defecto que `crear-extensiones.sh` evito al leer el archivo.
    expect(extensionesDeclaradas()).toEqual(["btree_gist", "pg_trgm", "postgis", "unaccent"]);
  });

  it("el rojo nombra la migracion, la extension y por que hace falta", () => {
    const uso = usosEnLasMigraciones().find((u) => u.extension === "btree_gist");

    expect(uso?.migracion).toBe("V72__vigencias_que_no_se_pisan.sql");
    expect(uso?.porque).toContain("btree_gist");
    // Sin el «porque», el mensaje diria «falta btree_gist» a alguien que no tiene por
    // que saber que `EXCLUDE USING gist` con `=` la necesita — que es exactamente el
    // conocimiento que faltaba las dos veces que esto rompio.
    expect(uso?.porque).toMatch(/EXCLUDE USING gist/i);
  });

  it("hay migraciones de sobra, y todas se leen", () => {
    // Si el directorio se moviera, `usosSinDeclarar()` volveria vacio y las demas
    // pruebas pasarian en verde sin haber mirado ni un archivo.
    expect(migraciones().length).toBeGreaterThan(60);
    expect(migraciones()[0]).toMatch(/^V1__/);
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
  it("hoy no hay ninguna sin regla", () => {
    expect(clasesDeOperadoresSinRegla()).toEqual([]);
  });

  it("text_pattern_ops es del nucleo y NO pide ninguna extension", () => {
    // Esto lo encontro medir, no razonar: la primera version de este modulo no tenia
    // lista de clases del nucleo, sobre la premisa de que «rara vez se deletrean», y
    // dio DIECISEIS falsos positivos de golpe. `text_pattern_ops` esta en dieciseis
    // sitios porque bajo RLS un `LIKE 'prefijo%'` no llega nunca al indice y toda
    // busqueda por prefijo de este repositorio se escribe con el (DAT-01 §0).
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
    // `V11` nombra `gin_trgm_ops` y ademas llama a `similarity()`.
    const deV11 = usosEnLasMigraciones().filter(
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
