import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SISTEMAS, clonDe, type Sistema } from "./deriva-de-migraciones";
import { inventarioDeSecretos } from "../componentes/secretos";

/**
 * C-7 §6 — quien puede abrir una sesion contra la base de cada sistema.
 *
 * ## Lo que se midio, y por que hace falta una guarda
 *
 * PostgreSQL concede `CONNECT` a PUBLIC al crear una base. Medido contra PostgreSQL 16.15: sobre
 * una base recien creada, `has_database_privilege('<un rol cualquiera>', '<esa base>', 'CONNECT')`
 * devuelve `true`; tras `REVOKE CONNECT ... FROM PUBLIC`, `false`.
 *
 * Los roles son del **cluster** y los cuatro sistemas lo comparten. Sin el `REVOKE`, la credencial
 * de carga de valores normativos —y la aplicacion de cualquier otro sistema— puede abrir una sesion
 * contra la base de `rentas`. No veria filas (RLS esta forzada), pero seria una credencial de mas
 * apuntando a un padron, que es exactamente lo que #155 midio con el rol del respaldo.
 *
 * ## Por que se lee el guion y no se consulta un motor
 *
 * Porque lo que hay que fijar es la **decision**, y la decision esta en el texto: que roles se
 * nombran. Un motor de prueba diria lo que ese motor tiene; esto dice lo que se despliega. La otra
 * mitad —que el `REVOKE` haga lo que promete— es la medicion de arriba, y esta escrita.
 */

/** Quien tiene trabajo de verdad en la base de cada sistema, medido en sus migraciones. */
const CONNECT_ESPERADO: Record<string, readonly string[]> = {
  // `rol_ingestor_catastro` escribe la proyeccion local de `catastro` (V4, V5).
  // `rol_carga_parametros` NO esta: desde P5B los valores normativos viven en `normativa` y aqui
  // no tiene ni una tabla que escribir. Es el punto que C-7 §6 cierra.
  rentas: ["kamayuk_owner", "kamayuk_app", "kamayuk_readonly", "rol_ingestor_catastro"],
  // La normativa que `catastro` usa es su copia local sellada, y la escribe `kamayuk_app`.
  catastro: ["kamayuk_owner", "kamayuk_app", "kamayuk_readonly"],
  // `caja` no sabe que es un tributo: ningun rol de carga tiene nada que hacer aqui.
  caja: ["kamayuk_owner", "kamayuk_app", "kamayuk_readonly"],
  // El unico sitio donde `rol_carga_parametros` tiene sentido: sus cuatro politicas de escritura
  // estan en el `V1` de este esquema (ADR-0007 §5).
  normativa: ["kamayuk_owner", "kamayuk_app", "kamayuk_readonly", "rol_carga_parametros"],
};

function guionDeRoles(nombre: string): string {
  const sistema = SISTEMAS.find((s: Sistema) => s.nombre === nombre);
  if (sistema === undefined) throw new Error(`No hay ningun sistema llamado «${nombre}».`);
  return readFileSync(
    join(clonDe(sistema), "backend", `kamayuk-${nombre}-esquema`, "src/main/resources/db/roles/crear-roles.sql"),
    "utf8",
  );
}

describe("el CONNECT de cada base se concede, no se hereda", () => {
  for (const [sistema, esperados] of Object.entries(CONNECT_ESPERADO)) {
    it(`«${sistema}» revoca el de PUBLIC y nombra a los suyos`, () => {
      const guion = guionDeRoles(sistema);

      expect(
        guion,
        `«${sistema}/crear-roles.sql» no revoca el CONNECT de PUBLIC. PostgreSQL se lo concede al ` +
          "crear la base, asi que TODO rol del cluster —los de los otros tres sistemas incluidos— " +
          "puede abrir una sesion contra esta. Medido: has_database_privilege da `true` antes del " +
          "REVOKE y `false` despues.",
      ).toContain("REVOKE CONNECT ON DATABASE");

      const concedidos = /GRANT CONNECT ON DATABASE %I TO ([a-z_, ]+)'/.exec(guion)?.[1];
      expect(
        concedidos,
        `«${sistema}/crear-roles.sql» revoca el CONNECT y no lo concede a nadie: con eso la ` +
          "aplicacion no puede conectarse a su propia base. Los dos pasos van juntos.",
      ).toBeDefined();

      expect(
        (concedidos as string).split(",").map((r) => r.trim()).sort(),
        `«${sistema}» concede CONNECT a otros roles de los que tienen trabajo en su base. Cada ` +
          "credencial de mas apuntando a un padron es una credencial de mas (#155).",
      ).toEqual([...esperados].sort());
    });
  }

  /**
   * Y el contraste que hace util lo de arriba: `rol_carga_parametros` esta en UNA sola de las
   * cuatro. Sin esta asercion, una lista que lo pusiera en las cuatro pasaria las cuatro pruebas.
   */
  it("y `rol_carga_parametros` solo puede conectarse a `normativa`", () => {
    const donde = Object.entries(CONNECT_ESPERADO)
      .filter(([, roles]) => roles.includes("rol_carga_parametros"))
      .map(([sistema]) => sistema);
    expect(donde).toEqual(["normativa"]);
  });

  /**
   * `rol_ingestor_catastro` existe desde P5C y hasta C-7 no estaba en el inventario de INF-06: se
   * creaba `NOLOGIN`, nadie le generaba clave y nadie se la asignaba. Un rol con privilegios de
   * escritura sobre un padron y sin clave no es «seguro»: es un rol que nadie puede rotar.
   */
  it("y esta en el inventario de secretos, con la base a la que se conecta de verdad", () => {
    const entrada = inventarioDeSecretos("stg").find(
      (e) => e.rolDePostgres === "rol_ingestor_catastro",
    );
    expect(
      entrada,
      "`rol_ingestor_catastro` no esta en el inventario de INF-06. `bootstrap-secretos.sh` genera " +
        "lo que el inventario declara y `asignar-claves.sh` le da LOGIN a lo que el inventario " +
        "declara: fuera de el, el rol existe, tiene sus GRANT puestos y no puede abrir una sesion.",
    ).toBeDefined();
    expect(entrada?.baseDeDatos).toBe("rentas");
  });
});
