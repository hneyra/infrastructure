#!/usr/bin/env bash
# El ambiente DESPLEGADO, comprobado contra si mismo (issue #434).
#
# No comprueba manifiestos —eso es `yarn verificar`, y corre sin clúster—: comprueba el
# clúster que hay delante. Es la escalera del issue #434 hecha ejecutable, para que
# «prod corriendo» deje de ser una afirmación y pase a ser una corrida con salida.
#
# Lo que mira, en este orden:
#
#   1. La version declarada, la desplegada y **el esquema**. Es la trampa de #434: el
#      campo `image` de un Deployment lleva `ignoreChanges` (ADR-0011 §5), asi que la
#      version que corre puede ser legitimamente mas nueva que la declarada. Lo que NO
#      puede es que la base tenga MENOS migraciones que las que trae la version
#      declarada: eso significa que el Job de migracion de esa version no corrio, y el
#      sintoma de esa situacion no es un error sino una carga que termina en verde sin
#      escribir nada (PR #244). **Ni MAS**, desde #675: hasta entonces ese caso caia en
#      el «al dia» y se declaraba verde, de modo que declarar una version con
#      migraciones de menos —revertir esa linea, o apuntarla al sha equivocado— no lo
#      veia nadie.
#
#      Lo que este guion NO puede ver, y por eso no es toda la comprobacion: si la
#      version DECLARADA lleva meses sin moverse, aqui todo sale «al dia» y el ambiente
#      corre un esquema viejo. Ese tercer numero —lo que declara `origin/main`— lo mide
#      `infra/verificaciones/deriva-de-migraciones.test.ts`, que corre sin clúster.
#      Medido el 2026-09-01 contra stg: «48 · 48 · OK», con `main` en 61.
#   2. Lo sembrado por la implantacion (#120): municipalidad, grupo, usuario, miembro y
#      permiso. `count(*) = 0` es exactamente el sintoma silencioso que el issue nombra.
#   3. **El aislamiento, como `kamayuk_app` y contra esta instancia.** Un superusuario omite
#      RLS incluso con FORCE ROW LEVEL SECURITY, asi que una comprobacion hecha con el
#      pasa en verde sin verificar nada; aqui se demuestra en vez de afirmarse, fijando
#      el mismo contexto con las dos credenciales y exigiendo que **no** vean lo mismo.
#      No siembra nada: en produccion no hay borrado (regla 4 de CLAUDE.md), asi que una
#      municipalidad de ensayo se quedaria ahi para siempre.
#   4. La escalera de identidad, los peldanos que no exigen crear un usuario.
#   5. La deuda con su fecha (RNF-075), si se le da un token.
#
# Lo que NO puede comprobar, y lo dice en vez de callarlo: que ningun puerto responda
# desde fuera. Correr `nmap` contra el propio nodo desde dentro del nodo no atraviesa el
# cortafuegos y devuelve «abierto» para todo lo que escuche en `0.0.0.0` —`k3s` escucha
# asi en 6443 a proposito—, de modo que la comprobacion pasaria en verde con `ufw`
# apagado. `infra/vps/cortafuegos.sh` ya lo advierte en su propia salida.
#
#   uso: verificaciones/ambiente/verificar-el-ambiente.sh --ambiente stg|prod \
#          [--namespace sgtm-stg] [--token <jwt>] [--contribuyente <codigo>]
#
# Requiere: kubectl apuntando al clúster de ese ambiente (el tunel ya abierto).
set -euo pipefail

AMBIENTE=""
NAMESPACE=""
TOKEN=""
CONTRIBUYENTE=""
while [ $# -gt 0 ]; do
    case "$1" in
        --ambiente) AMBIENTE=${2:?falta el valor de --ambiente}; shift 2 ;;
        --namespace) NAMESPACE=${2:?falta el valor de --namespace}; shift 2 ;;
        --token) TOKEN=${2:?falta el valor de --token}; shift 2 ;;
        --contribuyente) CONTRIBUYENTE=${2:?falta el valor de --contribuyente}; shift 2 ;;
        *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
    esac
done
[ -n "$AMBIENTE" ] || { echo "Falta --ambiente (stg o prod)." >&2; exit 2; }
NAMESPACE=${NAMESPACE:-sgtm-$AMBIENTE}

