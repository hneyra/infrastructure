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

## `caja` se queda con cero ADR, y es una respuesta medida

El reparto propuesto le da **cero** ADR propios a `caja` y manda `ADR-0026` —el camino del
dinero— a `rentas`. Es lo correcto, y el argumento no es de conveniencia: **el ADR decide lo
que caja NO va a hacer, y esa decision la toma quien se queda con lo que se le quita.**

Se lee en sus cinco apartados, que es donde vive la prueba:

| § de ADR-0026 | Lo que decide | De quien es |
|---|---|---|
| 1 | «Caja no sabe que es un tributo»: recibe **ordenes de cobro** y devuelve **pagos** | Es una **restriccion sobre caja**, puesta desde fuera para que sea reutilizable en mercados o cementerio |
| **2** | «**La imputacion es de rentas**»: el orden del Codigo Tributario —interes antes que insoluto, deuda mas antigua primero— lo aplica `rentas` al recibir el `PagoRegistrado` | `rentas`, y es el apartado que da titulo al ADR |
| 3 | Dos `COMMIT`, un outbox y la conciliacion diaria obligatoria | Compartido, pero lo que se protege es el libro de asientos, que es de `rentas` |
| 4 | Lo que hay que construir antes de encenderlo | Operativo |
| **5** | «El convenio de fraccionamiento **se queda en rentas**», aunque se firme en la ventanilla de caja | `rentas` |

Dos de los cinco apartados dicen literalmente «esto se queda en rentas». Si el ADR viviera en
`caja`, `caja` podria editar por su cuenta la regla que le prohibe imputar — que es exactamente
el defecto que §2 nombra: «si Caja imputara, la regla tributaria estaria escrita dos veces, y la
que decide de verdad acabaria siendo la que nadie recuerda que existe».

**Y que la casilla se vea vacia es informacion, no un olvido.** Inventarle a `caja` un ADR
propio para que la tabla no quede rara diria que hay una decision de arquitectura tomada donde
no la hay. La primera suya llegara con **D-17** —a quien se le cobra lo que no es tributo—, y
hasta entonces su indice dice de si mismo que no tiene ninguna.

Un matiz que conviene dejar escrito, porque el criterio del enunciado y el de GOB-05 §4 **no
son el mismo**: el inventario introduce un tercer caso —«un ADR que decide una frontera *entre*
dos sistemas no vive en ninguno de los dos, vive en `infrastructure`, porque si viviera en uno
el otro tendria que pedir permiso para cambiar su mitad»— y por eso manda 0024, 0026 y 0027 a
`infrastructure`. Aqui gana el criterio del enunciado, y no solo por precedencia: en estos
cuatro **no hay dos mitades simetricas**. La «mitad de caja» de ADR-0026 es «caja no sabe que
es un tributo», que es una restriccion que caja no deberia poder levantar sola; y la «mitad de
catastro» de ADR-0024 es «hasta aqui llega tu calculo», que quien paga si se equivoca es quien
determina —el error sistematico a la baja de NEG-05 §1 sale en el padron de `rentas`, no en el
de `catastro`—.

## Los 32, y su estado antes y despues

**Ninguno cambio de estado al mudarse, y ningun cuerpo se edito.** Lo comprueba el apartado 3
de `verificar-reparto-adr.py`, que compara el `**Estado:**` (o la fila `| Estado |`) de las dos
copias y ademas el `sha256` del cuerpo **con los enlaces neutralizados** — porque lo unico que
el corte puede cambiar legitimamente son los enlaces, y la decision no.

