package kamayuk.comun.verificaciones.muestras.dominio;

import java.math.BigDecimal;

/**
 * Sustituto de {@code dominio.Dinero}.
 *
 * <p>Expone su {@code BigDecimal} igual que el de verdad, y por el mismo motivo: es el tipo que lo
 * guarda y la persistencia tiene que poder pedirselo. Por eso esta en la lista de envoltorios que
 * {@code NINGUNA_FIRMA_DE_DOMINIO_EXPONE_BIGDECIMAL} exceptua.
 */
public record Dinero(BigDecimal valor) {

    public static final Dinero CERO = new Dinero(BigDecimal.ZERO);
}
