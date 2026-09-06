import { commonLabels, namespaceName, type Invariants } from "../config";
import { manifiestosDeBaseDeDatos } from "./BaseDeDatos";
import { manifiestosDeIdentidad } from "./Identidad";
import { manifiestosDeIngreso } from "./Ingreso";
import { manifiestosDeObservabilidad } from "./Observabilidad";
import { manifiestosDeRed } from "./Red";
import { manifiestosDeRespaldo } from "./Respaldo";
import { clasesDePrioridad, recursosDe } from "./convenciones";
import type { Manifiesto, Namespace } from "./tipos";

/**
 * Los componentes de la PLATAFORMA, compuestos en el orden en que arrancan.
 *
 * **El monolito ya no esta** (`E`). Hasta el 2026-09-06 esta funcion componia ademas sus
 * dos `Job` de arranque, su `Deployment`, su interfaz, su `CronJob` de lote y las dos rutas
 * del ingreso que apuntaban a sus dos `Service`, todo detras de la bandera
 * `desplegarElMonolito` que C-19 apago en `stg`. La direccion cerro la migracion, asi que
 * la bandera se va con el codigo que gobernaba: una capacidad con un solo valor posible es
 * una rama que nadie ejercita, y volver a encenderla no seria una linea sino recuperar los
 * dos componentes que este cambio borra.
 *
 * Lo que queda es lo que los cuatro sistemas de ADR-0031 necesitan: el motor con sus cuatro
 * bases, la identidad, el correo, el `Job` del realm, el respaldo y la observabilidad.
 *
 * Una funcion, sin Pulumi dentro. `index.ts` la llama, audita lo que devuelve y lo
 * aplica; las pruebas la llaman y leen el resultado. Es lo que permite que `yarn
 * verificar` diga algo cierto sobre el despliegue **sin** token, sin tunel y sin VPS.
 */
export function construirManifiestos(s: Invariants): Manifiesto[] {
  const environment = s.environment;
  const namespace = namespaceName(environment);

  /**
   * Cuanto pide este ambiente sobre su nodo (`C-19`). Se resuelve **una vez** y se pasa a
   * los componentes: la tabla base no se exporta, asi que ninguno puede saltarsela.
   */
  const recursos = recursosDe(s.recursos.perfil);

  const espacio: Namespace = {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: { name: namespace, labels: commonLabels(environment, "namespace") },
  };

  return [
    espacio,
    ...clasesDePrioridad(environment),
    ...manifiestosDeBaseDeDatos({
      environment,
      namespace,
      recursos,
      image: s.database.image,
      storageSize: s.database.storageSize,
      backup: {
        endpoint: s.backup.endpoint,
        region: s.backup.region,
        bucket: s.backup.bucket,
        walArchiveTimeoutSeconds: s.backup.walArchiveTimeoutSeconds,
      },
    }),
    ...manifiestosDeRespaldo({
      environment,
      namespace,
      recursos,
      postgresImage: s.database.image,
      backup: {
        endpoint: s.backup.endpoint,
        region: s.backup.region,
        bucket: s.backup.bucket,
      },
      alertWebhookUrl: s.backup.alertWebhookUrl,
    }),
    ...manifiestosDeIdentidad({
      environment,
      namespace,
      recursos,
      image: s.identity.image,
      realm: s.identity.realm,
      domain: s.ingress.domain,
      // El cliente de verificacion existe donde se siembran usuarios de prueba, y en
      // ningun otro sitio: es lo que hace posible pedir un token sin navegador.
      clienteDeVerificacion: s.identity.seedTestUsers,
      // El buzon Mailpit va con los usuarios de prueba: los dos son de `stg` y de
      // ningun otro sitio (ADR-0012, INF-03 §4).
      correoDePrueba: s.identity.seedTestUsers,
      smtp: s.identity.smtp,
      // Los usuarios y el grupo que se reconcilian son los de la municipalidad que
      // implantan los cuatro `Job` de los sistemas: una fuente, un administrador
      // (ADR-0012). Hasta `E` los implantaba ademas el `Job` del monolito, que ya no esta.
      ubigeo: s.implantacion.ubigeo,
      administrador: s.implantacion.administrador,
    }),
    ...manifiestosDeIngreso({
      environment,
      namespace,
      domain: s.ingress.domain,
      acmeEmail: s.ingress.acmeEmail,
      acmeStaging: s.ingress.acmeStaging,
    }),
    ...manifiestosDeObservabilidad({
      environment,
      namespace,
      recursos,
      alertWebhookUrl: s.observability.alertWebhookUrl,
    }),
    // Al final, a proposito (issue #157): `denegar-todo` selecciona TODOS los
    // pods de arriba por igual, y aplicarla despues no cambia nada —Kubernetes
    // no tiene «orden de aplicacion», las politicas se unen— pero deja el
    // manifiesto en el orden en que se razona: primero lo que corre, despues lo
    // que decide con quien puede hablar.
    ...manifiestosDeRed({
      environment,
      namespace,
      smtp: s.identity.smtp,
      correoDePrueba: s.identity.seedTestUsers,
    }),
  ];
}

export * from "./tipos";
