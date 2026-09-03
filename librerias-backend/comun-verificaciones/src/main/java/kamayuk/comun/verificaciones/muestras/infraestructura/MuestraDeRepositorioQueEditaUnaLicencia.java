package kamayuk.comun.verificaciones.muestras.infraestructura;

/**
 * Muestra que viola <b>a proposito</b> la prohibicion de editar una licencia de funcionamiento
 * (#44, V37).
 *
 * <p>Asi es como se incumple. El administrado cambio la denominacion comercial del local, la
 * licencia ya se emitio y esta colgada en la pared, y la salida corta es corregir la fila. Compila,
 * y en una base sin el {@code REVOKE} funcionaria.
 *
 * <p>Y lo que produce es que el papel que el titular exhibe y la base digan cosas distintas: el
 * fiscalizador lee «BODEGA SAN MARTIN» en la pared y «MINIMARKET SAN MARTIN» en la pantalla. Quien
 * tenga el papel gana la discusion.
 *
 * <p>Las cuatro sentencias son las cuatro formas en que el defecto aparece:
 *
 * <ul>
 *   <li>La <b>primera</b> es el caso directo: corregir un dato del acto ya emitido.
 *   <li>La <b>segunda</b> es el rodeo que quedaria si solo se protegiera el resto: reintroducir una
 *       columna de estado y moverla, que es exactamente lo que V37 retira. El estado se deriva de
 *       {@code licencia_movimiento}; escribirlo seria tener dos verdades.
 *   <li>La <b>tercera</b> es el rodeo por la otra puerta: reescribir el movimiento —cambiarle la
 *       fecha a la cancelacion— en vez de dejar los dos actos.
 *   <li>La <b>cuarta</b> es la mas tentadora de todas: borrar el duplicado que se autorizo por
 *       error «para que no cuente», cuando el papel marcado ya salio y el titular lo tiene.
 * </ul>
 *
 * <p>Vive en {@code src/test}: el escaner solo recorre {@code src/main}, asi que no puede romper el
 * build por accidente. La revisa {@link
 * kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo este archivo del
 * disco.
 */
@SuppressWarnings("unused")
public final class MuestraDeRepositorioQueEditaUnaLicencia {

    /** Corregir la denominacion comercial de una licencia ya emitida: lo que V37 revoca. */
    private static final String CORREGIR_LA_DENOMINACION =
            "UPDATE licencia_funcionamiento SET nombre_comercial = ? WHERE id = ?";

    /** El rodeo: devolverle una columna de estado y moverla, en vez de derivarla. */
    private static final String MOVER_EL_ESTADO =
            "UPDATE licencia_funcionamiento SET estado = 'CANCELADA' WHERE id = ?";

    /** El otro rodeo: reescribir el movimiento en vez de agregar otro. */
    private static final String REESCRIBIR_LA_CANCELACION =
            "UPDATE licencia_movimiento SET fecha = ? WHERE licencia_id = ?";

    /** Y el ultimo: borrar el duplicado autorizado por error, con el papel ya en la calle. */
    private static final String OLVIDAR_EL_DUPLICADO =
            "DELETE FROM licencia_duplicado WHERE licencia_id = ? AND numero = ?";

    private MuestraDeRepositorioQueEditaUnaLicencia() {}
}
