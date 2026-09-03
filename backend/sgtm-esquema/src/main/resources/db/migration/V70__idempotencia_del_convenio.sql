-- ============================================================================
--  V70 — Reenviar el mismo intento no abre un segundo convenio (#606)
--
--  `CajaController` lee la cabecera `Idempotency-Key` en sus dos POST desde #33,
--  y `recibo_idempotencia_uq` (V29 §5) la convierte en garantia. `AnuncioController`
--  hace lo mismo desde #51 (`anuncio_idempotencia_uq`, V45 §3) y `CertificadoController`
--  desde #54 (`certificado_idempotencia_uq`, V51 §5). Convenios era la excepcion:
--  ninguna de sus dos escrituras la leia, y ningun indice tapaba el alta.
--
--  ---------------------------------------------------------------------------
--  1. LO QUE LA BASE YA IMPEDIA, Y LO QUE NO
--  ---------------------------------------------------------------------------
--
--    convenio_numero_uq (V3)                      dos convenios con el mismo
--                                                 numero — NO tapa el reenvio:
--                                                 cada intento toma correlativo
--                                                 nuevo de convenio_correlativo
--    convenio_deuda_uq (V31)                      la misma deuda dos veces
--                                                 DENTRO del mismo convenio — NO:
--                                                 son dos convenios distintos
--    convenio_movimiento_formalizacion_uq (V31)   dos formalizaciones del mismo
--                                                 convenio — NO
--    convenio_movimiento_cierre_uq (V31)          dos cierres del mismo convenio
--                                                 — SI, el doble cierre ya estaba
--
--  Asi que tras un 500 o un tiempo de espera agotado, quien atiende no sabia si
--  habia escrito, y repetir abria otro preconvenio con otro numero sobre la
--  misma deuda: dos papeles que dicen cosas distintas del mismo acuerdo, y solo
--  uno se puede formalizar.
--
--  ---------------------------------------------------------------------------
--  2. POR QUE DOS COLUMNAS Y NO UNA
--  ---------------------------------------------------------------------------
--
--  Son dos endpoints y dos actos distintos, y cada uno escribe en su tabla:
--
--    POST /tesoreria/fraccionamientos            -> `convenio`
--    POST /tesoreria/convenios/{numero}/anulacion -> `convenio_movimiento`
--
--  La clave la reclama el acto que el endpoint registra. La REFORMULACION cierra
--  un convenio Y abre el preconvenio que lo sustituye, en la misma transaccion:
--  la clave se guarda SOLO en el movimiento de cierre, y el preconvenio que nace
--  de ella queda con `clave_idempotencia` en NULL. Guardarla en las dos tablas
--  haria que la misma clave identificara dos filas distintas, y un reenvio
--  tendria que elegir con cual contestar; ademas las dos lecturas podrian
--  discrepar. Con la clave en el cierre, el reenvio se para antes de llegar al
--  preconvenio, y si se colara, `convenio_movimiento_cierre_uq` aborta la
--  transaccion entera y con ella el preconvenio de mas.
--
--  El cierre por si solo NO bastaba, aunque `convenio_movimiento_cierre_uq` ya
--  impidiera el doble cierre: sin la cabecera, el reenvio contestaba 409
--  CONFLICTO, que se lee como un fallo nuevo y no como «ya estaba hecho», y la
--  interfaz no puede ofrecer «Reintentar» sobre una escritura cuyo reintento
--  contesta un error.
--
--  ---------------------------------------------------------------------------
--  3. INDICE UNICO PARCIAL, COMO EN V29, V45 Y V51
--  ---------------------------------------------------------------------------
--
--  La clave es OPCIONAL —un registro hecho por un proceso interno no tiene por
--  que traerla, y `NULL` no choca con `NULL`—, asi que el indice va con su
--  `WHERE ... IS NOT NULL`. Empieza por `municipalidad_id` porque toda clave de
--  este esquema es por inquilino (ARQ-04 §7): dos municipalidades pueden mandar
--  la misma cadena y son dos actos distintos.
--
--  La garantia es el indice y no el `SELECT` previo que hacen los casos de uso:
--  entre leer y escribir cabe otra peticion, y dos peticiones simultaneas
--  pasarian las dos por cualquier `if` de Java. La lectura esta para poder
--  contestar algo util —el convenio de la primera vez— en vez de un error.
--
--  ---------------------------------------------------------------------------
--  4. LO QUE ESTA MIGRACION NO NECESITA
--  ---------------------------------------------------------------------------
--
--  Ningun GRANT nuevo: el de V7 —«tablas de negocio»— y el de V31 §5 son de TABLA,
--  no de columna, asi que `sgtm_app` ya puede insertar la columna nueva y leerla.
--  Y ningun REVOKE nuevo: V31 §6 ya le retira el `UPDATE` sobre `convenio`, y a
--  `convenio_movimiento` V31 solo le concedio `SELECT, INSERT`. La columna es de
--  solo INSERT en las dos tablas, que es lo que tiene que ser: una clave de
--  idempotencia que se pudiera reescribir no garantizaria nada.
--
--  Tampoco hay tabla nueva, asi que `verificarAislamiento` no tiene nada que
--  clasificar: las dos tablas ya tienen su RLS con FORCE y su politica desde V6
--  y V31.
-- ============================================================================

-- ---------- 1. La clave del alta ----------
ALTER TABLE convenio
    ADD COLUMN clave_idempotencia varchar(64);

COMMENT ON COLUMN convenio.clave_idempotencia IS
    'La clave que el cliente manda en la cabecera Idempotency-Key al registrar el preconvenio. '
    'Con su indice unico parcial, reenviar el mismo intento devuelve el convenio de la primera '
    'vez y no abre otro sobre la misma deuda (#606). Nula en el preconvenio que nace de una '
    'REFORMULACION: ese acto lo reclama el movimiento de cierre.';

CREATE UNIQUE INDEX convenio_idempotencia_uq
    ON convenio (municipalidad_id, clave_idempotencia)
    WHERE clave_idempotencia IS NOT NULL;

-- ---------- 2. La clave del cierre ----------
ALTER TABLE convenio_movimiento
    ADD COLUMN clave_idempotencia varchar(64);

COMMENT ON COLUMN convenio_movimiento.clave_idempotencia IS
    'La clave que el cliente manda en la cabecera Idempotency-Key al anular, quebrar o reformular '
    '(#606). Con su indice unico parcial, reenviar el mismo intento devuelve el acta de la '
    'primera vez —201 con el convenio ya cerrado— en vez del 409 que contestaba '
    'convenio_movimiento_cierre_uq, que se lee como un fallo nuevo. La FORMALIZACION no la usa: '
    'ese acto entra por la caja y lo protege recibo_idempotencia_uq (V29).';

CREATE UNIQUE INDEX convenio_movimiento_idempotencia_uq
    ON convenio_movimiento (municipalidad_id, clave_idempotencia)
    WHERE clave_idempotencia IS NOT NULL;
