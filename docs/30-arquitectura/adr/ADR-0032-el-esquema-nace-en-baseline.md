# ADR-0032 — El esquema de cada sistema nace en un baseline; la historia se queda en `sgtm`

| Campo | Valor |
|---|---|
| Estado | **Aceptado** |
| Fecha | 2026-09-03 |
| Decide | Dirección del proyecto |
| Depende de | [ADR-0029](ADR-0029-cuatro-sistemas-separados.md) |
| Conserva | [ADR-0004](ADR-0004-almacenamiento-de-datos.md) y el migrador tal como están |
| No toca | D-04 (GOB-02), que es otra cosa y sigue abierta |


> Aceptado el 2026-09-04 por la direccion del proyecto, al contestar **D-22**: el producto lo opera un equipo central, no cada municipalidad. Ver [`D-22`](../../00-gobierno/D-22-quien-opera-cuatro-despliegues.md) en `infrastructure`.

## Contexto

Dos hechos, y el segundo es el que decide.

**No hay datos reales en ningún entorno.** Ni en `prod`, ni en `stg`, ni en el compose local:
todo lo que hay es la instalación de demostración (`V16`) y lo que siembran los guiones de
`carga-de-datos/`, y todo se puede reconstruir desde cero. Es lo que D-04 ya decía por
escrito —«el piloto arranca con padrón nuevo»— dicho ahora para todos los ambientes.

**Las migraciones de `sgtm` no se pueden repartir.** Están entrelazadas desde el principio a
propósito: `V1__nucleo_y_catastro.sql` crea el núcleo y el catastro juntos,
`V2__rentas_y_cuenta_corriente.sql` crea rentas y el libro, `V6__rls.sql` aplica las políticas
de todo el esquema de una vez, `V7__privilegios.sql` reparte los privilegios de todos los
roles. No hay forma de asignar `V1` a un repositorio: pertenece a dos.

De ahí sale la pregunta, y conviene separarla en dos porque tienen respuestas distintas:
¿hace falta **migrar datos**? No. ¿Hace falta **versionar el DDL**? Sí, y por motivos que no
tienen nada que ver con la migración de datos.

## Decisión

### 1. Cada sistema nace con un `V1__baseline.sql`

Generado del esquema actual restringido a las tablas que le pertenecen, con su RLS, sus
privilegios, sus roles, sus disparadores de inmutabilidad y sus índices. **No se copia ni una
migración de `sgtm`.** A partir de ahí, cada cambio es una migración nueva de ese repositorio,
`V2`, `V3`, y así.

La historia `V1..V78` se queda en `sgtm`, que no se borra. Un `git log` sobre esas migraciones
sigue contestando por qué una columna es como es, y varias llevan en su cabecera el hallazgo
que las originó — que es información que no está en ningún otro sitio.

**Los cuatro baselines se generan una sola vez y por adelantado**, junto al inventario del
corte, y no uno dentro de cada extracción. Con las tablas ya repartidas sobre el papel, partir
el DDL es un trabajo mecánico que se hace mejor de una vez y se revisa entero.

### 2. Flyway se conserva, y el motivo **no** es la migración de datos

Que no haya datos que preservar es un argumento para tirar la historia, no para tirar la
herramienta. Tres razones concretas, ninguna hipotética:

1. **El checksum sobre DDL ya aplicado.** El modo de fallo real de un equipo no es «falta una
   migración»: es que alguien edite una que ya corrió en su máquina, y la base de al lado
   quede distinta sin que nada se ponga rojo. Flyway lo detecta; un archivo `esquema.sql`
   aplicado a mano, no.
2. **El Job de implantación espera al de migración consultando `flyway_schema_history`.** Está
   en `V21`, con su motivo escrito: en Kubernetes no hay equivalente de
   `service_completed_successfully`, así que la espera se resuelve preguntándole a la base si
   la migración ya corrió. Y el `GRANT` que lo hace posible se descubrió **reconstruyendo un
   clúster real desde cero, no en revisión**. Quitar Flyway es reescribir esa orquestación y
   volver a pagar ese hallazgo.
3. **Las pruebas de persistencia corren las migraciones reales contra un motor real.** Sin
   versión no se puede decir contra qué esquema pasó `verificarAislamiento`, que es
   precisamente la prueba cuyo valor depende de que se sepa exactamente qué había en la base.

### 3. La ventana que hay abierta, y hasta cuándo

Mientras no haya padrón real, **cualquier base de cualquier ambiente se puede tirar y rehacer**.
Eso no es un detalle: es lo que vuelve barato todo el corte, y hay que gastarlo antes de que se
cierre. Dos consecuencias que se toman ahora:

- **Ninguna extracción necesita plan de migración de datos ni conciliación de saldos.** Se
  crea el esquema nuevo, se siembra la demostración y se compara. Lo que en otro proyecto sería
  la mitad del trabajo, aquí no existe.
- **La comparación de padrones deja de ser una prueba de aceptación y pasa a ser una guarda de
  CI.** Como el padrón se reconstruye desde una semilla —`sembrar-demostracion.sh` más la
  corrida— el «mismo céntimo» se puede comprobar **en cada PR**, no una vez por etapa. Es la
  guarda más valiosa de todo el corte y sólo es posible mientras los datos sean reconstruibles.

La ventana se cierra **el día que la municipalidad piloto cargue su padrón**. Desde ese día,
tirar una base es perder trabajo de ventanilla y toda migración vuelve a ser irreversible. Que
la fecha no esté fijada no significa que no llegue: conviene tener los cuatro baselines y la
guarda de CI antes.

### 4. Lo que esto **no** decide

**D-04 sigue abierta y no la toca.** Es otra cosa: la migración desde la base SQL Server del
sistema actual para una municipalidad que ya opera, con su corte, su conciliación de saldos y
la campaña de observación de los puntos de redondeo del SRTM ([ADR-0018](https://github.com/hneyra/normativa/blob/main/docs/30-arquitectura/adr/ADR-0018-el-redondeo-decidido.md)).
Eso es trabajo de implantación de un municipio concreto y existiría igual sin el corte.

## Consecuencias

- **Se retiran 78 archivos de migración de la copia**, y con ellos el riesgo de arrastrar a
  cuatro repositorios un `V6__rls.sql` que aplica políticas a tablas que ahí no existen.
- **Cada baseline es revisable de una sentada.** Un archivo por sistema, con sus tablas, su RLS
  y sus privilegios, en vez de 78 fragmentos que hay que leer en orden para saber qué quedó.
- **Se pierde la arqueología en los repositorios nuevos.** La cabecera de varias migraciones
  lleva el hallazgo que la originó, y esos comentarios no viajan con el baseline. Mitigación
  concreta, y hay que hacerla: **los cinco hallazgos de RLS de DAT-01 §0 se copian al
  encabezado de cada baseline**, porque los cuatro sistemas van a tropezar con ellos. El resto
  se busca en `sgtm`.
- **El primer `V2` de cada repositorio llega antes de lo que parece.** En cuanto haya una base
  en `stg` que alguien no quiera rehacer, el baseline deja de poder editarse. Conviene decirlo
  en el README de cada repositorio para que nadie lo edite «porque todavía no hay nada».
- **`MigradorTest` y `AislamientoMultiTenantTest` viajan sin cambios de fondo**: siguen
  corriendo las migraciones reales contra un motor real, sólo que ahora son una y no 78.

## Lo descartado, y por qué

- **Un `esquema.sql` idempotente aplicado sin herramienta.** Es la lectura literal de «no hay
  migraciones», y funciona hasta el primer cambio: sin checksum nadie detecta la edición de un
  DDL ya aplicado, y sin tabla de versión el Job de implantación no tiene a qué preguntarle si
  la migración terminó. Se descarta por §2, no por prejuicio: el ahorro es un archivo y el
  costo es reescribir una orquestación que ya funciona y que costó un hallazgo encontrar.
- **Un esquema declarativo con diff automático** (Atlas, sqldef, migra). Es la alternativa
  seria y hay que darle una respuesta seria: encaja bien con «todo se reconstruye». Se descarta
  por dos motivos concretos de este esquema. Uno, el diff generado no sabe de RLS, de
  privilegios por columna ni de disparadores de inmutabilidad, y aquí esas tres cosas **son** el
  esquema: `V54` le retira a `sgtm_app` el `UPDATE` sobre una tabla y le concede el de una sola
  columna, y eso no es algo que se quiera ver aparecer y desaparecer en un diff automático.
  Dos, añade una herramienta más que operar para sustituir una que ya está y que nadie ha
  reportado como problema.
- **Repartir `V1..V78` entre los cuatro repositorios.** Imposible, y la razón está en el
  contexto: `V1` pertenece a dos sistemas, `V6` y `V7` a los cuatro. Cualquier reparto exige
  reescribirlas, y una migración reescrita ya no es la que corrió: es un baseline con otro
  nombre y sin sus ventajas.
- **Un solo baseline compartido por los cuatro.** Volvería a ser un esquema compartido con
  cuatro despliegues encima, que es exactamente lo que ADR-0029 descarta como «lo peor de los
  dos mundos».
