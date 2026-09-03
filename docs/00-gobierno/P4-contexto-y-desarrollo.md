# P4 — `CLAUDE.md`, `.claude` y `D0-desarrollo` en los cinco repositorios

**Fecha:** 2026-09-04. **Repositorios tocados:** `infrastructure`, `rentas`, `catastro`,
`normativa`, `caja`. **`sgtm` no se modificó**: sólo se leyó.

Objetivo de la etapa: que quien abra cualquiera de los cinco pueda trabajar **sin leer los otros
cuatro**.

---

## 1. Los cinco `CLAUDE.md`, con su cifra

Ninguno pasa de 200 líneas, que era el criterio. Medido con `wc -l` sobre el árbol final:

| Repositorio | Líneas |
|---|---:|
| `infrastructure` | **183** |
| `rentas` | **191** |
| `catastro` | **191** |
| `normativa` | **195** |
| `caja` | **187** |

**Derivados, no copiados.** El de `sgtm` tiene 706 líneas y 288 de ellas son la tabla «Verificar
antes de afirmar». Lo que se conserva son las **diez reglas con su motivo**, el idioma, la
estructura, la tabla «antes de escribir código, leer», los comandos y las decisiones abiertas que
le apliquen a cada uno. Lo que se reescribe es **qué hay hoy** y **por dónde entrar**, con lo que
ese repositorio tiene de verdad.

Para que las partes comunes no puedan divergir se escribieron **una sola vez** y se ensamblaron:
las diez reglas y el bloque de idioma son byte a byte idénticos en los cinco, y el bloque de
comandos, idéntico en los cuatro sistemas.

**La tabla «Verificar antes de afirmar» hereda vacía**, con su cabecera, su regla de uso y una
línea que dice que el registro anterior vive en `sgtm` y no viaja: en un repositorio sin ese
`git log` sería el registro de un trabajo que allí no se hizo.

**Y cada uno dice con todas las letras lo que NO hace.** No es relleno: es lo que impide que un
agente invente una capacidad que no existe. `catastro` no calcula impuesto ni deriva el área del
polígono; `normativa` no llama a nadie, y si algún día necesitara egreso lo que está mal es la
arquitectura; `caja` no imputa el abono; `rentas` no valoriza el predio; `infrastructure` no
contiene una sola regla de negocio.

## 2. Qué se corrigió de lo que ya estaba, porque había dejado de ser cierto

Los cuatro `README.md` de los sistemas decían **`backend/` — el código | NO existe. Etapa 5** y
**su CI sólo verifica el descriptor**. P3 dejó las dos frases falsas: hay `backend/` con dos
módulos y CI con tres flujos. Corregido en los cuatro, sin tocar el resto.

## 3. `.claude/settings.local.json`

Uno por repositorio, con los permisos que **ése** necesita: las tareas Gradle que existen
(`verificarArquitectura`, `verificarAislamiento`, `build`, `cleanTest`, `spotlessApply`), `yarn`,
`node`, `git` sin `push`, `docker compose` **acotado al compose de la plataforma**, el PostgreSQL
16 de Homebrew, y lectura de los repositorios hermanos que de verdad se consultan. No se copió la
lista de `sgtm`: buena parte son rutas de un worktree que ya no existe.

**Los cinco archivos quedan sin versionar, y no por descuido:** el `~/.config/git/ignore` del
usuario tiene `**/.claude/settings.local.json`, igual que en `sgtm`. Existen en el disco y no
aparecen en ningún commit. `.claude/worktrees/` no se copió.

## 4. `docs/D0-desarrollo/`

Cuatro documentos por repositorio: `README.md`, `entorno-local.md` (DEV-01), `pruebas.md`
(DEV-02) y `solucion-de-problemas.md` (DEV-03).

**Lo que se corrigió del de `sgtm`, porque ya no es cierto:**

| Lo que decía `sgtm` | Lo que dice ahora, y por qué |
|---|---|
| «La interfaz sola, con su proxy de datos» | **No hay interfaz.** Se dice que no hay nada que arrancar: ni `bootRun`, ni API, ni pantalla |
| «`docker compose up` en `despliegue/`» | La plataforma vive en `infrastructure` y se levanta con `plataforma.compose.yaml`; cada sistema levantará lo suyo contra ella |
| «`-Dsgtm.pruebas.postgres.url`» | Es **`-Dkamayuk.pruebas.postgres.url`** |
| «Docker, con Compose» a secas | **PostgreSQL 16**, y se dice que en 18 el esquema no corre |
| Las tres formas A/B/C eran interfaz / interfaz+backend / instalación completa | Son **barreras de arquitectura / las dos barreras / la plataforma** |
| Nada sobre el clon hermano | `infrastructure` al lado **no es opcional**: sin él Gradle no llega a configurar |

