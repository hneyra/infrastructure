#!/usr/bin/env bash

# La base donde vive el padron, desde `E`. Era `sgtm`, la del monolito, que hoy no tiene ni
# una tabla del producto. `rentas` es la unica cuyo `crear-roles.sql` concede CONNECT a los
# cinco roles del cluster, o sea la que menos supuestos hace sobre quien se conecta.
BASE_DEL_PADRON=rentas
# El modo `--contra-cluster` de simulacro-de-restauracion.sh (issue #158).
#
# No se corre solo: `simulacro-de-restauracion.sh` lo source-ea despues de validar
# `--ambiente stg` y con `set -euo pipefail` ya activo. Asume `INFRA` fijada (la raiz
# de `infra/`) y un `KUBECONFIG` que ya alcanza el cluster -el mismo tunel SSH que usa
# el resto de `infra/`, este guion no lo abre-.
#
# La diferencia con el modo local, en una frase: aqui no se levanta nada — se apaga,
# se restaura y se vuelve a encender el `Deployment` de verdad, con su propio volumen.
# El detalle completo de los ocho pasos vive en el docstring de
# simulacro-de-restauracion.sh; este archivo es la implementacion.

NAMESPACE=kamayuk-stg
DEPLOYMENT=kamayuk-stg-postgres
POD_TEMPORAL=pitr-restaurar
MUNICIPALIDAD_DE_ENSAYO=1

# El archivador es asincrono, igual que en el modo local (misma nota, mismo motivo:
# `archive_timeout` puede atrasarse mas de lo que este guion tarda en llegar aqui).
# A diferencia del modo local, tambien exige que `failed_count` no suba: un fallo real
# de archivado contra el almacenamiento de verdad no es un problema de temporizacion.
esperar_archivado_cluster() {
    local clave="$1" pod="$2" desde archivados fallidos
    desde=$(kubectl exec -n "$NAMESPACE" "$pod" -c postgres -- env PGPASSWORD="$clave" \
        psql --username=postgres --dbname="$BASE_DEL_PADRON" --tuples-only --no-align \
        --command "SELECT archived_count FROM pg_stat_archiver")
    for _ in $(seq 1 30); do
        archivados=$(kubectl exec -n "$NAMESPACE" "$pod" -c postgres -- env PGPASSWORD="$clave" \
            psql --username=postgres --dbname="$BASE_DEL_PADRON" --tuples-only --no-align \
            --command "SELECT archived_count FROM pg_stat_archiver")
        fallidos=$(kubectl exec -n "$NAMESPACE" "$pod" -c postgres -- env PGPASSWORD="$clave" \
            psql --username=postgres --dbname="$BASE_DEL_PADRON" --tuples-only --no-align \
            --command "SELECT failed_count FROM pg_stat_archiver")
        [ "${archivados:-0}" -gt "${desde:-0}" ] && return 0
        sleep 2
    done
    echo "FALLO: no se archivo un segmento nuevo en 60s (iba por $desde, $fallidos fallidos)." >&2
    exit 1
}

