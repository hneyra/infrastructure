package kamayuk.comun.verificaciones.muestras.dominio;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import org.springframework.stereotype.Component;

/**
 * Clase de muestra que viola <b>a proposito</b> todas las reglas de {@link
 * kamayuk.comun.verificaciones.ReglasDeArquitectura}, para verificar que las reglas muerden.
 *
 * <p>Sin algo asi, las reglas de arquitectura serian un adorno: los contextos acotados estan vacios
 * y todas pasarian en verde sin haber revisado una sola clase. Es el mismo razonamiento por el que
 * la prueba de aislamiento siembra las dos municipalidades en todas las tablas.
 *
 * <p>Vive en {@code src/test} y bajo un paquete {@code ..muestras..}: el importador de las reglas
 * de produccion excluye las clases de prueba, asi que esta clase no puede romper el build por
 * accidente. Solo la ve {@code ReglasDeArquitecturaMuerdenTest}.
 */
@Component
@SuppressWarnings({"unused", "checkstyle:SinLocalDateTime"})
public class MuestraQueViolaLasReglas {

    // Regla: ningun importe en coma flotante.
    private final double importe = 0.1 + 0.2;

    // Regla: nadie usa LocalDateTime.
    private final LocalDateTime cuando = LocalDateTime.now();

    // Regla: ninguna firma de dominio expone BigDecimal desnudo.
    public BigDecimal calcular(BigDecimal base) {
        return base;
    }

    // Regla: el dominio no lee el reloj.
    public LocalDate hoy() {
        return LocalDate.now();
    }

    // Regla: nadie recibe el identificador de municipalidad.
    public void calcularPara(MunicipalidadId municipalidadId) {
        // vacio a proposito
    }

    // Regla: el dominio no depende de las capas externas.
    public Object desdeLaInfraestructura() {
        return new kamayuk.comun.verificaciones.muestras.infraestructura.MuestraDeInfraestructura();
    }
}
