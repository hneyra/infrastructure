# ADR-0031 — La infraestructura: un repositorio común y una carpeta por sistema

| Campo | Valor |
|---|---|
| Estado | Propuesto |
| Fecha | 2026-09-03 |
| Decide | Dirección del proyecto |
| Extiende | [ADR-0011](ADR-0011-infraestructura-como-codigo.md), que no se reemplaza: sus cuatro decisiones siguen vigentes |
| Depende de | [ADR-0029](ADR-0029-cuatro-sistemas-separados.md) |
| Abre | D-25 |

## Contexto

Toda la infraestructura vive hoy en `sgtm/infra/`: Pulumi en TypeScript con yarn, dos stacks —`stg`
y `prod`— del mismo `index.ts`, sobre un k3s de un solo nodo en un VPS propio. Ocho componentes:
`BaseDeDatos`, `Identidad`, `Ingreso`, `Aplicacion`, `Migracion`, `Red`, `Respaldo` y
`Observabilidad`.

Con cuatro sistemas hay **dos cosas distintas** que separar, y confundirlas es lo que produce el
resultado malo:

- **Lo que describe la plataforma** —el clúster, el motor, Keycloak, Traefik, el respaldo, la
  observabilidad— es **una sola cosa**. No se multiplica por cuatro y no puede vivir en cuatro
  repositorios, porque entonces nadie es dueño del nodo.
- **Lo que describe un sistema** —su despliegue, su Job de migración, sus rutas, sus alertas, sus
  limites— cambia cuando cambia ese sistema. Si vive en un repositorio ajeno, se convierte en el
  cuello de botella que ADR-0029 venía a quitar.

Y hay una propiedad ya construida que decide como se hace esto, aunque se decidiera para otra cosa.
ADR-0011 eligió que **cada componente sea una función que devuelve objetos planos de Kubernetes**, en
vez de crear recursos, con tres motivos escritos: la auditoría puede leerlos —«un
`pulumi.Input<number>` no se compara con 3; un `number` si»—, las pruebas corren sin Pulumi y sin
clúster, y el diff de un cambio es legible.

**Esa elección es la que permite que un descriptor cruce la frontera de un repositorio sin perder la
verificación.** Si los componentes crearan recursos, esto no se podría hacer sin renunciar a
`auditoria.ts`.

## Decisión

### 1. Un repositorio `infrastructure`, y una carpeta `infrastructure/` en cada repo

`sgtm/infra/` se muda entero a un repositorio propio, `infrastructure`, con la plataforma y **las
convenciones**. Cada repositorio de sistema gana una carpeta `infrastructure/` con lo suyo.

| Pieza de `infra/` hoy | Dónde va | Por qué |
|---|---|---|
| `BaseDeDatos.ts` — instancia, volumen, archivado de WAL | `infrastructure` | Hay un motor. Cada sistema declara **su base y sus roles** en su descriptor; la instancia es una |
| `Identidad.ts` — Keycloak, su base, los dos realms | `infrastructure` | El login es común ([ADR-0030](ADR-0030-cuatro-interfaces-una-sesion.md)). Los *clients* de los cuatro frontends también, porque el realm es uno |
| `Ingreso.ts` — Traefik, TLS, rutas | `infrastructure` + descriptor | El enrutado por prefijo decide quién responde a qué; cada sistema declara sus rutas **bajo su prefijo** y no puede reclamar el de otro |
| `Aplicacion.ts` — despliegue, perfiles, limites, sondas | descriptor | Cambia con el sistema. `rentas` conserva sus dos perfiles, `web` y `batch` |
| `Migracion.ts` — el Job de Flyway | descriptor | Cada base tiene sus migraciones y su prueba de aislamiento |
| `Red.ts` — políticas de red | ambos | El *deny* por omisión es común; a quien puede llamar cada sistema lo declara el, y eso **hace visible el grafo de dependencias en el diff** |
| `Respaldo.ts` — PITR, simulacro de restauración | `infrastructure` | Un motor, un respaldo, un simulacro |
| `Observabilidad.ts` | ambos | La instalación es común; las reglas de alerta y el panel de cada sistema van con el |
| `secretos/` | `infrastructure` + descriptor | La mecanica es una; qué claves necesita cada sistema lo declara el |
| `auditoria.ts`, `convenciones.ts` | `infrastructure` | **Es el `comun-verificaciones` de la infraestructura.** Un descriptor sin limites, sin sondas o con una etiqueta prohibida no pasa, venga de donde venga |
| `despliegue/` — compose e identidad declarativa | `infrastructure` | El entorno local canonico es uno. Ver §4 |
| `carga-de-datos/` | se reparte | Los guiones ya están agrupados por sistema sin que nadie lo planeara: `cargar-predios` y `cargar-fichas-demo` son de catastro; `cargar-contribuyentes-demo` y `cargar-deuda-demo`, de rentas; `publicar-cuadros` y `publicar-parametros`, de normativa; `cargar-cajas`, de caja. Sólo `sembrar-demostracion.sh`, que los orquesta, se queda |

