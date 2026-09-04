# C-7 — Que las cuatro aplicaciones arranquen

**Fecha:** 2026-09-05. **Repositorios tocados:** `rentas`, `catastro`, `caja`, `normativa` e
`infrastructure`. **`sgtm` no se tocó:** su `git status` queda limpio.

C-6 fue a orquestar la siembra y, para poder medirla, tuvo que arrancar las aplicaciones. Ahí
encontró lo que este trabajo cierra: **ninguna de las cuatro arrancaba, en ningún perfil**, y dos de
ellas —`catastro` y `caja`— **no se habían arrancado nunca**.

> **El resultado, en una línea: las cuatro arrancan, medido ejecutándolas, y hay una prueba por
> sistema que lo sostiene y que muerde.** Y la de `catastro` se midió además dentro de su imagen de
> Docker, construida de verdad.

---

## 1. Los criterios, con su medida

| # | Criterio | Estado | Dónde |
|---|---|---|---|
| **1** | Las cuatro arrancan, demostrado ejecutando, con una prueba por sistema que muerde | **Cumplido** | §3 y §4 |
| **2** | Los seis puntos cerrados o con su motivo escrito | **Cumplido** | §2, uno a uno |
| **3** | `yarn manifiestos --ambiente stg` compone los cuatro y la auditoría pasa; el inventario nombra lo que falta | **Cumplido** | §2.4 y §2.6 |
| **4** | Las formas del JSON no cambian; `desajustesVivos()` sigue vacío | **Cumplido, y medido byte a byte** | §5 |
| **5** | Las cifras no bajan | **Cumplido**, las cinco suben | §7 |
| **6** | Los tres verificadores bloqueantes en verde en los repositorios tocados | **Cumplido**, y hay un cuarto | §7 |

---

## 2. Los seis puntos

### 2.1 Jackson 2 contra Jackson 3 — cerrado, y sin cambiar un byte del JSON

**Lo que había.** Spring Boot 4 autoconfigura el `JsonMapper` de **Jackson 3** (`tools.jackson`) y no
deja ningún bean de Jackson 2. Los clientes HTTP entre sistemas inyectaban
`com.fasterxml.jackson.databind.ObjectMapper`, que **nadie declara**. El síntoma, medido con el jar
de cada repositorio:

```
Parameter 0 of constructor in …DirectorioHttpDeRentas required a bean of type
'com.fasterxml.jackson.databind.ObjectMapper' that could not be found.
```

**Lo que se hizo.** Los **21 archivos de `src/main`** que usaban Jackson 2 pasan a Jackson 3 —nueve
inyectaban el mapeador y los otros doce usaban su `JsonNode`—, más 13 de prueba. El bean que se
inyecta es `tools.jackson.databind.json.JsonMapper`, que ya era la convención de este código:
`DocumentoRepositoryJdbc` de `rentas` lo inyecta así desde antes del corte.

**Y la dependencia se retira, que es lo que hace que no vuelva.** Los siete `build.gradle.kts` que
declaraban `com.fasterxml.jackson.core:jackson-databind` declaran ahora `tools.jackson.core:…`. Con
eso, mezclar las dos API **no compila**: se midió devolviendo un cliente a Jackson 2 y el error es
`Inkompatible Typen: com.fasterxml.jackson.databind.JsonNode kann nicht in
tools.jackson.databind.JsonNode konvertiert werden`.

**Lo que hubo que decidir, y no es cosmético.** En Jackson 3 las excepciones **no son comprobadas**
(`JacksonException extends RuntimeException`), así que `catch (IOException)` alrededor de un
`readTree` deja de compilar donde solo lo envolvía a él, y —peor— **deja de capturar** donde el
`try` también cubría el `send`. Sin arreglarlo, un cuerpo que no es JSON —el HTML de un proxy— saldría
como una excepción cruda de una librería en vez de como «ese sistema no contesta lo que dice
contestar». Los seis sitios llevan su `catch (JacksonException)` con el motivo escrito al lado.

