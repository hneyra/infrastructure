import type { Environment } from "../config";
import { nombreDelSecretoDeRegistro } from "./convenciones";
import type { EspecificacionDePod, Manifiesto } from "./tipos";

/**
 * La credencial del registro, escrita DENTRO de cada plantilla de pod del ambiente (#166).
 *
 * ## El defecto, medido en `stg` el 2026-09-13
 *
 * `index.ts` crea el `Secret` `kamayuk-<amb>-registro-credenciales` en los seis espacios de
 * nombres y parchea el `ServiceAccount` `default` de cada uno para que sus pods lo hereden
 * (#257). Eso vale **para los pods que se crean despues del parche, y solo para esos**: el
 * controlador de admision de `ServiceAccount` copia `imagePullSecrets` de la cuenta al pod al
 * ADMITIRLO, y un pod ya admitido no lo recibe nunca.
 *
 * En la reconstruccion de `stg` sobre `vmd205066` —un cluster vacio— los pods se crearon entre
 * las 14:24:15Z y las 14:25:00Z con `spec.imagePullSecrets` vacio, y Pulumi parcheo la cuenta de
 * `kamayuk-identidad-stg` a las 14:26:52Z. Los paquetes publicos no lo notaron; `identidad`, el
 * unico privado, quedo en `ImagePullBackOff` con `failed to fetch anonymous token`, y detras
 * cayeron las implantaciones de `caja`, `catastro` y `normativa`. Borrar los pods lo arreglo en
 * el acto, porque los recreados ya pasaban por la cuenta parcheada.
 *
 * ## Por que la plantilla, y por que con eso el orden deja de importar
 *
 * Declarar el orden —`Namespace` → `Secret` → parche → pods— no se puede sin romper el circulo
 * que `index.ts` explica: el `ConfigGroup` crea los `Namespace` y no se da por creado hasta que
 * sus `Deployment` estan `Ready`. Con el nombre del `Secret` en la plantilla **no hay orden que
 * cuidar**: el kubelet vuelve a leer los `imagePullSecrets` del pod en cada reintento de la
 * descarga, asi que un pod creado ANTES que su `Secret` arranca en cuanto el `Secret` existe. Lo
 * que el parche no puede dar es eso.
 *
 * **Medido, no deducido**, el 2026-09-13 con un k3s v1.33.4 desechable en Docker y un registro
 * local con autenticacion —ninguna credencial real—: dos `Deployment` creados a las 18:40:19Z con
 * una imagen privada cada uno y **sin** `Secret` en el espacio, los dos en `ErrImagePull`. A las
 * 18:40:46Z se crea el `Secret` y se parchea la cuenta `default` de los dos, que es lo que hace
 * `index.ts`. El que lleva `imagePullSecrets` en la plantilla corre a las **18:40:57Z**, once
 * segundos despues y sin que nadie lo toque. El que dependia del parche seguia en
 * `ImagePullBackOff` a las **18:46:21Z** —cinco minutos y medio despues, con
 * `spec.imagePullSecrets` vacio y 21 fallos contados—, y borrar su pod lo arreglo en un segundo:
 * es #166 reproducido fuera de `stg`. (Una primera version de la medida uso la MISMA imagen en los
 * dos y el del parche «se curo» solo: la habia bajado el otro y el nodo la tenia en cache. Con un
 * paquete privado por sistema, que es el caso real, no hay cache que lo tape.)
 *
 * ## Por que aqui y no en las `transformations` del `ConfigGroup`
 *
 * Porque **alli no llega**, y tambien esta medido: `k8s.yaml.v2.ConfigGroup` es un componente
 * REMOTO —lo construye el proveedor, no este proceso—, y la opcion `transformations` solo corre
 * sobre los recursos que construye el SDK de Node. Con `@pulumi/kubernetes` 4.33.0 y un
 * `pulumi preview` contra ese k3s desechable, la transformacion se invoco UNA vez, sobre
 * `kubernetes:yaml/v2:ConfigGroup`, y nunca sobre su `Deployment` hijo, que salio sin
 * `imagePullSecrets`; el mismo `Deployment` con el campo puesto en `objs` si lo llevaba. Una
 * credencial puesta en esa transformacion habria dejado este archivo afirmando un arreglo que no
 * llega al cluster. Lo que eso significa para el `ignoreChanges` que vive alli es #172, y no se
 * toca aqui.
 *
 * Y va sobre la lista entera que `manifiestosDelAmbiente()` devuelve —la que `index.ts` pasa como
 * `objs`, la que emite `yarn manifiestos` y la que leen las guardas— para que las tres lecturas
 * del ambiente sigan siendo una (C-16, y el docblock de `index.ts` sobre la noche del
 * 2026-09-05).
 *
 * ## A TODA plantilla, no solo a las que traen una imagen privada
 *
 * Una lista de «quien la necesita» se queda vieja el dia que otro paquete pase a privado, y ese
 * defecto no se ve hasta que un pod no arranca — es el mismo argumento con el que #257 derivo los
 * seis espacios en vez de escribirlos. El `dockerconfigjson` solo autentica contra `ghcr.io`, asi
 * que a un pod que baja de otro registro no le cambia nada.
 *
 * **Lo que cuesta, y hay que decirlo:** el primer `pulumi up` tras este cambio ve una plantilla
 * nueva en cada `Deployment` —los reinicia, el motor incluido, que es `Recreate`— y en cada `Job`,
 * cuya `spec.template` es inmutable: el proveedor lo clasifica como REEMPLAZO —medido en el mismo
 * k3s desechable: `replaceReasons` de un `Job` incluye `spec.template.spec.imagePullSecrets`—, y
 * con el nombre explicito eso es borrar y crear. Migraciones, implantaciones y el `Job` del realm
 * vuelven a correr una vez.
 */
