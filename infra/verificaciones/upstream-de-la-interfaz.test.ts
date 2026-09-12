import { describe, expect, it } from "vitest";
import { construirManifiestos } from "../componentes";
import { ENVIRONMENTS, type Environment } from "../config";
import { manifiestosDeLosSistemas } from "../herramientas/emitir-manifiestos";
import { invariantesDe } from "./stacks";
import {
  interfacesDelProducto,
  reenviosDe,
  reenviosQueNoResuelven,
  serviciosPorNamespace,
  type InterfazDelProducto,
} from "./upstream-de-la-interfaz";

/**
 * `#12` — la interfaz que se publica y este repositorio no conoce, medida por lo unico que
 * decide si su pod arranca: **si su `proxy_pass` resuelve**.
 *
 * El defecto, por que solo se ve desde aqui y lo que no comprueba estan en el javadoc del
 * modulo. Lo que estas pruebas anaden es el reparto:
 *
 *   - **las desplegadas son ROJO**: un reenvio que no resuelve es un pod que no levanta;
 *   - **las publicadas y no desplegadas son CENSO con su motivo**, que es lo que `C-2` decidio
 *     para las extensiones y `F` para las imagenes huerfanas: un rojo ahi naceria disparado el
 *     primer dia del trabajo de otro repositorio (#437). Lo que el censo NO hace es callarse:
 *     dice, con su nombre, que esa interfaz **no arrancaria tal como esta hoy**. **Hoy ese censo
 *     esta a cero** —la unica que lo poblaba, la de `catastro`, se arreglo y se desplego— y por
 *     eso las dos listas llevan delante cuantas interfaces se miraron: un cero sin sujeto se lee
 *     igual que un recorrido que dejo de encontrarlas.
 *
 * Y las muestras miden que `reenviosDe` muerde y que **no muerde de mas**: sin el contraste, una
 * lectura que no encontrara ningun reenvio pasaria igual de verde, que es exactamente el estado
 * en el que estaba esto antes de existir.
 */

/** Los manifiestos de un ambiente, plataforma y sistemas, como los compone `index.ts`. */
function manifiestosDe(ambiente: Environment) {
  const invariantes = invariantesDe(ambiente);
  const plataforma = construirManifiestos(invariantes);
  return [...plataforma, ...manifiestosDeLosSistemas(invariantes, plataforma)];
}

function conSusReenvios(ambiente: Environment) {
  const manifiestos = manifiestosDe(ambiente);
  const servicios = serviciosPorNamespace(manifiestos);
  return interfacesDelProducto(ambiente, manifiestos).map((interfaz) => ({
    interfaz,
    reenvios: reenviosDe(
      interfaz.fuente.texto,
      interfaz.fuente.clase === "configmap"
        ? `${interfaz.sistema}: ConfigMap «${interfaz.fuente.nombre}»`
        : interfaz.fuente.ruta,
    ),
    servicios: servicios.get(interfaz.namespace) ?? [],
  }));
}

describe("#12 · el reenvio de una interfaz DESPLEGADA resuelve en su espacio de nombres", () => {
  it.each(ENVIRONMENTS)("«%s»", (ambiente) => {
    const problemas = conSusReenvios(ambiente)
      .filter((i) => i.interfaz.desplegada)
      .flatMap((i) => reenviosQueNoResuelven(i.interfaz, i.reenvios, i.servicios));
    expect(problemas.join("\n")).toBe("");
  });

  /**
   * Y el censo que impide que ese verde signifique «no hay nada que mirar» sin decirlo.
   *
   * **Hoy la comprobacion de arriba se cumple sobre CERO reenvios**, y eso no es un defecto de
   * las cuatro interfaces desplegadas: las cuatro llegan a su backend por el INGRESO —dos
   * `IngressRoute` sobre el mismo anfitrion con `priority` explicita— y no por un reenvio de
   * nginx. Es una decision de diseno de `rentas`#44 y de `caja`#16, escrita en los dos y copiada
   * despues por `normativa`#41 y `catastro`#104.
   *
   * Lo que esta cifra vale es que el dia que una de las cuatro gane un `proxy_pass` —o entre una
   * quinta interfaz que lo traiga— esta linea cambia y hay que mirarla, en vez de que la
   * comprobacion de arriba siga en verde sobre el conjunto vacio.
   *
   * **De dos a cuatro, y la de `catastro` llega aqui por el camino largo**: era la unica que
   * traia un `proxy_pass` —`http://catastro:8080`, un nombre del `compose.yaml` que en el clúster
   * no existe— y es justamente lo que este modulo midio y dijo primero; `catastro`#104 se lo
   * quito antes de desplegarla. O sea que esta guarda no cambio de lado: la interfaz que contaba
   * como «publicada y no desplegada, y no arrancaria» pasa a contar como desplegada **porque el
   * defecto que se le anoto se arreglo**, y no porque nadie lo mirara.
   */
  it.each(ENVIRONMENTS)("y en «%s» se cuenta cuantas se miraron y cuantos reenvios", (ambiente) => {
    const desplegadas = conSusReenvios(ambiente).filter((i) => i.interfaz.desplegada);
    expect(desplegadas.map((i) => `${i.interfaz.imagen} <- ${i.interfaz.fuente.clase}`)).toEqual([
      "kamayuk-caja-interfaz <- configmap",
      "kamayuk-catastro-interfaz <- imagen",
      "kamayuk-normativa-interfaz <- imagen",
      "kamayuk-rentas-interfaz <- imagen",
    ]);
    expect(
      desplegadas.flatMap((i) => i.reenvios),
      "si esto deja de estar vacio, la comprobacion de arriba empieza a medir y hay que decirlo",
    ).toEqual([]);
  });
});

