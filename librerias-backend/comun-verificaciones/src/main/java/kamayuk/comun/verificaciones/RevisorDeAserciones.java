package kamayuk.comun.verificaciones;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import kamayuk.comun.verificaciones.RevisorDeCodigoFuente.Hallazgo;

/**
 * #724: una comparacion de AssertJ entre un {@link Optional} y algo que no lo es.
 *
 * <h2>Que se rompe, y por que el compilador se calla</h2>
 *
 * <p>Salio de #691. Al cambiar {@code llave()} de {@code String} a {@code Optional<String>}, el
 * compilador cazo todos los usos que <b>devuelven</b> el valor y se callo en los que solo lo
 * <b>comparan</b>:
 *
 * <pre>{@code
 * assertThat(excepcion.llave()).isEqualTo("TUPA:DERECHO_TRAMITE");
 * }</pre>
 *
 * <p>Eso sigue compilando —{@code isEqualTo(Object)} acepta cualquier cosa— y pasa a comparar un
 * {@code Optional[TUPA:DERECHO_TRAMITE]} contra un {@code String}. Ahi salio bien: la asercion dejo
 * de poder pasar nunca, se puso roja en CI y se arreglo. <b>El modo de fallo peligroso es el
 * simetrico, y no da ningun rojo:</b>
 *
 * <pre>{@code
 * assertThat(alguno.llave()).isNotEqualTo("OTRA_COSA");   // cierto SIEMPRE
 * }</pre>
 *
 * <p>Una asercion que no puede fallar no protege nada, y aqui ni el compilador ni la corrida la
 * delatan. Es el mismo criterio con el que este repositorio exige que cada regla tenga su muestra
 * que la viola.
 *
 * <h2>Como se reconoce un Optional sin tipos (la decision de #724)</h2>
 *
 * <p>El escaner lee texto: no hay tipos. Se reconoce por <b>dos anclas</b>, y las dos se midieron
 * contra el repositorio entero antes de escribirlas, porque una regla que intente inferir tipos con
 * expresiones regulares acaba dando falsos positivos y un escaner que grita en verde deja de leerse
 * (#437).
 *
 * <ol>
 *   <li><b>El nombre inequivoco.</b> Un accesor <b>sin argumentos</b> {@code x.metodo()} es de
 *       {@code Optional} cuando <b>todas</b> las declaraciones de ese nombre sin argumentos en el
 *       backend —metodos y componentes de {@code record}— devuelven {@code Optional<...>}. Medido
 *       hoy: 13 nombres, y cero hallazgos sobre las ~3 600 aserciones del arbol. Censar por nombre
 *       <b>sin</b> exigir que sea inequivoco da 40 hallazgos en 33 archivos, y los 40 son falsos:
 *       {@code numero()}, {@code nombre()} y {@code texto()} son de {@code Optional} en una clase y
 *       de otra cosa en casi todas las demas.
 *   <li><b>El cast.</b> Cuando el receptor lleva un cast —{@code ((Clase) x).metodo()}—, manda la
 *       clase, porque el censo se guarda tambien por clase. Es lo que hace util a la regla: {@code
 *       llave} es <b>ambiguo por nombre</b> en este repositorio, y sin esta segunda ancla el caso
 *       que dio origen a #724 no se veria.
 * </ol>
 *
 * <p><b>Y la ambiguedad de {@code llave} no es teorica, se midio.</b> Veintidos clases lo declaran
 * {@code Optional<String>} —las de {@code ParametroSinPublicar}— y <b>tres no</b>: {@code
 * FilaDelManifiesto} y {@code FilaPublicable} lo declaran {@code LlaveDeParametro}, y {@code
 * ParametroQueFalta} —la proyeccion HTTP del propio discriminador de #691— lo lleva como componente
 * {@code String} <b>anulable</b>, y a proposito: el miembro <b>desaparece</b> del cuerpo cuando no
 * hay llave, porque un {@code null} en un {@code problem+json} es un valor y el cliente que
 * pregunte por el lo vera presente. Las dos formas se escriben con un cast:
 *
 * <pre>{@code
 * // Correcto: DerechoSinParametrizar.llave() es Optional.
 * assertThat(((...DerechoSinParametrizar) fallo).llave()).contains("TUPA:...");
 * // Correcto tambien: ParametroQueFalta.llave() es un String anulable.
 * assertThat(((ParametroQueFalta) miembro).llave()).isEqualTo("REDONDEO:CUOTA");
 * }</pre>
 *
 * <p>Meter {@code llave} en el censo por nombre marcaria la segunda, que esta bien. El censo por
 * clase distingue las dos, y por eso vale las treinta lineas que cuesta.
 *
 * <p><b>Las cifras de arriba se miden, no se razonan, y ya se movieron una vez.</b> Cuando esta
 * regla se escribio eran diecinueve y cuatro, y el cuarto era {@code
 * TablaDeValoresUnitarios.ValorUnitarioSinParametrizar}, que declaraba {@code llave()} como {@code
 * String}; #723 lo hizo declarar {@code ParametroSinPublicar} y con eso paso al otro lado. La
 * conclusion no cambio —{@code llave} sigue siendo ambiguo, y sin el ancla del cast la regla
 * seguiria sin ver el caso que la origino—, pero el ejemplo si, y lo destapo la prueba que lo
 * afirma contra el arbol real en vez de contra un comentario.
 *
 * <h2>Solo se marca lo que <b>no puede</b> ser un Optional</h2>
 *
 * <p>El otro lado de la comparacion se clasifica en tres, no en dos: <b>es</b> un {@code Optional},
 * <b>no puede serlo</b>, o <b>no se sabe</b>. Solo se marca cuando no puede serlo: un literal, una
 * concatenacion con un literal, un {@code new} —ningun {@code new} produce un {@code Optional}— o
 * un accesor cuyo nombre nunca es de {@code Optional} en el repositorio. Con «no se sabe» la regla
 * <b>calla</b>.
 *
 * <p>Eso es deliberado y es lo que la hace cumplible: {@code assertThat(x.llave()).isEqualTo(y)}
 * con {@code y} otro {@code Optional} en una variable es correcto, y una regla que lo marcara no
 * tendria como satisfacerse. El precio es un falso negativo, y esta escrito abajo.
 *
 * <h2>Lo que la regla NO puede ver</h2>
 *
 * <p>Se dice entero, en vez de dar a entender que cubre todos los casos:
 *
 * <ul>
 *   <li><b>El nombre ambiguo sin cast.</b> {@code falta.llave()} sobre una variable o un parametro
 *       de lambda no se puede resolver: el tipo no esta en el texto. Es la mitad de la superficie
 *       de {@code llave}.
 *   <li><b>La comparacion contra una variable.</b> {@code isEqualTo(esperado)} no se marca, porque
 *       {@code esperado} podria ser un {@code Optional}. Lo que si se marca es contra un literal,
 *       que es como se escribio el defecto de #691.
 *   <li><b>{@code assertThat(lista).doesNotContain(x.llave())}.</b> El sujeto es lo que no se puede
 *       ver, y ahi esta el filo: <b>medido</b>, marcar esa forma sin poder ver el sujeto da 46
 *       hallazgos en el arbol de hoy y <b>los 46 son falsos</b> —listas de numeros de valor, {@code
 *       OptionalInt} usado bien—. Por eso la segunda direccion solo se marca cuando el sujeto es un
 *       literal, que es el unico caso en que se puede afirmar que no es un {@code Optional}.
 *   <li><b>{@code Optional} en un campo, en una variable local o devuelto por un metodo con
 *       argumentos.</b> El censo es de accesores sin argumentos, que es la forma en que aparece.
 *   <li><b>{@code OptionalInt}, {@code OptionalLong} y {@code OptionalDouble}</b> quedan fuera del
 *       censo a proposito: {@code AvanceDeCobranza.avance()} es un {@code OptionalInt} comparado
 *       con {@code OptionalInt.of(80)}, que esta bien, y meterlos daba 13 falsos positivos.
 * </ul>
 *
 * <p>Es una funcion pura sobre texto, como {@link RevisorDeCodigoFuente}, para poder probarla con
 * muestras en vez de confiar en que recorre bien el arbol.
 */
