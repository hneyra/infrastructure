import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CIFRAS_DEL_CORTE,
  cifrasSinEmisor,
  cifrasVivas,
  sinFuente,
} from "../observabilidad/cifras-del-corte";
import {
  archivoDeLasReglas,
  grupoDelCorte,
  reglasComoYaml,
} from "../observabilidad/reglas-del-corte";
import {
  archivoDelTablero,
  tableroComoJson,
  tableroDelCorte,
} from "../observabilidad/tablero-del-corte";

/**
 * Las seis cifras del corte: que esten, que digan de donde salen, y que ninguna mienta (P6, §3).
 *
 * ## El defecto que estas pruebas existen para no tener
 *
 * Un tablero de seis cifras en cero se lee de una sola manera: todo va bien. Y hay dos maneras de
 * estar en cero que se dibujan igual y significan lo contrario — «no pasa nada» y «nadie alimenta
 * esa serie». La segunda es no tener defensa y creer que se tiene, y es exactamente la clase de
 * defecto que este proyecto persigue.
 *
 * <p>Asi que lo que se sujeta aqui no es que las seis valgan cero: es que las dos que hoy no
 * tienen emisor **no se puedan dibujar como cero**, que su motivo este escrito al lado, y que la
 * lista de las que faltan no pueda quedarse rancia.
 */
describe("las seis cifras del corte", () => {
  it("son seis, y son las del enunciado", () => {
    expect(CIFRAS_DEL_CORTE).toHaveLength(6);
    expect(CIFRAS_DEL_CORTE.map((cifra) => cifra.id)).toEqual([
      "retraso-del-outbox",
      "valuacion-que-falta",
      "huellas-discrepantes",
      "eventos-muertos",
      "turnos-con-diferencia",
      "determinaciones-de-otro-conjunto",
    ]);
  });

  /**
   * El censo de lo que hoy se puede medir y lo que no.
   *
   * Fijarlo en una prueba es lo que impide las dos degradaciones: que alguien declare «viva» una
   * cifra que nadie emite —y el tablero pase a dibujar un cero honesto donde no lo hay— y que una
   * que ya tiene emisor siga declarandose sin fuente, con su panel diciendo «sin fuente» sobre un
   * dato que ya llega.
   *
   * <p>Cuando esto se ponga rojo, lo que hay que hacer NO es actualizar el numero: es leer que
   * cifra cambio de lado y por que.
   */
  it("y desde C-8 las SEIS tienen emisor, medido y no supuesto", () => {
    expect(cifrasVivas().map((cifra) => cifra.id)).toEqual([
      "retraso-del-outbox",
      "valuacion-que-falta",
      "huellas-discrepantes",
      "eventos-muertos",
      "turnos-con-diferencia",
      "determinaciones-de-otro-conjunto",
    ]);
    // Las dos que faltaban las cierra C-8: `catastro` publica a un outbox transaccional y el
    // ingestor de `rentas` lo aplica con `rol_ingestor_catastro`. Lo que ESTA prueba fija es el
    // censo; que el emisor exista de verdad lo miden las dos baterias de C-8, contra PostgreSQL
    // real y con los hechos que el otro repositorio emitio.
    expect(cifrasSinEmisor()).toEqual([]);
  });

  it("cada una dice quien la escribe, o por que no la escribe nadie y quien lo cierra", () => {
    for (const cifra of CIFRAS_DEL_CORTE) {
      if (cifra.fuente.clase === "viva") {
        expect(cifra.fuente.escritor.length, `«${cifra.id}» no dice quien la escribe`).toBeGreaterThan(
          20,
        );
      } else {
        expect(cifra.fuente.motivo.length, `«${cifra.id}» no dice por que falta`).toBeGreaterThan(20);
        expect(cifra.fuente.loCierra.length, `«${cifra.id}» no dice quien lo cierra`).toBeGreaterThan(
          5,
        );
      }
    }
  });

  /**
   * «CADA ALERTA VA A UNA PERSONA CON NOMBRE», que es lo que el enunciado pide y lo que
   * `alertas.yml` no tenia: sus doce reglas llevan `runbook` —que dice QUE hacer— y ninguna dice
   * A QUIEN.
   */
  it("y cada una tiene un responsable con nombre y un runbook", () => {
    for (const cifra of CIFRAS_DEL_CORTE) {
      expect(cifra.responsable, `«${cifra.id}» no nombra a nadie`).toMatch(/\S+ \S+/);
      expect(cifra.runbook, `«${cifra.id}» no dice que hacer`).toMatch(
        /^docs\/B0-operacion\/runbooks\/.+\.md$/,
      );
    }
  });
});

