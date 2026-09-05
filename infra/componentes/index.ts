import { commonLabels, namespaceName, type Invariants } from "../config";
import { manifiestosDeAplicacion } from "./Aplicacion";
import { manifiestosDeBaseDeDatos } from "./BaseDeDatos";
import { manifiestosDeIdentidad } from "./Identidad";
import { manifiestosDeIngreso } from "./Ingreso";
import { manifiestosDeObservabilidad } from "./Observabilidad";
import { manifiestosDeMigracion } from "./Migracion";
import { manifiestosDeRed } from "./Red";
import { manifiestosDeRespaldo } from "./Respaldo";
import { clasesDePrioridad, recursosDe } from "./convenciones";
import type { Manifiesto, Namespace } from "./tipos";

/**
 * Los cinco componentes de la fase B, mas el respaldo de la fase C (issue #155),
 * compuestos en el orden en que arrancan.
 *
 * Una funcion, sin Pulumi dentro. `index.ts` la llama, audita lo que devuelve y lo
 * aplica; las pruebas la llaman y leen el resultado. Es lo que permite que `yarn
 * verificar` diga algo cierto sobre el despliegue **sin** token, sin tunel y sin VPS.
 */
export function construirManifiestos(s: Invariants): Manifiesto[] {
  const environment = s.environment;
  const namespace = namespaceName(environment);
  const version = s.application.bootstrapVersion;

  /**
   * Cuanto pide este ambiente sobre su nodo (`C-19`). Se resuelve **una vez** y se pasa a
   * los seis componentes: la tabla base no se exporta, asi que ninguno puede saltarsela.
   */
  const recursos = recursosDe(s.recursos.perfil);

  /**
   * Si este ambiente despliega el monolito (`C-19`).
   *
   * Es una **capacidad declarada** y no el nombre del ambiente, que es lo unico que la
   * cabecera de `index.ts` admite como condicional. Gobierna tres cosas y ninguna mas: los
   * dos `Job` de arranque, la aplicacion con su interfaz y su `CronJob` de lote, y las dos
   * rutas del ingreso que apuntan a esos dos servicios —una `IngressRoute` a un `Service`
   * que no existe no se queda callada: contesta `503` en la raiz del dominio publico—.
   *
   * **Lo que NO gobierna es la plataforma**, y ese es el punto: el motor, la identidad, el
   * correo, el `Job` del realm, el respaldo y la observabilidad se quedan, porque los
   * cuatro sistemas de ADR-0031 viven en su propio namespace y se conectan a
   * `sgtm-<amb>-postgres.sgtm-<amb>` (C-17, punto 1). Borrar la plataforma con el monolito
   * los dejaria sin base, y el sintoma no seria un error sino cuatro pods que arrancan y
   * no pasan nunca su sonda de arranque.
   *
   * **Las `NetworkPolicy` tampoco**, y es deliberado: una politica cuyo `podSelector` no
   * casa con ningun pod es inerte —no abre nada, no cierra nada, no ocupa nodo—, y
   * `permitir-ingreso-postgres` es **una sola** politica que nombra a la vez a los pods
   * del monolito y a los cuatro sistemas. Recortarla por dentro seria cirugia sobre la
   * unica regla que deja a los cuatro llegar a su base, a cambio de nada.
   */
  const conMonolito = s.application.deployMonolith;

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
    ...(conMonolito
      ? manifiestosDeMigracion({
          environment,
          namespace,
          recursos,
          imageRepository: s.application.imageRepository,
          version,
          postgresImage: s.database.image,
          implantacion: {
            ubigeo: s.implantacion.ubigeo,
            nombre: s.implantacion.nombre,
            tipo: s.implantacion.tipo,
            administrador: s.implantacion.administrador,
            nombreDelAdministrador: s.implantacion.nombreDelAdministrador,
            esDemostracion: s.application.isDemonstration,
          },
        })
      : []),
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
      // implanta el Job de arriba: una fuente, un administrador (ADR-0012).
      ubigeo: s.implantacion.ubigeo,
      administrador: s.implantacion.administrador,
    }),
    ...(conMonolito
      ? manifiestosDeAplicacion({
          environment,
          namespace,
          recursos,
          imageRepository: s.application.imageRepository,
          version,
          postgresImage: s.database.image,
          webReplicas: s.application.webReplicas,
          domain: s.ingress.domain,
          realm: s.identity.realm,
        })
      : []),
    ...manifiestosDeIngreso({
      environment,
      namespace,
      conMonolito,
      domain: s.ingress.domain,
      acmeEmail: s.ingress.acmeEmail,
      acmeStaging: s.ingress.acmeStaging,
    }),
    ...manifiestosDeObservabilidad({
      environment,
      namespace,
      recursos,
      conMonolito,
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
