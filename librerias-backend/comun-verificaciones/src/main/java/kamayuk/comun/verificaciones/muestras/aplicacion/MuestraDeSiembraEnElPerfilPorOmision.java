package kamayuk.comun.verificaciones.muestras.aplicacion;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/**
 * Siembra de muestra que <b>viola a proposito</b> el tercer criterio de #202: corre al arrancar y
 * no declara {@code @Profile("batch")}, asi que correria tambien en el proceso web.
 *
 * <p>Es la forma en que el defecto aparece de verdad. Nadie escribe «voy a sembrar en produccion»:
 * alguien escribe un {@code ApplicationRunner} para dejar listo el tenant de demostracion, lo
 * prueba levantando la aplicacion entera —donde funciona— y se olvida del perfil. El sintoma
 * llegaria mucho despues y disfrazado: el contenedor que atiende peticiones deja de arrancar porque
 * le falta la clave de {@code sgtm_owner}, una credencial que no tenia por que conocer.
 *
 * <p>Vive en {@code src/test} y bajo {@code ..muestras..}: el importador de las reglas de
 * produccion excluye las clases de prueba, asi que no puede romper el build por accidente.
 */
@Component
@SuppressWarnings("unused")
public class MuestraDeSiembraEnElPerfilPorOmision implements ApplicationRunner {

    @Override
    public void run(ApplicationArguments argumentos) {
        // Aqui iria la siembra del tenant de demostracion. Vacio a proposito: lo que esta muestra
        // demuestra es donde NO puede vivir, no que siembra.
    }
}