public final class RevisorDeAserciones {

    /**
     * Las comparaciones de {@code AbstractAssert} que aceptan un {@code Object} cualquiera.
     *
     * <p>Son las que compilan con un tipo que no tiene nada que ver. Las de {@code OptionalAssert}
     * —{@code contains}, {@code hasValue}, {@code isEmpty}, {@code isPresent}— <b>no estan</b>, y
     * ese es el contraste que hace usable la regla: son la forma correcta de escribirlo, y marcarla
     * dejaria la regla sin manera de cumplirse.
     */
    static final Set<String> COMPARACIONES =
            Set.of("isEqualTo", "isNotEqualTo", "isSameAs", "isNotSameAs", "isIn", "isNotIn");

    /**
     * Lo mismo mas las de pertenencia, para la direccion contraria: el {@code Optional} en el
     * argumento.
     *
     * <p>{@code doesNotContain(unOptional)} es el otro caso que el issue nombra y que no da ningun
     * rojo: una lista de cadenas nunca contiene un {@code Optional}, asi que la asercion es cierta
     * siempre.
     */
    static final Set<String> PERTENENCIAS =
            Set.of(
                    "contains",
                    "doesNotContain",
                    "containsExactly",
                    "containsOnly",
                    "containsExactlyInAnyOrder",
                    "containsAnyOf");

