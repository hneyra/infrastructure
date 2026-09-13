import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { construirManifiestos } from "../componentes";
import {
  REALM_DERIVADO,
  documentosDelRealmDelCompose,
  piezasDelRealm,
} from "../componentes/Identidad";
import { raizDelRepositorio, realmCiudadanoJson } from "../componentes/fuentes";
import { resourceName } from "../config";
import { invariantesDe } from "./stacks";

/**
 * #72, la mitad del COMPOSE — lo que `--import-realm` consume en local no declara `clientScopes`,
 * y lo que eso deja fuera lo aplica el mismo guion que en el cluster.
 *
 * ## El defecto
 *
 * Declarar `clientScopes` en el documento que Keycloak importa **sustituye** sus trece ambitos de
 * fabrica en vez de anadirse a ellos. Medido en `stg` el 2026-09-11: el realm que los declaraba
 * tenia **2** ambitos, y los cuatro del mismo Keycloak que no, **13**. Sin `profile` no hay
 * `preferred_username` y sin `basic` no hay `sub`: todo funcionario recibe 403 con un token
 * perfectamente valido, y el mensaje —«la cuenta «» no esta dada de alta»— manda a mirar el alta.
 *
 * ## Por que la mitad del cluster no lo cerro
 *
 * `74b3c64` saco la clave de lo que el `Job` importa, y su guarda
 * (`el-realm-cabe-en-keycloak.test.ts`) mira los documentos DERIVADOS. Pero
 * `plataforma.compose.yaml` montaba el archivo versionado **en crudo**, que es la fuente de esa
 * derivacion y sigue declarando la clave. Asi que el camino que MAS se usa —una maquina nueva, el
 * arranque en limpio de CI— seguia naciendo con dos ambitos, tapado por un rodeo de 300 lineas
 * (`restaurar-ambitos-de-fabrica.sh`) que los volvia a crear preguntandoselos a un realm de
 * laboratorio.
 *
 * ## Lo que se fija aqui
 *
 * - **(a)** ningun realm montado en `/opt/keycloak/data/import/` declara `clientScopes`;
 * - **(b)** lo montado es, byte a byte, lo que produce `piezasDelRealm` —la misma funcion que
 *   alimenta el `ConfigMap` del cluster—, y en lo que importa dice lo mismo que ese `ConfigMap`;
 * - **(c)** nadie invoca ya el rodeo. La PROSA que cuenta por que existio no dispara nada: un
 *   comentario que explica no es una invocacion (#76);
 * - **(d)** la otra mitad: lo que el import ya no trae —`kamayuk-servicio`— lo aplica
 *   `reconciliar-realm.sh`, montado y ejecutado dentro del contenedor, ANTES de los clientes de
 *   servicio. Sin esto, quitar la clave del import cambiaria un 403 por otro: el del token de
 *   servicio sin `municipalidad_id` (#21).
 *
 * ## Lo que esta guarda NO puede ver
 *
 * Que el compose arranque y el realm quede con sus trece. Eso pide un demonio de Docker, y lo
 * mide `arranque-en-limpio.yml` en cada PR que toque `despliegue/`.
 */

interface Servicio {
  volumes?: string[];
}

interface Montaje {
  /** La ruta en el anfitrion, absoluta. */
  readonly origen: string;
  readonly destino: string;
}

const RAIZ = raizDelRepositorio();
const DESPLIEGUE = join(RAIZ, "despliegue");
const IMPORTAR = "/opt/keycloak/data/import/";
const GUION_DEL_JOB = join(RAIZ, "infra/componentes/identidad/reconciliar-realm.sh");
const PREPARAR = join(RAIZ, "despliegue/identidad/preparar-identidades.sh");
/** Compuesto, para que esta misma guarda no se nombre a si misma en una linea de codigo. */
const EL_RODEO = ["restaurar", "ambitos", "de", "fabrica"].join("-") + ".sh";

