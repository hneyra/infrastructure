# DEV-01 — Entorno local

| Campo | Valor |
|---|---|
| Estado | Vigente |
| Verificado en | macOS 15 (arm64), JDK 25 (Temurin 25.0.4), Node 26.7, yarn 1.22.22, PostgreSQL 16.15 (Homebrew) y Docker Engine 29.1.3 |

## 1. Prerrequisitos

| Herramienta | Versión | Para qué |
|---|---|---|
| Node | **22** | El descriptor, las herramientas y las verificaciones. Es la que fija CI |
| yarn | 1.22 (clásico) | |
| JDK | **25** | `librerias-backend`. ADR-0001 |
| Docker | Engine 29 con Compose v2 | La plataforma local |
| PostgreSQL | **16** | Los guiones que se verifican contra un motor real |
| Pulumi | — | **No hace falta para nada de lo de aquí.** Sólo para desplegar |

**Que `yarn verificar` no necesite Pulumi, ni token, ni clúster es deliberado**: la parte que
puede equivocarse a diario —un límite que falta, una sonda sin plazo, una ruta fuera del prefijo—
se detecta en la máquina de quien lo escribe.

## 2. El descriptor

```bash
yarn install          # arrastra `infra/` por el postinstall
yarn verificar        # lint, tipos y pruebas
```

`yarn verificar` es `lint && typecheck && test`, y **`typecheck` compila dos `tsconfig`**: el del
código y `tsconfig.test.json`. `tsc --noEmit` a secas no basta y deja pasar errores de las
pruebas.

## 3. Las barreras comunes

```bash
cd librerias-backend
./gradlew build
```

`./gradlew build` sale en verde con **cero pruebas**, y es correcto: aquí no hay ninguna. Lo que
esta librería contiene son las reglas, sus 40 muestras y las **clases base** que cada backend
deriva — así que las reglas sólo demuestran que muerden cuando las ejecuta un consumidor (§3 de
[DEV-02](pruebas.md)).

`comun-verificaciones` es un **build propio**, no un módulo de ningún repositorio: si viviera
dentro de uno, los otros cuatro dependerían de ése, que es justo lo que la separación deshace. Los
cinco backends la consumen con `includeBuild`, así que **cualquier cambio aquí se compila desde el
fuente en el siguiente build de los cinco**. No puede quedarse vieja.

Para ver el efecto en un consumidor hay que correrlo desde el consumidor:

```bash
cd ../../rentas/backend && ./gradlew cleanTest verificarArquitectura --no-build-cache
```

**La librería no tiene Checkstyle ni NullAway todavía**, sólo Spotless con el mismo formato que
los cinco. Añadirlos exige extraer el `buildSrc` del monolito, que no está hecho.

## 4. La plataforma local

Es lo que todo el mundo levanta, siempre: PostgreSQL con **las cinco bases**, Keycloak con **sus
dos realms**, el buzón de correo y Traefik con el enrutado por prefijo. Nada de esto es de ningún
sistema.

```bash
# Todo: el .env si falta, la plataforma, el sistema que se le pida y sus identidades
cd despliegue && ./levantar-todo.sh identidad

# O sólo la plataforma
./levantar-todo.sh
```

**El `.env` ya no se copia a mano**: `levantar-todo.sh` lo genera de `.env.ejemplo` con una clave
distinta por marcador si no existe, y lo deja en modo 600. La receta con `sed` que recomendaba la
cabecera de `.env.ejemplo` **no funcionaba** —medido: seis marcadores, **una sola clave**, porque
`$(openssl …)` lo expande la shell una vez antes de que `sed` corra, y su propio comentario decía
«una por línea, no todas iguales»—. Y `CAMBIAR_.*` alcanzaba además su propia línea de comentario.

A mano, si hace falta, es esto —lo que el guión hace por dentro, **anclado a las líneas de
asignación** para no tocar los comentarios:

```bash
cp despliegue/.env.ejemplo despliegue/.env
python3 - <<'PY'
import re, secrets, pathlib
env = pathlib.Path('despliegue/.env')
env.write_text(re.sub(r'(?m)^([A-Z_]+)=CAMBIAR_\w+$',
                      lambda m: f"{m.group(1)}={secrets.token_hex(24)}", env.read_text()))
PY

docker compose -f despliegue/plataforma.compose.yaml up -d --wait
```

**Y un sistema contra ella necesita `--env-file`**, que no estaba escrito en ningún sitio (#74): los
cinco composes interpolan variables del `.env` de la plataforma, ninguno declara `env_file:` y
ninguno tiene `.env` propio. Sin él, el `up` muere en el primer `${...:?}`.

```bash
docker compose -f ../identidad/despliegue/compose.yaml \
  --env-file despliegue/.env up --build --wait
```

### Y para que un token SIRVA hacen falta cuatro pasos más

Los hace [`despliegue/identidad/preparar-identidades.sh`](../../despliegue/identidad/preparar-identidades.sh),
que `levantar-todo.sh` encadena **después** de levantar el sistema —su último paso necesita el `id`
que la secuencia le dio a la municipalidad, y esa fila la escribe la implantación—. Es idempotente,
imprime al terminar las credenciales que el arnés de `identidad` necesita, y **tres de sus cuatro
pasos son rodeos de defectos abiertos**
([#72](https://github.com/hneyra/infrastructure/issues/72),
[#73](https://github.com/hneyra/infrastructure/issues/73),
[#74](https://github.com/hneyra/infrastructure/issues/74)), cada uno etiquetado con su número dentro
del guión para que se caiga a trozos el día que se cierren. El detalle está en
[`despliegue/README.md`](../../despliegue/README.md).

Lo mismo corre en CI —la plataforma, `identidad` y las 55 preguntas de su e2e— en cada PR que toque
la plataforma y una vez al día:
[`arranque-en-limpio.yml`](../../.github/workflows/arranque-en-limpio.yml). Es el flujo que habría
cazado #71, #72 y #73 el primer día; hasta ahora **ninguno de los seis repositorios levantaba la
plataforma en CI** — medido: cero `docker compose up`.

`.env` se lee de `despliegue/`, que es el directorio del archivo de compose, no del que ejecuta.

**Si tu `DOCKER_HOST` apunta a un demonio remoto, ese comando no vale tal cual.** El compose monta
rutas relativas al árbol —`./inicializacion-del-motor/…` y
`../backend/sgtm-esquema/…/crear-roles.sql`— y un *bind mount* lo resuelve **el demonio**, no el
cliente: si no existen allí, el motor arranca **sin ejecutar sus guiones de inicialización y sin
ningún error**. Hay que copiar `despliegue/` y `backend/` a una ruta que exista **igual en las dos
máquinas** y levantar desde ahí. Ver [DEV-03 §4](solucion-de-problemas.md).

### 4.1 Qué queda levantado, y cómo se comprueba

`--wait` no basta como prueba de que la plataforma sirve. Esto es lo que se ejecutó, y lo que
devolvió:

Los comandos usan el puerto por omisión; si lo moviste (§5), añade `-p $KAMAYUK_PUERTO_BASE`.

```bash
export PGPASSWORD=$(grep '^KAMAYUK_CLAVE_SUPERUSUARIO=' despliegue/.env | cut -d= -f2)

# Las cinco bases
psql -h 127.0.0.1 -U postgres -d postgres -tAc \
  "select datname from pg_database where datistemplate = false order by 1"
#   caja · catastro · identidad · normativa · postgres · rentas
#
# Eran cuatro hasta ADR-0039 y esta linea decia cuatro: `identidad` es la quinta, y una
# comprobacion que no la espera pasa en verde con la base del dueno de la autorizacion
# ausente — que es justo el estado en el que nadie puede entrar a ningun sistema.

# Los cuatro roles, y NINGUNO superusuario ni con BYPASSRLS
psql -h 127.0.0.1 -U postgres -d postgres -tAc \
  "select rolname, rolsuper, rolbypassrls, rolcanlogin from pg_roles
    where rolname ~ '^(sgtm|rol_)' order by 1"
#   rol_carga_parametros|f|f|t · kamayuk_app|f|f|t · kamayuk_owner|f|f|t · kamayuk_readonly|f|f|f

# Las extensiones, que van EN CADA BASE y no en el cluster
psql -h 127.0.0.1 -U postgres -d catastro -tAc "select extname from pg_extension order by 1"
#   btree_gist · pg_trgm · plpgsql · postgis · unaccent

# Los dos realms
curl -s http://localhost:8180/realms/kamayuk/.well-known/openid-configuration | head -c 60
curl -s http://localhost:8180/realms/kamayuk-ciudadano/.well-known/openid-configuration | head -c 60

# Traefik: 404 es lo CORRECTO, esta vivo y no hay ningun sistema detras
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/rentas
```

`kamayuk_readonly` sale con `rolcanlogin = f`, y es correcto: un rol de lectura sin `LOGIN` no se usa
hasta que alguien decida darle credencial.

### 4.2 `--wait` vuelve antes de que Keycloak sirva

Medido: base, buzón y Traefik quedan `healthy` en segundos, y el `.well-known` de los realms tardó
unos **treinta segundos más** en contestar `200`. No es un fallo — Keycloak no declara sonda en
este compose, así que `--wait` sólo comprueba que el contenedor corre. Espera por lo que
necesitas:

```bash
until curl -sf http://localhost:8180/realms/kamayuk/.well-known/openid-configuration > /dev/null
do sleep 5; done
```

### 4.3 Los dos composes

| Archivo | Qué levanta | Quién lo usa |
|---|---|---|
| `plataforma.compose.yaml` | La plataforma: base, identidad, buzón y enrutado | **Todo el mundo, siempre** |
| `compose.yaml` | Lo anterior más la migración, la implantación, la aplicación y la interfaz **del monolito** | CI e integración |

`compose.yaml` es el del monolito y **sigue tal cual**. No levanta ninguno de los cuatro sistemas
nuevos, porque todavía no existe ninguna imagen suya.

## 5. Puertos, y cuándo hay que moverlos

| Puerto | Quién | Variable |
|---|---|---|
| 5432 | PostgreSQL | `KAMAYUK_PUERTO_BASE` |
| 8080 | Traefik | `KAMAYUK_PUERTO_INGRESO` |
| 8180 | Keycloak | `KAMAYUK_PUERTO_IDENTIDAD` |
| 8025 | Mailpit | `KAMAYUK_PUERTO_CORREO` |

En un demonio compartido —una máquina con otra instalación corriendo— los cuatro chocan. Se mueven
en el `.env`, sin tocar el compose. **Y si mueves el de Keycloak, mueve `KAMAYUK_OIDC_EMISOR` con
él**: es lo que Keycloak escribe en el `iss` de cada token y lo que el backend compara; con dos
nombres distintos la firma valida, el emisor no cuadra, y el 401 no dice por qué.

## 6. El `.env`

No se versiona, y si alguna vez aparece en un diff, la clave que lleve deja de ser una clave: hay
que **rotarla**, no borrarla del commit. Una clave **distinta por rol**: si el superusuario,
`kamayuk_owner` y `kamayuk_app` comparten clave, la separación de privilegios entera es decorativa.

**Ningún secreto de la aplicación vive en el estado de Pulumi** (ADR-0011 §3): los genera
`infra/secretos/bootstrap-secretos.sh` hablando con el API de Kubernetes por `kubectl`.

## 7. Editor

IntelliJ IDEA: importar `librerias-backend/` como proyecto Gradle, con el JDK del proyecto en 25.
`infra/` funciona solo con las extensiones de ESLint y Prettier.
