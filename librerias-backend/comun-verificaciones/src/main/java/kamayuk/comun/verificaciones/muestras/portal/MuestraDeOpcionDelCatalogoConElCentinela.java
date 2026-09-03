package kamayuk.comun.verificaciones.muestras.portal;

import kamayuk.comun.verificaciones.muestras.autorizacion.Privilegio;
import kamayuk.comun.verificaciones.muestras.autorizacion.RequiereAcceso;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Viola {@code EL_CENTINELA_DEL_CIUDADANO_SOLO_SIRVE_AL_PORTAL} a proposito (#57, ADR-0020).
 *
 * <p>Una opcion del catalogo —una consulta de ventanilla, con su ruta de siempre— anotada con el
 * centinela del ciudadano en vez de con el id de su opcion. El guardia lee eso como «no hay
 * privilegio que comprobar», asi que este endpoint se serviria <b>sin ninguna autorizacion
 * configurada</b>: ni un grupo, ni un permiso, ni una fila de {@code acceso} que alguien tuviera
 * que otorgar.
 *
 * <p>Que en ejecucion el guardia ademas exija venir de la cadena del ciudadano no lo salva: seria
 * un endpoint del catalogo inalcanzable para quien deberia usarlo y sin autorizacion que revisar, y
 * eso no se descubre revisando el codigo. Por eso rompe el build.
 */
@RestController
@RequestMapping("/api/v1/consultas/deuda")
public class MuestraDeOpcionDelCatalogoConElCentinela {

    @GetMapping
    @RequiereAcceso(acceso = RequiereAcceso.CIUDADANO, privilegio = Privilegio.LECTURA)
    public String deuda() {
        return "{}";
    }
}