AQUI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
INFRA=$(cd "$AQUI/../.." && pwd)
RAIZ=$(cd "$INFRA/.." && pwd)

command -v kubectl >/dev/null 2>&1 || { echo "Falta kubectl." >&2; exit 1; }

FALLOS=0
bien() { echo "  OK   $*"; }
mal()  { echo "  MAL  $*" >&2; FALLOS=$((FALLOS + 1)); }
aviso(){ echo "  --   $*"; }

POD_MOTOR="deployment/sgtm-${AMBIENTE}-postgres"

# Como superusuario: es quien puede leer el catalogo entero y contar sin RLS de por
# medio. Todo lo que se afirme del AISLAMIENTO, en cambio, se mide con `kamayuk_app`.
comoSuperusuario() {
    kubectl -n "$NAMESPACE" exec "$POD_MOTOR" -c postgres -- \
        psql -U postgres -d sgtm -tAqc "$1"
}

# Como `kamayuk_app`, con su clave real leida del `Secret` que la aplicacion monta. Es la
# unica credencial cuyo resultado dice algo sobre el aislamiento.
comoAplicacion() {
    kubectl -n "$NAMESPACE" exec "$POD_MOTOR" -c postgres -- \
        env PGPASSWORD="$CLAVE_APP" psql -U kamayuk_app -h 127.0.0.1 -d sgtm -tAqc "$1"
}

# Si este ambiente DESPLIEGA el monolito (C-19). Se lee del mismo `Pulumi.<amb>.yaml` que
# `capacidad.ts`, no de una lista ni del nombre del ambiente. Desde que `stg` lo apago, ahi
# no hay `Deployment` de aplicacion, ni Job de migracion, ni servicio al que asomarse: dar
# eso por MAL seria un rojo permanente por algo que nadie puede arreglar en un PR, y dar por
# bueno un ambiente que no se ha mirado seria peor. Lo que se hace es lo de C-15/C-16: decir
# que NO se comprueba, que no es lo mismo que decir que esta bien.
MONOLITO=$(grep -E '^\s+sgtm:desplegarElMonolito:' "$INFRA/Pulumi.$AMBIENTE.yaml" \
    | sed -E 's/.*:\s*//' | tr -d '"'"'"' ')
[ -n "$MONOLITO" ] || { echo "No se pudo leer desplegarElMonolito de Pulumi.$AMBIENTE.yaml" >&2; exit 1; }

echo "== 1. La version declarada, la desplegada y el esquema =="

DECLARADA=$(grep -E '^\s+sgtm:applicationBootstrapVersion:' "$INFRA/Pulumi.$AMBIENTE.yaml" \
    | sed -E 's/.*:\s*//' | tr -d '"'"'"' ')
[ -n "$DECLARADA" ] || { echo "No se pudo leer applicationBootstrapVersion de Pulumi.$AMBIENTE.yaml" >&2; exit 1; }
echo "  declarada en Pulumi.$AMBIENTE.yaml: $DECLARADA"

if [ "$MONOLITO" = "true" ]; then
    CORRIENDO=$(kubectl -n "$NAMESPACE" get deployment "sgtm-${AMBIENTE}-aplicacion" \
        -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)
    [ -n "$CORRIENDO" ] || { mal "no hay Deployment sgtm-${AMBIENTE}-aplicacion en $NAMESPACE"; }
    echo "  corriendo en el clúster:           ${CORRIENDO:-—}"
else
    aviso "este ambiente declara desplegarElMonolito: false (C-19), asi que no hay"
    aviso "Deployment sgtm-${AMBIENTE}-aplicacion que mirar: esta comprobacion NO se hace"
    aviso "(no pasa: no se hace). La plataforma —motor, identidad, correo, respaldo— si"
    aviso "se comprueba abajo, porque los cuatro sistemas se conectan a ella."
fi

# Las migraciones que la version declarada TRAE. Se cuentan en el arbol de git a ese
# sha —no en el de trabajo—: contar los archivos de `main` diria que faltan migraciones
# incluso en un ambiente perfectamente al dia con su version declarada.
ESPERADAS=""
if git -C "$RAIZ" cat-file -e "${DECLARADA}^{commit}" 2>/dev/null; then
    ESPERADAS=$(git -C "$RAIZ" ls-tree --name-only "$DECLARADA" \
        backend/sgtm-esquema/src/main/resources/db/migration/ | grep -c '\.sql$' || true)
