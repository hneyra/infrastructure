# C-20 — Los trabajos que emitian manifiestos sin tener los descriptores al lado

> **Estado: cerrado y comprobado contra el CI de verdad.** Los quince trabajos de
> `infra.yml` y el unico de `declarar-version.yml` clonan ahora a sus hermanos desde
> **una sola definicion**, y una guarda nueva se pone roja en `yarn verificar` —segundos,
> no diez minutos de CI— si un trabajo que los necesita se queda sin ellos.
>
> Cifras: **infrastructure 635 → 648** pruebas (+13). Ningun otro repositorio se toca.
>
> Tres huecos declarados en §7, ninguno de este arreglo.

---

## 1. El defecto, medido

`infra/descriptor/sistemas.ts` importa los cuatro descriptores del corte de
`../../../<sistema>/infrastructure/src/descriptor`, o sea de repositorios **hermanos**.
C-9a resolvio como tenerlos en CI —el anfitrion se clona en `path: infrastructure` y el
espacio de trabajo pasa a hacer de padre— y lo aplico **en un trabajo de quince**.

Corrida [`33969248652`](https://github.com/hneyra/infrastructure/actions/runs/33969248652)
de `infra.yml`, 2026-09-05, sobre `8d151e0`. **Nueve trabajos rojos, los nueve con el
mismo error y nada mas**:

```
Error: Cannot find module '../../../caja/infrastructure/src/descriptor'
  imported from '/home/runner/work/infrastructure/infrastructure/infra/descriptor/sistemas.ts'
```

Y **la lista no era la que se suponia**. El enunciado de este trabajo nombraba nueve
—`manifiestos`, `capacidad`, `secretos`, `observabilidad-alertas`, `previsualizar-stg`,
`previsualizar-prod`, `aplicar-stg`, `aplicar-prod`, `deteccion-de-deriva`—; medidos,
son otros nueve. Lo que hay de verdad son **catorce trabajos rotos**, en tres estados
distintos:

| Trabajo | Estado el 2026-09-05 | Por que necesita los hermanos |
|---|---|---|
| `motor` | **rojo** | `verificar-el-motor.sh` → `source lib-motor-local.sh` → `yarn manifiestos` |
| `raiz-sellada` | **rojo** | `verificar-raiz-sellada.sh` → `yarn manifiestos` |
| `simulacro` | **rojo** | `simulacro-de-restauracion.sh` → `source lib-motor-local.sh` |
| `manifiestos` | **rojo** | `yarn manifiestos` |
| `capacidad` | **rojo** | `verificar-contra-el-planificador.sh` → `yarn capacidad` |
| `secretos` | **rojo** | `bootstrap-secretos.sh` → `yarn secretos` |
| `observabilidad-alertas` | **rojo** | `verificar-alertas.sh` → `yarn manifiestos` |
| `observabilidad-tableros` | **rojo** | `verificar-tableros.sh` → `yarn manifiestos` |
| `red` | **rojo** | `verificar-red.sh` → `yarn manifiestos` |
| `previsualizar-stg` | no corre en un `push` | `pulumi preview` → `index.ts` |
| `previsualizar-prod` | no corre en un `push` | idem |
| `deteccion-de-deriva` | solo de madrugada | idem |
| `aplicar-stg` | **VERDE en 32 s** | `yarn capacidad`, `pulumi up` |
| `aplicar-prod` | omitido | idem |

Cinco de los catorce **no salian rojos**, y dos de esos cinco son los que despliegan.
`aplicar-stg` tiene todos sus pasos afectados detras de un `if: hay-credenciales == 'si'`
que hoy no se cumple, asi que salio **en verde sin ejecutar ninguno**; y `aplicar-prod`
depende de esa salida y se omite. Un trabajo roto que sale verde es peor que uno rojo:
el rojo se ve.

Los cinco que el enunciado no contaba —`motor`, `raiz-sellada`, `simulacro`,
`observabilidad-tableros`, `red`— son los que hacen ver que **el censo hay que
derivarlo**: tres de ellos no nombran ninguna herramienta, y llegan a `yarn manifiestos`
por el `source` de `lib-motor-local.sh`, que la invoca en su linea 56.

### Y hay un decimoquinto, en el otro flujo

`declarar-version.yml` no clona a nadie y su `declarar.ts` resuelve `clonDe(sgtm)`, que
**se niega a inventar un numero** si el clon no esta (#675). Ese trabajo **no ha corrido
nunca** —dispara por `workflow_run` de «Infraestructura» y ese flujo lleva rojo desde el
corte—, asi que el defecto estaba latente: su primera corrida habria muerto en «No esta
el clon de «sgtm»». Entra en este arreglo por eso.

---

## 2. Lo que no era el defecto

El patron no estaba mal. Estaba **copiado quince veces, y se arreglo en una copia**.

Por eso el arreglo no es «anadir cinco `actions/checkout` a catorce trabajos» —eso deja
setenta sitios donde equivocarse la proxima vez— sino
[`.github/actions/clonar-los-hermanos`](../../.github/actions/clonar-los-hermanos/action.yml),
una accion compuesta local con **una sola definicion** de los clones. Cada trabajo la pide
en una linea:

```yaml
      - uses: actions/checkout@v4
        with:
          path: infrastructure

      - uses: ./infrastructure/.github/actions/clonar-los-hermanos
        with:
          token: ${{ secrets.GH_CLONE_KEY || github.token }}
```

El orden no es de estilo: **una accion local se referencia por su ruta dentro del espacio
de trabajo**, asi que solo se puede usar despues de que este repositorio este clonado.

Lo que la accion conserva, porque estaba medido y se habria perdido al mover:

- el `token` con repliegue `secrets.GH_CLONE_KEY || github.token` — los cuatro sistemas
  son **privados** y el `GITHUB_TOKEN` de un flujo solo alcanza al suyo (corrida
  `33950853560`, donde `infrastructure` y `sgtm` entraron y `rentas` no);
- `fetch-depth: 0` para `sgtm` y `1` para los cuatro. No es simetria: de `sgtm` se cuentan
  migraciones **en el arbol de git de otro commit**, y de los cuatro se leen archivos del
  arbol de trabajo;
- `con-sgtm`, porque **solo dos de los quince** trabajos necesitan el archivo historico.

---

## 3. Lo que el cambio de sitio arrastraba

Mover el anfitrion a `path: infrastructure` cambia el significado de **toda** ruta
relativa del flujo, y no todas se parecen. Revisadas una a una:

| Que | Cuantas |
|---|---|
| `working-directory: infra` → `infrastructure/infra` | 31 (+1 en `declarar-version.yml`) |
| `cache-dependency-path: infra/yarn.lock` → `infrastructure/infra/yarn.lock` | 14 (+1) |
| `work-dir: infra` de `pulumi/actions` → `infrastructure/infra` | 4 |
| `config: infra/red/kind-sin-cni.yaml` de `helm/kind-action` | 1 |
| Guiones invocados por ruta (`infra/…`, `despliegue/…`, `.github/…`) | 16 |

Y una que **no** se toca: el filtro `paths:` de `on.push` —`despliegue/crear-extensiones.sh`,
`backend/sgtm-esquema/…`— es relativo al **repositorio**, no al espacio de trabajo. Un
reemplazo global lo habria roto sin que ninguna prueba lo dijera: ese filtro decide si el
flujo se dispara, y un flujo que no se dispara no sale rojo.

---

## 4. La guarda nueva, y por que DERIVA en vez de listar

[`infra/verificaciones/clones-de-los-hermanos.ts`](../../infra/verificaciones/clones-de-los-hermanos.ts).
Una lista escrita a mano de «trabajos que necesitan hermanos» seria el **segundo sitio
donde olvidarse**, que es el defecto que esto cierra. Se mide en tres pasos:

1. **Que herramientas cargan el descriptor** — se recorre el grafo de importaciones desde
   cada guion `vite-node` de `package.json` y desde `index.ts`, y se comprueba si alcanza
   `descriptor/sistemas.ts`. Hoy: `manifiestos`, `secretos`, `capacidad`, `grafo` y
   —por `index.ts`— `pulumi`. `verificar` entra aparte, con su motivo escrito: su
   `typecheck` compila el proyecto entero.
2. **Que guiones las invocan** — los `*.sh` de `infra/` y `despliegue/`, con cierre
   transitivo sobre `source`. Ahi es donde aparecen `verificar-el-motor.sh` y
   `simulacro-de-restauracion.sh`, que no nombran ninguna herramienta.
3. **Que trabajos los ejecutan** — el flujo **ya analizado como YAML**, no su texto: los
   comentarios nombran `yarn capacidad` y `yarn manifiestos` en sitios donde no se
   invocan. Y se exigen las **dos** mitades: la accion compuesta, y el
   `path: infrastructure` sin el cual ni la accion se puede referenciar.

`loQueEjecuta` quita ademas comentarios y `echo`/`printf` de los guiones y de los bloques
`run: |`. Hizo falta medirlo: sin eso la deteccion marcaba **seis guiones de mas**, todos
por hablar de las herramientas en su cabecera —`comprobar-lo-asignable.sh` explica que
existe para que `pulumi up` no se cuelgue, `verificar-el-ambiente.sh` dice «eso es `yarn
verificar`»—. El error iba en la direccion segura, y aun asi se corrige: una guarda que
senala seis cosas que no son deja de leerse.

### Y la guarda de C-9a tenia que crecer con ella

`checkout-en-el-espacio-de-trabajo.ts` leia solo `.github/workflows/*.yml`. Los cinco
checkouts se acaban de mudar a `.github/actions/`, asi que **un `path: ../sgtm` escrito
dentro de la accion no lo habria visto nadie** — exactamente el estado del que C-9a salio.
`flujosDe` mira ahora las dos carpetas.

---

## 5. Las mutaciones

Cada una aplicada **sola**, ejecutada, y restaurada por copia comparada con `cmp`.

| # | Rotura | Resultado |
|---|---|---|
| 1 | Quitarle la accion compuesta al trabajo `red` | **1 en rojo**, nombrando el trabajo y por que lo necesita: «Necesita los descriptores porque ejecuta «infra/red/verificar-red.sh», y no usa `./infrastructure/.github/actions/clonar-los-hermanos`» |
| 2 | Dejarle la accion a `manifiestos` y quitarle el `path: infrastructure` | **1 en rojo**, con la otra mitad: «usa la accion pero no clona ESTE repositorio en `path: infrastructure`, asi que ni la accion se puede referenciar ni los hermanos caben al lado» |
| 3 | `path: ../rentas` **dentro de la accion compuesta** | **1 en rojo** en C-9a: «`.github/actions/clonar-los-hermanos/action.yml:83 — «path: ../rentas»»` |
| 3b | La misma fuga, con `flujosDe` devuelta a mirar solo `workflows/` | **VERDE**: las cinco pruebas de «ningun `actions/checkout` escribe fuera del espacio de trabajo» pasan, y lo unico que cae es la prueba nueva que exige que las acciones se miren. Es la medida de que la extension de §4 no era cosmetica |
| 4 | `path: ../sgtm` en `infra.yml` —la clasica de C-9a— | **1 en rojo**, con archivo y linea. La guarda sigue mordiendo donde ya mordia |
| 5 | Devolver `${{ secrets.… }}` a la `description` de la entrada | **1 en rojo**, «expected [ 'inputs' ] to deeply equal []» |

La mutacion 3b es la que mas dice: sin ella, la extension de `flujosDe` se podria deshacer
y la fuga volveria a ser invisible.

**Y una rotura no hubo que provocarla.** El primer `push` de este trabajo, corrida
[`33973367477`](https://github.com/hneyra/infrastructure/actions/runs/33973367477), murio
en **8 segundos** con:

```
Unrecognized named-value: 'secrets'. Located at position 1 within expression:
secrets.GH_CLONE_KEY || github.token
```

GitHub evalua las expresiones **tambien dentro de una `description`**, y ahi el contexto
`secrets` no existe. La descripcion de la entrada `token` transcribia el repliegue entre
llaves dobles **para explicarlo**. El sintoma no se parece a la causa: no dice «esa entrada
esta mal documentada», dice que la accion entera no se puede cargar, y ningun paso llega a
ejecutarse. Ahora se dice en prosa, y la mutacion 5 lo sujeta.

---

## 6. La corrida de CI

| Corrida | Commit | Resultado |
|---|---|---|
| [`33969248652`](https://github.com/hneyra/infrastructure/actions/runs/33969248652) | `8d151e0` | 9 rojos, todos «Cannot find module …/caja/infrastructure/src/descriptor» |
| [`33973367477`](https://github.com/hneyra/infrastructure/actions/runs/33973367477) | `d1db94d` | rojo en 8 s: `secrets` en una `description` |
| [`33973453688`](https://github.com/hneyra/infrastructure/actions/runs/33973453688) | `c62cfb9` | **9 rojos → 3**, y los tres por causas distintas de esta (§7) |

---

### Lo que pasa de rojo a verde

`raiz-sellada`, `simulacro`, `manifiestos`, `capacidad`, `observabilidad-alertas` y `red`.
Los seis daban «Cannot find module» antes de ejecutar una sola linea de lo suyo; ahora
recorren su comprobacion entera. `verificar` sigue verde, en 57 s.

### Los tres que siguen rojos, y ninguno es de este arreglo

Los tres fallan **despues** del paso que fallaba antes, o sea sobre terreno que hasta hoy
no se podia pisar. Se relanzaron los tres (`gh run rerun --failed`) y **los tres vuelven a
fallar igual**: son deterministas, no parpadeos.

| Trabajo | Donde falla ahora | Causa, medida |
|---|---|---|
| `motor` | `verificar-el-motor.sh: line 307: ./gradlew: No such file or directory` | **`infrastructure/backend/` no es un proyecto Gradle.** Tiene 70 archivos y los 70 son SQL —migraciones y `crear-roles.sql`—: ni `gradlew`, ni `settings.gradle.kts`, ni un `build.gradle.kts`. `verificarAislamiento` vive en el repositorio de cada sistema, y CLAUDE.md ya dice que esa copia es historica y no la aplica nadie. Todo lo demas del trabajo pasa —las cuatro bases, los cuatro roles, PostGIS en `catastro`, el rol del respaldo, el de monitoreo, el reinicio sin perdida—; lo unico que no se puede es el `--con-aislamiento`. **Es una decision de diseño, no una ruta**: hay que elegir de que sistema se corre la prueba, y hoy son cuatro. |
| `secretos` | `Error from server (NotFound): secrets "kamayuk-rentas-stg-app" not found` | **`verificar-claves-distintas.sh` recibe UN `--namespace` por ambiente y el inventario abarca cinco.** Medido: `yarn secretos --ambiente stg` da hoy **21 entradas en 5 espacios de nombres** —`sgtm-stg` y los cuatro `kamayuk-<sistema>-stg`—, de las que **10 estan fuera del de la plataforma**. El guion las busca todas en `sgtm-stg`. Y detras hay una segunda mitad que el `NotFound` tapa: **9 de las 21 son espejos** (`espejoDe`), y su valor **tiene que coincidir** con su origen —`sgtm_app` y `sgtm_owner` son roles del clúster y PostgreSQL le da a un rol una contrasena—, asi que «todas distintas» exigiria justamente lo contrario de lo que hace falta. Eso lo dejo escrito C-17 en el javadoc de `espejoDe`, y nadie lo pudo ver fallar porque este guion nunca llego a correr con el inventario completo. |
| `observabilidad-tableros` | «el archivo montado en el Pod nunca reflejo el ConfigMap actualizado en 90s» | **Es C-19.** El guion repunta el scrape de la aplicacion sustituyendo `targets: ["sgtm-stg-aplicacion:8080"]` por el exportador sintetico, y espera a ver el valor nuevo dentro del Pod. Medido sobre el manifiesto de hoy: **ese objetivo ya no existe** —`stg` dejo de declarar el monolito, y `prometheus.yml` tiene cinco `job_name` y ninguno es `aplicacion`—. La sustitucion es un no-op, asi que la espera no puede terminar nunca. El guion tiene razon en negarse: sin el repunte, `/-/reload` releeria lo viejo. |

Los tres son issues aparte y los tres estan bien puestos: cada uno tiene su sintoma
exacto, su causa medida y su decision pendiente.

---

## 7. Huecos declarados

1. **`verificar-el-ambiente.sh` sigue contando migraciones en el clon equivocado.**
   Resuelve `RAIZ` como el padre de `infra/` —este repositorio— y hace
   `git -C "$RAIZ" cat-file -e "$DECLARADA"`, cuando el `sha` declarado es de `sgtm`
   desde P6. `deriva-de-migraciones.ts` ya se reencuadro; el guion, no. No se toca aqui:
   solo corre con credenciales de clúster, que hoy no hay, y es otro issue.
2. **`loQueEjecuta` no interpreta el entrecomillado del shell.**
   `reservar-recursos-del-nodo.sh` se sigue contando por un «pulumi up» que vive dentro de
   un *here-document* de aviso. No cuesta nada —ese guion no lo llama ningun flujo— y
   desenredar las comillas es mas maquinaria que lo que el hallazgo vale. El error va en la
   direccion segura: pedir clones de mas nunca deja pasar un trabajo roto.
3. **Un camino a los descriptores que no pase por `package.json` ni por un `*.sh`** —un
   `node -e` que importara `descriptor/sistemas.ts` a pelo— no se detectaria. Hoy no hay
   ninguno, y el dia que lo haya el sintoma es el «Cannot find module» de §1, no un verde
   falso.
