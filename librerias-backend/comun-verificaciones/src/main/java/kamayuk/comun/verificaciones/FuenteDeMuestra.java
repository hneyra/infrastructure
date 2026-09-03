package kamayuk.comun.verificaciones;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;

/**
 * El texto de una clase de muestra, leido del jar y no del disco.
 *
 * <p>Los escaneres se demuestran sobre <b>archivos de verdad</b> y no sobre literales de la prueba:
 * un archivo lleva su javadoc, y ahi esta la mitad de la demostracion —si el escaner contara los
 * comentarios, {@code MuestraDeRepositorioQueBorra} daria seis hallazgos y no tres—.
 *
 * <p>Mientras las muestras vivian en el mismo modulo que la prueba, ese archivo se buscaba por su
 * ruta. Ahora viven en esta libreria y el repositorio que la consume <b>no tiene sus fuentes en el
 * disco</b>, asi que se empaquetan como recurso junto a las clases. No es un rodeo: es lo que hace
 * que la demostracion no dependa de donde este clonado nada.
 *
 * <p>El empaquetado lo hace {@code processResources} en el {@code build.gradle.kts} de la libreria.
 * Si alguien lo quita, esto falla nombrando el recurso que falta, que es exactamente lo que tiene
 * que pasar: una demostracion que no encuentra su muestra no es una demostracion que pasa.
 */
public record FuenteDeMuestra(String nombre, String texto) {

    private static final String RAIZ = "/fuentes-de-muestra/";

    /**
     * La muestra, por su ruta dentro del paquete {@code muestras}: {@code
     * "infraestructura/MuestraDeRepositorioQueBorra.java"}.
     */
    public static FuenteDeMuestra de(String rutaRelativa) {
        String recurso = RAIZ + rutaRelativa;
        try (InputStream entrada = FuenteDeMuestra.class.getResourceAsStream(recurso)) {
            if (entrada == null) {
                throw new IllegalStateException(
                        "No esta el recurso "
                                + recurso
                                + " en el jar de comun-verificaciones. Sin el, el escaner no tiene"
                                + " sobre que demostrarse: lo empaqueta processResources, y si se"
                                + " quito, la demostracion dejo de existir");
            }
            String texto = new String(entrada.readAllBytes(), StandardCharsets.UTF_8);
            int ultimaBarra = rutaRelativa.lastIndexOf('/');
            return new FuenteDeMuestra(rutaRelativa.substring(ultimaBarra + 1), texto);
        } catch (IOException e) {
            throw new UncheckedIOException("No se pudo leer " + recurso, e);
        }
    }
}
