# Identidad

## Por qué el realm está aquí y no configurado a mano

Un realm ajustado en la pantalla de administración no es reproducible: el día que
haya que levantar la instalación otra vez, nadie recordará qué casillas estaban
marcadas. [`realm-sgtm.json`](realm-sgtm.json) se importa al arrancar Keycloak y
fija tres cosas:

- **El atributo `municipalidad_id` del perfil de usuario, y el mapeador que lo
  pone en el token.** Es el claim de ADR-0005, del que sale el `SET LOCAL` y con
  él la separación entre municipalidades. Asignar a alguien a otra municipalidad
  es cambiar ese atributo, no tocar código.

  Declararlo en el perfil no es trámite. Dos motivos, y el segundo importa más:

  1. **Keycloak descarta en silencio los atributos que el perfil no declara.** El
     usuario se crea sin protestar, `kcadm` no dice nada, y el token sale sin el
     claim. Lo diagnosticó la escalera del despliegue: el último peldaño devolvió
     `SIN_MUNICIPALIDAD` donde esperaba `SIN_PRIVILEGIO`, que es exactamente para
     lo que sirve comparar códigos del catálogo en vez de solo códigos HTTP.
  2. **`edit: [admin]`** impide que un usuario se cambie a sí mismo de
     municipalidad desde la pantalla de su cuenta. Con ese atributo se decide qué
     padrón ve: si fuera editable por su dueño, el aislamiento entre
     municipalidades se configuraría desde el navegador del contribuyente.
- **`sgtm-backoffice`**, el cliente público de la interfaz, con PKCE `S256`
  obligatorio y sin secreto: una aplicación de navegador no tiene dónde guardar
  uno.
- **`sgtm-verificacion`**, con `direct access grants`, que es como CI consigue un
  token sin abrir un navegador. No sirve para personas: no tiene redirección.
- **`smtpServer`**, apuntando al buzón `correo` de la marcha blanca. Es lo que deja a
  Keycloak enviar el enlace de un solo uso con que un usuario nuevo fija su clave
  (ADR-0012). En el clúster, `Identidad.ts` reescribe este bloque con el relay del
  stack —host y remitente en claro; usuario y clave, si hace falta, del `Secret`
  `sgtm-<amb>-smtp`—.

**El archivo no lleva comentarios**, y no por estilo: Keycloak analiza el realm
con `RealmRepresentation` y **rechaza cualquier campo que no conozca**, así que un
`_comentario` al principio hace que la importación falle y el contenedor no
arranque. La explicación vive en este README, que es donde se puede leer sin
romper nada.

## Ni un usuario, ni una clave

El realm fija la **estructura**. Las personas y el grupo de cada municipalidad se
declaran —**sin clave**— en
[`municipalidades/<ubigeo>.json`](municipalidades/README.md), y los aplica
`reconciliar-identidades.sh` (ADR-0012), el mismo guion en el compose y en el clúster:

```bash
cd despliegue
docker compose up --wait aplicacion interfaz correo
./identidad/reconciliar-identidades.sh
```

Y lo mismo, contra el **otro realm**, con los ciudadanos que cada municipalidad enroló en
ventanilla —[`ciudadanos/<ubigeo>.json`](ciudadanos/README.md), ADR-0020 §5—:

```bash
./identidad/reconciliar-identidades.sh ciudadanos
```

Un guion y dos modos, como `reconciliar-realm.sh` es uno para los dos realms: lo que
cambia son el archivo, el realm y qué se comprueba al terminar; el procedimiento —crear
lo que falta, actualizar lo declarado, **no tocar la clave de quien ya existía**, y
comprobar— es idéntico, y una copia del último paso es una que un día deja de comprobar
lo suyo.

El usuario nuevo se crea **sin credenciales** y con `UPDATE_PASSWORD` pendiente;
Keycloak le manda un enlace de un solo uso —que en la marcha blanca cae en el buzón
`correo`, <http://localhost:8025>— y **fija su clave al entrar**. Nadie llega a ver una
clave. Idempotente: volver a correrlo no reenvía el correo ni toca a quien ya existe.

### Si a un usuario no le llegó el correo

