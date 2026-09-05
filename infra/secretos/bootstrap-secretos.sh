#!/usr/bin/env bash
# Genera los secretos de la aplicacion que falten, sin que nadie teclee una clave
# (issue #154).
#
# Por cada `Secret` del inventario (`yarn secretos`): lee lo que ya existe en el
# cluster, le pasa eso y la lista de claves requeridas a `completar-secreto.ts` —que
# decide que falta y genera SOLO eso, sin decodificar ni tocar lo que ya estaba—, y
# aplica el resultado. Ejecutarlo dos veces seguidas la segunda vez no cambia nada:
# todo lo que faltaba en la primera ya existe.
#
# **Esto NO es pulumi up.** No pasa por el proveedor de Kubernetes de Pulumi ni por su
# estado: habla con el API por `kubectl`, con el mismo kubeconfig que usa `pulumi up`
# —el del tunel SSH en CI (INF-01 §1.4)—. Es ADR-0011 §3 y INF-06 a la letra: un
# secreto generado por Pulumi vive en el estado de Pulumi, y esa clave abre el padron
# de todas las municipalidades. Este guion no tiene estado ninguno: lo unico que
# persiste es el propio Secret de Kubernetes, y lo que se imprime aqui son huellas, no
# valores.
#
# Corre ANTES de `pulumi up`: los Deployment y Job que Pulumi va a crear referencian
# estos Secret por nombre, y sin ellos los pods se quedan en `Pending`.
#
# CINCO ESPACIOS DE NOMBRES, NO UNO (C-17, punto 4)
# ------------------------------------------------------------------------------
# Hasta C-17 este guion recibia UN `--namespace` y creaba todo alli. Era cierto mientras el
# unico consumidor fuera el monolito; desde ADR-0031 cada sistema tiene el suyo, y **un `Secret`
# no cruza namespaces**: un pod solo monta los de su propio espacio.
#
# Medido antes de arreglarlo: `yarn secretos --ambiente stg` declaraba NUEVE `Secret` —los nueve
# del monolito— y los manifiestos de los cuatro sistemas pedian DIEZ. La interseccion era CERO, y
# este guion corria, decia «Listo» y creaba cero de los diez. Una herramienta que contesta que si
# porque no esta mirando, la misma forma que `yarn capacidad` tenia antes de C-16.
#
# Ahora el namespace es un dato de cada entrada del inventario y no una opcion de la linea de
# ordenes: se crea cada uno y cada `Secret` se aplica en el suyo.
#
# LOS ESPEJOS
# ------------------------------------------------------------------------------
# Ocho de esos diez son la clave de `sgtm_app` o de `sgtm_owner`, que son roles del CLUSTER: los
# cuatro sistemas los crean con el mismo nombre y PostgreSQL le da a un rol UNA contrasena. No
# son ocho secretos nuevos: son el MISMO valor publicado en el namespace de quien lo consume.
# Generarlos por separado dejaria a tres de cada cuatro sin poder conectarse, con un
# «password authentication failed» que se lee como clave mal generada y es un modelo mal
# entendido. El inventario los marca con `espejoDe`, y aqui se COPIAN de su origen —en base64,
# sin decodificar y sin pasar por `argv` de ningun proceso—.
#
# Y se copian en CADA corrida, no solo cuando faltan: el `Secret` de la plataforma es la fuente
# de verdad. La consecuencia hay que saberla: tras `rotar-clave.sh` los espejos quedan con el
# valor viejo hasta la siguiente corrida de este guion (INF-06).
#
#   uso: secretos/bootstrap-secretos.sh --ambiente stg|prod
set -euo pipefail

AMBIENTE=""
while [ $# -gt 0 ]; do
    case "$1" in
        --ambiente) AMBIENTE=${2:?falta el valor de --ambiente}; shift 2 ;;
        --namespace)
            echo "«--namespace» ya no existe: los secretos viven en CINCO espacios de nombres" >&2
            echo "—el de la plataforma y el de cada sistema— y cual es cual lo dice el propio" >&2
            echo "inventario (\`yarn secretos --ambiente <amb>\`). Un valor aqui solo podria" >&2
            echo "acertar con uno de los cinco." >&2
            exit 2 ;;
        *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
    esac
