-- ============================================================================
--  V10 — Un ejercicio puede tener mas de un conjunto sellado (ARQ-09 §3)
--
--  V9 creo conjunto_sellado_uq con este razonamiento: «con dos conjuntos
--  sellados, ninguna consulta podria decir cual se aplico». El razonamiento es
--  falso, y el indice prohibia el escenario que ARQ-09 §3 exige soportar:
--
--    > La diferencia importa exactamente cuando hubo mas de una version en el
--    > mismo ejercicio —un arancel corregido, una ordenanza modificada a mitad
--    > de ano—, que es el caso en que un modelo ingenuo por ejercicio falla en
--    > silencio.
--
--  Quien dice cual se aplico no es una consulta por ejercicio: es la propia
--  determinacion, que guarda determinacion.conjunto_id NOT NULL con su clave
--  foranea. El dato siempre estuvo; faltaba leerlo por ahi.
--
--  Corregir un arancel a mitad de ano crea una version nueva y la sella. Las
--  determinaciones ya emitidas siguen apuntando a la anterior y se reproducen
--  al centimo; las nuevas usan la vigente, que es la de mayor version.
--
--  Lo que NO cambia: conjunto_uq (municipalidad_id, ejercicio, version) sigue
--  impidiendo dos conjuntos con la misma version, y los disparadores de V9
--  siguen haciendo inmutable todo lo sellado. Se levanta una restriccion de
--  mas, no las garantias.
-- ============================================================================

DROP INDEX conjunto_sellado_uq;

-- El indice se va, pero la consulta del conjunto vigente —el sellado de mayor
-- version— pasa a ser frecuente y merece su indice.
CREATE INDEX conjunto_sellado_vigente_ix
    ON conjunto_parametros (municipalidad_id, ejercicio, version DESC)
    WHERE estado = 'SELLADO';

COMMENT ON INDEX conjunto_sellado_vigente_ix IS
    'El conjunto vigente de un ejercicio es el sellado de mayor version; puede haber varios.';
