#!/usr/bin/env bash
# El puerto del motor de verificacion: se pide, no se fija (#731).
#
# ## Que problema cierra
#
# `lib-motor-local.sh` nombra su contenedor con el PID —`sgtm-motor-verificacion-$$`—, o
# sea que el NOMBRE no puede chocar nunca. El puerto del anfitrion, en cambio, era una
# CONSTANTE por guion: 55432 en `verificar-el-motor.sh`, 55434 en `verificar-rotacion.sh`
# y 55433 en `simulacro-de-restauracion.sh`. Esa asimetria es el defecto entero, y tiene
# dos consecuencias:
#
#   1. El trabajo `motor` de `infra.yml` levanta TRES motores seguidos en el mismo
#      runner desde que #435 metio la rotacion en CI, y DOS de ellos piden el mismo
#      55434 —uno por cada rol que rota—. `docker rm --force` vuelve antes de que el
#      demonio suelte el puerto, asi que el segundo muere en el `docker run`.
#   2. El sintoma no se parece a su causa. Con el nombre unico por PID el choque no
#      puede salir como «ya existe un contenedor con ese nombre» —que se entiende— sino
#      como `address already in use`, que manda a buscar fuera del propio trabajo.
#
# Y es intermitente por construccion: depende de cuanto tarde el demonio en soltar el
# puerto, asi que pasa en verde la mayoria de las veces. Eso es peor que fallar siempre.
#
# ## Por que vive en su propio archivo
#
# Porque es la unica parte de `lib-motor-local.sh` que tiene logica, y sourcear la
# biblioteca entera exige un manifiesto y una corrida de `yarn manifiestos`. Aqui no hay
# dependencias: se puede sourcear sola y ejercitar de verdad —sin Docker y sin
# PostgreSQL—, que es lo que hace `verificaciones/puerto-del-motor.test.ts`.
#
# Usa `node` y no `python3` ni `ss` porque `lib-motor-local.sh` ya exige `node`: no
# anade ninguna herramienta nueva a la lista de lo que hace falta para correr esto.

# Un puerto que ahora mismo esta libre, pedido al sistema operativo.
#
# Se pide con `listen(0)`, que es el unico modo de no adivinar: cualquier rango elegido a
# mano vuelve a ser una constante, con el mismo choque un poco mas lejos.
motor_puerto_libre() {
    node -e "
const servidor = require('net').createServer();
servidor.listen(0, '127.0.0.1', () => {
  const puerto = servidor.address().port;
  servidor.close(() => console.log(puerto));
});
"
}

# Codigo 0 si ese puerto esta libre; 1 si lo tiene alguien.
motor_puerto_esta_libre() {
    node -e "
const servidor = require('net').createServer();
servidor.once('error', () => process.exit(1));
servidor.listen($1, '127.0.0.1', () => servidor.close(() => process.exit(0)));
"
}

# Esperar a que el puerto quede libre tras detener el motor.
#
# `docker rm --force` vuelve ANTES de que el demonio suelte el puerto del anfitrion: la
# operacion es asincrona. Con el puerto automatico eso ya no choca entre corridas —cada
# una pide el suyo—, pero `simulacro-de-restauracion.sh` detiene y vuelve a arrancar
# sobre EL MISMO puerto a proposito: el PITR exige apagar el motor, destruir su
# directorio de datos y arrancar otro proceso sobre lo restaurado (#155). Ahi la espera
# no es una precaucion, es parte del procedimiento.
motor_esperar_puerto_libre() {
    local puerto=$1
    local intentos=${2:-30}
    for _ in $(seq 1 "$intentos"); do
        if motor_puerto_esta_libre "$puerto"; then
            return 0
        fi
        sleep 1
    done
    echo "AVISO: el puerto $puerto sigue ocupado tras detener el motor." >&2
    return 1
}
