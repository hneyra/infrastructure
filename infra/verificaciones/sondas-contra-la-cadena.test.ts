import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { construirManifiestos } from "../componentes";
import { SISTEMAS_DEL_PRODUCTO } from "../componentes/convenciones";
import { raizDelRepositorio } from "../componentes/fuentes";
import {
  contenedoresDe,
  podsDe,
  type Contenedor,
  type Manifiesto,
  type Sonda,
  type Volumen,
} from "../componentes/tipos";
import { correElBackend } from "./procesos-de-un-sistema";
import { manifiestosDeLosSistemas } from "../herramientas/emitir-manifiestos";
import {
  CONFIGURACION_DE_NGINX,
  atiende,
  fuenteDeLaCadena,
  locationsDe,
  nginxDelClon,
  nginxMontado,
  rutasPublicas,
  type FuenteDelNginx,
} from "./sondas-contra-la-cadena";
import { invariantesDe } from "./stacks";

/**
 * C-17 §2 — la ruta que la sonda pide es una que la cadena atiende sin token.
 *
 * El defecto medido, el motivo de que se lea el Java en vez de copiar una lista y por que fallar
 * es preferible a omitir estan en el javadoc de `sondas-contra-la-cadena.ts`. Lo que esta prueba
 * anade es el reparto y el contraste:
 *
 *   - los **cuatro** sistemas se miran desde aqui y no cada uno desde el suyo. Las dos mitades
 *     —la sonda del descriptor y la regla de la cadena— viven en el mismo clon, si, pero el
 *     defecto solo existe al COMPONER, y componer es de este repositorio; ademas las cuatro
 *     cadenas son la misma y una guarda repetida cuatro veces se corrige tres;
 *   - las muestras miden que la comprobacion MUERDE y que **no muerde de mas**. Sin el contraste
 *     en regla, una que rechazara toda cadena pasaria igual de verde.
 */

const AMBIENTE = "stg" as const;
const MUESTRAS = join(
  raizDelRepositorio(),
  "infra",
  "verificaciones",
  "muestras",
  "sondas-contra-la-cadena",
);

const muestra = (nombre: string) => readFileSync(join(MUESTRAS, nombre), "utf8");

/**
 * Las sondas HTTP de todo contenedor de un sistema, con el pod donde viven **y si ese
 * contenedor corre el jar**.
 *
 * Ese ultimo dato es lo que #16 obliga a tener: la interfaz de `caja` es nginx, y su sonda no
 * la atiende `SeguridadWeb` sino su propio `location`. Ver `procesos-de-un-sistema.ts`.
 */
interface SondaEncontrada {
  donde: string;
  cual: string;
  ruta: string;
  backend: boolean;
  c: Contenedor;
  /** Los volumenes del pod, que es lo unico que dice a que `ConfigMap` apunta un montaje. */
  volumenes: Volumen[];
}

function sondasDe(sistema: string): SondaEncontrada[] {
  const plataforma = construirManifiestos(invariantesDe(AMBIENTE));
  const suyos: Manifiesto[] = manifiestosDeLosSistemas(invariantesDe(AMBIENTE), plataforma).filter(
    (m) => m.metadata.namespace === `kamayuk-${sistema}-${AMBIENTE}`,
  );

  const encontradas: SondaEncontrada[] = [];
  for (const m of suyos) {
    for (const { contexto, pod } of podsDe(m)) {
      for (const c of contenedoresDe(pod)) {
        const sondas: [string, Sonda | undefined][] = [
          ["startupProbe", c.startupProbe],
          ["readinessProbe", c.readinessProbe],
          ["livenessProbe", c.livenessProbe],
        ];
        for (const [cual, sonda] of sondas) {
          const ruta = sonda?.httpGet?.path;
          if (ruta !== undefined) {
            encontradas.push({
              donde: `${contexto}, contenedor «${c.name}»`,
              cual,
              ruta,
              backend: correElBackend(sistema, c),
              c,
              volumenes: pod.volumes ?? [],
            });
          }
        }
      }
    }
  }
  return encontradas;
}

