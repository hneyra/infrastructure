package kamayuk.comun.verificaciones.muestras.cuentacorriente;

import java.time.LocalDate;
import kamayuk.comun.verificaciones.muestras.dominio.Dinero;
import kamayuk.comun.verificaciones.muestras.dominio.Ejercicio;
import kamayuk.comun.verificaciones.muestras.dominio.Observacion;

/**
 * Sustituto del puerto comun por el que todo contexto que determina asienta (ARQ-01 §4 regla 2).
 *
 * <p>Dentro de fiscalizacion lo usa solo la transferencia: asentar deuda desde una pantalla de
 * liquidacion seria cobrar antes de haber notificado nada.
 */
public interface GeneradorDeCargos {

    void generarCargo(
            Ejercicio ejercicio,
            long contribuyenteId,
            String tributo,
            Dinero monto,
            LocalDate fecha,
            String sustento,
            Observacion observacion);
}
