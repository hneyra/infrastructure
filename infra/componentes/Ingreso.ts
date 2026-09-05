import { commonLabels, resourceName, type Environment } from "../config";
import { RUTA_DE_IDENTIDAD } from "./Identidad";
import { servicioDeAplicacion, servicioDeIdentidad, servicioDeInterfaz } from "./convenciones";
import type { HelmChartConfig, IngressRoute, Manifiesto, Middleware, TLSOption } from "./tipos";

/**
 * Traefik, TLS y el fin de los puertos publicados en claro (issue #153).
 *
 * Mientras esto no exista, la clave de un funcionario municipal viaja en texto plano por
 * la red de la municipalidad. Es el issue que retira la ultima parte de la frase del
 * README del compose.
 *
 * ## Se reconfigura el Traefik de k3s; no se instala otro
 *
 * k3s trae Traefik desplegado por su propio `HelmChart`. Lo que hace `HelmChartConfig`
 * es pasarle valores a **ese**: dos ingresos peleandose por el 443 es un rato entretenido
 * que no hace falta pasar. Es lo mismo que hace `../iaac`.
 *
 * ## El grupo de la API, que es la trampa
 *
 * Traefik v3 sirve `traefik.io/v1alpha1`. Un manifiesto con el grupo viejo
 * —`traefik.containo.us/v1alpha1`— se aplica **sin error** contra un clúster que ya no lo
 * sirve: se queda ahi, sin efecto, y la ruta simplemente no existe. Los tipos de
 * `tipos.ts` fijan el grupo correcto y la auditoria lo comprueba.
 *
 * ## Lo que este componente NO puede hacer
 *
 * **El cortafuegos del VPS no es un objeto de Kubernetes.** Cerrar todo lo que no sean
 * 22, 80 y 443 es configuracion del anfitrion, y Pulumi aqui habla con el API de k3s, no
 * con el sistema operativo. Va en `vps/cortafuegos.sh`, que se ejecuta al aprovisionar el
 * nodo, y la comprobacion de que ningun otro puerto responde desde fuera se hace desde
 * fuera —el `nmap` que el propio guion deja escrito—, que es el unico sitio desde donde
 * esa afirmacion significa algo. **Mientras no haya VPS, ese criterio de #153 queda sin
 * verificar**, y decirlo es preferible a darlo por bueno.
 */

export interface IngresoArgs {
  environment: Environment;
  namespace: string;
  /** Nombre publico del sistema. De el cuelga el certificado. */
  domain: string;
  /** Donde Let's Encrypt avisa si el certificado no renueva. */
  acmeEmail: string;
  /** Emitir contra el entorno de pruebas de Let's Encrypt. Nunca en `prod`. */
  acmeStaging: boolean;
  /**
   * Si este ambiente despliega el monolito (`C-19`).
   *
   * Decide **dos** de las tres rutas: la de la interfaz —la raiz del dominio— y la de
   * `/api/v1`. Las dos apuntan por nombre a `Service` que solo existen con el monolito, y
   * una `IngressRoute` a un `Service` ausente **no se queda callada**: Traefik la acepta,
   * el certificado se emite, y lo que contesta el dominio publico es un `503` que se lee
   * como «el sistema esta caido» y no como «aqui no hay nada desplegado».
   *
   * La de la identidad NO depende de esto: Keycloak es plataforma, y los cuatro sistemas
   * de ADR-0031 validan sus tokens contra el (C-14, punto 3).
   */
  conMonolito: boolean;
}

/** El resolvedor de certificados. Un nombre, usado en tres sitios. */
export const RESOLVEDOR = "letsencrypt";

/**
 * El entorno de pruebas de Let's Encrypt.
 *
 * `stg` emite contra el porque el limite de emision del entorno de produccion es de
 * cincuenta certificados por dominio registrado y semana, y un `pulumi up` que se repite
 * mientras se ajusta el ingreso los gasta en una tarde. El certificado que emite **no lo
 * acepta ningun navegador**: por eso `config.ts` prohibe esta bandera en `prod`.
 */
export const ACME_DE_PRUEBAS = "https://acme-staging-v02.api.letsencrypt.org/directory";

