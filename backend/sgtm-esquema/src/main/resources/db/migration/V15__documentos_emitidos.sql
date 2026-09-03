-- ============================================================================
--  V15 — Documentos emitidos (RF-132)
--
--  El manual promete reimprimir un valor, un recibo o una papeleta de hace
--  anos y obtener EXACTAMENTE el documento original. Eso no se consigue
--  volviendo a calcularlo: la deuda de 2027 recalculada en 2037 con los
--  parametros de 2037 daria otra cifra, y con los de 2027 daria la misma solo
--  si nada cambio en el camino.
--
--  Asi que el documento guarda LOS DATOS CON QUE SE GENERO, ya formateados, y
--  reimprimir es volver a dibujar esos datos. El resumen SHA-256 de la salida
--  se guarda tambien: es lo que convierte «devuelve lo mismo» en algo que se
--  comprueba en vez de algo que se afirma.
--
--  No se guarda el archivo. Guardar el PDF costaria megabytes por documento y
--  ademas fijaria el formato: quien emitio en PDF tiene derecho a pedir la
--  misma emision en hoja de calculo, y con los datos se puede.
-- ============================================================================

CREATE TABLE documento_emitido (
    municipalidad_id bigint       NOT NULL REFERENCES municipalidad(id),
    id               bigint       GENERATED ALWAYS AS IDENTITY,
    -- Que documento es: FICHA_CONTRIBUYENTE, ORDEN_PAGO, RECIBO, PAPELETA…
    -- Texto y no enumeracion: cada contexto emite los suyos y una lista
    -- cerrada aqui obligaria a tocar este modulo transversal cada vez.
    tipo             varchar(40)  NOT NULL,
    -- El correlativo, por municipalidad, tipo y ejercicio. D-09 decide su
    -- formato; aqui solo se exige que exista y no se repita.
    numero           varchar(40)  NOT NULL,
    ejercicio        ejercicio    NOT NULL,
    -- A quien se refiere, en las claves que use cada contexto. No es clave
    -- ajena: este modulo no conoce contribuyentes ni predios, y una clave
    -- ajena a doce tablas distintas no se puede escribir.
    referencia       varchar(80)  NOT NULL,
    -- El modelo con que se dibujo, en JSON. Es la fuente de la reimpresion.
    datos            jsonb        NOT NULL,
    -- El formato en que se emitio la primera vez, y el resumen de esos bytes.
    formato          varchar(10)  NOT NULL CHECK (formato IN ('PDF','XLS','RTF')),
    resumen          char(64)     NOT NULL,
    fecha_emision    date         NOT NULL,
    -- Cuantas veces se reimprimio. El original es 0; el primer duplicado, 1.
    reimpresiones    integer      NOT NULL DEFAULT 0 CHECK (reimpresiones >= 0),
    usuario_emision  varchar(60)  NOT NULL,
    observacion      varchar(500) NOT NULL,
    fecha_registro   timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT documento_pk PRIMARY KEY (municipalidad_id, id),
    CONSTRAINT documento_numero_uq UNIQUE (municipalidad_id, tipo, ejercicio, numero)
);

COMMENT ON TABLE documento_emitido IS
    'Documentos emitidos con los datos que los generaron, para reimprimirlos identicos (RF-132).';

CREATE INDEX documento_referencia_ix
    ON documento_emitido (municipalidad_id, tipo, referencia);

-- ---------- RLS ----------
ALTER TABLE documento_emitido ENABLE ROW LEVEL SECURITY;
ALTER TABLE documento_emitido FORCE  ROW LEVEL SECURITY;

CREATE POLICY documento_por_tenant ON documento_emitido
    USING (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- UPDATE existe SOLO para el contador de reimpresiones; los datos, el resumen
-- y el numero no se tocan, y un disparador lo sostiene en vez de la costumbre.
-- Sin DELETE: un documento emitido no se borra (regla 4, RNF-051).
GRANT SELECT, INSERT, UPDATE ON documento_emitido TO sgtm_app;
GRANT SELECT                  ON documento_emitido TO sgtm_readonly;

CREATE OR REPLACE FUNCTION documento_solo_cuenta_reimpresiones() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF NEW.tipo IS DISTINCT FROM OLD.tipo
       OR NEW.numero IS DISTINCT FROM OLD.numero
       OR NEW.ejercicio IS DISTINCT FROM OLD.ejercicio
       OR NEW.referencia IS DISTINCT FROM OLD.referencia
       OR NEW.datos IS DISTINCT FROM OLD.datos
       OR NEW.formato IS DISTINCT FROM OLD.formato
       OR NEW.resumen IS DISTINCT FROM OLD.resumen
       OR NEW.fecha_emision IS DISTINCT FROM OLD.fecha_emision
    THEN
        RAISE EXCEPTION
          'Un documento emitido no se edita: lo unico que cambia es cuantas veces se reimprimio. '
          'Si los datos estaban mal, se emite otro y se anula este';
    END IF;
    RETURN NEW;
END
$fn$;

CREATE TRIGGER documento_inmutable_trg
    BEFORE UPDATE ON documento_emitido
    FOR EACH ROW EXECUTE FUNCTION documento_solo_cuenta_reimpresiones();
