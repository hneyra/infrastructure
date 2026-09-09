import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { claveDeServicio } from "../componentes/convenciones";
import { raizDelRepositorio } from "../componentes/fuentes";
import { inventarioDelAmbiente } from "../componentes/secretos";
import type { Job } from "../componentes/tipos";
import { manifiestosDelAmbiente } from "../herramientas/emitir-manifiestos";
import { ENVIRONMENTS } from "../config";
import { invariantesDe } from "./stacks";
import {
  AMBITO_DE_SERVICIO,
  clienteDeServicio,
  credencialesDeServicio,
  desajustes,
  realm,
  serviciosDeclarados,
  ubigeosDeclarados,
} from "./identidad-de-servicio";

/**
 * #21 — la identidad de servicio, y que no pueda volver a nacer un secreto que no sirve.
 *
 * Lo que estas pruebas sostienen esta en {@link ./identidad-de-servicio.ts}; aqui solo se
 * ejercen. La que importa es la ultima: **las dos fuentes tienen que decir lo mismo**, y hasta
 * #21 ninguna miraba a la otra.
 */

const RAIZ = raizDelRepositorio();

describe("el realm versionado declara la maquinaria de la identidad de servicio (AC-1)", () => {
  it(`declara el ambito «${AMBITO_DE_SERVICIO}»`, () => {
    const ambitos = (realm(RAIZ).clientScopes ?? []).map((a) => a.name);
    expect(ambitos).toContain(AMBITO_DE_SERVICIO);
  });

  it("y ese ambito lleva `municipalidad_id` AL TOKEN DE ACCESO, que es lo unico que lo acota", () => {
    const ambito = (realm(RAIZ).clientScopes ?? []).find((a) => a.name === AMBITO_DE_SERVICIO);
    const mapa = (ambito?.protocolMappers ?? []).find((m) => m.name === "municipalidad-id");
    expect(mapa, "sin el mapeador, el token de la cuenta de servicio no dice de que municipalidad es").toBeDefined();
    // El claim en el ID token no sirve de nada: quien autoriza lee el de acceso.
    expect(mapa?.config?.["access.token.claim"]).toBe("true");
    expect(mapa?.config?.["claim.name"]).toBe("municipalidad_id");
  });

  it("ningun cliente con cuenta de servicio es publico", () => {
    // Un cliente publico no tiene clave: su `client_credentials` lo puede pedir cualquiera que
    // sepa el `clientId`, y el token saldria con el `municipalidad_id` de esa cuenta dentro.
    const publicosConCuenta = (realm(RAIZ).clients ?? [])
      .filter((c) => c.serviceAccountsEnabled === true && c.publicClient !== false)
      .map((c) => c.clientId);
    expect(publicosConCuenta).toEqual([]);
  });
});

describe("las cuentas de servicio se declaran por municipalidad (ADR-0028 §2)", () => {
  it("hay al menos una municipalidad declarada, o esto no mide nada", () => {
    // El contraste: sin sujeto, todas las comprobaciones de abajo se cumplirian solas.
    expect(ubigeosDeclarados(RAIZ).length).toBeGreaterThan(0);
  });

  it("y al menos una cuenta de servicio, por lo mismo", () => {
    expect(serviciosDeclarados(RAIZ).length).toBeGreaterThan(0);
  });

  it("el identificador del cliente lleva el ubigeo, que es lo que impide un token para todas", () => {
    const ubigeos = ubigeosDeclarados(RAIZ);
    // Un cliente por (sistema, ubigeo), y NO por cuenta declarada: desde la etapa 4 de ADR-0039
    // `rentas` declara dos cuentas —hacia `catastro` y hacia `identidad`— y las dos las sirve el
    // mismo cliente. Hasta entonces esta linea comparaba contra el numero de cuentas, y con dos
    // destinos por sistema habria salido roja sobre una declaracion correcta.
    const pares = new Set(serviciosDeclarados(RAIZ).map((s) => `${s.sistema}|${s.ubigeo}`));
    const ids = [...pares].map((p) => {
      const [sistema = "", ubigeo = ""] = p.split("|");
      return clienteDeServicio(sistema, ubigeo);
    });
    expect(new Set(ids).size, "dos municipalidades no pueden compartir cliente").toBe(pares.size);
    for (const u of ubigeos) {
      expect(ids.filter((i) => i.endsWith(`-${u}`)).length).toBeGreaterThan(0);
    }
  });
});

describe("el inventario y la identidad declarativa dicen lo mismo (AC-6)", () => {
  it.each(ENVIRONMENTS)(
    "%s: toda credencial de emisor tiene su cuenta, y toda cuenta tiene quien la pida",
    (ambiente) => {
      const hallazgos = desajustes(RAIZ, invariantesDe(ambiente));
      expect(hallazgos, hallazgos.join("\n\n")).toEqual([]);
    },
  );

  it.each(ENVIRONMENTS)("%s: hay al menos una credencial de emisor que comprobar", (ambiente) => {
    // El contraste de #21: con `emisor` sin declarar en ningun descriptor, la comprobacion de
    // arriba pasa en verde sobre el conjunto vacio — que es el estado exacto del que este issue
    // sale, con `KAMAYUK_CATASTRO_CREDENCIAL` declarada, generada y rechazada con 401.
    expect(credencialesDeServicio(invariantesDe(ambiente)).length).toBeGreaterThan(0);
  });
});

