import { describe, expect, it } from "vitest";
import {
  checkInvariants,
  checkKubeconfigServer,
  MissingConfigError,
  readInvariants,
  commonLabels,
  namespaceName,
  resourceName,
  type ConfigReader,
  type Environment,
  type Invariants,
} from "./config";

/**
 * Cada invariante de `config.ts` tiene aquí su caso que la viola.
 *
 * Es el patrón del resto del repositorio (CLAUDE.md, «Verificar antes de afirmar»): no
 * basta con que la verificación esté escrita, hay que demostrar que puede fallar. Una
 * regla mal escrita pasa en verde contra una configuración correcta y no protege nada.
 *
 * Las que más importan son las tres que sostienen la recuperación —el respaldo fuera
 * del VPS, el plazo de archivado del WAL y el ensayo de `stg`—, porque las tres se
 * pueden incumplir sin que nada se note hasta el día que hace falta restaurar.
 */

function baseline(environment: Environment = "prod"): Invariants {
  const isStg = environment === "stg";
  return {
    environment,
    // Un nodo holgado: esta prueba mira las invariantes de `config.ts`, y que el stack
    // quepa en su nodo es cosa de `capacidad.ts` y de `capacidad.test.ts`.
    node: { allocatableCpu: "8", allocatableMemory: "16Gi" },
    // A quien se le avisa en este ambiente (C-7 §4). La guarda de `checkInvariants` no mira
    // que este puesto —`requireText` ya lo exige al leer— sino que no sea un relleno.
    operacion: { responsable: "Jefa de Tesoreria", canal: "tesoreria@example.pe" },
    // C-19: cuanto pide este ambiente sobre su nodo. Es una capacidad declarada, no el
    // nombre del ambiente: `checkInvariants` rechaza `minimo` en `prod`.
    recursos: { perfil: isStg ? "minimo" : "dimensionado" },
    ingress: {
      domain: isStg ? "stg.sgtm.example.pe" : "sgtm.example.pe",
      acmeEmail: "operaciones@example.pe",
      acmeStaging: isStg,
      publishedNodePorts: [],
    },
    database: {
      image: "postgis/postgis:16-3.4-alpine",
      storageSize: isStg ? "20Gi" : "100Gi",
      generateRolePasswords: false,
    },
    backup: {
      endpoint: "https://s3.us-east-1.amazonaws.com",
      region: "us-east-1",
      bucket: `sgtm-${environment}-respaldos`,
      walArchiveTimeoutSeconds: 300,
      ...(isStg ? { restoreSourceBucket: "sgtm-prod-respaldos" } : {}),
    },
    identity: {
      image: "quay.io/keycloak/keycloak:26.0",
      realm: "sgtm",
      developmentMode: false,
      seedTestUsers: isStg,
      // `stg` tiene relay —el buzon Mailpit del clúster—; `prod` no (ADR-0012,
      // Opción B): sin relay, el alta crea al usuario sin clave y no incumple nada.
      smtp: isStg
        ? {
            host: "kamayuk-stg-correo",
            port: 1025,
            from: "no-responder@stg.example.pe",
            startTls: false,
            auth: false,
          }
        : undefined,
    },
    application: {
      imageRepository: "ghcr.io/hneyra/sgtm",
      isDemonstration: isStg,
      // Declarado en los dos: en prod es obligatorio decidirlo a mano (issue #150).
      isDemonstrationDeclared: true,
    },
    sistemas: {
      // Una version por sistema, cada una un `sha` de SU repositorio (D, bloqueo 1). Aqui son
      // cuarenta hexadecimales inventados a proposito: lo que `checkInvariants` puede comprobar
      // es la FORMA; que la etiqueta exista de verdad lo contesta el registro
      // (`verificaciones/imagenes/comprobar-imagenes.sh`) y que sea una revision de `main` lo
      // contesta `verificaciones/imagenes-publicadas.test.ts` contra el clon hermano.
      versiones: {
        rentas: "1111111111111111111111111111111111111111",
        catastro: "2222222222222222222222222222222222222222",
        normativa: "3333333333333333333333333333333333333333",
        caja: "4444444444444444444444444444444444444444",
      },
    },
    implantacion: {
      ubigeo: "200101",
      nombre: "Municipalidad Provincial de Sullana",
      tipo: "PROVINCIAL",
      administrador: "administrador",
      nombreDelAdministrador: "Administrador del sistema",
      // El `id` de la fila que crea el Job de implantacion (C-14 §3). En una base recien creada
      // vale 1: `municipalidad.id` es una columna `IDENTITY`.
      municipalidadId: 1,
    },
    observability: {
      // Declarado en los dos: en prod es obligatorio (issue #156).
      alertWebhookUrl: "http://observabilidad-alertmanager-receptor.example.svc:9094/hooks/sgtm",
    },
  };
}

