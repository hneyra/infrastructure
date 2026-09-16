import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";
import { CLIENTE_DEL_BACKOFFICE } from "../componentes/Identidad";
import { SISTEMAS_DEL_PRODUCTO } from "../componentes/convenciones";
import { raizDelRepositorio, realmDeFuncionariosJson } from "../componentes/fuentes";
import { composeDeSistema, rutasDeTraefik, type ComposeDeSistema } from "./compose-de-los-sistemas";

/**
 * Una interfaz servida por el ingreso local entra por la puerta, y vuelve del canje (#197).
 *
 * ## El defecto, MEDIDO contra la plataforma local y no leido de la documentacion
 *
 * `despliegue/identidad/realm-kamayuk.json` declaraba las redirecciones del cliente publico
 * `kamayuk-backoffice` con los puertos de DESARROLLO —`5173`, `5181`— y el de la interfaz del
 * monolito retirado —`8081`—, y con ninguno del INGRESO. Desde `caja#83` las cuatro interfaces
 * se sirven por Traefik bajo `http://localhost:8080/<sistema>/`, que es la entrada documentada
 * en los cuatro composes, y `@kamayuk/sesion` manda como `redirect_uri` la raiz de la
 * aplicacion: `window.location.origin + import.meta.env.BASE_URL`.
 *
 * Medido el 2026-09-16 contra la plataforma local (Keycloak 26.0, realm `kamayuk` tal como este
 * archivo lo versiona), pidiendo el `authorization_endpoint` con `client_id=kamayuk-backoffice`,
 * `response_type=code` y `code_challenge_method=S256` — **sin ninguna cuenta**, porque Keycloak
 * valida la redireccion ANTES de pedir credenciales:
 *
 *   - `redirect_uri=http://localhost:8080/caja/` -> **HTTP 400**, pagina de error con
 *     «Invalid parameter: redirect_uri». No hay formulario de acceso: la ventanilla no llega
 *     siquiera a poder escribir su usuario.
 *   - `redirect_uri=http://localhost:5181/caja/` -> **HTTP 200** con el formulario de acceso
 *     (`id="username"`, `kc-form-login`). Ese es el contraste, y es lo que dice que lo primero
 *     no es «Keycloak esta caido» sino «esa redireccion no esta declarada».
 *
 * ## Y la SEGUNDA mitad, que no se ve en el formulario: el origen del canje
 *
 * `webOrigins` no decide si se puede entrar, decide si el navegador puede LEER la respuesta del
 * canje. Medido el mismo dia contra el `token_endpoint`, con un `code` falso a proposito para
 * quedarse en la cabecera y no en el cuerpo:
 *
 *   - `Origin: http://localhost:5181` -> `400` con `Access-Control-Allow-Origin: http://localhost:5181`;
 *   - `Origin: http://localhost:8080` -> `400` **sin ninguna** `Access-Control-Allow-Origin`.
 *
 * O sea que, aun con la redireccion declarada, sin el origen el canje se hace y el navegador
 * tira la respuesta. Por eso esta guarda exige las DOS listas y no solo la primera. (El
 * `preflight` `OPTIONS` contesta `200` y refleja CUALQUIER origen —medido con los dos—, asi que
 * mirar el preflight habria dicho que todo estaba bien.)
 *
 * ## Lo que NO hizo falta, y se escribe porque el issue lo daba por hecho
 *
 * `post.logout.redirect.uris`. `@kamayuk/sesion` cierra sesion con `post_logout_redirect_uri`, y
 * el cliente no declara ese atributo. Medido contra el `end_session_endpoint` con
 * `client_id=kamayuk-backoffice` y sin sesion:
 *
 *   - `post_logout_redirect_uri=http://localhost:5181/caja/` -> **302** a esa misma direccion;
 *   - `http://localhost:8080/caja/` y `https://ejemplo.invalido/` -> **400**, «Invalid redirect uri».
 *
 * Es decir: sin el atributo, Keycloak 26 hereda la lista de `redirectUris` (el `+` implicito).
 * Declararlo habria sido una segunda lista que mantener, y la unica forma de que se quedara
 * atras. Con la redireccion del ingreso puesta, y con una SESION de verdad y el `id_token_hint`
 * que `salir()` manda, el mismo `end_session_endpoint` contesta **302 a
 * `http://localhost:8080/caja/`** — medido. O sea que lo que esta guarda exige es exactamente la
 * lista de la que la salida CUELGA, y por eso no hay una segunda comprobacion para la salida.
 *
 * ## Por que la entrada del realm es del ORIGEN y no de cada camino
 *
 * Porque el realm versionado alimenta tambien al clúster: `documentosDelRealm` reescribe el
 * ORIGEN de cada redireccion con el dominio del ambiente y **conserva el camino**. Medido con
 * `yarn manifiestos` antes y despues, comparando con `cmp`:
 *
 *   - con `http://localhost:8080/<sistema>/*` —una entrada por interfaz— `stg` y `prod` **cambian**:
 *     el cliente del clúster gana `https://<dominio>/{rentas,caja,catastro,normativa}/*`, cuatro
 *     entradas que el `https://<dominio>/*` que ya tenia **ya admite**, y con ellas cambia la
 *     huella del `ConfigMap` del realm, o sea que el `Job` que lo aplica vuelve a correr;
 *   - con `http://localhost:8080/*` —una sola, del origen— los manifiestos salen **identicos byte
 *     a byte** (`stg` 470 620 B, `prod` 462 885 B), porque `enElDominio` lo funde con el
 *     `https://<dominio>/*` que ya estaba. Es la misma propiedad que midio #184 con el 5181.
 *
 * Un arreglo del ingreso LOCAL no tiene por que mover un objeto del clúster, asi que va la del
 * origen. Lo que esta guarda comprueba no cambia por eso: sigue preguntando, interfaz por
 * interfaz, si la redireccion que esa interfaz manda esta admitida — y con la entrada del origen
 * la respuesta es que si para todas, incluida la que nazca manana.
 *
 * ## Las dos mitades se DERIVAN; aqui no hay ninguna lista escrita a mano
 *
 *   - el ORIGEN, del `plataforma.compose.yaml` de este repositorio: el puerto publicado por
 *     Traefik, con el valor por omision de `KAMAYUK_PUERTO_INGRESO` que ese archivo declara. Si
 *     alguien lo cambia alli, el realm tiene que seguirle y esto es lo que lo dice;
 *   - el CAMINO, del compose de cada clon hermano: el servicio que construye `target: interfaz`
 *     y el `PathPrefix` de su router de Traefik. Una interfaz nueva —o una que cambie de
 *     prefijo— sale roja aqui y no como «Invalid parameter: redirect_uri» en la maquina de quien
 *     la levanta por primera vez.
 *
 * ## Su limite, declarado en vez de descubierto
 *
 * Toda interfaz de un sistema del producto se considera del realm de FUNCIONARIOS, que es lo que
 * hoy son las cuatro. El portal del ciudadano (ADR-0020) es de otro realm y de otro cliente
 * —`kamayuk-portal`, en `realm-kamayuk-ciudadano.json`— y **hoy no lo sirve ningun compose**: no
 * hay un servicio con `target: interfaz` que le corresponda, asi que esta guarda no lo mira. El
 * dia que ese portal entre en un compose, saldra rojo aqui pidiendo su redireccion en el cliente
 * del backoffice, que es donde no va. Es el rojo seguro de los dos posibles: obliga a declarar a
 * que realm pertenece cada interfaz, en vez de dejar pasar una sin redireccion.
 */

