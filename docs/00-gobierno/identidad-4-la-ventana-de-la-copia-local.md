# La ventana de la copia local de la autorizacion — runbook de la etapa 4 de ADR-0039

> **Que es esto.** Desde la etapa 4 de [`#52`](https://github.com/hneyra/infrastructure/issues/52)
> ([`identidad`#4](https://github.com/hneyra/identidad/issues/4)) la autorizacion —quien puede
> hacer que, en que municipalidad— la escribe **un solo sistema**, `identidad`, y los otros cuatro
> la **leen de una copia local** que rellenan ellos mismos, cada cinco minutos, desde su buzon.
> Este documento dice como se mueve esa copia, cuanto puede ir por detras, como se mira y que
> hacer cuando no se mueve. Es el runbook de operacion de ese mecanismo; la decision esta en
> [ADR-0039](../30-arquitectura/adr/ADR-0039-la-identidad-es-un-sistema.md) y la replica en
> [ADR-0028 §3](../30-arquitectura/adr/ADR-0028-el-tenant-no-cruza-por-http.md).
>
> Este repositorio no tiene carpeta `B0-operacion/`: se quedo en `sgtm` con el corte, aunque
> `despliegue/identidad/README.md` siga enlazando un runbook de alli. Por eso vive aqui, junto
> a los registros de gobierno, y no en una carpeta nueva con un solo archivo.

## 1. El mecanismo, de punta a punta

```
identidad                                cada satelite (rentas, catastro, normativa, caja)
─────────                                ────────────────────────────────────────────────
escritura de administracion              CronJob  kamayuk-<s>-consumidor-de-identidad
  └─ misma transaccion ──► identidad_evento        `*/5 * * * *`, concurrencyPolicy: Forbid
                                 │                 backoffLimit: 1, perfil `batch`
                                 │                    │
GET /identidad/api/v1/eventos/pendientes ◄────────────┘  (token de servicio, `azp` =
   ordenados por id, sin los ya acusados                   kamayuk-<s>-servicio-<ubigeo>)
   POR ESE consumidor                                 │
                                 │                    ▼
                                 │            por cada evento: SET LOCAL + una transaccion
                                 │            (REQUIRES_NEW) sobre usuario/grupo/miembro/permiso
                                 │                    │ commit
POST /identidad/api/v1/eventos/acuses ◄───────────────┘  el acuse va DESPUES del commit
   identidad_evento_acuse (municipalidad, consumidor, evento)
```

Cuatro propiedades que hacen que esto sea una copia y no un cache:

1. **El evento nace en la misma transaccion que la escritura** (`identidad` etapa 2, AC-2): si la
   fila esta, el evento esta. No hay «se guardo y no se aviso».
2. **El buzon se SIRVE, no se empuja**: `identidad` no conoce a los cuatro ni tiene credencial
   hacia ellos. Su grafo de egreso sigue vacio (`yarn grafo --ambiente stg`), y las cuatro aristas
   nuevas son de los consumidores hacia el.
3. **El acuse es por consumidor** (`identidad` etapa 3): que `caja` haya acusado no retira nada
   para `rentas`. Cada uno lleva su propia cola.
4. **El acuse va despues del commit**: un evento cuya aplicacion se deshace no se acusa y se
   vuelve a servir en la vuelta siguiente. Lo que no se puede aplicar **nunca** se aparta a
   `identidad_evento_muerto` con su motivo, se acusa —para no atascar la cola— y se avisa al
   responsable (`KAMAYUK_IDENTIDAD_RESPONSABLE` / `_CANAL`, ADR-0026 §4).

## 2. La ventana: cuanto puede ir por detras la copia

**Peor caso teorico: cinco minutos mas la duracion de una pasada.** Un permiso concedido en
`identidad` un instante despues de que el consumidor pregunto se sirve en la siguiente vuelta,
que llega como mucho cinco minutos despues, y esta en `permiso` del satelite cuando esa pasada
termina. Con `concurrencyPolicy: Forbid`, si una pasada dura mas que la ventana la vuelta que
coincide **se salta** (no se encola): el peor caso pasa a ser dos ventanas. Hoy eso no ocurre —
una pasada son decenas de eventos como mucho— y el dia que ocurra el sintoma es un `CronJob` con
`LAST SCHEDULE` mas viejo que cinco minutos, que es la primera comprobacion del §4.

**Y mientras dura la ventana, los cinco pueden contestar distinto a la misma pregunta.** Es lo
que ADR-0039 §«Lo que cuesta» punto 2 exige que este **medido y escrito, no supuesto**:

| Que | Cifra |
|---|---|
| Periodo del `CronJob` | 5 min (`*/5 * * * *`, los cuatro) |
| Duracion de una pasada | _**PENDIENTE DE MEDIR — AC-5 de `identidad`#4, lo mide el integrador con los cinco levantados**_ |
| Peor caso medido: de conceder en `identidad` a verse en `permiso` del satelite | _**PENDIENTE DE MEDIR — AC-5**_ |
| Lo que un funcionario NUEVO ve entre el alta en `identidad` y la primera pasada | 403 «no estas dado de alta aqui» en cada satelite, y despues 200 (AC-6, tambien del integrador) |

Cuando el integrador escriba la cifra, la fila del registro de `CLAUDE.md` de este repositorio
y la de `identidad` tienen que decir lo mismo.

**Lo que NO es la ventana**: no es una decision de negocio a discutir sino un coste medido. Una
revocacion que tarde un dia seria un descuido con nombre; cinco minutos es lo que cuesta no tener
a `identidad` en el camino caliente de ninguna autorizacion, que es lo que deja cobrar en
ventanilla con `rentas` apagado.

## 3. Lo que sujeta al consumidor, en tres mitades

Un consumidor que no corre **no da ningun error**: el satelite arranca, contesta, y autoriza con
la copia de ayer. Por eso hay tres guardas estaticas en `yarn verificar`, y cualquiera sola lo
apaga en silencio (es lo que paso con el ingestor de `catastro` en C-8 y #21):

| Mitad | Guarda | Que rojo da |
|---|---|---|
| El `CronJob` **existe** en el manifiesto de `stg` y de `prod` | `consumidor-de-identidad.test.ts` | «`<sistema>` no declara en `<amb>` ningun CronJob que hable con `kamayuk-identidad-<amb>`» |
| **No nace `suspend: true`** | la misma | «el CronJob `<nombre>` nace `suspend: true`» |
| **Su credencial tiene su cuenta** en las dos municipalidades | la misma, y `identidad-de-servicio.test.ts` en las dos direcciones | «`<n>` municipalidad(es) no declaran esa cuenta de servicio: `<ubigeo>` … Remedio: anadir `{"sistema":…,"llamaA":"identidad"}` al bloque `servicios`» |

Un consumidor se reconoce **por su forma y no por su nombre**: un `CronJob` de un sistema que no
es `identidad` con una variable cuyo valor es una direccion al namespace `kamayuk-identidad-<amb>`
(`KAMAYUK_IDENTIDAD_URL`, compuesta con `namespaceDe("identidad")`), y su credencial por el
`secretKeyRef` a `kamayuk-<sistema>-<amb>-identidad` (`e.secretoDe("identidad")`). La lista de
consumidores se **deriva** —`SISTEMAS_DEL_PRODUCTO` menos `identidad`—, asi que un sexto sistema
nace aqui en rojo hasta que declare el suyo.

## 4. Como se mira, en un ambiente desplegado

```bash
AMB=stg
for s in rentas catastro normativa caja; do
  kubectl -n kamayuk-$s-$AMB get cronjob kamayuk-$s-consumidor-de-identidad \
    -o custom-columns=NOMBRE:.metadata.name,SUSPEND:.spec.suspend,ULTIMA:.status.lastScheduleTime,OK:.status.lastSuccessfulTime
done
```

- `SUSPEND` tiene que ser `<none>` o `false`. `true` es la segunda mitad rota **en el cluster**,
  que una guarda estatica no ve (alguien hizo `kubectl patch`).
- `ULTIMA` mas vieja que cinco minutos: el controlador no lo esta lanzando (`Forbid` con una
  pasada atascada, o el `CronJob` suspendido).
- `OK` mas vieja que `ULTIMA` de forma sostenida: las pasadas fallan. Sigue con los registros:

```bash
kubectl -n kamayuk-$s-$AMB logs job/$(kubectl -n kamayuk-$s-$AMB get jobs \
  -l app=kamayuk-$s-consumidor-de-identidad --sort-by=.metadata.creationTimestamp \
  -o jsonpath='{.items[-1].metadata.name}')
```

Lo que un registro sano dice es el resultado de cada vuelta —cuantos eventos trajo, cuantos
aplico, cuantos aparto— y que paro por «sin progreso» y no por agotar las vueltas (la forma
exacta la escribe `CorrerElConsumidorDeIdentidad` de cada satelite; es de su repositorio). Un
**401** en la primera llamada es la tercera mitad rota: la clave del `Secret` del namespace del
satelite no es la que el `Job` de identidad le fijo al cliente (§5), o la cuenta no existe en el
realm.

Del lado de `identidad`, la cola de cada consumidor:

```sql
-- en la base identidad, como kamayuk_readonly y con SET LOCAL app.municipalidad_id puesto:
-- lo pendiente POR CONSUMIDOR, que es como lo sirve `pendientesPara` (V3: el consumidor va
-- DENTRO de la clave del acuse, y el evento se identifica por su `evento_id`).
SELECT c.consumidor, count(*) AS pendientes
FROM identidad_evento ev
CROSS JOIN (VALUES ('rentas'), ('catastro'), ('normativa'), ('caja')) AS c (consumidor)
LEFT JOIN identidad_evento_acuse a
  ON a.municipalidad_id = ev.municipalidad_id
 AND a.evento_id = ev.evento_id
 AND a.consumidor = c.consumidor
WHERE a.evento_id IS NULL
GROUP BY c.consumidor;
```

Cero filas por consumidor es «al dia». Una cola que crece en uno y no en los otros tres es ESE
consumidor parado; una que crece en los cuatro es `identidad` sirviendo mal (o nadie corriendo).

Y del lado del satelite, lo apartado:

```sql
SELECT tipo, sujeto_id, motivo, apartado_en
FROM identidad_evento_muerto ORDER BY apartado_en DESC LIMIT 20;
```

Una fila ahi es un evento que **no se va a aplicar nunca** y que ya se acuso: la copia local esta
desatrasada a proposito para no atascar la cola, y alguien tiene que leer el motivo. El aviso al
responsable ya salio por el canal de ADR-0026 §4.

## 5. Las cuatro cuentas de servicio, y la clave que las sirve

Las cuentas —`kamayuk-<sistema>-servicio-<ubigeo>`, una por (sistema, municipalidad) por ADR-0028
§2— se declaran en `despliegue/identidad/municipalidades/<ubigeo>.json` (bloque `servicios`, con
`"llamaA": "identidad"`) y **las crea `reconciliar-identidades.sh servicios`**, que corre en el
`Job` de identidad de la plataforma tras aplicar el realm. Como se declaran y que las sujeta esta
en [`despliegue/identidad/README.md` §«Las cuentas de servicio»](../../despliegue/identidad/README.md).

**Y la etapa 4 destapo un defecto de #21 que hubo que cerrar antes de declarar la primera.** El
cliente de Keycloak es uno por (sistema, ubigeo) y tiene **una** clave; `#21 AC-2` guardaba la
clave por (sistema, **destino**, ubigeo) —`rentas-a-catastro-200105`— y el guion la fijaba una vez
por cuenta declarada. Con el segundo destino de `rentas` fijaba `rentas-a-identidad-200105`
encima de `rentas-a-catastro-200105` —medido con un `kcadm` de mentira: dos `update … secret=`
con valores distintos sobre el mismo cliente— y su propia comprobacion final lo cazaba, «su clave
no es la del Secret … el destino contestara 401», `exit 1`: el `Job` de identidad **fallaba en
cada corrida** y el despliegue no terminaba. Desde esta etapa la clave es **por cliente**
(`claveDeServicio(sistema, ubigeo)` → `rentas-200105`) y las dos credenciales de `rentas` son
espejo de la misma. Lo que cuesta en un cluster ya desplegado: el `Secret`
`kamayuk-<amb>-servicios-de-identidad` gana las claves nuevas y conserva las viejas como basura;
`bootstrap-secretos.sh` genera las que faltan, el `Job` de identidad fija la nueva en cada cliente
y los espejos la copian, asi que tras un `pulumi up` completo los cuatro vuelven a coincidir.

## 6. Lo que este runbook NO cubre

- **AC-5 y AC-6** —la ventana medida y el 403→200 de un funcionario nuevo— los mide el integrador
  con las cinco aplicaciones levantadas; aqui hay un hueco marcado y no una cifra supuesta.
- **Que hace cada satelite con un evento que no sabe aplicar** es de su repositorio
  (`AplicarUnEventoDeIdentidad`, AC-1 de `identidad`#4).
- **`rentas` deja de administrar** en esta misma etapa (AC-4): mientras su PR no aterrice hay
  dos sitios que escriben la autorizacion, y la regla 12 de `comun-verificaciones` lo dice en
  cada corrida de su `verificarArquitectura`.
