# C-17 — que el despliegue pase de verdad

**Estado:** aplicado en los cinco repositorios.

Se levantó una EC2 y se desplegó el producto entero contra un k3s de verdad **por primera vez**.
Nada de lo que sigue es razonado: cada punto trae la medida que lo encontró y la mutación con que
se comprobó que su guarda muerde.

Lo que el corte tenía escrito era correcto sobre el papel y **no arrancaba**. Los cinco defectos
comparten una forma: cada uno vivía en la mitad de una frontera, la otra mitad estaba bien, y
**nada comparaba las dos**.

| # | Qué estaba mal | Síntoma medido | Dónde vivía el defecto |
|---|---|---|---|
| A | `caja/backend/Dockerfile` «no existía» — y sí existe: **el commit de C-14 que lo trae nunca se empujó** | `docker build` no encuentra el `Dockerfile` en un clon del remoto | el árbol local y el repositorio publicado |
| B | `normativa/backend/Dockerfile` copiaba `sgtm.jar` y el módulo produce `normativa.jar` | `docker build` compila entero y muere en el último `COPY` | dos archivos que no se leían juntos |
| 1 | el anfitrión del motor escrito a mano: `postgres:5432` | `UnknownHostException` en los **ocho** Jobs y en los cuatro `Deployment` | el descriptor componía una convención ajena |
| 2 | las sondas piden `/actuator/health/liveness`; la cadena permite `/actuator/health` | `CrashLoopBackOff` **permanente**, con la aplicación sana | descriptor y `SeguridadWeb`, cada uno bien por su lado |
| 3 | la política de egreso no abre DNS | `UnknownHostException` **intermitente** | política escrita de cero, sin copiar la de la plataforma |
| 4 | el generador de secretos declara nueve y los sistemas montan diez, intersección **cero** | pods en `Pending`, y `bootstrap-secretos.sh` diciendo «Listo» | el inventario no componía los descriptores |
| 5 | `kamayuk-rentas-batch` es un `Deployment` y el perfil `batch` termina | `CrashLoopBackOff` con salida **0** | la forma del manifiesto contradice al código |

---

## A y B · las dos imágenes que no se podían construir

### A no era lo que parecía, y medirlo lo cambió

El encargo daba `caja/backend/Dockerfile` por inexistente y adjuntaba uno escrito de cero. **El
archivo sí existe**: lo añadió `685eba8` —«C-14: el descriptor despliega, y caja estrena su
Dockerfile»—, y comparando ese blob con el escrito en la preparación, **no hay una sola diferencia
funcional**: sólo comentarios, uno de los cuales afirma «ESTE ARCHIVO NO EXISTIA».

Lo que sí es cierto es el síntoma: en la EC2 `docker build` no lo encontraba. Y la causa es otra,
y es de las que valen: **`685eba8` nunca se empujó**. Lo mismo pasa con `04bf73e` en `catastro` y
`08716a9` en `rentas` — tres de los cinco repositorios llevaban su C-14 sin publicar. La instancia
clonó del remoto, y en el remoto ese archivo no está.

Así que **el `Dockerfile` se devuelve byte a byte a su versión de C-14** —cuyos comentarios son
verdaderos— y lo que cierra el hueco es empujar. Un comentario que dice de sí mismo que el archivo
no existía es peor que ninguno: envejece igual que una cifra, y nadie lo comprueba.

### B sí era un defecto, y estaba mudo

`normativa/backend/Dockerfile` pedía `sgtm.jar`, y ese módulo declara
`archiveFileName.set("normativa.jar")` mientras los otros tres conservan el nombre heredado del
monolito. `docker build` compilaba entero —Gradle en verde, el jar producido— y se caía en el
último paso con «stat …/sgtm.jar: file does not exist».

**Los dos defectos son mudos por construcción**: ningún CI construye todavía estas imágenes, y
desde el clúster el síntoma es `ImagePullBackOff`, que se lee como «el registro aún no publicó la
etiqueta» y no como «no existe forma de publicarla».

