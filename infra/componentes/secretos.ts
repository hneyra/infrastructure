import {
  secretos as nombresDeSecretos,
  CLAVES,
  ROL_DE_IDENTIDAD,
  servicioDeAplicacion,
  servicioDeBaseDeDatos,
  servicioDeGrafana,
  servicioDeIdentidad,
} from "./convenciones";
import type { Environment } from "../config";

/**
 * El inventario de secretos de la aplicacion, en un solo sitio (issue #154).
 *
 * `convenciones.ts` ya nombra los `Secret` y sus claves — es lo que los manifiestos
 * referencian. Este archivo agrega **de donde sale cada valor** y **cada cuanto se
 * rota**, y es la fuente unica que leen tres cosas distintas: `docs/80-infraestructura/
 * gestion-de-secretos.md` (a mano, porque un documento no ejecuta TypeScript),
 * `herramientas/emitir-secretos.ts` (que lo vuelca a JSON para los guiones de bash) y
 * `verificaciones/secretos.test.ts` (que exige que ninguna clave se repita entre roles).
 *
 * **Ninguno de estos valores vive aqui.** Esto es metadatos —nombre, clave, rol de
 * PostgreSQL si lo tiene, periodicidad—, nunca el secreto mismo. `ADR-0011` §3 sigue
 * intacto: Pulumi crea el `Namespace` y referencia estos `Secret` por nombre; no los crea
 * con un valor. Quien genera el valor es `secretos/bootstrap-secretos.sh`, y quien lo
 * escribe en el clúster es `kubectl`, nunca `pulumi up`.
 */

/** Cada cuanto se rota un secreto, y por que. */
export type Periodicidad = "semestral" | "trimestral" | "anual" | "nunca-desde-el-nodo" | "tras-incidente";

export interface EntradaDeSecreto {
  /** Identificador corto, el que usan los guiones de bash (`--rol sgtm-app`). */
  rol: string;
  /** El `Secret` de Kubernetes que lo guarda. */
  secreto: string;
  /** La clave dentro de ese `Secret`. */
  clave: string;
  /** Quien lo consume. */
  consumidor: string;
  periodicidad: Periodicidad;
  /**
   * El rol de PostgreSQL cuya clave es esta, si lo es. `undefined` para lo que no es una
   * clave de un rol del motor (el administrador de Keycloak, por ejemplo).
   *
   * Es lo que `rotar-clave.sh` necesita para saber si tiene que hacer `ALTER ROLE` o
   * solo reemplazar el `Secret`.
   */
  rolDePostgres?: string;
  /**
   * El `Deployment` que hay que reprogramar despues de rotar, si alguno lo consume
   * como pod en marcha. `undefined` cuando nadie lo necesita asi: `sgtm-owner` solo lo
   * leen los dos Jobs, y un Job nuevo ya lee el `Secret` actualizado al crearse — no
   * hay pod en marcha que reprogramar.
   */
  requiereReinicioDe?: string;
  /**
   * La base a la que ese rol se conecta de verdad, y **no siempre es el padron**
   * (issue #435).
   *
   * `sgtm_respaldo` no tiene `CONNECT` sobre `sgtm` a proposito —`pg_backup_start` y
   * `pg_backup_stop` son operaciones del cluster, no de una base, y una credencial de
   * mas apuntando al padron es una credencial de mas (#155)—, y `keycloak` tiene la
   * suya. Sin este dato, comprobar «¿sirve esta credencial?» conectando a `sgtm` da
   * un rojo falso justo en los dos roles cuyo aislamiento es deliberado: paso al
   * escribir `asignar-claves.sh`, y el rojo parecia el mismo que el de un rol sin
   * `LOGIN`.
   */
  baseDeDatos?: string;
}

/**
 * El inventario completo de un ambiente.
 *
 * Once entradas, nueve `Secret` distintos —`sgtm-<amb>-keycloak` y
 * `sgtm-<amb>-postgres-respaldo` guardan dos claves cada uno— con once valores,
 * **ninguno repetido**: es la comprobacion que pide el issue, no solo «roles
 * distintos» sino «claves distintas». La prueba en `verificaciones/secretos.
 * test.ts` lo exige contando entradas unicas por `secreto`+`clave`, y
 * `completar-secreto.ts` lo hace estructuralmente imposible de incumplir al generar.
 */
