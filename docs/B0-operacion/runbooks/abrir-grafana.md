# Runbook — Abrir Grafana

| Campo | Valor |
|---|---|
| Cuándo | Mirar el estado de la plataforma en sus tableros: el motor, el nodo, los pods |
| Qué cubre | Entrar por **`https://<dominio>/grafana`** con una cuenta del realm de operación ([ADR-0041](../../30-arquitectura/adr/ADR-0041-grafana-detras-del-realm-de-operacion.md), #149); los errores del login y su remedio; y **el acceso de emergencia**, cuando Keycloak no responde. Un tablero que abre y **sale vacío** está en [`grafana-no-muestra-datos.md`](grafana-no-muestra-datos.md) |
| Estado del ensayo | **El login, ensayado en local** contra Grafana 11.3.0 y Keycloak 26.0.8 —las versiones de los dos ambientes—, con la configuración de #149, sus roturas y sus remedios (2026-09-13). **En los ambientes lo ensaya `verificar-login-de-grafana.sh`**, y su resultado se anota aquí al desplegar. El túnel y el `Secret` de Grafana, remedidos en el `stg` nuevo (`vmd205066`) **antes** de #149. **No ensayado en `prod`** — ver «Estado del ensayo» |

## Síntoma

No es una falla: es consulta corriente.

## Precondiciones

1. **Una cuenta del realm `kamayuk-operacion` con rol `lector` o `administrador`** en el cliente
   `kamayuk-grafana`. Hoy hay una: la del `administrador` de la municipalidad implantada, derivada de
   su archivo versionado (#148). Más cuentas, y quitarle el rol a quien deje de operar, son #150.
   **No sirve una cuenta de funcionario**: es otro realm, y Grafana no lo conoce.
2. **Su clave, la primera vez.** Donde hay relay de correo (`stg`), Keycloak manda un enlace para
   fijarla. Donde no lo hay (`prod`), el `Job` del realm le puso una clave **temporal**, la misma que
   la de su cuenta del realm de funcionarios:

   ```bash
   kubectl -n kamayuk-<amb> get secret kamayuk-<amb>-keycloak \
     -o jsonpath='{.data.clave-del-administrador}' | base64 -d; echo
   ```

   Keycloak obliga a cambiarla al entrar, **en cada realm por separado**: son dos cuentas con dos
   credenciales. **La clave no se pega en un chat, un ticket ni un mensaje.**

## Pasos

### 1. Abrir Grafana

```
https://<dominio>/grafana
```

Redirige sola a la pantalla de acceso de Keycloak, **«Sign in to Kamayuk»**, del realm de operación.
No hay formulario de Grafana: está apagado, a propósito.

### 2. Entrar

Cuenta y clave. De vuelta en Grafana, el rol lo decide el realm: `lector` entra como **Viewer** y
`administrador` como **Admin** —de la organización, nunca administrador del servidor—.

### 3. El tablero

*Dashboards* → carpeta **Kamayuk** → **Kamayuk — Resumen operativo**, o directamente:

```
https://<dominio>/grafana/d/kamayuk-resumen-operativo/kamayuk-e28094-resumen-operativo
```

Refresca cada 30 segundos, que es también lo que tarda Prometheus en raspar: más rápido no hay dato
nuevo que mostrar.

### 4. Salir

El menú de usuario → *Sign out*. Grafana manda también a Keycloak a cerrar su sesión: la redirección
lleva el `id_token_hint` (medido en local). Sin cerrarla, la sesión de Grafana caduca a la hora sin
uso y a las 12 horas en cualquier caso.

## Cómo se comprueba que terminó bien

**No basta con que la pantalla cargue.** Carga igual sobre un Grafana que no llega a su origen de
datos, y entonces cada panel dice «No data» y parece que la plataforma está vacía. Eso está en
[`grafana-no-muestra-datos.md`](grafana-no-muestra-datos.md).

**Lo del acceso lo comprueba un guion** (#149):

```bash
KUBECONFIG=<el del ambiente> infra/observabilidad/verificar-login-de-grafana.sh --ambiente <amb>
```

Comprueba que **ninguna clave abre Grafana desde internet**: el formulario da 400
`auth.client.notConfigured`, el *basic auth* da 401, sin sesión da 401, la consola de Keycloak sigue
en 404, y `/grafana/login` lleva a Keycloak con PKCE. Donde hay cuentas de prueba (`stg`), recorre
además el login entero: la de `lector` termina como `Viewer`, y **la que no tiene rol termina sin
sesión y por el motivo correcto**, `role_attribute_strict_violation`, leído del registro de Grafana.
Tiene que terminar en `comprobaciones en verde`.

## Si no sale bien

### Keycloak dice `Invalid parameter: redirect_uri`

Una página «Sign in to Kamayuk» con **400**. **La redirección registrada en el cliente
`kamayuk-grafana` no es la de este Grafana.** Medido en local con un Grafana en `127.0.0.1` y el
cliente con el dominio de `stg`. En un ambiente, pasa si el dominio cambió y el `Job` del realm no
corrió con el nuevo. El `Job` lleva la huella de lo que aplica, así que un `pulumi up` con el dominio
nuevo crea uno; comprobar que terminó:

```bash
kubectl -n kamayuk-<amb> get jobs --sort-by=.metadata.creationTimestamp | grep realm | tail -1
```

### Keycloak acepta la clave y Grafana vuelve a su pantalla, sin entrar

Lo dice el registro de Grafana:

```bash
kubectl -n kamayuk-<amb> logs deploy/kamayuk-<amb>-observabilidad-grafana --since=10m \
  | grep -E 'role_attribute_strict|user already exists|token.exchange'
```

| Lo que dice | Qué pasa | Remedio |
|---|---|---|
| `[oauth.role_attribute_strict_violation] idP did not return a role attribute` | **La cuenta no tiene rol** en `kamayuk-grafana`. Es el comportamiento buscado: sin rol no se entra | darle `lector` o `administrador`; hoy sólo lo tiene el derivado, el resto es #150 |
| `unable to create user: user already exists` | **La cuenta se recreó en Keycloak** —mismo nombre, otro identificador— y Grafana conserva la vieja | «`user already exists`», abajo |
| `[auth.oauth.token.exchange] failed to exchange code to token` | **Grafana no llega a identidad** por la red interna | «Grafana no llega a identidad», abajo |

### `user already exists`

**Medido en local:** una cuenta borrada y vuelta a crear en Keycloak llega a Grafana con otro `sub`;
Grafana ya tiene un usuario con ese nombre y se niega a crearlo. **El remedio es borrar el usuario
viejo de Grafana**, y eso lo hace su administrador local por el API. Con el *basic auth* apagado,
pide encenderlo **un momento**:

> ⚠ **Mientras dure, la clave de `admin` abre Grafana también por la ruta pública.** Se abre, se hace
> esto y se cierra, sin nada en medio.

```bash
# 1. encender, y esperar al pod nuevo
kubectl -n kamayuk-<amb> set env deploy/kamayuk-<amb>-observabilidad-grafana GF_AUTH_BASIC_ENABLED=true
kubectl -n kamayuk-<amb> rollout status deploy/kamayuk-<amb>-observabilidad-grafana --timeout=180s

# 2. por port-forward, con la clave en un archivo privado y no en la orden
kubectl -n kamayuk-<amb> port-forward svc/kamayuk-<amb>-observabilidad-grafana 3000:3000 &
( umask 077; printf 'user = "admin:%s"\n' \
    "$(kubectl -n kamayuk-<amb> get secret kamayuk-<amb>-grafana -o jsonpath='{.data.clave-admin}' | base64 -d)" \
    > ~/curl-admin-grafana )
curl -s -K ~/curl-admin-grafana 'http://127.0.0.1:3000/grafana/api/users/lookup?loginOrEmail=<cuenta>'
curl -s -K ~/curl-admin-grafana -X DELETE 'http://127.0.0.1:3000/grafana/api/admin/users/<id>'
rm -f ~/curl-admin-grafana

# 3. apagar: quitar la variable devuelve el valor que declara el Deployment
kubectl -n kamayuk-<amb> set env deploy/kamayuk-<amb>-observabilidad-grafana GF_AUTH_BASIC_ENABLED-
```

Medido en local: el `DELETE` contesta `{"message":"User deleted"}`, el *basic auth* vuelve a dar
**401**, y la cuenta entra en su siguiente intento con su rol. **El paso 3 no es opcional**: el
`set env` es deriva que el siguiente `pulumi up` también borraría, pero no se espera a eso. Si la
clave de `admin` no abre, «La clave del `Secret` ya no abre», más abajo.

### Grafana no llega a identidad

El intercambio del código lo hace el pod de Grafana por la red interna, y lo abren dos políticas:
`permitir-salida-grafana` hacia identidad y `permitir-ingreso-identidad` desde Grafana. Se prueba
desde el propio pod:

```bash
kubectl -n kamayuk-<amb> exec deploy/kamayuk-<amb>-observabilidad-grafana -- \
  wget -q -O- -T 5 http://kamayuk-<amb>-identidad:8080/keycloak/realms/kamayuk-operacion/.well-known/openid-configuration
```

Sin esas políticas contesta **`wget: can't connect to remote host (…): Connection refused`**: medido en
`stg` antes de desplegar #149, cuando no existían. El remedio es `pulumi up`, que las declara en
`infra/componentes/Red.ts`.

### El navegador dice `429 Too Many Requests`

La ruta de Grafana pasa por `limite-de-tasa`: 100 peticiones por minuto de media por IP, con ráfagas
de 50. La pantalla de acceso de Keycloak pasa por `limite-de-identidad`, 10 por minuto con ráfagas de
20. **No está medido todavía** si la primera carga de Grafana o un login llegan a ellos: anotar aquí
lo que dé en `stg`.

## Acceso de emergencia: Keycloak no responde

**Sin Keycloak no se entra a Grafana, y el administrador local tampoco sirve**: el formulario y el
*basic auth* están apagados en el propio proceso de Grafana, así que la clave de `admin` no abre ni
por la ruta pública **ni por un `port-forward`**. Y un `port-forward` a Grafana tampoco sirve para el
navegador: Grafana construye la vuelta del login con su `root_url`, que es la del dominio. Lo que
queda es **Prometheus**, que tiene los mismos datos que los tableros:

```bash
kubectl -n kamayuk-<amb> port-forward svc/kamayuk-<amb>-observabilidad-prometheus 9090:9090
```

y `http://127.0.0.1:9090`. Mientras, arreglar Keycloak:
[`keycloak-no-responde.md`](keycloak-no-responde.md). Si hace falta Grafana en sí, la ventana de
*basic auth* de «`user already exists`» es la única entrada, con su advertencia.

**`port-forward` ata el `127.0.0.1` de la máquina donde se ejecuta.** Si el navegador está en otra
—un servidor de salto con `kubectl` y el portátil con el navegador—, falta un segundo salto, igual
que en [`abrir-la-consola-de-keycloak.md`](abrir-la-consola-de-keycloak.md):

```bash
ssh -N -L 9090:127.0.0.1:9090 <usuario>@<servidor-de-salto>
```

**No se ata a `0.0.0.0` para ahorrarse el salto**: eso publicaría Prometheus, que no tiene clave, en
la IP del servidor.

### El túnel al API

Desde fuera del nodo, `kubectl` va por el túnel SSH al API. **Los dos ambientes corren k3s nativo
sobre el host, así que el puerto remoto es el 6443 en los dos**, y así lo abre CI
(`.github/workflows/infra.yml`):

```bash
ssh -f -N -L 6443:localhost:6443 <usuario>@<vps-del-ambiente>
```

Hasta la mudanza de `stg` del 2026-09-13 ([#145](https://github.com/hneyra/infrastructure/issues/145))
`stg` corría en k3d —Kubernetes dentro de un contenedor— y su API quedaba publicada en el **6445**. Si
te encuentras un kubeconfig viejo apuntando ahí, es de antes de la mudanza.

El puerto **local** es libre, pero tiene que coincidir con el `server:` del kubeconfig que uses.

- **Mejor `127.0.0.1` que `localhost` en el destino del túnel**: `-L 6447:127.0.0.1:6443`. En el VPS,
  `localhost` puede resolver primero a `::1`, y si ahí escucha otra cosa el túnel llega a ella y no
  al API.
- **Y el puerto local tiene que estar libre de verdad.** Si en la máquina desde la que se trabaja
  corre otro clúster —un k3s local ocupa el 6443 y el 6444—, un kubeconfig que apunte ahí habla con
  **ese** clúster. Se elige otro puerto (se midió con el 6447) y el `server:` del kubeconfig se
  cambia al mismo.

Para saber si detrás del puerto hay un API, sin credenciales:
`curl -sk -o /dev/null -w '%{http_code}\n' https://127.0.0.1:<puerto>/version` da **401** cuando lo
hay, y **`000`** cuando no.

#### `connection refused` o `connection reset by peer` contra el puerto del API

| Causa | Cómo se reconoce | Remedio |
|---|---|---|
| No hay túnel | **`dial tcp 0.0.0.0:<puerto>: connect: connection refused`** | abrirlo |
| Hay túnel, pero al puerto remoto equivocado | **`read: connection reset by peer`**, con el `ssh` vivo en `ps` | corregir el puerto remoto: **6443 en los dos ambientes** |

El segundo caso se midió en la máquina de trabajo: un `ssh -f -N -L 6446:localhost:6446` contra el VPS
de `prod`, vivo durante horas, detrás del cual no hay nada. `ssh` acepta la conexión local y cierra el
canal:

```
couldn't get current server API group list: Get "https://0.0.0.0:6446/api?timeout=32s":
read tcp 127.0.0.1:51738->127.0.0.1:6446: read: connection reset by peer
```

#### `unexpected eof while reading`, con el túnel vivo y el API arriba

El túnel llega a **otra cosa que escucha en el mismo puerto del VPS**. Medido el 2026-09-13 contra el
VPS viejo de `stg`: el túnel era `-L 6445:localhost:6445`, el API de k3d estaba en `0.0.0.0:6445`, y
en `[::1]:6445` escuchaba un `ssh` lanzado en el propio VPS. `localhost` resolvió a `::1`, y ese `ssh`
cortaba cada conexión:

```
* TLS connect error: error:0A000126:SSL routines::unexpected eof while reading
```

Se ve en el VPS con `sudo ss -ltnp | grep <puerto>`: aparecen dos dueños del mismo puerto. El remedio
es poner **`127.0.0.1`** en el destino del túnel, no cerrar el otro proceso.

#### `x509: certificate signed by unknown authority`

El kubeconfig llega a **un API, pero no al de este ambiente**. Medido el 2026-09-13 en la máquina de
trabajo: el kubeconfig del `stg` nuevo decía `server: https://127.0.0.1:6443`, y ese puerto era el de
un k3s local, con otra autoridad de certificación:

```
Unable to connect to the server: tls: failed to verify certificate: x509: certificate signed by unknown authority
```

No es un certificado caducado ni un problema de CI: es otro clúster. Remedio: túnel a un puerto local
libre y ese mismo puerto en el `server:` del kubeconfig.

#### `curl` no conecta con `127.0.0.1:<puerto>`

```
curl: (7) Failed to connect to 127.0.0.1 port 3000 after 0 ms: Could not connect to server
```

No hay `port-forward` en marcha en **esta** máquina: se cerró, se abrió en otro puerto, o está en el
servidor de salto y falta el segundo `ssh -L`.

### La clave del `Secret` ya no abre, y no te equivocaste de clave

Sólo importa dentro de la ventana de *basic auth*: fuera de ella, ninguna clave abre.

**Grafana sólo lee la clave del `Secret` una vez.** La documentación de Grafana lo dice de
`admin_password`: *«Set once on first-run.»* Grafana la guarda en su propia base, que vive en el
volumen `kamayuk-<amb>-observabilidad-grafana-datos`, y a partir de ahí la variable
`GF_SECURITY_ADMIN_PASSWORD` no cambia nada. Así que:

- **si alguien cambió la clave desde la interfaz de Grafana**, el `Secret` deja de valer sin que nada
  lo avise;
- **y si se rota el `Secret`, reiniciar Grafana no aplica la clave nueva** — la mitad que importa para
  [`rotar-la-clave-de-un-rol.md`](rotar-la-clave-de-un-rol.md).

El log lo distingue de un error de tecleo:

```bash
kubectl -n kamayuk-<amb> logs deploy/kamayuk-<amb>-observabilidad-grafana --since=1h \
  | grep 'password-auth.invalid'
```

```
logger=authn.service … msg="Failed to authenticate request" client=auth.client.basic
error="[password-auth.failed] failed to authenticate identity: [password-auth.invalid] invalid password"
```

**El remedio es alinear la base con el `Secret`, no al revés**, y no necesita la ventana:

```bash
kubectl -n kamayuk-<amb> get secret kamayuk-<amb>-grafana \
    -o jsonpath='{.data.clave-admin}' | base64 -d \
  | kubectl -n kamayuk-<amb> exec -i deploy/kamayuk-<amb>-observabilidad-grafana -- \
      grafana cli --homepath /usr/share/grafana admin reset-admin-password --password-from-stdin
```

La clave viaja de un `kubectl` al otro por la tubería: no pasa por la pantalla, ni por el historial
del shell, ni por los argumentos del proceso dentro del pod. No reinicia Grafana.

### Todos los paneles dicen «No data»

No es un problema de acceso: [`grafana-no-muestra-datos.md`](grafana-no-muestra-datos.md).

## Estado del ensayo

**El login de #149, en local** (2026-09-13), contra Grafana 11.3.0 y Keycloak 26.0.8 arrancados con la
configuración que declara `Observabilidad.ts`, y recorrido con `curl`:

- `lector` → **Viewer**; `administrador` → **Admin**; sin rol → **sin sesión**,
  `role_attribute_strict_violation`;
- las roturas: sin `ROLE_ATTRIBUTE_STRICT`, **la cuenta sin rol entra como Viewer**; con el
  formulario encendido, **`POST /grafana/login` con la clave de `admin` da 200**; con el intercambio
  del código inalcanzable, `auth.oauth.token.exchange`;
- apagados: el formulario da **400** `auth.client.notConfigured` y el *basic auth* **401**;
- `/api/health` sigue contestando en la raíz con la subruta, así que las sondas no cambian;
- *Sign out* lleva a Keycloak con el `id_token_hint`;
- `Invalid parameter: redirect_uri` con el cliente apuntando a otro dominio;
- `user already exists` con una cuenta recreada, y su remedio por la ventana de *basic auth*;
- `verificar-login-de-grafana.sh`, ejercido contra ese Grafana: verde con la configuración de #149, y
  **rojo** sin rol estricto, con el intercambio roto y con una cuenta en conflicto. En este último
  caso, una versión anterior del guion que no leía el motivo daba **verde**.

**En el `stg` nuevo** (`vmd205066`, k3s nativo, 2026-09-13), desde la máquina de trabajo, con el túnel
`-L 6447:127.0.0.1:6443` y un kubeconfig apuntando al 6447, **antes de #149**:

- Grafana hacia identidad: `Connection refused`; Grafana hacia Prometheus: `Prometheus Server is Ready.`;
- la clave del `Secret`, por `port-forward`: **200**. `admin`/`admin` y una clave falsa: **401** las dos;
- `/api/health`: `"database":"ok"`, `11.3.0`;
- el origen de datos: `Successfully queried the Prometheus API.`;
- el tablero: `kamayuk-resumen-operativo`, en la carpeta «Kamayuk»;
- `/grafana` y `/keycloak/admin/master/console/` desde internet: **404** los dos, con el certificado
  real de Let's Encrypt (`ssl_verify_result=0`);
- los modos de fallo del túnel `unexpected eof` y `x509`.

**Ensayado antes contra el k3d de `vmd194233`** (2026-09-12), que ya no es `stg`: el túnel y el
`port-forward` en cuatro puertos locales distintos; `/grafana` desde internet, **404** en `stg` y en
`prod`; sin túnel, túnel al puerto equivocado y sin `port-forward`; la línea de log de una clave
inválida; y que la imagen trae `grafana cli admin reset-admin-password --password-from-stdin`.

**Pendiente de anotar al desplegar #149:** `verificar-login-de-grafana.sh --ambiente stg` y
`--ambiente prod`; Grafana hacia identidad desde el pod, que tiene que conectar; la carga contra los
límites de tasa (429).

**No ensayado:**

- **`prod`.** En la máquina de trabajo no hay kubeconfig de `prod`. El procedimiento es el mismo
  cambiando `<amb>`, pero ningún comando de aquí se ha ejecutado contra `prod`.
- **La ventana de *basic auth* en un ambiente**: medida sólo en local.
- **El acceso de emergencia a Prometheus** con Keycloak caído, y que un `port-forward` a Grafana no
  sirve para el navegador: lo segundo se sigue de la configuración, no de una medición.
- **El `reset-admin-password`.** Cambiar la clave del administrador de `stg` para medir el remedio
  **no se autorizó** desde la sesión de trabajo. Lo que sostiene la sección es la documentación de
  Grafana (*«Set once on first-run.»*) y la ayuda del comando, leída dentro del pod. La primera vez
  que haga falta, anotar aquí la salida.
- **El segundo salto.** Ni `stg` ni la máquina de trabajo lo necesitan.

## Documentos relacionados

[ADR-0041](../../30-arquitectura/adr/ADR-0041-grafana-detras-del-realm-de-operacion.md) (por qué el realm
de operación) ·
[`grafana-no-muestra-datos.md`](grafana-no-muestra-datos.md) ·
[`keycloak-no-responde.md`](keycloak-no-responde.md) ·
[`abrir-la-consola-de-keycloak.md`](abrir-la-consola-de-keycloak.md) (el mismo túnel, para
Keycloak) ·
[`rotar-la-clave-de-un-rol.md`](rotar-la-clave-de-un-rol.md) ·
[ADR-0011](../../30-arquitectura/adr/ADR-0011-infraestructura-como-codigo.md) §3 (los secretos
fuera del estado de Pulumi)
