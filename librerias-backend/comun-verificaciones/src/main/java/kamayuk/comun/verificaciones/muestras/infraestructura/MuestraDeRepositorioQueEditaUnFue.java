package kamayuk.comun.verificaciones.muestras.infraestructura;

/**
 * Muestra que viola <b>a proposito</b> la prohibicion de editar un Formulario Unico de
 * Edificaciones (#48, V43).
 *
 * <p>Asi es como se incumple. Y aqui el defecto tiene una forma que las ocho tablas anteriores no
 * tenian: la tentacion no es corregir un estado, es <b>guardar la cifra</b>.
 *
 * <p>Las cinco sentencias son las cinco formas en que aparece:
 *
 * <ul>
 *   <li>La <b>primera</b> es la que este issue existe para impedir: devolverle a la cabecera la
 *       columna {@code valor_obra} que V4 tenia y escribirla. Duplica la cifra que ya esta en el
 *       cuadro de valores unitarios de #17, y el dia que las dos difieran nadie sabra cual mando
 *       —mientras que el derecho de tramite ya se cobro sobre una de ellas—.
 *   <li>La <b>segunda</b> es el rodeo por el estado, el mismo que V37 cerro en la licencia de
 *       funcionamiento: reintroducir {@code estado} y moverlo, en vez de derivarlo de los
 *       movimientos y las vigencias.
 *   <li>La <b>tercera</b> es la corta de todas: corregir en el sitio la seccion que el administrado
 *       trajo mal, en vez de guardar la version siguiente. Borra lo que declaro primero, que es
 *       justo lo que explica la observacion del evaluador.
 *   <li>La <b>cuarta</b> reescribe la vigencia original al revalidar, en vez de agregar el tramo
 *       siguiente. Es exactamente lo que el AC 4 prohibe: deja una sola vigencia y ningun acto que
 *       explique de donde salio.
 *   <li>La <b>quinta</b> borra la linea de valorizacion que «sobraba», con la licencia ya emitida y
 *       el papel en la obra.
 * </ul>
 *
 * <p>Vive en {@code src/test}: el escaner solo recorre {@code src/main}, asi que no puede romper el
 * build por accidente. La revisa {@link
 * kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo este archivo del
 * disco.
 */
@SuppressWarnings("unused")
public final class MuestraDeRepositorioQueEditaUnFue {

    /** Guardar el valor de obra en la cabecera: la cifra duplicada que V43 retira. */
    private static final String GUARDAR_EL_VALOR_DE_OBRA =
            "UPDATE licencia_edificacion SET valor_obra = ? WHERE id = ?";

    /** El rodeo por el estado, otra vez. */
    private static final String MOVER_EL_ESTADO =
            "UPDATE licencia_edificacion SET estado = 'VENCIDA' WHERE id = ?";

    /** Corregir la seccion en el sitio en vez de versionarla. */
    private static final String CORREGIR_EL_TERRENO =
            "UPDATE edificacion_terreno SET area_terreno = ? WHERE fue_id = ?";

    /** Reescribir la vigencia al revalidar: lo que el AC 4 prohibe. */
    private static final String PISAR_LA_VIGENCIA =
            "UPDATE edificacion_vigencia SET hasta = ? WHERE licencia_id = ? AND orden = 1";

    /** Y borrar la linea de valorizacion que «sobraba», con el papel ya en la obra. */
    private static final String OLVIDAR_UNA_PARTIDA =
            "DELETE FROM edificacion_estructura WHERE fue_id = ? AND partida = ?";

    private MuestraDeRepositorioQueEditaUnFue() {}
}
