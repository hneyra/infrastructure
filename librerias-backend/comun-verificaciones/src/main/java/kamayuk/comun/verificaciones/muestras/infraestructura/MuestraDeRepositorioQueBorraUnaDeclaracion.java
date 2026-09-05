package kamayuk.comun.verificaciones.muestras.infraestructura;

/**
 * Muestra que viola <b>a proposito</b> la prohibicion de borrar una declaracion jurada (#365, V54).
 *
 * <p>Asi es como se incumple. El contribuyente presento dos veces por error, o ventanilla registro
 * la DJ contra el predio equivocado, y la salida corta es que la fila desaparezca. Compila, y en
 * una base que le concediera {@code DELETE} a {@code kamayuk_app} funcionaria.
 *
 * <p>Las dos sentencias son las dos formas en que el defecto aparece:
 *
 * <ul>
 *   <li>La <b>primera</b> borra la declaracion. Es la que mas se parece a arreglar algo y la que
 *       mas rompe: la DJ es el documento que el contribuyente firma y se lleva, y es ademas el
 *       sustento de la determinacion —y, desde ADR-0015, <b>lo unico</b> que mete al predio en el
 *       padron afecto—. Borrarla saca al predio de la conciliacion sin que quede acto que lo
 *       explique: exactamente un omiso fabricado. Lo que corresponde es anularla, y que quede.
 *   <li>La <b>segunda</b> es el rodeo: borrar la rectificatoria para «deshacer» una correccion. La
 *       anterior se quedaria {@code SUSTITUIDA} y sin sustituta, o sea el predio fuera del padron
 *       afecto por partida doble.
 * </ul>
 *
 * <p><b>Por que aqui no hay ningun {@code UPDATE}, y es deliberado.</b> {@code declaracion_jurada}
 * entra en {@code TABLAS_PROTEGIDAS} y <b>no</b> en {@code TABLAS_INMUTABLES}: su columna {@code
 * estado} si se actualiza en el sitio —observar, anular y sustituir son eso—, y quien lo permite es
 * V54, que le retira a {@code kamayuk_app} el {@code UPDATE} sobre la tabla y le concede el de esa
 * columna y solo esa. Las demas columnas —numero, fecha, tipo, predio, contribuyente, fuera de
 * plazo— no las protege este escaner sino el motor, y eso se comprueba ejecutando: {@code
 * RegistrarDeclaracionJuradaTest} lanza el {@code UPDATE} por SQL directo como {@code kamayuk_app}
 * y exige un {@code 42501}.
 *
 * <p>Vive en {@code src/test}: el escaner solo recorre {@code src/main}, asi que no puede romper el
 * build por accidente. La revisa {@link
 * kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo este archivo del
 * disco.
 */
@SuppressWarnings("unused")
public final class MuestraDeRepositorioQueBorraUnaDeclaracion {

    /** Borrar la DJ «porque el contribuyente presento dos veces»: se anula, no se borra. */
    private static final String OLVIDAR_LA_DECLARACION =
            "DELETE FROM declaracion_jurada WHERE numero = ?";

    /** El rodeo: deshacer una rectificatoria borrandola, y dejar a la anterior sin sustituta. */
    private static final String DESHACER_LA_RECTIFICATORIA =
            "DELETE FROM declaracion_jurada WHERE dj_rectifica_id = ?";

    private MuestraDeRepositorioQueBorraUnaDeclaracion() {}
}
