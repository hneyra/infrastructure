# R-A/B — el renombrado del código: `sgtm` → `kamayuk`

**Estado:** aplicado en los cinco repositorios vivos. El repositorio `sgtm` **no se tocó**.

La dirección decidió que el producto se llama **Kamayuk**. Este entregable hace las **etapas A y
B** de las cuatro en que el renombrado se parte: lo barato que no toca nada desplegado (A) y las
variables de entorno y el prefijo de propiedades (B), que es **donde el fallo es mudo**. Las
etapas C (los roles de PostgreSQL) y D (los nombres de recurso de k3s y las claves de Pulumi) no
entran, y abajo se dice qué queda de ellas.

Lo que gobierna esta etapa es la lección de [C-18 §5](C-18-el-compose-de-los-cuatro.md): el
descriptor de `rentas` pasaba `KAMAYUK_IMPLANTACION_*` y su Java leía `sgtm.implantacion`, y el
resultado **no fue un error**. El runner no se registraba (`@ConditionalOnProperty`), la
aplicación arrancaba, no hacía nada y **salía con código 0** — `Complete` en Kubernetes. Se
descubrió levantando el compose y mirando la tabla: 13 migraciones aplicadas y `municipalidad`
vacía, o sea **a `rentas` no podía entrar nadie** y el despliegue se declaraba correcto.

Por eso aquí las tres mitades —el Java, el descriptor de Kubernetes y el compose— se renombran
**a la vez**, y por eso el criterio de aceptación no es «el contenedor sale con 0» sino «la fila
de `municipalidad` está escrita».

---

## 1 · Lo renombrado, categoría por categoría, con su cifra

Dos cifras por categoría, y conviene no mezclarlas. La primera es **lo que este commit
renombró**, contado sobre su propio diff (`git show --unified=0`); la segunda es **lo que el árbol
dice hoy**, contando el nombre nuevo (sin `.git`, `node_modules`, `build` ni `.gradle`) — es mayor
porque incluye lo que ya se llamaba `kamayuk` desde C-14 y las menciones de este propio documento.

Renombrado por este commit:

| # | Categoría | Qué pasa a ser | infrastructure | rentas | catastro | normativa | caja |
|---|---|---|---|---|---|---|---|
| A1 | El paquete npm del contrato y los de infra | `@sgtm/…` → `@kamayuk/…` | 21 | 11 | 6 | 6 | 6 |
| A2 | `pe.gob.sgtm` **vivo** | el paquete real de cada sistema | 4 | 4 | — | 2 | — |
| A3 | El artefacto | `<sistema>.jar` en `/opt/kamayuk/` | — | 3 | 3 | 3 | 3 |
| B4 | Variables de entorno | `SGTM_*` → `KAMAYUK_*` | 420 | 170 | 148 | 96 | 113 |
| B5 | Prefijo de propiedades Spring | `sgtm.*` → `kamayuk.*` | 25 | 60 | 35 | 17 | 10 |

Y lo que el árbol dice hoy, con el nombre nuevo:

| Categoría | infrastructure | rentas | catastro | normativa | caja |
|---|---|---|---|---|---|
| `@kamayuk/` | 22 | 11 | 6 | 6 | 6 |
| `KAMAYUK_*` | 472 | 184 | 169 | 113 | 150 |
| `kamayuk.<propiedad>` | 34 | 61 | 48 | 30 | 23 |
| `/opt/kamayuk` | 8 | 2 | 2 | 3 | 2 |

**El encargo daba 2 139 menciones de `SGTM_[A-Z_]+` en los cuatro y 886 en `infrastructure`, y
esa cifra no es la de esta etapa.** Medida sin distinguir mayúsculas incluye los **roles de
PostgreSQL** —`sgtm_app`, `sgtm_owner`, `sgtm_readonly`, `sgtm_monitor`, `sgtm_respaldo`—, que
son la etapa C y están fuera. Las variables de entorno de verdad, en mayúsculas, son **517 en los
cuatro y 435 en `infrastructure`**; el resto de esos 2 139 son 1 316 `sgtm_app` + 542
`sgtm_owner` + 515 `sgtm_readonly` + 53 `sgtm_respaldo` + 30 `sgtm_monitor`, casi todos dentro
de los cuatro `V1__baseline.sql`.

