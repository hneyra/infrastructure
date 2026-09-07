# ADR-0038 — El corte entre el producto y el suelo: `kamayuk-lib` y `infrastructure`

| Campo | Valor |
|---|---|
| Estado | **Aceptado** |
| Fecha | 2026-09-07 |
| Decide | Dirección del proyecto, al contestar **D-23** |
| Contesta | [`D-23b`](../../00-gobierno/D-23b-quien-publica-las-librerias-comunes.md) |
| Extiende | [ADR-0031](ADR-0031-infraestructura-comun-y-propia.md), que no se reemplaza, y [ADR-0030](ADR-0030-cuatro-interfaces-una-sesion.md) §4, cuya pregunta abierta cierra |
| Depende de | [ADR-0029](ADR-0029-cuatro-sistemas-separados.md) |
| Habilita | [#23](https://github.com/hneyra/infrastructure/issues/23), [#24](https://github.com/hneyra/infrastructure/issues/24) |

## Contexto

ADR-0030 §4 decidió **qué** librerías comunes hay y qué trae cada una, y dejó una pregunta abierta en
sus consecuencias:

> **Queda por decidir quién publica `comun-*`**: un repositorio `plataforma` con su propio ciclo, o
> cada dueño lo suyo —lo primero anade un quinto repositorio, lo segundo deja `comun-plataforma`
> huerfano— (D-23).

Un año de proyecto después, **lo único extraído es `comun-verificaciones`**, y no vive en ninguna de
esas dos salidas: está en `infrastructure/librerias-backend/`, donde aterrizó en la etapa P3 porque
salía de `sgtm` y había que ponerla en algún sitio. Nadie la eligió como destino y nadie la descartó.

Mientras tanto, lo medido el 2026-09-07 sobre los cinco clones a la altura de su `origin/main`:

```
dominio-compartido   rentas 34/2337 · catastro 33/2296 · normativa 33/2296 · caja 33/2296
plataforma           rentas 63/5858 · catastro 62/5779 · normativa 62/5784 · caja 62/5781
CodigoDeError        rentas 12 constantes · catastro 11 · normativa 11 · caja 11
marco V6             CUATRO puertos del mismo artboard: rentas, normativa, catastro, caja
```

Y **una de esas copias ya divergió**: `SERVICIO_NO_DISPONIBLE` existe sólo en `rentas`.

**El problema de fondo es que ADR-0031 fijó un criterio de dos categorías y el producto tiene tres.**
Aquel ADR separa *lo que describe la plataforma* —«una sola cosa», que va a `infrastructure`— de *lo
que describe un sistema* —que va a su repositorio—. `Dinero`, `Ejercicio`, `Observacion` y
`CalendarioHabil` no son ninguna de las dos: son el **vocabulario del producto**, y valen igual en
los cuatro sistemas sin describir el clúster.

Ponerlos en `infrastructure` por descarte tiene un coste concreto y reciente.
`infrastructure/CLAUDE.md:29` declara de sí mismo:

> **No contiene una sola regla de negocio.** Ni tributo, ni predio, ni recibo. **Ni una línea de Java
> de dominio desde [`E`](../../00-gobierno/E-el-monolito-sale-del-sistema.md)**

Y `E` no lo dice de pasada: retiró el último `TipoDocumento` de las clases de muestra **para que
fuera cierto**, y anotó que con ello el censo de extensiones de C-2 pasaba de cinco esquemas a
cuatro. Deshacer eso para acomodar una extracción es gastar una decisión de hace cuatro commits en
algo que tiene otra salida.

## Decisión

### 1. Un repositorio propio, `kamayuk-lib`, y el criterio que lo gobierna

> **Si describe el clúster, es de `infrastructure`. Si describe el producto y vale igual en los
> cuatro sistemas, es de `kamayuk-lib`. Si sólo vale en uno, es de ese sistema.**

| | Contenido |
|---|---|
| **`kamayuk-lib`** | `comun-dominio`, `comun-plataforma`, `comun-integracion`, `comun-gobierno`, los paquetes npm del V6 y del cliente, **y `comun-verificaciones`** — que se muda, con `ARQ-04` |
| **`infrastructure`** | Pulumi, k3s, PostgreSQL, Keycloak, Traefik, respaldo, observabilidad, el entorno local, el contrato del descriptor, y **las guardas que comparan los cinco repositorios** |
| **Cada sistema** | Sus contextos acotados, su baseline, su `crear-roles.sql`, su `Api.RAIZ`, su descriptor |

**`comun-verificaciones` se muda con las demás, y no es un detalle.** Vive hoy en `infrastructure`
con un argumento escrito —«son las mismas reglas y las verifica el mismo artefacto»— y ese argumento
**viaja con el artefacto**: las reglas que verifica son las once del producto, no las del clúster.
`ARQ-04` se va con ella, por lo mismo que un ADR no se copia.

Lo que **no** se muda, y por eso `infrastructure` no se queda vacío de verificación: `auditoria.ts` y
`convenciones.ts` —que ADR-0031 llamó «el `comun-verificaciones` de la infraestructura»— y las
guardas que leen los cinco clones a la vez (`deriva-de-migraciones`, `imagenes-publicadas`,
`compose-de-los-sistemas`, `siembra-de-la-demostracion`, `extensiones-de-las-migraciones`). Ésas
comparan repositorios, y comparar repositorios es del suelo.

### 2. El consumo no cambia: sigue siendo `includeBuild`

`librerias-backend/README.md` dejó escrito por qué no es un jar publicado:

> Un jar publicado a mano se queda viejo sin que nada se ponga rojo, y una verificación vieja que
> pasa en verde es exactamente el modo de fallo que este proyecto lleva doscientos issues evitando.

**Esa propiedad sobrevive al cambio de repositorio y es la razón de que este ADR no toque el
mecanismo.** Lo que cambia es de qué clon cuelga el `includeBuild`, no que lo haya.

Para el frontend, el mecanismo también existe ya y se repite: `@kamayuk/infra-contrato` vive en
`infrastructure/infra/contrato` y los cuatro sistemas lo consumen con
`"link:../../infrastructure/infra/contrato"`. Los paquetes de `kamayuk-lib` se consumen igual.

### 3. El coste, medido antes de decidir y no después

`backend.yml` de los cuatro sistemas clona `hneyra/infrastructure` **y sólo para
`librerias-backend`** —lo dice su propio comentario, línea 47— más los sistemas hermanos, para las
pruebas de contrato. `infraestructura.yml` lo clona para `@kamayuk/infra-contrato`, y eso no cambia.

| | Coste |
|---|---|
| Los cuatro `backend.yml` | **cero**: clonan `kamayuk-lib` **en vez de** `infrastructure` |
| Los cuatro `infraestructura.yml` | **cero**: siguen clonando `infrastructure` |
| Los cuatro `frontend/` | **+1 clon**, que hoy no tienen ninguno. Es el coste real de esta decisión |

### 4. Lo que este ADR no decide, y hay que decidir aparte

- **Cómo entra la librería en la imagen.** `comun-verificaciones` funciona hoy porque es
  `testImplementation` y la imagen se construye con `-Pkamayuk.sinLibreriasComunes`.
  `comun-dominio` y `comun-plataforma` son `implementation`: **la imagen sí las necesita**. El
  contexto con nombre de BuildKit que #22 propone hay que **demostrarlo con un `docker build` de
  verdad**; si no cuadra, la salida es publicar en GHCR con versionado explícito y aceptar lo que
  eso cuesta.
- **Los nombres de los paquetes npm.** ADR-0030 §4 los bautizó `@kamayuk/ui`, `@kamayuk/shell`,
  `@kamayuk/sesion`, `@kamayuk/api`, `@kamayuk/formato` y `@kamayuk/verificaciones`; #24 los llama
  `@kamayuk/ds`, `@kamayuk/marco` y `@kamayuk/api-web`. **Son dos juegos de nombres para lo mismo**
  y hay que reconciliarlos antes del primer `package.json`.
- **D-19**, quién compone el catálogo de accesos, que roza al marco por el árbol de módulos.
- **El orden de extracción**, que es #22 y no cambia.

## Consecuencias

- **El invariante de `infrastructure` se conserva sin tocarlo.** «Ni una línea de Java de dominio»
  sigue siendo cierto, y `E` no hay que reescribirlo.
- **Un sexto repositorio que operar.** Con su CI, su `CLAUDE.md`, su registro «Verificar antes de
  afirmar» y su guarda de la fila. No es gratis y no se disimula.
- **Aparece el riesgo que ADR-0031 ya nombró, en otro eje.** Allí era «el descriptor que nadie
  compone»; aquí es **la librería que nadie sube**. Un cambio en `comun-dominio` no llega a un
  sistema hasta que alguien mueve su referencia. Con `includeBuild` desde un clon hermano el síntoma
  no puede darse en local —se compila del fuente—, pero **sí en la imagen**, que es donde el punto 4
  queda abierto. **Mitigación obligatoria** el día que la imagen consuma un artefacto versionado: la
  misma que ADR-0031 exige, un trabajo programado que detecte la deriva y abra el PR solo.
- **Los cuatro frontends pasan a depender de un clon hermano.** Hoy no dependen de ninguno, y ésa es
  la propiedad que se pierde. A cambio, el marco V6 deja de estar escrito cuatro veces.
- **`ARQ-04` cambia de repositorio, y los cinco `CLAUDE.md` lo enlazan.** Un enlace roto es barato de
  ver; una copia, no. Por eso se muda y no se duplica.
- **El día que `kamayuk-lib` contenga lógica de un contexto, la separación se rompió.** La regla de
  ADR-0030 §4 sigue siendo la que gobierna: «una librería común no puede contener lógica de negocio
  de un contexto. Si necesita saber qué es un arbitrio, dejó de ser común y es el monolito otra vez,
  repartido y sin que el build lo vea».

## Lo descartado, y por qué

- **`infrastructure/librerias-backend/`** —ratificar lo que ya pasó—. Es lo más barato y obliga a
  reescribir el invariante de §Contexto, que no tiene forma blanda: `Dinero` y `Ejercicio` son
  dominio con cualquier lectura. Con los paquetes npm es peor: componentes React y tokens CSS dentro
  del repositorio que describe el clúster.
- **Cada dueño publica lo suyo** —la segunda salida de ADR-0030—. Deja `comun-plataforma` huérfano,
  como el propio ADR-0030 anticipó. `Dinero` no es de `rentas` más que de `caja`, y ponerlo en uno
  convierte a los otros tres en dependientes de él, que es exactamente lo que ADR-0029 deshizo.
  `librerias-backend/README.md` ya había escrito esta objeción para su propio caso: «si viviera
  dentro de uno, los otros cuatro dependerían de ese».
- **Un monorepo.** ADR-0029 decidió cuatro sistemas separados y sus motivos siguen en pie. Este ADR
  añade un repositorio de librerías, no junta los sistemas.
- **Publicar en un registro Maven desde el primer día.** Se descarta **por ahora** y no por siempre:
  es la salida del punto 4 si el contexto con nombre no cuadra, y entonces hay que versionar y
  aceptar el riesgo de la librería vieja que pasa en verde.
