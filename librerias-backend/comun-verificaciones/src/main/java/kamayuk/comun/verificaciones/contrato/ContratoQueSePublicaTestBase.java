package kamayuk.comun.verificaciones.contrato;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * La mitad del CONSUMIDOR: publicar, en un archivo comprometido, lo que este backend le pide a
 * otro.
 *
 * <p>El archivo lo lee el proveedor en su propio CI ({@link ContratoConElConsumidorTestBase}), asi
 * que es la frontera entre dos builds y tiene el mismo trato que el contrato de la API (#312):
 * <b>no se edita a mano</b>. Esta prueba exige que siga siendo lo que produce {@link #contrato()},
 * y se regenera con:
 *
 * <pre>
 * ./gradlew :&lt;modulo&gt;:test --tests '*ContratoQueConsumeDe*' -Dkamayuk.contratos.regenerar=true
 * </pre>
 *
 * <h2>Lo que NO demuestra, y por que hace falta la otra prueba</h2>
 *
 * <p>Que el archivo sea el que produce {@link #contrato()} no dice nada sobre si {@link
 * #contrato()} describe lo que el adaptador pide de verdad: los dos son del mismo repositorio, y
 * una guarda cuyos dos lados salen del mismo sitio no puede fallar por lo que importa (P5E §6.3).
 *
 * <p>Lo que la sostiene es la prueba de ida y vuelta que cada consumidor escribe al lado: fabricar
 * una respuesta <b>a partir del contrato declarado</b>, pasarla por el adaptador de verdad, y
 * exigir que el objeto que sale este completo. Si alguien cambia el adaptador para leer {@code id}
 * donde el contrato dice {@code fichaId}, la respuesta fabricada no trae ese campo y el objeto sale
 * con un cero — que es exactamente el defecto que se quiere impedir, medido en vez de razonado.
 */
public abstract class ContratoQueSePublicaTestBase {

    /** Con esto puesto, la prueba reescribe el archivo en vez de compararlo. */
    private static final String REGENERAR = "kamayuk.contratos.regenerar";

    /** Lo que este backend le pide al proveedor, derivado de su adaptador. */
    protected abstract ContratoDelConsumidor contrato();

    @Test
    @DisplayName("el contrato publicado es el que produce el adaptador de hoy")
    void elContratoPublicadoEsElQueProduceElAdaptador() throws IOException {
        ContratoDelConsumidor contrato = contrato();
        Path destino = archivo(contrato);
        String producido = contrato.comoJson();

        if (Boolean.getBoolean(REGENERAR)) {
            Files.createDirectories(destino.getParent());
            Files.writeString(destino, producido, StandardCharsets.UTF_8);
            return;
        }

        assertThat(destino)
                .as(
                        "«%s» no existe. Lo lee el CI de «%s» para comprobar que sigue cumpliendo lo"
                                + " que este backend espera; sin el, esa comprobacion no puede"
                                + " correr. Regenerar con -D%s=true.",
                        destino, contrato.proveedor(), REGENERAR)
                .exists();

        assertThat(Files.readString(destino, StandardCharsets.UTF_8))
                .as(
                        "«%s» y lo que el adaptador pide hoy no cuadran. Este archivo NO se edita a"
                                + " mano: se regenera con -D%s=true, y el diff dice que cambio de"
                                + " lo que este backend le exige a «%s».",
                        destino, REGENERAR, contrato.proveedor())
                .isEqualTo(producido);
    }

    /**
     * Que el contrato no se quede vacio.
     *
     * <p>El contraste, y no sobra: {@link ContratoConElConsumidorTestBase} exige que el contrato
     * tenga operaciones, pero esa prueba corre en OTRO repositorio y en otro CI. Un contrato que se
     * vaciara aqui dejaria aquella en rojo, sin que nada en este repositorio lo hubiera avisado —y
     * el rojo le llegaria a quien no lo causo, que es justo el reparto que este mecanismo evita.
     */
    @Test
    @DisplayName("y declara al menos una operacion, con su respuesta")
    void declaraAlMenosUnaOperacion() {
        ContratoDelConsumidor contrato = contrato();
        assertThat(contrato.operaciones()).isNotEmpty();
        for (Map.Entry<String, ContratoDelConsumidor.OperacionEsperada> operacion :
                contrato.operaciones().entrySet()) {
            assertThat(operacion.getValue().respuesta())
                    .as("«%s» no declara que lee de la respuesta", operacion.getKey())
                    .isNotNull();
        }
    }

    /** Donde se publica: `docs/50-api/contratos-que-consume/<proveedor>.json` de ESTE clon. */
    protected Path archivo(ContratoDelConsumidor contrato) {
        return ContratoConElConsumidorTestBase.raizDeLosClones()
                .resolve(contrato.consumidor())
                .resolve("docs/50-api/contratos-que-consume")
                .resolve(contrato.proveedor() + ".json");
    }
}
