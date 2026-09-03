# ADR-0005 — OIDC para autenticar; el modelo de permisos del manual para autorizar

**Estado:** Aceptado
**Fecha:** 2026-08-17

## Contexto

El manual (cap. 4) describe seguridad integrada con el dominio Windows: el usuario de red entra,
el sistema le pide una clave la primera vez, la cifra y la guarda; en adelante la valida. Sobre
eso, un modelo de autorización propio y detallado —módulos, accesos, grupos, usuarios, miembros,
permisos con siete privilegios— que los usuarios conocen y usan a diario.

En un producto multi-municipal, además, hace falta que la petición diga **en qué municipalidad**
se está trabajando, y que ese dato sea inmanipulable.

## Decisión

**Se separan las dos cosas:**

| | Dónde vive | Por qué |
|---|---|---|
| **Autenticación** (quién eres) | Proveedor OpenID Connect | Estándar, delegable a la identidad institucional, sin claves en la base |
| **Municipalidad activa** | Claim `municipalidad_id` del token validado | Es lo que alimenta `SET LOCAL`; tiene que estar firmado |
| **Autorización** (qué puedes hacer) | Base de datos, con el modelo del manual | Cambia a diario y lo administra el propio municipio |

El identificador de municipalidad se toma **exclusivamente** del token validado. Nunca de un
parámetro, un encabezado, el cuerpo o la sesión. Un token sin el claim recibe 403.

## Consecuencias

- Los usuarios conservan el modelo de permisos que ya conocen, con sus grupos y sus siete
  privilegios; la interfaz sigue mostrando las mismas pantallas de seguridad.
- Un alta de cajero no requiere tocar el proveedor de identidad más allá de crear la cuenta: los
  permisos los da el administrador del sistema desde la aplicación.
- La comprobación de permisos es **del servidor**. Que la interfaz oculte una opción es
  comodidad.
- El catálogo de accesos se siembra desde el catálogo de opciones, de modo que **una opción nueva
  aparece como acceso configurable**, tal como promete el manual.
- Queda pendiente el nombre del claim con la lista de municipalidades autorizadas de un usuario
  con acceso a varias (**D-06**).
- El **portal del contribuyente** ya no es una excepción de este ADR sino su gemelo:
  [ADR-0020](https://github.com/hneyra/rentas/blob/main/docs/30-arquitectura/adr/ADR-0020-la-sesion-del-ciudadano.md) le da **realm y emisor propios**, y su token
  lleva `numero_documento` donde el del funcionario lleva `municipalidad_id`. La regla es la misma
  —el sujeto sale exclusivamente del token validado—; lo que cambia es cuál es el sujeto. Con eso
  se cerró **D-07** el 2026-08-29.

## Alternativas consideradas

- **Todos los permisos en el proveedor de identidad** (roles y grupos del IdP). Descartado: los
  permisos del manual son de grano fino —por opción de menú y por privilegio— y cambian con la
  operación diaria. Cada cambio se convertiría en un ticket para quien opere la identidad.
- **Reproducir la integración con el dominio Windows.** No aplica a una aplicación web
  multi-municipal, y ataría el producto a un directorio concreto por municipio.
- **Confiar la municipalidad a un encabezado**, como hacen muchos sistemas multi-tenant.
  Descartado por lo obvio: es un dato que el cliente puede escribir.