export function inventarioDeSecretos(environment: Environment): EntradaDeSecreto[] {
  const nombres = nombresDeSecretos(environment);

  return [
    {
      rol: "postgres-superusuario",
      secreto: nombres.motor,
      clave: CLAVES.superusuario,
      consumidor: "Inicializacion del motor (el propio contenedor de PostgreSQL)",
      // No sale del nodo: solo lo usa el punto de entrada de la imagen al arrancar, y
      // el guion `bootstrap-secretos.sh` cuando genera lo que falta. Rotar exigiria
      // volver a autenticar contra un motor cuyo superusuario es este mismo — se anota
      // como excepcion en el documento, no en el tipo.
      periodicidad: "nunca-desde-el-nodo",
      rolDePostgres: "postgres",
    },
    {
      rol: "sgtm-owner",
      secreto: nombres.owner,
      clave: CLAVES.owner,
      consumidor: "Los dos Jobs: migracion e implantacion. Nunca el Deployment de la aplicacion",
      periodicidad: "trimestral",
      rolDePostgres: "sgtm_owner",
    },
    {
      rol: "sgtm-app",
      secreto: nombres.aplicacion,
      clave: CLAVES.aplicacion,
      consumidor: "El Deployment de la aplicacion, perfil web y perfil batch",
      periodicidad: "semestral",
      rolDePostgres: "sgtm_app",
      requiereReinicioDe: servicioDeAplicacion(environment),
    },
    {
      rol: "keycloak-admin",
      secreto: nombres.identidad,
      clave: CLAVES.administradorDeIdentidad,
      consumidor: "El propio Keycloak (bootstrap admin), y el Job que reconcilia el realm",
      // No es una clave de PostgreSQL: rotarla es un ALTER USER de Keycloak (kcadm.sh),
      // no un ALTER ROLE. Queda fuera de rotar-clave.sh a proposito; el procedimiento
      // manual esta en INF-06.
      periodicidad: "anual",
    },
    {
      rol: "keycloak-base",
      secreto: nombres.identidad,
      clave: CLAVES.baseDeIdentidad,
      consumidor: "Keycloak, para conectarse a su propia base",
      periodicidad: "semestral",
      rolDePostgres: ROL_DE_IDENTIDAD,
      // Su propia base, y nunca la del padron (30-base-de-keycloak.sh lo revoca).
      baseDeDatos: "keycloak",
      requiereReinicioDe: servicioDeIdentidad(environment),
    },
    {
      rol: "sgtm-respaldo",
      secreto: nombres.respaldo,
      clave: CLAVES.respaldo,
      consumidor: "El CronJob de respaldo base (issue #155): solo pg_backup_start/stop",
      periodicidad: "semestral",
      rolDePostgres: "sgtm_respaldo",
      // `postgres`, no `sgtm`: no tiene CONNECT sobre el padron a proposito (INF-08, #155).
      baseDeDatos: "postgres",
      // Sin Deployment que reiniciar: el CronJob crea un pod nuevo en cada corrida, y
      // ese pod lee el Secret que este en ese momento — igual que sgtm-owner con sus
      // dos Jobs.
    },
    {
      rol: "respaldo-cifrado",
      secreto: nombres.respaldo,
      clave: CLAVES.cifradoDeRespaldo,
      consumidor: "El contenedor de PostgreSQL (archive_command/restore_command) y el CronJob de respaldo",
      // No es una clave de un rol de PostgreSQL: es la clave simetrica con que wal-g
      // cifra cada backup y cada segmento de WAL. Rotarla de rutina inutilizaria los
      // respaldos ya escritos con la clave vieja -no hay `ALTER ROLE` que los
      // vuelva a cifrar-, asi que no tiene periodicidad fija: se rota solo si se
      // sospecha que se filtro, y el procedimiento (documentado en INF-06/INF-08)
      // exige conservar la clave vieja hasta que caduque el ultimo respaldo cifrado
      // con ella.
      periodicidad: "tras-incidente",
      // Sin rolDePostgres: rotar-clave.sh la rechaza a proposito, igual que hace con
      // keycloak-admin. No es un ALTER ROLE.
      //
      // El motor SI necesita reiniciarse para leer un valor nuevo -es una variable
      // de entorno del Deployment, y las lee al arrancar el proceso, no en caliente-.
      // El CronJob no aparece aqui porque no hace falta decirlo dos veces: crea un
      // pod nuevo en cada corrida.
      requiereReinicioDe: servicioDeBaseDeDatos(environment),
    },
    {
      rol: "sgtm-monitor",
      secreto: nombres.monitoreo,
      clave: CLAVES.monitoreo,
      consumidor: "postgres-exporter, el sidecar del motor (issue #156): solo pg_monitor",
      periodicidad: "semestral",
      rolDePostgres: "sgtm_monitor",
      // `pg_monitor` son vistas del cluster; el exportador se conecta a `postgres`.
      baseDeDatos: "postgres",
      // El sidecar vive en el MISMO pod que postgres: reiniciar el motor lo
      // reinicia a el tambien, asi que no hace falta nombrarlo aparte.
      requiereReinicioDe: servicioDeBaseDeDatos(environment),
    },
    {
      rol: "grafana-admin",
      secreto: nombres.grafana,
      clave: CLAVES.grafana,
      consumidor: "Grafana (issue #156). Nunca esta en una IngressRoute: se administra por el tunel SSH",
      periodicidad: "anual",
      // No es un rol de PostgreSQL: es la cuenta de administrador de Grafana.
      requiereReinicioDe: servicioDeGrafana(environment),
    },
    {
      rol: "postgres-carga",
      secreto: nombres.carga,
      clave: CLAVES.carga,
      consumidor: "Solo los Jobs de carga de parametros (infra/carga-de-datos/publicar-parametros.sh, " +
        "publicar-cuadros.sh); nunca el Deployment de la aplicacion",
      // Credencial privilegiada de escritura sobre parametro_tributario y las tablas
      // de valuacion nacionales, igual que sgtm-owner: trimestral, no semestral.
      periodicidad: "trimestral",
      rolDePostgres: "rol_carga_parametros",
      // Sin requiereReinicioDe: nadie tiene un pod en marcha leyendo esto. Cada Job
      // es de un solo uso y lee el Secret fresco al crearse, igual que sgtm-owner.
    },
    {
      rol: "postgres-ingestor-catastro",
      secreto: nombres.ingestorDeCatastro,
      clave: CLAVES.ingestorDeCatastro,
      consumidor:
        "Solo el proceso que aplica en `rentas` los eventos de `catastro` (ADR-0027): escribe " +
        "predio_ref, ficha_ref y las dos de valuacion; nunca el Deployment de la aplicacion",
      // Credencial privilegiada de escritura sobre la proyeccion del padron, igual que
      // sgtm-owner y postgres-carga: trimestral, no semestral.
      periodicidad: "trimestral",
      rolDePostgres: "rol_ingestor_catastro",
      // La base de `rentas`, no la del monolito: lo que escribe es la copia local que
      // `rentas` lee. Sin este dato, comprobar «sirve esta credencial» conectando al padron
      // del monolito daria un rojo falso, que es el matiz que #435 tuvo que aprender.
      baseDeDatos: "rentas",
      // HUECO DECLARADO (C-7 §6): el proceso que consume esta credencial NO EXISTE todavia.
      // ADR-0027 declara el buzon de eventos y P5C lo dejo escrito: «no hay cola, no hay
      // suscripcion, no hay reintento». La clave entra al inventario igualmente, y a
      // proposito: un rol con privilegios de escritura sobre un padron y sin clave no es
      // «seguro», es un rol que nadie puede rotar ni auditar, y el dia que el proceso
      // aparezca su despliegue no deberia tener que tocar este archivo.
    },
  ];
}