describe("el tablero", () => {
  it("es el que produce el catalogo, byte a byte", () => {
    expect(
      readFileSync(archivoDelTablero(), "utf8"),
      "el tablero no se edita a mano: se regenera con `yarn observabilidad-del-corte`",
    ).toBe(tableroComoJson());
  });

  it("tiene un panel por cifra, y ninguno de mas", () => {
    const paneles = tableroDelCorte().panels.filter((panel) => panel.type === "stat");
    expect(paneles).toHaveLength(6);
    expect(paneles.map((panel) => panel.targets?.[0]?.expr)).toEqual(
      CIFRAS_DEL_CORTE.map((cifra) => cifra.metrica),
    );
  });

  /**
   * LA PRUEBA DE ESTE PUNTO. Una cifra sin emisor no puede dibujarse como cero.
   *
   * Grafana pinta `noValue` en lugar del valor cuando la consulta no devuelve nada. Sin esa
   * linea, las dos que hoy no tiene nadie se leerian exactamente igual que las que estan en cero
   * porque todo va bien — y ese es el defecto entero.
   */
  it("y una cifra sin emisor dibuja su motivo, no un cero", () => {
    const paneles = tableroDelCorte().panels.filter((panel) => panel.type === "stat");

    for (const cifra of cifrasSinEmisor()) {
      const panel = paneles.find((candidato) => candidato.title === cifra.titulo);
      expect(panel, `no hay panel para «${cifra.id}»`).toBeDefined();
      expect(
        panel?.fieldConfig?.defaults?.noValue,
        `el panel de «${cifra.id}» dibujaria un cero donde no hay fuente`,
      ).toBe(sinFuente(cifra));
      expect(panel?.description).toContain("sin fuente");
    }
  });

  /** El contraste: una cifra que SI se mide no puede llevar un texto de «sin fuente». */
  it("y una cifra con emisor no dice que le falte fuente", () => {
    const paneles = tableroDelCorte().panels.filter((panel) => panel.type === "stat");

    for (const cifra of cifrasVivas()) {
      const panel = paneles.find((candidato) => candidato.title === cifra.titulo);
      expect(panel?.description).not.toContain("sin fuente");
      expect(panel?.description).toContain(cifra.responsable);
    }
    // Y el catalogo se niega a producir ese texto para una cifra viva, que es donde el error
    // se cometeria: en el generador, no en el archivo.
    expect(() => sinFuente(cifrasVivas()[0]!)).toThrowError(/tiene emisor/);
  });

  /** Las seis en UNA pantalla: dos filas de tres en las 24 columnas de Grafana. */
  it("y las seis caben en una pantalla", () => {
    const paneles = tableroDelCorte().panels.filter((panel) => panel.type === "stat");
    const masAbajo = Math.max(...paneles.map((panel) => panel.gridPos.y + panel.gridPos.h));
    expect(masAbajo, "hay que desplazarse para ver las seis").toBeLessThanOrEqual(13);
  });
});

describe("las reglas de alerta", () => {
  it("son las que produce el catalogo, byte a byte", () => {
    expect(
      readFileSync(archivoDeLasReglas(), "utf8"),
      "no se editan a mano: se regeneran con `yarn observabilidad-del-corte`",
    ).toBe(reglasComoYaml());
  });

  /**
   * Dos por cifra: la del umbral y la de la ausencia.
   *
   * La segunda es la leccion de #156 con `pg_up`, que costo descubrirla ejecutando: cuando el pod
   * entero cae, la serie no pasa a cero — deja de existir, y una regla que solo mirara el valor
   * nunca llegaria a «firing». Con las seis series hoy inexistentes, esta es ademas la unica que
   * puede disparar.
   */
  it("y son dos por cifra: la del umbral y la de que la serie no existe", () => {
    const reglas = grupoDelCorte().rules;
    expect(reglas).toHaveLength(12);
    expect(reglas.filter((regla) => regla.expr.startsWith("absent("))).toHaveLength(6);
  });

  it("y ninguna se queda sin persona a quien avisar", () => {
    for (const regla of grupoDelCorte().rules) {
      expect(regla.labels.responsable, `«${regla.alert}» no avisa a nadie`).toMatch(/\S+ \S+/);
    }
  });

  /**
   * Y la regla de una cifra sin emisor lo DICE en su descripcion.
   *
   * Sin esto, quien reciba la de ausencia leeria «o el emisor no esta, o dejo de estarlo» y se
   * pondria a buscar un exportador caido. Lo que pasa es otra cosa y ya esta escrita.
   */
  it("y la de una cifra sin emisor dice que hoy no puede dispararse", () => {
    for (const cifra of cifrasSinEmisor()) {
      const delUmbral = grupoDelCorte().rules.find(
        (regla) => regla.expr === `${cifra.metrica} > ${cifra.umbral}`,
      );
      expect(delUmbral?.annotations.descripcion).toContain("SIN EMISOR HOY");
      expect(delUmbral?.annotations.descripcion).toContain(cifra.fuente.clase === "sin-emisor" ? cifra.fuente.loCierra : "");
    }
  });
});
