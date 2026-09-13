#!/usr/bin/env bash
# El tunel SSH al API de k3s, comprobado: que al otro lado CONTESTE algo, no que `ssh` arrancara
# (#162).
#
#   uso:  comprobar-el-tunel.sh --local 6443 --remoto 6443 [--plazo 30]
#         comprobar-el-tunel.sh --clasificar <salida-de-curl> <codigo-http>   (solo pruebas)
#
# ## Por que hace falta, medido el 2026-09-13
#
# Los cinco trabajos que hablan con un cluster abren el tunel asi:
#
#     ssh ... -f -N -L 6443:localhost:6443 "$VPS_USER@$VPS_HOST"
#
# y ese paso **no puede fallar por lo que importa**. `ssh -f -N` devuelve 0 en cuanto se manda al
# fondo, y un reenvio `-L` es PEREZOSO: no intenta conectar con el puerto del VPS hasta que alguien
# usa el local. Asi que sale verde si el puerto remoto no escucha, si k3s se esta reiniciando o si
# lo que contesta ahi no es el API. Medido dos veces:
#
#   - en la corrida 34751003283 el paso del tunel salio VERDE y el siguiente murio con
#     «configured Kubernetes cluster is unreachable … context deadline exceeded» y 141 recursos
#     «errored» por esa sola causa — un mensaje que manda a mirar el CLUSTER, no el tunel;
#   - y en el PR #163, apuntar los CINCO tuneles a un puerto que ya no escuchaba dejo las 1 119
#     pruebas en verde: ninguna guarda miraba el puerto remoto.
#
# Este guion es la primera mitad. La segunda es `el-tunel-comprueba-que-sirve.test.ts`, que exige
# que cada `ssh -L` del flujo lo invoque con SUS puertos y que los cinco lleven al mismo.
#
# ## Por que un guion y no cinco copias del bucle
#
# Es la leccion de `clonar-los-hermanos` (C-9a): un patron copiado cinco veces se arregla en una
# copia. El `ssh` se queda en cada trabajo —cada uno lo abre con los secretos de SU environment—,
# y lo que se comparte es la pregunta.
#
# ## Que cuenta como «el tunel sirve»
#
# CUALQUIER respuesta HTTP en `https://127.0.0.1:<local>/livez`. Sin credenciales, el API de k3s
# contesta **401** —medido contra el k3s de `vmd205066`—, y eso ya demuestra lo que hay que
# demostrar: que el `ssh` autentico, que el reenvio llego al puerto remoto y que ahi hay un
# servidor TLS que habla HTTP. Una conexion rechazada, un tiempo agotado o un TLS que no negocia
# NO lo demuestran: con el puerto remoto muerto, `ssh` acepta la conexion local y la cierra al no
# poder abrir el canal, y `curl` sale con error sin haber leido un solo codigo.
#
# Un codigo que el API no da en `/livez` sin credenciales —ni 200, ni 401, ni 403— pasa CON AVISO:
# el tunel funciona, pero lo que contesta puede no ser el API (el tercer caso de #162). No se pone
# rojo porque un API enfermo contesta 500 en `/livez`, y entonces el rojo tiene que decirlo el paso
# que lo usa, no un mensaje sobre el tunel — que es justo el error de nombre que este issue abre.
set -euo pipefail

# Decide que significa una respuesta. Recibe el codigo de salida de `curl` y el `%{http_code}` que
# escribio, y dice una de tres palabras:
#
#   api   — contesto como contesta un API de Kubernetes a `/livez` sin credenciales
#   otro  — contesto HTTP, pero con un codigo que el API no da ahi
#   nada  — no hubo respuesta HTTP: rechazada, tiempo agotado, TLS roto o respuesta vacia
#
# Aparte y con su modo `--clasificar`, como `clasificarPods` en `diagnostico-del-namespace.sh`,
# para que la tabla se pueda ejercer sin tunel ni cluster.
clasificarRespuesta() {
    local salida="$1" codigo="$2"
    # `curl` escribe `000` cuando no llego a leer un codigo, y en ese caso su salida NO es 0; se
    # exigen las dos cosas porque ninguna sola basta: un `000` con salida 0 no es una respuesta.
    if [ "$salida" != "0" ] || ! [[ "$codigo" =~ ^[1-5][0-9][0-9]$ ]]; then
        echo "nada"
        return 0
    fi
    case "$codigo" in
        200 | 401 | 403) echo "api" ;;
        *) echo "otro" ;;
    esac
}

