import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { raizDelRepositorio } from "../componentes/fuentes";
import { ENVIRONMENTS, type Environment } from "../config";
import {
  ambientesConMigrador,
  clonDe,
  derivasDelAmbiente,
  loQueFalta,
  migracionesDe,
  REVISION_DE_REFERENCIA,
  SISTEMAS,
  sistemaLlamado,
  sistemasDesplegados,
  loQueNoEncaja,
  versionDeclarada,
  type DerivaDeMigraciones,
} from "./deriva-de-migraciones";

/**
 * La deriva de migraciones deja de poder crecer en silencio (issue #675), **ahora que
 * el esquema vive en otro repositorio** (P6).
 *
 * Lo que este archivo mide **no** es lo que mide `verificar-el-ambiente.sh`. Aquel
 * compara la base con la version que el ambiente declara, y por eso el 2026-09-01 dijo
 * «48 · 48 · OK» de un `stg` que corria 48 de las 61 migraciones de `main`: estaba al
 * dia con su version declarada, y la version declarada llevaba trece migraciones sin
 * moverse. Aqui se compara ese tercer numero, y **sin cluster**: solo hacen falta el
 * archivo del stack y el arbol de git, asi que la demostracion de que la regla muerde se
 * puede correr en cualquier maquina.
 *
 * Los dos ambientes van juntos a proposito. `aplicar-prod` tiene `needs: aplicar-stg`
 * (`infra.yml`), asi que `stg` es la puerta por la que pasa toda version que llegue a
 * produccion: dejar uno de los dos atras convierte el ensayo en un ensayo de otra cosa.
 *
 * ## Lo que cambia con `E`: de UN esquema a CUATRO
 *
 * Hasta el 2026-09-06 esto medía un solo esquema, el del monolito, porque era el unico
 * migrador que el despliegue construia. Los cuatro `Job` de migracion del corte —que llevan
 * corriendo en `stg` desde que existen— **no los medía nadie**, y estaba declarado como
 * hueco en C-20.
 *
 * El defecto era de una linea y del mismo tipo que C-16 y `D` ya habian encontrado dos
 * veces: `sistemasDesplegados` leia `construirManifiestos` —la PLATAFORMA— en vez de
 * `manifiestosDelAmbiente` —los cinco espacios de nombres—, asi que no podia ver los `Job`
 * que compone el descriptor de cada sistema. Con el censo mirando lo que de verdad se
 * aplica, cada uno se mide contra SU `git log` y SU linea `kamayuk:versionDe<Sistema>`.
 */
/**
 * Los ambientes que de verdad migran algo.
 *
 * Se **deriva de los manifiestos** —no del nombre del ambiente ni de una lista—, y el
 * describe de abajo comprueba las dos direcciones: que el censo sea exactamente el de los
 * cuatro sistemas, y que quede al menos un ambiente midiendose. Sin esa segunda mitad, este
 * filtro seria la forma de apagar la guarda de #675 entera por lista vacia.
 */
const CON_MIGRADOR = ambientesConMigrador(ENVIRONMENTS);

/** Cada par (ambiente, sistema) que este despliegue migra. Es la unidad de medida desde `E`. */
const A_MEDIR: [Environment, string][] = CON_MIGRADOR.flatMap((ambiente) =>
  sistemasDesplegados(ambiente).map((sistema): [Environment, string] => [ambiente, sistema]),
);

