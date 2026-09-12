# Runbook — La migración falló a mitad

| Campo | Valor |
|---|---|
| Cuándo | Un `Job` de migración o de implantación quedó en `Failed`, o terminó en `Complete` **sin haber hecho su trabajo** — que desde ADR-0039 es un modo de fallo distinto y más caro |
| Alerta relacionada | `JobDeMigracionFallido` (`infra/observabilidad/alertas.yml:43`). **Sólo cubre la migración**: su expresión filtra `job_name=~".*migracion.*"`, así que una implantación fallida no la dispara. Medido el 2026-09-12 |
| Qué cubre | Los **diez** `Job` del ambiente: cinco de migración y cinco de implantación. El `CronJob` del consumidor de cada satélite se menciona porque es lo que repara una copia local, pero su avería es otro documento |
| Estado del ensayo | **El caso real está ensayado**: el 2026-09-11 el estreno del nodo nuevo de `prod` dejó tres implantaciones en `Failed` y una en `Complete` sin trabajo hecho, y se salió de ahí con el procedimiento del paso 5. Lo inocuo se reejecutó entero el 2026-09-12 contra `prod` (`vmd206041`). **Lo destructivo —borrar un `Job`, limpiar `flyway_schema_history`— no se reensayó aquí** — ver «Estado del ensayo» |