function montajesDeKeycloak(): Montaje[] {
  const compose = load(readFileSync(join(DESPLIEGUE, "plataforma.compose.yaml"), "utf8")) as {
    services: Record<string, Servicio>;
  };
  return (compose.services["identidad"]?.volumes ?? []).map((volumen) => {
    const [origen = "", destino = ""] = volumen.split(":");
    return { origen: resolve(DESPLIEGUE, origen), destino };
  });
}

const deImport = () => montajesDeKeycloak().filter((m) => m.destino.startsWith(IMPORTAR));

/** Los archivos de un arbol, relativos a el, sin entrar en `node_modules`. */
function archivosBajo(directorio: string, desde = ""): string[] {
  if (!existsSync(join(directorio, desde))) return [];
  return readdirSync(join(directorio, desde), { withFileTypes: true })
    .flatMap((entrada) => {
      const ruta = desde === "" ? entrada.name : `${desde}/${entrada.name}`;
      if (entrada.isDirectory()) {
        return entrada.name === "node_modules" ? [] : archivosBajo(directorio, ruta);
      }
      return entrada.isFile() ? [ruta] : [];
    })
    .sort();
}

/** Solo el codigo: una linea de comentario cuenta historia, no invoca nada (#76). */
export function lineasDeCodigo(texto: string, extension: string): string[] {
  const deLinea =
    extension === ".sh" || extension === ".yml" || extension === ".yaml"
      ? /(^|\s)#.*$/
      : /(?<!:)\/\/.*$/;
  return texto.split("\n").map((linea) => {
    const limpia = linea.replace(deLinea, "");
    return /^\s*(\*|\/\*|\/\/)/.test(limpia) ? "" : limpia;
  });
}

const EXTENSIONES = new Set([".sh", ".yml", ".yaml", ".ts", ".mjs", ".js"]);

function codigoQueNombra(nombre: string): { archivo: string; linea: number; texto: string }[] {
  const hallazgos: { archivo: string; linea: number; texto: string }[] = [];
  for (const arbol of ["despliegue", "infra", ".github"]) {
    const base = join(RAIZ, arbol);
    for (const ruta of archivosBajo(base)) {
      const extension = extname(ruta);
      if (!EXTENSIONES.has(extension)) continue;
      const completa = join(base, ruta);
      lineasDeCodigo(readFileSync(completa, "utf8"), extension).forEach((texto, i) => {
        if (texto.includes(nombre)) {
          hallazgos.push({ archivo: relative(RAIZ, completa), linea: i + 1, texto: texto.trim() });
        }
      });
    }
  }
  return hallazgos;
}

