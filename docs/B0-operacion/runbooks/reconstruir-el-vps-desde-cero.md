# Runbook — Reconstruir el VPS desde cero

| Campo | Valor |
|---|---|
| Cuándo | **Pérdida total del nodo**: el proveedor lo destruye, el disco no arranca, el VPS se cancela por error. No hay nada a lo que conectarse |
| Qué cubre | Levantar un nodo nuevo y volver a poner el ambiente entero encima, con su padrón restaurado. **No** cubre cambiar de nodo a propósito — eso es [Mudar un ambiente de nodo](../../00-gobierno/mudar-un-ambiente-de-nodo.md) |
| RTO objetivo | 4 horas (RNF-077). **Nunca se ha medido de punta a punta**, y esa cifra sigue siendo un objetivo, no una medición |
| Estado del ensayo | **El camino principal NO está ensayado, y es deliberado: destruir el nodo de `prod` para ensayar «perder el nodo» es perderlo.** Lo que sí está ejecutado de verdad son los pasos 1–5 y 8 —contra el nodo nuevo de `prod`, `vmd206041`, el 2026-09-11— y lo que se ve hoy del resultado, remedido el 2026-09-12. Ver «Estado del ensayo» |
| ⚠ Impedimento vivo | **Hoy `prod` no se podría reconstruir con sus respaldos**, medido el 2026-09-12: los siete que hay en el bucket son de **otro clúster** y su WAL ya está sobrescrito. Es la precondición 2, y el issue es [#112](https://github.com/hneyra/infrastructure/issues/112) |

> **Este documento vivía en el repositorio archivo `sgtm` y estaba pre-renombrado**
> (`kubectl -n sgtm-<amb>`, rol `sgtm_owner`, base `sgtm`, cinco claves de aplicación,
> cuatro secretos de GitHub). Copiado al pie de la letra no reconstruía nada: el primer
> comando fallaba con `namespaces "sgtm-prod" not found` y los siguientes daban por
> buenas cifras de un despliegue que ya no existe. Se trajo y se remidió entero
> ([#100](https://github.com/hneyra/infrastructure/issues/100),
> [#109](https://github.com/hneyra/infrastructure/issues/109)).

## Síntoma

El nodo no responde a `ping` ni a SSH, y no vuelve. Se distingue de
[el disco se llenó](el-disco-del-nodo-se-lleno.md) —ese runbook primero— y de «el pod de
PostgreSQL murió» —que se repone solo— en que aquí **no hay nada a lo que conectarse**: ni
el API de k3s por el túnel SSH, ni el propio SSH.

## Este runbook y el de la mudanza: cuál es cuál

Son dos documentos porque son dos situaciones, y **el paso que las separa es el 7**:

| | Este runbook | [Mudar un ambiente de nodo](../../00-gobierno/mudar-un-ambiente-de-nodo.md) |
|---|---|---|
| El nodo viejo | **no existe**, o no contesta | **sigue en pie**, y es quien sirve hasta que se corte |
| Los secretos del clúster viejo | **no se pueden sacar** — de ahí el paso 0 y su aviso | se sacan tranquilamente antes de empezar |
| `PULUMI_K8S_DELETE_UNREACHABLE` | suelta objetos que **de verdad ya no existen** | suelta objetos que **siguen corriendo**: quedan huérfanos |
| El padrón | se restaura desde el bucket (paso 9) | se decide antes: si hay datos, no es una mudanza |

El segundo se escribió el 2026-09-11 **porque a este le faltaba el paso 7**, y ese hueco
costó el primer `pulumi up` de `prod`. Aquí ya está.

## Lo que se pierde con el nodo, medido el 2026-09-12 en `prod`

**Todo el almacenamiento es local al nodo.** La única clase de almacenamiento es
`local-path` (`rancher.io/local-path`, `Delete`, `WaitForFirstConsumer`), y los cuatro
`PersistentVolume` llevan afinidad al nodo **por su nombre**:

```
pvc-593abfb9…  100Gi  kamayuk-prod-postgres-datos                    → [vmd206041]
pvc-68eab124…    8Gi  kamayuk-prod-observabilidad-prometheus-datos   → [vmd206041]
pvc-1065de0e…    1Gi  kamayuk-prod-observabilidad-grafana-datos      → [vmd206041]
pvc-e0576f8f…  128Mi  traefik (kube-system)                          → [vmd206041]
```

Así que perder el nodo es perder el directorio de datos de PostgreSQL, el histórico de
Prometheus y los tableros de Grafana. **Lo único que sobrevive está fuera**: el bucket
`sgtm-prod-respaldos` —que **no se renombra**: es el nombre de una cosa que existe, y
cambiarlo en el código sin cambiarlo en AWS manda los respaldos a un sitio que no existe—
y lo que haya en Pulumi Cloud y en GitHub.

Y una cosa más, que es la que este runbook no decía y por la que se reescribió: **la
clave con la que ese bucket se lee vive DENTRO del nodo que se pierde.**

## Precondiciones

1. **Acceso a los secretos de GitHub Actions**, o a quien pueda regenerarlos. **Son ocho,
   no cuatro**: `PULUMI_ACCESS_TOKEN` y `REGISTRY_PULL_TOKEN` a nivel de repositorio, y
   `SSH_PRIVATE_KEY`, `VPS_USER`, `VPS_HOST`, `KUBECONFIG`, `BACKUP_ACCESS_KEY_ID` y
   `BACKUP_SECRET_ACCESS_KEY` **por cada *environment*** —
   [`infra/README.md` §«Cómo llegar a un VPS real»](../../../infra/README.md) pasos 3 a 5.
2. **Un respaldo del clúster QUE SE VA A RESTAURAR, comprobado contra el bucket.** No
   basta con que exista «un respaldo reciente»: hay que comprobar que es **de este
   clúster**, y eso **no se mira en la tabla `respaldo` ni en el estado del `CronJob`** —
   los dos pueden decir que todo fue bien sobre un bucket que no sirve para restaurar
   nada. Se comparan **tres** campos de cada respaldo con el clúster vivo:

   ```bash
   # 1. El identificador del clúster que corre
   kubectl -n kamayuk-<amb> exec deploy/kamayuk-<amb>-postgres -c postgres -- \
     psql -U kamayuk_owner -d postgres -Atc 'select system_identifier from pg_control_system();'

   # 2. Lo que hay en el bucket, con su hostname y su fecha
   kubectl -n kamayuk-<amb> exec deploy/kamayuk-<amb>-postgres -c postgres -- \
     /opt/wal-g/wal-g backup-list --detail

   # 3. El SystemIdentifier del centinela del respaldo que se piensa usar
   kubectl -n kamayuk-<amb> exec deploy/kamayuk-<amb>-postgres -c postgres -- \
     /opt/wal-g/wal-g st cat basebackups_005/<nombre-del-respaldo>_backup_stop_sentinel.json
   ```

   **Si el `SystemIdentifier` del centinela no es el de `pg_control_system()`, ese respaldo
   es de otro clúster y no restaura**, aunque `backup-list` lo liste, aunque el prefijo sea
   el correcto y aunque la fila de `respaldo` diga `EXITOSO`.

   > **⚠ Y ése es el estado de `prod` HOY, medido el 2026-09-12 —no deducido—.** Esta
   > precondición **no se cumple**, así que una pérdida del nodo hoy no se repara con este
   > runbook. Es [#112](https://github.com/hneyra/infrastructure/issues/112).
   >
   > `wal-g backup-list --detail` devuelve **siete** respaldos, del **2026-08-30** al
   > **2026-09-05**, los siete con `hostname` `sgtm-prod-respaldo-*` —o sea del **nodo
   > viejo**— y los siete con `SystemIdentifier` **7678467191030263850**. El clúster que
   > corre hoy arrancó el **2026-09-11 21:44:04 UTC** y su `system_identifier` es
   > **7684396738591203366**. Son clústeres distintos, y **no hay ni un respaldo del
   > segundo**.
   >
   > **Y el WAL de los siete ya no existe.** El clúster nuevo escribe al **mismo prefijo y
   > la misma línea de tiempo**, así que sus segmentos se llaman igual que los del viejo y
   > lo van sobrescribiendo. Medido: de los **69 objetos** de `wal_005/`, **62 son
   > segmentos y los 62 están fechados el 2026-09-12** —el rango `…04D` a `…08A`, uno cada
   > cinco minutos—; del clúster viejo **no sobrevive un solo segmento**, sólo las siete
   > etiquetas `*.backup.lz4` de 302–305 bytes, que sin sus segmentos no restauran nada.
   > Cuando se escribió el runbook hermano, unas horas antes, `…085` y `…086` todavía
   > conservaban su fecha del 2026-09-05; ya no.
   >
   > **Y nada de esto se pone rojo en ningún sitio, que es lo peor.** El `Job`
   > `kamayuk-prod-respaldo-29819760` terminó **`Complete`**, su registro dice
   > «`Respaldo #1 iniciado hacia s3://sgtm-prod-respaldos.` / `Respaldo #1 EXITOSO.`» y la
   > tabla `respaldo` de `rentas` tiene su fila `1|EXITOSO|04:00:06|04:00:22`. En
   > `basebackups_005/` **no hay nada del 2026-09-12**. El archivado, además, se ve
   > perfectamente sano: `pg_stat_archiver` da **136 archivados y 0 fallidos**, último
   > `00000001000000000000008A` a las **09:10:17 UTC**, con `archive_mode = on` y
   > `archive_timeout = 300`. Todos los indicadores en verde, y nada que restaurar.
   >
   > **Por qué el `Job` canta victoria** —esto es razonamiento sobre el código, no
   > medición—: [`Respaldo.ts`](../../../infra/componentes/Respaldo.ts) escribe `EXITOSO`
   > si `backup-push` sale con 0, y encadena después
   > `delete retain 7 --confirm ... || true`, cuyo resultado **se descarta a propósito**.
   > Con los siete del clúster viejo ya en el bucket, el octavo entra y la retención tiene
   > que quitar uno; el respaldo de hoy nace en un LSN **más bajo** que los viejos —el
   > clúster nuevo empezó su numeración de cero— así que por nombre es «el más antiguo» de
   > los ocho. Lo que hay que quedarse es lo medido: **el `Job` termina en verde y el
   > bucket no gana un respaldo**.
   >
   > **Mientras #112 siga abierto, el paso 9 no tiene de dónde restaurar.** Lo que hay que
   > hacer antes de confiar otra vez en ese bucket —separar el prefijo por clúster, o
   > empezar una línea nueva— no lo decide este runbook.
3. **Acceso a la cuenta del proveedor del VPS**, para levantar uno nuevo.
4. **Una ventana de indisponibilidad ya anunciada.** No hay forma de que esto sea
   transparente ([ADR-0011](../../30-arquitectura/adr/ADR-0011-infraestructura-como-codigo.md)
   §«Negativas»).
5. **Saber que el nombre público cambia.** `kamayuk:domain` es hoy el nombre que da el
   proveedor (`vmd206041.contaboserver.net`), y de él cuelga **el emisor OIDC**
   `https://<domain>/keycloak/realms/kamayuk`, que es lo que los cinco sistemas validan en
   cada token. Un VPS nuevo es un nombre nuevo, así que **todo token en circulación deja
   de valer**. Un nombre DNS propio y estable lo evitaría, y merece decidirse antes de que
   esto haga falta de verdad.

## Pasos

### 0. Antes de nada: los secretos del clúster viejo, y `clave-cifrado` antes que ninguno

**Este paso no estaba en este runbook, y es el que no tiene vuelta atrás.**

El inventario de `prod` son **37 entradas** (`yarn secretos --ambiente prod`): **20
generadas** y **17 espejos** —la misma clave de `kamayuk_app` o `kamayuk_owner` publicada
en el espacio de nombres de cada sistema, porque un `Secret` no cruza namespaces—. De las
20, `bootstrap-secretos.sh` regenera **19** sin consecuencias: son claves de roles de
PostgreSQL o de cuentas que se vuelven a crear con ellas.

La que no: **`clave-cifrado`, en `kamayuk-<amb>-postgres-respaldo`** — el
`WALG_LIBSODIUM_KEY` con el que wal-g cifra cada respaldo base y cada segmento de WAL.

> **En un clúster vacío `bootstrap-secretos.sh` no la recupera: la genera nueva.** El
> guion «lee lo que ya existe en el clúster […] y genera SOLO lo que falta»; en un clúster
> recién creado falta todo. Con una clave nueva, el motor arranca una cadena nueva y **el
> histórico de `sgtm-prod-respaldos` queda ilegible, sin vuelta atrás**. No es una
> conjetura: `simulacro-de-restauracion.sh` §5 lo demuestra en cada PR —restaurar con la
> clave equivocada tiene que fallar, y si no falla el propio simulacro se pone rojo—, y
> [`rotar-clave.sh`](../../../infra/secretos/rotar-clave.sh) **se niega a rotarla** por lo
> mismo: «rotarla deja ilegibles los respaldos ya escritos».

Así que si el nodo viejo todavía contesta —aunque sea a duras penas—, lo primero es
sacarla, junto con el resto del `Secret`:

```bash
# Con el túnel abierto contra el clúster VIEJO:
umask 077
kubectl -n kamayuk-<amb> get secret kamayuk-<amb>-postgres-respaldo \
  -o yaml > secretos-de-respaldo-<amb>.yaml
```

**No se imprime en pantalla, no se pega en un chat ni en un ticket, y el archivo se borra
en cuanto el paso 6 lo haya aplicado.** Lo mismo vale para el resto del inventario si se
quiere conservar: `kamayuk-<amb>-postgres-respaldo-credenciales` (las credenciales de S3,
que también están en GitHub) y `kamayuk-<amb>-keycloak`.

**Si el nodo ya no contesta, esto no se puede hacer, y hay que decirlo en voz alta antes
de seguir**: los respaldos anteriores al incidente son ilegibles para siempre y lo que se
restaura es lo que haya bajo la clave nueva, o sea nada. La salida es que esa clave esté
copiada **fuera del clúster** antes de necesitarla; hoy no lo está, y es el hueco abierto
que este runbook deja anotado (ver «Estado del ensayo»).

### 1. Un VPS nuevo, con k3s

Fuera del alcance de este repositorio: es trabajo contra la cuenta del proveedor. Lo que
hace falta de él es **el kubeconfig del nodo**, con el `server` en el bucle local:

```bash
# En el VPS nuevo, tras instalar k3s:
sudo cat /etc/rancher/k3s/k3s.yaml | \
  sed 's#server: https://127.0.0.1:6443#server: https://localhost:6443#'
```

**No es preferencia.** CI llega al API por un túnel SSH (`ssh -N -L 6443:localhost:6443`)
y el 6443 no responde desde internet; con la dirección del VPS ahí dentro el proveedor de
Pulumi sale por fuera del túnel y el error no menciona ningún túnel.
`checkKubeconfigServer` (`infra/config.ts`) lo rechaza antes de que ese kubeconfig llegue
a usarse — acepta `localhost`, `127.0.0.1` y `[::1]`, y nada más.

Lo que corre hoy en `prod`, medido el 2026-09-12: **k3s `v1.36.4+k3s1`** sobre Ubuntu
26.04.1 LTS, `containerd://2.3.4-k3s1.36`, un solo nodo con rol `control-plane`.

### 2. El cortafuegos, antes que nada más

```bash
scp infra/vps/cortafuegos.sh <usuario>@<vps-nuevo>:
ssh <usuario>@<vps-nuevo> 'sudo ./cortafuegos.sh'
```

Se corre **antes** de exponer ningún servicio: es lo que deja 6443, 10250 y 5432 fuera del
alcance de internet ([`cortafuegos.sh`](../../../infra/vps/cortafuegos.sh)). Abre 22, 80 y
443, y además el tráfico de `cni0` y `flannel.1` — sin eso la denegación por omisión corta
la red **dentro** del clúster, y el síntoma —pods que no se ven entre ellos— no se parece
en nada a «configure el cortafuegos».

### 3. La reserva del nodo, y medirlo

**Este paso no estaba en la versión del archivo y sin él el paso 4 mide lo que no es.**

```bash
ssh <usuario>@<vps-nuevo> 'sudo ./reservar-recursos-del-nodo.sh'
```

Reserva 1 CPU y 2 Gi **en total** para kubelet, containerd y el sistema operativo,
repartidos entre `system-reserved` y `kube-reserved` —que kubelet **suma**, así que poner
`cpu=1` en las dos reserva 2—. **Reinicia k3s**, así que va en su propia ventana y nunca
junto a otro cambio; el guion espera la recuperación y la comprueba.

El efecto, medido en `prod` el 2026-09-12: **capacidad 6 CPU / 12242280Ki**, **asignable
5 CPU / 10145128Ki** — exactamente la resta de los 2 Gi.

> **La ejecución se anota, y hay dónde.** El guion citaba un
> `docs/80-infraestructura/mantenimiento-del-nodo.md` que no existía ni aquí ni en el
> archivo —el documento real se llama `mantenimiento-del-vps.md`, así que la cita estaba
> mal en el nombre **y** en la ruta—. Quedó cerrado el 2026-09-12
> ([#111](https://github.com/hneyra/infrastructure/issues/111)): el runbook está aquí y el
> guion manda a su tabla «Registro de ejecuciones de la reserva». Lo vigila
> [`lo-que-el-codigo-cita-existe.test.ts`](../../../infra/verificaciones/lo-que-el-codigo-cita-existe.test.ts),
> que se pone roja si el código nombra un documento que no está.

### 4. Lo medido, escrito en el stack

`nodeAllocatableCpu` y `nodeAllocatableMemory` de
[`Pulumi.<ambiente>.yaml`](../../../infra/Pulumi.prod.yaml) son lo que `capacidad.ts`
compara contra la demanda del stack. Una cifra optimista lo deja pasar todo.

```bash
cd infra
KUBECONFIG=<el del túnel> ./vps/comprobar-lo-asignable.sh --ambiente prod
KUBECONFIG=<el del túnel> yarn --silent capacidad --ambiente prod
```

Ejecutados contra `prod` el 2026-09-12, palabra por palabra:

```
Nodo real de «prod»: 5 CPU / 10145128Ki asignables.
El stack declara:            5 CPU / 10145128Ki.
Correcto: lo declarado no supera lo que el nodo reparte.

Ambiente «prod» contra un nodo de 5 / 10145128Ki:
  permanente     1540m / 5536Mi
  pico arranque  2360m / 9440Mi
  …
cabe
```

**Declarar de menos es admisible; declarar de más es lo que se rechaza**, porque es la
única dirección en la que el error deja pasar un despliegue que no cabe. Y ojo con la
cifra que circula: el nodo de `prod` **no es el 8 CPU / 16 GB que `INF-01` §2
dimensiona** — es un 6 CPU / ~11,7 GB, y el margen de memoria en el pico son **307Mi**.

### 5. Las credenciales del flujo

Los dos secretos de repositorio y los seis del *environment* que corresponda
(`infra/README.md` paso 4). Para `prod` hay que ponerlos **en los dos**: `prod` y
`prod-preview` —la copia sin protección que usa `previsualizar-prod`—, o el preview de
cada PR queda ciego.

`KUBECONFIG` es el del paso 1. Si el VPS nuevo no reconoce la clave anterior, un par nuevo
**sólo de despliegue**, la pública en su propia línea de `authorized_keys` y restringida a
no abrir shell.

### 6. Devolver `clave-cifrado` al clúster nuevo, ANTES del primer `pulumi up`

```bash
# Contra el clúster NUEVO, con el túnel abierto:
kubectl create namespace kamayuk-<amb> --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f secretos-de-respaldo-<amb>.yaml
shred -u secretos-de-respaldo-<amb>.yaml   # o rm, pero que no se quede en el disco
```

**El orden no es de gusto.** `bootstrap-secretos.sh` corre dentro del flujo, justo antes
de `pulumi up`, y genera sólo lo que falta; si `clave-cifrado` ya está, no la toca. Si no
está, la genera, y en ese momento el histórico del bucket deja de ser legible **sin un
solo error**: el motor arrancará, archivará y respaldará tan contento, sobre una cadena
nueva.

Lo demás no hace falta reponerlo a mano: las 19 claves restantes se generan solas y los 17
espejos se copian de su origen en cada corrida.

### 7. El estado de Pulumi describe el nodo viejo

**Este es el paso que le faltaba a este runbook, y el que rompió la mudanza de `prod` el
2026-09-11.**

El estado del stack sigue describiendo los objetos del clúster anterior, y su proveedor de
Kubernetes lleva dentro **el kubeconfig del nodo viejo**. Con `refresh: true` —que está ahí
por otra cicatriz y es correcto—, Pulumi intenta leer cada uno de esos objetos contra un
clúster al que ya no llega, y el `up` muere antes de empezar:

```
kubernetes:helm.cattle.io/v1:HelmChartConfig sgtm-prod-sistema:kube-system/traefik refreshing
error: failed to read resource state due to unreachable cluster. If the cluster was deleted,
you can remove this resource from Pulumi state by rerunning the operation with the
PULUMI_K8S_DELETE_UNREACHABLE environment variable set to "true"
```

En la mudanza fueron **74 recursos errados** en el refresco, todos `sgtm-prod-*`, y **no
era la red ni el kubeconfig**: en la misma corrida `comprobar-lo-asignable.sh` había leído
el nodo nuevo y `capacidad --estricto` había dicho `cabe`.

> **⚠ Esa variable NO «limpia recursos de un clúster que ya no existe»: SUELTA DEL ESTADO
> los que el proveedor no pudo LEER.** No es lo mismo, y la diferencia se paga cuando el
> nodo viejo sigue encendido: los objetos quedan **huérfanos, vivos y sin nadie que los
> gestione**. En la mudanza del 2026-09-11 fueron 36, y `vmd120205` seguía sirviendo en su
> 80 y en su 443 — **y lo seguía haciendo el 2026-09-12**, medido: el 80 contesta `301` y
> el 443 contesta `404`. **En este runbook ese coste es cero**, porque el nodo se perdió de
> verdad: es justo lo que separa este documento del de la mudanza.

No es una línea fija del flujo, y no puede serlo: fija, cualquier fallo transitorio del
túnel soltaría estado **en silencio**, y el síntoma no sería un error sino un `up` en verde
que deja de gestionar lo que gestionaba. Cuelga de una entrada de `workflow_dispatch` que
hay que marcar a mano:

- `Actions → Infraestructura → Run workflow`, con **`soltar_recursos_inalcanzables`
  marcado**. La entrada nace en `false` y su descripción empieza por `PELIGRO`.
- Es **la corrida de la reconstrucción, y la única que debe llevarlo**.
- La corrida siguiente, **sin** marcarlo, tiene que salir verde. Si no, el estado no quedó
  limpio y hay que mirarlo antes de seguir — no volver a marcarlo por costumbre.

Que siga colgando de ahí lo vigila
[`nada-suelta-el-estado-en-silencio.test.ts`](../../../infra/verificaciones/nada-suelta-el-estado-en-silencio.test.ts),
que se pone rojo si alguien la desengancha, si la entrada nace marcada o si su descripción
deja de avisar.

### 8. Aplicar el stack

**Por el flujo, no desde un portátil.** `aplicar-prod` está detrás del *environment*
protegido `prod`: GitHub no deja avanzar sin que alguien lo apruebe, y registra quién. Es
lo que hace cierta la letra de ADR-0011 §6, y aplicar a mano la salta.

El trabajo hace, en orden: túnel SSH → kubeconfig → ¿hay brecha de capacidad declarada? →
`comprobar-lo-asignable.sh` → `yarn capacidad --estricto` → las etiquetas existen en el
registro → **`bootstrap-secretos.sh`** → las extensiones → los secretos del stack →
`pulumi up` → `verificar-el-ambiente.sh`.

> **Una espera larga entre «trabajo creado» y «trabajo arrancado» es la aprobación
> pendiente, no una corrida colgada** — se ha diagnosticado como avería más de una vez. Lo
> que sí es una corrida colgada es que el paso de Pulumi lleve minutos: un `up` sano
> termina en 15–25 s.

### 9. Restaurar el padrón

**Este paso es otro runbook entero, y es su continuación natural:**
[Restaurar a un punto en el tiempo](restaurar-a-un-punto-en-el-tiempo.md), que ya está
aquí y remedido —no hay que ir al repositorio archivo—. Este paso es su «caso A»: el PITR
físico del **clúster entero**.

El instante objetivo es **el más reciente posible**: aquí no hay un momento malo que
evitar, sólo minimizar cuánto se pierde dentro del RPO.

**Lo primero de ese runbook es su precondición 2, que es la 2 de aquí**: comprobar contra
el bucket que existe un respaldo **de este clúster**, comparando `SystemIdentifier`. Con
[#112](https://github.com/hneyra/infrastructure/issues/112) abierto, en `prod` eso **no se
cumple** y este paso no tiene de dónde tirar.

Tres cosas que conviene saber antes de necesitarlas:

- **Son seis bases sobre un solo `PGDATA`** —`identidad`, `rentas`, `catastro`,
  `normativa`, `caja` y `keycloak`—, así que el PITR las devuelve **todas o ninguna**. En
  una reconstrucción eso es lo que se quiere; no existe «restaurar sólo `rentas`».
- **`simulacro-de-restauracion.sh --contra-cluster` no sirve aquí.** Es lo único de este
  repositorio que apaga un `Deployment` real, restaura desde S3 y deja al motor entrar en
  recuperación, pero **se niega contra `prod` sin excepción** y su implementación
  ([`contra-cluster.sh`](../../../infra/respaldo/contra-cluster.sh)) lleva `kamayuk-stg`
  escrito. En `prod` los pasos se dan a mano, y ese guion es la referencia de qué hace cada
  uno.
- **La copia local de la autorización.** Restaurar el clúster entero es el caso que **no**
  la rompe: las seis bases vuelven al mismo instante y el registro, los acuses y las cuatro
  copias quedan coherentes. Por qué eso importa, y qué pasa en los otros dos casos, es §3
  de ese runbook.

Lo que aquel ensayo sí dejó medido, contra `stg` real: **359 segundos** desde apagar el
`Deployment` hasta que la reproducción del WAL llegó de verdad al objetivo
(`pg_get_wal_replay_pause_state() = 'paused'`, no sólo el socket respondiendo).

### 10. El orden de implantación: `identidad` primero

**Este paso es nuevo desde ADR-0039 etapa 5, y un ambiente de cero se lo encuentra sí o
sí.** La autorización —`usuario`, `grupo`, `miembro`, `permiso`— la escribe sólo
`identidad`; los cuatro satélites la reciben por su consumidor. Una implantación de un
satélite cuyo consumidor no traiga nada deja su base **sin una sola cuenta**: la
municipalidad queda dada de alta y nadie puede entrar.

El orden está escrito y comprobado en
[el orden de implantación](../../00-gobierno/identidad-5-el-orden-de-implantacion.md):
`identidad` primero, los cuatro después en cualquier orden.

**Y el manifiesto no lo declara.** Los once `Job` los crea un solo `ConfigGroup` sin
dependencias, así que Kubernetes los arranca a la vez; los cuatro dependientes llevan
`backoffLimit: 3`, que con el retroceso exponencial son **unos 70 segundos** — y en un
ambiente nuevo eso no alcanza. Un `Job` que agota su límite **no reintenta nunca**, y su
nombre lleva el `sha`, así que el siguiente `pulumi up` intenta actualizarlo y falla. Es
[`#65`](https://github.com/hneyra/infrastructure/issues/65), abierto.

Que esto pasa de verdad está medido en el propio `prod`, el 2026-09-11: el `CronJob`
consumidor de los cuatro satélites falló a las **22:35, 22:40 y 22:45 UTC** y empezó a
salir en verde después de que `kamayuk-identidad-implantacion` terminara a las
**22:47:30 UTC**.

Cómo se sale del atasco:

```bash
.github/diagnostico-del-namespace.sh --ambiente prod
kubectl -n kamayuk-<sistema>-prod delete job kamayuk-<sistema>-implantacion-<sha>
# y repetir el `up`: la implantacion es idempotente
```

Si lo que falló fue la migración y no el orden, el runbook es
[La migración falló a mitad](la-migracion-fallo-a-mitad.md), que cubre también la
implantación.

### 11. Verificar antes de mover el DNS

Con el clúster nuevo sirviendo en su IP, la sección de abajo entera **contra la IP directa
o por `port-forward`**, antes de que llegue un solo contribuyente.

### 12. Mover el DNS, y esperar el certificado

Cambiar el registro A/AAAA a la IP del nodo nuevo. **El DNS tiene que apuntar al nodo
nuevo ANTES de que Traefik pida el certificado**: ACME resuelve el desafío HTTP-01 por el
puerto 80 que abrió el paso 2. Y el límite de Let's Encrypt son **50 certificados por
dominio registrado y semana**, así que los reintentos se pagan.

Si `kamayuk:domain` cambió (paso 1), cambió también el emisor OIDC: todo token en
circulación deja de valer y hay que volver a entrar.

### 13. Apagar el nodo viejo, si quedó alguno

En una pérdida total no hay nada que apagar, y ese es el caso fácil. Si el nodo quedó
encendido —un VPS que «volvió» después de darlo por muerto—, apagarlo es lo que convierte
a los huérfanos del paso 7 en nada. Mientras siga en pie hay **dos clústeres sirviendo el
mismo producto, y sólo uno está gestionado**.

## Cómo se comprueba que terminó bien

**1 · El cortafuegos responde lo que tiene que responder, y nada más — desde fuera.**

```bash
nmap -Pn -p 22,80,443,5432,6443,10250 <vps-nuevo>
```

Abiertos 22, 80 y 443; cerrados 5432, 6443 y 10250. Medido contra `prod`
(164.68.125.44) el 2026-09-12, sin `nmap` a mano y con el equivalente:

```bash
for p in 22 80 443 5432 6443 10250; do
  timeout 6 bash -c "echo > /dev/tcp/<ip>/$p" 2>/dev/null \
    && echo "$p abierto" || echo "$p sin respuesta"
done
# 22 abierto · 80 abierto · 443 abierto · 5432, 6443 y 10250 sin respuesta
```

Comprobarlo **desde dentro** del VPS no demuestra nada, y el propio `cortafuegos.sh` lo
dice en su salida: `k3s` escucha en `0.0.0.0:6443` a propósito, así que desde dentro
saldría «abierto» con `ufw` apagado.

**2 · El ambiente se comprueba a sí mismo.**

```bash
infra/verificaciones/ambiente/verificar-el-ambiente.sh --ambiente prod
```

Mide **los cinco sistemas**: versión declarada contra versión desplegada contra
migraciones de la base, lo que sembró cada implantación, el aislamiento **como
`kamayuk_app` y no como superusuario** —un superusuario omite RLS incluso con `FORCE`, así
que comprobarlo con él pasa en verde sin verificar nada— y la escalera de identidad.

**3 · La escalera de identidad, contra el sistema real.**

| Petición | Respuesta esperada |
|---|---|
| Sin token | `401 NO_AUTENTICADO` |
| Token que este emisor no firmó | `401 NO_AUTENTICADO` |
| Token del realm | **no** `401` |

Medido el 2026-09-12 contra `kamayuk-identidad-web` de `prod`, por `port-forward` al
`Service` (puerto **80**, no 8080):

```
/actuator/health                       → 200
/identidad/api/v1/seguridad/usuarios   → 401 {"codigo":"NO_AUTENTICADO"}
… con Authorization: Bearer no.es.un.token → 401 {"codigo":"NO_AUTENTICADO"}
```

El último peldaño necesita un token, y aquí hay una trampa medida: el `Job` del realm crea
al `administrador` con su clave **temporal** (`clave-del-administrador` del `Secret`
`kamayuk-<amb>-keycloak`), y con una clave temporal el `password grant` contesta
`invalid_grant` / `Account is not fully set up` — que **no** es «clave incorrecta».
Cómo entrar y cómo fijarla está en
[Abrir la consola de administración de Keycloak](abrir-la-consola-de-keycloak.md).

**4 · El emisor público es el que los sistemas validan.**

```bash
curl -s https://<dominio>/keycloak/realms/kamayuk/.well-known/openid-configuration \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["issuer"])'
```

Medido: `https://vmd206041.contaboserver.net/keycloak/realms/kamayuk`. Y la consola de
administración **sigue sin existir desde internet** — `404`, igual que la raíz del
dominio, porque ningún sistema sirve un comodín ahí.

**5 · El respaldo del clúster nuevo ya está corriendo.** No basta con que el padrón se haya
restaurado una vez: si el archivado y el `CronJob` no quedan activos, el sistema
reconstruido nace ya sin RPO.

```bash
kubectl -n kamayuk-<amb> get cronjob kamayuk-<amb>-respaldo
kubectl -n kamayuk-<amb> exec deployment/kamayuk-<amb>-postgres -c postgres -- \
  psql -U postgres -Atc "SHOW archive_mode; SHOW archive_timeout;"
kubectl -n kamayuk-<amb> exec deployment/kamayuk-<amb>-postgres -c postgres -- \
  psql -U postgres -Atc "SELECT archived_count, failed_count, last_archived_time FROM pg_stat_archiver;"
```

Medido en `prod` el 2026-09-12: `0 6 * * *`, sin suspender, última corrida `Complete`;
`archive_mode = on`, `archive_timeout = 300`; **136 archivados, 0 fallidos**, último
`00000001000000000000008A` a las 09:10:17 UTC. La fila de auditoría se escribe en la base
`rentas` —`1|EXITOSO|…|s3://sgtm-prod-respaldos`—, y **una fila `FALLIDO` no se borra**:
queda como el rastro honesto de lo que costó llegar.

> **Y nada de lo anterior demuestra que haya un respaldo.** Los tres indicadores de arriba
> —`CronJob` sin suspender, `Job` en `Complete`, fila `EXITOSO`— están **todos en verde en
> `prod` hoy, y el bucket no tiene un solo respaldo de este clúster** (precondición 2,
> [#112](https://github.com/hneyra/infrastructure/issues/112)). La comprobación que de
> verdad cierra este runbook es la del bucket:
>
> ```bash
> kubectl -n kamayuk-<amb> exec deploy/kamayuk-<amb>-postgres -c postgres -- \
>   /opt/wal-g/wal-g backup-list --detail
> ```
>
> Tiene que aparecer **un respaldo posterior a la reconstrucción**, con el `hostname` de
> un pod del clúster nuevo, y su centinela con el `SystemIdentifier` que devuelve
> `pg_control_system()`. **Hasta que ese respaldo exista, el sistema reconstruido no se
> puede volver a restaurar** — y como el `CronJob` es diario, esa ventana dura hasta la
> mañana siguiente salvo que se lance a mano.

## Si no sale bien

| Síntoma | Qué hacer |
|---|---|
| `pulumi up` muere en el refresco con `failed to read resource state due to unreachable cluster` | Es el paso 7. **No** es la red ni el kubeconfig: compruébalo con `comprobar-lo-asignable.sh`, que sí llega al nodo. Relanzar `Infraestructura` a mano con `soltar_recursos_inalcanzables` |
| El `up` sale verde y deja de gestionar cosas que gestionaba | Alguien dejó `PULUMI_K8S_DELETE_UNREACHABLE` fija, o marcó la entrada dos veces. La corrida siguiente **sin** marcarla tiene que salir verde; si no, el estado no quedó limpio |
| `bootstrap-secretos.sh` dice «el API server no contesta» | No es un fallo de secretos. Es el primer guion del despliegue que habla con el clúster, así que cualquier problema del API sale con su nombre. Mirar la presión de CPU del nodo (`/proc/pressure/cpu`), el túnel (`kubectl cluster-info`) y k3s, en ese orden |
| Los `Job` de los satélites en `BackoffLimitExceeded` | Es [#65](https://github.com/hneyra/infrastructure/issues/65) y el paso 10. Borrar el `Job` agotado —su nombre lleva el `sha`, así que mientras exista el proveedor intenta **actualizarlo**— e implantar `identidad` primero |
| Un satélite implanta en verde y nadie puede entrar | Le faltó el consumidor, o el orden. Los tres mensajes que distinguen las tres causas están en [el orden de implantación](../../00-gobierno/identidad-5-el-orden-de-implantacion.md) |
| El túnel SSH no conecta | La clave pública nueva no llegó a `authorized_keys`, o el paso 2 no dejó pasar el 22. En ese orden |
| `nmap` muestra 5432 o 6443 abiertos | `cortafuegos.sh` no se ejecutó, o se ejecutó antes de que `ufw` estuviera instalado. Repetir el paso 2 **antes de seguir**: con esos puertos abiertos no hay reconstrucción que valga |
| El certificado no se emite | El DNS todavía no apunta al nodo nuevo, o el 80 no es de Traefik en ese nodo. ACME resuelve por HTTP-01, y los reintentos consumen la cuota semanal |
| Se restauró y el padrón está vacío | Comprobar que el respaldo se leyó con la clave **vieja** (paso 0 y 6). Un `clave-cifrado` nuevo no da un error de permisos: da una cadena nueva, en verde |
| `backup-list` lista respaldos pero ninguno restaura | Comparar el `SystemIdentifier` del centinela con `pg_control_system()`. Si difieren, **son de otro clúster** compartiendo prefijo: precondición 2 y [#112](https://github.com/hneyra/infrastructure/issues/112) |
| El `Job` de respaldo dice `EXITOSO` y el bucket no gana nada | Es [#112](https://github.com/hneyra/infrastructure/issues/112). `EXITOSO` sólo afirma que `backup-push` salió con 0; la retención corre después y su resultado se descarta. Se mira `backup-list`, no la tabla `respaldo` |

## Estado del ensayo

**El camino principal de este runbook NO está ensayado, y no es un olvido.** Ensayarlo
entero exige destruir el nodo que sostiene el ambiente, y ensayar «perder el nodo» dentro
del nodo que se pierde no es ensayarlo. Lo que hay es esto, y conviene leer qué cubre cada
pieza:

### Y lo primero que hay que decir: hoy `prod` no se podría reconstruir

**Medido el 2026-09-12, no deducido**, y por eso está en la cabecera y en la precondición
2. `wal-g backup-list --detail` da **siete** respaldos, del 2026-08-30 al 2026-09-05, los
siete con `hostname` `sgtm-prod-respaldo-*` y `SystemIdentifier` **7678467191030263850**;
el clúster que corre arrancó el **2026-09-11 21:44:04 UTC** con
**7684396738591203366**. **No hay ni un respaldo del clúster de hoy**, y el WAL que los
siete viejos necesitarían **ya está sobrescrito**: los 62 segmentos de `wal_005/` están
fechados el 2026-09-12, y del clúster viejo sólo quedan siete etiquetas `.backup.lz4` de
~300 bytes. Mientras tanto el `Job` diario termina `Complete` diciendo «Respaldo #1
EXITOSO» y `pg_stat_archiver` da 136 archivados y **0 fallidos**.

O sea: **todos los indicadores en verde y nada que restaurar.** Es
[#112](https://github.com/hneyra/infrastructure/issues/112), y no lo cierra este
documento — lo que hace este documento es que no se descubra el día que haga falta.

La causa es la misma que anota el runbook hermano: la
[mudanza de nodo](../../00-gobierno/mudar-un-ambiente-de-nodo.md) levantó un clúster nuevo
y **su procedimiento no tiene ningún paso sobre el prefijo de respaldos**. Dos clústeres
sobre un prefijo es la clase de defecto que no pone nada rojo.

**Ejecutado de verdad, 2026-09-11, contra el nodo nuevo de `prod` (`vmd206041`).** No fue
una reconstrucción sino una mudanza —el nodo viejo seguía en pie—, pero los pasos **1 a 5
y 8** son los mismos y se ejecutaron: aprovisionar, `cortafuegos.sh`,
`reservar-recursos-del-nodo.sh`, medir el nodo y escribir lo medido, las credenciales de
los dos *environments*, y el stack entero desplegado sobre un clúster **vacío**. El paso 7
salió del fallo de esa misma corrida, que es por lo que existe. Lo que se ve hoy de aquel
resultado, remedido el 2026-09-12: los seis espacios de nombres creados a las 20:44:25 UTC,
**14 `Deployment` en marcha**, los `Job` de migración e implantación de los cinco sistemas
en `Complete`, el `Job` del realm en `Complete` con sus dos realms y sus seis cuentas de
servicio, y el `CronJob` de respaldo con una corrida en verde.

**Ejecutado antes, 2026-08-24, y sigue valiendo aunque las cifras hayan cambiado.** Los
pasos 1–2 contra una VPS nueva de otro proveedor (AWS EC2, levantada para eso y destruida
al terminar): k3s nativo sin nada que ajustar y `cortafuegos.sh` sobre un sistema operativo
que nunca había tenido `ufw`, confirmado **desde fuera**. Y el paso 9 contra `stg` real:
**359 s** hasta el objetivo del PITR. De aquel ensayo salieron catorce defectos de
infraestructura que ninguna revisión de código había visto — el valor de ejecutar, no de
revisar.

**Medido el 2026-09-12 en `prod` para este documento** (sólo lecturas, sin escribir nada):
la versión de k3s (`v1.36.4+k3s1`, Ubuntu 26.04.1 LTS) y la capacidad y lo asignable del
nodo (**6 CPU / 12242280Ki** y **5 CPU / 10145128Ki**); la clase de almacenamiento y la
afinidad de los cuatro `PersistentVolume`; el inventario de secretos —**nombres de claves,
nunca valores, ni longitudes ni huellas**: `clave-cifrado` y `clave-respaldo` en
`kamayuk-prod-postgres-respaldo`, `access-key-id` y `secret-access-key` en
`…-credenciales`—; `wal-g backup-list --detail`, `st ls basebackups_005/`,
`st ls wal_005/` y `st cat` de dos centinelas; `pg_control_system()` y
`pg_postmaster_start_time()`; `pg_stat_archiver` y los tres ajustes del archivado; el
`CronJob`, su `Job` y su registro; la fila de la tabla `respaldo`; los dos primeros
peldaños de la escalera de identidad; el emisor OIDC y el 404 de la consola; los seis
puertos desde fuera (22, 80 y 443 abiertos; 5432, 6443 y 10250 sin respuesta); y que el
nodo viejo `vmd120205` **sigue encendido** (80 → `301`, 443 → `404`).

**Lo que NO se ensayó, y por qué.**

| Paso | Por qué no |
|---|---|
| 0 · sacar los secretos del clúster viejo | Nunca se ha hecho en una pérdida real. Y **hoy `clave-cifrado` no está copiada fuera del clúster**: si el nodo se pierde de golpe, el histórico de `sgtm-prod-respaldos` es ilegible. Es el hueco más grande que deja este runbook, y no se cierra escribiéndolo |
| 6 · devolver la clave antes del primer `up` | Se deduce de cómo funciona `bootstrap-secretos.sh` —genera sólo lo que falta— y de que `simulacro-de-restauracion.sh` demuestra en cada PR que una clave equivocada no restaura. **Las dos mitades están medidas; la secuencia entera no** |
| 7 · con el nodo de verdad perdido | Lo medido es con el nodo viejo **encendido**, que es el caso caro. Con el nodo muerto el resultado debería ser mejor —no quedan huérfanos—, y «debería» es exactamente lo que no se afirma aquí |
| 9 · restaurar `prod` | `--contra-cluster` se niega contra `prod` a propósito: es destructivo sobre el volumen en marcha. Lo que hay medido es `stg`. **Y hoy no habría desde dónde**: #112 |
| Que `clave-cifrado` descifre el histórico anterior a la mudanza | **No se midió a propósito**: exige un `backup-fetch`, que escribe. Con dos clústeres sobre un prefijo es parte de lo que hay que resolver antes de volver a confiar en ese bucket |
| 11–13 · DNS, certificado y apagar el nodo viejo | El nodo viejo de la mudanza **sigue en pie el 2026-09-12** (80 → `301`, 443 → `404`), así que el paso 13 ni siquiera se ha completado en la mudanza que lo motivó |
| El RTO de 4 h | No se ha cronometrado ninguna reconstrucción completa. Lo único con reloj son los 359 s del PITR de `stg` y el despliegue del stack sobre un clúster vacío |

Lo que sí está verificado en piezas, sin VPS real y en cada PR: que `bootstrap-secretos.sh`
genere lo que falta sin repetir ninguna clave y sin cambiar nada al correrlo dos veces; el
ciclo de respaldo y restauración contra un motor real; los manifiestos completos sin Pulumi
ni nodo; y que ningún paso de la liberación invoque Pulumi.

## Documentos relacionados

[Restaurar a un punto en el tiempo](restaurar-a-un-punto-en-el-tiempo.md) (**el paso 9**, y
su continuación natural) ·
[Mudar un ambiente de nodo](../../00-gobierno/mudar-un-ambiente-de-nodo.md) (el otro caso,
y el paso 7) ·
[El disco del nodo se llenó](el-disco-del-nodo-se-lleno.md) (el otro síntoma, y ese primero) ·
[La migración falló a mitad](la-migracion-fallo-a-mitad.md) (cuando lo que falla es la
migración o la implantación, paso 10) ·
[Mantenimiento del VPS](mantenimiento-del-vps.md) (§4, el registro de la reserva del paso 3) ·
[Abrir la consola de administración de Keycloak](abrir-la-consola-de-keycloak.md) ·
[El orden de implantación](../../00-gobierno/identidad-5-el-orden-de-implantacion.md) ·
[ADR-0011](../../30-arquitectura/adr/ADR-0011-infraestructura-como-codigo.md) (la
infraestructura como código, y la aprobación de `prod`) ·
[ADR-0031](../../30-arquitectura/adr/ADR-0031-infraestructura-comun-y-propia.md) (por qué
hay seis espacios de nombres) ·
[ADR-0039](../../30-arquitectura/adr/ADR-0039-la-identidad-es-un-sistema.md) (por qué
`identidad` se implanta primero) ·
[`infra/README.md`](../../../infra/README.md) §«Cómo llegar a un VPS real» ·
[`cortafuegos.sh`](../../../infra/vps/cortafuegos.sh) ·
[`reservar-recursos-del-nodo.sh`](../../../infra/vps/reservar-recursos-del-nodo.sh) ·
[`comprobar-lo-asignable.sh`](../../../infra/vps/comprobar-lo-asignable.sh) ·
[`bootstrap-secretos.sh`](../../../infra/secretos/bootstrap-secretos.sh) ·
[`simulacro-de-restauracion.sh`](../../../infra/respaldo/simulacro-de-restauracion.sh) ·
[`verificar-el-ambiente.sh`](../../../infra/verificaciones/ambiente/verificar-el-ambiente.sh) ·
[`nada-suelta-el-estado-en-silencio.test.ts`](../../../infra/verificaciones/nada-suelta-el-estado-en-silencio.test.ts)
