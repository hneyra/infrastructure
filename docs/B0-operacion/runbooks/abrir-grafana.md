# Runbook — Abrir Grafana

| Campo | Valor |
|---|---|
| Cuándo | Mirar el estado de la plataforma en sus tableros: el motor, el nodo, los pods |
| Qué cubre | El acceso a Grafana por el túnel, la clave de su administrador y qué hacer cuando esa clave no abre. Un tablero que abre y **sale vacío** está en [`grafana-no-muestra-datos.md`](grafana-no-muestra-datos.md) |
| Estado del ensayo | **Ensayado contra el Grafana real de `stg`** (`vmd194233`, k3d, 2026-09-12): el túnel, la clave del `Secret`, la salud, el origen de datos, el tablero y los tres modos de fallo del acceso. **No ensayado en `prod`**, y **no ejecutado** el remedio de «La clave del `Secret` ya no abre» — ver «Estado del ensayo» |

## Síntoma

No es una falla: es consulta corriente.

## Precondiciones

1. **Acceso `kubectl` al ambiente**, con permiso para leer `Secret` y abrir `port-forward`.
   Desde fuera del nodo va por el túnel SSH al API, y **el puerto remoto no es el mismo en
   los dos ambientes**:

   | Ambiente | Dónde escucha el API en el VPS | Cómo lo abre CI |
   |---|---|---|
   | `stg` | **6445** — corre en k3d, no en el k3s del anfitrión | `ssh -f -N -L 6443:localhost:6445` (`.github/workflows/infra.yml`) |
   | `prod` | **6443** | `ssh -f -N -L 6443:localhost:6443` |

   El puerto **local** es libre, pero tiene que coincidir con el `server:` del kubeconfig
   que uses. Por ejemplo, con un kubeconfig que diga `server: https://0.0.0.0:6445`:

   ```bash
   ssh -f -N -L 6445:localhost:6445 <usuario>@<vps-de-stg>
   ```

2. **Grafana no está publicado.** Su `Service` es `ClusterIP` y ninguna `IngressRoute`
   lo nombra (`infra/componentes/Observabilidad.ts`), así que el túnel es el único camino.

## Pasos

### 1. La clave

```bash
kubectl -n kamayuk-<amb> get secret kamayuk-<amb>-grafana \
  -o jsonpath='{.data.clave-admin}' | base64 -d; echo
```

El usuario es **`admin`** (`GF_SECURITY_ADMIN_USER`). **No hay clave por omisión:**
`admin`/`admin` contesta **401**. **La clave no se pega en un chat, un ticket ni un
mensaje**: se lee cuando se necesita y se descarta.

### 2. El `port-forward`

```bash
kubectl -n kamayuk-<amb> port-forward svc/kamayuk-<amb>-observabilidad-grafana 3000:3000
```

**El puerto local da igual**, a diferencia de la consola de Keycloak: Grafana no tiene
`root_url` configurado y no construye enlaces absolutos, así que funciona en el que esté
libre. Se midió con cuatro distintos.

**`port-forward` ata el `127.0.0.1` de la máquina donde se ejecuta.** Si el navegador está
en otra —un servidor de salto con `kubectl` y el portátil con el navegador—, falta un
segundo salto, igual que en
[`abrir-la-consola-de-keycloak.md`](abrir-la-consola-de-keycloak.md):

```bash
ssh -N -L 3000:127.0.0.1:3000 <usuario>@<servidor-de-salto>
```

**No se ata a `0.0.0.0` para ahorrarse el salto**: eso publicaría Grafana en la IP del
servidor, con el administrador detrás de una sola clave.

### 3. El tablero

```
http://127.0.0.1:3000/d/kamayuk-resumen-operativo/kamayuk-e28094-resumen-operativo
```

Se entra con `admin` y la clave del paso 1. Por la interfaz está en *Dashboards* → carpeta
**Kamayuk** → **Kamayuk — Resumen operativo**. Refresca cada 30 segundos, que es también
lo que tarda Prometheus en raspar: más rápido no hay dato nuevo que mostrar.

## Cómo se comprueba que terminó bien

**No basta con que la pantalla cargue.** Carga igual sobre un Grafana que no llega a su
origen de datos, y entonces cada panel dice «No data» y parece que la plataforma está vacía.

**1 · Grafana y su base.** Sin clave:

```bash
curl -s http://127.0.0.1:3000/api/health
```

Tiene que decir `"database": "ok"`. Medido en `stg`: `"version": "11.3.0"`.

**2 · Grafana llega a Prometheus.**

```bash
curl -s -u admin http://127.0.0.1:3000/api/datasources/uid/prometheus/health
```

`curl` pide la clave por teclado. Tiene que decir `"status":"OK"` y
`"message":"Successfully queried the Prometheus API."`. Otra cosa es un problema entre
Grafana y Prometheus, no de acceso: [`grafana-no-muestra-datos.md`](grafana-no-muestra-datos.md) §4.