describe("los ambientes declaran la version que trae las migraciones de cada sistema", () => {
  it.each(A_MEDIR)("Pulumi.%s.yaml · %s", (ambiente, sistema) => {
    const deriva = derivaDeUno(ambiente, sistema);
    expect(loQueFalta(deriva), loQueFalta(deriva)).toBe("");
  });

  /**
   * El contraste, y no sobra: sin el, la comprobacion de arriba pasaria en verde
   * tambien si `migracionesDe` devolviera siempre lo mismo para las dos revisiones
   * —o cero para las dos—, que es el modo de fallo de toda comparacion entre dos
   * lecturas del mismo sitio.
   */
  it.each(A_MEDIR)("y la cuenta de %s · %s no es cero ni inventada", (ambiente, sistema) => {
    const deriva = derivaDeUno(ambiente, sistema);
    expect(deriva.traeLaVersion).toBeGreaterThan(0);
    expect(deriva.declaraLaReferencia).toBeGreaterThan(0);
    expect(deriva.version).toMatch(/^[0-9a-f]{40}$/);
  });

  /**
   * Y el `sha` declarado tiene que ser de `main` (issue #720).
   *
   * La comprobacion de forma de arriba **no basta, y se midio por las malas**: al
   * preparar #719 se tecleo a mano un `sha` inventado de cuarenta caracteres
   * hexadecimales, y la forma lo admite. Lo que ahi lo habria cazado es `migracionesDe`,
   * porque esa revision no esta en el clon — pero solo por eso.
   *
   * El que **no** cazaba nadie es el de una rama: existe, se cuenta sin protestar, puede
   * traer exactamente las mismas migraciones que `main` y dejar `loQueFalta` en blanco.
   * Y no tiene imagenes: `publicar-imagenes.yml` las publica al integrar en `main`, nunca
   * desde una rama, asi que el Job de migracion pediria una etiqueta que nadie construyo
   * y el sintoma llegaria en el despliegue, no aqui.
   *
   * *Mutacion:* declarar en `Pulumi.stg.yaml` la cabeza de cualquier rama sin integrar.
   */
  it.each(A_MEDIR)("y el sha de %s · %s esta en la historia de main", (ambiente, sistema) => {
    const deriva = derivaDeUno(ambiente, sistema);
    expect(loQueNoEncaja(deriva), loQueNoEncaja(deriva)).toBe("");
  });

  /**
   * Y la medicion se hace contra el repositorio del sistema que se despliega, **no
   * contra este**.
   *
   * Es la mitad del reencuadre de P6 puesta donde puede fallar: si alguien devuelve las
   * migraciones de un sistema a una ruta de `infrastructure`, esta prueba se pone roja.
   */
  it.each(A_MEDIR)("y mide %s · %s contra el clon de su sistema, no contra este", (_ambiente, sistema) => {
    expect(clonDe(sistemaLlamado(sistema))).not.toBe(raizDelRepositorio());
  });

  /**
   * Y cada sistema declara **su propia** version, no una compartida.
   *
   * Es lo que `unicoSistemaDesplegado` llevaba escrito desde #675 como el error que habria
   * que arreglar el dia que se desplegara mas de un migrador: «una sola linea solo puede
   * fechar un `git log`». Ese dia llego, y esto lo fija: si alguien volviera a una linea
   * unica, los cuatro traerian el mismo `sha` y esta prueba se pondria roja — que es peor
   * que un rojo, porque tres de los cuatro se medirian contra el `git log` equivocado.
   */
  it("y los cuatro sistemas no comparten una sola version", () => {
    for (const ambiente of CON_MIGRADOR) {
      const versiones = sistemasDesplegados(ambiente).map((s) =>
        versionDeclarada(ambiente, sistemaLlamado(s)),
      );
      expect(new Set(versiones).size, `«${ambiente}» declara la misma version para varios sistemas`).toBe(
        versiones.length,
      );
    }
  });

  function derivaDeUno(ambiente: Environment, sistema: string): DerivaDeMigraciones {
    const deriva = derivasDelAmbiente(ambiente).find((d) => d.sistema === sistema);
    if (deriva === undefined) {
      throw new Error(`«${ambiente}» ya no construye el migrador de «${sistema}».`);
    }
    return deriva;
  }
});

/**
 * Que sistemas migra este despliegue, **leido de los manifiestos**.
 *
 * Aqui esta la puerta por la que el corte tuvo que pasar. Hasta `E` el censo leia solo la
 * PLATAFORMA, asi que veia el migrador del monolito y **ninguno de los cuatro**: los `Job`
 * de los sistemas los compone su descriptor, en su propio namespace desde ADR-0031. El
 * resultado era una guarda que decia «un migrador, al dia» de un despliegue que corre
 * cuatro, y ninguno de los cuatro lo medía nadie (hueco de C-20).
 */
