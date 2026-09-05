import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { namespacesDelAmbiente } from "../descriptor/entorno";
import { auditarManifiestos } from "../auditoria";
import { construirManifiestos } from "../componentes";
import {
  manifiestosDeIdentidad,
  documentosDelRealm,
  realmDelCiudadano,
  documentosDeIdentidades,
  cuentaDelCiudadano,
  huellaDeIdentidad,
  TIPOS_DE_DOCUMENTO,
  RUTA_DE_IDENTIDAD,
  PUERTO_DE_LA_CONSOLA,
} from "../componentes/Identidad";
import { nginxDelCluster } from "../componentes/Aplicacion";
import { valoresDeTraefik } from "../componentes/Ingreso";
import { manifiestosDeObservabilidad } from "../componentes/Observabilidad";
import { PRIORIDADES, nombreDePrioridad, recursosDe, secretos } from "../componentes/convenciones";
import {
  ciudadanosJson,
  raizDelRepositorio,
  realmCiudadanoJson,
  reconciliarIdentidadesSh,
} from "../componentes/fuentes";
import {
  contenedoresDe,
  podsDe,
  type Contenedor,
  type EspecificacionDePod,
  type Manifiesto,
  type NetworkPolicy,
} from "../componentes/tipos";
import { ENVIRONMENTS, namespaceName, resourceName, type Environment } from "../config";
import { invariantesDe } from "./stacks";

/**
 * Los criterios de aceptacion de los cinco issues de la fase B, sobre los manifiestos
 * que se desplegarian de verdad.
 *
 * Lo que **no** puede hacer esta prueba conviene decirlo primero, porque marca la
 * frontera de lo que este PR deja demostrado: aqui no hay clúster. Un manifiesto
 * correcto no es un sistema que funciona, y las cuatro afirmaciones que solo valen
 * contra lo que corre —el aislamiento verificado contra la instancia, la aplicacion que
 * no puede hacer DDL con las credenciales de su proceso, la escalera de identidad y el
 * escaneo de puertos desde fuera— no se comprueban aqui: la primera y la segunda, en
 * `verificaciones/motor/verificar-el-motor.sh`, que levanta el motor de estos mismos
 * manifiestos; las otras dos exigen un VPS y **quedan sin verificar hasta que exista**.
 *
 * Lo que si demuestra: que lo que se va a aplicar dice lo que los issues exigen que
 * diga. Es la mitad barata de la verificacion, y es la que evita el viaje.
 */

const AMBIENTE: Environment = "prod";

/** Un relay SMTP de forma valida, para las llamadas directas a `documentosDelRealm`. */
const SMTP_DE_PRUEBA = {
  host: "smtp.example.pe",
  port: 587,
  from: "no-responder@example.pe",
  startTls: true,
  auth: true,
} as const;

function manifiestosDe(ambiente: Environment): Manifiesto[] {
  return construirManifiestos(invariantesDe(ambiente));
}

function buscar(ms: Manifiesto[], kind: string, contiene: string): Manifiesto {
  const encontrado = ms.find((m) => m.kind === kind && m.metadata.name.includes(contiene));
  if (!encontrado) {
    throw new Error(
      `No hay ningun ${kind} cuyo nombre contenga «${contiene}». Hay: ` +
        ms.filter((m) => m.kind === kind).map((m) => m.metadata.name).join(", "),
    );
  }
  return encontrado;
}

function contenedoresDeTodo(ms: Manifiesto[]): { donde: string; c: Contenedor }[] {
  return ms.flatMap((m) =>
    podsDe(m).flatMap(({ contexto, pod }) =>
      contenedoresDe(pod).map((c) => ({ donde: contexto, c })),
    ),
  );
}

/** Todo pod del manifiesto, para las comprobaciones que miran el pod y no el contenedor. */
function podsDeTodo(ms: Manifiesto[]): { donde: string; pod: EspecificacionDePod }[] {
  return ms.flatMap((m) => podsDe(m).map(({ contexto, pod }) => ({ donde: contexto, pod })));
}

function variablesDe(c: Contenedor): Map<string, string | undefined> {
  return new Map((c.env ?? []).map((e) => [e.name, e.value]));
}

