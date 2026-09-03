package kamayuk.comun.verificaciones.muestras.fiscalizacion;

import java.time.LocalDate;
import java.util.List;
import kamayuk.comun.verificaciones.muestras.catastro.PredioDelContribuyente;
import kamayuk.comun.verificaciones.muestras.catastro.PrediosDelContribuyente;

/**
 * Muestra que viola <b>a proposito</b> la segunda mitad de {@code
 * SOLO_LA_TRANSFERENCIA_ESCRIBE_FUERA_DE_FISCALIZACION} (#52, AC 1): cruzar el limite hacia otro
 * contexto con un tipo que nadie clasifico.
 *
 * <p>Esta mitad parece la menor y es la que sostiene a la otra. Sin ella, la primera solo prohibe
 * usar <b>los dos puertos que hoy estan en la lista</b>: publicar manana un puerto de escritura
 * nuevo en {@code catastro} —o anadirle una escritura a un lector que ya existe— y usarlo desde
 * cualquier clase de {@code fiscalizacion} pasaria en verde, y la regla seguiria pareciendo tan
 * estricta como el primer dia. Es el mismo hueco que #35 y #42 destaparon en la lista de nombres de
 * la regla 5, dos veces.
 *
 * <p>{@code PrediosDelContribuyente} es un puerto <b>real</b> de {@code catastro} y de solo
 * lectura: la muestra no es un tipo inventado, y eso importa. Lo que se incumple no es «usar algo
 * peligroso» sino «cruzar el limite sin que nadie lo haya mirado»; la regla no puede saber sola si
 * un puerto ajeno lee o escribe, y por eso exige que alguien lo escriba en una lista y el diff lo
 * enseñe.
 *
 * <p>Vive en {@code src/test} y en un paquete que termina en {@code fiscalizacion}, para que la
 * regla la alcance sin que pueda llegar al artefacto.
 */
@SuppressWarnings("unused")
public final class MuestraQueTocaOtroContextoSinDeclararlo {

    private final PrediosDelContribuyente predios;

    public MuestraQueTocaOtroContextoSinDeclararlo(PrediosDelContribuyente predios) {
        this.predios = predios;
    }

    /** Un puerto ajeno de solo lectura, usado sin que nadie lo haya clasificado. */
    public List<PredioDelContribuyente> losPrediosDe(long contribuyenteId, LocalDate fecha) {
        return predios.de(contribuyenteId, fecha);
    }
}
