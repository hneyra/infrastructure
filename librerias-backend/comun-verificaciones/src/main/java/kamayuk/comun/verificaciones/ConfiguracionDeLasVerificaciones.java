package kamayuk.comun.verificaciones;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.ServiceLoader;
import java.util.Set;

/**
 * Lo que cambia de un sistema a otro, declarado por el repositorio que consume las barreras.
 *
 * <p>Las reglas son las mismas en los cinco; lo que no es lo mismo es el paquete raiz y, sobre
 * todo, <b>la lista de tablas protegidas</b>: {@code recibo} es de {@code caja}, {@code
 * cuenta_corriente_asiento} es de {@code rentas} y {@code parametro_tributario} es de {@code
 * normativa}. Una lista unica obligaria a los cuatro a llevar dentro el vocabulario de los otros
 * tres, y entonces la lista deja de decir nada.
 *
 * <h2>Por que ServiceLoader y no un parametro</h2>
 *
 * <p>Porque el modo de fallo tiene que ser ruidoso. Si la configuracion se pasara por constructor,
 * un repositorio que no derivara las clases base simplemente no correria ninguna barrera y su CI
 * seguiria en verde: es el defecto exacto que este proyecto lleva doscientos issues evitando. Con
 * {@link ServiceLoader}, un repositorio sin proveedor falla al cargar la primera regla y lo dice
 * con todas las letras; y uno con dos proveedores tambien, porque entonces no se sabe cual manda.
 *
 * <p>El proveedor se declara en {@code src/test/resources/META-INF/services/} con el nombre
 * completo de esta interfaz.
 */
public interface ConfiguracionDeLasVerificaciones {

    /**
     * El paquete de las clases de muestra que violan cada regla a proposito.
     *
     * <p>Es fijo y vive en esta libreria, no en el repositorio que la consume: las muestras viajan
     * con las reglas. Las reglas vigilan este paquete <b>ademas</b> del raiz de produccion, porque
     * si no, una regla acotada a {@code paqueteRaiz() + ".."} no encontraria su propia muestra y
     * {@code ReglasDeArquitecturaMuerdenTest} pasaria en verde sin haber comprobado nada.
     */
    String PAQUETE_DE_MUESTRAS = "kamayuk.comun.verificaciones.muestras";

    /** El paquete raiz del codigo de produccion de este repositorio. */
    String paqueteRaiz();

    /** Como se llama este sistema en el reparto de tablas: {@code rentas}, {@code catastro}… */
    String sistema();

    /**
     * La raiz bajo la que este sistema publica su API, sin barra final: {@code /api/v1} en el
     * monolito, {@code /rentas/api/v1} despues del corte (ADR-0030).
     *
     * <p>La necesita la regla del centinela del ciudadano, que comprueba que un controlador con
     * {@code RequiereAcceso.CIUDADANO} cuelgue del portal. Esa comprobacion es una comparacion de
     * cadenas contra el camino que el controlador declara, asi que tiene que saber cual es la raiz
     * de ESTE sistema: con la raiz equivocada la regla no encuentra el portal de nadie y acusa al
     * unico controlador que si esta bien puesto.
     *
     * <p>Tiene valor por omision, y a proposito: los repositorios que todavia sirven bajo {@code
     * /api/v1} no tienen que declarar nada, y el que cambia de raiz lo declara en un solo sitio.
     */
    default String raizDeLaApi() {
        return "/api/v1";
    }

    /**
     * Los objetos de valor del dominio compartido que envuelven un decimal, sin el paquete raiz
     * delante: {@code ".dominio.Dinero"}.
     *
     * <p>Excepcion a {@code NINGUNA_FIRMA_DE_DOMINIO_EXPONE_BIGDECIMAL}, y la unica: la regla
     * existe para que las reglas tributarias no manejen {@code BigDecimal} suelto, no para impedir
     * que el tipo que lo guarda pueda devolverlo. Se declaran uno a uno para que agregar uno se vea
     * en el diff.
     *
     * <p>Por omision, los seis de {@code comun-dominio}.
     */
    default Set<String> envoltoriosDeDecimal() {
        return Set.of(
                ".dominio.Dinero",
                ".dominio.Alicuota",
                ".dominio.Porcentaje",
                ".dominio.AreaM2",
                ".dominio.ValorNormativo",
                // Un metrado alimenta un importe (NEG-05 §RT-005); por eso es un envoltorio y no
                // un BigDecimal suelto.
                ".dominio.Medida");
    }

