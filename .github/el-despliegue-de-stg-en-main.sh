#!/usr/bin/env bash
# ¿Esta rojo el ultimo `pulumi up en stg` de `main`? Se lo pregunta un PR antes de que alguien lo
# integre (#79).
#
#   uso:  el-despliegue-de-stg-en-main.sh                  pregunta al API (GH_TOKEN, REPOSITORIO)
#         el-despliegue-de-stg-en-main.sh --decidir        lee las lineas de stdin (solo pruebas)
#
# ## El hueco, medido
#
# `aplicar-stg` solo corre con `push` a `main` y con `workflow_dispatch`, asi que ningun PR lo
# ejerce. El 2026-09-10 el PR #75 salio verde en sus 12 comprobaciones con `aplicar-stg` quince horas
# rojo. Y el 2026-09-13 volvio a pasar: **ocho integraciones seguidas** —de `d166b97` (07:09Z) a
# `c0db443` (10:33Z)— con `pulumi up en stg` en `failure`, y ninguna lo vio. «Mezclar si pinta verde»
# se cumplia sobre comprobaciones que no ejercen el despliegue.
#
# ## Tres respuestas, no dos
#
#   verde        el ultimo `pulumi up en stg` que llego a correr termino en `success` y aplico.
#   rojo         termino en `failure`, `timed_out` o `cancelled` —el tope de 15 minutos cierra el
#                trabajo como CANCELLED (medido el 2026-09-10)—. Sale 1, con la URL de la corrida.
#   no se sabe   no se pudo preguntar (el API fallo, no hay token), o se pregunto y no hay ninguno
#                terminado, o termino en verde SIN aplicar, o con una conclusion que no se sabe leer.
#                Sale 0 con `::warning::` y lo escribe en el resumen, diciendo que NO es «esta bien».
#
# Por que «no se sabe» no sale rojo esta en el PR de #79 y en `infra.yml`, junto al trabajo. En
# corto: un rojo por algo que nadie en el PR puede arreglar —un API de GitHub caido, un token de
# bifurcacion sin alcance— bloquea PR que no tienen nada que ver y ensena a relanzar hasta el verde;
# es el mismo criterio que `infra.yml` aplica cuando faltan las credenciales del cluster.
#
# ## Por que el TRABAJO y no la corrida
#
# La conclusion de la CORRIDA mezcla `stg` con `prod`, y medido engana en las dos direcciones: la
# 34766015841 dice `failure` con `pulumi up en stg` en `success` (fallo `prod`), y seis corridas del
# 2026-09-12/13 dicen `cancelled` con `stg` en `success` (la aprobacion de `prod` quedo sin dar).
set -euo pipefail

# Lo que se busca. `el-pr-ve-el-rojo-de-stg.test.ts` compara las tres con `infra.yml`: si alguien
# renombra el trabajo o el paso, esto dejaria de encontrarlos y diria «no se sabe» para siempre.
FLUJO="infra.yml"
TRABAJO="pulumi up en stg"
# El nombre con que GitHub muestra el paso `uses: pulumi/actions@v7` sin `name:`.
PASO_DEL_UP="Run pulumi/actions@v7"
# Cuantas corridas de `main` se miran antes de rendirse. Las `schedule` no cuentan y los trabajos
# en curso o saltados se pasan de largo, asi que diez sobran: medido, en las 60 ultimas corridas de
# `main` no hubo nunca dos seguidas sin un `pulumi up en stg` terminado.
MAXIMO_DE_CORRIDAS=10

# Una linea que decide: termino, y llego a correr. `cancelled` sin corredor es un trabajo que el
# grupo de concurrencia de `aplicar-stg` retiro de la cola antes de empezar: no dice nada del
# ambiente. `skipped` es la corrida `schedule`, donde `aplicar-stg` no corre.
esDecisiva() {
    local estado="$1" conclusion="$2" corredor="$3"
    [ "$estado" = "completed" ] || return 1
    case "$conclusion" in
        skipped) return 1 ;;
        cancelled) [ -n "$corredor" ] ;;
        *) return 0 ;;
    esac
}

resumen() {
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
        printf '%s\n' "$@" >>"$GITHUB_STEP_SUMMARY"
    fi
}

noSeSabe() {
    local porque="$1"
    echo "no-se-sabe"
    echo "::warning title=No se sabe si stg esta verde en main::${porque} Esto NO es «esta bien»: es que no se pudo saber (#79)."
    resumen "### No se sabe si \`${TRABAJO}\` esta verde en \`main\`" "" "${porque}" "" \
        "**Esto NO es «esta bien».** Antes de integrar, mirar la ultima corrida de \`${FLUJO}\` en \`main\`."
    return 0
}

