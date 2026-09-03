package kamayuk.comun.verificaciones;

import static org.assertj.core.api.Assertions.assertThat;

import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.lang.ArchRule;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Aplica las reglas de ARQ-04 §2 al codigo de produccion de este repositorio. Bloqueante.
 *
 * <p>Es abstracta y cada repositorio deriva la suya: lo que cambia es la configuracion, no las
 * reglas. Que sea el repositorio quien tenga la clase concreta no es un tramite —es lo que hace que
 * la barrera <b>corra</b> en su build y salga con su nombre en el paso de CI—.
 */
@DisplayName("ARQ-04 §2 — Reglas de arquitectura")
public abstract class ArquitecturaTestBase {

    private static final ConfiguracionDeLasVerificaciones CONFIG =
            ConfiguracionDeLasVerificaciones.actual();

    /**
     * Los ambitos que alguna regla acota, con el paquete que los nombra.
     *
     * <p>Existen porque dos reglas —la frontera de {@code fiscalizacion} y el panel de recaudacion—
     * estan acotadas a un contexto que no todos los sistemas tienen, y sin {@code
     * allowEmptyShould(true)} ArchUnit las rechazaria por no encontrar clases. Ese permiso las
     * volveria mudas si nadie mirara: lo que lo impide es el censo de abajo.
     */
    private static final Set<String> AMBITOS_ACOTADOS = Set.of("fiscalizacion", "indicadores");

    private static JavaClasses clases;

    @BeforeAll
    static void importar() {
        clases = ReglasDeArquitectura.clasesDeProduccion();
    }

    @Test
    @DisplayName("hay clases que revisar")
    void hayClasesQueRevisar() {
        // Si el importador no encuentra nada, todas las reglas de abajo pasan sin haber revisado
        // una sola clase. Ha pasado en otros proyectos y nadie lo nota hasta que se busca por que
        // ArchUnit nunca encontro nada.
        assertThat(clases)
                .as("el importador debe ver las clases de produccion de todos los modulos")
                .isNotEmpty();
        assertThat(clases.stream().map(JavaClass::getPackageName).distinct().toList())
                .as("los paquetes que este sistema declara suyos tienen que estar")
                .containsAll(CONFIG.paquetesQueTienenQueExistir());
    }

    @Test
    @DisplayName("las reglas acotadas encuentran clases de verdad, y las que no, lo declaran")
    void lasReglasAcotadasEncuentranClasesDeVerdad() {
        // Hasta el issue #4 esto no se podia exigir: los contextos estaban vacios y las reglas de
        // `..dominio..` llevaban `allowEmptyShould`, que es lo mismo que no tener regla. El
        // permiso se retiro, y esta asercion es la que impide que vuelva a colarse: si algun dia
        // el importador deja de ver el dominio, falla aqui y no en silencio.
        //
        // Y lleva ademas el censo de los DOS ambitos que si conservan ese permiso —la frontera de
        // fiscalizacion y el panel de recaudacion, que solo existen en `rentas`—, porque un
        // permiso que nadie mira vuelve muda a su regla: se exige que el ambito declarado ausente
        // lo este de verdad, y que el no declarado tenga clases.
        List<JavaClass> delDominio =
                clases.stream().filter(c -> c.getPackageName().contains(".dominio")).toList();

        if (CONFIG.sinContextosAcotadosTodavia()) {
            assertThat(delDominio)
                    .as(
                            "la configuracion declara que este repositorio no tiene contextos"
                                    + " acotados todavia, y ya hay %d clase(s) de dominio: quita"
                                    + " sinContextosAcotadosTodavia() de la configuracion",
                            delDominio.size())
                    .isEmpty();
        } else {
            assertThat(delDominio)
                    .as("las reglas acotadas a ..dominio.. tienen que tener algo que revisar")
                    .isNotEmpty();
        }

        for (String ambito : AMBITOS_ACOTADOS) {
            boolean hayClases =
                    clases.stream().anyMatch(c -> c.getPackageName().contains("." + ambito + "."));
            if (CONFIG.ambitosAusentes().contains(ambito)) {
                assertThat(hayClases)
                        .as(
                                "la configuracion declara ausente el ambito «%s» y ya hay clases"
                                        + " suyas: su regla esta corriendo con allowEmptyShould puesto"
                                        + " sobre codigo real, asi que quitalo de ambitosAusentes()",
                                ambito)
                        .isFalse();
            } else {
                assertThat(hayClases)
                        .as(
                                "el ambito «%s» no se declara ausente y no tiene ni una clase: su"
                                        + " regla no revisa nada. O llega el codigo, o se declara en"
                                        + " ambitosAusentes()",
                                ambito)
                        .isTrue();
            }
        }
    }

    @Test
    @DisplayName("el codigo de produccion cumple todas las reglas")
    void elCodigoDeProduccionCumpleTodasLasReglas() {
        // Se aplican TODAS, tenga este repositorio negocio o no. Con solo el migrador dentro, las
        // dieciocho pasan y eso no es vacio: es que el migrador las cumple. Lo que demuestra que
        // muerden es ReglasDeArquitecturaMuerdenTestBase, que corre igual desde el primer dia
        // porque las muestras viajan con las reglas.
        //
        // Mientras no haya contextos acotados, las reglas acotadas a `..dominio..`, `..web..` o
        // `..aplicacion..` no encuentran nada y ArchUnit las rechaza por eso —no por un
        // incumplimiento—. El permiso se da AQUI y no en cada regla a proposito: asi vale
        // exactamente mientras el repositorio declare que no tiene negocio, y esa declaracion
        // caduca sola en `lasReglasAcotadasEncuentranClasesDeVerdad`. Escrito en cada regla,
        // seguiria puesto el dia que llegue el codigo.
        boolean sinNegocio = CONFIG.sinContextosAcotadosTodavia();
        for (ArchRule regla : ReglasDeArquitectura.todas()) {
            (sinNegocio ? regla.allowEmptyShould(true) : regla).check(clases);
        }
    }
}
