import { REGISTRO_PROPIO, publicadores } from "./imagenes-publicadas";
import { SISTEMAS_DEL_PRODUCTO } from "../componentes/convenciones";
import { podsDe, type Manifiesto } from "../componentes/tipos";
import { namespaceDelSistema } from "../descriptor/entorno";
import type { Environment } from "../config";
import { contenedoresQueNoSonElBackend } from "./procesos-de-un-sistema";
import {
  CONFIGURACION_DE_NGINX,
  nginxDelClon,
  nginxMontado,
  type FuenteDelNginx,
} from "./sondas-contra-la-cadena";

/**
 * Si el nginx de una interfaz puede resolver su propio reenvio en el clúster (#12).
 *
 * ## El defecto, medido y no razonado
 *
 * **nginx resuelve el anfitrion de un `proxy_pass` AL ARRANCAR**, no en la primera peticion. Lo
 * midio `hneyra/catastro#45` construyendo su imagen por primera vez: con el nombre sin resolver,
 * el contenedor sale con codigo 1 y esto en su registro
 *
 *     [emerg] host not found in upstream "catastro" in /etc/nginx/conf.d/default.conf:30
 *
 * Es decir: **el pod no arranca**, y el mensaje habla de nginx y no del manifiesto. Ni
 * `pulumi up` ni `yarn capacidad` ni la auditoria de `descriptor/auditoria.ts` lo predicen — el
 * manifiesto es valido, el API de Kubernetes lo admite y el planificador ubica el pod. Es la
 * misma familia que `D-23` con `ImagePullBackOff`, un escalon mas abajo: alli lo que falta es la
 * imagen, aqui lo que falta es un `Service` con el nombre que la imagen lleva dentro.
 *
 * ## Por que esto solo se puede ver desde `infrastructure`
 *
 * Porque hacen falta las dos mitades a la vez, y viven en repositorios distintos: el nombre del
 * upstream esta en el `frontend/nginx.conf` del sistema —o en el `ConfigMap` que su descriptor
 * monta— y los `Service` que existen los decide la composicion de este repositorio. Desde el clon
 * de un sistema se puede leer su `proxy_pass` y no se sabe como se va a llamar su `Service`;
 * desde aqui se sabe lo segundo. **Es exactamente el hueco de la frontera que `#12` nombra**: la
 * interfaz se publica y quien compone no la conoce.
 *
 * ## De donde sale el nginx: se DERIVA, no se declara
 *
 * De `nginxMontado`/`nginxDelClon` (`sondas-contra-la-cadena.ts`, `F` y `#30`): un `ConfigMap`
 * bajo {@link CONFIGURACION_DE_NGINX} es el servidor y gana; si no hay ninguno, el servidor viaja
 * dentro de la imagen y lo que se lee es el `frontend/nginx.conf` de su clon. **No se toma la
 * union de las dos**, por lo mismo que alli: lo que se despliega es una sola.
 *
 * Y por eso esta guarda contesta tambien el `AC-3` de `#12`: el archivo que se vigila es **el que
 * se despliega**, y cambiar el otro no la mueve.
 *
 * ## Lo que NO comprueba, dicho en vez de descubierto
 *
 *   - Que el `Service` tenga ENDPOINTS. Un `Service` sin pods detras resuelve —nginx arranca— y
 *     contesta 502. Eso es otra cosa y se ve en el clúster.
 *   - Que el PUERTO del reenvio sea uno que el `Service` publique. Nginx no lo resuelve al
 *     arrancar, asi que no impide el arranque; queda como censo en la prueba.
 *   - Un `resolver` declarado con reenvio por variable: eso lo resuelve nginx **en cada
 *     peticion** y no al arrancar, asi que ni siquiera es este defecto. {@link reenviosDe} lanza
 *     en vez de suponer.
 */

/** Un reenvio declarado en una configuracion de nginx, con lo que nginx va a resolver. */
export interface Reenvio {
  /** El anfitrion tal como nginx lo resuelve al arrancar. */
  anfitrion: string;
  /** El puerto, si la directiva lo declara. */
  puerto: string;
  /** La linea entera, para que el rojo enseñe lo que hay escrito y no una parafrasis. */
  linea: string;
}

