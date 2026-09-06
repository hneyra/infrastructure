#!/usr/bin/env bash
# El ambiente DESPLEGADO, comprobado contra si mismo (issue #434).
#
# No comprueba manifiestos —eso es `yarn verificar`, y corre sin clúster—: comprueba el
# clúster que hay delante. Es la escalera del issue #434 hecha ejecutable, para que
# «prod corriendo» deje de ser una afirmación y pase a ser una corrida con salida.
#
# **Mide los CUATRO SISTEMAS, no el monolito** (`E`). Hasta el 2026-09-06 este guion miraba
# la base `sgtm` —la del monolito— para todo: contaba sus migraciones, contaba sus filas de
# implantacion y media el aislamiento sobre sus tablas. `stg` dejo de desplegarlo en C-19 y
# el resultado fue el rojo de la corrida `33993639598`:
#
#     ERROR:  relation "flyway_schema_history" does not exist
#
# Con toda la razon: esa base existe y **no tiene ni una tabla del producto** —medido, solo
# `spatial_ref_sys`, que la trae PostGIS—. El padron vive hoy en las cuatro bases de los
# cuatro sistemas, y esto pasa a medir las cuatro.
#
# Lo que mira, en este orden:
#
#   1. La version declarada, la desplegada y **el esquema**, POR SISTEMA. Es la trampa de #434: el
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
#   2. Lo sembrado por la implantacion (#120) **en cada base**: municipalidad, grupo,
#      usuario, miembro y permiso. `count(*) = 0` es exactamente el sintoma silencioso que
#      el issue nombra.
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
#          [--namespace kamayuk-stg] [--token <jwt>] [--contribuyente <codigo>]
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
NAMESPACE=${NAMESPACE:-kamayuk-$AMBIENTE}

AQUI=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
INFRA=$(cd "$AQUI/../.." && pwd)
RAIZ=$(cd "$INFRA/.." && pwd)

command -v kubectl >/dev/null 2>&1 || { echo "Falta kubectl." >&2; exit 1; }

FALLOS=0
bien() { echo "  OK   $*"; }
mal()  { echo "  MAL  $*" >&2; FALLOS=$((FALLOS + 1)); }
aviso(){ echo "  --   $*"; }

POD_MOTOR="deployment/kamayuk-${AMBIENTE}-postgres"

# Como superusuario: es quien puede leer el catalogo entero y contar sin RLS de por
# medio. Todo lo que se afirme del AISLAMIENTO, en cambio, se mide con `kamayuk_app`.
comoSuperusuario() {
    kubectl -n "$NAMESPACE" exec "$POD_MOTOR" -c postgres -- \
        psql -U postgres -d "${2:-$BASE}" -tAqc "$1"
}

# Como `kamayuk_app`, con su clave real leida del `Secret` que la aplicacion monta. Es la
# unica credencial cuyo resultado dice algo sobre el aislamiento.
comoAplicacion() {
    kubectl -n "$NAMESPACE" exec "$POD_MOTOR" -c postgres -- \
        env PGPASSWORD="$CLAVE_APP" psql -U kamayuk_app -h 127.0.0.1 -d "${2:-$BASE}" -tAqc "$1"
}

# Los cuatro sistemas de ADR-0031. Cada uno tiene SU base, SU historia de migraciones y SU
# linea `kamayuk:versionDe<Sistema>` en el stack: una lista de cuatro nombres es lo unico
# que este guion necesita saber, y su base se llama igual que el sistema (05-crear-bases.sh).
SISTEMAS="rentas catastro normativa caja"

# `rentas` -> `Rentas`, que es como se escribe la clave del stack.
capitalizar() { printf '%s%s' "$(printf '%s' "${1:0:1}" | tr '[:lower:]' '[:upper:]')" "${1:1}"; }

echo "== 1. La version declarada, la desplegada y el esquema, POR SISTEMA =="

