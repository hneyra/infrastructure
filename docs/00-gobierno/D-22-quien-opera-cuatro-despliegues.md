# D-22 — Quién opera cuatro despliegues

| Campo | Valor |
|---|---|
| Estado | **CONTESTADA** el 2026-09-04: la opera un equipo central |
| Decide | Dirección del proyecto |
| Registro canónico | [`sgtm/docs/00-gobierno/decisiones-abiertas.md`](../../../sgtm/docs/00-gobierno/decisiones-abiertas.md), fila D-22 |
| Fecha de este documento | 2026-09-04 |

Este documento **no toma la decisión ni la supone**. La pone donde se pueda contestar, con lo
que hay construido medido, porque el momento en que debía tomarse ya pasó.

## 1. Lo que la decisión dice, y la frase que dejó de ser cierta

El registro de decisiones abiertas describe D-22 así:

> **Quién opera cuatro despliegues.** ADR-0003 tenía razón: una municipalidad no opera cuatro.
> Si el producto es multi-municipal y lo opera un equipo central, la objeción se disuelve; si
> cada municipio se autogestiona, no — y entonces **la separación no debe hacerse**.

Y cierra su estado con esto:

> Abierta — condicionada al bloque ADR-0024…0032 (`Propuesto`). **Hoy no bloquea nada: mientras
> ADR-0003 siga vigente el sistema es un monolito modular.**

**Esa última frase ya no describe la realidad.** El sistema no es un monolito modular: son cinco
repositorios con cuatro esquemas, cuatro despliegues declarados y las fronteras verificadas por
una regla que se pone roja cuando alguien las cruza. El registro sigue en `sgtm`, que es el
archivo histórico y no se modifica, así que la corrección vive aquí.

**Y los nueve ADR que lo habilitan siguen en `Propuesto`.** ADR-0024 a ADR-0032 nunca pasaron a
`Aceptado`; ADR-0003 —monolito modular— tampoco se marcó `Obsoleto`, y con razón, porque nadie
aceptó lo que lo reemplazaría. Se ejecutó el corte con su ADR habilitante sin aceptar.

El artefacto que ordenó la secuencia lo dijo con todas las letras, en su última sección:

> Todo este plan depende de D-22 … **conviene tomarla antes de la etapa P1A y no en mitad de la
> P5C.**

## 2. Qué hay construido, medido

No es una estimación: son las cifras que se midieron ejecutando, no leyendo.

| Repositorio | Pruebas | Estado |
|---|---:|---|
| `rentas` | 3 094 | verde |
| `catastro` | 951 | verde |
| `caja` | 669 | verde |
| `normativa` | 602 | verde |
| **los cuatro sistemas** | **5 316** | **0 fallos** |
| `infrastructure` | 366 | verde entero |
| `sgtm` (archivo histórico, intacto) | 3 756 | verde |

Además: cuatro `V1__baseline.sql` con su RLS, sus privilegios y sus disparadores, verificados
con diff de esquema vacío; la plataforma con su descriptor auditado y su grafo de egreso
(`rentas → catastro, normativa, caja`; `catastro → normativa, rentas`; `caja → rentas`;
**`normativa` sin egreso**); los 32 ADR repartidos; y las barreras —`verificarArquitectura`,
`verificarAislamiento` y la regla de frontera— enganchadas en los cinco.

**Nada está publicado.** Los seis repositorios tienen sus commits en local.

## 3. Las dos salidas

### 3.1 Un equipo central opera el producto

La objeción de ADR-0003 se disuelve: «el equipo que mantendrá esto en una municipalidad no opera
doce despliegues» deja de aplicar cuando quien opera no es la municipalidad. Cuatro dueños
funcionales —catastro y rentas son dos gerencias con dos presupuestos y dos ritmos— pasan a ser
un organigrama y no una fantasía.

**Consecuencia**: el corte tiene sentido, ADR-0024…0032 pasan a `Aceptado`, ADR-0003 se marca
`Obsoleto`, y las correcciones C-1…C-9 se ejecutan tal como están planificadas.

### 3.2 Cada municipalidad se autogestiona

La objeción de ADR-0003 sigue en pie, y el artefacto es explícito: **lo correcto es no ejecutar
nada de esto**. Un monolito modular con límites verificados por el build ya da la mayor parte de
la separación sin ninguno de sus costos operativos.

**Consecuencia**: el corte no se despliega. Lo construido no se tira —ver §4—, pero deja de ser
el camino, y las correcciones que sólo tienen sentido con cuatro despliegues (C-5 a C-9) se
paran.

## 4. Qué habría que deshacer, y qué sobrevive a las dos salidas

Esto es lo que hace que la decisión siga siendo barata hoy, y conviene tenerlo separado.

**Sobrevive pase lo que pase:**

- **Los cuatro baselines** y el inventario del corte (GOB-05). Describen el esquema que hay; su
  valor no depende de en cuántos procesos corra.
