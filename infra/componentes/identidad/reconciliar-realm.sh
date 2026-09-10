#!/bin/bash
# Aplica al Keycloak del cluster el realm versionado en el repositorio (issue #151).
#
# Existe porque `--import-realm` solo importa la PRIMERA vez. Con el import, un
# cambio del realm despues del primer arranque —un cliente nuevo, una redireccion
# corregida, el mapeador de `municipalidad_id` que alguien borro sin querer— no
# llega nunca al cluster, y nadie se entera hasta que un token sale sin el claim.
#
# Lo que hace, en orden, y todo idempotente:
#
#   1. Espera a que Keycloak acepte la sesion de administracion.
#   2. Crea el realm si no existe; si existe, actualiza sus ajustes.
#   3. Aplica el perfil de usuario, que es de donde sale el atributo
#      `municipalidad_id`. NO viaja en partialImport: es un componente del realm.
#   4. Importa los clientes con `partialImport` e `ifResourceExists=OVERWRITE`.
#      OVERWRITE reemplaza el CLIENTE, no el realm: los usuarios de la
#      municipalidad no se tocan. Un `kc.sh import --override` si los perderia,
#      y esa es la diferencia por la que este guion existe en vez de aquel.
#   5. **Comprueba que el mapeador del claim quedo puesto.** Si no esta, sale con
#      error y el despliegue queda rojo.
#
# El paso 5 es el que convierte este Job en una verificacion: sin el, un realm sin
# mapeador se aplicaria en verde y el sintoma aparecceria como un 403 —
# SIN_MUNICIPALIDAD o SIN_DOCUMENTO— que no dice por que se rompio.
#
# Sirve para LOS DOS realms (ADR-0020): sin argumento reconcilia el de
# funcionarios; con `ciudadano`, el del portal. Cambian los tres archivos, el
# nombre del realm y el claim que se comprueba; el procedimiento es el mismo, y
# por eso no hay dos guiones.
#
# Los tres archivos JSON no se escriben a mano: los deriva `Identidad.ts` del
# `realm-sgtm.json` que ya usa el compose, para que haya un solo realm versionado.
set -euo pipefail

: "${KC_SERVIDOR:?falta KC_SERVIDOR}"
: "${KC_REALM:?falta KC_REALM}"
: "${KC_ADMIN:?falta KC_ADMIN}"
: "${KC_CLAVE:?falta KC_CLAVE}"

# El `kcadm` de la imagen. Se puede apuntar a otro **para poder ejercer este guion sin
# Keycloak**: es como se midio el paso de los ambitos, con un `kcadm` de mentira que anota
# lo que recibe —el mismo recurso con que se ejercen `crear-extensiones.sh` y
# `diagnostico-del-namespace.sh`—. Dentro del contenedor no hay otro que apuntar.
KCADM=${KCADM:-/opt/keycloak/bin/kcadm.sh}
DIRECTORIO=${KC_DIRECTORIO:-/realm}

# ---------------------------------------------------------------------------
# Que realm se reconcilia. Sin argumento, el de funcionarios; con `ciudadano`,
# el del portal (ADR-0020).
#
# El mismo guion para los dos porque el procedimiento es identico —crear o
# actualizar, aplicar el perfil, importar los clientes y COMPROBAR que el
# mapeador quedo puesto—; lo que cambia son tres archivos, el nombre del realm y
# **cual es el claim que no puede faltar**. Copiar el guion habria duplicado el
# paso 5, que es el que convierte este Job en una verificacion, y una copia del
# paso 5 es una que un dia deja de comprobar lo suyo.
# ---------------------------------------------------------------------------
CUAL=${1:-funcionarios}
case "$CUAL" in
    funcionarios)
        ARCHIVO_REALM="$DIRECTORIO/realm.json"
        ARCHIVO_PERFIL="$DIRECTORIO/perfil-de-usuario.json"
        ARCHIVO_CLIENTES="$DIRECTORIO/clientes.json"
        PREFIJO_AMBITOS="ambito--"
        # Ya viene de las variables de entorno del pod.
        CLAIM=${KC_CLAIM:-municipalidad_id}
        ;;
    ciudadano)
        : "${KC_REALM_CIUDADANO:?falta KC_REALM_CIUDADANO}"
        : "${KC_CLIENTES_CIUDADANO:?falta KC_CLIENTES_CIUDADANO}"
        ARCHIVO_REALM="$DIRECTORIO/realm-ciudadano.json"
        ARCHIVO_PERFIL="$DIRECTORIO/perfil-de-usuario-ciudadano.json"
        ARCHIVO_CLIENTES="$DIRECTORIO/clientes-ciudadano.json"
        PREFIJO_AMBITOS="ambito-ciudadano--"
        KC_REALM=$KC_REALM_CIUDADANO
        KC_CLIENTES=$KC_CLIENTES_CIUDADANO
        # El claim del que sale el SUJETO del portal. Sin el, el backend
        # responde 403 SIN_DOCUMENTO y el 403 no dice por que.
        CLAIM=numero_documento
        ;;
    *)
        echo "FALLO: no se sabe reconciliar «$CUAL». Es «funcionarios» o «ciudadano»." >&2
        exit 1
        ;;