### 2. El descriptor: funciones puras publicadas por su dueño

Cada repositorio pública `@sgtm/infra-<sistema>`: un paquete versionado que exporta **funciones
puras que devuelven manifiestos**, exactamente la forma que ya tienen los componentes de hoy.
`infrastructure` los importa, **fija su versión**, los compone y **los audita con las mismas reglas
que audita los propios**.

Dos consecuencias que hay que ver juntas:

- Cada repo corre `yarn verificar` sobre su descriptor **en la máquina de quien lo escribe**, sin
  Pulumi, sin token y sin clúster. Es lo que ADR-0011 compró y no se puede perder.
- Un sistema **no puede** desplegar un manifiesto que las convenciones rechazan. La auditoría deja de
  ser un documento también a través de la frontera de un repositorio.

### 3. Dos stacks, no ocho. Y la frontera con la liberación sigue donde estaba

**Separar repositorios no separa stacks.** ADR-0011 §4 ya razonó que con dos ambientes partir en más
stacks agrega coordinación de referencias cruzadas a cambio de nada; con cuatro sistemas sobre un
solo nodo es aún más cierto. Siguen siendo `stg` y `prod`, del mismo `index.ts`.

Y **la frontera de ADR-0011 §5 no se toca**: la etiqueta de la imagen sigue fuera del estado de
Pulumi. Es lo que hace que una liberación normal de `catastro` no toque `infrastructure`, y es
exactamente lo que vuelve tolerable que la composición este centralizada. Si alguien mete la versión
de la imagen en el descriptor, se pierde todo esto sin que nada se ponga rojo.

El flujo de CI se conserva: `preview` de los dos stacks en cada PR de `infrastructure`, `up`
automático en `stg`, aprobación manual explicita en `prod`, `preview` programado contra deriva, y
nada de `pulumi up` ni `kubectl apply` desde una máquina de desarrollo.

### 4. El entorno local se parte en plataforma y sistema

Levantar cuatro backends, cuatro frontends, Keycloak y PostgreSQL en un portatil es pesado, y la
respuesta correcta no es un compose más grande:

- `infrastructure` pública el compose de la **plataforma**: PostgreSQL con las cuatro bases, Keycloak
  con sus realms sembrados, Traefik con el enrutado por prefijo. Es lo que todo el mundo levanta.
- Cada repo levanta **lo suyo** contra esa plataforma. El desarrollador de catastro no necesita
  rentas arriba salvo para las pantallas que cruzan — **y que lo necesite para trabajar en catastro
  es una señal de que la frontera está mal puesta**, no una molestia.
- Un perfil `todo` levanta los cuatro, para pruebas de integración y para CI.