done
[ -n "$AMBIENTE" ] || { echo "Falta --ambiente (stg o prod)." >&2; exit 2; }

AQUI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
INFRA=$(cd "$AQUI/.." && pwd)

command -v kubectl >/dev/null 2>&1 || { echo "Falta kubectl." >&2; exit 1; }

# ----------------------------------------------------------------------------
# Antes de tocar nada: ¿contesta el API server? (#708)
#
# Este guion es el PRIMERO del despliegue que habla con el cluster, asi que cuando el
# API no responde el que sale rojo es el. El 2026-09-02 eso paso dos corridas seguidas
# y el mensaje que quedaba en el log era:
#
#     error validating "/tmp/tmp.NWy5wwQo3y": error validating data: failed to
#     download openapi: Get "https://localhost:6443/openapi/v2?timeout=32s":
#     net/http: TLS handshake timeout
#
# —dentro de «Completando los secretos», detras de una linea que decia «generada»—.
# Leido asi parece un fallo de secretos, y no lo es: `kubectl apply` se descarga el
# esquema del API para validar, y lo que vencio fue esa descarga.
#
# La causa medida no fue de credenciales ni de red del runner —el paso anterior habia
# leido el nodo sin problema—: fue CONTENCION DE CPU en la maquina que aloja el nodo.
# El contenedor de k3d no lleva limite ni reserva (`NanoCpus=0`, `CpuShares=0`), asi que
# compite en igualdad con todo lo demas; con la maquina a 40 % de presion de CPU
# sostenida (`/proc/pressure/cpu`, `some avg300=40.32`) y carga 10,6 sobre 6 nucleos, un
# handshake TLS —que es trabajo de CPU— no cabe en el plazo del cliente. El kubelet
# sigue sano y el nodo sigue `Ready`, que es lo que hace el sintoma tan desconcertante:
# no hay ninguna condicion de presion que mirar.
#
# Por eso se pregunta ANTES y se dice APARTE. No arregla la contencion —eso es del
# nodo—, pero separa «el API no contesta» de «el despliegue fallo», que hoy salian los
# dos como «bootstrap-secretos.sh murio» y habia que leer el log entero para
# distinguirlos.
if ! kubectl version --request-timeout=20s >/dev/null 2>&1; then
    cat >&2 <<'DIAGNOSTICO'
FALLO: el API server no contesta. Esto NO es un fallo de secretos ni de despliegue.

`kubectl version` no completa en 20 s, asi que ninguna de las operaciones que siguen
—crear el namespace, leer los Secret que ya estan, aplicarlos— puede funcionar, y la
que fallara primero dara un mensaje que habla de otra cosa.

