-- ============================================================================
--  V68 — El libro dice de que ACTO nace cada asiento (#601)
--
--  Dar de alta una deuda y darla de baja despues dejaba la cartera pendiente
--  correcta y «lo cargado» inflado. Medido contra la instalacion de
--  demostracion: seis altas de S/ 100 y cinco bajas que las deshacen devuelven
--  la cartera al centimo (13 783,75) y dejan lo cargado en 14 383,82. Como «lo
--  cargado» es el DENOMINADOR de todas las barras del panel de recaudacion, el
--  avance baja sin que nadie haya dejado de pagar, y es acumulativo: el panel se
--  degrada justo por corregir bien.
--
--  ---------------------------------------------------------------------------
--  1. POR QUE HACE FALTA UNA COLUMNA, Y NO BASTA CON UN FILTRO
--  ---------------------------------------------------------------------------
--
--  #56 cerro la misma forma para la anulacion de recibo: `Asiento#reversionDe`
--  produce el asiento contrario CON EL MISMO CONCEPTO, asi que la consulta de lo
--  cargado gano `asiento_reversado_id IS NULL` y su `NOT EXISTS`. La baja de
--  deuda no pasa por ese filtro, porque **no es una reversion**: es un asiento
--  nuevo.
--
--  Y no se podia distinguir con lo que el libro ya guardaba. Un abono de baja de
--  deuda y un abono de cobranza son, columna a columna, el mismo asiento:
--
--    tipo     = 'ABONO'      en los dos    (`MovimientoDeDeuda#enAsientos` y
--    concepto = 'INSOLUTO'   en los dos     `RegistroDeAbonos#abonarPagoIntegro`)
--
--  Las demas columnas tampoco sirven, y cada una por su motivo:
--
--    - `concepto` NO puede cambiar. Dice CONTRA QUE parte se imputa, y
--      `CalculoDeDeuda#netear` y `ProyeccionDelSaldo` netean POR concepto: una
--      baja escrita como 'ANULACION' dejaria de restar del insoluto y la deuda
--      no bajaria. Se midio leyendo las dos funciones puras; es el motivo por el
--      que el javadoc de `MovimientoDeDeuda#enAsientos` ya decia «los conceptos
--      son los del desglose, no ANULACION ni CONDONACION».
--    - `motivo` es la observacion del usuario (regla 10, RNF-052), texto libre
--      que `RegistrarAsiento` escribe con la `Observacion` de quien asienta.
--    - `documento_origen` es el SUSTENTO que teclea quien registra: la
--      resolucion que aprueba el acto.
--    - `asiento_reversado_id` solo vale para una reversion exacta de UN asiento;
--      una baja puede ser parcial y puede caer sobre deuda que vino de la
--      emision masiva, o sea de muchos cargos.
--
--  Asi que lo que faltaba era justo lo que el AC 4 del issue pide: que el libro
--  sepa POR QUE existe el asiento, mas alla de contra que se imputa. Esa es esta
--  columna.
--
--  ---------------------------------------------------------------------------
--  2. POR QUE SOLO DOS VALORES, Y NULL PARA TODO LO DEMAS
--  ---------------------------------------------------------------------------
--
--  Los dos actos de RF-043 y RF-044 —el alta (nota de abono) y la baja (nota de
--  cargo)— son los unicos que hoy necesitan decirse. El resto de caminos que
--  escriben en el libro deja `acto` en NULL, y eso NO significa «no se sabe»:
--  significa «este asiento no nacio de un alta ni de una baja de deuda». La
--  consulta lo trata asi, y por eso una cobranza —que es NULL— nunca se resta.
--
--  Se declara `ALTA_DEUDA` aunque hoy ninguna consulta lo lea: los dos salen del
--  mismo `MovimientoDeDeuda#enAsientos` y estampar solo uno dejaria la columna
--  diciendo media verdad — un alta indistinguible de una emision masiva, cuando
--  el sistema si sabe cual es cual.
--
--  ---------------------------------------------------------------------------
--  3. LO QUE ESTA MIGRACION NO HACE CON LAS FILAS VIEJAS
--  ---------------------------------------------------------------------------
--
--  No las reescribe, y **no puede**: `cuenta_corriente_asiento` tiene RLS con
--  `FORCE` y el migrador corre sin contexto de tenant, de modo que un `UPDATE`
--  desde aqui muere con «unrecognized configuration parameter
--  "app.municipalidad_id"» (DAT-01 §0 hallazgo 4; medido igual en V64). Y aunque
--  se pudiera, `sgtm_app` no tiene `UPDATE` sobre esta tabla desde V7 y el libro
--  no se corrige, se reversa (V2, regla 4).
--
--  Consecuencia, dicha para que nadie la descubra despues: las bajas ANTERIORES
--  a esta migracion siguen sin poder distinguirse de un cobro, y la inflacion
--  que ya tiene el panel de una instalacion en marcha **no se repara sola**. Lo
--  que este cambio arregla es de aqui en adelante.
--
--  El `CHECK` va validado —no `NOT VALID`—: la columna nace y todas las filas
--  existentes quedan en NULL, que la restriccion admite, asi que no hay ninguna
--  fila que pueda violarla. Sobre el escaneo de validacion de un `CHECK` en una
--  tabla con `FORCE ROW LEVEL SECURITY` ya se midio en V64 que pasa sin contexto
--  de tenant.
--
--  No hace falta ningun `GRANT`: V7 concede `SELECT, INSERT` sobre la TABLA
--  —no por columna—, asi que `sgtm_app` escribe y lee la columna nueva sin
--  tocar privilegios, y el `REVOKE UPDATE` de V7 la cubre igual.
-- ============================================================================

ALTER TABLE cuenta_corriente_asiento
    ADD COLUMN acto varchar(20);

ALTER TABLE cuenta_corriente_asiento
    ADD CONSTRAINT asiento_acto_ck
        CHECK (acto IS NULL OR acto IN ('ALTA_DEUDA', 'BAJA_DEUDA'));

COMMENT ON COLUMN cuenta_corriente_asiento.acto IS
    'De que acto nace el asiento, cuando el libro lo sabe: ALTA_DEUDA o '
    'BAJA_DEUDA (RF-043, RF-044). NULL es «no nacio de un alta ni de una baja» '
    '—una emision, una cobranza, una reversion—, no «se desconoce». Es lo que '
    'permite que «lo cargado» del panel reste las bajas sin restar los cobros: '
    'el abono de una baja y el de una cobranza son el mismo asiento columna a '
    'columna, y la distincion se hace por el acto, nunca por el signo '
    '(V68, #601).';