| # | Decisión | Estado en `sgtm` | Estado en el repositorio nuevo | Vive en |
|---|---|---|---|---|
| 0001 | Plataforma del backend: Spring Boot 4 sobre Java 25 | Aceptado | Aceptado | `infrastructure` |
| 0002 | Esquema compartido con Row Level Security | Aceptado | Aceptado | `infrastructure` |
| 0003 | Monolito modular con Spring Modulith | Aceptado | Aceptado | `rentas` |
| 0004 | PostgreSQL, con particionado por ejercicio | Aceptado | Aceptado | `infrastructure` |
| 0005 | OIDC para autenticar; el modelo de permisos del manual para autorizar | Aceptado | Aceptado | `infrastructure` |
| 0006 | La cuenta corriente es un libro de asientos inmutable | Aceptado | Aceptado | `rentas` |
| 0007 | Parámetros tributarios versionados y sellados por ejercicio | Aceptado | Aceptado | `normativa` |
| 0008 | Auditoría con observación obligatoria, como en el sistema original | Aceptado | Aceptado | `infrastructure` |
| 0009 | React con Vite y yarn workspaces, una sola aplicación por ahora | Aceptado | — | **`sgtm`**, hasta que se porte la interfaz |
| 0010 | El catálogo se porta como estructura y los datos llegan por HTTP desde un proxy simulado | Aceptado | — | **`sgtm`**, hasta que se porte la interfaz |
| 0011 | Pulumi en TypeScript con yarn, sobre un k3s de un solo nodo | Aceptado | Aceptado | `infrastructure` |
| 0012 | Usuarios y grupos de Keycloak declarativos, sin clave en git | Aceptado | Aceptado | `infrastructure` |
| 0013 | La interfaz aprende sus permisos del backend, no del token | Aceptado | Aceptado | `rentas` |
| 0014 | Navegación centrada en la atención: la persona como inicio, los módulos detrás de un lanzador | Aceptado | Aceptado | `rentas` |
| 0015 | La conciliación catastro↔rentas: un derivado que publica rentas, no un estado que guarda catastro | Aceptado · 2026-08-28 | Aceptado · 2026-08-28 | `rentas` |
| 0016 | El inicio pregunta y la ficha compone: las fases 3–5 de ADR-0014, sin el agregador que no hacía falta | Aceptado · 2026-08-28 | Aceptado · 2026-08-28 | `rentas` |
| 0017 | Las tres tablas de valuación son nacionales | Aceptado | Aceptado | `normativa` |
| 0018 | El redondeo, decidido: escala ratificada, `HALF_UP`, y ningún SRTM que imitar | Aceptado | Aceptado | `normativa` |
| 0019 | La porción sin titular identificado no se determina a nadie | Aceptado | Aceptado | `rentas` |
| 0020 | El ciudadano tiene sesión propia, y su consulta recorre el registro de municipalidades | Aceptada | Aceptada | `rentas` |
| 0021 | La base modela la geometría del predio | Aceptado | Aceptado | `catastro` |
| 0022 | El visor del plano catastral | Aceptado | Aceptado | `catastro` |
| 0023 | La muestra de fiscalización se sortea; la detección aporta sus filtros | Aceptado | Aceptado | `rentas` |
| 0024 | La frontera del calculo: catastro valoriza el predio, rentas determina la obligación | Propuesto | Propuesto | `rentas` |
| 0025 | La normativa es un servicio de datos y una libreria de reglas, y no está en el camino caliente | Propuesto | Propuesto | `normativa` |
| 0026 | El camino del dinero: dos transacciones, un outbox, y la imputación en rentas | Propuesto | Propuesto | `rentas` |
| 0027 | La valuación es un hecho sellado del ejercicio, no un estado del predio | Propuesto | Propuesto | `catastro` |
| 0028 | El contexto de municipalidad no cruza por HTTP: token delegado, jamás una cabecera | Propuesto | Propuesto | `infrastructure` |
| 0029 | Cuatro sistemas separados: `catastro`, `rentas`, `normativa` y `caja` | Propuesto | Propuesto | `infrastructure` |
| 0030 | Cuatro interfaces, una sesión, y las librerias comunes que impiden que sean cuatro productos | Propuesto | Propuesto | `infrastructure` |
| 0031 | La infraestructura: un repositorio común y una carpeta por sistema | Propuesto | Propuesto | `infrastructure` |
| 0032 | El esquema de cada sistema nace en un baseline; la historia se queda en `sgtm` | Propuesto | Propuesto | `infrastructure` |

`ADR-0003` **no se marca Obsoleto**, y no es un olvido: los ADR 0024-0032 estan en `Propuesto`.
Mientras la direccion no los acepte, el monolito modular es la arquitectura vigente. Cuando
ADR-0029 y ADR-0030 pasen a `Aceptado`, ahi si.

## Lo que se ejecuto, y que dice

Los dos verificadores estan en `infrastructure/herramientas/` y **piden la raiz como
argumento**. Corridos el 2026-09-03 con Python 3.14.6 sobre los seis repositorios en
`/Users/jorge/IdeaProjects`:

