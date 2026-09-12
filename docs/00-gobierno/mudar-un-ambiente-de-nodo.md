# Mudar un ambiente de nodo, y el paso que el runbook no tenía

**Escrito el 2026-09-11, después de que la mudanza de `prod` a `vmd206041` fallara en el primer
`pulumi up`.** No sustituye a `reconstruir-el-vps-desde-cero.md` —que vive en el repositorio
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

## La causa

**El estado de Pulumi de `prod` estaba congelado en la forma pre-renombrado.** `prod` no
aplicaba nada desde el 2026-08-23 —la brecha de capacidad de #1 hacía que `aplicar-prod`
omitiera el `up`—, o sea desde **antes** de que `sgtm` saliera del código. Su estado describía
36 objetos `sgtm-prod-*` que nunca se retiraron, y su proveedor —`sgtm-prod-kubernetes`— lleva
dentro **el kubeconfig del nodo viejo**.

Con `refresh: true`, que es correcto y está ahí por otra cicatriz, Pulumi intenta leer cada uno
de esos objetos contra un clúster al que el stack ya no apunta. No los encuentra y no puede
decidir solo si desaparecieron o si no llegó a ellos.

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
3. Los cuatro secretos del *environment*, **y en los dos**: `prod` y `prod-preview`.
4. **Un contenedor de respaldo NUEVO, y declararlo antes del primer `up`.** Es el paso que a
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
5. **Lanzar `Infraestructura` a mano** (`workflow_dispatch`) con
   **`soltar_recursos_inalcanzables` marcado**. Es la corrida de la mudanza, y la única que debe
   llevarlo.
6. Comprobar que la corrida siguiente, **sin** marcarlo, sale verde. Si no, el estado no quedó
   limpio y hay que mirarlo antes de seguir — no volver a marcarlo por costumbre.
7. **Lanzar el respaldo a mano, sin esperar al `CronJob`**, y leer su salida:
   `kubectl -n kamayuk-<amb> create job --from=cronjob/kamayuk-<amb>-respaldo respaldo-mudanza`.
   Hasta que ese respaldo base aterrice, el contenedor nuevo tiene WAL y **ningún punto de
   restauración**: el ambiente pasa de «0 respaldos restaurables» a «0 respaldos restaurables»,
   y eso no se arregla solo. Desde #112 el `Job` **falla** si el respaldo no llega al catálogo,
   así que si sale en verde es que está.
   - Y mirar `pg_stat_archiver` en cuanto el motor vuelva: si la credencial no alcanza el
     contenedor nuevo, `archive_command` empieza a fallar, PostgreSQL **retiene el WAL en el
     disco del nodo** y el primer síntoma es el disco llenándose, horas después.
8. Mover el DNS y esperar el certificado. ACME resuelve el desafío HTTP-01 por el 80, así que el
   nombre tiene que apuntar al nodo nuevo antes.
9. **Apagar el nodo viejo**, que es lo que convierte a los huérfanos en nada. Mientras siga
   encendido hay dos clústeres sirviendo el mismo producto, y solo uno está gestionado.

## Lo que este documento no resuelve

- ~~**Los diez runbooks siguen en el repositorio archivo `sgtm`, y están pre-renombrado**~~ —
  **cerrado el 2026-09-12**: los diez se trajeron a `docs/B0-operacion/runbooks/` y se
  remidieron uno a uno contra `prod` ([#100](https://github.com/hneyra/infrastructure/issues/100),
  [#102](https://github.com/hneyra/infrastructure/issues/102)). Remedirlos no fue renombrar:
  cada uno traía afirmaciones que sólo caen al ejecutarlas — un código HTTP que ya no es, una
  base y un rol que cambiaron, una alerta que no puede dispararse. El que continúa a este
  documento es [Reconstruir el VPS desde cero](../B0-operacion/runbooks/reconstruir-el-vps-desde-cero.md).
- **La asimetría con `stg` no se toca**: su estado sí está al día, así que no tiene este
  problema. El día que `stg` cambie de nodo, lo tendrá, y este procedimiento le sirve igual.
