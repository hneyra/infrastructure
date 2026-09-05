import {
  secretos as nombresDeSecretos,
  CLAVES,
  ROL_DE_IDENTIDAD,
  servicioDeAplicacion,
  servicioDeBaseDeDatos,
  servicioDeGrafana,
  servicioDeIdentidad,
} from "./convenciones";
import { namespaceName, type Environment, type Invariants } from "../config";
import { SISTEMAS } from "../descriptor/sistemas";
import { entornoDelAmbiente } from "../herramientas/emitir-manifiestos";

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
  /** Identificador corto, el que usan los guiones de bash (`--rol kamayuk-app`). */
  rol: string;
  /**
   * El espacio de nombres donde vive este `Secret`.
   *
   * Se declara desde C-17 y no se supone. Hasta entonces `bootstrap-secretos.sh` recibia UN
   * `--namespace` y creaba todo alli, lo cual era cierto mientras el unico consumidor fuera el
   * monolito. Desde ADR-0031 cada sistema tiene el suyo, **y un `Secret` no cruza namespaces**:
   * un pod solo puede montar los de su propio espacio. El sintoma de suponerlo es un pod en
   * `Pending` con el `Secret` ausente en su evento — que no es un error del despliegue, es una
   * espera indefinida.
   */
  namespace: string;
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
   * como pod en marcha. `undefined` cuando nadie lo necesita asi: `kamayuk-owner` solo lo
   * leen los dos Jobs, y un Job nuevo ya lee el `Secret` actualizado al crearse — no
   * hay pod en marcha que reprogramar.
   */
  requiereReinicioDe?: string;
  /**
   * La base a la que ese rol se conecta de verdad, y **no siempre es el padron**
   * (issue #435).
   *
   * `kamayuk_respaldo` no tiene `CONNECT` sobre `sgtm` a proposito —`pg_backup_start` y
   * `pg_backup_stop` son operaciones del cluster, no de una base, y una credencial de
   * mas apuntando al padron es una credencial de mas (#155)—, y `keycloak` tiene la
   * suya. Sin este dato, comprobar «¿sirve esta credencial?» conectando a `sgtm` da
   * un rojo falso justo en los dos roles cuyo aislamiento es deliberado: paso al
   * escribir `asignar-claves.sh`, y el rojo parecia el mismo que el de un rol sin
   * `LOGIN`.
   */
  baseDeDatos?: string;
  /**
   * De donde se COPIA este valor, cuando no se genera (C-17, punto 4).
   *
   * ## Por que existe, y por que no son entradas independientes
   *
   * Los cuatro sistemas se conectan con `kamayuk_app` y migran con `kamayuk_owner`, y esos son roles
   * **del clúster**: los crea el `crear-roles.sql` de cada sistema con el mismo nombre, y
   * PostgreSQL le da a un rol **una** contrasena. De modo que `kamayuk-rentas-<amb>-app` y
   * `kamayuk-catastro-<amb>-app` no pueden tener valores distintos: si los tuvieran, a lo sumo
   * uno de los cuatro podria conectarse, y los otros tres darian «password authentication
   * failed» — un rojo que se lee como credencial mal generada y es un modelo mal entendido.
   *
   * Por eso no son secretos nuevos: son **el mismo valor publicado en el namespace de quien lo
   * consume**. Generarlos por separado seria pedirle al generador que produzca cuatro claves
   * distintas para un rol que solo admite una, y `verificar-claves-distintas.sh` exigiria
   * justamente lo contrario de lo que hace falta.
   *
   * Lo que NO es espejo: una credencial que no es de un rol del motor —`kamayuk-rentas-<amb>-
   * catastro`, con la que el ingestor pide el buzon— se genera como cualquier otra, porque no
   * hay ningun valor del que sea copia.
   *
   * ## Lo que cuesta, dicho aqui
   *
   * Un espejo **converge a su origen en cada corrida** de `bootstrap-secretos.sh`, no solo
   * cuando falta: el `Secret` de la plataforma es la fuente de verdad y los demas son copias. La
   * consecuencia hay que saberla: tras `rotar-clave.sh` los espejos quedan con el valor viejo
   * hasta la siguiente corrida del bootstrap, asi que rotar `kamayuk-app` o `kamayuk-owner` incluye
   * volver a correrlo (INF-06).
   */
  espejoDe?: { secreto: string; clave: string };
}

