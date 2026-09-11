import { describe, expect, it } from "vitest";
import { construirManifiestos } from "../componentes";
import { documentosDelRealm } from "../componentes/Identidad";
import { reconciliarRealmSh } from "../componentes/fuentes";
import { ENVIRONMENTS, resourceName, type Environment } from "../config";
import { invariantesDe } from "./stacks";

/**
 * `#63` — un ambito anadido despues del primer arranque no llegaba a un realm que ya existe.
 *
 * `kcadm update realms/<realm> -f realm.json` actualiza los ajustes y **no importa los
 * `clientScopes`**: esos entran solo al CREAR el realm. Medido en `stg` el 2026-09-10, el `Job`
 * de identidad imprimio «El realm ya existe: se actualizan sus ajustes.» y murio despues en
 * «FALLO: el realm «sgtm» no tiene el ambito «kamayuk-servicio»» —el que #21 anadio al archivo
 * versionado—, llevandose por delante los tres modos que van detras, encadenados con `&&`.
 *
 * Es el mismo agujero por el que este guion existe (#151): «`--import-realm` solo importa la
 * PRIMERA vez», un escalon mas abajo.
 *
 * Los ambitos salen del archivo versionado a documentos SUELTOS porque el guion no puede
 * analizar JSON: la imagen de Keycloak no trae `jq` ni `python` (#21). El nombre del ambito sale
 * del NOMBRE DEL ARCHIVO, y por eso las dos mitades —quien emite las claves y quien las
 * recorre— tienen que decir lo mismo, que es lo que se comprueba aqui.
 */
const PREFIJOS = ["ambito--", "ambito-ciudadano--"] as const;

function configuracionDelRealm(ambiente: Environment): Record<string, string> {
  const nombre = resourceName(ambiente, "realm");
  const encontrado = construirManifiestos(invariantesDe(ambiente)).find(
    (m) => m.kind === "ConfigMap" && m.metadata.name === nombre,
  );
  expect(encontrado, `el ambiente no compone el ConfigMap «${nombre}»`).toBeDefined();
  return (encontrado as { data: Record<string, string> }).data;
}

