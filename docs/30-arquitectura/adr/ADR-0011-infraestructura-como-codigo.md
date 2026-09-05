# ADR-0011 — Pulumi en TypeScript con yarn, sobre un k3s de un solo nodo

**Estado:** Aceptado
**Fecha:** 2026-08-20

## Contexto

El único despliegue que existe hoy es [`despliegue/compose.yaml`](../../../despliegue/compose.yaml),
y su propio README no se hace el interesante al respecto:

> Esto no es una instalación de producción. Un solo nodo, sin copias de seguridad programadas, sin
> TLS y con los puertos publicados en claro.

Cada palabra de esa frase es cierta y ninguna es un descuido: el compose se escribió para que el
sistema **arrancara y alguien pudiera entrar**, que hasta hace poco no era el caso. Lo que no hace
—y no puede hacer— es sostener una instalación que atiende a una municipalidad de verdad.

Levantar esa instalación exige decidir cuatro cosas antes de escribir el primer `ComponentResource`,
porque las cuatro se pagan en cada issue posterior de la épica:

1. **Con qué se describe la infraestructura**, y en qué lenguaje y con qué gestor de paquetes.
2. **Dónde vive el estado** de esa descripción, que es el archivo del que depende poder volver a
   aplicarla.
3. **Cuántos ambientes hay y cómo se separan**, que decide si la recuperación se puede ensayar.
4. **Qué gestiona la infraestructura y qué gestiona el flujo de liberación**, que decide cuánto
   tarda una reversión.

Pulumi estaba preseleccionado. Este ADR **no decide Pulumi**: decide las cuatro de arriba, que es
donde están los problemas.

