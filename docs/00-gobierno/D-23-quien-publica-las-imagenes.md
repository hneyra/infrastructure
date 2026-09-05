# D-23 — quién publica las imágenes, y con qué etiqueta

**Estado:** aplicado. Las **ocho** imágenes de los cuatro sistemas existen en `ghcr.io/hneyra`
con la etiqueta exacta que `yarn manifiestos --ambiente stg` pide, comprobado contra el registro.
**No se ejecutó ningún `pulumi up`.** §6 dice qué queda.

Cierra el hueco 1 de [C-14 §6](C-14-que-se-pueda-desplegar.md) y el paso 2 de
[D §6](D-el-renombrado-desplegado.md).

---

## 1 · El defecto, medido antes de tocar nada

Dos cosas, y la segunda no la nombraba ningún issue.

**(a) Nadie publicaba nada.** `publicar-imagenes.yml` se quedó en `sgtm` —el archivo histórico— y
nunca se trasladó. Lo que los cinco repositorios tienen se llama `registro.yml` y es otra cosa: la
guarda de #711 sobre la tabla de `CLAUDE.md`. Medido con `rg 'build-push-action'`: **0** en los
cinco.

**(b) Y la etiqueta que el manifiesto pedía no podía existir.** `entorno.imagenDe()` etiquetaba
**las ocho** con `applicationBootstrapVersion`, que es un `sha` de `sgtm` — una revisión que no
describe el código de `catastro` y que ni siquiera está en su clon. Preguntado al registro el
2026-09-05, con un token emitido por `https://ghcr.io/token`:

```
GET /v2/hneyra/kamayuk-rentas/manifests/c755de21…            -> 404 MANIFEST_UNKNOWN
GET /v2/hneyra/kamayuk-rentas-migrador/manifests/c755de21…   -> 404 MANIFEST_UNKNOWN
…y lo mismo las otras seis.
```

**Lo caro no es que faltaran: es que nada lo medía.** Un `pulumi up` con una etiqueta inexistente
**no falla**. El manifiesto es válido, `kubectl apply --dry-run=server` lo admite, `yarn capacidad`
dice que cabe y el planificador ubica el pod. El síntoma llega después, como `ImagePullBackOff`,
con el `up` en verde.

---

## 2 · La decisión: una versión por sistema, declarada en el stack

`kamayuk:versionDeRentas`, `versionDeCatastro`, `versionDeNormativa`, `versionDeCaja`. Y
`applicationBootstrapVersion` **se queda**, siendo lo que siempre fue: la versión del monolito, un
`sha` de `sgtm`.

**Por qué, y no otra cosa:**

1. **Una etiqueta es una revisión del repositorio que construyó la imagen.** Es lo único que
   permite contestar «qué está corriendo en la municipalidad» y volver de ahí al código. Un `sha`
   de `sgtm` dentro de `kamayuk-catastro:` no resuelve contra ningún `git log` de `catastro`.
2. **Lo pide el propio código, con estas palabras.** El error de `unicoSistemaDesplegado`
   (`verificaciones/deriva-de-migraciones.ts`) dice desde C-19: «una sola línea sólo puede fechar
   un `git log`: con varios sistemas hay que declarar una versión POR SISTEMA […] Remedio: dar a
   `config.ts` una versión por sistema». Esto es ese remedio.
3. **Tiene que ser por stack, no un archivo del repositorio.** `stg` y `prod` deben poder correr
   versiones distintas — promover es exactamente eso.
4. **Y la pone `infrastructure`, no el descriptor.** `imagenDe()` sigue componiéndola aquí, que es
   la prohibición (b) de `descriptor/auditoria.ts` y ADR-0011 §5: si la etiqueta entra en el
   descriptor entra en el estado de Pulumi, y entonces cada liberación vuelve a ser un `pulumi up`.

### 2.1 · Cuatro claves y no un mapa

`verificaciones/stacks.ts` entiende exactamente la forma que Pulumi lee de estos archivos: una
línea `kamayuk:clave: valor`, sin estructuras anidadas. Un mapa obligaría a meter JSON en una línea
y a **suponer** que `getObject` de Pulumi y ese lector mínimo lo interpretan igual — una suposición
que nadie ha medido, en el camino que decide qué imagen baja el nodo.

