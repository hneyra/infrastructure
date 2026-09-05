#!/usr/bin/env bash
# Abre -y opcionalmente compone y sella- el conjunto de parametros de un ejercicio contra un
# ambiente real, corriendo el proceso batch AbrirConjuntoDeParametros (backend/sgtm-parametros)
# como un Job de un solo uso (#247 §2).
#
# Mismo patron que cargar-arancel-vial.sh: ConfigMap efimero con el CSV, sin pasar por Pulumi.
# Es el paso PREVIO a esa carga: imprime el conjunto_id que `cargar-arancel-vial.sh --conjunto-id N`
# espera, y sin el ese N no existe.
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
# El paso 4 es el que congela el ejercicio, y es irreversible: un conjunto sellado no se modifica
# (V9) y la unica salida de un sellado equivocado es otra version. Por eso --sellar es explicito.
#
# El archivo NO lleva ninguna cifra a este proceso: lee las tres primeras columnas,
# `tipo,clave,vigenciaDesde`, que NOMBRAN valores normativos ya publicados en parametro_tributario,
# e ignora las demas. Publicarlos es el paso 2, que corre como rol_carga_parametros con la doble
# firma que el corpus ya lleva (REQ-03, ADR-0007, #188); este proceso solo decide cuales componen el
# ejercicio. Por eso los dos pasos usan EL MISMO archivo: con dos, el dia que alguien anade una fila
# a uno y se olvida del otro, el conjunto se sella sin ese valor.
#
#   uso: abrir-conjunto-parametros.sh --ambiente stg|prod --municipalidad-id N \
#        (--ejercicio AAAA | --conjunto-id N) [--archivo parametros_2026.csv] [--sellar] \
#        [--namespace kamayuk-stg] [--observacion "..."]
#
# Requiere: la municipalidad ya implantada, y kubectl con el tunel al API del ambiente ya abierto.
set -euo pipefail

AMBIENTE=""
MUNICIPALIDAD_ID=""
EJERCICIO=""
CONJUNTO_ID=""
ARCHIVO=""
SELLAR="false"
NAMESPACE=""
OBSERVACION="Apertura del conjunto de parametros del ejercicio"
while [ $# -gt 0 ]; do
    case "$1" in
        --ambiente) AMBIENTE=${2:?falta el valor de --ambiente}; shift 2 ;;
        --municipalidad-id) MUNICIPALIDAD_ID=${2:?falta el valor de --municipalidad-id}; shift 2 ;;
        --ejercicio) EJERCICIO=${2:?falta el valor de --ejercicio}; shift 2 ;;
        --conjunto-id) CONJUNTO_ID=${2:?falta el valor de --conjunto-id}; shift 2 ;;
        --archivo) ARCHIVO=${2:?falta el valor de --archivo}; shift 2 ;;
        --sellar) SELLAR="true"; shift ;;
        --namespace) NAMESPACE=${2:?falta el valor de --namespace}; shift 2 ;;
        --observacion) OBSERVACION=${2:?falta el valor de --observacion}; shift 2 ;;
        *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
    esac
done
[ -n "$AMBIENTE" ] || { echo "Falta --ambiente (stg o prod)." >&2; exit 2; }
[ -n "$MUNICIPALIDAD_ID" ] || { echo "Falta --municipalidad-id." >&2; exit 2; }
if [ -n "$EJERCICIO" ] && [ -n "$CONJUNTO_ID" ]; then
    echo "--ejercicio abre una version nueva y --conjunto-id opera sobre una ya abierta:" \
        "serian dos conjuntos, y uno quedaria a medio componer. Use uno de los dos." >&2
    exit 2
fi
if [ -z "$EJERCICIO" ] && [ -z "$CONJUNTO_ID" ]; then
    echo "Falta --ejercicio (para abrir una version) o --conjunto-id (para operar sobre una" \
        "ya abierta)." >&2
    exit 2
fi
if [ "$SELLAR" = "true" ] && [ -z "$ARCHIVO" ] && [ -n "$EJERCICIO" ]; then
    echo "Abrir una version y sellarla sin componerla es sellar un conjunto vacio: diria que el" \
        "ejercicio esta parametrizado cuando el calculo no encontraria ni un valor." >&2
    exit 2
fi
if [ -n "$ARCHIVO" ] && [ ! -f "$ARCHIVO" ]; then
    echo "No existe el archivo: $ARCHIVO" >&2
    exit 2
fi
NAMESPACE=${NAMESPACE:-kamayuk-$AMBIENTE}

SUFIJO=$(date +%s)
RECURSO="kamayuk-${AMBIENTE}-conjunto-parametros-${SUFIJO}"

IMAGEN=$(kubectl -n "$NAMESPACE" get deployment "kamayuk-${AMBIENTE}-aplicacion" \
    -o jsonpath='{.spec.template.spec.containers[0].image}')
[ -n "$IMAGEN" ] || {
    echo "No se pudo leer la imagen de kamayuk-${AMBIENTE}-aplicacion en $NAMESPACE" >&2
    exit 1
}
echo "Imagen desplegada: $IMAGEN"

