package kamayuk.comun.verificaciones.muestras.infraestructura;

/**
 * Repositorio de muestra que <b>viola a proposito</b> la regla 4 sobre el recibo (#33, #34).
 *
 * <p>Es la forma en que el defecto aparece de verdad: nadie escribe {@code DELETE FROM recibo} —eso
 * se ve venir— pero corregir un importe «que estaba mal» o marcar el papel como anulado en su
 * propia fila parece lo natural. V3 llego a dejar las columnas {@code estado}, {@code
 * fecha_anulacion}, {@code usuario_anulacion} y {@code motivo_anulacion} ahi mismo, invitando a
 * usarlas; V30 las retiro precisamente por eso, y porque decian {@code EMITIDO} para siempre.
 *
 * <p>No se puede. Un recibo es un documento con numeracion correlativa que el contribuyente se
 * lleva impreso: editarlo en la base deja al papel y al sistema diciendo cosas distintas, y quien
 * tenga el papel gana la discusion. Su detalle esta congelado por el mismo motivo —la reimpresion
 * tiene que salir identica aunque el libro haya seguido moviendose—. La anulacion y el duplicado
 * (#34) se registran como movimientos que se <b>agregan</b>, igual que {@code valor_movimiento} en
 * V28.
 *
 * <p>Y el movimiento tampoco se edita, que es la salida con rodeo: si el recibo ya no se puede
 * tocar, la tentacion siguiente es corregir la fila que dice si esta anulado. Una anulacion
 * registrada por error no se borra ni se reescribe —eso dejaria un recibo que estuvo sin efecto sin
 * rastro de haberlo estado—: lo que corresponde es otro acto.
 *
 * <p>La barrera final es que V29 y V30 le retiran a {@code kamayuk_app} el privilegio de {@code
 * UPDATE} sobre las tres tablas, pero eso falla en ejecucion; el escaner de fuentes falla en el
 * build, que es donde cuesta barato.
 *
 * <p>Vive en {@code src/test} a proposito: el escaner solo recorre {@code src/main}, asi que esta
 * clase no puede romper el build por accidente. La revisa {@link
 * kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo este archivo del
 * disco.
 */
@SuppressWarnings("unused")
public class MuestraDeRepositorioQueEditaUnRecibo {

    /** Corregir el papel en la base: el recibo impreso seguiria diciendo otra cosa. */
    private static final String CORRIGE_EL_TOTAL =
            "UPDATE recibo SET total = ?, observacion = ? WHERE id = ?";

    /** Y el desglose esta congelado: recomponerlo haria que el duplicado no fuera un duplicado. */
    private static final String RECOMPONE_EL_DETALLE =
            "UPDATE recibo_detalle SET monto = ? WHERE recibo_id = ?";

    /**
     * Anular no es editar el movimiento que anula: una anulacion por error se corrige con otro
     * acto.
     */
    private static final String REESCRIBE_LA_ANULACION =
            "UPDATE recibo_movimiento SET motivo = ? WHERE recibo_id = ?";

    /** Ni borrando, claro: RNF-051 lo prohibe desde antes que nada de esto existiera. */
    private static final String BORRA_EL_DETALLE = "DELETE FROM recibo_detalle WHERE recibo_id = ?";

    /** Ni el movimiento: un recibo que estuvo anulado tiene que seguir diciendo que lo estuvo. */
    private static final String BORRA_EL_MOVIMIENTO =
            "DELETE FROM recibo_movimiento WHERE recibo_id = ?";
}