/**
 * La otra mitad, que es el issue entero — y **hoy esta a cero, con lo que ese cero costo escrito
 * al lado**.
 *
 * Durante meses el sujeto fue uno: `catastro` publicaba `kamayuk-catastro-web`, ningun descriptor
 * la desplegaba, y **tal como estaba NO habria arrancado**. `hneyra/catastro#45` la construyo y la
 * subio —las tres imagenes de `catastro` contestaban 200 a un token anonimo de `ghcr.io`, medido
 * el 2026-09-07 contra el `sha` que los dos stacks declaraban—, y su `frontend/nginx.conf` llevaba
 * dentro `proxy_pass http://catastro:8080`. En el clúster el `Service` de su backend se llama
 * `kamayuk-catastro-web`, asi que **no habia ningun `catastro` que resolver** y el pod se habria
 * quedado en `CrashLoopBackOff` con un `[emerg]` de nginx.
 *
 * Aquello se afirmo como censo y no como rojo por lo mismo que `F` decidio para la imagen
 * huerfana: publicar por delante es como se estrena una interfaz, `caja` y `rentas` pasaron por
 * ahi, y un rojo aqui habria puesto en rojo este repositorio por el trabajo en curso de otro. Lo
 * que el censo no hizo fue callarlo, y su propio comentario escribio la cita que hay que leer
 * ahora: «**el dia que `catastro` la despliegue, o el dia que arregle su `nginx.conf`, esta prueba
 * se pone roja y obliga a venir aqui a decir cual de las dos cosas paso**».
 *
 * **Paso: las dos.** `catastro`#104 le quito el `proxy_pass` —el reparto entre la API y la
 * interfaz lo hace el ingreso, que es el patron de `rentas`— y ademas la desplego, renombrada a
 * `kamayuk-catastro-interfaz`. Asi que este censo se vacia por la puerta buena: no porque nadie
 * publique ya una interfaz suelta, sino porque la unica que habia se arreglo antes de desplegarse.
 *
 * ## Y se queda, afirmando el conjunto vacio, en vez de retirarse
 *
 * Lo que esta comprobacion vigila no es «catastro»: es que una interfaz que se publica y todavia
 * no se despliega **se pueda leer antes del `up`**, que es la unica ventana en la que este defecto
 * se ve —el manifiesto es valido, `pulumi up` sale en verde y el pod no arranca—. Esa ventana se
 * vuelve a abrir con la siguiente interfaz que alguien estrene, y estrenarla publicando por
 * delante es como se hizo las cuatro veces. Retirarla ahora seria quitar la lectura justo cuando
 * se queda sin trabajo.
 *
 * Lo que cambia al pasar a cero es que hace falta un **sujeto**: una lista vacia tiene ahora dos
 * lecturas —«no queda ninguna publicada sin desplegar» y «el recorrido dejo de encontrar
 * interfaces»— y hasta hoy solo tenia una. Se cuenta por delante cuantas se miraron, que es
 * C-15/C-16. Y las aserciones que solo vivian aqui —el mensaje entero de
 * {@link reenviosQueNoResuelven}, con sus dos remedios dentro— **bajan a las muestras**, que es
 * donde tienen sujeto propio: una interfaz inventada no exige que ningun clon este roto.
 */
describe("#12 · lo que se publica y no se despliega, con su motivo", () => {
  it.each(ENVIRONMENTS)("«%s»: hoy no queda ninguna, y se dice sobre cuantas se miro", (ambiente) => {
    const todas = conSusReenvios(ambiente);

    // El sujeto. Sin esto, «ninguna sin desplegar» y «ninguna en absoluto» se leen igual.
    expect(
      todas.length,
      "el recorrido no encontro ni una interfaz: esta guarda no estaria midiendo nada",
    ).toBe(4);

    expect(
      todas.filter((i) => !i.interfaz.desplegada).map((i) => i.interfaz.imagen),
      "si esta lista deja de estar vacia es que alguien publica una interfaz que ningun " +
        "descriptor despliega, y hay que venir aqui a decir si arrancaria: nginx resuelve su " +
        "`proxy_pass` AL ARRANCAR y `pulumi up` sale en verde igual",
    ).toEqual([]);
    expect(ambiente).toMatch(/^(stg|prod)$/);
  });
});

