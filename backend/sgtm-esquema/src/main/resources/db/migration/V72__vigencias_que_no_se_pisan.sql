-- ============================================================================
--  V72 — Dos versiones de la misma cosa no pueden cubrir la misma fecha (#669)
--
--  Salio de #561: para que el conteo de la pagina de omisos dijera lo que la
--  grilla enseña hubo que CONSERVAR el JOIN con `ficha_catastral`, porque es el
--  unico de los tres que puede multiplicar filas. Y puede multiplicarlas por un
--  motivo que no es de esa consulta.
--
--  ## El hueco
--
--  `ficha_vigente_uq` es un indice unico PARCIAL —`WHERE vigencia_hasta IS
--  NULL`—, o sea impide dos versiones ABIERTAS del mismo predio y nada mas. Una
--  abierta y una cerrada pueden cubrir la misma fecha, y entonces toda lectura
--  que resuelva «la ficha vigente a la fecha» devuelve dos filas del mismo
--  predio: la grilla lo enseña dos veces, el conteo lo cuenta dos veces y nada
--  lo explica.
--
--  Lo mismo, y peor, en `titularidad`: `titularidad_no_excede_trg` suma las
--  cuotas ABIERTAS para comprobar que no pasen del 100 %, asi que un solape
--  historico no lo ve nadie — y el % de propiedad PONDERA LA BASE IMPONIBLE del
--  predial (NEG-05 §1, #395). Un solape ahi no da un error: da una base
--  imponible distinta, y ninguna cifra del recibo lo diria.
--
--  El camino de escritura no las produce —`ActualizarFichaCatastral` y
--  `RegistrarPredio.transferir` cierran la anterior EL DIA ANTES de abrir la
--  siguiente—, pero la base no lo impide, y con D-04 abierta la migracion desde
--  SQL Server es justo el camino por donde entran filas que ningun caso de uso
--  escribio.
--
--  ## Por que EXCLUDE y no otra cosa
--
--  Es la unica forma de expresar «dos rangos no se pisan» en el motor. Un
--  indice unico no puede, porque lo que no se puede repetir no es un valor sino
--  un SOLAPE; y un disparador tendria que leer la tabla y volveria a depender de
--  que nadie lo desactive.
--
--  ## DEFERRABLE, y es el mismo motivo que el disparador de la titularidad
--
--  Los dos van DEFERRABLE INITIALLY DEFERRED. Una transferencia legitima cierra
--  una cuota y abre otra EN LA MISMA TRANSACCION, y entre las dos operaciones el
--  estado intermedio puede pisarse a proposito — exactamente lo que #16 midio
--  para `titularidad_no_excede_trg`, cuya version inmediata hacia imposible una
--  transferencia correcta. Aplazar la comprobacion al COMMIT deja pasar el
--  estado intermedio y sigue rechazando el estado final malo.
--
--  ## btree_gist, y por que NO puede ir en esta migracion
--
--  `EXCLUDE USING gist` necesita comparar `bigint` y `varchar` con `=` dentro de
--  un indice GiST, y eso lo aporta `btree_gist`. Es *trusted*, al contrario que
--  `postgis` —medido: `SELECT trusted FROM pg_available_extension_versions WHERE
--  name='btree_gist'` da `t` contra el PostgreSQL 16.4 de `stg`—, asi que la
--  primera version de esta migracion la creaba aqui mismo para no reabrir el
--  hueco de #435.
--
--  **Y no funciona.** Ejecutandolo:
--
--      ERROR: permission denied to create extension "btree_gist"
--
--  *Trusted* significa que la crea quien tiene `CREATE` sobre la BASE, no
--  quien es dueño de sus tablas, y `sgtm_owner` no es dueño de la base. Asi que
--  `btree_gist` va en `crear-roles.sql` junto a las otras tres, y de ahi lo toma
--  `crear-extensiones.sh` —que lee la lista del propio archivo, no una escrita a
--  mano— para el cluster que ya existe. Es el mismo camino que `postgis`, y la
--  premisa contraria solo se cayo al ejecutarla.
--
--  ## Lo existente
--
--  Medido antes de escribir esto contra `stg`: 0 fichas que se pisan (de 0) y 0
--  titularidades que se pisan (de 1). La cifra es cierta y no dice nada — `stg`
--  esta practicamente vacio—, asi que las restricciones se anaden VALIDADAS y si
--  algun dia hay filas que las violen la migracion FALLA en vez de admitirlas en
--  silencio. Es lo que se quiere: una fila que no deberia existir tiene que
--  aparecer cuando se migra, no cuando alguien lee un padron y ve el predio dos
--  veces.
--
--  ## Lo que cuesta aplicarla
--
--  `ADD CONSTRAINT ... EXCLUDE` toma ACCESS EXCLUSIVE y construye un indice GiST
--  sobre la tabla entera. Sobre un padron del tamaño del piloto —Catacaos, 14 422
--  predios— eso son segundos; sobre uno grande hay que contarlo como una parada.
--  No se puede hacer CONCURRENTLY: `ALTER TABLE` no lo admite para una
--  restriccion de exclusion. Se dice aqui para que quien despliegue lo sepa antes
--  y no lo descubra con la aplicacion esperando.
--
--  `ficha_vigente_uq` se QUEDA aunque esta restriccion la subsume: es un btree
--  sobre (municipalidad_id, predio_id, tipo) que las consultas de «la version
--  abierta» pueden usar, y el GiST no lo sustituye para eso. Quitarlo seria un
--  cambio de plan que este issue no midio.
-- ============================================================================

-- ---------- La ficha catastral ----------

ALTER TABLE ficha_catastral
    ADD CONSTRAINT ficha_vigencias_no_se_pisan
        EXCLUDE USING gist (
            municipalidad_id WITH =,
            predio_id WITH =,
            tipo WITH =,
            daterange(vigencia_desde, COALESCE(vigencia_hasta, 'infinity'::date), '[]') WITH &&
        ) DEFERRABLE INITIALLY DEFERRED;

COMMENT ON CONSTRAINT ficha_vigencias_no_se_pisan ON ficha_catastral IS
    'Dos versiones de la ficha de un predio no pueden cubrir la misma fecha '
    '(#669). `ficha_vigente_uq` solo impide dos ABIERTAS; una abierta y una '
    'cerrada podian pisarse, y entonces «la ficha vigente a la fecha» devuelve '
    'dos filas y la grilla enseña el predio dos veces. DEFERRABLE porque una '
    'version nueva se abre y la anterior se cierra en la misma transaccion '
    '(V72).';

-- ---------- La titularidad ----------

ALTER TABLE titularidad
    ADD CONSTRAINT titularidad_vigencias_no_se_pisan
        EXCLUDE USING gist (
            municipalidad_id WITH =,
            predio_id WITH =,
            contribuyente_id WITH =,
            daterange(vigencia_desde, COALESCE(vigencia_hasta, 'infinity'::date), '[]') WITH &&
        ) DEFERRABLE INITIALLY DEFERRED;

COMMENT ON CONSTRAINT titularidad_vigencias_no_se_pisan ON titularidad IS
    'La misma persona no puede tener dos cuotas del mismo predio cubriendo la '
    'misma fecha (#669). La copropiedad NO se toca: son contribuyentes '
    'distintos y el contribuyente entra en la llave. Lo que se impide es que a '
    'una persona se le cuenten dos cuotas a la vez, porque el porcentaje '
    'PONDERA LA BASE IMPONIBLE del predial (NEG-05 §1) y el disparador de «no '
    'exceder 100 %» solo suma las ABIERTAS, asi que un solape historico no lo '
    've nadie. DEFERRABLE por el mismo motivo que ese disparador: una '
    'transferencia cierra una cuota y abre otra en la misma transaccion (#16, '
    'V72).';
