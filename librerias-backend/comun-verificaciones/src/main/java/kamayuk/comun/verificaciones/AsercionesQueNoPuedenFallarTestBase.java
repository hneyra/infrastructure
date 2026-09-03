package kamayuk.comun.verificaciones;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import kamayuk.comun.verificaciones.RevisorDeAserciones.Censo;
import kamayuk.comun.verificaciones.RevisorDeCodigoFuente.Hallazgo;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * #724: ninguna asercion de AssertJ compara un {@code Optional} con algo que no lo es.
 *
 * <p>Lo encontro CI, no el compilador. {@code isEqualTo(Object)} acepta cualquier cosa, asi que
 * cambiar un accesor de {@code String} a {@code Optional} deja las comparaciones compilando y
 * significando otra cosa. En una direccion la asercion no puede pasar nunca —sale rojo, tarde—; en
 * la otra pasa siempre y <b>no da ningun rojo</b>: la prueba se queda en verde diciendo que
 * comprueba algo que ya no comprueba.
 *
 * <p><b>Este es el unico escaner del repositorio que recorre {@code src/test}</b>, y tiene que
 * serlo: las aserciones viven ahi. {@link ProhibicionesEnElCodigoFuenteTestBase} recorre {@code
 * src/main} a proposito —una prueba que demuestre el peligro de {@code SET SESSION} tiene que poder
 * escribirlo—, y por lo mismo este salta el directorio de muestras: la muestra de #724 incumple a
 * proposito.
 *
 * <p>Como el recorrido lee del disco fuentes que no estan en el classpath de este modulo, el modulo
 * que deriva esta clase declara {@code src/test/java} de todos los modulos como entrada de {@code
 * test}. Sin eso, editar una prueba de otro modulo dejaria esta en UP-TO-DATE y una asercion rota
 * pasaria en <b>verde rancio</b> en local, que es la leccion de #192 punto 2.
 */
@DisplayName("#724 — Aserciones que no pueden fallar")
public abstract class AsercionesQueNoPuedenFallarTestBase {

    @Test
    @DisplayName("ninguna prueba del backend compara un Optional con algo que no lo es")
    void ningunaAsercionComparaUnOptionalConAlgoQueNoLoEs() throws IOException {
        Path raiz = raizDelBackend();
        List<Path> fuentes = fuentesJava(raiz);
        List<Path> pruebas =
                fuentes.stream().filter(AsercionesQueNoPuedenFallarTestBase::esPrueba).toList();

        // Si el recorrido no encuentra archivos, la prueba pasa sin revisar nada.
        int minimo = ConfiguracionDeLasVerificaciones.actual().minimoDePruebas();
        assertThat(pruebas)
                .as(
                        "el recorrido desde %s debe encontrar al menos %d pruebas de los modulos",
                        raiz, minimo)
                .hasSizeGreaterThanOrEqualTo(minimo);

        Censo censo = censarDelDisco(fuentes);
        List<Hallazgo> hallazgos = new ArrayList<>();
        for (Path prueba : pruebas) {
            hallazgos.addAll(
                    RevisorDeAserciones.revisar(
                            raiz.relativize(prueba).toString(),
                            Files.readString(prueba, StandardCharsets.UTF_8),
                            censo));
        }

        assertThat(hallazgos).isEmpty();
    }

    @Test
    @DisplayName("el escaner detecta la muestra, en las dos direcciones")
    void elEscanerDetectaLaMuestra() throws IOException {
        FuenteDeMuestra muestra = laMuestra();
        assertThat(muestra.texto())
                .as("la muestra tiene que existir para poder detectarla")
                .isNotBlank();

        // El censo lleva la muestra dentro a proposito: es ella quien declara que
        // `llaveDeLaMuestra()` devuelve un Optional, y sin esa declaracion el escaner no tendria
        // como saber que la comparacion no puede fallar. Antes venia del disco porque la muestra
        // vivia en el mismo arbol; ahora viaja en el jar y se le suma al censo del repositorio.
        List<String> contenidos = new ArrayList<>(textosDe(fuentesJava(raizDelBackend())));
        contenidos.add(muestra.texto());

        List<Hallazgo> hallazgos =
                RevisorDeAserciones.revisar(
                        muestra.nombre(), muestra.texto(), RevisorDeAserciones.censar(contenidos));

        assertThat(hallazgos)
                .as(
                        "las tres del metodo `asiSeIncumple`, y ninguna de las siete de"
                                + " `asiSeCumple` ni de los comentarios que las explican")
                .hasSize(3);
        assertThat(hallazgos.stream().map(Hallazgo::fragmento).toList())
                .anySatisfy(
                        f ->
                                assertThat(f)
                                        .as("la de #691: el cast dice que ese llave() es Optional")
                                        .contains("SinPublicarDeMuestra")
                                        .contains(".isEqualTo(\"TUPA:DERECHO_TRAMITE\")"))
                .anySatisfy(
                        f ->
                                assertThat(f)
                                        .as("la peligrosa: pasa siempre y no da ningun rojo")
                                        .contains(".isNotEqualTo(\"OTRA_COSA\")"))
                .anySatisfy(
                        f ->
                                assertThat(f)
                                        .as("la misma con el Optional en el argumento")
                                        .contains("assertThat(\"TUPA:DERECHO_TRAMITE\")"));
        assertThat(hallazgos.stream().map(Hallazgo::toString).toList())
                .as("el hallazgo nombra el archivo, para arreglarlo sin buscarlo")
                .allSatisfy(h -> assertThat(h).startsWith("MuestraDeAsercionContraOptional.java"));
    }

