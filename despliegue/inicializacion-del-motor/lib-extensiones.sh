#!/usr/bin/env bash
# Lo que un `crear-roles.sql` DECLARA. Una sola implementacion para los dos guiones.
#
# ## Por que existe este archivo, y no una linea de `grep` en cada uno
#
# Las extensiones se nombraban en TRES sitios (C-2 §6, huecos 2 y 3):
#
#   1. el `crear-roles.sql` de cada sistema — el unico que deberia decidirlo;
#   2. `05-crear-bases.sh`, con las cuatro escritas a mano y creadas en las cuatro bases;
#   3. `crear-extensiones.sh`, que si derivaba, pero de UN archivo con la ruta del
#      monolito escrita a mano y contra UNA base.
#
# El (2) tenia una consecuencia medida: en el entorno local **la decision de `caja` no se
# cumplia**. `caja` no declara ninguna extension a proposito (P5D, «la ventanilla tiene
# que poder correr en el motor mas simple que exista») y su base recibia PostGIS igual, de
# modo que la frase no se ejercitaba en ninguna parte.
#
# C-10 deja el (1) como unico sitio donde se decide, y (2) y (3) derivan. Si los dos
# derivaran con su propia copia del patron, volveriamos a tener dos sitios donde una
# extension se puede dejar de ver — que es el defecto, un escalon mas abajo. De ahi este
# archivo: **una** funcion, sourced por los dos.
#
# La guarda de `infra/verificaciones/extensiones-de-las-migraciones.ts` lee lo mismo en
# TypeScript, y no se fia: una prueba EJECUTA esta funcion sobre los seis `crear-roles.sql`
# reales y compara las dos lecturas. Dos implementaciones que se separan es exactamente lo
# que esto existe para impedir, asi que se miden la una contra la otra.
#
#   . lib-extensiones.sh
#   extensiones_declaradas <archivo>   # una por linea, ordenadas, sin repetir

# Los comentarios NO cuentan, y no es un detalle.
#
# `caja/crear-roles.sql` nombra `pg_trgm`, `unaccent`, `postgis` y `btree_gist` en su
# cabecera **para explicar por que no declara ninguna**, y la cabecera del `crear-roles.sql`
# del monolito explica en prosa por que `btree_gist` va ahi y no en la migracion. Buscar el
# patron en el archivo entero daria por declarada una extension que nadie crea — el hueco
# exacto que #426 destapo en `leerPatron` y que #558 volvio a encontrar buscando una cadena
# que vivia tambien en el comentario que la explicaba.
#
# Hoy ninguno de los seis archivos escribe `CREATE EXTENSION` dentro de un comentario, asi
# que quitar este `sed` no cambiaria nada — y por eso la prueba que lo mide no usa los
# archivos reales sino uno fabricado con la trampa dentro.
extensiones_declaradas() {
    local archivo=${1:?falta el archivo de roles}
    [ -f "$archivo" ] || {
        echo "No se puede leer «${archivo}», que es donde se declaran las extensiones." >&2
        return 1
    }
    # El `|| true` NO es prudencia: **cero es una respuesta legitima y frecuente**.
    # `caja` no declara ninguna, y `grep` sale con codigo 1 cuando no encuentra nada; con
    # `set -euo pipefail` en quien llama, eso mataria el guion justo en el unico sistema
    # cuya decision es no declarar ninguna. Medido: sin el, `05-crear-bases.sh` aborta al
    # llegar a `caja` y las bases que fueran despues no se crean.
    sed 's/--.*$//' "$archivo" \
        | { grep -oiE 'CREATE[[:space:]]+EXTENSION([[:space:]]+IF[[:space:]]+NOT[[:space:]]+EXISTS)?[[:space:]]+[a-z_0-9]+' || true; } \
        | awk '{print tolower($NF)}' \
        | sort -u
}
