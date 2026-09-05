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
  /**
   * A quien se le avisa en este ambiente cuando algo de operacion necesita una persona.
   *
   * Es del **ambiente** y no del sistema, y por eso lo entrega `infrastructure`: la pregunta que
   * contesta es «a quien se le avisa en stg» y «a quien en prod». Un descriptor no lo puede
   * componer ni leer de `process.env` — es un dato, como los demas.
   *
   * El primero que lo necesita es `caja`: ADR-0026 §4 exige una alerta **a una persona con
   * nombre** cuando hay dinero cobrado sin registrar, y su aplicacion NO ARRANCA sin las dos
   * (`ResponsableDeLaConciliacion` lo comprueba al construirse). Hasta C-7 este tipo no tenia
   * campo para ellas, asi que el pod de `caja` no podia levantar: el hueco estaba escrito en su
   * descriptor y no se podia cerrar desde alli, porque cerrarlo era cambiar este archivo.
   */
  readonly operacion: {
    /** Nombre de la persona o el puesto. Tiene que decir a quien. */
    readonly responsable: string;
    /** Donde se le avisa: un correo, un canal de mensajeria, un telefono. */
    readonly canal: string;
  };
  /**
   * La municipalidad que este ambiente implanta (C-14, punto 4).
   *
   * Del **ambiente** y no del sistema, como `operacion`: la pregunta que contesta es «a que
   * municipalidad sirve stg» y «a cual prod», no «cual implanta catastro». Los cuatro sistemas
   * implantan **la misma**, cada uno en su base: `municipalidad` existe en los cuatro baselines
   * con su `es_demostracion`, y `SoloEnDemostracion` la consulta en la base de su propio sistema.
   *
   * Sale de `Pulumi.<ambiente>.yaml` —las mismas claves que ya alimentan el Job de implantacion
   * del monolito desde el issue #150— y `checkInvariants` la valida antes de componer nada: seis
   * digitos de ubigeo, tipo DISTRITAL o PROVINCIAL, y `esDemostracion` **declarado** en prod.
   */
  readonly implantacion: {
    /** Seis digitos. Es la clave por la que la implantacion es idempotente. */
    readonly ubigeo: string;
    readonly nombre: string;
    readonly tipo: "DISTRITAL" | "PROVINCIAL";
    /** Cuenta del primer administrador. La MISMA que exista en Keycloak. */
    readonly administrador: string;
    readonly nombreDelAdministrador: string;
    /** Si la instalacion sale marcada en todo documento que emita (INF-03 §3.2, #122). */
    readonly esDemostracion: boolean;
    /**
     * El `id` de la fila que la implantacion crea, que es lo que los procesos por lotes
     * fijan como contexto de tenant.
     *
     * **Se declara y no se deriva, y hay que decir lo que eso cuesta**: es una columna
     * `IDENTITY`, asi que en una base recien creada vale 1 por construccion, pero nada aqui lo
     * comprueba contra la fila. Un valor que no corresponda a la municipalidad del `ubigeo` deja
     * al ingestor y al publicador proyectando bajo otro contexto — y RLS no lo delata, porque la
     * base hace exactamente lo que se le pide. Cerrarlo exige que esos procesos resuelvan el
     * ubigeo ellos mismos, que es un cambio de backend en `rentas` y en `catastro` (C-14 §6).
     */
    readonly municipalidadId: number;
  };
  /**
   * El namespace de OTRO sistema en este ambiente.
   *
   * Hace falta para dos cosas que no se pueden componer a mano sin repetir la convencion:
   * la direccion de un servicio ajeno —`catastro` es quien sirve el buzon que `rentas`
   * consume (C-8)— y el `namespaceSelector` de una politica de egreso.
   *
   * **Lo segundo no es un adorno.** Cada sistema tiene su namespace desde ADR-0031, y un
   * `podSelector` sin `namespaceSelector` selecciona pods **del mismo namespace**: una regla
   * de egreso escrita asi no abre nada, y el sintoma es trafico denegado con una politica que
   * dice permitirlo.
   *
   * No da acceso a nada: es una cadena. Lo que un sistema puede llamar sigue siendo lo que
   * declara en `egreso()`, revisable en un PR.
   */
  namespaceDe(sistema: string): string;
  /**
   * Un nombre de recurso que **cambia con la version desplegada**.
   *
   * Existe por una regla de Kubernetes y no por gusto: **un `Job` es inmutable**. Su plantilla de
   * pod no se puede modificar, asi que un Job cuyo nombre no cambie hace fallar el `pulumi up` de
   * la version siguiente al intentar actualizarlo —la imagen lleva la etiqueta dentro—. El
   * monolito lo resolvio asi desde el issue #150 (`sufijoDeVersion`), y los cuatro sistemas
   * nacieron sin ello: sus Jobs se llamaban igual en toda version.
   *
   * Devuelve el sufijo **recortado y saneado**, no la version: con doce caracteres no se puede
   * recomponer la referencia de una imagen, asi que esto no abre una puerta a la prohibicion (b).
   *
   * Volver a aplicar la MISMA version no crea nada: el Job ya existe y ya termino. Migrar e
   * implantar son idempotentes los dos.
   */
  nombreConVersion(base: string): string;
  /**
   * Lo que la plataforma sirve, y donde vive.
   *
   * Los cuatro sistemas comparten **un** motor y **un** emisor de identidad: son de
   * `infrastructure`, viven en su namespace y ningun descriptor los despliega. Lo que se
   * entrega aqui son las tres cosas que un sistema necesita saber de ellos y no puede componer
   * sin repetir una convencion ajena.
   *
   * El reparto entre `emisor` y `jwks` **no es un detalle**: el emisor es una IDENTIDAD —es lo
   * que se compara con el `iss` del token, y lo que hace que un token de otro realm no valga— y
   * el JWKS es una DIRECCION DE RED. En un despliegue con contenedores las dos no coinciden: el
   * navegador llega a Keycloak por el nombre publico y el backend lo alcanza por el interno. Usar
   * el publico para las dos cosas deja al backend descargando las claves por el ingreso para
   * volver a entrar, y **todo token seria invalido por un motivo que no se parece a su causa**.
   */
  readonly plataforma: {
    /** Su namespace. Hace falta para el `namespaceSelector` de las politicas de egreso. */
    readonly namespace: string;
    /** El emisor OIDC, publico. Es lo que se compara con el `iss`. */
    readonly emisor: string;
    /** El JWKS, direccion de red **interna**, ya cruzando el namespace. */
    readonly jwks: string;
  };
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
 * Diez miembros, y los ocho que producen manifiestos son **funciones puras que reciben
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
  /**
   * Su `Job` de migracion. Cada base tiene sus migraciones y su prueba de aislamiento.
   *
   * **Corre la imagen del migrador, no la de la aplicacion** (C-14, punto 1). Son dos objetivos
   * del mismo `Dockerfile` y dos imagenes publicadas: la aplicacion arranca con
   * `spring.flyway.enabled: false` a proposito (ARQ-03 §4), asi que un Job que corriera la imagen
   * de la aplicacion **no migraria** — arrancaria el proceso web con las credenciales de
   * `sgtm_owner`, que es lo peor de las dos cosas.
   */
  migracion(entorno: EntornoDelDescriptor): Manifiesto[];
  /**
   * Su `Job` de implantacion: la fila de `municipalidad` en SU base, y la copia local de
   * usuarios, grupos y accesos (C-7 §2.3).
   *
   * Va detras de la migracion y **no se puede pedir que la espere mirando el API de Kubernetes**:
   * eso exigiria una cuenta de servicio con permiso para leer Jobs. Lo que hace es asegurarse de
   * que el esquema esta, corriendo el migrador —que es idempotente— como contenedor de
   * inicializacion. Es mas fuerte que la espera del monolito, que solo comprueba que
   * `flyway_schema_history` tenga una fila.
   */
  implantacion(entorno: EntornoDelDescriptor): Manifiesto[];
  /**
   * Sus procesos por lotes con ventana: los `CronJob` del perfil `batch`.
   *
   * Vacio es una respuesta legitima —`normativa` y `caja` no tienen ninguno— y no es lo mismo que
   * un `CronJob` suspendido: lo primero dice «este sistema no corre nada de madrugada» y lo
   * segundo «corre esto, y hoy no puede».
   */
  lotes(entorno: EntornoDelDescriptor): Manifiesto[];
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
    ...d.implantacion(entorno),
    ...d.despliegue(entorno),
    ...d.lotes(entorno),
    ...d.ingreso(entorno),
    ...d.egreso(entorno),
  ];
}
