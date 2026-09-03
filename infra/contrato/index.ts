/**
 * El contrato publico que `infrastructure` ofrece a los cuatro sistemas.
 *
 * Es lo unico que un descriptor importa. Reexporta dos cosas y nada mas:
 *
 *   - el tipo `DescriptorDeSistema` y su entorno, de `tipos.ts`;
 *   - los tipos de manifiesto de Kubernetes, de `../componentes/tipos.ts`, que son **los
 *     mismos** que usan los componentes propios de la plataforma.
 *
 * Que sean los mismos no es comodidad: es lo que hace que `auditarManifiestos` pueda leer un
 * descriptor ajeno igual que lee `BaseDeDatos.ts`. Dos juegos de tipos —uno «para dentro» y otro
 * «para los sistemas»— serian dos definiciones de «sonda con `timeoutSeconds`» envejeciendo
 * aparte, y la auditoria dejaria de valer a traves de la frontera.
 *
 * **No exporta la auditoria ni la composicion.** Un descriptor no se audita a si mismo: eso lo
 * hace quien compone, y por eso `auditarDescriptor` se queda en `infrastructure`.
 */

export type {
  BaseDeDatosDeclarada,
  ClaveDeclarada,
  DescriptorDeSistema,
  EntornoDelDescriptor,
  PanelDeclarado,
  ReglaDeAlerta,
  RolDeclarado,
} from "../descriptor/tipos";

export type {
  ConfigMap,
  Contenedor,
  Deployment,
  EspecificacionDePod,
  IngressRoute,
  Job,
  Manifiesto,
  Metadatos,
  NetworkPolicy,
  Recursos,
  SecurityContext,
  Service,
  Sonda,
  VariableDeEntorno,
  Volumen,
} from "../componentes/tipos";