    /**
     * RNF-051: las tablas cuyo borrado destruiria constancia de un acto administrativo.
     *
     * <p>Solo las de <b>este</b> sistema. Nombrar aqui una tabla que este sistema no tiene es peor
     * que no nombrarla: la lista deja de poder leerse como el inventario de lo que hay que cuidar.
     */
    Set<String> tablasProtegidas();

    /** Las tablas que no admiten {@code UPDATE}: se anula, se da de baja o se reversa (regla 4). */
    Set<String> tablasInmutables();

    /**
     * A que sistema pertenece cada tabla del esquema, para {@code
     * NINGUN_SQL_CRUZA_LA_FRONTERA_DE_SISTEMA}.
     *
     * <p>Es el reparto de GOB-05 §2, y se declara <b>entero</b> —las de los cuatro sistemas— aunque
     * este repositorio solo tenga las suyas: la regla necesita saber de quien es la tabla ajena
     * para poder decir a que frontera pertenece el cruce. Las transversales y las de seguridad, que
     * se replican en los cuatro, se declaran con {@link #SISTEMA_REPLICADO}.
     */
    Map<String, String> sistemaDeCadaTabla();

    /**
     * De que sistema es el archivo que se esta revisando.
     *
     * <p>Por omision, del sistema que declara {@link #sistema()}: en un repositorio ya separado,
     * todo su codigo es suyo.
     *
     * <p><b>En {@code sgtm} no</b>, y por eso existe este metodo: ahi conviven los cuatro sistemas
     * y el reparto es por modulo Gradle (GOB-05 §1). Sin esto, la regla acusaria a {@code catastro}
     * de leer sus propias tablas —o no acusaria a nadie de nada, segun que sistema se declarase—, y
     * en cualquiera de los dos casos no encontraria los cruces de §6, que es para lo que existe.
     *
     * @param rutaRelativa la ruta del archivo desde la raiz del arbol de modulos
     */
    default String sistemaDelArchivo(String rutaRelativa) {
        return sistema();
    }

    /**
     * Los modulos Gradle que {@link #sistemaDelArchivo(String)} reparte por nombre, si es que
     * reparte por modulo.
     *
     * <p><b>Existe porque el reparto por modulo falla en silencio, y se midio.</b> Los repositorios
     * que reparten lo hacen con un mapa {@code nombre del modulo -> sistema} consultado con {@code
     * getOrDefault(modulo, SISTEMA_REPLICADO)}: una clave que deja de coincidir —porque el modulo
     * se renombro— no da error, da <b>replicado</b>, y replicado significa «no esta a ningun lado
     * de la frontera, asi que no puede cruzarla». O sea que el SQL de ese modulo deja de revisarse
     * entero y {@code FronteraDeSistemaTest} sigue en VERDE. Medido en R-N: con {@code
     * kamayuk-rentas-nucleo} ya renombrado y la clave del mapa todavia diciendo {@code
     * kamayuk-rentas-rentas}, la prueba daba BUILD SUCCESSFUL con el modulo mas grande de {@code
     * rentas} —el contexto acotado entero— fuera de la revision.
     *
     * <p>Se comprueba una sola direccion, y a proposito: <b>todo modulo que el recorrido encuentre
     * en el disco tiene que estar declarado</b>. La contraria —que no sobre ninguna clave— no se
     * exige aqui porque los mapas de {@code catastro} y {@code caja} heredaron del monolito claves
     * de modulos que su repositorio no tiene, y esa poda es otro trabajo con otro criterio.
     *
     * <p>Por omision esta vacio, que es lo correcto para quien NO reparte por modulo: {@link
     * #sistemaDelArchivo(String)} sin sobrescribir devuelve el sistema entero y no hay ninguna
     * clave que se pueda quedar vieja.
     */
    default Set<String> modulosDelReparto() {
        return Set.of();
    }

    /**
     * Los cruces que hoy existen y todavia no se pueden cerrar, cada uno con su dueño.
     *
     * <p>Una excepcion sin issue no se acepta: la lista es el trabajo pendiente, y en la etapa P5E
     * tiene que llegar a cero. Ver {@link CruceConsentido}.
     */
    List<CruceConsentido> crucesConsentidos();