describe("#63 · los ambitos del realm llegan tambien cuando el realm ya existe", () => {
  it("el realm versionado declara al menos un ambito", () => {
    // El centinela: sin sujeto, todo lo de abajo se cumpliria sobre el conjunto vacio — que es
    // ademas el estado que este issue existe para que no vuelva a pasar desapercibido.
    const documentos = documentosDelRealm({
      domain: "d.example",
      realm: "kamayuk",
      clienteDeVerificacion: true,
    });
    expect(
      documentos.ambitos.map((a) => a.nombre),
      "el realm versionado ya no declara ningun `clientScope`: esta guarda se quedaria sin sujeto",
    ).toContain("kamayuk-servicio");
    expect(
      documentos.ambitos.flatMap((a) => a.mapeadores.map((m) => m.nombre)),
      "el ambito de servicio sin mapeador emite tokens validos y SIN `municipalidad_id` (#21)",
    ).not.toEqual([]);
  });

  /**
   * ## Lo que esta prueba afirmaba, por que era razonable, y por que era el defecto
   *
   * Hasta #72 afirmaba lo contrario de lo que afirma ahora: que `realm.json` **conservara** sus
   * ambitos, «que es el camino del `create`», con este motivo escrito al lado:
   *
   * > «Los dos caminos hacen falta: el `create` importa los ambitos del archivo, y el `update`
   * > no. Quitarlos de ahi arreglaria el ambiente que existe y romperia el que nazca manana.»
   *
   * La primera frase es cierta. **La segunda es falsa, y su precio se midio en `stg` el
   * 2026-09-11**: declarar `clientScopes` en el documento que `--import-realm` consume
   * **SUSTITUYE** el juego de fabrica de Keycloak en vez de anadirse a el. Contando los
   * `client_scope` de cada realm en la propia base de Keycloak:
   *
   * ```
   * kamayuk            ->  2 ambitos     <- el UNICO que los declaraba
   * kamayuk-ciudadano  -> 13
   * master             -> 13
   * sgtm               -> 13
   * sgtm-ciudadano     -> 13
   * ```
   *
   * Sin `profile` no hay `preferred_username` y sin `basic` no hay `sub`. Medido sobre el token
   * de verdad de `kamayuk-rentas-servicio-200105`, pedido desde dentro del clúster:
   * `preferred_username: None`, `scope: kamayuk-servicio`. O sea que el ambiente que «nacia
   * manana» nacia roto para TODO funcionario y para las cuatro cuentas de servicio.
   *
   * ## Y por que quitarlos NO rompe el realm que nazca
   *
   * Porque el bucle que aplica los documentos sueltos **no depende de que el realm se acabe de
   * crear**: vive DESPUES del `fi` de crear/actualizar, asi que corre en los dos caminos. Eso
   * es lo que esta prueba afirma ahora, y lo lee del guion en vez de suponerlo — que es
   * justamente lo que la version anterior no hacia.
   */
  it("el bucle que aplica los ambitos sueltos es INCONDICIONAL, no solo del `update`", () => {
    // Por el mismo accesor que el resto del archivo, y no con un `readFileSync` propio: dos
    // formas de leer el mismo guion son dos que se pueden separar.
    const lineas = reconciliarRealmSh().split("\n");
    const crea = lineas.findIndex((l) => /create realms -f/.test(l));
    const cierra = lineas.findIndex((l, i) => i > crea && /^fi$/.test(l));
    const bucle = lineas.findIndex((l) => /^for ARCHIVO_AMBITO in /.test(l));

    expect(crea, "el guion ya no hace `create realms -f`: ¿cambio de forma?").toBeGreaterThan(-1);
    expect(cierra, "no se encuentra el `fi` que cierra crear/actualizar").toBeGreaterThan(crea);
    expect(
      bucle,
      "el guion ya no recorre los documentos de ambito con un glob: si tampoco estan dentro " +
        "del realm importado, `kamayuk-servicio` no llega a ningun sitio",
    ).toBeGreaterThan(-1);
    expect(
      bucle,
      "el bucle de los ambitos quedo DENTRO del `if` de crear/actualizar. Fuera de uno de los " +
        "dos caminos, el ambito no llega: y como desde #72 ya no viaja dentro del realm " +
        "importado —eso borraba los trece de fabrica—, los documentos sueltos son el UNICO " +
        "camino que queda",
    ).toBeGreaterThan(cierra);
  });

  it("y el documento del realm NO los lleva, que es el arreglo de #72", () => {
    const documentos = documentosDelRealm({
      domain: "d.example",
      realm: "kamayuk",
      clienteDeVerificacion: true,
    });
    expect(
      Object.keys(JSON.parse(documentos.realm) as Record<string, unknown>),
      "el documento que `--import-realm` consume volvio a declarar `clientScopes`, y eso " +
        "sustituye los trece ambitos de fabrica de Keycloak: el realm se queda con dos y todo " +
        "token sale sin `preferred_username` (#72)",
    ).not.toContain("clientScopes");
  });

  it.each(ENVIRONMENTS)("«%s»: cada ambito viaja ademas como documento suelto", (ambiente) => {
    const datos = configuracionDelRealm(ambiente);
    const documentos = documentosDelRealm({
      domain: "d.example",
      realm: "kamayuk",
      clienteDeVerificacion: ambiente === "stg",
    });

    for (const ambito of documentos.ambitos) {
      const clave = `ambito--${ambito.nombre}.json`;
      expect(
        Object.keys(datos),
        `el ConfigMap del realm no lleva «${clave}»: el guion no tendria de donde crear ese ` +
          "ambito, y un realm que ya existe se quedaria sin el para siempre",
      ).toContain(clave);
      for (const mapeador of ambito.mapeadores) {
        expect(
          Object.keys(datos),
          `falta «ambito--${ambito.nombre}--mapeador--${mapeador.nombre}.json»: un ambito que ` +
            "exista SIN su mapeador no se podria reparar, y sus tokens saldrian sin el claim",
        ).toContain(`ambito--${ambito.nombre}--mapeador--${mapeador.nombre}.json`);
      }
    }
  });

  /**
   * Y las dos mitades dicen lo mismo.
   *
   * El guion recorre las claves con un glob y saca el nombre del ambito del nombre del archivo.
   * Si el prefijo que emite `Identidad.ts` y el que el guion busca se separan, el guion no
   * encuentra nada y **no falla**: sigue, y el ambito no se crea nunca — que es exactamente el
   * defecto de partida, con otra causa.
   */
  it("el guion busca los prefijos que el ConfigMap emite, y los dos realms no se pisan", () => {
    const guion = reconciliarRealmSh();
    for (const prefijo of PREFIJOS) {
      expect(
        guion,
        `el guion no declara el prefijo «${prefijo}»: las claves que el ConfigMap emite con el ` +
          "no las recorreria nadie",
      ).toContain(prefijo);
    }
    expect(
      guion,
      "el guion no habla de `client-scopes`: no crea ningun ambito, que es el estado anterior a " +
        "#63 — y ahi `update realms` deja el realm sin los ambitos del archivo",
    ).toContain("client-scopes");

    // Y los dos prefijos no se contienen: `ambito--*` no puede recoger un ambito del realm del
    // ciudadano, ni al reves. Si se pisaran, el guion aplicaria los ambitos de un realm al otro.
    const [funcionarios, ciudadano] = PREFIJOS;
    expect(ciudadano.startsWith(funcionarios)).toBe(false);
    expect(funcionarios.startsWith(ciudadano)).toBe(false);
  });

  it.each(ENVIRONMENTS)("«%s»: ninguna clave de ambito se cuela en el otro realm", (ambiente) => {
    const claves = Object.keys(configuracionDelRealm(ambiente)).filter((k) =>
      k.startsWith("ambito"),
    );
    expect(claves.length, "el ConfigMap no lleva ninguna clave de ambito").toBeGreaterThan(0);
    for (const clave of claves) {
      expect(
        PREFIJOS.some((p) => clave.startsWith(p)),
        `la clave «${clave}» no lleva ninguno de los dos prefijos: no la recorre nadie`,
      ).toBe(true);
    }
  });
});
