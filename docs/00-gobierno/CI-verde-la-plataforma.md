# CI verde — los tres trabajos rojos de `infrastructure`

**Estado: los tres arreglos aplicados y sus mutaciones medidas. El estado de la corrida
real esta al final, con su id.**

Los tres trabajos rojos que quedaban tras C-20 §6 no eran defectos del renombrado a
Kamayuk: los tres son consecuencia del **corte en cinco repositorios**, y los tres tienen
la misma forma —una herramienta que seguia describiendo el mundo del monolito—. Ninguno
se puede reproducir en local: necesitan `kind`, un motor levantado y un Prometheus real,
asi que la evidencia que vale es la corrida de CI.

| Trabajo | Sintoma | Causa |
|---|---|---|
| `El motor, levantado y con el aislamiento verificado` | `./gradlew: No such file or directory` | `infrastructure/backend/` no es un proyecto Gradle: el Java se fue a los cuatro sistemas |
| `Los secretos se generan solos, y ninguno se repite` | `Error from server (NotFound): secrets "kamayuk-rentas-stg-app" not found` | Un `--namespace` por ambiente, y el inventario abarca cinco |
| `Los tableros muestran datos de verdad` | «el archivo montado en el Pod nunca reflejo el ConfigMap actualizado en 90s» | El repunte del scrape era un no-op silencioso desde C-19 |

---

## 1 · El motor: de que arbol sale `verificarAislamiento`, y por que son los cuatro

`verificar-el-motor.sh --con-aislamiento` hacia `cd "$INFRA/../backend"`. Ese directorio
sigue existiendo y **no es un proyecto Gradle**: tiene 70 archivos y los 70 son SQL —las
migraciones del monolito y el `crear-roles.sql` que `componentes/fuentes.ts` lee para
armar la inicializacion de **este mismo motor**—. No hay `gradlew`, ni
`settings.gradle.kts`, ni `build.gradle.kts`, y no los va a haber: seria un build sin
fuentes.

### La decision: los cuatro, no uno de muestra

Lo que este trabajo demuestra —y es el unico del flujo que lo demuestra— es que el
aislamiento multi-tenant sigue en pie **contra el motor que el manifiesto levanta**, o sea
contra PostgreSQL configurado como en produccion, con sus roles, sus `GRANT` y su imagen.
No contra el Testcontainers que cada sistema usa en su propio flujo `Backend`.

Cada uno de los cuatro sistemas trae **su** esquema, **sus** politicas de RLS y **sus**
particiones, y su `AislamientoMultiTenantTest` recorre sus tablas. Correr solo `rentas`
dejaria a los otros tres verificados unicamente contra otra imagen y otra configuracion, y
la eleccion de cual correr seria arbitraria y sin nadie que la sostenga. El motor ya
comprobaba arriba que las cuatro bases existen con sus roles y que `catastro` tiene
PostGIS; esto es lo que comprueba que ademas **aislan**.

El coste esta acotado: es un trabajo de CI, los cuatro corren en serie y el motor es
desechable.

### El fosil que habria dejado el arreglo obvio en verde sin verificar nada

Arreglar solo la ruta **no bastaba**, y esta es la parte que importa. Las propiedades del
motor externo se llaman hoy `kamayuk.pruebas.postgres.*`; el guion pasaba
`-Dsgtm.pruebas.postgres.*`. Un nombre que no se reconoce **no da error**: lo que hace
`MotorPostgres.resolver()` cuando no encuentra la propiedad es **levantar su propio
contenedor con Testcontainers** —lo dice su propio plugin, «por omision las pruebas
levantan un contenedor»—. El resultado habria sido un trabajo **verde** que verifica un
motor que no es el del manifiesto, indistinguible del bueno.

Por eso el arreglo trae una guarda: se toma la huella de los cinco roles del cluster antes
del bucle y se compara despues. `BaseDeDatosDePrueba.provisionarRoles` hace `ALTER ROLE
… LOGIN PASSWORD` sobre los cinco; contra Testcontainers eso pasa en el contenedor de la
prueba y **aqui no cambia nada**.

**La primera version de esa guarda estaba mal, y lo dijo la ejecucion.** Contaba las bases
`sgtm_prueba_<uuid>` que `conMotorExterno` crea. Medido: `MotorPostgres.close()` las borra
con `DROP DATABASE … WITH (FORCE)`, asi que al terminar el bucle **no queda ninguna** y ese
censo habria dado **rojo en falso**. Comprobado contra PostgreSQL 16.15: durante la corrida
habia una (`sgtm_prueba_c86aff8b`), al terminar habia cero. La huella de los roles, en
cambio, sobrevive.

