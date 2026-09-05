package kamayuk.comun.verificaciones.muestras.web;

import java.util.List;
import kamayuk.comun.verificaciones.muestras.autorizacion.Privilegio;
import kamayuk.comun.verificaciones.muestras.autorizacion.RequiereAcceso;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Controlador de muestra que viola <b>a proposito</b> {@code TODA_GEOMETRIA_ENTRA_POR_BATCH}
 * (ADR-0021): recibe geometria por la peticion.
 *
 * <p>Asi es como aparece el defecto, y viene de una peticion razonable: el tecnico quiere corregir
 * el lote desde el visor sin esperar a la siguiente carga. Lo que produce es que el area del predio
 * pase a poder cambiarla quien tenga el endpoint —sin brigada, sin plano y sin acta—, que es
 * exactamente lo que ADR-0021 impide cuando se niega a derivar el area del poligono: un area es
 * indistinguible de otra al leerla, y detras de ella va el autovaluo de todo el padron.
 *
 * <p>Lleva las <b>tres</b> formas en que la geometria entra, porque son tres caminos y la regla
 * tiene que ver los tres: el cuerpo con un componente que la nombra, el parametro de consulta con
 * el WKT dentro, y el tipo que ya es geometria de por si.
 *
 * <p>Y lleva ademas los dos contrastes que impiden que la regla muerda de mas: un {@code bbox} y un
 * {@code marco}, que es la forma que ADR-0034 <b>obliga</b> a usar para pedir una tesela, y una
 * respuesta con geometria dentro, que es el producto del visor (ADR-0022, ADR-0037). Si la regla
 * marcara cualquiera de los dos, estaria prohibiendo lo unico correcto.
 */
@RestController
@RequiereAcceso(acceso = "muestra_plano", privilegio = Privilegio.MODIFICACION)
@SuppressWarnings("unused")
public class MuestraDeControladorQueRecibeGeometria {

    /** Viola la regla: el poligono entra en el cuerpo de la peticion. */
    @PostMapping("/api/v1/muestra/plano/lote")
    public void corregirElLote(@RequestBody LoteCorregido lote) {
        // La correccion se guardaria aqui, sin plano y sin acta.
    }

    /** Y la viola tambien por parametro de consulta: el mismo dato, otra puerta. */
    @PostMapping("/api/v1/muestra/plano/lote-rapido")
    public void corregirElLoteRapido(@RequestParam("wkt") String geometriaDelLote) {
        // Igual de grave, y mas facil de escribir.
    }

    /** Y con el tipo, que es la forma que menos disimula. */
    @PostMapping("/api/v1/muestra/plano/lote-tipado")
    public void corregirElLoteTipado(MultiPolygon poligono) {
        // Ni siquiera hace falta que el parametro se llame de ninguna manera.
    }

    /**
     * El contraste: pedir una tesela por su marco. La regla NO debe quejarse de este.
     *
     * <p>Es la forma que ADR-0034 obliga a usar, asi que marcarla seria prohibir la unica manera
     * correcta de hacer la consulta que el visor necesita.
     */
    @GetMapping("/api/v1/muestra/plano/lotes")
    public PlanoDeMuestra lotes(
            @RequestParam("bbox") String bbox, @RequestParam("marcoOeste") double marcoOeste) {
        return new PlanoDeMuestra(List.of());
    }

    /** El cuerpo con el poligono dentro: el camino que la regla existe para cerrar. */
    public record LoteCorregido(long predioId, String geometria, String observacion) {}

    /** Y el tipo que es geometria de por si. */
    public record MultiPolygon(String valor) {}

    /**
     * El segundo contraste: la geometria SALIENDO.
     *
     * <p>Publicar el plano es el producto del visor. La regla mira lo que entra y no lo que sale, y
     * esta clase es lo que lo demuestra: si se quejara de esta, ADR-0022 seria inimplementable.
     */
    public record PlanoDeMuestra(List<String> geometrias) {}
}
