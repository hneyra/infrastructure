# Runbook — Keycloak no responde

| Campo | Valor |
|---|---|
| Cuándo | Nadie nuevo puede iniciar sesión. Quien ya entró sigue trabajando, pero **no indefinidamente**: su token dura 15 minutos y renovarlo vuelve a pasar por Keycloak |
| Qué cubre | El pod de Keycloak caído o reiniciando (§2), y el realm que quedó inconsistente (§3). El segundo síntoma —la réplica de la autorización a los cuatro satélites parada— está en «Lo otro que se rompe» |
| Estado del ensayo | **Diagnóstico ensayado entero contra el Keycloak real de `prod`** (`vmd206041`, 2026-09-12): las sondas, el descubrimiento público, el OOMKill y la huella del realm. **Las tres acciones de remedio NO se ensayaron**, y ninguna es inocua — ver «Estado del ensayo» |

> **Este documento vivía en el repositorio archivo `sgtm` y sus comandos estaban
> pre-renombrado** (`kubectl -n sgtm-<amb>`, realm `sgtm`, cliente `sgtm-backoffice`,
> `SGTM_OIDC_EMISOR`). Copiados al pie de la letra no fallan todos igual: unos dicen
> `namespaces "sgtm-prod" not found` —que al menos nombra el problema— y otros **contestan
> algo**, que es peor: el `curl` de comprobación devuelve `invalid_client` y se lee como
> «Keycloak sigue roto» sobre un Keycloak perfectamente sano. Se trajo y se remidió entero
> ([#100](https://github.com/hneyra/infrastructure/issues/100),
> [#103](https://github.com/hneyra/infrastructure/issues/103)).

## Síntoma

Los funcionarios reportan que no pueden entrar, o el navegador se queda esperando en la
pantalla de acceso de Keycloak.

**Quien ya tenía sesión sigue trabajando, y eso tiene un techo medido.** El realm fija
`accessTokenLifespan: 900` —**15 minutos**— y el frontend **no guarda `refresh_token`**: para
renovar vuelve a pedir un código de autorización contra Keycloak, apoyándose en la sesión SSO
(`rentas/frontend/src/api/identidad.ts`, «el token vive en memoria»). Así que con Keycloak
caído cada sesión abierta muere como mucho 15 minutos después, de una en una, según le toque
renovar. **No es «los de dentro están a salvo»: es «hay 15 minutos para arreglarlo».**

Si **nadie** puede hacer nada en absoluto, incluida gente que entró hace cinco minutos, el
problema no es Keycloak: es la aplicación, el ingreso o el motor, y este no es el runbook.

## Precondiciones

1. **Acceso `kubectl` al ambiente**, de lectura. Desde fuera del nodo va por el túnel SSH al
   API.
2. **Saber cuál de los dos «identidad» se está mirando** — §1. Es la primera parada porque
   equivocarse cuesta toda la investigación.
3. **Distinguir antes de actuar** entre las dos causas, porque los pasos son distintos y el
   remedio de una no toca la otra:
   - El pod de Keycloak está caído, reiniciando o **fue matado por falta de memoria** → §2.
   - El pod responde pero el realm quedó inconsistente (tras un cambio manual en la consola,
     o una reconciliación que no llegó a correr) → §3.

## Pasos

### 1. Cuál de los dos «identidad»

**En este producto `identidad` nombra dos cosas distintas, y las dos están en el clúster.**
Medido el 2026-09-12 en `prod`:

```bash
kubectl get deploy -A -l proyecto=kamayuk \
  -o custom-columns='NAMESPACE:.metadata.namespace,NOMBRE:.metadata.name,COMPONENTE:.metadata.labels.componente' \
  | grep -i identidad
```

```
kamayuk-identidad-prod   kamayuk-identidad-web     identidad-sistema
kamayuk-prod             kamayuk-prod-identidad    identidad
```

| Qué es | Dónde | Etiqueta | Este runbook |
|---|---|---|---|
| **Keycloak**, el emisor de tokens | `kamayuk-<amb>` / `kamayuk-<amb>-identidad` | `componente: identidad` | **Sí** |
| El **quinto sistema**, dueño de la autorización (ADR-0039) | `kamayuk-identidad-<amb>` / `kamayuk-identidad-web` | `componente: identidad-sistema` | No |

El quinto sistema **no autentica a nadie** y su caída no impide iniciar sesión: lo que para es
la administración de usuarios y permisos, y la réplica a los otros cuatro. Un `-n
kamayuk-identidad-prod` donde iba `-n kamayuk-prod` devuelve un pod sano y manda a concluir que
Keycloak está bien.

```bash
kubectl -n kamayuk-<amb> get pods -l app=kamayuk-<amb>-identidad
```

### 2. El pod está caído, reiniciando — o lo mataron por memoria

**Antes de nada, mirar por qué murió la vez anterior.** Un Keycloak que ahora contesta pero
llegó ahí a trompicones no es lo mismo que uno que nunca se cayó, y `get pods` los dibuja casi
igual:

```bash
kubectl -n kamayuk-<amb> get pod -l app=kamayuk-<amb>-identidad \
  -o jsonpath='{range .items[*]}{.metadata.name}{"  reinicios="}{.status.containerStatuses[0].restartCount}{"  ultima salida="}{.status.containerStatuses[0].lastState.terminated.reason}{"/"}{.status.containerStatuses[0].lastState.terminated.exitCode}{"  a las "}{.status.containerStatuses[0].lastState.terminated.finishedAt}{"\n"}{end}'
```

Medido el 2026-09-12 en `prod`, **con el pod en `Running` y sirviendo**:

```
kamayuk-prod-identidad-bd4844bc9-hcls4  reinicios=2  ultima salida=OOMKilled/137  a las 2026-09-11T21:44:38Z
```

> **`OOMKilled` / `exitCode: 137` es el kernel, no Keycloak.** Es el defecto abierto
> [#99](https://github.com/hneyra/infrastructure/issues/99): el pod pide `512Mi` y su límite es
> `1Gi`, y **no le basta al arrancar**. El arranque es justo el momento en el que todo lo demás
> lo espera —el `Job` del realm, las cinco implantaciones y los cuatro consumidores le piden un
> token—, así que un OOMKill ahí **no se ve como «falta memoria»: se ve como `401` al pedir el
> token de servicio**, que es el mismo síntoma que produce otra causa distinta. Este defecto
> puede disfrazarse del otro, y esa es la parte que cuesta.

Dónde está el borde, medido con la aplicación en reposo el 2026-09-12:

```bash
kubectl -n kamayuk-<amb> get deploy kamayuk-<amb>-identidad \
  -o jsonpath='estrategia={.spec.strategy.type}  replicas={.spec.replicas}  memoria={.spec.template.spec.containers[0].resources.requests.memory}/{.spec.template.spec.containers[0].resources.limits.memory}{"\n"}'
kubectl -n kamayuk-<amb> top pod -l app=kamayuk-<amb>-identidad
```

```
estrategia=Recreate  replicas=1  memoria=512Mi/1Gi
kamayuk-prod-identidad-bd4844bc9-hcls4   1m   613Mi
```

**613Mi en reposo contra un `request` de 512Mi**: ya está un 20 % por encima de lo que declara
pedir, y en reposo. Lo que lo mata no es el reposo, es el arranque — el log del contenedor
muerto lo dice sin ambigüedad:

```bash
kubectl -n kamayuk-<amb> logs -l app=kamayuk-<amb>-identidad --previous --tail=20
```

```
… [io.qua.dep.QuarkusAugmentor] (main) Quarkus augmentation completed in 15544ms
… [org.keycloak.…storage.database.liquibase…] (main) Initializing database schema. Using changelog META-INF/jpa-changelog-master.xml
```

Murió **20 segundos después de empezar a migrar su propia base** y 39 después de arrancar el
contenedor. Es decir: `kc.sh build` (la augmentación de Quarkus) más Liquibase, las dos fases
caras, a la vez. **Subir el límite no se hace desde este runbook** —sale del mismo presupuesto
del nodo que el resto del stack y `yarn capacidad --estricto` corre antes del `up`—: es #99.

**Una réplica y estrategia `Recreate`, y eso hay que decirlo antes de tocar nada.** `Recreate`
significa que Kubernetes **apaga el pod viejo antes de crear el nuevo**: no hay solape, no hay
un segundo Keycloak atendiendo mientras. Así que **cualquier reinicio de este Deployment es una
ventana en la que nadie inicia sesión**, y dura:

| Tramo | Medido en `prod`, 2026-09-11/12 |
|---|---|
| Contenedor arrancado → `Ready` | **36 s** (`startedAt 21:44:51` → `Ready 21:45:27`) |
| Keycloak dice «started in» | 16,5 s, tras 14,4 s de augmentación |
| Pod programado → `Ready`, **con los dos OOMKill por medio** | **2 min 10 s** (`21:43:17` → `21:45:27`) |

O sea: **cerca de un minuto en el caso bueno, más de dos si vuelve a quedarse sin memoria.** No
es un reinicio que se haga «a ver si se arregla» en horario de ventanilla.

Si el pod no vuelve solo en unos minutos:

```bash
kubectl -n kamayuk-<amb> describe pod -l app=kamayuk-<amb>-identidad
kubectl -n kamayuk-<amb> logs -l app=kamayuk-<amb>-identidad --previous
```

Las causas, en el orden en que conviene descartarlas con un solo nodo:

1. **Memoria** — arriba, y hoy es la más probable en `prod`.
2. **Presión de CPU o disco del nodo.** Va a
   [Mantenimiento del VPS](mantenimiento-del-vps.md) §1, «Verificar que la carga alta es
   legítima antes de tocar nada»; si lo que aprieta es el disco,
   [El disco del nodo se llenó](el-disco-del-nodo-se-lleno.md).
3. **Su base de datos.** Keycloak tiene base propia, `keycloak`, con **rol propio** —no usa
   ninguno de los del producto—:

   ```bash
   kubectl -n kamayuk-<amb> exec deployment/kamayuk-<amb>-postgres -c postgres -- \
     psql -U postgres -c "\l" | grep keycloak
   ```

   Medido el 2026-09-12 en `prod`:

   ```
    keycloak  | keycloak | UTF8 | libc | en_US.utf8 | en_US.utf8 | … | =T/keycloak  +
              |          |      |      |            |            |   | keycloak=CTc/keycloak
   ```

   > **El `-U postgres` no es pereza, y el runbook del archivo lo daba por hecho sin decirlo.**
   > Los roles del clúster son `kamayuk_owner`, `kamayuk_app`, `kamayuk_readonly`,
   > `kamayuk_monitor` y `kamayuk_respaldo`, y **ninguno alcanza esta base**:
   > [`30-base-de-keycloak.sh`](../../../infra/componentes/inicializacion/30-base-de-keycloak.sh)
   > hace `REVOKE CONNECT ON DATABASE keycloak FROM PUBLIC` a propósito, para que `keycloak` no
   > herede acceso al padrón ni al revés. Intentar esto con `kamayuk_readonly` da un
   > `permission denied` que se lee como un permiso mal puesto.

   Si la base no aparece, el guion de inicialización no corrió. **Y se sabe cómo pasa eso sin
   que nadie lo note**: los guiones de init sólo se ejecutan con el directorio de datos vacío,
   así que un volumen que ya existía **no gana la base de un componente nuevo y nada lo avisa**.
   El síntoma es el que el propio guion anticipa: el arranque muere con `database "keycloak"
   does not exist`.

### 3. El realm quedó inconsistente

El realm se reconcilia con un `Job` —no con un guion que alguien corre a mano contra
Keycloak—, generado por [`Identidad.ts`](../../../infra/componentes/Identidad.ts) desde
[`despliegue/identidad/realm-kamayuk.json`](../../../despliegue/identidad/realm-kamayuk.json),
versionado y **nunca editado a mano en la consola**.

**El nombre del Job lleva una huella de lo que aplica**, `kamayuk-<amb>-realm-<huella>`, y esa
huella se deriva del `ConfigMap` entero. Eso da un diagnóstico que no toca nada: **comparar la
huella que el repositorio produciría con la que está en el clúster**.

```bash
kubectl -n kamayuk-<amb> get jobs -l componente=identidad
cd infra && yarn --silent manifiestos --ambiente <amb> --componente identidad \
  | python3 -c 'import json,sys; [print(m["kind"], m["metadata"]["name"]) for m in json.load(sys.stdin)]'
```

Medido el 2026-09-12, y las dos dicen `e2a489ad39`:

```
kamayuk-prod-realm-e2a489ad39   Complete   1/1   3m49s   11h
…
Job kamayuk-prod-realm-e2a489ad39
```

**Coinciden ⇒ lo que está aplicado es el realm versionado**, y la deriva —si la hay— es
posterior y manual. **No coinciden ⇒ un cambio versionado no llegó al clúster**, que es
literalmente el defecto por el que este Job existe.

Y ahí está el problema cuando la deriva fue manual: si el realm del repositorio **no** cambió,
el Job ya existe, `pulumi up` no lo vuelve a correr y todo sigue igual. Forzar la
reconciliación es borrar ese Job y reaplicarlo:

```bash
kubectl -n kamayuk-<amb> delete job kamayuk-<amb>-realm-<huella>
cd infra && yarn --silent manifiestos --ambiente <amb> --componente identidad \
  | kubectl apply -f -
kubectl -n kamayuk-<amb> wait --for=condition=complete job/kamayuk-<amb>-realm-<huella> --timeout=300s
```

> **`--componente identidad` ya no emite sólo lo de Keycloak, y el runbook del archivo es de
> antes de que eso fuera cierto.** Medido el 2026-09-12 con `--ambiente prod`, emite **siete**
> manifiestos: `ConfigMap`, `Deployment`, `Service` y `Job` de Keycloak en `kamayuk-prod` —los
> cuatro que se quieren— **y además** el `Namespace` `kamayuk-identidad-prod`, su `IngressRoute`
> y su `NetworkPolicy`, que son del **quinto sistema** y llevan la misma etiqueta. Aplicarlos
> no destruye nada si no han cambiado, pero un `kubectl apply -f -` ciego toca el namespace de
> otro sistema mientras se atiende una incidencia de identidad. Si sólo hace falta el Job,
> filtrar antes de aplicar.

El Job **reintenta cinco minutos** esperando a que Keycloak acepte la sesión de administración
—100 intentos de 3 s en
[`reconciliar-realm.sh`](../../../infra/componentes/identidad/reconciliar-realm.sh)—, que es el
orden normal de un despliegue y no un fallo. Y **se niega en rojo** si el mapeador de
`municipalidad_id` no queda puesto al terminar: es su comprobación 5, la que convierte este Job
en una verificación, y no es algo que este runbook tenga que comprobar aparte.

**Nunca** corregir el realm a mano en la consola de administración: la próxima reconciliación
—o el próximo `pulumi up`— lo revierte sin avisar, y es la deriva que
[ADR-0011](../../30-arquitectura/adr/ADR-0011-infraestructura-como-codigo.md) §6 ya advierte.

## Lo otro que se rompe, y no lo reporta ningún funcionario

**Keycloak caído no sólo impide entrar: para la réplica de la autorización a los cuatro
sistemas** (ADR-0039 etapa 4). Cada uno corre un `CronJob` **cada cinco minutos** que pide un
token de `client_credentials` a Keycloak antes de leer el buzón de `identidad`:

```bash
kubectl get cronjobs -A | grep consumidor-de-identidad
kubectl -n kamayuk-<sistema>-<amb> logs job/kamayuk-<sistema>-consumidor-de-identidad-<n>
```

Medido el 2026-09-12: los cuatro con `*/5 * * * *`, y su cliente es
`kamayuk-<sistema>-servicio-<ubigeo>` contra
`http://kamayuk-<amb>-identidad.kamayuk-<amb>:8080/keycloak/realms/kamayuk/protocol/openid-connect/token`.

**Y ese log separa las dos averías, que es lo que lo hace útil aquí.** Si la corrida muere
pidiendo el token (`401`), es Keycloak. Si llega a leer eventos y falla al aplicarlos —«el
evento de `permiso` nombra el acceso … y esta copia no lo conoce todavía»—, Keycloak está sano
y el problema es la copia local: otra incidencia, otro runbook.

## Cómo se comprueba que terminó bien

**No basta con «el pod está `Running`».** Estuvo `Running` todo el rato mientras el kernel lo
mataba dos veces. Las cuatro, en este orden:

**1 · Las sondas contestan.** Viven en el **puerto 9000**, el de gestión, y **con la ruta en la
raíz** porque el despliegue fija `KC_HTTP_MANAGEMENT_RELATIVE_PATH=/`:

```bash
kubectl -n kamayuk-<amb> port-forward svc/kamayuk-<amb>-identidad 19000:9000
curl -s http://127.0.0.1:19000/health/ready
```

```json
{"status": "UP","checks": []}
```

> **`/health` NO está en el 8080 y NO está publicado, y conviene saberlo antes de concluir
> nada.** Medido el 2026-09-12: `http://…:8080/health` da **404**, `…:8080/keycloak/health` da
> **404** y `https://<dominio>/keycloak/health` da **404**. Es el reparto de puertos de Keycloak
> —8080 sirve el realm bajo `/keycloak`, 9000 sirve la gestión—, no una avería. Un `curl` a la
> sonda por el puerto equivocado devuelve un 404 que se lee como «Keycloak no responde» sobre
> un Keycloak que responde perfectamente.

**2 · El descubrimiento OIDC público contesta, y con el emisor correcto.** Es lo único que
garantiza que los tokens que se emitan van a validar:

```bash
curl -s https://<dominio>/keycloak/realms/kamayuk/.well-known/openid-configuration \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["issuer"])'
curl -s -o /dev/null -w '%{http_code}\n' \
  https://<dominio>/keycloak/realms/kamayuk/protocol/openid-connect/certs
```

Medido el 2026-09-12 contra `prod`: imprime
`https://vmd206041.contaboserver.net/keycloak/realms/kamayuk`, y el JWKS **200** en 0,10 s. El
realm del ciudadano, `kamayuk-ciudadano`, también **200**. Si el emisor imprime `localhost`,
`KC_HOSTNAME_ADMIN` se puso donde iba `KC_HOSTNAME`: revertir de inmediato
([abrir la consola](abrir-la-consola-de-keycloak.md)).

**3 · Alguien nuevo inicia sesión de verdad, en un navegador, desde el dominio público** —
hasta ver el sistema, no hasta el formulario.

> **Esta comprobación NO tiene versión por `curl` en `prod`, y el runbook del archivo decía que
> sí.** Mandaba a `curl -d grant_type=password -d client_id=sgtm-backoffice`. Medido el
> 2026-09-12 contra `prod`, eso hoy es falso por dos motivos distintos:
>
> | Lo que se pide | Lo que contesta `prod` |
> |---|---|
> | `client_id=kamayuk-backoffice`, `grant_type=password` | **400** `unauthorized_client` · «Client not allowed for direct access grants» |
> | `client_id=kamayuk-verificacion` | **401** `invalid_client` — **ese cliente no existe en `prod`** |
> | `client_id=sgtm-backoffice` | **401** `invalid_client` — el nombre viejo, indistinguible del anterior |
>
> `kamayuk-backoffice` lleva `directAccessGrantsEnabled: false` en el realm versionado: el
> backoffice entra por código de autorización con PKCE, y el `password grant` está apagado a
> propósito. `kamayuk-verificacion` existe **sólo donde `keycloakSeedTestUsers` es `true`**, que
> es `stg` y no `prod` (`Pulumi.stg.yaml:105`; el `ConfigMap` del realm de `prod` aplica **un
> solo cliente**, `kamayuk-backoffice`). Las tres respuestas se parecen lo suficiente como para
> concluir que Keycloak sigue roto estando sano: **en `prod` esta comprobación es un navegador.**

**4 · Una sesión que ya estaba abierta durante la falla siguió funcionando** — confirmarlo con
quien reportó el síntoma, no suponerlo. Y confirmarlo **dentro de los 15 minutos** del
`accessTokenLifespan`: pasado ese plazo la sesión habría caído igualmente, y su caída no dice
nada sobre si la avería se arregló.

## Si no sale bien

| Síntoma | Qué hacer |
|---|---|
| El pod está `Running` pero `restartCount` sube y `lastState.terminated.reason` dice `OOMKilled` | Es [#99](https://github.com/hneyra/infrastructure/issues/99). El límite no se sube desde aquí: sale del presupuesto del nodo y `yarn capacidad --estricto` corre antes del `up` |
| Los cuatro `consumidor-de-identidad` fallan con **401** al pedir su token | Keycloak. Puede ser el OOMKill de arriba disfrazado: mirar §2 **antes** de buscar la avería en las credenciales de servicio |
| Los consumidores consiguen token y fallan **aplicando** eventos | No es Keycloak. Es la copia local de ese sistema — otra incidencia |
| El pod vuelve pero los backends dan `401` con `iss` inválido | El emisor público no coincide con el dominio que usa el navegador. Comparar `KAMAYUK_OIDC_EMISOR` del Deployment del sistema contra `kamayuk:domain` del stack. **Ojo: `KAMAYUK_OIDC_JWKS` es otra cosa** —dirección de red interna— y es normal que no se parezcan |
| Un token válido da **403 `SIN_MUNICIPALIDAD`** | El mapeador `municipalidad-id` no está en el realm reconciliado. Repetir §3; el paso 5 del guion debería haberlo puesto rojo, así que revisar también por qué no lo hizo |
| Un token válido da **403** «la cuenta … no está dada de alta en este sistema» **con la fila delante en la tabla** | No es el alta: es el inquilino. El `SET LOCAL` fijó otro `municipalidad_id` y el RLS esconde las filas. Es [#73](https://github.com/hneyra/infrastructure/issues/73) |
| El pod reinicia en bucle **tras** reconciliar el realm | El `realm-kamayuk.json` aplicado no es el del repositorio: comparar las dos huellas como en §3 |
| Nadie con sesión activa sigue funcionando, ni quien entró hace un minuto | El síntoma no es «Keycloak no responde»: algo invalidó los tokens ya emitidos (una rotación de la clave de firma, por ejemplo). Incidente distinto — no seguir con este runbook, escalar |

### Y nadie va a avisar: esto no dispara ninguna alerta

Medido el 2026-09-12 sobre
[`infra/observabilidad/alertas.yml`](../../../infra/observabilidad/alertas.yml): **ninguna regla
mira `restartCount` ni `OOMKilled`**. Las dos que podrían haber cazado el episodio de #99 no lo
cazaron, y por su propia definición:

- `PodEnCrashLoopBackOff` exige `for: 2m` en ese estado, y dos reinicios seguidos con el
  *back-off* inicial no llegan a durar tanto;
- `PodNoListo` exige `for: 10m`, y el pod estuvo sin `Ready` **2 min 10 s**.

Dónde sí se ve: el panel de reinicios de
[`resumen-operativo.json`](../../../infra/observabilidad/dashboards/resumen-operativo.json)
(`sum(increase(kube_pod_container_status_restarts_total[10m])) by (namespace, pod)`) — pero eso
hay que ir a mirarlo. Hasta que exista una alerta, **el `restartCount` del §2 es la única forma
de enterarse**, y por eso este runbook empieza por ahí y no por `get pods`.

## Estado del ensayo

**Ensayado contra el Keycloak real de `prod`** (`vmd206041`, 2026-09-12), sólo con lecturas:
los dos «identidad» del clúster y sus etiquetas; `restartCount`, `lastState.terminated` y el
log `--previous` del contenedor OOMKilled; `Recreate`/1 réplica y los tiempos de `Ready`
derivados de `status.conditions`; `kubectl top` (613Mi); las tres sondas por el 9000 y los
cuatro **404** que demuestran que no están en el 8080 ni publicadas; el descubrimiento OIDC y
el JWKS por HTTPS; que el realm `sgtm` ya no existe (**404**); la base `keycloak` y su rol; la
huella del Job comparada contra `yarn manifiestos`; los siete manifiestos que emite
`--componente identidad`; las tres respuestas del `token_endpoint`; y el log de la última
corrida de `kamayuk-rentas-consumidor-de-identidad`.

**NO ensayado, y ninguna de las tres es inocua:**

| Acción | Por qué no se ejecutó |
|---|---|
| `kubectl delete job kamayuk-<amb>-realm-<huella>` y reaplicarlo (§3) | Borra un recurso del clúster de producción y reconcilia el realm vivo. Se ensaya en `stg`, no aquí |
| `kubectl apply -f -` con la salida de `yarn manifiestos` (§3) | Escribe en el clúster, y hoy además alcanza el namespace del quinto sistema |
| Cualquier reinicio del Deployment de Keycloak | Con `Recreate` y una réplica es un corte de acceso de cerca de un minuto. No se provoca para probar un runbook |

**No ensayado tampoco, y por otro motivo:** obtener un token de servicio con la credencial de
`kamayuk-rentas-servicio-200105` para comprobar la emisión de punta a punta sin navegador. Leer
ese `Secret` es una lectura, pero usarlo es manejar una credencial de producción en una sesión
de trabajo. La evidencia equivalente está sin tocarla: **la corrida de las 08:45 del
consumidor de `rentas` leyó 4 eventos del buzón**, y para eso tuvo que conseguir su token de
Keycloak.

**Y el escenario del runbook en sí sigue sin ensayarse**: Keycloak cayendo con sesiones **ya
activas**, confirmando que sobreviven mientras el pod se repone. Requiere tráfico real en
curso. Lo que sí se midió, y es la mitad que faltaba, es **la propiedad que lo sostiene**: el
2026-09-11, mientras Keycloak era OOMKilled dos veces y no estuvo `Ready` hasta las 21:45:27,
los cuatro backends ya estaban `Ready` — `rentas` a las 21:44:07, `catastro` 21:44:09,
`normativa` 21:44:11, `caja` 21:44:25. **Entre 60 y 80 segundos antes que su emisor.** Es
`jwk-set-uri` haciendo lo suyo: el validador se construye sin descubrimiento y las claves se
piden cuando llega el primer token. Hasta hoy esto estaba «verificado en CI»; **ahora está
medido en `prod`**.

## Documentos relacionados

[Abrir la consola de administración de Keycloak](abrir-la-consola-de-keycloak.md) ·
[ADR-0005](../../30-arquitectura/adr/ADR-0005-identidad-y-acceso.md) (el claim
`municipalidad_id`) ·
[ADR-0011](../../30-arquitectura/adr/ADR-0011-infraestructura-como-codigo.md) §6 (la deriva
manual) ·
[ADR-0012](../../30-arquitectura/adr/ADR-0012-usuarios-y-grupos-declarativos.md) (las cuentas
del emisor) ·
[ADR-0028](../../30-arquitectura/adr/ADR-0028-el-tenant-no-cruza-por-http.md) §3 (el buzón que
los cuatro consumen) ·
[ADR-0039](../../30-arquitectura/adr/ADR-0039-la-identidad-es-un-sistema.md) (el quinto sistema,
que **no** es Keycloak) ·
[`despliegue/README.md`](../../../despliegue/README.md) §«La identidad» ·
[`reconciliar-realm.sh`](../../../infra/componentes/identidad/reconciliar-realm.sh) ·
[`reconciliar-identidades.sh`](../../../despliegue/identidad/reconciliar-identidades.sh) ·
[Mantenimiento del VPS](mantenimiento-del-vps.md) ·
[El disco del nodo se llenó](el-disco-del-nodo-se-lleno.md) ·
[Mudar un ambiente de nodo](../../00-gobierno/mudar-un-ambiente-de-nodo.md)