for sistema in $SISTEMAS; do
    BASE="$sistema"
    CLAVE="kamayuk:versionDe$(capitalizar "$sistema")"
    echo "-- $sistema --"

    DECLARADA=$(grep -E "^\s+${CLAVE}:" "$INFRA/Pulumi.$AMBIENTE.yaml" \
        | sed -E 's/.*:\s*//' | tr -d '"'"'"' ')
    if [ -z "$DECLARADA" ]; then
        mal "Pulumi.$AMBIENTE.yaml no declara ${CLAVE}: no se sabe que esquema trae la"
        mal "imagen que el Job de migracion de «${sistema}» baja."
        continue
    fi
    echo "  declarada en Pulumi.$AMBIENTE.yaml: $DECLARADA"

    CORRIENDO=$(kubectl -n "kamayuk-${sistema}-${AMBIENTE}" get deployment "kamayuk-${sistema}-web" \
        -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)
    if [ -n "$CORRIENDO" ]; then
        echo "  corriendo en el clúster:           $CORRIENDO"
    else
        mal "no hay Deployment kamayuk-${sistema}-web en kamayuk-${sistema}-${AMBIENTE}"
    fi

    # Las migraciones que la version declarada TRAE. Se cuentan en el arbol de git de ESE
    # sha —y en el clon de ESE sistema, que **no es este repositorio**—: contar los archivos
    # de `main` diria que faltan migraciones incluso en un ambiente perfectamente al dia con
    # su version declarada.
    CLON="$RAIZ/../$sistema"
    ESPERADAS=""
    if [ -d "$CLON/.git" ] && git -C "$CLON" cat-file -e "${DECLARADA}^{commit}" 2>/dev/null; then
        ESPERADAS=$(git -C "$CLON" ls-tree --name-only "$DECLARADA" \
            "backend/kamayuk-${sistema}-esquema/src/main/resources/db/migration/" \
            | grep -c '\.sql$' || true)
    else
        # NO se cuenta sobre el arbol de trabajo. Seria comparar contra OTRA version: si el
        # arbol tiene una migracion mas que la version declarada —lo normal en cuanto alguien
        # anade una despues del ultimo despliegue—, la comparacion daria un rojo por un motivo
        # que no es el que se mide. Un numero plausible y equivocado es peor que ninguno.
        aviso "el sha declarado no esta en el clon de «${sistema}» ($CLON): no se puede saber"
        aviso "cuantas migraciones trae, asi que esta comprobacion NO se hace (no pasa: no"
        aviso "se hace). En CI, con actions/checkout, es fetch-depth: 0; en local:"
        # Sin acentos graves: dentro de comillas dobles, bash los ejecuta como orden. Se
        # descubrio corriendo la rotura —el guion intento un «git fetch» de un sha inventado—,
        # que es justo lo que un mensaje de diagnostico no debe hacer.
        aviso "  git -C $CLON fetch origin $DECLARADA"
    fi

    if ! comoSuperusuario "SELECT 1" >/dev/null 2>&1; then
        mal "no se puede abrir la base «${BASE}»: el sistema «${sistema}» no esta provisionado"
        continue
    fi
    APLICADAS=$(comoSuperusuario "SELECT count(*) FROM flyway_schema_history WHERE success" 2>/dev/null || echo "")
    if [ -z "$APLICADAS" ]; then
        mal "la base «${BASE}» no tiene flyway_schema_history: el Job de migracion de"
        mal "«${sistema}» no ha corrido nunca contra ella."
        continue
    fi
    if [ -z "$ESPERADAS" ]; then
        echo "  migraciones aplicadas: $APLICADAS · las que trae la version declarada: —"
    elif [ "$APLICADAS" -lt "$ESPERADAS" ]; then
        echo "  migraciones aplicadas: $APLICADAS · las que trae la version declarada: $ESPERADAS"
        mal "«${sistema}» va POR DETRAS de la version declarada ($APLICADAS < $ESPERADAS)."
        mal "El Job kamayuk-${sistema}-migracion-${DECLARADA:0:12} no ha corrido, o fallo."
        mal "Sintoma tipico: una carga batch termina en verde y no escribe ninguna fila."
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
        mal "«${sistema}» va POR DELANTE de la version declarada ($APLICADAS > $ESPERADAS)."
        mal "${CLAVE} de Pulumi.$AMBIENTE.yaml apunta a $DECLARADA, que trae MENOS esquema"
        mal "del que la base ya tiene: o se revirtio esa linea, o apunta al sha equivocado."
        mal "Las migraciones no se deshacen (regla 4), asi que lo que hay que corregir es la"
        mal "version declarada, no la base."
    else
        echo "  migraciones aplicadas: $APLICADAS · las que trae la version declarada: $ESPERADAS"
        bien "«${sistema}»: el esquema esta al dia con la version declarada"
    fi
done