/**
 * Los anfitriones que nginx NO resuelve por DNS y por tanto no son de esta comprobacion.
 *
 * Una direccion literal no se resuelve —nginx la usa tal cual— y `localhost` lo sirve el propio
 * pod. Se declaran en vez de filtrarse con una expresion regular ancha para que el dia que
 * alguien escriba un `proxy_pass` a una IP se vea aqui y no se cuele por parecido.
 */
const SIN_RESOLUCION = ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"];

/** Una linea de `nginx.conf` sin su comentario. */
function sinComentario(linea: string): string {
  const corte = linea.indexOf("#");
  return corte === -1 ? linea : linea.slice(0, corte);
}

/**
 * Los reenvios que una configuracion declara.
 *
 * Se lee linea a linea y **sin comentarios**, que es la leccion que este proyecto lleva anotada
 * tres veces —el `grep -c proxy_pass` de `caja#16`, los rotulos del panel de `catastro#10` y el
 * escaner que se cazo a si mismo de `caja#37`—: un archivo que EXPLICA por que no tiene reenvio
 * nombra la directiva, y contarlo dejaria la guarda roja sobre un archivo correcto.
 *
 * @throws si declara una forma que esta comprobacion no sabe leer. Se falla en vez de suponer,
 *   por lo mismo que {@link import("./sondas-contra-la-cadena").atiende} con las expresiones
 *   regulares: darla por buena dejaria de poder fallar nunca y darla por mala pondria rojo un
 *   archivo bien escrito.
 */
export function reenviosDe(configuracion: string, donde: string): Reenvio[] {
  const encontrados: Reenvio[] = [];

  for (const cruda of configuracion.split("\n")) {
    const linea = sinComentario(cruda);

    if (/^\s*upstream\s+/.test(linea)) {
      throw new Error(
        `«${donde}» declara un bloque \`upstream\`, y esta comprobacion no lo modela: un ` +
          "`upstream` agrupa varios `server` y el nombre del `proxy_pass` deja de ser el que " +
          "nginx resuelve.\n" +
          "  Se falla en vez de suponer: darlo por bueno dejaria de poder fallar nunca.",
      );
    }

    const casa = /^\s*proxy_pass\s+([^;]+);/.exec(linea);
    if (casa === null) continue;
    const destino = (casa[1] ?? "").trim();

    if (destino.includes("$")) {
      throw new Error(
        `«${donde}» declara \`proxy_pass ${destino}\`, con una variable dentro. Con variable ` +
          "nginx NO resuelve al arrancar sino en cada peticion, y necesita un `resolver`: es " +
          "otro defecto y otro sintoma.\n" +
          "  Se falla en vez de suponer, en las dos direcciones.",
      );
    }
    if (destino.startsWith("unix:")) {
      throw new Error(
        `«${donde}» declara \`proxy_pass ${destino}\`, un socket de dominio Unix. No hay ningun ` +
          "nombre que resolver y esta comprobacion no sabe decir si ese socket existe.",
      );
    }

    const url = /^https?:\/\/([^/\s:]+)(?::(\d+))?/.exec(destino);
    if (url === null) {
      throw new Error(
        `«${donde}» declara \`proxy_pass ${destino}\`, y esta comprobacion no sabe leer esa ` +
          "forma. Lo que sabe leer es `http(s)://<anfitrion>[:<puerto>][/ruta]`.",
      );
    }

    encontrados.push({
      anfitrion: url[1] ?? "",
      puerto: url[2] ?? "",
      linea: cruda.trim(),
    });
  }

  return encontrados;
}

/** Una interfaz: el nginx que la sirve y donde correria su pod. */
export interface InterfazDelProducto {
  sistema: string;
  /**
   * El nombre publicado de su imagen: `kamayuk-caja-interfaz`, `kamayuk-rentas-interfaz`.
   *
   * **No se deriva del sistema, y por eso es un campo.** Hasta `catastro`#104 los cinco no se
   * llamaban igual —`catastro` publicaba la suya como `kamayuk-catastro-web`, que ademas era el
   * nombre del `Service` de su BACKEND— y este modulo tuvo que leer el nombre en vez de
   * componerlo. Que hoy los cuatro acaben en `-interfaz` no es una regla que nadie haya escrito.
   */
  imagen: string;
  /** El espacio de nombres en el que resuelve —o resolveria— su `proxy_pass`. */
  namespace: string;
  /** De donde sale su configuracion de nginx. */
  fuente: FuenteDelNginx;
  /** Si algun manifiesto de este ambiente la despliega. */
  desplegada: boolean;
}