ADR-0011 ya anotó el riesgo de «dos formas de levantar el sistema» y su trampa: que se separen, que
una variable nueva entre en el clúster y no en el compose. Con cuatro sistemas se multiplica, y la
mitigación escrita sigue siendo la buena: que las comprobaciones de `despliegue.yml` se trasladen al
clúster en vez de duplicarse.

## Consecuencias

- **El VPS tiene dueño.** Un repositorio con el nodo, el motor, el ingreso y el respaldo, y nadie más
  los toca.
- **Aparece un riesgo nuevo: el descriptor que nadie compone.** Un cambio de infraestructura en
  `catastro` no llega a producción hasta que alguien sube la versión en `infrastructure`. El sintoma
  es «lo desplegue y no cambio nada». **Mitigación obligatoria**: un trabajo programado en
  `infrastructure` que detecta descriptores con versión nueva sin componer y abre el PR solo. Sin
  eso, la centralización es el cuello de botella.
- **Partir el software no reparte el riesgo operativo.** Sigue habiendo un nodo, un motor y un
  Keycloak. Lo que ADR-0011 acepto como «perder el nodo es una caída del servicio» ahora es una caída
  de **los cuatro a la vez**, y «cualquier mantenimiento del VPS es una ventana de indisponibilidad»
  también. Si alguien lee esta separación como «ahora si se cae catastro, rentas sigue», hay que
  corregirlo: eso cuesta más nodos y un motor por sistema, y es **D-25**.
- **La primera prueba del reparto se hace con un sólo sistema.** En la fase 0 de ADR-0029, `infra/`
  se muda y lo que queda en el repo renombrado a `rentas` es su carpeta `infrastructure/`. Si el
  reparto está mal, se descubre ahi y no con cuatro repositorios encima.
- **Un `yarn.lock` más por repositorio.** ADR-0011 ya acepto el segundo; ahora hay uno de descriptor
  en cada sistema. Es el mismo costo, repetido, y por el mismo motivo: aplicar infraestructura no
  puede depender de instalar la interfaz.
- **El grafo de dependencias entre sistemas queda escrito en las políticas de red.** Qué `catastro`
  pueda llamar a `rentas` es una línea en su descriptor, revisable en un PR. Es el equivalente
  operativo de lo que `build.gradle.kts` hace hoy con los contextos acotados.

## Lo descartado, y por qué

- **Dejar toda la infraestructura en `infrastructure`, sin carpeta por repo.** Es lo más simple y es
  lo que convierte cada cambio de limites o de sondas de un sistema en un PR a un repositorio que no
  es el suyo, revisado por gente que no conoce el cambio. Reintroduce el acoplamiento de despliegue
  entero.
- **Qué cada repo tenga su propio stack de Pulumi.** Cuatro stacks por dos ambientes son ocho, con
  referencias cruzadas para compartir el motor, Keycloak y Traefik — que son justamente lo que no se
  puede partir. ADR-0011 §4 ya lo descartó con dos ambientes y un sistema; con cuatro sistemas sobre
  un nodo es peor.
- **GitOps con Argo CD o Flux**, cada repo escribiendo manifiestos a un repositorio de despliegue.
  Encaja bien con la frontera de ADR-0011 §5 y resuelve el «descriptor que nadie compone» de raiz.
  Se descarta **por ahora** y no por siempre: es otra pieza que operar en un nodo que ya lleva
  PostgreSQL, Keycloak, Traefik y cuatro aplicaciones. Es la evolución natural el día que el trabajo
  programado del §Consecuencias no baste.
- **Submodulos de git en vez de paquetes versionados.** Fijan un sha en vez de una versión, no pasan
  por un registro y no tienen `yarn verificar` propio. Se pierde que el descriptor sea un artefacto
  publicado con su prueba.
- **Un descriptor en YAML o JSON en vez de funciones TypeScript.** Parece más neutral y pierde el
  tipado, que es la mitad del motivo por el que ADR-0011 eligió TypeScript: un nombre de propiedad
  mal escrito tiene que ser un error de compilación y no una diferencia que aparece a mitad de un
  `pulumi up`.