describe("C-17 §2 · toda sonda pide una ruta que la cadena de seguridad atiende sin token", () => {
  it.each(SISTEMAS_DEL_PRODUCTO)("«%s»", (sistema) => {
    const publicas = rutasPublicas(fuenteDeLaCadena(sistema), `${sistema}/SeguridadWeb.java`);
    // Solo los que corren el jar: `SeguridadWeb` es SU cadena, y medir con ella un
    // contenedor de nginx acusa al repositorio equivocado (#16).
    const sondas = sondasDe(sistema).filter((s) => s.backend);

    expect(
      sondas.length,
      `«${sistema}» no declara ninguna sonda HTTP. Un contenedor sin sondas pasa esta ` +
        "comprobacion sin haber comprobado nada, que es el modo de fallo de #188 con " +
        "`verificar-cuadros.mjs`.",
    ).toBeGreaterThan(0);

    const negadas = sondas.filter((s) => !publicas.includes(s.ruta));
    expect(
      negadas,
      negadas
        .map(
          (s) =>
            `  · ${s.donde}: ${s.cual} pide «${s.ruta}», y SeguridadWeb de «${sistema}» solo ` +
            `atiende sin token ${publicas.map((p) => `«${p}»`).join(", ")}.\n` +
            "    El pod arranca, conecta a la base y el kubelet lo mata: CrashLoopBackOff con la\n" +
            "    aplicacion sana. Remedio: o la sonda pide una ruta ya abierta, o la cadena la\n" +
            "    abre nombrandola —nunca con un comodin—.",
        )
        .join("\n"),
    ).toEqual([]);
  });

  /**
   * Y las dos rutas que se abrieron en C-17 se usan de verdad.
   *
   * Sin esto, alguien podria «arreglar» un rojo futuro devolviendo las tres sondas a
   * `/actuator/health` —que es lo que hace el monolito— y la comprobacion seguiria verde con la
   * distincion vida/preparacion perdida. Lo que se pierde con esa vuelta atras esta escrito en
   * `SeguridadWeb.SONDA_DE_VIDA`: una sonda de VIDA que incluya la base le pide al orquestador
   * que mate el proceso cuando la base no conteste, y matarlo no devuelve la base.
   */
  it.each(SISTEMAS_DEL_PRODUCTO)("«%s» distingue vida de preparacion", (sistema) => {
    // Tambien solo los del jar, y aqui importa mas que arriba: `new Map` se queda con la
    // ULTIMA, asi que con la interfaz dentro «readinessProbe» valdria «/» y esta prueba
    // mediria la sonda de nginx creyendo que mide la del backend.
    const porSonda = new Map(
      sondasDe(sistema)
        .filter((s) => s.backend)
        .map((s) => [s.cual, s.ruta]),
    );
    expect(porSonda.get("livenessProbe")).toBe("/actuator/health/liveness");
    expect(porSonda.get("readinessProbe")).toBe("/actuator/health/readiness");
    // El ARRANQUE si mira la base entera, y es lo que hace que un pod no se declare arrancado
    // hasta que llega a ella. Ver `SeguridadWeb.SONDA_DE_PREPARACION`.
    expect(porSonda.get("startupProbe")).toBe("/actuator/health");
  });
});

describe("la lectura de la cadena muerde, y no muerde de mas", () => {
  it("una cadena en regla publica las cuatro rutas que nombra", () => {
    expect(rutasPublicas(muestra("CadenaEnRegla.java.muestra"), "muestra")).toEqual([
      "/actuator/health",
      "/actuator/health/liveness",
      "/actuator/health/readiness",
      "/actuator/prometheus",
    ]);
  });

  it("la cadena anterior a C-17 no publica los dos grupos: es el defecto medido", () => {
    const publicas = rutasPublicas(muestra("CadenaQueNiegaLasSondas.java.muestra"), "muestra");
    expect(publicas).toEqual(["/actuator/health", "/actuator/prometheus"]);
    expect(publicas).not.toContain("/actuator/health/liveness");
  });

  it("un comodin se rechaza: con el, esta comprobacion no podria fallar nunca", () => {
    expect(() => rutasPublicas(muestra("CadenaConComodin.java.muestra"), "muestra")).toThrow(
      /comodin/,
    );
  });

  it("lo que no se resuelve a un literal falla, en vez de omitirse", () => {
    expect(() => rutasPublicas(muestra("CadenaQueNoSeEntiende.java.muestra"), "muestra")).toThrow(
      /no se puede resolver/,
    );
  });

  it("y una cadena sin ningun `permitAll()` tampoco pasa por buena", () => {
    expect(() => rutasPublicas("class Vacia {}", "muestra")).toThrow(/requestMatchers/);
  });
});

