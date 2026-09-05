# C-19 — `stg` pide lo mínimo

**Estado:** aplicado en `infrastructure`. Los otros cuatro repositorios y `sgtm` **no se tocan**:
su `git status` queda limpio.

La dirección ya decidió: **`stg` es un entorno de ensayo y tiene que pedir lo mínimo.** El
monolito que se desplegaba allí no lo usa nadie, y la aplicación ya estaba escalada a cero a mano
en el clúster vivo (`sgtm-stg-aplicacion` 1→0, `sgtm-stg-interfaz` 2→0). Lo que faltaba es que
**los manifiestos dejaran de declararlo**, porque `yarn capacidad` mide lo declarado.

> **El resultado, en una línea: `stg` pasa de «no cabe, faltan 2 720Mi» a «cabe», y `prod` no
> cambia ni un byte.** `yarn manifiestos --ambiente prod` es **idéntico byte a byte** antes y
> después (316 328 bytes, `diff` vacío) y `yarn capacidad --ambiente prod` imprime exactamente el
> mismo texto.

---

## 1. Los criterios, con su medida

| # | Criterio | Estado | Dónde |
|---|---|---|---|
| **1** | `yarn capacidad --ambiente stg` sale «cabe» contra 4 CPU / 7Gi, **sin subir esa declaración** | **Cumplido**: 1 820m / 6 528Mi de 3 800m / 7 008Mi | §4 |
| **2** | `yarn capacidad --ambiente prod` y `yarn manifiestos --ambiente prod` no cambian | **Cumplido**, `diff` vacío | §4, §5 |
| **3** | Cada arreglo con su mutación, restaurada por copia comparada con `cmp` | **Cumplido**, diez mutaciones | §6 |
| **4** | Las cifras no bajan | **Cumplido**: descriptores 15 · 13 · 13 · 14; `infrastructure` 608 → **626** | §7 |
| **5** | `yarn verificar` en verde en los repositorios tocados | **Cumplido** (sólo se toca `infrastructure`) | §7 |

---

## 2. Lo que se decidió, y por qué hacen falta **las dos** mitades

La cuenta se hizo antes de escribir código, y la conclusión no era la esperada: **quitar el
monolito no basta**.

```
stg, hoy:                            pico 2620m / 9728Mi   contra 3800m / 7008Mi   NO CABE
  el monolito vale                        800m / 2176Mi
  → sólo quitándolo:                 pico 1820m / 7552Mi                            NO CABE
                                                                       faltan 544Mi
  → sólo con el perfil `minimo`:     pico 2620m / 8704Mi                            NO CABE
  → las dos:                         pico 1820m / 6528Mi                            CABE
                                                          quedan 480Mi de margen
```

Las tres cifras están **medidas**, no razonadas: las dos intermedias son las mutaciones M8 y M9 de
§6, ejecutadas contra los archivos reales.

### 2.1 `stg` deja de declarar el monolito

**El mecanismo es una capacidad declarada en el stack**, `sgtm:desplegarElMonolito`, y no el
nombre del ambiente. Eso no es gusto: la cabecera de `index.ts` lo tiene escrito desde que existe
—«los únicos condicionales admisibles son los que responden a una **capacidad** declarada en
configuración, no al nombre del ambiente»—, y es lo que hace que volver a encenderlo sea **una
línea** y no reescribir código.

**Sin valor por omisión**, como `municipalidadId`: en un booleano, `?? true` hace que «no lo
declaré» y «declaré que no» se lean igual. Por eso `config.ts` estrena `requireBoolean`, y los dos
stacks lo dicen.

Lo que se va de `stg` —diez objetos de 104, medido comparando los dos JSON—:

```
- sgtm-stg|Job/sgtm-stg-migracion-c755de214934        - sgtm-stg|Deployment/sgtm-stg-interfaz
- sgtm-stg|Job/sgtm-stg-implantacion-c755de214934     - sgtm-stg|Service/sgtm-stg-interfaz
- sgtm-stg|Deployment/sgtm-stg-aplicacion             - sgtm-stg|CronJob/sgtm-stg-lote
- sgtm-stg|Service/sgtm-stg-aplicacion                - sgtm-stg|IngressRoute/sgtm-stg-interfaz
- sgtm-stg|ConfigMap/sgtm-stg-interfaz-nginx          - sgtm-stg|IngressRoute/sgtm-stg-api
```

