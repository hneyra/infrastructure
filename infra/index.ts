import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { auditarManifiestos, describirAuditoria } from "./auditoria";
import { auditarCapacidad, describirCapacidad } from "./capacidad";
import { construirManifiestos } from "./componentes";
import { manifiestosDelAmbiente } from "./herramientas/emitir-manifiestos";
import {
  CLAVES_DE_CREDENCIALES_DE_RESPALDO,
  secretoDeCredencialesDeRespaldo,
  secretos,
} from "./componentes/convenciones";
import { commonLabels, loadSettings, namespaceName, resourceName } from "./config";

/**
 * Composición única para los dos ambientes (`ADR-0011` §4).
 *
 * **Un solo `index.ts`.** Las diferencias entre `stg` y `prod` viven en los
 * `Pulumi.<ambiente>.yaml`, no aquí: si hubiera una rama por ambiente, la diferencia
 * dejaría de ser auditable y nadie podría afirmar que lo ensayado en `stg` se comporta
 * igual en `prod`. Los únicos condicionales admisibles son los que responden a una
 * **capacidad** declarada en configuración, no al nombre del ambiente.
 *
 * ## Cómo está montado
 *
 * Tres pasos, y el orden importa:
 *
 * 1. `loadSettings()` lee y valida la configuración. Un valor que falta revienta aquí,
 *    con su nombre y con para qué sirve.
 * 2. `construirManifiestos()` arma los objetos de Kubernetes de los cinco componentes
 *    de la fase B. Es una función pura: no crea recursos, no habla con el clúster.
 * 3. `auditarManifiestos()` los revisa contra las convenciones de `INF-01` §4 —sondas
 *    con `timeoutSeconds`, límites de recursos, `Recreate` sobre volumen, el `Secret`
 *    de `sgtm_owner` fuera del Deployment— y **lanza antes de crear nada**. Un `up` que
 *    falla al principio es mejor que uno que deja el ingreso a medias.
 *
 * Las mismas dos funciones las llaman las pruebas de `verificaciones/`, sin Pulumi y sin
 * clúster. Es lo que permite que un PR de cualquiera ponga rojo un despliegue mal
 * formado.
 *
 * ## La frontera con el flujo de liberación
 *
 * **Pulumi define el despliegue; no la versión que corre** (`ADR-0011` §5). El campo
 * `image` de los contenedores lleva `ignoreChanges`: Pulumi lo escribe al crear el
 * recurso y no vuelve a mirarlo. El flujo de liberación mueve la etiqueta con
 * `kubectl set image` —el mecanismo que #148 dejó demostrado—, y ni la liberación ni la
 * reversión ejecutan `pulumi up`. Sin `ignoreChanges`, el `preview` diario vería la
 * versión liberada como deriva y el siguiente `up` la desharía en silencio.
 *
 * ## Lo que este archivo NO crea: los `Secret` de la aplicación
 *
 * Ninguno. Las claves de `sgtm_owner`, de `sgtm_app`, del superusuario del motor, del
 * administrador de Keycloak y las de `sgtm_respaldo`/cifrado de wal-g **no están en el
 * estado de Pulumi** (`ADR-0011` §3): los manifiestos los referencian por nombre y
 * `secretos/bootstrap-secretos.sh` los pone (issue #154).
 *
 * **La única excepción, y deliberada:** las credenciales del almacenamiento de
 * objetos (`backupAccessKeyId`/`backupSecretAccessKey`). `ADR-0011` §3 las clasifica
 * como secretos de *arranque de la infraestructura* —lo que Pulumi necesita para
 * *crear* el mecanismo—, no de la aplicación: no abren el padrón de ninguna
 * municipalidad, solo dejan escribir en el contenedor de respaldo. Por eso, y solo
 * para este `Secret`, SÍ lo crea Pulumi con un valor real (issue #155).
 */

const settings = loadSettings();
const env = settings.environment;
const namespace = namespaceName(env);

const manifiestos = construirManifiestos(settings);

const problemas = auditarManifiestos(manifiestos, {
  secretoDeOwner: secretos(env).owner,
  namespace,
});
if (problemas.length > 0) {
  throw new Error(describirAuditoria(env, problemas));
}

