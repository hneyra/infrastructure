package kamayuk.comun.verificaciones.muestras.infraestructura;

/**
 * Repositorio de muestra que <b>viola a proposito</b> la regla 4: borra de una tabla protegida.
 *
 * <p>RNF-051: no se borra deuda, pagos, recibos, valores, papeletas, asientos ni auditoria. Se
 * anula, se da de baja o se reversa. La barrera final es que {@code sgtm_app} no tiene el
 * privilegio {@code DELETE} (V7), pero esa falla en produccion; el escaner de fuentes falla en el
 * build, que es donde cuesta barato.
 *
 * <p>Existe porque una regla que no puede fallar no protege nada. Los doce contextos estan casi
 * vacios: sin una muestra, el escaner recorreria el arbol, no encontraria ningun {@code DELETE} y
 * pasaria en verde tanto si funciona como si el patron esta mal escrito.
 *
 * <p>Vive en {@code src/test} a proposito: el escaner solo recorre {@code src/main}, asi que esta
 * clase no puede romper el build por accidente. La revisa {@link
 * kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo este archivo del
 * disco.
 */
@SuppressWarnings("unused")
public class MuestraDeRepositorioQueBorra {

    /** Un recibo no se borra: se anula, y la anulacion deja constancia de quien y por que. */
    private static final String BORRA_UN_RECIBO = "DELETE FROM recibo WHERE id = ?";

    /** El libro de asientos no se corrige en el sitio: se reversa con otro asiento. */
    private static final String EDITA_UN_ASIENTO =
            "UPDATE cuenta_corriente_asiento SET monto = ? WHERE id = ?";

    /** SET SESSION sobrevive al retorno de la conexion al pool. */
    private static final String CONTAMINA_EL_POOL = "SET SESSION app.municipalidad_id = '1'";
}
