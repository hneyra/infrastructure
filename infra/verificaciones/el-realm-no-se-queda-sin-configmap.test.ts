/**
 * El `ConfigMap` del realm lleva la huella de su contenido en el nombre (#84).
 *
 * ## El defecto, medido en `stg` el 2026-09-11
 *
 * `pulumi up` decidio **reemplazar** el `ConfigMap` `kamayuk-stg-realm`. Con el nombre fijo, un
 * reemplazo tiene que borrar antes de crear —dos objetos no pueden llamarse igual—, y el tope de
 * 15 minutos de `aplicar-stg` corto la corrida **entre las dos mitades**:
 *
 * ```
 * -- kubernetes:core/v1:ConfigMap kamayuk-stg-sistema:kamayuk-stg/kamayuk-stg-realm  deleted original (1s)
 * Warning  FailedMount  (x21 over 27m)  kubelet
 *   MountVolume.SetUp failed for volume "realm" : configmap "kamayuk-stg-realm" not found
 * ```
 *
 * El `Job` existiendo, su `ConfigMap` ausente, el pod 27 minutos en `ContainerCreating`, y
 * `kubectl get jobs` diciendo `Running`. Ninguna lectura corriente nombraba la causa.
 *
 * ## Lo que esta guarda fija
 *
 * Las tres mitades sin las que el arreglo no lo es, sobre los manifiestos que emite
 * `manifiestosDelAmbiente` —los que `index.ts` le da a Pulumi— en los DOS ambientes:
 *
 * - **(a)** el nombre lleva la huella, y la huella sale del CONTENIDO: un contenido nuevo es un
 *   objeto nuevo, asi que ya no hay reemplazo que borre antes de crear;
 * - **(b)** todo volumen que lo monta nombra **ese** nombre, y ningun objeto del ambiente nombra
 *   el fijo: un `ConfigMap` con huella y un `Job` montando el nombre viejo es el mismo estado mudo
 *   de antes, esta vez sin necesidad de cortar nada;
 * - **(c)** cambiar el contenido cambia el nombre —y el `Job` lo sigue—, y cambiar solo el pod NO.
 *
 * ## Lo que NO fija, y se dice
 *
 * Que Pulumi borre el viejo **despues** de crear el nuevo. Eso es del motor, no del manifiesto:
 * los recursos que el programa deja de declarar se borran en `performPostSteps`, que corre solo
 * cuando el programa termino y ningun paso fallo (`pkg/resource/deploy/deployment_executor.go`
 * de `pulumi/pulumi`). Se lee en su fuente; un manifiesto no lo puede decir. Y la demostracion
 * que el issue pide —matar el `apply` entre el borrado y la creacion— exige un cluster.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { recursosDe } from "../componentes/convenciones";
import { manifiestosDeIdentidad, nombreDelConfigMapDelRealm } from "../componentes/Identidad";
import { podsDe, type ConfigMap, type Job, type Manifiesto } from "../componentes/tipos";
import {
  ENVIRONMENTS,
  namespaceName,
  resourceName,
  type Environment,
} from "../config";
import { manifiestosDelAmbiente } from "../herramientas/emitir-manifiestos";
import { invariantesDe } from "./stacks";

/**
 * La misma huella que compone el descriptor (`huellaDelContenido`), escrita aparte a proposito:
 * recomponerla con la funcion de produccion haria que esta guarda aceptara lo que esa funcion
 * devuelva, fijo incluido. Es lo que hace `la-configuracion-llega-al-proceso.test.ts`.
 */
function suma(data: Readonly<Record<string, string>>): string {
  const h = createHash("sha256");
  for (const clave of Object.keys(data).sort()) {
    h.update(clave).update("\u0000").update(data[clave] ?? "").update("\u0000");
  }
  return h.digest("hex").slice(0, 16);
}

/** El nombre que tuvo hasta #84, y que ningun objeto puede volver a nombrar. */
function nombreFijo(ambiente: Environment): string {
  return resourceName(ambiente, "realm");
}

