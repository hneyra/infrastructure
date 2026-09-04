#!/usr/bin/env bash
# La reserva de CPU y memoria del nodo para kubelet, containerd y el sistema
# operativo (`INF-01` §2 y §4, issue #157): 1 CPU y 2 Gi EN TOTAL, repartidos entre
# `system-reserved` y `kube-reserved` -que kubelet suma-. Las cifras y el porque de
# que no sean simetricas estan mas abajo, donde se declaran.
#
# Sin esta reserva, una rafaga de la aplicacion puede dejar sin CPU al kubelet, y las sondas de TODO el nodo empiezan
# a expirar a la vez -el incidente que `../iaac` ya tuvo sobre esta misma
# combinacion (k3s, un solo nodo, PostgreSQL en un volumen `ReadWriteOnce`)-.
#
# ⚠ ESTO REINICIA k3s. El API server queda inalcanzable unos segundos, y cualquier
# `pulumi up`/`pulumi preview` en marcha en ese instante falla a mitad de camino
# -no porque este guion haga algo mal, sino porque el proveedor de Pulumi habla
# contra ese mismo servidor de API-. Va en su PROPIA ventana de mantenimiento,
# nunca junto a otro cambio: `INF-01` §4 lo dice sin rodeos, y este guion lo repite
# antes de tocar nada porque es el tipo de aviso que se salta la segunda vez que
# se corre un guion, no la primera.
#
# Los pods existentes no se recrean: kubelet vuelve a arrancar con la MISMA
# configuracion de los pods que ya tenia asignados, y la reserva nueva solo
# afecta a lo que el planificador admite DESDE AHORA. «El clúster vuelve solo»
# (issue #157) es literal: este guion espera esa recuperacion y la comprueba,
# no la fuerza.
#
#   uso, en el VPS y como root:  ./reservar-recursos-del-nodo.sh
#
# `--solo-configuracion` deja el archivo como debe quedar y NO toca el nodo: ni
# reinicia k3s, ni pregunta, ni necesita root. Existe para que la reescritura de la
# configuracion -la parte que corrige la reserva duplicada del issue #252 sobre un
# archivo del que solo hay una copia- se pueda ejercitar de verdad en
# `verificaciones/reserva-del-nodo.test.ts`, en vez de razonar sobre ella. Con
# `SGTM_CONFIG_K3S` se le dice sobre que archivo trabajar.
set -euo pipefail

SOLO_CONFIGURACION=no
while [ $# -gt 0 ]; do
    case "$1" in
        --solo-configuracion) SOLO_CONFIGURACION=si; shift ;;
        *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
    esac
done

if [ "$SOLO_CONFIGURACION" = "no" ]; then
    if [ "$(id -u)" != "0" ]; then
        echo "Esto reinicia k3s: hay que correrlo como root." >&2
        exit 1
    fi

    command -v kubectl >/dev/null 2>&1 || { echo "Falta kubectl." >&2; exit 1; }
    command -v systemctl >/dev/null 2>&1 || { echo "Falta systemctl -esto asume k3s como servicio de systemd." >&2; exit 1; }
fi

CONFIG="${SGTM_CONFIG_K3S:-/etc/rancher/k3s/config.yaml}"

# Lo que se reserva EN TOTAL para kubelet, containerd y el sistema operativo.
#
# ⚠ SE REPARTE ENTRE LAS DOS PARTIDAS, no se escribe entera en cada una. `system-reserved`
# y `kube-reserved` son dos descuentos DISTINTOS que kubelet SUMA para calcular lo
# asignable, asi que poner `cpu=1` en las dos no reserva 1 CPU: reserva 2.
#
# Eso es exactamente lo que paso el 2026-08-23 en `vmd120205`, y esta medido en
# `INF-10` §4: «CPU 4 → asignable 2; memoria 8 126 500 Ki → asignable 6 029 348 Ki. La
# diferencia es 2 097 152 Ki = 2 Gi exactos, y 2 CPU» —el doble de los «~1 CPU y ~1 GB»
# que `INF-01` §2 dimensiona—. El nodo de `prod` perdio asi la MITAD de su CPU
# repartible, y con ella la posibilidad de desplegar su propio stack: `pulumi up` se
# colgo cuatro veces entre el 25 y el 26 de agosto de 2026 esperando pods que nunca
# podian ubicarse (issue #252).
#
# LA CPU Y LA MEMORIA NO SE CORRIGEN IGUAL, y es deliberado: las dos partidas modelan
# consumo real, y el consumo real de k3s no es simetrico.
#
#   - CPU: 1 en total. Un k3s de un solo nodo —API server, planificador, controladores,
#     sqlite y containerd— reposa muy por debajo de medio nucleo. Reservarle 2 de los 4
#     del nodo no protegia nada que 1 no proteja, y era la mitad de la maquina.
#   - Memoria: 2 Gi en total, SIN CAMBIO. Aqui el consumo si es ese: solo el API server
#     ronda el medio giga, y el sistema operativo con containerd completan el resto.
#     Bajarla a 1 Gi no habria devuelto memoria: habria dejado de contar la que ya
#     estaba en uso, que es como se llega a que el nodo empiece a desalojar pods sanos.
#
# El resultado sobre `vmd120205` son 3 CPU y ~6 GB asignables, y ese es el presupuesto
# con que `Pulumi.prod.yaml` dimensiona el stack.
#
# `verificaciones/reserva-del-nodo.test.ts` exige que las dos partidas sumen el total.
CPU_TOTAL=1
MEMORIA_TOTAL_MI=2048