/** Los `Service` de cada espacio de nombres, por su nombre corto, que es como un pod los pide. */
export function serviciosPorNamespace(
  manifiestos: readonly Manifiesto[],
): Map<string, string[]> {
  const porNamespace = new Map<string, string[]>();
  for (const m of manifiestos) {
    if (m.kind !== "Service") continue;
    const namespace = m.metadata.namespace ?? "";
    const nombres = porNamespace.get(namespace) ?? [];
    nombres.push(m.metadata.name);
    porNamespace.set(namespace, nombres);
  }
  for (const nombres of porNamespace.values()) nombres.sort();
  return porNamespace;
}

/** Los `ConfigMap` de un espacio de nombres, por nombre, con sus datos. */
function configMapsDe(
  manifiestos: readonly Manifiesto[],
  namespace: string,
): Map<string, Record<string, string>> {
  return new Map(
    manifiestos
      .filter((m) => m.kind === "ConfigMap" && m.metadata.namespace === namespace)
      .map((m) => [m.metadata.name, (m as { data?: Record<string, string> }).data ?? {}]),
  );
}

/**
 * El nginx que sirve a una imagen de interfaz, con de donde sale.
 *
 * @throws si no sale de ningun sitio. «No se pudo comprobar» no puede leerse igual que «esta
 *   bien» (C-15/C-16).
 */
function nginxQueSirve(
  sistema: string,
  montajes: readonly { name: string; mountPath: string; subPath?: string }[],
  volumenes: readonly { name: string; configMap?: { name: string } }[],
  configMaps: ReadonlyMap<string, Record<string, string>>,
): FuenteDelNginx {
  const montado = nginxMontado(montajes, volumenes, configMaps);
  if (montado.length > 1) {
    throw new Error(
      `«${sistema}» monta ${montado.length} ConfigMap bajo «${CONFIGURACION_DE_NGINX}»: cual ` +
        "gana lo decide el orden de los montajes, y eso no se adivina.",
    );
  }
  const primero = montado[0];
  if (primero !== undefined) return primero;

  const delClon = nginxDelClon(sistema);
  if (delClon !== undefined) return delClon;

  throw new Error(
    `«${sistema}» corre una interfaz y su configuracion de nginx no sale de ningun sitio: ni ` +
      `monta un ConfigMap bajo «${CONFIGURACION_DE_NGINX}» ni su clon trae ` +
      `«${sistema}/frontend/nginx.conf».\n` +
      `  Remedio: git clone https://github.com/hneyra/${sistema}`,
  );
}

/**
 * Las interfaces de este ambiente: las que se despliegan y **las que se publican y no**.
 *
 * Las segundas cuentan a proposito, y es la mitad que `#12` existe para cerrar. Una imagen de
 * interfaz que ya se construye en cada merge y que su descriptor todavia no despliega **se va a
 * desplegar**; leerla ahora es lo que permite decir, antes del `up`, si arrancaria. Que el
 * defecto solo se pueda ver el dia del despliegue es justamente lo que hace caro este.
 */