Lo que un mapa daba gratis —que un sistema nuevo no se pueda olvidar— lo da la lista
`SISTEMAS_CON_IMAGEN` más la prueba que la ata a `descriptor/sistemas.ts`: un quinto sistema que se
componga sin su clave pone esa prueba roja **nombrándolo**, en vez de heredar en silencio la
etiqueta de otro.

### 2.2 · Lo que arrastra, y que no es cosmético

El `Job` de migración lleva la versión **en el nombre** (`nombreConVersion`), así que ahora lleva la
de **su** sistema. Con la versión compartida, publicar una migración de `rentas` no creaba ningún
`Job` nuevo para `rentas` y sí lo creaba para los otros tres, que no habían cambiado.

---

## 3 · Los cuatro flujos, y por qué sin filtro `paths`

`publicar-imagenes.yml` en cada uno de los cuatro: matriz de dos —`aplicacion` y `migrador` del
mismo `backend/Dockerfile`—, etiqueta `${{ github.sha }}`, nunca `latest`.

**Sin filtro `paths`, al revés que el flujo del monolito.** El motivo es una equivalencia que la
guarda necesita: *todo commit de `main` tiene sus dos imágenes*. Con un filtro, un merge de sólo
documentación deja un `sha` de `main` **sin** imágenes, y entonces «está en la historia de main»
—lo único que se puede saber sin hablar con el registro— deja de implicar «se puede desplegar», en
silencio. Lo que costaría es justo el caso que el filtro venía a abaratar, y ahí la caché de capas
lo cubre.

**Y cada flujo termina preguntándole al registro.** Un `build-push-action` en verde dice que el
`push` no devolvió error; que la etiqueta se pueda **pedir** es otra afirmación, y es la que decide
si el pod arranca.

---

## 4 · La guarda, en dos mitades que no se sustituyen

| Mitad | Qué contesta | Dónde | Necesita |
|---|---|---|---|
| `verificaciones/imagenes-publicadas.ts` | **¿hay alguien que publique esa imagen?** | `yarn verificar`, en cada PR | los clones hermanos |
| `verificaciones/imagenes/comprobar-imagenes.sh` | **¿esa etiqueta se puede pedir?** | `yarn imagenes`, el trabajo `imagenes` de `infra.yml` y un paso **antes de cada `pulumi up`** | red y credencial |

La primera **deriva** el inventario de publicadores leyendo los flujos de los cinco clones y
expandiendo su matriz — no una lista escrita a mano, que sería el segundo sitio donde olvidarse.
Analiza el YAML en vez de buscar el nombre con `grep`, y sólo cuenta pasos con `push: true`:
construir una imagen y no subirla no la publica.

La segunda distingue **tres** desenlaces, y el tercero es el que engaña:

```
200  existe.
404  MANIFEST_UNKNOWN: no existe.
403  DENIED: la credencial no puede leer ese paquete — NO permite concluir nada.
```

Medido el mismo día: un PAT de escritorio sin `read:packages` recibe **403** de los paquetes
`sgtm-*` y **404** de los `kamayuk-*`. Leer los dos como «no existe» habría dado un diagnóstico
equivocado sobre el monolito. Sin credencial el guion sale con código 3 diciendo que no pudo
comprobar nada: **no pasa en verde**.

