package kamayuk.comun.verificaciones.muestras.portal;

import kamayuk.comun.verificaciones.muestras.compartido.TenantContext;
import kamayuk.comun.verificaciones.muestras.dominio.MunicipalidadId;
import org.springframework.stereotype.Service;

/**
 * Viola {@code SOLO_EL_RECORRIDO_MUEVE_EL_CONTEXTO_EN_WEB} a proposito (#57, ADR-0020 §2).
 *
 * <p>Un caso de uso del perfil por omision —o sea, del proceso que atiende peticiones— que fija el
 * contexto de municipalidad por su cuenta. Es exactamente la forma que tendria el defecto: alguien
 * necesita leer «la otra municipalidad» desde una pantalla, lo consigue en una linea, y a partir de
 * ahi la peticion sigue con el contexto cambiado.
 *
 * <p>Lo que no se ve: esto <b>no falla</b>. Las consultas siguen devolviendo filas, y las filas son
 * de verdad; lo que ya no es verdad es de quien son. Y como no limpia al salir, el resto de la
 * peticion —y la conexion, si el guardia del pool no estuviera— se lleva el contexto ajeno puesto.
 */
@Service
public class MuestraQueMueveElContextoEnWeb {

    /** Mira «la de al lado» sin ser el borde ni el recorrido, y sin perfil que lo confine. */
    public void mirarLaDeAlLado(long otra) {
        TenantContext.fijar(new MunicipalidadId(otra));
    }
}