### Mutaciones

Todas contra un PostgreSQL 16.15 real —local, con PostGIS 3.4.4— con los `crear-roles.sql`
de los cuatro sistemas aplicados.

| # | Rotura | Resultado |
|---|---|---|
| M1 | Devolver el nombre viejo de la propiedad: `-Dsgtm.pruebas.postgres.*` | **`MotorPostgres` se va a Testcontainers**, tal como se predijo. La huella de los cinco roles **no cambia** (`eb872bad…` antes y despues), asi que la guarda da rojo. En esta maquina el intento muere en «Could not find a valid Docker environment»; **en CI, donde Docker funciona, el contenedor arranca y la corrida sale VERDE** — que es exactamente el defecto que la guarda existe para impedir |
| M2 | El sentido positivo: los nombres correctos, con los roles puestos como los deja la inicializacion del motor (`kamayuk_readonly` NOLOGIN) | La huella **cambia** (`074a3502…` → `af535160…`) y `kamayuk_readonly` pasa de `canlogin=false` a `true`. La guarda pasa |
| M3 | El censo de bases `sgtm_prueba_*` en vez de la huella de roles | **Rojo en falso**: 0 bases al terminar. Es por lo que la guarda no se escribio asi |
| M4 | Los cuatro `verificarAislamiento` en serie contra el mismo motor externo, con `--rerun-tasks` | Los cuatro en verde: `rentas` 17 s, `catastro` 16 s, `normativa` 15 s, `caja` 12 s |

---

## 2 · Los secretos: dos clases de entrada, y solo se comprobaba una

`verificar-claves-distintas.sh` recibia **un** `--namespace` por ambiente y buscaba ahi las
veintiuna entradas. Diez de las veintiuna viven fuera del namespace de la plataforma, asi
que el guion moria en la primera con un `NotFound`.

Y detras del `NotFound` habia una segunda mitad que el error tapaba: **nueve de las
veintiuna son espejos** (`espejoDe`), y su valor **tiene que coincidir** con su origen. No
es una preferencia: los cuatro sistemas se conectan con `kamayuk_app` y migran con
`kamayuk_owner`, que son roles **del clúster**, y PostgreSQL le da a un rol **una**
contrasena (C-17 punto 4). Exigirles «todas distintas» seria exigir justamente lo contrario
de lo que hace falta.

### La decision: no se saltan, se comprueban al reves

La salida comoda era filtrar los espejos y comprobar solo las doce que se generan. Se
descarto: un espejo que se hubiera regenerado por su cuenta **pasaria** esa comprobacion
—su valor seria nuevo y unico— y dejaria a su sistema sin poder abrir sesion, con un
«password authentication failed» que se lee como clave mal generada y es un modelo mal
entendido. Es el modo de fallo que C-17 escribio en el javadoc de `espejoDe` y que nadie
habia podido ver fallar, porque este guion nunca llego a correr con el inventario completo.

Asi que el guion comprueba **las dos direcciones**: las que se generan, todas distintas;
los espejos, iguales a su origen. Y el namespace sale de cada entrada del inventario, no de
la linea de ordenes — que es lo mismo que C-17 le hizo a `bootstrap-secretos.sh`, por el
mismo motivo: un valor tecleado solo podria acertar con uno de los cinco.

### La guarda contra quedarse sin nada que comprobar

Las dos clases se **derivan** del inventario. Un cambio que dejara una vacia —un `espejoDe`
que dejara de emitirse, un filtro que dejara de casar— convertiria su mitad en una
comprobacion que no puede fallar, en verde. Por eso el guion exige que las dos tengan
filas.

### Mutaciones

Contra un `kubectl` de mentira que sirve un valor por `(namespace, secreto, clave)`, con
los espejos copiando el de su origen — la misma tecnica de #708 y #675. Camino feliz: «24
claves generadas (todas distintas) y 18 espejos (todos iguales a su origen)».