- **`comun-verificaciones`** y las barreras. Salieron de `sgtm` y hoy `sgtm` las consume; si el
  corte se cancela, el monolito se queda con ellas mejor probadas que antes.
- **Los defectos que el corte destapó y que existían de antes**: el escáner que no veía los
  bloques de texto, el candado de emisión que existía sin estar puesto, la regla de frontera muda
  en un repositorio, `PENDIENTE-CRUCE-06` a medio cerrar, la dependencia de orden en una prueba,
  los baselines que no aplicaban sin su extensión. Ninguno era del corte: el corte los encontró.
- **El reparto de los 32 ADR** y la documentación derivada.

**Habría que deshacer, o dejar sin uso:**

- Los cuatro despliegues declarados y su descriptor.
- Las proyecciones `predio_ref`, `ficha_ref` y `valuacion_predio`, y el buzón de pagos: existen
  porque las claves foráneas se retiraron.
- Los adaptadores HTTP que sustituyeron a llamadas en proceso.
- Las tres migraciones de baja de `rentas` (`V2`, `V6`, `V7`), que son lo que sacó de su base lo
  que se fue.

**Y hay una ventana que se cierra sola.** Mientras no haya padrón real, cualquier base se puede
tirar y rehacer, y por eso deshacer sigue siendo barato. **El día que la municipalidad piloto
cargue su padrón, esa puerta se cierra** (ADR-0032 §3). Que la fecha no esté fijada no significa
que no llegue.

## 5. Qué corrección depende de esta respuesta

| Corrección | ¿Depende de D-22? |
|---|---|
| C-1 los nueve desajustes de frontera | **No.** Son datos malos hoy, en el árbol que existe. *(Hecho: [`C-1-desajustes-de-frontera.md`](C-1-desajustes-de-frontera.md))* |
| C-2 la guarda de extensiones | **No.** Vale para uno o para cinco repositorios |
| C-3 los 36 `NOT VALID NOT VALID` | **No.** Es un defecto del generador de baselines |
| C-4 PostgreSQL 18 | **No.** El monolito tiene el mismo problema |
| C-5 los siete puertos sin ruta | **Sí.** Sólo tienen sentido con `catastro` desplegado aparte |
| C-6 la siembra sin orquestador | **Sí**, en su forma; el defecto de fondo no |
| C-7 lo que impide desplegar | **Sí.** Es literalmente desplegar cuatro |
| C-8 el ingestor de eventos | **Sí**, y es la corrección más cara de todas |
| C-9 la verificación que exige publicar | **Sí** |

**Cuatro de las nueve correcciones no esperan a nadie.** Las otras cinco construyen sobre la
respuesta, y son las caras.

## 6. La respuesta

**2026-09-04 — la dirección del proyecto contesta: el producto lo opera un equipo central**,
no cada municipalidad. Es la salida §3.1.

Con eso, la objeción de ADR-0003 —«el equipo que mantendrá esto en una municipalidad no opera
doce despliegues»— deja de aplicar: quien opera no es la municipalidad, y son cuatro, no doce.

Lo que se hizo el mismo día, y está medido:

| Acto | Dónde |
|---|---|
| **ADR-0024…0032 pasan a `Aceptado`**, los nueve, con la nota de por qué | los cuatro repositorios que los alojan |
| **ADR-0003 pasa a `Obsoleto`**, reemplazado por ADR-0029 | `rentas` |
| C-5…C-9 quedan **desbloqueadas** | ver §5 |

**ADR-0003 no se equivocaba, y su nota lo dice**: cambió el hecho sobre el que se apoyaba, no
el razonamiento. Y **lo que decidió sigue vigente dentro de cada sistema** — `rentas` es un
monolito modular con Spring Modulith y sus límites verificados por el build. Lo que se
reemplaza es que lo sea *todo el producto*.

### Lo que esta decisión NO contesta

- **D-25** sigue abierta, y conviene no confundirla con ésta: cuatro sistemas sobre un k3s de
  un solo nodo **comparten disponibilidad**. Perder el nodo sigue siendo perder los cuatro.
  Que se acepte ADR-0029 no significa que la separación mejore la disponibilidad, porque no lo
  hace: eso cuesta más nodos y un motor por sistema, y es presupuesto.
- **D-23** (`comun-dominio`), **D-17** y **D-20** siguen abiertas y bloquean lo suyo.

### El registro canónico sigue diciendo otra cosa

`sgtm/docs/00-gobierno/decisiones-abiertas.md` conserva D-22 como abierta con su «hoy no
bloquea nada», y **no se corrige**: `sgtm` es el archivo histórico. Este documento es la copia
viva. Que las dos digan cosas distintas es lo esperado desde el corte —la misma divergencia
que `verificar-reparto-adr.py` ahora admite declarada y sigue rechazando sin declarar—, y hay
que reconciliarlo el día que el registro de decisiones se mude.
