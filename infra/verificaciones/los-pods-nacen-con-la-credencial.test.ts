import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nombreDelSecretoDeRegistro } from "../componentes/convenciones";
import { conCredencialDeRegistro } from "../componentes/credencial-de-registro";
import type { Deployment, Manifiesto, Service } from "../componentes/tipos";
import { ENVIRONMENTS, type Environment } from "../config";
import { namespacesDelAmbiente } from "../descriptor/entorno";
import { manifiestosDelAmbiente } from "../herramientas/emitir-manifiestos";
import {
  cargasConImagenDelProducto,
  enBlanco,
  espaciosConCredencialDeRegistro,
} from "./imagenes-publicadas";
import { invariantesDe } from "./stacks";

/**
 * #166 — todo pod del ambiente NACE con la credencial del registro, sin esperar a ningun parche.
 *
 * **El defecto, medido en `stg` el 2026-09-13** sobre un cluster vacio: los pods se crearon de
 * 14:24:15Z a 14:25:00Z con `spec.imagePullSecrets` vacio, y el `ServiceAccountPatch` que les iba
 * a dar la credencial llego a las 14:26:52Z. El controlador de admision copia la credencial de la
 * cuenta al pod SOLO al admitirlo, asi que `identidad` —el unico paquete privado— se quedo en
 * `ImagePullBackOff` con `failed to fetch anonymous token`, y detras las implantaciones de tres
 * sistemas. Hasta hoy no habia guarda que lo viera, porque el manifiesto era correcto: fallaba el
 * ORDEN en que llegaba al cluster.
 *
 * Desde #166 el nombre del `Secret` va dentro de cada plantilla (`conCredencialDeRegistro`), y con
 * eso el orden deja de importar —medido en un k3s desechable: `componentes/credencial-de-registro.ts`—.
 * Esta guarda es la que impide que eso se pierda en silencio.
 *
 * **Barre por FORMA y no por `kind`.** Una plantilla de pod es cualquier objeto con un array
 * `containers`, este donde este del manifiesto. Si barriera `Deployment`, `Job` y `CronJob` por
 * nombre compartiria el punto ciego de la funcion que vigila: un `kind` nuevo con pods —un
 * `StatefulSet`, un `DaemonSet`— que la funcion no conociera tampoco lo conoceria la guarda, y las
 * dos pasarian en verde sobre el pod que no arranca.
 *
 * **Y sobre `manifiestosDelAmbiente()`**, que es exactamente lo que `index.ts` pasa como `objs` al
 * `ConfigGroup` (lo ata `lo-que-pulumi-aplica.test.ts`). No sobre una transformacion de Pulumi: se
 * midio que las `transformations` de ese `ConfigGroup` no alcanzan a sus hijos, y una guarda sobre
 * una funcion que Pulumi no aplica estaria verde sobre un cluster sin credencial.
 */

interface PlantillaDePodHallada {
  kind: string;
  espacio: string;
  nombre: string;
  /** Donde esta la plantilla dentro del manifiesto, para que el rojo diga a donde ir. */
  ruta: string;
  secretos: string[];
}

function plantillasDePod(manifiestos: readonly Manifiesto[]): PlantillaDePodHallada[] {
  const halladas: PlantillaDePodHallada[] = [];
  for (const m of manifiestos) {
    const visitar = (nodo: unknown, ruta: string): void => {
      if (nodo === null || typeof nodo !== "object") return;
      if (Array.isArray(nodo)) {
        nodo.forEach((hijo, i) => visitar(hijo, `${ruta}[${String(i)}]`));
        return;
      }
      const objeto = nodo as Record<string, unknown>;
      if (Array.isArray(objeto["containers"])) {
        const secretos = Array.isArray(objeto["imagePullSecrets"])
          ? (objeto["imagePullSecrets"] as { name?: unknown }[]).map((s) => String(s.name))
          : [];
        halladas.push({
          kind: m.kind,
          espacio: m.metadata.namespace ?? "(cluster)",
          nombre: m.metadata.name,
          ruta: ruta === "" ? "(raiz)" : ruta.slice(1),
          secretos,
        });
      }
      for (const [clave, valor] of Object.entries(objeto)) visitar(valor, `${ruta}.${clave}`);
    };
    visitar(m, "");
  }
  return halladas;
}

const plantillasDe = (ambiente: Environment): PlantillaDePodHallada[] =>
  plantillasDePod(manifiestosDelAmbiente(invariantesDe(ambiente)));

const describir = (p: PlantillaDePodHallada): string =>
  `${p.kind} ${p.espacio}/${p.nombre} (${p.ruta}): imagePullSecrets=[${p.secretos.join(", ")}]`;

