/**
 * #77 — un ambiente SIN relay de correo no puede nacer con su administrador inalcanzable.
 *
 * ## El defecto, y por que no se veia
 *
 * `reconciliar-identidades.sh` crea cada funcionario con `UPDATE_PASSWORD` pendiente y **no
 * genera ninguna clave**: la entrega es un enlace de un solo uso por correo
 * (`execute-actions-email`). Es correcto donde hay relay — el usuario elige su propia clave y
 * nadie mas la ve.
 *
 * Pero `prod` **no declara relay a proposito** (ADR-0012 opcion B, D-05 sin decidir), asi que
 * su `Job` recibe `SIN_CORREO=1` y el guion se limitaba a decir «queda SIN clave y SIN enlace.
 * Fijarla a mano». O sea: el realm nacia con su administrador **sin forma de entrar**, y el
 * remedio era acordarse de correr `kcadm` a mano — el mismo tipo de rodeo que #86 existe para
 * quitar, con el agravante de que el runbook que lo documentaria enlaza al repositorio del
 * monolito **retirado**.
 *
 * Y no se veia porque `stg` SI declara relay: el unico ambiente que se ejerce a diario entra
 * por la otra rama.
 *
 * ## Lo que se comprueba, y por que en las dos mitades
 *
 * Un cableado sin uso y un uso sin cableado fallan igual de silenciosamente:
 *
 *  1. **El `Job` del realm declara `KC_CLAVE_INICIAL`** desde el `Secret`, con la clave del
 *     inventario — si no, `bootstrap-secretos.sh` la genera y nadie la lee.
 *  2. **El guion la CONSUME**, y solo dentro de la rama sin correo — si no, el `Secret` viaja
 *     al pod y no cambia nada.
 *
 * Medido antes de escribir esto: quitar el bloque de `Identidad.ts` dejaba `yarn verificar` en
 * **1 000 de 1 000**. Nada lo guardaba.
 *
 * ## Por que TEMPORAL, que es la parte que no se puede cambiar sin volver a medir
 *
 * La clave se entrega con `--temporary`: Keycloak obliga a cambiarla en el primer acceso, asi
 * que el valor del `Secret` deja de servir en cuanto se usa.
 *
 * El coste esta medido, y la medicion corrigio la cita que circulaba. Contra la plataforma de
 * compose el 2026-09-11, con `kamayuk-verificacion` —el unico cliente del realm con
 * `directAccessGrantsEnabled`— y la MISMA clave en los dos casos:
 *
 *   permanente  -> token de 2 185 caracteres
 *   temporal    -> {"error":"invalid_grant","error_description":"Account is not fully set up"}
 *
 * La fila del registro de `identidad`#14 citaba «Invalid user credentials», que es otro
 * escenario. El de la clave temporal dice «Account is not fully set up»: se lee como un
 * problema de la cuenta y lo que dice es «Keycloak exige cambiarla al entrar».
 *
 * En el CLUSTER eso no molesta a
 * nadie: `verificar-el-ambiente.sh` no pide token como el administrador y las cuentas de
 * servicio usan `client_credentials`. En COMPOSE si molesta, y por eso alli la clave la sigue
 * fijando `crear-usuario.sh` PERMANENTE.
 */
import { describe, expect, it } from "vitest";
import { construirManifiestos } from "../componentes";
import { CLAVES } from "../componentes/convenciones";
import { reconciliarIdentidadesSh } from "../componentes/fuentes";
import { ENVIRONMENTS, resourceName, type Environment } from "../config";
import { invariantesDe } from "./stacks";

interface Variable {
  readonly name: string;
  readonly value?: string;
  readonly valueFrom?: { secretKeyRef?: { name: string; key: string } };
}

/** El `env` del contenedor del `Job` que reconcilia el realm. */
function variablesDelJobDelRealm(ambiente: Environment): Variable[] {
  const prefijo = resourceName(ambiente, "realm");
  const job = construirManifiestos(invariantesDe(ambiente)).find(
    (m) => m.kind === "Job" && m.metadata.name.startsWith(prefijo),
  );
  expect(job, `el ambiente «${ambiente}» no compone el Job del realm «${prefijo}-<huella>»`)
    .toBeDefined();
  const spec = job as unknown as {
    spec: { template: { spec: { containers: { env?: Variable[] }[] } } };
  };
  return spec.spec.template.spec.containers.flatMap((c) => c.env ?? []);
}

const GUION = reconciliarIdentidadesSh();

describe("#77 · un ambiente sin relay entrega la clave inicial de su administrador", () => {
  it("hay algun ambiente SIN relay, o esto no mide nada", () => {
    // El centinela. El dia que los dos declaren relay, esta guarda se queda sin el caso que
    // existe para cubrir, y entonces lo que hay que revisar es si `KC_CLAVE_INICIAL` sigue
    // haciendo falta — no bajar la afirmacion.
    const sinRelay = ENVIRONMENTS.filter(
      (a) => invariantesDe(a).identity.smtp === undefined,
    );
    expect(
      sinRelay,
      "ningun ambiente declara estar sin relay de correo, asi que la rama `SIN_CORREO` del " +
        "guion no se compone en ninguna parte y esta guarda mide el conjunto vacio.",
    ).not.toEqual([]);
  });

  it.each(ENVIRONMENTS)(
    "«%s»: el Job del realm recibe la clave inicial del Secret del inventario",
    (ambiente) => {
      const inicial = variablesDelJobDelRealm(ambiente).find(
        (v) => v.name === "KC_CLAVE_INICIAL",
      );
      expect(
        inicial,
        "el `Job` del realm no declara `KC_CLAVE_INICIAL`. Sin ella, en un ambiente sin relay " +
          "el administrador queda SIN clave y SIN enlace: el realm nace inalcanzable y el " +
          "remedio pasa a ser acordarse de correr `kcadm` a mano (#77).",
      ).toBeDefined();
      expect(
        inicial?.valueFrom?.secretKeyRef?.key,
        "`KC_CLAVE_INICIAL` no sale de la clave del inventario, asi que " +
          "`bootstrap-secretos.sh` genera una cosa y el `Job` lee otra.",
      ).toBe(CLAVES.administradorDelRealm);
      expect(
        inicial?.valueFrom?.secretKeyRef?.name,
        "`KC_CLAVE_INICIAL` no sale del `Secret` de identidad del ambiente.",
      ).toBe(resourceName(ambiente, "keycloak"));
    },
  );

  it("el guion la consume, y solo en la rama sin correo", () => {
    // La otra mitad: un `Secret` cableado que nadie lee no cambia nada, y falla igual de
    // callado que no cablearlo.
    expect(
      GUION,
      "`reconciliar-identidades.sh` no menciona `KC_CLAVE_INICIAL`: el `Secret` viaja al pod y " +
        "no lo usa nadie.",
    ).toContain("KC_CLAVE_INICIAL");
    expect(
      GUION,
      "la clave inicial no se fija con `set-password`, que es lo unico que la entrega.",
    ).toContain("set-password");

    // Y que sea TEMPORAL: es la decision medida de este cambio, no un detalle.
    const usa = GUION.slice(GUION.indexOf("KC_CLAVE_INICIAL:-"));
    expect(
      usa.slice(0, usa.indexOf("continue")),
      "la clave inicial se fija PERMANENTE. Tiene que ser `--temporary`: el valor lo lee un " +
        "operador del `Secret`, y sin el cambio forzado esa clave sobrevive al primer acceso.",
    ).toContain("--temporary");
  });
});