    /**
     * Los tipos de otro contexto que {@code fiscalizacion} puede LEER, uno por uno y sin el paquete
     * raiz delante: {@code ".catastro.LectorDeFichas"}.
     *
     * <p>Se escriben como sufijo porque la misma regla se aplica dos veces —al codigo de produccion
     * y a las clases de muestra, que viven bajo otro raiz— y una lista con el raiz dentro solo
     * serviria para una de las dos.
     *
     * <p>Vacia por omision: {@code catastro}, {@code normativa} y {@code caja} no tienen contexto
     * de fiscalizacion. Que este vacia no deja la regla muda —sus dos muestras viajan en esta
     * libreria y la siguen poniendo roja—, y que el contexto no exista lo comprueba {@code
     * ArquitecturaTestBase} contra {@link #ambitosAusentes()}.
     */
    default Set<String> tiposAjenosQueFiscalizacionSoloLee() {
        return Set.of();
    }

    /**
     * Los metodos transaccionales de escritura eximidos de la regla 10 porque no hay usuario que
     * observe, con la firma entera y sin el paquete raiz delante.
     *
     * <p>Se nombra el metodo, no la clase: cualquier otra escritura que se agregue a la misma clase
     * vuelve a estar sujeta a la regla.
     */
    default Set<String> escriturasSinUsuarioQueObserve() {
        return Set.of();
    }

    /**
     * Quien puede mover el contexto de municipalidad en el perfil {@code web}, sin el paquete raiz
     * delante.
     *
     * <p>Por omision, los tres de ARQ-03 §2: el filtro del borde, el recorrido por municipalidades
     * y la propia clase del contexto. Que cueste una linea es deliberado: el diff dice quien mas
     * puede mover lo que sostiene el aislamiento entero.
     */
    default Set<String> quienesPuedenMoverElContexto() {
        return Set.of(
                ".plataforma.tenant.TenantContextFilter",
                ".plataforma.RecorridoPorMunicipalidades",
                ".compartido.TenantContext");
    }

    /**
     * Los ambitos —segmentos de paquete— que este sistema NO tiene, y por eso dejan alguna regla
     * sin clases que revisar.
     *
     * <p>Hoy son dos y los dos son de {@code rentas}: {@code fiscalizacion} y {@code indicadores}.
     * Declararlos no apaga nada: {@code ArquitecturaTestBase} exige que un ambito declarado ausente
     * lo este de verdad —si aparece una clase suya, la prueba se pone roja pidiendo que se retire
     * de la lista— y que uno no declarado tenga clases. Es lo que impide que {@code
     * allowEmptyShould(true)} se convierta en una regla que no puede fallar.
     */
    default Set<String> ambitosAusentes() {
        return Set.of();
    }

    /**
     * Los paquetes que este sistema declara suyos y que el importador de ArchUnit tiene que ver.
     *
     * <p>Es la guarda de «hay clases que revisar» dicha con nombres: sin ella, la asercion se
     * conforma con que haya <b>algo</b>, y un classpath a medias —un modulo que dejo de estar en
     * las dependencias— pasaria en verde.
     */
    Set<String> paquetesQueTienenQueExistir();

    /** Las clases que componen el area a mano y dicen por que (#607). */
    Set<String> componenElAreaAManoConMotivo();

    /**
     * Si este repositorio todavia no tiene <b>ningun contexto acotado</b>: solo infraestructura.
     *
     * <p>No dice «no hay codigo»: los cuatro repositorios nuevos tienen desde el primer dia su
     * migrador y su prueba de aislamiento. Dice que no hay <b>negocio</b>, y eso se mide donde el
     * negocio vive: en {@code ..dominio..}. Las reglas siguen corriendo sobre lo que hay; lo que se
     * suspende son las aserciones que exigen un sistema completo —que el dominio tenga clases, que
     * el recorrido de fuentes encuentre mas de diez archivos—.
     *
     * <p>Es una exencion <b>que caduca sola</b>: cuando se declara, se exige que en efecto no haya
     * ni una clase de dominio. La primera que llegue pone la prueba en rojo pidiendo que se retire,
     * que es lo contrario de una exencion que se queda dentro para siempre.
     */
    default boolean sinContextosAcotadosTodavia() {
        return false;
    }

