#!/usr/bin/env bash
# El motor del cluster, levantado de verdad y comprobado (issue #149).
#
# Toma **los mismos guiones de inicializacion que se montarian en k3s** —sacados del
# propio manifiesto, no de una copia—, levanta un PostgreSQL con ellos y comprueba
# contra el proceso en marcha lo que el issue #149 exige:
#
#   1. Los cuatro roles existen, y ninguno es superusuario ni omite RLS.
#   2. kamayuk_owner, kamayuk_app y rol_carga_parametros pueden conectarse (issue #387);
#      kamayuk_readonly no.
#   3. Con las credenciales de la aplicacion o de la carga, `CREATE TABLE` **falla**.
#   4. Los cuatro roles del SGTM conservan el CONNECT sobre la base del padron.
#   5. Keycloak tiene base propia, y NO puede conectarse a la del padron.
#   6. El rol del respaldo puede pg_backup_start/stop y NADA mas (issue #155).
#   7. El rol de monitoreo tiene pg_monitor y NADA mas (issue #156).
#   8. Reiniciar el motor deja los datos donde estaban.
#
# Lo que esto verifica es el CONTENIDO de la inicializacion —los roles, sus atributos,
# quien puede conectarse a que—, que es donde esta el riesgo y no cambia porque el
# proceso corra en un pod. Lo que Kubernetes anade encima —volumen, sondas, estrategia—
# lo cubren la auditoria y `componentes.test.ts`. Decirlo asi es mas honesto que llamar a
# esto «probado en el cluster».
#
# La comprobacion 4 no es decorativa: `30-base-de-keycloak.sh` revoca el CONNECT que
# PUBLIC tiene por omision sobre la base del padron. Si no volviera a concederselo a los
# cuatro roles, la aplicacion entera se quedaria sin poder conectarse — y el sintoma
# aparece en el arranque del primer despliegue, no aqui. Esta prueba es lo que impide
# que ese cambio pase en verde.
#
#   uso: verificaciones/motor/verificar-el-motor.sh [--ambiente stg|prod]
#
# Levanta el motor con Docker, que es lo fiel —la misma imagen que declara el
# manifiesto—. Si no hay Docker utilizable pero si un PostgreSQL de la misma version
# mayor instalado, usa una instancia local temporal y **lo dice**: los guiones son los
# mismos y el orden tambien, pero la imagen no. CI usa siempre el camino de Docker. La
# mecanica de levantar el motor vive en `lib-motor-local.sh`, compartida con
# `secretos/verificar-rotacion.sh` (issue #154).
set -euo pipefail

AMBIENTE=stg
CON_AISLAMIENTO=no
while [ $# -gt 0 ]; do
    case "$1" in
        --ambiente) AMBIENTE=${2:?falta el valor de --ambiente}; shift 2 ;;
        # Ejecuta ademas `verificarAislamiento` CONTRA ESTA INSTANCIA, que es el primer
        # criterio de aceptacion del issue #149. Necesita el JDK del backend.
        --con-aislamiento) CON_AISLAMIENTO=si; shift ;;
        *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
    esac
done

AQUI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
INFRA=$(cd "$AQUI/../.." && pwd)
TRABAJO=$(mktemp -d)

trap 'motor_detener 2>/dev/null || true; rm -rf "$TRABAJO"' EXIT

# shellcheck source=lib-motor-local.sh
source "$AQUI/lib-motor-local.sh"

comoSuperusuario() { motor_como_superusuario "$@"; }

# ── 3. Los cuatro roles, con sus atributos ───────────────────────────────────
echo "· Los cuatro roles"
for rol in kamayuk_owner kamayuk_app kamayuk_readonly rol_carga_parametros; do
    atributos=$(comoSuperusuario \
        "SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = '$rol'")
    [ -n "$atributos" ] || { echo "FALLO: el rol $rol no existe" >&2; exit 1; }
    case "$atributos" in
        f\|f\|*) ;;
        *) echo "FALLO: el rol $rol es superusuario o omite RLS: $atributos" >&2; exit 1 ;;
    esac
    echo "  $rol → rolsuper|rolbypassrls|rolcanlogin = $atributos"
