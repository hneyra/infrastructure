import { describe, expect, it } from "vitest";
import { SISTEMAS_DEL_PRODUCTO } from "../componentes/convenciones";
import { raizDelRepositorio } from "../componentes/fuentes";
import type { CronJob, Manifiesto } from "../componentes/tipos";
import { ENVIRONMENTS, type Environment } from "../config";
import { namespaceDelSistema } from "../descriptor/entorno";
import { manifiestosDelAmbiente } from "../herramientas/emitir-manifiestos";
import {
  DUENO_DE_LA_AUTORIZACION,
  consumidoresDeLaAutorizacion,
  consumidoresEn,
  hallazgos,
  hallazgosDelAmbiente,
  namespaceDelDueno,
  secretoDelConsumidor,
  type LoQueSeMira,
} from "./consumidor-de-identidad";
import { credencialesDeServicio, serviciosDeclarados, ubigeosDeclarados } from "./identidad-de-servicio";
import { invariantesDe } from "./stacks";

/**
 * AC-3 de `identidad`#4 — **el consumidor de la autorizacion CORRE, en sus tres mitades**.
 *
 * Lo que estas pruebas sostienen esta en {@link ./consumidor-de-identidad.ts}. Aqui hay dos
 * juegos, y hacen falta los dos:
 *
 *   1. **sobre manifiestos FABRICADOS**, que es lo unico que permite producir cada una de las
 *      tres roturas por separado —el CronJob que no esta, el que nace suspendido, la credencial
 *      sin cuenta— y medir que cada una da SU rojo y no otro. Es la forma de
 *      `grafo-de-egreso.test.ts` con la colision de nombre;
 *   2. **sobre los manifiestos de VERDAD** de los dos ambientes, que es lo que se despliega. Si
 *      un descriptor hermano no declara su consumidor, esto sale rojo nombrando al sistema, y
 *      ese rojo es correcto: es el estado del que la etapa 4 sale.
 */

const RAIZ = raizDelRepositorio();
const AMBIENTE: Environment = "stg";
const UBIGEOS = ["200101", "200105"];

/** Un consumidor fabricado con la forma que AC-2 de `identidad`#4 pide, y lo que se le rompa. */
function consumidorFabricado(
  sistema: string,
  rotura: { suspendido?: boolean; sinDireccion?: boolean; sinCredencial?: boolean } = {},
): CronJob {
  const namespace = namespaceDelSistema(AMBIENTE, sistema);
  const nombre = `kamayuk-${sistema}-consumidor-de-identidad`;
  return {
    apiVersion: "batch/v1",
    kind: "CronJob",
    metadata: { name: nombre, namespace, labels: { sistema } },
    spec: {
      schedule: "*/5 * * * *",
      ...(rotura.suspendido ? { suspend: true } : {}),
      concurrencyPolicy: "Forbid",
      jobTemplate: {
        spec: {
          backoffLimit: 1,
          template: {
            metadata: { labels: { app: nombre } },
            spec: {
              restartPolicy: "Never",
              priorityClassName: `kamayuk-${AMBIENTE}-lote`,
              containers: [
                {
                  name: "consumidor",
                  image: `ghcr.io/hneyra/kamayuk-${sistema}:0000000000000000000000000000000000000000`,
                  env: [
                    { name: "SPRING_PROFILES_ACTIVE", value: "batch" },
                    ...(rotura.sinDireccion
                      ? []
                      : [
                          {
                            name: "KAMAYUK_IDENTIDAD_URL",
                            value: `http://kamayuk-identidad-web.${namespaceDelDueno(AMBIENTE)}`,
                          },
                        ]),
                    ...(rotura.sinCredencial
                      ? []
                      : [
                          {
                            name: "KAMAYUK_IDENTIDAD_CREDENCIAL",
                            valueFrom: {
                              secretKeyRef: {
                                name: secretoDelConsumidor(sistema, AMBIENTE),
                                key: "clave",
                              },
                            },
                          },
                        ]),
                  ],
                  resources: {
                    requests: { cpu: "50m", memory: "128Mi" },
                    limits: { cpu: "500m", memory: "512Mi" },
                  },
                },
              ],
            },
          },
        },
      },
    },
  };
}

/** Los cuatro consumidores fabricados, sanos, con sus credenciales y sus cuentas declaradas. */
function loQueSeMiraSano(): LoQueSeMira {
  const consumidores = consumidoresDeLaAutorizacion();
  return {
    ambiente: AMBIENTE,
    manifiestos: consumidores.map((s) => consumidorFabricado(s)),
    consumidores,
    credenciales: consumidores.map((s) => ({
      sistema: s,
      llamaA: DUENO_DE_LA_AUTORIZACION,
      secreto: secretoDelConsumidor(s, AMBIENTE),
    })),
    servicios: UBIGEOS.flatMap((ubigeo) =>
      consumidores.map((s) => ({ ubigeo, sistema: s, llamaA: DUENO_DE_LA_AUTORIZACION })),
    ),
    ubigeos: UBIGEOS,
  };
}

