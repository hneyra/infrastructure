# P3 — Safeguards: las barreras salen a un artefacto compartido

**Fecha:** 2026-09-03. **Repositorios tocados:** `infrastructure`, `sgtm`, `rentas`, `catastro`,
`normativa`, `caja`.

Objetivo de la etapa: sacar las barreras a un artefacto compartido, **demostrar en `sgtm` que
siguen mordiendo**, y dejarlas enganchadas en los cinco repositorios **antes** de que llegue una
sola clase de negocio.

---

## 1. Los dos números, antes y después

Medidos ejecutando, no razonados. La medida previa se tomó **antes de tocar nada**, y la posterior
sobre el árbol final con el artefacto compartido en el classpath.

| Tarea | Antes | Después | Diferencia |
|---|---:|---:|---:|
| `./gradlew verificarArquitectura` | **123** | **130** | **+7** |
| `./gradlew verificarAislamiento` | **223** | **223** | **0** |

`verificarAislamiento` se reparte igual que antes: 46 en `sgtm-esquema` y 177 en `sgtm-plataforma`.
No se tocó ninguno de los dos módulos.

**La extracción en sí no perdió ni una prueba.** Se comparó nombre a nombre, no sólo el total. Las
cinco que «desaparecen» son renombres, y las doce que aparecen se explican una a una:

| Cambio | Por qué |
|---|---|
| 3 pruebas de `ReglasDeArquitecturaMuerdenTest` con otro nombre | Su nombre **es** la descripción de la regla, y las reglas que se acotaban a `pe.gob.sgtm..` ahora vigilan también el árbol de las muestras. Son las mismas 19 |
| `ArquitecturaTest::las reglas acotadas al dominio…` → `…las reglas acotadas encuentran clases de verdad, y las que no, lo declaran` | La misma prueba, ampliada con el censo de ámbitos (ver §4). Siguen siendo 3 |
| `Prohibiciones::las clases de la lista de excepciones…` → **dos** pruebas | La lista de clases que componen el área a mano **es de cada sistema**. Se parte en «el mecanismo exime, y lo decide el nombre de la clase» (genérica, en la librería) y «las seis clases de sgtm, una a una» (propia). **+1** |
| `FronteraDeSistemaTest`, 6 pruebas | La regla nueva de §3. **+6** |

**En los cuatro repositorios nuevos** (`rentas`, `catastro`, `normativa`, `caja`), idénticos entre
sí: `verificarArquitectura` **79** pruebas y `verificarAislamiento` **9**, las dos verdes.

Las 79 no son un verde vacío: `ReglasDeArquitecturaMuerdenTest` aplica **las 18** reglas a sus
muestras y exige que cada una falle, y esa demostración corre entera con cero clases de negocio
porque las muestras viajan con las reglas. Y las 9 tampoco: verifican los cuatro roles, `FORCE ROW
LEVEL SECURITY`, el `WITH CHECK`, que sin contexto la consulta **revienta en vez de devolver
vacío**, y la trampa del superusuario — sobre una tabla que la propia prueba crea, así que valen
sin baseline y seguirán valiendo con él.

Cómo se midieron sin Docker: ver §7.

---

## 2. `comun-verificaciones`, y cómo lo consume cada repositorio

Vive en `infrastructure/librerias-backend/comun-verificaciones`, paquete
`kamayuk.comun.verificaciones`, en `src/main` (no en `src/test`: quien la consume la pone en su
`testImplementation`, y para eso tiene que ser el artefacto principal).

**Lo que se llevó:**

