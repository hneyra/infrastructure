// Viola: la configuracion se lee en `config.ts`, no dentro de un componente.
//
// Es la muestra que importa de esta carpeta. Escrito asi, «falta el dominio» deja de
// ser un fallo del arranque —con el nombre del valor— y pasa a ser un fallo a mitad
// del despliegue, con el clúster ya a medio cambiar.
import * as pulumi from "@pulumi/pulumi";

export function dominioDelIngreso(): string {
  const config = new pulumi.Config();
  return config.require("domain");
}
