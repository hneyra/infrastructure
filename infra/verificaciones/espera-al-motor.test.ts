import { describe, expect, it } from "vitest";
import {
  CONTENEDOR_DE_ESPERA,
  conEsperaAlMotor,
  contenedorDeEspera,
} from "../componentes/espera-al-motor";
import { podsDe, type Job } from "../componentes/tipos";
import { ENVIRONMENTS } from "../config";
import { manifiestosDelAmbiente } from "../herramientas/emitir-manifiestos";
import { invariantesDe } from "./stacks";
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
   * Y el censo de hoy, escrito: **doce de doce esperando**.
   *
   * Nacio al reves —diez de diez SIN esperar—, y esa cifra era correcta: no habia ni un ejemplo
   * dentro del repositorio. Lo que la dio la vuelta no fue escribirla cuatro veces en cuatro
   * descriptores sino que **la ponga la plataforma al componer**, porque el motor no es de ningun
   * sistema (ver `componentes/espera-al-motor.ts`).
   *
   * **Se cuentan los dos lados**: que ninguno se quede sin espera, y que el censo no este vacio.
   * Sin lo segundo, apuntar el barrido a un sitio donde no haya `Job` dejaria las dos
   * afirmaciones en verde sin haber mirado nada — que es la leccion de C-15/C-16 y la que #10
   * volvio a pagar.
   */
  it.each(ENVIRONMENTS)("«%s»: los doce esperan, y son doce", (ambiente) => {
    const procesos = procesosQueHablanConElMotor(ambiente);
    expect(procesos.filter((p) => !p.espera).map((p) => p.nombre)).toEqual([]);
    // Eran DIEZ hasta ADR-0039: los dos que suma `identidad` son sus dos `Job` —migracion e
    // implantacion—, y no hace falta tocar ni una linea de su descriptor para que esperen,
    // porque la espera la INYECTA la plataforma al componer. Que la cifra se toque a mano es lo
    // que hace que un sistema nuevo pase por aqui en vez de entrar sin que nadie lo cuente.
    expect(procesos.length).toBe(12);
  });

  /** Y el `sha` no ensucia la clave: la deuda es del proceso, no de su version. */
  it("el nombre se lee sin la version", () => {
    expect(sinLaVersion("kamayuk-rentas-migracion-0fa7d034d185")).toBe("kamayuk-rentas-migracion");
    expect(sinLaVersion("kamayuk-rentas-ingestor")).toBe("kamayuk-rentas-ingestor");
  });
});

/**
 * **La espera tiene limite, y el limite es la mitad del criterio** (AC-1 de #44).
 *
 * Un `initContainer` que espera para siempre no arregla la carrera: la cambia por un pod en
 * `Init:0/1` **sin diagnostico y sin fecha**. En un `Job` eso es peor que fallar — el
 * `backoffLimit` no llega a contar, nadie recibe una alerta, y el ambiente se queda igual de
 * atascado que con los tres `Failed` que este issue viene a impedir, pero sin decirlo.
 *
 * Se lee el guion que se EMITE, no la constante del modulo: la constante podria quedarse escrita
 * y no usarse, que es la forma exacta en que #10 encontro un selector declarado y no consultado.
 */
