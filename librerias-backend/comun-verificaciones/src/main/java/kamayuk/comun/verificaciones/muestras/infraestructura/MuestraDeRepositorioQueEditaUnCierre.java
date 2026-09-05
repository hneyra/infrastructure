package kamayuk.comun.verificaciones.muestras.infraestructura;

/**
 * Repositorio de muestra que <b>viola a proposito</b> la regla 4 sobre el cierre de caja (#36).
 *
 * <p>Aqui el defecto tiene una forma muy concreta y muy tentadora: el cajero cerro, se dio cuenta
 * de que habia contado mal el efectivo, y lo que «obviamente» hay que hacer es corregir la cifra
 * declarada. O peor: cerro, tiene que seguir cobrando, y lo natural parece volver a poner el turno
 * en ABIERTO.
 *
 * <p>No se puede, y no por purismo. Un arqueo es un acto firmado con el que se concilia el deposito
 * del dia siguiente: si la cifra declarada se puede reescribir, el descuadre desaparece del acta
 * justo cuando alguien lo esta buscando. Un cierre se <b>reversa</b> con otro registro que lo deja
 * sin efecto y reabre el turno, y las dos filas juntas cuentan lo que paso (V32, RNF-051).
 *
 * <p>{@code cierre_caja} entra tambien, y es lo que cierra el rodeo: V32 le retiro las columnas de
 * cierre que V3 le habia puesto —decian ABIERTO para siempre— y el estado del turno se deriva de
 * sus movimientos. Si el acta ya no se puede tocar, la tentacion siguiente es tocar el turno.
 *
 * <p>La barrera final es que V32 le retira a {@code kamayuk_app} el privilegio de {@code UPDATE}
 * sobre las tres tablas, pero eso falla en ejecucion; el escaner de fuentes falla en el build, que
 * es donde cuesta barato.
 *
 * <p>Vive en {@code src/test} a proposito: el escaner solo recorre {@code src/main}, asi que esta
 * clase no puede romper el build por accidente. La revisa {@link
 * kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo este archivo del
 * disco.
 */
@SuppressWarnings("unused")
public class MuestraDeRepositorioQueEditaUnCierre {

    /** Corregir el arqueo firmado: el descuadre desapareceria del acta. */
    private static final String CORRIGE_EL_ARQUEO =
            "UPDATE cierre_turno SET total_declarado = ?, diferencia = ? WHERE id = ?";

    /** Y su desglose: lo declarado por medio de pago no esta en ningun otro sitio. */
    private static final String RECOMPONE_EL_DESGLOSE =
            "UPDATE cierre_turno_detalle SET declarado = ? WHERE cierre_id = ?";

    /** Reabrir el turno con un UPDATE: el estado se deriva de cierre_turno, no se escribe. */
    private static final String REABRE_EL_TURNO =
            "UPDATE cierre_caja SET estado = 'ABIERTO' WHERE id = ?";

    /** Ni borrando el acta, claro: RNF-051. */
    private static final String BORRA_EL_CIERRE = "DELETE FROM cierre_turno WHERE turno_id = ?";

    /** Ni su desglose: un arqueo sin lineas no explica de donde salio su total. */
    private static final String BORRA_EL_DESGLOSE =
            "DELETE FROM cierre_turno_detalle WHERE cierre_id = ?";
}
