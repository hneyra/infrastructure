# Carga de datos

Los procesos que meten datos en una instalación ya desplegada, y los archivos de ejemplo con que
se prueban. Todos corren el **mismo artefacto** que la aplicación, en el perfil `batch`, como un
Job de un solo uso (ADR-0003): no hay un binario de carga aparte que pueda divergir del que
atiende peticiones.

Hay tres familias, y la diferencia no es de forma sino de **qué se puede afirmar del dato**:

| Familia | Qué escribe | Guarda |
|---|---|---|
| **Valores normativos** — `publicar-parametros.sh`, `publicar-cuadros.sh`, `abrir-conjunto-parametros.sh`, `cargar-arancel-vial.sh` | Cifras que la ley o la ordenanza fijan | Doble firma del corpus (ADR-0007), rol `rol_carga_parametros`, conjunto sellado |
| **Padrón real de una municipalidad** — `cargar-catalogo-vial.sh`, `cargar-sectores.sh`, `cargar-manzanas.sh`, `cargar-cajas.sh`, `cargar-predios.sh` | Su territorio, su ventanilla y **sus lotes**, que son datos suyos | Ninguna marca de demostración: no hay nada inventado que impedir. La guarda es el propio archivo, que la municipalidad aporta |
| **Municipalidad de demostración** — `sembrar-demostracion.sh` y los diez `cargar-*` que orquesta | Personas, predios, vehículos y saldos **inventados** | `municipalidad.es_demostracion = true`, comprobado contra la base antes de leer una fila |

**Ninguna cifra normativa entra por la segunda familia**, y es lo único que no se negocia en este
directorio. Un arancel, un valor unitario o un tramo del predial inventados se distinguen de los
reales solo por quien los puso; una vez en la base, producen deuda mal calculada en todo un padrón.
Por eso la siembra de demostración no pone ni una: las pantallas que necesitan valores sellados
tienen que seguir diciendo «sin conjunto sellado» mientras D-02a esté abierta.

## La municipalidad de demostración

```bash
./sembrar-demostracion.sh --ambiente stg --municipalidad-id 4
```

Nueve pasos, en el único orden en que se pueden dar. No es documentación: cada archivo nombra por
código algo que otro tuvo que escribir antes, y la fila que nombre algo inexistente **se rechaza**
—no revienta la carga, se rechaza sola y la siguiente entra—. Ejecutados en desorden el resultado
no es un error ruidoso, es un «0 nuevas, N rechazadas» que se puede leer por encima.

| # | Guión | Archivo | Depende de |
|---|---|---|---|
| 1 | `cargar-catalogo-vial.sh` | `ejemplos/vias.csv` | — |
| 2 | `cargar-sectores.sh` | `ejemplos/sectores.csv` | — |
| 3 | `cargar-manzanas.sh` | `ejemplos/manzanas.csv` | el sector |
| 4 | `cargar-cajas.sh` | `ejemplos/cajas.csv` | — |
| 5 | `cargar-contribuyentes-demo.sh` | `ejemplos/contribuyentes.csv` | — |
| 6 | `cargar-fichas-demo.sh` | `ejemplos/fichas.csv` | sector, manzana, vía y contribuyente |
| 7 | `cargar-detalle-fichas-demo.sh` | `ejemplos/detalle-de-fichas.csv` | la ficha del predio, que **versiona** |
| 8 | `cargar-vehiculos-demo.sh` | `ejemplos/vehiculos.csv` | el contribuyente |
| 9 | `cargar-transferencias-demo.sh` | `ejemplos/transferencias.csv` | el predio y el vehículo |
| 10 | `cargar-deuda-demo.sh` | `ejemplos/deuda.csv` | contribuyente, predio y vehículo |

Los pasos 5 a 10 **exigen `municipalidad.es_demostracion = true`**, comprobado contra la base por
cada proceso —no por el guión— antes de leer una sola fila. Un `--municipalidad-id` equivocado en
un dígito no siembra ocho personas que no existen en el padrón de una municipalidad que ya opera, y
aquí no se borra nada (RNF-051). Los pasos 1 a 4 no la exigen: un catálogo vial, un sector y una
ventanilla son estructura real, y ese mismo mecanismo es por el que un día entrará el catálogo de
verdad.

