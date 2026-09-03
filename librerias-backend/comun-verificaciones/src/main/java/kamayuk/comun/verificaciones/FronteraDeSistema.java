package kamayuk.comun.verificaciones;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * NINGUN_SQL_CRUZA_LA_FRONTERA_DE_SISTEMA: nadie consulta por SQL una tabla de otro sistema.
 *
 * <p>Es la regla que la separacion en cuatro repositorios necesita y que hoy no existe, porque hoy
 * todas las tablas estan en la misma base y un {@code JOIN} entre dos contextos <b>funciona</b>. El
 * dia que la base se parta deja de funcionar, y no falla al compilar ni al desplegar: falla en
 * produccion, en la consulta que nadie volvio a mirar.
 *
 * <p>Lo que la hace util antes del corte es que en {@code sgtm} —donde las tablas siguen juntas—
 * <b>encuentra los cruces de verdad</b>. No se arreglan aqui: se registran como excepciones
 * nominadas, cada una con quien la cierra, y esa lista <b>es</b> la lista de trabajo pendiente. En
 * la etapa P5E tiene que llegar a cero, y eso es el criterio de que la separacion termino.
 *
 * <p><b>Por que es un escaner de texto y no una regla de ArchUnit.</b> Lo que cruza la frontera no
 * es un tipo sino un nombre de tabla dentro de un literal de cadena: ArchUnit ve el bytecode y ahi
 * un {@code JOIN predio} no deja ninguna huella. Es el mismo motivo por el que {@code SET SESSION}
 * y el {@code DELETE} sobre tabla protegida los revisa {@link RevisorDeCodigoFuente} y no una regla
 * de arquitectura.
 *
 * <h2>Los falsos positivos del patron, nombrados para que nadie los persiga dos veces</h2>
 *
 * <p>Son los cuatro que GOB-05 §6.0 midio al buscar los cruces a mano: {@code JOIN LATERAL}, el
 * {@code UPDATE SET} de un {@code ON CONFLICT … DO UPDATE SET}, el {@code UPDATE OF} de un {@code
 * FOR UPDATE OF} y las palabras castellanas sueltas del javadoc —«FROM y», «JOIN son», «UPDATE
 * si»—. Los tres primeros se descartan por palabra reservada; el cuarto no llega, porque solo se
 * miran los literales de cadena y el SQL de las migraciones, nunca la prosa.
 */
public final class FronteraDeSistema {

    /**
     * Las palabras que siguen a {@code FROM}/{@code JOIN}/{@code UPDATE} y no son una tabla.
     *
     * <p>Sin esta lista, {@code JOIN LATERAL (…)} se lee como una tabla llamada «lateral» y el
     * escaner acusa un cruce que no existe. Un escaner que grita en falso deja de leerse, que es
     * como se pierden las reglas de verdad (#437).
     */
    private static final Set<String> NO_SON_TABLAS =
            Set.of("lateral", "set", "of", "only", "select", "unnest", "generate_series", "values");

    private static final Pattern REFERENCIA_A_TABLA =
            Pattern.compile(
                    "\\b(from|join|insert\\s+into|update|delete\\s+from)\\s+([a-z_][a-z_0-9]*)",
                    Pattern.CASE_INSENSITIVE);

    private final ConfiguracionDeLasVerificaciones configuracion;
    private final Map<String, String> sistemaDeCadaTabla;
    private final Map<String, Set<String>> tablasConsentidasPorClase;

    public FronteraDeSistema(ConfiguracionDeLasVerificaciones configuracion) {
        this.configuracion = configuracion;
        this.sistemaDeCadaTabla = new HashMap<>();
        configuracion
                .sistemaDeCadaTabla()
                .forEach(
                        (tabla, sistema) ->
                                sistemaDeCadaTabla.put(tabla.toLowerCase(Locale.ROOT), sistema));
        this.tablasConsentidasPorClase = new HashMap<>();
        for (ConfiguracionDeLasVerificaciones.CruceConsentido cruce :
                configuracion.crucesConsentidos()) {
            tablasConsentidasPorClase
                    .computeIfAbsent(cruce.clase(), c -> new java.util.HashSet<>())
                    .add(cruce.tabla().toLowerCase(Locale.ROOT));
        }
    }

