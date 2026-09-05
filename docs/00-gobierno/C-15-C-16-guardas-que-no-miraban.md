# C-15 y C-16 — dos guardas que decían que sí sin mirar

**Estado:** aplicado. `normativa` en `dd8b0ed`; `infrastructure`, en este cambio.

Las dos correcciones son el mismo defecto con dos caras. Una comprobación existe para separar dos
situaciones; cuando deja de mirar una parte del sujeto, sigue contestando —y su respuesta es la
tranquilizadora—. El síntoma no es un rojo: es un verde que no significa nada, y un verde que no
significa nada se lee exactamente igual que uno que sí.

| | Qué prometía | Qué miraba | Qué contestaba |
|---|---|---|---|
| **C-15** | «el archivo de filas es el que el corpus firmó, byte a byte» | unos bytes que sólo existían en un disco | verde en local, **rojo en cualquier clon** |
| **C-16** | «el stack cabe en su nodo» | uno de los cinco espacios de nombres | **«cabe»**, faltando 3 232Mi |

---

## C-15 · El sha256 firmado era de unos bytes que git no conservaba

### 1. Lo medido

El CI de `normativa · Documentación` falló en `verificar-cuadros.mjs`. Reproducido y ampliado:

```
docs/10-negocio/valores-normativos/fuentes/tvr-2026/tvr-2026.csv
  en el disco   1 552 103 bytes, 18 044 CR  ->  sha256 239a75a0…   (el que el corpus firma)
  en git        1 534 059 bytes,      0 CR  ->  sha256 f9369989…   (el que ve cualquier clon)
  diferencia    18 044 bytes = exactamente uno por línea
  core.autocrlf = input  (global de la máquina, sin valor local en ningún repositorio)
```

Es **el único** archivo afectado: se barrieron los 60 archivos que git versiona bajo
`valores-normativos/` comparando `git hash-object` con filtros y sin ellos, y sólo diverge éste.

**Y el archivo histórico lo desmiente en la dirección útil.** El blob de `sgtm` para ese mismo
archivo —commit `d6cb578`, 28 de agosto— **sí trae los 18 044 CR** y su sha256 es `239a75a0…`. O
sea que los bytes no se perdieron al extraer el cuadro del PDF: se perdieron **al re-commitearlo
en el repositorio nuevo**, el 4 de setiembre, con `core.autocrlf=input` ya activo. La firma
dependía de un ajuste de máquina que cambió por debajo, y nada lo dijo.

### 2. La decisión, y por qué no la otra

Las dos salidas dejan la cadena consistente:

- **`.gitattributes` con `-text`** — git no toca un byte, y los bytes firmados son los que viajan.
- **Normalizar a LF y recalcular el sha256** — el archivo cambia, y con él su huella.

Se toma la primera, y el motivo no es de comodidad: **la segunda toca la cadena de firmas**. La
huella de un cuadro normativo la verifican dos personas a mano (ADR-0007, RNF-092) y el archivo
del corpus la escribe; recalcularla es re-firmar, y re-firmar no es un acto mecánico que quepa en
una corrección de CI. Aquí, además, lo que estaba mal **no era el archivo**: era que git no lo
conservara.

```
docs/10-negocio/valores-normativos/** -text
```

`-text` y no `binary`: el diff sigue siendo legible, que es lo que hace revisable una edición nueva.

Los bytes vuelven al blob con `git add --renormalize .`, y el blob resultante tiene sha256
`239a75a0…`, idéntico al que `sgtm` archiva.

### 3. Probado en un clon limpio, que es donde el defecto se ve

`git clone --no-local` a un directorio temporal, tres veces:

| Clon | bytes / CR | sha256 | `verificar-cuadros.mjs` |
|---|---|---|---|
| del estado **anterior** (`HEAD~1`) | 1 534 059 / 0 | `f9369989…` | **rojo**, con el mensaje exacto del CI |
| del estado **arreglado** | 1 552 103 / 18 044 | `239a75a0…` | verde |
| arreglado, **con `core.autocrlf=true`** | 1 552 103 / 18 044 | `239a75a0…` | verde |

La tercera fila es la que importa más de lo que parece: `.gitattributes` gana al ajuste de la
máquina **en las dos direcciones**, así que la firma deja de depender de dónde se clone.

### 4. La guarda, y por qué son dos comprobaciones

`docs/10-negocio/verificar-bytes-del-corpus.mjs` recorre los 60 archivos que git versiona bajo el
corpus y exige, de cada uno:

