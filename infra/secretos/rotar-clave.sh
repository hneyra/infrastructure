#!/usr/bin/env bash
# Rota la clave de un rol de PostgreSQL contra el motor ya existente (issue #154).
#
# Contra la base **en marcha**, sin reinicios, y sin generar dos claves iguales:
#
#   1. Genera un valor nuevo.
#   2. `ALTER ROLE <rol> PASSWORD :'nueva'` contra el motor del ambiente, por
#      `kubectl exec` — el mismo patron de sustitucion segura que usa
#      `20-asignar-claves.sh`, nunca interpolado en el texto del SQL.
#   3. Actualiza SOLO esa clave en el `Secret`, sin tocar las demas que viven ahi.
#   4. Si algun `Deployment` la lee como pod en marcha, lo reprograma (`rollout
#      restart`) para que las conexiones NUEVAS usen la clave nueva. Las que ya
#      estaban abiertas siguen — `ALTER ROLE ... PASSWORD` no las cierra, que es lo que
#      `verificar-rotacion.sh` demuestra contra un motor real.
#
# Los cuatro roles que NO admite este guion, y por que:
#
#   - `postgres-superusuario`: "nunca-desde-el-nodo" en el inventario. Rotarlo exigiria
#     autenticar contra el motor con el superusuario que se esta cambiando a si mismo, y
#     el guion de inicializacion solo lo asigna una vez, con el volumen vacio.
#   - `keycloak-admin`: no es una clave de PostgreSQL. Rotarla es un `kcadm.sh
#     set-password`, documentado como procedimiento manual en INF-06.
#   - `respaldo-cifrado`: tampoco es un rol de PostgreSQL — es la clave simetrica de
#     wal-g, y rotarla deja ilegibles los respaldos ya escritos (INF-08 §4): solo tras
#     un incidente, con su procedimiento propio.
#   - `grafana-admin`: la cuenta de administrador de Grafana, no un rol del motor.
#
#   Los tres ultimos no llevan `rolDePostgres` en el inventario (secretos.ts), y el
#   guion los rechaza por eso: no hay ALTER ROLE que ejecutar.
#
# Sin `pulumi up` en ningun paso: el `Secret` se actualiza con `kubectl patch`, no
# recreando el objeto que Pulumi cree gestionar en solitario — el siguiente `pulumi up`
# no lo verias como deriva porque el campo que cambia (`data`) no esta en lo que Pulumi
# declaro con un valor (los manifiestos solo REFERENCIAN el Secret por nombre).
#
#   uso: secretos/rotar-clave.sh --ambiente stg|prod \
#        --rol kamayuk-app|kamayuk-owner|keycloak-base|kamayuk-respaldo|kamayuk-monitor|postgres-carga \
#        [--namespace sgtm-stg]
set -euo pipefail

AMBIENTE=""
ROL=""
NAMESPACE=""
while [ $# -gt 0 ]; do
    case "$1" in
        --ambiente) AMBIENTE=${2:?falta el valor de --ambiente}; shift 2 ;;
        --rol) ROL=${2:?falta el valor de --rol}; shift 2 ;;
        --namespace) NAMESPACE=${2:?falta el valor de --namespace}; shift 2 ;;
        *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
    esac
done
[ -n "$AMBIENTE" ] || { echo "Falta --ambiente (stg o prod)." >&2; exit 2; }
[ -n "$ROL" ] || {
    echo "Falta --rol. Los admitidos: kamayuk-app, kamayuk-owner, keycloak-base, kamayuk-respaldo," \
         "kamayuk-monitor, postgres-carga." >&2
    exit 2
}
NAMESPACE=${NAMESPACE:-sgtm-$AMBIENTE}

AQUI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
INFRA=$(cd "$AQUI/.." && pwd)

command -v kubectl >/dev/null 2>&1 || { echo "Falta kubectl." >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "Falta openssl." >&2; exit 1; }