**Y lo que se añadió es lo que costó medirlo**, que es la parte que no se puede copiar de ningún
sitio: los cinco fallos de DEV-03 salieron de ejecutar, no de razonar. Ver §6.

## 5. `estandares-de-codigo-backend.md` (ARQ-04) se mudó aquí

Vive en `infrastructure/docs/30-arquitectura/`, junto a `comun-verificaciones`, y los cuatro lo
enlazan. Son las mismas reglas y las verifica el mismo artefacto; dos copias serían dos estándares
el día que alguien edite una.

Se adaptó, no se copió tal cual: rutas de paquete (`kamayuk.<sistema>`), la ruta de las muestras,
la **undécima regla** —ningún SQL cruza la frontera de sistema—, el descubrimiento de la
configuración por `ServiceLoader` y la exigencia de PostgreSQL 16.

## 6. El AC 1, ejecutado: seguir cada `D0-desarrollo/README.md` desde cero

**Se hizo de verdad.** Máquina: macOS 15 arm64, JDK 25.0.4 (Temurin), Node 26.7.0, yarn 1.22.22,
PostgreSQL 16.15 (Homebrew) en el puerto 55432, Docker Engine 29.1.3 (API 1.52, MinAPI 1.44) a
través de un túnel a un demonio remoto.

### 6.1 Los cuatro sistemas: todos los pasos en verde

| Paso del README | `rentas` | `catastro` | `normativa` | `caja` |
|---|---|---|---|---|
| «Lo primero»: `infrastructure` hermano | presente | presente | presente | presente |
| 1 · `java -version && node --version && yarn --version` | ok | ok | ok | ok |
| 2 · `./gradlew verificarArquitectura` | **79/79** | **79/79** | **79/79** | **79/79** |
| 3 · `yarn install && yarn verificar` | 7/7 | 6/6 | 6/6 | 6/6 |
| DEV-01 §3B · `verificarAislamiento` | **9/9** | **9/9** | **9/9** | **9/9** |
| Guarda de #711 | 6/6 | 6/6 | 6/6 | 6/6 |

**Cero pruebas omitidas en los cuatro.** Las cifras salen de los XML de
`build/test-results/`, no de la memoria, y las corridas fueron con `cleanTest` y
`--no-build-cache`: la primera medida dio `FROM-CACHE`, que es un número que no demuestra nada.

`verificarAislamiento` se corrió por la salida documentada —`-Dkamayuk.pruebas.postgres.url`
contra el PostgreSQL 16 local—, **y no por comodidad**: ver §6.3.

### 6.2 `infrastructure`: un paso falla, y el fallo es el hallazgo

| Paso del README | Resultado |
|---|---|
| 1 · versiones | ok |
| 2 · `yarn install && yarn verificar` | **ROJO: 337 verdes, 7 rojas en 2 archivos** |
| 3 · `cd librerias-backend && ./gradlew build` | BUILD SUCCESSFUL, **0 pruebas** (correcto: aquí no hay ninguna) |
| `yarn manifiestos --ambiente stg` | ok |
| `yarn capacidad --ambiente prod` | ok — «permanente 1540m/4256Mi · pico 1760m/5344Mi · cabe» |
| `yarn secretos --ambiente stg` | ok |
| Guarda de #711 | 6/6 |

**Las 7 rojas son heredadas de la mudanza, ninguna la introdujo esta etapa, y ninguna se arregla
sin tomar una decisión.** Están escritas con su causa y su reproducción en
[`docs/D0-desarrollo/pruebas.md` §2](../D0-desarrollo/pruebas.md), y el README avisa antes de que
alguien lo corra:

1. **`deriva-de-migraciones.test.ts`, 6 rojas.** La guarda de #675 resuelve
   `applicationBootstrapVersion` como una revisión **del repositorio en que vive**. `Pulumi.stg.yaml`
   y `Pulumi.prod.yaml` declaran `c755de2149344b8033736958ee8ae6f643c90281`, que es un *commit* de
   `sgtm` —`git cat-file -t` lo encuentra allí y no aquí— y la historia de `infrastructure` empieza
   en su propio commit inicial, con 7 commits. **La guarda está haciendo su trabajo**: se niega a
   inventar un número. Lo que hay que decidir —y no es de esta etapa— es qué significa esa versión
   ahora que cada sistema trae su propio baseline (ADR-0032): cuatro historias de migraciones en
   cuatro repositorios y una sola línea de configuración por ambiente.
