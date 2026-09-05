# C-18 — el compose de los cuatro sistemas, que el README ya daba por hecho

**Estado:** aplicado en los cinco repositorios.

**Lo que entra:** los cuatro `despliegue/compose.yaml`, dos guardas nuevas en `infrastructure`
(25 + 12 pruebas), la corrección del `README.md` de `despliegue/`, dos variables más en
`.env.ejemplo`, y **el arreglo del prefijo de implantación de `rentas`** —descriptor y compose—,
que es lo que este ensayo destapó.

C-17 hizo que **el despliegue en Kubernetes pasara de verdad**. El otro camino —el que usa quien
desarrolla, todos los días— **no existía**, y el `README.md` de `infrastructure/despliegue/`
afirmaba lo contrario: su sección «Cómo levanta un sistema lo suyo» decía que «cada repositorio de
sistema trae su propio compose, con **sólo su backend y su frontend**» y enseñaba el archivo de
ejemplo, con su contenido.

Medido antes de tocar nada, con `find` sin límite de profundidad: **ninguno de los cuatro
repositorios tenía ningún archivo de compose, y ninguno tiene `frontend/`**. Había guarda para el
compose de la plataforma (`plataforma-compose.test.ts`, 17 pruebas) y **ninguna** para los cuatro
que el README prometía.

Es el mismo modo de fallo que C-17 encontró cinco veces y que ADR-0011 tiene escrito desde que
existe: **una mitad de la frontera bien escrita, la otra ausente, y nada que las compare**. Con la
diferencia de que aquí la mitad ausente era el archivo entero, y lo que ocupaba su sitio era una
frase en un README.

**Y levantarlo encontró un sexto defecto de esa misma familia, que no se buscaba**: el `Job` de
implantación de `rentas` lleva desde C-14 **arrancando, no haciendo nada y saliendo con código 0**,
porque el descriptor le pone las variables con el prefijo de sus tres hermanos y `rentas` lee el
del monolito. En Kubernetes eso se ve como `Complete`. Está en el §5, con su medida, su arreglo y
su guarda.

---

## 1 · Los cuatro compose

`<sistema>/despliegue/compose.yaml`, uno por repositorio. Cada uno declara **tres servicios**, uno
por proceso que el descriptor despliega en el clúster:

| Servicio | Qué es | Objetivo del `Dockerfile` |
|---|---|---|
| `<sistema>-migraciones` | Aplica el esquema como `sgtm_owner`. Corre y termina | `migrador` |
| `<sistema>-implantacion` | La fila de `municipalidad` en **su** base, perfil `batch`. Corre y termina | `aplicacion` |
| `<sistema>` | El backend, perfil `web` | `aplicacion` |

Se enganchan a `kamayuk-plataforma` con `external: true`, no copian PostgreSQL ni Keycloak, y cada
uno apunta a **su** base.

### El backend se llama como su sistema, y eso no es estilo

Los cuatro composes y el de la plataforma comparten **una** red, y Compose le da a cada servicio un
alias de red con su nombre. Cuatro servicios llamados `aplicacion` —que es como los llama el
`compose.yaml` del monolito, y lo que uno copia sin pensar— dejarían ese alias resolviendo a **uno
cualquiera de los cuatro**. El síntoma no sería un error: sería una petición que a veces llega a
quien no era.

Y no hay que elegirlo: **la propia aplicación ya lo da por hecho**. El valor por omisión de
`kamayuk.caja.origenes`, en el `application.yaml` de `caja`, es
`{rentas: 'http://rentas:8080/rentas/api/v1'}` — o sea que el servicio del backend de `rentas` tiene
que responder al alias `rentas`. Lo que hace la guarda es convertir eso en algo que se comprueba:
ningún alias declarado por dos proyectos, y ningún anfitrión HTTP nombrado en una variable que
nadie sirva.

### Ninguno publica un puerto

Se entra por el ingreso, bajo el prefijo de cada uno (ADR-0030 §2), que es **exactamente la misma
ruta que en el clúster**. Es lo que evita descubrir en `stg` que el prefijo no era el que se creía.
La consecuencia es que `/actuator/health` —que no está bajo ningún prefijo— se mide desde dentro
del contenedor, igual que C-17 la midió desde dentro de los pods.

