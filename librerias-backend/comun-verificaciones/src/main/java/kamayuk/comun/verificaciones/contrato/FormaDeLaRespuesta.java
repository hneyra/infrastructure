package kamayuk.comun.verificaciones.contrato;

import java.lang.reflect.Method;
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.RecordComponent;
import java.lang.reflect.Type;
import java.lang.reflect.TypeVariable;
import java.lang.reflect.WildcardType;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * La forma del JSON que devuelve un endpoint, resuelta de su tipo de retorno.
 *
 * <p><b>Vive en la libreria compartida desde P6</b>, y no por ahorrar codigo: la usan las dos
 * mitades de una prueba de contrato entre repositorios —el consumidor para declarar que espera, el
 * proveedor para comprobar que lo cumple—, y dos implementaciones de «que forma tiene este JSON»
 * acabarian discrepando justo en el caso raro. Discrepar ahi significa que el proveedor cree
 * cumplir un contrato que el consumidor lee de otra manera, que es peor que no tener contrato.
 *
 * <h2>Por que se deriva y no se escribe</h2>
 *
 * <p>El proxy de datos del frontend publica la forma de cada {@code Resource} <b>copiada a mano</b>
 * (`packages/api-mock/src/recursos.ts`), y de ahi salio el defecto de #379: el proxy servia un
 * {@code licenciaConducir} que ni {@code PapeletaResource} ni {@code Papeleta} modelan, y nada lo
 * noto —el proxy no valida contra ningun esquema—. La respuesta de entonces fue un guardia escrito
 * a mano con los veinte campos de ese recurso; esto es ese guardia para <b>todas</b> las
 * operaciones, y sin lista que mantener: los campos salen de los {@code record} del backend.
 *
 * <h2>Que se representa</h2>
 *
 * <p>Solo la <b>estructura</b>: los nombres de campo y su anidamiento. Los tipos se reducen a siete
 * hojas —{@code texto}, {@code entero}, {@code numero}, {@code booleano}, {@code fecha}, {@code
 * instante}, {@code objeto}—, que es lo que hace falta para comparar dos idiomas distintos sin
 * inventar una correspondencia entre el sistema de tipos de Java y el de TypeScript.
 *
 * <p><b>Los cuatro objetos de valor del dominio salen como {@code texto}</b>, y no por comodidad:
 * es lo que hace {@code ConfiguracionDeJson}, que los serializa con {@code writeString} porque el
 * {@code number} de JavaScript perderia centimos (RNF-055, regla 1). Una forma que dijera «numero»
 * describiria un JSON que el backend no emite.
 */
public final class FormaDeLaRespuesta {

    /** Una hoja: el JSON lleva ahi un valor, no un objeto. */
    public static final String TEXTO = "texto";

    private static final String ENTERO = "entero";
    private static final String NUMERO = "numero";
    private static final String BOOLEANO = "booleano";
    private static final String FECHA = "fecha";
    private static final String INSTANTE = "instante";
    private static final String OBJETO = "objeto";
    private static final String NADA = "nada";
    private static final String ARCHIVO = "archivo";
    private static final String RECURSIVO = "recursivo";

    /**
     * Los objetos de valor que {@code ConfiguracionDeJson} serializa como cadena.
     *
     * <p>Se nombran por su nombre simple y no por su clase para no hacer que este modulo de prueba
     * dependa del dominio compartido: lo que se compara es la forma del JSON, y ahi lo que hay es
     * una cadena venga de donde venga.
     */
    private static final Set<String> COMO_CADENA =
            Set.of("Dinero", "Alicuota", "Porcentaje", "AreaM2");

    private FormaDeLaRespuesta() {}

    /** La forma que devuelve este metodo de controlador. */
    public static Object de(Method metodo) {
        return resolver(metodo.getGenericReturnType(), Map.of(), new LinkedHashSet<>());
    }

