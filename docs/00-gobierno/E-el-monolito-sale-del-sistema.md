# `E` — el monolito sale del sistema

**Estado:** aplicado en `infrastructure`. Los otros cuatro repositorios y `sgtm` **no se tocan**:
su `git status` queda limpio.

La dirección cerró la migración. `stg` había dejado de desplegar el monolito en
[C-19](C-19-stg-pide-lo-minimo.md) —decisión de la dirección, porque no lo usaba nadie y era el
mayor consumidor del ambiente—; lo que faltaba es `prod`, y con él todo el código que lo
gobernaba. Este trabajo lo retira.

> **El resultado, en una línea: `prod` pasa de pedir 2 610m / 9 696Mi a pedir 1 810m / 7 520Mi, y
> de faltarle 810m de CPU a faltarle 10m.** Diecisiete objetos se van de `prod` y **ninguno
> llega**; de los cuatro sistemas no cambia ni un byte.

Y la retirada destapó tres defectos vivos que nadie estaba mirando, porque los tres colgaban de
la base `sgtm` — que existe en los dos ambientes y **no tiene ni una tabla del producto**.

---

## 1. Los criterios, con su medida

| # | Criterio | Estado | Dónde |
|---|---|---|---|
| **1** | El monolito no se compone en ningún ambiente | **Cumplido**: `prod` 101 → 84 objetos, `stg` 94 → 87 | §4 |
| **2** | Nada de los cuatro sistemas ni de la plataforma se va con él | **Cumplido**: 0 objetos nuevos, y los 6/7 que cambian por dentro son los que tenían que cambiar | §4 |
| **3** | Cada arreglo con su mutación, restaurada por copia comparada con `cmp` | **Cumplido**, nueve mutaciones, **una en verde** | §5 |
| **4** | La guarda de #675 sigue midiendo, y mide más que antes | **Cumplido**: de un esquema a cuatro | §3 |
| **5** | Las cifras no bajan, y los rojos se leen contra su línea base | **Cumplido**: `origin/main` 681/1 roja, rama 692/3 | §6 |

---

## 2. Lo que se retira, y lo que la retirada destapó

### 2.1 Lo que se va

- **`backend/` entero**: las 68 migraciones del monolito, su `crear-roles.sql` —el único `.sql`
  que caía en `docker-entrypoint-initdb.d`— y el único `.java` que quedaba en este repositorio.
  La copia entera vive en el clon `sgtm`, que no se borra ni se modifica.
- **`frontend/nginx.conf`** y **`despliegue/compose.yaml`**, que construía un `backend/Dockerfile`
  y un `../frontend` que **no existían aquí desde el corte**: ese compose no se podía levantar.
- **`componentes/Aplicacion.ts`** y **`componentes/Migracion.ts`** (691 líneas), y con ellos la
  bandera `desplegarElMonolito` que C-19 introdujo. Una capacidad con un solo valor posible es una
  rama que nadie ejercita: volver a encenderla no sería una línea, sería recuperar los dos
  componentes.
- **`declarar-version.yml`** y sus dos herramientas, que subían solas
  `applicationBootstrapVersion`. Esa clave era un `sha` de `sgtm` y ya no gobierna ningún `Job` ni
  ningún `Deployment`.

### 2.2 Los tres defectos que colgaban de la base `sgtm`

Ninguno de los tres se buscó: aparecieron al preguntar «¿quién más apunta a esa base?».

**(a) El respaldo diario de `stg` habría fallado entero en su primera corrida.** El `CronJob`
escribía su fila de `respaldo` en la base `sgtm`, donde esa tabla **no existe** —medido contra
`stg` el 2026-09-06: `to_regclass('public.respaldo')` da vacío ahí, y la tabla en las cuatro bases
del corte; `pg_tables` de `sgtm` devuelve **una** fila, `spatial_ref_sys`, que la trae PostGIS—. Su
primer paso es registrar el inicio y `exit 1` si no puede, así que no habría fallado el registro:
habría fallado **la copia**, y el síntoma —«no se pudo registrar el inicio»— no se parece a su
causa.

