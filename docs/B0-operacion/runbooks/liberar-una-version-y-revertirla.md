# Runbook — Liberar una versión, y revertirla

| Campo | Valor |
|---|---|
| Cuándo | Cuando hay que mover qué versión de un sistema corre, o volver a la anterior porque la nueva trae un defecto |
| Qué cubre | **Los cinco sistemas**, con una tabla. El mecanismo es uno; lo que cambia por sistema son cuatro nombres — ver «Por qué un solo runbook» |
| Alcance | **Subir o bajar `kamayuk:versionDe<Sistema>` en `infra/Pulumi.<amb>.yaml`**: liberar y revertir son el mismo acto, un commit y su `pulumi up` ([#172](https://github.com/hneyra/infrastructure/issues/172)). `kubectl set image` / `rollout undo` sólo como medida de emergencia: el siguiente `pulumi up` lo deshace |
| Estado del ensayo | **Liberar subiendo la línea: ejecutado en los dos ambientes** el 2026-09-13 —`caja@9c8e026` en `stg` por el puente, `rentas@7085323` en `prod` por [#177](https://github.com/hneyra/infrastructure/pull/177)—. **NO ensayados**: revertir en `prod` y la medida de emergencia. Ver «Estado del ensayo» |

> **Hasta el 2026-09-14 este runbook enseñaba lo contrario, y era falso.** Decía que la versión
> que corre la mueve `kubectl set image` —«mover la etiqueta»—, que revertir es `kubectl rollout
> undo`, y que subir `kamayuk:versionDe<Sistema>` «crea los dos `Job`» y nada más, porque el campo
> `image` llevaba `ignoreChanges` (ADR-0011 §5). Medido el 2026-09-13 ([#172](https://github.com/hneyra/infrastructure/issues/172)):
> subir la línea **cambia el binario que corre**, y el `ignoreChanges` no llegaba a ningún
> `Deployment`. La consecuencia era la peor posible para un runbook de reversión: **un `rollout
> undo` hecho siguiendo este documento lo deshacía el siguiente `pulumi up`**, en silencio. Se
> decidió que la versión vive en el stack (opción A de #172, enmienda de
> [ADR-0011 §5](../../30-arquitectura/adr/ADR-0011-infraestructura-como-codigo.md#enmienda-del-2026-09-14--la-versión-vive-en-el-stack)),
> y el documento se reescribió alrededor de la línea. Lo que la versión anterior ya había medido
> —que el `up` del 2026-09-11 movió la imagen de `identidad`— era la pista, y está en «Estado del
> ensayo».

> **Este documento vivía en el repositorio archivo `sgtm` y estaba pre-renombrado** — hablaba
> de `sgtm-<amb>`, de un `Deployment` llamado `sgtm-<amb>-aplicacion`, de la imagen
> `ghcr.io/hneyra/sgtm-aplicacion` y de una línea `sgtm:applicationBootstrapVersion` que
> **ya no existe**. Ninguno de esos cinco nombres resuelve hoy contra el clúster, y el
> primero falla del modo más engañoso: `kubectl -n sgtm-prod` contesta
> `namespaces "sgtm-prod" not found` sin mencionar el renombrado. Se trajo y se remidió
> entero ([#100](https://github.com/hneyra/infrastructure/issues/100),
> [#106](https://github.com/hneyra/infrastructure/issues/106)).

## Síntoma

No es una falla: es la operación de rutina de mover qué versión de un sistema corre.

## Por qué un solo runbook aquí, y no cinco

**Decisión: uno, en `infrastructure`, con una tabla de los cinco.** El motivo no es el ahorro:

1. **La línea que gobierna la liberación vive en este repositorio y en ningún otro.** Son
   cinco —`kamayuk:versionDeRentas`, `…Catastro`, `…Normativa`, `…Caja`, `…Identidad`— y
   las cinco están en los **mismos dos archivos**,
   [`infra/Pulumi.prod.yaml`](../../../infra/Pulumi.prod.yaml) y
   [`infra/Pulumi.stg.yaml`](../../../infra/Pulumi.stg.yaml). Desde #172 esa línea **es** la
   liberación, no un acto al lado de ella. Un runbook en `rentas` le diría a su lector que edite
   un archivo de otro repositorio, al que puede no tener acceso.
2. **La asimetría que hace peligroso este procedimiento sólo se ve desde aquí.** El manifiesto
   sale de `main` del clon hermano ([`descriptor/sistemas.ts`](../../../infra/descriptor/sistemas.ts)
   + [`clonar-los-hermanos`](../../../.github/actions/clonar-los-hermanos/action.yml)) y la
   imagen del `sha` clavado. Los dos archivos que lo causan son de este repositorio; desde
   `rentas` no se ven, y la copia de allí tendría que describir un mecanismo que su lector no
   puede leer.
3. **Las cinco guardas que cierran el paso a una liberación mal hecha corren aquí**, en
   `yarn verificar`: [`deriva-de-migraciones`](../../../infra/verificaciones/deriva-de-migraciones.test.ts),
   [`imagenes-publicadas`](../../../infra/verificaciones/imagenes-publicadas.test.ts),
   [`la-version-clavada-afilia-a-los-consumidores`](../../../infra/verificaciones/la-version-clavada-afilia-a-los-consumidores.test.ts),
   [`comprobar-imagenes.sh`](../../../infra/verificaciones/imagenes/comprobar-imagenes.sh) y
   [`verificar-el-ambiente.sh`](../../../infra/verificaciones/ambiente/verificar-el-ambiente.sh).
   Y como la liberación es un PR, **las cuatro primeras corren sobre ella**.
4. **Y cinco copias se desincronizan.** Este proyecto ya lo pagó: `C-9a` arregló en **una**
   copia un patrón que estaba escrito quince veces, y el resultado fueron nueve trabajos
   rojos y cinco rotos en silencio. El defecto no era el patrón: era que había quince.

**Qué pierde esta salida, y es real:** quien va a liberar `rentas` abre `rentas` primero, y
allí no encontrará nada. Se paga un salto. La mitigación barata —una línea de puntero en el
`README` de cada uno de los cinco— **no se hace en este trabajo** y queda dicha: no es
escribir el runbook cinco veces, es escribir su dirección.

La alternativa (b) —cinco runbooks, uno por repositorio— tendría a favor exactamente ese
salto, y en contra los cuatro puntos de arriba. Se descarta.

## Los cinco sistemas, medidos

Medido contra `prod` (`vmd206041`) el **2026-09-12**. Los `sha` son los que el stack declaraba
**y** los que el clúster corría ese día: coincidían los cinco. **Es una foto, no la línea de
hoy** —`rentas` pasó a `7085323` con #177 el 2026-09-13—: lo vigente se lee en
`Pulumi.<amb>.yaml` y en el clúster (paso 1).

| Sistema | Namespace | `Deployment` | Contenedor | Imagen | `sha` clavado el 2026-09-12 |
|---|---|---|---|---|---|
| `rentas` | `kamayuk-rentas-prod` | `kamayuk-rentas-web` | `rentas` | `ghcr.io/hneyra/kamayuk-rentas` | `66ebe547a3ee…` |
| `rentas` (interfaz) | `kamayuk-rentas-prod` | `kamayuk-rentas-interfaz` | `interfaz` | `ghcr.io/hneyra/kamayuk-rentas-interfaz` | el mismo |
| `catastro` | `kamayuk-catastro-prod` | `kamayuk-catastro-web` | `catastro` | `ghcr.io/hneyra/kamayuk-catastro` | `ac1239a26fd5…` |
| `normativa` | `kamayuk-normativa-prod` | `kamayuk-normativa-web` | `normativa` | `ghcr.io/hneyra/kamayuk-normativa` | `e1cdad5a3e4f…` |
| `caja` | `kamayuk-caja-prod` | `kamayuk-caja-web` | `caja` | `ghcr.io/hneyra/kamayuk-caja` | `0772e2515a68…` |
| `caja` (interfaz) | `kamayuk-caja-prod` | `kamayuk-caja-interfaz` | `interfaz` | `ghcr.io/hneyra/kamayuk-caja-interfaz` | el mismo |
| `identidad` | `kamayuk-identidad-prod` | `kamayuk-identidad-web` | `identidad` | `ghcr.io/hneyra/kamayuk-identidad` | `226ec6ffdc62…` |

**Una línea mueve TODO lo del sistema, no sólo el `Deployment` del backend.** La interfaz, los
`CronJob` y los dos `Job` salen del mismo `sha`: en #177, subir `versionDeRentas` cambió
exactamente **ocho** objetos —`kamayuk-rentas-web`, `kamayuk-rentas-interfaz`, los dos `CronJob`,
y los dos `Job` de la versión nueva creados y los de la vieja borrados—.

**La tabla es lo que el clúster corría; los manifiestos ya declaran dos interfaces más.**
Hasta `normativa`#41 y `catastro`#104 sólo dos de los cinco desplegaban interfaz —y la de
`catastro` se publicaba con un nombre que era una trampa, `ghcr.io/hneyra/kamayuk-catastro-web`,
que se lee igual que el `Deployment` del **backend**—. Los dos PR lo cambian: `catastro` la
renombra a `ghcr.io/hneyra/kamayuk-catastro-interfaz` y la despliega, y `normativa` estrena la
suya. Así que desde que se mezclen, `yarn manifiestos` compone **cuatro** `Deployment` de
interfaz y el único de los cinco sin pantalla es `identidad`, que sirve el buzón.

> **Antes de liberar cualquiera de esos dos, comprobar la imagen.** Un `sha` anterior a esos PR
> no tiene `ghcr.io/hneyra/kamayuk-catastro-interfaz:<sha>` ni
> `ghcr.io/hneyra/kamayuk-normativa-interfaz:<sha>` en el registro: la etiqueta nueva nace en el
> primer `push` a `main` que ejecute su `publicar-imagenes.yml`. Desplegar antes deja el pod en
> `ImagePullBackOff` (D-23). Lo dice la Precondición 2 con `yarn imagenes --ambiente prod`, que
> corre **antes** del `up`.

> **La etiqueta de la interfaz ya no lleva el prefijo del ambiente.** El documento del archivo
> decía `sgtm-interfaz:<amb>-<sha>`, y medido contra `prod` es
> `ghcr.io/hneyra/kamayuk-rentas-interfaz:<sha>`, sin `<amb>-`. La nota al final de
> [ADR-0011 §5](../../30-arquitectura/adr/ADR-0011-infraestructura-como-codigo.md) que anuncia
> ese resto pendiente **ya se cumplió**, y ese ADR no se corrige desde aquí: es una decisión,
> no un manual.

## Precondiciones

1. **La imagen ya está publicada con ese `sha`.** La publica el flujo
   `publicar-imagenes.yml` **de cada repositorio** —no hay ninguno en `infrastructure`— en
   cada `push` a `main`, con `github.sha` de etiqueta:

   ```bash
   gh run list -R hneyra/<sistema> --workflow publicar-imagenes.yml --limit 5 \
     --json headSha,conclusion,createdAt
   ```

   Nunca una etiqueta móvil ni el `sha` de una corrida `cancelled`: `config.ts` rechaza lo
   primero y lo segundo puede no existir en el registro. Ejecutado el 2026-09-12, el último
   `main` con imágenes en verde de cada sistema era `rentas` `10357c5db3bb…`, `catastro`
   `57e5ca519629…`, `normativa` `0b633c295976…`, `caja` `8c1c31c017c9…` e `identidad`
   `c0c7db6c64e5…` — **los cinco por delante del `sha` que `prod` clavaba**.

2. **Que esa etiqueta se pueda pedir al registro**, que es otra afirmación y es la que decide
   si el pod arranca:

   ```bash
   cd infra && GHCR_USUARIO=<usuario> GHCR_CLAVE=<token> yarn imagenes --ambiente prod
   ```

   **Sin credencial esto no pasa en verde: sale con código 3.** Medido el 2026-09-12 sin
   token: «`NO SE PUEDE COMPROBAR: falta la credencial del registro`». Una verificación que se
   salta a sí misma deja el despliegue en verde sin haber verificado nada. En `stg` el puente
   pregunta lo mismo al registro antes de clavar la línea, y un `404` no se clava.

3. **`stg` ya corrió esa versión**, si es para `prod`. Es lo que `Pulumi.prod.yaml` declara —
   «`prod` no estrena una versión que `stg` no haya corrido»— y lo que #177 hizo: subió a `prod`
   el `sha` que `stg` verificó, no la cabeza de `rentas`.

4. **Y ninguna corrida vieja de `aplicar-prod` esperando aprobación.** Aplica el
   `Pulumi.prod.yaml` **de su commit**: aprobada después de la tuya, **devuelve la versión
   vieja**. #177 canceló antes de integrar la pendiente de `680dd66` por eso.

Para leer el clúster (pasos 1 y 3b) hace falta acceso `kubectl` al ambiente, por el mismo túnel
SSH al API que usa CI. Para escribir, no: la escritura es el `up` de CI. La regla de
[ADR-0011 §6](../../30-arquitectura/adr/ADR-0011-infraestructura-como-codigo.md) no cambia: **`pulumi up` contra `prod` desde una máquina de desarrollo está prohibido** — sus
credenciales sólo existen en CI.

## Un solo acto: la línea del stack

| | Liberar | Revertir |
|---|---|---|
| Qué se cambia | `kamayuk:versionDe<Sistema>` al `sha` nuevo | `kamayuk:versionDe<Sistema>` al `sha` anterior |
| `stg` | automático: el puente (`declarar-version.yml`) lo integra cuando el hermano publica, y pide `infra.yml` | un commit que devuelva la línea |
| `prod` | un PR y la aprobación de `aplicar-prod` | un PR y la aprobación de `aplicar-prod` |
| Qué hace el `pulumi up` | cambia la imagen de los `Deployment` y los `CronJob` del sistema, crea los dos `Job` de esa versión y borra los de la anterior | lo mismo, con el `sha` anterior |
| Es deriva | no | no |

**Hasta #172 aquí había dos columnas**: «mover la etiqueta» con `kubectl set image` —que cambiaba
el binario en segundos y era deriva: el siguiente `pulumi up` lo deshace— y «subir la línea», que
se creía que sólo creaba los `Job`.
Confundirlas costó un despliegue entero ([#98](https://github.com/hneyra/infrastructure/issues/98)),
y medirlas dejó ver que eran la misma cosa: la línea también cambia el binario.

## Pasos

### 1. Leer qué corre hoy, antes de mover nada

Lo declarado, del stack:

```bash
grep '^  kamayuk:versionDe' infra/Pulumi.<amb>.yaml
```

Y lo que corre, del clúster:

```bash
kubectl -n kamayuk-<sistema>-<amb> get deployment kamayuk-<sistema>-web \
  -o jsonpath='{.spec.template.spec.containers[0].image}'; echo
```

**Tienen que coincidir.** Si no coinciden, alguien usó la medida de emergencia y no clavó la
línea, o hay un `pulumi up` a medias: en los dos casos el siguiente `up` pondrá lo declarado. Se
resuelve eso antes de liberar nada. **Anotar el `sha` que corre**: es a donde se vuelve si hay que
revertir.

### 2. Liberar: subir la línea

**En `stg` no hay que hacer nada**: cuando un hermano integra en `main` y su
`publicar-imagenes.yml` termina, avisa a este repositorio; `declarar-version.yml` comprueba que
la imagen exista en el registro, integra un commit `stg despliega <sistema>@<sha12>` que cambia
**sólo** esa línea de `Pulumi.stg.yaml`, y lanza `infra.yml`. Para clavar a mano otra versión en
`stg`, el mismo commit escrito por una persona.

**En `prod`, un PR con una línea**:

```bash
git switch -c prod-despliega-<sistema>-<sha7> origin/main
sed -i 's/^  kamayuk:versionDe<Sistema>: .*/  kamayuk:versionDe<Sistema>: <sha de 40>/' infra/Pulumi.prod.yaml
git diff --stat            # 1 archivo, 1 inserción, 1 borrado
git commit -am "prod despliega <sistema>@<sha7>"
git push -u origin HEAD && gh pr create --fill
```

1. **Leer el `pulumi preview de prod` del PR**: tiene que tocar **sólo** objetos de ese sistema
   —sus `Deployment` con `~spec`, sus `CronJob`, dos `Job` creados y dos borrados—. Si aparece
   cualquier otra cosa, `prod` está detrás de `main` en algo más, y **no se integra**.
2. **Integrar.** [`infra.yml`](../../../.github/workflows/infra.yml) corre solo; `aplicar-stg`
   es automático y `aplicar-prod` espera una aprobación humana del *environment* `prod`
   (Actions → la corrida → *Review deployments*). **Aprobar la corrida que nace del merge**, y
   ninguna anterior (Precondición 4). Antes del `up`, el mismo trabajo corre
   [`crear-extensiones.sh`](../../../despliegue/crear-extensiones.sh) **con `--todos`** contra el
   motor que ya existe: `crear-roles.sql` sólo corre con el volumen vacío, y una extensión añadida
   después no llega sola.
3. `pulumi up` crea los `Job` de migración e implantación de esa versión, cambia la imagen de los
   `Deployment` y los `CronJob`, y no termina hasta que los `Job` completan y los `Deployment`
   quedan listos.

> **Dentro del `up`, el `Job` y el `Deployment` NO van en orden.** Medido en la corrida de #177:
> `kamayuk-rentas-web` se dio por actualizado a las 20:45:03Z (17 s) y el `Job` de implantación de
> esa versión a las 20:45:06Z (19 s): empezaron a la vez, a las 20:44:47Z. Sin migraciones en el
> rango no importó. **Con migraciones, la aplicación nueva puede arrancar antes que su esquema**;
> hasta que eso tenga remedio, una versión con migraciones que la aplicación vieja no tolere se
> libera en una ventana anunciada.

El nombre del `Job` lleva la versión —[`sufijoDeVersion()`](../../../infra/componentes/convenciones.ts),
llamado desde [`descriptor/entorno.ts`](../../../infra/descriptor/entorno.ts), los doce
primeros caracteres del `sha`—, así que **una versión nueva crea un `Job` nuevo** y volver a
aplicar la misma no hace nada: el migrador es idempotente. Se ve sin desplegar nada:

```bash
cd infra
yarn --silent manifiestos --ambiente prod --componente identidad-sistema | grep '"name"'
# Job/kamayuk-identidad-migracion-<primeros 12 del sha declarado>
```

> **Para el sistema `identidad` el componente se llama `identidad-sistema`, y equivocarse aquí
> muestra Keycloak.** Medido: `yarn manifiestos --ambiente prod --componente identidad`
> emite `Deployment/kamayuk-prod-identidad` y `Job/kamayuk-prod-realm-e2a489ad39`, que son la
> **plataforma**; los del sistema salen con `--componente identidad-sistema`. Es la colisión de
> nombre de [ADR-0039](../../30-arquitectura/adr/ADR-0039-la-identidad-es-un-sistema.md).
>
> Las etiquetas que hay son `namespace, prioridades, postgres, respaldo, identidad, ingreso,
> observabilidad, red, rentas, rentas-interfaz, catastro, normativa, caja, caja-interfaz,
> identidad-sistema`. Un `--componente` que no sea una de ellas **falla nombrándolas todas**,
> que es lo correcto; el peligro es el que sí existe y es otro.

Si el `Job` de migración falla, el `up` falla con él: **no se sube otra línea encima**. El
runbook `la-migracion-fallo-a-mitad.md` sigue en el repositorio archivo `sgtm` y **no se ha
traído ni remedido** (#100).

### 3. Comprobar que el `up` hizo lo que se dijo

**3a · El resumen del trabajo**: qué objetos cambió, y que sean sólo los del sistema.

```bash
gh run list -R hneyra/infrastructure --workflow infra.yml --limit 3 \
  --json databaseId,headSha,displayTitle,conclusion
gh run view <corrida> -R hneyra/infrastructure --json jobs \
  --jq '.jobs[] | select(.name | startswith("pulumi up")) | "\(.databaseId) \(.name) \(.conclusion)"'
gh api repos/hneyra/infrastructure/actions/jobs/<trabajo>/logs | sed -E 's/^[^ ]+ //' \
  | grep -E '^ *[-+~] +kubernetes:.* (created|updated|deleted|replaced) \(|^Resources:|^ +[-+~] [0-9]+ '
```

Lo que sacó el 2026-09-13 en `prod` (#177, trabajo `103777592888`):

```
 ~  kubernetes:batch/v1:CronJob …kamayuk-rentas-prod/kamayuk-rentas-ingestor updated (0.63s) [diff: ~spec];
 ~  kubernetes:batch/v1:CronJob …kamayuk-rentas-prod/kamayuk-rentas-consumidor-de-identidad updated (0.75s) [diff: ~spec];
 ~  kubernetes:apps/v1:Deployment …kamayuk-rentas-prod/kamayuk-rentas-interfaz updated (1s) [diff: ~spec];
 +  kubernetes:batch/v1:Job …kamayuk-rentas-prod/kamayuk-rentas-migracion-70853239c61d created (7s)
 ~  kubernetes:apps/v1:Deployment …kamayuk-rentas-prod/kamayuk-rentas-web updated (17s) [diff: ~spec];
 +  kubernetes:batch/v1:Job …kamayuk-rentas-prod/kamayuk-rentas-implantacion-70853239c61d created (19s)
 -  kubernetes:batch/v1:Job …kamayuk-rentas-prod/kamayuk-rentas-migracion-235590e243f8 deleted (0.60s)
 -  kubernetes:batch/v1:Job …kamayuk-rentas-prod/kamayuk-rentas-implantacion-235590e243f8 deleted (0.60s)
Resources:
    + 2 created
    ~ 4 updated
    - 2 deleted
```

Y en `stg` (puente, `caja@9c8e026`, trabajo `103755857086` de la corrida 34768644141):
`Resources: + 2 created ~ 3 updated - 2 deleted`, con `kamayuk-caja-web` y
`kamayuk-caja-interfaz` en `[diff: ~spec]`.

**3b · Las imágenes de los `Deployment`**, leídas del clúster:

```bash
kubectl -n kamayuk-<sistema>-<amb> get deployment \
  -o custom-columns='NOMBRE:.metadata.name,IMAGEN:.spec.template.spec.containers[0].image'
kubectl -n kamayuk-<sistema>-<amb> get replicaset \
  -o custom-columns='NOMBRE:.metadata.name,IMAGEN:.spec.template.spec.containers[0].image,REPLICAS:.status.replicas,CREADO:.metadata.creationTimestamp'
```

En `stg` el 2026-09-13: `kamayuk-caja-web-b795695c` con `kamayuk-caja:9c8e026d…` y `replicas=1`,
creado a las 16:31:44Z, y el anterior `kamayuk-caja-web-c7fd6ccc5` con `0772e251…` y `replicas=0`.

**3c · La ruta pública sirve la versión nueva**:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<dominio>/<sistema>/
curl -s https://<dominio>/<sistema>/ | grep -o 'index-[^"]*\.js'
```

Con #177, `/rentas/` de `prod` pasó de `index-BXbeNhmF.js` a `index--Id7jpQh.js`. El nombre del
paquete cambia con el contenido, así que es la señal de que el nodo sirve la interfaz nueva y no
una caché.

### 4. Revertir: bajar la línea

**Revertir es liberar el `sha` anterior**, por el mismo camino y con la misma aprobación.

```bash
# El commit que subió la línea: el del puente en stg, o el merge del PR en prod
git log --oneline -- infra/Pulumi.<amb>.yaml | head
git switch -c <amb>-vuelve-<sistema>-<sha7 anterior> origin/main
git revert --no-edit <commit que subió kamayuk:versionDe<Sistema>>
git diff origin/main --stat    # 1 archivo, 1 línea
git push -u origin HEAD && gh pr create --fill
```

Si entre medias se tocó otra cosa de `Pulumi.<amb>.yaml`, no se revierte el commit entero: se
edita **sólo** la línea `kamayuk:versionDe<Sistema>` al `sha` anotado en el paso 1.

- **En `prod`**: PR, `preview` con sólo objetos de ese sistema, merge y aprobación de la corrida
  que nace del merge. Es exactamente lo que #177 dejó escrito como su reversión: «un PR que
  devuelva la línea a `235590e` y su aprobación».
- **En `stg`**: el mismo commit, integrado en `main`. **Dura hasta que el hermano vuelva a
  publicar**: el puente clavará su siguiente `sha` sin preguntar. Si el defecto sigue en `main`
  del hermano, la reversión de verdad es un arreglo o un `revert` **allí**.
- **Comprobar igual que al liberar** (paso 3): el resumen debe mostrar los `Job` del `sha` anterior
  creados, y el `/<sistema>/` debe volver a servir el paquete de antes.

> **Hoy, bajar `identidad` a su primera versión reabre un incidente cerrado.** `a0866be2295467bf392e747eae3678967ad5d0f9`
> es la **etapa 3** de ADR-0039: allí el grupo «Consumidores del buzón» nace **sin miembros**, los
> cuatro satélites reciben `403` al leer el buzón y su copia local se queda como la dejó su
> implantación **sin un solo error que lo diga**. Es exactamente lo que
> [#98](https://github.com/hneyra/infrastructure/issues/98) costó y lo que
> [`la-version-clavada-afilia-a-los-consumidores.test.ts`](../../../infra/verificaciones/la-version-clavada-afilia-a-los-consumidores.test.ts)
> vigila: **ese PR sale rojo**, y es correcto. Si hace falta volver atrás, se elige un `sha` que
> afilie.

> **Si la versión revertida traía una migración aditiva**, el esquema se queda con la columna o
> la tabla nueva y la aplicación vieja no la usa — es lo que RNF-073 exige de toda migración
> («reversible o aditiva»). Revertir el esquema **no** forma parte de este runbook: una
> migración que borra datos para deshacerse no pasa la regla 4. Dos consecuencias:
>
> - `verificar-el-ambiente.sh` saldrá **rojo** con «va POR DELANTE de la version declarada»: es
>   verdad, y dice que la línea bajó por debajo del esquema. No se «arregla» la base.
> - El `Job` de migración del `sha` anterior corre contra una base con migraciones que no conoce.
>   **No está medido** que termine en verde: Flyway ignora por omisión las migraciones aplicadas
>   que no están en el paquete (`*:future`) y los cinco migradores no cambian esa opción, pero
>   ninguna reversión con migraciones se ha hecho todavía. Si falla, el `up` falla con él.

### 5. Medida de emergencia: `kubectl set image` / `rollout undo`

**No es una liberación ni una reversión: es deriva, y dura hasta el siguiente `pulumi up`.** El
siguiente `pulumi up` lo deshace —en `stg` basta con que un hermano publique—, así que sólo tiene
sentido cuando esperar al PR y a la aprobación cuesta más que el binario malo corriendo esos
minutos. Y la misma línea se clava **enseguida**: el PR del paso 4 se abre a la vez, no después.

```bash
# EMERGENCIA. El siguiente pulumi up lo deshace: abrir YA el PR del paso 4 con el mismo sha.
kubectl -n kamayuk-<sistema>-<amb> set image deployment/kamayuk-<sistema>-web \
  <contenedor>=ghcr.io/hneyra/kamayuk-<sistema>:<sha anterior>
kubectl -n kamayuk-<sistema>-<amb> rollout status deployment/kamayuk-<sistema>-web
```

O volver al `ReplicaSet` anterior sin saber el `sha`:

```bash
# EMERGENCIA. El siguiente pulumi up lo deshace.
kubectl -n kamayuk-<sistema>-<amb> rollout undo deployment/kamayuk-<sistema>-web --dry-run=client | grep -i image
kubectl -n kamayuk-<sistema>-<amb> rollout undo deployment/kamayuk-<sistema>-web
```

Lo que hay que saber antes de tocarlo, porque todo está medido y todo muerde:

- **El contenedor** se llama como el sistema (`rentas`, `catastro`, `normativa`, `caja`,
  `identidad`), y en las interfaces `interfaz`. **Cada `Deployment` es aparte**: la interfaz no
  vuelve sola, y los `CronJob` del sistema siguen con el `sha` del stack.
- **Con una sola revisión no hay `rollout undo`.** Medido el 2026-09-12 contra `prod`: cuatro de
  los cinco backends y las dos interfaces tenían **una** revisión, y `rollout undo` contestaba
  `error: no rollout history found for deployment "kamayuk-rentas-web"` con código 1
  (comprobado con `--dry-run=client`). Entonces sólo queda `set image` con el `sha` del paso 1.
- **No se comprueba un `rollout undo` con `-o jsonpath`: miente.** Sobre `kamayuk-identidad-web`,
  `rollout undo --dry-run=client -o jsonpath='{…containers[0].image}'` imprimía la imagen
  **actual** (`226ec6ff…`), mientras la salida legible del mismo comando decía el destino de verdad
  (`a0866be…`). Por eso arriba va `| grep -i image`.
- **Los `Job` no se tocan**: siguen siendo los de la versión del stack.
- **Cómo lo deshace el `up` no está medido**: si vuelve a poner la imagen del stack en silencio o
  si choca por la propiedad del campo, que `kubectl` se lleva con su gestor y que `patchForce` no
  recupera porque no llega a los `Deployment` ([#186](https://github.com/hneyra/infrastructure/issues/186)).
  En los dos casos la emergencia no sobrevive, que es lo que importa.
- **La detección de deriva diaria de `prod`** (`pulumi preview --expect-no-changes` con `refresh`)
  debería verlo como deriva hasta que la línea se clave; tampoco se ha medido.

## Cómo se comprueba que terminó bien

**No** «el `Deployment` está `Ready`».

**1 · La versión que corre es la que el stack declara**, leída del clúster y comparada con la
línea (paso 1). Deben ser la misma.

**2 · El ambiente responde por sí mismo**, contra el clúster que hay delante y **sin escribir
una sola fila**:

```bash
cd infra
verificaciones/ambiente/verificar-el-ambiente.sh --ambiente <amb>
```

Compara, **por sistema**, la versión declarada con la desplegada y con las migraciones que
tiene la base; cuenta lo que sembró la implantación; y mide el aislamiento **con la credencial
de `kamayuk_app`**, contrastándola con la del superusuario sobre el mismo contexto: si las dos
ven lo mismo, la comprobación no está midiendo nada (un superusuario omite RLS incluso con
`FORCE ROW LEVEL SECURITY`). Los puertos desde fuera **no** los comprueba, y lo dice. **Tampoco
se pone rojo si la imagen que corre difiere de la declarada**: la imprime, y compararla es el
punto 1.

Ejecutado contra `prod` el 2026-09-12: **código 0**, «el ambiente prod responde por sí mismo en
todo lo comprobado». Los cinco esquemas al día —`rentas` 16·16, `catastro` 14·14, `normativa`
2·2, `caja` 3·3, `identidad` 3·3— y la implantación sembrada en las cinco bases, con las
**5 cuentas y 5 afiliaciones** en cada satélite que son la señal de que el buzón replicó.
`aplicar-stg` corre su propia comprobación tras el `up` (#434): con `rentas@7085323` salió verde
en `stg`, y es la evidencia que #177 citó para subir la misma línea en `prod`.

**3 · Una petición con un token real llega hasta datos filtrados por municipalidad.** Esto **no
lo cubre** el guion: sin `--token` se detiene en el penúltimo peldaño y lo dice —«el último
peldaño de la escalera queda SIN comprobar»—. Un `Deployment` sano y una aplicación que perdió
el contexto de tenant devuelven el mismo código. El token se saca del realm de ese ambiente;
cómo, en [Abrir la consola de Keycloak](./abrir-la-consola-de-keycloak.md).

> La comprobación que este documento traía del archivo —`curl …/api/v1/cuentacorriente/deuda/…`—
> **ya no existe**: esa ruta era del monolito. Cuál de los cinco sistemas publica esa cifra y
> con qué forma lo decide su propio contrato, y RNF-075 se mide en el repositorio de cada uno.
> Lo dice el propio guion en su §5.

## La asimetría que hay que conocer: el manifiesto sale de `main`, la imagen del `sha` clavado

[`infra/descriptor/sistemas.ts`](../../../infra/descriptor/sistemas.ts) importa los cinco
descriptores **del clon hermano** (`../../../<sistema>/infrastructure/src/descriptor`), y
[`clonar-los-hermanos`](../../../.github/actions/clonar-los-hermanos/action.yml) los clona
**sin `ref:`**, es decir de `main`. La imagen, en cambio, sale de `kamayuk:versionDe<Sistema>`.

**Consecuencia: un ambiente puede correr un binario viejo sirviendo un manifiesto nuevo**, y
las guardas de la época no lo veían — `deriva-de-migraciones` compara **migraciones** y calló
con razón (las dos revisiones traían las mismas tres), `imagenes-publicadas` sólo pregunta si
la etiqueta existe, y la suite entera salió en verde con `prod` en ese estado.

Lo que costó, medido en `prod` el 2026-09-11: `prod` clavaba `a0866be` —etapa 3 de ADR-0039— y
los cuatro satélites traían ya su consumidor del buzón (etapa 4). Los `Job` de implantación
murieron tras siete intentos con «`identidad` contestó 403 al leer el buzón: la cuenta de
servicio de `rentas` existe y no tiene el acceso “eventos”». En la base: **1** fila en
`usuario` donde tenían que ser 5, el grupo 2 con **0** miembros.

Desde entonces lo vigila
[`la-version-clavada-afilia-a-los-consumidores.test.ts`](../../../infra/verificaciones/la-version-clavada-afilia-a-los-consumidores.test.ts),
en `yarn verificar`, sin clúster. **Y vale igual para revertir**: bajar la línea también sirve un
manifiesto de `main` con un binario más viejo.

### Cuándo se sube, y por qué no se puede posponer

Se sube cuando el ambiente ha quedado atrás de `main`. **El síntoma de no subirla no es un
error**: es una carga que termina en verde y no escribe ninguna fila, porque la clase que se
invoca no existe en esa imagen, Spring arranca con el contexto vacío y sale con código 0.

Y ya no hay que acordarse de mirarlo:
[`deriva-de-migraciones.test.ts`](../../../infra/verificaciones/deriva-de-migraciones.test.ts)
compara en cada PR las migraciones que trae el `sha` declarado con las que declara
`origin/main`, **por sistema**, y se pone rojo nombrando las dos cifras. Corre en
`yarn verificar`, sin clúster. En `stg` el puente ya la sube sola; **en `prod` no la propone
nadie**, y eso es #173.

**Y hay un orden entre sistemas en el arranque en frío**: `identidad` va primero, porque desde
la etapa 5 de ADR-0039 es el único que escribe la autorización y los otros cuatro la reciben
por el buzón. Está escrito y comprobado en
[`identidad-5-el-orden-de-implantacion.md`](../../00-gobierno/identidad-5-el-orden-de-implantacion.md).

## Si no sale bien

| Síntoma | Qué hacer |
|---|---|
| El `up` no termina, o el `Deployment` no queda `Ready` | `kubectl -n kamayuk-<sistema>-<amb> describe pod <pod-nuevo>` — casi siempre `ImagePullBackOff` (la etiqueta no existe en el registro: la Precondición 2 lo habría dicho antes) o una sonda que no pasa. Se revierte bajando la línea (paso 4) |
| El `preview de prod` del PR toca objetos de otros sistemas | `prod` está detrás de `main` en algo más que esta línea. No se integra hasta saber qué |
| Tras aprobar, `prod` corre una versión más vieja que la del PR | Se aprobó una corrida anterior (Precondición 4): aplicó el `Pulumi.prod.yaml` de su commit. Aprobar la corrida que nace del último merge |
| El `Job` de migración falla | El `up` falla con él. No subir otra línea encima. El runbook `la-migracion-fallo-a-mitad.md` sigue en el archivo `sgtm`, sin traer ni remedir (#100) |
| La imagen volvió sola al `sha` del stack | Alguien usó la medida de emergencia (paso 5) y no clavó la línea: el siguiente `pulumi up` lo deshace, y es lo que pasó. Si esa versión era la buena, subir la línea a ella |
| `error: no rollout history found for deployment "…"` | Sólo en la medida de emergencia: el `Deployment` tiene **una** revisión. Queda `set image` con el `sha` anotado en el paso 1 — y el siguiente `pulumi up` lo deshace, así que el PR va a la vez |
| `namespaces "sgtm-prod" not found` | Comando pre-renombrado, de la época del archivo. Los namespaces son `kamayuk-<sistema>-<amb>`, y el de la plataforma `kamayuk-<amb>` |
| Se ven Keycloak y su realm en vez del sistema `identidad` | `--componente identidad` es la **plataforma**. El sistema es `--componente identidad-sistema` |
| El backend arrancó con la imagen de una interfaz | Era la trampa de `catastro`: `ghcr.io/hneyra/kamayuk-catastro-web` era la **interfaz** y el `Deployment` `kamayuk-catastro-web` es el **backend**, que tira de `ghcr.io/hneyra/kamayuk-catastro`. `catastro`#104 renombra la imagen a `-interfaz` y la trampa desaparece; el `Deployment` del backend **sigue llamándose `kamayuk-catastro-web`**, así que el parecido merece una segunda lectura |
| Tras revertir, la comprobación 3 sigue mal | El problema no era la versión. Revisar [Keycloak no responde](./keycloak-no-responde.md) o el motor antes de volver a liberar nada |

## Estado del ensayo

**Liberar subiendo la línea: ejecutado de verdad, en los dos ambientes, el 2026-09-13.**

- **`stg`, por el puente**: `84d1507 stg despliega caja@9c8e026d29c1` cambió sólo
  `kamayuk:versionDeCaja`; la corrida
  [34768644141](https://github.com/hneyra/infrastructure/actions/runs/34768644141) hizo
  `updating [diff: ~spec]` sobre `kamayuk-caja-web` y `kamayuk-caja-interfaz`,
  `Resources: + 2 created ~ 3 updated - 2 deleted`, y el clúster quedó con `ReplicaSet` nuevos a
  las 16:31:44Z corriendo `9c8e026`. Es la medición que abrió #172.
- **`prod`, por PR y aprobación**: [#177](https://github.com/hneyra/infrastructure/pull/177) subió
  `kamayuk:versionDeRentas` de `235590e` a `7085323`; la corrida
  [34776934615](https://github.com/hneyra/infrastructure/actions/runs/34776934615), aprobada a
  mano, cambió **exactamente ocho** objetos de `rentas` (paso 3a), y `/rentas/` pasó de
  `index-BXbeNhmF.js` a `index--Id7jpQh.js` —vuelto a leer el 2026-09-13 al escribir esto: sigue
  `index--Id7jpQh.js`—.

**NO ensayado, y es deliberado:**

- **Revertir en `prod`.** Es un PR como el de #177 con el `sha` anterior, pero nadie lo ha hecho, y
  con migraciones en el rango hay una pieza sin medir (paso 4, el `Job` del `sha` anterior contra
  un esquema más nuevo).
- **Revertir en `stg`** bajando la línea tampoco se ha hecho a propósito.
- **La medida de emergencia** (`kubectl set image` / `rollout undo`) en ningún ambiente, ni qué
  hace con ella el siguiente `pulumi up`: se sabe que la imagen del stack vuelve —el siguiente
  `pulumi up` lo deshace, es la mecánica medida del paso 3— y no si vuelve en silencio o chocando.

**Lo que se ejecutó contra `prod` real el 2026-09-12**, sólo lecturas, cuando este documento aún
describía la liberación por `kubectl`:

- los `Deployment`, sus contenedores, sus imágenes, sus `generation` y sus `ReplicaSet` de los
  cinco sistemas; los diez `Job` de migración e implantación; y los gestores de campos;
- `rollout history` de los siete `Deployment` de sistemas, y `rollout undo --dry-run=client`
  sobre `kamayuk-rentas-web`, `kamayuk-catastro-web` y `kamayuk-identidad-web` — de donde
  salen el `error: no rollout history found` y el destino real de la reversión de `identidad`
  (y todo `rollout undo`, lo dice el paso 5: el siguiente `pulumi up` lo deshace);
- `verificar-el-ambiente.sh --ambiente prod` entero: **código 0**;
- `yarn manifiestos --ambiente prod` con y sin `--componente`, de donde sale la colisión
  `identidad` / `identidad-sistema`;
- `yarn imagenes --ambiente prod` sin credencial: **código 3**, como está escrito;
- `gh run list` de los cinco repositorios;
- y las tres guardas de liberación en `yarn verificar`: **103 pruebas, 3 archivos, 0 fallos**.

**Y la pista que ese día ya estaba delante.** `kamayuk-identidad-web` se creó el
2026-09-11T21:43:31Z con `a0866be`, y a las 22:47:15Z tenía `generation` 2 y un `ReplicaSet`
nuevo con `226ec6ff`, **sin recrearse** y con `pulumi-kubernetes-360696e6` (`operation: Apply`)
como único gestor de campos; los dos `Job` `…-226ec6ffdc62` se crearon dos segundos antes. O sea:
un `pulumi up` había movido el campo que llevaba `ignoreChanges`. La versión anterior de este
documento lo anotó como «lo que no se puede dar por hecho» y lo explicó con `patchForce`; la
explicación era otra —la transformación no llega a los hijos del `ConfigGroup`, #172 y #186—, y
la regla que dejó escrita, «después de un `set image`, subir la línea al mismo `sha`», es la que
hoy es el procedimiento.

**Y lo que este documento afirmaba y era falso ya antes: que el mecanismo estuviera ensayado en
cada `push` a `main`.** Decía que el `job` `demostrar-liberacion-y-reversion` de
`publicar-imagenes.yml` creaba un `Deployment` desechable en un `kind` efímero, lo liberaba, lo
revertía y cronometraba las dos operaciones con un límite de 900 s. **Ese `job` no existe en
ninguno de los seis repositorios** —comprobado con `grep` de `demostrar-liberacion`,
`set image` y `rollout undo` sobre los seis `.github/`: cero resultados— y en `infrastructure`
tampoco existe el flujo que lo alojaba. Se fue con el monolito, y con él el ensayo. Queda
anotado en [`infra/README.md`](../../../infra/README.md), cuya tabla «Lo que no está aquí»
todavía lo nombra y enlaza un archivo que no está: es una cita rota y no se corrige desde este
documento.

Con ella cae también **el «Límite de reversión: menos de 15 minutos (ADR-0011 §5)»** de la
cabecera original: ese número era el presupuesto de aquel `job`, no una decisión del ADR — §5
hablaba de «una reversión de tres minutos», y desde su enmienda una reversión es un `pulumi up`
con su aprobación.

## Documentos relacionados

[ADR-0011](../../30-arquitectura/adr/ADR-0011-infraestructura-como-codigo.md) §5 y su
enmienda del 2026-09-14 (la versión vive en el stack) y §6 (la aprobación de `prod` y la deriva
manual) ·
[ADR-0031](../../30-arquitectura/adr/ADR-0031-infraestructura-comun-y-propia.md) §3 y su enmienda
(por qué una liberación toca `infrastructure`) ·
[#172](https://github.com/hneyra/infrastructure/issues/172) (la decisión) ·
[#186](https://github.com/hneyra/infrastructure/issues/186) (`patchForce`, inerte por la misma causa) ·
[`declarar-version.yml`](../../../.github/workflows/declarar-version.yml) (el puente de `stg`) ·
[ADR-0029](../../30-arquitectura/adr/ADR-0029-cuatro-sistemas-separados.md) ·
[ADR-0039](../../30-arquitectura/adr/ADR-0039-la-identidad-es-un-sistema.md) (la colisión de
nombre, y el orden de implantación) ·
[`infra/README.md`](../../../infra/README.md) §«Liberar una versión nueva» ·
[Abrir la consola de Keycloak](./abrir-la-consola-de-keycloak.md) ·
[Keycloak no responde](./keycloak-no-responde.md) ·
[El orden de implantación](../../00-gobierno/identidad-5-el-orden-de-implantacion.md)
