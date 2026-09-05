#!/usr/bin/env bash
# Las decisiones del simulacro de restauracion LOGICA, aparte para poder EJECUTARLAS (C-11).
#
# ## Por que este archivo existe separado del guion
#
# Por lo mismo que `verificaciones/motor/puerto.sh` (#731): el guion entero necesita un
# motor de PostgreSQL, y una comprobacion que solo se puede correr donde hay motor es una
# comprobacion que no corre en ningun PR. Lo que decide —en que orden van las migraciones,
# que binarios se admiten, y sobre todo **cuando una restauracion cuenta como limpia**—
# son funciones puras, y `restauracion-logica.test.ts` las ejecuta en un bash de verdad,
# sin motor y sin Docker.
#
#   . lib-restauracion-logica.sh
#   rl_migraciones_en_orden <dir>
#   rl_major_de "<cadena de version>"
#   rl_exigir_version_soportada <major>
#   rl_errores_de_pg_restore <archivo-stderr>
#   rl_errores_de_psql <archivo-stderr>
#   rl_restauracion_limpia <errores> <codigo-de-salida>
#   rl_necesita_libro_de_flyway <dir-migraciones>
#   rl_roles_de <sistema> <raiz-de-infrastructure>
#   rl_migraciones_de <sistema> <raiz-de-infrastructure>
#   rl_perdidas_conocidas <sistema>

# ---------------------------------------------------------------------------
# La version del motor y la de los binarios
# ---------------------------------------------------------------------------

# La unica version que este producto prueba y despliega (C-4 §3.2).
#
# No se escribe otra vez: es la misma constante que `MotorPostgres.MAJOR_SOPORTADA` en los
# cuatro backends, y `restauracion-logica.test.ts` exige que sigan diciendo lo mismo.
RL_MAJOR_SOPORTADA=16

# El major de una cadena de version, venga de donde venga.
#
# Sirve para `pg_dump (PostgreSQL) 16.15 (Homebrew)`, para `psql (PostgreSQL) 16.15`, para
# el `version()` del servidor —`PostgreSQL 16.15 (Homebrew) on aarch64-apple-darwin...`— y
# para un `16.15` pelado. Lo que NO hace es adivinar: si no encuentra un numero detras de
# «PostgreSQL» ni al principio, se niega, porque un major mal leido convertiria la guarda
# de abajo en una que dice que si a todo.
rl_major_de() {
    local cadena=${1:?falta la cadena de version}
    local major
    major=$(printf '%s\n' "$cadena" | sed -nE 's/.*PostgreSQL[^0-9]*([0-9]+).*/\1/p' | head -1)
    if [ -z "$major" ]; then
        major=$(printf '%s\n' "$cadena" | sed -nE 's/^[[:space:]]*([0-9]+)([.\-].*)?$/\1/p' | head -1)
    fi
    [ -n "$major" ] || {
        echo "No se puede leer la version mayor de «${cadena}»." >&2
        return 1
    }
    printf '%s\n' "$major"
}

# Que el motor sea el que este producto despliega.
#
# **No es celo**: C-4 midio que de PostgreSQL 17 en adelante `CREATE INDEX` corre con el
# `search_path` restringido, asi que el mismo esquema que aqui se restaura bien alli no
# aplica. Un simulacro corrido contra otra version mediria otra cosa y saldria en verde.
rl_exigir_version_soportada() {
    local major=${1:?falta el major}
    [ "$major" = "$RL_MAJOR_SOPORTADA" ] || {
        echo "El motor es PostgreSQL ${major}, y este producto se prueba y se despliega" >&2
        echo "contra PostgreSQL ${RL_MAJOR_SOPORTADA} (C-4 §3.2). Un simulacro de" >&2
        echo "restauracion contra otra version no mide la restauracion que se hara." >&2
        return 1
    }
}

