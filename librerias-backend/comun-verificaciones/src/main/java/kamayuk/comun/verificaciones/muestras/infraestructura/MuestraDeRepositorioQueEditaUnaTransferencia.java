package kamayuk.comun.verificaciones.muestras.infraestructura;

/**
 * Muestra que viola <b>a proposito</b> las prohibiciones de #52 (V49): editar la resolucion de
 * determinacion que ya se notifico, y borrar la transferencia «que no debio hacerse».
 *
 * <p>Asi es como se incumple. Las dos son la salida corta de un problema real y las dos compilan.
 *
 * <p>La <b>primera</b>: el auditor se equivoco de sustento, la resolucion ya salio, y corregir la
 * columna es un {@code UPDATE} de una linea. Lo que produce es peor que en cualquiera de las nueve
 * tablas que llegaron antes a esta lista, porque esta fila tiene tres efectos colgando: el papel
 * notificado, la version de ficha que se inscribio en el padron y el cargo que se asento en el
 * libro. Editarla deja los cuatro diciendo cosas distintas, y el que se cobra en ventanilla es el
 * del libro.
 *
 * <p>La <b>segunda</b> es la puerta que parece limpia: borrar la fila «porque la transferencia se
 * hizo por error, y asi el sistema queda como estaba». No queda como estaba. La version nueva de la
 * ficha sigue inscrita y la anterior sigue cerrada —{@code ficha_catastral} no se borra, y no debe
 * borrarse—, y el cargo sigue en el libro. Lo unico que desaparece es el acto que los explica: el
 * padron habria cambiado y la deuda existiria sin que nada diga por que. Una transferencia
 * equivocada se deja sin efecto con otro acto, y las dos quedan.
 *
 * <p>Vive en {@code src/test}: el escaner solo recorre {@code src/main}, asi que no puede romper el
 * build por accidente. La revisa {@link
 * kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo este archivo del
 * disco.
 */
@SuppressWarnings("unused")
public final class MuestraDeRepositorioQueEditaUnaTransferencia {

    /** Corregir el sustento despues de notificar la resolucion: lo que V49 impide. */
    private static final String CORREGIR_EL_SUSTENTO =
            "UPDATE resolucion_determinacion SET sustento = ?, documento_sustento = ?"
                    + " WHERE numero = ?";

    /** Y la otra puerta: borrar la transferencia y dejar sus efectos sin explicacion. */
    private static final String OLVIDAR_LA_TRANSFERENCIA =
            "DELETE FROM resolucion_determinacion WHERE liquidacion_id = ?";

    private MuestraDeRepositorioQueEditaUnaTransferencia() {}
}
