#!/usr/bin/env bash
# Publica valores normativos en parametro_tributario contra un ambiente real, corriendo el proceso
# batch PublicarParametros (backend/sgtm-parametros) como un Job de un solo uso (#188, #247 §4).
#
# Es el eslabon que faltaba: abrir-conjunto-parametros.sh sabe componer y sellar, pero componer
# NOMBRA parametros ya publicados y nada los publicaba. Sin este paso, `--sellar` no puede pasar en
# ningun ambiente: sellar exige al menos una fila en conjunto_parametro_detalle.
#
# La secuencia completa de un ejercicio, en cuatro pasos y en este orden:
#
#   1. abrir-conjunto-parametros.sh --ambiente stg --municipalidad-id 4 --ejercicio 2026
#      -> anota el CONJUNTO_ID que imprime
#   2. publicar-parametros.sh --ambiente stg \
#      --archivo docs/10-negocio/valores-normativos/publicacion/parametros-2026.csv
#   3. cargar-arancel-vial.sh --ambiente stg --municipalidad-id 4 --conjunto-id N \
#      --archivo arancel_2026.csv
#   4. abrir-conjunto-parametros.sh --ambiente stg --municipalidad-id 4 --conjunto-id N \
#      --archivo docs/10-negocio/valores-normativos/publicacion/parametros-2026.csv --sellar
#
# El paso 2 y el paso 4 llevan EL MISMO archivo, y no es una comodidad: sus tres primeras columnas
# son `tipo,clave,vigenciaDesde`, que es lo que ImportarParametrosDelConjunto lee, y las demas las
# ignora. Con dos archivos, el dia que alguien anade una fila a uno y se olvida del otro, el
# conjunto se sella sin ese valor y nadie lo nota hasta que una regla lo pide.
#
# EL ARCHIVO NO SE ESCRIBE A MANO. Es el derivado del corpus de valores normativos, y
# docs/10-negocio/verificar-publicacion.mjs comprueba en cada PR que cada una de sus cifras esta
# letra por letra en el archivo VERIFICADO del corpus que la fila nombra, con sus dos firmas. Un CSV
# traido de otra parte publicaria una cifra sin la doble lectura que ADR-0007 exige.
#
# LA CREDENCIAL. Este Job es el UNICO que corre como rol_carga_parametros. No es una preferencia:
# parametro_tributario lleva FORCE ROW LEVEL SECURITY y la unica politica de escritura de V6 nombra
# a ese rol, asi que ni kamayuk_app -que solo tiene SELECT (V7)- ni kamayuk_owner pueden insertar en ella.
# Y ese rol no alcanza nada mas: ni el conjunto, ni su detalle, ni la auditoria. Es la separacion de
# funciones SoD-1 de REQ-03, escrita en los privilegios.
#
# rol_carga_parametros tiene LOGIN desde 20-asignar-claves.sh y su clave vive en el secreto
# kamayuk-<ambiente>-postgres-carga, generado por secretos/bootstrap-secretos.sh y listado en el
# inventario de INF-06 (issue #387). El guion comprueba que el secreto exista en ESTE namespace y se
# para nombrandolo si no: montar el Job con la credencial de la aplicacion lo dejaria fallar dentro
# con un error de privilegio, y la salida comoda ante eso es darle a kamayuk_app el INSERT que no debe
# tener.
#
#   uso: publicar-parametros.sh --ambiente stg|prod --archivo parametros-2026.csv \
#        [--namespace kamayuk-stg] [--usuario nombre-del-proceso]
#
# Requiere: kubectl con el tunel al API del ambiente ya abierto.
set -euo pipefail

AMBIENTE=""
ARCHIVO=""
NAMESPACE=""
USUARIO="publicacion-parametros"
while [ $# -gt 0 ]; do
    case "$1" in
        --ambiente) AMBIENTE=${2:?falta el valor de --ambiente}; shift 2 ;;
        --archivo) ARCHIVO=${2:?falta el valor de --archivo}; shift 2 ;;
        --namespace) NAMESPACE=${2:?falta el valor de --namespace}; shift 2 ;;
        --usuario) USUARIO=${2:?falta el valor de --usuario}; shift 2 ;;
        *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
    esac
done
[ -n "$AMBIENTE" ] || { echo "Falta --ambiente (stg o prod)." >&2; exit 2; }
[ -n "$ARCHIVO" ] || {
    echo "Falta --archivo: el derivado de docs/10-negocio/valores-normativos/publicacion/." >&2
    exit 2
}
[ -f "$ARCHIVO" ] || { echo "No existe el archivo: $ARCHIVO" >&2; exit 2; }
NAMESPACE=${NAMESPACE:-kamayuk-$AMBIENTE}
SECRETO="kamayuk-${AMBIENTE}-postgres-carga"

