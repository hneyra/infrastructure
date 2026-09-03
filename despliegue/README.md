# Despliegue: la plataforma, y lo que cada sistema levanta contra ella

Desde ADR-0031 §4 hay **dos composes**, y la diferencia no es de tamaño:

| Archivo | Qué levanta | Quién lo usa |
|---|---|---|
| [`plataforma.compose.yaml`](plataforma.compose.yaml) | PostgreSQL con **las cuatro bases**, Keycloak con **sus dos realms**, el buzón de correo y Traefik con el enrutado por prefijo | **Todo el mundo, siempre.** Es el suelo |
| [`compose.yaml`](compose.yaml) | Lo anterior más la migración, la implantación, la aplicación y la interfaz | **El perfil `todo`**: pruebas de integración y CI |

```bash
# La plataforma. Es lo que se levanta una vez y se deja.
docker compose -f despliegue/plataforma.compose.yaml up -d

# El perfil `todo`, para integración y para CI. NO se retira: es el de siempre.
cd despliegue && docker compose up --build --wait aplicacion interfaz correo
```

**Por qué partirlo.** Levantar cuatro backends, cuatro frontends, Keycloak y PostgreSQL en un
portátil es pesado, y la respuesta correcta no es un compose más grande. El desarrollador de
catastro no necesita rentas arriba salvo para las pantallas que cruzan — **y que lo necesite
para trabajar en catastro es una señal de que la frontera está mal puesta**, no una molestia.

## Cómo levanta un sistema lo suyo

Cada repositorio de sistema trae su propio compose, con **sólo su backend y su frontend**, y se
engancha a la red de la plataforma. No copia PostgreSQL ni Keycloak: los usa.

```yaml
# catastro/despliegue/compose.yaml
name: kamayuk-catastro

services:
  aplicacion:
    build: ../backend
    environment:
      # Su base, no la de otro. Las cuatro las creó `05-crear-bases.sh`.
      SGTM_DB_URL: jdbc:postgresql://base:5432/catastro
      SGTM_DB_USUARIO: sgtm_app
      SGTM_DB_CLAVE: ${SGTM_CLAVE_APP:?}
      # El mismo emisor que los otros tres: un login para los cuatro (ADR-0030 §3).
      SGTM_OIDC_EMISOR: ${SGTM_OIDC_EMISOR:-http://localhost:8180}/realms/sgtm
    labels:
      # Su prefijo, y sólo el suyo. Reclamar el de otro no falla: se lo queda.
      - traefik.enable=true
      - traefik.http.routers.catastro.rule=PathPrefix(`/catastro`)
      - traefik.http.services.catastro.loadbalancer.server.port=8080

# La red de la plataforma, que ya existe. `external: true` es lo que impide que este
# compose cree una segunda con el mismo nombre y deje a los servicios sin verse.
networks:
  default:
    name: kamayuk-plataforma
    external: true
```

```bash
docker compose -f despliegue/plataforma.compose.yaml up -d   # una vez
cd ../catastro && docker compose up --build                  # lo suyo, contra ella
```

Tres cosas de ese archivo no son detalle:

- **`networks.default.external: true`.** Sin él, Compose crea una red nueva con el mismo
  nombre y los servicios no se ven — el síntoma es «Connection refused» a `base`, que se lee
  como que el motor no está.
- **La etiqueta de Traefik lleva su prefijo y sólo el suyo.** Es la misma regla que
  `descriptor/auditoria.ts` aplica en el clúster (prohibición (a)): un sistema que reclama el
  prefijo de otro no da error, se lo queda, y las peticiones dejan de llegar a su dueño.
- **Cada sistema apunta a SU base.** Las cuatro existen desde el primer arranque de la
  plataforma; pedir la de otro es la prohibición (c), y aquí no hay auditoría que lo impida —lo
  impide el rol, que sólo tiene privilegios sobre la suya—.

## La trampa que esto hereda, y que sigue sin resolverse