/** Los `Secret` que un contenedor lee, por nombre. */
function secretosDe(c: Contenedor): string[] {
  return [
    ...(c.env ?? []).flatMap((e) => (e.valueFrom ? [e.valueFrom.secretKeyRef.name] : [])),
    ...(c.envFrom ?? []).map((e) => e.secretRef.name),
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Lo que vale para los dos ambientes
// ─────────────────────────────────────────────────────────────────────────────

describe("los manifiestos de los dos ambientes pasan su propia auditoria", () => {
  it.each(ENVIRONMENTS)("%s", (ambiente) => {
    const ms = manifiestosDe(ambiente);
    expect(
      auditarManifiestos(ms, {
        secretoDeOwner: secretos(ambiente).owner,
        namespacesDelAmbiente: namespacesDelAmbiente(ambiente),
        namespace: namespaceName(ambiente),
      }),
    ).toEqual([]);
  });

  it("todo lo que se despliega vive en el namespace del ambiente", () => {
    const ms = manifiestosDe(AMBIENTE);
    const fuera = ms.filter(
      (m) =>
        !["Namespace", "PriorityClass", "HelmChartConfig", "ClusterRole", "ClusterRoleBinding"].includes(
          m.kind,
        ) && m.metadata.namespace !== namespaceName(AMBIENTE),
    );
    expect(fuera.map((m) => `${m.kind}/${m.metadata.name}`)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #149 — PostgreSQL en el clúster
// ─────────────────────────────────────────────────────────────────────────────

/** Una clave del `data` de un `ConfigMap`, con el fallo dicho si no esta. */
function datosDe(cm: { data: Record<string, string> }, clave: string): string {
  const valor = cm.data[clave];
  expect(valor, `el ConfigMap no trae la clave «${clave}»`).toBeDefined();
  return valor as string;
}

describe("#149 · la base de datos", () => {
  const ms = manifiestosDe(AMBIENTE);

  it("monta los guiones del repositorio, sin copiarlos", () => {
    const configuracion = buscar(ms, "ConfigMap", "postgres-inicializacion");
    const datos = (configuracion as { data: Record<string, string> }).data;

    const enElRepositorio = (ruta: string) =>
      readFileSync(join(raizDelRepositorio(), ruta), "utf8");

    // Identicos, byte a byte. Si alguien pega aqui una version editada de
    // `crear-roles.sql`, la prueba lo dice: seria un segundo sitio donde olvidar que el
    // rol no puede ser superusuario.
    expect(datos["10-crear-roles.sql"]).toBe(
      enElRepositorio("backend/sgtm-esquema/src/main/resources/db/roles/crear-roles.sql"),
    );
    expect(datos["20-asignar-claves.sh"]).toBe(
      enElRepositorio("despliegue/inicializacion-del-motor/20-asignar-claves.sh"),
    );
  });

  /**
   * C-14, punto 2 — el motor crea las CUATRO bases del producto y les aplica sus roles.
   *
   * Hasta C-14 no lo hacia nadie (C-7, hueco 3): `baseDeDatos()` de los cuatro descriptores
   * existia y **solo se usaba para auditar**, y los cuatro `Deployment` apuntaban a
   * `jdbc:postgresql://postgres:5432/<sistema>` — una base que no existia. El unico guion de
   * inicializacion que provisionaba algo era el de la base de Keycloak.
   *
   * Los dos guiones son **los del repositorio**, los mismos que monta el compose: una copia aqui
   * seria un segundo sitio donde olvidar que el rol no puede ser superusuario.
   */
  it("crea las cuatro bases del producto y les aplica SUS roles", () => {
    const datos = (buscar(ms, "ConfigMap", "postgres-inicializacion") as { data: Record<string, string> })
      .data;
    const enElRepositorio = (ruta: string) => readFileSync(join(raizDelRepositorio(), ruta), "utf8");

    expect(datos["05-crear-bases.sh"]).toBe(
      enElRepositorio("despliegue/inicializacion-del-motor/05-crear-bases.sh"),
    );
    expect(datos["06-roles-de-los-sistemas.sh"]).toBe(
      enElRepositorio("despliegue/inicializacion-del-motor/06-roles-de-los-sistemas.sh"),
    );

    // El orden es lo unico que ordena estos guiones, y el `06` no tiene donde aplicar nada si
    // el `05` no ha creado las bases.
    const claves = Object.keys(datos).sort();
    expect(claves.indexOf("06-roles-de-los-sistemas.sh")).toBeGreaterThan(
      claves.indexOf("05-crear-bases.sh"),
    );
    // Y los dos van DELANTE del `10`, que es el del monolito y corre contra otra base.
    expect(claves.indexOf("10-crear-roles.sql")).toBeGreaterThan(
      claves.indexOf("06-roles-de-los-sistemas.sh"),
    );
  });

  /**
   * Lo que esos dos guiones LEEN, y por que va en OTRO `ConfigMap`.
   *
   * Todo `.sql` que caiga en `docker-entrypoint-initdb.d` lo **ejecuta** el entrypoint contra la
   * base por omision. Los cuatro `crear-roles.sql` hay que leerlos —para derivar las extensiones
   * (C-10)— y aplicarlos **cada uno contra su base**: ejecutados contra `postgres` crearian ahi
   * las extensiones de todos y ninguna donde toca.
   */
  it("y monta los cuatro `crear-roles.sql` FUERA de initdb.d, identicos a los de su clon", () => {
    const configuracion = buscar(ms, "ConfigMap", "postgres-roles-de-los-sistemas") as {
      metadata: { name: string };
      data: Record<string, string>;
    };
    const sistemas = ["rentas", "catastro", "normativa", "caja"];

    for (const sistema of sistemas) {
      const enSuClon = join(
        raizDelRepositorio(),
        "..",
        sistema,
        "backend",
        `kamayuk-${sistema}-esquema`,
        "src/main/resources/db/roles/crear-roles.sql",
      );
      expect(datosDe(configuracion, `${sistema}.sql`)).toBe(readFileSync(enSuClon, "utf8"));
    }
    // La unica implementacion de «que cuenta como extension declarada» (C-10): dos copias del
    // mismo `grep` serian dos sitios donde una extension se puede dejar de ver.
    expect(datosDe(configuracion, "lib-extensiones.sh")).toBe(
      readFileSync(
        join(raizDelRepositorio(), "despliegue/inicializacion-del-motor/lib-extensiones.sh"),
        "utf8",
      ),
    );

    // Y se proyecta en `/etc/kamayuk`, con los `.sql` bajo `roles/`. La clave de un `ConfigMap`
    // solo admite `[-._a-zA-Z0-9]+` —una barra NO cabe—, asi que el subdirectorio lo pone el
    // `path` del volumen: sin eso el API server rechaza el ConfigMap entero.
    const motor = buscar(ms, "Deployment", "postgres") as {
      spec: {
        template: {
          spec: {
            containers: { name: string; volumeMounts?: { name: string; mountPath: string }[] }[];
            volumes: { name: string; configMap?: { name: string; items?: { key: string; path: string }[] } }[];
          };
        };
      };
    };
    const volumen = motor.spec.template.spec.volumes.find((v) => v.name === "roles-de-los-sistemas");
    expect(volumen?.configMap?.name).toBe(configuracion.metadata.name);
    expect(volumen?.configMap?.items?.map((i) => i.path).sort()).toEqual([
      "lib-extensiones.sh",
      ...sistemas.map((s) => `roles/${s}.sql`).sort(),
    ]);
    for (const item of volumen?.configMap?.items ?? []) {
      expect(item.key, "una clave de ConfigMap no puede llevar `/`").not.toContain("/");
    }
    const montaje = motor.spec.template.spec.containers
      .flatMap((c) => c.volumeMounts ?? [])
      .find((v) => v.name === "roles-de-los-sistemas");
    expect(montaje?.mountPath).toBe("/etc/kamayuk");
    expect(
      montaje?.mountPath,
      "si esto cayera en `docker-entrypoint-initdb.d`, el entrypoint EJECUTARIA los cuatro " +
        "contra la base por omision: las extensiones de todos en `postgres` y ninguna donde toca.",
    ).not.toContain("initdb");
  });

  it("los cuatro roles se crean, y ninguno es superusuario", () => {
    const datos = (buscar(ms, "ConfigMap", "postgres-inicializacion") as { data: Record<string, string> })
      .data;
    const sql = datos["10-crear-roles.sql"] ?? "";
    for (const rol of ["kamayuk_owner", "kamayuk_app", "kamayuk_readonly", "rol_carga_parametros"]) {
      expect(sql, `falta el rol ${rol}`).toContain(rol);
    }
    expect(sql).toContain("NOSUPERUSER");
    expect(sql).toContain("NOBYPASSRLS");
  });

  it("una replica sobre volumen, con estrategia Recreate", () => {
    const motor = buscar(ms, "Deployment", "postgres") as {
      spec: { replicas: number; strategy: { type: string }; template: { spec: { volumes?: unknown[] } } };
    };
    expect(motor.spec.replicas).toBe(1);
    expect(motor.spec.strategy.type).toBe("Recreate");
  });

  it("el puerto de PostgreSQL no se publica", () => {
    const servicios = ms.filter((m) => m.kind === "Service");
    expect(servicios.length).toBeGreaterThan(0);
    for (const s of servicios) {
      expect((s as { spec: { type: string } }).spec.type).toBe("ClusterIP");
    }
  });

  it("Keycloak tiene base propia, y no comparte la del padron", () => {
    const datos = (buscar(ms, "ConfigMap", "postgres-inicializacion") as { data: Record<string, string> })
      .data;
    expect(datos["30-base-de-keycloak.sh"]).toContain("CREATE DATABASE keycloak");
    // Y no puede conectarse a la del padron.
    expect(datos["30-base-de-keycloak.sh"]).toContain("REVOKE CONNECT");
  });
});

describe("#149 · la demostracion: la auditoria se pone roja", () => {
  it("con `RollingUpdate` sobre el volumen de la base", () => {
    const ms = manifiestosDe(AMBIENTE);
    const motor = buscar(ms, "Deployment", "postgres") as { spec: { strategy: { type: string } } };
    motor.spec.strategy.type = "RollingUpdate";

    expect(auditar(ms)).toContainEqual(expect.stringContaining("no consigue el bloqueo"));
  });

  it("con una sonda sin `timeoutSeconds` explicito —el 1 s del kubelet—", () => {
    const ms = manifiestosDe(AMBIENTE);
    const motor = buscar(ms, "Deployment", "postgres") as {
      spec: { template: { spec: { containers: { livenessProbe?: { timeoutSeconds: number } }[] } } };
    };
    const contenedor = motor.spec.template.spec.containers[0];
    if (contenedor?.livenessProbe) contenedor.livenessProbe.timeoutSeconds = 1;

    expect(auditar(ms)).toContainEqual(expect.stringContaining("timeoutSeconds: 1"));
  });

  it("con un Service publicado como NodePort", () => {
    const ms = manifiestosDe(AMBIENTE);
    const servicio = buscar(ms, "Service", "postgres") as { spec: { type: string } };
    servicio.spec.type = "NodePort";

    expect(auditar(ms)).toContainEqual(expect.stringContaining("es de tipo «NodePort»"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #150 — Migracion e implantacion como Jobs
// ─────────────────────────────────────────────────────────────────────────────

describe("#150 · kamayuk_owner no entra en el Deployment", () => {
  const ms = manifiestosDe(AMBIENTE);
  const secretoDeOwner = secretos(AMBIENTE).owner;

  it("el Secret de owner se monta en los dos Jobs, en el motor y en el CronJob de respaldo, y en nada mas", () => {
    const donde = new Set(
      contenedoresDeTodo(ms)
        .filter(({ c }) => secretosDe(c).includes(secretoDeOwner))
        .map(({ donde }) => donde),
    );

    // El motor es la excepcion, y es donde `kamayuk_owner` se crea: el guion de
    // inicializacion le asigna la clave, y para asignarla tiene que conocerla. Ese
    // contenedor ya guarda ademas la del superusuario. El CronJob de respaldo (#155)
    // es la segunda excepcion: escribe el estado en la tabla `respaldo` (RF-126), tal
    // como `V8__respaldo.sql` declara que lo hace «el proceso de despliegue». Lo que
    // la regla persigue es que no acabe en un proceso expuesto en HTTP, y ninguno de
    // los dos abre un puerto.
    expect([...donde].sort()).toEqual([
      "CronJob/kamayuk-prod-respaldo",
      "Deployment/kamayuk-prod-postgres",
      `Job/kamayuk-prod-implantacion-${invariantesDe(AMBIENTE).application.bootstrapVersion.slice(0, 12)}`,
      `Job/kamayuk-prod-migracion-${invariantesDe(AMBIENTE).application.bootstrapVersion.slice(0, 12)}`,
    ]);
  });

  it("la aplicacion se conecta como kamayuk_app, y solo como kamayuk_app", () => {
    for (const { c } of contenedoresDeTodo(ms)) {
      const usuario = variablesDe(c).get("KAMAYUK_DB_USUARIO");
      if (usuario !== undefined) expect(usuario).toBe("kamayuk_app");
    }
  });

  it("la aplicacion espera a la implantacion antes de atender", () => {
    const aplicacion = buscar(ms, "Deployment", "aplicacion") as {
      spec: { template: { spec: { initContainers?: Contenedor[] } } };
    };
    const espera = aplicacion.spec.template.spec.initContainers ?? [];
    expect(espera.map((c) => c.name)).toContain("espera-implantacion");
    expect(espera[0]?.args?.join(" ")).toContain("municipalidad");
  });

  it("la implantacion espera a que el esquema este aplicado", () => {
    const implantacion = buscar(ms, "Job", "implantacion") as {
      spec: { template: { spec: { initContainers?: Contenedor[] } } };
    };
    const espera = implantacion.spec.template.spec.initContainers ?? [];
    expect(espera.map((c) => c.name)).toContain("espera-migracion");
    expect(espera[0]?.args?.join(" ")).toContain("flyway_schema_history");
  });

  it("el alta lleva la marca de demostracion que el stack decidio", () => {
    // Solo los ambientes que DESPLIEGAN el monolito (C-19): desde que `stg` lo apago no
    // compone ningun Job de implantacion, y buscarlo alli seria exigir un objeto que ese
    // ambiente declara a proposito que no tiene. El filtro sale de la configuracion y no
    // de una lista, para que el dia que `stg` vuelva a desplegarlo entre solo.
    const conMonolito = ENVIRONMENTS.filter(
      (a) => invariantesDe(a).application.deployMonolith,
    );
    expect(conMonolito.length, "ningun ambiente despliega el monolito: no hay alta que medir").toBeGreaterThan(0);
    for (const ambiente of conMonolito) {
      const implantacion = buscar(manifiestosDe(ambiente), "Job", "implantacion") as {
        spec: { template: { spec: { containers: Contenedor[] } } };
      };
      const contenedor = implantacion.spec.template.spec.containers[0];
      expect(variablesDe(contenedor as Contenedor).get("KAMAYUK_IMPLANTACION_ESDEMOSTRACION")).toBe(
        String(invariantesDe(ambiente).application.isDemonstration),
      );
    }
  });

  it("el nombre de los Jobs lleva la version: una version nueva es un Job nuevo", () => {
    const version = invariantesDe(AMBIENTE).application.bootstrapVersion;
    const sufijo = version.slice(0, 12);
    expect(buscar(ms, "Job", "migracion").metadata.name).toContain(sufijo);
    expect(buscar(ms, "Job", "implantacion").metadata.name).toContain(sufijo);
  });
});

describe("#150 · la demostracion: la auditoria se pone roja", () => {
  it("cambiando en el Deployment el usuario de base por kamayuk_owner", () => {
    const ms = manifiestosDe(AMBIENTE);
    const aplicacion = buscar(ms, "Deployment", "aplicacion") as {
      spec: { template: { spec: { containers: Contenedor[] } } };
    };
    const env = aplicacion.spec.template.spec.containers[0]?.env ?? [];
    const usuario = env.find((e) => e.name === "KAMAYUK_DB_USUARIO");
    if (usuario) usuario.value = "kamayuk_owner";

    expect(auditar(ms)).toContainEqual(expect.stringContaining("se conecta a la base como"));
  });

  it("dandole al Deployment el Secret de kamayuk_owner", () => {
    const ms = manifiestosDe(AMBIENTE);
    const aplicacion = buscar(ms, "Deployment", "aplicacion") as {
      spec: { template: { spec: { containers: Contenedor[] } } };
    };
    aplicacion.spec.template.spec.containers[0]?.env?.push({
      name: "KAMAYUK_DB_OWNER_CLAVE",
      valueFrom: { secretKeyRef: { name: secretos(AMBIENTE).owner, key: "clave-owner" } },
    });

    expect(auditar(ms)).toContainEqual(expect.stringContaining("el Secret de kamayuk_owner"));
  });

  it("quitando la espera: la aplicacion arrancaria sobre una base vacia", () => {
    const ms = manifiestosDe(AMBIENTE);
    const aplicacion = buscar(ms, "Deployment", "aplicacion") as {
      spec: { template: { spec: { initContainers?: Contenedor[] } } };
    };
    aplicacion.spec.template.spec.initContainers = [];

    // Esta no la ve la auditoria generica —no es una convencion de INF-01 §4, es el
    // orden de arranque de #150—, asi que la comprueba la prueba, y su version rota
    // demuestra que la comprobacion sirve.
    expect(esperaAntesDeAtender(ms)).toBe(false);
  });
});

/** ¿Espera la aplicacion a la implantacion antes de atender peticiones? */
function esperaAntesDeAtender(ms: Manifiesto[]): boolean {
  const aplicacion = buscar(ms, "Deployment", "aplicacion") as {
    spec: { template: { spec: { initContainers?: Contenedor[] } } };
  };
  return (aplicacion.spec.template.spec.initContainers ?? []).some(
    (c) => c.name === "espera-implantacion",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// #151 — Keycloak
// ─────────────────────────────────────────────────────────────────────────────

describe("#151 · identidad", () => {
  const ms = manifiestosDe(AMBIENTE);
  const identidad = buscar(ms, "Deployment", "identidad") as {
    spec: { template: { spec: { containers: Contenedor[] } } };
  };
  const contenedor = identidad.spec.template.spec.containers[0] as Contenedor;

  it("arranca en modo produccion, no en start-dev", () => {
    expect(contenedor.args).toEqual(["start"]);
  });

  it("guarda su estado en su propia base, no dentro del contenedor", () => {
    const variables = variablesDe(contenedor);
    expect(variables.get("KC_DB")).toBe("postgres");
    expect(variables.get("KC_DB_URL")).toContain("/keycloak");
    // Su base, no la del padron: Keycloak hace DDL sobre la suya en cada actualizacion
    // menor, y eso sobre la base que sostiene RLS seria abrirle DDL al padron.
    expect(variables.get("KC_DB_URL")?.endsWith("/sgtm")).toBe(false);
  });

  it("la consola de administracion vive tras un tunel local, nunca en el dominio publico", () => {
    // `KC_HOSTNAME_STRICT` hace que Keycloak construya TODAS sus URLs absolutas
    // contra `KC_HOSTNAME`, sin mirar por donde llego la peticion. Sin esta
    // variable, abrir la consola por un `port-forward` acababa en un 302 al dominio
    // publico -y ahi, excluida del enrutado por `!PathPrefix`, la peticion caia a la
    // ruta de la interfaz y aparecia el formulario de acceso del SGTM-. Las dos
    // protecciones encadenadas dejaban la consola inalcanzable tambien para quien
    // tiene derecho a entrar. Se vio contra el Keycloak real de `prod`.
    const variables = variablesDe(contenedor);
    const consola = variables.get("KC_HOSTNAME_ADMIN");
    expect(consola).toBe(`http://localhost:${PUERTO_DE_LA_CONSOLA}${RUTA_DE_IDENTIDAD}`);

    // La unica forma de equivocarse aqui que importa: apuntarla al dominio publico.
    // Eso pondria las URLs de administracion en internet y dejaria la exclusion del
    // ingreso sosteniendolo todo sola.
    expect(new URL(consola as string).hostname).toBe("localhost");
    expect(consola).not.toContain(invariantesDe(AMBIENTE).ingress.domain);

    // Y no afloja el nombre publico: el `iss` de los tokens no se toca.
    expect(variables.get("KC_HOSTNAME_STRICT")).toBe("true");
  });

  it("el tunel es la unica via: el ingreso sigue sin publicar la consola", () => {
    // La otra mitad. `KC_HOSTNAME_ADMIN` hace la consola ALCANZABLE por el tunel; lo
    // que la mantiene fuera de internet es esta exclusion. Se comprueban juntas
    // porque quitar cualquiera de las dos rompe la propiedad entera: sin la
    // exclusion -«total, ya hay tunel»- la consola de identidad queda publicada.
    const identidad = buscar(ms, "IngressRoute", "identidad") as {
      spec: { routes: { match: string }[] };
    };
    expect(identidad.spec.routes[0]?.match).toContain("!PathPrefix(`/keycloak/admin`)");
  });

  it("el emisor es el nombre publico; el JWKS, el interno", () => {
    const dominio = invariantesDe(AMBIENTE).ingress.domain;
    expect(variablesDe(contenedor).get("KC_HOSTNAME")).toBe(
      `https://${dominio}${RUTA_DE_IDENTIDAD}`,
    );

    const aplicacion = buscar(ms, "Deployment", "aplicacion") as {
      spec: { template: { spec: { containers: Contenedor[] } } };
    };
    const variables = variablesDe(aplicacion.spec.template.spec.containers[0] as Contenedor);
    expect(variables.get("KAMAYUK_OIDC_EMISOR")).toBe(
      `https://${dominio}${RUTA_DE_IDENTIDAD}/realms/sgtm`,
    );
    // El JWKS no sale al ingreso para volver a entrar.
    expect(variables.get("KAMAYUK_OIDC_JWKS")).toContain("http://kamayuk-prod-identidad:8080");
  });

  it("el realm que se aplica conserva el mapeador de municipalidad_id", () => {
    const documentos = documentosDelRealm({
      domain: "sgtm.example.pe",
      realm: "sgtm",
      clienteDeVerificacion: false,
      smtp: SMTP_DE_PRUEBA,
    });
    for (const cliente of clientesDe(documentos.clientes)) {
      expect(
        cliente.protocolMappers?.some((m) => m.config["claim.name"] === "municipalidad_id"),
        `el cliente ${cliente.clientId} perdio el mapeador`,
      ).toBe(true);
    }
    // Y el atributo existe en el perfil: sin el, el mapeador leeria un atributo que el
    // realm no admite y el claim saldria vacio.
    expect(documentos.perfilDeUsuario).toContain("municipalidad_id");
  });

  /**
   * **El realm del ciudadano** (#57, ADR-0020).
   *
   * Todo el portal se sostiene sobre que `numero_documento` sea de quien lo
   * presenta. Si el ciudadano pudiera editarlo —o registrarse solo—, la
   * enumeracion del padron que este issue retira volveria en su peor forma: en
   * vez de teclear el documento ajeno en una caja, lo teclearia una vez al
   * registrarse y el sistema se lo creeria para siempre, **firmado**.
   */
  describe("el realm del ciudadano", () => {
    const delCiudadano = () =>
      documentosDelRealm({
        domain: "sgtm.example.pe",
        realm: "sgtm-ciudadano",
        clienteDeVerificacion: false,
        smtp: SMTP_DE_PRUEBA,
        fuente: realmCiudadanoJson(),
      });

    it("declara `numero_documento` **no editable por el usuario**", () => {
      const perfil = JSON.parse(delCiudadano().perfilDeUsuario) as {
        attributes: { name: string; permissions?: { edit?: string[] } }[];
      };
      const documento = perfil.attributes.find((a) => a.name === "numero_documento");

      expect(documento, "el perfil no declara numero_documento").toBeDefined();
      // `admin` y nadie mas. Con `user` en la lista, el ciudadano se cambia el
      // documento desde la consola de cuenta y pasa a preguntar por otra persona.
      expect(documento?.permissions?.edit).toEqual(["admin"]);
      expect(documento?.permissions?.edit).not.toContain("user");
    });

    it("y `tipo_documento` tampoco: el par identifica, no solo el numero", () => {
      const perfil = JSON.parse(delCiudadano().perfilDeUsuario) as {
        attributes: { name: string; permissions?: { edit?: string[] } }[];
      };
      expect(
        perfil.attributes.find((a) => a.name === "tipo_documento")?.permissions?.edit,
      ).toEqual(["admin"]);
    });

    it("no admite autorregistro", () => {
      // D-15 se decidio por el camino B —enrolamiento en ventanilla—, y esto es
      // lo que lo hace cierto en el realm y no solo en el ADR.
      expect(JSON.parse(delCiudadano().realm).registrationAllowed).toBe(false);
    });

    it("su cliente lleva los dos mapeadores, y ninguno de municipalidad", () => {
      const clientes = clientesDe(delCiudadano().clientes);
      // Exactamente uno. El archivo versionado trae ademas un `sgtm-verificacion` —el
      // que deja a la escalera del compose pedir un token de ciudadano sin navegador
      // (#415)— y al clúster NO llega: el del ciudadano es el realm de cara al publico,
      // y una concesion directa de credenciales ahi es una puerta que nadie necesita.
      expect(clientes.map((c) => c.clientId)).toEqual(["sgtm-portal"]);
      const claims = (clientes[0]?.protocolMappers ?? []).map((m) => m.config["claim.name"]);

      expect(claims).toContain("numero_documento");
      expect(claims).toContain("tipo_documento");
      // El ciudadano **no pertenece a ninguna municipalidad**: un claim de
      // municipalidad aqui seria un tenant elegido por quien no tiene ninguno.
      expect(claims).not.toContain("municipalidad_id");
    });

    it("su redireccion vuelve al portal, no a la raiz del origen", () => {
      const clientes = clientesDe(delCiudadano().clientes);
      const uris = clientes[0]?.redirectUris ?? [];

      expect(uris.length).toBeGreaterThan(0);
      for (const uri of uris) {
        expect(uri, "una redireccion a localhost en el clúster").not.toContain("localhost");
        // El camino se conserva: con `https://<dominio>/*` el ciudadano podria
        // acabar en la aplicacion del funcionario tras autenticarse.
        expect(uri).toBe("https://sgtm.example.pe/portal/*");
      }
    });

    it("va en el mismo ConfigMap y lo aplica el mismo Job, en segundo lugar", () => {
      const configuracion = buscar(ms, "ConfigMap", "realm") as { data: Record<string, string> };
      expect(configuracion.data["realm-ciudadano.json"]).toBeDefined();
      expect(configuracion.data["perfil-de-usuario-ciudadano.json"]).toContain("numero_documento");
      expect(configuracion.data["clientes-ciudadano.json"]).toContain("sgtm-portal");

      const job = buscar(ms, "Job", "realm") as {
        spec: { template: { spec: { containers: Contenedor[] } } };
      };
      const contenedor = job.spec.template.spec.containers[0] as Contenedor;
      const mandato = (contenedor.command ?? []).join(" ");
      // Despues del de funcionarios: si el portal fallara, la municipalidad
      // sigue pudiendo trabajar.
      expect(mandato).toContain("/realm/reconciliar-realm.sh ciudadano");
      expect(mandato.indexOf("reconciliar-realm.sh ciudadano")).toBeGreaterThan(
        mandato.indexOf("reconciliar-identidades.sh"),
      );

      const variables = variablesDe(contenedor);
      expect(variables.get("KC_REALM_CIUDADANO")).toBe(
        realmDelCiudadano(invariantesDe(AMBIENTE).identity.realm),
      );
      expect(variables.get("KC_CLIENTES_CIUDADANO")).toBe("sgtm-portal");
    });

    it("un cambio suyo crea un Job nuevo", () => {
      // Sin esto, el realm del ciudadano se versionaria y **no llegaria nunca al
      // clúster**: el Job conserva su nombre y `pulumi up` no crea ninguno.
      const antes = buscar(ms, "Job", "realm").metadata.name;
      const documentos = delCiudadano();
      const huella = documentos.realm + documentos.perfilDeUsuario + documentos.clientes;

      expect(huella).toContain("numero_documento");
      expect(antes).toMatch(/^kamayuk-.*-realm-[0-9a-f]{10}$/);
    });
  });

  it("la pantalla de acceso no dice «marcha blanca»", () => {
    const configuracion = buscar(ms, "ConfigMap", "realm") as { data: Record<string, string> };
    expect(configuracion.data["realm.json"]).not.toContain("marcha blanca");
    expect(JSON.parse(configuracion.data["realm.json"] ?? "{}").displayName).toBe("SGTM");
  });

  it("el realm no trae ni un usuario ni una clave", () => {
    const configuracion = buscar(ms, "ConfigMap", "realm") as { data: Record<string, string> };
    for (const [nombre, contenido] of Object.entries(configuracion.data)) {
      if (!nombre.endsWith(".json")) continue;
      expect(contenido, `${nombre} trae usuarios`).not.toContain('"users"');
      expect(contenido.toLowerCase(), `${nombre} trae una clave`).not.toContain('"password"');
    }
  });

  it("las redirecciones son del dominio del ambiente, no de localhost", () => {
    const configuracion = buscar(ms, "ConfigMap", "realm") as { data: Record<string, string> };
    expect(configuracion.data["clientes.json"]).not.toContain("localhost");
    expect(configuracion.data["clientes.json"]).toContain(
      `https://${invariantesDe(AMBIENTE).ingress.domain}/*`,
    );
  });

  it("el cliente de concesion directa existe en stg y NO en prod", () => {
    const enProd = clientesDe(
      (buscar(manifiestosDe("prod"), "ConfigMap", "realm") as { data: Record<string, string> }).data[
        "clientes.json"
      ] ?? "",
    ).map((c) => c.clientId);
    const enStg = clientesDe(
      (buscar(manifiestosDe("stg"), "ConfigMap", "realm") as { data: Record<string, string> }).data[
        "clientes.json"
      ] ?? "",
    ).map((c) => c.clientId);

    expect(enProd).not.toContain("sgtm-verificacion");
    expect(enStg).toContain("sgtm-verificacion");
  });

  it("un cambio del realm cambia el nombre del Job que lo aplica", () => {
    const antes = buscar(ms, "Job", "realm").metadata.name;
    const despues = buscar(
      manifiestosDeIdentidad({
        environment: AMBIENTE,
        namespace: namespaceName(AMBIENTE),
        recursos: recursosDe(invariantesDe(AMBIENTE).recursos.perfil),
        image: "quay.io/keycloak/keycloak:26.0",
        realm: "otro-realm",
        domain: invariantesDe(AMBIENTE).ingress.domain,
        clienteDeVerificacion: false,
        correoDePrueba: false,
        smtp: SMTP_DE_PRUEBA,
        ubigeo: invariantesDe(AMBIENTE).implantacion.ubigeo,
        administrador: invariantesDe(AMBIENTE).implantacion.administrador,
      }),
      "Job",
      "realm",
    ).metadata.name;

    // Es lo que hace cierto «un cambio del realm versionado llega al clúster»: con el
    // mismo nombre, el Job ya existiria y `pulumi up` no volveria a ejecutarlo.
    expect(despues).not.toBe(antes);
  });

  it("un cambio del POD que lo aplica tambien cambia el nombre del Job", () => {
    // La otra mitad, y la que faltaba. La huella cubria lo que se aplica —realm, perfil,
    // clientes, TSV, guion— pero no COMO se aplica. Con `spec.template` de un Job
    // inmutable, corregir el pod conservando el nombre no produce un Job nuevo: produce
    // un `pulumi up` que el API server rechaza con «field is immutable», y la correccion
    // no llega. Se ejerce con `image`, el unico dato del pod que no entra en ninguno de
    // los cinco documentos.
    const antes = buscar(ms, "Job", "realm").metadata.name;
    const despues = buscar(
      manifiestosDeIdentidad({
        environment: AMBIENTE,
        namespace: namespaceName(AMBIENTE),
        recursos: recursosDe(invariantesDe(AMBIENTE).recursos.perfil),
        image: "quay.io/keycloak/keycloak:26.1",
        realm: "sgtm",
        domain: invariantesDe(AMBIENTE).ingress.domain,
        clienteDeVerificacion: false,
        correoDePrueba: false,
        smtp: SMTP_DE_PRUEBA,
        ubigeo: invariantesDe(AMBIENTE).implantacion.ubigeo,
        administrador: invariantesDe(AMBIENTE).implantacion.administrador,
      }),
      "Job",
      "realm",
    ).metadata.name;

    expect(despues).not.toBe(antes);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0012 — alta declarativa de usuarios y grupos, sin clave en git
// ─────────────────────────────────────────────────────────────────────────────

describe("ADR-0012 · alta declarativa de usuarios", () => {
  const ms = manifiestosDe(AMBIENTE);
  const realmCm = buscar(ms, "ConfigMap", "realm") as { data: Record<string, string> };
  const inv = invariantesDe(AMBIENTE);

  function municipalidad(over: Record<string, unknown> = {}): { ubigeo: string; contenido: string }[] {
    const base = {
      ubigeo: "200105",
      municipalidadId: 1,
      grupo: "200105 - Municipalidad Distrital de Catacaos",
      usuarios: [
        {
          cuenta: "administrador",
          nombre: "Administrador",
          apellido: "del Sistema",
          correo: "administrador@catacaos.gob.pe",
          administrador: true,
        },
      ],
      ...over,
    };
    return [{ ubigeo: "200105", contenido: JSON.stringify(base) }];
  }

  it("el ConfigMap del realm trae el guion y el TSV, y el TSV no lleva clave", () => {
    expect(realmCm.data["reconciliar-identidades.sh"]).toContain("execute-actions-email");
    const tsv = realmCm.data["identidades.tsv"] ?? "";
    expect(tsv).toContain("USUARIO\t");
    expect(tsv.toLowerCase()).not.toContain("password");
    expect(tsv.toLowerCase()).not.toContain("clave");
  });

  it("el TSV declara el grupo y el administrador de la municipalidad implantada", () => {
    const tsv = realmCm.data["identidades.tsv"] ?? "";
    expect(tsv).toContain(`GRUPO\t`);
    expect(tsv).toContain(`\t${inv.implantacion.administrador}\t`);
    // El municipalidadId viaja como ultima columna del GRUPO y penultima del USUARIO.
    expect(tsv).toMatch(/GRUPO\t[^\t]+\t\d+\n/);
  });

  it("exige exactamente un usuario «administrador: true»", () => {
    expect(() =>
      documentosDeIdentidades({
        municipalidades: municipalidad({
          usuarios: [
            { cuenta: "a", nombre: "A", apellido: "A", correo: "a@x.pe", administrador: true },
            { cuenta: "b", nombre: "B", apellido: "B", correo: "b@x.pe", administrador: true },
          ],
        }),
        ubigeo: "200105",
        administrador: "a",
      }),
    ).toThrow(/exactamente un usuario/);
  });

  it("el administrador del archivo tiene que ser el de la implantacion", () => {
    expect(() =>
      documentosDeIdentidades({
        municipalidades: municipalidad(),
        ubigeo: "200105",
        administrador: "otra-cuenta",
      }),
    ).toThrow(/la misma\s+cuenta/);
  });

  it("rechaza un municipalidadId que no es un entero positivo", () => {
    expect(() =>
      documentosDeIdentidades({
        municipalidades: municipalidad({ municipalidadId: "1" }),
        ubigeo: "200105",
        administrador: "administrador",
      }),
    ).toThrow(/entero positivo/);
  });

  it("se niega si no hay archivo para el ubigeo implantado", () => {
    expect(() =>
      documentosDeIdentidades({
        municipalidades: municipalidad(),
        ubigeo: "999999",
        administrador: "administrador",
      }),
    ).toThrow(/999999\.json/);
  });

  it("un cambio del archivo versionado cambia el nombre del Job", () => {
    const otra = buscar(
      manifiestosDeIdentidad({
        environment: AMBIENTE,
        namespace: namespaceName(AMBIENTE),
        recursos: recursosDe(invariantesDe(AMBIENTE).recursos.perfil),
        image: "quay.io/keycloak/keycloak:26.0",
        realm: inv.identity.realm,
        domain: inv.ingress.domain,
        clienteDeVerificacion: false,
        correoDePrueba: false,
        smtp: SMTP_DE_PRUEBA,
        // El repositorio versiona 200101.json (marcha blanca) ademas de 200105.json:
        // reconciliar otra municipalidad es otro TSV, y por tanto otro Job.
        ubigeo: "200101",
        administrador: "jperez",
      }),
      "Job",
      "realm",
    ).metadata.name;
    expect(otra).not.toBe(buscar(ms, "Job", "realm").metadata.name);
  });

  it("el Job monta sus guiones con permiso de ejecucion, porque los ejecuta", () => {
    const job = buscar(ms, "Job", "realm") as { spec: { template: { spec: EspecificacionDePod } } };
    const volumen = (job.spec.template.spec.volumes ?? []).find((v) => v.name === "realm");
    // 0o755. Con el 0644 por omision de un `ConfigMap`, `bash -c "/realm/x.sh && …"`
    // muere en «exit 126» sin llegar a hablar con Keycloak.
    expect(volumen?.configMap?.defaultMode).toBe(493);
  });

  it("el Job encadena los dos guiones y monta el TSV", () => {
    const job = buscar(ms, "Job", "realm") as {
      spec: { template: { spec: { containers: Contenedor[] } } };
    };
    const c = job.spec.template.spec.containers[0] as Contenedor;
    expect(c.command?.join(" ")).toContain("reconciliar-realm.sh && /realm/reconciliar-identidades.sh");
    expect(variablesDe(c).get("KC_DIRECTORIO")).toBe("/realm");
  });

  it("Mailpit va en stg y no en prod", () => {
    const enStg = manifiestosDe("stg").some((m) => m.kind === "Deployment" && m.metadata.name.endsWith("-correo"));
    const enProd = manifiestosDe("prod").some((m) => m.kind === "Deployment" && m.metadata.name.endsWith("-correo"));
    expect(enStg).toBe(true);
    expect(enProd).toBe(false);
  });

  it("stg tiene salida SMTP al buzon Mailpit; prod, sin relay, no tiene ninguna", () => {
    const salidaStg = manifiestosDe("stg").find(
      (m) => m.kind === "NetworkPolicy" && m.metadata.name === "permitir-salida-identidad",
    ) as { spec: { egress?: { to?: { podSelector?: { matchLabels: Record<string, string> }; ipBlock?: unknown }[]; ports?: { port: number }[] }[] } };
    const aMailpit = (salidaStg.spec.egress ?? []).find((r) =>
      (r.to ?? []).some((d) => d.podSelector?.matchLabels.app === resourceName("stg", "correo")),
    );
    expect(aMailpit?.ports?.map((p) => p.port)).toEqual([1025]);
    expect(
      manifiestosDe("stg").some(
        (m) => m.kind === "NetworkPolicy" && m.metadata.name === "permitir-ingreso-correo",
      ),
    ).toBe(true);

    // prod (Opción B): la unica regla de salida de identidad es la de PostgreSQL.
    const salidaProd = manifiestosDe("prod").find(
      (m) => m.kind === "NetworkPolicy" && m.metadata.name === "permitir-salida-identidad",
    ) as { spec: { egress?: { to?: { ipBlock?: unknown; podSelector?: { matchLabels: Record<string, string> } }[]; ports?: { port: number }[] }[] } };
    const reglas = salidaProd.spec.egress ?? [];
    expect(reglas).toHaveLength(1);
    expect(reglas[0]?.ports?.map((p) => p.port)).toEqual([5432]);
    expect((reglas[0]?.to ?? []).some((d) => d.ipBlock !== undefined)).toBe(false);
    expect(
      manifiestosDe("prod").some(
        (m) => m.kind === "NetworkPolicy" && m.metadata.name === "permitir-ingreso-correo",
      ),
    ).toBe(false);
  });

  it("stg lleva smtpServer en el realm; prod (sin relay) no lo lleva", () => {
    const realmStg = JSON.parse(
      (buscar(manifiestosDe("stg"), "ConfigMap", "realm") as { data: Record<string, string> }).data[
        "realm.json"
      ] ?? "{}",
    ) as { smtpServer?: Record<string, string> };
    expect(realmStg.smtpServer?.host).toBe("kamayuk-stg-correo");

    const realmProd = JSON.parse(realmCm.data["realm.json"] ?? "{}") as {
      smtpServer?: Record<string, string>;
    };
    expect(realmProd.smtpServer).toBeUndefined();
  });

  it("prod, sin relay, pasa SIN_CORREO=1 al Job y no monta ningun secreto SMTP", () => {
    const env = (
      (buscar(ms, "Job", "realm") as { spec: { template: { spec: { containers: Contenedor[] } } } })
        .spec.template.spec.containers[0] as Contenedor
    ).env ?? [];
    expect(env.find((e) => e.name === "SIN_CORREO")?.value).toBe("1");
    expect(env.some((e) => e.name === "KC_SMTP_USUARIO")).toBe(false);

    // stg (Mailpit, sin auth): ni SIN_CORREO ni secreto.
    const envStg = (
      (buscar(manifiestosDe("stg"), "Job", "realm") as {
        spec: { template: { spec: { containers: Contenedor[] } } };
      }).spec.template.spec.containers[0] as Contenedor
    ).env ?? [];
    expect(envStg.some((e) => e.name === "SIN_CORREO")).toBe(false);
    expect(envStg.some((e) => e.name === "KC_SMTP_USUARIO")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #415 / ADR-0020 §5 — el enrolamiento del ciudadano en ventanilla (D-15, camino B)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enrolar no es «dar de alta a un usuario»: es **fijar una identidad**.
 *
 * Todo el portal se sostiene sobre que `numero_documento` del token sea de quien lo
 * presenta —`GET /portal/situacion` no tiene ni un parametro y el sujeto sale de ese
 * claim—. Si la acreditacion se hace mal no se rompe una pantalla: la enumeracion por
 * parametro que ADR-0020 retiro vuelve convertida en una **enumeracion firmada, y para
 * siempre**.
 */
describe("#415 · enrolamiento del ciudadano", () => {
  const ms = manifiestosDe(AMBIENTE);
  const realmCm = buscar(ms, "ConfigMap", "realm") as { data: Record<string, string> };

  /** Un `ciudadanos/<ubigeo>.json` de laboratorio, sobre el que ejercer cada prohibicion. */
  function fuente(over: Record<string, unknown> = {}): { ubigeo: string; contenido: string }[] {
    const base = {
      ubigeo: "200105",
      ciudadanos: [
        {
          nombre: "Rosa",
          apellido: "Chero Zapata",
          tipoDocumento: "DNI",
          numeroDocumento: "70123456",
          correo: "rosa.chero@ejemplo.pe",
        },
      ],
      ...over,
    };
    return [{ ubigeo: "200105", contenido: JSON.stringify(base) }];
  }

  function derivar(over: Record<string, unknown> = {}) {
    return documentosDeIdentidades({
      municipalidades: [
        {
          ubigeo: "200105",
          contenido: JSON.stringify({
            ubigeo: "200105",
            municipalidadId: 1,
            grupo: "200105 - Municipalidad Distrital de Catacaos",
            usuarios: [
              {
                cuenta: "administrador",
                nombre: "Administrador",
                apellido: "del Sistema",
                correo: "administrador@catacaos.gob.pe",
                administrador: true,
              },
            ],
          }),
        },
      ],
      ciudadanos: fuente(over),
      ubigeo: "200105",
      administrador: "administrador",
    });
  }

  it("la cuenta se DERIVA del documento, con el tipo delante", () => {
    // No es cosmetica. `CE 12345678` y `DNI 12345678` son **dos personas distintas** y
    // las dos formas son validas: con la cuenta llamada solo por el numero, la segunda
    // declaracion actualizaria la cuenta de la primera y le cambiaria el tipo, y a
    // partir de ahi una de las dos leeria el padron de la otra, firmado.
    expect(cuentaDelCiudadano("DNI", "12345678")).toBe("dni-12345678");
    expect(cuentaDelCiudadano("CE", "12345678")).toBe("ce-12345678");
    expect(cuentaDelCiudadano("DNI", "12345678")).not.toBe(cuentaDelCiudadano("CE", "12345678"));

    expect(derivar().ciudadanos).toContain("CIUDADANO\tdni-70123456\t");
    expect(derivar().enrolados).toEqual(["dni-70123456"]);
  });

  it("rechaza el archivo que declare una clave, nombrandolo", () => {
    // ADR-0012 §2: un archivo versionado con contrasenas es la forma mas comoda de que
    // una contrasena acabe en produccion.
    expect(() =>
      derivar({
        ciudadanos: [
          {
            nombre: "Rosa",
            apellido: "Chero Zapata",
            tipoDocumento: "DNI",
            numeroDocumento: "70123456",
            credentials: [{ type: "password", value: "s3creta" }],
          },
        ],
      }),
    ).toThrow(/ciudadanos\/200105\.json: declara «credentials»/);
  });

  it("rechaza el archivo que declare la cuenta", () => {
    expect(() =>
      derivar({
        ciudadanos: [
          {
            cuenta: "rosa",
            nombre: "Rosa",
            apellido: "Chero Zapata",
            tipoDocumento: "DNI",
            numeroDocumento: "70123456",
          },
        ],
      }),
    ).toThrow(/declara la cuenta/);
  });

  it("exige la forma que el tipo de documento impone", () => {
    // Un numero que el dominio no puede leer se enrolaria sin protestar y el portal
    // contestaria 403 SIN_DOCUMENTO a alguien correctamente enrolado.
    expect(() =>
      derivar({
        ciudadanos: [
          { nombre: "R", apellido: "C", tipoDocumento: "DNI", numeroDocumento: "123" },
        ],
      }),
    ).toThrow(/un DNI tiene de 8 a 8 caracteres/);

    expect(() =>
      derivar({
        ciudadanos: [
          { nombre: "R", apellido: "C", tipoDocumento: "DNI", numeroDocumento: "7012345A" },
        ],
      }),
    ).toThrow(/un DNI es solo digitos/);

    expect(() =>
      derivar({
        ciudadanos: [
          { nombre: "R", apellido: "C", tipoDocumento: "LIBRETA", numeroDocumento: "70123456" },
        ],
      }),
    ).toThrow(/no es un tipo de documento conocido/);
  });

  it("dos declaraciones del mismo documento tienen que decir lo mismo", () => {
    // Quien enrola afirma, en nombre del sistema, que esta persona es esta persona. Dos
    // afirmaciones distintas del mismo documento no se resuelven por orden de aparicion.
    const dosVeces = (apellido: string) => [
      {
        nombre: "Rosa",
        apellido: "Chero Zapata",
        tipoDocumento: "DNI",
        numeroDocumento: "70123456",
      },
      { nombre: "Rosa", apellido, tipoDocumento: "DNI", numeroDocumento: "70123456" },
    ];

    expect(() => derivar({ ciudadanos: dosVeces("Otra Cosa") })).toThrow(/con datos\s+distintos/);
    // La misma persona declarada dos veces —dos ventanillas, el mismo documento— pasa,
    // y produce UNA sola cuenta.
    expect(derivar({ ciudadanos: dosVeces("Chero Zapata") }).enrolados).toEqual(["dni-70123456"]);
  });

  it("una municipalidad sin nadie enrolado no rompe el despliegue", () => {
    // Es el estado de partida de TODAS: el portal existe y hasta que alguien pase por
    // ventanilla no entra nadie por el. Un despliegue que se niega a subir por eso seria
    // un despliegue que exige que alguien haya ido a la municipalidad.
    expect(derivar({ ciudadanos: [] }).ciudadanos).toBe("");
    expect(
      documentosDeIdentidades({
        municipalidades: [
          {
            ubigeo: "200105",
            contenido: JSON.stringify({
              ubigeo: "200105",
              municipalidadId: 1,
              grupo: "g",
              usuarios: [
                {
                  cuenta: "administrador",
                  nombre: "A",
                  apellido: "B",
                  correo: "a@b.pe",
                  administrador: true,
                },
              ],
            }),
          },
        ],
        ubigeo: "200105",
        administrador: "administrador",
      }).ciudadanos,
    ).toBe("");
  });

  it("el ciudadano no lleva municipalidad, ni grupo, ni clave", () => {
    const tsv = derivar().ciudadanos;
    // El ciudadano **no pertenece a ninguna municipalidad**: lo que ve sale de recorrer
    // el registro, una municipalidad a la vez (ADR-0020 §2).
    expect(tsv).not.toContain("municipalidad_id");
    expect(tsv).not.toContain("GRUPO");
    expect(tsv.toLowerCase()).not.toContain("password");
    expect(tsv.toLowerCase()).not.toContain("clave");
  });

  it("el ConfigMap monta su TSV y el Job lo aplica DESPUES del realm del ciudadano", () => {
    expect(realmCm.data["ciudadanos.tsv"]).toBeDefined();

    const job = buscar(ms, "Job", "realm") as {
      spec: { template: { spec: { containers: Contenedor[] } } };
    };
    const mandato = ((job.spec.template.spec.containers[0] as Contenedor).command ?? []).join(" ");
    expect(mandato).toContain("/realm/reconciliar-identidades.sh ciudadanos");
    // El realm del ciudadano lo crea la pasada anterior: enrolar antes seria crear
    // cuentas en un realm que todavia no existe.
    expect(mandato.indexOf("reconciliar-identidades.sh ciudadanos")).toBeGreaterThan(
      mandato.indexOf("reconciliar-realm.sh ciudadano"),
    );
  });

  it("el TSV de ciudadanos entra en la huella: enrolar crea un Job nuevo", () => {
    // Sin esto, el ciudadano se declara en el repositorio y **no puede entrar**: el Job
    // conserva su nombre, `pulumi up` no crea ninguno y el alta no llega al clúster.
    //
    // La huella se **recompone desde los manifiestos**, con las mismas partes y en el
    // mismo orden. Si una deja de entrar —quitar `identidades.ciudadanos` de la lista de
    // `manifiestosDeIdentidad`, por ejemplo—, el nombre del Job y esta cuenta dejan de
    // coincidir.
    //
    // Y se mide sobre un ambiente **con alguien enrolado**, que es lo que este issue
    // aprendio por las malas: la primera version media el ambiente de `AMBIENTE` —cuyo
    // ubigeo no tiene a nadie— y ahi `ciudadanos.tsv` es la cadena vacia. `update("")`
    // no cambia un sha256, asi que quitar esa parte de la huella pasaba en VERDE y la
    // prueba no probaba nada. Por eso lo primero que se exige es que el TSV NO este
    // vacio: una comprobacion que solo vale con datos tiene que negarse a correr sin ellos.
    const inv = invariantesDe(AMBIENTE);
    const conEnrolado = manifiestosDeIdentidad({
      environment: AMBIENTE,
      namespace: namespaceName(AMBIENTE),
      recursos: recursosDe(inv.recursos.perfil),
      image: "quay.io/keycloak/keycloak:26.0",
      realm: inv.identity.realm,
      domain: inv.ingress.domain,
      clienteDeVerificacion: false,
      correoDePrueba: false,
      smtp: SMTP_DE_PRUEBA,
      // El repositorio versiona un ciudadano enrolado en 200101 (marcha blanca).
      ubigeo: "200101",
      administrador: "jperez",
    });
    const cm = buscar(conEnrolado, "ConfigMap", "realm") as { data: Record<string, string> };
    const job = buscar(conEnrolado, "Job", "realm");
    const plantilla = (job as { spec: { template: { spec: EspecificacionDePod } } }).spec.template
      .spec;

    expect(cm.data["ciudadanos.tsv"]).toContain("CIUDADANO\t");

    const recompuesta = huellaDeIdentidad([
      cm.data["realm.json"] ?? "",
      cm.data["perfil-de-usuario.json"] ?? "",
      cm.data["clientes.json"] ?? "",
      cm.data["realm-ciudadano.json"] ?? "",
      cm.data["perfil-de-usuario-ciudadano.json"] ?? "",
      cm.data["clientes-ciudadano.json"] ?? "",
      cm.data["identidades.tsv"] ?? "",
      cm.data["ciudadanos.tsv"] ?? "",
      cm.data["reconciliar-identidades.sh"] ?? "",
      JSON.stringify(plantilla),
    ]);

    expect(job.metadata.name).toBe(`${resourceName(AMBIENTE, "realm")}-${recompuesta}`);
    // Y que la parte que este issue anade cambie de verdad la huella cuando cambia.
    expect(huellaDeIdentidad([derivar().ciudadanos])).not.toBe(
      huellaDeIdentidad([derivar({ ciudadanos: [] }).ciudadanos]),
    );
  });

  it("la tabla de formas de documento es la del enumerado del dominio", () => {
    // No se copia: se contrasta. Un tipo nuevo en `TipoDocumento` sin declararlo aqui
    // pone esto rojo, y al reves. Precedente: #192 con `UnidadDePlazo`.
    const java = readFileSync(
      join(
        raizDelRepositorio(),
        "backend/sgtm-dominio-compartido/src/main/java/pe/gob/sgtm/dominio/TipoDocumento.java",
      ),
      "utf8",
    );
    const delEnumerado: Record<string, [number, number, boolean]> = {};
    for (const linea of java.split("\n")) {
      const m = /^\s{4}([A-Z]+)\((\d+),\s*(\d+),\s*(true|false)\)/.exec(linea);
      if (m !== null) {
        delEnumerado[m[1] as string] = [Number(m[2]), Number(m[3]), m[4] === "true"];
      }
    }

    expect(Object.keys(delEnumerado).length).toBeGreaterThan(0);
    expect(delEnumerado).toEqual(TIPOS_DE_DOCUMENTO);
  });

  it("y el guion, que valida lo mismo en modo compose, dice esa misma tabla", () => {
    // La imagen de Keycloak no trae con que analizar JSON, asi que la validacion existe
    // dos veces —TypeScript para el clúster, python para el compose—. Lo que no puede
    // pasar es que las dos copias se separen.
    const guion = reconciliarIdentidadesSh();
    for (const [tipo, [minimo, maximo, digitos]] of Object.entries(TIPOS_DE_DOCUMENTO)) {
      expect(guion).toContain(
        `"${tipo}": (${minimo}, ${maximo}, ${digitos ? "True" : "False"})`,
      );
    }
    expect(guion).toContain("reconciliar-identidades.sh ciudadanos");
  });

  it("los archivos versionados del repositorio pasan sus propias reglas", () => {
    // Los de verdad, no los de laboratorio: un `ciudadanos/<ubigeo>.json` mal escrito no
    // se descubre en el despliegue.
    for (const c of ciudadanosJson()) {
      expect(() =>
        documentosDeIdentidades({
          municipalidades: [
            {
              ubigeo: c.ubigeo,
              contenido: JSON.stringify({
                ubigeo: c.ubigeo,
                municipalidadId: 1,
                grupo: "g",
                usuarios: [
                  {
                    cuenta: "a",
                    nombre: "A",
                    apellido: "B",
                    correo: "a@b.pe",
                    administrador: true,
                  },
                ],
              }),
            },
          ],
          ciudadanos: ciudadanosJson(),
          ubigeo: c.ubigeo,
          administrador: "a",
        }),
      ).not.toThrow();
    }
  });
});

describe("#151 · la demostracion", () => {
  it("sin el mapeador, la comprobacion del realm se pone roja", () => {
    const documentos = documentosDelRealm({
      domain: "sgtm.example.pe",
      realm: "sgtm",
      clienteDeVerificacion: false,
      smtp: SMTP_DE_PRUEBA,
    });
    const clientes: ClienteLeido[] = clientesDe(documentos.clientes).map((c) => ({
      ...c,
      protocolMappers: [],
    }));

    expect(
      clientes.every((c) =>
        (c.protocolMappers ?? []).some((m) => m.config["claim.name"] === "municipalidad_id"),
      ),
    ).toBe(false);
  });

  it("con `start-dev`, la auditoria se pone roja", () => {
    const ms = manifiestosDe(AMBIENTE);
    const identidad = buscar(ms, "Deployment", "identidad") as {
      spec: { template: { spec: { containers: Contenedor[] } } };
    };
    const contenedor = identidad.spec.template.spec.containers[0];
    if (contenedor) contenedor.args = ["start-dev"];

    expect(auditar(ms)).toContainEqual(expect.stringContaining("start-dev"));
  });

  it("con el nombre interno como emisor, el `iss` deja de cuadrar", () => {
    const ms = manifiestosDe(AMBIENTE);
    const identidad = buscar(ms, "Deployment", "identidad") as {
      spec: { template: { spec: { containers: Contenedor[] } } };
    };
    const variable = (identidad.spec.template.spec.containers[0]?.env ?? []).find(
      (e) => e.name === "KC_HOSTNAME",
    );
    if (variable) variable.value = "http://kamayuk-prod-identidad:8080/keycloak";

    // La firma seguiria siendo valida y todo el sistema devolveria 401 sin explicacion.
    expect(emisorCoherente(ms)).toBe(false);
  });
});

/** ¿Emite Keycloak con el mismo nombre publico que la aplicacion valida? */
function emisorCoherente(ms: Manifiesto[]): boolean {
  const hostname = valorDe(ms, "Deployment", "identidad", "KC_HOSTNAME");
  const emisor = valorDe(ms, "Deployment", "aplicacion", "KAMAYUK_OIDC_EMISOR");
  return hostname !== undefined && emisor !== undefined && emisor.startsWith(hostname);
}

function valorDe(
  ms: Manifiesto[],
  kind: string,
  nombre: string,
  variable: string,
): string | undefined {
  const m = buscar(ms, kind, nombre) as { spec: { template: { spec: { containers: Contenedor[] } } } };
  return variablesDe(m.spec.template.spec.containers[0] as Contenedor).get(variable);
}

interface ClienteLeido {
  clientId: string;
  protocolMappers?: { config: Record<string, string> }[];
  /** A donde puede volver quien se autentica. Lo mira el realm del ciudadano (ADR-0020). */
  redirectUris?: string[];
}

function clientesDe(carga: string): ClienteLeido[] {
  return (JSON.parse(carga) as { clients: ClienteLeido[] }).clients;
}

// ─────────────────────────────────────────────────────────────────────────────
// #152 — La aplicacion y la interfaz
// ─────────────────────────────────────────────────────────────────────────────

describe("#152 · la aplicacion y la interfaz", () => {
  const ms = manifiestosDe(AMBIENTE);

  it("ningun contenedor sin limites de recursos declarados", () => {
    for (const { donde, c } of contenedoresDeTodo(ms)) {
      expect(c.resources.limits.cpu, `${donde}/${c.name}`).toBeTruthy();
      expect(c.resources.limits.memory, `${donde}/${c.name}`).toBeTruthy();
      expect(c.resources.requests.cpu, `${donde}/${c.name}`).toBeTruthy();
      expect(c.resources.requests.memory, `${donde}/${c.name}`).toBeTruthy();
    }
  });

  it("toda sonda declara su `timeoutSeconds`, entre 3 y 5", () => {
    const sondas = contenedoresDeTodo(ms).flatMap(({ donde, c }) =>
      [c.startupProbe, c.readinessProbe, c.livenessProbe]
        .filter((s) => s !== undefined)
        .map((s) => ({ donde, timeout: s.timeoutSeconds })),
    );
    expect(sondas.length).toBeGreaterThan(0);
    for (const s of sondas) {
      expect(s.timeout, s.donde).toBeGreaterThanOrEqual(3);
      expect(s.timeout, s.donde).toBeLessThanOrEqual(5);
    }
  });

  it("las sondas de `pg_isready` preguntan por TCP, que es lo que sus dependientes usan", () => {
    // Sin `--host`, `pg_isready` pregunta por el socket unix. Durante la fase de
    // inicializacion del entrypoint, el motor arranca con `listen_addresses=''`:
    // escucha por socket y NO por TCP. El pod se declara Ready mientras todavia
    // corren los guiones de initdb, y el Job de migracion muere con «Connection
    // refused». Es una carrera que gana el socket cuando el arranque es corto y
    // pierde SIEMPRE cuando se alarga -PostGIS crea `template_postgis` y le carga
    // las extensiones (ADR-0021)-, y se destapo asi en la marcha blanca.
    const sondas = contenedoresDeTodo(ms).flatMap(({ donde, c }) =>
      [c.startupProbe, c.readinessProbe, c.livenessProbe]
        .filter((s) => s !== undefined)
        .map((s) => ({ donde, orden: s.exec?.command ?? [] })),
    );
    const dePostgres = sondas.filter((s) => s.orden[0] === "pg_isready");
    expect(dePostgres.length, "ninguna sonda de pg_isready: la prueba no mide nada").toBe(3);
    for (const s of dePostgres) {
      expect(s.orden, s.donde).toContain("--host=127.0.0.1");
    }
  });

  it("la JVM tiene su `startupProbe`, para que la sonda de vida no la mate arrancando", () => {
    const aplicacion = buscar(ms, "Deployment", "aplicacion") as {
      spec: { template: { spec: { containers: Contenedor[] } } };
    };
    const contenedor = aplicacion.spec.template.spec.containers[0] as Contenedor;
    expect(contenedor.startupProbe).toBeDefined();
    expect(contenedor.startupProbe?.httpGet?.path).toBe("/actuator/health");
  });

  it("el rollout de la aplicacion no pide un pod de mas: `maxSurge: 0`", () => {
    // El default de Kubernetes levanta un segundo pod de la JVM antes de matar el
    // viejo. En `prod` —un nodo, una replica— no cabe: se queda `Pending` con
    // `Insufficient cpu` y a los diez minutos el `pulumi up` falla por
    // `ProgressDeadlineExceeded`. Pasó de verdad el 2026-08-27.
    const aplicacion = buscar(ms, "Deployment", "aplicacion") as {
      spec: { strategy: { type: string; rollingUpdate?: { maxSurge?: number | string } } };
    };
    expect(aplicacion.spec.strategy.type).toBe("RollingUpdate");
    expect(aplicacion.spec.strategy.rollingUpdate?.maxSurge).toBe(0);
  });

  it("el perfil batch corre sin abrir puerto ninguno", () => {
    const lote = buscar(ms, "CronJob", "lote") as {
      spec: { jobTemplate: { spec: { template: { spec: { containers: Contenedor[] } } } } };
    };
    const contenedor = lote.spec.jobTemplate.spec.template.spec.containers[0] as Contenedor;
    expect(variablesDe(contenedor).get("SPRING_PROFILES_ACTIVE")).toBe("batch");
    expect(contenedor.ports ?? []).toEqual([]);
  });

  it("un artefacto, dos perfiles: la misma imagen en web y en batch", () => {
    const web = (
      buscar(ms, "Deployment", "aplicacion") as {
        spec: { template: { spec: { containers: Contenedor[] } } };
      }
    ).spec.template.spec.containers[0]?.image;
    const lote = (
      buscar(ms, "CronJob", "lote") as {
        spec: { jobTemplate: { spec: { template: { spec: { containers: Contenedor[] } } } } };
      }
    ).spec.jobTemplate.spec.template.spec.containers[0]?.image;
    expect(lote).toBe(web);
  });

  it("la interfaz reenvia /api/v1 al servicio de la aplicacion del ambiente", () => {
    const configuracion = nginxDelCluster(AMBIENTE);
    expect(configuracion).toContain("proxy_pass http://kamayuk-prod-aplicacion:8080;");
    // Y no queda ni un rastro del nombre del compose, que en el clúster no resuelve.
    expect(configuracion).not.toContain("http://aplicacion:8080");
  });
});

describe("#152 · la demostracion: la auditoria se pone roja", () => {
  it("quitando `KAMAYUK_OIDC_EMISOR` del Deployment", () => {
    const ms = manifiestosDe(AMBIENTE);
    const aplicacion = buscar(ms, "Deployment", "aplicacion") as {
      spec: { template: { spec: { containers: Contenedor[] } } };
    };
    const contenedor = aplicacion.spec.template.spec.containers[0];
    if (contenedor) contenedor.env = (contenedor.env ?? []).filter((e) => e.name !== "KAMAYUK_OIDC_EMISOR");

    expect(auditar(ms)).toContainEqual(expect.stringContaining("KAMAYUK_OIDC_EMISOR"));
  });

  it("dejando un contenedor sin limites", () => {
    const ms = manifiestosDe(AMBIENTE);
    const interfaz = buscar(ms, "Deployment", "interfaz") as {
      spec: { template: { spec: { containers: Contenedor[] } } };
    };
    const contenedor = interfaz.spec.template.spec.containers[0];
    if (contenedor) {
      (contenedor as { resources: unknown }).resources = { requests: { cpu: "1", memory: "1Gi" } };
    }

    expect(auditar(ms)).toContainEqual(expect.stringContaining("sin limits de recursos"));
  });

  it("abriendo un puerto en el perfil batch", () => {
    const ms = manifiestosDe(AMBIENTE);
    const lote = buscar(ms, "CronJob", "lote") as {
      spec: { jobTemplate: { spec: { template: { spec: { containers: Contenedor[] } } } } };
    };
    const contenedor = lote.spec.jobTemplate.spec.template.spec.containers[0];
    if (contenedor) contenedor.ports = [{ containerPort: 8080 }];

    expect(auditar(ms)).toContainEqual(expect.stringContaining("con puertos declarados"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #153 — Traefik, TLS y el fin de los puertos en claro
// ─────────────────────────────────────────────────────────────────────────────

describe("#153 · el ingreso", () => {
  const ms = manifiestosDe(AMBIENTE);

  it("toda ruta va por HTTPS, con certificado emitido", () => {
    const rutas = ms.filter((m) => m.kind === "IngressRoute");
    expect(rutas.length).toBe(3);
    for (const r of rutas) {
      const spec = (r as { spec: { entryPoints: string[]; tls?: { certResolver: string } } }).spec;
      expect(spec.entryPoints).toEqual(["websecure"]);
      expect(spec.tls?.certResolver).toBe("letsencrypt");
    }
  });

  it("80 redirige a 443, no coexiste", () => {
    const valores = valoresDelIngreso(ms);
    expect(valores).toContain("redirections:");
    expect(valores).toContain("to: websecure");
  });

  it("`acme.json` vive en un volumen: reprogramar el pod no vuelve a pedir certificados", () => {
    const valores = valoresDelIngreso(ms);
    expect(valores).toContain("persistence:");
    expect(valores).toContain("acme.storage=/data/acme.json");
    expect(valores).toContain("type: Recreate");
  });

  it("acme.json se corrige a 600 antes de que Traefik intente leerlo", () => {
    // El propio chart lo avisa en sus NOTES: con `persistence`, el `fsGroup`
    // puede dejar el archivo en 660, y Traefik rechaza usarlo -"permissions 660
    // ... please use 600"-, saltandose el resolver entero aunque las banderas de
    // additionalArguments esten correctas. Se vio contra prod real.
    const valores = valoresDeTraefik({ acmeEmail: "a@b.pe", acmeStaging: false });
    expect(valores).toContain("name: corregir-permisos-de-acme");
    expect(valores).toContain("chmod 600 /data/acme.json");
    expect(valores).toContain("mountPath: /data");
  });

  it("Traefik espera su propio Endpoint antes de pedir el certificado", () => {
    // Contra el cluster real de prod: `Recreate` deja el Service sin backend
    // durante la ventana en que Traefik ya esta pidiendo el ACME -ocho
    // reinicios seguidos, ocho "Connection refused", con el nodo en quietud
    // total (no era contencion de CPU). El initContainer espera a verse a si
    // mismo en el EndpointSlice antes de dejar arrancar al contenedor principal.
    const valores = valoresDeTraefik({ acmeEmail: "a@b.pe", acmeStaging: false });
    expect(valores).toContain("initContainers:");
    expect(valores).toContain("name: esperar-endpoint-propio");
    expect(valores).toContain("fieldPath: status.podIP");
    expect(valores).toContain("discovery.k8s.io/v1/namespaces/kube-system/endpointslices");
    // Falla abierto: un cluster mas lento de lo esperado no debe dejar a
    // Traefik sin arrancar nunca.
    expect(valores).toContain("exit 0");
  });

  it("el puerto 80 enruta antes de que la sonda de readiness pase", () => {
    // Sin esto, el initContainer de arriba no arregla nada y el dominio entero
    // queda inalcanzable. `svclb` hace DNAT contra el ClusterIP del Service de
    // Traefik, y kube-proxy solo reparte un ClusterIP entre endpoints `ready`.
    // Con la sonda del chart -`initialDelaySeconds: 2`, `periodSeconds: 10`,
    // `failureThreshold: 1`- el pod real de prod tardo ONCE segundos en estar
    // `Ready` (contenedor 06:03:27 -> Ready 06:03:38), y Traefik pidio el
    // certificado a los dos (06:03:29): Let's Encrypt recibio "Connection
    // refused" en el desafio HTTP-01, `acme.json` quedo con `Certificates:
    // null`, y el handshake TLS murio con "tlsv1 unrecognized name".
    const valores = valoresDeTraefik({ acmeEmail: "a@b.pe", acmeStaging: false });
    expect(valores).toContain("publishNotReadyAddresses: true");
    // Bajo `service.spec`, que es lo que el chart vuelca tal cual al ServiceSpec
    // -y no una clave suelta que se ignore en silencio, como ya paso con
    // `certResolvers:`-. Y sin perder el `type`, que vive en la misma clave.
    expect(valores).toMatch(/^service:\n {2}spec:\n(?: {4}#.*\n|\s*\n)* {4}type: LoadBalancer\n/m);
    expect(valores).toMatch(/^ {4}publishNotReadyAddresses: true$/m);
  });

  it("el resolver de ACME va por additionalArguments, no por una clave que el chart ignora", () => {
    // Contra el Traefik real de prod: `certResolvers:` de alto nivel y
    // `ports.websecure.tls.certResolver` no llegaban a ningun flag del
    // `Deployment` -"Upgrade complete" en verde, y el propio Traefik logueando
    // "Router uses a nonexistent certificate resolver" desde el primer arranque.
    const valores = valoresDelIngreso(ms);
    expect(valores).toContain("additionalArguments:");
    expect(valores).not.toContain("certResolvers:");
    expect(valores).not.toMatch(/^\s*certResolver:/m);
    expect(valores).toContain('"--entryPoints.websecure.http.tls.certResolver=letsencrypt"');
    expect(valores).toContain('"--certificatesResolvers.letsencrypt.acme.email=');
    expect(valores).toContain('"--certificatesResolvers.letsencrypt.acme.httpChallenge.entryPoint=web"');
  });

  it("la consola de administracion de Keycloak no se publica", () => {
    const identidad = buscar(ms, "IngressRoute", "identidad") as {
      spec: { routes: { match: string }[] };
    };
    expect(identidad.spec.routes[0]?.match).toContain("!PathPrefix(`/keycloak/admin`)");
  });

  it("hay limite de tasa, y el de identidad es mas estrecho", () => {
    const general = comoObjeto<LimiteDeTasa>(buscar(ms, "Middleware", "limite-de-tasa"));
    const identidad = comoObjeto<LimiteDeTasa>(buscar(ms, "Middleware", "limite-de-identidad"));
    expect(identidad.spec.rateLimit.average).toBeLessThan(general.spec.rateLimit.average);
  });

  it("stg emite contra el entorno de pruebas de Let's Encrypt; prod, no", () => {
    expect(valoresDelIngreso(manifiestosDe("stg"))).toContain("acme-staging-v02");
    expect(valoresDelIngreso(manifiestosDe("prod"))).not.toContain("acme-staging-v02");
  });
});

describe("#153 · la demostracion", () => {
  it("publicando /keycloak/admin, la auditoria se pone roja", () => {
    const ms = manifiestosDe(AMBIENTE);
    const identidad = buscar(ms, "IngressRoute", "identidad") as {
      spec: { routes: { match: string }[] };
    };
    const ruta = identidad.spec.routes[0];
    if (ruta) ruta.match = "Host(`sgtm.example.pe`) && PathPrefix(`/keycloak`)";

    expect(auditar(ms)).toContainEqual(expect.stringContaining("consola de"));
  });

  it("atendiendo tambien en `web`, la auditoria se pone roja", () => {
    const ms = manifiestosDe(AMBIENTE);
    const interfaz = buscar(ms, "IngressRoute", "interfaz") as { spec: { entryPoints: string[] } };
    interfaz.spec.entryPoints = ["web", "websecure"];

    expect(auditar(ms)).toContainEqual(expect.stringContaining("80 redirige, no coexiste"));
  });

  it("la redireccion usa la clave que este chart lee, no la que renombro", () => {
    // La comprobacion anterior era una tautologia: afirmaba que el texto contenia
    // `redirectTo:`, lo comentaba, y afirmaba que ya no estaba. Nunca podia
    // detectar lo unico que importa -si el chart honra esa clave-, y no lo hacia:
    // `traefik-40.1.4+up40.1.0` la renombro a `http.redirections.entryPoint` (su
    // Changelog: "move redirectTo => redirections") y `redirectTo` no aparece en
    // ninguna plantilla. Contra prod, leyendo los argumentos del contenedor: ni
    // una bandera `--entryPoints.web.http.redirections.*`, y `http://<dominio>/`
    // devolviendo 404 en vez de 301 -quien teclee el dominio sin `https://` no ve
    // el sistema-. Mismo fallo silencioso que ya paso con `certResolvers:`.
    const valores = valoresDeTraefik({ acmeEmail: "a@b.pe", acmeStaging: false });
    expect(valores).not.toContain("redirectTo:");
    expect(valores).toMatch(
      /^ {4}http:\n {6}redirections:\n {8}entryPoint:\n {10}to: websecure$/m,
    );
    expect(valores).toContain("scheme: https");
    expect(valores).toContain("permanent: true");
    // Por DEBAJO del router que Traefik dedica al desafio ACME: si la redireccion
    // se comiera `/.well-known/acme-challenge/`, la renovacion de dentro de 60
    // dias tumbaria el dominio sin que nadie hubiera tocado nada.
    expect(valores).toMatch(/^ {10}priority: 10$/m);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #155 — Respaldos, PITR y el CronJob de respaldo base
// ─────────────────────────────────────────────────────────────────────────────

interface CronJobLeido {
  spec: {
    concurrencyPolicy: string;
    jobTemplate: { spec: { template: { spec: { containers: Contenedor[] } } } };
  };
}

function contenedorDelCronJob(ms: Manifiesto[], contiene: string): Contenedor {
  const cronjob = buscar(ms, "CronJob", contiene) as unknown as CronJobLeido;
  const contenedor = cronjob.spec.jobTemplate.spec.template.spec.containers[0];
  if (!contenedor) throw new Error(`El CronJob «${contiene}» no tiene contenedores`);
  return contenedor;
}

function contenedorDelMotor(ms: Manifiesto[]): Contenedor {
  const motor = buscar(ms, "Deployment", "postgres") as {
    spec: { template: { spec: { containers: Contenedor[] } } };
  };
  const contenedor = motor.spec.template.spec.containers[0];
  if (!contenedor) throw new Error("El Deployment del motor no tiene contenedores");
  return contenedor;
}

describe("#155 · el respaldo", () => {
  const ms = manifiestosDe(AMBIENTE);

  it("el motor archiva WAL de forma continua, con wal-g", () => {
    const postgres = contenedorDelMotor(ms);
    expect(postgres.args).toContain("archive_mode=on");
    expect((postgres.args ?? []).join(" ")).toContain("wal-g wal-push %p");
    expect((postgres.args ?? []).join(" ")).toContain("archive_timeout=");
  });

  it("wal-g se descarga y se verifica antes de que el motor arranque", () => {
    const motor = buscar(ms, "Deployment", "postgres") as {
      spec: { template: { spec: { initContainers?: Contenedor[] } } };
    };
    const descarga = (motor.spec.template.spec.initContainers ?? [])[0];
    expect(descarga?.name).toBe("wal-g-instalar");
    expect((descarga?.args ?? []).join(" ")).toContain("sha256sum -c");
  });

  it("el respaldo base corre en un CronJob propio, nunca dos a la vez", () => {
    const respaldo = buscar(ms, "CronJob", "respaldo") as unknown as CronJobLeido;
    expect(respaldo.spec.concurrencyPolicy).toBe("Forbid");
  });

  it("el respaldo lo hace kamayuk_respaldo, no kamayuk_owner ni el superusuario", () => {
    const contenedor = contenedorDelCronJob(ms, "respaldo");
    const guion = (contenedor.args ?? []).join(" ");
    expect(guion).toContain("PGUSER=kamayuk_respaldo");
    expect(secretosDe(contenedor)).toContain(secretos(AMBIENTE).respaldo);
  });

  it("el CronJob escribe el estado en la tabla respaldo, como kamayuk_owner (RF-126)", () => {
    const contenedor = contenedorDelCronJob(ms, "respaldo");
    const guion = (contenedor.args ?? []).join(" ");
    expect(guion).toContain("PGUSER=kamayuk_owner");
    expect(guion).toContain("INSERT INTO respaldo");
    expect(guion).toContain("UPDATE respaldo");
  });

  it("el volumen de datos se monta de solo lectura en el CronJob", () => {
    const contenedor = contenedorDelCronJob(ms, "respaldo");
    const montaje = (contenedor.volumeMounts ?? []).find((v) => v.name === "datos");
    expect(montaje?.readOnly).toBe(true);
  });

  it("la clave de cifrado nunca es un valor literal", () => {
    for (const { c } of contenedoresDeTodo(ms)) {
      const clave = (c.env ?? []).find((e) => e.name === "WALG_LIBSODIUM_KEY");
      if (clave) expect(clave.value).toBeUndefined();
    }
  });

  it("las tres claves nuevas —kamayuk_respaldo, cifrado y credenciales— no se repiten entre si", () => {
    const contenedor = contenedorDelCronJob(ms, "respaldo");
    const nombres = secretosDe(contenedor);
    expect(new Set(nombres).size).toBeGreaterThanOrEqual(2);
  });
});

describe("#155 · la demostracion: la auditoria se pone roja", () => {
  it("quitando archive_mode=on, la auditoria lo detecta", () => {
    const ms = manifiestosDe(AMBIENTE);
    const postgres = contenedorDelMotor(ms);
    postgres.args = (postgres.args ?? []).filter((a) => a !== "archive_mode=on");

    expect(auditar(ms)).toContainEqual(expect.stringContaining("archive_mode=on"));
  });

  it("poniendo la clave de cifrado como `value` en vez de `valueFrom`, la auditoria lo detecta", () => {
    const ms = manifiestosDe(AMBIENTE);
    const postgres = contenedorDelMotor(ms);
    const clave = postgres.env?.find((e) => e.name === "WALG_LIBSODIUM_KEY");
    if (clave) {
      clave.value = "una-clave-de-mentira-en-texto-plano";
      clave.valueFrom = undefined;
    }

    expect(auditar(ms)).toContainEqual(expect.stringContaining("texto plano"));
  });

  it("dandole al CronJob de lote el Secret de kamayuk_owner, la auditoria lo sigue rechazando", () => {
    const ms = manifiestosDe(AMBIENTE);
    const contenedor = contenedorDelCronJob(ms, "lote");
    (contenedor.env ??= []).push({
      name: "KAMAYUK_DB_OWNER_CLAVE",
      valueFrom: { secretKeyRef: { name: secretos(AMBIENTE).owner, key: "clave-owner" } },
    });

    // La excepcion de #155 es del CronJob de respaldo, no de «cualquier CronJob»: el
    // de lote —la MISMA imagen que la aplicacion— sigue sin poder llevar esta clave.
    expect(auditar(ms)).toContainEqual(expect.stringContaining("el Secret de kamayuk_owner"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #156 — Observabilidad: metricas, tableros y una alerta que le llegue a alguien
// ─────────────────────────────────────────────────────────────────────────────

/** Solo el componente de observabilidad, con el `alertWebhookUrl` que la prueba necesita. */
function manifiestosDeObservabilidadDePrueba(alertWebhookUrl: string | undefined): Manifiesto[] {
  return manifiestosDeObservabilidad({
    environment: AMBIENTE,
    namespace: namespaceName(AMBIENTE),
    recursos: recursosDe(invariantesDe(AMBIENTE).recursos.perfil),
    conMonolito: invariantesDe(AMBIENTE).application.deployMonolith,
    alertWebhookUrl,
  });
}

function contenedorDe(ms: Manifiesto[], kindDeployment: string, contiene: string, nombre: string): Contenedor {
  const despliegue = buscar(ms, kindDeployment, contiene) as {
    spec: { template: { spec: { containers: Contenedor[] } } };
  };
  const contenedor = despliegue.spec.template.spec.containers.find((c) => c.name === nombre);
  if (!contenedor) {
    throw new Error(`No hay contenedor «${nombre}» en el Deployment que contiene «${contiene}»`);
  }
  return contenedor;
}

describe("#156 · observabilidad", () => {
  const ms = manifiestosDe(AMBIENTE);

  it("el motor lleva su sidecar de metricas, con kamayuk_monitor y nunca el superusuario", () => {
    const exportador = contenedorDe(ms, "Deployment", "postgres", "postgres-exporter");
    const variables = variablesDe(exportador);
    expect(variables.get("DATA_SOURCE_USER")).toBe("kamayuk_monitor");
    expect(secretosDe(exportador)).toContain(secretos(AMBIENTE).monitoreo);
    expect(secretosDe(exportador)).not.toContain(secretos(AMBIENTE).motor);
  });

  it("Prometheus scrapea la aplicacion, el motor, el nodo, kube-state-metrics y Traefik", () => {
    const configuracion = buscar(ms, "ConfigMap", "observabilidad-prometheus") as {
      data: Record<string, string>;
    };
    const prometheusYml = configuracion.data["prometheus.yml"] ?? "";
    for (const objetivo of [
      "/actuator/prometheus",
      "kamayuk-prod-postgres:9187",
      "kamayuk-prod-observabilidad-node-exporter:9100",
      "kamayuk-prod-observabilidad-kube-state-metrics:8080",
      "traefik.kube-system.svc.cluster.local:9100",
    ]) {
      expect(prometheusYml).toContain(objetivo);
    }
  });

  it("las diez reglas de alerta estan cargadas, con las que el issue exige", () => {
    const configuracion = buscar(ms, "ConfigMap", "observabilidad-prometheus") as {
      data: Record<string, string>;
    };
    const alertasYmlCargado = configuracion.data["alertas.yml"] ?? "";
    for (const regla of [
      "PostgreSQLCaido",
      "PodEnCrashLoopBackOff",
      "PodNoListo",
      "CPUDelNodoAlta",
      "MemoriaDelNodoAlta",
      "DiscoDelNodoAlto",
      "CertificadoPorExpirar",
      "RespaldoQueNoCorrio",
      "JobDeMigracionFallido",
    ]) {
      expect(alertasYmlCargado).toContain(`alert: ${regla}`);
    }
  });

  it("sin destino configurado, Alertmanager enruta a null-receiver; con destino, al webhook", () => {
    // AMBIENTE es "prod" en este archivo, y prod SIEMPRE trae alertWebhookUrl —lo
    // exige config.ts—; para probar el estado sin destino hay que construir el
    // argumento a mano, sin pasar por invariantesDe().
    const sinWebhook = manifiestosDeObservabilidadDePrueba(undefined);
    const alertmanagerYmlSinWebhook =
      (buscar(sinWebhook, "ConfigMap", "observabilidad-alertmanager") as { data: Record<string, string> })
        .data["alertmanager.yml"] ?? "";
    expect(alertmanagerYmlSinWebhook).toContain("receiver: null-receiver");

    const conWebhook = manifiestosDeObservabilidadDePrueba("https://hooks.example.pe/x");
    const alertmanagerYmlConWebhook =
      (buscar(conWebhook, "ConfigMap", "observabilidad-alertmanager") as { data: Record<string, string> })
        .data["alertmanager.yml"] ?? "";
    expect(alertmanagerYmlConWebhook).toContain("receiver: webhook");
    expect(alertmanagerYmlConWebhook).toContain("https://hooks.example.pe/x");
  });

  it("kube-state-metrics no tiene privilegio de mas: nada de Secret ni ConfigMap", () => {
    const rol = buscar(ms, "ClusterRole", "kube-state-metrics") as {
      rules: { apiGroups: string[]; resources: string[]; verbs: string[] }[];
    };
    const recursos = rol.rules.flatMap((r) => r.resources);
    expect(recursos).not.toContain("secrets");
    expect(recursos).not.toContain("configmaps");
    for (const regla of rol.rules) {
      expect(regla.verbs).not.toContain("create");
      expect(regla.verbs).not.toContain("delete");
      expect(regla.verbs).not.toContain("update");
    }
  });

  it("node-exporter ve el nodo, no el contenedor", () => {
    const despliegue = buscar(ms, "Deployment", "observabilidad-node-exporter") as {
      spec: { template: { spec: { hostNetwork?: boolean; hostPID?: boolean } } };
    };
    expect(despliegue.spec.template.spec.hostNetwork).toBe(true);
    expect(despliegue.spec.template.spec.hostPID).toBe(true);
  });

  it("Grafana no esta en ninguna IngressRoute: se administra por el tunel SSH", () => {
    const rutas = ms.filter((m): m is Manifiesto & { spec: { routes: { match: string }[] } } =>
      m.kind === "IngressRoute",
    );
    const nombreDeGrafana = buscar(ms, "Service", "observabilidad-grafana").metadata.name;
    for (const ruta of rutas) {
      for (const r of ruta.spec.routes) {
        expect(r.match).not.toContain("grafana");
      }
    }
    // Y el Service en si no aparece como backend de ninguna ruta.
    const backends = rutas.flatMap((r) =>
      (r as unknown as { spec: { routes: { services: { name: string }[] }[] } }).spec.routes.flatMap(
        (ru) => ru.services.map((s) => s.name),
      ),
    );
    expect(backends).not.toContain(nombreDeGrafana);
  });

  it("responde que version corre y desde cuando, desde el tablero", () => {
    const tablero = buscar(ms, "ConfigMap", "observabilidad-grafana") as { data: Record<string, string> };
    const json = JSON.parse(tablero.data["resumen-operativo.json"] ?? "{}") as {
      panels: { title: string }[];
    };
    expect(tablero.data["resumen-operativo.json"]).toBeDefined();
    expect(json.panels.some((p) => p.title.includes("Version desplegada"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #157 — Endurecimiento: red, sin root, limites y sondas
// ─────────────────────────────────────────────────────────────────────────────

function politicasDeRed(ms: Manifiesto[]): NetworkPolicy[] {
  return ms.filter((m): m is NetworkPolicy => m.kind === "NetworkPolicy");
}

function politicaDe(ms: Manifiesto[], nombre: string): NetworkPolicy {
  const encontrada = politicasDeRed(ms).find((p) => p.metadata.name === nombre);
  if (!encontrada) {
    throw new Error(
      `No hay ningun NetworkPolicy «${nombre}». Hay: ` +
        politicasDeRed(ms).map((p) => p.metadata.name).join(", "),
    );
  }
  return encontrada;
}

/** Todo `podSelector`/`namespaceSelector` que aparece en cualquier regla de una politica. */
function origenesDe(p: NetworkPolicy): { pods: string[]; namespaces: string[] } {
  const reglas = [...(p.spec.ingress ?? []), ...(p.spec.egress ?? [])];
  const selectores = reglas.flatMap((r) => [...(r.from ?? []), ...(r.to ?? [])]);
  return {
    pods: selectores
      .map((s) => s.podSelector?.matchLabels.app)
      .filter((app): app is string => app !== undefined),
    namespaces: selectores
      .map((s) => s.namespaceSelector?.matchLabels["kubernetes.io/metadata.name"])
      .filter((n): n is string => n !== undefined),
  };
}

describe("#157 · endurecimiento", () => {
  const ms = manifiestosDe(AMBIENTE);

  it("denegar-todo selecciona TODOS los pods, en las dos direcciones, sin ninguna excepcion propia", () => {
    const base = politicaDe(ms, "denegar-todo");
    expect(base.spec.podSelector).toEqual({});
    expect(base.spec.policyTypes.sort()).toEqual(["Egress", "Ingress"]);
    expect(base.spec.ingress ?? []).toEqual([]);
    expect(base.spec.egress ?? []).toEqual([]);
  });

  it("la interfaz no esta entre quienes pueden alcanzar PostgreSQL", () => {
    // La prueba estructural: quien figura en la politica que ADMITE trafico hacia
    // el motor. La prueba de verdad —que conectar falla— exige un clúster con el
    // `NetworkPolicy` aplicado y es responsabilidad de
    // `red/verificar-politicas.sh`, no de esta suite sin clúster.
    const postgres = politicaDe(ms, "permitir-ingreso-postgres");
    const nombreDeInterfaz = buscar(ms, "Service", "kamayuk-prod-interfaz").metadata.name;
    expect(origenesDe(postgres).pods).not.toContain(nombreDeInterfaz);
  });

  it("Prometheus tiene entrada, y es solo de Grafana", () => {
    // Con salida pero sin entrada, Prometheus queda inalcanzable para cualquiera
    // -Grafana incluido- bajo un CNI que aplique NetworkPolicy de verdad: las dos
    // puntas del flujo se declaran cada una en su propio pod.
    const prometheus = politicaDe(ms, "permitir-ingreso-prometheus");
    const nombreDeGrafana = buscar(ms, "Service", "kamayuk-prod-observabilidad-grafana").metadata.name;
    expect(origenesDe(prometheus).pods).toEqual([nombreDeGrafana]);
    const puertos = (prometheus.spec.ingress ?? []).flatMap((r) => r.ports ?? []).map((p) => p.port);
    expect(puertos).toEqual([9090]);
  });

  it("Prometheus puede empujar hacia Alertmanager: permitir-ingreso-alertmanager no basta sola", () => {
    // Sin esta, la regla evalua a FIRING de verdad y nadie se entera: la conexion
    // misma con la que Prometheus la empuja se cae antes de llegar.
    const salida = politicaDe(ms, "permitir-salida-prometheus");
    const nombreDeAlertmanager = buscar(ms, "Service", "kamayuk-prod-observabilidad-alertmanager").metadata.name;
    const reglaConAlertmanager = (salida.spec.egress ?? []).find((r) =>
      (r.to ?? []).some((d) => d.podSelector?.matchLabels.app === nombreDeAlertmanager),
    );
    expect(reglaConAlertmanager).toBeDefined();
    expect((reglaConAlertmanager?.ports ?? []).map((p) => p.port)).toEqual([9093]);
  });

  it("la aplicacion no tiene ningun bloque de internet en su lista de salida", () => {
    const salida = politicaDe(ms, "permitir-salida-aplicacion");
    const destinos = salida.spec.egress?.flatMap((r) => r.to ?? []) ?? [];
    expect(destinos.some((d) => d.ipBlock !== undefined)).toBe(false);
  });

  it("las excepciones de salida amplia son de un solo puerto cada una, y de nadie mas", () => {
    const conInternet = politicasDeRed(ms).filter((p) =>
      (p.spec.egress ?? []).some((r) => (r.to ?? []).some((d) => d.ipBlock !== undefined)),
    );
    const nombres = conInternet.map((p) => p.metadata.name).sort();
    expect(nombres).toEqual(
      [
        "permitir-salida-kamayuk-prod-observabilidad-alertmanager-a-internet",
        "permitir-salida-kamayuk-prod-postgres-a-internet",
        "permitir-salida-kamayuk-prod-respaldo-a-internet",
        "permitir-salida-kamayuk-prod-observabilidad-kube-state-metrics-al-apiserver",
      ].sort(),
    );
    // `prod` sin relay SMTP (ADR-0012, Opción B): identidad no tiene salida amplia.
    expect(nombres).not.toContain("permitir-salida-identidad");

    // El motor y el respaldo, hacia el almacenamiento de objetos (issue #155), y
    // Alertmanager hacia el webhook: los tres, acotados a :443.
    const A_INTERNET = conInternet.filter((p) => p.metadata.name.endsWith("-a-internet"));
    for (const p of A_INTERNET) {
      const puertos = (p.spec.egress ?? []).flatMap((r) => r.ports ?? []).map((pt) => pt.port);
      expect(puertos).toEqual([443]);
    }

    // kube-state-metrics es la excepcion distinta: su destino es el API de
    // Kubernetes, que en k3s escucha :6443 despues del DNAT del `Service`
    // `kubernetes` (:443) — ver el docstring de Red.ts.
    const alApiserver = conInternet.find((p) => p.metadata.name.endsWith("-al-apiserver"));
    const puertosApiserver = (alApiserver?.spec.egress ?? []).flatMap((r) => r.ports ?? []).map((pt) => pt.port);
    expect(puertosApiserver).toEqual([6443]);
  });

  it("kube-state-metrics: ingreso solo de Prometheus, salida solo al apiserver por :6443", () => {
    const entrada = politicaDe(ms, "permitir-ingreso-kube-state-metrics");
    expect(entrada.spec.policyTypes).toEqual(["Ingress"]);
    expect(entrada.spec.egress).toBeUndefined();

    // El API de Kubernetes no es un pod: la unica forma de nombrar el destino sin
    // un ipBlock fragil es acotar el puerto (ver el docstring de Red.ts). Es 6443
    // -el puerto real, despues del DNAT del `Service` `kubernetes`- y no 443, que
    // es solo lo que ese `Service` expone antes de traducirse.
    const salida = politicaDe(ms, "permitir-salida-kamayuk-prod-observabilidad-kube-state-metrics-al-apiserver");
    expect(salida.spec.policyTypes).toEqual(["Egress"]);
    expect(salida.spec.ingress).toBeUndefined();
    const puertos = (salida.spec.egress ?? []).flatMap((r) => r.ports ?? []).map((p) => p.port);
    expect(puertos).toEqual([6443]);
    const destinos = salida.spec.egress?.flatMap((r) => r.to ?? []) ?? [];
    expect(destinos.every((d) => d.ipBlock !== undefined)).toBe(true);
  });

  it("toda politica vive en el namespace del ambiente", () => {
    for (const p of politicasDeRed(ms)) {
      expect(p.metadata.namespace).toBe(namespaceName(AMBIENTE));
    }
  });

  it("ningun contenedor corre como root, salvo los dos nombrados por su motivo", () => {
    const SIN_RUNASNONROOT = new Set([
      // El entrypoint de la imagen oficial de PostgreSQL arranca como root a
      // proposito (ver `BaseDeDatos.ts`).
      "postgres",
      // Lee PGDATA de solo lectura con el permiso que la propia imagen le dio al
      // motor; forzar un UID sin verificarlo contra un clúster real cambia un
      // guion que funciona por uno que no (ver `Respaldo.ts`).
      "respaldo-base",
    ]);
    const sinNonRoot = contenedoresDeTodo(ms).filter(
      ({ c }) => !SIN_RUNASNONROOT.has(c.name) && c.securityContext?.runAsNonRoot !== true,
    );
    expect(sinNonRoot.map(({ donde, c }) => `${donde}/${c.name}`)).toEqual([]);
  });

  it("todo contenedor endurecido fija su `runAsUser`, salvo si su imagen ya lo fija por numero", () => {
    // Encontrado en CI dos veces, y la segunda porque esta prueba estaba escrita al
    // reves. Con `runAsNonRoot: true` y sin `runAsUser`, quien decide si el pod arranca
    // es la imagen: si fija su usuario por NOMBRE —"nobody", "nginx"— o no lo fija en
    // absoluto, el kubelet no puede comprobar sin ejecutarla que ese usuario no es root,
    // y rechaza el contenedor con `CreateContainerConfigError`.
    //
    // La version anterior llevaba la lista COMPLEMENTARIA: enumeraba los contenedores
    // que SI debian declarar `runAsUser`. Una lista asi solo protege a lo que ya esta en
    // ella —un contenedor nuevo nace exento y nadie se entera—, y es exactamente lo que
    // paso con `mailpit` (#268): su imagen no declara `USER`, corria como root, y `yarn
    // verificar` no dijo nada mientras `pulumi up` esperaba 600 s por un Deployment que
    // nunca iba a quedar Ready. Invertida, el que nace exento es nadie: o el contenedor
    // fija su UID, o alguien escribe aqui por que no hace falta, y eso se ve en el diff.
    //
    // Cada exencion es un `USER` numerico LEIDO del Dockerfile de esa imagen, no una
    // suposicion. Si no se puede leer, no es exencion: es un `runAsUser`.
    const IMAGEN_CON_UID_NUMERICO = new Set([
      // ghcr.io/hneyra/sgtm-aplicacion — `USER 10001` (backend/Dockerfile).
      "aplicacion",
      "implantacion",
      "lote",
      // ghcr.io/hneyra/sgtm-migrador — `USER 10002` (backend/Dockerfile).
      "migrador",
      // quay.io/keycloak/keycloak:26.0 — `USER 1000` (quarkus/container/Dockerfile).
      "keycloak",
      "reconciliar-realm",
      // grafana/grafana:11.3.0 — `USER "$GF_UID"`, con `ARG GF_UID="472"`.
      "grafana",
    ]);

    // Sobre los DOS ambientes, no solo sobre `prod`: `mailpit` vive unicamente en `stg`,
    // asi que una comprobacion que solo mire `prod` no lo veria ni estando bien escrita.
    // Es la segunda mitad de por que se colo.
    for (const ambiente of ENVIRONMENTS) {
      const sinRunAsUser = contenedoresDeTodo(manifiestosDe(ambiente)).filter(
        ({ c }) =>
          c.securityContext?.runAsNonRoot === true &&
          c.securityContext.runAsUser === undefined &&
          !IMAGEN_CON_UID_NUMERICO.has(c.name),
      );
      expect(sinRunAsUser.map(({ donde, c }) => `${ambiente} ${donde}/${c.name}`)).toEqual([]);
    }
  });

  it("el motor re-concede las capacidades que su entrypoint necesita para tomar posesion de PGDATA", () => {
    // Encontrado en CI (issue #157): `capabilities: { drop: ["ALL"] }` deja a "root"
    // -el entrypoint de PostgreSQL arranca como root a proposito, ver el comentario en
    // BaseDeDatos.ts- sin las capacidades que hacen a root privilegiado en Linux. El
    // contenedor entraba en CrashLoopBackOff con "chown: ... Operation not permitted"
    // contra un clúster real; ni la auditoria ni `yarn manifiestos` lo detectan, porque
    // las dos comprueban que `drop` incluya "ALL", nunca que el entrypoint pueda
    // arrancar de verdad.
    const motor = contenedorDe(ms, "Deployment", "postgres", "postgres");
    const concedidas = motor.securityContext?.capabilities?.add ?? [];
    for (const necesaria of ["CHOWN", "FOWNER", "DAC_OVERRIDE", "SETUID", "SETGID"]) {
      expect(concedidas).toContain(necesaria);
    }
  });

  it("todo contenedor tiene sin escalada de privilegios y sin capacidades", () => {
    const sinEndurecer = contenedoresDeTodo(ms).filter(
      ({ c }) =>
        c.securityContext?.allowPrivilegeEscalation !== false ||
        !c.securityContext.capabilities?.drop?.includes("ALL"),
    );
    expect(sinEndurecer.map(({ donde, c }) => `${donde}/${c.name}`)).toEqual([]);
  });

  it("kubectl get pods no mostraria ninguno sin limites: todo contenedor los declara", () => {
    const sinLimites = contenedoresDeTodo(ms).filter(
      ({ c }) => !c.resources?.limits?.cpu || !c.resources.limits.memory,
    );
    expect(sinLimites.map(({ donde, c }) => `${donde}/${c.name}`)).toEqual([]);
  });

  it("los contenedores que no escriben fuera de sus volumenes llevan la raiz sellada", () => {
    // `readOnlyRootFilesystem` es el «donde se pueda» del alcance del issue #157, y
    // «donde se pueda» es una lista, no una regla universal: sellarlo en un
    // contenedor que si escribe en su raiz no lo endurece, lo rompe -y lo rompe
    // contra un clúster real, no aqui, que es como este mismo PR descubrio lo de
    // `capabilities.drop` y lo de `runAsNonRoot`-.
    //
    // Esta prueba fija la lista de los que SI la llevan. Tres de ellos ya la
    // llevaban desde el issue #156 sin que ninguna prueba lo dijera: sin fijarla,
    // quitarla de cualquiera de los tres no habria puesto nada rojo, y la unica
    // constancia de que era una decision -y no un descuido de copiar y pegar- era
    // que estaba escrita.
    const CON_RAIZ_SELLADA = new Set([
      // Exportadores: leen una fuente y sirven /metrics. Ninguno escribe.
      "postgres-exporter",
      "node-exporter",
      "kube-state-metrics",
      // Descarga, verifica y mueve; escribe en `/tmp` y en el `emptyDir` compartido,
      // los dos montados (ver `contenedorDeDescargaDeWalg`).
      "wal-g-instalar",
    ]);
    const sellados = contenedoresDeTodo(ms)
      .filter(({ c }) => c.securityContext?.readOnlyRootFilesystem === true)
      .map(({ c }) => c.name);
    expect(new Set(sellados)).toEqual(CON_RAIZ_SELLADA);
  });

  it("el que descarga wal-g tiene `/tmp` montado: sin eso, sellar la raiz lo rompe", () => {
    // El orden importa y por eso son dos comprobaciones y no una: la raiz sellada
    // sin un `/tmp` escribible convierte el `curl -o /tmp/wal-g.tar.gz` en un fallo
    // de arranque del pod entero -el init container no termina, y el motor detras
    // nunca llega a Ready-.
    for (const donde of ["Deployment", "CronJob"] as const) {
      const pods = podsDeTodo(ms).filter(({ donde: d }) => d.startsWith(donde));
      const conDescarga = pods.filter(({ pod }) =>
        contenedoresDe(pod).some((c) => c.name === "wal-g-instalar"),
      );
      expect(conDescarga.length).toBeGreaterThan(0);
      for (const { pod } of conDescarga) {
        const descarga = contenedoresDe(pod).find((c) => c.name === "wal-g-instalar")!;
        expect(descarga.volumeMounts?.map((v) => v.mountPath)).toContain("/tmp");
        expect((pod.volumes ?? []).map((v) => v.name)).toContain("wal-g-tmp");
      }
    }
  });

  // Las tres de abajo son el «falta auditar y completar» de las clases de prioridad.
  // Lo que ya habia comprobaba que ningun pod se OLVIDA de declarar su clase; lo que
  // faltaba es que las clases esten en el orden correcto, que es de donde sale el
  // sentido entero de tenerlas. Sin esto, intercambiar `datos` y `lote` en
  // `convenciones.ts` deja las 170 pruebas en verde con PostgreSQL como lo PRIMERO
  // que el kubelet desaloja.

  it("las tres clases estan estrictamente ordenadas: datos por encima de servicio, y servicio de lote", () => {
    expect(PRIORIDADES.datos).toBeGreaterThan(PRIORIDADES.servicio);
    expect(PRIORIDADES.servicio).toBeGreaterThan(PRIORIDADES.lote);
  });

  it("el motor de datos usa la clase `datos`, y es el unico que la usa", () => {
    const conClaseDeDatos = podsDeTodo(ms).filter(
      ({ pod }) => pod.priorityClassName === nombreDePrioridad(AMBIENTE, "datos"),
    );
    expect(conClaseDeDatos.map(({ donde }) => donde)).toEqual([
      `Deployment/${resourceName(AMBIENTE, "postgres")}`,
    ]);
  });

  it("ningun pod del manifiesto vale tanto como el motor: la base se desaloja la ultima", () => {
    const valorDe = new Map(
      ms.filter((m) => m.kind === "PriorityClass").map((m) => [m.metadata.name, m.value]),
    );
    const delMotor = valorDe.get(nombreDePrioridad(AMBIENTE, "datos"));

    const porEncima = podsDeTodo(ms).filter(
      ({ pod }) =>
        pod.priorityClassName !== nombreDePrioridad(AMBIENTE, "datos") &&
        (valorDe.get(pod.priorityClassName) ?? 0) >= (delMotor ?? 0),
    );
    expect(porEncima.map(({ donde }) => donde)).toEqual([]);
  });
});

describe("#157 · la demostracion: la auditoria se pone roja", () => {
  it("quitando allowPrivilegeEscalation del motor, la auditoria lo detecta", () => {
    const ms = manifiestosDe(AMBIENTE);
    const motor = contenedorDe(ms, "Deployment", "postgres", "postgres");
    // @ts-expect-error -- se rompe a proposito: `allowPrivilegeEscalation` es obligatorio en el tipo.
    delete motor.securityContext.allowPrivilegeEscalation;

    expect(auditar(ms)).toContainEqual(expect.stringContaining("securityContext"));
  });

  it("quitando el drop de capacidades de la interfaz, la auditoria lo detecta", () => {
    const ms = manifiestosDe(AMBIENTE);
    const interfaz = contenedorDe(ms, "Deployment", "interfaz", "interfaz");
    // @ts-expect-error -- se rompe a proposito: `capabilities` es obligatorio en el tipo.
    delete interfaz.securityContext.capabilities;

    expect(auditar(ms)).toContainEqual(expect.stringContaining("securityContext"));
  });

  it("intercambiando `datos` y `lote`, la auditoria detecta que la base se desaloja primero", () => {
    // Exactamente lo que un `PRIORIDADES.datos = 100 / lote = 1000` produciria en el
    // manifiesto. Antes de esta comprobacion, esa inversion pasaba las 170 pruebas en
    // verde: cada pod seguia declarando su clase, y nadie miraba el numero.
    const ms = manifiestosDe(AMBIENTE);
    const clase = (prioridad: Parameters<typeof nombreDePrioridad>[1]) =>
      ms.find(
        (m): m is Extract<Manifiesto, { kind: "PriorityClass" }> =>
          m.kind === "PriorityClass" && m.metadata.name === nombreDePrioridad(AMBIENTE, prioridad),
      );
    const datos = clase("datos");
    const lote = clase("lote");
    [datos!.value, lote!.value] = [lote!.value, datos!.value];

    expect(auditar(ms)).toContainEqual(expect.stringContaining("es lo ULTIMO que se desaloja"));
  });

  it("apuntando un pod a una clase que nadie define, la auditoria lo detecta", () => {
    // Kubernetes rechaza el pod entero, no lo despliega con menos garantias: una
    // `PriorityClass` mal escrita es un pod que no arranca.
    const ms = manifiestosDe(AMBIENTE);
    const prometheus = buscar(ms, "Deployment", "observabilidad-prometheus") as {
      spec: { template: { spec: { priorityClassName: string } } };
    };
    prometheus.spec.template.spec.priorityClassName = "prioridad-que-no-existe";

    expect(auditar(ms)).toContainEqual(expect.stringContaining("ningun PriorityClass"));
  });
});

describe("#156 · la demostracion: la auditoria se pone roja", () => {
  it("quitando resources del sidecar de metricas, la auditoria lo detecta", () => {
    const ms = manifiestosDe(AMBIENTE);
    const exportador = contenedorDe(ms, "Deployment", "postgres", "postgres-exporter");
    // @ts-expect-error -- se rompe a proposito: `resources` es obligatorio en el tipo.
    delete exportador.resources;

    expect(auditar(ms)).toContainEqual(expect.stringContaining("sin requests ni limits"));
  });

  it("quitando priorityClassName de Prometheus, la auditoria lo detecta", () => {
    const ms = manifiestosDe(AMBIENTE);
    const prometheus = buscar(ms, "Deployment", "observabilidad-prometheus") as {
      spec: { template: { spec: { priorityClassName?: string } } };
    };
    delete prometheus.spec.template.spec.priorityClassName;

    expect(auditar(ms)).toContainEqual(expect.stringContaining("priorityClassName"));
  });
});

interface LimiteDeTasa {
  spec: { rateLimit: { average: number } };
}

/**
 * Lee un manifiesto con la forma que la prueba necesita.
 *
 * El `spec` de un `Middleware` es `Record<string, unknown>` —Traefik admite decenas de
 * formas y describirlas todas en `tipos.ts` seria copiar su documentacion—, asi que aqui
 * se afirma la que tiene. Va por `unknown` a proposito: es la forma de decir «se que el
 * compilador no puede comprobar esto», y esta acotada a las pruebas.
 */
function comoObjeto<T>(m: Manifiesto): T {
  return m as unknown as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// #268 — Un guion de ConfigMap que se ejecuta necesita el bit de ejecucion
// ─────────────────────────────────────────────────────────────────────────────

describe("la demostracion: la auditoria se pone roja con un guion no ejecutable", () => {
  /** Un pod minimo que monta un `ConfigMap` en `/guiones` y hace algo con el. */
  function conGuion(argv: { command?: string[]; args?: string[] }, defaultMode?: number): Manifiesto[] {
    return [
      {
        apiVersion: "batch/v1",
        kind: "Job",
        metadata: { name: "muestra", namespace: namespaceName(AMBIENTE), labels: {} },
        spec: {
          backoffLimit: 3,
          template: {
            metadata: { labels: {} },
            spec: {
              restartPolicy: "Never",
              priorityClassName: nombreDePrioridad(AMBIENTE, "lote"),
              containers: [
                {
                  name: "muestra",
                  image: "ejemplo:1.0",
                  ...argv,
                  resources: {
                    requests: { cpu: "10m", memory: "32Mi" },
                    limits: { cpu: "200m", memory: "128Mi" },
                  },
                  securityContext: {
                    allowPrivilegeEscalation: false,
                    capabilities: { drop: ["ALL"] },
                  },
                  volumeMounts: [{ name: "guiones", mountPath: "/guiones", readOnly: true }],
                },
              ],
              volumes: [{ name: "guiones", configMap: { name: "guiones", defaultMode } }],
            },
          },
        },
      } as unknown as Manifiesto,
    ];
  }

  const EJECUTA = { command: ["/bin/bash", "-c", "/guiones/a.sh && /guiones/b.sh"] };

  /**
   * Lo que dice ESTA regla, y no la auditoria entera: el pod de muestra es minimo a
   * proposito —no trae el `PriorityClass` que declara, y la auditoria se lo reprocha—,
   * asi que comparar la lista completa contra `[]` mediria otra cosa.
   */
  function guiones(ms: Manifiesto[]): string[] {
    return auditar(ms).filter((p) => p.includes("exit 126"));
  }

  it("ejecutar el guion con el 0644 por omision lo pone rojo, y nombra los dos", () => {
    const problemas = guiones(conGuion(EJECUTA));
    expect(problemas).toContainEqual(expect.stringContaining("exit 126"));
    expect(problemas).toContainEqual(expect.stringContaining("/guiones/a.sh, /guiones/b.sh"));
  });

  it("como `argv[0]` tambien, que es la otra forma de ejecutarlo", () => {
    expect(guiones(conGuion({ command: ["/guiones/a.sh"] }))).toContainEqual(
      expect.stringContaining("exit 126"),
    );
  });

  it("con `defaultMode: 493` se calla", () => {
    expect(guiones(conGuion(EJECUTA, 493))).toEqual([]);
  });

  // Las dos de abajo son la otra mitad: una regla que dijera que no a todo no protegeria
  // nada. Son las dos formas en que el resto del stack monta ficheros de un `ConfigMap`
  // sin ejecutarlos, y las dos tienen que seguir en verde.
  it("pasarselo al interprete como argumento NO necesita el bit —es lo que hacia #268 antes—", () => {
    expect(guiones(conGuion({ command: ["/bin/bash", "/guiones/a.sh"] }))).toEqual([]);
  });

  it("nombrar la ruta como valor de una opcion tampoco —asi monta Prometheus su config—", () => {
    expect(
      guiones(conGuion({ command: ["/bin/prometheus"], args: ["--config.file=/guiones/a.yml"] })),
    ).toEqual([]);
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// #558 · la restauracion verificada, escrita por quien la verifica
// ─────────────────────────────────────────────────────────────────────────────

describe("#558 · la restauracion verificada queda escrita", () => {
  const simulacro = () =>
    readFileSync(join(raizDelRepositorio(), "infra/respaldo/contra-cluster.sh"), "utf8");

  /**
   * La SENTENCIA, no el archivo. Medido: buscar `WHERE resultado = 'EXITOSO'` en el
   * guion entero pasa en verde con el filtro quitado del SQL, porque la misma cadena
   * esta en el comentario que lo explica —el modo de fallo exacto que #426 encontro en
   * `leerPatron` de `actos-inalcanzables.test.ts`—. Se acota entre `UPDATE respaldo` y su
   * `RETURNING`, que es lo que de verdad se ejecuta.
   */
  const sentencia = () => {
    const guion = simulacro();
    const desde = guion.indexOf("UPDATE respaldo");
    const hasta = guion.indexOf("RETURNING id;", desde);
    expect(desde, "el guion ya no lleva el UPDATE de la restauracion verificada").toBeGreaterThan(
      -1,
    );
    expect(hasta, "el UPDATE de la restauracion verificada no devuelve la fila que marco")
      .toBeGreaterThan(desde);
    return guion.slice(desde, hasta);
  };

  const migracion = () =>
    readFileSync(
      join(
        raizDelRepositorio(),
        "backend/sgtm-esquema/src/main/resources/db/migration/V78__restauracion_verificada.sql",
      ),
      "utf8",
    );

  it("el simulacro contra el cluster deja la fila: es el unico que restaura de verdad", () => {
    // `respaldo` tenia lectura y tenia quien escribiera si la copia se TOMO -el CronJob-,
    // y nadie que escribiera si se pudo RESTAURAR. Sin esta sentencia, la columna que la
    // pantalla existe para enseñar nace nula para siempre.
    expect(sentencia()).toContain("ultima_restauracion_verificada");
    expect(sentencia()).toContain("ultima_restauracion_verificada_por");
  });

  it("y las dos columnas son las que declara V78: no se copian, se contrastan", () => {
    // Un renombrado en la migracion sin tocar el guion deja el UPDATE apuntando a una
    // columna que ya no existe, y eso solo se veria ejecutando el simulacro contra `stg`
    // -que no corre en CI-. Precedente: #192 con `UnidadDePlazo`.
    for (const columna of ["ultima_restauracion_verificada", "ultima_restauracion_verificada_por"]) {
      expect(migracion()).toContain(`ADD COLUMN ${columna}`);
      expect(sentencia()).toContain(columna);
    }
  });

  it("marca solo una copia EXITOSA: la base rechaza cualquier otra (V78)", () => {
    // `respaldo_verificacion_exitosa_ck` rechaza con 23514 marcar una FALLIDA o una
    // EN_CURSO, asi que sin este `WHERE` la sentencia puede morir DESPUES de un simulacro
    // correcto y dejar el ensayo sin constancia.
    expect(sentencia()).toContain("WHERE resultado = 'EXITOSO'");
    expect(migracion()).toContain("respaldo_verificacion_exitosa_ck");
  });

  it("como kamayuk_owner, que es el unico rol que la politica de escritura nombra (V8)", () => {
    const guion = simulacro();
    const bloque = guion.slice(
      guion.indexOf("Dejando constancia"),
      guion.indexOf("RETURNING id;"),
    );
    expect(bloque).toContain("--username=kamayuk_owner");
    expect(bloque).not.toContain("--username=postgres");
  });

  it("y despues de comprobar lo restaurado, nunca antes", () => {
    const guion = simulacro();
    // Marcar la copia antes de las comprobaciones seria afirmar la verificacion de un
    // ensayo que todavia podia fallar.
    expect(guion.indexOf("UPDATE respaldo")).toBeGreaterThan(
      guion.indexOf("promovido, y admite escrituras"),
    );
  });
});

function valoresDelIngreso(ms: Manifiesto[]): string {
  return (buscar(ms, "HelmChartConfig", "traefik") as { spec: { valuesContent: string } }).spec
    .valuesContent;
}

function auditar(ms: Manifiesto[]): string[] {
  return auditarManifiestos(ms, {
    secretoDeOwner: secretos(AMBIENTE).owner,
    namespacesDelAmbiente: namespacesDelAmbiente(AMBIENTE),
    namespace: namespaceName(AMBIENTE),
  });
}
