package kamayuk.comun.verificaciones.muestras.dominio;

import java.math.BigDecimal;

/** Sustituto de {@code dominio.Medida}: un metrado que alimenta un importe (NEG-05 §RT-005). */
public record Medida(BigDecimal valor) {

    @Override
    public String toString() {
        return valor.toPlainString();
    }
}
