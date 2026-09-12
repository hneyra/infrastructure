import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { manifiestosDelAmbiente } from "../herramientas/emitir-manifiestos";
import { invariantesDe } from "./stacks";

/**
 * «EXITOSO» significa que el respaldo esta en el catalogo, y no que `backup-push` salio 0 (#112).
 *
 * <h2>El defecto, medido</h2>
 *
 * El 2026-09-12 los dos ambientes llevaban desde el 2026-09-05 sin un respaldo restaurable, y
 * el `CronJob` diario terminaba `Complete` escribiendo «EXITOSO» en la tabla `respaldo`. La
 * causa: cada ambiente levanto un cluster NUEVO que quedo archivando en el catalogo de wal-g
 * del ANTERIOR. wal-g no contempla dos clusteres en un catalogo y no da error — da silencio.
 * Medido contra el bucket real, `backup-push` salia 0 y `basebackups_005/` no ganaba nada.
 *
 * <h2>Se EJECUTA el guion, no se lee</h2>
 *
 * Una prueba que solo mirase que el guion CONTIENE `backup-list` pasaria en verde con la
 * comparacion escrita al reves. Es M10 de C-19. Asi que aqui el guion se toma <b>del
 * manifiesto emitido</b> —no de la constante del modulo, que es la leccion de #44— y se corre
 * con un `wal-g`, un `psql` y un `apk` de mentira delante en el `PATH`, como
 * `api-que-no-contesta.test.ts` hace con `kubectl` desde #708.
 *
 * <p>Ejecutar ya encontro un defecto que leer no habria encontrado: los mensajes de fallo
 * llevaban el nombre de las ordenes entre comillas invertidas, y dentro de unas comillas
 * dobles de bash eso es sustitucion de orden — o sea que el texto que explica el fallo
 * <b>se comia a si mismo</b>. Salia «da silencio:  calcula su ventana».
 *
 * <h2>Por que hacen falta las DOS mitades</h2>
 *
 * El censo del catalogo por si solo prueba el sintoma del 2026-09-12 y no el defecto: si el
 * cluster nuevo arranca con un LSN por ENCIMA del catalogo ajeno, `delete retain` conserva el
 * respaldo recien hecho y desaloja uno ajeno, y entonces el censo <b>pasa en verde con el
 * defecto puesto</b>. Lo que no depende de la numeracion es de quien es cada respaldo, y por
 * eso esta ademas la comprobacion del `SystemIdentifier` del centinela.
 */

/** El `psql` de mentira: anota lo que recibe y contesta un id al `INSERT`. */
const PSQL_FALSO = `#!/bin/sh
sql=$(cat)
printf '%s\\n---\\n' "$sql" >> "$ESCENARIO/psql.log"
case "$sql" in
  *"INSERT INTO respaldo"*) echo 7 ;;
esac
exit 0
`;

/**
 * El `wal-g` de mentira. El catalogo es un fichero, y cada invocacion queda anotada — sin eso
 * no se podria afirmar lo que mas importa del caso del catalogo ajeno: que `delete` NO corre.
 */
const WALG_FALSO = `#!/bin/sh
echo "$1" >> "$ESCENARIO/ordenes"
case "$1" in
  backup-list)
    [ "$(cat "$ESCENARIO/list")" = error ] && { echo "ERROR: no se pudo listar" >&2; exit 1; }
    echo "backup_name                   modified             wal_file_name            storage_name"
    while read -r n; do
      [ -n "$n" ] && echo "$n 2026-09-12T04:00:00Z \${n#base_} default"
    done < "$ESCENARIO/catalogo"
    exit 0 ;;
  backup-push)
    case "$(cat "$ESCENARIO/push")" in
      error) echo "ERROR: backup-push reviento" >&2; exit 1 ;;
      nada)  echo "INFO: parece que todo fue bien"; exit 0 ;;
      ok)    cat "$ESCENARIO/nuevo" >> "$ESCENARIO/catalogo"; echo "INFO: subido"; exit 0 ;;
    esac ;;
  st)
    nombre=$(echo "$3" | sed 's|basebackups_005/||; s|_backup_stop_sentinel.json||')
    id=$(grep "^$nombre:" "$ESCENARIO/ids" | cut -d: -f2)
    [ -z "$id" ] && { echo "ERROR: no existe $3" >&2; exit 1; }
    printf '{"LSN":1,"SystemIdentifier":%s,"Hostname":"x"}\\n' "$id"; exit 0 ;;
  delete)
    if [ "$(cat "$ESCENARIO/delete")" = come ]; then
      grep -Fxv "$(cat "$ESCENARIO/nuevo")" "$ESCENARIO/catalogo" > "$ESCENARIO/c2"
      mv "$ESCENARIO/c2" "$ESCENARIO/catalogo"
    fi
    exit 0 ;;
esac
echo "el wal-g de mentira no sabe «$*»" >&2; exit 1
`;