done

[ "$(comoSuperusuario "SELECT rolcanlogin FROM pg_roles WHERE rolname='kamayuk_owner'")" = "t" ] \
    || { echo "FALLO: kamayuk_owner no puede conectarse; el migrador no podria migrar" >&2; exit 1; }
[ "$(comoSuperusuario "SELECT rolcanlogin FROM pg_roles WHERE rolname='kamayuk_app'")" = "t" ] \
    || { echo "FALLO: kamayuk_app no puede conectarse; la aplicacion no arrancaria" >&2; exit 1; }
# rol_carga_parametros SI tiene LOGIN (issue #387): es la unica credencial que
# publicar-parametros.sh/publicar-cuadros.sh usan, y sin conexion esos Jobs no podrian
# correr contra ningun ambiente real.
[ "$(comoSuperusuario "SELECT rolcanlogin FROM pg_roles WHERE rolname='rol_carga_parametros'")" = "t" ] \
    || { echo "FALLO: rol_carga_parametros no puede conectarse" >&2; exit 1; }
# Un rol que puede iniciar sesion sin que nadie lo use es una credencial mas que rotar y
# vigilar: kamayuk_readonly se queda NOLOGIN hasta que haga falta.
[ "$(comoSuperusuario "SELECT rolcanlogin FROM pg_roles WHERE rolname='kamayuk_readonly'")" = "f" ] \
    || { echo "FALLO: kamayuk_readonly puede conectarse, y todavia no lo usa nadie" >&2; exit 1; }

# ── 4. Con las credenciales de la aplicacion, no hay DDL ─────────────────────
echo "· La aplicacion no puede ejecutar DDL"
if PGPASSWORD="$CLAVE_APP" psql --username=kamayuk_app --dbname=sgtm --quiet \
        --command 'CREATE TABLE intento_de_ddl (id int)' >/dev/null 2>&1; then
    echo "FALLO: las credenciales de la aplicacion pueden crear tablas. Un proceso expuesto en HTTP con DDL sobre el padron de todas las municipalidades es lo que ARQ-03 §4 excluye" >&2
    exit 1
fi

# ── 4b. rol_carga_parametros tampoco puede ejecutar DDL ──────────────────────
#
# V7 le da INSERT sobre parametro_tributario y nada mas (SoD-1, REQ-03): ni siquiera
# puede crear una tabla propia. Es la misma separacion de funciones que kamayuk_app,
# comprobada de la misma forma.
echo "· rol_carga_parametros tampoco puede ejecutar DDL"
if PGPASSWORD="$CLAVE_CARGA" psql --username=rol_carga_parametros --dbname=sgtm --quiet \
        --command 'CREATE TABLE intento_de_ddl_carga (id int)' >/dev/null 2>&1; then
    echo "FALLO: rol_carga_parametros puede crear tablas. Solo debe poder insertar en parametro_tributario" >&2
    exit 1
fi

