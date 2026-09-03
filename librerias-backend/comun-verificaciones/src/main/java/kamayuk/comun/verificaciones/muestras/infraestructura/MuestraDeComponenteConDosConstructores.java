package kamayuk.comun.verificaciones.muestras.infraestructura;

import java.time.Clock;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * Viola {@code TODO_COMPONENTE_DECLARA_QUE_CONSTRUCTOR_INYECTAR}.
 *
 * <p>Es la forma exacta del fallo que la regla existe para impedir, y merece leerse porque no se
 * parece a un error: dos constructores publicos, ninguno marcado con {@code @Autowired} y ninguno
 * sin argumentos. Compila. Las pruebas que la instancian a mano pasan. Y al arrancar, Spring busca
 * el constructor sin argumentos, no lo encuentra y <b>aborta el contexto entero</b> — es decir, la
 * aplicacion no arranca, no es que este componente se degrade.
 *
 * <p>Ocurrio de verdad en {@code GeneradorDeDocumentos}, y lo descubrio el primer despliegue que
 * levanto el artefacto. Nada mas lo veia: ArchUnit miraba estructura, el escaner miraba texto y
 * Modulith miraba dependencias entre modulos.
 *
 * <p>El arreglo son ocho caracteres —{@code @Autowired} en el que Spring debe usar—, que es
 * justamente por que conviene que el build lo diga en segundos y no el despliegue en minutos.
 */
@Component
public class MuestraDeComponenteConDosConstructores {

    private final List<String> colaboradores;

    public MuestraDeComponenteConDosConstructores(List<String> colaboradores) {
        this.colaboradores = List.copyOf(colaboradores);
    }

    public MuestraDeComponenteConDosConstructores(List<String> colaboradores, Clock reloj) {
        this.colaboradores = List.copyOf(colaboradores);
        reloj.instant();
    }

    public List<String> colaboradores() {
        return colaboradores;
    }
}