ensayar_contra_cluster() {
    command -v kubectl >/dev/null 2>&1 || { echo "FALLO: falta kubectl." >&2; exit 1; }
    kubectl get namespace "$NAMESPACE" >/dev/null 2>&1 \
        || { echo "FALLO: no se alcanza el namespace $NAMESPACE. ¿KUBECONFIG y el tunel SSH estan listos?" >&2; exit 1; }

    local pod claveSuper claveOwner walgVersion walgSha256 walgPrefix awsEndpoint awsRegion
    local tBueno codigoBueno codigoMalo inicioDelReloj finDelReloj segundos estado marcadas

    pod=$(kubectl get pod -n "$NAMESPACE" -l app="$DEPLOYMENT" -o jsonpath='{.items[0].metadata.name}')
    [ -n "$pod" ] || { echo "FALLO: no hay un pod de postgres en marcha en $NAMESPACE." >&2; exit 1; }

    claveSuper=$(kubectl get secret -n "$NAMESPACE" "${DEPLOYMENT}-superusuario" \
        -o jsonpath='{.data.clave-superusuario}' | base64 -d)
    claveOwner=$(kubectl get secret -n "$NAMESPACE" "${DEPLOYMENT}-owner" \
        -o jsonpath='{.data.clave-owner}' | base64 -d)

    echo "· Version de wal-g, la que declara el manifiesto"
    walgVersion=$(grep -oP 'WALG_VERSION = "\K[^"]+' "$INFRA/componentes/convenciones.ts")
    walgSha256=$(grep -oP 'WALG_SHA256 = "\K[^"]+' "$INFRA/componentes/convenciones.ts")
    [ -n "$walgVersion" ] && [ -n "$walgSha256" ] \
        || { echo "FALLO: no se pudieron leer WALG_VERSION/WALG_SHA256 de convenciones.ts." >&2; exit 1; }
    echo "  version $walgVersion"

    # El destino real no se copia a mano: se lee del `Deployment` en marcha, que es el
    # mismo valor con que ese motor ya esta archivando. Copiarlo aparte es la forma en
    # que este guion se desincroniza de la configuracion real la primera vez que
    # alguien cambie el bucket o la region sin acordarse de aqui.
    echo "· Leyendo el destino real del manifiesto en marcha"
    walgPrefix=$(kubectl get deployment -n "$NAMESPACE" "$DEPLOYMENT" \
        -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="WALG_S3_PREFIX")].value}')
    awsEndpoint=$(kubectl get deployment -n "$NAMESPACE" "$DEPLOYMENT" \
        -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="AWS_ENDPOINT")].value}')
    awsRegion=$(kubectl get deployment -n "$NAMESPACE" "$DEPLOYMENT" \
        -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="AWS_REGION")].value}')
    [ -n "$walgPrefix" ] && [ -n "$awsEndpoint" ] && [ -n "$awsRegion" ] \
        || { echo "FALLO: no se pudo leer WALG_S3_PREFIX/AWS_ENDPOINT/AWS_REGION del Deployment real." >&2; exit 1; }
    echo "  $walgPrefix, $awsRegion"

    echo
    echo "· Escribiendo la fila BUENA -T_BUENO queda entre esta y la mala-"
    codigoBueno="ENSAYO-PITR-B$$"
    kubectl exec -n "$NAMESPACE" "$pod" -c postgres -- env PGPASSWORD="$claveOwner" \
        psql --username=kamayuk_owner --dbname="$BASE_DEL_PADRON" --quiet -v ON_ERROR_STOP=1 <<SQL
BEGIN;
SET LOCAL app.municipalidad_id = '$MUNICIPALIDAD_DE_ENSAYO';
INSERT INTO contribuyente
    (municipalidad_id, codigo_contribuyente, tipo_documento, numero_documento,
     tipo_persona, nombre_razon_social, usuario_registro)
VALUES
    ($MUNICIPALIDAD_DE_ENSAYO, '$codigoBueno', 'DNI', '00000001', 'NATURAL',
     'Ensayo PITR contra cluster: fila buena', 'ensayo-158-pitr');
COMMIT;
SQL
    kubectl exec -n "$NAMESPACE" "$pod" -c postgres -- env PGPASSWORD="$claveSuper" \
        psql --username=postgres --dbname="$BASE_DEL_PADRON" --quiet --command "SELECT pg_switch_wal()" >/dev/null
    esperar_archivado_cluster "$claveSuper" "$pod"
    tBueno=$(kubectl exec -n "$NAMESPACE" "$pod" -c postgres -- env PGPASSWORD="$claveSuper" \
        psql --username=postgres --dbname="$BASE_DEL_PADRON" --tuples-only --no-align \
        --command "SELECT clock_timestamp()")
    echo "  T_BUENO = $tBueno"
    sleep 2

    echo "· Escribiendo la fila MALA -la que el PITR tiene que dejar fuera-"
    codigoMalo="ENSAYO-PITR-M$$"
    kubectl exec -n "$NAMESPACE" "$pod" -c postgres -- env PGPASSWORD="$claveOwner" \
        psql --username=kamayuk_owner --dbname="$BASE_DEL_PADRON" --quiet -v ON_ERROR_STOP=1 <<SQL
