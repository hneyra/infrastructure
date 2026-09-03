package kamayuk.comun.verificaciones.muestras.catastro;

import java.time.LocalDate;
import kamayuk.comun.verificaciones.muestras.dominio.Observacion;

/**
 * Sustituto del puerto por el que se ESCRIBE en el padron: la version nueva de la ficha.
 *
 * <p>Es la puerta que ARQ-01 §3.5 llama la frontera delicada, y lo unico que la muestra necesita de
 * ella es que exista y tenga un metodo que escriba.
 */
public interface TransferenciaDeFiscalizacion {

    void inscribirLoHallado(
            long predioId, LocalDate fecha, String sustento, Observacion observacion);
}
