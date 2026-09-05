# C-14 — Que esto se pueda desplegar

**Fecha:** 2026-09-05. **Repositorios tocados:** `infrastructure`, `rentas`, `catastro`,
`normativa` y `caja`. **`sgtm` no se toca:** su `git status` queda limpio.

Las cuatro aplicaciones **arrancan** desde C-7 y el ingestor **funciona** desde C-8, medido las dos
cosas ejecutando. Y aun así **ninguno de los cuatro sistemas se podía levantar en un clúster**, por
cuatro motivos que las propias correcciones habían declarado al medir. C-14 cierra los cuatro.

> **El resultado, en una línea: la cadena entera —crear la base, provisionar sus roles, migrarla con
> el migrador de verdad— se ejecutó contra PostgreSQL 16.15, y las dos mitades se midieron por
> separado.** Sin `06-roles-de-los-sistemas.sh`, la migración de `catastro` muere con
> `42501 permission denied for schema public`; con él, «Successfully applied 5 migrations».

---

## 1. Los criterios, con su medida

| # | Criterio | Estado | Dónde |
|---|---|---|---|
| **1** | Los cuatro puntos cerrados o con su motivo escrito | **Cumplido**, uno a uno | §2 |
| **2** | `yarn manifiestos --ambiente stg` compone los cuatro y la auditoría pasa, con los `Job` y `CronJob` nuevos dentro | **Cumplido**, con el recuento | §3 |
| **3** | La mutación de cada uno, en rojo y nombrando lo que falta | **Cumplido**, seis mutaciones más la del motor | §4 |
| **4** | Lo que no se pueda verificar sin clúster, dicho | **Cumplido** | §6 |
| **5** | Las cifras no bajan | **Cumplido**: las cinco suben o se mantienen | §5 |
| **6** | Los cuatro verificadores bloqueantes en verde | **Cumplido** | §5 |

---

## 2. Los cuatro puntos

### 2.1 Punto 1 — qué imagen publica cada repositorio

**La decisión: dos imágenes por sistema, `kamayuk-<sistema>` y `kamayuk-<sistema>-migrador`**, que
son los **dos objetivos que su propio `Dockerfile` ya declara**. No es una convención nueva: es la
que el monolito tiene desde el issue #150 (`sgtm-aplicacion` y `sgtm-migrador`).

**Lo que no se puede hacer, y por qué**: no vale «la misma imagen con otro perfil». El migrador **no
es una aplicación de Spring**: es el `installDist` de `kamayuk-<sistema>-esquema`, con
`ENTRYPOINT /opt/migrador/bin/migrar`, sin Spring en su `build.gradle.kts` a propósito. La imagen de
la aplicación arranca con `spring.flyway.enabled: false` (ARQ-03 §4), así que un `Job` que la
corriera **no migraría** con ningún perfil — arrancaría el proceso web con las credenciales del
único rol con DDL, que es lo peor de las dos cosas. Ése era exactamente el estado anterior:

```
Job/kamayuk-catastro-migracion
  image: ghcr.io/hneyra/kamayuk-catastro:<tag>      ← la del Deployment
  env:   SGTM_DB_USUARIO=sgtm_owner                 ← y sin SPRING_PROFILES_ACTIVE
```

**Y las variables cambian, porque el migrador lee otras.** Su `main` toma `SGTM_DB_URL`,
`SGTM_DB_OWNER_USUARIO` y `SGTM_DB_OWNER_CLAVE`, y **rechaza argumentos** a propósito para que una
clave no quede en el historial del proceso. El descriptor ponía `SGTM_DB_USUARIO`, que el migrador
no lee.

**Eso obligó a ensanchar la auditoría, y conviene decirlo**: `auditarLaAplicacion` vigilaba que
`sgtm_owner` solo apareciera en un `Job` **mirando `SGTM_DB_USUARIO`**. Con el Job corriendo el
migrador de verdad esa variable desaparece, así que la regla se habría quedado mirando algo que ya
no está. Ahora vigila los **dos nombres**: que la credencial del único rol con DDL solo pueda vivir
en un `Job` no puede depender de cómo se escriba.

