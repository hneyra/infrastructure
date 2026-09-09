package kamayuk.comun.verificaciones;

import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.domain.JavaMethod;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Contrasta las listas de {@link ConfiguracionDeLasVerificaciones} contra el arbol que se esta
 * verificando: <b>ninguna entrada puede nombrar algo que no esta</b>.
 *
 * <h2>Por que existe, medido y no supuesto</h2>
 *
 * <p>Todas esas listas se consultan por NOMBRE, con {@code contains} o con {@code getOrDefault(…,
 * SISTEMA_REPLICADO)}. Un nombre que no casa con nada <b>no es un error</b>: simplemente no exime,
 * no permite o no clasifica a nadie, y el conjunto sigue en verde. Es la misma forma de defecto que
 * este proyecto ha medido cuatro veces por cuatro ejes distintos —los modulos en R-N, las tablas en
 * {@code catastro#7} desde el dueño y desde los otros tres, los tipos en {@code catastro#25}— y
 * siempre dice lo mismo: <b>un mapa o un conjunto consultado por nombre con un valor por omision no
 * distingue «no esta» de «no aplica»</b>.
 *
 * <p>La medida que abrio {@code hneyra/infrastructure#27}: se borro {@code
 * kamayuk.catastro.fiscalizacion.dominio.Tolerancia} y se dejo su nombre en {@code
 * envoltoriosDeDecimal()}. {@code ./gradlew verificarArquitectura} salio {@code BUILD SUCCESSFUL}.
 * No sale un rojo, no sale un aviso: la entrada apunta a la nada y deja de eximir a nadie, en
 * verde. Es inocuo hoy y por eso peor mañana — el dia que alguien cree otra clase con ese nombre
 * queda eximida sin que nadie lo haya decidido.
 *
 * <h2>Las ocho listas NO se comportan igual, y el criterio no es «existe»</h2>
 *
 * <p>El criterio es <b>que cuesta que una entrada no case</b>, y ahi las ocho se parten en dos:
 *
 * <ul>
 *   <li><b>Seis EXIMEN o PERMITEN</b> —{@code envoltoriosDeDecimal}, {@code
 *       tiposAjenosQueFiscalizacionSoloLee}, {@code escriturasSinUsuarioQueObserve}, {@code
 *       quienesPuedenMoverElContexto}, {@code busquedasDeTextoLibreConMotivo} y {@code
 *       escritoresDeLaAutorizacionConMotivo}—: una entrada sin sujeto es un permiso que hoy no usa
 *       nadie y que mañana usara quien nazca con ese nombre. Esas tienen que <b>cuadrar</b>, y por
 *       eso {@link #exencionesSinSujeto} es un rojo. La sexta solo se contrasta <b>si el
 *       repositorio la ha declarado</b>: por omision devuelve {@code null}, que significa «la
 *       prohibicion de ADR-0039 todavia no esta activa aqui» y no «no exime a nadie».
 *   <li><b>Dos DECLARAN o REPARTEN</b> —{@code modulosDelReparto} y {@code ambitosAusentes}—: no
 *       eximen a nadie, y la direccion que si cuesta ya la cierra otra guarda. Van a {@link
 *       #declaracionesSinSujeto}, que es un <b>censo con su motivo</b> y no un rojo. El porque de
 *       cada una esta en su metodo.
 * </ul>
 *
 * <p>Marcar de rojo las dos ultimas pondria roja la mitad de los consumidores el primer dia sobre
 * entradas que no hacen daño, y una comprobacion que grita en lo correcto se acaba apagando (#437).
 * Marcar de censo las seis primeras dejaria el defecto exacto que este trabajo existe para cerrar.
 *
 * <p>No hay lista de excepciones, y es deliberado: una excepcion para «entradas muertas» seria una
 * puerta abierta a justo el defecto. El remedio de una entrada sin sujeto es <b>borrarla</b>, o —si
 * nombra algo que va a existir— traer la clase.
 */
public final class SujetosDeLaConfiguracion {

    private SujetosDeLaConfiguracion() {}

    /**
     * Una entrada de la configuracion que no nombra nada del arbol.
     *
     * @param lista el metodo de {@link ConfiguracionDeLasVerificaciones} que la declara
     * @param entrada el valor, tal como esta escrito
     * @param remedio que hacer con ella, en una linea
     */
    public record EntradaSinSujeto(String lista, String entrada, String remedio) {
        @Override
        public String toString() {
            return lista + "() → «" + entrada + "»: " + remedio;
        }
    }

    /**
     * Las seis listas que eximen o permiten, contrastadas contra las clases importadas.
     *
     * <p>Se miran los DOS arboles —produccion y muestras—, que es exactamente lo que hace {@code
     * ReglasDeArquitectura.bajoLasDosRaices}: la exencion esta viva si cualquiera de los dos
     * nombres casa. Contrastar solo contra produccion pondria rojas las entradas que existen para
     * que la regla pueda demostrarse sobre su muestra.
     */
    public static List<EntradaSinSujeto> exencionesSinSujeto(
            ConfiguracionDeLasVerificaciones config, JavaClasses produccion, JavaClasses muestras) {
        Set<String> tipos = nombresDeTipo(produccion, muestras);
        Set<String> metodos = firmasDeMetodo(produccion, muestras);
        Set<String> simples = nombresSimples(produccion);

        List<EntradaSinSujeto> sinSujeto = new ArrayList<>();

        // 1. envoltoriosDeDecimal(): exime de NINGUNA_FIRMA_DE_DOMINIO_EXPONE_BIGDECIMAL.
        agregarTipos(
                sinSujeto,
                "envoltoriosDeDecimal",
                config.envoltoriosDeDecimal(),
                config.paqueteRaiz(),
                tipos,
                "no exime a ningun tipo: la regla del BigDecimal desnudo corre hoy sin esta"
                        + " excepcion, y el dia que nazca una clase con ese nombre quedara eximida"
                        + " sin que nadie lo decida");

        // 2. tiposAjenosQueFiscalizacionSoloLee(): exime de la frontera de fiscalizacion.
        agregarTipos(
                sinSujeto,
                "tiposAjenosQueFiscalizacionSoloLee",
                config.tiposAjenosQueFiscalizacionSoloLee(),
                config.paqueteRaiz(),
                tipos,
                "no clasifica a ningun tipo, asi que la frontera de fiscalizacion corre hoy sin"
                        + " esta excepcion; el dia que exista, `fiscalizacion` podra depender de"
                        + " ella sin que nadie lo haya decidido");

        // 3. quienesPuedenMoverElContexto(): permite mover TenantContext en el perfil web.
        agregarTipos(
                sinSujeto,
                "quienesPuedenMoverElContexto",
                config.quienesPuedenMoverElContexto(),
                config.paqueteRaiz(),
                tipos,
                "no autoriza a nadie, y esta lista es lo que sostiene el aislamiento entero"
                        + " (ARQ-03 §2): una entrada muerta aqui autoriza mañana a la clase que"
                        + " nazca con ese nombre a mover el contexto de una peticion en curso");

        // 4. escriturasSinUsuarioQueObserve(): exime de la regla 10, y nombra el METODO entero.
        for (String entrada : ordenadas(config.escriturasSinUsuarioQueObserve())) {
            if (bajoLasDosRaices(entrada, config.paqueteRaiz()).stream()
                    .noneMatch(metodos::contains)) {
                sinSujeto.add(
                        new EntradaSinSujeto(
                                "escriturasSinUsuarioQueObserve",
                                entrada,
                                "ningun metodo del arbol tiene esa firma, asi que no exime a nadie"
                                        + " de la regla 10; el dia que aparezca, escribira sin"
                                        + " observacion sin que nadie lo haya decidido. Se nombra"
                                        + " la firma ENTERA, como la escribe"
                                        + " JavaMethod.getFullName()"));
            }
        }

        // 5. busquedasDeTextoLibreConMotivo(): exime del escaner de busqueda por prefijo, y se
        // nombra por el NOMBRE SIMPLE de la clase porque el escaner mira el nombre del archivo.
        // La muestra no entra a proposito —tiene que seguir detectandose—, asi que aqui se
        // contrasta solo contra produccion.
        for (String entrada : ordenadas(config.busquedasDeTextoLibreConMotivo())) {
            if (!simples.contains(entrada)) {
                sinSujeto.add(
                        new EntradaSinSujeto(
                                "busquedasDeTextoLibreConMotivo",
                                entrada,
                                "no hay ninguna clase de produccion con ese nombre, asi que el"
                                        + " escaner de ADR-0034 §3 no exime a nadie. Y esta lista"
                                        + " ES la lista de trabajo pendiente: una entrada que no"
                                        + " nombra nada la hace decir de mas"));
            }
        }

        // 6. escritoresDeLaAutorizacionConMotivo(): exime de ADR-0039, y se nombra por el NOMBRE
        // SIMPLE de la clase porque el escaner mira el nombre del archivo. `null` no es una lista
        // vacia: es «este repositorio todavia no la declaro», y entonces no hay nada que
        // contrastar — el motivo esta en el javadoc del metodo, con lo que cuesta escrito.
        Set<String> escritores = config.escritoresDeLaAutorizacionConMotivo();
        if (escritores != null) {
            for (String entrada : ordenadas(escritores)) {
                if (!simples.contains(entrada)) {
                    sinSujeto.add(
                            new EntradaSinSujeto(
                                    "escritoresDeLaAutorizacionConMotivo",
                                    entrada,
                                    "no hay ninguna clase de produccion con ese nombre, asi que no"
                                            + " exime a nadie de ADR-0039. Y esta lista es el trabajo"
                                            + " pendiente de la etapa 4 con su fecha de fin: una"
                                            + " entrada que no nombra nada la hace decir de mas, y el"
                                            + " dia que nazca una clase con ese nombre podra escribir"
                                            + " la autorizacion sin que nadie lo haya decidido"));
                }
            }
        }

        return sinSujeto.stream()
                .sorted(
                        Comparator.comparing(EntradaSinSujeto::lista)
                                .thenComparing(EntradaSinSujeto::entrada))
                .toList();
    }

    /**
     * Las dos listas que declaran o reparten: censo, no rojo.
     *
     * <p><b>{@code modulosDelReparto()}</b> no exime: clasifica. La direccion que cuesta —un modulo
     * del disco que nadie declaro, que cae en {@code SISTEMA_REPLICADO} y deja de revisarse— la
     * cierra {@code FronteraDeSistemaTestBase} desde R-N. La contraria es inerte hoy: una clave que
     * no casa con ningun directorio no se consulta nunca. Y su poda esta declarada como otro
     * trabajo en el javadoc de {@code modulosDelReparto()}, porque {@code catastro} y {@code caja}
     * heredaron del monolito claves de modulos que su repositorio no tiene.
     *
     * <p><b>{@code ambitosAusentes()}</b> tiene el criterio INVERTIDO: la entrada afirma una
     * AUSENCIA, asi que «no casa nada» es justamente lo que declara. Lo que si es una entrada
     * muerta ahi es un ambito que <b>ninguna regla acota</b>: nadie la consulta. Y es
     * <b>autocorrectiva</b> — el dia que una regla acote ese ambito, el censo que {@code
     * ArquitecturaTestBase} ya lleva la mira y se pone rojo solo si miente. Por eso va al censo y
     * se anota ademas si el ambito declarado ausente tiene clases, que es una afirmacion falsa
     * aunque hoy no la lea nadie.
     */
    public static List<EntradaSinSujeto> declaracionesSinSujeto(
            ConfiguracionDeLasVerificaciones config,
            JavaClasses produccion,
            Set<String> modulosDelDisco,
            Set<String> ambitosAcotados) {
        List<EntradaSinSujeto> censo = new ArrayList<>();

        for (String modulo : ordenadas(config.modulosDelReparto())) {
            if (!modulosDelDisco.contains(modulo)) {
                censo.add(
                        new EntradaSinSujeto(
                                "modulosDelReparto",
                                modulo,
                                "no hay ningun modulo con ese nombre en el disco: la clave no se"
                                        + " consulta nunca, y el dia que ese modulo exista quedara"
                                        + " repartido por una decision que nadie tomo hoy"));
            }
        }

        Set<String> paquetes =
                produccion.stream().map(JavaClass::getPackageName).collect(Collectors.toSet());
        for (String ambito : ordenadas(config.ambitosAusentes())) {
            // El MISMO predicado que usa el unico consumidor de esta lista, `ArquitecturaTestBase`,
            // y a proposito: el censo tiene que decir lo que aquel veria. Escribirlo de otra manera
            // —admitiendo el paquete hoja, por ejemplo— haria que el censo y la guarda hablaran de
            // conjuntos distintos, que es la forma de defecto que este archivo existe para cerrar.
            boolean tieneClases = paquetes.stream().anyMatch(p -> p.contains("." + ambito + "."));
            if (tieneClases) {
                censo.add(
                        new EntradaSinSujeto(
                                "ambitosAusentes",
                                ambito,
                                "se declara ausente y TIENE clases: la afirmacion es falsa. Hoy no"
                                        + " la lee nadie porque ninguna regla acota ese ambito; el"
                                        + " dia que alguna lo acote, el censo de"
                                        + " ArquitecturaTestBase se pondra rojo solo"));
            } else if (!ambitosAcotados.contains(ambito)) {
                censo.add(
                        new EntradaSinSujeto(
                                "ambitosAusentes",
                                ambito,
                                "ninguna regla acota ese ambito, asi que declararlo ausente no"
                                        + " apaga nada y no lo consulta nadie"));
            }
        }

        return censo.stream()
                .sorted(
                        Comparator.comparing(EntradaSinSujeto::lista)
                                .thenComparing(EntradaSinSujeto::entrada))
                .toList();
    }

    /**
     * Los modulos Gradle que hay en el disco: los directorios de la raiz con {@code src/main/java}.
     *
     * <p>Se cuentan del disco y no de una lista escrita al lado, por lo mismo que {@code
     * FronteraDeSistemaTestBase} recorre las fuentes: una lista es un segundo sitio con la misma
     * verdad, y el que se quede viejo es el que decide.
     */
    public static Set<String> modulosDelDisco(Path raiz) {
        try (Stream<Path> hijos = Files.list(raiz)) {
            return hijos.filter(p -> Files.isDirectory(p.resolve("src/main/java")))
                    .map(p -> p.getFileName().toString())
                    .collect(Collectors.toCollection(TreeSet::new));
        } catch (IOException e) {
            throw new UncheckedIOException("No se pudo listar los modulos bajo " + raiz, e);
        }
    }

    private static void agregarTipos(
            List<EntradaSinSujeto> destino,
            String lista,
            Set<String> entradas,
            String paqueteRaiz,
            Set<String> tipos,
            String remedio) {
        for (String entrada : ordenadas(entradas)) {
            if (bajoLasDosRaices(entrada, paqueteRaiz).stream().noneMatch(tipos::contains)) {
                destino.add(new EntradaSinSujeto(lista, entrada, remedio));
            }
        }
    }

    /**
     * El mismo sufijo bajo los dos arboles, igual que {@code ReglasDeArquitectura}.
     *
     * <p>Se repite aqui —y no se comparte— porque aquel es privado y estatico sobre el paquete raiz
     * ya resuelto: esta clase recibe la configuracion como parametro para poder demostrarse con una
     * de muestra, que es lo unico que hace que la guarda pueda ponerse roja a voluntad.
     */
    private static List<String> bajoLasDosRaices(String sufijo, String paqueteRaiz) {
        return List.of(
                paqueteRaiz + sufijo,
                ConfiguracionDeLasVerificaciones.PAQUETE_DE_MUESTRAS + sufijo);
    }

    private static Set<String> nombresDeTipo(JavaClasses... arboles) {
        return Stream.of(arboles)
                .flatMap(a -> a.stream())
                .map(JavaClass::getName)
                .collect(Collectors.toSet());
    }

    private static Set<String> firmasDeMetodo(JavaClasses... arboles) {
        return Stream.of(arboles)
                .flatMap(a -> a.stream())
                .flatMap(c -> c.getMethods().stream())
                .map(JavaMethod::getFullName)
                .collect(Collectors.toSet());
    }

    private static Set<String> nombresSimples(JavaClasses arbol) {
        return arbol.stream().map(JavaClass::getSimpleName).collect(Collectors.toSet());
    }

    private static List<String> ordenadas(Set<String> valores) {
        return valores.stream().sorted().toList();
    }
}
