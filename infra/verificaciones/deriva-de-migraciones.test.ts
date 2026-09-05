import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { raizDelRepositorio } from "../componentes/fuentes";
import { ENVIRONMENTS } from "../config";
import {
  clonDe,
  derivaDeMigraciones,
  loQueFalta,
  migracionesDe,
  REVISION_DE_REFERENCIA,
  SISTEMAS,
  sistemaLlamado,
  sistemasDesplegados,
  loQueNoEncaja,
  unicoSistemaDesplegado,
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
 * ## Lo que cambio con el corte, y por que estaba en rojo
 *
 * Estas pruebas llevaban seis en rojo desde la mudanza, con el mensaje
 * «`c755de21…` no esta en este clon». **La guarda tenia razon** —se negaba a inventar un
 * numero— y lo que estaba mal era su premisa: resolvia el `sha` en ESTE repositorio,
 * porque en `sgtm` el `Pulumi.<ambiente>.yaml`, el `sha` y las migraciones compartian
 * `git log`. Ya no. Medido: `c755de21…` es un commit de `sgtm`, esta en su `origin/main`
 * y trae **las mismas 68** migraciones que `sgtm origin/main` declara — o sea que **no
 * habia deriva**, y el rojo no era de deriva.
 */
describe("los ambientes declaran la version que trae las migraciones de su sistema", () => {
  it.each(ENVIRONMENTS)("Pulumi.%s.yaml", (ambiente) => {
    const deriva = derivaDeMigraciones(ambiente);
    expect(loQueFalta(deriva), loQueFalta(deriva)).toBe("");
  });

  /**
   * El contraste, y no sobra: sin el, la comprobacion de arriba pasaria en verde
   * tambien si `migracionesDe` devolviera siempre lo mismo para las dos revisiones
   * —o cero para las dos—, que es el modo de fallo de toda comparacion entre dos
   * lecturas del mismo sitio.
   */
  it.each(ENVIRONMENTS)("y la cuenta de %s no es cero ni inventada", (ambiente) => {
    const deriva = derivaDeMigraciones(ambiente);
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
  it.each(ENVIRONMENTS)("y el sha de %s esta en la historia de main", (ambiente) => {
    const deriva = derivaDeMigraciones(ambiente);
    expect(loQueNoEncaja(deriva), loQueNoEncaja(deriva)).toBe("");
  });

  /**
   * Y la medicion se hace contra el repositorio del sistema que se despliega, **no
   * contra este**.
   *
   * Es la mitad del reencuadre de P6 puesta donde puede fallar: si alguien devuelve
   * `MIGRACIONES` a una ruta de `infrastructure`, esta prueba se pone roja diciendo que
   * la deriva se esta midiendo contra la copia historica que nadie aplica.
   */
  it.each(ENVIRONMENTS)("y la mide contra el clon de su sistema, no contra este", (ambiente) => {
    const deriva = derivaDeMigraciones(ambiente);
    expect(deriva.sistema).toBe("sgtm");
    expect(clonDe(sistemaLlamado(deriva.sistema))).not.toBe(raizDelRepositorio());
  });
});

/**
 * Que sistemas migra este despliegue, **leido de los manifiestos**.
 *
 * Aqui esta la puerta por la que el corte tiene que pasar: mientras el despliegue
 * construya un solo `*-migrador`, una sola `applicationBootstrapVersion` puede fechar su
 * `git log` y todo cuadra. En cuanto construya el segundo, esa linea deja de poder
 * decir de que version es cada esquema — y esta comprobacion se pone roja **antes** de
 * que nadie mida una deriva contra el repositorio equivocado, que es el modo de fallo
 * que #675 encontro y que ocho meses en verde no delataron.
 */
describe("el censo de sistemas desplegados cuadra con lo que se declara", () => {
  it.each(ENVIRONMENTS)("%s construye exactamente un migrador", (ambiente) => {
    expect(sistemasDesplegados(ambiente)).toEqual(["sgtm"]);
    expect(unicoSistemaDesplegado(ambiente)).toBe("sgtm");
  });

  /**
   * Y el sistema que SI se despliega trae migraciones en su clon.
   *
   * El contraste, y aqui vale doble: sin el, `derivaDeMigraciones` pasaria en verde
   * tambien devolviendo cero para las dos revisiones, que es el modo de fallo de toda
   * comparacion entre dos lecturas del mismo sitio. Lo que se cuenta es el arbol de git
   * de `origin/main` **de `sgtm`**, no el de trabajo.
   *
   * En CI esto necesita el segundo `actions/checkout` del trabajo `verificar`; sin el,
   * `clonDe` lanza diciendo que falta el clon y como traerlo, que es lo que se quiere.
   */
  it("el sistema desplegado declara migraciones en su propio clon", () => {
    const sistema = sistemaLlamado(unicoSistemaDesplegado("prod"));
    expect(migracionesDe(REVISION_DE_REFERENCIA, sistema).length).toBeGreaterThan(0);
  });

  /**
   * De los cuatro del corte **no se afirma nada que necesite su clon**, y es deliberado.
   *
   * `infrastructure` se verifica en CI con un solo repositorio mas el de `sgtm`; exigir
   * ademas los cuatro convertiria esta comprobacion en la unica del repositorio que
   * necesita seis checkouts, y una comprobacion cara de satisfacer se acaba
   * desactivando. Sus entradas de {@link SISTEMAS} son documentacion **hasta que se
   * desplieguen**, y quien las valida es `clonDe` el dia que una entre: si el modulo se
   * renombro o el clon no esta, lanza nombrando la ruta, en el momento en que importa.
   *
   * Lo que si se afirma aqui es que ninguna se despliega todavia, que es lo que hace
   * legitimo no comprobarlas.
   */
  it("y ninguno de los cuatro se despliega todavia", () => {
    const desplegados = new Set(sistemasDesplegados("prod"));
    const delCorte = SISTEMAS.filter((sistema) => sistema.nombre !== "sgtm").map((s) => s.nombre);

    // Cuando esto se ponga rojo, lo que hay que hacer NO es actualizarlo: es dar a
    // `config.ts` una version por sistema y pasarla a `manifiestosDeMigracion`. La
    // alternativa —declarar cuatro migradores con una sola version— deja tres esquemas
    // cuya deriva no la mide nadie.
    expect(delCorte.filter((nombre) => desplegados.has(nombre))).toEqual([]);
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
    sistema: "sgtm",
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
    expect(loQueFalta(inventada)).toContain("«sgtm»");
    expect(loQueNoEncaja({ ...inventada, enLaHistoria: false })).toContain("«sgtm»");
  });

  it("nombra las migraciones que faltan y el Job que nunca se creo", () => {
    const mensaje = loQueFalta(inventada);
    expect(mensaje).toContain("V58__una.sql");
    expect(mensaje).toContain("V59__otra.sql");
    // El nombre exacto del Job que `yarn manifiestos --ambiente stg | grep migracion`
    // imprime: es la evidencia de que el Job NO se creo, no de que se creara y fallara.
    expect(mensaje).toContain("sgtm-stg-migracion-5fc02f3a4493");
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
    expect(() => sistemaLlamado("inventado")).toThrowError(/sgtm, rentas, catastro/);
  });
});

/**
 * Y la guarda tiene que **correr** cuando llega una migracion.
 *
 * Esto es la mitad del defecto de #675 que no esta en ningun archivo de `infra/`: hasta
 * el 2026-09-02, el filtro `paths` de `infra.yml` no nombraba el directorio de las
 * migraciones, asi que **integrar una migracion no disparaba este flujo** —ni la guarda
 * de arriba, ni `aplicar-stg`, que es quien despliega—. Trece migraciones entraron sin
 * que ninguna corrida se pusiera roja.
 *
 * Es la misma leccion que #192 §2 y que el propio `infra.yml` ya tiene escrita para los
 * archivos de identidad: un archivo que las pruebas LEEN y el filtro no nombra cambia sin
 * que corra quien lo mira — verde rancio, no verde.
 *
 * **Y el corte se lleva esta mitad, medido.** Un filtro `paths` solo puede nombrar rutas
 * de SU repositorio, y las migraciones que se despliegan ya no estan aqui: una migracion
 * de `sgtm` —o manana de `rentas`— no puede disparar el flujo de `infrastructure`. Las
 * entradas que siguen abajo vigilan la copia historica de `backend/sgtm-esquema/`, que
 * **nadie modifica**, asi que hoy no pueden dispararse. Se conservan porque el dia que
 * esa copia se retire su ausencia tiene que ser deliberada, y el hueco esta declarado en
 * `P6-contratos-y-observabilidad.md`.
 */
describe("el flujo corre cuando llega una migracion", () => {
  const flujo = readFileSync(join(raizDelRepositorio(), ".github/workflows/infra.yml"), "utf8");

  it.each([
    ["las migraciones", "backend/sgtm-esquema/src/main/resources/db/migration/**"],
    ["los roles y sus extensiones", "backend/sgtm-esquema/src/main/resources/db/roles/**"],
    ["el guion de extensiones", "despliegue/crear-extensiones.sh"],
  ])("`paths` de infra.yml nombra %s", (_que, ruta) => {
    expect(flujo).toContain(`- '${ruta}'`);
  });

  /**
   * Y con `fetch-depth: 0`, o la guarda de arriba no puede contar nada: las dos
   * revisiones se cuentan en el arbol de git de su commit, y con el checkout superficial
   * ninguno esta en el clon.
   */
  it("y `verificar` hace checkout con el historial completo", () => {
    expect(trabajoDeVerificar()).toContain("fetch-depth: 0");
  });

  /**
   * Y trae el clon del sistema que se despliega, que desde el corte **no es este**.
   *
   * Sin este paso, `clonDe` lanza en CI y las cinco pruebas de deriva se ponen rojas por
   * un motivo que no es el que miden. Es el mismo reparto que `settings.gradle.kts` de
   * los cuatro backends: el clon hermano se exige, y su ausencia se dice con el comando
   * que la arregla en vez de saltarse la comprobacion.
   *
   * `path: sgtm` y no `path: ../sgtm` desde C-9a: `actions/checkout` se niega a escribir
   * fuera del espacio de trabajo, asi que el hermano se consigue clonando ESTE
   * repositorio en `path: infrastructure` y dejando que el espacio de trabajo haga de
   * padre. La disposicion es la misma —hermanos—; lo que se movio es el anfitrion.
   */
  it("y trae el clon del sistema desplegado, como hermano dentro del espacio de trabajo", () => {
    const verificar = trabajoDeVerificar();
    expect(verificar).toContain("repository: hneyra/sgtm");
    expect(verificar).toContain("path: sgtm");
    expect(verificar, "este repositorio tiene que clonarse en un directorio propio, o el hermano no cabe").toContain(
      "path: infrastructure",
    );
  });

  function trabajoDeVerificar(): string {
    const jobs = flujo.split(/^ {2}[a-z-]+:$/m);
    const verificar = jobs.find((bloque) => bloque.includes("name: Lint, tipos y pruebas"));
    expect(verificar, "no se encontro el trabajo «Lint, tipos y pruebas»").toBeDefined();
    return verificar as string;
  }
});
