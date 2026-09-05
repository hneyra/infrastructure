import { readFileSync } from "node:fs";
import { join } from "node:path";
import { raizDeInfra } from "../componentes/fuentes";
import { readInvariants, type ConfigReader, type Environment, type Invariants } from "../config";

/**
 * Los `Pulumi.<ambiente>.yaml` versionados, leidos sin Pulumi.
 *
 * Lo usan `stacks.test.ts` —que comprueba que esos archivos cumplen sus invariantes— y
 * `componentes.test.ts` —que construye con ellos los manifiestos de los dos ambientes—.
 * Las dos hacen lo mismo que hace `pulumi preview`, salvo lo que importa: **corren sin
 * token, sin tunel y sin VPS**, asi que la demostracion de que una regla muerde se puede
 * ejecutar en cualquier maquina, tambien en un PR de alguien de fuera.
 */

/**
 * Lector minimo de un `Pulumi.<ambiente>.yaml`.
 *
 * Solo entiende la forma que estos archivos tienen —`config:` y debajo una linea
 * `kamayuk:clave: valor` por valor—, y es a proposito: reconoce exactamente lo que Pulumi
 * lee de ellos, sin traer un analizador de YAML entero para veinte lineas. Si algun dia
 * un stack necesita estructuras anidadas, aqui es donde se nota.
 */
export function leerStack(ambiente: string): ConfigReader {
  const texto = textoDelStack(ambiente);
  const valores = new Map<string, string>();

  for (const linea of texto.split("\n")) {
    const limpia = linea.split("#")[0] ?? "";
    const casa = /^\s+kamayuk:([A-Za-z0-9_]+):\s*(.+?)\s*$/.exec(limpia);
    if (casa && casa[1] !== undefined && casa[2] !== undefined) {
      valores.set(casa[1], casa[2].replace(/^["']|["']$/g, ""));
    }
  }

  // Las conversiones son las de Pulumi: en el archivo todo es texto, y `getNumber`,
  // `getBoolean` y `getObject` lo interpretan al leerlo.
  return {
    text: (clave) => valores.get(clave),
    number: (clave) => {
      const bruto = valores.get(clave);
      return bruto === undefined ? undefined : Number(bruto);
    },
    boolean: (clave) => {
      const bruto = valores.get(clave);
      return bruto === undefined ? undefined : bruto === "true";
    },
    object: <T>(clave: string) => {
      const bruto = valores.get(clave);
      return bruto === undefined ? undefined : (JSON.parse(bruto) as T);
    },
  };
}

export function textoDelStack(ambiente: string): string {
  return readFileSync(join(raizDeInfra(), `Pulumi.${ambiente}.yaml`), "utf8");
}

/** La configuracion del ambiente, tal como la leeria `pulumi up`. */
export function invariantesDe(ambiente: Environment): Invariants {
  return readInvariants(ambiente, leerStack(ambiente));
}
