-- ============================================================================
--  V74 — El tributo del libro es un vocabulario cerrado (#553)
--
--  `cuenta_corriente_asiento.tributo` nacio en V2 como `varchar(20) NOT NULL`
--  sin ninguna restriccion, mientras la tabla de al lado —`determinacion`— si
--  declaraba la suya desde el mismo archivo:
--
--      CHECK (tributo IN ('PREDIAL','ARBITRIO','VEHICULAR','ALCABALA',
--                         'ESPECTACULOS','ANUNCIOS','JUEGOS'))
--
--  `ClaveDeSaldo` compara ese texto por igualdad exacta, asi que **dos grafias
--  del mismo tributo son dos obligaciones distintas**. Y no era una hipotesis:
--  `DeterminarArbitrios` asienta `ARBITRIO` y `ejemplos/deuda.csv` sembraba
--  `ARBITRIOS`, de modo que el filtro «Arbitrios» de la consulta unificada
--  —que compara contra el singular— no encontraba la deuda de arbitrios
--  sembrada. El sintoma no se parece a un error: la deuda existe, se cobra y
--  suma en el total del contribuyente, pero cae al lado de la que deberia ser
--  la misma. Una baja tampoco encuentra la deuda que quiere extinguir.
--
--  ---------------------------------------------------------------------------
--  1. LOS DOCE, Y DE DONDE SALEN
--  ---------------------------------------------------------------------------
--
--  Los siete de `determinacion` (V2), mas los cinco que los modulos ya escriben
--  en el libro y esa lista no tenia:
--
--    - MULTA_TRIBUTARIA      TransferirARentas (#49, #52)
--    - MULTA_TRANSITO        ObligacionDeLaPapeleta (#46)
--    - MULTA_ADMINISTRATIVA  ObligacionDeLaPapeleta (#47)
--    - CONVENIO              CobrarDeuda (#35)
--    - 'COSTAS PROCESALES'   LiquidacionDeCostas (#42)
--
--  El ultimo lleva un **espacio**, no un guion bajo, y se conserva tal cual:
--  esas filas ya estan escritas desde #42, y reescribirlas a COSTAS_PROCESALES
--  huerfanaria las costas ya liquidadas —la obligacion que la REC-2 imprime
--  dejaria de ser la que el expediente cobra—. Por eso el enumerado que lo
--  acompana, `pe.gob.sgtm.cuentacorriente.TributoDelLibro`, tiene un `texto()`
--  explicito y no se deja decidir por `name()`.
--
--  MULTA_ADMINISTRATIVA mide exactamente 20 caracteres: el vocabulario NO tiene
--  margen en `varchar(20)`. Un nombre mas largo exige migrar la columna.
--
--  ---------------------------------------------------------------------------
--  2. POR QUE `NOT VALID`, Y POR QUE **NO** ES POR RLS
--  ---------------------------------------------------------------------------
--
--  DAT-01 §0 hallazgo 4 dice que una restriccion nueva sobre una tabla con RLS
--  no se puede validar. Eso es cierto de una CLAVE FORANEA —valida lanzando una
--  consulta, que queda sujeta a la politica— y V64 (#542) ya midio que **no lo
--  es de un `CHECK`**: el escaneo de validacion de un `CHECK` no atraviesa la
--  politica.
--
--  El motivo es el otro, y aqui no hace falta suponerlo: **el propio
--  repositorio sembraba la grafia que este `CHECK` rechaza**.
--  `infra/carga-de-datos/ejemplos/deuda.csv` tiene 18 filas `ARBITRIOS`, y toda
--  instalacion de demostracion las cargo. Validado, este `ALTER TABLE` falla con
--  «is violated by some row» y deja la instalacion sin migrar y sin arrancar;
--  `NOT VALID` la despliega y no debilita nada hacia adelante: la restriccion se
--  comprueba en cada `INSERT` desde este momento.
--
--  ---------------------------------------------------------------------------
--  3. POR QUE EL `CHECK` EXCEPTUA A LA REVERSION
--  ---------------------------------------------------------------------------
--
--  Las filas ya escritas con otra grafia no se borran (regla 4, RNF-051) y no se
--  reescriben: el libro no admite `UPDATE` desde la aplicacion (V7:139) y el
--  migrador no puede hacerlo tampoco —corre sin contexto de tenant, y un
--  `UPDATE` sobre una tabla con RLS muere con «unrecognized configuration
--  parameter "app.municipalidad_id"» (DAT-01 §0, medido igual en V64)—.
--
--  Lo unico que la regla 4 deja abierto para corregir un asiento equivocado es
--  **reversarlo**: asentar su opuesto, con `asiento_reversado_id` apuntando al
--  original. Y una reversion **copia** el tributo del original, porque si no, no
--  netea. Un `CHECK` sin excepcion cerraria ese camino justo sobre las filas que
--  mas falta hace poder corregir: la unica salida seria dejar la obligacion
--  partida en dos para siempre.
--
--  Por eso la restriccion es «el vocabulario, **o** eres la reversion de otra
--  fila». No debilita lo que este issue cierra: `asiento_reversado_id` solo lo
--  pone `Asiento.reversionDe`, que exige un asiento ya guardado, y un asiento
--  nuevo —el unico que puede introducir una grafia nueva— lo lleva en nulo.
--
--  ---------------------------------------------------------------------------
--  4. POR QUE `saldo_proyectado` NO LLEVA `CHECK`
--  ---------------------------------------------------------------------------
--
--  Porque no es la verdad: es la cache reconstruible del libro (V2), y su
--  `tributo` no puede venir de ningun otro sitio que de un asiento —
--  `ProyeccionDelSaldo` lo deriva de las filas de `cuenta_corriente_asiento`—.
--  Con el libro acotado, la cache lo esta transitivamente, asi que un `CHECK`
--  aqui no anade ninguna proteccion.
--
--  Y si cuesta: `RegistrarAsiento.reproyectar` corre en CADA escritura y hace
--  un UPSERT de la obligacion tocada. Con un `CHECK` en la cache, reconstruir el
--  saldo de una obligacion con grafia vieja —y reversarla, que reproyecta
--  tambien— fallaria; el defecto detectable se convertiria en un estado de
--  cuenta que revienta. Se decide donde esta la verdad y no donde esta la copia.
--
--  ---------------------------------------------------------------------------
--  5. LO QUE ESTA MIGRACION NO HACE
--  ---------------------------------------------------------------------------
--
--  No toca `beneficio.tributo`, `valor_detalle.tributo`, `convenio_deuda.tributo`
--  ni las demas columnas `tributo` que otras tablas copiaron del libro. El issue
--  es del libro y su cache, que es donde vive la clave de una obligacion; abrir
--  el resto seria una barrida de esquema con su propio riesgo de datos, y ninguna
--  de esas columnas decide si dos deudas son la misma.
--
--  Lo que si se corrige, porque es dato de este repositorio y de nadie mas, es
--  `infra/carga-de-datos/ejemplos/deuda.csv`: sus 18 filas `ARBITRIOS` pasan a
--  `ARBITRIO`, que es la grafia que el sistema escribe.
-- ============================================================================

ALTER TABLE cuenta_corriente_asiento
    ADD CONSTRAINT asiento_tributo_ck
        CHECK (asiento_reversado_id IS NOT NULL
               OR tributo IN (
                   'PREDIAL',
                   'ARBITRIO',
                   'VEHICULAR',
                   'ALCABALA',
                   'ESPECTACULOS',
                   'ANUNCIOS',
                   'JUEGOS',
                   'MULTA_TRIBUTARIA',
                   'MULTA_TRANSITO',
                   'MULTA_ADMINISTRATIVA',
                   'CONVENIO',
                   'COSTAS PROCESALES'))
        NOT VALID;

COMMENT ON COLUMN cuenta_corriente_asiento.tributo IS
    'A que tributo se imputa el asiento, de los doce que declara '
    'pe.gob.sgtm.cuentacorriente.TributoDelLibro. Es parte de la clave de una '
    'obligacion (saldo_uq), asi que dos grafias del mismo tributo son dos '
    'deudas distintas: por eso el vocabulario es cerrado desde V74 (#553). Una '
    'fila que reversa a otra queda exceptuada, porque copia el tributo del '
    'original y reversar es el unico modo de corregir un asiento (regla 4).';

COMMENT ON COLUMN saldo_proyectado.tributo IS
    'El tributo de la obligacion, derivado siempre de sus asientos. Sin CHECK a '
    'proposito: es cache reconstruible y acotarla impediria reproyectar una '
    'obligacion con grafia anterior a V74, que es justo la que hay que poder '
    'seguir leyendo y detectando (#553).';
