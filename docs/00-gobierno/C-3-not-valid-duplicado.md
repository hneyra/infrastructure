# C-3 — `NOT VALID NOT VALID`: el sufijo que el generador duplicaba

> **Estado: cerrado, con cinco huecos declarados en §7.** El defecto es de **forma**, medido
> ejecutando y no supuesto: PostgreSQL 16.15 lo acepta, el baseline con el defecto **aplica
> entero** y el esquema resultante es idéntico —**diff de `pg_dump` vacío y el mismo sha256**—.
> Lo que se perdía es que el archivo fuera estable en ida y vuelta.
>
> Censo real: **`rentas` 36 · `caja` 0 en DDL (1 en prosa) · `catastro` 0 · `normativa` 0**.
> Corregidas las 36, corregida **la emisión** —no sólo la salida— y puesta una guarda que mide
> **las seis copias del esquema**.
>
> Cifras: **infrastructure 374 → 379** (+5 pruebas). **rentas 3 102**, sin bajar.

---

## 0. Lo que la medición corrigió del encargo

Tres cosas cambiaron al comprobarlas contra el árbol:

1. **`caja` ya no lo tiene, y su «1» es prosa.** `grep -c` da 1 en su baseline, pero la línea 132
   es el comentario con que P5D dejó constancia del arreglo. Su DDL está limpio desde P5D. Esto
   no es una curiosidad: obliga a que la guarda de §3 **salte los comentarios**, porque una que
   mirase el archivo entero pondría en rojo justamente al repositorio que ya está arreglado.

2. **Son 36, no 37.** P5D escribió «37 veces en el baseline de `rentas`» en el encabezado del
   baseline de `caja` y en su §8. Medido: **36**, de la línea 2233 a la 2816. No se corrige ese
   comentario, y el motivo está en §7 (hueco 4).

3. **No son sólo foráneas.** El encargo y §8 de P5D lo describen sobre `recibo_turno_fk`, una
   clave foránea. En `rentas` hay **CHECK** también —`asiento_baja_con_causal_ck`,
   `asiento_tributo_ck`, `transferencia_tipo_ck`…—, que es la pista de cuál era la causa: no es
   un caso borde de las foráneas, es **el 100 % de las restricciones no validadas**.

Y una cuarta que no cambia el trabajo pero sí lo que se puede prometer: **el `rentas` de hoy no
declara ningún ambiente** —no hay `infra/Pulumi.*.yaml`, sólo `infra/carga-de-datos`—, así que
editar su `V1__baseline.sql` es legítimo hoy. En cuanto haya una base que alguien no quiera
rehacer, deja de serlo (§7, hueco 5).

---

## 1. ¿Lo acepta PostgreSQL? Sí, y así se midió

La pregunta decide si esto es cosmético o si el baseline no aplica. **Se ejecutó**, contra el
PostgreSQL 16.15 de `127.0.0.1:55444`, sin suponer nada:

```sql
CREATE TABLE u (id bigint PRIMARY KEY, t_id bigint, v int);
ALTER TABLE u ADD CONSTRAINT u_v_ck  CHECK (v > 0)                    NOT VALID NOT VALID;
ALTER TABLE u ADD CONSTRAINT u_t_fk  FOREIGN KEY (t_id) REFERENCES t(id) NOT VALID NOT VALID;
ALTER TABLE u ADD CONSTRAINT u_v3_ck CHECK (v < 1000)       NOT VALID NOT VALID NOT VALID;
```

Las tres pasan. Y el catálogo queda **igual que con un solo sufijo**:

```
 conname | convalidated |                      def
---------+--------------+-----------------------------------------------
 u_t_fk  | f            | FOREIGN KEY (t_id) REFERENCES t(id) NOT VALID
 u_v3_ck | f            | CHECK ((v < 1000)) NOT VALID
 u_v_ck  | f            | CHECK ((v > 0)) NOT VALID
```

El atributo **se acumula** —comprobado hasta **triplicado**— y `pg_get_constraintdef` devuelve
uno solo. Y no se midió sólo en el laboratorio: **el baseline de `rentas` con las 36 dentro
aplica entero**, 132 tablas, código de salida 0.