esac

echo "Reconciliando el realm «${KC_REALM}» contra $KC_SERVIDOR"

# El Job puede arrancar antes que Keycloak termine de migrar su propia base. No es
# un fallo: es el orden normal de un despliegue. Se reintenta durante cinco
# minutos y se rinde con un mensaje que dice que se estaba esperando.
intento=0
until "$KCADM" config credentials \
        --server "$KC_SERVIDOR" --realm master \
        --user "$KC_ADMIN" --password "$KC_CLAVE" >/dev/null 2>&1; do
    intento=$((intento + 1))
    if [ "$intento" -ge 100 ]; then
        echo "FALLO: Keycloak no acepto la sesion de administracion en $KC_SERVIDOR." >&2
        exit 1
    fi
    sleep 3
done

if "$KCADM" get "realms/$KC_REALM" >/dev/null 2>&1; then
    echo "El realm ya existe: se actualizan sus ajustes."
    "$KCADM" update "realms/$KC_REALM" -f "$ARCHIVO_REALM"
else
    echo "El realm no existe: se crea."
    "$KCADM" create realms -f "$ARCHIVO_REALM"
fi

# El perfil de usuario declara el atributo del que sale el claim. Sin el, el
# mapeador leeria un atributo que el realm no admite y el claim saldria vacio.
"$KCADM" update "users/profile" -r "$KC_REALM" -f "$ARCHIVO_PERFIL"

# ---------------------------------------------------------------------------
# Los ambitos que el realm declara. **`update realms` NO los importa.**
#
# Un `clientScope` del archivo versionado entra al CREAR el realm y en ningun otro
# momento: `kcadm update realms/<realm> -f realm.json` actualiza los ajustes y deja
# los ambitos como estaban. Asi que un ambito anadido despues del primer arranque
# no llega NUNCA a un ambiente que ya existe, que es exactamente el agujero por el
# que este guion se escribio para el resto del realm (#151).
#
# Medido en `stg` el 2026-09-10: el `Job` imprimio «El realm ya existe: se
# actualizan sus ajustes.» y despues murio en `reconciliar-identidades.sh
# servicios` con «FALLO: el realm «sgtm» no tiene el ambito «kamayuk-servicio»» —el
# que #21 anadio al archivo versionado—, y con el se quedaron sin correr los tres
# modos que van detras, porque el contenedor los encadena con `&&`. Sin ese ambito
# no hay cliente de servicio que emita `municipalidad_id`, o sea que ninguno de los
# cuatro consumidores del buzon de `identidad` puede pedir un token acotado a su
# municipalidad (ADR-0028 §2).
#
# Se leen del NOMBRE DEL ARCHIVO y no del JSON: la imagen de Keycloak no trae `jq`
# ni `python`, que es lo mismo que obliga a derivar los TSV de identidades fuera
# (#21). `Identidad.ts` emite un documento por ambito y uno por mapeador.
#
# Idempotente por construccion: lo que ya esta no se toca, y lo que falta se crea.
# Nunca borra un ambito —podria estar concedido a clientes que este guion no
# conoce—, asi que un ambito que exista SIN su mapeador se repara anadiendoselo.
# ---------------------------------------------------------------------------
idDelAmbito() {
    # Por `id,name` y comparando el nombre, y no con `-q name=`: asi no depende de que
    # el filtro lo aplique el servidor. Una coincidencia equivocada aqui devolveria el
    # id de OTRO ambito y los mapeadores acabarian en el sitio que no es.
    "$KCADM" get client-scopes -r "$KC_REALM" --fields id,name --format csv --noquotes \
        2>/dev/null | awk -F, -v n="$1" '$2 == n { print $1; exit }'
}

