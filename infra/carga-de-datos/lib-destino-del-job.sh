#!/usr/bin/env bash
# De DONDE sale la imagen de un Job de carga, y en QUE espacio de nombres corre.
#
# Existe porque hasta el issue #10 esas dos cosas estaban escritas a mano en cada guion, y las dos
# apuntaban a la topologia ANTERIOR al corte:
#
#     NAMESPACE=${NAMESPACE:-kamayuk-$AMBIENTE}
#     IMAGEN=$(kubectl -n "$NAMESPACE" get deployment "kamayuk-${AMBIENTE}-aplicacion" ...)
#
# `kamayuk-<ambiente>-aplicacion` era el Deployment del MONOLITO, que C-19 retiro de `stg` y `E`
# de `prod`. Medido sobre `yarn manifiestos` el 2026-09-07, en los dos ambientes: no lo emite
# nadie. Lo que hay es un Deployment por sistema, `kamayuk-<sistema>-web`, en el espacio de
# nombres de SU sistema, `kamayuk-<sistema>-<ambiente>` (ADR-0031, `namespaceDelSistema`).
#
# Su modo de fallo es el de C-6, y no tiene sintoma: si el `jsonpath` no resuelve, `IMAGEN` queda
# VACIA —`kubectl get` sale con 0 cuando el recurso no existe si se le pide un `jsonpath`—, el
# `apply` monta un contenedor con `image: ""` y lo que se ve del otro lado es un pod que no
# arranca; y si resolviera, resolveria la imagen de OTRO sistema, que arranca, no atiende la
# propiedad, no carga ni una fila y sale con codigo 0.
#
# ## Las DOS mitades, y por que son dos variables y no una
#
# Un Job de carga toca dos espacios de nombres distintos, y hasta #10 los dos se llamaban
# `NAMESPACE`:
#
#   - el de SU SISTEMA (`kamayuk-<sistema>-<ambiente>`): ahi vive el Deployment del que sale la
#     imagen, ahi corre el Job, y ahi tiene que estar el `Secret` que monta —un `secretKeyRef`
#     se resuelve en el espacio de nombres del pod y en ningun otro—;
#   - el de la PLATAFORMA (`kamayuk-<ambiente>`): ahi viven el motor y su `Service`, y ahi corre
#     el `kubectl exec` con que se comprueba una credencial.
#
# Y el Job **tiene que correr en el del sistema**, medido y no supuesto sobre los manifiestos de
# `stg`:
#
#   - `denegar-todo` en `kamayuk-stg` niega TODO el egreso de su espacio de nombres, y de las
#     siete politicas que lo devuelven ninguna nombra a un Job de carga. Un Job creado ahi no
#     llega al 5432 ni estando el motor al lado;
#   - `permitir-ingreso-postgres` admite hoy `namespaceSelector: {kamayuk-sistema: si}`, o sea
#     cualquier pod de un espacio de nombres de sistema. La etiqueta `app: lote` que los guiones
#     escriben **no la nombra ninguna politica**: se comprobo buscandola en los manifiestos y no
#     aparece ni una vez. El comentario que la justificaba era cierto antes de ADR-0031 y hoy es
#     falso;
#   - y el egreso del lado del sistema lo da `kamayuk-<sistema>-egreso`, cuyo `podSelector` es
#     `componente: <sistema>`. Por eso {@link etiquetas_del_job} pone esa etiqueta: con otra, el
#     pod arranca y la conexion cae.
#
# ## El limite, dicho en vez de descubierto
#
# Esto es una sola fuente **para este repositorio**. `catastro`, `rentas` y `caja` tienen sus
# propios guiones de carga con el mismo patron y no pueden hacer `source` de un archivo que vive
# aqui. Lo que mantiene a los cuatro en linea es la guarda
# `infra/verificaciones/guiones-de-carga.ts`, que compara lo que los guiones de los cuatro clones
# PIDEN con lo que el manifiesto EMITE.

# El sistema al que pertenecen los tres guiones de este directorio. Los parametros normativos
# viven en `normativa` desde el corte (ADR-0025, ADR-0031).
SISTEMA_DE_LOS_PARAMETROS=normativa

# `kamayuk-<sistema>-<ambiente>`, la misma convencion que `namespaceDelSistema` de
# `infra/descriptor/entorno.ts`. Aqui se escribe en shell porque un guion no puede importar
# TypeScript; que las dos no se separen lo vigila la guarda.
namespace_del_sistema() {
    printf 'kamayuk-%s-%s' "${1:?falta el sistema}" "${2:?falta el ambiente}"
}

# `kamayuk-<ambiente>`, la misma convencion que `namespaceName` de `infra/config.ts`.
namespace_de_la_plataforma() {
    printf 'kamayuk-%s' "${1:?falta el ambiente}"
}

# Las etiquetas del POD del Job, en tres lineas de YAML ya indentadas a ocho espacios.
#
# `componente: <sistema>` es la que decide, y no es decorativa: es el `podSelector` de
# `kamayuk-<sistema>-egreso`, la politica que deja salir al 5432 desde ese espacio de nombres.
# Por eso el nombre del proceso baja a `proceso:` y no se queda en `componente:`, que es donde
# estaba: con `componente: publicacion-parametros` el pod arranca y la conexion cae, que es
# exactamente el modo de fallo que el comentario de `app: lote` describia y atribuia a otra cosa.
#
# `sistema:` acompana porque es la etiqueta con que se encuentra lo de un sistema en el cluster.
etiquetas_del_job() {
    local sistema=${1:?falta el sistema} proceso=${2:?falta el proceso}
    printf '        componente: %s\n        sistema: %s\n        proceso: %s' \
        "$sistema" "$sistema" "$proceso"
}