### A1 · el paquete del contrato

`@sgtm/infra-contrato` → `@kamayuk/infra-contrato`, y con él `@sgtm/infra-{rentas,catastro,
normativa,caja}` → `@kamayuk/infra-…`. Los cuatro lo declaran como `link:` y el `paths` de
`infra/tsconfig.json` lo resuelve para el CI de este repositorio (C-9a), que clona los cuatro sin
instalar sus dependencias.

**Y la guarda que ata las dos declaraciones fosilizaba el nombre.**
`enlace-del-contrato.test.ts` llevaba `const LLAVE = "@sgtm/infra-contrato"` escrito a mano: con
el literal puesto habría seguido comprobando que `paths` y `link:` coinciden **en el nombre
viejo**, que es la misma forma exacta con que C-17 §1 encontró
`despliegue-de-los-sistemas.test.ts` exigiendo `postgres:5432` y C-18 §5 encontró dos guardas
pidiendo `KAMAYUK_IMPLANTACION_UBIGEO`. Ahora la llave **se lee del `name` de
`infra/contrato/package.json`**, que es el único sitio donde ese nombre tiene que estar escrito.

### A2 · `pe.gob.sgtm`: qué era código vivo y qué es prosa del archivo histórico

De las 27 menciones, **10 eran código o documentación viva** y se renombraron; **17 se quedan**,
y se dicen una a una en §4.

Las vivas:

- `comun-verificaciones/ProhibicionesEnElCodigoFuenteTestBase.java` — tres muestras de código
  fuente que el escáner analiza, escritas con `pe.gob.sgtm.dominio.Alicuota`. Pasan a
  `kamayuk.comun.verificaciones.muestras.dominio.Alicuota`, que **existe** en la propia
  biblioteca. Una cuarta nombraba `pe.gob.sgtm.dominio.ValorNormativo`, que no existe en ninguna
  parte de la librería: se deja con el nombre simple, porque la muestra es texto y un paquete
  real con una clase inexistente confunde más que ninguno.
- `ReglasDeArquitectura.java` — un `{@link pe.gob.sgtm.dominio.Observacion}` que era **un enlace
  javadoc roto**: esa clase no existe desde la separación.
- `rentas/docs/40-datos/modelo-logico-fisico.md`, `rentas/infra/carga-de-datos/ejemplos/deuda.csv`
  (`kamayuk.rentas.cuentacorriente.TributoDelLibro`),
  `rentas/docs/30-arquitectura/contextos-acotados.md` (`kamayuk.rentas.autorizacion`) y
  `normativa/docs/…/aranceles-2026.md` (`kamayuk.catastro.catastro.…`) — prosa viva que nombra
  código vivo. Los cuatro destinos se comprobaron con `find` antes de escribirlos.

### A3 · el artefacto: cada sistema produce su jar, y el `ENTRYPOINT` lo arranca

Antes de esto los cuatro **no decían lo mismo**: `rentas`, `catastro` y `caja` declaraban
`archiveFileName.set("sgtm.jar")` y `normativa` `normativa.jar`. Ese desajuste no es cosmético —
es exactamente el arreglo B de C-17: el `Dockerfile` de `normativa` pedía `sgtm.jar` porque se
copió de un hermano, y **la imagen no se podía construir**.

Ahora: `archiveFileName.set("<sistema>.jar")`, `COPY … /opt/kamayuk/<sistema>.jar` y
`ENTRYPOINT ["java","-jar","/opt/kamayuk/<sistema>.jar"]`. El usuario sin privilegios de la imagen
de aplicación pasa de llamarse `sgtm` a `kamayuk` (el `USER` es numérico, `10001`, así que el
nombre no decide nada).

