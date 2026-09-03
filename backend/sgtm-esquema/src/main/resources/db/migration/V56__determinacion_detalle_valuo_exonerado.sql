-- #395 — La capa web de la determinacion predial: el detalle por predio dice tambien que parte del
-- autovaluo NO esta afecta.
--
-- V20 nacio con `autovaluo` y `base_imponible_predio`, y con esas dos columnas la fila responde
-- «cuanto puso este predio» solo cuando el predio no tiene nada exonerado. Con una parte exonerada
-- —una inafectacion del articulo 17, la deduccion del articulo 19 aplicada sobre un predio— la
-- ponderacion deja de reconstruirse: `base = (autovaluo - exonerado) x % propiedad`, y sin el
-- sustraendo no hay forma de separar «este predio vale menos» de «esta parte no se grava».
--
-- Que se pierde sin ella, en concreto: el recalculo masivo (`predial_masivo`) toma los autovaluos
-- ya declarados del ejercicio y vuelve a determinar con el conjunto sellado de hoy. Sin esta
-- columna tendria que elegir entre suponer que no hay nada exonerado —lo que SUBE la base de todo
-- el que si lo tiene— o despejar el exonerado dividiendo la base por el porcentaje, que reintroduce
-- el error de redondeo que ADR-0018 evita. Las dos equivocaciones producen un padron con cifras
-- plausibles y ninguna senal.
--
-- Va con DEFAULT 0: las filas anteriores a esta migracion se escribieron cuando el unico camino de
-- escritura —#30— no admitia exoneracion, asi que cero es lo que declararon, no un valor supuesto.
-- El DEFAULT se retira despues de rellenar para que toda fila nueva tenga que decirlo.

ALTER TABLE determinacion_predio_detalle
    ADD COLUMN valuo_exonerado dinero NOT NULL DEFAULT 0
        CONSTRAINT det_predio_detalle_exonerado_ck CHECK (valuo_exonerado >= 0);

ALTER TABLE determinacion_predio_detalle
    ALTER COLUMN valuo_exonerado DROP DEFAULT;

-- La parte exonerada es una parte del autovaluo, nunca otra cifra: sin esto, un exonerado mayor
-- que el autovaluo daria una base negativa, que `base_imponible_predio >= 0` rechazaria despues
-- sin decir de donde viene.
ALTER TABLE determinacion_predio_detalle
    ADD CONSTRAINT det_predio_detalle_exonerado_cabe_ck
        CHECK (valuo_exonerado <= autovaluo);

COMMENT ON COLUMN determinacion_predio_detalle.valuo_exonerado IS
    'Parte del autovaluo que no esta afecta. La base ponderada del predio es'
    ' (autovaluo - valuo_exonerado) x porcentaje_propiedad (#395).';
