/**
 * Una base nueva del producto no llegaba nunca a un motor que ya existe (#81).
 *
 * ## Lo medido en `stg` el 2026-09-11
 *
 * El motor tenia `caja catastro keycloak normativa postgres rentas sgtm` — **faltaba
 * `identidad`**, el quinto sistema. Y en los registros del propio motor, **una vez cada cinco
 * segundos durante ocho horas**:
 *
 * ```
 * FATAL:  database "identidad" does not exist
 * ```
 *
 * Quien la pedia era `kamayuk-identidad-web`, en `CrashLoopBackOff` con **103 reinicios**.
 *
 * ## Por que
 *
 * `05-crear-bases.sh` es correcto e idempotente. El problema es **donde vive**: en
 * `docker-entrypoint-initdb.d`, que la imagen de PostgreSQL ejecuta **solo cuando `PGDATA` esta
 * vacio**. El volumen de `stg` se creo el 2026-09-05 y el quinto sistema nacio despues, asi que
 * el guion que sabe crearla no se volvio a ejecutar nunca.
 *
 * Y el sintoma no se parece a la causa: `database "identidad" does not exist` se lee como «la
 * migracion fallo» o «la URL apunta mal». Lo que dice es «ese guion corrio una vez, hace seis
 * dias, cuando este sistema no existia». Nada se ponia rojo: los `Job` arrancan, se conectan y
 * mueren, y el `Deployment` entra en CrashLoopBackOff — tres sintomas para una causa que no
 * menciona ninguno.
 *
 * ## Lo que esta guarda fija, y lo que no
 *
 * Fija que exista un `Job` que ejecute **los mismos dos guiones** contra el motor **en marcha**,
 * con `PGHOST` puesto. No comprueba que la base se cree: eso exige un motor, y lo mide el
 * trabajo «El motor, levantado y con el aislamiento verificado» del flujo.
 */
import { describe, expect, it } from "vitest";
import { type Environment } from "../config";
import { huellaDelContenido } from "../componentes/convenciones";
import { construirManifiestos } from "../componentes";
import { invariantesDe } from "./stacks";
import type { Manifiesto } from "../componentes/tipos";

const AMBIENTE: Environment = "prod";

function manifiestos(): Manifiesto[] {
  return construirManifiestos(invariantesDe(AMBIENTE));
}

interface Trabajo {
  metadata: { name: string };
  spec: {
    template: {
      spec: {
        containers: {
          args?: string[];
          env?: { name: string; value?: string }[];
          volumeMounts?: { name: string; mountPath: string }[];
        }[];
        volumes?: { name: string }[];
      };
    };
  };
}

function elJobQueCreaBases(): Trabajo {
  const jobs = manifiestos().filter((m) => m.kind === "Job") as unknown as Trabajo[];
  const job = jobs.find((j) => j.metadata.name.includes("crear-bases"));
  if (!job) {
    throw new Error(
      "no hay ningun Job que cree las bases. Sin el, una base que nace DESPUES que el volumen " +
        "no llega nunca al motor: `05-crear-bases.sh` vive en `docker-entrypoint-initdb.d`, que " +
        "solo corre con `PGDATA` vacio.",
    );
  }
  return job;
}

describe("#81 - una base que nace despues que el volumen llega igual al motor", () => {
  it("existe un Job que crea las bases contra el motor en marcha", () => {
    expect(elJobQueCreaBases().metadata.name).toContain("crear-bases");
  });

  it("ejecuta LOS MISMOS dos guiones que la inicializacion, no una copia", () => {
    const args = (elJobQueCreaBases().spec.template.spec.containers[0]?.args ?? []).join(" ");
    for (const guion of ["05-crear-bases.sh", "06-roles-de-los-sistemas.sh"]) {
      expect(
        args,
        `el Job no ejecuta «${guion}». Reescribir lo que ese guion hace seria tener dos sitios ` +
          "que crean bases, y el dia que uno cambie el otro se queda viejo sin que nada lo diga.",
      ).toContain(guion);
    }
  });

  it("declara PGHOST, o `psql` buscaria un socket local que en un pod no existe", () => {
    const env = elJobQueCreaBases().spec.template.spec.containers[0]?.env ?? [];
    const pghost = env.find((e) => e.name === "PGHOST");
    expect(
      pghost?.value,
      "sin `PGHOST`, los dos guiones —que invocan `psql` sin `--host` a proposito— buscarian el " +
        "socket de un motor que en este pod no corre. Es lo unico que hace que valgan sin tocarlos.",
    ).toBeTruthy();
  });

  it("monta los dos volumenes de la inicializacion, con los mismos nombres", () => {
    const job = elJobQueCreaBases();
    const montados = (job.spec.template.spec.containers[0]?.volumeMounts ?? []).map((v) => v.name);
    const volumenes = (job.spec.template.spec.volumes ?? []).map((v) => v.name);
    for (const v of ["inicializacion", "roles-de-los-sistemas"]) {
      expect(
        montados,
        `el Job no monta «${v}». Sin los guiones o sin los \`crear-roles.sql\` de los que deriva ` +
          "la lista de bases, no tiene ni que ejecutar ni de donde sacar cuales crear.",
      ).toContain(v);
      expect(volumenes).toContain(v);
    }
  });

  it("y el guion lee los roles donde el Job los monta", () => {
    const montajes = elJobQueCreaBases().spec.template.spec.containers[0]?.volumeMounts ?? [];
    const roles = montajes.find((m) => m.name === "roles-de-los-sistemas");
    const env = elJobQueCreaBases().spec.template.spec.containers[0]?.env ?? [];
    const dir = env.find((e) => e.name === "KAMAYUK_DIR_KAMAYUK")?.value;
    expect(
      roles?.mountPath,
      "el directorio que el guion lee (`KAMAYUK_DIR_KAMAYUK`) y el sitio donde el Job monta los " +
        "roles tienen que ser el mismo. Si no, el guion no encuentra ningun `<sistema>.sql`, " +
        "concluye que no hay bases que crear, y sale en VERDE sin haber creado ninguna.",
    ).toBe(dir);
  });

  it("el nombre lleva la huella del contenido, que es lo que lo hace correr al anadir un sistema", () => {
    const nombre = elJobQueCreaBases().metadata.name;
    const ms = manifiestos();
    const roles = ms.find((m) => m.metadata?.name?.includes("roles-de-los-sistemas")) as
      | { data: Record<string, string> }
      | undefined;
    const init = ms.find((m) => m.metadata?.name?.includes("postgres-inicializacion")) as
      | { data: Record<string, string> }
      | undefined;
    const esperada = huellaDelContenido({
      ...(roles?.data ?? {}),
      "05-crear-bases.sh": init?.data["05-crear-bases.sh"] ?? "",
      "06-roles-de-los-sistemas.sh": init?.data["06-roles-de-los-sistemas.sh"] ?? "",
    });
    expect(
      nombre,
      "el nombre del Job no termina en la huella de lo que ejecuta. Con un nombre fijo, anadir " +
        "un sistema NO crearia un Job nuevo: Kubernetes ve el mismo objeto ya completado y no " +
        "vuelve a correrlo, que es exactamente el silencio del que #81 sale.",
    ).toMatch(new RegExp(`-${esperada}$`));
  });
});
