import { describe, expect, it } from "vitest";
import { CONTENEDOR_DE_ESPERA } from "../componentes/espera-al-motor";
import { ENVIRONMENTS } from "../config";
import {
  ARRANCA_COMO_ROOT_A_PROPOSITO,
  contenedoresDelAmbiente,
  IMAGEN_CON_USER_NUMERICO,
  sinEtiqueta,
  sinUidQueElKubeletPuedaVerificar,
  USER_POR_NOMBRE_PENDIENTE,
  usersDeLosClones,
} from "./usuario-de-los-contenedores";

/**
 * Quien corre cada contenedor. El porque —y lo que costo— esta en el modulo.
 */
describe("el UID de cada contenedor, sobre el ambiente ENTERO", () => {
  it.each(ENVIRONMENTS)("«%s»: el censo tiene sujeto", (ambiente) => {
    // Sin esto todo lo de abajo se cumple sobre el conjunto vacio: es C-15/C-16, y es exactamente
    // lo que le paso a esta guarda cuando miraba solo la plataforma.
    expect(
      contenedoresDelAmbiente(ambiente).length,
      "el ambiente no compone contenedores: esta guarda no estaria midiendo nada",
    ).toBeGreaterThan(40);
  });

  it.each(ENVIRONMENTS)("«%s»: ninguno corre como root, salvo los nombrados", (ambiente) => {
    const comoRoot = contenedoresDelAmbiente(ambiente).filter(
      (c) => c.nonRoot !== true && ARRANCA_COMO_ROOT_A_PROPOSITO[c.nombre] === undefined,
    );
    expect(
      comoRoot.map((c) => `${c.donde}/${c.nombre}`),
      "estos contenedores no declaran `runAsNonRoot` y no estan nombrados con su motivo en " +
        "`ARRANCA_COMO_ROOT_A_PROPOSITO`",
    ).toEqual([]);
  });

  /**
   * Y el que SI lo declara tiene que llevar un UID que el kubelet pueda verificar.
   *
   * Este es el rojo que el ambiente llevaba dias produciendo en el cluster y ninguna prueba veia,
   * porque la guarda leia `construirManifiestos` —la plataforma, 12 contenedores de 56—.
   */
  it.each(ENVIRONMENTS)("«%s»: `runAsNonRoot` con un UID que se pueda verificar", (ambiente) => {
    const sinUid = sinUidQueElKubeletPuedaVerificar(ambiente);
    expect(
      sinUid.map((c) => `${c.donde}/${c.nombre} <- ${c.imagen}`),
      "estos contenedores declaran `runAsNonRoot: true`, no fijan `runAsUser`, y su imagen no " +
        "esta en `IMAGEN_CON_USER_NUMERICO`:\n  " +
        sinUid.map((c) => `${c.donde}/${c.nombre} <- ${c.imagen}`).join("\n  ") +
        "\n  Quien contesta «¿esto es root?» pasa a ser la imagen, y si no declara un `USER` " +
        "NUMERICO el kubelet no puede comprobarlo sin ejecutarla: no crea el contenedor. " +
        "`CreateContainerConfigError`, «container has runAsNonRoot and image will run as root».\n" +
        "  Remedio, y son dos: fijarle un `runAsUser` numerico en su manifiesto, o —si su imagen " +
        "ya lo fija por numero— declararla aqui con el `USER` LEIDO de su Dockerfile.",
    ).toEqual([]);
  });

  /**
   * La afirmacion concreta del defecto que costo el ambiente: la espera corre con la imagen del
   * MOTOR, que este mismo repositorio declara que arranca como root.
   *
   * Es la contradiccion que el kubelet resolvio negandose: la misma imagen, declarada
   * «arranca como root» en un manifiesto y `runAsNonRoot` sin UID en otro.
   */
  it.each(ENVIRONMENTS)("«%s»: la espera al motor lleva su UID escrito", (ambiente) => {
    const contenedores = contenedoresDelAmbiente(ambiente);
    const esperas = contenedores.filter((c) => c.nombre === CONTENEDOR_DE_ESPERA);
    expect(
      esperas.length,
      "ningun pod del ambiente lleva la espera al motor (#44)",
    ).toBeGreaterThan(5);

    const imagenesDeRoot = new Set(
      contenedores
        .filter((c) => ARRANCA_COMO_ROOT_A_PROPOSITO[c.nombre] !== undefined)
        .map((c) => c.imagen),
    );
    // La espera usa a proposito la imagen del motor: es donde vive `pg_isready` y el nodo ya la
    // tiene bajada. Si dejara de ser asi, lo de abajo mediria otra cosa.
    expect(
      esperas.every((c) => imagenesDeRoot.has(c.imagen)),
      "la espera ya no corre con la imagen del motor: revisar por que esta guarda sigue aqui",
    ).toBe(true);

    const sinUid = esperas.filter((c) => c.uid === undefined);
    expect(
      sinUid.map((c) => c.donde),
      "la espera al motor corre con una imagen que este repositorio declara que ARRANCA COMO " +
        "ROOT —le omite `runAsNonRoot` al motor con su motivo escrito—, asi que esa imagen no " +
        "declara ningun `USER`: sin `runAsUser` el kubelet se niega a crear el contenedor y " +
        "NINGUN Job de migracion ni de implantacion de los cinco sistemas llega a arrancar. " +
        "Medido en «stg» el 2026-09-10: 395 intentos en 89 minutos, y la base de `identidad` sin " +
        "esquema porque su migracion nunca corrio.",
    ).toEqual([]);
  });

  /**
   * Y la otra direccion de la lista: una exencion que ya no exime a nadie sale roja.
   *
   * Una entrada que no nombra nada no protege nada, y sigue ahi para la imagen que herede ese
   * nombre. Es #27 aplicado a esta lista.
   */
  it("ninguna imagen declarada se ha quedado sin usar", () => {
    const usadas = new Set(
      ENVIRONMENTS.flatMap((a) => contenedoresDelAmbiente(a)).map((c) => sinEtiqueta(c.imagen)),
    );
    const sobran = Object.keys(IMAGEN_CON_USER_NUMERICO).filter((i) => !usadas.has(i));
    expect(
      sobran,
      "estas imagenes estan declaradas con su `USER` numerico y no las despliega ningun " +
        "ambiente:\n  " +
        sobran.join("\n  ") +
        "\n  La exencion no exime a nadie, y el dia que vuelva una imagen con ese nombre correra " +
        "sin que nadie lo haya decidido.",
    ).toEqual([]);
  });

  /**
   * Y el `USER` declarado se vuelve a LEER del clon, en vez de creerselo.
   *
   * «Cada exencion es un `USER` numerico leido, no una suposicion» lo decia la guarda anterior y
   * no lo comprobaba nadie: la cifra vivia en un comentario. Aqui se ejecuta.
   */
  it("el `USER` de cada imagen del producto se lee de su Dockerfile", () => {
    const users = usersDeLosClones();
    expect(
      users.length,
      "no se leyo ni un `USER` de los clones: esta guarda no midio nada",
    ).toBeGreaterThan(5);

    const desajustes: string[] = [];
    for (const [imagen, leido] of Object.entries(IMAGEN_CON_USER_NUMERICO)) {
      if (leido.dockerfile === undefined) continue;
      const { clon, ruta } = leido.dockerfile;
      const hay = users.filter((u) => u.clon === clon && u.ruta === ruta);
      if (hay.length === 0) {
        desajustes.push(`${imagen}: no se pudo leer ningun \`USER\` en ${clon}/${ruta}`);
      } else if (!hay.some((u) => u.valor === String(leido.uid))) {
        desajustes.push(
          `${imagen}: se declara \`USER ${leido.uid}\` y ${clon}/${ruta} declara ` +
            hay.map((u) => `«${u.valor}» (linea ${u.linea})`).join(", "),
        );
      }
    }
    expect(
      desajustes,
      "la cifra con la que estas imagenes quedan exentas ya no esta en su Dockerfile:\n  " +
        desajustes.join("\n  ") +
        "\n  Una exencion que ya no es cierta deja al kubelet decidiendo, y el kubelet dice que no.",
    ).toEqual([]);
  });

  /**
   * Y todo `USER` por NOMBRE de los cinco clones esta declarado, con su issue.
   *
   * `USER nginx` no lo puede verificar el kubelet. Hoy ninguno de estos se despliega; la lista es
   * la de trabajo pendiente, y se comprueba en las dos direcciones.
   */
  it("todo `USER` por nombre de los clones esta declarado, y ninguno declarado de mas", () => {
    const porNombre = usersDeLosClones().filter((u) => !/^\d+$/.test(u.valor));
    const clave = (u: { clon: string; ruta: string; valor: string }) =>
      `${u.clon} ${u.ruta} ${u.valor}`;

    const sinDeclarar = porNombre
      .map(clave)
      .filter((k) => USER_POR_NOMBRE_PENDIENTE[k] === undefined);
    expect(
      sinDeclarar,
      "estos `Dockerfile` fijan su usuario por NOMBRE:\n  " +
        sinDeclarar.join("\n  ") +
        "\n  El kubelet no puede comprobar que no sea root sin ejecutar la imagen: el dia que su " +
        "descriptor la despliegue con `runAsNonRoot` no creara el contenedor.",
    ).toEqual([]);

    const vistos = new Set(porNombre.map(clave));
    const yaArreglados = Object.keys(USER_POR_NOMBRE_PENDIENTE).filter((k) => !vistos.has(k));
    expect(
      yaArreglados,
      "estas entradas ya no corresponden a ningun `USER` por nombre:\n  " +
        yaArreglados.join("\n  ") +
        "\n  Se arreglaron, y una lista de trabajo pendiente tiene que decirlo.",
    ).toEqual([]);
  });

  it("`sinEtiqueta` no confunde el puerto del anfitrion con una etiqueta", () => {
    expect(sinEtiqueta("ghcr.io/hneyra/kamayuk-rentas:abc123")).toBe(
      "ghcr.io/hneyra/kamayuk-rentas",
    );
    expect(sinEtiqueta("registro.local:5000/kamayuk/x")).toBe("registro.local:5000/kamayuk/x");
    expect(sinEtiqueta("registro.local:5000/kamayuk/x:v1")).toBe("registro.local:5000/kamayuk/x");
  });
});
