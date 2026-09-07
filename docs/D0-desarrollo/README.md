# D0 — Desarrollo

Cómo montar el ambiente local de `infrastructure`, arrancarlo, depurarlo y probarlo. Escrito para
quien acaba de clonar el repositorio y quiere ver algo funcionando **hoy**.

Este repositorio es distinto de los otros cuatro: **aquí sí hay código que corre hoy**. El
descriptor de despliegue, las barreras que consumen los cinco backends y el compose de la
plataforma local.

| Documento | Para qué |
|---|---|
| [DEV-01 — Entorno local](entorno-local.md) | Qué instalar, cómo levantar la plataforma y qué queda levantado |
| [DEV-02 — Pruebas](pruebas.md) | Qué verifica qué, y qué se verifica **ejecutando** contra algo de verdad |
| [DEV-03 — Cuando algo no arranca](solucion-de-problemas.md) | Los errores que ya costaron una tarde, con su causa |

## 0 · Los clones hermanos, que no son opcionales

Los cinco repositorios son **hermanos**, y varias cosas cuentan con ello: el `includeBuild` de los
cuatro backends busca `../../infrastructure/librerias-backend`, y los CI hacen checkout de dos
repositorios con `path:` para que queden así.

```
IdeaProjects/
├── infrastructure/    este repositorio
├── rentas/  catastro/  normativa/  caja/
└── sgtm/              el archivo historico. NO se modifica
```

**Los cuatro, y desde el directorio padre de este repositorio:**

```bash
cd ..                 # el directorio que contiene a infrastructure/
for r in rentas catastro normativa caja; do git clone https://github.com/hneyra/$r; done
```

`infra/descriptor/sistemas.ts` los importa por ruta relativa
(`../../../<sistema>/infrastructure/src/descriptor`), así que **falta uno y la verificación no
llega a empezar**. No es una prueba roja: es el archivo de pruebas entero que no carga. Medido el
2026-09-07 sobre un espacio de trabajo sin `normativa`:

```
 FAIL  verificaciones/compose-de-los-sistemas.test.ts   [ … ]
 FAIL  verificaciones/despliegue-de-los-sistemas.test.ts [ … ]
Error: Cannot find module '../../../normativa/infrastructure/src/descriptor'
       imported from '…/infra/descriptor/sistemas.ts'
 ❯ descriptor/sistemas.ts:21:1

 Test Files  2 failed (2)
      Tests  no tests
```

**«`Tests no tests`» es lo que hay que leer**: no dice qué falta ni cómo traerlo, y el remedio no
está en el mensaje. En CI no pasa porque
[`.github/actions/clonar-los-hermanos`](../../.github/actions/clonar-los-hermanos/action.yml) los
trae los cuatro —y con `historial-completo: si` en el trabajo `verificar`, porque
`deriva-de-migraciones` cuenta migraciones en el árbol de git de dos revisiones y con un checkout
superficial no está ninguna—. Lo que faltaba era decirlo aquí.

> **Y no intentes reproducir ese fallo escondiendo un clon dentro de un espacio anidado**: no sale.
> Medido el 2026-09-07 — con los cuatro clones en `ws/sandbox/` y este repositorio en
> `ws/sandbox/infrastructure`, mover `ws/sandbox/normativa` fuera **no rompe el import**: se
> resuelve contra `ws/normativa`, que sigue estando. El archivo de pruebas carga, y lo que se ve
> es otro rojo más abajo —el de `composeDeSistema`, que sí nombra el clon y su `git clone`—, así
> que la conclusión que se saca es la contraria de la verdadera. Para medirlo hace falta un
> directorio padre donde ese nombre no exista a ninguna altura.

## 1 · Lo mínimo para empezar

```bash
# 1 · Prerrequisitos. Docker sólo hace falta para la plataforma
java -version && node --version && yarn --version

# 2 · El descriptor. Sin Pulumi, sin token y sin cluster
yarn install
yarn verificar

# 3 · Las barreras que consumen los cinco backends
cd librerias-backend && ./gradlew build
```

> **El paso 2 no corre sin el paso 0**, que es el de arriba: `yarn verificar` compone los
> descriptores de los cuatro sistemas y los lee de sus clones hermanos. Sin ellos no se pone rojo
> diciendo qué falta: **se cae antes de mirar nada**.
>
> Con los cuatro al lado da hoy **714 de 714, en verde** — medido el 2026-09-07 con los cuatro
> clones recién traídos. El aviso que había aquí decía «no está en verde: 337 verdes y
> 7 rojas»; esos dos defectos se cerraron en P6 y el aviso se quedó. [DEV-02 §2](pruebas.md)
> conserva el diagnóstico, que es lo que costó entender, y ya dice que el estado cambió.

## Qué comando para qué tarea

| Quiero… | Comando |
|---|---|
| Verificar el descriptor | `yarn verificar` |
| Ver lo que se desplegaría, en JSON | `yarn manifiestos --ambiente stg` |
| Saber si el stack cabe en el nodo | `yarn capacidad --ambiente prod` |
| El inventario de secretos (nunca un valor) | `yarn secretos --ambiente stg` |
| Las barreras comunes | `cd librerias-backend && ./gradlew build` |
| Levantar la plataforma local | `docker compose -f despliegue/plataforma.compose.yaml up -d --wait` |
| La guarda del registro (#711) | `node docs/00-gobierno/verificar-las-muestras-del-registro.mjs` |

## Las dos frases que gobiernan todo lo demás

**Ejecutar la prueba vale más que razonar sobre ella**, y **una verificación tiene que demostrarse
capaz de fallar**. En este repositorio eso tiene una consecuencia concreta: buena parte de lo que
hay que comprobar **no cabe en una prueba unitaria** —que el respaldo se restaure, que la alerta
le llegue a alguien, que la rotación de una clave de verdad invalide la anterior—, y por eso hay
guiones que se ejecutan contra un motor y contra un clúster reales. Están en
[DEV-02 §3](pruebas.md).

**Y una verificación escrita que no corre nadie no protege nada.** Ya pasó dos veces aquí:
`verificar-cuadros.mjs` y `verificar-rotacion.sh` existían y no los ejecutaba ningún flujo. Si
añades una, engánchala el mismo día.
