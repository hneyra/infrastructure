package kamayuk.comun.verificaciones.muestras.dominio;

import java.math.BigDecimal;

/**
 * Muestra que viola <b>a proposito</b> la regla 5 con la vigencia de un certificado (#54).
 *
 * <p>Asi es como se incumple. El TUPA dice que un certificado de parametros urbanisticos vale
 * treinta y seis meses, la emision necesita el numero para calcular hasta cuando vale, y la salida
 * corta es escribirlo aqui. Compila, pasa las pruebas y emite bien <b>este año</b>.
 *
 * <p>Lo que produce es lo de siempre —una cifra normativa que no se puede cambiar sin desplegar—
 * con un agravante propio, y es el que hace que esta muestra exista: una vigencia inventada <b>no
 * cobra de mas: autoriza de mas</b>. Un certificado que caduca demasiado tarde deja construir en
 * 2035 con los parametros urbanisticos de 2026, y eso no se descubre hasta que la obra esta
 * levantada. Uno que caduca demasiado pronto hace que se rechacen tramites legitimos en ventanilla
 * ajena, donde la municipalidad ni se entera.
 *
 * <p><b>Las cuatro constantes son el hueco que #54 destapo</b>, y por eso son cuatro:
 *
 * <ul>
 *   <li>{@code VIGENCIA_DEL_CERTIFICADO}: la forma directa. Antes de #54, <b>ninguna</b> palabra de
 *       la lista la cazaba —ni siquiera {@code PLAZO}, que es lo que mas se le parece—; por eso
 *       entra {@code VIGENCIA}.
 *   <li>{@code VIGENCIAS_POR_TIPO}: el plural con varias cifras dentro, que el {@code \w*} del
 *       patron cubre —conviene que la muestra lo demuestre en vez de suponerlo—.
 *   <li>{@code PLAZO_DE_VIGENCIA_EN_MESES}: la misma cifra escrita por quien prefiere llamarla
 *       plazo. Ya la cazaba {@code PLAZO} desde #39, y tenerla aqui prueba que ensanchar la lista
 *       no rompio lo que ya protegia.
 *   <li>{@code TASA_DEL_CERTIFICADO}: y el importe del derecho, que {@code TASA} caza desde #51. Es
 *       la otra mitad de la misma linea del TUPA, y aparece por el mismo camino.
 * </ul>
 *
 * <p>Vive en {@code src/test}: el escaner solo recorre {@code src/main}, asi que no puede romper el
 * build por accidente. La revisa {@link
 * kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo este archivo del
 * disco.
 */
@SuppressWarnings("unused")
public final class MuestraDeVigenciaDeCertificadoCompilada {

    /** Los meses que vale un certificado, compilados. Van en el conjunto sellado. */
    private static final int VIGENCIA_DEL_CERTIFICADO = 36;

    /** El plural con varias cifras, para que la muestra demuestre que el patron lo cubre. */
    private static final String VIGENCIAS_POR_TIPO = "NUMERACION=12;ZONIFICACION_VIAS=36";

    /** La misma cifra con otro nombre, que es como se cuela cuando «vigencia» suena a estado. */
    private static final int PLAZO_DE_VIGENCIA_EN_MESES = 24;

    /** Y el importe del derecho, que es la otra mitad de la misma linea del TUPA. */
    private static final BigDecimal TASA_DEL_CERTIFICADO = new BigDecimal("35.00");

    private MuestraDeVigenciaDeCertificadoCompilada() {}
}
