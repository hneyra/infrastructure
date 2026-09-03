package kamayuk.comun.verificaciones.muestras.autorizacion;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/** Sustituto de {@code autorizacion.RequiereAcceso}, con su centinela del ciudadano. */
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.TYPE, ElementType.METHOD})
public @interface RequiereAcceso {

    /**
     * El centinela que dice «no hay privilegio que comprobar» (ADR-0020).
     *
     * <p>El valor tiene que ser <b>el mismo</b> que el de la anotacion de verdad: la regla lo
     * compara contra una copia literal suya, asi que una muestra con otro valor pasaria por buena y
     * la regla se quedaria sin demostracion.
     */
    String CIUDADANO = "__ciudadano__";

    String acceso();

    Privilegio privilegio();
}