La guarda de A ya existía (`«%s» tiene los dos objetivos en su Dockerfile`). La de B es nueva y
**lee los dos archivos** —el `build.gradle.kts` y el `Dockerfile`— en vez de comparar contra una
lista escrita en la prueba, que sería el tercer sitio con la misma verdad.

> **Mutación B.** Devolver `build/libs/sgtm.jar` al `COPY` de `normativa`.
> → 1 en rojo: «el Dockerfile de «normativa» copia «sgtm.jar» y su módulo produce
> «normativa.jar» … expected 'sgtm.jar' to be 'normativa.jar'».
>
> **Mutación A.** Apartar `caja/backend/Dockerfile` —que es lo que la EC2 veía al clonar del
> remoto—. → 2 en rojo, y la primera nombra la ruta y el remedio
> («No esta «…/caja/backend/Dockerfile» … Remedio: git clone …»). La guarda ya existía desde
> C-14 y **no podía ver el defecto real**, porque mira el árbol de trabajo y lo que faltaba
> estaba en el remoto.

---

## 1 · El anfitrión del motor no existe en Kubernetes

Los cuatro descriptores tenían escrito:

```ts
const URL_DE_LA_BASE = `jdbc:postgresql://postgres:5432/${SISTEMA}`;
```

En Kubernetes **no hay ningún `Service` llamado `postgres`**: ese nombre viene del
`compose.yaml` local. El servicio real es `sgtm-<ambiente>-postgres` y vive en el namespace de la
**plataforma**, así que ni siquiera un nombre corto correcto resolvería desde el namespace de un
sistema. Medido: `UnknownHostException` en los ocho Jobs y en los cuatro `Deployment`.

**El sitio del arreglo es `EntornoDelDescriptor`.** Su campo `plataforma` entregaba `namespace`,
`emisor` y `jwks` —«las tres cosas que un sistema necesita saber y no puede componer sin repetir
una convención ajena»— y el anfitrión del motor es la cuarta. Es el mismo movimiento que C-7 hizo
con `operacion` y el mismo que C-14 hizo con el JWKS, un componente más abajo.

Lleva el puerto dentro (`sgtm-stg-postgres.sgtm-stg:5432`) para que el descriptor no lo teclee: lo
que compone es `jdbc:postgresql://${e.plataforma.motor}/<su base>`, y el nombre de su base **sí**
es suyo.

**Y una guarda existente fosilizaba el defecto.** `despliegue-de-los-sistemas.test.ts` exigía
`jdbc:postgresql://postgres:5432/${sistema}` **literal**: la comprobación de C-14 demandaba el
nombre roto. Ahora compara contra `entorno.plataforma.motor`, y así sigue al ambiente en vez de
congelar un valor.

> **Mutación.** Devolver el anfitrión escrito a mano en `caja`.
> → 1 en rojo en `infrastructure` y 1 en el propio repositorio de `caja`
> («expected 'jdbc:postgresql://postgres:5432/caja' to be 'jdbc:postgresql://sgtm-stg-postgres.…'»).
> El compilador ya había cazado la mitad estructural: añadir el campo dejó los cuatro
> `descriptor.test.ts` en `TS2741: Property 'motor' is missing`.

---

## 2 · La sonda pedía una ruta que la cadena niega — **la decisión**

Los cuatro descriptores declaran desde que existen `livenessProbe: /actuator/health/liveness` y
`readinessProbe: /actuator/health/readiness`. `SeguridadWeb` permite **exactamente**
`/actuator/health` y `/actuator/prometheus`, «nombrados uno por uno» a propósito.

Medido dentro del clúster:

```
GET /actuator/health          -> 200
GET /actuator/health/liveness -> 401
```

