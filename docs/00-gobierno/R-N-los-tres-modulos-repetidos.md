# R-N · Los tres módulos con el nombre repetido

**Fecha:** 2026-09-05 · **Alcance:** los cinco repositorios · **Estado:** hecho y medido

La dirección pidió quitar `kamayuk-catastro-catastro`, que «suena raro». Medido, no era uno sino
**tres**, y los tres son el contexto acotado principal de su sistema:

| Módulo | Archivos `.java` | Qué contiene |
|---|---|---|
| `kamayuk-rentas-rentas` → `kamayuk-rentas-nucleo` | 265 | declaración jurada, beneficios, conciliación, proyección del ingestor |
| `kamayuk-catastro-catastro` → `kamayuk-catastro-nucleo` | 240 | predio, ficha versionada, titularidad, geometría, valuación |
| `kamayuk-caja-caja` → `kamayuk-caja-nucleo` | 147 | cobranza, recibo, tasas, arqueo, buzón de salida |

Con el módulo va **su paquete Java**: `kamayuk.<sistema>.<sistema>` → `kamayuk.<sistema>.nucleo`.

---

## 1 · Por qué `nucleo` y no `core`

La dirección propuso «core». **El nombre de un contexto acotado es dominio, y el dominio va en
español** (regla de idioma, heredada de `ADR-0004`): `PapeletaRepository` lleva el patrón en inglés
porque el patrón es técnico, y `Papeleta` va en español porque es negocio. Un contexto acotado está
del lado del negocio. `nucleo` es el equivalente directo, no lleva tilde —Checkstyle la rechazaría
en un identificador— y deja los tres iguales en vez de tres decisiones distintas.

**Y el patrón `kamayuk-<sistema>-<contexto>` de D-N1 no se toca.** Lo que cambió no es el patrón
sino el nombre del contexto. `normativa` no entra en el trabajo porque su contexto ya se llamaba
`parametros`: la repetición sólo aparece donde el sistema tiene un único contexto y se llama igual
que él.

**D-N1 decía «no se renombra ninguno», y esto lo revierte.** No es una contradicción: aquella
instrucción valía **durante** el corte —«no renombrar nada de Java ni de Gradle salvo el paquete
raíz», para que el diff de la extracción se pudiera leer— y el corte terminó en P5E. Queda anotado
en `rentas/docs/00-gobierno/inventario-del-corte.md`, en las dos veces que D-N1 aparece.

---

## 2 · Las dos guardas que fosilizaban, y no se sabía

Ésta es la parte que no era mecánica. **Dos reglas dejaron de mirar donde debían y siguieron en
verde**, y ninguna revisión las habría visto: el síntoma de las dos es BUILD SUCCESSFUL.

### 2.1 `CONTEXTOS_VIGILADOS` — `fiscalizacion` dejó de tener frontera

