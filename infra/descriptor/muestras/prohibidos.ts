/**
 * Las CINCO muestras que violan las cinco prohibiciones de `descriptor/auditoria.ts`.
 *
 * Cada una es el descriptor valido de `catastro` con **un solo cambio**, para que lo que
 * la prueba mide sea exactamente la prohibicion y no un descriptor mal escrito por otros
 * cuatro sitios. Su pareja son los dos descriptores validos de `validos.ts`: sin ellos,
 * una auditoria que rechazara todo pasaria estas cinco pruebas.
 *
 * No se exportan al `index.ts` del descriptor a proposito: existen para las pruebas.
 */

import type { Manifiesto } from "../../componentes/tipos";
import type { BaseDeDatosDeclarada, ClaveDeclarada, DescriptorDeSistema } from "../tipos";
import { catastro } from "./validos";

/**
 * (a) Una ruta fuera de su prefijo.
 *
 * `catastro` reclama `/rentas/contribuyentes`. No falla al aplicarse: se lo queda, y las
 * peticiones de rentas dejan de llegar a rentas.
 */
export const rutaFueraDeSuPrefijo: DescriptorDeSistema = {
  ...catastro,
  ingreso: (e): Manifiesto[] => [
    {
      apiVersion: "traefik.io/v1alpha1",
      kind: "IngressRoute",
      metadata: { name: "kamayuk-catastro", namespace: e.namespace, labels: e.etiquetas },
      spec: {
        entryPoints: ["websecure"],
        routes: [
          {
            match: `Host(\`${e.dominio}\`) && PathPrefix(\`/rentas/contribuyentes\`)`,
            kind: "Rule",
            services: [{ name: "kamayuk-catastro-web", port: 80 }],
          },
        ],
        tls: { certResolver: "letsencrypt" },
      },
    },
  ],
};

/**
 * (b) La etiqueta de la imagen, declarada en el descriptor.
 *
 * Es la que sostiene a las otras cuatro. Con ella dentro, la etiqueta entra en el estado
 * de Pulumi y cada liberacion vuelve a ser un `pulumi up`.
 */
export const etiquetaDeImagenPropia: DescriptorDeSistema = {
  ...catastro,
  despliegue: (e): Manifiesto[] => {
    const manifiestos = structuredClone(catastro.despliegue(e));
    const d = manifiestos[0] as Extract<Manifiesto, { kind: "Deployment" }>;
    const c = d.spec.template.spec.containers[0];
    if (c) c.image = "ghcr.io/hneyra/kamayuk-catastro:v2.4.1";
    return manifiestos;
  },
};

/** (c) Privilegios sobre la base de otro sistema. */
export const privilegiosSobreBaseAjena: DescriptorDeSistema = {
  ...catastro,
  baseDeDatos(): BaseDeDatosDeclarada {
    return {
      nombre: "catastro",
      roles: [
        { nombre: "catastro_owner", sobre: ["catastro"], privilegios: ["ALL"], superusuario: false },
        // «solo para leer el padron de contribuyentes», que es como empieza siempre.
        { nombre: "catastro_app", sobre: ["catastro", "rentas"], privilegios: ["SELECT"], superusuario: false },
      ],
    };
  },
};

/**
 * (d) Un Deployment sin limites de recursos y sin sondas.
 *
 * La unica de las cinco que **no** la implementa `descriptor/auditoria.ts`: la hereda de
 * `auditarManifiestos`, el mismo que audita los componentes propios. Que esta muestra
 * muerda es lo que demuestra que las convenciones de INF-01 §4 se aplican igual a un
 * descriptor ajeno, que es el punto entero del diseno.
 */
export const despliegueSinLimitesNiSondas: DescriptorDeSistema = {
  ...catastro,
  despliegue: (e): Manifiesto[] => {
    const manifiestos = structuredClone(catastro.despliegue(e));
    const d = manifiestos[0] as Extract<Manifiesto, { kind: "Deployment" }>;
    const c = d.spec.template.spec.containers[0];
    if (c) {
      delete (c as { resources?: unknown }).resources;
      delete c.startupProbe;
      delete c.readinessProbe;
      delete c.livenessProbe;
    }
    return manifiestos;
  },
};

/**
 * (e) Un `Secret` en claro, por sus dos caminos: el manifiesto y el inventario.
 *
 * El `as` es deliberado y es lo que la prueba mide: `Manifiesto` no incluye `Secret`, asi
 * que TypeScript ya lo impide por la via recta. Lo que la auditoria tiene que cazar es al
 * que llega rodeandolo.
 */
export const secretoEnClaro: DescriptorDeSistema = {
  ...catastro,
  despliegue: (e): Manifiesto[] => [
    ...catastro.despliegue(e),
    {
      apiVersion: "v1",
      kind: "Secret",
      metadata: { name: "kamayuk-catastro-app", namespace: e.namespace },
      stringData: { clave: "una-clave-de-verdad" },
    } as unknown as Manifiesto,
  ],
  claves: (): ClaveDeclarada[] => [
    {
      nombre: "catastro-app",
      clave: "clave",
      rol: "catastro_app",
      rotacion: "trimestral",
      proposito: "la conexion de la aplicacion",
      valor: "una-clave-de-verdad",
    } as unknown as ClaveDeclarada,
  ],
};
