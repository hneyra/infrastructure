package kamayuk.comun.verificaciones.muestras.aplicacion;

import kamayuk.comun.verificaciones.muestras.dominio.Observacion;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Caso de uso de muestra que <b>viola a proposito</b> la regla 10: escribe dentro de una
 * transaccion sin recibir una {@link Observacion}.
 *
 * <p>Es la forma en que la regla se incumple de verdad: nadie escribe «voy a saltarme la
 * auditoria»; alguien escribe un caso de uso mas, con prisa, y no se acuerda del argumento. Sin
 * esta muestra la regla pasaria en verde tanto si funciona como si el patron del paquete esta mal
 * escrito y no encuentra ninguna clase.
 *
 * <p>Vive en {@code src/test} y bajo {@code ..muestras..}: el importador de las reglas de
 * produccion excluye las clases de prueba, asi que no puede romper el build por accidente.
 */
@Service
@SuppressWarnings("unused")
public class MuestraDeCasoDeUsoSinObservacion {

    /** Escritura sin observacion: esto es lo que la regla tiene que cazar. */
    @Transactional
    public void darDeAlta(String codigo) {
        // vacio a proposito
    }

    /** Con observacion: asi es como se hace, y la regla no debe quejarse de este. */
    @Transactional
    public void darDeAltaBien(String codigo, Observacion observacion) {
        // vacio a proposito
    }

    /** Solo lectura: no escribe nada, asi que no necesita explicar ningun cambio. */
    @Transactional(readOnly = true)
    public String consultar(String codigo) {
        return codigo;
    }
}
