#!/usr/bin/env bash
# Publica un CUADRO normativo nacional -miles de filas- contra un ambiente real, corriendo el
# proceso batch PublicarCuadros (backend/sgtm-parametros) como un Job de un solo uso (D-13,
# ADR-0017; #188).
#
# Es el hermano de publicar-parametros.sh para lo que no cabe en una fila. Aquel publica la UIT y
# los tramos, once filas con su cifra en el derivado; un cuadro tiene miles y su derivado es el
# archivo mecanico de la fuente, con su sha256 firmado en el corpus.
#
# QUE ES UNA EDICION. La resolucion entera -"la Tabla de Valores Referenciales del ejercicio 2026"-,
# representada como UNA fila de parametro_tributario. Las miles de filas del cuadro cuelgan de ella
# por publicacion_id. Por eso componerla en un conjunto sellado es la MISMA fila de
# conjunto_parametro_detalle con la que se compone la UIT: no hay mecanismo nuevo (D-13).
#
# La secuencia completa de un ejercicio, en cinco pasos y en este orden:
#
#   1. abrir-conjunto-parametros.sh --ambiente stg --municipalidad-id 4 --ejercicio 2026
#      -> anota el CONJUNTO_ID que imprime
#   2. publicar-parametros.sh --ambiente stg \
#      --archivo docs/10-negocio/valores-normativos/publicacion/parametros-2026.csv
#   3. publicar-cuadros.sh --ambiente stg \
#      --archivo docs/10-negocio/valores-normativos/publicacion/cuadros-2026.csv
#   4. cargar-arancel-vial.sh --ambiente stg --municipalidad-id 4 --conjunto-id N \
#      --archivo arancel_2026.csv
#   5. abrir-conjunto-parametros.sh --ambiente stg --municipalidad-id 4 --conjunto-id N \
#      --archivo docs/10-negocio/valores-normativos/publicacion/cuadros-2026.csv --sellar
#
# El paso 3 y el paso 5 llevan EL MISMO archivo, por lo mismo que el 2 y el 5 con parametros-2026:
# sus columnas `tipo,clave,vigencia_desde` son las que ImportarParametrosDelConjunto lee, y las
# demas las ignora. Con dos archivos, el dia que alguien cambia uno y se olvida del otro, el
# conjunto se sella nombrando una edicion que no es la que se publico.
#
# EL ARCHIVO NO SE ESCRIBE A MANO. Es el manifiesto del corpus, y
# docs/10-negocio/verificar-cuadros.mjs comprueba en cada PR que su archivo del corpus este
# VERIFICADO, que las dos firmas sean las de su cabecera, que el documento fuente aparezca en el, y
# que el sha256 del archivo de filas sea el que el corpus firmo. El proceso lo vuelve a calcular
# antes de publicar una sola fila: un byte distinto en un cuadro normativo se investiga.
#
# LA CREDENCIAL. Este Job es el UNICO que corre como rol_carga_parametros. No es una preferencia:
# parametro_tributario lleva FORCE ROW LEVEL SECURITY y la unica politica de escritura de V6 nombra
# a ese rol, asi que ni sgtm_app -que solo tiene SELECT (V7)- ni sgtm_owner pueden insertar en ella.
# Y ese rol no alcanza nada mas: ni el conjunto, ni su detalle, ni la auditoria. Es la separacion de
# funciones SoD-1 de REQ-03, escrita en los privilegios.
#
# rol_carga_parametros tiene LOGIN desde 20-asignar-claves.sh y su clave vive en el secreto
# sgtm-<ambiente>-postgres-carga, generado por secretos/bootstrap-secretos.sh y listado en el
# inventario de INF-06 (issue #387). El guion comprueba que el secreto exista en ESTE namespace y se
# para nombrandolo si no: montar el Job con la credencial de la aplicacion lo dejaria fallar dentro
# con un error de privilegio, y la salida comoda ante eso es darle a sgtm_app el INSERT que no debe
# tener.
#
#   uso: publicar-cuadros.sh --ambiente stg|prod --archivo cuadros-2026.csv \
#        [--namespace sgtm-stg] [--usuario nombre-del-proceso] [--region-s3 us-east-1]
#
# Requiere: kubectl con el tunel al API del ambiente ya abierto.
set -euo pipefail

