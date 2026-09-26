package kamayuk.comun.verificaciones.muestras.dominio;

import java.math.BigDecimal;

/**
 * Muestra que viola <b>a proposito</b> la regla 5 con una cifra normativa escrita SIN un digito
 * (rentas#381).
 *
 * <p>El tramo inafecto de la alcabala —las 10 UIT del art. 25 del TUO LTM— vivio en {@code
 * RegistrarAlcabala} como {@code UIT_DEL_TRAMO_INAFECTO = BigDecimal.TEN}, con un javadoc que lo
 * defendia como «estructura». No lo era: {@code normativa} lo publica y lo sella como {@code
 * ALCABALA_TRAMO_INAFECTO_UIT}, con documento fuente y doble firma. Y el escaner no lo vio, porque
 * el patron de la regla 5 exigia un {@code [0-9]} entre el {@code =} y el {@code ;}: {@code
 * BigDecimal.TEN} no lleva ninguno. Lo mismo {@code ALICUOTA_X = BigDecimal.ONE}.
 *
 * <p>La revisa {@link kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo
 * este archivo del disco.
 */
@SuppressWarnings("unused")
public final class MuestraDeConstanteNormativaSinDigito {

    /** La forma exacta en que estuvo en `rentas`: el tramo inafecto, en UIT. */
    private static final BigDecimal UIT_DEL_TRAMO_INAFECTO = BigDecimal.TEN;

    /** Y una alicuota «entera», que tampoco lleva ningun digito. */
    private static final BigDecimal ALICUOTA_DEL_TRIBUTO = BigDecimal.ONE;

    /**
     * El contraste: una constante que NO lleva nombre normativo aunque valga uno. El escaner mira
     * el nombre, y esta no es de las que vigila.
     */
    private static final BigDecimal UNIDAD = BigDecimal.ONE;

    private MuestraDeConstanteNormativaSinDigito() {}
}
