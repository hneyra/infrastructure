#!/usr/bin/env bash
# Lo que hacia falta saber y no estaba, las cuatro veces que `aplicar-prod` se colgo
# (issue #252): QUE pod no arranco, y POR QUE.
#
# Cuando `pulumi up` falla o agota su tiempo, lo unico que queda en el registro es la
# traza del CLI, que dice que un `ConfigGroup` no llego a estar listo pero no cual de
# sus objetos falta ni que le pasa. Y para cuando alguien abre un tunel a mano, el
# estado ya cambio. Esto lo captura en el momento, en el mismo trabajo que fallo.
#
# Los `events` son la pieza que de verdad resuelve el caso: un pod `Pending` por falta
# de CPU lo dice ahi con esas palabras —«0/1 nodes are available: Insufficient cpu»—, y
# esa frase es la que habria ahorrado las seis horas de la primera corrida.
#
#   uso:  ./diagnostico-del-namespace.sh kamayuk-prod          un espacio de nombres
#         ./diagnostico-del-namespace.sh --ambiente prod       LOS CINCO del ambiente
#
# ## Por que `--ambiente`, y por que la lista no se escribe (#40)
#
# Este guion nacio cuando habia UN espacio de nombres. Desde ADR-0031 los cuatro sistemas
# viven en el suyo, y `aplicar-stg` seguia invocandolo con `kamayuk-stg` a secas: cuando
# fallaba el `Job` de migracion de `rentas` volcaba los pods de la PLATAFORMA y ni una
# linea de `kamayuk-rentas-stg`. Medido en la corrida 34227961707, que es la que dejo sin
# diagnosticar por que la migracion salia con codigo 1.
#
# Los cinco NO se escriben aqui ni en el YAML: se le PREGUNTAN AL CLUSTER por las etiquetas
# que `commonLabels` les pone —`proyecto=kamayuk,ambiente=<amb>`—. Una lista escrita
# envejece el dia que entre un sistema; un selector de etiquetas no, y ademas describe lo
# que HAY y no lo que deberia haber, que es lo que un diagnostico necesita.
set -euo pipefail

# El selector con que se descubren los espacios de nombres de un ambiente. Son las
# etiquetas que `componentes/convenciones.ts` (`commonLabels`) le pone a cada `Namespace`, y
# una guarda de `yarn verificar` compara ESTA linea con las que los manifiestos emiten de
# verdad: si alguien cambia las etiquetas, este selector dejaria de encontrar nada y el
# diagnostico se volveria mudo sin que nada se pusiera rojo.
SELECTOR_DEL_AMBIENTE="proyecto=kamayuk,ambiente="

# Una linea por pod: nombre, fase, si cada contenedor esta listo, y por que espera.
# shellcheck disable=SC2016
FORMATO_DE_ESTADO='{range .items[*]}{.metadata.name}{"\t"}{.status.phase}{"\t"}{range .status.containerStatuses[*]}{.ready}{","}{end}{"\t"}{range .status.containerStatuses[*]}{.state.waiting.reason}{","}{end}{"\n"}{end}'

# Decide que pods hay que volcar. Lee de la entrada estandar el formato de arriba y
# escribe `nombre<TAB>fase<TAB>motivos` de los que NO estan sanos.
#
# Es una funcion aparte, y con su modo `--clasificar`, para que se pueda ejercer SIN un
# cluster: `infra/verificaciones/el-diagnostico-elige-bien-los-pods.test.ts` le da casos
# sinteticos y comprueba a quien elige. La version anterior no se podia comprobar sin
# levantar un pod en CrashLoopBackOff a proposito, y por eso vivio rota (#67, #68).
#
# La regla, y las tres ramas importan:
#   - `Succeeded`  -> fuera SIEMPRE: es un Job que termino bien.
#   - `Running`    -> dentro SOLO si algun contenedor no esta listo. Aqui cae
#                     CrashLoopBackOff, que tiene fase `Running` y era el caso que
#                     nunca se volcaba.
#   - lo demas     -> dentro: Pending, Failed, Unknown.
clasificarPods() {
    local nombre fase listos motivos
    while IFS=$'\t' read -r nombre fase listos motivos; do
        [ -n "$nombre" ] || continue
        case "$fase" in
            Succeeded) continue ;;
            Running)
                # `,$listos` para que el patron `,false` no case con un `ready` que
                # empiece por otra cosa. Un pod sin `containerStatuses` no entra por
                # aqui: su fase no seria `Running`.
                case ",$listos" in
                    *",false"*) ;;
                    *) continue ;;
                esac
                ;;
        esac
        motivos="${motivos%,}"
        motivos="${motivos//,,/,}"
        printf '%s\t%s\t%s\n' "$nombre" "$fase" "${motivos#,}"
    done
}

if [ "${1:-}" = "--clasificar" ]; then
    # Solo para las pruebas: lee de stdin y escribe a quien volcaria.
    clasificarPods
    exit 0
fi