const NUEVO = "base_00000001000000000000009A";
const MIO = "7684396738591203366";
const AJENO = "7678467191030263850";

/** El guion del `CronJob` de respaldo, tal y como se EMITE. */
function guionDelRespaldo(ambiente: "stg" | "prod"): string {
  type Carga = {
    kind?: string;
    metadata?: { name?: string };
    spec?: {
      jobTemplate?: { spec?: { template?: { spec?: { containers?: { args?: string[] }[] } } } };
    };
  };
  const cron = (manifiestosDelAmbiente(invariantesDe(ambiente)) as Carga[]).find(
    (m) => m.kind === "CronJob" && (m.metadata?.name ?? "").includes("respaldo"),
  );
  const guion = cron?.spec?.jobTemplate?.spec?.template?.spec?.containers?.[0]?.args?.[0];
  if (guion === undefined) {
    throw new Error(
      `«${ambiente}» no emite ningun CronJob de respaldo con un guion: esta guarda se quedaria ` +
        "sin sujeto y todo lo que afirma seria cierto sobre el conjunto vacio. NO se salta.",
    );
  }
  return guion;
}

interface Escenario {
  /** Lo que el catalogo tiene ANTES de empezar. */
  catalogo?: readonly string[];
  /** Identificador de cluster de cada respaldo del catalogo. Por omision, el nuestro. */
  ajenos?: readonly string[];
  /** Que hace `backup-push`: sube, sale 0 sin subir nada, o falla. */
  push?: "ok" | "nada" | "error";
  /** Que hace `delete retain`: nada, o se lleva el respaldo recien creado. */
  delete?: "ok" | "come";
  /** Que hace `backup-list`. */
  list?: "ok" | "error";
}

interface Resultado {
  codigo: number;
  salida: string;
  /** Las ordenes que el guion le dio a wal-g, una por linea. */
  ordenes: string[];
  /** El SQL que llego al `psql` de mentira. */
  sql: string;
}

function correr(e: Escenario): Resultado {
  const carpeta = mkdtempSync(join(tmpdir(), "kamayuk-112-"));
  const bin = join(carpeta, "bin");
  execFileSync("mkdir", ["-p", bin]);

  const catalogo = e.catalogo ?? [];
  writeFileSync(join(carpeta, "catalogo"), catalogo.map((n) => `${n}\n`).join(""));
  writeFileSync(
    join(carpeta, "ids"),
    [...catalogo.map((n) => `${n}:${(e.ajenos ?? []).includes(n) ? AJENO : MIO}`), `${NUEVO}:${MIO}`]
      .map((l) => `${l}\n`)
      .join(""),
  );
  writeFileSync(join(carpeta, "nuevo"), `${NUEVO}\n`);
  writeFileSync(join(carpeta, "push"), `${e.push ?? "ok"}\n`);
  writeFileSync(join(carpeta, "delete"), `${e.delete ?? "ok"}\n`);
  writeFileSync(join(carpeta, "list"), `${e.list ?? "ok"}\n`);

  for (const [nombre, cuerpo] of [
    ["apk", "#!/bin/sh\nexit 0\n"],
    ["psql", PSQL_FALSO],
    ["wal-g-falso", WALG_FALSO],
  ] as const) {
    const ruta = join(bin, nombre);
    writeFileSync(ruta, cuerpo);
    chmodSync(ruta, 0o755);
  }

  const guion = join(carpeta, "respaldo.sh");
  writeFileSync(guion, guionDelRespaldo("stg"));

  const leer = (f: string) => {
    try {
      return readFileSync(join(carpeta, f), "utf8");
    } catch {
      return "";
    }
  };
  const entorno = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    ESCENARIO: carpeta,
    WALG: join(bin, "wal-g-falso"),
    PGHOST: "motor",
    AMBIENTE: "stg",
    DESTINO: "s3://kamayuk-stg-backups",
    RETENCION: "7",
    PGDATA_RESPALDO: "/tmp/pgdata",
    CLAVE_RESPALDO: "x",
    CLAVE_OWNER: "x",
  };

  const cosechar = (codigo: number, salida: string): Resultado => ({
    codigo,
    salida,
    ordenes: leer("ordenes").split("\n").filter(Boolean),
    sql: leer("psql.log"),
  });

  try {
    const salida = execFileSync("bash", [guion], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: entorno,
      timeout: 60_000,
    });
    return cosechar(0, salida);
  } catch (fallo) {
    const error = fallo as { status?: number; stdout?: string; stderr?: string };
    return cosechar(error.status ?? -1, `${error.stdout ?? ""}${error.stderr ?? ""}`);
  }
}

