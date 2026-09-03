package kamayuk.comun.verificaciones.muestras.dominio;

import java.math.BigDecimal;

/** Sustituto de {@code dominio.Alicuota}: un porcentaje, en tanto por ciento (regla 8). */
public record Alicuota(BigDecimal valor) {

    public static Alicuota de(String valor) {
        return new Alicuota(new BigDecimal(valor));
    }
}
