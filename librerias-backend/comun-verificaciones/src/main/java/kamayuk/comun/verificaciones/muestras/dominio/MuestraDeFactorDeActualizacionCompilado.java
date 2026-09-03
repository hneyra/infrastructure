package kamayuk.comun.verificaciones.muestras.dominio;

import java.math.BigDecimal;

/**
 * Muestra que viola <b>a proposito</b> la regla 5 con el {@code % actualizacion} del predial (#437,
 * D-11).
 *
 * <p><b>Este es el mas facil de todos, y por eso el mas peligroso.</b> Los otros factores de D-11
 * al menos obligan a inventar una cifra: hay que elegir un 5, un 0,68 o un 1,5 y quien lo escribe
 * sabe que se lo esta inventando. Aqui no: el valor «obvio» es <b>100 %</b>, o sea 1, o sea
 * <i>ninguno</i>. Escribir {@code FACTOR_ACTUALIZACION = BigDecimal.ONE} no se siente como inventar
 * un dato — se siente como no aplicar ninguno.
 *
 * <p>Y ahi esta el defecto. El {@code % actualizacion} <b>multiplica el autovaluo</b> antes del
 * porcentaje de propiedad, asi que un 1 compilado no es la ausencia del factor: es la
 * <b>afirmacion</b> de que el factor vale 1 en todos los ejercicios y en todas las municipalidades.
 * En un ejercicio en que la norma diga otra cosa, el padron entero se determina de menos y ninguna
 * cifra parece mal — que es la frase con la que el propio issue #437 lo describe: un valor por
 * omision aqui no cobra de mas, <b>determina</b> de mas o de menos, en todo el padron.
 *
 * <p><b>Es el octavo agujero del mismo sitio.</b> Ninguna de las veintiuna palabras que vigilaba la
 * regla 5 antes de #437 caza {@code FACTOR_ACTUALIZACION} ni {@code PORCENTAJE_DE_ACTUALIZACION}:
 * no empiezan por {@code UIT}, ni por {@code TRAMO}, ni por {@code ALICUOTA}, ni por {@code
 * MINIMO}. Es el mismo hueco que ya se abrio con {@code INTERES_DE_FRACCIONAMIENTO} (#35), {@code
 * COSTA_DE_LA_REC2} (#42), {@code TASA_PANEL} (#51), {@code MULTA} (#52), {@code
 * VIGENCIA_DEL_CERTIFICADO} (#54), {@code BENEFICIO} (#72) y {@code MINIMO_IMPONIBLE_VEHICULAR}
 * (#399). Por eso entran {@code ACTUALIZACION} y {@code FACTOR}.
 *
 * <p>Vive en {@code src/test}: el escaner solo recorre {@code src/main}, asi que no puede romper el
 * build por accidente. La revisa {@link
 * kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo este archivo del
 * disco.
 */
@SuppressWarnings("unused")
public final class MuestraDeFactorDeActualizacionCompilado {

    /**
     * El «no aplicar ninguno» que en realidad afirma que el incremento es cero en todo ejercicio y
     * toda municipalidad. Es el valor que la captura del SRTM muestra, y por eso el mas creible.
     */
    private static final BigDecimal FACTOR_ACTUALIZACION = new BigDecimal("0.00");

    /**
     * El mismo dato escrito como porcentaje — y <b>este el escaner NO lo caza</b>, a proposito.
     *
     * <p>El patron de la regla 5 exige que la palabra vigilada este <b>al principio</b> del
     * identificador ({@code \b(UIT|TRAMO|…)\w*}), asi que {@code PORCENTAJE_DE_ACTUALIZACION} se le
     * escapa: la palabra va en medio. No es un descuido de #437 sino un limite de la regla, y
     * ensancharla a «la palabra en cualquier parte del nombre» se midio antes de descartarlo:
     * produce <b>ocho</b> falsos positivos en {@code src/main}, todos de {@code MINIMO} en
     * constantes que no son normativas —{@code LARGO_MINIMO = 5} de {@code Observacion}, {@code
     * ANIO_MINIMO = 1990} de {@code Ejercicio}, {@code DECIMALES_MINIMOS = 2} de {@code
     * FormatoDeCifra}…—. Un escaner que grita ocho veces en verde deja de leerse.
     *
     * <p>Queda aqui, y la prueba <b>exige que siga escapandose</b>: si alguien ensancha la regla,
     * esa prueba se pone roja y la decision se toma mirando, no de paso.
     */
    private static final BigDecimal PORCENTAJE_DE_ACTUALIZACION = new BigDecimal("100");

    /** Y como cuadro por ejercicio, que es donde acaba cuando alguien intenta «parametrizarlo». */
    private static final String ACTUALIZACION_POR_EJERCICIO = "2025=0.00;2026=0.00";

    /**
     * Y aqui se usa, que es donde el defecto se vuelve invisible: la firma no dice que haya ninguna
     * cifra normativa dentro, y el resultado de multiplicar por uno es indistinguible del de no
     * multiplicar.
     */
    private BigDecimal baseActualizada(BigDecimal autovaluo) {
        return autovaluo.multiply(BigDecimal.ONE.add(FACTOR_ACTUALIZACION.movePointLeft(2)));
    }

    private MuestraDeFactorDeActualizacionCompilado() {}
}