`ReglasDeArquitectura.SinEscribirFueraDeLaTransferencia` vigila que `fiscalizacion` no escriba en
`catastro`, `rentas` ni el libro fuera de la transferencia (ARQ-01 §3.5, AC 1 de #52). Los contextos
que vigila estaban escritos como sufijos en la librería compartida:

```java
bajoLasDosRaices(List.of(".catastro", ".rentas", ".cuentacorriente"));
```

Bajo la raíz de `rentas`, `.rentas` es `kamayuk.rentas.rentas`. Renombrado el paquete, `estaVigilado`
deja de encontrar **ningún** destino de ese contexto, así que `fiscalizacion` podía depender de
cualquiera de sus tipos —incluido un puerto de escritura— sin que la regla dijera nada.

**Medido.** Con el paquete ya renombrado y la lista intacta, `ArquitecturaTest` de `rentas` daba
`BUILD SUCCESSFUL` **con dos entradas de `tiposAjenosQueFiscalizacionSoloLee` apuntando a un paquete
que ya no existe** (`.rentas.DeclaracionesDelEjercicio`, `.rentas.DeclaracionDelEjercicio`). Si la
regla siguiera mirando, esas dos entradas muertas la habrían puesto roja. Cambiado `.rentas` por
`.nucleo` y con las dos entradas todavía viejas, la regla muerde y nombra los dos tipos:

```
kamayuk.rentas.fiscalizacion.aplicacion.LiquidarFiscalizacion depende de
kamayuk.rentas.nucleo.DeclaracionDelEjercicio, que no esta clasificado: agreguelo a
TIPOS_AJENOS_QUE_SOLO_SE_LEEN si solo lee, o a PUERTOS_DE_ESCRITURA si escribe
```

Arreglado en `ReglasDeArquitectura.java`, con el porqué en su javadoc.

### 2.2 `SISTEMA_DEL_MODULO` — el módulo más grande de `rentas` dejó de revisarse

`NINGUN_SQL_CRUZA_LA_FRONTERA_DE_SISTEMA` reparte los archivos por módulo Gradle, con un mapa que se
consulta así:

```java
return SISTEMA_DEL_MODULO.getOrDefault(modulo, SISTEMA_REPLICADO);
```

**`SISTEMA_REPLICADO` significa «no está a ningún lado de la frontera, así que no puede cruzarla».**
Una clave que deja de coincidir no da error: da *replicado*, y el SQL de ese módulo deja de
revisarse entero.

**Medido, con la mutación aplicada sola y revertida byte a byte.** Con el módulo ya renombrado a
`kamayuk-rentas-nucleo` y la clave del mapa todavía diciendo `kamayuk-rentas-rentas`,
`FronteraDeSistemaTest` daba **BUILD SUCCESSFUL** — con el contexto acotado entero de `rentas`, el
módulo de 265 clases, fuera de la revisión.

**Y aquí no bastaba con arreglar la clave**, porque el mismo agujero se abre con cualquier
renombrado futuro y sigue siendo mudo. Se cierra con una guarda nueva en la librería:
`modulosDelReparto()` en `ConfiguracionDeLasVerificaciones` y la prueba **«ningún módulo del disco se
queda fuera del reparto»** en `FronteraDeSistemaTestBase`. Con la clave vieja puesta, dice:

```
[cada modulo con fuentes de produccion tiene que estar en el reparto: el que no este cae en
SISTEMA_REPLICADO y su SQL deja de revisarse, sin que nada se ponga rojo]
Expecting empty but was: ["kamayuk-rentas-nucleo"]
```

Comprueba **una sola dirección** —todo módulo del disco tiene que estar declarado— y a propósito: la
contraria, que no sobre ninguna clave, no se exige aquí porque los mapas de `catastro` y `caja`
heredaron del monolito claves de módulos que su repositorio no tiene, y esa poda es otro trabajo con
otro criterio. Por omisión está vacío, que es lo correcto para `normativa` y `caja`, que **no**
reparten por módulo: su `sistemaDelArchivo()` devuelve el sistema entero y no hay ninguna clave que
se pueda quedar vieja.

---

## 3 · Las guardas que sí mordieron solas, sin provocarlas

Las tres saltaron al hacer el renombrado, sin ninguna mutación, y **cada una nombró exactamente lo
que faltaba**:

| Guarda | Qué dijo |
|---|---|
| `ModulosTest` (los tres repos) | «no se encuentra `rentas` / `catastro` / `caja`»: el identificador que Spring Modulith detecta es el **último segmento** del paquete, así que renombrar el paquete renombra el módulo |
| `ArquitecturaTest` · regla 10 | las cinco exenciones de `escriturasSinUsuarioQueObserve` de `rentas` (y dos de `catastro`, una de `caja`) están escritas como sufijo `.rentas.aplicacion.…` **sin** el `kamayuk.` delante, así que el `sed` no las tocó y dejaron de eximir. Rojo nombrando cada método |
| `ProhibicionesEnElCodigoFuenteTest` (catastro) | «Expecting path … `kamayuk/catastro/catastro/aplicacion/ActualizarFichaCatastral.java` to exist»: una ruta construida a mano con el paquete dentro |

**Y una guarda que NO mordió, y se anotó en vez de callarla.** `paquetesQueTienenQueExistir()` —el
censo que impide que «hay clases que revisar» se conforme con que haya *algo*— no nombraba el
contexto principal en `rentas` ni en `catastro`: sólo los tres de infraestructura (`compartido`,
`plataforma.tenant`, `dominio`). Renombrar el módulo más grande del sistema era invisible para ella.
`caja` sí lo declaraba desde P5D (`kamayuk.caja.caja.dominio`), y ése es el diseño correcto: se le
añadió `kamayuk.<sistema>.nucleo.dominio` a los otros dos.

---

## 4 · Lo ejecutado

Motor de pruebas: PostgreSQL en `127.0.0.1:55444`. Los cuatro backends con `--no-build-cache
cleanTest build verificarArquitectura verificarAislamiento`, para que ninguna tarea saliera
`FROM-CACHE` ni `UP-TO-DATE` (la lección de #543).

| Qué | Antes | Después |
|---|---|---|
| backends `rentas · catastro · normativa · caja` | 3144 · 993 · 619 · 689 | **3145 · 994 · 620 · 690**, 0 fallos, 0 errores, 0 omitidas |
| `verificarArquitectura` en los cuatro | verde | **verde** |
| `verificarAislamiento` en los cuatro | verde | **verde** |
| descriptores `rentas · catastro · normativa · caja` | 15 · 13 · 13 · 14 | **15 · 13 · 13 · 14** |
| `infrastructure` — `yarn verificar` | 635 (R-A/B) · 647 (medido al empezar) | **648**, 0 fallos |
| `yarn manifiestos --ambiente stg` | `84abc3f9ea8f…d7b7` | **`84abc3f9ea8f…d7b7`** — mismo sha256, 6 147 líneas |

El `+1` de cada backend es la **misma** prueba: la guarda nueva de §2.2, que corre en los cuatro.

**El `diff` de los manifiestos está vacío**, que es el criterio 6: este renombrado es de código y no
puede mover un solo manifiesto.

```
$ diff m-antes.json m-final.json && echo "DIFF VACIO"
DIFF VACIO
$ shasum -a 256 m-antes.json m-final.json
84abc3f9ea8f11907862797cf0475f633be86e0c699de8bca1be9eb5b241d7b7  m-antes.json
84abc3f9ea8f11907862797cf0475f633be86e0c699de8bca1be9eb5b241d7b7  m-final.json
```

*(Lo único que difería en la primera comparación era la línea `Done in 1.23s.` que `yarn` escribe en
`stdout`; se descarta con `grep -v '^Done in '` y entonces los dos archivos son idénticos byte a
byte.)*

### Lo movido

668 archivos renombrados con `git mv` —279 en `rentas`, 241 en `catastro`, 148 en `caja`—, así que
la historia de cada uno se conserva. Ocurrencias del nombre nuevo hoy: `rentas` 815, `catastro` 957,
`caja` 635, `normativa` 2, `infrastructure` 4.

---

## 5 · Lo que quedó del nombre viejo, una por una

El criterio es cero menciones salvo prosa que cuenta la historia. Quedan **catorce**, y son éstas:

| Dónde | Qué es | Por qué se queda |
|---|---|---|
| `infrastructure/docs/…/R-AB…md:298-301` (3) | **transcripción de terminal** de `docker compose ps` | `kamayuk-rentas-rentas-1` es `<proyecto>-<servicio>-1`: el proyecto es `kamayuk-rentas` y el servicio `rentas`. **No es un módulo ni un paquete**, y los nombres de compose son etapa D. Editar una transcripción falsifica una medición |
| `infrastructure/docs/…/R-AB…md:91` (1) | registro de lo que R-A/B renombró | Dice lo que era cierto entonces |
| `infrastructure/librerias-backend/…/ReglasDeArquitectura.java:604` y `ConfiguracionDeLasVerificaciones.java:138` (2) | javadoc de §2.1 y §2.2 | Prosa que cuenta esta historia, y es lo que impide que alguien «arregle» la lista devolviéndola |
| `rentas/docs/…/P5A…md`, `rentas/docs/…/inventario-del-corte.md` (×3), `catastro/docs/…/P5C…md` (×3), `caja/docs/…/P5D…md` (×2) | registros históricos de P5A/P5C/P5D y la decisión D-N1 | Se dejan como se escribieron; cada documento gana **una nota `> R-N (2026-09-05)`** que dice qué se llaman hoy y adónde ir |
| `rentas/docs/…/P5E-cierre.md:118` (1) | salida del escáner de frontera, en bloque de código | Transcripción |
| los tres `ModulosTest.java` y los tres `settings.gradle.kts` (6) | comentario que explica el renombrado | Prosa viva |

Y una más, sin el prefijo `kamayuk` y por eso fuera del criterio literal:
`caja/docs/…/P5D-extraccion.md:274`, una tabla de pruebas por módulo que dice `rentas-rentas`. Es una
medición fechada; se deja.

**El `sed` mecánico hizo mentir a cinco frases, y se revirtieron.** Cinco documentos históricos
decían cosas como «`kamayuk.catastro.catastro` es redundante y es lo que la consistencia produce» o
«Tres módulos … y **no se renombra ninguno**». Renombrados, esas frases pasan a ser falsas o
contradictorias consigo mismas. Se devolvieron al texto original con `git checkout` y se anotaron.
Lo contrario —dejar el `sed`— habría dejado un registro que dice que se decidió algo que no se
decidió.

---

## Huecos declarados

1. **`infrastructure` mide 648 y R-A/B escribió 635, y ninguna de las dos diferencias es de este
   trabajo.** `git status -- infra` está **vacío**: este trabajo no toca un solo archivo bajo
   `infra/`, así que el código que `yarn verificar` ejecuta es byte a byte el de `HEAD`. La primera
   medición de la sesión dio **647** y las tres siguientes 648, y **el salto está atribuido**: la
   rama tenía en paralelo el trabajo de C-20, que aterrizó entre las dos mediciones y toca
   `infra/verificaciones/` —`clones-de-los-hermanos.test.ts` nuevo, `deriva-de-migraciones.test.ts`
   y `checkout-en-el-espacio-de-trabajo.test.ts` modificados—. Se anota porque medir sobre un árbol
   que otro agente estaba moviendo es exactamente la condición en la que una cifra parece decir algo
   que no dice.
2. **La otra dirección del reparto por módulo no se comprueba.** `modulosDelReparto()` exige que todo
   módulo del disco esté declarado, no que no sobre ninguna clave. Los mapas de `catastro` y `caja`
   arrastran del monolito claves de módulos que su repositorio no tiene
   (`kamayuk-catastro-fiscalizacion`, `kamayuk-catastro-cuentacorriente`…). Podarlas es otro trabajo:
   una entrada muerta en una lista es el defecto que la lista existe para no tener, pero aquí no
   apaga nada — sobra, no calla.
3. **`tiposAjenosQueFiscalizacionSoloLee` de `catastro` está entero muerto.** `catastro` declara
   `fiscalizacion` en `ambitosAusentes()`, así que ninguna de sus doce entradas exime nada. Se
   renombraron las que nombran el contexto para que la lista siga siendo legible, y se anota aquí:
   no lo introdujo este trabajo y no lo arregla.
4. **Nada de esto se ha desplegado.** Lo medido son los manifiestos generados; no se corrió ningún
   `pulumi up` ni se tocó ningún clúster. Y no hace falta que se despliegue nada por este cambio: el
   `diff` de manifiestos está vacío.
5. **Las etapas C y D siguen abiertas y no se tocaron**: los roles `sgtm_app`/`sgtm_owner`/
   `sgtm_monitor`/`sgtm_respaldo` (etapa C) y los nombres de recurso de k3s, el proyecto de compose y
   las claves de Pulumi (etapa D).
6. **`.github/workflows/` no se tocó** en ningún repositorio, por instrucción: se estaba editando en
   paralelo.
