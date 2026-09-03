package kamayuk.comun.verificaciones.muestras.fiscalizacion;

import java.time.LocalDate;
import kamayuk.comun.verificaciones.muestras.catastro.TransferenciaDeFiscalizacion;
import kamayuk.comun.verificaciones.muestras.cuentacorriente.GeneradorDeCargos;
import kamayuk.comun.verificaciones.muestras.dominio.Dinero;
import kamayuk.comun.verificaciones.muestras.dominio.Ejercicio;
import kamayuk.comun.verificaciones.muestras.dominio.Observacion;

/**
 * Muestra que viola <b>a proposito</b> la primera mitad de {@code
 * SOLO_LA_TRANSFERENCIA_ESCRIBE_FUERA_DE_FISCALIZACION} (#52, AC 1): escribir en el padron y en el
 * libro desde una clase de {@code fiscalizacion} que no es la transferencia.
 *
 * <p>Asi es como se incumple, y es la salida corta de un problema real. Alguien liquida, ve que el
 * area hallada difiere, y le parece obvio dejar el catastro al dia en el mismo acto —«total, es un
 * campo»—. Lo que produce es una version de ficha inscrita sin resolucion que la justifique: el
 * contribuyente no recibe papel, no hay plazo que impugnar, y la deuda que se le asienta no tiene
 * un acto administrativo detras. Es exactamente lo que ARQ-01 §3.5 llama la frontera delicada, y lo
 * que esta regla existe para que no ocurra por descuido.
 *
 * <p>Vive en un paquete que termina en {@code fiscalizacion} para que la regla —acotada a {@code
 * ..fiscalizacion..}— la alcance, igual que {@code muestras.aplicacion} alcanza a la regla de la
 * observacion obligatoria. Esta en {@code src/test}, asi que no puede llegar al artefacto.
 */
@SuppressWarnings("unused")
public final class MuestraQueEscribeEnElPadronSinSerLaTransferencia {

    /** La puerta del padron, en manos de quien no es la transferencia. */
    private final TransferenciaDeFiscalizacion padron;

    /** Y la del libro, en las mismas manos: el cargo antes de que exista el papel. */
    private final GeneradorDeCargos cargos;

    public MuestraQueEscribeEnElPadronSinSerLaTransferencia(
            TransferenciaDeFiscalizacion padron, GeneradorDeCargos cargos) {
        this.padron = padron;
        this.cargos = cargos;
    }

    /** «Dejar el catastro al dia» al liquidar, sin resolucion ni sustento. */
    public void inscribirLoHalladoAlPaso(long predioId, LocalDate fecha, Observacion observacion) {
        padron.inscribirLoHallado(predioId, fecha, "AL PASO", observacion);
    }

    /** Y asentar la deuda antes de notificar nada. */
    public void cobrarAntesDeNotificar(
            Ejercicio ejercicio,
            long contribuyenteId,
            Dinero monto,
            LocalDate fecha,
            Observacion observacion) {
        cargos.generarCargo(
                ejercicio, contribuyenteId, "PREDIAL", monto, fecha, "AL PASO", observacion);
    }
}