# ── 5. Los cuatro conservan el CONNECT sobre la base del padron ──────────────
echo "· Los cuatro roles conservan el CONNECT sobre la base del padron"
for par in "kamayuk_owner:$CLAVE_OWNER" "kamayuk_app:$CLAVE_APP" "rol_carga_parametros:$CLAVE_CARGA"; do
    rol=${par%%:*}
    clave=${par#*:}
    PGPASSWORD="$clave" psql --username="$rol" --dbname=sgtm --quiet --command 'SELECT 1' \
        >/dev/null 2>&1 \
        || { echo "FALLO: $rol no puede conectarse a la base del padron: 30-base-de-keycloak.sh revoca el CONNECT de PUBLIC y tiene que volver a concederselo a los cuatro roles" >&2; exit 1; }
done
# kamayuk_readonly no tiene LOGIN, asi que su privilegio se comprueba por el catalogo.
[ "$(comoSuperusuario "SELECT has_database_privilege('kamayuk_readonly','sgtm','CONNECT')")" = "t" ] \
    || { echo "FALLO: kamayuk_readonly perdio el CONNECT sobre la base del padron" >&2; exit 1; }

# ── 5c. Las CUATRO bases del producto, con sus roles aplicados (C-14, punto 2) ─
#
# Hasta C-14 esto no lo hacia nadie en el cluster (C-7, hueco 3): `baseDeDatos()` de los
# cuatro descriptores existia y **solo se usaba para auditar**, y los cuatro `Deployment`
# apuntaban a `jdbc:postgresql://postgres:5432/<sistema>` — una base que no existia.
#
# Y crear la base no basta: `crear-roles.sql` de cada sistema concede `USAGE, CREATE` sobre
# `public` DE ESA BASE, y sin eso el migrador muere en la primera sentencia. Medido contra
# PostgreSQL 16.15 con el migrador de `catastro` de verdad: sin `06-roles-de-los-sistemas.sh`,
# «42501 permission denied for schema public»; con el, «Successfully applied 5 migrations».
#
# Y el `REVOKE CONNECT ... FROM PUBLIC` de ese mismo archivo, que es la otra mitad: PostgreSQL
# concede `CONNECT` a PUBLIC al crear una base, los roles son del CLUSTER, y los cuatro sistemas
# lo comparten. Sin el, la credencial de cualquiera abre una sesion contra la base de cualquier
# otro (C-7 §2.6).
echo "· Las cuatro bases del producto, con sus roles"
for base in rentas catastro normativa caja; do
    [ "$(comoSuperusuario "SELECT 1 FROM pg_database WHERE datname='$base'" postgres)" = "1" ] \
        || { echo "FALLO: la base «${base}» no existe. La crea 05-crear-bases.sh, de la lista de archivos de roles que el ConfigMap monta en /etc/kamayuk/roles" >&2; exit 1; }
    [ "$(comoSuperusuario "SELECT has_schema_privilege('kamayuk_owner','public','CREATE')" "$base")" = "t" ] \
        || { echo "FALLO: kamayuk_owner no puede crear en «public» de «${base}»: la migracion moriria en la primera sentencia con 42501. Lo concede 06-roles-de-los-sistemas.sh aplicando el crear-roles.sql de ese sistema contra SU base" >&2; exit 1; }
    [ "$(comoSuperusuario "SELECT has_database_privilege('public','$base','CONNECT')" postgres)" = "f" ] \
        || { echo "FALLO: PUBLIC conserva el CONNECT sobre «${base}». Los roles son del CLUSTER: sin el REVOKE, la credencial de cualquier sistema abre una sesion contra la base de otro" >&2; exit 1; }
    echo "  $base → kamayuk_owner puede crear, y PUBLIC no se conecta"
done
# Y las extensiones, cada una donde su sistema la declara (C-10). `caja` no declara ninguna a
# proposito —«la ventanilla tiene que poder correr en el motor mas simple que exista»— y esa
# frase solo la ejercita alguien si se comprueba.
[ "$(comoSuperusuario "SELECT 1 FROM pg_extension WHERE extname='postgis'" catastro)" = "1" ] \
    || { echo "FALLO: catastro no tiene PostGIS, y la usa desde V61" >&2; exit 1; }
[ -z "$(comoSuperusuario "SELECT extname FROM pg_extension WHERE extname <> 'plpgsql'" caja)" ] \
    || { echo "FALLO: la base de caja tiene extensiones. No declara ninguna a proposito (P5D)" >&2; exit 1; }
echo "  catastro tiene PostGIS; caja, ninguna extension"

# ── 5b. El rol de carga no llega a la base de Keycloak ───────────────────────
#
# La leccion de `kamayuk_respaldo` (#155), aplicada al otro rol privilegiado, y en la
# direccion que faltaba: ya se comprobaba que el rol de Keycloak no alcanza el padron,
# pero no que el rol que publica cifras normativas no alcance la base de identidad.
# `30-base-de-keycloak.sh` revoca el CONNECT de PUBLIC sobre `keycloak` y se lo concede
# SOLO a `keycloak`; esto es lo que exige que esa lista no crezca.
#
# Lo que NO se comprueba aqui es cuantas TABLAS puede escribir: este guion corre la
# inicializacion del motor, no las migraciones, asi que el esquema todavia no existe.
# Esa mitad vive en `LasDosGuardasDeLaCargaTest` (sgtm-parametros), que migra de verdad
# y la mide por el catalogo — que es lo unico que distingue las dos guardas, porque las
# dos dan 42501 (#380, #435).
echo "· rol_carga_parametros no llega a la base de Keycloak"
[ "$(comoSuperusuario "SELECT has_database_privilege('rol_carga_parametros','keycloak','CONNECT')" postgres)" = "f" ] \
    || { echo "FALLO: rol_carga_parametros puede conectarse a la base de Keycloak. No la necesita —solo escribe el catalogo normativo del padron—, y una credencial de mas apuntando a otra base es una credencial de mas (la leccion de kamayuk_respaldo, #155)" >&2; exit 1; }

# ── 6. Keycloak: base propia, y lejos del padron ─────────────────────────────
echo "· La base de Keycloak"
[ "$(comoSuperusuario "SELECT 1 FROM pg_database WHERE datname='keycloak'" postgres)" = "1" ] \
    || { echo "FALLO: la base de Keycloak no existe" >&2; exit 1; }
[ "$(comoSuperusuario "SELECT has_database_privilege('keycloak','sgtm','CONNECT')" postgres)" = "f" ] \
    || { echo "FALLO: el rol de Keycloak puede conectarse a la base del padron. No la necesita, y una credencial de mas apuntando al padron es una credencial de mas" >&2; exit 1; }
PGPASSWORD="$CLAVE_IDENTIDAD" psql --username=keycloak --dbname=keycloak --quiet \
    --command 'SELECT 1' >/dev/null 2>&1 \
    || { echo "FALLO: Keycloak no puede conectarse a su propia base" >&2; exit 1; }

# ── 7. El rol del respaldo: lo minimo que wal-g necesita, y nada mas ─────────
#
# `40-rol-de-respaldo.sh` le da exactamente tres cosas: `pg_read_all_settings` —wal-g
# pregunta `data_directory`— y EXECUTE sobre `pg_backup_start`/`pg_backup_stop`. Ese
# conjunto se determino EJECUTANDO `wal-g backup-push` contra un motor real hasta dar
# con el minimo que no falla, no leyendo documentacion (issue #155).
#
# Lo que esta prueba impide es lo contrario: que alguien "arregle" un respaldo que
# falla dandole superusuario al rol. Entonces el respaldo dejaria de ser un lector y
# pasaria a ser una credencial con poder total sobre el padron de todas las
# municipalidades, y el sintoma no aparece por ninguna parte — el respaldo funciona.
echo "· El rol del respaldo no puede mas de lo que necesita"
atributos=$(comoSuperusuario \
    "SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = 'kamayuk_respaldo'" postgres)
[ -n "$atributos" ] \
    || { echo "FALLO: el rol kamayuk_respaldo no existe; 40-rol-de-respaldo.sh no corrio" >&2; exit 1; }
case "$atributos" in
    f\|f\|t) ;;
    *) echo "FALLO: kamayuk_respaldo es superusuario, omite RLS o no puede conectarse: $atributos" >&2; exit 1 ;;