| Qué | Forma en que viaja |
|---|---|
| `ReglasDeArquitectura` (18 reglas de ArchUnit) | Clase, parametrizada por paquete raíz |
| `RevisorDeCodigoFuente` (escáner de fuentes: `SET SESSION`, `DELETE`/`UPDATE` sobre tabla protegida, literal tributario, redondeo, área) | Clase, parametrizada por las **listas de tablas** |
| `RevisorDeAserciones` (#724) | Clase |
| `ArquitecturaTest`, `ProhibicionesEnElCodigoFuenteTest`, `AsercionesQueNoPuedenFallarTest`, `ReglasDeArquitecturaMuerdenTest` | Clases base abstractas; cada repositorio deriva la suya |
| **Las 40 clases de muestra** más 12 tipos sustituto que necesitan para compilar | `src/main/java/…/muestras/`, y **también empaquetadas como recurso** (§5) |

**Lo que NO viajó, y por qué:** `PanelSinRecorrerElLibroTest` (es de indicadores),
`ContratoDeApiTest`, `FormasDeLaApiTest`, `RespuestasDeLaApiTest`, `FormaSegunJacksonTest`,
`ParametrosDeLaConsultaTest`, `DiscriminadorDeLoQueFaltaPublicarTest`, `AccesosCompartidosTest`,
`AreaEnLaMismaFormaEntreModulosTest`, `ModulosTest`. Cada sistema tendrá su propio contrato, así
que compartirlos sería compartir una verdad que no es la misma en los cuatro.

### La decisión de consumo: composite build

**Se eligió `includeBuild` de Gradle** frente a `mavenLocal` y frente a un jar por ruta.

El criterio no fue la comodidad sino **el modo de fallo**. Un jar publicado a mano se queda viejo
sin que nada se ponga rojo, y una verificación vieja que pasa en verde es exactamente lo que este
proyecto lleva doscientos issues evitando —el «verde rancio» de #192 §2 y #399—. Con
`includeBuild`, Gradle recompila la librería desde el fuente en **cada** build del backend: no
puede quedarse vieja.

**LO QUE CUESTA, dicho aquí y no descubierto en P5A:** los cinco backends **ya no compilan sin
tener `infrastructure` clonado al lado**. Es una dependencia nueva de la máquina de quien
construye y de CI. Se mitiga, no se esconde:

- cada `settings.gradle.kts` comprueba el directorio **antes** y falla con el `git clone` que hace
  falta, en vez de dejar que Gradle reviente sobre un directorio inexistente;
- los cinco workflows de CI hacen checkout de **dos** repositorios, con `path:` para que queden
  hermanos.

### Que nadie se olvide de configurarla

La configuración por repositorio (`ConfiguracionDeLasVerificaciones`) se descubre por
`ServiceLoader`, y **no** se pasa por constructor. El motivo es el mismo: si se pasara por
constructor, un repositorio que no derivara las clases base simplemente no correría ninguna
barrera y su CI seguiría en verde. Con `ServiceLoader`, cero proveedores falla y dos también.

**Medido**: borrando el descriptor de `sgtm` y corriendo `verificarArquitectura`:

```
java.lang.IllegalStateException: Ningun proveedor de
kamayuk.comun.verificaciones.ConfiguracionDeLasVerificaciones en el classpath de prueba. Sin el,
las barreras de comun-verificaciones no saben ni cual es el paquete raiz ni que tablas protege
este sistema, y correrian sin revisar nada.
```

---

## 3. La regla nueva: `NINGUN_SQL_CRUZA_LA_FRONTERA_DE_SISTEMA`

`kamayuk.comun.verificaciones.FronteraDeSistema`, con `FronteraDeSistemaTestBase` y **tres
muestras**: una que cruza, una que no (el contraste) y una que cruza y está consentida.

Es un **escáner de texto** y no una regla de ArchUnit, por el mismo motivo que `SET SESSION`: lo
que cruza la frontera no es un tipo sino un nombre de tabla dentro de un literal, y en el bytecode
un `JOIN predio` no deja huella.

En `sgtm` el sistema de cada archivo sale de su **módulo Gradle** (GOB-05 §1), no del repositorio:
declarar «esto es rentas» acusaría a `sgtm-catastro` de leer sus propias tablas.

### Lo que encontró: los siete cruces de GOB-05 §6, y ni uno más

17 puntos de lectura en **7 clases**, que son exactamente las siete que el inventario había
encontrado a mano. §6.2 (`CobrarDeuda`) no aparece y es correcto: no es una consulta, es una
transacción que escribe en dos sistemas.

**No se arreglaron aquí.** Están en `CrucesConsentidosDelSgtm`, y esa lista **es la lista de
trabajo pendiente**:

| Identificador | Clase | Tabla(s) ajenas | Frontera | Le toca a | Salida (GOB-05 §6) |
|---|---|---|---|---|---|
| `PENDIENTE-CRUCE-01` | `DeteccionRepositoryJdbc` | `predio`, `sector`, `ficha_catastral` | rentas → catastro | **rentas** | Proyección local alimentada por evento. Componerlo en memoria ya falló (#631) |
| `PENDIENTE-CRUCE-01` | `ConciliacionRepositoryJdbc` | `ficha_catastral`, `predio` | rentas → catastro | **rentas** | La **misma** proyección: es el mismo padrón contado en vez de paginado. Dos proyecciones distintas darían dos cifras del mismo día (#564) |
| `PENDIENTE-CRUCE-02` | `ValuacionRepositoryJdbc` | `valor_unitario_edificacion`, `depreciacion`, `conjunto_parametro_detalle` | catastro → normativa | **catastro** | Snapshot sellado cacheado (ADR-0025 §1): una petición por corrida, no 300 000 |
| `PENDIENTE-CRUCE-03` | `ValorReferencialRepositoryJdbc` | `valor_referencial_vehiculo`, `conjunto_parametro_detalle` | rentas → normativa | **rentas** | El mismo snapshot, otro ámbito |
| `PENDIENTE-CRUCE-04` | `TitularPrincipalRepositoryJdbc` | `titularidad` | rentas → catastro | **rentas** | Puerto HTTP; **ya existe** (#366). Cuidado con el desempate, que es de la consulta y no del puerto |
| `PENDIENTE-CRUCE-05` | `CuotaDeArbitrioRepositoryJdbc` | `predio` | rentas → catastro | **rentas** | Puerto HTTP: el filtro devuelve como mucho un predio |
| `PENDIENTE-CRUCE-06` | `ReciboRepositoryJdbc` | `contribuyente` | caja → rentas | **caja** | **D-17** abierta; hasta que se decida, puerto HTTP |

**Los issues no se crearon, y hay que decirlo.** `gh` **sí puede** (token con alcance `repo`, los
cinco repositorios remotos existen con issues habilitados), pero crear siete issues es una mutación
remota que esta sesión no tenía encargada, y la instrucción de no empujar nada apuntaba a lo
contrario. Los identificadores `PENDIENTE-CRUCE-nn` se distinguen a simple vista de un número de
GitHub a propósito: inventar un `#642` que pareciera real sería peor que no poner nada. **Cada uno
dice a qué repositorio le toca**, que es lo que el criterio pide —dueño y rastro—. Abrirlos es un
comando y sustituir el identificador, una línea.

Dos guardas impiden que la lista se pudra:

- **una excepción sin issue no se construye**: el compacto de `CruceConsentido` la rechaza;
- **ninguna excepción puede sobrar**: `ningunCruceConsentidoSobra` vuelve a escanear **sin** la
  lista y exige que cada entrada siga eximiendo un cruce de verdad.

---

## 4. Qué reglas siguen mordiendo, y cuáles se quedaron sin muestra

`ReglasDeArquitecturaMuerdenTest` corre en los cinco repositorios y aplica **las 18** reglas a las
muestras. En `sgtm`: 19 pruebas verdes (18 reglas + «las muestras existen»).

**Demostrado que la cadena entera muerde**, y desde la librería:

| Mutación | Resultado |
|---|---|
| Borrar `muestras/indicadores/MuestraDePanelQueLeeLaBase.java` **en `infrastructure`** | `verificarArquitectura` de **`sgtm`** rojo, nombrando la regla del panel: 130 pruebas, 1 fallo |
| Borrar el descriptor de `ServiceLoader` de `sgtm` | Todas las barreras fallan con el mensaje de §2, no en verde |
| Conectar la prueba de aislamiento de `rentas` como superusuario en vez de como el rol de la aplicación | Rojo: «el rol de la aplicacion ve solo la suya… expected: 1L» |

**Ninguna regla se quedó sin muestra.** Se comprobó por construcción —`cadaReglaDetectaSuViolacion`
es un `@TestFactory` sobre `todas()`, así que una regla sin muestra sale roja sola— y se verificó
que las 18 pasan.

**Dos matices que hay que declarar, porque son debilitamientos reales y acotados:**

1. **`allowEmptyShould(true)` en dos reglas** —la frontera de `fiscalizacion` y el panel de
   recaudación—, porque `catastro`, `normativa` y `caja` no tienen esos contextos y ArchUnit
   rechazaría la regla por no encontrar clases. **No las deja mudas**: `ArquitecturaTestBase` censa
   los dos ámbitos y exige que el declarado ausente lo esté **de verdad** y el no declarado tenga
   clases. Si mañana `catastro` estrena un `..fiscalizacion..` sin declararlo, se pone rojo.
2. **`allowEmptyShould(true)` sobre todas las reglas mientras un repositorio declare
   `sinContextosAcotadosTodavia()`**. El permiso se da en el punto de aplicación y no en cada
   regla, precisamente para que valga **exactamente mientras** esa declaración esté puesta — y la
   declaración caduca sola: se exige que no haya ni una clase en `..dominio..`.

---

## 5. Lo que se encontró de paso, midiendo

### El escáner de fuentes no veía los bloques de texto

`LITERAL_JAVA` sólo casaba literales de una línea, y **13 archivos de `src/main` escriben su SQL en
bloques de texto** —entre ellos los cinco cruces más caros de GOB-05 §6, que el escáner nuevo no
encontraba—. Es un punto ciego que llevaba ahí desde que el escáner existe.

**Se midió antes de decidir**: con los bloques de texto dentro, `ProhibicionesEnElCodigoFuenteTest`
sigue en verde. Es decir, **el punto ciego existía y no había nada escondido en él** — pero un
`DELETE FROM cuenta_corriente_asiento` dentro de un bloque de texto habría pasado inadvertido.
Corregido, y los dos escáneres comparten ahora un solo recorrido de literales para que no puedan
discrepar.

### La lista de tablas de las muestras, derivada en vez de escrita a mano

La primera versión se escribió a ojo y dejó fuera seis tablas; el síntoma fue **once pruebas de la
demostración contando de menos** en los repositorios nuevos. Ahora se deriva de las propias
muestras cruzada con cómo las clasifica `sgtm`.

### La prueba de aislamiento no necesita esperar al baseline

El hallazgo que hizo barata la etapa: **la trampa del superusuario se puede demostrar sin ni una
migración**, sobre una tabla que la propia prueba crea con el mismo bloque de RLS que `V6` le pone
a toda tabla de tenant. Por eso `verificarAislamiento` en los cuatro repositorios nuevos no es un
verde vacío: verifica los cuatro roles, `FORCE ROW LEVEL SECURITY`, el `WITH CHECK`, que sin
contexto la consulta **revienta en vez de devolver vacío**, y la trampa.

---

## 6. Los cinco hallazgos de RLS, trasladados

Copiados —no enlazados— a `docs/40-datos/hallazgos-de-rls.md` de `rentas`, `catastro`,
`normativa`, `caja` e `infrastructure`. Son del **motor**, no del esquema del monolito, y los
cuatro sistemas van a tropezar con ellos igual: el superusuario omite RLS; una partición no hereda
la política del padre; bajo RLS un `LIKE 'prefijo%'` no llega al índice y se escribe como rango;
una clave foránea nueva sobre una tabla con RLS no se puede validar y va `NOT VALID`; y el operador
espacial tampoco llega al índice, **con el plan diciendo «Index» igual**.

Un enlace a otro repositorio se deja de seguir; una copia se lee cuando duele.

---

## 7. Huecos declarados

1. **Los issues de los seis cruces no se crearon.** Ver §3. Se usan identificadores
   `PENDIENTE-CRUCE-nn` con el repositorio dueño escrito al lado.
2. **`verificarAislamiento` no se midió contra Docker.** El túnel al demonio remoto
   (`unix:///tmp/docker.sock`) **estaba caído** durante toda la sesión: la primera llamada
   respondió y ninguna después. Error exacto y repetido:
   `Cannot connect to the Docker daemon at unix:///tmp/docker.sock. Is the docker daemon running?`
   No se pudo reabrir: no hay proceso de reenvío vivo, `ssh` pide contraseña (`Permission denied
   (publickey,password)`) y no hay `ControlMaster` que reutilizar. El contenedor
   `kamayuk-verificador` no era alcanzable por el mismo motivo.
   **Salida usada, y es la documentada:** un PostgreSQL **16.15 real** instalado localmente con
   PostGIS 3.4.4 compilado contra él, apuntado con `-Dsgtm.pruebas.postgres.url`. Las 223 de
   `sgtm` y las 9×4 de los repositorios nuevos se ejecutaron **de verdad** contra ese motor.
   Lo que **no** se ejercitó por esta vía es el camino de Testcontainers.
   *De paso salió un hallazgo que conviene tener escrito:* **el esquema no corre en PostgreSQL 18.**
   `V11` falla con `text search dictionary "unaccent" does not exist` al planificar
   `nombre_normalizado`, porque PG 17+ restringe el `search_path` al insertar una función SQL en
   línea. Con PG 16 —la versión que el proyecto declara— pasa. No se abrió issue.
3. **Los workflows se escribieron pero no se empujaron.** Empujar `.github/workflows/` exige un
   token con alcance `workflow`; el que hay lo tiene, pero esta sesión no empuja nada. Es el mismo
   bloqueo que #711 documentó.
4. **`verificarAislamiento` de los cuatro repositorios nuevos no censa ningún esquema todavía**,
   porque no hay baseline (ADR-0032). Lo declara `SIN_ESQUEMA_TODAVIA` y **caduca solo**: la
   primera tabla de tenant pone la prueba en rojo pidiendo que se retire la línea y que se traiga
   del monolito el resto —siembra en dos municipalidades, `INSERT` ajeno, `UPDATE` ajeno,
   particiones—.
5. **`DatosDePrueba` (1937 líneas) no viajó**, por lo mismo: es la siembra del esquema del
   monolito.
6. **Los roles de base de datos siguen llamándose `sgtm_owner`, `sgtm_app`, `sgtm_readonly` y
   `rol_carga_parametros`** en los cuatro repositorios nuevos. **Es deliberado**: los roles son del
   **clúster**, no de la base, y los cuatro sistemas comparten clúster. Renombrarlos rompería
   `crear-roles.sql`, los guiones de secretos y la rotación de `infra/`, que no son de esta etapa.
   *Queda anotado para quien decida el nombre definitivo.*
7. **La librería no tiene Checkstyle ni NullAway**, sólo Spotless con el mismo formato que los
   cinco. Añadirlos exige el `buildSrc` de `sgtm`, que todavía no se ha extraído.

---

## 8. Cada archivo de `sgtm` que se tocó, y por qué

La regla del proyecto es que `sgtm` no se modifica salvo que un prompt lo pida. **Este lo pidió
explícitamente** («aquí se hace la extracción y se prueba»), así que se tocó lo que P3 necesita y
nada más:

| Archivo | Qué se hizo y por qué |
|---|---|
| `backend/settings.gradle.kts` | `includeBuild` de la librería, con la comprobación previa que dice qué falta |
| `backend/sgtm-aplicacion/build.gradle.kts` | `testImplementation("kamayuk.comun:comun-verificaciones")` en lugar de `libs.archunit` |
| `.github/workflows/backend.yml` | Checkout de los **dos** repositorios; `working-directory` a `sgtm/backend` |
| `…/verificaciones/ReglasDeArquitectura.java` | **Borrado**: se fue a la librería |
| `…/verificaciones/RevisorDeCodigoFuente.java` | **Borrado**: se fue a la librería |
| `…/verificaciones/RevisorDeAserciones.java` | **Borrado**: se fue a la librería |
| `…/verificaciones/muestras/**` (40 archivos) | **Borrados**: viajan con las reglas. Se queda `MuestraDeControladorSinDiscriminador`, que es de #691 y su prueba no viajó |
| `…/verificaciones/ArquitecturaTest.java` | Pasa a derivar de `ArquitecturaTestBase` |
| `…/verificaciones/ReglasDeArquitecturaMuerdenTest.java` | Pasa a derivar de su base |
| `…/verificaciones/AsercionesQueNoPuedenFallarTest.java` | Deriva de su base y **conserva** la prueba que es de `sgtm`: la premisa de #724 afirmada contra este árbol |
| `…/verificaciones/ProhibicionesEnElCodigoFuenteTest.java` | Deriva de su base y **conserva** las dos que son de `sgtm`: el censo de las seis clases del área y la celda del historial |
| `…/verificaciones/ConfiguracionDelSgtm.java` | **Nuevo**: paquete raíz, reparto de las 132 tablas, sistema por módulo Gradle, exenciones |
| `…/verificaciones/TablasDelSgtm.java` | **Nuevo**: las listas de tablas protegidas e inmutables, sacadas del cuerpo del escáner con sus comentarios intactos |
| `…/verificaciones/CrucesConsentidosDelSgtm.java` | **Nuevo**: los seis cruces de §3 con su dueño |
| `…/verificaciones/FronteraDeSistemaTest.java` | **Nuevo**: la regla de §3 aplicada al monolito |
| `…/test/resources/META-INF/services/…` | **Nuevo**: el descriptor de `ServiceLoader` |
| `…/verificaciones/EndpointsPublicados.java` | Sólo el `import` de `ReglasDeArquitectura` |
| `…/verificaciones/ParametrosDeLaConsultaTest.java` | Sólo el `import` |
| `…/verificaciones/DiscriminadorDeLoQueFaltaPublicarTest.java` | Sólo el `import` de `Hallazgo` |
| `…/verificaciones/RevisorDelDiscriminador.java` | Sólo el `import` de `RevisorDeCodigoFuente` |

**No se tocó** ni `sgtm-esquema`, ni `sgtm-plataforma`, ni ningún contexto acotado, ni ninguna
migración, ni ningún documento de `docs/`.
