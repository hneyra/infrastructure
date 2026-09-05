package kamayuk.comun.verificaciones;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import kamayuk.comun.verificaciones.RevisorDeCodigoFuente.Hallazgo;

/**
 * ADR-0034 regla 1: toda tabla de tenant con una columna {@code geography} lleva sus cuatro
 * columnas de marco y su indice compuesto.
 *
 * <h2>Por que existe</h2>
 *
 * <p>Bajo RLS, {@code geography_overlaps} no es <i>leakproof</i>: PostgreSQL no promueve la
 * condicion espacial por encima de la politica, el indice GiST no sirve al rol de la aplicacion y
 * la consulta acaba leyendo el padron entero del inquilino. Es el quinto hallazgo de RLS, y {@code
 * V65} lo mitigo para {@code predio} con cuatro columnas generadas —el rectangulo envolvente, en
 * {@code double precision}— comparadas con {@code <=} y {@code >=}.
 *
 * <p><b>El problema no es {@code predio}: es que el defecto se repite en silencio.</b> La consulta
 * sin marco devuelve el resultado CORRECTO y el plan sigue diciendo «Index» —que es el sintoma
 * exacto que este proyecto ya se ha comido seis veces—. Una tabla nueva con geometria y sin marco
 * no rompe ninguna prueba: solo lee de mas, para siempre, y nadie lo mira.
 *
 * <h2>Por que lee el TEXTO de las migraciones y no el catalogo</h2>
 *
 * <p>Porque asi corre en los cinco repositorios sin base de datos, en el mismo escaneo que {@code
 * SET SESSION} y el {@code DELETE} sobre tabla protegida. Una comprobacion que necesitara
 * PostgreSQL solo morderia donde hay PostGIS —hoy, un solo repositorio— y las otras cuatro se
 * enterarian el dia que alguien anadiera geometria, que es justo el dia en que la regla tiene que
 * estar puesta.
 *
 * <p>Lo que cuesta es que hay que <b>entender</b> el SQL. Por eso el revisor compone el esquema
 * sentencia a sentencia en vez de buscar patrones sueltos: una tabla puede nacer sin geometria y
 * recibirla tres migraciones despues, y un escaner archivo por archivo daria por buena exactamente
 * esa forma del defecto.
 *
 * <h2>Lo que este revisor NO ve, dicho antes de que alguien lo descubra</h2>
 *
 * <ul>
 *   <li><b>Una tabla creada fuera de las migraciones.</b> No existe hoy y no deberia existir nunca:
 *       el esquema nace en un baseline (ADR-0032).
 *   <li><b>Una vista materializada con geometria.</b> No se modela como tabla de tenant y no lleva
 *       politica; el dia que aparezca una, esta regla no la vera y hay que ampliarla.
 *   <li><b>Que el indice se USE.</b> Eso no lo puede afirmar ningun escaner de texto: lo afirma un
 *       {@code EXPLAIN}, y de eso se encarga la prueba de plan del repositorio que tenga PostGIS.
 * </ul>
 */
public final class RevisorDeEsquema {

    /** Las cuatro columnas del rectangulo envolvente, en el orden en que van en el indice. */
    public static final List<String> COLUMNAS_DEL_MARCO =
            List.of("marco_oeste", "marco_sur", "marco_este", "marco_norte");

    /** El tipo que las cuatro tienen que declarar. Ver {@link #porQueNoNumeric()}. */
    public static final String TIPO_DEL_MARCO = "double precision";

    private static final Pattern CREAR_TABLA =
            Pattern.compile(
                    "(?is)^\\s*create\\s+(?:unlogged\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?"
                            + "([\\w.\"]+)\\s*\\((.*)\\)\\s*$");

    private static final Pattern PARTICION_DE =
            Pattern.compile(
                    "(?is)^\\s*create\\s+table\\s+([\\w.\"]+)\\s+partition\\s+of\\s+([\\w.\"]+)");

    private static final Pattern ANADIR_COLUMNA =
            Pattern.compile(
                    "(?is)^\\s*alter\\s+table\\s+(?:only\\s+)?([\\w.\"]+)\\s+add\\s+column\\s+"
                            + "(?:if\\s+not\\s+exists\\s+)?(\\w+)\\s+(.*)$");

    private static final Pattern QUITAR_COLUMNA =
            Pattern.compile(
                    "(?is)^\\s*alter\\s+table\\s+(?:only\\s+)?([\\w.\"]+)\\s+drop\\s+column\\s+"
                            + "(?:if\\s+exists\\s+)?(\\w+)");

