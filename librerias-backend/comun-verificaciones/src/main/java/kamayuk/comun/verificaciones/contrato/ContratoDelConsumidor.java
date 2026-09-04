package kamayuk.comun.verificaciones.contrato;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * Lo que un repositorio espera de la API de otro. El contrato del consumidor.
 *
 * <h2>Que sustituye, y por que hacia falta</h2>
 *
 * <p>Mientras los doce contextos vivian en un monolito, cambiar la firma de un puerto entre dos de
 * ellos ponia rojo el build: lo decia el compilador. Con cuatro repositorios eso ya no pasa. El
 * cliente HTTP de {@code rentas} sigue pidiendo {@code ?aLaFecha=} aunque {@code catastro} lea
 * {@code fecha}, y no falla al compilar ni al desplegar — falla en integracion, semanas despues, y
 * el sintoma no se parece a la causa: la respuesta llega con 200 y la tabla se dibuja con el
 * criterio descartado en silencio.
 *
 * <p>Esto es la red que sustituye al compilador, y su reparto es el que ADR-0030 §4 fija: <b>el
 * consumidor publica lo que espera; el proveedor falla en CI si deja de cumplirlo</b>. La prueba
 * vive del lado del proveedor a proposito. Puesta del lado del consumidor mediria dos archivos del
 * mismo repositorio —lo que P5E §6.3 se nego a escribir, «se prefiere no tener guarda a tener una
 * que no puede fallar»—, y sobre todo el rojo le llegaria a quien no rompio nada.
 *
 * <h2>Por que un archivo comprometido y no una llamada entre los dos</h2>
 *
 * <p>Por lo mismo que {@code formas-de-la-api.json} (#400): los dos lados son dos builds distintos
 * y no comparten proceso. El archivo es la frontera, y tiene el mismo trato que el contrato de la
 * API (#312) — <b>no se edita a mano</b>: lo produce el consumidor de su propio adaptador, y su
 * prueba exige que siga siendo lo que el generador produce.
 *
 * <h2>Que se compara, y en que direccion</h2>
 *
 * <p>La relacion es de <b>contencion</b>, no de igualdad, y la direccion importa: el proveedor
 * puede publicar mas campos de los que el consumidor lee —anadir uno no rompe a nadie—, pero no
 * menos. Y todo parametro de consulta que el consumidor manda tiene que ser uno que el proveedor
 * <b>lea</b>: un parametro que viaja y se descarta es el defecto que #539 midio, con el padron
 * entero devuelto ante un nombre mal escrito.
 */
public record ContratoDelConsumidor(
        String consumidor,
        String proveedor,
        String raiz,
        Map<String, OperacionEsperada> operaciones) {

    /**
     * Lo que el consumidor espera de una operacion.
     *
     * @param parametros los de consulta que manda, y que el proveedor tiene que LEER
     * @param respuesta lo que lee del cuerpo devuelto. Vacio si no lee ninguno
     * @param cuerpo lo que MANDA en el cuerpo, y que el proveedor tiene que ACEPTAR. Vacio si no
     *     manda ninguno. Un campo que el {@code record} del {@code @RequestBody} no declara lo
     *     descarta Jackson en silencio (`FAIL_ON_UNKNOWN_PROPERTIES` esta apagado en los cuatro), y
     *     el emisor recibe 201: el dato se pierde y las dos partes creen que llego
     */
    public record OperacionEsperada(Set<String> parametros, Object respuesta, Object cuerpo) {

        /** Una lectura: manda parametros y lee la respuesta. */
        public static OperacionEsperada lectura(Set<String> parametros, Object respuesta) {
            return new OperacionEsperada(parametros, respuesta, Map.of());
        }

        /** Una escritura cuya respuesta no se lee: solo importa que el cuerpo se acepte. */
        public static OperacionEsperada escritura(Object cuerpo) {
            return new OperacionEsperada(Set.of(), Map.of(), cuerpo);
        }
    }

    /** La primera clave del archivo dice de donde sale. JSON no tiene comentarios. */
    public static final String PROCEDENCIA =
            "ARCHIVO GENERADO — no editar a mano. Lo publica el CONSUMIDOR con lo que su adaptador"
                    + " pide y lee de verdad; lo comprueba el PROVEEDOR en su propio CI (ADR-0030"
                    + " §4). Un campo que el proveedor deje de publicar, o un parametro que deje de"
                    + " leer, pone rojo el build del proveedor y no el del consumidor: es lo que"
                    + " sustituye a lo que hacia el compilador cuando los contextos compartian"
                    + " repositorio.";

    private static final ObjectMapper JSON = new ObjectMapper();

    /** Lee el contrato que un consumidor publico. Lanza nombrando el archivo si no esta. */
    public static ContratoDelConsumidor leer(Path archivo) {
        if (!Files.exists(archivo)) {
            throw new IllegalStateException(
                    "No esta «"
                            + archivo
                            + "», asi que no se puede comprobar que este backend siga cumpliendo lo"
                            + " que su consumidor espera.\n"
                            + "  Los clones son hermanos: el CI del proveedor tiene que hacer"
                            + " checkout del repositorio del consumidor (P5C hueco 5).\n"
                            + "  Esta comprobacion NO se salta: una prueba de contrato que no"
                            + " encuentra su contrato y pasa en verde es peor que ninguna.");
        }
        try {
            JsonNode raiz = JSON.readTree(Files.readString(archivo, StandardCharsets.UTF_8));
            Map<String, OperacionEsperada> operaciones = new TreeMap<>();
            JsonNode declaradas = raiz.path("operaciones");
            declaradas
                    .fieldNames()
                    .forEachRemaining(
                            operacion -> {
                                JsonNode nodo = declaradas.path(operacion);
                                Set<String> parametros = new TreeSet<>();
                                nodo.path("parametros").forEach(p -> parametros.add(p.asText()));
                                operaciones.put(
                                        operacion,
                                        new OperacionEsperada(
                                                Set.copyOf(parametros),
                                                forma(nodo.path("respuesta")),
                                                forma(nodo.path("cuerpo"))));
                            });
            return new ContratoDelConsumidor(
                    raiz.path("consumidor").asText(),
                    raiz.path("proveedor").asText(),
                    raiz.path("raiz").asText(),
                    Map.copyOf(operaciones));
        } catch (IOException fallo) {
            throw new UncheckedIOException("No se pudo leer «" + archivo + "»", fallo);
        }
    }

    /** El JSON de este contrato, listo para comprometer. Estable: las claves van ordenadas. */
    public String comoJson() {
        Map<String, Object> documento = new LinkedHashMap<>();
        documento.put("PROCEDENCIA", PROCEDENCIA);
        documento.put("consumidor", consumidor);
        documento.put("proveedor", proveedor);
        documento.put("raiz", raiz);

        Map<String, Object> declaradas = new TreeMap<>();
        operaciones.forEach(
                (operacion, esperada) -> {
                    Map<String, Object> nodo = new LinkedHashMap<>();
                    nodo.put("parametros", new TreeSet<>(esperada.parametros()));
                    nodo.put("respuesta", esperada.respuesta());
                    nodo.put("cuerpo", esperada.cuerpo());
                    declaradas.put(operacion, nodo);
                });
        documento.put("operaciones", declaradas);

        try {
            return JSON.writerWithDefaultPrettyPrinter().writeValueAsString(documento) + "\n";
        } catch (IOException fallo) {
            throw new UncheckedIOException("No se pudo escribir el contrato", fallo);
        }
    }

    // ------------------------------------------------------------------

    /**
     * Los desajustes entre lo que el consumidor espera de una operacion y lo que el proveedor
     * publica. Lista vacia si cumple.
     *
     * <p>Cada linea empieza por la operacion para que el rojo se pueda leer sin abrir el archivo, y
     * dice <b>que</b> falta, no solo que algo no cuadra: «falta el campo `contenido[].fichaId`»
     * manda a un sitio; «no cumple el contrato» no manda a ninguno.
     */
    public static List<String> desajustes(
            String operacion,
            OperacionEsperada esperada,
            Object formaPublicada,
            Object cuerpoQueAcepta,
            Set<String> parametrosQueLee) {

        List<String> hallazgos = new ArrayList<>();
        comparar(operacion, "", "lee", esperada.respuesta(), formaPublicada, hallazgos);
        comparar(operacion, "(el cuerpo)", "manda", esperada.cuerpo(), cuerpoQueAcepta, hallazgos);

        for (String parametro : new TreeSet<>(esperada.parametros())) {
            if (!parametrosQueLee.contains(parametro)) {
                hallazgos.add(
                        operacion
                                + ": el consumidor manda «"
                                + parametro
                                + "» y este endpoint no lo lee (lee "
                                + new TreeSet<>(parametrosQueLee)
                                + "). Viaja en la URL y se descarta en silencio.");
            }
        }
        return hallazgos;
    }

    private static void comparar(
            String operacion,
            String camino,
            String queHace,
            Object espera,
            Object publica,
            List<String> hallazgos) {

        if (espera instanceof Map<?, ?> objetoEsperado) {
            if (!(publica instanceof Map<?, ?> objetoPublicado)) {
                hallazgos.add(
                        operacion
                                + ": en «"
                                + (camino.isEmpty() ? "(la respuesta)" : camino)
                                + "» el consumidor espera un objeto y este endpoint publica «"
                                + publica
                                + "».");
                return;
            }
            for (Map.Entry<?, ?> campo : objetoEsperado.entrySet()) {
                String nombre = String.valueOf(campo.getKey());
                String bajo = camino.isEmpty() ? nombre : camino + "." + nombre;
                Object publicado = objetoPublicado.get(nombre);
                if (publicado == null) {
                    hallazgos.add(
                            operacion
                                    + ": falta el campo «"
                                    + bajo
                                    + "», que el consumidor "
                                    + queHace
                                    + ". Este endpoint declara "
                                    + new TreeSet<>(
                                            objetoPublicado.keySet().stream()
                                                    .map(String::valueOf)
                                                    .toList())
                                    + ".");
                    continue;
                }
                comparar(operacion, bajo, queHace, campo.getValue(), publicado, hallazgos);
            }
            return;
        }

        if (espera instanceof List<?> listaEsperada) {
            if (!(publica instanceof List<?> listaPublicada)) {
                hallazgos.add(
                        operacion
                                + ": en «"
                                + (camino.isEmpty() ? "(la respuesta)" : camino)
                                + "» el consumidor espera una lista y este endpoint publica «"
                                + publica
                                + "».");
                return;
            }
            if (!listaEsperada.isEmpty() && !listaPublicada.isEmpty()) {
                comparar(
                        operacion,
                        camino + "[]",
                        queHace,
                        listaEsperada.get(0),
                        listaPublicada.get(0),
                        hallazgos);
            }
            return;
        }

        if (!String.valueOf(espera).equals(String.valueOf(publica))) {
            hallazgos.add(
                    operacion
                            + ": el campo «"
                            + camino
                            + "» es «"
                            + publica
                            + "» y el consumidor lo "
                            + queHace
                            + " como «"
                            + espera
                            + "».");
        }
    }

    /** El arbol de formas tal como lo produce {@link FormaDeLaRespuesta}, leido del JSON. */
    private static Object forma(JsonNode nodo) {
        if (nodo.isObject()) {
            Map<String, Object> objeto = new LinkedHashMap<>();
            nodo.fieldNames().forEachRemaining(campo -> objeto.put(campo, forma(nodo.path(campo))));
            return objeto;
        }
        if (nodo.isArray()) {
            List<Object> lista = new ArrayList<>();
            nodo.forEach(elemento -> lista.add(forma(elemento)));
            return lista;
        }
        return nodo.asText();
    }
}