BEGIN;
SET LOCAL app.municipalidad_id = '$MUNICIPALIDAD_DE_ENSAYO';
INSERT INTO contribuyente
    (municipalidad_id, codigo_contribuyente, tipo_documento, numero_documento,
     tipo_persona, nombre_razon_social, usuario_registro)
VALUES
    ($MUNICIPALIDAD_DE_ENSAYO, '$codigoMalo', 'DNI', '00000002', 'NATURAL',
     'Ensayo PITR contra cluster: fila que se pierde', 'ensayo-158-pitr');
COMMIT;
SQL
    kubectl exec -n "$NAMESPACE" "$pod" -c postgres -- env PGPASSWORD="$claveSuper" \
        psql --username=postgres --dbname="$BASE_DEL_PADRON" --quiet --command "SELECT pg_switch_wal()" >/dev/null
    esperar_archivado_cluster "$claveSuper" "$pod"
    echo "  archivada"

    # ─────────────────────────────────────────────────────────────────────
    # Perdida total: aqui arranca el cronometro (paso 6 del docstring)
    # ─────────────────────────────────────────────────────────────────────
    echo
    echo "· Apagando el motor y preservando el volumen actual, sin borrarlo"
    inicioDelReloj=$(date +%s)
    kubectl scale deployment "$DEPLOYMENT" -n "$NAMESPACE" --replicas=0
    kubectl wait --for=delete pod -l app="$DEPLOYMENT" -n "$NAMESPACE" --timeout=120s

    kubectl delete pod "$POD_TEMPORAL" -n "$NAMESPACE" --ignore-not-found --wait=true >/dev/null 2>&1
    cat <<EOF | kubectl apply -f - >/dev/null
apiVersion: v1
kind: Pod
metadata:
  name: $POD_TEMPORAL
  namespace: $NAMESPACE
  labels:
    app: $DEPLOYMENT
spec:
  restartPolicy: Never
  containers:
  - name: restaurar
    # La MISMA imagen que el motor (ADR-0021). Un PITR restaura el directorio de
    # datos tal cual, y ese directorio trae los objetos de PostGIS en el catalogo:
    # arrancarlo con una imagen sin la biblioteca deja el motor levantado y
    # cualquier consulta que toque un objeto de la extension falla al cargarla.
    image: postgis/postgis:16-3.4-alpine
    command: ["/bin/sh", "-c", "sleep 3600"]
    env:
    - {name: WALG_S3_PREFIX, value: "$walgPrefix"}
    - {name: AWS_ENDPOINT, value: "$awsEndpoint"}
    - {name: AWS_REGION, value: "$awsRegion"}
    - {name: WALG_S3_FORCE_PATH_STYLE, value: "true"}
    - {name: WALG_COMPRESSION_METHOD, value: "lz4"}
    - {name: AWS_ACCESS_KEY_ID, valueFrom: {secretKeyRef: {name: ${DEPLOYMENT}-respaldo-credenciales, key: access-key-id}}}
    - {name: AWS_SECRET_ACCESS_KEY, valueFrom: {secretKeyRef: {name: ${DEPLOYMENT}-respaldo-credenciales, key: secret-access-key}}}
    - {name: WALG_LIBSODIUM_KEY, valueFrom: {secretKeyRef: {name: ${DEPLOYMENT}-respaldo, key: clave-cifrado}}}
    volumeMounts:
    - {name: datos, mountPath: /var/lib/postgresql/data}
  volumes:
  - name: datos
    persistentVolumeClaim: {claimName: ${DEPLOYMENT}-datos}
