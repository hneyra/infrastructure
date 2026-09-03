-- ============================================================================
--  V57 — La tabla de depreciacion son CUATRO tablas, no una (H-15, #188)
--
--  El Anexo I del Reglamento Nacional de Tasaciones (R.M. 172-2016-VIVIENDA)
--  publica cuatro tablas de depreciacion, una por uso de la edificacion:
--
--      01  Casa habitacion, departamentos para viviendas
--      02  Tiendas, depositos, centros de recreacion, clubes sociales
--      03  Edificios, oficinas
--      04  Salud, cines, industrias, uso educativo, talleres
--
--  y cada una cruza material estructural x estado de conservacion x antiguedad.
--  `depreciacion` tenia `(material, estado_conservacion, antiguedad_hasta)` y
--  NINGUNA columna de uso, de modo que cargar las cuatro habria dejado que
--  `depreciacion_uq` se quedara con la primera y descartara las otras tres **en
--  silencio**: depreciar una oficina con el porcentaje de una vivienda. Es el
--  mismo defecto de forma que V55 corrigio en `valor_referencial_vehiculo` con
--  la categoria —donde cargar el anexo de verdad perdio 1 890 filas— y por eso
--  `PublicarCuadros` rechazaba este cuadro nombrando el motivo en vez de
--  publicarlo incompleto.
--
--  No se arregla con cuatro ediciones distintas. Una determinacion necesita las
--  cuatro a la vez: el mismo contribuyente puede tener una vivienda y un local.
--
--  ---------------------------------------------------------------------------
--  1. QUE GUARDA `uso`, Y QUE NO DECIDE
--  ---------------------------------------------------------------------------
--
--  El numero con que la propia norma identifica la tabla: `01`..`04`. No un
--  codigo nuestro. El titulo de cada una esta transcrito verbatim en
--  `depreciacion.md` §1, que es donde vive la transcripcion firmada, y traducirlo
--  a un vocabulario propio seria convertir lo que la transcripcion prohibe
--  convertir —el mismo criterio con que `valor_referencial_vehiculo.categoria`
--  guarda «BUSES Y OMNIBUSES» tal como lo imprime el anexo—.
--
--  Y hay una decision que esta columna deliberadamente NO toma: que tabla le
--  toca a un predio. Ese mapeo —del uso que declara la ficha catastral al numero
--  de tabla del Anexo I— es criterio, no transcripcion, y hoy no esta decidido:
--  `RT-004` sigue sin escribirse. Guardar el indice de la norma deja la decision
--  donde tiene que tomarse y no la disfraza de dato cargado.
--
--  ---------------------------------------------------------------------------
--  2. «MAS DE 50 ANOS» NO TIENE TOPE
--  ---------------------------------------------------------------------------
--
--  Los once tramos que la norma rotula van de «Hasta 5» a «Mas de 50», y el
--  ultimo es abierto. `antiguedad_hasta` era `NOT NULL CHECK (> 0)`, asi que el
--  tramo abierto no tenia como entrar: cualquier centinela —999, 0, 150— seria
--  una cifra inventada dentro de un cuadro normativo, y ademas una que se lee
--  igual que un tope de verdad.
--
--  Pasa a admitir nulo, con el mismo significado que `Tramo.sinTope` en el
--  dominio y que `valor_unitario_edificacion.anio_construccion_hasta` desde V18:
--  nulo es «sin tope». Y como el nulo entra en la unicidad, la restriccion se
--  declara `NULLS NOT DISTINCT` (PostgreSQL 15+): con la semantica por omision,
--  dos filas «mas de 50 anos» del mismo material y estado NO chocarian —los
--  nulos se consideran distintos— y una edicion podria traer el tramo abierto
--  duplicado con dos porcentajes, sin que nada lo dijera.
--
--  ---------------------------------------------------------------------------
--  3. LO QUE SIGUE SIN ENTRAR, Y POR QUE ESO ESTA BIEN
--  ---------------------------------------------------------------------------
--
--  Las 36 celdas que el Anexo marca con `*` —«el perito fija los porcentajes no
--  tabulados»— y el quinto estado «Muy malo», que ninguna de las cuatro tablas
--  tabula. No se cargan con cero ni con nada: la fila no existe, y quien la
--  busque tendra que fallar nombrandola. Una celda que falta no vale cero (#48),
--  y aqui valer cero seria no depreciar una construccion ruinosa.
-- ============================================================================

ALTER TABLE depreciacion
    ADD COLUMN uso varchar(2) NOT NULL CHECK (uso ~ '^0[1-4]$'),
    ALTER COLUMN antiguedad_hasta DROP NOT NULL;

ALTER TABLE depreciacion
    DROP CONSTRAINT depreciacion_uq,
    ADD CONSTRAINT depreciacion_uq
        UNIQUE NULLS NOT DISTINCT
        (publicacion_id, uso, material, estado_conservacion, antiguedad_hasta);

COMMENT ON COLUMN depreciacion.uso IS
    'La tabla del Anexo I del Reglamento Nacional de Tasaciones a la que pertenece la fila'
    ' (01 vivienda, 02 tiendas y depositos, 03 oficinas, 04 salud/industria/educacion), con el'
    ' numero que usa la propia norma. Su titulo verbatim esta en depreciacion.md §1. Que tabla'
    ' le toca a un predio es criterio y no vive aqui: RT-004 todavia no esta escrita.';
COMMENT ON COLUMN depreciacion.antiguedad_hasta IS
    'Extremo superior del tramo de antiguedad, en anios; NULO es «mas de 50 anios», el tramo'
    ' abierto con que cierra cada tabla del Anexo I. Entra en depreciacion_uq, que por eso se'
    ' declara NULLS NOT DISTINCT: con la semantica por omision el tramo abierto se podria'
    ' duplicar con dos porcentajes distintos.';
