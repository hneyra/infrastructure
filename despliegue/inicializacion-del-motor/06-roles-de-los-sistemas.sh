#!/bin/bash
#
# Los roles y los privilegios de cada sistema, EN SU PROPIA BASE (C-14, punto 2).
#
# Corre en `docker-entrypoint-initdb.d` justo detras de `05-crear-bases.sh` —que crea las cuatro
# bases y sus extensiones— y delante de `10-crear-roles.sql`, que es el del monolito y va contra
# la base `postgres`. El numero delante es lo unico que ordena estos guiones.
#
# QUE HACE, Y POR QUE NO LO HACIA NADIE
# `crear-roles.sql` de cada sistema hace cuatro cosas: crea los cuatro roles del cluster, les
# concede `USAGE`/`CREATE` sobre `public` DE ESA BASE, instala las extensiones que esa base
# declara, y revoca el `CONNECT` que PostgreSQL le regala a PUBLIC al crear una base.
#
# Hasta C-14 solo se aplicaba la tercera parte, y no aplicandolo: `05-crear-bases.sh` DERIVA las
# extensiones del archivo y las crea una a una (C-10). Las otras tres no las hacia nadie —quedo
# escrito como hueco 4 de C-10—, con dos consecuencias que no se parecen entre si:
#
#   * `sgtm_owner` no tiene `CREATE` sobre `public` de esas bases, asi que **la migracion falla**
#     en la primera sentencia que cree una tabla;
#   * y `CONNECT` sigue concedido a PUBLIC, de modo que TODO rol del cluster puede abrir una
#     sesion contra la base de cualquier sistema. No veria filas —RLS esta forzada— pero seria
#     una credencial de mas apuntando a un padron, que es lo que #155 midio con el rol del
#     respaldo.
#
# POR QUE SE EJECUTA EL ARCHIVO ENTERO Y NO SE COPIA NADA DE EL
# Es el mismo archivo que el modulo del esquema de ese sistema versiona y que su prueba de
# aislamiento aplica: `MigradorTest` y `BaseDeDatosDePrueba` provisionan con el. Copiar aqui sus
# `GRANT` seria un segundo sitio donde olvidar que el rol no puede ser superusuario, y los dos se
# separarian el dia que alguien toque uno.
#
# ES IDEMPOTENTE, y lo dice el propio archivo en su cabecera: los `CREATE ROLE` van dentro de un
# `IF NOT EXISTS`, las extensiones llevan `IF NOT EXISTS` y los `GRANT` se pueden repetir. Aun
# asi solo corre una vez, cuando el volumen esta vacio.
#
# EL DIRECTORIO
# `/etc/kamayuk` dentro del contenedor, el mismo que lee `05-crear-bases.sh`: ahi el compose monta
# los cuatro `crear-roles.sql` y el `ConfigMap` del cluster los proyecta. La variable existe para
# poder EJECUTAR este guion fuera del contenedor, que es lo unico que demuestra que hace lo que
# dice — el demonio de Docker de la maquina donde se escribio esto es un tunel a un VPS y no puede
# montar rutas locales.
set -euo pipefail

DIR=${KAMAYUK_DIR_KAMAYUK:-/etc/kamayuk}
DIR_ROLES="$DIR/roles"

shopt -s nullglob
ARCHIVOS=("$DIR_ROLES"/*.sql)
shopt -u nullglob
if [ ${#ARCHIVOS[@]} -eq 0 ]; then
    echo "No hay ningun «$DIR_ROLES/<sistema>.sql»." >&2
    echo "El compose los monta desde el clon hermano de cada sistema; si falta alguno," >&2
    echo "traelo con: git clone https://github.com/hneyra/<sistema>" >&2
    exit 1
fi

for archivo in "${ARCHIVOS[@]}"; do
    base=$(basename "$archivo" .sql)
    # `-f` ANTES que `-s`, por lo mismo que en `05-crear-bases.sh`: Docker deja un DIRECTORIO
    # vacio cuando el origen de un bind mount no existe, y un directorio tiene tamanio mayor que
    # cero. Con `-s` a secas, el unico caso que esto vigila pasaria por bueno.
    if [ ! -f "$archivo" ] || [ ! -s "$archivo" ]; then
        echo "«${archivo}» esta vacio o no es un archivo: no se pueden aplicar los roles de la" >&2
        echo "base «${base}». Suele ser el clon hermano que falta:" >&2
        echo "  git clone https://github.com/hneyra/$base" >&2
        exit 1
    fi
    echo "aplicando los roles y privilegios de «${base}» sobre su propia base"
    # `--dbname "$base"` y no `postgres`: el archivo usa `current_database()` para revocar el
    # CONNECT, asi que aplicado contra la base equivocada revocaria el de OTRA — y las extensiones
    # y los GRANT sobre `public` son de la base, no del cluster.
    psql --username "$POSTGRES_USER" --dbname "$base" --no-psqlrc --set ON_ERROR_STOP=1 \
        --file "$archivo"
done

echo "los roles de los cuatro sistemas estan aplicados, cada uno en su base"