### Lo que C-17 arregló, aquí también

- **El anfitrión del motor** (C-17, punto 1). En compose el servicio se llama `base`, no `postgres`
  ni `sgtm-stg-postgres`. Y no está escrito en la guarda: se **deriva** del compose de la
  plataforma —el único servicio cuya imagen es un PostgreSQL—, de modo que renombrarlo son cuatro
  rojos y no cuatro `Connection refused`.
- **La ruta de la sonda contra la cadena** (C-17, punto 2). El `healthcheck` pide
  `/actuator/health`, y la guarda comprueba que esa ruta esté entre las que `SeguridadWeb` atiende
  **sin token**, leyéndolo del Java con el mismo analizador de `sondas-contra-la-cadena`. Con la
  cadena anterior a C-17 esto contestaba 401 y el contenedor se quedaba `unhealthy` **para
  siempre**, con la aplicación sana — y aquí además cuelga el `depends_on: service_healthy` de
  quien lo espere.
- **El objetivo del `Dockerfile`** (C-14, punto 1, que C-17 volvió a medir). El migrador construye
  `migrador` y no `aplicacion`: las credenciales de `sgtm_owner` existen durante la migración y
  desaparecen con ella.
- **El `Deployment` que termina** (C-17, punto 5). Aquí se aplica **no haciendo algo**: los
  `CronJob` del ingestor de `rentas` y del publicador de `catastro` **no están** en el compose. El
  perfil `batch` termina el proceso, así que un servicio más sería un contenedor que sale con
  código 0 y al que Compose reiniciaría en bucle. Queda como hueco declarado, abajo.

**Lo que no aplica**: la política de egreso (C-17, punto 3) no tiene equivalente en Compose —no hay
`NetworkPolicy`, y la red del compose es plana—, y los secretos espejo (C-17, punto 4) tampoco: en
compose las claves salen del `.env`, que es un solo archivo y no cinco espacios de nombres. Las dos
cosas se dicen aquí en vez de dejarlas sin mencionar.

---

## 2 · La guarda: se derivan las dos mitades y se comparan

`infra/verificaciones/compose-de-los-sistemas.ts` y su prueba, **25 casos**, sin Docker y sin
levantar nada. Lee `<sistema>/despliegue/compose.yaml` y compone los manifiestos de
`<sistema>/infrastructure/src/descriptor.ts` igual que `yarn manifiestos`, y produce la
**diferencia**.

No se copia una lista. La alternativa —escribir en la prueba «`catastro` declara estas seis
variables»— sería un tercer sitio con la misma verdad, y el que envejece sin que nada se ponga
rojo. Lo que compara, proceso a proceso:

- **los nombres de las variables de entorno, en las dos direcciones.** Una que entra en el clúster
  y no en el compose es la deriva que ADR-0011 nombra; una que existe sólo en local es peor de
  leer, porque el sistema funciona en la máquina de quien la escribió y falla desplegado con una
  configuración que nadie echa de menos;
- **la base al final de cada URL JDBC** —pedir la de otro sistema es una base compartida
  disfrazada— y **el anfitrión**, derivado del compose de la plataforma;
- **el rol de PostgreSQL** con que se conecta cada proceso;
- **el objetivo del `Dockerfile`** que construye cada servicio;
- **el prefijo de Traefik**: el suyo y sólo el suyo (prohibición (a): reclamar el de otro no falla,
  se lo queda);
- **la ruta de la sonda** contra lo que la cadena de ese sistema atiende sin token;
- **la red**, que tiene que ser la externa de la plataforma.

Lo que **no** compara son los valores que por definición difieren: la etiqueta de la imagen, el
anfitrión del motor y la forma de entregar una clave (`secretKeyRef` frente a `${...}` del `.env`).
Eso está escrito en el módulo, para que no se cierre por descuido.

Y **falla cuando no puede mirar**: un clon sin `despliegue/compose.yaml` lanza nombrando la ruta y
el remedio, en vez de devolver la lista vacía. Es el modo de fallo de #188 con
`verificar-cuadros.mjs`, y era el estado exacto de los cuatro hasta hoy.

### Las mutaciones