if [ "${1:-}" = "--clasificar" ]; then
    clasificarRespuesta "${2:?uso: $0 --clasificar <salida-de-curl> <codigo-http>}" "${3-}"
    exit 0
fi

LOCAL=""
REMOTO=""
PLAZO=30
while [ $# -gt 0 ]; do
    case "$1" in
        --local) LOCAL="${2:-}"; shift 2 ;;
        --remoto) REMOTO="${2:-}"; shift 2 ;;
        --plazo) PLAZO="${2:-}"; shift 2 ;;
        *) echo "Argumento desconocido: $1" >&2; exit 2 ;;
    esac
done
if ! [[ "$LOCAL" =~ ^[0-9]+$ && "$REMOTO" =~ ^[0-9]+$ && "$PLAZO" =~ ^[0-9]+$ ]]; then
    echo "uso: $0 --local <puerto> --remoto <puerto> [--plazo <segundos>]" >&2
    exit 2
fi

URL="https://127.0.0.1:${LOCAL}/livez"
# `GITHUB_JOB` lo pone Actions: con el, el rojo dice en QUE trabajo fallo sin tener que buscarlo.
TUNEL="-L ${LOCAL}:localhost:${REMOTO}${GITHUB_JOB:+ del trabajo «${GITHUB_JOB}»}"
ERRORES="$(mktemp)"
trap 'rm -f "$ERRORES"' EXIT

limite=$((SECONDS + PLAZO))
intentos=0
while :; do
    intentos=$((intentos + 1))
    salida=0
    # `-k`: el certificado del API lo firma la CA de k3s, que el runner no tiene, y aqui no se
    # autentica nada — solo se pregunta si hay alguien. `--max-time 3` acota cada intento, asi que
    # el peor caso es el plazo mas un intento.
    codigo="$(curl -sSk --max-time 3 -o /dev/null -w '%{http_code}' "$URL" 2>"$ERRORES")" \
        || salida=$?
    case "$(clasificarRespuesta "$salida" "$codigo")" in
        api)
            echo "El tunel ${TUNEL} sirve: ${URL} contesto HTTP ${codigo} (intento ${intentos})."
            exit 0
            ;;
        otro)
            echo "::warning title=El tunel contesta pero quiza no el API::${URL} contesto HTTP ${codigo}, que no es lo que el API de Kubernetes da en /livez sin credenciales (200, 401 o 403). El tunel ${TUNEL} funciona; lo que escucha en el puerto ${REMOTO} de VPS_HOST puede no ser k3s."
            exit 0
            ;;
    esac
    if [ "$SECONDS" -ge "$limite" ]; then
        break
    fi
    sleep 1
done

# El VALOR de `VPS_HOST` no se imprime: es un secreto del environment. Se nombra la variable, que
# es lo que el operador tiene que ir a mirar.
ultimo="$(tr '\n' ' ' <"$ERRORES")"
echo "::error title=El tunel SSH al API de k3s no sirve::Nada contesto en ${URL} en ${PLAZO} s (${intentos} intentos). El tunel ${TUNEL} lleva al puerto ${REMOTO} de VPS_HOST, y ahi no hay un API que conteste. El ultimo intento dijo: ${ultimo:-sin salida}"
cat <<EOF
«ssh -f -N» salio con 0, pero eso solo dice que se autentico y se mando al fondo: el reenvio -L es
perezoso y no llega al puerto ${REMOTO} del VPS hasta que alguien lo usa. Esto lo acaba de usar, y
no contesto nadie.

Que mirar, en este orden:
  1. que k3s escuche en el puerto ${REMOTO} del VPS de VPS_HOST:  sudo ss -ltnp | grep ':${REMOTO} '
  2. que ${REMOTO} sea el puerto del API en ESE nodo (k3s nativo: 6443; k3d lo publica en otro);
  3. que el servicio siga en pie:  sudo systemctl status k3s

Si este paso se saltara, los siguientes dirian «configured Kubernetes cluster is unreachable»,
que manda a mirar el cluster y no el tunel (#162).
EOF
exit 1