```console
$ python3 herramientas/verificar-reparto-adr.py /Users/jorge/IdeaProjects
0. La raiz contiene los seis repositorios y sus ADR: OK (32 ADR en `sgtm`)
1. Los 32 ADR tienen destino: OK
2. Ninguno en dos con contenido:      OK
3. El estado no cambio al mudarlo:
      #  estado en sgtm         estado en destino      repositorio      cuerpo
   0001  Aceptado               Aceptado               infrastructure   identico
   0002  Aceptado               Aceptado               infrastructure   identico
   0003  Aceptado               Aceptado               rentas           identico
   0004  Aceptado               Aceptado               infrastructure   identico
   0005  Aceptado               Aceptado               infrastructure   identico
   0006  Aceptado               Aceptado               rentas           identico
   0007  Aceptado               Aceptado               normativa        identico
   0008  Aceptado               Aceptado               infrastructure   identico
   0009  Aceptado               Aceptado               sgtm             (se queda)
   0010  Aceptado               Aceptado               sgtm             (se queda)
   0011  Aceptado               Aceptado               infrastructure   identico
   0012  Aceptado               Aceptado               infrastructure   identico
   0013  Aceptado               Aceptado               rentas           identico
   0014  Aceptado               Aceptado               rentas           identico
   0015  Aceptado · 2026-08-28  Aceptado · 2026-08-28  rentas           identico
   0016  Aceptado · 2026-08-28  Aceptado · 2026-08-28  rentas           identico
   0017  Aceptado               Aceptado               normativa        identico
   0018  Aceptado               Aceptado               normativa        identico
   0019  Aceptado               Aceptado               rentas           identico
   0020  Aceptada               Aceptada               rentas           identico
   0021  Aceptado               Aceptado               catastro         identico
   0022  Aceptado               Aceptado               catastro         identico
   0023  Aceptado               Aceptado               rentas           identico
   0024  Propuesto              Propuesto              rentas           identico
   0025  Propuesto              Propuesto              normativa        identico
   0026  Propuesto              Propuesto              rentas           identico
   0027  Propuesto              Propuesto              catastro         identico
   0028  Propuesto              Propuesto              infrastructure   identico
   0029  Propuesto              Propuesto              infrastructure   identico
   0030  Propuesto              Propuesto              infrastructure   identico
   0031  Propuesto              Propuesto              infrastructure   identico
   0032  Propuesto              Propuesto              infrastructure   identico

   32 comparados, 0 con estado o cuerpo distinto.

4. El indice de cada repositorio coincide con el disco:
   repositorio       aloja  listados  enlaza  veredicto
   infrastructure       12        12       0  OK
   rentas               11        11      12  OK
   catastro              3         3      14  OK
   normativa             4         4       8  OK
   caja                  0         0       9  OK
$ echo $?
0
```

```console
$ python3 herramientas/verificar-enlaces-adr.py /Users/jorge/IdeaProjects
Enlaces en los ADR de cada repositorio

  repositorio       relativos  absolutos   rotos
  infrastructure           37         36       0
  rentas                   15         39       0
  catastro                  4         25       0
  normativa                 6         21       0
  caja                      0         11       0
  sgtm                    162         30       0
  TOTAL                   224        162       0

  «absolutos» = los que apuntan a un archivo de estos seis repositorios y SI se resuelven contra el disco.

Rotos CONOCIDOS y declarados (2), que no ponen esto en rojo:
  - rentas/ADR-0013-permisos-de-la-sesion.md: «https://github.com/hneyra/sgtm/blob/migracion-a-microservicios/frontend/packages/sesion/src/permisos.ts»
      El MISMO de arriba, mudado. `repartir-adr.py` lo reescribio a absoluto al copiar ADR-0013 a `rentas`, asi que apunta al mismo archivo inexistente. No se corrige en el destino: un ADR no se edita al mudarlo, y el original sigue diciendo lo mismo.
  - sgtm/ADR-0013-permisos-de-la-sesion.md: «../../../frontend/packages/sesion/src/permisos.ts»
      PREEXISTENTE, y NO se arregla aqui. `frontend/packages/sesion/` era la interfaz con yarn workspaces; la reimplementacion del 2026-09-01 la sustituyo por un solo paquete y ese archivo no existe. Arreglarlo seria un segundo cambio en `sgtm`, y la etapa P2 solo permite uno (la nota de `adr/README.md`).

Absolutos que NADIE valida (11): no son un archivo de estos seis repositorios, asi que no se pueden resolver en disco.
  - https://github.com/hneyra/sgtm/issues/188
  - https://github.com/hneyra/sgtm/issues/344
  - https://github.com/hneyra/sgtm/issues/366
  - https://github.com/hneyra/sgtm/issues/375
  - https://github.com/hneyra/sgtm/issues/391
  - https://github.com/hneyra/sgtm/issues/400
  - https://github.com/hneyra/sgtm/issues/415
  - https://github.com/hneyra/sgtm/issues/500
  - https://github.com/hneyra/sgtm/issues/550
  - https://github.com/hneyra/sgtm/issues/57
  - https://github.com/hneyra/srtm/blob/main/docs/30-arquitectura/adr/ADR-0008-infraestructura-como-codigo.md

En los CINCO repositorios nuevos: 0 enlaces rotos (sin contar los 2 declarados arriba).
CERO enlaces rotos no declarados.
$ echo $?
0
```