esac
echo "  kamayuk_respaldo → rolsuper|rolbypassrls|rolcanlogin = $atributos"

if PGPASSWORD="$CLAVE_RESPALDO" psql --username=kamayuk_respaldo --dbname=postgres --quiet \
        --command 'CREATE TABLE intento_de_ddl_respaldo (id int)' >/dev/null 2>&1; then
    echo "FALLO: el rol del respaldo puede crear tablas. Respalda leyendo; no escribe" >&2
    exit 1
fi

# Las dos funciones que SI necesita. Sin ellas `backup-push` falla con «permission
# denied for function pg_backup_start», y el respaldo no llega ni a empezar.
for funcion in "pg_backup_start(text, boolean)" "pg_backup_stop(boolean)"; do
    [ "$(comoSuperusuario \
            "SELECT has_function_privilege('kamayuk_respaldo', '$funcion', 'EXECUTE')" postgres)" = "t" ] \
        || { echo "FALLO: kamayuk_respaldo no puede ejecutar $funcion; wal-g no podria respaldar" >&2; exit 1; }
done
[ "$(comoSuperusuario \
        "SELECT pg_has_role('kamayuk_respaldo', 'pg_read_all_settings', 'MEMBER')" postgres)" = "t" ] \
    || { echo "FALLO: kamayuk_respaldo no puede leer data_directory; wal-g no encontraria PGDATA" >&2; exit 1; }