> **La que pide el criterio 2.** Renombrar `KAMAYUK_CAJA_CANAL` a `KAMAYUK_CAJA_CANALES` en el
> compose real de `caja`, y restaurar por copia comparada con `cmp`.
> → **3 en rojo**, y las dos frases que salen son el defecto entero:
>
> ```
> [web] «caja» no declara «KAMAYUK_CAJA_CANAL», y el descriptor se la da al mismo proceso en el
>       cluster. Es exactamente la deriva que ADR-0011 anoto: una variable nueva que entra en el
>       cluster y no en el compose.
> [web] «caja» declara «KAMAYUK_CAJA_CANALES» y el descriptor no se la da en el cluster. La deriva
>       en la otra direccion es peor de leer: el sistema funciona en local y falla desplegado, con
>       una configuracion que nadie echa de menos.
> ```
>
> Los otros dos rojos son las pruebas que exigen **exactamente un** hallazgo al mutar: con la
> variable renombrada encuentran tres, que es la señal de que el censo cuenta y no repite la
> fórmula. Restaurado: `cmp` sin diferencias, 25/25 otra vez.

> **Apartar el compose de `catastro`** — que es el estado en que estaban los cuatro antes de C-18,
> con el README diciendo lo contrario.
> → El archivo **no llega a tener pruebas**: `Tests no tests`, con
> «No esta «…/catastro/despliegue/compose.yaml» … Remedio: git clone …». Es la dirección correcta:
> «no se pudo comprobar» no puede leerse igual que «está bien».

> **Renombrar el servicio del motor de la plataforma** (pasarle a la comparación
> `motor-renombrado` en vez del derivado).
> → Rojo en los cuatro, nombrando `UnknownHostException`. Es lo que impide que `base` se convierta
> en un literal escrito en cuatro sitios.

> **Las cinco muestras**, en `verificaciones/muestras/compose-de-los-sistemas/`, sobre un sistema
> inventado (`mercados`): el migrador que corre la imagen de la aplicación (**1**, nombrando el
> servicio y el objetivo), apuntar a la base de otro (**3**, uno por proceso), reclamar el prefijo
> de otro (**1**), la sonda que pide lo que la cadena niega (**1**, nombrando `unhealthy`) y la red
> que no es externa (**1**).
>
> **La sexta muestra es la que importa y es la que pasa**: `en-regla.compose.yaml` produce **cero**
> hallazgos. Sin ese contraste, «hoy los cuatro reales no tienen hallazgos» no distinguiría una
> guarda que funciona de una apagada.

---

## 3 · El README, corregido a lo que hay

Dos frases eran falsas y las dos se corrigieron, con la corrección dicha en el propio texto en vez
de reescrita en silencio:

- «cada repositorio de sistema trae su propio compose, con **sólo su backend y su frontend**» →
  **sólo su backend**, con una nota que dice que hasta C-18 decía lo otro, que **ninguno de los
  cuatro repositorios tiene `frontend/`**, y que ADR-0030 §1 decide que habrá uno por sistema y hoy
  no existe ninguno;
- «levantar cuatro backends, **cuatro frontends**, Keycloak y PostgreSQL» → «los cuatro backends —y,
  cuando existan, sus cuatro frontends—».

El ejemplo inventado se sustituye por la tabla de los tres servicios reales, con enlaces a los
cuatro archivos, y la sección «La trampa que esto hereda» pasa a nombrar **las dos** guardas y qué
mide cada una.

**El frontend no se inventa.** Escribir un servicio `interfaz` en los cuatro composes apuntando a
un `frontend/` que no existe habría sido exactamente el defecto que este entregable arregla, un
nivel más abajo: un archivo que promete algo que no está.

---

## 4 · La evidencia: los cuatro levantados de verdad

Contra el demonio Docker del VPS `vmd205066` (Ubuntu, 6 CPU / 12 GB, Docker 29.1.3, Compose
v5.5.1), con los cinco clones copiados manteniendo la disposición de hermanos —`plataforma.compose.yaml`
monta `../../rentas/…`, `../../catastro/…`— y **sin tocar ninguno de los contenedores que ya
corrían allí**.

```
docker compose -f infrastructure/despliegue/plataforma.compose.yaml up -d --wait
cd <sistema> && docker compose -f despliegue/compose.yaml up --build -d --wait
```

### La plataforma, y sus cuatro bases