    /**
     * Los eslabones que <b>cambian el sujeto</b>: a partir de ahi lo que se afirma ya no es el
     * {@code Optional}.
     *
     * <p>{@code assertThat(x.llave()).get().isEqualTo("TUPA:X")} es correcto —{@code get()} saca el
     * valor de dentro— y sin esta lista se marcaria, porque el sujeto de la cadena seguiria siendo
     * el {@code Optional}. La cadena se corta en el primero de estos.
     */
    static final Set<String> CAMBIAN_EL_SUJETO =
            Set.of(
                    "get",
                    "map",
                    "flatMap",
                    "extracting",
                    "asString",
                    "asList",
                    "asInstanceOf",
                    "usingRecursiveComparison");

    /** Un tipo declarado: {@code Optional<String>}, {@code Map<A, B>}, {@code int[]}. */
    private static final String TIPO =
            "(?:[A-Za-z_$][\\w$.]*)(?:\\s*<[^;={}()]*?>)?(?:\\s*\\[\\s*\\])*";

    /** Una declaracion de accesor sin argumentos: {@code Optional<String> llave()}. */
    private static final Pattern ACCESOR =
            Pattern.compile("(" + TIPO + ")\\s+([a-z_$][\\w$]*)\\s*\\(\\s*\\)");

    /** La apertura de un tipo, para saber a que clase pertenece cada accesor. */
    private static final Pattern APERTURA_DE_TIPO =
            Pattern.compile("\\b(?:class|interface|record|enum)\\s+([A-Za-z_$][\\w$]*)");

    /** La cabecera de un {@code record}, cuyos componentes tambien son accesores. */
    private static final Pattern CABECERA_DE_RECORD =
            Pattern.compile("\\brecord\\s+([A-Za-z_$][\\w$]*)\\s*(?:<[^()]*?>)?\\s*\\(");

    /** Un componente de {@code record}, ya sin anotaciones: {@code Optional<String> llave}. */
    private static final Pattern COMPONENTE =
            Pattern.compile("^(" + TIPO + ")\\s+([a-z_$][\\w$]*)$");

    /** {@code Optional<...>} y nada mas: {@code OptionalInt} y sus hermanos quedan fuera. */
    private static final Pattern TIPO_OPTIONAL =
            Pattern.compile("^(?:java\\.util\\.)?Optional\\s*<");

    /** {@code Optional.of(...)}, {@code Optional.empty()}, {@code Optional.ofNullable(...)}. */
    private static final Pattern FABRICA_DE_OPTIONAL =
            Pattern.compile(
                    "(?:^|[\\s(,])(?:java\\.util\\.)?Optional\\s*\\.\\s*"
                            + "(?:of|empty|ofNullable)\\s*\\(");

