# ADR-0030 — Cuatro interfaces, una sesión, y las librerias comunes que impiden que sean cuatro productos

| Campo | Valor |
|---|---|
| Estado | **Aceptado** |
| Fecha | 2026-09-03 |
| Decide | Dirección del proyecto |
| Reemplaza | [ADR-0009](https://github.com/hneyra/sgtm/blob/migracion-a-microservicios/docs/30-arquitectura/adr/ADR-0009-plataforma-frontend.md) en su clausula «una sola aplicación por ahora» |
| Depende de | [ADR-0029](ADR-0029-cuatro-sistemas-separados.md) |
| Conserva | [ADR-0013](https://github.com/hneyra/rentas/blob/main/docs/30-arquitectura/adr/ADR-0013-permisos-de-la-sesion.md) y [ADR-0020](https://github.com/hneyra/rentas/blob/main/docs/30-arquitectura/adr/ADR-0020-la-sesion-del-ciudadano.md) sin cambio |
| Abre | D-23, D-24 |


> Aceptado el 2026-09-04 por la direccion del proyecto, al contestar **D-22**: el producto lo opera un equipo central, no cada municipalidad. Ver [`D-22`](../../00-gobierno/D-22-quien-opera-cuatro-despliegues.md) en `infrastructure`.

## Contexto

ADR-0009 decidió «una sola aplicación **por ahora**», y la separación en cuatro sistemas cambia el
«por ahora»: el equipo de catastro tiene que poder desplegar su interfaz cuando cambia su ficha, sin
coordinar con la emisión predial.

Lo que hay que evitar es el resultado habitual de partir una interfaz: cuatro aplicaciones que se ven
distinto, se comportan distinto ante el mismo `405`, obligan a iniciar sesión cuatro veces y
convierten una decisión de arquitectura en una degradación de servicio en ventanilla.

Y hay un riesgo más silencioso: **el repositorio nuevo copia y pega**. Un `catastro-web` creado sin
librerias comunes se lleva una copia del filtro de errores, del renderizador de fallo y de la sesión;
en seis meses hay cuatro interpretaciones del `405` pelado de nginx y ninguna se corrige en las
cuatro.

## Decisión

### 1. Un frontend por sistema

`catastro-web`, `rentas-web`, `normativa-web`, `caja-web`. Cada uno vive en el repositorio de su
sistema y se despliega con el.

El **portal del ciudadano se queda con `rentas`**: consulta deuda y paga, que es exactamente lo que
`rentas` y `caja` publican, y conserva su realm propio y su emisor distinto (ADR-0020).

### 2. Las rutas llevan el sistema delante

`catastro/api/v1/predios`, `rentas/api/v1/contribuyentes`, `normativa/api/v1/conjuntos`,
`caja/api/v1/cobros`. El primer segmento enruta sin mirar más, y —lo que importa más— **la ruta dice
quien responde**.

Hoy eso está escondido a propósito: `GET /api/v1/catastro/fichas/conciliacion` la sirve `rentas`, y
ADR-0015 tuvo que argumentar por escrito que «quien la sirve es un detalle de donde vive el código».
Con cuatro despliegues deja de ser un detalle: es a qué origen va la petición y qué audiencia necesita
el token. Esa operación pasa a ser `rentas/api/v1/fichas/conciliacion`.

**Efecto colateral que hay que resolver en la fase 2**: la redirección `307` que hoy lleva
`conciliadaConRentas` de una ruta a la otra pasaría a cruzar origenes, con CORS con credenciales y un
token de dos audiencias. La salida limpia es que la interfaz llame directo a la ruta buena —ya es la
mitad frontend pendiente de ADR-0015— y que `catastro` vuelva a responder `422` a ese parámetro, con
un motivo mejor: no es que el contexto no exista, es que vive en otro sistema.

### 3. Un login para los cuatro

Un realm de funcionario y un *client* público por frontend, con PKCE. El primero que el usuario abra
hace el *login*; los otros tres obtienen su token con `prompt=none` contra la sesión del navegador.

- **La audiencia se pide, no se asume.** Un frontend que llama a la API de otro sistema pide un token
  con **esa** audiencia. Es donde aparecen los `403` raros si nadie lo diseño: la pantalla funciona en
  desarrollo, donde todo es el mismo origen, y falla en producción.
- **Salir de uno sale de los cuatro.** *Back-channel logout* del realm. En una municipalidad la PC de
  ventanilla se comparte entre turnos; una sesión que sobrevive en la pestana de al lado es un
  problema de control de acceso, no de comodidad.
- **Los permisos siguen viniendo del servidor.** ADR-0013 no cambia: los cuatro frontends leen
  `rentas/api/v1/sesion/permisos` con una cache corta. Qué la interfaz oculte una opción es
  comodidad; la comprobación es del servidor que sirve la operación.
- **El salto entre sistemas lleva el sujeto puesto.** Ir de la ficha catastral a la cuenta corriente
  del titular abre `rentas-web` con el contribuyente ya resuelto. Es el patron `acto` que la interfaz
  ya usa —«Actualizar catastro» lleva el predio puesto—, ahora entre origenes.

### 4. Las librerias comunes, y la regla que las gobierna

> **Una libreria común no puede contener lógica de negocio de un contexto.** Si `@kamayuk/ui` necesita
> saber qué es un arbitrio, dejó de ser común y es el monolito otra vez, repartido y sin que el build
> lo vea.

**Backend** — artefactos Gradle, versión semántica, fijados por versión en cada sistema:

| Artefacto | Qué trae |
|---|---|
| `comun-dominio` | El actual `sgtm-dominio-compartido`: `MunicipalidadId`, `Ejercicio`, `Dinero`, `Alicuota`, `Porcentaje`, `AreaM2` |
| `comun-plataforma` | Filtro del token, `TenantContext`, el `SET LOCAL`, la guardia del pool, `@RequiereAcceso` y su `ComprobadorDeAcceso`, `problem+json`, `CodigoDeError`, `correlacionId` |
| `comun-integracion` | El sobre del evento, outbox, inbox con deduplicación, cliente HTTP con reintento e idempotencia, huella canonica |
| `comun-verificaciones` | Las reglas de ArchUnit **y sus clases de muestra que las violan** |
| `normativa-reglas` | El motor y las reglas (ADR-0025). Lo pública `normativa` |
| `<sistema>-cliente` | Los tipos y el cliente HTTP de cada API. **Lo publica el dueño de la API, no el consumidor** |

**Frontend** — paquetes npm: `@kamayuk/ui` (el sistema de diseño derivado del prototipo), `@kamayuk/shell`
(carril de módulos, paleta de comandos, enrutado, renderizador de fallo), `@kamayuk/sesion` (OIDC, PKCE,
renovación silenciosa, audiencias, selector de municipalidad, *logout* de los cuatro), `@kamayuk/api`
(`solicitar()` y el catálogo de errores emparejado con el backend), `@kamayuk/formato` (fechas, importes,
código predial, placa) y `@kamayuk/verificaciones` (los arneses, parametrizados por catálogo de
destinos).

**El cliente lo pública el dueño de la API** porque es la diferencia entre una versión del contrato y
cuatro copias que envejecen aparte. Va con su prueba de contrato en CI: el proveedor falla si deja de
cumplir lo que su cliente promete. Es lo que sustituye a lo que hoy hace el compilador cuando alguien
cambia la firma de un puerto.

### 5. Los arneses viajan, o no existen

`sin-red` es la regla que gobierna esta interfaz: recorre los destinos con todas las peticiones
abortadas y falla si alguno enseña una cifra. Con cuatro frontends el riesgo se multiplica, porque
ahora una pantalla puede quedarse sin datos **porque el otro sistema está caído**, un caso que hoy no
existe. Y `prosa` —la que ata cada frase del tipo «ninguna lectura publica ese catálogo» a una ruta
del contrato, y que encontró cinco frases falsas en un día con los otros diez arneses en verde— pasa a
tener que mirar **cuatro** contratos.

**Si esos dos no viajan a cada repositorio en la misma semana en que se crea, no viajan nunca.**

## Consecuencias

- **Las librerias comunes van antes del segundo repositorio.** Extraerlas antes cuesta una semana;
  después cuesta un año de divergencia.
- **Ningúna libreria obliga a un despliegue coordinado.** Si lo obliga, es acoplamiento disfrazado y
  hay que partirla. Cada sistema sube de versión cuando quiere.
- **El funcionario de ventanilla que consulta y cobra toca dos aplicaciones.** El criterio para saber
  si la frontera está bien puesta es medible y hay que instrumentarlo desde el primer día: **si una
  tarea corriente cruza de sistema más de una vez, la frontera está mal, no la interfaz** (D-24). La
  salida intermedia, si aparece, es que `caja-web` embeba la consulta de deuda como componente
  publicado por `rentas-web`, sin dejar de ser dos aplicaciones.
- **Las 134 opciones del manual siguen siendo 134**, repartidas por sistema. Ningúna desaparece y
  ninguna se duplica.
- **Queda por decidir quién publica `comun-*`**: un repositorio `plataforma` con su propio ciclo, o
  cada dueño lo suyo —lo primero anade un quinto repositorio, lo segundo deja `comun-plataforma`
  huerfano— (D-23).

## Lo descartado, y por qué

- **Un solo frontend con cuatro origenes detras.** Conserva la experiencia de ventanilla intacta y es
  la opción menos arriesgada, pero devuelve el acoplamiento de despliegue que la separación venía a
  quitar: catastro no podría publicar una pantalla sin coordinar con la emisión.
- **Micro-frontends con carga en tiempo de ejecución.** Resuelve el salto pero anade un sistema de
  composición, versionado cruzado en producción y depuración en dos capas — mucha maquinaria para un
  problema que el SSO y un `shell` compartido resuelven.
- **Copiar el código común en cada repositorio.** Es lo que pasa sólo si nadie decide lo contrario, y
  en un año hay cuatro filtros de token distintos. Lo que evita eso no es la disciplina: es que exista
  el artefacto antes que el segundo repositorio.
- **Poner los permisos en el token.** ADR-0013 ya lo descartó y ahora sería peor: 134 opciones por
  siete privilegios no caben, y un cambio de permiso obligaría a renovar sesión en los cuatro.