/**
 * El inventario completo de un ambiente.
 *
 * Once entradas, nueve `Secret` distintos —`kamayuk-<amb>-keycloak` y
 * `kamayuk-<amb>-postgres-respaldo` guardan dos claves cada uno— con once valores,
 * **ninguno repetido**: es la comprobacion que pide el issue, no solo «roles
 * distintos» sino «claves distintas». La prueba en `verificaciones/secretos.
 * test.ts` lo exige contando entradas unicas por `secreto`+`clave`, y
 * `completar-secreto.ts` lo hace estructuralmente imposible de incumplir al generar.
 */
export function inventarioDeSecretos(environment: Environment): EntradaDeSecreto[] {
  const nombres = nombresDeSecretos(environment);
  // Los once de la plataforma viven todos en su namespace. Los de los cuatro sistemas
  // no —cada uno en el suyo— y por eso el campo se declara en vez de suponerse.
  const enLaPlataforma = namespaceName(environment);

  return [
    {
      rol: "postgres-superusuario",
      namespace: enLaPlataforma,
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
      rol: "kamayuk-owner",
      namespace: enLaPlataforma,
      secreto: nombres.owner,
      clave: CLAVES.owner,
      consumidor: "Los dos Jobs: migracion e implantacion. Nunca el Deployment de la aplicacion",
      periodicidad: "trimestral",
      rolDePostgres: "kamayuk_owner",
    },
    {
      rol: "kamayuk-app",
      namespace: enLaPlataforma,
      secreto: nombres.aplicacion,
      clave: CLAVES.aplicacion,
      consumidor: "El Deployment de la aplicacion, perfil web y perfil batch",
      periodicidad: "semestral",
      rolDePostgres: "kamayuk_app",
      requiereReinicioDe: servicioDeAplicacion(environment),
    },
    {
      rol: "keycloak-admin",
      namespace: enLaPlataforma,
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
      namespace: enLaPlataforma,
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
      rol: "kamayuk-respaldo",
      namespace: enLaPlataforma,
      secreto: nombres.respaldo,
      clave: CLAVES.respaldo,
      consumidor: "El CronJob de respaldo base (issue #155): solo pg_backup_start/stop",
      periodicidad: "semestral",
      rolDePostgres: "kamayuk_respaldo",
      // `postgres`, no `sgtm`: no tiene CONNECT sobre el padron a proposito (INF-08, #155).
      baseDeDatos: "postgres",
      // Sin Deployment que reiniciar: el CronJob crea un pod nuevo en cada corrida, y
      // ese pod lee el Secret que este en ese momento — igual que kamayuk-owner con sus
      // dos Jobs.
    },
    {
      rol: "respaldo-cifrado",
      namespace: enLaPlataforma,
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
      rol: "kamayuk-monitor",
      namespace: enLaPlataforma,
      secreto: nombres.monitoreo,
      clave: CLAVES.monitoreo,
      consumidor: "postgres-exporter, el sidecar del motor (issue #156): solo pg_monitor",
      periodicidad: "semestral",
      rolDePostgres: "kamayuk_monitor",
      // `pg_monitor` son vistas del cluster; el exportador se conecta a `postgres`.
      baseDeDatos: "postgres",
      // El sidecar vive en el MISMO pod que postgres: reiniciar el motor lo
      // reinicia a el tambien, asi que no hace falta nombrarlo aparte.
      requiereReinicioDe: servicioDeBaseDeDatos(environment),
    },
    {
      rol: "grafana-admin",
      namespace: enLaPlataforma,
      secreto: nombres.grafana,
      clave: CLAVES.grafana,
      consumidor: "Grafana (issue #156). Nunca esta en una IngressRoute: se administra por el tunel SSH",
      periodicidad: "anual",
      // No es un rol de PostgreSQL: es la cuenta de administrador de Grafana.
      requiereReinicioDe: servicioDeGrafana(environment),
    },
    {
      rol: "postgres-carga",
      namespace: enLaPlataforma,
      secreto: nombres.carga,
      clave: CLAVES.carga,
      consumidor: "Solo los Jobs de carga de parametros (infra/carga-de-datos/publicar-parametros.sh, " +
        "publicar-cuadros.sh); nunca el Deployment de la aplicacion",
      // Credencial privilegiada de escritura sobre parametro_tributario y las tablas
      // de valuacion nacionales, igual que kamayuk-owner: trimestral, no semestral.
      periodicidad: "trimestral",
      rolDePostgres: "rol_carga_parametros",
      // Sin requiereReinicioDe: nadie tiene un pod en marcha leyendo esto. Cada Job
      // es de un solo uso y lee el Secret fresco al crearse, igual que kamayuk-owner.
    },
    {
      rol: "postgres-ingestor-catastro",
      namespace: enLaPlataforma,
      secreto: nombres.ingestorDeCatastro,
      clave: CLAVES.ingestorDeCatastro,
      consumidor:
        "Solo el proceso que aplica en `rentas` los eventos de `catastro` (ADR-0027): escribe " +
        "predio_ref, ficha_ref y las dos de valuacion; nunca el Deployment de la aplicacion",
      // Credencial privilegiada de escritura sobre la proyeccion del padron, igual que
      // kamayuk-owner y postgres-carga: trimestral, no semestral.
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
 * El inventario COMPLETO del ambiente: la plataforma y los cuatro sistemas (C-17, punto 4).
 *
 * ## El hueco que cierra, medido
 *
 * `yarn secretos --ambiente stg` declaraba **nueve** `Secret`, los nueve del monolito. Los
 * manifiestos de los cuatro sistemas piden **diez** —`kamayuk-<s>-<amb>-app` y `-owner` por
 * sistema, mas `kamayuk-rentas-<amb>-ingestor` y `-catastro`—, y **la interseccion era cero**.
 * `bootstrap-secretos.sh` corria, decia «Listo» y creaba cero de los diez: una herramienta que
 * contesta que si porque no esta mirando, la misma forma exacta que `yarn capacidad` tenia antes
 * de C-16.
 *
 * El sintoma tampoco es un error: un pod cuyo `secretKeyRef` no existe se queda en `Pending`,
 * con el `Secret` ausente en su evento y nada en el registro del despliegue.
 *
 * ## De donde sale, y por que de ahi
 *
 * De `claves()` de cada descriptor, que es donde ADR-0031 dice que un sistema declara lo que
 * necesita. No se escribe aqui una segunda lista: seria el mismo desajuste que este hueco es,
 * con otro par de nombres.
 *
 * Y las que son clave de un rol del motor se marcan como **espejo** del `Secret` de la
 * plataforma que ya guarda ese valor. El porque —un rol del clúster tiene UNA contrasena— esta
 * en `EntradaDeSecreto.espejoDe`.
 */
export function inventarioDelAmbiente(invariantes: Invariants): EntradaDeSecreto[] {
  const plataforma = inventarioDeSecretos(invariantes.environment);
  const porRol = new Map(
    plataforma.filter((e) => e.rolDePostgres !== undefined).map((e) => [e.rolDePostgres!, e]),
  );
  const entornoDe = entornoDelAmbiente(invariantes);

  const deLosSistemas = SISTEMAS.flatMap(({ descriptor }) => {
    const entorno = entornoDe(descriptor.sistema);
    return descriptor.claves(entorno).map((c): EntradaDeSecreto => {
      const origen = c.rol === undefined ? undefined : porRol.get(c.rol);
      if (c.rol !== undefined && origen === undefined) {
        throw new Error(
          `[${descriptor.sistema}] la clave «${c.nombre}» dice ser del rol «${c.rol}», y este ` +
            "ambiente no tiene ninguna entrada para el. Un rol del motor cuya clave no esta en " +
            "el inventario de la plataforma no lo genera nadie, no lo rota nadie y " +
            "`asignar-claves.sh` no lo lleva a la base: existiria con `GRANT` puestos y sin " +
            "poder abrir una sesion, que es lo que #435 encontro con `rol_carga_parametros`.",
        );
      }
      return {
        rol: `${descriptor.sistema}-${c.nombre.split("-").pop()}`,
        namespace: entorno.namespace,
        secreto: c.nombre,
        clave: c.clave,
        consumidor: `${descriptor.sistema}: ${c.proposito}`,
        periodicidad: c.rotacion === "nunca" ? "tras-incidente" : c.rotacion,
        // El rol del motor NO se repite aqui a proposito: quien lo lleva a la base es
        // `asignar-claves.sh`, y hacerlo desde cinco entradas distintas seria cinco `ALTER ROLE`
        // sobre el mismo rol con valores que tienen que ser el mismo. El origen ya lo dice.
        ...(origen === undefined
          ? {}
          : { espejoDe: { secreto: origen.secreto, clave: origen.clave } }),
      };
    });
  });

  return [...plataforma, ...deLosSistemas];
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