ADR-0011 anotó el riesgo de **dos formas de levantar el sistema**: que se separen, que una
variable nueva entre en el clúster y no en el compose. Con dos composes y cuatro sistemas se
multiplica. La mitigación escrita sigue siendo la buena y no ha cambiado: que las comprobaciones
de `despliegue.yml` se trasladen al clúster en vez de duplicarse.

Lo que sí hay desde hoy es una guarda que lee los dos archivos y compara:
`infra/verificaciones/plataforma-compose.test.ts` exige que el motor sea la misma imagen en los
dos, que las cuatro bases estén declaradas, que el guion que las crea corra **antes** que el de
los roles, que los dos realms se siembren, y que los dos composes **no compartan volumen** —los
guiones de `initdb` sólo corren con el volumen vacío, así que compartirlo dejaría al segundo sin
ejecutarlos, y el síntoma sería una base que falta y ningún error—.

---

# La marcha blanca (el perfil `todo`)


Motor, identidad, migración, aplicación e interfaz. Es lo mínimo para que el
sistema **arranque y alguien pueda entrar**; hasta hace poco no existía nada de
esto, y no por grado de avance
([GOB-04 §1](../docs/00-gobierno/plan-de-marcha-blanca.md)).

```bash
cd despliegue
cp .env.ejemplo .env          # y poner claves generadas, una distinta por rol
./identidad/datos-de-implantacion.sh 200101 >> .env   # el administrador, del archivo versionado
docker compose up --build --wait aplicacion interfaz correo
./identidad/reconciliar-identidades.sh                # crea los usuarios de municipalidades/*.json
```

La interfaz queda en <http://localhost:8081>, Keycloak en <http://localhost:8180> y el buzón de
correo (Mailpit) en <http://localhost:8025> — ahí llega el enlace con que cada usuario nuevo fija
su clave en el primer acceso (ADR-0012).

## Las piezas y su orden

```
base ──(sana)──► migraciones ──► implantación ──(termina con éxito)──┐
                                                                     ├──► aplicación ──► interfaz
identidad ──(arrancada)──────────────────────────────────────────────┘
```

| Servicio | Rol con que se conecta | Vive |
|---|---|---|
| `base` | superusuario, solo dentro del contenedor | siempre |
| `identidad` | Keycloak, con su propio administrador | siempre |
| `correo` | Mailpit: buzón que atrapa el correo de Keycloak (el enlace de clave del alta declarativa) | siempre |
| `migraciones` | `sgtm_owner` — **el único con DDL** | corre y termina |
| `implantacion` | `sgtm_owner` para **una** sentencia; el resto como `sgtm_app` | corre y termina |
| `aplicacion` | `sgtm_app` — sin DDL, sin `BYPASSRLS`, sin `DELETE`, propietaria de nada | siempre |
| `interfaz` | nginx: sirve la aplicación y reenvía `/api/v1` | siempre |

El orden no es una preferencia de arranque. Un esquema a medias con la aplicación
ya sirviendo peticiones es el estado que `depends_on:
service_completed_successfully` existe para impedir.

**Las credenciales de `sgtm_owner` no entran nunca en el contenedor de la
aplicación.** Por eso son dos imágenes distintas del mismo árbol de fuentes
([`backend/Dockerfile`](../backend/Dockerfile)) y no una con dos modos: un proceso
de larga vida expuesto en HTTP no puede tener DDL sobre el padrón de todas las
municipalidades (ARQ-03 §4).

## Qué hace cada pieza al arrancar por primera vez

1. **`base`** inicializa el volumen y ejecuta, en orden alfabético, los dos
   guiones montados en `docker-entrypoint-initdb.d`:
   `crear-roles.sql` —montado desde el módulo del esquema, no copiado— crea los
   cuatro roles **sin `LOGIN` y sin clave**, y luego
   `20-asignar-claves.sh` les asigna `LOGIN` y clave desde el `.env`.
   Los roles no pueden ir en una migración: una política de `V6__rls.sql` los
   nombra, y un rol no puede crearse a sí mismo.
