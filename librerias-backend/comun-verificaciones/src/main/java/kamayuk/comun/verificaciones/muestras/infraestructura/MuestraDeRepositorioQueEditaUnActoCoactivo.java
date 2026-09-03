package kamayuk.comun.verificaciones.muestras.infraestructura;

/**
 * Muestra que viola <b>a proposito</b> la prohibicion de editar un acto coactivo (#41, V34).
 *
 * <p>Asi es como se incumple. El ejecutor se equivoco con la forma del embargo, ya se emitio la
 * resolucion, y la salida corta es corregir la fila. Compila, y en una base sin el {@code REVOKE}
 * funcionaria.
 *
 * <p>Y lo que produce es que el papel notificado y la base digan cosas distintas: la REC-2 que el
 * obligado tiene en la mano ordena una retencion, y el sistema dice que ordeno una inscripcion.
 * Quien tenga el papel gana la discusion, y la medida trabada sobre lo que la base dice es nula.
 *
 * <p>Las tres sentencias son las tres formas en que el defecto aparece. La <b>segunda</b> es el
 * rodeo que quedaria si solo se protegiera la medida: en vez de corregir el acto, corregir su
 * fecha, que es lo que decide si la REC-2 se dicto dentro del plazo de la REC-1. La <b>tercera</b>
 * es el rodeo por la otra puerta: borrar la diligencia que no salio bien en vez de reintentar con
 * otra, que es exactamente lo que {@code notificacion_intento_uq} (V28) existe para impedir.
 *
 * <p>Vive en {@code src/test}: el escaner solo recorre {@code src/main}, asi que no puede romper el
 * build por accidente. La revisa {@link
 * kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo este archivo del
 * disco.
 */
@SuppressWarnings("unused")
public final class MuestraDeRepositorioQueEditaUnActoCoactivo {

    /** Corregir la forma de la medida despues de notificar la resolucion: lo que V34 revoca. */
    private static final String CORREGIR_LA_MEDIDA =
            "UPDATE acto_coactivo SET medida = 'INSCRIPCION' WHERE id = ?";

    /** El rodeo: mover la fecha del acto, que es lo que decide si respeto el plazo de la REC-1. */
    private static final String ADELANTAR_LA_FECHA =
            "UPDATE acto_coactivo SET fecha = ? WHERE id = ?";

    /** Y el otro rodeo: borrar la diligencia fallida en vez de reintentar con otra fila. */
    private static final String OLVIDAR_LA_DILIGENCIA =
            "DELETE FROM notificacion WHERE objeto = 'ACTO_COACTIVO' AND objeto_id = ?";

    private MuestraDeRepositorioQueEditaUnActoCoactivo() {}
}
