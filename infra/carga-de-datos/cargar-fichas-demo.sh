#!/usr/bin/env bash
# Siembra predios y fichas FICTICIOS en una instalacion de demostracion (#290), corriendo
# el proceso batch CargarFichasDeDemostracion (backend/sgtm-catastro) como un Job de un
# solo uso.
#
# Mismo patron que cargar-catalogo-vial.sh, con la misma guarda que
# cargar-contribuyentes-demo.sh: el proceso pregunta por municipalidad.es_demostracion
# antes de leer una sola fila, y si la municipalidad no esta marcada NO ESCRIBE NADA.
#
# ORDEN: este guion va EL ULTIMO. Cada fila nombra su sector, su manzana, su via y su
# contribuyente por codigo, asi que antes tienen que haber corrido cargar-catalogo-vial.sh,
# cargar-sectores.sh, cargar-manzanas.sh y cargar-contribuyentes-demo.sh.
#
# LO QUE NO SIEMBRA: ni aranceles, ni valores unitarios de edificacion, ni tablas de
# depreciacion. Son valores normativos (D-02a, D-13) y sus pantallas tienen que seguir
# diciendo "sin conjunto sellado". Para el arancel real, cuando D-02a se cierre, esta
# cargar-arancel-vial.sh, que exige un conjunto de parametros ya abierto.
#
#   uso: cargar-fichas-demo.sh --ambiente stg|prod --municipalidad-id N \
#        --archivo ejemplos/fichas.csv [--namespace sgtm-stg] [--observacion "..."]
#
# Requiere: kubectl con el tunel al API del ambiente ya abierto (ver infra/README.md).
set -euo pipefail

AMBIENTE=""
MUNICIPALIDAD_ID=""
ARCHIVO=""
NAMESPACE=""
OBSERVACION="Siembra de predios y fichas ficticios para la demostracion (#290)"
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
[ -n "$ARCHIVO" ] || { echo "Falta --archivo (el CSV de predios fichados ficticios; hay uno en ejemplos/fichas.csv)." >&2; exit 2; }
[ -f "$ARCHIVO" ] || { echo "No existe el archivo: $ARCHIVO" >&2; exit 2; }
NAMESPACE=${NAMESPACE:-sgtm-$AMBIENTE}

SUFIJO=$(date +%s)
RECURSO="sgtm-${AMBIENTE}-carga-demo-fichas-${SUFIJO}"

IMAGEN=$(kubectl -n "$NAMESPACE" get deployment "sgtm-${AMBIENTE}-aplicacion" \
    -o jsonpath='{.spec.template.spec.containers[0].image}')
[ -n "$IMAGEN" ] || {
    echo "No se pudo leer la imagen de sgtm-${AMBIENTE}-aplicacion en $NAMESPACE" >&2
    exit 1
}
echo "Imagen desplegada: $IMAGEN"

echo "Creando ConfigMap $RECURSO con $ARCHIVO..."
kubectl -n "$NAMESPACE" create configmap "$RECURSO" --from-file=fichas.csv="$ARCHIVO"

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
    componente: carga-demo-fichas
spec:
  backoffLimit: 0
  template:
    metadata:
      labels:
        proyecto: sgtm
        ambiente: $AMBIENTE
        componente: carga-demo-fichas
        # NetworkPolicy "permitir-ingreso-postgres" (infra/componentes/Red.ts) solo deja
        # pasar al puerto 5432 a pods con app en {aplicacion, identidad, migracion,
        # implantacion, lote, respaldo}: "lote" es la etiqueta generica para un Job de
        # un solo uso que necesita hablar con la base. Con "carga-demo-fichas" el pod arranca
        # pero la conexion cae con "Connection refused" -denegacion por omision
        # funcionando como se disenio, no un error de credenciales.
        app: lote
    spec:
      restartPolicy: Never
      priorityClassName: sgtm-${AMBIENTE}-prioridad-lote
      containers:
        - name: carga-demo-fichas
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
            - name: SGTM_CARGAFICHASDEMO_MUNICIPALIDADID
              value: "$MUNICIPALIDAD_ID"
            - name: SGTM_CARGAFICHASDEMO_ARCHIVO
              value: /datos/fichas.csv
            - name: SGTM_CARGAFICHASDEMO_USUARIODELPROCESO
              value: carga-demostracion
            - name: SGTM_CARGAFICHASDEMO_OBSERVACION
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