# Las extensiones que cada `crear-roles.sql` declara, contra las que SU base tiene. Corren
# desde `/docker-entrypoint-initdb.d` y por tanto SOLO con el volumen vacio: una
# extension anadida despues de crear el cluster no llega sola, y la migracion que la
# necesita se cae con «type ... does not exist». Es el mismo hueco que #435 encontro con
# el LOGIN de rol_carga_parametros, y aqui se ve antes de desplegar en vez de despues.
#
# Cero extensiones es una respuesta legitima —`caja` no declara ninguna a proposito (P5D) y
# `normativa` tampoco desde C-13—, asi que se dice y se sigue.
echo
echo "== 1b. Las extensiones que cada crear-roles.sql declara =="
for sistema in $SISTEMAS; do
    BASE="$sistema"
    ROLES=$(ls "$RAIZ/../$sistema"/backend/*/src/main/resources/db/roles/crear-roles.sql 2>/dev/null | head -1)
    if [ -z "$ROLES" ]; then
        aviso "no esta el clon de «${sistema}»: no se puede saber que extensiones declara"
        aviso "  git clone https://github.com/hneyra/$sistema $RAIZ/../$sistema"
        continue
    fi
    DECLARADAS=$(grep -oiE 'CREATE EXTENSION( IF NOT EXISTS)? +[a-z_0-9]+' "$ROLES" | awk '{print $NF}' | sort -u || true)
    if [ -z "$DECLARADAS" ]; then
        aviso "«${sistema}» no declara ninguna extension, y es su decision"
        continue
    fi
    for extension in $DECLARADAS; do
        if [ "$(comoSuperusuario "SELECT count(*) FROM pg_extension WHERE extname = '$extension'")" = "1" ]; then
            bien "«${sistema}»/$extension: creada"
        else
            mal "«${sistema}»/$extension: NO esta, y su crear-roles.sql la declara."
            mal "Remedio: despliegue/crear-extensiones.sh --ambiente ${AMBIENTE} --sistema ${sistema}"
        fi
    done
done

echo
echo "== 2. Lo que la implantacion sembro (#120), en cada base =="
# `municipalidad` no lleva `municipalidad_id`: es el registro de tenants, y por eso se
# cuenta aparte. Las otras cuatro son las que la implantacion de cada sistema escribe.
for sistema in $SISTEMAS; do
    BASE="$sistema"
    for tabla in municipalidad grupo usuario miembro permiso; do
        n=$(comoSuperusuario "SELECT count(*) FROM $tabla" 2>/dev/null || echo "")
        if [ -z "$n" ]; then
            mal "«${sistema}».$tabla no se pudo contar: la base no tiene esa tabla"
        elif [ "$n" -gt 0 ]; then
            bien "«${sistema}».$tabla: $n"
        else
            mal "«${sistema}».$tabla: 0 — la implantacion no sembro"
        fi
    done
done

echo
echo "== 3. El aislamiento, como kamayuk_app y contra esta instancia =="

CLAVE_APP=$(kubectl -n "$NAMESPACE" get secret "kamayuk-${AMBIENTE}-postgres-app" \
    -o jsonpath='{.data.clave-app}' 2>/dev/null | base64 -d || true)
if [ -z "$CLAVE_APP" ]; then
    mal "no se pudo leer kamayuk-${AMBIENTE}-postgres-app/clave-app: sin la credencial de la"
    mal "aplicacion, lo unico que se puede medir es lo que ve un superusuario, que es"
    mal "precisamente lo que no demuestra nada"
else
    # a. La credencial es la que se dice que es, y no puede saltarse la politica. Es del
    #    CLUSTER, asi que se pregunta una vez y no una por base.
    fila=$(comoSuperusuario "SELECT rolsuper::text || ' ' || rolbypassrls::text FROM pg_roles WHERE rolname = 'kamayuk_app'" postgres)
    if [ "$fila" = "false false" ]; then
        bien "kamayuk_app no es superusuario y no tiene BYPASSRLS"
    else
        mal "kamayuk_app tiene privilegios que anulan RLS: rolsuper/rolbypassrls = $fila"
    fi

    for sistema in $SISTEMAS; do
        BASE="$sistema"
        echo "-- $sistema --"

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
            bien "«${sistema}»: toda tabla con municipalidad_id tiene RLS y FORCE"
        else
            mal "«${sistema}»: $sinForzar tablas con municipalidad_id sin RLS forzada"
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
        # #438 publicara 492 filas de `depreciacion`— eligio esa tabla, que es la que mas
        # filas tenia, y dio CUATRO comprobaciones en rojo: «kamayuk_app no filtra por
        # municipalidad: propias=492, ajenas=492». Y `kamayuk_app` filtraba perfectamente:
        # `depreciacion` es un **catalogo nacional** (D-13, ADR-0017), su `municipalidad_id`
        # es nulo y su politica dice `municipalidad_id IS NULL OR ...`, de modo que todo
        # contexto ve sus filas — que es exactamente lo que un catalogo nacional tiene que
        # hacer. El guion estaba midiendo el aislamiento sobre la unica clase de tabla que,
        # por diseño, no aisla.
        #
        # Y las filas se CUENTAN, no se estiman. La primera version filtraba por
        # `c.reltuples > 0`, que es la estimacion del planificador y solo se actualiza con
        # `ANALYZE` o con el autovacuum: medido contra `stg`, `rentas` pasaba —su padron
        # llevaba horas— y `catastro`, `normativa` y `caja` daban «ninguna tabla de tenant
        # tiene filas» teniendo 11, 1 y 3 en `permiso`. Un ambiente recien implantado es
        # exactamente el caso en que esa estimacion vale cero, o sea que la comprobacion se
        # apagaba sola justo cuando mas hace falta.
        CANDIDATAS=$(comoSuperusuario "
            SELECT c.relname FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
              AND NOT c.relispartition
              AND has_table_privilege('kamayuk_app', c.oid, 'SELECT')
              AND EXISTS (SELECT 1 FROM pg_attribute a
                          WHERE a.attrelid = c.oid AND a.attname = 'municipalidad_id'
                            AND NOT a.attisdropped AND a.attnum > 0
                            AND a.attnotnull)
            ORDER BY c.reltuples DESC, c.relname")
        TABLA=""
        for candidata in $CANDIDATAS; do
            if [ "$(comoSuperusuario "SELECT count(*) > 0 FROM ${candidata}")" = "t" ]; then
                TABLA="$candidata"
                break
            fi
        done
        if [ -z "${MUNI:-}" ] || [ -z "${TABLA:-}" ]; then
            mal "«${sistema}»: no hay municipalidad implantada, o ninguna tabla DE TENANT con"
            mal "RLS tiene filas: sin eso el aislamiento no se puede medir, solo suponer. Un"
            mal "catalogo nacional no sirve: por diseño lo ve todo contexto"
            continue
        fi
        OTRA=$((MUNI + 1000000))
        conElContexto() {
            $1 "BEGIN; SET LOCAL app.municipalidad_id = '$2'; SELECT count(*) FROM $TABLA; COMMIT;" \
                | tr -d '\r' | grep -E '^[0-9]+$' | tail -1
        }
        propias=$(conElContexto comoAplicacion "$MUNI")
        ajenas=$(conElContexto comoAplicacion "$OTRA")
        superConAjenas=$(conElContexto comoSuperusuario "$OTRA")

        echo "  tabla de la medida: $BASE.$TABLA · municipalidad $MUNI · contexto ajeno $OTRA"
        echo "  kamayuk_app con su contexto: $propias · con el ajeno: $ajenas · superusuario con el ajeno: $superConAjenas"

        if [ "${propias:-0}" -gt 0 ] && [ "${ajenas:-x}" = "0" ]; then
            bien "«${sistema}»: kamayuk_app ve las filas de SU municipalidad y ninguna de la ajena"
        else
            mal "«${sistema}»: kamayuk_app no filtra por municipalidad: propias=$propias, ajenas=$ajenas"
        fi
        if [ "${superConAjenas:-0}" -gt 0 ] && [ "${ajenas:-x}" = "0" ]; then
            bien "y el superusuario, con EL MISMO contexto, las ve igual: la medida esta"
            bien "hecha con la credencial que si esta sujeta a la politica"
        else
            mal "«${sistema}»: el superusuario ve lo mismo que kamayuk_app con el contexto ajeno"
            mal "($superConAjenas vs $ajenas): esta comprobacion no distingue una base con"
            mal "RLS de una sin ella"
        fi
    done
fi

echo
echo "== 4. La escalera de identidad, contra los cuatro =="
# Medido contra `stg` el 2026-09-06: los cuatro contestan exactamente lo mismo que
# contestaba el monolito —`401 NO_AUTENTICADO` sin token y con un token que este emisor no
# firmo—, asi que la escalera se traslada tal cual y deja de necesitarlo.
#
# El puerto del `Service` es **80** y no 8080: es el del corte, no el del monolito. Se
# comprobo pidiendole por `port-forward`, no leyendo el manifiesto.
PUERTO=18080
pide() {
    local ruta=$1; shift
    local cuerpo codigo
    cuerpo=$(curl -s -o /tmp/kamayuk-r-$$.json -w '%{http_code}' "http://127.0.0.1:$PUERTO$ruta" "$@")
    codigo=$(grep -o '"codigo"[[:space:]]*:[[:space:]]*"[A-Z_]*"' /tmp/kamayuk-r-$$.json 2>/dev/null \
        | head -1 | sed -E 's/.*"([A-Z_]*)"$/\1/')
    rm -f /tmp/kamayuk-r-$$.json
    echo "$cuerpo ${codigo:-}"
}

for sistema in $SISTEMAS; do
    echo "-- $sistema --"
    kubectl -n "kamayuk-${sistema}-${AMBIENTE}" port-forward "svc/kamayuk-${sistema}-web" \
        "$PUERTO:80" >/tmp/kamayuk-pf-$$.log 2>&1 &
    PF=$!
    # `disown` para que el shell no imprima «Terminated: 15» al reaparlo: ese mensaje sale
    # por el canal de errores y se lee como un fallo del guion, que es justo lo contrario de
    # lo que es —el port-forward se cierra a proposito al terminar cada sistema—.
    disown "$PF" 2>/dev/null || true
    cerrar() { kill "$PF" 2>/dev/null || true; rm -f "/tmp/kamayuk-pf-$$.log"; }
    trap cerrar EXIT
    listo=""
    for _ in $(seq 1 40); do
        if curl -s -o /dev/null "http://127.0.0.1:$PUERTO/actuator/health"; then listo=si; break; fi
        sleep 0.25
    done
    if [ -z "$listo" ]; then
        mal "«${sistema}» no contesta en /actuator/health por port-forward"
        cerrar; trap - EXIT
        continue
    fi

    # Una ruta cualquiera de `/api/v1`: lo que se mide es la PUERTA, no el enrutado. Medido:
    # el borde contesta 401 antes de buscar el controlador, asi que la escalera no depende de
    # que este guion sepa las rutas de cada sistema —que no las sabe, y suponerlas seria
    # inventar contrato—.
    RUTA="/api/v1/seguridad/auditoria?ejercicio=2026"

    r=$(pide "$RUTA")
    case "$r" in
        "401 NO_AUTENTICADO"|"401 "*) bien "«${sistema}» sin token: $r" ;;
        *) mal "«${sistema}» sin token esperaba 401, obtuvo: $r" ;;
    esac

    r=$(pide "$RUTA" --header "Authorization: Bearer no.es.un.token.de.este.emisor")
    case "$r" in
        "401"*) bien "«${sistema}» con un token que este emisor no firmo: $r" ;;
        *) mal "«${sistema}» con un token ajeno esperaba 401, obtuvo: $r" ;;
    esac

    if [ -n "$TOKEN" ]; then
        # Con un token de verdad lo que se exige es que **no** sea 401, no que sea 200: este
        # guion no conoce las rutas de cada sistema, y exigir 200 de una que quiza no exista
        # daria un rojo por un motivo que no es el que se mide. Lo que la escalera mide aqui
        # es que el emisor cuadre; que la ruta conteste lo suyo lo mide su repositorio.
        r=$(pide "$RUTA" --header "Authorization: Bearer $TOKEN")
        case "$r" in
            "401"*) mal "«${sistema}» rechaza un token de este emisor: $r" ;;
            *) bien "«${sistema}» acepta el token de este emisor: $r" ;;
        esac
    fi

    cerrar
    trap - EXIT
done

if [ -z "$TOKEN" ]; then
    aviso "sin --token: el ultimo peldano de la escalera queda SIN comprobar. Un token se"
    aviso "obtiene del realm de este ambiente; el runbook «Abrir la consola de Keycloak»"
    aviso "dice como."
fi

echo
echo "== 5. La deuda, con su fecha (RNF-075) =="
aviso "NO se comprueba aqui desde \`E\`, y no es un olvido: la ruta que se pedia"
aviso "—/api/v1/consultas/deuda— era del monolito. Cual de los cuatro sistemas publica esa"
aviso "cifra, y con que forma, lo decide su propio contrato: exigirla desde aqui seria"
aviso "inventarlo. RNF-075 se mide en el repositorio de cada sistema."

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
