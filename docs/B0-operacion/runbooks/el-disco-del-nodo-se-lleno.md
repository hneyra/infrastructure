# Runbook — El disco del nodo se llenó

| Campo | Valor |
|---|---|
| Cuándo | Alerta `DiscoDelNodoAlto` (>80 % del sistema de archivos raíz), o `PostgreSQLCaido` sin que el pod esté en `CrashLoopBackOff` |
| Qué cubre | Qué está creciendo y cuál de los cinco sospechosos es. Redimensionar el disco **no** está aquí |
| Por qué importa más aquí que en otra parte | Un solo nodo: los WAL, las imágenes, los registros, **seis bases en un solo motor** y los datos de Prometheus crecen todos sobre el **mismo** `/dev/sda1` |
| Estado del ensayo | **Medido contra `prod` el 2026-09-12** (`vmd206041`), sólo con lecturas. **No ensayado con un disco llenándose de verdad**, y **la alerta que lo dispara no puede llegar hoy** — ver «Síntoma» y «Estado del ensayo» |

> **Este documento vivía en el repositorio archivo `sgtm` y estaba pre-renombrado**
> (`kubectl -n sgtm-<amb>`, base `sgtm`, rol `sgtm_app`). Se trajo y se remidió entero
> ([#100](https://github.com/hneyra/infrastructure/issues/100),
> [#110](https://github.com/hneyra/infrastructure/issues/110)). Lo que cambió no fue sólo
> el prefijo: **las tres rutas que mandaba a vaciar eran de otra máquina**, y dos de sus
> cuatro pasos los hace hoy el kubelet solo.

## Síntoma

PostgreSQL deja de aceptar escrituras sin que el pod esté reiniciando, o los pods empiezan
a ser desalojados. Es distinto de «el nodo se cayó»: aquí `ping` y SSH siguen respondiendo.

> ### ⚠ La alerta existe, está cargada, y **no puede dispararse**. Medido el 2026-09-12
>
> `DiscoDelNodoAlto` sigue llamándose así —`infra/observabilidad/alertas.yml`, severidad
> crítica, `> 80` durante 5 minutos— y el Prometheus de `prod` la tiene cargada, con
> `health: ok` y estado `inactive`. **Ese `inactive` no significa que el disco esté bien:
> significa que su expresión se evalúa sobre el vacío.**
>
> ```
> up{job="node"}                        = 0   (66 de 66 muestras en ~11 h)
> count(node_filesystem_avail_bytes)    = vacío
> lastError: dial tcp 10.43.64.181:9100: connect: connection refused
> ```
>
> `node-exporter` está `Running` y sirviendo, pero **Prometheus no consigue raspar su
> puerto 9100**, así que ninguna serie `node_*` existe — cero de ellas en toda la
> retención. La regla mira `node_filesystem_avail_bytes{mountpoint="/"}`, que no existe, y
> una regla sobre un vector vacío **nunca pasa a `pending`**.
>
> Es exactamente la lección que el propio `alertas.yml` escribió para `pg_up` y no aplicó
> aquí: *«la serie no pasa a 0, sencillamente deja de existir»*. El grupo `kamayuk` **no
> tiene reglas `absent()`** —sólo las tiene `alertas-del-corte.yml`, que además no está
> cargado en `prod`—, de modo que nadie avisa de que el vigilante se fue.
>
> **Consecuencia para quien lee esto:** si llegaste por la alerta, llegaste por
> `PostgreSQLCaido` —esa sí funciona, `up{job="postgres"} = 1` hoy— o porque alguien miró.
> **Con `CPUDelNodoAlta`, `MemoriaDelNodoAlta` y `PresionDeCPUDelNodo` pasa lo mismo**: las
> cuatro dependen de `node-exporter`. Arreglar el raspado es otro trabajo, y no se hace
> desde este documento; lo que este documento no puede hacer es fingir que le avisan.

## Precondiciones

1. **`kubectl` contra el clúster.** Si el disco está tan lleno que ni siquiera el API de
   k3s responde, esto ya no es este runbook: es la pérdida del nodo.
2. **Saber qué está creciendo antes de borrar nada.** El estado del nodo se lee **sin
   entrar en él**, que es lo único que se pudo ejercer para escribir esto:

   ```bash
   kubectl get --raw /api/v1/nodes/<nodo>/proxy/stats/summary \
     | python3 -c 'import json,sys; f=json.load(sys.stdin)["node"]["fs"]; \
       print("usado %.1f%% — %.1f de %.1f GiB" % (f["usedBytes"]/f["capacityBytes"]*100, \
       f["usedBytes"]/2**30, f["capacityBytes"]/2**30))'
   ```

   > **Línea base, medida el 2026-09-12 08:51 UTC en `prod` (`vmd206041`, k3s
   > v1.36.4+k3s1):** `/dev/sda1` de **192.85 GiB**, **20.64 GiB usados (10.70 %)**,
   > 172.19 GiB libres, inodos al 0.84 %. De eso, **3.76 GiB son imágenes** (32 imágenes
   > listadas por el kubelet), 229 MiB el almacenamiento efímero de los 19 pods vivos y
   > 179 MiB el `PGDATA` entero. `DiskPressure: False`.
   >
   > **Faltan ~133 GiB de crecimiento para llegar al 80 %.** Si tu medida se parece a
   > ésta, no tienes un incidente de disco: tienes otra cosa.

3. **Los tres umbrales, en el orden en que ocurren.** Salen de la configuración real del
   kubelet (`/proxy/configz`, medida el mismo día), no de este documento:

   | Uso de `/` | Qué pasa | De dónde sale |
   |---|---|---|
   | **80 %** (154.3 GiB) | la alerta `DiscoDelNodoAlto` —cuando vuelva a poder dispararse | `alertas.yml` |
   | **85 %** (163.9 GiB) | **el kubelet purga imágenes sin usar él solo**, hasta bajar al 80 % | `imageGCHighThresholdPercent: 85`, `Low: 80`, `imageMinimumGCAge: 2m` |
   | **95 %** (183.2 GiB, 9.64 GiB libres) | `DiskPressure` y desalojo de pods | `evictionHard: {nodefs.available: 5%, imagefs.available: 5%}` |

   **Entre la alerta y el desalojo hay 28.9 GiB**, y el kubelet usa los primeros para
   purgar imágenes por su cuenta. Eso cambia el orden de los pasos de abajo.

## Pasos

### 1. Descartar primero lo que no es

Tres cosas que este runbook nombraba y **hoy no ocupan disco del nodo**:

- **Los respaldos no están aquí.** El CronJob `kamayuk-prod-respaldo` (06:00 UTC, con
  `wal-g`) empuja a **`s3://sgtm-prod-respaldos`**, con `RETENCION=7`. Ese bucket
  **conserva el nombre del monolito a propósito**: es el nombre de una cosa que existe, y
  renombrarlo en el código sin renombrarlo en S3 manda los respaldos a un sitio que no
  existe, lo que no da error hasta el día que hay que restaurar.
- **Los WAL tampoco se acumulan**, mientras el archivado funcione. Medido: `archive_mode =
  on`, `archive_command = /opt/wal-g/wal-g wal-push %p`, **`failed_count = 0`**, 131
  segmentos archivados, el último a las 08:45 UTC. `pg_wal` pesaba **80 MiB** (5 segmentos
  de 16 MiB), con `max_wal_size` en 1 GiB.
- **`/var/lib/docker` nunca existió en este nodo.** El motor de contenedores es
  **containerd 2.3.4-k3s1.36**, y sus datos viven en
  `/var/lib/rancher/k3s/agent/containerd/`.

### 2. Si es el WAL retenido

Sólo se retiene cuando el destino de archivado **no** está accesible. **No se borra a
mano**: borrar segmentos sin archivar es perder el RPO sin que nada lo avise. Primero,
confirmar que ése es el problema:

```bash
kubectl -n kamayuk-<amb> exec deploy/kamayuk-<amb>-postgres -c postgres -- \
  psql -U kamayuk_owner -d postgres -x -c 'select * from pg_stat_archiver;'
```

`failed_count > 0` con `last_failed_wal` puesto es la confirmación. El motivo, en los
registros del motor:

```bash
kubectl -n kamayuk-<amb> logs deploy/kamayuk-<amb>-postgres -c postgres | grep -i archive
```

Restablecido el acceso, wal-g drena lo acumulado solo: no hace falta ningún paso manual.

> **Dónde está ese WAL de verdad.** `PGDATA` es
> `/var/lib/postgresql/data/pgdata` **dentro del contenedor**; en el nodo es un directorio
> de `local-path-provisioner`, y su nombre lleva el UID del `PersistentVolume`, así que
> **no se escribe en un runbook, se deriva**:
>
> ```bash
> kubectl get pv -o custom-columns='CLAIM:.spec.claimRef.name,PATH:.spec.local.path'
> ```
>
> En `prod` eso da
> `/var/lib/rancher/k3s/storage/pvc-<uid>_kamayuk-prod_kamayuk-prod-postgres-datos`.
> **Los `100Gi` del PVC no son un límite**: `local-path` no impone cuota, así que el `df`
> de dentro del pod muestra el disco **entero** del nodo — 192.9 GiB, los mismos que ve el
> kubelet. Una base que crezca de más no llena «su» volumen: llena el nodo.

### 3. Si son las seis bases

**Cinco del producto más la de Keycloak, todas en el mismo motor** (`kamayuk-prod-postgres`,
PostgreSQL 16.4, `Recreate`, con el sidecar `postgres-exporter`):

```bash
kubectl -n kamayuk-<amb> exec deploy/kamayuk-<amb>-postgres -c postgres -- \
  psql -U kamayuk_owner -d postgres -c \
  "select datname, case when has_database_privilege(current_user, datname, 'CONNECT') \
     then pg_size_pretty(pg_database_size(datname)) else 'sin permiso' end \
   from pg_database order by datname;"
```

> **Medido el 2026-09-12:** `catastro` 19 MB, `rentas` 16 MB, `caja` 9756 kB, `identidad`
> 9580 kB, `normativa` 9180 kB; `keycloak` dice **«sin permiso»**, y es correcto —
> `kamayuk_owner` no tiene `CONNECT` sobre ella. **El `PGDATA` entero son 179 MiB**: hoy
> las bases no son el problema, y este paso existe para el día que lo sean.

**Lo que sí crece sin techo es el buzón de `identidad`.** `identidad_evento` y
`identidad_evento_acuse` son inmutables por diseño —la regla 4 prohíbe el `DELETE`— y cada
escritura administrativa deja **un evento y hasta cuatro acuses**, uno por consumidor.
Medido: **333 eventos y 1 328 acuses** en 11 horas de vida, 304 kB y 240 kB. Crece con el
uso y **nadie lo poda**: es la tabla que hay que mirar primero dentro de `identidad`.

### 4. Si son imágenes de contenedor

**Antes de purgar nada, mirar si hace falta.** Por encima del 85 % el kubelet ya lo hace
solo, y por debajo del 80 % no lo hará aunque se lo pidas:

```bash
kubectl get node <nodo> -o json \
  | python3 -c 'import json,sys; i=json.load(sys.stdin)["status"]["images"]; \
    print("%d imagenes, %.2f GiB" % (len(i), sum(x.get("sizeBytes",0) for x in i)/2**30))'
```

> **Medido:** 32 imágenes, 2.53 GiB según el kubelet (3.76 GiB de `imageFs` contando
> capas). La señal de que cada liberación deja atrás la anterior está ahí: **dos digests
> distintos de `ghcr.io/hneyra/kamayuk-identidad`**, 154 y 148 MiB.

Sólo si el kubelet no basta —o si hay que liberar **ya**, por debajo de su umbral—, desde
el nodo y por SSH:

```bash
sudo k3s crictl rmi --prune
```

**Nunca** un `rm` manual sobre una imagen en uso: `--prune` respeta las referenciadas, un
borrado a dedo no.

### 5. Si son registros de contenedor

**El comando que este runbook traía —`journalctl --vacuum-size`— no toca los registros de
los contenedores.** Ésos los escribe el kubelet en `/var/log/pods/`
(`/var/log/containers/` son enlaces simbólicos), y **ya están acotados**:
`containerLogMaxSize: 10Mi` con `containerLogMaxFiles: 5`, o sea **50 MiB como máximo por
contenedor**. `journalctl` vacía el diario de systemd, que es otra cosa y en este nodo es
mucho más pequeña.

Lo que no está acotado es **cuántos contenedores hay**:

```bash
kubectl get pods -A --no-headers | awk '{print $4}' | sort | uniq -c | sort -rn
```

> **Medido el 2026-09-12: 76 pods, de los cuales sólo 19 están vivos** — 31 en `Error` y
> 26 `Completed`. Los terminados conservan sus registros en disco.
>
> **De dónde salen, medido:** los cuatro satélites corren
> `kamayuk-<sistema>-consumidor-de-identidad` **cada 5 minutos**, con
> `successfulJobsHistoryLimit: 3`, `failedJobsHistoryLimit: 3` y **`backoffLimit: 1`**. Ese
> `backoffLimit` es la parte que no se ve: **un Job fallido deja DOS pods**, el intento y
> su reintento. De ahí los 3 `Completed` + 6 `Error` por namespace que se repiten en los
> cuatro, exactos.
>
> **Y están congelados, no creciendo.** Los 24 `Error` son de tres franjas consecutivas de
> hace ~10 h, cuando los consumidores todavía recibían 403; desde entonces todos terminan
> bien, así que el historial de fallidos **no rota** y se queda ahí hasta el próximo fallo.
> Es un techo, no una fuga: `maxPods` es 110 y sólo cuentan los 19 no terminados.

Un consumidor concreto, si hace falta saber por qué falló:

```bash
kubectl -n kamayuk-<sistema>-<amb> logs <pod> --tail=40
```

### 6. Si nada de lo anterior libera suficiente

El disco está lleno de datos legítimos —el padrón creció—. Eso ya no es una emergencia: es
una ventana de mantenimiento anunciada para redimensionar el volumen, y **no se decide
desde aquí** (ADR-0011 §6: lo que se toque a mano en el nodo lo borra el siguiente
`pulumi up`, en silencio).

## Cómo se comprueba que terminó bien

**No** «el uso del disco bajó del 80 %». Un disco con espacio libre y PostgreSQL que sigue
sin aceptar escrituras no está resuelto.

**1 · El motor acepta una escritura de verdad**, con observación —la regla 10 la exige en
toda escritura—. Contra una base del producto, no contra `postgres`:

```bash
kubectl -n kamayuk-<amb> exec deploy/kamayuk-<amb>-postgres -c postgres -- \
  psql -U kamayuk_app -d rentas -c \
  "SET LOCAL app.municipalidad_id = '<id>'; \
   INSERT INTO auditoria (municipalidad_id, ejercicio, tabla, clave, operacion, \
                          usuario_id, observacion) \
   VALUES (<id>, 2026, 'runbook', 'disco', 'ACCESO', 'sistema', \
           'comprobacion tras liberar disco')"
```

> **Este comando NO es el que traía el documento, y los cuatro cambios están medidos
> contra el esquema real.** El anterior habría fallado cuatro veces seguidas: la tabla es
> **`auditoria`** particionada por `ejercicio`, no `auditoria_<ejercicio>`; la columna es
> **`usuario_id`**, no `usuario`; `ejercicio`, `clave` y `usuario_id` son **`NOT NULL` sin
> valor por omisión**; y **`VERIFICACION` no es una operación válida** —
> `auditoria_operacion_check` sólo admite `ALTA`, `MODIFICACION`, `BAJA`, `ANULACION`,
> `REVERSION`, `PERMISO` y `ACCESO`—. Y el parámetro del inquilino se llama
> **`app.municipalidad_id`**, no `sgtm.municipalidad_id`: sin él, la política de RLS
> rechaza la fila.

**2 · El aislamiento se sostiene.** Liberar espacio no debería haber tocado RLS, y la forma
de saberlo es comprobándolo. **Esta sonda es de sólo lectura y se ejecutó tal cual el
2026-09-12**:

```bash
for t in <id> 99; do
  kubectl -n kamayuk-<amb> exec deploy/kamayuk-<amb>-postgres -c postgres -- \
    psql -U kamayuk_owner -d identidad -At \
    -c "select set_config('app.municipalidad_id','$t',false); \
        select 'usuario='||count(*) from usuario;" | tail -1
done
```

> Devolvió **`usuario=5`** para el inquilino 1 —`administrador` más las cuatro
> `service-account-kamayuk-<sistema>-servicio-200105`— y **`usuario=0`** para el 99. Vale
> como sonda **porque `usuario`, `permiso` e `identidad_evento` tienen `FORCE ROW LEVEL
> SECURITY`**: la política se aplica también al propietario, así que un `0` aquí es el
> aislamiento funcionando y no un privilegio de más.

**3 · El motor y su sidecar vuelven a ser visibles para Prometheus.**

```bash
kubectl -n kamayuk-<amb> exec deploy/kamayuk-<amb>-observabilidad-prometheus -- \
  wget -qO- 'http://localhost:9090/api/v1/query?query=up'
```

> **Lo que NO sirve como comprobación hoy: «`DiscoDelNodoAlto` dejó de estar en
> `firing`».** Nunca estuvo, y no puede estarlo mientras `up{job="node"} = 0`. Un
> `inactive` ahí es indistinguible de «no hay datos», que es justo el defecto. Lo que sí se
> puede afirmar es `up{job="postgres"} = 1`, que el 2026-09-12 lo era.

## Si no sale bien

| Síntoma | Qué hacer |
|---|---|
| El disco se llena otra vez en días | No es un incidente, es una tendencia. Redimensionar en una ventana anunciada, en vez de repetir esto cada semana |
| `pg_stat_archiver.failed_count > 0` tras restablecer el acceso | El problema no era de red. Revisar las credenciales del bucket en el `Secret` del CronJob —`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `WALG_LIBSODIUM_KEY`— y que `WALG_S3_PREFIX` siga siendo `s3://sgtm-prod-respaldos` |
| `crictl rmi --prune` no libera nada | Las imágenes en uso son las que ocupan. Son demasiadas versiones desplegadas a la vez, no basura acumulada — y por debajo del 85 % el kubelet tampoco iba a purgarlas |
| Purgaste y el uso no baja | Mira `local-path` antes que containerd: los PVC de Prometheus (8 Gi declarados, **39.7 MiB reales** el 2026-09-12), Grafana y el motor están **en el mismo sistema de archivos**, y ninguno tiene cuota |
| El nodo entra en `DiskPressure` | Ya estás por debajo de 9.64 GiB libres y el kubelet está desalojando. Purgar imágenes primero, que es lo menos arriesgado, y tratarlo como pérdida del nodo si no se estabiliza en minutos |
| Llegaste aquí y el disco está al 10 % | Entonces la avería es otra. `PostgreSQLCaido` también apunta a este runbook, y sus causas no son de disco: mira el pod del motor, su sidecar y sus `Secret` |

## Estado del ensayo

**Medido contra `prod` el 2026-09-12** (`vmd206041`, k3s v1.36.4+k3s1, containerd
2.3.4-k3s1.36, PostgreSQL 16.4), **sólo con lecturas**. Lo que se ejecutó de verdad: el
`stats/summary` del nodo y su `configz`, el inventario de imágenes, `pg_stat_archiver` y
los `pg_settings` del archivado, el tamaño de las seis bases y del `PGDATA`, el recuento de
pods por fase y los límites de historial de los cinco CronJob, los `PersistentVolume` con
su ruta real, el estado y las series de Prometheus, y **la sonda de aislamiento del paso 2
del apartado anterior, que devolvió 5 y 0**.

**No ensayado, y cada uno con su motivo:**

- **Nada destructivo.** No se purgó ninguna imagen, no se vació ningún registro, no se
  borró ningún WAL, no se tocó el disco. `crictl rmi --prune` y el vaciado de registros
  quedan **sin ejercer**: son el tipo de comando que no se prueba en el sistema que sirve
  el padrón para ver si el runbook está bien escrito.
- **No hay acceso SSH al VPS desde donde se remidió esto**, sólo `kubectl` de lectura. Por
  eso cada paso tiene una forma que se resuelve por el API, y por eso **el peso en disco de
  los registros de los 57 pods terminados no está medido**: `stats/summary` sólo reporta
  los 19 vivos. Lo que sí está medido es su cota —10 MiB × 5 archivos por contenedor— y de
  dónde salen tantos.
- **No se ensayó con un disco llenándose de verdad**, que necesita volumetría real.
- **La escritura de comprobación no se ejecutó**, por lo mismo que lo anterior: escribe. Su
  forma está derivada del esquema real, columna a columna, y las cuatro correcciones
  respecto de la versión del archivo están anotadas junto al comando.
- **`DiscoDelNodoAlto` no se pudo ver disparar, y no por falta de disco lleno**: no puede
  dispararse. Está en «Síntoma», con las tres medidas que lo demuestran, y arreglarlo es
  otro trabajo — el raspado de `node-exporter`, no este documento.

## Documentos relacionados

[ADR-0002](../../30-arquitectura/adr/ADR-0002-estrategia-multi-tenant.md) (el aislamiento
que el paso 2 comprueba) ·
[ADR-0004](../../30-arquitectura/adr/ADR-0004-almacenamiento-de-datos.md) (PostgreSQL y el
particionado por ejercicio) ·
[ADR-0011](../../30-arquitectura/adr/ADR-0011-infraestructura-como-codigo.md) §6 (lo que se
toca a mano en el nodo) ·
[ADR-0039](../../30-arquitectura/adr/ADR-0039-la-identidad-es-un-sistema.md) (el buzón que
crece sin poda) ·
[Los cinco hallazgos de RLS](../../40-datos/hallazgos-de-rls.md) ·
[D-22 — Quién opera estos despliegues](../../00-gobierno/D-22-quien-opera-cuatro-despliegues.md) ·
[Mudar un ambiente de nodo](../../00-gobierno/mudar-un-ambiente-de-nodo.md) ·
[Abrir la consola de Keycloak](abrir-la-consola-de-keycloak.md)
