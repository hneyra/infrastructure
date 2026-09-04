# `infrastructure` — Contexto para agentes

La plataforma de **Kamayuk**: Pulumi sobre k3s, PostgreSQL, Keycloak, Traefik, respaldo,
observabilidad, el entorno local y **las barreras que verifican a los cuatro sistemas**. Nada de
esto es de ningún sistema: es el suelo sobre el que cada repositorio levanta lo suyo
([ADR-0031](docs/30-arquitectura/adr/ADR-0031-infraestructura-comun-y-propia.md)).

Los otros cuatro son [`rentas`](https://github.com/hneyra/rentas),
[`catastro`](https://github.com/hneyra/catastro), [`normativa`](https://github.com/hneyra/normativa)
y [`caja`](https://github.com/hneyra/caja). El archivo histórico —y la única copia con `git log`
de la historia entera— es [`sgtm`](https://github.com/hneyra/sgtm), que **no se borra ni se
modifica**.

## Qué hay hoy, medido y no supuesto

| Pieza | Estado |
|---|---|
| `infra/` — Pulumi en TypeScript | **Existe**, y `yarn verificar` corre **sin Pulumi, sin token y sin clúster**. Hoy da **366 verdes y 0 rojas**: los dos defectos heredados de la mudanza se cerraron en P6 —la deriva medía contra el repositorio equivocado, y el `sed` del guion de reserva era sintaxis GNU— y [DEV-02 §2](docs/D0-desarrollo/pruebas.md) conserva su registro |
| `despliegue/plataforma.compose.yaml` | **Existe y levanta**: PostgreSQL con **las cuatro bases**, Keycloak con **sus dos realms**, Mailpit y Traefik |
| `despliegue/compose.yaml` | El perfil `todo`, heredado del monolito. **Sigue tal cual** y es el que usa CI |
| `librerias-backend/comun-verificaciones` | **Existe.** 18 reglas de ArchUnit, tres escáneres de fuentes y **40 clases de muestra**, consumidas por los cinco backends |
| `backend/sgtm-esquema/…/db/migration` | **Las 68 migraciones del monolito, como referencia.** No las aplica nadie desde aquí; el baseline de cada sistema es [ADR-0032](docs/30-arquitectura/adr/ADR-0032-el-esquema-nace-en-baseline.md) |
| `docs/30-arquitectura/adr/` | 12 ADR y el índice |
| Los cuatro `V1__baseline.sql` | **NO están aquí.** Viven en `sgtm/docs/40-datos/baselines/` |
| Las librerías `comun-dominio`, `comun-plataforma`, `comun-integracion` | **NO existen.** Sólo `comun-verificaciones`. **D-23** decide quién las publica |

## Lo que este repositorio NO hace

- **No contiene una sola regla de negocio.** Ni tributo, ni predio, ni recibo. Lo único de
  dominio que hay aquí es `TipoDocumento`, que las muestras necesitan para compilar.
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
despliegue/             el entorno local: los dos composes, identidad e inicializacion del motor
librerias-backend/      Gradle. `comun-verificaciones`, que consumen los cinco backends
backend/sgtm-esquema/   las 68 migraciones del monolito, como referencia historica
herramientas/           los guiones del reparto de ADR y su verificador de enlaces
docs/                   ADR, gobierno, hallazgos de RLS, estandares de codigo y D0-desarrollo
```

**`docs/30-arquitectura/estandares-de-codigo-backend.md` vive aquí y no en los cuatro**, junto a
`comun-verificaciones`: son las mismas reglas y las verifica el mismo artefacto. Los cuatro
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
| D-23 | **Quién publica las librerías comunes** | `comun-dominio`, `comun-plataforma`, `comun-integracion` |
| D-25 | **Si la separación llega o no al hierro.** Cuatro sistemas sobre un k3s de un nodo comparten disponibilidad | El dimensionado |
| D-19 | Cómo llega el catálogo de accesos a cuatro sistemas | La sesión |
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
## Comandos

```bash
# El descriptor y los componentes del cluster. Sin Pulumi, sin token y sin cluster
yarn install
yarn verificar
yarn manifiestos --ambiente stg     # lo que se desplegaria, en JSON
yarn capacidad --ambiente prod      # ¿cabe el stack en el nodo?
yarn secretos --ambiente stg        # el inventario: nombre, clave, rotacion. Nunca un valor

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
servicio:** la prueba provisiona, y `ALTER ROLE` sobre `sgtm_owner` y `sgtm_app` vale para todas
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
| La extensión que una migración necesita está declarada, **en los cinco esquemas** ([C-2](docs/00-gobierno/C-2-guarda-de-extensiones.md); la guarda de #742 extendida, 14 → 22 pruebas) | Ocho roturas, cada una sola y restaurada por copia comparada con `cmp`: quitar de su `crear-roles.sql` una extensión que su baseline **sí** usa, en la copia local del monolito (`postgis`), en `sgtm` (`btree_gist`), en `rentas` (`unaccent`) y en `catastro` (`postgis`); quitarle a `normativa` una que **no** usa, y luego además hacer que la use; añadirle a `caja` —que no declara ninguna a propósito— un `unaccent(...)` en su baseline; quitar `caja` de `SISTEMAS`; y apartar el clon de `normativa` | 2, 2, 2, 2, 3, 5, 2, 4 en rojo, y la última **no concluye** con el `git clone` que la arregla. **El defecto era que la guarda no podía fallar en cuatro repositorios de cinco**: tenía la ruta del monolito escrita a mano, y el mismo mecanismo ya se había cobrado cuatro roturas —`V61` con `geography`, `V72` con `btree_gist`, el baseline de `rentas` y el de `caja`—, las dos últimas descubiertas **por casualidad** al aplicarlas a mano. La séptima rotura es la que mide eso: quitar un sistema de `SISTEMAS` deja de mirar un repositorio entero, y ahora pone 4 en rojo. **Y lo que la medición corrigió antes de tocar código**: `normativa` declara cuatro extensiones y **no usa ninguna**, y `catastro` una de más; esa dirección **se marca como censo con su motivo y no como rojo**, porque un rojo nacería disparado en dos de seis y una comprobación que grita el primer día se silencia (#437) — y porque retirar una declaración cambia cómo se provisiona esa base en todos los ambientes, decisión del dueño de ese esquema como lo fue la de P5D y la de P5E. La `postgis` de `normativa` no es inocua: no es *trusted* y arrastra la exención de `spatial_ref_sys` en su prueba de aislamiento, que `rentas` ya retiró. **Y de paso, la entrada de Gradle del contrato del consumidor**, que C-1 dejó declarada como hueco 1: sin declararla, mutar `rentas/docs/…/normativa.json` daba `BUILD SUCCESSFUL` con `:kamayuk-normativa-aplicacion:test` **UP-TO-DATE**; declarada, la misma mutación pone la tarea a correr y falla nombrando el campo. El mismo hueco estaba **también en `rentas`** (`ContratoConCajaTest`), que nadie había contado, y se cierra igual |
