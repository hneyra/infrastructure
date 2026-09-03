package kamayuk.comun.verificaciones.muestras.infraestructura;

/**
 * Muestra que viola <b>a proposito</b> la prohibicion de editar una liquidacion de fiscalizacion
 * (#49, V39).
 *
 * <p>Asi es como se incumple. El fiscalizador midio mal, la liquidacion ya se emitio y la salida
 * corta es corregir la fila. Compila, y en una base sin el privilegio retirado funcionaria.
 *
 * <p>Y lo que produce es que el papel notificado y la base digan cosas distintas: el contribuyente
 * tiene en la mano una liquidacion que le atribuye 125 m2 de diferencia y el sistema dice 300.
 * Quien tenga el papel gana la discusion, y la determinacion se anula en reclamacion.
 *
 * <p>Las cuatro sentencias son las cuatro formas en que el defecto aparece. La <b>primera</b> es la
 * cabecera. La <b>segunda</b> es el rodeo mas probable, y el que #49 existe para cerrar: en vez de
 * reliquidar -otra version que referencia la anterior y explica la diferencia-, reescribir la linea
 * del contraste, con lo que la version corregida y la original pasan a ser la misma fila y el
 * historico deja de poder reconstruir el proceso. La <b>tercera</b> es el rodeo por el estado,
 * igual que en {@code MuestraDeRepositorioQueEditaUnRecibo} (#34): si la cabecera ya no se puede
 * tocar, corregir la fila que dice en que estado esta. Y la <b>cuarta</b> es el borrado: quitar la
 * linea incomoda en vez de emitir la version que la corrige.
 *
 * <p>Vive en {@code src/test}: el escaner solo recorre {@code src/main}, asi que no puede romper el
 * build por accidente. La revisa {@link
 * kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo este archivo del
 * disco.
 */
@SuppressWarnings("unused")
public final class MuestraDeRepositorioQueEditaUnaLiquidacion {

    /** Corregir la cabecera despues de notificarla: lo que V39 no concede. */
    private static final String CORREGIR_LA_CABECERA =
            "UPDATE liquidacion_fiscalizacion SET motivo_determinante = ? WHERE id = ?";

    /** El rodeo que #49 cierra: reescribir el contraste en vez de reliquidar. */
    private static final String REESCRIBIR_EL_CONTRASTE =
            "UPDATE liquidacion_detalle SET area_hallada = ? WHERE liquidacion_id = ?";

    /** El rodeo por el estado: si la cabecera no se toca, tocar el movimiento que lo dice. */
    private static final String REESCRIBIR_EL_ESTADO =
            "UPDATE liquidacion_movimiento SET estado = 'ABIERTA' WHERE liquidacion_id = ?";

    /** Y el borrado: quitar la linea incomoda en vez de emitir la version que la corrige. */
    private static final String OLVIDAR_LA_LINEA =
            "DELETE FROM liquidacion_detalle WHERE liquidacion_id = ? AND ejercicio = ?";

    private MuestraDeRepositorioQueEditaUnaLiquidacion() {}
}
