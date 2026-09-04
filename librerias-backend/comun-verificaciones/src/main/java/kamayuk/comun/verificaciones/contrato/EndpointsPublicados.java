package kamayuk.comun.verificaciones.contrato;

import com.tngtech.archunit.core.domain.JavaClass;
import java.lang.reflect.Method;
import java.lang.reflect.Parameter;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import kamayuk.comun.verificaciones.ConfiguracionDeLasVerificaciones;
import kamayuk.comun.verificaciones.ReglasDeArquitectura;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Los endpoints que un backend publica, leidos de sus propios controladores.
 *
 * <p>Lo miran tres clases de prueba y por motivos distintos: el contrato de la API compara <b>que
 * rutas</b> hay, las formas comparan <b>que devuelve</b> cada una, y {@link
 * ContratoConElConsumidorTestBase} compara <b>que espera de ella otro repositorio</b>. Vive aparte
 * para que las tres lean el mismo recorrido: tres recorridos escritos por separado empiezan iguales
 * y acaban discrepando en el caso raro —un metodo sin verbo, dos mapeos sobre la misma ruta—, y
 * entonces una de las pruebas mide algo que las otras no ven.
 *
 * <p><b>Se movio a la libreria compartida en P6.</b> Antes era de {@code rentas}, que era el unico
 * repositorio con contrato; desde el corte los cuatro necesitan poder contestar «que publico yo»,
 * porque es la mitad del proveedor en toda prueba de contrato.
 */
public final class EndpointsPublicados {

    private EndpointsPublicados() {}

    /** La raiz que este repositorio declara en {@code ConfiguracionDeLasVerificaciones}. */
    public static String raiz() {
        return ConfiguracionDeLasVerificaciones.actual().raizDeLaApi();
    }

    /**
     * Cada operacion publicada —{@code «VERBO /ruta»}— con el metodo que la sirve.
     *
     * <p><b>Cuando dos metodos publican la misma operacion, gana el que no acota por parametro.</b>
     * Pasa en los cuatro repositorios: un controlador sirve un reporte en JSON y, con {@code params
     * = "formato"}, como archivo. La forma de la respuesta que importa es la primera —la del
     * archivo son bytes—, y quedarse con la que llegara antes por el orden en que el JDK devuelve
     * los metodos declarados haria que estas pruebas cambiaran de resultado sin que nadie tocara
     * nada.
     */
    public static Map<String, Method> porOperacion() {
        String raiz = raiz();
        Map<String, Method> publicadas = new TreeMap<>();
        for (JavaClass clase : ReglasDeArquitectura.clasesDeProduccion()) {
            Class<?> tipo = clase.reflect();
            if (!AnnotatedElementUtils.hasAnnotation(tipo, RestController.class)) {
                continue;
            }
            RequestMapping deLaClase =
                    AnnotatedElementUtils.findMergedAnnotation(tipo, RequestMapping.class);
            String base = deLaClase == null ? "" : primero(deLaClase.path());

            for (Method metodo : tipo.getDeclaredMethods()) {
                RequestMapping mapeo =
                        AnnotatedElementUtils.findMergedAnnotation(metodo, RequestMapping.class);
                if (mapeo == null) {
                    continue;
                }
                String ruta = sinRaiz(base + primero(mapeo.path()), raiz);
                for (RequestMethod verbo : verbos(mapeo)) {
                    String operacion = verbo.name() + " " + ruta;
                    Method anterior = publicadas.get(operacion);
                    if (anterior == null || acotaPorParametro(anterior)) {
                        publicadas.put(operacion, metodo);
                    }
                }
            }
        }
        return publicadas;
    }

    /** Las operaciones publicadas, sin su metodo. Es lo que compara el contrato. */
    public static Set<String> operaciones() {
        return new TreeSet<>(porOperacion().keySet());
    }

    /**
     * Los parametros de consulta que un endpoint LEE de verdad.
     *
     * <p>Lo que decide si un filtro llega no es la anotacion sino que el dato <b>no</b> este en el
     * {@code record} del cuerpo: Spring enlaza un {@code String} suelto por su nombre aunque no
     * lleve {@code @RequestParam} (medido en #431, y #539 lo invirtio al exigir que la guarda de
     * parametros pueda enumerarlos). Por eso aqui se cuentan las dos formas: el nombre declarado en
     * la anotacion y, si no lo declara, el nombre del parametro de Java —que existe porque los
     * cinco backends compilan con {@code -parameters}—.
     *
     * <p>Esto es lo que caza el desajuste que ninguna otra comprobacion ve: el consumidor manda
     * {@code ?aLaFecha=} y el proveedor lee {@code fecha}. La respuesta llega con 200, la tabla se
     * dibuja, y lo que se descarto en silencio es el criterio.
     */
    public static Set<String> parametrosDeConsulta(Method metodo) {
        Set<String> nombres = new TreeSet<>();
        for (Parameter parametro : metodo.getParameters()) {
            RequestParam anotacion =
                    AnnotatedElementUtils.findMergedAnnotation(parametro, RequestParam.class);
            if (anotacion != null) {
                String declarado =
                        anotacion.name().isEmpty() ? anotacion.value() : anotacion.name();
                nombres.add(declarado.isEmpty() ? parametro.getName() : declarado);
                continue;
            }
            // Sin anotacion, Spring solo enlaza por nombre los tipos simples; los objetos
            // compuestos —la paginacion— los compone campo a campo, y esos campos se
            // recogen abajo.
            if (esSimple(parametro.getType())) {
                nombres.add(parametro.getName());
                continue;
            }
            if (parametro.getType().isRecord()) {
                for (var componente : parametro.getType().getRecordComponents()) {
                    nombres.add(componente.getName());
                }
            }
        }
        // `params = "formato"` en el mapeo tambien es un parametro que el endpoint exige.
        RequestMapping mapeo =
                AnnotatedElementUtils.findMergedAnnotation(metodo, RequestMapping.class);
        if (mapeo != null) {
            for (String condicion : mapeo.params()) {
                nombres.add(condicion.split("[=!]", 2)[0].trim());
            }
        }
        return nombres;
    }

    private static boolean esSimple(Class<?> tipo) {
        return tipo.isPrimitive()
                || tipo.isEnum()
                || CharSequence.class.isAssignableFrom(tipo)
                || Number.class.isAssignableFrom(tipo)
                || Boolean.class.equals(tipo)
                || Character.class.equals(tipo)
                || java.time.temporal.Temporal.class.isAssignableFrom(tipo)
                || java.util.Optional.class.equals(tipo);
    }

    private static boolean acotaPorParametro(Method metodo) {
        RequestMapping mapeo =
                AnnotatedElementUtils.findMergedAnnotation(metodo, RequestMapping.class);
        return mapeo != null && mapeo.params().length > 0;
    }

    private static Set<RequestMethod> verbos(RequestMapping mapeo) {
        Set<RequestMethod> verbos = new LinkedHashSet<>(List.of(mapeo.method()));
        if (verbos.isEmpty()) {
            // Un mapeo sin verbo responde a todos; en el contrato eso no existe, y
            // dejarlo pasar en silencio esconderia un endpoint mal declarado.
            verbos.add(RequestMethod.GET);
        }
        return verbos;
    }

    private static String primero(String[] rutas) {
        return rutas.length == 0 ? "" : rutas[0];
    }

    private static String sinRaiz(String ruta, String raiz) {
        return ruta.startsWith(raiz) ? ruta.substring(raiz.length()) : ruta;
    }
}