# Lee de stdin, la mas nueva primero, lineas separadas por `|` —no por tabuladores: un tabulador es
# espacio para `read`, y dos seguidos se comen el campo vacio que hay entre ellos—:
#
#   trabajo|<estado>|<conclusion>|<corredor>|<conclusion-del-up>|<url>|<sha>|<terminado>
#   no-se-pudo|<motivo>
#
# Escribe el veredicto en la primera linea y sale 1 solo si es rojo. Aparte y con su modo
# `--decidir`, como `clasificarPods` en `diagnostico-del-namespace.sh`, para ejercer la tabla sin API.
decidir() {
    local tipo estado conclusion corredor up url sha terminado resto en_curso="" vistas=0
    while IFS='|' read -r tipo resto; do
        case "$tipo" in
            no-se-pudo)
                noSeSabe "No se pudo preguntar al API de GitHub: ${resto}"
                return 0
                ;;
            trabajo) ;;
            *) continue ;;
        esac
        IFS='|' read -r estado conclusion corredor up url sha terminado <<<"$resto"
        vistas=$((vistas + 1))
        if [ "$estado" != "completed" ]; then
            en_curso="${en_curso:-$url}"
            continue
        fi
        esDecisiva "$estado" "$conclusion" "$corredor" || continue

        local de="(${sha:-sin sha}, terminado ${terminado:-sin fecha})"
        local aviso_en_curso="${en_curso:+ Hay uno mas nuevo EN CURSO, que todavia no dice nada: ${en_curso}}"
        case "$conclusion" in
            success)
                if [ "$up" = "skipped" ]; then
                    noSeSabe "El ultimo «${TRABAJO}» de main salio success ${de} SIN APLICAR: su paso «${PASO_DEL_UP}» se salto, que es lo que pasa cuando faltan las credenciales del cluster. ${url}${aviso_en_curso}"
                    return 0
                fi
                echo "verde"
                echo "El ultimo «${TRABAJO}» de main termino en success ${de}: ${url}${aviso_en_curso}"
                resumen "### \`${TRABAJO}\` esta verde en \`main\`" "" "${de}: ${url}${aviso_en_curso}"
                return 0
                ;;
            failure | timed_out | cancelled)
                echo "rojo"
                echo "::error title=stg esta rojo en main::El ultimo «${TRABAJO}» de main termino en ${conclusion} ${de}: ${url} — este PR aterrizaria sobre un ambiente roto (#79).${aviso_en_curso}"
                # Entre comillas simples: lleva acentos graves, y sin comillas el shell los ejecutaria.
                cat <<'EOF'
Todo lo demas de este PR puede salir verde y no dice nada de esto: `aplicar-stg` solo corre al
integrar, asi que ninguna comprobacion de un PR ejerce el despliegue. Por eso se pregunta aqui.

- Si este PR es el que ARREGLA `stg`, este rojo es el esperado: el verde llega con el
  `pulumi up` que corre al integrarlo.
- Si no, mirar esa corrida antes de integrar: lo que se mezcle ahora entra en un ambiente que ya
  no se despliega, y su propio fallo quedara tapado por el que ya habia.
EOF
                resumen "### \`${TRABAJO}\` esta ROJO en \`main\`" "" "Termino en \`${conclusion}\` ${de}: ${url}${aviso_en_curso}" "" \
                    "Si este PR es el que lo arregla, es el rojo esperado. Si no, mirar esa corrida antes de integrar."
                return 1
                ;;
            *)
                noSeSabe "El ultimo «${TRABAJO}» de main termino en «${conclusion}», que este guion no sabe leer ${de}: ${url}"
                return 0
                ;;
        esac
    done
    noSeSabe "El API contesto, pero ninguna de las ${MAXIMO_DE_CORRIDAS} ultimas corridas de push o workflow_dispatch de ${FLUJO} en main tiene un «${TRABAJO}» terminado que llegara a correr (${vistas} vistos).${en_curso:+ Hay uno EN CURSO: ${en_curso}}"
}

if [ "${1:-}" = "--decidir" ]; then
    decidir
    exit $?
fi

REPOSITORIO="${REPOSITORIO:?falta REPOSITORIO (dueño/nombre)}"
ERRORES="$(mktemp)"
trap 'rm -f "$ERRORES"' EXIT

# Pregunta y escribe las lineas que `decidir` lee. Se para en la primera decisiva: no hace falta
# mirar mas atras, y cada corrida es una llamada al API.
consultar() {
    local corridas id lineas linea n=0
    # `head_branch` es `main` tambien en un PR que venga de la rama `main` de una bifurcacion, asi
    # que se filtra por evento: solo `push` y `workflow_dispatch` despliegan.
    if ! corridas="$(gh api "repos/${REPOSITORIO}/actions/workflows/${FLUJO}/runs?branch=main&per_page=30" \
        --jq '.workflow_runs[] | select(.event == "push" or .event == "workflow_dispatch") | .id' \
        2>"$ERRORES")"; then
        printf 'no-se-pudo|la lista de corridas de %s en main: %s\n' "$FLUJO" "$(tr '\n' ' ' <"$ERRORES")"
        return 0
    fi
    for id in $corridas; do
        n=$((n + 1))
        [ "$n" -le "$MAXIMO_DE_CORRIDAS" ] || break
        # `filter=latest`: el ultimo intento de la corrida, que es el que dice como quedo.
        if ! lineas="$(gh api "repos/${REPOSITORIO}/actions/runs/${id}/jobs?filter=latest&per_page=100" \
            --jq ".jobs[] | select(.name == \"${TRABAJO}\")
                  | [\"trabajo\", .status, (.conclusion // \"\"), (.runner_name // \"\"),
                     ([(.steps // [])[] | select(.name == \"${PASO_DEL_UP}\") | .conclusion][0] // \"\"),
                     .html_url, (.head_sha // \"\")[0:12], (.completed_at // \"\")]
                  | join(\"|\")" \
            2>"$ERRORES")"; then
            printf 'no-se-pudo|los trabajos de la corrida %s: %s\n' "$id" "$(tr '\n' ' ' <"$ERRORES")"
            return 0
        fi
        while IFS= read -r linea; do
            [ -n "$linea" ] || continue
            printf '%s\n' "$linea"
            IFS='|' read -r _ estado conclusion corredor _ <<<"$linea"
            if esDecisiva "$estado" "$conclusion" "$corredor"; then
                return 0
            fi
        done <<<"$lineas"
    done
}

# Sin tuberia a proposito: con `pipefail`, `decidir` terminando antes de que `consultar` acabe de
# escribir le mandaria SIGPIPE, y el 141 de `consultar` taparia el 0 de un verde.
LINEAS="$(consultar)"
decidir <<<"$LINEAS"
