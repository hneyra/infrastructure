package kamayuk.comun.verificaciones.muestras.infraestructura;

/**
 * Muestra que viola <b>a proposito</b> las prohibiciones de #53 (V47): corregir la fecha de una
 * constancia ya entregada, retocar el criterio de una corrida masiva, y borrar la corrida entera.
 *
 * <p>Asi es como se incumple. Las tres son la salida corta de un problema real, y las tres
 * compilan.
 *
 * <p>La <b>primera</b>: la constancia salio con la fecha de verificacion equivocada y el
 * administrado ya se la llevo. Corregir la columna es un {@code UPDATE} de una linea, y deja al
 * papel diciendo un dia y al sistema otro. Como la constancia acredita precisamente «a este dia no
 * debia nada», cambiarle la fecha cambia lo que acredita: se le puede estar dando por libre en un
 * dia en el que tenia una papeleta viva.
 *
 * <p>La <b>segunda</b> es la que parece inofensiva: mover {@code fecha_criterio} de una corrida
 * «para que cuadre con el informe». Esa fecha es a la que se evaluo la deuda y el vencimiento del
 * plazo de cada candidato; movida despues de generar, la corrida dice que emitio con un criterio
 * que no es el que uso, y ya no hay manera de reconstruir por que cuatro mil papeletas entraron y
 * otras cuatro mil no.
 *
 * <p>La <b>tercera</b> es la puerta de atras: borrar la corrida «que salio mal» en vez de dejarla y
 * lanzar otra. Con ella se va la unica explicacion de que un dia salieran cuatro mil resoluciones
 * de multa numeradas.
 *
 * <p>Vive en {@code src/test}: el escaner solo recorre {@code src/main}, asi que no puede romper el
 * build por accidente. La revisa {@link
 * kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo este archivo del
 * disco.
 */
@SuppressWarnings("unused")
public final class MuestraDeRepositorioQueEditaUnaConstanciaLibre {

    /** Corregir la fecha a la que la constancia acredita, despues de entregarla. */
    private static final String CORREGIR_LA_VERIFICACION =
            "UPDATE constancia_libre SET verificada_al = ? WHERE numero = ?";

    /** Mover el criterio congelado de la corrida: lo que V47 impide sin privilegio. */
    private static final String RETOCAR_EL_CRITERIO =
            "UPDATE papeleta_masivo SET fecha_criterio = ?, hasta = ? WHERE id = ?";

    /** Y la puerta de atras: borrar la corrida en vez de dejarla y lanzar otra. */
    private static final String OLVIDAR_LA_CORRIDA = "DELETE FROM papeleta_masivo WHERE id = ?";

    private MuestraDeRepositorioQueEditaUnaConstanciaLibre() {}
}