# La mitad para cada partida. Formato explicito —milicores y mebibytes— para que la suma
# se lea sin convertir nada.
CPU_POR_PARTIDA=500m
MEMORIA_POR_PARTIDA=1Gi

if [ "$SOLO_CONFIGURACION" = "no" ]; then
cat <<AVISO
⚠  Esto va a reiniciar k3s. El API server queda inalcanzable unos segundos.

   Si hay un "pulumi up" o "pulumi preview" en marcha en cualquier terminal ahora
   mismo, DETENGALO antes de continuar -va a fallar a mitad de camino, y un
   fallo a mitad de un "pulumi up" es el tipo de estado a medias del que cuesta
   recuperarse-. Esta es su propia ventana de mantenimiento (INF-01 §4).

AVISO
read -r -p "Escriba «entiendo» para continuar: " respuesta
[ "$respuesta" = "entiendo" ] || { echo "Cancelado: no se toco nada." >&2; exit 1; }
fi

# La firma que este guion deja en el bloque que escribe. Es lo que distingue «un
# kubelet-arg que puse yo y puedo corregir» de «un kubelet-arg de otro, que no toco».
FIRMA="Escrito por infra/vps/reservar-recursos-del-nodo.sh"

SYSTEM_ESPERADO="  - \"system-reserved=cpu=$CPU_POR_PARTIDA,memory=$MEMORIA_POR_PARTIDA\""
KUBE_ESPERADO="  - \"kube-reserved=cpu=$CPU_POR_PARTIDA,memory=$MEMORIA_POR_PARTIDA\""

if [ -f "$CONFIG" ] && grep -q '^kubelet-arg:' "$CONFIG"; then
    # Hay reserva. Solo hay tres desenlaces posibles, y ninguno adivina nada.
    if ! grep -qF "$FIRMA" "$CONFIG"; then
        # 1. La escribio otro. No se toca: fusionar dos listas YAML a ciegas es
        #    justo el automatismo que corrompe una configuracion de la que solo
        #    hay una copia.
        echo >&2
        echo "FALLO: $CONFIG ya define \`kubelet-arg\` y NO lo escribio este guion." >&2
        echo "No se fusionan listas YAML a ciegas -dos claves \`kubelet-arg:\` en el mismo" >&2
        echo "archivo son un YAML invalido-. Ajuste a mano las dos lineas de la lista que" >&2
        echo "ya existe para que queden asi:" >&2
        echo >&2
        echo "$SYSTEM_ESPERADO" >&2
        echo "$KUBE_ESPERADO" >&2
        exit 1
    fi

    if grep -qF "$SYSTEM_ESPERADO" "$CONFIG" && grep -qF "$KUBE_ESPERADO" "$CONFIG"; then
        # 2. Ya es la reserva correcta. Correr esto dos veces no cambia nada, y
        #    sobre todo NO reinicia k3s por gusto.
        echo "La reserva ya es la correcta ($CPU_TOTAL CPU y ${MEMORIA_TOTAL_MI}Mi en total)."
        echo "No se toca nada y no se reinicia k3s."
        [ "$SOLO_CONFIGURACION" = "si" ] || kubectl get node -o custom-columns='NODO:.metadata.name,CPU_CAPACIDAD:.status.capacity.cpu,CPU_ASIGNABLE:.status.allocatable.cpu,MEM_CAPACIDAD:.status.capacity.memory,MEM_ASIGNABLE:.status.allocatable.memory'
        exit 0
    fi

    # 3. La escribio este guion, pero con otras cifras: es la correccion de la
    #    reserva duplicada (issue #252). Se sustituyen SOLO esas dos lineas.
    RESPALDO="${CONFIG}.$(date +%Y%m%d%H%M%S).bak"
    echo "· La reserva existente es de este guion pero con otras cifras: se corrige."
    echo "· Copia de seguridad en $RESPALDO"
    cp -p "$CONFIG" "$RESPALDO"

    # `sed` sobre las dos lineas de la lista, no sobre el bloque entero: lo demas
    # que haya en `kubelet-arg` -si alguien anadio algo- se queda como esta.
    #
    # A un temporal y `mv`, NO `sed -i -e`: `-i` sin sufijo es sintaxis **GNU**, y el
    # `sed` de macOS -BSD- lee el `-e` que va detras como la extension del respaldo y
    # falla con «sed: -e: No such file or directory». El guion se ejecuta contra un nodo
    # Linux, asi que el defecto no llegaba a produccion; lo que dejaba en rojo es la
    # prueba que lo EJECUTA (`reserva-del-nodo.test.ts`) en la maquina de quien
    # desarrolla, y una prueba que solo pasa en un sistema operativo deja de mirarse.
    TEMPORAL="$(mktemp)"
    sed \
        -e "s|^  - \"system-reserved=.*\"$|$SYSTEM_ESPERADO|" \
        -e "s|^  - \"kube-reserved=.*\"$|$KUBE_ESPERADO|" \
        "$CONFIG" > "$TEMPORAL"
    cat "$TEMPORAL" > "$CONFIG"
    rm -f "$TEMPORAL"

    if ! grep -qF "$SYSTEM_ESPERADO" "$CONFIG" || ! grep -qF "$KUBE_ESPERADO" "$CONFIG"; then
        echo "FALLO: la sustitucion no dejo las dos lineas esperadas. Se restaura." >&2
        cp -p "$RESPALDO" "$CONFIG"
        exit 1
    fi

    echo "· Asi queda la reserva:"
    diff "$RESPALDO" "$CONFIG" || true