    /**
     * Cuantas fuentes de produccion tiene que encontrar el escaner como minimo.
     *
     * <p>Si el recorrido no encuentra archivos, el escaner pasa sin revisar nada, y eso no se nota.
     * El minimo es lo que lo impide, y es un numero de cada repositorio: en el monolito son
     * centenares y en uno que acaba de nacer son dos.
     */
    default int minimoDeFuentesDeProduccion() {
        return 10;
    }

    /** Lo mismo para el escaner de aserciones, que recorre {@code src/test}. */
    default int minimoDePruebas() {
        return 100;
    }

    /**
     * La raiz del arbol de modulos Gradle, desde donde se recorren {@code src/main} y {@code
     * src/test}.
     *
     * <p>Por omision es el primer ancestro del directorio de trabajo que tiene un {@code
     * settings.gradle.kts}: es donde estan los modulos en los cinco repositorios.
     */
    default Path raizDelCodigo() {
        Path actual = Path.of("").toAbsolutePath();
        while (actual != null) {
            if (Files.exists(actual.resolve("settings.gradle.kts"))) {
                return actual;
            }
            actual = actual.getParent();
        }
        throw new IllegalStateException(
                "No se encontro la raiz del build: ningun ancestro de "
                        + Path.of("").toAbsolutePath()
                        + " tiene settings.gradle.kts");
    }

    /** El valor de {@link #sistemaDeCadaTabla()} para una tabla que se replica en los cuatro. */
    String SISTEMA_REPLICADO = "*";

    /**
     * Un cruce de SQL que hoy atraviesa la frontera de otro sistema y que todavia no se cierra.
     *
     * @param clase la clase que lo hace, por su nombre simple
     * @param tabla la tabla ajena que consulta
     * @param issue quien lo va a cerrar. No se admite en blanco: una excepcion sin dueño no es una
     *     excepcion, es un olvido con permiso
     */
    record CruceConsentido(String clase, String tabla, String issue) {
        public CruceConsentido {
            if (clase == null || clase.isBlank()) {
                throw new IllegalArgumentException(
                        "Un cruce consentido tiene que nombrar su clase");
            }
            if (tabla == null || tabla.isBlank()) {
                throw new IllegalArgumentException(
                        "Un cruce consentido tiene que nombrar su tabla");
            }
            if (issue == null || issue.isBlank()) {
                throw new IllegalArgumentException(
                        "El cruce de "
                                + clase
                                + " sobre "
                                + tabla
                                + " no dice quien lo cierra. Una excepcion sin issue no se acepta:"
                                + " la lista de excepciones ES la lista de trabajo pendiente, y en"
                                + " P5E tiene que llegar a cero");
            }
        }
    }

    /**
     * La configuracion de este repositorio, o un fallo que dice exactamente que falta.
     *
     * <p>Se resuelve una sola vez y se guarda: {@link ServiceLoader} recorre el classpath, y las
     * reglas la piden desde el inicializador estatico.
     */
    static ConfiguracionDeLasVerificaciones actual() {
        return Resolucion.UNICA;
    }

    /** Contenedor del singleton. Una interfaz no puede tener campos estaticos privados. */
    final class Resolucion {
        private Resolucion() {}

        static final ConfiguracionDeLasVerificaciones UNICA = resolver();

        private static ConfiguracionDeLasVerificaciones resolver() {
            List<ConfiguracionDeLasVerificaciones> encontradas =
                    ServiceLoader.load(ConfiguracionDeLasVerificaciones.class).stream()
                            .map(ServiceLoader.Provider::get)
                            .toList();
            if (encontradas.isEmpty()) {
                throw new IllegalStateException(
                        "Ningun proveedor de "
                                + ConfiguracionDeLasVerificaciones.class.getName()
                                + " en el classpath de prueba. Sin el, las barreras de"
                                + " comun-verificaciones no saben ni cual es el paquete raiz ni"
                                + " que tablas protege este sistema, y correrian sin revisar nada."
                                + " Declaralo en"
                                + " src/test/resources/META-INF/services/"
                                + ConfiguracionDeLasVerificaciones.class.getName());
            }
            if (encontradas.size() > 1) {
                throw new IllegalStateException(
                        "Hay "
                                + encontradas.size()
                                + " proveedores de configuracion en el classpath ("
                                + encontradas.stream()
                                        .map(c -> c.getClass().getName())
                                        .sorted()
                                        .toList()
                                + ") y no se sabe cual manda. Tiene que haber exactamente uno por"
                                + " repositorio");
            }
            return encontradas.get(0);
        }
    }
}