describe("#112 — «EXITOSO» significa que el respaldo esta en el catalogo", () => {
  it("con el catalogo vacio y un push que sube, marca EXITOSO", () => {
    const r = correr({ catalogo: [] });
    expect(r.codigo).toBe(0);
    expect(r.salida).toContain(`EXITOSO: «${NUEVO}»`);
    expect(r.sql).toContain("resultado = 'EXITOSO'");
  });

  it("EL DEFECTO DE HOY: push que sale 0 sin dejar nada NO es EXITOSO", () => {
    const r = correr({ catalogo: [], push: "nada" });
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain("el catalogo no gano ningun respaldo");
    expect(r.sql).toContain("resultado = 'FALLIDO'");
    expect(r.sql).not.toContain("resultado = 'EXITOSO'");
  });

  it("un catalogo con respaldos de OTRO cluster para el trabajo, y NO borra nada", () => {
    const viejos = ["base_00000001000000000000004F", "base_000000010000000000000082"];
    const r = correr({ catalogo: viejos, ajenos: viejos });
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain("respaldos de OTRO cluster");
    // Lo que mas importa del caso: la poda es lo que se lleva el WAL del cluster vivo, asi
    // que tiene que quedarse sin correr. Sin esta linea, el mensaje seria correcto y el dano
    // se habria hecho igual.
    expect(r.ordenes).not.toContain("delete");
    for (const v of viejos) expect(r.salida).toContain(`${v}(${AJENO})`);
  });

  it("si la poda se lleva el respaldo recien creado, tampoco es EXITOSO", () => {
    const r = correr({ catalogo: [], delete: "come" });
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain(`se llevo «${NUEVO}»`);
    expect(r.ordenes).toContain("delete");
  });

  it("«no se pudo listar» no se lee como «el catalogo esta vacio»", () => {
    const r = correr({ catalogo: [], list: "error" });
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain("no se pudo listar el catalogo ANTES");
    // Medido contra wal-g 3.0.5 y un bucket real: con el catalogo vacio `backup-list` sale 0
    // y no imprime nada. Asi que un no-cero es «no pude preguntar», que es C-15/C-16.
    expect(r.salida).toContain("un catalogo vacio sale 0");
    expect(r.ordenes).not.toContain("backup-push");
  });

  it("un push que falla sigue fallando, y lo dice", () => {
    const r = correr({ catalogo: [], push: "error" });
    expect(r.codigo).toBe(1);
    expect(r.salida).toContain("backup-push salio con error");
  });

  it("todo fallo VUELCA el registro de wal-g, que es el paso 1 de #112", () => {
    // Hasta ahora ese registro solo se leia como 480 caracteres hacia la columna `detalle`, y
    // moria con el pod: cuando `backup-push` salio 0 sin dejar nada, la unica prueba de lo que
    // habia pasado no existia en ningun sitio y hubo que deducirla del bucket.
    const r = correr({ catalogo: [], push: "nada" });
    expect(r.salida).toContain("--- registro de backup-push");
    expect(r.salida).toContain("INFO: parece que todo fue bien");
  });

  it("los mensajes de fallo llegan enteros: ninguna comilla invertida se los come", () => {
    // Ejecutar encontro esto y leer no lo habria encontrado. Las comillas invertidas dentro de
    // unas comillas dobles de bash son sustitucion de orden, asi que «`delete retain`» se
    // evaluaba y desaparecia del texto — el mensaje perdia justo la orden que nombra.
    const r = correr({ catalogo: [], delete: "come" });
    expect(r.salida).toContain("«delete retain 7»");
    expect(r.salida).not.toContain("da silencio:  calcula");
  });

  it("los dos ambientes emiten el mismo guion, y ninguno se queda sin el", () => {
    // El contraste de «no midio»: si un ambiente dejara de emitir el CronJob, `guionDelRespaldo`
    // lanza en vez de devolver una cadena vacia, y todo lo de arriba dejaria de tener sujeto.
    expect(guionDelRespaldo("stg")).toBe(guionDelRespaldo("prod"));
    expect(guionDelRespaldo("prod")).toContain("backup-list");
  });
});