    private static final Pattern RLS_ENCENDIDA =
            Pattern.compile(
                    "(?is)^\\s*alter\\s+table\\s+(?:only\\s+)?([\\w.\"]+)\\s+enable\\s+row\\s+level"
                            + "\\s+security");

    private static final Pattern CREAR_INDICE =
            Pattern.compile(
                    "(?is)^\\s*create\\s+(?:unique\\s+)?index\\s+(?:concurrently\\s+)?"
                            + "(?:if\\s+not\\s+exists\\s+)?([\\w.\"]+)\\s+on\\s+(?:only\\s+)?"
                            + "([\\w.\"]+)\\s*(?:using\\s+(\\w+)\\s*)?\\((.*?)\\)\\s*"
                            + "(?:where\\b.*)?$");

    private static final Pattern QUITAR_INDICE =
            Pattern.compile("(?is)^\\s*drop\\s+index\\s+(?:if\\s+exists\\s+)?([\\w.\"]+)");

    private static final Pattern QUITAR_TABLA =
            Pattern.compile("(?is)^\\s*drop\\s+table\\s+(?:if\\s+exists\\s+)?([\\w.\"]+)");

    /** {@code geography(MultiPolygon,4326)} y {@code geometry}, con o sin modificador. */
    private static final Pattern TIPO_GEOGRAFICO =
            Pattern.compile("(?i)\\b(geography|geometry)\\s*(\\(|\\b)");

    private static final Pattern MODIFICADOR_DE_COLUMNA =
            Pattern.compile(
                    "(?i)\\b(not\\s+null|null|default|generated|constraint|check|references"
                            + "|primary|unique|collate)\\b");

    private static final Pattern ETIQUETA_DE_DOLAR = Pattern.compile("\\$[A-Za-z_]*\\$");

    private static final Set<String> RESTRICCIONES_DE_TABLA =
            Set.of("constraint", "primary", "foreign", "unique", "check", "exclude", "like");

    private RevisorDeEsquema() {}

    /**
     * Una migracion, con el nombre que se muestra en el hallazgo.
     *
     * @param nombre el archivo, para poder abrirlo sin buscarlo
     * @param sql su contenido entero, comentarios incluidos: el revisor los quita
     */
    public record Migracion(String nombre, String sql) {}

    /** Una columna, tal y como el esquema la declara. */
    record Columna(String nombre, String tipo, boolean generada, String declaracion) {}

    /** Una tabla del esquema, acumulada a lo largo de las migraciones. */
    static final class Tabla {
        final String nombre;
        final Map<String, Columna> columnas = new LinkedHashMap<>();
        final Map<String, List<String>> indices = new LinkedHashMap<>();
        boolean conRls;
        String migracionQueLaCreo;

        Tabla(String nombre) {
            this.nombre = nombre;
        }

        boolean tieneGeografia() {
            return columnas.values().stream()
                    .anyMatch(c -> TIPO_GEOGRAFICO.matcher(c.tipo()).find());
        }
    }

    /**
     * Revisa el esquema entero, con las migraciones <b>en orden de version</b>.
     *
     * <p>Se pasan todas y no una a una porque la regla es sobre el estado final: una tabla puede
     * nacer sin geometria en {@code V1} y recibirla en {@code V6}, y ahi es donde el marco tiene
     * que aparecer.
     *
     * @param migraciones las migraciones ordenadas por version, de la primera a la ultima
     */
    public static List<Hallazgo> revisar(List<Migracion> migraciones) {
        Map<String, Tabla> esquema = componerElEsquema(migraciones);
        List<Hallazgo> hallazgos = new ArrayList<>();

        for (Tabla tabla : esquema.values()) {
            if (!tabla.conRls || !tabla.tieneGeografia()) {
                continue;
            }
            String donde = tabla.migracionQueLaCreo;

            for (String marco : COLUMNAS_DEL_MARCO) {
                Columna columna = tabla.columnas.get(marco);
                if (columna == null) {
                    hallazgos.add(
                            new Hallazgo(
                                    donde,
                                    "ADR-0034 regla 1: la tabla de tenant «"
                                            + tabla.nombre
                                            + "» tiene geometria y le falta la columna «"
                                            + marco
                                            + "». Sin las cuatro, la consulta espacial da el"
                                            + " resultado correcto, el plan dice «Index» y lee el"
                                            + " padron entero del inquilino (quinto hallazgo de"
                                            + " RLS)",
                                    tabla.nombre + "." + marco));
                    continue;
                }
                if (!columna.generada()) {
                    hallazgos.add(
                            new Hallazgo(
                                    donde,
                                    "ADR-0034 regla 1: «"
                                            + tabla.nombre
                                            + "."
                                            + marco
                                            + "» no es GENERATED ALWAYS AS ... STORED. Escrita a"
                                            + " mano se queda vieja en cuanto alguien corrija la"
                                            + " geometria, y el filtro empezaria a esconder lotes"
                                            + " sin decirlo",
                                    columna.declaracion()));
                }
                if (!columna.tipo().toLowerCase(Locale.ROOT).startsWith(TIPO_DEL_MARCO)) {
                    hallazgos.add(
                            new Hallazgo(
                                    donde,
                                    "ADR-0034 regla 1: «"
                                            + tabla.nombre
                                            + "."
                                            + marco
                                            + "» tiene que ser «double precision». "
                                            + porQueNoNumeric(),
                                    columna.tipo()));
                }
            }

            if (!tieneElIndiceDelMarco(tabla)) {
                hallazgos.add(
                        new Hallazgo(
                                donde,
                                "ADR-0034 regla 1: la tabla de tenant «"
                                        + tabla.nombre
                                        + "» tiene geometria y ningun indice (municipalidad_id,"
                                        + " marco_oeste, marco_sur, marco_este, marco_norte). Las"
                                        + " cuatro columnas sin su indice no compran nada: el"
                                        + " filtro sigue siendo un Filter sobre el padron entero",
                                tabla.nombre));
            }
        }
        return hallazgos;
    }

