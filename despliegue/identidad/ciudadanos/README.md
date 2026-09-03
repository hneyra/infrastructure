# Ciudadanos enrolados en ventanilla

Un archivo `<ubigeo>.json` por municipalidad, **hermano** de
[`../municipalidades/<ubigeo>.json`](../municipalidades/README.md). Es la fuente versionada de
las cuentas del realm **`sgtm-ciudadano`** (ADR-0020) que esa municipalidad acreditó con el
documento delante. Lo aplica el mismo guion, en su segundo modo:

```bash
cd despliegue
./identidad/reconciliar-identidades.sh ciudadanos
```

## Por qué esto y no una pantalla

Enrolar no es «dar de alta a un usuario»: es **fijar una identidad**. Lo que el sistema crea aquí
es lo que creerá para siempre sobre quién es quien consulta, porque `numero_documento` viaja
firmado en cada token del portal y `GET /portal/situacion` **no tiene ni un parámetro**: el sujeto
sale de ese claim y de ningún otro sitio.

Si esa acreditación se hace mal no se rompe una pantalla: la enumeración por parámetro que
[ADR-0020](../../../docs/30-arquitectura/adr/ADR-0020-la-sesion-del-ciudadano.md) retiró vuelve
convertida en una **enumeración firmada, y para siempre**. Esa clase de acto es exactamente la que
[ADR-0012](../../../docs/30-arquitectura/adr/ADR-0012-usuarios-y-grupos-declarativos.md) sacó del
navegador, y por eso el enrolamiento **no añade una pantalla 135**: las 134 siguen siendo 134
(ADR-0020 §5, confirmada).

El costo se dice de frente: **el ciudadano que va a ventanilla no sale enrolado, sale esperando el
despliegue**. Es lo que se paga a cambio de que el acto tenga diff, revisor y corrida reproducible.

## Forma

```json
{
  "ubigeo": "200101",
  "ciudadanos": [
    {
      "nombre": "Rosa",
      "apellido": "Chero Zapata",
      "tipoDocumento": "DNI",
      "numeroDocumento": "70123456",
      "correo": "rosa.chero@ejemplo.pe"
    }
  ]
}
```

| Campo | Qué es |
|---|---|
| `ubigeo` | Seis dígitos, el mismo que el nombre del archivo. **Es quien acredita**: el número declarado tiene que figurar en el padrón de *esta* municipalidad, y eso se cruza contra la base. |
| `ciudadanos` | Puede estar **vacío**: una municipalidad que todavía no enroló a nadie declara `[]`, y eso es distinto de que falte el archivo. |
| `nombre` / `apellido` | `firstName` / `lastName`. Keycloak los exige para dar el perfil por completo; sin ellos la cuenta existe y no puede entrar. Letras y espacios: nada de paréntesis (`person-name-prohibited-characters`). |
| `tipoDocumento` | Uno de los seis de `TipoDocumento` —`DNI`, `RUC`, `CE`, `PASAPORTE`, `PARTIDA`, `OTRO`—, los mismos que admite `contribuyente.tipo_documento`. |
| `numeroDocumento` | Dígitos y letras mayúsculas, con **la forma que su tipo exige**: un DNI son ocho dígitos y un RUC once. Es la misma validación que hace `DocumentoIdentidad` en el dominio, porque un número que el dominio no puede leer produce un token que el backend rechaza con `403 SIN_DOCUMENTO`. |
| `correo` | **Opcional.** Con él, Keycloak manda el enlace de un solo uso con que el ciudadano fija su clave; sin él la cuenta nace igual —con `UPDATE_PASSWORD` pendiente— y la clave se entrega fuera de banda (ver [`../README.md`](../README.md)). Un padrón real tiene mucha gente sin correo, y exigirlo dejaría fuera del portal justo a quien va a ventanilla. |

## Lo que NO se declara aquí

- **La cuenta.** Se **deriva** del documento: `<tipo en minúsculas>-<número>`, o sea `dni-70123456`.
  Se deriva y no se declara por dos motivos. El primero es que así la fila `ACCESO` que el portal
  deja en la bitácora de cada municipalidad identifica al ciudadano **por su documento**, sin
  publicar ahí nada que en esa municipalidad no se supiera ya —el documento ya está en su padrón—.
  El segundo es que una cuenta declarable se puede declarar *distinta* del documento, y entonces la
  bitácora deja de identificar a nadie.

  Y lleva el tipo delante, no solo el número: `CE 12345678` y `DNI 12345678` son **dos personas
  distintas** y las dos formas son válidas (`TipoDocumento`). Con la cuenta llamada solo por el
  número, la segunda declaración actualizaría la cuenta de la primera y le cambiaría el
  `tipo_documento`: a partir de ahí una de las dos leería el padrón de la otra.

- **Ninguna clave, nunca** (ADR-0012 §2). Ni `credentials`, ni `password`, ni `secret`: el guion
  rechaza el archivo que los traiga, nombrándolo. Un archivo versionado con contraseñas es la forma
  más cómoda de que una contraseña acabe en producción.

- **`municipalidad_id`.** El ciudadano **no pertenece a ninguna municipalidad** y su token no lleva
  ese claim: lo que ve sale de recorrer el registro, una municipalidad a la vez (ADR-0020 §2). Por
  lo mismo, la cuenta no se afilia a ningún grupo.

## Idempotente

Reconciliar dos veces no cambia nada: se crea lo que falta, se actualizan nombre, apellido y correo
de lo que ya está, y **nunca** se toca la clave ni las acciones pendientes de una cuenta que ya
existía. Quitar a alguien de aquí no lo borra de Keycloak; se deshabilita a mano.

Una misma persona puede estar declarada por **dos municipalidades** —las dos la tuvieron delante—, y
entonces las dos declaraciones tienen que decir exactamente lo mismo. Si no, el archivo se rechaza
nombrando a las dos: dos municipalidades que afirman cosas distintas del mismo documento es una
contradicción, y resolverla por orden alfabético de archivo sería dejar que decida el nombre del
ubigeo.
