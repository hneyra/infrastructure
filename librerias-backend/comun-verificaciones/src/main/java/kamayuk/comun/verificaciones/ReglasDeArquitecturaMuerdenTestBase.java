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

    /**
     * La geometria que entra por el NOMBRE del parametro, que el {@code @TestFactory} no puede
     * sujetar.
     *
     * <p>Aquel exige que la regla lance, y le basta <b>una</b> violacion en el paquete: la muestra
     * tiene cuatro puertas y tres llegan por el tipo, por el valor de la anotacion o por un
     * componente del {@code record}, que {@code motivoDe} evalua ANTES. De modo que hacer que
     * {@code nombreDelParametro} devolviera siempre {@code null} —o sea, perder {@code
     * -parameters}— dejaba esta mitad de la regla muda y las pruebas en VERDE en los cuatro
     * backends. Es la mitad que T-0 §3.2 llama «el trabajo entero», y no estaba demostrada.
     *
     * <p>Por eso esta prueba mira el MENSAJE y no solo que lance: exige que nombre el parametro
     * cuyo unico camino posible es el nombre del bytecode.
     */
    @Test
    @DisplayName("la geometria que solo se ve por el nombre del parametro tambien se detecta")
    void laGeometriaQueEntraPorElNombreDelParametroSeDetecta() {
        assertThatThrownBy(
                        () -> ReglasDeArquitectura.TODA_GEOMETRIA_ENTRA_POR_BATCH.check(muestras))
                .as(
                        "sin leer el nombre del parametro del bytecode, esta puerta —la que Spring"
                                + " resuelve sin nombre en la anotacion— pasa en verde")
                .isInstanceOf(AssertionError.class)
                .hasMessageContaining("corregirSinNombrarElParametro")
                .hasMessageContaining("wktDelLote");
    }

    /**
     * La exencion de ADR-0048 §2 <b>no es una mordaza</b>, y el {@code @TestFactory} no lo ve.
     *
     * <p>Aquel exige que la regla lance y le basta una violacion en el paquete, que ya se la da
     * {@code MuestraDeControladorQueRecibeGeometria}. De modo que borrar la exencion entera —o
     * escribirla de forma que solo callara— dejaba esta prueba en verde. Aqui se exigen las tres
     * cosas que la hacen una decision y no un {@code @SuppressWarnings}, por el mensaje:
     *
     * <ol>
     *   <li>un metodo declarado que no trae lo que su declaracion dice, sale rojo;
     *   <li>un metodo declarado que aprovecha la exencion para colar un poligono, sale rojo. Este
     *       exige ademas que la regla mire TODOS los componentes del cuerpo y no el primero que
     *       casa: el cuerpo trae un punto y un poligono, y {@code getFields()} no promete en que
     *       orden los devuelve;
     *   <li>un metodo <b>no</b> declarado de la misma clase, con su punto, sale rojo: la exencion
     *       es por metodo y no por clase.
     * </ol>
     */
    @Test
    @DisplayName("la exencion del testimonio exige lo que promete, y no cubre la clase entera")
    void laExencionDelTestimonioNoEsUnaMordaza() {
        assertThatThrownBy(
                        () -> ReglasDeArquitectura.TODA_GEOMETRIA_ENTRA_POR_BATCH.check(muestras))
                .as("la exencion de ADR-0048 §2 tiene que cambiar la prohibicion por obligaciones")
                .isInstanceOf(AssertionError.class)
                .hasMessageContaining("sincronizarSinObservacion")
                .hasMessageContaining("poligonoDelLote")
                .hasMessageContaining("sincronizarSinDeclarar");
    }

    /**
     * Y EL CONTRASTE: el testimonio bien declarado <b>pasa</b>.
     *
     * <p>Sin esto, una exencion rota —una que no eximiera a nadie— o una regla que ignorase la
     * lista entera seguirian pasando todo lo de arriba, porque todo lo de arriba comprueba rojos.
     * Si la regla marcara este metodo, el ingreso de la tableta seria inimplementable y ADR-0048 no
     * habria decidido nada.
     */
    @Test
    @DisplayName("EL CONTRASTE: el testimonio declarado y completo no se marca")
    void elTestimonioDeclaradoYCompletoPasa() {
        assertThatThrownBy(
                        () -> ReglasDeArquitectura.TODA_GEOMETRIA_ENTRA_POR_BATCH.check(muestras))
                .isInstanceOf(AssertionError.class)
                .as("el testimonio que cumple las condiciones de ADR-0048 §2 tiene que pasar")
                .hasMessageNotContaining(".sincronizar(kamayuk");
    }
}
