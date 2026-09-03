# Los cinco hallazgos de Row Level Security

> **Trasladado de `sgtm/docs/40-datos/modelo-logico-fisico.md` §0 en la etapa P3 del corte.**
>
> No se resume ni se enlaza: se copia. Los cinco son del **motor**, no del esquema del monolito, y
> los cuatro sistemas van a tropezar con ellos exactamente igual. Un enlace a otro repositorio se
> deja de seguir; una copia se lee cuando duele.
>
> Lo que sostiene el primero —el que invalida la prueba entera si se descuida— es
> `AislamientoMultiTenantTest` de cada uno de los cuatro sistemas, que **lo demuestra en vez de afirmarlo**: con
> el mismo contexto de tenant fijado, el superusuario ve las dos municipalidades y el rol de la
> aplicación ve una.

**Cinco hallazgos sobre Row Level Security**, verificados ejecutando contra PostgreSQL. Los dos
primeros vienen del proyecto SRTM, del que se hereda la estrategia: no se volvieron a descubrir
aquí, se trasladaron con su mitigación y la prueba de aislamiento los vigila. Los otros tres
salieron aquí, midiendo planes de ejecución y migraciones — y el tercero y el quinto son **el mismo
hallazgo con dos operadores distintos**: una condición que no es *leakproof* no llega al índice, y
el índice sigue ahí para que nadie lo note.

### Hallazgo 1 — Un superusuario omite RLS

`FORCE ROW LEVEL SECURITY` protege del **propietario** de la tabla, no del **superusuario**. Un
rol superusuario ve todas las filas de todas las municipalidades aunque las políticas estén
puestas.

**Consecuencias, todas obligatorias:**

- El rol de aplicación se crea `NOSUPERUSER NOBYPASSRLS`.
- La aplicación no se conecta como propietario de las tablas.
- **Una prueba de aislamiento escrita sobre la conexión por omisión de Testcontainers —que es de
  superusuario— pasa en verde sin verificar nada.** Por eso `AislamientoMultiTenantTest` crea el
  rol `sgtm_app` en su arranque y lo usa para todo, y lo demuestra: con el mismo contexto fijado,
  el superusuario ve las dos municipalidades y `sgtm_app` una.

### Hallazgo 2 — Una partición no hereda la política del padre

Una partición **no hereda** `relrowsecurity`, y consultarla directamente evade la política de la
tabla padre.

**Dos mitigaciones, y la segunda es la que cierra el hueco:**

1. RLS explícita en cada partición (`V6__rls.sql`, segundo bloque).
2. **La aplicación no tiene ningún privilegio sobre ninguna partición.** Los `GRANT` se conceden
   solo sobre las tablas padre. Por eso `V7__privilegios.sql` **no** usa
   `GRANT … ON ALL TABLES IN SCHEMA`: una partición nueva no recibe privilegios salvo que alguien
   se los conceda expresamente, y eso se ve en el diff.

### Hallazgo 3 — Bajo RLS, un `LIKE` no llega nunca al índice

Una búsqueda por prefijo escrita como `columna LIKE 'prefijo%'` **se ejecuta como recorrido
secuencial** para el rol de aplicación, exista o no un índice adecuado. Da igual la clase de
operadores del índice: no se usa.

El motivo es que `textlike` **no es *leakproof*** (`pg_proc.proleakproof = false`), y PostgreSQL se
niega a evaluar una condición que no lo sea *antes* de la política de seguridad — podría revelar,
por un mensaje de error, filas de otra municipalidad. Así que el `LIKE` se queda como `Filter`
después del recorrido, y el índice sobra.

Medido contra PostgreSQL 16 con 30 000 filas, misma tabla, mismo índice, mismos datos y el rol
`sgtm_app` sujeto a la política:

| Cómo se escribe el prefijo | Plan | Coste |
|---|---|---|
| `cod LIKE 'prefijo%'` | `Seq Scan` | 925 |
| `cod ~>=~ 'prefijo' AND cod ~<~ 'prefijp'` | `Bitmap Index Scan` | 308 |

**Mitigación.** Toda búsqueda por prefijo se escribe como un **rango** con los operadores de
`text_pattern_ops` —`~>=~` y `~<~`, los dos *leakproof*—, sobre un índice declarado con esa clase
de operadores. Expresa exactamente el mismo prefijo y sí llega al índice.

No es una peculiaridad de una consulta: le pasa a **toda** búsqueda por prefijo del sistema, y
como el plan no cambia el resultado, nada se pone rojo cuando alguien lo devuelve a `LIKE`. Por eso
hay dos pruebas gemelas en `ConsultaDeFichasTest$Volumen`: una exige que el rango use índice, y la
otra fija que el `LIKE` no lo usa y explica por qué.

El mismo razonamiento vale para cualquier operador no *leakproof* sobre una tabla con RLS. La
búsqueda por aproximación de nombres (`V11`) no está afectada: `similarity` va sobre un índice GIN
que se evalúa como filtro de todos modos.

---


