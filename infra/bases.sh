# Las bases del motor, para el lado SHELL. Un solo sitio (#15).
#
# `E` retiro el monolito y con el la base `sgtm`, que era «el padron». Su sustituta quedo
# escrita CINCO veces —cuatro guiones y `componentes/convenciones.ts`— y nada las comparaba:
# cambiar la eleccion obligaba a acordarse de cinco archivos, y **olvidar uno no ponia nada
# rojo**, dejaba un guion hablando con una base distinta de la que usa el resto.
#
# Este archivo NO ES LA VERDAD: la verdad es `componentes/convenciones.ts`, que es lo que
# compone los manifiestos. Esto es su reflejo para quien no puede importar TypeScript —los
# guiones corren en el VPS y en CI, sin `yarn`—, y que los dos sigan diciendo lo mismo lo
# comprueba `bases-del-motor.test.ts` EJECUTANDO este archivo. Una prueba que solo leyera
# estas lineas pasaria con la asignacion rota (la leccion de M10 de C-19).
#
# Se declara con `${VAR:-}` para que quien llame pueda fijar otra cosa —lo usa el arnes de
# pruebas—, y NO tiene efectos: se puede cargar desde cualquier guion, incluso los que
# hablan con un cluster de verdad.

# Donde vive el padron. `rentas` y no otra: es la unica cuyo `crear-roles.sql` concede
# CONNECT a los cinco roles del cluster, o sea la que menos supuestos hace sobre quien se
# conecta, y es la base mas grande —la que un operador abre primero—. El argumento largo
# esta en el javadoc de `BASE_DEL_REGISTRO_DE_RESPALDO`.
BASE_DEL_PADRON=${BASE_DEL_PADRON:-rentas}

# La de MANTENIMIENTO: la unica que existe siempre —en un cluster recien inicializado y en
# los dos que ya corren— y la unica que no es de ningun sistema. La sonda del motor la usa
# en cada latido.
BASE_DE_MANTENIMIENTO=${BASE_DE_MANTENIMIENTO:-postgres}

# La de Keycloak, separada a proposito (ADR-0005).
BASE_DE_IDENTIDAD=${BASE_DE_IDENTIDAD:-keycloak}

# Las cuatro del producto (ADR-0031).
BASES_DE_LOS_SISTEMAS=${BASES_DE_LOS_SISTEMAS:-"rentas catastro normativa caja"}
