# ADR-0012 — Usuarios y grupos de Keycloak declarativos, sin clave en git

**Estado:** Aceptado
**Fecha:** 2026-08-27

## Contexto

[`ADR-0005`](ADR-0005-identidad-y-acceso.md) separó autenticación (OIDC, en Keycloak) de
autorización (el modelo del manual, en la base). El realm quedó **como código**
([`despliegue/identidad/realm-sgtm.json`](../../../despliegue/identidad/realm-sgtm.json), issue
#151): fija los clientes, el PKCE obligatorio y el mapeador que pone `municipalidad_id` en el
token. Lo que el realm **no** trae, a propósito, es «ni un usuario ni una clave»: un realm
versionado con contraseñas es la forma más cómoda de que una contraseña acabe en producción.

El hueco: las personas se creaban con
[`despliegue/identidad/crear-usuario.sh`](../../../despliegue/identidad/crear-usuario.sh)
`<usuario> <clave> <municipio>` — **un paso manual, no versionado, con la clave escrita a mano
por quien provisiona**. En el clúster, el Job que reconcilia el realm (`Identidad.ts`) aplica
realm + perfil + clientes con `partialImport OVERWRITE` y **nunca toca usuarios**. No había
ningún artefacto en el repositorio que dijera *qué personas y qué grupos* tiene una
municipalidad, ni forma de reproducirlos.

Esto choca con que el producto es multi-municipal y con
[`ADR-0011`](ADR-0011-infraestructura-como-codigo.md): si el clúster se reconstruye desde cero,
los usuarios de la municipalidad se recrean a mano, uno por uno, recordando sus atributos.

## Decisión

**El alta de usuarios y grupos de una municipalidad es declarativa y reconciliada, igual que el
realm. La primera clave no existe en git: la fija el usuario en su primer acceso, con un enlace
de un solo uso que Keycloak le envía por correo (`UPDATE_PASSWORD`).**

### 1. Fuente versionada, sin credenciales

Un archivo por municipalidad,
[`despliegue/identidad/municipalidades/<ubigeo>.json`](../../../despliegue/identidad/municipalidades/README.md),
con el ubigeo, el `municipalidadId`, el nombre del grupo y la lista de usuarios (cuenta, nombre,
apellido, correo, cuál es el administrador). **Sin `credentials`, sin `password`, sin
`enabled:false`.** Es el mismo formato que comparten el compose y el clúster, como
`realm-sgtm.json`.

El `municipalidadId` es **numérico** —el claim es `jsonType.label: "long"` y se usa como
`::bigint` en RLS— y lo asigna la implantación en la base. Va en el archivo: el operador lo copia
una vez del log `Municipalidad <ubigeo> lista ... id <n>`, y una verificación cruza que coincida
con la fila y con el atributo en Keycloak (cruce a tres bandas, en `despliegue.yml`).

### 2. La clave: enlace por correo, reseteo forzado

Un usuario nuevo se crea `enabled`, **sin credenciales**, con `requiredActions=["UPDATE_PASSWORD"]`.
El guion dispara `execute-actions-email` con `UPDATE_PASSWORD`: Keycloak envía un enlace de un
solo uso a su correo, y la persona **fija su clave al entrar**. Nadie —ni el operador, ni CI, ni
un log— llega a ver una clave.

El relay SMTP es **opcional** (`keycloakSmtpHost` en `Pulumi.<stack>.yaml` es el interruptor):

- **Con relay** — el servidor y el remitente no son secretos (van en claro); el usuario y la
  clave del relay, si `keycloakSmtpAuth`, viven en el `Secret` `sgtm-<amb>-smtp` y **no** los
  genera `bootstrap-secretos.sh` —los emite el proveedor del relay
  ([`INF-06`](https://github.com/hneyra/sgtm/blob/migracion-a-microservicios/docs/80-infraestructura/gestion-de-secretos.md) §1.2)—. En `stg` el relay es un
  buzón Mailpit del propio clúster; `config.ts` rechaza que en `prod` `keycloakSmtpHost` apunte
  a un buzón (`INF-03` §4).
- **Sin relay (Opción B)** — un ambiente que **no declara** `keycloakSmtpHost`: el realm no
  lleva `smtpServer`, el Job de reconciliación pasa `SIN_CORREO=1`, `reconciliar-identidades.sh`
  omite `execute-actions-email`, y el usuario se crea **sin clave** y con `UPDATE_PASSWORD`
  pendiente. Un operador se la fija con `kcadm set-password --temporary` (runbook abajo). Es el
  estado de la marcha blanca de `prod` mientras no haya un relay decidido (D-05): el alta
  funciona igual, solo cambia cómo llega la primera clave. Añadir el relay después es poner las
  claves en `Pulumi.<stack>.yaml` y reenviar el enlace a cada usuario —no se recrea nada—.

Si hay relay y aun así el correo no llega —SMTP mal configurado, filtrado, dirección
equivocada— las salidas son las mismas: reenviar el enlace (`execute-actions-email`) una vez
arreglado el relay, o la clave temporal a mano. El procedimiento copiable está en el runbook
[Recuperar el acceso de un usuario](https://github.com/hneyra/sgtm/blob/migracion-a-microservicios/docs/B0-operacion/runbooks/recuperar-el-acceso-de-un-usuario.md).

### 3. Reconciliación, como el realm

[`despliegue/identidad/reconciliar-identidades.sh`](../../../despliegue/identidad/reconciliar-identidades.sh)
—el mismo guion en el compose y en el Job del clúster— crea el grupo y los usuarios que falten,
pone el atributo `municipalidad_id`, afilia al grupo, y **nunca borra ni toca la clave o las
acciones pendientes de un usuario que ya existía**. Termina con una comprobación: cada usuario
declarado existe, está `enabled`, tiene el atributo con el valor del archivo y está en su grupo;
si no, sale en rojo. `Identidad.ts` deriva el TSV que el Job lee (la imagen de Keycloak no trae
con qué parsear JSON) y la derivación está cubierta por `componentes.test.ts`. El nombre del Job
lleva la huella del contenido: un cambio en un archivo de `municipalidades/` crea un Job nuevo y
llega al clúster.

### 4. Fuente única con la implantación

El usuario marcado `administrador: true` es el que la implantación da de alta como primer
administrador. `Identidad.ts` exige que su `cuenta` sea la misma que `sgtm:administrador` del
stack; en el compose, `datos-de-implantacion.sh <ubigeo>` deriva `SGTM_ADMINISTRADOR` del
archivo. Así la cuenta no puede divergir entre Keycloak y la fila de `usuario` —que es lo único
que une las dos mitades (ADR-0005)—.

### 5. Las dos mitades tienen dueños distintos, y el alta por pantalla es la del padrón (#572)

Un usuario del SGTM vive en **dos sitios**: la cuenta del proveedor de identidad y la fila de
`usuario` (ADR-0005). Publicar `POST /seguridad/usuarios` exigía decidir antes cómo se coordinan,
y la decisión se tomó **midiendo el reparto que ya existe**, no eligiendo el que parecía razonable.

Lo medido, sobre `main` del 2026-09-02:

| Mitad | Quién la crea hoy | Para quién |
|---|---|---|
| Cuenta en Keycloak | `reconciliar-identidades.sh`, de `municipalidades/<ubigeo>.json` | **todos** los declarados |
| Fila de `usuario` | `ImplantarMunicipalidad` (perfil `batch`) | **sólo** el marcado `administrador: true` |

Y nada más creaba filas de `usuario`: `registrarUsuario` no tenía ruta, y en
[`infra/carga-de-datos/`](https://github.com/hneyra/sgtm/blob/migracion-a-microservicios/infra/carga-de-datos/README.md) hay un `cargar-cajas.sh` para
`area` y `caja` (#430) y **ninguno** para usuarios. De modo que **declarar un segundo usuario en el
archivo producía exactamente el estado malo**: cuenta sin fila, alguien que autentica y a quien el
guardia niega todo — y **sin ninguna forma de arreglarlo por el sistema**. El alta por pantalla no
introduce ese estado: le da dueño a la mitad que no lo tenía.

**La decisión, entonces: cada mitad conserva su dueño. El archivo declarativo sigue creando la
cuenta; la pantalla crea la fila. La aplicación no habla con Keycloak.**

#### 5.1 Quién crea la cuenta de Keycloak — la sigue creando el guion

La aplicación **no** la crea, y no es una preferencia de estilo. Medido: el backend no tiene **ni
un** cliente HTTP saliente en `src/main` —cero `RestClient`, `WebClient`, `RestTemplate` o
`HttpClient`—, y el `Deployment` sólo recibe `SGTM_OIDC_EMISOR` y `SGTM_OIDC_JWKS`, que son los dos
extremos **públicos y de lectura** con los que Spring Security valida una firma. Para crear una
cuenta haría falta una credencial de administración del realm, que es justo la clase de credencial
que [`ADR-0011`](ADR-0011-infraestructura-como-codigo.md) §3 mantiene fuera del alcance de la
aplicación —«claves de `sgtm_owner`, `sgtm_app`, administrador de Keycloak: **no están en
Pulumi**»—.

El precio de dársela no es teórico: el proceso que atiende el padrón pasaría a llevar dentro una
credencial capaz de crear cuentas —y de fijarles claves— **en todos los realms del servidor**, no
sólo en el de una municipalidad. Es más poder del que la pantalla necesita, en el proceso más
expuesto, para ahorrar un paso de provisión.

#### 5.2 Qué pasa si una de las dos mitades falla

Con el reparto de arriba **no hay escritura repartida**: el alta escribe **una fila en una
transacción**, así que desde el punto de vista de quien atiende es atómica. Lo que no es —ni puede
ser— atómico es el par, y por eso lo que el sistema tiene que hacer es **no fingir que lo es**:

- **Fila sin cuenta** — lo que produce esta pantalla. Aparece en el padrón, se le pueden dar
  permisos y **no puede entrar**. Es visible (está en `GET /seguridad/usuarios`), reversible
  (`POST /seguridad/usuarios/{id}/baja`) e inofensiva: sin la otra mitad no hay token que el
  guardia acepte. Se completa declarando la cuenta en `municipalidades/<ubigeo>.json`.
- **Cuenta sin fila** — la mitad peligrosa, la que existía y esta pantalla **cierra**: autentica y
  el guardia le niega todo, con el síntoma de un permiso mal configurado.

El endpoint no promete la otra mitad: su respuesta es la fila que escribió, y su documentación en
el contrato dice —con esas palabras— que **la cuenta se declara aparte**. Prometer «usuario
creado» sería la única forma de que quien atiende no supiera que le falta un paso.

#### 5.3 Qué hace la reconciliación con lo creado por pantalla — nada, y está medido

`reconciliar-identidades.sh` no tiene **ni una** sentencia de borrado: la única aparición de
«borra» en sus 521 líneas es el comentario que lo promete. Crea lo que falta, actualiza lo
declarado, y su comprobación final recorre **los usuarios declarados** —que existan, estén
`enabled`, tengan el atributo y estén en su grupo—. Una fila creada por pantalla vive en otra base
y el guion no la ve; una cuenta que el archivo no nombre se queda como está.

El costo, que hay que escribir porque no se ve: **una cuenta creada fuera del archivo no es
reproducible.** Reconstruir el clúster recrea lo que el archivo declara y nada más, que es
exactamente lo que este ADR existe para garantizar. Por eso la regla es que **la cuenta va al
archivo**: la pantalla da de alta la fila, y quien provisiona añade la línea. La alternativa
—descubrir en la reconstrucción que faltan las cuentas creadas en ventanilla— es el defecto que
`crear-usuario.sh` tenía y que este ADR cerró.

#### 5.4 De dónde sale `sujeto_oidc` — de ningún sitio, y por ahora sigue así

`usuario.sujeto_oidc` existe desde `V5` y es único por municipalidad. Medido: **nadie lo escribe**
—`Usuario.nuevo` pasa `null`, y no hay una sola llamada en `src/main` ni en `src/test` que ponga
otra cosa— y **nadie lo lee**: `ComprobadorDeAccesoJdbc` resuelve por `u.cuenta = :usuario`. El
enlace entre las dos mitades es, hoy, la **cuenta**.

El alta lo deja nulo, y las dos salidas que parecían mejores se descartaron por escrito:

- **Que el operador teclee el `sub`.** Es un UUID que quien atiende no tiene ningún motivo para
  tener. Tecleado mal enlaza con nadie, y `usuario_sujeto_uq` haría además que la persona correcta
  ya no se pudiera enlazar. Un dato que sólo puede estar bien copiándolo de una consola es un dato
  que va a estar mal.
- **Enlazarlo en el primer acceso.** Sería una escritura en el camino de lectura del guardia, sin
  observación de usuario (regla 10, RNF-052), y **seguiría sin distinguir** «no hay cuenta» de «hay
  cuenta y no ha entrado nunca», que es lo único que justificaría el mecanismo.

Lo que hace seguro que el enlace sea la cuenta es que **la cuenta no se puede cambiar**: ninguno de
los casos de uso de usuario la toca —`inhabilitarUsuario`, `habilitarUsuario` y
`fijarVigenciaDeUsuario` conservan la que hay— y el alta es lo único que la fija. Eso no es una
propiedad que se pueda dar por hecha, así que **la fija una prueba**: si algún día un endpoint
publica una corrección de `cuenta`, se pondrá roja, y entonces habrá que resolver `sujeto_oidc`
antes de mezclarla.

## Consecuencias

**Positivas**

- Reconstruir el clúster recrea las personas y el grupo de la municipalidad sin un paso manual
  que alguien recuerde.
- Ninguna clave en git, y ninguna clave que el operador teclee o pegue: la exposición es un
  enlace de un solo uso que caduca.
- El conjunto de usuarios de una municipalidad se revisa en un diff.
- La cuenta del administrador no puede divergir entre Keycloak y la base.

**Negativas / costos aceptados**

- **Sin relay, la primera clave la reparte un operador.** El alta crea al usuario y el sistema
  queda administrable, pero cada uno necesita que alguien le fije una clave temporal a mano
  hasta que exista un relay. Es un costo real de operación, no un bloqueo: la alternativa
  —exigir relay para desplegar— dejaba `prod` sin poder implantar por una pieza que aún no
  está decidida (D-05).
- **Dos derivadores del TSV** —`Identidad.ts` para el clúster, el python del guion para el
  compose—, porque la imagen de Keycloak no trae con qué parsear JSON. La trampa es que se
  separen; lo limita que los dos validan lo mismo y `componentes.test.ts` compara.
- **El `municipalidadId` se copia a mano** del log de implantación al archivo. Un número
  equivocado lo caza el cruce a tres bandas de `despliegue.yml`, no antes.
- **Una municipalidad por stack, por ahora.** `Identidad.ts` reconcilia la del `sgtm:ubigeo`
  implantado. Gestionar varias a la vez es trabajo posterior.

## Alternativas consideradas

- **Usuarios en el realm versionado, con `partialImport`.** Es lo que el issue #151 dejó
  preparado para clientes. Se descarta para personas: `partialImport OVERWRITE` sobre un usuario
  lo borra y lo recrea —pierde la clave—, y `SKIP` no reconcilia atributos. Y un realm con
  usuarios es el camino corto a una contraseña versionada.
- **Clave aleatoria temporal, entregada por un `Secret` efímero.** Funciona sin SMTP, pero deja
  una clave real —aunque temporal— en un `Secret` que alguien lee y tiene que acordarse de
  borrar. El enlace por correo no deja clave en ningún sitio.
- **El id de municipalidad resuelto por el Job consultando PostgreSQL.** Evita copiar el número,
  pero mete una dependencia de la base en un Job de Keycloak. Se prefirió el número en el archivo
  con verificación.
- **Que `ImplantarMunicipalidad` cree también la identidad en Keycloak.** Tiene el id en la mano,
  pero cruza la separación backend/identidad que el repositorio mantiene a propósito (el realm
  fija la estructura; las personas las crea quien provisiona).
- **Grupos de Keycloak que alimenten el claim.** El mapeador actual es de atributo de usuario;
  un atributo de grupo no se expone sin otro mapeador. El grupo queda como contenedor
  organizativo y el claim sigue saliendo del atributo por usuario, sin tocar el mapeador.

## Enlaces

- [`ADR-0005`](ADR-0005-identidad-y-acceso.md) — OIDC para autenticar ·
  [`ADR-0011`](ADR-0011-infraestructura-como-codigo.md) §3, §5 — la frontera con los secretos y
  con el flujo de liberación
- [`INF-06`](https://github.com/hneyra/sgtm/blob/migracion-a-microservicios/docs/80-infraestructura/gestion-de-secretos.md) §1.2 — el `Secret` `sgtm-<amb>-smtp`
- [Recuperar el acceso de un usuario](https://github.com/hneyra/sgtm/blob/migracion-a-microservicios/docs/B0-operacion/runbooks/recuperar-el-acceso-de-un-usuario.md)
  — el runbook para cuando el correo no llega
- [`despliegue/identidad/README.md`](../../../despliegue/identidad/README.md) ·
  [`despliegue/identidad/municipalidades/README.md`](../../../despliegue/identidad/municipalidades/README.md)
- `ImplantarMunicipalidad` — el otro lado del alta: la fila de `usuario`, el grupo del dominio y
  los permisos
