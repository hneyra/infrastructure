#!/usr/bin/env bash
# Que sellar la raiz del contenedor que descarga wal-g no rompe su arranque, y que el
# `/tmp` que lo acompaña no es decorativo (issue #157, «sistema de archivos raiz de solo
# lectura donde se pueda»).
#
# Por que hace falta un guion y no basta una prueba de `componentes.test.ts`: lo que ahi
# se comprueba es que el MANIFIESTO dice `readOnlyRootFilesystem: true` y monta `/tmp`.
# Que el contenedor ARRANQUE con eso puesto es otra afirmacion, y este PR ya la vio
# fallar dos veces —`capabilities.drop: ["ALL"]` dejo al entrypoint de PostgreSQL sin
# CAP_CHOWN, y `runAsNonRoot` rompio seis contenedores cuya imagen fija el usuario por
# nombre—: las dos aparecieron contra un clúster real y ninguna en `yarn verificar`.
#
# Los tres casos, y el segundo es la demostracion de que la comprobacion puede fallar:
#
#   A) Raiz sellada CON `/tmp` montado —lo que el manifiesto declara—: tiene que
#      terminar en 0 y dejar el binario donde el motor lo espera.
#   B) Raiz sellada SIN `/tmp`: tiene que FALLAR. Si pasara, es que sellar la raiz no
#      estaba haciendo nada —el caso A no probaria nada— o que la imagen escribe el
#      `.tar.gz` en otro sitio del que este guion cree.
#   C) Raiz escribible y sin `/tmp` —el estado anterior al issue #157—: termina en 0.
#      Esta aqui para dejar dicho por que el defecto no se notaba: el montaje de `/tmp`
#      y el `readOnlyRootFilesystem` son UNA decision, y solo importan juntos.
#
# La imagen, los `args` y el `securityContext` **se leen del manifiesto emitido**, nunca
# se copian aqui: un guion con la orden duplicada comprueba lo que decia el manifiesto el
# dia que se escribio, no lo que dice hoy.
#
# Los dos `emptyDir` se emulan con directorios `1777`, que es como el kubelet los crea
# —de ahi que un `runAsUser: 65534` pueda escribir en ellos sin coincidir con el usuario
# de la imagen—. Un volumen nombrado de Docker NO sirve: nace `root:root 0755` y el `mv`
# falla por una razon que no tiene nada que ver con lo que se quiere comprobar.
#
#   uso: verificaciones/raiz-sellada/verificar-raiz-sellada.sh [--ambiente stg]
#
# Necesita Docker y salida a la red para bajar el binario de wal-g. No necesita clúster.
set -euo pipefail

AMBIENTE=stg
while [ $# -gt 0 ]; do
    case "$1" in
        --ambiente) AMBIENTE=${2:?falta el valor de --ambiente}; shift 2 ;;
        *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
    esac
done

AQUI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
INFRA=$(cd "$AQUI/../.." && pwd)
TRABAJO=$(mktemp -d)
trap 'rm -rf "$TRABAJO"' EXIT

cd "$INFRA"

command -v docker >/dev/null 2>&1 || { echo "FALLO: falta docker." >&2; exit 1; }

CONTENEDOR=wal-g-instalar

echo "· Leyendo «${CONTENEDOR}» del manifiesto de $AMBIENTE"
yarn --silent manifiestos --ambiente "$AMBIENTE" > "$TRABAJO/salida.txt"

node -e '
    const fs = require("fs");
    const texto = fs.readFileSync(process.argv[1], "utf8");
    // `yarn --silent` puede colar lineas propias antes y despues del JSON.
    const inicio = texto.indexOf("{");
    const fin = texto.lastIndexOf("}");
    const manifiesto = JSON.parse(texto.slice(inicio, fin + 1));
    const nombre = process.argv[2];

    for (const objeto of manifiesto.items) {
        const pod =
            objeto.kind === "Deployment" ? objeto.spec.template.spec
          : objeto.kind === "CronJob" ? objeto.spec.jobTemplate.spec.template.spec
          : undefined;
        if (!pod) continue;
        const c = (pod.initContainers ?? []).find((x) => x.name === nombre);
        if (!c) continue;

        const rutas = (c.volumeMounts ?? []).map((v) => v.mountPath);
        fs.writeFileSync(process.argv[3], [
            `IMAGEN=${JSON.stringify(c.image)}`,
            `UID_DEL_CONTENEDOR=${JSON.stringify(String(c.securityContext.runAsUser))}`,
            `RAIZ_SELLADA=${JSON.stringify(String(c.securityContext.readOnlyRootFilesystem === true))}`,
            `MONTA_TMP=${JSON.stringify(String(rutas.includes("/tmp")))}`,
            `DIRECTORIO_DEL_BINARIO=${JSON.stringify(rutas.find((r) => r !== "/tmp"))}`,
        ].join("\n") + "\n");
        fs.writeFileSync(process.argv[4], c.args[0]);
        process.exit(0);
    }
    console.error(`FALLO: no hay ningun init container «${nombre}» en el manifiesto.`);
    process.exit(1);
