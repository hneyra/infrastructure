# C-9a — El CI no puede clonar repositorios hermanos

> **Estado: cerrado, con dos huecos declarados en §6.** Los **diez** `path: ../` de los cinco
> repositorios estan arreglados, y lo que decide donde estan los clones **deja de poder
> equivocarse en silencio**: una guarda nueva lee los flujos de los **seis** clones y se pone roja
> si un `actions/checkout` apunta fuera del espacio de trabajo, nombrando el archivo y la linea.
>
> Cifras: **infrastructure 461 → 485** (+24 pruebas). **rentas 3 142 · catastro 991 · caja 687 ·
> normativa 617**, ninguna baja: en los cuatro sistemas el unico archivo tocado es su
> `.github/workflows/infraestructura.yml`, que ningun proceso de Gradle lee.
>
> Lo que **no** se pudo verificar esta en §6: los cuatro repositorios de sistema quedan arreglados
> y **sin publicar**, asi que su CI no ha corrido ni una vez con el arreglo dentro.

---

## 1. El defecto, que no era una hipotesis

Se publico `infrastructure` por primera vez —los seis repositorios llevaban quince etapas y doce
correcciones sin un solo `push`— y su CI fallo en **9 segundos**:

```
##[error]Repository path '/home/runner/work/infrastructure/sgtm' is not under
         '/home/runner/work/infrastructure/infrastructure'
```

`actions/checkout` **se niega a escribir fuera de `GITHUB_WORKSPACE`**. Y todo este proyecto esta
escrito suponiendo que los clones son **hermanos** (`../sgtm`, `../rentas`…), que es como estan en
la maquina de quien lo escribe:

- `clonDe` en `infra/verificaciones/deriva-de-migraciones.ts` resuelve
  `resolve(raizDelRepositorio(), "..", sistema.clon)`;
- `settings.gradle.kts` de los cuatro backends busca `librerias-backend` en
  `../../infrastructure/librerias-backend`;
- `infrastructure/package.json` de los cuatro sistemas declara `@sgtm/infra-contrato` como
  `link:../../infrastructure/infra/contrato`.

Diez sitios, en cinco repositorios:

| Repositorio | Archivo | Linea | Era |
|---|---|---|---|
| `infrastructure` | `.github/workflows/infra.yml` | 165 | `path: ../sgtm` |
| `infrastructure` | `.github/workflows/infra.yml` | 182 | `path: ../rentas` |
| `infrastructure` | `.github/workflows/infra.yml` | 187 | `path: ../catastro` |
| `infrastructure` | `.github/workflows/infra.yml` | 192 | `path: ../normativa` |
| `infrastructure` | `.github/workflows/infra.yml` | 197 | `path: ../caja` |
| `rentas` | `.github/workflows/infraestructura.yml` | 37 | `path: ../infrastructure` |
| `catastro` | `.github/workflows/infraestructura.yml` | 37 | `path: ../infrastructure` |
| `normativa` | `.github/workflows/infraestructura.yml` | 37 | `path: ../infrastructure` |
| `caja` | `.github/workflows/infraestructura.yml` | 37 | `path: ../infrastructure` |

> El encargo listaba `normativa` con `path: ../infrastructura` —con una «a» de mas—. **Medido: no
> era cierto**, los cuatro decian `infrastructure`. Se comprueba antes de arreglar porque una
> errata de una letra y un directorio equivocado se arreglan distinto.

Y las guardas que **necesitan** los clones al lado son casi todas las del corte:
`deriva-de-migraciones`, `extensiones-de-las-migraciones`, `restauracion-logica`,
`quien-se-conecta-a-cada-base`, `plataforma-compose`, `componentes`.

---

## 2. La decision: se mueve el ANFITRION, no la raiz

El encargo proponia que «la raiz de los clones deje de ser el padre de este repositorio». **Se
midio y se hizo al reves, y conviene decir por que**: lo que se mueve es el repositorio anfitrion,
de modo que su padre **pase a estar dentro** del espacio de trabajo.

```
antes (roto):                          ahora:
  <espacio>/            = infrastructure  <espacio>/
    ../sgtm             ← fuera             infrastructure/   ← este repositorio
                                            sgtm/             ← hermano
                                            rentas/           ← hermano
                                            …
```

Un `checkout` de **este** repositorio en `path: infrastructure` convierte `<espacio>` en el padre,
y los cinco hermanos caben dentro sin salirse de ningun sitio. `clonDe` **no cambia una linea**, y
tampoco `settings.gradle.kts` ni el `link:` de los descriptores.

### 2.1 Por que no una variable de entorno

Era la salida obvia —`clonDe` leyendo `KAMAYUK_RAIZ_DE_CLONES`, con el padre como omision— y se
descarto por tres motivos, dos de ellos medidos:

