-- ============================================================================
--  MUESTRA QUE VIOLA LA GUARDA DE C-3. No se aplica a ninguna base.
--
--  Es el texto que el generador emitia antes de C-3: `pg_get_constraintdef` ya
--  traia el sufijo ` NOT VALID` y el emisor le anadia otro. Una regla que no
--  puede fallar no protege nada, asi que aqui esta la que la pone roja.
--
--  La linea 4 nombra el defecto EN PROSA -- NOT VALID NOT VALID -- a proposito:
--  la guarda quita los comentarios antes de buscar, y si dejara de hacerlo esta
--  muestra la delataria dando DOS hallazgos donde debe dar uno.
-- ============================================================================

CREATE TABLE muestra_c3 (id bigint PRIMARY KEY, otra_id bigint, v int);

-- 1. Un CHECK con el sufijo repetido: el caso mayoritario de las 36 de `rentas`.
ALTER TABLE muestra_c3 ADD CONSTRAINT muestra_c3_v_ck CHECK ((v > 0)) NOT VALID NOT VALID;

-- 2. Una foranea, que es donde P5D lo encontro en `caja` (`recibo_turno_fk`).
ALTER TABLE muestra_c3 ADD CONSTRAINT muestra_c3_otra_fk FOREIGN KEY (otra_id)
    REFERENCES muestra_c3(id) NOT VALID NOT VALID;

-- 3. En regla: UN solo sufijo. Sin este contraste, una guarda que gritara ante
--    cualquier `NOT VALID` pasaria esta muestra y no serviria para nada.
ALTER TABLE muestra_c3 ADD CONSTRAINT muestra_c3_v2_ck CHECK ((v < 1000)) NOT VALID;
