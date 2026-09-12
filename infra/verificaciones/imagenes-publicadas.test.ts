import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ENVIRONMENTS, SISTEMAS_CON_IMAGEN, claveDeVersion } from "../config";
import { SISTEMAS } from "../descriptor/sistemas";
import { namespacesDelAmbiente } from "../descriptor/entorno";
import {
  cargasConImagenDelProducto,
  espaciosConCredencialDeRegistro,
  espaciosDeclaradosEn,
  etiquetasQueNoIdentifican,
  fuenteDeLosEspaciosConCredencial,
  podsSinCredencial,
  imagenesPedidas,
  imagenesQuePublica,
  loQueNadiePublica,
  publicadores,
  shaDeLaEtiqueta,
  type ImagenPedida,
} from "./imagenes-publicadas";

/**
 * D, bloqueo 1 — el manifiesto no puede pedir una etiqueta que nadie publica.
 *
 * Las cifras y el estado de partida estan en el docstring del modulo. Lo que estas pruebas
 * ejercitan es que la guarda **muerda**, y las mutaciones estan escritas como datos: la funcion
 * recibe la lista de imagenes y el inventario de publicadores, asi que una imagen inventada no
 * exige tocar un stack ni un clon hermano.
 */

const RAIZ_DEL_REPO = resolve(__dirname, "..", "..");

const UN_SHA = "0123456789abcdef0123456789abcdef01234567";

function imagen(nombre: string, etiqueta = UN_SHA): ImagenPedida {
  return { referencia: `ghcr.io/hneyra/${nombre}:${etiqueta}`, nombre, etiqueta };
}

describe("las imagenes que el ambiente pide las publica alguien", () => {
  it.each(ENVIRONMENTS)("«%s» no pide ninguna imagen sin publicador", (ambiente) => {
    expect(loQueNadiePublica(ambiente).join("\n")).toBe("");
  });

  it.each(ENVIRONMENTS)("«%s» pide las DIEZ de los cinco, y con etiqueta propia", (ambiente) => {
    const nombres = imagenesPedidas(ambiente).map((i) => i.nombre);
    // Eran las ocho del corte; `identidad` (ADR-0039) trae las suyas dos, con el mismo par
    // aplicacion/migrador y por el mismo motivo (C-14 §1).
    for (const sistema of ["rentas", "catastro", "normativa", "caja", "identidad"]) {
      expect(nombres, `falta la aplicacion de ${sistema}`).toContain(`kamayuk-${sistema}`);
      expect(nombres, `falta el migrador de ${sistema}`).toContain(`kamayuk-${sistema}-migrador`);
    }
  });

  /**
   * La rotura del criterio: el manifiesto pide algo que nadie construye. Es literalmente el
   * estado en que estaban las ocho antes de este trabajo.
   */
  it("una imagen que ningun flujo publica se nombra, con lo que si hay", () => {
    const problemas = loQueNadiePublica("stg", [imagen("kamayuk-fantasma")]);
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("NINGUN flujo de los clones hermanos publica «kamayuk-fantasma»");
    expect(problemas[0]).toContain("ImagePullBackOff");
    // Y dice quien SI publica algo, que es lo que convierte el rojo en un remedio.
    expect(problemas[0]).toContain("publicar-imagenes.yml");
  });

  it("un clon hermano que falta no se salta: se dice", () => {
    const problemas = loQueNadiePublica("stg", [], { hallados: [], sinClon: ["caja"] });
    expect(problemas[0]).toContain("No estan los clones de caja");
    expect(problemas[0]).toContain("NO se salta");
  });

  /**
   * El contraste. Sin el, una guarda que dijera «no publica nadie» siempre pasaria la prueba de
   * arriba y estaria diciendo que no a todo.
   */
  it("y con su publicador en el inventario, la misma imagen pasa", () => {
    const problemas = loQueNadiePublica("stg", [imagen("kamayuk-fantasma")], {
      hallados: [{ clon: "caja", flujo: "publicar-imagenes.yml", imagenes: ["kamayuk-fantasma"] }],
      sinClon: [],
    });
    expect(problemas).toEqual([]);
  });
});