**`caja` y `normativa` estrenan `Dockerfile`** (era el hueco 7 de C-7). Son el de `catastro` con el
nombre del módulo cambiado, y con el motivo propio escrito donde `catastro` lleva su cicatriz del
catálogo de opciones. Comprobado: los dos son idénticos entre sí sustituyendo el nombre del sistema.

**Y el nombre de los dos `Job` pasa a llevar la versión.** Un `Job` de Kubernetes es **inmutable**:
su plantilla de pod no se puede modificar, y la imagen lleva la etiqueta dentro. Con un nombre fijo,
el `pulumi up` de la versión siguiente falla al intentar actualizarlo. El monolito lo resolvió en el
issue #150 con `sufijoDeVersion()`; los cuatro descriptores nacieron sin ello. El entorno gana
`nombreConVersion(base)`, que devuelve el sufijo **recortado y saneado** —doce caracteres— y no la
versión: con eso no se puede recomponer la referencia de una imagen, así que no abre una puerta a la
prohibición (b).

### 2.2 Punto 2 — quién crea las cuatro bases y sus roles

**La decisión: el mismo mecanismo que el compose, con un guion más.** El `ConfigMap` de
inicialización del motor gana `05-crear-bases.sh` —el que C-10 escribió, sin tocarlo— y
**`06-roles-de-los-sistemas.sh`**, nuevo, que aplica el `crear-roles.sql` **de cada sistema contra su
propia base**.

Se miró qué hacía falta y se midió antes de escribirlo, porque el enunciado se quedaba corto: crear
la base **no basta**. `crear-roles.sql` de cada sistema hace cuatro cosas, y hasta C-14 en el clúster
no se hacía **ninguna**:

| Qué | Antes | Ahora |
|---|---|---|
| Existe la base | no | sí (`05`) |
| Sus extensiones, las que ESE sistema declara | no | sí (`05`, derivadas — C-10) |
| `sgtm_owner` tiene `CREATE` sobre `public` | **no** | sí (`06`) |
| `PUBLIC` conserva el `CONNECT` que PostgreSQL regala | **sí** | no (`06`) |

**Medido contra PostgreSQL 16.15, con el migrador de `catastro` construido de verdad**
(`:kamayuk-catastro-esquema:installDist`):

```
antes de 06:   rentas|t|f   catastro|t|f   normativa|t|f   caja|t|f
               (publicCONNECT | ownerCREATE)
migrando:      SQL State  : 42501
               Message    : ERROR: permission denied for schema public

después de 06: rentas  publicCONNECT=false  ownerCREATE=true  appCONNECT=true
               catastro …  normativa …  caja …   (los cuatro igual)
migrando:      Successfully applied 5 migrations to schema "public", now at version v5
               Migraciones aplicadas en esta ejecucion: 5
```

**El archivo entero se ejecuta, y no se copia nada de él.** Es el mismo `crear-roles.sql` que el
módulo del esquema de ese sistema versiona y que su prueba de aislamiento aplica: copiar aquí sus
`GRANT` sería un segundo sitio donde olvidar que el rol no puede ser superusuario. Y se aplica
`--dbname "$base"`, no `postgres`: el archivo usa `current_database()` para revocar el `CONNECT`,
así que contra la base equivocada revocaría el de **otra**.

**Dos `ConfigMap`, y no uno.** Todo `.sql` que caiga en `docker-entrypoint-initdb.d` lo **ejecuta**
el entrypoint contra la base por omisión; los cuatro `crear-roles.sql` hay que **leerlos** —para
derivar las extensiones (C-10)— y aplicarlos cada uno contra su base. Van en
`postgres-roles-de-los-sistemas`, montado en `/etc/kamayuk`, que es el mismo reparto que el compose
ya hacía con sus dos montajes. **Y una clave de `ConfigMap` no admite `/`** (`[-._a-zA-Z0-9]+`), así
que la clave es `rentas.sql` y el subdirectorio lo pone el `path` del volumen: sin eso el API server
rechaza el `ConfigMap` entero.

**C-10 no se deshace**: las extensiones se siguen nombrando en **un solo sitio por sistema** y los
dos guiones derivan de él. Lo que C-14 añade es la otra mitad del archivo, la que C-10 §6 dejó
declarada como su hueco 4. El compose recibe el mismo guion, para que los dos no se separen.

