/**
 * El entorno que `infrastructure` le entrega a cada descriptor.
 *
 * Es lo unico que un sistema sabe del ambiente, y esta compuesto AQUI a proposito: las tres
 * funciones —`imagenDe`, `secretoDe`, `prioridadDe`— son lo que un descriptor **pide** en vez de
 * componer. La primera es la que sostiene todo lo demas: **la etiqueta de la imagen la pone este
 * archivo**, y por eso una liberacion normal no vuelve a pasar por Pulumi (ADR-0011 §5).
 *
 * Cada sistema tiene **su namespace**: `kamayuk-<sistema>-<ambiente>`. Uno por sistema y por
 * ambiente, que es lo que permite que las politicas de red de cada uno se escriban sin mirar a
 * los demas.
 */

import {
  anfitrionDelMotor,
  emisorPublico,
  jwksInterno,
  nombreDePrioridad,
  servicioDeIdentidad,
} from "../componentes/convenciones";
import { sufijoDeVersion } from "../componentes/Migracion";
import { commonLabels, namespaceName, type Environment } from "../config";
import type { EntornoDelDescriptor } from "./tipos";

/** El registro de imagenes. La ETIQUETA la fija el ambiente, no el sistema. */
const REGISTRO = "ghcr.io/hneyra";

export function namespaceDelSistema(ambiente: Environment, sistema: string): string {
  return `kamayuk-${sistema}-${ambiente}`;
}

export function entornoPara(
  ambiente: Environment,
  dominio: string,
  /**
   * La version de CADA sistema, que es un `sha` de SU repositorio.
   *
   * Antes era una sola cadena —`applicationBootstrapVersion`, un `sha` de `sgtm`— y con ella se
   * etiquetaban las ocho imagenes de los cuatro sistemas. Una etiqueta que no resuelve contra el
   * `git log` del repositorio que construyo la imagen no identifica nada, y ademas ninguna de las
   * ocho existia: medido contra el registro el 2026-09-05, `404 MANIFEST_UNKNOWN` en las ocho.
   *
   * Sigue siendo `infrastructure` quien la pone, que es lo que ADR-0011 §5 protege: el descriptor
   * de un sistema **no** compone su etiqueta, la pide. Lo que cambia es de donde sale el valor.
   */
  versionDe: (sistema: string) => string,
  operacion: { readonly responsable: string; readonly canal: string },
  implantacion: EntornoDelDescriptor["implantacion"],
  realm: string,
): (sistema: string) => EntornoDelDescriptor {
  return (sistema) => ({
    ambiente,
    namespace: namespaceDelSistema(ambiente, sistema),
    dominio,
    etiquetas: { ...commonLabels(ambiente, sistema), sistema },
    imagenDe: (componente) => `${REGISTRO}/kamayuk-${componente}:${versionDe(sistema)}`,
    secretoDe: (clave) => `kamayuk-${sistema}-${ambiente}-${clave}`,
    prioridadDe: (clase) => nombreDePrioridad(ambiente, clase),
    operacion,
    implantacion,
    // La MISMA funcion con que se compone el propio: un sistema no puede componer el namespace
    // de otro a mano sin repetir la convencion, y dos copias de una convencion se separan.
    namespaceDe: (otro) => namespaceDelSistema(ambiente, otro),
    // Y el MISMO `sufijoDeVersion` que usa el monolito desde el issue #150, por lo mismo: dos
    // formas de recortar una version son dos formas de que un Job inmutable choque.
    // Y con la version de ESTE sistema, no con la del monolito: el `Job` de migracion lleva la
    // version en el nombre, asi que una version nueva no modifica un Job — crea otro. Con la
    // version compartida, publicar una migracion de `rentas` no creaba ningun Job nuevo para
    // `rentas` y si lo creaba para los otros tres, que no habian cambiado.
    nombreConVersion: (base) => `${base}-${sufijoDeVersion(versionDe(sistema))}`,
    plataforma: {
      namespace: namespaceName(ambiente),
      // Las MISMAS dos funciones con que se compone la aplicacion del monolito. Componerlas
      // aqui otra vez seria un segundo sitio donde equivocarse de realm.
      emisor: emisorPublico(dominio, realm),
      // Cruzando el namespace: el servicio vive en el de la plataforma, no en el del sistema.
      jwks: jwksInterno(ambiente, realm).replace(
        `//${servicioDeIdentidad(ambiente)}:`,
        `//${servicioDeIdentidad(ambiente)}.${namespaceName(ambiente)}:`,
      ),
      // Y lo mismo un componente mas abajo (C-17, punto 1): el motor vive en el namespace de la
      // plataforma, asi que su nombre corto no resuelve desde el de un sistema. Los cuatro
      // escribian `postgres` a secas, que es el nombre del compose local y no el de ningun
      // `Service` del clúster.
      motor: anfitrionDelMotor(ambiente),
    },
  });
}