describe("de un flujo se sacan las imagenes que empuja, no las que nombra", () => {
  const conMatriz = `
name: Publicar imágenes
jobs:
  publicar:
    strategy:
      matrix:
        include:
          - destino: aplicacion
            imagen: kamayuk-rentas
          - destino: migrador
            imagen: kamayuk-rentas-migrador
    steps:
      - uses: docker/build-push-action@v6
        with:
          push: true
          tags: ghcr.io/\${{ steps.registro.outputs.propietario }}/\${{ matrix.imagen }}:\${{ github.sha }}
`;

  it("la matriz se expande: dos entradas, dos imagenes", () => {
    expect(imagenesQuePublica(conMatriz)).toEqual(["kamayuk-rentas", "kamayuk-rentas-migrador"]);
  });

  /**
   * `push: false` es «construye y no subas». Contarlo como publicacion es la forma exacta en que
   * esta guarda dejaria de mirar sin decirlo: el flujo existe, el nombre esta escrito, y en el
   * registro no hay nada.
   */
  it("un paso que NO empuja no publica nada", () => {
    expect(imagenesQuePublica(conMatriz.replace("push: true", "push: false"))).toEqual([]);
  });

  /**
   * Y la otra direccion, que es la que fallo: `rentas`#75 cambio su `push` a una EXPRESION
   * —construir siempre, publicar solo al integrar— y con la comparacion estricta `rentas`
   * desaparecia del inventario entero. Se publica, y por eso cuenta.
   */
  it("un `push` que es una expresion de GitHub SI publica", () => {
    const conExpresion = conMatriz.replace(
      "push: true",
      "push: ${{ github.event_name == 'push' }}",
    );
    expect(imagenesQuePublica(conExpresion)).toEqual([
      "kamayuk-rentas",
      "kamayuk-rentas-migrador",
    ]);
  });

  it("un paso sin `push` no publica nada", () => {
    expect(imagenesQuePublica(conMatriz.replace("          push: true\n", ""))).toEqual([]);
  });

  it("un flujo sin ningun `build-push-action` no publica nada", () => {
    expect(imagenesQuePublica("name: Registro\njobs:\n  fila:\n    steps:\n      - uses: actions/checkout@v4\n")).toEqual([]);
  });

  /**
   * Los cinco clones publican de verdad sus dos imagenes. Esta prueba estaba ROJA
   * hasta el 2026-09-05: ninguno de los repositorios tenia un flujo que publicara nada.
   */
  it.each(["rentas", "catastro", "normativa", "caja", "identidad"])(
    "«%s» publica EXACTAMENTE las imagenes que su descriptor declara",
    (sistema) => {
      const suyos = publicadores().hallados.filter((p) => p.clon === sistema);
      // Las dos fuentes reales, comparadas: lo que el flujo EMPUJA y lo que el descriptor PIDE.
      // Era un par escrito aqui —`kamayuk-<sistema>` y `-migrador`—, y eso aguantaba solo
      // mientras cada sistema publicara dos; la interfaz de ventanilla de `caja` (#16) es una
      // tercera, y con la lista escrita a mano el rojo acusaba al clon de tener una imagen de
      // mas cuando lo que pasaba es que esta guarda no la conocia.
      //
      // Las dos direcciones NO pesan igual, y C-2 ya decidio esto para las extensiones:
      //
      //   - una imagen que el descriptor PIDE y nadie publica es ROJO. Es el
      //     `ImagePullBackOff` con el `up` en verde que D-23 existe para impedir, y el dano es
      //     inmediato;
      //   - una imagen que se PUBLICA y ningun descriptor despliega es **censo con su motivo**,
      //     no rojo. Hoy hay una, `kamayuk-catastro-interfaz`: su flujo la construye y su
      //     descriptor todavia no la usa, que es como se estrena una interfaz —`caja` paso por
      //     ahi—. Un rojo aqui naceria disparado el primer dia del trabajo de otro repositorio,
      //     y una comprobacion que grita el primer dia se silencia (#437, y C-2 con las cuatro
      //     extensiones de `normativa`).
      const declaradas =
        SISTEMAS.find((s) => s.descriptor.sistema === sistema)?.descriptor.imagenes ?? [];
      expect(declaradas, `«${sistema}» no declara ninguna imagen`).not.toEqual([]);
      const publicadas = suyos.flatMap((p) => p.imagenes);
      const sinPublicador = declaradas
        .map((i) => `kamayuk-${i}`)
        .filter((i) => !publicadas.includes(i));
      expect(
        sinPublicador,
        `el descriptor de «${sistema}» pide ${sinPublicador.join(", ")} y su flujo no la empuja: ` +
          "el manifiesto es valido, `pulumi up` sale en verde y el pod se queda en " +
          "ImagePullBackOff",
      ).toEqual([]);
    },
  );
});