else
    # NO se cuenta sobre el arbol de trabajo. Seria comparar contra OTRA version: si el
    # arbol tiene una migracion mas que la version declarada —lo normal en cuanto alguien
    # anade una despues del ultimo despliegue—, la comparacion daria un rojo por un motivo
    # que no es el que se mide. Un numero plausible y equivocado es peor que ninguno.
    aviso "el sha declarado no esta en este clon: no se puede saber cuantas migraciones"
    aviso "trae, asi que esta comprobacion NO se hace (no pasa: no se hace)."
    # Sin acentos graves: dentro de comillas dobles, bash los ejecuta como orden. Se
    # descubrio corriendo la rotura —el guion intento un «git fetch» de un sha inventado—,
    # que es justo lo que un mensaje de diagnostico no debe hacer.
    aviso "En CI, con actions/checkout, es fetch-depth: 0; en local:"
    aviso "  git fetch origin $DECLARADA"
    ESPERADAS=""
fi

APLICADAS=$(comoSuperusuario "SELECT count(*) FROM flyway_schema_history WHERE success")
if [ -z "$ESPERADAS" ]; then
    echo "  migraciones aplicadas: $APLICADAS · las que trae la version declarada: —"
elif [ "$APLICADAS" -lt "$ESPERADAS" ]; then
    echo "  migraciones aplicadas: $APLICADAS · las que trae la version declarada: $ESPERADAS"
    mal "la base va POR DETRAS de la version declarada ($APLICADAS < $ESPERADAS)."
    if [ "$MONOLITO" = "true" ]; then
        mal "El Job sgtm-${AMBIENTE}-migracion-${DECLARADA:0:12} no ha corrido, o fallo."
        mal "Sintoma tipico: una carga batch termina en verde y no escribe ninguna fila."
    else
        mal "Y este ambiente ya no declara ningun Job de migracion (C-19), asi que el"
        mal "esquema del monolito se queda donde esta: no hay nada que lo adelante."
    fi
elif [ "$APLICADAS" -gt "$ESPERADAS" ]; then
    # La otra direccion, desde #675. Antes caia en el `else` y se declaraba «al dia»: el
    # `-lt` dejaba pasar en VERDE precisamente la mutacion que este issue pide medir
    # —declarar en el ambiente una version con migraciones de menos—, que es lo que pasa
    # al revertir esa linea o al apuntarla al `sha` equivocado.
    #
    # No es simetrico del caso de arriba, y por eso el mensaje es otro: aqui el esquema
    # no va a medias, va POR DELANTE de la imagen que la version declara. Un VPS
    # reconstruido desde cero con esa version arrancaria una aplicacion mas vieja que la
    # base que ya existe, y una columna que la aplicacion no conoce no da error: da una
    # lectura que no la incluye.
    echo "  migraciones aplicadas: $APLICADAS · las que trae la version declarada: $ESPERADAS"
    mal "la base va POR DELANTE de la version declarada ($APLICADAS > $ESPERADAS)."
    # Sin acentos graves en el texto: dentro de comillas dobles bash los ejecuta como
    # orden, y eso ya costo una errata en este mismo guion (#434).
    mal "applicationBootstrapVersion de Pulumi.$AMBIENTE.yaml apunta a $DECLARADA, que"
    mal "trae MENOS esquema del que la base ya tiene: o se revirtio esa linea, o apunta"
    mal "al sha equivocado. Las migraciones no se deshacen (regla 4), asi que lo que hay"
    mal "que corregir es la version declarada, no la base."
else
    echo "  migraciones aplicadas: $APLICADAS · las que trae la version declarada: $ESPERADAS"
    bien "el esquema esta al dia con la version declarada"
fi

# Las extensiones que `crear-roles.sql` declara, contra las que la base tiene. Corren
# desde `/docker-entrypoint-initdb.d` y por tanto SOLO con el volumen vacio: una
# extension anadida despues de crear el cluster no llega sola, y la migracion que la
# necesita se cae con «type ... does not exist». Es el mismo hueco que #435 encontro con
# el LOGIN de rol_carga_parametros, y aqui se ve antes de desplegar en vez de despues.
DECLARADAS=$(grep -oiE 'CREATE EXTENSION( IF NOT EXISTS)? +[a-z_0-9]+' \
    "$RAIZ/backend/sgtm-esquema/src/main/resources/db/roles/crear-roles.sql" \
    | awk '{print $NF}' | sort -u)
