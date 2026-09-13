import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { REALM_DERIVADO, documentosDelRealmDelCompose } from "../componentes/Identidad";
import { raizDelRepositorio } from "../componentes/fuentes";

/**
 * `yarn realm-del-compose`: reescribe `despliegue/identidad/realm-derivado/` (#72).
 *
 * Es lo que monta `plataforma.compose.yaml`, derivado del realm versionado por la MISMA funcion
 * que alimenta el `ConfigMap` del cluster (`piezasDelRealm`). Se corre despues de tocar
 * `realm-kamayuk.json` o `realm-kamayuk-ciudadano.json`, y
 * `el-compose-importa-el-realm-derivado.test.ts` se pone rojo si alguien se olvida.
 *
 * **Borra el directorio antes de escribir**, y no es descuido: `reconciliar-realm.sh` recorre
 * `ambito--*.json` con un glob, asi que un ambito renombrado dejaria el viejo en disco y el guion
 * lo seguiria creando en cada maquina. Lo que no produce el generador no puede quedarse.
 *
 * Un punto de entrada aparte, por lo mismo que `escribir-observabilidad.ts`: el generador no
 * escribe nada al importarse, asi que la guarda lo ejerce sin tocar un archivo.
 */
const destino = join(raizDelRepositorio(), REALM_DERIVADO);
const documentos = documentosDelRealmDelCompose();

rmSync(destino, { recursive: true, force: true });
for (const [ruta, contenido] of Object.entries(documentos)) {
  const completa = join(destino, ruta);
  mkdirSync(dirname(completa), { recursive: true });
  writeFileSync(completa, contenido, "utf8");
}

process.stdout.write(
  `Escritos en ${destino}:\n${Object.keys(documentos)
    .map((ruta) => `  ${ruta}`)
    .join("\n")}\n`,
);