AMBIENTE=""
ARCHIVO=""
NAMESPACE=""
USUARIO="publicacion-cuadros"
while [ $# -gt 0 ]; do
    case "$1" in
        --ambiente) AMBIENTE=${2:?falta el valor de --ambiente}; shift 2 ;;
        --archivo) ARCHIVO=${2:?falta el valor de --archivo}; shift 2 ;;
        --namespace) NAMESPACE=${2:?falta el valor de --namespace}; shift 2 ;;
        --usuario) USUARIO=${2:?falta el valor de --usuario}; shift 2 ;;
        # Solo lo usa el initContainer que descarga de S3 (issue #388), y solo cuando alguna fila
        # viene de ahi: sin eso, un contenedor sin ~/.aws/config no sabe a que endpoint regional
        # hablarle. Por omision us-east-1, el mismo que asume un bucket sin region configurada.
        --region-s3) REGION_S3=${2:?falta el valor de --region-s3}; shift 2 ;;
        *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
    esac
done
REGION_S3=${REGION_S3:-us-east-1}
[ -n "$AMBIENTE" ] || { echo "Falta --ambiente (stg o prod)." >&2; exit 2; }
[ -n "$ARCHIVO" ] || {
    echo "Falta --archivo: el manifiesto de docs/10-negocio/valores-normativos/publicacion/." >&2
    exit 2
}
[ -f "$ARCHIVO" ] || { echo "No existe el archivo: $ARCHIVO" >&2; exit 2; }
NAMESPACE=${NAMESPACE:-sgtm-$AMBIENTE}
SECRETO="sgtm-${AMBIENTE}-postgres-carga"

# El derivado se comprueba contra el corpus ANTES de montarlo. Cuesta un segundo y es la diferencia
# entre publicar la norma y publicar lo que alguien escribio en un CSV.
RAIZ=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
if command -v node >/dev/null 2>&1 && [ -f "$RAIZ/docs/10-negocio/verificar-cuadros.mjs" ]; then
    echo "Comprobando $ARCHIVO contra el corpus..."
    node "$RAIZ/docs/10-negocio/verificar-cuadros.mjs" --csv "$(cd "$(dirname "$ARCHIVO")" \
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

Lo que NO hay que hacer es montar este Job con la credencial de la aplicacion: sgtm_app solo
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
if ! kubectl -n "$NAMESPACE" exec "deployment/sgtm-${AMBIENTE}-postgres" -c postgres -- \
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
RECURSO="sgtm-${AMBIENTE}-publicacion-cuadros-${SUFIJO}"

IMAGEN=$(kubectl -n "$NAMESPACE" get deployment "sgtm-${AMBIENTE}-aplicacion" \
    -o jsonpath='{.spec.template.spec.containers[0].image}')
[ -n "$IMAGEN" ] || {
    echo "No se pudo leer la imagen de sgtm-${AMBIENTE}-aplicacion en $NAMESPACE" >&2
    exit 1
}
echo "Imagen desplegada: $IMAGEN"