for extension in $DECLARADAS; do
    if [ "$(comoSuperusuario "SELECT count(*) FROM pg_extension WHERE extname = '$extension'")" = "1" ]; then
        bien "extension $extension: creada"
    else
        mal "extension $extension: NO esta, y crear-roles.sql la declara."
        mal "Remedio: despliegue/crear-extensiones.sh --ambiente ${AMBIENTE}"
    fi
done

echo
echo "== 2. Lo que la implantacion sembro (#120) =="
# `municipalidad` no lleva `municipalidad_id`: es el registro de tenants, y por eso se
# cuenta aparte. Las otras cuatro son las que `ImplantarMunicipalidad` escribe.
for tabla in municipalidad grupo usuario miembro permiso; do
    n=$(comoSuperusuario "SELECT count(*) FROM $tabla")
    if [ "$n" -gt 0 ]; then bien "$tabla: $n"; else mal "$tabla: 0 — la implantacion no sembro"; fi
done

echo
echo "== 3. El aislamiento, como kamayuk_app y contra esta instancia =="

CLAVE_APP=$(kubectl -n "$NAMESPACE" get secret "sgtm-${AMBIENTE}-postgres-app" \
    -o jsonpath='{.data.clave-app}' 2>/dev/null | base64 -d || true)
if [ -z "$CLAVE_APP" ]; then
    mal "no se pudo leer sgtm-${AMBIENTE}-postgres-app/clave-app: sin la credencial de la"
    mal "aplicacion, lo unico que se puede medir es lo que ve un superusuario, que es"
    mal "precisamente lo que no demuestra nada"