else
    echo "· Escribiendo la reserva en $CONFIG"
    mkdir -p "$(dirname "$CONFIG")"
    cat >> "$CONFIG" <<YAML

# Reserva del nodo para kubelet, containerd y el sistema operativo (INF-01 §2 y
# §4, issue #157). $FIRMA -no a
# mano-, para que quede claro de donde salio si alguien lo encuentra despues.
kubelet-arg:
$SYSTEM_ESPERADO
$KUBE_ESPERADO
YAML
fi

if [ "$SOLO_CONFIGURACION" = "si" ]; then
    echo "Solo configuracion: el archivo queda escrito y k3s NO se reinicia."
    exit 0
fi

echo "· Reiniciando k3s"
systemctl restart k3s

echo "· Esperando a que el API server responda de nuevo"
LOGRADO=no
for _ in $(seq 1 30); do
    if kubectl get --raw='/readyz' >/dev/null 2>&1; then
        LOGRADO=si
        break
    fi
    sleep 2
done
if [ "$LOGRADO" != "si" ]; then
    echo "FALLO: el API server no volvio a responder en 60s tras el reinicio." >&2
    echo "systemctl status k3s / journalctl -u k3s -n 200 tienen la razon real." >&2
    exit 1
fi
echo "  El API server responde."

echo "· Esperando a que el nodo vuelva a Ready"
if ! kubectl wait --for=condition=Ready node --all --timeout=120s; then
    echo "FALLO: el nodo no volvio a Ready en 120s." >&2
    kubectl describe node
    exit 1
fi

echo "· Comprobando que kubelet aplico la reserva -lo asignable bajo, la capacidad no-"
kubectl get node -o custom-columns='NODO:.metadata.name,CPU_CAPACIDAD:.status.capacity.cpu,CPU_ASIGNABLE:.status.allocatable.cpu,MEM_CAPACIDAD:.status.capacity.memory,MEM_ASIGNABLE:.status.allocatable.memory'

echo "· Confirmando que los pods existentes siguen en pie -el clúster «vuelve solo»-"
if ! kubectl get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded --no-headers | grep -q .; then
    echo "  Ningun pod fuera de Running/Succeeded: el reinicio no se llevo nada por delante."
else
    echo "FALLO: hay pods que no volvieron a Running tras el reinicio de k3s:" >&2
    kubectl get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded
    exit 1
fi

cat <<AVISO

Listo. Anote esta ejecucion en el runbook de mantenimiento
(docs/80-infraestructura/mantenimiento-del-nodo.md): fecha, quien la corrio, y
si el clúster volvio solo o hizo falta intervenir -es exactamente lo que el
criterio de aceptacion del issue #157 pide poder responder despues.
AVISO
