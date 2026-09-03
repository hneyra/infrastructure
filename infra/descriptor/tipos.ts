/**
 * El contrato con el que un sistema aporta su infraestructura (ADR-0031 §2).
 *
 * ## Por que esto se puede hacer, y que lo rompe
 *
 * `ADR-0011` eligio que cada componente fuera **una funcion pura que devuelve objetos
 * planos de Kubernetes**, en vez de crear recursos. Se eligio por tres motivos escritos
 * —la auditoria puede leerlos, las pruebas corren sin Pulumi y sin clúster, y el diff de
 * un cambio es legible—, y ninguno de los tres hablaba de repositorios.
 *
 * **Esa eleccion es la que permite ahora que un descriptor cruce la frontera de un
 * repositorio sin perder la verificacion.** `infrastructure` recibe datos, no llamadas:
 * puede leerlos, compararlos con `INF-01` §4 y **negarse a aplicarlos** exactamente igual
 * que hace con los suyos. Si un descriptor creara recursos —si devolviera
 * `pulumi.Input<T>`, si abriera una conexion, si leyera configuracion por su cuenta—,
 * `auditarDescriptor` no tendria nada que leer y la unica garantia seria la confianza en
 * quien lo escribio. Es decir: **esto no funciona**.
 *
 * Por eso un descriptor **recibe** su entorno y **devuelve** manifiestos, y por eso el
 * tipo no admite ni un `Promise`, ni un `Input`, ni una funcion sin argumentos que lea
 * `process.env`. Las mismas tres reglas que `componentes/README.md` le pide a cualquier
 * componente que se agregue, ahora a traves de una frontera.
 */

import type { Manifiesto, NetworkPolicy } from "../componentes/tipos";

/**
 * Lo que `infrastructure` le entrega a un descriptor. Todo lo que un sistema necesita
 * saber del ambiente, y nada mas.
 *
 * Es de solo lectura y son datos: un descriptor no puede llegar a la configuracion por
 * otro camino —no hay `new pulumi.Config()` ni `process.env` que valgan, y la regla de
 * ESLint que ya lo impide en `componentes/` vale igual aqui—.
 */
export interface EntornoDelDescriptor {
  /** `stg` o `prod`. Un descriptor **no** ramifica por esto: recibe lo que cambia. */
  readonly ambiente: string;
  /** El namespace del sistema en este ambiente, ya compuesto. */
  readonly namespace: string;
  /** El nombre publico por el que llega el navegador. */
  readonly dominio: string;
  /** Las etiquetas comunes del ambiente. Se anaden a las del sistema. */
  readonly etiquetas: Readonly<Record<string, string>>;
  /**
   * La referencia COMPLETA de una imagen, etiqueta incluida.
   *
   * **La etiqueta la pone `infrastructure`, nunca el descriptor** (ADR-0011 §5, y
   * prohibicion (b) de `auditoria.ts`). Es lo que sostiene que una liberacion normal no
   * sea un `pulumi up`: el campo `image` lleva `ignoreChanges`, la liberacion mueve la
   * etiqueta con `kubectl set image`, y la reversion tambien. Si un descriptor pudiera
   * escribirla, cada liberacion de cualquiera de los cuatro sistemas volveria a pasar por
   * este repositorio, y la composicion centralizada seria el cuello de botella que la
   * separacion venia a quitar.
   */
  imagenDe(componente: string): string;
  /** El nombre del `Secret` de una clave del inventario, ya resuelto para el ambiente. */
  secretoDe(clave: string): string;
  /**
   * El nombre de una clase de prioridad, ya resuelto.
   *
   * Las `PriorityClass` son de **alcance de clúster** y las crea `infrastructure`: un
   * descriptor las NOMBRA, no las define. Por eso se pide aqui y no se compone a mano —un
   * nombre inventado no da un despliegue con menos garantias, da un pod que Kubernetes
   * RECHAZA y que no llega a arrancar—.
   */
  prioridadDe(clase: "datos" | "servicio" | "lote"): string;
}

/**
 * La base de datos de un sistema y sus roles.
 *
 * Son datos, no DDL: `infrastructure` es dueno del motor y compone con esto la creacion
 * de la base y el reparto de privilegios. Un sistema declara **su** base; pedir algo
 * sobre la de otro es la prohibicion (c).
 */
export interface BaseDeDatosDeclarada {
  /** El nombre de la base. Por convencion, el del sistema. */
  readonly nombre: string;
  readonly roles: readonly RolDeclarado[];
}