    /** {@code assertThat(} en cualquier espaciado. */
    private static final Pattern ASSERT_THAT = Pattern.compile("\\bassertThat\\s*\\(");

    /** El siguiente eslabon de la cadena: {@code .isEqualTo(}. */
    private static final Pattern ESLABON = Pattern.compile("\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*\\(");

    /**
     * Una llamada sin argumentos al final de la expresion: {@code x.llave()}, y tambien {@code
     * llave()} a secas, que es como se llama a un metodo de la propia clase.
     */
    private static final Pattern LLAMADA_FINAL =
            Pattern.compile("([a-z_$][\\w$]*)\\s*\\(\\s*\\)\\s*\\z");

    /** Un literal: cadena, caracter, numero, booleano o {@code null}. */
    private static final Pattern LITERAL =
            Pattern.compile(
                    "\\A(?:\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*'"
                            + "|-?\\d[\\w.]*|true|false|null)\\z");

    /** Una concatenacion en la que interviene una cadena: el resultado es un {@code String}. */
    private static final Pattern CONCATENA_CADENA = Pattern.compile("\"\\s*\\+|\\+\\s*\"");

    /** {@code new Loquesea(...)}: ninguna forma de {@code new} produce un {@code Optional}. */
    private static final Pattern CONSTRUCCION = Pattern.compile("\\Anew\\s");

    /**
     * Un cast delante del receptor: {@code (Clase) x} o {@code ((Clase) x)}.
     *
     * <p>El nombre admite espacios y saltos de linea entre los segmentos, y no es un adorno: el
     * formateador parte {@code (Externa.Anidada)} en dos lineas en cuanto el cast va anidado —que
     * es justo como esta escrito en {@code LicenciaDeEdificacionJdbcTest}—, y sin tolerarlos el
     * ancla del cast no reconoceria ninguno de los casos reales.
     */
    private static final Pattern CAST =
            Pattern.compile(
                    "\\A\\(\\s*([A-Za-z_$][\\w$]*(?:\\s*\\.\\s*[A-Za-z_$][\\w$]*)*)"
                            + "\\s*\\)\\s*[\\w$(]");

    /** Palabras que el patron de accesor podria confundir con un tipo o un nombre. */
    private static final Set<String> PALABRAS_RESERVADAS =
            Set.of(
                    "if",
                    "for",
                    "while",
                    "switch",
                    "catch",
                    "return",
                    "new",
                    "synchronized",
                    "else",
                    "do",
                    "try",
                    "case",
                    "assert",
                    "throw");

    private RevisorDeAserciones() {}

    /**
     * Que se sabe de una expresion: si es un {@code Optional}, si no puede serlo, o si no consta.
     */
    enum Naturaleza {
        OPTIONAL,
        NO_PUEDE_SER_OPTIONAL,
        NO_CONSTA
    }

    /**
     * Los accesores sin argumentos del backend, por nombre y por clase.
     *
     * <p>Se construye una vez sobre todas las fuentes y se consulta al revisar cada archivo: sin el
     * censo completo no hay forma de saber que {@code llave()} devuelve un {@code Optional} en unas
     * clases y un {@code String} en otras.
     */
    public static final class Censo {

        private final Set<String> deOptional;
        private final Set<String> nuncaDeOptional;
        private final Map<String, Set<String>> optionalPorClase;
        private final Map<String, Set<String>> otrosPorClase;

        private Censo(
                Set<String> deOptional,
                Set<String> nuncaDeOptional,
                Map<String, Set<String>> optionalPorClase,
                Map<String, Set<String>> otrosPorClase) {
            this.deOptional = deOptional;
            this.nuncaDeOptional = nuncaDeOptional;
            this.optionalPorClase = optionalPorClase;
            this.otrosPorClase = otrosPorClase;
        }

        /**
         * Los nombres que <b>siempre</b> son de {@code Optional}. Un nombre que en alguna clase
         * devuelve otra cosa no esta, y por eso {@code llave} no esta.
         */
        public Set<String> nombresInequivocos() {
            return Set.copyOf(deOptional);
        }