describe("las muestras de `reenviosDe`: que muerde, y que no muerde de mas", () => {
  const conf = (...lineas: string[]) => ["server {", ...lineas, "}"].join("\n");

  it("lee el anfitrion y el puerto de un reenvio normal", () => {
    expect(reenviosDe(conf("  proxy_pass http://catastro:8080;"), "muestra")).toEqual([
      { anfitrion: "catastro", puerto: "8080", linea: "proxy_pass http://catastro:8080;" },
    ]);
  });

  it("y con ruta detras, y con https, sigue siendo el mismo anfitrion", () => {
    expect(
      reenviosDe(conf("  proxy_pass https://kamayuk-caja-web/caja/api/v1/;"), "m").map(
        (r) => r.anfitrion,
      ),
    ).toEqual(["kamayuk-caja-web"]);
  });

  /**
   * La leccion que este proyecto lleva anotada tres veces. Un `nginx.conf` que EXPLICA por que no
   * reenvia nombra la directiva, y contarla dejaria roja una guarda sobre un archivo correcto.
   */
  it("un `proxy_pass` dentro de un comentario NO es un reenvio", () => {
    expect(reenviosDe(conf("  # aqui no hay proxy_pass http://nadie:1;"), "m")).toEqual([]);
    expect(reenviosDe(conf("  proxy_pass http://si:1; # y este si"), "m")).toHaveLength(1);
  });

  it("una configuracion sin reenvios devuelve la lista vacia", () => {
    expect(reenviosDe(conf("  location / { try_files $uri /index.html; }"), "m")).toEqual([]);
  });

  /** Se falla en vez de suponer, en las dos direcciones. */
  it("un reenvio por variable LANZA, porque ese ya no se resuelve al arrancar", () => {
    expect(() => reenviosDe(conf("  proxy_pass http://$destino:8080;"), "m")).toThrow(
      /con una variable dentro/,
    );
  });

  it("un bloque `upstream` LANZA, porque el nombre deja de ser el que se resuelve", () => {
    expect(() => reenviosDe("upstream atras { server a:1; }", "m")).toThrow(/no lo modela/);
  });

  it("un socket unix LANZA: no hay nombre que resolver", () => {
    expect(() => reenviosDe(conf("  proxy_pass unix:/tmp/x.sock;"), "m")).toThrow(/Unix/);
  });
});

describe("las muestras de `reenviosQueNoResuelven`: el contraste", () => {
  const interfaz: InterfazDelProducto = {
    sistema: "catastro",
    imagen: "kamayuk-catastro-web",
    namespace: "kamayuk-catastro-stg",
    fuente: { clase: "imagen", ruta: "/x/frontend/nginx.conf", texto: "" },
    desplegada: true,
  };
  const reenvio = { anfitrion: "catastro", puerto: "8080", linea: "proxy_pass http://catastro:8080;" };

  it("con un Service que se llama igual, no hay problema", () => {
    expect(reenviosQueNoResuelven(interfaz, [reenvio], ["catastro"])).toEqual([]);
  });

  /**
   * El mensaje entero, que hasta `catastro`#104 lo afirmaba el censo de arriba sobre su clon.
   *
   * Bajo aqui cuando aquel censo se quedo sin sujeto, y gana con el cambio: la interfaz es
   * inventada, asi que lo que el rojo dice **no depende de que ningun clon hermano siga roto**.
   * Se afirma el sintoma —el `[emerg]` con el que nginx se niega a arrancar— y **los dos
   * remedios**, porque un rojo sin salida manda a alguien a inventarse una.
   */
  it("y sin el, se nombra el anfitrion, el sintoma, los Service que si hay y las dos salidas", () => {
    const problemas = reenviosQueNoResuelven(interfaz, [reenvio], ["kamayuk-catastro-web"]);
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("no hay ningun Service con ese nombre");
    expect(problemas[0]).toContain("Los Service que hay: kamayuk-catastro-web");
    expect(problemas[0]).toContain('host not found in upstream "catastro"');
    expect(problemas[0]).toContain("llamar «catastro» al Service del backend");
    expect(problemas[0]).toContain("montarle a esta interfaz un ConfigMap");
  });

  /**
   * `localhost` no lo resuelve el DNS del clúster: lo sirve el propio pod. Sin esta excepcion la
   * guarda pondria roja una interfaz que reenvia a un sidecar suyo, que es gritar en lo correcto.
   */
  it("`localhost` y las direcciones literales no se cuentan", () => {
    for (const anfitrion of ["localhost", "127.0.0.1"]) {
      expect(
        reenviosQueNoResuelven(interfaz, [{ ...reenvio, anfitrion }], []),
      ).toEqual([]);
    }
  });
});