### 2.3 Punto 3 — el `CronJob` del emisor y del ingestor

**El descriptor gana el campo que faltaba**, siguiendo el precedente de `operacion` de C-7: viene del
**ambiente** y no del sistema.

- `EntornoDelDescriptor.implantacion` — ubigeo, nombre, tipo, administrador, si es de demostración y
  el `municipalidadId`. Sale de `Pulumi.<ambiente>.yaml`, y `checkInvariants` lo valida antes de
  componer nada.
- `EntornoDelDescriptor.namespaceDe(sistema)` — para la dirección de un servicio ajeno y para el
  `namespaceSelector` de una política de egreso.
- `EntornoDelDescriptor.plataforma` — el namespace del motor y la identidad, el emisor OIDC público y
  el JWKS **interno**.
- `DescriptorDeSistema.lotes(entorno)` — sus `CronJob`.

**`catastro` publica su padrón, y corre.** `PublicarElPadron` escribe su propio buzón y **no entrega
nada** —la entrega la hace el consumidor viniendo a buscarla—, así que no llama a nadie y no depende
de ninguna identidad de servicio. Su `CronJob` va activo, con la ventana de 07:00 UTC que
`Aplicacion.ts` ya usa para el lote del monolito. **`kamayuk.catastro.publicacion.ejercicio` no se
declara**, y es deliberado: sin él el publicador sólo proyecta; con él corre además la valuación, que
es un acto de un ejercicio y no se dispara desde una tarea programada que nadie pidió.

**`rentas` declara su ingestor entero, y nace SUSPENDIDO.** El feed de `catastro` está detrás de
`@RequiereAcceso("consulta_fichas")` y **no hay identidad de servicio** —ADR-0028 §2, RFC 8693, el
hueco 3 de C-8—: sin credencial la llamada sale sin `Authorization` y `catastro` la rechaza con 401,
que es el comportamiento correcto. Un `CronJob` activo en ese estado fallaría cada noche y su alerta
sería ruido. Lo que se declara es **la ventana, los límites y la configuración entera**, que es
literalmente lo que el hueco 2 de C-8 pedía: «mientras el descriptor no tenga campo, el ingestor no
se puede desplegar». Quitar el `suspend` es una línea. Es el mismo trato que `Aplicacion.ts` le da al
`CronJob` de `lote`.

**`normativa` y `caja` no declaran ninguno, y eso es una afirmación.** `normativa` publica y no
consulta a nadie: sellar es un acto con dos firmas, no una tarea programada. `caja` tiene un
publicador escrito, pero es un `@Scheduled` que **no se registra** (P6 §4.4); declararle un `CronJob`
sería decir que corre algo que todavía no existe como proceso invocable.

**Y esto destapó que el egreso declarado no abría nada.** Desde ADR-0031 cada sistema tiene **su**
namespace, y un `podSelector` sin `namespaceSelector` selecciona pods **del mismo**. Las políticas de
los cuatro descriptores nombraban `componente: postgres`, `componente: identidad` y los sistemas
vecinos **sin namespace**: ninguna de esas reglas permitía el tráfico que declaraba, y el síntoma
habría sido tráfico denegado con una política que dice permitirlo. Se cierra por los dos lados:

- en los descriptores, cada destino lleva su `namespaceSelector` por
  `kubernetes.io/metadata.name` —la misma forma que `Red.ts` ya usaba para `kube-system`—;
- en `Red.ts`, `permitirIngresoPostgres` y `permitirIngresoIdentidad` aceptan además los namespaces
  de los sistemas, seleccionados por una etiqueta nueva —`kamayuk-sistema: si`— que
  `componerDescriptores` pone en cada `Namespace`. Se selecciona por etiqueta y no por nombre porque
  los nombres crecerían con cada sistema, y no se reutiliza `proyecto`/`ambiente` porque **esos los
  lleva también el namespace de la plataforma**, y entonces la regla abriría PostgreSQL a la
  interfaz, que es justo lo que `permitirIngresoPostgres` existe para impedir.

