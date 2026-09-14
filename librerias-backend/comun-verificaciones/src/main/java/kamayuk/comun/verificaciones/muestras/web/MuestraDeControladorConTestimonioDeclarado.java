package kamayuk.comun.verificaciones.muestras.web;

import java.time.Instant;
import kamayuk.comun.verificaciones.muestras.autorizacion.Privilegio;
import kamayuk.comun.verificaciones.muestras.autorizacion.RequiereAcceso;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * La muestra de la EXENCION de {@code TODA_GEOMETRIA_ENTRA_POR_BATCH} (ADR-0048 §2 y §4).
 *
 * <p>{@link MuestraDeControladorQueRecibeGeometria} demuestra que la regla muerde. Esta demuestra
 * lo otro, que es lo que ADR-0048 anade y lo que mas facil seria perder: que la exencion <b>no es
 * una mordaza</b>. Una exencion que solo callara la regla seria un {@code @SuppressWarnings}
 * escrito en otro archivo, y el dia que alguien la pidiera para «un puntito» tendria con ella la
 * puerta entera.
 *
 * <p>Por eso lleva <b>tres violaciones y un contraste</b>, y el contraste es el que vale:
 *
 * <ol>
 *   <li>{@link #sincronizarSinObservacion} — declarada, y sin la observacion ni el reloj del
 *       aparato que su propia declaracion nombra. Es la tercera condicion de ADR-0048 §2, y sin
 *       ella un testimonio no dice quien, ni cuando, ni por que.
 *   <li>{@link #sincronizarElLote} — declarada, y aprovechando la exencion para colar un
 *       <b>poligono</b>. Es la puerta de atras literal: conseguida la exencion para el punto, se
 *       anade despues el campo que de verdad mueve el padron. La exencion tolera un punto y no la
 *       geometria.
 *   <li>{@link #sincronizarSinDeclarar} — <b>no</b> declarada, y recibiendo un punto en la misma
 *       clase que si tiene exenciones. Es el agujero que ADR-0048 destapo y que motivo meter {@code
 *       punto} en el vocabulario: hasta entonces este metodo pasaba en VERDE en los cuatro
 *       backends, y la captura de campo no entraba por HTTP solo porque quien la escribio decidio
 *       no aprovecharlo.
 *   <li>{@link #sincronizar} — <b>EL CONTRASTE</b>, y la regla NO debe quejarse de el. Esta
 *       declarado, recibe un punto y trae los dos campos que su declaracion exige. Sin este metodo,
 *       una exencion rota —que no eximiera a nadie— o una regla que ignorase la lista entera
 *       seguirian pasando {@code ReglasDeArquitecturaMuerdenTest}, porque a aquel le basta que la
 *       regla lance una vez. Es la misma leccion que {@code corregirSinNombrarElParametro} dejo
 *       escrita en la otra muestra: hacer que {@code nombreDelParametro} devolviera siempre {@code
 *       null} dejaba la regla en VERDE en los cuatro backends y nadie se enteraba.
 * </ol>
 *
 * <p>Y lo que esta clase <b>no</b> puede demostrar, dicho para que no se confunda con lo que si:
 * las dos primeras condiciones de ADR-0048 §2 —sin foranea a {@code predio} ni a {@code
 * ficha_catastral}, e inmutable en el motor— viven en el esquema. Esta regla no las ve, y por eso
 * la declaracion nombra la tabla: para que la revision sepa contra que migracion mirarlas.
 */
@RestController
@RequiereAcceso(acceso = "muestra_inspeccion", privilegio = Privilegio.REGISTRO)
@SuppressWarnings("unused")
public class MuestraDeControladorConTestimonioDeclarado {

    /**
     * EL CONTRASTE: declarado, con su punto, su observacion y su reloj del aparato. Pasa.
     *
     * <p>Si la regla marcara este, el ingreso de la tableta seria inimplementable y ADR-0048 no
     * habria decidido nada.
     */
    @PostMapping("/api/v1/muestra/inspeccion/capturas")
    public void sincronizar(@RequestBody CapturaDeMuestra captura) {
        // Lo que la brigada levanto en la puerta. No toca el padron.
    }

    /** Viola la exencion: declarada, y sin lo que la declaracion dice que trae. */
    @PostMapping("/api/v1/muestra/inspeccion/capturas-sin-observacion")
    public void sincronizarSinObservacion(@RequestBody CapturaSinTestigo captura) {
        // Un punto sin quien, sin cuando y sin por que: eso no es un testimonio.
    }

    /** Viola la exencion: declarada, y colando el lote por la puerta del testimonio. */
    @PostMapping("/api/v1/muestra/inspeccion/capturas-con-lote")
    public void sincronizarElLote(@RequestBody CapturaConElLote captura) {
        // Aqui el padron SI se mueve, y con permiso escrito para otra cosa.
    }

    /** Viola la regla a secas: un punto por HTTP sin exencion ninguna. */
    @PostMapping("/api/v1/muestra/inspeccion/capturas-sin-declarar")
    public void sincronizarSinDeclarar(@RequestBody CapturaDeMuestra captura) {
        // El mismo cuerpo que el contraste; lo que cambia es que nadie lo decidio.
    }

    /**
     * El cuerpo correcto de un testimonio: el punto, los dos campos exigidos y nada del acervo.
     *
     * <p>{@code capturadoEn} es el reloj del APARATO. El del servidor no esta, y no es un olvido:
     * lo pone el caso de uso, y recibirlo del cliente seria dejar que la tableta declare cuando
     * llego (ADR-0035 punto 3).
     */
    public record CapturaDeMuestra(
            long candidatoId,
            String punto,
            String brigadista,
            Instant capturadoEn,
            String observacion) {}

    /** El mismo punto, sin la observacion de la regla 10 ni el reloj del aparato. */
    public record CapturaSinTestigo(long candidatoId, String punto, String brigadista) {}

    /** El testimonio con el lote dentro: la exencion no cubre esto y no puede cubrirlo. */
    public record CapturaConElLote(
            long candidatoId,
            String punto,
            String poligonoDelLote,
            String brigadista,
            Instant capturadoEn,
            String observacion) {}
}