# EL ARCHIVO DE FILAS, MONTADO DONDE PublicarCuadros LO SABE ENCONTRAR (issue #388).
#
# `edicion.archivoDeFilas()` es la columna `archivo_de_filas` del manifiesto TAL CUAL, y
# `PublicarCuadros` la resuelve como *sibling* del propio manifiesto
# (`manifiesto.resolveSibling(...)`: `publicacion/cuadros-2026.csv` nombra
# `../fuentes/tvr-2026/tvr-2026.csv`). Montar SOLO el manifiesto —lo que este guion hacia hasta
# ahora— nunca habria funcionado ni con un cuadro pequeno: el archivo de filas no estaria en
# ninguna parte del volumen. Un initContainer arma el arbol relativo completo en un `emptyDir`
# ANTES de que el contenedor principal arranque, montando el manifiesto un nivel por debajo de la
# raiz (`/datos/publicacion/cuadros.csv`) para que esa resolucion de *sibling* caiga DENTRO del
# volumen —`/datos/fuentes/...`— en vez de fuera de el.
#
# EL MANIFIESTO NO CAMBIA DE FORMA. `archivo_de_filas` sigue siendo la misma ruta relativa de
# siempre, nunca una URI: es lo que docs/10-negocio/verificar-cuadros.mjs ya comprueba letra por
# letra contra el corpus, y reescribirla ahi seria reescribir un derivado firmado. Lo que decide
# de DONDE vienen los bytes de una fila —del propio git, o de S3— es un archivo aparte,
# `fuentes/derivados-en-s3.csv`, indexado por el MISMO sha256 que la fila ya declara: es la clave
# que los une, nunca el nombre del archivo ni su ruta.
#
# Cada fila se resuelve asi:
#
#   1. Si el archivo local (relativo al manifiesto) pesa 1 MiB o menos —el limite practico de un
#      objeto de etcd—, se usa tal cual: entra a un ConfigMap de ENTRADA y el initContainer lo
#      copia a su lugar.
#   2. Si pesa mas, se busca su sha256 en `fuentes/derivados-en-s3.csv`. Si aparece, el
#      initContainer descarga esa URI y la deja en el MISMO lugar relativo que el manifiesto
#      declara para esa fila.
#   3. Si no aparece en ninguna de las dos, el guion se detiene nombrando los dos pasos que faltan
#      (archivar_derivado.sh, y la fila nueva del registro) — nunca parte el archivo.
#
# En los casos 1 y 2 el initContainer vuelve a calcular el sha256 contra el que el manifiesto
# declara ANTES de que `PublicarCuadros` arranque: es una segunda guarda independiente de la que
# el propio proceso ya hace (el mismo patron que RLS + GRANT en V55) — un byte distinto, en git o
# en S3, no llega a publicarse.
#
# LA CREDENCIAL DE S3. `derivados-en-s3.csv` vive en el mismo bucket que las fuentes normativas
# (`sgtm-fuentes-normativas`), y hoy no existe una credencial de solo lectura dedicada a ese
# prefijo: crearla es infraestructura de AWS, no de este repositorio. El initContainer reutiliza
# la MISMA credencial que ya usa wal-g para el respaldo continuo
# (`sgtm-<amb>-postgres-respaldo-credenciales`, lectura/escritura) — si algun dia deja de alcanzar
# este bucket, hay que apuntar aqui a la que si alcance.
#
# `publicar-parametros.sh` no necesita nada de esto: su manifiesto no tiene `archivo_de_filas`,
# todas las cifras van en la fila.
DIRECTORIO_DEL_MANIFIESTO=$(cd "$(dirname "$ARCHIVO")" && pwd)
LIMITE_CONFIGMAP=$((1024 * 1024))
REGISTRO_S3="$RAIZ/docs/10-negocio/valores-normativos/fuentes/derivados-en-s3.csv"

uriEnRegistro() {
    # $1: el sha256 a buscar. Vacio si no esta en el registro.
    [ -f "$REGISTRO_S3" ] || return 0
    grep -v '^#' "$REGISTRO_S3" | tail -n +2 | awk -F, -v sha="$1" '$1 == sha { print $2; exit }'
}

# Un elemento por fila del manifiesto: FILAS_CLAVES (la clave del ConfigMap de entrada, vacia
# cuando la fila viene de S3), FILAS_ORIGEN (la ruta local o la URI s3://, para el mensaje),
# FILAS_DESTINO (donde debe quedar, relativo al emptyDir) y FILAS_SHA.
FILAS_CLAVES=()
FILAS_ORIGEN=()
FILAS_DESTINO=()
FILAS_SHA=()
HAY_FILAS_S3=no