export function interfacesDelProducto(
  ambiente: Environment,
  manifiestos: readonly Manifiesto[],
): InterfazDelProducto[] {
  const interfaces: InterfazDelProducto[] = [];
  const desplegadas = new Set<string>();

  for (const sistema of SISTEMAS_DEL_PRODUCTO) {
    const namespace = namespaceDelSistema(ambiente, sistema);
    const suyos = manifiestos.filter((m) => m.metadata.namespace === namespace);
    const configMaps = configMapsDe(manifiestos, namespace);

    for (const m of suyos) {
      for (const { pod } of podsDe(m)) {
        for (const c of contenedoresQueNoSonElBackend(sistema, pod)) {
          if (!c.image.startsWith(REGISTRO_PROPIO)) continue;
          const imagen = c.image.slice(REGISTRO_PROPIO.length).split(":")[0] ?? "";
          if (desplegadas.has(imagen)) continue;
          desplegadas.add(imagen);
          interfaces.push({
            sistema,
            imagen,
            namespace,
            fuente: nginxQueSirve(sistema, c.volumeMounts ?? [], pod.volumes ?? [], configMaps),
            desplegada: true,
          });
        }
      }
    }
  }

  for (const publicador of publicadores().hallados) {
    for (const imagen of publicador.imagenes) {
      // El jar del sistema no es una interfaz, y se descarta por la MISMA derivacion que usa
      // `procesos-de-un-sistema.ts`: un sistema publica su jar bajo dos nombres y todo lo demas
      // que publique es otro proceso.
      if (imagen === `kamayuk-${publicador.clon}`) continue;
      if (imagen === `kamayuk-${publicador.clon}-migrador`) continue;
      // Y lo que ya se despliega se sabe por los MANIFIESTOS y no por `descriptor.imagenes`.
      // No es lo mismo: `imagenes` es lo que el descriptor DECLARA, y un descriptor que declare
      // una imagen y deje de desplegarla se caeria por el hueco entre las dos listas —ni sale
      // como desplegada ni como huerfana—. Medido: con el `Deployment` de la interfaz de `caja`
      // retirado y su `imagenes` intacto, la version que leia `descriptor.imagenes` daba
      // «huerfanas: solo catastro» sobre un ambiente que ya no la desplegaba.
      if (desplegadas.has(imagen)) continue;
      const fuente = nginxDelClon(publicador.clon);
      // Una imagen huerfana que no sea una interfaz —un exportador, una herramienta— no tiene
      // `frontend/nginx.conf` y no es de esta comprobacion. Se salta por AUSENCIA DEL ARCHIVO y
      // no por su nombre: `caja` la llamaba «interfaz» y `catastro` la llamaba «web», dos nombres
      // para la misma cosa, y desde `catastro`#104 los cuatro la llaman igual — lo cual no vuelve
      // fiable el nombre, solo lo vuelve una coincidencia.
      if (fuente === undefined) continue;
      desplegadas.add(imagen);
      interfaces.push({
        sistema: publicador.clon,
        imagen,
        namespace: namespaceDelSistema(ambiente, publicador.clon),
        fuente,
        desplegada: false,
      });
    }
  }

  return interfaces.sort((a, b) => a.imagen.localeCompare(b.imagen));
}

/**
 * Los reenvios de una interfaz que **no resuelven** en su espacio de nombres.
 *
 * Puro y con los datos por parametro, como {@link import("./imagenes-publicadas").loQueNadiePublica}:
 * una interfaz inventada no exige tocar un descriptor ni un clon hermano.
 */
export function reenviosQueNoResuelven(
  interfaz: InterfazDelProducto,
  reenvios: readonly Reenvio[],
  servicios: readonly string[],
): string[] {
  const donde =
    interfaz.fuente.clase === "configmap"
      ? `el ConfigMap «${interfaz.fuente.nombre}»`
      : `«${interfaz.fuente.ruta}», que viaja DENTRO de la imagen`;

  return reenvios
    .filter((r) => !SIN_RESOLUCION.includes(r.anfitrion) && !servicios.includes(r.anfitrion))
    .map(
      (r) =>
        `«${interfaz.imagen}» reenvia a «${r.anfitrion}» y en «${interfaz.namespace}» no hay ` +
        `ningun Service con ese nombre.\n` +
        `  Lo declara ${donde}: \`${r.linea}\`\n` +
        `  Los Service que hay: ${servicios.join(", ") || "(ninguno)"}.\n` +
        "  nginx resuelve el anfitrion de un `proxy_pass` AL ARRANCAR, asi que el pod NO " +
        `arranca: \`[emerg] host not found in upstream "${r.anfitrion}"\`, y el mensaje habla ` +
        "de nginx y no del manifiesto. `pulumi up` sale en verde.\n" +
        `  Remedio, y son dos: llamar «${r.anfitrion}» al Service del backend, o montarle a ` +
        "esta interfaz un ConfigMap bajo `/etc/nginx/` que reescriba el `proxy_pass` con el " +
        "nombre que el clúster si tiene.",
    );
}
