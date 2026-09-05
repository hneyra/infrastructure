package kamayuk.comun.verificaciones.muestras.catastro;

import java.time.LocalDate;
import kamayuk.comun.verificaciones.muestras.dominio.Observacion;

/**
 * Sustituto del repositorio por el que se ESCRIBE una version nueva de la ficha.
 *
 * <p>Es el camino corto —saltarse el puerto de la transferencia y llamar al repositorio— y lo unico
 * que la muestra necesita de el es que exista, se llame asi y tenga un metodo que escriba.
 */
public interface FichaCatastralRepository {

    /** Versiona la ficha del predio con el area corregida. */
    void versionar(long predioId, LocalDate desde, String areaTerreno, Observacion observacion);
}
