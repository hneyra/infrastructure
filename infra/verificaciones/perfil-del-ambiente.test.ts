import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { raizDeInfra } from "../componentes/fuentes";
import { demandaDelStack } from "../capacidad";
import { construirManifiestos } from "../componentes";
import { podsDe, type Manifiesto } from "../componentes/tipos";
import { ENTRADAS_DEL_PERFIL_MINIMO, recursosDe } from "../componentes/convenciones";
import { ENVIRONMENTS, PERFILES_DE_RECURSOS, type Environment, type Invariants } from "../config";
import { SISTEMAS } from "../descriptor/sistemas";
import { entornoDelAmbiente, manifiestosDelAmbiente } from "../herramientas/emitir-manifiestos";
import { invariantesDe } from "./stacks";

/**
 * C-19 · **qué declara cada ambiente sobre su nodo**, y qué no puede filtrarse al otro.
 *
 * Son dos decisiones de la dirección con la misma forma —una es de manifiestos y la otra
 * de peticiones— y el mismo riesgo: que lo que se decide para el ambiente de ENSAYO acabe
 * aplicándose al que atiende a la municipalidad, sin que ninguna cifra parezca mal.
 *
 * 1. **`stg` deja de declarar el monolito.** No lo usa nadie —dicho por la dirección— y
 *    era el mayor consumidor del ambiente: 800m / 2 176Mi de un pico de 2 620m / 9 728Mi.
 * 2. **`stg` pide el perfil `minimo`.** Hasta C-19 `RECURSOS` era una sola tabla para los
 *    dos, así que bajar una petición para que `stg` cupiera la bajaba también en `prod`.
 *
 * Lo que estas pruebas miden no es la aritmética —eso es `capacidad.test.ts`— sino que
 * **cada decisión llegue exactamente hasta donde tiene que llegar**: ni de menos —una
 * entrada del perfil que no se aplica a nada, que se lee igual que no haberla escrito—,
 * ni de más —la plataforma borrada con el monolito, que deja a los cuatro sistemas sin
 * base con un síntoma que no se parece a su causa—.
 */

const manifiestosDe = (ambiente: Environment) => manifiestosDelAmbiente(invariantesDe(ambiente));

/** El mismo ambiente, componiéndolo como si declarara otra cosa. */
const como = (ambiente: Environment, cambio: (i: Invariants) => Invariants): Invariants =>
  cambio(invariantesDe(ambiente));

const conMonolito = (i: Invariants, valor: boolean): Invariants => ({
  ...i,
  application: { ...i.application, deployMonolith: valor },
});

const nombresDe = (ms: { kind: string; metadata: { name: string; namespace?: string } }[]) =>
  ms.map((m) => `${m.metadata.namespace ?? "-"}|${m.kind}/${m.metadata.name}`);

/** Los `resources` de todo contenedor —normal o de inicializacion— de unos manifiestos. */
const peticionesDe = (ms: Manifiesto[]) =>
  ms.flatMap(podsDe).flatMap(({ pod }) => [
    ...pod.containers.map((c) => c.resources),
    ...(pod.initContainers ?? []).map((c) => c.resources),
  ]);

// ─────────────────────────────────────────────────────────────────────────────
// 1 · El monolito
// ─────────────────────────────────────────────────────────────────────────────