describe("toda etiqueta identifica una revision", () => {
  it.each(ENVIRONMENTS)("«%s»", (ambiente) => {
    expect(etiquetasQueNoIdentifican(imagenesPedidas(ambiente)).join("\n")).toBe("");
  });

  it("una interfaz lleva el ambiente delante del sha, y aun asi identifica", () => {
    expect(shaDeLaEtiqueta(`prod-${UN_SHA}`)).toBe(UN_SHA);
      expect(
        etiquetasQueNoIdentifican([imagen("kamayuk-rentas-interfaz", `prod-${UN_SHA}`)]),
      ).toEqual([]);
  });

  it("una etiqueta movil se nombra", () => {
    const problemas = etiquetasQueNoIdentifican([imagen("kamayuk-rentas", "latest")]);
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("no identifica nada");
  });
});

describe("la lista de sistemas con version declarada es la de los descriptores", () => {
  /**
   * `config.ts` no puede importar `descriptor/sistemas.ts` —ese modulo importa los cuatro
   * descriptores hermanos, y `config.ts` lo lee todo el mundo—, asi que la lista esta escrita dos
   * veces. Lo que impide que se separen es esta prueba: un quinto sistema que se componga sin su
   * `versionDe<Sistema>` la pone roja **nombrandolo**, en vez de heredar en silencio la etiqueta
   * de otro o —peor— la del monolito.
   */
  it("los mismos cinco, y en el mismo conjunto", () => {
    expect([...SISTEMAS_CON_IMAGEN].sort()).toEqual(
      SISTEMAS.map(({ descriptor }) => descriptor.sistema).sort(),
    );
  });

  it("la clave de cada uno se compone igual que en el stack", () => {
    expect(SISTEMAS_CON_IMAGEN.map(claveDeVersion)).toEqual([
      "versionDeRentas",
      "versionDeCatastro",
      "versionDeNormativa",
      "versionDeCaja",
      // El quinto (ADR-0039), y esta prueba es lo que impide que se componga sin su clave: sin
      // ella `readInvariants` no se repliega a nada, lanza nombrandola, que es lo que se quiere.
      "versionDeIdentidad",
    ]);
  });
});

