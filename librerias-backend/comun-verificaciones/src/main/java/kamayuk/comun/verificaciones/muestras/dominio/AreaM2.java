package kamayuk.comun.verificaciones.muestras.dominio;

import java.math.BigDecimal;

/** Sustituto de {@code dominio.AreaM2}. Su {@code toString} lleva la unidad, como el de verdad. */
public record AreaM2(BigDecimal valor) {

    @Override
    public String toString() {
        return valor.toPlainString() + " m2";
    }
}
