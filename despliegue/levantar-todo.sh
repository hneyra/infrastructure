#!/bin/bash
# Levanta la plataforma y UN sistema, y deja las identidades en condiciones de emitir tokens
# que sirvan. Es lo que hasta ahora eran cinco bloques de README y cuatro pasos a mano.
#
#   ./levantar-todo.sh                 # solo la plataforma
#   ./levantar-todo.sh identidad       # la plataforma, `identidad`, y las identidades
#   ./levantar-todo.sh identidad rentas
#
# Los sistemas se levantan de sus clones hermanos —`../../<sistema>/despliegue/compose.yaml`—,
# que es la disposicion que D0 y el CI comparten.
#
# ── EL ORDEN, que es la unica parte de esto que no se puede permutar ──────────
#
#   1. la plataforma            el motor con las cinco bases, Keycloak con sus dos realms,
#                               Traefik y el buzon de correo. `--wait` y nada mas.
#   2. el sistema               migraciones -> implantacion -> backend, encadenados por el
#                               propio compose. Con `--env-file` del `.env` de AQUI: sus
#                               claves son del motor de la plataforma, no suyas.
#   3. preparar-identidades.sh  los ambitos, el administrador con clave, los clientes de
#                               servicio y el inquilino.
#
# El paso 3 va DESPUES del 2 y no antes, y es medido y no supuesto: necesita el `id` que la
# SECUENCIA le dio a la municipalidad, y esa fila la escribe la IMPLANTACION del sistema
# (paso 2). Con `identidad` sin levantar, el paso 3 encuentra la tabla vacia — y falla
# diciendolo, en vez de dejar un realm a medias.
#
# Lo que este guion NO hace: levantar los cuatro consumidores ni medir la ventana de la copia
# local (etapa 5 de ADR-0039). Y no toca el cluster: aqui todo es compose.
set -uo pipefail

AQUI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HERMANOS=$(cd "$AQUI/../.." && pwd)
ENV="$AQUI/.env"