2. **`migraciones`** comprueba el ambiente y aplica lo que falte, como
   `sgtm_owner`. Antes de migrar se niega si faltan los cuatro roles, y se niega
   si quien migra es superusuario o tiene `BYPASSRLS`: lo que la prueba de
   aislamiento demuestra, lo demuestra sobre objetos creados por un `sgtm_owner`
   sin privilegios de más.
3. **`identidad`** importa el realm y queda emitiendo. La aplicación **no** la
   espera, y no es un descuido: con `jwk-set-uri` configurado, el validador se
   construye sin descubrimiento y las claves se piden la primera vez que llega un
   token. Quien sí tiene que esperarla es quien vaya a pedir uno.
4. **`aplicacion`** arranca con `spring.flyway.enabled: false` —no migra, no
   puede— y publica una sola cosa sin identidad: `/actuator/health`.
5. **`interfaz`** sirve los archivos estáticos y reenvía `/api/v1` al backend, así
   que el navegador nunca habla con él directamente y no hay CORS que configurar.

Las claves se asignan **una sola vez**, cuando el volumen está vacío. Para
rotarlas hay que hacerlo contra la base ya existente, no reiniciando el
contenedor.

## La identidad

El realm está versionado en [`identidad/realm-sgtm.json`](identidad/realm-sgtm.json)
y se importa al arrancar: un realm configurado a mano en una pantalla no es
reproducible. Fija los dos clientes, el PKCE obligatorio y **el mapeador que pone
`municipalidad_id` en el token**, que es el claim del que sale el `SET LOCAL` y con
él la separación entre municipalidades (ADR-0005).

**Lo que el realm no trae es ni un usuario ni una clave.** Un realm versionado con
usuarios es la forma más cómoda de que una contraseña acabe en producción. Las
personas y el grupo de cada municipalidad se declaran —**sin clave**— en
[`identidad/municipalidades/<ubigeo>.json`](identidad/municipalidades/README.md) y los
aplica `identidad/reconciliar-identidades.sh` (ADR-0012): el usuario nuevo recibe un
correo de Keycloak —que en la marcha blanca cae en el buzón `correo`— con un enlace de
un solo uso y **fija su clave en el primer acceso**. `identidad/crear-usuario.sh` sigue
existiendo para los usuarios `verificacion` de CI, que necesitan una clave conocida; con
`--reset` hace lo mismo que el alta declarativa.

Sin SMTP no llega el correo. En el compose lo cubre el servicio `correo`; si se levanta
sin él, `reconciliar-identidades.sh` falla al enviar y apunta al fallback:
`kcadm set-password --temporary` a mano, o `SIN_CORREO=1` para crear el usuario sin clave.

Un detalle que cuesta una tarde si se descubre por las malas: **el emisor es una
identidad, no una dirección de red**. El navegador llega a Keycloak por su nombre
público y el backend por el interno de la red del compose. Por eso `issuer-uri`
—lo que se compara con el `iss` del token— es el público, y `jwk-set-uri` —de dónde
se traen las claves— es el interno.

## La implantación

`implantacion` corre una vez por despliegue, con la misma imagen que la aplicación
en perfil `batch`, y deja el sistema **administrable**:

1. da de alta la municipalidad —es la única escritura que necesita `sgtm_owner`,
   una sentencia, en una conexión que se abre y se cierra ahí—;
2. siembra los accesos de las 134 opciones del catálogo;
3. crea el grupo de administración y el primer administrador;
4. le otorga los siete privilegios sobre las once opciones de seguridad, **y
   ninguna más**.

Lo cuarto es deliberadamente poco: con eso el administrador puede repartir el
resto del sistema según quién haga qué en la municipalidad. Darle de entrada las
134 opciones sería más cómodo el primer día y dejaría una cuenta con todo para
siempre, porque nadie vuelve a quitarle nada a la cuenta que funciona.