/**
 * Y que quepa en el nodo (`capacidad.ts`).
 *
 * Va **después** de la auditoría y **antes** del proveedor, por lo mismo que ella está
 * antes de crear nada: un `up` que falla al principio es mejor que uno que deja el
 * ingreso a medias. Solo que aquí el listón es más alto todavía, porque un stack que no
 * cabe **no deja el despliegue a medias: lo deja colgado**. El `ConfigGroup` de abajo
 * espera a que todos sus `Deployment` queden `Ready`, y un pod `Pending` por falta de
 * CPU no lo está nunca. Sin esta guarda, `aplicar-prod` consume el runner hasta que la
 * plataforma lo mata a las seis horas —cuatro veces seguidas el 2026-08-25— y lo único
 * que se ve en Actions es «el trabajo sigue corriendo».
 *
 * **Con la brecha declarada, avisa en vez de lanzar**, y la diferencia importa: lanzar
 * aquí rompe también `pulumi preview`, que corre en CADA PR. Un ambiente cuyo nodo se
 * sabe pequeño dejaría entonces rojo todo PR del repositorio por algo que nadie puede
 * arreglar dentro de un PR —el aviso que `infra.yml` lleva escrito desde su cabecera:
 * «un rojo permanente por algo que nadie en el PR puede arreglar enseña a ignorar el
 * flujo»—. Lo que no puede pasar es que `pulumi up` avance: eso lo impide el paso «El
 * stack cabe en su nodo» de `aplicar-stg`/`aplicar-prod`, antes de invocar a Pulumi.
 *
 * Y la marca no se puede quedar puesta de más: `capacidad.test.ts` exige que un
 * ambiente que la declara **siga sin caber**.
 */
/*
 * Y se mide **todo lo que este ambiente pone sobre el nodo**, no solo lo que este
 * `ConfigGroup` aplica. El nodo es UNO: desde ADR-0031 los cuatro sistemas tienen namespace
 * propio, y un namespace no es una maquina — sus pods compiten por la misma CPU y la misma
 * memoria. Un `pulumi up` de la plataforma sobre un nodo que ya sostiene los cuatro se cuelga
 * exactamente igual que el del issue #252, y medir solo lo propio contestaria «cabe».
 *
 * Es la direccion segura de las dos: equivocarse por estricto detiene un despliegue que
 * habria funcionado —y lo dice, con las cifras—; equivocarse por optimista devuelve el
 * colgado en silencio, con la guarda en verde. C-16 se pago por la segunda.
 */
const todoLoQueVaAlNodo = manifiestosDelAmbiente(settings);

const noCabe = auditarCapacidad(todoLoQueVaAlNodo, {
  cpuAsignable: settings.node.allocatableCpu,
  memoriaAsignable: settings.node.allocatableMemory,
});
if (noCabe.length > 0) {
  const informe = describirCapacidad(env, noCabe);
  if (settings.node.capacityGapIssue === undefined) {
    throw new Error(informe);
  }
  pulumi.log.warn(
    `BRECHA DECLARADA (issue #${settings.node.capacityGapIssue}): este stack NO se puede ` +
      `desplegar sobre el nodo que declara. \`pulumi up\` se detiene antes de empezar; ` +
      `este \`preview\` sigue para que el PR se pueda revisar.\n\n${informe}`,
  );
}

/**
 * El proveedor de Kubernetes, contra el kubeconfig del stack.
 *
 * `enableServerSideApply` deja que el API server resuelva las fusiones de campos, que es
 * lo que permite que el flujo de liberación cambie `image` sin que Pulumi lo reclame
 * como suyo en el siguiente `up`.
 *
 * `upsertExistingObjects` existe por el `Namespace` (issue #158, encontrado reconstruyendo
 * el VPS de verdad): `bootstrap-secretos.sh` corre ANTES que este `up` a propósito —el
 * `ConfigGroup` de abajo no se da por creado hasta que todos sus Deployment quedan
 * `Ready`, y los Pods no arrancan sin sus secretos—, y crea el namespace él mismo
 * (`kubectl apply`, idempotente) porque en un clúster nunca antes gestionado no hay
 * dónde escribir nada todavía. El primer `create` del `Namespace` que declara Pulumi
 * choca entonces con «already exists»: no es un resto de una corrida anterior, es
 * estructural en **cada** reconstrucción desde cero del VPS. Sin esta opción, el primer
 * `pulumi up` de un clúster nuevo falla siempre en el mismo punto. El riesgo que
 * documenta Pulumi —adoptar-y-borrar en silencio un recurso renombrado sin alias— exige
 * un renombre sin alias, que este repositorio no hace.
 */
const proveedor = new k8s.Provider(resourceName(env, "kubernetes"), {
  kubeconfig: settings.kubeconfig,
  enableServerSideApply: true,
  upsertExistingObjects: true,
});

/**
 * El campo que el flujo de liberación mueve, y que Pulumi no vuelve a mirar.
 *
 * Se aplica a todo recurso con plantilla de pod. Un `Job` no lo necesita —su nombre
 * lleva la versión y uno nuevo se crea entero—, pero incluirlo no hace daño y evita
 * tener que acordarse de la excepción.
 */