**Y el JWKS estaba mal, por el mismo sitio.** Los cuatro descriptores apuntaban `SGTM_OIDC_EMISOR` y
`SGTM_OIDC_JWKS` **los dos** al nombre público. El emisor es una **identidad** —es lo que se compara
con el `iss`— y el JWKS es una **dirección de red**: con el público, el backend sale al ingreso para
volver a entrar, y con la política de egreso declarada —que nombra el pod de identidad, no
internet— no habría salido en absoluto. Todo token inválido, por un motivo que no se parece a su
causa. Es la trampa que el propio `application.yaml` anota. Ahora el entorno entrega las dos, con
las mismas funciones que componen la aplicación del monolito.

### 2.4 Punto 4 — el `Job` de implantación

Cada descriptor gana `implantacion(entorno)`: la imagen de la **aplicación** con el perfil `batch` y
las propiedades de `DatosDeImplantacion`, que valida en su constructor compacto —sin una de ellas el
bean falla y el contexto no arranca—.

**El migrador va de contenedor de inicialización, y esa es la decisión que había que tomar.** Un
`Deployment` no sabe esperar a un `Job` y Kubernetes no tiene `dependsOn`. El monolito lo resuelve
con un contenedor que consulta la base con `psql` hasta ver `flyway_schema_history`; aquí esa salida
**no existe**, porque un descriptor sólo puede nombrar SUS imágenes —prohibición (b)— y la del motor
no es suya. Lo que se hace es más fuerte que esperar: se **asegura** que el esquema está, corriendo
el migrador, que es idempotente y devuelve cero cuando no falta nada. Cuando ese contenedor sale con
éxito **el esquema ESTÁ**, que es lo que la espera del monolito sólo puede suponer.

C-7 no lo construyó «porque se apoyaría sobre el hueco 2 y no podría verificarlo». Ahora se apoya
sobre un migrador que migra de verdad, y eso se midió ejecutándolo (§2.2).

---

## 3. Criterio 2 — el recuento, y la auditoría

`yarn manifiestos` compone los cuatro y la auditoría pasa en los dos ambientes:

| | `(plataforma)` | `rentas` | `catastro` | `normativa` | `caja` | **total** |
|---|---:|---:|---:|---:|---:|---:|
| `stg` **antes** | 73 | 7 | 6 | 6 | 6 | **98** |
| `stg` **ahora** | 74 | 9 | 8 | 7 | 7 | **105** |
| `prod` ahora | 71 | 9 | 8 | 7 | 7 | **102** |

Lo que entra, por clase: `ConfigMap` 6 → 7 (el de los roles de los sistemas), `Job` 7 → 11 (los
cuatro de implantación), `CronJob` 2 → 4 (el publicador de `catastro` y el ingestor de `rentas`,
suspendido).

Cada sistema pasa de 6 manifiestos a 7 —`Namespace`, `Job` de migración, `Job` de implantación,
`Deployment`, `Service`, `IngressRoute`, `NetworkPolicy`—; `rentas` suma su segundo `Deployment` y su
`CronJob`, y `catastro` el suyo.

**Y el grafo de egreso no cambia**: seis aristas entre sistemas, las mismas que ARQ-01 reducido a
cuatro nodos. Lo que cambia es que ahora las políticas las aplican.

---

## 4. Las mutaciones, una a una

Cada una se aplicó **sola**, se ejecutó, y se restauró **por copia comparada con `cmp`**.

