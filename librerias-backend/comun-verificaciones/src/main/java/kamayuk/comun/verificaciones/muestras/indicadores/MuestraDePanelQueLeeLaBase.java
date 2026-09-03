package kamayuk.comun.verificaciones.muestras.indicadores;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

/**
 * Viola {@code EL_PANEL_NO_HABLA_CON_LA_BASE}: el panel se salta las APIs publicas y consulta el
 * libro por su cuenta (#56).
 *
 * <p>Es la ruta corta que la regla existe para cerrar, escrita tal cual la escribiria alguien con
 * prisa: «total, es solo un {@code SELECT} de lectura». Tiene los dos defectos del AC 3 y el AC 4 a
 * la vez, y ninguno de los dos se ve leyendo el metodo:
 *
 * <ul>
 *   <li><b>Duplica el criterio del libro.</b> Aqui falta el {@code NOT EXISTS} de reversion que
 *       {@code AsientoRepositoryJdbc} si tiene, asi que esta suma cuenta los abonos de recibos
 *       anulados. La cifra sale <b>mas alta</b> que la del resumen del area, las dos son plausibles
 *       y nadie sabe cual mirar.
 *   <li><b>Recorre en vez de agregar.</b> Sin {@code GROUP BY}, cada carga de la pantalla que todo
 *       el mundo abre al entrar trae una fila por asiento del ejercicio.
 * </ul>
 *
 * <p>El paquete se llama {@code …muestras.indicadores} para que caiga dentro de {@code
 * ..indicadores..}, igual que {@code muestras.fiscalizacion} cae dentro de {@code
 * ..fiscalizacion..}.
 */
public class MuestraDePanelQueLeeLaBase {

    private final Connection conexion;

    public MuestraDePanelQueLeeLaBase(Connection conexion) {
        this.conexion = conexion;
    }

    /** Lo recaudado del ejercicio, sumado a mano y sin descontar lo reversado. */
    public BigDecimal recaudado(int ejercicio) throws SQLException {
        BigDecimal total = BigDecimal.ZERO;
        try (PreparedStatement consulta =
                conexion.prepareStatement(
                        "SELECT monto FROM cuenta_corriente_asiento"
                                + " WHERE ejercicio = ? AND tipo = 'ABONO'")) {
            consulta.setInt(1, ejercicio);
            try (ResultSet filas = consulta.executeQuery()) {
                while (filas.next()) {
                    total = total.add(filas.getBigDecimal("monto"));
                }
            }
        }
        return total;
    }
}
