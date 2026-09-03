package kamayuk.comun.verificaciones.muestras.infraestructura;

/**
 * Muestra que viola <b>a proposito</b> la prohibicion de editar un certificado emitido (#54, V51).
 *
 * <p>Asi es como se incumple. El administrado vuelve a ventanilla porque la direccion del predio
 * cambio con el saneamiento catastral, o porque su certificado de zonificacion caduca la semana que
 * viene y el tramite en el que lo presento sigue abierto; y la salida corta es corregir la fila.
 * Compila, y en una base sin el {@code REVOKE} funcionaria.
 *
 * <p>Las cuatro sentencias son las cuatro formas en que el defecto aparece, y la segunda es la que
 * hace de esta muestra algo distinto de la de la licencia:
 *
 * <ul>
 *   <li>La <b>primera</b> es el caso directo: corregir un dato del acto ya entregado. El papel que
 *       el administrado presento ante el notario y la base dirian cosas distintas, y quien tiene el
 *       papel gana.
 *   <li>La <b>segunda</b> es la peor, y es propia de este modulo: <b>alargar la vigencia</b>. Esa
 *       fecha se copio del parametro sellado que regia el dia de la emision, y moverla en el sitio
 *       deja construir en 2035 con los parametros urbanisticos de 2026 sin que nada lo delate. Un
 *       certificado que caduca tarde no cobra de menos: autoriza de mas.
 *   <li>La <b>tercera</b> es el rodeo que quedaria si solo se protegiera la cabecera: reescribir el
 *       importe del derecho para «cuadrarlo» con lo que hoy dice el TUPA. Esa cifra es lo que el
 *       recibo cobro, y cambiarla deja el certificado diciendo un importe y la caja otro.
 *   <li>La <b>cuarta</b> es la tentacion de la anulacion: borrar el certificado «porque salio mal»,
 *       cuando lo que corresponde es emitir otro y que los dos queden (regla 4, RNF-051).
 * </ul>
 *
 * <p>Vive en {@code src/test}: el escaner solo recorre {@code src/main}, asi que no puede romper el
 * build por accidente. La revisa {@link
 * kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo este archivo del
 * disco.
 */
@SuppressWarnings("unused")
public final class MuestraDeRepositorioQueEditaUnCertificado {

    /** Corregir la direccion de un certificado ya entregado: lo que V51 no concede. */
    private static final String CORREGIR_LA_DIRECCION =
            "UPDATE certificado SET direccion = ? WHERE id = ?";

    /** El peor: alargar la vigencia de un papel que ya esta en manos de alguien. */
    private static final String ALARGAR_LA_VIGENCIA =
            "UPDATE certificado SET vigencia_hasta = ? WHERE numero = ?";

    /** El rodeo: recomponer el derecho cobrado con lo que hoy dice el TUPA. */
    private static final String RECOMPONER_EL_DERECHO =
            "UPDATE certificado SET derecho = ?, derecho_a = ? WHERE id = ?";

    /** Y el ultimo: borrar el certificado «porque salio mal», en vez de emitir otro. */
    private static final String OLVIDAR_EL_CERTIFICADO = "DELETE FROM certificado WHERE numero = ?";

    private MuestraDeRepositorioQueEditaUnCertificado() {}
}
