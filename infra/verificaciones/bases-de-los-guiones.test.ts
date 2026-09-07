import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BASE_DEL_PADRON,
  BASE_DE_IDENTIDAD,
  BASE_DE_MANTENIMIENTO,
  BASE_DE_PARAMETROS,
  SISTEMAS_DEL_PRODUCTO,
} from "../componentes/convenciones";
import {
  basesDelShell,
  elecionesDeBasePorCase,
  guionesDe,
  guionesVersionados,
  referenciasABases,
  type ReferenciaAUnaBase,
} from "./bases-de-los-guiones";

/**
 * #15 y #16 — la base del padron vive en un solo sitio, y ningun guion nombra una que no
 * exista.
 *
 * Son dos issues y la misma familia de defecto. `E` retiro el monolito y con el la base
 * `sgtm`; su sustituta quedo escrita en cinco sitios y en dos lenguajes, y **veintiseis**
 * referencias a la vieja se quedaron repartidas en siete guiones de operacion. Nada lo vio:
 * `yarn verificar` no ejecuta los guiones, y el unico trabajo que los ejerce necesita Docker
 * y un cluster. Se descubrieron en **cuatro corridas de CI sucesivas** que dijeron cuatro
 * cosas distintas de la misma causa — y no eran cuatro defectos, era el mismo buscado con
 * un `grep` de literales en vez de con un barrido.
 *
 * Esto es el barrido, y corre sin Docker y sin cluster.
 */

const CENSO = [...SISTEMAS_DEL_PRODUCTO, BASE_DE_MANTENIMIENTO, BASE_DE_IDENTIDAD];

const GUIONES = guionesVersionados();
const BASES_SHELL = basesDelShell();
const REFERENCIAS = referenciasABases(GUIONES, BASES_SHELL);

/** Un sitio, para el mensaje de un rojo: archivo, linea y la linea entera. */
const sitio = (r: ReferenciaAUnaBase): string =>
  `${r.archivo}:${r.linea}\n      ${r.texto}`;