| # | Rotura | Resultado |
|---|---|---|
| M2a | El guion **exacto** anterior al arreglo, en su sitio | `Error from server (NotFound): secrets "kamayuk-rentas-stg-app" not found` — el rojo de CI, byte a byte |
| M2b | Dos entradas **generadas** con el mismo valor (`postgres-carga` = `postgres-owner`) | Rojo nombrando las dos. Es el escenario del paso «Demostracion» del flujo, que sigue funcionando |
| M2c | Un **espejo** que no coincide con su origen (`kamayuk-rentas-stg-app` regenerado) | Rojo nombrando el espejo, su origen y el remedio. **Es la mitad que no comprobaba nadie** |
| M2d | Meter los espejos en «todas distintas», como antes | Rojo por la guarda de vacuidad |
| M2d' | Lo mismo, **y ademas** quitar esa guarda, para ver el requisito equivocado | Rojo listando los 9 espejos y sus 3 origenes como «duplicados»: el aviso de C-17 hecho salida de terminal |
| M2e | Que el inventario deje de decir cual es espejo | Rojo: «o el inventario dejo de decirlo o esta comprobacion dejo de leerlo. En los dos casos aqui no se verifica nada» |

`.github/workflows/infra.yml` pierde los dos `--namespace`.

### El tercer sitio con la misma verdad, que solo aparecio en CI

Con el guion arreglado, la corrida `33981724106` dejo el paso «Ninguna clave se repite» en
verde —«Comprobadas 24 claves generadas (todas distintas) y 18 espejos (todos iguales a su
origen) entre 2 ambiente(s)»— **y el `NotFound` se movio al paso siguiente**: «Volver a
correrlo no cambia nada, en NINGUNA clave del inventario», que llevaba el mismo fosil
escrito a mano dentro del flujo (`kubectl -n "kamayuk-$1"` para las veintiuna). Es
literalmente el segundo sitio donde olvidarse, y no se veia porque el primero fallaba
antes.

**Y arreglarlo destapo un tercer defecto que no fallaba nunca**: ese fragmento componia sus
lineas con `join("\n")`, sin salto final, y `while read` descarta la ultima. Medido con el
inventario real: **20 entradas de 21**, la que se perdia era `kamayuk-caja-stg-owner`. El
comentario que hay encima de ese paso dice que existe precisamente para que «una entrada
nueva no pueda regenerarse en cada corrida sin que nada lo diga» — y la entrada que no
miraba era siempre la ultima, que es justo la mas nueva. Con cada linea llevando su salto,
mide las 21.

---

## 3 · Los tableros: un `replace()` que no casaba con nada

El guion repunta el `job_name: aplicacion` de Prometheus al exportador sintetico y espera a
ver el valor nuevo dentro del Pod. Desde C-19, `stg` no despliega el monolito y su
`prometheus.yml` **no declara ningun `job_name: aplicacion`** —son cinco jobs y ninguno es
ese, medido—. La sustitucion era un no-op, asi que la espera no podia terminar nunca.

**Y el sintoma no se parecia a su causa**: el guion acusaba al kubelet de no sincronizar el
volumen del ConfigMap, cuando lo que pasaba es que no se habia escrito nada. Noventa
segundos de espera para un mensaje que manda a buscar al sitio equivocado.

### La decision: anadir el job cuando el ambiente no lo declara

El tablero **no se templa por ambiente**: es un JSON compartido por los dos y partirlo
seria un segundo sitio donde olvidarse (C-19, hueco 4). Asi que sus dos paneles de la
aplicacion —JVM y peticiones HTTP— hay que poder comprobarlos aqui.

Y hacerlo no verifica una cosa distinta de la que ya se verificaba: **este guion nunca
raspo la aplicacion real**. Filtra el `Deployment` de la aplicacion del manifiesto desde
que existe —el nodo unico de `kind` no tiene CPU— y sus dos paneles los sirve el exportador
sintetico, que es lo que su propio docstring dice. Lo unico que cambia es que el job ahora
tambien se pone donde el ambiente no lo trae.

Se conserva el otro sentido: si el ambiente **si** lo declara —`prod`, que despliega el
monolito— se repunta el suyo en vez de anadir un segundo. Un ambiente con dos `job_name:
aplicacion` no es configuracion valida de Prometheus, y ahi ganaria el objetivo viejo.

Y el repunte **ya no puede ser un no-op**: si tras la transformacion el resultado no apunta
al exportador sintetico, el guion falla en el acto y dice por que, en vez de 90 s despues
culpando al kubelet.

### Mutaciones

Contra los `prometheus.yml` reales de los dos ambientes, extraidos de
`yarn manifiestos`.

