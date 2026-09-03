package kamayuk.comun.verificaciones;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.lang.ArchRule;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;

/**
 * Verifica que cada regla de {@link ReglasDeArquitectura} <b>detecta</b> su violacion.
 *
 * <p>Una regla de arquitectura mal escrita —un paquete que no coincide, una condicion que nunca se
 * evalua— pasa en verde para siempre y da una sensacion de proteccion que no existe. Aqui cada
 * regla se aplica a una clase de muestra que la incumple a proposito, y se exige que falle.
 */
@DisplayName("ARQ-04 §2 — Las reglas de arquitectura muerden")
public abstract class ReglasDeArquitecturaMuerdenTestBase {

    private static JavaClasses muestras;

    @BeforeAll
    static void importarLasMuestras() {
        // Sin DO_NOT_INCLUDE_TESTS: aqui queremos justamente las clases de prueba.
        muestras =
                new ClassFileImporter()
                        .importPackages(ConfiguracionDeLasVerificaciones.PAQUETE_DE_MUESTRAS);
    }

    @TestFactory
    @DisplayName("cada regla detecta su violacion")
    Stream<DynamicTest> cadaReglaDetectaSuViolacion() {
        List<ArchRule> reglas = ReglasDeArquitectura.todas();
        return reglas.stream()
                .map(
                        regla ->
                                DynamicTest.dynamicTest(
                                        regla.getDescription(),
                                        () ->
                                                assertThatThrownBy(() -> regla.check(muestras))
                                                        .as(
                                                                "la regla no detecto la violacion"
                                                                        + " deliberada de la clase de"
                                                                        + " muestra; una regla que no"
                                                                        + " puede fallar no protege"
                                                                        + " nada")
                                                        .isInstanceOf(AssertionError.class)));
    }

    @Test
    @DisplayName("las muestras existen")
    void lasMuestrasExisten() {
        assertThatThrownBy(
                        () -> ReglasDeArquitectura.EL_DOMINIO_NO_CONOCE_FRAMEWORKS.check(muestras))
                .isInstanceOf(AssertionError.class);
    }
}
