package kamayuk.comun.verificaciones.muestras.infraestructura;

/**
 * Repositorio de muestra que <b>viola a proposito</b> ADR-0039: escribe la autorizacion sin ser
 * {@code identidad}.
 *
 * <p>Desde ADR-0039 la autorizacion es un sistema propio y su dueño es {@code identidad}. Las
 * cuatro tablas —{@code usuario}, {@code grupo}, {@code miembro} y {@code permiso}— siguen estando
 * en los cinco baselines porque los cinco las LEEN para autorizar sin un viaje de red (D-N5), y por
 * eso el reparto de tablas no las puede marcar de nadie: leerlas es correcto en los cinco. Lo que
 * no lo es es escribirlas, y un reparto de tablas no distingue verbos.
 *
 * <p>Existe porque una regla que no puede fallar no protege nada. Y aqui hace mas falta que en
 * ninguna otra: mientras un repositorio no declare {@code escritoresDeLaAutorizacionConMotivo()},
 * la prohibicion <b>no se revisa</b> en el —es lo que impide que la libreria deje rojos los cinco
 * consumidores el mismo dia (#437)—, asi que sin esta muestra la regla podria estar escrita al
 * reves y los cinco builds seguirian en verde. La prueba que la lee llama a {@code
 * revisarAutorizacion} directamente, con la lista vacia y sin pasar por el interruptor, y por eso
 * muerde en los cinco.
 *
 * <p><b>Cinco escrituras y las tres formas.</b> {@code INSERT INTO}, {@code UPDATE … SET} y {@code
 * DELETE FROM}, con el {@code UPDATE} escrito las dos veces: una en el mismo literal y otra con el
 * {@code SET} en el siguiente, que es como se compone de verdad un SQL largo.
 *
 * <p><b>Y el {@code ON CONFLICT … DO UPDATE SET} de la siembra idempotente NO da un hallazgo
 * propio, y conviene decirlo</b> porque uno cuenta cinco y espera seis: ahi el {@code UPDATE} no
 * nombra ninguna tabla —la nombra el {@code INSERT INTO} que lo precede—, asi que lo que se marca
 * es el {@code INSERT}, una vez. No es un hueco: no existe un {@code DO UPDATE SET} sin su {@code
 * INSERT} delante.
 *
 * <p><b>Y lleva su contraste dentro</b>, que es la mitad que hace util la muestra: dos {@code
 * SELECT} sobre las mismas cuatro tablas —que es lo que el guardia de cada sistema hace y tiene que
 * seguir pudiendo hacer—, una columna que se llama {@code usuario_alta} y una tabla que se llama
 * {@code usuario_externo}, que no son ninguna de las cuatro. Si el escaner marcara alguna de esas,
 * pondria rojo el {@code ComprobadorDeAccesoJdbc} de los cuatro satelites el primer dia, y una
 * comprobacion que grita en lo correcto se acaba apagando (#437).
 *
 * <p><b>Y el javadoc menciona las escrituras a proposito</b>: un INSERT INTO usuario, un UPDATE
 * grupo SET, un DELETE FROM permiso y un INSERT INTO miembro escritos en prosa —como estos— NO son
 * hallazgos, y esta clase da <b>cinco</b> y no nueve. Es la misma mitad de la demostracion que
 * MuestraDeRepositorioQueBorra lleva desde P3, y la leccion de #42: una guarda que se dispara con
 * la prosa que la justifica es la que alguien acaba apagando borrando el comentario.
 *
 * <p>Vive en la libreria y no en {@code src/main} de ningun repositorio a proposito: el escaner
 * solo recorre el {@code src/main} de quien lo consume, asi que esta clase no puede romper el build
 * por accidente. La revisa {@link
 * kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo este archivo del jar.
 */
@SuppressWarnings("unused")
public class MuestraDeRepositorioQueEscribeLaAutorizacion {

    /** Da de alta a una persona en la base de ESTE sistema, que no es el dueño del padron. */
    private static final String ALTA_DE_USUARIO =
            "INSERT INTO usuario (municipalidad_id, cuenta, nombre) VALUES (?, ?, ?)";

    /**
     * Cambia el nombre de un grupo aqui, y en las otras cuatro bases sigue llamandose como antes.
     */
    private static final String RENOMBRA_UN_GRUPO = "UPDATE grupo SET nombre = ? WHERE id = ?";

    /**
     * Concede un permiso. Compuesto en dos literales, como se compone de verdad: el {@code SET} cae
     * en el segundo.
     */
    private static final String CONCEDE_UN_PERMISO =
            "INSERT INTO permiso (municipalidad_id, acceso_id, grupo_id) VALUES (?, ?, ?)"
                    + " ON CONFLICT (municipalidad_id, acceso_id, grupo_id) DO UPDATE"
                    + " SET privilegios = EXCLUDED.privilegios";

    /**
     * Retira privilegios, con el {@code SET} en el SEGUNDO literal: con las comillas y el {@code +}
     * en medio, que es como se compone de verdad el SQL de un repositorio JDBC. Es lo que obliga a
     * que el patron admita holgura entre la tabla y su {@code SET}, y sin este caso esa holgura
     * seria codigo que nada ejerce.
     */
    private static final String RETIRA_PRIVILEGIOS =
            "UPDATE permiso" + " SET privilegios = ? WHERE municipalidad_id = ? AND acceso_id = ?";

    /** Saca a alguien de un grupo borrando la fila, que ademas destruye la constancia. */
    private static final String QUITA_UN_MIEMBRO = "DELETE FROM miembro WHERE id = ?";

    // ---- El contraste: nada de lo que sigue es un hallazgo -------------------------------

    /** Leer para autorizar es lo que los cinco hacen, y tiene que seguir siendo correcto. */
    private static final String COMPRUEBA_EL_ACCESO =
            "SELECT p.privilegios FROM permiso p JOIN miembro m ON m.grupo_id = p.grupo_id"
                    + " JOIN usuario u ON u.id = m.usuario_id JOIN grupo g ON g.id = m.grupo_id"
                    + " WHERE u.cuenta = ?";

    /** {@code usuario_alta} es una COLUMNA de miembro, y {@code usuario_externo} otra tabla. */
    private static final String NI_UNA_NI_OTRA =
            "INSERT INTO usuario_externo (usuario_alta) VALUES (?)";
}
