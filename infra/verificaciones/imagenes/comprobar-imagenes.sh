#!/usr/bin/env bash
#
# La mitad que solo puede contestar el registro: **¿esa etiqueta se puede pedir?**
#
#   verificaciones/imagenes/comprobar-imagenes.sh --ambiente stg
#
# ## Por que existe, y por que aqui
#
# `verificaciones/imagenes-publicadas.ts` contesta «hay alguien que publica esa imagen», leyendo
# los flujos de los clones hermanos. Es lo que se puede ejecutar en cualquier maquina y en cada
# PR, y no basta: un flujo puede existir y su ultima corrida haber fallado, o el filtro `paths` de
# otro repositorio puede haber dejado un `sha` sin construir. Que la etiqueta ESTE es otra
# afirmacion, y es la que decide si el pod arranca.
#
# Un `pulumi up` con una etiqueta que no existe no falla: deja el pod en `ImagePullBackOff`, con
# el manifiesto valido, el API de Kubernetes conforme y el planificador habiendo ubicado el pod.
# Por eso esto corre ANTES del `up`, no despues.
#
# ## Los tres desenlaces, y por que el tercero es el que engaña
#
#   200  la etiqueta existe.
#   404  MANIFEST_UNKNOWN: no existe. Es el estado en que estaban las ocho del corte el
#        2026-09-05, medido.
#   403  DENIED: la credencial no puede leer ese paquete. **No permite concluir nada**, ni que
#        falta ni que esta, asi que tambien falla — y con otro mensaje, porque el remedio es otro.
#        Es lo que recibe un PAT de escritorio sin `read:packages`, comprobado el mismo dia: los
#        paquetes `sgtm-*` contestaban 403 y los `kamayuk-*` 404, y leer los dos como «no existe»
#        habria dado un diagnostico equivocado sobre el monolito.
#
# La credencial sale de `GITHUB_TOKEN` en CI (con `packages: read`) o de `GHCR_USUARIO`/
# `GHCR_CLAVE`. Sin ninguna, esto **no pasa en verde**: sale con codigo 3 diciendo que no pudo
# comprobar nada. Una verificacion que se salta a si misma deja el despliegue en verde sin haber
# verificado nada.
set -euo pipefail

AMBIENTE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --ambiente) AMBIENTE="${2:-}"; shift 2 ;;
    *) echo "Uso: $0 --ambiente <stg|prod>" >&2; exit 2 ;;
  esac
done

case "$AMBIENTE" in
  stg|prod) ;;
  *) echo "Uso: $0 --ambiente <stg|prod>" >&2; exit 2 ;;
esac

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA="$(cd "$AQUI/../.." && pwd)"

USUARIO="${GHCR_USUARIO:-${GITHUB_ACTOR:-x}}"
CLAVE="${GHCR_CLAVE:-${GITHUB_TOKEN:-}}"
if [ -z "$CLAVE" ]; then
  echo "NO SE PUEDE COMPROBAR: falta la credencial del registro." >&2
  echo "  Pon GHCR_CLAVE (o GITHUB_TOKEN, en CI, con \`packages: read\`)." >&2
  echo "  Esto NO pasa en verde sin credencial: dar por buena una etiqueta que no se pudo" >&2
  echo "  mirar es exactamente el estado que esta comprobacion existe para cerrar." >&2
  exit 3
fi

