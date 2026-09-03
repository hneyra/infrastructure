-- ============================================================================
--  V64 — El tipo de transferencia es un vocabulario cerrado (#542)
--
--  `transferencia.tipo_transferencia` nacio en V2 como `varchar(40)` sin
--  restriccion, con este comentario encima:
--
--      -- El tipo decide la afectacion a alcabala: primera venta de constructora,
--      -- gobiernos, cuerpo de bomberos, anticipo de legitima, etc.
--
--  Lo primero es cierto a medias y lo segundo no lo comprobaba nadie:
--  `POST /api/v1/rentas/transferencias/predio` guardaba `XXXX` y contestaba 201.
--  El resto —quien vende (art. 22), quien compra (art. 28)— NO es el tipo del
--  acto, y por eso el comentario se rehace abajo en vez de conservarse.
--
--  ---------------------------------------------------------------------------
--  1. LOS NUEVE, Y DE DONDE SALEN
--  ---------------------------------------------------------------------------
--
--  Del catalogo portado del prototipo, que es la especificacion funcional. El
--  manual dibuja DOS desplegables «Tipo de acto» distintos, y esta es la union:
--
--    - «Transferencia de predio»  (7): COMPRA-VENTA, DONACION, PERMUTA,
--      ANTICIPO DE LEGITIMA, ADJUDICACION, DACION EN PAGO, SUCESION.
--    - «Transferencia de vehiculo» (5): COMPRA-VENTA, DONACION, REMATE,
--      HERENCIA, DACION EN PAGO.
--
--  REMATE y HERENCIA solo estan en la segunda, y el issue solo listaba la
--  primera. SUCESION y HERENCIA nombran el mismo hecho con dos palabras y NO se
--  funden: son dos rotulos que el manual imprime, y decidir aqui que uno es el
--  otro cambiaria en silencio lo que quedo registrado (#427).
--
--  El `CHECK` no distingue por `objeto`: no es la restriccion la que decide que
--  desplegable se dibuja —eso es del catalogo—, y estrecharla por objeto
--  rechazaria una fila legitima el dia que el manual mueva un rotulo de una
--  pantalla a la otra.
--
--  ---------------------------------------------------------------------------
--  2. POR QUE `NOT VALID`, Y POR QUE **NO** ES POR RLS
--  ---------------------------------------------------------------------------
--
--  DAT-01 §0 hallazgo 4 dice que una restriccion nueva sobre una tabla con RLS
--  no se puede validar. Eso es cierto de una CLAVE FORANEA —valida lanzando una
--  consulta, que queda sujeta a la politica— y se MIDIO que **no lo es de un
--  `CHECK`**: sobre una tabla con `FORCE ROW LEVEL SECURITY` y sin contexto de
--  tenant, en la misma sesion en que `SELECT count(*)` falla con
--  «unrecognized configuration parameter "app.municipalidad_id"», el
--  `ALTER TABLE ... ADD CONSTRAINT ... CHECK` **validado pasa**. El escaneo de
--  validacion de un `CHECK` no atraviesa la politica.
--
--  Asi que el motivo es el otro, y es de datos: **no se puede medir que hay hoy
--  en la columna** de las instalaciones desplegadas. Lo que si se sabe es que el
--  propio repositorio escribia otro vocabulario —`ejemplos/transferencias.csv`
--  sembraba `COMPRAVENTA` y `ANTICIPO_DE_LEGITIMA`, y la fixture de pruebas
--  `COMPRAVENTA`—, o sea que una fila que el `CHECK` rechaza es perfectamente
--  posible. Validado, ese `ALTER TABLE` falla con «is violated by some row» y
--  deja la instalacion sin migrar y sin arrancar; `NOT VALID` la despliega y no
--  debilita nada hacia adelante: la restriccion se comprueba en cada `INSERT` y
--  en cada `UPDATE` desde este momento (DAT-01 §0, misma mitigacion).
--
--  ---------------------------------------------------------------------------
--  3. LO QUE ESTA MIGRACION NO HACE CON LAS FILAS VIEJAS
--  ---------------------------------------------------------------------------
--
--  No las borra (regla 4, RNF-051) y **no las reescribe**. Un
--  `UPDATE transferencia SET tipo_transferencia = 'COMPRA_VENTA'
--   WHERE tipo_transferencia = 'COMPRAVENTA'` seria reclasificar un acto ya
--  registrado desde una migracion, sin observacion de nadie (regla 10) — y
--  ademas **no se puede**: se midio, y el migrador corre sin contexto de tenant,
--  de modo que el `UPDATE` sobre una tabla con RLS muere con
--  «unrecognized configuration parameter "app.municipalidad_id"». Lo que hace el
--  sistema con una fila asi es decirlo: `TipoTransferencia.de` lanza nombrando el
--  valor al leerla, en vez de hacerla pasar por otra cosa.
--
--  Lo que si se corrige, porque es dato de este repositorio y no de nadie mas,
--  son los dos archivos que escribian el vocabulario libre:
--  `infra/carga-de-datos/ejemplos/transferencias.csv` y `DatosDePrueba`.
--
--  ---------------------------------------------------------------------------
--  4. AQUI NO SE DECIDE NINGUNA ALCABALA
--  ---------------------------------------------------------------------------
--
--  `afecta_alcabala` sigue siendo una columna aparte y un dato declarado. El
--  manual dibuja la casilla «Genera alcabala» AL LADO del desplegable, y el
--  corpus VERIFICADO (`alcabala.md`) reparte las inafectaciones en tres
--  dimensiones: la naturaleza del acto (art. 27), quien adquiere (art. 28) y
--  quien vende (art. 22). De los nueve tipos, solo ANTICIPO_DE_LEGITIMA cuadra
--  letra por letra con un literal del art. 27. El razonamiento entero esta en el
--  javadoc de `TipoTransferencia`.
-- ============================================================================

ALTER TABLE transferencia
    ADD CONSTRAINT transferencia_tipo_ck
        CHECK (tipo_transferencia IN (
            'COMPRA_VENTA',
            'DONACION',
            'PERMUTA',
            'ANTICIPO_DE_LEGITIMA',
            'ADJUDICACION',
            'DACION_EN_PAGO',
            'SUCESION',
            'REMATE',
            'HERENCIA'))
        NOT VALID;

COMMENT ON COLUMN transferencia.tipo_transferencia IS
    'Que acto fue, de los nueve que dibujan los dos desplegables «Tipo de acto» '
    'del manual (pe.gob.sgtm.rentas.dominio.TipoTransferencia). NO decide la '
    'afectacion a alcabala: eso es afecta_alcabala, y depende ademas de quien '
    'adquiere (TUO LTM art. 28) y de quien vende (art. 22), que esta columna no '
    've (V64, #542).';
