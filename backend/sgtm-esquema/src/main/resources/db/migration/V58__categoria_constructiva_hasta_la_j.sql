-- ============================================================================
--  V58 — Las categorias constructivas llegan a la J, no a la I (H-14, #436)
--
--  El esquema declaraba, en ocho sitios, que una categoria constructiva es una
--  letra de la `A` a la `I`. La R.M. 277-2025-VIVIENDA publica **cuatro**
--  cuadros de valores unitarios, uno por region, y el de la **Selva** (Anexo
--  I.4) tiene **diez** categorias: la `J` —«CAÑA GUAYAQUIL PONA O PINTOC»,
--  16.43 soles por m2 en muros y columnas—.
--
--  No se supo hasta que se leyeron los cuatro anexos (#436). La transcripcion
--  anterior traia solo la Costa, y su §3 lo decia con todas sus letras: «no se
--  supone que las otras tres tengan las mismas tres partidas ni cifras
--  parecidas». Tenia razon en desconfiar — y esta es la parte que rompia algo.
--
--  ---------------------------------------------------------------------------
--  1. QUE ROMPIA, EXACTAMENTE
--  ---------------------------------------------------------------------------
--
--  Dos cosas, y la segunda no espera a que se cargue ningun cuadro:
--
--    a. `valor_unitario_edificacion.categoria` habria **rechazado la fila** de
--       la categoria J al publicar el cuadro de la Selva. Es el mismo tipo de
--       hallazgo que la carga vehicular destapo ejecutando (V55, #188): una
--       clave dimensionada para lo que se habia visto, no para lo que la norma
--       publica.
--
--    b. `construccion.categoria_*` —siete columnas, una por partida— habria
--       rechazado la **declaracion de un predio de la Selva** cuyos muros sean
--       de esa categoria. Eso es hoy, sin cargar nada: cualquier municipalidad
--       de la Selva que fiche una construccion de cania guayaquil, pona o
--       pintoc se encuentra con que el sistema no la deja registrarla.
--
--  El piloto es Catacaos, que es Costa, asi que no le afecta. El producto es
--  multi-municipal, asi que si.
--
--  ---------------------------------------------------------------------------
--  2. POR QUE UN RANGO UNICO Y NO UNO POR REGION
--  ---------------------------------------------------------------------------
--
--  Porque estas columnas no saben en que region esta el predio, y averiguarlo
--  aqui seria meter en un `CHECK` una regla que depende del ubigeo.
--
--  El `CHECK` ya era una comprobacion de **forma**, no de norma: admitia A..I en
--  las siete columnas aunque el cuadro vigente solo publique tres partidas, y
--  aunque la J de la Selva exista **solo** en la columna de muros —en techos y
--  en puertas y ventanas su casilla trae puntos suspensivos—. Ampliarlo a A..J
--  conserva ese caracter: sigue atajando la errata de teclado (una `Z`, un
--  digito) y sigue sin pretender decidir que fila del cuadro corresponde a que
--  predio. Eso lo decide la valorizacion, que todavia no existe (§2 de
--  `valores-unitarios-2026.md`).
--
--  ---------------------------------------------------------------------------
--  3. LO QUE ESTA MIGRACION NO TOCA, Y NO ES UN OLVIDO
--  ---------------------------------------------------------------------------
--
--  `valor_unitario_edificacion.partida` sigue con sus **siete** valores, donde
--  la norma suma **tres**. Eso NO se corrige aqui porque no es un hecho sino una
--  decision: ese vocabulario tiene consumidores vivos —`construccion` con una
--  columna `categoria_*` por partida, `edificacion_estructura` (V43), y en Java
--  `catastro.dominio.Partida` y `licencias.dominio.PartidaDeEdificacion`—, de
--  modo que reducirlo obliga a decidir que pasa con PISOS, REVESTIMIENTOS,
--  BANIOS e INSTALACIONES en la licencia de edificacion. Cambiarlo de paso, en
--  una migracion que corrige un rango de letras, seria tomar esa decision en
--  silencio.
--
--  ---------------------------------------------------------------------------
--  4. POR QUE SE PUEDE APLICAR SOBRE DATOS
--  ---------------------------------------------------------------------------
--
--  Porque **solo amplia**: A..J contiene a A..I, asi que ninguna fila existente
--  puede violar el `CHECK` nuevo y PostgreSQL no tiene que reescribir la tabla
--  para validarlo. Es lo contrario de una restriccion que se estrecha, que si
--  tendria que comprobar cada fila y podria fallar a mitad.
-- ============================================================================

ALTER TABLE construccion
    DROP CONSTRAINT construccion_categoria_muros_check,
    DROP CONSTRAINT construccion_categoria_techos_check,
    DROP CONSTRAINT construccion_categoria_pisos_check,
    DROP CONSTRAINT construccion_categoria_puertas_check,
    DROP CONSTRAINT construccion_categoria_revestim_check,
    DROP CONSTRAINT construccion_categoria_banios_check,
    DROP CONSTRAINT construccion_categoria_instalac_check,
    ADD CONSTRAINT construccion_categoria_muros_check
        CHECK (categoria_muros      ~ '^[A-J]$'),
    ADD CONSTRAINT construccion_categoria_techos_check
        CHECK (categoria_techos     ~ '^[A-J]$'),
    ADD CONSTRAINT construccion_categoria_pisos_check
        CHECK (categoria_pisos      ~ '^[A-J]$'),
    ADD CONSTRAINT construccion_categoria_puertas_check
        CHECK (categoria_puertas    ~ '^[A-J]$'),
    ADD CONSTRAINT construccion_categoria_revestim_check
        CHECK (categoria_revestim   ~ '^[A-J]$'),
    ADD CONSTRAINT construccion_categoria_banios_check
        CHECK (categoria_banios     ~ '^[A-J]$'),
    ADD CONSTRAINT construccion_categoria_instalac_check
        CHECK (categoria_instalac   ~ '^[A-J]$');

ALTER TABLE valor_unitario_edificacion
    DROP CONSTRAINT valor_unitario_edificacion_categoria_check,
    ADD CONSTRAINT valor_unitario_edificacion_categoria_check
        CHECK (categoria ~ '^[A-J]$');

COMMENT ON COLUMN valor_unitario_edificacion.categoria IS
    'La fila del cuadro de valores unitarios, A..J. La J existe solo en el Anexo '
    'I.4 (Selva) y solo en la partida de muros y columnas; el rango es unico '
    'porque esta columna no sabe de que region es el cuadro (V58).';