/** Ayuda a que un fallo diga qué regla se esperaba, no solo «esperaba 1, recibí 0». */
function expectViolation(config: Invariants, fragment: string): void {
  const problems = checkInvariants(config);
  expect(
    problems.some((p) => p.includes(fragment)),
    `Se esperaba un incumplimiento que mencionara «${fragment}». Se obtuvo:\n${
      problems.length === 0 ? "  (ninguno)" : problems.map((p) => `  · ${p}`).join("\n")
    }`,
  ).toBe(true);
}

describe("configuración admisible", () => {
  it("los dos ambientes de referencia no tienen incumplimientos", () => {
    for (const environment of ["stg", "prod"] as const) {
      expect(checkInvariants(baseline(environment)), environment).toEqual([]);
    }
  });
});

describe("RNF-074 — se entra cifrado, y no responde nada más", () => {
  it("un correo de ACME que no es un correo", () => {
    const c = baseline();
    c.ingress.acmeEmail = "operaciones";
    expectViolation(c, "no tiene forma de dirección de correo");
  });

  it("el certificado de pruebas de Let's Encrypt en producción", () => {
    const c = baseline("prod");
    c.ingress.acmeStaging = true;
    expectViolation(c, "no lo acepta ningún navegador");
  });

  it("en stg el certificado de pruebas sí se admite", () => {
    const c = baseline("stg");
    c.ingress.acmeStaging = true;
    expect(checkInvariants(c)).toEqual([]);
  });

  it("un puerto del nodo publicado además de 80 y 443", () => {
    const c = baseline();
    c.ingress.publishedNodePorts = [30433];
    expectViolation(c, "responden 80 —que solo redirige— y 443, y nada más");
  });
});

describe("INF-01 §1.3 y RNF-076 — el respaldo, fuera del nodo y a tiempo", () => {
  it.each([
    ["http://minio.kamayuk-prod.svc.cluster.local:9000", "un servicio del propio clúster"],
    ["http://localhost:9000", "el bucle local del nodo"],
    ["http://127.0.0.1:9000", "la dirección de bucle"],
  ])("%s no sirve de respaldo (%s)", (endpoint) => {
    const c = baseline();
    c.backup.endpoint = endpoint;
    expectViolation(c, "no puede depender de lo que se está recuperando");
  });

  it("el contenedor de respaldo tiene que nombrar el ambiente", () => {
    const c = baseline("stg");
    c.backup.bucket = "sgtm-respaldos";
    expectViolation(c, "es distinto por ambiente");
  });

  it("un plazo de archivado por encima del RPO lo degrada en silencio", () => {
    const c = baseline();
    c.backup.walArchiveTimeoutSeconds = 3600;
    expectViolation(c, "RNF-076 fija el RPO en 5 minutos");
  });

  it("300 segundos es exactamente el RPO y se admite", () => {
    const c = baseline();
    c.backup.walArchiveTimeoutSeconds = 300;
    expect(checkInvariants(c)).toEqual([]);
  });

  it("un plazo de archivado sin sentido", () => {
    const c = baseline();
    c.backup.walArchiveTimeoutSeconds = 0;
    expectViolation(c, "al menos 1 segundo");
  });
});