```
                                    List of databases
    Name     |  Owner   | Encoding |        Access privileges
-------------+----------+----------+---------------------------------
 caja        | postgres | UTF8     | sgtm_owner=c/… sgtm_app=c/… sgtm_readonly=c/…
 catastro    | postgres | UTF8     | …
 normativa   | postgres | UTF8     | …
 rentas      | postgres | UTF8     | …

rentas:    plpgsql, pg_trgm, unaccent
catastro:  plpgsql, btree_gist, postgis, unaccent
normativa: plpgsql
caja:      plpgsql
```

Cada base con **las extensiones que su propio `crear-roles.sql` declara y ninguna más**: es C-10
funcionando, medido otra vez de paso.

### Los doce contenedores: los cuatro backends sanos, las ocho tareas con salida 0

```
SERVICE                  STATUS
rentas                   Up 3 minutes (healthy)
rentas-implantacion      Exited (0) 3 minutes ago
rentas-migraciones       Exited (0) 3 minutes ago
catastro                 Up 20 minutes (healthy)
catastro-implantacion    Exited (0) 20 minutes ago
catastro-migraciones     Exited (0) 20 minutes ago
normativa                Up 31 minutes (healthy)
normativa-implantacion   Exited (0) 31 minutes ago
normativa-migraciones    Exited (0) 31 minutes ago
caja                     Up 15 minutes (healthy)
caja-implantacion        Exited (0) 15 minutes ago
caja-migraciones         Exited (0) 15 minutes ago
```

`healthy` no es decorativo: es el `healthcheck` del compose contestando `200` a
`/actuator/health` desde dentro del contenedor, que es lo que `--wait` espera antes de volver.

### Y las cuatro sondas, medidas desde dentro

```
rentas     {"groups":["liveness","readiness"],"status":"UP"} <- 200
catastro   {"groups":["liveness","readiness"],"status":"UP"} <- 200
normativa  {"groups":["liveness","readiness"],"status":"UP"} <- 200
caja       {"groups":["liveness","readiness"],"status":"UP"} <- 200
```

### Migrado e implantado, en su propia base

```
rentas     flyway=13  municipalidad=Municipalidad Provincial de Sullana   accesos=134
catastro   flyway=5   municipalidad=Municipalidad Provincial de Sullana   accesos=11
normativa  flyway=1   municipalidad=Municipalidad Provincial de Sullana   accesos=1
caja       flyway=2   municipalidad=Municipalidad Provincial de Sullana   accesos=3
```

Los 134 accesos de `rentas` son el catálogo del manual sembrado; los 11 de `catastro`, 1 de
`normativa` y 3 de `caja` son sus `@RequiereAcceso`. **Esa fila de `rentas` no estaba** en la
primera corrida, y de ahí sale el §5.

### Y por el ingreso, cada prefijo a su dueño

```
/catastro/api/v1/nada    -> 401 Unauthorized     (contesta el backend: la cadena lo niega)
/normativa/api/v1/nada   -> 401 Unauthorized
/caja/api/v1/nada        -> 401 Unauthorized
/rentas/api/v1/nada      -> 401 Unauthorized
/inventado/api/v1/nada   -> 404 Not Found        (Traefik: nadie reclama ese prefijo)
```

El `401` es la respuesta que importa: dice que la petición **llegó al backend** y que la cadena de
identidad la rechazó, que es exactamente lo que tiene que pasar sin token. Un `404` diría que
Traefik no encontró a nadie.

---

## 5 · Lo que salió de levantarlo: `rentas` migraba y **no se implantaba**

No se buscaba. Con los cuatro arriba, la comprobación de rutina —«¿tiene cada base su fila de
`municipalidad`?»— dio esto:

```
rentas     flyway=13  municipalidad=(vacía)
catastro   flyway=5   municipalidad=Municipalidad Provincial de Sullana
normativa  flyway=1   municipalidad=Municipalidad Provincial de Sullana
caja       flyway=2   municipalidad=Municipalidad Provincial de Sullana
```

Y el contenedor de implantación de `rentas` había salido con **código 0**, sin un solo error:

```
The following 1 profile is active: "batch"
No TaskScheduler/ScheduledExecutorService bean found for scheduled processing
Started SgtmAplicacion in 11.617 seconds (process running for 12.991)
```