export function manifiestosDeIngreso(args: IngresoArgs): Manifiesto[] {
  const { environment, namespace, domain, acmeEmail, acmeStaging, conMonolito } = args;
  const etiquetas = commonLabels(environment, "ingreso");

  const configuracionDeTraefik: HelmChartConfig = {
    apiVersion: "helm.cattle.io/v1",
    kind: "HelmChartConfig",
    metadata: {
      name: "traefik",
      // El `HelmChart` que k3s gestiona vive en `kube-system`, y el
      // `HelmChartConfig` tiene que estar en el mismo namespace y con el mismo
      // nombre; en otro sitio, k3s no lo mira y el cambio no ocurre en silencio.
      namespace: "kube-system",
      labels: etiquetas,
    },
    spec: {
      valuesContent: valoresDeTraefik({ acmeEmail, acmeStaging }),
    },
  };

  const versionMinima: TLSOption = {
    apiVersion: "traefik.io/v1alpha1",
    kind: "TLSOption",
    metadata: { name: resourceName(environment, "tls"), namespace, labels: etiquetas },
    spec: {
      // TLS 1.3, que es lo que el issue no negocia. Es mas estricto que el «1.2 como
      // minimo» de `INF-01` §3, y la consecuencia hay que saberla: un navegador
      // anterior a 2018 no entra. En una ventanilla municipal eso puede ser una
      // maquina real; si aparece, la decision se revisa **por escrito**, no aflojando
      // esta linea en un despliegue de urgencia.
      minVersion: "VersionTLS13",
      sniStrict: true,
    },
  };

  const limiteDeTasa: Middleware = {
    apiVersion: "traefik.io/v1alpha1",
    kind: "Middleware",
    metadata: { name: resourceName(environment, "limite-de-tasa"), namespace, labels: etiquetas },
    spec: {
      rateLimit: {
        // Por direccion IP. Los numeros son generosos para una ventanilla y estrechos
        // para un raspado del padron: cien peticiones por minuto de media, con rafagas
        // de cincuenta para que cargar una pantalla con varias consultas no se penalice.
        average: 100,
        period: "1m",
        burst: 50,
        sourceCriterion: { ipStrategy: { depth: 1 } },
      },
    },
  };

  const limiteDeIdentidad: Middleware = {
    apiVersion: "traefik.io/v1alpha1",
    kind: "Middleware",
    metadata: {
      name: resourceName(environment, "limite-de-identidad"),
      namespace,
      labels: etiquetas,
    },
    spec: {
      rateLimit: {
        // Mucho mas estrecho: lo que cuelga de `/keycloak` incluye el formulario de
        // acceso, y ahi el trafico legitimo es un puñado de peticiones por persona y
        // dia. Diez por minuto es holgado para entrar y estrecho para probar claves.
        average: 10,
        period: "1m",
        burst: 20,
        sourceCriterion: { ipStrategy: { depth: 1 } },
      },
    },
  };

  const tls = {
    certResolver: RESOLVEDOR,
    options: { name: versionMinima.metadata.name, namespace },
  };

  const interfaz: IngressRoute = {
    apiVersion: "traefik.io/v1alpha1",
    kind: "IngressRoute",
    metadata: { name: resourceName(environment, "interfaz"), namespace, labels: etiquetas },
    spec: {
      entryPoints: ["websecure"],
      routes: [
        {
          match: `Host(\`${domain}\`)`,
          kind: "Rule",
          // La menor prioridad de las tres: es la ruta que recoge todo lo que no
          // cayo en las otras dos. Traefik ordena por longitud de la regla, y
          // declararlo evita depender de ese detalle.
          priority: 1,
          services: [{ name: servicioDeInterfaz(environment), port: 8080 }],
          middlewares: [{ name: limiteDeTasa.metadata.name }],
        },
      ],
      tls,
    },
  };

  const api: IngressRoute = {
    apiVersion: "traefik.io/v1alpha1",
    kind: "IngressRoute",
    metadata: { name: resourceName(environment, "api"), namespace, labels: etiquetas },
    spec: {
      entryPoints: ["websecure"],
      routes: [
        {
          match: `Host(\`${domain}\`) && PathPrefix(\`/api/v1\`)`,
          kind: "Rule",
          priority: 20,
          services: [{ name: servicioDeAplicacion(environment), port: 8080 }],
          middlewares: [{ name: limiteDeTasa.metadata.name }],
        },
      ],
      tls,
    },
  };

  const identidad: IngressRoute = {
    apiVersion: "traefik.io/v1alpha1",
    kind: "IngressRoute",
    metadata: { name: resourceName(environment, "identidad"), namespace, labels: etiquetas },
    spec: {
      entryPoints: ["websecure"],
      routes: [
        {
          // La consola de administracion **no se publica**. La negacion es la parte
          // que importa de esta regla: sin ella, `/keycloak/admin` queda accesible
          // desde internet y la unica defensa seria la clave del administrador.
          // Quien administre entra por el tunel SSH, como para todo lo demas
          // (`INF-01` §1.4).
          match:
            `Host(\`${domain}\`) && PathPrefix(\`${RUTA_DE_IDENTIDAD}\`) ` +
            `&& !PathPrefix(\`${RUTA_DE_IDENTIDAD}/admin\`)`,
          kind: "Rule",
          priority: 20,
          services: [{ name: servicioDeIdentidad(environment), port: 8080 }],
          middlewares: [{ name: limiteDeIdentidad.metadata.name }],
        },
      ],
      tls,
    },
  };

  return [
    configuracionDeTraefik,
    versionMinima,
    limiteDeTasa,
    limiteDeIdentidad,
    // Las dos del monolito, o ninguna. `limite-de-tasa` se queda aunque se vayan: un
    // `Middleware` sin ruta que lo nombre es inerte —no se aplica a nada— y volver a
    // declararlo el dia que el monolito vuelva seria un segundo sitio donde acordarse.
    ...(conMonolito ? [interfaz, api] : []),
    identidad,
  ];
}