### Hallazgo 4 — Una clave foránea nueva sobre una tabla con RLS no se puede validar

`ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY` lanza, para validar, **una consulta** sobre la tabla.
Esa consulta queda sujeta a la política, la política lee `app.municipalidad_id`, y el migrador corre
como `sgtm_owner` **sin contexto de tenant** —correctamente: migrar no es atender la petición de
ninguna municipalidad—. El resultado es que la migración entera se cae con

```
ERROR: unrecognized configuration parameter "app.municipalidad_id"
```

No sale en la revisión: el `ALTER TABLE` se lee impecable. Sale al ejecutarlo, y apareció al añadir
`valor_referencial_vehiculo.conjunto_id` en `V17`.

Las tablas de `V1` a `V5` no lo sufren porque sus claves foráneas nacieron **antes** que las
políticas de `V6`. Le pasa a toda clave foránea que se agregue de aquí en adelante sobre una tabla
de tenant.

**Mitigación.** `NOT VALID`, y no es un atajo: es la única forma. Salta el escaneo de las filas
existentes y **no debilita nada hacia adelante** — la restricción se comprueba en cada `INSERT` y
en cada `UPDATE` desde ese momento. Lo único que queda sin verificar son las filas anteriores, y en
una tabla vacía no hay ninguna. `VALIDATE CONSTRAINT` después chocaría con lo mismo.