describe("#44 · esperar no es esperar para siempre", () => {
  const guionDe = (ambiente: (typeof ENVIRONMENTS)[number]): string => {
    const contenedor = contenedorDeEspera("una-imagen", "un-motor", 5432);
    // Y ademas el que de verdad viaja en el manifiesto, para que esto no mida una funcion suelta.
    const enElManifiesto = manifiestosDelAmbiente(invariantesDe(ambiente))
      .flatMap((m) => podsDe(m))
      .flatMap((p) => p.pod.initContainers ?? [])
      .filter((c) => c.name === CONTENEDOR_DE_ESPERA)
      .map((c) => (c.command ?? []).join(" "));
    expect(enElManifiesto.length, "no hay ninguna espera emitida que mirar").toBeGreaterThan(0);
    expect(new Set(enElManifiesto).size, "hay dos esperas distintas").toBeLessThanOrEqual(
      enElManifiesto.length,
    );
    return [(contenedor.command ?? []).join(" "), ...enElManifiesto].join("\n");
  };

  it.each(ENVIRONMENTS)("«%s»: el bucle cuenta, y sale con codigo 1 al agotarse", (ambiente) => {
    const guion = guionDe(ambiente);
    expect(guion, "el bucle no lleva cuenta: esperaria para siempre").toMatch(/i=\$\(\(i\+1\)\)/);
    expect(guion, "no hay limite que comparar").toMatch(/-ge \d+/);
    expect(guion, "al agotarse no falla: un pod en Init sin fecha no avisa a nadie").toContain(
      "exit 1",
    );
  });

  it("y dice cuanto espero y por que no arranca", () => {
    const guion = (contenedorDeEspera("i", "un-motor", 5432).command ?? []).join(" ");
    // El mensaje es lo unico que alguien va a leer a las dos de la madrugada. Sin el, «exit 1»
    // en un initContainer es un `Init:Error` que no dice contra que base ni cuanto se espero.
    expect(guion).toContain("un-motor:5432");
    expect(guion).toContain("no acepta conexiones tras");
  });

  /**
   * **El contraste**: no se le pone a quien no habla con el motor.
   *
   * Sin esto, «todos esperan» se cumpliria poniendosela a todo el mundo, y entonces un `Job` que
   * no toca la base se quedaria esperando a algo que no le importa y fallaria a los dos minutos
   * por una espera que nadie le pidio.
   *
   * **Se mide sobre un `Job` fabricado, y eso no es comodidad: es que el ambiente no tiene
   * sujeto.** Medido: hoy los diez `Job`/`CronJob` de los cuatro sistemas declaran su URL, asi
   * que la afirmacion «a los que no hablan no se les pone» es cierta sobre el conjunto vacio —y
   * lo comprobe rompiendolo: con `conEsperaAlMotor` ponisendosela a TODOS, la version anterior de
   * esta prueba **pasaba en verde**—. Un contraste sin sujeto no es un contraste.
   */
  it("a un Job que no habla con el motor no se le pone, y a uno que si, si", () => {
    const sinBase = jobDeMentira([{ name: "algo", value: "1" }]);
    const conBase = jobDeMentira([
      { name: "KAMAYUK_DB_URL", value: "jdbc:postgresql://un-motor:5432/x" },
    ]);
    conEsperaAlMotor([sinBase, conBase], "una-imagen");

    expect(sinBase.spec.template.spec.initContainers ?? []).toEqual([]);
    expect((conBase.spec.template.spec.initContainers ?? []).map((c) => c.name)).toEqual([
      CONTENEDOR_DE_ESPERA,
    ]);
  });

  /** Y no se duplica: un segundo paso no le pone una segunda espera. */
  it("es idempotente", () => {
    const job = jobDeMentira([
      { name: "KAMAYUK_DB_URL", value: "jdbc:postgresql://un-motor:5432/x" },
    ]);
    conEsperaAlMotor([job], "una-imagen");
    conEsperaAlMotor([job], "una-imagen");

    expect((job.spec.template.spec.initContainers ?? []).length).toBe(1);
  });

  /**
   * Y una URL que no se puede leer **para el proceso**, en vez de dejarlo sin espera.
   *
   * «No se de quien es el anfitrion» no es «no hace falta esperar»: emitir ese `Job` seria
   * emitir uno que arranca contra una base que puede no estar, que es el defecto entero.
   */
  it("una URL ilegible para la emision, no la salta", () => {
    const job = jobDeMentira([{ name: "KAMAYUK_DB_URL", value: "postgres://un-motor/x" }]);
    expect(() => conEsperaAlMotor([job], "una-imagen")).toThrow(/no se puede leer/);
  });

  /** Los diez que SI la llevan, contados sobre el ambiente de verdad. */
  it.each(ENVIRONMENTS)("«%s»: la llevan los que hablan, y son mas de cinco", (ambiente) => {
    const conEspera = manifiestosDelAmbiente(invariantesDe(ambiente))
      .filter((m) => m.kind === "Job" || m.kind === "CronJob")
      .filter((m) =>
        podsDe(m).some((p) =>
          (p.pod.initContainers ?? []).some((c) => c.name === CONTENEDOR_DE_ESPERA),
        ),
      )
      .map((m) => m.metadata?.name ?? "");
    const hablan = new Set(procesosQueHablanConElMotor(ambiente).map((p) => p.nombre));

    expect(conEspera.filter((n) => !hablan.has(n))).toEqual([]);
    expect(conEspera.length, "no se le puso a ninguno").toBeGreaterThan(5);
  });
});

/** Un `Job` minimo con las variables que se le pidan. Existe para tener sujeto que contrastar. */
function jobDeMentira(env: { name: string; value: string }[]): Job {
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: { name: "de-mentira", namespace: "ninguno" },
    spec: {
      backoffLimit: 1,
      template: {
        metadata: { labels: {} },
        spec: {
          restartPolicy: "Never",
          priorityClassName: "ninguna",
          containers: [
            {
              name: "unico",
              image: "i",
              env,
              resources: {
                requests: { cpu: "10m", memory: "16Mi" },
                limits: { cpu: "20m", memory: "32Mi" },
              },
            },
          ],
        },
      },
    },
  };
}