Los cuatro pods arrancaban, conectaban a la base —Hikari abría el pool— y el kubelet los mataba a
los ~45 s. `CrashLoopBackOff` **para siempre**, con la aplicación sana y sin un solo error en su
registro. El síntoma no se parece a su causa: lo que se ve es un pod que se reinicia, y lo que
pasa es que una política de autorización no conoce una ruta.

### La decisión: `SeguridadWeb` publica los dos grupos

Las dos salidas eran mover la sonda a `/actuator/health` —como el monolito— o abrir los dos
grupos. **Se abren los dos grupos.** Tres motivos, en orden de peso:

**(a) Lo que se perdería es real, no cosmético.** `/actuator/health` incluye el indicador de la
base de datos. Una sonda de **vida** que incluya la base le dice al orquestador «mata este proceso
cuando la base no conteste», y matarlo no devuelve la base: lo que produce es los cuatro sistemas
reiniciándose en bucle mientras el motor se recupera, tirando en cada vuelta el pool de conexiones
y el montón caliente de la JVM. Una caída del motor convertida en cinco. El grupo `liveness`
contiene **sólo** `livenessState`: contesta si el proceso está vivo, que es la única pregunta cuya
respuesta «no» se arregla reiniciando.

**(b) El coste está medido y es menor de lo que parece.** Lo que se añade a la superficie sin
token son dos **subrecursos del endpoint que ya era público**, y con `show-details: never` cada uno
contesta exactamente `{"status":"UP"}` — dicen estrictamente *menos* que su padre, que ya enumera
más indicadores. Y se nombran **uno por uno**, sin comodín: `/actuator/health/**` abriría de golpe
cualquier grupo que alguien añada después, que es justo lo que el docstring de esa clase dice que
no se hace.

**(c) No hay nada más que configurar, y eso se comprobó leyendo Spring Boot.**
`AvailabilityProbesAutoConfiguration` de Boot 4.1 lleva
`@ConditionalOnBooleanProperty(name = "management.endpoint.health.probes.enabled", matchIfMissing = true)`:
los dos grupos existen **por omisión**, sin depender de que Spring detecte la plataforma. Así que
la intención del descriptor ya era implementable y lo único que faltaba era abrir la puerta. No se
añade ninguna propiedad al `application.yaml`: una línea que repite un valor por omisión es ruido,
y lo que de verdad lo demuestra es la prueba que pide la ruta contra un servidor de verdad.

El **arranque** sigue apuntando a `/actuator/health` entero, y es deliberado: es lo que hace que un
pod no se declare arrancado hasta que llega a su base. Después del arranque, con una sola réplica,
sacar el pod de la rotación no gana nada —el ingreso contestaría 503, indistinguible de «el sistema
entero está caído», en vez del error del catálogo, que dice qué pasó—.

### La guarda que faltaba

**Nada comparaba la ruta de la sonda con lo que la cadena permite.** Ahora lo hace
`infra/verificaciones/sondas-contra-la-cadena.ts`, que **lee el Java de producción** —las
constantes `public static final String` y los argumentos del `requestMatchers(...)` que termina en
`.permitAll()`— y los compara con las sondas de los manifiestos compuestos.

Vive en `infrastructure` y no en cada sistema por lo mismo que
`checkout-en-el-espacio-de-trabajo`: este repositorio tiene los seis clones, el defecto sólo
existe al componer, y una guarda repetida cuatro veces se corrige tres.

Y **falla cuando no entiende algo**, nunca calla: un argumento que no se resuelva a un literal
lanza, y un comodín se rechaza a propósito —con él la comprobación no podría fallar nunca—.

> **Mutaciones.** Cerrar los dos grupos en `catastro/SeguridadWeb.java` (el estado exacto anterior
> a C-17) → 1 en rojo, nombrando las dos sondas, el contenedor y el remedio. Lo mismo en `rentas`,
> medido contra el servidor real de `CadenaDeIdentidadTest` → «expected: 200» en la prueba nueva.
> Las cuatro muestras del parser miden que muerde y que **no muerde de más**: una cadena en regla
> publica sus cuatro rutas, la anterior a C-17 no publica los grupos, el comodín se rechaza y lo
> que no se resuelve falla.