else
    # a. La credencial es la que se dice que es, y no puede saltarse la politica.
    fila=$(comoSuperusuario "SELECT rolsuper::text || ' ' || rolbypassrls::text FROM pg_roles WHERE rolname = 'kamayuk_app'")
    if [ "$fila" = "false false" ]; then
        bien "kamayuk_app no es superusuario y no tiene BYPASSRLS"
    else
        mal "kamayuk_app tiene privilegios que anulan RLS: rolsuper/rolbypassrls = $fila"
    fi

    # b. Toda tabla con `municipalidad_id` tiene RLS, y FORZADA. Sin `FORCE`, el dueno
    #    de la tabla la omite; con `FORCE`, no.
    sinForzar=$(comoSuperusuario "
        SELECT count(*) FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
          AND EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = c.oid AND a.attname = 'municipalidad_id'
                        AND NOT a.attisdropped AND a.attnum > 0)
          AND NOT (c.relrowsecurity AND c.relforcerowsecurity)")
    if [ "$sinForzar" = "0" ]; then
        bien "toda tabla con municipalidad_id tiene RLS y FORCE"
    else
        mal "$sinForzar tablas con municipalidad_id sin RLS forzada"
    fi

    # c. La demostracion. Se elige una municipalidad que SI existe y una tabla suya con
    #    filas; se fija como contexto **otra** municipalidad, y se pregunta a las dos
    #    credenciales. La aplicacion tiene que ver cero; el superusuario, todas. Si las
    #    dos ven lo mismo, la comprobacion no esta midiendo el aislamiento.
    MUNI=$(comoSuperusuario "SELECT id FROM municipalidad ORDER BY id LIMIT 1")
    # La tabla de la medida tiene que cumplir CUATRO cosas, y las cuatro por un motivo:
    # tener filas (si no, «cero filas» no distingue el aislamiento de una tabla vacia),
    # que `kamayuk_app` tenga SELECT sobre ella (si no, el error es de privilegio y no de
    # politica), **no ser una particion** —a las particiones no se les concede ningun
    # privilegio a proposito: el acceso directo a una evade la politica del padre, que es
    # el segundo hallazgo de RLS de DAT-01 §0—, y que su `municipalidad_id` sea **NOT
    # NULL**.
    #
    # LA CUARTA SE PAGO. Sin ella, la primera corrida de este guion en CI —despues de que
    # #438 publicara 492 filas de `depreciacion` en `stg`— eligio esa tabla, que es la
    # que mas filas tenia, y dio CUATRO comprobaciones en rojo: «kamayuk_app no filtra por
    # municipalidad: propias=492, ajenas=492».
    #
    # Y `kamayuk_app` filtraba perfectamente. `depreciacion` es un **catalogo nacional**
    # (D-13, ADR-0017): su `municipalidad_id` es nulo y su politica de lectura dice
    # `municipalidad_id IS NULL OR municipalidad_id = current_setting(...)`, de modo que
    # todo contexto ve sus 492 filas — que es exactamente lo que un catalogo nacional
    # tiene que hacer. El guion estaba midiendo el aislamiento sobre la unica clase de
    # tabla que, por diseño, no aisla.
    #
    # `municipalidad_id NOT NULL` es el mismo criterio con que la prueba de aislamiento
    # del esquema separa las tablas de tenant de los catalogos (CLAUDE.md: «si lleva
    # `municipalidad_id NOT NULL`, la prueba le exige RLS sola»). Aqui sirve para lo
    # mismo: solo una tabla de tenant puede decir algo sobre el aislamiento.
    TABLA=$(comoSuperusuario "
        SELECT c.relname FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
          AND NOT c.relispartition
          AND has_table_privilege('kamayuk_app', c.oid, 'SELECT')
          AND EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = c.oid AND a.attname = 'municipalidad_id'
                        AND NOT a.attisdropped AND a.attnum > 0
                        AND a.attnotnull)
          AND c.reltuples > 0
        ORDER BY c.reltuples DESC LIMIT 1")
    if [ -z "${MUNI:-}" ] || [ -z "${TABLA:-}" ]; then
        mal "no hay municipalidad implantada, o ninguna tabla DE TENANT con RLS tiene"
        mal "filas: sin eso el aislamiento no se puede medir, solo suponer. Un catalogo"
        mal "nacional no sirve: por diseño lo ve todo contexto"
    else
        OTRA=$((MUNI + 1000000))
        conElContexto() {
            $1 "BEGIN; SET LOCAL app.municipalidad_id = '$2'; SELECT count(*) FROM $TABLA; COMMIT;" \
                | tr -d '\r' | grep -E '^[0-9]+$' | tail -1
        }
        propias=$(conElContexto comoAplicacion "$MUNI")
        ajenas=$(conElContexto comoAplicacion "$OTRA")
        superConAjenas=$(conElContexto comoSuperusuario "$OTRA")

        echo "  tabla de la medida: $TABLA · municipalidad $MUNI · contexto ajeno $OTRA"
        echo "  kamayuk_app con su contexto: $propias · con el ajeno: $ajenas · superusuario con el ajeno: $superConAjenas"

        if [ "${propias:-0}" -gt 0 ] && [ "${ajenas:-x}" = "0" ]; then
            bien "kamayuk_app ve las filas de SU municipalidad y ninguna de la ajena"
        else
            mal "kamayuk_app no filtra por municipalidad: propias=$propias, ajenas=$ajenas"
        fi
        if [ "${superConAjenas:-0}" -gt 0 ] && [ "${ajenas:-x}" = "0" ]; then
            bien "y el superusuario, con EL MISMO contexto, las ve igual: la medida esta"
            bien "hecha con la credencial que si esta sujeta a la politica"
        else
            mal "el superusuario ve lo mismo que kamayuk_app con el contexto ajeno"
            mal "($superConAjenas vs $ajenas): esta comprobacion no distingue una base con"
            mal "RLS de una sin ella"
        fi
    fi
fi

echo
echo "== 4. La escalera de identidad =="
if [ "$MONOLITO" != "true" ]; then
    aviso "este ambiente no despliega el monolito (C-19): no hay servicio"
    aviso "sgtm-${AMBIENTE}-aplicacion al que asomarse, asi que la escalera de identidad y"
    aviso "la deuda con su fecha NO se comprueban aqui (no pasan: no se hacen)."
    aviso "La cadena de identidad de los cuatro sistemas se comprueba en su propio"
    aviso "repositorio; lo que este guion mide de la plataforma es el motor y su aislamiento."
