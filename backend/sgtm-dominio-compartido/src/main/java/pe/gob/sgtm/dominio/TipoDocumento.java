package pe.gob.sgtm.dominio;

/**
 * Tipos de documento de identidad admitidos, los mismos que la restriccion {@code
 * contribuyente.tipo_documento} del esquema.
 *
 * <p>Cada uno lleva la composicion que exige, y ahi esta el motivo de que esto sea un enum y no un
 * {@code String}: un DNI son ocho digitos y un RUC once, y sin el tipo al lado el numero no se
 * puede validar. La regla vive junto al tipo para que agregar uno obligue a decir que forma tiene.
 */
public enum TipoDocumento {

    /** Documento nacional de identidad: ocho digitos. */
    DNI(8, 8, true),

    /** Registro unico de contribuyentes: once digitos. */
    RUC(11, 11, true),

    /** Carne de extranjeria. */
    CE(6, 20, false),

    PASAPORTE(6, 20, false),

    /** Partida de nacimiento o de defuncion, para sucesiones indivisas. */
    PARTIDA(1, 20, false),

    /** Lo que el manual admite y no encaja en lo anterior. */
    OTRO(1, 20, false);

    private final int longitudMinima;
    private final int longitudMaxima;
    private final boolean soloDigitos;

    TipoDocumento(int longitudMinima, int longitudMaxima, boolean soloDigitos) {
        this.longitudMinima = longitudMinima;
        this.longitudMaxima = longitudMaxima;
        this.soloDigitos = soloDigitos;
    }

    public int longitudMinima() {
        return longitudMinima;
    }

    public int longitudMaxima() {
        return longitudMaxima;
    }

    public boolean soloDigitos() {
        return soloDigitos;
    }
}