Hay además una restricción que no es técnica y que ordena todo lo demás: **hay un VPS**. El
[`ADR-0008` del SRTM](https://github.com/hneyra/srtm/blob/main/docs/30-arquitectura/adr/ADR-0008-infraestructura-como-codigo.md)
resuelve este mismo problema para tres nodos servidor, cuatro ambientes y un equipo con presupuesto
de plataforma. Aporta la forma —cómo se organiza un repositorio de Pulumi, dónde va la frontera con
Kubernetes, qué se aprueba a mano— y **no aporta la topología**, que aquí es otra y cuesta otra
cosa.

## Decisión

**Pulumi en TypeScript, con yarn, en `infra/` de este repositorio, con el estado en Pulumi Cloud,
dos stacks —`prod` y `stg`— del mismo `index.ts`, desplegando sobre un k3s de un solo nodo en un
VPS propio.**

### 1. TypeScript, y por qué no otro lenguaje

El frontend ya es TypeScript ([`ADR-0009`](https://github.com/hneyra/sgtm/blob/migracion-a-microservicios/docs/30-arquitectura/adr/ADR-0009-plataforma-frontend.md)). Describir la
infraestructura en el mismo lenguaje es **un lenguaje menos que mantener**, y trae tipado real:
un nombre de propiedad mal escrito es un error de compilación y no una diferencia que aparece a
mitad de un `pulumi up`.

Se descartan Python y Go por lo mismo al revés: son un lenguaje más, sin ganancia frente a
TypeScript en este contexto.

### 2. yarn, y `infra/` como proyecto propio

El repositorio ya es yarn ([`frontend/`](https://github.com/hneyra/sgtm/blob/migracion-a-microservicios/frontend/README.md) usa yarn workspaces), así que
el gestor de paquetes no se discute: **yarn**.

Lo que sí se decide es que **`infra/` tiene su propio `package.json` y su propio `yarn.lock`, y no
es un workspace de `frontend/`**. Los dos motivos son simétricos y los dos importan:

- Un `pulumi up` no puede depender de instalar Vite, React, Playwright y el design system. La
  infraestructura se aplica desde CI, a veces con el sistema caído, y su instalación tiene que ser
  corta y no tener nada que compilar.
- `yarn verificar` del frontend no puede ponerse rojo porque `@pulumi/kubernetes` subió la versión
  de sus tipos. Son dos árboles de dependencias que no se parecen en nada y que cambian por motivos
  distintos.

El costo —un segundo `yarn.lock` en el repositorio— está en las consecuencias, abajo.

### 3. El estado vive en Pulumi Cloud

| Elemento | Dónde |
|---|---|
| Estado de los stacks | **Pulumi Cloud** |
| Secretos de arranque de la infraestructura (kubeconfig, clave SSH, credenciales ACME) | Configuración cifrada de Pulumi, en `Pulumi.<stack>.yaml` |
| Secretos de la aplicación (claves de `sgtm_owner`, `sgtm_app`, administrador de Keycloak) | **No están en Pulumi.** Ver `INF-06`, issue #154 |

Pulumi Cloud da bloqueo de concurrencia, historial y detección de deriva sin operar un backend
propio, que para un equipo de este tamaño es exactamente el trabajo que no hay quien haga.

**El estado no contiene ni un dato de contribuyente**: describe recursos de Kubernetes, no filas del
padrón. Lo que sí contiene son secretos de arranque, cifrados con la clave del stack.

**La salida, si hubiera que dejarlo:** `pulumi login` contra un backend S3-compatible sobre el mismo
almacenamiento de objetos donde ya viven los respaldos (INF-01 §1.3), con
`PULUMI_CONFIG_PASSPHRASE` como proveedor de secretos. Se pierde el bloqueo de concurrencia —que con
un solo pipeline de CI es asumible— y la detección de deriva pasa a ser un `pulumi preview` en un
trabajo programado. Queda escrita como **salida**, no como plan: mientras Pulumi Cloud sirva, se usa
Pulumi Cloud.

### 4. Dos stacks: `prod` y `stg`. Lo local sigue siendo el compose

| Stack | Qué es |
|---|---|
| `prod` | El VPS que atiende a la municipalidad |
| `stg` | Un segundo VPS, más pequeño, **donde se ensaya la restauración** (INF-03 §2) |
| — | **Local no es un stack.** Es [`despliegue/compose.yaml`](../../../despliegue/compose.yaml) |

**Un stack por ambiente, no por componente.** Con dos ambientes, partir en más stacks agrega
coordinación de referencias entre stacks a cambio de nada. Las diferencias entre `stg` y `prod`
viven en `Pulumi.stg.yaml` y `Pulumi.prod.yaml`: **si hiciera falta código distinto, es un defecto**,
no una particularidad del ambiente.

**Local no se convierte en un tercer stack** —con k3d, por ejemplo— por un motivo concreto: sería
una tercera forma de levantar el sistema que no reemplaza a ninguna de las dos que ya hay. El
compose es lo que un desarrollador levanta en su máquina y es lo que CI levanta en
[`despliegue.yml`](https://github.com/hneyra/sgtm/blob/migracion-a-microservicios/.github/workflows/despliegue.yml) con sus nueve comprobaciones. **No se
retira.**

### 5. La frontera: qué gestiona Pulumi y qué gestiona el flujo de liberación

| Gestionado por Pulumi | Gestionado por el flujo de liberación |
|---|---|
| El clúster, sus namespaces, sus cuentas de servicio y su RBAC | **La etiqueta de la imagen de la aplicación, del migrador y de la interfaz** |
| Traefik, las rutas de ingreso, TLS y la renovación del certificado | El número de réplicas cuando se ajusta a mano |
| PostgreSQL, su volumen, su archivado de WAL y su destino de respaldo | |
| Keycloak, su base y su realm | |
| La **definición** de los despliegues y de los Jobs de migración e implantación | |
| Límites de recursos, sondas, prioridades y políticas de red | |

El motivo de la primera fila es el único que hace falta: **si el número de versión de la imagen vive
en el estado de Pulumi, cada liberación es un `pulumi up` y cada reversión también.** Eso acopla el
ritmo de la aplicación —que cambia seguido— al de la infraestructura —que casi no cambia— y
convierte una reversión de tres minutos en una operación que toca el clúster entero. La versión sale
del flujo de liberación (issue #148) y entra al clúster como una actualización de la imagen del
despliegue.

**La interfaz fue una excepción a esto, y dejó de serlo.** Vite resuelve las `VITE_*` al compilar,
así que el emisor de identidad quedaba horneado en el paquete estático y hacían falta **dos**
imágenes, una por ambiente, construidas desde el `sgtm:domain` de cada `Pulumi.<ambiente>.yaml`. El
problema no era el coste de la segunda imagen: era que `sgtm:domain` alimentaba **dos sistemas con
ciclos de vida distintos** —el ingreso, por `pulumi up`; el paquete, por una reconstrucción de
imagen— y **nada obligaba a que coincidieran**. Cambiar el dominio dejaba el ingreso en el nombre
nuevo y el paquete en el viejo, en verde y sin un solo síntoma.

No es hipotético: pasó en `prod`. `sgtm:domain` decía `vmd120205.contabo.net` —sin `server`, un
nombre sin registro A—, se corrigió en `infra/`, el clúster quedó bien… y el botón de acceso siguió
mandando el navegador al nombre inexistente, porque el paquete desplegado era el anterior.

La salida no fue añadir un detector, sino quitarle al paquete el dato: Keycloak se sirve en el mismo
origen que la interfaz, así que las `VITE_KAMAYUK_OIDC_*` son **rutas** (`/keycloak/realms/…`) y el
navegador las resuelve contra el origen desde el que se descargó la página. Con eso el dominio deja
de ser entrada de la compilación, queda **un solo consumidor** —`infra/`, que gestiona Pulumi— y la
interfaz vuelve a la regla general de esta sección: **un artefacto que se promueve, no se
reconstruye**. `frontend/scripts/comprobar-compilaciones.mjs` lo vigila por los dos lados: lee los
`build-args` del propio flujo y compila con ellos, y exige que ningún dominio declarado en
`infra/Pulumi.*.yaml` aparezca dentro del paquete.

> Queda un resto: `infra/componentes/Aplicacion.ts` todavía compone la etiqueta como
> `<ambiente>-<versión>`, así que el flujo publica la misma imagen —el mismo digest— bajo las dos
> etiquetas. Retirar el prefijo exige que `applicationBootstrapVersion` apunte a un sha posterior a
> este cambio, y es un paso aparte para no dejar a `prod` pidiendo una etiqueta que aún no existe.

### 6. El flujo en CI

| Evento | Acción |
|---|---|
| PR que toca `infra/` | `pulumi preview` de los **dos** stacks; el resultado se publica como comentario en el PR |
| Integración a `main` | `pulumi up` automático en **`stg`** |
| `prod` | `pulumi up` **con aprobación manual explícita**. Nunca automático |
| Programado | `pulumi preview` de `prod`; una deriva es una alerta |

**Prohibido `pulumi up` desde una máquina de desarrollo contra `prod`.** Las credenciales de ese
stack solo existen en CI. La regla vale también para `kubectl`: un `kubectl apply` a mano es una
deriva que el siguiente `pulumi up` deshace en silencio, y la lección está anotada en `../iaac`
—donde `kubectl scale` sobre un servicio detenido lo devolvía a la vida en el despliegue
siguiente—.

## Consecuencias

**Positivas**

- Un VPS vacío llega a sistema utilizable sin un paso manual que alguien tenga que recordar. Es la
  base del RTO de RNF-077 y lo que hace que la reconstrucción tras perder el VPS sea un
  procedimiento y no una tarde de arqueología.
- La diferencia entre `stg` y `prod` es auditable: son dos archivos de configuración, en el diff.
- Un lenguaje menos para el equipo, con errores en compilación en vez de en `apply`.
- La reversión de la aplicación es independiente de la infraestructura: no ejecuta `pulumi up`.
- La infraestructura entra por PR, con `preview` publicado. Un cambio de red o de límites se revisa
  como se revisa el código.

**Negativas / costos aceptados**

- **Un solo nodo convierte cualquier mantenimiento del VPS en una ventana de indisponibilidad.**
  Actualizar el kernel, redimensionar el disco, reiniciar k3s para aplicar la reserva de recursos
  del nodo: todo eso son minutos sin servicio, anunciados, porque no hay a dónde mover la carga.
  Es el costo directo de apartarse de la topología de tres nodos del SRTM y **no tiene atajo**. Se
  paga entero en INF-01 §1.1 y en RNF-078.
- **Perder el nodo es una caída del servicio, no una promoción.** k3s en un solo nodo guarda su
  plano de control en SQLite; no hay quórum que sobreviva ni réplica de PostgreSQL que promover. La
  recuperación es una **restauración**, y por eso el RTO de RNF-077 se mide en horas y no en
  minutos, y por eso el respaldo tiene que estar fuera del VPS.
- **Dependencia de Pulumi Cloud para el estado.** Si no está disponible, no se puede modificar la
  infraestructura; lo que ya corre sigue corriendo y la aplicación no se entera. Riesgo bajo, con la
  salida documentada arriba —y esa salida es trabajo real el día que haya que tomarla, no un
  interruptor—.
- **Dos formas de levantar el sistema**, compose y Pulumi, que hay que mantener a la vez. Es un
  costo aceptado y no un descuido: el compose es el entorno local y lo que CI verifica hoy. La
  trampa concreta es que se separen —que una variable nueva entre en el clúster y no en el
  compose—, y lo que la limita es que las comprobaciones de `despliegue.yml` se trasladen al
  clúster en vez de duplicarse.
- **Un segundo `yarn.lock` en el repositorio.** Dos árboles de dependencias que se actualizan por
  separado, y una respuesta más larga a «¿dónde instalo esto?».
- **TypeScript en infraestructura permite abstracciones excesivas.** La regla es que un componente
  describe infraestructura; si tiene lógica condicional que hay que leer dos veces, es un ambiente
  que debería ser configuración.
- **La frontera con el flujo de liberación hay que respetarla.** Si alguien pone la etiqueta de la
  imagen en el estado de Pulumi, todo lo de §5 se pierde sin que nada se ponga rojo. No hay
  verificación automática de esto todavía; es una revisión de PR (issue #148).
- **El estado y el clúster pueden divergir.** Un `kubectl apply` a mano funciona, no deja rastro en
  Pulumi y desaparece en el siguiente `up`. El `preview` programado de §6 es lo que lo detecta,
  y solo si alguien lo lee.

## Alternativas consideradas

- **Dejar el compose y ponerle un proxy con TLS delante.** Es la opción barata y honesta, y merece
  una respuesta seria: funciona, ya existe y no hay nada que aprender. Lo que no da es **estado
  deseado que sobreviva a un reinicio** —un `docker compose up` no vuelve solo tras un corte—, ni
  Jobs con semántica de terminación para la migración y la implantación, ni límites y prioridades
  entre cargas, ni una reversión declarativa. Y, sobre todo, no da un procedimiento de
  reconstrucción: restaurar sería alguien recordando los pasos, que es exactamente lo que este ADR
  existe para dejar de aceptar. Se descarta, sabiendo que es la decisión más cara del documento.
- **Tres nodos servidor, como el SRTM.** Descartada por costo. El apartamiento y lo que cuesta están
  escritos en INF-01 §1.1; lo que **no** se hace es copiar la topología y seguir afirmando el RTO
  que esa topología sostenía.
- **Un PostgreSQL gestionado del proveedor**, en vez de dentro del clúster. Quita de encima
  respaldos, PITR y actualizaciones menores, que es justo el trabajo más delicado. Se descarta por
  dos razones: el aislamiento entre municipalidades se verifica creando roles y ejecutando
  `verificarAislamiento` **contra la instancia real** como `sgtm_app` (issue #149), y eso exige
  control sobre los roles del motor; y el costo mensual de un gestionado con PITR es comparable al
  del VPS entero. Se reabre si el padrón crece o si aparece una segunda municipalidad.
- **Terraform u OpenTofu.** Ecosistema más amplio. Descartada por la preselección de Pulumi y porque
  HCL sería un lenguaje más.
- **Pulumi con Python o con Go.** Descartada: un lenguaje más sin beneficio.
- **npm o pnpm en `infra/`.** Descartada por coherencia: el repositorio es yarn, y tener dos gestores
  es peor que tener dos `yarn.lock`.
- **`infra/` como workspace de `frontend/`.** Descartada por §2: acopla dos árboles de dependencias
  que no comparten nada y hace que aplicar infraestructura dependa de instalar la interfaz.
- **Un stack por componente.** Descartada: con dos ambientes, la coordinación de referencias entre
  stacks no la paga nadie.
- **Un tercer stack `local` sobre k3d.** Descartada por §4: una tercera forma de levantar el sistema
  que no reemplaza a ninguna de las dos que ya hay.
- **GitOps con Argo CD o Flux.** Encaja bien con la frontera de §5 y es la evolución natural del
  flujo de liberación. No se adopta ahora para no operar otra pieza en un nodo que ya lleva
  PostgreSQL, Keycloak, Traefik y la aplicación.
- **Reutilizar `../iaac` en vez de escribir `infra/`.** Descartada: `../iaac` es un VPS compartido por
  varios proyectos, y el SGTM necesita un motor de datos que no comparte con nadie. De `../iaac` se
  toma la experiencia —está en INF-01 §4—, no el clúster.

## Enlaces

- [`INF-01 — Arquitectura de infraestructura`](https://github.com/hneyra/sgtm/blob/migracion-a-microservicios/docs/80-infraestructura/arquitectura-de-infraestructura.md)
  · [`INF-03 — Ambientes`](https://github.com/hneyra/sgtm/blob/migracion-a-microservicios/docs/80-infraestructura/ambientes.md)
- [`REQ-02 — Requisitos no funcionales`](https://github.com/hneyra/sgtm/blob/migracion-a-microservicios/docs/20-requisitos/requisitos-no-funcionales.md), sección
  «Operación»: RNF-074, RNF-076 a RNF-079
- [`ADR-0003`](https://github.com/hneyra/rentas/blob/main/docs/30-arquitectura/adr/ADR-0003-monolito-modular.md) — un solo artefacto en dos perfiles ·
  [`ADR-0005`](ADR-0005-identidad-y-acceso.md) — Keycloak como emisor ·
  [`ADR-0009`](https://github.com/hneyra/sgtm/blob/migracion-a-microservicios/docs/30-arquitectura/adr/ADR-0009-plataforma-frontend.md) — TypeScript y yarn en la interfaz
- [`despliegue/README.md`](../../../despliegue/README.md) — el compose, que no se retira
- [`ADR-0008` del SRTM](https://github.com/hneyra/srtm/blob/main/docs/30-arquitectura/adr/ADR-0008-infraestructura-como-codigo.md)
  — la forma, no la topología
