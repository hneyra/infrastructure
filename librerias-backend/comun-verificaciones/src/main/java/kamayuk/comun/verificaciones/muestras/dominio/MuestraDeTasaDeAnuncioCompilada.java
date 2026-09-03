package kamayuk.comun.verificaciones.muestras.dominio;

import java.math.BigDecimal;

/**
 * Muestra que viola <b>a proposito</b> la regla 5 con la tasa de anuncios y propaganda (#51, #199).
 *
 * <p>Asi es como se incumple. La ordenanza dice que un panel cuesta noventa soles, el registro de
 * un anuncio necesita la cifra para asentar el cargo, y la salida corta es escribirla aqui.
 * Compila, pasa las pruebas y calcula bien <b>este año</b>.
 *
 * <p>Lo que produce es lo de siempre, con dos agravantes propios: la tasa de anuncios es de
 * <b>ordenanza local</b> ratificada por la provincia (D-02b, #199 esta bloqueado esperandola), asi
 * que <b>cada municipalidad tiene la suya</b> —una cifra compilada obliga a un artefacto por
 * instalacion— y ademas el cargo se asienta en el momento del registro: cambiarla despues no
 * recalcula nada, deja un padron de publicidad con dos tarifas y ninguna forma de saber cual se
 * aplico a cual.
 *
 * <p><b>Las cuatro constantes son cuatro huecos distintos de la lista de nombres</b>, y por eso son
 * cuatro y no una:
 *
 * <ul>
 *   <li>{@code TASA_PANEL}: la forma directa. Antes de #51, <b>ninguna</b> palabra de la lista la
 *       cazaba; por eso entra {@code TASA}.
 *   <li>{@code TARIFA_POR_M2_DE_ANUNCIO}: la misma cifra escrita por quien prefiere no llamarla
 *       tasa. Por eso entra tambien {@code TARIFA}.
 *   <li>{@code TASAS_POR_CLASE}: el plural, que el {@code \w*} del patron cubre —conviene que la
 *       muestra lo demuestre en vez de suponerlo—.
 *   <li>{@code ARANCEL_DEL_ANUNCIO}: la palabra que ya estaba desde antes. Sigue cazando, y tenerla
 *       aqui prueba que ensanchar la lista no rompio lo que ya protegia.
 * </ul>
 *
 * <p>Vive en {@code src/test}: el escaner solo recorre {@code src/main}, asi que no puede romper el
 * build por accidente. La revisa {@link
 * kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo este archivo del
 * disco.
 */
@SuppressWarnings("unused")
public final class MuestraDeTasaDeAnuncioCompilada {

    /** La tasa de un panel, compilada. Va en el conjunto sellado como TASA_ANUNCIO:PANEL. */
    private static final BigDecimal TASA_PANEL = new BigDecimal("90.00");

    /** La misma cifra con otro nombre, que es como se cuela cuando «tasa» suena a tributo. */
    private static final BigDecimal TARIFA_POR_M2_DE_ANUNCIO = new BigDecimal("12.50");

    /** El plural, para que la muestra demuestre que el patron lo cubre. */
    private static final String TASAS_POR_CLASE = "LETRERO=45.00;TOLDO=30.00";

    /** Y la palabra que ya estaba antes de #51: sigue cazando. */
    private static final BigDecimal ARANCEL_DEL_ANUNCIO = new BigDecimal("15.00");

    private MuestraDeTasaDeAnuncioCompilada() {}
}
