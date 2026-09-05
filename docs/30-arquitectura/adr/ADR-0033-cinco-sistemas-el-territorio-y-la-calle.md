# ADR-0033 — Cinco sistemas: `catastro` absorbe el territorio y `seguridad` se separa

| Campo | Valor |
|---|---|
| Estado | Propuesto |
| Fecha | 2026-09-05 |
| Decide | Dirección del proyecto |
| Extiende | [ADR-0029](ADR-0029-cuatro-sistemas-separados.md), sin revertirlo |
| Depende de | [ADR-0031](ADR-0031-infraestructura-comun-y-propia.md), [ADR-0034](https://github.com/hneyra/catastro/blob/main/docs/30-arquitectura/adr/ADR-0034-el-marco-y-el-operador-espacial.md) |

## Contexto

El producto crece de «valorizar el predio y cobrarlo» a catastro multipropósito: desarrollo urbano,
gestión del riesgo, licencias de funcionamiento, fiscalización, obras, margesí y seguridad
ciudadana. Ocho módulos que no existen y que hay que alojar en algún sitio.

ADR-0029 no partió el producto por tamaño ni por equipo: lo partió por **quién es dueño del
número** — catastro valoriza el predio, rentas determina la obligación, normativa sella el
parámetro, caja cobra. Ninguno de los ocho módulos nuevos es dueño de un número: son **hechos sobre
el territorio**.

Y la regla 11 —ningún SQL cruza la frontera de sistema— fija el costo de repartirlos. La consulta
que da valor en seis de los ocho es un cruce espacial contra el mismo polígono: «qué predios caen
en zona de riesgo no mitigable», «qué zona le toca a este lote», «dónde el área verificada no
coincide con la de la ficha». Alojarlos aparte no sustituye un `JOIN` por una llamada HTTP:
sustituye un `JOIN` por **replicar la geometría de 30 000 lotes por municipalidad** a cada sistema
que quiera intersectarla, y mantenerla al día. Eso no es una proyección de cifras como la valuación
sellada de ADR-0027; es un segundo catastro.

## Decisión

**Cinco sistemas, no cuatro y no doce.**

1. **`catastro` pasa a ser el sistema del territorio.** Aloja, como contextos acotados propios
   verificados por Spring Modulith sobre la misma base: `urbano`, `grd`, `fiscalizacion`,
   `comercio`, `obras` y `patrimonio`. El criterio, escrito para que se pueda aplicar mañana a un
   módulo que hoy no imaginamos: **si su consulta útil es un cruce espacial contra el predio, vive
   aquí.**

2. **`seguridad` es un sistema nuevo.** Incidencias de serenazgo, luminarias, cámaras y
   patrullaje. No cruza contra el lote: agrega por manzana y por frente de cuadra, escribe mucho
   más de lo que lee y tiene un ciclo operativo propio —turnos, no ejercicios—. Le basta con la
   proyección que `catastro` publica por su buzón: `MANZANA_PUBLICADA` y `FRENTE_PUBLICADO`.

3. **Los arbitrios se quedan en `rentas`.** Son un tributo. Lo que `catastro` aporta es el insumo
   —los metros lineales de frente por predio y su uso—, no el importe. Es exactamente la frontera
   de ADR-0024 aplicada a otra cifra.

4. **La atención al vecino no es un sistema.** Es una lectura compuesta, y su sitio ya tiene
   precedente: `ConsultaPrediosController` en `rentas`, que compone catastro y cuenta corriente.

## Lo que esta decisión NO hace

- **No revierte ADR-0029.** Su criterio queda intacto y es el que se acaba de aplicar. Lo que
  cambia es que `catastro` resulta dueño de dos cosas —el valor del predio y los hechos del
  territorio— y eso hay que decirlo, porque su nombre ya no lo dice entero.
- **No convierte a `catastro` en un monolito otra vez.** ADR-0003 murió porque un despliegue
  contenía cuatro dominios sin frontera verificada. Aquí la frontera existe y es la que ya está
  puesta: `ModulosTest` con `ApplicationModules.verify()` y el paquete raíz como única API pública.
  **Un módulo nuevo que importe `catastro.dominio` pone el build en rojo**, y esa es toda la
  diferencia entre las dos cosas.
- **No abre la puerta a que cualquier módulo entre.** El criterio es el cruce espacial, y se aplica
  contra la pregunta que el módulo tiene que contestar, no contra la comodidad de quien lo escribe.

## Consecuencias

- La base de `catastro` pasa de 28 tablas a unas 60, y su `V1__baseline.sql` deja de leerse de una
  sentada. Se acepta: partirlo en migraciones por módulo (`V7__urbano.sql`, `V8__grd.sql`, …) hace
  el diff legible sin fragmentar el esquema.
- **Un sexto sistema es una decisión, no un efecto.** Registrar `seguridad` obliga a tocar
  `sistemas.ts`, `SISTEMAS_DEL_PRODUCTO`, el `tsconfig.json` del contrato y el compose de
  plataforma — y las tres pruebas que exigen que esas listas coincidan. Ese roce es la
  característica, no el defecto.
- **La mitigación pendiente de ADR-0031 deja de ser opcional.** «El descriptor que nadie compone»
  con cinco sistemas y un `CronJob` de teselas que sí tiene efecto observable produce un mapa viejo
  que nadie relaciona con un despliegue. El trabajo programado que abre el PR entra **antes** que
  el sistema nuevo.

## Alternativas descartadas

- **Un sistema por módulo (ocho más).** Máximo aislamiento y ocho copias de la geometría. La
  consulta «predios en riesgo con licencia vigente y deuda» pasaría a ser una orquestación de tres
  proyecciones que envejecen a ritmos distintos.
- **Dos sistemas nuevos agrupados (`territorio` y `operaciones`).** Punto medio que corta por el
  medio justamente el cruce espacial: `fiscalizacion` quedaría separado de `urbano` y necesita
  intersectar la zonificación para decidir si un uso es no conforme.
- **Todo dentro de `catastro`, seguridad ciudadana incluida.** Es lo más simple y mete en la base
  del padrón una tabla que crece por eventos de patrullaje. Su volumen y su ciclo no se parecen a
  nada de lo demás, y el día que haya que dimensionar el motor, el padrón pagaría por el serenazgo.