diagnosticar_uno() {
    local NAMESPACE="$1"

    if ! kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
        echo "El namespace «${NAMESPACE}» no existe: el fallo es anterior a crear nada."
        return 0
    fi

    echo "::group::Pods de ${NAMESPACE}"
    kubectl get pods -n "$NAMESPACE" -o wide || true
    echo "::endgroup::"

    echo "::group::Deployments, Jobs y volumenes de ${NAMESPACE}"
    kubectl get deploy,job,cronjob,pvc -n "$NAMESPACE" || true
    echo "::endgroup::"

    # Lo ultimo primero seria mas comodo de leer, pero `--sort-by` no admite orden
    # inverso: se ordena ascendente y se toman las ultimas, que es lo mismo.
    echo "::group::Ultimos 60 eventos de ${NAMESPACE} (aqui esta el «Insufficient cpu», si lo hay)"
    kubectl get events -n "$NAMESPACE" --sort-by=.lastTimestamp 2>/dev/null | tail -60 || true
    echo "::endgroup::"

    # Y el detalle de lo que NO esta sano, que es lo unico que hay que leer entero.
    # `describe` de un pod `Pending` trae al final el motivo exacto del planificador.
    #
    # La eleccion NO se hace por la fase (#67, #68). `status.phase` dice si los
    # contenedores fueron admitidos y programados, no si estan sanos, y fallaba en las
    # DOS direcciones: un pod en `CrashLoopBackOff` tiene fase `Running` y no se volcaba
    # nunca —por eso el registro de `kamayuk-identidad-web` no salio el 2026-09-10—, y un
    # `Job` que termino BIEN tiene fase `Succeeded`, que tampoco es `Running`, asi que se
    # volcaba entero con su `describe` y sus 200 lineas de registro, para siempre. Lo que
    # dice que un contenedor esta mal es `containerStatuses[].ready`.
    local NO_SANOS
    NO_SANOS="$(kubectl get pods -n "$NAMESPACE" -o jsonpath="$FORMATO_DE_ESTADO" 2>/dev/null \
        | clasificarPods || true)"

    if [ -z "$NO_SANOS" ]; then
        # Cero no es «esta bien» si no habia pods: son dos estados distintos y se dicen
        # distinto, que es la leccion de #40 aplicada aqui.
        if [ -z "$(kubectl get pods -n "$NAMESPACE" -o name 2>/dev/null || true)" ]; then
            echo "El namespace «${NAMESPACE}» NO TIENE NI UN POD: no hay nada que diagnosticar,"
            echo "que no es lo mismo que estar sano."
        else
            echo "Todos los pods de ${NAMESPACE} estan sanos (Running con sus contenedores listos,"
            echo "o Succeeded)."
        fi
        return 0
    fi

    echo "$NO_SANOS" | while IFS=$'\t' read -r pod fase motivo; do
        echo "pod/${pod}: fase ${fase}${motivo:+, esperando por: ${motivo}}"
    done

    for pod in $(echo "$NO_SANOS" | cut -f1); do
        echo "::group::describe pod/${pod} (${NAMESPACE})"
        kubectl describe pod "$pod" -n "$NAMESPACE" || true
        echo "::endgroup::"

        # Y SUS REGISTROS, que es lo que `describe` no dice (#40). Un pod cuyo contenedor
        # sale con codigo 1 —una migracion que falla, por ejemplo— tiene el motivo AHI y en
        # ningun otro sitio: `describe` dice «Error», el registro dice cual.
        echo "::group::logs pod/${pod} (${NAMESPACE})"
        kubectl logs "$pod" -n "$NAMESPACE" --all-containers --tail=200 --prefix 2>&1 \
            || echo "(sin registros: el contenedor pudo no llegar a arrancar)"
        echo "::endgroup::"
    done

    echo "Pods no sanos en ${NAMESPACE}: $(echo "$NO_SANOS" | cut -f1 | tr '\n' ' ')"
}

if [ "${1:-}" = "--ambiente" ]; then
    AMBIENTE="${2:?uso: $0 --ambiente <stg|prod>}"

    # Se le pregunta al cluster, no a una lista. Ver la cabecera.
    ESPACIOS="$(kubectl get namespaces -l "${SELECTOR_DEL_AMBIENTE}${AMBIENTE}" \
        -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true)"

    # Cero no es «esta bien»: es «no se pudo mirar». Sin esto, un selector que dejara de
    # casar —porque alguien renombro una etiqueta— haria que este guion saliera en verde
    # habiendo diagnosticado exactamente nada, que es el fallo que #40 existe para cerrar.
    if [ -z "$ESPACIOS" ]; then
        echo "NINGUN espacio de nombres lleva «${SELECTOR_DEL_AMBIENTE}${AMBIENTE}»."
        echo 'O el ambiente no se ha creado nunca, o las etiquetas de `commonLabels`'
        echo "cambiaron y este diagnostico dejo de encontrarlas. NO es «todo bien»."
        exit 0
    fi

    echo "Espacios de nombres de «${AMBIENTE}»: $(echo "$ESPACIOS" | tr '\n' ' ')"
    for ns in $ESPACIOS; do
        echo "================ ${ns} ================"
        diagnosticar_uno "$ns"
    done
    exit 0
fi

diagnosticar_uno "${1:?uso: $0 <namespace> | --ambiente <stg|prod>}"
