-- ============================================================================
--  V78 — La restauracion verificada de una copia (RF-126, issue #558)
--
--  «Una copia sin restauracion probada no es una copia»: eso es RNF-079, y es la
--  unica pregunta que la pantalla `Seguridad · Sistema · Copias de seguridad`
--  existe para contestar. Hasta aqui la tabla sabia si la copia se TOMO
--  —EN_CURSO / EXITOSO / FALLIDO, escrito por el CronJob de `Respaldo.ts`— y no
--  sabia si alguna vez se pudo RESTAURAR, que es lo que de verdad separa un
--  respaldo de un archivo grande en un bucket.
--
--  ## Nulo significa «nunca se probo», y por eso no hay valor por omision
--
--  Las dos columnas nacen nulas y se quedan nulas hasta que alguien restaure de
--  verdad. No llevan DEFAULT, y no es un descuido: un `false` o un `now()` aqui
--  se leeria como una medicion —«probada»— y llevaria a no auditar una copia que
--  no se ha restaurado nunca. El artboard de la pantalla traia «La ultima
--  restauracion verificada es de hace 94 dias» con las cifras inventadas, y ese
--  numero es exactamente el modo de fallo que estas dos columnas existen para no
--  reproducir en la base.
--
--  ## Quien las escribe
--
--  El simulacro de restauracion en su modo `--contra-cluster`
--  (`infra/respaldo/contra-cluster.sh`, INF-08 §5), que es el unico proceso que
--  restaura una copia REAL y comprueba lo restaurado. Lo hace como `sgtm_owner`,
--  el mismo rol con que el CronJob escribe el resto de la fila; `sgtm_app` sigue
--  con `SELECT` y nada mas (V8), porque la aplicacion consulta y no restaura
--  —darle lo que haria falta seria deshacer ARQ-03 §4—.
--
--  El modo local del simulacro NO escribe aqui, y tampoco es un olvido: levanta
--  su propio motor efimero y toma su propio respaldo base, asi que lo que
--  verifica es el PROCEDIMIENTO y no ninguna copia registrada. Marcar una fila
--  desde ahi diria que se restauro una copia del cluster que nadie toco.
--
--  ## Los tres CHECK, y por que validan sin NOT VALID
--
--  Las columnas son nuevas: toda fila existente queda con NULL en las dos, asi
--  que ninguna puede violarlos y el `ALTER TABLE` valida sin riesgo de dejar la
--  instalacion sin migrar (que es lo que obligo al NOT VALID de V64, donde el
--  dato ya estaba escrito). La politica de `respaldo` es ademas
--  `FOR SELECT USING (true)` —no lee `current_setting`—, de modo que el escaneo
--  de validacion del migrador, que corre sin contexto de tenant, no revienta.
-- ============================================================================

ALTER TABLE respaldo
    -- Cuando se comprobo, restaurandola, que esta copia se puede restaurar.
    -- «Ultima» porque una copia se puede volver a probar: el simulacro corre mas
    -- de una vez y lo que la fila guarda es la ultima vez que se comprobo.
    ADD COLUMN ultima_restauracion_verificada     timestamptz,
    -- Quien o QUE la verifico: aqui no hay un usuario de la aplicacion, hay un
    -- proceso. Se escribe el guion y el ambiente contra el que corrio.
    ADD COLUMN ultima_restauracion_verificada_por varchar(200);

-- Las dos columnas son un solo dato: media verificacion —un instante sin quien
-- lo firma, o un firmante sin instante— no se puede leer ni auditar.
ALTER TABLE respaldo
    ADD CONSTRAINT respaldo_verificacion_completa_ck
        CHECK ((ultima_restauracion_verificada IS NULL)
               = (ultima_restauracion_verificada_por IS NULL));

-- Solo se verifica lo que se pudo tomar. Marcar como restaurada una copia
-- FALLIDA —o una todavia EN_CURSO— es afirmar que se restauro algo que no
-- existe entero.
ALTER TABLE respaldo
    ADD CONSTRAINT respaldo_verificacion_exitosa_ck
        CHECK (ultima_restauracion_verificada IS NULL OR resultado = 'EXITOSO');

-- Y no antes de que la copia terminase: una verificacion anterior al `fin` no
-- puede haber restaurado esta copia, sera de otra.
ALTER TABLE respaldo
    ADD CONSTRAINT respaldo_verificacion_posterior_ck
        CHECK (ultima_restauracion_verificada IS NULL
               OR (fin IS NOT NULL AND ultima_restauracion_verificada >= fin));

COMMENT ON COLUMN respaldo.ultima_restauracion_verificada IS
    'Instante en que se comprobo, restaurandola de verdad, que esta copia se puede'
    ' restaurar (RNF-079). NULO significa «nunca se probo», nunca «hoy».';

COMMENT ON COLUMN respaldo.ultima_restauracion_verificada_por IS
    'Que proceso lo comprobo: el simulacro de restauracion y el ambiente contra el'
    ' que corrio. No es un usuario de la aplicacion: la aplicacion no restaura.';
