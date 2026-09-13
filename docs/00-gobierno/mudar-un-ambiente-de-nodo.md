# Mudar un ambiente de nodo, y el paso que el runbook no tenía

**Escrito el 2026-09-11, después de que la mudanza de `prod` a `vmd206041` fallara en el primer
`pulumi up`. Corregido el 2026-09-13 con la mudanza de `stg` a `vmd205066`
([#145](https://github.com/hneyra/infrastructure/issues/145)), que falló en dos sitios que este
documento daba por cubiertos** — el paso 5 y una precondición que no tenía. No sustituye a `reconstruir-el-vps-desde-cero.md` —que vive en el repositorio
archivo `sgtm` y cubre perder el nodo entero—: añade el paso que a aquél le falta, y que es el
que rompió esto.

## El defecto, medido

`prod` cambió de nodo con [#92](https://github.com/hneyra/infrastructure/pull/92) y
[#1](https://github.com/hneyra/infrastructure/issues/1). Su primer `pulumi up` murió con **74
recursos errados** en el refresco, todos llamados `sgtm-prod-*`:

```
kubernetes:helm.cattle.io/v1:HelmChartConfig sgtm-prod-sistema:kube-system/traefik refreshing
error: failed to read resource state due to unreachable cluster. If the cluster was deleted,
you can remove this resource from Pulumi state by rerunning the operation with the
PULUMI_K8S_DELETE_UNREACHABLE environment variable set to "true"
```

**Y no era la red ni el kubeconfig.** En la misma corrida, dos pasos antes:

```
Nodo real de «prod»: 5 CPU / 10145128Ki asignables.
El stack declara:            5 CPU / 10145128Ki.
Correcto: lo declarado no supera lo que el nodo reparte.
cabe
```

Así que el túnel, los secretos y el nodo nuevo estaban bien. Lo que falla es otra cosa.

## El mismo defecto se presenta con DOS mensajes, y conviene saber cuál es cuál

En `stg`, el 2026-09-13, el error fue otro:

```
warning: configured Kubernetes cluster is unreachable: unable to load schema information
from the API server: Get "https://127.0.0.1:6443/openapi/v2?timeout=32s":
tls: failed to verify certificate: x509: certificate signed by unknown authority
...
141 errored
```

| lo que se lee | lo que significa |
|---|---|
| `context deadline exceeded` | **nadie contesta** al otro lado del túnel: el nodo, el puerto o el SSH |
| `x509: certificate signed by unknown authority` | **el túnel llega a un clúster vivo**, y la CA que lo rechaza es la del kubeconfig que Pulumi tiene **grabado en el estado** |

El segundo es el bueno: dice que el túnel y el nodo están bien. Y **no se distingue mirando los
secretos** —sus valores no se pueden leer—, pero sí sus fechas: en `stg`, `VPS_HOST` y
`KUBECONFIG` del *environment* se habían actualizado a las 11:58 y las 12:00, y la corrida
falló a las 12:13. El kubeconfig que CI le pasaba a Pulumi era el nuevo; la CA que rechazaba el
certificado salía del estado.

## La causa

**El estado de Pulumi de `prod` estaba congelado en la forma pre-renombrado.** `prod` no
aplicaba nada desde el 2026-08-23 —la brecha de capacidad de #1 hacía que `aplicar-prod`
omitiera el `up`—, o sea desde **antes** de que `sgtm` saliera del código. Su estado describía
36 objetos `sgtm-prod-*` que nunca se retiraron, y su proveedor —`sgtm-prod-kubernetes`— lleva
dentro **el kubeconfig del nodo viejo**.

Con `refresh: true`, que es correcto y está ahí por otra cicatriz, Pulumi intenta leer cada uno
de esos objetos contra un clúster al que el stack ya no apunta. No los encuentra y no puede
decidir solo si desaparecieron o si no llegó a ellos.

**Y lo del estado congelado era un agravante, no la causa** — eso lo midió `stg` el
2026-09-13. Este documento decía que `stg` «no tiene este problema» porque su estado sí estaba
al día; lo tuvo igual, con **141 recursos errados**. La causa que se generaliza es más simple y
no depende de hace cuánto se aplicó:

> **El proveedor grabado en el estado lleva dentro el kubeconfig del nodo contra el que se
> aplicó la última vez.** `pulumi config set kubeconfig` en la corrida escribe el del nodo
> nuevo, y eso sirve para lo que se va a CREAR; lo que se va a LEER se lee con el de antes.

Por eso pasa en toda mudanza de nodo, con el estado al día o congelado, y por eso el paso 5 no
es opcional.

## El paso que falta, y lo que cuesta

El remedio lo nombra el propio error: `PULUMI_K8S_DELETE_UNREACHABLE=true`.

**⚠ Pero esa variable no «limpia recursos de un clúster que ya no existe»: suelta del estado los
que el proveedor no pudo LEER.** Y eso no es lo mismo. En esta mudanza el nodo viejo **seguía en
pie** —medido: `vmd120205` respondía en su 80 y en su 443 con nuestro propio Traefik—, así que
los 36 objetos quedan **huérfanos: vivos y sin nadie que los gestione**, hasta que alguien
apague la máquina.

Es aceptable cuando el nodo se retira, y es una decisión que alguien tiene que tomar. No es un
efecto colateral.

**Por eso no es una línea fija del flujo.** Fija, cualquier fallo transitorio del túnel soltaría
estado **en silencio**, y el síntoma no sería un error: sería un `up` en verde que deja de
gestionar lo que gestionaba. Cuelga de una entrada de `workflow_dispatch` que hay que marcar a
mano, y `infra/verificaciones/nada-suelta-el-estado-en-silencio.test.ts` se pone rojo si alguien
la desengancha, si la entrada nace marcada, o si su descripción deja de avisar.

## El procedimiento

1. **Antes de nada**, comprobar que el ambiente viejo no guarda nada que haga falta. En esta
   mudanza la base estaba vacía —`contribuyente`, `predio`, `recibo` y los asientos en 0—, y
   eso es lo que hizo que `clave-cifrado` dejara de ser urgente: protegería respaldos de una
   base sin filas. Si hay datos, esto es otro procedimiento y empieza por
   `restaurar-a-un-punto-en-el-tiempo.md`.
2. Aprovisionar el nodo nuevo, `cortafuegos.sh`, `reservar-recursos-del-nodo.sh`, medir, y
   escribir lo medido en `Pulumi.<ambiente>.yaml`. **En ese orden**: declarar más de lo que el
   nodo reparte detiene el despliegue en «Lo declarado cabe en el nodo real», y ese paso corre
   sin la condición de la brecha.
   - **Medir es `kubectl`, no aritmética.** En `stg` la cifra vieja —`6 / 12247552Ki`— era la de
     un k3d: un contenedor sin reserva ve la máquina entera y declara como asignable memoria que
     el kubelet nunca reparte. La del nodo nuevo, con la reserva puesta, es `5 / 10145116Ki`.
   - **Y lo que caza el exceso NO es `yarn capacidad`**, medido el 2026-09-13: declarar un nodo
     más grande hace que el stack quepa *mejor*, así que sale `cabe` y en verde. Quien lo caza
     es `infra/vps/comprobar-lo-asignable.sh --ambiente <amb>`, que lee el nodo **real**.
3. **Comprobar que k3s trae su Traefik, ANTES del primer `up`.** Es la precondición que a este
   documento le faltaba, y costó la mudanza de `stg`: aquel nodo tenía
   `disable: [traefik]` en `/etc/rancher/k3s/config.yaml`, así que `kube-system` sólo llevaba
   `coredns`, `local-path-provisioner` y `metrics-server`, no había ningún `HelmChart`, y **nadie
   escuchaba en el 80 ni en el 443**.
   El descriptor asume lo contrario con todas las letras (`infra/componentes/Ingreso.ts:15`):
   «*k3s trae Traefik desplegado por su propio `HelmChart`. Lo que hace `HelmChartConfig` es
   pasarle valores a **ése***». Sin él **no existen los CRDs `traefik.io/v1alpha1`**, así que
   los seis `IngressRoute`, los `Middleware` y el `TLSOption` fallan al aplicarse, el
   `HelmChartConfig` no parchea nada, ACME no tiene quién contesta su desafío HTTP-01 y el
   objetivo `traefik-metrics` de Prometheus nunca llega a existir.
   ```bash
   kubectl get helmchart -A                        # tiene que salir `traefik` en kube-system
   kubectl get crd | grep -E 'ingressroutes|middlewares|tlsoptions'   # los tres que se usan
   kubectl -n kube-system get svc traefik          # LoadBalancer con EXTERNAL-IP, 80 y 443
   curl -s -o /dev/null -w '%{http_code}\n' http://<ip-del-nodo>:80/   # 404 = arriba y sin rutas
   sudo ls /var/lib/rancher/k3s/server/manifests/  # si queda `traefik.yaml.skip`, borrarlo
   ```
   ⚠ **`ss -ltn` NO sirve para esto, y decirlo ahorra un susto.** Medido el 2026-09-13: con
   Traefik arriba y sirviendo, `ss -ltn | grep -E ':(80|443) '` sale **vacío**. Los publica
   `svclb-traefik` con `hostPort`, que el complemento *portmap* del CNI implementa con **DNAT de
   iptables y no con un socket en el anfitrión**. Un operador que compruebe con `ss` concluye
   que Traefik está roto cuando está bien. Lo que mide de verdad es un `curl` contra el puerto:
   **404 es la respuesta buena** —Traefik contesta y todavía no hay ninguna ruta—; lo que dice
   que no está es `connection refused`.
4. **Los secretos del *environment*, y no son los mismos en los dos ambientes.** `prod` tiene
   **dos** —`prod` y `prod-preview`—; `stg` tiene **uno**. Son seis: `VPS_HOST`, `VPS_USER`,
   `SSH_PRIVATE_KEY`, `KUBECONFIG`, `BACKUP_ACCESS_KEY_ID` y `BACKUP_SECRET_ACCESS_KEY`.
   - **El `KUBECONFIG` se regenera entero**, no se le edita el `server:`: la CA del nodo nuevo
     es otra, y ésa es exactamente la del `x509` de arriba.
     `sudo sed 's#https://127.0.0.1:6443#https://localhost:6443#' /etc/rancher/k3s/k3s.yaml`.
     `0.0.0.0` **no** vale: la lista blanca es `localhost`/`127.0.0.1`/`[::1]` (`infra/config.ts`).
   - ⚠ **Un secreto del *environment* TAPA al del repositorio con el mismo nombre.** Medido en
     `stg` el 2026-09-13: `SSH_PRIVATE_KEY` se actualizó a nivel de repositorio a las 12:06:21Z
     y la corrida siguió usando el del *environment*, de ocho días antes. Poner el valor nuevo
     «en el repositorio» no rota nada si el *environment* tiene el suyo.
5. **Un contenedor de respaldo NUEVO, y declararlo antes del primer `up`.** Es el paso que a
   este procedimiento le faltaba, y costó [#112](https://github.com/hneyra/infrastructure/issues/112):
   **un catálogo de wal-g es de un CLÚSTER, no de un ambiente.** El clúster nuevo empieza a
   archivar en cuanto el paso 5 lo levanta, y si el destino sigue siendo el catálogo del viejo
   no da error — da silencio. Medido el 2026-09-12, una semana después de la mudanza de `prod`:
   `backup-push` salía 0 sin dejar nada, la tabla `respaldo` decía `EXITOSO`, y los siete
   respaldos que había eran del clúster anterior con su WAL **ya sobrescrito** por el nuevo.
   No había con qué restaurar, en ninguno de los dos ambientes.
   - Crear el contenedor en el proveedor —a mano: no hay recurso de Pulumi ni paso de CI que lo
     haga— y comprobar que la credencial del respaldo **puede escribir en él**. Que pueda
     listarlo no lo prueba: la política concede `ListBucket` en general.
   - Poner su nombre en `kamayuk:backupBucket` de `Pulumi.<ambiente>.yaml`. **Y ya está**: hasta
     #121 había que copiarlo además en `kamayuk:restoreSourceBucket` de `Pulumi.stg.yaml`, y esa
     clave se retiró porque no la leía nadie
     ([el ensayo cruzado no existe](el-ensayo-cruzado-no-existe.md)).
   - **El contenedor viejo no se toca.** Se queda donde está, con su clave de cifrado.
   - **Un prefijo vale igual que un contenedor**: `kamayuk:backupBucket: <bucket>/<prefijo>` da
     `WALG_S3_PREFIX=s3://<bucket>/<prefijo>`, un catálogo aparte para wal-g, sin tocar AWS. Que
     el prefijo nombre el **nodo**, porque el catálogo es del clúster.
   - ⚠ **«Vacío» no se comprueba listando a ojo.** Medido en `stg` el 2026-09-13: el contenedor
     se reusó porque «se comprobó vacío», y tenía dos respaldos base del k3d anterior. El clúster
     nuevo archivó WAL encima dos horas, hasta que el primer respaldo base lo paró: «*este
     catalogo tiene respaldos de OTRO cluster*». Ese respaldo —el paso 8— es la única
     comprobación que compara `SystemIdentifier`, así que **la mudanza no está hecha hasta que
     sale verde**.
6. **Lanzar `Infraestructura` a mano** (`workflow_dispatch`) con
   **`soltar_recursos_inalcanzables` marcado**. Es la corrida de la mudanza, y la única que debe
   llevarlo.
   - ⚠ **Antes, comprobar que el trabajo de ESE ambiente lleva la variable cableada.** Marcar la
     casilla no hace nada si `PULUMI_K8S_DELETE_UNREACHABLE` no cuelga del `pulumi up` de su
     `aplicar-<ambiente>`. Hasta el 2026-09-13 sólo la tenía `aplicar-prod` —`stg` no había
     mudado nunca—, así que este paso **no se podía dar para `stg`** y este documento decía que
     el procedimiento le servía igual.
     `grep -n PULUMI_K8S_DELETE_UNREACHABLE .github/workflows/infra.yml` tiene que devolver una
     línea de código por cada ambiente que pueda mudar.
   - Y **`pulumi preview` del PR seguirá en rojo hasta que esta corrida pase**: corre sólo en
     `pull_request` y no tiene —ni debe tener— esta vía de escape. Un `preview` que suelta
     estado deja de ser una previsualización. El PR de la mudanza se integra con ese check rojo.
   - **Si hay pods en `ImagePullBackOff` con `failed to fetch anonymous token`, bórralos.**
     Medido en `stg` el 2026-09-13 ([#166](https://github.com/hneyra/infrastructure/issues/166)):
     en un clúster **vacío** los pods se crean antes de que Pulumi parchee la `ServiceAccount`
     `default` con el secreto del registro —allí, 14:24:15Z contra 14:26:52Z—, y ese secreto se
     inyecta **sólo al crear el pod**. Los sistemas con paquete público no lo notan; el que lo
     tenga privado —`identidad`— no baja su imagen, y detrás caen las implantaciones de los
     demás con `No se pudo leer el buzon de identidad`.
     `kubectl -n kamayuk-identidad-<amb> delete pod --all` y comprobar que los recreados llevan
     `spec.imagePullSecrets`. Los `Job` de implantación de los otros se recuperan solos en su
     siguiente reintento.
7. Comprobar que la corrida siguiente, **sin** marcarlo, sale verde. Si no, el estado no quedó
   limpio y hay que mirarlo antes de seguir — no volver a marcarlo por costumbre.
8. **Lanzar el respaldo a mano, sin esperar al `CronJob`**, y leer su salida:
   `kubectl -n kamayuk-<amb> create job --from=cronjob/kamayuk-<amb>-respaldo respaldo-mudanza`.
   Hasta que ese respaldo base aterrice, el contenedor nuevo tiene WAL y **ningún punto de
   restauración**: el ambiente pasa de «0 respaldos restaurables» a «0 respaldos restaurables»,
   y eso no se arregla solo. Desde #112 el `Job` **falla** si el respaldo no llega al catálogo,
   así que si sale en verde es que está.
   - Y mirar `pg_stat_archiver` en cuanto el motor vuelva: si la credencial no alcanza el
     contenedor nuevo, `archive_command` empieza a fallar, PostgreSQL **retiene el WAL en el
     disco del nodo** y el primer síntoma es el disco llenándose, horas después.
9. Mover el DNS y esperar el certificado. ACME resuelve el desafío HTTP-01 por el 80, así que el
   nombre tiene que apuntar al nodo nuevo antes.
   - **Si se sirve `TRAEFIK DEFAULT CERT` o uno `(STAGING)`, no esperar a que se arregle solo.**
     El primero es que aún no hay ruta ni certificado. El segundo, si el ambiente pasó de la CA
     de pruebas a la real, **no se va**: Traefik guarda el certificado en `/data/acme.json`
     —volumen persistente— y lo sigue sirviendo hasta que toque renovarlo, meses después.
     Medido en `stg` el 2026-09-13; el remedio está junto a `kamayuk:acmeStaging` en
     `Pulumi.stg.yaml`. Se comprueba con `curl` **sin** `-k`: `ssl_verify=0`.

10. **Apagar el nodo viejo**, que es lo que convierte a los huérfanos en nada. Mientras siga
   encendido hay dos clústeres sirviendo el mismo producto, y solo uno está gestionado.

## Lo que este documento no resuelve

- ~~**Los diez runbooks siguen en el repositorio archivo `sgtm`, y están pre-renombrado**~~ —
  **cerrado el 2026-09-12**: los diez se trajeron a `docs/B0-operacion/runbooks/` y se
  remidieron uno a uno contra `prod` ([#100](https://github.com/hneyra/infrastructure/issues/100),
  [#102](https://github.com/hneyra/infrastructure/issues/102)). Remedirlos no fue renombrar:
  cada uno traía afirmaciones que sólo caen al ejecutarlas — un código HTTP que ya no es, una
  base y un rol que cambiaron, una alerta que no puede dispararse. El que continúa a este
  documento es [Reconstruir el VPS desde cero](../B0-operacion/runbooks/reconstruir-el-vps-desde-cero.md).
- ~~**La asimetría con `stg` no se toca**: su estado sí está al día, así que no tiene este
  problema. El día que `stg` cambie de nodo, lo tendrá, y este procedimiento le sirve igual.~~ —
  **falso por partida doble, medido el 2026-09-13.** (a) `stg` tuvo el problema **con el estado
  al día**: 141 recursos errados. Que el estado estuviera fresco no importaba, porque lo que
  lleva el kubeconfig viejo es el proveedor, no la antigüedad de las entradas. (b) El
  procedimiento **no le servía igual**: su paso del disparo no se podía ejecutar, porque la
  variable sólo estaba cableada en `aplicar-prod`. Las dos cosas están corregidas arriba. Se
  deja tachado y no borrado: es lo que se creyó, y saber que se creyó eso es lo que explica por
  qué el paso faltaba.
- **Las precondiciones del nodo no se comprueban solas.** Que k3s traiga su Traefik, que la
  reserva esté puesta y que el DNS apunte al nodo nuevo son tres cosas que hoy se miran a mano,
  con los comandos de los pasos 2 y 3. Ninguna guarda del repositorio las ve: `pulumi up` las
  descubre fallando.