### Las dos guardas no podian fallar, y ese era el defecto

Las dos versiones anteriores tomaban la raiz de `sys.argv[1]` **o del directorio actual**.
Corridas sin argumento revisaban **cero archivos** y salian en **verde**:

```console
$ cd /tmp && python3 .../verificar-enlaces-adr.py     # la version anterior
  TOTAL                    0       0
CERO enlaces relativos rotos.
$ echo $?
0
```

Ahora la raiz es obligatoria (`exit 2` sin ella) y, ademas, **haber revisado cero es ROJO**.
Cada rotura se aplico sola y se restauro con `cmp` antes de la siguiente:

| Rotura | Resultado |
|---|---|
| **Enlaces** · sin argumento | `exit 2`, con el motivo: «sin ella el guion revisaria 0 archivos y saldria en verde sin haber mirado nada» |
| **Enlaces** · raiz equivocada (`/tmp`) | ROJO ×2: «no existe `docs/30-arquitectura/adr` en: los seis» y «no hay nada que revisar (0 relativos, 0 absolutos propios)» |
| **Enlaces** · enlace **relativo** roto nuevo en `caja` | ROJO, nombrandolo: `caja/README.md: «ADR-9999-no-existe.md»` |
| **Enlaces** · enlace **absoluto** roto a un repositorio propio, en `catastro` | ROJO nombrandolo. **La version anterior no lo ve**: corrida sobre el mismo arbol sigue listando el mismo unico roto de `sgtm` y el inyectado no aparece en su lista |
| **Enlaces** · quitar una entrada de la lista de exentos | ROJO: `rentas/ADR-0013…` vuelve a contar. Es la prueba de que lo que lo sostiene es la exencion declarada y no un descuido |
| **Reparto** · raiz equivocada | ROJO: «Sin `docs/30-arquitectura/adr` en: los seis; 0 ADR en `sgtm`» |
| **Reparto** · el mismo ADR en dos repositorios | ROJO: `{'0026': ['rentas', 'caja']}` |
| **Reparto** · cambiar el **estado** en el destino | `0027 Propuesto / Aceptado ← DISTINTO` |
| **Reparto** · editar el **cuerpo** en el destino | `0027 … EDITADO ← CUERPO EDITADO`, con el estado intacto |
| **Reparto** · quitar una fila de «Los de este repositorio» | ROJO: «normativa lista `['0007','0017','0025']` y en disco hay `['0007','0017','0018','0025']`» |
| **Reparto** · enlazar un ADR al repositorio que no lo tiene | ROJO: «caja enlaza a quien no lo tiene: `{'0026': ('caja', 'rentas')}`» |
| **Reparto** · alojar **y** enlazar el mismo ADR | ROJO: «normativa aloja Y enlaza los mismos: `['0018']`» |

El apartado **4** —que el indice de cada repositorio coincida con el disco— es nuevo. Sin el, la
tabla de un `README.md` envejece sola, y una tabla que dice alojar un ADR que ya no esta es la
forma barata de acabar con dos fuentes de verdad.

Y la comprobacion de **enlaces absolutos a nuestros propios repositorios** tambien es nueva, por
un motivo medido: `repartir-adr.py` convierte un relativo en absoluto al mudar el ADR, de modo
que **un relativo roto se muda como absoluto roto y desaparece de la comprobacion**. Son 162
absolutos a repositorios propios; 161 resuelven y 1 no, y el que no es justo ese.

### Que se puede volver a ejecutar, y que no

