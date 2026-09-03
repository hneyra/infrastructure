#!/usr/bin/env bash
# Fija en el stack de Pulumi los tres secretos de infraestructura -kubeconfig,
# backupAccessKeyId, backupSecretAccessKey- para poder correr `pulumi preview`/`up` a
# mano contra un VPS real. Es lo mismo que hace el paso "Configurar los secretos de
# infraestructura del stack" de `.github/workflows/infra.yml`, pero en esta máquina.
#
# Nunca deja rastro en git: `pulumi config set` escribe en Pulumi.<ambiente>.yaml, así
# que después de probar hay que `--limpiar` (o `pulumi config rm`) antes de cualquier
# commit. `stacks.test.ts` lo detecta si se olvida.
#
# Requiere un túnel SSH ya abierto al VPS del ambiente, con el puerto remoto correcto
# (prod: 6443, k3s nativo. stg: 6445, corre en k3d):
#
#   ssh -f -N -L <puerto>:localhost:6443 <usuario>@<host-de-prod>
#   ssh -f -N -L <puerto>:localhost:6445 <usuario>@<host-de-stg>
#
#   uso: probar-localmente.sh --ambiente stg|prod [--puerto 6443] [--limpiar]

set -euo pipefail

ambiente=""
puerto="6443"
limpiar="no"

while [ $# -gt 0 ]; do
  case "$1" in
    --ambiente) ambiente="$2"; shift 2 ;;
    --puerto) puerto="$2"; shift 2 ;;
    --limpiar) limpiar="si"; shift ;;
    *) echo "Argumento desconocido: $1" >&2; exit 1 ;;
  esac
done

if [ "$ambiente" != "stg" ] && [ "$ambiente" != "prod" ]; then
  echo "uso: probar-localmente.sh --ambiente stg|prod [--puerto 6443] [--limpiar]" >&2
  exit 1
fi

directorio="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
local_dir="$directorio/.local"

if [ "$limpiar" = "si" ]; then
  pulumi config rm kubeconfig --stack "$ambiente"
  pulumi config rm backupAccessKeyId --stack "$ambiente"
  pulumi config rm backupSecretAccessKey --stack "$ambiente"
  echo "Secretos de infraestructura quitados del stack $ambiente."
  exit 0
fi

# shellcheck source=/dev/null
source "$local_dir/secretos.env"

kubeconfig_original="$local_dir/$ambiente-kubeconfig.yaml"
if [ ! -f "$kubeconfig_original" ]; then
  echo "Falta $kubeconfig_original. Guarda ahí el kubeconfig del VPS de $ambiente," >&2
  echo "con el server ya en https://127.0.0.1:6443 (ver infra/README.md)." >&2
  exit 1
fi

kubeconfig_tmp="$(mktemp)"
trap 'rm -f "$kubeconfig_tmp"' EXIT
sed "s#server: https://127.0.0.1:6443#server: https://127.0.0.1:${puerto}#" \
  "$kubeconfig_original" > "$kubeconfig_tmp"

if [ "$ambiente" = "stg" ]; then
  clave_id="$STG_BACKUP_ACCESS_KEY_ID"
  clave_secreta="$STG_BACKUP_SECRET_ACCESS_KEY"
else
  clave_id="$PROD_BACKUP_ACCESS_KEY_ID"
  clave_secreta="$PROD_BACKUP_SECRET_ACCESS_KEY"
fi

pulumi config set --secret --stack "$ambiente" kubeconfig -- "$(cat "$kubeconfig_tmp")"
pulumi config set --secret --stack "$ambiente" backupAccessKeyId -- "$clave_id"
pulumi config set --secret --stack "$ambiente" backupSecretAccessKey -- "$clave_secreta"

echo "Listo. pulumi preview/up --stack $ambiente ya puede correr contra localhost:${puerto}."
echo "Cuando termines: probar-localmente.sh --ambiente $ambiente --limpiar"
