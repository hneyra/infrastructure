package kamayuk.comun.verificaciones.muestras.catastro;

import java.time.LocalDate;
import java.util.List;

/**
 * Sustituto de un puerto de lectura de otro contexto.
 *
 * <p>No esta en {@code tiposAjenosQueFiscalizacionSoloLee()} <b>a proposito</b>: es lo que hace que
 * {@code MuestraQueTocaOtroContextoSinDeclararlo} viole la regla.
 */
public interface PrediosDelContribuyente {

    List<PredioDelContribuyente> de(long contribuyenteId, LocalDate fecha);
}