titulo() { printf '\n\033[1m══ %s\033[0m\n' "$*"; }
ok()     { printf '  \033[32m·\033[0m %s\n' "$*"; }
muere()  { printf '\n\033[31mFALLO: %s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || muere "no hay «docker» en el PATH."
docker compose version >/dev/null 2>&1 || muere "«docker compose» (v2) no responde."

# ── El `.env`, generado si no esta ────────────────────────────────────────────
# El `sed` que la cabecera de `.env.ejemplo` recomienda pone la MISMA clave en los seis
# marcadores —`$(…)` lo expande la shell UNA vez, antes de que `sed` corra—, y seis roles con
# la misma clave es un solo secreto disfrazado de seis. Aqui se genera una por marcador, que
# es lo que `docs/D0-desarrollo/entorno-local.md` ya documentaba a mano.
if [ ! -f "$ENV" ]; then
    titulo "El .env no estaba: se genera de .env.ejemplo con una clave por marcador"
    [ -f "$AQUI/.env.ejemplo" ] || muere "no esta «$AQUI/.env.ejemplo»."
    python3 - "$AQUI/.env.ejemplo" "$ENV" <<'PY'
import pathlib, re, secrets, sys

origen, destino = (pathlib.Path(a) for a in sys.argv[1:3])

# Anclado a una linea de ASIGNACION, y esto se midio: con `re.sub(r"CAMBIAR_\S+", …)` sobre el
# archivo entero salen SIETE reemplazos habiendo seis marcadores — el septimo cae dentro del
# comentario que documenta la receta `sed`, y deja el `.env` generado con su cabecera
# destrozada. El mismo defecto de alcance que tiene la receta que ese comentario recomienda.
MARCADOR = re.compile(r"^([A-Z_]+)=CAMBIAR_\w+\s*$", re.MULTILINE)

texto, cuantas = MARCADOR.subn(lambda m: f"{m.group(1)}={secrets.token_hex(24)}", origen.read_text())
if cuantas == 0:
    sys.exit("«.env.ejemplo» no tiene ninguna linea «VARIABLE=CAMBIAR_…»: o cambio de forma, o "
             "ya lleva claves dentro — y entonces copiarlo seria versionar un secreto.")
# Crear no es haber creado: que no quede ni una asignacion sin clave. Una sola que sobreviva
# deja un rol con la contrasena literal «CAMBIAR_app», que es peor que no tener ninguna.
if quedan := [l for l in texto.splitlines() if re.match(r"^[A-Z_]+=CAMBIAR_", l)]:
    sys.exit(f"quedaron {len(quedan)} marcador(es) sin reemplazar: {quedan}")
destino.write_text(texto)
print(f"  {cuantas} claves generadas, una por marcador, todas distintas")
PY
    [ -f "$ENV" ] || muere "no se pudo escribir «$ENV»."
    chmod 600 "$ENV"
    ok "escrito $ENV (modo 600). Esta en .gitignore"
else
    ok "usando el .env que ya existe: $ENV"
fi

# `COMPOSE_FILE` lo pone este guion, que es la mitad de #74 que se puede tapar desde aqui:
# los guiones de `identidad/` hacen `docker compose` sin `-f`.
export COMPOSE_FILE="plataforma.compose.yaml"
plataforma() { (cd "$AQUI" && docker compose --env-file "$ENV" "$@"); }

# El `.env` se lee ya aqui —y no solo al final— porque el bucle de sistemas necesita
# `KAMAYUK_UBIGEO` para derivar el id declarado de su archivo versionado.
set -a; . "$ENV"; set +a

# ── 1 · la plataforma ─────────────────────────────────────────────────────────
titulo "1 · la plataforma (motor, Keycloak, ingreso y correo)"
plataforma up -d --wait || muere \
"la plataforma no llego a sana. Que quedo a medias:
$(plataforma ps --format '  {{.Service}}\t{{.Status}}' 2>/dev/null)
  Y los registros del que no arranco: docker compose -f $AQUI/plataforma.compose.yaml logs"
ok "los cuatro servicios de la plataforma, sanos"

# ── 2 · los sistemas que se pidan ─────────────────────────────────────────────
SISTEMAS=("$@")
for sistema in "${SISTEMAS[@]}"; do
    compose="$HERMANOS/$sistema/despliegue/compose.yaml"
    titulo "2 · el sistema «$sistema»"
    [ -f "$compose" ] || muere \
"no esta «$compose». Los sistemas se levantan de sus clones hermanos; clona el que falte:
      cd $HERMANOS && git clone https://github.com/hneyra/$sistema"
    # El `municipalidad.id` DECLARADO se DERIVA del archivo versionado, que es su unica
    # fuente (#73, salida 1). Pasarlo por el `.env` seria una tercera declaracion del mismo
    # numero, y el defecto que #73 cerro fue exactamente eso: dos declaraciones que nadie
    # comparaba, alimentando caminos distintos. La guarda
    # `infra/verificaciones/el-id-de-la-municipalidad.test.ts` ata el archivo al stack; esta
    # linea ata el archivo a lo que la implantacion local escribe.
    declarada="$AQUI/identidad/municipalidades/${KAMAYUK_UBIGEO}.json"
    if [ -f "$declarada" ]; then
        KAMAYUK_MUNICIPALIDAD_ID=$(python3 -c "
import json, sys
d = json.load(open('$declarada'))
m = d.get('municipalidadId')
if not isinstance(m, int) or isinstance(m, bool) or m <= 0:
    sys.exit('«municipalidadId» de $declarada no es un entero positivo: %r' % (m,))
print(m)") || muere "el id de la municipalidad" \
"«$declarada» no declara un «municipalidadId» utilizable. De ese numero sale el claim
  «municipalidad_id» de cada token, y es el inquilino del que cuelga el RLS de nueve tablas."
        export KAMAYUK_MUNICIPALIDAD_ID
        ok "municipalidad_id declarado: $KAMAYUK_MUNICIPALIDAD_ID (de ${KAMAYUK_UBIGEO}.json)"
    fi

    # `--env-file` con el `.env` de la PLATAFORMA, y es lo que #74 dice que no esta escrito
    # en ningun sitio: las claves que el sistema necesita —`kamayuk_owner`, `kamayuk_app`— son
    # del motor de la plataforma, asi que su fuente es este archivo y no uno propio. Sin el,
    # el compose del sistema para con «falta KAMAYUK_CLAVE_OWNER» y el remedio no es evidente.
    docker compose -f "$compose" --env-file "$ENV" up --build --wait || muere \
"«$sistema» no llego a sano. Que quedo a medias:
$(docker compose -f "$compose" --env-file "$ENV" ps -a --format '  {{.Service}}\t{{.Status}}' 2>/dev/null)
  Los registros: docker compose -f $compose --env-file $ENV logs"
    ok "«$sistema»: migraciones, implantacion y backend"
done

# ── 3 · las identidades ───────────────────────────────────────────────────────
# Solo si se levanto `identidad`: sin su base implantada no hay `municipalidad` de donde leer
# el id, y el guion lo dice pero no hace falta llegar a que lo diga.
# Sin tuberia (#91): un SIGPIPE en el `printf` dejaria este `if` en falso y el paso 3 se saltaria
# EN SILENCIO, que es peor que fallar. Es la misma trampa que costo el mensaje falso de
# `reconciliar-identidades.sh`, y aqui no hay ni que medirla para evitarla.
LEVANTAMOS_IDENTIDAD=0
for _s in "${SISTEMAS[@]}"; do [ "$_s" = identidad ] && LEVANTAMOS_IDENTIDAD=1; done
if [ "$LEVANTAMOS_IDENTIDAD" = 1 ]; then
    titulo "3 · las identidades del realm"
    "$AQUI/identidad/preparar-identidades.sh" || muere \
"«preparar-identidades.sh» fallo. Su salida dice en cual de sus cuatro pasos, y cada paso
  nombra el defecto abierto que rodea (#72, #73, #74)."
else
    titulo "3 · las identidades del realm — OMITIDO, y se dice"
    printf '  «identidad» no esta entre los sistemas pedidos, asi que la tabla «municipalidad»\n'
    printf '  no existe y no hay id que alinear. Para prepararlas:\n'
    printf '      %s identidad\n' "$0"
fi

titulo "Listo"
# Los puertos salen del `.env`, no escritos aqui: son suyos y en esta maquina no son los de
# `.env.ejemplo` (#74). Es la misma razon por la que `ejercer.sh` los deriva en vez de traerlos.
set -a; . "$ENV"; set +a
printf '  Ingreso:  http://localhost:%s   (y la API en /identidad/api/v1)\n' "${KAMAYUK_PUERTO_INGRESO:-8080}"
printf '  Keycloak: http://localhost:%s   (realm «%s»)\n' "${KAMAYUK_PUERTO_IDENTIDAD:-8180}" "${KC_REALM:-kamayuk}"
printf '  Correo:   http://localhost:%s\n' "${KAMAYUK_PUERTO_CORREO:-8025}"
printf '\n  Ejercer la API de punta a punta (con las dos claves que el paso 3 imprimio):\n'
printf '      cd %s/identidad/despliegue/pruebas-e2e && ./ejercer.sh\n' "$HERMANOS"
printf '\n  Bajarlo todo y BORRAR los datos:\n'
printf '      docker compose -f %s --env-file %s down -v\n' "$AQUI/plataforma.compose.yaml" "$ENV"
