#!/usr/bin/env bash
# Carga los lotes del plano catastral de una municipalidad contra un ambiente real
# (ADR-0021, #400), corriendo el proceso batch CargarPredios (backend/sgtm-catastro)
# como un Job de un solo uso.
#
# Es el camino por el que una municipalidad de VERDAD puebla su catastro. Antes de esto
# el unico importador de predios era CargarFichasDeDemostracion, que exige
# municipalidad.es_demostracion = true y por tanto no escribe nada en una instalacion
# real: el caso de uso estaba y no habia por donde llamarlo, el mismo hueco que #430
# encontro para area y caja.
#
# Y por eso este guion NO exige --es-demostracion ni nada parecido, a diferencia de los
# seis pasos de sembrar-demostracion.sh: el plano catastral de una municipalidad no es un
# dato inventado, es su padron.
#
# El CSV lo produce scripts/catastro/importar_predios_gpkg.py a partir del GeoPackage del
# plano. Conviene leer el resumen.txt que deja al lado ANTES de correr esto: dice cuantos
# lotes salieron, cuales quedaron fuera y sobre que rectangulo caen -- si ese rectangulo
# no es el del distrito, el plano no es el que se creia.
#
# Un lote sobre un predio que YA existe no reescribe su direccion ni su ubicacion: solo
# le pone el poligono. Lo que corrigio alguien en ventanilla no lo pisa un archivo.
#
#   uso: cargar-predios.sh --ambiente stg|prod --municipalidad-id N --archivo predios.csv
#        [--namespace sgtm-stg] [--observacion "..."]
#
# Requiere: kubectl con el tunel al API del ambiente ya abierto (ver infra/README.md),
# y el mismo kubeconfig que usa pulumi up.
set -euo pipefail

AMBIENTE=""
MUNICIPALIDAD_ID=""
ARCHIVO=""
NAMESPACE=""
OBSERVACION="Carga de lotes desde el plano catastral (ADR-0021)"
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
[ -n "$ARCHIVO" ] || { echo "Falta --archivo (el CSV que produce importar_predios_gpkg.py)." >&2; exit 2; }
[ -f "$ARCHIVO" ] || { echo "No existe el archivo: $ARCHIVO" >&2; exit 2; }
NAMESPACE=${NAMESPACE:-sgtm-$AMBIENTE}

SUFIJO=$(date +%s)
RECURSO="sgtm-${AMBIENTE}-carga-predios-${SUFIJO}"

IMAGEN=$(kubectl -n "$NAMESPACE" get deployment "sgtm-${AMBIENTE}-aplicacion" \
    -o jsonpath='{.spec.template.spec.containers[0].image}')
[ -n "$IMAGEN" ] || {
    echo "No se pudo leer la imagen de sgtm-${AMBIENTE}-aplicacion en $NAMESPACE" >&2
    exit 1
}
echo "Imagen desplegada: $IMAGEN"

echo "Creando ConfigMap $RECURSO con $ARCHIVO..."
kubectl -n "$NAMESPACE" create configmap "$RECURSO" --from-file=predios.csv="$ARCHIVO"

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
    componente: carga-predios
spec:
  backoffLimit: 0
  template:
    metadata:
      labels:
        proyecto: sgtm
        ambiente: $AMBIENTE
        componente: carga-predios
        # NetworkPolicy "permitir-ingreso-postgres" (infra/componentes/Red.ts) solo deja
        # pasar al puerto 5432 a pods con app en {aplicacion, identidad, migracion,
        # implantacion, lote, respaldo}: "lote" es la etiqueta generica para un Job de
        # un solo uso que necesita hablar con la base. Con "carga-predios" el pod arranca
        # pero la conexion cae con "Connection refused" -denegacion por omision
        # funcionando como se disenio, no un error de credenciales.
        app: lote
    spec:
      restartPolicy: Never
      priorityClassName: sgtm-${AMBIENTE}-prioridad-lote
      containers:
        - name: carga-predios
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
            - name: SGTM_CARGAPREDIOS_MUNICIPALIDADID
              value: "$MUNICIPALIDAD_ID"
            - name: SGTM_CARGAPREDIOS_ARCHIVO
              value: /datos/predios.csv
            - name: SGTM_CARGAPREDIOS_USUARIODELPROCESO
              value: carga-predios
            - name: SGTM_CARGAPREDIOS_OBSERVACION
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
