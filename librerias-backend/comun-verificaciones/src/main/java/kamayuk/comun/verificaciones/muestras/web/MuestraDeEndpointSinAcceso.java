package kamayuk.comun.verificaciones.muestras.web;

import kamayuk.comun.verificaciones.muestras.autorizacion.Privilegio;
import kamayuk.comun.verificaciones.muestras.autorizacion.RequiereAcceso;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Controlador de muestra con un endpoint que <b>no declara que acceso exige</b>.
 *
 * <p>Asi es como aparece el defecto: no como una decision de dejar algo abierto, sino como el
 * endpoint numero cuarenta escrito con prisa. Sin regla que lo cace, el sistema queda con una
 * puerta que nadie sabe que existe hasta que alguien la encuentra.
 *
 * <p>El segundo metodo esta declarado como debe, para que la regla demuestre que distingue: si
 * fallara tambien sobre el, seria una regla que no se puede cumplir y acabaria desactivada.
 */
@RestController
@SuppressWarnings("unused")
public class MuestraDeEndpointSinAcceso {

    /** Sin {@code @RequiereAcceso}: esto es lo que la regla tiene que cazar. */
    @GetMapping("/api/v1/muestra/sin-guardia")
    public String sinGuardia() {
        return "";
    }

    /** Con acceso declarado: la regla no debe quejarse de este. */
    @GetMapping("/api/v1/muestra/con-guardia")
    @RequiereAcceso(acceso = "muestra", privilegio = Privilegio.LECTURA)
    public String conGuardia() {
        return "";
    }
}