/** Un servicio del compose de la plataforma, reducido a lo que se lee aqui. */
interface ServicioConPuertos {
  image?: string;
  ports?: string[];
}

/**
 * El puerto que el ingreso local publica, con el valor por omision del compose de la plataforma.
 *
 * Se deriva de `${KAMAYUK_PUERTO_INGRESO:-8080}:80` y no se escribe `8080` aqui: el realm es un
 * archivo estatico que no lee el `.env`, asi que lo que tiene que declarar es exactamente esa
 * omision. Lanza si no la encuentra, en vez de suponer un puerto y comprobar contra el aire.
 */
export function puertoDelIngresoLocal(): string {
  const ruta = join(raizDelRepositorio(), "despliegue/plataforma.compose.yaml");
  const plataforma = load(readFileSync(ruta, "utf8")) as {
    services: Record<string, ServicioConPuertos>;
  };
  const candidatos = Object.entries(plataforma.services).filter(([, s]) =>
    /^traefik:/.test(s.image ?? ""),
  );
  if (candidatos.length !== 1) {
    throw new Error(
      `«${ruta}» tiene ${candidatos.length} servicios que parecen Traefik y hace falta ` +
        "exactamente uno: es el ingreso por el que se entra a las interfaces.",
    );
  }
  const [nombre, ingreso] = candidatos[0] as [string, ServicioConPuertos];
  for (const publicado of ingreso.ports ?? []) {
    const casa = /^\$\{[A-Z_]+:-(\d+)\}:/.exec(publicado);
    if (casa !== null) return casa[1] as string;
  }
  throw new Error(
    `El servicio «${nombre}» de «${ruta}» no publica ningun puerto con valor por omision ` +
      "(`${VARIABLE:-puerto}:...`), y de ahi sale el origen que el realm tiene que admitir.",
  );
}

