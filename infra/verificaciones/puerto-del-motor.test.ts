import { execFileSync, spawn } from "node:child_process";
import { createServer, type Server } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El puerto del motor de verificacion se pide; no se fija (#731).
 *
 * `lib-motor-local.sh` nombra su contenedor con el PID —`sgtm-motor-verificacion-$$`—,
 * asi que el NOMBRE no puede chocar nunca. El puerto del anfitrion era una CONSTANTE por
 * guion: 55432, 55434 y 55433. Esa asimetria es el defecto, y se cobro una corrida real:
 * el trabajo `motor` de `infra.yml` levanta TRES motores seguidos desde que #435 metio la
 * rotacion en CI, DOS de ellos pedian el mismo 55434, y `docker rm --force` vuelve antes
 * de que el demonio suelte el puerto.
 *
 * Lo que hace caro al defecto es que **el sintoma no se parece a su causa**: con el
 * nombre unico por PID el choque no puede salir como «ya existe un contenedor con ese
 * nombre» —que se entiende— sino como `address already in use`, que manda a buscar fuera
 * del propio trabajo. Y es intermitente por construccion, o sea que pasa en verde la
 * mayoria de las veces.
 *
 * **Estas pruebas EJECUTAN `puerto.sh`**, no lo leen. Es la razon de que ese archivo
 * exista aparte: sourcear `lib-motor-local.sh` entera exige un manifiesto y una corrida
 * de `yarn manifiestos`, y ahi no habria forma de ejercitar esto sin Docker. Lo unico
 * que se lee son las ausencias —que ningun guion vuelva a fijar un puerto—, porque una
 * ausencia no se puede ejecutar.
 */

const RAIZ = join(__dirname, "..");
const PUERTO_SH = join(RAIZ, "verificaciones/motor/puerto.sh");

/** Correr una funcion de `puerto.sh` de verdad, en un bash con `set -u`. */
function enBash(guion: string): { salida: string; codigo: number } {
  try {
    const salida = execFileSync(
      "bash",
      ["-c", `set -u; source ${JSON.stringify(PUERTO_SH)}\n${guion}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { salida: salida.trim(), codigo: 0 };
  } catch (fallo) {
    const error = fallo as { status?: number; stdout?: string };
    return { salida: (error.stdout ?? "").trim(), codigo: error.status ?? -1 };
  }
}

/** Un proceso que ocupa un puerto de verdad, para poder soltarlo cuando toque. */
function ocupar(puerto: number): Promise<Server> {
  const servidor = createServer();
  return new Promise((listo, falla) => {
    servidor.once("error", falla);
    servidor.listen(puerto, "127.0.0.1", () => listo(servidor));
  });
}

describe("#731 — el puerto del motor se pide al sistema, no se fija", () => {
  it("pide un puerto libre, y dos corridas seguidas no piden el mismo", () => {
    const primero = enBash("motor_puerto_libre");
    const segundo = enBash("motor_puerto_libre");

    expect(primero.codigo, "pedir un puerto no puede fallar").toBe(0);
    expect(Number(primero.salida)).toBeGreaterThan(1024);
    expect(
      segundo.salida,
      "si dos corridas piden el mismo, el defecto sigue ahi: era una constante",
    ).not.toBe(primero.salida);
  });

  it("dice que un puerto ocupado NO esta libre, y que uno libre si", async () => {
    const puerto = Number(enBash("motor_puerto_libre").salida);

    expect(
      enBash(`motor_puerto_esta_libre ${puerto}`).codigo,
      "recien pedido, tiene que estar libre",
    ).toBe(0);

    const servidor = await ocupar(puerto);
    try {
      expect(
        enBash(`motor_puerto_esta_libre ${puerto}`).codigo,
        "con alguien escuchando, decir «libre» es exactamente el defecto de #731",
      ).not.toBe(0);
    } finally {
      await new Promise((listo) => servidor.close(listo));
    }
  });

  it("la espera vuelve cuando el puerto se suelta de verdad", async () => {
    const puerto = Number(enBash("motor_puerto_libre").salida);

    // El puerto lo sostiene OTRO PROCESO, y no un servidor de esta prueba. No es un
    // detalle: `enBash` usa `execFileSync`, que bloquea el bucle de eventos, asi que un
    // `setTimeout` de aqui para soltarlo NO LLEGA A CORRER — la primera version de esta
    // prueba fallaba por eso, con la espera agotando sus veinte intentos sobre un puerto
    // que nadie iba a soltar. Ademas es mas fiel: en produccion quien lo suelta es el
    // demonio de Docker, que tambien es otro proceso.
    const duenio = spawn(process.execPath, [
      "-e",
      `const s=require('net').createServer();
       s.listen(${puerto},'127.0.0.1',()=>setTimeout(()=>s.close(()=>process.exit(0)),2500));`,
    ]);
    await new Promise((listo) => setTimeout(listo, 500));

    const empezo = Date.now();
    const espera = enBash(`motor_esperar_puerto_libre ${puerto} 20`);
    const tardo = Date.now() - empezo;
    duenio.kill();

    expect(espera.codigo, "el puerto acaba libre, asi que la espera tiene que volver bien").toBe(0);
    expect(
      tardo,
      "y no puede volver antes de que se suelte: seria decir que esta libre cuando no",
    ).toBeGreaterThanOrEqual(2000);
  });

  it("EL CONTRASTE: si nunca se suelta, la espera falla en vez de mentir", async () => {
    const puerto = Number(enBash("motor_puerto_libre").salida);
    const servidor = await ocupar(puerto);
    try {
      const espera = enBash(`motor_esperar_puerto_libre ${puerto} 2`);

      expect(
        espera.codigo,
        "sin esto, `motor_esperar_puerto_libre` podria devolver 0 siempre y las tres" +
          " pruebas de arriba seguirian en verde",
      ).not.toBe(0);
    } finally {
      await new Promise((listo) => servidor.close(listo));
    }
  });
});

describe("#731 — ningun guion vuelve a fijar un puerto", () => {
  const GUIONES = [
    "verificaciones/motor/verificar-el-motor.sh",
    "secretos/verificar-rotacion.sh",
    "respaldo/simulacro-de-restauracion.sh",
  ];

  it.each(GUIONES)("%s no declara un puerto por omision", (guion) => {
    const fuente = readFileSync(join(RAIZ, guion), "utf8");

    expect(
      fuente,
      `${guion}: un puerto fijo es un choque esperando su turno. Lo pide lib-motor-local.sh`,
    ).not.toMatch(/^\s*PUERTO=/m);
  });

  it("hay UNA variable para imponer el puerto, no dos con dos valores distintos", () => {
    // `KAMAYUK_PUERTO_MOTOR` la leian dos guiones con dos valores por omision distintos
    // —55432 y 55434—, de modo que fijarla para uno se la fijaba al otro con otro
    // sentido; y el simulacro tenia ademas su propio `KAMAYUK_PUERTO_SIMULACRO`.
    const todos = GUIONES.concat([
      "verificaciones/motor/lib-motor-local.sh",
      "verificaciones/motor/puerto.sh",
    ])
      .map((guion) => readFileSync(join(RAIZ, guion), "utf8"))
      .join("\n");

    expect(todos, "dos nombres para lo mismo divergen").not.toContain("KAMAYUK_PUERTO_SIMULACRO");
    expect(
      // La LECTURA, no la mencion: los javadoc la nombran a proposito para explicar que
      // existe, y contar eso convertiria la guarda en una prohibicion de documentar.
      todos.match(/\$\{KAMAYUK_PUERTO_MOTOR/g) ?? [],
      "y el que queda se lee en un solo sitio: la biblioteca",
    ).toHaveLength(1);
  });

  it("EL CONTRASTE de #731: el aislamiento sigue pudiendo ponerse rojo por lo suyo", () => {
    // Arreglar el puerto no puede convertirse en un `|| true`. Lo unico que gana un
    // `|| true` con este cambio es la ESPERA del `motor_detener`, que corre cuando ya
    // no queda nada que comprobar; la prueba de aislamiento sigue decidiendo el codigo
    // de salida del guion. No se puede ejecutar aqui —necesita Docker y una corrida de
    // Gradle—, asi que se lee: es una ausencia, y una ausencia no se ejecuta.
    const guion = readFileSync(join(RAIZ, "verificaciones/motor/verificar-el-motor.sh"), "utf8");
    const aislamiento = guion.slice(guion.indexOf("./gradlew verificarAislamiento"));

    expect(
      aislamiento.slice(0, aislamiento.indexOf("\n\n")),
      "si el aislamiento deja de decidir el codigo de salida, este trabajo deja de medir" +
        " lo unico que solo el mide (#149)",
    ).toContain("exit 1");
  });

  it("detener el motor espera a que el puerto quede libre", () => {
    // `docker rm --force` vuelve antes de que el demonio lo suelte, y
    // `simulacro-de-restauracion.sh` detiene y vuelve a arrancar sobre EL MISMO puerto
    // a proposito (#155): ahi la espera es parte del procedimiento, no una precaucion.
    const biblioteca = readFileSync(join(RAIZ, "verificaciones/motor/lib-motor-local.sh"), "utf8");
    const detener = biblioteca.slice(biblioteca.indexOf("motor_detener() {"));

    expect(detener.slice(0, detener.indexOf("\n}"))).toContain("motor_esperar_puerto_libre");
  });
});
