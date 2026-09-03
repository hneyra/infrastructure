# ARQ-04 — Estándares de código del backend

**Objetivo:** toda regla que pueda expresarse como verificación automática **se expresa así**.
Una prohibición que solo vive en un documento se incumple en seis meses.

**Este documento vive en `infrastructure` y vale para los cinco repositorios.** Está aquí, y no
copiado en cuatro sitios, porque las reglas que describe las verifica **un solo artefacto**:
[`librerias-backend/comun-verificaciones`](../../librerias-backend/comun-verificaciones), que los
cinco backends consumen como *composite build*. Dos copias de este documento serían dos
estándares el día que alguien edite uno.

## 1. Estructura de un contexto acotado

Capas dentro del mismo módulo Gradle:

```
kamayuk-<contexto>/src/main/java/kamayuk/<sistema>/<contexto>/
├── <Tipo>.java              api publica del contexto: lo unico importable desde fuera
├── dominio/                 entidades, objetos de valor y reglas. Sin Spring, sin JPA
├── aplicacion/              casos de uso, transacciones
└── infraestructura/         persistencia, HTTP, adaptadores
```

- `dominio` no importa Spring ni JPA ni nada de `infraestructura`. Debe probarse sin levantar
  contexto.
- Los demás contextos se importan **solo** por el paquete raíz. Lo verifica Spring Modulith.

## 2. Las diez reglas, y la undécima que trajo la separación

| # | Regla | Verificación |
|---|---|---|
| 1 | Importes en `BigDecimal` / `NUMERIC`. `double` y `float` prohibidos en dominio y API | ArchUnit |
| 2 | Ningún método público de dominio o aplicación recibe `municipalidadId` | ArchUnit |
| 3 | `SET LOCAL` siempre, `SET SESSION` jamás | Escáner de fuentes |
| 4 | Sin `DELETE` sobre tabla protegida (deuda, pagos, recibos, valores, papeletas, asientos, auditoría) | Escáner de fuentes + privilegios de la base |
| 5 | Ningún literal numérico tributario en el código: UIT, tramos, alícuotas, tasas, aranceles, valores unitarios | Revisión + escáner de constantes sospechosas |
| 6 | Las reglas tributarias son funciones puras: sin base de datos, sin reloj, sin configuración global. La fecha entra como argumento | ArchUnit (`LocalDate.now()` y `Instant.now()` prohibidos en dominio) |
| 7 | Nada de Spring ni JPA en `dominio` | ArchUnit |
| 8 | `alicuota`, nunca `tasa`, para un porcentaje | Revisión |
| 9 | No existe «la deuda»: es `deudaActualizadaA(fecha)` | Revisión |
| 10 | Toda modificación de datos exige observación del usuario | ArchUnit (`@Transactional` de escritura sin `Observacion`) + restricción en la base |
| 11 | **Ningún SQL cruza la frontera de sistema**: un `JOIN` contra una tabla de otro sistema | Escáner de fuentes (`FronteraDeSistema`) |

La 11 sólo existe desde que hay cinco repositorios, y es **escáner de texto y no ArchUnit** por el
mismo motivo que `SET SESSION`: lo que cruza la frontera no es un tipo sino un nombre de tabla
dentro de un literal, y en el bytecode un `JOIN predio` no deja huella. Las excepciones se
declaran nominadas, **con el issue que las cierra**, y una excepción que ya no exime nada se pone
roja sola.

**Si agregas una regla, agrega la clase de muestra que la viola**, en
`librerias-backend/comun-verificaciones/src/main/java/kamayuk/comun/verificaciones/muestras/`. Una
regla que no puede fallar no protege nada: una regla mal escrita —un predicado que no casa con ninguna clase— pasa
en verde sin haber revisado nada, y `ArquitecturaTest` solo comprueba que el importador ve
clases de producción, no que cada regla muerda. Por eso existe `ReglasDeArquitecturaMuerdenTest`,
que es un `@TestFactory` sobre todas las reglas: una regla sin muestra sale roja sola.

**Y quién configura las reglas en cada repositorio se descubre por `ServiceLoader`, no por
constructor.** Con constructor, un repositorio que no derivara las clases base simplemente no
correría ninguna barrera y su CI seguiría en verde. Con `ServiceLoader`, cero proveedores falla —y
dos, también.

## 3. Idioma

Español en el dominio, inglés en lo técnico. **Sin tildes en identificadores** —Checkstyle lo
revisa, y es fácil de incumplir con teclado en español—: `alicuota`, `numeracion`, `codigo`.

```java
public final class Papeleta { … }                  // dominio: español
public interface PapeletaRepository { … }          // patrón: inglés
papeleta.importeConBeneficio(fecha);               // comportamiento: español
repository.findByPlaca(placa);                     // infraestructura: inglés
```

