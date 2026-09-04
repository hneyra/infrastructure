# ADR-0029 — Cuatro sistemas separados: `catastro`, `rentas`, `normativa` y `caja`

| Campo | Valor |
|---|---|
| Estado | **Aceptado** |
| Fecha | 2026-09-03 |
| Decide | Dirección del proyecto |
| Reemplaza | [ADR-0003](https://github.com/hneyra/rentas/blob/main/docs/30-arquitectura/adr/ADR-0003-monolito-modular.md) — monolito modular con Spring Modulith |
| Abre | D-17 … D-24 (GOB-02) |


> Aceptado el 2026-09-04 por la direccion del proyecto, al contestar **D-22**: el producto lo opera un equipo central, no cada municipalidad. Ver [`D-22`](../../00-gobierno/D-22-quien-opera-cuatro-despliegues.md) en `infrastructure`.

## Contexto

ADR-0003 descartó los microservicios el 2026-08-17 con un argumentó que sigue siendo bueno: «el
equipo que mantendra esto en una municipalidad no opera doce despliegues». Doce era una fantasia.

Lo que cambio no es la opinion sobre los microservicios, son **cuatro hechos que aquel día no
existian**:

1. **Cuatro dueños funcionales, no doce.** Catastro y Rentas son dos gerencias distintas, con dos
   presupuestos, dos ritmos y dos proveedores posibles. Cuatro despliegues no es un diagrama, es un
   organigrama.
2. **Catastro adquirio un stack propio.** Desde `V61` y [ADR-0021](https://github.com/hneyra/catastro/blob/main/docs/30-arquitectura/adr/ADR-0021-la-geometria-del-predio.md)
   hay geometría; con [ADR-0022](https://github.com/hneyra/catastro/blob/main/docs/30-arquitectura/adr/ADR-0022-el-visor-del-plano-catastral.md), un visor de plano.
   PostGIS, GPKG, teselas y un ciclo de barrido de campo no comparten nada con la emisión masiva ni
   con la ventanilla.
3. **La caja tiene que cobrar lo que no es tributo.** Mercados, cementerio, estacionamiento. Ese
   requisito no cabe en el contexto `tesoreria` tal como [ARQ-01 §3.8](https://github.com/hneyra/sgtm/blob/migracion-a-microservicios/docs/30-arquitectura/contextos-acotados.md) lo
   define —«caja tributaria y de tasas»— y meterlo ahi acopla el mercado al padrón de contribuyentes.
4. **Los valores normativos ya son nacionales.** [ADR-0017](https://github.com/hneyra/normativa/blob/main/docs/30-arquitectura/adr/ADR-0017-tablas-de-valuacion-nacionales.md)
   los sacó de la municipalidad. Un cuadro cargado una vez para todo el pais, dentro del despliegue
   de cada municipalidad, es un servicio compartido que todavía no se llama servicio.

Y hay un hecho técnico que hace la separación barata y que **es merito de ADR-0003**: los limites
están verificados por el build. `verificarArquitectura` rechaza que un contexto importe el `dominio`
o la `infraestructura` de otro; cada cruce ya pasa por un puerto del paquete raiz con su javadoc.
No hay que descubrir las costuras. Hay que cortarlas.

## Decisión

**Cuatro sistemas, cuatro repositorios, cuatro despliegues, cuatro bases de datos.**

| Repositorio | Sistema | Qué le pertenece |
|---|---|---|
| `catastro` | Catastro Fiscal | Predio, ficha versionada, construcciones, titularidad, geometría, catálogo vial. **Calcula el valor del predio** ([ADR-0024](https://github.com/hneyra/rentas/blob/main/docs/30-arquitectura/adr/ADR-0024-la-frontera-del-calculo.md)) |
| `rentas` | Rentas | Contribuyentes, declaraciones juradas, determinación, cuenta corriente, valores, fiscalización, coactiva, sanciones, licencias. **Calcula cuánto se debe** |
| `normativa` | Valores normativos | Ediciones, conjuntos sellados, catálogo de reglas ([ADR-0025](https://github.com/hneyra/normativa/blob/main/docs/30-arquitectura/adr/ADR-0025-normativa-servicio-y-libreria.md)) |
| `caja` | Caja | Órdenes de cobro, recibo, turno, arqueo, cierre, medios de pago ([ADR-0026](https://github.com/hneyra/rentas/blob/main/docs/30-arquitectura/adr/ADR-0026-el-camino-del-dinero.md)) |

**El repositorio `sgtm` se renombra a `rentas`.** No se crea uno nuevo: se le quitan piezas. Conserva
su historial, sus migraciones y su numeración de issues, que es lo que hace que la migración sea una
serie de extracciones y no una reescritura.

**`SGTM` deja de nombrar un repositorio y pasa a nombrar el producto** que forman los cuatro. Es lo
que el manual siempre nombró, y sigue siendo lo que la municipalidad compra.

**El repositorio de valores normativos no se llama `valores`.** En este dominio *valores* ya
significa orden de pago, resolución de determinación y resolución de multa —[ARQ-01 §3.9](https://github.com/hneyra/sgtm/blob/migracion-a-microservicios/docs/30-arquitectura/contextos-acotados.md)—
y el módulo `sgtm-valores` existe. Se llama `normativa`.

### El orden de extracción, y por qué ese

`normativa` → `catastro` → `caja`. Es el orden del riesgo creciente:

- **`normativa` primero**: es de sólo lectura, es inmutable una vez sellada, no tiene transacciones
  con nadie y ya es nacional. Su criterio de salida —que Rentas calcule con Normativa apagada—
  demuestra que la separación no anadio dependencia de disponibilidad.
- **`catastro` después**: es la más cara, porque tres claves foraneas dejan de existir
  (`declaracion_jurada.predio_id`, `determinacion.predio_id`, `cuenta_corriente_asiento.predio_id`)
  y hay que sustituirlas por una invariante verificada. Su criterio de salida es una comparación de
  archivos: el mismo padrón, céntimo a céntimo, que la corrida equivalente en el monolito.
- **`caja` al final**: es la única que toca el camino del dinero, y la única que pierde una
  transacción local.

Ningúna fase se declara terminada por opinion. Cada una tiene un criterio que se mide.

## Consecuencias

- **Se paga la transacción local en el camino del dinero.** Un cobro deja de ser un `COMMIT` y pasa a
  ser dos con una cola en medio. ADR-0026 dice qué se compra con eso y que obligación operativa
  aparece a cambio.
- **Se paga una clave foranea por una invariante.** El motor deja de garantizar que un
  `predio_id` exista; lo garantiza una proyección y una verificación diaria. Es peor, y es el precio.
- **Se paga la consulta cruzada en SQL.** `DeteccionRepositoryJdbc` lee hoy cuatro tablas ajenas en
  una sola consulta que página y cuenta lo filtrado. Con dos bases eso desaparece y se sustituye por
  una proyección local en `rentas`. Componerlo en memoria ya se probo y fallo: la conciliación
  contestaba «722 páginas, 14 422 elementos» y cero filas en todas (#631).
- **Se paga operación.** Cuatro *pipelines*, cuatro bases que respaldar y vigilar, cuatro versiones
  que pueden desalinearse, y una traza que ya no cabe en un log —de ahi el `correlacionId` de
  ADR-0028—.
- **Se gana que dos gerencias avancen sin bloquearse**, que catastro tenga su stack geoespacial sin
  arrastrar a la ventanilla, que la normativa se cargue una vez para todo el pais y que la caja sea
  reutilizable por el resto del municipio.
- **Las reglas que no se negocian siguen siendo las mismas en los cuatro**: importes en
  `BigDecimal`, ningún método recibe `municipalidadId`, `SET LOCAL` y jamás `SET SESSION`, sin
  `DELETE` sobre tabla protegida, reglas puras, observación obligatoria. Y siguen verificándose en el
  build, ahora desde `comun-verificaciones` ([ADR-0030](ADR-0030-cuatro-interfaces-una-sesion.md)).

## Lo descartado, y por qué

- **Seguir con el monolito modular.** Da el 80 % de la separación sin ninguno de estos costos, y si
  los cuatro hechos del contexto no fueran ciertos sería la respuesta correcta. Se descarta porque
  son ciertos, no porque el monolito modular sea malo. **Si la dirección no comparte esos cuatro
  hechos, la decisión correcta es no partir nada.**
- **Una base compartida entre los cuatro.** Lo peor de los dos mundos, y ADR-0003 ya lo nombró:
  cuatro despliegues con el acoplamiento de uno, y una migración de esquema que rompe un sistema que
  nadie tocó.
- **Doce servicios, uno por contexto acotado.** La objeción de ADR-0003 sigue viva. Cuatro son los
  que tienen dueño; los demás son módulos dentro de su sistema.
- **Sacar `contribuyentes` como quinto sistema.** Tentador —lo referencian los cuatro— pero hoy es la
  base del grafo y no depende de nadie; sacarlo multiplica por cuatro las llamadas de cada pantalla
  sin resolver ningún problema existente. Se revisa cuando `caja` tenga que cobrarle a quien no es
  contribuyente (D-17).