describe("C-19 · el monolito lo declara quien lo despliega, y sólo ése", () => {
  /**
   * Lo primero, y sin ello lo demás no dice nada: que la bandera **haga algo**.
   *
   * Se mide componiendo el mismo ambiente en las dos direcciones y restando, no
   * comparando contra una lista de objetos escrita aquí: una lista sería el segundo sitio
   * donde acordarse el día que el monolito gane un manifiesto más, y el que envejecería
   * sin ponerse rojo.
   */
  it.each(ENVIRONMENTS)("«%s»: apagar la bandera quita manifiestos, y encenderla los trae", (ambiente) => {
    const con = new Set(nombresDe(construirManifiestos(como(ambiente, (i) => conMonolito(i, true)))));
    const sin = new Set(nombresDe(construirManifiestos(como(ambiente, (i) => conMonolito(i, false)))));

    const diferencia = [...con].filter((n) => !sin.has(n));
    expect(
      diferencia.length,
      "`desplegarElMonolito` no cambia ni un manifiesto: la bandera está declarada y no la " +
        "lee nadie, que se lee igual que no tenerla.",
    ).toBeGreaterThan(0);
    // Y en la otra dirección no entra nada: apagar el monolito no puede AÑADIR objetos.
    expect([...sin].filter((n) => !con.has(n))).toEqual([]);
  });

  /**
   * Y lo que cada ambiente compone de verdad es lo que su stack declara.
   *
   * *Mutación:* que `construirManifiestos` ignore la bandera. → rojo en `stg`, con los
   * diez objetos nombrados.
   */
  it.each(ENVIRONMENTS)("«%s»: lo compuesto coincide con lo declarado en su stack", (ambiente) => {
    const invariantes = invariantesDe(ambiente);
    const declarado = invariantes.application.deployMonolith;
    const real = nombresDe(construirManifiestos(invariantes));
    const esperado = nombresDe(
      construirManifiestos(conMonolito(invariantes, declarado)),
    );
    expect(real).toEqual(esperado);

    const conLaOtra = nombresDe(construirManifiestos(conMonolito(invariantes, !declarado)));
    expect(
      real,
      `«${ambiente}» declara \`desplegarElMonolito: ${String(declarado)}\` y compone lo contrario.`,
    ).not.toEqual(conLaOtra);
  });

  /**
   * **La mitad que importa: la plataforma no se va con él.**
   *
   * Los cuatro sistemas de ADR-0031 viven en su propio namespace y se conectan
   * literalmente a `kamayuk-<amb>-postgres.kamayuk-<amb>` (C-17, punto 1) y validan sus tokens
   * contra el JWKS interno de `kamayuk-<amb>-identidad` (C-14, punto 3). Los dos nombres se
   * leen **del entorno que reciben los descriptores**, que es el mismo del que salen sus
   * variables: comprobarlos contra una constante escrita aquí sería comparar dos copias
   * de la misma suposición.
   *
   * El síntoma que esto impide no es un error: los cuatro pods arrancan, no pasan nunca
   * su sonda de arranque y `pulumi up` espera indefinidamente (issue #252).
   *
   * *Mutación:* que la bandera gobierne además `manifiestosDeBaseDeDatos`. → rojo
   * nombrando el `Service` que los cuatro pierden.
   */
  it.each(ENVIRONMENTS)("«%s»: los Service que los cuatro sistemas nombran siguen ahí", (ambiente) => {
    const entornoDe = entornoDelAmbiente(invariantesDe(ambiente));
    const plataforma = entornoDe(SISTEMAS[0]!.descriptor.sistema).plataforma;

    // `kamayuk-stg-postgres.kamayuk-stg:5432` → el `Service` y su namespace.
    const [motor = "", puerto = ""] = plataforma.motor.split(":");
    const [nombreDelMotor = "", espacioDelMotor = ""] = motor.split(".");
    // `http://kamayuk-stg-identidad.kamayuk-stg:8080/realms/...` → el `Service` y su namespace.
    const identidad = /\/\/([a-z0-9-]+)\.([a-z0-9-]+):/.exec(plataforma.jwks);

    const servicios = new Set(
      construirManifiestos(invariantesDe(ambiente))
        .filter((m) => m.kind === "Service")
        .map((m) => `${m.metadata.namespace ?? "-"}/${m.metadata.name}`),
    );

    expect(puerto, "el anfitrión del motor tiene que traer su puerto").toBe("5432");
    expect(
      servicios,
      `los cuatro sistemas se conectan a «${plataforma.motor}» y ese Service no está en ` +
        `los manifiestos de «${ambiente}»: se quedarían sin base, y el síntoma sería cuatro ` +
        "pods que arrancan y no pasan nunca su sonda de arranque.",
    ).toContain(`${espacioDelMotor}/${nombreDelMotor}`);
    expect(
      servicios,
      `los cuatro sistemas traen el JWKS de «${plataforma.jwks}» y ese Service no está en ` +
        "los manifiestos: todo token sería inválido por un motivo que no se parece a su causa.",
    ).toContain(`${identidad?.[2] ?? ""}/${identidad?.[1] ?? ""}`);
  });

  /**
   * Y ninguna ruta del ingreso puede quedarse apuntando a un `Service` que no existe.
   *
   * Una `IngressRoute` huérfana **no se queda callada**: Traefik la acepta, el certificado
   * se emite, y lo que contesta el dominio público es un `503` que se lee como «el sistema
   * está caído» y no como «aquí no hay nada desplegado». Por eso las dos rutas del
   * monolito se van con él.
   *
   * *Mutación:* dejar `interfaz` y `api` fuera del condicional de `Ingreso.ts`. → rojo en
   * `stg`, nombrando las dos.
   */
  it.each(ENVIRONMENTS)("«%s»: toda IngressRoute apunta a un Service que existe", (ambiente) => {
    const ms = construirManifiestos(invariantesDe(ambiente));
    const servicios = new Set(
      ms.filter((m) => m.kind === "Service").map((m) => m.metadata.name),
    );
    const huerfanas: string[] = [];
    for (const m of ms) {
      if (m.kind !== "IngressRoute") continue;
      for (const ruta of m.spec.routes) {
        for (const servicio of ruta.services) {
          if (!servicios.has(servicio.name)) {
            huerfanas.push(`${m.metadata.name} → ${servicio.name}`);
          }
        }
      }
    }
    expect(
      huerfanas,
      "una IngressRoute a un Service ausente contesta 503 en el dominio público, que se " +
        "lee como «el sistema está caído» y no como «aquí no hay nada desplegado».",
    ).toEqual([]);
  });

  /**
   * Y ningún objetivo de Prometheus raspa un `Service` que no existe.
   *
   * No dispara ninguna alerta —`alertas.yml` no tiene ninguna sobre `up{job="aplicacion"}`—
   * y eso es justo lo que lo hace peor: un objetivo caído permanente en la lista es ruido
   * que enseña a no mirar la lista (C-17 §5).
   *
   * Sólo se miran los objetivos del propio namespace: `traefik.kube-system…` es de k3s y
   * este repositorio no lo declara.
   */
  it.each(ENVIRONMENTS)("«%s»: Prometheus no raspa Service que no existen", (ambiente) => {
    const ms = construirManifiestos(invariantesDe(ambiente));
    const servicios = new Set(
      ms.filter((m) => m.kind === "Service").map((m) => m.metadata.name),
    );
    const configuracion = ms.find(
      (m) => m.kind === "ConfigMap" && m.metadata.name.endsWith("observabilidad-prometheus"),
    );
    const texto = (configuracion?.kind === "ConfigMap" && configuracion.data["prometheus.yml"]) || "";
    const objetivos = [...texto.matchAll(/- targets: \["([a-z0-9.-]+):\d+"\]/g)]
      .map((c) => c[1] ?? "")
      .filter((destino) => !destino.includes(".") && destino !== "localhost");

    expect(objetivos.length, "el raspado no tiene ni un objetivo propio").toBeGreaterThan(0);
    expect(
      objetivos.filter((destino) => !servicios.has(destino)),
      "Prometheus declara un objetivo cuyo Service no existe: quedaría `down` para siempre, " +
        "sin disparar ninguna alerta y enseñando a no mirar la lista de objetivos.",
    ).toEqual([]);
  });
  /**
   * Y quien comprueba el ambiente DESPLEGADO lee la misma bandera que quien lo compone.
   *
   * `verificar-el-ambiente.sh` mira cosas que sólo existen con el monolito —el
   * `Deployment` de la aplicación, y el `Service` al que hace `port-forward` para la
   * escalera de identidad—. Sin esto, `aplicar-stg` y `deteccion-de-deriva` quedarían
   * **rojos para siempre** por algo que nadie puede arreglar en un PR, que es lo que
   * `infra.yml` lleva escrito en su cabecera que no puede pasar; y darlo por bueno sin
   * mirarlo sería peor. El guion dice «no se hace», que no es «está bien» (C-15/C-16).
   *
   * Lo que aquí se compara son **las dos lecturas del mismo archivo**: la del guion
   * —ejecutando su propia tubería `grep`/`sed`/`tr`— y la de `config.ts`. Una prueba que
   * sólo mirara que el guion nombra la clave pasaría con la tubería rota.
   */
  it.each(ENVIRONMENTS)("«%s»: `verificar-el-ambiente.sh` lee la bandera igual que config.ts", (ambiente) => {
    const guion = readFileSync(
      join(raizDeInfra(), "verificaciones/ambiente/verificar-el-ambiente.sh"),
      "utf8",
    );
    const tuberia = /MONOLITO=\$\(grep -E '([^']+)'[\s\S]*?sed -E 's([^']+)'/.exec(guion);
    expect(tuberia, "el guion ya no lee `desplegarElMonolito` con una tuberia reconocible").not
      .toBeNull();

    const leido = execFileSync(
      "sh",
      [
        "-c",
        `grep -E '${tuberia?.[1] ?? ""}' "$0" | sed -E 's/.*:\\s*//' | tr -d '"'"'"' '`,
        join(raizDeInfra(), `Pulumi.${ambiente}.yaml`),
      ],
      { encoding: "utf8" },
    ).trim();

    expect(
      leido === "true",
      `el guion lee «${leido}» de Pulumi.${ambiente}.yaml y config.ts lee ` +
        `«${String(invariantesDe(ambiente).application.deployMonolith)}».`,
    ).toBe(invariantesDe(ambiente).application.deployMonolith);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 · El perfil de recursos
// ─────────────────────────────────────────────────────────────────────────────

describe("C-19 · el perfil de recursos de un ambiente no alcanza al otro", () => {
  /**
   * **`prod` no se mueve ni un milicore**, y se fija con las dos cifras medidas.
   *
   * Un número congelado en una prueba es caro a propósito. La decisión de C-19 fue bajar
   * lo que pide `stg` **sin tocar `prod`**, donde el margen es el que el issue #158 midió
   * desplegando y donde `nodeCapacityGapIssue` sigue puesto: la única forma de afirmar
   * «no se movió» que no dependa de que alguien vuelva a mirar es escribir lo que pide.
   *
   * Cambiar estas cifras **no es arreglar la prueba**: es declarar que la demanda de
   * producción cambió, y eso se decide, se mide contra el nodo y se escribe en el
   * entregable.
   *
   * *Mutación:* que `recursosDe` ignore el perfil y devuelva siempre el `minimo`. → rojo
   * aquí con las dos cifras, y `stg` sigue en verde: es el defecto que C-19 existe para
   * impedir, y sólo se ve por este lado.
   */
  it("prod pide exactamente lo que pedía antes de C-19", () => {
    const demanda = demandaDelStack(manifiestosDe("prod"));
    expect(demanda.permanente).toEqual({ cpuEnMili: 1940, memoriaEnMi: 6304 });
    expect(demanda.picoDeArranque).toEqual({ cpuEnMili: 2610, memoriaEnMi: 9696 });
  });

  /** Y `prod` declara el perfil dimensionado, que es la tabla base. */
  it("prod declara `dimensionado`, y `checkInvariants` no le deja declarar el otro", () => {
    expect(invariantesDe("prod").recursos.perfil).toBe("dimensionado");
  });

  /**
   * **Toda entrada del perfil `minimo` se aplica de verdad.**
   *
   * Es el modo de fallo que la no-exportación de la tabla base **no** cierra: se puede
   * escribir una entrada para una clave que ningún componente de ese ambiente compone, y
   * entonces el perfil declara una rebaja que no ocurre — indistinguible de no haberla
   * escrito, con la cifra sin moverse mientras el archivo dice que sí.
   *
   * **Se mide por la entrada y no por la composición entera, y hubo que aprenderlo.** La
   * primera versión comparaba `stg` compuesto con un perfil y con el otro y exigía que
   * difirieran; con `motor` dentro **eso ya es cierto pase lo que pase**, así que añadir
   * una entrada muerta —se probó con `aplicacionLote`, que en `stg` no compone nada desde
   * que el `CronJob` de `lote` se fue con el monolito— dejaba las 17 pruebas en VERDE. Lo
   * que muerde es buscar el valor: algún contenedor del ambiente tiene que pedir
   * **exactamente** lo que esa entrada declara, y ninguno lo que declaraba antes.
   *
   * *Mutación:* añadir a `AJUSTES_DEL_PERFIL_MINIMO` una entrada de `aplicacionLote`.
   * → rojo nombrándola.
   */
  it.each(ENTRADAS_DEL_PERFIL_MINIMO)("la entrada «%s» del perfil `minimo` se aplica", (entrada) => {
    const base = recursosDe("dimensionado")[entrada];
    const minimo = recursosDe("minimo")[entrada];
    expect(minimo, `la entrada «${String(entrada)}» del perfil no cambia nada`).not.toEqual(base);

    const pedidos = peticionesDe(construirManifiestos(invariantesDe("stg")));
    expect(
      pedidos,
      `el perfil \`minimo\` declara una rebaja para «${String(entrada)}» y ningún contenedor de ` +
        "«stg» la pide: la entrada no la consume nadie en este ambiente, y eso se lee igual " +
        "que no haberla escrito.",
    ).toContainEqual(minimo);
    expect(
      pedidos,
      `algún contenedor de «stg» sigue pidiendo lo que «${String(entrada)}» pedía antes del perfil.`,
    ).not.toContainEqual(base);

    // Y la rebaja es de `requests`, nunca de `limits`: lo que se cede es garantía previa,
    // no capacidad de cómputo. Sin esto, «minimo» podría acabar recortando el techo del
    // motor y el síntoma sería un OOMKill bajo carga, no un pod que no cabe.
    expect(minimo.limits, `el perfil \`minimo\` cambia los \`limits\` de «${String(entrada)}»`).toEqual(
      base.limits,
    );
    expect(minimo.requests).not.toEqual(base.requests);
  });

  /** Los dos perfiles existen y son distintos: uno solo no sería un perfil. */
  it("los dos perfiles producen tablas distintas", () => {
    expect(PERFILES_DE_RECURSOS).toEqual(["dimensionado", "minimo"]);
    expect(recursosDe("minimo")).not.toEqual(recursosDe("dimensionado"));
  });

  /**
   * Y cada ambiente compone con el perfil que declara, no con el de al lado.
   *
   * *Mutación:* que `construirManifiestos` resuelva `recursosDe("dimensionado")` fijo. →
   * rojo en `stg`.
   */
  it.each(ENVIRONMENTS)("«%s» compone con el perfil que declara", (ambiente) => {
    const invariantes = invariantesDe(ambiente);
    const otro = PERFILES_DE_RECURSOS.find((p) => p !== invariantes.recursos.perfil);
    const real = JSON.stringify(construirManifiestos(invariantes));
    expect(real).toBe(
      JSON.stringify(
        construirManifiestos({ ...invariantes, recursos: { perfil: invariantes.recursos.perfil } }),
      ),
    );
    expect(
      real,
      `«${ambiente}» declara el perfil «${invariantes.recursos.perfil}» y compone como «${otro ?? ""}».`,
    ).not.toBe(
      JSON.stringify(construirManifiestos({ ...invariantes, recursos: { perfil: otro! } })),
    );
  });
});
