# ADR-0041 — Grafana se publica detrás de un realm de operación

| Campo | Valor |
|---|---|
| Estado | **Aceptado** |
| Fecha | 2026-09-13 |
| Decide | Dirección del proyecto, eligiendo entre las salidas que se le presentaron el 2026-09-12 y el 2026-09-13 |
| Revierte | **Sólo para Grafana**, la regla «nada de administración en una `IngressRoute`» de #153 y #156. La consola de Keycloak **sigue** excluida |
| Depende de | [ADR-0005](ADR-0005-identidad-y-acceso.md) (la autorización del producto vive en la base), [ADR-0012](ADR-0012-usuarios-y-grupos-declarativos.md) (personas declarativas, sin clave en git) |
| Se construye en | [#148](https://github.com/hneyra/infrastructure/issues/148) (el realm), [#149](https://github.com/hneyra/infrastructure/issues/149) (la ruta y el login), [#150](https://github.com/hneyra/infrastructure/issues/150) (los operadores declarativos) |

## Contexto

Grafana corre en `stg` y `prod` desde #156, con `Service` `ClusterIP` y ninguna ruta: se entra por
el túnel SSH, como documenta el runbook `abrir-grafana.md` ([#144](https://github.com/hneyra/infrastructure/pull/144)). La
dirección pidió poder mirarlo **en `https://<dominio>/grafana`**, sin túnel.

Publicarlo abre dos preguntas que el repositorio no tenía contestadas:

1. **Con qué se entra.** Hoy Grafana sólo tiene su `admin` local, con una clave. Publicarlo así
   deja una clave de administrador expuesta a internet.
2. **Quién entra.** Medido el 2026-09-12, **en Keycloak no existe ningún «operador de
   plataforma»**:
   - todo usuario declarativo sale de `municipalidades/<ubigeo>.json` y es de una municipalidad;
   - no hay grupos ni roles fuera de ellas, y el token no lleva grupos;
   - las únicas identidades con alcance de plataforma son el `admin` del realm `master` y el
     `admin` local de Grafana, y las dos van por túnel.

## Decisión

1. **Grafana se publica en `https://<dominio>/grafana`, en `stg` y en `prod`, con login de
   Keycloak (OIDC) y ninguna clave por internet.** Se apagan su formulario y el *basic auth*. El
   `admin` local sigue existiendo, pero sólo se usa con `grafana cli` dentro del pod.
2. **Quien opera vive en un realm propio, `<realm>-operacion`**, derivado del de funcionarios y no
   configurable, como el del ciudadano. Tiene **un único cliente**, `kamayuk-grafana`,
   confidencial, con PKCE, sin concesión directa y con la redirección exacta a `/grafana`.
3. **Dos roles de ese cliente: `lector` → Viewer y `administrador` → Admin.** Quien no traiga
   ninguno no entra. No hay rol por omisión.
4. **El primer operador se deriva del `administrador` de la municipalidad implantada**, en vez de
   declararse. Misma cuenta, nombre y correo; login propio, porque es otro realm. Los operadores
   declarativos llegan en #150.
5. **El túnel queda como camino de emergencia**, para cuando Keycloak no responde.

## Por qué esta salida y no las otras

| Salida | Por qué no |
|---|---|
| Publicar con la clave de `admin` de Grafana y un límite de tasa | La única defensa sería una clave de administrador frente a internet |
| El cliente de Grafana en el realm de **funcionarios**, con un rol | Un rol asignado por error a un funcionario le abre la observabilidad de toda la instalación. En un realm aparte eso **no se puede ni escribir**: ningún token de funcionario lo emite este emisor |
| Entrar con el `admin` del realm **`master`** | Llevaría la credencial más valiosa del sistema a una pantalla de acceso pública. Y en `prod` su clave ya se desvió del `Secret` (runbook de Keycloak) |
| Declarar ya los operadores en un archivo nuevo | Pedía datos que el repositorio no tiene, cuando la persona que hace falta ya está declarada y validada. Se hará, pero en #150 |

La autorización **del producto** sigue donde la dejó ADR-0005: en la base. Este realm no la toca.
Grafana no es producto: es el suelo, y su acceso lo decide Keycloak con un rol.

## Lo que cuesta, dicho aquí y no descubierto después

- **La misma persona tiene dos credenciales**, una por realm, y cambia la clave temporal en cada
  una.
- **El cliente de este realm no se aplica como los otros.** Los realms de funcionarios y del
  ciudadano importan sus clientes con `partialImport` e `OVERWRITE`. Medido contra Keycloak
  26.0.8, la versión de `stg`, el 2026-09-13: **`OVERWRITE` borra el cliente y lo crea de
  nuevo**. Con él se van sus roles, el rol de cada operador y su clave. Por eso este cliente se
  **crea** la primera vez y se **actualiza** (`kcadm update -f`) las siguientes. Así se conserva
  todo, se aplica una redirección cambiada y se repone un mapeador borrado a mano. La prueba
  `el-realm-de-operacion.test.ts` ejecuta el guion y se pone roja si vuelve a pedir un
  `partialImport`.
- **Hueco declarado hasta #150: no se retira ningún rol.** Si cambia la cuenta del stack, la
  anterior conserva `administrador` en este realm.
- **La pantalla de acceso de este realm es pública.** Por eso lleva
  `bruteForceProtected`, que el de funcionarios no trae.
- **En `stg` el login no se puede ensayar por el dominio**, que no le llega a su Traefik
  ([#145](https://github.com/hneyra/infrastructure/issues/145)). La verificación de #149 entra por
  `port-forward`.

## Consecuencias

- `Identidad.ts` compone un tercer juego de documentos y el `Job` del realm aplica dos modos más
  **al final**: `reconciliar-realm.sh operacion` y `reconciliar-identidades.sh operadores`. Si
  fallan, la municipalidad y el portal siguen trabajando.
- El inventario de secretos gana `grafana-cliente-oidc`, y una guarda nueva exige que todo lo que
  monta un pod de la plataforma lo genere el inventario. Se escribió porque, sin ella, olvidarse
  de esa entrada salía en verde.
- #149 publica la ruta, configura Grafana y sustituye la prueba «Grafana no esta en ninguna
  IngressRoute» por una guarda en `auditoria.ts`: **toda** ruta a Grafana exige OIDC y ninguna
  clave.

## Lo que #149 precisó al construirlo (2026-09-13)

La decisión no cambia. Tres frases de arriba se quedaban cortas frente a lo medido:

- **El punto 5: el túnel no lleva a Grafana, lleva a Prometheus.** El formulario y el *basic auth*
  se apagan en el proceso de Grafana, no en la ruta, así que la clave de `admin` tampoco abre por
  un `port-forward`. Con Keycloak caído, el camino de emergencia es Prometheus por `port-forward`,
  que tiene los mismos datos que los tableros.
- **El punto 1: `grafana cli` no basta para todo.** Una cuenta borrada y recreada en Keycloak choca
  con su usuario viejo en Grafana (`user already exists`, medido), y borrarlo es del API. El runbook
  `abrir-grafana.md` lo hace encendiendo el *basic auth* **un momento** con `kubectl set env`, y lo
  declara como la única entrada con clave. Es deriva, y la guarda de `auditoria.ts` no la ve,
  porque lee lo declarado y no el clúster: el guion `verificar-login-de-grafana.sh` sí, porque prueba
  el *basic auth* contra el ambiente.
- **El último coste ya no se paga.** `stg` se mudó a un VPS que su dominio sí alcanza (#145), y la
  verificación de #149 entra por el dominio en los dos ambientes.
