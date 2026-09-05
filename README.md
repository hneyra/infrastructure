# `infrastructure` — la plataforma del SGTM

El clúster, el motor, la identidad, el ingreso, el respaldo y la observabilidad. Una sola
cosa para los cuatro sistemas: **no se multiplica por cuatro y no puede vivir en cuatro
repositorios, porque entonces nadie es dueño del nodo**
([ADR-0031](infra/../docs/30-arquitectura/adr/ADR-0031-infraestructura-comun-y-propia.md) §1,
en `sgtm`).

Es la mudanza de `sgtm/infra/` y `sgtm/despliegue/`, **sin cambiar una línea de código**. Lo
que lo demuestra está en §3: los manifiestos de los dos repositorios son byte a byte idénticos.

**Por dónde entrar:** para montar el entorno y ejecutarlo,
[`docs/D0-desarrollo/README.md`](docs/D0-desarrollo/README.md); para el contexto de agente —las
diez reglas y lo que este repositorio no hace—, [`CLAUDE.md`](CLAUDE.md); y para los estándares
de código del backend, que valen para los cinco,
[ARQ-04](docs/30-arquitectura/estandares-de-codigo-backend.md).

```bash
cd infrastructure
yarn install
yarn verificar                    # lint, tipos y pruebas. Sin Pulumi, sin token y sin clúster
yarn manifiestos --ambiente stg   # lo que se desplegaría, en JSON
yarn capacidad --ambiente prod    # ¿cabe el stack en el nodo?
yarn secretos --ambiente stg      # el inventario de INF-06: nombre, clave, rotación. Nunca un valor

infra/respaldo/simulacro-de-restauracion.sh --ambiente stg   # el respaldo FISICO, restaurado de verdad
infra/respaldo/simulacro-de-restauracion-logica.sh           # pg_dump/pg_restore de los CINCO esquemas
infra/observabilidad/verificar-alertas.sh                    # apaga la base, comprueba que la alerta llega
infra/observabilidad/verificar-tableros.sh                   # cada panel del tablero, contra Prometheus
infra/verificaciones/motor/verificar-el-motor.sh --ambiente stg --con-aislamiento
infra/verificaciones/ambiente/verificar-el-ambiente.sh --ambiente prod
infra/secretos/bootstrap-secretos.sh --ambiente stg
infra/secretos/rotar-clave.sh --ambiente stg --rol sgtm-app
```

Los tres que más cuestan de operar y más valen, con lo que cada uno demuestra:

| Guion | Qué hace, y qué se rompió para saber que muerde |
|---|---|
| [`infra/respaldo/simulacro-de-restauracion.sh`](infra/respaldo/simulacro-de-restauracion.sh) | **Restaura el respaldo de verdad** (RNF-079, INF-08). Cinco roturas lo ponen rojo; la primera restaura **4 filas donde había 3** —la escritura posterior al instante marcado sobrevive—, que es el defecto que un PITR mal apuntado produce en silencio. `--contra-cluster` sólo corre contra `stg`: es destructivo sobre el volumen en marcha |
| [`infra/respaldo/simulacro-de-restauracion-logica.sh`](infra/respaldo/simulacro-de-restauracion-logica.sh) | **Vuelca y restaura los cinco esquemas de verdad** (C-11, y el hueco 3 de C-4). No es el físico: éste es el camino `pg_dump`/`pg_restore`, el que se usa para migrar de ambiente o copiar `prod` a `stg`. Devolver a `catastro` el defecto que C-4 arregló pone en rojo **la tabla `via` con nombre** y los once objetos que se van con ella —cuatro índices, una política de RLS, una secuencia y cinco restricciones, dos de ellas de OTRAS tablas—, más sus tres filas — y en la misma pantalla se ve por qué no basta el código de salida: `psql` sobre el volcado plano sale con **0** y dieciocho errores dentro |
| [`infra/observabilidad/verificar-alertas.sh`](infra/observabilidad/verificar-alertas.sh) | **Apaga PostgreSQL y comprueba que la alerta le llega a alguien.** Sin receptor configurado, la regla llega a `firing` y el receptor de prueba recibe 0 peticiones; con receptor, la misma alerta activa se entrega |