cd "$INFRA"
entrada=$(yarn --silent secretos --ambiente "$AMBIENTE" | ROL="$ROL" node -e '
  const datos = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const e = datos.find((x) => x.rol === process.env.ROL);
  if (!e) { process.stderr.write(""); process.exit(1); }
  process.stdout.write(JSON.stringify(e));
') || {
    echo "«${ROL}» no esta en el inventario, o no admite rotacion por este guion." >&2
    echo "Los roles del inventario que SI tienen rolDePostgres (y por tanto se rotan asi):" >&2
    yarn --silent secretos --ambiente "$AMBIENTE" \
        | node -e 'JSON.parse(require("fs").readFileSync(0,"utf8")).filter((e)=>e.rolDePostgres).forEach((e)=>process.stderr.write("  - "+e.rol+"\n"))'
    exit 2
}

leer_campo() { printf '%s' "$entrada" | CAMPO="$1" node -e '
  const e = JSON.parse(require("fs").readFileSync(0, "utf8"));
  process.stdout.write(e[process.env.CAMPO] ?? "");
'; }

SECRETO=$(leer_campo secreto)
CLAVE=$(leer_campo clave)
ROL_DE_POSTGRES=$(leer_campo rolDePostgres)
REINICIAR=$(leer_campo requiereReinicioDe)

[ -n "$ROL_DE_POSTGRES" ] || {
    echo "«${ROL}» no es una clave de PostgreSQL — no hay ALTER ROLE que ejecutar." >&2
    echo "Si es «keycloak-admin»: el procedimiento manual esta en INF-06 (kcadm.sh set-password)." >&2
    exit 2
}

echo "· Rotando «${ROL_DE_POSTGRES}» ($ROL) en «${NAMESPACE}»"

MOTOR="deployment/$(printf 'sgtm-%s-postgres' "$AMBIENTE")"
SECRETO_SUPER=$(printf 'sgtm-%s-postgres-superusuario' "$AMBIENTE")

CLAVE_SUPER=$(kubectl -n "$NAMESPACE" get secret "$SECRETO_SUPER" \
    -o jsonpath='{.data.clave-superusuario}' | base64 --decode)
[ -n "$CLAVE_SUPER" ] || { echo "No se pudo leer la clave del superusuario desde «${SECRETO_SUPER}»." >&2; exit 1; }

VALOR_NUEVO=$(openssl rand -base64 32)

# Por la entrada estandar de `kubectl exec -i`, con `-v` y `:'nueva'`/`:"rol"`: la misma
# razon que en `verificar-rotacion.sh` — `--command`/`-c` NO interpola variables de
# psql, solo un guion leido de stdin lo hace. `:'nueva'` interpola como literal de
# cadena (una clave con comilla simple se asigna bien, sin romper la sentencia);
# `:"rol"` interpola como identificador citado, que es lo que hace falta para un nombre
# de rol que no se conoce hasta que corre el guion.
kubectl -n "$NAMESPACE" exec -i "$MOTOR" -- env PGPASSWORD="$CLAVE_SUPER" \
    psql --username=postgres --dbname=sgtm --quiet \
    -v rol="$ROL_DE_POSTGRES" -v nueva="$VALOR_NUEVO" <<'SQL'
ALTER ROLE :"rol" PASSWORD :'nueva';
SQL

echo "  ALTER ROLE ejecutado contra el motor en marcha"

# ── El Secret: solo esta clave, sin tocar las demas que viva ahi junto ───────
kubectl -n "$NAMESPACE" patch secret "$SECRETO" --type=merge \
    -p "{\"data\":{\"$CLAVE\":\"$(printf '%s' "$VALOR_NUEVO" | base64 --wrap=0)\"}}" >/dev/null
echo "  Secret «${SECRETO}/${CLAVE}» actualizado"

# ── Quien tenga un pod en marcha leyendo esto, se reprograma ─────────────────
if [ -n "$REINICIAR" ]; then
    echo "· Reprogramando deployment/$REINICIAR para que use la clave nueva"
    kubectl -n "$NAMESPACE" rollout restart "deployment/$REINICIAR"
    kubectl -n "$NAMESPACE" rollout status "deployment/$REINICIAR" --timeout=120s
else
    echo "  Nadie tiene un pod en marcha leyendo esto: los Jobs la leen fresca en su" \
         "proximo arranque, sin que haga falta reprogramar nada."
fi

echo
echo "Rotacion de «${ROL}» completa. Ningun valor se imprimio en esta salida."
