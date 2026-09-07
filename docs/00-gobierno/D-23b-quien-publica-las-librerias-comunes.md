# D-23b — Quién publica las librerías comunes

| Campo | Valor |
|---|---|
| Estado | **CONTESTADA** el 2026-09-07: un repositorio propio, `kamayuk-lib` |
| Decide | Dirección del proyecto |
| Registro canónico | **No existe.** Ver §1 |
| Recoge la decisión | [ADR-0038](../30-arquitectura/adr/ADR-0038-el-corte-entre-el-producto-y-el-suelo.md) |
| Fecha de este documento | 2026-09-07 |

Este documento **no toma la decisión ni la supone**: la pone donde se pueda contestar, con lo que
hay construido medido. Lo escribe la misma sesión que trabaja [#21](https://github.com/hneyra/infrastructure/issues/21),
porque [#23](https://github.com/hneyra/infrastructure/issues/23) y
[#24](https://github.com/hneyra/infrastructure/issues/24) estaban bloqueados por esto.

---

## 0. La trampa del nombre, primero, porque muerde

**«D-23» nombra dos cosas distintas en este repositorio, y una de ellas dice «aplicado».**

| | Qué es | Estado |
|---|---|---|
| [`D-23-quien-publica-las-imagenes.md`](D-23-quien-publica-las-imagenes.md) | Las **ocho imágenes** de los cuatro sistemas en `ghcr.io` | **Aplicado**, cerrado |
| `CLAUDE.md:80`, fila «D-23» | **Quién publica las librerías comunes** (`comun-dominio`, `comun-plataforma`, `comun-integracion`) | **Abierta** — es ésta |

Quien lea el fichero y concluya que D-23 está cerrada habrá dado por decidido justo lo que aquí se
decide. Por eso este documento se llama **D-23b** y no `D-23`: el nombre estaba ocupado, y renombrar
el otro rompería los enlaces de `E`, de `F` y del registro de `CLAUDE.md`.

---

## 1. Lo que la decisión dice — y que su texto no está escrito en ninguna parte

**Medido**: el registro canónico de decisiones abiertas, `sgtm/docs/00-gobierno/decisiones-abiertas.md`,
llega hasta **D-16**.

```
$ grep -oE "\bD-[0-9]+[a-z]?\b" sgtm/docs/00-gobierno/decisiones-abiertas.md | sort -u -V
D-01 D-02 D-02a D-02b D-02c D-03a D-03c D-03d D-04 D-05 D-06 D-08 D-09 D-10 D-11 D-13 D-14 D-15 D-16
```

D-17 a D-25 **nunca entraron en él**. `sgtm` es el archivo histórico y no se modifica, así que su
ausencia no se corrige: se suple. El único sitio donde D-23 está enunciada con sus salidas es
[ADR-0030](../30-arquitectura/adr/ADR-0030-cuatro-interfaces-una-sesion.md) §Consecuencias:

> **Queda por decidir quién publica `comun-*`**: un repositorio `plataforma` con su propio ciclo, o
> cada dueño lo suyo —lo primero anade un quinto repositorio, lo segundo deja `comun-plataforma`
> huerfano— (D-23).

**Dos salidas, y ninguna es la que hoy existe.** `infrastructure/librerias-backend/` no es «un
repositorio `plataforma`» ni «cada dueño lo suyo»: apareció por vía de hecho en la etapa P3, cuando
`comun-verificaciones` salió de `sgtm` y hubo que ponerla en algún sitio. Nadie la eligió como
destino permanente y nadie la descartó.

---

## 2. Qué hay construido, medido

Todo lo de aquí se midió el 2026-09-07 sobre los cinco clones a la altura de su `origin/main`.

### 2.1 Lo único extraído hoy

`infrastructure/librerias-backend/` es **un build de Gradle propio** con un solo módulo,
`comun-verificaciones`, consumido como *composite build*. Su README dice por qué no es un jar
publicado:

> **No es un artefacto publicado, y es deliberado.** Un jar publicado a mano se queda viejo sin que
> nada se ponga rojo, y una verificación vieja que pasa en verde es exactamente el modo de fallo que
> este proyecto lleva doscientos issues evitando (#192 §2).

**Esa propiedad no se negocia y sobrevive a las tres salidas**: sea cual sea el repositorio, el
consumo sigue siendo `includeBuild`.

### 2.2 Lo que está copiado y no extraído

```
dominio-compartido   rentas 34/2337 · catastro 33/2296 · normativa 33/2296 · caja 33/2296
plataforma           rentas 63/5858 · catastro 62/5779 · normativa 62/5784 · caja 62/5781
CodigoDeError        rentas 12 constantes · catastro 11 · normativa 11 · caja 11
```

`SERVICIO_NO_DISPONIBLE` existe **sólo en `rentas`**. Es la divergencia que ya cuesta, y está
contada en #22 y #23.

Y en frontend, **cuatro** puertos del mismo artboard V6 —no tres, como dicen #22 y #24:
`rentas`, **`normativa`**, `catastro` y `caja`. `normativa/frontend/src/marco/` trae los mismos ocho
ficheros que `rentas` y `src/ds/` los mismos ocho componentes.

### 2.3 El invariante que `infrastructure` declara de sí mismo

`infrastructure/CLAUDE.md:29`, en «Lo que este repositorio NO hace»:

> **No contiene una sola regla de negocio.** Ni tributo, ni predio, ni recibo. **Ni una línea de
> Java de dominio desde [`E`](E-el-monolito-sale-del-sistema.md)**

Y `E` no lo dice de pasada: *retiró* el último `TipoDocumento` de las clases de muestra para que
fuera cierto, y anotó que el censo de extensiones de C-2 pasaba de cinco esquemas a cuatro por ello.

**`comun-dominio` es `Dinero`, `Alicuota`, `Porcentaje`, `Ejercicio`, `Observacion`,
`CodigoContribuyente`, `CalendarioHabil`.** Es vocabulario del dominio con cualquier lectura.

### 2.4 El grafo de clones, que es lo que decide el coste

```
$ grep -rn "repository:" <sistema>/.github/workflows/*.yml
```

| Flujo | Qué clona, y para qué |
|---|---|
| `backend.yml` (los cuatro) | `hneyra/infrastructure` **y sólo para `librerias-backend`** —lo dice su propio comentario, línea 47— más los sistemas hermanos, para las pruebas de contrato |
| `infraestructura.yml` (los cuatro) | `hneyra/infrastructure`, para `@kamayuk/infra-contrato` |
| Los cuatro `frontend/` | **ninguno** |

### 2.5 El mecanismo de consumo entre repositorios ya existe y funciona

`@kamayuk/infra-contrato` vive en `infrastructure/infra/contrato` y los cuatro sistemas lo consumen
con `"@kamayuk/infra-contrato": "link:../../infrastructure/infra/contrato"`. No hay que inventar
nada para el frontend: hay que repetir esto.

---

## 3. Las tres salidas

### 3.1 Un repositorio propio, `kamayuk-lib`

Todo lo común —`comun-dominio`, `comun-plataforma`, `comun-integracion`, `comun-gobierno`, los
paquetes npm **y `comun-verificaciones` con ellos**— sale a un repositorio nuevo.

- **Lo que compra**: el invariante de §2.3 se conserva sin tocarlo. `infrastructure` sigue siendo el
  suelo —Pulumi, k3s, PostgreSQL, Keycloak, Traefik, respaldo— y el producto tiene dónde vivir.
- **Lo que cuesta, medido**: si `comun-verificaciones` se muda también, `backend.yml` clona
  `kamayuk-lib` **en vez de** `infrastructure` (§2.4) → **coste cero** en los cuatro backends. El
  coste real es **+1 clon en los cuatro frontends**, que hoy no clonan ninguno.
- **Lo que hay que aceptar**: un sexto repositorio, y que `ARQ-04` se mude con las reglas que
  verifica —hoy vive aquí «porque son las mismas reglas y las verifica el mismo artefacto», y ese
  argumento viaja con el artefacto—.

### 3.2 `infrastructure/librerias-backend/`

Ratificar lo que ya pasó.

- **Lo que compra**: cero repositorios nuevos, cero cambios en los flujos, y el `includeBuild` ya
  escrito.
- **Lo que cuesta**: hay que **reescribir el invariante de §2.3**, y no hay forma blanda de hacerlo
  —`Dinero` y `Ejercicio` son dominio con cualquier lectura—. Con `@kamayuk/ds` es peor: componentes
  React y tokens CSS dentro del repositorio que describe el clúster.
- **Y el precedente que lo desaconseja**: `E` es de hace cuatro commits. Deshacerlo para acomodar una
  extracción es gastar una decisión reciente en algo que tiene otra salida.

### 3.3 Cada dueño publica lo suyo

La segunda salida de ADR-0030.

- **Lo que compra**: ningún repositorio nuevo, y encaja con `<sistema>-cliente`, que ADR-0030 §4 ya
  manda publicar al dueño de la API.
- **Lo que cuesta**: lo dice el propio ADR-0030 — **deja `comun-plataforma` huérfano**. `Dinero` no
  es de `rentas` más que de `caja`; ponerlo en uno convierte a los otros tres en dependientes de él,
  que es exactamente lo que ADR-0029 deshizo. Y `librerias-backend/README.md` ya escribió esta misma
  objeción para su propio caso: «si viviera dentro de uno, los otros cuatro dependerían de ese, que
  es justo lo que la separación deshace».

---

## 4. Qué habría que deshacer, y qué sobrevive a las tres

**Sobrevive a las tres:** el consumo por `includeBuild` (§2.1); que `Api.RAIZ`, los baselines, los
contextos acotados y `crear-roles.sql` **no** se extraen; y que la extracción no puede aflojar una
barrera —la lección de R-N, donde renombrar un paquete dejó una frontera entera sin revisarse **en
verde**—.

**Sólo hay que deshacer algo en 3.2**: el invariante de §2.3, y con él una frase de `E`.

**Lo que cambia de sitio según la salida** es el destino que #23 y #24 tienen escrito en sus
criterios de aceptación: los dos dicen `librerias-backend/`.

---

## 5. Qué depende de esta respuesta

- **#23** (`comun-dominio` y `comun-plataforma`): 95 archivos cambian de paquete en cuatro
  repositorios a la vez. No se empieza sin destino.
- **#24** (`@kamayuk/ds`, `@kamayuk/marco`, `@kamayuk/api-web`): el `link:` necesita saber a dónde
  apunta.
- **#22** AC-5, «se decide y queda escrito qué NO se extrae».
- Y el orden que `rentas/CLAUDE.md:37` ya dejó anotado para cerrar el hueco de los clientes:
  «`comun-dominio` (D-23) → contrato derivado en cada dueño → `<sistema>-cliente` con su prueba de
  contrato».

---

## 6. La respuesta

**Un repositorio propio: `kamayuk-lib`.** Ahí van **todas** las librerías comunes.

El corte es **producto contra suelo**:

| | Contenido |
|---|---|
| **`kamayuk-lib`** | `comun-dominio`, `comun-plataforma`, `comun-integracion`, `comun-gobierno`, los paquetes npm del V6 y del cliente, **y `comun-verificaciones`** con `ARQ-04` |
| **`infrastructure`** | Pulumi, k3s, PostgreSQL, Keycloak, Traefik, respaldo, observabilidad, el entorno local, el contrato del descriptor, y **las guardas que comparan los cinco repositorios** |

El criterio, para que no haya que volver a discutirlo pieza a pieza: **si describe el clúster, es de
`infrastructure`; si describe el producto y vale igual en los cuatro sistemas, es de `kamayuk-lib`;
si sólo vale en uno, es de ese sistema.** Lo fija [ADR-0038](../30-arquitectura/adr/ADR-0038-el-corte-entre-el-producto-y-el-suelo.md).

### Lo que esta decisión NO contesta

- **No decide el orden de extracción.** Ése es #22, y su orden (1 → 2 → 4 → 5/6 → 3) no cambia.
- **No decide cómo entra la librería en la imagen.** El contexto con nombre de BuildKit que #22
  propone hay que **demostrarlo con un `docker build` de verdad**, y si no cuadra la salida es
  publicar en GHCR con versionado explícito. Es AC-3 de #22 y #23.
- **No decide los nombres de los paquetes npm.** ADR-0030 §4 los bautizó `@kamayuk/ui`,
  `@kamayuk/shell`, `@kamayuk/sesion`, `@kamayuk/api`, `@kamayuk/formato` y
  `@kamayuk/verificaciones`; #24 los llama `@kamayuk/ds`, `@kamayuk/marco` y `@kamayuk/api-web`.
  **Son dos juegos de nombres para lo mismo** y hay que reconciliarlos antes de escribir el primer
  `package.json`.
- **No decide D-19** —quién compone el catálogo de accesos—, que roza a `@kamayuk/marco` por el
  árbol de módulos.
- **No crea el repositorio.** Crearlo y poblarlo es el primer paso de #23.
