-- ---------------------------------------------------------------------------
-- V16 — Instalacion de demostracion (#122, GOB-04 §3 N-5)
--
-- Mientras D-02a siga abierta, cualquier importe que el sistema muestre esta
-- calculado con parametros que nadie ha firmado. Una HR impresa con una cifra
-- plausible y sin marca es un documento que alguien puede intentar cobrar.
--
-- El hecho vive AQUI y no en configuracion, y esa es la decision del archivo.
-- Un `SGTM_DEMOSTRACION=true` en un archivo de entorno no se audita, no tiene
-- vigencia, y se edita sin que quede rastro (ADR-0007). Quitarle la marca a una
-- instalacion tiene que ser una escritura de `sgtm_owner` sobre esta columna
-- —la misma que da de alta la municipalidad—, no una casilla que alguien apaga
-- para que un papel salga limpio.
--
-- Por omision es `false`: una municipalidad que ya opera no se convierte en
-- demostracion porque el esquema avance.
-- ---------------------------------------------------------------------------

ALTER TABLE municipalidad
    ADD COLUMN es_demostracion boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN municipalidad.es_demostracion IS
    'Instalacion de demostracion: todo documento emitido bajo este tenant sale'
    ' marcado, en los tres formatos. Lo lee la capa de documentos, no cada'
    ' emisor. Solo sgtm_owner la escribe, como el alta de la municipalidad.';