1. **que esté declarado** — `git check-attr text` dice `unset`;
2. **que los bytes del disco sean los que git guarda** — `git hash-object` con filtros y sin ellos
   dan el mismo objeto.

La primera parece sobrar y no sobra: sin ella, un derivado nuevo **sin ningún CR** pasa hoy por
casualidad y se rompe en silencio el día que alguien lo regenere en una máquina que escriba CRLF.
La segunda parece redundante con la primera —con `-text` no hay conversión de fin de línea— y
tampoco lo es: **`-text` no impide un filtro `clean`**. El caso real es git-lfs, donde un archivo
del corpus viaja como un puntero de 130 bytes con el sha256 firmado apuntando a algo que no está
en el repositorio.

**Seis muestras** (`verificar-las-muestras-de-bytes.mjs`), cada una en su propio repositorio de
usar y tirar con `core.autocrlf` fijado —porque de que sea un ajuste de máquina vino todo esto—:

| Muestra | Esperado |
|---|---|
| declarado, LF | verde |
| **declarado, CRLF** | **verde** — git lo conserva; lo prohibido no es el CRLF sino que git lo cambie |
| sin declarar, CRLF | rojo (el defecto de C-15, exacto) |
| sin declarar, LF | rojo — nada garantiza que siga sin CR |
| declarado `text eol=lf` | rojo — eso normaliza en vez de conservar |
| declarado `-text` **con un filtro `clean`** | rojo por los bytes |

La segunda fila es la que impide «arreglar» esto normalizando el corpus: si esa muestra no
estuviera, `docs/…/** text eol=lf` pasaría la guarda y rompería la firma.

### 5. Las mutaciones

Cada una aplicada sola sobre la guarda y restaurada **por copia comparada con `cmp`**:

| Rotura | Rojo |
|---|---|
| quitar la comprobación **(1)**, la de estar declarado | **2 de 6** — «sin declarar, LF» pasa a verde, y `text eol=lf` sale rojo **por el motivo equivocado** (lo caza (2)), que la muestra detecta porque exige que el mensaje nombre la causa |
| quitar la comprobación **(2)**, la de los bytes | **1 de 6** — la del filtro `clean` pasa a verde |

Cada una tumba **su** muestra y sólo la suya: es la evidencia de que las dos comprobaciones miden
cosas distintas y ninguna es código muerto.

### 6. Dónde corre

`documentacion.yml`, **antes** de `verificar-cuadros.mjs`, y primero las muestras. El orden es el
hallazgo: recalcular el sha256 de un archivo no dice nada si los bytes del disco no son los que
git conserva.

---

## C-16 · `yarn capacidad` decía «cabe» habiendo mirado un espacio de nombres de cinco

### 1. La causa, y es de las que se leen en el propio código

`manifiestosDeLosSistemas` se extrajo en C-14 con este comentario:

> «Separado de `emitir` para que `capacidad.ts` pueda sumarlos sin pasar por el JSON: hasta C-14
> `yarn capacidad` sólo veía la plataforma…»

**Y `herramientas/capacidad.ts` nunca se cambió.** Siguió llamando a `construirManifiestos` a
secas, que compone únicamente `sgtm-<ambiente>`. La función auxiliar existía, el comentario decía
que se usaba, y no la llamaba nadie: `grep` da un solo consumidor, un archivo de pruebas.

`index.ts` tenía el mismo hueco por el mismo sitio.

### 2. La cifra, medida

Con la corrección, `yarn capacidad` imprime el desglose por espacio de nombres:

```
Ambiente «stg» contra un nodo de 4 / 7Gi:
  permanente     2050m / 6848Mi
  pico arranque  2720m / 10240Mi
  en 5 espacio(s) de nombres, en el pico:
    sgtm-stg                 1770m / 5376Mi
    kamayuk-rentas-stg        300m / 1536Mi
    kamayuk-catastro-stg      250m / 1280Mi
    kamayuk-normativa-stg     200m / 1024Mi
    kamayuk-caja-stg          200m / 1024Mi

  → NO CABE por memoria: faltan 3232Mi (3.16 Gi)
```

```
Ambiente «prod» contra un nodo de 2 / 6029348Ki:
  permanente     2040m / 6816Mi
  pico arranque  2710m / 10208Mi
  → NO CABE por CPU:     faltan 910m (0.91 CPU)
  → NO CABE por memoria: faltan 4480Mi (4.37 Gi)
```

