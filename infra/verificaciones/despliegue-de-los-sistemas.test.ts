import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { construirManifiestos } from "../componentes";
import { SISTEMAS_DEL_PRODUCTO } from "../componentes/convenciones";
import { raizDelRepositorio } from "../componentes/fuentes";
import { demandaDelStack } from "../capacidad";
import { podsDe, type Contenedor, type Manifiesto } from "../componentes/tipos";
import { ENVIRONMENTS, type Environment } from "../config";
import {
  entornoDelAmbiente,
  manifiestosDelAmbiente,
  manifiestosDeLosSistemas,
} from "../herramientas/emitir-manifiestos";
import { SISTEMAS } from "../descriptor/sistemas";
import { prefijoDeLaImplantacion, variableDe } from "./prefijo-de-la-implantacion";
import { correElBackend } from "./procesos-de-un-sistema";
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
 *    `KAMAYUK_DB_USUARIO=kamayuk_owner` y sin `SPRING_PROFILES_ACTIVE`: o sea, arrancaban la aplicacion
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
  return manifiestosDeLosSistemas(invariantesDe(ambiente), plataforma).filter(
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
   * porque las credenciales son distintas: las de `kamayuk_owner` existen durante la migracion y
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

  /**
   * Y el `COPY` nombra el jar que ese modulo produce de verdad (C-17, arreglo B).
   *
   * `normativa/backend/Dockerfile` pedia `sgtm.jar` y su modulo declara
   * `archiveFileName.set("normativa.jar")`. La imagen **no se podia construir**: `docker build`
   * compilaba entero —Gradle en verde, el jar producido— y se caia en el ultimo paso con «stat
   * .../sgtm.jar: file does not exist». Nadie lo veia porque ningun CI construye todavia estas
   * imagenes, y desde el clúster el sintoma es `ImagePullBackOff`, indistinguible de un registro
   * que aun no publico la etiqueta.
   *
   * Se leen los DOS archivos y no se compara contra una lista escrita aqui: la lista seria el
   * tercer sitio con la misma verdad, y el que envejece.
   */
  it.each(SISTEMAS_DEL_PRODUCTO)("el Dockerfile de «%s» copia el jar que su modulo produce", (sistema) => {
    const clon = resolve(raizDelRepositorio(), "..", sistema);
    const gradle = readFileSync(
      join(clon, "backend", `kamayuk-${sistema}-aplicacion`, "build.gradle.kts"),
      "utf8",
    );
    const declarado = /archiveFileName\.set\("([^"]+)"\)/.exec(gradle)?.[1];
    expect(declarado, `«${sistema}» no declara ningun archiveFileName`).toBeDefined();

    const dockerfile = readFileSync(join(clon, "backend", "Dockerfile"), "utf8");
    const copiado = /build\/libs\/([^\s]+)/.exec(dockerfile)?.[1];
    expect(
      copiado,
      `el Dockerfile de «${sistema}» copia «${copiado}» y su modulo produce «${declarado}». ` +
        "La imagen no se puede construir: Gradle compila en verde y el ultimo `COPY` se cae con " +
        "«file does not exist», que desde el clúster se ve como `ImagePullBackOff`.",
    ).toBe(declarado);
  });

  /**
   * El jar se llama como su sistema, y el `ENTRYPOINT` arranca EL QUE EL `COPY` DEJO (R-A/B).
   *
   * Dos comprobaciones, y las dos cierran un hueco que C-17 dejo abierto por su otro lado.
   *
   * **El nombre.** Hasta R-A/B tres sistemas producian `sgtm.jar` —el nombre del monolito— y
   * `normativa` producia `normativa.jar`. Ese desajuste no es cosmetico: es exactamente lo que
   * hizo que la imagen de `normativa` no se pudiera construir (C-17, arreglo B), porque el
   * `Dockerfile` se copia de un hermano y el nombre del jar no. Con la regla «cada sistema
   * produce `<sistema>.jar`» no hay nada que recordar: el `Dockerfile` copiado de un hermano se
   * pone rojo aqui en vez de morir en el ultimo `COPY`.
   *
   * **El destino.** El nombre del jar aparece DOS veces en cada `Dockerfile` —el destino del
   * `COPY` y el `-jar` del `ENTRYPOINT`— y hasta ahora nada las comparaba. Es la misma forma que
   * los cinco defectos de C-17: una mitad de la frontera bien y la otra sin quien la mire. Y su
   * sintoma es de los caros, porque llega mas tarde que los otros: la imagen **se construye sin
   * protestar** y el contenedor muere al arrancar con «Unable to access jarfile», que desde el
   * cluster se ve como un `CrashLoopBackOff` sin registro que lo explique.
   */
  it.each(SISTEMAS_DEL_PRODUCTO)("«%s» produce su jar y su ENTRYPOINT lo arranca", (sistema) => {
    const clon = resolve(raizDelRepositorio(), "..", sistema);
    const gradle = readFileSync(
      join(clon, "backend", `kamayuk-${sistema}-aplicacion`, "build.gradle.kts"),
      "utf8",
    );
    const declarado = /archiveFileName\.set\("([^"]+)"\)/.exec(gradle)?.[1];
    expect(
      declarado,
      `«${sistema}» produce «${declarado}» y el producto se llama kamayuk: el jar de cada ` +
        `sistema lleva SU nombre, «${sistema}.jar». Antes de R-A/B tres producian «sgtm.jar» y ` +
        "uno el suyo, y ese desajuste es lo que dejo la imagen de «normativa» sin poder " +
        "construirse (C-17, arreglo B).",
    ).toBe(`${sistema}.jar`);

    const dockerfile = readFileSync(join(clon, "backend", "Dockerfile"), "utf8");
    const destino = /build\/libs\/[^\s]+\s+(\S+)/.exec(dockerfile)?.[1];
    expect(destino, `el Dockerfile de «${sistema}» no copia el jar a ningun destino`).toBeDefined();
    expect(
      destino,
      `el Dockerfile de «${sistema}» deja el jar en «${destino}», y el producto se sirve desde ` +
        `«/opt/kamayuk/». Un destino heredado del monolito no falla al construir: falla al ` +
        "arrancar.",
    ).toBe(`/opt/kamayuk/${sistema}.jar`);

    const arranca = /ENTRYPOINT\s+\["java",\s*"-jar",\s*"([^"]+)"\]/.exec(dockerfile)?.[1];
    expect(
      arranca,
      `el ENTRYPOINT de «${sistema}» arranca «${arranca}» y el COPY deja el jar en ` +
        `«${destino}». La imagen SE CONSTRUYE igual —el desajuste no lo ve docker build— y el ` +
        "contenedor muere al arrancar con «Unable to access jarfile», que desde el cluster es un " +
        "CrashLoopBackOff sin una linea que lo explique.",
    ).toBe(destino);
  });

  it.each(SISTEMAS_DEL_PRODUCTO)("«%s» declara las dos del jar, y lo demas tiene su Dockerfile", (sistema) => {
    const descriptor = SISTEMAS.find((s) => s.descriptor.sistema === sistema)?.descriptor;
    const imagenes = descriptor?.imagenes ?? [];

    // Las dos del jar son obligatorias y por el motivo de C-14 §1: son el mismo arbol de
    // fuentes separado porque las credenciales no lo son.
    expect(imagenes).toEqual(expect.arrayContaining([sistema, `${sistema}-migrador`]));

    // Y lo que no es el jar lleva el nombre de SU sistema. Antes esto era `toEqual([dos])`, que
    // decia dos cosas a la vez —«estan las dos» y «no hay ninguna mas»— y con la interfaz de
    // ventanilla de `caja` (#16) la segunda dejo de ser verdad.
    //
    // QUIEN construye cada extra no se comprueba aqui sino en `imagenes-publicadas.test.ts`,
    // contra el flujo de publicacion de su clon, que es la fuente que de verdad lo dice: la
    // interfaz sale de `frontend/Dockerfile` con el objetivo `AS interfaz`, no de un
    // `<sufijo>/Dockerfile`, y adivinar la ruta seria un tercer sitio con la misma verdad.
    for (const imagen of imagenes.filter((i) => i !== sistema && i !== `${sistema}-migrador`)) {
      expect(
        imagen.startsWith(`${sistema}-`),
        `«${sistema}» declara la imagen «${imagen}», que no lleva su nombre delante: una imagen ` +
          "de otro sistema desplegada en este namespace cruzaria la frontera de ADR-0031",
      ).toBe(true);
    }
  });

  /**
   * La mutacion que este criterio existe para cazar: **el Job de migracion con la imagen y el
   * usuario del Deployment**, que es exactamente el estado anterior a C-14.
   */
  it.each(SISTEMAS_DEL_PRODUCTO)("el Job de migracion de «%s» corre el MIGRADOR", (sistema) => {
    const ms = delSistema(AMBIENTE, sistema);
    const { principal } = jobLlamado(ms, `kamayuk-${sistema}-migracion`);
    const entorno = entornoDelAmbiente(invariantesDe(AMBIENTE))(sistema);

    expect(
      principal.image,
      "el Job de migracion corre la imagen de la APLICACION. La aplicacion arranca con " +
        "`spring.flyway.enabled: false` (ARQ-03 §4), asi que ese Job no migra: levanta el " +
        "proceso web con las credenciales del unico rol con DDL.",
    ).toBe(entorno.imagenDe(`${sistema}-migrador`));

    // Y las variables que el migrador de verdad LEE. Su `main` las nombra y rechaza argumentos
    // a proposito, para que una clave no quede en el historial del proceso.
    expect(valorDe(principal, "KAMAYUK_DB_OWNER_USUARIO")).toBe("kamayuk_owner");
    expect(declara(principal, "KAMAYUK_DB_OWNER_CLAVE")).toBe(true);
    // Y la URL sale del anfitrion que ENTREGA el entorno (C-17, punto 1). Esta linea decia
    // `jdbc:postgresql://postgres:5432/...`, o sea que la guarda de C-14 EXIGIA el nombre roto:
    // en Kubernetes no hay ningun `Service` llamado `postgres` —ese nombre viene del
    // `compose.yaml` local— y lo medido fue `UnknownHostException` en los ocho Jobs. Una guarda
    // escrita contra un valor literal fosiliza el valor; comparada contra `entorno.plataforma`
    // sigue al ambiente.
    expect(valorDe(principal, "KAMAYUK_DB_URL")).toBe(
      `jdbc:postgresql://${entorno.plataforma.motor}/${sistema}`,
    );
    expect(
      declara(principal, "KAMAYUK_DB_USUARIO"),
      "`KAMAYUK_DB_USUARIO` es la variable de la APLICACION; el migrador no la lee. Ponerla aqui " +
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
    // La version de ESTE sistema, no la del monolito: desde D cada sistema declara la suya
    // (`kamayuk:versionDe<Sistema>`), porque la etiqueta de una imagen es una revision del
    // repositorio que la construyo. Leerla de `application.bootstrapVersion` volveria a atar los
    // cuatro Jobs al `git log` de `sgtm`.
    const version = invariantesDe(AMBIENTE).sistemas.versiones[sistema] ?? "";
    const sufijo = version.slice(0, 12);
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
    const entorno = entornoDelAmbiente(invariantesDe(AMBIENTE))(sistema);
    const implantacion = invariantesDe(AMBIENTE).implantacion;

    // La imagen de la APLICACION con el perfil `batch` (ADR-0003: un artefacto, dos perfiles).
    expect(principal.image).toBe(entorno.imagenDe(sistema));
    expect(valorDe(principal, "SPRING_PROFILES_ACTIVE")).toBe("batch");
    // EL PREFIJO SALE DEL JAVA DE CADA SISTEMA, no de este literal (C-18).
    //
    // Hasta C-18 aqui ponia `KAMAYUK_IMPLANTACION_` para los cuatro, y `rentas` **no leia asi**:
    // era el monolito y conservaba `@ConfigurationProperties("sgtm.implantacion")` —R-A/B lo
    // renombro—. Asi que esta comprobacion exigia el nombre roto, igual que la de C-17 §1 exigia
    // el anfitrion roto, y por eso deriva en vez de escribirlo aunque hoy los cuatro coincidan. El
    // sintoma del defecto que fosilizaba no es un error: `ImplantarMunicipalidad` esta
    // condicionado a `@ConditionalOnProperty("<prefijo>.ubigeo")`, asi que el runner no se
    // registra, el proceso sale con codigo 0 y el Job queda `Complete` sin haber implantado nada.
    const prefijo = variableDe(prefijoDeLaImplantacion(sistema));
    expect(valorDe(principal, `${prefijo}UBIGEO`)).toBe(implantacion.ubigeo);
    expect(valorDe(principal, `${prefijo}TIPO`)).toBe(implantacion.tipo);
    // `DatosDeImplantacion` valida en su constructor compacto: sin una de estas el bean falla y
    // el contexto no arranca. No es un Job degradado, es un Job que no corre.
    for (const variable of [
      `${prefijo}NOMBRE`,
      `${prefijo}ADMINISTRADOR`,
      `${prefijo}NOMBREDELADMINISTRADOR`,
      `${prefijo}ESDEMOSTRACION`,
      `${prefijo}URL`,
      `${prefijo}OWNERCLAVE`,
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
      expect(
        valorDe(principal, `${variableDe(prefijoDeLaImplantacion(sistema))}ESDEMOSTRACION`),
        sistema,
      ).toBe(esperado);
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
  it("ningun CronJob de un sistema lleva la credencial de `kamayuk_owner`", () => {
    for (const sistema of SISTEMAS_DEL_PRODUCTO) {
      for (const m of delSistema(AMBIENTE, sistema)) {
        if (m.kind !== "CronJob") continue;
        for (const c of m.spec.jobTemplate.spec.template.spec.containers) {
          expect(declara(c, "KAMAYUK_DB_OWNER_USUARIO"), m.metadata.name).toBe(false);
          expect(declara(c, "KAMAYUK_DB_OWNER_CLAVE"), m.metadata.name).toBe(false);
          expect(valorDe(c, "KAMAYUK_DB_USUARIO"), m.metadata.name).toBe("kamayuk_app");
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
    const entorno = entornoDelAmbiente(invariantesDe(AMBIENTE))("rentas");
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
    const demanda = demandaDelStack([...manifiestosDeLosSistemas(invariantesDe(ambiente), plataforma)]);
    expect(demanda.picoDeArranque.cpuEnMili).toBeLessThanOrEqual(TECHO_DE_LOS_SISTEMAS.cpuEnMili);
    expect(demanda.picoDeArranque.memoriaEnMi).toBeLessThanOrEqual(
      TECHO_DE_LOS_SISTEMAS.memoriaEnMi,
    );
  });

  /**
   * Y la otra mitad, remedida en `E`: **lo permanente ya cabe; el pico del arranque, no.**
   *
   * Hasta el 2026-09-06 esto decia «los cuatro no caben junto al monolito», y era cierto: lo
   * permanente pedia 1 940m contra los 1 800m que el nodo reparte. Con el monolito fuera pide
   * **1 340m**, o sea que el sistema **en regimen entra**. Lo que sigue sin entrar es el pico
   * del arranque —1 810m y 7 520Mi—, que es justo lo que `capacidad.ts` mide y por lo que la
   * brecha (#1) de `prod` sigue declarada: por CPU faltan **10m** y por memoria **1 792Mi**.
   *
   * Los dos numeros se afirman a la vez a proposito. Si solo se afirmara que no cabe, la
   * mejora que este cambio produce no se veria en ninguna parte; y si solo se afirmara que lo
   * permanente cabe, se leeria como «ya se puede desplegar», que es falso: un pod `Pending`
   * por el pico deja el `pulumi up` colgado exactamente igual (issue #252).
   *
   * El dia que el pico quepa, esta prueba se pone roja y lo que hay que hacer no es actualizar
   * el numero: es retirar la brecha, que `capacidad.test.ts` exige que siga sin caber.
   */
  it("en prod ya cabe lo permanente, y sigue sin caber el pico del arranque", () => {
    const demanda = demandaDelStack(manifiestosDelAmbiente(invariantesDe("prod")));
    const nodo = invariantesDe("prod").node;
    // 200m/160Mi de los pods de serie de k3s, como descuenta `auditarCapacidad`.
    const cpuDisponible = 2000 - 200;
    expect(nodo.allocatableCpu).toBe("2");

    expect(
      demanda.permanente.cpuEnMili,
      "lo permanente de `prod` dejo de caber por CPU: eso es un empeoramiento, no un numero " +
        "que actualizar.",
    ).toBeLessThanOrEqual(cpuDisponible);
    expect(
      demanda.picoDeArranque.cpuEnMili,
      "el pico del arranque de `prod` ya cabe por CPU. Si eso es cierto, lo que hay que " +
        "revisar es la brecha declarada (#1), no este numero.",
    ).toBeGreaterThan(cpuDisponible);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C-17 — que el despliegue PASE, no solo que se pueda intentar
// ─────────────────────────────────────────────────────────────────────────────

/** Las politicas de egreso que un sistema aplica sobre sus propios pods. */
function politicasDeEgreso(sistema: string) {
  return delSistema(AMBIENTE, sistema).filter(
    (m) => m.kind === "NetworkPolicy" && (m.spec.policyTypes ?? []).includes("Egress"),
  );
}

describe("C-17 §3 · sin DNS, ninguna otra regla de egreso puede resolver un nombre", () => {
  /**
   * El defecto medido: las cuatro politicas abrian `TCP/5432` y `TCP/8080` y **nada mas**.
   *
   * Una politica de egreso convierte a los pods que selecciona en «solo lo declarado», y todo lo
   * que esas reglas nombran —el motor, la identidad, los sistemas hermanos— se alcanza por el
   * nombre de un `Service`: resolverlo es una consulta a CoreDNS, en `kube-system`. El sintoma es
   * `UnknownHostException`, y es **intermitente** —la resolucion se cachea, asi que a veces sale
   * y a veces no—, que es peor que fallar siempre.
   *
   * Con la regla anadida a mano sobre el clúster, las OCHO tareas de los cuatro sistemas —cuatro
   * migraciones y cuatro implantaciones— pasaron de `Failed` a `Complete`.
   *
   * La plataforma lo tenia bien desde que existe (`permitirDns` en `Red.ts`): lo que fallo no fue
   * la idea, fue que estas politicas se escribieron de cero y esa parte no se copio. Por eso la
   * guarda vive aqui y no en cada repositorio — un quinto sistema tampoco la copiaria.
   */
  it.each(SISTEMAS_DEL_PRODUCTO)("«%s» abre UDP/53 y TCP/53 hacia kube-system", (sistema) => {
    const politicas = politicasDeEgreso(sistema);
    expect(politicas.length, `«${sistema}» no declara ninguna politica de egreso`).toBeGreaterThan(0);

    for (const p of politicas) {
      if (p.kind !== "NetworkPolicy") continue;
      const dns = (p.spec.egress ?? []).filter((r) =>
        (r.to ?? []).some(
          (d) => d.namespaceSelector?.matchLabels?.["kubernetes.io/metadata.name"] === "kube-system",
        ),
      );
      const protocolos = dns.flatMap((r) => (r.ports ?? []).map((x) => `${x.protocol}/${x.port}`));

      expect(
        protocolos.sort(),
        `NetworkPolicy/${p.metadata.name} restringe la salida de los pods que selecciona y NO ` +
          "abre DNS. Sus otras reglas nombran `Service` por su nombre, y resolver un nombre es " +
          "una consulta a CoreDNS en `kube-system`: sin esto no sirven de nada, y el sintoma es " +
          "`UnknownHostException` intermitente —la resolucion se cachea— en vez de un fallo " +
          "estable. TCP tambien: una respuesta que no cabe en un datagrama se reintenta por TCP.",
      ).toEqual(["TCP/53", "UDP/53"]);
    }
  });
});

describe("C-17 §5 · ningun `Deployment` de un sistema corre un perfil que termina", () => {
  /**
   * `kamayuk-rentas-batch` era un `Deployment`, y el perfil `batch` **sale**.
   *
   * Medido en el clúster: arranca, registra «No TaskScheduler/ScheduledExecutorService bean found
   * for scheduled processing», sale con **codigo 0** a los once segundos y Kubernetes lo vuelve a
   * crear. `CrashLoopBackOff` con siete reinicios, sobre un proceso que hizo exactamente lo que
   * tenia que hacer.
   *
   * Y lo dice el propio codigo de `rentas`: `CorrerElIngestor` y `CorrerLaAntiEntropia` son
   * `ApplicationRunner` del perfil `batch`, y su javadoc explica que no son `@Scheduled` porque
   * «en los cuatro backends no hay ni un `@EnableScheduling` […] y el perfil `batch` TERMINA el
   * proceso con `web-application-type: none`».
   *
   * Un `Deployment` solo admite `restartPolicy: Always`, de modo que Kubernetes no puede
   * distinguir «termino» de «se murio»: la forma miente en las dos direcciones. Donde el perfil
   * `batch` SI corre es en un `Job` —la implantacion— y en un `CronJob` —el ingestor—, que crean
   * su pod cuando hay trabajo y lo dejan morir al acabar.
   */
  it.each(SISTEMAS_DEL_PRODUCTO)("«%s»", (sistema) => {
    const enBatch: string[] = [];
    for (const m of delSistema(AMBIENTE, sistema)) {
      if (m.kind !== "Deployment") continue;
      for (const c of m.spec.template.spec.containers) {
        // Solo los que corren el jar (#16). La interfaz de `caja` es nginx y no tiene ningun
        // perfil de Spring: leer su `SPRING_PROFILES_ACTIVE` da `undefined`, y tomar ese
        // `undefined` por «un perfil que termina» denuncia un CrashLoopBackOff sobre un proceso
        // que no puede tenerlo. Ver `procesos-de-un-sistema.ts`.
        if (!correElBackend(sistema, c)) continue;
        if (valorDe(c, "SPRING_PROFILES_ACTIVE") !== "web") {
          enBatch.push(`${m.metadata.name}/${c.name} → ${valorDe(c, "SPRING_PROFILES_ACTIVE")}`);
        }
      }
    }
    expect(
      enBatch,
      "un `Deployment` en un perfil que termina es un CrashLoopBackOff garantizado: el proceso " +
        "sale con codigo 0 y `restartPolicy: Always` lo vuelve a crear. El trabajo por lotes va " +
        "en un `Job` o en un `CronJob`, que crean su pod cuando hay algo que hacer.",
    ).toEqual([]);
  });

  /** Y el contraste: el perfil `batch` sigue existiendo donde le toca. */
  it("`rentas` sigue corriendo el perfil `batch` en su Job y en su CronJob", () => {
    const suyos = delSistema(AMBIENTE, "rentas");
    const enBatch = suyos
      .flatMap((m) => podsDe(m).map((p) => ({ m, pod: p.pod })))
      .filter(({ pod }) =>
        pod.containers.some((c) => valorDe(c, "SPRING_PROFILES_ACTIVE") === "batch"),
      )
      .map(({ m }) => m.kind);
    expect(enBatch.sort()).toEqual(["CronJob", "Job"]);
  });
});