**3 · Grafana sigue sin existir desde internet.**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<dominio>/grafana
```

Devuelve **404**. Medido el 2026-09-12 en los dos dominios. Si alguna vez devuelve Grafana,
se publicó sin que nada de este repositorio lo diga, y es un incidente.

## Si no sale bien

### `kubectl` dice `connection reset by peer`, o `connection refused` contra el puerto del API

El túnel al API no está, o está pero no lleva a nada. **Las dos se ven distinto, y la segunda
engaña:**

| Causa | Cómo se reconoce | Remedio |
|---|---|---|
| No hay túnel | **`dial tcp 0.0.0.0:<puerto>: connect: connection refused`** | abrirlo, paso 1 de «Precondiciones» |
| Hay túnel, pero al puerto remoto equivocado | **`read: connection reset by peer`**, con el `ssh` vivo en `ps` | corregir el puerto remoto: 6445 en `stg`, 6443 en `prod` |

El segundo caso se midió en la máquina de trabajo: un `ssh -f -N -L 6446:localhost:6446`
contra el VPS de `prod`, vivo durante horas, detrás del cual no hay nada. `ssh` acepta la
conexión local y cierra el canal:

```
couldn't get current server API group list: Get "https://0.0.0.0:6446/api?timeout=32s":
read tcp 127.0.0.1:51738->127.0.0.1:6446: read: connection reset by peer
```

Para saber si detrás del puerto hay un API, sin credenciales:
`curl -sk -o /dev/null -w '%{http_code}\n' https://127.0.0.1:<puerto>/version` da **401** cuando lo
hay, y **`000`** en los dos casos de la tabla.

### El navegador o `curl` no conectan con `127.0.0.1:3000`

```
curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Could not connect to server
```

No hay `port-forward` en marcha en **esta** máquina: se cerró, se abrió en otro puerto, o está
en el servidor de salto y falta el segundo `ssh -L` del paso 2.

### La clave del `Secret` ya no abre, y no te equivocaste de clave

**Grafana sólo lee la clave del `Secret` una vez.** La documentación de Grafana lo dice de
`admin_password`: *«Set once on first-run.»* Grafana la guarda en su propia base, que vive en el
volumen `kamayuk-<amb>-observabilidad-grafana-datos`, y a partir de ahí la variable
`GF_SECURITY_ADMIN_PASSWORD` no cambia nada. Así que:

- **si alguien cambió la clave desde la interfaz de Grafana**, el `Secret` deja de valer sin
  que nada lo avise;
- **y si se rota el `Secret`, reiniciar Grafana no aplica la clave nueva** — la mitad que
  importa para [`rotar-la-clave-de-un-rol.md`](rotar-la-clave-de-un-rol.md).

El log lo distingue de un error de tecleo:

```bash
kubectl -n kamayuk-<amb> logs deploy/kamayuk-<amb>-observabilidad-grafana --since=1h \
  | grep 'password-auth.invalid'
```

```
logger=authn.service … msg="Failed to authenticate request" client=auth.client.basic
error="[password-auth.failed] failed to authenticate identity: [password-auth.invalid] invalid password"
```

**El remedio es alinear la base con el `Secret`, no al revés.** Así el inventario vuelve a
ser cierto y el paso 1 vuelve a funcionar para el siguiente:

```bash
kubectl -n kamayuk-<amb> get secret kamayuk-<amb>-grafana \
    -o jsonpath='{.data.clave-admin}' | base64 -d \
  | kubectl -n kamayuk-<amb> exec -i deploy/kamayuk-<amb>-observabilidad-grafana -- \
      grafana cli --homepath /usr/share/grafana admin reset-admin-password --password-from-stdin
```

La clave viaja de un `kubectl` al otro por la tubería: no pasa por la pantalla, ni por el
historial del shell, ni por los argumentos del proceso dentro del pod. No reinicia Grafana.
Después, la comprobación 2 de arriba.

### Todos los paneles dicen «No data»

No es un problema de acceso: [`grafana-no-muestra-datos.md`](grafana-no-muestra-datos.md).

## Estado del ensayo

**Ensayado contra el Grafana real de `stg`** (`vmd194233`, k3d, 2026-09-12), desde la máquina de
trabajo y con `~/.kube/k3d-sgtm-stg-cluster.yaml` apuntando al túnel del 6445:

- el túnel y el `port-forward`, en cuatro puertos locales distintos;
- la clave del `Secret`: **200**. `admin`/`admin` y una clave falsa: **401** las dos;
- `/api/health`: `"database": "ok"`, `11.3.0`;
- el origen de datos: `Successfully queried the Prometheus API.`;
- el tablero: `kamayuk-resumen-operativo`, en la carpeta «Kamayuk»;
- `/grafana` desde internet: **404** en `stg` y en `prod`;
- los tres modos de fallo: sin túnel, túnel al puerto equivocado y sin `port-forward`;
- la línea de log de una clave inválida;
- que la imagen trae `grafana cli admin reset-admin-password --password-from-stdin`.

**No ensayado:**

- **`prod`.** En la máquina de trabajo no hay kubeconfig de `prod`, y el único túnel abierto
  hacia su VPS iba al 6446, donde no hay nada. El procedimiento es el mismo cambiando `<amb>`,
  pero ningún comando de aquí se ha ejecutado contra `prod`.
- **El `reset-admin-password`.** Cambiar la clave del administrador de `stg` para medir el
  remedio **no se autorizó** desde la sesión de trabajo. Lo que sostiene la sección es la
  documentación de Grafana (*«Set once on first-run.»*) y la ayuda del comando, leída dentro del
  pod. La primera vez que haga falta, anotar aquí la salida.
- **El segundo salto.** Ni `stg` ni la máquina de trabajo lo necesitan.

## Documentos relacionados

[`grafana-no-muestra-datos.md`](grafana-no-muestra-datos.md) ·
[`abrir-la-consola-de-keycloak.md`](abrir-la-consola-de-keycloak.md) (el mismo túnel, para
Keycloak) ·
[`rotar-la-clave-de-un-rol.md`](rotar-la-clave-de-un-rol.md) ·
[ADR-0011](../../30-arquitectura/adr/ADR-0011-infraestructura-como-codigo.md) §3 (los secretos
fuera del estado de Pulumi)