| # | Mutación | Resultado |
|---|---|---|
| M1 | El `Job` de migración de `catastro` con **la imagen y el usuario del `Deployment`** (el estado exacto anterior a C-14) | **2 en rojo en `infrastructure` y 2 en `catastro`**, y el mensaje es el defecto entero: «el Job de migracion corre la imagen de la APLICACION […] ese Job no migra: levanta el proceso web con las credenciales del unico rol con DDL». `expected 'ghcr.io/…/kamayuk-catastro:…' to be '…kamayuk-catastro-migrador:…'` |
| M2 | El `CronJob` del ingestor **sin su configuración** (fuera `KAMAYUK_RENTAS_INGESTOR_USUARIO` y su clave) | 1 en rojo en cada repositorio: `expected undefined to be 'rol_ingestor_catastro'`. Es la variable de `@ConditionalOnProperty`: sin ella el cableado del ingestor **no existe** y el proceso arranca sin ingestar nada |
| M3 | Un **descriptor sin el campo nuevo**: `caja` sin `lotes` | **No compila**: `TS2741: Property 'lotes' is missing in type … but required in type 'DescriptorDeSistema'`. Es la guarda más fuerte de las tres, porque el defecto no se puede escribir |
| M4 | La credencial del owner en un **`CronJob`** (`SGTM_DB_OWNER_USUARIO` en el publicador) | `yarn manifiestos` **se niega a emitir**: «CronJob/kamayuk-catastro-publicador […] declara «SGTM_DB_OWNER_USUARIO», que es la credencial de `sgtm_owner` con otro nombre. Solo vale en un **Job**» |
| M5 | Quitar `06-roles-de-los-sistemas.sh` del `ConfigMap` del motor | 1 en rojo en `componentes.test.ts`, y —lo que importa— **el motor de verdad se pone rojo**: ver M7 |
| M6 | **El contraste**: que la regla del owner rechace también en un `Job` | `yarn manifiestos` rechaza **16** cosas, entre ellas los cuatro `Job` de migración que son justo donde esa credencial tiene que estar. Sin este contraste, una regla demasiado ancha rompería el despliegue por el otro lado |
| M7 | La misma M5, **contra el motor levantado de verdad** (`verificar-el-motor.sh --modo local`, PostgreSQL 16.15) | **FALLO: sgtm_owner no puede crear en «public» de «rentas»: la migracion moriria en la primera sentencia con 42501.** Con el guion puesto, las cuatro bases pasan |

**Y una octava, que no hubo que provocar.** Extender `variables-sin-omision` del `Deployment` a todo
pod que corra la imagen de la aplicación puso en rojo el `Job` de implantación de **`caja`**:

```
«kamayuk-caja-implantacion-c755de214934» (perfil batch) no declara KAMAYUK_CAJA_CANAL,
KAMAYUK_CAJA_RESPONSABLE. El application.yaml de «caja» las exige SIN valor por omision, asi que
Spring no puede resolver el marcador y el pod no levanta: no arranca degradado, no arranca.
```

Las dos de ADR-0026 §4 van en el bloque **común** de su `application.yaml`, así que las necesita
**todo** proceso de ese sistema y no sólo el perfil `web`. El Job de implantación de `caja` no habría
levantado, y el síntoma habría sido un despliegue colgado esperando una municipalidad que nadie
implantó. Arreglado en su descriptor, con el motivo escrito.

**El criterio de esa guarda deja de ser la clase del objeto y pasa a ser la imagen**: se mide todo
contenedor cuya imagen sea la de la aplicación de ese sistema —`Deployment`, implantación y
`CronJob`— y queda fuera el migrador, que no lee ningún `application.yaml`. Derivarlo de la imagen es
lo que hace que un `CronJob` nuevo entre solo.

---

## 5. Cifras y barreras

| Repositorio | Pruebas antes | Después | `build` | `verificarArquitectura` | `verificarAislamiento` | `verificarArranque` |
|---|---:|---:|---|---|---|---|
| `rentas` | 3 142 | **3 142** | verde | verde | verde | verde |
| `catastro` | 991 | **991** | verde | verde | verde | verde |
| `caja` | 687 | **687** | verde | verde | verde | verde |
| `normativa` | 617 | **617** | verde | verde | verde | verde |
| `infrastructure` | 486/486 | **530/530** | `yarn verificar` verde | — | — | — |

**Ninguna baja.** Las cuatro de backend se mantienen porque **C-14 no toca una sola línea de Java**:
lo único que entra en esos repositorios es su `Dockerfile` —`caja` y `normativa`— y su descriptor de
infraestructura, que ningún proceso de Gradle lee. Se comprobó ejecutando, con `cleanTest` y contra
PostgreSQL 16.15 real; `normativa` se volvió a correr además con `--no-build-cache` para que el
recuento no saliera de la caché: 617 pruebas, 0 fallos.

Y el `yarn verificar` de los **cuatro descriptores**, que llevaba tres correcciones roto sin que
nadie lo viera (C-9a §6 hueco 3) y que este trabajo comprueba explícitamente:

| | antes | después |
|---|---:|---:|
| `rentas/infrastructure` | 7 | **12** |
| `catastro/infrastructure` | 6 | **11** |
| `normativa/infrastructure` | 6 | **11** |
| `caja/infrastructure` | 6 | **12** |

`infrastructure` sube 44, y cada una donde le toca: **35** de la guarda nueva
`despliegue-de-los-sistemas.test.ts`, **5** de `config.test.ts` (el `municipalidadId`, sus tres
roturas y su contraste), **2** de `componentes.test.ts` (las cuatro bases con sus roles, y los
cuatro `crear-roles.sql` fuera de `initdb.d`), **1** de `plataforma-compose.test.ts` y **1** de
`variables-sin-omision.test.ts`. `descriptor.test.ts` se queda en 13: sus muestras ganaron los dos
miembros nuevos sin necesitar una prueba más, porque lo que las mide ya estaba escrito.

---

## 6. Huecos declarados

1. **Nadie publica las imágenes de los cuatro sistemas, y sus etiquetas no podrían ser las que el
   manifiesto pide.** Medido: ninguno de los cuatro repositorios tiene un `publicar-imagenes.yml`
   —sus flujos son `backend.yml`, `infraestructura.yml`, `registro.yml` y, en dos, `documentacion.yml`—,
   así que `ghcr.io/hneyra/kamayuk-catastro-migrador:<sha>` no existe. Y hay un segundo problema
   debajo: `entorno.imagenDe()` etiqueta **las ocho** imágenes con `applicationBootstrapVersion`, que
   es un `sha` **de `sgtm`**; las de un sistema saldrían de su propio repositorio con su propio `sha`.
   Cerrarlo son dos cosas —un flujo de publicación por repositorio y una versión declarada por
   sistema en el stack— y las dos cambian `declarar-version.yml` y `deriva-de-migraciones`, que hoy
   suponen **un** sistema desplegado. No se hace aquí: es un trabajo con su propia verificación.

2. **No hay clúster donde probar esto.** El Docker de esta máquina es un túnel a un VPS y no puede
   montar rutas locales, así que lo que se ejecutó de verdad fue: los dos guiones de inicialización
   contra PostgreSQL 16.15 con los cuatro `crear-roles.sql` reales; el migrador de `catastro`
   construido con Gradle; y `verificar-el-motor.sh` en modo local, que provisiona el motor **con los
   guiones que el manifiesto monta**. Lo que **no** se ejerció es que Kubernetes proyecte el segundo
   `ConfigMap` en `/etc/kamayuk/roles/*.sql` con los `items` del volumen; lo cubre una prueba que lee
   el manifiesto, que es texto y no ejecución. Mismo hueco de P3, P4, P5A–E, C-1, C-6, C-7, C-8 y
   C-10.

3. **Los cuatro sistemas NO caben junto al monolito en el nodo de ninguno de los dos ambientes**, y
   `yarn capacidad` no lo ve. Medido:

   ```
   stg  (nodo 4 / 7Gi)     sólo los cuatro   permanente 500m / 2560Mi   pico 950m / 4864Mi
                           todo              permanente 2050m / 6848Mi  pico 2720m / 10240Mi   NO CABE
   prod (nodo 2 / 5888Mi)  todo              permanente 2040m / 6816Mi  pico 2710m / 10208Mi   NO CABE
   ```

   `herramientas/capacidad.ts` compone **sólo la plataforma**, así que hoy dice «cabe» en los dos. No
   se «arregla» bajando peticiones hasta que cuadre —eso sería inventar una holgura que no existe—:
   lo que hay que decidir es si el monolito y los cuatro conviven en el mismo nodo, y eso es ADR-0029
   y D-22, no C-14. Lo que sí queda es que **no pueda crecer en silencio**: una guarda fija la cifra
   medida de los cuatro (950m / 4864Mi de pico) y otra **afirma el estado de hoy** —que no caben—, de
   modo que el día que quepan la prueba se pone roja y lo que hay que hacer no es actualizar el
   número sino leer por qué cambió.

