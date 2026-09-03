package kamayuk.comun.verificaciones.muestras.infraestructura;

/**
 * Cruza la frontera de sistema por SQL: consulta tablas que no son suyas.
 *
 * <p>La muestra de {@code NINGUN_SQL_CRUZA_LA_FRONTERA_DE_SISTEMA}, y esta escrita con la forma
 * exacta del cruce mas caro que GOB-05 §6.1 encontro: el padron de predios cruzado con las
 * declaraciones juradas, <b>paginado y contando lo filtrado</b>, que es justo el que no se puede
 * resolver con dos listas y un bucle.
 *
 * <p>Hoy funciona: las tablas estan en la misma base. El dia que se parta deja de funcionar, y no
 * falla al compilar ni al desplegar — falla en produccion, en la consulta que nadie volvio a mirar.
 */
@SuppressWarnings("unused")
public final class MuestraDeConsultaQueCruzaLaFrontera {

    private static final String EL_PADRON_CON_SUS_DECLARACIONES =
            "SELECT p.id, p.cod_ref_catastral, s.codigo, f.area_terreno"
                    + " FROM predio p"
                    + " JOIN sector s ON s.id = p.sector_id"
                    + " LEFT JOIN ficha_catastral f ON f.predio_id = p.id"
                    + " WHERE p.municipalidad_id = current_setting('app.municipalidad_id')::bigint";

    private static final String EL_TITULAR_A_UNA_FECHA =
            "SELECT contribuyente_id FROM titularidad"
                    + " WHERE predio_id = ? AND vigencia_desde <= ?"
                    + " ORDER BY porcentaje DESC, id ASC LIMIT 1";

    private MuestraDeConsultaQueCruzaLaFrontera() {}
}