---

## 3 · La política de egreso no permitía DNS

Las cuatro `NetworkPolicy` abrían `TCP/5432` y `TCP/8080` y **nada más**. Una política de egreso
convierte a los pods que selecciona en «sólo lo declarado», y todo lo que esas reglas nombran —el
motor, la identidad, los sistemas hermanos— se alcanza por el nombre de un `Service`: resolverlo
es una consulta a CoreDNS, en `kube-system`.

El síntoma es `UnknownHostException` y es **intermitente** —la resolución se cachea, así que a
veces sale y a veces no—, que es peor que fallar siempre.

Medido: con la regla añadida a mano sobre el clúster, **las ocho tareas** de los cuatro sistemas
—cuatro migraciones y cuatro implantaciones— pasaron de `Failed` a `Complete`.

La plataforma lo tenía bien desde que existe (`permitirDns` en `Red.ts`, con su comentario
explicándolo). Lo que falló no fue la idea: fue que estas políticas se escribieron de cero y esa
parte no se copió.

La regla va **en el descriptor** —quien decide qué pods restringe esa política es él, el
`podSelector` es suyo— y la **guarda** va en `infrastructure`, porque un quinto sistema tampoco la
copiaría. Sin `podSelector` en el destino a propósito: lo que se abre es el puerto 53 hacia el
namespace, y nombrar `k8s-app: kube-dns` ataría la política a cómo etiqueta sus pods una
distribución de Kubernetes. Y TCP además de UDP: una respuesta que no cabe en un datagrama se
reintenta por TCP, y una política que sólo abriera UDP funcionaría hasta el día que dejara de
hacerlo, por el tamaño de una respuesta.

> **Mutación.** Quitar el objeto de la regla de DNS del descriptor de `normativa`.
> → 1 en rojo: «NetworkPolicy/kamayuk-normativa-egreso restringe la salida de los pods que
> selecciona y NO abre DNS … expected [] to deeply equal [ 'TCP/53', 'UDP/53' ]». Y 1 más en el
> propio repositorio de `normativa`.

---

## 4 · Ningún generador creaba los secretos de los cuatro sistemas — **la decisión**

`yarn secretos --ambiente stg` declaraba **nueve** `Secret`, los nueve del monolito. Los
manifiestos de los cuatro piden **diez**. **La intersección era cero**, y
`bootstrap-secretos.sh` corría, decía «Listo» y creaba cero de los diez: una herramienta que
contesta que sí porque no está mirando, la misma forma exacta que `yarn capacidad` tenía antes de
C-16.

El desajuste tenía **dos mitades**, y la segunda no estaba en el encargo: `claves()` de cada
descriptor nombraba `kamayuk-<sistema>-app` —sin el ambiente— mientras el `secretKeyRef` pedía
`kamayuk-<sistema>-<ambiente>-app`. Aun componiendo los descriptores no habrían coincidido. Ahora
el nombre sale de `e.secretoDe(...)`, el mismo que usan los manifiestos.

### La decisión: son **espejos**, no entradas propias

Y no es una preferencia: **la impone PostgreSQL**. Los cuatro se conectan con `sgtm_app` y migran
con `sgtm_owner`, que son roles **del clúster** —los crea el `crear-roles.sql` de cada sistema con
el mismo nombre— y un rol tiene **una** contraseña. Ocho valores generados por separado dejarían a
siete de los ocho sin poder conectarse, con un «password authentication failed» que se lee como
clave mal generada y es un modelo mal entendido. Peor: `verificar-claves-distintas.sh` exigiría
justamente lo contrario de lo que hace falta.

