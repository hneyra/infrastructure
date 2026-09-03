-- ============================================================================
--  V77 — El libro dice POR QUE se dio de baja una deuda (#684)
--
--  V68 (#601) le dio al asiento su `acto` —ALTA_DEUDA / BAJA_DEUDA—, que dice
--  QUE se hizo. Lo que ninguna columna decia es POR QUE: la causal de la baja
--  —«PRESCRIPCIÓN DECLARADA», «RESOLUCIÓN QUE DEJA SIN EFECTO», «ERROR
--  MATERIAL»…— viajaba DENTRO de la observacion, porque
--  `MovimientosDeDeudaController.PeticionDeMovimiento` declaraba diecinueve
--  campos y ninguno era este. La pantalla de RF-044 la anteponia al texto que
--  teclea quien atiende y ahi se quedaba.
--
--  ---------------------------------------------------------------------------
--  1. POR QUE HACE FALTA UNA COLUMNA, Y NO VALE NINGUNA DE LAS QUE HAY
--  ---------------------------------------------------------------------------
--
--    - `motivo` ES la observacion del usuario (regla 10, RNF-052): texto libre
--      que `RegistrarAsiento` escribe con la `Observacion` de quien asienta.
--      «PRESCRIPCION DECLARADA», «prescripción declarada» y «prescrita s/ Res.
--      123-2026» son la misma causal y tres cadenas distintas, asi que no se
--      puede filtrar ni contar. Es el mismo defecto de vocabulario que #553
--      midio para `tributo` y #542 para el tipo de transferencia.
--    - `acto` contesta otra pregunta —de que acto nace la fila— y meterle
--      ademas el por que seria hacer que una columna conteste dos, que es lo
--      que V71 rechazo para la declaracion de titular anterior.
--    - `documento_origen` es el PAPEL que aprueba el acto (el numero de la
--      resolucion), no de que clase de acto es.
--
--  Consecuencia practica, la que el issue nombra: RF-045 no podia contestar
--  «ensename las bajas por prescripcion», que es la pregunta de quien audita
--  como se extingue deuda del municipio.
--
--  ---------------------------------------------------------------------------
--  2. LOS SEIS VALORES SALEN DEL MANUAL, Y NO SE TRADUCEN
--  ---------------------------------------------------------------------------
--
--  Son las seis opciones del desplegable «Causal» de la pantalla de baja de
--  deuda, enteras y sin ninguna de mas. La unica diferencia con el rotulo es de
--  escritura —la tilde, que ningun identificador de este sistema lleva, y el
--  espacio que aqui va como guion bajo—; el significado no se aproxima. Es lo
--  que #427 hizo al negarse a leer «ACTIVA» como VIGENTE y #546 al negarse a
--  mapear seis rotulos de hallazgo sobre cuatro valores.
--
--  ---------------------------------------------------------------------------
--  3. LOS TRES CHECK, Y POR QUE UNO VA `NOT VALID` Y LOS OTROS DOS NO
--  ---------------------------------------------------------------------------
--
--  (a) `asiento_causal_ck` — el vocabulario. Va VALIDADO: la columna nace y
--      todas las filas existentes quedan en NULL, que la restriccion admite,
--      asi que no hay ninguna fila que pueda violarla. Sobre el escaneo de
--      validacion de un CHECK en una tabla con FORCE ROW LEVEL SECURITY ya se
--      midio en V64 que pasa sin contexto de tenant.
--
--  (b) `asiento_causal_del_acto_ck` — la coherencia: solo una BAJA tiene
--      causal. El alta no la tiene y su pantalla no la dibuja: el desplegable
--      «Causal» es de la baja. Tambien VALIDADO, y por lo mismo que (a).
--
--      Va con `IS NOT DISTINCT FROM` y no con `=`, y no es un adorno: la
--      escrita `causal IS NULL OR acto = 'BAJA_DEUDA'` NO caza la fila con
--      `acto` en nulo y causal puesta —un cobro con causal—, porque
--      `FALSE OR NULL` es NULL y un CHECK admite el nulo. Medido: con `=` la
--      prueba que inserta ese asiento por SQL directo pasa en VERDE. Es la
--      logica de tres valores, la misma que obliga al `IS DISTINCT FROM` de
--      (c) y al `NULLS NOT DISTINCT` que V57 necesito por lo contrario.
--
--  (c) `asiento_baja_con_causal_ck` — toda baja NUEVA declara su causal. Este
--      va `NOT VALID`, y NO por el cuarto hallazgo de RLS sino por los DATOS:
--      una instalacion en marcha ya tiene bajas escritas por V68 con la causal
--      dentro de la observacion, de modo que un ALTER TABLE validado fallaria
--      con «is violated by some row» y dejaria la instalacion sin migrar (es lo
--      que V64 midio para el tipo de transferencia). `NOT VALID` no comprueba
--      lo que ya hay y SIGUE comprobando cada INSERT, que es exactamente lo que
--      hace falta.
--
--      Y deja fuera la REVERSION, que no es una baja nueva sino el asiento que
--      corrige a otro: `Asiento#reversionDe` COPIA la causal del original, asi
--      que reversar una baja anterior a V77 —que la tiene nula y no se puede
--      reparar— produciria una fila que este CHECK rechaza, y la unica forma de
--      corregir un asiento (V2, regla 4) quedaria cerrada justo sobre las filas
--      que ya no se pueden tocar de ninguna otra manera. Es el mismo motivo por
--      el que `asiento_alta_unica_uq` (V75) excluye la reversion del alta.
--
--  Y las filas viejas NO se pueden reparar, ni aqui ni despues: el libro no
--  admite UPDATE desde la aplicacion (V7) y no se corrige, se reversa (V2,
--  regla 4); y el migrador no puede reescribir una tabla con FORCE ROW LEVEL
--  SECURITY porque corre sin contexto de tenant —«unrecognized configuration
--  parameter "app.municipalidad_id"», DAT-01 §0 cuarto hallazgo, medido igual
--  en V64 y en V68—.
--
--  Asi que, dicho para que nadie lo descubra despues: LAS BAJAS ANTERIORES A
--  ESTA MIGRACION SE QUEDAN SIN CAUSAL. Su causal esta dentro del texto de la
--  observacion y ahi se queda; la relacion de RF-045 las sigue listando —el
--  filtro por causal es opcional, y sin el salen todas— y al filtrar por una
--  causal concreta no aparecen, porque NULL no es ninguna de las seis. NULL
--  aqui no significa «se desconoce la causal del acto»: significa «esta fila no
--  la declaro», que es lo que de verdad ocurrio en toda baja anterior a #684.
--
--  No hace falta ningun GRANT: V7 concede SELECT, INSERT sobre la TABLA —no por
--  columna—, asi que `sgtm_app` escribe y lee la columna nueva sin tocar
--  privilegios, y el REVOKE UPDATE de V7 la cubre igual. La fila del libro
--  sigue siendo inmutable (RNF-051, TABLAS_INMUTABLES).
-- ============================================================================

ALTER TABLE cuenta_corriente_asiento
    ADD COLUMN causal varchar(40);

ALTER TABLE cuenta_corriente_asiento
    ADD CONSTRAINT asiento_causal_ck
        CHECK (causal IS NULL OR causal IN ('PRESCRIPCION_DECLARADA',
                                            'RESOLUCION_QUE_DEJA_SIN_EFECTO',
                                            'ERROR_MATERIAL',
                                            'COMPENSACION',
                                            'DEUDA_DE_COBRANZA_DUDOSA',
                                            'CONDONACION_POR_ORDENANZA'));

ALTER TABLE cuenta_corriente_asiento
    ADD CONSTRAINT asiento_causal_del_acto_ck
        CHECK (causal IS NULL OR acto IS NOT DISTINCT FROM 'BAJA_DEUDA');

ALTER TABLE cuenta_corriente_asiento
    ADD CONSTRAINT asiento_baja_con_causal_ck
        CHECK (acto IS DISTINCT FROM 'BAJA_DEUDA'
               OR causal IS NOT NULL
               OR asiento_reversado_id IS NOT NULL)
        NOT VALID;

COMMENT ON COLUMN cuenta_corriente_asiento.causal IS
    'Por que se dio de baja la deuda: el sustento juridico del acto (RF-044, '
    '#684). Las seis del desplegable «Causal» de la pantalla, letra por letra y '
    'sin traducir. Solo una BAJA_DEUDA la lleva; el alta no la tiene. NULL es '
    '«esta fila no la declaro» —toda baja anterior a V77, cuya causal viaja '
    'dentro del texto de la observacion y no se puede recuperar (V7, regla 4)—, '
    'no «se desconoce». No sustituye al motivo, que es la observacion DEL '
    'USUARIO (regla 10): una es el sustento y la otra el relato de quien firma '
    '(V77).';