describe("INF-03 §2 — stg es donde se ensaya la restauración", () => {
  it("producción no restaura desde el contenedor de otro ambiente", () => {
    const c = baseline("prod");
    c.backup.restoreSourceBucket = "sgtm-stg-respaldos";
    expectViolation(c, "Solo stg restaura desde los respaldos de otro ambiente");
  });

  it("stg restaurándose a sí mismo no ensaya nada", () => {
    const c = baseline("stg");
    c.backup.restoreSourceBucket = c.backup.bucket;
    expectViolation(c, "se restaura a sí mismo");
  });
});

describe("INF-03 §3.2 — la copia se ve como copia", () => {
  it("stg sin la marca de demostración", () => {
    const c = baseline("stg");
    c.application.isDemonstration = false;
    expectViolation(c, "todo documento que emita sale marcado");
  });

  it("prod puede no estar marcada", () => {
    const c = baseline("prod");
    c.application.isDemonstration = false;
    expect(checkInvariants(c)).toEqual([]);
  });
});

describe("INF-03 §4 — nada de atajos de desarrollo en producción", () => {
  it("usuarios de prueba sembrados en producción", () => {
    const c = baseline("prod");
    c.identity.seedTestUsers = true;
    expectViolation(c, "puerta abierta");
  });

  it("Keycloak en modo de desarrollo, en cualquiera de los dos ambientes", () => {
    for (const environment of ["stg", "prod"] as const) {
      const c = baseline(environment);
      c.identity.developmentMode = true;
      expectViolation(c, "perder el pod es perder los usuarios");
    }
  });

  it("un buzon de pruebas como relay SMTP declarado en prod", () => {
    const c = baseline("prod");
    c.identity.smtp = { host: "kamayuk-prod-correo", port: 1025, from: "x@y.pe", startTls: false, auth: true };
    expectViolation(c, "buzón que nadie lee");
  });

  it("un relay declarado en prod sin autenticacion", () => {
    const c = baseline("prod");
    c.identity.smtp = { host: "smtp.real.pe", port: 587, from: "x@y.pe", startTls: true, auth: false };
    expectViolation(c, "relay abierto entrega correo de cualquiera");
  });
});

describe("ADR-0012 — el relay SMTP, opcional, y bien declarado si se declara", () => {
  it("prod sin relay (smtp undefined) no incumple nada", () => {
    const c = baseline("prod");
    expect(c.identity.smtp).toBeUndefined();
    expect(checkInvariants(c)).toEqual([]);
  });

  it("un remitente sin forma de correo, en el ambiente que sí declara relay", () => {
    const c = baseline("stg");
    if (c.identity.smtp) c.identity.smtp.from = "no-es-un-correo";
    expectViolation(c, "no tiene forma de dirección de correo");
  });

  it("un puerto que no es un puerto", () => {
    const c = baseline("stg");
    if (c.identity.smtp) c.identity.smtp.port = 70000;
    expectViolation(c, "no es un puerto");
  });
});

describe("ADR-0011 — el estado de Pulumi no guarda ni versiones ni secretos", () => {
  it("las claves de los roles generadas en el estado", () => {
    for (const environment of ["stg", "prod"] as const) {
      const c = baseline(environment);
      c.database.generateRolePasswords = true;
      expectViolation(c, "no los secretos del sistema");
    }
  });

  it("la etiqueta de la imagen metida en la configuración", () => {
    const c = baseline();
    c.application.imageRepository = "ghcr.io/hneyra/sgtm:1.4.2";
    expectViolation(c, "la pone el flujo de liberación, no Pulumi");
  });

  it.each(["postgres:latest", "postgres", "quay.io/keycloak/keycloak:main"])(
    "«%s» no fija una versión",
    (image) => {
      const c = baseline();
      c.database.image = image;
      expectViolation(c, "no fija una versión");
    },
  );

});