describe("quien puede traerse una imagen privada", () => {
  /**
   * Un `index.ts` de mentira con la forma buena, para poder romperla sin tocar el de verdad.
   *
   * Es la misma disciplina que `comun-verificaciones` aplica a sus reglas: una guarda que solo se
   * puede ejercitar contra el archivo bueno no se puede ejercitar contra uno defectuoso.
   */
  const BUENO = `
    for (const espacio of namespacesDelAmbiente(env)) {
      const secretoDeRegistro = new k8s.core.v1.Secret(
        resourceName(env, "registro-credenciales"),
        { metadata: { name: "x", namespace: espacio }, type: "kubernetes.io/dockerconfigjson" },
      );
      new k8s.core.v1.ServiceAccountPatch(
        resourceName(env, "default-registro"),
        { metadata: { name: "default", namespace: espacio }, imagePullSecrets: [{ name: "x" }] },
      );
    }
  `;

  it("la muestra en regla se lee, y la fuente sale entera", () => {
    // El parentesis de dentro es lo que rompio la primera version: cortando en el primer `)` la
    // expresion salia «namespacesDelAmbiente(env», que no es el nombre de ninguna funcion.
    expect(espaciosDeclaradosEn(BUENO)).toEqual(["namespacesDelAmbiente(env)"]);
  });

  /**
   * **Y la prosa que explica el mecanismo NO cuenta.** El javadoc de `index.ts` escribe
   * `imagePullSecrets`, `dockerconfigjson` y `namespacesDelAmbiente` para explicar por que estan;
   * una guarda que se satisface con el comentario que la justifica es la que alguien acaba
   * apagando borrando el comentario (#16 con `proxy_pass`, #10 con los rotulos del panel).
   */
  it("un comentario que nombra las tres cosas no basta", () => {
    const soloProsa = `
      // for (const espacio of namespacesDelAmbiente(env)) {
      //   new k8s.core.v1.Secret(..., { namespace: espacio }, "dockerconfigjson")
      //   new k8s.core.v1.ServiceAccountPatch(..., { namespace: espacio, imagePullSecrets: [] })
      // }
      /* Lo mismo en bloque: dockerconfigjson, imagePullSecrets, namespacesDelAmbiente(env). */
      const literal = "for (const espacio of namespacesDelAmbiente(env)) { imagePullSecrets }";
    `;
    expect(espaciosDeclaradosEn(soloProsa)).toEqual([]);
  });

  it("un `Secret` fuera del bucle no cuenta: el parche apuntaria a lo que no esta", () => {
    const soloElParche = BUENO.replace(/const secretoDeRegistro[\s\S]*?\);\n/, "");
    expect(espaciosDeclaradosEn(soloElParche)).toEqual([]);
  });

  it("y un `namespace` que no es el del bucle tampoco: escribiria seis veces en el mismo sitio", () => {
    expect(espaciosDeclaradosEn(BUENO.replace("namespace: espacio }, imagePullSecrets", "namespace: namespace }, imagePullSecrets"))).toEqual([]);
  });

  /**
   * La lectura sobre el `index.ts` de VERDAD. Lo que se afirma es de donde salen los espacios de
   * nombres, no cuales son: los cuales los da ejecutar esa misma funcion, un renglon mas abajo.
   *
   * Escribirlos aqui seria un segundo sitio con la misma verdad, y el que se queda viejo el dia
   * que entre un sexto sistema — que es exactamente el defecto que esta guarda vino a cerrar.
   */
  it("`index.ts` los saca de `namespacesDelAmbiente`, o sea de SISTEMAS_DEL_PRODUCTO", () => {
    expect(fuenteDeLosEspaciosConCredencial()).toBe("namespacesDelAmbiente(env)");
  });

  /**
   * Y una fuente que esta guarda no sepa ejecutar **lanza nombrandola**, en vez de colarse como
   * si fuera un espacio de nombres.
   *
   * Medido: con `index.ts` recorriendo `[...namespacesDelAmbiente(env), "kube-system"]`, la
   * primera version devolvia esa expresion **como si fuera un espacio de nombres** y la
   * comprobacion de «ni `kube-system` ni el ambiente hermano» pasaba en VERDE —porque el literal
   * va blanqueado y la cadena «kube-system» ni siquiera aparecia—. Pasaba por el motivo
   * equivocado, que es peor que fallar.
   */
  it("y una fuente que no sabe ejecutar lanza nombrandola", () => {
    const otra = BUENO.replace(
      "namespacesDelAmbiente(env)",
      "[...namespacesDelAmbiente(env), \"kube-system\"]",
    );
    expect(espaciosDeclaradosEn(otra)).toEqual(['[...namespacesDelAmbiente(env), "           "]']);
  });

  /**
   * Y la credencial llega a los SEIS espacios del ambiente: el de la plataforma y el de cada
   * sistema (ADR-0031).
   *
   * **Esto era «UNO, y es el de la plataforma»**, y con `identidad` dejo de ser sostenible:
   * medido el 2026-09-10 a las 02:14 UTC con un token ANONIMO de `ghcr.io/token`,
   * `kamayuk-identidad` y `kamayuk-identidad-migrador` contestan **403** con el `sha` que los dos
   * stacks declaran y con `latest`, mientras las nueve de los otros cuatro sistemas contestan
   * **200** y `kamayuk-rentas` con una etiqueta inexistente contesta **404**. Es el primer paquete
   * privado del producto, y sus tres cargas quedaban en `ImagePullBackOff` con el `up` en verde.
   *
   * Lo que cuesta queda dicho aqui y en `index.ts`: **la credencial de pull pasa a vivir en seis
   * espacios de nombres en vez de uno**, o sea seis sitios de donde puede salir en vez de uno. La
   * otra salida era publicar los dos paquetes, y no da lo que esta da: que el despliegue funcione
   * sea cual sea la visibilidad del paquete.
   */
  it.each(ENVIRONMENTS)("los SEIS espacios de «%s», derivados y no escritos", (ambiente) => {
    expect(espaciosConCredencialDeRegistro(ambiente)).toEqual(namespacesDelAmbiente(ambiente));
    expect(espaciosConCredencialDeRegistro(ambiente)).toEqual([
      `kamayuk-${ambiente}`,
      `kamayuk-rentas-${ambiente}`,
      `kamayuk-catastro-${ambiente}`,
      `kamayuk-normativa-${ambiente}`,
      `kamayuk-caja-${ambiente}`,
      `kamayuk-identidad-${ambiente}`,
    ]);
  });

  /**
   * **El contraste, y sin el la guarda se cumple ponisendosela a todo el mundo.**
   *
   * «Todos los espacios de nombres tienen credencial» es trivialmente cierto si la respuesta es
   * «todos los que existen». Lo que se afirma aqui es que la lista NO es universal: `kube-system`
   * —donde vive el `traefik` que este stack toca— se queda fuera, y el ambiente hermano tambien.
   * Un `for` sobre algo mas ancho pondria esto rojo.
   */
  it.each(ENVIRONMENTS)("y a nadie mas: ni `kube-system` ni el ambiente hermano, en «%s»", (ambiente) => {
    const otro = ENVIRONMENTS.find((a) => a !== ambiente)!;
    const espacios = espaciosConCredencialDeRegistro(ambiente);
    expect(espacios).not.toContain("kube-system");
    expect(espacios.filter((e) => e.endsWith(`-${otro}`))).toEqual([]);
    // Y que el contraste tenga sujeto: el ambiente hermano compone espacios de verdad.
    expect(namespacesDelAmbiente(otro).length).toBeGreaterThan(0);
  });

  /**
   * El censo, que es el SUJETO de la afirmacion de abajo.
   *
   * Todo lo que este bloque dice sobre la credencial es cierto sobre el conjunto vacio: si el
   * recorrido dejara de encontrar cargas —un `kind` que se deja de reconocer, un manifiesto que
   * cambia de forma—, «ninguna se queda sin credencial» seguiria pasando en verde y nadie lo
   * diria. Es C-15/C-16, y por eso la cifra se cuenta antes.
   *
   * VEINTICINCO: **nueve** `Deployment`, diez `Job` y seis `CronJob`, y las **veinticinco** viven
   * fuera del espacio de nombres de la plataforma —donde desde `E` no queda ninguna imagen del
   * producto—. Las tres que suma `identidad` (ADR-0039) son su `Deployment` web y sus dos `Job`.
   *
   * **Eran VEINTITRES hasta que `normativa` y `catastro` estrenaron su interfaz** (`normativa`#41,
   * `catastro`#104): los dos `Deployment` que suman son los dos ultimos que faltaban, asi que
   * desde hoy los CINCO sistemas despliegan su pantalla y `identidad` sigue sin ninguna —sirve el
   * buzon y no tiene interfaz—. Los `Job` y los `CronJob` no se mueven.
   *
   * **Eran DIECINUEVE hasta la etapa 4** (`identidad`#4): los cuatro que suma son los cuatro
   * `CronJob/kamayuk-<sistema>-consumidor-de-identidad`, uno por satelite, cada uno con la MISMA
   * imagen que su aplicacion en perfil `batch` (ADR-0003: un artefacto, dos perfiles). **No traen
   * una imagen nueva —este censo cuenta CARGAS, no imagenes—**, y `identidad` sigue en tres:
   * sirve el buzon y no tiene ningun `CronJob`.
   *
   * **Y la cifra de la etapa 4 vive AQUI y no en la afirmacion de abajo, que es lo que cambia al
   * traer `57771a2`.** Hasta entonces el censo y el hueco eran el mismo numero —las cargas del
   * producto viven todas fuera del espacio de la plataforma, que era el unico que llevaba
   * credencial, asi que «cuantas hay» y «cuantas no la tienen» daban lo mismo—, y por eso la
   * etapa 4 subio a 23 lo unico que habia entonces: `podsSinCredencial`. Con la credencial en los
   * seis espacios ese hueco es **cero POR DERIVACION** y deja de poder llevar un censo dentro; lo
   * que sigue teniendo que crecer con cada carga es esto, que es el sujeto. Medido despues del
   * merge y no deducido —la cifra a cero y el «but was» leido—: `expected [ … ] to have a length
   * of +0 but got 23`, en los dos ambientes, y las veintitres con `credencial: true`.
   *
   * Esta cifra se toca a mano y con su motivo, como manda su antecesora: cada carga nueva pasa
   * por aqui.
   */
  it.each(ENVIRONMENTS)("las VEINTICINCO cargas que traen una imagen del producto, en «%s»", (ambiente) => {
    const todas = cargasConImagenDelProducto(ambiente);
    expect(todas).toHaveLength(25);
    expect([...new Set(todas.map((p) => p.espacio))].sort()).toEqual([
      `kamayuk-caja-${ambiente}`,
      `kamayuk-catastro-${ambiente}`,
      `kamayuk-identidad-${ambiente}`,
      `kamayuk-normativa-${ambiente}`,
      `kamayuk-rentas-${ambiente}`,
    ]);
  });

  /**
   * Y ninguna se queda sin poder bajarla.
   *
   * Eran **TODAS** —el parche llegaba solo al espacio de la plataforma y ninguna carga del
   * producto vive alli, asi que este hueco era el censo entero: diecinueve antes de la etapa 4 y
   * veintitres con ella—, y son **cero** desde que `index.ts` la crea en los seis espacios. La
   * cifra no se ajusto para que pasara: lo que cambio es el despliegue, y el censo de arriba es
   * lo que impide que este cero signifique «no se miro nada».
   *
   * Por eso aqui no hay numero y arriba si: este cero lo dice la DERIVACION —la credencial llega
   * a `namespacesDelAmbiente(env)`, o sea a los seis—, y una carga nueva no lo mueve; el censo,
   * en cambio, tiene que moverse con cada carga o deja de ser sujeto de nada.
   */
  it.each(ENVIRONMENTS)("y NINGUNA se queda sin credencial, en «%s»", (ambiente) => {
    expect(podsSinCredencial(ambiente)).toEqual([]);
  });
});