describe("#166 · los pods nacen con la credencial del registro", () => {
  /**
   * El sujeto, antes que la afirmacion. «Toda plantilla lleva la credencial» es cierto sobre el
   * conjunto vacio, y un barrido que dejara de encontrar plantillas —un emisor que cambia de
   * forma, un recorrido roto— la dejaria en verde sin mirar nada (C-15/C-16).
   *
   * Sin cifra escrita a proposito: el censo exacto de cargas del producto ya lo fija
   * `imagenes-publicadas.test.ts`, con su motivo, y una segunda cifra que tocar con cada carga
   * nueva seria una segunda cuenta que se separa. Lo que se exige aqui es que el barrido vea AL
   * MENOS esas cargas, los tres `kind` que hoy llevan pods y los seis espacios del ambiente.
   * Medido el 2026-09-13: **35** plantillas en `stg` (17 `Deployment`, 11 `Job`, 7 `CronJob`) y
   * **34** en `prod`, que no despliega el correo de pruebas (`Deployment/kamayuk-stg-correo`).
   */
  it.each(ENVIRONMENTS)("«%s»: el barrido tiene sujeto", (ambiente) => {
    const plantillas = plantillasDe(ambiente);
    const cargas = cargasConImagenDelProducto(ambiente);
    expect(cargas.length, "el censo de cargas del producto salio vacio").toBeGreaterThan(0);
    expect(
      plantillas.length,
      `el barrido encontro ${String(plantillas.length)} plantillas de pod y el censo de ` +
        `\`imagenes-publicadas\` cuenta ${String(cargas.length)} cargas que traen una imagen del ` +
        "producto: el barrido no esta viendo lo que el ambiente despliega.",
    ).toBeGreaterThanOrEqual(cargas.length);
    expect(new Set(plantillas.map((p) => p.kind))).toEqual(new Set(["Deployment", "Job", "CronJob"]));
    expect([...new Set(plantillas.map((p) => p.espacio))].sort()).toEqual(
      [...namespacesDelAmbiente(ambiente)].sort(),
    );
  });

  it.each(ENVIRONMENTS)(
    "«%s»: TODA plantilla de pod nombra el `Secret` del registro de su ambiente",
    (ambiente) => {
      const nombre = nombreDelSecretoDeRegistro(ambiente);
      const sinCredencial = plantillasDe(ambiente).filter((p) => !p.secretos.includes(nombre));
      expect(
        sinCredencial.map(describir),
        `estas plantillas de pod de «${ambiente}» no llevan \`imagePullSecrets: [{ name: ` +
          `${nombre} }]\`:\n  ${sinCredencial.map(describir).join("\n  ")}\n` +
          "  Sin el, un pod solo recibe la credencial si el `ServiceAccountPatch` de `index.ts` " +
          "llego ANTES que el: el controlador de admision la copia al crear el pod y nunca despues. " +
          "En un cluster vacio los pods llegan primero —medido en `stg` el 2026-09-13: pods de " +
          "14:24:15Z a 14:25:00Z, parche a las 14:26:52Z— y el paquete privado se queda en " +
          "`ImagePullBackOff` con `failed to fetch anonymous token` (#166).\n" +
          "  Remedio: que `manifiestosDelAmbiente()` pase TODO lo que emite por " +
          "`conCredencialDeRegistro()`, y que esa funcion conozca el `kind` que aqui se nombra. " +
          "No en las `transformations` del `ConfigGroup`: no alcanzan a sus hijos.",
      ).toEqual([]);
    },
  );

  /**
   * Y el contraste de ambiente: el `Secret` es de cada espacio de nombres y se llama distinto en
   * cada ambiente. Una plantilla de `prod` que nombrara el de `stg` pediria uno que no existe y el
   * kubelet bajaria la imagen sin credencial, que es el mismo rojo que no se veria en ningun sitio.
   */
  it.each(ENVIRONMENTS)("«%s»: ninguna nombra el `Secret` del ambiente hermano", (ambiente) => {
    const otro = ENVIRONMENTS.find((a) => a !== ambiente)!;
    const delHermano = nombreDelSecretoDeRegistro(otro);
    expect(delHermano).not.toBe(nombreDelSecretoDeRegistro(ambiente));
    expect(
      plantillasDe(ambiente).filter((p) => p.secretos.includes(delHermano)).map(describir),
    ).toEqual([]);
  });

  /**
   * Nombrar el `Secret` no basta: tiene que EXISTIR en el espacio del pod. Lo crea `index.ts` en
   * los espacios que devuelve `espaciosConCredencialDeRegistro()` —que lee su bucle y ejecuta la
   * derivacion—, y una plantilla que viviera fuera de ellos lo nombraria en vano.
   */
  it.each(ENVIRONMENTS)("«%s»: y el `Secret` que nombran existe en su espacio", (ambiente) => {
    const conSecreto = new Set(espaciosConCredencialDeRegistro(ambiente));
    const fuera = plantillasDe(ambiente).filter((p) => !conSecreto.has(p.espacio));
    expect(
      fuera.map(describir),
      "estas plantillas viven en un espacio de nombres donde `index.ts` no crea el `Secret` del " +
        `registro (lo crea en: ${[...conSecreto].join(", ")}), asi que su \`imagePullSecrets\` ` +
        "apunta a nada.",
    ).toEqual([]);
  });

  /**
   * Y los dos lectores del nombre son la misma funcion. `index.ts` es el programa de Pulumi y no
   * se puede importar sin desplegar, asi que se lee su fuente, con comentarios y literales en
   * blanco: su docblock escribe esta misma llamada para explicarla, y una comprobacion que se
   * cumpliera con la prosa seria la que alguien apaga borrando el comentario.
   */
  it("`index.ts` llama al `Secret` con `nombreDelSecretoDeRegistro(env)`, el nombre que llevan los pods", () => {
    const fuente = readFileSync(join(__dirname, "..", "index.ts"), "utf8");
    expect(
      enBlanco(fuente, true),
      "el `metadata.name` del `Secret` del registro en `index.ts` no sale de " +
        "`nombreDelSecretoDeRegistro(env)`: si se separa del nombre que ponen las plantillas, " +
        "cada pod pide un `Secret` que no existe.",
    ).toMatch(/\bname:\s*nombreDelSecretoDeRegistro\(env\)/);
  });

  /**
   * Y el valor NO: el `Secret` es un recurso de Pulumi, cifrado en su estado, y `yarn manifiestos`
   * imprime, compara y guarda su salida. Lo que viaja en los manifiestos es el nombre.
   */
  it.each(ENVIRONMENTS)("«%s»: los manifiestos llevan el nombre y no el token", (ambiente) => {
    const manifiestos = manifiestosDelAmbiente(invariantesDe(ambiente));
    expect(manifiestos.filter((m) => (m.kind as string) === "Secret")).toEqual([]);
    expect(JSON.stringify(manifiestos)).not.toContain("dockerconfigjson");
    expect(JSON.stringify(manifiestos)).toContain(nombreDelSecretoDeRegistro(ambiente));
  });
});

