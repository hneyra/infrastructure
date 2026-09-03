import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * La reserva del nodo se reparte entre las dos partidas; no se escribe entera en cada
 * una.
 *
 * `system-reserved` y `kube-reserved` son dos descuentos DISTINTOS que kubelet **suma**
 * para calcular lo asignable. Escribir `cpu=1` en las dos no reserva 1 CPU: reserva 2.
 *
 * Esto no es una hipotesis. Es lo que le paso al nodo de `prod` el 2026-08-23, y esta
 * medido en `INF-10` §4: «CPU 4 → asignable 2; memoria 8 126 500 Ki → asignable
 * 6 029 348 Ki. La diferencia es 2 097 152 Ki = 2 Gi exactos, y 2 CPU». `INF-01` §2
 * dimensiona ~1 CPU y ~1 GB; el nodo perdio el doble, se quedo con **2 de sus 4 CPU
 * repartibles**, y desde ese dia no pudo ubicar su propio stack: `aplicar-prod` se
 * colgo cuatro veces entre el 25 y el 26 de agosto de 2026, una casi seis horas,
 * esperando pods que nunca podrian programarse (issue #252).
 *
 * Lo que hace peligroso a este defecto es que **no se ve en el guion**: las dos lineas
 * son correctas por separado, dicen el numero que la documentacion dice, y solo estan
 * mal juntas. Por eso la comprobacion es sobre la SUMA.
 *
 * Y no se lee el guion: se **ejecuta**, en su modo `--solo-configuracion`, sobre un
 * archivo de mentira. Un `grep` sobre el fuente afirmaria lo que el guion dice; esto
 * comprueba lo que el guion hace, que es lo que acaba en `/etc/rancher/k3s/config.yaml`.
 */

const GUION = join(import.meta.dirname, "..", "vps", "reservar-recursos-del-nodo.sh");

/** Lo que `INF-01` §2 dimensiona, y el unico numero que esta prueba defiende. */
const TOTAL_DIMENSIONADO = { cpuEnMili: 1000, memoriaEnMi: 2048 };

/** Corre el guion sobre un `config.yaml` de mentira y devuelve como queda. */
function correr(contenidoPrevio: string | undefined): {
  codigo: number;
  salida: string;
  config: string;
  respaldos: number;
} {
  const carpeta = mkdtempSync(join(tmpdir(), "reserva-"));
  const config = join(carpeta, "config.yaml");
  writeFileSync(config, contenidoPrevio ?? "");

  let codigo = 0;
  let salida = "";
  try {
    salida = execFileSync("bash", [GUION, "--solo-configuracion"], {
      env: { ...process.env, SGTM_CONFIG_K3S: config },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const fallo = error as { status?: number; stdout?: string; stderr?: string };
    codigo = fallo.status ?? 1;
    salida = `${fallo.stdout ?? ""}${fallo.stderr ?? ""}`;
  }

  return {
    codigo,
    salida,
    config: readFileSync(config, "utf8"),
    respaldos: readdirSync(carpeta).filter((f) => f.endsWith(".bak")).length,
  };
}

/** Las dos partidas que el archivo declara, en milicores y mebibytes. */
function partidasDe(config: string): { cpuEnMili: number; memoriaEnMi: number }[] {
  const lineas = [...config.matchAll(/(system|kube)-reserved=cpu=([^,]+),memory=(\S+?)"/g)];
  return lineas.map((l) => {
    const cpu = l[2] ?? "";
    const memoria = l[3] ?? "";
    return {
      cpuEnMili: cpu.endsWith("m") ? Number(cpu.slice(0, -1)) : Number(cpu) * 1000,
      memoriaEnMi: memoria.endsWith("Gi")
        ? Number(memoria.slice(0, -2)) * 1024
        : Number(memoria.replace("Mi", "")),
    };
  });
}

function sumaDe(config: string): { cpuEnMili: number; memoriaEnMi: number } {
  return partidasDe(config).reduce(
    (a, p) => ({
      cpuEnMili: a.cpuEnMili + p.cpuEnMili,
      memoriaEnMi: a.memoriaEnMi + p.memoriaEnMi,
    }),
    { cpuEnMili: 0, memoriaEnMi: 0 },
  );
}

/** El nodo de `prod` (`INF-10` §4): 4 CPU y 8 126 500 Ki de capacidad. */
const CAPACIDAD_DE_PROD = { cpuEnMili: 4000, memoriaEnMi: 8126500 / 1024 };

describe("la reserva del nodo suma lo dimensionado, no el doble", () => {
  it("un nodo virgen queda con las dos partidas sumando 1 CPU y 2 Gi", () => {
    const resultado = correr(undefined);

    expect(resultado.codigo).toBe(0);
    // Las dos partidas existen -si faltara una, la suma cuadraria por el motivo
    // equivocado- y juntas son lo que INF-01 §2 dimensiona.
    expect(partidasDe(resultado.config)).toHaveLength(2);
    expect(sumaDe(resultado.config)).toEqual(TOTAL_DIMENSIONADO);
  });

  /**
   * La cuenta que importa, y la que nadie hizo en agosto de 2026: con esta reserva,
   * ¿cuanto reparte el nodo de `prod`?
   */
  it("sobre el nodo de prod, deja 3 CPU asignables y no 2, con la memoria intacta", () => {
    const suma = sumaDe(correr(undefined).config);

    // Lo que la correccion devuelve: una CPU entera de las dos que la duplicacion se
    // habia llevado.
    expect(CAPACIDAD_DE_PROD.cpuEnMili - suma.cpuEnMili).toBe(3000);

    // Y lo que NO cambia. La memoria asignable sigue siendo la medida en `INF-10` §4
    // —6 029 348 Ki, ~5,75 Gi, los «6 GB libres» del nodo—: es el presupuesto con que
    // `Pulumi.prod.yaml` dimensiona el stack, y bajar esta reserva lo habria inflado
    // con memoria que el sistema ya esta usando.
    expect(Math.round(CAPACIDAD_DE_PROD.memoriaEnMi - suma.memoriaEnMi)).toBe(
      Math.round(6029348 / 1024),
    );
  });

  it("corrige la reserva duplicada que hay hoy en el nodo de prod, y guarda copia", () => {
    // Literalmente lo que `reservar-recursos-del-nodo.sh` dejo en `vmd120205` el
    // 2026-08-23, con una linea de al lado para comprobar que no se la lleva por
    // delante.
    const resultado = correr(
      [
        'write-kubeconfig-mode: "0644"',
        "",
        "# Reserva del nodo para kubelet, containerd y el sistema operativo (INF-01 §2 y",
        "# §4, issue #157). Escrito por infra/vps/reservar-recursos-del-nodo.sh -no a",
        "# mano-, para que quede claro de donde salio si alguien lo encuentra despues.",
        "kubelet-arg:",
        '  - "system-reserved=cpu=1,memory=1Gi"',
        '  - "kube-reserved=cpu=1,memory=1Gi"',
        "",
      ].join("\n"),
    );

    expect(resultado.codigo).toBe(0);
    expect(sumaDe(resultado.config)).toEqual(TOTAL_DIMENSIONADO);
    // El resto del archivo sigue ahi: se sustituyen dos lineas, no el archivo.
    expect(resultado.config).toContain('write-kubeconfig-mode: "0644"');
    // Y queda de donde volver: es una configuracion de la que solo hay una copia.
    expect(resultado.respaldos).toBe(1);
  });

  it("volver a correrlo no cambia nada ni reinicia k3s", () => {
    const yaCorregido = correr(undefined).config;
    const resultado = correr(yaCorregido);

    expect(resultado.codigo).toBe(0);
    expect(resultado.config).toBe(yaCorregido);
    // Ningun respaldo: no se toco el archivo, asi que no habia de que hacer copia.
    expect(resultado.respaldos).toBe(0);
    expect(resultado.salida).toContain("No se toca nada");
  });

  it("un kubelet-arg que escribio otro no se toca: se explica y se sale en rojo", () => {
    const ajeno = ['kubelet-arg:', '  - "max-pods=250"', ""].join("\n");
    const resultado = correr(ajeno);

    expect(resultado.codigo).toBe(1);
    expect(resultado.config).toBe(ajeno);
    expect(resultado.salida).toContain("NO lo escribio este guion");
  });
});

/**
 * Y se demuestra que puede fallar.
 *
 * Sin esto, la comprobacion de arriba podria estar leyendo un archivo que nunca
 * contradice: es exactamente el modo en que una verificacion se queda en verde para
 * siempre sin proteger nada. Aqui se le da a la misma funcion el archivo que el guion
 * producia ANTES de la correccion —el que dejo `prod` en 2 CPU— y se exige que lo
 * rechace.
 */
describe("y se demuestra que puede fallar", () => {
  it("la reserva duplicada que estuvo en produccion no pasa la comprobacion", () => {
    const duplicada = [
      "kubelet-arg:",
      '  - "system-reserved=cpu=1,memory=1Gi"',
      '  - "kube-reserved=cpu=1,memory=1Gi"',
    ].join("\n");

    const suma = sumaDe(duplicada);

    expect(suma).not.toEqual(TOTAL_DIMENSIONADO);
    // La memoria coincide con la dimensionada; es la CPU la que iba al doble. Por eso
    // la comprobacion es sobre las dos partidas y no sobre una: mirar solo la memoria
    // habria dado verde sobre el archivo que tumbo `prod`.
    expect(suma).toEqual({ cpuEnMili: 2000, memoriaEnMi: 2048 });
    // Y esta es la consecuencia, que es lo que de verdad se estaba pagando: el nodo
    // de prod repartiendo 2 de sus 4 CPU.
    expect(CAPACIDAD_DE_PROD.cpuEnMili - suma.cpuEnMili).toBe(2000);
  });
});