    /** Por que el marco va en {@code double precision} y no en {@code numeric}. */
    public static String porQueNoNumeric() {
        return "«numeric» no vale: numeric_le tampoco es leakproof, asi que las cuatro columnas"
                + " dejarian de servir y nada se pondria rojo — el mismo defecto con otra cara";
    }

    private static boolean tieneElIndiceDelMarco(Tabla tabla) {
        List<String> esperado = new ArrayList<>();
        esperado.add("municipalidad_id");
        esperado.addAll(COLUMNAS_DEL_MARCO);
        return tabla.indices.values().stream().anyMatch(esperado::equals);
    }

    // ------------------------------------------------------------------
    // La composicion del esquema
    // ------------------------------------------------------------------

    static Map<String, Tabla> componerElEsquema(List<Migracion> migraciones) {
        Map<String, Tabla> esquema = new LinkedHashMap<>();
        Map<String, String> tablaDelIndice = new LinkedHashMap<>();

        for (Migracion migracion : migraciones) {
            for (String sentencia : sentenciasDe(migracion.sql())) {
                aplicar(esquema, tablaDelIndice, migracion.nombre(), sentencia);
            }
        }
        return esquema;
    }

    private static void aplicar(
            Map<String, Tabla> esquema,
            Map<String, String> tablaDelIndice,
            String migracion,
            String sentencia) {

        // Una particion NO declara columnas propias: las hereda. Revisarla como tabla suelta
        // acusaria a `auditoria_2026` de no tener las columnas que si tiene.
        if (PARTICION_DE.matcher(sentencia).find()) {
            return;
        }

        Matcher crear = CREAR_TABLA.matcher(sentencia);
        if (crear.matches()) {
            Tabla tabla = new Tabla(simplificar(crear.group(1)));
            tabla.migracionQueLaCreo = migracion;
            for (String definicion : partirLaLista(crear.group(2))) {
                Columna columna = comoColumna(definicion);
                if (columna != null) {
                    tabla.columnas.put(columna.nombre(), columna);
                }
            }
            esquema.put(tabla.nombre, tabla);
            return;
        }

        Matcher anadir = ANADIR_COLUMNA.matcher(sentencia);
        if (anadir.matches()) {
            Tabla tabla = esquema.get(simplificar(anadir.group(1)));
            if (tabla != null) {
                Columna columna = comoColumna(anadir.group(2) + " " + anadir.group(3));
                if (columna != null) {
                    tabla.columnas.put(columna.nombre(), columna);
                    // La tabla nacio en otra migracion, pero el hallazgo tiene que apuntar a la
                    // que trajo la geometria: es la que hay que abrir para arreglarlo.
                    if (TIPO_GEOGRAFICO.matcher(columna.tipo()).find()) {
                        tabla.migracionQueLaCreo = migracion;
                    }
                }
            }
            return;
        }

        Matcher quitarColumna = QUITAR_COLUMNA.matcher(sentencia);
        if (quitarColumna.find()) {
            Tabla tabla = esquema.get(simplificar(quitarColumna.group(1)));
            if (tabla != null) {
                tabla.columnas.remove(simplificar(quitarColumna.group(2)));
            }
            return;
        }

        Matcher rls = RLS_ENCENDIDA.matcher(sentencia);
        if (rls.find()) {
            Tabla tabla = esquema.get(simplificar(rls.group(1)));
            if (tabla != null) {
                tabla.conRls = true;
            }
            return;
        }

        Matcher indice = CREAR_INDICE.matcher(sentencia);
        if (indice.matches()) {
            String nombre = simplificar(indice.group(1));
            Tabla tabla = esquema.get(simplificar(indice.group(2)));
            if (tabla != null) {
                tabla.indices.put(nombre, columnasDelIndice(indice.group(4)));
                tablaDelIndice.put(nombre, tabla.nombre);
            }
            return;
        }

        Matcher quitarIndice = QUITAR_INDICE.matcher(sentencia);
        if (quitarIndice.find()) {
            String nombre = simplificar(quitarIndice.group(1));
            Tabla tabla = esquema.get(tablaDelIndice.get(nombre));
            if (tabla != null) {
                tabla.indices.remove(nombre);
            }
            return;
        }

        Matcher quitarTabla = QUITAR_TABLA.matcher(sentencia);
        if (quitarTabla.find()) {
            esquema.remove(simplificar(quitarTabla.group(1)));
        }
    }