/**
 * ADR-0011 §5 — la version de arranque fija una version.
 *
 * Las dos invariantes de `applicationBootstrapVersion` —«no es una etiqueta movil» y «es una
 * etiqueta, no una imagen»— se fueron con el monolito (`E`). Lo que las sustituye es mas
 * estricto y ya estaba: las cuatro `versionDe<Sistema>` tienen que ser **cuarenta
 * hexadecimales**, que es lo que `checkInvariants` exige mas abajo. Una etiqueta movil no pasa
 * esa forma, y una imagen con `:` tampoco.
 */

describe("issue #150 — la implantacion, decidida antes de tocar el cluster", () => {
  it("en prod, `esDemostracion` heredado del valor por omision no cuenta como decision", () => {
    const c = baseline("prod");
    c.application.isDemonstrationDeclared = false;
    expectViolation(c, "no está declarado en «prod»");
  });

  it("en stg no hace falta declararlo: la invariante de INF-03 §3.2 ya lo exige true", () => {
    const c = baseline("stg");
    c.application.isDemonstrationDeclared = false;
    expect(checkInvariants(c)).toEqual([]);
  });

  it("un ubigeo que no son seis digitos", () => {
    const c = baseline();
    c.implantacion.ubigeo = "2001";
    expectViolation(c, "el ubigeo son seis dígitos");
  });

  it("un tipo de municipalidad que no existe", () => {
    const c = baseline();
    (c.implantacion as { tipo: string }).tipo = "REGIONAL";
    expectViolation(c, "es DISTRITAL o PROVINCIAL");
  });
});