### Cómo entra el padrón de una municipalidad de verdad (ADR-0021, #400)

```bash
# 1. Del GeoPackage del plano al CSV, y leer el resumen ANTES de cargar nada
python3 ../../scripts/catastro/importar_predios_gpkg.py PLANO.gpkg --listar
python3 ../../scripts/catastro/importar_predios_gpkg.py PLANO.gpkg \
    --tramos UBIGEO,SECTOR,MANZANA,LOTE,EDIF,ENTRADA,PISO,UNIDAD \
    --direccion DIRECCION --tipo-fijo URBANO \
    --sector SECTOR --manzana MANZANA --lote LOTE --salida ./carga
cat ./carga/resumen.txt

# 2. Cargarlo
./cargar-predios.sh --ambiente stg --municipalidad-id 4 --archivo ./carga/predios.csv
```

**Esto no existía, y su ausencia era del mismo tipo que la de la `caja`.** `ImportarFichas` sabe
cargar predios desde un archivo desde #290, y el único proceso que lo llamaba era
`CargarFichasDeDemostracion`, que exige `es_demostracion = true`: una instalación real **no tenía
por dónde poblar su catastro**. El caso de uso estaba y no había quien lo llamara.

Tres cosas de este camino que conviene entender:

- **Los lotes entran sin ficha, y está bien.** El plano da el lote —su código, su ubicación y su
  polígono— y no dice el área construida, ni el uso, ni las categorías, ni quién es el titular:
  eso lo levanta un técnico en campo o lo declara el contribuyente después. Esos predios son la
  **cola de saneamiento**, y se ven en `GET /catastro/predios?fichado=false`.
- **Sobre un predio que ya existe, el plano solo pone el polígono.** No reescribe la dirección ni
  la ubicación: eso lo corrigió alguien en ventanilla con su observación, y un archivo que lo
  pisara borraría ese trabajo. Reimportar el plano es el caso corriente, no el raro.
- **El área del polígono no es el área imponible** (ADR-0021). La imponible es la de la ficha, la
  que midió el técnico. Que no coincidan es un hallazgo que se informa, no una corrección que se
  aplica.

