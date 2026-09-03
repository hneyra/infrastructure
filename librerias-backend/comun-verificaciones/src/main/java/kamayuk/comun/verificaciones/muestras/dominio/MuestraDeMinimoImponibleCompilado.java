package kamayuk.comun.verificaciones.muestras.dominio;

import java.math.BigDecimal;

/**
 * Muestra que viola <b>a proposito</b> la regla 5 con el minimo imponible del vehicular (#399).
 *
 * <p>Asi es como se incumple, y aqui es de las mas faciles. El articulo 34 del TUO de la LTM dice
 * «el impuesto no sera menor al 1.5 % de la UIT», la cifra lleva anios sin cambiar, y quien escribe
 * el calculo la tiene delante. Se pone, funciona, y el primer vehiculo sale bien.
 *
 * <p><b>Su consecuencia no se parece a la de las otras.</b> Un tramo equivocado cobra de mas o de
 * menos y la diferencia se ve en el recibo; un minimo inventado no produce ninguna cifra rara:
 * eleva el suelo. Todos los vehiculos baratos del padron —los unicos a los que el minimo llega—
 * pagan un piso que ninguna norma puso, y los caros no lo notan, asi que el sintoma no aparece por
 * ningun lado hasta que alguien reclame comparando con la ley.
 *
 * <p>Y es el <b>septimo</b> agujero del mismo sitio: ninguna de las veinte palabras que vigilaba la
 * regla 5 antes de #399 caza {@code MINIMO_IMPONIBLE_VEHICULAR = new BigDecimal("1.5")} —no empieza
 * por {@code UIT}, ni por {@code ALICUOTA}, ni por {@code TASA}—, igual que {@code
 * INTERES_DE_FRACCIONAMIENTO} (#35), {@code COSTA_DE_LA_REC2} (#42), {@code TASA_PANEL} (#51) y
 * {@code VIGENCIA_DEL_CERTIFICADO} (#54). Por eso entra {@code MINIMO}.
 *
 * <p>Vive en {@code src/test}: el escaner solo recorre {@code src/main}, asi que no puede romper el
 * build por accidente. La revisa {@link
 * kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo este archivo del
 * disco.
 */
@SuppressWarnings("unused")
public final class MuestraDeMinimoImponibleCompilado {

    /** El 1.5 % de la UIT del articulo 34, compilado. Sale del conjunto sellado, no de aqui. */
    private static final BigDecimal MINIMO_IMPONIBLE_VEHICULAR = new BigDecimal("1.5");

    /** El del predial, del articulo 13, escrito de la otra forma en que se escribe. */
    private static final BigDecimal MINIMO_DEL_PREDIAL = new BigDecimal("0.6");

    /** Y el mismo dato como cuadro, que es como acaba cuando hay mas de un tributo. */
    private static final String MINIMOS_POR_TRIBUTO = "PREDIAL=0.6;VEHICULAR=1.5";

    /**
     * Y aqui se usa, que es donde el defecto se vuelve invisible: la firma no dice que haya ninguna
     * cifra normativa dentro.
     */
    private BigDecimal minimoDe(BigDecimal uit) {
        return uit.multiply(MINIMO_IMPONIBLE_VEHICULAR).movePointLeft(2);
    }

    private MuestraDeMinimoImponibleCompilado() {}
}