        /** Las clases que declaran ese accesor devolviendo un {@code Optional}. */
        public Set<String> clasesConOptional(String metodo) {
            Set<String> clases = new HashSet<>();
            optionalPorClase.forEach(
                    (clase, metodos) -> {
                        if (metodos.contains(metodo)) {
                            clases.add(clase);
                        }
                    });
            return clases;
        }

        private Naturaleza porClase(String clase, String metodo) {
            if (optionalPorClase.getOrDefault(clase, Set.of()).contains(metodo)) {
                return Naturaleza.OPTIONAL;
            }
            if (otrosPorClase.getOrDefault(clase, Set.of()).contains(metodo)) {
                return Naturaleza.NO_PUEDE_SER_OPTIONAL;
            }
            return Naturaleza.NO_CONSTA;
        }

        private Naturaleza porNombre(String metodo) {
            if (deOptional.contains(metodo)) {
                return Naturaleza.OPTIONAL;
            }
            if (nuncaDeOptional.contains(metodo)) {
                return Naturaleza.NO_PUEDE_SER_OPTIONAL;
            }
            return Naturaleza.NO_CONSTA;
        }
    }

    /**
     * Recorre las fuentes y anota, por nombre y por clase, que accesores sin argumentos devuelven
     * un {@code Optional}.
     *
     * @param fuentes el contenido de los {@code .java}; el censo tiene que ver {@code src/main} y
     *     {@code src/test}, porque las pruebas declaran sus propios dobles
     */
    public static Censo censar(Collection<String> fuentes) {
        Set<String> optional = new HashSet<>();
        Set<String> otros = new HashSet<>();
        Map<String, Set<String>> optionalPorClase = new HashMap<>();
        Map<String, Set<String>> otrosPorClase = new HashMap<>();

        for (String fuente : fuentes) {
            String codigo = limpiar(fuente);
            censarAccesores(codigo, optional, otros, optionalPorClase, otrosPorClase);
            censarComponentes(codigo, optional, otros, optionalPorClase, otrosPorClase);
        }

        Set<String> inequivocos = new HashSet<>(optional);
        inequivocos.removeAll(otros);
        Set<String> nuncaOptional = new HashSet<>(otros);
        nuncaOptional.removeAll(optional);
        return new Censo(inequivocos, nuncaOptional, optionalPorClase, otrosPorClase);
    }

    /**
     * Marca cada comparacion de AssertJ entre un {@code Optional} y algo que no puede serlo.
     *
     * @param archivo la ruta o el nombre, para que el hallazgo se arregle sin buscarlo
     * @param contenido el {@code .java} entero
     * @param censo el de {@link #censar(Collection)}, sobre el backend completo
     */
    public static List<Hallazgo> revisar(String archivo, String contenido, Censo censo) {
        String codigo = limpiar(contenido);
        List<Hallazgo> hallazgos = new ArrayList<>();

        Matcher inicio = ASSERT_THAT.matcher(codigo);
        while (inicio.find()) {
            int abre = inicio.end() - 1;
            int cierra = cierreDe(codigo, abre);
            String sujeto = codigo.substring(abre + 1, cierra);
            Naturaleza delSujeto = clasificar(sujeto, censo);

            int i = cierra + 1;
            Matcher eslabon = ESLABON.matcher(codigo);
            while (i < codigo.length()) {
                eslabon.region(i, codigo.length());
                if (!eslabon.lookingAt()) {
                    break;
                }
                String metodo = eslabon.group(1);
                if (CAMBIAN_EL_SUJETO.contains(metodo)) {
                    break;
                }
                int abreArgumento = eslabon.end() - 1;
                int cierraArgumento = cierreDe(codigo, abreArgumento);
                String argumento = codigo.substring(abreArgumento + 1, cierraArgumento);
                Naturaleza delArgumento = clasificar(argumento, censo);

                Optional<String> regla = reglaIncumplida(metodo, delSujeto, delArgumento);
                if (regla.isPresent()) {
                    hallazgos.add(
                            new Hallazgo(
                                    archivo,
                                    regla.get(),
                                    resumir(
                                            contenido.substring(
                                                    inicio.start(), cierraArgumento + 1))));
                }
                i = cierraArgumento + 1;
            }
        }
        return hallazgos;
    }

