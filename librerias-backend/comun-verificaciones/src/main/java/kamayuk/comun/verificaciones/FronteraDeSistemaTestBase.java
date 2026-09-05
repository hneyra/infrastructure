package kamayuk.comun.verificaciones;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;
import kamayuk.comun.verificaciones.ConfiguracionDeLasVerificaciones.CruceConsentido;
import kamayuk.comun.verificaciones.RevisorDeCodigoFuente.Hallazgo;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * NINGUN_SQL_CRUZA_LA_FRONTERA_DE_SISTEMA, aplicada a este repositorio.
 *
 * <p>Mientras las tablas de los cuatro sistemas siguen en la misma base, un {@code JOIN} entre dos
 * de ellos funciona y no lo delata nada. Esta prueba lo delata antes del corte, que es la unica
 * ventana en la que arreglarlo cuesta barato.
 *
 * <p><b>Los cruces que encuentre hoy no se arreglan aqui</b>: se registran en {@code
 * crucesConsentidos()} con el issue que los cierra, y esa lista es la lista de trabajo pendiente.
 * Que tenga que llegar a cero es el criterio de que la separacion termino.
 */
@DisplayName("NINGUN_SQL_CRUZA_LA_FRONTERA_DE_SISTEMA")
public abstract class FronteraDeSistemaTestBase {

    private static final ConfiguracionDeLasVerificaciones CONFIG =
            ConfiguracionDeLasVerificaciones.actual();

    /**
     * Un reparto de mentira, para las pruebas que demuestran el escaner.
     *
     * <p>No se usa el del repositorio a proposito: {@code recibo} es de {@code caja} y {@code
     * predio} es de {@code catastro}, asi que una prueba escrita contra el reparto real diria una
     * cosa en un sistema y otra en el vecino, y entonces no demostraria el mecanismo sino el
     * contenido.
     */
    private static final ConfiguracionDeLasVerificaciones REPARTO_DE_MUESTRA =
            new ConfiguracionDeLasVerificaciones() {
                @Override
                public String paqueteRaiz() {
                    return ConfiguracionDeLasVerificaciones.PAQUETE_DE_MUESTRAS;
                }

                @Override
                public String sistema() {
                    return "rentas";
                }

                @Override
                public Set<String> tablasProtegidas() {
                    return Set.of();
                }

                @Override
                public Set<String> tablasInmutables() {
                    return Set.of();
                }

                @Override
                public Map<String, String> sistemaDeCadaTabla() {
                    return Map.of(
                            "predio", "catastro",
                            "sector", "catastro",
                            "ficha_catastral", "catastro",
                            "titularidad", "catastro",
                            "contribuyente", "rentas",
                            "auditoria", SISTEMA_REPLICADO);
                }

                @Override
                public List<CruceConsentido> crucesConsentidos() {
                    return List.of(
                            new CruceConsentido(
                                    "MuestraDeCruceConsentido", "predio", "#DE-MUESTRA"));
                }

                @Override
                public Set<String> componenElAreaAManoConMotivo() {
                    return Set.of();
                }

                @Override
                public Set<String> paquetesQueTienenQueExistir() {
                    return Set.of();
                }
            };

    @Test
    @DisplayName("ningun modulo consulta por SQL una tabla de otro sistema sin declararlo")
    void ningunModuloCruzaLaFronteraSinDeclararlo() throws IOException {
        Path raiz = CONFIG.raizDelCodigo();
        List<Path> archivos = fuentesDeProduccion(raiz);

        // Si el recorrido no encuentra archivos, la prueba pasa sin revisar nada.
        int minimo = CONFIG.minimoDeFuentesDeProduccion();
        assertThat(archivos)
                .as(
                        "el recorrido desde %s debe encontrar al menos %d fuentes de produccion",
                        raiz, minimo)
                .hasSizeGreaterThanOrEqualTo(minimo);

        FronteraDeSistema frontera = FronteraDeSistema.delRepositorio();
        List<Hallazgo> hallazgos = new ArrayList<>();
        for (Path archivo : archivos) {
            String contenido = Files.readString(archivo, StandardCharsets.UTF_8);
            String nombre = raiz.relativize(archivo).toString();
            hallazgos.addAll(
                    archivo.toString().endsWith(".sql")
                            ? frontera.revisarSql(nombre, contenido)
                            : frontera.revisarJava(nombre, contenido));
        }

        assertThat(hallazgos)
                .as(
                        "cada uno de estos deja de funcionar el dia que la base se parta, y no falla"
                                + " al compilar: o se pide por un puerto, o se registra en"
                                + " crucesConsentidos() con el issue que lo cierra")
                .isEmpty();
    }

