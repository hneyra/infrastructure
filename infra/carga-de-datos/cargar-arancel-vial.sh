#!/usr/bin/env bash
# Carga el arancel de terreno por via de un ejercicio contra un ambiente real, corriendo
# el proceso batch CargarArancelVial (backend/sgtm-catastro) como un Job de un solo uso.
#
# Mismo patron que cargar-catalogo-vial.sh: ConfigMap efimero con el CSV, sin pasar por
# Pulumi. A diferencia del catalogo vial, esta carga cuelga de un conjunto de parametros
# YA ABIERTO -este guion no lo abre ni lo sella: eso es AdministrarParametros.abrirVersion,
# del modulo parametros (ver docs/10-negocio/valores-normativos/aranceles-2026.md S1.4)-.
# El conjunto-id lo imprime abrir-conjunto-parametros.sh, que es el paso previo a este (#247).
#
#   uso: cargar-arancel-vial.sh --ambiente stg|prod --municipalidad-id N --conjunto-id N \
#        --archivo arancel_2026.csv [--namespace sgtm-stg] [--observacion "..."]
#
# Requiere: el catalogo vial de la municipalidad ya cargado (RegistrarArancel resuelve
# cada via por codigo), y kubectl con el tunel al API del ambiente ya abierto.
set -euo pipefail

AMBIENTE=""
MUNICIPALIDAD_ID=""
CONJUNTO_ID=""
ARCHIVO=""
NAMESPACE=""
OBSERVACION="Carga del arancel de terreno por via, plano grafico del MEF"
while [ $# -gt 0 ]; do
    case "$1" in
        --ambiente) AMBIENTE=${2:?falta el valor de --ambiente}; shift 2 ;;
        --municipalidad-id) MUNICIPALIDAD_ID=${2:?falta el valor de --municipalidad-id}; shift 2 ;;
        --conjunto-id) CONJUNTO_ID=${2:?falta el valor de --conjunto-id}; shift 2 ;;
        --archivo) ARCHIVO=${2:?falta el valor de --archivo}; shift 2 ;;
        --namespace) NAMESPACE=${2:?falta el valor de --namespace}; shift 2 ;;
        --observacion) OBSERVACION=${2:?falta el valor de --observacion}; shift 2 ;;
        *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
    esac
done
[ -n "$AMBIENTE" ] || { echo "Falta --ambiente (stg o prod)." >&2; exit 2; }
[ -n "$MUNICIPALIDAD_ID" ] || { echo "Falta --municipalidad-id." >&2; exit 2; }
[ -n "$CONJUNTO_ID" ] || {
    echo "Falta --conjunto-id. Lo abre antes abrir-conjunto-parametros.sh" \
        "--ejercicio AAAA, que imprime el numero; nunca este guion." >&2
    exit 2
}
[ -n "$ARCHIVO" ] || {
    echo "Falta --archivo (el CSV viaCodigo,tramo,valorM2,documentoFuente)." >&2
    exit 2
}
[ -f "$ARCHIVO" ] || { echo "No existe el archivo: $ARCHIVO" >&2; exit 2; }
NAMESPACE=${NAMESPACE:-sgtm-$AMBIENTE}

SUFIJO=$(date +%s)
RECURSO="sgtm-${AMBIENTE}-carga-arancel-${SUFIJO}"

IMAGEN=$(kubectl -n "$NAMESPACE" get deployment "sgtm-${AMBIENTE}-aplicacion" \
    -o jsonpath='{.spec.template.spec.containers[0].image}')
[ -n "$IMAGEN" ] || {
    echo "No se pudo leer la imagen de sgtm-${AMBIENTE}-aplicacion en $NAMESPACE" >&2
    exit 1
}
echo "Imagen desplegada: $IMAGEN"

echo "Creando ConfigMap $RECURSO con $ARCHIVO..."
kubectl -n "$NAMESPACE" create configmap "$RECURSO" --from-file=arancel.csv="$ARCHIVO"

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
    componente: carga-arancel
spec:
  backoffLimit: 0
  template:
    metadata:
      labels:
        proyecto: sgtm
        ambiente: $AMBIENTE
        componente: carga-arancel
        # Ver el mismo comentario en cargar-catalogo-vial.sh: "lote" es la etiqueta que
        # NetworkPolicy "permitir-ingreso-postgres" deja pasar al puerto 5432 para un
        # Job de un solo uso; con otra etiqueta el pod arranca y la conexion cae con
        # "Connection refused".
        app: lote
    spec:
      restartPolicy: Never
      priorityClassName: sgtm-${AMBIENTE}-prioridad-lote
      containers:
        - name: carga-arancel
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
            - name: SGTM_CARGAARANCEL_MUNICIPALIDADID
              value: "$MUNICIPALIDAD_ID"
            - name: SGTM_CARGAARANCEL_CONJUNTOID
              value: "$CONJUNTO_ID"
            - name: SGTM_CARGAARANCEL_ARCHIVO
              value: /datos/arancel.csv
            - name: SGTM_CARGAARANCEL_USUARIODELPROCESO
              value: carga-arancel
            - name: SGTM_CARGAARANCEL_OBSERVACION
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