echo "  puede pg_backup_start/stop y leer la configuracion: lo justo"

# El rol del respaldo NO necesita entrar a la base del padron: pg_backup_start y
# pg_backup_stop son operaciones del cluster, no de una base.
[ "$(comoSuperusuario "SELECT has_database_privilege('kamayuk_respaldo','sgtm','CONNECT')" postgres)" = "f" ] \
    || { echo "FALLO: kamayuk_respaldo puede conectarse a la base del padron, y no la necesita" >&2; exit 1; }
echo "  y no alcanza la base del padron"

# ── 8. El rol de monitoreo: pg_monitor, y nada mas (issue #156) ──────────────
#
# `postgres-exporter` vive en el MISMO pod que el motor, con `kamayuk_monitor`. El
# privilegio predefinido de PostgreSQL da lectura sobre las vistas de estadisticas,
# nunca sobre una tabla del padron: es lo que separa "medir cuantas conexiones hay"
# de "leer la deuda de un contribuyente".
echo "· El rol de monitoreo solo tiene pg_monitor"
atributosDeMonitoreo=$(comoSuperusuario \
    "SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = 'kamayuk_monitor'" postgres)
[ -n "$atributosDeMonitoreo" ] \
    || { echo "FALLO: el rol kamayuk_monitor no existe; 50-rol-de-monitoreo.sh no corrio" >&2; exit 1; }
case "$atributosDeMonitoreo" in
    f\|f\|t) ;;
    *) echo "FALLO: kamayuk_monitor es superusuario, omite RLS o no puede conectarse: $atributosDeMonitoreo" >&2; exit 1 ;;
esac
echo "  kamayuk_monitor → rolsuper|rolbypassrls|rolcanlogin = $atributosDeMonitoreo"

if PGPASSWORD="$CLAVE_MONITOREO" psql --username=kamayuk_monitor --dbname=postgres --quiet \
        --command 'CREATE TABLE intento_de_ddl_monitoreo (id int)' >/dev/null 2>&1; then
    echo "FALLO: el rol de monitoreo puede crear tablas. Solo mide; no escribe" >&2
    exit 1
fi

[ "$(comoSuperusuario "SELECT pg_has_role('kamayuk_monitor', 'pg_monitor', 'MEMBER')" postgres)" = "t" ] \
    || { echo "FALLO: kamayuk_monitor no tiene pg_monitor; postgres-exporter no podria leer nada" >&2; exit 1; }
echo "  tiene pg_monitor: lo justo"

[ "$(comoSuperusuario "SELECT has_database_privilege('kamayuk_monitor','sgtm','CONNECT')" postgres)" = "f" ] \
    || { echo "FALLO: kamayuk_monitor puede conectarse a la base del padron, y no la necesita" >&2; exit 1; }