describe("el censo de sistemas desplegados cuadra con lo que se declara", () => {
  /** Los cuatro de ADR-0031, escritos aqui a proposito: el censo tiene contra que cuadrar. */
  const LOS_CUATRO = ["caja", "catastro", "normativa", "rentas"] as const;

  it.each(CON_MIGRADOR)("%s construye los cuatro migradores, y solo esos", (ambiente) => {
    expect(sistemasDesplegados(ambiente)).toEqual([...LOS_CUATRO]);
  });

  /**
   * Y `SISTEMAS` no declara ninguno de mas.
   *
   * Es la otra direccion: una entrada en `SISTEMAS` que nadie despliega es una tabla que
   * envejece —fue el caso de `sgtm` desde C-19 hasta `E`, doce dias diciendo «asi se mide su
   * deriva» de un esquema que ya no se aplicaba en `stg`—. Si algun dia hace falta declarar
   * un sistema antes de desplegarlo, esto se pone rojo y hay que decidirlo aqui.
   */
  it("y `SISTEMAS` declara exactamente los que se despliegan", () => {
    expect(SISTEMAS.map((s) => s.nombre).sort()).toEqual([...LOS_CUATRO]);
  });

  /**
   * Y queda al menos uno midiendose. Sin esto, un ambiente que dejara de componer
   * migradores dejaria los describes de arriba con `it.each([])` —cero casos— y la guarda
   * de #675 entera pasaria por lista vacia, en verde y sin haber mirado nada.
   */
  it("y al menos un ambiente sigue midiendo su deriva", () => {
    expect(
      CON_MIGRADOR.length,
      "ningun ambiente construye migrador: la guarda de #675 no esta midiendo nada. " +
        "Si eso es lo que se quiere, hay que decidirlo aqui, no dejarlo pasar por lista vacia.",
    ).toBeGreaterThan(0);
    expect(A_MEDIR.length, "no hay ningun par (ambiente, sistema) que medir").toBeGreaterThan(0);
  });

  /**
   * Y cada sistema desplegado trae migraciones en su clon.
   *
   * El contraste, y aqui vale doble: sin el, la comparacion de arriba pasaria en verde
   * tambien devolviendo cero para las dos revisiones, que es el modo de fallo de toda
   * comparacion entre dos lecturas del mismo sitio. Lo que se cuenta es el arbol de git de
   * `origin/main` **de cada clon hermano**, no el de trabajo.
   *
   * En CI esto necesita los cuatro clones hermanos; sin ellos, `clonDe` lanza diciendo cual
   * falta y como traerlo, que es lo que se quiere.
   */
  it.each(LOS_CUATRO)("«%s» declara migraciones en su propio clon", (nombre) => {
    const sistema = sistemaLlamado(nombre);
    expect(migracionesDe(REVISION_DE_REFERENCIA, sistema).length).toBeGreaterThan(0);
  });
});

/**
 * El mensaje, con cifras inventadas.
 *
 * Va aparte de la medicion real por un motivo concreto: el dia en que los dos ambientes
 * esten al dia —que es el dia que este issue busca—, las pruebas de arriba dejan de
 * ejercitar el texto del rojo, y un mensaje que nadie ejercita se degrada sin que nadie
 * lo note. Aqui se fija que **las dos cifras** salgan siempre, que es lo que el criterio
 * de aceptacion pide.
 */