**Estas cifras difieren de las del encargo, y conviene decir por qué.** El encargo sumó
`requests` de todos los contenedores por separado —3 720m / 11 456Mi en `stg`—; medido igual aquí
sale 3 970m / 12 640Mi. Esa suma plana **sobrecuenta**, porque Kubernetes no reserva a la vez los
`initContainers` y los contenedores normales: reserva el **máximo** de las dos fases, que es lo
que `demandaDelPod` implementa. Las cifras de arriba son las de ese modelo —el mismo que el
planificador aplica— y coinciden **al mebibyte** con las que C-14 §6 hueco 3 ya había medido. La
conclusión no cambia: **no cabe**, y por más de 3 Gi.

### 3. Qué se cambió

- **Una sola función compone lo que un ambiente pone sobre el nodo**: `manifiestosDelAmbiente()`
  (plataforma + los cuatro sistemas). La usan `emitir`, `yarn capacidad`, `index.ts` y
  `capacidad.test.ts`. Tener cinco listas compuestas a mano fue la causa; una sola es el arreglo.
- **`DemandaDeUnPod` gana `espacio`**, el espacio de nombres. No es para el informe: es lo único
  que permite comprobar *que se midió todo*.
- **`index.ts` audita todo lo que va al nodo**, no sólo lo que su `ConfigGroup` aplica. El nodo es
  uno; un `pulumi up` de la plataforma sobre un nodo que ya sostiene los cuatro se cuelga igual
  que el del issue #252. De las dos direcciones de error, ésta es la segura: equivocarse por
  estricto detiene un despliegue que habría funcionado **y lo dice, con las cifras**; equivocarse
  por optimista devuelve el colgado en silencio.
- **`verificar-contra-el-planificador.sh` mira los cinco espacios de nombres que aplica.**
  Aplicaba los cinco —`yarn manifiestos` los emite desde ADR-0031— y después buscaba pods
  rechazados en `sgtm-<ambiente>`: podía dar por comprobada la dirección peligrosa habiendo
  mirado una quinta parte. Los namespaces se derivan del propio JSON aplicado, no de una lista.