El detalle de cada pieza, sus decisiones y su tabla de verificaciones está en
[`infra/README.md`](infra/README.md), que se mudó tal cual.

## 1. Qué hay aquí, y por qué

| Carpeta | Qué es |
|---|---|
| `infra/` | Pulumi, los ocho componentes, las herramientas, los guiones de secretos, respaldo, observabilidad, red y VPS, y sus 14 archivos de verificación |
| `despliegue/` | El entorno local canónico: el compose, la identidad declarativa (ADR-0012) y la inicialización del motor |
| `backend/`, `frontend/`, `.github/workflows/` | **Sólo los archivos que `infra/` lee**, en su misma ruta relativa. Ver §2 |

## 2. Los diez archivos que `infra/` lee fuera de sí misma

`componentes/fuentes.ts` define `raizDelRepositorio()` como el padre de `infra/`, y desde ahí
lee archivos que **entran en los manifiestos**. Están copiados en su misma ruta relativa, y por
eso el diff de §3 es vacío por construcción.

**Esta lista es el acoplamiento real de `infrastructure` con los repositorios de sistema**, y
conviene tenerla escrita antes de que alguien mueva uno:

| Archivo | Quién lo lee | ¿Entra en los manifiestos? |
|---|---|---|
| `backend/sgtm-esquema/src/main/resources/db/roles/crear-roles.sql` | `fuentes.ts` | **Sí** |
| `despliegue/inicializacion-del-motor/20-asignar-claves.sh` | `fuentes.ts` | **Sí** |
| `despliegue/identidad/realm-sgtm.json` | `fuentes.ts` | **Sí** |
| `despliegue/identidad/realm-sgtm-ciudadano.json` | `fuentes.ts` | **Sí** |
| `despliegue/identidad/reconciliar-identidades.sh` | `fuentes.ts` | **Sí** |
| `despliegue/identidad/municipalidades/` | `fuentes.ts` | **Sí** |
| `despliegue/identidad/ciudadanos/` | `fuentes.ts` | **Sí** |
| `frontend/nginx.conf` | `fuentes.ts` | **Sí** |
| `backend/sgtm-esquema/src/main/resources/db/migration/` | `extensiones-de-las-migraciones.ts`, `deriva-de-migraciones.ts` | No: verificación |
| `backend/sgtm-dominio-compartido/…/dominio/TipoDocumento.java` | `componentes.test.ts` | No: verificación |
| `.github/workflows/{infra,declarar-version}.yml` | `deriva-de-migraciones.test.ts`, `declarar-version.test.ts` | No: verificación |

**Y el censo tuvo que hacerse dos veces.** El primero miró `componentes/`, `config.ts` y
`herramientas/` —lo que compone manifiestos— y dio ocho rutas; con él, `yarn verificar` falló
por tres archivos que sólo leen **las pruebas**: `TipoDocumento.java` y los dos workflows. Las
pruebas son parte de lo que hay que mudar, no un apéndice.

## 3. Que la copia no cambió nada: los manifiestos

Es la comprobación que importa. En los dos repositorios:

```bash
cd sgtm/infra           && yarn --silent manifiestos --ambiente stg  > /tmp/a.json
cd infrastructure/infra && yarn --silent manifiestos --ambiente stg  > /tmp/b.json
diff /tmp/a.json /tmp/b.json
```

| Ambiente | Líneas | `sha256` en `sgtm` | `sha256` en `infrastructure` | Diff |
|---|---|---|---|---|
| `stg` | 4 316 | `637e81cf5be45ae0…` | `637e81cf5be45ae0…` | **vacío** |
| `prod` | 4 127 | `b86dde8146b0707e…` | `b86dde8146b0707e…` | **vacío** |

Byte a byte iguales. Si alguno dejara de serlo, lo que se perdió está en la lista de §2.

**Esa medida es de la mudanza, y P1B la superó a propósito.** Desde que `infrastructure` compone
los cuatro descriptores (ADR-0031 §2), el diff ya no puede ser vacío: añade los cuatro sistemas.
Lo que se mide desde entonces es que sea **adición pura**, y lo es —remedido el 2026-09-03—:

| Ambiente | Líneas suprimidas o cambiadas de la plataforma | Líneas añadidas | De dónde |
|---|---|---|---|
| `stg` | **0** | 1 613 | `kamayuk-{rentas,catastro,normativa,caja}-stg` |
| `prod` | **0** | 1 613 | `kamayuk-{rentas,catastro,normativa,caja}-prod` |

Ni una línea de la plataforma se movió al añadir los cuatro. Es la propiedad que hace revisable
la composición: un descriptor no puede cambiar lo que no es suyo, y el diff lo enseña.

## 4. `yarn verificar`: 337 de 344, y los siete que fallan

**No está en verde, y los siete tienen causa medida.** Ninguno es un arreglo pendiente «a ojo»:

### 4.1 Uno es heredado y no lo trajo la mudanza — 1 prueba

`verificaciones/reserva-del-nodo.test.ts › corrige la reserva duplicada que hay hoy en el nodo
de prod` falla con `expected 1 to be +0`.

**Falla idéntico en `sgtm`**, medido: allí `yarn verificar` da **1 fallo de 317** sobre esta
misma rama. Es preexistente y ajeno a la mudanza; se arregla en `sgtm` o aquí, pero no es un
efecto de la copia.

### 4.2 Seis son estructurales de la separación — `deriva-de-migraciones.test.ts`

Los seis dicen lo mismo:

```
«c755de2149344b8033736958ee8ae6f643c90281» no esta en este clon, asi que no se puede saber
cuantas migraciones trae. Esta comprobacion NO se salta: un numero inventado seria peor que
ninguno.
```

**La guarda está haciendo exactamente lo que debe, y su mensaje lo explica.** Compara
`applicationBootstrapVersion` —que vive en los stacks, o sea **aquí**— contra las migraciones
de `origin/main` —que viven en el repositorio del **sistema**—. Al separarlos, la guarda queda
**a caballo de dos repositorios** y no se puede satisfacer desde uno solo: ese `sha` es de
`sgtm` y no está en la historia de `infrastructure`.

**No se toca**, y el motivo es que arreglarla obliga a decidir algo que no está decidido: con
cuatro sistemas hay **cuatro** `applicationBootstrapVersion` y **cuatro** historias de
migraciones, todas fuera de este repositorio. Las salidas —que la guarda reciba la ruta del
clon de cada sistema, que cada repo publique su cuenta de migraciones como dato, o que el
`sha` deje de ser de un repo y pase a ser una versión publicada— son tres diseños distintos
con costos distintos.

Es, además, el riesgo que ADR-0031 §Consecuencias nombra —«el descriptor que nadie compone»—
apareciendo por donde se esperaba. **La guarda de #675 hay que reencuadrarla antes de que
`infrastructure` despliegue de verdad**; hasta entonces, la deriva la sigue vigilando `sgtm`,
donde el `sha` y las migraciones están en el mismo clon.

## 5. El compose partido, levantado de verdad

`despliegue/plataforma.compose.yaml` (ADR-0031 §4) se levantó contra un Docker real el
2026-09-03, con **sus guiones reales** y en su orden:

```
running /docker-entrypoint-initdb.d/05-crear-bases.sh
  creando la base «rentas» … «catastro» … «normativa» … «caja»
  las cuatro bases del producto estan: rentas catastro normativa caja
running /docker-entrypoint-initdb.d/10-crear-roles.sql
running /docker-entrypoint-initdb.d/20-asignar-claves.sh
```

| Qué se comprobó | Resultado |
|---|---|
| Las cuatro bases | `caja`, `catastro`, `normativa`, `rentas` |
| Las extensiones **en cada una** | `btree_gist pg_trgm postgis unaccent`, las cuatro |
| Los cuatro roles | `sgtm_owner`, `sgtm_app`, `rol_carga_parametros` y `sgtm_readonly`, todos con `super=false bypassrls=false`; `sgtm_readonly` **sin login** |
| Keycloak con **los dos realms** | `Realm 'sgtm' imported`, `Realm 'sgtm-ciudadano' imported` |
| Y que son **dos emisores**, no dos clientes de uno | `/realms/sgtm` y `/realms/sgtm-ciudadano` responden con `public_key` propia |
| El **enrutado por prefijo** de ADR-0030 §2 | `/catastro/predios` → `catastro-web`, `/rentas/contribuyentes` → `rentas-web`, `/normativa/conjuntos` → **404** porque nadie lo reclama |