/**
 * Los secretos de arranque de la infraestructura: SI viven en Pulumi, cifrados en la
 * configuracion del stack (`ADR-0011` §3). No son secretos de la aplicacion — son lo que
 * hace falta para que Pulumi **cree** el mecanismo, y por eso la excepcion no contradice
 * la regla: kubeconfig, clave SSH y token no abren el padron de ninguna municipalidad
 * por si solos.
 */
export const SECRETOS_DE_ARRANQUE = [
  { clave: "kubeconfig", donde: "pulumi config (cifrado)", periodicidad: "semestral" as Periodicidad },
  { clave: "backupAccessKeyId", donde: "pulumi config (cifrado)", periodicidad: "semestral" as Periodicidad },
  {
    clave: "backupSecretAccessKey",
    donde: "pulumi config (cifrado)",
    periodicidad: "semestral" as Periodicidad,
  },
  {
    clave: "registryPullToken",
    donde: "pulumi config (cifrado)",
    periodicidad: "semestral" as Periodicidad,
  },
  { clave: "PULUMI_ACCESS_TOKEN", donde: "GitHub Actions secret", periodicidad: "semestral" as Periodicidad },
  { clave: "SSH_PRIVATE_KEY", donde: "GitHub Actions secret", periodicidad: "semestral" as Periodicidad },
] as const;