    /**
     * La forma de un tipo suelto.
     *
     * <p>Hace falta para las dos cosas que el tipo de retorno no dice: el <b>cuerpo</b> que un
     * endpoint acepta —el {@code record} de su {@code @RequestBody}— y la respuesta de un endpoint
     * que serializa a mano y devuelve {@code ResponseEntity<String>} para controlar su {@code
     * ETag}. Ahi el tipo de retorno es «texto» y no describe nada.
     */
    public static Object deTipo(Class<?> tipo) {
        return resolver(tipo, Map.of(), new LinkedHashSet<>());
    }

    // ------------------------------------------------------------------

    private static Object resolver(
            Type tipo, Map<String, Type> sustituciones, Set<Class<?>> enCurso) {
        if (tipo instanceof TypeVariable<?> variable) {
            Type real = sustituciones.get(variable.getName());
            return real == null ? OBJETO : resolver(real, Map.of(), enCurso);
        }
        if (tipo instanceof WildcardType comodin) {
            Type[] superiores = comodin.getUpperBounds();
            return superiores.length == 0
                    ? OBJETO
                    : resolver(superiores[0], sustituciones, enCurso);
        }
        if (tipo instanceof java.lang.reflect.GenericArrayType arreglo) {
            return List.of(resolver(arreglo.getGenericComponentType(), sustituciones, enCurso));
        }
        if (tipo instanceof ParameterizedType parametrizado) {
            return deParametrizado(parametrizado, sustituciones, enCurso);
        }
        if (tipo instanceof Class<?> clase) {
            return deClase(clase, enCurso);
        }
        return OBJETO;
    }

    private static Object deParametrizado(
            ParameterizedType tipo, Map<String, Type> sustituciones, Set<Class<?>> enCurso) {

        Class<?> crudo = (Class<?>) tipo.getRawType();
        Type[] argumentos = tipo.getActualTypeArguments();

        // Los envoltorios que no llegan al JSON: `ResponseEntity` es el sobre HTTP y
        // `Optional` es la ausencia, que en JSON es `null` y no un campo mas.
        if (esEnvoltorio(crudo)) {
            return argumentos.length == 0
                    ? OBJETO
                    : resolver(argumentos[0], sustituciones, enCurso);
        }
        if (Collection.class.isAssignableFrom(crudo)) {
            return argumentos.length == 0
                    ? List.of(OBJETO)
                    : List.of(resolver(argumentos[0], sustituciones, enCurso));
        }
        if (Map.class.isAssignableFrom(crudo)) {
            return OBJETO;
        }
        if (crudo.isRecord()) {
            return deRecord(crudo, mapaDeTipos(crudo, argumentos, sustituciones), enCurso);
        }
        return deClase(crudo, enCurso);
    }

    /**
     * El tipo real de un argumento generico, cuando el argumento es a su vez una variable.
     *
     * <p>Solo hace falta al <b>construir el mapa</b> de un record generico anidado dentro de otro:
     * `RespuestaPaginada<T>` dentro de algo que a su vez tenga su propia T. Al recorrer, la
     * sustitucion la hace {@link #resolver} con el mapa que va bajando.
     *
     * <p><b>Estaba tambien en los dos sitios donde se recorre</b>, y esa duplicacion hacia que la
     * resolucion del sobre paginado —lo que convierte `List<T>` en la lista de fichas de verdad— no
     * se pudiera romper: quitando cualquiera de los dos mecanismos, el otro la resolvia igual y las
     * tres pruebas seguian en VERDE. Dos caminos para lo mismo no es una red, es una regla que no
     * se puede comprobar.
     */
    private static Type sustituido(Type argumento, Map<String, Type> sustituciones) {
        if (argumento instanceof TypeVariable<?> variable) {
            Type real = sustituciones.get(variable.getName());
            return real == null ? argumento : real;
        }
        return argumento;
    }