De paso, `asText()`/`textValue()` pasan a `asString()`/`stringValue()`: en Jackson 3 los primeros son
alias obsoletos que **delegan en los segundos**, así que el cambio es de nombre y no de
comportamiento —comprobado en el fuente de `jackson-databind` 3.1.5—.

### 2.2 `ComprobadorDeAcceso` fuera de `rentas` — cerrado, contra la copia local

`catastro`, `caja` y `normativa` declaraban el puerto y **nadie lo implementaba**. Sus controladores
son beans incondicionales, así que el contexto web no levantaba.

**La decisión ya estaba tomada y este trabajo la ejecuta.** **D-N5** (2026-09-03, en
`rentas/docs/00-gobierno/inventario-del-corte.md`): «usuarios, grupos y permisos se definen en
Keycloak; cada sistema guarda una copia local en tabla y su guardia la consulta». Con eso **D-19**
quedó contestada: *el `ComprobadorDeAcceso` de cada sistema pregunta a su propia tabla, no a otro
sistema por HTTP*. Las cinco tablas —`acceso`, `grupo`, `miembro`, `permiso`, `usuario`— están
replicadas en los cuatro baselines (ADR-0032) precisamente para esto.

La alternativa —preguntarle a `rentas`— se descartó con dos argumentos y no por preferencia: el
guardia corre en un `preHandle`, así que sería **un viaje de red por petición**; y `rentas` caído
dejaría a `catastro` y a `caja` sin poder autorizar nada. Una comprobación de acceso que depende de
la disponibilidad de otro despliegue no es una comprobación de acceso.

**Dónde vive.** Un módulo nuevo por sistema, `kamayuk-<sistema>-seguridad`. El nombre no se eligió:
`ConfiguracionDe<Sistema>` ya lo repartía a `SISTEMA_REPLICADO` desde P5C. Dentro hay **dos** cosas y
no un contexto acotado entero: quien **lee** la copia para autorizar y quien la **siembra** al
implantar. Las nueve escrituras de administración de seguridad se quedan en `rentas` (ADR-0030 §3).

La consulta es **la misma de `rentas`, letra por letra**, y eso es deliberado: son dos copias del
mismo modelo del manual sobre dos copias de las mismas cinco tablas. Escribir aquí otra precedencia
produciría un sistema donde el mismo usuario puede una cosa en una pantalla y no en la de al lado, y
el síntoma —un 403 en un sitio y no en otro— no se parece a su causa.

### 2.3 Nada implanta la municipalidad fuera de `rentas` — cerrado, y ejecutado

`municipalidad` existe en los cuatro baselines con su `es_demostracion`, y `SoloEnDemostracion` la
consulta **en la base de su propio sistema**. `ImplantarMunicipalidad` estaba **solo en `rentas`**.

Se cierra igual que #430 cerró `area` y `caja`: **por donde entra la configuración de la
municipalidad, no con una pantalla.** Cada sistema tiene ahora su `ImplantarMunicipalidad` —perfil
`batch`, `@ConditionalOnProperty("kamayuk.implantacion.ubigeo")`— que da de alta la fila como
`sgtm_owner` en una conexión que se abre y se cierra, y siembra el resto como `sgtm_app` con su
auditoría.

**El prefijo es `kamayuk.implantacion` y no `sgtm.implantacion`**: el segundo es el del monolito y
sigue vivo. Que sean distintos hace imposible que un descuido apunte el Job de `catastro` con las
variables del de `rentas`.

**Su catálogo se declara y se comprueba.** `rentas` lee `docs/10-negocio/catalogo-de-opciones.md`
—las 134 opciones— porque ese documento vive en su repositorio; aquí no vive, y leerlo obligaría a
que el build de `catastro` dependiera del clon de `rentas` **en producción**. Lo que hay es
`CatalogoDelSistema`, una lista en código, atada a la realidad por una prueba que recorre `src/main`
y exige que sus códigos sean **exactamente** los `@RequiereAcceso` que los endpoints declaran. Da 11
opciones en `catastro`, 3 en `caja` y 1 en `normativa`.