Pasa a `rentas`. Es una elección y hay que hacerla en algún sitio: una copia es del **clúster**
(#558 lo dejó escrito, y por eso `respaldo` no lleva `municipalidad_id`), pero desde el corte la
plataforma no tiene ninguna base propia. Escribir en las cuatro daría cuatro filas para una sola
copia; no escribir en ninguna deja la copia sin registro, que es lo que RF-126 existe para
impedir. `rentas` porque es la única cuyo `crear-roles.sql` concede `CONNECT` a los cinco roles
del clúster —la que menos supuestos hace sobre quién escribe— y la que un operador abre primero.

**(b) `asignar-claves.sh` se replegaba a `sgtm`.** Cuando una entrada del inventario no declaraba
base, el guion usaba la del monolito. Esa base existe, así que «¿sirve esta credencial?» **pasaba
en verde habiendo abierto una sesión que no dice nada**. En `rol_carga_parametros` decía lo
contrario de la verdad: su única base es `normativa` (C-7 §6). `baseDeDatos` pasa a **obligatorio**
para todo rol de PostgreSQL del inventario, y el repliegue se retira con una guarda que lo mide
sobre el código y no sobre los comentarios.

**(c) La sonda del motor colgaba de `BASE_DEL_PADRON = "sgtm"`.** Pasa a
`BASE_DE_MANTENIMIENTO = "postgres"`, por dos motivos y los dos medidos: **existe siempre** —en un
clúster recién inicializado y en los dos que ya corren—, y **no es de nadie**. Apuntar `pg_isready`
a una base que no exista en un clúster **ya creado** deja al motor declarándose enfermo y
reiniciándose para siempre, porque el `entrypoint` no crea bases sobre un volumen que no está
vacío; y elegir la de uno de los cuatro sistemas ataría la sonda del motor a que ese sistema
exista.

---

## 3. La guarda de #675 pasa de medir un esquema a medir cuatro

`sistemasDesplegados` leía **`construirManifiestos`** —la plataforma— y por eso sólo podía ver el
migrador del monolito: los `Job` de los cuatro sistemas los compone el descriptor, en su propio
espacio de nombres desde ADR-0031. Pasa a leer **`manifiestosDelAmbiente`**, los cinco.

Es el **mismo defecto por tercera vez en otro llamador**: C-16 lo arregló en `capacidad.ts` y `D`
en `index.ts`. Con el censo mirando lo que de verdad se aplica, el hueco que C-20 dejó anotado
—«los cuatro `Job` de migración del corte no los medía nadie»— se cierra solo.

Y `applicationBootstrapVersion` desaparece: era **una** línea, y `unicoSistemaDesplegado` llevaba
escrito desde #675 el error que esto cierra —«una sola línea sólo puede fechar un `git log`»—. La
sustituyen las cuatro `kamayuk:versionDe<Sistema>` que `D-23` ya había declarado.

### Y muerde a la primera

`stg` y `prod` declaran `da06fdc89523` de **`catastro`**, que trae **5** migraciones, y su
`origin/main` declara **10**: le faltan `V6__identidad_sncp_y_frente`, `V7__urbano`, `V8__grd`,
`V9__fiscalizacion` y `V10__buzon_del_territorio`.

**Ese rojo es el trabajo funcionando, no un defecto de este cambio**, y es exactamente la forma que
#675 describe: nada lo delata solo, porque el `Job` lleva la versión en el nombre y mientras esa
línea no se mueva `pulumi up` no crea ninguno y sale en verde. Subir la línea es una decisión
—exige que las dos imágenes de ese `sha` estén publicadas—, así que **se declara y no se toca**.

---

## 4. Criterios 1 y 2 — los manifiestos, objeto a objeto

| Ambiente | Objetos | Se van | Llegan | Cambian por dentro |
|---|---|---|---|---|
| `stg` | 94 → **87** | 7 | **0** | 6 |
| `prod` | 101 → **84** | 17 | **0** | 7 |

**En `prod` se van los diecisiete del monolito y nada más**: los `Deployment` de la aplicación y la
interfaz, sus dos `Service`, sus dos `IngressRoute`, el `ConfigMap` de nginx, el `CronJob` de lote,
los dos `Job` —`migracion-c755de214934` e `implantacion-c755de214934`— y siete `NetworkPolicy`.

**En `stg` se van sólo las siete `NetworkPolicy`**, y eso confirma que C-19 hizo su trabajo: allí
no quedaba ningún `Deployment`, ningún `Job` ni ningún `Service` del monolito. C-19 las dejó vivas
a propósito, porque una política cuyo `podSelector` no casa con ningún pod es inerte. Lo que no es
inerte es leerla: es una regla escrita contra un pod que no existe, y quien la lea creerá que
existe. Por eso `yarn capacidad --ambiente stg` **no se mueve** —1 820m / 6 528Mi, «cabe»—: una
`NetworkPolicy` no ocupa nodo.

Los que cambian por dentro son los que tenían que cambiar, y ninguno más:

| Objeto | Qué cambia |
|---|---|
| `postgres-inicializacion` (ConfigMap) | se va `10-crear-roles.sql`, el del monolito |
| `postgres` (Deployment) | `POSTGRES_DB` y las **tres** sondas, de `sgtm` a `postgres` |
| `respaldo` (CronJob) | las tres consultas, de `sgtm` a `rentas` |
| `observabilidad-prometheus` (ConfigMap) | sólo en `prod`: el `job_name: aplicacion`. En `stg` ya lo había quitado C-19 |
| `permitir-ingreso-identidad` | el monolito estaba ahí por el JWKS interno |
| `permitir-ingreso-postgres` | deja de nombrar a los pods del monolito |
| `permitir-salida-prometheus` | deja de raspar lo que no existe |

**De los cuatro sistemas no cambia ni un byte**, y eso es el criterio 2: ni un `Deployment`, ni un
`Job`, ni un `Namespace`, ni una `IngressRoute` de `rentas`, `catastro`, `normativa` o `caja`.

### La capacidad

| | `main` | esta rama |
|---|---|---|
| `stg` | 1 820m / 6 528Mi — **cabe** | 1 820m / 6 528Mi — **cabe** |
| `prod` | 2 610m / 9 696Mi — faltan **810m** y **3 968Mi** | 1 810m / 7 520Mi — faltan **10m** y **1 792Mi** |

**`prod` sigue sin caber, y se dice.** Pero pasa a estar a **10 milicores** de caber por CPU, que
es una cifra que cambia la conversación: lo que le sobra al nodo ya no es un problema de
dimensionado sino de redondeo. Por memoria le faltan 1 792Mi, que sí lo es. Quitar el monolito
**no era suficiente** para que `prod` cupiera, igual que en C-19 no bastó para `stg`; qué se hace
con eso es D-25 y no se decide aquí.

---

## 5. Las mutaciones

Cada una aplicada **sola**, ejecutada, y restaurada **por copia comparada con `cmp`**. Las mutaciones se midieron **antes del rebase**, contra una línea base de **7 rojas de 691** (§6),
así que «8 en rojo» es una de más. Rebasadas encima de `81be646` la línea base es **3 de 692** y
los deltas no cambian: lo que cada mutación añade es lo mismo, porque las cuatro rojas que se
fueron son de guardas que ninguna de las nueve toca.

| # | Mutación | Resultado |
|---|---|---|
| **M1** | `Pulumi.stg.yaml` vuelve a declarar `kamayuk:webReplicas: "1"` | 8 en rojo, y nombra la clave: «`stg` sigue declarando `webReplicas`, que desde `E` no la lee nadie» |
| **M2** | `sistemasDesplegados` vuelve a `construirManifiestos` —el defecto que este trabajo cierra | **Ver abajo: el resultado es que el rojo DESAPARECE** |
| **M3** | `BASE_DE_MANTENIMIENTO = "rentas"` | 8 en rojo: «expected 'rentas' to be 'postgres'», y la segunda mitad de la prueba dice por qué —ataría la sonda del motor a que ese sistema exista— |
| **M4** | `BASE_DEL_REGISTRO_DE_RESPALDO = "caja"` | **VERDE — ver abajo** |
| **M4b** | `BASE_DEL_REGISTRO_DE_RESPALDO = "sgtm"`, el defecto anterior exacto | **10 en rojo**, desde tres ángulos: la guarda propia («expected `['rentas','catastro',…(2)]` to include 'sgtm'») y **dos de `componentes.test.ts`** que ni siquiera pueden resolver el esquema: ««sgtm» no está en SISTEMAS… Los declarados son: rentas, catastro, normativa, caja» |
| **M5** | `asignar-claves.sh` recupera `e.baseDeDatos \|\| "sgtm"` | 8 en rojo: «vuelve a haber un repliegue… una entrada sin base pasaría en verde habiendo abierto una sesión que no dice nada» |
| **M6** | `caja` fuera de `SISTEMAS=` en `verificar-el-ambiente.sh` | 8 en rojo: «expected `['catastro','normativa','rentas']` to deeply equal `['caja','catastro',…(2)]`». La lista se **ejecuta**, no se lee: es la lección de M10 de C-19 |
| **M7** | Las cuatro `fetch-depth` de la acción, **sin comillas** | 8 en rojo: «`&& 0 \|\| 1` sin comillas devuelve 1 SIEMPRE —`0` es falso en una expresión de GitHub—, o sea el checkout superficial justo en el trabajo que pide el completo» |
| **M8** | `rol_carga_parametros` pierde su `baseDeDatos` | 8 en rojo, y nombra el rol: ««postgres-carga» declara el rol «rol_carga_parametros» y no dice contra qué base se conecta» |
| **M9** | Un archivo bajo `backend/`, **versionado** con `git add` | 8 en rojo: «`backend/` sigue versionado… expected `['backend/sgtm-esquema/V1__x.sql']` to deeply equal `[]`». Se lee el árbol de **git** y no el disco: un archivo sin versionar no cuenta |

### M2 es la mutación que da sentido al trabajo, y su síntoma es que el rojo se va

Con `sistemasDesplegados` leyendo sólo la plataforma, la suite pasa de **691 pruebas a 657**: los
34 casos de deriva **dejan de generarse**, porque salen de un `it.each` sobre los sistemas
desplegados y esa lista queda vacía. Y con ellos **desaparecen los dos rojos reales de
`catastro`**: el defecto no añade un rojo, **quita** dos.

Lo único que lo caza es el centinela que C-19 dejó puesto en §8.1 —«y al menos un ambiente sigue
midiendo su deriva»—, que dice exactamente lo que hay que oír:

> «ningún ambiente construye migrador: la guarda de #675 no está midiendo nada. Si eso es lo que se
> quiere, hay que decidirlo aquí, no dejarlo pasar por lista vacía.»

Sin ese centinela, el defecto que este trabajo cierra habría pasado **en verde**, con `it.each([])`
y las cifras totales bajando 34 sin que nada lo dijera. Es el modo de fallo que #675 y #675 otra
vez llevan documentando: una verificación vieja que pasa en verde.

### M4 pasó en VERDE, y hay que decir qué mide esa guarda y qué no

Cambiar el registro del respaldo a `caja` **no pone nada rojo**, porque los **cuatro** baselines
declaran `CREATE TABLE respaldo` —medido: 1, 1, 1, 1—. O sea que la guarda **no protege cuál de
los cuatro se elige**; protege que el elegido sea uno de los cuatro y que su esquema declare la
tabla, que es literalmente lo que su docstring promete. La elección de `rentas` sobre las otras
tres es un juicio, está argumentada en el docstring de `BASE_DEL_REGISTRO_DE_RESPALDO`, y **no
tiene guarda**. Queda dicho aquí en vez de dejar que alguien lo descubra suponiendo que la tenía.

---

## 6. Criterio 5 — las cifras, contra su línea base

La línea base hay que medirla, porque sin ella los rojos de la rama no se pueden leer: los clones
hermanos avanzan por su cuenta y `catastro` avanzó.

| | Pruebas | Rojas |
|---|---|---|
| `origin/main` (`81be646`) | 681 | **1** |
| esta rama, rebasada encima | 692 | **3** |

**La 1 es la misma en los dos lados y no es de este trabajo**: el clon de `catastro` llegó con su
interfaz y publica **tres** imágenes donde la guarda espera dos. **Las 2 nuevas son la deriva de
`catastro`** de §3, o sea la guarda nueva mordiendo.

> **Esta medición se rehízo, y conviene decir por qué.** La primera se tomó contra `71943d8`, que
> era `main` cuando esta rama salió, y daba 680/**5**. Mientras el trabajo estaba en curso entraron
> seis commits en `main` —la etapa 1 del territorio y el censo de extensiones con `V7`..`V10` de
> `catastro`— que **cerraron cuatro de esas cinco**. La rama se rebasó encima, con dos conflictos
> —`CLAUDE.md` y `extensiones-de-las-migraciones.test.ts`— y una cifra que había que volver a tomar:
> una línea base es de un `main` concreto, y decirlo sin el `sha` la vuelve inútil al mes.

Los dos conflictos se resolvieron tomando de `main` lo que es suyo —`catastro: 10` con el
comentario de la etapa 1, las 20 reglas y 44 muestras de `comun-verificaciones`, los 13 ADR y sus
dos filas del registro— y de `E` lo que es de `E`. **Y el censo de extensiones pasa de cinco
esquemas a cuatro**: derivaba de `SISTEMAS`, y ahí ya no están la copia local del esquema del
monolito —que se fue con `backend/`— ni `sgtm`, que no lo despliega ningún ambiente.

---

## 7. Y `.github/diagnostico-del-namespace.sh` no se añade: se restaura

`infra.yml` lo invoca en **tres** sitios —los pasos de diagnóstico de `aplicar-stg` y
`aplicar-prod`— y el archivo **no estaba en la historia de este repositorio**: `git log` sobre esa
ruta viene vacío. Se quedó en el corte. Los tres pasos no podían correr, y son justo los que
capturan el «0/1 nodes are available: Insufficient cpu» que el issue #252 pagó con seis horas.

---

## 8. Huecos declarados

1. **Un filtro `paths` sólo puede nombrar rutas de su repositorio.** Los cuatro esquemas que hoy se
   despliegan viven en otros cuatro, así que **una migración de `rentas` no dispara este flujo**.
   Es la otra mitad de #675, está abierta desde P6, y se cierra con un disparo entre repositorios
   (`repository_dispatch`). **No está hecho.** Lo mismo vale para el enumerado contra el que se
   contrasta la tabla de formas de documento (#415), que vivía en `backend/sgtm-dominio-compartido`
   y hoy está en los cuatro clones.
2. **La base `sgtm` sigue existiendo en los dos clústeres.** Este trabajo deja de referirse a ella;
   no la borra, y borrarla es una decisión de operación con su propio riesgo. Lo que sí queda
   medido es que no tiene ni una tabla del producto.
3. **`prod` no cabe**, por 10m de CPU y 1 792Mi. Es D-25 y no se decide aquí.
4. **`catastro` declara 5 migraciones y su `main` trae 10.** Subir `kamayuk:versionDeCatastro`
   exige que las dos imágenes de ese `sha` estén publicadas; es una decisión, no una línea.
5. **Con el monolito se fue la única interfaz web del producto.** Ninguno de los cuatro sistemas
   tiene `frontend/` en este repositorio todavía.

---

## 9. Lo que este trabajo no toca

- **`sgtm` no se toca**, ni se borra, ni se modifica. Es el archivo histórico y la única copia con
  el `git log` de la historia entera.
- **Los cuatro repositorios hermanos no se tocan**: su `git status` queda limpio.
- **No se ejecuta ningún `pulumi up`.** El punto de no retorno queda intacto.