**Y hacía falta una guarda más**, porque C-17 ató una mitad y dejó la otra suelta. La existente
compara el **origen** del `COPY` contra el `archiveFileName` del módulo. Nadie comparaba el
**destino** del `COPY` contra el `-jar` del `ENTRYPOINT`, que es el mismo nombre escrito dos veces
en el mismo archivo — y su síntoma llega más tarde que el de C-17: la imagen **se construye sin
protestar** y el contenedor muere al arrancar con «Unable to access jarfile», que desde el clúster
es un `CrashLoopBackOff` sin una línea que lo explique. La guarda nueva
(`despliegue-de-los-sistemas.test.ts`, 4 casos, uno por sistema) exige las tres cosas: que el jar
se llame como su sistema, que el destino sea `/opt/kamayuk/<sistema>.jar` y que el `ENTRYPOINT`
arranque **ese**.

### B4 y B5 · las variables y el prefijo, renombrados juntos

`SGTM_DB_URL`, `SGTM_DB_USUARIO`, `SGTM_DB_CLAVE`, `SGTM_DB_OWNER_*`, `SGTM_OIDC_*`,
`SGTM_CLAVE_*`, `SGTM_PUERTO_*`, `SGTM_CARGA*_ARCHIVO`, `SGTM_PUBLICACION*`,
`SGTM_CONJUNTOPARAMETROS_*`… → `KAMAYUK_*`. Y con ellas **el prefijo de propiedad del que Spring
las deriva**, que es la mitad que hace mudo el fallo:

| Prefijo | Dónde vivía | Sistemas |
|---|---|---|
| `sgtm.implantacion` | `DatosDeImplantacion`, `ImplantarMunicipalidad`, `RegistroDeMunicipalidadesJdbc` | **rentas** (los otros tres ya estaban en `kamayuk.`) |
| `sgtm.portal.oidc` | `SeguridadWeb` y `application.yaml` | los cuatro |
| `sgtm.redondeo` | `ConfiguracionDeCuentaCorriente` y `application.yaml` | rentas |
| `sgtm.carga-*` (11 familias) | los cargadores `@ConditionalOnProperty` | rentas, catastro, caja |
| `sgtm.conjunto-parametros`, `sgtm.publicacion-parametros`, `sgtm.publicacion-cuadros` | los tres procesos `batch` de parámetros | normativa |
| `sgtm.anti-entropia` | `CorrerLaAntiEntropia` | rentas |
| `sgtm.formas.regenerar`, `sgtm.respuestas.regenerar` | dos propiedades de sistema que Gradle reenvía | rentas |

**La asimetría de C-18 desaparece, y se mide en el manifiesto**: `yarn manifiestos --ambiente stg`
pasa de **92 nombres de variable distintos a 84**, y los ocho que se van son exactamente los
`SGTM_IMPLANTACION_*` que `rentas` necesitaba por ser el único que leía el prefijo del monolito.

**El arreglo va ahora por el lado contrario al de C-18, y ése es el cambio de decisión.** C-18
arregló el descriptor de `rentas` porque «igualarlos por el lado de `rentas` exige renombrar la
propiedad en su Java». R-A/B renombra el Java, que es lo que la dirección pidió; la separación que
el javadoc de los tres hermanos defendía —«tener nombres distintos hace imposible que un descuido
apunte el Job de `catastro` con las variables del de `rentas`»— **sigue cubierta**, y no por el
nombre sino por la guarda que compara **cada** descriptor contra **su** Java: cada sistema tiene su
propio Job, su propio namespace y su propia base.

---

## 2 · Las guardas: cuáles fosilizaban el nombre viejo y cuál faltaba

El encargo pedía comprobar que ninguna guarda quedara exigiendo el valor roto. **Tres lo hacían.**

| Guarda | Qué fosilizaba | Qué se hizo |
|---|---|---|
| `enlace-del-contrato.test.ts` | `const LLAVE = "@sgtm/infra-contrato"` | la llave se **lee** del `package.json` del contrato |
| `siembra-de-la-demostracion.ts` | el patrón `/\bSGTM_[A-Z0-9]+_ARCHIVO\b/` | el patrón pierde el prefijo del producto |
| `prefijo-de-la-implantacion.test.ts` | fijaba «rentas: `sgtm.implantacion`» como la verdad | fija que los cuatro leen **el mismo**, leído del Java |