/**
 * Y la mitad de shell, que es donde estaba escrita la regla vieja.
 *
 * `comprobar-imagenes.sh` decide si un pod puede bajarse una imagen privada, y para eso necesita
 * saber que espacios de nombres llevan la credencial. Lo tenia escrito a mano —`espacio ==
 * "kamayuk-<ambiente>"`—, que era cierto mientras la credencial llegaba a un solo sitio y es falso
 * desde que llega a los seis. Ahora **pregunta**, y quien contesta es la misma derivacion.
 *
 * Es la forma de `infra/bases.sh` (#15/#16): dos lenguajes, una sola fuente, y ningun sitio donde
 * puedan discrepar en silencio. Y se comprueba **ejecutando**, no leyendo (M10 de C-19): una
 * prueba que solo mirara que el guion nombra la herramienta pasaria igual con la herramienta rota.
 */
describe("el guion del registro pregunta en vez de saberselo", () => {
  const GUION = join(RAIZ_DEL_REPO, "infra", "verificaciones", "imagenes", "comprobar-imagenes.sh");

  it("no lleva ninguna regla de pertenencia escrita a mano", () => {
    const texto = readFileSync(GUION, "utf8");
    // La forma exacta que tenia, y la familia entera: comparar el espacio de nombres del pod
    // contra el de la plataforma compuesto en el propio guion.
    expect(texto).not.toMatch(/espacio\s*==\s*plataforma/);
    expect(texto).not.toMatch(/plataforma\s*=\s*"kamayuk-"/);
    expect(texto).toContain('yarn --silent espacios-con-credencial --ambiente "$AMBIENTE"');
    // Y que lo que pregunta llegue de verdad a la decision, no que se quede en una variable
    // muerta: es lo que #10 midio con el `selector` declarado y nunca consultado.
    expect(texto).toContain("espacio in con_credencial");
    expect(texto).toContain('con_credencial = set(a for a in sys.argv[2].split("\\n") if a)');
  });

  /**
   * Ejecutado de verdad, con `--ambiente stg`. Cuesta ~1,3 s porque levanta `vite-node`, asi que
   * lleva su propio techo: el de 5 s de Vitest es para funciones puras.
   */
  it(
    "y lo que imprime es exactamente lo que la guarda deriva",
    () => {
      const salida = execFileSync("yarn", ["--silent", "espacios-con-credencial", "--ambiente", "stg"], {
        cwd: join(RAIZ_DEL_REPO, "infra"),
        encoding: "utf8",
      });
      const impresos = salida.split("\n").filter((l) => l.trim() !== "");
      expect(impresos).toEqual(espaciosConCredencialDeRegistro("stg"));
      // Con sujeto: una salida vacia haria pasar la igualdad de arriba si la guarda tambien lo
      // estuviera, y el guion daria por bueno que ningun pod tiene credencial.
      expect(impresos.length).toBeGreaterThan(1);
    },
    20_000,
  );
});