describe("#15 · la base del padron se declara una sola vez", () => {
  /**
   * **Los dos lados dicen lo mismo, y se comprueba EJECUTANDO el archivo de shell.**
   *
   * No se puede tener literalmente un archivo: `componentes/` compone manifiestos con
   * TypeScript y `contra-cluster.sh` habla con el cluster con `kubectl` y `psql`, sin node
   * delante. Lo que si se puede es que **no puedan discrepar en silencio**, y esta es la
   * forma que el repositorio ya usa dos veces —el `SISTEMAS=` de `verificar-el-ambiente.sh`
   * y el `SISTEMAS_DEL_PRODUCTO=` de `crear-extensiones.sh`—: se corre el archivo y se lee
   * lo que deja fijado. Una prueba que solo mirara que `bases.sh` *nombra* `rentas` pasaria
   * con la asignacion rota.
   */
  it.each([
    ["BASE_DEL_PADRON", BASE_DEL_PADRON],
    ["BASE_DE_PARAMETROS", BASE_DE_PARAMETROS],
    ["BASE_DE_MANTENIMIENTO", BASE_DE_MANTENIMIENTO],
    ["BASE_DE_IDENTIDAD", BASE_DE_IDENTIDAD],
  ])("«%s»: `infra/bases.sh` y `convenciones.ts` valen lo mismo", (nombre, enTypeScript) => {
    expect(
      BASES_SHELL[nombre],
      `«${nombre}» no sale de ejecutar \`infra/bases.sh\`: el unico sitio del lado shell ` +
        "dejo de declararla, y los guiones que la usan quedarian con la cadena vacia",
    ).toBeDefined();
    expect(
      BASES_SHELL[nombre],
      `\`infra/bases.sh\` dice «${BASES_SHELL[nombre]}» y \`componentes/convenciones.ts\` ` +
        `dice «${enTypeScript}». Es la misma eleccion escrita dos veces en dos lenguajes: ` +
        "cambiar una y no la otra deja los guiones de operacion hablando con una base " +
        "distinta de la que el manifiesto declara, y eso no lo ve nadie hasta el cluster",
    ).toBe(enTypeScript);
  });

  /**
   * Y **exactamente esas cuatro, ni una mas**.
   *
   * Existe por un defecto de la propia guarda, encontrado ejecutandola: `set` vuelca tambien
   * lo heredado, asi que la primera version leia como declarada por el archivo cualquier
   * variable de la maquina cuyo nombre empezara por `BASE` — en este puesto salia
   * `ANTHROPIC_BASE_URL`, y con un `BASE_INVENTADA_DEL_PUESTO` en el entorno la guarda
   * habria hablado de algo que el repositorio no dice.
   */
  it("y `infra/bases.sh` no deja fijada ninguna otra", () => {
    expect(Object.keys(BASES_SHELL).sort()).toEqual(
      ["BASE_DEL_PADRON", "BASE_DE_IDENTIDAD", "BASE_DE_MANTENIMIENTO", "BASE_DE_PARAMETROS"].sort(),
    );
  });

  /**
   * Y **ningun otro guion vuelve a declararla**.
   *
   * Este es el criterio de #15: una segunda declaracion con otro valor tiene que ponerse
   * roja. Se prohibe la declaracion entera y no solo la que discrepe, por lo que costo
   * medir: mientras los cinco valores coincidian **no cambiaba nada**, y por eso nadie lo
   * arreglo — el dia que uno se moviera, el rojo llegaria en el cluster.
   */
  it("ningun guion fuera de `infra/bases.sh` asigna una base a un literal", () => {
    // Lo prohibido es el LITERAL, que es la copia. Un alias —`BASE_DE_LA_CARGA=$BASE_DE_
    // PARAMETROS` en `verificar-el-motor.sh`— no es una segunda verdad: es la misma leida
    // del unico sitio, y si ese sitio cambia, el alias cambia con el.
    const declaraciones = REFERENCIAS.filter(
      (r) =>
        r.forma === "asignacion" &&
        r.archivo !== "infra/bases.sh" &&
        r.base !== undefined &&
        r.base === r.token &&
        CENSO.includes(r.base),
    );
    expect(
      declaraciones.map(
        (r) => `${sitio(r)}\n      → declara «${r.variable}» = «${r.base}»`,
      ),
      "una segunda declaracion de una base con su valor escrito a mano. El unico sitio del " +
        "lado shell es `infra/bases.sh`, y `componentes/convenciones.ts` el del lado " +
        "TypeScript: escribirla otra vez es la copia que nadie compara — olvidar una no " +
        "pone nada rojo, deja un guion hablando con una base distinta de la que el resto usa",
    ).toEqual([]);
  });

  /**
   * Y el contraste, sin el cual lo de arriba se cumple borrando `bases.sh`: **alguien tiene
   * que estar usando esas variables**.
   */
  it("y los guiones las usan: hay referencias que se resuelven por ellas", () => {
    const porVariable = REFERENCIAS.filter(
      (r) => r.forma !== "asignacion" && /^\$\{?BASE/.test(r.token),
    );
    expect(
      porVariable.length,
      "ningun guion nombra su base por una variable de `bases.sh`: el archivo unico existe y " +
        "no lo lee nadie, asi que la comprobacion de arriba se cumpliria sola",
    ).toBeGreaterThan(10);
  });
});

describe("#16 · ningun guion nombra una base que no existe", () => {
  /**
   * **El censo se DERIVA**: las cuatro del producto mas mantenimiento e identidad.
   *
   * Nada escrito a mano. `sgtm` no esta —`E` la dejo sin una sola tabla del producto,
   * medido contra `stg` el 2026-09-06: `pg_tables` devuelve UNA fila, `spatial_ref_sys`—
   * y por eso un `--dbname=sgtm` sale rojo aqui y no en la cuarta corrida de CI.
   */
  it("toda base nombrada esta en el censo del ambiente", () => {
    const fuera = REFERENCIAS.filter((r) => r.base !== undefined && !CENSO.includes(r.base));
    expect(
      fuera.map((r) => `${sitio(r)}\n      → nombra la base «${r.base}» [${r.forma}]`),
      `las bases que el motor provisiona son ${CENSO.join(", ")}, y ninguna otra. Un guion ` +
        "que nombre otra no falla al componer: falla ejecutandose, y con un mensaje que no " +
        "se parece a su causa — «FATAL: database … does not exist» si no existe, y algo " +
        "peor si existe y esta vacia, porque entonces la comprobacion pasa en verde",
    ).toEqual([]);
  });

  /**
   * **Y la omision de un `--dbname` no puede ser una base fija que no sea el padron.**
   *
   * Es el criterio que #16 llama «el que importa», y el defecto que costo dos de las cuatro
   * corridas: el primer arreglo de `E` puso `${2:-postgres}` en `motor_como_superusuario`, y
   * `postgres` **existe** —asi que el censo de arriba lo daria por bueno—. De los 36 sitios
   * que llaman a ese ayudante, **35 no pasan base**: los que preguntan por el cluster
   * funcionan desde cualquiera, pero los que LEEN LO QUE ACABAN DE ESCRIBIR no. Salieron dos
   * «relation … does not exist» que mandaban a mirar el esquema.
   *
   * Una omision que NO se resuelve a una base —`${2:-$BASE}`, con `$BASE` puesto por el
   * bucle de los cuatro sistemas— no es una eleccion escrita y no se toca: lo que se
   * prohibe es fijar una base **distinta del padron** como el valor que reciben los
   * llamadores que no dicen la suya.
   */
  it("la base por omision de un `--dbname` es el padron, o no es fija", () => {
    const omisiones = REFERENCIAS.filter((r) => r.omision !== undefined);
    expect(
      omisiones.length,
      "ningun guion tiene un `--dbname` con valor por omision: el caso que esta " +
        "comprobacion existe para vigilar no aparece, asi que no midio nada",
    ).toBeGreaterThan(0);

    const malas = omisiones.filter(
      (r) => r.omision?.base !== undefined && r.omision.base !== BASE_DEL_PADRON,
    );
    expect(
      malas.map(
        (r) => `${sitio(r)}\n      → omite «${r.omision?.base}» y el padron es «${BASE_DEL_PADRON}»`,
      ),
      "quien llama sin decir su base recibe una base fija que no es el padron. Los 35 de 36 " +
        "llamadores que no la pasan preguntan por el cluster —y funcionan desde cualquiera— " +
        "o LEEN LO QUE ACABAN DE ESCRIBIR, y esos no: reciben «relation … does not exist», " +
        "que manda a mirar el esquema y no la conexion. Quien necesite mantenimiento la pide " +
        "explicitamente, que es lo que ya hacen las consultas de `has_database_privilege`",
    ).toEqual([]);
  });

  /**
   * **Y un realm no es una base.**
   *
   * `KC_REALM:-sgtm` en `reconciliar-identidades.sh` es correcto: ese realm se llama asi y no
   * se renombro. Se afirma que el barrido **leyo el archivo** antes de afirmar que no salio
   * rojo — «no sale rojo» tambien seria cierto si el archivo no se hubiera mirado, que es la
   * forma en que una guarda se queda sin sujeto y se da por buena.
   */
  it("`reconciliar-identidades.sh` se lee, y su `KC_REALM:-sgtm` no sale", () => {
    const archivo = "despliegue/identidad/reconciliar-identidades.sh";
    expect(GUIONES, "el barrido no llego a leer el guion del realm").toContain(archivo);
    expect(
      REFERENCIAS.filter((r) => r.archivo === archivo).map(sitio),
      "el barrido confundio un realm de Keycloak con una base de datos",
    ).toEqual([]);
  });

  /**
   * **Y ninguna base se elige antes de que exista lo que la decide.**
   *
   * Esto no lo pedia ningun criterio: salio al barrer, y era un defecto **vivo**.
   * `rotar-clave.sh` decidia `BASE_DEL_ROL` con un `case "$ROL"` escrito en la linea 45,
   * y `--rol` se lee en la 53: con `$ROL` vacio caia siempre por `*)`, de modo que
   * `--rol postgres-carga` comprobaba la credencial contra el PADRON —donde
   * `rol_carga_parametros` no tiene CONNECT a proposito (C-7 §6)— y daba rojo sobre una
   * credencial buena. Es el segundo defecto de #15 por el otro eje: `verificar-el-motor.sh`
   * declaraba la suya DESPUES de cargar la biblioteca que ya la dejaba fijada.
   */
  it("todo `case` que elige base tiene su sujeto ya fijado", () => {
    const casos = elecionesDeBasePorCase(GUIONES);
    expect(
      casos.length,
      "ningun guion elige su base con un `case`: esta comprobacion se quedo sin sujeto",
    ).toBeGreaterThan(0);
    expect(
      casos
        .filter((c) => c.asignadoEn === undefined)
        .map(
          (c) =>
            `${c.archivo}:${c.linea}\n      → elige la base segun «$${c.sujeto}», y a esa ` +
            "variable no se le ha dado ningun valor antes de esta linea",
        ),
      "un `case` sobre una variable vacia cae SIEMPRE por su rama por omision, y elige una " +
        "base que nadie pidio. No falla: contesta, contra la base equivocada",
    ).toEqual([]);
  });
});

describe("#15 y #16 · el barrido dice cuando NO midio", () => {
  /**
   * La mitad que importa. Una guarda que se queda sin sujeto —el barrido no encuentra un
   * guion, la lista sale vacia— **no puede pasar en verde**: es la doctrina de
   * `verificarAislamiento` y la de los `exit 2` de los arneses del frontend.
   */
  it("un directorio sin guiones no es un arbol limpio: falla", () => {
    const vacio = mkdtempSync(join(tmpdir(), "sin-guiones-"));
    expect(() => guionesDe([vacio])).toThrowError(/NO MIDIO NADA/);
  });

  it("un directorio que no existe tampoco", () => {
    expect(() => guionesDe([join(tmpdir(), "esto-no-existe-jamas-42")])).toThrowError(
      /no puede leer ningun guion/,
    );
  });

  it("guiones que no nombran ninguna base tampoco", () => {
    const carpeta = mkdtempSync(join(tmpdir(), "sin-bases-"));
    writeFileSync(join(carpeta, "mudo.sh"), "#!/usr/bin/env bash\necho hola\n");
    expect(() => referenciasABases(guionesDe([carpeta]))).toThrowError(/se cumpliria solo/);
  });

  /** Y el barrido de verdad tiene sujeto: los numeros de hoy, para que se vean moverse. */
  it("y el de verdad si midio", () => {
    expect(GUIONES.length, "el barrido lee menos guiones de los que hay").toBeGreaterThan(30);
    expect(REFERENCIAS.length, "el barrido encuentra muy pocas referencias").toBeGreaterThan(50);
  });

  /**
   * **Una muestra por forma, y esto es lo que la primera version de esta guarda no tenia.**
   *
   * Preguntado «que haria pasar en verde a esta guarda con el defecto puesto», la respuesta
   * fue: quitarle al barrido la forma `jdbc`. Medido — con las tres URL de Job devueltas a
   * `/sgtm` **y** el reconocedor de `jdbc` fuera, el archivo entero salia **`Tests 14 passed
   * (14)`**, verde, con el defecto exacto que existe para atrapar. Es la leccion de #32 con
   * las marcas del paquete: **medir la ausencia de un nombre no es medir la ausencia del
   * codigo**, y contar cuantas formas distintas aparecen en el arbol tampoco —quedaban
   * cuatro de cinco y el umbral seguia cumpliendose—.
   *
   * Se cierra con una muestra por forma: un guion de mentira que nombra una base que **no**
   * esta en el censo, escrito de esa forma y solo de esa. Si el barrido deja de reconocer
   * una, su muestra no aparece y esto se pone rojo nombrandola. Es el trato que
   * `comun-verificaciones` le da a sus reglas: una regla sin muestra que la viole no
   * protege nada.
   */
  it.each([
    ["--dbname", 'psql --dbname=base_de_la_muestra --command "SELECT 1"'],
    ["-d", 'psql -U postgres -d base_de_la_muestra -c "SELECT 1"'],
    ["PGDATABASE", 'PGDATABASE=base_de_la_muestra psql --command "SELECT 1"'],
    ["jdbc", "      value: jdbc:postgresql://kamayuk-stg-postgres:5432/base_de_la_muestra"],
    ["asignacion", "BASE_DE_LA_MUESTRA=base_de_la_muestra"],
  ])("el barrido reconoce la forma «%s»", (forma, linea) => {
    const carpeta = mkdtempSync(join(tmpdir(), `forma-${forma.replace(/\W/g, "")}-`));
    writeFileSync(join(carpeta, "muestra.sh"), `#!/usr/bin/env bash\n${linea}\n`);

    const halladas = referenciasABases(guionesDe([carpeta]));
    expect(
      halladas.map((r) => `${r.forma}:${r.base ?? "-"}`),
      `el barrido dejo de reconocer «${forma}». No se pone rojo por ello: deja de VER esa ` +
        "forma, y un guion escrito asi contra una base que no existe pasaria en verde — que " +
        "es exactamente como `E` se llevo tres Jobs apuntando a `sgtm` con un `grep` de " +
        "`--dbname=sgtm` en verde",
    ).toContain(`${forma}:base_de_la_muestra`);
  });
});
