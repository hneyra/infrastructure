package kamayuk.comun.verificaciones.muestras.compartido;

import kamayuk.comun.verificaciones.muestras.dominio.MunicipalidadId;

/** Sustituto de {@code compartido.TenantContext}: lo unico que hace falta es que tenga `fijar`. */
public final class TenantContext {

    private TenantContext() {}

    public static void fijar(MunicipalidadId municipalidad) {
        // Una muestra no fija ningun contexto: lo que la regla mira es quien LLAMA a este metodo.
    }
}
