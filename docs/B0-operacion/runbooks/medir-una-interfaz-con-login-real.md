# Runbook — Medir una interfaz desplegada con un login real

| Campo | Valor |
|---|---|
| Cuándo | Hay que comprobar contra un ambiente desplegado que una interfaz **entra**: que el login PKCE termina, que el catálogo sale filtrado y que al menos una hoja lee un dato real. Lo exige [ADR-0040](https://github.com/hneyra/caja/blob/main/docs/30-arquitectura/adr/ADR-0040-la-ventanilla-se-conecta.md) antes de rutar la interfaz de `caja` en `prod` |
| Qué cubre | Dónde vive la credencial de la **cuenta de medición**, cómo se pide, cómo se consigue un token con ella y qué se puede afirmar con él. Y qué **no** se puede hacer con esa cuenta |
| Estado del ensayo | **No ensayado todavía contra ningún ambiente.** Lo que existe medido es el punto de partida (2026-09-16, `stg`): `https://<dominio>/caja/` → 200, su `configuracion.js` monta el emisor con `kamayuk-backoffice`, el emisor contesta su `.well-known` → 200, y `GET /caja/api/v1/seguridad/sesion` → **401**, que es lo correcto sin token. El primer recorrido entero se anota **aquí** en cuanto `stg` despliegue la versión de `identidad` que trae la cuenta (hneyra/identidad#49) |

## Qué es la cuenta de medición

Una cuenta del realm de funcionarios, `medicion-de-interfaces`, que existe **sólo donde se siembran
usuarios de prueba** (`kamayuk:keycloakSeedTestUsers`, hoy sólo `stg`). Tiene **dos mitades**, y las
dos hacen falta (ADR-0012 §5):

| Mitad | Quién la crea | Dónde |
|---|---|---|
| La cuenta en Keycloak, con su clave **permanente** | El `Job` que reconcilia el realm, desde la fila `MEDICION` del TSV que deriva `infra/componentes/Identidad.ts` | realm `kamayuk` |
| Su fila de `usuario`, su grupo «Medicion de interfaces» y sus permisos | `ImplantarMunicipalidad` de `identidad` (hneyra/identidad#49) | base de `identidad`, y de ahí a las copias locales por el buzón |

**Lo que puede hacer es leer, y nada más.** Su grupo recibe `LECTURA` sobre las opciones de los
cuatro satélites y **ninguna de `identidad`**: no administra permisos, ni usuarios, ni grupos. Con
ella no se cobra un recibo ni se cierra una caja — a propósito: medir es abrir y leer.

## Dónde vive la credencial, y cómo se pide

**En el `Secret` `kamayuk-<amb>-keycloak` del namespace `kamayuk-<amb>`, bajo la clave
`clave-de-medicion`.** Es el mismo `Secret` que ya guarda la clave del administrador de Keycloak y la
inicial del administrador del realm, y está declarado en el inventario
([`infra/componentes/secretos.ts`](../../../infra/componentes/secretos.ts)) con su rotación
—**semestral**—.

- La **genera** `infra/secretos/bootstrap-secretos.sh`, como las demás. Nunca `pulumi up`
  ([ADR-0011](../../30-arquitectura/adr/ADR-0011-infraestructura-como-codigo.md) §3).
- La **fija en la cuenta** el `Job` del realm, en **cada** corrida: rotarla en el `Secret` y volver a
  correr el `Job` es todo lo que hace falta para rotarla de verdad.
- **No está en este repositorio, ni puede estarlo**, y hay una guarda que lo sostiene
  (`infra/verificaciones/la-cuenta-de-medicion.test.ts`).

**Para leerla hace falta el `KUBECONFIG` del ambiente**, que es la misma credencial de operación con
la que se despliega y vive en el *environment* `stg` de GitHub Actions (secreto `KUBECONFIG`), no en
ninguna máquina de trabajo. Quien no lo tenga, lo pide a quien opera la plataforma; no hay un segundo
sitio donde esté.

```bash
export KUBECONFIG=<el de stg>
AMB=stg
kubectl -n kamayuk-$AMB get secret kamayuk-$AMB-keycloak \
  -o jsonpath='{.data.clave-de-medicion}' | base64 -d; echo
```

**La clave no se pega en un chat, un ticket ni un mensaje**, y no se escribe en la línea de órdenes:
va por un archivo de un directorio temporal con permisos `700`, como hace
`infra/observabilidad/verificar-login-de-grafana.sh`.

## Conseguir un token

El cliente `kamayuk-backoffice` es **público y con PKCE**: no sirve para pedir un token sin
navegador. El que sirve es `kamayuk-verificacion`, que existe por eso y **sólo donde se siembran
usuarios de prueba** (INF-03 §4).

```bash
PRIVADO=$(mktemp -d); chmod 700 "$PRIVADO"; trap 'rm -rf "$PRIVADO"' EXIT
kubectl -n kamayuk-$AMB get secret kamayuk-$AMB-keycloak \
  -o jsonpath='{.data.clave-de-medicion}' | base64 -d > "$PRIVADO/clave"

TOKEN=$(curl -sS --fail-with-body \
  -d grant_type=password \
  -d client_id=kamayuk-verificacion \
  -d username=medicion-de-interfaces \
  --data-urlencode "password@$PRIVADO/clave" \
  "https://<dominio>/keycloak/realms/kamayuk/protocol/openid-connect/token" \
  | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
```

**Si contesta `invalid_grant` / «Invalid user credentials», casi nunca es la clave.** Es lo que
contesta Keycloak cuando la cuenta tiene `UPDATE_PASSWORD` pendiente, y por eso esta cuenta nace sin
esa acción y el `Job` del realm lo **comprueba** al terminar. El mismo síntoma se midió en el
compose y está escrito en la cabecera de `despliegue/identidad/preparar-identidades.sh`.

## Qué se puede afirmar con él

```bash
curl -sS -H "Authorization: Bearer $TOKEN" https://<dominio>/caja/api/v1/seguridad/sesion
curl -sS -H "Authorization: Bearer $TOKEN" https://<dominio>/caja/api/v1/seguridad/sesion/permisos
```

- `/seguridad/sesion` → **200**, con la cuenta y su municipalidad. Sin token daba 401.
- `/seguridad/sesion/permisos` → las **siete** claves de `caja` —`caja_tributaria`, `caja_tasas`,
  `duplicado_recibo`, `anulacion_recibo`, `cierre_caja`, `avance_recaudacion`, `recaudacion_area`—
  con `lectura`, y sin ningún otro privilegio. Si faltan, lo que falta es la **réplica**: el buzón de
  `identidad` se lee cada cinco minutos y la ventana medida es de ~2 min 36 s típica y ~5 min 10 s en
  el peor caso ([`identidad-4-la-ventana-de-la-copia-local.md`](../../00-gobierno/identidad-4-la-ventana-de-la-copia-local.md)).

Las cinco lecturas que la interfaz de `caja` compone su sesión con ellas son
`/seguridad/{modulos,accesos}` y `/seguridad/sesion{,/permisos,/municipalidad}` (ADR-0042).

## Lo que esta cuenta NO abre

- **No administra nada.** Ninguna opción de `identidad`: ni permisos, ni usuarios, ni grupos, ni el
  buzón. Un 403 en una de esas pantallas con esta cuenta **es lo correcto**.
- **No escribe.** Sólo `LECTURA`. Un 403 al intentar cobrar, anular o cerrar **es lo correcto**.
- **No existe en `prod`.** Ahí no hay cliente de verificación, ni cuentas de prueba, ni esta clave.
  Medir `prod` con un login real es otra decisión y necesitaría otra cosa.

## Si algo falla

| Síntoma | Qué es | Remedio |
|---|---|---|
| `kubectl` no encuentra la clave `clave-de-medicion` | El `Secret` es de antes de #196, o el ambiente no siembra usuarios de prueba | Correr `infra/secretos/bootstrap-secretos.sh` para ese ambiente; comprobar `kamayuk:keycloakSeedTestUsers` en su `Pulumi.<amb>.yaml` |
| El token sale, pero `/seguridad/sesion` da **403** | La cuenta existe en el emisor y **no tiene fila** en la copia local de ese sistema | La escribe la implantación de `identidad` y llega por el buzón: comprobar que la versión desplegada de `identidad` trae hneyra/identidad#49 y que el `CronJob` del consumidor de ese sistema corrió |
| `/sesion/permisos` sale vacío o corto | La réplica todavía no llegó | Esperar la ventana (hasta ~5 min) y repetir. Si no llega, mirar el `CronJob` `kamayuk-<sistema>-consumidor-de-identidad` |
| `invalid_grant` | `UPDATE_PASSWORD` pendiente, o la clave rotó y el `Job` del realm no ha vuelto a correr | Volver a correr el `Job` del realm: fija la clave del `Secret` en cada corrida |