EOF
    kubectl wait --for=condition=Ready "pod/$POD_TEMPORAL" -n "$NAMESPACE" --timeout=60s

    echo "· Instalando wal-g en el pod temporal"
    kubectl exec -n "$NAMESPACE" "$POD_TEMPORAL" -- sh -c "
        set -e
        apk add --no-cache curl >/tmp/apk.log 2>&1 || { cat /tmp/apk.log; exit 1; }
        curl -fsSL -o /tmp/wal-g.tar.gz \
            https://github.com/wal-g/wal-g/releases/download/v${walgVersion}/wal-g-pg-ubuntu-20.04-amd64.tar.gz
        echo '${walgSha256}  /tmp/wal-g.tar.gz' | sha256sum -c -
        tar -xzf /tmp/wal-g.tar.gz -C /tmp
        mv /tmp/wal-g-pg-ubuntu-20.04-amd64 /usr/local/bin/wal-g
        chmod 755 /usr/local/bin/wal-g
    "

    echo "· Preservando PGDATA -se renombra, nunca se borra- y restaurando el respaldo base"
    kubectl exec -n "$NAMESPACE" "$POD_TEMPORAL" -- sh -c "
        set -e
        if [ -d /var/lib/postgresql/data/pgdata ]; then
            rm -rf /var/lib/postgresql/data/pgdata.antes-de-restaurar
            mv /var/lib/postgresql/data/pgdata /var/lib/postgresql/data/pgdata.antes-de-restaurar
        fi
        mkdir -p /var/lib/postgresql/data/pgdata
        chmod 700 /var/lib/postgresql/data/pgdata
        wal-g backup-fetch /var/lib/postgresql/data/pgdata LATEST
    "

    echo "· Escribiendo recovery.signal, con recovery_target_time = T_BUENO"
    kubectl exec -n "$NAMESPACE" "$POD_TEMPORAL" -- sh -c "
        set -e
        touch /var/lib/postgresql/data/pgdata/recovery.signal
        cat > /var/lib/postgresql/data/pgdata/postgresql.auto.conf <<CONF