describe("cuando hay deriva, el rojo nombra las dos cifras", () => {
  const inventada: DerivaDeMigraciones = {
    ambiente: "stg",
    sistema: "rentas",
    version: "5fc02f3a44931d69ac3012e55b17f02dc616eac8",
    traeLaVersion: 48,
    declaraLaReferencia: 61,
    faltan: ["V58__una.sql", "V59__otra.sql"],
    enLaHistoria: true,
  };

  it("dice cuantas trae la version y cuantas declara la referencia", () => {
    const mensaje = loQueFalta(inventada);
    expect(mensaje).toContain("48 migraciones");
    expect(mensaje).toContain(`${REVISION_DE_REFERENCIA} declara 61`);
    expect(mensaje).toContain("le faltan 2");
  });

  it("y nombra de que sistema es la version", () => {
    // Sin esto, el rojo de una instalacion con cuatro migradores no diria cual de los
    // cuatro esquemas es el que se quedo atras.
    expect(loQueFalta(inventada)).toContain("«rentas»");
    expect(loQueNoEncaja({ ...inventada, enLaHistoria: false })).toContain("«rentas»");
  });

  it("nombra las migraciones que faltan y el Job que nunca se creo", () => {
    const mensaje = loQueFalta(inventada);
    expect(mensaje).toContain("V58__una.sql");
    expect(mensaje).toContain("V59__otra.sql");
    // El nombre exacto del Job que `yarn manifiestos --ambiente stg | grep migracion`
    // imprime: es la evidencia de que el Job NO se creo, no de que se creara y fallara.
    // Desde `E` lleva el nombre del SISTEMA y no el del ambiente: los cuatro `Job` viven
    // cada uno en su namespace (ADR-0031) y ahi no hay ambiente que los distinga.
    expect(mensaje).toContain("kamayuk-rentas-migracion-5fc02f3a4493");
  });

  it("y calla cuando no falta ninguna", () => {
    expect(loQueFalta({ ...inventada, faltan: [] })).toBe("");
  });

  /**
   * El otro rojo, que tiene otro remedio: aqui no falta una migracion, falta que el
   * `sha` sea de `main`. Van separados por eso — «sube la version» y «esa version no es
   * de main» se arreglan de dos maneras distintas.
   */
  it("y el de la historia dice que las imagenes se publican al integrar", () => {
    const mensaje = loQueNoEncaja({ ...inventada, enLaHistoria: false });
    expect(mensaje).toContain("no esta en la historia");
    expect(mensaje).toContain("publicar-imagenes.yml");
    expect(mensaje).toContain("git rev-parse");
  });

  it("y calla cuando el sha si esta en la historia", () => {
    expect(loQueNoEncaja(inventada)).toBe("");
  });

  /** Un sistema que se despliega y no esta declarado no se puede medir, y lo dice. */
  it("y un sistema sin declarar dice cuales hay", () => {
    expect(() => sistemaLlamado("inventado")).toThrowError(/rentas, catastro, normativa, caja/);
  });
});

/**
 * Y la guarda tiene que **correr** cuando llega una migracion.
 *
 * Esto es la mitad del defecto de #675 que no esta en ningun archivo de `infra/`: hasta el
 * 2026-09-02, el filtro `paths` de `infra.yml` no nombraba el directorio de las migraciones,
 * asi que **integrar una migracion no disparaba este flujo** —ni la guarda de arriba, ni
 * `aplicar-stg`, que es quien despliega—. Trece migraciones entraron sin que ninguna corrida
 * se pusiera roja.
 *
 * **Y el corte se llevo esa mitad, medido.** Un filtro `paths` solo puede nombrar rutas de SU
 * repositorio, y desde `E` las migraciones que se despliegan son las de los cuatro clones: una
 * migracion de `rentas` **no puede** disparar el flujo de `infrastructure`. Se cierra con un
 * disparo entre repositorios (`repository_dispatch`) y **no esta hecho**; el hueco esta
 * declarado en `E` y en `P6-contratos-y-observabilidad.md`.
 *
 * Lo que si se puede fijar aqui, y se fija, es que el flujo traiga lo que la guarda necesita
 * para poder contar: los cuatro clones **con historial completo**.
 */