**Un grupo y no dos.** `rentas` crea «Administracion del sistema» y «Seguridad»; aquí solo el
primero. El segundo es la plantilla de quien administra el acceso de los usuarios, y esas pantallas
viven en `rentas`: crear aquí un grupo que no puede administrar nada sería decir que existe una
delegación que no existe.

### 2.4 El pod de `caja` no levanta — cerrado, con su guarda derivada

`caja/…/application.yaml` declara `responsable: ${KAMAYUK_CAJA_RESPONSABLE}` y
`canal: ${KAMAYUK_CAJA_CANAL}` **sin valor por omisión**, a propósito (ADR-0026 §4). Su descriptor no
las ponía, y `EntornoDelDescriptor` no tenía campo para ellas: cerrarlo desde `caja` era imposible,
porque era cambiar otro repositorio.

`EntornoDelDescriptor` gana `operacion: { responsable, canal }`, que es **del ambiente y no del
sistema** —la pregunta que contesta es «a quién se le avisa en stg» y «a quién en prod»—, sale de dos
claves nuevas del stack y `checkInvariants` **rechaza el relleno** («pendiente», «TBD», «—») y un
canal que no se parece a un canal: la guarda de la aplicación solo comprueba que no esté vacío, así
que un relleno la satisface y la vacía de sentido.

La guarda no es una lista escrita: `verificaciones/variables-sin-omision.ts` **deriva** del
`application.yaml` de cada sistema —el mismo archivo que viaja en el jar— qué variables exige sin
valor por omisión, **por perfil**, y exige que el contenedor de ese perfil las declare. Una lista a
mano se desincroniza el primer mes y su modo de fallo es el peor: una variable nueva no aparece en
ella, la guarda pasa en verde y el pod deja de levantar.

### 2.5 El `Dockerfile` no copia `infrastructure/librerias-backend` — cerrado, y la imagen se construyó

Era el hueco 9.4 de P5A, heredado de P3, y su enunciado decía «no tiene arreglo local». Lo que
faltaba era **medir qué necesita la imagen de verdad**: `comun-verificaciones` es
`testImplementation` y **solo** del módulo `aplicacion`; la imagen construye `bootJar` e
`installDist` y no corre ni una prueba. Lo único que la necesitaba era el `require` de
`settings.gradle.kts`.