    private static Optional<String> reglaIncumplida(
            String metodo, Naturaleza sujeto, Naturaleza argumento) {
        if (sujeto == Naturaleza.OPTIONAL
                && argumento == Naturaleza.NO_PUEDE_SER_OPTIONAL
                && COMPARACIONES.contains(metodo)) {
            return Optional.of(
                    "#724: se compara un Optional con algo que no lo es, asi que la asercion no"
                            + " depende de lo que se quiso comprobar —isEqualTo no puede pasar"
                            + " nunca, isNotEqualTo pasa siempre—. Va contains(...), hasValue(...)"
                            + " o isEmpty()");
        }
        if (sujeto == Naturaleza.NO_PUEDE_SER_OPTIONAL
                && argumento == Naturaleza.OPTIONAL
                && (COMPARACIONES.contains(metodo) || PERTENENCIAS.contains(metodo))) {
            return Optional.of(
                    "#724: el Optional esta en el argumento y el sujeto no lo es, asi que la"
                            + " asercion es cierta o falsa por el tipo y no por el dato. Va el valor"
                            + " de dentro: orElseThrow() o get()");
        }
        return Optional.empty();
    }

    /**
     * Que se sabe de una expresion.
     *
     * <p>Devuelve {@link Naturaleza#NO_CONSTA} en cuanto no puede afirmarlo, que es lo que impide
     * que la regla marque codigo correcto.
     */
    private static Naturaleza clasificar(String expresion, Censo censo) {
        String e = expresion.strip();
        if (e.isEmpty()) {
            return Naturaleza.NO_CONSTA;
        }
        if (FABRICA_DE_OPTIONAL.matcher(e).find()) {
            return Naturaleza.OPTIONAL;
        }
        if (LITERAL.matcher(e).matches()
                || CONSTRUCCION.matcher(e).find()
                || CONCATENA_CADENA.matcher(e).find()) {
            return Naturaleza.NO_PUEDE_SER_OPTIONAL;
        }

        Matcher llamada = LLAMADA_FINAL.matcher(e);
        if (!llamada.find()) {
            return Naturaleza.NO_CONSTA;
        }
        String metodo = llamada.group(1);
        String antes = e.substring(0, llamada.start()).stripTrailing();
        // Sin punto delante no hay receptor que mirar: es un metodo de la propia clase.
        String receptor = antes.endsWith(".") ? antes.substring(0, antes.length() - 1).strip() : "";

        Naturaleza porElCast = censo.porClase(claseDelCast(receptor), metodo);
        if (porElCast != Naturaleza.NO_CONSTA) {
            return porElCast;
        }
        return censo.porNombre(metodo);
    }

    /**
     * La clase de un cast delante del receptor, o la cadena vacia si no lo hay.
     *
     * <p>Se queda con el ultimo segmento —{@code ParametrosSellados.ParametroAusente} es {@code
     * ParametroAusente}— porque el censo guarda el nombre simple. Una clase que hereda el accesor
     * sin declararlo no esta en el censo, y entonces manda el nombre: falla del lado de callar.
     */
    private static String claseDelCast(String receptor) {
        String interno = receptor;
        if (interno.startsWith("(") && interno.endsWith(")")) {
            interno = interno.substring(1, interno.length() - 1).strip();
        }
        Matcher cast = CAST.matcher(interno);
        if (!cast.find()) {
            return "";
        }
        String nombre = cast.group(1).replaceAll("\\s+", "");
        int punto = nombre.lastIndexOf('.');
        return punto < 0 ? nombre : nombre.substring(punto + 1);
    }