restore_command = '/opt/wal-g/wal-g wal-fetch %f %p'
recovery_target_time = '$tBueno'
recovery_target_action = 'pause'
CONF
        chown -R postgres:postgres /var/lib/postgresql/data/pgdata
        chmod 700 /var/lib/postgresql/data/pgdata
    "
    kubectl delete pod "$POD_TEMPORAL" -n "$NAMESPACE" --wait=true >/dev/null

    # ─────────────────────────────────────────────────────────────────────
    # El motor real vuelve, con el mismo command/args que ya tenia
    # ─────────────────────────────────────────────────────────────────────
    echo
    echo "· Encendiendo el Deployment. Entra en recuperacion solo -recovery.signal ya esta ahi-"
    kubectl scale deployment "$DEPLOYMENT" -n "$NAMESPACE" --replicas=1

    pod=""
    for _ in $(seq 1 60); do
        pod=$(kubectl get pod -n "$NAMESPACE" -l app="$DEPLOYMENT" -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
        [ -n "$pod" ] && kubectl get pod -n "$NAMESPACE" "$pod" -o jsonpath='{.status.containerStatuses[0].ready}' 2>/dev/null | grep -q true && break
        sleep 2
    done
    [ -n "$pod" ] || { echo "FALLO: el pod restaurado nunca aparecio." >&2; exit 1; }

    # La misma carrera que documenta el modo local: el socket responde MUCHO antes de
    # que la reproduccion llegue al objetivo. `pg_get_wal_replay_pause_state()` es la
    # señal real.
    echo "· Esperando a que la reproduccion llegue de verdad al objetivo -no solo a que el socket responda-"
    estado=no
    for _ in $(seq 1 60); do
        if [ "$(kubectl exec -n "$NAMESPACE" "$pod" -c postgres -- env PGPASSWORD="$claveSuper" \
                psql --username=postgres --dbname="$BASE_DEL_PADRON" --tuples-only --no-align \
                --command "SELECT pg_get_wal_replay_pause_state()" 2>/dev/null)" = "paused" ]; then
            estado=si
            break
        fi
        sleep 2
    done
    [ "$estado" = "si" ] \
        || { echo "FALLO: la reproduccion del WAL no llego a 'paused' en 120s." >&2
             kubectl logs -n "$NAMESPACE" "$pod" -c postgres --tail=40 >&2
             exit 1; }

    finDelReloj=$(date +%s)
    segundos=$(( finDelReloj - inicioDelReloj ))

    # ─────────────────────────────────────────────────────────────────────
    # Lo restaurado, comprobado -paso 8-
    # ─────────────────────────────────────────────────────────────────────
    echo
    echo "· Comprobando lo restaurado"

    consultar() {
        kubectl exec -n "$NAMESPACE" "$pod" -c postgres -- env PGPASSWORD="$claveSuper" \
            psql --username=postgres --dbname="$BASE_DEL_PADRON" --tuples-only --no-align --command "$1"
    }

    [ "$(consultar "SELECT count(*) FROM contribuyente WHERE codigo_contribuyente = '$codigoBueno'")" = "1" ] \
        || { echo "FALLO: la fila BUENA no esta en lo restaurado. La reproduccion se detuvo ANTES de T_BUENO." >&2; exit 1; }
    echo "  la fila BUENA esta: correcto"

    [ "$(consultar "SELECT count(*) FROM contribuyente WHERE codigo_contribuyente = '$codigoMalo'")" = "0" ] \
        || { echo "FALLO: la fila MALA sobrevivio. El PITR no respeto T_BUENO." >&2; exit 1; }
    echo "  la fila MALA no esta: el objetivo se respeto"

    kubectl exec -n "$NAMESPACE" "$pod" -c postgres -- env PGPASSWORD="$claveSuper" \
        psql --username=postgres --dbname="$BASE_DEL_PADRON" --quiet --command "SELECT pg_wal_replay_resume()" >/dev/null
    for _ in $(seq 1 60); do
        [ "$(consultar 'SELECT pg_is_in_recovery()')" = "f" ] && break
        sleep 2
    done
    [ "$(consultar 'SELECT pg_is_in_recovery()')" = "f" ] \
        || { echo "FALLO: el motor restaurado no salio de recuperacion." >&2; exit 1; }

    kubectl exec -n "$NAMESPACE" "$pod" -c postgres -- env PGPASSWORD="$claveOwner" \
        psql --username=kamayuk_owner --dbname="$BASE_DEL_PADRON" --quiet -v ON_ERROR_STOP=1 <<SQL >/dev/null
BEGIN;
SET LOCAL app.municipalidad_id = '$MUNICIPALIDAD_DE_ENSAYO';
INSERT INTO contribuyente
    (municipalidad_id, codigo_contribuyente, tipo_documento, numero_documento,
     tipo_persona, nombre_razon_social, usuario_registro)
VALUES
    ($MUNICIPALIDAD_DE_ENSAYO, 'ENSAYO-PITR-OK$$', 'DNI', '00000003', 'NATURAL',
     'Ensayo PITR contra cluster: escritura post-restauracion', 'ensayo-158-pitr');
COMMIT;
SQL
    echo "  promovido, y admite escrituras: es un sistema, no una copia"

    # ─────────────────────────────────────────────────────────────────────
    # La restauracion queda VERIFICADA en la fila de la copia que se restauro
    # (issue #558, RF-126, RNF-079)
    #
    # «Una copia sin restauracion probada no es una copia», y hasta aqui nadie
    # lo escribia en ninguna parte: `respaldo` sabia si la copia se TOMO -lo
    # escribe el CronJob de `componentes/Respaldo.ts`- y no si alguna vez se
    # pudo RESTAURAR. Este guion es el unico proceso que lo sabe, porque es el
    # unico que restaura una copia real y comprueba lo restaurado; por eso la
    # fila la deja aqui y no el CronJob, y por eso la deja DESPUES de las
    # comprobaciones del paso 8: marcarla antes seria afirmar la verificacion
    # de un ensayo que todavia podia fallar.
    #
    # Cual copia: se restauro `LATEST` -el ultimo respaldo base-, o sea la
    # ultima fila EXITOSA del registro. El `WHERE resultado = 'EXITOSO'` no es
    # decorativo: `respaldo_verificacion_exitosa_ck` (V78) rechaza marcar una
    # FALLIDA o una EN_CURSO, asi que sin el la sentencia podria morir con un
    # 23514 despues de un simulacro correcto.
    #
    # El modo LOCAL no escribe aqui, y no es un olvido: levanta su propio motor
    # efimero con su propia tabla de ensayo, asi que lo que verifica es el
    # PROCEDIMIENTO y no ninguna copia registrada -marcar una fila desde ahi
    # diria que se restauro una copia del cluster que nadie toco-.
    #
    # Como kamayuk_owner: `respaldo_escritura` (V8) nombra solo a ese rol, y
    # `kamayuk_app` no tiene INSERT ni UPDATE a proposito (ARQ-03 §4).
    # ─────────────────────────────────────────────────────────────────────
    echo
    echo "· Dejando constancia de la restauracion verificada en la tabla respaldo (RF-126)"
    marcadas=$(kubectl exec -n "$NAMESPACE" "$pod" -c postgres -- env PGPASSWORD="$claveOwner" \
        psql --username=kamayuk_owner --dbname="$BASE_DEL_PADRON" --tuples-only --no-align -v ON_ERROR_STOP=1 <<SQL
UPDATE respaldo
   SET ultima_restauracion_verificada     = now(),
       ultima_restauracion_verificada_por = 'simulacro-de-restauracion.sh --contra-cluster ($AMBIENTE)'
 WHERE id = (SELECT id FROM respaldo WHERE resultado = 'EXITOSO' ORDER BY inicio DESC LIMIT 1)
RETURNING id;
SQL
)
    if [ -n "$marcadas" ]; then
        echo "  copia #$marcadas marcada como restauracion verificada"
    else
        # No es un fallo del simulacro: la restauracion funciono. Lo que falta es la
        # fila, y eso pasa cuando el CronJob todavia no ha corrido nunca contra este
        # ambiente. Se dice en vez de callarlo, porque la pantalla de RF-126 seguira
        # diciendo «ninguna copia registrada» y conviene saber por que.
        echo "  AVISO: no hay ninguna copia EXITOSA registrada que marcar." >&2
        echo "         La restauracion se verifico igual; lo que falta es que el CronJob" >&2
        echo "         de respaldo haya escrito su fila (RF-126)." >&2
    fi

    echo
    echo "─────────────────────────────────────────────────────────────────────"
    echo "  El simulacro de restauracion CONTRA EL CLUSTER paso (namespace «${NAMESPACE}»)."
    echo
    echo "  Tiempo de recuperacion medido: ${segundos}s"
    echo "    Desde apagar el Deployment hasta que la reproduccion del WAL llega,"
    echo "    de verdad, a T_BUENO -no solo a que el socket responda-."
    echo
    echo "  Sin limpiar, a proposito -«no en el mismo paso»-:"
    echo "    · pgdata.antes-de-restaurar sigue en el volumen de $NAMESPACE."
    echo "    · La fila BUENA ($codigoBueno) y la de escritura post-restauracion"
    echo "      quedan en el padron real."
    echo "─────────────────────────────────────────────────────────────────────"
}
