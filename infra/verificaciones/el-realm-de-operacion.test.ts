/**
 * #148 — el realm de quien OPERA la plataforma (ADR-0041).
 *
 * Un tercer realm, `<realm>-operacion`, con un unico cliente —`kamayuk-grafana`— y un unico
 * operador, derivado del `administrador` de la municipalidad implantada. Es la mitad de
 * identidad de publicar Grafana con login (#149); la otra mitad no esta aqui.
 *
 * ## Lo que se midio antes de escribir esto, y por que hay una prueba que EJECUTA el guion
 *
 * Contra un Keycloak 26.0.8 —la version exacta de `stg`— el 2026-09-13: reimportar un cliente con
 * `partialImport` e `ifResourceExists: OVERWRITE`, que es como los otros dos realms aplican los
 * suyos, **borra el cliente y lo crea de nuevo**. Id nuevo, roles del cliente: ninguno, rol del
 * operador: perdido, clave: regenerada. Con los clientes de los otros dos realms da igual; con
 * este, cada corrida del `Job` dejaria a todo operador sin rol, y Grafana con el rol estricto sin
 * nadie que pueda entrar. Y nada de eso se ve en un manifiesto: se ve cuando nadie entra.
 *
 * Por eso la guarda de ese punto no lee el texto del guion: lo ejecuta con un `kcadm` de mentira
 * que anota lo que recibe —el mismo recurso con que se midio el paso de los ambitos— y mira que
 * nunca se pida un `partialImport`.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { construirManifiestos } from "../componentes";
import {
  CLAIM_DE_ROLES,
  CLIENTE_DE_GRAFANA,
  CUENTAS_DE_OPERACION_DE_PRUEBA,
  DIRECTORIO_DE_OPERACION,
  ROLES_DE_OPERACION,
  documentosDeIdentidades,
  documentosDeOperadores,
  realmDeOperacion,
} from "../componentes/Identidad";
import { CLAVES, RUTA_DE_GRAFANA } from "../componentes/convenciones";
import { municipalidadesJson, raizDelRepositorio } from "../componentes/fuentes";
import { inventarioDelAmbiente } from "../componentes/secretos";
import type { ConfigMap, Contenedor, Job } from "../componentes/tipos";
import { ENVIRONMENTS, resourceName, type Environment } from "../config";
import { invariantesDe } from "./stacks";

function delAmbiente(ambiente: Environment): { datos: Record<string, string>; job: Job } {
  const ms = construirManifiestos(invariantesDe(ambiente));
  const nombre = resourceName(ambiente, "realm");
  // Los dos llevan huella en el nombre, el `ConfigMap` desde #84: los separa el `kind`.
  const cm = ms.find((m) => m.kind === "ConfigMap" && m.metadata.name.startsWith(`${nombre}-`));
  const job = ms.find((m) => m.kind === "Job" && m.metadata.name.startsWith(`${nombre}-`));
  expect(cm, `el ambiente no compone el ConfigMap «${nombre}-<huella>»`).toBeDefined();
  expect(job, `el ambiente no compone el Job «${nombre}-<huella>»`).toBeDefined();
  return { datos: (cm as ConfigMap).data, job: job as Job };
}

function json<T>(datos: Record<string, string>, clave: string): T {
  const texto = datos[clave];
  expect(texto, `el ConfigMap del realm no trae «${clave}»`).toBeDefined();
  return JSON.parse(texto ?? "{}") as T;
}

interface Cliente {
  clientId: string;
  publicClient: boolean;
  standardFlowEnabled: boolean;
  implicitFlowEnabled: boolean;
  directAccessGrantsEnabled: boolean;
  serviceAccountsEnabled: boolean;
  redirectUris: string[];
  webOrigins: string[];
  attributes: Record<string, string>;
  protocolMappers: { name: string; protocolMapper: string; config: Record<string, string> }[];
}

describe("#148 · el realm de operacion", () => {
  it.each(ENVIRONMENTS)(
    "«%s»: va en el ConfigMap del realm, sin clientes ni ambitos, y con proteccion contra fuerza bruta",
    (ambiente) => {
      const { datos } = delAmbiente(ambiente);
      const realm = json<Record<string, unknown>>(datos, "realm-operacion.json");
      const funcionarios = json<Record<string, unknown>>(datos, "realm.json");

      expect(realm.realm).toBe(realmDeOperacion(invariantesDe(ambiente).identity.realm));
      // Sin `clientScopes`: declararlos en el documento que se crea SUSTITUYE los trece de
      // fabrica y los tokens salen sin `preferred_username` (#72). Sin `clients`: su cliente no
      // se importa, se crea o se actualiza (ver abajo).
      expect(Object.keys(realm)).not.toContain("clientScopes");
      expect(Object.keys(realm)).not.toContain("clients");
      expect(realm.bruteForceProtected, "su pantalla de acceso es publica").toBe(true);
      expect(realm.registrationAllowed, "nadie se da de alta solo como operador").toBe(false);
      // Hereda los ajustes del de funcionarios: si ese endurece `sslRequired`, este tambien.
      expect(realm.sslRequired).toBe(funcionarios.sslRequired);
    },
  );

  it.each(ENVIRONMENTS)(
    "«%s»: su unico cliente es confidencial, con PKCE, sin concesion directa, y vuelve SOLO a /grafana",
    (ambiente) => {
      const { datos } = delAmbiente(ambiente);
      const cliente = json<Cliente>(datos, "cliente-operacion.json");
      const origen = `https://${invariantesDe(ambiente).ingress.domain}`;

      expect(cliente.clientId).toBe(CLIENTE_DE_GRAFANA);
      expect(cliente.publicClient, "un cliente de Grafana sin clave").toBe(false);
      expect(cliente.standardFlowEnabled).toBe(true);
      expect(cliente.implicitFlowEnabled).toBe(false);
      expect(cliente.serviceAccountsEnabled).toBe(false);
      // Con concesion directa la clave de un operador se probaria sin pasar por la pantalla de
      // acceso, que es donde estan la fuerza bruta y el cambio de clave obligatorio.
      expect(cliente.directAccessGrantsEnabled).toBe(false);
      expect(cliente.attributes["pkce.code.challenge.method"]).toBe("S256");
      // EXACTA: un `/*` dejaria volver a cualquier ruta del dominio con el codigo en la URL.
      expect(cliente.redirectUris).toEqual([`${origen}${RUTA_DE_GRAFANA}/login/generic_oauth`]);
      expect(cliente.webOrigins).toEqual([origen]);
    },
  );

  it("el mapeador de roles va en el ID token, el access token y userinfo, y lee su propio cliente", () => {
    const cliente = json<Cliente>(delAmbiente("prod").datos, "cliente-operacion.json");
    const mapeador = cliente.protocolMappers.find((m) => m.config["claim.name"] === CLAIM_DE_ROLES);

    expect(mapeador, "sin el mapeador los roles no viajan y Grafana no deja entrar a nadie")
      .toBeDefined();
    expect(mapeador?.protocolMapper).toBe("oidc-usermodel-client-role-mapper");
    expect(mapeador?.config["usermodel.clientRoleMapping.clientId"]).toBe(CLIENTE_DE_GRAFANA);
    // Grafana lee el ID token y userinfo, no el access token: medido contra Keycloak 26.0.8, con
    // estas tres banderas `roles` sale en los tres.
    expect(mapeador?.config["id.token.claim"]).toBe("true");
    expect(mapeador?.config["userinfo.token.claim"]).toBe("true");
    expect(mapeador?.config["access.token.claim"]).toBe("true");
  });

  it("el perfil de operacion no admite municipalidad_id, y el de funcionarios si", () => {
    const { datos } = delAmbiente("prod");
    const nombres = (clave: string) =>
      json<{ attributes: { name: string }[] }>(datos, clave).attributes.map((a) => a.name);

    expect(nombres("perfil-de-usuario.json")).toContain("municipalidad_id");
    expect(nombres("perfil-de-usuario-operacion.json")).not.toContain("municipalidad_id");
    expect(nombres("perfil-de-usuario-operacion.json")).toEqual(
      expect.arrayContaining(["username", "email", "firstName", "lastName"]),
    );
  });

  it.each(ENVIRONMENTS)(
    "«%s»: el unico operador es el administrador de la municipalidad implantada, con rol administrador",
    (ambiente) => {
      const invariantes = invariantesDe(ambiente);
      const fuente = municipalidadesJson().find((m) => m.ubigeo === invariantes.implantacion.ubigeo);
      const municipalidad = JSON.parse(fuente?.contenido ?? "{}") as {
        usuarios: { cuenta: string; nombre: string; apellido: string; correo: string; administrador?: boolean }[];
      };
      const administrador = municipalidad.usuarios.find((u) => u.administrador === true);

      const filas = (delAmbiente(ambiente).datos["operadores.tsv"] ?? "")
        .split("\n")
        .filter((l) => l.startsWith("OPERADOR\t"));
      // Las de `OPERADOR_DE_PRUEBA` (#149) no son operadores: son las cuentas de la verificacion
      // del login, y tienen su prueba aparte.
      expect(filas, "tiene que haber exactamente un operador, y derivado").toHaveLength(1);
      expect(filas[0]?.split("\t")).toEqual([
        "OPERADOR",
        administrador?.cuenta,
        administrador?.nombre,
        administrador?.apellido,
        administrador?.correo,
        "administrador",
      ]);
      expect(administrador?.cuenta).toBe(invariantes.implantacion.administrador);
    },
  );

  it("cambiar el administrador de la municipalidad cambia el operador", () => {
    // Derivado quiere decir esto: no hay una segunda lista que acordarse de tocar.
    const municipalidad = {
      ubigeo: "150101",
      municipalidadId: 7,
      grupo: "municipalidad-150101",
      usuarios: [
        { cuenta: "otra-cuenta", nombre: "Otra", apellido: "Persona", correo: "otra@example.pe", administrador: true },
      ],
    };
    const identidades = documentosDeIdentidades({
      municipalidades: [{ ubigeo: "150101", contenido: JSON.stringify(municipalidad) }],
      ubigeo: "150101",
      administrador: "otra-cuenta",
    });
    const operadores = documentosDeOperadores({ administrador: identidades.administrador });

    expect(operadores.cuentas).toEqual(["otra-cuenta"]);
    expect(operadores.tsv).toBe("OPERADOR\totra-cuenta\tOtra\tPersona\totra@example.pe\tadministrador\n");
  });

  it("un tabulador en un campo no desplaza el rol a otra columna", () => {
    expect(() =>
      documentosDeOperadores({
        administrador: { cuenta: "a", nombre: "Con\tTabulador", apellido: "b", correo: "c@example.pe" },
      }),
    ).toThrow(/nombre/);
  });

  it.each(ENVIRONMENTS)(
    "«%s»: el Job lo aplica AL FINAL, y del Secret de Grafana monta solo la clave del cliente",
    (ambiente) => {
      const { job } = delAmbiente(ambiente);
      const pod = job.spec.template.spec;
      const contenedor = pod.containers[0] as Contenedor;
      const mandato = (contenedor.command ?? []).join(" ");

      // Detras del ciudadano: si falla, la municipalidad y el portal siguen trabajando.
      expect(mandato.endsWith(
        "/realm/reconciliar-identidades.sh ciudadanos" +
          " && /realm/reconciliar-realm.sh operacion" +
          " && /realm/reconciliar-identidades.sh operadores",
      )).toBe(true);

      const variables = new Map((contenedor.env ?? []).map((v) => [v.name, v.value]));
      expect(variables.get("KC_REALM_OPERACION")).toBe(
        realmDeOperacion(invariantesDe(ambiente).identity.realm),
      );
      expect(variables.get("KC_CLIENTE_OPERACION")).toBe(CLIENTE_DE_GRAFANA);
      expect(variables.get("KC_ROLES_OPERACION")).toBe(ROLES_DE_OPERACION.join(" "));
      expect(variables.get("CLAVE_DEL_CLIENTE_DE_OPERACION")).toBe(
        `${DIRECTORIO_DE_OPERACION}/${CLAVES.clienteOidcDeGrafana}`,
      );

      const volumen = (pod.volumes ?? []).find((v) => v.name === "operacion");
      expect(volumen?.secret?.secretName).toBe(resourceName(ambiente, "grafana"));
      // SOLO la del cliente, y en `stg` las de las dos cuentas de prueba (#149): el mismo `Secret`
      // guarda la clave del administrador de Grafana, y esa no la monta nunca.
      const esperadas = [
        CLAVES.clienteOidcDeGrafana,
        ...(invariantesDe(ambiente).identity.seedTestUsers
          ? CUENTAS_DE_OPERACION_DE_PRUEBA.map((c) => c.clave)
          : []),
      ];
      expect(volumen?.secret?.items).toEqual(esperadas.map((clave) => ({ key: clave, path: clave })));
      expect(volumen?.secret?.items?.map((i) => i.key)).not.toContain(CLAVES.grafana);
      expect(contenedor.volumeMounts).toContainEqual({
        name: "operacion",
        mountPath: DIRECTORIO_DE_OPERACION,
        readOnly: true,
      });
    },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// El cliente de operacion NUNCA pasa por `partialImport`: se ejecuta el guion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Un `kcadm` de mentira: anota cada invocacion y contesta lo minimo para que el modo
 * `operacion` llegue al final. Lo que no espera lo rechaza con 97, para que un paso nuevo del
 * guion no pase desapercibido contestandole cualquier cosa.
 */
