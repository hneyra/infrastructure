# Runbook — Restaurar a un punto en el tiempo

| Campo | Valor |
|---|---|
| Cuándo | Borrado accidental, corrupción de datos, o el primer paso de una reconstrucción completa |
| Qué cubre | El PITR físico de wal-g, que restaura **el clúster entero** — las seis bases a la vez. Volver **una sola** base atrás es otro mecanismo: [`C-11`](../../00-gobierno/C-11-restauracion-logica.md) |
| RTO objetivo | Parte del RTO de 4 horas de RNF-077 (`INF-01` §5, todavía en el repositorio archivo) |
| RPO objetivo | 5 minutos (RNF-076). Medido en `prod`: `archive_timeout = 300` |
| Estado del ensayo | **El camino principal se entrega SIN ENSAYAR, y con un impedimento medido delante: hoy `prod` NO se puede restaurar.** Lo inocuo se ejecutó entero contra `prod` real (`vmd206041`, 2026-09-12); nada destructivo se tocó. Ver «Estado del ensayo» |

> **Este documento vivía en el repositorio archivo `sgtm` y sus comandos estaban
> pre-renombrado** (`kubectl -n sgtm-<amb>`, `sgtm_owner`, base `sgtm`, deployment
> `sgtm-<amb>-aplicacion`). Copiados al pie de la letra fallaban con
> `namespaces "sgtm-prod" not found` en el primer comando, sin mencionar el renombrado. Se
> trajo y se remidió entero ([#100](https://github.com/hneyra/infrastructure/issues/100),
> [#105](https://github.com/hneyra/infrastructure/issues/105)).
>
> **Y se escribió para UNA base cuando hoy son cinco más Keycloak.** Casi todo lo que
> decía sobre «restaurar el padrón» cambió de significado con el corte y con
> [ADR-0039](../../30-arquitectura/adr/ADR-0039-la-identidad-es-un-sistema.md); lo que no
> decía en absoluto es qué le pasa a la copia local de la autorización, que es §3 de aquí.

## Síntoma

Alguien borró filas que no debía, una migración corrompió datos, o hace falta volver un
padrón a como estaba antes de un instante conocido. **No** es el síntoma de «el nodo se
perdió entero» — para eso va primero
[Reconstruir el VPS desde cero](reconstruir-el-vps-desde-cero.md), y este runbook es su paso 5. Si lo que se está haciendo es mover un
ambiente de nodo, el procedimiento es
[Mudar un ambiente de nodo](../../00-gobierno/mudar-un-ambiente-de-nodo.md) y su paso 1
manda aquí sólo si la base vieja tiene datos.

## 0. Antes de leer nada más: qué restaura esto, y qué no

**Un motor, seis bases, un solo `PGDATA`.** Medido el 2026-09-12 en `prod`: el
`Deployment` es `kamayuk-prod-postgres` (contenedor `postgres`,
`PGDATA=/var/lib/postgresql/data/pgdata`) y los cinco sistemas apuntan todos al mismo
sitio —`jdbc:postgresql://kamayuk-prod-postgres.kamayuk-prod:5432/<base>`—:

| Base | Tamaño medido | Quién la usa |
|---|---:|---|
| `identidad` | 9 580 kB | el dueño de la autorización, y el buzón |
| `rentas` | 16 MB | `rentas`, **y la tabla `respaldo`** (`BASE_DEL_PADRON`, [`infra/bases.sh`](../../../infra/bases.sh)) |
| `catastro` | 19 MB | `catastro` |
| `normativa` | 9 180 kB | `normativa` |
| `caja` | 9 756 kB | `caja` |
| `keycloak` | — | el emisor de tokens |

**`recovery_target_time` es del clúster, no de una base.** wal-g copia bloques de
`PGDATA`, y `PGDATA` es uno. **No existe forma de llevar `rentas` a ayer con este
mecanismo dejando a las otras cinco en hoy**: o vuelven las seis, o no vuelve ninguna. El
runbook original no tenía que decirlo porque había una sola base; hoy es la primera
decisión del procedimiento.

De ahí salen dos casos que **no** son el mismo trabajo:

| Caso | Herramienta | Qué cuesta |
|---|---|---|
| **A · Volver el clúster entero a un instante** | este runbook | Vuelven las seis bases y Keycloak. Se pierde todo lo escrito después de ese instante **en los cinco sistemas**, no sólo en el que tuvo el incidente |
| **B · Volver UNA base, o unas tablas, dejando las demás** | la restauración **lógica**: [`C-11`](../../00-gobierno/C-11-restauracion-logica.md) y [`simulacro-de-restauracion-logica.sh`](../../../infra/respaldo/simulacro-de-restauracion-logica.sh) | Es `pg_dump`/`pg_restore`, con las pérdidas que C-11 §3 declara objeto a objeto. **Y abre el problema de §3**, que el caso A no tiene |

El caso A es el que menos daño hace a la autorización, y §3 explica por qué. Si el
incidente cabe en el caso A, elígelo.

## 1. Precondiciones

1. **Un instante objetivo claro, en UTC.** «Antes de la escritura mala» no basta: hace
   falta el segundo. Se busca en `auditoria` — **es una tabla particionada por
   `ejercicio`, así que se consulta la padre y no `auditoria_<ejercicio>`, y su columna es
   `fecha`, no `fecha_hora`** (las dos cosas cambiaron desde el texto original; medido en
   las cinco bases). La regla 4 del [`CLAUDE.md`](../../../CLAUDE.md) garantiza que la
   escritura mala sigue ahí con su fecha: nada se borra.

2. **Un respaldo base anterior al instante objetivo, y el WAL sucesivo, legibles.** Se
   comprueba **antes de tocar nada**, y **no se comprueba mirando la tabla `respaldo`**:

   ```bash
   kubectl -n kamayuk-<amb> exec deploy/kamayuk-<amb>-postgres -c postgres -- \
     /opt/wal-g/wal-g backup-list --detail
   ```

   > **«`respaldo` EXITOSO» y «hay un respaldo en el bucket» no son la misma afirmación, y
   > el 2026-09-12 en `prod` eran distintas.** La tabla decía `#1 EXITOSO` a las
   > 04:00:22Z, el `Job` terminó `Complete` y su registro decía «Respaldo #1 EXITOSO»; y en
   > `basebackups_005/` **no hay ningún respaldo de ese día**. La precondición original
   > confiaba en esa tabla y hoy habría pasado en verde con nada que restaurar. Ver §6.
   >
   > Y la tabla vive **sólo en `rentas`**: las otras cuatro bases tienen la tabla y está
   > **vacía** (medido: 1 fila en `rentas`, 0 en las otras cuatro). Leerla en la base
   > equivocada se ve exactamente igual que «el respaldo nunca corrió».

   Lo que hay que leer de esa salida son **tres** campos, no uno: `modified` (que sea
   anterior al instante objetivo), `hostname` (de quién es ese respaldo) y
   `SystemIdentifier` del centinela, que tiene que ser **el del clúster que se va a
   restaurar**:

   ```bash
   kubectl -n kamayuk-<amb> exec deploy/kamayuk-<amb>-postgres -c postgres -- \
     psql -U kamayuk_owner -d postgres -Atc 'select system_identifier from pg_control_system();'

   kubectl -n kamayuk-<amb> exec deploy/kamayuk-<amb>-postgres -c postgres -- \
     /opt/wal-g/wal-g st cat basebackups_005/<nombre-del-respaldo>_backup_stop_sentinel.json
   ```

   **Si no coinciden, ese respaldo es de otro clúster y no sirve**, aunque `backup-list` lo
   liste y aunque el prefijo sea el correcto. Es el estado en que está `prod` hoy (§6).

3. **El archivado continuo está sano**, o el WAL entre el respaldo base y el instante
   objetivo no está completo:

   ```bash
   kubectl -n kamayuk-<amb> exec deploy/kamayuk-<amb>-postgres -c postgres -- \
     psql -U kamayuk_owner -d postgres -xc \
     'select archived_count, last_archived_wal, last_archived_time, failed_count, last_failed_time from pg_stat_archiver;'
   ```

   `failed_count` tiene que ser **0**. Medido en `prod` el 2026-09-12: 130 archivados,
   **0 fallidos**, último `000000010000000000000084` a las 08:40:17Z.

4. **Una ventana de mantenimiento anunciada** (RNF-078): restaurar corta el servicio de
   **los cinco sistemas y del emisor**, no de uno.

5. **La clave de cifrado de wal-g**, y aquí va el aviso que no se puede poner en otro
   sitio:

   > **`clave-cifrado` es lo único irrecuperable de todo este procedimiento.** Es
   > `WALG_LIBSODIUM_KEY`, y en `prod` vive en el `Secret`
   > `kamayuk-<amb>-postgres-respaldo`, clave `clave-cifrado` (comprobada presente el
   > 2026-09-12: 44 bytes, `sha256` `b7a7ac1634825c81…`). **Sin ella el histórico entero
   > del bucket es ilegible y no hay vuelta atrás**: no es un respaldo que se rehace, es
   > todo lo que hay. Rotarla no vuelve a cifrar lo ya escrito, así que si el respaldo
   > objetivo es más viejo que la última rotación hace falta **la clave anterior**, y
   > guardarla es parte de rotarla.
   >
   > Se lee cuando se necesita y **no se pega en un chat, un ticket ni un mensaje**. Para
   > comprobar que está, basta con su longitud o su huella; nunca su valor.

6. **Los buckets se llaman `sgtm-{stg,prod}-respaldos` y NO se renombran.** Es la
   excepción declarada al renombrado: **son el nombre de cosas que existen**. Cambiarlos en
   un texto manda los respaldos a un sitio que no existe, y eso **no da error el día que se
   cambia** — da error el día que hay que restaurar. Medido el 2026-09-12: el `CronJob`
   lleva `WALG_S3_PREFIX=s3://sgtm-prod-respaldos` y el motor el mismo valor.

## 2. Pasos (caso A: el clúster entero)

> **`--contra-cluster` no sirve aquí, y es a propósito.**
> [`simulacro-de-restauracion.sh`](../../../infra/respaldo/simulacro-de-restauracion.sh)
> exige `--ambiente stg` y se niega contra `prod` «sin excepción, es destructivo sobre el
> volumen en marcha»; y [`contra-cluster.sh`](../../../infra/respaldo/contra-cluster.sh)
> lleva `NAMESPACE=kamayuk-stg` escrito. El texto original mandaba
> `--ambiente <amb> --contra-cluster` y eso **es falso para `prod`**. En `prod` los pasos
> se dan a mano, y ese guion es la referencia de qué hace cada uno.

### 1. Apagar a quien escribe — y los consumidores PRIMERO

El orden importa y la primera línea es la que el runbook original no tenía. Ver §3 para
por qué.

```bash
# 1a. Los cuatro consumidores de identidad, ANTES que nada
for s in rentas catastro normativa caja; do
  kubectl -n kamayuk-$s-<amb> patch cronjob kamayuk-$s-consumidor-de-identidad \
    -p '{"spec":{"suspend":true}}'
done

# 1b. Los cinco backends y las dos interfaces
for s in identidad rentas catastro normativa caja; do
  kubectl -n kamayuk-$s-<amb> scale deployment --all --replicas=0
done
```

### 2. Confirmar el instante objetivo contra la auditoría

Es la última oportunidad de comprobar que el segundo es el correcto, y se hace **en la
base del sistema que tuvo el incidente**:

```bash
kubectl -n kamayuk-<amb> exec deploy/kamayuk-<amb>-postgres -c postgres -- \
  psql -U kamayuk_owner -d <base> -c \
  "SET app.municipalidad_id = '<id>'; \
   SELECT id, tabla, operacion, usuario_id, fecha, observacion FROM auditoria \
    WHERE fecha > '<instante-objetivo>' ORDER BY fecha LIMIT 20"
```

**El `SET` no es opcional.** `auditoria` tiene RLS **forzada**, así que sin él el motor no
contesta «no ves nada»: contesta
`ERROR: unrecognized configuration parameter "app.municipalidad_id"`, que se lee como un
problema de la consulta y no como la política haciendo su trabajo. El GUC es
`app.municipalidad_id` y ningún otro nombre.

### 3. Detener PostgreSQL y preservar el volumen actual

Sin borrarlo: es la red de seguridad si el instante objetivo resulta ser el equivocado.

```bash
kubectl -n kamayuk-<amb> scale deployment/kamayuk-<amb>-postgres --replicas=0
kubectl -n kamayuk-<amb> wait --for=delete pod -l app=kamayuk-<amb>-postgres --timeout=120s
```

Y en un pod temporal con el mismo `PersistentVolumeClaim` montado en lectura-escritura,
apartar `PGDATA` con otro nombre (`pgdata.antes-de-restaurar`) — **`mv`, nunca `rm`**.

### 4. Restaurar el respaldo base y fijar el punto de recuperación

En ese mismo pod temporal, con las variables de wal-g del `CronJob` y `WALG_LIBSODIUM_KEY`
puesta: `wal-g backup-fetch` del respaldo elegido, y después `recovery.signal` más
`recovery_target_time` en `postgresql.auto.conf`. Los ocho pasos exactos —incluido por qué
el pod temporal **no arranca el motor** y devuelve el `Deployment` a `--replicas=1` con su
propio `command`— están en el docstring de `simulacro-de-restauracion.sh` §`--contra-cluster`
y en [`contra-cluster.sh`](../../../infra/respaldo/contra-cluster.sh), que es la
implementación que ya se ejecutó contra `stg`.

### 5. Arrancar el motor y esperar a que la reproducción llegue

```bash
kubectl -n kamayuk-<amb> scale deployment/kamayuk-<amb>-postgres --replicas=1
kubectl -n kamayuk-<amb> exec deploy/kamayuk-<amb>-postgres -c postgres -- \
  psql -U postgres -Atc "select pg_get_wal_replay_pause_state()"   # 'paused'
```

**Se espera a `paused`, no a que el socket conteste.** El motor admite conexiones mucho
antes de haber reproducido hasta el objetivo: preguntar antes da un sistema que parece
restaurado y está a medias. Promocionar es `pg_wal_replay_resume()`, y entonces
`pg_is_in_recovery()` tiene que devolver `f`.

### 6. Reconstruir la copia local de la autorización

Sólo si el caso es B, o si algo quedó desalineado. Es §3 entero, y va **antes** de
reanudar nada.

### 7. Reanudar

Los cinco backends, las dos interfaces, y **los cuatro consumidores de uno en uno**,
leyendo lo que cada uno deja escrito antes de encender el siguiente.

## 3. La copia local de la autorización — lo que este runbook no decía

Desde [ADR-0039](../../30-arquitectura/adr/ADR-0039-la-identidad-es-un-sistema.md), quién
puede hacer qué lo **escribe** sólo `identidad`, y los otros cuatro **autorizan contra una
copia local** que rellenan ellos mismos desde el buzón. La mecánica de operación corriente
—la ventana, las guardas, cómo se mira— está en
[La ventana de la copia local](../../00-gobierno/identidad-4-la-ventana-de-la-copia-local.md)
y no se repite aquí. Lo que falta allí, y es lo que sigue, es **qué le pasa a esa copia
cuando se restaura**.

### 3.1 · Dónde vive cada mitad, que es lo que hace el problema

Medido el 2026-09-12 en `prod`:

| Pieza | Base | Qué dice |
|---|---|---|
| `identidad_evento` | **`identidad`** | El registro. **333 filas, ids 1..333**, de 21:44:27 a 22:47:28 del 2026-09-11. Inmutable, y su `cuerpo` lleva **la fila entera tal como quedó** |
| `identidad_evento_acuse` | **`identidad`** | **El cursor de cada consumidor, y vive en la base del dueño — no en la del consumidor.** Medido: `caja` 333, `catastro` 333, `normativa` 333, `rentas` 329 |
| `identidad_evento_aplicado` | cada satélite | Lo que ESE satélite aplicó, para ser idempotente. Medido: `rentas` 329, los otros tres 333 |
| `identidad_evento_muerto` | cada satélite | Lo que no se pudo aplicar nunca. Medido: **0 en los cuatro** |
| `usuario`, `grupo`, `miembro`, `permiso` | las cinco | En `identidad` el original; en los cuatro, la copia. Medido: los cuatro con `usuario=5`, `grupo=2`, `miembro=5`, y `permiso` **130 / 16 / 1 / 3** — cada uno sólo lo de su propio catálogo |

**Ese reparto es el problema entero en una línea: el cursor y los datos que gobierna están
en bases distintas.** Restaurar una de las dos y no la otra las separa, y nada lo dice.

### 3.2 · Los tres casos, y cuál elegir

**A · Se restaura el clúster entero (§2).** Las seis bases vuelven al mismo instante: el
registro, los acuses, lo aplicado y las cuatro copias son coherentes en T. **No hay nada
que hacer con la copia local**, y ésa es la razón principal para preferir este caso sobre
cualquier restauración parcial.

**B · Se restaura UN satélite hacia atrás** (por la vía lógica de C-11). Su copia y su
`identidad_evento_aplicado` vuelven juntos —están en la misma base—, pero **su acuse se
queda en `identidad` diciendo «entregado»**. `identidad` no volverá a servirle ni uno solo
de esos eventos. Resultado: ese satélite se queda **permanentemente corto**, autoriza con
ello, y **no hay ningún error**: su consumidor sigue corriendo cada cinco minutos y
diciendo que no queda nada pendiente.

**C · Se restaura `identidad` hacia atrás.** Registro, acuses y tablas vuelven juntos; los
cuatro satélites **conservan lo que aplicaron a partir de eventos que ya no existen**. No
hay evento de «olvida esto» y la regla 4 prohíbe borrar el original, así que **nada los
hace converger**: los cuatro conceden accesos que el dueño ya no conoce. Es literalmente
«dos respuestas a quién puede hacer esto», que es lo que ADR-0039 existe para que no pase.

### 3.3 · El procedimiento, y su orden

1. **Suspender los cuatro consumidores ANTES de tocar nada** (paso 1a de §2). Un consumidor
   que corre a mitad de la restauración acusa eventos que la copia recién restaurada ya no
   tiene aplicados, y convierte una divergencia reparable en una silenciosa.

2. **Restaurar.**

3. **Reconstruir, no parchear.** Lo que hace posible reconstruir está medido y hay que
   comprobarlo cada vez, porque el día que deje de ser cierto esto no funciona:
   `identidad_evento` es **completo desde el primer evento de la implantación**
   (`min(id) = 1`), es inmutable, y su cuerpo trae la fila entera. Como aplicar es un
   `upsert`, **reproducir el registro desde el evento 1 reconstruye la copia**.

   ```sql
   -- en la base identidad, con SET app.municipalidad_id puesto:
   SELECT min(id), max(id), count(*) FROM identidad_evento;   -- min tiene que ser 1
   ```

   - **Caso B** (se restauró un satélite): borrar **todos** sus acuses en
     `identidad_evento_acuse` —no sólo los posteriores a T— y su `identidad_evento_aplicado`,
     y dejar que su consumidor reproduzca desde el principio. El acuse es
     `(municipalidad_id, consumidor, evento_id)`, así que esto **no toca a los otros tres**.
   - **Caso C** (se restauró `identidad`): reproducir desde 1 **no basta**, porque no retira
     lo que los cuatro ya aplicaron de eventos que ya no existen. La copia hay que
     reconstruirla **desde vacío** en los cuatro, y eso es **una decisión, no un paso**:
     supone vaciar `usuario`, `grupo`, `miembro`, `permiso` y `identidad_evento_aplicado` en
     bases de producción. **Este runbook no lo prescribe**; dice lo que cuesta y que alguien
     con nombre tiene que decidirlo, y que la alternativa —dejarlo— es el defecto que
     ADR-0039 vino a cerrar.

4. **El orden entre sistemas es el de la implantación**
   ([`identidad-5`](../../00-gobierno/identidad-5-el-orden-de-implantacion.md)): `identidad`
   primero, los cuatro después. Un satélite que arranca antes de que `identidad` conteste se
   queda sin una sola cuenta y nadie puede entrar, ni quien acaba de restaurarlo.

5. **Reanudar los consumidores de uno en uno**, leyendo el registro de cada uno antes de
   encender el siguiente.

6. **Y Keycloak también volvió**, que es la mitad que no está en ninguna de estas cinco
   bases. Un PITR del clúster lleva la base `keycloak` al mismo instante: las personas
   creadas después de T desaparecen del emisor mientras su fila de `usuario` sigue en
   `identidad`, o al revés. Son las dos mitades de
   [§4 de «Abrir la consola de Keycloak»](abrir-la-consola-de-keycloak.md), y el realm lo
   repone el `Job` de la plataforma — **las personas no**, a propósito: el realm versionado
   no trae usuarios con contraseña.

## 4. Cómo se comprueba que terminó bien

**No** «la aplicación responde». Cuatro comprobaciones, contra el sistema restaurado.

**1 · El aislamiento se sostiene.** Conectando como `kamayuk_app`, **nunca** como
superusuario:

```bash
kubectl -n kamayuk-<amb> exec deploy/kamayuk-<amb>-postgres -c postgres -- \
  psql -U kamayuk_app -d identidad -Atc \
  "SET app.municipalidad_id = '<id-real>'; SELECT count(*) FROM usuario"
kubectl -n kamayuk-<amb> exec deploy/kamayuk-<amb>-postgres -c postgres -- \
  psql -U kamayuk_app -d identidad -Atc \
  "SET app.municipalidad_id = '999'; SELECT count(*) FROM usuario"
```

> **Esta comprobación cambió, y la medición es el motivo.** El texto original pedía **dos
> municipalidades sembradas** y comparar sus conteos; su propio ensayo de `stg` tuvo que
> sembrar una a mano para poder correrla. Medido el 2026-09-12, **`prod` tiene exactamente
> una** (`1:200105`) en las cinco bases, así que aquella comprobación exigiría **escribir en
> producción justo después de restaurarla**. La forma de arriba no escribe nada y afirma lo
> mismo: con la misma tabla y el mismo rol, el inquilino real da **5** y un inquilino que no
> existe da **0**. Si diera 5 las dos veces, la política no se está evaluando.

Y las seis tablas de `identidad` tienen que seguir con RLS **forzada** — medido:
`usuario`, `grupo`, `miembro`, `permiso`, `identidad_evento` e `identidad_evento_acuse`,
las seis con `relrowsecurity` y `relforcerowsecurity` en `t`:

```bash
kubectl -n kamayuk-<amb> exec deploy/kamayuk-<amb>-postgres -c postgres -- \
  psql -U kamayuk_owner -d identidad -c \
  "select relname, relrowsecurity, relforcerowsecurity from pg_class \
    where relname in ('usuario','grupo','miembro','permiso','identidad_evento','identidad_evento_acuse') and relkind='r'"
```

`force` en `f` significa que el propietario evade la política, y es la barrera número uno
de [ADR-0002](../../30-arquitectura/adr/ADR-0002-estrategia-multi-tenant.md).

> Las lecturas de este runbook van como `kamayuk_owner` y no como `kamayuk_readonly`
> porque, medido el 2026-09-12, **`kamayuk_readonly` es `NOLOGIN` en `prod`**:
> `FATAL: role "kamayuk_readonly" is not permitted to log in`.

**2 · Los cinco contestan lo mismo a «quién puede hacer qué».** Es la comprobación que
sustituye a la de la deuda del texto original, y la que de verdad dice si §3 salió bien:

```bash
for b in identidad rentas catastro normativa caja; do
  printf '%-10s ' "$b"
  kubectl -n kamayuk-<amb> exec deploy/kamayuk-<amb>-postgres -c postgres -- \
    psql -U kamayuk_owner -d $b -Atc \
    "SET app.municipalidad_id='<id>'; SELECT 'usuario='||(select count(*) from usuario) \
      ||' grupo='||(select count(*) from grupo)||' miembro='||(select count(*) from miembro)"
done
```

`usuario`, `grupo` y `miembro` tienen que **coincidir en los cinco**. `permiso` **no**: cada
satélite sólo aplica lo de su propio catálogo, y la cifra medida el 2026-09-12 es
`identidad` 162 · `rentas` 130 · `catastro` 16 · `caja` 3 · `normativa` 1.

**3 · La cola de cada consumidor deja de crecer.** No «es cero» — ver el aviso de §5:

```sql
-- en la base identidad, con SET app.municipalidad_id puesto
SELECT c.consumidor,
       (SELECT count(*) FROM identidad_evento e
         WHERE NOT EXISTS (SELECT 1 FROM identidad_evento_acuse a
                            WHERE a.municipalidad_id = e.municipalidad_id
                              AND a.consumidor = c.consumidor
                              AND a.evento_id = e.evento_id)) AS pendientes
  FROM (VALUES ('rentas'),('catastro'),('normativa'),('caja')) AS c(consumidor)
 ORDER BY 1;
```

Se mira **dos veces, separadas por más de cinco minutos**. Lo que tiene que pasar es que
baje o se quede igual; que suba es que ese consumidor no está aplicando.

**4 · El respaldo vuelve a correr, y llega.** Una restauración deja un clúster nuevo (§6):
hasta que el siguiente `CronJob` empuje un respaldo base **de este** `system_identifier`, el
sistema restaurado **no se puede volver a restaurar**. Se comprueba con `backup-list` y su
centinela, no con la tabla `respaldo`.

Si las cuatro pasan, se reanuda todo y se borra `pgdata.antes-de-restaurar` **sólo después
de que la ventanilla confirme que el padrón se ve correcto**, no en el mismo paso.

## 5. Si no sale bien

| Síntoma | Qué hacer |
|---|---|
| `pg_is_in_recovery()` sigue en `t` pasados varios minutos | El WAL no llegó al `recovery_target_time`. Revisar que el respaldo base elegido sea **anterior** al instante objetivo, y que los segmentos intermedios estén en `wal_005/` |
| `backup-list` lista respaldos pero ninguno restaura | Comparar `SystemIdentifier` del centinela con `pg_control_system()`. Si difieren, **son de otro clúster** y el prefijo está compartido: §6 |
| El conteo de la comprobación 1 es igual para el inquilino real y para `999` | RLS no quedó activa — **no reanudar nada**. Revisar `relforcerowsecurity` antes de seguir |
| La comprobación 2 no cuadra en `usuario`/`grupo`/`miembro` | La copia local quedó desalineada: §3.3, y **no** arreglarla escribiendo a mano en el satélite — eso crea el segundo escritor que la regla 12 prohíbe |
| `pendientes` no baja para un consumidor | Sus registros dicen por qué. Si dice «TODAVIA no se puede aplicar», es una dependencia que le falta; si dice **401**, su credencial no sobrevivió a la vuelta de Keycloak (§3.3 punto 6) |
| `pendientes` marca 4 en `rentas` y 0 en los otros tres | **Eso es anterior a cualquier restauración**, medido el 2026-09-12 — ver abajo. No es un síntoma de este procedimiento |
| El respaldo no se puede leer con la clave configurada | Probar con la clave **anterior** a la última rotación. Si tampoco, ese respaldo está perdido: buscar uno más antiguo y documentar la pérdida de RPO |

> **Los 4 pendientes de `rentas`, medidos el 2026-09-12 y ajenos a este runbook.** Son los
> eventos 129, 130, 132 y 133, los cuatro `PERMISO_FIJADO` sobre `rentas:usuarios`,
> `rentas:grupos`, `rentas:miembros` y `rentas:permisos` — las cuatro opciones que la etapa 4
> de ADR-0039 retiró del catálogo de `rentas`. Su consumidor los pospone en cada vuelta
> («esta copia no conoce a los dos todavía: la sentencia escribió 0 filas») y **ya está
> avisando**: «LA COPIA LOCAL DE LA AUTORIZACION NO AVANZA … 660 minuto(s)». `rentas` lleva
> 329 aplicados y **0 apartados**. Quien restaure tiene que saberlo para no atribuírselo.

## 6. Estado del ensayo

**El camino principal de este runbook se entrega SIN ENSAYAR, con todas las letras.** No se
restauró nada, no se borró nada, no se tocó wal-g más allá de sus lecturas. El motivo es que
**todo el procedimiento es destructivo**: apaga el motor de `prod`, mueve `PGDATA` y
sobrescribe el volumen de los cinco sistemas a la vez. Ensayarlo es una ventana de
mantenimiento anunciada, no una tarde de escritura, y contra `stg` —donde sí es ensayable—
lo ensaya `simulacro-de-restauracion.sh --contra-cluster`, que existe y ya se ejecutó.

**Lo que sí está ejecutado y medido, contra `prod` real (`vmd206041`, 2026-09-12), sólo
lecturas:** el inventario del motor y sus seis bases; `wal-g backup-list --detail`,
`st ls basebackups_005/`, `st ls wal_005/` y `st cat` del centinela; `pg_stat_archiver` y
los cuatro `pg_settings` del archivado; el `CronJob`, su `Job` y su registro; la tabla
`respaldo` en las cinco bases; el buzón, los acuses y las cuatro copias locales; la
auditoría; el aislamiento con `kamayuk_app`; y la presencia —por longitud y huella, nunca
por su valor— de las cuatro claves del respaldo.

### Y lo primero que hay que decir: hoy `prod` no se puede restaurar

**Medido, no deducido.** `wal-g backup-list` devuelve **7 respaldos**, el más reciente
`base_000000010000000000000082` del **2026-09-05T04:01:00Z**, todos con `hostname`
`sgtm-prod-respaldo-*` y, en su centinela, `SystemIdentifier` **7678467191030263850**. El
clúster que corre hoy arrancó el **2026-09-11 21:44:04** y su `system_identifier` es
**7684396738591203366**. Son clústeres distintos.

Y comparten prefijo **y línea de tiempo**. En `wal_005/` hay 65 objetos: los segmentos
`4D`..`84` están fechados el **2026-09-12** —son del clúster nuevo, sobrescribiendo los del
viejo, que se llamaban igual— y `85` y `86` todavía conservan sus fechas del 2026-09-05.
O sea que **el WAL que necesitarían esos 7 respaldos se está borrando solo**, uno cada cinco
minutos.

Del respaldo de hoy, que la tabla `respaldo` da por bueno, **no hay rastro en el bucket**:
`basebackups_005/` tiene siete centinelas y ninguno del 2026-09-12.

**La causa está escrita en otro documento y no la cierra éste.** La mudanza de nodo
([Mudar un ambiente de nodo](../../00-gobierno/mudar-un-ambiente-de-nodo.md)) levantó un
clúster nuevo y **su procedimiento no tiene ningún paso sobre el prefijo de respaldos**; su
paso 1 razonaba que `clave-cifrado` no era urgente porque protegería una base vacía. Ya no
lo está. Dos clústeres sobre un prefijo es la clase de defecto que **no pone nada rojo**:
el `CronJob` termina `Complete`, la fila dice `EXITOSO`, y la pantalla de RF-126 muestra un
respaldo verde. Sólo se ve mirando el bucket, que es lo que la precondición 2 de §1 pasa a
exigir.

### Lo que además caducó del texto original

| Afirmación original | Medido el 2026-09-12 |
|---|---|
| «restaurar el padrón», una base | **Seis bases sobre un `PGDATA`.** El PITR las restaura todas o ninguna |
| `--ambiente <amb> --contra-cluster` | El guion **se niega contra `prod`**; `contra-cluster.sh` lleva `kamayuk-stg` escrito |
| Precondición: mirar la tabla `respaldo` | Hoy diría `EXITOSO` sin nada que restaurar. Se mira **el bucket** |
| `auditoria_<ejercicio>`, columna `fecha_hora` | Tabla padre `auditoria` particionada por `ejercicio`, columna **`fecha`**, y con RLS forzada: sin `SET app.municipalidad_id` el error habla del parámetro, no de la política |
| Comprobación con **dos** municipalidades sembradas | `prod` tiene **una**. La comprobación pasa a ser inquilino real vs inquilino inexistente, y **no escribe nada** |
| Comprobación de la deuda por `/api/v1/consultas/deuda` | Es de `rentas` y de su repositorio; aquí la comprobación que dice si la restauración salió bien es **la de los cinco contestando lo mismo** (§4.2) |
| `sgtm-<amb>-aplicacion`, `sgtm_owner`, `sgtm-<amb>-postgres` | `kamayuk-<s>-<amb>/kamayuk-<s>-web` (y `-interfaz` en `rentas` y `caja`), `kamayuk_owner`, `deploy/kamayuk-<amb>-postgres` contenedor `postgres` |
| Nada sobre la copia local de la autorización | §3 entero. No existía cuando esto se escribió |

### El `CronJob`, medido

`kamayuk-prod-respaldo`, en `kamayuk-prod`. Horario `0 6 * * *` **sin `timeZone`**, y
medido su `lastScheduleTime` es **04:00:00Z**: la hora declarada **no es UTC** ni la de
Lima, la resuelve el controlador en la zona del nodo. Al juzgar si un respaldo es reciente
se comparan **marcas de tiempo**, nunca horas del día. Retención `delete retain 7`
(`RETENCION_DE_RESPALDOS_BASE` de
[`Respaldo.ts`](../../../infra/componentes/Respaldo.ts)), que **con WAL continuo entre
ellos es la ventana real de PITR**: siete días. Empuja como `kamayuk_respaldo` con
`PGDATABASE=postgres`, porque ese rol **no tiene `CONNECT` sobre ninguna base del producto**
a propósito
([`40-rol-de-respaldo.sh`](../../../infra/componentes/inicializacion/40-rol-de-respaldo.sh)),
y escribe su fila como `kamayuk_owner` en `rentas`. Monta el volumen del motor en
**`readOnly: true`**.

### Lo que este runbook todavía no tiene

- **Una sola ejecución del camino principal**, en ningún ambiente, desde que son cinco
  sistemas. La de `stg` del 2026-08-24 midió **359 segundos** con una base y unas pocas
  filas; esa cifra no dice nada del RTO de RNF-077 ni del tiempo con seis bases.
- **El caso B ensayado**: restaurar una base por la vía lógica y reconstruir su copia local
  con §3.3. Es lo que hace falta para que §3 deje de ser un razonamiento y pase a ser una
  medición.
- **La decisión del caso C**: quién autoriza vaciar la copia de los cuatro satélites, y con
  qué guion. Hoy no hay ninguno, y escribirlo sin que alguien decida sería peor.
- **Comprobar que `clave-cifrado` descifra el histórico anterior a la mudanza.** No se midió
  a propósito: exige un `backup-fetch`, que escribe. Con dos clústeres sobre un prefijo, es
  parte de lo que hay que resolver antes de volver a confiar en ese bucket.

## Documentos relacionados

[ADR-0002](../../30-arquitectura/adr/ADR-0002-estrategia-multi-tenant.md) (RLS, el GUC y la
barrera número uno) ·
[ADR-0004](../../30-arquitectura/adr/ADR-0004-almacenamiento-de-datos.md) (PostgreSQL y el
particionado por ejercicio) ·
[ADR-0011](../../30-arquitectura/adr/ADR-0011-infraestructura-como-codigo.md) §6 (la deriva
manual que deja un `pulumi up`) ·
[ADR-0028](../../30-arquitectura/adr/ADR-0028-el-tenant-no-cruza-por-http.md) §3 (el buzón) ·
[ADR-0039](../../30-arquitectura/adr/ADR-0039-la-identidad-es-un-sistema.md) (por qué la
autorización tiene dueño) ·
[C-11 — La restauración lógica](../../00-gobierno/C-11-restauracion-logica.md) (el caso B) ·
[La ventana de la copia local](../../00-gobierno/identidad-4-la-ventana-de-la-copia-local.md) ·
[El orden de implantación](../../00-gobierno/identidad-5-el-orden-de-implantacion.md) ·
[Mudar un ambiente de nodo](../../00-gobierno/mudar-un-ambiente-de-nodo.md) ·
[Abrir la consola de Keycloak](abrir-la-consola-de-keycloak.md) ·
[`simulacro-de-restauracion.sh`](../../../infra/respaldo/simulacro-de-restauracion.sh) ·
[`contra-cluster.sh`](../../../infra/respaldo/contra-cluster.sh) ·
[`infra/bases.sh`](../../../infra/bases.sh) ·
[`Respaldo.ts`](../../../infra/componentes/Respaldo.ts)
