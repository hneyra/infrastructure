# `componentes/` — el sistema, descrito

Los cinco componentes de la fase B de [#159](https://github.com/hneyra/sgtm/issues/159)
—al terminar esa fase, alguien entra por HTTPS y trabaja— y los tres que sumó la fase C:
el respaldo, la observabilidad y la red.

| Componente | Qué despliega | Issue |
|---|---|---|
| `BaseDeDatos.ts` | PostgreSQL, su volumen y **los cuatro roles**, con los guiones que ya usa el compose | #149 |
| `Migracion.ts` | Los Jobs de migración e implantación, y las esperas que ordenan el arranque | #150 |
| `Identidad.ts` | Keycloak en modo `start`, con su base propia y su realm reconciliado | #151 |
| `Aplicacion.ts` | El perfil `web`, la interfaz, y el perfil `batch` con su ventana | #152 |
| `Ingreso.ts` | Traefik, TLS de Let's Encrypt, límite de tasa y el fin de los puertos en claro | #153 |
| `Respaldo.ts` | El CronJob del respaldo base con wal-g, antes de la ventana de `lote` y con su retención | #155 |
| `Observabilidad.ts` | Prometheus, Alertmanager, Grafana y los exportadores, con sus reglas y su tablero | #156 |
| `Red.ts` | Las políticas de red: denegación por omisión, y una política aditiva por cada flujo real | #157 |

Y cinco archivos que los sostienen:

| Archivo | Qué es |
|---|---|
| `tipos.ts` | Los manifiestos como **datos planos**, sin `pulumi.Input`. Ahí está el porqué |
| `convenciones.ts` | Nombres, prioridades, tamaños y sondas: lo que los ocho comparten |
| `fuentes.ts` | Los archivos del repositorio que estos manifiestos **montan sin copiar** |
| `secretos.ts` | El inventario de secretos, en un solo sitio: metadatos —nombre, clave, rol, periodicidad—, nunca un valor (issue #154) |
| `index.ts` | `construirManifiestos()`: los compone en el orden en que arrancan, para que `../index.ts` audite y aplique |

## Cada componente es una función pura

Devuelve `Manifiesto[]`. No crea recursos, no habla con el clúster, no lee configuración:
la recibe. `index.ts` los compone, `auditoria.ts` los revisa y solo entonces se aplican.

Es lo que permite que `yarn verificar` diga algo cierto sobre el despliegue sin token,
sin túnel y sin VPS — y lo que hace que las convenciones de
[`INF-01` §4](../../docs/80-infraestructura/arquitectura-de-infraestructura.md) sean una
verificación en vez de un documento.

## Lo que no se reinventa

Seis fuentes se **leen de donde están**; cinco entran tal cual a un `ConfigMap`:

| Archivo | De dónde | Por qué no se copia |
|---|---|---|
| `crear-roles.sql` | `backend/sgtm-esquema` | Una copia sería un segundo sitio donde olvidar que el rol no puede ser superusuario |
| `20-asignar-claves.sh` | `despliegue/inicializacion-del-motor` | El compose ya lo ejecuta; en k3s hay que **reproducirlo, no reinventarlo** |
| `realm-sgtm.json` | `despliegue/identidad` | Un segundo realm versionado es un mapeador de `municipalidad_id` que se pierde |
| `reconciliar-identidades.sh` | `despliegue/identidad` | El compose usa el mismo guion para el alta declarativa: un solo guion, dos modos (ADR-0012) |
| `municipalidades/*.json` | `despliegue/identidad` | La fuente versionada de personas y grupos, sin credenciales; `Identidad.ts` los deriva al `identidades.tsv` del `ConfigMap` |

La sexta, `frontend/nginx.conf`, se lee y se le cambia **una línea** —el destino del reenvío—, y
`componentes.test.ts` comprueba que lo que va al `ConfigMap` es idéntico al archivo del
repositorio. Si alguien pega una versión editada, se pone rojo.

Solo hay cuatro archivos propios de `infra/`, y los cuatro tienen motivo:
`inicializacion/30-base-de-keycloak.sh` —el compose no lo necesita, porque allí Keycloak
guarda su base dentro del contenedor—, `inicializacion/40-rol-de-respaldo.sh` y
`inicializacion/50-rol-de-monitoreo.sh` —`kamayuk_respaldo` y `kamayuk_monitor` solo existen
donde hay respaldo y monitoreo que servir (issues #155 y #156)— y
`identidad/reconciliar-realm.sh`.

## Reglas para todo componente que se agregue

1. **Recibe** la configuración; no la lee. Una regla de ESLint lo impide, con su muestra
   que la viola.
2. Devuelve manifiestos planos. Si necesitara un `Output`, es que está resolviendo algo
   que debería resolver `index.ts`.
3. Describe infraestructura. La lógica condicional compleja es la forma en que
   TypeScript en infraestructura se vuelve un segundo sistema que mantener.
4. Nombra con `resourceName()` y etiqueta con `commonLabels()`.
5. Toda sonda declara `timeoutSeconds`, y todo despliegue con estado y una sola réplica
   usa `strategy: Recreate`. Las dos las exige `auditoria.ts`; la primera, además, el
   propio tipo `Sonda`.
6. **Si agregas una convención, agrega la prueba que la viola.** Una regla que no puede
   fallar no protege nada.
