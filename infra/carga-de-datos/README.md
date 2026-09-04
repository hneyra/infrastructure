# Carga de datos

Los procesos que meten datos en una instalación ya desplegada. Todos corren el **mismo artefacto**
que la aplicación de su sistema, en el perfil `batch`, como un Job de un solo uso (ADR-0003): no hay
un binario de carga aparte que pueda divergir del que atiende peticiones.

Hay tres familias, y la diferencia no es de forma sino de **qué se puede afirmar del dato**:

| Familia | Qué escribe | Dónde vive hoy | Guarda |
|---|---|---|---|
| **Valores normativos** — `publicar-parametros.sh`, `publicar-cuadros.sh`, `abrir-conjunto-parametros.sh` | Cifras que la ley o la ordenanza fijan | **aquí**, y su sitio natural es `normativa` (hueco declarado en [C-6](../../docs/00-gobierno/C-6-la-siembra-orquestada.md)) | Doble firma del corpus (ADR-0007), rol `rol_carga_parametros`, conjunto sellado |
| **Padrón real de una municipalidad** — `cargar-catalogo-vial.sh`, `cargar-sectores.sh`, `cargar-manzanas.sh`, `cargar-predios.sh`, `cargar-arancel-vial.sh`, `cargar-cajas.sh` | Su territorio, su ventanilla y **sus lotes**, que son datos suyos | `catastro` y `caja` | Ninguna marca de demostración: no hay nada inventado que impedir. La guarda es el propio archivo, que la municipalidad aporta |
| **Municipalidad de demostración** — los diez pasos de [`siembra/`](siembra/) | Personas, predios, vehículos y saldos **inventados** | repartidos entre `catastro`, `rentas` y `caja` | `municipalidad.es_demostracion = true`, comprobado **contra la base de su sistema** antes de leer una fila |

**Ninguna cifra normativa entra por la segunda ni por la tercera familia**, y es lo único que no se
negocia en este directorio. Un arancel, un valor unitario o un tramo del predial inventados se
distinguen de los reales solo por quien los puso; una vez en la base, producen deuda mal calculada
en todo un padrón. Por eso la siembra de demostración no pone ni una: las pantallas que necesitan
valores sellados tienen que seguir diciendo «sin conjunto sellado» mientras D-02a esté abierta.

## La municipalidad de demostración

**Los cargadores ya no están aquí: están en sus sistemas.** Lo único que queda en `infrastructure`
es lo que no es de ninguno — **el orden** ([`siembra/pasos.tsv`](siembra/pasos.tsv)), el guion que lo
recorre y la comprobación que lo mide:

```bash
siembra/sembrar-demostracion.sh --ambiente stg --municipalidad-id 4 \
    --url-catastro postgresql://… --url-rentas postgresql://… --url-caja postgresql://…

# sin sembrar nada, solo decir qué hay y qué falta:
siembra/sembrar-demostracion.sh --municipalidad-id 4 --solo-comprobar --url-catastro … --url-rentas … --url-caja …
```

Diez pasos, en el único orden en que se pueden dar, **repartidos entre tres repositorios**. No es
documentación: cada archivo nombra por código algo que otro tuvo que escribir antes, y desde el
corte ese «antes» puede estar **en otra base**.

| # | Sistema | Guion | Archivo | Necesita antes |
|---|---|---|---|---|
| 1 | `catastro` | `cargar-catalogo-vial.sh` | `vias.csv` | — |
| 2 | `catastro` | `cargar-sectores.sh` | `sectores.csv` | — |
| 3 | `catastro` | `cargar-manzanas.sh` | `manzanas.csv` | 2 |
| 4 | `caja` | `cargar-cajas.sh` | `cajas.csv` | — |
| 5 | `rentas` | `cargar-contribuyentes-demo.sh` | `contribuyentes.csv` | — |
| 6 | `catastro` | `cargar-fichas-demo.sh` | `fichas.csv` | 1, 2, 3 **y 5, que es de `rentas`** |
| 7 | `catastro` | `cargar-detalle-fichas-demo.sh` | `detalle-de-fichas.csv` | 6 |
| 8 | `rentas` | `cargar-vehiculos-demo.sh` | `vehiculos.csv` | 5 |
| 9 | `rentas` | `cargar-transferencias-demo.sh` | `transferencias.csv` | 6 **y** 8 |
| 10 | `rentas` | `cargar-deuda-demo.sh` | `deuda.csv` | 5, 6, 8 y 9 |

