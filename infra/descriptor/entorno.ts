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
  etiquetaDeImagen: string,
  operacion: { readonly responsable: string; readonly canal: string },
  implantacion: EntornoDelDescriptor["implantacion"],
  realm: string,
): (sistema: string) => EntornoDelDescriptor {
  return (sistema) => ({
    ambiente,
    namespace: namespaceDelSistema(ambiente, sistema),
    dominio,
    etiquetas: { ...commonLabels(ambiente, sistema), sistema },
    imagenDe: (componente) => `${REGISTRO}/kamayuk-${componente}:${etiquetaDeImagen}`,
    secretoDe: (clave) => `kamayuk-${sistema}-${ambiente}-${clave}`,
    prioridadDe: (clase) => nombreDePrioridad(ambiente, clase),
    operacion,
    implantacion,
    // La MISMA funcion con que se compone el propio: un sistema no puede componer el namespace
    // de otro a mano sin repetir la convencion, y dos copias de una convencion se separan.
    namespaceDe: (otro) => namespaceDelSistema(ambiente, otro),
    // Y el MISMO `sufijoDeVersion` que usa el monolito desde el issue #150, por lo mismo: dos
    // formas de recortar una version son dos formas de que un Job inmutable choque.
    nombreConVersion: (base) => `${base}-${sufijoDeVersion(etiquetaDeImagen)}`,
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
    },
  });
}
