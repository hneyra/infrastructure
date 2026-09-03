#!/usr/bin/env bash
# Biblioteca compartida: levantar un PostgreSQL con los guiones que el manifiesto monta.
#
# La usan `verificar-el-motor.sh` (issue #149) y `secretos/verificar-rotacion.sh`
# (issue #154) — las dos necesitan exactamente lo mismo: un motor real, con los mismos
# guiones de inicializacion que se montarian en k3s, sin copiarlos. Separarla es lo que
# evita que las dos se desincronicen la primera vez que alguien cambie como se levanta.
#
# Requiere, ya fijadas por quien la usa: AMBIENTE y TRABAJO (un directorio de
# `mktemp -d`). Deja fijadas: PUERTO, PGHOST, PGPORT, MODO, CLAVE_SUPER, CLAVE_OWNER,
# CLAVE_APP, CLAVE_CARGA, CLAVE_IDENTIDAD, CLAVE_RESPALDO, CLAVE_MONITOREO, BINARIOS. No
# tiene `set -euo pipefail` propio: hereda el de quien la usa.
#
# **PUERTO ya no lo fija quien la usa** (#731): lo pide esta biblioteca al sistema
# operativo. Era una constante distinta por guion y el nombre del contenedor, en cambio,
# lleva el PID; esa asimetria hacia chocar a dos motores del mismo trabajo con un
# `address already in use` que no se parece a su causa. El porque largo esta en
# `puerto.sh`. Se puede seguir imponiendo uno con `SGTM_PUERTO_MOTOR`, para depurar.

: "${AMBIENTE:?lib-motor-local.sh necesita AMBIENTE}"
: "${TRABAJO:?lib-motor-local.sh necesita TRABAJO}"

LIB_MOTOR_AQUI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
LIB_MOTOR_INFRA=$(cd "$LIB_MOTOR_AQUI/../.." && pwd)

CONTENEDOR=sgtm-motor-verificacion-$$
MODO=""

export PGHOST=127.0.0.1

# Claves con comilla simple a proposito: `20-asignar-claves.sh` las pasa a psql como
# variables (`:'clave'`) justamente para que una comilla no rompa —ni cambie— la
# sentencia. Si alguien "simplificara" ese guion interpolando la clave en el texto del
# SQL, esto se pondria rojo aqui mismo.
CLAVE_SUPER="sup3r'usuario"
CLAVE_OWNER="o'wner-Cl4ve"
CLAVE_APP="a'pp-Cl4ve"
CLAVE_CARGA="c'arga-Cl4ve"
CLAVE_IDENTIDAD="k'eycloak-Cl4ve"
CLAVE_RESPALDO="r'espaldo-Cl4ve"
CLAVE_MONITOREO="m'onitoreo-Cl4ve"

for herramienta in psql pg_isready node yarn; do
    command -v "$herramienta" >/dev/null 2>&1 \
        || { echo "FALLO: falta «${herramienta}», que lib-motor-local.sh necesita." >&2; exit 1; }
done

# El puerto, despues de comprobar las herramientas: pedirlo necesita `node`.
# shellcheck source=infra/verificaciones/motor/puerto.sh
. "$LIB_MOTOR_AQUI/puerto.sh"
PUERTO=${SGTM_PUERTO_MOTOR:-$(motor_puerto_libre)}
export PGPORT=$PUERTO
echo "· Puerto del anfitrion: $PUERTO"

echo "· Extrayendo la inicializacion del manifiesto de «${AMBIENTE}»"
(cd "$LIB_MOTOR_INFRA" && yarn --silent manifiestos --ambiente "$AMBIENTE" --componente postgres) \
    > "$TRABAJO/postgres.json"

