import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { construirManifiestos } from "../componentes";
import { SISTEMAS_DEL_PRODUCTO } from "../componentes/convenciones";
import { raizDelRepositorio } from "../componentes/fuentes";
import { demandaDelStack } from "../capacidad";
import { podsDe, type Contenedor, type Manifiesto } from "../componentes/tipos";
import { ENVIRONMENTS, type Environment } from "../config";
import { entornoDelAmbiente, manifiestosDeLosSistemas } from "../herramientas/emitir-manifiestos";
import { SISTEMAS } from "../descriptor/sistemas";
import { invariantesDe } from "./stacks";

/**
 * C-14 — que los cuatro sistemas se puedan DESPLEGAR, y no solo componer.
 *
 * Hasta aqui `yarn manifiestos` producia los cuatro y la auditoria los aprobaba, y aun asi
 * ninguno se podia levantar en un clúster. Los cuatro motivos los habian declarado las propias
 * correcciones al medir, y cada uno tiene aqui su guarda:
 *
 * 1. **Los Jobs de migracion no migraban** (C-7, hueco 2). Corrian la MISMA imagen que el
 *    `Deployment` —el descriptor declaraba `imagenes: [SISTEMA]`, una sola— con
 *    `SGTM_DB_USUARIO=sgtm_owner` y sin `SPRING_PROFILES_ACTIVE`: o sea, arrancaban la aplicacion
 *    con las credenciales del unico rol con DDL, y la aplicacion tiene `spring.flyway.enabled:
 *    false` a proposito (ARQ-03 §4).
 * 2. **Nada creaba las cuatro bases ni sus roles** (C-7, hueco 3). Esa mitad la mide
 *    `componentes.test.ts`, que es donde vive el `ConfigMap` del motor.
 * 3. **El `CronJob` del emisor y del ingestor no estaba desplegado** (C-8, hueco 1) y el
 *    descriptor no tenia campo para su configuracion (C-8, hueco 2).
 * 4. **Ningun `Job` de implantacion** (C-7, hueco 4).
 *
 * Todo lo de aqui se mide **sin clúster y sin Pulumi**, leyendo los manifiestos que se
 * desplegarian. Lo que no se puede medir asi esta declarado en `C-14` §huecos.
 */

const AMBIENTE: Environment = "stg";

function delSistema(ambiente: Environment, sistema: string): Manifiesto[] {
  const plataforma = construirManifiestos(invariantesDe(ambiente));
  return manifiestosDeLosSistemas(ambiente, plataforma).filter(
    (m) => m.metadata.namespace === `kamayuk-${sistema}-${ambiente}`,
  );
}

/** El unico contenedor de un `Job` cuyo nombre empieza por ese prefijo. */
function jobLlamado(
  ms: Manifiesto[],
  prefijo: string,
): { nombre: string; principal: Contenedor; iniciales: Contenedor[] } {
  const job = ms.find((m) => m.kind === "Job" && m.metadata.name.startsWith(prefijo));
  expect(job, `no hay ningun Job que empiece por «${prefijo}»`).toBeDefined();
  const pod = podsDe(job as Manifiesto)[0]?.pod;
  const principal = pod?.containers[0];
  expect(principal, `el Job «${prefijo}» no tiene contenedor`).toBeDefined();
  return {
    nombre: (job as Manifiesto).metadata.name,
    principal: principal as Contenedor,
    iniciales: pod?.initContainers ?? [],
  };
}

function valorDe(c: Contenedor, nombre: string): string | undefined {
  return (c.env ?? []).find((e) => e.name === nombre)?.value;
}

function declara(c: Contenedor, nombre: string): boolean {
  return (c.env ?? []).some((e) => e.name === nombre);
}

// ─────────────────────────────────────────────────────────────────────────────
// Punto 1 — que imagen publica cada repositorio
// ─────────────────────────────────────────────────────────────────────────────