**Conclusión: el defecto es de forma.** Lo que se pierde es que el archivo sea estable en ida y
vuelta —regenerarlo produce otro texto para el mismo esquema—, y con checksum de Flyway eso
importa: es el modo de fallo que la cabecera de los cuatro baselines describe, «que alguien edite
una que ya corrió y la base de al lado quede distinta sin que nada se ponga rojo».

Que sea de forma es exactamente lo que lo hace **invisible para todo lo demás que ya mira este
esquema**: `Guardas.java` y `Retrato.java` consultan el catálogo, que normaliza, y las pruebas de
persistencia aplican las migraciones y pasan igual. Un defecto que sólo se ve en el archivo sólo
se puede cazar leyendo el archivo, y de ahí la forma de la guarda de §3.

---

## 2. El censo, en los cuatro baselines y en el monolito

Medido con `grep`, excluyendo `build/` —el primer intento cazó un `normativa` que era un artefacto
de compilación—:

| Baseline | `NOT VALID NOT VALID` | De ellas, DDL | Por qué |
|---|---|---|---|
| **`rentas`** | **36** | **36** | Las 36 corregidas aquí. Eran **todas** sus restricciones no validadas |
| `caja` | 1 | **0** | La línea 132 es el comentario de P5D. Su DDL está limpio |
| `catastro` | 0 | 0 | **No tiene ninguna restricción no validada**: sus 5 menciones son prosa y una línea `[CRUZA LA FRONTERA]` |
| `normativa` | 0 | 0 | Ídem: sus 4 menciones son prosa |
| `sgtm` (`V1..V78`) | 0 | 0 | Las migraciones a mano nunca lo tuvieron: el defecto es del **generador** |

`catastro` y `normativa` no se libraron por suerte ni por revisión: **no tenían nada que
duplicar**. Es una distinción que importa, porque «0 porque está bien» y «0 porque no aplica» se
leen igual y la guarda de §3 tiene que seguir mirándolos.

Que en `rentas` fueran **36 de 36** es lo que identificó la causa. Sus otras 3 apariciones de
`NOT VALID` son las tres líneas de comentario del encabezado.

---

## 3. El arreglo, en los tres sitios donde tenía que estar

### 3.1 Las 36 sentencias (`rentas`)

Sustitución acotada a las sentencias reales —`^ALTER TABLE ` que terminan en el sufijo repetido—,
para no tocar la prosa. Y se comprobó que **sólo** cambió eso: normalizando los dos archivos con
`s/(?: NOT VALID)+;$/ NOT VALID;/`, el diff entre el de antes y el de después es de **0 líneas**.
El archivo conserva sus 4 156 líneas y sus 40 `NOT VALID` legítimos.

### 3.2 La emisión (`Emitir.java`) — que es lo que importa

Corregir el archivo a secas deja que **el próximo baseline las traiga de vuelta**: es exactamente
lo que le pasó a `caja`, arreglada en su salida y no en su origen. La causa está en
`emitirRestricciones`:

```java
o.append("ALTER TABLE ").append(tb).append(" ADD CONSTRAINT ").append(f[0])
 .append(' ').append(f[1])                                 // pg_get_constraintdef(...)
 .append("true".equals(f[2]) ? "" : " NOT VALID")           // ...que YA lo traía
```

`pg_get_constraintdef` **ya emite** el sufijo, así que el `append` era redundante **siempre**. Se
retira, y en su lugar queda una comprobación que **no se limita a confiar** en que el motor siga
comportándose así:

```java
boolean noValidada = !"true".equals(f[2]);
if (noValidada != f[1].endsWith(" NOT VALID")) {
    throw new IllegalStateException("El motor no emite el sufijo NOT VALID como se esperaba …");
}
```

La asimetría es deliberada: si el motor dejara de emitirlo, esto falla **nombrando la
restricción**, en vez de emitir un baseline que crea validada una restricción que no lo está —eso
sí sería un defecto de fondo, porque validar es una consulta y el migrador corre sin contexto de
tenant (DAT-01 §0, hallazgo 4)—.

Y una guarda sobre la **salida**, que es la que se pone roja si alguien vuelve a añadir el sufijo:
`sinSufijoRepetido(o)` corre antes de `Files.writeString` y **se niega a escribir el archivo**.

**Se corrigió en la copia de `rentas`**, no en la de `sgtm`, que es el archivo histórico y no se
toca. Las dos eran byte a byte idénticas (`diff -q`).

