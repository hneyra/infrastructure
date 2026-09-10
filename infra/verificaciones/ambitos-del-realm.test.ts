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
 * «FALLO: el realm «kamayuk» no tiene el ambito «kamayuk-servicio»» —el que #21 anadio al archivo
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
   * Y sigue estando DENTRO de `realm.json`, que es como llega cuando el realm se crea.
   *
   * Los dos caminos hacen falta: el `create` importa los ambitos del archivo, y el `update` no.
   * Quitarlos de ahi arreglaria el ambiente que existe y romperia el que nazca manana.
   */
  it("el `realm.json` conserva sus ambitos, que es el camino del `create`", () => {
    const documentos = documentosDelRealm({
      domain: "d.example",
      realm: "kamayuk",
      clienteDeVerificacion: true,
    });
    const realm = JSON.parse(documentos.realm) as { clientScopes?: { name: string }[] };
    expect(
      (realm.clientScopes ?? []).map((a) => a.name),
      "`realm.json` se quedo sin sus ambitos: un realm NUEVO naceria sin ellos",
    ).toEqual(documentos.ambitos.map((a) => a.nombre));
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
