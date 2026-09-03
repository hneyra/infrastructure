-- ============================================================================
--  V73 — La muestra admite el predio SIN TITULAR, que es el que hay que
--        fiscalizar (#586, sale de #545)
--
--  ---------------------------------------------------------------------------
--  1. QUE ESTABA MAL
--  ---------------------------------------------------------------------------
--
--  #545 quito el JOIN interno con `titularidad` de la deteccion de omisos, y
--  con el entraron los predios SIN titularidad vigente: 4 977 de los 14 422 de
--  Catacaos, el 34,5 % del padron. Son el predio que nadie reclama -no hay a
--  quien notificarle, no hay quien declare- o sea el candidato de primer orden.
--
--  Pero `programa_muestra.contribuyente_id` nacio NOT NULL (V60), asi que
--  `GenerarMuestra` los apartaba al componer la muestra, y los apartaba EN
--  SILENCIO: `generar` devolvia solo cuantos entraron y la descripcion de
--  auditoria escribia unicamente `"predios": N`. Una muestra de 100 sobre un
--  padron donde un tercio no podia entrar no es una muestra de ese padron, y
--  nada en la respuesta permitia sospecharlo.
--
--  ---------------------------------------------------------------------------
--  2. POR QUE LA COLUMNA Y NO EL FILTRO
--  ---------------------------------------------------------------------------
--
--  La muestra es la LISTA DE TRABAJO de la visita, no una imputacion: estar en
--  ella no le cobra nada a nadie ni emite ningun papel. El titular hace falta
--  para el ACTO que sigue -el acta, la liquidacion, la resolucion-, no para
--  decidir a que puerta se va. Exigirlo aqui era exigir la respuesta antes de
--  hacer la pregunta.
--
--  `acta_fiscalizacion.contribuyente_id` (V4) NO se toca, y no es un olvido:
--
--    - `RegistrarActaFiscalizacion` NUNCA lee `programa_muestra`. El acta
--      recibe el contribuyente en el cuerpo de su peticion, asi que ya sabe
--      levantarse contra un predio cuyo titular el padron no conocia: la visita
--      es justamente lo que resuelve quien ocupa, y quien fiscaliza lo nombra
--      al volver.
--    - Admitir un nulo ahi produciria un acta que se puede levantar y NUNCA
--      liquidar: `TransferirARentas` necesita al obligado para el domicilio
--      fiscal, para el papel que se notifica y para asentar el cargo, y sin el
--      revienta. Seria el mismo silencio un escalon mas abajo y mas caro,
--      porque a esas alturas el fiscalizador ya hizo el viaje.
--
--  ---------------------------------------------------------------------------
--  3. QUE PASA CON LAS DOS RESTRICCIONES QUE MIRAN ESTA COLUMNA
--  ---------------------------------------------------------------------------
--
--  `programa_muestra_contribuyente_fk` sigue sirviendo: una foranea con MATCH
--  SIMPLE -el que PostgreSQL usa por omision- se da por satisfecha en cuanto
--  UNA de sus columnas es nula, asi que la fila sin titular pasa y la que
--  nombra a un contribuyente inexistente se sigue rechazando. Se mide, no se
--  supone: `MuestraDelProgramaRepositoryJdbcTest` prueba las dos direcciones.
--
--  `programa_muestra_uq` es (municipalidad_id, programa_id, predio_id) y no
--  menciona al contribuyente, asi que la unicidad no cambia: un predio sigue
--  entrando una sola vez por programa, tenga titular o no.
--
--  ---------------------------------------------------------------------------
--  4. LA MIGRACION SOLO RELAJA
--  ---------------------------------------------------------------------------
--
--  Quitar un NOT NULL no puede ser violado por ninguna fila existente y no
--  reescribe la tabla, asi que no hay riesgo de que falle sobre `stg` ni sobre
--  `prod` -al reves que el CHECK de V64, que si podia-. Y no hace falta migrar
--  ningun dato: las filas ya escritas siguen llevando su titular.
-- ============================================================================

ALTER TABLE programa_muestra
    ALTER COLUMN contribuyente_id DROP NOT NULL;

COMMENT ON COLUMN programa_muestra.contribuyente_id IS
    'El titular principal del predio -el de mayor porcentaje- a la fecha del sorteo, o NULL si el '
    'predio no tiene ninguno vigente (#586). NULO NO ES UN DATO QUE FALTE: es el predio que nadie '
    'reclama, el candidato de primer orden de la fiscalizacion, y la visita es lo que resuelve '
    'quien lo ocupa. Quien fiscaliza nombra al contribuyente en el acta, que lo sigue exigiendo '
    '(acta_fiscalizacion.contribuyente_id, V4): sin obligado no hay a quien notificar ni a quien '
    'asentarle el cargo.';

COMMENT ON TABLE programa_muestra IS
    'Los predios que un programa de fiscalizacion sorteo para inspeccionar (#481, RF-050). Es la '
    'LISTA DE TRABAJO de la visita, no una imputacion: estar en ella no le cobra nada a nadie, y '
    'por eso admite el predio sin titular vigente (#586). SOLO SE AGREGA: un predio sale de la '
    'muestra marcandolo -con su acta-, nunca borrandolo (RNF-051, regla 4). sgtm_app no recibe '
    'UPDATE ni DELETE sobre esta tabla.';