Que mirar, en este orden:
  1. La maquina que aloja el nodo: `uptime` y `cat /proc/pressure/cpu`. Un handshake
     TLS es trabajo de CPU; con presion sostenida vence antes de completarse, y el
     nodo sigue apareciendo `Ready` porque el kubelet si llega a latir (#708).
  2. El tunel al API: `kubectl cluster-info`. En CI es un tunel SSH (INF-01 §1.4).
  3. El propio k3s en el nodo, si lo anterior esta sano.

`yarn capacidad` no ve esto y no es un defecto suyo: compara lo que los pods PIDEN
contra lo asignable del nodo, y esta contencion viene de procesos de fuera del cluster.
DIAGNOSTICO
    exit 1
fi

# Cada namespace del inventario, y no uno: este guion corre ANTES de `pulumi up`, asi que los
# que Pulumi va a crear todavia no existen y `kubectl apply` de un Secret fallaria con un mensaje
# que no dice por que. Idempotente: `pulumi up` despues reclama los mismos objetos sin conflicto.
cd "$INFRA"
inventario=$(yarn --silent secretos --ambiente "$AMBIENTE")

espacios=$(echo "$inventario" | node -e '
  const datos = JSON.parse(require("fs").readFileSync(0, "utf8"));
  process.stdout.write([...new Set(datos.map((e) => e.namespace))].join("\n"));
')
[ -n "$espacios" ] || { echo "El inventario no trae ningun namespace." >&2; exit 1; }

while IFS= read -r ns; do
    [ -n "$ns" ] || continue
    kubectl create namespace "$ns" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
done <<< "$espacios"

# ----------------------------------------------------------------------------
# Pasada 1: lo que se GENERA. Todo lo que no es espejo de otro valor.
# ----------------------------------------------------------------------------
echo "Completando los secretos que se generan..."

# shellcheck disable=SC2016  # `${}` aqui son plantillas de JavaScript, no del shell
grupos=$(echo "$inventario" | node -e '
  const datos = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const propios = datos.filter((e) => e.espejoDe === undefined);
  process.stdout.write([...new Set(propios.map((e) => `${e.namespace} ${e.secreto}`))].join("\n"));
')

while read -r ns nombre; do
    [ -n "$nombre" ] || continue

    claves=$(echo "$inventario" | NS="$ns" SECRETO="$nombre" node -e '
      const datos = JSON.parse(require("fs").readFileSync(0, "utf8"));
      const claves = datos
        .filter((e) => e.namespace === process.env.NS && e.secreto === process.env.SECRETO)
        .filter((e) => e.espejoDe === undefined)
        .map((e) => e.clave);
      process.stdout.write(claves.join(" "));
    ')

    # Vacio si el Secret todavia no existe: es el caso normal del primer despliegue.
    existente=$(kubectl -n "$ns" get secret "$nombre" -o json 2>/dev/null || echo "")

    salida=$(mktemp)
    # shellcheck disable=SC2086
    printf '%s' "$existente" \
        | yarn --silent vite-node herramientas/completar-secreto-cli.ts "$nombre" "$ns" $claves \
        > "$salida"

    kubectl apply -f "$salida" >/dev/null
    rm -f "$salida"
done <<< "$grupos"

# ----------------------------------------------------------------------------
# Pasada 2: los ESPEJOS. Detras de la primera, porque copian de lo que ella crea.
# ----------------------------------------------------------------------------
#
# El valor viaja en base64 —tal como lo devuelve el API— y NUNCA se decodifica: lo que se lee de
# un `Secret` se escribe en otro sin pasar por texto claro. Y va por la entrada estandar de
# `kubectl apply`, no por `argv`: un valor en la linea de ordenes lo ve cualquiera con `ps`, que
# es el mismo motivo por el que el migrador rechaza argumentos.
echo "Copiando los espejos a los namespaces que los consumen..."

# shellcheck disable=SC2016  # `${}` aqui son plantillas de JavaScript, no del shell
espejos=$(echo "$inventario" | node -e '
  const datos = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const donde = new Map(datos.map((e) => [`${e.secreto}/${e.clave}`, e.namespace]));
  const filas = datos
    .filter((e) => e.espejoDe !== undefined)
    .map((e) => {
      const llave = `${e.espejoDe.secreto}/${e.espejoDe.clave}`;
      const nsOrigen = donde.get(llave);
      if (nsOrigen === undefined) {
        throw new Error(`«${e.secreto}» dice ser espejo de «${llave}», que no esta en el inventario.`);
      }
      return [e.namespace, e.secreto, e.clave, nsOrigen, e.espejoDe.secreto, e.espejoDe.clave].join(" ");
    });
  process.stdout.write(filas.join("\n"));
')

while read -r ns nombre clave nsOrigen secretoOrigen claveOrigen; do
    [ -n "$nombre" ] || continue

    valor=$(kubectl -n "$nsOrigen" get secret "$secretoOrigen" \
        -o "jsonpath={.data.$claveOrigen}" 2>/dev/null || true)
    if [ -z "$valor" ]; then
        echo "  FALTA  ${nsOrigen}/${secretoOrigen}/${claveOrigen}: sin el origen no hay nada" >&2
        echo "         que copiar a ${ns}/${nombre}. La pasada 1 tenia que haberlo creado." >&2
        exit 1
    fi

    kubectl apply -f - >/dev/null <<JSON
{"apiVersion":"v1","kind":"Secret","type":"Opaque",
 "metadata":{"name":"${nombre}","namespace":"${ns}"},
 "data":{"${clave}":"${valor}"}}
JSON
    echo "  · ${ns}/${nombre}/${clave}: copiado de ${nsOrigen}/${secretoOrigen}/${claveOrigen}"
done <<< "$espejos"

echo "Listo. Ningun valor se imprimio en esta salida — solo huellas de lo que se generó."
