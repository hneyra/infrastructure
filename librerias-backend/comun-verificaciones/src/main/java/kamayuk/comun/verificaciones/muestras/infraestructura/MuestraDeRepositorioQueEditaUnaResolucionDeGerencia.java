package kamayuk.comun.verificaciones.muestras.infraestructura;

/**
 * Muestra que viola <b>a proposito</b> las prohibiciones de #50 (V41): editar una resolucion de
 * gerencia, rellenar la salida del vehiculo encima del ingreso, y borrar el descargo que alguien
 * presento.
 *
 * <p>Asi es como se incumple. Las tres son la salida corta de un problema real, y las tres
 * compilan.
 *
 * <p>La <b>primera</b>: la gerencia se equivoco de sentido, la resolucion ya salio, y corregir la
 * columna es un {@code UPDATE} de una linea. Lo que produce es que el papel notificado diga
 * «infundado» y el sistema diga «fundado»; quien tenga el papel gana la discusion, y si el sentido
 * corregido es el que dejo la multa sin efecto, la deuda que se dio de baja no tiene resolucion que
 * la sustente.
 *
 * <p>La <b>segunda</b> es el rodeo que V41 cierra retirando la columna: en vez de registrar la
 * liberacion como un acto con su acta, rellenar {@code fecha_salida} en la fila del ingreso. Se
 * escribe aqui con el nombre que tendria si no se hubiera retirado, porque lo que el escaner mira
 * es la <b>tabla</b>: cualquier {@code UPDATE internamiento SET} es el mismo defecto, se llame como
 * se llame la columna.
 *
 * <p>La <b>tercera</b> es la otra puerta: borrar el descargo declarado improcedente «porque no
 * procedia». Con el se va la constancia de que alguien recurrio dentro del plazo, que es justo lo
 * que decide si la sancion posterior es valida.
 *
 * <p>Vive en {@code src/test}: el escaner solo recorre {@code src/main}, asi que no puede romper el
 * build por accidente. La revisa {@link
 * kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo este archivo del
 * disco.
 */
@SuppressWarnings("unused")
public final class MuestraDeRepositorioQueEditaUnaResolucionDeGerencia {

    /** Corregir el sentido del fallo despues de notificar la resolucion: lo que V41 impide. */
    private static final String CORREGIR_EL_SENTIDO =
            "UPDATE resolucion_gerencia SET sentido = 'FUNDADO', efecto = 'SE_DEJA_SIN_EFECTO'"
                    + " WHERE id = ?";

    /** El rodeo del deposito: la salida escrita encima del ingreso, en vez de como acto nuevo. */
    private static final String CERRAR_EL_INTERNAMIENTO =
            "UPDATE internamiento SET fecha_salida = ? WHERE id = ?";

    /** Y el otro rodeo: borrar el recurso improcedente en vez de resolverlo. */
    private static final String OLVIDAR_EL_DESCARGO =
            "DELETE FROM descargo WHERE numero_expediente = ?";

    private MuestraDeRepositorioQueEditaUnaResolucionDeGerencia() {}
}