for ARCHIVO_AMBITO in "$DIRECTORIO/$PREFIJO_AMBITOS"*.json; do
    [ -e "$ARCHIVO_AMBITO" ] || continue
    BASE=${ARCHIVO_AMBITO##*/}
    BASE=${BASE%.json}
    # Los mapeadores viven en archivos con el mismo prefijo y se tratan dentro del bucle
    # de su ambito, no como si fueran uno.
    case "$BASE" in *--mapeador--*) continue ;; esac
    AMBITO=${BASE#"$PREFIJO_AMBITOS"}

    ID_AMBITO=$(idDelAmbito "$AMBITO")
    if [ -z "$ID_AMBITO" ]; then
        "$KCADM" create client-scopes -r "$KC_REALM" -f "$ARCHIVO_AMBITO" >/dev/null
        ID_AMBITO=$(idDelAmbito "$AMBITO")
        if [ -z "$ID_AMBITO" ]; then
            echo "FALLO: se creo el ambito «$AMBITO» y no se le encuentra el id." >&2
            exit 1
        fi
        echo "Ambito «$AMBITO»: creado."
    else
        echo "Ambito «$AMBITO»: ya esta."
    fi

    MAPEADORES=$("$KCADM" get "client-scopes/$ID_AMBITO/protocol-mappers/models" \
        -r "$KC_REALM" 2>/dev/null | tr -d ' \n' || true)
    for ARCHIVO_MAPEADOR in "$DIRECTORIO/$BASE--mapeador--"*.json; do
        [ -e "$ARCHIVO_MAPEADOR" ] || continue
        NOMBRE=${ARCHIVO_MAPEADOR##*/}
        NOMBRE=${NOMBRE%.json}
        NOMBRE=${NOMBRE#"$BASE--mapeador--"}
        case "$MAPEADORES" in
            *"\"name\":\"$NOMBRE\""*)
                echo "  = mapeador «$NOMBRE»"
                continue
                ;;
        esac
        # Un ambito que existe sin su mapeador emite tokens validos y SIN el claim, y el
        # sintoma aparece despues y en otro sitio: un 403 del sistema llamado (#21).
        "$KCADM" create "client-scopes/$ID_AMBITO/protocol-mappers/models" \
            -r "$KC_REALM" -f "$ARCHIVO_MAPEADOR" >/dev/null
        echo "  + mapeador «$NOMBRE»"
    done
done

"$KCADM" create partialImport -r "$KC_REALM" -f "$ARCHIVO_CLIENTES"

# ---------------------------------------------------------------------------
# La comprobacion. Es lo que hace que este Job valga como verificacion.
# ---------------------------------------------------------------------------
for cliente in $KC_CLIENTES; do
    # Sin `--fields`: se probo `--fields 'protocolMappers(name,config)'` y kcadm
    # devuelve el `config` de cada mapeador siempre vacio (`{}`) para un campo
    # anidado dentro de un arreglo -confirmado contra un Keycloak real (issue
    # #158): `get clients/<id> --fields 'protocolMappers(name,config)'` y la misma
    # consulta por `clientId` sin filtrar dan resultados distintos, y solo la
    # segunda trae el `claim.name` que esta comprobacion necesita ver. Con el
    # filtro, esta comprobacion fallaba SIEMPRE, con el mapeador correctamente
    # puesto: un falso rojo permanente, no una carrera.
    mapeadores=$("$KCADM" get clients -r "$KC_REALM" -q "clientId=$cliente" 2>/dev/null || true)

    case "$mapeadores" in
        *"$CLAIM"*) ;;
        *)
            echo "FALLO: el cliente «${cliente}» quedo SIN el mapeador de ${CLAIM}." >&2
            echo "Es el claim del que sale el sujeto de cada peticion: el SET LOCAL en el" >&2
            echo "realm de funcionarios (ADR-0005), el documento acreditado en el del" >&2
            echo "ciudadano (ADR-0020). Un realm sin ese mapeador emite tokens que el" >&2
            echo "backend rechaza con 403, y el 403 no dice por que." >&2
            exit 1
            ;;
    esac
    echo "Cliente «${cliente}»: mapeador de ${CLAIM} presente."
done

echo "Realm «${KC_REALM}» reconciliado."