/** Una interfaz servida por el ingreso local, con la direccion por la que se entra. */
export interface InterfazTrasElIngreso {
  sistema: string;
  /** El servicio del compose que la construye. */
  servicio: string;
  /** Su `PathPrefix`, tal como el compose lo reclama. */
  prefijo: string;
  /** La raiz de la aplicacion: lo que `@kamayuk/sesion` manda como `redirect_uri`. */
  retorno: string;
  /** El origen, que es lo que `webOrigins` tiene que admitir para el canje. */
  origen: string;
}

/**
 * Las interfaces que el ingreso local sirve, leidas de los composes de los clones.
 *
 * El servicio se reconoce por `build.target: interfaz` —el objetivo del `Dockerfile` que compila
 * el paquete y lo sirve—, y no por su nombre: los cinco lo llaman `<sistema>-interfaz` hoy, pero
 * el que decide que es una interfaz es el objetivo que construye.
 */
export function interfacesTrasElIngreso(puerto: string): InterfazTrasElIngreso[] {
  const encontradas: InterfazTrasElIngreso[] = [];
  for (const sistema of SISTEMAS_DEL_PRODUCTO) {
    const compose: ComposeDeSistema = composeDeSistema(sistema);
    const rutas = rutasDeTraefik(compose);
    for (const [servicio, definicion] of Object.entries(compose.services)) {
      if (definicion.build?.target !== "interfaz") continue;
      for (const ruta of rutas.filter((r) => r.servicio === servicio)) {
        for (const prefijo of ruta.prefijos) {
          const origen = `http://localhost:${puerto}`;
          encontradas.push({
            sistema,
            servicio,
            prefijo,
            // `@kamayuk/sesion` manda `window.location.origin + import.meta.env.BASE_URL`, y ese
            // `BASE_URL` es el `base: '/<sistema>/'` de su `vite.config.ts` — o sea el prefijo
            // del ingreso con su barra final.
            retorno: `${origen}${prefijo.endsWith("/") ? prefijo : `${prefijo}/`}`,
            origen,
          });
        }
      }
    }
  }
  return encontradas;
}

/**
 * Si una lista de redirecciones de Keycloak admite una URI.
 *
 * Reproduce lo que hace `RedirectUtils`: igualdad exacta, o un patron terminado en `*` cuyo
 * prefijo la URI lleva delante. **No** cubre los comodines en medio ni el `+` heredado, que este
 * realm no usa; si alguna vez los usa, esto se queda corto en la direccion segura —diria que no
 * admite algo que si admite— y el rojo lleva la lista entera para que se vea.
 */
