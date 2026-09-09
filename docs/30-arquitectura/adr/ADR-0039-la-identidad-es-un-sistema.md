# ADR-0039 — La autorización es un sistema, y se replica por el buzón

| Campo | Valor |
|---|---|
| Estado | **Aceptado** |
| Fecha | 2026-09-09 |
| Decide | Dirección del proyecto, al contestar **D-19** sobre las tres salidas de [#29](https://github.com/hneyra/infrastructure/issues/29) |
| Contesta | La pregunta que [#29](https://github.com/hneyra/infrastructure/issues/29) §5 midió y deliberadamente no eligió |
| Extiende | [ADR-0030](ADR-0030-cuatro-interfaces-una-sesion.md) §3, que deja las pantallas de administración en `rentas`, y [ADR-0029](ADR-0029-cuatro-sistemas-separados.md) |
| Depende de | [ADR-0028](ADR-0028-el-tenant-no-cruza-por-http.md) §3 (el buzón), [ADR-0013](https://github.com/hneyra/rentas/blob/main/docs/30-arquitectura/adr/ADR-0013-permisos-de-la-sesion.md) |
| No toca | La **autenticación**, que ya es una y ya es SSO sobre Keycloak |
| Se construye en | [#52](https://github.com/hneyra/infrastructure/issues/52), que reparte las etapas de abajo en sus criterios |

## Contexto

`#29` midió el estado y encontró que la pregunta que se hacía —«¿el módulo `seguridad` de `rentas`
debería ser un servicio?»— escondía **dos preguntas, y sólo una estaba abierta**. La
autenticación ya es una: los cuatro backends validan contra el mismo emisor y ADR-0030 §3 ya lo
llama «un login para los cuatro». Lo abierto es la **autorización**.

Y midiendo apareció algo que no era duplicación sino **un defecto vivo**:

- las nueve escrituras de administración de seguridad viven **sólo** en `rentas`, y escriben **la
  base de `rentas`**;
- en `catastro`, `normativa` y `caja` el único escritor de las tablas de seguridad es el
  sembrador de la copia local, que corre **una vez al implantar**, **sólo agrega** (`ON CONFLICT
  … DO NOTHING`) y siembra **un** usuario: el administrador;
- no hay evento, ni cliente HTTP, ni tabla de sincronización entre ellos.

Consecuencia: **un permiso concedido en `rentas` no llega nunca a los otros tres**, y un
funcionario que no sea el administrador recibe un 403 de cada pantalla de `catastro`, `normativa`
y `caja` — con la única salida de escribir SQL a mano contra producción. Hoy no se ve porque cada
municipalidad declarada tiene un solo usuario; **se ve el día que haya un segundo funcionario**.

## Decisión

**La autorización pasa a ser un sistema propio, y su réplica viaja por el buzón que ADR-0028 §3 ya
define.** Es la salida 3 de `#29` §5.

Cada sistema **sigue autorizando contra su copia local**: el `GuardiaDeAcceso` no cambia, y
`ComprobadorDeAccesoJdbc` sigue leyendo su propia base. Lo que cambia es **de dónde sale esa
copia**: hoy de un sembrador que corre una vez, y desde aquí de una corriente de eventos que el
sistema de identidad emite cada vez que alguien concede, revoca, da de alta o da de baja.

### Se llama `identidad`, y **nunca** `seguridad`

No es una preferencia: **ADR-0033 ya reserva esa palabra** para un quinto sistema de *seguridad
ciudadana* —serenazgo, luminarias, cámaras— y hasta razona por qué no cabe dentro de `catastro`.
Dos sistemas llamados `seguridad` no se descubren al escribirlo: se descubren cuando alguien
dimensiona el motor equivocado o abre el repositorio equivocado.

## Por qué esta salida y no las otras dos

**La salida 1 —`rentas` publica la API y los tres preguntan— rompe una propiedad que `caja` existe
para tener.** Su `CLAUDE.md` lo dice: «no le pregunta nada a nadie para cobrar […] es lo que hace
cierto que la ventanilla cobre con `rentas` apagado», y está medido — `kamayuk-caja-nucleo` declara
un solo `implementation(project(...))` y ningún puerto hacia otro sistema. Poner a `rentas` en el
camino caliente de las 82 comprobaciones de los otros tres convierte «`rentas` caído» en «la
ventanilla cerrada». Una caché local lo mitigaría y **reintroduciría** el problema de propagación
que la salida venía a resolver, ahora con un plazo que habría que elegir.

**La salida 2 —los permisos en el token— choca de frente con ADR-0013**, que exige que la matriz se
vuelva a pedir en cada renovación «así un cambio de permisos entra sin que el usuario cierre
sesión». Un permiso dentro del token entra cuando el token caduca, y una revocación urgente —que
es el caso normal de una revocación— no entra hasta entonces.

**Esta salida no toca el camino caliente**, así que la propiedad de `caja` se conserva; y el
mecanismo no hay que inventarlo: `caja` tiene `pago_evento` con `EntregarEventos`, `catastro` tiene
`catastro_evento`, y `rentas` ya consume uno.

## Lo que cuesta, dicho aquí y no descubierto después

1. **Es la más cara de las tres.** Un sistema más que operar: su esquema, su despliegue, su CI, su
   registro, su imagen y su sitio en el nodo — y el nodo **ya no cabe** (#1, D-25).
2. **La copia local es eventualmente consistente.** Hay una ventana en la que un permiso revocado
   sigue valiendo. Cuánto dura es una decisión de operación, y tiene que estar **medida y escrita**,
   no supuesta.
3. **`normativa` no tiene buzón todavía** (cero tablas de evento): hay que dárselo.
4. **Hereda el riesgo del consumidor que nadie despierta.** Un evento que no se entrega deja la
   copia vieja **sin que nada se ponga rojo** — el mismo modo de fallo que #21 encontró en el
   ingestor de `catastro`, que llevaba `suspend: true` desde su primer día. Cualquier etapa que
   añada un consumidor tiene que añadir a la vez la guarda que mide que ese consumidor corre.
5. **Los cuatro catálogos divergentes siguen abiertos.** `rentas` deriva sus **134** opciones de
   `docs/10-negocio/catalogo-de-opciones.md`; `catastro` (17), `caja` (4) y `normativa` (2) las
   escriben a mano. Este ADR decide **dónde vive el dueño de los accesos**, no **quién escribe el
   catálogo de opciones de cada sistema**: eso sigue siendo de cada dueño, y lo que el sistema de
   identidad guarda es a quién se le concede cada una.

## Etapas, y qué cierra cada una

El sistema no nace de una vez. El orden lo fija una regla: **ninguna etapa puede dejar el producto
peor que antes**, y la copia local sigue siendo la fuente de autorización hasta la última.

| # | Etapa | Cierra |
|---|---|---|
| 1 | Este ADR, y el nombre | La decisión de D-19 |
| 2 | El repositorio `identidad`: esquema baseline, las ocho tablas, su descriptor y su sitio en el nodo | Que exista dónde poner lo demás |
| 3 | Las nueve escrituras de administración se mudan de `rentas` a `identidad`, y `rentas` pasa a ser un consumidor más | Que haya **un** sitio donde se administra |
| 4 | El buzón de `identidad` y el consumidor en los cuatro, con su guarda de «el consumidor corre» | **El defecto vivo**: un permiso concedido llega a los cuatro |
| 5 | El sembrador de la copia local se retira de los tres | Que no haya dos orígenes para la misma tabla |

**Hasta la etapa 4, el defecto de #29 §3 sigue vivo**, y eso hay que decirlo: lo único que lo alivia
mientras tanto es lo que ya se hizo —que la ausencia deje de ser silenciosa (#29 §8, entregado en
`catastro`, `normativa` y `caja`)—, que no lo arregla pero impide que se lea como otra cosa.

## Consecuencias

- **`ADR-0030` §3 se matiza y no se reemplaza**: las pantallas de administración dejan de estar en
  `rentas`, pero siguen estando en **un** sitio, que es lo que aquel ADR protegía.
- **El aislamiento por municipalidad no cambia**: los eventos llevan su `municipalidad_id` y se
  aplican con `SET LOCAL` y una transacción por evento, que es lo que ADR-0028 §3 ya exige.
- **D-19 queda contestada** en su parte de «quién es el dueño». Lo que **no** contesta es quién
  compone el catálogo de accesos de la sesión, que sigue abierto.
- **El dimensionado empeora antes de mejorar** y es un argumento más para D-25: un sistema más en un
  nodo que ya no cabe.