/** Nombra el realm: el fijo, o el fijo con cualquier sufijo. */
function nombraElRealm(ambiente: Environment, nombre: string): boolean {
  return nombre === nombreFijo(ambiente) || nombre.startsWith(`${nombreFijo(ambiente)}-`);
}

interface Montaje {
  /** `Job/kamayuk-stg-realm-…`, para que el rojo diga donde. */
  donde: string;
  volumen: string;
  configMap: string;
  namespace: string;
}

/** Todo `ConfigMap` que monta un pod del ambiente, por volumen directo o proyectado. */
function montajes(ms: readonly Manifiesto[]): Montaje[] {
  return ms.flatMap((m) =>
    podsDe(m).flatMap(({ contexto, pod }) =>
      (pod.volumes ?? []).flatMap((v) => {
        const volumen = v as {
          name: string;
          configMap?: { name: string };
          projected?: { sources?: { configMap?: { name: string } }[] };
        };
        const nombres = [
          volumen.configMap?.name,
          ...(volumen.projected?.sources ?? []).map((s) => s.configMap?.name),
        ].filter((n): n is string => n !== undefined);
        return nombres.map((configMap) => ({
          donde: contexto,
          volumen: volumen.name,
          configMap,
          namespace: m.metadata.namespace ?? "(cluster)",
        }));
      }),
    ),
  );
}

function configMapsDelRealm(ambiente: Environment, ms: readonly Manifiesto[]): ConfigMap[] {
  return ms.filter(
    (m): m is ConfigMap => m.kind === "ConfigMap" && nombraElRealm(ambiente, m.metadata.name),
  );
}

/** El `ConfigMap` del realm y los montajes que lo nombran, con el centinela dentro. */
function delAmbiente(ambiente: Environment): {
  ms: Manifiesto[];
  cm: ConfigMap;
  suyos: Montaje[];
} {
  const ms = manifiestosDelAmbiente(invariantesDe(ambiente));
  const cms = configMapsDelRealm(ambiente, ms);
  expect(
    cms.map((c) => c.metadata.name),
    `«${ambiente}» tiene que componer exactamente UN ConfigMap del realm. Sin ninguno, todo lo de ` +
      "abajo recorre la lista vacia en verde; con dos, uno de ellos es el nombre viejo que nadie " +
      "retira.",
  ).toHaveLength(1);
  const cm = cms[0] as ConfigMap;
  const suyos = montajes(ms).filter((x) => nombraElRealm(ambiente, x.configMap));
  expect(
    suyos.map((x) => x.donde),
    `ningun pod de «${ambiente}» monta el ConfigMap del realm: esto no esta midiendo nada`,
  ).not.toEqual([]);
  return { ms, cm, suyos };
}

/** Los argumentos con que `construirManifiestos` compone la identidad, para variarlos. */
function identidadDe(
  ambiente: Environment,
  cambio: { domain?: string; image?: string } = {},
): { cm: ConfigMap; job: Job } {
  const s = invariantesDe(ambiente);
  const ms = manifiestosDeIdentidad({
    environment: ambiente,
    namespace: namespaceName(ambiente),
    recursos: recursosDe(s.recursos.perfil),
    image: cambio.image ?? s.identity.image,
    realm: s.identity.realm,
    domain: cambio.domain ?? s.ingress.domain,
    clienteDeVerificacion: s.identity.seedTestUsers,
    correoDePrueba: s.identity.seedTestUsers,
    smtp: s.identity.smtp,
    ubigeo: s.implantacion.ubigeo,
    administrador: s.implantacion.administrador,
    cuentasDeOperacionDePrueba: s.identity.seedTestUsers,
  });
  const cm = configMapsDelRealm(ambiente, ms)[0];
  const job = ms.find(
    (m): m is Job => m.kind === "Job" && m.metadata.name.startsWith(`${nombreFijo(ambiente)}-`),
  );
  expect(cm, "la identidad no compone el ConfigMap del realm").toBeDefined();
  expect(job, "la identidad no compone el Job del realm").toBeDefined();
  return { cm: cm as ConfigMap, job: job as Job };
}