const KCADM_FALSO = `#!/bin/bash
echo "$*" >> "$FALSO_DIR/llamadas"
case "$*" in
  "config credentials"*|"get realms/"*|"update realms/"*|"create realms"*|"update users/profile"*) exit 0 ;;
  "get clients -r "*"--fields id"*)
    if [ "$FALSO_CLIENTE_EXISTE" = 1 ] || [ -e "$FALSO_DIR/creado" ]; then echo "id-1"; fi
    exit 0 ;;
  "create clients -r "*) touch "$FALSO_DIR/creado"; exit 0 ;;
  "update clients/id-1 "*|"create clients/id-1/roles "*) exit 0 ;;
  "get clients/id-1/roles "*) printf 'lector\\nadministrador\\n'; exit 0 ;;
  "get clients/id-1/client-secret "*) printf '{\\n  "type" : "secret",\\n  "value" : "%s"\\n}\\n' "$(<"$FALSO_CLAVE")"; exit 0 ;;
  "get clients -r "*) printf '[ { "clientId" : "kamayuk-grafana", "protocolMappers" : [ { "config" : { "claim.name" : "roles" } } ] } ]\\n'; exit 0 ;;
  *partialImport*) exit 0 ;;
  *) echo "kcadm falso: no se esperaba «$*»" >&2; exit 97 ;;
esac
`;

