package kamayuk.comun.verificaciones.muestras.pruebas;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Optional;
import java.util.OptionalInt;

/**
 * Muestra que compara un {@link Optional} con algo que no lo es (#724).
 *
 * <p>Asi es como aparece el defecto, y por eso el compilador se calla: {@code isEqualTo(Object)}
 * acepta cualquier cosa. Al cambiar un accesor de {@code String} a {@code Optional} —lo que hizo
 * #691 con {@code llave()}—, el compilador caza todos los usos que <b>devuelven</b> el valor y no
 * dice nada de los que solo lo <b>comparan</b>.
 *
 * <p><b>Las dos mitades no cuestan lo mismo.</b> El {@code isEqualTo} deja de poder pasar nunca:
 * sale rojo, tarde, en CI, y se arregla. El {@code isNotEqualTo} pasa <b>siempre</b>, y no da
 * ningun rojo: la prueba sigue en verde diciendo que comprueba algo que ya no comprueba. Es el
 * mismo criterio con el que este repositorio exige que cada regla tenga su muestra que la viola.
 *
 * <p><b>Los contrastes de abajo no son adorno: son la mitad de la regla.</b> {@code contains(...)},
 * {@code hasValue(...)} e {@code isEmpty()} son las formas correctas, y una regla que las marcara
 * no tendria como cumplirse. Lo mismo {@code isEqualTo(Optional.of(...))}, que compara dos {@code
 * Optional}. Y lo mismo el {@code OptionalInt}, que no entra en el censo a proposito: {@code
 * assertThat(avance()).isEqualTo(OptionalInt.of(80))} esta bien.
 *
 * <p><b>El detalle que hace dificil la regla</b> es {@link #laLlaveEsUnTexto()} frente a {@link
 * #laLlaveEsUnOptional()}: el <b>mismo nombre</b> devuelve {@code Optional<String>} en una clase y
 * {@code String} en otra, que es exactamente lo que pasa hoy con {@code llave()} —{@code
 * DerechoSinParametrizar} lo declara {@code Optional} y {@code ParametroQueFalta}, la proyeccion
 * HTTP del mismo discriminador, lo lleva como componente {@code String} anulable—. Por el nombre no
 * se pueden distinguir; por el cast, si.
 *
 * <p>Vive en {@code src/test} y el escaner <b>salta el directorio de muestras</b>, asi que no puede
 * romper el build por accidente. La revisa {@link
 * kamayuk.comun.verificaciones.AsercionesQueNoPuedenFallarTestBase} leyendo este archivo del disco.
 */
@SuppressWarnings("unused")
public final class MuestraDeAsercionContraOptional {

    private MuestraDeAsercionContraOptional() {}

    /** Lo que hoy declara {@code ParametroSinPublicar}: la llave puede no haberla. */
    public interface SinPublicarDeMuestra {

        Optional<String> llaveDeLaMuestra();
    }

    /** Y esta es la de al lado, con el <b>mismo nombre</b> y otro tipo. Las dos son correctas. */
    public static final class LaLlaveEsUnTexto {

        public String llaveDeLaMuestra() {
            return "TUPA:DERECHO_TRAMITE";
        }
    }

    /** El dato con el que se compara. El nombre no se repite en ninguna otra clase. */
    public static Optional<String> laLlaveQueFalta() {
        return Optional.of("TUPA:DERECHO_TRAMITE");
    }

    /** Lo mismo pero primitivo. {@code OptionalInt} queda fuera del censo. */
    public static OptionalInt avanceDeLaMuestra() {
        return OptionalInt.of(80);
    }

    /** Asi es como se incumple. Las tres aserciones de este metodo son las que hay que cazar. */
    public static void asiSeIncumple(Object fallo) {
        // 1. La de #691: compara un Optional con un String. No puede pasar nunca, y el
        //    compilador no dice nada. El cast es lo unico que distingue este `llaveDeLaMuestra()`
        //    del de `LaLlaveEsUnTexto`, que es un String y esta bien comparado asi.
        assertThat(((SinPublicarDeMuestra) fallo).llaveDeLaMuestra())
                .isEqualTo("TUPA:DERECHO_TRAMITE");

        // 2. La peligrosa: pasa SIEMPRE. Ningun rojo la delata, ni al compilar ni al correr.
        assertThat(laLlaveQueFalta()).isNotEqualTo("OTRA_COSA");

        // 3. La misma comparacion con el Optional en el argumento.
        assertThat("TUPA:DERECHO_TRAMITE").isEqualTo(laLlaveQueFalta());
    }

    /** Y asi es como se escribe bien. Ninguna de estas puede ser un hallazgo. */
    public static void asiSeCumple(Object fallo) {
        assertThat(laLlaveQueFalta()).contains("TUPA:DERECHO_TRAMITE");
        assertThat(laLlaveQueFalta()).hasValue("TUPA:DERECHO_TRAMITE");
        assertThat(laLlaveQueFalta()).isPresent();
        assertThat(Optional.empty()).isEmpty();
        assertThat(laLlaveQueFalta()).isEqualTo(Optional.of("TUPA:DERECHO_TRAMITE"));

        // El mismo nombre, otra clase: aqui `llaveDeLaMuestra()` es un String y la comparacion
        // con un String es la correcta. Lo dice el cast, porque el nombre no puede decirlo.
        assertThat(((LaLlaveEsUnTexto) fallo).llaveDeLaMuestra()).isEqualTo("TUPA:DERECHO_TRAMITE");

        // OptionalInt no es Optional, y compararlo con OptionalInt.of(...) esta bien.
        assertThat(avanceDeLaMuestra()).isEqualTo(OptionalInt.of(80));
    }
}