const IGNORAR_LA_VERSION = ["spec.template.spec.containers[*].image"];

/**
 * `pulumi.com/patchForce`, en TODOS los objetos del `ConfigGroup` (issue #257,
 * confirmado contra `prod` real: el `Job` de migración chocó con el mismo conflicto de
 * Server-Side Apply que ya se vio en el `ServiceAccountPatch` del registro).
 *
 * La causa es la misma que motiva `upsertExistingObjects` más abajo, solo que no
 * limitada al `Namespace`: `aplicar-prod` se colgó y se mató a mitad de camino varias
 * veces entre el 25 y el 26 de agosto de 2026 (issue #252), y un `pulumi up` matado a
 * mitad de un `create` deja el objeto YA CREADO en Kubernetes sin que el estado de
 * Pulumi llegue a registrarlo. La corrida siguiente intenta crearlo de nuevo, choca
 * con "already exists" —que `upsertExistingObjects` sí resuelve—, pero el campo que
 * ese objeto ya tenía queda en disputa entre el field manager de ESA corrida muerta y
 * el de esta: sin `patchForce`, Server-Side Apply se niega a decidir por su cuenta.
 *
 * Forzar es seguro aquí porque lo que se está reconciliando es SIEMPRE el mismo
 * manifiesto que ya generaba `construirManifiestos()`: no hay dos verdades en pugna,
 * solo dos corridas de la misma intención. Y en un `Job` en particular no puede haber
 * ademas un cambio de valor real —su `spec.template` es inmutable una vez creado—, así
 * que forzar aquí es tomar propiedad de un campo, nunca sobrescribir un valor distinto.
 */
function conPatchForce(props: Record<string, unknown>): Record<string, unknown> {
  const metadata = (props.metadata as Record<string, unknown> | undefined) ?? {};
  const annotations = (metadata.annotations as Record<string, string> | undefined) ?? {};
  return {
    ...props,
    metadata: { ...metadata, annotations: { ...annotations, "pulumi.com/patchForce": "true" } },
  };
}

/**
 * Trae el `Namespace` entre sus 68 objetos (issue #158: encontrado reconstruyendo un
 * clúster de verdad desde cero, no en revisión).
 */
const recursos = new k8s.yaml.v2.ConfigGroup(
  resourceName(env, "sistema"),
  { objs: manifiestos },
  {
    provider: proveedor,
    transformations: [
      (args) => {
        const props = conPatchForce(args.props as Record<string, unknown>);
        if (args.type.startsWith("kubernetes:apps/v1:Deployment")) {
          return { props, opts: { ...args.opts, ignoreChanges: IGNORAR_LA_VERSION } };
        }
        return { props, opts: args.opts };
      },
    ],
  },
);

/**
 * La única excepción de «Lo que este archivo NO crea» de arriba (issue #155).
 *
 * `stringData` en vez de `data`: Pulumi cifra el valor en su estado de todos modos —es
 * un `pulumi.Output` secreto—, y `stringData` evita tener que codificarlo a base64 a
 * mano. Kubernetes lo hace por su cuenta al aplicar el objeto.
 *
 * Sin `dependsOn` hacia `recursos` a propósito (issue #158): el `ConfigGroup` no se da
 * por creado hasta que **todos** sus Deployment quedan `Ready`, y `postgres` necesita
 * este mismo `Secret` para arrancar — depender de `recursos` es un círculo que nunca
 * se resuelve. Sin dependencia declarada, este `Secret` corre en paralelo al
 * `ConfigGroup`; si su primer intento llega antes que el `Namespace` (que el propio
 * `ConfigGroup` crea en sus primeros segundos), el proveedor reintenta la creación con
 * backoff — se observó tolerando bien más de un minuto — tiempo de sobra para que el
 * `Namespace` ya exista.
 */
new k8s.core.v1.Secret(
  resourceName(env, "postgres-respaldo-credenciales"),
  {
    metadata: {
      name: secretoDeCredencialesDeRespaldo(env),
      namespace,
      labels: commonLabels(env, "respaldo"),
    },
    type: "Opaque",
    stringData: {
      [CLAVES_DE_CREDENCIALES_DE_RESPALDO.accessKeyId]: settings.backupCredentials.accessKeyId,
      [CLAVES_DE_CREDENCIALES_DE_RESPALDO.secretAccessKey]: settings.backupCredentials.secretAccessKey,
    },
  },
  { provider: proveedor },
);

