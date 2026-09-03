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

## Lo mínimo para empezar

```bash
# 1 · Prerrequisitos. Docker sólo hace falta para la plataforma
java -version && node --version && yarn --version

# 2 · El descriptor. Sin Pulumi, sin token y sin cluster
yarn install
yarn verificar

# 3 · Las barreras que consumen los cinco backends
cd librerias-backend && ./gradlew build
```

> **`yarn verificar` no está en verde hoy, y conviene saberlo antes de correrlo**: 337 verdes y
> **7 rojas** en dos archivos, por dos defectos heredados de la mudanza desde `sgtm`. Ninguno es
> tuyo y ninguno se arregla sin tomar una decisión. Están medidos, con su causa y su
> reproducción, en [DEV-02 §2](pruebas.md).

## Los clones hermanos

Los cinco repositorios son **hermanos**, y varias cosas cuentan con ello: el `includeBuild` de los
cuatro backends busca `../../infrastructure/librerias-backend`, y los CI hacen checkout de dos
repositorios con `path:` para que queden así.

```
IdeaProjects/
├── infrastructure/    este repositorio
├── rentas/  catastro/  normativa/  caja/
└── sgtm/              el archivo historico. NO se modifica
```

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