| # | Rotura | Resultado |
|---|---|---|
| M3a | El `replace()` ciego anterior al arreglo | `stg` sale con **0** `job_name: aplicacion` y sin apuntar al sintetico, **y no lanza**: es el no-op que produce la espera de 90 s. `prod` sigue apuntando a `kamayuk-prod-aplicacion:8080` |
| M3b | El arreglo **sin** la guarda del no-op | Identico a M3a: el silencio vuelve |
| M3c | El arreglo con su guarda, pero la sustitucion deja de casar | **Lanza en el acto**: «El repunte del scrape no cambio nada: `prometheus.yml` sigue sin apuntar a aplicacion-sintetica:8080» |
| M3d | CONTRASTE: anadir **siempre**, tambien donde el job existe | `prod` queda con **dos** `job_name: aplicacion` y el primero sigue apuntando al servicio real. Es por lo que la transformacion mira antes si existe |

Camino feliz medido en los dos: `stg` (anade) y `prod` (repunta) acaban con **exactamente
un** `job_name: aplicacion` apuntando a `aplicacion-sintetica:8080`, y seis jobs en total.

---

## 4 · Lo que no cambia

- `yarn verificar`: **648 pruebas en 31 archivos**, todas verdes. Ninguna prueba nueva:
  los tres arreglos son de guiones que CI ejecuta, y lo que los mide es CI.
- `yarn manifiestos` de los dos ambientes: **identicos byte a byte** —`stg` 297 828 bytes,
  `prod` 318 596—. No se toco ningun componente.
- `yarn capacidad`: `stg` «cabe», `prod` «no-cabe» con su brecha declarada. Igual que antes.

---

## 5 · Huecos declarados

1. **Los tres arreglos no se pueden ejecutar enteros en local, y no se ejecutaron.** El
   trabajo del motor necesita que el puerto publicado de un contenedor sea alcanzable, y en
   esta maquina **la publicacion de puertos de Docker Desktop no funciona para ningun
   contenedor** —comprobado tambien con un `nginx:alpine` arm64 nativo, que tampoco
   contesta—; los otros dos necesitan `kind` y un Prometheus real. Lo que si se ejecuto es
   la **sustancia** de cada arreglo: los cuatro `verificarAislamiento` contra un PostgreSQL
   16.15 real, el guion de secretos contra un `kubectl` de mentira, y la transformacion del
   scrape contra los `prometheus.yml` reales de los dos ambientes.
2. **La mitad «verde» de M1 no se pudo observar aqui.** Con el nombre viejo de la propiedad,
   el repliegue a Testcontainers muere en esta maquina por falta de Docker utilizable; en
   CI arrancaria y la corrida saldria verde. Lo que si esta medido es lo otro: que la huella
   de los roles no cambia, que es la senal por la que la guarda decide.
3. **`caja` fallo una vez y no se reprodujo.** En la primera pasada del bucle —sin
   `--rerun-tasks`— cayo 1 de 46 pruebas de `:kamayuk-caja-esquema:test`, y el informe XML
   no registro ningun `failure`. Con `--rerun-tasks`, sola y dentro del bucle completo,
   paso las dos veces. El candidato mas probable es
   `ProvisionamientoCompartidoTest` («cuatro corridas provisionando a la vez»), que es una
   prueba de concurrencia bajo carga. Queda dicho: si el trabajo `motor` sale rojo por
   `caja` de forma intermitente, es ahi donde hay que mirar y no en este cambio.
4. **La huella de los roles solo distingue dentro de UNA corrida del guion.** Sirve porque
   el motor se crea desde cero cada vez y `kamayuk_readonly` nace `NOLOGIN` —el propio guion
   lo comprueba en el paso 3— mientras `provisionarRoles` le da `LOGIN`. Contra un motor que
   ya hubiera sido provisionado antes, la huella podria no moverse. No se cierra porque
   apuntar este guion a un motor en servicio esta prohibido por su propio docstring.
5. **No se toco ninguno de los cuatro sistemas.** Otro agente esta arreglando su flujo
   `Backend`. El unico nombre suyo del que este arreglo depende es el prefijo
   `sgtm_prueba_`, y ya no: la guarda dejo de usarlo al cambiar de detector.
6. **No se corrio `pulumi up` contra ningun ambiente.**

---

## Verificar antes de afirmar