**Un `CHECK` no es una clave foránea, y se midió antes de suponerlo (#542).** Sobre una tabla con
`FORCE ROW LEVEL SECURITY`, en la **misma sesión sin contexto de tenant** en la que
`SELECT count(*)` muere con `unrecognized configuration parameter "app.municipalidad_id"`, un
`ALTER TABLE … ADD CONSTRAINT … CHECK (…)` **validado pasa**: su escaneo de validación no atraviesa
la política, y lo único que puede pararlo es una fila que de verdad viole la condición
(`is violated by some row`). Así que **`NOT VALID` en un `CHECK` es una decisión sobre los datos
que ya hay, no sobre RLS** — se pone cuando no se puede medir qué contienen las instalaciones
desplegadas, o cuando se sabe que alguna fila no encaja y no se va a reescribir (regla 4).

**Y el migrador tampoco puede reescribir esas filas**, por si acaso: un `UPDATE` sobre una tabla de
tenant desde una migración muere con el mismo `unrecognized configuration parameter`. «Normalizar el
vocabulario viejo en la migración» no es una salida disponible, ni siquiera cuando parece la cómoda.

**Y de ahí sale una consecuencia que `V74` (#553) tuvo que resolver, y conviene tenerla escrita.**
Si las filas viejas no se pueden reescribir, lo único que la regla 4 deja para corregir un asiento
equivocado es **reversarlo**: asentar su opuesto con `asiento_reversado_id` apuntando al original.
Y una reversión **copia** el valor del original, porque si no, no netea. Un `CHECK` sin excepción
cerraría ese camino **justo sobre las filas que más falta hace poder corregir**, y la obligación
quedaría partida en dos para siempre. Por eso `asiento_tributo_ck` se escribe como «el vocabulario,
**o** eres la reversión de otra fila», y no debilita nada: `asiento_reversado_id` sólo lo pone
`Asiento.reversionDe`, que exige un asiento ya guardado, mientras que un asiento nuevo —el único que
puede introducir una grafía nueva— lo lleva en nulo.

Del mismo hallazgo sale la otra mitad: **el `CHECK` se pone donde está la verdad, no donde está la
copia**. `saldo_proyectado` es caché reconstruible del libro, así que con el libro acotado lo está
transitivamente; acotar además la caché no añadiría protección y sí haría fallar el `UPSERT` que
`RegistrarAsiento.reproyectar` ejecuta en cada escritura, convirtiendo un defecto **detectable** en
un estado de cuenta que revienta.

**Un `CREATE UNIQUE INDEX` tampoco es una clave foránea, y también se midió (#588).** En la misma
sesión —rol dueño, `FORCE ROW LEVEL SECURITY`, sin contexto de tenant— donde `SELECT count(*)` y
`UPDATE` mueren con `unrecognized configuration parameter`, un `CREATE UNIQUE INDEX … WHERE …`
**funciona**: construir un índice lee el montón directamente y no pasa por la política. Conviene
tenerlo escrito porque el hecho anterior haría esperar lo contrario, y porque de ahí salen dos
consecuencias que sí duelen:

- **La migración no puede diagnosticar.** Como no puede consultar, no hay forma de contar los
  duplicados antes de crear el índice, ni de nombrarlos, ni de repararlos después.
- **Y el fallo no dice cuáles son.** Si alguna fila viola el índice, el error es
  `could not create unique index …` con `DETAIL: Duplicate keys exist.` **sin los valores de la
  clave**: como el dueño está sujeto a la política, PostgreSQL los oculta. El mismo fallo ejecutado
  como superusuario sí los imprime.

Un índice único **no tiene `NOT VALID`**, así que la única forma de que la migración no pueda
pararse es que su predicado excluya por construcción a las filas anteriores — es lo que `V75` hace
con `WHERE acto = 'ALTA_DEUDA'`, columna que `V68` estrenó y que en toda fila previa es nula.

### Hallazgo 5 — Bajo RLS, el operador espacial tampoco llega al índice

Es el hallazgo 3 otra vez, con otro operador, y por eso conviene leerlos como una **familia** y no
como dos casos sueltos: `predio.geometria && ST_MakeEnvelope(…)::geography` **no puede ser condición
de ningún índice** para el rol de aplicación, exista o no el índice GiST que `V61` creó.

El motivo es el mismo: `geography_overlaps` **no es *leakproof*** — y tampoco lo son
`st_intersects(geography,geography)`, `st_intersects(geometry,geometry)` ni `box_overlap` —, así
que PostgreSQL no lo evalúa antes de la política.

**Y aquí el síntoma engaña más que en el `LIKE`, porque el plan dice «Index».** Medido contra
PostgreSQL 16 con PostGIS 3.5, 60 000 lotes repartidos en dos municipalidades, como `sgtm_app`:

```
Bitmap Heap Scan on predio  (cost=329.74..3399.28 rows=404)
  Filter: (geometria && '…'::geography)
  ->  Bitmap Index Scan on predio_sector_ix  (cost=0.00..329.64 rows=30046)
        Index Cond: (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
```

Usa un índice **por la condición de la política y por nada más**: lee los 30 046 predios del
inquilino para devolver unos cuatrocientos. Es literalmente la frase de #313 —«un plan que use el
índice sólo por `municipalidad_id` vuelve a leer la tabla entera y sigue diciendo *Index*»— con otro
operador, y por eso lo que hay que exigir nunca es la palabra «Index»: es que la condición **del
filtro** salga en el `Index Cond`.

`ADR-0021` había creado ese índice GiST con su motivo escrito —«sin él, "qué predios caen en esta
manzana" recorre la tabla entera»— y esa frase, medida, resulta falsa para el único rol que hace esa
pregunta. El índice sí se usa **como superusuario**, que es quien omite RLS; o sea, se usa
exactamente cuando lo prueba quien provisiona la base y nunca cuando lo usa la aplicación.

**Mitigación.** La misma forma que el hallazgo 3: decir la condición con operadores que **sí** lo
sean. `predio` gana en `V65` cuatro columnas **generadas** con el rectángulo envolvente del lote
—`marco_oeste`, `marco_sur`, `marco_este`, `marco_norte`— en `double precision`, y el marco se
escribe con `<=` y `>=` sobre ellas. Con el índice
`(municipalidad_id, marco_oeste, marco_sur, marco_este, marco_norte)`, las cuatro comparaciones **y
la condición de la política** salen juntas en el `Index Cond`:

```
Bitmap Heap Scan on predio  (cost=940.01..5097.41 rows=2905)
  ->  Bitmap Index Scan on predio_marco_ix  (cost=0.00..939.28 rows=2905)
        Index Cond: ((municipalidad_id = current_setting('app.municipalidad_id')::bigint)
                     AND (marco_oeste <= …) AND (marco_sur <= …)
                     AND (marco_este >= …) AND (marco_norte >= …))
```

**`double precision` y no `numeric`, y no es una preferencia**: `numeric_le` tampoco es *leakproof*.
Con `numeric` las cuatro columnas no llegarían al índice y no servirían para nada — que es
exactamente el modo de fallo que este hallazgo describe, reproducido por segunda vez en la misma
tabla.

**Lo que la mitigación no arregla, medido también.** PostgreSQL estima las cuatro desigualdades
**como si fueran independientes**, y no lo son: son un rectángulo. Con una sola municipalidad dueña
de toda la tabla —donde la condición de la política selecciona el 100 %— le salen 2 815 filas donde
hay unas 440, y con esa cifra prefiere el recorrido secuencial aunque el índice sea alcanzable. El
índice sigue estando ahí y la diferencia real es de unas 1 300 páginas a unas 40; a escala municipal
son milisegundos, y en cuanto hay más de una municipalidad —que es la premisa de este sistema— el
índice gana solo. Lo que sí se descartó, porque se midió: **añadir el `&&` como filtro para que
PostGIS aporte su estimador** mejora la cifra (de 2 905 a 39) y no cambia el plan, y esa estimación
tampoco es la correcta —el marco medido contiene unas 440 filas—, así que queda en una segunda copia
del mismo predicado y se retiró.

La otra salida —`ALTER FUNCTION geography_overlaps(geography,geography) LEAKPROOF`— se descartó: es
un acto de superusuario que no cabe en una migración (`sgtm_owner` a propósito no lo es), y sobre
todo es **afirmar** que ningún error de una función en C de un tercero puede revelar la fila de otra
municipalidad. `float8le` es *leakproof* en el catálogo de PostgreSQL, que es una afirmación que ya
está verificada.

## 1. Las migraciones