### 3.3 La guarda permanente (`infrastructure`)

`infra/verificaciones/sufijo-not-valid-repetido.ts`, con su muestra en
`muestras/sufijo-not-valid/`. Vive aquí y no en cada repositorio por lo mismo que C-2: **el
defecto es de familia** —lo emitió un generador común a los cuatro— y la comprobación es una;
escribirla cuatro veces sería tener cuatro sitios donde olvidarse. Mide **las seis copias del
esquema** reutilizando `esquemas()`, así que su lista no puede quedarse rancia.

Salta los comentarios con `sinComentarios`, y eso **no es un detalle**: §7 hueco 4 y la rotura B
de §5 lo miden.

---

## 4. El diff de esquema — vacío

El criterio de P0B: tras el arreglo el esquema resultante tiene que ser idéntico. Se comprueba
aplicando el baseline **de antes** y el **de después** a dos bases limpias del mismo motor y
comparando el volcado del catálogo. Es el método que P5E ya usó («12 164 líneas idénticas»).

```
$ pg_dump --schema-only -d c3_antes  > dump_antes.sql     # baseline con las 36
$ pg_dump --schema-only -d c3_final  > dump_final.sql     # baseline corregido + nota
$ diff <(clean dump_antes.sql) <(clean dump_final.sql)
[vacío]

a02cfb7d048dc7cf669cbad55cab2a42c8aa964a9cc2e8a18a0d0a7bce7271a6  antes
a02cfb7d048dc7cf669cbad55cab2a42c8aa964a9cc2e8a18a0d0a7bce7271a6  después
```

**0 líneas de diferencia y el mismo sha256**, 132 tablas a cada lado. `clean` quita únicamente
las dos líneas `\restrict`/`\unrestrict`, que llevan un **nonce aleatorio por volcado** y no son
contenido del esquema; sin quitarlas el diff son esas 8 líneas y ninguna más.

Y una segunda medida, más dirigida, sobre la dimensión exacta que el cambio podía haber roto —las
876 restricciones de las dos bases con su `convalidated` y su definición—:

```
restricciones comparadas: 876
diff del catálogo de restricciones: 0 líneas
NOT VALID (convalidated=f) antes / después: 40 / 40
```

Las **mismas 40**. Ninguna restricción pasó a validada, que era el único desenlace que habría
convertido esto en un defecto de fondo.

---

## 5. Que las guardas pueden fallar, demostrado

Una regla que no puede fallar no protege nada. Las tres roturas se aplicaron y se revirtieron.

| Rotura | Resultado |
|---|---|
| **A.** Devolver el `append(" NOT VALID")` a `Emitir.java` y **regenerar de verdad** contra la base con el esquema de `rentas` | **36 sentencias en rojo** —las mismas 36—, y `Emitir` **no llega a escribir el archivo**. Es el defecto original reproducido de punta a punta |
| **B.** Que la guarda de `infrastructure` **no** quite los comentarios | 3 pruebas en rojo, y la primera dice **`«caja»: V1__baseline.sql:132`** — el repositorio **ya arreglado**, en rojo por documentar su propio arreglo. El arreglo cómodo sería borrar la explicación: es el hueco que #426 destapó en `leerPatron` y que #558 volvió a encontrar |
| **C.** Devolver el sufijo duplicado a **una** sentencia de `rentas` | 1 en rojo, nombrando repositorio, migración y línea: `«rentas»: V1__baseline.sql:2233 repite el sufijo « NOT VALID» — ALTER TABLE cuenta_corriente_asiento ADD CONSTRAINT asiento_baja_con_causal_ck …` |

**La rotura A es la que mide el issue entero**, y hubo que ganársela: exige levantar la base con
el esquema de `rentas` y correr el generador contra ella. Corriéndolo ya corregido, emite las
mismas **36** restricciones no validadas que el baseline, **0** con el sufijo repetido, y **las
36 con los mismos nombres**.

La muestra que viola la guarda trae los dos casos reales —un `CHECK`, que es el mayoritario de
`rentas`, y una foránea, que es donde P5D lo encontró en `caja`— **y una tercera sentencia en
regla**, con un solo sufijo, que no sale. Sin ese contraste, una guarda que gritara ante cualquier
`NOT VALID` pasaría la muestra entera y no mediría nada: las 40 no validadas de `rentas` son
legítimas y tienen que seguir estándolo.