    @Test
    @DisplayName(
            "EL CONTRASTE: contains, hasValue, isEmpty e isEqualTo(Optional.of(...)) no se marcan")
    void lasFormasCorrectasNoSeMarcan() {
        // Es la mitad de la regla. Una que marcara estas no tendria como cumplirse: son
        // exactamente lo que hay que escribir cuando el sujeto es un Optional.
        String fuente =
                """
                class Bueno {
                    java.util.Optional<String> laLlave() { return null; }

                    void bien() {
                        assertThat(laLlave()).contains("TUPA:X");
                        assertThat(laLlave()).hasValue("TUPA:X");
                        assertThat(laLlave()).isEmpty();
                        assertThat(laLlave()).isPresent();
                        assertThat(laLlave()).isNotEmpty();
                        assertThat(laLlave()).isEqualTo(java.util.Optional.of("TUPA:X"));
                        assertThat(laLlave()).get().isEqualTo("TUPA:X");
                        assertThat(laLlave().orElseThrow()).isEqualTo("TUPA:X");
                    }
                }
                """;

        assertThat(
                        RevisorDeAserciones.revisar(
                                "Bueno.java", fuente, RevisorDeAserciones.censar(List.of(fuente))))
                .isEmpty();
    }

    @Test
    @DisplayName("y si esa misma clase compara con un literal, las dos direcciones muerden")
    void laMismaClaseConUnLiteralSiSeMarca() {
        String fuente =
                """
                class Malo {
                    java.util.Optional<String> laLlave() { return null; }

                    void mal() {
                        assertThat(laLlave()).isEqualTo("TUPA:X");
                        assertThat(laLlave()).isNotEqualTo("OTRA");
                        assertThat("TUPA:X").isEqualTo(laLlave());
                        assertThat(laLlave()).isSameAs(null);
                    }
                }
                """;

        assertThat(
                        RevisorDeAserciones.revisar(
                                "Malo.java", fuente, RevisorDeAserciones.censar(List.of(fuente))))
                .as("la misma clase, el mismo accesor: lo que cambia es con que se compara")
                .hasSize(4);
    }

    @Test
    @DisplayName("con el nombre ambiguo manda el cast, y sin cast la regla calla")
    void elCastDecideCuandoElNombreEsAmbiguo() {
        // El caso real, reducido: `llave()` devuelve Optional en unas clases y String en otras.
        // Por el nombre no se pueden distinguir; por el cast, si. Y sin cast la regla CALLA, que
        // es el limite que #724 pide que se diga por escrito.
        String fuente =
                """
                class Ambiguo {
                    interface Falta { java.util.Optional<String> llave(); }

                    static class Texto { String llave() { return "TUPA:X"; } }

                    void comparar(Object fallo, Falta falta) {
                        assertThat(((Falta) fallo).llave()).isEqualTo("TUPA:X");
                        assertThat(((Texto) fallo).llave()).isEqualTo("TUPA:X");
                        assertThat(falta.llave()).isEqualTo("TUPA:X");
                    }
                }
                """;

        Censo censo = RevisorDeAserciones.censar(List.of(fuente));
        assertThat(censo.nombresInequivocos())
                .as("`llave` no es inequivoco: dos clases lo declaran con tipos distintos")
                .doesNotContain("llave");
        assertThat(RevisorDeAserciones.revisar("Ambiguo.java", fuente, censo))
                .as(
                        "solo la del cast a Falta. La de Texto esta bien, y la de la variable no se"
                                + " puede resolver: el tipo no esta en el texto")
                .hasSize(1)
                .allSatisfy(h -> assertThat(h.fragmento()).contains("(Falta) fallo"));
    }

    @Test
    @DisplayName("no se marca lo que no se puede afirmar: contra una variable, la regla calla")
    void contraUnaVariableLaReglaCalla() {
        // El falso negativo que se paga por no dar falsos positivos: `esperado` podria ser otro
        // Optional, y una regla que marcara esto no tendria como satisfacerse.
        String fuente =
                """
                class Dudoso {
                    java.util.Optional<String> laLlave() { return null; }

                    void comparar(Object esperado) {
                        assertThat(laLlave()).isEqualTo(esperado);
                    }
                }
                """;

        assertThat(
                        RevisorDeAserciones.revisar(
                                "Dudoso.java", fuente, RevisorDeAserciones.censar(List.of(fuente))))
                .isEmpty();
    }