Así que ocho de los diez —más el del ingestor, nueve— son **el mismo valor publicado en el
namespace de quien lo consume**. El inventario los marca con `espejoDe`, y `bootstrap-secretos.sh`
los **copia** de su origen en base64, sin decodificar y sin pasar por `argv` de ningún proceso
—un valor en la línea de órdenes lo ve cualquiera con `ps`, que es el mismo motivo por el que el
migrador rechaza argumentos—.

El décimo, `kamayuk-rentas-<amb>-catastro`, **no** es espejo: no es la clave de un rol del motor,
así que no hay ningún valor del que sea copia y se genera como cualquier otra.

De ahí salen dos consecuencias que se escriben en vez de descubrirse:

- Un espejo **converge a su origen en cada corrida**, no sólo cuando falta. Tras `rotar-clave.sh`
  los espejos quedan con el valor viejo hasta la siguiente corrida del bootstrap.
- **Ningún espejo lleva `rolDePostgres`**, y eso es lo que mantiene correcto a
  `asignar-claves.sh`: con ellos dentro haría cinco `ALTER ROLE sgtm_app` seguidos con valores que
  tienen que ser el mismo, y el último decidiría.

`--namespace` deja de existir en `bootstrap-secretos.sh`: los secretos viven en **cinco** espacios
de nombres y cuál es cuál lo dice el inventario. Un valor en la línea de órdenes sólo podría
acertar con uno de los cinco.

**`rol_ingestor_catastro` no necesita nada nuevo**: ya está en el inventario con su
`rolDePostgres` y su `baseDeDatos: "rentas"` desde C-7, y `asignar-claves.sh` le da `LOGIN` como a
los demás. El hueco 3 de C-7 era que **nadie corría ese guion** contra un clúster ya creado, no
que faltara la entrada.

> **Mutaciones.** Devolver a `catastro` el nombre sin ambiente (`kamayuk-catastro-app`)
> → 1 en rojo: «estos `secretKeyRef` no los genera nadie … [ 'kamayuk-catastro-stg-app/clave' ]».
> Quitarle a esa clave el `rol: "sgtm_app"` → 2 en rojo: «expected … to have a length of 9 but got 8»
> en los dos ambientes.

---

## 5 · Un `Deployment` que termina — **la decisión**

`kamayuk-rentas-batch` arranca, registra «No TaskScheduler/ScheduledExecutorService bean found for
scheduled processing», **sale con código 0** a los once segundos y Kubernetes lo vuelve a crear:
`CrashLoopBackOff` con siete reinicios, sobre un proceso que hizo exactamente lo que tenía que
hacer.

**Y lo dice el propio código de `rentas`.** `CorrerElIngestor` y `CorrerLaAntiEntropia` son
`ApplicationRunner` del perfil `batch`, y su javadoc explica por qué no son `@Scheduled`: «en los
cuatro backends no hay **ni un** `@EnableScheduling` […] y el perfil `batch` **termina el proceso**
con `web-application-type: none`».

### La decisión: se quita

**Se quita, y no se convierte en `CronJob` ni se le da algo que lo mantenga vivo.**

El trabajo del perfil `batch` **ya tiene su forma, y son dos**: `implantacion()` —un `Job`, que
corre una vez— y `lotes()` —el `CronJob` del ingestor, que corre en su ventana—. Los dos crean su
pod cuando hay trabajo y lo dejan morir al acabar. Un `Deployment` dice «esto tiene que estar
corriendo siempre», y aquí no hay nada que lo esté.

Un `CronJob` más tampoco: un `CronJob` necesita una ventana **y algo que correr en ella**, y este
sistema ya tiene el suyo. Añadir un segundo con la misma imagen y ningún runner que invocar sería
el mismo vacío con horario.