4. **`yarn manifiestos` no puede correr en el CI tal como está.** `descriptor/sistemas.ts` importa los
   cuatro descriptores de los clones hermanos, y desde C-14 el `ConfigMap` del motor lee además sus
   `crear-roles.sql`; los trabajos `manifiestos`, `capacidad`, `previsualizar-*` y `aplicar-*` de
   `infra.yml` hacen `actions/checkout` sólo de este repositorio. Es **anterior a C-14** —lo introdujo
   ADR-0031 al componer descriptores ajenos— y no se cierra aquí porque no se puede verificar: los
   cuatro remotos son privados y el `GITHUB_TOKEN` de un flujo no los ve (C-9a §7), así que añadir los
   checkout cambiaría el rojo de sitio sin arreglarlo. Las dos cosas que hacen falta son las mismas
   que C-9a dejó dichas: publicar el contenido de los cuatro y una credencial que los deje leer.

5. **El `municipalidadId` se declara y no se deriva.** `municipalidad.id` es una columna `IDENTITY`,
   así que en una base recién creada vale 1 por construcción; lo que este repositorio no puede hacer
   es comprobarlo contra la fila, porque componer manifiestos no habla con ninguna base.
   `checkInvariants` sólo puede exigir que sea un entero mayor que cero. Un valor que no corresponda
   al `ubigeo` deja al ingestor de `rentas` y al publicador de `catastro` proyectando bajo otro
   contexto, **y RLS no lo delata**: la base hace exactamente lo que se le pide. Cerrarlo exige que
   esos dos procesos resuelvan el ubigeo ellos mismos —`RecorridoPorMunicipalidades.activas()` ya
   publica `(id, ubigeo, nombre)` en los dos repositorios—, y eso es un cambio de backend que no cabe
   en una corrección de infraestructura.

6. **El ingestor no puede ingerir todavía.** Su `CronJob` está declarado y suspendido porque no hay
   identidad de servicio (ADR-0028 §2, C-8 hueco 3). La clave `kamayuk-rentas-catastro` entra en el
   inventario para que el manifiesto esté completo, y lo que `bootstrap-secretos.sh` generaría es una
   cadena aleatoria, **no un token que Keycloak haya emitido**: `catastro` la rechazaría con 401. Está
   dicho en el inventario y en el `CronJob`, no sólo aquí.

7. **La anti-entropía sigue sin `CronJob`.** `CorrerLaAntiEntropia` tiene la misma forma que el
   ingestor —`@Profile("batch")`, `@ConditionalOnProperty("sgtm.anti-entropia.municipalidad")`— y el
   mismo bloqueo: compara contra `catastro` por HTTP. Se deja fuera a propósito para no declarar un
   tercer `CronJob` suspendido en el mismo movimiento; el mecanismo que necesita es exactamente el que
   C-14 acaba de construir.

8. **La copia local de seguridad sigue sin sincronizarse** (C-7 hueco 1, intacto). La escribe la
   implantación y nadie más: un permiso otorgado en `rentas` después de eso no llega a los otros tres.

9. **`30-base-de-keycloak.sh` sigue concediendo `CONNECT` a `rol_carga_parametros` sobre la base del
   monolito** (C-7 hueco 5, intacto y deliberado).

---

## 7. Lo que este trabajo no toca, y conviene decirlo

- **`sgtm` no se toca.** Es el archivo histórico; su `git status` queda limpio.
- **No se toca una línea de Java.** Lo que entra en los cuatro repositorios de sistema es su
  `Dockerfile` y su descriptor de infraestructura.
- **C-10 no se deshace.** Las extensiones se siguen nombrando en un solo sitio por sistema —su
  `crear-roles.sql`— y los tres consumidores derivan. `06-roles-de-los-sistemas.sh` no las lista: usa
  el archivo entero, que es la fuente.
- **No se cambia el reparto de `imagenDe()`.** La etiqueta la sigue poniendo `infrastructure`
  (prohibición (b)); lo que cambia es cuántos nombres lógicos declara cada sistema.
- **No se toca `ADR-0026` ni `ADR-0028`.** C-14 despliega lo que C-8 construyó; donde una premisa
  suya sigue sin cumplirse —la identidad de servicio— está dicho como hueco y no reescrito allí.