describe("el stack tiene que ser uno de los dos ambientes", () => {
  it("«local» no es un stack", () => {
    const c = baseline();
    (c as { environment: string }).environment = "local";
    expectViolation(c, "Local no es un stack");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

/** Lector de mentira: un mapa de valores, y nada más. */
function reader(values: Record<string, string | number | boolean | unknown[]>): ConfigReader {
  const get = (key: string) => values[key];
  return {
    text: (key) => (typeof get(key) === "string" ? (get(key) as string) : undefined),
    number: (key) => (typeof get(key) === "number" ? (get(key) as number) : undefined),
    boolean: (key) => (typeof get(key) === "boolean" ? (get(key) as boolean) : undefined),
    object: <T>(key: string) => (Array.isArray(get(key)) ? (get(key) as T) : undefined),
  };
}

const VALORES_MINIMOS = {
  // Lo asignable del nodo (`capacidad.ts`, issue #252). Obligatorio y sin valor por
  // omisión a propósito: una cifra inventada aquí haría que `capacidad.ts` dictaminase
  // que todo cabe, que es peor que no comprobar nada.
  nodeAllocatableCpu: "8",
  nodeAllocatableMemory: "16Gi",
  domain: "sgtm.example.pe",
  acmeEmail: "operaciones@example.pe",
  postgresImage: "postgis/postgis:16-3.4-alpine",
  postgresStorageSize: "100Gi",
  backupEndpoint: "https://s3.us-east-1.amazonaws.com",
  backupRegion: "us-east-1",
  backupBucket: "sgtm-prod-respaldos",
  keycloakImage: "quay.io/keycloak/keycloak:26.0",
  applicationImageRepository: "ghcr.io/hneyra/sgtm",
  // Una por sistema, y las cuatro obligatorias: `readInvariants` no admite que falte ninguna,
  // porque un valor por omision haria que olvidarse de declarar la version de un sistema se
  // leyera igual que declararla — y lo que decide es que imagen baja el nodo.
  versionDeRentas: "1111111111111111111111111111111111111111",
  versionDeCatastro: "2222222222222222222222222222222222222222",
  versionDeNormativa: "3333333333333333333333333333333333333333",
  versionDeCaja: "4444444444444444444444444444444444444444",
  ubigeo: "200101",
  municipalidad: "Municipalidad Provincial de Sullana",
  administrador: "administrador",
  // A quien se le avisa, y donde (C-7 §4). Van en los minimos porque son obligatorios en los
  // dos ambientes: `caja` no arranca sin ellos, y `stg` es donde se ensaya el procedimiento.
  responsableDeOperacion: "Jefa de Tesoreria",
  canalDeOperacion: "tesoreria@example.pe",
  // El `id` de la fila que crea el Job de implantacion (C-14 §3). Sin valor por omision, y por
  // el mismo motivo que las dos de arriba: un `?? 1` haria que olvidarlo se leyera igual que
  // declararlo, y lo que se declara aqui decide bajo que municipalidad escriben los procesos por
  // lotes de los cuatro sistemas.
  municipalidadId: 1,
  // C-19. Los dos sin valor por omision, por lo mismo que los tres de arriba: en un
  // booleano «no lo declare» y «declare que no» se leen igual en un `??`, y aqui lo que se
  // declara decide si el ambiente sirve la aplicacion entera y cuanto reserva sobre su nodo.
  perfilDeRecursos: "dimensionado",
};

/**
 * Los mínimos, más lo único que prod tiene que **decidir** y no puede heredar de un
 * valor por omisión: si la instalación se declara de demostración (issue #150).
 *
 * Va aparte de `VALORES_MINIMOS` porque no es un valor que falte —su ausencia no
 * revienta la lectura, incumple una invariante—, y la prueba de abajo recorre
 * `VALORES_MINIMOS` esperando exactamente lo primero.
 */
const MINIMOS_ADMISIBLES = {
  ...VALORES_MINIMOS,
  esDemostracion: true,
  // Obligatorio en prod (issue #156): sin el, `checkInvariants` revienta con la
  // misma frase que el propio fallo — "una regla que no notifica a nadie...".
  alertWebhookUrl: "https://hooks.example.pe/kamayuk-alertas",
};

describe("C-14 §3 — el `id` de la municipalidad que los procesos por lotes fijan", () => {
  /**
   * No se comprueba contra ninguna base —componer manifiestos no habla con ninguna—, asi que lo
   * unico que se puede impedir sin cluster es que no sea una fila posible. Lo que un valor
   * equivocado produce no es un error: el ingestor de `rentas` y el publicador de `catastro`
   * escriben bajo un contexto que no existe, y RLS no lo delata porque la base hace exactamente
   * lo que se le pide.
   */
  it.each([0, -1, 1.5])("«%s» no es una fila de `municipalidad`", (valor) => {
    const invariantes = baseline();
    const problemas = checkInvariants({
      ...invariantes,
      implantacion: { ...invariantes.implantacion, municipalidadId: valor },
    });
    expect(problemas.join("\n")).toContain("municipalidadId");
  });

  it("y el contraste: 1 —lo que vale en una base recien creada— pasa", () => {
    const invariantes = baseline();
    expect(
      checkInvariants({
        ...invariantes,
        implantacion: { ...invariantes.implantacion, municipalidadId: 1 },
      }),
    ).toEqual([]);
  });
});

describe("un valor obligatorio que falta revienta al principio, y dice cuál", () => {
  it("con todos los valores mínimos, la lectura pasa y no incumple nada", () => {
    const leidas = readInvariants("prod", reader(MINIMOS_ADMISIBLES));
    expect(checkInvariants(leidas)).toEqual([]);
  });

  it.each(Object.keys(VALORES_MINIMOS))("falta «%s»", (clave) => {
    // `unknown` y no `string`: `municipalidadId` es un numero, y el lector del stack lo
    // convierte al leerlo. Un fixture que lo pusiera como cadena no lo encontraria.
    const valores: Record<string, string | number | boolean | unknown[]> = {
      ...VALORES_MINIMOS,
    };
    delete valores[clave];

    let error: unknown;
    try {
      readInvariants("prod", reader(valores));
    } catch (e) {
      error = e;
    }

    expect(error, `quitar «${clave}» tenía que reventar la lectura`).toBeInstanceOf(
      MissingConfigError,
    );
    // Lo que este issue pide de verdad: el fallo **nombra el valor**. Un mensaje
    // genérico obliga a adivinar cuál de los ocho falta, y el sitio donde se adivina
    // es el despliegue.
    expect((error as MissingConfigError).key).toBe(clave);
    expect((error as Error).message).toContain(`kamayuk:${clave}`);
    expect((error as Error).message).toContain(`pulumi config set ${clave}`);
  });

  it("un valor obligatorio en blanco cuenta como ausente", () => {
    expect(() => readInvariants("prod", reader({ ...VALORES_MINIMOS, domain: "   " }))).toThrow(
      MissingConfigError,
    );
  });

  it("los valores con omisión no son obligatorios", () => {
    const leidas = readInvariants("prod", reader(VALORES_MINIMOS));
    expect(leidas.backup.walArchiveTimeoutSeconds).toBe(300);
    expect(leidas.identity.realm).toBe("sgtm");
    // Sin `keycloakSmtpHost` no hay relay (ADR-0012, Opción B).
    expect(leidas.identity.smtp).toBeUndefined();
    expect(leidas.implantacion.tipo).toBe("DISTRITAL");
    expect(leidas.implantacion.nombreDelAdministrador).toBe("Administrador del sistema");
    expect(leidas.ingress.publishedNodePorts).toEqual([]);
    expect(leidas.backup.restoreSourceBucket).toBeUndefined();
  });

  it("con `keycloakSmtpHost` puesto, `keycloakSmtpFrom` pasa a ser obligatorio", () => {
    expect(() =>
      readInvariants("stg", reader({ ...VALORES_MINIMOS, keycloakSmtpHost: "smtp.real.pe" })),
    ).toThrow(MissingConfigError);
    const ok = readInvariants("stg", reader({
      ...VALORES_MINIMOS,
      keycloakSmtpHost: "smtp.real.pe",
      keycloakSmtpFrom: "no-responder@real.pe",
    }));
    expect(ok.identity.smtp?.host).toBe("smtp.real.pe");
    expect(ok.identity.smtp?.auth).toBe(true);
  });
});

describe("INF-01 §1.4 — el kubeconfig apunta al túnel, no al VPS", () => {
  const kubeconfig = (server: string) =>
    ["apiVersion: v1", "clusters:", "- cluster:", `    server: ${server}`, "  name: default"].join(
      "\n",
    );

  it("localhost pasa", () => {
    expect(checkKubeconfigServer(kubeconfig("https://localhost:6443"))).toEqual([]);
    expect(checkKubeconfigServer(kubeconfig("https://127.0.0.1:6443"))).toEqual([]);
  });

  it("la dirección del VPS no pasa, que es la cicatriz de ../iaac", () => {
    const problemas = checkKubeconfigServer(kubeconfig("https://203.0.113.10:6443"));
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("túnel SSH");
  });

  it("un kubeconfig sin `server` no lleva a ninguna parte", () => {
    expect(checkKubeconfigServer("apiVersion: v1")).toHaveLength(1);
  });
});

describe("convenciones de nombres y etiquetas", () => {
  it("el nombre lleva el ambiente y el componente", () => {
    expect(resourceName("prod", "postgres")).toBe("kamayuk-prod-postgres");
    expect(namespaceName("stg")).toBe("kamayuk-stg");
  });

  it("las cuatro etiquetas obligatorias van en todo recurso", () => {
    expect(commonLabels("stg", "keycloak")).toEqual({
      proyecto: "kamayuk",
      ambiente: "stg",
      componente: "keycloak",
      "gestionado-por": "pulumi",
    });
  });
});
