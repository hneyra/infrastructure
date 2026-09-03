package kamayuk.comun.verificaciones.muestras.dominio;

import java.math.BigDecimal;

/**
 * Muestra que viola <b>a proposito</b> la regla 5 con el descuento de una campana de beneficio
 * (#72, D-02b, D-02c).
 *
 * <p>Asi es como se incumple. La ordenanza de amnistia condona el cincuenta por ciento, la pantalla
 * de acogimiento necesita el porcentaje para simular, y la salida corta es escribirlo aqui.
 * Compila, pasa las pruebas y simula bien <b>esta campana</b>.
 *
 * <p>Lo que produce tiene un agravante que ninguna de las muestras anteriores tiene: una tarifa
 * inventada cobra de mas y una vigencia inventada autoriza de mas, pero un descuento inventado
 * <b>perdona</b> de mas. La cifra sale escrita en lo que el contribuyente se lleva de ventanilla,
 * nadie la impugna —le favorece— y lo que no cuadra despues es el arqueo, cuando ya se cobro.
 * Ademas, cada municipalidad aprueba sus propias campanas: una compilada obliga a un artefacto por
 * instalacion en un producto multi-municipal.
 *
 * <p><b>Las cuatro constantes son cuatro huecos distintos de la lista de nombres</b>:
 *
 * <ul>
 *   <li>{@code BENEFICIO_AMNISTIA_2026}: la forma directa. Antes de #72, <b>ninguna</b> palabra de
 *       la lista la cazaba; por eso entra {@code BENEFICIO}.
 *   <li>{@code DESCUENTO_PRONTO_PAGO}: la misma cifra escrita por quien no la llama beneficio. Por
 *       eso entra tambien {@code DESCUENTO}.
 *   <li>{@code CONDONACION_DE_INTERESES}: y la tercera forma, que es como lo escribe la ordenanza.
 *   <li>{@code ALICUOTA_DE_LA_CAMPANIA}: la palabra que ya estaba desde el principio. Sigue
 *       cazando, y tenerla aqui prueba que ensanchar la lista no rompio lo que ya protegia.
 * </ul>
 *
 * <p>Vive en {@code src/test}: el escaner solo recorre {@code src/main}, asi que no puede romper el
 * build por accidente. La revisa {@link
 * kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo este archivo del
 * disco.
 */
@SuppressWarnings("unused")
public final class MuestraDeBeneficioCompilado {

    /**
     * El descuento de la amnistia, compilado. Va en el conjunto sellado como BENEFICIO:‹CAMPANIA›.
     */
    private static final BigDecimal BENEFICIO_AMNISTIA_2026 = new BigDecimal("50");

    /**
     * La misma cifra con otro nombre, que es como se cuela cuando «beneficio» suena a exoneracion.
     */
    private static final BigDecimal DESCUENTO_PRONTO_PAGO = new BigDecimal("15");

    /** Y la tercera forma, que es como lo escribe la ordenanza. */
    private static final String CONDONACION_DE_INTERESES = "100";

    /** La palabra que ya estaba antes de #72: sigue cazando. */
    private static final BigDecimal ALICUOTA_DE_LA_CAMPANIA = new BigDecimal("0.30");

    /**
     * Y la quinta forma, sin nombre que la delate: la cifra <b>dentro de una expresion</b>.
     *
     * <p>Es la que este issue destapo. Ninguna palabra de la lista de nombres la caza —no hay
     * constante que nombrar— y el patron de literales solo miraba {@code Alicuota.de(...)}, asi que
     * {@code new Alicuota(new BigDecimal("50"))} pasaba en verde. Es exactamente como se escribe un
     * valor por omision cuando el parametro no esta: en la rama del {@code if}, sin nombre.
     */
    static Alicuota descuentoPorOmision() {
        return new Alicuota(new BigDecimal("50"));
    }

    private MuestraDeBeneficioCompilado() {}
}