Lo que costaba tenerlo es más que un pod en rojo: un `Deployment` sólo admite
`restartPolicy: Always`, así que Kubernetes **no puede distinguir «terminó» de «se murió»**. La
forma miente en las dos direcciones —afirma que algo corre siempre cuando no corre nada, y reporta
como fallo una salida con éxito—. Y un `CrashLoopBackOff` permanente en el tablero es ruido que
acaba no mirándose, que es lo que hace que el día que reviente algo de verdad tampoco se mire.

`ADR-0003` sigue intacto: un artefacto, dos perfiles. Lo que cambia es **cómo se invoca** el
segundo.

> **Mutación.** Devolver el `Deployment` del perfil `batch` a `rentas`.
> → 2 en rojo en `infrastructure` —el censo y el contraste— y 1 en el propio repositorio de
> `rentas`.

---

## La evidencia: el despliegue entero, desde cero, con lo generado

Sobre la misma EC2 (k3s v1.36.4, 8 CPU / 15,25 GiB asignables). **Los cuatro namespaces se
borraron enteros** antes de empezar, así que nada de lo que sigue viene de un parche anterior:

```
1. kubectl delete namespace kamayuk-{rentas,catastro,normativa,caja}-stg   (y se espera a que desaparezcan)
2. infra/secretos/bootstrap-secretos.sh --ambiente stg      # el generador, sin --namespace
3. yarn manifiestos --ambiente stg > /tmp/m4.json           # 104 objetos, sin un solo parche a mano
4. kubectl apply -f /tmp/m4.json
```

El paso 2, entero:

```
Completando los secretos que se generan...
  · kamayuk-rentas-stg-catastro/clave: generada (huella c2e2acf8fb65)
Copiando los espejos a los namespaces que los consumen...
  · kamayuk-rentas-stg/kamayuk-rentas-stg-app/clave: copiado de sgtm-stg/sgtm-stg-postgres-app/clave-app
  · kamayuk-rentas-stg/kamayuk-rentas-stg-owner/clave: copiado de sgtm-stg/sgtm-stg-postgres-owner/clave-owner
  · kamayuk-rentas-stg/kamayuk-rentas-stg-ingestor/clave: copiado de sgtm-stg/sgtm-stg-postgres-ingestor-catastro/clave-ingestor
  · kamayuk-catastro-stg/… -app, -owner       · kamayuk-normativa-stg/… -app, -owner
  · kamayuk-caja-stg/… -app, -owner
Listo. Ningun valor se imprimio en esta salida — solo huellas de lo que se generó.
```

Uno generado y nueve copiados: los diez que los manifiestos montan, y ninguno más.

### Las ocho tareas, `Complete`

```
NAMESPACE               NAME                                          STATUS     COMPLETIONS   DURATION
kamayuk-caja-stg        kamayuk-caja-implantacion-c755de214934        Complete   1/1           22s
kamayuk-caja-stg        kamayuk-caja-migracion-c755de214934           Complete   1/1            7s
kamayuk-catastro-stg    kamayuk-catastro-implantacion-c755de214934    Complete   1/1           27s
kamayuk-catastro-stg    kamayuk-catastro-migracion-c755de214934       Complete   1/1           17s
kamayuk-normativa-stg   kamayuk-normativa-implantacion-c755de214934   Complete   1/1           20s
kamayuk-normativa-stg   kamayuk-normativa-migracion-c755de214934      Complete   1/1            7s
kamayuk-rentas-stg      kamayuk-rentas-implantacion-c755de214934      Complete   1/1           25s
kamayuk-rentas-stg      kamayuk-rentas-migracion-c755de214934         Complete   1/1            6s
```

### Los cuatro `web`, `1/1 Running` con 0 reinicios, a los 6m33s

`kubectl get pods -A`, `2026-09-05T09:47:34Z`:

```
NAMESPACE               NAME                                                READY   STATUS      RESTARTS   AGE
kamayuk-caja-stg        kamayuk-caja-implantacion-c755de214934-4p92c        0/1     Completed   0          6m33s
kamayuk-caja-stg        kamayuk-caja-migracion-c755de214934-gf7t5           0/1     Completed   0          6m33s
kamayuk-caja-stg        kamayuk-caja-web-9f88c6c45-dprtd                    1/1     Running     0          6m33s
kamayuk-catastro-stg    kamayuk-catastro-implantacion-c755de214934-27tzw    0/1     Completed   0          6m23s
kamayuk-catastro-stg    kamayuk-catastro-implantacion-c755de214934-mgrlq    0/1     Init:Error  0          6m33s
kamayuk-catastro-stg    kamayuk-catastro-migracion-c755de214934-9wlcb       0/1     Completed   0          6m22s
kamayuk-catastro-stg    kamayuk-catastro-migracion-c755de214934-xrvqv       0/1     Error       0          6m33s
kamayuk-catastro-stg    kamayuk-catastro-web-64d576b8b5-4wpm4               1/1     Running     0          6m33s
kamayuk-normativa-stg   kamayuk-normativa-implantacion-c755de214934-qrxd4   0/1     Completed   0          6m33s
kamayuk-normativa-stg   kamayuk-normativa-migracion-c755de214934-drvsm      0/1     Completed   0          6m33s
kamayuk-normativa-stg   kamayuk-normativa-web-5bb6ffcf67-2pvzq              1/1     Running     0          6m33s
kamayuk-rentas-stg      kamayuk-rentas-implantacion-c755de214934-2nrdp      0/1     Completed   0          6m33s
kamayuk-rentas-stg      kamayuk-rentas-migracion-c755de214934-fldm9         0/1     Completed   0          6m33s
kamayuk-rentas-stg      kamayuk-rentas-web-d668b5865-xb7f9                  1/1     Running     0          6m33s
kube-system             coredns-…                                           1/1     Running     0          92m
kube-system             local-path-provisioner-…                            1/1     Running     0          92m
kube-system             metrics-server-…                                    1/1     Running     0          92m
sgtm-stg                sgtm-stg-postgres-7cf7c86d69-2sxmd                  2/2     Running     0          91m
sgtm-stg                sgtm-stg-identidad-8fd6f54b7-qn7rh                  1/1     Running     5 (69m)    91m
sgtm-stg                sgtm-stg-correo / observabilidad ×5                 1/1     Running     0          91m
sgtm-stg                sgtm-stg-{aplicacion,implantacion}                  0/1     Init:0/1    0          91m
sgtm-stg                sgtm-stg-{interfaz ×2, migracion}                   0/1     ImagePullBackOff 0     91m
```

**Y `kamayuk-rentas-batch` ya no está**: no aparece porque no se compone.

Lo de `sgtm-stg` es el archivo histórico y no es un defecto de esto: sus imágenes no existen con
esta etiqueta.

### Los dos pods `Error` de `catastro` son el PRIMER intento de sus dos Jobs

Los dos Jobs están `Complete`. El primer intento murió con:

```
PSQLException: Connection to sgtm-stg-postgres.sgtm-stg:5432 refused.
```

**El nombre resolvió** —lo dice el propio mensaje— y lo que falló fue el TCP. La cronología lo
explica:

```
09:40:36   namespace creado por `bootstrap-secretos.sh`, SIN etiquetas
09:41:01   `kubectl apply`: el pod arranca Y su NetworkPolicy se crea, el mismo segundo
09:41:02   «Connection refused»
09:41:1x   reintento (backoffLimit: 3) -> Complete
```

La política de la plataforma que deja entrar a postgres selecciona el namespace de origen por su
etiqueta `kamayuk-sistema: si`, y esa etiqueta la pone el `apply` —no el guion de secretos, que
crea el namespace pelado—. Es una **ventana de un segundo** en el primer despliegue de un
namespace, la cubre el `backoffLimit`, y se declara abajo en vez de taparse: cerrarla exigiría que
el guion de secretos supiera con qué etiquetas se define un namespace, que es composición de
`infrastructure` y no suya.