    /**
     * Una definicion de columna, o {@code null} si la linea es una restriccion de tabla.
     *
     * <p>{@code CONSTRAINT}, {@code PRIMARY KEY}, {@code FOREIGN KEY}, {@code UNIQUE}, {@code
     * CHECK} y {@code EXCLUDE} van dentro del mismo parentesis que las columnas y no lo son.
     */
    private static Columna comoColumna(String definicion) {
        String limpia = definicion.strip();
        if (limpia.isEmpty()) {
            return null;
        }
        String primeraPalabra = limpia.split("[\\s(]+", 2)[0].toLowerCase(Locale.ROOT);
        if (RESTRICCIONES_DE_TABLA.contains(primeraPalabra)) {
            return null;
        }
        String[] partes = limpia.split("\\s+", 2);
        if (partes.length < 2) {
            return null;
        }
        String resto = partes[1];
        boolean generada =
                resto.toLowerCase(Locale.ROOT)
                        .replaceAll("\\s+", " ")
                        .contains("generated always as (");
        return new Columna(simplificar(partes[0]), tipoDe(resto), generada, limpia);
    }

    /**
     * El tipo declarado: lo que va desde el nombre hasta la primera palabra de modificador.
     *
     * <p>Se queda con {@code double precision}, {@code geography(MultiPolygon,4326)} o {@code
     * character varying(20)} y descarta el {@code NOT NULL}, el {@code DEFAULT} y el {@code
     * GENERATED} que vienen detras. La busqueda se hace sobre el texto <b>sin parentesis</b> porque
     * dentro de uno hay palabras que la enganarian: {@code GENERATED ALWAYS AS (st_xmin(...))}
     * lleva un {@code default} en cualquier expresion que lo use.
     */
    private static String tipoDe(String resto) {
        String sinParentesis = resto.replaceAll("\\([^()]*\\)", "\u0000");
        Matcher corte = MODIFICADOR_DE_COLUMNA.matcher(sinParentesis);
        if (!corte.find()) {
            return resto.strip();
        }
        return resto.substring(0, posicionReal(resto, corte.start())).strip();
    }

    /**
     * La posicion del texto original que corresponde a una del texto con los parentesis sustituidos
     * por un solo caracter.
     */
    private static int posicionReal(String original, int enElReducido) {
        int i = 0;
        int visto = 0;
        while (i < original.length() && visto < enElReducido) {
            if (original.charAt(i) == '(') {
                int cierre = original.indexOf(')', i);
                if (cierre < 0) {
                    break;
                }
                i = cierre + 1;
            } else {
                i++;
            }
            visto++;
        }
        return i;
    }

    /** Las columnas de un indice, sin clase de operadores, orden ni parentesis envolventes. */
    static List<String> columnasDelIndice(String lista) {
        List<String> columnas = new ArrayList<>();
        for (String parte : partirLaLista(lista)) {
            String limpia =
                    parte.replaceAll(
                                    "(?i)\\s+(text_pattern_ops|varchar_pattern_ops"
                                            + "|bpchar_pattern_ops|asc|desc|nulls\\s+first"
                                            + "|nulls\\s+last)\\b",
                                    "")
                            .strip();
            while (limpia.startsWith("(") && limpia.endsWith(")")) {
                limpia = limpia.substring(1, limpia.length() - 1).strip();
            }
            columnas.add(simplificar(limpia));
        }
        return columnas;
    }