export function conCredencialDeRegistro(
  manifiestos: Manifiesto[],
  environment: Environment,
): Manifiesto[] {
  const nombre = nombreDelSecretoDeRegistro(environment);
  // Sin mutar. Las pruebas componen `stg` y `prod` en el mismo proceso, y el dia que un componente
  // reuse un objeto de pod entre llamadas, uno modificado en el sitio acabaria nombrando el
  // `Secret` de los dos ambientes — con un nombre de mas que no existe y sin ningun rojo.
  return manifiestos.map((m): Manifiesto => {
    switch (m.kind) {
      case "Deployment":
        return {
          ...m,
          spec: {
            ...m.spec,
            template: { ...m.spec.template, spec: conElSecreto(m.spec.template.spec, nombre) },
          },
        };
      case "Job":
        return {
          ...m,
          spec: {
            ...m.spec,
            template: { ...m.spec.template, spec: conElSecreto(m.spec.template.spec, nombre) },
          },
        };
      case "CronJob":
        return {
          ...m,
          spec: {
            ...m.spec,
            jobTemplate: {
              ...m.spec.jobTemplate,
              spec: {
                ...m.spec.jobTemplate.spec,
                template: {
                  ...m.spec.jobTemplate.spec.template,
                  spec: conElSecreto(m.spec.jobTemplate.spec.template.spec, nombre),
                },
              },
            },
          },
        };
      default:
        // Ningun otro `kind` del tipo lleva pods hoy. Si alguno llega a llevarlos y se olvida
        // aqui, no lo dice este `switch`: lo dice la guarda, que busca plantillas por su FORMA
        // —un objeto con `containers`— y no por esta lista.
        return m;
    }
  });
}

/** Idempotente, y respeta lo que la plantilla ya traiga: anade, no sustituye. */
function conElSecreto(pod: EspecificacionDePod, nombre: string): EspecificacionDePod {
  const ya = pod.imagePullSecrets ?? [];
  if (ya.some((s) => s.name === nombre)) return pod;
  return { ...pod, imagePullSecrets: [...ya, { name: nombre }] };
}
