#!/bin/bash
#
# Las CINCO bases del producto, una por sistema (ADR-0029, ADR-0032, ADR-0039).
#
# Corre en `docker-entrypoint-initdb.d`, ANTES que `10-crear-roles.sql`, y una sola vez:
# cuando el volumen esta vacio. El numero delante es lo unico que ordena estos guiones.
#
# POR QUE UNA POR SISTEMA Y NO UNA CON CINCO ESQUEMAS
# Cada sistema tiene su base y su historia de migraciones (ADR-0032 §1). Una base con
# cinco esquemas seria una base compartida con cinco despliegues encima —lo que ADR-0029
# descarta como «lo peor de los dos mundos»— y una migracion de esquema podria romper un
# sistema que nadie toco.
#
# **Este guion NO lleva la lista escrita**: la deriva de los `crear-roles.sql` que el compose
# monta, asi que el quinto sistema (ADR-0039) entro anadiendo su montaje y nada mas. Que el
# montaje este es lo que mide la mutacion (M3) de esa etapa: sin el, la base `identidad` no se
# crea y su migrador muere con «database "identidad" does not exist».
#
# LAS EXTENSIONES LAS DECIDE CADA SISTEMA, Y ESTE GUION LAS DERIVA (C-10)
# Van en cada base y no en `template1`: son de la BASE, no del cluster, y una instalada en
# otra base no vale. Cual va en cual **no se decide aqui**: sale del `crear-roles.sql` de
# cada sistema, que el compose monta en `$DIR/roles/<sistema>.sql`. La lista de bases sale
# de esos mismos archivos, asi que anadir un sistema es anadir su montaje y nada mas.
#
# Hasta C-10 este guion llevaba las cuatro escritas a mano y las creaba en las CUATRO
# bases, «para que el baseline de cualquiera pueda correr sin sorpresas». El costo no era
# «unos megas por base»: **la decision de `caja` no se cumplia**. `caja` no declara ninguna
# a proposito (P5D) —«la ventanilla tiene que poder correr en el motor mas simple que
# exista»— y su base recibia PostGIS igual, de modo que esa frase no la ejercitaba nadie.
# Lo mismo con `normativa`, que tras C-13 tampoco declara ninguna.
#
# Y lo que ese «sin sorpresas» protegia sigue protegido, mejor: una migracion que use una
# extension que su `crear-roles.sql` no declare la caza
# `infra/verificaciones/extensiones-de-las-migraciones.ts` **antes** de llegar a un motor,
# nombrando el repositorio, la migracion y la extension (#742, C-2).
#
# EL DIRECTORIO
# `/etc/kamayuk` dentro del contenedor, donde el compose monta la libreria y los cuatro
# archivos de roles. La variable existe para poder EJECUTAR este guion fuera del
# contenedor, que es lo unico que demuestra que hace lo que dice: el demonio de Docker de
# la maquina donde se escribio esto es un tunel a un VPS y no puede montar rutas locales.
set -euo pipefail

DIR=${KAMAYUK_DIR_KAMAYUK:-/etc/kamayuk}
DIR_ROLES="$DIR/roles"

# shellcheck source=lib-extensiones.sh
. "$DIR/lib-extensiones.sh"

# Un montaje que falta NO deja este guion creando bases sin extensiones: Docker crea un
# DIRECTORIO vacio cuando el origen de un bind mount no existe, y una base a la que le
# falta su PostGIS no falla al crearse — falla una hora despues, a mitad de la migracion,
# con «type "geography" does not exist», que es el incidente que #742 existe para no
# repetir. Asi que se comprueba que cada entrada sea un archivo de verdad.
shopt -s nullglob
ARCHIVOS=("$DIR_ROLES"/*.sql)
shopt -u nullglob
if [ ${#ARCHIVOS[@]} -eq 0 ]; then
    echo "No hay ningun «$DIR_ROLES/<sistema>.sql»." >&2
    echo "El compose los monta desde el clon hermano de cada sistema; si falta alguno," >&2
    echo "traelo con: git clone https://github.com/hneyra/<sistema>" >&2
    exit 1
fi

BASES=""
for archivo in "${ARCHIVOS[@]}"; do
    base=$(basename "$archivo" .sql)
    # `-f` ANTES que `-s`: un directorio tiene tamanio mayor que cero, asi que `-s` solo
    # daria por bueno justo el caso que esto vigila —el bind mount cuyo origen no existe,
    # que Docker sustituye por un directorio vacio—.
    if [ ! -f "$archivo" ] || [ ! -s "$archivo" ]; then
        echo "«${archivo}» esta vacio o no es un archivo: no se puede saber que extensiones" >&2
        echo "necesita la base «${base}», asi que no se crea. Suele ser el clon hermano que" >&2
        echo "falta: git clone https://github.com/hneyra/$base" >&2
        exit 1
    fi
    BASES="$BASES $base"
done

for archivo in "${ARCHIVOS[@]}"; do
    base=$(basename "$archivo" .sql)
    echo "creando la base «${base}»"
    psql --username "$POSTGRES_USER" --dbname postgres --no-psqlrc --set ON_ERROR_STOP=1 <<-SQL
	SELECT 'CREATE DATABASE $base' WHERE NOT EXISTS (
	    SELECT 1 FROM pg_database WHERE datname = '$base')\gexec
	SQL

    extensiones=$(extensiones_declaradas "$archivo")
    if [ -z "$extensiones" ]; then
        # No es un caso raro ni un error: es la decision de `caja` (P5D), la de
        # `normativa` (C-13) y la de `identidad` (ADR-0039). Se dice, para que se vea en el
        # registro del arranque.
        echo "  «${base}» no declara ninguna extension"
        continue
    fi
    for extension in $extensiones; do
        echo "  «${base}» declara «${extension}»"
        psql --username "$POSTGRES_USER" --dbname "$base" --no-psqlrc --set ON_ERROR_STOP=1 \
            -v extension="$extension" <<-'SQL'
	CREATE EXTENSION IF NOT EXISTS :"extension";
	SQL
    done
done

echo "las bases del producto estan:$BASES"