---

## 6. Las cifras

| Repositorio | Antes | Después | |
|---|---|---|---|
| `infrastructure` | 374 | **379** | +5, la guarda de §3.3 |
| `rentas` | 3 102 | **3 102** | sin cambio |
| `catastro` · `normativa` · `caja` | 958 · 602 · 669 | iguales | **no se tocaron** |

Los tres verificadores bloqueantes, en verde en los dos repositorios tocados. La corrida de
`rentas` va con **`cleanTest` y `--no-build-cache`** a propósito: la primera dio *BUILD SUCCESSFUL*
con **178 tareas de 200 UP-TO-DATE**, y una tarea que no se ejecuta no demuestra nada.

---

## 7. Huecos declarados

1. **`sgtm` sigue con el defecto, y no se toca.** Su `docs/40-datos/baselines/rentas/V1__baseline.sql`
   tiene las 36 y el de `caja` la suya; su `Emitir.java` sigue duplicando. Es el archivo histórico
   y la instrucción es explícita. **No es inerte**: es la copia del generador que tiene a su lado
   la base de referencia con `V1..V78`, así que es la que alguien usaría para regenerar. Quien lo
   haga obtendrá otra vez el defecto — y lo cazará la guarda de §3.3, que es para lo que está.

2. **Dónde tendría que vivir el generador: en `infrastructure`.** Es una herramienta **común a los
   cuatro sistemas** y hoy existe en dos copias byte a byte idénticas y en repositorios que no
   pueden corregirse el uno al otro; eso es el mismo defecto de familia que C-2 cerró para las
   extensiones, un escalón más arriba. `infrastructure` es donde ADR-0031 pone las barreras que
   verifican a los cuatro sistemas, y es el único repositorio desde el que un arreglo del emisor
   llega a los cuatro a la vez. **No se movió aquí**: mover una herramienta entre repositorios es
   una decisión de etapa, y hacerlo a la brava crearía una **tercera** copia, que es exactamente
   el problema.

3. **El arnés de `rentas` es vestigial.** `verificar-baselines.sh` resuelve `RAIZ` a la raíz del
   repositorio y busca `backend/sgtm-esquema/…`, que **no existe en `rentas`** (allí es
   `kamayuk-rentas-esquema`). Vino con el corte y no se ha ejecutado nunca desde allí. El
   `Emitir.java` corregido **sí es ejecutable** —se corrió a mano, con el driver JDBC y las tres
   variables `SGTM_BASELINE_*`, y es como se midió la rotura A—, pero su guion no lo conduce. No
   se arregló: exigiría decidir contra qué esquema de referencia corre `rentas`, que es la
   pregunta del hueco 2.

4. **El comentario de `caja` dice «37 veces» y son 36.** No se corrige, y el motivo no es pereza:
   `V1__baseline.sql` es una migración de Flyway y **cambiar un comentario cambia su checksum**;
   pagar ese precio por una errata de prosa, en un repositorio que este trabajo no necesita tocar,
   es peor que dejar la cifra corregida aquí. Queda dicha en §0.

5. **El checksum de Flyway de `rentas/V1__baseline.sql` cambió**, y no puede no cambiar: el arreglo
   es del texto. Es legítimo **hoy** porque `rentas` no declara todavía ningún ambiente —no hay
   `infra/Pulumi.*.yaml`—, así que no hay ninguna base provisionada que rehacer, y el propio
   encabezado del archivo pone ahí la frontera. Cualquier base que ya lo hubiera aplicado
   necesitaría un `flyway repair` o rehacerse. **En cuanto haya una base en `stg`, esto deja de
   poder corregirse así y pasa a ser una migración nueva.**

6. **C-3 quita una fuente de inestabilidad en ida y vuelta, no todas.** Regenerando el baseline
   contra el esquema que él mismo produce, quedan **418 líneas** de diferencia en las
   restricciones, y **ninguna es de este defecto**: son la no idempotencia conocida de
   `pg_get_constraintdef` para `= ANY (ARRAY[…])` y `<> ALL (ARRAY[…])`, ya documentada en DAT-02
   §3 y neutralizada por `canonizar.py`. Las 36 `NOT VALID` salen ahora idénticas en nombre y en
   número; el resto es un problema anterior y distinto.