    @Test
    @DisplayName("ningun modulo del disco se queda fuera del reparto")
    void ningunModuloDelDiscoSeQuedaFueraDelReparto() throws IOException {
        // El reparto por modulo se consulta con getOrDefault(modulo, SISTEMA_REPLICADO), y
        // «replicado» quiere decir «no esta a ningun lado de la frontera»: una clave que deja de
        // coincidir NO falla, deja de revisar. Medido en R-N sobre el modulo mas grande de
        // `rentas`: con la clave vieja puesta, la prueba de arriba seguia en VERDE con el contexto
        // acotado entero fuera de la revision. Ver modulosDelReparto().
        Set<String> declarados = CONFIG.modulosDelReparto();
        if (declarados.isEmpty()) {
            // Este repositorio no reparte por modulo: sistemaDelArchivo() devuelve el sistema
            // entero y no hay ninguna clave que se pueda quedar vieja.
            return;
        }

        Path raiz = CONFIG.raizDelCodigo();
        List<String> sinDeclarar =
                fuentesDeProduccion(raiz).stream()
                        .map(archivo -> raiz.relativize(archivo).toString().replace('\\', '/'))
                        .map(ruta -> ruta.substring(0, Math.max(ruta.indexOf('/'), 0)))
                        .filter(modulo -> !modulo.isEmpty())
                        .distinct()
                        .filter(modulo -> !declarados.contains(modulo))
                        .sorted()
                        .toList();

        assertThat(sinDeclarar)
                .as(
                        "cada modulo con fuentes de produccion tiene que estar en el reparto: el que"
                                + " no este cae en SISTEMA_REPLICADO y su SQL deja de revisarse, sin"
                                + " que nada se ponga rojo")
                .isEmpty();
    }

    @Test
    @DisplayName("el escaner detecta la muestra que cruza, tabla por tabla")
    void elEscanerDetectaLaMuestraQueCruza() {
        FuenteDeMuestra muestra =
                FuenteDeMuestra.de("infraestructura/MuestraDeConsultaQueCruzaLaFrontera.java");
        assertThat(muestra.texto())
                .as("la muestra tiene que existir para poder detectarla")
                .isNotBlank();

        List<Hallazgo> hallazgos =
                new FronteraDeSistema(REPARTO_DE_MUESTRA)
                        .revisarJava(muestra.nombre(), muestra.texto());

        assertThat(hallazgos.stream().map(Hallazgo::fragmento).map(String::toLowerCase).toList())
                .as(
                        "las cuatro tablas de catastro que nombra, y ninguna del javadoc que las explica")
                .anySatisfy(f -> assertThat(f).contains("from predio"))
                .anySatisfy(f -> assertThat(f).contains("join sector"))
                .anySatisfy(f -> assertThat(f).contains("join ficha_catastral"))
                .anySatisfy(f -> assertThat(f).contains("from titularidad"))
                .hasSize(4);
    }

    @Test
    @DisplayName("lo propio, lo replicado y lo que nadie repartio no son un cruce")
    void elEscanerDejaPasarLoQueNoCruza() {
        // El contraste que hace usable la regla: un escaner que marcara todo pasaria la prueba de
        // arriba y gritaria en cada archivo del repositorio, y uno que grita siempre deja de
        // leerse (#437).
        FuenteDeMuestra muestra =
                FuenteDeMuestra.de("infraestructura/MuestraDeConsultaQueSeQuedaEnCasa.java");

        assertThat(
                        new FronteraDeSistema(REPARTO_DE_MUESTRA)
                                .revisarJava(muestra.nombre(), muestra.texto()))
                .isEmpty();
    }