    /** Parte por comas de primer nivel: las de dentro de un parentesis no separan. */
    static List<String> partirLaLista(String texto) {
        List<String> partes = new ArrayList<>();
        int profundidad = 0;
        boolean enCadena = false;
        StringBuilder actual = new StringBuilder();
        for (int i = 0; i < texto.length(); i++) {
            char c = texto.charAt(i);
            if (c == '\'') {
                enCadena = !enCadena;
            }
            if (!enCadena) {
                if (c == '(') {
                    profundidad++;
                } else if (c == ')') {
                    profundidad--;
                } else if (c == ',' && profundidad == 0) {
                    partes.add(actual.toString());
                    actual.setLength(0);
                    continue;
                }
            }
            actual.append(c);
        }
        if (!actual.toString().isBlank()) {
            partes.add(actual.toString());
        }
        return partes;
    }

    /**
     * Las sentencias de un archivo, sin comentarios y respetando el entrecomillado por dolar.
     *
     * <p>Partir por {@code ;} a secas partiria el cuerpo de cada funcion PL/pgSQL por la mitad, y
     * un cuerpo partido produce fragmentos que casan con cualquier cosa.
     */
    static List<String> sentenciasDe(String sql) {
        String limpio = sinComentarios(sql);
        List<String> sentencias = new ArrayList<>();
        StringBuilder actual = new StringBuilder();
        int i = 0;
        while (i < limpio.length()) {
            char c = limpio.charAt(i);
            if (c == '\'') {
                int fin = limpio.indexOf('\'', i + 1);
                if (fin < 0) {
                    fin = limpio.length() - 1;
                }
                actual.append(limpio, i, fin + 1);
                i = fin + 1;
                continue;
            }
            if (c == '$') {
                Matcher etiqueta = ETIQUETA_DE_DOLAR.matcher(limpio).region(i, limpio.length());
                if (etiqueta.lookingAt()) {
                    String marca = etiqueta.group();
                    int fin = limpio.indexOf(marca, i + marca.length());
                    if (fin < 0) {
                        fin = limpio.length() - marca.length();
                    }
                    actual.append(limpio, i, fin + marca.length());
                    i = fin + marca.length();
                    continue;
                }
            }
            if (c == ';') {
                sentencias.add(actual.toString());
                actual.setLength(0);
                i++;
                continue;
            }
            actual.append(c);
            i++;
        }
        if (!actual.toString().isBlank()) {
            sentencias.add(actual.toString());
        }
        return sentencias.stream().filter(s -> !s.isBlank()).toList();
    }

    private static String sinComentarios(String sql) {
        String sinBloque = Pattern.compile("(?s)/\\*.*?\\*/").matcher(sql).replaceAll("");
        StringBuilder limpio = new StringBuilder();
        for (String linea : sinBloque.split("\n", -1)) {
            limpio.append(quitarComentarioDeLinea(linea)).append('\n');
        }
        return limpio.toString();
    }

    /** Quita el {@code --} de una linea, salvo el que este dentro de una cadena. */
    private static String quitarComentarioDeLinea(String linea) {
        boolean enCadena = false;
        for (int i = 0; i < linea.length(); i++) {
            char c = linea.charAt(i);
            if (c == '\'') {
                enCadena = !enCadena;
            } else if (!enCadena
                    && c == '-'
                    && i + 1 < linea.length()
                    && linea.charAt(i + 1) == '-') {
                return linea.substring(0, i);
            }
        }
        return linea;
    }

    /** Un identificador sin esquema, sin comillas y en minusculas. */
    private static String simplificar(String identificador) {
        String limpio = identificador.strip().replace("\"", "");
        int punto = limpio.lastIndexOf('.');
        return (punto >= 0 ? limpio.substring(punto + 1) : limpio).toLowerCase(Locale.ROOT);
    }

    /** Los nombres de las tablas que el esquema declara, para poder afirmar que se leyo algo. */
    public static Set<String> tablasDe(List<Migracion> migraciones) {
        return new LinkedHashSet<>(componerElEsquema(migraciones).keySet());
    }

    /** Las tablas de tenant que llevan geometria, que son las que esta regla vigila. */
    public static Set<String> tablasConGeometriaDeTenant(List<Migracion> migraciones) {
        Set<String> conGeometria = new LinkedHashSet<>();
        for (Tabla tabla : componerElEsquema(migraciones).values()) {
            if (tabla.conRls && tabla.tieneGeografia()) {
                conGeometria.add(tabla.nombre);
            }
        }
        return conGeometria;
    }
}
