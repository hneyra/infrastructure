-- ============================================================================
--  V59 — Las partidas del CUADRO son tres, y las de la FICHA siguen siendo
--        siete: no eran la misma cosa (H-14, #436)
--
--  `V1` declaro un vocabulario de siete partidas —MUROS, TECHOS, PISOS,
--  PUERTAS, REVESTIMIENTOS, BANIOS, INSTALACIONES— y lo puso en dos sitios a
--  la vez, afirmando que eran las dos mitades de una misma matriz. El
--  comentario de `Partida.java` lo decia con todas sus letras:
--
--      «Es el mismo catalogo que ya fija `construccion` para sus siete
--       categorias por partida (V1): esta enumeracion tiene que seguir
--       coincidiendo con esa, porque son las dos mitades de la misma matriz.»
--
--  **La norma vigente lo desmiente.** El Cuadro de Valores Unitarios Oficiales
--  de Edificacion de la R.M. 277-2025-VIVIENDA tiene TRES partidas —muros y
--  columnas, techos, y puertas y ventanas—, y lo dice en su propia nota al pie:
--  «SE OBTIENE SUMANDO LOS VALORES SELECCIONADOS DE CADA UNA DE LAS 3 COLUMNAS
--  DEL CUADRO». Sus considerandos citan la R.D. 003-2022-VIVIENDA/VMVU-DGPRVU,
--  que aprobo esa metodologia de «tres partidas de apreciacion exterior».
--
--  Y **las cuatro regiones publican las mismas tres**: leer los Anexos I.1, I.3
--  y I.4 (#436) contesto la pregunta que H-14 dejaba abierta —«leer el Anexo
--  I.1 es lo unico que puede decir si las siete partidas existen en alguna
--  region»—. No existen en ninguna.
--
--  ---------------------------------------------------------------------------
--  1. DE DONDE SALEN LAS SIETE, Y POR QUE NO SE BORRAN
--  ---------------------------------------------------------------------------
--
--  De los MANUALES, no de la norma. Dos fuentes independientes lo dicen:
--
--    - el manual del SGTM de Sullana, cuyo formulario de ficha catastral dibuja
--      las siete casillas (`V1` lo cita: «manual, cap. 2 §Caract. Construccion»,
--      y `ImportarDetalleDeFichas` lee «las siete categorias constructivas en
--      una sola columna, como las escribe el manual»);
--    - el manual M02 del MEF, via `../srtm` NEG-05 §RT-002, que las clasifica
--      bajo el rotulo «Confirmado por los manuales» — no por la resolucion.
--
--  Son dos cosas distintas que se parecian:
--
--    | `construccion.categoria_*`      | `valor_unitario_edificacion.partida` |
--    |---------------------------------|--------------------------------------|
--    | el FORMULARIO del manual        | el CUADRO de la norma                |
--    | describe una edificacion        | le pone precio a una fila del cuadro |
--    | siete caracteristicas           | tres partidas de apreciacion exterior|
--    | «Son letras, no importes»       | soles por metro cuadrado             |
--
--  Un catastro puede registrar mas caracteristicas de las que la valorizacion
--  usa; es lo normal. Lo que no puede es ponerle precio a una partida que la
--  norma no publica.
--
--  Por eso esta migracion **no toca `construccion`**: sus siete columnas
--  `categoria_*` se quedan enteras, con sus datos, y el formulario del manual
--  sigue pudiendo declararlas. Borrarlas seria perder dato historico por una
--  razon que no es suya (RNF-051, regla 4).
--
--  ---------------------------------------------------------------------------
--  2. QUE SI SE ESTRECHA, Y POR QUE LAS DOS
--  ---------------------------------------------------------------------------
--
--    a. `valor_unitario_edificacion.partida` — es el cuadro. Con siete valores
--       admitidos, publicar la edicion de la norma dejaria CUATRO partidas sin
--       ninguna fila, y «una edicion a la que le faltan cuatro partidas no se
--       distingue de una completa hasta que alguien valoriza un predio».
--
--    b. `edificacion_estructura.partida` — es lo que el proyectista declara en
--       el FUE **para valorizarlo contra ese cuadro** (V43 lo dice: «repite
--       EXACTAMENTE el vocabulario y el dominio de valor_unitario_edificacion»).
--       Si el FUE puede declarar `PISOS` y el cuadro no puede tener `PISOS`, la
--       valorizacion queda imposible para siempre y el mensaje de error miente:
--       diria «falta la celda» donde la verdad es «esa partida no existe en la
--       norma vigente». Se estrecha con (a) o no se estrecha ninguna.
--
--  ---------------------------------------------------------------------------
--  3. Y LA `J` QUE V58 SE DEJO A MEDIAS
--  ---------------------------------------------------------------------------
--
--  `V58` amplio las categorias a `A..J` en `construccion` y en
--  `valor_unitario_edificacion`, porque el Anexo I.4 (Selva) tiene diez. Se
--  dejo `edificacion_estructura.categoria` en `A..I`, y eso deja un hueco con
--  forma de defecto: una municipalidad de la Selva puede **fichar** una
--  construccion de categoria J y el cuadro puede **publicarla**, pero su FUE no
--  puede **declararla**. Se corrige aqui.
--
--  ---------------------------------------------------------------------------
--  4. POR QUE SE PUEDE ESTRECHAR SOBRE DATOS
--  ---------------------------------------------------------------------------
--
--  Porque no hay ninguno. Comprobado contra los dos ambientes reales el
--  2026-08-30: `valor_unitario_edificacion` y `edificacion_estructura` tienen
--  **cero filas** en `stg` y en `prod` — la primera porque `PublicarCuadros` no
--  sabe publicarla todavia y `sgtm_app` no puede escribirla (V55), la segunda
--  porque ningun FUE ha declarado estructura aun. Si hubiera filas con una de
--  las cuatro partidas retiradas, estas sentencias fallarian en vez de borrarlas
--  en silencio, que es lo correcto.
-- ============================================================================

ALTER TABLE valor_unitario_edificacion
    DROP CONSTRAINT valor_unitario_edificacion_partida_check,
    ADD CONSTRAINT valor_unitario_edificacion_partida_check
        CHECK (partida IN ('MUROS', 'TECHOS', 'PUERTAS'));

ALTER TABLE edificacion_estructura
    DROP CONSTRAINT edificacion_estructura_partida_check,
    DROP CONSTRAINT edificacion_estructura_categoria_check,
    ADD CONSTRAINT edificacion_estructura_partida_check
        CHECK (partida IN ('MUROS', 'TECHOS', 'PUERTAS')),
    ADD CONSTRAINT edificacion_estructura_categoria_check
        CHECK (categoria ~ '^[A-J]$');

COMMENT ON COLUMN valor_unitario_edificacion.partida IS
    'Las TRES partidas de apreciacion exterior del Cuadro de Valores Unitarios: '
    'MUROS (muros y columnas), TECHOS, PUERTAS (puertas y ventanas). No son las '
    'siete de construccion.categoria_*, que son el formulario del manual y otra '
    'cosa (V59).';

COMMENT ON COLUMN construccion.categoria_muros IS
    'Categoria del formulario de ficha catastral del manual, no del cuadro de la '
    'norma. La ficha declara siete caracteristicas; el cuadro publica tres '
    'partidas. Que se parezcan no las hace la misma cosa (V59).';
