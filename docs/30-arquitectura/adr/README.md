# Decisiones de arquitectura (ADR)

Las decisiones de la **plataforma**, y las que aplican a los cuatro sistemas.

**Un ADR que vale para todos vive aqui y los demas lo enlazan; no lo copian.** Dos copias de un ADR son dos ADR distintos el dia que alguien edite una.

Un ADR registra una decision con su contexto y sus consecuencias. **No se editan una vez
aceptados**: si una decision cambia, se escribe otro ADR que declare obsoleto al anterior. El
historial de por que se hizo algo vale mas que la coherencia del documento.

## Los de este repositorio

| # | Decision | Estado |
|---|---|---|
| [0001](ADR-0001-plataforma-backend.md) | Plataforma del backend: Spring Boot 4 sobre Java 25 | Aceptado |
| [0002](ADR-0002-estrategia-multi-tenant.md) | Esquema compartido con Row Level Security | Aceptado |
| [0004](ADR-0004-almacenamiento-de-datos.md) | PostgreSQL, con particionado por ejercicio | Aceptado |
| [0005](ADR-0005-identidad-y-acceso.md) | OIDC para autenticar; el modelo de permisos del manual para autorizar | Aceptado |
| [0008](ADR-0008-auditoria-heredada-del-manual.md) | Auditoría con observación obligatoria, como en el sistema original | Aceptado |
| [0011](ADR-0011-infraestructura-como-codigo.md) | Pulumi en TypeScript con yarn, sobre un k3s de un solo nodo | Aceptado |
| [0012](ADR-0012-usuarios-y-grupos-declarativos.md) | Usuarios y grupos de Keycloak declarativos, sin clave en git | Aceptado |
| [0028](ADR-0028-el-tenant-no-cruza-por-http.md) | El contexto de municipalidad no cruza por HTTP: token delegado, jamás una cabecera | Propuesto |
| [0029](ADR-0029-cuatro-sistemas-separados.md) | Cuatro sistemas separados: `catastro`, `rentas`, `normativa` y `caja` | Propuesto |
| [0030](ADR-0030-cuatro-interfaces-una-sesion.md) | Cuatro interfaces, una sesión, y las librerias comunes que impiden que sean cuatro productos | Propuesto |
| [0031](ADR-0031-infraestructura-comun-y-propia.md) | La infraestructura: un repositorio común y una carpeta por sistema | Propuesto |
| [0032](ADR-0032-el-esquema-nace-en-baseline.md) | El esquema de cada sistema nace en un baseline; la historia se queda en `sgtm` | Propuesto |

## El reparto: donde el enunciado y GOB-05 §4 discrepaban

El reparto se verifico contra la seccion 4 del inventario y **discrepaba en nueve casillas**.
En cada una gana uno de los dos, con su argumento:

| # | El enunciado decia | GOB-05 §4 decia | Gana | Por que |
|---|---|---|---|---|
| **0003** Monolito modular | `rentas` | `sgtm`, historico | **el enunciado** | El inventario lo daba por historico dando por hecho que 0029 ya estaba aceptado. **No lo esta**: sigue en Propuesto, asi que el monolito modular es la arquitectura VIGENTE, y es la de `rentas` en la primera etapa —los doce contextos dentro— |
| **0005** OIDC y permisos | `infrastructure` | «se parte por la mitad, sin decidir» | **el enunciado** | Partirlo exigiria editarlo, y un ADR no se edita al mudarlo. Va entero donde esta su decision principal —la identidad, que es de la plataforma—, y `rentas` lo enlaza porque su segunda mitad la conserva ADR-0013 |
| **0008** Auditoria con observacion | `rentas` | `infrastructure` | **el inventario** | Es la **regla 10**, y las diez «valen en los cinco repositorios». Su tabla `auditoria` se replica en los cuatro. Un ADR que aplica a todos vive en `infrastructure` |
| **0019** Porcion sin titular | `rentas` | `catastro` | **el enunciado** | El inventario lo leyo como invariante de la titularidad, y el propio ADR dice **«el esquema no cambia»**: lo que decide es la semantica del hueco **al determinar**, cierra D-12 y su consecuencia es que no se emite deuda. Determinar es de `rentas`. `catastro` lo enlaza, porque su titularidad es el insumo |
| **0024** Frontera del calculo | `rentas` | `infrastructure` | **el enunciado** | Regla mas especifica: los de dos repositorios viven donde vive la decision. Aqui la decision es **que puede y que no puede calcular catastro**, y quien carga con equivocarse es quien determina: el error sistematico a la baja de NEG-05 §1 sale en el padron de `rentas`. Ademas abre D-21, que es suya |
| **0025** Normativa servicio y libreria | `normativa` | **ausente** | **el enunciado** | Es el ADR de que ES `normativa`. **El inventario tiene un hueco**: 0025 aparece 17 veces en el documento y no en la tabla de §4 |
| **0026** Camino del dinero | `rentas` | `infrastructure` | **el enunciado** | Su decision central es §2, **«la imputacion es de rentas»** —si Caja imputara, la regla tributaria estaria escrita dos veces— y §5, que deja el convenio en rentas. `caja` lo enlaza: es quien lo ejecuta, no quien lo decide |
| **0027** Valuacion sellada | `catastro` | `infrastructure` | **el enunciado** | Decide **la forma de lo que catastro publica**: «lo que `catastro` publica no es el valor de un predio, es la valuacion de un predio en un ejercicio, sellada». Es su salida. `rentas` lo enlaza: la recibe y la verifica antes de emitir |
| **0032** Baseline por sistema | **ausente** | `infrastructure` | **el inventario** | **El enunciado tiene un hueco**: habla de «los 31 ADR» y son **32**. `ADR-0032` aplica a los cuatro —cada uno tiene su baseline— y va con los comunes |

**Y la discrepancia de fondo son las cifras: el enunciado dice 31 y hay 32.** Su reparto suma
exactamente 31 porque le falta `ADR-0032`; el del inventario suma 31 porque le falta `ADR-0025`.
Los dos tienen un hueco distinto, y ninguno de los dos lo veia.

## Los cuatro que dos repositorios necesitan

Viven en el repositorio de **quien toma la decision**, y el otro los enlaza:

| # | Vive en | Lo enlaza | El argumento, en una linea |
|---|---|---|---|
| **0015** Conciliacion catastro↔rentas | `rentas` | `catastro` | El propio titulo lo dice: «un derivado que **publica rentas**, no un estado que guarda catastro» |
| **0024** Frontera del calculo | `rentas` | `catastro` | Decide donde para catastro; quien paga el error es quien determina |
| **0026** Camino del dinero | `rentas` | `caja` | La imputacion es de rentas; caja cobra contra una orden y no sabe que es un tributo |
| **0027** Valuacion sellada | `catastro` | `rentas` | Decide la forma de lo que catastro **publica**; rentas la consume y la verifica |

Los cuatro tienen la misma prueba: **si el otro repositorio lo editara, la decision cambiaria en
el sitio equivocado.** Por eso se enlaza y no se copia.

El reparto entero, con su criterio, esta en [GOB-05 §4](https://github.com/hneyra/sgtm/blob/migracion-a-microservicios/docs/00-gobierno/inventario-del-corte.md).

Decisiones **pendientes**: [GOB-02](https://github.com/hneyra/sgtm/blob/migracion-a-microservicios/docs/00-gobierno/decisiones-abiertas.md).

## Plantilla

```markdown
# ADR-000X — Titulo

**Estado:** Propuesto | Aceptado | Obsoleto (reemplazado por ADR-000Y)
**Fecha:** AAAA-MM-DD

## Contexto
## Decision
## Consecuencias
## Alternativas consideradas
```

El estado tambien puede ir como fila de una tabla de metadatos (`| Estado | Aceptado |`), que es
la forma de ADR-0017 en adelante; lo que no cambia es el vocabulario: **Propuesto**, **Aceptado**
u **Obsoleto**, siempre con esa letra.

## La numeracion NO se reinicia

El ADR nuevo de este repositorio es el **0033**, no el 0001. Los treinta y dos existen y estan
repartidos; empezar de nuevo daria dos `ADR-0001` distintos en el mismo producto, y el dia que
alguien cite «ADR-0004» habria que preguntar de cual habla.
