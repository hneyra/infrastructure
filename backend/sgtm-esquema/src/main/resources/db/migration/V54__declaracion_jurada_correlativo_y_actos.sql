-- ============================================================================
--  V54 — La declaracion jurada como acto: su numeracion, su unicidad y lo que
--        de ella se puede cambiar (#365, ADR-0015 §3)
--
--  #344 publico la LECTURA de la conciliacion catastro-rentas; el acto que la
--  PRODUCE —presentar la declaracion jurada— no se podia ejecutar desde el
--  sistema. Al publicarlo aparecen tres cosas que la tabla de V2 no tenia:
--
--  1. Quien pone el numero. Lo pone el sistema, con correlativo propio y
--     plantilla parametrizada, que es como numeran los actos de esta casa
--     mientras D-09 siga abierta (`licencia_correlativo` en V37,
--     `certificado_correlativo` en V51) y como opera la administracion
--     tributaria municipal peruana: el sistema genera el numero de referencia
--     de la DJ, y el numero de mesa de partes —si lo hay— es OTRA cosa.
--
--  2. Que numero no se puede repetir. `dj_numero_uq` (V2) era unica por
--     EJERCICIO: `000418` de 2025 y `000418` de 2026 eran dos numeros
--     distintos. Se estrecha a `(municipalidad_id, numero)`: la declaracion
--     jurada se cita por su numero en un valor, en una resolucion y en un
--     expediente, y un numero que solo identifica dentro de su año obliga a
--     que todo el que la cite lleve el año pegado o se equivoque de papel.
--     La unicidad nueva IMPLICA la anterior, asi que la anterior se retira en
--     vez de dejar dos indices que mantener en cada INSERT.
--
--  3. Que se puede cambiar de una DJ ya presentada, y quien puede cambiarlo.
--     Hasta aqui la respuesta era «lo que el repositorio se acuerde de no
--     tocar»: `sgtm_app` tenia UPDATE sobre la tabla ENTERA (V7) y lo unico
--     que impedia reescribir el numero o la fecha de un papel firmado por el
--     contribuyente era la disciplina de una clase Java. Ahora lo impide el
--     motor, con privilegio de columna.
--
--  Lo que NO trae esta migracion, y conviene decirlo: ningun importe. Que una
--  DJ se presente fuera de plazo genera multa tributaria segun el manual, pero
--  esa multa es D-02c (#198). Aqui solo queda el hecho —`fuera_de_plazo`, que
--  ya existe desde V2— y ninguna cifra.
-- ============================================================================

-- ---------- 1. El correlativo de la declaracion jurada ----------
--
--  Por (municipalidad, EJERCICIO) y no por tipo, al reves que
--  `certificado_correlativo`: el manual muestra los cuatro tipos de formulario
--  de un año compartiendo UNA serie —000392 ANUAL MECANIZADA, 000401
--  INSCRIPCION y 000418 RECTIFICATORIA, los tres de 2026—, asi que la serie es
--  del año y no del formulario. Con una serie compartida la plantilla puede
--  llevar {tipo} o no llevarlo sin que dos DJ compongan el mismo numero; con
--  una serie por tipo, omitir {tipo} seria un choque garantizado el dia que
--  alguien presente dos formularios distintos. Se elige la que es segura en
--  los dos casos.
--
--  Se guarda el correlativo DESNUDO, como los otros tres, para que el dia que
--  D-09 cambie la plantilla el correlativo siga siendo el mismo.
CREATE TABLE dj_correlativo (
    municipalidad_id bigint    NOT NULL REFERENCES municipalidad(id),
    ejercicio        ejercicio NOT NULL,
    ultimo           bigint    NOT NULL DEFAULT 0 CHECK (ultimo >= 0),
    CONSTRAINT dj_correlativo_pk PRIMARY KEY (municipalidad_id, ejercicio)
);

COMMENT ON TABLE dj_correlativo IS
    'El ultimo correlativo de declaracion jurada emitido por municipalidad y ejercicio (#365). Se '
    'lee y se incrementa en una sola sentencia UPSERT; nunca con SELECT + UPDATE. La fila NO se '
    'siembra aqui: la crea la primera peticion del ejercicio, arrancando por encima del mayor '
    'numero historico de ese año. Sembrarla en la migracion es imposible, y por un motivo que vale '
    'anotar: `declaracion_jurada` tiene RLS con FORCE, el migrador corre como sgtm_owner y NO tiene '
    'contexto de tenant, asi que un SELECT sobre ella durante la migracion falla con '
    '«unrecognized configuration parameter app.municipalidad_id» (DAT-01 §0, cuarto hallazgo).';

ALTER TABLE dj_correlativo ENABLE ROW LEVEL SECURITY;
ALTER TABLE dj_correlativo FORCE  ROW LEVEL SECURITY;

CREATE POLICY dj_correlativo_tenant ON dj_correlativo
    USING      (municipalidad_id = current_setting('app.municipalidad_id')::bigint)
    WITH CHECK (municipalidad_id = current_setting('app.municipalidad_id')::bigint);

-- Este contador SI se actualiza en el sitio: es infraestructura interna de
-- numeracion, no un documento entregable. Mismo criterio que V37 y V51.
GRANT SELECT, INSERT, UPDATE ON dj_correlativo TO sgtm_app;
GRANT SELECT                 ON dj_correlativo TO sgtm_readonly;

-- ---------- 2. El numero es unico en la municipalidad, no dentro del año ----
--
--  El correlativo con UPSERT atomico es la fuente de la no-repeticion; este
--  indice es la RED: convierte cualquier hueco del mecanismo —una plantilla
--  sin {ejercicio}, un alta por otra via, una migracion de D-04— en un error
--  visible, y nunca en dos declaraciones juradas con el mismo numero.
--
--  AVISO PARA D-04: si el padron heredado numera por año (dos DJ `000418`, una
--  de 2025 y otra de 2026), esta migracion FALLA al crear el indice, y falla a
--  proposito: renumerar o prefijar el historico es una decision de la
--  migracion de datos, no algo que este archivo pueda inventar.
ALTER TABLE declaracion_jurada DROP CONSTRAINT dj_numero_uq;

ALTER TABLE declaracion_jurada
    ADD CONSTRAINT dj_numero_uq UNIQUE (municipalidad_id, numero);

COMMENT ON CONSTRAINT dj_numero_uq ON declaracion_jurada IS
    'Un numero, una declaracion jurada, en toda la municipalidad (#365). Antes era unica por '
    'ejercicio, y eso obligaba a que todo el que citara una DJ llevara el año pegado.';

-- ---------- 3. Una DJ se rectifica UNA vez ----------
--
--  `dj_rectifica_ix` (V19) era un indice normal: nada impedia que dos
--  rectificatorias apuntaran a la misma DJ. Con el caso de uso publicado, dos
--  peticiones simultaneas leen las dos que la anterior esta PRESENTADA, y las
--  dos insertan: el `if` de Java no las ve. Aqui el unico que las ve es el
--  indice.
DROP INDEX dj_rectifica_ix;

CREATE UNIQUE INDEX dj_rectifica_uq ON declaracion_jurada (municipalidad_id, dj_rectifica_id)
    WHERE dj_rectifica_id IS NOT NULL;

COMMENT ON INDEX dj_rectifica_uq IS
    'Una declaracion jurada se rectifica una sola vez (#365). Con dos rectificatorias vivas sobre '
    'la misma DJ, ninguna consulta podria decir cual es la que el contribuyente declara hoy —y la '
    'conciliacion de ADR-0015 contaria el predio dos veces, o el equivocado—.';

-- ---------- 4. De una DJ presentada solo cambia el estado ----------
--
--  Regla 4 dicha por el motor y no por la disciplina del repositorio. La DJ es
--  un papel que el contribuyente firma y se lleva (manual, cap. 3): corregir en
--  la base el numero, la fecha, el tipo o el predio deja al papel y al sistema
--  diciendo cosas distintas, y quien tenga el papel gana la discusion.
--
--  Se hace con privilegio de COLUMNA y no revocando el UPDATE entero, porque
--  el estado SI cambia: una DJ se observa, se anula, o queda sustituida por su
--  rectificatoria. Los tres son actos de tramite sobre un documento que sigue
--  siendo el mismo, y su rastro —quien, cuando y por que— es la fila de
--  `auditoria`, que no se edita ni se borra (ADR-0008).
--
--  Por que no el patron `..._movimiento` que usan el recibo, la licencia o el
--  anuncio: alli el movimiento LLEVA CONTENIDO PROPIO —la resolucion que
--  cancela, el cargo que genero, el ordinal del duplicado—, y aqui no lleva
--  ninguno: quien, cuando y por que, que es exactamente una fila de auditoria.
--  Y `estado` es ademas la columna de la que se derivan la conciliacion
--  (ADR-0015) y la deteccion de omisos (#49), las dos por
--  `dj_ejercicio_predio_ix`; derivarlo de otra tabla convertiria las dos
--  lecturas en un JOIN por pagina para no ganar nada que el privilegio de
--  columna no de ya.
REVOKE UPDATE ON declaracion_jurada FROM sgtm_app;
GRANT  UPDATE (estado) ON declaracion_jurada TO sgtm_app;

-- ---------- 5. Un estado terminal no revive ----------
--
--  ANULADA y SUSTITUIDA son finales. Una anulada no se reabre —se presenta
--  otra declaracion—, y una sustituida ya tiene quien la sustituya. Sin esto,
--  el unico guardian de la maquina de estados serian los `if` del caso de uso,
--  que dos peticiones simultaneas atraviesan las dos.
CREATE OR REPLACE FUNCTION declaracion_jurada_estado_es_terminal() RETURNS trigger AS $$
BEGIN
    IF OLD.estado IN ('ANULADA', 'SUSTITUIDA') THEN
        RAISE EXCEPTION
            'La declaracion jurada % esta % y no admite mas actos: presente otra (#365)',
            OLD.numero, OLD.estado
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER declaracion_jurada_estado_terminal
    BEFORE UPDATE ON declaracion_jurada
    FOR EACH ROW EXECUTE FUNCTION declaracion_jurada_estado_es_terminal();