Arrancó, no hizo nada y se fue.

### La causa: el prefijo de la propiedad, escrito en dos sitios

`rentas` es el monolito y **conserva el suyo**: `DatosDeImplantacion` declara
`@ConfigurationProperties("sgtm.implantacion")`, y `RegistroDeMunicipalidadesJdbc` lee
`${sgtm.implantacion.url}` y `${sgtm.implantacion.owner-clave}`. Los otros tres estrenaron
`kamayuk.implantacion` **a propósito** —lo dice su propio javadoc: «tener nombres distintos hace
imposible que un descuido apunte el Job de implantación de `catastro` con las variables del de
`rentas`»—.

Y el descriptor de `rentas`, escrito en C-14 copiando el de sus hermanos, ponía
`KAMAYUK_IMPLANTACION_*`.

**El síntoma no se parece a su causa, y por eso llevaba desde C-14 sin que nadie lo viera.**
`ImplantarMunicipalidad` está condicionado a `@ConditionalOnProperty("sgtm.implantacion.ubigeo")`:
con el prefijo ajeno el runner **ni siquiera se registra**. No hay excepción, no hay aviso, el
proceso sale con 0 — y en Kubernetes el `Job` queda **`Complete`**. La evidencia de C-17 lo recoge
tal cual, y se leyó como éxito:

```
kamayuk-rentas-implantacion-c755de214934   Complete   1/1   25s
```

Es la misma forma exacta que `yarn capacidad` tenía antes de C-16 y `bootstrap-secretos.sh` antes
de C-17 §4: **una herramienta que contesta que sí porque no está mirando.**

Lo que cuesta no es un pod en rojo. Sin fila de `municipalidad` no hay `municipalidad_id` que poner
en ningún token, ni accesos sembrados, ni grupo de administración, ni administrador: **a `rentas`
—el sistema que tiene el padrón, la seguridad y las 134 opciones del catálogo— no puede entrar
nadie**, y el despliegue se declara correcto.

### El arreglo va en el descriptor, no en el Java

Los prefijos distintos son una decisión escrita y buena: igualarlos por el lado de `rentas` exige
renombrar la propiedad en su Java —y con ella el `@ConditionalOnProperty`, los dos `@Value` y el
`compose.yaml` del monolito—, y por el lado de los otros tres deshace la separación que su javadoc
pide. La mitad equivocada es la que **compone** la variable, así que `rentas/infrastructure/src/descriptor.ts`
y su compose pasan a `SGTM_IMPLANTACION_*`.

### Y dos guardas fosilizaban el defecto

Igual que en C-17 §1, donde `despliegue-de-los-sistemas.test.ts` exigía el anfitrión roto:

- `infrastructure/infra/verificaciones/despliegue-de-los-sistemas.test.ts` exigía
  `KAMAYUK_IMPLANTACION_UBIGEO` **en los cuatro**;
- `rentas/infrastructure/verificaciones/descriptor.test.ts` lo exigía para `rentas`.

Las dos pedían el nombre que no funciona. La primera pasa a derivar el prefijo del Java
(`variableDe(prefijoDeLaImplantacion(sistema))`); la segunda lleva el literal correcto con el
porqué al lado — ese paquete no tiene `@types/node` y no puede leer un archivo sin estrenar una
dependencia, y lo que ata ese literal a su Java es la guarda nueva de `infrastructure`.

### La guarda nueva: la tercera mitad

`infra/verificaciones/prefijo-de-la-implantacion.ts` y su prueba, **12 casos**. Lee el
`@ConfigurationProperties` de `DatosDeImplantacion` de cada sistema, lo traduce a prefijo de
variable de entorno —el punto se vuelve guion bajo, mayúsculas: la *relaxed binding* de Spring— y
exige que ninguna variable de implantación del descriptor lleve otro. Comprueba además que el
`@ConditionalOnProperty` del runner use **ese mismo** prefijo, que es lo que explica por qué el
defecto es mudo.

Y fija la asimetría contra el código —`rentas: sgtm.implantacion`, los otros tres
`kamayuk.implantacion`— para que igualarlos sea una decisión y no un descuido.