**Y esa distincion se cobro la primera corrida del trabajo en CI, que es donde mejor se ve.** La
`33985637872` salio roja con las ocho del corte en `200` y las **tres del monolito en `403`**: un
`GITHUB_TOKEN` sólo alcanza los paquetes ligados a **su** repositorio, y los tres de `sgtm` no lo
están al de `infrastructure`. Leer ese 403 como «no existe» habría acusado al monolito de no tener
imágenes cuando sí las tiene. Se pasa a preguntar con `REGISTRY_PULL_TOKEN` —el PAT con
`read:packages` que **el nodo** usa para traérselas (issue #257)—, con lo que la pregunta deja de
ser «¿existe?» y pasa a ser «¿la puede bajar quien va a bajarla?», que es la que decide si el pod
arranca.

### 4.1 · Las roturas, y lo que dijo cada una

| Rotura | Rojo |
|---|---|
| `versionDeCaja` apuntando a `fe1d73d0…`, un `sha` **de `main`** anterior al flujo | `NO EXISTE ghcr.io/hneyra/kamayuk-caja-migrador:fe1d73d0…` y su gemela, con el remedio. **Es la que demuestra que las dos mitades no se sustituyen**: ese `sha` está en la historia de `main`, así que la mitad de arriba lo daría por bueno |
| Quitar `publicar-imagenes.yml` de `caja` | **3 en rojo**: los dos ambientes —«NINGUN flujo de los clones hermanos publica «kamayuk-caja»… ImagePullBackOff»— y la que exige que `caja` tenga su flujo |
| `versionDeNormativa: v2` | `checkInvariants` rojo: «no es un `sha` de cuarenta caracteres hexadecimales» |
| Borrar la línea `versionDeCatastro` | `MissingConfigError` **nombrando la clave y para qué sirve**, con `pulumi config set versionDeCatastro <valor>` |
| `push: false` en el flujo de muestra | La imagen deja de contarse como publicada — es la forma exacta en que esta guarda dejaría de mirar sin decirlo |
| Una imagen sin publicador **pero con su publicador en el inventario** (el contraste) | Verde. Sin él, una guarda que dijera «no publica nadie» siempre pasaría la prueba de arriba |

---

## 5 · Dos hallazgos que este trabajo no iba buscando

### 5.1 · Los cuatro paquetes nuevos son **públicos**

Medido sin credencial ninguna:

```
GET /v2/hneyra/kamayuk-rentas/manifests/ddcaf782…   (token anónimo)  -> 200
GET /v2/hneyra/sgtm-aplicacion/manifests/c755de21…  (ídem)           -> 403 DENIED
```

Los tres del monolito son privados; los cuatro del corte, no. Cualquiera puede
`docker pull ghcr.io/hneyra/kamayuk-rentas:<sha>` y leer el `jar` del backend del padrón.

**No se cambia aquí**, y por dos motivos: hacerlo exige `write:packages` sobre el paquete, que la
credencial de esta sesión no tiene; y hacerlo **rompería el despliegue** por lo que dice el punto
siguiente. Es una decisión con dos actos y hay que darlos juntos.

### 5.2 · Y ningún pod de los cuatro declara `imagePullSecrets`

Medido sobre el manifiesto: las **14** cargas de los cuatro sistemas —cuatro `Deployment`, ocho
`Job`, dos `CronJob`— traen su imagen de `ghcr.io/hneyra` **sin** credencial de registro. Hoy
funciona porque los paquetes son públicos. El día que se hagan privados, los catorce quedan en
`ImagePullBackOff`.

**Y «sin credencial» no es «su `spec` no declara `imagePullSecrets`».** Creerlo daba un falso
positivo sobre el monolito, y CI lo enseñó: la credencial de `ghcr.io` no vive en ningún pod.
`index.ts` crea el `Secret` `<amb>-registro-credenciales` y **parchea el `ServiceAccount`
`default`** del espacio de nombres de la plataforma, de donde la heredan todos sus pods —ninguno
declara `serviceAccountName`— (issue #257). Comprobado contra `prod`:

```
$ kubectl -n sgtm-prod get sa default -o jsonpath='{.imagePullSecrets}'
[{"name":"sgtm-prod-registro-credenciales"}]
```

Así que el monolito **sí** puede traerse sus tres imágenes privadas. Lo que no puede es ninguno de
los cuatro sistemas: desde ADR-0031 cada uno vive en **su** espacio de nombres, y ni el `Secret` ni
el parche llegan allí. Esa exención está atada al código —`espaciosConCredencialDeRegistro()` lee
`index.ts`— y no escrita a mano: apuntar el parche a `kamayuk-rentas-stg` pone la prueba roja
(«expected `['"kamayuk-rentas-stg"']` to deeply equal `['namespace']`»).

Las dos cosas juntas son una sola condición, y el guion la mide y la dice en cada línea:

```
OK  ghcr.io/hneyra/kamayuk-rentas:ddcaf782…  [publica, sin-credencial]
```

y **falla** cuando una imagen es privada y algún pod que la trae no declara credencial, que es
exactamente cuando el `up` fallaría. Cerrarlo del todo es: replicar el `Secret` de tipo
`dockerconfigjson` en los cuatro espacios de nombres y referenciarlo desde cada pod, y sólo
entonces cambiar la visibilidad de los cuatro paquetes.

---

## 6 · Lo que falta, y lo que este trabajo NO hizo

1. **La línea no la escribe nadie automáticamente.** `declarar-version.yml` (#720) sube
   `applicationBootstrapVersion` al terminar `publicar-imagenes.yml` **del mismo repositorio**, y
   `declarar.ts` supone además **un** sistema desplegado (`unicoSistemaDesplegado` lanza con más de
   uno). Automatizar esto son dos cosas nuevas: un disparo entre repositorios y una deriva por
   sistema. No se hizo — pero olvidarse ya no es silencioso: `yarn imagenes` lo dice antes del `up`.
2. **La deriva de migraciones sigue midiendo sólo el monolito.** `sistemasDesplegados` compone con
   `construirManifiestos` —la plataforma— así que ve `sgtm` en `prod` y nada en `stg`: los cuatro
   `Job` de migración del corte **no los mide nadie**. Es el mismo hueco de #675 con otro sujeto.
3. **La visibilidad de los paquetes y los `imagePullSecrets`** (§5), que van juntos.
4. **No se ejecutó `pulumi up`.** Los pasos que faltan siguen siendo los de
   [D §6](D-el-renombrado-desplegado.md), con el 2 ya cerrado y el 3 también (§7).

---

## 7 · El `ALTER ROLE` de la etapa C, aplicado a los dos motores

C dejó los cinco roles renombrados en el código y `H-2` como el acto pendiente. Se ejecutó el
2026-09-05, **antes de cualquier `up`**, contra los dos motores.

Lo primero fue medir lo que C avisó que había que medir —`RENAME` **borra** una contraseña `md5`—:

```
SHOW password_encryption;  ->  scram-sha-256   (los dos motores)
rolpassword de los cinco   ->  SCRA…           (o «sin clave», en kamayuk_readonly)
```

Ninguna en `md5`, así que ninguna se pierde. Y no se dio por bueno el catálogo: después del
renombrado se abrió una sesión **con la contraseña anterior**, tomada del `Secret` del ambiente:

```
psql -U kamayuk_app -d sgtm -c "select 'autentica como '||current_user"  ->  autentica como kamayuk_app
```

| | `stg` | `prod` |
|---|---:|---:|
| OID de los cinco roles | sin mover | sin mover |
| privilegios de tabla de la aplicación | 295 → **295** | 289 → **289** |
| los mismos a nombre de `sgtm_app` | → **0** | → **0** |
| políticas de RLS que nombran al rol | 2 → **2** | 2 → **2** |
| pertenencias (`pg_monitor`, `pg_read_all_settings`) | 5 → **5** | 5 → **5** |

`prod` estaba **entero a cero** y su motor apagado: se escaló `postgres` a 1 réplica, se ejecutaron
las cinco sentencias en una transacción, y se devolvió a 0. Comprobado después: los nueve
`Deployment` con `replicas: 0` y **ningún pod en `Running`** en `sgtm-prod`.

### 7.1 · Lo que cuesta, dicho

En `stg` el `postgres-exporter` es un *sidecar* que se conecta como `sgtm_monitor` y **su
`Deployment` todavía dice eso**, porque lo cambia el `pulumi up`. Desde el renombrado repite:

```
level=error msg="Error opening connection to database"
  err="… pq: role \"sgtm_monitor\" does not exist"
```

O sea: `stg` está **sin métricas de PostgreSQL** hasta el `up`. Es el precio del orden que C fijó y
que no es negociable —`asignar-claves.sh` y `bootstrap-secretos.sh` ya piden `kamayuk_*` y contra un
motor sin renombrar fallan con «role "kamayuk_app" does not exist»—, y se anota aquí en vez de
descubrirse. No afecta a `prod`, que está a cero.
