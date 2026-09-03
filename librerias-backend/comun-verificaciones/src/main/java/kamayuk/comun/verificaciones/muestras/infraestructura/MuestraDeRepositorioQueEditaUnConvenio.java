package kamayuk.comun.verificaciones.muestras.infraestructura;

/**
 * Muestra que viola <b>a proposito</b> la prohibicion de editar un convenio de fraccionamiento
 * (#35, V31).
 *
 * <p>Asi es como se incumple. El convenio se quiebra, hay que dejar constancia, y la salida corta
 * es escribir el estado en la columna que V3 puso para eso. Compila, y en una base sin el {@code
 * REVOKE} funcionaria.
 *
 * <p>Y lo que produce es que el papel y la base digan cosas distintas: el contribuyente firmo un
 * compromiso de pago con un cronograma, y editarlo en el sitio deja el compromiso firmado diciendo
 * una cosa y el sistema otra. Quien tenga el papel gana la discusion.
 *
 * <p>Las cuatro sentencias de aqui son las cuatro que V31 hace imposibles: el convenio y su
 * cronograma no admiten {@code UPDATE} —se lo revoca—, la deuda acogida y los movimientos no
 * admiten ni {@code UPDATE} ni {@code DELETE}. La <b>cuarta</b> es la salida comoda que quedaria si
 * solo se protegiera el convenio: en vez de editar el convenio —que ya no se puede—, editar el
 * movimiento que dice si esta quebrado, que es lo mismo con un rodeo.
 *
 * <p>Vive en {@code src/test}: el escaner solo recorre {@code src/main}, asi que no puede romper el
 * build por accidente. La revisa {@link
 * kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo este archivo del
 * disco.
 */
@SuppressWarnings("unused")
public final class MuestraDeRepositorioQueEditaUnConvenio {

    /** Editar el convenio en el sitio: lo que V31 revoca. */
    private static final String QUEBRAR = "UPDATE convenio SET estado = 'QUEBRADO' WHERE id = ?";

    /** Y su cronograma, que esta congelado por el mismo motivo que el desglose de un recibo. */
    private static final String REBAJAR_LA_CUOTA =
            "UPDATE convenio_cuota SET monto = 0 WHERE convenio_id = ?";

    /** Borrar la deuda acogida: la traza de que se fracciono desapareceria. */
    private static final String OLVIDAR_LO_ACOGIDO =
            "DELETE FROM convenio_deuda WHERE convenio_id = ?";

    /** Y la salida comoda: editar el acta en vez del convenio. Es lo mismo con un rodeo. */
    private static final String REESCRIBIR_EL_ACTA =
            "UPDATE convenio_movimiento SET motivo = 'otra cosa' WHERE id = ?";

    private MuestraDeRepositorioQueEditaUnConvenio() {}
}
