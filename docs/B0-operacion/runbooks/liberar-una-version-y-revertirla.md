# Runbook — Liberar una versión, y revertirla

| Campo | Valor |
|---|---|
| Cuándo | Cuando hay que mover qué versión de un sistema corre, o volver a la anterior porque la nueva trae un defecto |
| Qué cubre | **Los cinco sistemas**, con una tabla. El mecanismo es uno; lo que cambia por sistema son cuatro nombres — ver «Por qué un solo runbook» |
| Alcance | `kubectl set image` / `rollout undo`, y la otra liberación: `kamayuk:versionDe<Sistema>` + `pulumi up` |
| Estado del ensayo | **NO ensayado**: el procedimiento es destructivo y `prod` atiende a una municipalidad. Lo que sí se ejecutó contra `prod` real (`vmd206041`, 2026-09-12) son **todas** las lecturas y las dos comprobaciones de cierre — ver «Estado del ensayo» |

> **Este documento vivía en el repositorio archivo `sgtm` y estaba pre-renombrado** — hablaba
> de `sgtm-<amb>`, de un `Deployment` llamado `sgtm-<amb>-aplicacion`, de la imagen
> `ghcr.io/hneyra/sgtm-aplicacion` y de una línea `sgtm:applicationBootstrapVersion` que
> **ya no existe**. Ninguno de esos cinco nombres resuelve hoy contra el clúster, y el
> primero falla del modo más engañoso: `kubectl -n sgtm-prod` contesta
> `namespaces "sgtm-prod" not found` sin mencionar el renombrado. Se trajo y se remidió
> entero ([#100](https://github.com/hneyra/infrastructure/issues/100),
> [#106](https://github.com/hneyra/infrastructure/issues/106)).

## Síntoma

No es una falla: es la operación de rutina que reemplaza «un despliegue es `pulumi up`».

## Por qué un solo runbook aquí, y no cinco

**Decisión: uno, en `infrastructure`, con una tabla de los cinco.** El motivo no es el ahorro:

1. **La línea que gobierna la liberación vive en este repositorio y en ningún otro.** Son
   cinco —`kamayuk:versionDeRentas`, `…Catastro`, `…Normativa`, `…Caja`, `…Identidad`— y
   las cinco están en los **mismos dos archivos**,
   [`infra/Pulumi.prod.yaml`](../../../infra/Pulumi.prod.yaml) y
   [`infra/Pulumi.stg.yaml`](../../../infra/Pulumi.stg.yaml). Un runbook en `rentas` le diría
   a su lector que edite un archivo de otro repositorio, al que puede no tener acceso.
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

Medido contra `prod` (`vmd206041`) el **2026-09-12**. Los `sha` son los que el stack declara
**y** los que el clúster corre: hoy coinciden los cinco.

| Sistema | Namespace | `Deployment` | Contenedor | Imagen | `sha` clavado hoy |
|---|---|---|---|---|---|
| `rentas` | `kamayuk-rentas-prod` | `kamayuk-rentas-web` | `rentas` | `ghcr.io/hneyra/kamayuk-rentas` | `66ebe547a3ee…` |
| `rentas` (interfaz) | `kamayuk-rentas-prod` | `kamayuk-rentas-interfaz` | `interfaz` | `ghcr.io/hneyra/kamayuk-rentas-interfaz` | el mismo |
| `catastro` | `kamayuk-catastro-prod` | `kamayuk-catastro-web` | `catastro` | `ghcr.io/hneyra/kamayuk-catastro` | `ac1239a26fd5…` |
| `normativa` | `kamayuk-normativa-prod` | `kamayuk-normativa-web` | `normativa` | `ghcr.io/hneyra/kamayuk-normativa` | `e1cdad5a3e4f…` |
| `caja` | `kamayuk-caja-prod` | `kamayuk-caja-web` | `caja` | `ghcr.io/hneyra/kamayuk-caja` | `0772e2515a68…` |
| `caja` (interfaz) | `kamayuk-caja-prod` | `kamayuk-caja-interfaz` | `interfaz` | `ghcr.io/hneyra/kamayuk-caja-interfaz` | el mismo |
| `identidad` | `kamayuk-identidad-prod` | `kamayuk-identidad-web` | `identidad` | `ghcr.io/hneyra/kamayuk-identidad` | `226ec6ffdc62…` |

**La tabla es lo que el clúster corre hoy; los manifiestos ya declaran dos interfaces más.**
Hasta `normativa`#41 y `catastro`#104 sólo dos de los cinco desplegaban interfaz —y la de
`catastro` se publicaba con un nombre que era una trampa, `ghcr.io/hneyra/kamayuk-catastro-web`,
que se lee igual que el `Deployment` del **backend**—. Los dos PR lo cambian: `catastro` la
renombra a `ghcr.io/hneyra/kamayuk-catastro-interfaz` y la despliega, y `normativa` estrena la
suya. Así que desde que se mezclen, `yarn manifiestos` compone **cuatro** `Deployment` de
interfaz y el único de los cinco sin pantalla es `identidad`, que sirve el buzón.

> **Antes de liberar cualquiera de esos dos, comprobar la imagen.** El `sha` clavado aquí es
> anterior a esos PR, así que `ghcr.io/hneyra/kamayuk-catastro-interfaz:ac1239a26fd5…` y
> `ghcr.io/hneyra/kamayuk-normativa-interfaz:e1cdad5a3e4f…` **no existen todavía en el
> registro**: la etiqueta nueva nace en el primer `push` a `main` que ejecute su
> `publicar-imagenes.yml`. Desplegar antes deja el pod en `ImagePullBackOff` (D-23). Lo dice la
> Precondición 2 con `yarn imagenes --ambiente prod`, que corre **antes** del `up`.

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
   `c0c7db6c64e5…` — **los cinco por delante del `sha` que `prod` clava**.

2. **Que esa etiqueta se pueda pedir al registro**, que es otra afirmación y es la que decide
   si el pod arranca:

   ```bash
   cd infra && GHCR_USUARIO=<usuario> GHCR_CLAVE=<token> yarn imagenes --ambiente prod
   ```

   **Sin credencial esto no pasa en verde: sale con código 3.** Medido el 2026-09-12 sin
   token: «`NO SE PUEDE COMPROBAR: falta la credencial del registro`». Una verificación que se
   salta a sí misma deja el despliegue en verde sin haber verificado nada.

3. **Si la versión trae migraciones**, sus dos `Job` tienen que haber completado **antes** de
   mover el `Deployment` (paso 2). Al revés, la aplicación arranca contra un esquema que
   todavía no está.

4. **Acceso `kubectl` al ambiente** (el mismo túnel SSH al API que usa CI). Y la regla de
   [ADR-0011 §6](../../30-arquitectura/adr/ADR-0011-infraestructura-como-codigo.md): **`pulumi
   up` contra `prod` desde una máquina de desarrollo está prohibido** — sus credenciales sólo
   existen en CI.

## Los dos actos, que no son el mismo y se confunden

| | Mover la etiqueta | Subir `kamayuk:versionDe<Sistema>` |
|---|---|---|
| Cómo | `kubectl set image` | PR a `Pulumi.<amb>.yaml` + `pulumi up` |
| Qué cambia | el binario que corre, en segundos | **crea los dos `Job`** de esa versión: migración e implantación |
| Reversible | `rollout undo`, si hay historial | no: un `Job` que escribió el esquema ya escribió |
| Es deriva | **sí** (ADR-0011 §6) | no |

**Los dos hacen falta, y confundirlos costó un despliegue entero** ([#98](https://github.com/hneyra/infrastructure/issues/98)).
Están descritos abajo por separado, y el orden entre ellos está en «El orden, que aquí sí
importa».

## Pasos

### 1. Leer qué corre hoy, antes de mover nada

Del clúster, nunca del archivo de Pulumi — que dice lo declarado, no lo que hay:

```bash
kubectl -n kamayuk-<sistema>-<amb> get deployment kamayuk-<sistema>-web \
  -o jsonpath='{.spec.template.spec.containers[0].image}'; echo
```

Y el historial, **que es lo que decide si se puede revertir**:

```bash
kubectl -n kamayuk-<sistema>-<amb> rollout history deployment/kamayuk-<sistema>-web
```

> **Con una sola revisión no hay reversión, y hoy es el caso de cuatro de los cinco.** Medido
> el 2026-09-12 contra `prod`: `kamayuk-rentas-web`, `kamayuk-catastro-web`,
> `kamayuk-normativa-web`, `kamayuk-caja-web` y las dos interfaces tienen **una** revisión;
> sólo `kamayuk-identidad-web` tiene dos. `kubectl rollout undo` sobre una de las primeras
> contesta `error: no rollout history found for deployment "kamayuk-rentas-web"` y sale con
> código 1 — comprobado con `--dry-run=client`, que no escribe nada. **Eso no es un problema
> que aparezca al revertir: es uno que hay que saber antes de liberar**, porque significa que
> la salida de emergencia de este runbook no está disponible y hay que anotarse el `sha` viejo
> a mano.

### 2. Si la versión trae migraciones, primero los dos `Job`

```bash
cd infra
yarn manifiestos --ambiente <amb> --componente <sistema> | kubectl apply -f -
kubectl -n kamayuk-<sistema>-<amb> wait --for=condition=complete \
  job/kamayuk-<sistema>-migracion-<primeros 12 del sha> --timeout=300s
```

> **Para el sistema `identidad` el componente se llama `identidad-sistema`, y equivocarse aquí
> despliega Keycloak.** Medido: `yarn manifiestos --ambiente prod --componente identidad`
> emite `Deployment/kamayuk-prod-identidad` y `Job/kamayuk-prod-realm-e2a489ad39`, que son la
> **plataforma**; los del sistema salen con `--componente identidad-sistema`. Es la colisión de
> nombre de [ADR-0039](../../30-arquitectura/adr/ADR-0039-la-identidad-es-un-sistema.md), y en
> este comando el error es mudo: el YAML es válido y `kubectl apply` lo acepta.
>
> Las etiquetas que hay son `namespace, prioridades, postgres, respaldo, identidad, ingreso,
> observabilidad, red, rentas, rentas-interfaz, catastro, normativa, caja, caja-interfaz,
> identidad-sistema`. Un `--componente` que no sea una de ellas **falla nombrándolas todas**,
> que es lo correcto; el peligro es el que sí existe y es otro.

El nombre del `Job` lleva la versión —[`sufijoDeVersion()`](../../../infra/componentes/convenciones.ts),
llamado desde [`descriptor/entorno.ts`](../../../infra/descriptor/entorno.ts), los doce
primeros caracteres del `sha`—, así que **una versión nueva crea un `Job` nuevo** y volver a
aplicar la misma no hace nada: el migrador es idempotente. Medido el 2026-09-12, `prod` tiene
exactamente los diez que le tocan, dos por sistema: `kamayuk-identidad-migracion-226ec6ffdc62`,
`kamayuk-rentas-implantacion-66ebe547a3ee`, y así.

Si el `Job` falla, **no seguir con el paso 3**: liberar la imagen nueva contra un esquema a
medias es el estado que todo este orden existe para impedir. El runbook
`la-migracion-fallo-a-mitad.md` sigue en el repositorio archivo `sgtm` y **no se ha traído ni
remedido** (#100).

### 3. Mover la etiqueta

```bash
kubectl -n kamayuk-<sistema>-<amb> set image deployment/kamayuk-<sistema>-web \
  <contenedor>=ghcr.io/hneyra/kamayuk-<sistema>:<sha>
kubectl -n kamayuk-<sistema>-<amb> rollout status deployment/kamayuk-<sistema>-web
```

El **contenedor** se llama como el sistema (`rentas`, `catastro`, `normativa`, `caja`,
`identidad`), y en las dos interfaces se llama `interfaz` — está en la tabla de arriba. Con
`rentas` de ejemplo, entero:

```bash
kubectl -n kamayuk-rentas-prod set image deployment/kamayuk-rentas-web \
  rentas=ghcr.io/hneyra/kamayuk-rentas:10357c5db3bb932af7ec6eeab10991c0d9e2308f
kubectl -n kamayuk-rentas-prod rollout status deployment/kamayuk-rentas-web
```

**Y la interfaz es un `Deployment` aparte, con su propia imagen**: se promueve, no se
reconstruye (ADR-0011 §5).

```bash
kubectl -n kamayuk-rentas-prod set image deployment/kamayuk-rentas-interfaz \
  interfaz=ghcr.io/hneyra/kamayuk-rentas-interfaz:<sha>
```

> **Esto es deriva manual, y hay que cerrarla.** [ADR-0011
> §6](../../30-arquitectura/adr/ADR-0011-infraestructura-como-codigo.md) lo dice con todas las
> letras: «un `kubectl apply` a mano es una deriva que el siguiente `pulumi up` deshace en
> silencio». Después de liberar así, **subir `kamayuk:versionDe<Sistema>` al mismo `sha`** —el
> acto de abajo— es lo que impide que el binario retroceda solo un día que nadie eligió. Ver
> «Qué protege `ignoreChanges` y qué no».

### 4. Revertir

```bash
kubectl -n kamayuk-<sistema>-<amb> rollout undo deployment/kamayuk-<sistema>-web
kubectl -n kamayuk-<sistema>-<amb> rollout status deployment/kamayuk-<sistema>-web
```

`rollout undo` vuelve al `ReplicaSet` anterior completo: no hace falta recordar cuál era la
imagen vieja. **Pero hay que mirar a cuál vuelve, antes**, y se puede sin escribir nada:

```bash
kubectl -n kamayuk-<sistema>-<amb> rollout undo deployment/kamayuk-<sistema>-web \
  --dry-run=client | grep -i image
```

> **No se comprueba un `rollout undo` con `-o jsonpath`: miente.** Medido el 2026-09-12 sobre
> `kamayuk-identidad-web`, `rollout undo --dry-run=client -o jsonpath='{…containers[0].image}'`
> imprime `…kamayuk-identidad:226ec6ff…` —la imagen **actual**, no el destino—, mientras la
> salida legible del mismo comando dice `…kamayuk-identidad:a0866be…`, que es el destino de
> verdad. Un operador que use `jsonpath` para confirmar el destino leerá que no cambia nada.

> **Hoy, revertir `identidad` reabre un incidente cerrado.** Su revisión 1 es
> `a0866be2295467bf392e747eae3678967ad5d0f9`, que es la **etapa 3** de ADR-0039: allí el grupo
> «Consumidores del buzón» nace **sin miembros**, los cuatro satélites reciben `403` al leer el
> buzón y su copia local se queda como la dejó su implantación **sin un solo error que lo
> diga**. Es exactamente lo que
> [#98](https://github.com/hneyra/infrastructure/issues/98) costó y lo que
> [`la-version-clavada-afilia-a-los-consumidores.test.ts`](../../../infra/verificaciones/la-version-clavada-afilia-a-los-consumidores.test.ts)
> vigila desde entonces. **No se revierte `identidad` a su revisión 1**; si hace falta volver
> atrás, se elige un `sha` que afilie y se pone con `set image`.

> **Si la versión revertida traía una migración aditiva**, el esquema se queda con la columna o
> la tabla nueva y la aplicación vieja no la usa — es lo que RNF-073 exige de toda migración
> («reversible o aditiva»). Revertir el esquema **no** forma parte de este runbook: una
> migración que borra datos para deshacerse no pasa la regla 4.

## La otra liberación: subir `kamayuk:versionDe<Sistema>`

Los pasos 1–4 mueven qué imagen corre. Hay un segundo acto, distinto, que la primera lectura
de `Pulumi.<amb>.yaml` invita a creer inerte y no lo es. Son **cinco líneas por stack**:

```yaml
kamayuk:versionDeRentas: 66ebe547a3ee547598711e02267a1ecfea8aae14
kamayuk:versionDeCatastro: ac1239a26fd538c852fdc0d204dafa3d8b69cda9
kamayuk:versionDeNormativa: e1cdad5a3e4fdfd508144a67eaa569aa9488b80f
kamayuk:versionDeCaja: 0772e2515a68d4e659b129c057067eb88f254370
kamayuk:versionDeIdentidad: 226ec6ffdc62961c1d40dcd9a8ed475e8d49ff5d
```

> **`applicationBootstrapVersion` ya no existe**, y el documento del archivo giraba entero
> alrededor de ella. Era la versión del monolito; se fue con el código que gobernaba. Hoy hay
> cinco versiones y ninguna excepción.

**Lo que esa línea hace con certeza es crear los dos `Job` de esa versión** —migración e
implantación—, porque el `sha` va **en el nombre** del `Job` (`sufijoDeVersion()`). Así que
subirla y aplicar el stack significa, literalmente:

> corre el migrador de esa versión contra esta base, y vuelve a implantar la municipalidad.

Se puede ver sin desplegar nada:

```bash
cd infra
yarn --silent manifiestos --ambiente prod --componente identidad-sistema | grep '"name"'
# Job/kamayuk-identidad-migracion-<primeros 12 del sha declarado>
```

### Qué protege `ignoreChanges` y qué no

[`infra/index.ts:178`](../../../infra/index.ts) declara
`IGNORAR_LA_VERSION = ["spec.template.spec.containers[*].image"]` y lo describe como «el campo
que el flujo de liberación mueve, y que Pulumi no vuelve a mirar». **Eso vale para el diff**:
sin ello, el `preview` diario vería una etiqueta liberada a mano como deriva.

**Lo que no se puede dar por hecho es que el campo quede clavado.** Medido contra `prod` el
2026-09-12:

- `kamayuk-identidad-web` se creó el **2026-09-11T21:43:31Z** y su `ReplicaSet` de revisión 1
  lleva `…kamayuk-identidad:a0866be…`;
- su `generation` es **2** y su revisión 2 lleva `…:226ec6ff…`, con el `ReplicaSet` creado el
  **2026-09-11T22:47:15Z**;
- el `Deployment` **no se recreó** —mismo `creationTimestamp`, y el `ReplicaSet` viejo sigue
  ahí—, y el único gestor de campos que aparece es `pulumi-kubernetes-360696e6` con
  `operation: Apply`, a esa misma hora;
- los dos `Job` `…-226ec6ffdc62` se crearon **dos segundos antes**, a las 22:47:13Z;
- y en el manifiesto emitido, el `sha` aparece dentro del `Deployment` **sólo** en `image`.

O sea: en ese `up`, el campo con `ignoreChanges` **se movió**. La explicación que encaja con el
código es que el proveedor corre con `enableServerSideApply: true`
([`index.ts:167`](../../../infra/index.ts)) y con `pulumi.com/patchForce: "true"` puesto en
**todos** los objetos del `ConfigGroup` (`index.ts:200`), de modo que cuando el recurso se
aplica toma la propiedad del campo con el valor del programa.

**La regla operativa, que no depende de cuál de las dos lecturas gane:**

1. **Después de cualquier `pulumi up`, leer del clúster qué imagen corre** (paso 1). No
   suponerlo en ninguna de las dos direcciones.
2. **Después de un `kubectl set image`, subir `versionDe<Sistema>` al mismo `sha`.** Si no, el
   binario puede retroceder en el siguiente `up` y el síntoma es una regresión que nadie
   decidió.
3. `verificar-el-ambiente.sh` está escrito sobre la primera lectura —dice que la versión que
   corre «puede ser legítimamente más nueva que la declarada»—, así que **no se pone rojo por
   una diferencia entre las dos**. Lo que sí mide, y es lo que importa, es que la base no
   tenga menos migraciones de las que trae la versión declarada.

### La asimetría que hay que conocer: el manifiesto sale de `main`, la imagen del `sha` clavado

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
en `yarn verificar`, sin clúster.

**Quien libera tiene que saberlo**: los cinco `sha` clavados hoy están **por detrás** del
último `main` publicado de su repositorio (ver Precondición 1), así que el manifiesto que CI
compone ya es más nuevo que los cinco binarios.

### Cuándo se sube, y por qué no se puede posponer

Se sube cuando el ambiente ha quedado atrás de `main`. **El síntoma de no subirla no es un
error**: es una carga que termina en verde y no escribe ninguna fila, porque la clase que se
invoca no existe en esa imagen, Spring arranca con el contexto vacío y sale con código 0.

Y ya no hay que acordarse de mirarlo:
[`deriva-de-migraciones.test.ts`](../../../infra/verificaciones/deriva-de-migraciones.test.ts)
compara en cada PR las migraciones que trae el `sha` declarado con las que declara
`origin/main`, **por sistema**, y se pone rojo nombrando las dos cifras. Corre en
`yarn verificar`, sin clúster.

### El orden, que aquí sí importa

1. **PR con el `sha` nuevo** en `Pulumi.<amb>.yaml`. Merge a `main`.
2. [`infra.yml`](../../../.github/workflows/infra.yml) corre solo. `aplicar-stg` es
   automático; **`aplicar-prod` espera una aprobación humana** del *environment* `prod`
   (Actions → la corrida → *Review deployments*). El grupo de concurrencia
   `infra-aplicar-prod` retiene **una sola** corrida en espera: aprobar una corrida vieja
   despliega la versión vieja, que es la trampa entera. Aprobar **la que nace del merge**.
   Antes del `up`, el mismo trabajo corre
   [`crear-extensiones.sh`](../../../despliegue/crear-extensiones.sh) **con `--todos`** contra
   el motor que ya existe: `crear-roles.sql` sólo corre con el volumen vacío, y una extensión
   añadida después no llega sola. Aplicando el stack a mano, correrlo primero.
3. `pulumi up` crea los `Job` de migración nuevos, espera a que completen, y sigue.
4. Comprobar con `verificar-el-ambiente.sh` (abajo).

**Y hay un orden entre sistemas en el arranque en frío**: `identidad` va primero, porque desde
la etapa 5 de ADR-0039 es el único que escribe la autorización y los otros cuatro la reciben
por el buzón. Está escrito y comprobado en
[`identidad-5-el-orden-de-implantacion.md`](../../00-gobierno/identidad-5-el-orden-de-implantacion.md).

## Cómo se comprueba que terminó bien

**No** «el `Deployment` está `Ready`».

**1 · La versión que corre es la que se dijo que corre**, leída del clúster:

```bash
kubectl -n kamayuk-<sistema>-<amb> get deployment kamayuk-<sistema>-web \
  -o jsonpath='{.spec.template.spec.containers[0].image}'; echo
```

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
`FORCE ROW LEVEL SECURITY`). Los puertos desde fuera **no** los comprueba, y lo dice.

Ejecutado contra `prod` el 2026-09-12: **código 0**, «el ambiente prod responde por sí mismo en
todo lo comprobado». Los cinco esquemas al día —`rentas` 16·16, `catastro` 14·14, `normativa`
2·2, `caja` 3·3, `identidad` 3·3— y la implantación sembrada en las cinco bases, con las
**5 cuentas y 5 afiliaciones** en cada satélite que son la señal de que el buzón replicó.

**3 · Una petición con un token real llega hasta datos filtrados por municipalidad.** Esto **no
lo cubre** el guion: sin `--token` se detiene en el penúltimo peldaño y lo dice —«el último
peldaño de la escalera queda SIN comprobar»—. Un `Deployment` sano y una aplicación que perdió
el contexto de tenant devuelven el mismo código. El token se saca del realm de ese ambiente;
cómo, en [Abrir la consola de Keycloak](./abrir-la-consola-de-keycloak.md).

> La comprobación que este documento traía del archivo —`curl …/api/v1/cuentacorriente/deuda/…`—
> **ya no existe**: esa ruta era del monolito. Cuál de los cinco sistemas publica esa cifra y
> con qué forma lo decide su propio contrato, y RNF-075 se mide en el repositorio de cada uno.
> Lo dice el propio guion en su §5.

## Si no sale bien

| Síntoma | Qué hacer |
|---|---|
| `rollout status` no termina | `kubectl -n kamayuk-<sistema>-<amb> describe pod <pod-nuevo>` — casi siempre `ImagePullBackOff` (la etiqueta no existe en el registro: la Precondición 2 lo habría dicho antes) o una sonda que no pasa |
| `error: no rollout history found for deployment "…"` | Ese `Deployment` tiene **una sola** revisión y no hay a dónde volver. Hoy es el caso de cuatro de los cinco. Hay que poner el `sha` anterior con `set image`, y para eso hay que saberlo: leerlo **antes** de liberar |
| `namespaces "sgtm-prod" not found` | Comando pre-renombrado, de la época del archivo. Los namespaces son `kamayuk-<sistema>-<amb>`, y el de la plataforma `kamayuk-<amb>` |
| Se desplegó Keycloak en vez del sistema `identidad` | `--componente identidad` es la **plataforma**. El sistema es `--componente identidad-sistema` |
| El backend arrancó con la imagen de una interfaz | Era la trampa de `catastro`: `ghcr.io/hneyra/kamayuk-catastro-web` era la **interfaz** y el `Deployment` `kamayuk-catastro-web` es el **backend**, que tira de `ghcr.io/hneyra/kamayuk-catastro`. `catastro`#104 renombra la imagen a `-interfaz` y la trampa desaparece; el `Deployment` del backend **sigue llamándose `kamayuk-catastro-web`**, así que el parecido entre ese nombre y el de una imagen que ya no existe sigue mereciendo una segunda lectura |
| El `Job` de migración falla | No seguir con el paso 3. El runbook `la-migracion-fallo-a-mitad.md` sigue en el archivo `sgtm`, sin traer ni remedir (#100) |
| Tras revertir, la comprobación 3 sigue mal | El problema no era la versión. Revisar [Keycloak no responde](./keycloak-no-responde.md) o el motor antes de volver a liberar nada |
| La imagen volvió sola al `sha` viejo | Un `pulumi up` posterior. Ver «Qué protege `ignoreChanges` y qué no»: subir `versionDe<Sistema>` al `sha` liberado |

## Estado del ensayo

**NO ensayado, y es deliberado.** Este procedimiento es destructivo —`set image` reemplaza el
binario que atiende a una municipalidad, `rollout undo` lo reemplaza otra vez y los `Job` de
migración escriben el esquema—, y el único ambiente disponible para ensayarlo es `prod` con
tráfico real. Ensayarlo aquí habría sido ejecutarlo.

**Lo que sí se ejecutó contra `prod` real** (`vmd206041`, 2026-09-12), sólo lecturas:

- los `Deployment`, sus contenedores, sus imágenes, sus `generation` y sus `ReplicaSet` de los
  cinco sistemas; los diez `Job` de migración e implantación; y los gestores de campos;
- `rollout history` de los siete `Deployment` de sistemas, y `rollout undo --dry-run=client`
  sobre `kamayuk-rentas-web`, `kamayuk-catastro-web` y `kamayuk-identidad-web` — de donde
  salen el `error: no rollout history found` y el destino real de la reversión de `identidad`;
- `verificar-el-ambiente.sh --ambiente prod` entero: **código 0**;
- `yarn manifiestos --ambiente prod` con y sin `--componente`, de donde sale la colisión
  `identidad` / `identidad-sistema`;
- `yarn imagenes --ambiente prod` sin credencial: **código 3**, como está escrito;
- `gh run list` de los cinco repositorios;
- y las tres guardas de liberación en `yarn verificar`: **103 pruebas, 3 archivos, 0 fallos**.

**Y lo que este documento afirmaba y era falso: que el mecanismo estuviera ensayado en cada
`push` a `main`.** Decía que el `job` `demostrar-liberacion-y-reversion` de
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
habla de «una reversión de tres minutos», y no fija ningún tope.

## Documentos relacionados

[ADR-0011](../../30-arquitectura/adr/ADR-0011-infraestructura-como-codigo.md) §5 (la frontera
con el flujo de liberación) y §6 (la deriva manual) ·
[ADR-0031](../../30-arquitectura/adr/ADR-0031-infraestructura-comun-y-propia.md) (por qué el
descriptor de cada sistema es suyo) ·
[ADR-0029](../../30-arquitectura/adr/ADR-0029-cuatro-sistemas-separados.md) ·
[ADR-0039](../../30-arquitectura/adr/ADR-0039-la-identidad-es-un-sistema.md) (la colisión de
nombre, y el orden de implantación) ·
[`infra/README.md`](../../../infra/README.md) §«Liberar una versión nueva» ·
[Abrir la consola de Keycloak](./abrir-la-consola-de-keycloak.md) ·
[Keycloak no responde](./keycloak-no-responde.md) ·
[El orden de implantación](../../00-gobierno/identidad-5-el-orden-de-implantacion.md)