    @Test
    @DisplayName("un cruce consentido exime, y solo a la clase que lo declara")
    void elCruceConsentidoEximeSoloASuClase() {
        FuenteDeMuestra consentida =
                FuenteDeMuestra.de("infraestructura/MuestraDeCruceConsentido.java");
        FronteraDeSistema frontera = new FronteraDeSistema(REPARTO_DE_MUESTRA);

        assertThat(frontera.revisarJava(consentida.nombre(), consentida.texto()))
                .as("esta en la lista, con su issue")
                .isEmpty();
        assertThat(frontera.revisarJava("OtraClaseCualquiera.java", consentida.texto()))
                .as("la misma linea, byte a byte, en un archivo que no esta en la lista")
                .hasSize(1);
    }

    @Test
    @DisplayName("una excepcion sin issue no se acepta")
    void unaExcepcionSinIssueNoSeAcepta() {
        // La lista de excepciones ES la lista de trabajo pendiente. Una entrada sin dueño no es una
        // excepcion: es un olvido con permiso, y en P5E no habria a quien preguntarle.
        assertThatThrownBy(() -> new CruceConsentido("UnaClase", "predio", "  "))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("no dice quien lo cierra");
        assertThat(CONFIG.crucesConsentidos())
                .allSatisfy(cruce -> assertThat(cruce.issue()).isNotBlank());
    }

    @Test
    @DisplayName("ningun cruce consentido sobra: el que ya no cruza se quita de la lista")
    void ningunCruceConsentidoSobra() throws IOException {
        // La otra mitad, y la que se olvida: una excepcion que ya no aplica se queda dentro para
        // siempre y la lista deja de decir cuanto falta. Aqui se comprueba que cada entrada sigue
        // eximiendo algo de verdad.
        Path raiz = CONFIG.raizDelCodigo();
        ConfiguracionDeLasVerificaciones sinExcepciones = new SinCrucesConsentidos(CONFIG);
        FronteraDeSistema conTodo = new FronteraDeSistema(sinExcepciones);

        List<String> detectados = new ArrayList<>();
        for (Path archivo : fuentesDeProduccion(raiz)) {
            String contenido = Files.readString(archivo, StandardCharsets.UTF_8);
            String nombre = raiz.relativize(archivo).toString();
            for (Hallazgo hallazgo :
                    archivo.toString().endsWith(".sql")
                            ? conTodo.revisarSql(nombre, contenido)
                            : conTodo.revisarJava(nombre, contenido)) {
                detectados.add(claseDe(hallazgo.archivo()));
            }
        }

        assertThat(CONFIG.crucesConsentidos())
                .allSatisfy(
                        cruce ->
                                assertThat(detectados)
                                        .as(
                                                "«%s» esta en la lista de cruces consentidos (%s) y ya"
                                                        + " no cruza nada: quitalo, o la lista deja de"
                                                        + " decir cuanto falta",
                                                cruce.clase(), cruce.issue())
                                        .contains(cruce.clase()));
    }

    private static String claseDe(String archivo) {
        String nombre = archivo.replace('\\', '/');
        int barra = nombre.lastIndexOf('/');
        if (barra >= 0) {
            nombre = nombre.substring(barra + 1);
        }
        int punto = nombre.lastIndexOf('.');
        return punto >= 0 ? nombre.substring(0, punto) : nombre;
    }

    private static List<Path> fuentesDeProduccion(Path raiz) throws IOException {
        try (Stream<Path> rutas = Files.walk(raiz)) {
            return rutas.filter(Files::isRegularFile)
                    .filter(FronteraDeSistemaTestBase::esFuenteDeProduccion)
                    .toList();
        }
    }

    private static boolean esFuenteDeProduccion(Path ruta) {
        String texto = ruta.toString().replace('\\', '/');
        if (!texto.contains("/src/main/") || texto.contains("/build/")) {
            return false;
        }
        return texto.endsWith(".java") || texto.endsWith(".sql");
    }

    /**
     * La misma configuracion, sin sus excepciones: para medir que cada una sigue eximiendo algo.
     */
    private record SinCrucesConsentidos(ConfiguracionDeLasVerificaciones original)
            implements ConfiguracionDeLasVerificaciones {

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
            return List.of();
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