# Que los binarios sean del mismo major que el servidor.
#
# `pg_dump` de un major y `pg_restore` de otro **miden otra cosa**: el volcado lo escribe
# una version y lo lee otra, con otras reglas de emision. En esta maquina el `pg_dump` del
# PATH es el 18 y el motor es el 16, asi que sin esto el simulacro correria cruzado sin
# decirlo. Cada binario se nombra por separado, porque «alguno no cuadra» no dice cual.
rl_exigir_binarios_del_motor() {
    local esperado=${1:?falta el major del servidor}; shift
    local malos=0
    local par nombre major
    for par in "$@"; do
        nombre=${par%%=*}
        major=${par#*=}
        if [ "$major" != "$esperado" ]; then
            echo "«${nombre}» es de PostgreSQL ${major} y el motor es ${esperado}." >&2
            malos=$((malos + 1))
        fi
    done
    [ "$malos" -eq 0 ] || {
        echo "Volcar con una version y restaurar con otra mide otra cosa. Apunta" >&2
        echo "--binarios al directorio de PostgreSQL ${esperado}." >&2
        return 1
    }
}

# ---------------------------------------------------------------------------
# Las migraciones
# ---------------------------------------------------------------------------

# Las migraciones de un directorio, EN ORDEN DE VERSION.
#
# No vale `ls`: ordena por texto y pone `V10` antes que `V2`, y entonces la migracion que
# altera una tabla corre antes que la que la crea. Se descubrio ejecutandolo —«relation
# "pago_recibido" does not exist» en `rentas`—, y el sintoma no se parece a su causa.
#
# Cero migraciones NO es una respuesta legitima aqui, al reves que en las extensiones: un
# directorio vacio significa que la ruta esta mal, y devolver nada dejaria al simulacro
# volcando una base vacia y saliendo en verde.
rl_migraciones_en_orden() {
    local directorio=${1:?falta el directorio de migraciones}
    [ -d "$directorio" ] || {
        echo "No esta «${directorio}», que es donde viven las migraciones." >&2
        return 1
    }
    local cuantas
    cuantas=$(find "$directorio" -maxdepth 1 -name 'V*__*.sql' | wc -l | tr -d ' ')
    [ "$cuantas" -gt 0 ] || {
        echo "«${directorio}» no tiene ninguna migracion V*__*.sql." >&2
        return 1
    }
    find "$directorio" -maxdepth 1 -name 'V*__*.sql' \
        | sed -E 's|(.*/V([0-9]+)__.*)|\2 \1|' \
        | sort -n -k1,1 \
        | cut -d' ' -f2-
}

# Si alguna migracion nombra el libro de Flyway FUERA de un comentario.
#
# `V21` del monolito hace `GRANT SELECT ON flyway_schema_history TO kamayuk_app`, asi que su
# esquema no se puede aplicar con `psql` a secas: falta la tabla que normalmente crea
# Flyway. Se DERIVA en vez de escribir «si el sistema es sgtm», por lo mismo que C-10 no
# escribio la lista de extensiones: el dia que otro esquema la nombre, esto ya lo sabe.
#
# Los comentarios no cuentan: los cuatro baselines la nombran en su cabecera para explicar
# por que NO la usan (#426, #558).
rl_necesita_libro_de_flyway() {
    local directorio=${1:?falta el directorio de migraciones}
    local archivo
    while IFS= read -r archivo; do
        if sed 's/--.*$//' "$archivo" | grep -qi 'flyway_schema_history'; then
            return 0
        fi
    done < <(rl_migraciones_en_orden "$directorio")
    return 1
}

# ---------------------------------------------------------------------------
# Donde vive el esquema de cada sistema
# ---------------------------------------------------------------------------

# Los cinco esquemas del producto, en el orden en que el simulacro los recorre.
#
# **No es una lista nueva**: es la misma de `SISTEMAS` en
# `verificaciones/deriva-de-migraciones.ts`, y `restauracion-logica.test.ts` EJECUTA esta
# funcion y compara las dos. Escribirla dos veces seria un segundo sitio donde olvidarse de
# un sistema, que es el defecto que C-2 y C-10 cerraron un escalon mas abajo.
#
# El monolito va primero a proposito: es el unico que declara perdidas, y verlo primero
# deja claro que el resumen distingue «pierde lo declarado» de «no pierde nada».
rl_sistemas() {
    printf '%s\n' sgtm rentas catastro normativa caja
}


# El unico archivo que casa con un patron, o un fallo que lo dice.
#
# Mismo criterio que `despliegue/crear-extensiones.sh`: cero o mas de uno **se dice** en
# vez de elegir. Adivinar es lo que hace que una guarda mienta.
rl_unico() {
    local que=${1:?falta la descripcion}; shift
    local encontrados=()
    local candidato
    for candidato in "$@"; do
        [ -e "$candidato" ] && encontrados+=("$candidato")
    done
    if [ ${#encontrados[@]} -ne 1 ]; then
        echo "Hay ${#encontrados[@]} ${que} y tiene que haber exactamente uno." >&2
        echo "Encontrados: ${encontrados[*]:-(ninguno)}" >&2
        return 1
    fi
    printf '%s\n' "${encontrados[0]}"
}

# La raiz del esquema de un sistema: `db/`, con `roles/` y `migration/` dentro.
#
# Para `sgtm`, la copia de ESTE repositorio: es la que de verdad se aplica —el `ConfigMap`
# del cluster y el compose montan esta— y es la misma regla que ya usa
# `crear-extensiones.sh`. Para los otros cuatro, el clon hermano, con comodin sobre el
# nombre del modulo.
rl_db_de() {
    local sistema=${1:?falta el sistema}
    local raiz=${2:?falta la raiz de infrastructure}
    if [ "$sistema" = "sgtm" ]; then
        rl_unico "copia local del esquema del monolito" \
            "$raiz/backend/sgtm-esquema/src/main/resources/db"
        return
    fi
    local clon="$raiz/../$sistema"
    [ -d "$clon/.git" ] || {
        echo "No esta el clon de «${sistema}» en «${clon}», asi que no se puede volcar" >&2
        echo "su esquema. Traelo con:" >&2
        echo "    git clone https://github.com/hneyra/$sistema $clon" >&2
        echo "Esta comprobacion NO se salta: un esquema cuya restauracion no se puede" >&2
        echo "medir es exactamente el estado que C-4 dejo declarado en su hueco 3." >&2
        return 1
    }
    shopt -s nullglob
    local candidatos=("$clon"/backend/*/src/main/resources/db)
    shopt -u nullglob
    rl_unico "directorio(s) db/ en «${sistema}»" "${candidatos[@]}"
}

rl_roles_de() { echo "$(rl_db_de "$1" "$2")/roles/crear-roles.sql"; }
rl_migraciones_de() { echo "$(rl_db_de "$1" "$2")/migration"; }

# ---------------------------------------------------------------------------
# El veredicto: lo que NO se le cree a `pg_restore`
# ---------------------------------------------------------------------------

# Los errores que `pg_restore` dice haber ignorado.
rl_errores_de_pg_restore() {
    local archivo=${1:?falta el archivo de salida de error}
    [ -f "$archivo" ] || { echo "No esta «${archivo}»." >&2; return 1; }
    grep -c '^pg_restore: error:' "$archivo" || true
}

# Los errores que `psql` dice haber ignorado al restaurar un volcado PLANO.
rl_errores_de_psql() {
    local archivo=${1:?falta el archivo de salida de error}
    [ -f "$archivo" ] || { echo "No esta «${archivo}»." >&2; return 1; }
    grep -cE '^psql:.*:[0-9]+: ERROR:' "$archivo" || true
}

# Si una restauracion cuenta como limpia. **Esta funcion es el issue entero.**
#
# El codigo de salida NO decide, y no por desconfianza abstracta: se midio, y las dos
# herramientas se comportan distinto ante EL MISMO volcado con EL MISMO defecto dentro
# (C-11 §2):
#
#   - `pg_restore` sobre un volcado `-Fc`  ->  16 errores y **codigo de salida 1**
#   - `psql -f` sobre un volcado PLANO      ->  18 errores y **codigo de salida 0**
#
# El camino plano —`pg_dump | psql`, que es el que una persona teclea— termina en verde
# con la mitad del esquema perdida. Por eso el veredicto se toma sobre los errores
# CONTADOS en la salida, y el codigo de salida entra solo como segunda condicion: un
# codigo distinto de cero sin ningun error contado tambien es un fallo, y callarlo seria
# el mismo error al reves.
rl_restauracion_limpia() {
    local errores=${1:?falta el numero de errores}
    local codigo=${2:?falta el codigo de salida}
    [ "$errores" -eq 0 ] && [ "$codigo" -eq 0 ]
}

# ---------------------------------------------------------------------------
# Lo que un esquema PIERDE hoy y no se puede arreglar
# ---------------------------------------------------------------------------

# Objetos que la restauracion logica de ese esquema pierde, con su motivo.
#
# Hoy solo el monolito, y **no se puede arreglar**: `sgtm` es el archivo historico, su
# `V11` es una migracion aplicada —editarla cambia su suma de Flyway— y no admite
# migraciones nuevas (C-4 §8, hueco 1). Los cuatro sistemas del corte lo arreglaron con
# una migracion nueva cada uno; el monolito no tiene esa salida.
#
# LO QUE C-11 MIDIO Y CORRIGE DE C-4: son TRECE objetos, no uno.
#
# C-4 dejo escrito que el monolito pierde «el mismo indice, y su COMMENT» —2 errores—, y
# eso es exacto para `contribuyente_nombre_trgm_ix`. Lo que su medida no cubrio es que
# `V66` (#565) le dio a `via` la MISMA columna generada que tiene `catastro`:
#
#     ALTER TABLE via ADD COLUMN nombre_busqueda text
#         GENERATED ALWAYS AS (nombre_normalizado(nombre)) STORED;
#
# y la expresion de una columna generada se inserta en linea al CREAR LA TABLA. Medido con
# las 68 migraciones aplicadas: **21 errores**, `via` no se crea, y detras se van su clave
# primaria, sus tres indices, su politica de RLS, su secuencia, sus tres restricciones y
# las dos foraneas que la nombran desde `arancel` y `predio`. Y **sus filas**.
#
# La lista vale en LAS DOS DIRECCIONES, como `DECLARADAS_DE_MAS` en C-10: el simulacro se
# pone rojo si un esquema pierde algo que no esta aqui, **y tambien** si algo de aqui deja
# de perderse. Asi no puede quedarse rancia.
rl_perdidas_conocidas() {
    local sistema=${1:?falta el sistema}
    case "$sistema" in
        sgtm)
            cat <<'PERDIDAS'
INDICE contribuyente_nombre_trgm_ix EN contribuyente
INDICE via_codigo_prefijo_ix EN via
INDICE via_codigo_uq EN via
INDICE via_nombre_busqueda_ix EN via
INDICE via_pk EN via
POLITICA_RLS via.via_tenant
RESTRICCION arancel.arancel_via_fk
RESTRICCION predio.predio_via_fk
RESTRICCION via.via_codigo_uq
RESTRICCION via.via_municipalidad_id_fkey
RESTRICCION via.via_pk
SECUENCIA via_id_seq
TABLA via
PERDIDAS
            ;;
        *) : ;;
    esac
}

# Las tablas a las que una perdida declarada afecta, leidas de la propia lista.
#
# No es una segunda lista: se DERIVA de {@code rl_perdidas_conocidas}, porque una tabla que
# hubiera que escribir aparte seria un sitio mas donde olvidarse. Sirve para dos cosas, y
# las dos hay que decirlas porque acotan lo que el simulacro afirma:
#
#   - las FILAS de una tabla que no se crea se pierden con ella, asi que su recuento no
#     puede compararse;
#   - el RETRATO exhaustivo de esas tablas difiere por construccion, asi que se excluyen de
#     esa comparacion. El censo por nombre las sigue mirando: lo que se pierde es la
#     profundidad —columnas, privilegios— en esas tablas y solo en ellas.
rl_tablas_afectadas() {
    local sistema=${1:?falta el sistema}
    rl_perdidas_conocidas "$sistema" | awk '
        $1 == "TABLA"        { print $2 }
        $1 == "INDICE"       { print $4 }
        $1 == "RESTRICCION"  { split($2, p, "."); print p[1] }
        $1 == "POLITICA_RLS" { split($2, p, "."); print p[1] }
        $1 == "DISPARADOR"   { split($2, p, "."); print p[1] }
    ' | sort -u
}
