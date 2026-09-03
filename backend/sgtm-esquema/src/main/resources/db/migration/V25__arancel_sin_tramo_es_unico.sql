-- ============================================================================
--  V25 — Un arancel sin tramo tambien es unico por via y conjunto
--
--  arancel_uq (V18) es UNIQUE (municipalidad_id, conjunto_id, via_id, tramo), y en
--  PostgreSQL (como en el estandar SQL) NULL no es igual a NULL: esa restriccion deja
--  pasar dos filas para la MISMA via en el MISMO conjunto mientras las dos tengan tramo
--  NULL. No es un caso raro: es el caso comun. Arancel.java convierte a NULL cualquier
--  tramo vacio -- "nulo cuando la via tiene un solo arancel" -- y esa es la forma que
--  tiene casi toda via real: del plano grafico de aranceles de Catacaos (scripts/
--  valores-normativos/importar_arancel_via_gpkg.py), 246 de 259 vias tienen tramo NULL.
--
--  El sintoma: reimportar el mismo archivo de aranceles contra un conjunto todavia
--  abierto no rechaza la fila repetida -- la duplica en silencio. Es exactamente la
--  propiedad que ImportarVias (#121) exige y prueba ("reimportar no duplica") y que,
--  sin este indice, la base no garantiza para ImportarArancel en el caso sin tramo.
--
--  Se resuelve con el patron estandar de PostgreSQL para tratar NULL como un unico
--  valor a efectos de unicidad: un indice unico parcial. arancel_uq sigue cubriendo el
--  caso con tramo; este indice cubre el caso sin. La tabla sigue vacia (D-02: sin
--  valores normativos cargados todavia), asi que no hay fila existente que pueda
--  violarlo.
-- ============================================================================

CREATE UNIQUE INDEX arancel_sin_tramo_uq
    ON arancel (municipalidad_id, conjunto_id, via_id)
    WHERE tramo IS NULL;

COMMENT ON INDEX arancel_sin_tramo_uq IS
    'Complementa arancel_uq (V18): NULL <> NULL en una UNIQUE normal, asi que sin este'
    ' indice dos cargas de la via sin tramo del mismo conjunto no chocan.';