1. **En los cuatro sistemas no puede funcionar.** Su dependencia del contrato es un `link:` que
   **yarn resuelve contra el disco al instalar**, y ninguna variable de entorno lo redirige. Alli
   la disposicion de hermanos no es una preferencia: esta escrita en el `package.json`. Asi que la
   variable habria arreglado un repositorio de cinco y habria dejado dos convenciones distintas.
2. **`process.env` suelto esta prohibido aqui.** `infra/eslint.config.mjs` lo rechaza fuera de
   `config.ts` —«una variable de entorno leida en un componente no aparece en `pulumi config` y
   nadie sabe que existe»—, con su muestra que lo viola. Meter la primera excepcion para esto
   habria costado mas que el arreglo.
3. **Ya habia precedente, y era este.** `sgtm/.github/workflows/backend.yml` se clona a si mismo
   en `path: sgtm` y trae `librerias-backend` en `path: infrastructure` **desde P3**, exactamente
   por este problema. El corte lo resolvio en un repositorio y no lo llevo a los otros cinco.

Y sobre «las dos disposiciones tienen que valer, y la que decide no puede ser una suposicion»: con
este arreglo **no hay dos disposiciones**. Hay una —hermanos— y nada que decidir en tiempo de
ejecucion, que es una condicion mas fuerte que la pedida. Lo que antes era una suposicion muda
—«el padre existe y tiene los clones»— pasa a ser una **condicion comprobada** por §3.

### 2.2 Lo que costo, y por que solo cambia un trabajo

`infra.yml` tiene **quince** trabajos y catorce llevan `working-directory: infra`. Clonar el
repositorio en un subdirectorio los obligaria a todos a decir `infrastructure/infra`. No hace
falta: **cada trabajo tiene su propio espacio de trabajo**, y el unico que necesita hermanos es
`verificar`. Se cambia ese, y los otros catorce se quedan como estan.

En los cuatro sistemas, `path: infrastructure` a secas **no vale**: chocaria con el directorio
`infrastructure/` que cada uno ya tiene dentro. Por eso el repositorio se clona en `path: <su
nombre>` y el hermano en `path: infrastructure`.

---

## 3. La guarda, y la mutacion que demuestra que muerde

`infra/verificaciones/checkout-en-el-espacio-de-trabajo.ts` + `.test.ts` (**+24 pruebas**).

Lee el **texto** de cada `.github/workflows/*.yml` —no su YAML analizado— por dos cosas que se
pagan juntas: el **numero de linea**, porque un hallazgo que no dice donde no se arregla; y que lo
que hay que mirar es un `path:` **dentro de un paso de `actions/checkout`**, mientras que el
`path:` de `actions/cache` y el `cache-dependency-path:` de `setup-node` pueden apuntar donde
quieran.

**Mira los seis clones desde aqui, no cada uno desde el suyo.** `infrastructure` ya los tiene todos
en CI —los necesita `extensiones-de-las-migraciones` desde C-2—, y dejar que lo cace el CI de cada
repositorio seria el mismo hueco otra vez: el sintoma solo aparece al empujar.

### Las mutaciones

| Mutacion | Resultado |
|---|---|
| Devolver `path: ../sgtm` a `.github/workflows/infra.yml` | **1 en rojo**, y lo dice entero: «`.github/workflows/infra.yml:191` — «path: ../sgtm». `actions/checkout` se niega a escribir fuera de GITHUB_WORKSPACE», con el remedio |
| Devolver `path: ../infrastructure` a `rentas/.github/workflows/infraestructura.yml` | **1 en rojo**: «`.github/workflows/infraestructura.yml:57` — «path: ../infrastructure»». Es la prueba de que los cuatro sistemas quedan cubiertos **desde aqui**, que es la mitad que hacia falta |

Las dos restauradas **por copia y comprobadas byte a byte con `cmp`**.

### Y lo que impide pasarse de listo

Tres muestras, no una:

- `flujo-que-lo-viola.yml` — el `path: ../sgtm`, mas los dos contrastes **dentro del mismo
  archivo**: un `path:` de `actions/cache` que sale del espacio de trabajo y un
  `cache-dependency-path:` que tambien. Si la guarda marcara cualquier `path:`, la muestra seguiria
  en rojo y **pareceria** correcta; lo que lo separa es la prueba que exige que esos dos **no**
  esten entre los `path` de checkout.
- `flujo-en-regla.yml` — la disposicion nueva, con hermanos dentro del espacio: **cero** hallazgos.
- `flujo-con-ruta-absoluta.yml` — `/tmp/rentas` tampoco esta bajo el espacio de trabajo.

Ademas, la muestra que lo viola lleva a proposito la frase `path: ../mencionado-en-un-comentario`
dentro de un comentario: el propio `infra.yml` explica **en un comentario** por que ya no tiene
ningun `path: ../`, y una guarda que lo marcara nacería roja sobre su propia documentacion.