describe("la lista de consumidores se DERIVA, y no puede quedarse vacia", () => {
  it("son todos los del producto menos el dueno", () => {
    const consumidores = consumidoresDeLaAutorizacion();
    expect(consumidores).not.toContain(DUENO_DE_LA_AUTORIZACION);
    expect([...consumidores, DUENO_DE_LA_AUTORIZACION].sort()).toEqual(
      [...SISTEMAS_DEL_PRODUCTO].sort(),
    );
    // Cuatro hoy. El sexto que entre al producto nace aqui en rojo hasta que declare el suyo,
    // que es lo que compra derivarla en vez de escribirla.
    expect(consumidores).toHaveLength(4);
  });

  it("y con la lista vacia la guarda no pasa: dice que no midio", () => {
    const sano = loQueSeMiraSano();
    expect(() => hallazgos({ ...sano, consumidores: [] })).toThrow(/No midio nada/);
  });

  it("y sin ningun ubigeo declarado, tampoco", () => {
    const sano = loQueSeMiraSano();
    expect(() => hallazgos({ ...sano, ubigeos: [] })).toThrow(/conjunto vacio/);
  });
});

describe("un consumidor se reconoce por su forma, no por su nombre", () => {
  it("un CronJob con una direccion al namespace del dueno es un consumidor", () => {
    const [c] = consumidoresEn([consumidorFabricado("caja")], AMBIENTE);
    expect(c?.sistema).toBe("caja");
    expect(c?.suspendido).toBe(false);
    expect(c?.direccion).toContain(`.${namespaceDelDueno(AMBIENTE)}`);
    expect(c?.secretos).toEqual([secretoDelConsumidor("caja", AMBIENTE)]);
  });

  it("uno sin esa direccion no lo es, aunque pida un token a Keycloak", () => {
    // `KAMAYUK_<S>_IDENTIDAD_TOKEN` es el punto de emision de Keycloak, que en la plataforma se
    // llama tambien `identidad`. El ingestor de `rentas` y el publicador de `caja` lo tienen y
    // NO consumen la autorizacion: lo que separa es la direccion al namespace del SISTEMA.
    const cron = consumidorFabricado("caja", { sinDireccion: true });
    const pod = cron.spec.jobTemplate.spec.template.spec;
    pod.containers[0]!.env!.push({
      name: "KAMAYUK_CAJA_IDENTIDAD_TOKEN",
      value: `http://kamayuk-${AMBIENTE}-identidad.kamayuk-${AMBIENTE}:8080/realms/kamayuk/protocol/openid-connect/token`,
    });
    expect(consumidoresEn([cron], AMBIENTE)).toEqual([]);
  });

  it("y un CronJob del propio dueno no cuenta como consumidor de si mismo", () => {
    const suyo = consumidorFabricado(DUENO_DE_LA_AUTORIZACION);
    expect(consumidoresEn([suyo], AMBIENTE)).toEqual([]);
  });
});