/**
 * Los valores del `HelmChart` de Traefik.
 *
 * Se escriben como texto porque eso es lo que `HelmChartConfig` recibe: k3s los funde
 * con los valores por omision del chart. Las cuatro cosas que hay aqui son las cuatro
 * del criterio de aceptacion del issue.
 */
export function valoresDeTraefik(args: { acmeEmail: string; acmeStaging: boolean }): string {
  return [
    "# Generado por infra/componentes/Ingreso.ts. No editar en el nodo:",
    "# un cambio a mano lo deshace el siguiente `pulumi up` en silencio (ADR-0011 §6).",
    "ports:",
    "  web:",
    "    # 80 no coexiste con 443: redirige. Un formulario de acceso servido por HTTP",
    "    # es una credencial regalada. El desafio HTTP-01 sigue funcionando: la",
    "    # `priority: 10` deja el router de la redireccion por DEBAJO del que Traefik",
    "    # dedica a `/.well-known/acme-challenge/`, y `allowACMEByPass` se queda en su",
    "    # `false` por omision -gana el manejador propio de Traefik-.",
    "    #",
    "    # `redirections.entryPoint`, NO `redirectTo`: esta version del chart",
    "    # (`traefik-40.1.4+up40.1.0`) renombro la clave -su propio Changelog lo",
    "    # registra como cambio incompatible: \"move redirectTo => redirections\"- y la",
    "    # vieja no aparece en ninguna plantilla, asi que se ignora en silencio, igual",
    "    # que el resolver de ACME. Se vio en `prod` leyendo los argumentos del",
    "    # contenedor: NINGUNA bandera `--entryPoints.web.http.redirections.*`, y",
    "    # `http://vmd120205.contaboserver.net/` devolviendo 404 en vez de redirigir.",
    "    http:",
    "      redirections:",
    "        entryPoint:",
    "          to: websecure",
    "          scheme: https",
    "          permanent: true",
    "          priority: 10",
    "  websecure:",
    "    http:",
    "      # Bajo `http:`, que es donde el chart lo lee. Suelto en `websecure.tls:` no",
    "      # llegaba a ninguna bandera; coincidia con el valor por omision del chart,",
    "      # asi que el TLS funcionaba igual y nada delataba que la clave era muerta.",
    "      tls:",
    "        enabled: true",
    "service:",
    "  spec:",
    "    # A donde entra el trafico de verdad: `svclb` -el LoadBalancer de k3s- hace",
    "    # DNAT contra el ClusterIP de este Service (`DEST_IPS` de sus contenedores",
    "    # `lb-tcp-80` y `lb-tcp-443`), y kube-proxy reparte ese ClusterIP SOLO entre",
    "    # endpoints marcados `ready`. Ahi estaba la rotura: Traefik pide el ACME 2s",
    "    # despues de arrancar su contenedor, pero la sonda de readiness del chart es",
    "    # `initialDelaySeconds: 2` + `periodSeconds: 10` con `failureThreshold: 1`,",
    "    # asi que la primera comprobacion cae antes de que Traefik escuche, falla, y",
    "    # la siguiente no llega hasta 10s mas tarde. Medido en el pod real de `prod`:",
    "    # contenedor arriba 06:03:27, certificado pedido 06:03:29, `Ready` 06:03:38",
    "    # -ONCE segundos-. En esa ventana el puerto 80 rechaza la conexion, Let's",
    "    # Encrypt no resuelve el desafio -\"Fetching http://.../.well-known/",
    "    # acme-challenge/...: Connection refused\"- y `acme.json` se queda con la",
    "    # cuenta registrada y `Certificates: null`. Sin certificado no hay router",
    "    # TLS, el handshake muere con \"tlsv1 unrecognized name\" y el dominio entero",
    "    # queda inalcanzable: no es que el frontend falle, es que nadie llega a el.",
    "    #",
    "    # Con esto el `EndpointSlice` marca la direccion `ready` en cuanto el Pod",
    "    # tiene IP -no cuando la sonda pasa-, y el puerto 80 responde desde que",
    "    # Traefik escucha. No estrecha la carrera: la elimina. Y es lo que vuelve",
    "    # UTIL al initContainer `esperar-endpoint-propio` de abajo, que hasta ahora",
    "    # esperaba una condicion que no podia cumplirse mientras el corria.",
    "    #",
    "    # Contrapartida: con una replica y `Recreate` el Service enruta hacia un pod",
    "    # que aun no esta listo. No se pierde nada -hoy, sin backend alguno, la",
    "    # conexion se rechaza igual-, y a cambio el certificado se obtiene.",
    "    type: LoadBalancer",
    "    publishNotReadyAddresses: true",
    "persistence:",
    "  # `acme.json` en un volumen. Sin esto, reprogramar el pod hace que Traefik pida",
    "  # los certificados otra vez, y unas cuantas reprogramaciones chocan contra el",
    "  # limite de emision de Let's Encrypt: el sistema se queda sin certificado.",
    "  enabled: true",
    "  size: 128Mi",
    "  path: /data",
    "updateStrategy:",
    "  # Volumen `ReadWriteOnce` y una replica: `Recreate`, por lo mismo que la base de",
    "  # datos. Con `RollingUpdate` el pod nuevo espera un volumen que el viejo no",
    "  # suelta, y el despliegue se cuelga con el ingreso caido (INF-01 §4).",
    "  type: Recreate",
    "podSecurityContext:",
    "  # El volumen tiene que ser escribible por el usuario del contenedor de Traefik.",
    "  fsGroup: 65532",
    "deployment:",
    "  initContainers:",
    "    # El propio chart lo avisa en sus NOTES al instalar: con `persistence`",
    "    # habilitada, el permiso de `acme.json` puede quedar en 660 -el `fsGroup`",
    "    # de arriba lo crea group-writable- y Traefik se niega a usarlo: \"unable to",
    "    # get ACME account: permissions 660 for /data/acme.json are too open,",
    "    # please use 600\". Se vio contra el cluster real de `prod`: el resolver",
    "    # quedaba \"skipped\" en el arranque y CADA router reportaba \"nonexistent",
    "    # certificate resolver\", con las banderas de `additionalArguments` (abajo)",
    "    # puestas y correctas -el sintoma no es de configuracion, es del archivo-.",
    "    # `chmod` no falla si el archivo todavia no existe -primer arranque real-.",
    "    - name: corregir-permisos-de-acme",
    "      image: curlimages/curl:8.11.1",
    "      command:",
    "        - sh",
    "        - -c",
    "        - '[ -f /data/acme.json ] && chmod 600 /data/acme.json || true'",
    "      volumeMounts:",
    "        - name: data",
    "          mountPath: /data",
    "    # `Recreate` (arriba) deja al `Service` de Traefik sin NINGUN backend valido",
    "    # entre que el pod viejo se borra y el nuevo queda enrutado -kube-proxy tiene",
    "    # que sincronizar sus reglas contra el `EndpointSlice` nuevo, y eso tarda-. Se",
    "    # comprobo contra el cluster real de `prod`, con el nodo en completa quietud",
    "    # -no es contencion de CPU-: OCHO reinicios seguidos, ocho `Connection",
    "    # refused` identicos, porque Traefik pide el certificado ACME entre 1 y 8",
    "    # segundos despues de arrancar. Este initContainer da ese margen.",
    "    #",
    "    # OJO con lo que este bucle mide, porque por si SOLO no arreglaba nada: un",
    "    # Pod en fase `Init` ya figura en el `EndpointSlice` -con IP asignada y",
    "    # `ready: false`-, asi que la coincidencia por texto acertaba en el primer",
    "    # intento y todo el margen se gastaba mientras la direccion seguia sin",
    "    # enrutar. Medido en `prod`: init a las 06:03:01, IP vista al instante,",
    "    # `sleep 25`, Traefik arrancado 06:03:27... y `Ready` 06:03:38, once",
    "    # segundos DESPUES de que el certificado ya se hubiera pedido y fallado.",
    "    # Lo que hace que esta espera sirva es `publishNotReadyAddresses` (arriba):",
    "    # con el, la direccion esta enrutada desde que el Pod tiene IP, y estos 25s",
    "    # cubren de verdad lo unico que faltaba, la sincronizacion de kube-proxy.",
    "    #",
    "    # Falla ABIERTO: si el tiempo se agota, arranca Traefik de todos modos -que",
    "    # Kubernetes tarde mas de lo normal no puede convertirse en que Traefik no",
    "    # arranque nunca-.",
    "    - name: esperar-endpoint-propio",
    "      image: curlimages/curl:8.11.1",
    "      env:",
    "        - name: POD_IP",
    "          valueFrom:",
    "            fieldRef:",
    "              fieldPath: status.podIP",
    "      command:",
    "        - sh",
    "        - -c",
    "        - |",
    "          token=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)",
    "          cacert=/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
    "          url=\"https://kubernetes.default.svc/apis/discovery.k8s.io/v1/namespaces/kube-system/endpointslices?labelSelector=kubernetes.io%2Fservice-name%3Dtraefik\"",
    "          i=0",
    "          while [ \"$i\" -lt 30 ]; do",
    "            resp=$(curl -sS --cacert \"$cacert\" -H \"Authorization: Bearer $token\" \"$url\" || true)",
    "            case \"$resp\" in",
    "              *\"$POD_IP\"*)",
    "                echo \"Propio Endpoint ($POD_IP) visible; esperando a que kube-proxy sincronice.\"",
    // El EndpointSlice actualizado NO prueba que kube-proxy ya aplico su regla de
    // iptables -son componentes distintos, el segundo mira al primero de forma
    // asincrona-. Contra prod real: con 3s de margen, todavia fallaba a los 10s
    // del arranque con la misma "Connection refused"; a los 30s ya respondia
    // bien desde fuera. 25s de margen entra comodo en ese rango, y el costo lo
    // paga solo un reinicio de Traefik -no es frecuente-.
    "                sleep 25",
    "                exit 0",
    "                ;;",
    "            esac",
    "            i=$((i + 1))",
    "            sleep 1",
    "          done",
    "          echo 'Se agoto el tiempo esperando el propio Endpoint; arranco de todos modos.' >&2",
    "          exit 0",
    "metrics:",
    "  # Solo esto: cuando vence cada certificado (issue #156, la alerta",
    "  # CertificadoPorExpirar). Nunca se publica -el Service de Traefik en",
    "  # kube-system no tiene IngressRoute, igual que el resto de lo interno-.",
    "  prometheus:",
    "    entryPoint: metrics",
    // NO `certResolvers:` de alto nivel, y NO `ports.websecure.tls.certResolver`:
    // esta version del chart de k3s (`traefik-40.1.4+up40.1.0`) los ignora en
    // silencio. `helm upgrade` termina en "Upgrade complete" y el `Deployment`
    // arranca sin un solo flag `--certificatesresolvers.*` -se comprobo contra el
    // Traefik real de `prod`, leyendo los argumentos del contenedor-, y el propio
    // Traefik lo dice en su log desde el primer arranque: "Router uses a
    // nonexistent certificate resolver". Sin resolver, no hay certificado que
    // ofrecer para el SNI pedido, y el TLS se cae con "unrecognized name" —nunca
    // hubo HTTPS publico funcionando en `prod` hasta este cambio.
    //
    // `additionalArguments` es el unico mecanismo que esta version del chart
    // aplica de verdad: son flags de linea de comandos, sin una capa de valores
    // que la traduzca -y que pueda dejar de hacerlo entre versiones del chart-.
    "additionalArguments:",
    `  - "--entryPoints.websecure.http.tls.certResolver=${RESOLVEDOR}"`,
    `  - "--certificatesResolvers.${RESOLVEDOR}.acme.email=${args.acmeEmail}"`,
    `  - "--certificatesResolvers.${RESOLVEDOR}.acme.storage=/data/acme.json"`,
    `  - "--certificatesResolvers.${RESOLVEDOR}.acme.httpChallenge.entryPoint=web"`,
    ...(args.acmeStaging
      ? [`  - "--certificatesResolvers.${RESOLVEDOR}.acme.caServer=${ACME_DE_PRUEBAS}"`]
      : []),
    "",
  ].join("\n");
}
