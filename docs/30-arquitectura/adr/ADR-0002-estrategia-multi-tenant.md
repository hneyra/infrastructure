# ADR-0002 — Esquema compartido con Row Level Security

**Estado:** Aceptado
**Fecha:** 2026-08-17

## Contexto

El SGTM original es monoinstalación: una municipalidad, un servidor, una base de datos. Este
proyecto lo convierte en producto **multi-municipal**, y el aislamiento entre municipalidades
pasa a ser el riesgo número uno: la deuda, los pagos y los datos personales de los contribuyentes
de un municipio no pueden aparecer jamás en otro.

Tres opciones: una base por municipalidad, un esquema por municipalidad, o esquema compartido con
la fila etiquetada.

## Decisión

**Esquema compartido, `municipalidad_id NOT NULL` en toda tabla de negocio, y aislamiento
aplicado por el motor con Row Level Security.**

El contexto se fija una sola vez por transacción con `SET LOCAL app.municipalidad_id`, a partir
del claim del token validado. Las políticas usan `current_setting` **sin** valor por omisión: sin
contexto, la consulta falla.

Detalle completo, con las dos trampas verificadas —el superusuario omite RLS; una partición no
hereda la política del padre— en [ARQ-03](https://github.com/hneyra/sgtm/blob/migracion-a-microservicios/docs/30-arquitectura/estrategia-multitenant.md).

## Consecuencias

- **El filtro no se puede olvidar.** Se aplica a todas las consultas de la conexión, incluidas
  las escritas a mano y las de informes.
- Ningún método de dominio recibe `municipalidadId`: sale del token. Lo verifica ArchUnit.
- El rol de aplicación **no puede ser superusuario ni propietario** de las tablas, y no recibe
  privilegios sobre las particiones.
- Todo índice selectivo debe empezar por `municipalidad_id`.
- Se paga una consulta de ida y vuelta por devolución de conexión al pool, para verificar que no
  vuelve contaminada. Se acepta: la alternativa es confiar en que nadie escriba `SET SESSION` en
  los próximos años.
- Una migración afecta a todas las municipalidades a la vez. No hay despliegue por municipio.

## Alternativas consideradas

- **Una base por municipalidad.** El aislamiento más fuerte, y el que más se parece al original.
  Descartado por operación: N bases que migrar, respaldar, vigilar y actualizar, con N creciendo
  con cada municipio incorporado. Un fallo de despliegue en la número 40 pasa desapercibido.
- **Un esquema por municipalidad.** Punto intermedio, pero conserva el problema de la migración
  multiplicada y añade el de las conexiones: el pool tendría que enrutar por esquema, con el
  mismo riesgo de contaminación entre peticiones y sin la red de seguridad de RLS.
- **Filtrado en la aplicación, sin RLS.** Es lo que se hace en la mayoría de sistemas y es lo que
  falla. Basta un `findAll` para abrir la fuga, y la revisión de código no la detecta con
  fiabilidad. Descartado.