/**
 * Y **la otra mitad**: la sonda de un contenedor que NO corre el jar, contra lo que de verdad la
 * atiende.
 *
 * Sin esto, el arreglo de #16 seria el defecto de C-15/C-16 con otro nombre: separar los
 * contenedores por su imagen deja a la interfaz fuera de la cadena de Spring —correcto— y
 * **fuera de toda comprobacion** —que no lo es—. Una sonda que pide una ruta que nginx no sirve
 * mata el pod igual que una que `SeguridadWeb` no abre; lo unico que cambia es quien contesta.
 *
 * ## Quien la atiende se DERIVA del punto de montaje, y no se declara
 *
 * Hasta I-44 esto leia los `location` de cualquier `ConfigMap` del sistema, y daba por hecho que
 * la configuracion de nginx viaja en uno. Son **dos formas legitimas** y estan las dos:
 *
 *   - `caja` monta un `ConfigMap` en `/etc/nginx/conf.d/default.conf`: **ese** es su servidor;
 *   - `rentas` la lleva dentro de la imagen (#44), y su unico `ConfigMap` monta
 *     `configuracion.js` bajo `/usr/share/nginx/html/` — contenido servido, no servidor.
 *
 * Con la lectura vieja, `rentas` salia rojo con «ningun ConfigMap suyo declara un `location`»
 * sobre un sistema **bien construido**: la guarda acusaba al repositorio equivocado. La lista de
 * excepciones era la salida comoda y es la peor de las dos, porque una excepcion escrita a mano
 * envejece sola; lo que separa las dos formas es **donde monta**, y eso lo dice el manifiesto.
 *
 * Lo que NO se hace es la union de las dos fuentes: un `ConfigMap` de `caja` al que se le cayera
 * un `location` que su clon todavia tiene pasaria en verde, y lo que se despliega es el
 * `ConfigMap`.
 */
