package kamayuk.comun.verificaciones.contrato;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * La mitad del PROVEEDOR de una prueba de contrato entre repositorios (ADR-0030 §4).
 *
 * <p>Lee lo que un consumidor publico —{@code <consumidor>/docs/50-api/contratos-que-consume/
 * <este-sistema>.json}— y comprueba que este backend lo sigue cumpliendo: que publica cada
 * operacion, que su respuesta contiene cada campo que el otro lee, y que <b>lee</b> cada parametro
 * de consulta que el otro manda.
 *
 * <p><b>Vive aqui y no en el consumidor, y esa es toda la gracia.</b> Si el CI que se pone rojo es
 * el del consumidor, el aviso le llega a quien no rompio nada y quien rompio algo integra en verde.
 * Puesta del lado del proveedor, romper la respuesta pone rojo el build de quien la rompio, en el
 * PR que la rompe.
 *
 * <h2>Los desajustes que ya estaban, y por que hay una lista</h2>
 *
 * <p>Estas pruebas nacieron rojas, y no por un cambio: las fronteras ya estaban rotas y no habia
 * nada que pudiera verlo. Un rojo permanente es la forma segura de que nadie vuelva a mirar una
 * prueba, asi que lo que ya estaba roto entra en {@link #desajustesVivos()} — una entrada por
 * desajuste, con su texto exacto. La lista tiene las dos direcciones cerradas:
 *
 * <ul>
 *   <li>un desajuste que no este en la lista pone el build rojo — <b>no puede crecer en
 *       silencio</b>;
 *   <li>una entrada de la lista que ya no ocurre tambien lo pone rojo — <b>no puede quedarse
 *       rancia</b>, que es como una lista de pendientes deja de describir nada.
 * </ul>
 *
 * <p>Es el mismo mecanismo que {@code CrucesConsentidos} uso para el SQL que cruzaba la frontera, y
 * por el mismo motivo: con la lista a cero, un desajuste nuevo no tiene donde esconderse.
 */
public abstract class ContratoConElConsumidorTestBase {

    /** El repositorio que publica el contrato: el nombre de su clon, hermano de este. */
    protected abstract String consumidor();

    /** Como se llama este sistema en el archivo del consumidor. */
    protected abstract String proveedor();

    /**
     * Los desajustes que ya existian cuando esta prueba se escribio, uno por linea exacta.
     *
     * <p>Cada entrada es deuda con nombre. Cerrarla es quitar la linea y ver el verde; dejarla
     * cuando ya no ocurre pone el build rojo, que es lo que impide que la lista envejezca.
     */
    protected Set<String> desajustesVivos() {
        return Set.of();
    }

    /**
     * Las operaciones cuyo cuerpo de respuesta este backend serializa A MANO.
     *
     * <p>Un endpoint que devuelve {@code ResponseEntity<String>} —porque calcula su propio {@code
     * ETag}, como el snapshot sellado de {@code normativa}— tiene «texto» por tipo de retorno, y
     * eso no describe nada. Aqui el proveedor declara <b>que tipo escribe de verdad</b>, y la
     * comprobacion vuelve a poder ver dentro.
     *
     * <p>No es una puerta para sobrescribir la forma real: {@link
     * #laDeclaracionDeCuerposEscritosAManoEsLegitima()} exige que la operacion exista y que su tipo
     * de retorno sea de verdad una cadena. Declarar aqui un endpoint que devuelve su {@code
     * Resource} normalmente pondria el build rojo, porque seria una forma de decir que publica algo
     * que no publica.
     */
    protected Map<String, Class<?>> respuestasSerializadasAMano() {
        return Map.of();
    }

    @Test
    @DisplayName("este backend cumple lo que su consumidor espera de el")
    void cumpleLoQueSuConsumidorEspera() {
        ContratoDelConsumidor contrato = ContratoDelConsumidor.leer(archivoDelConsumidor());

        assertThat(contrato.proveedor())
                .as(
                        "el archivo de «%s» dice que es el contrato con «%s», y esta prueba es de"
                                + " «%s»",
                        consumidor(), contrato.proveedor(), proveedor())
                .isEqualTo(proveedor());

        assertThat(contrato.raiz())
                .as(
                        "el consumidor pide bajo «%s» y este backend publica bajo «%s»: ninguna"
                                + " ruta coincidiria",
                        contrato.raiz(), EndpointsPublicados.raiz())
                .isEqualTo(EndpointsPublicados.raiz());

        assertThat(contrato.operaciones())
                .as("un contrato sin operaciones no puede fallar, asi que no comprueba nada")
                .isNotEmpty();

        Map<String, Method> publicadas = EndpointsPublicados.porOperacion();
        List<String> hallazgos = new ArrayList<>();

        for (Map.Entry<String, ContratoDelConsumidor.OperacionEsperada> esperada :
                new TreeMap<>(contrato.operaciones()).entrySet()) {

            String operacion = esperada.getKey();
            Method metodo = publicadas.get(operacion);
            if (metodo == null) {
                hallazgos.add(
                        operacion
                                + ": este backend no publica esa operacion. Publica "
                                + rutasParecidas(operacion, publicadas.keySet())
                                + ".");
                continue;
            }
            Class<?> aMano = respuestasSerializadasAMano().get(operacion);
            Object forma =
                    aMano == null
                            ? FormaDeLaRespuesta.de(metodo)
                            : FormaDeLaRespuesta.deTipo(aMano);

            hallazgos.addAll(
                    ContratoDelConsumidor.desajustes(
                            operacion,
                            esperada.getValue(),
                            forma,
                            cuerpoQueAcepta(metodo),
                            EndpointsPublicados.parametrosDeConsulta(metodo)));
        }

        Set<String> vivos = desajustesVivos();
        Set<String> nuevos = new TreeSet<>(hallazgos);
        nuevos.removeAll(vivos);

        assertThat(nuevos)
                .as(
                        "«%s» dejo de cumplir lo que «%s» espera de el. El consumidor no puede"
                                + " verlo: su peticion sigue saliendo y su respuesta sigue llegando"
                                + " con 200.",
                        proveedor(), consumidor())
                .isEmpty();

        Set<String> rancios = new TreeSet<>(vivos);
        hallazgos.forEach(rancios::remove);

        assertThat(rancios)
                .as(
                        "estos desajustes ya NO ocurren y siguen declarados vivos en"
                                + " %s.desajustesVivos(). Una lista de pendientes con entradas"
                                + " rancias deja de describir nada: hay que quitar la linea.",
                        getClass().getSimpleName())
                .isEmpty();
    }

    /**
     * Que declara este endpoint como cuerpo aceptado: la forma del {@code record} de su
     * {@code @RequestBody}, o vacio si no recibe ninguno.
     *
     * <p>Lo que hace util comparar esto es que Jackson <b>descarta en silencio</b> lo que el {@code
     * record} no declara: los cuatro backends tienen {@code FAIL_ON_UNKNOWN_PROPERTIES} apagado, y
     * endurecerlo cambiaria el borde de todas las operaciones con cuerpo a la vez (#538, #539). Asi
     * que un campo que el emisor manda y el receptor no declara se pierde <b>con 201 de vuelta</b>:
     * las dos partes creen que llego.
     */
    private static Object cuerpoQueAcepta(Method metodo) {
        for (java.lang.reflect.Parameter parametro : metodo.getParameters()) {
            if (org.springframework.core.annotation.AnnotatedElementUtils.hasAnnotation(
                    parametro, org.springframework.web.bind.annotation.RequestBody.class)) {
                return FormaDeLaRespuesta.deTipo(parametro.getType());
            }
        }
        return Map.of();
    }

    /**
     * Lo declarado en {@link #respuestasSerializadasAMano()} tiene que ser legitimo.
     *
     * <p>El contraste que impide que ese gancho sea una puerta trasera: una entrada para una
     * operacion que no existe, o para una que ya devuelve su {@code Resource}, seria una forma de
     * declarar que este backend publica algo que no publica — y la prueba de contrato pasaria en
     * verde afirmandolo.
     */
    @Test
    @DisplayName("y lo que declara serializar a mano existe y de verdad devuelve texto")
    void laDeclaracionDeCuerposEscritosAManoEsLegitima() {
        Map<String, Method> publicadas = EndpointsPublicados.porOperacion();
        for (Map.Entry<String, Class<?>> declarada : respuestasSerializadasAMano().entrySet()) {
            Method metodo = publicadas.get(declarada.getKey());
            assertThat(metodo)
                    .as("«%s» no es una operacion de este backend", declarada.getKey())
                    .isNotNull();
            assertThat(FormaDeLaRespuesta.de(metodo))
                    .as(
                            "«%s» ya devuelve una forma que se puede leer del tipo de retorno:"
                                    + " declararla aqui la sustituiria por otra, y entonces esta prueba"
                                    + " afirmaria algo que el backend no publica",
                            declarada.getKey())
                    .isEqualTo(FormaDeLaRespuesta.TEXTO);
        }
    }

    /** El archivo que el consumidor publica para este proveedor. */
    protected Path archivoDelConsumidor() {
        return raizDeLosClones()
                .resolve(consumidor())
                .resolve("docs/50-api/contratos-que-consume")
                .resolve(proveedor() + ".json");
    }

    /**
     * El directorio que contiene los clones, que son hermanos.
     *
     * <p>La misma convencion que {@code settings.gradle.kts} de los cinco backends asume para
     * {@code librerias-backend}. Se sube desde el directorio de trabajo hasta el clon de este
     * repositorio —el que tiene {@code .git}— y se toma su padre.
     */
    protected static Path raizDeLosClones() {
        Path actual = Path.of("").toAbsolutePath();
        while (actual != null) {
            if (Files.isDirectory(actual.resolve(".git"))
                    || Files.isRegularFile(actual.resolve(".git"))) {
                Path padre = actual.getParent();
                if (padre == null) {
                    throw new IllegalStateException(
                            "El clon de este repositorio esta en la raiz del sistema de archivos, "
                                    + "asi que no tiene hermanos donde buscar al consumidor.");
                }
                return padre;
            }
            actual = actual.getParent();
        }
        throw new IllegalStateException(
                "No se encontro un directorio con «.git» subiendo desde «"
                        + Path.of("").toAbsolutePath()
                        + "», asi que no se sabe donde estan los clones hermanos.");
    }

    /** Las rutas publicadas que mas se parecen a la pedida, para que el rojo oriente. */
    private static Set<String> rutasParecidas(String operacion, Set<String> publicadas) {
        String cola = operacion.substring(operacion.lastIndexOf('/') + 1);
        Set<String> parecidas = new TreeSet<>();
        for (String publicada : publicadas) {
            if (!cola.isEmpty() && publicada.contains(cola)) {
                parecidas.add(publicada);
            }
        }
        return parecidas.isEmpty() ? new TreeSet<>(publicadas) : parecidas;
    }
}
