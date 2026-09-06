import { describe, expect, it } from "vitest";
import { demandaDelStack } from "../capacidad";
import { construirManifiestos } from "../componentes";
import { podsDe, type Manifiesto } from "../componentes/tipos";
import { ENTRADAS_DEL_PERFIL_MINIMO, recursosDe } from "../componentes/convenciones";
import { ENVIRONMENTS, PERFILES_DE_RECURSOS, type Environment } from "../config";
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

/** Los `resources` de todo contenedor —normal o de inicializacion— de unos manifiestos. */
const peticionesDe = (ms: Manifiesto[]) =>
  ms.flatMap(podsDe).flatMap(({ pod }) => [
    ...pod.containers.map((c) => c.resources),
    ...(pod.initContainers ?? []).map((c) => c.resources),
  ]);

// ─────────────────────────────────────────────────────────────────────────────
// 1 · El monolito, que ya no está
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `E` — **ningún ambiente compone el monolito, y la plataforma sigue entera.**
 *
 * C-19 medía aquí tres cosas de la bandera `desplegarElMonolito`: que hiciera algo, que lo
 * compuesto coincidiera con lo declarado, y que `verificar-el-ambiente.sh` la leyera igual
 * que `config.ts`. Las tres se van con la bandera, y lo que las sustituye es una guarda que
 * mide lo contrario: que **ninguno de los objetos del monolito vuelva a componerse**.
 *
 * La que **no** cambia es la última —«la plataforma no se va con él»—, y es la que más vale:
 * era la mitad que importaba de C-19 y sigue siéndolo, porque los cuatro sistemas se
 * conectan literalmente a los dos `Service` que compone este componente.
 */
describe("E · el monolito no se compone, y la plataforma sigue entera", () => {
  /**
   * Los nombres de lo que el monolito ponía. Se escriben **uno a uno y a mano**, que es lo
   * contrario de lo que C-19 hacía —allí la lista se derivaba restando las dos composiciones—
   * y aquí es lo correcto: ya no hay dos composiciones que restar, y lo que hay que impedir
   * es que cualquiera de estos nombres reaparezca. Salen de la medición del 2026-09-06,
   * comparando `yarn manifiestos` antes y después: `prod` pasó de 101 objetos a 84.
   */
  const DEL_MONOLITO = [
    "aplicacion",
    "interfaz",
    "interfaz-nginx",
    "lote",
    "migracion",
    "implantacion",
    "api",
  ] as const;

  it.each(ENVIRONMENTS)("«%s»: la plataforma no compone ni un objeto del monolito", (ambiente) => {
    // Se compara contra el nombre **sin el prefijo del ambiente**, y no con un `includes`:
    // `PriorityClass/kamayuk-stg-prioridad-lote` contiene «-lote» y es de la plataforma —es
    // la clase de prioridad baja que usa la observabilidad—. Un `includes` la habría dado por
    // resto del monolito, que es un rojo por un motivo que no es el que se mide.
    const prefijo = `kamayuk-${ambiente}-`;
    const restos = construirManifiestos(invariantesDe(ambiente))
      .map((m) => ({ kind: m.kind, resto: m.metadata.name.replace(prefijo, "") }));
    for (const trozo of DEL_MONOLITO) {
      expect(
        restos
          .filter(({ resto }) => resto === trozo || resto.startsWith(`${trozo}-`))
          .map(({ kind, resto }) => `${kind}/${prefijo}${resto}`),
        `«${ambiente}» vuelve a componer un objeto del monolito con «${trozo}» en el nombre. ` +
          "El monolito salió del sistema en `E`: `componentes/Aplicacion.ts` y " +
          "`componentes/Migracion.ts` están borrados, y volver a encenderlo no es una línea.",
      ).toEqual([]);
    }
  });

  /**
   * Y **el `Deployment` de un sistema no cuenta como «la aplicación»**: el contraste que
   * impide que la guarda de arriba se satisfaga por vacío. Los cuatro siguen ahí, en su
   * namespace, y esta prueba se pondría roja si alguien los borrara creyendo que son restos
   * del monolito.
   */
  it.each(ENVIRONMENTS)("«%s»: y los cuatro Deployment de los sistemas siguen estando", (ambiente) => {
    const nombres = manifiestosDe(ambiente)
      .filter((m) => m.kind === "Deployment")
      .map((m) => m.metadata.name);
    for (const sistema of ["rentas", "catastro", "normativa", "caja"]) {
      expect(nombres, `falta el Deployment web de «${sistema}» en «${ambiente}»`).toContain(
        `kamayuk-${sistema}-web`,
      );
    }
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
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 · El perfil de recursos
// ─────────────────────────────────────────────────────────────────────────────

describe("C-19 · el perfil de recursos de un ambiente no alcanza al otro", () => {
  /**
   * **Lo que `prod` pide, congelado en dos cifras.**
   *
   * Un número congelado en una prueba es caro a propósito: es la única forma de afirmar
   * «esto no se movió» que no dependa de que alguien vuelva a mirar. Y cambiarlo **no es
   * arreglar la prueba**: es declarar que la demanda de producción cambió, y eso se decide,
   * se mide contra el nodo y se escribe en el entregable.
   *
   * Cambió en `E`, y ésta es la medida: al irse el monolito, `prod` pasa de
   * `1940m / 6304Mi` permanentes y `2610m / 9696Mi` de pico a lo que dice abajo. Sigue sin
   * caber —su brecha (#1) sigue declarada y `capacidad.test.ts` exige que siga sin caber—,
   * pero por mucho menos: por CPU faltan **10m** donde faltaban 810m, y por memoria
   * **1 792Mi** donde faltaban 3 968Mi.
   *
   * *Mutación:* que `recursosDe` ignore el perfil y devuelva siempre el `minimo`. → rojo
   * aquí con las dos cifras, y `stg` sigue en verde: es el defecto que C-19 existe para
   * impedir, y sólo se ve por este lado.
   *
   * ## Y subieron, con nombre y apellido (#16)
   *
   * De `1940m / 6304Mi` permanentes a **`1990m / 6368Mi`**, y del pico `2610m / 9696Mi` a
   * **`2660m / 9760Mi`**: exactamente **50m y 64Mi**, que es lo que pide el contenedor de nginx
   * de la interfaz de ventanilla de `caja` —un QUINTO `Deployment` en `prod`—.
   *
   * Esto es lo que el párrafo de arriba manda hacer: no se «arregla la prueba», se declara que
   * la demanda de producción cambió y se mide contra el nodo. Medido: `prod` pasa de faltarle
   * **810m** de CPU a faltarle **860m**, y de **3 968Mi** a **4 032Mi**. **No cabía antes y no
   * cabe ahora**, así que la interfaz no cambia la decisión pendiente —es D-25—, pero la empeora
   * en la cantidad exacta que cuesta, y esa cantidad queda escrita aquí y no en la cabeza de
   * nadie.
   */
  it("prod pide exactamente lo medido en `E`", () => {
    const demanda = demandaDelStack(manifiestosDe("prod"));
    expect(demanda.permanente).toEqual({ cpuEnMili: 1390, memoriaEnMi: 5216 });
    expect(demanda.picoDeArranque).toEqual({ cpuEnMili: 1860, memoriaEnMi: 7584 });
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