/**
 * Y la otra direccion, **como censo y no como rojo** (C-2, y #437).
 *
 * Una imagen que se publica y ningun descriptor despliega no rompe nada hoy: envejece. Pero que
 * no rompa no quiere decir que no haya que verla —es una imagen que alguien construye en cada
 * merge, con su coste y su superficie— asi que se cuenta, con su nombre, y cambiarla obliga a
 * tocar esta linea y decir por que.
 *
 * ## Este censo lee lo DECLARADO, y hay una segunda lectura que lee lo DESPLEGADO (#12)
 *
 * Aqui «desplegada» significa «esta en `descriptor.imagenes`», que es lo que el descriptor
 * DECLARA. `verificaciones/upstream-de-la-interfaz.ts` hace la otra lectura —lo que los
 * MANIFIESTOS piden— y **no son la misma**: una imagen declarada que ningun `Deployment` use se
 * cae por el hueco entre las dos y no sale ni como desplegada ni como huerfana.
 *
 * Medido en su dia, retirando el `Deployment` de la interfaz de `caja` de su descriptor y dejando
 * su `imagenes` intacto: este censo seguia diciendo «solo `kamayuk-catastro-web`» sobre un
 * ambiente que ya no desplegaba la de `caja`; el censo del otro modulo la nombraba. Se deja asi a
 * proposito —cada uno contesta una pregunta distinta y las dos hacen falta— y queda escrito para
 * que el dia que las dos discrepen se sepa cual es cual. **Las dos estan hoy a cero**, y las dos
 * lo afirman con su sujeto delante: llegaron ahi por caminos distintos y por eso ninguna se
 * retira.
 */
