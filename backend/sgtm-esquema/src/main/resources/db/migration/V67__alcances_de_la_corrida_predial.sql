-- ============================================================================
--  V67 — Los cuatro alcances de la corrida de emision predial (#577)
--
--  El desplegable del manual ofrece TODO EL PADRON / POR SECTOR / POR RANGO DE
--  CODIGO / SOLO OBSERVADOS, y `DeterminarPredialMasivo` solo admitia dos. Los
--  dos que faltaban no son sinonimos de nada: son dos formas de acotar la
--  emision anual, y la segunda —volver a correr sobre los que quedaron fuera—
--  es la que mas se usa en una campana.
--
--  Aqui va lo que la tabla necesita para poder CONTARLO. El rastro de #523
--  existe porque una corrida que no deja constancia de su alcance no se puede
--  reproducir: si la fila dijera «RANGO_DE_CODIGO» y no dijera que tramo, seria
--  exactamente la misma perdida con otro nombre.
-- ============================================================================

-- ---------- El alcance, con sus cuatro palabras ----------
-- `varchar(10)` no da: «RANGO_DE_CODIGO» son quince. Se amplia a 20, que es lo
-- que ya mide `modalidad` en la misma tabla.
ALTER TABLE corrida_predial
    DROP CONSTRAINT corrida_predial_alcance_check;

ALTER TABLE corrida_predial
    ALTER COLUMN alcance TYPE varchar(20);

ALTER TABLE corrida_predial
    ADD CONSTRAINT corrida_predial_alcance_ck
        CHECK (alcance IN ('TODOS', 'SECTOR', 'RANGO_DE_CODIGO', 'OBSERVADOS'));

-- ---------- El tramo, cuando el alcance es un tramo ----------
-- `varchar(20)` es lo que mide `contribuyente.codigo_contribuyente`: el tramo se
-- compara contra ese codigo y no contra otra cosa.
ALTER TABLE corrida_predial
    ADD COLUMN codigo_desde varchar(20),
    ADD COLUMN codigo_hasta varchar(20);

-- La misma guarda que el sector, por el mismo motivo: sin los dos extremos, «un
-- tramo» y «todo el padron» serian la misma corrida.
ALTER TABLE corrida_predial
    ADD CONSTRAINT corrida_predial_rango_ck
        CHECK (alcance <> 'RANGO_DE_CODIGO'
               OR (codigo_desde IS NOT NULL AND codigo_hasta IS NOT NULL));

COMMENT ON COLUMN corrida_predial.codigo_desde IS
    'Primer codigo de contribuyente del tramo, con alcance RANGO_DE_CODIGO. Se compara como texto: el codigo del padron es una cadena y ni siquiera es siempre numerica (#577).';

COMMENT ON COLUMN corrida_predial.codigo_hasta IS
    'Ultimo codigo del tramo, incluido (#577).';