La segunda es la que más enseña, y **no hubo que razonarla: se puso roja sola**. Con los doce
guiones de carga renombrados a `KAMAYUK_…_ARCHIVO`, el patrón con `SGTM_` dentro no encontró ni
una y los doce salieron como «`rentas/cargar-deuda-demo.sh`: no manda exactamente una variable
`..._ARCHIVO`» — un mensaje que **apunta al guion cuando el problema estaba en la guarda**. Sin el
prefijo dentro, un guion que mande la variable con otro nombre se encuentra igual y lo que lo
delata es la comparación contra `variableDe(proceso)`, que dice los dos nombres.

Y la tercera no se borra: su mutación pasa a usar `SGTM_IMPLANTACION_*` como el prefijo **ajeno**,
que es lo que ahora es de verdad. El defecto de C-18 se sigue midiendo, con los papeles cambiados.

**La guarda que faltaba** es la del `ENTRYPOINT` (§A3). Las que ya existían y siguen mordiendo sin
tocarlas —porque **derivan** en vez de comparar contra una lista— son
`variables-sin-omision.ts` (el `application.yaml` contra el descriptor),
`compose-de-los-sistemas.ts` (el compose contra el descriptor, en las dos direcciones) y
`prefijo-de-la-implantacion.ts` (el descriptor contra el `@ConfigurationProperties` del Java).

---

## 3 · Las mutaciones

Cada una se aplicó **sola**, se ejecutó, y se restauró **por copia comparada con `cmp`**.

> **A3-1 — `caja` vuelve a producir `sgtm.jar`** (el estado exacto anterior a R-A/B).
> → **2 en rojo**, y las dos frases son el defecto: «el Dockerfile de «caja» copia «caja.jar» y su
> modulo produce «sgtm.jar» … expected 'caja.jar' to be 'sgtm.jar'» (la guarda de C-17) y «el jar
> de cada sistema lleva SU nombre, «caja.jar»» (la nueva). `cmp` sin diferencias al restaurar.

> **A3-2 — el `ENTRYPOINT` de `rentas` arranca `/opt/sgtm/sgtm.jar` y el `COPY` deja otro.**
> → **1 en rojo**: «el ENTRYPOINT de «rentas» arranca «/opt/sgtm/sgtm.jar» y el COPY deja el jar en
> «/opt/kamayuk/rentas.jar»». **Es la mutación que este issue existía para poder hacer**: hasta
> hoy nada la veía, y el `docker build` tampoco — el desajuste sólo aparece al arrancar.

> **B-1 — el Java de `rentas` vuelve a `@ConfigurationProperties("sgtm.implantacion")`** (el
> estado anterior a R-A/B, o sea el defecto de C-18 reintroducido por su otra mitad).
> → **3 en rojo**: «expected [ …(8) ] to deeply equal []» —las ocho variables de implantación
> nombradas una a una—, «expected { rentas: 'sgtm.implantacion', …(3) }» y el
> `@ConditionalOnProperty` del runner, que es **el que explica por qué el fallo es mudo**.

> **B-2 — el `application.yaml` de `caja` se queda con `SGTM_OIDC_EMISOR` y el descriptor no.**
> → **2 en rojo** (uno por ambiente): «`kamayuk-caja-web` (perfil web) no declara
> SGTM_OIDC_EMISOR … Spring no puede resolver el marcador y el pod no levanta: no arranca
> degradado, no arranca».

> **B-3 — el compose de `caja` se queda con `SGTM_DB_URL` y el descriptor no.**
> → **3 en rojo**, uno por proceso, cada uno nombrando la variable y el proceso: «[web] «caja» no
> declara «KAMAYUK_DB_URL», y el descriptor se la da al mismo proceso en el cluster. Es
> exactamente la deriva que ADR-0011 anoto».

---

## 4 · Lo que NO se renombró, y por qué

Nada de lo que sigue es un descuido: cada línea se miró.

### Fuera de alcance por decisión del encargo