' "$TRABAJO/salida.txt" "$CONTENEDOR" "$TRABAJO/spec.env" "$TRABAJO/args.sh"

# shellcheck source=/dev/null
. "$TRABAJO/spec.env"
ARGS=$(cat "$TRABAJO/args.sh")

echo "  imagen: $IMAGEN · UID: $UID_DEL_CONTENEDOR · binario en: $DIRECTORIO_DEL_BINARIO"

# El manifiesto tiene que declarar las dos cosas. Si alguien quita una, este guion deja
# de tener sentido y lo dice, en vez de comprobar en silencio algo distinto.
[ "$RAIZ_SELLADA" = "true" ] || {
    echo "FALLO: «${CONTENEDOR}» ya no declara readOnlyRootFilesystem en el manifiesto." >&2
    exit 1
}
[ "$MONTA_TMP" = "true" ] || {
    echo "FALLO: «${CONTENEDOR}» ya no monta /tmp. Con la raiz sellada no puede arrancar." >&2
    exit 1
}

# Un `emptyDir`, como lo crea el kubelet: directorio normal, 1777, no un volumen de Docker.
emptydir() {
    local ruta="$TRABAJO/$1"
    rm -rf "$ruta" && mkdir -p "$ruta" && chmod 1777 "$ruta"
    echo "$ruta"
}

# $1 = etiqueta · $2 = "sellada"|"escribible" · $3 = "con-tmp"|"sin-tmp"
correr() {
    local etiqueta=$1 raiz=$2 tmp=$3
    local bin; bin=$(emptydir "bin-$etiqueta")
    local opciones=(--rm --user "$UID_DEL_CONTENEDOR"
                    --cap-drop ALL --security-opt no-new-privileges
                    -v "$bin:$DIRECTORIO_DEL_BINARIO")

    [ "$raiz" = "sellada" ] && opciones+=(--read-only)
    if [ "$tmp" = "con-tmp" ]; then
        local t; t=$(emptydir "tmp-$etiqueta")
        opciones+=(-v "$t:/tmp")
    fi

    # El proxy de egreso del entorno de desarrollo, si lo hay. En CI no hay ninguno y
    # estas variables van vacias, que es lo mismo que no pasarlas.
    [ -n "${HTTPS_PROXY:-}" ] && opciones+=(--network host -e "HTTPS_PROXY=$HTTPS_PROXY" -e "https_proxy=$HTTPS_PROXY")
    [ -r /root/.ccr/ca-bundle.crt ] && opciones+=(-e CURL_CA_BUNDLE=/ca/ca.crt -v /root/.ccr/ca-bundle.crt:/ca/ca.crt:ro)

    set +e
    docker run "${opciones[@]}" "$IMAGEN" /bin/sh -c "$ARGS" > "$TRABAJO/log-$etiqueta.txt" 2>&1
    local codigo=$?
    set -e
    echo "$codigo"
}

fallos=0

echo
echo "· A) raiz sellada CON /tmp —lo que el manifiesto declara—"
codigo=$(correr a sellada con-tmp)
if [ "$codigo" = "0" ] && [ -x "$TRABAJO/bin-a/wal-g" ]; then
    echo "  Termina en 0 y deja el binario: correcto"
    echo "  $("$TRABAJO/bin-a/wal-g" --version 2>&1 | head -1)"
else
    echo "  FALLO: salio con $codigo, o no dejo un binario ejecutable en $DIRECTORIO_DEL_BINARIO" >&2
    sed -n '$p' "$TRABAJO/log-a.txt" >&2
    fallos=$((fallos + 1))
fi

echo
echo "· B) LA DEMOSTRACION: raiz sellada SIN /tmp —tiene que fallar—"
codigo=$(correr b sellada sin-tmp)
if [ "$codigo" != "0" ]; then
    echo "  Falla con $codigo: correcto. $(sed -n '$p' "$TRABAJO/log-b.txt")"
else
    echo "  FALLO: termino en 0 sin /tmp montado." >&2
    echo "  Si esto pasa, el caso A no demuestra nada: o la raiz no se esta sellando de" >&2
    echo "  verdad, o la imagen ya no escribe su descarga en /tmp." >&2
    fallos=$((fallos + 1))
fi

echo
echo "· C) raiz escribible y sin /tmp —el estado anterior al issue #157—"
codigo=$(correr c escribible sin-tmp)
if [ "$codigo" = "0" ]; then
    echo "  Termina en 0: correcto, y es por que el defecto no se notaba —el montaje de"
    echo "  /tmp y el readOnlyRootFilesystem solo importan juntos—"
else
    echo "  FALLO: salio con $codigo. Se esperaba que el estado anterior funcionase; si no," >&2
    echo "  el fallo del caso B no se puede atribuir a la raiz sellada." >&2
    sed -n '$p' "$TRABAJO/log-c.txt" >&2
    fallos=$((fallos + 1))
fi

echo
[ "$fallos" -eq 0 ] || { echo "FALLO: $fallos de 3 casos no salieron como debian." >&2; exit 1; }
echo "La raiz sellada de «${CONTENEDOR}» arranca, y el /tmp que la acompaña no es decorativo."