# El derivado se comprueba contra el corpus ANTES de montarlo. Cuesta un segundo y es la diferencia
# entre publicar la norma y publicar lo que alguien escribio en un CSV.
RAIZ=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
if command -v node >/dev/null 2>&1 && [ -f "$RAIZ/docs/10-negocio/verificar-publicacion.mjs" ]; then
    echo "Comprobando $ARCHIVO contra el corpus..."
    node "$RAIZ/docs/10-negocio/verificar-publicacion.mjs" --csv "$(cd "$(dirname "$ARCHIVO")" \
        && pwd)/$(basename "$ARCHIVO")"
else
    echo "AVISO: sin node, el derivado se monta sin comprobar contra el corpus." >&2
fi

kubectl -n "$NAMESPACE" get secret "$SECRETO" >/dev/null 2>&1 || {
    cat >&2 <<EOF
No existe el secreto $SECRETO en $NAMESPACE, y sin el este Job no tiene con que conectarse.

rol_carga_parametros tiene LOGIN desde la inicializacion del motor (issue #387); lo que falta en
este namespace es el secreto con su clave. Corre, contra este ambiente:

  secretos/bootstrap-secretos.sh --ambiente $AMBIENTE

Lo que NO hay que hacer es montar este Job con la credencial de la aplicacion: kamayuk_app solo
tiene SELECT sobre parametro_tributario, y darle el INSERT que le falta pondria la publicacion
de valores normativos al alcance del proceso que atiende peticiones.
EOF
    exit 1
}

# Y que la credencial SIRVA, no solo que el secreto exista (issue #435).
#
# No es lo mismo, y la diferencia costo una corrida entera contra `stg` el 2026-08-29: el secreto
# estaba, el manifiesto lo declaraba, y `rol_carga_parametros` seguia NOLOGIN en la base porque
# `20-asignar-claves.sh` solo corre al inicializar el motor y ese cluster se habia creado antes del
# issue #387. El Job arranco, no pudo conectarse, y el proceso lo reporto como «22 filas
# rechazadas: revise que las dos firmas sean distintas». Ninguna linea decia la verdad.
CLAVE_CARGA=$(kubectl -n "$NAMESPACE" get secret "$SECRETO" -o jsonpath='{.data.clave-carga}' \
    | base64 --decode)
if ! kubectl -n "$NAMESPACE" exec "deployment/kamayuk-${AMBIENTE}-postgres" -c postgres -- \
        env PGPASSWORD="$CLAVE_CARGA" psql --host=127.0.0.1 --username=rol_carga_parametros \
        --dbname=sgtm --quiet --command 'SELECT 1' >/dev/null 2>&1; then
    cat >&2 <<EOF
El secreto $SECRETO existe, pero rol_carga_parametros NO se conecta con esa clave.

Lo mas probable es que el rol siga NOLOGIN: 20-asignar-claves.sh le da LOGIN al inicializar el
motor, y en un cluster que ya existia ese guion no vuelve a correr nunca. Llevar la credencial al
motor en marcha:

  secretos/asignar-claves.sh --ambiente $AMBIENTE

Lo que NO hay que hacer es seguir adelante: el Job arrancaria, no podria conectarse, y la corrida
terminaria diciendo que las filas fueron rechazadas por la base.
EOF
    exit 1
fi
echo "Credencial de rol_carga_parametros comprobada contra el motor."

SUFIJO=$(date +%s)
RECURSO="kamayuk-${AMBIENTE}-publicacion-parametros-${SUFIJO}"

IMAGEN=$(kubectl -n "$NAMESPACE" get deployment "kamayuk-${AMBIENTE}-aplicacion" \
    -o jsonpath='{.spec.template.spec.containers[0].image}')
[ -n "$IMAGEN" ] || {
    echo "No se pudo leer la imagen de kamayuk-${AMBIENTE}-aplicacion en $NAMESPACE" >&2
    exit 1
}
echo "Imagen desplegada: $IMAGEN"

echo "Creando ConfigMap $RECURSO con $ARCHIVO..."
kubectl -n "$NAMESPACE" create configmap "$RECURSO" --from-file=parametros.csv="$ARCHIVO"
cleanup() {
    kubectl -n "$NAMESPACE" delete configmap "$RECURSO" --ignore-not-found >/dev/null
}
trap cleanup EXIT

cat <<EOF | kubectl -n "$NAMESPACE" apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: $RECURSO
  labels:
    proyecto: sgtm
    ambiente: $AMBIENTE
    componente: publicacion-parametros
spec:
  backoffLimit: 0
  template:
    metadata:
      labels:
        proyecto: sgtm
        ambiente: $AMBIENTE
        componente: publicacion-parametros
        # Ver el mismo comentario en cargar-arancel-vial.sh: "lote" es la etiqueta que
        # NetworkPolicy "permitir-ingreso-postgres" deja pasar al puerto 5432 para un
        # Job de un solo uso; con otra etiqueta el pod arranca y la conexion cae con
        # "Connection refused".
        app: lote
    spec:
      restartPolicy: Never
      priorityClassName: kamayuk-${AMBIENTE}-prioridad-lote
      containers:
        - name: publicacion-parametros
          image: $IMAGEN
          env:
            - name: SPRING_PROFILES_ACTIVE
              value: batch
            - name: KAMAYUK_DB_URL
              value: jdbc:postgresql://kamayuk-${AMBIENTE}-postgres:5432/sgtm
            # rol_carga_parametros, y solo aqui. parametro_tributario lleva FORCE ROW LEVEL
            # SECURITY y la unica politica de escritura de V6 nombra a este rol: ni kamayuk_app
            # ni kamayuk_owner pueden insertar en ella. Y este rol no alcanza ninguna otra tabla
            # (V7), asi que este Job no puede componer ni sellar aunque quisiera.
            - name: KAMAYUK_DB_USUARIO
              value: rol_carga_parametros
            - name: KAMAYUK_DB_CLAVE
              valueFrom:
                secretKeyRef:
                  name: $SECRETO
                  key: clave-carga
            - name: KAMAYUK_PUBLICACIONPARAMETROS_ARCHIVO
              value: /datos/parametros.csv
            - name: KAMAYUK_PUBLICACIONPARAMETROS_USUARIODELPROCESO
              value: "$USUARIO"
          volumeMounts:
            - name: datos
              mountPath: /datos
              readOnly: true
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
            runAsNonRoot: true
          resources:
            requests: { cpu: "250m", memory: "256Mi" }
            limits: { cpu: "1", memory: "512Mi" }
      volumes:
        - name: datos
          configMap:
            name: $RECURSO
EOF

echo "Esperando a que $RECURSO termine..."
LIMITE=$((SECONDS + 300))
while true; do
    completo=$(kubectl -n "$NAMESPACE" get job "$RECURSO" \
        -o jsonpath='{.status.conditions[?(@.type=="Complete")].status}')
    fallido=$(kubectl -n "$NAMESPACE" get job "$RECURSO" \
        -o jsonpath='{.status.conditions[?(@.type=="Failed")].status}')
    if [ "$completo" = "True" ]; then
        echo "Completado."
        break
    fi
    if [ "$fallido" = "True" ]; then
        echo "El Job fallo. Registro:" >&2
        kubectl -n "$NAMESPACE" logs "job/$RECURSO" --tail=500 >&2
        exit 1
    fi
    [ "$SECONDS" -lt "$LIMITE" ] || {
        echo "Se agoto el tiempo de espera (300s)." >&2
        exit 1
    }
    sleep 3
done

REGISTRO=$(kubectl -n "$NAMESPACE" logs "job/$RECURSO" --tail=500)
echo "$REGISTRO"

# Las dos cifras que hay que mirar. Rechazadas > 0 no es un fallo del Job -cada fila es su propia
# transaccion, y volver a correr el archivo entero no duplica- pero SI significa que el conjunto no
# se puede componer entero todavia, y sellarlo asi congelaria un ejercicio incompleto.
RESUMEN=$(printf '%s\n' "$REGISTRO" | sed -n 's/.*\(PUBLICADAS=[0-9]\{1,\} RECHAZADAS=[0-9]\{1,\}\).*/\1/p' | tail -1)
[ -n "$RESUMEN" ] || {
    echo "El Job termino pero no dijo cuantas filas publico: revise el registro de arriba." >&2
    exit 1
}
echo
echo "$RESUMEN"
case "$RESUMEN" in
    *"RECHAZADAS=0") ;;
    *) echo "AVISO: hay filas sin publicar. Revise los motivos de arriba ANTES de sellar:" \
           "un conjunto sellado al que le falta un valor no se corrige, se sustituye." >&2 ;;
esac
echo
echo "Siguiente paso: abrir-conjunto-parametros.sh --ambiente $AMBIENTE --municipalidad-id <N>" \
    "--conjunto-id <CONJUNTO_ID> --archivo $ARCHIVO --sellar"