Tablas y columnas en `snake_case` español. Campos JSON en `camelCase` español. Comentarios,
pruebas y mensajes de commit en español.

## 4. Nulidad

JSpecify para anotar, NullAway para revisar. Sin el segundo, las anotaciones son documentación.
Los paquetes se anotan `@NullMarked` en su `package-info.java`: lo no anotado es no nulo.

En pruebas la revisión se relaja: una prueba que verifica el fallo ante `null` tiene que poder
pasar `null`.

## 5. Formato y estilo

Reparto deliberado, para que no se peleen:

- **Spotless** impone el formato y sabe arreglarlo: `./gradlew spotlessApply`. Google Java Format
  variante AOSP —4 espacios, 100 columnas—: la de 2 espacios deja ilegible el código con dominio
  en español en cuanto hay tres niveles de anidamiento.
- **Checkstyle** revisa lo que el formato no ve: nombres, identificadores con tilde, tipos
  prohibidos, trampas del lenguaje. Su configuración **no menciona formato**.
- **NullAway** revisa la nulidad.

Las tres son bloqueantes. **Si el build se queja del formato, no lo pelees: `spotlessApply`.**

## 6. Errores

- Excepciones de dominio con nombre del dominio (`DeudaYaCancelada`, `ConvenioQuebrado`), no
  `IllegalStateException` genérica.
- Nunca capturar `Exception` a secas salvo con justificación escrita en el sitio. Checkstyle lo
  marca; `@SuppressWarnings("checkstyle:IllegalCatch")` obliga a explicarlo.
- Los mensajes de error dirigidos al usuario, en castellano; los de registro técnico, también
  —el manual promete castellano en pantallas, reportes, mensajes y ayudas.

## 7. Persistencia

- SQL explícito o repositorios; nada de generación dinámica de consultas que oculte el filtro.
- **Toda consulta corre dentro de una transacción con contexto fijado.** Sin contexto, la base
  falla: eso es una red de seguridad, no un permiso para escribir consultas sin transacción.
- Los índices selectivos empiezan por `municipalidad_id`.
- Nada de `DELETE`. Baja lógica, anulación o asiento de reversión.

## 8. Pruebas

La estrategia completa sigue en
[CAL-01 de `sgtm`](https://github.com/hneyra/sgtm/blob/migracion-a-microservicios/docs/A0-calidad/estrategia-de-pruebas.md).
En resumen:

- Reglas tributarias: pruebas puras, sin Docker, con parámetros congelados.
- Persistencia: PostgreSQL **16** real, con Testcontainers o apuntando a uno existente con
  `-Dkamayuk.pruebas.postgres.url`. **Prohibida la base en memoria**: H2 no tiene RLS y daría
  falsos verdes. Y tiene que ser el 16: en 18 el esquema no corre.
- Una prueba bloqueante **no se omite sola**: sin motor de base de datos, falla.
- **Ninguna aserción de AssertJ compara un `Optional` con algo que no lo es** (#724). Lo revisa
  `AsercionesQueNoPuedenFallarTest`, el único escáner que recorre `src/test` —ahí es donde viven
  las aserciones—, y salta el directorio de muestras. `isEqualTo(Object)` acepta cualquier cosa,
  así que cambiar un accesor de `String` a `Optional` deja las comparaciones compilando y
  significando otra cosa: en una dirección la aserción no puede pasar nunca —sale rojo, tarde, en
  CI, que es como se encontró—, y en la otra pasa **siempre** y no da ningún rojo. Medido: con
  `assertThat(((DerechoSinParametrizar) fallo).llave()).isNotEqualTo("CUALQUIER_OTRA_COSA")`,
  las 31 pruebas de `LicenciaDeEdificacionJdbcTest` de `sgtm` seguían en verde contra PostgreSQL
  real y lo único que lo decía era el escáner.
- El `Optional` se reconoce **sin tipos**, por dos anclas medidas: el nombre del accesor sin
  argumentos cuando **todas** sus declaraciones en el backend devuelven `Optional<…>`, y el cast
  del receptor cuando lo hay. Lo que la regla **no** puede ver está escrito en el javadoc de
  `RevisorDeAserciones`, y no es poco: el nombre ambiguo sin cast, la comparación contra una
  variable y `assertThat(lista).doesNotContain(unOptional)`. Marcar esa última sin poder ver el
  sujeto da **46 hallazgos en el árbol de hoy y los 46 son falsos**; censar por nombre sin exigir
  que sea inequívoco da **40 en 33 archivos**, que es la lección de #437 —un escáner que grita en
  verde deja de leerse—.
