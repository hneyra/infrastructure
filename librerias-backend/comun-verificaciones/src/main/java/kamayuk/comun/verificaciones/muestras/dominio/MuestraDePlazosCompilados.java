package kamayuk.comun.verificaciones.muestras.dominio;

import java.time.LocalDate;

/**
 * Muestra que viola <b>a proposito</b> la regla 5 con los plazos del Codigo Tributario (#39).
 *
 * <p>Asi es como se incumple. Nadie decide «voy a compilar el plazo de prescripcion»: alguien
 * escribe el computo, tiene el art. 43 delante, ve que dice cuatro anios y lo pone. Funciona, pasa
 * las pruebas y se despliega.
 *
 * <p>Y lo que produce es peor que una alicuota mal puesta. Una alicuota equivocada cobra de mas o
 * de menos, y se corrige con una liquidacion. Un plazo equivocado produce <b>expedientes coactivos
 * nulos</b>: el valor se paso a coactiva antes de ser exigible, y eso no se arregla recalculando
 * —se arregla anulando el procedimiento entero, cuando el primer obligado lo impugna y el resto de
 * la cartera resulta estar en la misma situacion—.
 *
 * <p>Los tres de aqui son los tres que #39 lee del conjunto sellado: el de reclamacion tras la
 * notificacion (arts. 104 y 106), el de prescripcion (art. 43) y el desfase del inicio del computo
 * (art. 44).
 *
 * <p>Vive en {@code src/test}: el escaner solo recorre {@code src/main}, asi que no puede romper el
 * build por accidente. La revisa {@link
 * kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo este archivo del
 * disco.
 */
@SuppressWarnings("unused")
public final class MuestraDePlazosCompilados {

    /** El plazo para reclamar un valor notificado, compilado. Lo fija el Codigo Tributario. */
    private static final int PLAZO_DE_RECLAMACION_EN_DIAS = 20;

    /** El plazo de prescripcion del art. 43, compilado. */
    private static final int PRESCRIPCION_ANIOS = 4;

    /** El desfase del inicio del computo del art. 44, compilado. */
    private static final int PLAZO_INICIO_COMPUTO = 1;

    /**
     * Y aqui se usan, que es donde el defecto se vuelve invisible: la firma no dice que haya
     * ninguna cifra normativa dentro.
     */
    private LocalDate exigibleDesde(LocalDate notificacion) {
        return notificacion.plusDays(PLAZO_DE_RECLAMACION_EN_DIAS + 1L);
    }

    private MuestraDePlazosCompilados() {}
}
