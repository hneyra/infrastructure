package kamayuk.comun.verificaciones.muestras.web;

import java.time.LocalDate;
import kamayuk.comun.verificaciones.muestras.dominio.Dinero;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Controlador de muestra que viola <b>a proposito</b> las dos reglas de la capa web.
 *
 * <p>La primera, aceptando la municipalidad como parametro de consulta. Asi es como aparece el
 * defecto en la realidad: no como un {@code MunicipalidadId} en la firma —eso ya lo caza otra
 * regla— sino como un {@code long} anotado, anadido para probar algo con curl y nunca retirado. Si
 * llegara a produccion, cualquiera leeria la deuda de otra municipalidad cambiando un numero en la
 * barra de direcciones.
 *
 * <p>La segunda, devolviendo un importe sin decir a que fecha esta actualizado.
 */
@RestController
@SuppressWarnings("unused")
public class MuestraDeControladorQueRecibeLaMunicipalidad {

    /** Viola la regla 2: el identificador de municipalidad entra desde el cliente. */
    @GetMapping("/api/v1/muestra/deuda")
    public DeudaSinFecha consultar(@RequestParam("municipalidadId") long municipalidadId) {
        return new DeudaSinFecha(Dinero.CERO);
    }

    /** Viola la regla 9: un importe suelto, sin la fecha a la que corresponde. */
    public record DeudaSinFecha(Dinero total) {}

    /** Asi si: el importe y su fecha van juntos. La regla no debe quejarse de este. */
    public record DeudaConFecha(Dinero total, LocalDate actualizadoA) {}
}
