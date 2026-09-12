# `infrastructure` — Contexto para agentes

La plataforma de **Kamayuk**: Pulumi sobre k3s, PostgreSQL, Keycloak, Traefik, respaldo,
observabilidad, el entorno local y **las barreras que verifican a los cinco sistemas**. Nada de
esto es de ningún sistema: es el suelo sobre el que cada repositorio levanta lo suyo
([ADR-0031](docs/30-arquitectura/adr/ADR-0031-infraestructura-comun-y-propia.md)).

Los otros **cinco** son [`rentas`](https://github.com/hneyra/rentas),
[`catastro`](https://github.com/hneyra/catastro), [`normativa`](https://github.com/hneyra/normativa),
[`caja`](https://github.com/hneyra/caja) e [`identidad`](https://github.com/hneyra/identidad) —el
quinto desde el 2026-09-09, que contesta D-19 ([ADR-0039](docs/30-arquitectura/adr/ADR-0039-la-identidad-es-un-sistema.md))
y es **el único cuyo repositorio es privado**—. El archivo histórico —y la única copia con `git log`
de la historia entera— es [`sgtm`](https://github.com/hneyra/sgtm), que **no se borra ni se
modifica**.

## Qué hay hoy, medido y no supuesto

| Pieza | Estado |
|---|---|
| `infra/` — Pulumi en TypeScript | **Existe**, y `yarn verificar` corre **sin Pulumi, sin token y sin clúster**. Hoy da **902 pruebas con UNA roja**, y la roja es real y está declarada: `«stg» cabe` de `capacidad.test.ts`, porque con el quinto sistema `stg` deja de caber en el nodo que declara (etapa 1 de #52). Eran 891 hasta la etapa 2, y **840, todas verdes**, con los cuatro; y 726 hasta #21, y su cuenta hay que leerla con los clones hermanos a `main`: el 2026-09-07 `main` llego a tener **once rojas sin un solo commit propio**, porque un hermano integro su interfaz y este flujo solo se dispara con un `push` de aqui. **Medido con los clones hermanos recién traídos**, que no es un detalle: los del disco estaban 8, 1 y 9 commits por detrás de sus remotos y daban una cuenta de rojas que CI no reconocía ([`E` §6](docs/00-gobierno/E-el-monolito-sale-del-sistema.md)) |
| `despliegue/plataforma.compose.yaml` | **Existe y levanta**: PostgreSQL con **las cinco bases** —una por sistema; la de `identidad` desde la etapa 1 de #52—, Keycloak con **sus dos realms**, Mailpit y Traefik |
| `despliegue/compose.yaml` | **Retirado en [`E`](docs/00-gobierno/E-el-monolito-sale-del-sistema.md).** Era el compose del monolito, y construía `backend/Dockerfile` y `../frontend`: **ninguno de los dos existía aquí desde el corte**, así que no se podía levantar. Cada sistema trae el suyo |
| `librerias-backend/comun-verificaciones` | **Existe.** **20** reglas de ArchUnit, **seis** escáneres de fuentes —los tres de siempre, el del operador espacial y el de la búsqueda por prefijo (ADR-0034), y el de la escritura de la autorización (ADR-0039, etapa 2 de #52), que **nace desactivado** hasta que cada consumidor declare sus escritores—, el revisor de esquema que exige el marco, y **45** clases de muestra más cuatro migraciones de muestra. Las consumen los cinco backends: `E` retira el monolito de ESTE repositorio, no toca el clon `sgtm` |
| `backend/` | **Retirado en [`E`](docs/00-gobierno/E-el-monolito-sale-del-sistema.md).** Traía las 68 migraciones del monolito, su `crear-roles.sql` y un `.java`. El baseline de cada sistema es [ADR-0032](docs/30-arquitectura/adr/ADR-0032-el-esquema-nace-en-baseline.md), y la copia entera del monolito vive en el clon `sgtm`. **El censo de extensiones de C-2 pasa por eso de cinco esquemas a cuatro** |
| `docs/30-arquitectura/adr/` | 13 ADR y el índice |
| Los cinco `V1__baseline.sql` | **NO están aquí.** Cada uno vive en el módulo de esquema de su clon; los del corte, además, en `sgtm/docs/40-datos/baselines/` |
| `SISTEMAS` y `SISTEMAS_DEL_PRODUCTO` | **CINCO desde la etapa 1 de #52** (ADR-0039). Las dos listas se atan entre sí en `el-monolito-fuera.test.ts`, así que un sistema no puede entrar por un lado y quedarse sin base por el otro: sacarlo de `SISTEMAS_DEL_PRODUCTO` dejándolo en `SISTEMAS` deja **154 rojas de 807** —la suite ENCOGE— y `yarn manifiestos` sin emitir nada |
| Las librerías `comun-dominio`, `comun-plataforma`, `comun-integracion` | **NO existen.** Sólo `comun-verificaciones`. **D-23 esta contestada** (2026-09-07): van a un repositorio propio, `kamayuk-lib`, y `comun-verificaciones` se muda con ellas ([ADR-0038](docs/30-arquitectura/adr/ADR-0038-el-corte-entre-el-producto-y-el-suelo.md)) |

## Lo que este repositorio NO hace

- **No contiene una sola regla de negocio.** Ni tributo, ni predio, ni recibo. Ni una línea de
  Java de dominio desde [`E`](docs/00-gobierno/E-el-monolito-sale-del-sistema.md): el
  `TipoDocumento` que las muestras usaban era del monolito, y la tabla de formas de documento
  se contrasta ahora contra el de los clones.
- **No despliega el monolito, en ningún ambiente.** `stg` dejó de hacerlo en C-19 y `prod` en
  `E`, cuando la dirección cerró la migración. Con él se fue la única interfaz web del
  producto; hoy la tienen `rentas` (I-44), `caja` (#17) y `catastro`, e `identidad` **no**.
- **No publica `comun-verificaciones` como jar.** Se consume por *composite build* a propósito:
  un jar publicado a mano se queda viejo sin que nada se ponga rojo, y una verificación vieja que
  pasa en verde es el modo de fallo que este proyecto lleva doscientos issues evitando.
- **No guarda ningún secreto de la aplicación en el estado de Pulumi.** Los genera
  `bootstrap-secretos.sh` hablando con el API de Kubernetes por `kubectl`.
- **No rota la clave de cifrado del respaldo de rutina.** Cambiarla deja ilegibles todos los
  respaldos escritos con la anterior; no hay `ALTER ROLE` que los vuelva a cifrar.
- **No decide qué calcula ningún sistema.** Decide dónde corre, con qué límites y con qué rol.

## Estructura

```
infra/                  Pulumi en TypeScript con yarn. Componentes, descriptor y verificaciones
despliegue/             el entorno local: el compose de la plataforma, identidad e inicializacion
librerias-backend/      Gradle. `comun-verificaciones`, que consumen los cinco backends
herramientas/           los guiones del reparto de ADR y su verificador de enlaces
docs/                   ADR, gobierno, hallazgos de RLS, estandares de codigo y D0-desarrollo
```

**`docs/30-arquitectura/estandares-de-codigo-backend.md` vive aquí y no en los cinco**, junto a
`comun-verificaciones`: son las mismas reglas y las verifica el mismo artefacto. Los cinco
sistemas lo enlazan; ninguno lo copia.

## Antes de escribir código, leer

| Si vas a tocar… | Lee |
|---|---|
| Cualquier cosa | [ADR-0002 — Estrategia multi-tenant](docs/30-arquitectura/adr/ADR-0002-estrategia-multi-tenant.md) — es el riesgo número uno |
| Base de datos | [Los cinco hallazgos de RLS](docs/40-datos/hallazgos-de-rls.md) **primero** |
| Las barreras | [`librerias-backend/README.md`](librerias-backend/README.md) y [P3 — Safeguards](docs/00-gobierno/P3-safeguards.md), que declara sus huecos |
| Infraestructura | [ADR-0011](docs/30-arquitectura/adr/ADR-0011-infraestructura-como-codigo.md) y [`infra/README.md`](infra/README.md) |
| El reparto en cinco | [ADR-0029](docs/30-arquitectura/adr/ADR-0029-cuatro-sistemas-separados.md), [ADR-0031](docs/30-arquitectura/adr/ADR-0031-infraestructura-comun-y-propia.md) y [ADR-0032](docs/30-arquitectura/adr/ADR-0032-el-esquema-nace-en-baseline.md) |
| Identidad | [ADR-0005](docs/30-arquitectura/adr/ADR-0005-identidad-y-acceso.md) y [ADR-0012](docs/30-arquitectura/adr/ADR-0012-usuarios-y-grupos-declarativos.md) |
| Montar el entorno | [D0 — Desarrollo](docs/D0-desarrollo/README.md) |

Índice de decisiones: [`docs/30-arquitectura/adr/README.md`](docs/30-arquitectura/adr/README.md).

## Decisiones abiertas que bloquean

Registro completo en [GOB-02](https://github.com/hneyra/sgtm/blob/migracion-a-microservicios/docs/00-gobierno/decisiones-abiertas.md).

| # | Decisión | Bloquea |
|---|---|---|
| D-22 | **Quién opera cuatro despliegues.** Una municipalidad no opera cuatro | La implantación |
| ~~D-23~~ | **Contestada el 2026-09-07: un repositorio propio, `kamayuk-lib`** ([D-23b](docs/00-gobierno/D-23b-quien-publica-las-librerias-comunes.md), [ADR-0038](docs/30-arquitectura/adr/ADR-0038-el-corte-entre-el-producto-y-el-suelo.md)). Ojo al nombre: `D-23-quien-publica-las-imagenes.md` es **otra cosa** y esta cerrada | ~~`comun-dominio`, `comun-plataforma`, `comun-integracion`~~. Desbloquea #23 y #24 |
| D-25 | **Si la separación llega o no al hierro.** Cuatro sistemas sobre un k3s de un nodo comparten disponibilidad | El dimensionado |
| ~~D-19~~ | **Contestada el 2026-09-09** en su parte de «quién es el dueño»: la autorización es un **sistema propio** y se replica por el buzón ([ADR-0039](docs/30-arquitectura/adr/ADR-0039-la-identidad-es-un-sistema.md), se construye en [#52](https://github.com/hneyra/infrastructure/issues/52)). Sigue abierto **quién compone el catálogo de accesos de la sesión** | La sesión |
| D-05 | Régimen de firma digital de valores y resoluciones | La capa de documentos |
## Reglas que no se negocian

Son las mismas en los cinco repositorios, y las verifica **el mismo artefacto**:
[`comun-verificaciones`](https://github.com/hneyra/infrastructure/tree/main/librerias-backend/comun-verificaciones),
que vive en `infrastructure` y se consume como *composite build*.

| # | Regla | Motivo |
|---|---|---|
| 1 | **Importes en `BigDecimal`/`NUMERIC`.** Prohibidos `double` y `float` | Precisión monetaria (RNF-055) |
| 2 | **Ningún método de dominio recibe `municipalidadId`.** Sale del token, se fija una vez con `SET LOCAL` | Si el desarrollador no lo maneja, no puede olvidarlo |
| 3 | **`SET LOCAL`, jamás `SET SESSION`** | `SET SESSION` sobrevive al retorno de la conexión al pool y contamina la petición de otra municipalidad |
| 4 | **Sin `DELETE`** en deuda, pagos, recibos, valores, valuaciones, asientos ni auditoría. Se anula, se da de baja o se reversa | RNF-051, y el manual §Auditoría |
| 5 | **Ningún literal numérico tributario en el código.** UIT, tramos, alícuotas, valores unitarios, aranceles y tablas de depreciación viven en datos versionados | Reproducibilidad y cambio sin despliegue (RNF-053) |
| 6 | **Las reglas tributarias son funciones puras.** Sin base de datos, sin reloj, sin configuración global; la fecha entra como argumento | Recalcular 2027 en 2037 debe dar el mismo céntimo |
| 7 | **Nada de Spring ni JPA en la capa `dominio`** | Las reglas deben probarse sin levantar el contexto |
| 8 | **`alicuota`, nunca `tasa`**, para un porcentaje | `tasa` es un tipo de tributo |
| 9 | **No existe «la deuda»:** es `deudaActualizadaA(fecha)`, y toda cifra mostrada indica su fecha | RNF-075 |
| 10 | **Toda modificación de datos exige observación del usuario.** Sin observación no se guarda | Manual §Auditoría; RNF-052 |

Las reglas 1, 2, 6, 7 y las fechas están escritas como pruebas de ArchUnit; `SET SESSION` y
`DELETE` sobre tabla protegida, como escáner del código fuente. Se añade una **undécima**, que
sólo existe desde que hay cinco repositorios: **ningún SQL cruza la frontera de sistema** —un
`JOIN` contra una tabla de otro sistema no deja huella en el bytecode, así que la vigila un
escáner de texto y no ArchUnit—.

Y una **duodécima** desde ADR-0039: **ningún sistema que no sea `identidad` ESCRIBE la
autorización** —`INSERT INTO`, `UPDATE … SET` o `DELETE FROM` sobre `usuario`, `grupo`, `miembro` o
`permiso`—. Es la mitad que el reparto de tablas de la undécima no puede dar: las cuatro están en
los cinco baselines porque los cinco las **leen** para autorizar sin un viaje de red, así que van
como replicadas y un reparto distingue tablas, no verbos. Sus excepciones se declaran por clase en
`escritoresDeLaAutorizacionConMotivo()`, con su motivo y su **fecha de fin**, y la regla **nace
desactivada** en cada repositorio hasta que ese método se implemente — lo que cuesta, y quién tiene
que declarar qué, está en [`librerias-backend/README.md`](librerias-backend/README.md).

**Si agregas una regla, agrega también la clase de muestra que la viola**, en las `muestras/` de
`comun-verificaciones`: una regla que no puede fallar no protege nada. Y lo exige por
construcción `ReglasDeArquitecturaMuerdenTest`, un `@TestFactory` sobre todas las reglas: una
regla sin muestra sale roja sola.

Lista completa con su justificación:
[ARQ-04 — Estándares de código del backend](https://github.com/hneyra/infrastructure/blob/main/docs/30-arquitectura/estandares-de-codigo-backend.md).

## Idioma

Español en el dominio, inglés en lo técnico. **Sin tildes en identificadores**: Checkstyle lo
revisa en el backend, ESLint en el descriptor.

```java
public final class Papeleta { … }                  // dominio: español
public interface PapeletaRepository { … }          // patrón: inglés
autovaluo.calcularTotal();                         // comportamiento: español
repository.findById(id);                           // infraestructura: inglés
```

Tablas y columnas en español `snake_case`. Campos de la API JSON en español `camelCase`.
Comentarios, pruebas y mensajes de commit en español.
## El monolito se llamaba `sgtm`, y en la prosa se sigue llamando asi

El producto es **Kamayuk**. El sistema del que sale —el monolito retirado— se llamaba `sgtm`, y
ese nombre **ya no esta en el codigo**: ni en un realm, ni en una imagen, ni en un identificador, ni
en un dato de configuracion.

**Pero sigue en los comentarios, en `docs/` y en el registro de «Verificar antes de afirmar», y eso
es deliberado.** No es limpieza pendiente:

- una fila del registro que dice «copiado de `sgtm@33f329a2`» **es la medicion que se hizo**;
  reescribirla la falsifica, y borrarla pierde con que rotura se demostro;
- un comentario que dice «hasta `E` la sonda apuntaba a `sgtm`» **es el motivo por el que el codigo
  de al lado es como es**; quitar el nombre lo deja sin sujeto y hay que volver a descubrirlo;
- y varias guardas explican en su docblock **de que defecto vienen**, que es lo que impide que
  alguien las «simplifique».

**Asi que NO se hace una pasada de limpieza sobre la prosa.** Si estas aqui por un `grep sgtm` que
devuelve cientos de lineas: casi todas son de este tipo y se quedan.

**Lo que si esta prohibido es que la cadena vuelva al codigo**, y lo vigila **una sola guarda para
los seis**: `sin-el-nombre-del-monolito.test.ts` de `infrastructure`, que barre este arbol y los
cinco clones hermanos. Barre **solo codigo de produccion** —ni `docs/`, ni `*.md`, ni pruebas— y
**omite comentarios**, por lo de arriba.

Esta en un sitio y no en `comun-verificaciones` porque, medido, **del lado Java no hay nada que
vigilar**: `backend/*/src/main` de los cinco solo nombra el monolito en comentarios y en dos
`COMMENT ON COLUMN`. Anadir una prohibicion a la libreria compartida exigiria su clase de muestra y
tocaria los seis builds para vigilar el conjunto vacio.

**Una excepcion declarada, con su motivo dentro de la guarda:** dos `COMMENT ON COLUMN` dentro de
un `V1__baseline.sql` **ya aplicado**. Flyway valida la suma de comprobacion de cada migracion, asi
que editar una que ya corrio hace fallar el arranque de **toda base existente**. No es que no se
quiera cambiar: **no se puede** — se corregiria con una migracion nueva, si alguna vez importa.

**Eran dos hasta #112.** La otra eran los buckets `sgtm-{stg,prod}-respaldos`, y su motivo decia
«entran cuando alguien renombre el bucket de verdad»: paso. Los dos ambientes se mudaron a
`kamayuk-{stg,prod}-backups` —contenedores NUEVOS, no un renombrado— porque un catalogo de wal-g es
de un CLUSTER y no de un ambiente, y los viejos se quedan intactos donde estan. Al retirarla se
midio que la direccion de #27 de esa misma guarda **no avisaba**: la excepcion ya obsoleta pasaba en
VERDE porque su nombre seguia apareciendo en COMENTARIOS, que es justo lo que el barrido no mira.
Ahora esa comprobacion lee con los comentarios en blanco, igual que el barrido.

## Comandos

```bash
# El descriptor y los componentes del cluster. Sin Pulumi, sin token y sin cluster
yarn install
yarn verificar
yarn manifiestos --ambiente stg     # lo que se desplegaria, en JSON
yarn capacidad --ambiente prod      # ¿cabe el stack en el nodo?
yarn secretos --ambiente stg        # el inventario: nombre, clave, rotacion. Nunca un valor
yarn imagenes --ambiente stg        # ¿existen en ghcr.io las etiquetas que el manifiesto pide?
                                    # (D-23; necesita red y una credencial con `read:packages`,
                                    #  y sin ella sale con codigo 3, nunca en verde)

# Las barreras que consumen los cinco backends
cd librerias-backend && ./gradlew build

# La plataforma local: PostgreSQL con las cuatro bases, Keycloak, Traefik y el buzon
cp despliegue/.env.ejemplo despliegue/.env    # y poner claves generadas, una por linea
docker compose -f despliegue/plataforma.compose.yaml up -d --wait

# La guarda del registro (#711) y su autoprueba
node docs/00-gobierno/verificar-fila-del-registro.mjs
node docs/00-gobierno/verificar-las-muestras-del-registro.mjs

# Los guiones que se ejecutan de verdad contra algo
infra/verificaciones/motor/verificar-el-motor.sh --con-aislamiento
infra/verificaciones/ambiente/verificar-el-ambiente.sh --ambiente prod
infra/respaldo/simulacro-de-restauracion.sh --ambiente stg
infra/secretos/asignar-claves.sh --ambiente stg --comprobar
```

**El aislamiento se verifica contra el motor que levanta ese guion, nunca contra uno en
servicio:** la prueba provisiona, y `ALTER ROLE` sobre `kamayuk_owner` y `kamayuk_app` vale para todas
las bases del clúster, no sólo para la suya. Apuntarla a `prod` deja fuera a la aplicación.

Cómo montarlo desde cero, arrancarlo, depurarlo y probarlo:
[D0 — Desarrollo](docs/D0-desarrollo/README.md).
## Verificar antes de afirmar

**Ejecutar la prueba vale más que razonar sobre ella.** Y no basta con que la verificación esté
escrita: **tiene que demostrarse que puede fallar** — se rompe a propósito el código que protege,
se ejecuta, y se anota el rojo exacto que sale.

Cada issue deja aquí una fila con qué se implementó, **con qué rotura se demostró que la
verificación muerde** y qué rojo produjo. Es lo que impide volver a descubrir el mismo hallazgo
por tercera vez.

> **La tabla nació vacía, y es correcto que se viera así.** El registro anterior —288 filas, issue a
> issue— es historia de `sgtm` y **no viaja**: en un repositorio sin ese `git log` sería el
> registro de un trabajo que aquí no se hizo. Vive en
> [`sgtm/CLAUDE.md`](https://github.com/hneyra/sgtm/blob/migracion-a-microservicios/CLAUDE.md),
> que no se borra. Se consulta; no se copia.

Que la fila **exista** lo comprueba `docs/00-gobierno/verificar-fila-del-registro.mjs` en cada PR
que cierre un issue y toque código de producción. Lo que la fila **diga** —que la mutación sea
real y las cifras cuadren— no lo puede leer una máquina: eso lo lee la revisión.

| Verificación | Cómo se demostró que puede fallar | Resultado |
|---|---|---|

**Las 60 filas viven en [`docs/agent/HISTORY.md`](docs/agent/HISTORY.md)**, y ahí es donde se
escribe la siguiente. Se mudaron el 2026-09-12: eran el **93 %** de este archivo, que se carga
entero en cada sesión ([#114](https://github.com/hneyra/infrastructure/issues/114)).

La tabla de arriba se deja **con su cabecera y vacía** a propósito: es la forma de la fila que hay
que escribir, y tenerla delante evita ir a buscarla.
