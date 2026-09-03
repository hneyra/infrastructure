package kamayuk.comun.verificaciones.muestras.dominio;

import java.math.BigDecimal;

/**
 * Muestra que viola <b>a proposito</b> la regla 5 con las condiciones de un convenio de
 * fraccionamiento (#35).
 *
 * <p>Asi es como se incumple, y aqui es especialmente facil. Nadie decide «voy a compilar el
 * interes del fraccionamiento»: alguien escribe el cronograma, tiene delante la ordenanza que dice
 * el 1 % mensual y hasta doce cuotas, y los pone. Funciona, pasa las pruebas, y el primer convenio
 * sale bien.
 *
 * <p>Lo que produce es peor que una cifra desactualizada. El interes y el maximo de cuotas son
 * valores de <b>ordenanza local con ratificacion provincial</b> —D-02b—, y cada municipalidad de la
 * instalacion tiene la suya: una cifra compilada es la <b>misma</b> para todas, asi que la primera
 * que ratifique un interes distinto cobrara el de otra sin que nada falle. Y un convenio ya firmado
 * se recalcularia con el valor nuevo el dia que alguien despliegue.
 *
 * <p>Las dos de aqui son las dos que #35 lee del conjunto sellado, y por eso {@code
 * RevisorDeCodigoFuente} ensancho {@code INTERES_MORATORIO} a {@code INTERES} y agrego {@code
 * CUOTAS}: con la lista anterior, {@code INTERES_DE_FRACCIONAMIENTO} no empezaba por ninguna de las
 * palabras vigiladas y pasaba sin ruido.
 *
 * <p>Vive en {@code src/test}: el escaner solo recorre {@code src/main}, asi que no puede romper el
 * build por accidente. La revisa {@link
 * kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo este archivo del
 * disco.
 */
@SuppressWarnings("unused")
public final class MuestraDeCondicionesDeConvenioCompiladas {

    /** El interes de fraccionamiento mensual, compilado. Lo fija la ordenanza, no el codigo. */
    private static final BigDecimal INTERES_DE_FRACCIONAMIENTO = new BigDecimal("1.00");

    /** El maximo de cuotas, compilado. Misma ordenanza, misma consecuencia. */
    private static final int CUOTAS_MAXIMAS = 12;

    /**
     * Y aqui se usan, que es donde el defecto se vuelve invisible: la firma no dice que haya
     * ninguna cifra normativa dentro.
     */
    private BigDecimal interesDe(BigDecimal saldo) {
        return saldo.multiply(INTERES_DE_FRACCIONAMIENTO);
    }

    private MuestraDeCondicionesDeConvenioCompiladas() {}
}
