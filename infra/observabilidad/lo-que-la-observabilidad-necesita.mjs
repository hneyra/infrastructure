#!/usr/bin/env node
// Lo que las dos comprobaciones de observabilidad NECESITAN levantar, y nada mas.
//
// Filtro de flujo: lee un manifiesto en JSON por la entrada y escribe otro por la
// salida.  Lo usan `verificar-alertas.sh` y `verificar-tableros.sh`, que aplican el
// manifiesto de `stg` de VERDAD sobre el nodo UNICO de un `kind`.
//
//   uso:  yarn --silent manifiestos --ambiente stg | node observabilidad/lo-que-la-observabilidad-necesita.mjs stg
//
// ── POR QUE ESTE ARCHIVO EXISTE, Y NO DOS LISTAS COPIADAS ───────────────────────
//
// Hasta #203 la lista vivia DOS VECES, una dentro de cada `node -e` de los dos
// guiones, identicas linea a linea.  Es la leccion de C-20 otra vez: el defecto no
// era el patron, era que estaba copiado — y una correccion en una copia deja la otra
// como estaba.  Aqui hay una sola.
//
// ── QUE SE QUITA, Y POR QUE CADA COSA ───────────────────────────────────────────
//
//  1. **Los recursos de Traefik**: sus CRD no estan en un `kind` limpio, asi que el
//     API server los rechaza.  Es el mismo filtro que el trabajo `manifiestos`.
//
//  2. **La interfaz, la aplicacion, Keycloak y los Job de migracion/implantacion de
//     la PLATAFORMA**: ninguno le hace falta a estas dos comprobaciones —los dos
//     paneles de la aplicacion los sirve el exportador sintetico de
//     `verificar-tableros.sh`, y ningun panel ni ninguna regla lee nada de
//     Keycloak—, y aplicados igual compiten por la CPU del nodo con postgres y con
//     los componentes de observabilidad, que SI hacen falta.  Medido dos veces en
//     CI: con el manifiesto completo el planificador reportaba «Insufficient cpu» y,
//     bajo esa saturacion, hasta Prometheus —ya listo y sirviendo— dejaba de
//     contestar a tiempo.
//
//  3. **TODO lo que vive en el espacio de nombres de OTRO sistema** — y esto es lo
//     que #203 anade.  Desde ADR-0031, `yarn manifiestos --ambiente stg` emite seis
//     espacios de nombres: la plataforma y los CINCO sistemas.  La lista del punto 2
//     se escribio cuando solo existia el primero, asi que nombra prefijos
//     `kamayuk-stg-*` y no ve ni uno de los otros cinco.  Medido sobre `main` el
//     2026-09-16, con `origin/main` de los cinco clones al lado:
//
//       kamayuk-caja-stg        370m / 1664Mi
//       kamayuk-catastro-stg    320m / 1408Mi
//       kamayuk-normativa-stg   320m / 1408Mi
//       kamayuk-rentas-stg      320m / 1408Mi
//       kamayuk-identidad-stg   270m /  704Mi
//       ───────────────────────────────────────
//                              1600m / 6592Mi   que estas dos comprobaciones NO leen
//
//     Con ellos, lo aplicado pedia 2 310m / 8 224Mi contra los 1 050m / 7 778Mi que
//     deja libres un nodo de `kind` sobre un runner de 2 CPU.  Sin ellos, 710m /
//     1 632Mi: cabe por los dos ejes.
//
//     **Y no se vacia lo que se mide**: ninguna regla de `observabilidad/alertas.yml`
//     y ningun panel de `dashboards/resumen-operativo.json` nombra un sistema.  Las
//     doce expresiones del tablero leen `pg_*` (el motor y su sidecar), `node_*` (el
//     node-exporter), `kube_*` (kube-state-metrics, que ve el clúster ENTERO) y las
//     dos de la aplicacion, que sirve el exportador sintetico.  La unica regla que
//     `verificar-alertas.sh` ejercita es `PostgreSQLCaido`.
//
//     Los `Namespace` de los cinco tampoco se aplican, y no hace falta que esten:
//     `bootstrap-secretos.sh` —que los dos guiones llaman despues— crea el suyo a
//     cada entrada del inventario antes de escribir nada (C-17).
//
// Lo que NO se toca son los objetos SIN espacio de nombres —`PriorityClass`,
// `StorageClass`—: no piden CPU, y los pods de la plataforma los nombran.

import { readFileSync } from "node:fs";

const AMBIENTE = process.argv[2] ?? "stg";
const DE_LA_PLATAFORMA = `kamayuk-${AMBIENTE}`;

const DE_TRAEFIK = ["IngressRoute", "Middleware", "TLSOption", "HelmChartConfig"];

/** Lo de la plataforma que pesa y que ninguna de las dos comprobaciones lee. */
const PESADOS = [
  { kind: "Deployment", prefijo: `${DE_LA_PLATAFORMA}-interfaz` },
  { kind: "Service", prefijo: `${DE_LA_PLATAFORMA}-interfaz` },
  { kind: "Deployment", prefijo: `${DE_LA_PLATAFORMA}-identidad` },
  { kind: "Job", prefijo: `${DE_LA_PLATAFORMA}-realm-` },
  { kind: "Job", prefijo: `${DE_LA_PLATAFORMA}-migracion-` },
  { kind: "Job", prefijo: `${DE_LA_PLATAFORMA}-implantacion-` },
  { kind: "Deployment", prefijo: `${DE_LA_PLATAFORMA}-aplicacion` },
  { kind: "CronJob", prefijo: `${DE_LA_PLATAFORMA}-lote` },
];

/**
 * El espacio de nombres al que pertenece un objeto, o `""` si no vive en ninguno.
 * Un `Namespace` pertenece al que declara: es lo que permite no aplicar los cinco.
 */
function espacioDe(item) {
  if (item.kind === "Namespace") return item.metadata?.name ?? "";
  return item.metadata?.namespace ?? "";
}

const entrada = JSON.parse(readFileSync(0, "utf8"));

entrada.items = (entrada.items ?? []).filter((item) => {
  if (DE_TRAEFIK.includes(item.kind)) return false;

  const espacio = espacioDe(item);
  if (espacio !== "" && espacio !== DE_LA_PLATAFORMA) return false;

  const nombre = item.metadata?.name ?? "";
  return !PESADOS.some((p) => item.kind === p.kind && nombre.startsWith(p.prefijo));
});

process.stdout.write(JSON.stringify(entrada));