Dos caminos, según haya SMTP o no; los dos terminan con el usuario eligiendo su clave.
`kc()` aquí es `docker compose exec -T identidad /opt/keycloak/bin/kcadm.sh`. El
equivalente para el clúster y las comprobaciones de que salió bien están en el runbook
[Recuperar el acceso de un usuario](../../docs/B0-operacion/runbooks/recuperar-el-acceso-de-un-usuario.md).

```bash
kc config credentials --server http://localhost:8080 --realm master \
  --user admin --password "$KAMAYUK_CLAVE_KEYCLOAK"
UID=$(kc get users -r sgtm -q username=<cuenta> -q exact=true \
  --fields id --format csv --noquotes | tr -d '\r' | sed -n 1p)

# A) Reenviar el enlace (con el buzon `correo` arriba). El anterior queda invalidado.
kc update "users/$UID/execute-actions-email" -r sgtm -b '["UPDATE_PASSWORD"]'

# B) Sin correo: clave TEMPORAL que Keycloak obliga a cambiar en el primer acceso.
#    Se entrega fuera de banda; no se escribe en un ticket.
kc set-password -r sgtm --username <cuenta> --new-password "$(openssl rand -base64 18)" --temporary
```

Un usuario **ya establecido** que olvidó su clave no necesita nada de esto: usa el enlace
«¿Olvidó su contraseña?» de la pantalla de acceso (`resetPasswordAllowed` está activo).

Lo mismo vale para un **ciudadano** enrolado, cambiando el realm por `sgtm-ciudadano` y la
cuenta por la derivada de su documento (`dni-70123456`). El caso B —clave temporal entregada
fuera de banda— es además el camino normal de quien no declaró correo.

El realm del ciudadano ([`realm-sgtm-ciudadano.json`](realm-sgtm-ciudadano.json)) trae su
propio `sgtm-verificacion` por lo mismo, y **solo llega hasta aquí**: `Identidad.ts` lo filtra
al derivar los documentos del clúster, porque el del ciudadano es el realm de cara al público y
una concesión directa de credenciales ahí es una puerta que nadie necesita. Lo comprueba
`infra/verificaciones/componentes.test.ts`: los clientes que llegan son exactamente
`["sgtm-portal"]`.

`crear-usuario.sh` sigue aquí para los usuarios `verificacion` de CI, que necesitan una
clave conocida para el *direct grant*:

```bash
./identidad/crear-usuario.sh verificacion 'su-clave' 1   # con municipalidad
./identidad/crear-usuario.sh sin-municipalidad 'su-clave' # sin el claim: para el 403
./identidad/crear-usuario.sh --reset jperez 'temporal' 1  # como el alta declarativa
```

El tercer argumento es la municipalidad. Omitirlo crea un usuario **sin** el claim, que
sirve para una sola cosa: comprobar que un token válido pero sin municipalidad recibe 403
y no llega a ningún controlador.

Un realm versionado que trae usuarios con contraseña es la forma más cómoda de
que esa contraseña acabe en producción. Por eso se separan, aunque cueste un paso
más al instalar.

## El emisor es una identidad, no una dirección de red

Es lo que más cuesta si se descubre por las malas. El navegador llega a Keycloak
por su nombre público —`http://localhost:8180` en la marcha blanca, un nombre con
TLS en una instalación real— y el backend lo alcanza por el nombre interno de la
red del compose, `identidad:8080`.

Por eso son dos ajustes distintos y no uno:

| Ajuste | Valor | Para qué |
|---|---|---|
| `issuer-uri` | el **público** | Se compara con el `iss` del token. Es lo que hace que un token de otro realm no valga |
| `jwk-set-uri` | el **interno** | De dónde se traen las claves para verificar la firma |

Con el público para las dos cosas, el backend pediría el JWKS a una dirección que
dentro de su contenedor es él mismo, y **todo** token sería inválido por un motivo
que no se parece en nada a su causa.

## Lo que esto no es

`start-dev`, sin TLS y con la base de Keycloak dentro del propio contenedor. Es lo
correcto para una marcha blanca detrás de un proxy y lo incorrecto para
producción, donde va `start` con su base y sus certificados. Una instalación real
además no usaría este realm: usaría el directorio de la municipalidad.