describe("#16 · la sonda de un contenedor que no es el backend, contra su nginx", () => {
  /** Los `ConfigMap` de un sistema, por nombre. */
  function configMapsDe(sistema: string): Map<string, Record<string, string>> {
    const plataforma = construirManifiestos(invariantesDe(AMBIENTE));
    return new Map(
      manifiestosDeLosSistemas(invariantesDe(AMBIENTE), plataforma)
        .filter(
          (m) => m.kind === "ConfigMap" && m.metadata.namespace === `kamayuk-${sistema}-${AMBIENTE}`,
        )
        .map((m) => [m.metadata.name, (m as { data?: Record<string, string> }).data ?? {}]),
    );
  }

  /**
   * La configuracion de nginx que sirve a ese contenedor, con de donde salio.
   *
   * @throws si no sale de ningun sitio: «no se pudo comprobar» no puede leerse igual que «esta
   *   bien», que es lo que C-15/C-16 dejaron escrito.
   */
  function nginxQueSirve(sistema: string, s: SondaEncontrada): FuenteDelNginx {
    const montado = nginxMontado(
      s.c.volumeMounts ?? [],
      s.volumenes,
      configMapsDe(sistema),
    );
    if (montado.length > 1) {
      throw new Error(
        `«${sistema}» monta ${montado.length} ConfigMap bajo «${CONFIGURACION_DE_NGINX}» en el ` +
          `contenedor «${s.c.name}» (${montado.map((f) => f.nombre).join(", ")}). Cual gana lo ` +
          "decide el orden de los montajes, y eso no se adivina: hay que decidir cual es la " +
          "configuracion en vez de dejar que esta comprobacion elija.",
      );
    }
    const primero = montado[0];
    if (primero !== undefined) return primero;

    const delClon = nginxDelClon(sistema);
    if (delClon !== undefined) return delClon;

    throw new Error(
      `«${sistema}» corre «${s.c.name}», que no es su backend, y su configuracion de nginx no ` +
        `sale de ningun sitio: ni monta un ConfigMap bajo «${CONFIGURACION_DE_NGINX}» ni su clon ` +
        `trae «${sistema}/frontend/nginx.conf». Sin ella nadie sabe quien atiende su sonda, y ` +
        "una comprobacion que no puede medir no pasa en verde: falla diciendolo.\n" +
        `  Remedio: git clone https://github.com/hneyra/${sistema}`,
    );
  }

  it.each(SISTEMAS_DEL_PRODUCTO)("«%s»", (sistema) => {
    const otras = sondasDe(sistema).filter((s) => !s.backend);
    if (otras.length === 0) return;

    for (const s of otras) {
      const fuente = nginxQueSirve(sistema, s);
      const donde =
        fuente.clase === "configmap"
          ? `el ConfigMap «${fuente.nombre}»`
          : `«${fuente.ruta}», que viaja DENTRO de la imagen`;
      const declarados = locationsDe(fuente.texto)
        .map((l) => `«${`${l.modificador} ${l.ruta}`.trim()}»`)
        .join(", ");
      expect(
        atiende(fuente.texto, s.ruta, `${sistema}: ${donde}`),
        `  · ${s.donde}: ${s.cual} pide «${s.ruta}», y el nginx de «${sistema}» —${donde}—\n` +
          `    solo declara ${declarados}.\n` +
          "    Es el mismo fallo que una ruta cerrada en `SeguridadWeb`, con otro servidor\n" +
          "    contestando: el kubelet mata el pod y la aplicacion esta sana.",
      ).toBe(true);
    }
  });

  /**
   * Y el censo, para que esto no pase en verde por lista vacia.
   *
   * Eran **uno** hasta I-44 —la interfaz de ventanilla de `caja` (#16)— y su propio comentario
   * decia «el dia que `rentas` estrene la suya, esta cifra sube y hay que mirarla». Subio. Lo que
   * ese comentario NO anticipo es que la de `rentas` llevaria su nginx **dentro de la imagen**, y
   * por eso el censo dice ahora tambien **de donde** sale la configuracion de cada una: si una
   * cambia de forma, esta cifra lo dice en vez de dejarlo pasar.
   *
   * **Y de dos pasan a CUATRO** con `normativa`#41 y `catastro`#104: los dos ultimos sistemas con
   * pantalla estrenan su despliegue, y los dos llevan su nginx **dentro de la imagen**, que es la
   * forma de `rentas` y no la de `caja`. Asi que lo que este censo vigila deja de ser un empate:
   * **tres de cuatro viajan en la imagen** y solo `caja` monta un `ConfigMap` encima. Los cinco
   * sistemas tienen ya su interfaz desplegada; el que no sale aqui es `identidad`, que no tiene
   * pantalla —sirve el buzon—, y por eso este censo no puede crecer mas sin que alguien estrene
   * un contenedor que no sea ni el backend ni una interfaz.
   */
  it("hoy hay exactamente cuatro, y cada una dice de donde sale su nginx", () => {
    const censo = SISTEMAS_DEL_PRODUCTO.flatMap((sistema) =>
      sondasDe(sistema)
        .filter((s) => !s.backend)
        .map((s) => {
          const fuente = nginxQueSirve(sistema, s);
          const imagen = s.c.image.split(":")[0]?.split("/").pop() ?? "";
          return `${sistema}: ${imagen} <- ${fuente.clase}`;
        }),
    );
    expect([...new Set(censo)].sort()).toEqual([
      "caja: kamayuk-caja-interfaz <- configmap",
      "catastro: kamayuk-catastro-interfaz <- imagen",
      "normativa: kamayuk-normativa-interfaz <- imagen",
      "rentas: kamayuk-rentas-interfaz <- imagen",
    ]);
  });

  /**
   * Y el contraste, que es lo que impide que lo de arriba se cumpla solo.
   *
   * Sin esto, una comprobacion que diera por atendida cualquier ruta pasaria igual de verde. Lo
   * que se mide aqui es que `atiende` sepa decir que NO, y que sepa leer un `location =` — que
   * es justo lo que la lectura vieja no sabia: `location = /index.html` se leia como «=».
   */
  describe("las muestras de `atiende`: que muerde, y que no muerde de mas", () => {
    /** Una configuracion se lee LINEA A LINEA, que es como esta escrito un `nginx.conf`. */
    const conf = (...lineas: string[]) => ["server {", ...lineas, "}"].join("\n");

    const CONF = conf(
      "    location / { try_files $uri /index.html; }",
      "    location /assets/ { expires 1y; }",
      "    location = /configuracion.js { add_header Cache-Control no-store; }",
    );

    it("lee la ruta de un `location =`, no su modificador", () => {
      expect(locationsDe(CONF)).toEqual([
        { modificador: "", ruta: "/" },
        { modificador: "", ruta: "/assets/" },
        { modificador: "=", ruta: "/configuracion.js" },
      ]);
    });

    it("un prefijo cubre lo que empieza por el, y `=` solo lo exacto", () => {
      expect(atiende(CONF, "/index.html", "muestra")).toBe(true);
      expect(atiende(CONF, "/assets/x.js", "muestra")).toBe(true);
      expect(atiende(CONF, "/configuracion.js", "muestra")).toBe(true);

      const exacta = conf("    location = /index.html { }");
      expect(atiende(exacta, "/index.html", "muestra")).toBe(true);
      expect(atiende(exacta, "/index.html/x", "muestra")).toBe(false);
    });

    it("una configuracion que no declara la ruta contesta que no", () => {
      expect(atiende(conf("    location /assets/ { }"), "/index.html", "muestra")).toBe(false);
    });

    it("una expresion regular lanza, en vez de darse por buena o por mala", () => {
      expect(() => atiende(conf("    location ~ \\.php$ { }"), "/x", "muestra")).toThrow(
        /no interpreta expresiones regulares/,
      );
    });
  });
});
