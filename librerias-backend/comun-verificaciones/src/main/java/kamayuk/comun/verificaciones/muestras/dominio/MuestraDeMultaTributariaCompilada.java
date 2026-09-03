package kamayuk.comun.verificaciones.muestras.dominio;

import java.math.BigDecimal;

/**
 * Muestra que viola <b>a proposito</b> la regla 5 con la multa tributaria del art. 176 (#52).
 *
 * <p>Asi es como se incumple, y este es el sitio donde mas facil resulta. Alguien escribe la
 * transferencia a rentas, tiene delante la tabla de infracciones y sanciones del Codigo Tributario
 * —«no presentar la declaracion jurada dentro del plazo: 50 % de la UIT»— y la pone. Es <b>una</b>
 * cifra, se lee en la propia norma y la primera resolucion sale bien.
 *
 * <p>Lo que produce no es un cobro desactualizado: es una <b>sancion sin norma que la sostenga</b>,
 * repetida en todo el padron fiscalizado a la vez. La multa del 176 no es un porcentaje suelto —lo
 * es de la UIT, que cambia todos los años— y ademas se le aplica el <b>regimen de gradualidad</b>,
 * que la reduce segun cuando se subsane. Compilarla congela las dos cosas: la UIT del año en que
 * alguien escribio la linea, y una gradualidad que no depende del contribuyente. Cada resolucion
 * emitida asi es impugnable, y la que se impugna es la que ya se notifico.
 *
 * <p><b>Ninguno de estos tres nombres lo cazaba la lista anterior a #52</b>, y ese es el punto. El
 * {@code \b} del patron exige que el identificador <b>empiece</b> por una palabra vigilada: {@code
 * MULTA_DEL_ARTICULO_176} no empieza por {@code UIT}, ni por {@code ALICUOTA}, ni por {@code
 * TRAMO}, ni por ninguna de las doce de antes. Es el mismo hueco que #35 abrio con {@code
 * INTERES_DE_FRACCIONAMIENTO} y #42 con {@code COSTA_DE_LA_REC2}: tercera vez, mismo sitio, misma
 * correccion —una palabra mas en la lista, y una muestra que demuestre que muerde—.
 *
 * <p>Vive en {@code src/test}: el escaner solo recorre {@code src/main}, asi que no puede romper el
 * build por accidente. La revisa {@link
 * kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo este archivo del
 * disco.
 */
@SuppressWarnings("unused")
public final class MuestraDeMultaTributariaCompilada {

    /** El porcentaje de la UIT del art. 176, escrito como lo dice la tabla de la norma. */
    private static final BigDecimal MULTA_DEL_ARTICULO_176 = new BigDecimal("0.50");

    /** La rebaja del regimen de gradualidad, que es la otra mitad y depende del caso. */
    private static final BigDecimal MULTA_GRADUALIDAD_SUBSANACION_VOLUNTARIA =
            new BigDecimal("0.90");

    /** Y el minimo, que en la practica es el que se acaba cobrando siempre. */
    private static final BigDecimal MULTA_MINIMA_EN_SOLES = new BigDecimal("50.00");

    /**
     * Y aqui se usan, que es donde el defecto se vuelve invisible: la firma no dice que haya
     * ninguna cifra normativa dentro.
     */
    private BigDecimal multaPorNoDeclarar() {
        return MULTA_DEL_ARTICULO_176;
    }

    private MuestraDeMultaTributariaCompilada() {}
}