### Y las rutas del actuator, medidas desde dentro de los cuatro pods

```
                              rentas   catastro   normativa   caja   cuerpo
/actuator/health                 200        200         200    200   {"groups":["liveness","readiness"],"status":"UP"}
/actuator/health/liveness        200        200         200    200   {"status":"UP"}
/actuator/health/readiness       200        200         200    200   {"status":"UP"}
/actuator/health/db              401        401         401    401   (la cadena lo niega: no hay comodin)
/actuator/prometheus             200        200         200    200   # HELP application_ready_time_seconds …
```

Es el coste de la decisión 2, medido y no supuesto: los dos grupos dicen **menos** que su padre
—que además enumera los grupos— y el cuarto sigue negado, así que lo que se abrió son dos rutas y
no un comodín.

## Huecos declarados

1. **La anti-entropía de `rentas` no tiene `CronJob`.** `CorrerLaAntiEntropia` existe, es un
   `ApplicationRunner` del perfil `batch` y su propio javadoc dice que «su horario es de P7». Al
   quitar el `Deployment` de `batch` no se pierde nada —ese `Deployment` nunca la ejecutó: sale
   antes, y su bean es `@ConditionalOnProperty("sgtm.anti-entropia.municipalidad")`, que el
   descriptor no declara—, pero queda dicho que **hoy nadie la invoca**.

2. **El `CronJob` del ingestor sigue suspendido**, y por el motivo de C-8: el feed de `catastro`
   está detrás de `@RequiereAcceso` y no hay identidad de servicio (ADR-0028 §2, RFC 8693). La
   credencial `kamayuk-rentas-<amb>-catastro` se genera y **no sirve**.

3. ~~La cifra de pruebas del encargo no reproduce.~~ **Reproduce, y casi se declara un hueco
   falso.** Contando sólo `build/test-results/test/` salían 3 138 · 987 · 613 · 683 —cuatro menos
   que el encargo en los cuatro repositorios, un desfase idéntico que era la pista—: los cuatro
   backends tienen una **segunda** tarea de pruebas, `pruebaDeArranque`
   (`ArranqueDeLaAplicacionTest`, 4 casos), que escribe en su propio directorio. Con ella, la
   línea base es exactamente la del encargo. Queda anotado porque el modo de fallo es el de
   siempre: una medida que no mira todo el sujeto sigue contestando, y su respuesta —«la cifra
   bajó»— se lee igual que una de verdad.

4. **La guarda de sondas cubre los cuatro sistemas, no el monolito.** Su interfaz sí es Java, pero
   `sgtm` es el archivo histórico y su contenedor de interfaz sondea `/` contra nginx, que no pasa
   por ninguna cadena de Spring.

5. **Una ventana de un segundo entre el namespace y su etiqueta.** `bootstrap-secretos.sh` crea
   el namespace de cada sistema —tiene que hacerlo: los `Secret` van dentro— y lo crea **pelado**,
   porque las etiquetas de ese namespace las compone `infrastructure` al aplicar. La política de
   la plataforma que deja entrar a PostgreSQL selecciona por `kamayuk-sistema: si`, así que entre
   una cosa y la otra hay un instante en que un pod de ese namespace es rechazado. Medido: el
   primer intento de los dos Jobs de `catastro` murió a los 1 s con «Connection refused», y el
   reintento de `backoffLimit: 3` los dejó `Complete`. **No se cierra aquí a propósito**: hacerlo
   exigiría que el guion de secretos supiera con qué etiquetas se define un namespace de sistema,
   y eso sería un segundo sitio donde olvidarse de una.

6. **Los espejos no se propagan al rotar.** `rotar-clave.sh` cambia el origen y los espejos quedan
   viejos hasta la siguiente corrida de `bootstrap-secretos.sh`. Está escrito en el tipo, en el
   guion y aquí; no hay guarda que lo obligue.