indiceLocal=0
# Se lee por POSICION, como el resto de los consumidores del manifiesto, y por eso `cuadro`
# esta al final: las tres primeras columnas son las de la llave y las lee tambien el paso que
# compone la edicion en el conjunto.
while IFS=, read -r _tipo _clave _desde _hasta fuente relativa sha _resto; do
    [ -n "$relativa" ] || continue

    # `read` con IFS=, no entiende un campo entre comillas: una coma dentro de
    # `documento_fuente` correria las columnas y este guion montaria el archivo equivocado
    # sin decir nada. Se para nombrandolo, que es lo unico honesto que puede hacer aqui.
    case "$fuente$relativa$sha" in
        *'"'*)
            echo "El manifiesto trae un campo entre comillas y este guion lee por comas:" \
                 "'$fuente'. Un documento_fuente con coma corre las columnas en silencio." \
                 "Escribalo sin comas, o cambie los tres consumidores a la vez." >&2
            exit 1
            ;;
    esac

    case "$relativa" in
        ../*) destino=${relativa#../} ;;
        *)
            echo "El manifiesto nombra un archivo_de_filas con una forma que este guion no sabe" \
                 "montar: '$relativa'. Se espera una ruta relativa de exactamente un nivel hacia" \
                 "arriba (../fuentes/<edicion>/<archivo>, como las de hoy)." >&2
            exit 1
            ;;
    esac
    case "$destino" in
        *..*)
            echo "El manifiesto nombra un archivo_de_filas con mas de un nivel hacia arriba, y" \
                 "este guion no lo sabe montar: '$relativa'." >&2
            exit 1
            ;;
    esac

    FILAS="$DIRECTORIO_DEL_MANIFIESTO/$relativa"
    [ -f "$FILAS" ] || {
        echo "El manifiesto nombra un archivo que no existe: $relativa" >&2
        exit 1
    }
    TAMANIO=$(wc -c < "$FILAS")
    if [ "$TAMANIO" -le "$LIMITE_CONFIGMAP" ]; then
        indiceLocal=$((indiceLocal + 1))
        FILAS_CLAVES+=("filas-$indiceLocal")
        FILAS_ORIGEN+=("$FILAS")
        FILAS_DESTINO+=("$destino")
        FILAS_SHA+=("$sha")
        continue
    fi

    uri=$(uriEnRegistro "$sha")
    if [ -n "$uri" ]; then
        HAY_FILAS_S3=si
        FILAS_CLAVES+=("")
        FILAS_ORIGEN+=("$uri")
        FILAS_DESTINO+=("$destino")
        FILAS_SHA+=("$sha")
        continue
    fi

    cat >&2 <<EOF

$relativa pesa $TAMANIO bytes y un ConfigMap admite $LIMITE_CONFIGMAP (limite de un objeto de
etcd), y su sha256 ($sha) no esta en fuentes/derivados-en-s3.csv. Hacen falta los dos pasos del
issue #388:

  1. scripts/valores-normativos/archivar_derivado.sh --bucket sgtm-fuentes-normativas \\
         --ubigeo <UBIGEO> --tipo <tipo-del-cuadro> $FILAS

  2. Agregar, en docs/10-negocio/valores-normativos/fuentes/derivados-en-s3.csv, una fila nueva
     con ESE MISMO sha256 y la URI que el paso anterior imprime.

El manifiesto ($ARCHIVO) no cambia: su columna archivo_de_filas sigue siendo la misma ruta
relativa, y el sha256 tampoco -es la clave que une las dos filas-.

Lo que NO hay que hacer es partir el archivo en trozos que quepan: su sha256 esta firmado en el
corpus, y un cuadro normativo partido deja de poder demostrarse identico a la fuente.
EOF
    exit 1
done < <(grep -v '^#' "$ARCHIVO" | tail -n +2)

echo "Creando ConfigMap $RECURSO con $ARCHIVO..."
ARGS_CONFIGMAP=(--from-file=cuadros.csv="$ARCHIVO")
for i in "${!FILAS_CLAVES[@]}"; do
    [ -n "${FILAS_CLAVES[$i]}" ] || continue
    ARGS_CONFIGMAP+=(--from-file="${FILAS_CLAVES[$i]}=${FILAS_ORIGEN[$i]}")
done
kubectl -n "$NAMESPACE" create configmap "$RECURSO" "${ARGS_CONFIGMAP[@]}"
cleanup() {
    kubectl -n "$NAMESPACE" delete configmap "$RECURSO" --ignore-not-found >/dev/null
}
trap cleanup EXIT

# El initContainer que arma /salida: copia lo local desde /entrada (el ConfigMap de arriba,
# montado de solo lectura) y descarga lo de S3, verificando el sha256 de CADA fila -local o
# remota- antes de dejarla lista. La comparacion es explicita -sha256sum suelto, no `-c`- para que
# un fallo nombre las DOS huellas y el origen (issue #388: "nombrando la URI y las dos huellas"),
# el mismo estilo que ya usa scripts/valores-normativos/archivar_fuente_normativa.sh al verificar
# su propia subida.
PASOS_INIT=("set -eu" "mkdir -p /salida/publicacion" "cp /entrada/cuadros.csv /salida/publicacion/cuadros.csv")
for i in "${!FILAS_DESTINO[@]}"; do
    directorio="/salida/$(dirname "${FILAS_DESTINO[$i]}")"
    destinoPod="/salida/${FILAS_DESTINO[$i]}"
    if [ -n "${FILAS_CLAVES[$i]}" ]; then
        obtener="cp '/entrada/${FILAS_CLAVES[$i]}' '$destinoPod'"
    else
        obtener="aws s3 cp '${FILAS_ORIGEN[$i]}' '$destinoPod'"
    fi
    verificar=$(printf 'real=$(sha256sum '\''%s'\'' | cut -d'\'' '\'' -f1); [ "$real" = '\''%s'\'' ] || { echo "FALLO: sha256 distinto para %s (origen: %s): esperado %s, obtenido $real" >&2; exit 1; }' \
        "$destinoPod" "${FILAS_SHA[$i]}" "$destinoPod" "${FILAS_ORIGEN[$i]}" "${FILAS_SHA[$i]}")
    PASOS_INIT+=(
        "mkdir -p '$directorio'"
        "$obtener"
        "$verificar"
    )
done
COMANDO_INIT=$(printf '%s && ' "${PASOS_INIT[@]}")
COMANDO_INIT=${COMANDO_INIT% && }
# Va dentro de un `args: ["..."]` de YAML: el mensaje de FALLO de arriba lleva comillas dobles
# propias, y sin escaparlas aqui romperian el YAML mucho antes de llegar a correr -exactamente el
# defecto que este comentario existe para no repetir, encontrado ejecutando este guion contra la
# comprobacion de abajo.
COMANDO_INIT_YAML=${COMANDO_INIT//\\/\\\\}
COMANDO_INIT_YAML=${COMANDO_INIT_YAML//\"/\\\"}

# Sin AWS de por medio, la imagen de wal-g alcanza -Alpine con curl y sha256sum via busybox, ya
# verificada en este mismo repositorio-. Con al menos una fila en S3 hace falta aws-cli, y solo
# entonces se monta la credencial: un manifiesto todo local (el de hoy) no ve ni necesita ningun
# secreto de AWS.
if [ "$HAY_FILAS_S3" = "si" ]; then
    # Version fijada, como el resto de las imagenes de este repositorio (WALG_VERSION,
    # IMAGEN_DE_POSTGRES_EXPORTER). No se pudo verificar contra el registro real desde este
    # entorno de desarrollo -sin salida a internet fuera de la lista blanca del proxy-: quien
    # corra esto por primera vez contra un ambiente real deberia confirmar que la etiqueta sigue
    # existiendo y, si no, fijar la que si.
    IMAGEN_INIT="public.ecr.aws/aws-cli/aws-cli:2.17.62"
    SECRETO_S3="sgtm-${AMBIENTE}-postgres-respaldo-credenciales"
    # HOME=/tmp: la imagen corre por omision como root y aws-cli escribe su cache en $HOME; con
    # runAsUser: 65534 mas abajo, ese usuario no es dueño de /root -el mismo tipo de sorpresa que
    # ya documenta contenedorDeDescargaDeWalg con readOnlyRootFilesystem, aqui evitada dandole un
    # HOME que cualquier UID puede escribir.
    ENV_INIT_BLOQUE="
          env:
            - name: HOME
              value: /tmp
            - name: AWS_DEFAULT_REGION
              value: $REGION_S3
            - name: AWS_ACCESS_KEY_ID
              valueFrom:
                secretKeyRef: { name: $SECRETO_S3, key: access-key-id }
            - name: AWS_SECRET_ACCESS_KEY
              valueFrom:
                secretKeyRef: { name: $SECRETO_S3, key: secret-access-key }"
else
    IMAGEN_INIT="curlimages/curl:8.11.0"
    # Sin fila en S3, el initContainer no necesita -ni ve- ninguna credencial de AWS.
    ENV_INIT_BLOQUE=""
fi

cat <<EOF | kubectl -n "$NAMESPACE" apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: $RECURSO
  labels:
    proyecto: sgtm
    ambiente: $AMBIENTE
    componente: publicacion-cuadros
spec:
  backoffLimit: 0
  template:
    metadata:
      labels:
        proyecto: sgtm
        ambiente: $AMBIENTE
        componente: publicacion-cuadros
        # Ver el mismo comentario en cargar-arancel-vial.sh: "lote" es la etiqueta que
        # NetworkPolicy "permitir-ingreso-postgres" deja pasar al puerto 5432 para un
        # Job de un solo uso; con otra etiqueta el pod arranca y la conexion cae con
        # "Connection refused".
        app: lote
    spec:
      restartPolicy: Never
      priorityClassName: sgtm-${AMBIENTE}-prioridad-lote
      containers:
        - name: publicacion-cuadros
          image: $IMAGEN
          env:
            - name: SPRING_PROFILES_ACTIVE
              value: batch
            - name: SGTM_DB_URL
              value: jdbc:postgresql://sgtm-${AMBIENTE}-postgres:5432/sgtm
            # rol_carga_parametros, y solo aqui. parametro_tributario lleva FORCE ROW LEVEL
            # SECURITY y la unica politica de escritura de V6 nombra a este rol: ni sgtm_app
            # ni sgtm_owner pueden insertar en ella. Y este rol no alcanza ninguna otra tabla
            # (V7), asi que este Job no puede componer ni sellar aunque quisiera.
            - name: SGTM_DB_USUARIO
              value: rol_carga_parametros
            - name: SGTM_DB_CLAVE
              valueFrom:
                secretKeyRef:
                  name: $SECRETO
                  key: clave-carga
            - name: SGTM_PUBLICACIONCUADROS_ARCHIVO
              value: /datos/publicacion/cuadros.csv
            - name: SGTM_PUBLICACIONCUADROS_USUARIODELPROCESO
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
      # Arma /datos ANTES de que el contenedor principal arranque: copia lo local desde el
      # ConfigMap de entrada y descarga lo de S3, verificando el sha256 de cada fila contra el que
      # declara el manifiesto. Ver el comentario de mas arriba ("EL ARCHIVO DE FILAS...").
      initContainers:
        - name: armar-datos
          image: $IMAGEN_INIT
          command: ["/bin/sh", "-c"]
          args: ["$COMANDO_INIT_YAML"]$ENV_INIT_BLOQUE
          securityContext:
            allowPrivilegeEscalation: false
            capabilities:
              drop: ["ALL"]
            runAsNonRoot: true
            runAsUser: 65534
          volumeMounts:
            - name: entrada
              mountPath: /entrada
              readOnly: true
            - name: datos
              mountPath: /salida
          resources:
            requests: { cpu: "100m", memory: "128Mi" }
            limits: { cpu: "500m", memory: "256Mi" }
      volumes:
        - name: entrada
          configMap:
            name: $RECURSO
        - name: datos
          emptyDir: {}
EOF

echo "Esperando a que $RECURSO termine..."
LIMITE=$((SECONDS + 1800))
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
        echo "El Job fallo. Registro del initContainer (armar-datos), si llego a correr:" >&2
        kubectl -n "$NAMESPACE" logs "job/$RECURSO" -c armar-datos --tail=500 >&2 || true
        echo "Registro del contenedor principal, si llego a arrancar:" >&2
        kubectl -n "$NAMESPACE" logs "job/$RECURSO" -c publicacion-cuadros --tail=500 >&2 || true
        exit 1
    fi
    [ "$SECONDS" -lt "$LIMITE" ] || {
        echo "Se agoto el tiempo de espera (1800s)." >&2
        exit 1
    }
    sleep 3
done

REGISTRO=$(kubectl -n "$NAMESPACE" logs "job/$RECURSO" -c publicacion-cuadros --tail=500)
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
