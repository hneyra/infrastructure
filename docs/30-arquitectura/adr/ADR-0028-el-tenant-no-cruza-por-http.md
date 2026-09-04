# ADR-0028 — El contexto de municipalidad no cruza por HTTP: token delegado, jamás una cabecera

| Campo | Valor |
|---|---|
| Estado | **Aceptado** |
| Fecha | 2026-09-03 |
| Decide | Dirección del proyecto |
| Extiende | [ADR-0002](ADR-0002-estrategia-multi-tenant.md) y [ADR-0005](ADR-0005-identidad-y-acceso.md) a la frontera entre sistemas |
| Cierra | El riesgo número uno del proyecto, en su forma nueva |


> Aceptado el 2026-09-04 por la direccion del proyecto, al contestar **D-22**: el producto lo opera un equipo central, no cada municipalidad. Ver [`D-22`](../../00-gobierno/D-22-quien-opera-cuatro-despliegues.md) en `infrastructure`.

## Contexto

El aislamiento entre municipalidades es el riesgo número uno, se construyó antes que cualquier caso
de uso y bloquea cada build. Lo sostienen tres piezas encadenadas:

1. el `municipalidad_id` sale **exclusivamente** del claim de un token validado (ADR-0005);
2. se fija una vez por transacción con `SET LOCAL`, jamás `SET SESSION`;
3. RLS lo aplica en el motor, con políticas sin valor por omisión: sin contexto, la consulta falla.

Ningúna de las tres sobrevive sola a una frontera HTTP. En cuanto un sistema llama a otro, aparece la
pregunta de como sabe el destino en qué municipalidad se está trabajando, y **la respuesta comoda es
una cabecera interna** —`X-Municipalidad`— que «sólo usan nuestros servicios». Es exactamente la
alternativa que ADR-0005 ya descartó para el cliente, con el mismo argumentó, y basta un servicio mal
expuesto o un *gateway* mal configurado para que todo el trabajo de RLS deje de valer.

Y el riesgo es peor que en el monolito, no igual: en el monolito el único camino hasta `SET LOCAL`
pasa por el filtro del token. Con cuatro sistemas hay también llamadas máquina a máquina y corridas
nocturnas sin usuario delante, que es donde la tentación aparece.

## Decisión

**Ningún sistema acepta el `municipalidadId` de un cuerpo, un parámetro de ruta, una cadena de
consulta ni una cabecera. Siempre sale de un token que el propio sistema valida.**

### 1. Llamada originada por un funcionario

El *gateway* intercambia el token del usuario por uno **delegado** con la audiencia del sistema
destino (RFC 8693, *token exchange*), conservando el sujeto y el claim `municipalidad_id`. El sistema
destino valida ese token como valida cualquier otro y fija su propio `SET LOCAL`.

La delegación se ve: el token lleva quien actua y en nombre de quien, y eso acaba en la bitacora de
los dos lados junto al `correlacionId`.

### 2. Corrida sin usuario

Una corrida —valuación, emisión, publicación de parámetros— se abre **por municipalidad** y recibe al
abrirse un token acotado a esa municipalidad y a esa operación. El token acota la corrida entera; no
hay un proceso con permiso sobre todas.

Es el mismo patron que el portal del ciudadano ya usa para lo contrario: `GET /portal/situacion` no
tiene ni un parámetro y **recorre el registro de municipalidades una a la vez**, con una transacción y
un `SET LOCAL` por rama ([ADR-0020](https://github.com/hneyra/rentas/blob/main/docs/30-arquitectura/adr/ADR-0020-la-sesion-del-ciudadano.md)). No es una consulta
multi-municipalidad: son N consultas de una municipalidad.

### 3. Los eventos

El sobre lleva `municipalidadId` porque el consumidor tiene que saber en que rama aplicar el hecho, y
eso **no es una excepción**: un evento no es una petición de un cliente, es un mensaje que el propio
sistema emisor firmo y que llega por un canal autenticado. Lo que se exige a cambio:

- el canal entre sistemas está autenticado y cifrado; un evento sin origen verificable se descarta;
- el consumidor fija `SET LOCAL` con ese valor y **una transacción por evento**, nunca un lote de
  varias municipalidades en la misma;
- la huella del cuerpo se verifica antes de aplicar.

### 4. Se verifica, no se confia

La regla de ArchUnit que hoy exige que **ningún método público de un contexto reciba
`municipalidadId`** se extiende a los controladores y a los clientes HTTP generados, y viaja en
`comun-verificaciones` con su clase de muestra que la viola. Una regla que no puede fallar no protege
nada.

Y la guardia del pool sigue igual: se paga una consulta de ida y vuelta por devolución de conexion
para verificar que no vuelve contaminada. En cuatro sistemas, cuatro veces.

## Consecuencias

- **Cada sistema valida tokens.** No hay uno que confie en que otro ya válido, que es como se
  construye una cadena donde el eslabon débil no se ve.
- **El *gateway* deja de ser solo enrutado** y pasa a ser una pieza de seguridad con su propia
  configuración que revisar. Es el precio de no tener cabeceras internas.
- **Una llamada cruzada mal configurada falla con `401` o `403`, no con datos de otra
  municipalidad.** Es la propiedad qué se compra.
- **La prueba de aislamiento se replica en los cuatro repositorios**, con su hallazgo heredado: la
  conexion que Testcontainers entrega por omisión es de superusuario, y un superusuario **omite RLS
  incluso con `FORCE ROW LEVEL SECURITY`**. Una prueba escrita sobre esa conexion pasa en verde sin
  verificar nada.
- **Hace falta una prueba nueva que el monolito no necesitaba**: que un token de la municipalidad A no
  obtiene ni un byte de la B a través de una llamada entre sistemas. Con sus dos casos: la llamada
  directa y la que pasa por el *gateway*.

## Lo descartado, y por qué

- **Una cabecera interna `X-Municipalidad`.** ADR-0005 ya la descartó «por lo obvio: es un dato que el
  cliente puede escribir». Qué la escriba un servicio nuestro no la hace inmanipulable; la hace
  invisible.
- **Una red privada como única defensa.** «Sólo nuestros servicios llegan ahi» es cierto hasta el día
  que deja de serlo, y ese día no hay ninguna otra capa.
- **Un token de servicio con permiso sobre todas las municipalidades.** Es un único secreto cuya fuga
  entrega el pais entero. Los tokens por corrida acotan el daño a una municipalidad y un ejercicio.
- **Propagar el token del usuario tal cual, sin cambiar la audiencia.** Un token emitido para
  `catastro` aceptado por `rentas` convierte cualquier fuga de token en acceso a los cuatro sistemas.