El guión de conversión **se comprueba a sí mismo** (`--autoprueba`) y esa comprobación corre en CI,
que es lo que su hermano de aranceles no tiene: una verificación escrita que nunca se ejecuta no
protege nada (#188).

### Cómo entra el padrón que la municipalidad ya tiene, en Excel

```bash
# 1. Ver qué trae el libro, que es lo primero que hay que saber
python3 ../../scripts/catastro/importar_padron_armonizacion.py PADRON.xlsx --listar

# 2. Convertir, y LEER el resumen antes de cargar nada
python3 ../../scripts/catastro/importar_padron_armonizacion.py PADRON.xlsx \
    --ubigeo 200105 --salida ./carga
cat ./carga/resumen.txt

# 3. Cargar, en este orden y no en otro
./cargar-catalogo-vial.sh       --ambiente stg --municipalidad-id 9 --archivo ./carga/vias.csv
./cargar-sectores.sh            --ambiente stg --municipalidad-id 9 --archivo ./carga/sectores.csv
./cargar-manzanas.sh            --ambiente stg --municipalidad-id 9 --archivo ./carga/manzanas.csv
./cargar-contribuyentes-demo.sh --ambiente stg --municipalidad-id 9 --archivo ./carga/contribuyentes.csv
./cargar-fichas-demo.sh         --ambiente stg --municipalidad-id 9 --archivo ./carga/fichas.csv
```

En la marcha blanca local no hay clúster, así que los cinco pasos son el mismo artefacto con el
perfil `batch` y las mismas propiedades, lanzado con compose (una variable por propiedad, con los
guiones del nombre quitados):

```bash
cd ../../despliegue
docker compose run --rm --no-deps -v /ruta/al/carga:/datos:ro -e SPRING_PROFILES_ACTIVE=batch \
    -e SGTM_CARGAVIAL_MUNICIPALIDADID=9 -e SGTM_CARGAVIAL_ARCHIVO=/datos/vias.csv \
    -e SGTM_CARGAVIAL_USUARIODELPROCESO=carga-padron -e 'SGTM_CARGAVIAL_OBSERVACION=…' \
    aplicacion
```

Se corre sobre el servicio `aplicacion` y no sobre `implantacion`, y no es indiferente: aquel trae
en su entorno las `SGTM_IMPLANTACION_*` del `.env`, así que la carga arrastraría de paso una
reimplantación de **otra** municipalidad —la del archivo, no la del `--municipalidad-id`—.

El plano (`importar_predios_gpkg.py`) da el lote; **el padrón da a quién se le cobra**, y llega
siempre en la misma hoja de cálculo: el «Formato Padrón Municipal Armonización» del MEF, con sus
hojas `CONTRIBUYENTE `, `PREDIO URBANO` y `CONSTRUCCIONES`. `ImportarContribuyentes` e
`ImportarFichas` saben leer un CSV desde #290 y entre las dos cosas no había nada.

Cuatro cosas de este camino que conviene entender antes de correrlo:

- **El código del predio se conserva, y eso decide todo lo demás.** El código de referencia
  catastral se **compone** de las diez columnas de tramo, así que lo que llega a la base es la
  concatenación de esas columnas. El código que trae el padrón también son 23 dígitos y también
  empieza por el ubigeo, pero por dentro es `ubigeo(6) + correlativo(8) + uso(6) + sufijo(3)`: sus
  posiciones 7-8 **no** son el sector. Aun así el guion parte ese código, porque dejar en blanco
  las columnas de sector y manzana no deja el dato fuera —**lo cambia**: `componer` rellena con
  ceros y miles de predios distintos colapsarían en el mismo código—. La consecuencia hay que
  decirla en voz alta: los sectores y manzanas que salen **no son los levantados en campo**, son
  tramos del código, y `sectores.csv` lo dice de sí mismo. La sectorización de verdad está en el
  padrón como texto —96 habilitaciones urbanas, con su cruce contra el catálogo oficial a
  medias— y conciliarla es otro trabajo.
- **Un predio sin titular se carga; un titular inventado, no.** `InscribirFicha` admite la ficha
  sin titular —en un levantamiento catastral fichar antes de identificar al propietario es lo
  normal—, pero rechaza la ficha **entera** si el `codigoContribuyente` no existe. Así que el guion
  simula qué contribuyentes va a aceptar el importador y solo referencia esos: lo demás sale con
  las cuatro columnas de titular vacías, y el resumen dice cuántos y por qué.
- **Lo que no es ninguna de las palabras del dominio no se traduce a la parecida** (la lección de
  #427 con «ACTIVA» y VIGENTE). `NO ESPECIFICADO`, `OTROS` y `LITIGIO` no son ninguna de las seis
  de `CondicionDeTitularidad`: esos predios entran sin titular en vez de con un `POSEEDOR` puesto
  por comodidad, que afirmaría una posesión que nadie declaró.
- **Las construcciones no entran, y no es un descuido.** `Construccion.anioConstruccion` es un
  `Ejercicio` y `Ejercicio` va de 1990 a 2100 —es el tipo del ejercicio *tributario* reutilizado
  como año de construcción—, y el adobe de los setenta es lo más corriente del distrito. Cargar
  solo las posteriores a 1990 dejaría fichas con la mitad de sus pisos y ninguna cifra lo diría.

El guion **se comprueba a sí mismo** (`--autoprueba`), con un XLSX que construye él mismo con la
forma real del formato: la cabecera en la fila 8, el nombre de hoja con el espacio final, y las
cuatro decisiones de arriba medidas una a una.

### Cómo nace un `area` y una `caja` (#430)

**El paso 4 lo añadió #430, y no es un adorno.** Hasta entonces *nada* creaba una `caja` ni un
`area` fuera de las fixtures de prueba: las dos tablas existen desde `V3`, `sgtm_app` puede
escribirlas desde `V7`, `AbrirCaja` sabe abrir el turno de un cajero en una de ellas… y una
municipalidad recién implantada no tenía ninguna. El resultado era una instalación con padrón,
predios y deuda que **no podía cobrar**: la primera cobranza del día fallaba con `CajaInexistente`
y no había forma de arreglarlo desde dentro del sistema. Lo destapó ejecutar la siembra entera
contra PostgreSQL, no una revisión.

Se resuelve por donde entra esta clase de dato y no con una pantalla, por dos razones que conviene
dejar escritas:

- **Ninguna de las diez opciones de Tesorería del manual da de alta una caja** (NEG-03): cobran,
  cierran, anulan y consultan. Publicar un endpoint que ninguna pantalla llama sería inventar
  contrato, que es justo lo que `AbrirCaja` evita al no tener ruta propia.
- **Las ventanillas y sus áreas son configuración de la municipalidad**, como el catálogo vial y
  los sectores. Vienen del cuadro de organización y del correlativo de recibos que la
  municipalidad ya usa; no se inventan aquí. Por eso `cargar-cajas.sh` **no exige**
  `es_demostracion`: es el mismo camino por el que entrarán las cajas de una municipalidad real.

`cajas.csv` es `codigo,nombre,serie,codigoArea,nombreArea`. `serie` es la que numera los recibos de
esa ventanilla y es única en la municipalidad (`caja_serie_uq`, `V29`) — dos municipios que numeran
«001» no se estorban, porque la unicidad es por municipalidad como todo lo demás. Las dos últimas
columnas admiten quedar vacías: la caja tributaria general no imputa a ninguna área (`area_id` es
*nullable* desde `V3`). Si el área todavía no está registrada, la fila tiene que decir cómo se
llama; si ya existe, se reutiliza y el archivo **no** le reescribe el nombre.

Lo que sigue sin resolverse por aquí es **dar de baja** una caja: `activa = false` es la operación
que el manual no dibuja en ninguna pantalla y que nadie ha necesitado todavía. Cuando haga falta,
va con su acto y su observación, nunca con un `DELETE` (RNF-051).

Repetir un paso **no duplica**: las filas ya cargadas se rechazan una a una por violar su unicidad.
`--desde N` retoma una siembra interrumpida.

### Qué escenario cubre el juego de datos

16 contribuyentes, 23 predios con sus 45 versiones de ficha, 8 vehículos, 7 transferencias y 54
obligaciones en el libro. No es un volumen de prueba de carga: es una **cobertura de casos**, elegida para que cada pantalla que
lee datos tenga delante el caso que existe para tratar.

**Catastro y titularidad**

- Contribuyentes con **uno, dos, tres y cuatro predios** (`C-000002`, `C-000013`, `C-000007`,
  `C-000014`). El de cuatro es el de mayor base del padrón, y existe porque la base del predial es
  **por contribuyente y no por predio** (NEG-05 §1): con un predio por persona esa distinción no se
  puede ni mirar.
- Las **cuatro clases de ficha** —única, económica, bienes comunes y rural— y las dos clases de
  predio, urbano y rústico.
- Titularidad en sus seis condiciones: propietario único, copropietario, cónyuge, poseedor,
  sucesión y —tras una transferencia— copropiedad producida.
- Un **predio sin titular** (`Calle Tacna 82`). No es un descuido: en un levantamiento catastral es
  lo normal fichar antes de identificar al propietario, y es el único modo de que la conciliación
  catastro↔rentas (ADR-0015) y la detección de omisos tengan delante su caso.
- Dos departamentos del **mismo edificio**, con sus tramos de edificación, entrada, piso y unidad
  distintos del resto.

**El predio por dentro**

Un predio con ficha pero sin nada dentro es media pantalla vacía, así que `detalle-de-fichas.csv`
llena las cuatro clases de ficha con lo suyo: **22 construcciones** por piso —con su año, material,
estado de conservación, las siete categorías constructivas del manual y su % construido, incluida
una obra al 60 %—, **5 obras complementarias** (cerco, horno, piscina, patios), **5 actividades
económicas** con su CIIU, **3 bienes comunes** con el **reparto entre los dos departamentos**, y
**5 grupos de tierra** rural con su calidad agrológica, su riego y **7 colindantes** por
orientación.

Dos cosas de ese archivo no son detalle sino diseño:

- **La unidad de carga es el predio, no la fila.** Una versión de ficha es atómica —todas las filas
  de un mismo código predial entran en una sola llamada— porque `siguienteVersion` copia de la
  anterior lo que no se le mande, y media versión es una ficha que miente. De ahí que el informe
  cuente *fichas versionadas* y no filas.
- **Versiona, no sobrescribe.** Cada predio acaba con **dos** versiones de ficha: la que inscribió
  `fichas.csv` y ésta. No es un efecto colateral que disculpar, es la invariante del catastro
  ejercitada de verdad, y de paso deja historial que mirar en la pantalla que lo lee.

Un predio se queda fuera a propósito: `Jirón Cusco 900` es un **terreno sin construir**, así que su
ficha conserva cero construcciones. La pantalla tiene que saber dibujar eso, y sin este caso nunca
se le pediría.

**Transferencias y % de un predio**

`fichas.csv` inscribe cada predio con **un** titular, y una segunda fila del mismo predio se
rechazaría —ya tiene ficha vigente—. La copropiedad no se declara: se **produce**, con una
transferencia parcial, que es como ocurre en la realidad. De ahí que el archivo 7 sea el que trae
los casos que más se piden:

| Caso | Dónde |
|---|---|
| Venta **parcial del 40 %** → dos cuotas vivas, 40 % y 60 % | `Calle Grau 133`, `C-000014` → `C-000010` |
| **Cadena de dos ventas** sobre el mismo predio → el titular depende de la fecha por la que se pregunte | `Calle Ayacucho 512`: `C-000013` → `C-000009` (feb) → `C-000010` (jun) |
| Copropiedad **al 50 %** | `Jirón Cusco 900`, `C-000015` → `C-000009` |
| **Anticipo de legítima** del 25 % sobre predio rústico en sucesión | `Fundo Simbila Chico`, `C-000008` → `C-000004` |
| Transferencia de **vehículo** | `ZTR-101` y `ZKS-916` |

La cadena es la que da algo que mirar a la regla 9: preguntar por marzo tiene que devolver a
`C-000009` y no al último dueño.

**Padrón vehicular**

Ocho vehículos, con los años de inscripción repartidos a propósito: `ZTR-101` y `ZQU-880` quedan
**fuera** de los tres ejercicios de afectación en 2026 y los demás dentro. La afectación no es una
columna —se deduce de `Vehiculo.afectoEn`—, así que sin esa mezcla no se puede ver funcionando.

**Deuda**

54 obligaciones: predial por contribuyente en cuatro cuotas, arbitrios por predio, vehicular por
vehículo, y un contribuyente con deuda en **dos ejercicios**. Con eso tienen datos la caja, el
estado de cuenta, la consulta unificada, la ficha 360°, el portal del contribuyente y el panel de
recaudación.

### Qué NO siembra, y por qué

Lo que falta no es una lista de pendientes: cada línea es una decisión.

| No se siembra | Por qué |
|---|---|
| Aranceles, valores unitarios de edificación, tablas de depreciación, valores referenciales de vehículos, tramos y alícuotas del predial | Son **valores normativos**. Entran por `publicar-parametros.sh` / `publicar-cuadros.sh` desde el corpus verificado a doble firma, o no entran (D-02a, D-02b, D-13) |
| Determinaciones —predial, arbitrios, vehicular, alcabala— | Determinar es aplicar reglas, y las reglas siguen bloqueadas por **D-11**: cuatro factores que NEG-05 §0.1 marca sin fuente identificada. Un tramo equivocado produce deuda mal calculada en todo el padrón |
| Deuda de ejercicios **anteriores a 2026** | `cuenta_corriente_asiento` está particionado por ejercicio y solo tiene declaradas 2026 y 2027: una fila de 2024 se rechaza con «no partition of relation found». Es también lo que impide sembrar hoy una cartera coactiva realista |
| Años de construcción **anteriores a 1990** | `Construccion.anioConstruccion` es un `Ejercicio`, y `Ejercicio` admite de 1990 a 2100 —el mismo rango que el dominio `ejercicio` de PostgreSQL—, porque es el tipo del *ejercicio tributario* reutilizado como «año de construcción». Una casa de adobe de 1979, corriente en el distrito, hoy **no se puede fichar** |
| Turnos y recibos | Las **cajas** sí se siembran desde #430 (paso 4, `cargar-cajas.sh`), y con ellas su área: lo que sigue fuera es el turno y lo cobrado. Abrir un turno es un acto de quien atiende —lo hace `AbrirCaja` con su cajero y su fecha— y un recibo es una cobranza: sembrarlos pondría dinero cobrado que nadie cobró |
| Papeletas, licencias, anuncios, expedientes coactivos | Sus importes salen del catálogo de infracciones, del arancel de costas y de los derechos de trámite, que son **ordenanza local** (D-02b) |

El monto de `deuda.csv` **no cae en ninguna de esas casillas**, y conviene decir por qué: no lo
calcula nadie, entra como dato, igual que entraría el saldo de la base anterior el día que se cierre
D-04. Es el mismo acto que la pantalla «Alta de deuda» publica (RF-043), donde el importe lo teclea
quien atiende y el sistema no lo discute. Lo que esas filas **no** hacen es emitir ninguna
resolución de determinación ni escribir en `determinacion`: la deuda se cobra y se lee, pero el
sistema no reclama haber aplicado ninguna regla para llegar a ella. La alternativa —inventar los
tramos para que «cuadre»— produce cifras indistinguibles de las de una determinación real.

## Valores normativos

La secuencia de un ejercicio, en cuatro pasos y en este orden:

```bash
# 1. abrir el conjunto del ejercicio -> anotar el CONJUNTO_ID que imprime
./abrir-conjunto-parametros.sh --ambiente stg --municipalidad-id 4 --ejercicio 2026

# 2. publicar los valores (corre como rol_carga_parametros, con la doble firma del corpus)
./publicar-parametros.sh --ambiente stg \
  --archivo ../../docs/10-negocio/valores-normativos/publicacion/parametros-2026.csv
./publicar-cuadros.sh --ambiente stg \
  --archivo ../../docs/10-negocio/valores-normativos/publicacion/cuadros-2026.csv

# 3. el arancel vial de la municipalidad, contra ese conjunto
./cargar-arancel-vial.sh --ambiente stg --municipalidad-id 4 --conjunto-id N --archivo arancel_2026.csv

# 4. sellar. Irreversible: un conjunto sellado no se modifica (V9)
./abrir-conjunto-parametros.sh --ambiente stg --municipalidad-id 4 --conjunto-id N \
  --archivo ../../docs/10-negocio/valores-normativos/publicacion/parametros-2026.csv --sellar
```

**El paso 4 tiene una lista antes**, y no es burocracia: `conjunto_sellado_uq` admite **un solo**
conjunto sellado por ejercicio y municipalidad, y el disparador de `V9` no deja añadirle una cifra
más. Un sello prematuro no se corrige: obliga a rehacer el ejercicio entero, y mientras tanto nadie
lee nada, porque la lectura exige `estado = 'SELLADO'`. La lista está en
[`publicacion/README.md` §«Antes de sellar»](../../docs/10-negocio/valores-normativos/publicacion/README.md).

**Y hoy la respuesta de esa lista es que no.** Los pasos 1 a 3 se corrieron de verdad contra `stg`
el 2026-08-29 —`PUBLICADAS=22 RECHAZADAS=0` de parámetros y `PUBLICADAS=492 RECHAZADAS=0` de la
depreciación—, y el 4 **no**: al conjunto de 2026 le faltan los valores unitarios (H-14, sin camino
de carga), el `% actualización` (D-11, sin fuente) y todo lo de ordenanza local (D-02b).

**Antes del paso 2, en un ambiente que ya existía**, hay además un paso operativo que no está en esta
secuencia porque no es de carga: `secretos/asignar-claves.sh --ambiente stg`. La credencial de
`rol_carga_parametros` la asigna `20-asignar-claves.sh` **al inicializar el motor**, así que en un
clúster creado antes de que ese rol existiera el `Secret` está y la base no sabe nada. Los dos
guiones de publicación lo comprueban y se paran nombrando el remedio (#435).

Los pasos 2 y 4 llevan **el mismo archivo**, y no es comodidad: con dos, el día que alguien añade
una fila a uno y se olvida del otro, el conjunto se sella sin ese valor y nadie lo nota hasta que
una regla lo pide. Y ese archivo **no se escribe a mano**: es el derivado del corpus, y
`docs/10-negocio/verificar-publicacion.mjs` comprueba en cada PR que cada cifra esté letra por letra
en el archivo verificado que la fila nombra.

## Probarlo sin clúster

Todos los guiones de este directorio hablan con Kubernetes. Para recorrer las pantallas en local, la instalación entera
—motor, migración y aplicación, ya **marcada como de demostración**— la levanta el `compose` de
[`despliegue/`](../../despliegue/README.md), y la siembra es el **mismo artefacto** con el perfil
`batch` y una variable por paso:

```bash
cd ../../backend && ./gradlew :sgtm-aplicacion:bootJar

export SPRING_PROFILES_ACTIVE=batch
export SGTM_DB_URL=jdbc:postgresql://localhost:5432/sgtm
export SGTM_DB_USUARIO=sgtm_app SGTM_DB_CLAVE=…

E=../infra/carga-de-datos/ejemplos
J=sgtm-aplicacion/build/libs/sgtm.jar
SGTM_CARGAVIAL_MUNICIPALIDADID=1            SGTM_CARGAVIAL_ARCHIVO=$E/vias.csv            java -jar $J
SGTM_CARGASECTORES_MUNICIPALIDADID=1        SGTM_CARGASECTORES_ARCHIVO=$E/sectores.csv    java -jar $J
SGTM_CARGAMANZANAS_MUNICIPALIDADID=1        SGTM_CARGAMANZANAS_ARCHIVO=$E/manzanas.csv    java -jar $J
SGTM_CARGACAJAS_MUNICIPALIDADID=1           SGTM_CARGACAJAS_ARCHIVO=$E/cajas.csv          java -jar $J
SGTM_CARGACONTRIBUYENTESDEMO_MUNICIPALIDADID=1 SGTM_CARGACONTRIBUYENTESDEMO_ARCHIVO=$E/contribuyentes.csv java -jar $J
SGTM_CARGAFICHASDEMO_MUNICIPALIDADID=1      SGTM_CARGAFICHASDEMO_ARCHIVO=$E/fichas.csv    java -jar $J
SGTM_CARGADETALLEFICHASDEMO_MUNICIPALIDADID=1 SGTM_CARGADETALLEFICHASDEMO_ARCHIVO=$E/detalle-de-fichas.csv java -jar $J
SGTM_CARGAVEHICULOSDEMO_MUNICIPALIDADID=1   SGTM_CARGAVEHICULOSDEMO_ARCHIVO=$E/vehiculos.csv java -jar $J
SGTM_CARGATRANSFERENCIASDEMO_MUNICIPALIDADID=1 SGTM_CARGATRANSFERENCIASDEMO_ARCHIVO=$E/transferencias.csv java -jar $J
SGTM_CARGADEUDADEMO_MUNICIPALIDADID=1       SGTM_CARGADEUDADEMO_ARCHIVO=$E/deuda.csv      java -jar $J
```

Cada proceso se enciende **solo** si su propiedad `…_ARCHIVO` está puesta
(`@ConditionalOnProperty`), así que el mismo contenedor —o el mismo `jar`— sirve para los diez y no
hace nada de más. El `--municipalidad-id` es el que imprimió la implantación, y tiene que ser el de
una municipalidad marcada como de demostración: si no, los pasos 5 a 10 se paran sin escribir nada.