**Las dos `IngressRoute` se van con él, y eso no es limpieza.** Una ruta que apunta por nombre a un
`Service` ausente **no se queda callada**: Traefik la acepta, el certificado se emite, y lo que
contesta la raíz del dominio público es un `503` que se lee como «el sistema está caído» y no como
«aquí no hay nada desplegado». Lo mismo con el `job_name: aplicacion` de Prometheus, que quedaría
`down` para siempre: no dispara ninguna alerta —`alertas.yml` no tiene ninguna sobre
`up{job="aplicacion"}`, comprobado— y **eso es justo lo que lo hace peor**, porque un objetivo
caído permanente enseña a no mirar la lista de objetivos (la lección de C-17 §5).

**LO QUE NO SE VA, y vive en el MISMO namespace `sgtm-stg`:** el motor, la identidad, el correo, el
`Job` del realm, el respaldo y la observabilidad. Los cuatro sistemas se conectan **literalmente**
a `sgtm-stg-postgres.sgtm-stg:5432` (C-17, punto 1) y traen el JWKS de `sgtm-stg-identidad`
(C-14, punto 3): borrar la plataforma con el monolito los rompe a los cuatro, y el síntoma no sería
un error sino **cuatro pods que arrancan y no pasan nunca su sonda de arranque**, con `pulumi up`
esperando indefinidamente (issue #252). Por eso el guarda no comprueba una lista de objetos sino
que **los dos `Service` que los descriptores nombran sigan ahí**, leyéndolos del mismo entorno del
que salen sus variables (§3, mutación M3).

**Las `NetworkPolicy` se quedan, y es deliberado.** Una política cuyo `podSelector` no casa con
ningún pod es inerte: no abre nada, no cierra nada y no ocupa nodo. Y `permitir-ingreso-postgres`
es **una sola** política que nombra a la vez a los pods del monolito y a los cuatro sistemas:
recortarla por dentro sería cirugía sobre la única regla que deja a los cuatro llegar a su base, a
cambio de nada. El `Middleware/limite-de-tasa` se queda por lo mismo.

### 2.2 Un perfil de recursos por ambiente

Hasta C-19, `RECURSOS` en `componentes/convenciones.ts` era **una sola tabla para los dos
ambientes**, así que bajar una petición para que `stg` cupiera la bajaba también en `prod`, donde
el margen es el que el issue #158 midió desplegando y donde `nodeCapacityGapIssue` sigue puesto.

`sgtm:perfilDeRecursos` toma dos valores —`dimensionado` (la tabla de `INF-01` §2, la de siempre,
la que declara `prod`) y `minimo` (lo que basta para ensayar)— y `checkInvariants` **rechaza
`minimo` en `prod`**: ese perfil baja lo que el planificador **reserva**, y sobre el nodo que
atiende a la municipalidad lo que se pierde no es margen sino la garantía de tener esa memoria
cuando el nodo se aprieta. Al revés no se prohíbe: `stg` puede pedir lo dimensionado, y lo único
que pasaría es que no cabría — y eso ya lo dice `capacidad.ts` con las cifras.

**El perfil `minimo` tiene UNA entrada, y está medido por qué**: quitado el monolito faltan
exactamente **544Mi**, sobra CPU (1 820m de 3 800m), y el único sitio donde 544Mi existen sin
inventar holgura es el motor —2 080Mi de un pico de 7 552Mi, cuatro veces el siguiente—. Baja de
`2Gi` a `1Gi` de `requests`; **ningún `limits` se toca**, así que PostgreSQL sigue pudiendo usar
las 4 CPU y los 8 Gi que el nodo tenga libres. Es el mismo razonamiento con que `arranque` bajó de
250m a 100m en el issue #252: un `request` bajo no es menos cómputo, es menos garantía previa.

Lo que **no** se toca, con su motivo:

- **la CPU del motor**: la CPU no es lo que falta en `stg`, y bajar lo que no estorba es cambiar
  sin motivo;
- **la identidad**: Keycloak es lo único de la plataforma que ya se vio reiniciarse en el clúster
  real (C-17), y bajar el `request` de un pod que de verdad usa esa memoria es exactamente lo que
  lo hace desalojable antes;
- **la observabilidad**: 180m / 512Mi entre los cinco. Es barata y hay verificaciones que la
  ejercitan.

⚠ Las dos tablas siguen siendo **estimaciones, no mediciones** (`INF-01` §2 lo dice de la primera).
Lo que C-19 mide es que el ambiente quepa; que 1Gi sea lo justo se sabrá con volumetría.

### 2.3 Y la brecha de `stg` se retira

`Pulumi.stg.yaml` pierde `sgtm:nodeCapacityGapIssue`. **No es opcional**: `capacidad.test.ts` exige
desde C-16 que un ambiente que declara la brecha **siga sin caber**, así que dejarla puesta habría
puesto esa prueba en rojo. Es la guarda de C-16 funcionando en la dirección para la que se escribió.
`prod` conserva la suya: allí el monolito se despliega y el nodo es el que es.

---

## 3. La tabla base deja de exportarse, y eso es media guarda

`RECURSOS` era una constante exportada que los seis componentes leían directamente. Ahora es
**privada del módulo** y lo único que sale es `recursosDe(perfil)`, que `componentes/index.ts`
resuelve **una vez** y pasa a los seis. Un componente que quisiera saltarse el perfil **no
compila** — la misma clase de barrera que C-14 midió con su M3, donde el defecto no se puede ni
escribir.

Lo que **sí** se puede escribir, y por eso tiene prueba propia, es una entrada del perfil que no
consuma nadie. Ver M6 en §6: **la primera versión de esa guarda no la cazaba**.

---

## 4. Criterio 1 y 2 — las dos salidas de `yarn capacidad`

### `stg` — **cabe**

```
Ambiente «stg» contra un nodo de 4 / 7Gi:
  permanente     1350m / 4160Mi
  pico arranque  1820m / 6528Mi
  en 5 espacio(s) de nombres, en el pico:
    sgtm-stg                 970m / 2176Mi
    kamayuk-catastro-stg     250m / 1280Mi
    kamayuk-rentas-stg       200m / 1024Mi
    kamayuk-normativa-stg    200m / 1024Mi
    kamayuk-caja-stg         200m / 1024Mi
cabe
```

Antes: `permanente 1950m / 6336Mi`, `pico 2620m / 9728Mi`, «NO CABE por memoria: faltan 2720Mi».
El nodo declarado **no se tocó**: sigue en `nodeAllocatableCpu: "4"` / `nodeAllocatableMemory: 7Gi`.

### `prod` — **exactamente lo mismo que antes**

```
Ambiente «prod» contra un nodo de 2 / 6029348Ki:
  permanente     1940m / 6304Mi
  pico arranque  2610m / 9696Mi
  en 5 espacio(s) de nombres, en el pico:
    sgtm-prod                1760m / 5344Mi
    kamayuk-catastro-prod    250m / 1280Mi
    kamayuk-rentas-prod      200m / 1024Mi
    kamayuk-normativa-prod   200m / 1024Mi
    kamayuk-caja-prod        200m / 1024Mi

El stack «prod» no cabe en el nodo que declara (2):
  - … faltan 810m (0.81 CPU) …
  - … faltan 3968Mi (3.87 Gi) …
no-cabe
```

Comparado con `diff` contra la salida capturada antes de tocar nada: **sin una sola diferencia**.
`prod` sigue sin caber, con su brecha declarada, exactamente como estaba.

---

## 5. Criterio 2 — `prod` byte a byte

```
$ diff manifiestos-prod-antes.json manifiestos-prod-despues.json
$ wc -c manifiestos-prod-antes.json manifiestos-prod-despues.json
  316328 …antes.json
  316328 …despues.json
```

`stg` pasa de 322 488 a 295 824 bytes y de 104 a 94 objetos.

---

## 6. Las mutaciones

Cada una aplicada **sola**, ejecutada, y restaurada **por copia comparada con `cmp`**.

| # | Mutación | Resultado |
|---|---|---|
| **M1** | `construirManifiestos` **ignora la bandera** (`const conMonolito = true`) | **6 en rojo**, en tres archivos: las cuatro de la guarda nueva, `capacidad.test.ts > «stg» cabe` —vuelve la brecha— y `deriva-de-migraciones > stg: hay migrador si y sólo si el stack despliega el monolito` |
| **M2** | `recursosDe` **ignora el perfil** y devuelve siempre el `minimo` | **6 en rojo**, y la que importa dice el defecto entero: «expected `{ cpuEnMili: 1940, memoriaEnMi: 5280 }` to deeply equal `{ cpuEnMili: 1940, memoriaEnMi: 6304 }`». `yarn capacidad --ambiente prod` pasa a pedir 8 672Mi de pico: **`prod` habría perdido 1 024Mi de reserva sin que nadie lo decidiera**, y `stg` sigue en verde — el defecto sólo se ve por el lado de `prod`, que es para lo que existe esa prueba |
| **M3** | La bandera gobierna **además** `manifiestosDeBaseDeDatos` —la plataforma se va con el monolito— | 2 en rojo: «los cuatro sistemas se conectan a «sgtm-stg-postgres.sgtm-stg:5432» y ese Service no está en los manifiestos de «stg»: se quedarían sin base, y el síntoma sería cuatro pods que arrancan y no pasan nunca su sonda de arranque», y Prometheus raspando un `Service` que no existe |
| **M4** | Las dos rutas del monolito, **fuera** del condicional de `Ingreso.ts` | 1 en rojo: «una IngressRoute a un Service ausente contesta 503 en el dominio público, que se lee como «el sistema está caído» y no como «aquí no hay nada desplegado»» |
| **M5** | El `job_name: aplicacion` de Prometheus, **incondicional** | 1 en rojo: «expected `[ 'sgtm-stg-aplicacion' ]` to deeply equal `[]`» |
| **M6** | Una entrada del perfil `minimo` **que no consume nadie** (`aplicacionLote`: en `stg` sólo lo pedía el `CronJob` de `lote`, que se fue con el monolito) | **VERDE la primera vez — ver abajo.** Con la guarda corregida: 1 en rojo, «el perfil `minimo` declara una rebaja para «aplicacionLote» y ningún contenedor de «stg» la pide» |
| **M7** | `Pulumi.prod.yaml` con `perfilDeRecursos: minimo` | 1 en rojo en `stacks.test.ts`: «`perfilDeRecursos` es «minimo» en «prod». Ese perfil es el de un ambiente de ENSAYO (C-19): baja lo que el planificador reserva, y sobre el nodo que atiende a la municipalidad lo que se pierde no es margen, es la garantía de tener esa memoria cuando el nodo se aprieta» |
| **M8** | **Contraste**: `stg` vuelve a declarar el monolito, con el perfil `minimo` puesto | `pico 2620m / 8704Mi` → **no-cabe**, y `capacidad.test.ts > «stg» cabe` en rojo. Es la evidencia de que el perfil por sí solo no alcanza |
| **M9** | **Contraste**: `stg` sin monolito pero con el perfil `dimensionado` | `pico 1820m / 7552Mi` → **no-cabe**: «Faltan 544Mi (0.53 Gi)». Es la evidencia de que quitar el monolito por sí solo tampoco alcanza — y el número exacto que justifica la única entrada del perfil |
| **M10** | La tubería con que `verificar-el-ambiente.sh` lee la bandera, rota (una letra) | 1 en rojo: «el guion lee «» de Pulumi.prod.yaml y config.ts lee «true»» |

### M6 pasó en VERDE, y ahí estaba el defecto de la propia guarda

La primera versión de «toda entrada del perfil se aplica» comparaba **la composición entera** de
`stg` con un perfil y con el otro y exigía que difirieran. Con `motor` dentro **eso ya es cierto
pase lo que pase**, así que añadir una entrada muerta dejaba las 17 pruebas en verde: la guarda no
podía fallar por lo que decía medir.

Lo que muerde es **buscar el valor**: algún contenedor del ambiente tiene que pedir exactamente lo
que esa entrada declara, y ninguno lo que declaraba antes. Queda escrito en el docstring, con la
mutación que lo destapó, para que nadie la «simplifique» de vuelta.

---

## 7. Criterios 4 y 5 — las cifras

| Repositorio | Línea base | Medido ahora |
|---|---:|---:|
| `infrastructure` · `yarn verificar` | 608/608 | **626/626** (29 archivos) |
| `rentas` · `test` + `pruebaDeArranque` | 3 144 | **3 144** |
| `catastro` | 993 | **993** |
| `normativa` | 619 | **619** |
| `caja` | 689 | **689** |
| `rentas/infrastructure` | 15 | **15** |
| `catastro/infrastructure` | 13 | **13** |
| `normativa/infrastructure` | 13 | **13** |
| `caja/infrastructure` | 14 | **14** |

**Ninguna baja.** `infrastructure` sube 18: **12** de la guarda nueva
`verificaciones/perfil-del-ambiente.test.ts`, **4** de `deriva-de-migraciones.test.ts` (el «si y
sólo si» y el «queda al menos uno midiéndose») y **2** de `config.test.ts`.

Los cuatro backends **no se tocan** —`git status` queda limpio en los cinco repositorios hermanos y
este cambio no toca una sola línea de Java ni ningún archivo que Gradle lea— y aun así se
**ejecutaron los cuatro**, `BUILD SUCCESSFUL` los cuatro, contra el PostgreSQL de pruebas de esta
máquina (`127.0.0.1:55444`). Las cuatro cifras salen exactamente en la línea base.

---

## 8. Lo que cambió alrededor, y no estaba en el encargo

Tres cosas se rompieron al quitar el monolito de `stg`, y ninguna se tapó.

### 8.1 La deriva de migraciones ya no tiene qué medir en `stg`

`deriva-de-migraciones.ts` (issue #675) deriva **de los manifiestos** qué sistema migra cada
ambiente. Sin monolito, `stg` construye **cero** migradores y `unicoSistemaDesplegado` lanzaba: seis
pruebas en rojo.

La respuesta correcta no es un `try/catch`: **un ambiente que no despliega ningún migrador no tiene
deriva que medir**, porque su `applicationBootstrapVersion` no gobierna ningún `Job`. Se dice, no se
calla:

- `SinMigrador` es un tipo de error propio —distinto del «construye dos y la configuración declara
  una versión», que sí es un defecto—;
- `ambientesConMigrador(...)` se **deriva de los manifiestos**, como el censo de #675, así que el
  día que `stg` vuelva a desplegar el monolito entra solo;
- y hay **dos** guardas nuevas que impiden que ese filtro se convierta en la forma de apagar #675:
  «hay migrador **si y sólo si** el stack declara el monolito» —las dos direcciones— y «queda al
  menos un ambiente midiéndose», sin la cual apagar el monolito en los dos dejaría el `it.each` con
  cero casos, en verde y sin haber mirado nada.

`herramientas/declarar.ts` (#720) pasa a medir y reescribir **sólo los ambientes con migrador**, y
si no queda ninguno lo dice y sale con éxito en vez de reventar.

### 8.2 `verificar-el-ambiente.sh` habría quedado rojo para siempre en `stg`

Ese guion mira el `Deployment sgtm-<amb>-aplicacion` y hace `port-forward` a su `Service` para la
escalera de identidad. Sin monolito, las dos cosas fallan — y ese guion corre en `aplicar-stg` y en
`deteccion-de-deriva`, a diario. Un rojo permanente por algo que nadie puede arreglar en un PR es
lo que `infra.yml` lleva escrito en su cabecera que no puede pasar; y darlo por bueno sin mirarlo
sería peor.

Lee la bandera del mismo `Pulumi.<amb>.yaml` y **dice que no se comprueba**, que no es lo mismo que
decir que está bien (C-15/C-16). Y las **dos lecturas del mismo archivo se comparan** en una prueba
que ejecuta la propia tubería del guion (M10): una prueba que sólo mirara que el guion nombra la
clave pasaría con la tubería rota.

### 8.3 `stg` deja de ser la puerta por la que pasa toda versión del monolito

Es una consecuencia de la decisión de la dirección, no de esta implementación, y conviene tenerla
escrita porque no se ve en ninguna cifra: `sgtm:applicationBootstrapVersion` de `Pulumi.stg.yaml`
**deja de moverse** —`declarar-version.yml` sólo reescribe ambientes con migrador—, mientras la de
`prod` sigue subiendo. `aplicar-prod` tiene `needs: aplicar-stg`, así que `stg` sigue siendo la
puerta del **despliegue**; lo que ya no ensaya es **la migración del esquema del monolito**. Hasta
hoy esa era la única prueba de que un migrador corría antes de llegar a producción.

No se resuelve aquí porque no es un defecto que arreglar sino una decisión que tomar: si el monolito
sigue en `prod`, alguien tiene que decidir dónde se ensaya su migración. Está anotado como hueco 1.

---

## 9. Huecos declarados

1. **Nadie ensaya ya la migración del monolito antes de `prod`** (§8.3). `stg` no la corre y su
   versión declarada se congela. Mientras `prod` despliegue el monolito, esto es una decisión
   pendiente, no un descuido.

2. **No se aplicó nada contra el clúster, a propósito.** El encargo lo prohíbe: lo aplicado en vivo
   lo decide la dirección. Lo medido aquí es lo que se **declara** —manifiestos y aritmética de
   capacidad— y las pruebas, que corren sin clúster. Los pods de `stg` ya estaban escalados a cero
   a mano; los diez objetos siguen existiendo en el clúster hasta el próximo `pulumi up`.

3. **`verificar-el-ambiente.sh` no se ejecutó.** Su sintaxis sí (`bash -n`) y la lectura de la
   bandera sí (M10, ejecutando su tubería contra los dos stacks reales). Lo que no se ejerció es el
   guion entero contra un clúster: mismo hueco que C-14 §6.2, C-16 y C-17.

4. **Un panel del tablero dirá «No data» en `stg`.** `observabilidad/dashboards/resumen-operativo.json`
   tiene uno que mide `kube_pod_start_time{pod=~".*aplicacion.*"}`, y en `stg` ya no hay ningún pod
   así. `verificar-tableros.sh` —que necesita clúster y no se corrió— lo reportaría. No se templa el
   tablero: es un JSON compartido por los dos ambientes, y templarlo por ambiente sería un segundo
   sitio donde olvidarse. Queda dicho.

5. **La cifra de `1Gi` para el motor de `stg` es una estimación, como la de `2Gi` que sustituye.**
   `INF-01` §2 lo dice de la tabla entera: se recalibran con volumetría, que no existe mientras D-01
   siga abierta. Lo que este trabajo mide es que el ambiente quepa, no que la cifra sea la justa.
   El margen que deja está medido: **480Mi de 7 008Mi**, un 6,8 %.

6. **`checkInvariants` no corre al emitir manifiestos.** `yarn manifiestos --ambiente prod` con
   `perfilDeRecursos: minimo` **emite igual** —`invariantesDe` sólo lee—, y quien rechaza esa
   configuración son `stacks.test.ts` (en `yarn verificar`, que es `needs:` de todos los trabajos de
   despliegue) y `loadSettings()` al entrar a `pulumi up`. Es anterior a C-19 y vale para todas las
   invariantes; se anota porque este cambio añade una.

7. **`nodeAllocatableCpu`/`nodeAllocatableMemory` de `stg` siguen sin medirse.** El encargo prohíbe
   subirlos y no se subieron; su comentario ya dice que son una cota inferior demostrable y no una
   medición del nodo. Declarar por debajo de lo real sólo aprieta la comprobación.

---

## 10. Lo que este trabajo no toca

- **`sgtm` no se toca.** Es el archivo histórico; su `git status` queda limpio.
- **Los otros cuatro repositorios tampoco.** Ni su Java, ni su descriptor, ni su compose.
- **`prod` no cambia ni un milicore**, y lo sujetan tres cosas: el `diff` vacío de sus manifiestos,
  la salida idéntica de `yarn capacidad`, y una prueba que fija sus dos cifras (M2).
- **La observabilidad se queda entera** en los dos ambientes: 180m / 512Mi entre sus cinco pods.
- **Las `NetworkPolicy` se quedan**, con el motivo escrito en `componentes/index.ts` (§2.1).
- **No se sube el tamaño declarado del nodo de `stg`.** La dirección pidió bajar la demanda, no
  ensanchar el nodo.
