#!/bin/bash
#
# Las CUATRO bases del producto, una por sistema (ADR-0029, ADR-0032).
#
# Corre en `docker-entrypoint-initdb.d`, ANTES que `10-crear-roles.sql`, y una sola vez:
# cuando el volumen esta vacio. El numero delante es lo unico que ordena estos guiones.
#
# POR QUE CUATRO Y NO UNA CON CUATRO ESQUEMAS
# Cada sistema tiene su base y su historia de migraciones (ADR-0032 §1). Una base con
# cuatro esquemas seria una base compartida con cuatro despliegues encima —lo que ADR-0029
# descarta como «lo peor de los dos mundos»— y una migracion de esquema podria romper un
# sistema que nadie toco.
#
# LAS EXTENSIONES VAN EN CADA UNA, no en `template1`: son de la BASE, no del cluster, y una
# instalada en otra base no vale. `postgis` y `btree_gist` solo las necesita `catastro`
# (`V61`, `V72`); `pg_trgm` y `unaccent`, `rentas` y `catastro` (`V11`, `V66`). Se crean
# igualmente en las cuatro para que el baseline de cualquiera pueda correr sin sorpresas —el
# costo es unos megas por base; el de olvidarse, un despliegue que muere a mitad de la
# migracion, que ya paso dos veces (#742)—.
set -euo pipefail

BASES="rentas catastro normativa caja"

for base in $BASES; do
    echo "creando la base «$base»"
    psql --username "$POSTGRES_USER" --dbname postgres --no-psqlrc --set ON_ERROR_STOP=1 <<-SQL
	SELECT 'CREATE DATABASE $base' WHERE NOT EXISTS (
	    SELECT 1 FROM pg_database WHERE datname = '$base')\gexec
	SQL
    psql --username "$POSTGRES_USER" --dbname "$base" --no-psqlrc --set ON_ERROR_STOP=1 <<-SQL
	CREATE EXTENSION IF NOT EXISTS pg_trgm;
	CREATE EXTENSION IF NOT EXISTS unaccent;
	CREATE EXTENSION IF NOT EXISTS btree_gist;
	CREATE EXTENSION IF NOT EXISTS postgis;
	SQL
done

echo "las cuatro bases del producto estan: $BASES"