2. **`reserva-del-nodo.test.ts`, 1 roja, y sólo en macOS.**
   `infra/vps/reservar-recursos-del-nodo.sh` corrige la reserva duplicada con `sed -i -e …`, que es
   sintaxis **GNU**; el `sed` de macOS es BSD y lee el `-e` como la extensión del respaldo. Salida
   exacta, reproducida a mano fuera de vitest: `sed: -e: No such file or directory`, `EXIT=1`. El
   guion se ejecuta contra un nodo Linux y CI corre en `ubuntu-latest`, así que **el rojo es del
   entorno de quien desarrolla en macOS**. La corrección portable es escribir a un temporal y
   mover. **No se aplicó**: es código de infraestructura que corre contra nodos de producción y no
   es de esta etapa.

`infrastructure/CLAUDE.md` **no dice que `yarn verificar` esté en verde**. Dice el número y
enlaza.

### 6.3 La plataforma, levantada de verdad

`docker compose -f despliegue/plataforma.compose.yaml up -d --wait` se ejecutó y **la plataforma
quedó sirviendo**. Lo que se comprobó no es que el `up` volviera, sino la sustancia:

| Qué | Lo que devolvió |
|---|---|
| Las cuatro bases | `caja · catastro · normativa · postgres · rentas` |
| Los cuatro roles | `rol_carga_parametros\|f\|f\|t`, `sgtm_app\|f\|f\|t`, `sgtm_owner\|f\|f\|t`, `sgtm_readonly\|f\|f\|f` — **ninguno superusuario, ninguno con `BYPASSRLS`** |
| Extensiones en `catastro` | `btree_gist · pg_trgm · plpgsql · postgis · unaccent` |
| Los dos realms | `200` los dos, con `"issuer":"http://localhost:18180/realms/sgtm"` y `…/sgtm-ciudadano` |
| Traefik | `404` — **es lo correcto**: vivo y sin ningún sistema detrás |
| Mailpit | `200` |

**Tres cosas que sólo se aprenden levantándola, y que están en los cinco `D0-desarrollo`:**

- **`--wait` vuelve antes de que Keycloak sirva sus realms.** Base, buzón y Traefik quedaron
  `healthy` en segundos; el `.well-known` contestó `000` en tres sondeos y `200` al cuarto — unos
  **treinta segundos más**. Keycloak no declara sonda en ese compose, así que `--wait` sólo
  comprueba que el contenedor corre. Lo que hay que esperar es el `.well-known`.
- **Los puertos por omisión chocan.** 5432, 8080, 8180 y 8025 estaban tomados en el demonio
  compartido. Se movieron en el `.env` a 55433 / 18080 / 18180 / 18025, **y con el de Keycloak hay
  que mover `SGTM_OIDC_EMISOR`**: con dos nombres distintos la firma valida, el emisor no cuadra y
  el 401 no dice por qué.
- **Con un `DOCKER_HOST` remoto el comando del README no vale tal cual.** El compose monta rutas
  relativas al árbol y un *bind mount* lo resuelve **el demonio**: si no existen allí, el motor
  arranca **sin ejecutar sus guiones de inicialización y sin ningún error**. Hubo que copiar
  `despliegue/` y `backend/` a una ruta que existe igual en las dos máquinas
  (`/tmp/kamayuk-trabajo/infrastructure/`) y levantar desde ahí. Esto está en DEV-01 §4 y en
  DEV-03 de los cinco.

Y una cuarta, medida y escrita en DEV-03 de los cuatro sistemas: **con un demonio remoto,
Testcontainers no sirve**. Lo que sale no habla de puertos ni de la base:

```
ContainerLaunchException: Container startup failed for image testcontainers/ryuk:0.12.0
  Caused by: RetryCountExceededException: Retry limit hit with exception
  Caused by: NotFoundException: Status 404: No such container: fde52622c404…
```

Falla el **reaper**, antes de llegar a PostgreSQL. Por eso `verificarAislamiento` se midió por la
salida documentada, que no es un atajo: es la que el propio DEV-01 §3B describe.

## 7. Enlaces rotos: la comprobación, ejecutada

`herramientas/verificar-enlaces.py`, nuevo. Comprueba cada clase de enlace **de la forma en que se
puede comprobar**: los relativos contra el disco —con su ancla `#seccion` si la llevan— y los
absolutos a `github.com/hneyra/<repo>/blob/<rama>/<ruta>` **contra el clon hermano de ese
repositorio**, que es más fuerte que una petición HTTP: dice si el archivo existe de verdad, sin
depender de que el repositorio sea público ni de que haya red.

```
175 enlaces resueltos contra el disco, 9 externos no seguidos.
Ninguno roto.
```

Sobre los cinco `CLAUDE.md`, los cinco `README.md`, los veinte documentos de `D0-desarrollo` y
ARQ-04. Los 9 externos son **raíces de repositorio** (`https://github.com/hneyra/rentas`, …): no
tienen ruta que resolver.

