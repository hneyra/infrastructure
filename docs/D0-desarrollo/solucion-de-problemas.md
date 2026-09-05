# DEV-03 — Cuando algo no arranca

Los errores que ya costaron una tarde, con su causa. Están aquí porque **el síntoma no se parece
a la causa** en ninguno de ellos.

## 1. `bind: address already in use` al levantar la plataforma

Los puertos por omisión —5432, 8080, 8180, 8025— son de los más ocupados que hay, y en un demonio
compartido puede haber otra instalación corriendo. Se mueven en el `.env`, sin tocar el compose:
`KAMAYUK_PUERTO_BASE`, `KAMAYUK_PUERTO_INGRESO`, `KAMAYUK_PUERTO_IDENTIDAD`, `KAMAYUK_PUERTO_CORREO`.

**Y si mueves el de Keycloak, mueve `KAMAYUK_OIDC_EMISOR` con él.**

## 2. Keycloak contesta `000` justo después de `up --wait`

`--wait` vuelve antes de que Keycloak sirva sus realms: no declara sonda en este compose, así que
sólo se comprueba que el contenedor corre. Medido: unos treinta segundos más. Espera por el
`.well-known`, no por el `up`.

## 3. Traefik contesta 404 a todo

**Sin ningún sistema levantado, es lo correcto.** Con uno levantado y el 404 en pie, mira la
versión de la imagen: hasta la v3.5 Traefik pide la API de Docker en la versión 1.24, fijada en su
código, y **Docker 29 elevó el mínimo a 1.44**. Con una imagen anterior el proveedor falla en
bucle, no descubre ni un servicio y contesta 404 a todo — indistinguible de «todavía no hay
ningún sistema», y sano según su propia sonda. Por eso el compose fija `traefik:v3.6`.

## 4. El compose no encuentra un archivo que sí está

`plataforma.compose.yaml` monta rutas **relativas al árbol**:
`./inicializacion-del-motor/…` y `../backend/sgtm-esquema/…/crear-roles.sql`. Un *bind mount* lo
resuelve **el demonio**, no el cliente, así que con un `DOCKER_HOST` remoto esas rutas tienen que
existir **en la máquina del demonio**, con el mismo camino. El síntoma es un archivo montado como
directorio vacío, y un motor que arranca sin roles.

La salida es copiar `despliegue/` y `backend/` a una ruta que exista igual en las dos máquinas y
levantar desde ahí.

## 5. La base arranca y no tiene ni bases ni roles

Los guiones de `docker-entrypoint-initdb.d` corren **una sola vez, con el volumen vacío**. Si el
volumen ya existe de un arranque anterior, no vuelven a correr y no hay ningún error.

```bash
docker compose -f despliegue/plataforma.compose.yaml down -v   # se lleva el volumen
```

Es también el motivo de que `plataforma.compose.yaml` tenga **volumen propio** y no comparta el de
`compose.yaml`: los dos crean bases distintas en su primer arranque, y compartir volumen dejaría
al segundo sin sus guiones de `initdb`.

## 6. `text search dictionary "unaccent" does not exist`

Estás en PostgreSQL 17 o 18. El esquema del producto no corre ahí: PG 17+ restringe el
`search_path` al inlinear una función SQL. Con PostgreSQL 16 pasa. En macOS con Homebrew el
`postgres` del `PATH` suele ser el 18; el 16 hay que nombrarlo entero.

## 7. `yarn verificar` pasa aquí y CI se pone rojo

Casi siempre es la versión de Node: CI fija la **22**. Y `typecheck` compila **dos** `tsconfig`
—el del código y `tsconfig.test.json`—; `tsc --noEmit` a secas deja pasar errores de las pruebas.

## 8. `verificar-el-ambiente.sh` dice que no concluye

Es lo correcto: `Pulumi.<ambiente>.yaml` declara una revisión que no está en el clon, y contar las
migraciones del árbol de trabajo sería contar otra versión. Trae la historia entera
(`fetch-depth: 0` en CI, `git fetch --unshallow` en local) y vuelve a correrlo.

## 9. Una rotura que «pasa en verde»

No es alivio: es un hallazgo. Las causas ya medidas:

- **La tarea no corrió.** `UP-TO-DATE` o `FROM-CACHE`. Se mide con `cleanTest --no-build-cache`.
  Si el archivo mutado vive fuera del módulo, decláralo como entrada de `test`.
- **El texto que buscas está también en un comentario.** Buscar una sentencia en el guion entero
  pasa en verde con la sentencia quitada, porque la misma cadena vive en el comentario que la
  explica. Acota la búsqueda a la sentencia.
- **La verificación no medía lo que parecía.** El caso caro: conectar como `kamayuk_owner` para
  demostrar una fuga de aislamiento deja todo en verde, porque con `FORCE ROW LEVEL SECURITY` el
  dueño también queda sujeto a la política. Hay que usar el superusuario del clúster.