function volumenDelRealm(job: Job): string | undefined {
  return (job.spec.template.spec.volumes ?? []).find((v) => v.name === "realm")?.configMap?.name;
}

describe("#84 · cambiar el realm no deja al ambiente sin su ConfigMap", () => {
  it.each(ENVIRONMENTS)(
    "EL CENTINELA: «%s» compone un solo ConfigMap del realm, y su Job lo monta",
    (ambiente: Environment) => {
      const { suyos } = delAmbiente(ambiente);
      expect(
        suyos.some((x) => x.donde.startsWith(`Job/${nombreFijo(ambiente)}-`)),
        `el Job del realm de «${ambiente}» ya no monta su ConfigMap: esta guarda se quedaria sin ` +
          "el montaje que existe para proteger",
      ).toBe(true);
    },
  );

  it.each(ENVIRONMENTS)(
    "(a) «%s»: el nombre del ConfigMap lleva la huella de su CONTENIDO",
    (ambiente: Environment) => {
      const { cm } = delAmbiente(ambiente);
      const esperado = `${nombreFijo(ambiente)}-${suma(cm.data)}`;
      expect(
        cm.metadata.name,
        `el ConfigMap del realm de «${ambiente}» se llama «${cm.metadata.name}» y tendria que ` +
          `llamarse «${esperado}». Con un nombre que no sale de su contenido, cambiar el realm ` +
          "vuelve a ser un REEMPLAZO, y un reemplazo con nombre fijo borra antes de crear: medido " +
          "en `stg` el 2026-09-11, una corrida cortada entre las dos mitades dejo el Job 27 " +
          "minutos en `ContainerCreating` con «configmap \"kamayuk-stg-realm\" not found».",
      ).toBe(esperado);
    },
  );

  it.each(ENVIRONMENTS)(
    "(b) «%s»: todo volumen que monta el realm nombra EXACTAMENTE ese ConfigMap",
    (ambiente: Environment) => {
      const { cm, suyos } = delAmbiente(ambiente);
      const colgados = suyos.filter((x) => x.configMap !== cm.metadata.name);
      expect(
        colgados.map((x) => `${x.donde} (volumen «${x.volumen}») monta «${x.configMap}»`),
        `en «${ambiente}» hay volumenes que montan un ConfigMap del realm que NO es el que se ` +
          `emite, «${cm.metadata.name}». El pod no arranca: se queda en \`ContainerCreating\` ` +
          "y la causa solo sale en sus eventos, que es el estado mudo que #84 cierra.",
      ).toEqual([]);
    },
  );

  it.each(ENVIRONMENTS)(
    "(b) «%s»: ningun objeto del ambiente nombra el realm por su nombre fijo",
    (ambiente: Environment) => {
      const { ms } = delAmbiente(ambiente);
      const fijo = JSON.stringify(nombreFijo(ambiente));
      const quienes = ms
        .filter((m) => JSON.stringify(m).includes(fijo))
        .map((m) => `${m.kind}/${m.metadata.name}`);
      expect(
        quienes,
        `en «${ambiente}» hay objetos que nombran ${fijo} tal cual. O el ConfigMap volvio a ` +
          "llamarse asi —y cambiar su contenido vuelve a borrarlo antes de crearlo—, o algo lo " +
          "nombra por un nombre que ya no se emite y que Pulumi retira en el `up` siguiente.",
      ).toEqual([]);
    },
  );

  it.each(ENVIRONMENTS)(
    "(b) «%s»: todo ConfigMap que un pod monta existe en el ambiente, en su espacio de nombres",
    (ambiente: Environment) => {
      // La forma general de la de arriba, y medida en verde en los dos ambientes antes de
      // escribirla: once montajes en cada uno, ninguno colgado. No es de identidad: el
      // `ConfigMap` que se renombre manana con otra huella queda cubierto sin tocar esta guarda.
      const { ms } = delAmbiente(ambiente);
      const emitidos = new Set(
        ms
          .filter((m) => m.kind === "ConfigMap")
          .map((m) => `${m.metadata.namespace ?? "(cluster)"}/${m.metadata.name}`),
      );
      const colgados = montajes(ms).filter((x) => !emitidos.has(`${x.namespace}/${x.configMap}`));
      expect(
        colgados.map((x) => `${x.donde} (volumen «${x.volumen}») -> ${x.namespace}/${x.configMap}`),
        `en «${ambiente}» hay pods que montan un ConfigMap que el ambiente no emite`,
      ).toEqual([]);
    },
  );

  it.each(ENVIRONMENTS)(
    "(c) «%s»: un contenido nuevo es un ConfigMap NUEVO, y el Job monta el nuevo",
    (ambiente: Environment) => {
      const antes = identidadDe(ambiente);
      // El dominio entra en `clientes.json` —redirecciones y origenes—, y es lo que #92 cambio en
      // `prod`: el reemplazo que este issue describe, con su fecha puesta.
      const despues = identidadDe(ambiente, { domain: "otro.kamayuk.example.pe" });

      expect(
        despues.cm.data,
        "el cambio de dominio no llego al contenido: esta prueba no ejercita nada",
      ).not.toEqual(antes.cm.data);
      expect(
        despues.cm.metadata.name,
        "el contenido cambio y el nombre del ConfigMap no: `pulumi up` lo REEMPLAZARIA, y con el " +
          "nombre fijo eso borra antes de crear",
      ).not.toBe(antes.cm.metadata.name);
      expect(volumenDelRealm(despues.job), "el Job nuevo no monta el ConfigMap nuevo").toBe(
        despues.cm.metadata.name,
      );
      expect(
        JSON.stringify(despues.job),
        "el Job nuevo sigue nombrando el ConfigMap viejo",
      ).not.toContain(antes.cm.metadata.name);
    },
  );

  it("(c) el nombre cambia con UN byte de cualquier clave, y no con el orden en que se escriben", () => {
    const { cm } = delAmbiente("stg");
    const nombre = nombreDelConfigMapDelRealm("stg", cm.data);
    // Todas las claves, y no la primera: una huella sobre una lista escrita a mano cambiaria con
    // `realm.json` y no con `operadores.tsv`, y el reemplazo volveria por la clave olvidada.
    const claves = Object.keys(cm.data);
    expect(claves.length, "el ConfigMap del realm se quedo sin claves").toBeGreaterThan(10);
    const quietas = claves.filter(
      (clave) =>
        nombreDelConfigMapDelRealm("stg", { ...cm.data, [clave]: `${cm.data[clave] ?? ""} ` }) ===
        nombre,
    );
    expect(quietas, "claves cuyo cambio NO cambia el nombre del ConfigMap").toEqual([]);
    const alReves = Object.fromEntries(Object.entries(cm.data).reverse());
    expect(nombreDelConfigMapDelRealm("stg", alReves)).toBe(nombre);
  });

  it.each(ENVIRONMENTS)(
    "(c) «%s»: corregir solo el POD crea un Job nuevo sobre el MISMO ConfigMap",
    (ambiente: Environment) => {
      // La otra direccion, que es por lo que la huella del ConfigMap no es la del Job: la del Job
      // cuenta ademas su pod, y su pod nombra el ConfigMap. Con la misma huella, el nombre
      // dependeria de si mismo; y corregir el mandato moveria un ConfigMap que no cambio.
      const antes = identidadDe(ambiente);
      const despues = identidadDe(ambiente, { image: "quay.io/keycloak/keycloak:0.0.0-otra" });

      expect(despues.job.metadata.name, "el pod cambio y el Job no").not.toBe(
        antes.job.metadata.name,
      );
      expect(despues.cm.metadata.name).toBe(antes.cm.metadata.name);
    },
  );
});