    @Test
    @DisplayName("OptionalInt no entra en el censo: compararlo con OptionalInt.of(...) esta bien")
    void optionalIntNoEntraEnElCenso() {
        String fuente =
                """
                class Avance {
                    java.util.OptionalInt avance() { return java.util.OptionalInt.empty(); }

                    void bien() {
                        assertThat(avance()).isEqualTo(java.util.OptionalInt.of(80));
                    }
                }
                """;

        Censo censo = RevisorDeAserciones.censar(List.of(fuente));
        assertThat(censo.nombresInequivocos()).doesNotContain("avance");
        assertThat(RevisorDeAserciones.revisar("Avance.java", fuente, censo)).isEmpty();
    }

    @Test
    @DisplayName("un parentesis dentro de un literal no descuadra el balanceo")
    void unParentesisEnUnLiteralNoDescuadraElBalanceo() {
        // Un `(` sin pareja dentro de una cadena se comeria el resto del archivo al balancear,
        // y la asercion se perderia en silencio. Por eso `limpiar` borra el INTERIOR de los
        // literales y conserva las comillas.
        String fuente =
                """
                class ConTexto {
                    java.util.Optional<String> laLlave() {
                        return null;
                    }

                    void comparar() {
                        // assertThat(laLlave()).isEqualTo("en un comentario no cuenta");
                        assertThat("no cierra: (").isEqualTo(laLlave());
                    }
                }
                """;

        assertThat(
                        RevisorDeAserciones.revisar(
                                "ConTexto.java",
                                fuente,
                                RevisorDeAserciones.censar(List.of(fuente))))
                .as("el literal del comentario no cuenta, y el parentesis de dentro tampoco")
                .hasSize(1);
    }

    @Test
    @DisplayName("una llave dentro de un literal no descuadra la pila de tipos")
    void unaLlaveEnUnLiteralNoDescuadraLaPilaDeTipos() {
        // El censo por clase se lleva con una pila de llaves, y un `}` dentro de una cadena
        // —o de un bloque de texto con JSON, que en estas pruebas abundan— cerraria la clase
        // antes de tiempo: `llave()` quedaria atribuido a la de fuera y el cast dejaria de
        // resolver, sin que nada lo dijera.
        String fuente =
                """
                class Pila {
                    static class Falta {
                        String sql() {
                            return "select 1 where x = '}'";
                        }

                        java.util.Optional<String> llave() {
                            return null;
                        }
                    }

                    static class Texto {
                        String llave() {
                            return "TUPA:X";
                        }
                    }

                    void comparar(Object fallo) {
                        assertThat(((Falta) fallo).llave()).isEqualTo("TUPA:X");
                    }
                }
                """;

        Censo censo = RevisorDeAserciones.censar(List.of(fuente));
        assertThat(censo.clasesConOptional("llave"))
                .as("`llave()` es de Falta, no de Pila: el `}` de la cadena no cierra la clase")
                .containsExactly("Falta");
        assertThat(RevisorDeAserciones.revisar("Pila.java", fuente, censo)).hasSize(1);
    }

    protected static Censo censarDelDisco(List<Path> fuentes) throws IOException {
        return RevisorDeAserciones.censar(textosDe(fuentes));
    }

    private static List<String> textosDe(List<Path> fuentes) throws IOException {
        List<String> contenidos = new ArrayList<>();
        for (Path fuente : fuentes) {
            contenidos.add(Files.readString(fuente, StandardCharsets.UTF_8));
        }
        return contenidos;
    }

    protected static List<Path> fuentesJava(Path raiz) throws IOException {
        try (Stream<Path> rutas = Files.walk(raiz)) {
            return rutas.filter(Files::isRegularFile)
                    .filter(AsercionesQueNoPuedenFallarTestBase::esFuenteJava)
                    .toList();
        }
    }

    private static boolean esFuenteJava(Path ruta) {
        String texto = ruta.toString().replace('\\', '/');
        return texto.endsWith(".java") && !texto.contains("/build/");
    }

    /**
     * Las pruebas de todos los modulos, <b>menos el directorio de muestras</b>: la muestra de #724
     * incumple a proposito, y sin esta exclusion romperia el build en cuanto se escribe.
     */
    private static boolean esPrueba(Path ruta) {
        String texto = ruta.toString().replace('\\', '/');
        return texto.contains("/src/test/") && !texto.contains("/verificaciones/muestras/");
    }

    /** La muestra viaja en el jar de esta libreria, no en el disco del repositorio. */
    private static FuenteDeMuestra laMuestra() {
        return FuenteDeMuestra.de("pruebas/MuestraDeAsercionContraOptional.java");
    }

    /** La raiz del arbol de modulos de ESTE repositorio, declarada por su configuracion. */
    protected static Path raizDelBackend() {
        return ConfiguracionDeLasVerificaciones.actual().raizDelCodigo();
    }
}