### 5.1 `verificar-el-motor.sh`, ejecutado — por el camino de Docker

**Se ejecutó, entero y por el camino fiel**, el 2026-09-03. Lo que antes lo impedía no era el
guion sino esta máquina: no tiene `psql`, y su Docker es un **túnel al demonio de un VPS**, así
que el motor arranca allí y su puerto publicado se queda allí. Se resolvió llevando el
verificador **al lado del demonio**: un contenedor Debian con `psql`, `pg_isready`, Node, yarn y
el cliente de Docker, con `--network host`, el socket del VPS montado y un directorio de trabajo
en **la misma ruta a los dos lados** (`TMPDIR=/tmp/kamayuk-trabajo`) para que el *bind mount* de
la inicialización resuelva.

Con eso el guion elige **`modo: docker`** —el fiel, con la imagen que declara el manifiesto— y no
el repliegue a instancia local:

```
· Imagen declarada en el manifiesto: postgis/postgis:16-3.4-alpine
· Motor: contenedor con postgis/postgis:16-3.4-alpine
…
El motor del manifiesto de «stg» cumple lo que el issue #149 exige (modo: docker).
El motor del manifiesto de «prod» cumple lo que el issue #149 exige (modo: docker).
```

Las ocho comprobaciones del issue #149 pasan en los dos ambientes, **incluida la 5** —Keycloak con
base propia y sin poder conectarse a la del padrón—, que es justamente la que el compose local no
ejercita porque allí Keycloak corre en `start-dev`; el reparto es correcto y ahora está medido.

**Y muerde.** La mutación registrada para esta verificación —quitar de
`infra/componentes/inicializacion/30-base-de-keycloak.sh` el `GRANT CONNECT` que devuelve a los
cuatro roles lo que ese mismo guion revoca de `PUBLIC`— la deja en rojo con el mensaje exacto:

```
FALLO: sgtm_owner no puede conectarse a la base del padron: 30-base-de-keycloak.sh revoca
       el CONNECT de PUBLIC y tiene que volver a concederselo a los cuatro roles
```

Restaurado por copia y comparado con `cmp`: idéntico byte a byte.

### 5.2 Dos defectos del compose que sólo se vieron levantándolo

Los dos son míos, de P1B, y los dos pasaban las diez pruebas de
`verificaciones/plataforma-compose.test.ts` **en verde**:

1. **La sonda del ingreso pedía un endpoint que nadie servía.** `traefik healthcheck --ping`
   contra una configuración estática sin `--ping`: el contenedor se quedaba `unhealthy`
   permanentemente. No falla con un error — cuelga cualquier `depends_on: service_healthy` y
   hace caducar un `up --wait` sin decir cuál de los cuatro servicios falta.
2. **Traefik no descubría ni un servicio.** Hasta v3.5 pide la API de Docker en la versión
   `1.24`, fijada en su código y no configurable por entorno (`DOCKER_API_VERSION` no la mueve:
   medido), y **Docker 29 elevó el mínimo a `1.44`**. El proveedor fallaba en bucle y Traefik
   contestaba **404 a todo**, que es indistinguible de «todavía no hay ningún sistema levantado»
   — y con la sonda ya arreglada, `healthy`. Medido contra Docker 29.1.3: `v3.1` y `v3.5` en
   bucle de error, `v3.6` limpio. Se sube la imagen a `v3.6`; no hace falta ninguna pieza más.

El segundo era el que más costaba, porque el enrutado por prefijo es la promesa central de
ADR-0030 §2 y estaba **entera sin funcionar**. Con los dos arreglos, el enrutado se ejercitó de
verdad con dos contenedores etiquetados como el README de `despliegue/` documenta.

