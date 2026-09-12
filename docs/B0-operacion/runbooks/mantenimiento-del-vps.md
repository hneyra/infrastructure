# Runbook — Mantenimiento del VPS

| Campo | Valor |
|---|---|
| Cuándo | Actualización del sistema operativo, reinicio del nodo, redimensionar disco/CPU/memoria, aplicar la reserva de recursos del nodo, certificado que no renovó solo |
| Qué cubre | Las cinco operaciones sobre el nodo. El disco lleno y la restauración son otros runbooks — ver «Documentos relacionados» |
| Regla que gobierna todo esto | **Toda ventana se anuncia antes de abrirse** (RNF-078). Con un solo nodo no hay a dónde mover la carga mientras dura: lo dice [ADR-0011](../../30-arquitectura/adr/ADR-0011-infraestructura-como-codigo.md) §Consecuencias, «no tiene atajo» |
| Estado del ensayo | **§4 ensayada contra `prod` real** (`vmd206041`, la reserva se aplicó el 2026-09-11 y se reverificó el 2026-09-12 contra el `configz` del kubelet). §2, §3 y §5 **no ensayadas** — ver «Estado del ensayo» |

> **Este documento vivía en el repositorio archivo `sgtm` y sus comandos estaban
> pre-renombrado** (`kubectl -n sgtm-<amb>`). Copiados al pie de la letra fallaban con
> `namespaces "sgtm-prod" not found` sin mencionar el renombrado, y quien los seguía se
> quedaba mirando un `kubectl top` vacío creyendo que el nodo estaba ocioso. Se trajo y se
> remidió entero ([#100](https://github.com/hneyra/infrastructure/issues/100),
> [#111](https://github.com/hneyra/infrastructure/issues/111)).
>
> **Y traerlo cerró una cita rota en el código**: `infra/vps/reservar-recursos-del-nodo.sh`
> terminaba mandando a anotar la ejecución en «`docs/80-infraestructura/mantenimiento-del-nodo.md`»,
> que estaba mal **por partida doble** —ese nombre no existe ni en el archivo, y el
> documento real es éste, en `B0-operacion/runbooks/`—. El registro que aquel aviso pedía
> es la tabla de «Registro de ejecuciones de la reserva», más abajo.

## Síntoma

No siempre es una falla: puede ser una actualización planeada. También es el destino de
varias alertas que, por sí solas, no dicen qué hacer — este runbook empieza por un
diagnóstico que las distingue.

### Diagnóstico por alerta

Los umbrales están **medidos el 2026-09-12** sobre
[`infra/observabilidad/alertas.yml`](../../../infra/observabilidad/alertas.yml), que es
donde se declaran; no se repiten aquí como números sueltos porque un número suelto en un
runbook se desincroniza del código.

| Alerta | Qué significa | Acción |
|---|---|---|
| `CPUDelNodoAlta` | Más del 80 % de CPU no ociosa sostenido **5 minutos** — no un pico | §1 si es una carga identificable y legítima; §3 si es una tendencia |
| `MemoriaDelNodoAlta` | Menos del 15 % de `MemAvailable` sostenido 5 minutos | Igual que arriba |
| `PresionDeCPUDelNodo` | PSI (`node_pressure_cpu_waiting_seconds_total`) por encima de 0,2 durante 5 minutos. Satura **antes** de que el promedio lo vea: es la señal que precede a un `CrashLoopBackOff` por sondas que expiran | Igual que arriba, pero más urgente: actuar antes de que aparezcan pods muertos |
| `PodEnCrashLoopBackOff` | Un pod reinicia en bucle (2 minutos) | `kubectl describe pod` **primero**. Si el motivo es `OOMKilled` o CPU, es presión del nodo y este runbook aplica; si es otra cosa, es del componente |
| `PodNoListo` | Un pod `Running` lleva **10 minutos** sin pasar sus sondas | Mismo diagnóstico que el anterior |
| `CertificadoPorExpirar` | Menos de 14 días de vigencia TLS, sostenido 1 hora | §5 |
| `DiscoDelNodoAlto` | Más del 80 % de `/` ocupado | **No es este runbook.** Es `el-disco-del-nodo-se-lleno.md`, todavía en el archivo `sgtm` (#100). La salvedad se mantiene: si el disco se llena de forma **recurrente**, la salida es §3 de aquí |

## Precondiciones

1. **La ventana está anunciada**, con quien atiende ventanilla sabiendo que el sistema no
   va a responder durante ese tiempo (RNF-078).
2. **Acceso SSH al VPS y `kubectl` contra el clúster.** No son lo mismo y §4 necesita los
   dos **en el nodo**: el guion se ejecuta *ahí*, como `root`, y comprueba que `kubectl` y
   `systemctl` existan antes de tocar nada. Desde el portátil, por el túnel al API, no se
   puede correr.
3. **Fuera de las ventanas de vencimiento tributario** (`INF-03` §5, todavía en el archivo
   `sgtm`: «la regla que más fricción genera y la que más protege»).
4. **Ningún `pulumi up` ni `pulumi preview` en marcha**, en ninguna terminal, para §2 y §4.
   Los dos cortan el API server y el proveedor de Pulumi habla contra ese mismo servidor:
   un `up` a mitad de camino es el estado del que más cuesta salir.

## Pasos

### 1. Verificar que la carga alta es legítima antes de tocar nada

**El producto ya no vive en un namespace, sino en seis** — medido el 2026-09-12 contra
`prod`: `kamayuk-prod` (plataforma: PostgreSQL, Keycloak, observabilidad) y
`kamayuk-<sistema>-prod` para cada uno de los cinco. Un `top pods` contra uno solo mira
menos de la sexta parte del nodo:

```bash
kubectl top nodes
for ns in kamayuk-<amb> kamayuk-rentas-<amb> kamayuk-catastro-<amb> \
          kamayuk-identidad-<amb> kamayuk-caja-<amb> kamayuk-normativa-<amb>; do
  echo "── $ns"; kubectl top pods -n "$ns"
done
```

**El `CronJob` de `lote` del monolito ya no existe**, y este documento lo daba por vivo.
Los que hay hoy en `prod`, medidos, y ninguno lleva `timeZone`, **así que sus horarios son
UTC** —Perú es UTC−5—:

| CronJob | Horario (UTC) | Hora de Perú |
|---|---|---|
| `kamayuk-<sistema>-consumidor-de-identidad`, en los **cuatro** satélites | `*/5 * * * *` | cada 5 minutos, todo el día |
| `kamayuk-prod-respaldo` | `0 6 * * *` | 01:00 |
| `kamayuk-rentas-ingestor` y `kamayuk-catastro-publicador` | `0 7 * * *` | **02:00** — la ventana declarada que este documento atribuía a `lote` |

Si el pico coincide con uno de ellos, o con una carga masiva a mano, eso puede bastar como
explicación sin redimensionar nada: esperar a que termine y confirmar que baja.

> **Referencia de un nodo en reposo, medida el 2026-09-12 en `prod`:** `kubectl top nodes`
> da **306m (6 %) y 3 479 Mi (35 %)**, con **1 740m (34 %) y 5 676 Mi (57 %)** *pedidos*
> por los pods. El consumo real es la quinta parte de lo pedido — así que «CPU alta» aquí
> significa alta **de verdad**, no el ruido de un nodo ajustado.

### 2. Reiniciar el nodo (actualización de kernel, mantenimiento del proveedor)

Sin réplica que promover, esto **es** la ventana de indisponibilidad:

```bash
ssh <usuario>@<vps> 'sudo reboot'
# esperar, y confirmar que k3s vuelve:
kubectl get nodes -w
kubectl get pods -A -w
```

k3s reprograma los pods al volver. El que necesita revisión aparte es PostgreSQL:
`strategy: Recreate` en su `Deployment` es lo que impide que un segundo pod intente montar
el mismo volumen `ReadWriteOnce` y se quede colgado.

> **Comprobado el 2026-09-12 en `prod`**, y no sólo para PostgreSQL: los **siete**
> `Deployment` con volumen o con estado —`kamayuk-prod-postgres`, `kamayuk-prod-identidad`,
> los cinco de observabilidad— llevan `Recreate`, y también `traefik`. Los que llevan
> `RollingUpdate` son los sin estado (las interfaces y los `-web`), que es lo correcto.
> Verificarlo antes de un reinicio cuesta un comando:
>
> ```bash
> kubectl get deploy -A -o custom-columns='NS:.metadata.namespace,NOMBRE:.metadata.name,ESTRATEGIA:.spec.strategy.type'
> ```

### 3. Redimensionar disco, CPU o memoria

Depende del proveedor del VPS — el paso que este repositorio no puede automatizar. Si el
proveedor exige reinicio, es el procedimiento de §2.

**Lo que sí es de aquí es el paso de después, y olvidarlo tiene un síntoma caro.** Cambiar
el hierro cambia lo asignable, y
[`capacidad.ts`](../../../infra/capacidad.ts) autoriza los despliegues contra lo que
[`Pulumi.<amb>.yaml`](../../../infra/Pulumi.prod.yaml) **declara**, no contra lo que el
nodo tiene. Tras redimensionar, remedir y escribirlo:

```bash
kubectl get node -o jsonpath='{.items[0].status.allocatable.cpu}{"/"}{.items[0].status.allocatable.memory}'; echo
# y contrastarlo con lo declarado, que es lo que el flujo ejecuta:
infra/vps/comprobar-lo-asignable.sh --ambiente <stg|prod>
```

Declarar **menos** de lo real está admitido y sólo aprieta la comprobación; declarar
**más** es lo único que se rechaza, porque es la única dirección en que el error deja pasar
un despliegue que no cabe. Ya pasó al revés el 2026-08-26: se declaró el número que el nodo
*iba a tener*, y `aplicar-prod` se detuvo en «Lo declarado cabe en el nodo real» — que
existe justo para eso. Adelantarse al nodo no despliega nada: sólo cambia el paso en el que
falla.

### 4. Aplicar la reserva de CPU/memoria del nodo (`kube-reserved`/`system-reserved`)

Lo hace [`infra/vps/reservar-recursos-del-nodo.sh`](../../../infra/vps/reservar-recursos-del-nodo.sh),
**en el nodo y como `root`**. No se hace a mano: el guion deja su firma en el bloque que
escribe, y esa firma es lo único que después distingue «un `kubelet-arg` que puse yo y
puedo corregir» de «un `kubelet-arg` de otro, que no toco».

Existe porque una ráfaga de la aplicación puede dejar sin CPU al kubelet, y entonces las
sondas de **todo** el nodo empiezan a expirar a la vez — el incidente que ya ocurrió sobre
esta misma combinación (k3s, un solo nodo, PostgreSQL en un `ReadWriteOnce`).

> ⚠ **Reinicia k3s: va en su propia ventana**, nunca mezclada con un `pulumi up` que además
> cambie otra cosa. El guion lo repite antes de tocar nada y pide escribir `entiendo`,
> porque es el tipo de aviso que se salta la segunda vez que se corre un guion, no la
> primera.

```bash
ssh <usuario>@<vps>
sudo /ruta/al/repositorio/infra/vps/reservar-recursos-del-nodo.sh
```

#### Qué escribe, exactamente

En `/etc/rancher/k3s/config.yaml` (o donde apunte `KAMAYUK_CONFIG_K3S`), **añadiendo** al
final:

```yaml
# Reserva del nodo para kubelet, containerd y el sistema operativo (INF-01 §2 y
# §4, issue #157). Escrito por infra/vps/reservar-recursos-del-nodo.sh -no a
# mano-, para que quede claro de donde salio si alguien lo encuentra despues.
kubelet-arg:
  - "system-reserved=cpu=500m,memory=1Gi"
  - "kube-reserved=cpu=500m,memory=1Gi"
```

**Son 1 CPU y 2 Gi EN TOTAL, repartidos entre las dos partidas — no una copia en cada
una.** `system-reserved` y `kube-reserved` son dos descuentos distintos que kubelet
**suma**, así que poner `cpu=1` en las dos no reserva 1 CPU: reserva 2. Eso es exactamente
lo que le pasó al nodo anterior (`vmd120205`) el 2026-08-23: se quedó con 2 de sus 4 CPU
repartibles y desde ese día no podía ubicar su propio stack. Lo que hace peligroso a ese
defecto es que **no se ve leyendo el guion** —las dos líneas son correctas por separado y
sólo están mal juntas—, y por eso
[`reserva-del-nodo.test.ts`](../../../infra/verificaciones/reserva-del-nodo.test.ts)
comprueba la **suma**, ejecutando el guion en su modo `--solo-configuracion` sobre un
archivo de mentira en vez de leer su fuente.

#### Qué hace si ya hay una reserva

Tres desenlaces, y ninguno adivina nada:

| Estado de `config.yaml` | Qué hace | Reinicia k3s |
|---|---|---|
| Sin `kubelet-arg:` | Añade el bloque de arriba | Sí |
| Con `kubelet-arg:` **y su firma**, con las cifras correctas | Imprime «La reserva ya es la correcta», muestra capacidad y asignable, y sale con 0 | **No** |
| Con `kubelet-arg:` **y su firma**, con otras cifras | Copia de seguridad `.bak` con marca de tiempo y sustituye **sólo esas dos líneas** por `sed`; imprime el `diff` | Sí |
| Con `kubelet-arg:` **sin su firma** (lo escribió otro) | **Falla con código 1** e imprime las dos líneas a poner a mano | No |

La última es deliberada: fusionar dos listas YAML a ciegas sobre un archivo del que sólo
hay una copia es el automatismo que la corrompe — y dos claves `kubelet-arg:` en el mismo
archivo son un YAML inválido.

#### Qué comprueba el guion después, y qué hay que comprobar tú

El guion, por su cuenta: que el API server vuelva a `/readyz` (30 intentos cada 2 s, o sea
**60 s**), que el nodo vuelva a `Ready` (120 s), imprime capacidad y asignable, y mira si
quedó algún pod fuera de `Running`/`Succeeded`. **Los pods existentes no se recrean**:
kubelet vuelve con la misma asignación que ya tenía, y la reserva nueva sólo afecta a lo
que el planificador admita **desde ahora**.

Lo que hay que comprobar aparte, porque el guion no puede:

**1 · Que la reserva esté donde manda, y no deducida de la resta.** El `configz` del
kubelet es la fuente:

```bash
kubectl get --raw "/api/v1/nodes/<nodo>/proxy/configz" \
  | python3 -c 'import json,sys; k=json.load(sys.stdin)["kubeletconfig"]; print("systemReserved", k.get("systemReserved")); print("kubeReserved", k.get("kubeReserved")); print("evictionHard", k.get("evictionHard"))'
```

Medido el 2026-09-12 en `prod` devuelve `{'cpu': '500m', 'memory': '1Gi'}` en las **dos**
partidas. Y `evictionHard` **no declara `memory.available`**, que es el motivo por el que
la resta capacidad − reserva da lo asignable **exacto** y no aproximado: no hay un tercer
descuento escondido.

**2 · Que lo asignable bajó y la capacidad no.**

```bash
kubectl get node -o custom-columns='NODO:.metadata.name,CPU_CAPACIDAD:.status.capacity.cpu,CPU_ASIGNABLE:.status.allocatable.cpu,MEM_CAPACIDAD:.status.capacity.memory,MEM_ASIGNABLE:.status.allocatable.memory'
```

**3 · Que lo declarado sigue cuadrando.** Lo asignable acaba de cambiar, así que
`Pulumi.<amb>.yaml` puede haber quedado por encima — que es la única dirección que hace
daño. Es el `comprobar-lo-asignable.sh` de §3, y va **después** de la reserva, no antes.

**4 · Anotar la ejecución en la tabla de abajo.** Es lo que el guion pide en su última
línea, y es la pregunta que hay que poder contestar meses después: si el clúster volvió
solo o hizo falta intervenir.

### 5. Certificado que no renovó solo

Let's Encrypt renueva con el desafío **HTTP-01**, que necesita el puerto 80 abierto y
Traefik sirviendo. **No hay `cert-manager` en este clúster** —comprobado el 2026-09-12: no
existe ninguna CRD de certificados—; lo hace el resolutor ACME que Traefik trae dentro.
Medido sobre el `Deployment`:

| Pieza | Valor medido |
|---|---|
| Dónde vive Traefik | **`kube-system`**, no en el namespace del producto — este documento decía `-n sgtm-<amb>`, y ahí no está |
| Resolutor | `--certificatesResolvers.letsencrypt.acme.httpChallenge.entryPoint=web` |
| Almacén | `--certificatesResolvers.letsencrypt.acme.storage=/data/acme.json` |
| Quién lo usa | `--entryPoints.websecure.http.tls.certResolver=letsencrypt` |

Si `CertificadoPorExpirar` sigue activa pasadas 24 horas:

```bash
kubectl -n kube-system logs deployment/traefik | grep -i acme
```

Las causas más probables: el puerto 80 dejó de estar abierto —revisar
[`cortafuegos.sh`](../../../infra/vps/cortafuegos.sh)—, o el DNS del dominio dejó de
apuntar al nodo actual, que es justo lo que una mudanza de nodo deja a medias
([Mudar un ambiente de nodo](../../00-gobierno/mudar-un-ambiente-de-nodo.md)).

> **El puerto 80 redirige a HTTPS de forma permanente**
> (`--entryPoints.web.http.redirections.entryPoint.permanent=true`) y aun así el desafío
> funciona: Traefik atiende la ruta de ACME antes de aplicar la redirección. Cerrar el
> puerto 80 «porque todo va por HTTPS» es lo que rompe la renovación, y el síntoma llega
> **60 días después**.

## Registro de ejecuciones de la reserva

Una fila por ejecución de `reservar-recursos-del-nodo.sh`. **La tabla existe porque el
guion la pide por su nombre**; antes de este documento ese aviso apuntaba a un archivo
inexistente y la única ejecución que había se anotó, por no tener dónde, en un comentario
de [`Pulumi.prod.yaml`](../../../infra/Pulumi.prod.yaml).

| Fecha | Nodo | Antes (capacidad → asignable) | Después (capacidad → asignable) | ¿Volvió solo? |
|---|---|---|---|---|
| **2026-09-11** | `vmd206041` (`prod`, k3s v1.36.4+k3s1) | 6 CPU / 12242280Ki → **6 CPU / 12242280Ki** (sin reserva) | 6 CPU / 12242280Ki → **5 CPU / 10145128Ki** | **Sí, y sin coste**: se corrió con el nodo **vacío** y antes del primer `pulumi up`, que es su ventana barata. Ningún pod se cayó porque no había ninguno |

**La diferencia es exactamente 1 CPU y 2 097 152 Ki = 2 Gi**, o sea las dos partidas
sumadas. Reverificado el 2026-09-12 contra el `configz` del kubelet y contra
`.status.allocatable`, que es lo que esta fila afirma.

> **Lo que esta única fila no puede decir todavía**, y conviene que se note: **nadie ha
> aplicado la reserva sobre un nodo con carga**. Los dos riesgos que sólo aparecen ahí —que
> el API server tarde más de 60 s en volver, y que un pod no vuelva— siguen sin medirse.
> La ejecución de `vmd120205` del 2026-08-23 **no** se anota aquí: fue en el nodo anterior,
> con la reserva duplicada, y su medición vive en `INF-10` §4 (archivo `sgtm`).

## Cómo se comprueba que terminó bien

**No** «`kubectl get nodes` muestra `Ready`». Un nodo listo con la RLS caída, o con Keycloak
emitiendo contra el realm equivocado, también se ve `Ready`:

1. **El nodo no está en presión.** Las tres condiciones, no sólo `Ready`:

   ```bash
   kubectl get node <nodo> -o jsonpath='{range .status.conditions[*]}{.type}={.status} {end}'; echo
   ```

   El 2026-09-12 en `prod`: `MemoryPressure=False DiskPressure=False PIDPressure=False
   Ready=True`.

2. **El aislamiento multi-tenant se sostiene** tras el reinicio o el cambio. Es la
   comprobación de `restaurar-a-un-punto-en-el-tiempo.md`, todavía en el archivo `sgtm`
   (#100) — mientras tanto, las pruebas de aislamiento de cada sistema son lo que la
   ejerce.

3. **La deuda de un contribuyente conocido sale con su fecha**, con el mismo total que
   antes de la ventana. Un reinicio no debería haber cambiado ninguna cifra.

4. **Se puede iniciar sesión de verdad**, desde el dominio público y hasta ver el sistema —
   no hasta el formulario. Si esto falla y lo demás está bien, el runbook es
   [Abrir la consola de administración de Keycloak](abrir-la-consola-de-keycloak.md).

5. **Las alertas que motivaron la ventana volvieron a normal** en Alertmanager. No «dejaron
   de aparecer en el resumen»: que la serie en Prometheus esté por debajo del umbral, y no
   silenciada.

## Si no sale bien

| Síntoma | Qué hacer |
|---|---|
| PostgreSQL no vuelve tras el reinicio de §2 | Revisar que su `Deployment` use `strategy: Recreate` y no `RollingUpdate`. Con el segundo, un pod nuevo compite por el mismo volumen `ReadWriteOnce` y se cuelga sin decir por qué |
| `systemctl restart k3s` de §4 no vuelve a responder en 60 s | El guion falla y **remite a `systemctl status k3s` / `journalctl -u k3s -n 200`, que tienen la razón real**. Un `config.yaml` con YAML inválido es la causa más probable, y se ve ahí en una línea. Esperar 2-3 minutos antes de tratarlo como pérdida del nodo |
| El guion falla con «ya define `kubelet-arg` y NO lo escribió este guion» | No es un error del guion: es su negativa a fusionar a ciegas. Ajustar a mano las dos líneas que imprime, y volver a correrlo para que compruebe |
| El guion dice «hay pods que no volvieron a `Running`» y la lista es de `Job` | **Probablemente es un falso rojo — medido, ver abajo.** Comprobar el dueño antes de tratarlo como incidente |
| La sustitución de cifras dejó el archivo a medias | El propio guion lo detecta y **restaura el `.bak`** antes de reiniciar nada. El respaldo queda junto al original, con marca de tiempo |
| El certificado sigue sin renovar tras confirmar el puerto 80 y el DNS | Revisar la cuota de Let's Encrypt. Si se agotó reintentando, hay que esperar su ventana, **no seguir reintentando** |
| La presión de CPU/memoria vuelve enseguida tras redimensionar | El dimensionamiento de `INF-01` §2 son estimaciones, no mediciones. Documentar la volumetría real encontrada: es exactamente el dato que falta para corregirlas |

### El centinela de pods del guion es más ancho de lo que su mensaje dice

**Medido el 2026-09-12 en `prod`.** El guion cierra con:

```bash
kubectl get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded --no-headers
```

y si eso devuelve algo, imprime «FALLO: hay pods que no volvieron a Running tras el
reinicio de k3s». Hoy, sin haber reiniciado nada, ese comando devuelve **31 pods en
`Failed` de 76**, y **los 31 pertenecen a un `Job`** —sobras de `CronJob` de consumidor y
de implantación, de hasta 10 horas antes—. **Cero pertenecen a un `Deployment`.**

O sea que ejecutar la reserva sobre este clúster **terminaría en un rojo que no es suyo**,
con un mensaje que acusa al reinicio de algo que ya estaba. Antes de darle crédito:

```bash
kubectl get pods -A --field-selector=status.phase!=Running,status.phase!=Succeeded \
  -o jsonpath='{range .items[*]}{.status.phase}{"\t"}{.metadata.ownerReferences[0].kind}{"\t"}{.metadata.namespace}{"/"}{.metadata.name}{"\n"}{end}'
```

Si la columna del dueño dice `Job` en todas, el reinicio no se llevó nada por delante. Lo
que hay que mirar es que **ningún pod de un `Deployment`** esté fuera de `Running`. La
ejecución del 2026-09-11 no tropezó con esto porque el nodo estaba vacío.

## Estado del ensayo

**§4 está ensayada contra `prod` real.** La reserva se aplicó en `vmd206041` el 2026-09-11
y el 2026-09-12 se reverificó, por el túnel al API y **sólo con lecturas**: el `configz`
del kubelet declara las dos partidas (`500m` + `1Gi` cada una), `.status.capacity` da 6 CPU
y 12242280Ki, `.status.allocatable` da 5 CPU y 10145128Ki, y la resta es 1 CPU y 2 Gi
exactos. La versión del nodo es **k3s v1.36.4+k3s1** sobre Ubuntu 26.04.1 LTS, kernel
7.0.0-31, containerd 2.3.4-k3s1.36.

También se midió el 2026-09-12, y corrigió lo que este documento afirmaba: los seis
namespaces de §1, los `CronJob` reales y sus horarios en UTC, las estrategias `Recreate`
de los siete `Deployment` con estado, el namespace y el resolutor ACME de Traefik en §5, y
los 31 pods `Failed` de `Job` que hacen ruidoso el centinela del guion.

**No ensayado, y ninguno se puede ensayar sin abrir una ventana:**

- **§2, reiniciar el nodo.** No se reinició nada: es una caída del servicio.
- **§3, redimensionar.** Depende del proveedor.
- **§4 sobre un nodo CON CARGA.** La única ejecución fue sobre un nodo vacío, así que las
  dos cosas que sólo fallan con carga —que el API server tarde más de 60 s, y que un pod no
  vuelva— siguen sin medirse. `reservar-recursos-del-nodo.sh` **no se ejecutó** para
  escribir este documento.
- **§5, forzar una renovación.** Se leyó la configuración de ACME; no se provocó ninguna
  emisión.

Lo que sí está verificado sin clúster: que la reserva suma lo dimensionado y no el doble
—[`reserva-del-nodo.test.ts`](../../../infra/verificaciones/reserva-del-nodo.test.ts)
**ejecuta** el guion en `--solo-configuracion` en vez de leerlo—, y que la cita del guion a
este documento resuelve
([`lo-que-el-codigo-cita-existe.test.ts`](../../../infra/verificaciones/lo-que-el-codigo-cita-existe.test.ts)).

## Documentos relacionados

[ADR-0011](../../30-arquitectura/adr/ADR-0011-infraestructura-como-codigo.md) §Consecuencias
(un solo nodo, la ventana y RNF-078) ·
[Mudar un ambiente de nodo](../../00-gobierno/mudar-un-ambiente-de-nodo.md) (cambiar de
VPS, y el paso que le faltaba) ·
[Abrir la consola de administración de Keycloak](abrir-la-consola-de-keycloak.md) ·
[`reservar-recursos-del-nodo.sh`](../../../infra/vps/reservar-recursos-del-nodo.sh) ·
[`comprobar-lo-asignable.sh`](../../../infra/vps/comprobar-lo-asignable.sh) ·
[`cortafuegos.sh`](../../../infra/vps/cortafuegos.sh) ·
[`alertas.yml`](../../../infra/observabilidad/alertas.yml)

**Todavía en el repositorio archivo `sgtm`, pre-renombrado** (#100): `INF-01`
(arquitectura de infraestructura, §1 §2 §4), `INF-03` §5 (ventanas de vencimiento),
`INF-09` (observabilidad y alertas), `INF-10` §4 (la medición del nodo anterior),
`el-disco-del-nodo-se-lleno.md`, `restaurar-a-un-punto-en-el-tiempo.md` y
`reconstruir-el-vps-desde-cero.md`.