describe("#166 · `conCredencialDeRegistro`, la funcion", () => {
  const deployment = (secretos?: { name: string }[]): Deployment => ({
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "web", namespace: "kamayuk-stg" },
    spec: {
      replicas: 1,
      strategy: { type: "Recreate" },
      selector: { matchLabels: { app: "web" } },
      template: {
        metadata: { labels: { app: "web" } },
        spec: {
          priorityClassName: "p",
          containers: [
            {
              name: "c",
              image: "ghcr.io/hneyra/x:1",
              resources: {
                requests: { cpu: "10m", memory: "16Mi" },
                limits: { cpu: "10m", memory: "16Mi" },
              },
            },
          ],
          ...(secretos === undefined ? {} : { imagePullSecrets: secretos }),
        },
      },
    },
  });
  const servicio: Service = {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name: "web", namespace: "kamayuk-stg" },
    spec: { type: "ClusterIP", selector: { app: "web" }, ports: [{ name: "http", port: 80, targetPort: 80 }] },
  };
  const secretosDe = (m: Manifiesto): unknown =>
    (m as Deployment).spec.template.spec.imagePullSecrets;

  it("no modifica lo que recibe: `stg` y `prod` sobre el mismo objeto no se contaminan", () => {
    const original = deployment();
    const copia = JSON.stringify(original);
    const [deStg] = conCredencialDeRegistro([original], "stg");
    const [deProd] = conCredencialDeRegistro([original], "prod");
    expect(JSON.stringify(original)).toBe(copia);
    expect(secretosDe(deStg!)).toEqual([{ name: nombreDelSecretoDeRegistro("stg") }]);
    expect(secretosDe(deProd!)).toEqual([{ name: nombreDelSecretoDeRegistro("prod") }]);
  });

  it("es idempotente y respeta los que la plantilla ya traiga", () => {
    const nombre = nombreDelSecretoDeRegistro("stg");
    const dos = conCredencialDeRegistro(conCredencialDeRegistro([deployment()], "stg"), "stg");
    expect(secretosDe(dos[0]!)).toEqual([{ name: nombre }]);
    const conOtro = conCredencialDeRegistro([deployment([{ name: "otro" }])], "stg");
    expect(secretosDe(conOtro[0]!)).toEqual([{ name: "otro" }, { name: nombre }]);
  });

  it("deja intacto lo que no lleva pods", () => {
    expect(conCredencialDeRegistro([servicio], "stg")[0]).toBe(servicio);
  });
});