    private static void censarAccesores(
            String codigo,
            Set<String> optional,
            Set<String> otros,
            Map<String, Set<String>> optionalPorClase,
            Map<String, Set<String>> otrosPorClase) {
        List<Integer> posiciones = new ArrayList<>();
        List<String> tipos = new ArrayList<>();
        List<String> nombres = new ArrayList<>();

        Matcher accesor = ACCESOR.matcher(codigo);
        while (accesor.find()) {
            String tipo = accesor.group(1).strip();
            String nombre = accesor.group(2);
            if (PALABRAS_RESERVADAS.contains(nombre) || PALABRAS_RESERVADAS.contains(tipo)) {
                continue;
            }
            // Una declaracion va seguida de cuerpo, de punto y coma o de `throws`. Sin esto,
            // una llamada sin argumentos precedida de un identificador se leeria como
            // declaracion.
            String resto =
                    codigo.substring(accesor.end(), Math.min(accesor.end() + 16, codigo.length()))
                            .stripLeading();
            if (!resto.startsWith("{") && !resto.startsWith(";") && !resto.startsWith("throws")) {
                continue;
            }
            posiciones.add(accesor.start());
            tipos.add(tipo);
            nombres.add(nombre);
        }

        Map<Integer, String> clases = clasesPorPosicion(codigo, posiciones);
        for (int i = 0; i < posiciones.size(); i++) {
            anotar(
                    esOptional(tipos.get(i)),
                    nombres.get(i),
                    clases.getOrDefault(posiciones.get(i), ""),
                    optional,
                    otros,
                    optionalPorClase,
                    otrosPorClase);
        }
    }

    private static void censarComponentes(
            String codigo,
            Set<String> optional,
            Set<String> otros,
            Map<String, Set<String>> optionalPorClase,
            Map<String, Set<String>> otrosPorClase) {
        Matcher cabecera = CABECERA_DE_RECORD.matcher(codigo);
        while (cabecera.find()) {
            String clase = cabecera.group(1);
            int abre = cabecera.end() - 1;
            int cierra = cierreDe(codigo, abre);
            for (String parte : partirPorComas(codigo.substring(abre + 1, cierra))) {
                String limpio = parte.replaceAll("@\\w+(\\([^)]*\\))?", "").strip();
                limpio = limpio.replaceAll("\\s+", " ");
                Matcher componente = COMPONENTE.matcher(limpio);
                if (!componente.matches()) {
                    continue;
                }
                anotar(
                        esOptional(componente.group(1).strip()),
                        componente.group(2),
                        clase,
                        optional,
                        otros,
                        optionalPorClase,
                        otrosPorClase);
            }
        }
    }

    private static void anotar(
            boolean deOptional,
            String nombre,
            String clase,
            Set<String> optional,
            Set<String> otros,
            Map<String, Set<String>> optionalPorClase,
            Map<String, Set<String>> otrosPorClase) {
        if (deOptional) {
            optional.add(nombre);
            optionalPorClase.computeIfAbsent(clase, c -> new HashSet<>()).add(nombre);
        } else {
            otros.add(nombre);
            otrosPorClase.computeIfAbsent(clase, c -> new HashSet<>()).add(nombre);
        }
    }

    private static boolean esOptional(String tipo) {
        return TIPO_OPTIONAL.matcher(tipo).find()
                || "Optional".equals(tipo)
                || "java.util.Optional".equals(tipo);
    }

    /**
     * Para cada posicion del codigo, el tipo mas interno que la contiene.
     *
     * <p>Se recorre con una pila de llaves en vez de buscar hacia atras: un miembro declarado
     * despues de una clase anidada se atribuiria a la anidada, y el censo por clase —que es lo que
     * distingue los dos {@code llave()}— quedaria mal.
     */
    private static Map<Integer, String> clasesPorPosicion(String codigo, List<Integer> posiciones) {
        Map<Integer, String> clases = new HashMap<>();
        Deque<String> pila = new ArrayDeque<>();
        Matcher apertura = APERTURA_DE_TIPO.matcher(codigo);
        int siguiente = apertura.find() ? apertura.start() : -1;
        String pendiente = "";
        String actual = "";
        int cursor = 0;

        for (int i = 0; i < codigo.length() && cursor < posiciones.size(); i++) {
            while (siguiente >= 0 && siguiente < i) {
                pendiente = apertura.group(1);
                siguiente = apertura.find() ? apertura.start() : -1;
            }
            while (cursor < posiciones.size() && posiciones.get(cursor) == i) {
                clases.put(i, actual);
                cursor++;
            }
            char caracter = codigo.charAt(i);
            if (caracter == '{') {
                pila.push(pendiente);
                if (!pendiente.isEmpty()) {
                    actual = pendiente;
                }
                pendiente = "";
            } else if (caracter == '}' && !pila.isEmpty()) {
                pila.pop();
                actual = pila.stream().filter(c -> !c.isEmpty()).findFirst().orElse("");
            }
        }
        return clases;
    }