Los pasos 5, 6, 7, 8, 9 y 10 **exigen `municipalidad.es_demostracion = true`**, comprobado contra la
base **de su propio sistema** por cada proceso —no por el guion— antes de leer una sola fila. Un
`--municipalidad-id` equivocado en un dígito no siembra personas que no existen en el padrón de una
municipalidad que ya opera, y aquí no se borra nada (RNF-051). Los pasos 1 a 4 no la exigen: un
catálogo vial, un sector y una ventanilla son estructura real, y ese mismo mecanismo es por el que un
día entrará el catálogo de verdad.

### Por qué el orden vive aquí y los cargadores no

Porque el orden es un hecho **entre** sistemas. Escribirlo dentro de uno lo pondría donde su dueño no
puede ver a los otros dos, que es exactamente el defecto que [C-2](../../docs/00-gobierno/C-2-guarda-de-extensiones.md)
cerró para las extensiones. `infrastructure` es donde viven las barreras que verifican a los cuatro
sistemas ([ADR-0031](../../docs/30-arquitectura/adr/ADR-0031-infraestructura-comun-y-propia.md)).

Cada sistema, en cambio, se queda con **su** guion y **su** CSV, y **una sola copia de cada uno**:
hasta C-6 había hasta tres copias byte a byte del mismo archivo y nada impedía que divergieran.

### Que el silencio se acabe

Cada cargador rechaza fila a fila y sigue: la fila que nombra algo inexistente no revienta la carga,
se rechaza sola. Eso es correcto —una fila mala no puede llevarse por delante a las buenas— y tiene
un precio: **sembrado en el orden equivocado, un paso rechaza todas sus filas y termina con código 0**.
Medido contra PostgreSQL 16.15 el 2026-09-05:

```
$ cargar-detalle-fichas-demo.sh …          # el paso 7, sin el paso 6
… 51 fila(s) leidas, 0 ficha(s) versionada(s), 22 predio(s) rechazado(s)
$ echo $?
0
```

Por eso `sembrar-demostracion.sh` corre [`siembra/comprobar-siembra.sh`](siembra/comprobar-siembra.sh)
**después de cada paso** y se para en rojo:

```
X  7/10 catastro  ficha_catastral   0 de 45: FALTAN 45 (el paso 7 necesita antes el/los paso(s) 6)
```

La comprobación cuenta lo que la tabla **tiene**, no lo que el paso **escribió**, y eso no es un
detalle: repetir un paso ya sembrado produce exactamente el mismo «0 nuevas, N rechazadas» que
sembrarlo fuera de orden —medido: las dos corridas imprimen la misma línea— y **tiene** que seguir
en verde, porque es lo que hace que `--desde N` sirva. Contando totales:

- siembra en orden → el total cuadra → verde
- repetir un paso → el total cuadra → **verde**
- sembrar en desorden → el total no cuadra → **rojo, diciendo cuántas faltan**

Y ninguna cifra está escrita a mano: `pasos.tsv` no lleva números, lleva expresiones sobre el propio
CSV que cada paso carga (`vias.csv:filas`, `detalle-de-fichas.csv:distintos:codigoPredial`).

### Lo que hoy impide completar la siembra

Está medido, con su reproducción, en
[C-6](../../docs/00-gobierno/C-6-la-siembra-orquestada.md). En resumen: los pasos 1, 2, 3, 4, 5 y 8
se ejecutaron de verdad y cuadran; el 6, el 7, el 9 y el 10 **no pueden completarse hoy**, y no por
la siembra sino por tres cosas que el corte dejó abiertas —ninguna aplicación arranca sin que se le
aporte un `ObjectMapper`, `catastro` y `caja` no tienen quién implemente `ComprobadorDeAcceso`, y las
dos escrituras que cruzan la frontera (`GestorDeTitularidad.transferir` y el padrón por HTTP sin
token) siguen sin camino—.

### Qué escenario cubre el juego de datos

16 contribuyentes, 23 predios con sus 45 versiones de ficha, 8 vehículos, 7 transferencias y 54
obligaciones en el libro. No es un volumen de prueba de carga: es una **cobertura de casos**, elegida
para que cada pantalla que lee datos tenga delante el caso que existe para tratar. Lo que cada
archivo cubre está descrito en el README de su repositorio:

