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

import { nombreDePrioridad } from "../componentes/convenciones";
import { commonLabels, type Environment } from "../config";
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
): (sistema: string) => EntornoDelDescriptor {
  return (sistema) => ({
    ambiente,
    namespace: namespaceDelSistema(ambiente, sistema),
    dominio,
    etiquetas: { ...commonLabels(ambiente, sistema), sistema },
    imagenDe: (componente) => `${REGISTRO}/kamayuk-${componente}:${etiquetaDeImagen}`,
    secretoDe: (clave) => `kamayuk-${sistema}-${ambiente}-${clave}`,
    prioridadDe: (clase) => nombreDePrioridad(ambiente, clase),
  });
}
