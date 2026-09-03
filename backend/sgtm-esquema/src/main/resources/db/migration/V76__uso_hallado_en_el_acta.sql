-- ============================================================================
--  V76 — El acta de fiscalizacion anota el uso hallado, y con el `Hallazgo`
--        gana su quinto valor (#599, sale de #546)
--
--  ---------------------------------------------------------------------------
--  1. QUE FALTABA, Y POR QUE NO ERA UNA LECTURA
--  ---------------------------------------------------------------------------
--
--  La fiscalizacion predial persigue DOS hallazgos: el area y el uso. El acta
--  guardaba `area_hallada` (V4) y **ninguna columna de uso**, asi que un
--  inspector que encuentra una vivienda convertida en comercio no tenia donde
--  anotarlo — y el sistema no podia distinguir ese caso de uno conforme.
--
--  De ahi salian tres bloqueos encadenados, y los tres se cierran con esta
--  columna:
--
--    a. `Hallazgo` (Java) tenia CUATRO valores donde `CondicionFiscalizada`
--       tiene cinco. El que falta es `USO_DISTINTO`, y #546 se nego a anadirlo
--       —con el motivo escrito en el javadoc— porque un acta que anota un
--       hallazgo que no puede sustentar es peor que una que no lo ofrece: el
--       campo `hallazgo` es OPCIONAL, asi que una palabra que el enumerado no
--       reconoce no deja una lista vacia, deja un acta registrada SIN hallazgo.
--
--    b. El uso observado lo tecleaba **quien liquida** —argumento de
--       `LiquidarFiscalizacion.liquidar`—, no quien visito. Desde esta
--       migracion lo anota el acta y la liquidacion lo LEE de ella; corregirlo
--       sigue siendo reliquidar, que es donde `CorreccionDeLinea.usoHallado` ya
--       vivia.
--
--    c. El `GET` de actas no tenia nada honesto que publicar en esa columna.
--
--  ---------------------------------------------------------------------------
--  2. EL TIPO SALE DEL LADO DECLARADO, NO SE ELIGE
--  ---------------------------------------------------------------------------
--
--  `varchar(60)`, que es exactamente lo que ya tienen `ficha_catastral.uso`
--  (V1) —el lado DECLARADO contra el que esto se compara— y
--  `liquidacion_detalle.uso_hallado` (V39) —donde acaba copiado—. Un tipo
--  distinto en cualquiera de los tres extremos truncaria en silencio en la
--  frontera, que es la clase de defecto que la carga vehicular de V55 destapo
--  ejecutando.
--
--  ---------------------------------------------------------------------------
--  3. LAS TRES COSAS QUE SE ATAN, Y POR QUE EN LA BASE
--  ---------------------------------------------------------------------------
--
--    a. El `CHECK` de columna de `hallazgo` (V4) enumera los cuatro valores.
--       Anadir el quinto al enumerado de Java SIN ampliarlo aqui deja un 23514
--       que ninguna prueba de Java ve: el `if` del dominio deja pasar la fila y
--       la para el motor. Es el reparto que V64 documento para el tipo de acto
--       de una transferencia. Patron de V58: DROP + ADD en un solo ALTER.
--
--    b. `acta_fisc_uso_hallado_predial_ck`: el uso hallado solo tiene sentido
--       en un acta PREDIAL. Un vehiculo no tiene uso declarado contra el que
--       contrastar, asi que un acta vehicular con uso hallado afirma algo que
--       ningun vehiculo tiene. Es el mismo trato que V24 le dio a la ficha con
--       `acta_fisc_predio_xor_vehiculo_ck`.
--
--    c. `acta_fisc_uso_distinto_ck`: un acta que anota `USO_DISTINTO` tiene que
--       decir CUAL es el uso observado. Sin esto, el hallazgo que esta columna
--       viene a habilitar se podria anotar sin sustento — exactamente lo que
--       #546 se nego a permitir. Y de las dos juntas sale, sin escribirla, la
--       tercera: un acta VEHICULAR no puede anotar `USO_DISTINTO`, porque
--       necesitaria el uso hallado que (b) le prohibe.
--
--  Las tres van en la base y no solo en Java por lo que #188 y #435 midieron:
--  la guarda del dominio explica POR QUE falla, y la restriccion es lo que de
--  verdad no se puede saltar por SQL directo ni por un camino nuevo.
--
--  ---------------------------------------------------------------------------
--  4. POR QUE SE VALIDA Y NO VA `NOT VALID`
--  ---------------------------------------------------------------------------
--
--  Por dos motivos independientes, y basta cualquiera de los dos:
--
--    - El `CHECK` de `hallazgo` **solo amplia**: los cuatro valores anteriores
--      siguen admitidos, asi que ninguna fila existente puede violarlo (V58).
--      Los otros dos hablan de una columna que nace hoy y nace nula en toda
--      fila anterior, de modo que las dos condiciones se cumplen solas.
--    - `acta_fiscalizacion` tiene CERO filas en las dos municipalidades
--      desplegadas (#599), que es lo que hace barata esta ventana.
--
--  Y el cuarto hallazgo de RLS (DAT-01 §0) **no aplica**: es de las claves
--  foraneas, cuya validacion es una consulta que el migrador no puede hacer sin
--  contexto de tenant. Un `ADD CONSTRAINT ... CHECK` validado pasa en esa misma
--  sesion, medido en V64.
-- ============================================================================

ALTER TABLE acta_fiscalizacion
    ADD COLUMN uso_hallado varchar(60);

ALTER TABLE acta_fiscalizacion
    DROP CONSTRAINT acta_fiscalizacion_hallazgo_check,
    ADD CONSTRAINT acta_fiscalizacion_hallazgo_check
        CHECK (hallazgo IN ('CONFORME','OMISO','SUBVALUADOR','USO_DISTINTO','NO_UBICADO'));

ALTER TABLE acta_fiscalizacion
    ADD CONSTRAINT acta_fisc_uso_hallado_predial_ck
        CHECK (uso_hallado IS NULL OR predio_id IS NOT NULL);

ALTER TABLE acta_fiscalizacion
    ADD CONSTRAINT acta_fisc_uso_distinto_ck
        CHECK (hallazgo <> 'USO_DISTINTO' OR uso_hallado IS NOT NULL);

COMMENT ON COLUMN acta_fiscalizacion.uso_hallado IS
    'El uso que la inspeccion observo en campo, contra el que se compara ficha_catastral.uso '
    '(V76). Mismo tipo y largo que el lado declarado y que liquidacion_detalle.uso_hallado, '
    'donde acaba copiado. Solo un acta predial lo consigna: un vehiculo no tiene uso declarado.';

COMMENT ON CONSTRAINT acta_fisc_uso_distinto_ck ON acta_fiscalizacion IS
    'Un acta que anota USO_DISTINTO dice cual es el uso observado (V76). Sin esto el quinto valor '
    'de Hallazgo se podria anotar sin sustento, que es por lo que #546 se nego a anadirlo.';

COMMENT ON CONSTRAINT acta_fisc_uso_hallado_predial_ck ON acta_fiscalizacion IS
    'El uso hallado es de un predio (V76). Con acta_fisc_uso_distinto_ck implica, sin escribirla, '
    'que un acta vehicular no puede anotar USO_DISTINTO: necesitaria el uso que esta prohibe.';
