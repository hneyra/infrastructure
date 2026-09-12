# Runbook — Abrir la consola de administración de Keycloak

| Campo | Valor |
|---|---|
| Cuándo | Crear o dar de baja personas, asignar roles, revisar sesiones — administración corriente de identidad |
| Qué cubre | El acceso a la consola. Crear el usuario y su `municipalidad_id` está en «Pasos» §4 |
| Estado del ensayo | **Ensayado contra el Keycloak real de `prod`** (`vmd206041`, 2026-09-12), incluidos los tres modos de fallo de «Si no sale bien». Lo que no se ensaya en CI es que `KC_HOSTNAME_ADMIN` no estorbe a `kcadm` — ver «Estado del ensayo» |

> **Este documento vivía en el repositorio archivo `sgtm` y sus comandos estaban
> pre-renombrado** (`kubectl -n sgtm-<amb>`, realm `sgtm`, base `sgtm`). Copiados al pie
> de la letra fallaban con `namespaces "sgtm-prod" not found`, sin mencionar el
> renombrado: quien los seguía no abría ningún túnel y se encontraba un error de conexión
> que manda a buscar la avería en Keycloak. Se trajo y se remidió entero
> ([#100](https://github.com/hneyra/infrastructure/issues/100)).

## Síntoma

No es una falla: es administración corriente.

## Precondiciones

1. **Acceso `kubectl` al ambiente**, con permiso para leer `Secret` y abrir
   `port-forward`. Desde fuera del nodo eso va por el túnel SSH al API.
2. **`KC_HOSTNAME_ADMIN` desplegado.** Lo fija `infra/componentes/Identidad.ts` y llega
   con `pulumi up`. Si no está, el paso 3 termina fuera de la consola — ver «Si no sale
   bien».
3. **El puerto local tiene que ser 8180.** No es preferencia: la consola construye sus
   enlaces desde `KC_HOSTNAME_ADMIN`, así que con otro puerto carga y se rompe al
   navegar. El número vive en `PUERTO_DE_LA_CONSOLA`, en `Identidad.ts`, **y no en este
   documento**: un número suelto en un runbook se desincroniza del código.

## Pasos

### 1. Cuál de las tres claves

`kamayuk-<amb>-keycloak` guarda **tres**, y dos se llaman casi igual. Equivocarse da un
acceso rechazado, que se lee como «la clave está mal» y manda a rotarla:

| Clave del `Secret` | Para qué | Medido |
|---|---|---|
| **`clave-administrador`** | el `admin` del realm **`master`** — **la de esta consola** | `master`/`admin` → token |
| `clave-del-administrador` | el `administrador` del realm **`kamayuk`**, que es una persona del producto y **no entra aquí** | `master`/`admin` → `Invalid user credentials` |
| `clave-base` | la base de datos de Keycloak | — |

```bash
kubectl -n kamayuk-<amb> get secret kamayuk-<amb>-keycloak \
  -o jsonpath='{.data.clave-administrador}' | base64 -d; echo
```

El usuario es `admin` (`KC_BOOTSTRAP_ADMIN_USERNAME`). **La clave no se pega en un chat,
un ticket ni un mensaje**: se lee cuando se necesita y se descarta.

### 2. El túnel

```bash
kubectl -n kamayuk-<amb> port-forward svc/kamayuk-<amb>-identidad 8180:8080
```

**`port-forward` ata el `127.0.0.1` de la máquina donde se ejecuta**, no el de la máquina
donde está el navegador. Si son la misma, el paso 3 va directo. Si hay un servidor de
salto —que es el caso de `prod`—, falta un segundo salto:

```bash
# en el servidor de salto, donde hay kubectl y túnel al API: lo de arriba
# y en el portátil, y sólo entonces:
ssh -N -L 8180:127.0.0.1:8180 <usuario>@<servidor-de-salto>
```

> **Por qué no se ata a `0.0.0.0` y nos ahorramos el salto.** Eso publicaría la consola de
> administración en la IP pública del servidor, que es exactamente lo que la
> `IngressRoute` evita al excluir `/keycloak/admin`. El segundo túnel no es burocracia: es
> lo que mantiene la consola fuera de la red.

### 3. La consola

```
http://127.0.0.1:8180/keycloak/admin/master/console/
```

Se entra con `admin` y la clave del paso 1.

**Se teclea; no se llega siguiendo un redirect.** `https://<dominio>/keycloak/` contesta
un **302 hacia `http://localhost:8180/keycloak/admin/`**, y seguir ese salto desde una
página HTTPS es la forma más fácil de acabar en el error de «Si no sale bien».

> **La consola no está publicada, y no debe estarlo.** La `IngressRoute` la excluye con
> `!PathPrefix(/keycloak/admin)`. El túnel es el único camino, a propósito: una consola de
> administración de identidad expuesta a internet es la superficie de ataque más valiosa
> del sistema entero.

### 4. Crear una persona

Dos mitades que tienen que casar, o el usuario entra y el sistema no lo reconoce:

| Mitad | Dónde vive | Qué la une |
|---|---|---|
| La identidad | Keycloak, realm `kamayuk` | `username` |
| La fila | Tabla `usuario` de la base **`identidad`** | `usuario.cuenta` |

> **Desde ADR-0039 la fila NO se escribe a mano.** `identidad` es el dueño de la
> autorización y la administra por su API; y las cuentas del emisor salen del archivo
> versionado que aplica `despliegue/identidad/reconciliar-identidades.sh`. Esta sección es
> el rodeo para una persona suelta, no el camino normal.

En la consola, con el realm **`kamayuk`** seleccionado (no `master`):

1. *Users* → *Add user*.
2. `Username` **exactamente igual** a `usuario.cuenta` de la fila que ya existe.
3. `Email`, `First name` y `Last name` son **obligatorios**. Keycloak no da el perfil por
   completo sin los tres, y sin perfil completo la persona no puede iniciar sesión aunque
   exista y tenga clave.
4. Pestaña *Attributes*: `municipalidad_id` con el id de su municipalidad. **Sin él, el
   token sale sin el claim de ADR-0005, el filtro no puede fijar el contexto de tenant y
   toda petición recibe 403 sin llegar a ningún controlador.**
5. Pestaña *Credentials* → *Set password*.

**`Temporary` no es un detalle de gusto.** Con la clave temporal, Keycloak exige cambiarla
y **el `password grant` deja de funcionar**: contesta `invalid_grant` con
`Account is not fully set up`, que **no** es «clave incorrecta» — la clave coincidió. Si
esa cuenta la usa un arnés o un guion, la clave va permanente.

El `municipalidad_id` sale de la base:

```bash
kubectl -n kamayuk-<amb> exec deploy/kamayuk-<amb>-postgres -c postgres -- \
  psql -U kamayuk_owner -d identidad \
  -c 'select id, ubigeo, nombre from municipalidad order by ubigeo;'
```

> **El realm versionado no trae personas, y es deliberado**
> (`despliegue/identidad/crear-usuario.sh`): «un realm que trae usuarios con contraseña es
> la forma más cómoda de que esa contraseña acabe en producción». El realm fija la
> estructura; las personas las crea quien provisiona, con las claves de su gestor de
> secretos.

## Cómo se comprueba que terminó bien

**No basta con que la consola cargue.** Carga igual sobre un Keycloak que dejó de emitir
tokens que la aplicación acepta. Las tres, contra el sistema real:

**1 · El emisor público no se movió.** Es lo único que garantiza que los tokens siguen
validando; `KC_HOSTNAME_ADMIN` no debe haberlo tocado.

```bash
curl -s https://<dominio>/keycloak/realms/kamayuk/.well-known/openid-configuration \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["issuer"])'
```

Tiene que imprimir `https://<dominio>/keycloak/realms/kamayuk`. Si imprime `localhost`,
`KC_HOSTNAME_ADMIN` se puso donde iba `KC_HOSTNAME`: revertir de inmediato.

**2 · La persona creada puede iniciar sesión de verdad.** En un navegador, desde el
dominio público, hasta ver el sistema — no hasta el formulario. Un usuario sin
`municipalidad_id` llega al formulario, lo pasa, y **recibe 403 en la primera petición**.

**3 · La consola sigue sin existir desde internet.**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<dominio>/keycloak/admin/master/console/
```

Devuelve **404**. Si alguna vez devuelve la consola de Keycloak, la exclusión se rompió y
es un incidente.

> Este documento afirmaba «**200** con el SPA del SGTM», y desde el corte es falso: ningún
> sistema sirve un comodín en la raíz de este dominio, así que la petición no cae en
> ninguna interfaz — Traefik contesta 404. Medido el 2026-09-12 contra `prod`.

## Si no sale bien

### El navegador dice `ERR_CONNECTION_RESET`

**Es el error ambiguo de este runbook: tres causas distintas, un solo mensaje.** Un puerto
sin nada escuchando daría `ERR_CONNECTION_REFUSED`, que sí se distingue; el `RESET` no.

| Causa | Cómo se reconoce | Remedio |
|---|---|---|
| Falta el segundo salto: el `port-forward` está en el servidor y el navegador en el portátil | `curl` desde el servidor da **200** y desde el portátil no | el `ssh -L` del paso 2 |
| El `ssh -L` apunta a un sitio sin nadie detrás | `ssh` **acepta** la conexión local y luego cierra el canal | corregir el destino, o levantar el `port-forward` |
| El navegador subió la petición a HTTPS | ese puerto habla texto plano: `curl https://…` da `wrong version number` | teclear la URL en vez de seguir el 302, o una ventana privada |

Para separarlas, desde **la misma máquina donde corre el `port-forward`**:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8180/keycloak/admin/master/console/
```

**200** ahí significa que la consola está sana y el problema es del camino al navegador.

### `localhost:8180` redirige a `https://<dominio>/keycloak/admin/...`

`KC_HOSTNAME_ADMIN` no está desplegado. `KC_HOSTNAME_STRICT=true` hace que Keycloak
construya todas sus URLs absolutas contra `KC_HOSTNAME` sin mirar por dónde llegó la
petición, así que responde un 302 al dominio público — y ahí, excluida del enrutado, la
petición no llega a ninguna parte.

```bash
kubectl -n kamayuk-<amb> get deploy kamayuk-<amb>-identidad \
  -o jsonpath='{range .spec.template.spec.containers[0].env[*]}{.name}={.value}{"\n"}{end}' \
  | grep HOSTNAME
```

Si falta, lo correcto es desplegarlo (`pulumi up`). Como salida temporal:

```bash
kubectl -n kamayuk-<amb> set env deployment/kamayuk-<amb>-identidad \
  KC_HOSTNAME_ADMIN=http://localhost:8180/keycloak
kubectl -n kamayuk-<amb> rollout status deployment/kamayuk-<amb>-identidad --timeout=180s
```

Dos avisos: **reinicia Keycloak** —una réplica, `Recreate`: hay cerca de un minuto en que
nadie puede iniciar sesión—, y es **deriva manual**, que el siguiente `pulumi up` borra en
silencio (ADR-0011 §6). Para revertirla antes, el mismo comando con `KC_HOSTNAME_ADMIN-`.

### La consola carga pero se rompe al navegar

El `port-forward` está en un puerto distinto de `PUERTO_DE_LA_CONSOLA`. Ciérralo y
reábrelo en 8180.

### No se puede abrir un navegador contra ese ambiente

`kcadm` hace lo mismo sin consola, hablando con Keycloak por `localhost` **dentro del
pod** — que es como reconcilia el realm `infra/componentes/identidad/reconciliar-realm.sh`:

```bash
POD=$(kubectl -n kamayuk-<amb> get pod -l app=kamayuk-<amb>-identidad -o jsonpath='{.items[0].metadata.name}')
KC=/opt/keycloak/bin/kcadm.sh

kubectl -n kamayuk-<amb> exec -it $POD -- $KC config credentials \
  --server http://localhost:8080/keycloak --realm master --user admin

kubectl -n kamayuk-<amb> exec -it $POD -- $KC create users -r kamayuk \
  -s username=<cuenta> -s enabled=true -s emailVerified=true \
  -s email=<correo> -s firstName=<nombre> -s lastName=<apellido> \
  -s 'attributes.municipalidad_id=["<id>"]'

kubectl -n kamayuk-<amb> exec -it $POD -- $KC set-password -r kamayuk \
  --username <cuenta> --new-password '<clave>'
```

**El `--server` lleva la ruta `/keycloak`.** Sin ella, `kcadm` contesta `404 Not Found` al
autenticarse, que se lee como «el servidor no está» estando perfectamente arriba: la ruta
la fija `KC_HTTP_RELATIVE_PATH`.

La clave se omite en `config credentials` **a propósito**: kcadm la pide por teclado y así
no queda en el historial del shell. La sesión vive en el sistema de archivos del pod, de
modo que los tres comandos van seguidos y contra **el mismo pod** — por eso `$POD` se fija
una vez.

## Estado del ensayo

**Ensayado contra el Keycloak real de `prod`** (`vmd206041`, 2026-09-12): el acceso a la
consola por el túnel con `KC_HOSTNAME_ADMIN` puesto (**302 → 200**), doce peticiones en
paralelo sin un error en el túnel, que el emisor público no se mueve, que la consola sigue
dando **404** desde internet, y las tres causas del `ERR_CONNECTION_RESET`. La tabla de
las tres claves se midió pidiendo token con cada combinación.

**No ensayado en CI:** que `KC_HOSTNAME_ADMIN` no estorbe a `kcadm` contra la URL interna.
Ningún trabajo de CI levanta Keycloak con su realm — los `kind` de `infra.yml` validan
esquema de Kubernetes, no arrancan identidad. La evidencia de que no estorba es que el Job
del realm reconcilia con `KC_HOSTNAME` apuntando al dominio público y hablando por
`localhost`, que es la misma clase de separación; y desde el 2026-09-11 hay además una
ejecución: el Job del realm de la mudanza terminó en verde con la variable puesta.

## Documentos relacionados

[ADR-0005](../../30-arquitectura/adr/ADR-0005-identidad-y-acceso.md) (el claim
`municipalidad_id`) ·
[ADR-0011](../../30-arquitectura/adr/ADR-0011-infraestructura-como-codigo.md) §6 (la
deriva manual) ·
[ADR-0039](../../30-arquitectura/adr/ADR-0039-la-identidad-es-un-sistema.md) (quién
administra la autorización) ·
[Mudar un ambiente de nodo](../../00-gobierno/mudar-un-ambiente-de-nodo.md)
