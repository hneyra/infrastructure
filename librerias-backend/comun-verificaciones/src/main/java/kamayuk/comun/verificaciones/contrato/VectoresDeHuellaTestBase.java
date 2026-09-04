package kamayuk.comun.verificaciones.contrato;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * El algoritmo de la huella de la anti-entropia, fijado con vectores de oro.
 *
 * <h2>Por que un algoritmo necesita un contrato</h2>
 *
 * <p>La anti-entropia compara huellas por sector que <b>dos repositorios calculan por separado</b>,
 * cada uno sobre su base. Si los dos calculos no son identicos hasta el byte, la comparacion no
 * falla ruidosamente: o <b>todos</b> los sectores salen discrepantes —y entonces la anti-entropia
 * deja de leerse en una semana— o <b>ninguno</b>, y entonces no protege nada y nadie lo sabe. Las
 * dos son peores que no tenerla, y ninguna se parece a su causa: las dos se leen como un problema
 * de datos y son un problema de codigo.
 *
 * <p>El archivo de vectores es la frontera, con el mismo trato que el contrato de la API (#312): lo
 * genera un lado, lo comprueban los dos, y <b>no se edita a mano</b>. Cambiar el separador, el
 * orden o el algoritmo en un repositorio pone rojo el build de quien lo cambio, porque su
 * implementacion deja de reproducir el archivo.
 *
 * <h2>Que tienen que cubrir los vectores, y por que</h2>
 *
 * <p>Los casos no son decorativos; cada uno fija una de las decisiones del algoritmo:
 *
 * <ul>
 *   <li>un lote <b>sin sector</b>, que fija que el nulo es la cadena vacia;
 *   <li>dos lotes cuyos campos, concatenados sin separador, darian lo mismo — el par que hace
 *       falta para que el separador signifique algo;
 *   <li>un sector con <b>dos</b> lotes, que es el unico caso en que el orden de combinacion se
 *       puede observar: con uno solo, cualquier orden da lo mismo;
 *   <li>una direccion con tildes y una «ñ», que fija que se codifica en UTF-8 y no en la
 *       codificacion por omision de la maquina.
 * </ul>
 */
public abstract class VectoresDeHuellaTestBase {

    /** Con esto puesto, la prueba reescribe el archivo en vez de compararlo. */
    private static final String REGENERAR = "kamayuk.contratos.regenerar";

    private static final ObjectMapper JSON = new ObjectMapper();

    /**
     * El repositorio que PUBLICA el archivo. Los demas solo lo comprueban.
     *
     * <p>Uno solo lo genera a proposito: si los dos pudieran regenerarlo, el que cambiara el
     * algoritmo regeneraria el archivo y el rojo se convertiria en un diff que alguien acepta.
     */
    protected abstract String repositorioQuePublica();

    /** La implementacion de este repositorio, para un lote. */
    protected abstract String huellaDeUnLote(
            long predioId, String codRefCatastral, String direccion, String sectorCodigo, String estado);

    /** La implementacion de este repositorio, para un sector. */
    protected abstract String huellaDeUnSector(List<String> huellasDeSusLotes);

    /**
     * Los casos, iguales en los dos lados.
     *
     * <p>Van en el codigo y no en el archivo: si los casos salieran del archivo, un archivo con
     * cero casos pasaria en verde en los dos repositorios y nadie estaria comparando nada.
     */
    private static final List<Lote> LOTES =
            List.of(
                    new Lote(1L, "200105-01-02-003", "AV. CAYETANO HEREDIA 100", "SC-1", "ACTIVO"),
                    new Lote(2L, "200105-01-02-004", "CALLE PEÑA GARCÍA 12", "SC-1", "ACTIVO"),
                    // Sin sector: fija que el nulo es la cadena vacia.
                    new Lote(3L, "200105-09-09-001", "SECTOR SIN ASIGNAR S/N", null, "ACTIVO"),
                    // El par que hace util el separador: concatenados sin el, los dos dan
                    // «...AV. GRAU 100A ACTIVO» y sus huellas coincidirian.
                    new Lote(4L, "200105-02-01-001", "AV. GRAU 100", "A", "ACTIVO"),
                    new Lote(5L, "200105-02-01-001", "AV. GRAU 10", "0A", "ACTIVO"),
                    // Un lote dado de baja: el estado entra en la huella, asi que dar de baja un
                    // predio tiene que mover la huella de su sector.
                    new Lote(6L, "200105-01-02-005", "AV. CAYETANO HEREDIA 102", "SC-1", "BAJA"));

    @Test
    @DisplayName("la huella que calcula este repositorio es la del archivo de vectores")
    void laHuellaEsLaDelArchivo() throws IOException {
        Map<String, Object> documento = new LinkedHashMap<>();
        documento.put("PROCEDENCIA", PROCEDENCIA);
        documento.put("separador", "U+001F entre campos; salto de linea entre huellas de lote");
        documento.put("orden", "las huellas de un sector se combinan por predioId ascendente");

        List<Object> lotes = new ArrayList<>();
        List<String> deSc1 = new ArrayList<>();
        for (Lote lote : LOTES) {
            String huella =
                    huellaDeUnLote(
                            lote.predioId(),
                            lote.codRefCatastral(),
                            lote.direccion(),
                            lote.sectorCodigo(),
                            lote.estado());
            Map<String, Object> fila = new LinkedHashMap<>();
            fila.put("predioId", lote.predioId());
            fila.put("codRefCatastral", lote.codRefCatastral());
            fila.put("direccion", lote.direccion());
            fila.put("sectorCodigo", lote.sectorCodigo());
            fila.put("estado", lote.estado());
            fila.put("huella", huella);
            lotes.add(fila);
            if ("SC-1".equals(lote.sectorCodigo())) {
                deSc1.add(huella);
            }
        }
        documento.put("lotes", lotes);

        Map<String, Object> sector = new LinkedHashMap<>();
        sector.put("sector", "SC-1");
        sector.put("lotes", List.of(1L, 2L, 6L));
        sector.put("huella", huellaDeUnSector(deSc1));
        documento.put("sectores", List.of(sector));

        // El caso que fija el ORDEN: los mismos tres lotes al reves NO pueden dar la misma
        // huella. Va dentro del archivo para que los dos lados lo comprueben, y no como una
        // asercion local, porque lo que importa no es que sean distintas aqui sino que las
        // dos implementaciones esten de acuerdo en CUAL es cual.
        Map<String, Object> alReves = new LinkedHashMap<>();
        alReves.put("sector", "SC-1 (al reves, para fijar que el orden importa)");
        alReves.put("lotes", List.of(6L, 2L, 1L));
        alReves.put("huella", huellaDeUnSector(deSc1.reversed()));
        documento.put("sectoresAlReves", List.of(alReves));

        String producido = JSON.writerWithDefaultPrettyPrinter().writeValueAsString(documento) + "\n";
        Path destino = archivo();

        if (Boolean.getBoolean(REGENERAR) && esQuienPublica()) {
            Files.createDirectories(destino.getParent());
            Files.writeString(destino, producido, StandardCharsets.UTF_8);
            return;
        }

        assertThat(destino)
                .as(
                        "«%s» no existe. Lo publica «%s» y lo comprueban los dos lados de la"
                                + " anti-entropia: sin el, cada uno calcularia su huella y nadie"
                                + " sabria si son la misma.",
                        destino, repositorioQuePublica())
                .exists();

        assertThat(Files.readString(destino, StandardCharsets.UTF_8))
                .as(
                        "la huella que calcula este repositorio no es la del archivo de vectores."
                            + " Los dos lados de la anti-entropia comparan huellas calculadas por"
                            + " separado: si no son identicas hasta el byte, o todos los sectores"
                            + " salen discrepantes o ninguno, y las dos cosas se leen como un"
                            + " problema de datos siendo un problema de codigo.")
                .isEqualTo(producido);
    }

    /**
     * Y el separador tiene que hacer algo.
     *
     * <p>El contraste que impide que los vectores pasen con un algoritmo que concatena a secas: el
     * par de lotes (4) y (5) da la misma cadena sin separador, asi que sus huellas <b>tienen</b> que
     * diferir. Sin esta asercion, quitar el separador regeneraria un archivo distinto pero
     * internamente coherente, y los dos lados seguirian de acuerdo — en un algoritmo que confunde
     * dos predios.
     */
    @Test
    @DisplayName("y dos lotes que sin separador darian lo mismo tienen huellas distintas")
    void elSeparadorHaceAlgo() {
        Lote uno = LOTES.get(3);
        Lote otro = LOTES.get(4);

        assertThat(uno.codRefCatastral() + uno.direccion() + uno.sectorCodigo() + uno.estado())
                .as("los dos casos tienen que dar la MISMA cadena si se concatenan sin separador")
                .isEqualTo(
                        otro.codRefCatastral()
                                + otro.direccion()
                                + otro.sectorCodigo()
                                + otro.estado());

        assertThat(
                        huellaDeUnLote(
                                7L,
                                uno.codRefCatastral(),
                                uno.direccion(),
                                uno.sectorCodigo(),
                                uno.estado()))
                .isNotEqualTo(
                        huellaDeUnLote(
                                7L,
                                otro.codRefCatastral(),
                                otro.direccion(),
                                otro.sectorCodigo(),
                                otro.estado()));
    }

    /** El archivo de vectores, en el clon del repositorio que lo publica. */
    protected Path archivo() {
        return ContratoConElConsumidorTestBase.raizDeLosClones()
                .resolve(repositorioQuePublica())
                .resolve("docs/50-api/anti-entropia/huella-del-lote.json");
    }

    private boolean esQuienPublica() {
        Path clon = Path.of("").toAbsolutePath();
        while (clon != null && !Files.isDirectory(clon.resolve(".git"))) {
            clon = clon.getParent();
        }
        return clon != null && repositorioQuePublica().equals(clon.getFileName().toString());
    }

    private static final String PROCEDENCIA =
            "ARCHIVO GENERADO — no editar a mano. Fija el algoritmo de la huella de la"
                + " anti-entropia entre `catastro` y `rentas` (P6, punto 4). Lo publica `rentas` y"
                + " lo reproducen las dos implementaciones, cada una en su propio CI: si dejan de"
                + " coincidir, la comparacion de sectores da todo discrepante o nada discrepante, y"
                + " las dos cosas se leen como un problema de datos siendo un problema de codigo.";

    /** Un caso de los vectores. */
    private record Lote(
            long predioId,
            String codRefCatastral,
            String direccion,
            String sectorCodigo,
            String estado) {}
}
