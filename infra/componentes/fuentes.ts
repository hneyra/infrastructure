import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Los archivos del repositorio que estos manifiestos montan **sin copiarlos**.
 *
 * `crear-roles.sql` y `20-asignar-claves.sh` ya existen y ya se ejecutan: el compose
 * los monta en la inicializacion del motor. En el clúster hay que **reproducir eso, no
 * reinventarlo** (issue #149), asi que se leen de donde estan y entran a un `ConfigMap`
 * tal cual. Una copia en `infra/` seria un segundo sitio donde olvidar que el rol no
 * puede ser superusuario, y las dos copias se separarian el dia que alguien toque una.
 *
 * `verificaciones/componentes.test.ts` comprueba que lo que va al `ConfigMap` es
 * **identico** al archivo del repositorio: si alguien pega una version editada, se pone
 * rojo.
 */

/**
 * La raiz de `infra/`, buscada hacia arriba desde el directorio de trabajo.
 *
 * Ni `__dirname` ni `import.meta.url`: el mismo archivo lo carga Pulumi como CommonJS y
 * vitest como modulo ES, y cada uno tiene el suyo. Lo que ambos comparten es que corren
 * dentro del arbol de `infra/`, asi que se busca el `Pulumi.yaml` hacia arriba. Si no
 * aparece, el error lo dice con todas sus letras en vez de leer un archivo vacio.
 */
export function raizDeInfra(desde: string = process.cwd()): string {
  let actual = resolve(desde);
  for (;;) {
    if (existsSync(join(actual, "Pulumi.yaml"))) return actual;
    const padre = dirname(actual);
    if (padre === actual) {
      throw new Error(
        `No se encontro «Pulumi.yaml» subiendo desde «${desde}». Los manifiestos leen ` +
          "archivos del repositorio (crear-roles.sql, el guion de claves) y necesitan " +
          "saber donde esta la raiz de infra/.",
      );
    }
    actual = padre;
  }
}

/** La raiz del repositorio: el padre de `infra/`. */
export function raizDelRepositorio(): string {
  return dirname(raizDeInfra());
}

function leer(ruta: string): string {
  if (!existsSync(ruta)) {
    throw new Error(
      `Falta «${ruta}». Los manifiestos de la base montan los guiones del repositorio ` +
        "en vez de copiarlos (issue #149): si el archivo se movio, hay que actualizar " +
        "esta ruta, no pegar una copia.",
    );
  }
  return readFileSync(ruta, "utf8");
}

/**
 * `crear-roles.sql`, del modulo del esquema.
 *
 * Es el mismo archivo que monta el compose y el mismo que la prueba de aislamiento da
 * por hecho. Crea los cuatro roles `NOLOGIN`, `NOSUPERUSER` y `NOBYPASSRLS`, y las
 * extensiones que la migracion necesita.
 */
export function crearRolesSql(): string {
  return leer(
    join(
      raizDelRepositorio(),
      "backend/sgtm-esquema/src/main/resources/db/roles/crear-roles.sql",
    ),
  );
}

/**
 * `20-asignar-claves.sh`, de la inicializacion del motor del compose.
 *
 * Lee `KAMAYUK_CLAVE_OWNER` y `KAMAYUK_CLAVE_APP` del entorno; en el compose salen del `.env`
 * y aqui de un `Secret`. El guion no cambia, que es justo lo que se quiere.
 */
export function asignarClavesSh(): string {
  return leer(join(raizDelRepositorio(), "despliegue/inicializacion-del-motor/20-asignar-claves.sh"));
}

/**
 * `30-base-de-keycloak.sh`. Este si es de `infra/`, y tiene motivo.
 *
 * El compose no lo necesita: alli Keycloak corre `start-dev` y guarda su base dentro
 * del contenedor. En el clúster Keycloak tiene base propia (issue #151), y crearla es
 * parte de inicializar el motor.
 */
export function baseDeKeycloakSh(): string {
  return leer(join(raizDeInfra(), "componentes/inicializacion/30-base-de-keycloak.sh"));
}

/**
 * El realm versionado, tal cual lo usa el compose.
 *
 * En el clúster no se importa al arrancar: lo aplica un Job con `partialImport` cada
 * vez que el contenido cambia (ver `Identidad.ts`). El archivo es el mismo.
 */
export function realmSgtmJson(): string {
  return leer(join(raizDelRepositorio(), "despliegue/identidad/realm-sgtm.json"));
}

/**
 * El realm del **ciudadano**, versionado igual que el de funcionarios (ADR-0020).
 *
 * Son dos archivos y no dos secciones de uno porque son **dos emisores**: es lo
 * que separa a las dos poblaciones estructuralmente —el backend monta dos cadenas
 * de seguridad, cada una validando contra uno— y lo que hace que un token de
 * funcionario no autentique en `/portal/**` ni al reves.
 */
export function realmCiudadanoJson(): string {
  return leer(join(raizDelRepositorio(), "despliegue/identidad/realm-sgtm-ciudadano.json"));
}

/** El guion que reconcilia el realm contra Keycloak. Vive en `infra/`. */
export function reconciliarRealmSh(): string {
  return leer(join(raizDeInfra(), "componentes/identidad/reconciliar-realm.sh"));
}

/**
 * El guion que reconcilia usuarios y grupos contra Keycloak (ADR-0012).
 *
 * Vive en `despliegue/` y no en `infra/` —al reves que `reconciliar-realm.sh`—
 * porque el compose SI lo usa: alli el alta de usuarios pasa por el mismo guion,
 * no por `--import-realm`. Un solo guion, dos modos (ver su cabecera).
 */
export function reconciliarIdentidadesSh(): string {
  return leer(join(raizDelRepositorio(), "despliegue/identidad/reconciliar-identidades.sh"));
}

/** Un archivo `municipalidades/<ubigeo>.json` del repositorio, ya leido. */
export interface FuenteDeMunicipalidad {
  /** El nombre del archivo sin extension: tiene que ser el ubigeo. */
  ubigeo: string;
  /** El contenido crudo, para que `Identidad.ts` lo parsee y lo valide. */
  contenido: string;
}

/**
 * Los `despliegue/identidad/municipalidades/*.json`: la fuente versionada de las
 * personas y el grupo de cada municipalidad (ADR-0012). Sin credenciales.
 *
 * `Identidad.ts` los deriva a un `identidades.tsv` que monta en el `ConfigMap`;
 * el Job los aplica con el mismo guion que el compose.
 */
export function municipalidadesJson(): FuenteDeMunicipalidad[] {
  const carpeta = join(raizDelRepositorio(), "despliegue/identidad/municipalidades");
  if (!existsSync(carpeta)) {
    throw new Error(
      `Falta «${carpeta}». Es la fuente versionada de usuarios y grupos por ` +
        "municipalidad (ADR-0012); si se movio, hay que actualizar esta ruta.",
    );
  }
  return readdirSync(carpeta)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((n) => ({
      ubigeo: n.replace(/\.json$/, ""),
      contenido: readFileSync(join(carpeta, n), "utf8"),
    }));
}

/**
 * Los `despliegue/identidad/ciudadanos/*.json`: la fuente versionada de los ciudadanos
 * que cada municipalidad **enrolo en ventanilla** (ADR-0020 §5, #415). Sin credenciales.
 *
 * Es el hermano de {@link municipalidadesJson} para la otra poblacion, y se lee igual
 * —crudo, para que `Identidad.ts` lo parsee y lo valide— por el mismo motivo: la imagen
 * de Keycloak no trae con que analizar JSON, y validarlo aqui lo deja cubierto por
 * `componentes.test.ts`.
 *
 * A diferencia de aquel, la carpeta puede no traer archivo para el ubigeo implantado: una
 * municipalidad que todavia no enrolo a nadie es el estado de partida de todas, y no un
 * despliegue mal armado.
 */
export function ciudadanosJson(): FuenteDeMunicipalidad[] {
  const carpeta = join(raizDelRepositorio(), "despliegue/identidad/ciudadanos");
  if (!existsSync(carpeta)) {
    throw new Error(
      `Falta «${carpeta}». Es la fuente versionada de los ciudadanos enrolados en ` +
        "ventanilla (ADR-0020 §5); si se movio, hay que actualizar esta ruta. Una " +
        "municipalidad sin nadie enrolado declara `ciudadanos: []`, que no es lo mismo " +
        "que no tener archivo.",
    );
  }
  return readdirSync(carpeta)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((n) => ({
      ubigeo: n.replace(/\.json$/, ""),
      contenido: readFileSync(join(carpeta, n), "utf8"),
    }));
}

/**
 * `05-crear-bases.sh` y `06-roles-de-los-sistemas.sh`, de la inicializacion del motor (C-10, C-14).
 *
 * **Los mismos archivos que monta el compose**, no copias. El primero crea las cuatro bases del
 * producto y las extensiones que cada una DECLARA en su propio `crear-roles.sql`; el segundo
 * aplica ese archivo entero contra su base, que es lo que le da a `sgtm_owner` el `CREATE` sobre
 * `public` sin el cual la migracion muere con «42501 permission denied for schema public»
 * —medido contra PostgreSQL 16.15— y lo que le quita a PUBLIC el `CONNECT` que PostgreSQL le
 * regala al crear una base.
 */
export function crearBasesSh(): string {
  return leer(join(raizDelRepositorio(), "despliegue/inicializacion-del-motor/05-crear-bases.sh"));
}

export function rolesDeLosSistemasSh(): string {
  return leer(
    join(raizDelRepositorio(), "despliegue/inicializacion-del-motor/06-roles-de-los-sistemas.sh"),
  );
}

/**
 * `lib-extensiones.sh`: la unica implementacion de «que cuenta como extension declarada» (C-10).
 *
 * La comparten los dos guiones de arriba y `crear-extensiones.sh`. Dos copias del mismo `grep`
 * serian dos sitios donde una extension se puede dejar de ver, que es el defecto un escalon mas
 * abajo.
 */
export function libExtensionesSh(): string {
  return leer(join(raizDelRepositorio(), "despliegue/inicializacion-del-motor/lib-extensiones.sh"));
}

/**
 * El `crear-roles.sql` de un sistema, leido de SU clon hermano.
 *
 * Es el mismo archivo que su modulo del esquema versiona y que su prueba de aislamiento aplica.
 * Se lee de alli y no se copia por lo mismo que `crearRolesSql`: una copia aqui seria un segundo
 * sitio donde olvidar que el rol no puede ser superusuario.
 *
 * **Exige el clon hermano y no se salta si falta.** Un `ConfigMap` compuesto sin el dejaria una
 * base sin sus `GRANT` y sin sus extensiones, y eso no falla al crearse: falla a mitad de la
 * migracion, una hora despues, con un error que no se parece a su causa (#742).
 */
export function crearRolesDeSistema(sistema: string): string {
  const raiz = resolve(raizDelRepositorio(), "..", sistema);
  const ruta = join(
    raiz,
    "backend",
    `kamayuk-${sistema}-esquema`,
    "src/main/resources/db/roles/crear-roles.sql",
  );
  if (!existsSync(ruta)) {
    throw new Error(
      `No esta «${ruta}», el \`crear-roles.sql\` de «${sistema}». Sin el, su base se crearia ` +
        "sin los privilegios que su propio esquema declara y la migracion moriria con «42501 " +
        "permission denied for schema public».\n" +
        `  Remedio: git clone https://github.com/hneyra/${sistema} ${raiz}`,
    );
  }
  return readFileSync(ruta, "utf8");
}

/**
 * `40-rol-de-respaldo.sh` (issue #155). Este tambien es de `infra/`: el compose no
 * archiva WAL ni respalda fuera del contenedor, asi que no necesita el rol.
 */
export function rolDeRespaldoSh(): string {
  return leer(join(raizDeInfra(), "componentes/inicializacion/40-rol-de-respaldo.sh"));
}

/**
 * `50-rol-de-monitoreo.sh` (issue #156). Tambien de `infra/`: en el compose nadie
 * recolecta metricas, asi que no hace falta el rol.
 */
export function rolDeMonitoreoSh(): string {
  return leer(join(raizDeInfra(), "componentes/inicializacion/50-rol-de-monitoreo.sh"));
}

/**
 * Las reglas de alerta (issue #156). Estatico y compartido entre `stg` y `prod`: ver
 * el comentario del propio archivo.
 */
export function alertasYml(): string {
  return leer(join(raizDeInfra(), "observabilidad/alertas.yml"));
}

/** El tablero de Grafana. Un solo archivo, con una fila por area (JVM, PostgreSQL, nodo, pods). */
export function tableroResumenOperativoJson(): string {
  return leer(join(raizDeInfra(), "observabilidad/dashboards/resumen-operativo.json"));
}

/**
 * `nginx.conf` de la interfaz, **el del repositorio**.
 *
 * La imagen ya lo trae dentro, pero apunta al `aplicacion:8080` de la red del compose y
 * en el clúster el servicio se llama de otra manera. `Aplicacion.ts` le cambia esa
 * linea y monta el resultado; lo que **no** se hace es escribir aqui una segunda
 * configuracion de nginx, porque entonces la del compose y la del clúster se separarian
 * el dia que alguien toque una —y es exactamente la trampa que `ADR-0011` anota entre
 * los costos de tener dos formas de levantar el sistema—.
 */
export function nginxConf(): string {
  return leer(join(raizDelRepositorio(), "frontend/nginx.conf"));
}