describe("las tres mitades, cada una con su rojo (AC-3)", () => {
  it("con los cuatro sanos no hay hallazgos", () => {
    expect(hallazgos(loQueSeMiraSano())).toEqual([]);
  });

  /** Primera mitad: quitar el CronJob del descriptor de `normativa` ⇒ rojo nombrandolo. */
  it("sin el CronJob de «normativa», lo nombra y dice lo que cuesta", () => {
    const sano = loQueSeMiraSano();
    const sinNormativa = sano.manifiestos.filter(
      (m: Manifiesto) => m.metadata.namespace !== namespaceDelSistema(AMBIENTE, "normativa"),
    );
    const salida = hallazgos({ ...sano, manifiestos: sinNormativa });
    expect(salida).toHaveLength(1);
    expect(salida[0]).toMatch(/^«normativa» no declara en «stg» ningun CronJob/);
    expect(salida[0]).toContain("NO EXISTE");
    expect(salida[0]).toContain("una revocacion tampoco");
  });

  /** Segunda mitad: devolver el `suspend` a uno ⇒ rojo nombrando el sistema. */
  it("con «catastro» naciendo `suspend: true`, lo nombra", () => {
    const sano = loQueSeMiraSano();
    const manifiestos = sano.manifiestos.map((m: Manifiesto) =>
      m.metadata.namespace === namespaceDelSistema(AMBIENTE, "catastro")
        ? consumidorFabricado("catastro", { suspendido: true })
        : m,
    );
    const salida = hallazgos({ ...sano, manifiestos });
    expect(salida).toHaveLength(1);
    expect(salida[0]).toMatch(/^«catastro»: el CronJob «kamayuk-catastro-consumidor-de-identidad» nace `suspend: true`/);
  });

  /** Tercera mitad, y son tres pasos porque se rompen en tres sitios distintos. */
  it("sin la credencial montada, dice que secreto falta y por que", () => {
    const sano = loQueSeMiraSano();
    const manifiestos = sano.manifiestos.map((m: Manifiesto) =>
      m.metadata.namespace === namespaceDelSistema(AMBIENTE, "rentas")
        ? consumidorFabricado("rentas", { sinCredencial: true })
        : m,
    );
    const salida = hallazgos({ ...sano, manifiestos });
    expect(salida).toHaveLength(1);
    expect(salida[0]).toContain(`«rentas»: el CronJob «kamayuk-rentas-consumidor-de-identidad» no monta la credencial «${secretoDelConsumidor("rentas", AMBIENTE)}»`);
    expect(salida[0]).toContain("401");
  });

  it("con la credencial montada y sin `emisor` en `claves(e)`, dice que se generaria aleatoria", () => {
    const sano = loQueSeMiraSano();
    const salida = hallazgos({
      ...sano,
      credenciales: sano.credenciales.filter((c) => c.sistema !== "caja"),
    });
    expect(salida).toHaveLength(1);
    expect(salida[0]).toContain("«caja»");
    expect(salida[0]).toContain('`emisor: "keycloak"`');
  });

  it("y quitando la cuenta de 200105, lo dice con el remedio dentro", () => {
    const sano = loQueSeMiraSano();
    const salida = hallazgos({
      ...sano,
      servicios: sano.servicios.filter((s) => !(s.ubigeo === "200105" && s.sistema === "rentas")),
    });
    expect(salida).toHaveLength(1);
    expect(salida[0]).toContain("«rentas»");
    expect(salida[0]).toContain("1 municipalidad(es) no declaran esa cuenta de servicio: 200105");
    expect(salida[0]).toContain('Remedio: anadir {"sistema":"rentas","llamaA":"identidad"}');
  });

  it("dos consumidores del mismo sistema tambien se nombran", () => {
    const sano = loQueSeMiraSano();
    const repetido = consumidorFabricado("caja");
    repetido.metadata.name = "kamayuk-caja-otro-consumidor";
    const salida = hallazgos({ ...sano, manifiestos: [...sano.manifiestos, repetido] });
    expect(salida).toHaveLength(1);
    expect(salida[0]).toContain("«caja» declara 2 CronJob");
  });
});

/**
 * **Y sobre lo que se despliega de verdad.**
 *
 * Aqui no se fabrica nada: los manifiestos son los que `manifiestosDelAmbiente` emite, las
 * credenciales las que los cinco descriptores declaran y las cuentas las de
 * `despliegue/identidad/municipalidades/`. Si sale rojo nombrando a un sistema, es que ese
 * descriptor todavia no trae su consumidor, y ese rojo es el trabajo de su PR hermano.
 */
describe("los cuatro consumidores corren en los dos ambientes (AC-3, sobre los manifiestos reales)", () => {
  it.each(ENVIRONMENTS)("«%s»: existen, no nacen suspendidos y su credencial tiene su cuenta", (ambiente) => {
    const salida = hallazgosDelAmbiente(RAIZ, ambiente);
    expect(salida, salida.join("\n\n")).toEqual([]);
  });

  it.each(ENVIRONMENTS)("«%s»: hay exactamente un consumidor por sistema, y son los cuatro", (ambiente) => {
    // El contraste de la mitad (1): «ningun hallazgo» tambien seria cierto si `consumidoresEn`
    // dejara de reconocer la forma y la lista de consumidores fuera vacia. Se cuenta.
    const encontrados = consumidoresEn(manifiestosDelAmbiente(invariantesDe(ambiente)), ambiente);
    expect(encontrados.map((c) => c.sistema).sort()).toEqual(consumidoresDeLaAutorizacion().sort());
  });

  it.each(ENVIRONMENTS)("«%s»: las cuatro credenciales de emisor hacia el dueno estan declaradas", (ambiente) => {
    const hacia = credencialesDeServicio(invariantesDe(ambiente))
      .filter((c) => c.llamaA === DUENO_DE_LA_AUTORIZACION)
      .map((c) => c.sistema)
      .sort();
    expect(hacia).toEqual(consumidoresDeLaAutorizacion().sort());
  });

  it("y las cuatro cuentas de servicio hacia el dueno, en cada municipalidad", () => {
    for (const ubigeo of ubigeosDeclarados(RAIZ)) {
      const hacia = serviciosDeclarados(RAIZ)
        .filter((s) => s.ubigeo === ubigeo && s.llamaA === DUENO_DE_LA_AUTORIZACION)
        .map((s) => s.sistema)
        .sort();
      expect(hacia, ubigeo).toEqual(consumidoresDeLaAutorizacion().sort());
    }
  });
});