node --input-type=module -e "
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const lista = JSON.parse(readFileSync('$TRABAJO/postgres.json', 'utf8'));
const configuracion = lista.items.find((i) => i.kind === 'ConfigMap');
if (!configuracion) throw new Error('El manifiesto no trae el ConfigMap de inicializacion');
mkdirSync('$TRABAJO/inicializacion', { recursive: true });
for (const [nombre, contenido] of Object.entries(configuracion.data)) {
  writeFileSync('$TRABAJO/inicializacion/' + nombre, contenido);
}
const motor = lista.items.find((i) => i.kind === 'Deployment');
writeFileSync('$TRABAJO/imagen', motor.spec.template.spec.containers[0].image);
"
chmod +x "$TRABAJO"/inicializacion/*.sh
MOTOR_IMAGEN=$(cat "$TRABAJO/imagen")
echo "· Imagen declarada en el manifiesto: $MOTOR_IMAGEN"

motor_arrancar_con_docker() {
    # Si el `docker run` falla, el motor NO arranco — y eso no es lo mismo que una
    # comprobacion en rojo. Sin este marco los dos salen como «el trabajo esta rojo», y
    # el mensaje del demonio («address already in use») manda a buscar donde no es.
    if ! motor_docker_run; then
        echo "FALLO: el motor no llego a arrancar (puerto $PUERTO, imagen $MOTOR_IMAGEN)." >&2
        echo "       No se comprobo nada: esto es un fallo de arranque, no una verificacion" >&2
        echo "       en rojo. Si el demonio dice «address already in use», el puerto lo" >&2
        echo "       tiene otro proceso de esta maquina (#731)." >&2
        exit 1
    fi
}

motor_docker_run() {
    docker run --detach --name "$CONTENEDOR" \
        --env POSTGRES_DB=sgtm \
        --env POSTGRES_USER=postgres \
        --env POSTGRES_PASSWORD="$CLAVE_SUPER" \
        --env SGTM_CLAVE_OWNER="$CLAVE_OWNER" \
        --env SGTM_CLAVE_APP="$CLAVE_APP" \
        --env SGTM_CLAVE_CARGA="$CLAVE_CARGA" \
        --env SGTM_CLAVE_IDENTIDAD="$CLAVE_IDENTIDAD" \
        --env SGTM_CLAVE_RESPALDO="$CLAVE_RESPALDO" \
        --env SGTM_CLAVE_MONITOREO="$CLAVE_MONITOREO" \
        --env PGDATA=/var/lib/postgresql/data/pgdata \
        --volume "$TRABAJO/inicializacion:/docker-entrypoint-initdb.d:ro" \
        --publish "127.0.0.1:$PUERTO:5432" \
        "$MOTOR_IMAGEN" >/dev/null
}

# PostgreSQL se niega a correr como root, y hace bien. Cuando esto corre como root —el
# caso de un contenedor de CI—, initdb y pg_ctl van como el usuario `postgres` del
# sistema.
motor_como_su_usuario() {
    if [ "$(id -u)" = "0" ]; then
        runuser --user=postgres -- "$@"
    else
        "$@"
    fi
}

motor_arrancar_localmente() {
    if [ "$(id -u)" = "0" ]; then
        id postgres >/dev/null 2>&1 \
            || { echo "FALLO: hay que correr como root sin usuario «postgres» en el sistema." >&2; exit 1; }
        chmod 711 "$TRABAJO"
        chown postgres "$TRABAJO"
    fi
    printf '%s' "$CLAVE_SUPER" > "$TRABAJO/clave"
    chmod 644 "$TRABAJO/clave"
    motor_como_su_usuario "$BINARIOS/initdb" --pgdata="$TRABAJO/datos" --username=postgres \
        --auth-host=scram-sha-256 --auth-local=trust --pwfile="$TRABAJO/clave" >/dev/null
    motor_como_su_usuario "$BINARIOS/pg_ctl" --pgdata="$TRABAJO/datos" --silent \
        --log="$TRABAJO/motor.log" \
        --options="-p $PUERTO -k $TRABAJO -c listen_addresses=127.0.0.1" start
    motor_esperar || { echo "FALLO: el motor local no acepto conexiones." >&2; exit 1; }

    # Los guiones se conectan sin decir donde: en la imagen es el socket del contenedor
    # y aqui son estas variables. El guion NO se toca — es el mismo archivo que se
    # montaria en k3s, y esa es media prueba.
    export PGPASSWORD="$CLAVE_SUPER"
    psql --quiet --username=postgres --command 'CREATE DATABASE sgtm' postgres >/dev/null

    for guion in "$TRABAJO"/inicializacion/*; do
        echo "  · $(basename "$guion")"
        case "$guion" in
            *.sql) psql --quiet -v ON_ERROR_STOP=1 --username=postgres --file="$guion" sgtm \
                       >/dev/null ;;
            *.sh) POSTGRES_USER=postgres POSTGRES_DB=sgtm \
                  SGTM_CLAVE_OWNER="$CLAVE_OWNER" SGTM_CLAVE_APP="$CLAVE_APP" \
                  SGTM_CLAVE_CARGA="$CLAVE_CARGA" \
                  SGTM_CLAVE_IDENTIDAD="$CLAVE_IDENTIDAD" \
                  SGTM_CLAVE_RESPALDO="$CLAVE_RESPALDO" \
                  SGTM_CLAVE_MONITOREO="$CLAVE_MONITOREO" bash "$guion" >/dev/null ;;
        esac
    done
    unset PGPASSWORD
}

motor_esperar() {
    for _ in $(seq 1 60); do
        if pg_isready --host=127.0.0.1 --port="$PUERTO" --username=postgres >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
    done
    return 1
}

motor_reiniciar() {
    if [ "$MODO" = "docker" ]; then
        docker restart "$CONTENEDOR" >/dev/null
    else
        motor_como_su_usuario "$BINARIOS/pg_ctl" --pgdata="$TRABAJO/datos" --silent \
            --log="$TRABAJO/motor.log" restart \
            --options="-p $PUERTO -k $TRABAJO -c listen_addresses=127.0.0.1" >/dev/null
    fi
    motor_esperar
}

motor_detener() {
    if [ "$MODO" = "docker" ]; then
        docker rm --force "$CONTENEDOR" >/dev/null 2>&1 || true
    elif [ "$MODO" = "local" ]; then
        motor_como_su_usuario "$BINARIOS/pg_ctl" --pgdata="$TRABAJO/datos" --silent stop \
            >/dev/null 2>&1 || true
    else
        return 0
    fi
    # Y esperar a que el puerto quede libre de verdad: `docker rm --force` vuelve antes
    # de que el demonio lo suelte. Lo necesita `simulacro-de-restauracion.sh`, que
    # detiene y vuelve a arrancar sobre el mismo puerto a proposito (#155, #731).
    motor_esperar_puerto_libre "$PUERTO" || true
}

motor_como_superusuario() {
    PGPASSWORD="$CLAVE_SUPER" psql --username=postgres --dbname="${2:-sgtm}" \
        --tuples-only --no-align --command "$1"
}

BINARIOS=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1 || true)
# Un PostgreSQL instalado fuera de la ruta de Debian —un toolchain desempaquetado en
# $HOME, que es como se llega a este guion en una maquina sin Docker ni root— tambien
# vale: lo que hace falta es `initdb`, no una ruta concreta.
if [ -z "$BINARIOS" ] && command -v initdb >/dev/null 2>&1; then
    BINARIOS=$(dirname "$(command -v initdb)")
fi

# `SGTM_MOTOR_MODO=local` fuerza la instancia local aunque haya Docker. Lo usa
# `respaldo/simulacro-de-restauracion.sh` (issue #155): el PITR exige apagar el motor,
# destruir su directorio de datos y arrancar OTRO proceso sobre lo restaurado, y eso
# contra un contenedor de la imagen oficial no se puede sin reimplementar medio
# entrypoint. Nadie mas deberia usarlo: el camino fiel es el de Docker.
if [ "${SGTM_MOTOR_MODO:-}" = "local" ]; then
    [ -n "$BINARIOS" ] && [ -x "$BINARIOS/initdb" ] \
        || { echo "FALLO: SGTM_MOTOR_MODO=local pero no hay un PostgreSQL local instalado." >&2; exit 1; }
    MODO=local
    echo "· Motor: instancia local temporal, pedida con SGTM_MOTOR_MODO=local"
    echo "  ($("$BINARIOS/postgres" --version))"
    motor_arrancar_localmente
elif docker pull --quiet "$MOTOR_IMAGEN" >/dev/null 2>&1; then
    MODO=docker
    echo "· Motor: contenedor con $MOTOR_IMAGEN"
    motor_arrancar_con_docker
    motor_esperar || { docker logs "$CONTENEDOR" | tail -40; echo "FALLO: el motor no acepto conexiones." >&2; exit 1; }
    if docker logs "$CONTENEDOR" 2>&1 | grep -qiE "^psql:.*ERROR|initdb: error"; then
        docker logs "$CONTENEDOR" | tail -40
        echo "FALLO: la inicializacion del motor registro errores." >&2
        exit 1
    fi
elif [ -n "$BINARIOS" ] && [ -x "$BINARIOS/initdb" ]; then
    MODO=local
    echo "· Motor: instancia local temporal ($("$BINARIOS/postgres" --version))."
    echo "  ⚠ No es la imagen del manifiesto —Docker no esta disponible aqui—: los guiones"
    echo "    y su orden son los mismos, la imagen no. CI usa siempre el camino de Docker."
    motor_arrancar_localmente
else
    echo "FALLO: no hay ni Docker ni un PostgreSQL local con el que levantar el motor." >&2
    exit 1
fi
