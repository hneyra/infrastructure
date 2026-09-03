#!/usr/bin/env bash
# Siembra el SALDO INICIAL FICTICIO del libro de cuenta corriente en una instalacion de
# demostracion, corriendo el proceso batch CargarDeudaDeDemostracion (backend/sgtm-rentas)
# como un Job de un solo uso.
#
# Misma guarda que cargar-fichas-demo.sh: el proceso pregunta por municipalidad.es_demostracion
# antes de leer una sola fila, y si la municipalidad no esta marcada NO ESCRIBE NADA.
#
# ORDEN: el ULTIMO de la secuencia. Cada fila nombra a su contribuyente por codigo y su unidad
# —predio por codigo catastral, vehiculo por placa—, resuelta A LA FECHA VALOR de la fila.
#
# QUE CIFRA ES ESTA: el monto entra como DATO, no lo calcula nadie. Es el mismo acto que la
# pantalla "Alta de deuda" publica (RF-043), y por eso no depende de D-02a ni de D-11: no hay
# tramo, ni alicuota, ni UIT de por medio. Estas filas NO emiten resolucion de determinacion
# ni escriben en `determinacion`: una deuda sembrada asi se cobra y se lee, pero el sistema no
# reclama haber aplicado ninguna regla para llegar a ella.
#
#   uso: cargar-deuda-demo.sh --ambiente stg|prod --municipalidad-id N \
#        --archivo ejemplos/deuda.csv [--namespace sgtm-stg] [--observacion "..."]
#
# Requiere: kubectl con el tunel al API del ambiente ya abierto (ver infra/README.md).
set -euo pipefail

AMBIENTE=""
MUNICIPALIDAD_ID=""
ARCHIVO=""
NAMESPACE=""
OBSERVACION="Siembra del saldo inicial ficticio del libro para la demostracion"
while [ $# -gt 0 ]; do
    case "$1" in
        --ambiente) AMBIENTE=${2:?falta el valor de --ambiente}; shift 2 ;;
        --municipalidad-id) MUNICIPALIDAD_ID=${2:?falta el valor de --municipalidad-id}; shift 2 ;;
        --archivo) ARCHIVO=${2:?falta el valor de --archivo}; shift 2 ;;
        --namespace) NAMESPACE=${2:?falta el valor de --namespace}; shift 2 ;;
        --observacion) OBSERVACION=${2:?falta el valor de --observacion}; shift 2 ;;
        *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
    esac
done
[ -n "$AMBIENTE" ] || { echo "Falta --ambiente (stg o prod)." >&2; exit 2; }
[ -n "$MUNICIPALIDAD_ID" ] || { echo "Falta --municipalidad-id." >&2; exit 2; }
[ -n "$ARCHIVO" ] || { echo "Falta --archivo (el CSV del saldo inicial ficticio; hay uno en ejemplos/deuda.csv)." >&2; exit 2; }
[ -f "$ARCHIVO" ] || { echo "No existe el archivo: $ARCHIVO" >&2; exit 2; }
NAMESPACE=${NAMESPACE:-sgtm-$AMBIENTE}

SUFIJO=$(date +%s)
RECURSO="sgtm-${AMBIENTE}-carga-demo-deuda-${SUFIJO}"

IMAGEN=$(kubectl -n "$NAMESPACE" get deployment "sgtm-${AMBIENTE}-aplicacion" \
    -o jsonpath='{.spec.template.spec.containers[0].image}')
[ -n "$IMAGEN" ] || {
    echo "No se pudo leer la imagen de sgtm-${AMBIENTE}-aplicacion en $NAMESPACE" >&2
    exit 1
}
echo "Imagen desplegada: $IMAGEN"

echo "Creando ConfigMap $RECURSO con $ARCHIVO..."
kubectl -n "$NAMESPACE" create configmap "$RECURSO" --from-file=deuda.csv="$ARCHIVO"

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
    componente: carga-demo-deuda
spec:
  backoffLimit: 0
  template:
    metadata:
      labels:
        proyecto: sgtm
        ambiente: $AMBIENTE
        componente: carga-demo-deuda
        # NetworkPolicy "permitir-ingreso-postgres" (infra/componentes/Red.ts) solo deja
        # pasar al puerto 5432 a pods con app en {aplicacion, identidad, migracion,
        # implantacion, lote, respaldo}: "lote" es la etiqueta generica para un Job de
        # un solo uso que necesita hablar con la base. Con "carga-demo-deuda" el pod arranca
        # pero la conexion cae con "Connection refused" -denegacion por omision
        # funcionando como se disenio, no un error de credenciales.
        app: lote
    spec:
      restartPolicy: Never
      priorityClassName: sgtm-${AMBIENTE}-prioridad-lote
      containers:
        - name: carga-demo-deuda
          image: $IMAGEN
          env:
            - name: SPRING_PROFILES_ACTIVE
              value: batch
            - name: SGTM_DB_URL
              value: jdbc:postgresql://sgtm-${AMBIENTE}-postgres:5432/sgtm
            - name: SGTM_DB_USUARIO
              value: sgtm_app
            - name: SGTM_DB_CLAVE
              valueFrom:
                secretKeyRef:
                  name: sgtm-${AMBIENTE}-postgres-app
                  key: clave-app
            - name: SGTM_CARGADEUDADEMO_MUNICIPALIDADID
              value: "$MUNICIPALIDAD_ID"
            - name: SGTM_CARGADEUDADEMO_ARCHIVO
              value: /datos/deuda.csv
            - name: SGTM_CARGADEUDADEMO_USUARIODELPROCESO
              value: carga-demostracion
            - name: SGTM_CARGADEUDADEMO_OBSERVACION
              value: "$OBSERVACION"
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

kubectl -n "$NAMESPACE" logs "job/$RECURSO" --tail=500
