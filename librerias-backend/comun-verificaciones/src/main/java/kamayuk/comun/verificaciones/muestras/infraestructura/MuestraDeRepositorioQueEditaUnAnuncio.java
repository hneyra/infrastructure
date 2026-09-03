package kamayuk.comun.verificaciones.muestras.infraestructura;

/**
 * Muestra que viola <b>a proposito</b> la prohibicion de editar una autorizacion de anuncio (#51,
 * V45).
 *
 * <p>Asi es como se incumple. El administrado cambio el texto del panel, la autorizacion ya se
 * emitio y su tasa ya esta cargada en el libro, y la salida corta es corregir la fila. Compila, y
 * en una base sin el {@code REVOKE} funcionaria.
 *
 * <p>Las cuatro sentencias son las cuatro formas en que el defecto aparece, y la tercera es la que
 * hace de esta muestra algo distinto de la de la licencia:
 *
 * <ul>
 *   <li>La <b>primera</b> es el caso directo: corregir un dato del acto ya emitido. El papel que el
 *       administrado tiene y la base dirian cosas distintas, y quien tiene el papel gana.
 *   <li>La <b>segunda</b> es el rodeo que quedaria si solo se protegiera el resto: reintroducir una
 *       columna de estado y moverla, que es exactamente lo que V45 retira. El estado se deriva de
 *       {@code anuncio_movimiento}; escribirlo seria tener dos verdades, y una de ellas decide si
 *       se sigue devengando tasa.
 *   <li>La <b>tercera</b> es la peor, y es propia de este modulo: reescribir {@code
 *       referencia_cargo} para «arreglar» un cargo. Esa cadena es la que {@code
 *       anuncio_movimiento_cargo_uq} declara unica, asi que cambiarle una letra <b>permite volver a
 *       devengar el mismo ejercicio</b> —el contribuyente acaba debiendo dos veces la misma tasa— y
 *       ademas rompe el enlace con el asiento que ya esta en el libro.
 *   <li>La <b>cuarta</b> es la tentacion del cese: borrar el anuncio «para que no cuente», cuando
 *       su cargo ya esta asentado y lo que corresponde es un movimiento de cese.
 * </ul>
 *
 * <p>Vive en {@code src/test}: el escaner solo recorre {@code src/main}, asi que no puede romper el
 * build por accidente. La revisa {@link
 * kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo este archivo del
 * disco.
 */
@SuppressWarnings("unused")
public final class MuestraDeRepositorioQueEditaUnAnuncio {

    /** Corregir la denominacion de un anuncio ya autorizado: lo que V45 revoca. */
    private static final String CORREGIR_LA_DENOMINACION =
            "UPDATE anuncio SET denominacion = ? WHERE id = ?";

    /** El rodeo: devolverle una columna de estado y moverla, en vez de derivarla. */
    private static final String MOVER_EL_ESTADO =
            "UPDATE anuncio SET estado = 'RETIRADO' WHERE id = ?";

    /** El peor: reescribir la referencia del cargo, que es lo que impide cobrar dos veces. */
    private static final String REESCRIBIR_LA_REFERENCIA =
            "UPDATE anuncio_movimiento SET referencia_cargo = ? WHERE anuncio_id = ?";

    /** Y el ultimo: borrar la autorizacion cesada, con su tasa ya asentada en el libro. */
    private static final String OLVIDAR_LA_AUTORIZACION = "DELETE FROM anuncio WHERE numero = ?";

    private MuestraDeRepositorioQueEditaUnAnuncio() {}
}
