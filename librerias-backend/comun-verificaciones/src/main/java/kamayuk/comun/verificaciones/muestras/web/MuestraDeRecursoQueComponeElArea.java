package kamayuk.comun.verificaciones.muestras.web;

import kamayuk.comun.verificaciones.muestras.dominio.AreaM2;
import kamayuk.comun.verificaciones.muestras.dominio.Medida;
import org.jspecify.annotations.Nullable;

/**
 * Recurso de muestra que <b>compone el area a mano</b>, en las dos formas que el sistema tenia
 * vivas a la vez (#607).
 *
 * <p>Asi es como aparece el defecto, y por eso llevaba ahi desde siempre: no como una decision sino
 * como lo mas natural del mundo. Quien escribe un {@code Resource} tiene delante un {@code AreaM2},
 * el campo del {@code record} es un {@code String} porque el de al lado tambien lo es, y le pone
 * {@code .toString()}. Compila, pasa el lint, y la respuesta sale con una cifra correcta: {@code
 * "360.00 m2"}. La segunda forma —{@code valor().toPlainString()}— produce ademas los <b>bytes
 * buenos</b>, asi que ninguna prueba de respuesta la distingue de lo correcto; lo unico que delata
 * que es una segunda convencion es este escaner.
 *
 * <p>Lo que produce no es un error de calculo: es que el mismo predio se lee de dos formas segun a
 * que modulo se le pregunte. Con la unidad dentro, {@code "360.00 m2"} no se ordena, no se suma y
 * no se compara con lo que fiscalizacion publica del mismo predio sin partir la cadena — y partirla
 * para volver a formatearla es como se pierde un decimal (RNF-055).
 *
 * <p><b>Los tres campos de abajo estan como deben</b>, y no son adorno: son el contraste. {@code
 * area} tipado es lo correcto —lo escribe el serializador de {@code ConfiguracionDeJson}—, y las
 * dos {@link Medida} llevan su unidad dentro <b>a proposito</b>: «12.50 ML» y «12.5000 HA». Si la
 * regla cazara tambien {@code hectareas().toString()}, se llevaria por delante el bloque rural de
 * {@code FichaResource} y seria una regla que no se puede cumplir. Ojo al detalle que lo hace
 * dificil: «hect<b>area</b>s» contiene «area» por dentro, asi que el patron tiene que exigir que el
 * identificador <b>empiece</b> por ella.
 *
 * <p>Vive en {@code src/test}: el escaner solo recorre {@code src/main}, asi que no puede romper el
 * build por accidente. La revisa {@link
 * kamayuk.comun.verificaciones.ProhibicionesEnElCodigoFuenteTestBase} leyendo este archivo del
 * disco.
 */
@SuppressWarnings("unused")
public record MuestraDeRecursoQueComponeElArea(
        String codRefCatastral,
        String areaTerreno,
        @Nullable String areaConstruida,
        AreaM2 area,
        String frontis,
        String hectareas) {

    /** Asi es como se incumple. Las dos lineas del medio son las que el escaner tiene que cazar. */
    public static MuestraDeRecursoQueComponeElArea de(FichaDeMuestra ficha) {
        return new MuestraDeRecursoQueComponeElArea(
                ficha.codigo(),
                // La unidad dentro del dato: «360.00 m2».
                ficha.areaTerreno().toString(),
                // La cifra buena, escrita por segunda vez en otro sitio.
                ficha.areaConstruida() == null
                        ? null
                        : ficha.areaConstruida().valor().toPlainString(),
                // Lo correcto: tipado, lo escribe el serializador registrado.
                ficha.areaTerreno(),
                // Y las dos medidas, que si llevan su unidad dentro.
                ficha.frontis().toString(),
                ficha.hectareas().toString());
    }

    /** Lo que el dominio entrega. */
    public interface FichaDeMuestra {
        String codigo();

        AreaM2 areaTerreno();

        @Nullable AreaM2 areaConstruida();

        Medida frontis();

        Medida hectareas();
    }
}
