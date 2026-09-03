package kamayuk.comun.verificaciones.muestras.web;

import java.util.Optional;
import kamayuk.comun.verificaciones.muestras.autorizacion.Privilegio;
import kamayuk.comun.verificaciones.muestras.autorizacion.RequiereAcceso;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Controlador de muestra que <b>sostiene un repositorio</b> y lo consulta.
 *
 * <p>Asi es como aparece el defecto, y por eso costo catorce rutas contestando {@code 500}: no como
 * una decision, sino como la lectura mas obvia del mundo —el controlador tiene el repositorio
 * delante y le pregunta—. Compila, pasa el lint, y las pruebas de capa web lo dan por bueno porque
 * usan un doble.
 *
 * <p>Lo que ocurre en produccion es que la consulta corre <b>fuera de transaccion</b>: sin {@code
 * SET LOCAL app.municipalidad_id}, la politica RLS falla con «invalid input syntax for type bigint:
 * ""» y la peticion es un 500.
 *
 * <p>El segundo campo esta como debe —un caso de uso—, para que la regla demuestre que distingue:
 * si fallara tambien sobre el, seria una regla que no se puede cumplir.
 */
@RestController
@SuppressWarnings("unused")
public class MuestraDeControladorConRepositorio {

    /** Esto es lo que la regla tiene que cazar. */
    private final MuestraRepository repositorio;

    /** Y esto es lo correcto: la consulta vive en un caso de uso que abre la transaccion. */
    private final MuestraDeConsulta consulta;

    public MuestraDeControladorConRepositorio(
            MuestraRepository repositorio, MuestraDeConsulta consulta) {
        this.repositorio = repositorio;
        this.consulta = consulta;
    }

    @GetMapping("/api/v1/muestra/con-repositorio")
    @RequiereAcceso(acceso = "muestra", privilegio = Privilegio.LECTURA)
    public String leerMal() {
        return repositorio.porCodigo("X").orElse("");
    }

    @GetMapping("/api/v1/muestra/con-consulta")
    @RequiereAcceso(acceso = "muestra", privilegio = Privilegio.LECTURA)
    public String leerBien() {
        return consulta.porCodigo("X").orElse("");
    }

    /**
     * El puerto de persistencia.
     *
     * <p>Se llama {@code MuestraRepository} y no «MuestraDeRepositorio» porque la regla mira el
     * sufijo {@code Repository}, que es como se nombran los puertos de verdad (ADR-0004: dominio en
     * español, patrón en inglés). Escribirlo en español dejó la regla en verde la primera vez que
     * se midió: la muestra no era una muestra.
     */
    public interface MuestraRepository {
        Optional<String> porCodigo(String codigo);
    }

    /** El caso de uso que lo envuelve; en produccion lleva su {@code @Transactional}. */
    public interface MuestraDeConsulta {
        Optional<String> porCodigo(String codigo);
    }
}
