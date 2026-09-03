# Archivos de carga de ejemplo

Cinco CSV que dejan un Catastro **poblado** en una instalación de demostración, y un
README que dice de cada uno qué parte es real y qué parte está inventada.

La municipalidad de referencia es **Catacaos** (ubigeo `200104`), la piloto de
[D-01](../../../docs/00-gobierno/decisiones-abiertas.md) —no Sullana, de cuyo manual sale
la especificación funcional—.

## Qué es estructura y qué es ficticio

| Archivo | Qué contiene | Naturaleza | Se carga con |
|---|---|---|---|
| `vias.csv` | 15 vías de Catacaos | **Estructura**: nombres de vía de dominio público | `cargar-catalogo-vial.sh` |
| `cajas.csv` | 5 ventanillas y 3 áreas | **Estructura**: sin ellas la caja no se puede abrir (#430) | `cargar-cajas.sh` |
| `sectores.csv` | 4 sectores | **Estructura** | `cargar-sectores.sh` |
| `manzanas.csv` | 10 manzanas | **Estructura** | `cargar-manzanas.sh` |
| `contribuyentes.csv` | 8 contribuyentes | **Ficticio**: personas inventadas | `cargar-contribuyentes-demo.sh` |
| `fichas.csv` | 10 predios con su primera ficha y su titular | **Ficticio**: predios inventados | `cargar-fichas-demo.sh` |

Los tres primeros son datos de estructura y valen para una municipalidad real: sus
cargadores (`CargarCatalogoVial`, `CargarSectores`, `CargarManzanas`) no preguntan nada
sobre el régimen de la instalación.

Los dos últimos **solo corren contra una instalación de demostración**. Antes de leer una
fila preguntan por `municipalidad.es_demostracion` —la misma fila que decide si un
documento sale marcado, #122— y si la respuesta es «no», no escriben nada:
`SoloEnDemostracion` lo impide. Un `--municipalidad-id` equivocado en un dígito metería
ocho personas que no existen en el padrón de una municipalidad que ya opera, y aquí no se
borra nada (RNF-051): deshacerlo sería dar de baja fila a fila.

## El orden importa

```
vias.csv → sectores.csv → manzanas.csv → contribuyentes.csv → fichas.csv
```

Cada archivo referencia el anterior **por código**, y una fila que nombre algo que todavía
no existe se rechaza —ella sola, sin arrastrar a las que siguen: cada fila abre su propia
transacción—. Cargarlos al revés no deja datos a medias; deja un informe con todas las
filas rechazadas.

## Lo que NO se siembra, y por qué

**Ni aranceles, ni valores unitarios de edificación, ni tablas de depreciación, ni UIT, ni
tramos, ni alícuotas.** No falta hacerlo: no debe hacerse.

- Son **valores normativos** (regla 5, D-02a, D-13). Un arancel inventado no se distingue
  de uno real por su forma, solo por quién lo puso, y una demostración con cifras
  plausibles es exactamente el papel que alguien puede intentar cobrar.
- Las pantallas de arancel, valores unitarios y depreciación **tienen que seguir diciendo
  «sin conjunto sellado»**. Ese mensaje es la respuesta honesta mientras D-02a siga
  abierta, y llenarlas de números lo taparía.
- Ninguna cifra de estos archivos alimenta un cálculo. El área de terreno es una medida
  del predio, no un valor unitario; el `% propiedad` reparte una titularidad, no grava una
  base.

Para cargar aranceles reales, cuando D-02a se cierre, está `cargar-arancel-vial.sh`, que
exige un **conjunto de parámetros ya abierto** y no acepta cifras sueltas. Ese conjunto lo
abre —y, con `--sellar`, lo congela— `abrir-conjunto-parametros.sh`, que imprime el
`conjunto_id` que la carga del arancel espera (#247 §2).

## El código de referencia catastral se compone, no se copia

`fichas.csv` **no tiene una columna con el código entero**. Sus primeras columnas son los
*tramos* —departamento, provincia, distrito, sector, manzana, lote, edificación, entrada,
piso, unidad—, en el orden que declara la composición vigente del dominio
(`ComposicionCatastral.DEL_MANUAL`), y el código lo arma
`CodigoReferenciaCatastral.componer`, que rellena cada tramo con ceros a la izquierda.

**D-10 sigue abierta:** la plantilla del manual da 23 posiciones y los ejemplos del
prototipo de interfaz traen 21, y hasta contrastarlo con fichas reales no hay forma de
saber cuál rige. Con los tramos en columnas, cerrar D-10 cambia el número de columnas de
este archivo y nada más. Con el código escrito entero, cada fila sería una copia de la
plantilla del manual y habría que reescribirlas a mano una a una.

## Los documentos de identidad son falsos a propósito

Los de `contribuyentes.csv` tienen **forma válida y contenido evidentemente falso**: los
DNI van de `00000001` en adelante y los RUC empiezan por `20000000`. Ninguno corresponde a
nadie. Los nombres empiezan por `DEMO` para que se reconozcan en cualquier pantalla y en
cualquier reporte impreso.

El dígito verificador del DNI y del RUC no se valida en el sistema —el algoritmo es de
RENIEC y de SUNAT, y cambia con ellos—, así que estos números pasan la validación de forma
sin parecerse a los de ninguna persona real.

## Comentarios dentro de un CSV

Las líneas que empiezan por `#` son comentarios y el importador las salta, igual que las
líneas en blanco; la numeración de filas que aparece en el informe de rechazos sigue siendo
la línea real del archivo. Es lo que permite que cada archivo lleve encima su propio aviso
en lugar de dejarlo solo aquí: el aviso se separa del archivo la primera vez que alguien lo
copia a su máquina para cargarlo.

## Que estos archivos sigan siendo válidos se verifica

`ArchivosDeEjemploTest` (en `backend/sgtm-catastro`) pasa **cada fila de cada archivo por
el parser real**: formato, enumerados, códigos catastrales bien compuestos y coherencia
sector → manzana → ficha, más el cruce de `fichas.csv` contra los códigos de
`contribuyentes.csv`, `vias.csv`, `sectores.csv` y `manzanas.csv`. Un ejemplo roto no llega
a `main`.