function reconciliarOperacion(clienteExiste: boolean): { llamadas: string[]; salida: string } {
  const dir = mkdtempSync(join(tmpdir(), "realm-operacion-"));
  try {
    for (const [clave, contenido] of Object.entries(delAmbiente("prod").datos)) {
      writeFileSync(join(dir, clave), contenido);
    }
    writeFileSync(join(dir, "kcadm"), KCADM_FALSO, { mode: 0o755 });
    writeFileSync(join(dir, "clave-cliente"), "clave-de-prueba-del-cliente");
    const salida = execFileSync(
      "bash",
      [join(raizDelRepositorio(), "infra/componentes/identidad/reconciliar-realm.sh"), "operacion"],
      {
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          KC_SERVIDOR: "http://keycloak.invalid/keycloak",
          KC_REALM: "kamayuk",
          KC_ADMIN: "admin",
          KC_CLAVE: "no-importa",
          KCADM: join(dir, "kcadm"),
          KC_DIRECTORIO: dir,
          KC_REALM_OPERACION: "kamayuk-operacion",
          KC_CLIENTE_OPERACION: CLIENTE_DE_GRAFANA,
          KC_ROLES_OPERACION: ROLES_DE_OPERACION.join(" "),
          CLAVE_DEL_CLIENTE_DE_OPERACION: join(dir, "clave-cliente"),
          FALSO_DIR: dir,
          FALSO_CLAVE: join(dir, "clave-cliente"),
          FALSO_CLIENTE_EXISTE: clienteExiste ? "1" : "0",
        },
      },
    );
    const llamadas = readFileSync(join(dir, "llamadas"), "utf8").split("\n").filter((l) => l !== "");
    return { llamadas, salida };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("#148 · el cliente de operacion se crea o se actualiza, nunca se reimporta", () => {
  it("con el cliente ya creado: `update -f`, y ni un `partialImport`", () => {
    const { llamadas, salida } = reconciliarOperacion(true);

    expect(
      llamadas.filter((l) => l.includes("partialImport")),
      "el modo `operacion` pidio un `partialImport`. Con `OVERWRITE` eso BORRA el cliente: sus " +
        "roles, el rol de cada operador y su clave (medido contra Keycloak 26.0.8). Cada corrida " +
        "del Job dejaria a Grafana sin nadie que pueda entrar.",
    ).toEqual([]);
    expect(llamadas).toContainEqual(expect.stringMatching(/^update clients\/id-1 -r kamayuk-operacion -f .*cliente-operacion\.json$/));
    expect(llamadas.some((l) => l.startsWith("create clients -r"))).toBe(false);
    expect(salida).toContain("Realm «kamayuk-operacion» reconciliado.");
  });

  it("sin el cliente: `create -f` la primera vez, y tampoco `partialImport`", () => {
    const { llamadas } = reconciliarOperacion(false);

    expect(llamadas.filter((l) => l.includes("partialImport"))).toEqual([]);
    expect(llamadas).toContainEqual(expect.stringMatching(/^create clients -r kamayuk-operacion -f .*cliente-operacion\.json$/));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// #149 — las dos cuentas de prueba del realm de operacion, solo en `stg`
// ─────────────────────────────────────────────────────────────────────────────

describe("#149 · las cuentas de prueba del realm de operacion", () => {
  it.each(ENVIRONMENTS)("«%s»: estan donde se siembran usuarios de prueba, y en ningun otro sitio", (ambiente) => {
    const siembra = invariantesDe(ambiente).identity.seedTestUsers;
    const filas = (delAmbiente(ambiente).datos["operadores.tsv"] ?? "")
      .split("\n")
      .filter((l) => l.startsWith("OPERADOR_DE_PRUEBA\t"))
      .map((l) => l.split("\t"));

    if (!siembra) {
      expect(filas, "cuentas con clave permanente en un ambiente sin usuarios de prueba").toEqual([]);
      expect(
        inventarioDelAmbiente(invariantesDe(ambiente)).filter((e) => e.rol.startsWith("grafana-operador-de-prueba")),
      ).toEqual([]);
      return;
    }
    // Las dos, con el rol exacto: una con `lector` y otra con «-». La de «-» es la que demuestra
    // que sin rol no se entra.
    expect(filas.map((f) => [f[1], f[5], f[6]])).toEqual(
      CUENTAS_DE_OPERACION_DE_PRUEBA.map((c) => [c.cuenta, c.rol ?? "-", c.clave]),
    );
    expect(
      inventarioDelAmbiente(invariantesDe(ambiente))
        .filter((e) => e.rol.startsWith("grafana-operador-de-prueba"))
        .map((e) => `${e.secreto}/${e.clave}`),
    ).toEqual(CUENTAS_DE_OPERACION_DE_PRUEBA.map((c) => `${resourceName(ambiente, "grafana")}/${c.clave}`));
  });

  it("alguno de los dos ambientes siembra usuarios de prueba, o lo de arriba no mide nada", () => {
    expect(ENVIRONMENTS.some((a) => invariantesDe(a).identity.seedTestUsers)).toBe(true);
    expect(ENVIRONMENTS.some((a) => !invariantesDe(a).identity.seedTestUsers)).toBe(true);
  });
});

/**
 * Un `kcadm` de mentira para `reconciliar-identidades.sh operadores`: las tres cuentas ya existen,
 * y cada una contesta con los roles que `FALSO_ROLES_<cuenta>` diga.
 */
const KCADM_FALSO_DE_OPERADORES = `#!/bin/bash
echo "$*" >> "$FALSO_DIR/llamadas"
case "$*" in
  "config credentials"*) exit 0 ;;
  "get clients -r "*"--fields id"*) echo "id-1"; exit 0 ;;
  "get users -r "*"username="*)
    for a in "$@"; do case "$a" in username=*) echo "uid-\${a#username=}" ;; esac; done; exit 0 ;;
  "get users/uid-"*) printf '{\\n  "enabled" : true\\n}\\n'; exit 0 ;;
  "update users/uid-"*|"set-password "*|"add-roles "*|"remove-roles "*) exit 0 ;;
  "get-roles "*)
    for a in "$@"; do [ "$previo" = "--uusername" ] && cuenta="$a"; previo="$a"; done
    case "$cuenta" in
      administrador) echo "administrador" ;;
      operador-de-prueba-lector) echo "lector" ;;
    esac
    exit 0 ;;
  *) echo "kcadm falso: no se esperaba «$*»" >&2; exit 97 ;;
esac
`;

describe("#149 · el guion trata a las cuentas de prueba como lo que son", () => {
  it("clave PERMANENTE, y a la de rol «-» se le QUITAN los roles en vez de darselos", () => {
    const dir = mkdtempSync(join(tmpdir(), "operadores-"));
    try {
      writeFileSync(join(dir, "operadores.tsv"), delAmbiente("stg").datos["operadores.tsv"] ?? "");
      writeFileSync(join(dir, "kcadm"), KCADM_FALSO_DE_OPERADORES, { mode: 0o755 });
      for (const c of CUENTAS_DE_OPERACION_DE_PRUEBA) writeFileSync(join(dir, c.clave), `valor-de-${c.cuenta}`);
      execFileSync("bash", [join(raizDelRepositorio(), "despliegue/identidad/reconciliar-identidades.sh"), "operadores"], {
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          KC_MODO: "directo",
          KCADM: join(dir, "kcadm"),
          KC_SERVIDOR: "http://keycloak.invalid/keycloak",
          KC_ADMIN: "admin",
          KC_CLAVE: "no-importa",
          KC_DIRECTORIO: dir,
          KC_REALM_OPERACION: "kamayuk-operacion",
          KC_CLIENTE_OPERACION: CLIENTE_DE_GRAFANA,
          KC_ROLES_OPERACION: ROLES_DE_OPERACION.join(" "),
          CLAVES_DE_OPERACION: dir,
          SIN_CORREO: "1",
          KC_CLAVE_INICIAL: "no-se-usa",
          FALSO_DIR: dir,
        },
      });
      const llamadas = readFileSync(join(dir, "llamadas"), "utf8").split("\n").filter((l) => l !== "");

      const [lector, sinRol] = CUENTAS_DE_OPERACION_DE_PRUEBA;
      const claveDe = llamadas.filter((l) => l.startsWith(`set-password -r kamayuk-operacion --username ${lector?.cuenta} `));
      expect(claveDe, "la cuenta de prueba con rol no recibio su clave").toHaveLength(1);
      expect(claveDe[0], "la clave de una cuenta de prueba tiene que ser PERMANENTE").not.toContain("--temporary");
      expect(claveDe[0]).toContain(`valor-de-${lector?.cuenta}`);

      const aSinRol = llamadas.filter((l) => l.includes(`--uusername ${sinRol?.cuenta} `));
      expect(
        aSinRol.filter((l) => l.startsWith("add-roles ")),
        "a la cuenta SIN rol se le asigno uno: deja de demostrar que sin rol no se entra",
      ).toEqual([]);
      expect(
        aSinRol.filter((l) => l.startsWith("remove-roles ")).map((l) => l.replace(/.* --rolename /, "")),
        "a la cuenta sin rol no se le quitan los roles que alguien le haya puesto a mano",
      ).toEqual([...ROLES_DE_OPERACION]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
