# El ensayo cruzado no existe, y se declara en vez de fingirse

| Campo | Valor |
|---|---|
| Estado | **Hueco DECLARADO**, no cubierto. `prod` no tiene ensayo de restauración |
| Decisión tomada | Retirar `restoreSourceBucket` (salida **B** de [#121](https://github.com/hneyra/infrastructure/issues/121)) |
| Lo que queda abierto | RNF-079 para `prod` — [#133](https://github.com/hneyra/infrastructure/issues/133) |
| Documento que queda sin cubrir | [`INF-03`](https://github.com/hneyra/sgtm/blob/migracion-a-microservicios/docs/80-infraestructura/ambientes.md) §2, en su parte de ensayo cruzado |
| Fecha | 2026-09-12 |

`INF-03` vive en el repositorio archivo y **no se modifica**, así que la corrección de su §2 no
puede escribirse allí. Se escribe aquí.

---

## 1. Qué había

`kamayuk:restoreSourceBucket` en `Pulumi.stg.yaml`, con el valor `kamayuk-prod-backups`. Leído
por `config.ts`, validado por dos invariantes —que sólo esté en `stg`, y que no sea su propio
contenedor— y atado desde [#112](https://github.com/hneyra/infrastructure/issues/112) al
`backupBucket` real de `prod` por una guarda cruzada.

**Y no lo consumía nadie.** `git grep` daba 9 archivos y 14 líneas, y ninguna era un consumidor:
declaración, lectura, las dos validaciones, pruebas y documentación. No aparecía en `index.ts`,
ni en `componentes/`, ni en `variablesWalg()`, ni en `Respaldo.ts`, ni en ningún flujo de CI.

Quien de verdad ensaya la restauración es `infra/respaldo/contra-cluster.sh`, y toma el prefijo
del `Deployment` de `stg` **en marcha** (`:74-82`), no de esa clave. O sea que **`stg` se
restaura a sí mismo** — literalmente el defecto que la segunda validación describía:

> «`restoreSourceBucket` y `backupBucket` son el mismo contenedor. Entonces stg no ensaya
> restaurar los respaldos de prod: **se restaura a sí mismo, y el simulacro de INF-03 §2 no
> demuestra nada**.»

La validación pasaba —los dos valores del stack eran distintos— mientras el comportamiento real
era exactamente el que esa validación llama defecto. Una invariante comprobada sobre un dato que
nadie usa **hace decir de más a la comprobación**: es la dirección de #27 aplicada a una clave de
stack en vez de a una excepción.

## 2. Por qué no se cableó

No es conectar una clave. Son tres impedimentos, los tres medidos el 2026-09-12.

### 2.1 La clave de cifrado no cruza

`contra-cluster.sh:163` inyecta `WALG_LIBSODIUM_KEY` desde el `Secret`
`kamayuk-stg-postgres-respaldo` — **el de `stg`**. Esa clave la genera `bootstrap-secretos.sh`
**dentro de cada clúster**, y Pulumi no emite ni un `Secret`
([#126](https://github.com/hneyra/infrastructure/issues/126) lo midió). Así que la de `stg` y la
de `prod` son distintas por construcción: **leer el contenedor de `prod` no basta**, haría falta
la clave simétrica de `prod` dentro del espacio de nombres de `stg`.

Y eso choca de frente con `INF-03` §4: «**credenciales distintas por ambiente, sin reutilización
de ninguna**» y «las credenciales de `prod` **solo existen en CI**».

### 2.2 El ensayo restaura sobre el volumen real de `stg`

El pod temporal monta `persistentVolumeClaim: kamayuk-stg-postgres-datos` (`:168-170`) —el
volumen del motor de `stg`—, escribe `recovery_target_time` con un `clock_timestamp()` de la
línea de tiempo de `stg`, y comprueba que la fila `ENSAYO-PITR-B$$` **que él mismo acaba de
escribir** sobrevive al PITR.

Apuntado al catálogo de `prod`, ese ensayo **no puede pasar jamás**: esa fila no existe allí. Y
lo que aterrizaría en el volumen de `stg` serían los datos reales de las municipalidades.

### 2.3 `INF-03` §2 pide algo que no existe

Su punto 2 dice, literal: «Restaurar un respaldo real **—anonimizado—** hasta un punto en el
tiempo». **No hay anonimización en ninguna parte**, ni en este repositorio ni en los cinco.

Y el propio `INF-08` §6 ya listaba esto en su tabla de **sin verificar**: «Que `stg` restaure
desde los respaldos de `prod` con credencial de solo lectura | `INF-03` §2 y §4. Los dos VPS».

### 2.4 Y una cuarta, práctica

La credencial de respaldo es **una sola por ambiente**, de escritura, y la reutiliza
`publicar-cuadros.sh:357` para leer `sgtm-fuentes-normativas`. Emitir una credencial acotada
rompería eso — y tarde.

## 3. Qué sigue cubierto

- **El procedimiento de restauración está ejercitado de punta a punta.** `stg` ensaya PITR
  contra su propio catálogo, en el clúster de verdad, con el binario y los privilegios de
  verdad: **RTO medido 110 s** ([#129](https://github.com/hneyra/infrastructure/issues/129)).
  Lo que eso demuestra es que **el procedimiento funciona**.
- **Los dos ambientes no comparten contenedor.** Es la última fila de `INF-03` §4, y la sigue
  exigiendo `stacks.test.ts` — «los dos ambientes respaldan en contenedores distintos», ahora
  con su motivo escrito dentro. Un `pulumi up` de `stg` mal configurado no puede escribir sobre
  los respaldos de `prod`.
- **Un respaldo de `prod` que no aterriza ya no dice «EXITOSO».** #112 cambió el criterio del
  `CronJob`: censa el catálogo antes y después y compara el `SystemIdentifier`.

## 4. Qué queda SIN CUBRIR

**RNF-079 para `prod`**: «un respaldo que no se ha restaurado no cuenta como respaldo».

Nadie ha demostrado nunca que un respaldo de `prod` se descifre y levante un motor. Lo que hay
medido de `prod` es que **existe** un respaldo base de su clúster vivo y que su WAL encadena; eso
es el catálogo, no la restauración. Y #112 dejó claro por qué la distinción importa: durante una
semana los siete respaldos de `prod` estuvieron muertos mientras la tabla decía `EXITOSO`.

**El RTO de RNF-077 para `prod` tampoco está cronometrado.** Los 110 s son de `stg`, con su
volumetría.

## 5. Qué lo cerraría

**Restaurar el catálogo de `prod` en un pod y un volumen desechables, dentro del propio espacio
de nombres de `prod`.**

Eso demuestra lo único que importa —que los respaldos de `prod` se descifran y levantan un
motor— **sin mover una credencial ni un dato entre ambientes**, que es lo que `INF-03` §4
prohíbe. La aserción no puede ser una fila de ensayo: es que el motor alcance estado consistente
y que su `SystemIdentifier` sea el del clúster vivo de `prod` — el mismo dato con que #112
descubrió los siete respaldos ajenos.

No es un parámetro del ensayo de hoy: es un modo nuevo, porque el de hoy es destructivo sobre el
volumen en marcha y `simulacro-de-restauracion.sh:98-102` se niega contra `prod` a propósito.

Va en [#133](https://github.com/hneyra/infrastructure/issues/133). Toca de cerca a [#126](https://github.com/hneyra/infrastructure/issues/126)
—la custodia de `clave-cifrado`, que es el hueco de continuidad de verdad— y al paso 9 de
[reconstruir el VPS desde cero](../B0-operacion/runbooks/reconstruir-el-vps-desde-cero.md).

## 6. Por qué esto se escribe y no se deja como estaba

Porque **una declaración validada que ningún código lee es peor que no tener nada**: da la
apariencia de una propiedad protegida, y esa apariencia es exactamente lo que impide que alguien
la eche en falta. La guarda de #112 se dejó con su límite escrito dentro —decía que ataba dos
declaraciones y que no probaba que alguien las usara— precisamente para no esconder esto.

Lo que no puede quedarse es la ficción. Puesto en palabras: hoy **`stg` no ensaya nada de
`prod`**, y así está escrito.