- **La brecha queda declarada** (`nodeCapacityGapIssue: "1"`, issue
  [#1](https://github.com/hneyra/infrastructure/issues/1)) en los dos stacks. **No silencia
  nada**: `yarn capacidad` sigue diciendo «no-cabe» con las cifras, `--estricto` sigue saliendo
  con código 1 y el paso «El stack cabe en su nodo» sigue deteniendo el despliegue antes de
  invocar a Pulumi. Lo único que la marca cambia es que `index.ts` **avisa** en vez de lanzar,
  para no romper `pulumi preview` en cada PR. Y no se puede quedar puesta de más:
  `capacidad.test.ts` exige que la brecha **siga ahí**.

### 4. La guarda nueva

`capacidad.test.ts` gana tres casos (533 pruebas, antes 530): que el conjunto de espacios de
nombres **medidos** sea exactamente el de los **declarados** —`namespaceName(ambiente)` más
`entornoDe(sistema).namespace` de cada uno de los cuatro, derivados de la misma fuente que compone
el despliegue, no de una lista escrita a mano— y que sean cinco y no uno, para que no pueda pasar
por lista vacía.

Los tres casos históricos que afirmaban cosas del monolito —el nodo justo de 1 900m, los 2 CPU que
`prod` reparte hoy, los 3 de la reserva repartida— pasan a `soloElMonolitoDe()`, con el motivo
escrito: «prod cabe en 2 CPU» no se ha vuelto falsa, ha dejado de ser la respuesta a «¿cabe el
ambiente?».

### 5. Las mutaciones

| Rotura | Resultado |
|---|---|
| **quitar `caja` del cálculo** (`SISTEMAS`) | la cifra cambia: `stg` pasa de 2720m / 10240Mi a **2520m / 9216Mi**, «faltan 3232Mi» pasa a **«faltan 2208Mi»**, y el desglose imprime **4** espacios de nombres |
| **reintroducir el defecto de C-16 en la guarda** (`manifiestosDe` vuelve a `construirManifiestos`) | **5 en rojo**, nombrando los cuatro namespaces que faltan: «expected `['sgtm-stg']` to deeply equal `['kamayuk-caja-stg', …(4)]`». Y con ellas las **dos** de la brecha declarada — «`stg` ya cabe en su nodo: retira `nodeCapacityGapIssue`» —, que es el defecto contado por su otra cara: medir de menos hace que el ambiente parezca que cabe |
| **reintroducir el defecto en la herramienta** (`yarn capacidad`) | dice **«cabe»**, imprime **1** espacio de nombres, y `--estricto` sale con **código 0**: el despliegue se autoriza. Restaurado: «no-cabe» y código 1 |
| contraste, ya existente | un nodo de 8 CPU / 16 Gi —el que INF-01 §2 dimensiona— **sí** admite los cinco espacios de nombres. La comprobación no dice que no a todo |

Cada rotura se aplicó sola y se restauró por copia comparada con `cmp`.

---

## Huecos declarados

1. **`yarn capacidad` necesita ahora los cuatro clones hermanos, y tres trabajos de `infra.yml` no
   los hacen.** `descriptor/sistemas.ts` importa los descriptores de `../<sistema>/…`; el trabajo
   `verificar` ya clona los cuatro con `GH_CLONE_KEY`, y `manifiestos`, `capacidad`,
   `aplicar-stg`, `aplicar-prod` y `previsualizar-*` no. Es el **hueco 4 de C-14**, sin cambios en
   su naturaleza, alcanzando ahora un paso más. `manifiestos` ya estaba en esa situación desde
   ADR-0031. Cerrarlo es mecánico —los cuatro `actions/checkout` con `path:`, como en `verificar`—
   pero obliga a reestructurar el `path` de cada trabajo entero y **no hay forma de ejercitarlo
   sin empujar**: se dejan los pasos marcados con el motivo en el propio `infra.yml`. Ninguno de
   esos trabajos puede correr hoy de todos modos: todos son `needs: verificar`, y `verificar` ya
   depende de los mismos clones.

2. **No se ejecutó `verificar-contra-el-planificador.sh`.** Necesita un clúster `kind`, y el
   Docker de esta máquina es un túnel a un VPS. Lo que sí se comprobó es su sintaxis (`bash -n`)
   y que su lógica de espacios de nombres se deriva del JSON aplicado. Mismo hueco que C-14 §6.2.
   Se corrigió de paso una errata de la clase que #434 encontró: el mensaje de error nuevo usa
   «comillas angulares» y no acentos graves, que dentro de una cadena entre comillas dobles se
   **ejecutan** como orden.

3. **La brecha de capacidad sigue abierta como decisión.** Este trabajo hace que la guarda la
   diga; no decide si el monolito y los cuatro sistemas conviven en el mismo nodo. Eso es ADR-0029
   y D-22, y las tres salidas —nodo dimensionado, menos demanda, menos reserva— las imprime
   `describirCapacidad` cada vez.

4. **Las bajas del corpus anteriores a `.gitattributes` no se pueden auditar hacia atrás.** La
   guarda comprueba el árbol de hoy. Que un archivo del corpus haya viajado alguna vez con otros
   bytes sólo se ve comparando contra `sgtm`, como se hizo aquí a mano para `tvr-2026.csv`.

---

## Lo ejecutado

| Qué | Resultado |
|---|---|
| `normativa` · las ocho comprobaciones de `documentacion.yml` | verdes, **en un clon limpio del remoto de GitHub** |
| `normativa` · backend: `cleanTest test verificarArquitectura verificarAislamiento`, con `--no-build-cache` | **617 pruebas** (613 `test` + 4 `pruebaDeArranque`), 0 fallos, 0 errores, 0 omitidas; `BUILD SUCCESSFUL` |
| `infrastructure` · `yarn verificar` | **533 pruebas** (antes 530: las 3 de la guarda nueva), 25 archivos |
| los cuatro descriptores | rentas 12 · catastro 11 · normativa 11 · caja 12 |
| `yarn manifiestos`, antes y después del refactor | **idénticos byte a byte**: 323 273 bytes en `stg`, 317 062 en `prod`. Lo que cambia es lo que se mide, no lo que se despliega |

**Y una medición de paso, fuera de alcance y anotada porque nadie la había hecho.** Se barrieron
los cinco repositorios comparando `git hash-object` con filtros y sin ellos, archivo por archivo.
Fuera del corpus **sólo diverge `gradlew.bat`** —uno por repositorio, dos en `rentas`—: tiene CRLF
en el disco y LF en el blob, así que un clon en Windows recibe un `.bat` con finales de línea de
Unix. No lo firma nadie y no es un cuadro normativo, así que la guarda de C-15 no lo cubre a
propósito: su promesa es sobre los bytes que el corpus firma. Queda dicho por si algún día alguien
intenta ejecutar ese archivo en Windows.