    private static Map<String, Type> mapaDeTipos(
            Class<?> crudo, Type[] argumentos, Map<String, Type> heredadas) {

        Map<String, Type> mapa = new HashMap<>();
        TypeVariable<?>[] variables = crudo.getTypeParameters();
        for (int i = 0; i < variables.length && i < argumentos.length; i++) {
            mapa.put(variables[i].getName(), sustituido(argumentos[i], heredadas));
        }
        return mapa;
    }

    private static Object deClase(Class<?> clase, Set<Class<?>> enCurso) {
        if (clase.isArray()) {
            return clase == byte[].class
                    ? ARCHIVO
                    : List.of(deClase(clase.getComponentType(), enCurso));
        }
        // **Antes de mirar si es un record**, y ahi estaba el defecto: los cuatro
        // objetos de valor SON records —`Dinero` lleva dentro un `BigDecimal
        // valor`—, asi que la primera version los describia como `{valor: numero}`
        // cuando lo que el backend emite es la cadena «1842.60». Nada se ponia
        // rojo: el comparador del frontend ve una cadena donde la forma dice
        // objeto, no puede comparar y se calla, de modo que los campos de dinero
        // quedaban FUERA de la comprobacion sin que nadie lo supiera.
        if (COMO_CADENA.contains(clase.getSimpleName())) {
            return TEXTO;
        }
        if (clase.isRecord()) {
            return deRecord(clase, Map.of(), enCurso);
        }
        return hoja(clase);
    }

    private static Object deRecord(
            Class<?> clase, Map<String, Type> sustituciones, Set<Class<?>> enCurso) {
        if (enCurso.contains(clase)) {
            // Un record que se contiene a si mismo —un arbol— no tiene forma finita.
            return RECURSIVO;
        }
        Set<Class<?>> siguiente = new LinkedHashSet<>(enCurso);
        siguiente.add(clase);

        Map<String, Object> forma = new LinkedHashMap<>();
        for (RecordComponent componente : clase.getRecordComponents()) {
            forma.put(
                    componente.getName(),
                    resolver(componente.getGenericType(), sustituciones, siguiente));
        }
        return forma;
    }

    private static boolean esEnvoltorio(Class<?> clase) {
        return Optional.class.equals(clase)
                || "ResponseEntity".equals(clase.getSimpleName())
                || "HttpEntity".equals(clase.getSimpleName());
    }

    private static String hoja(Class<?> clase) {
        if (COMO_CADENA.contains(clase.getSimpleName())) {
            return TEXTO;
        }
        if (clase.isEnum()
                || CharSequence.class.isAssignableFrom(clase)
                || UUID.class.equals(clase)
                || char.class.equals(clase)
                || Character.class.equals(clase)) {
            return TEXTO;
        }
        if (LocalDate.class.equals(clase)) {
            return FECHA;
        }
        if (Instant.class.equals(clase)
                || OffsetDateTime.class.equals(clase)
                || LocalDateTime.class.equals(clase)
                || LocalTime.class.equals(clase)) {
            return INSTANTE;
        }
        if (boolean.class.equals(clase) || Boolean.class.equals(clase)) {
            return BOOLEANO;
        }
        if (int.class.equals(clase)
                || long.class.equals(clase)
                || short.class.equals(clase)
                || byte.class.equals(clase)
                || Integer.class.equals(clase)
                || Long.class.equals(clase)
                || Short.class.equals(clase)
                || Byte.class.equals(clase)
                || BigInteger.class.equals(clase)) {
            return ENTERO;
        }
        if (double.class.equals(clase)
                || float.class.equals(clase)
                || Double.class.equals(clase)
                || Float.class.equals(clase)
                || BigDecimal.class.equals(clase)) {
            return NUMERO;
        }
        if (void.class.equals(clase) || Void.class.equals(clase)) {
            return NADA;
        }
        if ("Resource".equals(clase.getSimpleName())
                || "StreamingResponseBody".equals(clase.getSimpleName())) {
            return ARCHIVO;
        }
        return OBJETO;
    }
}
