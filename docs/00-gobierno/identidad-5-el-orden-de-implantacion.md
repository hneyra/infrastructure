# Etapa 5 de ADR-0039 — el orden de implantación: `identidad` primero

Desde la etapa 5, **implantar una municipalidad tiene un orden**, y no lo tenía antes. Este
documento dice cuál es, qué pasa si se hace al revés, y cómo se sale de ahí.

## Por qué hay un orden

Hasta la etapa 4, cada satélite —`rentas`, `catastro`, `normativa`, `caja`— sembraba en su propia
base el primer administrador con `SembradorDeLaCopiaLocal`. Esa clase era **el segundo origen de la
misma tabla**, y por eso la etapa 5 la retira: lo que queda es `SembradorDelCatalogo`, que sólo
escribe `modulo_sistema` y `acceso`. La autorización —`usuario`, `grupo`, `miembro`, `permiso`— la
escribe **sólo el consumidor**, con lo que `identidad` publica en su buzón (ADR-0039, regla 12).

Consecuencia directa: **una implantación de un satélite cuyo consumidor no traiga nada deja la base
sin una sola cuenta**. La municipalidad queda dada de alta, con su catálogo sembrado, y nadie puede
entrar — ni siquiera quien acaba de implantarla.

Por eso los cuatro **fallan diciéndolo** en vez de terminar en verde. Un `Job` en `Complete` sobre
una base donde nadie puede entrar es el `Job` roto de C-18 con otra cara.

## El orden

1. **`identidad`**: migrar e implantar. Ahí nace el administrador, su grupo, su afiliación y sus
   permisos, y cada escritura emite su hecho en el buzón (etapa 2).
2. **Los cuatro satélites**, en cualquier orden entre ellos. Cada implantación termina con una
   pasada del consumidor, que trae lo que `identidad` ya publicó (etapa 4) — de modo que el
   administrador está en la copia local **antes de la primera petición**.

Entre los cuatro no hay orden: ninguno depende de otro. Lo comprueba
`infra/verificaciones/orden-de-implantacion.test.ts`, derivado de los manifiestos: `identidad` no
nombra el espacio de nombres de ningún hermano, y exactamente los cuatro nombran el suyo.

## Lo que pasa si se hace al revés

El satélite falla con uno de tres mensajes, que se distinguen porque **se arreglan de tres maneras**:

| lo que pasa | qué falta |
|---|---|
| el despliegue no configuró el consumidor | `KAMAYUK_IDENTIDAD_URL`, `_TOKEN`, `_CLIENTE`, `_CREDENCIAL` |
| `identidad` no contesta | levantar `identidad`, o su credencial de servicio |
| contesta y no publica nada de esa municipalidad | **el orden**: implantarla en `identidad` primero |

Los tres llevan el mismo remedio dentro: implantar `identidad` primero y **repetir** la implantación
del satélite, que es idempotente.

## EL CASO QUE HAY QUE CONOCER: un ambiente de cero

**El orden no lo declara ningún manifiesto.** Los once `Job` del ambiente los crea un solo
`ConfigGroup` sin dependencias entre ellos, así que Kubernetes los arranca **a la vez**. Y los
cuatro `Job` dependientes declaran `backoffLimit: 3`, que con el retroceso exponencial de
Kubernetes —10 s, 20 s, 40 s— son **unos 70 segundos** de reintentos.

En un ambiente nuevo eso no alcanza: `identidad` tiene que esperar al motor (hasta 120 s de
`espera-al-motor`), migrar su esquema e implantar su municipalidad antes de que su buzón publique
nada.

**Y no se arregla solo**: un `Job` que alcanza su `backoffLimit` **no reintenta nunca**, y su nombre
lleva el `sha`, así que `pulumi up` lo ve existir, intenta actualizarlo y falla. Es el atasco de #44
con otra causa.

Está en [`#65`](https://github.com/hneyra/infrastructure/issues/65), con las tres salidas y por qué
la decisión no es de un PR de este repositorio. Mientras tanto los cuatro están declarados en
`MARGEN_CORTO_PENDIENTE`, que se comprueba en las dos direcciones.

**`stg` y `prod` no pasan por esto**: su municipalidad ya está implantada en `identidad`.

### Cómo se sale del atasco

```bash
# 1. Qué quedó a medias (el mismo guion que `aplicar-stg` invoca, #40 y #59).
infrastructure/.github/diagnostico-del-namespace.sh --ambiente stg

# 2. Los Job que agotaron su limite. Borrarlos es lo unico que deja que `pulumi up` los recree:
#    su nombre lleva el `sha`, asi que mientras existan el proveedor intenta ACTUALIZARLOS.
kubectl -n kamayuk-rentas-stg delete job kamayuk-rentas-implantacion-<sha>

# 3. Con `identidad` ya implantada, repetir. La implantacion es idempotente.
```

## En el compose

El mismo orden, y ahí es explícito porque son cinco `docker compose` distintos:

```bash
# La plataforma primero (PostgreSQL, Keycloak con sus dos realms, Traefik).
docker compose -f infrastructure/despliegue/plataforma.compose.yaml up -d --wait

# Despues IDENTIDAD, que es donde nace el administrador.
docker compose -f identidad/despliegue/compose.yaml up --build --wait

# Y despues los cuatro, en cualquier orden.
docker compose -f rentas/despliegue/compose.yaml up --build --wait
```

Cada satélite necesita además `KAMAYUK_CREDENCIAL_<SISTEMA>_IDENTIDAD` en el `.env` de la
plataforma: sin ella su consumidor sale sin credencial, `identidad` contesta 401 y **la implantación
falla**. Hasta la etapa 4 sólo avisaba; desde la etapa 5 no puede, porque sin credencial la copia
local se queda vacía.

## Lo que este documento NO dice

- **Cuánto dura la ventana de inconsistencia** de la copia local entre dos pasadas del consumidor:
  eso es lo que ADR-0039 §«Lo que cuesta» punto 2 exige medir, y está en el runbook de la etapa 4
  ([`identidad-4-la-ventana-de-la-copia-local.md`](identidad-4-la-ventana-de-la-copia-local.md)).
- **Quién opera cinco despliegues** (D-22): sigue abierta, y un orden entre cinco no la contesta.
