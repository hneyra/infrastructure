# `infrastructure` — la plataforma del SGTM

El clúster, el motor, la identidad, el ingreso, el respaldo y la observabilidad. Una sola
cosa para los cuatro sistemas: **no se multiplica por cuatro y no puede vivir en cuatro
repositorios, porque entonces nadie es dueño del nodo**
([ADR-0031](infra/../docs/30-arquitectura/adr/ADR-0031-infraestructura-comun-y-propia.md) §1,
en `sgtm`).

Es la mudanza de `sgtm/infra/` y `sgtm/despliegue/`, **sin cambiar una línea de código**. Lo
que lo demuestra está en §3: los manifiestos de los dos repositorios son byte a byte idénticos.

```bash
cd infrastructure
yarn install
yarn verificar                    # lint, tipos y pruebas. Sin Pulumi, sin token y sin clúster
yarn manifiestos --ambiente stg   # lo que se desplegaría, en JSON
yarn capacidad --ambiente prod    # ¿cabe el stack en el nodo?
yarn secretos --ambiente stg      # el inventario de INF-06: nombre, clave, rotación. Nunca un valor

infra/respaldo/simulacro-de-restauracion.sh --ambiente stg   # el respaldo, restaurado de verdad
infra/observabilidad/verificar-alertas.sh                    # apaga la base, comprueba que la alerta llega
infra/observabilidad/verificar-tableros.sh                   # cada panel del tablero, contra Prometheus
infra/verificaciones/motor/verificar-el-motor.sh --ambiente stg --con-aislamiento
infra/verificaciones/ambiente/verificar-el-ambiente.sh --ambiente prod
infra/secretos/bootstrap-secretos.sh --ambiente stg
infra/secretos/rotar-clave.sh --ambiente stg --rol sgtm-app
```

Los dos que más cuestan de operar y más valen, con lo que cada uno demuestra:

| Guion | Qué hace, y qué se rompió para saber que muerde |
|---|---|
| [`infra/respaldo/simulacro-de-restauracion.sh`](infra/respaldo/simulacro-de-restauracion.sh) | **Restaura el respaldo de verdad** (RNF-079, INF-08). Cinco roturas lo ponen rojo; la primera restaura **4 filas donde había 3** —la escritura posterior al instante marcado sobrevive—, que es el defecto que un PITR mal apuntado produce en silencio. `--contra-cluster` sólo corre contra `stg`: es destructivo sobre el volumen en marcha |
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

## 4. `yarn verificar`: 310 de 317, y los siete que fallan

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

**`verificaciones/motor/verificar-el-motor.sh` NO se pudo ejecutar aquí, y hay que decir por
qué.** No es un efecto de este trabajo:

- Necesita **`psql` en la máquina local** y esta no lo tiene: falla con `FALLO: falta «psql»`.
- Levanta el motor con Docker y luego se conecta por **TCP a `localhost:PUERTO`**. El Docker de
  esta máquina es un **túnel al demonio de un VPS**: los contenedores arrancan allí y sus puertos
  publicados quedan allí, así que esa conexión no existe.

Lo que sí se midió es que **su entrada no ha cambiado**: ese guion no corre contra ningún
compose —extrae la inicialización **del ConfigMap del manifiesto** (`lib-motor-local.sh:55`)— y
ese ConfigMap es byte a byte el de P1A, con sus cinco guiones (`sha256` del contenido:
`33da2503e306f3166d6289c2…`). Sigue verificando el clúster, no la plataforma local.

**Y de ahí sale un hueco que conviene ver escrito**: el ConfigMap del clúster lleva cinco guiones
y **no lleva `05-crear-bases.sh`**. Es correcto hoy —ningún sistema tiene base propia en el
clúster todavía, porque no hay descriptores— pero significa que el compose de la plataforma y el
clúster **ya divergen en un punto**, que es exactamente la trampa que ADR-0011 anotó. Lo que la
vigila hoy es `verificaciones/plataforma-compose.test.ts`, que lee los dos composes y compara; lo
que **no** hay es una verificación que levante la plataforma en CI, como `despliegue.yml` hace
con el compose entero.

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
