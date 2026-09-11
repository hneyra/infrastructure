import { describe, expect, it } from "vitest";
import { municipalidadesJson } from "../componentes/fuentes";
import { ENVIRONMENTS } from "../config";
import { invariantesDe } from "./stacks";

/**
 * El `municipalidad.id` se declara en UN sitio, y los dos caminos leen el mismo numero.
 *
 * ## Que numero es este, porque no es lo que parece
 *
 * `municipalidad.id` es una **clave subrogada** —`bigint GENERATED ALWAYS AS IDENTITY`— que
 * PostgreSQL reparte al insertar. Lo que identifica a la municipalidad es el `ubigeo` (`200105`,
 * Catacaos); que su `id` sea `1` solo significa que fue la primera fila.
 *
 * Y ese numero arbitrario es **el inquilino**: en el esquema de `identidad` es la primera columna
 * de la clave primaria de **nueve tablas**, de todas sus `UNIQUE`, de los diez indices, de cuatro
 * `REFERENCES municipalidad(id)` y de las **trece politicas RLS**. El claim `municipalidad_id` de
 * cada token tiene que valer exactamente lo que la base asigno, o el guardia no ve ni una fila.
 *
 * ## El defecto que esta guarda cierra
 *
 * El numero se declaraba en **DOS sitios**, y no coincidian:
 *
 * | Declaracion | Valor | Lo consume |
 * |---|---|---|
 * | `Pulumi.{stg,prod}.yaml` (`kamayuk:municipalidadId`) | 1 | el ingestor de `rentas`, el publicador de `catastro` y dos consumidores del buzon: `TenantContext.fijar(...)` contra **su propia** base |
 * | `municipalidades/<ubigeo>.json` | **9** | `Identidad.ts` y `reconciliar-identidades.sh`: el **claim** de Keycloak de funcionarios y cuentas de servicio |
 *
 * **Alimentan caminos distintos y nada los comparaba.** Los dos usos del valor del stack que ya
 * habia en `verificaciones/` comparan el stack contra el manifiesto que el propio stack genero,
 * o sea una tautologia respecto del archivo versionado.
 *
 * Medido en `stg` el 2026-09-11, con todo lo demas del ambiente arreglado: el token de
 * `kamayuk-rentas-servicio-200105` traia `municipalidad_id: 200105`, las cinco fichas de
 * `usuario` estaban en el inquilino `1`, y los cuatro consumidores del buzon recibian **403 «la
 * cuenta no esta dada de alta» con la fila delante** — porque el `SET LOCAL` fijaba un inquilino
 * y el RLS escondia las filas del otro.
 *
 * ## Por que el RLS no delata el desacuerdo
 *
 * Porque **la base hace exactamente lo que se le pide**: filtra por el inquilino que el token
 * dice. Un id que no corresponda a la municipalidad del `ubigeo` no produce ningun error — produce
 * cero filas, y un 403 que manda a mirar el alta, que es lo unico que esta bien. De ahi que esto
 * tenga que salir rojo **al componer** y no al desplegar.
 *
 * ## Lo que esta guarda NO comprueba
 *
 * Que el numero declarado sea el que la base **tiene**. Eso solo lo puede decir la base, y lo
 * comprueba `RegistroDeMunicipalidadesJdbc` de `identidad`, que escribe el id declarado y falla
 * nombrando los dos numeros si la fila ya existe con otro. Y **solo en la base de `identidad`**:
 * los cuatro satelites no reciben el numero —su `DatosDeImplantacion` solo declara `ubigeo`—, asi
 * que el `1` del stack les vale porque las cuatro bases se lo dieron a su primera fila. Es una
 * coincidencia, no una garantia, y queda dicha.
 */
describe("#73 · el `municipalidad.id` se declara en un sitio, y los dos caminos coinciden", () => {
  /** Los archivos versionados, por ubigeo. */
  const versionadas = new Map(
    municipalidadesJson().map(({ ubigeo, contenido }) => [
      ubigeo,
      JSON.parse(contenido) as { ubigeo?: string; municipalidadId?: unknown },
    ]),
  );

  it("EL CENTINELA: cada archivo declara un `municipalidadId` que es un entero positivo", () => {
    // Sin esto, la comparacion de abajo se cumpliria sobre `undefined` en los dos lados el dia
    // que alguien quitara el campo — que es la forma en que una guarda se queda sin sujeto y
    // sigue saliendo verde.
    expect(versionadas.size, "no hay ningun `municipalidades/<ubigeo>.json`").toBeGreaterThan(0);

    for (const [ubigeo, datos] of versionadas) {
      expect(
        Number.isInteger(datos.municipalidadId) && (datos.municipalidadId as number) > 0,
        `«${ubigeo}.json» declara «municipalidadId: ${String(datos.municipalidadId)}», que no es ` +
          "un entero positivo. De ahi sale el claim `municipalidad_id` de cada token de esa " +
          "municipalidad, y es la primera columna de la clave primaria de nueve tablas",
      ).toBe(true);
    }
  });

  it.each(ENVIRONMENTS)(
    "«%s» despliega el mismo `municipalidadId` que declara el archivo de su ubigeo",
    (ambiente) => {
      const { ubigeo, municipalidadId } = invariantesDe(ambiente).implantacion;
      const versionada = versionadas.get(ubigeo);

      expect(
        versionada,
        `«${ambiente}» implanta el ubigeo ${ubigeo} y no hay ningun ` +
          `«municipalidades/${ubigeo}.json». El guion de identidades deriva de esos archivos ` +
          "los usuarios, los grupos y las cuentas de servicio de la municipalidad, asi que sin " +
          "el ese ambiente se despliega sin una sola cuenta",
      ).toBeDefined();

      expect(
        municipalidadId,
        `«${ambiente}» declara «municipalidadId: ${municipalidadId}» en su stack y ` +
          `«${ubigeo}.json» declara «${String(versionada?.municipalidadId)}». Son el MISMO ` +
          "numero declarado dos veces, y alimentan caminos distintos: del stack sale el " +
          "inquilino que los procesos por lotes fijan contra su base, y del archivo sale el " +
          "claim `municipalidad_id` de los tokens de Keycloak. Con los dos en desacuerdo, el " +
          "RLS no delata nada —la base filtra por el inquilino que el token dice— y el sintoma " +
          "es un 403 «la cuenta no esta dada de alta» CON LA FILA DELANTE, que manda a mirar el " +
          "alta: lo unico que esta bien (#73)",
      ).toBe(versionada?.municipalidadId);
    },
  );
});