echo "  y no alcanza la base del padron"

# ── 9. Reiniciar deja los datos donde estaban ────────────────────────────────
echo "· Reiniciar el motor no pierde datos"
PGPASSWORD="$CLAVE_OWNER" psql --username=kamayuk_owner --dbname=sgtm --quiet \
    --command 'CREATE TABLE si_sobrevive (dato text)' \
    --command "INSERT INTO si_sobrevive VALUES ('sobrevivio')" >/dev/null

motor_reiniciar || { echo "FALLO: el motor no volvio tras el reinicio" >&2; exit 1; }

[ "$(comoSuperusuario "SELECT dato FROM si_sobrevive")" = "sobrevivio" ] \
    || { echo "FALLO: el dato no sobrevivio al reinicio" >&2; exit 1; }

# ── 10. El aislamiento, contra ESTA instancia ────────────────────────────────
#
# Es el primer criterio de aceptacion del issue #149, y lo unico que demuestra que el
# aislamiento sigue en pie es ejecutarlo aqui.
#
# ⚠ **Nunca contra el motor de una municipalidad en marcha.** La prueba provisiona: crea
# una base para la corrida y le asigna a los cuatro roles su clave con `ALTER
# ROLE` (`BaseDeDatosDePrueba.provisionarRoles`). Los roles son objetos del clúster de
# PostgreSQL, no de la base, asi que esas claves nuevas valen para TODAS sus bases: la
# aplicacion que estuviera corriendo contra ese motor se quedaria fuera hasta que
# alguien volviera a aplicar el Secret. Por eso esto corre contra la instancia
# desechable que acaba de levantar este guion, y no contra `prod`.
if [ "$CON_AISLAMIENTO" = "si" ]; then
    echo
    echo "· verificarAislamiento contra esta instancia"
    # `--no-parallel --max-workers=1`, y esto se descubrio por las malas en la primera
    # corrida de este trabajo: `verificarAislamiento` son DOS tareas —el esquema y la
    # plataforma— y `org.gradle.parallel=true` las lanza a la vez.
    #
    # Con Testcontainers eso da igual: cada una levanta su contenedor. Contra un motor
    # externo comparten instancia, y **los roles son objetos del clúster de PostgreSQL,
    # no de una base**: las dos ejecutan `ALTER ROLE kamayuk_owner ... PASSWORD` sobre los
    # mismos roles. El resultado fue un `tuple concurrently updated` en una y un
    # `password authentication failed for user "kamayuk_owner"` en la otra —la clave que
    # acababa de poner se la habia cambiado la vecina—.
    #
    # Desde #698 la carrera esta cerrada en el arnes —la clave se DERIVA del cluster en
    # vez de sortearse, y el provisionamiento se serializa con un candado de asesoramiento
    # tomado siempre en la base `postgres`—, asi que la orden en paralelo ya funciona. Las
    # dos banderas se quedan igual, y a proposito: aqui el motor es desechable, correr en
    # serie cuesta unos segundos, y con ellas este trabajo no depende de que aquel arreglo
    # siga siendo correcto. Quien guarda el caso en paralelo es
    # `ProvisionamientoCompartidoTest`, no esta linea.
    (
        cd "$INFRA/../backend"
        ./gradlew verificarAislamiento --no-daemon --no-parallel --max-workers=1 \
            -Dsgtm.pruebas.postgres.url="jdbc:postgresql://127.0.0.1:$PUERTO/postgres" \
            -Dsgtm.pruebas.postgres.usuario=postgres \
            -Dsgtm.pruebas.postgres.clave="$CLAVE_SUPER"
    ) || { echo "FALLO: la prueba de aislamiento no paso contra la instancia del manifiesto" >&2; exit 1; }
fi

echo
echo "El motor del manifiesto de «${AMBIENTE}» cumple lo que el issue #149 exige (modo: $MODO)."