1. **Los roles de PostgreSQL** `sgtm_app`, `sgtm_owner`, `sgtm_readonly`, `sgtm_monitor`,
   `sgtm_respaldo` — **2 456 menciones**, casi todas en los cuatro `V1__baseline.sql` y en las
   políticas de RLS. Es la etapa C.
2. **Los nombres de recurso de k3s** (`sgtm-stg`, `sgtm-prod`, `sgtm-stg-postgres`,
   `sgtm-stg-observabilidad-prometheus`…), el `proyecto: "sgtm"`, `BASE_DEL_PADRON = "sgtm"` y las
   claves de configuración de Pulumi. Es la etapa D.
3. **El repositorio `sgtm`.** Ni una línea.

### Prosa que habla del archivo histórico — 17 menciones de `pe.gob.sgtm` y 9 archivos con `SGTM_`

- `infrastructure/backend/sgtm-esquema/**` y `backend/sgtm-dominio-compartido/**` — las 68
  migraciones del monolito **como referencia histórica** (`CLAUDE.md` lo dice) y su `TipoDocumento`.
  Ahí ese paquete se sigue llamando así.
- `rentas/…/V1__baseline.sql` y su copia en `docs/40-datos/baselines/rentas/` — dos
  `COMMENT ON COLUMN` que citan `pe.gob.sgtm.cuentacorriente.TributoDelLibro` y
  `pe.gob.sgtm.rentas.dominio.TipoTransferencia`. **No se tocan, y no es prudencia**: una
  migración aplicada es inmutable, editarla cambia su suma de Flyway y **rompe todo ambiente que
  ya la corrió** (la lección que #742 dejó escrita y que `V64` y `V77` respetan). Es un hueco real
  y está declarado abajo.
- `docs/00-gobierno/C-*.md` — son **actas**: cada una registra lo que se midió el día que se midió,
  con su salida literal. Reescribirles los nombres falsificaría la medida. Lo mismo con
  `rentas/docs/00-gobierno/inventario-del-corte.md` (el inventario del monolito al cortar) y
  `P5A-copia-del-backend.md`, cuya tabla tiene `pe.gob.sgtm.*` en la columna «De».
- `rentas/docs/50-api/prototipo/sgtm-data-*.js` y los dos generadores que los leen — `SGTM_NAV` y
  `SGTM_SCREENS` **no son variables de entorno**: son los globales del prototipo capturado del
  Manual de Usuario del SGTM, un artefacto histórico. Lo que sí se renombró de esos generadores es
  la instrucción `-Dsgtm.respuestas.regenerar`, que es una propiedad viva.

### Lo que queda con `sgtm` y **no** lo cubre ninguna etapa — se declara aquí

4. **Los identificadores de los plugins de convención de Gradle** — `sgtm.java-base`,
   `sgtm.modulo`, `sgtm.calidad`, `sgtm.pruebas`, `sgtm.pruebas-postgres`: **89 usos** en los
   `build.gradle.kts` de los cuatro más 20 archivos en `buildSrc`. No son ni variable de entorno,
   ni prefijo de propiedad, ni rol, ni nombre de recurso, así que no entran en A, B, C ni D. El
   renombrado es mecánico y **no puede fallar en silencio** —un id que no case rompe la
   configuración de Gradle en voz alta—, y por eso se deja fuera en vez de colarlo: cabe en una
   etapa propia de un solo commit. Sus propiedades de sistema **ya** dicen
   `kamayuk.pruebas.postgres.*`.
5. **`spring.application.name: sgtm`** en los cuatro `application.yaml`. Es una **etiqueta de
   observabilidad** —`management.metrics.tags.application` la usa, y las alertas y tableros de
   `infra/observabilidad/` consultan por ella—, así que cambiarla es de la misma familia que los
   nombres de recurso de la etapa D. Se ve en el registro de la evidencia de abajo: el prefijo
   `[sgtm]` de cada línea de log sale de ahí.
6. **El realm de Keycloak `sgtm` y `sgtm-ciudadano`**, y con ellos `realm-sgtm.json`,
   `realm-sgtm-ciudadano.json` y el `emisor` que los nombra. Renombrar un realm es un cambio de
   estado desplegado —invalida los tokens vivos y hay que reconciliar identidades—, no un
   renombrado de código.
7. **Los dominios de ejemplo** `sgtm.example.pe`, `sgtm.local` y `sgtm.invalido`, que son nombres
   DNS de pruebas y de correo.

---

## 5 · La evidencia: los cuatro levantados de verdad, y la implantación **escribiendo**

Contra el demonio Docker del VPS `vmd205066` (contexto `vps`), con los archivos que los composes
montan copiados **al mismo camino absoluto** que el cliente resuelve, y sin tocar ninguno de los
contenedores que ya corrían allí (`sgtm-*`, `observatorio-*`, `qgis-*`, `kamayuk-verificador`).
Puertos propios para no quitarle ninguno a nadie: base 15432, ingreso 18080, identidad 18180,
correo 18025.

### La plataforma, con sus cuatro bases y sólo las extensiones que cada una declara

```
 caja | catastro | normativa | rentas       (sgtm_owner=c, sgtm_app=c, sgtm_readonly=c)

rentas:    pg_trgm, plpgsql, unaccent
catastro:  btree_gist, plpgsql, postgis, unaccent
normativa: plpgsql
caja:      plpgsql

rol_carga_parametros|t   rol_ingestor_catastro|f
sgtm_app|t   sgtm_owner|t   sgtm_readonly|f
```

Que los roles tengan `LOGIN` es lo que dice que `20-asignar-claves.sh` —renombrado a
`KAMAYUK_CLAVE_*`— leyó su `.env` renombrado. Si no lo hubiera hecho, el motor arrancaría igual y
el fallo aparecería después, en el migrador.

### Los doce contenedores, y la fila que C-18 tuvo que ir a buscar

```
kamayuk-plataforma-base-1          Up 45 minutes (healthy)
kamayuk-plataforma-correo-1        Up 45 minutes (healthy)
kamayuk-plataforma-identidad-1     Up 45 minutes
kamayuk-plataforma-ingreso-1       Up 45 minutes (healthy)
kamayuk-rentas-rentas-1            Up (healthy)      kamayuk-rentas-rentas-{migraciones,implantacion}-1     Exited (0)
kamayuk-catastro-catastro-1        Up (healthy)      kamayuk-catastro-catastro-{migraciones,implantacion}-1 Exited (0)
kamayuk-normativa-normativa-1      Up (healthy)      kamayuk-normativa-normativa-{…}-1                      Exited (0)
kamayuk-caja-caja-1                Up (healthy)      kamayuk-caja-caja-{…}-1                                Exited (0)
```

**Y la tabla, que es el criterio:**

```
rentas     flyway=13  municipalidad=1 | 200101 | Municipalidad Provincial de Sullana | demo=true  accesos=134
catastro   flyway=5   municipalidad=1 | 200101 | Municipalidad Provincial de Sullana             accesos=11
normativa  flyway=1   municipalidad=1 | 200101 | Municipalidad Provincial de Sullana             accesos=1
caja       flyway=2   municipalidad=1 | 200101 | Municipalidad Provincial de Sullana             accesos=3

rentas ademas: usuarios=1, grupos = «Administracion del sistema» | «Seguridad»
```

Y el registro de la implantación de `rentas`, que es la línea que C-18 no consiguió:

```
Municipalidad 200101 lista (DEMOSTRACION): id 1, 134 accesos nuevos, administrador 'jperez',
134 permisos al grupo 'Administracion del sistema', 11 al grupo 'Seguridad'
```

Las cuatro sondas, medidas **desde dentro** del contenedor:

```
rentas     {"groups":["liveness","readiness"],"status":"UP"} <- 200
catastro   {"groups":["liveness","readiness"],"status":"UP"} <- 200
normativa  {"groups":["liveness","readiness"],"status":"UP"} <- 200
caja       {"groups":["liveness","readiness"],"status":"UP"} <- 200
```

Y por el ingreso, cada prefijo a su dueño:

```
/rentas/api/v1/nada    -> 401     /normativa/api/v1/nada -> 401
/catastro/api/v1/nada  -> 401     /caja/api/v1/nada      -> 401
/inventado/api/v1/nada -> 404     (Traefik: nadie reclama ese prefijo)
```


`healthy` es el `healthcheck` del compose contestando `200` a `/actuator/health` desde dentro del
contenedor. **Pero el criterio de este entregable no es ése**: es la tabla. Un `Exited (0)` es
exactamente lo que el Job roto de `rentas` daba desde C-14.

---

## 6 · Las cifras, antes y después

| Qué | Antes | Después |
|---|---|---|
| `infrastructure` — `yarn verificar` | 631 | **635** (+4: la guarda del `ENTRYPOINT`, una por sistema) |
| descriptores `rentas · catastro · normativa · caja` | 15 · 13 · 13 · 14 | **15 · 13 · 13 · 14** |
| backends `rentas · catastro · normativa · caja` | 3144 · 993 · 619 · 689 | **3144 · 993 · 619 · 689**, 0 fallos |
| `generar-openapi.mjs --comprobar` (rentas) | 228 operaciones en 205 rutas | **igual** |
| `yarn manifiestos --ambiente stg` — nombres de recurso | 94 | **94** |
| `yarn manifiestos --ambiente stg` — nombres de variable | 92 | **84** |

**Los nombres de recurso no cambian, con una excepción medida y correcta**: el `Job` de
reconciliación de identidad se llama `sgtm-stg-realm-<huella>`, y la huella pasa de `ff8106e2b6` a
`45e73de234`. No es un renombrado: es el **contenido** de lo que ese Job aplica —
`reconciliar-identidades.sh` ahora lee `KAMAYUK_*`—, y que la huella cambie es lo que ese
mecanismo existe para conseguir. Un Job con el mismo nombre **no volvería a correr**, y el guion
nuevo no llegaría nunca al clúster. El nombre base, `sgtm-stg-realm`, es etapa D y sigue igual.

---

## Huecos declarados

1. **Los dos `COMMENT ON COLUMN` del baseline de `rentas` siguen citando `pe.gob.sgtm.…`**, y no
   se pueden corregir aquí: `V1__baseline.sql` está aplicado en `stg`, en `prod` y en cada compose
   que se levanta, y editarlo cambia su suma de Flyway. El remedio es una migración nueva que
   vuelva a emitir los dos comentarios — y eso no cabe en un renombrado, porque cambiaría también
   lo que `verificar-baselines.sh` compara contra el esquema del monolito.
2. **Los identificadores de plugin de Gradle** (`sgtm.modulo` y sus cuatro hermanos, 89 usos)
   quedan sin renombrar, con su motivo en §4.4.
3. **`spring.application.name` sigue siendo `sgtm`** en los cuatro, con su motivo en §4.5. Se ve en
   el registro: cada línea sale con el prefijo `[sgtm]`.
4. **Nada de esto se ha desplegado.** Lo medido es el compose y los manifiestos generados; no se
   corrió ningún `pulumi up` ni se tocó ningún clúster. El primer despliegue que lleve esto
   **tiene que llevar las tres mitades juntas** —imagen, descriptor y secretos—, porque un
   `Deployment` con las variables nuevas contra una imagen vieja es el fallo mudo de C-18 otra vez,
   ahora en la dirección contraria.
5. **`verificar-baselines.sh` de `rentas` no se puede ejecutar** desde su propio clon: pide
   `rentas/backend/sgtm-esquema/`, que no existe ahí desde la separación. No lo introdujo este
   trabajo y no lo arregla; se anota porque salió al decidir el hueco 1.
6. **`infrastructure/CLAUDE.md` dice que `despliegue/compose.yaml` «es el que usa CI», y ningún
   flujo lo nombra.** Ese compose —el del monolito— sí se renombró, porque comparte el `.env` con
   el de la plataforma y dejarlo a medias habría roto el `.env` para los dos. Pero su contexto de
   construcción (`..` y `../frontend`) no tiene ni el backend ni las fuentes del frontend en este
   repositorio, así que **no puede construir**. Tampoco lo introdujo este trabajo.