`indices-adr.py` pedia un tercer argumento —un `n|estado|titulo` de 32 lineas— que **no estaba
en el repositorio**: el guion no se podia volver a correr. Ahora deriva estado y titulo de los
propios ADR de `sgtm`, y el reparto de `herramientas/reparto-adr.json`, que si esta. Corrido de
nuevo reproduce **byte a byte** los cuatro indices que ya estaban (`cmp` limpio en `rentas`,
`catastro`, `normativa` y `caja`) y **se niega a pisar este archivo**, que lleva secciones a
mano:

```console
$ python3 herramientas/indices-adr.py /Users/jorge/IdeaProjects
  infrastructure   NO se toca: lleva 2 seccion(es) escritas a mano que este guion no genera y perderia -> ['El reparto: donde el enunciado y GOB-05 §4 discrepaban', 'Los cuatro que dos repositorios necesitan']
  rentas           indice con 11 propio(s) y 12 enlazado(s)
  catastro         indice con 3 propio(s) y 14 enlazado(s)
  normativa        indice con 4 propio(s) y 8 enlazado(s)
  caja             indice con 0 propio(s) y 9 enlazado(s)
```

Esa guarda nacio **rota y se midio**: leia los `## Contexto`, `## Decision`… de dentro del
bloque de codigo de la plantilla como si fueran secciones del documento, de modo que se negaba
a escribir **siempre**, en los cinco — que es lo mismo que no tenerla. Se cierra quitando los
bloques de codigo antes de partir por `##`.

## Los huecos declarados

Un entregable con un hueco declarado vale mas que uno completo que no es cierto. Estos son los
cinco que quedan:

1. **`ADR-0013` enlaza a un archivo que no existe, en `sgtm` y en `rentas`.** El destino es
   `frontend/packages/sesion/src/permisos.ts`, de cuando la interfaz tenia `yarn workspaces`;
   la reimplementacion del 2026-09-01 la sustituyo por un solo paquete y ese archivo se fue.
   **Es preexistente al corte.** No se arregla en `sgtm` porque la etapa P2 solo permite un
   cambio ahi —la nota de `adr/README.md`— y no se arregla en `rentas` porque un ADR no se
   edita al mudarlo. Los dos estan en la lista de exentos del verificador **con este motivo
   escrito al lado**, y quitar cualquiera de las dos entradas lo pone rojo.

2. **Los enlaces absolutos que no apuntan a estos seis repositorios no los valida nadie.** Son
   11: diez `sgtm/issues/NNN` y el `ADR-0008` del `srtm`. Comprobarlos exige red, y el guion los
   lista en vez de dar la impresion de haberlos mirado.

3. **La suposicion de la organizacion de GitHub no la mide nadie.** `repartir-adr.py` escribe
   `github.com/hneyra/<repo>` dando por hecho que los cinco viven en la misma organizacion que
   `sgtm`. Hoy se comprueba **contra el disco** —el repositorio hermano y la ruta dentro—, que
   es lo que caza un archivo que no existe; lo que no se comprueba es que la URL publica sea la
   buena el dia que la organizacion cambie.

4. **`GOB-05 §4` sigue diciendo el reparto anterior, y no se puede corregir aqui.** Vive en
   `sgtm/docs/00-gobierno/inventario-del-corte.md`, y la etapa P2 solo permite un cambio en
   `sgtm` —la nota de `adr/README.md`, que ya esta hecha—. Asi que hoy hay **dos documentos
   que dicen cosas distintas**: §4 manda 0024, 0026 y 0027 a `infrastructure` y no menciona
   0025; el reparto ejecutado —el que la tabla de arriba mide contra el disco— es el de este
   archivo. **Manda el disco**, que es lo que los verificadores leen. GOB-05 se muda a
   `infrastructure` segun su propio §5: ese es el momento de reconciliarlo, y hay que hacerlo
   entonces o quedara una tercera copia.

5. **Ninguno de los dos verificadores esta enganchado a CI.** Se ejecutan a mano. Enganchar el
   de reparto exige ademas resolver algo que no es trivial: **necesita los seis repositorios
   clonados a la vez**, y ninguno de los cinco flujos los tiene. Es el mismo defecto que #435
   encontro con `verificar-rotacion.sh` y #188 con `verificar-cuadros.mjs` —una verificacion
   escrita que no corre nadie no protege nada— y aqui se dice en vez de darlo por hecho.

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