| Verificacion | Como se demostro que puede fallar | Resultado |
|---|---|---|
| Los tres trabajos rojos de `infrastructure`, arreglados (el aislamiento contra el motor del manifiesto, el inventario de secretos en cinco namespaces, y el repunte del scrape del tablero) | Doce roturas, cada una aplicada sola y restaurada **por copia comparada con `cmp`**: devolver el nombre viejo de la propiedad del motor externo (`-Dsgtm.pruebas.postgres.*`); medir el motor externo por las bases `sgtm_prueba_*` en vez de por la huella de los roles; el guion de secretos **exacto** anterior al arreglo, con su `--namespace`; dos entradas generadas con el mismo valor; un espejo que no coincide con su origen; meter los espejos en «todas distintas»; lo mismo **sin** la guarda de vacuidad; que el inventario deje de decir cual es espejo; el `replace()` ciego del scrape; el arreglo del scrape **sin** su guarda de no-op; el arreglo con la guarda y la sustitucion sin casar; y anadir el job **siempre**, tambien donde ya existe | **La primera es la que sostiene el arreglo del motor**: arreglar solo la ruta habria dejado el trabajo en VERDE verificando otro motor, porque un nombre de propiedad que no se reconoce no da error — `MotorPostgres.resolver()` levanta su propio contenedor con Testcontainers. Medido contra PostgreSQL 16.15 real: con el nombre viejo la huella de los cinco roles **no cambia** (`eb872bad…` antes y despues) y con el correcto **si** (`074a3502…` → `af535160…`, con `kamayuk_readonly` pasando de `canlogin=false` a `true`). **La segunda es una guarda que nacio equivocada y lo dijo la ejecucion**: `MotorPostgres.close()` borra la base de prueba con `DROP DATABASE … WITH (FORCE)`, asi que contarlas da **cero al terminar** y habria sido un rojo en falso —durante la corrida habia una, `sgtm_prueba_c86aff8b`, y al final ninguna—. La tercera reproduce el rojo de CI byte a byte. **La quinta es la mitad que no comprobaba nadie**: un espejo regenerado por su cuenta pasa «todas distintas» —su valor es nuevo y unico— y deja a su sistema sin poder abrir sesion, el modo de fallo que C-17 escribio en el javadoc de `espejoDe` y que nunca pudo verse fallar porque el guion no llego a correr con el inventario completo. **La septima ensena el requisito equivocado**: lumpar los espejos lista los 9 y sus 3 origenes como duplicados, o sea exige lo contrario de lo que PostgreSQL impone. **La novena y la decima son el mismo silencio**: `stg` sale con 0 `job_name: aplicacion`, sin apuntar al sintetico y **sin lanzar**, que es el no-op que produce la espera de 90 s acusando al kubelet de no sincronizar un ConfigMap que nadie escribio; con la guarda puesta (la undecima) el guion falla en el acto y dice por que. **Y la duodecima es el contraste que impide pasarse de listo**: anadir siempre deja a `prod` con **dos** `job_name: aplicacion` y el primero apuntando al servicio real, que no es configuracion valida de Prometheus. Los cuatro `verificarAislamiento` corren en serie y en verde contra un PostgreSQL 16.15 con PostGIS 3.4.4 y los cuatro `crear-roles.sql` aplicados. `yarn verificar` 648/648, y `yarn manifiestos` de los dos ambientes **identico byte a byte** (297 828 y 318 596). **Lo que no se pudo ejecutar queda declarado**: los tres trabajos necesitan `kind`, un motor levantado o un Prometheus real, y en esta maquina la publicacion de puertos de Docker Desktop no funciona **para ningun contenedor** —comprobado con un `nginx:alpine` arm64 nativo—, asi que la evidencia de los tres es la corrida de CI. **Y la corrida real anadio dos hallazgos que ninguna prueba local podia dar**: con el guion arreglado el `NotFound` se movio al paso siguiente del mismo trabajo, que llevaba el mismo fosil escrito a mano dentro del flujo —el segundo sitio con la misma verdad, invisible mientras el primero fallara antes—; y arreglar ese destapo que componia sus lineas con `join("\\n")` sin salto final, de modo que `while read` descartaba la ultima y **medía 20 de 21** —la perdida era `kamayuk-caja-stg-owner`, y el paso existe precisamente para que una entrada nueva no se regenere sin que nada lo diga: la que no miraba era siempre la ultima, o sea la mas nueva— |