describe("lo que se publica y nadie despliega, contado", () => {
  /**
   * **Hoy no hay ninguna, y esta guarda se queda afirmando el conjunto vacio.**
   *
   * Durante meses el sujeto fue `kamayuk-catastro-web`: una imagen de interfaz que se construia
   * en cada merge y que ningun descriptor declaraba. `catastro`#104 la cierra por los dos lados a
   * la vez —la renombra a `kamayuk-catastro-interfaz` y la despliega—, y `normativa`#41 estrena
   * la suya ya declarada, asi que la lista se vacia.
   *
   * **Y se decide dejarla, no retirarla.** Lo que esta comprobacion vigila no es «catastro»: es
   * el hueco entre lo que un clon PUBLICA y lo que su descriptor DECLARA, y ese hueco se vuelve a
   * abrir el dia que cualquiera de los cinco anada una entrada a su `publicar-imagenes.yml` sin
   * tocar su descriptor — que es exactamente como nacio el anterior. Retirarla ahora seria quitar
   * la comprobacion justo cuando deja de tener trabajo, y volver a descubrir el mismo hallazgo la
   * proxima vez.
   *
   * Lo que si hace falta al pasar a cero es un **sujeto**, porque una lista vacia tiene ahora dos
   * lecturas y hasta hoy solo tenia una: «no hay ninguna huerfana» y «no se leyo ningun
   * publicador». Es C-15/C-16, y por eso se cuenta antes lo que se miro.
   *
   * El nombre de la imagen tampoco era un detalle y conviene no perderlo: `caja` llamaba
   * «interfaz» a lo mismo que `catastro` llamaba «web», dos nombres para la misma cosa a los dos
   * lados de la frontera. Quien los lee desde aqui —esta guarda, `procesos-de-un-sistema.ts`— no
   * puede apoyarse en ninguno de los dos: por eso la pregunta es «¿corre el jar?» y no «¿se llama
   * interfaz?». Desde `catastro`#104 los cinco la llaman «interfaz», y **la derivacion no cambia**
   * a cuenta de eso: que hoy coincidan no es una regla que nadie haya escrito.
   */
  it("hoy no queda ninguna, y se dice sobre cuantas se miro", () => {
    const delProducto = publicadores().hallados.filter((p) =>
      SISTEMAS.some((s) => s.descriptor.sistema === p.clon),
    );

    // El sujeto: los cinco clones, con sus imagenes. Sin esto el `[]` de abajo pasaria igual de
    // verde con `publicar-imagenes.yml` ilegible en los cinco.
    expect(
      delProducto.map((p) => p.clon).sort(),
      "no se leyo el publicador de los cinco sistemas: esta guarda no estaria midiendo nada",
    ).toEqual(["caja", "catastro", "identidad", "normativa", "rentas"]);
    expect(delProducto.flatMap((p) => p.imagenes).length).toBe(14);

    const huerfanas = delProducto
      .flatMap((p) => {
        const declaradas =
          SISTEMAS.find((s) => s.descriptor.sistema === p.clon)?.descriptor.imagenes ?? [];
        const pedidas = declaradas.map((i) => `kamayuk-${i}`);
        return p.imagenes.filter((i) => !pedidas.includes(i));
      })
      .sort();

    expect(
      [...new Set(huerfanas)],
      "una imagen que se publica en cada merge y que ningun descriptor declara envejece sin que " +
        "nadie la vea: se cuenta aqui, con su nombre, y crecer esta lista obliga a decir por que",
    ).toEqual([]);
  });
});
