package kamayuk.comun.verificaciones.muestras.dominio;

import java.math.BigDecimal;

/**
 * Muestra que viola <b>a proposito</b> la regla 5: cifras normativas escritas en el codigo.
 *
 * <p>Asi es como se incumple de verdad. Nadie decide «voy a compilar la UIT»: alguien escribe la
 * primera regla de calculo, necesita el valor, lo tiene delante en el documento del MEF y lo pone.
 * Funciona, pasa las pruebas y se despliega. El problema aparece en enero, cuando el valor cambia y
 * el sistema sigue calculando con el del ano pasado —porque cambiarlo exige un despliegue, y un
 * despliegue exige que alguien se acuerde—.
 *
 * <p>Un tramo equivocado produce deuda mal determinada en <b>todo el padron</b>, con devoluciones
 * masivas y nulidad de valores. Por eso los valores viven en datos versionados con su documento
 * fuente y su vigencia (ADR-0007), y por eso esta muestra existe: sin ella, el escaner pasaria en
 * verde tanto si funciona como si su expresion esta mal escrita.
 *
 * <p>Vive en {@code src/test}: el escaner solo recorre {@code src/main}, asi que no puede romper el
 * build por accidente. La revisa {@link
 * kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo este archivo del
 * disco.
 */
@SuppressWarnings("unused")
public final class MuestraDeValoresTributariosCompilados {

    /** La UIT del ejercicio, compilada. Cambia por decreto supremo, no por despliegue. */
    private static final BigDecimal UIT_2026 = new BigDecimal("5350");

    /** Un tramo de la escala progresiva del predial, compilado. */
    private static final BigDecimal TRAMO_PRIMERO = new BigDecimal("15");

    /** Y la alicuota de ese tramo, construida desde un literal. */
    private Alicuota alicuotaDelPrimerTramo() {
        return Alicuota.de("0.2");
    }

    private MuestraDeValoresTributariosCompilados() {}
}