/**
 * **El AC-2 por su lado declarativo: la clave que el emisor espera y la que el que llama manda
 * son el MISMO valor, o no son nada.**
 *
 * Un cliente confidencial nace con una clave que Keycloak inventa. Con eso el cliente existe
 * —que es AC-1— y no sirve: quien llama no puede adivinarla. Asi que la fuente de verdad pasa a
 * ser el `Secret` de la plataforma, el `Job` de identidad se la FIJA a Keycloak, y el que llama
 * la recibe por espejo en su propio namespace.
 *
 * Las tres piezas se comprueban **ejecutando**, no leyendo: el punto de montaje sale del
 * manifiesto y la ruta que el guion busca sale del guion, y lo que se afirma es que coinciden.
 * Dos literales iguales escritos en dos archivos es exactamente el defecto que C-17 encontro
 * cinco veces.
 */
describe("la clave del cliente de servicio la pone el despliegue, no Keycloak (AC-2)", () => {
  const guion = readFileSync(
    join(RAIZ, "despliegue/identidad/reconciliar-identidades.sh"),
    "utf8",
  );

  it.each(ENVIRONMENTS)(
    "%s: cada cuenta declarada tiene su clave en el Secret de la plataforma",
    (ambiente) => {
      const inventario = inventarioDelAmbiente(invariantesDe(ambiente));
      const enElSecreto = new Set(
        inventario
          .filter((e) => e.secreto === `kamayuk-${ambiente}-servicios-de-identidad`)
          .map((e) => e.clave),
      );
      // Una clave por CLIENTE: `rentas` declara dos cuentas —hacia `catastro` y hacia
      // `identidad`— y las dos las sirve el mismo cliente con la misma clave (etapa 4 de
      // ADR-0039). Por eso el conjunto, y no la lista.
      const declaradas = [
        ...new Set(serviciosDeclarados(RAIZ).map((s) => claveDeServicio(s.sistema, s.ubigeo))),
      ];
      expect(declaradas.length, "sin cuentas declaradas esto no mide nada").toBeGreaterThan(0);
      expect(declaradas.filter((c) => !enElSecreto.has(c))).toEqual([]);
      // Y la otra direccion: una clave que no reclama ninguna cuenta es una credencial que
      // alguien tendria que rotar sin saber para que.
      expect([...enElSecreto].filter((c) => !declaradas.includes(c))).toEqual([]);
    },
  );

  it.each(ENVIRONMENTS)(
    "%s: el que llama recibe por espejo la clave de SU municipalidad, no la de otra",
    (ambiente) => {
      const invariantes = invariantesDe(ambiente);
      const inventario = inventarioDelAmbiente(invariantes);
      const espejos = inventario.filter(
        (e) => e.espejoDe?.secreto === `kamayuk-${ambiente}-servicios-de-identidad`,
      );
      expect(espejos.length, "ninguna credencial de emisor es espejo: AC-2 no esta").toBeGreaterThan(0);
      for (const e of espejos) {
        // El ubigeo implantado, y no cualquiera de los declarados: darle a un proceso la clave
        // de otra municipalidad le deja pedir un token acotado a esa otra, que es deshacer con
        // el secreto lo que el atributo de la cuenta acota (ADR-0028 §2).
        expect(e.espejoDe?.clave.endsWith(`-${invariantes.implantacion.ubigeo}`), e.secreto).toBe(
          true,
        );
      }
    },
  );

  it("el guion FIJA la clave del cliente, en vez de quedarse con la que Keycloak genero", () => {
    expect(guion).toMatch(/kc update "clients\/\$id" -r "\$REALM" -s "secret=/);
  });

  it("y se para nombrandola cuando falta, que es lo unico que impide un 401 silencioso", () => {
    // Sin esto el guion se caeria al valor que Keycloak invento: cliente creado, `Secret` con un
    // valor aleatorio, y 401 en la primera llamada — el estado exacto del que #21 sale, con el
    // cliente ya creado para taparlo.
    expect(guion).toMatch(/if \[ ! -s "\$archivo" \]; then/);
    expect(guion).toContain("no esta la clave de");
  });

  it.each(ENVIRONMENTS)(
    "%s: el Job monta ese Secret donde el guion lo busca, y las dos rutas se leen de su fuente",
    (ambiente) => {
      const manifiestos = manifiestosDelAmbiente(invariantesDe(ambiente));
      // El Job del realm lleva la huella de su contenido en el nombre (`-realm-<huella>`), asi
      // que se busca por prefijo: fijar el nombre entero aqui obligaria a reescribir esta prueba
      // cada vez que cambie una linea del realm versionado.
      const job = manifiestos.find(
        (m): m is Job => m.kind === "Job" && m.metadata.name.startsWith(`kamayuk-${ambiente}-realm-`),
      );
      expect(job, "no hay Job de identidad que mirar").toBeDefined();
      const pod = job!.spec.template.spec;
      const volumen = pod.volumes?.find(
        (v) => v.secret?.secretName === `kamayuk-${ambiente}-servicios-de-identidad`,
      );
      expect(volumen, "el Job no monta el Secret de las claves de servicio").toBeDefined();
      const montaje = pod.containers
        .flatMap((c) => c.volumeMounts ?? [])
        .find((m) => m.name === volumen!.name);
      expect(montaje, "el volumen esta declarado y no lo monta ningun contenedor").toBeDefined();

      // La ruta que el guion busca, leida DEL GUION. Un literal escrito aqui seria el tercer
      // sitio con la misma verdad, y el que se quedaria viejo.
      const [, porOmision] = /: "\$\{CLAVES_DE_SERVICIO:=([^}]+)\}"/.exec(guion) ?? [];
      expect(porOmision, "el guion ya no declara donde busca las claves").toBeDefined();
      expect(montaje!.mountPath).toBe(porOmision);
    },
  );
});