- [`catastro/infra/carga-de-datos/README.md`](https://github.com/hneyra/catastro/blob/main/infra/carga-de-datos/README.md) — vías, sectores, manzanas, fichas y su detalle
- [`rentas/infra/carga-de-datos/README.md`](https://github.com/hneyra/rentas/blob/main/infra/carga-de-datos/README.md) — padrón, vehículos, transferencias y deuda
- [`caja/infra/carga-de-datos/README.md`](https://github.com/hneyra/caja/blob/main/infra/carga-de-datos/README.md) — ventanillas y áreas

### Qué NO siembra, y por qué

Lo que falta no es una lista de pendientes: cada línea es una decisión.

| No se siembra | Por qué |
|---|---|
| Aranceles, valores unitarios de edificación, tablas de depreciación, valores referenciales de vehículos, tramos y alícuotas del predial | Son **valores normativos**. Entran por `publicar-parametros.sh` / `publicar-cuadros.sh` desde el corpus verificado a doble firma de `normativa`, o no entran (D-02a, D-02b, D-13) |
| Determinaciones —predial, arbitrios, vehicular, alcabala— | Determinar es aplicar reglas, y las reglas siguen bloqueadas por **D-11**. Un tramo equivocado produce deuda mal calculada en todo un padrón |
| Deuda de ejercicios **anteriores a 2026** | `cuenta_corriente_asiento` está particionado por ejercicio y solo tiene declaradas 2026 y 2027 |
| Años de construcción **anteriores a 1990** | `Construccion.anioConstruccion` es un `Ejercicio`, y `Ejercicio` admite de 1990 a 2100 |
| Turnos y recibos | Las **cajas** sí se siembran (paso 4): lo que sigue fuera es el turno y lo cobrado. Sembrarlos pondría dinero cobrado que nadie cobró |
| Papeletas, licencias, anuncios, expedientes coactivos | Sus importes salen del catálogo de infracciones, del arancel de costas y de los derechos de trámite, que son **ordenanza local** (D-02b) |

El monto de `deuda.csv` **no cae en ninguna de esas casillas**: no lo calcula nadie, entra como dato,
igual que entraría el saldo de la base anterior el día que se cierre D-04. Es el mismo acto que la
pantalla «Alta de deuda» publica (RF-043), donde el importe lo teclea quien atiende y el sistema no
lo discute. Lo que esas filas **no** hacen es emitir ninguna resolución de determinación.

## Valores normativos

La secuencia de un ejercicio, en cuatro pasos y en este orden:

```bash
# 1. abrir el conjunto del ejercicio -> anotar el CONJUNTO_ID que imprime
./abrir-conjunto-parametros.sh --ambiente stg --municipalidad-id 4 --ejercicio 2026

# 2. publicar los valores (corre como rol_carga_parametros, con la doble firma del corpus)
./publicar-parametros.sh --ambiente stg --archivo …/publicacion/parametros-2026.csv
./publicar-cuadros.sh    --ambiente stg --archivo …/publicacion/cuadros-2026.csv

# 3. el arancel vial de la municipalidad, contra ese conjunto (vive en `catastro`)
../../../catastro/infra/carga-de-datos/cargar-arancel-vial.sh --ambiente stg --municipalidad-id 4 --conjunto-id N --archivo arancel_2026.csv

# 4. sellar. Irreversible: un conjunto sellado no se modifica
./abrir-conjunto-parametros.sh --ambiente stg --municipalidad-id 4 --conjunto-id N --archivo … --sellar
```

**El paso 4 tiene una lista antes**, y no es burocracia: `conjunto_sellado_uq` admite **un solo**
conjunto sellado por ejercicio y municipalidad, y el disparador de la migración no deja añadirle una
cifra más. Un sello prematuro no se corrige: obliga a rehacer el ejercicio entero.

**Estos tres guiones son de `normativa`, y siguen aquí.** El corpus que leen se fue a ese repositorio
en P5B, así que sus rutas relativas ya no resuelven desde aquí: moverlos es una decisión de ese
repositorio y está declarada como hueco en C-6.

**Antes del paso 2, en un ambiente que ya existía**, hay además un paso operativo que no es de carga:
`secretos/asignar-claves.sh --ambiente stg`. La credencial de `rol_carga_parametros` la asigna
`20-asignar-claves.sh` **al inicializar el motor**, así que en un clúster creado antes de que ese rol
existiera el `Secret` está y la base no sabe nada. Los dos guiones de publicación lo comprueban y se
paran nombrando el remedio.