describe("#72 · el compose importa el realm DERIVADO, sin `clientScopes`", () => {
  it("EL CENTINELA: el compose monta realms para importar, y existen", () => {
    // Sin esto, (a) y (b) se cumplirian sobre una lista vacia: un compose que dejara de montar
    // realms —o que cambiara el directorio de import— pasaria en verde.
    const montajes = deImport();
    expect(
      montajes.length,
      `el servicio «identidad» de plataforma.compose.yaml no monta ningun realm en ${IMPORTAR}`,
    ).toBeGreaterThanOrEqual(2);
    for (const { origen, destino } of montajes) {
      expect(
        existsSync(origen) && statSync(origen).isFile(),
        `«${relative(RAIZ, origen)}» (montado en ${destino}) no existe como archivo. Docker no da ` +
          "error por eso: crea un DIRECTORIO vacio en su lugar, y el import falla lejos y con otro " +
          "mensaje. Se regenera con `cd infra && yarn realm-del-compose`",
      ).toBe(true);
      expect(typeof (JSON.parse(readFileSync(origen, "utf8")) as { realm?: unknown }).realm).toBe(
        "string",
      );
    }
  });

  it("(a) ningun realm montado para `--import-realm` declara `clientScopes`", () => {
    for (const { origen } of deImport()) {
      expect(
        Object.keys(JSON.parse(readFileSync(origen, "utf8")) as Record<string, unknown>),
        `«${relative(RAIZ, origen)}» declara «clientScopes» y el compose lo importa: en un import ` +
          "completo esa clave SUSTITUYE los trece ambitos de fabrica de Keycloak. Medido, el realm " +
          "se queda con dos, sin `profile` —sin `preferred_username`— y sin `basic` —sin `sub`—, y " +
          "todo funcionario recibe 403 con un token valido (#72). El compose tiene que montar " +
          `\`${REALM_DERIVADO}/importar/\`, no el archivo versionado`,
      ).not.toContain("clientScopes");
    }
  });

  it("(b) cada realm montado es, byte a byte, el que deriva `piezasDelRealm`", () => {
    const derivados = documentosDelRealmDelCompose();
    const montados = deImport();
    expect(
      montados.map((m) => relative(join(RAIZ, REALM_DERIVADO), m.origen)).sort(),
      `el compose no monta exactamente los realms de \`${REALM_DERIVADO}/importar/\`: o monta ` +
        "otra cosa —el versionado en crudo, que es #72—, o deja un realm derivado sin importar",
    ).toEqual(Object.keys(derivados).filter((r) => r.startsWith("importar/")).sort());
    for (const { origen } of montados) {
      const clave = relative(join(RAIZ, REALM_DERIVADO), origen);
      expect(
        readFileSync(origen, "utf8"),
        `«${relative(RAIZ, origen)}» no es lo que produce la derivacion: no se edita a mano, se ` +
          "regenera con `cd infra && yarn realm-del-compose`",
      ).toBe(derivados[clave]);
    }
  });

  it("(b) `realm-derivado/` versionado es exactamente lo que el generador produce, y nada mas", () => {
    const derivados = documentosDelRealmDelCompose();
    const directorio = join(RAIZ, REALM_DERIVADO);
    // Nada de mas: `reconciliar-realm.sh` recorre `ambito--*.json` con un glob, asi que un
    // ambito renombrado que dejara el viejo en disco se seguiria creando en cada maquina.
    expect(
      archivosBajo(directorio),
      `\`${REALM_DERIVADO}/\` no tiene los archivos que el generador escribe (sobran o faltan). ` +
        "Se regenera con `cd infra && yarn realm-del-compose`",
    ).toEqual(Object.keys(derivados).sort());
    for (const [ruta, contenido] of Object.entries(derivados)) {
      expect(
        readFileSync(join(directorio, ruta), "utf8"),
        `«${REALM_DERIVADO}/${ruta}» no se edita a mano: se regenera con \`yarn realm-del-compose\``,
      ).toBe(contenido);
    }
  });

  /**
   * Y lo derivado para el compose dice, en lo que importa, lo mismo que lo que importa el cluster.
   *
   * Se compara contra el `ConfigMap` de verdad de `stg`, no contra otra llamada a la derivacion:
   * comparar la funcion consigo misma no detectaria que el compose dejara de usarla. Lo que se
   * permite distinto es exactamente lo que el cluster adapta al ambiente —el nombre del realm, el
   * `displayName`, el relay y el ORIGEN de las redirecciones—.
   */
  it("(b) y en lo que importa dice lo mismo que el `ConfigMap` del `Job` de «stg»", () => {
    // Por prefijo y no por nombre exacto: desde #84 el nombre lleva la huella del contenido
    // (`nombreDelConfigMapDelRealm`), igual que lo buscan `ambitos-del-realm.test.ts` y
    // `el-realm-de-operacion.test.ts`. Con el nombre fijo esta prueba salio roja al fundirse con #84.
    const configMap = construirManifiestos(invariantesDe("stg")).find(
      (m) =>
        m.kind === "ConfigMap" && m.metadata.name.startsWith(`${resourceName("stg", "realm")}-`),
    ) as { data: Record<string, string> } | undefined;
    expect(configMap, "stg no compone el ConfigMap del realm").toBeDefined();
    const cluster = configMap?.data ?? {};
    const compose = documentosDelRealmDelCompose();

    const sinLoDelAmbiente = (json: string) => {
      const resto = JSON.parse(json) as Record<string, unknown>;
      for (const clave of ["realm", "displayName", "smtpServer"]) delete resto[clave];
      return resto;
    };
    expect(
      sinLoDelAmbiente(compose["reconciliar/realm.json"] ?? "{}"),
      "los ajustes del realm del compose y los del cluster se separaron",
    ).toEqual(sinLoDelAmbiente(cluster["realm.json"] ?? "{}"));

    expect(
      `${cluster["perfil-de-usuario.json"] ?? ""}\n`,
      "el perfil de usuario del compose no es el del cluster: el atributo del claim podria no " +
        "existir en uno de los dos",
    ).toBe(compose["reconciliar/perfil-de-usuario.json"]);

    type Carga = { clients: { clientId: string; protocolMappers?: { name: string }[] }[] };
    const clientesDe = (json: string) =>
      (JSON.parse(json) as Carga).clients
        .map((c) => `${c.clientId}: ${(c.protocolMappers ?? []).map((m) => m.name).join(",")}`)
        .sort();
    expect(
      clientesDe(compose["reconciliar/clientes.json"] ?? '{"clients":[]}'),
      "los clientes del compose y los de «stg» —con sus mapeadores— se separaron",
    ).toEqual(clientesDe(cluster["clientes.json"] ?? '{"clients":[]}'));

    const ambitosDelCluster = Object.entries(cluster)
      .filter(([k]) => k.startsWith("ambito--"))
      .map(([k, v]) => [k, `${v}\n`]);
    expect(ambitosDelCluster.length, "el ConfigMap no lleva ningun ambito suelto").toBeGreaterThan(0);
    expect(
      Object.entries(compose)
        .filter(([k]) => k.startsWith("reconciliar/ambito--"))
        .map(([k, v]) => [k.replace(/^reconciliar\//, ""), v])
        .sort(),
      "los ambitos sueltos que aplica el compose no son los que aplica el `Job`",
    ).toEqual(ambitosDelCluster.sort());
  });

  it("(c) nadie invoca ya el rodeo, y la prosa que cuenta su historia no cuenta como invocacion", () => {
    expect(
      existsSync(join(RAIZ, "despliegue/identidad", EL_RODEO)),
      `«${EL_RODEO}» volvio: era el rodeo de #72, y la señal de cierre del issue es que no exista`,
    ).toBe(false);

    // El centinela de esta mitad: el barrido LEYO archivos que nombran el rodeo en comentarios
    // —la medida de `convenciones.ts`, la historia de `preparar-identidades.sh`—. Si no los
    // encontrara, el `toEqual([])` de abajo se cumpliria sin haber mirado nada.
    const enProsa = ["infra/componentes/convenciones.ts", "despliegue/identidad/preparar-identidades.sh"];
    for (const archivo of enProsa) {
      expect(
        readFileSync(join(RAIZ, archivo), "utf8"),
        `«${archivo}» ya no cuenta la historia del rodeo: este centinela se quedo sin sujeto`,
      ).toContain(EL_RODEO);
    }

    expect(
      codigoQueNombra(EL_RODEO),
      `una linea de CODIGO vuelve a nombrar «${EL_RODEO}». Era el rodeo de #72, y lo que hacia —` +
        "devolver los trece ambitos de fabrica que el import borraba— ya no hace falta: el compose " +
        `importa \`${REALM_DERIVADO}/importar/\`, sin \`clientScopes\`, y los ambitos sueltos los ` +
        "aplica `reconciliar-realm.sh`",
    ).toEqual([]);
  });

  it("(d) la otra mitad: `reconciliar-realm.sh` se monta y se corre ANTES de los clientes de servicio", () => {
    const montajes = montajesDeKeycloak();
    const documentos = montajes.find((m) => m.origen === join(RAIZ, REALM_DERIVADO, "reconciliar"));
    const guion = montajes.find((m) => m.origen === GUION_DEL_JOB);
    expect(
      documentos,
      `el compose no monta \`${REALM_DERIVADO}/reconciliar/\` en Keycloak: sin el import de ` +
        "`clientScopes`, `kamayuk-servicio` no llegaria al realm por ningun camino",
    ).toBeDefined();
    expect(
      guion,
      "el compose no monta el `reconciliar-realm.sh` del cluster: aplicar los ambitos con otro " +
        "guion seria una segunda implementacion del mismo bucle, que un dia deja de hacer lo suyo",
    ).toBeDefined();
    expect(
      Object.keys(documentosDelRealmDelCompose()),
      "el realm derivado no trae el ambito `kamayuk-servicio` suelto, ni su mapeador",
    ).toEqual(
      expect.arrayContaining([
        "reconciliar/ambito--kamayuk-servicio.json",
        "reconciliar/ambito--kamayuk-servicio--mapeador--municipalidad-id.json",
      ]),
    );

    const codigo = lineasDeCodigo(readFileSync(PREPARAR, "utf8"), ".sh");
    const corre = codigo.findIndex((l) => l.includes(`bash ${guion?.destino ?? "?"}`));
    const directorio = codigo.findIndex((l) =>
      l.includes(`KC_DIRECTORIO=${documentos?.destino ?? "?"}`),
    );
    const servicios = codigo.findIndex((l) => /reconciliar-identidades\.sh"?\s+servicios/.test(l));
    expect(
      corre,
      `\`preparar-identidades.sh\` no ejecuta \`bash ${guion?.destino ?? "?"}\` en ninguna linea de ` +
        "codigo: el realm local se quedaria sin `kamayuk-servicio` y el paso de los clientes de " +
        "servicio moriria con «no se encontro el ambito kamayuk-servicio»",
    ).toBeGreaterThan(-1);
    expect(
      directorio,
      "el guion corre, pero no con `KC_DIRECTORIO` apuntando a donde el compose monta los " +
        "documentos: no encontraria ninguno",
    ).toBeGreaterThan(-1);
    expect(servicios, "`preparar-identidades.sh` ya no reconcilia los clientes de servicio").toBeGreaterThan(-1);
    expect(
      corre,
      "el realm se reconcilia DESPUES de los clientes de servicio: esos necesitan el ambito que " +
        "`reconciliar-realm.sh` crea, y es el orden del `Job` del cluster",
    ).toBeLessThan(servicios);
  });

  it("y el realm del ciudadano no emite ambitos sueltos: en el compose nadie los aplicaria", () => {
    // Si un dia los declara, la derivacion los saca del import —bien— y el compose no tiene quien
    // los cree, porque solo reconcilia el realm de funcionarios. Mejor este rojo que un token de
    // portal sin su claim en una maquina nueva.
    expect(
      piezasDelRealm(realmCiudadanoJson()).ambitos.map((a) => a.nombre),
      "el realm del ciudadano declara ambitos: el compose tiene que reconciliarlo tambien " +
        "(`reconciliar-realm.sh ciudadano`) antes de aceptar esto",
    ).toEqual([]);
  });

  it("la prosa no dispara (c): un comentario de shell, de YAML o de TypeScript no es codigo", () => {
    expect(lineasDeCodigo(`# ${EL_RODEO}\n  -- "$AQUI/${EL_RODEO}"`, ".sh")).toEqual([
      "",
      `  -- "$AQUI/${EL_RODEO}"`,
    ]);
    expect(lineasDeCodigo(` * ${EL_RODEO}\n// ${EL_RODEO}\nconst x = 1; // ${EL_RODEO}`, ".ts")).toEqual([
      "",
      "",
      "const x = 1; ",
    ]);
    // Y `${VAR#prefijo}` no es un comentario: sin espacio delante, el `#` es codigo.
    expect(lineasDeCodigo('NOMBRE=${BASE#"$PREFIJO"}', ".sh")).toEqual(['NOMBRE=${BASE#"$PREFIJO"}']);
    expect(basename(PREPARAR)).toBe("preparar-identidades.sh");
  });
});