/**
 * La credencial de pull del registro (issue #257), la segunda excepción de «Lo que
 * este archivo NO crea» de arriba. Misma clasificación que la de arriba: sin esto, un
 * clúster nuevo no puede traer `sgtm-aplicacion`, `sgtm-migrador` ni `sgtm-interfaz`
 * —los tres son privados en `ghcr.io/hneyra`— y cada `Deployment`/`Job` se queda en
 * `ImagePullBackOff` o `ErrImagePull` con un `401` de fondo, sin que nada en este
 * repositorio lo explicara hasta ahora.
 *
 * Va como `Secret` de `kubernetes.io/dockerconfigjson` más un `ServiceAccountPatch`
 * sobre `default` —la que usan todos los `Deployment`/`Job` de arriba, ninguno declara
 * `serviceAccountName`— en vez de repetir `imagePullSecrets` en cada manifiesto. El
 * `ServiceAccountPatch` usa Server-Side Apply: no reclama la cuenta entera, que crea
 * Kubernetes al crear el `Namespace`, solo el campo que le falta.
 *
 * **`pulumi.com/patchForce`, y por qué es intencional (issue #257, primer `pulumi up`
 * real contra `stg`):** el `ServiceAccount` `default` de `stg` YA tenía
 * `imagePullSecrets` puesto por fuera de Pulumi —el campo lo tenía el field manager
 * genérico `before-first-apply`, es decir: alguien lo puso a mano, en algún momento,
 * sin dejar rastro en este repositorio. Es la prueba misma de lo que #257 documenta:
 * la credencial de pull existía, pero era conocimiento tribal. Sin `patchForce`, Server-
 * Side Apply rechaza el conflicto y `pulumi up` falla en este único recurso —el resto
 * del stack, sin relación con `imagePullSecrets`, no se ve afectado—. Con `patchForce`,
 * Pulumi toma la propiedad del campo y lo deja igual a como lo declara este archivo, que
 * es precisamente el punto: que a partir de aquí el campo lo gobierne el código, no una
 * mano que nadie puede auditar.
 */
const registroDeImagenes = pulumi
  .output(settings.application.imageRepository)
  .apply((repo) => repo.split("/")[0] ?? repo);

const secretoDeRegistro = new k8s.core.v1.Secret(
  resourceName(env, "registro-credenciales"),
  {
    metadata: {
      name: resourceName(env, "registro-credenciales"),
      namespace,
      labels: commonLabels(env, "registro"),
    },
    type: "kubernetes.io/dockerconfigjson",
    stringData: {
      ".dockerconfigjson": pulumi
        .all([registroDeImagenes, settings.registryCredentials.token])
        .apply(([servidor, token]: [string, string]) =>
          JSON.stringify({
            auths: {
              [servidor]: {
                username: settings.registryCredentials.username,
                password: token,
                auth: Buffer.from(`${settings.registryCredentials.username}:${token}`).toString(
                  "base64",
                ),
              },
            },
          }),
        ),
    },
  },
  { provider: proveedor },
);

new k8s.core.v1.ServiceAccountPatch(
  resourceName(env, "default-registro"),
  {
    metadata: {
      name: "default",
      namespace,
      annotations: { "pulumi.com/patchForce": "true" },
    },
    imagePullSecrets: [{ name: secretoDeRegistro.metadata.name }],
  },
  { provider: proveedor },
);

// Salidas del stack. Sirven de comprobante de que la configuración se leyó, se validó y
// los manifiestos pasaron la auditoría: si algo contradijera la documentación,
// `loadSettings` o `auditarManifiestos` ya habrían lanzado y no se llegaría aquí.
export const environment = env;
export const namespaceDelSistema = namespace;
export const domain = settings.ingress.domain;
export const databaseResource = resourceName(env, "postgres");

/** Cuántos objetos describe el stack. Cambia cuando cambia la forma del despliegue. */
export const objetosDelSistema = manifiestos.length;

/** El RPO, tal como quedó configurado. Se publica para poder comprobarlo desde fuera. */
export const walArchiveTimeoutSeconds = settings.backup.walArchiveTimeoutSeconds;

/** Si esta instalación marca todo documento que emite (`INF-03` §3.2). */
export const isDemonstration = settings.application.isDemonstration;

/**
 * La versión con la que se crearon los despliegues.
 *
 * **No es la que corre**: la que corre la pone el flujo de liberación y se lee del
 * clúster con `kubectl get deployment -o jsonpath='{...image}'`, que es lo que demuestra
 * el criterio 1 de #148. Se publica para poder comparar las dos.
 */
export const bootstrapVersion = settings.application.bootstrapVersion;

/** Los recursos aplicados, para que `pulumi stack` los enseñe agrupados. */
export const recursosDelSistema = recursos.urn;