> **Este documento vivía en el repositorio archivo `sgtm` y sus comandos estaban
> pre-renombrado** (`kubectl -n sgtm-<amb>`, `sgtm_owner`, base `sgtm`, un solo `Job`
> llamado `sgtm-<amb>-migracion-<sufijo>`). Copiados al pie de la letra fallaban con
> `namespaces "sgtm-prod" not found`, y el que no fallaba —`kubectl get jobs -l
> app.kubernetes.io/component=migracion`— es peor: devuelve **`No resources found`** sin
> ningún error, o sea que quien lo sigue concluye que no hay ningún `Job` de migración en
> un ambiente que tiene cinco. Se trajo y se remidió entero
> ([#100](https://github.com/hneyra/infrastructure/issues/100),
> [#108](https://github.com/hneyra/infrastructure/issues/108)).

## Síntoma

Cualquiera de estos tres, y **no son el mismo problema**:

1. Un `Job` en `Failed` y la aplicación de ese sistema sin pasar a `Ready`.
2. Un `Job` en `Complete` y, aun así, **nadie puede entrar** a ese sistema, o su copia
   local de la autorización no avanza. Es el caso que la §«Cómo se comprueba» existe para
   cazar, y el que más tarda en descubrirse.
3. `pulumi up` que no converge y deja el ambiente a medias. Ahí el primer comando no es
   `kubectl` suelto sino el diagnóstico de los cinco espacios de nombres (paso 1).

## Lo que cambia el procedimiento entero: hoy hay DIEZ `Job`, y el nombre lleva el `sha`

Cuando este runbook se escribió había **uno**. Medido el 2026-09-12 en `prod`
(`kubectl get jobs -A -l proyecto=kamayuk,ambiente=prod`):

| Sistema | Espacio de nombres | Migración (duración) | Implantación (duración) |
|---|---|---|---|
| `identidad` | `kamayuk-identidad-prod` | `kamayuk-identidad-migracion-226ec6ffdc62` (9 s) | `kamayuk-identidad-implantacion-226ec6ffdc62` (17 s) |
| `rentas` | `kamayuk-rentas-prod` | `kamayuk-rentas-migracion-66ebe547a3ee` (70 s) | `kamayuk-rentas-implantacion-66ebe547a3ee` (42 s) |
| `catastro` | `kamayuk-catastro-prod` | `kamayuk-catastro-migracion-ac1239a26fd5` (69 s) | `kamayuk-catastro-implantacion-ac1239a26fd5` (40 s) |
| `normativa` | `kamayuk-normativa-prod` | `kamayuk-normativa-migracion-e1cdad5a3e4f` (44 s) | `kamayuk-normativa-implantacion-e1cdad5a3e4f` (17 s) |
| `caja` | `kamayuk-caja-prod` | `kamayuk-caja-migracion-0772e2515a68` (68 s) | `kamayuk-caja-implantacion-0772e2515a68` (38 s) |

Tres consecuencias, y ninguna es cosmética:

**1 · Los cinco `sha` son DISTINTOS.** Cada sistema declara el suyo en
`kamayuk:versionDe<Sistema>` ([`infra/Pulumi.prod.yaml`](../../../infra/Pulumi.prod.yaml)),
y el sufijo son sus **doce primeros caracteres**
([`sufijoDeVersion()`](../../../infra/componentes/convenciones.ts), llamado desde
[`descriptor/entorno.ts`](../../../infra/descriptor/entorno.ts) — **no desde
`componentes/Migracion.ts`, que se fue con el monolito**). Así que no hay «el `Job` de
migración»: hay el de *ese* sistema, en *su* espacio de nombres.

**2 · Una versión nueva NO modifica un `Job`: crea otro.** Un `Job` de Kubernetes es
inmutable, y por eso la versión va en el nombre. De ahí salen las dos mitades de este
runbook: mientras el `Job` viejo exista, `pulumi up` intenta **actualizarlo** y falla —así
que un `Job` que agotó su `backoffLimit` **no se arregla solo ni con otro `up`**—; y un
`Job` borrado se **recrea** en el siguiente `up` con el mismo nombre, porque el nombre
depende de la versión declarada y no de cuándo se aplicó.

**3 · Los diez se borran solos a las 24 horas.** `ttlSecondsAfterFinished: 86400` en los
diez, medido. El `Job`, sus pods y **los registros de esos pods** desaparecen: un fallo de
anoche puede no tener ya nada que leer esta mañana. Si hay que diagnosticar, lo primero es
volcar los registros a un archivo, antes que ninguna otra cosa.

### Cuántos reintentos aguanta cada uno, y por qué no son iguales

| `Job` | `backoffLimit` | Ventana de reintentos |
|---|---|---|
| Migración, los cinco | **3** | ~70 s |
| Implantación de los cuatro satélites | **6** | ~630 s |
| Implantación de `identidad` | **3** | ~70 s |

La ventana la calcula
[`ventanaDeReintentos()`](../../../infra/verificaciones/orden-de-implantacion.ts) con el
retroceso exponencial de Kubernetes (10 s, 20 s, 40 s… con tope de 360 s), y es una cota
**optimista**: no cuenta lo que tarda el pod en arrancar.

La asimetría **no es un descuido**: desde la etapa 5 de ADR-0039 la implantación de un
satélite depende de que `identidad` ya esté implantada
([el orden](../../00-gobierno/identidad-5-el-orden-de-implantacion.md)), así que sus
reintentos son la espera; la de `identidad` no espera a nadie. Se subió de 3 a 6 en los
cuatro el 2026-09-11, y esa es la razón de que hoy el `Job` de `rentas` figure como
`Complete` con **un fallo dentro**: su primer pod arrancó en el mismo segundo que la
implantación de `identidad` y murió con
`IdentidadNoContesta: No se pudo leer el buzon de identidad`; el reintento, 25 s después,
pasó. Medido leyendo los dos pods.

## Por qué la aplicación no arranca sola — y qué es falso de esa frase hoy

**No hay ningún pod de espera.** El runbook del archivo hablaba de `espera-migracion` y
`espera-implantacion`, contenedores de inicialización del `Deployment` de la aplicación.
Medido el 2026-09-12: los `Deployment` de los cinco sistemas tienen la lista de
`initContainers` **vacía**. Lo que hay es distinto y más fuerte:

| Quién | Qué lleva delante | Qué garantiza |
|---|---|---|
| `Job` de **migración** | `espera-al-motor` | que no empiece antes de que PostgreSQL conteste ([`espera-al-motor.ts`](../../../infra/componentes/espera-al-motor.ts)) |
| `Job` de **implantación** | `espera-al-motor` **y `migrador`** | que cuando el contenedor de implantación arranque **el esquema ESTÉ**: corre el migrador otra vez, que es idempotente. Si la migración aún no terminó, Flyway toma su candado y uno de los dos espera al otro |
| `Deployment` de la aplicación | nada | su disponibilidad la decide `/actuator/health/readiness` |

O sea que la implantación **no supone** que la migración terminó: la vuelve a ejecutar. Y
la aplicación no espera a nadie: si el esquema no está, no pasa a `Ready` y quien lo dice
es la sonda, no un pod de espera.

## Precondiciones

1. **Acceso `kubectl` al ambiente**, y a los **cinco** espacios de nombres. Desde fuera del
   nodo, por el túnel SSH al API.
2. **No reintentar a ciegas.** Un `Job` es idempotente —el migrador aplica sólo lo que
   falta y devuelve cero si no falta nada—, pero reintentar sin saber por qué falló es
   gastar la ventana de reintentos en el mismo error. Primero el paso 2.
3. **Volcar los registros antes de tocar nada** (el TTL de 24 h de arriba).

## Pasos

### 1. Qué quedó a medias, en los cinco espacios de nombres a la vez

El mismo guion que `aplicar-stg` y `aplicar-prod` invocan cuando su `pulumi up` falla
([`.github/diagnostico-del-namespace.sh`](../../../.github/diagnostico-del-namespace.sh)).
Descubre los espacios de nombres **preguntándole al clúster** por las etiquetas, así que no
se queda atrás cuando entra un sistema:

```bash
.github/diagnostico-del-namespace.sh --ambiente <amb>
```

Vuelca pods, `Deployment`, `Job`, `CronJob`, volúmenes y **los últimos 60 eventos** de cada
uno — que es donde aparece un `Insufficient cpu` o un `container has runAsNonRoot and image
will run as root`, dos causas que no se ven en los registros del proceso porque el
contenedor **nunca llegó a crearse**. Ejecutado el 2026-09-12 contra `prod`: los seis
espacios de nombres (`kamayuk-prod` más los cinco de los sistemas).

Los diez `Job`, sin el guion:

```bash
kubectl get jobs -A -l proyecto=kamayuk,ambiente=<amb> | grep -E 'migracion|implantacion'
```

**Las etiquetas son `proyecto`, `ambiente`, `sistema` y `componente`, en español.** No hay
ninguna `app.kubernetes.io/*`: el selector del runbook del archivo devuelve
`No resources found`. Para un solo sistema, `-l proyecto=kamayuk,ambiente=<amb>,sistema=<sistema>`.

> **`componente` de `identidad` es `identidad-sistema`, no `identidad`.** En la plataforma
> `componente: identidad` es **Keycloak**. Filtrar por `componente=identidad` no devuelve
> los `Job` de este sistema: devuelve los del emisor.

### 2. Por qué falló: el pod, no el `Job`

```bash
kubectl -n kamayuk-<sistema>-<amb> describe job <nombre-del-job> | tail -30
kubectl -n kamayuk-<sistema>-<amb> logs -l job-name=<nombre-del-job> --prefix --tail=200
```

**`kubectl logs job/<nombre>` es una trampa cuando hubo reintentos.** Medido contra la
implantación de `rentas`, que tiene dos pods: contesta
`Found 2 pods, using pod/kamayuk-rentas-implantacion-66ebe547a3ee-t85fh` y enseña **uno
solo**, elegido por él. Con `-l job-name=…` salen todos, y `--prefix` dice de cuál es cada
línea — que es justo lo que hace falta cuando un intento falló y el siguiente pasó.

Y los contenedores de inicialización tienen sus propios registros, que es donde vive la
mitad de las causas:

```bash
kubectl -n kamayuk-<sistema>-<amb> logs <pod> -c espera-al-motor
kubectl -n kamayuk-<sistema>-<amb> logs <pod> -c migrador      # sólo en la implantación
```

### 3. Las causas, distinguibles por el mensaje

| Mensaje | Causa | Qué hacer |
|---|---|---|
| `Detected resolved migration not applied to database: N` | Dos ramas cogieron número antes de mezclarse | **Ya no detiene nada**: el migrador corre con `outOfOrder(true)` y la aplica en su sitio. Lo que difiere entre instalaciones es el `installed_rank`, no el esquema |
| `Checksum mismatch for migration` | Alguien editó un `V*.sql` **ya aplicado** | **Nunca** editar una migración aplicada. Corregir con una `V` nueva. Flyway valida la suma en cada arranque, así que esto rompe **toda base existente**, no sólo la del despliegue |
| `Faltan roles que las politicas de V6__rls.sql nombran: …` | La base es nueva y `crear-roles.sql` no corrió antes | Los roles son **del clúster**, y una migración no puede crearlos. Se crean al provisionar el motor, con el superusuario. Los exigidos son `kamayuk_owner`, `kamayuk_app`, `kamayuk_readonly` y `rol_carga_parametros` |
| `El rol kamayuk_owner tiene privilegios que el modelo de ARQ-03 §4 excluye [SUPERUSER]` / `[BYPASSRLS]` | El migrador se conecta con una credencial de más | El esquema tiene que crearlo un `kamayuk_owner` **sin** ellos: es sobre esos objetos que la prueba de aislamiento demuestra lo que demuestra. Medido el 2026-09-12 en `prod`: los siete roles del clúster tienen `rolsuper` y `rolbypassrls` en `f` |
| `database "<sistema>" does not exist` | El volumen del motor **ya existía** cuando entró un sistema nuevo | Los guiones de `/docker-entrypoint-initdb.d/` sólo corren con el directorio de datos vacío. Crear la base y sus roles a mano, o recrear el volumen si el ambiente es desechable |
| `Connection refused` sin una sola sentencia ejecutada | Carrera con el motor: bajó y volvió a subir | Es lo que `espera-al-motor` existe para impedir. Si pasa, mirar **sus** registros: si ni siquiera se creó el contenedor, el evento del pod lo dice |
| `identidad contesto 403 al leer el buzon` / `No se pudo leer el buzon de identidad` | Es la **implantación** de un satélite, y el problema es el orden o la versión | Paso 4, y [el orden de implantación](../../00-gobierno/identidad-5-el-orden-de-implantacion.md) |
| Un error de sintaxis SQL o una restricción violada | Un defecto real de la migración | No es operación: es código. Paso 7 |

### 4. La causa que hay que descartar antes que ninguna: desfase de versiones

**El manifiesto sale de `main` del clon hermano y la imagen del `sha` clavado.** Los cinco
descriptores se importan del clon (`descriptor/sistemas.ts`), que se clona **sin `ref:`**;
la etiqueta de la imagen la pone `kamayuk:versionDe<Sistema>`. Un binario viejo corriendo
contra un manifiesto nuevo es un estado perfectamente posible, y **ninguna guarda lo veía**:
`deriva-de-migraciones` compara migraciones —y las dos versiones traían las mismas—, y
`imagenes-publicadas` sólo pregunta si la etiqueta existe en el registro.

Es lo que detuvo el estreno del nodo nuevo de `prod` el 2026-09-11
([#98](https://github.com/hneyra/infrastructure/pull/98)): `prod` clavaba `identidad` en la
**etapa 3** de ADR-0039 —donde el grupo «Consumidores del buzón» nace **sin miembros**— y
los cuatro satélites en la **etapa 4**, o sea **con** su consumidor. Los consumidores
existían y las cuentas que los autorizan no; **tres implantaciones murieron tras siete
intentos** con «`identidad` contestó 403 al leer el buzón». La comprobación quedó escrita en
[`la-version-clavada-afilia-a-los-consumidores.test.ts`](../../../infra/verificaciones/la-version-clavada-afilia-a-los-consumidores.test.ts).

Cómo se reconoce sin saber la historia — la imagen y el manifiesto se leen del mismo `Job`:

```bash
kubectl -n kamayuk-<sistema>-<amb> get job <nombre-del-job> \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
```

Y el binario dice su versión en la primera línea de su propio registro. Medido el
2026-09-12 en `prod`, los dos casos, uno al lado del otro:

```
kamayuk.identidad.KamayukAplicacion   : Starting KamayukAplicacion v0.1.0-SNAPSHOT …
kamayuk.normativa.SgtmAplicacion      : Starting SgtmAplicacion   v0.1.0-SNAPSHOT …
```

`SgtmAplicacion` se renombró a `KamayukAplicacion` en los cinco a la vez
([#76](https://github.com/hneyra/infrastructure/issues/76)). **Que la imagen desplegada aún
lo diga es la prueba de que ese binario es anterior al renombrado**, y el nombre de la clase
en el arranque de Spring Boot es la forma más barata de verlo.

### 5. Reintentar: borrar el `Job` y volver a aplicar

**Es lo que desatascó `prod` el 2026-09-11**, y es lo único que funciona: mientras el `Job`
exista con ese nombre, `pulumi up` intenta **actualizarlo** —y un `Job` es inmutable—, así
que sale en verde sin tocarlo o falla, pero no lo vuelve a correr.

```bash
kubectl -n kamayuk-<sistema>-<amb> logs -l job-name=<nombre-del-job> --prefix --tail=-1 \
  > /tmp/<nombre-del-job>.log            # 1. PRIMERO, porque borrar el Job borra los pods
kubectl -n kamayuk-<sistema>-<amb> delete job <nombre-del-job>
# 2. Y volver a aplicar: el flujo `Infraestructura`, trabajo `aplicar-<amb>`.
#    Recrea el Job con el MISMO nombre, porque el nombre depende de la version declarada.
kubectl -n kamayuk-<sistema>-<amb> wait --for=condition=complete job/<nombre-del-job> --timeout=600s
```

> **⚠ Borrar el `Job` NO deshace lo que ya escribió en la base.** Es un `Job`, no una
> transacción: lo aplicado sigue aplicado, y volver a correrlo **añade lo que falte sin
> quitar lo que sobre**.
>
> Está medido en `prod` hoy mismo. La primera implantación de `identidad` corrió con la
> versión atrasada y sembró el catálogo que esa versión traía —`rentas` con **134**
> opciones—. Con la versión corregida volvió a correr —con **otro** nombre, porque el
> sufijo es el `sha`— y registró
> `0 accesos nuevos de los 157 del catalogo unido`… y la tabla `acceso` sigue teniendo
> **161** filas (`rentas` 134, `catastro` 16, `identidad` 7, `caja` 3, `normativa` 1),
> porque **no hay `DELETE`**: un acceso no se borra, se revoca. `rentas` declara hoy 130 y
> su copia local no conoce `usuarios`, `grupos`, `miembros` ni `permisos`, así que los
> **cuatro** `PERMISO_FIJADO` que la primera pasada emitió sobre ellos **no se pueden
> aplicar nunca**: siguen pendientes desde el 2026-09-11 21:44. Medido el 2026-09-12:
> `rentas` con 4 pendientes, los otros tres con 0.
>
> Es exactamente el estado que el paso 4 existe para no producir: un reintento correcto
> **no repara** lo que un binario equivocado ya escribió.

### 6. Si Flyway dejó una fila con `success = false`

Una migración que falló a mitad deja su fila en `flyway_schema_history` con
`success = false`, y a partir de ahí **el arranque siguiente falla validando**: Flyway se
niega a aplicar nada más. Es deliberado.

Cómo se ve, contra cualquiera de las cinco bases —el motor es de la plataforma, así que el
espacio de nombres es `kamayuk-<amb>` y no el del sistema—:

```bash
kubectl -n kamayuk-<amb> exec deploy/kamayuk-<amb>-postgres -c postgres -- \
  psql -U kamayuk_owner -d <base> -c \
  "SELECT installed_rank, version, description, success, installed_on
     FROM flyway_schema_history WHERE NOT success ORDER BY installed_rank;"
```

Las bases son `identidad`, `rentas`, `catastro`, `normativa` y `caja`.
**`flyway_schema_history` no tiene RLS** —medido: `relrowsecurity` y `relforcerowsecurity`
en `f`—, así que esta consulta no necesita fijar el inquilino. Las tablas del producto sí
(§«Cómo se comprueba», punto 3).

Estado medido el 2026-09-12 en `prod`, que es el que tiene que verse: **ninguna fila con
`success = false` en las cinco**, y como última aplicada `identidad` V3 «acuses del buzon»,
`rentas` V18 «consumidor de identidad» (16 filas), `catastro` V14, `normativa` V2, `caja` V3.

**El migrador no tiene `repair`, y es a propósito.** Su punto de entrada **rechaza
cualquier argumento** —«El migrador no admite argumentos: la conexion sale de
KAMAYUK_DB_URL…»— y lo único que hace es `migrate()`. Así que la fila fallida se retira a
mano, **y con criterio**: hay que decidir antes si lo que esa migración alcanzó a aplicar se
completa o se deshace, porque borrar la fila sin mirar deja a Flyway creyendo que esa
versión nunca se intentó y volviéndola a aplicar **sobre un esquema que ya tiene la mitad**.
Eso no es un comando genérico, y por eso no hay uno escrito aquí.

### 7. Si la causa es un defecto de la migración

No es operación: es código. **La migración aplicada a medias no se deshace sola** —RNF-073
exige que toda migración sea reversible o aditiva—, así que la corrección es una `V` nueva
que arregle lo que quedó, nunca un `DROP` contra lo que el `Job` alcanzó a crear ni una
edición del archivo ya aplicado, que es el `Checksum mismatch` del paso 3.

Revertir la **aplicación** a la versión anterior es otro procedimiento, y su runbook
(`liberar-una-version-y-revertirla.md`) **sigue en el repositorio archivo `sgtm`,
pre-renombrado**: no se puede seguir al pie de la letra hasta que se traiga.

## Cómo se comprueba que terminó bien

**No basta con que el `Job` diga `Complete`.** Esto no es una precaución teórica: el
2026-09-11 la implantación de `normativa` terminó en `Complete`, con su pod en `Completed`,
y su propio registro decía —y sigue diciendo hoy, medido el 2026-09-12—:

```
WARN  k.n.s.aplicacion.ImplantarMunicipalidad : La implantacion termino, y la pasada del
consumidor de `identidad` NO: No se pudo pedir el token de servicio a «…». La copia local
de la autorizacion queda como la sembro esta implantacion hasta la siguiente vuelta del
consumidor
```

Ese binario degradaba el fallo a **WARN** y salía con código cero
([`normativa`#36](https://github.com/hneyra/normativa/issues/36)); en el código de hoy la
misma condición **lanza** y el `Job` queda `Failed`, que es lo correcto. Pero el binario
desplegado puede ser el viejo —paso 4—, y entonces el verde no significa nada. El mismo día,
la implantación de `rentas` terminó `Complete` y su última línea es un `ERROR`:
«LA COPIA LOCAL DE LA AUTORIZACION NO AVANZA: … quedan 4 evento(s) … que llevan más de 15
minuto(s) sin poder aplicarse».

Así que las cinco, contra el sistema real:

**1 · Ninguna migración quedó a medias.** La consulta del paso 6, en las cinco bases. Y la
última fila es la que se esperaba de esa versión.

**2 · El `Job` no sólo terminó: hizo su trabajo.** Se lee en su propia última línea, que es
distinta en cada sistema. Medidas el 2026-09-12:

```
k.i.n.aplicacion.ImplantarMunicipalidad : Municipalidad 200105 lista en identidad
(DEMOSTRACION): id 1, 0 accesos nuevos de los 157 del catalogo unido, 157 permisos
otorgados al grupo 'Administracion del sistema', administrador 'administrador',
4 cuentas de servicio afiliadas a 'Consumidores del buzon'
```

**Un `WARN` o un `ERROR` en un `Job` que salió en `Complete` es el hallazgo, no ruido.**

**3 · La copia local del sistema tiene cuentas.** Desde la etapa 5 de ADR-0039 el
administrador **no** se siembra en el satélite: llega por el buzón. Una base implantada sin
cuentas es una municipalidad donde nadie puede entrar, ni quien acaba de implantarla:

```bash
kubectl -n kamayuk-<amb> exec deploy/kamayuk-<amb>-postgres -c postgres -- \
  psql -U kamayuk_owner -d <base> -c \
  "SET app.municipalidad_id='<id>';
   SELECT (SELECT count(*) FROM usuario)  AS cuentas,
          (SELECT count(*) FROM grupo)    AS grupos,
          (SELECT count(*) FROM permiso)  AS permisos;"
```

**El `SET` va en la misma sesión que la consulta, y sin él esto no devuelve vacío: falla**
—`ERROR: unrecognized configuration parameter "app.municipalidad_id"`, medido—. Es la
segunda razón para no omitirlo: un error se ve, un vacío se confunde con «no hay filas». El
`<id>` es el de la fila de `municipalidad` en la base `identidad`, **no el ubigeo**; en
`prod` es `1` (ubigeo `200105`).

Medido el 2026-09-12 en los cuatro satélites: **5 cuentas y 2 grupos en los cuatro**, y
`permisos` **130** en `rentas`, **16** en `catastro`, **3** en `caja` y **1** en
`normativa` — que es el tamaño del catálogo de cada uno, no una cifra arbitraria.

**4 · El buzón de `identidad` no deja pendientes viejos.** Es lo que distingue «la copia va
con retraso» de «la copia no puede avanzar»:

```bash
kubectl -n kamayuk-<amb> exec deploy/kamayuk-<amb>-postgres -c postgres -- \
  psql -U kamayuk_owner -d identidad -c \
  "SET app.municipalidad_id='<id>';
   SELECT c.consumidor, count(*) FILTER (WHERE a.evento_id IS NULL) AS pendientes
     FROM (SELECT unnest(ARRAY['rentas','catastro','normativa','caja']) AS consumidor) c
     CROSS JOIN identidad_evento e
     LEFT JOIN identidad_evento_acuse a
            ON a.evento_id = e.evento_id AND a.consumidor = c.consumidor
    GROUP BY c.consumidor ORDER BY 1;"
```

Un número que **no baja entre dos vueltas del consumidor** es un atasco, no un retraso: el
`CronJob` `kamayuk-<sistema>-consumidor-de-identidad` corre cada 5 minutos en los
cuatro satélites (`*/5 * * * *`, medido), así que lo que sigue ahí diez minutos después ya
no llega solo. Cuánto tarda en condiciones normales está medido en
[la ventana de la copia local](../../00-gobierno/identidad-4-la-ventana-de-la-copia-local.md).

**5 · La aplicación pasa a `Ready`.** No tiene contenedor de espera, así que esto es lo que
dice que el esquema le sirve:

```bash
kubectl -n kamayuk-<sistema>-<amb> rollout status deploy/kamayuk-<sistema>-web --timeout=300s
```

## Si no sale bien

| Síntoma | Qué hacer |
|---|---|
| El reintento vuelve a fallar con el mismo mensaje | La causa no estaba resuelta. Volver al paso 2, y **no** seguir reintentando: cada vuelta gasta la ventana y el `Job` que agota su `backoffLimit` ya no reintenta nunca |
| `pulumi up` no recrea el `Job` que se borró | El nombre depende de `kamayuk:versionDe<Sistema>`. Si esa línea no cambió, el nombre es el mismo y se recrea; si cambió, se crea **otro** y el viejo se queda ahí como un fósil hasta que su TTL lo borre |
| El `Job` está en `Failed` y no quedan pods que leer | El TTL de 24 h ya pasó. No hay registro que recuperar: queda `describe job` —que conserva las condiciones y los eventos mientras el `Job` exista— y el diagnóstico del paso 1 |
| La implantación de un satélite falla y la de `identidad` está bien | Es el **orden**, y se arregla repitiendo la del satélite: implantar `identidad` primero y volver a lanzar la otra, que es idempotente. Los tres mensajes que lo distinguen están en [el orden de implantación](../../00-gobierno/identidad-5-el-orden-de-implantacion.md) |
| Falló la implantación y **nadie recibió una alerta** | Es esperado y está medido: `JobDeMigracionFallido` filtra `job_name=~".*migracion.*"`, y no hay ninguna regla equivalente para la implantación |
| El `Job` está en `Complete` con un fallo dentro (`.status.failed = 1`) y nadie se enteró | También esperado. Medido el 2026-09-12: para las tres implantaciones en ese estado, kube-state-metrics **no publica** ninguna serie `kube_job_status_failed`, así que no hay nada que alertar. Un `Job` que de verdad termina en `Failed` **sí** publica `kube_job_status_failed{reason="BackoffLimitExceeded"} 1`, que es lo que dispara la alerta |
| Tras revertir la aplicación, el esquema sigue con la migración a medias | Es el estado esperado (RNF-073: aditiva). No afecta a la versión anterior si no usa las columnas nuevas. Se documenta y se corrige con una migración nueva |
| El ambiente entero no converge y los diez `Job` están parados | Puede no ser de esquema. Si el ambiente acaba de mudarse de nodo, mirar [mudar un ambiente de nodo](../../00-gobierno/mudar-un-ambiente-de-nodo.md) antes que nada |

## Estado del ensayo

**Ensayado contra `prod` de verdad.** El caso completo ocurrió el **2026-09-11** en el
estreno del nodo nuevo (`vmd206041`): tres implantaciones en `Failed` tras siete intentos,
una en `Complete` sin haber hecho su trabajo, y la salida del paso 5 —borrar los `Job` y
volver a aplicar— es la que desatascó el ambiente. La causa, un desfase de versiones, quedó
cerrada con una guarda.

**Reejecutado entero el 2026-09-12** contra ese mismo `prod`, sólo lecturas: los diez `Job`
con sus nombres, duraciones, `backoffLimit` y TTL; las etiquetas (y que el selector del
documento del archivo devuelve `No resources found`); el guion de diagnóstico sobre los
seis espacios de nombres; `flyway_schema_history` en las cinco bases; la ausencia de
contenedores de inicialización en los cinco `Deployment` y su presencia en los diez `Job`;
los registros de las cinco implantaciones —incluidos el `WARN` de `normativa` y el `ERROR`
de `rentas`—; el `SET app.municipalidad_id` en las dos direcciones; la copia local de los
cuatro satélites; los cuatro eventos que `rentas` no puede aplicar; los roles del clúster; y
las series de kube-state-metrics detrás de la alerta.

**No ensayado aquí, y por qué:** borrar un `Job`, limpiar una fila de
`flyway_schema_history` y lanzar un `pulumi up` **escriben en producción**, y este documento
se remidió con acceso de sólo lectura. Lo del paso 5 está ensayado por la ejecución del
2026-09-11 y se cita como tal; lo del paso 6 **no tiene ninguna ejecución detrás en este
producto** —hoy no hay ni una fila con `success = false` en las cinco bases—, así que es el
único procedimiento de este runbook escrito desde el comportamiento de Flyway y no desde
una avería vivida. Ensayarlo exige provocar una migración que falle a mitad en un ambiente
desechable, y ese ambiente todavía no existe.

## Documentos relacionados

[ADR-0011](../../30-arquitectura/adr/ADR-0011-infraestructura-como-codigo.md) §5 (la
etiqueta de la imagen, y por qué una liberación no vuelve a pasar por Pulumi) ·
[ADR-0031](../../30-arquitectura/adr/ADR-0031-infraestructura-comun-y-propia.md) §2 (un
espacio de nombres por sistema) ·
[ADR-0032](../../30-arquitectura/adr/ADR-0032-el-esquema-nace-en-baseline.md) (el esquema
nace en baseline) ·
[ADR-0039](../../30-arquitectura/adr/ADR-0039-la-identidad-es-un-sistema.md) (quién escribe
la autorización, y por qué una implantación en verde puede no servir de nada) ·
[ADR-0002](../../30-arquitectura/adr/ADR-0002-estrategia-multi-tenant.md) (por qué toda
consulta a una tabla del producto necesita fijar el inquilino) ·
[El orden de implantación](../../00-gobierno/identidad-5-el-orden-de-implantacion.md) ·
[La ventana de la copia local](../../00-gobierno/identidad-4-la-ventana-de-la-copia-local.md) ·
[Mudar un ambiente de nodo](../../00-gobierno/mudar-un-ambiente-de-nodo.md) ·
[Abrir la consola de Keycloak](abrir-la-consola-de-keycloak.md) ·
[`espera-al-motor.ts`](../../../infra/componentes/espera-al-motor.ts) ·
[`orden-de-implantacion.ts`](../../../infra/verificaciones/orden-de-implantacion.ts) ·
[`deriva-de-migraciones.ts`](../../../infra/verificaciones/deriva-de-migraciones.ts) ·
[`alertas.yml`](../../../infra/observabilidad/alertas.yml)
