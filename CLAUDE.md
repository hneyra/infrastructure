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
| La siembra de la municipalidad de demostracion, orquestada desde aqui y **medida contra tres bases** ([C-6](docs/00-gobierno/C-6-la-siembra-orquestada.md): `siembra/pasos.tsv`, su guion, su comprobacion y 11 pruebas nuevas en `yarn verificar`) | Cinco roturas del manifiesto y de sus guardas, cada una sola y restaurada por copia comparada con `cmp`: devolver `cargar-transferencias-demo.sh` a `catastro`; devolver la copia de `fichas.csv` a `rentas`; que el paso 3 declare `requiere: 7`; que el paso 6 declare un proceso que `catastro` no implementa; y comprobar el paso 1 contra una columna que `vias.csv` no tiene. Y, contra PostgreSQL 16.15 de verdad, la que da nombre a la correccion: sembrar el paso 3 sin el paso 2 | 2, 2, 2, 2 y 1 en rojo. **Y la que importa no es ninguna de esas cinco sino la medida**: el paso 3 sin el 2 imprime «15 fila(s) leidas, 0 manzana(s) nueva(s), 15 rechazada(s)» y sale con **codigo 0** — quince filas leidas, ninguna dentro, y el proceso diciendo que fue bien. Con la comprobacion puesta: «`0 de 15`: FALTAN 15 (el paso 3 necesita antes el paso 2)», exit 1. **El contraste es la mitad que importa y hubo que medirlo aparte**: repetir un paso ya sembrado —lo que hace `--desde N`— imprime **exactamente la misma linea**, asi que el cargador no puede distinguirlos y no debe; lo unico que los separa es lo que la tabla TIENE, y por eso se cuentan totales y no incrementos: repetir sigue en verde. La primera rotura es el defecto que el corte introdujo y que nadie podia ver, porque su sintoma es la ausencia de sintoma: `catastro/…/cargar-transferencias-demo.sh` lanzaba un Job con la imagen de `catastro` y una propiedad que **solo `rentas` atiende**, de modo que la aplicacion arrancaba, **no cargaba ni una fila** y salia con codigo 0 —cero lineas de carga, ni un aviso—. **Y ejecutar destapo tres defectos que ninguna revision habria visto, los tres del corte y ninguno de la siembra**: (1) **ninguna de las cuatro aplicaciones arranca**, en ningun perfil, porque ocho clientes HTTP inyectan el `ObjectMapper` de Jackson 2 y Boot 4 solo autoconfigura el `JsonMapper` de Jackson 3 —las pruebas no lo ven porque construyen los clientes con `new ObjectMapper()`—; (2) **`catastro` y `caja` no tienen ninguna implementacion de `ComprobadorDeAcceso`** —su javadoc dice «vive en `seguridad`», y `seguridad` se quedo en `rentas`—, asi que sus controladores piden un bean que no existe y **esas dos aplicaciones no se han arrancado nunca**; y (3) **nada implanta la municipalidad fuera de `rentas`**, aunque `SoloEnDemostracion` consulte `es_demostracion` en la base de su propio sistema — el hueco de #430 con `area` y `caja`, otra vez. Los tres quedan **declarados y no arreglados**: para poder medir se aportaron dos beans desde un classpath de arnes fuera de todo repositorio. Sembrado de cero contra PostgreSQL 16.15 —cuatro bases, cuatro `crear-roles.sql` dentro de su base, 11+4+2+1 migraciones—, **seis de los diez pasos cuadran al ultimo registro** (15 vias, 4 sectores, 15 manzanas, 5 cajas y 3 areas, 16 contribuyentes, 8 vehiculos) y los cuatro restantes se paran por los huecos de arriba. **Y el recuento enseño algo que solo se ve contando**: el paso 10 dejo «32 de 54» —murio a mitad con 32 asientos ya escritos, porque cada fila es su propia transaccion y no hay reversion—, o sea que un paso que falla no deja la base como estaba, y hasta ahora nadie lo decia. Ninguna cifra esta escrita a mano: `pasos.tsv` lleva expresiones sobre el propio CSV (`fichas.csv:filas+detalle-de-fichas.csv:distintos:codigoPredial` resuelve a las **45** versiones de ficha que el juego de datos anuncia) |
| **C-7 — las cuatro aplicaciones arrancan** ([C-7](docs/00-gobierno/C-7-que-arranquen.md): el entorno del descriptor gana `operacion`, el inventario de INF-06 pasa de diez entradas a once, y dos guardas nuevas —18 pruebas— en `yarn verificar`) | Cuatro roturas, cada una sola y restaurada por copia comparada con `cmp`: quitar del descriptor de `caja` sus dos variables de ADR-0026 §4; quitar el `REVOKE CONNECT ... FROM PUBLIC` de `rentas/crear-roles.sql`; devolverle a `rol_carga_parametros` el `CONNECT` sobre la base de `rentas`; y sacar `rol_ingestor_catastro` del inventario de secretos | 2 en rojo la primera —stg y prod—, «`kamayuk-caja-web` (perfil web) no declara KAMAYUK_CAJA_CANAL, KAMAYUK_CAJA_RESPONSABLE … el pod no levanta: no arranca degradado, no arranca»; 1, 1 y 1 las otras tres. **Y la guarda de las variables se DERIVA del `application.yaml` que viaja en el jar, por perfil**, no de una lista: una lista se desincroniza el primer mes y su modo de fallo es que la variable nueva no aparece en ella, la guarda pasa en verde y el pod deja de levantar. **Lo que la medición corrigió antes de tocar código**: el punto decía «`rol_carga_parametros` conserva `CONNECT` sobre la base de `rentas`», y medido contra PostgreSQL 16.15 lo que hay es más general —PostgreSQL concede `CONNECT` a PUBLIC al crear una base, así que **todo** rol del clúster puede abrir sesión contra la de cualquier sistema: `has_database_privilege` da `true` antes del `REVOKE` y `false` después—. Se cierra en los cuatro `crear-roles.sql`, que corren como superusuario; `V2` de `rentas` ya lo había dejado dicho y no lo pudo hacer, porque `sgtm_owner` a propósito no es dueño de la base (#722). Comprobado sobre una base recién provisionada de `catastro`: `rol_carga_parametros CONNECT=false`, `rol_ingestor_catastro CONNECT=false`, y los tres que pertenecen en `true` |
| **C-12 — el índice trigrama, inalcanzable bajo RLS** ([C-12](docs/00-gobierno/C-12-el-indice-trigrama.md): `V13` de `rentas` lo retira, y 9 pruebas de plan nuevas) | Siete roturas, cada una sola y restaurada por copia comparada con `cmp`: el pool como **`sgtm_owner`**; medir con la conexión que **omite RLS**; que `conElIndice` **no cree el índice**; deshacer `V13`; sembrar **una sola** municipalidad; recortar `LA_CADENA_ENTERA` al operador solo; y, en `catastro`, devolver el `now()` de la base al buzón de salida | **1 y sólo el centinela** la primera —con `FORCE ROW LEVEL SECURITY` el dueño también queda sujeto a la política (#537, #545)—; 3; **exactamente 1, el contraste**; 5, y las cinco nombran la causa; 1; 1; y 1. **Lo que la medida cambió antes de tocar código**: no es que el índice esté mal usado, es que hacen falta **dos** cosas a la vez para que sirva —preguntar con `%` y no tener RLS delante— y la aplicación no tiene ninguna de las dos; el 2×2 medido con 30 000 contribuyentes en cada una de dos municipalidades lo dice en una tabla: sólo la esquina «superusuario × `%`» usa el índice (781 páginas, 32,2 ms), y las otras tres leen el padrón entero del inquilino descartando 29 243 filas en el `Filter` con el plan **diciendo «Index»** —#313 por sexta vez—. **Las tres salidas conocidas se midieron y ninguna sirve**: la columna generada de #565/`V66` deja `Seq Scan` (allí lo no-*leakproof* era la función, aquí es el operador); el censo de `pg_proc` dice que **ningún** operador de `pg_trgm` ni de arreglos es *leakproof*, así que no hay el sustituto que #536 tuvo; y el compuesto con `btree_gin` es la lección de #313 literal —«Index», `Index Cond` de sólo `municipalidad_id`—. **Y la que sí funciona enseña por qué no se toma**: marcar sólo `similarity_op` **no cambia el plan** —PostgreSQL inserta en línea `nombre_normalizado`, así que dentro del predicado quedan además `lower`, `regexp_replace` y `unaccent`—, y con las **cinco** marcadas el índice se usa **y la condición de la política baja al `Filter`**: cinco actos de superusuario sobre cuatro funciones en C, dos de ellas usadas por medio sistema. Se retira: cuesta 2 496 kB (31 % del montón) y **casi dobla** el alta en el padrón (75,0 ms frente a 38,9 por cada 5 000), y su nombre promete una búsqueda que no ocurre. La búsqueda **no cambia**, medido fila a fila: 584 = 584. **Y una mutación encontró un defecto en la propia prueba**: con el índice creado una vez en el `@BeforeAll`, quitarle esa línea dejaba **las nueve en verde**, porque otra prueba lo recreaba en su `finally`; con el índice creado por prueba, la misma mutación deja exactamente un rojo y es el contraste. Dos hallazgos más salieron de medir: retirar el índice deja a `rentas` **sin ningún objeto que inserte en línea** el cuerpo de `nombre_normalizado`, así que su ida y vuelta de `pg_dump` da **0 errores y 347 índices a los dos lados** aun con el cuerpo frágil —la `V11` de C-4 deja de ser lo que sostiene esa restauración, y quien la sostiene hoy es `catastro`—; y el buzón de salida de `catastro` fechaba con `now()` de la base mientras quien publica ya recibía su `Clock`, de modo que `lote-de-eventos.json` se reescribía en cada corrida y tapaba el cambio de forma del evento que ese archivo existe para enseñar. En **`sgtm` no se puede arreglar** y se dice: su `V11` es una migración aplicada del archivo histórico |
| **C-9a — el CI no puede clonar repositorios hermanos** ([C-9a](docs/00-gobierno/C-9a-el-ci-y-los-clones.md): los diez `path: ../` de los cinco repositorios, y una guarda nueva de 24 pruebas que lee los flujos de los **seis** clones) | Dos roturas sobre los flujos reales, cada una restaurada por copia comparada con `cmp`: devolver `path: ../sgtm` a `.github/workflows/infra.yml`, y devolver `path: ../infrastructure` al `infraestructura.yml` de **`rentas`** | 1 en rojo cada una, y las dos nombran archivo y linea: «`.github/workflows/infra.yml:191` — «path: ../sgtm»» y «`.github/workflows/infraestructura.yml:57` — «path: ../infrastructure»». **La segunda es la mitad que hacia falta**: los cuatro sistemas quedan cubiertos DESDE aqui, porque este repositorio ya tiene sus clones en CI y dejarlo al CI de cada uno seria el mismo hueco otra vez —el sintoma solo aparece al empujar—. **No hubo que provocar el defecto**: la primera publicacion de este repositorio fallo en **9 segundos** con «Repository path '/home/runner/work/infrastructure/sgtm' is not under '/home/runner/work/infrastructure/infrastructure'», y eran diez sitios escritos desde P6 y C-2 que ninguna guarda podia ver. **La decision fue mover el ANFITRION y no la raiz**: este repositorio se clona en `path: infrastructure` y el espacio de trabajo pasa a ser el padre, asi que `clonDe`, `settings.gradle.kts` y el `link:` de los cuatro descriptores **no cambian una linea** y no hay dos disposiciones que decidir. La variable de entorno se midio y se descarto por tres motivos: en los cuatro sistemas el hermano lo resuelve **yarn al instalar** (`link:`) y ninguna variable lo redirige; `process.env` suelto esta **prohibido** aqui por ESLint con su muestra; y el precedente ya existia —`sgtm/.github/workflows/backend.yml` se clona en `path: sgtm` desde P3—. **Y lo que impide que la guarda muerda de mas son los contrastes**, dentro de la misma muestra: un `path:` de `actions/cache` y un `cache-dependency-path:` que **si** salen del espacio de trabajo, mas la mencion de un `path: ../` **dentro de un comentario** —que es como el propio `infra.yml` explica por que ya no tiene ninguno—. Se declara ademas el limite que no se puede decidir leyendo el archivo (un `path: ${{ … }}`) y **se mide** que hoy no hay ninguno. **Y de paso, el segundo flujo de esa publicacion, que fallaba por otra causa**: `spotlessJavaCheck` sobre `VectoresDeHuellaTestBase.java` —un import sin usar que P3 dejo sin formatear—, arreglado con `spotlessApply` y comprobado ejecutando `spotlessCheck` y `build`. **Y medir el criterio 4 destapo un tercer rojo, anterior y no arreglado aqui**: el `yarn verificar` de los cuatro sistemas falla en `tsc` con «Property 'operacion' is missing … in type 'EntornoDelDescriptor'», deriva de C-7, que nadie vio porque su CI **nunca ha corrido**. **Publicado y comprobado contra el CI de verdad** (`9b100ff`): «Librerias de backend» pasa a **verde**, y «Infraestructura» **entra en los dos primeros checkouts** —el que antes moria en 9 segundos ahora pasa— y muere en el tercero por una barrera DISTINTA que este arreglo destapo: los cuatro sistemas son repositorios **privados** y el `GITHUB_TOKEN` de un flujo solo alcanza al suyo, asi que `hneyra/sgtm` (publico) entra y `hneyra/rentas` da «Not Found» al pedir su rama por omision. **No se cierra desde aqui** —el repositorio no tiene ni un secreto (`gh secret list` vacio) y la credencial es del dueño—: los cuatro checkouts pasan a pedir `token: ${{ secrets.CLONES_TOKEN || github.token }}`, que **hoy no cambia nada** (un secreto sin declarar vale la cadena vacia) y el dia que exista lo cambia todo. Y **no** se pone `continue-on-error`: dejaria el flujo en verde con las guardas mirando un clon que no esta, que es el verde falso que #675 existe para impedir. **Y medido con `gh api`, hacen falta DOS cosas y no una**: los cuatro remotos existen y su `main` tiene **un `README.md` y nada mas**, asi que el token por si solo traeria cuatro clones vacios y caerian igual `extensiones-de-las-migraciones`, `deriva-de-migraciones` y esta guarda — hay que publicar su contenido (27, 20, 13 y 12 commits sin empujar) **y** dar la credencial. Lo que si se cierra es que ese estado no pueda pasar en verde: `flujosDe` **lanza** cuando el clon no trae `.github/workflows/`, con su motivo y su prueba, en vez de devolver cero hallazgos |
