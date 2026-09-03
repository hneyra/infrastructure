package kamayuk.comun.verificaciones.muestras.infraestructura;

/**
 * El contraste de {@code NINGUN_SQL_CRUZA_LA_FRONTERA_DE_SISTEMA}: no cruza nada.
 *
 * <p>Sin el, un escaner que marcara <b>todo</b> pasaria la prueba de la muestra que cruza y nadie
 * lo notaria hasta que gritara en cada archivo del repositorio — y un escaner que grita siempre
 * deja de leerse, que es como se pierden las reglas de verdad (#437).
 *
 * <p>Lee tres cosas y las tres son legitimas: una tabla del propio sistema, una <b>replicada</b> en
 * los cuatro —{@code auditoria}, que cada sistema tiene la suya (GOB-05 §2.5)— y una que ningun
 * reparto nombra, que no se puede clasificar y por eso no se acusa.
 */
@SuppressWarnings("unused")
public final class MuestraDeConsultaQueSeQuedaEnCasa {

    private static final String LO_PROPIO =
            "SELECT id, codigo, nombre_razon_social FROM contribuyente WHERE codigo = ?";

    private static final String LO_REPLICADO =
            "SELECT tabla, operacion, observacion FROM auditoria WHERE ejercicio = ?";

    private static final String LO_QUE_NADIE_REPARTIO =
            "SELECT clave, valor FROM tabla_que_ningun_reparto_nombra WHERE clave = ?";

    private MuestraDeConsultaQueSeQuedaEnCasa() {}
}