describe("C-14 §1 · cada sistema publica DOS imagenes, y el migrador corre la suya", () => {
  /**
   * La decision, leida del `Dockerfile` de cada repositorio en vez de de una lista escrita aqui.
   *
   * Son dos objetivos del mismo arbol de fuentes —`aplicacion` y `migrador`— y estan separados
   * porque las credenciales son distintas: las de `sgtm_owner` existen durante la migracion y
   * desaparecen con ella. Es el mismo reparto que el monolito tiene desde el issue #150
   * (`sgtm-aplicacion` y `sgtm-migrador`).
   */
  it.each(SISTEMAS_DEL_PRODUCTO)("«%s» tiene los dos objetivos en su Dockerfile", (sistema) => {
    const ruta = join(resolve(raizDelRepositorio(), "..", sistema), "backend/Dockerfile");
    expect(
      existsSync(ruta),
      `No esta «${ruta}». Sin Dockerfile no hay imagen que publicar, y el descriptor de ` +
        `«${sistema}» nombra dos. Remedio: git clone https://github.com/hneyra/${sistema}`,
    ).toBe(true);
    const texto = readFileSync(ruta, "utf8");
    for (const objetivo of ["aplicacion", "migrador"]) {
      expect(
        texto,
        `el Dockerfile de «${sistema}» no declara el objetivo «${objetivo}»`,
      ).toMatch(new RegExp(`AS ${objetivo}\\b`));
    }
  });

  it.each(SISTEMAS_DEL_PRODUCTO)("«%s» declara las dos imagenes, y solo esas", (sistema) => {
    const descriptor = SISTEMAS.find((s) => s.descriptor.sistema === sistema)?.descriptor;
    expect(descriptor?.imagenes).toEqual([sistema, `${sistema}-migrador`]);
  });

  /**
   * La mutacion que este criterio existe para cazar: **el Job de migracion con la imagen y el
   * usuario del Deployment**, que es exactamente el estado anterior a C-14.
   */
  it.each(SISTEMAS_DEL_PRODUCTO)("el Job de migracion de «%s» corre el MIGRADOR", (sistema) => {
    const ms = delSistema(AMBIENTE, sistema);
    const { principal } = jobLlamado(ms, `kamayuk-${sistema}-migracion`);
    const entorno = entornoDelAmbiente(AMBIENTE)(sistema);

    expect(
      principal.image,
      "el Job de migracion corre la imagen de la APLICACION. La aplicacion arranca con " +
        "`spring.flyway.enabled: false` (ARQ-03 §4), asi que ese Job no migra: levanta el " +
        "proceso web con las credenciales del unico rol con DDL.",
    ).toBe(entorno.imagenDe(`${sistema}-migrador`));

    // Y las variables que el migrador de verdad LEE. Su `main` las nombra y rechaza argumentos
    // a proposito, para que una clave no quede en el historial del proceso.
    expect(valorDe(principal, "SGTM_DB_OWNER_USUARIO")).toBe("sgtm_owner");
    expect(declara(principal, "SGTM_DB_OWNER_CLAVE")).toBe(true);
    expect(valorDe(principal, "SGTM_DB_URL")).toBe(
      `jdbc:postgresql://postgres:5432/${sistema}`,
    );
    expect(
      declara(principal, "SGTM_DB_USUARIO"),
      "`SGTM_DB_USUARIO` es la variable de la APLICACION; el migrador no la lee. Ponerla aqui " +
        "es lo que hacia que este Job pareciera correcto sin migrar nada.",
    ).toBe(false);
  });

  /**
   * Un `Job` de Kubernetes es INMUTABLE: su plantilla de pod no se puede modificar. Con un
   * nombre fijo, el `pulumi up` de la version siguiente falla al intentar actualizarlo —la
   * imagen lleva la etiqueta dentro—. El monolito lo resolvio en el issue #150; los cuatro
   * descriptores nacieron sin ello.
   */
  it.each(SISTEMAS_DEL_PRODUCTO)("los dos Jobs de «%s» llevan la version en el nombre", (sistema) => {
    const ms = delSistema(AMBIENTE, sistema);
    const sufijo = invariantesDe(AMBIENTE).application.bootstrapVersion.slice(0, 12);
    for (const prefijo of ["migracion", "implantacion"]) {
      const { nombre } = jobLlamado(ms, `kamayuk-${sistema}-${prefijo}`);
      expect(nombre).toBe(`kamayuk-${sistema}-${prefijo}-${sufijo}`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Punto 4 — el Job de implantacion
// ─────────────────────────────────────────────────────────────────────────────

describe("C-14 §4 · cada sistema implanta su municipalidad", () => {
  it.each(SISTEMAS_DEL_PRODUCTO)("«%s» compone su Job de implantacion", (sistema) => {
    const ms = delSistema(AMBIENTE, sistema);
    const { principal, iniciales } = jobLlamado(ms, `kamayuk-${sistema}-implantacion`);
    const entorno = entornoDelAmbiente(AMBIENTE)(sistema);
    const implantacion = invariantesDe(AMBIENTE).implantacion;

    // La imagen de la APLICACION con el perfil `batch` (ADR-0003: un artefacto, dos perfiles).
    expect(principal.image).toBe(entorno.imagenDe(sistema));
    expect(valorDe(principal, "SPRING_PROFILES_ACTIVE")).toBe("batch");
    expect(valorDe(principal, "KAMAYUK_IMPLANTACION_UBIGEO")).toBe(implantacion.ubigeo);
    expect(valorDe(principal, "KAMAYUK_IMPLANTACION_TIPO")).toBe(implantacion.tipo);
    // `DatosDeImplantacion` valida en su constructor compacto: sin una de estas el bean falla y
    // el contexto no arranca. No es un Job degradado, es un Job que no corre.
    for (const variable of [
      "KAMAYUK_IMPLANTACION_NOMBRE",
      "KAMAYUK_IMPLANTACION_ADMINISTRADOR",
      "KAMAYUK_IMPLANTACION_NOMBREDELADMINISTRADOR",
      "KAMAYUK_IMPLANTACION_ESDEMOSTRACION",
      "KAMAYUK_IMPLANTACION_URL",
      "KAMAYUK_IMPLANTACION_OWNERCLAVE",
    ]) {
      expect(declara(principal, variable), `falta ${variable}`).toBe(true);
    }

    // Y el migrador de contenedor de inicializacion: un `Deployment` no sabe esperar a un `Job`
    // y Kubernetes no tiene `dependsOn`. Cuando este contenedor sale con exito, el esquema ESTA
    // —que es mas de lo que la espera del monolito puede afirmar—.
    expect(
      iniciales.map((c) => c.image),
      "el Job de implantacion no espera al esquema. Sin esto puede correr antes de que la " +
        "migracion termine, fallar, y agotar su `backoffLimit` sin implantar nada.",
    ).toEqual([entorno.imagenDe(`${sistema}-migrador`)]);
  });

  /**
   * `esDemostracion` sale del ambiente y no de una constante: es lo que decide si TODO documento
   * que ese sistema emita sale marcado (INF-03 §3.2, #122). Una instalacion que se creia de
   * demostracion y salio real emite papeles sin marca, y quien lo descubre es quien recibe uno.
   */
  it.each(ENVIRONMENTS)("y el regimen de «%s» es el que el stack declara", (ambiente) => {
    const esperado = String(invariantesDe(ambiente).application.isDemonstration);
    for (const sistema of SISTEMAS_DEL_PRODUCTO) {
      const { principal } = jobLlamado(
        delSistema(ambiente, sistema),
        `kamayuk-${sistema}-implantacion`,
      );
      expect(valorDe(principal, "KAMAYUK_IMPLANTACION_ESDEMOSTRACION"), sistema).toBe(esperado);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Punto 3 — los procesos por lotes
// ─────────────────────────────────────────────────────────────────────────────

describe("C-14 §3 · los CronJob del emisor y del ingestor", () => {
  const cronDe = (sistema: string, nombre: string) => {
    const cron = delSistema(AMBIENTE, sistema).find(
      (m) => m.kind === "CronJob" && m.metadata.name === nombre,
    );
    expect(cron, `no hay ningun CronJob «${nombre}»`).toBeDefined();
    return cron as Extract<Manifiesto, { kind: "CronJob" }>;
  };

  it("`catastro` publica su padron, y corre: no llama a nadie", () => {
    const cron = cronDe("catastro", "kamayuk-catastro-publicador");
    const c = cron.spec.jobTemplate.spec.template.spec.containers[0] as Contenedor;

    expect(cron.spec.suspend, "el publicador no depende de ninguna identidad de servicio: escribe su propio buzon y no entrega nada").toBeUndefined();
    expect(cron.spec.concurrencyPolicy).toBe("Forbid");
    expect(valorDe(c, "SPRING_PROFILES_ACTIVE")).toBe("batch");
    // `@ConditionalOnProperty("kamayuk.catastro.publicacion.municipalidad")`: sin esta variable
    // el runner NO se registra y el CronJob arranca un proceso `batch` que no hace nada.
    expect(valorDe(c, "KAMAYUK_CATASTRO_PUBLICACION_MUNICIPALIDAD")).toBe(
      String(invariantesDe(AMBIENTE).implantacion.municipalidadId),
    );
    // Y el ejercicio NO se declara: con el, el publicador corre ademas la valuacion, que es un
    // acto de un ejercicio y no se dispara desde una tarea programada que nadie pidio.
    expect(declara(c, "KAMAYUK_CATASTRO_PUBLICACION_EJERCICIO")).toBe(false);
  });

  it("`rentas` declara su ingestor entero, y nace SUSPENDIDO", () => {
    const cron = cronDe("rentas", "kamayuk-rentas-ingestor");
    const c = cron.spec.jobTemplate.spec.template.spec.containers[0] as Contenedor;

    // No hay identidad de servicio (ADR-0028 §2, C-8 hueco 3): sin credencial, `catastro`
    // contesta 401 y el CronJob fallaria cada noche. Lo que se declara es la ventana, los
    // limites y la configuracion; quitar el `suspend` es una linea el dia que exista.
    expect(cron.spec.suspend).toBe(true);

    // `@ConditionalOnProperty("kamayuk.rentas.ingestor.usuario")`: sin ella, el cableado del
    // ingestor no existe y el proceso `batch` arranca sin ingestar nada.
    expect(valorDe(c, "KAMAYUK_RENTAS_INGESTOR_USUARIO")).toBe("rol_ingestor_catastro");
    expect(declara(c, "KAMAYUK_RENTAS_INGESTOR_CLAVE")).toBe(true);
    expect(valorDe(c, "KAMAYUK_RENTAS_INGESTOR_MUNICIPALIDAD")).toBe(
      String(invariantesDe(AMBIENTE).implantacion.municipalidadId),
    );
    // `ResponsableDeLaProyeccion` exige las dos y una direccion entregable: un hecho apartado
    // bloquea la cola detras de el, y avisar a nadie es no avisar (C-8 §4.2).
    expect(valorDe(c, "KAMAYUK_RENTAS_INGESTOR_RESPONSABLE")).toBe(
      invariantesDe(AMBIENTE).operacion.responsable,
    );
    expect(valorDe(c, "KAMAYUK_RENTAS_INGESTOR_CANAL")).toBe(
      invariantesDe(AMBIENTE).operacion.canal,
    );
    // El buzon de `catastro` esta en SU namespace: sin el sufijo, el nombre no resuelve.
    expect(valorDe(c, "KAMAYUK_CATASTRO_URL")).toBe(
      `http://kamayuk-catastro-web.kamayuk-catastro-${AMBIENTE}`,
    );
    expect(declara(c, "KAMAYUK_CATASTRO_CREDENCIAL")).toBe(true);
  });

  /**
   * El contraste. Sin el, «todo sistema declara un CronJob» podria satisfacerse dandole uno a
   * quien no tiene ningun proceso periodico, y una lista vacia dejaria de significar algo.
   */
  it.each(["normativa", "caja"])("«%s» no declara ninguno, y es una afirmacion", (sistema) => {
    expect(delSistema(AMBIENTE, sistema).filter((m) => m.kind === "CronJob")).toEqual([]);
  });

  /**
   * Un `CronJob` corre la imagen de la APLICACION en perfil `batch`, nunca la del migrador ni
   * con las credenciales del owner. Lo segundo lo rechaza ademas `auditarLaAplicacion`.
   */
  it("ningun CronJob de un sistema lleva la credencial de `sgtm_owner`", () => {
    for (const sistema of SISTEMAS_DEL_PRODUCTO) {
      for (const m of delSistema(AMBIENTE, sistema)) {
        if (m.kind !== "CronJob") continue;
        for (const c of m.spec.jobTemplate.spec.template.spec.containers) {
          expect(declara(c, "SGTM_DB_OWNER_USUARIO"), m.metadata.name).toBe(false);
          expect(declara(c, "SGTM_DB_OWNER_CLAVE"), m.metadata.name).toBe(false);
          expect(valorDe(c, "SGTM_DB_USUARIO"), m.metadata.name).toBe("sgtm_app");
        }
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// El egreso, que sin `namespaceSelector` no abre nada
// ─────────────────────────────────────────────────────────────────────────────

describe("C-14 · el egreso declarado ES el que se aplica", () => {
  /**
   * Desde ADR-0031 cada sistema tiene **su** namespace, y un `podSelector` sin
   * `namespaceSelector` selecciona pods **del mismo**. Una regla escrita asi no abre nada, y el
   * sintoma es trafico denegado con una politica que dice permitirlo — sin ningun rojo.
   */
  it.each(SISTEMAS_DEL_PRODUCTO)("toda regla de egreso de «%s» nombra su namespace", (sistema) => {
    for (const m of delSistema(AMBIENTE, sistema)) {
      if (m.kind !== "NetworkPolicy") continue;
      for (const regla of m.spec.egress ?? []) {
        for (const destino of regla.to ?? []) {
          if (destino.ipBlock !== undefined) continue;
          expect(
            destino.namespaceSelector,
            `${m.metadata.name} declara un destino sin namespaceSelector: ` +
              `${JSON.stringify(destino)}. Selecciona pods del PROPIO namespace, asi que no abre ` +
              "nada.",
          ).toBeDefined();
        }
      }
    }
  });

  it("y el destino de la plataforma es el namespace de la plataforma, no el suyo", () => {
    const entorno = entornoDelAmbiente(AMBIENTE)("rentas");
    const politicas = delSistema(AMBIENTE, "rentas").filter((m) => m.kind === "NetworkPolicy");
    const alMotor = politicas
      .flatMap((m) => (m.kind === "NetworkPolicy" ? (m.spec.egress ?? []) : []))
      .flatMap((r) => r.to ?? [])
      .find((d) => d.podSelector?.matchLabels?.["componente"] === "postgres");
    expect(alMotor?.namespaceSelector?.matchLabels).toEqual({
      "kubernetes.io/metadata.name": entorno.plataforma.namespace,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Lo que esto cuesta en el nodo, MEDIDO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * El censo de lo que los cuatro sistemas piden.
 *
 * **`yarn capacidad` no los ve**, y eso es un hueco declarado de C-14 (§6): compone solo la
 * plataforma. Lo que esta guarda hace es lo unico que se puede hacer sin decidir antes si el
 * monolito y los cuatro conviven en el mismo nodo —que es ADR-0029 y D-22, no C-14—: **fijar la
 * cifra medida**, para que no pueda crecer en silencio.
 *
 * Las dos cifras se MIDEN, no se razonan: se pone el techo a 0, se lee el «but was» y se
 * escribe. Es el mismo trato que `OPERACIONES_CON_FILTRO_QUE_NADIE_LEE` en `rentas`.
 */
const TECHO_DE_LOS_SISTEMAS = { cpuEnMili: 950, memoriaEnMi: 4864 };

describe("C-14 · lo que los cuatro sistemas anaden al nodo", () => {
  it.each(ENVIRONMENTS)("en «%s» no crece en silencio", (ambiente) => {
    const plataforma = construirManifiestos(invariantesDe(ambiente));
    const demanda = demandaDelStack([...manifiestosDeLosSistemas(ambiente, plataforma)]);
    expect(demanda.picoDeArranque.cpuEnMili).toBeLessThanOrEqual(TECHO_DE_LOS_SISTEMAS.cpuEnMili);
    expect(demanda.picoDeArranque.memoriaEnMi).toBeLessThanOrEqual(
      TECHO_DE_LOS_SISTEMAS.memoriaEnMi,
    );
  });

  /**
   * Y la otra mitad, que es la que este censo existe para decir en voz alta: **hoy los cuatro no
   * caben junto al monolito en el nodo que `prod` declara.** No se «arregla» bajando peticiones
   * hasta que cuadre —eso seria inventar una holgura que no existe—: lo que hay que decidir es
   * si el monolito y los cuatro conviven, y eso es ADR-0029.
   *
   * Se afirma el estado de HOY. El dia que quepa, esta prueba se pone roja y lo que hay que
   * hacer no es actualizar el numero: es leer por que cambio.
   */
  it("y hoy NO caben junto al monolito en el nodo de prod, que es el hallazgo", () => {
    const plataforma = construirManifiestos(invariantesDe("prod"));
    const todos = [...plataforma, ...manifiestosDeLosSistemas("prod", plataforma)];
    const demanda = demandaDelStack(todos);
    const nodo = invariantesDe("prod").node;
    // 200m/160Mi de los pods de serie de k3s, como descuenta `auditarCapacidad`.
    const disponible = 2000 - 200;
    expect(nodo.allocatableCpu).toBe("2");
    expect(
      demanda.permanente.cpuEnMili,
      "los cuatro sistemas ya caben en `prod` por CPU. Si eso es cierto, lo que hay que revisar " +
        "es esta prueba y el hueco 3 de C-14, no el numero.",
    ).toBeGreaterThan(disponible);
  });
});
