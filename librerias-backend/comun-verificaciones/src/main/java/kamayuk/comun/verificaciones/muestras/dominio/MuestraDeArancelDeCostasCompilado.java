package kamayuk.comun.verificaciones.muestras.dominio;

import java.math.BigDecimal;

/**
 * Muestra que viola <b>a proposito</b> la regla 5 con el arancel de costas del procedimiento
 * coactivo (#42).
 *
 * <p>Asi es como se incumple, y aqui es mas facil que en ningun otro sitio. Nadie decide «voy a
 * compilar el arancel de costas»: alguien escribe la liquidacion, tiene delante la tabla de la
 * ordenanza que dice cuanto cuesta cada resolucion, y la pone. Son cifras pequeñas —treinta y cinco
 * soles por una REC—, parecen un detalle, y la primera liquidacion sale bien.
 *
 * <p>Lo que produce no es una cifra desactualizada: es un <b>cobro sin sustento normativo</b>
 * repetido en toda la cartera coactiva. El arancel de costas es de ordenanza local con ratificacion
 * provincial —D-02c, y el issue #193 esta bloqueado esperandola—, y cada municipalidad de la
 * instalacion tiene la suya. Una cifra compilada es la <b>misma</b> para todas: la primera que
 * ratifique otro arancel cobrara el de la vecina sin que nada falle. Y una liquidacion ya
 * notificada se recalcularia con el valor nuevo el dia que alguien despliegue.
 *
 * <p><b>La primera constante ya la cazaba {@code ARANCEL}; la segunda y la tercera son las que
 * obligaron a agregar {@code COSTA} a la lista.</b> El {@code \b} del patron exige que el
 * identificador <b>empiece</b> por una palabra vigilada, y {@code COSTA_DE_LA_REC1} no empieza por
 * ninguna de las de antes de #42. Es exactamente el mismo hueco que #35 encontro con {@code
 * INTERES_DE_FRACCIONAMIENTO}: la regla parecia estricta y dejaba pasar la forma natural de
 * escribirlo.
 *
 * <p>Vive en {@code src/test}: el escaner solo recorre {@code src/main}, asi que no puede romper el
 * build por accidente. La revisa {@link
 * kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo este archivo del
 * disco.
 */
@SuppressWarnings("unused")
public final class MuestraDeArancelDeCostasCompilado {

    /** El arancel por acto, con el nombre que ya estaba vigilado desde antes de #42. */
    private static final BigDecimal ARANCEL_COSTA_REC1 = new BigDecimal("35.00");

    /** El mismo dato con el nombre que un dia se escribiria: este es el que #42 tuvo que cazar. */
    private static final BigDecimal COSTA_DE_LA_REC2 = new BigDecimal("50.00");

    /** Y el porcentaje de gastos de ejecucion, que es la otra forma en que la ordenanza lo fija. */
    private static final BigDecimal COSTAS_PORCENTAJE_SOBRE_LA_DEUDA = new BigDecimal("0.05");

    /**
     * Y aqui se usan, que es donde el defecto se vuelve invisible: la firma no dice que haya
     * ninguna cifra normativa dentro.
     */
    private BigDecimal costaDeLaRec1() {
        return ARANCEL_COSTA_REC1;
    }

    private MuestraDeArancelDeCostasCompilado() {}
}
