# `librerias-backend` — lo que comparten los cinco repositorios

Un build de Gradle propio, no un módulo de ninguno de los cinco: si viviera dentro de uno, los
otros cuatro dependerían de ese, que es justo lo que la separación deshace.

## `comun-verificaciones`

Las barreras. Salieron de `sgtm/backend/sgtm-aplicacion/src/test/java/pe/gob/sgtm/verificaciones/`
en la etapa P3 del corte, y lo que hay aquí es lo **genérico**: lo que vale igual en `rentas`,
`catastro`, `normativa` y `caja`.

| Qué | Clase |
|---|---|
| Las 18 reglas de ArchUnit de ARQ-04 §2 | `ReglasDeArquitectura` |
| El escáner de fuentes: `SET SESSION`, `DELETE`/`UPDATE` sobre tabla protegida, literal numérico tributario, política de redondeo, área compuesta a mano | `RevisorDeCodigoFuente` |
| El escáner de aserciones que no pueden fallar (#724) | `RevisorDeAserciones` |
| **La regla nueva del corte**: ningún SQL cruza la frontera de sistema | `FronteraDeSistema` |
| Las clases base de prueba, una por barrera | `…TestBase` |
| **Las 40 clases de muestra**, que son lo que hace que las reglas puedan fallar | `muestras/` |

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