    /**
     * La configuracion de este repositorio, resuelta por {@link ConfiguracionDeLasVerificaciones}.
     */
    public static FronteraDeSistema delRepositorio() {
        return new FronteraDeSistema(ConfiguracionDeLasVerificaciones.actual());
    }

    /**
     * Los cruces de un archivo Java: se miran los literales de cadena, que es donde vive el SQL.
     *
     * @param archivo ruta relativa, para poder arreglarlo sin buscarlo
     * @param contenido el fuente entero
     */
    public List<RevisorDeCodigoFuente.Hallazgo> revisarJava(String archivo, String contenido) {
        return revisar(archivo, RevisorDeCodigoFuente.literalesDeCadena(contenido));
    }

    /** Los cruces de una migracion, sin sus comentarios. */
    public List<RevisorDeCodigoFuente.Hallazgo> revisarSql(String archivo, String contenido) {
        return revisar(archivo, RevisorDeCodigoFuente.sqlSinComentarios(contenido));
    }

    private List<RevisorDeCodigoFuente.Hallazgo> revisar(String archivo, String texto) {
        String sistemaPropio = configuracion.sistemaDelArchivo(archivo);
        String clase = claseDe(archivo);
        if (ConfiguracionDeLasVerificaciones.SISTEMA_REPLICADO.equals(sistemaPropio)) {
            // Codigo que no es de ningun sistema: la plataforma comun, el esquema, el ensamblado.
            // No puede cruzar una frontera porque no esta a ningun lado de ella.
            return List.of();
        }
        Set<String> consentidas = tablasConsentidasPorClase.getOrDefault(clase, Set.of());
        List<RevisorDeCodigoFuente.Hallazgo> hallazgos = new ArrayList<>();
        Matcher referencia = REFERENCIA_A_TABLA.matcher(texto);
        while (referencia.find()) {
            String tabla = referencia.group(2).toLowerCase(Locale.ROOT);
            if (NO_SON_TABLAS.contains(tabla)) {
                continue;
            }
            String dueno = sistemaDeCadaTabla.get(tabla);
            if (dueno == null
                    || dueno.equals(sistemaPropio)
                    || ConfiguracionDeLasVerificaciones.SISTEMA_REPLICADO.equals(dueno)) {
                continue;
            }
            if (consentidas.contains(tabla)) {
                continue;
            }
            hallazgos.add(
                    new RevisorDeCodigoFuente.Hallazgo(
                            archivo,
                            "la tabla «"
                                    + tabla
                                    + "» es de «"
                                    + dueno
                                    + "» y esto es «"
                                    + sistemaPropio
                                    + "»: el dia que la base se parta, esta consulta deja de"
                                    + " funcionar en produccion y no antes. Se pide por un puerto,"
                                    + " o se registra como cruce consentido con el issue que lo"
                                    + " cierra",
                            referencia.group()));
        }
        return hallazgos;
    }

    /**
     * El nombre simple de la clase, que es como se nombra un cruce consentido.
     *
     * <p>Se nombra la clase y no el archivo entero para que la lista se lea igual venga la ruta
     * como venga: en un repositorio el archivo es {@code sgtm-rentas/src/main/…} y en otro no.
     */
    private static String claseDe(String archivo) {
        String nombre = archivo.replace('\\', '/');
        int barra = nombre.lastIndexOf('/');
        if (barra >= 0) {
            nombre = nombre.substring(barra + 1);
        }
        int punto = nombre.lastIndexOf('.');
        return punto >= 0 ? nombre.substring(0, punto) : nombre;
    }
}
