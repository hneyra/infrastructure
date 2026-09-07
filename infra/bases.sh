# shellcheck shell=bash
# Las bases de datos del cluster, nombradas UNA vez para todo el lado shell (#15).
#
# Se lee con `source`; no ejecuta nada, no imprime nada y no tiene `set -euo pipefail`
# propio: hereda el de quien la usa. La ruta se compone desde la raiz de `infra/`, que
# todos sus llamadores ya calculan (`INFRA`, `RAIZ` o `LIB_MOTOR_INFRA`).
#
# ## Por que existe
#
# `E` retiro el monolito y con el la base `sgtm`, que era «el padron». Su sustituta quedo
# escrita **cinco veces** —cuatro guiones y una constante de TypeScript—, y ese es el modo
# de fallo que este repositorio lleva doscientos issues evitando: la misma verdad en varios
# sitios y nada que los ponga de acuerdo. Cambiar la eleccion —y es una eleccion,
# argumentada en el javadoc de `BASE_DEL_PADRON` en `componentes/convenciones.ts`— obligaba
# a acordarse de cinco archivos, y **olvidar uno no ponia nada rojo**: dejaba un guion
# hablando con una base distinta de la que el resto usa.
#
# ## Como se pone de acuerdo con el lado TypeScript
#
# No se puede tener literalmente un solo archivo: `componentes/` compone manifiestos y esto
# lo lee `bash` sin node delante —`contra-cluster.sh` habla con el cluster con `kubectl` y
# `psql`, y pedirle `yarn manifiestos` le anadiria una dependencia de node que hoy no
# tiene—. Lo que si se puede es que los dos lados **no puedan discrepar en silencio**, y esa
# es la forma que este repositorio ya usa dos veces —`SISTEMAS=` de `verificar-el-ambiente.sh`
# y `SISTEMAS_DEL_PRODUCTO=` de `crear-extensiones.sh`—: la guarda **EJECUTA** este archivo y
# compara lo que deja fijado con las constantes de `convenciones.ts`. Vive en
# `verificaciones/bases-de-los-guiones.test.ts` y corre en `yarn verificar`, sin motor.
#
# ## Y por que cada valor es el que es
#
# El argumento largo esta en el javadoc de cada constante de `componentes/convenciones.ts`,
# que es donde se decide. En una linea cada uno:

# `rentas`, la unica de las cuatro cuyo `crear-roles.sql` concede CONNECT a los cinco roles
# del cluster —o sea la que menos supuestos hace sobre quien se conecta—, la mas grande, y
# donde vive la tabla `respaldo` que el `CronJob` escribe.
BASE_DEL_PADRON=rentas

# `normativa`, la unica que `rol_carga_parametros` alcanza (C-7 §6). Decir otra aqui seria
# decir lo contrario de la verdad.
BASE_DE_PARAMETROS=normativa

# `postgres`: existe siempre —en un cluster recien inicializado y en los dos que ya corren—
# y no es de ningun sistema. **No es el padron**, y confundirlas es el defecto que costo dos
# de las cuatro corridas de CI de `E`: quien escribe en el padron y lee en mantenimiento no
# recibe un error de conexion sino «relation … does not exist», que manda a mirar al esquema.
BASE_DE_MANTENIMIENTO=postgres

# `keycloak`, separada a proposito: Keycloak hace DDL sobre su base en cada actualizacion
# menor, y darle eso sobre la que sostiene RLS seria abrirle DDL al padron.
BASE_DE_IDENTIDAD=keycloak