    private static List<String> partirPorComas(String texto) {
        List<String> partes = new ArrayList<>();
        StringBuilder actual = new StringBuilder();
        int profundidad = 0;
        for (int i = 0; i < texto.length(); i++) {
            char c = texto.charAt(i);
            if (c == '<' || c == '(') {
                profundidad++;
            } else if (c == '>' || c == ')') {
                profundidad--;
            }
            if (c == ',' && profundidad == 0) {
                partes.add(actual.toString());
                actual.setLength(0);
            } else {
                actual.append(c);
            }
        }
        partes.add(actual.toString());
        return partes;
    }

    /** El indice del parentesis que cierra el que abre en {@code abre}. */
    private static int cierreDe(String codigo, int abre) {
        int profundidad = 0;
        for (int i = abre; i < codigo.length(); i++) {
            char c = codigo.charAt(i);
            if (c == '(') {
                profundidad++;
            } else if (c == ')') {
                profundidad--;
                if (profundidad == 0) {
                    return i;
                }
            }
        }
        return codigo.length() - 1;
    }

    private static String resumir(String fragmento) {
        String plano = fragmento.replaceAll("\\s+", " ").strip();
        return plano.length() <= 160 ? plano : plano.substring(0, 157) + "...";
    }

    /**
     * El codigo con los comentarios y el <b>interior</b> de los literales en blanco, <b>sin mover
     * ni una posicion</b>.
     *
     * <p>Las posiciones se conservan para poder citar el fragmento del archivo original en el
     * hallazgo. Y el interior de los literales se borra por dos motivos medidos: un parentesis o
     * una llave de apertura dentro de una cadena —un bloque de JSON en un texto, que en las pruebas
     * de esta base abundan— descuadraria el balanceo y la pila de tipos; y las comillas se
     * <b>conservan</b> para que {@code f("a")} no se lea como el accesor sin argumentos {@code
     * f()}.
     */
    static String limpiar(String contenido) {
        char[] salida = contenido.toCharArray();
        int i = 0;
        int n = contenido.length();
        while (i < n) {
            char actual = contenido.charAt(i);
            char siguiente = i + 1 < n ? contenido.charAt(i + 1) : '\0';
            if (actual == '/' && siguiente == '/') {
                while (i < n && contenido.charAt(i) != '\n') {
                    salida[i++] = ' ';
                }
            } else if (actual == '/' && siguiente == '*') {
                int fin = contenido.indexOf("*/", i + 2);
                fin = fin < 0 ? n : fin + 2;
                i = blanquear(contenido, salida, i, fin);
            } else if (contenido.startsWith("\"\"\"", i)) {
                int cierre = contenido.indexOf("\"\"\"", i + 3);
                int fin = cierre < 0 ? n : cierre;
                blanquear(contenido, salida, i + 3, fin);
                i = Math.min(fin + 3, n);
            } else if (actual == '"' || actual == '\'') {
                char comilla = actual;
                i++;
                while (i < n && contenido.charAt(i) != comilla) {
                    boolean escape = contenido.charAt(i) == '\\';
                    salida[i++] = ' ';
                    if (escape && i < n) {
                        salida[i++] = ' ';
                    }
                }
                i = Math.min(i + 1, n);
            } else {
                i++;
            }
        }
        return new String(salida);
    }

    private static int blanquear(String contenido, char[] salida, int desde, int hasta) {
        for (int i = desde; i < hasta && i < contenido.length(); i++) {
            if (contenido.charAt(i) != '\n') {
                salida[i] = ' ';
            }
        }
        return Math.min(hasta, contenido.length());
    }
}
