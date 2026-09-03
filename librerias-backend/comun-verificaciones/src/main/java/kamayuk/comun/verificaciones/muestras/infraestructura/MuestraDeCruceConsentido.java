package kamayuk.comun.verificaciones.muestras.infraestructura;

/**
 * Cruza la frontera igual que su hermana, y esta en la lista de cruces consentidos.
 *
 * <p>Es la mitad de la demostracion que suele faltar: que la lista de excepciones <b>exima de
 * verdad</b>. Sin ella, una lista que no eximiera nada dejaria el escaner rojo en {@code sgtm}
 * desde el primer dia y la salida comoda seria apagar la regla.
 *
 * <p>Y lo que la lista NO permite es olvidarse: una excepcion sin issue no se construye —{@code
 * CruceConsentido} lo rechaza en su compacto— y una que ya no cruce nada se tiene que quitar,
 * porque {@code FronteraDeSistemaTestBase} lo comprueba.
 */
@SuppressWarnings("unused")
public final class MuestraDeCruceConsentido {

    private static final String EL_MISMO_CRUCE_CON_DUENO =
            "SELECT p.id FROM predio p WHERE p.cod_ref_catastral = ?";

    private MuestraDeCruceConsentido() {}
}