export function admiteLaRedireccion(patrones: readonly string[], uri: string): boolean {
  return patrones.some((patron) => {
    if (patron === uri) return true;
    if (!patron.endsWith("*")) return false;
    return uri.startsWith(patron.slice(0, -1));
  });
}

interface ClienteDelRealm {
  clientId: string;
  redirectUris?: string[];
  webOrigins?: string[];
}

function backoffice(): ClienteDelRealm {
  const realm = JSON.parse(realmDeFuncionariosJson()) as { clients: ClienteDelRealm[] };
  const cliente = realm.clients.find((c) => c.clientId === CLIENTE_DEL_BACKOFFICE);
  if (cliente === undefined) {
    throw new Error(
      `«realm-kamayuk.json» no declara el cliente «${CLIENTE_DEL_BACKOFFICE}», que es por donde ` +
        "entran las interfaces de los funcionarios.",
    );
  }
  return cliente;
}

describe("#197 · la interfaz que sirve el ingreso local tiene su redireccion", () => {
  const puerto = puertoDelIngresoLocal();
  const interfaces = interfacesTrasElIngreso(puerto);

  it("hay interfaces que mirar, y se derivan de los composes", () => {
    // Si esto se queda en cero, lo de abajo pasaria en verde sin haber comprobado nada — que es
    // el modo de fallo que este repositorio lleva doscientos issues evitando.
    expect(interfaces.length).toBeGreaterThan(0);
    expect(new Set(interfaces.map((i) => i.sistema)).size).toBe(interfaces.length);
  });

  it.each(interfaces)(
    "«$sistema» vuelve del canje a $retorno",
    ({ sistema, servicio, retorno, origen }) => {
      const cliente = backoffice();
      const declaradas = cliente.redirectUris ?? [];
      expect(
        admiteLaRedireccion(declaradas, retorno),
        `«${sistema}» sirve su interfaz por el ingreso local en «${retorno}» —lo declara el ` +
          `servicio «${servicio}» de su compose con una etiqueta \`PathPrefix\` de Traefik—, y ` +
          `el cliente «${CLIENTE_DEL_BACKOFFICE}» de «despliegue/identidad/realm-kamayuk.json» ` +
          `no admite esa redireccion. Keycloak la rechaza ANTES de pedir credenciales, con un ` +
          `400 y «Invalid parameter: redirect_uri»: no se llega ni al formulario.\n` +
          `  Declaradas: ${declaradas.join(", ")}\n` +
          `  Remedio: anadir «${origen}/*» a \`redirectUris\` de ese cliente y regenerar el ` +
          `realm derivado con \`cd infra && yarn realm-del-compose\`. Del ORIGEN y no del ` +
          `camino: ver «Por que la entrada del realm es del ORIGEN» en esta guarda.`,
      ).toBe(true);
    },
  );

  it.each(interfaces)(
    "«$sistema» puede leer la respuesta del canje desde $origen",
    ({ sistema, origen }) => {
      const cliente = backoffice();
      const declarados = cliente.webOrigins ?? [];
      expect(
        declarados.includes(origen),
        `«${sistema}» entra por «${origen}» y el cliente «${CLIENTE_DEL_BACKOFFICE}» no declara ` +
          `ese origen en \`webOrigins\`. El canje NO falla: Keycloak contesta y omite la ` +
          `cabecera \`Access-Control-Allow-Origin\`, asi que el navegador tira la respuesta y ` +
          `la sesion se queda a medias — medido el 2026-09-16 contra el \`token_endpoint\`.\n` +
          `  Declarados: ${declarados.join(", ")}\n` +
          `  Remedio: anadir «${origen}» a \`webOrigins\` y regenerar el realm derivado.`,
      ).toBe(true);
    },
  );
});
