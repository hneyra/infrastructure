package kamayuk.comun.verificaciones;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Las reglas de ARQ-04 §2 que viven en el texto del SQL y no en la estructura de las clases: {@code
 * SET SESSION}, el {@code DELETE} sobre tablas protegidas y el {@code UPDATE} sobre las inmutables.
 * Y una que vive en el texto del Java: la politica de redondeo escrita a mano, que D-03a y D-03b
 * prohiben.
 *
 * <p>Y otra que vive en el texto del Java y tampoco es una dependencia entre tipos: un area
 * convertida a cadena a mano (#607), que es como el mismo predio acabo diciendo «360.00 m2» en
 * catastro y «360.00» en fiscalizacion.
 *
 * <p>ArchUnit no las ve porque no son dependencias entre tipos, sino cadenas.
 *
 * <p><b>Solo mira literales de cadena</b>, no comentarios ni javadoc. Sin eso, cada documento del
 * propio codigo que explica por que {@code SET SESSION} esta prohibido seria una violacion, y la
 * regla acabaria desactivada por ruidosa — que es la forma habitual de perder una verificacion.
 *
 * <p>Es una funcion pura sobre texto para poder probarla con muestras, en vez de confiar en que
 * recorre bien el arbol de archivos.
 */
public final class RevisorDeCodigoFuente {

    /**
     * Lo que este repositorio declara de si mismo (ServiceLoader).
     *
     * <p>Las dos listas de tablas <b>no son las mismas en los cuatro sistemas</b> —{@code recibo}
     * es de {@code caja}, {@code cuenta_corriente_asiento} es de {@code rentas}, {@code
     * parametro_tributario} es de {@code normativa}— y una lista unica obligaria a los cuatro a
     * llevar dentro el vocabulario de los otros tres. Entonces la lista deja de leerse como el
     * inventario de lo que hay que cuidar, que es justo lo que la hace util.
     */
    private static final ConfiguracionDeLasVerificaciones CONFIG =
            ConfiguracionDeLasVerificaciones.actual();

    /**
     * RNF-051: no se borra deuda, pagos, recibos, valores, papeletas, asientos ni auditoria.
     *
     * <p>La lista es la de las tablas de ESTE sistema cuyo borrado destruiria constancia de un acto
     * administrativo. Al agregar una tabla de esa naturaleza, agregarla a la configuracion del
     * repositorio.
     */
    public static final Set<String> TABLAS_PROTEGIDAS =
            conLasDeLasMuestras(
                    CONFIG.tablasProtegidas(),
                    Set.of(
                            "anuncio",
                            "certificado",
                            "cierre_turno",
                            "cierre_turno_detalle",
                            "convenio_deuda",
                            "costa_procesal",
                            "cuenta_corriente_asiento",
                            "declaracion_jurada",
                            "descargo",
                            "edificacion_estructura",
                            "licencia_duplicado",
                            "liquidacion_detalle",
                            "notificacion",
                            "papeleta_masivo",
                            "recibo",
                            "recibo_detalle",
                            "recibo_movimiento",
                            "resolucion_determinacion"));

    /**
     * Las tablas que no admiten {@code UPDATE}: se anula, se da de baja o se reversa (regla 4).
     *
     * <p>Misma forma y mismo motivo que {@link #TABLAS_PROTEGIDAS}: la declara el repositorio.
     */
    public static final Set<String> TABLAS_INMUTABLES =
            conLasDeLasMuestras(
                    CONFIG.tablasInmutables(),
                    Set.of(
                            "acto_coactivo",
                            "anuncio",
                            "anuncio_movimiento",
                            "auditoria",
                            "certificado",
                            "cierre_caja",
                            "cierre_turno",
                            "cierre_turno_detalle",
                            "constancia_libre",
                            "convenio",
                            "convenio_cuota",
                            "convenio_movimiento",
                            "costa_obligacion",
                            "costa_procesal",
                            "cuenta_corriente_asiento",
                            "edificacion_terreno",
                            "edificacion_vigencia",
                            "internamiento",
                            "licencia_edificacion",
                            "licencia_funcionamiento",
                            "licencia_movimiento",
                            "liquidacion_costas",
                            "liquidacion_detalle",
                            "liquidacion_fiscalizacion",
                            "liquidacion_movimiento",
                            "papeleta_masivo",
                            "recibo",
                            "recibo_detalle",
                            "recibo_movimiento",
                            "resolucion_determinacion",
                            "resolucion_gerencia"));

    /**
     * Las tablas del sistema, mas las que nombran las clases de muestra de esta libreria.
     *
     * <p>Las muestras hablan de {@code recibo}, {@code convenio} y {@code licencia_edificacion}
     * porque de ahi salieron; en {@code catastro} esas tablas no existen, y si el escaner no las
     * conociera sus muestras dejarian de detectarse y {@code ProhibicionesEnElCodigoFuenteTestBase}
     * pasaria en verde sin haber comprobado que el escaner muerde. Que un sistema vigile de mas un
     * nombre que no tiene no cuesta nada —ningun archivo suyo lo menciona— y lo que compra es que
     * la demostracion valga en los cinco repositorios.
     */
    private static Set<String> conLasDeLasMuestras(
            Set<String> delSistema, Set<String> deLasMuestras) {
        return Stream.concat(delSistema.stream(), deLasMuestras.stream())
                .collect(java.util.stream.Collectors.toUnmodifiableSet());
    }

    /** {@code SET SESSION}, en cualquier espaciado. */
    private static final Pattern SET_SESSION =
            Pattern.compile("\\bset\\s+session\\b", Pattern.CASE_INSENSITIVE);

    /** {@code set_config(..., false)}: la forma de sesion, equivalente a SET SESSION. */
    private static final Pattern SET_CONFIG_DE_SESION =
            Pattern.compile("\\bset_config\\s*\\([^)]*,\\s*false\\s*\\)", Pattern.CASE_INSENSITIVE);

    private static final Pattern DELETE_FROM =
            Pattern.compile("\\bdelete\\s+from\\s+(\\w+)", Pattern.CASE_INSENSITIVE);

    private static final Pattern UPDATE_TABLA =
            Pattern.compile("\\bupdate\\s+(\\w+)\\s+set\\b", Pattern.CASE_INSENSITIVE);

    /** Bloque de texto de Java: {@code """…"""}, donde vive el SQL de varias lineas. */
    private static final Pattern BLOQUE_DE_TEXTO = Pattern.compile("(?s)\"\"\".*?\"\"\"");

    /** Literal de cadena de Java, incluidos los escapes. */
    private static final Pattern LITERAL_JAVA = Pattern.compile("\"(?:[^\"\\\\\\n]|\\\\.)*\"");

    /**
     * Un modo de redondeo escrito en el codigo.
     *
     * <p>D-03 no esta cerrada: no esta decidido con cuantos decimales se redondea (D-03a), con que
     * modo (D-03b), ni —lo que mas pesa— en que puntos del calculo (D-03c). Un {@code HALF_UP}
     * escrito hoy es esa decision tomada por descuido, repartida por el codigo y dificil de
     * encontrar despues. La politica se recibe como argumento: {@code PoliticaDeRedondeo}.
     *
     * <p>{@code UNNECESSARY} queda fuera a proposito: no es una politica de redondeo sino su
     * negacion, y es lo que el propio tipo usa para rechazarla.
     */
    private static final Pattern MODO_DE_REDONDEO_ESCRITO =
            Pattern.compile(
                    "\\bRoundingMode\\s*\\.\\s*(HALF_UP|HALF_DOWN|HALF_EVEN|CEILING|FLOOR|UP|DOWN)\\b");

    /**
     * {@code setScale(2, ...)}: la escala escrita a mano. Mismo motivo, misma familia de decisiones
     * (D-03a).
     */
    private static final Pattern ESCALA_ESCRITA =
            Pattern.compile("\\.\\s*setScale\\s*\\(\\s*[0-9]");

    /**
     * Un valor tributario construido desde un literal.
     *
     * <p>Regla 5: ninguna cifra normativa vive en el codigo. Una alicuota, un porcentaje o un valor
     * normativo construidos desde una cadena literal en {@code src/main} son exactamente eso: un
     * tramo, una tasa o una UIT compilados dentro del artefacto, que solo se pueden cambiar
     * desplegando —con lo que se acaban sin cambiar, y calculando con los del ano pasado—.
     *
     * <p>{@code Dinero} no entra en la lista: un importe literal en produccion casi siempre es un
     * cero o un tope tecnico, y prohibirlo daria mas falsos positivos que hallazgos. Lo que si es
     * casi siempre normativo es lo otro.
     *
     * <p><b>Y el constructor cuenta igual que la fabrica</b> (#72). Hasta aqui el patron solo
     * miraba {@code Alicuota.de("50")}, asi que {@code new Alicuota(new BigDecimal("50"))} pasaba
     * sin ruido —lo destapo una rotura de #72 que puso un descuento por omision y que este escaner
     * no vio—. Son la misma cifra compilada escrita de otra manera, y la segunda forma es
     * <b>mas</b> probable justo donde importa: dentro de una expresion, no en una constante con
     * nombre que delate la intencion. El {@code new BigDecimal} intermedio es opcional en el patron
     * porque las dos formas —con y sin— construyen lo mismo.
     */
    private static final Pattern VALOR_TRIBUTARIO_LITERAL =
            Pattern.compile(
                    "\\b(Alicuota|Porcentaje|ValorNormativo)\\s*\\.\\s*de\\s*\\(\\s*[\"0-9]"
                            + "|\\bnew\\s+(Alicuota|Porcentaje|ValorNormativo)\\s*\\(\\s*"
                            + "(new\\s+BigDecimal\\s*\\(\\s*)?[\"0-9]");

    /**
     * Una constante con nombre de valor normativo y una cifra dentro.
     *
     * <p>Es la otra forma en que aparece: no llamando a {@code Alicuota.de}, sino declarando {@code
     * private static final BigDecimal UIT = new BigDecimal("5350")}. El nombre delata la intencion,
     * y por eso la lista es de nombres y no de tipos.
     *
     * <p>{@code PLAZO} y {@code PRESCRIPCION} entran con #39. Un plazo del Codigo Tributario es una
     * cifra normativa igual que una alicuota, y compilarlo tiene una consecuencia peor: la alicuota
     * equivocada cobra de mas o de menos, mientras que el plazo equivocado produce expedientes
     * coactivos <b>nulos</b>, que se descubren cuando el primero se impugna. La delimitacion {@code
     * \b} es la que hace esto usable: solo caza identificadores que <b>empiezan</b> por esas
     * palabras, asi que {@code TIPO_PARAMETRO_PLAZO = "PLAZO"} —el nombre del tipo con el que se
     * LEE el parametro— no es un hallazgo, y {@code PLAZO_DE_RECLAMACION = 20} si.
     *
     * <p>Con #35, {@code INTERES_MORATORIO} <b>se ensancha a {@code INTERES}</b> y entra {@code
     * CUOTAS}. El interes de un convenio de fraccionamiento no es el moratorio del art. 33 —es el
     * de la ordenanza de fraccionamiento, D-02b— y con la lista anterior un {@code
     * INTERES_DE_FRACCIONAMIENTO = new BigDecimal("0.01")} pasaba sin ruido: el {@code \b} exige
     * que el identificador <b>empiece</b> por la palabra, y no empieza por {@code
     * INTERES_MORATORIO}. {@code CUOTAS} cubre el maximo de cuotas, que es la otra cifra de esa
     * misma ordenanza y cuya consecuencia es un convenio a plazo que nada respalda.
     *
     * <p>Con #42 entra {@code COSTA}. {@code ARANCEL} ya estaba y caza {@code ARANCEL_COSTA_REC1 =
     * new BigDecimal("35.00")}, pero <b>no</b> caza {@code COSTA_DE_LA_REC1 = ...} ni {@code
     * COSTAS_POR_ACTO = ...}, que es exactamente como se escribiria si a alguien le pareciera que
     * «treinta y cinco soles por resolucion» es un detalle de implementacion. El arancel de costas
     * es de ordenanza local —D-02c, #193 esta bloqueado esperandolo— y compilarlo produce un cobro
     * sin sustento normativo en toda la cartera coactiva.
     *
     * <p>Con #51 entran {@code TASA} y {@code TARIFA}. La tasa por anuncios y propaganda la fija
     * una ordenanza municipal ratificada por la provincia —D-02b, #199 esta bloqueado esperandola—
     * y <b>ninguna palabra de la lista anterior la cazaba</b>: {@code TASA_PANEL = new
     * BigDecimal("90.00")} pasaba sin ruido, igual que {@code INTERES_DE_FRACCIONAMIENTO} pasaba
     * antes de #35 y {@code COSTA_DE_LA_REC2} antes de #42. Es la tercera vez que el mismo hueco
     * aparece, y siempre del mismo modo: una familia de cifras nueva con un nombre nuevo.
     *
     * <p>{@code TARIFA} va con ella porque es como se escribe la misma cifra cuando a alguien le
     * parece que «tasa» suena a tributo: {@code TARIFA_POR_M2 = ...} es exactamente el mismo dato.
     *
     * <p>Con #52 entra {@code MULTA}, y es la cuarta vez que el mismo hueco se abre por el mismo
     * sitio. La transferencia a rentas asienta, junto al tributo omitido, la <b>multa tributaria
     * del art. 176 del Codigo Tributario</b>, que se expresa como un porcentaje de la UIT y depende
     * ademas del regimen de gradualidad; es D-02c, y hasta que cierre la liquidacion la deja en
     * {@code null} (#198). Nada de la lista anterior caza {@code MULTA_DEL_ARTICULO_176 = new
     * BigDecimal("0.50")}: no empieza por {@code UIT}, ni por {@code ALICUOTA}, ni por {@code
     * TRAMO}. Y la consecuencia de compilarla no es cobrar de mas o de menos: es sancionar sin
     * norma que lo sostenga, en todo el padron fiscalizado a la vez.
     *
     * <p>Con #54 entra {@code VIGENCIA}. Un certificado de numeracion o de zonificacion vale
     * <b>tantos meses</b>, y cuantos lo fija el TUPA de cada municipalidad (D-02b). Es la quinta
     * vez que aparece el mismo hueco: {@code VIGENCIA_DEL_CERTIFICADO = 36} no empieza por ninguna
     * de las quince palabras anteriores —ni por {@code PLAZO}, que es lo que mas se le parece— y
     * pasaba sin ruido. Su consecuencia es propia y peor que la de una tarifa: un certificado con
     * una vigencia inventada no cobra de mas, <b>autoriza de mas</b>. Uno que caduca demasiado
     * tarde deja construir en 2035 con los parametros urbanisticos de 2026, y eso no se descubre
     * hasta que la obra esta levantada.
     *
     * <p>Con #72 entran {@code BENEFICIO}, {@code DESCUENTO} y {@code CONDONACION}. Es la sexta vez
     * que el hueco se abre por el mismo sitio. Cuanto descuenta una campana de amnistia lo fija una
     * ordenanza municipal —D-02b— o un acuerdo de concejo —D-02c—, y ninguna de las dieciseis
     * palabras anteriores caza {@code BENEFICIO_AMNISTIA = new BigDecimal("50")}: no empieza por
     * {@code ALICUOTA}, ni por {@code DEDUCCION}, ni por {@code TASA}. Y su consecuencia no es
     * cobrar de mas ni autorizar de mas: es <b>perdonar</b> de mas. Un porcentaje inventado condona
     * deuda que ninguna norma condona, la cifra sale escrita en lo que el contribuyente se lleva, y
     * lo que no cuadra despues es el arqueo.
     *
     * <p>{@code DESCUENTO} y {@code CONDONACION} van con ella porque son como se escribe la misma
     * cifra cuando «beneficio» suena a otra cosa: {@code DESCUENTO_PRONTO_PAGO = ...} y {@code
     * CONDONACION_DE_INTERESES = ...} son exactamente el mismo dato.
     *
     * <p>Con #399 entra {@code MINIMO}. Es la septima vez que el hueco se abre por el mismo sitio:
     * el minimo imponible del vehicular —«no menor al 1.5 % de la UIT», TUO LTM art. 34— y el del
     * predial —art. 13— son cifras de norma, y ninguna de las veinte palabras anteriores caza
     * {@code MINIMO_IMPONIBLE_VEHICULAR = new BigDecimal("1.5")}. Su consecuencia no se parece a la
     * de las demas: un minimo inventado no cobra de mas ni de menos en una cifra que se pueda
     * comparar, <b>eleva el suelo</b> —solo lo pagan los vehiculos baratos, que son los unicos a
     * los que el minimo llega, y por eso no lo delata ningun importe raro—.
     *
     * <p>Entra la palabra a secas y no {@code MINIMO_IMPONIBLE}, porque la misma cifra se escribe
     * {@code MINIMO_VEHICULAR} o {@code MINIMOS_POR_TRIBUTO}. El precio fue renombrar tres cotas de
     * formato que no son cifras tributarias —{@code Placa}, {@code Observacion} y {@code
     * Ejercicio}, que declaraban {@code MINIMO}/{@code MAXIMO} a secas— a {@code LARGO_MINIMO} y
     * {@code ANIO_MINIMO}: el {@code \b} no casa a mitad de identificador, y de paso las tres dicen
     * ahora de que son cota.
     *
     * <p>Ojo con el {@code \b}: no caza {@code TIPO_TASA = "TASA_ANUNCIO"} ni {@code TIPO_VIGENCIA
     * = "VIGENCIA_CERTIFICADO"} —el identificador no <b>empieza</b> por la palabra en el primer
     * caso, y en el segundo el valor no lleva ninguna cifra— ni ningun {@code tasa_id = 1} de un
     * SQL, porque el patron es sensible a mayusculas y esta pensado para nombres de constante.
     */
    private static final Pattern CONSTANTE_NORMATIVA =
            Pattern.compile(
                    "\\b(UIT|TRAMO|ALICUOTA|ARANCEL|DEPRECIACION|VALOR_UNITARIO|DEDUCCION"
                            + "|INTERES|REAJUSTE|PLAZO|PRESCRIPCION|CUOTAS|COSTA|TASA|TARIFA"
                            + "|MULTA|VIGENCIA|BENEFICIO|DESCUENTO|CONDONACION|MINIMO"
                            // #437 (D-11): el `% actualizacion` multiplica el autovaluo, y su
                            // valor «obvio» es 1 —o sea, ninguno—. Escribirlo no se siente como
                            // inventar un dato, se siente como no aplicar ninguno; y es lo mismo:
                            // afirma que el factor vale 1 en todo ejercicio y toda municipalidad.
                            // Octava vez que el hueco se abre por el mismo sitio.
                            + "|ACTUALIZACION|FACTOR)"
                            + "\\w*\\s*=\\s*[^;\\n]*[0-9]");

    /**
     * Un area convertida a texto a mano, en cualquiera de las dos formas (#607).
     *
     * <p>Un {@code AreaM2} tiene <b>un</b> sitio donde se convierte en cadena: el serializador que
     * {@code ConfiguracionDeJson} registra para el, que escribe la cifra sola. Componerla en el
     * recurso vuelve a abrir la puerta por la que este defecto entro: {@code
     * ficha.areaTerreno().toString()} mete la unidad dentro del dato —{@code "360.00 m2"}— y {@code
     * area.valor().toPlainString()} da la cifra buena pero es una <b>segunda convencion</b> para lo
     * mismo. Teniendo dos, el sistema acabo publicando el area del mismo predio de dos formas segun
     * a que modulo se le preguntara, y ninguna de las dos fallaba.
     *
     * <p><b>El anclaje es el nombre, porque esto es texto y no tipos</b>, y ahi esta el filo: el
     * identificador tiene que <b>empezar</b> por {@code area} o {@code Area} tras un limite de
     * palabra. Sin esa exigencia, «hect<b>area</b>s» casa por dentro —{@code hectareas()}, {@code
     * hectareasTotales()}, {@code hectareasComunes()}— y la regla se llevaria por delante el bloque
     * rural de {@code FichaResource}, que es una una {@code Medida} y lleva su unidad dentro <b>a
     * proposito</b>: el arancel rural es por hectarea, y quien lea metros calcularia diez mil veces
     * de menos. Lo mismo el {@code frontis} y la {@code cantidad} de una obra complementaria.
     */
    private static final Pattern AREA_COMPUESTA_A_MANO =
            Pattern.compile(
                    "\\b[aA]rea\\w*\\s*(?:\\(\\s*\\))?\\s*\\.\\s*"
                            + "(?:toString\\s*\\(\\s*\\)"
                            + "|valor\\s*\\(\\s*\\)\\s*\\.\\s*"
                            + "toPlainString\\s*\\(\\s*\\))");

    /**
     * La clase eximida que esta libreria garantiza, para que la demostracion valga en los cinco.
     *
     * <p>La lista real la declara cada repositorio y no es la misma; una prueba que dependiera de
     * ella diria una cosa en {@code rentas} y otra en {@code catastro}, y entonces no demostraria
     * el mecanismo sino el contenido.
     */
    public static final String CLASE_DE_MUESTRA_QUE_COMPONE_EL_AREA = "ModeloDeMuestraDelArea";

    /**
     * Las clases que componen un area a mano <b>con motivo</b>, nombradas una a una (#607).
     *
     * <p>Se nombran por clase y no por paquete a proposito: anadir una sexta tiene que ser una
     * linea visible en el diff, con quien la escribe teniendo que decir por que. Un paquete entero
     * exento seria una puerta que nadie vuelve a mirar.
     *
     * <p>Las cinco son lo mismo: <b>texto que no pasa por ningun serializador</b>. Cuatro son
     * modelos de documento —el papel que se imprime y se archiva—, donde la unidad va en el rotulo
     * de la fila o de la columna: «Area del terreno (m2)». La quinta es la descripcion que {@code
     * RegistrarAnuncio} escribe en la columna JSON de la auditoria, que tampoco es una proyeccion
     * HTTP. Todas escriben la <b>cifra sola</b>: lo que la lista permite es componerla, no meterle
     * la unidad dentro.
     *
     * <p><b>{@code DiferenciaEntreLiquidaciones} no esta, y no es un olvido.</b> Es la otra
     * excepcion legitima —la celda de texto libre del historial, donde «120.00 → 164.50» sin unidad
     * no dice si cambio el area o el insoluto—, pero el escaner <b>no puede verla</b>: convierte
     * con un {@code texto(Object)} propio, asi que en su codigo no aparece ningun {@code
     * area…().toString()} que casar. Ponerla aqui seria una entrada muerta en una lista de
     * excepciones, que es exactamente el defecto que esta lista existe para no tener. Lo que la
     * sostiene son las tres pruebas que afirman «300.00 m2» letra por letra, y {@code
     * ProhibicionesEnElCodigoFuenteTestBase} comprueba que el escaner, en efecto, no la alcanza.
     */
    public static final Set<String> COMPONEN_EL_AREA_A_MANO_CON_MOTIVO =
            conLasDeLasMuestras(
                    CONFIG.componenElAreaAManoConMotivo(),
                    Set.of(CLASE_DE_MUESTRA_QUE_COMPONE_EL_AREA));

    /**
     * ADR-0034 regla 2: un predicado espacial de PostGIS en el SQL de la aplicacion.
     *
     * <p>Bajo RLS ninguno de estos es <i>leakproof</i>, asi que PostgreSQL no los promueve por
     * encima de la politica: el indice GiST no se usa, el plan <b>sigue diciendo «Index»</b> —el de
     * la politica— y la consulta lee el padron entero del inquilino para devolver mil doscientos
     * lotes. Medido: 4 530 bloques contra los 347 del marco.
     *
     * <p>El defecto no avisa: la respuesta es CORRECTA. Solo se paga.
     */
    private static final Pattern PREDICADO_ESPACIAL =
            Pattern.compile(
                    "(?i)\\bst_(intersects|within|contains|containsproperly|coveredby|covers"
                            + "|overlaps|crosses|touches|dwithin|dfullywithin|relate)\\s*\\(");

    /**
     * El operador de solapamiento, {@code &&}.
     *
     * <p><b>Va acompanado de una condicion y no solo, y el motivo es que esta sobrecargado</b>:
     * {@code daterange && daterange} es solapamiento TEMPORAL y es legitimo —es como {@code
     * ficha_catastral} y {@code titularidad} impiden que dos vigencias se pisen—. Marcarlo siempre
     * pondria roja la mitad del esquema el primer dia, y una comprobacion que grita el primer dia
     * se silencia (#437). Se marca solo cuando en la misma sentencia hay geometria, que es cuando
     * significa lo que ADR-0034 prohibe.
     */
    private static final Pattern OPERADOR_DE_SOLAPAMIENTO = Pattern.compile("&&");

    /**
     * La condicion de marco en la misma sentencia, que es lo que exime al operador espacial.
     *
     * <p>ADR-0034 regla 2 lo admite «solo como refinado exacto despues del marco». Sin esto la
     * regla seria absoluta y no habria forma de escribir el caso en que la respuesta si exige el
     * poligono de verdad —un {@code ST_Contains} para decir en que zona cae ESTE lote—, que es
     * legitimo mientras el marco vaya delante acotando las filas.
     */
    private static final Pattern MENCIONA_EL_MARCO =
            Pattern.compile("(?i)\\bmarco_(oeste|sur|este|norte)\\b");

    /** Lo que hace que un {@code &&} sea espacial y no temporal. */
    private static final Pattern MENCIONA_GEOMETRIA =
            Pattern.compile(
                    "(?i)\\b(geometria|geography|geometry|st_[a-z]+|box2d|box3d|envelope|geom)\\b");

    /**
     * El tercer hallazgo de RLS: una busqueda por prefijo escrita con {@code LIKE}.
     *
     * <p>Bajo la politica, {@code textlike} tampoco es <i>leakproof</i>: un {@code LIKE 'prefijo%'}
     * no llega nunca al indice {@code text_pattern_ops} y recorre el padron. La forma que si
     * funciona es el RANGO —{@code ~>=~ 'prefijo' AND ~<~ 'prefijp'}—, y esta escrita una vez en
     * {@code RangoDePrefijo}.
     */
    private static final Pattern BUSQUEDA_CON_LIKE =
            Pattern.compile("(?i)\\b(i?like)\\b\\s*(:\\w+|\\?|'[^']*')");

    /**
     * La forma correcta, la que exime al {@code LIKE} de repliegue. Ver {@link #revisarPrefijo}.
     */
    private static final Pattern OPERADOR_DE_RANGO = Pattern.compile("~>=~|~<~");

    /**
     * El comodin de «contiene» antepuesto en Java: un literal {@code "%"} suelto.
     *
     * <p>{@code parametros.put("texto", "%" + criterio.texto() + "%")} deja el SQL diciendo {@code
     * ILIKE :texto} —que se lee igual que una busqueda por prefijo— y el {@code %} en el otro lado.
     * Sin esto, las dos consultas de texto libre de {@code rentas} se diagnosticaban como prefijos
     * y se les pedia un rango que <b>no pueden tener</b>: un comodin por delante no llega a ningun
     * indice b-tree, con RLS o sin ella.
     *
     * <p>No lo confunde el {@code " || \'%\'"} de {@code RangoDePrefijo}, que es otro literal.
     */
    private static final Pattern COMODIN_ANTEPUESTO_EN_JAVA = Pattern.compile("(?m)^\"%\"$");

    /**
     * Las clases que buscan texto libre con el comodin por delante, y dicen por que.
     *
     * <p>Es la lista de {@link ConfiguracionDeLasVerificaciones#busquedasDeTextoLibreConMotivo()},
     * y como la del area se declara por clase para que anadir una se vea en el diff. La muestra NO
     * entra: tiene que seguir detectandose, o la regla dejaria de poder demostrarse.
     */
    public static final Set<String> BUSCAN_TEXTO_LIBRE_CON_MOTIVO =
            CONFIG.busquedasDeTextoLibreConMotivo();

    private static final Pattern COMENTARIO_SQL_DE_LINEA = Pattern.compile("--[^\\n]*");
    private static final Pattern COMENTARIO_DE_BLOQUE = Pattern.compile("(?s)/\\*.*?\\*/");

    private RevisorDeCodigoFuente() {}

    /** Un incumplimiento, con lo necesario para arreglarlo sin buscarlo. */
    public record Hallazgo(String archivo, String regla, String fragmento) {
        @Override
        public String toString() {
            return archivo + " — " + regla + ": " + fragmento;
        }
    }

    public static List<Hallazgo> revisarJava(String archivo, String contenido) {
        List<Hallazgo> hallazgos =
                new ArrayList<>(revisarTexto(archivo, literalesDeCadena(contenido)));
        hallazgos.addAll(revisarRedondeo(archivo, contenido));
        hallazgos.addAll(revisarValoresTributarios(archivo, contenido));
        hallazgos.addAll(revisarAreas(archivo, contenido));
        hallazgos.addAll(revisarEspacial(archivo, contenido));
        hallazgos.addAll(revisarPrefijo(archivo, contenido));
        return hallazgos;
    }

    /**
     * ADR-0034 regla 2: ningun operador espacial en el SQL de aplicacion.
     *
     * <p>Mira los literales de cadena y los bloques de texto, que es donde vive el SQL de un
     * repositorio JDBC — y no el codigo, porque en Java {@code &&} es el «y» logico y estaria en
     * cada condicion de cada clase—. Los comentarios quedan fuera por lo de siempre: este mismo
     * archivo explica la prohibicion escribiendola.
     *
     * <p><b>No se aplica a las migraciones y es deliberado.</b> Un {@code EXCLUDE USING gist (…
     * &amp;&amp;)} es exactamente como el esquema impide que dos vigencias se pisen, y ahi el
     * operador va donde tiene que ir: en una restriccion que el motor evalua al escribir, no en un
     * {@code WHERE} que el planificador tiene que resolver bajo la politica. Lo que ADR-0034
     * prohibe es el SEGUNDO caso, y por eso el escaner de SQL —{@link #revisarSql}— no lo llama.
     *
     * <p>Lo que la regla admite: el operador como <b>refinado exacto detras del marco</b> (ADR-0034
     * regla 2). Sin esa salida, la consulta que si necesita el poligono de verdad —en que zona cae
     * ESTE lote— no se podria escribir.
     *
     * <p><b>La unidad es la SENTENCIA de Java, no el literal ni el archivo</b>, y las dos mitades
     * de esa frase estan medidas. No el literal: el SQL de un repositorio JDBC se compone
     * concatenando cadenas, asi que la condicion de marco y el refinado casi nunca caen en el mismo
     * —el contraste de esta regla fallo justamente por eso la primera vez—. Y no el archivo: {@code
     * CatastroRepositoryJdbc} nombra {@code marco_oeste} en otra consulta suya (el {@code min()}
     * que compone el rectangulo de lo levantado), asi que con el archivo entero por unidad,
     * devolver la consulta de la tesela al operador {@code &&} —el defecto exacto que {@code V65}
     * arreglo— pasaba en VERDE.
     *
     * <p>Es una unidad distinta de la de {@link #revisarPrefijo}, y a proposito: alli el repliegue
     * vive en la OTRA rama de un {@code if}, o sea en otra sentencia, y exigir que estuviera en la
     * misma pondria rojo el unico codigo correcto que hay.
     */
    public static List<Hallazgo> revisarEspacial(String archivo, String contenido) {
        List<Hallazgo> hallazgos = new ArrayList<>();

        for (String sentenciaJava : sentenciasDeJava(contenido)) {
            String sentencia = literalesDeCadena(sentenciaJava);
            if (sentencia.isBlank() || MENCIONA_EL_MARCO.matcher(sentencia).find()) {
                continue;
            }

            Matcher predicado = PREDICADO_ESPACIAL.matcher(sentencia);
            while (predicado.find()) {
                hallazgos.add(
                        new Hallazgo(
                                archivo,
                                "ADR-0034 regla 2: bajo RLS ningun predicado espacial es leakproof,"
                                        + " asi que no se promueve por encima de la politica y el"
                                        + " indice GiST no sirve: la consulta es CORRECTA y lee el"
                                        + " padron entero del inquilino, con el plan diciendo"
                                        + " «Index». Se filtra por marco_oeste/sur/este/norte, y"
                                        + " el operador solo detras, como refinado exacto",
                                predicado.group()));
            }

            if (MENCIONA_GEOMETRIA.matcher(sentencia).find()
                    && OPERADOR_DE_SOLAPAMIENTO.matcher(sentencia).find()) {
                hallazgos.add(
                        new Hallazgo(
                                archivo,
                                "ADR-0034 regla 2: «&&» sobre geometria es geography_overlaps, que"
                                        + " tampoco es leakproof. Medido: 4 530 bloques contra los"
                                        + " 347 del marco, y las dos respuestas son la misma",
                                sentencia.replaceAll("\\s+", " ").strip()));
            }
        }
        return hallazgos;
    }

    /**
     * Tercer hallazgo de RLS: toda busqueda por prefijo se escribe como rango.
     *
     * <p><b>El {@code LIKE} de repliegue no se marca, y esa es la mitad que hace util la regla.</b>
     * {@code RangoDePrefijo.condicion} calcula el sucesor del prefijo y, cuando no existe —el
     * prefijo acaba en {@code ~}, o trae un caracter fuera del rango imprimible—, cae a {@code
     * LIKE} porque no hay rango que escribir. Marcar eso pondria en rojo cuatro archivos correctos
     * en tres repositorios el primer dia, y una comprobacion que grita el primer dia se silencia
     * (#437).
     *
     * <p>El criterio es mecanico y no una lista de excepciones: <b>si el mismo archivo escribe
     * tambien la forma de rango, el {@code LIKE} es el repliegue</b>; si no la escribe, es la unica
     * forma que hay y es el defecto. Una lista de clases eximidas se habria quedado vieja al primer
     * renombrado, como la de {@code SISTEMA_DEL_MODULO} en R-N.
     *
     * <p><b>El limite, dicho:</b> la unidad es el ARCHIVO y no el metodo, porque distinguir el
     * metodo exigiria un analizador de Java y no una expresion regular. O sea que un repositorio
     * que ya escriba un rango en otra consulta puede esconder ahi un {@code LIKE} suelto. Lo que la
     * regla si garantiza es que el archivo que solo sabe hacer {@code LIKE} sale rojo.
     *
     * <p>El {@code LIKE '%…'} con comodin por delante <b>no es una busqueda por prefijo y no tiene
     * forma de rango</b>: no llega a ningun indice b-tree, con RLS o sin ella. Es otra cosa y se
     * dice con otro mensaje, porque pedirle un rango seria pedirle lo imposible. Lo que el dominio
     * ya rechaza por escrito en {@code FiltroDePredios} y {@code FiltroDeFichas} —«la busqueda
     * apunta a una columna, no a cualquier cosa»— y lo que esta mitad de la regla convierte en
     * barrera. Su exencion es una lista declarada con motivo, no un criterio mecanico: la escribe
     * cada repositorio en {@code busquedasDeTextoLibreConMotivo()}, y <b>es la lista de trabajo
     * pendiente</b>, no una puerta abierta.
     */
    public static List<Hallazgo> revisarPrefijo(String archivo, String contenido) {
        String literales = literalesDeCadena(contenido);
        boolean sabeEscribirElRango = OPERADOR_DE_RANGO.matcher(literales).find();
        boolean buscaTextoLibreConMotivo = BUSCAN_TEXTO_LIBRE_CON_MOTIVO.contains(claseDe(archivo));
        // El comodin no siempre esta en el SQL: la forma mas comun de escribir un «contiene» es
        // dejar el LIKE limpio y anteponerlo AL PARAMETRO, en Java. Sin mirarlo, esas consultas se
        // leerian como busquedas por prefijo y el diagnostico seria el equivocado: se les pediria
        // un rango que no pueden tener.
        boolean anteponeElComodinEnJava = COMODIN_ANTEPUESTO_EN_JAVA.matcher(literales).find();
        List<Hallazgo> hallazgos = new ArrayList<>();

        for (String sentencia : literales.split("\n")) {
            Matcher like = BUSQUEDA_CON_LIKE.matcher(sentencia);
            while (like.find()) {
                boolean comodinPorDelante =
                        like.group(2).startsWith("'%")
                                || (anteponeElComodinEnJava && like.group(2).startsWith(":"));
                if (comodinPorDelante ? buscaTextoLibreConMotivo : sabeEscribirElRango) {
                    continue;
                }
                hallazgos.add(
                        new Hallazgo(
                                archivo,
                                comodinPorDelante
                                        ? "un LIKE con el comodin por delante recorre el padron"
                                                + " entero y no tiene forma de rango: la busqueda"
                                                + " apunta a una columna, no a «cualquier cosa»"
                                        : "tercer hallazgo de RLS: bajo la politica, textlike no es"
                                                + " leakproof y un LIKE 'prefijo%' no llega nunca"
                                                + " al indice. Se escribe como rango con ~>=~ y"
                                                + " ~<~ (RangoDePrefijo), y el LIKE queda solo de"
                                                + " repliegue para el prefijo sin sucesor",
                                like.group()));
            }
        }
        return hallazgos;
    }

    /**
     * Regla 5: ningun literal numerico tributario en el codigo.
     *
     * <p>UIT, tramos, alicuotas, valores unitarios, aranceles y tablas de depreciacion viven en
     * datos versionados con su documento fuente y su vigencia (ADR-0007). Compilados dentro del
     * artefacto solo se pueden cambiar desplegando, y un tramo equivocado produce deuda mal
     * calculada en todo un padron.
     *
     * <p>Como el redondeo, mira el codigo y no los literales de cadena, y descarta los comentarios:
     * este mismo archivo explica la prohibicion nombrando UIT y tramos.
     */
    public static List<Hallazgo> revisarValoresTributarios(String archivo, String contenido) {
        List<Hallazgo> hallazgos = new ArrayList<>();

        Matcher valor = VALOR_TRIBUTARIO_LITERAL.matcher(sinComentariosDeBloque(contenido));
        while (valor.find()) {
            hallazgos.add(
                    new Hallazgo(
                            archivo,
                            "regla 5: una alicuota o un valor normativo construido desde un literal"
                                    + " es una cifra de norma compilada; va en datos versionados"
                                    + " con su documento fuente (ADR-0007)",
                            valor.group()));
        }

        Matcher constante = CONSTANTE_NORMATIVA.matcher(sinComentariosNiMas(contenido));
        while (constante.find()) {
            hallazgos.add(
                    new Hallazgo(
                            archivo,
                            "regla 5: esa constante lleva nombre de valor normativo y una cifra"
                                    + " dentro; cambiarla no debe exigir un despliegue (ADR-0007)",
                            constante.group()));
        }

        return hallazgos;
    }

    /**
     * #607: ninguna clase compone un area a mano, salvo las nombradas en {@link
     * #COMPONEN_EL_AREA_A_MANO_CON_MOTIVO}.
     *
     * <p>Mira el codigo y no los literales —como el redondeo y por lo mismo—: lo que se busca es
     * una llamada. Los comentarios se descartan porque este mismo archivo explica la prohibicion
     * escribiendola.
     *
     * <p><b>Recorre {@code src/main} entero y no solo {@code infraestructura/web}</b>, aunque el
     * defecto se viera ahi. Acotarlo a la web dejaria la lista de excepciones sin poder dispararse
     * nunca —ninguna de las clases que componen con motivo vive en {@code infraestructura/web}—, y
     * una regla cuya mitad no puede fallar no protege esa mitad: quitar {@code ModeloDelFue} de la
     * lista no pondria nada rojo, y entonces la lista seria decoracion. Con el recorrido completo,
     * quitar cualquier entrada pone rojo el escaneo del backend entero nombrando la clase.
     *
     * @param archivo la ruta o el nombre del archivo; de el sale la clase que se compara con la
     *     lista de excepciones
     */
    public static List<Hallazgo> revisarAreas(String archivo, String contenido) {
        if (COMPONEN_EL_AREA_A_MANO_CON_MOTIVO.contains(claseDe(archivo))) {
            return List.of();
        }

        List<Hallazgo> hallazgos = new ArrayList<>();
        Matcher area = AREA_COMPUESTA_A_MANO.matcher(soloCodigo(contenido));
        while (area.find()) {
            hallazgos.add(
                    new Hallazgo(
                            archivo,
                            "#607: un area no se convierte a texto a mano. Va tipada como AreaM2 y"
                                    + " la escribe el serializador de ConfiguracionDeJson —la cifra"
                                    + " sola—; la unidad la pone la cabecera de la columna, nunca el"
                                    + " dato",
                            area.group()));
        }
        return hallazgos;
    }

    /** El nombre de la clase a partir de la ruta o del nombre del archivo. */
    private static String claseDe(String archivo) {
        String nombre = archivo.replace('\\', '/');
        int barra = nombre.lastIndexOf('/');
        if (barra >= 0) {
            nombre = nombre.substring(barra + 1);
        }
        return nombre.endsWith(".java")
                ? nombre.substring(0, nombre.length() - ".java".length())
                : nombre;
    }

    /**
     * D-03: mientras la escala (D-03a), el modo (D-03b) y los puntos de redondeo (D-03c) no esten
     * decididos, no hay ninguna politica de redondeo escrita en el codigo. Se recibe como
     * argumento.
     *
     * <p>Mira el codigo y no los literales —al reves que el resto del revisor—, porque lo que se
     * busca es una llamada, no una cadena. Los comentarios se descartan: este mismo archivo explica
     * la prohibicion nombrandola, y una regla que se denuncia a si misma acaba desactivada.
     */
    public static List<Hallazgo> revisarRedondeo(String archivo, String contenido) {
        String codigo = soloCodigo(contenido);
        List<Hallazgo> hallazgos = new ArrayList<>();

        Matcher modo = MODO_DE_REDONDEO_ESCRITO.matcher(codigo);
        while (modo.find()) {
            hallazgos.add(
                    new Hallazgo(
                            archivo,
                            "D-03b sigue abierta: el modo de redondeo se recibe en una"
                                    + " PoliticaDeRedondeo, no se escribe en el codigo",
                            modo.group()));
        }

        Matcher escala = ESCALA_ESCRITA.matcher(codigo);
        while (escala.find()) {
            hallazgos.add(
                    new Hallazgo(
                            archivo,
                            "D-03a sigue abierta: la escala se recibe en una PoliticaDeRedondeo, no"
                                    + " se escribe en el codigo",
                            escala.group()));
        }

        return hallazgos;
    }

    /**
     * El contenido sin comentarios ni literales, para poder buscar llamadas y no texto.
     *
     * <p>Recorre caracter a caracter en lugar de aplicar expresiones regulares: un {@code //}
     * dentro de una cadena no abre un comentario, y borrarlo se llevaria por delante el codigo que
     * viene detras en la misma linea.
     */
    static String soloCodigo(String contenido) {
        return sinComentarios(contenido, false);
    }

    /**
     * El contenido sin comentarios pero <b>con</b> las cadenas.
     *
     * <p>Lo necesita la regla 5: {@code UIT_2026 = new BigDecimal("5350")} lleva la cifra dentro de
     * un literal, asi que descartar las cadenas la haria invisible. Lo que sigue descartandose son
     * los comentarios, porque este mismo archivo explica la prohibicion nombrando la UIT.
     */
    static String sinComentariosNiMas(String contenido) {
        return sinComentarios(contenido, true);
    }

    private static String sinComentarios(String contenido, boolean conservarCadenas) {
        StringBuilder codigo = new StringBuilder(contenido.length());
        int i = 0;
        while (i < contenido.length()) {
            char actual = contenido.charAt(i);
            char siguiente = i + 1 < contenido.length() ? contenido.charAt(i + 1) : '\0';

            if (actual == '/' && siguiente == '/') {
                while (i < contenido.length() && contenido.charAt(i) != '\n') {
                    i++;
                }
            } else if (actual == '/' && siguiente == '*') {
                i += 2;
                while (i + 1 < contenido.length()
                        && !(contenido.charAt(i) == '*' && contenido.charAt(i + 1) == '/')) {
                    i++;
                }
                i = Math.min(i + 2, contenido.length());
            } else if (actual == '"' && contenido.startsWith("\"\"\"", i)) {
                int cierre = contenido.indexOf("\"\"\"", i + 3);
                int fin = cierre < 0 ? contenido.length() : cierre + 3;
                if (conservarCadenas) {
                    codigo.append(contenido, i, fin);
                }
                i = fin;
            } else if (actual == '"' || actual == '\'') {
                char comilla = actual;
                int inicio = i;
                i++;
                while (i < contenido.length() && contenido.charAt(i) != comilla) {
                    i += contenido.charAt(i) == '\\' ? 2 : 1;
                }
                i++;
                if (conservarCadenas) {
                    codigo.append(contenido, inicio, Math.min(i, contenido.length()));
                }
            } else {
                codigo.append(actual);
                i++;
            }
        }
        return codigo.toString();
    }

    public static List<Hallazgo> revisarSql(String archivo, String contenido) {
        return revisarTexto(archivo, sqlSinComentarios(contenido));
    }

    /**
     * Los literales de cadena del fuente, uno por linea y sin los comentarios.
     *
     * <p>Es donde vive el SQL de un repositorio JDBC, y por eso lo comparten los dos escaneres que
     * miran SQL: este y {@link FronteraDeSistema}. Un solo recorrido para que no puedan discrepar
     * en el caso raro —una cadena con comillas escapadas dentro de un comentario, por ejemplo—.
     */
    static String literalesDeCadena(String contenido) {
        String sinComentarios = sinComentariosDeBloque(contenido);
        StringBuilder literales = new StringBuilder();

        // Los BLOQUES DE TEXTO primero, y aparte: es donde vive el SQL de varias lineas, que es
        // casi todo el SQL de verdad —una consulta con JOIN no cabe en una linea—. El patron de
        // literal simple no los ve: se para en el primer salto de linea. Medido al escribir
        // `FronteraDeSistema`: trece archivos de `src/main` escriben asi su SQL, y entre ellos
        // estan los cinco cruces mas caros de GOB-05 §6. Un escaner que no los mira no protege lo
        // que dice proteger.
        //
        // Se extraen antes que los simples y se quitan del texto, porque si no las comillas de
        // apertura del bloque se leerian como el principio de un literal de una linea.
        StringBuilder resto = new StringBuilder();
        Matcher bloque = BLOQUE_DE_TEXTO.matcher(sinComentarios);
        int desde = 0;
        while (bloque.find()) {
            resto.append(sinComentarios, desde, bloque.start());
            literales.append(bloque.group()).append('\n');
            desde = bloque.end();
        }
        resto.append(sinComentarios.substring(desde));

        Matcher matcher = LITERAL_JAVA.matcher(resto.toString());
        while (matcher.find()) {
            literales.append(matcher.group()).append('\n');
        }
        return literales.toString();
    }

    /**
     * Las sentencias de Java del fuente, partidas por el {@code ;} que las separa de verdad.
     *
     * <p>Es la unidad que {@link #revisarEspacial} necesita: una consulta compuesta por
     * concatenacion es UNA sentencia aunque sean ocho literales, y dos consultas distintas del
     * mismo repositorio son dos. Sin esto habria que elegir entre el literal —que parte la consulta
     * por la mitad— y el archivo —que las junta todas—, y las dos elecciones estan medidas y
     * fallan.
     *
     * <p>Recorre caracter a caracter porque un {@code ;} dentro de una cadena o de un comentario no
     * separa nada, y partir por el dejaria media consulta a cada lado.
     */
    static List<String> sentenciasDeJava(String contenido) {
        List<String> sentencias = new ArrayList<>();
        StringBuilder actual = new StringBuilder();
        int i = 0;
        while (i < contenido.length()) {
            char c = contenido.charAt(i);

            if (c == '/' && i + 1 < contenido.length()) {
                char siguiente = contenido.charAt(i + 1);
                if (siguiente == '/') {
                    int fin = contenido.indexOf('\n', i);
                    i = fin < 0 ? contenido.length() : fin;
                    continue;
                }
                if (siguiente == '*') {
                    int fin = contenido.indexOf("*/", i + 2);
                    i = fin < 0 ? contenido.length() : fin + 2;
                    continue;
                }
            }

            if (c == '"' && contenido.startsWith("\"\"\"", i)) {
                int fin = contenido.indexOf("\"\"\"", i + 3);
                fin = fin < 0 ? contenido.length() : fin + 3;
                actual.append(contenido, i, fin);
                i = fin;
                continue;
            }
            if (c == '"' || c == '\'') {
                int fin = i + 1;
                while (fin < contenido.length() && contenido.charAt(fin) != c) {
                    fin += contenido.charAt(fin) == '\\' ? 2 : 1;
                }
                fin = Math.min(fin + 1, contenido.length());
                actual.append(contenido, i, fin);
                i = fin;
                continue;
            }
            if (c == ';') {
                sentencias.add(actual.toString());
                actual.setLength(0);
                i++;
                continue;
            }
            actual.append(c);
            i++;
        }
        if (!actual.toString().isBlank()) {
            sentencias.add(actual.toString());
        }
        return sentencias;
    }

    /** El SQL de una migracion, sin sus comentarios de linea ni de bloque. */
    static String sqlSinComentarios(String contenido) {
        return COMENTARIO_SQL_DE_LINEA.matcher(sinComentariosDeBloque(contenido)).replaceAll("");
    }

    private static String sinComentariosDeBloque(String contenido) {
        return COMENTARIO_DE_BLOQUE.matcher(contenido).replaceAll("");
    }

    private static List<Hallazgo> revisarTexto(String archivo, String texto) {
        List<Hallazgo> hallazgos = new ArrayList<>();

        Matcher setSession = SET_SESSION.matcher(texto);
        while (setSession.find()) {
            hallazgos.add(
                    new Hallazgo(
                            archivo,
                            "SET SESSION sobrevive al retorno de la conexion al pool y contamina la"
                                    + " peticion de otra municipalidad; va SET LOCAL (regla 3)",
                            setSession.group()));
        }

        Matcher setConfig = SET_CONFIG_DE_SESION.matcher(texto);
        while (setConfig.find()) {
            hallazgos.add(
                    new Hallazgo(
                            archivo,
                            "set_config con is_local = false es SET SESSION con otro nombre; el"
                                    + " tercer argumento va en true (regla 3)",
                            setConfig.group()));
        }

        Matcher delete = DELETE_FROM.matcher(texto);
        while (delete.find()) {
            String tabla = delete.group(1).toLowerCase(Locale.ROOT);
            if (TABLAS_PROTEGIDAS.contains(tabla)) {
                hallazgos.add(
                        new Hallazgo(
                                archivo,
                                "no se borra deuda, pagos, recibos, valores, papeletas, asientos ni"
                                        + " auditoria: se anula, se da de baja o se reversa"
                                        + " (RNF-051)",
                                delete.group()));
            }
        }

        Matcher update = UPDATE_TABLA.matcher(texto);
        while (update.find()) {
            String tabla = update.group(1).toLowerCase(Locale.ROOT);
            if (TABLAS_INMUTABLES.contains(tabla)) {
                hallazgos.add(
                        new Hallazgo(
                                archivo,
                                "un asiento no se corrige en el sitio y la auditoria no se edita:"
                                        + " se agrega otro registro (ADR-0006, ADR-0008)",
                                update.group()));
            }
        }

        return hallazgos;
    }
}