# Las referencias las emite el mismo codigo que compone el manifiesto: preguntar por una lista
# escrita a mano seria preguntar por otra cosa. Y de paso se anota, POR REFERENCIA, si algun pod
# que la trae lo hace **sin credencial de registro**: esa es la mitad de la pregunta que decide si
# el pod arranca cuando la imagen es privada, y no se puede contestar sin mirar el manifiesto.
#
# «Sin credencial» NO es «su `spec` no declara `imagePullSecrets`», y creerlo daba un falso
# positivo sobre el monolito. La credencial de `ghcr.io` no vive en ningun pod: `index.ts` crea el
# `Secret` `<amb>-registro-credenciales` y **parchea el `ServiceAccount` `default`** del espacio de
# nombres de la plataforma, que es de donde la heredan todos sus pods —ninguno declara
# `serviceAccountName`— (issue #257). Asi que un pod de la plataforma la tiene aunque su `spec` no
# diga nada.
#
# Lo que NO la tiene son los cuatro sistemas: desde ADR-0031 cada uno vive en **su** espacio de
# nombres, y ni el `Secret` ni el parche llegan alli. Hoy sus imagenes son publicas y por eso
# funciona; el dia que se hagan privadas, sus catorce cargas quedan en `ImagePullBackOff`. Esa
# pareja de hechos es lo que esta columna mide.
REFERENCIAS=$(cd "$INFRA" && yarn --silent manifiestos --ambiente "$AMBIENTE" | python3 -c '
import json, sys

d = json.load(sys.stdin)
sin_credencial = {}
# El espacio de nombres cuyo ServiceAccount `default` lleva la credencial, puesta por `index.ts`.
plataforma = "kamayuk-" + sys.argv[1]

def especificaciones(m):
    k = m.get("kind")
    if k in ("Deployment", "Job", "StatefulSet"):
        yield m["spec"]["template"]["spec"]
    elif k == "CronJob":
        yield m["spec"]["jobTemplate"]["spec"]["template"]["spec"]
    elif k == "Pod":
        yield m["spec"]

for m in d["items"]:
    espacio = m.get("metadata", {}).get("namespace", "")
    for spec in especificaciones(m):
        credencial = bool(spec.get("imagePullSecrets")) or espacio == plataforma
        for c in list(spec.get("containers", [])) + list(spec.get("initContainers", [])):
            imagen = c.get("image", "")
            if not imagen.startswith("ghcr.io/"):
                continue
            sin_credencial[imagen] = sin_credencial.get(imagen, False) or not credencial

for imagen in sorted(sin_credencial):
    print(imagen, "sin-credencial" if sin_credencial[imagen] else "con-credencial")
' "$AMBIENTE")

if [ -z "$REFERENCIAS" ]; then
  echo "NO SE PUEDE COMPROBAR: el manifiesto de «${AMBIENTE}» no pide ninguna imagen de ghcr.io." >&2
  exit 3
fi

FALLO=0
while IFS=' ' read -r referencia credencial; do
  [ -n "$referencia" ] || continue
  sin_registro="${referencia#ghcr.io/}"
  repositorio="${sin_registro%:*}"
  etiqueta="${sin_registro##*:}"

  token=$(curl -sS -u "$USUARIO:$CLAVE" \
    "https://ghcr.io/token?service=ghcr.io&scope=repository:${repositorio}:pull" \
    | python3 -c 'import sys, json; print(json.load(sys.stdin).get("token", ""))')

  codigo=$(curl -sS -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer $token" \
    -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json' \
    "https://ghcr.io/v2/${repositorio}/manifests/${etiqueta}")

  # Y la misma pregunta SIN credencial. No es curiosidad: una imagen del producto que conteste
  # 200 a un anonimo es publica, y estos artefactos llevan dentro el backend del padron de una
  # municipalidad. Se dice siempre, y ademas es la mitad que falta para saber si el pod podra
  # traerla: una imagen PRIVADA que ningun `imagePullSecrets` acompaña es un ImagePullBackOff
  # garantizado, y eso si tiene que salir rojo.
  anonimo_token=$(curl -sS "https://ghcr.io/token?service=ghcr.io&scope=repository:${repositorio}:pull" \
    | python3 -c 'import sys, json; print(json.load(sys.stdin).get("token", ""))')
  anonimo=$(curl -sS -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer $anonimo_token" \
    -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json' \
    "https://ghcr.io/v2/${repositorio}/manifests/${etiqueta}")
  if [ "$anonimo" = "200" ]; then visibilidad="publica"; else visibilidad="privada"; fi

  case "$codigo" in
    200)
      echo "OK        $referencia  [$visibilidad, $credencial]"
      if [ "$visibilidad" = "privada" ] && [ "$credencial" = "sin-credencial" ]; then
        echo "FALTA CREDENCIAL $referencia" >&2
        echo "          La imagen es privada y algun pod que la trae vive en un espacio de" >&2
        echo "          nombres sin credencial de registro: ni su \`spec\` declara" >&2
        echo "          \`imagePullSecrets\` ni es el de la plataforma, cuyo ServiceAccount" >&2
        echo "          \`default\` la lleva (issue #257). Ese pod no puede bajarla y queda en" >&2
        echo "          ImagePullBackOff. Remedio: replicar el Secret dockerconfigjson en ese" >&2
        echo "          espacio de nombres y parchear su ServiceAccount, o publicar el paquete." >&2
        FALLO=1
      fi
      ;;
    404)
      echo "NO EXISTE $referencia" >&2
      echo "          Un \`pulumi up\` que la pida deja el pod en ImagePullBackOff." >&2
      echo "          Remedio: publicarla (\`publicar-imagenes.yml\` del repositorio que la" >&2
      echo "          construye) y declarar aqui un \`sha\` cuya corrida haya terminado en verde." >&2
      FALLO=1
      ;;
    *)
      echo "NO SE SABE $referencia — el registro contesto $codigo" >&2
      echo "          403 DENIED es «la credencial no puede leer ese paquete», que NO es «no" >&2
      echo "          existe». No se da por buena ninguna respuesta que no sea 200." >&2
      FALLO=1
      ;;
  esac
done <<< "$REFERENCIAS"

if [ "$FALLO" -ne 0 ]; then
  echo "FALLO: el manifiesto de «${AMBIENTE}» pide alguna etiqueta que no se pudo confirmar." >&2
  exit 1
fi

echo "Las $(echo "$REFERENCIAS" | wc -l | tr -d ' ') imagenes que «${AMBIENTE}» pide existen en el registro."
