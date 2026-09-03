# Usuarios y grupos por municipalidad

> Los **funcionarios**. Su hermano para la otra población —los ciudadanos que esa municipalidad
> enroló en ventanilla, en el realm `sgtm-ciudadano`— es
> [`../ciudadanos/<ubigeo>.json`](../ciudadanos/README.md) (ADR-0020 §5).

Un archivo `<ubigeo>.json` por municipalidad. Es la **fuente versionada** de las personas y el
grupo de esa municipalidad en Keycloak, igual que [`../realm-sgtm.json`](../realm-sgtm.json) lo es
de la estructura del realm. Lo aplica [`../reconciliar-identidades.sh`](../reconciliar-identidades.sh)
—en el compose a mano, en el clúster desde un Job (ver
[`infra/componentes/Identidad.ts`](../../../infra/componentes/Identidad.ts))—.

**Ni una clave.** Un archivo versionado con contraseñas es la forma más cómoda de que una
contraseña acabe en producción (ADR-0012, ADR-0005). El usuario nuevo recibe un correo de Keycloak
con un enlace de un solo uso y **fija su clave en el primer acceso** (`UPDATE_PASSWORD`). Sin SMTP
configurado no llega el correo; el fallback está en [`../README.md`](../README.md).

## Forma

```json
{
  "ubigeo": "200101",
  "municipalidadId": 1,
  "grupo": "200101 - Municipalidad Provincial de Sullana",
  "usuarios": [
    { "cuenta": "jperez", "nombre": "Jorge", "apellido": "Perez",
      "correo": "jperez@sullana.gob.pe", "administrador": true }
  ]
}
```

| Campo | Qué es |
|---|---|
| `ubigeo` | Seis dígitos. Tiene que ser el mismo que el nombre del archivo y el que implanta `ImplantarMunicipalidad`. |
| `municipalidadId` | El **id numérico** que `ImplantarMunicipalidad` asignó a la fila de `municipalidad`. Sale de su log: `Municipalidad 200101 lista ... id 1`. Es lo que va al atributo `municipalidad_id` de cada usuario, de donde sale el claim (`::bigint` en RLS). La escalera de `despliegue.yml` cruza que coincida con la fila de la base y con el atributo en Keycloak. |
| `grupo` | Nombre del grupo de Keycloak (`/<grupo>`). Contenedor organizativo; lleva el atributo `municipalidad_id` de forma documental. **El claim sigue saliendo del atributo por usuario**, no del grupo. |
| `usuarios[].cuenta` | El `username` de Keycloak. **Tiene que ser el mismo `preferred_username`** con el que se crea la fila de `usuario` (ADR-0005). |
| `usuarios[].nombre` / `apellido` | `firstName` / `lastName`. Keycloak los exige para dar el perfil por completo; sin ellos el usuario existe y no puede entrar. Letras y espacios: nada de paréntesis (`person-name-prohibited-characters`). |
| `usuarios[].correo` | A esta dirección llega el enlace de `UPDATE_PASSWORD`. |
| `usuarios[].administrador` | `true` en **exactamente uno**. Es el que `ImplantarMunicipalidad` toma como primer administrador; `datos-de-implantacion.sh` lo deriva de aquí para que la cuenta no pueda divergir entre Keycloak y la fila de la base. |

## La otra mitad: la fila de `usuario` (#572)

Este archivo crea **la cuenta**, y una persona del SGTM son **dos mitades**: esta cuenta y su fila
en la tabla `usuario`, que es donde viven sus permisos (ADR-0005). Las dos tienen dueños distintos
y conviene tenerlo delante al añadir a alguien:

| Mitad | Quién la crea |
|---|---|
| Cuenta en Keycloak | **este archivo**, aplicado por `reconciliar-identidades.sh` |
| Fila de `usuario` | `ImplantarMunicipalidad`, **sólo para el `administrador: true`**; para el resto, `POST /api/v1/seguridad/usuarios` desde la pantalla «Nuevo usuario» |

**Declarar aquí a alguien no le crea su fila**, y hasta que exista esa fila autentica y el guardia
le niega todo — el síntoma es indistinguible de un permiso mal configurado. Y al revés: **dar de
alta la fila por pantalla no crea la cuenta**, y hasta que se declare aquí esa persona figura en
los listados y no puede entrar. El razonamiento entero, con lo que se midió para decidirlo, está en
[`ADR-0012` §5](../../../docs/30-arquitectura/adr/ADR-0012-usuarios-y-grupos-declarativos.md).

Así que el alta de un usuario que no sea el administrador son **dos pasos**, en cualquier orden:
añadir su entrada a `usuarios[]` de este archivo (y desplegar, para que el Job la reconcilie) y
darle de alta la fila desde la pantalla. La cuenta tiene que ser **la misma** en los dos sitios:
es lo único que las une.

## Idempotente

`reconciliar-identidades.sh` crea lo que falta y actualiza atributos, correo y nombre de lo que ya
existe. **Nunca borra**, y **nunca toca la clave ni las acciones pendientes de un usuario que ya
existía**: quitar a alguien de aquí no lo borra de Keycloak (se deshabilita a mano), y volver a
correr el guion no reenvía el correo de clave.
