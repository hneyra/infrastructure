# ADR-0008 — Auditoría con observación obligatoria, como en el sistema original

**Estado:** Aceptado
**Fecha:** 2026-08-17

## Contexto

El manual (cap. 1, §Auditoría) describe algo poco común y muy valioso:

> «Aquí se registra cualquier acción que genere una modificación o eliminación sobre los datos
> […]; ante una modificación se guarda el registro original en las tablas históricas antes de
> ejecutar la modificación […]. En cada registro de modificación se registra en forma interna el
> ID del usuario, el Nombre de la Máquina (PC) y el IP de la PC desde la cual ocurre la
> modificación, la Fecha y Hora y **una observación que debe escribir el usuario, de lo contrario
> no le permite guardar la modificación**.»

Es una decisión de diseño deliberada del sistema original, y la que hace que la pista de
auditoría sirva para algo: el «qué cambió» lo puede reconstruir cualquier sistema; el **porqué**
solo lo sabe quien lo cambió, en el momento de cambiarlo.

## Decisión

**Se conserva íntegra, y se refuerza.**

1. Toda modificación de datos de negocio escribe un registro de auditoría con: usuario, **origen
   de la petición** (equivalente al nombre de máquina e IP del manual), fecha y hora,
   tabla y clave afectadas, operación, y **observación obligatoria**.
2. Sin observación, la operación **no se completa**. Es restricción de la base, no validación de
   la interfaz.
3. El registro original se conserva antes de modificar: fichas catastrales versionadas y tablas
   históricas.
4. La auditoría **no se borra ni se modifica**: la aplicación tiene sobre ella `SELECT` e
   `INSERT`, nada más.
5. **La configuración de permisos también se audita.** El manual no lo dice; sin ello, quien
   administra la seguridad puede alterar su propia pista.

## Consecuencias

- Cada caso de uso de escritura lleva un argumento más: la observación. Aparece en la API y en la
  interfaz, y no se puede omitir «por ahora».
- La auditoría crece; se particiona igual que el libro de asientos, y su retención es la decisión
  **D-08**.
- El volumen y la fricción son reales, y se aceptan: es exactamente la fricción que hace que el
  campo tenga contenido útil cuando alguien lo lee dos años después.
- La auditoría es **datos de tenant**: lleva `municipalidad_id` y RLS como cualquier otra tabla.

## Alternativas consideradas

- **Auditoría automática por disparadores, sin observación.** Registra el qué y pierde el porqué.
  Es lo que se hace por omisión y lo que convierte la auditoría en un archivo que nadie consulta.
- **Observación opcional.** Equivale a no tenerla: se deja en blanco.
- **Bitácora de eventos de dominio en lugar de auditoría de tablas.** Mejor a largo plazo, pero
  exige que exista el dominio. Cuando lo haya, este ADR se revisará; hasta entonces, lo que el
  manual promete se cumple con auditoría de tablas.