else
PUERTO=18080
kubectl -n "$NAMESPACE" port-forward "svc/sgtm-${AMBIENTE}-aplicacion" "$PUERTO:8080" \
    >/tmp/sgtm-pf-$$.log 2>&1 &
PF=$!
cerrar() { kill "$PF" 2>/dev/null || true; rm -f "/tmp/sgtm-pf-$$.log"; }
trap cerrar EXIT
for _ in $(seq 1 40); do
    curl -s -o /dev/null "http://127.0.0.1:$PUERTO/actuator/health" && break
    sleep 0.25
done

# Devuelve «codigo_http CODIGO_DEL_CATALOGO», igual que la escalera de `despliegue.yml`.
pide() {
    local ruta=$1; shift
    local cuerpo codigo
    cuerpo=$(curl -s -o /tmp/sgtm-r-$$.json -w '%{http_code}' "http://127.0.0.1:$PUERTO$ruta" "$@")
    codigo=$(grep -o '"codigo"[[:space:]]*:[[:space:]]*"[A-Z_]*"' /tmp/sgtm-r-$$.json 2>/dev/null \
        | head -1 | sed -E 's/.*"([A-Z_]*)"$/\1/')
    rm -f /tmp/sgtm-r-$$.json
    echo "$cuerpo ${codigo:-}"
}

r=$(pide "/api/v1/seguridad/auditoria?ejercicio=2026")
case "$r" in
    "401 NO_AUTENTICADO"|"401 "*) bien "sin token: $r" ;;
    *) mal "sin token esperaba 401, obtuvo: $r" ;;
esac

r=$(pide "/api/v1/seguridad/auditoria?ejercicio=2026" \
    --header "Authorization: Bearer no.es.un.token.de.este.emisor")
case "$r" in
    "401"*) bien "token que este emisor no firmo: $r" ;;
    *) mal "con un token ajeno esperaba 401, obtuvo: $r" ;;
esac

if [ -n "$TOKEN" ]; then
    r=$(pide "/api/v1/seguridad/auditoria?ejercicio=2026" --header "Authorization: Bearer $TOKEN")
    case "$r" in
        "200"*) bien "el usuario, en lo suyo: $r" ;;
        *) mal "con el token dado esperaba 200, obtuvo: $r" ;;
    esac

    echo
    echo "== 5. La deuda, con su fecha (RNF-075) =="
    ruta="/api/v1/consultas/deuda"
    [ -n "$CONTRIBUYENTE" ] && ruta="$ruta?codContribuyente=$CONTRIBUYENTE"
    salida=$(curl -s -w '\n%{http_code}' "http://127.0.0.1:$PUERTO$ruta" \
        --header "Authorization: Bearer $TOKEN")
    codigo=$(echo "$salida" | tail -1)
    json=$(echo "$salida" | sed '$d')
    if [ "$codigo" != "200" ]; then
        mal "GET $ruta devolvio $codigo"
    elif echo "$json" | grep -q 'actualizadoA\|fechaDeCorte\|fechaCalculo'; then
        bien "la respuesta trae la fecha a la que la cifra esta actualizada"
    else
        mal "la respuesta NO dice a que fecha esta actualizada: una cifra sin su fecha no"
        mal "se distingue de una correcta (RNF-075)"
    fi
else
    aviso "sin --token: los dos ultimos peldanos de la escalera y la deuda con su fecha"
    aviso "quedan SIN comprobar. Un token se obtiene del realm de este ambiente; el"
    aviso "runbook «Abrir la consola de Keycloak» dice como"
fi
fi

echo
echo "== 6. Los puertos, desde fuera =="
aviso "NO se comprueba aqui, a proposito: desde el propio nodo el trafico no atraviesa"
aviso "el cortafuegos, y k3s escucha en 0.0.0.0:6443 a proposito — la comprobacion"
aviso "pasaria en verde con ufw apagado. Desde OTRA maquina:"
aviso "  nmap -Pn -p 22,80,443,5432,6443,10250 <ip-del-nodo>"
aviso "  # abiertos: 22, 80, 443. Cerrados: 5432, 6443, 10250"

echo
if [ "$FALLOS" -gt 0 ]; then
    echo "FALLO: $FALLOS comprobaciones en rojo contra $NAMESPACE." >&2
    exit 1
fi
echo "Listo: el ambiente $AMBIENTE responde por si mismo en todo lo comprobado."