**Es idempotente entera**: se ejecuta en cada despliegue, lo que ya existe se
queda como está —con los permisos que alguien haya configurado después— y lo que
falta se crea.

Dos cosas que no hace, y conviene saberlas:

- **No crea ninguna contraseña.** El sistema no guarda claves ni las transporta
  (ADR-0005). La credencial vive en Keycloak: `SGTM_ADMINISTRADOR` tiene que ser
  la misma cuenta que el usuario marcado `administrador: true` en el archivo de la
  municipalidad —de ahí lo saca `identidad/datos-de-implantacion.sh`—, porque es lo
  único que une la fila con la identidad del token.
- **No fija ningún ejercicio de trabajo.** El ejercicio vive en `sesion`, es de
  cada sesión y se elige al entrar.

## Lo que todavía no hay
- **Esto no es una instalación de producción.** Un solo nodo, sin copias de
  seguridad programadas, sin TLS y con los puertos publicados en claro. Keycloak
  corre en `start-dev`, que guarda su base en el propio contenedor. Para la marcha
  blanca, delante va un proxy con TLS.

## Cómo se verifica

`.github/workflows/despliegue.yml` **levanta** esta instalación en CI y le hace
preguntas al sistema en marcha. La central es la **escalera de identidad**, donde
cada peldaño responde con su código del catálogo — y el código es lo que hace la
aserción precisa, porque dice *hasta dónde* llegó la petición:

| Petición | Respuesta |
|---|---|
| sin token | `401 NO_AUTENTICADO` |
| con algo que no es un token | `401 NO_AUTENTICADO` |
| con un token de otro emisor | `401 NO_AUTENTICADO` |
| con token del realm, **sin** el claim | `403 SIN_MUNICIPALIDAD` |
| el administrador, en toda la municipalidad | `200` (seguridad **y** catastro) |
| con el claim, pero sin fila de usuario | `403 SIN_PRIVILEGIO` |

Los dos últimos peldaños son los que importan, y hay que leerlos juntos: el `200`
cierra el camino entero —Keycloak emite, el backend valida, el claim se lee, la
municipalidad está implantada y con sus permisos sembrados (el servicio
`implantacion` del compose corre antes que la aplicación), el usuario de la base
está enlazado por su cuenta— y llega a **todo** el catálogo, porque el
administrador inicial administra la municipalidad entera (#275); y
`SIN_PRIVILEGIO` —una cuenta con el claim pero sin permisos— dice que esos
permisos son una barrera y no un sello.

A las filas mismas llega, por su lado,
[`CadenaDeIdentidadTest`](../backend/sgtm-plataforma/src/test/java/pe/gob/sgtm/plataforma/identidad/CadenaDeIdentidadTest.java),
en `./gradlew build`: token firmado → cadena → claim → `SET LOCAL` → **las filas
que RLS deja ver**, contra PostgreSQL y como `sgtm_app`. Las dos hacen falta —una
habla con el Keycloak de verdad, la otra llega a las filas— y ninguna sustituye a
la otra.

Otra pregunta que la escalera no puede hacer: **sin `SGTM_OIDC_EMISOR`, la
aplicación tiene que negarse a arrancar.** Se arranca la misma imagen a mano, sin
esa variable y con todo lo demás puesto; si sigue viva a los dos minutos, el paso
se pone rojo. Un backend que arranca sin emisor responde a la sonda, se declara
sano y no atiende a nadie.

Y la que da valor al resto: **las credenciales que el contenedor de la aplicación
tiene de verdad no pueden crear una tabla**. Se demuestra que puede fallar
cambiando en `compose.yaml` el `SGTM_DB_USUARIO` por `sgtm_owner`: el trabajo se
pone rojo. Lee las credenciales del contenedor en marcha, no las que el compose
debería tener.
