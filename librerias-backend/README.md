# `librerias-backend` — lo que comparten los cinco repositorios

Un build de Gradle propio, no un módulo de ninguno de los cinco: si viviera dentro de uno, los
otros cuatro dependerían de ese, que es justo lo que la separación deshace.

## `comun-verificaciones`

Las barreras. Salieron de `sgtm/backend/sgtm-aplicacion/src/test/java/pe/gob/sgtm/verificaciones/`
en la etapa P3 del corte, y lo que hay aquí es lo **genérico**: lo que vale igual en `rentas`,
`catastro`, `normativa` y `caja`.

| Qué | Clase |
|---|---|
| Las 20 reglas de ArchUnit de ARQ-04 §2 | `ReglasDeArquitectura` |
| El escáner de fuentes: `SET SESSION`, `DELETE`/`UPDATE` sobre tabla protegida, literal numérico tributario, política de redondeo, área compuesta a mano, **el operador espacial sin marco y la búsqueda por prefijo con `LIKE`** (ADR-0034), y **la escritura de la autorización desde un sistema que no es su dueño** (ADR-0039) | `RevisorDeCodigoFuente` |
| **El revisor de esquema**: toda tabla de tenant con geometría lleva sus cuatro columnas de marco y su índice (ADR-0034). Lee el texto de las migraciones, no el catálogo | `RevisorDeEsquema` |
| El escáner de aserciones que no pueden fallar (#724) | `RevisorDeAserciones` |
| **La regla nueva del corte**: ningún SQL cruza la frontera de sistema | `FronteraDeSistema` |
| **El contraste de las listas de la configuración**: ninguna entrada nombra algo que no está en el árbol (#27) | `SujetosDeLaConfiguracion` |
| Las clases base de prueba, una por barrera | `…TestBase` |
| **Las 47 clases de muestra**, que son lo que hace que las reglas puedan fallar | `muestras/` |

### Cómo se consume

Como **composite build**, desde el `settings.gradle.kts` de cada backend:

```kotlin
includeBuild(file("../../infrastructure/librerias-backend"))
…
dependencies { testImplementation("kamayuk.comun:comun-verificaciones") }
```

**No es un artefacto publicado, y es deliberado.** Un jar publicado a mano se queda viejo sin que
nada se ponga rojo, y una verificación vieja que pasa en verde es exactamente el modo de fallo que
este proyecto lleva doscientos issues evitando (#192 §2). Con `includeBuild`, Gradle la recompila
desde el fuente en cada build: no puede quedarse vieja.

**Lo que cuesta**: los cinco backends no compilan sin tener `infrastructure` clonado al lado. Cada
`settings.gradle.kts` lo comprueba antes y dice el `git clone` que falta; los cinco workflows de CI
hacen checkout de dos repositorios.

### Lo que cada repositorio tiene que declarar

Una implementación de `ConfiguracionDeLasVerificaciones`, descubierta por `ServiceLoader` desde
`src/test/resources/META-INF/services/kamayuk.comun.verificaciones.ConfiguracionDeLasVerificaciones`.

Lo obligatorio es el paquete raíz, el nombre del sistema, sus **listas de tablas protegidas e
inmutables** —que no son las mismas en los cuatro— y el reparto entero de tablas de GOB-05 §2.

**Si falta el proveedor, las barreras no corren en silencio: fallan diciendo qué falta.** Es la
razón de usar `ServiceLoader` y no un parámetro de constructor.

### La regla 12 nace DESACTIVADA, y hay que saberlo

`NINGUN_SISTEMA_QUE_NO_SEA_SU_DUEÑO_ESCRIBE_LA_AUTORIZACION` (ADR-0039) es la única prohibición de
esta librería que **no corre por omisión**. Se activa cuando la configuración del repositorio
implementa `escritoresDeLaAutorizacionConMotivo()`; por omisión ese método devuelve `null`, que
significa «este repositorio todavía no lo ha declarado» y **no** «nadie puede escribirlas».

El motivo es el modo de fallo del día que entra: con la lista declarada vacía los **cinco**
consumidores salen rojos —7 · 4 · 4 · 4 · 7 = **26** escrituras, medido— y ninguna de esas 26 es un
defecto: son las escrituras legítimas que cada repositorio tiene que declarar con su motivo y su
fecha de fin, en su propio PR. Meterla activa de golpe habría dejado los cinco CI en rojo, y una
comprobación que grita el primer día se acaba apagando (#437).

**Lo que cuesta se imprime, no se calla**: `ProhibicionesEnElCodigoFuenteTest` dice en cada corrida
si este repositorio la vigila o no, con el remedio dentro. «No se hace» no es «está bien»
(C-15/C-16).

Lo que cada uno tiene que declarar hoy:

| Repositorio | Entradas | Hasta cuándo |
|---|---|---|
| `identidad` | `AdministracionRepositoryJdbc`, `PermisoRepositoryJdbc` | **Sin fecha**: es el dueño |
| `rentas` | `AdministracionRepositoryJdbc`, `PermisoRepositoryJdbc` | Hasta la **etapa 4** de `identidad#2`, cuando la administración se traslade |
| `catastro`, `normativa`, `caja` | `SembradorDeLaCopiaLocal` | Hasta la **etapa 5**, cuando la copia local la escriba el consumidor del buzón |

**Y ninguna de esas listas puede nombrar algo que no está (#27).** Todas se consultan por nombre,
con `contains` o con `getOrDefault(…, SISTEMA_REPLICADO)`, así que un nombre que no casa con nada
**no da error**: deja de eximir, de permitir o de clasificar a nadie, en verde. Lo contrasta
`SujetosDeLaConfiguracion` desde `ArquitecturaTestBase`, y el criterio **no es el mismo para las
ocho**: es qué cuesta que una entrada no case. Las **seis que eximen o permiten** —
`envoltoriosDeDecimal`, `tiposAjenosQueFiscalizacionSoloLee`, `escriturasSinUsuarioQueObserve`,
`quienesPuedenMoverElContexto`, `busquedasDeTextoLibreConMotivo` y
`escritoresDeLaAutorizacionConMotivo`— tienen que cuadrar y son un **rojo** (la sexta sólo si el
repositorio la ha declarado: `null` no es una lista vacía); las **dos que declaran o reparten** —`modulosDelReparto` y `ambitosAusentes`— van a un
**censo** que se imprime con su motivo. No hay lista de excepciones a propósito: una excepción para
«entradas muertas» sería una puerta abierta a justo el defecto.

### Y las clases base hay que derivarlas

Una clase de dos líneas por barrera, en el módulo de verificaciones de cada repositorio. Que sea de
dos líneas es lo que se buscaba: lo que se comparte es la regla, no la decisión de aplicarla — y su
`test` sale con el nombre del paso de CI de ese repositorio.

## Lo que NO está aquí

El contrato de la API (`ContratoDeApiTest`, `FormasDeLaApiTest`, `RespuestasDeLaApiTest`) y el panel
de recaudación. Cada sistema tendrá su propio contrato: compartirlos sería compartir una verdad que
no es la misma en los cuatro.

## El entregable de la etapa

[`docs/00-gobierno/P3-safeguards.md`](../docs/00-gobierno/P3-safeguards.md): los dos números antes y
después, qué reglas siguen mordiendo y con qué mutación se demostró, la lista de cruces consentidos
con su dueño, y los huecos declarados.