describe("el flujo trae lo que la guarda necesita para contar", () => {
  const flujo = readFileSync(join(raizDelRepositorio(), ".github/workflows/infra.yml"), "utf8");

  it("`paths` de infra.yml nombra el guion de extensiones", () => {
    expect(flujo).toContain("- 'despliegue/crear-extensiones.sh'");
  });

  /**
   * Y el filtro **ya no nombra nada del monolito**, que es la otra direccion.
   *
   * Sin esto, las dos entradas de `backend/sgtm-esquema/**` podrian quedarse: no romperian
   * nada —ese directorio no existe, asi que nunca casarian— y dejarian creyendo que una
   * migracion dispara el flujo cuando ninguna lo hace. Un filtro que nombra una ruta muerta
   * es peor que uno que no la nombra.
   */
  it("y no nombra ninguna ruta del monolito, que ya no existe", () => {
    // Se leen **las lineas del filtro**, no el archivo entero: los comentarios de `infra.yml`
    // explican por que esas rutas se fueron, y nombrarlas ahi es lo que hace que el cambio se
    // pueda entender. Lo que no puede quedar es una ENTRADA muerta.
    const declaradas = flujo
      .split("\n")
      .map((linea) => linea.trim())
      .filter((linea) => /^- '.*'$/.test(linea));
    expect(declaradas.length, "el filtro `paths` no declara ninguna ruta").toBeGreaterThan(3);
    for (const muerta of ["backend/", "frontend/"]) {
      expect(
        declaradas.filter((linea) => linea.includes(muerta)),
        `«${muerta}» ya no existe en este repositorio: un filtro que nombra una ruta muerta ` +
          "deja creyendo que algo dispara el flujo cuando nada lo hace",
      ).toEqual([]);
    }
  });

  /**
   * Y con `fetch-depth: 0`, o la guarda de arriba no puede contar nada: las dos revisiones
   * se cuentan en el arbol de git de su commit, y con el checkout superficial ninguno esta
   * en el clon.
   */
  it("y `verificar` hace checkout con el historial completo", () => {
    expect(trabajoDeVerificar()).toContain("fetch-depth: 0");
  });

  /**
   * Y trae los clones de los sistemas desplegados, que desde el corte **no son este**.
   *
   * Sin este paso, `clonDe` lanza en CI y las pruebas de deriva se ponen rojas por un motivo
   * que no es el que miden. Es el mismo reparto que `settings.gradle.kts` de los cuatro
   * backends: el clon hermano se exige, y su ausencia se dice con el comando que la arregla
   * en vez de saltarse la comprobacion.
   *
   * `path: infrastructure` y no `path: ../rentas` desde C-9a: `actions/checkout` se niega a
   * escribir fuera del espacio de trabajo, asi que el hermano se consigue clonando ESTE
   * repositorio en un directorio propio y dejando que el espacio de trabajo haga de padre.
   *
   * **Y con historial completo en los cuatro** (`E`). Antes bastaba `fetch-depth: 1` para
   * ellos porque de los cuatro solo se leian archivos del arbol de trabajo, y el unico que
   * necesitaba historia era `sgtm`. Ahora la deriva se mide sobre los cuatro: con el checkout
   * superficial, el `sha` que el stack declara no esta en el clon y `migracionesDe` **se niega
   * a contar** —que es lo correcto, y seria un rojo por un motivo que no es el que se mide—.
   */
  it("y trae los cuatro clones, con historial completo", () => {
    const verificar = trabajoDeVerificar();
    expect(verificar, "este repositorio tiene que clonarse en un directorio propio, o el hermano no cabe").toContain(
      "path: infrastructure",
    );
    expect(verificar).toContain("clonar-los-hermanos");
    expect(
      verificar,
      "sin `historial-completo` la accion clona superficial y la deriva no se puede contar",
    ).toContain("historial-completo: 'si'");

    const accion = readFileSync(
      join(raizDelRepositorio(), ".github/actions/clonar-los-hermanos/action.yml"),
      "utf8",
    );
    // Y la accion clona los cuatro, y ya **ninguno** es `sgtm`.
    for (const sistema of ["rentas", "catastro", "normativa", "caja"]) {
      expect(accion).toContain(`repository: hneyra/${sistema}`);
    }
    expect(accion, "el flujo ya no clona el archivo historico").not.toContain("hneyra/sgtm");

    /**
     * Y las dos profundidades van **entrecomilladas**.
     *
     * En una expresion de GitHub `&&`/`||` devuelven el OPERANDO, y `0` es falso: con
     * `cierto && 0 || 1` la expresion vale **1**, o sea el checkout superficial justo en el
     * trabajo que pide el completo. El sintoma aparecería a mitad de la prueba de deriva —«no
     * esta en el clon»— y no donde esta el defecto.
     */
    // Se leen **las lineas de `fetch-depth`**, no el archivo entero: el docstring de la accion
    // explica el defecto escribiendo la forma mala, y esa explicacion es lo que impide que
    // alguien la reintroduzca.
    const profundidades = accion
      .split("\n")
      .map((linea) => linea.trim())
      .filter((linea) => linea.startsWith("fetch-depth:"));
    expect(profundidades.length, "la accion ya no declara ninguna profundidad").toBe(4);
    for (const linea of profundidades) {
      expect(
        linea,
        "`&& 0 || 1` sin comillas devuelve 1 SIEMPRE —`0` es falso en una expresion de " +
          "GitHub—, o sea el checkout superficial justo en el trabajo que pide el completo",
      ).toContain("&& '0' || '1'");
    }
  });

  function trabajoDeVerificar(): string {
    const jobs = flujo.split(/^ {2}[a-z-]+:$/m);
    const verificar = jobs.find((bloque) => bloque.includes("name: Lint, tipos y pruebas"));
    expect(verificar, "no se encontro el trabajo «Lint, tipos y pruebas»").toBeDefined();
    return verificar as string;
  }
});