> **Mutación.** Devolver el descriptor de `rentas` a `KAMAYUK_IMPLANTACION_*` —el estado exacto
> anterior a C-18—, y restaurar por copia comparada con `cmp`.
> → **1 en rojo**, con las ocho variables nombradas una a una:
> `KAMAYUK_IMPLANTACION_ADMINISTRADOR`, `_ESDEMOSTRACION`, `_NOMBRE`, `_NOMBREDELADMINISTRADOR`,
> `_OWNERCLAVE`, `_TIPO`, `_UBIGEO`, `_URL`.
>
> **El contraste**: `SGTM_DB_URL` y `KAMAYUK_CAJA_CANAL` **no** se marcan. Una guarda que
> señalara toda variable con otro prefijo acabaría ignorándose.

### Verificado levantándolo otra vez

Con el arreglo puesto, `rentas` reconstruido y vuelto a levantar:

```
Municipalidad 200101 lista (DEMOSTRACION): id 1, 134 accesos nuevos, administrador 'jperez',
134 permisos al grupo 'Administracion del sistema', 11 al grupo 'Seguridad'
```

---

## Huecos declarados

1. **Ningún compose trae frontend, porque no hay ninguno.** Los cuatro repositorios no tienen
   `frontend/`. Cuando exista, entra en el compose de su sistema —igual que `interfaz` está en el
   `compose.yaml` del monolito— y hay que volver a leer esta sección del README.

2. **Los dos `CronJob` del perfil `batch` no tienen equivalente en compose.** El publicador del
   padrón de `catastro` y el ingestor de `rentas` se declaran en `lotes()` del descriptor y aquí no
   están: Compose no tiene ventana horaria, y el perfil `batch` termina el proceso, así que un
   servicio más sería un `CrashLoopBackOff` con salida 0 (C-17, punto 5). Correrlos a mano es
   `docker compose run --rm` con su variable propia —`KAMAYUK_CATASTRO_PUBLICACION_MUNICIPALIDAD`,
   `KAMAYUK_RENTAS_INGESTOR_*`—, y eso no está escrito en ningún guion.

3. **No hay `depends_on` entre proyectos de Compose, así que el orden entre la plataforma y cada
   sistema lo pone quien levanta.** Un `up` de un sistema con la base todavía arrancando deja su
   migrador muerto en el primer intento. Se mitiga con `--wait` en la plataforma —que es lo que el
   README manda— y **no se cierra aquí**: cerrarlo exigiría que cada compose de sistema conociera el
   nombre del contenedor de la base, que es composición de la plataforma y no suya. Es la misma
   forma que el hueco 5 de C-17, con la ventana en el otro extremo.

4. **La guarda compara nombres de variables, no valores.** Un `SGTM_DB_USUARIO: sgtm_owner` en el
   compose del backend sí sale rojo —el rol se compara—, pero un valor de negocio mal puesto no.
   Compararlos todos exigiría un mapeo entre el ambiente del clúster y el `.env`, y ese mapeo sería
   el tercer sitio con la misma verdad.

5. **El compose de los cuatro no corre en CI.** Estas 25 pruebas sí —no necesitan Docker—, pero
   levantar los cuatro contra la plataforma es lo que se hizo a mano aquí. Es el mismo hueco que
   `verificar-el-ambiente.sh` tenía antes de #675, y la misma respuesta: mientras no corra nadie, lo
   que sujeta la coincidencia entre las dos formas es la guarda estática.

6. **El prefijo de implantación de `rentas` lo ata `infrastructure`, no su propio CI.** Su
   `verificaciones/descriptor.test.ts` lleva el literal `SGTM_IMPLANTACION_` porque ese paquete no
   tiene `@types/node` y no puede leer su Java sin estrenar una dependencia. Si alguien renombra la
   propiedad en el Java de `rentas`, quien se pone rojo es `prefijo-de-la-implantacion.test.ts` de
   aquí, no el CI de `rentas`. Es el mismo reparto que `checkout-en-el-espacio-de-trabajo`, y por
   eso está dicho.

7. **El `Job` de implantación de `rentas` está roto en `stg` y en `prod` desde C-14**, y el arreglo
   sólo entra al desplegar. Hasta que se despliegue, la base de `rentas` de los dos ambientes no
   tiene fila de `municipalidad` — habría que comprobarlo contra el clúster, y aquí no se hizo: lo
   medido es el compose.