export interface RolDeclarado {
  readonly nombre: string;
  /**
   * Las bases sobre las que este rol pide privilegios.
   *
   * Tiene que ser **la suya y solo la suya**. Se declara como lista y no se da por
   * supuesto para que la auditoria tenga algo que leer: un `sobre: ["rentas"]` en el
   * descriptor de `catastro` se ve en el diff y se rechaza en el build.
   */
  readonly sobre: readonly string[];
  readonly privilegios: readonly string[];
  /** `false` en el rol de la aplicacion, siempre. Regla 2 de las que no se negocian. */
  readonly superusuario: false;
}

/**
 * Una clave del inventario: metadatos, **nunca un valor** (INF-06, ADR-0011 §3).
 *
 * El descriptor dice que claves necesita su sistema y cada cuanto rotan;
 * `secretos/bootstrap-secretos.sh` las genera hablando con el API de Kubernetes, y no
 * pasan por el estado de Pulumi. Un campo con el valor es la prohibicion (e).
 */
export interface ClaveDeclarada {
  readonly nombre: string;
  readonly clave: string;
  readonly rol?: string;
  readonly rotacion: "trimestral" | "anual" | "nunca";
  readonly proposito: string;
}

/** Una regla de alerta de Prometheus, tal como entra en el `ConfigMap` de reglas. */
export interface ReglaDeAlerta {
  readonly alert: string;
  readonly expr: string;
  readonly for: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly annotations: Readonly<Record<string, string>>;
}

/** El panel de Grafana del sistema, como el JSON que Grafana aprovisiona. */
export interface PanelDeclarado {
  readonly nombre: string;
  readonly json: Readonly<Record<string, unknown>>;
}

/**
 * Lo que un sistema aporta.
 *
 * Ocho miembros, y los seis que producen manifiestos son **funciones puras que reciben
 * el entorno y devuelven objetos planos**. Estan separadas en vez de en un solo
 * `manifiestos()` para que el mensaje de la auditoria pueda decir *que* parte del
 * descriptor esta mal, que es la mitad del valor de una auditoria.
 */
export interface DescriptorDeSistema {
  /** `rentas`, `catastro`, `normativa` o `caja`. */
  readonly sistema: string;
  /**
   * El primer segmento de sus rutas. `catastro` solo puede reclamar `catastro/...`
   * (prohibicion (a)).
   */
  readonly prefijo: string;
  /**
   * Los nombres logicos de sus imagenes. `infrastructure` los resuelve con
   * `entorno.imagenDe()`; el descriptor **no** los completa con una etiqueta.
   */
  readonly imagenes: readonly string[];

  baseDeDatos(entorno: EntornoDelDescriptor): BaseDeDatosDeclarada;
  /** Su `Deployment` y su `Service`. Si tiene mas de un perfil, uno por perfil. */
  despliegue(entorno: EntornoDelDescriptor): Manifiesto[];
  /** Su `Job` de migracion. Cada base tiene sus migraciones y su prueba de aislamiento. */
  migracion(entorno: EntornoDelDescriptor): Manifiesto[];
  /** Sus rutas, **bajo su prefijo**. */
  ingreso(entorno: EntornoDelDescriptor): Manifiesto[];
  /**
   * A quien puede llamar.
   *
   * Solo egreso: el *deny* por omision y la entrada son de `infrastructure` (ADR-0031
   * §1). Que `catastro` pueda llamar a `rentas` es una linea en su descriptor, revisable
   * en un PR — el equivalente operativo de lo que `build.gradle.kts` hace hoy con los
   * contextos acotados.
   */
  egreso(entorno: EntornoDelDescriptor): NetworkPolicy[];
  alertas(entorno: EntornoDelDescriptor): readonly ReglaDeAlerta[];
  panel(entorno: EntornoDelDescriptor): PanelDeclarado | undefined;
  claves(entorno: EntornoDelDescriptor): readonly ClaveDeclarada[];
}

/** Todos los manifiestos que un descriptor produce, en el orden en que arrancan. */
export function manifiestosDe(
  d: DescriptorDeSistema,
  entorno: EntornoDelDescriptor,
): Manifiesto[] {
  return [
    ...d.migracion(entorno),
    ...d.despliegue(entorno),
    ...d.ingreso(entorno),
    ...d.egreso(entorno),
  ];
}