# La imagen del backend de un sistema, leida del Deployment que el ambiente despliega.
#
# POR ETIQUETA Y NO POR NOMBRE, a proposito: el nombre `kamayuk-<sistema>-web` lo compone el
# descriptor de ese sistema y no este guion, asi que escribirlo aqui seria el noveno sitio con la
# misma verdad —que es lo que #10 encontro—. Las etiquetas `sistema` y `perfil` las pone
# `entornoPara` para todos, y hoy seleccionan exactamente un Deployment por espacio de nombres:
# medido sobre `yarn manifiestos --ambiente stg` y `--ambiente prod`, uno en cada uno de los
# cuatro (`kamayuk-caja-interfaz` no lleva `perfil`, asi que no entra).
#
# Y se para si no encuentra exactamente uno. «No se pudo comprobar» no puede leerse igual que
# «esta bien» (C-15/C-16): con cero Deployments la variable quedaria vacia y con dos elegiria uno
# en silencio.
imagen_del_backend() {
    local sistema=${1:?falta el sistema} ambiente=${2:?falta el ambiente}
    local namespace
    namespace=$(namespace_del_sistema "$sistema" "$ambiente")

    local selector="sistema=$sistema,perfil=web"
    local nombres imagenes
    nombres=$(kubectl -n "$namespace" get deployment -l "$selector" \
        -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true)
    imagenes=$(kubectl -n "$namespace" get deployment -l "$selector" \
        -o jsonpath='{range .items[*]}{.spec.template.spec.containers[0].image}{"\n"}{end}' \
        2>/dev/null || true)

    local cuantos
    cuantos=$(printf '%s' "$nombres" | grep -c . || true)
    if [ "$cuantos" != "1" ]; then
        cat >&2 <<EOF
No hay exactamente UN Deployment «$selector» en «$namespace»: hay $cuantos.

De ese Deployment sale la imagen con que corre este Job, y sin el no se puede componer ninguno:
un contenedor con «image: ""» no arranca, y uno con la imagen de otro sistema arranca, no atiende
la propiedad de carga, no escribe ni una fila y sale con codigo 0 (C-6).

Lo que hay en «$namespace», si es que hay algo:
$(kubectl -n "$namespace" get deployment -o name 2>&1 | sed 's/^/  /')

Si el espacio de nombres no existe, este ambiente todavia no despliega «$sistema»:
  yarn --cwd infra manifiestos --ambiente $ambiente
dice cual es el que si.
EOF
        return 1
    fi

    local imagen
    imagen=$(printf '%s' "$imagenes" | head -1)
    [ -n "$imagen" ] || {
        echo "El Deployment «$(printf '%s' "$nombres" | head -1)» de «$namespace» no declara" \
            "ninguna imagen en su primer contenedor." >&2
        return 1
    }
    printf '%s' "$imagen"
}

# El `Secret` de un sistema, con la misma convencion que `secretoDe` de `descriptor/entorno.ts`:
# `kamayuk-<sistema>-<ambiente>-<clave>`, y su dato SIEMPRE bajo la llave `clave`.
#
# Son ESPEJOS de los de la plataforma —`inventarioDelAmbiente` los marca asi—, y existen porque un
# `secretKeyRef` no cruza el espacio de nombres: el pod solo ve los suyos. Hasta #10 estos guiones
# montaban el de la plataforma, que es donde el Job corria antes del corte.
secreto_del_sistema() {
    printf 'kamayuk-%s-%s-%s' "${1:?falta el sistema}" "${2:?falta el ambiente}" \
        "${3:?falta la clave}"
}

# Que el `Secret` este DONDE el Job lo va a montar. Se para nombrandolo, con lo que hay que hacer.
exigir_secreto() {
    local namespace=${1:?falta el namespace} secreto=${2:?falta el secreto} \
        origen=${3:?falta el secreto de origen} sistema=${4:?falta el sistema}
    kubectl -n "$namespace" get secret "$secreto" >/dev/null 2>&1 && return 0
    cat >&2 <<EOF
No existe el secreto «$secreto» en «$namespace», y sin el este Job no arranca.

Un «secretKeyRef» se resuelve en el espacio de nombres del POD y en ningun otro, asi que la copia
que hace falta es la de «$namespace». Lo que hay en el inventario es «$origen», en el de la
plataforma. Bajarla es una entrada mas en el «claves()» del descriptor de «$sistema», que
«inventarioDelAmbiente» convierte en ESPEJO de esa —un rol del cluster tiene UNA contrasena, asi
que generarla aparte dejaria dos valores para el mismo rol—; y despues, contra este ambiente:

  secretos/bootstrap-secretos.sh --ambiente <ambiente>

Los que hay hoy en «$namespace»:
$(kubectl -n "$namespace" get secret -o name 2>&1 | sed 's/^/  /')
EOF
    return 1
}
