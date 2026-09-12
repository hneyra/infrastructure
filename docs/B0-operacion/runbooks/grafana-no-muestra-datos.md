# Runbook — Grafana abre, y los paneles dicen «No data»

| Campo | Valor |
|---|---|
| Cuándo | El tablero **Kamayuk — Resumen operativo** carga, pero una fila o todas salen vacías |
| Qué cubre | Distinguir el vacío que es un **hueco declarado** del que es una **avería** (§1); Prometheus sin raspar (§2); **Prometheus con una configuración vieja**, que es el que engaña (§3); Grafana con un tablero viejo (§4); y la red (§5). Llegar a Grafana está en [`abrir-grafana.md`](abrir-grafana.md) |
| Estado del ensayo | **Diagnóstico ensayado contra el Prometheus y el Grafana reales de `stg`** (`vmd194233`, k3d, 2026-09-12), incluido el remedio de §3, que se aplicó. **No ensayados:** los remedios de §4 y §5, y nada contra `prod` — ver «Estado del ensayo» |

## Síntoma

Uno o varios paneles dicen **No data**. **No es lo mismo que un panel en cero**: un cero es un
dato, y «No data» significa que la consulta no devolvió ninguna serie.

**Ese «No data» es exactamente cómo se ve una alerta ciega.** Una regla que evalúa sobre un
vector vacío se queda `inactive` para siempre, que es como se ve una regla sana. Un panel del
nodo vacío no es un problema estético: mientras dure, las alertas que miran esas series no
pueden sonar (#113).

## Precondiciones

1. Grafana abierto, o al menos el túnel al API: [`abrir-grafana.md`](abrir-grafana.md).
2. Un segundo `port-forward`, esta vez a Prometheus:

   ```bash
   kubectl -n kamayuk-<amb> port-forward svc/kamayuk-<amb>-observabilidad-prometheus 9090:9090
   ```

   Prometheus no tiene clave: lo protege que no esté publicado y que su `NetworkPolicy` sólo
   deje entrar a Grafana. El `port-forward` pasa por el API y no por la red de pods, por eso
   llega.

## Pasos

### 1. Qué fila está vacía, y si tiene que estarlo

**Tres de las doce consultas del tablero están vacías a propósito.** Antes de buscar una avería,
mirar esta tabla. Se midió en `stg` el 2026-09-12, ejecutando cada `expr` del tablero contra su
Prometheus, y entonces eran **cuatro**: la cuarta era una avería que arregló #152 (ver su fila).

| Fila | Panel | Serie | `stg` | Por qué |
|---|---|---|---|---|
| JVM y Spring Boot | Memoria de la JVM en uso | `jvm_memory_used_bytes{application="kamayuk"}` | **vacío** | **Hueco declarado.** Prometheus no raspa ninguno de los cinco sistemas (`Observabilidad.ts`, «Ningun objetivo de aplicacion»). Y el día que los raspe, los cinco publican `application="kamayuk"` y el panel los sumaría sin separarlos |
| JVM y Spring Boot | Peticiones HTTP por segundo | `http_server_requests_seconds_count{application="kamayuk"}` | **vacío** | El mismo |
| PostgreSQL | El motor responde · Conexiones · Filas | `pg_up`, `pg_stat_activity_count`, `pg_stat_database_tup_*` | con datos | — |
| El nodo | CPU en uso · Memoria en uso | `node_cpu_seconds_total`, `node_memory_*` | con datos | — |
| El nodo | Disco en uso, raíz | `node_filesystem_*{mountpoint="/"}` | vacío el 2026-09-12; **con datos desde #152**, sin remedir aquí | **Si vuelve a salir vacío, es AVERÍA, no hueco.** Medido antes de #152: node-exporter sólo veía los montajes de su contenedor —`/etc/hostname`, `/etc/hosts`, `/etc/resolv.conf`, `/dev`, `/dev/shm`, `/var/run`—, ninguno `/`, y **`DiscoDelNodoAlto` no podía sonar** ([#147](https://github.com/hneyra/infrastructure/issues/147)). #152 monta el `/` del anfitrión de sólo lectura y le pasa `--path.rootfs=/host`. `SinMetricasDelNodo` es la alerta que avisa si se pierde otra vez |
| Pods | Reinicios · Pods no listos | `kube_pod_*` | con datos | — |
| Pods | Versión desplegada y desde cuándo | `kube_pod_start_time{pod=~".*aplicacion.*"}` | **vacío** | **Hueco declarado.** Ningún pod se llama `aplicacion` desde que salió el monolito (`E`); los de los sistemas se llaman `kamayuk-<sistema>-web-*` |

Para rehacer la medición, con el `port-forward` de las precondiciones:

```bash
curl -s http://127.0.0.1:9090/api/v1/query \
  --data-urlencode 'query=count(node_filesystem_avail_bytes{mountpoint="/"})'
```

`"result":[]` es vacío. Una serie con valor, aunque sea `0`, es dato.

**Si lo vacío es otra cosa que los tres huecos declarados, sigue en §2.**

### 2. ¿Prometheus raspa?

```bash
curl -s 'http://127.0.0.1:9090/api/v1/targets?state=active' \
  | grep -oE '"scrapeUrl":"[^"]*"|"health":"[^"]*"' | paste - -
```

Medido en `stg`, sano:

```
"scrapeUrl":"http://kamayuk-stg-observabilidad-kube-state-metrics:8080/metrics"	"health":"up"
"scrapeUrl":"http://kamayuk-stg-observabilidad-node-exporter:9100/metrics"	"health":"up"
"scrapeUrl":"http://kamayuk-stg-postgres:9187/metrics"	"health":"up"
"scrapeUrl":"http://localhost:9090/metrics"	"health":"up"
"scrapeUrl":"http://traefik-metrics.kube-system.svc.cluster.local:9100/metrics"	"health":"up"
```

Qué fila deja vacía cada objetivo caído:

| Objetivo en `down` | Fila vacía | Alertas ciegas mientras dure |
|---|---|---|
| `…-postgres:9187` | PostgreSQL | **ninguna**: `PostgreSQLCaido` es `pg_up == 0 or up{job="postgres"} == 0`, así que con el exportador caído dispara igual |
| `…-node-exporter:9100` | El nodo, entera | `CPUDelNodoAlta`, `MemoriaDelNodoAlta`, `DiscoDelNodoAlto`, `PresionDeCPUDelNodo` |
| `…-kube-state-metrics:8080` | Pods, entera | `PodEnCrashLoopBackOff`, `PodNoListo`, `JobDeMigracionFallido`, `JobDeRespaldoFallido` |
| `traefik-metrics…:9100` | ninguna del tablero | `CertificadoPorExpirar` |

**Un objetivo que falta de la lista es peor que uno en `down`**: su serie `up` no pasa a 0, deja
de existir. Si hay menos de cinco líneas, sigue en §3 antes que nada.

`ObjetivoDeRaspadoCaido` y `ObjetivoDeRaspadoQueDesaparecio` avisan de los dos casos. Si están
en `firing`, esta sección es la que toca.

### 3. Prometheus corre con una configuración vieja

**Es el caso que engaña, y se midió en `stg` el mismo día que se escribió esto.** Desde #152 el
despliegue ya no lo produce (ver «Por qué pasa»), pero el diagnóstico sigue valiendo para el caso
que #152 no cubre. El despliegue
había cambiado el objetivo de Traefik y añadido cinco reglas (#113). El `ConfigMap` estaba bien, el
archivo dentro del pod estaba bien, y Prometheus seguía raspando el objetivo viejo y evaluando
**10 reglas de 15**:

```
ConfigMap, actualizado por Pulumi:          2026-09-12T21:13:16Z   15 reglas
Archivo /etc/prometheus en el pod:          el nuevo               15 reglas
Última recarga de Prometheus:               2026-09-10T22:20:15Z   10 reglas cargadas
up{job="traefik"}                           traefik.kube-system…:9100 = 0   (el objetivo VIEJO)
```

**Por qué pasa.** Kubernetes sí actualiza dentro del pod el archivo de un `ConfigMap` montado como
directorio. **Prometheus no lo vigila**: relee su configuración al arrancar, o cuando se le pide
por `POST /-/reload`, que `--web.enable-lifecycle` habilita, y **ningún paso del despliegue la
pedía** ([#146](https://github.com/hneyra/infrastructure/issues/146)). Así que un cambio de
`prometheus.yml` o `alertas.yml` llegaba al disco y no al proceso.

**Lo que cambió #152.** Cada pod de la observabilidad lleva en su plantilla la anotación
`kamayuk.gob.pe/suma-de-la-configuracion`, con la huella del contenido de su `ConfigMap`. Un
cambio de configuración desplegado cambia la plantilla, Kubernetes recrea el pod y el proceso
arranca con la configuración nueva. **Lo que #152 no cubre:** un `ConfigMap` cambiado **a mano**
—`kubectl edit`, deriva— no toca la plantilla, así que vuelve a dejar el archivo nuevo y el proceso
viejo. Para eso siguen valiendo el diagnóstico y el remedio de abajo.

**Cómo se reconoce.** Las reglas que declara el `ConfigMap` contra las que Prometheus tiene
cargadas:

```bash
kubectl -n kamayuk-<amb> get cm kamayuk-<amb>-observabilidad-prometheus \
  -o jsonpath='{.data.alertas\.yml}' | grep -c -- '- alert:'
curl -s http://127.0.0.1:9090/api/v1/rules | grep -o '"type":"alerting"' | wc -l
```

Tienen que dar lo mismo. Y cuánto hace de la última recarga, en segundos:

```bash
curl -s http://127.0.0.1:9090/api/v1/query \
  --data-urlencode 'query=time() - prometheus_config_last_reload_success_timestamp_seconds'
```

Si es **anterior al último cambio del `ConfigMap`**, ese cambio no ha llegado al proceso.

**Remedio.** No reinicia nada, y deja a Prometheus con lo que ya está declarado:

```bash
curl -s -X POST -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9090/-/reload
```

**Aplicado en `stg` a las 21:37:58Z:** contestó **200**, las reglas pasaron de **10 a 15** en el acto,
y a los 37 segundos `traefik-metrics…:9100` estaba en `up`. La serie del objetivo viejo **sigue
apareciendo en `0` un rato**: estaba a los 37 s y ya no a los 61 s. No es un fallo del remedio.

Si `reload` devuelve otra cosa que 200, la configuración nueva no es válida y Prometheus sigue con
la vieja a propósito. Su log dice por qué:

```bash
kubectl -n kamayuk-<amb> logs deploy/kamayuk-<amb>-observabilidad-prometheus --since=10m | grep -i error
```

### 4. Grafana muestra un tablero viejo

El tablero es un archivo del `ConfigMap` `kamayuk-<amb>-observabilidad-grafana`, montado con
**`subPath`**. Y un `ConfigMap` montado con `subPath` **no recibe las actualizaciones**: lo dice la
documentación de Kubernetes, y es la diferencia con §3. Hasta #152 un cambio del JSON en el
repositorio llegaba al `ConfigMap` con `pulumi up` y **nunca al pod**. Desde #152 la plantilla de
Grafana lleva la huella de su `ConfigMap`, y un cambio desplegado recrea el pod. El caso que queda
es el mismo que en §3: un `ConfigMap` editado a mano.

Se reconoce comparando las dos huellas:

```bash
kubectl -n kamayuk-<amb> exec deploy/kamayuk-<amb>-observabilidad-grafana -- \
  sha256sum /var/lib/grafana/dashboards/resumen-operativo.json
kubectl -n kamayuk-<amb> get cm kamayuk-<amb>-observabilidad-grafana \
  -o jsonpath='{.data.resumen-operativo\.json}' | sha256sum
```

Medido en `stg`: las dos `03074f17…a2531e9f`, iguales. Si difieren:

```bash
kubectl -n kamayuk-<amb> rollout restart deploy/kamayuk-<amb>-observabilidad-grafana
kubectl -n kamayuk-<amb> rollout status deploy/kamayuk-<amb>-observabilidad-grafana --timeout=180s
```

Es una réplica con `Recreate`: Grafana deja de estar un momento. Prometheus sigue raspando y las
alertas siguen evaluándose, porque no dependen de Grafana.

### 5. Grafana no llega a Prometheus

Si **todos** los paneles están vacíos, incluidos los que la tabla de §1 da con datos, y §2 dice
que Prometheus raspa, el problema está entre los dos:

```bash
curl -s -u admin http://127.0.0.1:3000/api/datasources/uid/prometheus/health
```

Sano es `"status":"OK"`. Si no lo es, las dos políticas que tienen que casar:

```bash
kubectl -n kamayuk-<amb> get networkpolicy permitir-ingreso-prometheus permitir-salida-grafana \
  -o jsonpath='{range .items[*]}{.metadata.name}: {.spec}{"\n"}{end}'
```

La de ingreso tiene que dejar entrar a `app: kamayuk-<amb>-observabilidad-grafana` al 9090, y la de
salida dejar salir a Grafana hacia `app: kamayuk-<amb>-observabilidad-prometheus` al 9090. **Las dos
puntas se declaran por separado**, cada una en su pod: faltando una, el tráfico no pasa. Medidas en
`stg`, las dos así. Si una no está o dice otra cosa, el remedio es `pulumi up`: las declara
`infra/componentes/Red.ts`, y corregirlas a mano es deriva que el siguiente despliegue borra.

## Cómo se comprueba que terminó bien

Las tres, contra el sistema real:

1. **§2 devuelve los cinco objetivos, los cinco en `up`.**
2. **§3 da la misma cifra de reglas** en el `ConfigMap` y en Prometheus.
3. **En el tablero, sólo siguen vacíos los tres paneles que la tabla de §1 da por huecos
   declarados.** Si el día que alguien raspe los sistemas la fila JVM tiene datos, esa fila de la
   tabla ha quedado vieja: corregirla aquí.

## Estado del ensayo

**Ensayado contra `stg`** (`vmd194233`, k3d, 2026-09-12), desde la máquina de trabajo:

- las **doce** consultas del tablero, una a una, contra su Prometheus: la tabla de §1;
- la lista de objetivos de §2, con sus cinco `up`;
- **§3 entero: el defecto y su remedio.** El despliegue de #113 llegó al `ConfigMap` a las
  21:13:16Z y no al proceso; el `POST /-/reload` de las 21:37:58Z lo arregló (200, de 10 a 15
  reglas, Traefik en `up` en 37 s);
- la comparación de huellas de §4, con las dos iguales;
- las dos políticas de §5, leídas del clúster, y el origen de datos sano.

**No ensayado:**

- **El `rollout restart` de §4.** Las huellas coincidían, así que no había nada que arreglar, y
  reiniciar Grafana sólo para medirlo no aporta nada que Kubernetes no documente.
- **§5 con la red rota.** Habría que borrar una `NetworkPolicy` de `stg`. El diagnóstico se apoya
  en leer las dos políticas, no en haber visto el fallo.
- **`prod`, entero.** En la máquina de trabajo no hay kubeconfig de `prod`.
- **`stg` después de #152.** Se integró mientras este runbook esperaba revisión, y su `pulumi up
  en stg` salió bien. Pero cuando se fue a remedir, el túnel al API de `stg` estaba cerrado y no se
  pudo reabrir desde la sesión. Así que «Disco en uso, raíz» con datos y la recreación del pod por
  la huella se afirman **por el código de #152, no por una medición de este runbook**. La primera
  vez que se siga, anotar aquí lo que dio.

## Documentos relacionados

[`abrir-grafana.md`](abrir-grafana.md) ·
[`el-disco-del-nodo-se-lleno.md`](el-disco-del-nodo-se-lleno.md) (lo que `DiscoDelNodoAlto` dispara,
cuando puede) ·
[`mantenimiento-del-vps.md`](mantenimiento-del-vps.md) (el runbook de las alertas de objetivos) ·
[#113](https://github.com/hneyra/infrastructure/issues/113) (las alertas que evaluaban sobre el vacío)