De ahí `-Pkamayuk.sinLibreriasComunes`, que el `Dockerfile` pasa en su única línea de compilación. Y
para que no se convierta en «verificar sin verificar», el `build.gradle.kts` de la raíz de los cuatro
repositorios **hace fallar toda tarea de prueba** mientras esa propiedad esté puesta: o está la
librería, o no hay verificación; nunca una verificación que pasa en verde sin ella (#192).

**Medido, no razonado:** `docker build -f backend/Dockerfile --target aplicacion .` sobre `catastro`
termina con `Successfully built`, y el contenedor arranca:

```
Starting SgtmAplicacion v0.1.0-SNAPSHOT using Java 25.0.4 with PID 1 (/opt/sgtm/sgtm.jar started by sgtm in /)
The following 1 profile is active: "batch"
Started SgtmAplicacion in 6.994 seconds
```

**Y construir encontró un segundo defecto que nadie había visto:** el `Dockerfile` de `catastro`
copiaba `docs/10-negocio/catalogo-de-opciones.md`, **que en `catastro` no existe** —se quedó en
`rentas`—, así que fallaba con «not found» antes de compilar una sola clase. Se retira, con el motivo
escrito donde estaba el `COPY`.

Entra además un `.dockerignore` en los cuatro: el contexto eran ~300 MB, casi todos `.git`, y cada
archivo del contexto entra en la huella de la capa —un `git gc` reconstruiría la imagen entera sin que
ninguna fuente hubiera cambiado—.

### 2.6 `rol_ingestor_catastro` sin `LOGIN`, y el `CONNECT` que se hereda — cerrados los dos

**(a) El rol sin clave.** `rol_ingestor_catastro` se creaba `NOLOGIN` y **no estaba en el inventario
de INF-06**, así que `bootstrap-secretos.sh` no le generaba clave y `asignar-claves.sh` no se la
asignaba: existía, tenía sus `GRANT` puestos, y no podía abrir una sesión. Es el mismo hueco que #435
encontró con `rol_carga_parametros`, un ambiente más tarde. Entra al inventario —que pasa de diez
entradas a once— con `baseDeDatos: "rentas"`, que es el matiz que #435 tuvo que aprender: sin él,
comprobar «¿sirve esta credencial?» contra el padrón del monolito daría un rojo falso.

**(b) El `CONNECT`, que resultó ser más grande que su enunciado.** El punto decía que
`rol_carga_parametros` conserva `CONNECT` sobre la base de `rentas`. Medido contra PostgreSQL 16.15,
lo que hay es más general:

```
CONNECT heredado de PUBLIC: true      -- sobre una base recien creada, para un rol cualquiera
tras el REVOKE:            false
```

PostgreSQL concede `CONNECT` a PUBLIC al crear una base. Los roles son del **clúster** y los cuatro
sistemas lo comparten, así que **todo** rol puede abrir una sesión contra la base de cualquier
sistema. `V2` de `rentas` ya lo había dejado dicho y no lo pudo hacer: `REVOKE ... ON DATABASE` solo
lo puede hacer quien la posee, y `sgtm_owner` —que migra— a propósito no es dueño de la base (#722).

Se cierra donde corresponde: en `crear-roles.sql` de los cuatro, que corre como superusuario. Cada
uno revoca el de PUBLIC y concede a **los que tienen trabajo en su base**. Medido sobre una base
recién provisionada de `catastro`:

```
rol_carga_parametros  CONNECT=false
rol_ingestor_catastro CONNECT=false
sgtm_app              CONNECT=true
sgtm_owner            CONNECT=true
sgtm_readonly         CONNECT=true
```

El escenario de `normativa` que las pruebas usan como andamio se escribe conectado como
`rol_carga_parametros`, así que **ese** `CONNECT` lo concede la fixture y no `crear-roles.sql`: en la
base de verdad ese rol no tiene ni una tabla, y dárselo allí sería una credencial de más apuntando a
un padrón.

---

## 3. Las cuatro arrancan, ejecutando

Contra **PostgreSQL 16.15** en `127.0.0.1:55444`, con el artefacto de verdad —`SgtmAplicacion` con
sus `@Import`, su `@SpringBootApplication` y el `application.yaml` que viaja en el jar—, en los **dos
perfiles**:

```
C-7 — rentas    arranca, en los dos perfiles   4 casos   PASSED
C-7 — catastro  arranca, en los dos perfiles   4 casos   PASSED
C-7 — caja      arranca, en los dos perfiles   4 casos   PASSED
C-7 — normativa arranca, en los dos perfiles   4 casos   PASSED
```

Cada uno comprueba cuatro cosas: que el perfil `web` levanta **con los beans que C-7 hace posibles**
—los clientes que inyectan el mapeador, el `ComprobadorDeAcceso`, el controlador que C-6 vio
caerse—; que **sirve** (la sonda de salud contesta 200, y consulta la base, que es lo que el
orquestador mira para dar el pod por vivo); que **la cadena de seguridad está montada** (sin token,
401 en `problem+json`); y que el perfil **`batch`** levanta también.

**Los dos perfiles por separado, y a propósito.** `batch` apaga el servidor web, así que ni
`ConfiguracionDeAutorizacion` —que es `@ConditionalOnWebApplication`— ni los controladores se
instancian. Que uno levante no dice nada del otro, y eso es justo lo que hizo que el defecto
sobreviviera: el jar se probaba en `batch`, donde el comprobador de acceso no se pide.

**Se llenan las variables del descriptor**, `SGTM_DB_URL` y las suyas, no las propiedades de Spring
que hay debajo: un `application.yaml` que dejara de leer una de ellas pasaría inadvertido si la
prueba escribiera `spring.datasource.url` directamente.

**La prueba va en su propia tarea Gradle** (`pruebaDeArranque`, y `verificarArranque` en la raíz).
`verificarArquitectura` corre `:aplicacion:test` y no necesita motor —son ArchUnit, escáneres de
fuentes y límites de Modulith—; meter ahí una prueba que levanta el artefacto convertiría esa barrera
en una que no se puede correr sin PostgreSQL. `check` depende de las dos.

### 3.1 Y la implantación de los tres, ejecutada

Sobre bases creadas de cero, provisionadas con su `crear-roles.sql` y migradas con su `Migrador`:

```
Municipalidad 200105 lista en catastro  (DEMOSTRACION): id 1, 11 accesos nuevos, administrador 'admin.catacaos'
Municipalidad 200105 lista en caja      (DEMOSTRACION): id 1,  3 accesos nuevos, administrador 'admin.catacaos'
Municipalidad 200105 lista en normativa (DEMOSTRACION): id 1,  1 acceso  nuevo,  administrador 'admin.catacaos'
```

Y es **idempotente**: la segunda corrida dice «0 accesos nuevos» y las tablas no se mueven —11
accesos, 11 permisos, 1 miembro—. La auditoría **solo se asienta si se creó algo**: una fila por
despliegue convertiría la bitácora en un registro de reinicios.

---

## 4. Las mutaciones, una a una

Cada una se aplicó **sola**, se ejecutó, y se restauró **por copia comparada con `cmp`**.

| Rotura | Rojo |
|---|---|
| Quitarle el `@Component` a `ComprobadorDeAccesoJdbc` de `catastro` | **4 de 4**: «required a bean of type `kamayuk.catastro.autorizacion.ComprobadorDeAcceso`» |
| Devolver `DirectorioHttpDeRentas` a Jackson 2 (el estado exacto anterior a C-7, con su dependencia) | **4 de 4**: «required a bean of type `com.fasterxml.jackson.databind.ObjectMapper`» — el mensaje que C-6 midió, letra por letra |
| …y la variante a medias —el mapeador de Jackson 2 con el `JsonNode` de Jackson 3— | **no compila**: «`com.fasterxml.jackson.databind.JsonNode` kann nicht in `tools.jackson.databind.JsonNode` konvertiert werden» |
| Quitar del catálogo de `catastro` una opción que un endpoint declara | 1 en rojo: «but could not find the following elements» |
| Volver la precedencia una **unión** (que la excepción del usuario deje de sustituir al grupo) | 2 en rojo, una de ellas la que dice que una excepción **que niega** tiene que poder expresarse |
| Conectar el pool del comprobador como **superusuario** | 2 en rojo: sin RLS, la misma cuenta contesta lo mismo en las dos municipalidades |
| Quitar del descriptor de `caja` sus dos variables | 2 en rojo (stg y prod): «`kamayuk-caja-web` (perfil web) no declara KAMAYUK_CAJA_CANAL, KAMAYUK_CAJA_RESPONSABLE … el pod no levanta: no arranca degradado, no arranca» |
| Quitar el `REVOKE CONNECT ... FROM PUBLIC` de `rentas/crear-roles.sql` | 1 en rojo, con la medición dentro del mensaje |
| Devolverle a `rol_carga_parametros` el `CONNECT` sobre `rentas` | 1 en rojo: «expected `[rol_carga_parametros, …(4)]` to deeply equal `[rol_ingestor_catastro, …(3)]`» |
| Sacar `rol_ingestor_catastro` del inventario de secretos | 1 en rojo: «fuera de él, el rol existe, tiene sus GRANT puestos y no puede abrir una sesión» |

**Y hay un contraste que importa más de lo que parece**: la mutación de Jackson 2 *a medias* no
compila. La dependencia retirada es una guarda más fuerte que cualquier prueba —no se puede escribir
el defecto—, y por eso las dos formas se midieron por separado.

---

## 5. Criterio 4 — las formas del JSON no cambian, y se midió

**`desajustesVivos()` sigue vacío** en los dos archivos donde C-1 lo dejó a cero, y las **nueve**
pruebas de contrato entre repositorios están en verde:

```
Contrato con rentas (catastro es el proveedor)      2 pruebas 0 fallos
Contrato que rentas consume de catastro            2 pruebas 0 fallos
Contrato con caja (rentas es el proveedor)         2 pruebas 0 fallos
Contrato que caja consume de rentas                2 pruebas 0 fallos
Contrato con rentas (normativa es el proveedor)    2 pruebas 0 fallos
Contrato que rentas consume de normativa           2 pruebas 0 fallos
Contrato con catastro (normativa es el proveedor)  2 pruebas 0 fallos
Contrato que catastro consume de normativa         2 pruebas 0 fallos
Contrato de la API (docs/50-api)                   3 pruebas 0 fallos
```

Pero un contrato de contención no compara **bytes**, y los tres sitios que escriben JSON con el
mapeador inyectado sí los tienen que conservar. Se midió serializando los **mismos objetos** con el
`ObjectMapper` de Jackson 2 y con el `JsonMapper` de Jackson 3, con las clases reales cargadas de los
jars de `rentas` y `normativa`:

```
IGUAL   evento de pago (arbol de ComponedorDeEventosJson)
IGUAL   PeticionDePago (lo que congela PagoController)
IGUAL   SnapshotResource (los bytes cuyo sha256 es el ETag)
```

**Ningún byte cambia.** Y el tercero era el que había que mirar con más cuidado: el `ETag` del
snapshot sellado **es el sha256 de esos bytes**, y sus consumidores lo recalculan y lo comparan
(ADR-0025). Los tres son `record`s de `String`, `int`, `long` y listas de `record`s —ni un objeto de
valor del dominio—, de modo que el módulo de `ConfiguracionDeJson` no interviene y las dos versiones
emiten lo mismo, incluidos los nulos explícitos y el orden de los componentes.

---

## 6. Huecos declarados

1. **La copia local de seguridad no se sincroniza.** Hoy la escribe la implantación y nadie más: un
   permiso otorgado en `rentas` después de eso **no llega** a `catastro`, `caja` ni `normativa`. Es
   literalmente lo que D-19 enunciaba y lo que D-N5 dejó sin fijar («el detalle lo escribe la fase
   1»). Está escrito en el `package-info.java` de los tres módulos, que es donde lo va a leer quien
   toque esto.

2. **Los cuatro `Job` de migración no migran.** Medido sobre los manifiestos de `stg`: el de
   `catastro` es `ghcr.io/hneyra/kamayuk-catastro:<tag>` —la **misma** imagen que el Deployment,
   porque el descriptor declara `imagenes: [SISTEMA]`, una sola— con `SGTM_DB_USUARIO=sgtm_owner` y
   **sin** `SPRING_PROFILES_ACTIVE`. O sea: arranca la aplicación, no el migrador, y la aplicación
   tiene `spring.flyway.enabled: false` a propósito (ARQ-03 §4). Arreglarlo exige decidir antes qué
   imagen publica cada repositorio: el `Dockerfile` tiene dos objetivos y el descriptor declara una.
   Por eso la guarda de §2.4 mira los `Deployment` y no los `Job`, y lo dice en su javadoc.

3. **Nada crea las cuatro bases ni sus roles en el clúster.** `baseDeDatos()` de los cuatro
   descriptores existe y **sólo se usa para auditar** (`basesDelClustre`): ningún componente
   compone su creación. Los cuatro Deployment apuntan a
   `jdbc:postgresql://postgres:5432/<sistema>`, y hoy el único guion de inicialización que hay
   —`30-base-de-keycloak.sh`— provisiona la base del monolito. Es el paso que separa «las cuatro
   arrancan» de «las cuatro arrancan desplegadas».

4. **Ningún `Job` de implantación en los cuatro descriptores.** El proceso existe y se ejecutó (§3.1),
   pero nada lo lanza en un despliegue. No se construyó porque se apoyaría sobre el hueco 2: un Job
   de implantación detrás de un Job de migración que no migra no se puede verificar.

5. **`30-base-de-keycloak.sh` sigue concediendo `CONNECT` a `rol_carga_parametros` sobre la base del
   monolito**, y se deja a propósito: ahí `parametro_tributario` **sigue existiendo** y
   `publicar-parametros.sh` escribe contra ella. Retirarlo rompería la publicación de valores
   normativos del único ambiente donde hoy se puede correr (#435, #438).

6. **El motor de pruebas no es el de CI.** Testcontainers no sirve desde esta máquina —el demonio de
   Docker es un túnel a un VPS y el puerto publicado del contenedor se queda allí—, así que todo lo
   de persistencia corrió contra un PostgreSQL 16.15 externo con RLS, `FORCE ROW LEVEL SECURITY` y
   los cinco roles reales. Es el mismo hueco que declararon P3, P4, P5A–E, C-1, C-5 y C-6.

7. **La imagen se construyó de `catastro` y no de los cuatro.** `rentas` tiene `Dockerfile` y recibió
   el mismo cambio; `caja` y `normativa` **no tienen `Dockerfile` todavía**, y sus
   `settings.gradle.kts` reciben la propiedad igualmente para que el día que aparezca funcione.

---

## 7. Cifras y barreras

| Repositorio | Pruebas antes | Pruebas después | `build` | `verificarArquitectura` | `verificarAislamiento` | `verificarArranque` |
|---|---:|---:|---|---|---|---|
| `rentas` | 3 121 | **3 125** | verde | verde | verde | verde |
| `catastro` | 974 | **985** | verde | verde | verde | verde |
| `caja` | 673 | **684** | verde | verde | verde | verde |
| `normativa` | 606 | **617** | verde | verde | verde | verde |
| `infrastructure` | 400/400 | **418/418** | `yarn verificar` verde | — | — | — |

Ninguna baja. Lo que sube: 4 de arranque en cada backend, 2 del catálogo y 5 del comprobador en los
tres sistemas que estrenan módulo de seguridad, y 18 en `infrastructure` (10 de la guarda de
variables sin omisión, 6 de la del `CONNECT` y 2 de fixture).

`verificarArranque` es una barrera **nueva**, con los mismos nombres en los cuatro repositorios.

---

## 8. Reglas que este trabajo no toca, y conviene decirlo

- **Ningún método de dominio recibe `municipalidadId`** (regla 2). El comprobador de acceso no filtra
  por municipalidad: lo hace la política RLS con el contexto de la transacción.
- **`SET LOCAL`, jamás `SET SESSION`** (regla 3). El `@Transactional(readOnly = true)` del
  comprobador no es decorativo: sin transacción no hay `SET LOCAL`, y la política no devuelve vacío —
  revienta (DAT-01 §0, #486).
- **Toda modificación de datos exige observación** (regla 10). `SembradorDeLaCopiaLocal.sembrar` la
  recibe y la asienta.
- **Aquí no se borra nada** (RNF-051, regla 4). La implantación sólo agrega: un acceso retirado del
  catálogo se desactiva a mano, porque los permisos que cuelgan de él son constancia de quién pudo
  hacer qué.
