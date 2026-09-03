# ADR-0004 — PostgreSQL, con particionado por ejercicio

**Estado:** Aceptado
**Fecha:** 2026-08-17

## Contexto

El original usa SQL Server 2008. Hay que elegir motor para el sistema nuevo, y la elección no es
libre: la estrategia de aislamiento de [ADR-0002](ADR-0002-estrategia-multi-tenant.md) depende de
que el motor tenga Row Level Security con `FORCE`, políticas por operación y `WITH CHECK`.

El volumen es alto y crece linealmente con el tiempo: un padrón de 100 000 predios genera del
orden de un millón de asientos de cuenta corriente por ejercicio, y el manual promete manejar
volúmenes del orden de terabytes.

## Decisión

**PostgreSQL**, con:

- **Row Level Security** en todas las tablas, forzada.
- **Particionado por lista sobre `ejercicio`** en las tablas de movimiento:
  `cuenta_corriente_asiento` y `determinacion`.
- **`numeric`** para todo importe. Nunca coma flotante.
- **Flyway** para las migraciones, ejecutadas por `sgtm_owner`.

Los tipos del dominio se declaran como `DOMAIN` de PostgreSQL —`dinero`, `alicuota`, `area_m2`,
`ejercicio`— para que la restricción viaje con la columna y no dependa de que alguien la repita.

## Consecuencias

- El aislamiento se apoya en una función del motor, no en una biblioteca. Cambiar de motor
  obligaría a rehacer la estrategia entera.
- **El particionado interactúa con RLS y hay que saberlo:** una partición no hereda la política
  del padre, y el acceso directo a la partición la evade. La mitigación —privilegios solo sobre
  tablas padre— está en [ARQ-03 §3.5](https://github.com/hneyra/sgtm/blob/migracion-a-microservicios/docs/30-arquitectura/estrategia-multitenant.md).
- Una partición nueva por ejercicio es una migración anual. Está previsto automatizarla, pero
  **la migración manual es preferible a un `GRANT` amplio** que la alcance sin querer.
- La escala y el redondeo de `dinero` (`numeric(15,2)`) quedaron decididos el 2026-08-28:
  escala ratificada y `HALF_UP` ([ADR-0018](https://github.com/hneyra/normativa/blob/main/docs/30-arquitectura/adr/ADR-0018-el-redondeo-decidido.md), que cerró
  D-03a/b/c; el del cierre de caja sigue abierto como D-03d).

## Alternativas consideradas

- **SQL Server**, por continuidad con el original. Tiene *security policies* con funciones de
  predicado, pero el modelo es más difícil de verificar en pruebas, la licencia por municipio
  encarece el producto y no hay código que reutilizar del sistema anterior.
- **MySQL / MariaDB.** Sin RLS. Habría obligado a filtrar en la aplicación, que es la alternativa
  descartada en ADR-0002.
- **Sin particionado, con índices.** Funciona hasta que el padrón acumula diez ejercicios y el
  mantenimiento del índice domina el tiempo de la emisión masiva. Se prefiere pagar la
  complejidad desde el principio, cuando la mitigación de RLS es fácil de verificar.
