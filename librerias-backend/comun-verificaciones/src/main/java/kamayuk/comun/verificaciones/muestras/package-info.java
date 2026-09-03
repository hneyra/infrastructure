/**
 * Las clases que violan cada regla a proposito, y los tipos minimos que necesitan para compilar.
 *
 * <p>Viajan con las reglas y no con el sistema: una regla sin muestra pasa en verde para siempre y
 * da una sensacion de proteccion que no existe, asi que separarlas seria dejar cuatro repositorios
 * con reglas que nadie ha visto fallar.
 *
 * <p>Los tipos de {@code muestras.dominio}, {@code muestras.autorizacion}, {@code
 * muestras.compartido}, {@code muestras.catastro} y {@code muestras.cuentacorriente} son
 * <b>sustitutos</b> de los del sistema, con el mismo nombre simple y el minimo que la muestra
 * necesita. No son copias del dominio real y no deben crecer: en cuanto una muestra necesite mas
 * que un nombre y una firma, lo que hay que revisar es la muestra.
 *
 * <p>Las reglas los reconocen porque anclan en {@code raiz + ".dominio.Observacion"} y las dos
 * raices —la del sistema y la de estas muestras— se vigilan a la vez ({@code
 * ReglasDeArquitectura.bajoLasDosRaices}).
 */
package kamayuk.comun.verificaciones.muestras;
