package kamayuk.comun.verificaciones;

import static org.assertj.core.api.Assertions.assertThat;

import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.lang.ArchRule;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;
import kamayuk.comun.verificaciones.SujetosDeLaConfiguracion.EntradaSinSujeto;
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
    private static JavaClasses muestras;

    @BeforeAll
    static void importar() {
        clases = ReglasDeArquitectura.clasesDeProduccion();
        // Las muestras entran aparte y no mezcladas: las reglas se aplican solo a produccion, pero
        // las listas de exencion se expanden bajo LOS DOS arboles (`bajoLasDosRaices`), asi que
        // contrastarlas solo contra produccion pondria rojas las entradas que existen para que la
        // regla pueda demostrarse sobre su muestra.
        muestras =
                new ClassFileImporter()
                        .importPackages(ConfiguracionDeLasVerificaciones.PAQUETE_DE_MUESTRAS);
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
        // veinte pasan y eso no es vacio: es que el migrador las cumple. Lo que demuestra que
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

    @Test
    @DisplayName("ninguna entrada de la configuracion nombra algo que no esta")
    void ningunaEntradaDeLaConfiguracionNombraAlgoQueNoEsta() {
        // #27. Todas estas listas se consultan por NOMBRE, con `contains` o con
        // `getOrDefault(..., SISTEMA_REPLICADO)`. Un nombre que no casa con nada NO es un error:
        // no exime, no permite y no clasifica a nadie, y el conjunto sigue en verde. Medido:
        // borrando `kamayuk.catastro.fiscalizacion.dominio.Tolerancia` y dejando su nombre en
        // `envoltoriosDeDecimal()`, `verificarArquitectura` daba BUILD SUCCESSFUL.
        //
        // Solo se exige a las CINCO listas que eximen o permiten. El porque de esa linea —y por
        // que las otras dos van a un censo y no a un rojo— esta en SujetosDeLaConfiguracion.
        assertThat(clases)
                .as(
                        "sin clases importadas esta guarda no mide nada: pasaria en verde con todas"
                                + " las entradas muertas del mundo dentro")
                .isNotEmpty();

        // La sexta —`escritoresDeLaAutorizacionConMotivo`— solo cuenta si este repositorio la ha
        // declarado: por omision devuelve `null`, que significa «la prohibicion de ADR-0039
        // todavia no esta activa aqui» y no «no exime a nadie». Sumar `null` seria contarla como
        // cero y esconder la diferencia entre las dos cosas.
        Set<String> escritores = CONFIG.escritoresDeLaAutorizacionConMotivo();
        int examinadas =
                CONFIG.envoltoriosDeDecimal().size()
                        + CONFIG.tiposAjenosQueFiscalizacionSoloLee().size()
                        + CONFIG.quienesPuedenMoverElContexto().size()
                        + CONFIG.escriturasSinUsuarioQueObserve().size()
                        + CONFIG.busquedasDeTextoLibreConMotivo().size()
                        + (escritores == null ? 0 : escritores.size());
        assertThat(examinadas)
                .as(
                        "las listas de exencion estan TODAS vacias: esta guarda se quedaria"
                                + " sin sujeto y se cumpliria sola. Dos de ellas tienen valor por"
                                + " omision, asi que llegar a cero significa que algo mas se rompio")
                .isGreaterThan(0);

        // El censo de las dos listas que declaran o reparten. No es un rojo —su motivo esta en
        // `declaracionesSinSujeto`— pero se imprime, porque una entrada que nadie consulta no se
        // ve de ninguna otra manera.
        List<EntradaSinSujeto> censo =
                SujetosDeLaConfiguracion.declaracionesSinSujeto(
                        CONFIG,
                        clases,
                        SujetosDeLaConfiguracion.modulosDelDisco(CONFIG.raizDelCodigo()),
                        AMBITOS_ACOTADOS);
        if (!censo.isEmpty()) {
            System.out.println(
                    "[#27] censo de entradas que hoy no consulta nadie ("
                            + censo.size()
                            + "), sin rojo y con su motivo en SujetosDeLaConfiguracion:");
            censo.forEach(entrada -> System.out.println("  - " + entrada));
        }

        assertThat(SujetosDeLaConfiguracion.exencionesSinSujeto(CONFIG, clases, muestras))
                .as(
                        "una entrada que no nombra nada del arbol no exime a nadie hoy, y el dia que"
                                + " nazca una clase con ese nombre la eximira sin que nadie lo haya"
                                + " decidido. El remedio es borrarla, o traer lo que nombra: no hay"
                                + " lista de excepciones a proposito")
                .isEmpty();
    }

    @Test
    @DisplayName("la guarda de las entradas sin sujeto muerde, y no grita en lo correcto")
    void laGuardaDeLasEntradasSinSujetoMuerde() {
        // Las dos direcciones. Sin la segunda, una guarda que devolviera SIEMPRE todo lo que se le
        // pasa —o sea que no supiera reconocer un sujeto vivo— pasaria esta demostracion igual, y
        // entonces el rojo de arriba no significaria nada.
        JavaClass unaDeProduccion = clases.stream().findFirst().orElseThrow();

        assertThat(
                        SujetosDeLaConfiguracion.exencionesSinSujeto(
                                new ConfiguracionConEntradasMuertas(CONFIG), clases, muestras))
                .as("las seis listas de exencion, con una entrada muerta cada una")
                .extracting(EntradaSinSujeto::lista)
                .containsExactlyInAnyOrder(
                        "envoltoriosDeDecimal",
                        "tiposAjenosQueFiscalizacionSoloLee",
                        "quienesPuedenMoverElContexto",
                        "escriturasSinUsuarioQueObserve",
                        "busquedasDeTextoLibreConMotivo",
                        "escritoresDeLaAutorizacionConMotivo");

        assertThat(
                        SujetosDeLaConfiguracion.declaracionesSinSujeto(
                                new ConfiguracionConEntradasMuertas(CONFIG),
                                clases,
                                Set.of("kamayuk-un-modulo-que-si-existe"),
                                AMBITOS_ACOTADOS))
                .as("y las dos que declaran o reparten, que van al censo y no al rojo")
                .extracting(EntradaSinSujeto::lista)
                .containsExactlyInAnyOrder("modulosDelReparto", "ambitosAusentes");

        assertThat(
                        SujetosDeLaConfiguracion.exencionesSinSujeto(
                                new ConfiguracionConEntradasVivas(CONFIG, unaDeProduccion),
                                clases,
                                muestras))
                .as(
                        "y con las mismas seis listas nombrando cosas que SI estan —cuatro de las"
                                + " muestras y dos veces una clase de produccion de este"
                                + " repositorio— no sobra ni una: una guarda que marcara todo"
                                + " tambien pasaria la mitad de arriba")
                .isEmpty();
    }

    /** La misma configuracion con una entrada muerta en cada una de las siete listas. */
    private record ConfiguracionConEntradasMuertas(ConfiguracionDeLasVerificaciones original)
            implements ConfiguracionDeLasVerificaciones {

        private static final String NO_EXISTE = ".paquete.que.no.existe.ClaseQueNoExiste";

        @Override
        public Set<String> envoltoriosDeDecimal() {
            return Set.of(NO_EXISTE);
        }

        @Override
        public Set<String> tiposAjenosQueFiscalizacionSoloLee() {
            return Set.of(NO_EXISTE);
        }

        @Override
        public Set<String> quienesPuedenMoverElContexto() {
            return Set.of(NO_EXISTE);
        }

        @Override
        public Set<String> escriturasSinUsuarioQueObserve() {
            return Set.of(NO_EXISTE + ".unMetodo(java.lang.String)");
        }

        @Override
        public Set<String> busquedasDeTextoLibreConMotivo() {
            return Set.of("ClaseQueNoExisteEnNingunRepositorio");
        }

        @Override
        public Set<String> escritoresDeLaAutorizacionConMotivo() {
            // Declarada —o sea, la prohibicion de ADR-0039 activa— y con una entrada que no
            // nombra ninguna clase. Con `null` no habria nada que contrastar y esta demostracion
            // no cubriria la sexta lista.
            return Set.of("OtraClaseQueNoExisteEnNingunRepositorio");
        }

        @Override
        public Set<String> modulosDelReparto() {
            return Set.of("kamayuk-un-modulo-que-no-existe");
        }

        @Override
        public Set<String> ambitosAusentes() {
            return Set.of("un-ambito-que-ninguna-regla-acota");
        }

        @Override
        public String paqueteRaiz() {
            return original.paqueteRaiz();
        }

        @Override
        public String sistema() {
            return original.sistema();
        }

        @Override
        public Set<String> tablasProtegidas() {
            return original.tablasProtegidas();
        }

        @Override
        public Set<String> tablasInmutables() {
            return original.tablasInmutables();
        }

        @Override
        public Map<String, String> sistemaDeCadaTabla() {
            return original.sistemaDeCadaTabla();
        }

        @Override
        public List<CruceConsentido> crucesConsentidos() {
            return original.crucesConsentidos();
        }

        @Override
        public Set<String> componenElAreaAManoConMotivo() {
            return original.componenElAreaAManoConMotivo();
        }

        @Override
        public Set<String> paquetesQueTienenQueExistir() {
            return original.paquetesQueTienenQueExistir();
        }

        @Override
        public Path raizDelCodigo() {
            return original.raizDelCodigo();
        }
    }

    /**
     * El contraste: las mismas cinco listas nombrando cosas que SI estan.
     *
     * <p>Cuatro salen de las muestras, que viajan con la libreria y por tanto valen igual en los
     * cinco repositorios; la quinta tiene que ser una clase de PRODUCCION porque el escaner de
     * busqueda por prefijo mira el nombre del archivo y la muestra no entra ahi a proposito.
     */
    private record ConfiguracionConEntradasVivas(
            ConfiguracionDeLasVerificaciones original, JavaClass deProduccion)
            implements ConfiguracionDeLasVerificaciones {

        @Override
        public Set<String> envoltoriosDeDecimal() {
            return Set.of(".dominio.Dinero");
        }

        @Override
        public Set<String> tiposAjenosQueFiscalizacionSoloLee() {
            return Set.of(".catastro.PredioDelContribuyente");
        }

        @Override
        public Set<String> quienesPuedenMoverElContexto() {
            return Set.of(".compartido.TenantContext");
        }

        @Override
        public Set<String> escriturasSinUsuarioQueObserve() {
            return Set.of(
                    ".aplicacion.MuestraDeCasoDeUsoSinObservacion.darDeAlta(java.lang.String)");
        }

        @Override
        public Set<String> busquedasDeTextoLibreConMotivo() {
            return Set.of(deProduccion.getSimpleName());
        }

        @Override
        public Set<String> escritoresDeLaAutorizacionConMotivo() {
            // Como la de arriba, y por lo mismo: el escaner de ADR-0039 compara contra el nombre
            // del archivo, asi que la entrada viva tiene que ser una clase de PRODUCCION.
            return Set.of(deProduccion.getSimpleName());
        }

        @Override
        public String paqueteRaiz() {
            return original.paqueteRaiz();
        }

        @Override
        public String sistema() {
            return original.sistema();
        }

        @Override
        public Set<String> tablasProtegidas() {
            return original.tablasProtegidas();
        }

        @Override
        public Set<String> tablasInmutables() {
            return original.tablasInmutables();
        }

        @Override
        public Map<String, String> sistemaDeCadaTabla() {
            return original.sistemaDeCadaTabla();
        }

        @Override
        public List<CruceConsentido> crucesConsentidos() {
            return original.crucesConsentidos();
        }

        @Override
        public Set<String> componenElAreaAManoConMotivo() {
            return original.componenElAreaAManoConMotivo();
        }

        @Override
        public Set<String> paquetesQueTienenQueExistir() {
            return original.paquetesQueTienenQueExistir();
        }

        @Override
        public Path raizDelCodigo() {
            return original.raizDelCodigo();
        }
    }
}
