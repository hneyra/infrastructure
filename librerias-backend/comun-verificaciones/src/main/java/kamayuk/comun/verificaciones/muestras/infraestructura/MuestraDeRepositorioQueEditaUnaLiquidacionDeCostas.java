package kamayuk.comun.verificaciones.muestras.infraestructura;

/**
 * Muestra que viola <b>a proposito</b> la prohibicion de editar una liquidacion de costas (#42,
 * V35).
 *
 * <p>Asi es como se incumple. Se liquido una costa de mas —el arancel se leyo mal, o el acto no
 * correspondia—, la liquidacion ya se notifico, y la salida corta es corregir la fila. Compila, y
 * en una base sin el {@code REVOKE} funcionaria.
 *
 * <p>Y lo que produce es peor que en los casos anteriores, porque aqui hay <b>dinero ya
 * asentado</b>: el importe de la liquidacion esta en el libro como cargo de concepto {@code GASTO}.
 * Corregir la fila deja el cargo diciendo una cifra y la liquidacion otra, y la que se cobra en
 * ventanilla es la del libro. La liquidacion impresa y el estado de cuenta dejan de cuadrar sin que
 * nada falle. Lo que corresponde es reversar el asiento y liquidar de nuevo.
 *
 * <p>Las cuatro sentencias son las cuatro formas en que el defecto aparece:
 *
 * <ul>
 *   <li>corregir el total de la cabecera;
 *   <li>corregir el importe de una linea, que es el rodeo si solo se protegiera la cabecera —y deja
 *       el total sin cuadrar con su detalle—;
 *   <li>borrar la linea sobrante, que es el mismo rodeo por la otra puerta;
 *   <li>y <b>mover la obligacion de costas a otro expediente</b>, que es el rodeo especifico de
 *       #42: {@code costa_obligacion} es la unica fila que sabe de que expediente son las costas de
 *       un obligado, y cambiarla en el sitio traslada un cobro de un procedimiento a otro sin dejar
 *       rastro.
 * </ul>
 *
 * <p>Vive en {@code src/test}: el escaner solo recorre {@code src/main}, asi que no puede romper el
 * build por accidente. La revisa {@link
 * kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo este archivo del
 * disco.
 */
@SuppressWarnings("unused")
public final class MuestraDeRepositorioQueEditaUnaLiquidacionDeCostas {

    /** Corregir el total despues de asentar su cargo: lo que V35 no concede. */
    private static final String CORREGIR_EL_TOTAL =
            "UPDATE liquidacion_costas SET total = ? WHERE id = ?";

    /** El rodeo: corregir la linea, dejando el total sin cuadrar con su detalle. */
    private static final String CORREGIR_LA_LINEA =
            "UPDATE costa_procesal SET monto = ? WHERE id = ?";

    /** El mismo rodeo por la otra puerta: borrar la linea sobrante. */
    private static final String OLVIDAR_LA_LINEA = "DELETE FROM costa_procesal WHERE id = ?";

    /** Y el rodeo propio de #42: mudar las costas de un expediente a otro sin dejar rastro. */
    private static final String MUDAR_LA_OBLIGACION =
            "UPDATE costa_obligacion SET expediente_id = ? WHERE contribuyente_id = ?";

    private MuestraDeRepositorioQueEditaUnaLiquidacionDeCostas() {}
}
