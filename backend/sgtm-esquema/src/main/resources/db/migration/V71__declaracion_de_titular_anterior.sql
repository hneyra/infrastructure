-- ============================================================================
--  V71 — La deuda declarada «de un titular anterior» deja rastro (#653, #635)
--
--  #635 abrio la puerta: un alta o una baja de deuda sobre un predio o un
--  vehiculo que NO es del contribuyente al que se le carga se admite cuando
--  quien atiende declara que la deuda es de un ejercicio anterior a la
--  transferencia —el arbitrio de 2024 se le cobra a quien era titular en 2024,
--  y eso es correcto—. Lo que faltaba es la otra mitad: esa declaracion no se
--  escribia en ninguna parte, asi que la fila del libro y su fila de auditoria
--  quedaban IDENTICAS a las de un alta sobre la unidad propia. Lo que separa el
--  acto legitimo del error de teclear el predio equivocado es que alguien lo
--  diga, y no quedaba dicho.
--
--  Es un DATO, no una frase. La otra salida era componer la constancia dentro
--  del texto de la observacion, y se descarta por lo mismo que #488 rechazo
--  «inventar la observacion que falta»: la regla 10 exige la observacion para
--  que sea DEL USUARIO, y anadirle texto del sistema la convierte en otra cosa
--  —ademas de dejar el hecho dentro de una cadena que nadie puede consultar—.
--
--  Y NO es un valor mas de `acto` (V68). Un alta declarada de titular anterior
--  SIGUE SIENDO un alta: meterla como tercera constante dejaria fuera de
--  `acto = 'ALTA_DEUDA'` a toda consulta que hoy la cuenta, y el sintoma seria
--  que el panel deja de contar esas altas como emision del ejercicio sin que
--  nada lo diga. Son dos preguntas distintas y llevan dos columnas.
--
--  `NOT NULL DEFAULT false` no reescribe la tabla: desde PostgreSQL 11 un
--  DEFAULT no volatil se guarda en el catalogo y las filas existentes no se
--  tocan. Y `false` en ellas no es un relleno de conveniencia: es lo que de
--  verdad ocurrio —nadie lo declaro, porque hasta #635 no habia forma de
--  declararlo—.
--
--  El CHECK es la unica coherencia que se puede exigir: no se puede declarar
--  «la unidad es de otro» de un asiento que no tiene ninguna unidad. Se anade
--  validado: todas las filas existentes llevan `false`, asi que `NOT false` es
--  cierto en todas y el escaneo no puede encontrar ninguna violacion. Sobre el
--  escaneo de un CHECK en una tabla con FORCE ROW LEVEL SECURITY ya se midio en
--  V64 que pasa sin contexto de tenant.
--
--  Sin GRANT: V7 concede SELECT, INSERT sobre la TABLA —no por columna—, asi
--  que `sgtm_app` escribe y lee la columna nueva sin tocar privilegios, y el
--  REVOKE UPDATE de V7 la cubre igual. La fila del libro sigue siendo inmutable
--  (RNF-051, TABLAS_INMUTABLES).
-- ============================================================================

ALTER TABLE cuenta_corriente_asiento
    ADD COLUMN unidad_de_titular_anterior boolean NOT NULL DEFAULT false;

ALTER TABLE cuenta_corriente_asiento
    ADD CONSTRAINT asiento_titular_anterior_ck
        CHECK (NOT unidad_de_titular_anterior
               OR predio_id IS NOT NULL
               OR vehiculo_id IS NOT NULL);

COMMENT ON COLUMN cuenta_corriente_asiento.unidad_de_titular_anterior IS
    'Quien registro el movimiento declaro que el predio o el vehiculo NO es del '
    'contribuyente al que se le carga, porque la deuda es de un ejercicio '
    'anterior a la transferencia (#635, #653). Es una DECLARACION de quien '
    'atiende, no un hecho derivado del padron: la titularidad de hoy no dice '
    'quien era titular en el ejercicio de la deuda. false es «nadie lo '
    'declaro», que es lo que ocurre en todo asiento anterior a #635 y en todo '
    'asiento que no nace de un alta ni de una baja de deuda (V71).';
