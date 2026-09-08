import { describe, expect, it } from "vitest";
import { ENVIRONMENTS } from "../config";
import {
  procesosQueHablanConElMotor,
  SIN_ESPERA_PENDIENTES,
  sinLaVersion,
} from "./espera-al-motor";

/**
 * `#44` — el censo de quien habla con el motor sin esperarlo.
 *
 * El porque esta en `espera-al-motor.ts`. Aqui esta lo que se comprueba, y las dos direcciones,
 * que es lo que separa una lista de trabajo pendiente de una puerta abierta.
 */
describe("#44 · quien habla con el motor, y quien lo espera", () => {
  it.each(ENVIRONMENTS)("«%s»: el censo tiene sujeto", (ambiente) => {
    const procesos = procesosQueHablanConElMotor(ambiente);
    // Sin esto, todo lo de abajo se cumple solo el dia que el emisor cambie de forma y el censo
    // devuelva la lista vacia: es la leccion de C-15/C-16 y de `E` §2.
    expect(
      procesos.length,
      "ningun `Job` ni `CronJob` del ambiente declara una URL de la base: este censo no esta " +
        "midiendo nada",
    ).toBeGreaterThan(5);
  });

  /**
   * Los que no esperan **estan declarados**, uno a uno.
   *
   * Si aparece uno nuevo —un `Job` que alguien anada manana— sale rojo aqui y no a las dos de la
   * madrugada del proximo `pulumi up` que toque el motor.
   */
  it.each(ENVIRONMENTS)("«%s»: ninguno sin esperar y sin declarar", (ambiente) => {
    const sinDeclarar = procesosQueHablanConElMotor(ambiente)
      .filter((p) => !p.espera)
      .map((p) => sinLaVersion(p.nombre))
      .filter((n) => !SIN_ESPERA_PENDIENTES.includes(n));

    expect(
      [...new Set(sinDeclarar)],
      "estos procesos abren una conexion al motor y no lo esperan:\n  " +
        [...new Set(sinDeclarar)].join("\n  ") +
        "\n  El `Deployment` del motor es `Recreate`: cualquier `pulumi up` que lo toque lo baja " +
        "a cero, y un `Job` con `backoffLimit: 3` gasta sus tres intentos en segundos y muere " +
        "para siempre — su nombre lleva el `sha`, asi que `pulumi up` tampoco puede recrearlo.\n" +
        "  Remedio: un `initContainer` con `pg_isready` EN BUCLE, en el descriptor de su sistema.",
    ).toEqual([]);
  });

  /**
   * Y la otra direccion: una entrada que ya no hace falta **tambien** sale roja.
   *
   * Sin esto la lista solo crece, y una lista que solo crece deja de ser deuda declarada para ser
   * una exencion permanente. Es lo que `catastro`#20 midio: dos de cinco exenciones llevaban desde
   * su #6 sin eximir a nadie.
   */
  it.each(ENVIRONMENTS)("«%s»: ninguna entrada declarada esta rancia", (ambiente) => {
    const procesos = procesosQueHablanConElMotor(ambiente);
    const presentes = new Set(procesos.map((p) => sinLaVersion(p.nombre)));
    const queEsperan = new Set(
      procesos.filter((p) => p.espera).map((p) => sinLaVersion(p.nombre)),
    );

    const sobran = SIN_ESPERA_PENDIENTES.filter(
      (n) => presentes.has(n) && queEsperan.has(n),
    );
    expect(
      sobran,
      `estas entradas ya esperan al motor y siguen declaradas como pendientes: ${sobran.join(
        ", ",
      )}. Retirarlas de SIN_ESPERA_PENDIENTES es parte del arreglo.`,
    ).toEqual([]);
  });

  /**
   * Y el censo de hoy, escrito: **diez de diez sin esperar**.
   *
   * No hay ni un ejemplo dentro del repositorio, asi que la espera hay que escribirla en los
   * cuatro descriptores y no copiarla de ningun sitio. Esta cifra baja sola con cada uno que
   * aterrice, y esta prueba obliga a mirarla cuando cambie.
   */
  it.each(ENVIRONMENTS)("«%s»: hoy no espera ninguno, y se cuenta", (ambiente) => {
    const procesos = procesosQueHablanConElMotor(ambiente);
    expect(procesos.filter((p) => p.espera).map((p) => p.nombre)).toEqual([]);
    expect(procesos.length).toBe(SIN_ESPERA_PENDIENTES.length);
  });

  /** Y el `sha` no ensucia la clave: la deuda es del proceso, no de su version. */
  it("el nombre se lee sin la version", () => {
    expect(sinLaVersion("kamayuk-rentas-migracion-0fa7d034d185")).toBe("kamayuk-rentas-migracion");
    expect(sinLaVersion("kamayuk-rentas-ingestor")).toBe("kamayuk-rentas-ingestor");
  });
});