Y dos comprobaciones que no miran `path` ninguno:

- **cada clon tiene flujos que mirar.** Un clon sin `.github/workflows/` pasaria en verde sin haber
  comprobado nada — el modo de fallo de #188 con `verificar-cuadros.mjs`.
- **el limite declarado sigue sin aplicar.** `saleDelEspacioDeTrabajo` no decide sobre un
  `path: ${{ … }}`: no se puede resolver leyendo el archivo. Ese hueco solo es inofensivo mientras
  no haya ninguno, asi que **se mide**; el dia que alguien escriba el primero, esto se pone rojo y
  hay que decidir, en vez de que el hueco se abra en silencio.

---

## 4. El segundo flujo, que fallaba por otra causa

Al publicar corrieron **dos** flujos y los dos salieron rojos. El segundo, «Librerias de backend»
(run `33949955412`), **no era esto**: `spotlessJavaCheck` en
`librerias-backend/comun-verificaciones/src/main/java/kamayuk/comun/verificaciones/contrato/VectoresDeHuellaTestBase.java`
— un `import com.fasterxml.jackson.databind.JsonNode` sin usar y tres reajustes de linea.

Arreglado con `./gradlew spotlessApply`, y comprobado ejecutando: `spotlessCheck` y `build` en
verde. Es el archivo que P3 dejo sin pasar por el formateador, y su unico sintoma tambien estaba
del otro lado del `push`.

---

## 5. Lo que se miro y NO habia que arreglar

Se recorrieron todos los sitios que resuelven una raiz, y dos no son del corte:

- **`herramientas/verificar-reparto-adr.py` y `verificar-enlaces-adr.py`** ya reciben la raiz como
  `sys.argv[1]` desde P2, y **no los invoca ningun flujo**: se corren a mano
  (`python3 herramientas/verificar-reparto-adr.py /Users/jorge/IdeaProjects`, en
  `docs/30-arquitectura/adr/README.md`). No tienen ninguna raiz escrita a mano.
- **`plataforma-compose.test.ts`** exige que cada montaje de roles diga `../../<sistema>/backend/`.
  Eso es una asercion sobre el **texto** de `despliegue/plataforma.compose.yaml`, que levanta la
  plataforma **en la maquina de quien desarrolla**, donde los clones si son hermanos de verdad. No
  se toca: cambiarlo romperia el compose local para arreglar un CI que no lo usa.

---

## 6. Huecos declarados

1. **Los cuatro repositorios de sistema quedan arreglados y SIN PUBLICAR.** La unica publicacion
   autorizada era `infrastructure`. Asi que de los diez sitios, los cinco de aqui estan
   **comprobados contra el CI de verdad** y los cuatro de alla estan comprobados **solo contra la
   guarda** — que es mas de lo que habia, pero no es lo mismo. El dia que se publiquen, su primer
   CI es el que lo dice.

2. **`extensiones-de-las-migraciones` y las demas guardas que cruzan clones siguen sin poder
   correr en el CI de los cuatro sistemas.** Su flujo `infraestructura.yml` solo verifica el
   descriptor; el cruce entre repositorios vive aqui. No es de esta correccion, pero cambia lo que
   significa que aquellos esten en verde.

3. **Y el trabajo `descriptor` de los cuatro esta ROJO por otra causa, anterior a esto.**
   Se descubrio al medir el criterio 4, corriendo su `yarn verificar`: los cuatro fallan igual, en
   `tsc`, y con el mismo error:

   ```
   verificaciones/descriptor.test.ts(14,7): error TS2741:
     Property 'operacion' is missing in type '{ ambiente: string; namespace: string; … }'
     but required in type 'EntornoDelDescriptor'.
   ```

   Es deriva de **C-7**: aquella correccion anadio `operacion` —el responsable y su canal, que
   ADR-0026 §4 exige para que `caja` pueda arrancar— a `EntornoDelDescriptor` en
   `infra/descriptor/tipos.ts`, y los cuatro `ENTORNO` de prueba no se actualizaron. Como la
   dependencia es un `link:` al clon hermano, los cuatro compilan contra el contrato **vivo**, asi
   que se rompieron el dia que C-7 se escribio y nadie lo vio: **su CI nunca ha corrido**.

   **No se arregla aqui, a proposito.** El remedio es de tres lineas por repositorio —anadir
   `operacion: { responsable, canal }` al `ENTORNO` de `descriptor.test.ts`—, pero es de C-7 y no
   de C-9a, no se puede comprobar contra ningun CI mientras esos cuatro sigan sin publicar, y
   meterlo dentro de este commit esconderia un hallazgo real en un cambio que no es el suyo. Queda
   dicho aqui para que sea el siguiente, y **es la misma leccion que C-9a**: el unico sintoma
   estaba del otro lado del `push`.