**Lo que esta comprobación NO dice, y hay que declararlo:** que la **rama remota** ya tenga ese
archivo. Se resuelve contra el clon local, así que un enlace a `blob/main/...` de un archivo que
existe aquí y todavía no se ha empujado sale en verde.

## 8. La guarda de #711: sí se pudo enganchar

En `sgtm` la guarda existe y **no corre en CI**, porque engancharla exige tocar
`.github/workflows/` y el token de aquella sesión no tenía alcance `workflow`. **Aquí se
enganchó**: los cinco repositorios tienen `.github/workflows/registro.yml`, que en cada
`pull_request` corre primero la autoprueba de la guarda y después la guarda.

Los dos guiones se copiaron y adaptaron a cada repositorio: lo único que cambia es
`RUTAS_DE_CODIGO` —qué cuenta como código de producción aquí— y el nombre de la variable, que pasa
a ser `KAMAYUK_CUERPO_DEL_PR`. **Un solo nombre y no dos**: aceptar también el viejo serían dos
formas de hacer lo mismo.

Ejecutada en los cinco: **6 muestras, 3 que rechaza y 3 que deja pasar**, todas como deben. Las
tres verdes son la mitad que importa —un PR de sólo documentación, de sólo pruebas o sin issue
asociado tiene que pasar—: una guarda que grita siempre acaba esquivada.

**El hueco que queda, y es el mismo de siempre:** el commit se hace en local y **nada se empuja**.
Empujar `.github/workflows/` exige un token con alcance `workflow`. Hasta que alguien empuje, el
flujo existe en el árbol y no lo ha ejecutado GitHub ni una vez.

---

## 9. Huecos declarados

1. **`yarn verificar` de `infrastructure` está en rojo**: 7 de 344. Las dos causas están medidas en
   §6.2, ninguna se arregló y el porqué está escrito. La de `deriva-de-migraciones` **necesita una
   decisión**, no un parche.
2. **Nada se empujó.** Los cinco commits son locales. Con ellos, el `registro.yml` de §8 no lo ha
   ejecutado GitHub todavía, y los enlaces a `blob/main/...` de archivos creados hoy apuntan a algo
   que el remoto aún no tiene.
3. **Los `.claude/settings.local.json` no quedan versionados**, por el `~/.config/git/ignore` del
   usuario. Es el mismo comportamiento que en `sgtm` y es el correcto para un archivo local, pero
   significa que **otra máquina no los hereda**.
4. **El túnel a Docker se cayó al terminar**, después de todas las medidas de §6.3 y con la
   plataforma ya verificada. Error exacto y repetido en ocho intentos separados por 20 s:
   `Cannot connect to the Docker daemon at unix:///tmp/docker.sock. Is the docker daemon running?`
   —el socket sigue en el disco (`srw------- jorge wheel 0`) y no hay nada escuchando—. **Consecuencia
   concreta: la plataforma se quedó levantada** en el demonio remoto y no se pudo bajar. Son cuatro
   contenedores `kamayuk-plataforma-*`, la red `kamayuk-plataforma` y el volumen
   `kamayuk-plataforma_datos-plataforma`, en los puertos **55433, 18080, 18180 y 18025** —ninguno
   de los que usa la marcha blanca—. Se retira con:
   ```bash
   docker compose -f /tmp/kamayuk-trabajo/infrastructure/despliegue/plataforma.compose.yaml down -v
   ```
5. **El PostgreSQL 16 local quedó arrancado** en el puerto 55432, para poder correr
   `verificarAislamiento`. Se para con
   `/opt/homebrew/opt/postgresql@16/bin/pg_ctl -D /opt/homebrew/var/postgresql@16 stop`.
6. **La comprobación de enlaces no valida la rama remota** (§7), y **no sigue enlaces a otros
   dominios**: los cuenta aparte.
7. **Node local es la 26, y CI fija la 22.** Todo lo de §6 se midió con la 26. Lo que se ejecutó
   —Gradle, los dos guiones `.mjs` y `vitest`— pasó igual, pero **una diferencia de versión de Node
   no se descarta razonando**: en `sgtm` ya costó 22 pruebas de frontend.
8. **`librerias-backend` sigue sin Checkstyle ni NullAway**, como declaró P3 §7. No cambió aquí.
9. **Los `PENDIENTE-CRUCE-01..06` de P3 siguen sin issue de GitHub.** Los `CLAUDE.md` nuevos no los
   nombran uno a uno para no duplicar esa lista: viven en `CrucesConsentidosDelSgtm` y en
   [P3 §3](P3-safeguards.md).
