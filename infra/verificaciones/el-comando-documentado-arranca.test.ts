/**
 * Dos comandos documentados que **no podian funcionar como estaban escritos** (#74).
 *
 * ## 1 · El compose de los cinco sistemas no ve el `.env` de la plataforma
 *
 * Los cinco interpolan `${KAMAYUK_CLAVE_*:?}` «del `.env` de la plataforma», y Compose busca
 * `.env` en el directorio del PROYECTO —el del propio archivo compose—, donde no hay ninguno.
 * Medido el 2026-09-13 con Docker 29.1.3:
 *
 * | comando | salida |
 * |---|---|
 * | `docker compose -f despliegue/compose.yaml config` | **1**, «required variable KAMAYUK_CLAVE_APP is missing a value» |
 * | el mismo con `--env-file ../infrastructure/despliegue/.env` | **0** |
 *
 * **Y `env_file:` no lo sustituye, que es lo que hubo que medir antes de escribir nada**: el
 * issue lo proponia como el arreglo «por construccion», y alimenta el entorno del CONTENEDOR,
 * no la interpolacion — con `env_file` declarado, el mismo `config` vuelve a salir **1** con el
 * error identico. Un enlace `.env` junto al compose **si** funcionaria (medido, exit 0), pero
 * `.env` esta en `.gitignore` en los seis repositorios y des-ignorarlo para poder versionar un
 * enlace es como se acaban subiendo credenciales.
 *
 * Asi que lo unico que queda es que el comando escrito sea el que funciona — y esta guarda es lo
 * que impide que vuelva a no serlo.
 *
 * ## 2 · Los dos guiones de Keycloak no encuentran el compose
 *
 * `crear-usuario.sh` y `reconciliar-identidades.sh` llaman a `docker compose exec` **sin `-f`**.
 * Compose busca `compose.yaml` y `docker-compose.yml`; el de la plataforma se llama
 * `plataforma.compose.yaml`. Medido desde el directorio que los guiones suponen: **1**, «no
 * configuration file provided: not found»; con `COMPOSE_FILE=plataforma.compose.yaml`, **0**.
 *
 * ## Lo que esta guarda NO comprueba
 *
 * Que el comando arranque de verdad. Eso pide un demonio de Docker y el `.env` real; lo medido
 * a mano esta arriba. Lo que se fija aqui es que **lo escrito y lo que funciona sean lo mismo**.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { raizDelRepositorio } from "../componentes/fuentes";
import { SISTEMAS, clonDe } from "./deriva-de-migraciones";

const ENV_DE_LA_PLATAFORMA = "--env-file";
/** Los dos guiones que hablan con Keycloak por `docker compose exec`. */
const GUIONES = ["crear-usuario.sh", "reconciliar-identidades.sh"] as const;

interface Invocacion {
  readonly donde: string;
  readonly linea: string;
}

/** Cada linea de los seis arboles que invoca el compose de un SISTEMA. */
function invocacionesDelCompose(): Invocacion[] {
  const encontradas: Invocacion[] = [];
  for (const sistema of SISTEMAS) {
    const raiz = clonDe(sistema);
    for (const ruta of ["despliegue/compose.yaml", "docs/D0-desarrollo/README.md"]) {
      let texto: string;
      try {
        texto = readFileSync(join(raiz, ruta), "utf8");
      } catch {
        continue; // no todos documentan el comando en su D0, y es correcto
      }
      texto.split("\n").forEach((linea, i) => {
        if (!linea.includes("compose -f despliegue/compose.yaml")) return;
        encontradas.push({ donde: `${sistema.clon}/${ruta}:${i + 1}`, linea: linea.trim() });
      });
    }
  }
  return encontradas;
}

describe("#74 - el comando documentado es el que arranca", () => {
  it("EL CENTINELA: se encontraron invocaciones que mirar", () => {
    // Si los archivos se renombran o el clon falta, la comprobacion de abajo recorreria una
    // lista vacia y pasaria en verde sin haber leido nada.
    expect(
      invocacionesDelCompose().length,
      "no se encontro ni una invocacion del compose de un sistema: esto no mide nada",
    ).toBeGreaterThanOrEqual(5);
  });

  it("ninguna invocacion documentada omite el `.env` de la plataforma", () => {
    const sinEnv = invocacionesDelCompose()
      .filter((i) => !i.linea.includes(ENV_DE_LA_PLATAFORMA))
      // Una invocacion partida en dos lineas lleva el `--env-file` en la siguiente; se
      // reconoce por la barra de continuacion.
      .filter((i) => !i.linea.endsWith("\\"))
      .map((i) => `${i.donde}\n      ${i.linea}`);
    expect(
      sinEnv,
      "[este comando NO ARRANCA como esta escrito: el compose interpola `${KAMAYUK_CLAVE_*:?}` " +
        "del `.env` de la plataforma, y Compose busca `.env` junto al propio archivo, donde no " +
        "hay ninguno. Medido: sale 1 con «required variable KAMAYUK_CLAVE_APP is missing a " +
        "value». Remedio: `--env-file ../infrastructure/despliegue/.env`. Y NO sirve declarar " +
        "`env_file:`, que se probo: alimenta el contenedor, no la interpolacion.]",
    ).toEqual([]);
  });

  it("los dos guiones de Keycloak saben como se llama el compose de la plataforma", () => {
    for (const guion of GUIONES) {
      const texto = readFileSync(
        join(raizDelRepositorio(), "despliegue/identidad", guion),
        "utf8",
      );
      expect(
        texto,
        `«${guion}» llama a \`docker compose exec\` sin \`-f\` y sin fijar \`COMPOSE_FILE\`. ` +
          "Compose busca `compose.yaml` y `docker-compose.yml`; el de la plataforma se llama " +
          "`plataforma.compose.yaml`, asi que el guion muere con «no configuration file " +
          "provided: not found» — y ese mensaje no dice que falte un nombre, dice que falta un " +
          "archivo.",
      ).toContain("COMPOSE_FILE:=plataforma.compose.yaml");
    }
  });
});