Las dos guardas nuevas están en `plataforma-compose.test.ts` **con su muestra que las viola**, y
se midieron además mutando el archivo real: quitar `--ping=true` pone roja una y sólo una, bajar
la imagen a `v3.1` pone roja la otra y sólo la otra.

**Lo que sigue sin haber** es una verificación que levante la plataforma **en CI**, como
`despliegue.yml` hace con el compose entero. Estos dos defectos los encontró una persona
levantándolo a mano; el tercero no lo va a encontrar nadie.

## 6. Lo que esta mudanza NO hace

- **No borra nada de `sgtm`.** `sgtm/infra/` y `sgtm/despliegue/` siguen ahí, intactos: es el
  archivo histórico y la única copia con `git log`.
- **No parte los stacks.** Siguen siendo `stg` y `prod` del mismo `index.ts` (ADR-0031 §3).
- **No crea los descriptores por sistema.** Cada repositorio publicará su
  `@sgtm/infra-<sistema>` con sus funciones puras; aquí sólo está la plataforma.
- **No mueve `infra/` a la raíz.** El `package.json` de la raíz delega en él, y eso es
  deliberado: `raizDelRepositorio()` es el **padre de `infra/`**, así que subirla haría que la
  raíz del repositorio fuera el directorio que contiene todos los repos, y con ella se irían
  los ocho archivos de §2 que entran en los manifiestos. El AC de los manifiestos idénticos
  manda sobre la comodidad de la estructura.

## 7. Los cuatro sistemas, compuestos (P1C)

Los cuatro repositorios existen con su carpeta `infrastructure/`, su descriptor contra el
contrato de §1 y su CI. **Sin una línea de código de negocio**: eso es la etapa 5.

### 7.1 El grafo de egreso, compuesto de los cuatro descriptores

No está escrito en ningún sitio: **sale de lo que cada sistema declara**, y por eso el diff de
un PR lo enseña. `cd infra && yarn grafo`:

```
Grafo de egreso de «stg» — 4 sistemas

  caja       ──▶  rentas
  catastro   ──▶  normativa, rentas
  normativa  ──▶  (ninguno)
  rentas     ──▶  caja, catastro, normativa

  6 aristas entre sistemas. El motor y la identidad no cuentan: los
  cuatro los necesitan y no son un sistema.
```

Es ARQ-01 reducido a cuatro nodos, y **`normativa` sin egreso es la arista que más dice**: si
alguna vez lo necesita, lo que está mal es la arquitectura y no el descriptor. `catastro → rentas`
existe por una sola cosa —resolver el nombre del titular— y `rentas → catastro` es la que lleva la
valuación, que es la que ADR-0029 nombra como la única que puede salir mal.

### 7.2 Lo medido

| Criterio | Resultado |
|---|---|
| `yarn verificar` en los cuatro descriptores | **25 pruebas en verde**: rentas 7, catastro 6, normativa 6, caja 6 |
| `yarn manifiestos` compone los cuatro | `stg` **98 objetos**, `prod` **95**. Los cuatro sistemas aportan 25 y 25 |
| La auditoría pasa | Sí, y **sin tocar la plataforma**: §3, adición pura |
| Los `Deployment` apuntan a imágenes que no existen | **Correcto en esta etapa**, y no se despliega nada |

### 7.3 Y la auditoría muerde a través de la frontera del repositorio

Es lo que ADR-0031 §2 compra y lo único que hace que esto no sea un documento. Con `rentas`
reclamando el prefijo de `catastro` —una línea en **otro repositorio**—, el emisor de aquí se
niega:

```
Error: La auditoria rechazo 1 cosa(s) de los descriptores de sistema.

  - [rentas] IngressRoute/kamayuk-rentas reclama «/catastro», que esta fuera de su
    prefijo «/rentas». El enrutado por prefijo decide quien responde a que
    (ADR-0030 §2): un sistema que reclama el de otro no falla, se lo queda, y las
    peticiones dejan de llegar a su dueno sin que nada se ponga rojo.
```

Restaurado por copia y comparado con `cmp`: idéntico byte a byte, y vuelve a componer en verde.