# El ConfigMap solo existe si hay archivo: abrir una version no necesita ninguno.
MONTAJE_ENV=""
MONTAJE_VOLUMEN=""
MONTAJE_VOLUMENES=""
if [ -n "$ARCHIVO" ]; then
    echo "Creando ConfigMap $RECURSO con $ARCHIVO..."
    kubectl -n "$NAMESPACE" create configmap "$RECURSO" --from-file=parametros.csv="$ARCHIVO"
    cleanup() {
        kubectl -n "$NAMESPACE" delete configmap "$RECURSO" --ignore-not-found >/dev/null
    }
    trap cleanup EXIT
    MONTAJE_ENV=$(cat <<EOF

            - name: KAMAYUK_CONJUNTOPARAMETROS_ARCHIVO
              value: /datos/parametros.csv
EOF
)
    MONTAJE_VOLUMEN=$(cat <<EOF

          volumeMounts:
            - name: datos
              mountPath: /datos
              readOnly: true
EOF
)
    MONTAJE_VOLUMENES=$(cat <<EOF

      volumes:
        - name: datos
          configMap:
            name: $RECURSO
EOF
)
fi

cat <<EOF | kubectl -n "$NAMESPACE" apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: $RECURSO
  labels:
    proyecto: sgtm
    ambiente: $AMBIENTE
    componente: conjunto-parametros
spec:
  backoffLimit: 0
  template:
    metadata:
      labels:
        proyecto: sgtm
        ambiente: $AMBIENTE
        componente: conjunto-parametros
        # Ver el mismo comentario en cargar-arancel-vial.sh: "lote" es la etiqueta que
        # NetworkPolicy "permitir-ingreso-postgres" deja pasar al puerto 5432 para un
        # Job de un solo uso; con otra etiqueta el pod arranca y la conexion cae con
        # "Connection refused".
        app: lote
    spec:
      restartPolicy: Never
      priorityClassName: kamayuk-${AMBIENTE}-prioridad-lote
      containers:
        - name: conjunto-parametros
          image: $IMAGEN
          env:
            - name: SPRING_PROFILES_ACTIVE
              value: batch
            - name: KAMAYUK_DB_URL
              value: jdbc:postgresql://kamayuk-${AMBIENTE}-postgres:5432/sgtm
            # kamayuk_app basta: conjunto_parametros y conjunto_parametro_detalle son tablas que
            # la aplicacion escribe (V7). Publicar un valor normativo si exigiria
            # rol_carga_parametros, y este proceso no publica ninguno.
            - name: KAMAYUK_DB_USUARIO
              value: kamayuk_app
            - name: KAMAYUK_DB_CLAVE
              valueFrom:
                secretKeyRef:
                  name: kamayuk-${AMBIENTE}-postgres-app
                  key: clave-app
            - name: KAMAYUK_CONJUNTOPARAMETROS_MUNICIPALIDADID
              value: "$MUNICIPALIDAD_ID"
            - name: KAMAYUK_CONJUNTOPARAMETROS_EJERCICIO
              value: "${EJERCICIO:-0}"
            - name: KAMAYUK_CONJUNTOPARAMETROS_CONJUNTOID
              value: "${CONJUNTO_ID:-0}"
            - name: KAMAYUK_CONJUNTOPARAMETROS_SELLAR
              value: "$SELLAR"
            - name: KAMAYUK_CONJUNTOPARAMETROS_USUARIODELPROCESO
              value: conjunto-parametros
            - name: KAMAYUK_CONJUNTOPARAMETROS_OBSERVACION
              value: "$OBSERVACION"$MONTAJE_ENV$MONTAJE_VOLUMEN
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
            runAsNonRoot: true
          resources:
            requests: { cpu: "250m", memory: "256Mi" }
            limits: { cpu: "1", memory: "512Mi" }$MONTAJE_VOLUMENES
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

# La linea que hay que anotar: es el N de `cargar-arancel-vial.sh --conjunto-id N`. Se extrae en
# vez de dejarla dentro del registro porque el paso siguiente la necesita a mano, y buscarla a ojo
# entre las lineas de arranque de Spring es como se acaba escribiendo el numero equivocado.
ID=$(printf '%s\n' "$REGISTRO" | sed -n 's/.*CONJUNTO_ID=\([0-9]\{1,\}\).*/\1/p' | tail -1)
[ -n "$ID" ] || {
    echo "El Job termino pero no dijo ningun CONJUNTO_ID: revise el registro de arriba." >&2
    exit 1
}
echo
echo "conjunto_id = $ID"
echo "Siguiente paso: publicar-parametros.sh --ambiente $AMBIENTE" \
    "--archivo docs/10-negocio/valores-normativos/publicacion/parametros-<ejercicio>.csv"
echo "Y despues:     cargar-arancel-vial.sh --ambiente $AMBIENTE" \
    "--municipalidad-id $MUNICIPALIDAD_ID --conjunto-id $ID --archivo arancel_<ejercicio>.csv"
