package kamayuk.comun.verificaciones.muestras.fiscalizacion;

import java.time.LocalDate;
import kamayuk.comun.verificaciones.muestras.catastro.FichaCatastralRepository;
import kamayuk.comun.verificaciones.muestras.catastro.TransferenciaDeFiscalizacion;
import kamayuk.comun.verificaciones.muestras.dominio.Observacion;

/**
 * Muestra que viola <b>a proposito</b> {@code NINGUN_HALLAZGO_CORRIGE_LA_FICHA} (ADR-0035 punto 4):
 * el hallazgo aplicando el area que verifico.
 *
 * <p>Asi es exactamente como se incumple, y no por descuido sino por lo contrario: la campania deja
 * cuatro mil hallazgos con su {@code diferencia_m2} ya calculada, alguien mira la cifra —que es
 * correcta— y le parece obvio «aplicarla». El resultado es un padron corregido <b>sin acto
 * administrativo detras</b>: el contribuyente no recibe papel, no hay plazo que impugnar, y el
 * autovaluo del distrito cambia sin que nadie lo haya decidido.
 *
 * <p>La forma correcta es la que ya existe y que esta muestra deliberadamente no usa: el hallazgo
 * firme <b>habilita</b> el acto, y el acto —versionar la ficha con su observacion obligatoria— lo
 * ejecuta una persona. Es la mitad de ADR-0021 que ADR-0035 no toca.
 *
 * <p>Lleva las dos formas del defecto porque son dos caminos distintos y la regla tiene que ver los
 * dos: por el puerto de la transferencia, que es el camino «legitimo» usado por quien no debe, y
 * por el repositorio, que es el atajo.
 *
 * <p>Vive en un paquete que termina en {@code fiscalizacion} y se llama {@code …Hallazgo…} para que
 * la regla la alcance: las dos condiciones son las que ADR-0035 usa para distinguir lo que la
 * maquina cree de lo que una persona firmo.
 */
@SuppressWarnings("unused")
public final class MuestraDeHallazgoQueCorrigeLaFicha {

    /** El puerto de la transferencia, en manos del hallazgo. */
    private final TransferenciaDeFiscalizacion padron;

    /** Y el atajo: el repositorio de la ficha, sin puerto de por medio. */
    private final FichaCatastralRepository fichas;

    public MuestraDeHallazgoQueCorrigeLaFicha(
            TransferenciaDeFiscalizacion padron, FichaCatastralRepository fichas) {
        this.padron = padron;
        this.fichas = fichas;
    }

    /** «Aplicar los hallazgos de la campania», que es como se dice en la reunion. */
    public void aplicarElAreaVerificada(
            long predioId, LocalDate fecha, String areaVerificada, Observacion observacion) {
        fichas.versionar(predioId, fecha, areaVerificada, observacion);
    }

    /** Y la variante que parece mas prudente porque pasa por el puerto, y no lo es. */
    public void inscribirLoQueSeHallo(long predioId, LocalDate fecha, Observacion observacion) {
        padron.inscribirLoHallado(predioId, fecha, "HALLAZGO", observacion);
    }
}
