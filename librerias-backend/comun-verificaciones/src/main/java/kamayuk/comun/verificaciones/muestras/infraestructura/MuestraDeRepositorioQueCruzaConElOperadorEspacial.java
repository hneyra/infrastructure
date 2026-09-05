package kamayuk.comun.verificaciones.muestras.infraestructura;

/**
 * Repositorio de muestra que <b>viola a proposito</b> las dos reglas del quinto y el tercer
 * hallazgo de RLS: el operador espacial y la busqueda por prefijo con {@code LIKE}.
 *
 * <p><b>Y es la muestra mas dificil de tomarse en serio de todas, porque las cuatro consultas
 * FUNCIONAN.</b> Devuelven exactamente las filas correctas, no lanzan, no dan un plan raro y el
 * {@code EXPLAIN} sigue diciendo «Index» —el de la politica—. Lo unico que hacen es leer el padron
 * entero del inquilino para contestar: 4 530 bloques donde el marco lee 347, medido con 90 000
 * predios en tres municipalidades sobre PostgreSQL 16 y PostGIS 3.4 (ADR-0034).
 *
 * <p>El motivo es del motor y no del SQL: bajo RLS, ni {@code geography_overlaps} ni {@code
 * st_intersects} ni {@code textlike} son <i>leakproof</i>, asi que PostgreSQL no los promueve por
 * encima de la politica y el indice —GiST o {@code text_pattern_ops}— no llega a usarse. Migrar de
 * {@code geography} a {@code geometry} no lo arregla y un GiST multicolumna con {@code btree_gist}
 * tampoco: los dos estan medidos y descartados en ADR-0034.
 *
 * <p>Existe porque una regla que no puede fallar no protege nada, y esta en particular vigila un
 * defecto que <b>no tiene sintoma</b>. Sin la muestra, el escaner recorreria los cinco
 * repositorios, no encontraria ningun operador espacial —hoy no hay ninguno— y pasaria en verde
 * tanto si funciona como si el patron esta mal escrito.
 *
 * <p>La revisa {@link kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo
 * este archivo del disco, con su javadoc dentro: si el escaner contara los comentarios, esta clase
 * daria decenas de hallazgos y no los cinco que declara.
 */
@SuppressWarnings("unused")
public class MuestraDeRepositorioQueCruzaConElOperadorEspacial {

    /** El operador de solapamiento contra el poligono: el defecto de V61, escrito otra vez. */
    private static final String LOTES_DE_LA_TESELA =
            "SELECT p.id FROM predio p WHERE p.geometria && ST_MakeEnvelope(?, ?, ?, ?, 4326)";

    /** Y el predicado exacto, que ademas cuesta cinco veces mas: 63,20 ms contra 1,32. */
    private static final String LOTES_DE_LA_ZONA =
            "SELECT p.id FROM predio p WHERE ST_Intersects(p.geometria::geometry, ?)";

    /** La misma familia con otro nombre. Se prohiben todos, no el que se usa hoy. */
    private static final String LOTES_DENTRO =
            "SELECT p.id FROM predio p WHERE ST_Within(p.geometria::geometry, ?)";

    /**
     * El tercer hallazgo, y en su forma completa: este archivo no sabe escribir un rango.
     *
     * <p>Ahi esta la diferencia con {@code RangoDePrefijo}, que escribe {@code ~>=~} y {@code ~<~}
     * y cae al {@code LIKE} solo cuando el prefijo no tiene sucesor. Ese repliegue es correcto y no
     * se marca; esto, que es la unica forma que el archivo conoce, si.
     */
    private static final String PREDIOS_DEL_SECTOR =
            "SELECT p.id FROM predio p WHERE p.codigo_ref_catastral LIKE :codigo || '%'";

    /** Y el comodin por delante, que no es una busqueda por prefijo ni tiene forma de rango. */
    private static final String BUSQUEDA_LIBRE =
            "SELECT p.id FROM predio p WHERE p.direccion LIKE '%avenida%'";
}
